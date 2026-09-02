import type { StrategyId } from '../../battle/strategies';
import { effectiveUnitAbilities } from '../../battle/officerAbilities';
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
  successBonus: number;
  rangeBonus: number;
  critical: boolean;
  reflect: boolean;
  castFailConfuse: boolean;
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
  const hostileTarget = target && target.forceId !== caster.forceId && HOSTILE_UNIT_STRATEGIES.has(strategyId)
    ? target
    : undefined;
  const hostileUnitStrategy = Boolean(hostileTarget);
  const immune = hostileUnitStrategy && effectsOfKind(targetSkills, 'strategyImmunity')
    .filter(({ effect }) => !effect.condition || skillConditionMatches(state, effect.condition, hostileTarget!, caster))
    .some(({ effect }) => effect.strategyIds === 'all' || effect.strategyIds.includes(strategyId));
  const fireDamageMultiplier = strategyId === 'fire'
    ? effectsOfKind(casterSkills, 'fireDamageMultiplier')
      .reduce((highest, { effect }) => Math.max(highest, effect.multiplier), 1)
    : 1;
  // 计略优待（神算）与倾国（对非女性武将部队 +成功率）
  const successBonus = hostileUnitStrategy
    ? effectsOfKind(casterSkills, 'strategySuccessBonus')
      .filter(({ effect }) => !effect.nonFemaleOnly || !targetLeaderIsFemale(state, hostileTarget!))
      .reduce((total, { effect }) => total + effect.add, 0)
    : 0;
  const rangeBonus = effectsOfKind(casterSkills, 'strategyRangeBonus')
    .reduce((total, { effect }) => total + effect.add, 0);
  // 深谋/秘计：敌对计略成功时必定暴击（对智力更高目标的秘计亦暴击）
  const critical = hostileUnitStrategy && effectsOfKind(casterSkills, 'strategyCritical')
    .some(({ effect }) => skillConditionMatches(state, effect.condition, caster, hostileTarget!));
  // 反计：敌方对本部队施放计略且敌将智力不高于本部队主将时，将计略反作用
  const reflect = hostileUnitStrategy && effectsOfKind(targetSkills, 'reflectStrategy').length > 0
    && (effectiveUnitAbilities(state, hostileTarget!).intelligence.value
      >= effectiveUnitAbilities(state, caster).intelligence.value);
  // 妙计：敌方对本部队施放计略失败后，施计方陷入混乱
  const castFailConfuse = hostileUnitStrategy && effectsOfKind(targetSkills, 'strategyCastFailConfuse').length > 0;
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
    successBonus,
    rangeBonus,
    critical,
    reflect,
    castFailConfuse,
    chain: complexHandlerIds.includes('chainStrategy'),
    complexHandlerIds,
  };
}

/** 倾国：目标部队主将为非女性武将时生效 */
function targetLeaderIsFemale(state: GameState, target: ArmyUnit): boolean {
  const leader = state.officers[target.leaderId];
  return leader?.gender === 'female';
}
