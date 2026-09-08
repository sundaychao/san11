import type { ArmyUnit, FacilityType, ForceId, GameState, UnitDelegate } from '../types';
import { gridKey, neighborsOf, type GridCoord } from './grid';
import {
  allCityKeys,
  cellAt,
  occupiedFacilityKeys,
  occupiedUnitKeys,
  ownCityTransitKeysFor,
  reachableCosts,
  unitIsIncapacitated,
} from './movementRules';
import { movementAllowanceForUnit, movementCostForCell, movementProfileForUnit } from './catalog';
import { FACILITY_BUILD_COSTS, facilityBuildTargets, facilityIsCompleted, repairableFacilities } from './legacyCore';
import { buildFacility, repairFacility } from './facilities';
import { moveUnit } from './movement';
import { assertUnitTurn } from './shared';

interface PathOptions {
  ignoredUnitId?: string;
  allowedCityTransitKeys?: Set<string>;
  movingForceId?: ForceId;
  vehicle?: 'boat' | 'ship';
  profile?: ReturnType<typeof movementProfileForUnit>;
}

/**
 * 计算从 start 到 target 的最优（移动消耗最低）路径，返回 [start, ..., target]；
 * 无法到达时返回 undefined。与每旬移动不同，跨水域边界不要求先停在边界（可跨旬停顿后继续）。
 */
export function optimalPathCells(state: GameState, start: GridCoord, target: GridCoord, options: PathOptions = {}): GridCoord[] | undefined {
  const startKey = gridKey(start);
  const targetKey = gridKey(target);
  if (startKey === targetKey) return [start];
  const cityKeys = allCityKeys(state);
  const unitKeys = occupiedUnitKeys(state, options.ignoredUnitId);
  const facilityKeys = occupiedFacilityKeys(state);
  const profile = options.profile ?? 'sword';
  const costs = new Map<string, number>([[startKey, 0]]);
  const parents = new Map<string, string>();
  const settled = new Set<string>();
  // 简单二叉堆（按累计消耗最小优先）
  const heap: { key: string; cost: number }[] = [{ key: startKey, cost: 0 }];
  const heapIndex = new Map<string, number>([[startKey, 0]]);
  const bubbleUp = (index: number) => {
    while (index > 0) {
      const parent = Math.floor((index - 1) / 2);
      if (heap[parent].cost <= heap[index].cost) break;
      [heap[parent], heap[index]] = [heap[index], heap[parent]];
      heapIndex.set(heap[parent].key, parent);
      heapIndex.set(heap[index].key, index);
      index = parent;
    }
  };
  const sinkDown = (index: number) => {
    for (;;) {
      const left = index * 2 + 1;
      const right = left + 1;
      let smallest = index;
      if (left < heap.length && heap[left].cost < heap[smallest].cost) smallest = left;
      if (right < heap.length && heap[right].cost < heap[smallest].cost) smallest = right;
      if (smallest === index) break;
      [heap[smallest], heap[index]] = [heap[index], heap[smallest]];
      heapIndex.set(heap[smallest].key, smallest);
      heapIndex.set(heap[index].key, index);
      index = smallest;
    }
  };

  while (heap.length > 0) {
    const current = heap[0]!;
    const last = heap.pop()!;
    if (heap.length > 0) {
      heap[0] = last;
      heapIndex.set(last.key, 0);
      sinkDown(0);
    }
    heapIndex.delete(current.key);
    settled.add(current.key);
    if (current.key === targetKey) break;
    if (costs.get(current.key)! < current.cost) continue;
    const [q, r] = current.key.split(',').map(Number);
    for (const neighbor of neighborsOf(q, r)) {
      const key = gridKey(neighbor);
      if (settled.has(key)) continue;
      const terrainCost = movementCostForCell(cellAt(state, neighbor), profile, options.vehicle);
      if (!Number.isFinite(terrainCost)) continue;
      if (!(options.allowedCityTransitKeys?.has(key) ?? false) && cityKeys.has(key)) continue;
      if (unitKeys.has(key)) continue;
      if (facilityKeys.has(key)) continue;
      const nextCost = current.cost + terrainCost;
      if (costs.has(key) && costs.get(key)! <= nextCost) continue;
      costs.set(key, nextCost);
      parents.set(key, current.key);
      if (heapIndex.has(key)) {
        const index = heapIndex.get(key)!;
        heap[index] = { key, cost: nextCost };
        bubbleUp(index);
      } else {
        heap.push({ key, cost: nextCost });
        heapIndex.set(key, heap.length - 1);
        bubbleUp(heap.length - 1);
      }
    }
  }

  if (!parents.has(targetKey)) return undefined;
  const path: GridCoord[] = [];
  let cursor = targetKey;
  while (cursor !== startKey) {
    const [q, r] = cursor.split(',').map(Number);
    path.push({ q, r });
    cursor = parents.get(cursor)!;
  }
  path.reverse();
  return [start, ...path];
}

/** 本回合沿最优路径能到达的最远格（path 上第一个在 reachableCosts 内的格，从目标端倒查） */
function farthestReachableAlongPath(state: GameState, unit: ArmyUnit, path: GridCoord[]): GridCoord | undefined {
  const reachable = reachableCosts(state, unit);
  const startKey = gridKey(unit);
  for (let i = path.length - 1; i >= 0; i -= 1) {
    if (gridKey(path[i]) === startKey) break;
    if (reachable.has(gridKey(path[i]))) return path[i];
  }
  return undefined;
}

function pathOptionsFor(state: GameState, unit: ArmyUnit): PathOptions {
  return {
    ignoredUnitId: unit.id,
    movingForceId: unit.forceId,
    vehicle: unit.vehicle,
    profile: movementProfileForUnit(unit),
    allowedCityTransitKeys: ownCityTransitKeysFor(state, unit.forceId),
  };
}

/** 移动委任一步：本回合沿最优路径向 target 移动最远距离；已到达则结束委任。
 * 建设/修补委任通过 preserveDelegate 保留原委任类型（部队只靠近到与目标相接的格，不站上目标）。 */
function delegateMoveStep(state: GameState, forceId: ForceId, unitId: string, target: GridCoord, preserveDelegate?: UnitDelegate): GameState {
  const unit = state.units[unitId];
  if (!unit || unit.acted || unit.moved || unitIsIncapacitated(unit)) return state;
  if (unit.q === target.q && unit.r === target.r) {
    // 已站在目标格：移动委任到达即结束；建设/修补委任保持（由上层继续建设）
    if (!preserveDelegate) {
      const next = structuredClone(state);
      delete next.units[unitId].delegate;
      return next;
    }
    return state;
  }
  const path = optimalPathCells(state, { q: unit.q, r: unit.r }, target, pathOptionsFor(state, unit));
  if (!path) return state; // 无法到达：保留委任，下旬重试
  const dest = farthestReachableAlongPath(state, unit, path);
  if (!dest) return state; // 本回合无法前进（如被围）：保留委任
  const next = moveUnit(state, forceId, unitId, dest);
  if (!next.units[unitId]) return next; // 回城/进驻：部队消失，委任自然结束
  if (preserveDelegate) {
    // 建设/修补委任：移动后保持原委任，未到达目标格前持续靠近
    next.units[unitId].delegate = preserveDelegate;
  } else if (dest.q === target.q && dest.r === target.r) {
    delete next.units[unitId].delegate;
  } else {
    next.units[unitId].delegate = { kind: 'move', target };
  }
  return next;
}

/** 建设委任一步：已相邻且目标可建设则建设（未完成转修补委任），否则沿最优路径靠近 */
function delegateBuildStep(state: GameState, forceId: ForceId, unitId: string, target: GridCoord, facility: FacilityType): GameState {
  const unit = state.units[unitId];
  if (!unit || unit.acted || unit.moved || unitIsIncapacitated(unit)) return state;
  const adjacent = neighborsOf(unit.q, unit.r).some((coord) => coord.q === target.q && coord.r === target.r);
  if (adjacent) {
    if ((unit.gold ?? 0) >= FACILITY_BUILD_COSTS[facility]
      && facilityBuildTargets(state, unitId, undefined, facility).some((coord) => coord.q === target.q && coord.r === target.r)) {
      const next = buildFacility(state, forceId, unitId, facility, target);
      // buildFacility 内部已按建成情况设置/清除修补委任
      return next;
    }
    // 已相邻但资金不足/位置暂不可建设：保持委任，每旬重试
    return state;
  }
  // 未相邻：沿最优路径靠近到「与目标相接的格」，避免直接站上目标格导致无法建设
  const path = optimalPathCells(state, { q: unit.q, r: unit.r }, target, pathOptionsFor(state, unit));
  if (!path || path.length < 2) return state;
  const approachTarget = path[path.length - 2];
  // 首回合发起时部队尚无委任，需用本次建设委任作为移动期间的保留委任
  const movingDelegate: UnitDelegate = unit.delegate ?? { kind: 'build', target, facility };
  return delegateMoveStep(state, forceId, unitId, approachTarget, movingDelegate);
}

/** 修补委任一步：已相邻且设施未完成则修补（内部保持委任至建成），否则沿最优路径靠近 */
function delegateRepairStep(state: GameState, forceId: ForceId, unitId: string, facilityId: string): GameState {
  const unit = state.units[unitId];
  if (!unit || unit.acted || unit.moved || unitIsIncapacitated(unit)) return state;
  const facility = state.facilities?.[facilityId];
  if (!facility || facilityIsCompleted(facility)) {
    const next = structuredClone(state);
    delete next.units[unitId].delegate;
    return next;
  }
  if (repairableFacilities(state, unitId).some((candidate) => candidate.id === facilityId)) {
    const next = repairFacility(state, forceId, unitId, facilityId);
    // repairFacility 内部已按建成情况保持/清除修补委任
    return next;
  }
  // 未相邻：沿最优路径靠近到「与设施相接的格」，避免直接站上设施格
  const path = optimalPathCells(state, { q: unit.q, r: unit.r }, { q: facility.q, r: facility.r }, pathOptionsFor(state, unit));
  if (!path || path.length < 2) return state;
  const approachTarget = path[path.length - 2];
  return delegateMoveStep(state, forceId, unitId, approachTarget, unit.delegate);
}

/** 执行单个部队的委任（仅未手动操作、未混乱的部队） */
export function executeUnitDelegation(state: GameState, forceId: ForceId, unitId: string): GameState {
  const unit = state.units[unitId];
  if (!unit?.delegate || unit.acted || unit.moved || unitIsIncapacitated(unit)) return state;
  if (unit.delegate.kind === 'move') return delegateMoveStep(state, forceId, unitId, unit.delegate.target);
  if (unit.delegate.kind === 'build') return delegateBuildStep(state, forceId, unitId, unit.delegate.target, unit.delegate.facility);
  return delegateRepairStep(state, forceId, unitId, unit.delegate.facilityId);
}

/** 点击「进行」时：对当前行动势力的所有委任部队自动执行一步 */
export function executeDelegations(state: GameState): GameState {
  let next = state;
  for (const unit of Object.values(next.units)) {
    if (unit.forceId !== next.turnForceId || !unit.delegate) continue;
    next = executeUnitDelegation(next, next.turnForceId, unit.id);
  }
  return next;
}

/** 玩家发起移动委任：本回合沿最优路径移动到最远处并记录委任目标 */
export function setMoveDelegate(state: GameState, forceId: ForceId, unitId: string, target: GridCoord): GameState {
  return delegateMoveStep(state, forceId, unitId, target);
}

/** 玩家发起建设委任：先沿最优路径向建设点移动，到达相邻处自动设置设施 */
export function setBuildDelegate(state: GameState, forceId: ForceId, unitId: string, target: GridCoord, facility: FacilityType): GameState {
  return delegateBuildStep(state, forceId, unitId, target, facility);
}

/** 供 UI 展示使用的便捷函数：计算 unitId 部队到 target 的最优路径（无法到达返回 undefined） */
export function computeDelegatePath(state: GameState, unitId: string, target: GridCoord): GridCoord[] | undefined {
  const unit = state.units[unitId];
  if (!unit) return undefined;
  return optimalPathCells(state, { q: unit.q, r: unit.r }, target, pathOptionsFor(state, unit));
}

/** 供 UI 使用的导出别名（legacyCore 的 assertUnitTurn） */
export function assertDelegateUnit(state: GameState, forceId: ForceId, unitId: string): ArmyUnit {
  return assertUnitTurn(state, forceId, unitId);
}

export type { UnitDelegate };
export { movementAllowanceForUnit };
