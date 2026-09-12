export {
  applyCatapultSplash,
  attackableCities,
  attackableFacilities,
  attackableUnits,
  dispatchTerritoryDefenseForForce,
  jointAttackableUnits,
} from './legacyCore';
export type { CatapultSplashHit, CatapultSplashOptions, CatapultSplashSource } from './legacyCore';

import type { ArmyUnit, CityId, ForceId, GameState, PassId } from '../types';
import { siegeWeaponKindOf, unitHasCatapultAttack } from '../armaments';
import { canRangedCounter, counterAttackMultiplier, garrisonDamageMultiplier, rangedDecayHalved } from '../techs';
import { captureCityOnCapture, capturePassOnCapture } from '../captives';
import {
  absorbTroopsOnCritical,
  drainTargetEnergyBySkills,
  jointAttackRollConfuse,
  jointAttackSplitsToSingle,
  normalAttackIsCritical,
  reduceIncomingDamageBySkills,
  rollNoCounterAttack,
  rollRepeatNormalAttack,
  siegeDamageMultiplier,
} from '../skills/rules/combat';
import { applyCatapultSplash, igniteWoodenBeastAttack } from './legacyCore';
import { attackableFacilities, attackablePlots, attackableUnits, gridDistanceWithin, jointAttackableUnits } from './targetRules';
import { PLOT_MAX_DURABILITY } from '../innerAffairs';
import {
  areAdjacent,
  assertUnitTurn,
  damageRoll,
  isCityInAttackRange,
  isPassInAttackRange,
  reduceUnitDamageByFortress,
  removeUnit,
  unitTerrain,
} from './shared';
import { cityCenter, unitIsIncapacitated } from './movementRules';

const NORMAL_ATTACK_CRITICAL_MULTIPLIER = 1.35;

/** 木兽（机械解锁的冲车升级版）：攻击命中后使被攻击地点着火 */
function ignitesTargetOnHit(state: GameState, attacker: ArmyUnit): boolean {
  return siegeWeaponKindOf(state, attacker) === 'woodenBeast';
}

/**
 * 本次攻击是否按「攻城武器（兵器）」口径结算耐久/驻军伤害。
 * 除兵器部队本身外，开发「弹道」后的斗舰以投石参战，同样按兵器倍率与射程结算。
 */
function attacksAsSiege(state: GameState, attacker: ArmyUnit): boolean {
  return (attacker.troopType ?? 'sword') === 'siege' || unitHasCatapultAttack(state, attacker);
}

/** 攻城武器口径的兵种描述：斗舰投石在「云梯」等按兵种判定的加成里也按兵器结算 */
function siegeProfileOf(
  state: GameState,
  attacker: ArmyUnit,
): Pick<ArmyUnit, 'kind' | 'troopType' | 'vehicle'> {
  return attacksAsSiege(state, attacker) ? { kind: attacker.kind, troopType: 'siege' } : attacker;
}

function computeNormalAttackDamage(
  next: GameState,
  attacker: ArmyUnit,
  target: ArmyUnit,
  critical: boolean,
) {
  // 科技「训练/专精」只加成战法威力，普攻不再吃兵科伤害倍率
  const rolledDamage = damageRoll(next, attacker, unitTerrain(next, target), false, target);
  // 远程攻击距离衰减：每多 1 格 -10%；科技「扳指」把衰减减半为 -5%（最多衰减到 50%）
  const distance = gridDistanceWithin(attacker, target, 5);
  const decayPerCell = rangedDecayHalved(next, attacker.forceId) ? 0.05 : 0.1;
  const decayMultiplier = distance >= 2 ? Math.max(0.5, 1 - (distance - 1) * decayPerCell) : 1;
  const criticalDamage = critical
    ? Math.round(rolledDamage * NORMAL_ATTACK_CRITICAL_MULTIPLIER * decayMultiplier)
    : Math.round(rolledDamage * decayMultiplier);
  const fortifiedDamage = reduceUnitDamageByFortress(next, target, criticalDamage);
  // 远程普攻 / 近距离普攻决定戟兵「盾牌防御」「连锁防御」是否生效
  const ranged = !areAdjacent(attacker, target);
  return reduceIncomingDamageBySkills(next, target, fortifiedDamage, 'normalAttack', ranged);
}

interface NormalAttackHit {
  /** 本次命中造成的伤害（未命中/目标已消失为 0） */
  damage: number;
  /** 目标是否已被击破（击破后不再连击、不再反击） */
  destroyed: boolean;
}

function applyNormalAttackHit(
  next: GameState,
  attackerId: string,
  targetId: string,
  critical: boolean,
): NormalAttackHit {
  const attacker = next.units[attackerId];
  const target = next.units[targetId];
  if (!attacker || !target) return { damage: 0, destroyed: true };

  const damage = computeNormalAttackDamage(next, attacker, target, critical);
  target.troops -= damage;
  // 扫讨/威风：攻击时降低敌方气力；心攻：会心时吸收敌军士兵
  drainTargetEnergyBySkills(next, attacker, target);
  absorbTroopsOnCritical(next, attacker, damage, critical);
  next.battleDamageReports ??= [];
  next.battleDamageReports.push({
    id: `damage-${next.month}-${next.tenDay}-${next.rngCursor}-${targetId}`,
    unitId: targetId,
    q: target.q,
    r: target.r,
    amount: damage,
    kind: 'attack',
    ...(critical ? { critical: true, label: '暴击' } : {}),
  });
  if (target.troops > 0) return { damage, destroyed: false };

  removeUnit(next, target, attacker);
  return { damage, destroyed: true };
}

export function attackUnit(state: GameState, forceId: ForceId, attackerId: string, targetId: string): GameState {
  const attacker = assertUnitTurn(state, forceId, attackerId);
  const target = state.units[targetId];
  if (!target) throw new Error('目标部队不存在');
  if (target.forceId === forceId) throw new Error('不能攻击己方部队');
  if (attacker.energy < 10) throw new Error('气力不足');
  if (!attackableUnits(state, attackerId).some((unit) => unit.id === targetId)) throw new Error('目标不在攻击范围');

  const next = structuredClone(state);
  const nextAttacker = next.units[attackerId];
  const nextTarget = next.units[targetId];
  const critical = normalAttackIsCritical(next, nextAttacker, nextTarget);
  nextAttacker.energy -= 10;
  nextAttacker.acted = true;
  next.battleDamageReports = [];
  next.facilityRepairReports = [];
  next.strategyResultReports = [];
  next.cityEffectReports = [];

  // 木兽：被攻击的部队所在格着火；投石车/斗舰投石：命中后按「霹雳」对中心 6 格溅射（不分敌我）
  const woodenBeast = ignitesTargetOnHit(next, nextAttacker);
  const catapultHit = unitHasCatapultAttack(next, nextAttacker);
  const resolveHit = (isCritical: boolean): NormalAttackHit => {
    const targetCoord = { q: nextTarget.q, r: nextTarget.r };
    const hit = applyNormalAttackHit(next, attackerId, targetId, isCritical);
    if (hit.damage <= 0) return hit;
    if (woodenBeast) igniteWoodenBeastAttack(next, targetCoord);
    if (catapultHit) {
      applyCatapultSplash(next, 'catapultUnit', forceId, targetCoord, hit.damage, {
        centerUnitId: targetId,
        looter: nextAttacker,
      });
    }
    return hit;
  };

  if (resolveHit(critical).destroyed) return next;
  if (rollRepeatNormalAttack(next, nextAttacker)) {
    if (resolveHit(critical).destroyed) return next;
  }
  const attackerTerrain = unitTerrain(next, nextAttacker);
  // 科技「还射」：弩兵受弩兵远程攻击时（即使不相邻）也能反击
  const returnFire = nextTarget.troopType === 'crossbow' && nextTarget.forceId
    && nextAttacker.troopType === 'crossbow'
    && canRangedCounter(next, nextTarget.forceId);
  if ((returnFire || areAdjacent(nextTarget, nextAttacker)) && !rollNoCounterAttack(next, nextAttacker, attackerTerrain)) {
    const rolledCounterDamage = damageRoll(next, nextTarget, unitTerrain(next, nextAttacker), true, nextAttacker);
    const fortifiedCounterDamage = reduceUnitDamageByFortress(next, nextAttacker, rolledCounterDamage);
    const counterDamage = reduceIncomingDamageBySkills(
      next, nextAttacker, fortifiedCounterDamage, 'counter', !areAdjacent(nextTarget, nextAttacker),
    );
    next.battleDamageReports.push({
      id: `damage-${next.month}-${next.tenDay}-${next.rngCursor}-${attackerId}`,
      unitId: attackerId, q: nextAttacker.q, r: nextAttacker.r, amount: counterDamage, kind: 'counter',
    });
    nextAttacker.troops -= counterDamage;
    if (nextAttacker.troops <= 0) removeUnit(next, nextAttacker, nextTarget);
  }
  return next;
}

export function jointAttackUnit(state: GameState, forceId: ForceId, attackerId: string, targetId: string): GameState {
  const attacker = assertUnitTurn(state, forceId, attackerId);
  const target = state.units[targetId];
  if (!target) throw new Error('目标部队不存在');
  if (target.forceId === forceId) throw new Error('不能攻击己方部队');
  if (attacker.energy < 10) throw new Error('气力不足');
  if (!jointAttackableUnits(state, attackerId).some((unit) => unit.id === targetId)) throw new Error('目标不在齐攻范围');

  const next = structuredClone(state);
  const nextTarget = next.units[targetId];
  const nextAttacker = next.units[attackerId];
  next.battleDamageReports = [];
  next.facilityRepairReports = [];
  next.strategyResultReports = [];
  next.cityEffectReports = [];

  // 参与齐攻的部队 = 主攻者自身 + 与目标相邻且本旬仍可行动的友军战斗部队
  const participants = Object.values(next.units).filter((unit) => {
    if (unit.forceId !== forceId || unit.kind === 'transport') return false;
    if (!areAdjacent({ q: unit.q, r: unit.r }, { q: nextTarget.q, r: nextTarget.r })) return false;
    if (unit.id === attackerId) return true;
    return !unit.acted && !unit.moved && !unitIsIncapacitated(unit);
  });

  // 铁壁：目标拥有铁壁时，齐攻只按一次普通攻击处理（仅主攻者造成一次伤害）
  const hittingUnits = jointAttackSplitsToSingle(next, nextTarget)
    ? participants.filter((unit) => unit.id === attackerId)
    : participants;

  let totalDamage = 0;
  let anyCritical = false;
  for (const participant of hittingUnits) {
    const critical = normalAttackIsCritical(next, participant, nextTarget);
    const damage = computeNormalAttackDamage(next, participant, nextTarget, critical);
    totalDamage += damage;
    anyCritical = anyCritical || critical;
    // 扫讨/威风：齐攻同样降低敌方气力；心攻：会心时吸收敌军士兵
    drainTargetEnergyBySkills(next, participant, nextTarget);
    absorbTroopsOnCritical(next, participant, damage, critical);
    participant.energy = Math.max(0, participant.energy - 10);
    participant.acted = true;
  }

  nextTarget.troops = Math.max(0, nextTarget.troops - totalDamage);
  if (totalDamage > 0) {
    next.battleDamageReports.push({
      id: `damage-${next.month}-${next.tenDay}-${next.rngCursor}-${targetId}`,
      unitId: targetId,
      q: nextTarget.q,
      r: nextTarget.r,
      amount: totalDamage,
      kind: 'jointAttack',
      ...(anyCritical ? { critical: true, label: '齐攻' } : {}),
    });
  }

  // 掎角：任一参战者拥有掎角且目标存活时，有概率使目标混乱
  if (nextTarget.troops > 0 && jointAttackRollConfuse(next, hittingUnits, nextTarget)) {
    nextTarget.confusedTenDays = 1;
  }

  if (nextTarget.troops <= 0) {
    removeUnit(next, nextTarget, nextAttacker);
    return next;
  }

  // 反击：参与齐攻的部队越多，目标反击损伤越低（原版一斉攻击的反击通常远小于逐一普攻）
  // 仅主攻者（紧贴目标者）吃到一次反击，按参战部队数衰减
  const attackerTerrain = unitTerrain(next, nextAttacker);
  if (areAdjacent(nextTarget, nextAttacker) && !rollNoCounterAttack(next, nextAttacker, attackerTerrain)) {
    const rolledCounterDamage = damageRoll(next, nextTarget, unitTerrain(next, nextAttacker), true, nextAttacker);
    const fortifiedCounterDamage = reduceUnitDamageByFortress(next, nextAttacker, rolledCounterDamage);
    const counterDamage = Math.round(
      reduceIncomingDamageBySkills(next, nextAttacker, fortifiedCounterDamage, 'counter') *
      (2 / Math.max(2, participants.length)),
    );
    next.battleDamageReports.push({
      id: `damage-${next.month}-${next.tenDay}-${next.rngCursor}-${attackerId}`,
      unitId: attackerId, q: nextAttacker.q, r: nextAttacker.r, amount: counterDamage, kind: 'counter',
    });
    nextAttacker.troops -= counterDamage;
    if (nextAttacker.troops <= 0) removeUnit(next, nextAttacker, nextTarget);
  }
  return next;
}

export function attackFacility(state: GameState, forceId: ForceId, attackerId: string, facilityId: string): GameState {
  const attacker = assertUnitTurn(state, forceId, attackerId);
  const facility = state.facilities?.[facilityId];
  if (!facility) throw new Error('设施不存在');
  if (facility.forceId === forceId) throw new Error('不能攻击己方设施');
  if (attacker.energy < 10) throw new Error('气力不足');
  if (!attackableFacilities(state, attackerId).some((target) => target.id === facilityId)) throw new Error('设施不在攻击范围');
  const next = structuredClone(state);
  const nextAttacker = next.units[attackerId];
  const nextFacility = next.facilities![facilityId];
  const multiplier = (attacksAsSiege(next, nextAttacker) ? 1.3 : 0.55) * siegeDamageMultiplier(next, nextAttacker);
  const damage = Math.max(80, Math.round(damageRoll(next, nextAttacker, 'plain') * multiplier));
  const targetCoord = { q: nextFacility.q, r: nextFacility.r };
  nextFacility.durability = Math.max(0, nextFacility.durability - damage);
  nextAttacker.energy -= 10;
  nextAttacker.acted = true;
  next.facilityRepairReports = [];
  next.strategyResultReports = [];
  // 木兽：被攻击的地点着火（设施被打掉也照样烧起来）
  if (ignitesTargetOnHit(next, nextAttacker)) igniteWoodenBeastAttack(next, targetCoord);
  if (nextFacility.durability <= 0) delete next.facilities?.[facilityId];
  return next;
}

export function attackPlot(state: GameState, forceId: ForceId, attackerId: string, cityId: CityId, plotIndex: number): GameState {
  const attacker = assertUnitTurn(state, forceId, attackerId);
  const city = state.cities[cityId];
  const plot = city?.plots?.[plotIndex];
  if (!city || !plot) throw new Error('目标设施不存在');
  if (plot.q == null || plot.r == null) throw new Error('目标设施不在地图上');
  if (city.ownerId === forceId) throw new Error('不能攻击己方势力设施');
  if (attacker.energy < 10) throw new Error('气力不足');
  if (!attackablePlots(state, attackerId).some((target) => target.cityId === cityId && target.plotIndex === plotIndex)) throw new Error('目标不在攻击范围');

  const next = structuredClone(state);
  const nextAttacker = next.units[attackerId];
  const nextPlot = next.cities[cityId].plots![plotIndex];
  const multiplier = (attacksAsSiege(next, nextAttacker) ? 1.3 : 0.55) * siegeDamageMultiplier(next, nextAttacker);
  const damage = Math.max(80, Math.round(damageRoll(next, nextAttacker, 'plain') * multiplier));
  const targetCoord = { q: nextPlot.q!, r: nextPlot.r! };
  nextPlot.durability = Math.max(0, (nextPlot.durability ?? PLOT_MAX_DURABILITY) - damage);
  nextAttacker.energy -= 10;
  nextAttacker.acted = true;
  next.facilityRepairReports = [];
  next.strategyResultReports = [];
  // 木兽：被攻击的地格着火（地格被打空也照样烧起来）
  if (ignitesTargetOnHit(next, nextAttacker)) igniteWoodenBeastAttack(next, targetCoord);
  if (nextPlot.durability <= 0) {
    // 破坏地格：设施拆除，地格清空
    nextPlot.type = 'empty';
    nextPlot.level = 0;
    nextPlot.value = 0;
    nextPlot.constructing = undefined;
  }
  return next;
}

export function attackCity(state: GameState, forceId: ForceId, attackerId: string, cityId: CityId): GameState {
  const attacker = assertUnitTurn(state, forceId, attackerId);
  const city = state.cities[cityId];
  if (!city) throw new Error('城市不存在');
  if (city.ownerId === forceId) throw new Error('不能攻击己方城市');
  // 无主无守军城同样可打：守军已是 0，只会掉耐久；耐久归零即攻破占领（资源减半、耐久重置 20%）。
  // 想兵不血刃并保住资源，应改用 moveUnit 进驻。
  if (attacker.energy < 10) throw new Error('气力不足');
  if (!isCityInAttackRange(state, attacker, city)) throw new Error('城市不在攻击范围');
  const next = structuredClone(state);
  const nextAttacker = next.units[attackerId];
  const nextCity = next.cities[cityId];
  const damage = damageRoll(next, nextAttacker, 'plain');
  const multiplier = (attacksAsSiege(next, nextAttacker) ? 1.4 : 0.2) * siegeDamageMultiplier(next, nextAttacker);
  // 科技「云梯」：对据点驻军的伤害加成（一般部队＋40%，攻城武器＋20%）
  const garrisonMultiplier = garrisonDamageMultiplier(next, forceId, siegeProfileOf(next, nextAttacker));
  nextCity.troops = Math.max(0, nextCity.troops - Math.round(damage * 0.65 * garrisonMultiplier));
  nextCity.durability = Math.max(0, nextCity.durability - Math.round(damage * multiplier));
  nextAttacker.energy -= 10;
  nextAttacker.acted = true;
  next.facilityRepairReports = [];
  next.strategyResultReports = [];
  // 木兽：被攻击的城池着火（取城池中心格）
  if (ignitesTargetOnHit(next, nextAttacker)) igniteWoodenBeastAttack(next, cityCenter(nextCity));
  if (nextCity.troops === 0 || nextCity.durability === 0) {
    // 攻方就在城下，破城后主力直接进城接管
    captureCityOnCapture(next, nextAttacker, cityId, { mergeAttacker: true });
  }
  return next;
}

export function attackPass(state: GameState, forceId: ForceId, attackerId: string, passId: PassId): GameState {
  const attacker = assertUnitTurn(state, forceId, attackerId);
  const pass = state.passes?.[passId];
  if (!pass) throw new Error('关隘不存在');
  if (pass.ownerId === forceId) throw new Error('不能攻击己方关隘');
  // 无主无守军关隘同样可打（与城池同口径）：耐久归零即攻破占领
  if (attacker.energy < 10) throw new Error('气力不足');
  if (!isPassInAttackRange(state, attacker, pass)) throw new Error('关隘不在攻击范围');
  const next = structuredClone(state);
  const nextAttacker = next.units[attackerId];
  const nextPass = next.passes?.[passId];
  if (!nextPass) throw new Error('关隘不存在');
  const damage = damageRoll(next, nextAttacker, 'plain');
  const multiplier = (attacksAsSiege(next, nextAttacker) ? 1.4 : 0.2) * siegeDamageMultiplier(next, nextAttacker);
  // 科技「云梯」：对据点驻军的伤害加成（一般部队＋40%，攻城武器＋20%）
  const garrisonMultiplier = garrisonDamageMultiplier(next, forceId, siegeProfileOf(next, nextAttacker));
  nextPass.troops = Math.max(0, nextPass.troops - Math.round(damage * 0.65 * garrisonMultiplier));
  nextPass.durability = Math.max(0, nextPass.durability - Math.round(damage * multiplier));
  nextAttacker.energy -= 10;
  nextAttacker.acted = true;
  next.facilityRepairReports = [];
  next.strategyResultReports = [];
  // 木兽：被攻击的关隘着火（关隘为单格据点）
  if (ignitesTargetOnHit(next, nextAttacker)) igniteWoodenBeastAttack(next, { q: nextPass.q, r: nextPass.r });
  if (nextPass.troops === 0 || nextPass.durability === 0) {
    // 攻方就在关下，破关后主力直接进关接管
    capturePassOnCapture(next, nextAttacker, passId, { mergeAttacker: true });
  }
  return next;
}
