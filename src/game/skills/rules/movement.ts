import type { ArmyUnit, GameState, TroopType } from '../../types';
import { resolveOfficerSkills, resolveUnitSkills } from '../sources';
import { effectsOfKind } from '../stacking';

export function movementAllowanceBonus(state: GameState, unit: ArmyUnit) {
  return effectsOfKind(resolveUnitSkills(state, unit), 'movementAllowance')
    .filter(({ effect }) => (
      unit.kind !== 'transport' &&
      (!effect.troopTypes || effect.troopTypes.includes(unit.troopType ?? 'sword'))
    ))
    .reduce((sum, { effect }) => sum + effect.add, 0);
}

export function formationMovementAllowanceBonus(
  state: GameState,
  officerIds: string[],
  troopType: TroopType,
  kind: 'combat' | 'transport' = 'combat',
) {
  return effectsOfKind(resolveOfficerSkills(state, officerIds), 'movementAllowance')
    .filter(({ effect }) => (
      kind !== 'transport' &&
      (!effect.troopTypes || effect.troopTypes.includes(troopType))
    ))
    .reduce((sum, { effect }) => sum + effect.add, 0);
}

export function unitIgnoresEnemyZoc(state: GameState, unit: ArmyUnit) {
  return effectsOfKind(resolveUnitSkills(state, unit), 'ignoreEnemyZoc')
    .some(({ effect }) => effect.terrain === 'land');
}
