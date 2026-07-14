import { describe, expect, it } from 'vitest';
import { createGame } from './scenario/jingxiang208';
import { settleMonth } from './turn';

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
