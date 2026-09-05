export {
  deploymentCells,
  movementCells,
  unitIsIncapacitated,
} from './movementRules';
export { movementAllowanceForProfile, movementAllowanceForUnit } from './catalog';
export type { MovementProfile } from './catalog';

import type { ForceId, GameState } from '../types';
import { applyGroundFireDamageToUnit } from './fire';
import { gridKey, type GridCoord } from './grid';
import { isLegalUnitCell, ownCityAt, reachableCosts } from './movementRules';
import { assertUnitTurn } from './shared';
import { cityTroopCap } from '../innerAffairs';

export function moveUnit(state: GameState, forceId: ForceId, unitId: string, destination: GridCoord): GameState {
  const unit = assertUnitTurn(state, forceId, unitId);
  if (unit.moved) throw new Error('部队已经移动');
  // 目标格为本方城池格 → 回城（isLegalUnitCell 会拒绝一切城池格，此处放行本方城池）
  const returnCity = ownCityAt(state, forceId, destination);
  if (!returnCity && !isLegalUnitCell(state, destination, unitId)) throw new Error('目标格被占用或不可通行');
  const cost = reachableCosts(state, unit).get(gridKey(destination));
  if (cost === undefined) throw new Error('目标超过移动力');

  const next = structuredClone(state);
  const movingUnit = next.units[unitId];

  if (returnCity) {
    // 回城：兵力/军粮/金钱并入城池，武将回城，部队消失
    const city = next.cities[returnCity.id];
    city.troops = Math.min(cityTroopCap(city), city.troops + movingUnit.troops);
    city.food += movingUnit.food;
    if (movingUnit.gold) city.gold += movingUnit.gold;
    const officerIds = movingUnit.officerIds ?? [movingUnit.leaderId];
    delete next.units[unitId];
    for (const officerId of officerIds) {
      const officer = next.officers[officerId];
      if (!officer) continue;
      officer.location = { kind: 'city', cityId: city.id };
      officer.cityId = city.id;
      officer.acted = true;
    }
    next.logs ??= [];
    next.logs.push({
      id: `return-${next.month}-${next.tenDay}-${unitId}-${next.logs.length}`,
      month: next.month,
      forceId,
      message: `${next.officers[movingUnit.leaderId]?.name ?? '部队'}率军返回${city.name}。`,
    });
  } else {
    movingUnit.q = destination.q;
    movingUnit.r = destination.r;
    movingUnit.movementRemaining = 0;
    movingUnit.moved = true;
  }
  next.battleDamageReports = [];
  next.cityEffectReports = [];
  next.facilityRepairReports = [];
  next.strategyResultReports = [];
  applyGroundFireDamageToUnit(next, unitId, 'move-fire');
  return next;
}

export function waitUnit(state: GameState, forceId: ForceId, unitId: string): GameState {
  assertUnitTurn(state, forceId, unitId);
  const next = structuredClone(state);
  next.units[unitId].acted = true;
  next.facilityRepairReports = [];
  next.strategyResultReports = [];
  return next;
}
