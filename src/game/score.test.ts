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

  it('gives every force the same rank in a four-way tie', () => {
    const state = createGame('liu', 1);
    for (const city of Object.values(state.cities)) {
      Object.assign(city, { gold: 5000, food: 20000, population: 90000, troops: 10000, commerce: 50, agriculture: 50, order: 80, training: 70 });
    }
    for (const officer of Object.values(state.officers)) {
      if (officer.forceId) Object.assign(officer.stats, { leadership: 70, war: 70, intelligence: 70, politics: 70, charisma: 70 });
    }

    expect(rankForces(state).map((row) => row.rank)).toEqual([1, 1, 1, 1]);
  });
});
