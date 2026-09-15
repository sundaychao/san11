import { describe, expect, it } from 'vitest';
import {
  autoResolveDebate,
  createDebate,
  DEBATE_STARTING_HP,
  dismissDebate,
  getHandSize,
  judgeRound,
  maskOpponentHand,
  resolveDebateAbandon,
  resolveDebateRethink,
  resolveDebateRound,
  SKILLS,
  TYPE_NAMES,
  officerTrait,
  type DebateCard,
} from './debate';
import { runAiTurn } from './ai';
import { executeCommand, validateCommand } from './commands';
import { talentDebateTriggerChance } from './loyalty';
import { nextRandom } from './random';
import { createGame } from './scenario/jingxiang208';
import type { CityId, GameState, Officer } from './types';

/** 在指定城池注入一名在野武将（供登庸舌战测试） */
function injectUnaffiliated(state: GameState, cityId: string): Officer {
  const officer: Officer = {
    id: `uto-${cityId}`,
    name: '测试在野',
    forceId: null,
    cityId: cityId as never,
    location: { kind: 'unaffiliated', cityId: cityId as never },
    stats: { leadership: 60, war: 60, intelligence: 70, politics: 65, charisma: 60 },
    personality: 'calm',
    acted: false,
  };
  state.officers = { [officer.id]: officer, ...state.officers };
  return officer;
}

/**
 * 找一个使「曹操登庸宛城在野武将」触发舌战的种子。
 * 原版时机：登庸按舌战触发率掷点；登庸路径在意愿判定后恰好先消费一次掷点，
 * 用同种子预演即可确定该种子下是否触发舌战。
 */
function seedWhereCaoDebatesWan(): number {
  // xorshift32 对小种子的首个输出值接近 0（必然小于触发率），须在大数值域选种才有效
  const base = 0x40000000;
  for (let i = 0; i < 4000; i += 1) {
    const seed = base + i * 7919;
    const state = createGame('cao', seed);
    state.cities.wan.gold = 2000;
    const target = injectUnaffiliated(state, 'wan');
    const chance = talentDebateTriggerChance(state, state.officers['cao-cao'], target);
    const probe = nextRandom(state.seed, state.rngCursor);
    if (probe.value < chance) return seed;
  }
  throw new Error('no seed where talent triggers debate');
}

/** 反复出第一张可出牌直到终局（防死循环上限 300 回合） */
function playUntilFinished(state: GameState): GameState {
  let next = structuredClone(state);
  for (let round = 0; round < 300; round += 1) {
    const session = next.debateSession;
    if (!session || session.status !== 'ongoing') break;
    const card = session.p1.cards[0];
    if (!card) break;
    const after = resolveDebateRound(next, card.uid);
    if (after === next) break; // 无进展保护
    next = after;
  }
  return next;
}

describe('舌战系统（移植小程序引擎）', () => {
  it('登庸命令触发舌战会话并扣除500金，武将本旬不可再行动', () => {
    const state = createGame('cao', seedWhereCaoDebatesWan());
    const wan = state.cities.wan;
    wan.gold = 2000;
    const injectTarget = injectUnaffiliated(state, 'wan');

    const command = { type: 'talent' as const, cityId: 'wan' as CityId, officerId: 'cao-cao', targetOfficerId: injectTarget.id };
    expect(validateCommand(state, 'cao', command)).toEqual([]);
    const next = executeCommand(state, 'cao', command);

    const session = next.debateSession;
    expect(session).toBeTruthy();
    expect(session?.status).toBe('ongoing');
    expect(session?.recruiterId).toBe('cao-cao');
    expect(session?.p1.hp).toBe(DEBATE_STARTING_HP);
    expect(session?.p2.hp).toBe(DEBATE_STARTING_HP);
    expect(TYPE_NAMES[session?.currentTopic ?? 'story']).toBeTruthy();
    expect(next.cities.wan.gold).toBe(1500);
    expect(next.officers['cao-cao'].acted).toBe(true);
  });

  it('初始手牌：双方按智力决定张数，话题牌覆盖三类且技能不重复', () => {
    const state = createGame('cao', 1);
    const cao = state.officers['cao-cao'];
    const target = injectUnaffiliated(state, 'wan');
    const session = createDebate(state, cao, target);

    // 手牌数只按智力：曹操智力 91 → 5 张
    expect(session.p1.power).toBe(cao.stats.intelligence);
    expect(session.p1.cards).toHaveLength(getHandSize(session.p1.power));
    expect(session.p2.cards).toHaveLength(getHandSize(session.p2.power));
    // 每类话题至少一张打底
    for (const topic of ['story', 'reason', 'past'] as const) {
      expect(session.p1.cards.some((card) => card.type === 'topic' && card.topic === topic)).toBe(true);
    }
    // 话术至多 2 张且不重复
    const skills = session.p1.cards.filter((card) => card.type === 'skill');
    expect(skills.length).toBeLessThanOrEqual(2);
    expect(new Set(skills.map((card) => card.id)).size).toBe(skills.length);
    // 手牌排序：话题在前、话术在后
    const firstSkillIndex = session.p1.cards.findIndex((card) => card.type === 'skill');
    if (firstSkillIndex !== -1) {
      expect(session.p1.cards.slice(firstSkillIndex).every((card) => card.type === 'skill')).toBe(true);
    }
  });

  it('判定规则：当前话题压过非当前话题；同级大>中>小；无视压过话题牌', () => {
    const topic = 'story';
    const storyBig = { uid: 'a', type: 'topic' as const, topic: 'story' as const, tier: 'big' as const, id: 'story-big', name: '故事 大' };
    const reasonBig = { uid: 'b', type: 'topic' as const, topic: 'reason' as const, tier: 'big' as const, id: 'reason-big', name: '道理 大' };
    const storyMid = { uid: 'c', type: 'topic' as const, topic: 'story' as const, tier: 'mid' as const, id: 'story-mid', name: '故事 中' };
    const ignore = { uid: 'd', type: 'skill' as const, skill: 'ignore' as const, id: 'ignore', name: '无视', priority: 6 };

    expect(judgeRound(storyBig, reasonBig, topic).winner).toBe('a');
    expect(judgeRound(storyBig, storyMid, topic).winner).toBe('a');
    expect(judgeRound(storyMid, storyBig, topic).winner).toBe('b');
    expect(judgeRound(ignore, storyBig, topic).winner).toBe('a');
    expect(judgeRound(reasonBig, storyBig, topic).winner).toBe('b');
  });

  it('双方都出无视打成平手：双方同时涨 8 点怒气', () => {
    const state = createGame('cao', 1);
    const cao = state.officers['cao-cao'];
    const target = injectUnaffiliated(state, 'wan');
    state.debateSession = createDebate(state, cao, target);
    const session = state.debateSession;
    if (!session) return;

    // 双方手牌各只有一张「无视」，AI 后手响应必然也出无视 → 平局
    // （先标记对方已用思考，避免 aiShouldRethink 因"全话术"触发重抽打乱手牌）
    const ignoreP1: DebateCard = { uid: 'ig-p1', type: 'skill', skill: 'ignore', id: 'ignore', name: '无视', desc: '使对方牌无效化', priority: 6 };
    const ignoreP2: DebateCard = { uid: 'ig-p2', type: 'skill', skill: 'ignore', id: 'ignore', name: '无视', desc: '使对方牌无效化', priority: 6 };
    session.p1.cards = [ignoreP1];
    session.p2.cards = [ignoreP2];
    session.p2.rethinkUsed = true;

    const angerP1Before = session.p1.anger;
    const angerP2Before = session.p2.anger;

    const next = resolveDebateRound(state, 'ig-p1');
    const after = next.debateSession;
    expect(after).toBeTruthy();
    if (!after) return;
    expect(after.lastRound?.winner).toBe('draw');
    expect(after.p1.anger).toBe(Math.min(100, angerP1Before + 8));
    expect(after.p2.anger).toBe(Math.min(100, angerP2Before + 8));
  });

  it('出一张牌后结算一回合：日志新增、手牌补满、演出记录完整', () => {
    const state = createGame('cao', 1);
    const cao = state.officers['cao-cao'];
    const target = injectUnaffiliated(state, 'wan');
    state.debateSession = createDebate(state, cao, target);

    const session = state.debateSession;
    const beforeHandSize = session.p1.cards.length;
    const next = resolveDebateRound(state, session.p1.cards[0].uid);

    const after = next.debateSession;
    expect(after).toBeTruthy();
    if (!after) return;
    expect(after.log.length).toBeGreaterThan(0);
    expect(after.lastRound).toBeTruthy();
    expect(after.lastRound?.p1Card.uid).toBe(session.p1.cards[0].uid);
    expect(after.lastRound?.p2Card).toBeTruthy();
    if (after.status === 'ongoing') {
      expect(after.p1.cards.length).toBeGreaterThanOrEqual(beforeHandSize - 1);
      expect(after.p1.cards.length).toBe(getHandSize(after.p1.power));
      expect(after.p2.cards.length).toBeGreaterThan(0);
    }
  });

  it('AI 胜出获得下回合先手：firstCard 挂起供玩家响应', () => {
    const state = createGame('cao', 1);
    const cao = state.officers['cao-cao'];
    const target = injectUnaffiliated(state, 'wan');
    state.debateSession = createDebate(state, cao, target);

    let next = structuredClone(state);
    for (let round = 0; round < 60; round += 1) {
      const session = next.debateSession;
      if (!session || session.status !== 'ongoing') break;
      if (session.firstPlayer === 2 && session.firstCard) {
        // AI 先手挂起：验证预览数据存在后玩家响应
        expect(session.firstCard).toBeTruthy();
      }
      const card = session.p1.cards[0];
      if (!card) break;
      const after = resolveDebateRound(next, card.uid);
      if (after === next) break;
      next = after;
    }
    expect(next.debateSession?.log.length).toBeGreaterThan(0);
  });

  it('思考重抽一手牌并标记已用（整局一次）', () => {
    const state = createGame('cao', 1);
    const cao = state.officers['cao-cao'];
    const target = injectUnaffiliated(state, 'wan');
    state.debateSession = createDebate(state, cao, target);

    const next = resolveDebateRethink(state);
    expect(next.debateSession?.p1.rethinkUsed).toBe(true);
    expect(next.debateSession?.p1.cards.length).toBeGreaterThan(0);
    expect(next.debateSession?.p1.cards.every((card) => card.isNew)).toBe(true);

    // 二次思考被忽略
    const again = resolveDebateRethink(next);
    expect(again.debateSession?.p1.cards).toEqual(next.debateSession?.p1.cards);
  });

  it('对方小心性格激愤爆发掉血跨过 75 阈值后返还思考机会', () => {
    const state = createGame('cao', 1);
    const cao = state.officers['cao-cao'];
    const target = injectUnaffiliated(state, 'wan');
    state.debateSession = createDebate(state, cao, target);
    const session = state.debateSession;
    if (!session) return;

    // 己方：80 血（仅低于 75 阈值触发返还），且已用掉整局一次的思考
    session.p1.hp = 80;
    session.p1.rethinkUsed = true;
    session.p1.rethinkResets = 0;
    // 对方：小心性格，怒气压到 92；本回合当败方恰好在怒气达到 100 时触怒。
    // 战力压到 1，使其对战我方胜出时的爆发伤害基数钳制到 8（小心爆发按序连打、伤害可控）
    session.p2.trait = '小心';
    session.p2.power = 1;
    session.p2.anger = 92;
    session.p2.rethinkUsed = true; // 封死 AI 重抽
    session.currentTopic = 'story';
    session.p1.cards = [
      { uid: 'p1-story-mid', type: 'topic', topic: 'story', tier: 'mid', id: 'story-mid', name: '故事 中' },
    ];
    session.p2.cards = [
      { uid: 'p2-past-sm-1', type: 'topic', topic: 'past', tier: 'sm', id: 'past-sm', name: '过去 小' },
      { uid: 'p2-past-sm-2', type: 'topic', topic: 'past', tier: 'sm', id: 'past-sm', name: '过去 小' },
      { uid: 'p2-past-sm-3', type: 'topic', topic: 'past', tier: 'sm', id: 'past-sm', name: '过去 小' },
    ];

    // 我方以切合话题的中牌胜出（对己身无伤害，怒气对方+20 触怒）；对方小心爆发连打两牌 80→72 跨过 75
    const next = resolveDebateRound(state, 'p1-story-mid');
    const after = next.debateSession;
    expect(after).toBeTruthy();
    if (!after) return;
    expect(after.p1.hp).toBe(72);
    expect(after.p1.rethinkUsed).toBe(false);
    expect(after.p1.rethinkResets).toBe(1);
  });

  it('进行中的舌战不可关闭（dismiss 被忽略）', () => {
    const state = createGame('cao', 1);
    const cao = state.officers['cao-cao'];
    const target = injectUnaffiliated(state, 'wan');
    state.debateSession = createDebate(state, cao, target);

    const next = dismissDebate(state);
    expect(next.debateSession).toBeTruthy();
  });

  it('中途退出判负：目标进入禁仕期且会话结束', () => {
    const state = createGame('cao', 1);
    const cao = state.officers['cao-cao'];
    const target = injectUnaffiliated(state, 'wan');
    state.debateSession = createDebate(state, cao, target);

    const next = resolveDebateAbandon(state);
    expect(next.debateSession?.status).toBe('finished');
    expect(next.debateSession?.winner).toBe('target');
    expect(next.officers[target.id].bannedUntilMonth).toBeGreaterThanOrEqual(next.month);

    const after = dismissDebate(next);
    expect(after.debateSession).toBeNull();
  });

  it('舌战终局：一方血量归零即结束，获胜登庸 / 失利禁仕', () => {
    const state = createGame('cao', 1);
    const cao = state.officers['cao-cao'];
    const target = injectUnaffiliated(state, 'wan');
    state.debateSession = createDebate(state, cao, target);
    state.debateSession.p1.hp = 1;

    const next = playUntilFinished(state);
    const session = next.debateSession;
    expect(session?.status).toBe('finished');
    if (!session) return;
    expect(session.p1.hp <= 0 || session.p2.hp <= 0).toBe(true);
    if (session.winner === 'recruiter') {
      expect(next.officers[target.id].forceId).toBe('cao');
      expect(next.officers[target.id].location.kind).toBe('city');
    } else {
      expect(next.officers[target.id].bannedUntilMonth).toBeGreaterThanOrEqual(next.month);
    }
  });

  it('舌战获胜登庸后，新加入武将标记为已行动（本旬不可再行动、下一旬才可行动）', () => {
    const state = createGame('cao', 1);
    const cao = state.officers['cao-cao'];
    const target = injectUnaffiliated(state, 'wan');
    state.debateSession = createDebate(state, cao, target);
    const session = state.debateSession;
    if (!session) return;
    // 构造必败目标：当前话题 story，我方「故事 大」直接命中话题，对方只有一张「道理 小」，一击致胜
    session.currentTopic = 'story';
    session.p1.cards = [{ uid: 't-big', type: 'topic', topic: 'story', tier: 'big', id: 'story-big', name: '故事 大' }];
    session.p2.cards = [{ uid: 't-sm', type: 'topic', topic: 'reason', tier: 'sm', id: 'reason-sm', name: '道理 小' }];
    session.p2.rethinkUsed = true; // 封死 AI 重抽，保证必出「道理 小」
    session.p2.hp = 1;

    const next = resolveDebateRound(state, 't-big');
    expect(next.debateSession?.status).toBe('finished');
    expect(next.debateSession?.winner).toBe('recruiter');
    // 目标被登用
    expect(next.officers[target.id].forceId).toBe('cao');
    expect(next.officers[target.id].location.kind).toBe('city');
    // 新加入武将本旬已行动，不能再次执行指令
    expect(next.officers[target.id].acted).toBe(true);
  });

  it('舌战获胜登庸后，新加入武将迁往我方执行城池而非留在对方城池', () => {
    const state = createGame('cao', 1);
    const cao = state.officers['cao-cao'];
    // 目标为别城（江陵，刘备主城）的在野武将，我方在宛执行登庸
    const target = injectUnaffiliated(state, 'jiangling');
    state.debateSession = createDebate(state, cao, target);
    const session = state.debateSession;
    if (!session) return;
    const recruiterCityId = (cao.location as { cityId: CityId }).cityId;
    expect(recruiterCityId).toBe('wan'); // 前提：目标与我方执行城不同城
    session.currentTopic = 'story';
    session.p1.cards = [{ uid: 't-big', type: 'topic', topic: 'story', tier: 'big', id: 'story-big', name: '故事 大' }];
    session.p2.cards = [{ uid: 't-sm', type: 'topic', topic: 'reason', tier: 'sm', id: 'reason-sm', name: '道理 小' }];
    session.p2.rethinkUsed = true; // 封死 AI 重抽，保证必出「道理 小」
    session.p2.hp = 1;

    const next = resolveDebateRound(state, 't-big');
    expect(next.debateSession?.winner).toBe('recruiter');
    const joined = next.officers[target.id];
    expect(joined.forceId).toBe('cao');
    // location 与 cityId 都应落到我方执行城（城内武将列表按 cityId 展示）
    expect(joined.location).toEqual({ kind: 'city', cityId: recruiterCityId });
    expect(joined.cityId).toBe(recruiterCityId);
    const inCity = Object.values(next.officers).filter(
      (o) => o.forceId === 'cao' && o.cityId === recruiterCityId,
    );
    expect(inCity.some((o) => o.id === target.id)).toBe(true);
  });

  it('怒气满触发性格激愤并按形态结算', () => {
    const state = createGame('cao', 1);
    const cao = state.officers['cao-cao'];
    const target = injectUnaffiliated(state, 'wan');
    const session = createDebate(state, cao, target);
    // 目标冷静：激愤 3 回合、伤害翻倍
    session.p2.trait = '冷静';
    session.p2.anger = 100;
    session.p2.hp = 40;
    session.p1.cards.forEach((card) => { card.isNew = false; });
    session.p1.cards = session.p1.cards.filter((card) => card.type === 'topic').slice(0, 1);
    if (!session.p1.cards.length) session.p1.cards = [{ uid: 'test-t1', type: 'topic', topic: 'story', tier: 'big', id: 'story-big', name: '故事 大' }];

    state.debateSession = session;
    const next = resolveDebateRound(state, session.p1.cards[0].uid);
    const after = next.debateSession;
    if (!after) return;
    if (after.status === 'ongoing' && after.p2.anger >= 100) {
      // 怒气已满且结算后仍挂激愤或已触发爆发
      expect(after.p2.furyRounds).toBeGreaterThan(0);
      expect(after.p2.furyJustActivated).toBe(true);
    }
  });

  it('对手手牌遮罩：话题显示话题名、话术显示「话术」', () => {
    const masked = maskOpponentHand([
      { uid: '1', type: 'topic', topic: 'story', tier: 'big', id: 'story-big', name: '故事 大' },
      { uid: '2', type: 'skill', skill: 'ignore', id: 'ignore', name: '无视' },
    ]);
    expect(masked[0].displayName).toBe('故事');
    expect(masked[1].displayName).toBe('话术');
  });

  it('性格映射：武将性格 → 激愤形态；无性格按最高五维推定', () => {
    const base = { id: 'x', name: 'x', forceId: null, cityId: 'wan' as never, location: { kind: 'unaffiliated' as const, cityId: 'wan' as never }, acted: false };
    expect(officerTrait({ ...base, personality: 'reckless', stats: { leadership: 50, war: 50, intelligence: 50, politics: 50, charisma: 50 } })).toBe('莽撞');
    expect(officerTrait({ ...base, personality: 'bold', stats: { leadership: 50, war: 50, intelligence: 50, politics: 50, charisma: 50 } })).toBe('刚胆');
    expect(officerTrait({ ...base, personality: 'calm', stats: { leadership: 50, war: 50, intelligence: 50, politics: 50, charisma: 50 } })).toBe('冷静');
    expect(officerTrait({ ...base, personality: 'timid', stats: { leadership: 50, war: 50, intelligence: 50, politics: 50, charisma: 50 } })).toBe('小心');
    expect(officerTrait({ ...base, stats: { leadership: 50, war: 60, intelligence: 70, politics: 40, charisma: 30 } })).toBe('冷静');
    expect(officerTrait({ ...base, stats: { leadership: 50, war: 80, intelligence: 70, politics: 40, charisma: 30 } })).toBe('莽撞');
    expect(officerTrait({ ...base, stats: { leadership: 90, war: 80, intelligence: 70, politics: 40, charisma: 30 } })).toBe('刚胆');
    expect(officerTrait({ ...base, stats: { leadership: 30, war: 20, intelligence: 40, politics: 45, charisma: 35 } })).toBe('小心');
  });

  it('手牌数阈值：智力 100/90/80 对应 6/5/4/3 张', () => {
    expect(getHandSize(120)).toBe(6);
    expect(getHandSize(100)).toBe(6);
    expect(getHandSize(99)).toBe(5);
    expect(getHandSize(90)).toBe(5);
    expect(getHandSize(89)).toBe(4);
    expect(getHandSize(80)).toBe(4);
    expect(getHandSize(79)).toBe(3);
    expect(getHandSize(40)).toBe(3);
  });

  it('话术定义完整（无视/大喝一声/强词夺理/镇静/愤怒）', () => {
    expect(SKILLS.map((skill) => skill.id)).toEqual(['ignore', 'shout', 'sophistry', 'calm', 'riseup']);
  });

  it('autoResolveDebate：双方 AI 演算至终局并完成登庸/禁仕结算', () => {
    const state = createGame('cao', 1);
    const cao = state.officers['cao-cao'];
    const target = injectUnaffiliated(state, 'wan');
    state.debateSession = createDebate(state, cao, target);

    const next = autoResolveDebate(state);
    const session = next.debateSession;
    expect(session?.status).toBe('finished');
    if (!session) return;
    expect(session.p1.hp <= 0 || session.p2.hp <= 0).toBe(true);
    const settled = next.officers[target.id];
    if (session.winner === 'recruiter') {
      expect(settled.forceId).toBe('cao');
    } else {
      expect(settled.bannedUntilMonth).toBeGreaterThanOrEqual(next.month);
    }
  });

  it('AI 势力的登庸在其回合内结算完毕（舌战自动演算或直接判定），不遗留进行中会话', () => {
    const state = createGame('cao', 1);
    const target = injectUnaffiliated(state, 'jiangling'); // 江陵属刘备（AI）
    // 填满江陵地块阻断建设；资金压到600阻断征兵（需≥800）但放行登庸（需≥500），迫使AI执行登庸
    const jiangling = state.cities.jiangling;
    jiangling.plots = Array(12).fill(null).map((_, i) => ({
      id: `plot-${i}`, type: 'market', level: 1, value: 100,
    }));
    jiangling.gold = 600;
    const next = runAiTurn(structuredClone(state), 'liu');

    // AI 确实尝试了登庸（日志含目标名；可能走舌战，也可能按成功率直接判定）
    expect(next.logs.some((log) => log.message.includes(target.name))).toBe(true);
    // 会话不遗留：舌战自动结算后即被清除
    expect(next.debateSession).toBeNull();
    // 结算生效：登庸成功 / 舌战败禁仕 / 直接判定失败（不禁仕、下月可再试）
    const settled = next.officers[target.id];
    expect(
      settled.forceId === 'liu'
      || (settled.bannedUntilMonth ?? 0) > next.month
      || next.logs.some((log) => log.message.includes('无意出仕')),
    ).toBe(true);
  });
});
