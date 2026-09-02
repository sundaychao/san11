import type { ArmamentType, GameCommand, TroopType } from '../types';
import type { StrategyId } from '../battle/strategies';

export type SkillDisplayCategory = '行军' | '攻击' | '防御' | '计略' | '辅助' | '内政' | '收入' | '灾害' | '关系';
export type SkillImplementationStatus = 'active' | 'planned' | 'blocked';
export type SkillSystemDependency = 'navy' | 'capture' | 'injury' | 'treasure' | 'technique' | 'diplomacy' | 'loyalty' | 'marriage' | 'tribe';
export type SkillCondition =
  | { kind: 'always' }
  | { kind: 'targetWarLower' }
  | { kind: 'targetIntelligenceLower' }
  | { kind: 'targetIntelligenceHigher' }
  | { kind: 'troopsBelow'; amount: number }
  | { kind: 'attackerTerrain'; terrain: 'forest' }
  | { kind: 'damageBelow'; amount: number };

export type SkillEffect =
  | { kind: 'movementAllowance'; add: number; troopTypes?: TroopType[]; excludeKinds?: Array<'transport'>; waterOnly?: boolean; kinds?: Array<'combat' | 'transport'> }
  | { kind: 'ignoreEnemyZoc'; terrain: 'land' | 'water' }
  | { kind: 'tacticCritical'; condition: SkillCondition; troopTypes?: TroopType[]; excludeTroopTypes?: TroopType[]; navalOnly?: boolean }
  | { kind: 'normalAttackCritical'; condition: SkillCondition }
  | { kind: 'repeatNormalAttack'; chance: number }
  | { kind: 'negateIncomingDamage'; chance: number; condition: SkillCondition; sources: Array<'normalAttack' | 'counter' | 'tactic'> }
  | { kind: 'noCounterAttack'; chance: number; terrain: 'land' | 'water' }
  | { kind: 'strategyEnergyCost'; set: number }
  | { kind: 'strategyGuaranteed'; strategyIds: StrategyId[]; condition: SkillCondition }
  | { kind: 'strategyImmunity'; strategyIds: StrategyId[] | 'all'; condition?: SkillCondition }
  | { kind: 'strategySuccessBonus'; add: number; nonFemaleOnly?: boolean }
  | { kind: 'strategyRangeBonus'; add: number }
  | { kind: 'strategyCritical'; condition: SkillCondition }
  | { kind: 'reflectStrategy' }
  | { kind: 'strategyCastFailConfuse' }
  | { kind: 'fireDamageMultiplier'; multiplier: number }
  | { kind: 'nonFireDamageMultiplier'; multiplier: number }
  | { kind: 'buildPowerMultiplier'; multiplier: number }
  | { kind: 'turnStartEnergy'; add: number }
  | { kind: 'commandYieldMultiplier'; command: GameCommand['type']; multiplier: number; armamentTypes?: ArmamentType[] }
  | { kind: 'cityIncomeMultiplier'; resource: 'gold' | 'food'; multiplier: number }
  | { kind: 'attackDrainEnergy'; amount: number }
  | { kind: 'breakUnitEnergy'; amount: number }
  | { kind: 'absorbTroops'; ratio: number }
  | { kind: 'recoverEnergyOnTacticHit'; amount: number }
  | { kind: 'siegeDamageMultiplier'; multiplier: number }
  | { kind: 'tacticConfuse'; condition: SkillCondition; troopTypes?: TroopType[] }
  | { kind: 'jointAttackSingle' }
  | { kind: 'jointAttackConfuse'; chance: number }
  | { kind: 'guaranteedCapture' }
  | { kind: 'captureImmune' }
  | { kind: 'injuryImmune' }
  | { kind: 'ignoreForestBlock' }
  | { kind: 'cityFoodConsumptionMultiplier'; multiplier: number }
  | { kind: 'researchTechPCostMultiplier'; multiplier: number }
  | { kind: 'exploreTalentGuaranteed' }
  | { kind: 'armamentProductionSpeed'; multiplier: number; armamentTypes: ArmamentType[] }
  | { kind: 'musicTowerEnergyMultiplier'; multiplier: number }
  | { kind: 'harvestBlessed' }
  | { kind: 'siegeRangeBonus'; add: number }
  | { kind: 'unitAttackRangeBonus'; add: number; troopTypes?: TroopType[] }
  | { kind: 'stealTreasureOnBreak' }
  | { kind: 'techPDoubleOnBreak' }
  | { kind: 'complexHandler'; handler: 'chainStrategy' };

export type ComplexHandlerEffect = Extract<SkillEffect, { kind: 'complexHandler' }>;
export type ComplexHandlerId = ComplexHandlerEffect['handler'];

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
