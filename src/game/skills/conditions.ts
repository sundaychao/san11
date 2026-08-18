import { effectiveUnitAbilities } from '../battle/officerAbilities';
import type { ArmyUnit, GameState } from '../types';
import type { SkillCondition } from './types';

export function skillConditionMatches(
  state: GameState,
  condition: SkillCondition,
  actor: ArmyUnit,
  target?: ArmyUnit,
): boolean {
  if (condition.kind === 'always') return true;
  if (condition.kind === 'troopsBelow') return actor.troops < condition.amount;
  if (!target) return false;

  const actorAbilities = effectiveUnitAbilities(state, actor);
  const targetAbilities = effectiveUnitAbilities(state, target);
  return condition.kind === 'targetWarLower'
    ? targetAbilities.war.value < actorAbilities.war.value
    : targetAbilities.intelligence.value < actorAbilities.intelligence.value;
}
