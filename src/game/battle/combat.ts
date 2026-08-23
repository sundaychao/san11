export {
  attackableCities,
  attackableFacilities,
  attackableUnits,
  dispatchTerritoryDefenseForForce,
  jointAttackableUnits,
} from './legacyCore';

import type { CityId, ForceId, GameState } from '../types';
import { normalAttackIsCritical, reduceIncomingDamageBySkills, rollNoCounterAttack, rollRepeatNormalAttack } from '../skills/rules/combat';
import { attackableFacilities, attackableUnits } from './targetRules';
import {
  areAdjacent,
  assertUnitTurn,
  damageRoll,
  isCityInAttackRange,
  reduceUnitDamageByFortress,
  removeUnit,
  unitTerrain,
} from './shared';

const NORMAL_ATTACK_CRITICAL_MULTIPLIER = 1.35;

function applyNormalAttackHit(
  next: GameState,
  attackerId: string,
  targetId: string,
  critical: boolean,
) {
  const attacker = next.units[attackerId];
  const target = next.units[targetId];
  if (!attacker || !target) return false;

  const rolledDamage = damageRoll(next, attacker, unitTerrain(next, target), false, target);
  const criticalDamage = critical
    ? Math.round(rolledDamage * NORMAL_ATTACK_CRITICAL_MULTIPLIER)
    : rolledDamage;
  const fortifiedDamage = reduceUnitDamageByFortress(next, target, criticalDamage);
  const damage = reduceIncomingDamageBySkills(next, target, fortifiedDamage, 'normalAttack');
  target.troops -= damage;
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

  if (!applyNormalAttackHit(next, attackerId, targetId, critical)) return next;
  if (rollRepeatNormalAttack(next, nextAttacker)) {
    if (!applyNormalAttackHit(next, attackerId, targetId, critical)) return next;
  }
  const attackerTerrain = unitTerrain(next, nextAttacker);
  if (areAdjacent(nextTarget, nextAttacker) && !rollNoCounterAttack(next, nextAttacker, attackerTerrain)) {
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
  const multiplier = (nextAttacker.troopType ?? 'sword') === 'siege' ? 1.3 : 0.55;
  const damage = Math.max(80, Math.round(damageRoll(next, nextAttacker, 'plain') * multiplier));
  nextFacility.durability = Math.max(0, nextFacility.durability - damage);
  nextAttacker.energy -= 10;
  nextAttacker.acted = true;
  next.facilityRepairReports = [];
  next.strategyResultReports = [];
  if (nextFacility.durability <= 0) delete next.facilities?.[facilityId];
  return next;
}

export function attackCity(state: GameState, forceId: ForceId, attackerId: string, cityId: CityId): GameState {
  const attacker = assertUnitTurn(state, forceId, attackerId);
  const city = state.cities[cityId];
  if (!city) throw new Error('城市不存在');
  if (city.ownerId === forceId) throw new Error('不能攻击己方城市');
  if (attacker.energy < 10) throw new Error('气力不足');
  if (!isCityInAttackRange(state, attacker, city)) throw new Error('城市不在攻击范围');
  const next = structuredClone(state);
  const nextAttacker = next.units[attackerId];
  const nextCity = next.cities[cityId];
  const damage = damageRoll(next, nextAttacker, 'plain');
  const multiplier = (nextAttacker.troopType ?? 'sword') === 'siege' ? 1.4 : 0.2;
  nextCity.troops = Math.max(0, nextCity.troops - Math.round(damage * 0.65));
  nextCity.durability = Math.max(0, nextCity.durability - Math.round(damage * multiplier));
  nextAttacker.energy -= 10;
  nextAttacker.acted = true;
  next.facilityRepairReports = [];
  next.strategyResultReports = [];
  if (nextCity.troops === 0 || nextCity.durability === 0) {
    const oldOwner = nextCity.ownerId;
    nextCity.ownerId = forceId;
    nextCity.order = Math.max(0, nextCity.order - 20);
    nextCity.gold = Math.floor(nextCity.gold / 2);
    nextCity.food = Math.floor(nextCity.food / 2);
    nextCity.governorId = null;
    const garrison = Math.min(1000, Math.floor(nextAttacker.troops * 0.2));
    const transfer = Math.min(garrison, Math.max(0, nextAttacker.troops - 1));
    nextCity.troops = transfer;
    nextAttacker.troops -= transfer;
    nextCity.durability = Math.ceil(nextCity.maxDurability * 0.2);
    for (const officer of Object.values(next.officers)) {
      if (officer.forceId === oldOwner && officer.location.kind === 'city' && officer.location.cityId === cityId) {
        const retreat = Object.values(next.cities).find((candidate) => candidate.ownerId === oldOwner);
        officer.location = retreat ? { kind: 'city', cityId: retreat.id } : { kind: 'unaffiliated', cityId };
        officer.cityId = officer.location.cityId;
      }
    }
  }
  return next;
}
