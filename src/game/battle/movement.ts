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
import { isLegalUnitCell, ownCityAt, reachableCosts, unoccupiedCityAt } from './movementRules';
import { assertUnitTurn } from './shared';
import { appointSuccessorGovernor, cityTroopCap } from '../innerAffairs';
import { TECHP_PER_CITY_CAPTURE, addTechP } from '../techs';

export function moveUnit(state: GameState, forceId: ForceId, unitId: string, destination: GridCoord): GameState {
  const unit = assertUnitTurn(state, forceId, unitId);
  if (unit.moved) throw new Error('部队已经移动');
  // 目标格为本方城池格 → 回城；为无守军无主城格 → 进驻占领（isLegalUnitCell 会拒绝一切城池格，此处放行）
  const returnCity = ownCityAt(state, forceId, destination);
  const occupyCity = returnCity ? undefined : unoccupiedCityAt(state, destination);
  if (!returnCity && !occupyCity && !isLegalUnitCell(state, destination, unitId)) throw new Error('目标格被占用或不可通行');
  const cost = reachableCosts(state, unit).get(gridKey(destination));
  if (cost === undefined) throw new Error('目标超过移动力');

  const next = structuredClone(state);
  const movingUnit = next.units[unitId];

  if (returnCity || occupyCity) {
    const city = next.cities[(returnCity ?? occupyCity)!.id];
    if (occupyCity) {
      // 进驻无主空城：兵不血刃，城池易主（资源保留、耐久不减），获得占领技巧P
      city.ownerId = forceId;
      city.governorId = null;
      addTechP(next, forceId, TECHP_PER_CITY_CAPTURE);
    }
    // 回城：兵力/军粮/金钱并入城池，武将回城，部队消失
    city.troops = Math.min(cityTroopCap(city), city.troops + movingUnit.troops);
    city.food += movingUnit.food;
    if (movingUnit.gold) city.gold += movingUnit.gold;
    const officerIds = movingUnit.officerIds ?? [movingUnit.leaderId];
    delete next.units[unitId];
    // 部队进城武将若仍挂名其他城太守（如出征前未补任的旧档），原城自动补任
    for (const officerId of officerIds) {
      const officer = next.officers[officerId];
      if (!officer) continue;
      const governedCity = Object.values(next.cities).find((candidate) => candidate.governorId === officerId && candidate.id !== city.id);
      if (governedCity) appointSuccessorGovernor(next, governedCity);
    }
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
      message: occupyCity
        ? `${next.officers[movingUnit.leaderId]?.name ?? '部队'}进驻无主的${city.name}，兵不血刃。`
        : `${next.officers[movingUnit.leaderId]?.name ?? '部队'}率军返回${city.name}。`,
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
