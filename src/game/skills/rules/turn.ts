import { settleBattleFacilities } from '../../battle/actions';
import type { ForceId, GameState } from '../../types';
import { resolveUnitSkills } from '../sources';
import { effectsOfKind } from '../stacking';

export function applyForceTurnStartSkillEffects(state: GameState, forceId: ForceId) {
  for (const unit of Object.values(state.units)) {
    if (unit.forceId !== forceId) continue;
    const recovery = effectsOfKind(resolveUnitSkills(state, unit), 'turnStartEnergy')
      .reduce((highest, { effect }) => Math.max(highest, effect.add), 0);
    unit.energy = Math.min(100, unit.energy + recovery);
  }
}

export function settleForceTurnStart(next: GameState, activeForceId: ForceId) {
  settleBattleFacilities(next, activeForceId);
  applyForceTurnStartSkillEffects(next, activeForceId);
}
