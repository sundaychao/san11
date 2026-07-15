import { describe, expect, it } from 'vitest';
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
});
