import type { ArmyUnit, FacilityRepairReport, FacilityType, ForceId, GameState, UnitDelegate } from '../types';
import { gridKey, neighborsOf, sevenCellCityFootprint, type GridCoord } from './grid';
import {
  allCityKeys,
  cellAt,
  forceStopKeysForUnit,
  occupiedFacilityKeys,
  occupiedUnitKeys,
  ownCityTransitKeysFor,
  reachableCosts,
  unitIsIncapacitated,
} from './movementRules';
import { movementAllowanceForUnit, movementCostForCell, movementProfileForUnit } from './catalog';
import { passBlockedKeys } from '../passes';
import { FACILITY_BUILD_COSTS, facilityBuildTargets, facilityNeedsRepair, repairableFacilities } from './legacyCore';
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

/** 二叉最小堆（按累计消耗优先，惰性删除），供正向/反向 Dijkstra 复用 */
function createMinHeap() {
  const heap: { key: string; cost: number }[] = [];
  const index = new Map<string, number>();
  const swap = (a: number, b: number) => {
    [heap[a], heap[b]] = [heap[b], heap[a]];
    index.set(heap[a]!.key, a);
    index.set(heap[b]!.key, b);
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
      if (index.has(key)) {
        const i = index.get(key)!;
        if (heap[i]!.cost <= cost) return;
        heap[i] = { key, cost };
        bubbleUp(i);
        return;
      }
      heap.push({ key, cost });
      index.set(key, heap.length - 1);
      bubbleUp(heap.length - 1);
    },
    pop(): { key: string; cost: number } | undefined {
      if (heap.length === 0) return undefined;
      const top = heap[0]!;
      const last = heap.pop()!;
      index.delete(top.key);
      if (heap.length > 0) {
        heap[0] = last;
        index.set(last.key, 0);
        sinkDown(0);
      }
      return top;
    },
  };
}

/**
 * 计算从 start 到 target 的最优（移动消耗最低）路径，返回 [start, ..., target]；
 * 无法到达时返回 undefined。与每旬移动不同，跨水域边界不要求先停在边界（可跨旬停顿后继续）。
 * 城市 footprint：本方/空城格可按移动规则穿越（不停留）；敌方城池不可穿越。
 * 委任逐旬的停靠点排除城格（见 pickBestDelegateStop），避免途经城内格触发回城/进驻；
 * 例外是委任目标所在的城池（目标为城格时，停在该城任意 footprint 格即进城）。
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
  const heap = createMinHeap();
  heap.push(startKey, 0);

  while (heap.size > 0) {
    const current = heap.pop()!;
    if (settled.has(current.key)) continue;
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
      heap.push(key, nextCost);
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

/**
 * 反向 Dijkstra：从 target 出发，按与 optimalPathCells 一致的城/设施/关隘阻挡规则，
 * 计算"每个格走到 target 的最小移动消耗"。
 * 反向边 current→neighbor 的权 = 进入 current 的消耗（正向 neighbor→current 付的就是这笔），
 * 边的合法性 = 正向走时 destination（即 current）的可进入性。
 *
 * 用途：委任选点时摆脱"单一最短路径"的局限——目标存在多条等价最短路径时，
 * 旧版"沿 Dijkstra 选中的那条路径取最远可达格"会漏掉其他同样最优、推进更多的落点。
 * 例：宛→洛阳存在多条等价路径分支时，旧版可能停在其中一条上的较近处。
 *
 * stopWhenCostExceeds：已找到 total 上限后可提前终止——未出堆的格 dist ≥ 当前出堆 cost，
 * 一旦出堆 cost 超过上限，其 dStart + dist 已不可能更优。
 *
 * stopKeys（敌方控制区 ZOC 格）：进入即当旬被迫停留，不能当「中间跳板」继续前进，
 * 故不从这些格继续扩展（与正向 reachableCostsFrom 的 `zocKeys.has(currentKey) → continue` 同规则）。
 * 这些格自身的 dist 仍然保留（它们仍可作为落点候选，见 pickBestDelegateStop 的两段口径）。
 */
function minCostToTarget(
  state: GameState,
  target: GridCoord,
  options: PathOptions,
  stopWhenCostExceeds: () => number,
  stopKeys: ReadonlySet<string> = new Set<string>(),
): Map<string, number> {
  const targetKey = gridKey(target);
  const cityKeys = allCityKeys(state);
  const unitKeys = occupiedUnitKeys(state, options.ignoredUnitId);
  const facilityKeys = occupiedFacilityKeys(state);
  const blockedPassKeys = passBlockedKeys(state);
  const profile = options.profile ?? 'sword';
  const costs = new Map<string, number>([[targetKey, 0]]);
  const settled = new Set<string>();
  const heap = createMinHeap();
  heap.push(targetKey, 0);

  while (heap.size > 0) {
    const current = heap.pop()!;
    if (settled.has(current.key)) continue;
    settled.add(current.key);
    if (current.cost > stopWhenCostExceeds()) break;
    if (stopKeys.has(current.key)) continue;
    const [q, r] = current.key.split(',').map(Number);
    const currentCell = cellAt(state, { q, r });
    // 反向边的权：正向从 neighbor 走进 current 时付的消耗
    const enterCurrentCost = movementCostForCell(currentCell, profile, options.vehicle);
    if (!Number.isFinite(enterCurrentCost)) continue;
    for (const neighbor of neighborsOf(q, r)) {
      const key = gridKey(neighbor);
      if (settled.has(key)) continue;
      if (cityKeys.has(key) && !(options.allowedCityTransitKeys?.has(key) ?? false)) continue;
      if (unitKeys.has(key)) continue;
      if (facilityKeys.has(key)) continue;
      if (blockedPassKeys.has(key)) continue;
      const nextCost = current.cost + enterCurrentCost;
      if (costs.has(key) && costs.get(key)! <= nextCost) continue;
      costs.set(key, nextCost);
      heap.push(key, nextCost);
    }
  }

  return costs;
}

type DelegateCandidate = { key: string; q: number; r: number; dStart: number };
type DelegateStop = { q: number; r: number; dStart: number; total: number };

/**
 * 从候选落点里挑「本旬已付消耗 + 到 target 剩余消耗」最小者，并列时取已消耗最大者。
 * seed 提供起始上限（通常是目标格本身：落到目标即 dist=0，已是最优）。
 */
function rankDelegateStops(
  candidates: readonly DelegateCandidate[],
  distanceToTarget: Map<string, number>,
  seed: DelegateStop | undefined,
): DelegateStop | undefined {
  let best = seed;
  for (const candidate of candidates) {
    const dist = distanceToTarget.get(candidate.key);
    if (dist === undefined) continue; // 该格走不到 target（死路/被围/被 ZOC 隔断）
    const total = candidate.dStart + dist;
    if (!best
      || total < best.total
      || (total === best.total && candidate.dStart > best.dStart)) {
      best = { q: candidate.q, r: candidate.r, dStart: candidate.dStart, total };
    }
  }
  return best;
}

/**
 * 委任移动一步的落点选取：在本旬可达集中挑"本旬已付消耗 + 到 target 剩余消耗"最小的格，
 * 并列时取已消耗最大者（= 沿路走得最远）。目标城 footprint 格允许作为落点
 * （moveUnit 会处理进驻）；其他城格不允许（reachableCosts 一般已过滤，此处兜底）。
 * 返回 undefined = 不可达或本旬无法前进。
 *
 * 因为对任意格 c 恒有 dStart(c) + dist(c) ≥ C（起点到 target 的最优总消耗），
 * 且落在最优路径上的格恰好取到 C，所以本函数等价于"在所有最优路径中挑本旬能走到的最远格"，
 * 天然覆盖多条等价最短路径（旧版只认 Dijkstra 选中的那一条）。
 * 反过来说：若玩家觉得落点"不够近"，那是该目标下本旬移动力所允许的最优解，不是选点缺陷。
 *
 * **被迫停留格（敌方 ZOC）不能当跳板**：进入 ZOC 当旬即止，若把这类格当成落点、
 * 又按"从这里还能继续走"估算剩余消耗，就会把走不动的死角误判成捷径 ——
 * 表现为"部队明明还有富余移动力，委任却只挪一格停在敌军旁边"。
 * 故首选口径里落点排除非目标的 ZOC 格、反向距离图也不从 ZOC 格继续扩展（与正向同规则）。
 * 只有当目标被 ZOC 完全隔断、本旬找不到任何"落点后仍能继续推进"的格时，
 * 才退回宽松口径（不判 ZOC）至少挪一步，避免委任把部队钉死在原地。
 */
function pickBestDelegateStop(state: GameState, unit: ArmyUnit, target: GridCoord): GridCoord | undefined {
  const startKey = gridKey(unit);
  const reachable = reachableCosts(state, unit);
  const targetCityKeys = targetCityFootprintKeys(state, target);
  const cityKeys = allCityKeys(state);
  const candidates: DelegateCandidate[] = [];
  for (const [key, dStart] of reachable) {
    if (key === startKey) continue; // 不留在原地
    if (cityKeys.has(key) && !targetCityKeys.has(key)) continue;
    const [q, r] = key.split(',').map(Number);
    candidates.push({ key, q, r, dStart });
  }
  if (candidates.length === 0) return undefined;

  const targetKey = gridKey(target);
  // 目标本身就是落点候选（本旬可达）时无需反向搜索：dist=0 已是最优，用它先立一个上限
  const onTarget = candidates.find((c) => c.key === targetKey);
  const seed: DelegateStop | undefined = onTarget
    ? { q: onTarget.q, r: onTarget.r, dStart: onTarget.dStart, total: onTarget.dStart }
    : undefined;
  const stopWhenCostExceeds = () => (seed ? seed.total : Number.POSITIVE_INFINITY);
  const options = pathOptionsFor(state, unit);
  const stopKeys = forceStopKeysForUnit(state, unit);

  const strict = rankDelegateStops(
    candidates.filter((candidate) => candidate.key === targetKey || !stopKeys.has(candidate.key)),
    minCostToTarget(state, target, options, stopWhenCostExceeds, stopKeys),
    seed,
  );
  if (strict) return { q: strict.q, r: strict.r };

  const loose = rankDelegateStops(
    candidates,
    minCostToTarget(state, target, options, stopWhenCostExceeds),
    seed,
  );
  return loose ? { q: loose.q, r: loose.r } : undefined;
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

/** 移动委任一步：本回合向 target 前进一格（选取可达集中"到 target 剩余消耗最小"者）；已到达则结束委任。
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
  // 选点：可达集中"到 target 剩余消耗最小"的格（不可达/被围时返回 undefined，详见 pickBestDelegateStop）
  const dest = pickBestDelegateStop(state, unit, target);
  if (!dest) return state; // 不可达或本回合无法前进：保留委任
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
  if (!facility || !facilityNeedsRepair(facility)) {
    // 设施已不存在，或耐久已修满：结束修补委任
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

/** 旬结算执行委任前的预备：把本势力挂委任部队的本旬行动标记清掉、移动力恢复（与旬初重置同口径）。
 * 手动行动类指令（移动/攻击/战法/计略等）都会清委任，故结算时仍挂着委任的部队一定是
 * 「下委任后未再手动操作」的 —— 它们的委任应当在本次结算准时执行，而不是被上旬的
 * moved 标记吞掉一拍（否则出征/移动当旬下的委任要等两次结算才生效）。 */
export function prepareDelegationsForExecution(state: GameState, forceId: ForceId): GameState {
  let changed = false;
  const next = structuredClone(state);
  for (const unit of Object.values(next.units)) {
    if (unit.forceId !== forceId || !unit.delegate) continue;
    if (!unit.moved && !unit.acted && unit.movementRemaining > 0) continue;
    unit.moved = false;
    unit.acted = false;
    unit.movementRemaining = movementAllowanceForUnit(unit);
    changed = true;
  }
  return changed ? next : state;
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

/**
 * 该势力是否存在「尚未行动、且未委任」的部队 —— 点「进行」前原版式提示的唯一依据。
 * 「已行动」与部队列表的显示口径一致（`acted || moved`，见 ForceOverviewPanel.unitHasActed）：
 * 移动过的部队本旬同样不能攻击，若只看 `acted` 会出现「列表显示已行动、点进行还被追问」的错位。
 * 已委任的部队推进时会自动行动一步，不算「忘了下令」，故不计入。
 */
export function hasUnactedNonDelegatedUnits(state: GameState, forceId: ForceId = state.turnForceId): boolean {
  return Object.values(state.units).some((unit) => (
    unit.forceId === forceId && !unit.delegate && !unit.acted && !unit.moved
  ));
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

/** 玩家发起修补委任：先沿最优路径向受损设施移动，到达相邻处自动持续修补直至耐久修满。
 * 首触时部队尚无委任，需预置 kind:'repair' 让 delegateRepairStep 靠近时保留该委任。
 *
 * 普通移动后的部队 movementRemaining 会被清零，因此本旬只登记委任，下一旬再执行。
 * 出征落位则不同：deployUnit 会保留出征移动力，虽然 moved=true，但这部分移动力尚未使用；
 * 这类部队确认委任修补后应立即向设施靠近，并把本旬剩余移动力消耗掉。 */
export function setRepairDelegate(state: GameState, forceId: ForceId, unitId: string, facilityId: string): GameState {
  const unit = state.units[unitId];
  if (!unit || unitIsIncapacitated(unit)) return state;
  const facility = state.facilities?.[facilityId];
  if (!facility || facility.forceId !== forceId || !facilityNeedsRepair(facility)) return state;
  const next = structuredClone(state);
  // 与 moveUnit/waitUnit 同口径清理瞬时战报：确认委任时旧的建设/修补弹字必须立即消失，
  // 否则部队本旬不动时，残留的「+N」会被误读成「已修补但耐久没加」。
  next.battleDamageReports = [];
  next.cityEffectReports = [];
  next.facilityRepairReports = [];
  next.strategyResultReports = [];
  next.units[unitId].delegate = { kind: 'repair', facilityId };
  const isDeploymentPlacement = unit.moved && !unit.acted && unit.movementRemaining > 0;
  if (isDeploymentPlacement) {
    // 出征落位的 moved 只是“已完成出征”，不是普通移动已消耗移动力。
    // 临时放开 moved，让委任逻辑复用正常移动/修补结算；若没有可达路径则恢复原状态。
    next.units[unitId].moved = false;
    const progressed = delegateRepairStep(next, forceId, unitId, facilityId);
    const progressedUnit = progressed.units[unitId];
    if (progressedUnit && !progressedUnit.acted
      && progressedUnit.q === unit.q && progressedUnit.r === unit.r) {
      progressedUnit.moved = true;
      progressedUnit.movementRemaining = unit.movementRemaining;
    }
    return progressed;
  }
  if (unit.acted || unit.moved) return next;
  return delegateRepairStep(next, forceId, unitId, facilityId);
}

/** 供 UI 展示使用的便捷函数：计算 unitId 部队到 target 的最优路径（无法到达返回 undefined） */
export function computeDelegatePath(state: GameState, unitId: string, target: GridCoord): GridCoord[] | undefined {
  const unit = state.units[unitId];
  if (!unit) return undefined;
  return optimalPathCells(state, { q: unit.q, r: unit.r }, target, pathOptionsFor(state, unit));
}

/** 供 UI 挑选修补部队：判断 unitId 部队能否执行对 facilityId 的修补委任。
 * 口径与 delegateRepairStep 的推进完全一致（已相邻可修 / 沿 passableNeighborOfFacility 的邻格可达），
 * 且不看本旬剩余移动力 —— 委任自下个旬起自动执行，与本旬是否已移动过无关。 */
export function canUnitReachRepairFacility(state: GameState, unitId: string, facilityId: string): boolean {
  const unit = state.units[unitId];
  const facility = state.facilities?.[facilityId];
  if (!unit || !facility || unitIsIncapacitated(unit)) return false;
  if (repairableFacilities(state, unitId).some((candidate) => candidate.id === facilityId)) return true;
  const approach = passableNeighborOfFacility(state, facility, unitId);
  if (!approach) return false;
  return Boolean(optimalPathCells(state, { q: unit.q, r: unit.r }, approach, pathOptionsFor(state, unit)));
}

/** 供 UI 使用的导出别名（legacyCore 的 assertUnitTurn） */
export function assertDelegateUnit(state: GameState, forceId: ForceId, unitId: string): ArmyUnit {
  return assertUnitTurn(state, forceId, unitId);
}

export type { UnitDelegate };
export { movementAllowanceForUnit };
