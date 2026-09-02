import type { ArmyUnit, City, Facility, GameState } from '../types';
import { techLevelOf } from '../techs';
import { effectsOfKind, resolveUnitSkills } from '../skills';
import { rangedTargetBlockedByForest } from '../skills/rules/combat';
import { gridKey, neighborsOf, sevenCellCityFootprint, type GridCoord } from './grid';
import { cellAt, cityCenter, unitIsIncapacitated } from './movementRules';

export function areAdjacent(a: GridCoord, b: GridCoord) {
  return neighborsOf(a.q, a.r).some((coord) => coord.q === b.q && coord.r === b.r);
}

export function gridDistanceWithin(from: GridCoord, to: GridCoord, maxDistance: number) {
  if (from.q === to.q && from.r === to.r) return 0;
  const seen = new Set<string>([gridKey(from)]);
  let frontier: GridCoord[] = [from];

  for (let distanceStep = 1; distanceStep <= maxDistance; distanceStep += 1) {
    const nextFrontier: GridCoord[] = [];
    for (const current of frontier) {
      for (const neighbor of neighborsOf(current.q, current.r)) {
        const key = gridKey(neighbor);
        if (seen.has(key)) continue;
        if (neighbor.q === to.q && neighbor.r === to.r) return distanceStep;
        seen.add(key);
        nextFrontier.push(neighbor);
      }
    }
    frontier = nextFrontier;
  }

  return Number.POSITIVE_INFINITY;
}

export function unitAttackRange(state: GameState, unit: ArmyUnit) {
  let range = 1;
  if (cellAt(state, unit)?.terrain === 'water') range = 2;
  else if (['crossbow', 'siege'].includes(unit.troopType ?? 'sword')) {
    // 科技：弩兵3级劲弩射程+1
    if (unit.troopType === 'crossbow' && unit.forceId && techLevelOf(state, unit.forceId, 'crossbow') >= 3) range = 3;
    else range = 2;
  }
  // 白马：骑兵可远程攻击；射程：井阑和投石射程+1
  range += skillAttackRangeBonus(state, unit);
  return range;
}

/** 攻击射程特技加成：白马（骑兵+1）/射程（井阑投石+1） */
export function skillAttackRangeBonus(state: GameState, unit: ArmyUnit) {
  const troopType = unit.troopType ?? 'sword';
  const cavalryRanged = effectsOfKind(resolveUnitSkills(state, unit), 'unitAttackRangeBonus')
    .filter(({ effect }) => !effect.troopTypes || effect.troopTypes.includes(troopType))
    .reduce((sum, { effect }) => sum + effect.add, 0);
  const siegeRanged = troopType === 'siege'
    ? effectsOfKind(resolveUnitSkills(state, unit), 'siegeRangeBonus')
      .reduce((sum, { effect }) => sum + effect.add, 0)
    : 0;
  return cavalryRanged + siegeRanged;
}

function isUnitInAttackRange(state: GameState, attacker: ArmyUnit, target: ArmyUnit) {
  const range = unitAttackRange(state, attacker);
  return gridDistanceWithin(attacker, target, range) <= range;
}

export function isCityInAttackRange(state: GameState, attacker: ArmyUnit, city: City) {
  const range = unitAttackRange(state, attacker);
  return sevenCellCityFootprint(cityCenter(city)).some((coord) => (
    gridDistanceWithin(attacker, coord, range) <= range
  ));
}

function isFacilityInAttackRange(state: GameState, attacker: ArmyUnit, facility: Facility) {
  const range = unitAttackRange(state, attacker);
  return gridDistanceWithin(attacker, facility, range) <= range;
}

function isActionableFriendlyUnit(unit: ArmyUnit, forceId: ArmyUnit['forceId']) {
  return unit.forceId === forceId && unit.kind !== 'transport' && !unit.moved && !unit.acted && !unitIsIncapacitated(unit) && unit.movementRemaining > 0;
}

export function attackableUnits(state: GameState, attackerId: string, origin?: GridCoord): ArmyUnit[] {
  const attacker = state.units[attackerId];
  if (!attacker || attacker.kind === 'transport') return [];
  const attackerAtOrigin = origin ? { ...attacker, q: origin.q, r: origin.r } : attacker;
  const range = unitAttackRange(state, attackerAtOrigin);
  return Object.values(state.units)
    .filter((unit) => unit.id !== attacker.id && unit.forceId !== attacker.forceId && isUnitInAttackRange(state, attackerAtOrigin, unit))
    // 射手：无射手特技时弩兵不能攻击森林中的目标
    .filter((unit) => !rangedTargetBlockedByForest(state, attackerAtOrigin, unit))
    .sort((a, b) => (
      gridDistanceWithin(attackerAtOrigin, a, range) - gridDistanceWithin(attackerAtOrigin, b, range) ||
      a.id.localeCompare(b.id)
    ));
}

export function attackableCities(state: GameState, attackerId: string, origin?: GridCoord): City[] {
  const attacker = state.units[attackerId];
  if (!attacker || attacker.kind === 'transport') return [];
  const attackerAtOrigin = origin ? { ...attacker, q: origin.q, r: origin.r } : attacker;
  const range = unitAttackRange(state, attackerAtOrigin);
  return Object.values(state.cities)
    .filter((city) => city.ownerId !== attacker.forceId && isCityInAttackRange(state, attackerAtOrigin, city))
    .sort((a, b) => (
      Math.min(...sevenCellCityFootprint(cityCenter(a)).map((coord) => gridDistanceWithin(attackerAtOrigin, coord, range))) -
      Math.min(...sevenCellCityFootprint(cityCenter(b)).map((coord) => gridDistanceWithin(attackerAtOrigin, coord, range))) ||
      a.id.localeCompare(b.id)
    ));
}

export function attackableFacilities(state: GameState, attackerId: string, origin?: GridCoord): Facility[] {
  const attacker = state.units[attackerId];
  if (!attacker || attacker.kind === 'transport') return [];
  const attackerAtOrigin = origin ? { ...attacker, q: origin.q, r: origin.r } : attacker;
  const range = unitAttackRange(state, attackerAtOrigin);
  return Object.values(state.facilities ?? {})
    .filter((facility) => facility.forceId !== attacker.forceId && isFacilityInAttackRange(state, attackerAtOrigin, facility))
    .sort((a, b) => (
      gridDistanceWithin(attackerAtOrigin, a, range) - gridDistanceWithin(attackerAtOrigin, b, range) ||
      a.id.localeCompare(b.id)
    ));
}

export function jointAttackableUnits(state: GameState, attackerId: string, origin?: GridCoord): ArmyUnit[] {
  const attacker = state.units[attackerId];
  if (!attacker || attacker.kind === 'transport') return [];
  const attackerAtOrigin = origin ? { ...attacker, q: origin.q, r: origin.r } : attacker;
  return Object.values(state.units)
    .filter((target) => (
      target.forceId !== attacker.forceId &&
      areAdjacent(attackerAtOrigin, target) &&
      Object.values(state.units).some((ally) => (
        ally.id !== attacker.id &&
        isActionableFriendlyUnit(ally, attacker.forceId) &&
        areAdjacent(ally, target)
      ))
    ))
    .sort((a, b) => (
      gridDistanceWithin(attackerAtOrigin, a, 1) - gridDistanceWithin(attackerAtOrigin, b, 1) ||
      a.id.localeCompare(b.id)
    ));
}
