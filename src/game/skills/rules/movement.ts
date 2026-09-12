import type { ArmyUnit, GameState, TerrainType, TroopType } from '../../types';
import { isWaterTerrain } from '../../battle/catalog';
import { resolveOfficerSkills, resolveUnitSkills } from '../sources';
import { effectsOfKind } from '../stacking';

export function movementAllowanceBonus(state: GameState, unit: ArmyUnit, terrain?: TerrainType) {
  const unitKind: 'combat' | 'transport' = unit.kind === 'transport' ? 'transport' : 'combat';
  const bonus = effectsOfKind(resolveUnitSkills(state, unit), 'movementAllowance')
    .filter(({ effect }) => (
      (effect.kinds ?? ['combat']).includes(unitKind) &&
      (!effect.troopTypes || effect.troopTypes.includes(unit.troopType ?? 'sword')) &&
      (!effect.waterOnly || isWaterTerrain(terrain))
    ))
    .reduce((sum, { effect }) => sum + effect.add, 0);
  // 科技移动力加成（急行军/良马育种/轮轴/罗盘/后勤体系）由 techs.movementTechBonus 统一提供
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
      (effect.kinds ?? ['combat']).includes(kind) &&
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
