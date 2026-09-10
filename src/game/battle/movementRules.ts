import { unitIgnoresEnemyZocTerrain } from '../skills/rules/movement';
import type { ArmyUnit, City, CityId, Facility, ForceId, GameState, GridCell } from '../types';
import { gridKey, neighborsOf, sevenCellCityFootprint, type GridCoord } from './grid';
import { isWaterTerrain, movementAllowanceForProfile, movementCostForCell, movementProfileForUnit, ZOC_FACILITY_TYPES, type MovementProfile } from './catalog';
import { passBlockedKeys, passCenterBlockedFor } from '../passes';

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
    // 无主城不产生控制区
    if (!city.ownerId || city.ownerId === forceId) continue;
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

export function isLegalUnitCell(state: GameState, coord: GridCoord, ignoredUnitId?: string, profile: MovementProfile = 'sword', forceId?: ForceId) {
  const key = gridKey(coord);
  return Number.isFinite(movementCost(state, coord, profile)) &&
    !allCityKeys(state).has(key) &&
    !passBlockedKeys(state).has(key) &&
    // 敌方关隘中心格不可通行（己方/无主关隘可通行）
    !passCenterBlockedFor(state, coord, forceId) &&
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
  const costs = new Map<string, number>([[startKey, 0]]);
  const ferryChain = new Set<string>();
  const frontier: GridCoord[] = [{ q: start.q, r: start.r }];
  const cityKeys = allCityKeys(state);
  const unitKeys = occupiedUnitKeys(state, options.ignoredUnitId);
  const facilityKeys = occupiedFacilityKeys(state);
  const blockedPassKeys = passBlockedKeys(state);
  const zocKeys = options.movingForceId ? controlledZoneKeysForForce(state, options.movingForceId) : new Set<string>();

  while (frontier.length > 0) {
    const current = frontier.shift()!;
    const currentKey = gridKey(current);
    const currentTerrain = cellAt(state, current)?.terrain;
    const isWater = isWaterTerrain(currentTerrain);
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
      if (blockedPassKeys.has(key)) continue;
      // 敌方关隘中心格不可通行（己方/无主关隘可通行）
      if (passCenterBlockedFor(state, neighbor, options.movingForceId)) continue;
      const neighborTerrain = cellAt(state, neighbor)?.terrain;

      // 横跨水域边界：陆地<->水域（河/海/川；浅滩/渡所是地面不算水面）。
      const currentIsWater = isWaterTerrain(currentTerrain);
      const neighborIsWater = isWaterTerrain(neighborTerrain);
      const crossesWaterBoundary = currentIsWater !== neighborIsWater;
      // 经渡口横跨允许继续（渡口桥接），不受"需停留边界"限制
      const viaFerry = crossesWaterBoundary && (currentTerrain === 'ferry' || neighborTerrain === 'ferry' || ferryChain.has(currentKey));
      if (viaFerry) {
        ferryChain.add(currentKey);
        ferryChain.add(key);
      }

      let nextCost: number;
      let isTerminal = false;
      if (viaFerry) {
        nextCost = currentCost + terrainCost;
      } else if (crossesWaterBoundary) {
        // 非渡口跨界：只有当部队本回合从该边界格出发时才能跨一步入水/登岸
        // （即前一回合必须已停留在边界格）。否则本回合最多到达边界、不能越界；
        // 跨界格消耗全部行动力并作为终点、不再扩展。
        if (currentKey !== startKey) continue;
        nextCost = movementBudget;
        isTerminal = true;
      } else {
        nextCost = currentCost + terrainCost;
      }

      if (nextCost > movementBudget) continue;
      if (costs.has(key) && costs.get(key)! <= nextCost) continue;
      costs.set(key, nextCost);
      if (!isTerminal) frontier.push(neighbor);
    }
  }

  return costs;
}

/** 本方城池 footprint 格集合（可穿越 + 可作为移动终点/回城）；无守军的无主城同样可穿越/进驻 */
export function ownCityTransitKeysFor(state: GameState, forceId: ForceId): Set<string> {
  const keys = new Set<string>();
  for (const city of Object.values(state.cities)) {
    const enterable = city.ownerId === forceId || (city.ownerId === null && city.troops === 0);
    if (!enterable) continue;
    for (const coord of sevenCellCityFootprint({ q: city.gridQ, r: city.gridR })) {
      keys.add(gridKey(coord));
    }
  }
  return keys;
}

/** 目标格所属的本方城池（在 footprint 内则返回该城） */
export function ownCityAt(state: GameState, forceId: ForceId, coord: GridCoord): City | undefined {
  for (const city of Object.values(state.cities)) {
    if (city.ownerId !== forceId) continue;
    for (const cell of sevenCellCityFootprint({ q: city.gridQ, r: city.gridR })) {
      if (cell.q === coord.q && cell.r === coord.r) return city;
    }
  }
  return undefined;
}

/** 目标格所属的无守军无主城（在 footprint 内则返回该城，部队进入即占领） */
export function unoccupiedCityAt(state: GameState, coord: GridCoord): City | undefined {
  for (const city of Object.values(state.cities)) {
    if (city.ownerId !== null || city.troops > 0) continue;
    for (const cell of sevenCellCityFootprint({ q: city.gridQ, r: city.gridR })) {
      if (cell.q === coord.q && cell.r === coord.r) return city;
    }
  }
  return undefined;
}

export function reachableCosts(state: GameState, unit: ArmyUnit) {
  return reachableCostsFrom(state, unit, unit.movementRemaining, movementProfileForUnit(unit), {
    ignoredUnitId: unit.id,
    movingForceId: unit.forceId,
    ignoreEnemyZoc: unitIgnoresEnemyZocTerrain(state, unit),
    vehicle: unit.vehicle,
    allowedCityTransitKeys: ownCityTransitKeysFor(state, unit.forceId),
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
    movingForceId: city.ownerId ?? undefined,
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
