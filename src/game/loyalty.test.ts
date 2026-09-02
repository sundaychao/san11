import { describe, expect, it } from 'vitest';
import { executeCommand, validateCommand } from './commands';
import { DEFAULT_OFFICER_LOYALTY, LEADER_INITIAL_LOYALTY, LOYALTY_MAX, settleLoyaltyDrift } from './loyalty';
import { createGame } from './scenario/jingxiang208';

describe('忠诚度系统', () => {
  it('初始忠诚：君主100、在城武将默认92、在野0', () => {
    const state = createGame('cao');
    const cao = state.officers['cao-cao'];
    const xunYu = state.officers['xun-yu'];
    expect(cao.loyalty).toBe(LEADER_INITIAL_LOYALTY);
    expect(xunYu.loyalty).toBe(DEFAULT_OFFICER_LOYALTY);
    const bonus = Object.values(state.officers).find((o) => o.forceId === null);
    expect(bonus?.loyalty ?? 0).toBe(0);
  });

  it('褒奖：忠诚+2并扣除100金与5行动力，武将本旬不可再行动', () => {
    const state = createGame('cao');
    const xunYu = state.officers['xun-yu'];
    const city = state.cities[xunYu.cityId];
    city.gold = 1000;
    state.actionPoints.cao = 60;
    const beforeLoyalty = xunYu.loyalty ?? DEFAULT_OFFICER_LOYALTY;

    const command = { type: 'reward' as const, cityId: xunYu.cityId, officerId: xunYu.id };
    expect(validateCommand(state, 'cao', command)).toEqual([]);
    const next = executeCommand(state, 'cao', command);

    const after = next.officers[xunYu.id];
    expect(after.loyalty).toBe(beforeLoyalty + 2);
    expect(next.cities[xunYu.cityId].gold).toBe(900);
    expect(next.actionPoints.cao).toBe(55);
    expect(after.acted).toBe(true);
  });

  it('忠诚上限127封顶', () => {
    const state = createGame('cao');
    const xunYu = state.officers['xun-yu'];
    xunYu.loyalty = LOYALTY_MAX - 1;
    state.actionPoints.cao = 60;
    const next = executeCommand(state, 'cao', { type: 'reward', cityId: xunYu.cityId, officerId: xunYu.id });
    expect(next.officers[xunYu.id].loyalty).toBe(LOYALTY_MAX);
  });

  it('季初高义理低野望武将不降忠诚，忠诚不低于0', () => {
    const state = createGame('cao');
    const guanYu = state.officers['guan-yu'];
    guanYu.forceId = 'cao';
    guanYu.loyalty = 1;
    guanYu.righteousness = 90;
    guanYu.ambition = 20;
    state.month = 1;
    settleLoyaltyDrift(state);
    expect(guanYu.loyalty).toBe(1);
    expect(guanYu.loyalty).toBeGreaterThanOrEqual(0);
  });
});