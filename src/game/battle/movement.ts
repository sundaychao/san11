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
import { isLegalUnitCell, reachableCosts } from './movementRules';
import { assertUnitTurn } from './shared';

export function moveUnit(state: GameState, forceId: ForceId, unitId: string, destination: GridCoord): GameState {
  const unit = assertUnitTurn(state, forceId, unitId);
  if (unit.moved) throw new Error('部队已经移动');
  if (!isLegalUnitCell(state, destination, unitId)) throw new Error('目标格被占用或不可通行');
  const cost = reachableCosts(state, unit).get(gridKey(destination));
  if (cost === undefined) throw new Error('目标超过移动力');

  const next = structuredClone(state);
  next.units[unitId].q = destination.q;
  next.units[unitId].r = destination.r;
  next.units[unitId].movementRemaining = 0;
  next.units[unitId].moved = true;
  next.battleDamageReports = [];
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
