import type { ArmyUnit, City, Facility, GameState } from '../types';
import { gridKey, neighborsOf, sevenCellCityFootprint, type GridCoord } from './grid';
import { cityCenter, unitIsIncapacitated } from './movementRules';

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

export function unitAttackRange(unit: ArmyUnit) {
  return ['crossbow', 'siege'].includes(unit.troopType ?? 'sword') ? 2 : 1;
}

function isUnitInAttackRange(attacker: ArmyUnit, target: ArmyUnit) {
  const range = unitAttackRange(attacker);
  return gridDistanceWithin(attacker, target, range) <= range;
}

export function isCityInAttackRange(attacker: ArmyUnit, city: City) {
  const range = unitAttackRange(attacker);
  return sevenCellCityFootprint(cityCenter(city)).some((coord) => (
    gridDistanceWithin(attacker, coord, range) <= range
  ));
}

function isFacilityInAttackRange(attacker: ArmyUnit, facility: Facility) {
  const range = unitAttackRange(attacker);
  return gridDistanceWithin(attacker, facility, range) <= range;
}

function isActionableFriendlyUnit(unit: ArmyUnit, forceId: ArmyUnit['forceId']) {
  return unit.forceId === forceId && unit.kind !== 'transport' && !unit.moved && !unit.acted && !unitIsIncapacitated(unit) && unit.movementRemaining > 0;
}

export function attackableUnits(state: GameState, attackerId: string, origin?: GridCoord): ArmyUnit[] {
  const attacker = state.units[attackerId];
  if (!attacker || attacker.kind === 'transport') return [];
  const attackerAtOrigin = origin ? { ...attacker, q: origin.q, r: origin.r } : attacker;
  const range = unitAttackRange(attackerAtOrigin);
  return Object.values(state.units)
    .filter((unit) => unit.id !== attacker.id && unit.forceId !== attacker.forceId && isUnitInAttackRange(attackerAtOrigin, unit))
    .sort((a, b) => (
      gridDistanceWithin(attackerAtOrigin, a, range) - gridDistanceWithin(attackerAtOrigin, b, range) ||
      a.id.localeCompare(b.id)
    ));
}

export function attackableCities(state: GameState, attackerId: string, origin?: GridCoord): City[] {
  const attacker = state.units[attackerId];
  if (!attacker || attacker.kind === 'transport') return [];
  const attackerAtOrigin = origin ? { ...attacker, q: origin.q, r: origin.r } : attacker;
  const range = unitAttackRange(attackerAtOrigin);
  return Object.values(state.cities)
    .filter((city) => city.ownerId !== attacker.forceId && isCityInAttackRange(attackerAtOrigin, city))
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
  const range = unitAttackRange(attackerAtOrigin);
  return Object.values(state.facilities ?? {})
    .filter((facility) => facility.forceId !== attacker.forceId && isFacilityInAttackRange(attackerAtOrigin, facility))
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
