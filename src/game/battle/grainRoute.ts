import { movementAllowanceForProfile, movementCostForCell } from './catalog';
import { gridKey, neighborsOf, type GridCoord } from './grid';
import {
  allCityKeys,
  cellAt,
  controlledZoneKeysForForce,
  ownCityTransitKeysFor,
} from './movementRules';
import { passBlockedKeys } from '../passes';
import type { ArmyUnit, CityId, ForceId, GameState } from '../types';

/**
 * 粮道：从本城出发、按「运输队最优寻路」累计 `GRAIN_ROUTE_TEN_DAYS` 旬移动力可达的范围。
 *
 * - 寻路口径与委任跨旬寻路（delegate.optimalPathCells）一致：运输队地形消耗、
 *   本方/空城 footprint 可穿越不停留、敌方城格与部队/设施占用格不可通行、被封锁关隘不可通行；
 * - **敌方 ZOC**（敌方部队 / 城池 / 据点型设施的相邻格，`controlledZoneKeysForForce`）：进入即当旬终止，
 *   该格的累计消耗按「本旬剩余移动力作废」对齐到下一旬边界（`ceil(cost / 旬移动力) × 旬移动力`）；
 * - 预算 = 运输队每旬移动力（`GRAIN_ROUTE_TEN_DAY_STEP`，取自 `movementAllowanceForProfile('transport')`）
 *   × 旬数，不含科技/官职加成（虚拟运输队的基础口径）。
 *
 * 粮道通时，作战部队每旬消耗的一半由本城负担（`turn.ts settleUnitSupply`）；
 * 范围外、本城易主或本城存粮低于 `GRAIN_ROUTE_CITY_FOOD_FLOOR` 时为「粮道受阻」：
 * 部队全额自耗且每旬士气 -3。运输队本身不适用粮道规则。
 */

/** 运输队寻路累计的旬数（粮道半径） */
export const GRAIN_ROUTE_TEN_DAYS = 20;
/** 本城兵粮低于该值时不再向野外部队分摊（粮道受阻） */
export const GRAIN_ROUTE_CITY_FOOD_FLOOR = 20000;
/** 粮道受阻时部队每旬士气下降 */
export const GRAIN_ROUTE_MORALE_LOSS_PER_TEN_DAY = 3;
/** 运输队每旬移动力：粮道的旬粒度（ZOC 对齐与预算都以它为单位） */
export const GRAIN_ROUTE_TEN_DAY_STEP = movementAllowanceForProfile('transport');
/** 粮道总移动力预算：运输队每旬移动力 × 旬数 */
export const GRAIN_ROUTE_MOVEMENT_BUDGET = GRAIN_ROUTE_TEN_DAY_STEP * GRAIN_ROUTE_TEN_DAYS;

/** 小顶堆（按累计消耗优先，惰性删除），与 delegate 的 createMinHeap 同实现 */
function createMinHeap() {
  const heap: { key: string; cost: number }[] = [];
  const swap = (a: number, b: number) => {
    [heap[a], heap[b]] = [heap[b], heap[a]];
  };
  const bubbleUp = (i: number) => {
    while (i > 0) {
      const parent = Math.floor((i - 1) / 2);
      if (heap[parent]!.cost <= heap[i]!.cost) break;
      swap(parent, i);
      i = parent;
    }
  };
  const sinkDown = (i: number) => {
    for (;;) {
      const left = i * 2 + 1;
      const right = left + 1;
      let smallest = i;
      if (left < heap.length && heap[left]!.cost < heap[smallest]!.cost) smallest = left;
      if (right < heap.length && heap[right]!.cost < heap[smallest]!.cost) smallest = right;
      if (smallest === i) break;
      swap(smallest, i);
      i = smallest;
    }
  };
  return {
    get size() { return heap.length; },
    push(key: string, cost: number) {
      heap.push({ key, cost });
      bubbleUp(heap.length - 1);
    },
    pop(): { key: string; cost: number } | undefined {
      if (heap.length === 0) return undefined;
      const top = heap[0]!;
      const last = heap.pop()!;
      if (heap.length > 0) heap[0] = last;
      return top;
    },
  };
}

/**
 * 计算某座城的粮道可达格及其累计移动消耗（`gridKey` → cost，cost ≤ 预算）。
 * 城不存在或无主时返回空表（无粮道）。调用方可用 `cache` 在一次结算内复用（如 settleTenDay 逐部队结算）。
 */
export function grainRouteCostsOf(state: GameState, cityId: CityId, cache?: Map<string, Map<string, number>>): Map<string, number> {
  const cached = cache?.get(cityId);
  if (cached) return cached;
  const costs = computeGrainRouteCosts(state, cityId);
  cache?.set(cityId, costs);
  return costs;
}

/** 粮道可达格集合（仅 key，不含消耗；判定口径的轻量包装） */
export function grainRouteKeysOf(state: GameState, cityId: CityId, cache?: Map<string, Set<string>>): Set<string> {
  const cached = cache?.get(cityId);
  if (cached) return cached;
  const keys = new Set(grainRouteCostsOf(state, cityId).keys());
  cache?.set(cityId, keys);
  return keys;
}

function computeGrainRouteCosts(state: GameState, cityId: CityId): Map<string, number> {
  const city = state.cities[cityId];
  const forceId: ForceId | null | undefined = city?.ownerId;
  if (!city || !forceId) return new Map();

  const start: GridCoord = { q: city.gridQ, r: city.gridR };
  const startKey = gridKey(start);
  const cityKeys = allCityKeys(state);
  const transitKeys = ownCityTransitKeysFor(state, forceId);
  // 阻挡只看敌方：己方部队/设施不挡自家粮道（否则判定部队会挡住自己脚下的格），
  // 与需求口径一致——粮道只受敌方部队、敌方设施（占格 + ZOC）与敌方城的影响。
  const unitKeys = new Set<string>();
  for (const other of Object.values(state.units)) {
    if (other.forceId === forceId) continue;
    unitKeys.add(gridKey(other));
  }
  const facilityKeys = new Set<string>();
  for (const facility of Object.values(state.facilities ?? {})) {
    if (facility.forceId === forceId) continue;
    facilityKeys.add(gridKey(facility));
  }
  const blockedPassKeys = passBlockedKeys(state);
  const zocKeys = controlledZoneKeysForForce(state, forceId);

  const costs = new Map<string, number>([[startKey, 0]]);
  const settled = new Set<string>();
  const heap = createMinHeap();
  heap.push(startKey, 0);

  while (heap.size > 0) {
    const current = heap.pop()!;
    if (settled.has(current.key)) continue;
    settled.add(current.key);
    const baseCost = current.cost;
    const [q, r] = current.key.split(',').map(Number);
    for (const neighbor of neighborsOf(q, r)) {
      const key = gridKey(neighbor);
      if (settled.has(key)) continue;
      const terrainCost = movementCostForCell(cellAt(state, neighbor), 'transport', undefined);
      if (!Number.isFinite(terrainCost)) continue;
      if (cityKeys.has(key) && !transitKeys.has(key)) continue;
      if (unitKeys.has(key)) continue;
      if (facilityKeys.has(key)) continue;
      if (blockedPassKeys.has(key)) continue;
      // 敌方 ZOC：进入即当旬终止，本旬剩余移动力作废 → 该格的累计消耗向上对齐到旬边界
      const rawCost = baseCost + terrainCost;
      const nextCost = zocKeys.has(key) ? Math.ceil(rawCost / GRAIN_ROUTE_TEN_DAY_STEP) * GRAIN_ROUTE_TEN_DAY_STEP : rawCost;
      if (nextCost > GRAIN_ROUTE_MOVEMENT_BUDGET) continue;
      if (costs.has(key) && costs.get(key)! <= nextCost) continue;
      costs.set(key, nextCost);
      heap.push(key, nextCost);
    }
  }

  return costs;
}

/** 粮道是否对该部队受阻。运输队恒不受粮道影响（返回 false，由调用方保持原结算）。 */
export function grainRouteBlockedOf(
  state: GameState,
  unit: ArmyUnit,
  cache?: Map<string, Set<string>>,
): boolean {
  if (unit.kind === 'transport') return false;
  const city = state.cities[unit.homeCityId];
  if (!city || city.ownerId !== unit.forceId) return true;
  if (city.food < GRAIN_ROUTE_CITY_FOOD_FLOOR) return true;
  const keys = grainRouteKeysOf(state, city.id, cache);
  return !keys.has(gridKey(unit));
}
