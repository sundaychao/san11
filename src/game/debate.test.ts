import { describe, expect, it } from 'vitest';
import {
  cardLabel,
  createDebate,
  DEBATE_MAX_HP,
  dismissDebate,
  drawHand,
  handSizeFor,
  resolveDebateRethink,
  resolveDebateRound,
  TOPIC_LABELS_ZH,
} from './debate';
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
  state.officers[officer.id] = officer;
  return officer;
}

describe('舌战系统', () => {
  it('登庸命令触发舌战会话并扣除500金，武将本旬不可再行动', () => {
    const state = createGame('cao', 1);
    const wan = state.cities.wan;
    wan.gold = 2000;
    injectUnaffiliated(state, 'wan');

    const command = { type: 'talent' as const, cityId: 'wan' as CityId, officerId: 'cao-cao' };
    expect(validateCommand(state, 'cao', command)).toEqual([]);
    const next = executeCommand(state, 'cao', command);

    const session = next.debateSession;
    expect(session).toBeTruthy();
    expect(session?.status).toBe('ongoing');
    expect(session?.recruiterId).toBe('cao-cao');
    expect(session?.recruiterHp).toBe(DEBATE_MAX_HP);
    expect(session?.targetHp).toBe(DEBATE_MAX_HP);
    expect(TOPIC_LABELS_ZH[session?.topic ?? 'story']).toBeTruthy();
    expect(next.cities.wan.gold).toBe(1500);
    expect(next.officers['cao-cao'].acted).toBe(true);
  });

  it('手牌数与智力匹配，且至少包含一张话题卡', () => {
    const state = createGame('cao', 1);
    const cao = state.officers['cao-cao']; // 智力91 → 6张
    const hand = drawHand(state, cao);
    expect(hand.length).toBe(handSizeFor(cao.stats.intelligence));
    expect(hand.some((card) => card.kind === 'topic')).toBe(true);
    expect(hand.every((card) => cardLabel(card).length > 0)).toBe(true);
  });

  it('出一张牌后结算一回合：日志新增、手牌重新补满、再考标记复位', () => {
    const state = createGame('cao', 1);
    const cao = state.officers['cao-cao'];
    const target = injectUnaffiliated(state, 'wan');
    state.debateSession = createDebate(state, cao, target);

    const beforeHandCount = state.debateSession.recruiterHand.length;
    const next = resolveDebateRound(state, 0);

    const session = next.debateSession;
    expect(session).toBeTruthy();
    if (!session) return;
    expect(session.logs.length).toBeGreaterThan(0);
    // 未结束时双方手牌补满继续
    if (session.status === 'ongoing') {
      expect(session.recruiterHand.length).toBe(beforeHandCount);
      expect(session.targetHand.length).toBeGreaterThan(0);
      expect(session.recruiterRethinkUsed).toBe(false);
    }
  });

  it('再考重抽一手牌并标记本回合已用', () => {
    const state = createGame('cao', 1);
    const cao = state.officers['cao-cao'];
    const target = injectUnaffiliated(state, 'wan');
    state.debateSession = createDebate(state, cao, target);

    const next = resolveDebateRethink(state);
    expect(next.debateSession?.recruiterRethinkUsed).toBe(true);
    expect(next.debateSession?.recruiterHand.length).toBeGreaterThan(0);
  });

  it('进行中的舌战不可关闭（dismiss 被忽略）', () => {
    const state = createGame('cao', 1);
    const cao = state.officers['cao-cao'];
    const target = injectUnaffiliated(state, 'wan');
    state.debateSession = createDebate(state, cao, target);

    const next = dismissDebate(state);
    expect(next.debateSession).toBeTruthy();
  });

  it('舌战终局结算：玩家心理值归零即告失利，目标进入禁仕期', () => {
    const state = createGame('cao', 1);
    const cao = state.officers['cao-cao'];
    const target = injectUnaffiliated(state, 'wan');
    state.debateSession = createDebate(state, cao, target);
    state.debateSession.recruiterHp = 1;

    // 反复出第一张牌直到分出胜负
    let next = structuredClone(state);
    for (let round = 0; round < 100 && next.debateSession?.status === 'ongoing'; round += 1) {
      next = resolveDebateRound(next, 0);
    }
    const session = next.debateSession;
    expect(session?.status).toBe('finished');
    if (!session) return;
    // 玩家失利或平局 → 目标禁仕；获胜 → 目标加入
    if (session.winner === 'recruiter') {
      expect(next.officers[target.id].forceId).toBe('cao');
    } else {
      expect(next.officers[target.id].bannedUntilMonth).toBeGreaterThanOrEqual(next.month);
    }
  });

  it('舌战结束后可关闭并清空会话', () => {
    const state = createGame('cao', 1);
    const cao = state.officers['cao-cao'];
    const target = injectUnaffiliated(state, 'wan');
    state.debateSession = createDebate(state, cao, target);
    state.debateSession.targetHp = 1;

    let next = structuredClone(state);
    for (let round = 0; round < 100 && next.debateSession?.status === 'ongoing'; round += 1) {
      next = resolveDebateRound(next, 0);
    }
    expect(next.debateSession?.status).toBe('finished');

    const after = dismissDebate(next);
    expect(after.debateSession).toBeNull();
  });
});