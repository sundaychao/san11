import { nextRandom } from '../../random';
import { NAVAL_TACTIC_IDS } from '../../battle/catalog';
import { cellAt } from '../../battle/movementRules';
import type { TacticId } from '../../battle/tactics';
import { deployTroopCapOf, energyCapOf, techLevelOf } from '../../techs';
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
  // 金刚：仅当实际受到的伤害低于阈值时才按条件结算
  const chance = effectsOfKind(resolveUnitSkills(state, target), 'negateIncomingDamage')
    .filter(({ effect }) => effect.sources.includes(source))
    .filter(({ effect }) => (
      effect.condition.kind === 'damageBelow'
        ? damage <= effect.condition.amount
        : skillConditionMatches(state, effect.condition, target)
    ))
    .reduce((highest, { effect }) => Math.max(highest, effect.chance), 0);
  // 科技：戟兵2级矢盾（受远程攻击30%免伤）、3级大盾（受普通攻击30%免伤）
  let techShieldChance = 0;
  if (target.forceId && target.troopType === 'halberd') {
    const halberdLevel = techLevelOf(state, target.forceId, 'halberd');
    if (halberdLevel >= 2 && (source === 'normalAttack' || source === 'tactic')) techShieldChance = 0.3;
    if (halberdLevel >= 3 && source === 'normalAttack') techShieldChance = 0.3;
  }
  const totalChance = Math.max(chance, techShieldChance);
  if (totalChance === 0) {
    // 藤甲：非火焰伤害按倍率削减（普通攻击/战法/反击）
    return applyNonFireDamageMultiplier(state, target, damage);
  }

  const roll = nextRandom(state.seed, state.rngCursor);
  state.rngCursor = roll.cursor;
  if (roll.value < totalChance) return 0;
  return applyNonFireDamageMultiplier(state, target, damage);
}

/** 藤甲：降低受到的普攻/战法/反击伤害 */
export function applyNonFireDamageMultiplier(state: GameState, target: ArmyUnit, damage: number) {
  const multiplier = effectsOfKind(resolveUnitSkills(state, target), 'nonFireDamageMultiplier')
    .reduce((acc, { effect }) => acc * effect.multiplier, 1);
  if (multiplier === 1) return damage;
  return Math.max(0, Math.round(damage * multiplier));
}

function isWaterTerrain(terrain: TerrainType | undefined) {
  return terrain === 'water';
}

export function rollNoCounterAttack(state: GameState, attacker: ArmyUnit, terrain: TerrainType) {
  // 科技：枪兵3级奇袭——在森林地形攻击不受反击
  if (attacker.forceId && attacker.troopType === 'spear' && terrain === 'forest'
    && techLevelOf(state, attacker.forceId, 'spear') >= 3) {
    return true;
  }
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

/** 攻击时降低目标气力（扫讨5 / 威风20） */
export function drainTargetEnergyBySkills(state: GameState, attacker: ArmyUnit, target: ArmyUnit) {
  const drain = effectsOfKind(resolveUnitSkills(state, attacker), 'attackDrainEnergy')
    .reduce((highest, { effect }) => Math.max(highest, effect.amount), 0);
  if (drain > 0) target.energy = Math.max(0, target.energy - drain);
}

/** 击破敌军部队后恢复气力（昂扬10） */
export function breakUnitEnergyRecovery(state: GameState, looter: ArmyUnit) {
  const amount = effectsOfKind(resolveUnitSkills(state, looter), 'breakUnitEnergy')
    .reduce((highest, { effect }) => Math.max(highest, effect.amount), 0);
  if (amount > 0) looter.energy = Math.min(energyCapOf(state, looter.forceId), looter.energy + amount);
}

/** 受到敌方战法后恢复气力（怒发5） */
export function recoverEnergyOnTacticHit(state: GameState, target: ArmyUnit) {
  const amount = effectsOfKind(resolveUnitSkills(state, target), 'recoverEnergyOnTacticHit')
    .reduce((highest, { effect }) => Math.max(highest, effect.amount), 0);
  if (amount > 0) target.energy = Math.min(energyCapOf(state, target.forceId), target.energy + amount);
}

/** 会心一击时吸收敌军士兵（心攻：转化部分伤害为已方士兵） */
export function absorbTroopsOnCritical(state: GameState, attacker: ArmyUnit, damage: number, critical: boolean) {
  if (!critical || damage <= 0) return;
  const ratio = effectsOfKind(resolveUnitSkills(state, attacker), 'absorbTroops')
    .reduce((highest, { effect }) => Math.max(highest, effect.ratio), 0);
  if (ratio <= 0) return;
  const absorb = Math.floor(damage * ratio);
  if (absorb <= 0) return;
  const cap = attacker.forceId ? deployTroopCapOf(state, attacker.forceId) : 12000;
  attacker.troops = Math.min(cap, attacker.troops + absorb);
}

/** 对城市/设施的耐久伤害倍率（攻城 +50%） */
export function siegeDamageMultiplier(state: GameState, attacker: ArmyUnit) {
  return effectsOfKind(resolveUnitSkills(state, attacker), 'siegeDamageMultiplier')
    .reduce((highest, { effect }) => Math.max(highest, effect.multiplier), 1);
}

/** 战法命中目标后是否使其混乱（疾走：骑兵战法打武力较低目标） */
export function tacticConfusesTarget(state: GameState, attacker: ArmyUnit, target: ArmyUnit, tacticId: TacticId) {
  const troopType = attacker.troopType ?? 'sword';
  if ((NAVAL_TACTIC_IDS as readonly string[]).includes(tacticId)) return false;
  return effectsOfKind(resolveUnitSkills(state, attacker), 'tacticConfuse')
    .filter(({ effect }) => !effect.troopTypes || effect.troopTypes.includes(troopType))
    .some(({ effect }) => skillConditionMatches(state, effect.condition, attacker, target));
}

/** 火焰伤害倍率（藤甲2倍，用于火计/火攻结算处） */
export function fireDamageMultiplierOf(state: GameState, unit: ArmyUnit) {
  return effectsOfKind(resolveUnitSkills(state, unit), 'fireDamageMultiplier')
    .reduce((highest, { effect }) => Math.max(highest, effect.multiplier), 1);
}

/** 铁壁：一齐攻击只按一次普通攻击处理（仅主攻者造成伤害） */
export function jointAttackSplitsToSingle(state: GameState, target: ArmyUnit): boolean {
  return effectsOfKind(resolveUnitSkills(state, target), 'jointAttackSingle').length > 0;
}

/** 掎角：任一参战者拥有掎角且目标存活时，有概率使目标混乱 */
export function jointAttackRollConfuse(state: GameState, hittingUnits: ArmyUnit[], target: ArmyUnit): boolean {
  const chance = hittingUnits
    .flatMap((unit) => effectsOfKind(resolveUnitSkills(state, unit), 'jointAttackConfuse'))
    .reduce((highest, { effect }) => Math.max(highest, effect.chance), 0);
  if (chance === 0) return false;
  const roll = nextRandom(state.seed, state.rngCursor);
  state.rngCursor = roll.cursor;
  return roll.value < chance;
}

/** 射手：无射手特技时弩兵不能攻击森林中的目标 */
export function rangedTargetBlockedByForest(state: GameState, attacker: ArmyUnit, target: ArmyUnit): boolean {
  if ((attacker.troopType ?? 'sword') !== 'crossbow') return false;
  if (cellAt(state, target)?.terrain !== 'forest') return false;
  return effectsOfKind(resolveUnitSkills(state, attacker), 'ignoreForestBlock').length === 0;
}
