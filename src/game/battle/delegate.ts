import type { ArmyUnit, FacilityRepairReport, FacilityType, ForceId, GameState, UnitDelegate } from '../types';
import { gridKey, neighborsOf, sevenCellCityFootprint, type GridCoord } from './grid';
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
import { passBlockedKeys } from '../passes';
import { FACILITY_BUILD_COSTS, facilityBuildTargets, facilityIsCompleted, repairableFacilities } from './legacyCore';
import { buildFacility, repairFacility } from './facilities';
import { moveUnit } from './movement';
import { assertUnitTurn } from './shared';

interface PathOptions {
  ignoredUnitId?: string;
  /** 允许穿越（不停留）的本方/空城 footprint 格，与普通移动 reachableCosts 一致 */
  allowedCityTransitKeys?: Set<string>;
  movingForceId?: ForceId;
  vehicle?: 'boat' | 'ship';
  profile?: ReturnType<typeof movementProfileForUnit>;
}

/**
 * 计算从 start 到 target 的最优（移动消耗最低）路径，返回 [start, ..., target]；
 * 无法到达时返回 undefined。与每旬移动不同，跨水域边界不要求先停在边界（可跨旬停顿后继续）。
 * 城市 footprint：本方/空城格可按移动规则穿越（不停留）；敌方城池不可穿越。
 * 委任逐旬的停靠点排除城格（见 farthestReachableAlongPath），避免途经城内格触发回城/进驻；
 * 例外是委任目标所在的城池（目标为城格时，停在该城任意 footprint 格即进城，见该函数）。
 */
export function optimalPathCells(state: GameState, start: GridCoord, target: GridCoord, options: PathOptions = {}): GridCoord[] | undefined {
  const startKey = gridKey(start);
  const targetKey = gridKey(target);
  if (startKey === targetKey) return [start];
  const cityKeys = allCityKeys(state);
  const unitKeys = occupiedUnitKeys(state, options.ignoredUnitId);
  const facilityKeys = occupiedFacilityKeys(state);
  const blockedPassKeys = passBlockedKeys(state);
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
      if (cityKeys.has(key) && !(options.allowedCityTransitKeys?.has(key) ?? false)) continue;
      if (unitKeys.has(key)) continue;
      if (facilityKeys.has(key)) continue;
      if (blockedPassKeys.has(key) && key !== targetKey) continue;
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

/** 目标格所在城池的 footprint 格集合（目标不在任何城池内则为空集） */
function targetCityFootprintKeys(state: GameState, target: GridCoord): Set<string> {
  const keys = new Set<string>();
  for (const city of Object.values(state.cities)) {
    const footprint = sevenCellCityFootprint({ q: city.gridQ, r: city.gridR });
    if (!footprint.some((cell) => cell.q === target.q && cell.r === target.r)) continue;
    for (const cell of footprint) keys.add(gridKey(cell));
    break;
  }
  return keys;
}

/** 本回合沿最优路径能到达的最远格（path 上第一个在 reachableCosts 内的格，从目标端倒查）。
 * 途经的城市格不可作为停靠点（停靠即回城/进驻），但委任目标所在城池的 footprint 格例外：
 * 停在该城任意格即进城/占领，正是委任目的——否则本旬已能踏入城内却会停在城外，下一旬才进入。 */
function farthestReachableAlongPath(state: GameState, unit: ArmyUnit, path: GridCoord[]): GridCoord | undefined {
  const reachable = reachableCosts(state, unit);
  const startKey = gridKey(unit);
  const targetCityKeys = targetCityFootprintKeys(state, path[path.length - 1]);
  const cityKeys = allCityKeys(state);
  for (let i = path.length - 1; i >= 0; i -= 1) {
    const key = gridKey(path[i]);
    if (key === startKey) break;
    if (!reachable.has(key)) continue;
    if (cityKeys.has(key) && !targetCityKeys.has(key)) continue;
    return path[i];
  }
  return undefined;
}

function pathOptionsFor(state: GameState, unit: ArmyUnit): PathOptions {
  return {
    ignoredUnitId: unit.id,
    movingForceId: unit.forceId,
    vehicle: unit.vehicle,
    profile: movementProfileForUnit(unit),
    // 与普通移动 reachableCosts 一致：本方/空城 footprint 可穿越（不停留），敌方城格不可穿越
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

/** 设施的一个可通行的相邻格（路径接近目标）。返回距离部队最近的邻格。 */
function passableNeighborOfFacility(state: GameState, facility: { q: number; r: number }, unitId: string): GridCoord | undefined {
  const candidates = neighborsOf(facility.q, facility.r).filter((coord) => isLegalApproachCell(state, coord, unitId));
  if (candidates.length === 0) return undefined;
  const unit = state.units[unitId];
  const best = candidates.map((coord) => ({ coord, d: Math.abs(coord.q - (unit?.q ?? facility.q)) + Math.abs(coord.r - (unit?.r ?? facility.r)) }))
    .sort((a, b) => a.d - b.d)[0];
  return best?.coord;
}

/** 判断指定格是否可作为部队接近/停靠的合法格（非城市、非设施占据、非部队占据、可通行） */
function isLegalApproachCell(state: GameState, coord: GridCoord, unitId: string): boolean {
  const cityKeys = allCityKeys(state);
  const facilityKeys = occupiedFacilityKeys(state);
  const unitKeys = occupiedUnitKeys(state, unitId);
  const blockedPassKeys = passBlockedKeys(state);
  const key = gridKey(coord);
  if (cityKeys.has(key)) return false;
  if (facilityKeys.has(key)) return false;
  if (unitKeys.has(key)) return false;
  if (blockedPassKeys.has(key)) return false;
  return Number.isFinite(movementCostForCell(cellAt(state, coord), undefined, undefined));
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
  // 未相邻：沿最优路径靠近到「设施相接的可通行格」（approachTarget 本身即邻格，
  // 需要站上去才能修补，故直接以它为移动终点，而非像建设一样停在相接格的上一格）。
  const approachTarget = passableNeighborOfFacility(state, facility, unitId);
  if (!approachTarget) return state;
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

/**
 * 点击「进行」时：对指定势力（默认当前行动势力）的所有委任部队自动执行一步。
 * 部队自动行动走 moveUnit，其内部要求 state.turnForceId 与执行势力一致；
 * 联网在旬末需要为每个人类玩家势力分别执行委任，故此处临时切换行动势力视角。
 */
export function executeDelegations(state: GameState, forceId: ForceId = state.turnForceId): GameState {
  const previousTurnForceId = state.turnForceId;
  let next = previousTurnForceId === forceId ? state : { ...state, turnForceId: forceId };
  // 收集本次委任产生的设施耐久报告（build/repair 会整体替换数组，按引用变化收集避免丢失）
  const repairReports: FacilityRepairReport[] = [];
  for (const unit of Object.values(next.units)) {
    if (unit.forceId !== forceId || !unit.delegate) continue;
    const before = next.facilityRepairReports ?? [];
    next = executeUnitDelegation(next, forceId, unit.id);
    const after = next.facilityRepairReports ?? [];
    if (after !== before && after.length > 0) repairReports.push(...after);
  }
  return { ...next, turnForceId: previousTurnForceId, facilityRepairReports: repairReports };
}

/** 该势力是否存在"可以立刻行动一步"的委任部队（右键菜单「委任部队行动」的可用性依据） */
export function hasExecutableDelegation(state: GameState, forceId: ForceId = state.turnForceId): boolean {
  return Object.values(state.units).some((unit) => (
    unit.forceId === forceId
    && Boolean(unit.delegate)
    && !unit.acted
    && !unit.moved
    && !unitIsIncapacitated(unit)
  ));
}

/**
 * 手动执行委任：不推进回合，只让委任部队各行动一步（右键菜单「委任部队行动」）。
 * 与 advanceTenDay 的第一步同源；因为不经过旬末重置，这里直接补上"委任进驻/回城的武将标记已行动"。
 */
export function runDelegatedUnits(state: GameState, forceId: ForceId = state.turnForceId): GameState {
  const next = executeDelegations(state, forceId);
  return keepDelegationMergedOfficersActed(next, delegationMergedOfficerIds(state, next));
}

/**
 * 委任自动执行后消失的部队（进驻/回城）中并入城池的武将 id。
 * 这类武将的「本旬已行动」是在旬末重置之前标记的，旬末重置会把标记一并清掉，
 * 导致玩家在新的一旬看到刚进城的武将还能行动；调用方需据此补回标记。
 */
export function delegationMergedOfficerIds(before: GameState, after: GameState): string[] {
  const ids: string[] = [];
  for (const unit of Object.values(before.units)) {
    if (after.units[unit.id]) continue;
    for (const officerId of unit.officerIds ?? [unit.leaderId]) {
      if (after.officers[officerId]?.location.kind === 'city') ids.push(officerId);
    }
  }
  return ids;
}

/** 补回委任进驻/回城武将的「已行动」标记（在旬末重置之后调用） */
export function keepDelegationMergedOfficersActed(state: GameState, officerIds: readonly string[]): GameState {
  for (const officerId of officerIds) {
    const officer = state.officers[officerId];
    if (officer?.location.kind === 'city') officer.acted = true;
  }
  return state;
}

/** 玩家发起移动委任：本回合沿最优路径移动到最远处并记录委任目标 */
export function setMoveDelegate(state: GameState, forceId: ForceId, unitId: string, target: GridCoord): GameState {
  return delegateMoveStep(state, forceId, unitId, target);
}

/** 玩家发起建设委任：先沿最优路径向建设点移动，到达相邻处自动设置设施 */
export function setBuildDelegate(state: GameState, forceId: ForceId, unitId: string, target: GridCoord, facility: FacilityType): GameState {
  return delegateBuildStep(state, forceId, unitId, target, facility);
}

/** 玩家发起修补委任：先沿最优路径向未完成设施移动，到达相邻处自动持续修补直至建成。
 * 首触时部队尚无委任，需预置 kind:'repair' 让 delegateRepairStep 靠近时保留该委任。 */
export function setRepairDelegate(state: GameState, forceId: ForceId, unitId: string, facilityId: string): GameState {
  const unit = state.units[unitId];
  if (!unit || unit.acted || unit.moved || unitIsIncapacitated(unit)) return state;
  const facility = state.facilities?.[facilityId];
  if (!facility || facility.forceId !== forceId || facilityIsCompleted(facility)) return state;
  const next = structuredClone(state);
  next.units[unitId].delegate = { kind: 'repair', facilityId };
  return delegateRepairStep(next, forceId, unitId, facilityId);
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
