import { describe, expect, it } from 'vitest';
import { createGame } from '../scenario/jingxiang208';
import { neighborsOf, gridKey } from './grid';
import { cellAt, allCityKeys, occupiedFacilityKeys, occupiedUnitKeys } from './movementRules';
import { movementCostForCell, movementProfileForUnit } from './catalog';
import { deployUnitWithId } from './deployment';

type GameLike = ReturnType<typeof createGame>;

function hexDist(a: { q: number; r: number }, b: { q: number; r: number }) {
  const dq = a.q - b.q;
  const dr = a.r - b.r;
  return (Math.abs(dq) + Math.abs(dr) + Math.abs(dq - dr)) / 2;
}

/** 一次性全图 Dijkstra（与 optimalPathCells 相同成本模型，含「城市footprint不可穿越」规则），
 * 返回 parents；从 parents 可直接推导每个目标的最优路径第一步，避免逐格调用寻路导致全图扫描过慢。 */
function onePassParents(s: GameLike, start: { q: number; r: number }, unitId: string) {
  const unit = s.units[unitId]!;
  const profile = movementProfileForUnit(unit);
  const cityKeys = allCityKeys(s);
  const unitKeys = occupiedUnitKeys(s, unitId);
  const facilityKeys = occupiedFacilityKeys(s);
  const startKey = gridKey(start);
  const costs = new Map<string, number>([[startKey, 0]]);
  const parents = new Map<string, string>();
  const settled = new Set<string>();
  const heap: { key: string; cost: number }[] = [{ key: startKey, cost: 0 }];
  const heapIndex = new Map<string, number>([[startKey, 0]]);
  const bubbleUp = (index: number) => {
    while (index > 0) {
      const parent = Math.floor((index - 1) / 2);
      if (heap[parent]!.cost <= heap[index]!.cost) break;
      [heap[parent], heap[index]] = [heap[index], heap[parent]];
      heapIndex.set(heap[parent]!.key, parent);
      heapIndex.set(heap[index]!.key, index);
      index = parent;
    }
  };
  const sinkDown = (index: number) => {
    for (;;) {
      const left = index * 2 + 1;
      const right = left + 1;
      let smallest = index;
      if (left < heap.length && heap[left]!.cost < heap[smallest]!.cost) smallest = left;
      if (right < heap.length && heap[right]!.cost < heap[smallest]!.cost) smallest = right;
      if (smallest === index) break;
      [heap[smallest], heap[index]] = [heap[index], heap[smallest]];
      heapIndex.set(heap[smallest]!.key, smallest);
      heapIndex.set(heap[index]!.key, index);
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
    if (costs.get(current.key)! < current.cost) continue;
    const [q, r] = current.key.split(',').map(Number);
    for (const neighbor of neighborsOf(q, r)) {
      const key = gridKey(neighbor);
      if (settled.has(key)) continue;
      const terrainCost = movementCostForCell(cellAt(s, neighbor), profile, unit.vehicle);
      if (!Number.isFinite(terrainCost)) continue;
      if (cityKeys.has(key)) continue;
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
  return { parents, costs };
}

describe('delegate 路径回归', () => {
  it('真实出征出生点扫描全部可达目标：最优路径第一步不得远离目标（曾因岸边不可通行被迫向西绕渡口）', () => {
    const state = createGame('liu', 1);
    const spawned = deployUnitWithId(state, 'liu', {
      cityId: 'jiangling',
      officerId: 'liu-bei',
      troopType: 'sword',
      troops: 3000,
      gold: 0,
      food: 6000,
    });
    const s = spawned.state;
    const unit = s.units[spawned.unitId]!;
    const { parents } = onePassParents(s, { q: unit.q, r: unit.r }, spawned.unitId);
    const startKey = gridKey(unit);

    let checked = 0;
    let anomalies = 0;
    const samples: { target: string; first: string; distBefore: number; distAfter: number }[] = [];
    for (const cell of s.grid) {
      const key = gridKey(cell);
      if (key === startKey || !parents.has(key)) continue;
      // 第一步 = 沿 parents 链上溯到子节点（其父为起点）
      let firstKey = '';
      let cursor: string | undefined = key;
      while (cursor && cursor !== startKey) {
        firstKey = cursor;
        cursor = parents.get(cursor);
      }
      if (!cursor) continue;
      const [fq, fr] = firstKey.split(',').map(Number);
      const [tq, tr] = key.split(',').map(Number);
      const dBefore = hexDist(unit, { q: tq, r: tr });
      const dAfter = hexDist({ q: fq, r: fr }, { q: tq, r: tr });
      checked += 1;
      if (dAfter > dBefore + 0.5) {
        anomalies += 1;
        if (samples.length < 20) samples.push({ target: `${tq},${tr}`, first: `${fq},${fr}`, distBefore: dBefore, distAfter: dAfter });
      }
    }
    console.log('paths computed:', checked);
    console.log('anomalies (first step increases distance):', anomalies);
    for (const a of samples) console.log(JSON.stringify(a));
    expect(anomalies).toBe(0);
  }, 60000);

  it('城市邻格出生点同样无异常（原注入式诊断，仅选城围外的合法邻格）', () => {
    const state = createGame('liu', 1);
    const cityKeys = allCityKeys(state);
    // 城围七格（中心+六邻）之外找一处贴近江陵的合法登陆格
    let spawn: { q: number; r: number } | undefined;
    outer:
    for (const cell of state.grid) {
      if (cellAt(state, cell) && !cityKeys.has(gridKey(cell))) {
        const d = Math.abs(cell.q - state.cities.jiangling.gridQ) + Math.abs(cell.r - state.cities.jiangling.gridR);
        if (d <= 2) { spawn = { q: cell.q, r: cell.r }; break outer; }
      }
    }
    expect(spawn).toBeDefined();
    if (!spawn) return;
    state.units['delegate-unit'] = {
      id: 'delegate-unit', kind: 'combat', forceId: 'liu', leaderId: 'liu-bei', homeCityId: 'jiangling',
      troopType: 'sword', q: spawn.q, r: spawn.r, troops: 3000, food: 6000, gold: 0, energy: 100,
      movementRemaining: 20, moved: false, acted: false,
    } as never;
    const { parents } = onePassParents(state, spawn, 'delegate-unit');
    const startKey = gridKey(spawn);
    let anomalies = 0;
    for (const cell of state.grid) {
      const key = gridKey(cell);
      if (key === startKey || !parents.has(key)) continue;
      let firstKey = '';
      let cursor: string | undefined = key;
      while (cursor && cursor !== startKey) {
        firstKey = cursor;
        cursor = parents.get(cursor);
      }
      if (!cursor) continue;
      const [fq, fr] = firstKey.split(',').map(Number);
      const [tq, tr] = key.split(',').map(Number);
      if (hexDist({ q: fq, r: fr }, { q: tq, r: tr }) > hexDist(spawn, { q: tq, r: tr }) + 0.5) {
        anomalies += 1;
      }
    }
    expect(anomalies).toBe(0);
  }, 60000);
});
