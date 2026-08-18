import type { ArmyUnit, GameState } from '../../types';
import { resolveUnitSkills } from '../sources';
import { effectsOfKind } from '../stacking';

export function facilityBuildPowerMultiplier(state: GameState, unit: ArmyUnit) {
  return effectsOfKind(resolveUnitSkills(state, unit), 'buildPowerMultiplier')
    .reduce((highest, { effect }) => Math.max(highest, effect.multiplier), 1);
}
