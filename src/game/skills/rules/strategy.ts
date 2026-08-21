import type { StrategyId } from '../../battle/strategies';
import type { ArmyUnit, GameState } from '../../types';
import { skillConditionMatches } from '../conditions';
import { complexHandlerById } from '../handlers';
import { resolveUnitSkills } from '../sources';
import { effectsOfKind } from '../stacking';
import type { ComplexHandlerId } from '../types';

const HOSTILE_UNIT_STRATEGIES = new Set<StrategyId>(['fire', 'false-report', 'disturb', 'discord']);

export interface StrategySkillRules {
  energyCost: number;
  guaranteed: boolean;
  immune: boolean;
  fireDamageMultiplier: number;
  chain: boolean;
  complexHandlerIds: ComplexHandlerId[];
}

export function resolveStrategySkillRules(
  state: GameState,
  caster: ArmyUnit,
  target: ArmyUnit | undefined,
  strategyId: StrategyId,
  baseCost: number,
): StrategySkillRules {
  const casterSkills = resolveUnitSkills(state, caster);
  const targetSkills = target ? resolveUnitSkills(state, target) : [];
  const fixedCosts = effectsOfKind(casterSkills, 'strategyEnergyCost').map(({ effect }) => effect.set);
  const guaranteed = effectsOfKind(casterSkills, 'strategyGuaranteed')
    .filter(({ effect }) => effect.strategyIds.includes(strategyId))
    .some(({ effect }) => skillConditionMatches(state, effect.condition, caster, target));
  const hostileUnitStrategy = Boolean(
    target && target.forceId !== caster.forceId && HOSTILE_UNIT_STRATEGIES.has(strategyId),
  );
  const immune = hostileUnitStrategy && effectsOfKind(targetSkills, 'strategyImmunity')
    .some(({ effect }) => effect.strategyIds === 'all' || effect.strategyIds.includes(strategyId));
  const fireDamageMultiplier = strategyId === 'fire'
    ? effectsOfKind(casterSkills, 'fireDamageMultiplier')
      .reduce((highest, { effect }) => Math.max(highest, effect.multiplier), 1)
    : 1;
  const complexHandlerIds = target && target.forceId !== caster.forceId
    ? [...new Set(effectsOfKind(casterSkills, 'complexHandler')
      .map(({ effect }) => effect.handler)
      .filter((handlerId) => complexHandlerById(handlerId).canApply(strategyId)))]
    : [];

  return {
    energyCost: fixedCosts.length > 0 ? Math.min(baseCost, ...fixedCosts) : baseCost,
    guaranteed,
    immune,
    fireDamageMultiplier,
    chain: complexHandlerIds.includes('chainStrategy'),
    complexHandlerIds,
  };
}
