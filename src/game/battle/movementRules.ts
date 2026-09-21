import { unitIgnoresEnemyZocTerrain } from '../skills/rules/movement';
import type { ArmyUnit, City, CityId, Facility, ForceId, GameState, GridCell, PassId, TerrainType } from '../types';
import { gridKey, neighborsOf, sevenCellCityFootprint, type GridCoord } from './grid';
import { isWaterTerrain, movementAllowanceForProfile, movementCostForCell, movementProfileForUnit, ZOC_FACILITY_TYPES, type MovementProfile } from './catalog';
import { passBlockedKeys, passCenterBlockedFor } from '../passes';
import { canCrossRoughTerrain, enemyTerritoryMoveCostBonus } from '../techs';
import { territoryForceAt } from '../territory';

/**
 * grid 坐标索引缓存：state.grid 是长度数万的数组，cellAt 原先是 O(n) 线性扫描，
 * 一次全图 Dijkstra（数十万次取格）会因此慢到秒级。这里按 grid 数组引用缓存
 * "q,r → cell"，把取格降到 O(1)。生产代码只会整体替换 state.grid（structuredClone / map），
 * 不会原地改写格内容，因此按数组引用缓存是安全的（原地改写会拿到新数组，索引随之重建）。
 */
const cellIndexByGrid = new WeakMap<GameState['grid'], Map<string, GridCell>>();

function cellIndexFor(grid: GameState['grid']): Map<string, GridCell> {
  const cached = cellIndexByGrid.get(grid);
  if (cached) return cached;
  const index = new Map<string, GridCell>();
  for (const cell of grid) index.set(`${cell.q},${cell.r}`, cell);
  cellIndexByGrid.set(grid, index);
  return index;
}

export function cellAt(state: GameState, coord: GridCoord): GridCell | undefined {
  return cellIndexFor(state.grid).get(`${coord.q},${coord.r}`);
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

/** 敌方控制区（ZOC）格集合：敌方部队（运输队/混乱者除外）、敌方城 footprint、敌方 ZOC 设施的相邻格。
 *  粮道计算（grainRoute）与每旬移动共用本口径。 */
export function controlledZoneKeysForForce(state: GameState, forceId: ForceId) {
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

/**
 * 「进入即被迫当旬停留」的格集合（对该部队而言）。
 *
 * 即敌方控制区里**该部队无法忽略**的部分：飞将（陆地忽略）/ 推进（水上忽略）这类特技
 * 只豁免对应地形的 ZOC，故本函数按 `unitIgnoresEnemyZocTerrain` 逐格剔除。
 * 与 `reachableCostsFrom` 内的 `isWater → ignoresZocHere → continue` 判据同规则，
 * 供委任落点选取（delegate 的反向距离搜索）复用以保持正反向口径一致。
 */
export function forceStopKeysForUnit(state: GameState, unit: ArmyUnit): Set<string> {
  const zocKeys = controlledZoneKeysForForce(state, unit.forceId);
  const ignore = unitIgnoresEnemyZocTerrain(state, unit);
  if (!ignore) return zocKeys;
  const keys = new Set<string>();
  for (const key of zocKeys) {
    const [q, r] = key.split(',').map(Number);
    const isWater = isWaterTerrain(cellAt(state, { q, r })?.terrain);
    const ignoresHere = ignore === 'land' ? !isWater : isWater;
    if (!ignoresHere) keys.add(key);
  }
  return keys;
}

function movementCost(state: GameState, coord: GridCoord, profile: MovementProfile = 'sword', vehicle?: 'boat' | 'ship') {
  return movementCostForCell(cellAt(state, coord), profile, vehicle);
}

/**
 * 科技「开路军」：小径、浅滩、川地形默认不可进入，研究后才能通行（山崖始终不可通行）。
 * 栈道不额外扣兵（开路军的「经过栈道不损失士兵」体现在这里）。
 */
const ROUGH_TERRAINS: readonly TerrainType[] = ['path', 'shallow', 'stream'];

function terrainBlockedByTech(state: GameState, coord: GridCoord, forceId?: ForceId): boolean {
  const terrain = cellAt(state, coord)?.terrain;
  if (!terrain || !ROUGH_TERRAINS.includes(terrain)) return false;
  return !canCrossRoughTerrain(state, forceId);
}

/**
 * 科技「修筑要塞」：敌军在我方领地内移动时，每种地形的消耗 +1。
 * 领地按 territoryForceAt 判定；己方/无主领地不受影响。
 */
function enemyTerritoryMoveCost(state: GameState, coord: GridCoord, movingForceId?: ForceId): number {
  if (!movingForceId) return 0;
  const owner = territoryForceAt(state, coord);
  if (!owner || owner === movingForceId) return 0;
  return enemyTerritoryMoveCostBonus(state, owner);
}

/** 开路军研究后，川（stream）按可涉渡的浅水处理：可通行（消耗 5）且不再触发水域边界规则 */
function streamFordableByForce(state: GameState, coord: GridCoord, forceId?: ForceId): boolean {
  return cellAt(state, coord)?.terrain === 'stream' && canCrossRoughTerrain(state, forceId);
}

function movementCostForForce(
  state: GameState,
  coord: GridCoord,
  profile: MovementProfile,
  vehicle: 'boat' | 'ship' | undefined,
  forceId?: ForceId,
): number {
  if (streamFordableByForce(state, coord, forceId)) return 5;
  return movementCost(state, coord, profile, vehicle);
}

export function isLegalUnitCell(state: GameState, coord: GridCoord, ignoredUnitId?: string, profile: MovementProfile = 'sword', forceId?: ForceId) {
  const key = gridKey(coord);
  return Number.isFinite(movementCostForForce(state, coord, profile, undefined, forceId)) &&
    !terrainBlockedByTech(state, coord, forceId) &&
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
      const terrainCost = movementCostForForce(state, neighbor, profile, options.vehicle, options.movingForceId);
      if (!Number.isFinite(terrainCost)) continue;
      // 科技「开路军」：未研究时小径／浅滩／川不可通行
      if (terrainBlockedByTech(state, neighbor, options.movingForceId)) continue;
      // 科技「修筑要塞」：敌军在我方领地内每种地形的移动消耗 +1
      const intrusionCost = enemyTerritoryMoveCost(state, neighbor, options.movingForceId);
      if (!canTransitCity && cityKeys.has(key)) continue;
      if (unitKeys.has(key)) continue;
      if (facilityKeys.has(key)) continue;
      if (blockedPassKeys.has(key)) continue;
      // 敌方关隘中心格不可通行（己方/无主关隘可通行）
      if (passCenterBlockedFor(state, neighbor, options.movingForceId)) continue;
      const neighborTerrain = cellAt(state, neighbor)?.terrain;

      // 横跨水域边界：陆地<->水域（河/海/川；浅滩/渡所是地面不算水面）。
      const currentIsWater = isWaterTerrain(currentTerrain);
      const neighborIsWater = streamFordableByForce(state, neighbor, options.movingForceId)
        ? false
        : isWaterTerrain(neighborTerrain);
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
        nextCost = currentCost + terrainCost + intrusionCost;
      } else if (crossesWaterBoundary) {
        // 非渡口跨界：只有当部队本回合从该边界格出发时才能跨一步入水/登岸
        // （即前一回合必须已停留在边界格）。否则本回合最多到达边界、不能越界；
        // 跨界格消耗全部行动力并作为终点、不再扩展。
        if (currentKey !== startKey) continue;
        nextCost = movementBudget;
        isTerminal = true;
      } else {
        nextCost = currentCost + terrainCost + intrusionCost;
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

/**
 * 从据点（城池中心或关隘锚点）可达的落位格与其移动消耗（键为 gridKey）。
 * deploymentCells / deploymentCellsForStronghold 与出征落位扣减移动力共用同一口径，
 * 保证「实际行军不会超出出征时显示的可移动范围」。
 */
export function deploymentCostsForStronghold(
  state: GameState,
  sourceId: CityId | PassId,
  movement?: number,
  profile: MovementProfile = 'sword',
  vehicle?: 'boat' | 'ship',
): Map<string, number> {
  const movementBudget = movement ?? movementAllowanceForProfile(profile);
  const pass = state.passes?.[sourceId as PassId];
  if (pass) {
    const start = { q: pass.q, r: pass.r };
    return reachableCostsFrom(state, start, movementBudget, profile, {
      allowedCityTransitKeys: new Set([gridKey(start)]),
      movingForceId: pass.ownerId ?? undefined,
      vehicle,
    });
  }
  const city = state.cities[sourceId as CityId];
  if (!city) return new Map();
  const start = cityCenter(city);
  const ownCityKeys = new Set(sevenCellCityFootprint(start).map(gridKey));
  return reachableCostsFrom(state, start, movementBudget, profile, {
    allowedCityTransitKeys: ownCityKeys,
    movingForceId: city.ownerId ?? undefined,
    vehicle,
  });
}

/** 从城池出发可放置部队的格子：消耗不超过移动力预算，且不含任何城池格 */
export function deploymentCells(state: GameState, cityId: CityId, movement?: number, profile: MovementProfile = 'sword', vehicle?: 'boat' | 'ship'): GridCoord[] {
  const city = state.cities[cityId];
  if (!city) return [];
  const costs = deploymentCostsForStronghold(state, cityId, movement, profile, vehicle);
  const cityKeys = allCityKeys(state);

  return [...costs.entries()]
    .filter(([key]) => key !== gridKey(cityCenter(city)) && !cityKeys.has(key))
    .map(([key]) => {
      const [q, r] = key.split(',').map(Number);
      return { q, r };
    })
    .sort((a, b) => a.q - b.q || a.r - b.r);
}

/** 全部关隘锚点格集合（单格据点，落位需排除） */
export function allPassAnchorKeys(state: Pick<GameState, 'passes'>): Set<string> {
  return new Set(Object.values(state.passes ?? {}).map((pass) => gridKey(pass)));
}

/**
 * 从据点（城池或关隘）计算出征/输送落位格。
 * 关隘为单格据点：从锚点出发可达的格，排除其它城池格与全部关隘锚点/翼格。
 */
export function deploymentCellsForStronghold(
  state: GameState,
  sourceId: CityId | PassId,
  movement?: number,
  profile: MovementProfile = 'sword',
  vehicle?: 'boat' | 'ship',
): GridCoord[] {
  const pass = state.passes?.[sourceId as PassId];
  if (!pass) return deploymentCells(state, sourceId as CityId, movement, profile, vehicle);
  const costs = deploymentCostsForStronghold(state, sourceId, movement, profile, vehicle);
  const start = { q: pass.q, r: pass.r };
  const excluded = new Set([...allCityKeys(state), ...passBlockedKeys(state), ...allPassAnchorKeys(state)]);
  return [...costs.entries()]
    .filter(([key]) => key !== gridKey(start) && !excluded.has(key))
    .map(([key]) => {
      const [q, r] = key.split(',').map(Number);
      return { q, r };
    })
    .sort((a, b) => a.q - b.q || a.r - b.r);
}
