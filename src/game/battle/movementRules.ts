import { unitIgnoresEnemyZocTerrain } from '../skills/rules/movement';
import type { ArmyUnit, City, CityId, Facility, ForceId, GameState, GridCell } from '../types';
import { gridKey, neighborsOf, sevenCellCityFootprint, type GridCoord } from './grid';
import { movementAllowanceForProfile, movementCostForCell, movementProfileForUnit, ZOC_FACILITY_TYPES, type MovementProfile } from './catalog';

export function cellAt(state: GameState, coord: GridCoord): GridCell | undefined {
  return state.grid.find((cell) => cell.q === coord.q && cell.r === coord.r);
}

export function allCityKeys(state: GameState) {
  const keys = new Set<string>();
  for (const city of Object.values(state.cities)) {
    for (const coord of sevenCellCityFootprint({ q: city.gridQ, r: city.gridR })) {
      keys.add(gridKey(coord));
    }
  }
  return keys;
}

export function occupiedUnitKeys(state: GameState, ignoredUnitId?: string) {
  const keys = new Set<string>();
  for (const unit of Object.values(state.units)) {
    if (unit.id !== ignoredUnitId) keys.add(gridKey(unit));
  }
  return keys;
}

export function occupiedFacilityKeys(state: GameState, ignoredFacilityId?: string) {
  const keys = new Set<string>();
  for (const facility of Object.values(state.facilities ?? {})) {
    if (facility.id !== ignoredFacilityId) keys.add(gridKey(facility));
  }
  return keys;
}

function isCompletedFacility(facility: Facility) {
  return facility.completed !== false;
}

export function unitIsIncapacitated(unit: Pick<ArmyUnit, 'confusedTenDays' | 'falseReportedTenDays'>) {
  return Boolean(unit.confusedTenDays || unit.falseReportedTenDays);
}

export function cityCenter(city: City): GridCoord {
  return { q: city.gridQ, r: city.gridR };
}

function controlledZoneKeysForForce(state: GameState, forceId: ForceId) {
  const keys = new Set<string>();
  const addNeighbors = (coord: GridCoord) => {
    for (const neighbor of neighborsOf(coord.q, coord.r)) keys.add(gridKey(neighbor));
  };

  for (const unit of Object.values(state.units)) {
    if (unit.forceId === forceId || unit.kind === 'transport' || unitIsIncapacitated(unit)) continue;
    addNeighbors(unit);
  }

  for (const city of Object.values(state.cities)) {
    if (city.ownerId === forceId) continue;
    for (const coord of sevenCellCityFootprint(cityCenter(city))) addNeighbors(coord);
  }

  for (const facility of Object.values(state.facilities ?? {})) {
    if (facility.forceId === forceId || !isCompletedFacility(facility) || !ZOC_FACILITY_TYPES.has(facility.type)) continue;
    addNeighbors(facility);
  }

  return keys;
}

function movementCost(state: GameState, coord: GridCoord, profile: MovementProfile = 'sword', vehicle?: 'boat' | 'ship') {
  return movementCostForCell(cellAt(state, coord), profile, vehicle);
}

export function isLegalUnitCell(state: GameState, coord: GridCoord, ignoredUnitId?: string, profile: MovementProfile = 'sword') {
  const key = gridKey(coord);
  return Number.isFinite(movementCost(state, coord, profile)) &&
    !allCityKeys(state).has(key) &&
    !occupiedUnitKeys(state, ignoredUnitId).has(key) &&
    !occupiedFacilityKeys(state).has(key);
}

function distance(a: GridCoord, b: GridCoord) {
  return Math.abs(a.q - b.q) + Math.abs(a.r - b.r);
}

export function spawnCellFor(state: GameState, city: City, target: City, profile: MovementProfile = 'sword', vehicle?: 'boat' | 'ship') {
  const cityKeys = new Set(sevenCellCityFootprint(cityCenter(city)).map(gridKey));
  const candidates = new Map<string, GridCoord>();
  for (const coord of sevenCellCityFootprint(cityCenter(city))) {
    for (const neighbor of neighborsOf(coord.q, coord.r)) {
      const key = gridKey(neighbor);
      if (!cityKeys.has(key)) candidates.set(key, neighbor);
    }
  }
  const reachable = new Set(deploymentCells(state, city.id, movementAllowanceForProfile(profile), profile, vehicle).map(gridKey));
  return [...candidates.values()]
    .filter((coord) => isLegalUnitCell(state, coord, undefined, profile) && reachable.has(gridKey(coord)))
    .sort((a, b) => distance(a, cityCenter(target)) - distance(b, cityCenter(target)) || a.q - b.q || a.r - b.r)[0];
}

function reachableCostsFrom(
  state: GameState,
  start: GridCoord,
  movementBudget: number,
  profile: MovementProfile,
  options: { ignoredUnitId?: string; allowedCityTransitKeys?: Set<string>; movingForceId?: ForceId; ignoreEnemyZoc?: 'land' | 'water' | null; vehicle?: 'boat' | 'ship' } = {},
) {
  const startKey = gridKey(start);
  const startOnWater = cellAt(state, start)?.terrain === 'water';
  const costs = new Map<string, number>([[startKey, 0]]);
  const ferryChain = new Set<string>();
  const frontier: GridCoord[] = [{ q: start.q, r: start.r }];
  const cityKeys = allCityKeys(state);
  const unitKeys = occupiedUnitKeys(state, options.ignoredUnitId);
  const facilityKeys = occupiedFacilityKeys(state);
  const zocKeys = options.movingForceId ? controlledZoneKeysForForce(state, options.movingForceId) : new Set<string>();

  while (frontier.length > 0) {
    const current = frontier.shift()!;
    const currentKey = gridKey(current);
    const currentTerrain = cellAt(state, current)?.terrain;
    const isWater = currentTerrain === 'water';
    const ignoresZocHere = options.ignoreEnemyZoc === 'land'
      ? !isWater
      : options.ignoreEnemyZoc === 'water'
        ? isWater
        : false;
    if (currentKey !== startKey && zocKeys.has(currentKey) && !ignoresZocHere) continue;

    const currentCost = costs.get(currentKey)!;
    for (const neighbor of neighborsOf(current.q, current.r)) {
      const key = gridKey(neighbor);
      const canTransitCity = options.allowedCityTransitKeys?.has(key) ?? false;
      const terrainCost = movementCost(state, neighbor, profile, options.vehicle);
      if (!Number.isFinite(terrainCost)) continue;
      if (!canTransitCity && cityKeys.has(key)) continue;
      if (unitKeys.has(key)) continue;
      if (facilityKeys.has(key)) continue;
      const nextCost = currentCost + terrainCost;
      if (nextCost > movementBudget) continue;
      if (costs.has(key) && costs.get(key)! <= nextCost) continue;
      costs.set(key, nextCost);
      const neighborTerrain = cellAt(state, neighbor)?.terrain;
      if (neighborTerrain === 'water' && !startOnWater) {
        const transitWater = currentTerrain === 'ferry' || ferryChain.has(currentKey);
        if (!transitWater) continue;
        ferryChain.add(key);
      }
      if (neighborTerrain === 'shore') continue;
      frontier.push(neighbor);
    }
  }

  return costs;
}

export function reachableCosts(state: GameState, unit: ArmyUnit) {
  return reachableCostsFrom(state, unit, unit.movementRemaining, movementProfileForUnit(unit), {
    ignoredUnitId: unit.id,
    movingForceId: unit.forceId,
    ignoreEnemyZoc: unitIgnoresEnemyZocTerrain(state, unit),
    vehicle: unit.vehicle,
  });
}

export function movementCells(state: GameState, unitId: string): GridCoord[] {
  const unit = state.units[unitId];
  if (!unit || unit.moved || unitIsIncapacitated(unit) || unit.movementRemaining <= 0) return [];
  return [...reachableCosts(state, unit).entries()]
    .filter(([key]) => key !== gridKey(unit))
    .map(([key]) => {
      const [q, r] = key.split(',').map(Number);
      return { q, r };
    })
    .sort((a, b) => a.q - b.q || a.r - b.r);
}

export function deploymentCells(state: GameState, cityId: CityId, movement?: number, profile: MovementProfile = 'sword', vehicle?: 'boat' | 'ship'): GridCoord[] {
  const city = state.cities[cityId];
  if (!city) return [];
  const movementBudget = movement ?? movementAllowanceForProfile(profile);
  const start = cityCenter(city);
  const ownCityKeys = new Set(sevenCellCityFootprint(start).map(gridKey));
  const cityKeys = allCityKeys(state);
  const costs = reachableCostsFrom(state, start, movementBudget, profile, {
    allowedCityTransitKeys: ownCityKeys,
    movingForceId: city.ownerId,
    vehicle,
  });

  return [...costs.entries()]
    .filter(([key]) => key !== gridKey(start) && !cityKeys.has(key))
    .map(([key]) => {
      const [q, r] = key.split(',').map(Number);
      return { q, r };
    })
    .sort((a, b) => a.q - b.q || a.r - b.r);
}
