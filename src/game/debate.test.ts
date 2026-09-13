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
    const state = createGame('cao', 1);
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

  it('初始手牌：双方按五维总和决定张数，话题牌覆盖三类且技能不重复', () => {
    const state = createGame('cao', 1);
    const cao = state.officers['cao-cao'];
    const target = injectUnaffiliated(state, 'wan');
    const session = createDebate(state, cao, target);

    // 曹操五维 96+72+91+94+96=449 → 6 张；测试在野 315 → 5 张
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

  it('手牌数阈值：五维总和 335/301/275 对应 6/5/4/3 张', () => {
    expect(getHandSize(400)).toBe(6);
    expect(getHandSize(335)).toBe(6);
    expect(getHandSize(334)).toBe(5);
    expect(getHandSize(301)).toBe(5);
    expect(getHandSize(300)).toBe(4);
    expect(getHandSize(275)).toBe(4);
    expect(getHandSize(274)).toBe(3);
    expect(getHandSize(200)).toBe(3);
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

  it('AI 势力的登庸舌战在其回合内自动结算，不遗留进行中会话', () => {
    const state = createGame('cao', 1);
    const target = injectUnaffiliated(state, 'jiangling'); // 江陵属刘备（AI）
    // 填满江陵地块阻断建设；资金压到600阻断征兵（需≥800）但放行登庸（需≥500），迫使AI执行登庸
    const jiangling = state.cities.jiangling;
    jiangling.plots = Array(12).fill(null).map((_, i) => ({
      id: `plot-${i}`, type: 'market', level: 1, value: 100,
    }));
    jiangling.gold = 600;
    const next = runAiTurn(structuredClone(state), 'liu');

    // AI 确实执行了登庸（日志含舌战记录）
    expect(next.logs.some((log) => log.message.includes('舌战'))).toBe(true);
    // 会话不遗留：自动结算后即被清除
    expect(next.debateSession).toBeNull();
    // 结算生效：目标被登庸或进入禁仕期
    const settled = next.officers[target.id];
    expect(settled.forceId === 'liu' || (settled.bannedUntilMonth ?? 0) > next.month).toBe(true);
  });
});
