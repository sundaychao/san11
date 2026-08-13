export {
  deploymentCells,
  movementAllowanceForProfile,
  movementAllowanceForUnit,
  movementCells,
  unitIsIncapacitated,
} from './legacyCore';
export type { MovementProfile } from './legacyCore';

import type { ForceId, GameState } from '../types';
import { gridKey, type GridCoord } from './grid';
import { assertUnitTurn, isLegalUnitCell, reachableCosts } from './shared';

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
