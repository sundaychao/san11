import { describe, expect, it } from 'vitest';
import { createGame, FORCE_IDS } from './scenario/jingxiang208';
import { rankForces, scoreForce } from './score';

describe('force scoring', () => {
  it('keeps initial scores within five percent', () => {
    const state = createGame('liu', 1);
    const scores = FORCE_IDS.map((forceId) => scoreForce(state, forceId));
    const lowest = Math.min(...scores);

    expect(Math.max(...scores) - lowest).toBeLessThanOrEqual(lowest * 0.05);
  });

  it('ranks all forces from highest score to lowest', () => {
    const state = createGame('liu', 1);
    state.cities.jiangling.gold += 100000;

    const rankings = rankForces(state);

    expect(rankings).toHaveLength(4);
    expect(rankings[0].forceId).toBe('liu');
    expect(rankings.map((row) => row.score)).toEqual([...rankings.map((row) => row.score)].sort((a, b) => b - a));
  });

  it('uses total order as the first tie-breaker', () => {
    const state = createGame('liu', 1);
    const baseline = scoreForce(state, 'liu');
    state.cities.jiangling.order = 100;

    expect(scoreForce(state, 'liu')).toBeGreaterThan(baseline);
  });
});
