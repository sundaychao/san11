export {
  attackableCities,
  attackableFacilities,
  attackableUnits,
  dispatchTerritoryDefenseForForce,
  jointAttackableUnits,
} from './legacyCore';

import type { ArmyUnit, CityId, ForceId, GameState, PassId } from '../types';
import { techLevelOf, troopDamageMultiplier } from '../techs';
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
import { attackableFacilities, attackablePlots, attackableUnits, jointAttackableUnits } from './targetRules';
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
import { unitIsIncapacitated } from './movementRules';

const NORMAL_ATTACK_CRITICAL_MULTIPLIER = 1.35;

function computeNormalAttackDamage(
  next: GameState,
  attacker: ArmyUnit,
  target: ArmyUnit,
  critical: boolean,
) {
  // 科技：兵科训练/精锐普攻伤害加成
  const techMultiplier = attacker.forceId && attacker.troopType && attacker.troopType !== 'sword' && attacker.troopType !== 'siege'
    ? troopDamageMultiplier(next, attacker.forceId, attacker.troopType)
    : 1;
  const rolledDamage = damageRoll(next, attacker, unitTerrain(next, target), false, target);
  const criticalDamage = critical
    ? Math.round(rolledDamage * NORMAL_ATTACK_CRITICAL_MULTIPLIER * techMultiplier)
    : Math.round(rolledDamage * techMultiplier);
  const fortifiedDamage = reduceUnitDamageByFortress(next, target, criticalDamage);
  return reduceIncomingDamageBySkills(next, target, fortifiedDamage, 'normalAttack');
}

function applyNormalAttackHit(
  next: GameState,
  attackerId: string,
  targetId: string,
  critical: boolean,
) {
  const attacker = next.units[attackerId];
  const target = next.units[targetId];
  if (!attacker || !target) return false;

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
  if (target.troops > 0) return true;

  removeUnit(next, target, attacker);
  return false;
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

  if (!applyNormalAttackHit(next, attackerId, targetId, critical)) return next;
  if (rollRepeatNormalAttack(next, nextAttacker)) {
    if (!applyNormalAttackHit(next, attackerId, targetId, critical)) return next;
  }
  const attackerTerrain = unitTerrain(next, nextAttacker);
  // 科技：弩兵2级还射——受弩兵远程攻击时（即使不相邻）也能反击
  const returnFire = nextTarget.troopType === 'crossbow' && nextTarget.forceId
    && nextAttacker.troopType === 'crossbow'
    && techLevelOf(next, nextTarget.forceId, 'crossbow') >= 2;
  if ((returnFire || areAdjacent(nextTarget, nextAttacker)) && !rollNoCounterAttack(next, nextAttacker, attackerTerrain)) {
    const rolledCounterDamage = damageRoll(next, nextTarget, unitTerrain(next, nextAttacker), true, nextAttacker);
    const fortifiedCounterDamage = reduceUnitDamageByFortress(next, nextAttacker, rolledCounterDamage);
    const counterDamage = reduceIncomingDamageBySkills(next, nextAttacker, fortifiedCounterDamage, 'counter');
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
  const multiplier = ((nextAttacker.troopType ?? 'sword') === 'siege' ? 1.3 : 0.55) * siegeDamageMultiplier(next, nextAttacker);
  const damage = Math.max(80, Math.round(damageRoll(next, nextAttacker, 'plain') * multiplier));
  nextFacility.durability = Math.max(0, nextFacility.durability - damage);
  nextAttacker.energy -= 10;
  nextAttacker.acted = true;
  next.facilityRepairReports = [];
  next.strategyResultReports = [];
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
  const multiplier = ((nextAttacker.troopType ?? 'sword') === 'siege' ? 1.3 : 0.55) * siegeDamageMultiplier(next, nextAttacker);
  const damage = Math.max(80, Math.round(damageRoll(next, nextAttacker, 'plain') * multiplier));
  nextPlot.durability = Math.max(0, (nextPlot.durability ?? PLOT_MAX_DURABILITY) - damage);
  nextAttacker.energy -= 10;
  nextAttacker.acted = true;
  next.facilityRepairReports = [];
  next.strategyResultReports = [];
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
  if (!city.ownerId && city.troops === 0) throw new Error('空城无守军，可直接进驻');
  if (attacker.energy < 10) throw new Error('气力不足');
  if (!isCityInAttackRange(state, attacker, city)) throw new Error('城市不在攻击范围');
  const next = structuredClone(state);
  const nextAttacker = next.units[attackerId];
  const nextCity = next.cities[cityId];
  const damage = damageRoll(next, nextAttacker, 'plain');
  const multiplier = ((nextAttacker.troopType ?? 'sword') === 'siege' ? 1.4 : 0.2) * siegeDamageMultiplier(next, nextAttacker);
  nextCity.troops = Math.max(0, nextCity.troops - Math.round(damage * 0.65));
  nextCity.durability = Math.max(0, nextCity.durability - Math.round(damage * multiplier));
  nextAttacker.energy -= 10;
  nextAttacker.acted = true;
  next.facilityRepairReports = [];
  next.strategyResultReports = [];
  if (nextCity.troops === 0 || nextCity.durability === 0) {
    captureCityOnCapture(next, nextAttacker, cityId);
  }
  return next;
}

export function attackPass(state: GameState, forceId: ForceId, attackerId: string, passId: PassId): GameState {
  const attacker = assertUnitTurn(state, forceId, attackerId);
  const pass = state.passes?.[passId];
  if (!pass) throw new Error('关隘不存在');
  if (pass.ownerId === forceId) throw new Error('不能攻击己方关隘');
  if (!pass.ownerId && pass.troops === 0) throw new Error('空关隘无守军，可直接进驻');
  if (attacker.energy < 10) throw new Error('气力不足');
  if (!isPassInAttackRange(state, attacker, pass)) throw new Error('关隘不在攻击范围');
  const next = structuredClone(state);
  const nextAttacker = next.units[attackerId];
  const nextPass = next.passes?.[passId];
  if (!nextPass) throw new Error('关隘不存在');
  const damage = damageRoll(next, nextAttacker, 'plain');
  const multiplier = ((nextAttacker.troopType ?? 'sword') === 'siege' ? 1.4 : 0.2) * siegeDamageMultiplier(next, nextAttacker);
  nextPass.troops = Math.max(0, nextPass.troops - Math.round(damage * 0.65));
  nextPass.durability = Math.max(0, nextPass.durability - Math.round(damage * multiplier));
  nextAttacker.energy -= 10;
  nextAttacker.acted = true;
  next.facilityRepairReports = [];
  next.strategyResultReports = [];
  if (nextPass.troops === 0 || nextPass.durability === 0) {
    capturePassOnCapture(next, nextAttacker, passId);
  }
  return next;
}
