import { FORCE_IDS } from './scenario/jingxiang208';
import type { ForceId, ForceRanking, GameState } from './types';

interface TieMetrics {
  order: number;
  gold: number;
  officers: number;
}

function tieMetrics(state: GameState, forceId: ForceId): TieMetrics {
  const cities = Object.values(state.cities).filter((city) => city.ownerId === forceId);
  return {
    order: cities.reduce((sum, city) => sum + city.order, 0),
    gold: cities.reduce((sum, city) => sum + city.gold, 0),
    officers: Object.values(state.officers).filter((officer) => officer.forceId === forceId).length,
  };
}

export function scoreForce(state: GameState, forceId: ForceId) {
  const cityScore = Object.values(state.cities)
    .filter((city) => city.ownerId === forceId)
    .reduce(
      (sum, city) =>
        sum +
        city.commerce * 2 +
        city.agriculture * 2 +
        city.order * 1.5 +
        city.training +
        city.troops / 100 +
        city.gold / 500 +
        city.food / 1000,
      0,
    );
  const officerScore = Object.values(state.officers)
    .filter((officer) => officer.forceId === forceId)
    .reduce(
      (sum, officer) =>
        sum +
        25 +
        (officer.stats.leadership +
          officer.stats.war +
          officer.stats.intelligence +
          officer.stats.politics +
          officer.stats.charisma) /
          25,
      0,
    );
  return Math.round(cityScore + officerScore);
}

export function rankForces(state: GameState): ForceRanking[] {
  const rows = FORCE_IDS.map((forceId) => ({
    forceId,
    name: state.forces[forceId].name,
    score: scoreForce(state, forceId),
    metrics: tieMetrics(state, forceId),
  })).sort((left, right) =>
    right.score - left.score ||
    right.metrics.order - left.metrics.order ||
    right.metrics.gold - left.metrics.gold ||
    right.metrics.officers - left.metrics.officers ||
    FORCE_IDS.indexOf(left.forceId) - FORCE_IDS.indexOf(right.forceId),
  );

  return rows.map((row, index) => {
    const previous = rows[index - 1];
    const tied = Boolean(
      previous &&
        previous.score === row.score &&
        previous.metrics.order === row.metrics.order &&
        previous.metrics.gold === row.metrics.gold &&
        previous.metrics.officers === row.metrics.officers,
    );
    return {
      forceId: row.forceId,
      name: row.name,
      score: row.score,
      rank: tied ? index : index + 1,
      tied,
    };
  });
}
