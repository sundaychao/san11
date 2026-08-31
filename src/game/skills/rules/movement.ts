import type { ArmyUnit, GameState, TerrainType, TroopType } from '../../types';
import { techLevelOf } from '../../techs';
import { resolveOfficerSkills, resolveUnitSkills } from '../sources';
import { effectsOfKind } from '../stacking';

function isWaterTerrain(terrain: TerrainType | undefined) {
  return terrain === 'water';
}

export function movementAllowanceBonus(state: GameState, unit: ArmyUnit, terrain?: TerrainType) {
  let bonus = effectsOfKind(resolveUnitSkills(state, unit), 'movementAllowance')
    .filter(({ effect }) => (
      unit.kind !== 'transport' &&
      (!effect.troopTypes || effect.troopTypes.includes(unit.troopType ?? 'sword')) &&
      (!effect.waterOnly || isWaterTerrain(terrain))
    ))
    .reduce((sum, { effect }) => sum + effect.add, 0);
  // 科技：兵科4级精锐——对应兵种移动力+6
  if (unit.forceId && unit.kind !== 'transport') {
    const troop = unit.troopType;
    if ((troop === 'spear' || troop === 'halberd' || troop === 'crossbow' || troop === 'cavalry')
      && techLevelOf(state, unit.forceId, troop) >= 4) {
      bonus += 6;
    }
  }
  return bonus;
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
      (!effect.troopTypes || effect.troopTypes.includes(troopType)) &&
      !effect.waterOnly
    ))
    .reduce((sum, { effect }) => sum + effect.add, 0);
}

export function unitIgnoresEnemyZocTerrain(state: GameState, unit: ArmyUnit): 'land' | 'water' | null {
  const terrains = effectsOfKind(resolveUnitSkills(state, unit), 'ignoreEnemyZoc')
    .map(({ effect }) => effect.terrain);
  if (terrains.includes('land') && terrains.includes('water')) return 'land';
  return terrains[0] ?? null;
}

export function unitIgnoresEnemyZoc(state: GameState, unit: ArmyUnit) {
  return unitIgnoresEnemyZocTerrain(state, unit) === 'land';
}
