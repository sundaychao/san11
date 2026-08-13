export {
  attackableCities,
  attackableFacilities,
  attackableUnits,
  dispatchTerritoryDefenseForForce,
  jointAttackableUnits,
} from './legacyCore';

import type { CityId, ForceId, GameState } from '../types';
import { attackableFacilities, attackableUnits } from './legacyCore';
import {
  areAdjacent,
  assertUnitTurn,
  damageRoll,
  isCityInAttackRange,
  reduceUnitDamageByFortress,
  removeUnit,
  unitTerrain,
} from './shared';

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
  const damage = reduceUnitDamageByFortress(next, nextTarget, damageRoll(next, nextAttacker, unitTerrain(next, nextTarget), false, nextTarget));
  nextTarget.troops -= damage;
  nextAttacker.energy -= 10;
  nextAttacker.acted = true;
  next.battleDamageReports = [{
    id: `damage-${next.month}-${next.tenDay}-${next.rngCursor}-${targetId}`,
    unitId: targetId, q: nextTarget.q, r: nextTarget.r, amount: damage, kind: 'attack',
  }];
  next.facilityRepairReports = [];
  next.strategyResultReports = [];

  if (nextTarget.troops <= 0) {
    removeUnit(next, nextTarget);
    return next;
  }
  if (areAdjacent(nextTarget, nextAttacker)) {
    const counterDamage = reduceUnitDamageByFortress(next, nextAttacker, damageRoll(next, nextTarget, unitTerrain(next, nextAttacker), true, nextAttacker));
    next.battleDamageReports.push({
      id: `damage-${next.month}-${next.tenDay}-${next.rngCursor}-${attackerId}`,
      unitId: attackerId, q: nextAttacker.q, r: nextAttacker.r, amount: counterDamage, kind: 'counter',
    });
    nextAttacker.troops -= counterDamage;
    if (nextAttacker.troops <= 0) removeUnit(next, nextAttacker);
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
  if (!isCityInAttackRange(attacker, city)) throw new Error('城市不在攻击范围');
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
