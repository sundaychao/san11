import type { ArmamentType, GameCommand, TroopType } from '../types';
import type { StrategyId } from '../battle/strategies';

export type SkillDisplayCategory = '行军' | '攻击' | '防御' | '计略' | '辅助' | '内政' | '收入' | '灾害' | '关系';
export type SkillImplementationStatus = 'active' | 'planned' | 'blocked';
export type SkillSystemDependency = 'navy' | 'capture' | 'injury' | 'treasure' | 'technique' | 'diplomacy' | 'loyalty' | 'marriage' | 'tribe';
export type SkillCondition =
  | { kind: 'always' }
  | { kind: 'targetWarLower' }
  | { kind: 'targetIntelligenceLower' }
  | { kind: 'troopsBelow'; amount: number };

export type SkillEffect =
  | { kind: 'movementAllowance'; add: number; troopTypes?: TroopType[]; excludeKinds?: Array<'transport'> }
  | { kind: 'ignoreEnemyZoc'; terrain: 'land' | 'water' }
  | { kind: 'tacticCritical'; condition: SkillCondition; troopTypes?: TroopType[]; excludeTroopTypes?: TroopType[] }
  | { kind: 'normalAttackCritical'; condition: SkillCondition }
  | { kind: 'repeatNormalAttack'; chance: number }
  | { kind: 'negateIncomingDamage'; chance: number; condition: SkillCondition; sources: Array<'normalAttack' | 'counter' | 'tactic'> }
  | { kind: 'strategyEnergyCost'; set: number }
  | { kind: 'strategyGuaranteed'; strategyIds: StrategyId[]; condition: SkillCondition }
  | { kind: 'strategyImmunity'; strategyIds: StrategyId[] | 'all' }
  | { kind: 'fireDamageMultiplier'; multiplier: number }
  | { kind: 'buildPowerMultiplier'; multiplier: number }
  | { kind: 'turnStartEnergy'; add: number }
  | { kind: 'commandYieldMultiplier'; command: GameCommand['type']; multiplier: number; armamentTypes?: ArmamentType[] }
  | { kind: 'cityIncomeMultiplier'; resource: 'gold' | 'food'; multiplier: number }
  | { kind: 'complexHandler'; handler: 'chainStrategy' };

export interface SkillDefinition {
  name: string;
  displayCategory: SkillDisplayCategory;
  description: string;
  implementationStatus: SkillImplementationStatus;
  effects: SkillEffect[];
  blockedBy?: SkillSystemDependency[];
}

export interface ActiveSkill {
  definition: SkillDefinition;
  sourceOfficerIds: string[];
}
