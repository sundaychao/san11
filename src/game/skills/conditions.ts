import { effectiveUnitAbilities } from '../battle/officerAbilities';
import { cellAt } from '../battle/movementRules';
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
  if (condition.kind === 'attackerTerrain') return cellAt(state, actor)?.terrain === condition.terrain;
  // 金刚：按“实际受到伤害是否低于阈值”在伤害结算处另行判断
  if (condition.kind === 'damageBelow') return false;
  if (!target) return false;

  const actorAbilities = effectiveUnitAbilities(state, actor);
  const targetAbilities = effectiveUnitAbilities(state, target);
  if (condition.kind === 'targetWarLower') return targetAbilities.war.value < actorAbilities.war.value;
  if (condition.kind === 'targetIntelligenceLower') return targetAbilities.intelligence.value < actorAbilities.intelligence.value;
  return targetAbilities.intelligence.value > actorAbilities.intelligence.value;
}
