import type { ArmyUnit, GameState } from '../types';
import { effectiveUnitAbilities } from './officerAbilities';
import { gridDistanceWithin } from './targetRules';

/** 光环范围内（含自身）攻击伤害 ×1.05 */
export const AURA_ATTACK_MULTIPLIER = 1.05;
/** 光环范围内（含自身）受到伤害 ×0.95 */
export const AURA_DEFENSE_MULTIPLIER = 0.95;

/** 主将统率 → 光环范围（格）：90+→1、96+→2、100+→3，未达标为 0（无光环） */
export function auraRangeForLeadership(leadership: number): number {
  if (leadership >= 100) return 3;
  if (leadership >= 96) return 2;
  if (leadership >= 90) return 1;
  return 0;
}

/** 部队主将统率决定的光环范围（0 = 无光环；输送队无光环） */
export function unitAuraRange(state: GameState, unit: ArmyUnit): number {
  if (unit.kind === 'transport') return 0;
  return auraRangeForLeadership(effectiveUnitAbilities(state, unit).leadership.value);
}

/** 部队是否处于任一同势力部队的光环范围内（含自身光环） */
export function unitUnderAura(state: GameState, unit: ArmyUnit): boolean {
  for (const other of Object.values(state.units)) {
    if (other.forceId !== unit.forceId) continue;
    const range = unitAuraRange(state, other);
    if (range <= 0) continue;
    if (gridDistanceWithin({ q: other.q, r: other.r }, { q: unit.q, r: unit.r }, range) <= range) return true;
  }
  return false;
}
