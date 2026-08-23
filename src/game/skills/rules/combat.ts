import { nextRandom } from '../../random';
import { NAVAL_TACTIC_IDS } from '../../battle/catalog';
import type { TacticId } from '../../battle/tactics';
import type { ArmyUnit, GameState, TerrainType } from '../../types';
import { skillConditionMatches } from '../conditions';
import { resolveUnitSkills } from '../sources';
import { effectsOfKind } from '../stacking';

export function normalAttackIsCritical(state: GameState, attacker: ArmyUnit, target: ArmyUnit) {
  return effectsOfKind(resolveUnitSkills(state, attacker), 'normalAttackCritical')
    .some(({ effect }) => skillConditionMatches(state, effect.condition, attacker, target));
}

export function tacticCriticalMode(
  state: GameState,
  attacker: ArmyUnit,
  target: ArmyUnit,
  tacticId: TacticId,
): 'normal' | 'guaranteed' {
  const troopType = attacker.troopType ?? 'sword';
  const isNavalTactic = (NAVAL_TACTIC_IDS as readonly string[]).includes(tacticId);
  const guaranteed = effectsOfKind(resolveUnitSkills(state, attacker), 'tacticCritical')
    .filter(({ effect }) => !effect.troopTypes || effect.troopTypes.includes(troopType))
    .filter(({ effect }) => !effect.excludeTroopTypes?.includes(troopType))
    .filter(({ effect }) => !effect.navalOnly || isNavalTactic)
    .some(({ effect }) => skillConditionMatches(state, effect.condition, attacker, target));
  return guaranteed ? 'guaranteed' : 'normal';
}

export function rollRepeatNormalAttack(state: GameState, attacker: ArmyUnit) {
  const chance = effectsOfKind(resolveUnitSkills(state, attacker), 'repeatNormalAttack')
    .reduce((highest, { effect }) => Math.max(highest, effect.chance), 0);
  if (chance === 0) return false;

  const roll = nextRandom(state.seed, state.rngCursor);
  state.rngCursor = roll.cursor;
  return roll.value < chance;
}

export function reduceIncomingDamageBySkills(
  state: GameState,
  target: ArmyUnit,
  damage: number,
  source: 'normalAttack' | 'counter' | 'tactic',
) {
  const chance = effectsOfKind(resolveUnitSkills(state, target), 'negateIncomingDamage')
    .filter(({ effect }) => (
      effect.sources.includes(source) && skillConditionMatches(state, effect.condition, target)
    ))
    .reduce((highest, { effect }) => Math.max(highest, effect.chance), 0);
  if (chance === 0) return damage;

  const roll = nextRandom(state.seed, state.rngCursor);
  state.rngCursor = roll.cursor;
  return roll.value < chance ? 0 : damage;
}

function isWaterTerrain(terrain: TerrainType | undefined) {
  return terrain === 'water';
}

export function rollNoCounterAttack(state: GameState, attacker: ArmyUnit, terrain: TerrainType) {
  const chance = effectsOfKind(resolveUnitSkills(state, attacker), 'noCounterAttack')
    .filter(({ effect }) => effect.terrain === 'land'
      ? !isWaterTerrain(terrain)
      : effect.terrain === 'water'
        ? isWaterTerrain(terrain)
        : false)
    .reduce((highest, { effect }) => Math.max(highest, effect.chance), 0);
  if (chance === 0) return false;

  const roll = nextRandom(state.seed, state.rngCursor);
  state.rngCursor = roll.cursor;
  return roll.value < chance;
}
