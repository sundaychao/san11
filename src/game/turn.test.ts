import { describe, expect, it } from 'vitest';
import { executeCommand } from './commands';
import { createGame } from './scenario/jingxiang208';
import { settleMonth, settleTenDay } from './turn';

describe('monthly settlement', () => {
  it('settles revenue and restores monthly actions', () => {
    const state = createGame('liu', 1);
    state.actionPoints.liu = 0;
    state.officers['liu-bei'].acted = true;

    const next = settleMonth(state);

    expect(next.month).toBe(2);
    expect(next.actionPoints.liu).toBe(80);
    expect(next.officers['liu-bei'].acted).toBe(false);
    expect(next.cities.jiangling.gold).toBeGreaterThan(state.cities.jiangling.gold);
    expect(next.cities.jiangling.food).toBeGreaterThan(state.cities.jiangling.food);
    expect(next.cities.jiangling.population).toBeGreaterThan(state.cities.jiangling.population);
  });

  it('replays the same events from the same game state', () => {
    const first = settleMonth(createGame('liu', 20804));
    const second = settleMonth(createGame('liu', 20804));

    expect(first.cities).toEqual(second.cities);
    expect(first.logs).toEqual(second.logs);
    expect(first.rngCursor).toBe(second.rngCursor);
  });

  it('finishes after settling month 24', () => {
    const state = createGame('liu', 1);
    state.month = 24;

    const next = settleMonth(state);

    expect(next.month).toBe(24);
    expect(next.phase).toBe('finished');
  });

  it('does not mutate the previous month', () => {
    const state = createGame('liu', 1);
    const snapshot = structuredClone(state);

    settleMonth(state);

    expect(state).toEqual(snapshot);
  });
});

describe('ten-day settlement', () => {
  it('restores action points each ten-day and carries over half of the unused points', () => {
    const state = createGame('liu', 1);
    state.tenDay = 1;
    state.actionPoints.liu = 60;

    const next = settleTenDay(state);

    expect(next.tenDay).toBe(2);
    expect(next.actionPoints.liu).toBe(110);
  });

  it('carries action points across the month boundary into the next first ten-day', () => {
    const state = createGame('liu', 1);
    state.month = 1;
    state.tenDay = 3;
    state.actionPoints.liu = 40;

    const next = settleTenDay(state);

    expect(next.month).toBe(2);
    expect(next.tenDay).toBe(1);
    expect(next.actionPoints.liu).toBe(100);
  });

  it('advances personnel transfers and arrives after the required ten-days', () => {
    const state = createGame('liu', 1);
    const transferred = executeCommand(state, 'liu', {
      type: 'transfer', cityId: 'jiangling', targetCityId: 'wuling', officerIds: ['guan-yu'],
    });

    const afterOne = settleTenDay(transferred);
    const afterTwo = settleTenDay(afterOne);
    const afterThree = settleTenDay(afterTwo);

    expect(afterOne.officers['guan-yu'].location).toMatchObject({ kind: 'transfer', remainingTenDays: 2 });
    expect(afterTwo.officers['guan-yu'].location).toMatchObject({ kind: 'transfer', remainingTenDays: 1 });
    expect(afterThree.officers['guan-yu'].location).toEqual({ kind: 'city', cityId: 'wuling' });
    expect(afterThree.officers['guan-yu'].cityId).toBe('wuling');
    expect(afterThree.logs.some((log) => log.message.includes('关羽抵达武陵'))).toBe(true);
  });
});
