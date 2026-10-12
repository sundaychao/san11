import type { ArmyUnit, City, FacilityRepairReport, FacilityType, ForceId, GameState, UnitDelegate } from '../types';
import { gridKey, neighborsOf, sevenCellCityFootprint, type GridCoord } from './grid';
import {
  allCityKeys,
  cellAt,
  ferryBridgesWaterCrossing,
  forceStopKeysForUnit,
  occupiedFacilityKeys,
  occupiedUnitKeys,
  ownCityTransitKeysFor,
  reachableCosts,
  unitCanEnterCell,
  unitCanStepThisTenDay,
  unitIsIncapacitated,
  unitUntouchedThisTenDay,
  waterCrossingStep,
} from './movementRules';
import { movementAllowanceForUnit, movementCostForCell, movementProfileForUnit } from './catalog';
import { passBlockedKeys } from '../passes';
import { FACILITY_BUILD_COSTS, facilityBuildTargets, facilityNeedsRepair, repairableFacilities } from './legacyCore';
import { buildFacility, repairFacility } from './facilities';
import { moveUnit } from './movement';
import { hexGridDistance } from './deployment';
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
 *
 * waterCrossCost（跨越水陆边界的「整旬移动力」单价）：正向 `reachableCostsFrom` 对跨界收**整旬移动力**
 * （进入即当旬终止，本旬不能再走），反向若只按地形消耗收几个点，就会把「沿对岸绕」估得比
 * 「真的渡过去」便宜 —— 落点评价函数 `dStart + dist` 因此不单调，部队会在河/湿地交界的两格之间
 * 反复来回移动（实测 49,104 ↔ 50,105，永远不过河）。传入该值后正反两侧同口径：跨界恒等于一旬。
 * 渡口桥接（`ferryBridgesWaterCrossing`）与正向一致，不收整旬代价。
 */
function minCostToTarget(
  state: GameState,
  target: GridCoord,
  options: PathOptions,
  stopWhenCostExceeds: () => number,
  stopKeys: ReadonlySet<string> = new Set<string>(),
  waterCrossCost?: number,
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
    // 反向边的一环也必须是这支部队真的能进入的格（科技「开路军」阻挡 / 兵种载具 / 占用口径与正向完全一致）：
    // 否则「到目标的剩余消耗」会把走不通的近路估得比实际便宜，落点评价 dStart + dist 不单调 ——
    // 实测表现为委任部队在设施旁两格之间每旬来回移动，永远进不了 repairFacility 分支。
    if (!unitCanEnterCell(state, { q, r }, {
      ignoredUnitId: options.ignoredUnitId,
      profile,
      vehicle: options.vehicle,
      movingForceId: options.movingForceId,
      allowedCityTransitKeys: options.allowedCityTransitKeys,
      cityKeys,
      unitKeys,
      facilityKeys,
      blockedPassKeys,
    })) continue;
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
      // 跨水陆边界：与正向同口径收「整旬移动力」（渡口架桥除外）
      const crossingStep = waterCrossCost !== undefined &&
        waterCrossingStep(state, neighbor, { q, r }, options.movingForceId) &&
        !ferryBridgesWaterCrossing(state, neighbor, { q, r });
      const stepCost = crossingStep ? waterCrossCost : enterCurrentCost;
      const nextCost = current.cost + stepCost;
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
  // 跨水陆边界的单价 = 本旬剩余移动力（与 reachableCosts 传入的预算同一数值），渡一次 = 一旬
  const waterCrossCost = unit.movementRemaining;

  const strict = rankDelegateStops(
    candidates.filter((candidate) => candidate.key === targetKey || !stopKeys.has(candidate.key)),
    minCostToTarget(state, target, options, stopWhenCostExceeds, stopKeys, waterCrossCost),
    seed,
  );
  if (strict) return { q: strict.q, r: strict.r };

  const loose = rankDelegateStops(
    candidates,
    minCostToTarget(state, target, options, stopWhenCostExceeds, undefined, waterCrossCost),
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

/**
 * 放开委任部队的「本旬已动过」标记，让 `moveUnit` 放行 —— **出征与普通部队共用同一条路**。
 *
 * `moved` 只挡「玩家本旬再手动操作一次」，不挡委任行军：出征落位部队的 `moved` 是「刚出城」，
 * 它的出征移动力一分没花，必须能继续走。以前这一步分散在每个调用方（setRepairDelegate 里
 * 特判出征落位、intentReducer.deployUnitDelegate 里手动置 moved=false），现在只留在这里，
 * 委任链路里所有「本旬立即走一步」都自动生效，不必再区分部队来源。
 */
function withMovableUnit(state: GameState, unitId: string): GameState {
  if (!state.units[unitId]?.moved) return state;
  const next = structuredClone(state);
  next.units[unitId].moved = false;
  return next;
}

/** 移动委任一步：本回合向 target 前进一格（选取可达集中"到 target 剩余消耗最小"者）；已到达则结束委任。
 * 建设/修补委任通过 preserveDelegate 保留原委任类型（部队只靠近到与目标相接的格，不站上目标）。 */
function delegateMoveStep(
  state: GameState,
  forceId: ForceId,
  unitId: string,
  target: GridCoord,
  preserveDelegate?: UnitDelegate,
  options: { allowIncapacitated?: boolean } = {},
): GameState {
  const unit = state.units[unitId];
  if (!unit || unit.acted || (unitIsIncapacitated(unit) && !options.allowIncapacitated)) return state;
  // 本旬还有没有移动力可用：出征落位剩余的那部分同样算数（见 unitCanStepThisTenDay）
  if (!unitCanStepThisTenDay(unit, options)) return state;
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
  if (!dest) return state; // 不可达或本回合无法前进：保留委任，也不动 moved
  const next = moveUnit(withMovableUnit(state, unitId), forceId, unitId, dest, options);
  if (!next.units[unitId]) return next; // 回城/进驻：部队消失，委任自然结束
  next.units[unitId].delegateActed = true; // 本旬已执行过委任行动：徽章不显示任何字，且「进行」不再重复执行
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
  if (!unit || unit.acted || unitIsIncapacitated(unit)) return state;
  // 与移动/修补委任同一判据：只看本旬还剩多少移动力，不看 moved
  if (!unitCanStepThisTenDay(unit)) return state;
  // 旧存档自愈：目标格已被设施占据（历史版本会把建成后的「修补续建」委任覆盖回「建设」，
  // 目标格永远不可再建 → 委任冻结、耐久不涨）。就地转为修补续建；已修满则结束委任。
  const occupant = Object.values(state.facilities ?? {}).find((candidate) => candidate.q === target.q && candidate.r === target.r);
  if (occupant) {
    const healed = structuredClone(state);
    if (occupant.forceId === forceId && facilityNeedsRepair(occupant)) {
      healed.units[unitId].delegate = { kind: 'repair', facilityId: occupant.id };
      return delegateRepairStep(healed, forceId, unitId, occupant.id);
    }
    delete healed.units[unitId].delegate;
    return healed;
  }
  const adjacent = neighborsOf(unit.q, unit.r).some((coord) => coord.q === target.q && coord.r === target.r);
  if (adjacent) {
    if ((unit.gold ?? 0) >= FACILITY_BUILD_COSTS[facility]
      && facilityBuildTargets(state, unitId, undefined, facility).some((coord) => coord.q === target.q && coord.r === target.r)) {
      const next = buildFacility(state, forceId, unitId, facility, target);
      // buildFacility 内部已按建成情况设置/清除修补委任
      if (next.units[unitId]) next.units[unitId].delegateActed = true;
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
  const moved = delegateMoveStep(state, forceId, unitId, approachTarget, movingDelegate);
  if (moved === state) return state;
  // 移动到位当旬顺手建设：移动+建设合计为本旬的一次行动（与修补委任同口径）
  const arrived = moved.units[unitId];
  if (arrived && !arrived.acted
    && (arrived.gold ?? 0) >= FACILITY_BUILD_COSTS[facility]
    && facilityBuildTargets(moved, unitId, undefined, facility).some((coord) => coord.q === target.q && coord.r === target.r)) {
    const built = buildFacility(moved, forceId, unitId, facility, target);
    if (built.units[unitId]) built.units[unitId].delegateActed = true;
    return built;
  }
  return moved;
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

/**
 * 判断指定格是否可作为**该部队**接近/停靠的合法格：占用判定之外，还必须过该部队真实的移动口径
 * （兵种/载具 + 势力科技阻挡）。旧实现只问 `movementCostForCell(cell, undefined, undefined)`，
 * 会把「这支部队永远进不去的格」当成可接近格（未研究「开路军」时的小径/浅滩/川最典型）——
 * 于是 `pickBestDelegateStop` 只能停在这个进不去的格旁边，委任部队每旬在两格之间来回移动（实测 5,77 ↔ 6,78）、
 * 「部队移动过去了、也有音效，但耐久一点没涨」。判据统一在 `movementRules.unitCanEnterCell`。
 */
function isLegalApproachCell(state: GameState, coord: GridCoord, unitId: string): boolean {
  const unit = state.units[unitId];
  if (!unit) return false;
  return unitCanEnterCell(state, coord, {
    ignoredUnitId: unitId,
    profile: movementProfileForUnit(unit),
    vehicle: unit.vehicle,
    movingForceId: unit.forceId,
  });
}

/** 修补委任一步：已相邻且设施未完成则修补（内部保持委任至建成），否则沿最优路径靠近 */
function delegateRepairStep(state: GameState, forceId: ForceId, unitId: string, facilityId: string): GameState {
  const unit = state.units[unitId];
  if (!unit || unit.acted || unitIsIncapacitated(unit)) return state;
  // 与移动/建设委任同一判据：本旬还剩多少移动力（出征落位剩下的出征移动力同样算数）。
  // 这里**不要再判 `unit.moved`** —— 出征落位的 moved 只是「刚出城」，它必须能立刻修/靠近。
  if (!unitCanStepThisTenDay(unit)) return state;
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
    if (next.units[unitId]) next.units[unitId].delegateActed = true;
    return next;
  }
  // 未相邻：沿最优路径靠近到「设施相接的可通行格」（approachTarget 本身即邻格，
  // 需要站上去才能修补，故直接以它为移动终点，而非像建设一样停在相接格的上一格）。
  const approachTarget = passableNeighborOfFacility(state, facility, unitId);
  if (!approachTarget) return state;
  const moved = delegateMoveStep(state, forceId, unitId, approachTarget, unit.delegate);
  if (moved === state) return state;
  // 移动到位当旬顺手修补：移动+修补合计为本旬的一次行动（与手动「移动后修补」同口径）。
  // 否则到达设施的当旬被白白跳过，玩家看到的就是「部队移动过去了、音效也响了，耐久却不涨」。
  const arrived = moved.units[unitId];
  if (arrived && !arrived.acted
    && repairableFacilities(moved, unitId).some((candidate) => candidate.id === facilityId)) {
    const repaired = repairFacility(moved, forceId, unitId, facilityId);
    if (repaired.units[unitId]) repaired.units[unitId].delegateActed = true;
    return repaired;
  }
  return moved;
}

/** 旬结算执行委任前的预备：把本势力挂委任部队的本旬行动标记清掉、移动力恢复（与旬初重置同口径）。
 * 手动行动类指令（移动/攻击/战法/计略等）都会清委任，故结算时仍挂着委任、且**本旬还没动过**的部队，
 * 其委任应当在本次结算准时执行，而不是被上旬的 moved 标记吞掉一拍。
 * 本旬的行动已经用掉（`acted` 或 `moved`：出征落位 / 手动移动 / 攻击 / 建设完）的部队**不在此列** ——
 * 这里补记 `delegateActed`（本旬不再执行），否则恢复移动力会让它同一旬走两次
 * （见 `markDelegateSpentIfNoCapacity`）。
 * delegateActed 的部队本旬已执行过委任行动（下达即时行动或「委任部队行动」），
 * 不重置、不再执行：一旬只行动一次。 */
export function prepareDelegationsForExecution(state: GameState, forceId: ForceId): GameState {
  let changed = false;
  const next = structuredClone(state);
  for (const unit of Object.values(next.units)) {
    if (unit.forceId !== forceId || !unit.delegate || unit.delegateActed) continue;
    // 本旬的行动已经被「别的事情」用掉（出征落位 / 手动移动 / 攻击 / 建设，moved 或 acted）：
    // 委任本旬不再执行，补记「本旬已执行过」—— 否则这里把移动力恢复成满值，会让它同一旬走两次。
    // 判据不看剩余移动力：出征落位剩的零头移动力也不许在本旬再花（见 markDelegateSpentIfNoCapacity）。
    if (unit.acted || unit.moved) {
      unit.delegateActed = true;
      changed = true;
      continue;
    }
    if (unitUntouchedThisTenDay(unit)) continue; // 状态本就是旬初状态（没动过、移动力满）：无需重置
    unit.acted = false;
    unit.movementRemaining = movementAllowanceForUnit(unit);
    changed = true;
  }
  return changed ? next : state;
}

/** 执行单个部队的委任（仅未手动操作、未混乱、本旬未执行过委任的部队） */
export function executeUnitDelegation(state: GameState, forceId: ForceId, unitId: string): GameState {
  const unit = state.units[unitId];
  if (!unit?.delegate || unit.acted || unit.moved || unit.delegateActed || unitIsIncapacitated(unit)) return state;
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
    && !unit.delegateActed
    && !unitIsIncapacitated(unit)
  ));
}

/**
 * 手动执行委任：不推进回合，只让委任部队各行动一步（右键菜单「委任部队行动」）。
 * 与 advanceTenDay 的第一步同源；因为不经过旬末重置，这里直接补上"委任进驻/回城的武将标记已行动"。
 * 行动过的部队由 delegate*Step 记 delegateActed：本旬徽章不显示任何字、「进行」不再重复执行，下一旬旬初恢复。
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

/** 重新下达委任即视为「新委任本旬尚未行动」：清掉上一次执行的待执行标记（徽章恢复亮色「委」）；
 * 若本次下达又立即行动，delegate*Step 会重新记上。 */
function clearDelegateActed(state: GameState, unitId: string): GameState {
  const unit = state.units[unitId];
  if (!unit || !unit.delegateActed) return state;
  const next = structuredClone(state);
  delete next.units[unitId].delegateActed;
  return next;
}

/**
 * 本旬的「行动」已经被别的事情用掉（出征落位 / 手动移动 / 攻击 / 建设…都会置 `moved` 或 `acted`）时，
 * 把刚下达的委任记为「本旬已执行过」：徽章不显示任何字、点「进行」也不再补走一步，下一旬旬初重置后正常执行。
 *
 * 与 `buildFacility` 的口径一致 —— 「手动建设本身即计为本旬的委任行动」（那里也是直接记 delegateActed）。
 * 不加这一步会出现两件事同时错：出征委任后部队已经出城（本旬动过了）却还挂着「委」，
 * 而点「进行」时 `prepareDelegationsForExecution` 会把移动力恢复成满值让它再走一大段 —— 等于一旬走了两次。
 *
 * 判据只有两条：本旬已行动（`acted`）、本旬已移动过（`moved`，出征落位与手动移动都算）——
 * 任一条成立，这支部队本旬就不可能再执行委任。**注意不看剩余移动力**：出征落位剩 2 点移动力
 * 也是「已经动过」，不能因为它还有零头就再让它走（实测：剩 2 点时委任当旬走不动，
 * 却会在点「进行」时被恢复成满移动力跳一大段）。混乱 / 伪报不在此列：那是「被挡住」，不是「已经动过」，
 * 委任保留待执行、徽章照常显示。
 */
export function markDelegateSpentIfNoCapacity(state: GameState, unitId: string): GameState {
  const unit = state.units[unitId];
  if (!unit || !unit.delegate || unit.delegateActed) return state;
  if (!unit.acted && !unit.moved) return state;
  const next = structuredClone(state);
  next.units[unitId].delegateActed = true;
  return next;
}

/**
 * 本旬的行动已经用掉、以致 `delegate*Step` 连委任都没登记的部队（如手动移动后移动力归零的部队
 * 接到建设/移动委任），把委任补登记上 —— 否则玩家的委任指令会静默丢失。
 * 只在「本旬已经动过」时补登记：还没动过却走不动（被围 / 不可达）不补，
 * 免得留下永远执行不了的僵尸委任。
 */
function registerDelegateIfSpent(state: GameState, unitId: string, delegate: UnitDelegate): GameState {
  const unit = state.units[unitId];
  if (!unit || unit.delegate || unitIsIncapacitated(unit)) return state;
  if (!unit.acted && !unit.moved) return state;
  const next = structuredClone(state);
  next.units[unitId].delegate = delegate;
  return next;
}

/** 玩家发起移动委任：本回合沿最优路径移动到最远处并记录委任目标 */
export function setMoveDelegate(state: GameState, forceId: ForceId, unitId: string, target: GridCoord): GameState {
  const next = delegateMoveStep(clearDelegateActed(state, unitId), forceId, unitId, target);
  const unit = next.units[unitId];
  // 已站在目标格（delegateMoveStep 会清掉委任）不需要补登记
  const registered = unit && (unit.q !== target.q || unit.r !== target.r)
    ? registerDelegateIfSpent(next, unitId, { kind: 'move', target })
    : next;
  return markDelegateSpentIfNoCapacity(registered, unitId);
}

/** 玩家发起建设委任：先沿最优路径向建设点移动，到达相邻处自动设置设施 */
export function setBuildDelegate(state: GameState, forceId: ForceId, unitId: string, target: GridCoord, facility: FacilityType): GameState {
  const next = delegateBuildStep(clearDelegateActed(state, unitId), forceId, unitId, target, facility);
  return markDelegateSpentIfNoCapacity(registerDelegateIfSpent(next, unitId, { kind: 'build', target, facility }), unitId);
}

/** 玩家发起修补委任：先沿最优路径向受损设施移动，到达相邻处自动持续修补直至耐久修满。
 * 首触时部队尚无委任，需预置 kind:'repair' 让 delegateRepairStep 靠近时保留该委任。
 *
 * 本旬是否立即走一步，只由 `unitCanStepThisTenDay`（还剩多少移动力）决定，**不再区分出征还是普通部队**：
 * 普通移动会把 movementRemaining 清零 → 本旬只登记委任，下个旬起执行；出征落位保留了出征移动力
 * → 确认后立刻向设施靠近，并把这部分移动力花掉。 */
export function setRepairDelegate(state: GameState, forceId: ForceId, unitId: string, facilityId: string): GameState {
  const unit = state.units[unitId];
  if (!unit || unitIsIncapacitated(unit)) return state;
  const facility = state.facilities?.[facilityId];
  if (!facility || facility.forceId !== forceId || !facilityNeedsRepair(facility)) return state;
  const next = structuredClone(state);
  // 重新下达＝新委任本旬尚未行动；若下面立即行动，delegateRepairStep 会重新记上 delegateActed
  delete next.units[unitId].delegateActed;
  // 与 moveUnit/waitUnit 同口径清理瞬时战报：确认委任时旧的建设/修补弹字必须立即消失，
  // 否则部队本旬不动时，残留的「+N」会被误读成「已修补但耐久没加」。
  next.battleDamageReports = [];
  next.cityEffectReports = [];
  next.facilityRepairReports = [];
  next.strategyResultReports = [];
  next.units[unitId].delegate = { kind: 'repair', facilityId };
  // 本旬没有移动力（含出征已把移动力走完）：只登记委任，本旬不再执行 ——
  // 记 delegateActed 让徽章不显示任何字、点「进行」也不补走一步，下个旬起正常执行
  if (!unitCanStepThisTenDay(unit)) return markDelegateSpentIfNoCapacity(next, unitId);
  return markDelegateSpentIfNoCapacity(delegateRepairStep(next, forceId, unitId, facilityId), unitId);
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

/**
 * 撤退目的地：优先出发城池（`homeCityId`），已经不在自己手里（或不存在）时改退最近的己方城池。
 * 一个己方城池都没有时返回 undefined —— 部队原地不动，等伪报自然解除。
 */
function retreatCityFor(state: GameState, unit: ArmyUnit): City | undefined {
  const home = state.cities[unit.homeCityId];
  if (home && home.ownerId === unit.forceId) return home;
  const own = Object.values(state.cities).filter((city) => city.ownerId === unit.forceId);
  if (own.length === 0) return undefined;
  return [...own].sort((a, b) => (
    hexGridDistance({ q: a.gridQ, r: a.gridR }, unit) - hexGridDistance({ q: b.gridQ, r: b.gridR }, unit)
    || a.id.localeCompare(b.id)
  ))[0];
}

/**
 * 伪报部队的强制撤退：伪报中的部队在**自己的下一旬开始**自动按「委任移动」的规则向出发地行军一步
 * （沿最优路径一旬走满本旬可达范围；走到出发城池即正常回城并账，部队消失）。伪报解除后立即停止。
 *
 * 与委任行军共用 `delegateMoveStep`，所以地形 / ZOC / 被围的判断完全一致；差别只有一处：
 * 伪报部队本该「不能行动」，而撤退正是伪报本身带来的行为，因此走系统强制通道
 * （`allowIncapacitated`，`assertUnitTurn` 放行），并把该部队本旬的行动标记补上（`acted = true`）。
 */
export function retreatFalseReportedUnits(state: GameState): GameState {
  const forceIds = [...new Set(
    Object.values(state.units)
      .filter((unit) => unit.falseReportedTenDays)
      .map((unit) => unit.forceId),
  )].sort();
  let next = state;
  for (const forceId of forceIds) next = retreatForceFalseReported(next, forceId);
  return next;
}

function retreatForceFalseReported(state: GameState, forceId: ForceId): GameState {
  const previousTurnForceId = state.turnForceId;
  let next = previousTurnForceId === forceId ? state : { ...state, turnForceId: forceId };
  for (const unit of Object.values(next.units)) {
    if (unit.forceId !== forceId || !unit.falseReportedTenDays) continue;
    const city = retreatCityFor(next, unit);
    if (!city) continue;
    // 撤退就是这支部队本旬的一次行动：先恢复成「旬初」的行军状态再走（伪报部队本来也做不了别的）
    next = structuredClone(next);
    const mover = next.units[unit.id];
    mover.moved = false;
    mover.acted = false;
    mover.movementRemaining = movementAllowanceForUnit(mover);
    next = delegateMoveStep(next, forceId, unit.id, { q: city.gridQ, r: city.gridR }, undefined, { allowIncapacitated: true });
    const after = next.units[unit.id];
    if (!after) continue; // 已回城并账：部队消失，撤退结束
    // 撤退不是委任：`delegateMoveStep` 在未到达时会记一条移动委任，这里必须清掉 ——
    // 否则部队会同时挂「委」徽章，且伪报解除后还会继续被那条委任送回城。
    delete after.delegate;
    delete after.delegateActed;
    after.acted = true; // 本旬行动已用于撤退（下一旬旬初重置）
  }
  return { ...next, turnForceId: previousTurnForceId };
}

export type { UnitDelegate };
export { movementAllowanceForUnit };
