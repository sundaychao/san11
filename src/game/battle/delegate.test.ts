import { describe, expect, it } from 'vitest';
import { reduceGameIntent } from '../network/intentReducer';
import { createGame } from '../scenario/jingxiang208';
import type { ArmyUnit, City, FacilityType } from '../types';
import { movementCells, reachableCosts } from './movementRules';
import { cellAt } from './movementRules';
import { neighborsOf, sevenCellCityFootprint } from './grid';
import { FACILITY_BUILD_COSTS, facilityBuildTargets, movementAllowanceForUnit } from './legacyCore';
import { movementCostForCell } from './catalog';
import { buildFacility } from './facilities';
import { deployUnitWithId, deploymentCells, chooseDelegateSpawnCell } from './deployment';
import { advanceTenDay, settleTenDay } from '../turn';
import { cityAvailableOfficers } from '../commands';
import {
  computeDelegatePath,
  delegationMergedOfficerIds,
  executeDelegations,
  keepDelegationMergedOfficersActed,
  setBuildDelegate,
  setMoveDelegate,
  setRepairDelegate,
} from './delegate';

type GameLike = ReturnType<typeof createGame>;

function makeUnit(forceId: string, homeCityId: string, q: number, r: number, overrides: Partial<ArmyUnit> = {}): ArmyUnit {
  return {
    id: 'delegate-unit',
    kind: 'combat',
    forceId,
    leaderId: 'liu-bei',
    homeCityId,
    troopType: 'sword',
    q,
    r,
    troops: 3000,
    food: 6000,
    gold: 0,
    energy: 100,
    movementRemaining: 20,
    moved: false,
    acted: false,
    ...overrides,
  } as ArmyUnit;
}

/** 重置部队为本旬未行动状态（模拟旬初） */
function freshTurn(state: GameLike) {
  const unit = state.units['delegate-unit'];
  unit.moved = false;
  unit.acted = false;
  unit.movementRemaining = movementAllowanceForUnit(unit);
  return state;
}

/** 注入测试部队到指定格 */
function injectUnit(state: GameLike, coord: { q: number; r: number }, overrides: Partial<ArmyUnit> = {}) {
  state.units['delegate-unit'] = makeUnit('liu', 'jiangling', coord.q, coord.r, overrides);
  return state;
}

/** 找一个「无主空城 + 城 footprint 外的陆格站位」组合 */
function findEmptyCityAndSpawn(state: GameLike) {
  const allCityFootprint = new Set(Object.values(state.cities).flatMap((city) => (
    sevenCellCityFootprint({ q: city.gridQ, r: city.gridR }).map((coord) => `${coord.q},${coord.r}`)
  )));
  for (const city of Object.values(state.cities)) {
    if (city.ownerId !== null || city.troops > 0) continue;
    const footprint = sevenCellCityFootprint({ q: city.gridQ, r: city.gridR });
    for (const cell of footprint) {
      const spawn = neighborsOf(cell.q, cell.r)
        .find((coord) => cellAt(state, coord) && !allCityFootprint.has(`${coord.q},${coord.r}`));
      if (spawn) return { city, spawn };
    }
  }
  return undefined;
}

/** 沿六方向向外扫描，找第一处可达的远方陆格（用于移动/建设委任目标） */
function findRemoteLandCell(state: GameLike, from: { q: number; r: number }, minDistance: number) {
  const directions = [
    [1, 0], [-1, 0], [0, 1], [0, -1], [1, -1], [-1, 1],
  ] as const;
  for (const [dq, dr] of directions) {
    for (let d = minDistance; d <= 16; d += 2) {
      const coord = { q: from.q + dq * d, r: from.r + dr * d };
      if (!cellAt(state, coord)) continue;
      const path = computeDelegatePath(state, 'delegate-unit', coord);
      if (path && path.length > 2) return coord;
    }
  }
  return undefined;
}

/** 在江陵附近找一处「邻格存在可建设格（火种）」的站位 */
function findBuildSpawn(state: GameLike) {
  const city = state.cities.jiangling;
  for (let q = city.gridQ - 8; q <= city.gridQ + 8; q += 1) {
    for (let r = city.gridR - 8; r <= city.gridR + 8; r += 1) {
      if (!cellAt(state, { q, r })) continue;
      injectUnit(state, { q, r }, { gold: 2000 });
      if (facilityBuildTargets(state, 'delegate-unit', undefined, 'fireSeed').length > 0) {
        return { q, r };
      }
    }
  }
  return undefined;
}

/** 沿六方向向外扫描，找一处「可达且可建设（火种）」的远方格 */
function findRemoteBuildCell(state: GameLike, from: { q: number; r: number }, minDistance: number) {
  const directions = [
    [1, 0], [-1, 0], [0, 1], [0, -1], [1, -1], [-1, 1],
  ] as const;
  for (const [dq, dr] of directions) {
    for (let d = minDistance; d <= 16; d += 1) {
      const coord = { q: from.q + dq * d, r: from.r + dr * d };
      if (!cellAt(state, coord)) continue;
      const neighbor = neighborsOf(coord.q, coord.r).find((n) => cellAt(state, n));
      if (!neighbor) continue;
      // 用探针部队站在邻格验证该格可建设
      const prev = state.units['delegate-unit'];
      delete state.units['delegate-unit'];
      state.units['delegate-unit'] = makeUnit('liu', 'jiangling', neighbor.q, neighbor.r, { gold: 2000 });
      const buildable = facilityBuildTargets(state, 'delegate-unit', undefined, 'fireSeed')
        .some((t) => t.q === coord.q && t.r === coord.r);
      state.units['delegate-unit'] = prev;
      if (buildable && computeDelegatePath(state, 'delegate-unit', coord)) return coord;
    }
  }
  return undefined;
}

describe('部队委任', () => {
  describe('移动委任', () => {
    it('超距目标：本回合沿最优路径移动到最远处并记录移动委任', () => {
      const state = createGame('liu', 1);
      const spawn = neighborsOf(state.cities.jiangling.gridQ, state.cities.jiangling.gridR)
        .find((n) => cellAt(state, n))!;
      injectUnit(state, spawn);
      const target = findRemoteLandCell(state, spawn, 6);
      expect(target).toBeDefined();
      if (!target) return;

      const next = setMoveDelegate(state, 'liu', 'delegate-unit', target);
      const unit = next.units['delegate-unit'];

      expect(unit.moved).toBe(true);
      // moveUnit 只置 moved（与正常移动一致，本轮仍可二次行动）；委任目标保留
      expect(unit.delegate).toEqual({ kind: 'move', target });
      // 本轮已前进（未停在原地）
      expect(unit.q !== spawn.q || unit.r !== spawn.r).toBe(true);
    }, 30000);

    it('每旬自动沿最优路径移动，到达目标后结束委任', () => {
      const state = createGame('liu', 1);
      const spawn = neighborsOf(state.cities.jiangling.gridQ, state.cities.jiangling.gridR)
        .find((n) => cellAt(state, n))!;
      injectUnit(state, spawn);
      const target = findRemoteLandCell(state, spawn, 6);
      expect(target).toBeDefined();
      if (!target) return;

      let cursor = setMoveDelegate(state, 'liu', 'delegate-unit', target);
      let guard = 0;
      while (cursor.units['delegate-unit']?.delegate && guard < 30) {
        cursor = executeDelegations(freshTurn(cursor));
        guard += 1;
      }

      const unit = cursor.units['delegate-unit'];
      expect(unit).toBeDefined();
      expect(unit.delegate).toBeUndefined();
      expect(unit.q).toBe(target.q);
      expect(unit.r).toBe(target.r);
    }, 30000);

    it('已手动行动（moved）的部队不会再自动执行委任', () => {
      const state = createGame('liu', 1);
      const spawn = neighborsOf(state.cities.jiangling.gridQ, state.cities.jiangling.gridR)
        .find((n) => cellAt(state, n))!;
      injectUnit(state, spawn);
      const target = findRemoteLandCell(state, spawn, 6);
      expect(target).toBeDefined();
      if (!target) return;

      const next = setMoveDelegate(state, 'liu', 'delegate-unit', target);
      const before = { q: next.units['delegate-unit'].q, r: next.units['delegate-unit'].r };
      // 不重置 moved：本旬已行动，不应再移动
      const after = executeDelegations(next);
      expect(after.units['delegate-unit'].q).toBe(before.q);
      expect(after.units['delegate-unit'].r).toBe(before.r);
      expect(after.units['delegate-unit'].delegate?.kind).toBe('move');
    }, 30000);

    it('手动移动（moveUnit）会取消该部队的委任', () => {
      const state = createGame('liu', 1);
      const spawn = neighborsOf(state.cities.jiangling.gridQ, state.cities.jiangling.gridR)
        .find((n) => cellAt(state, n))!;
      injectUnit(state, spawn);
      const target = findRemoteLandCell(state, spawn, 6);
      expect(target).toBeDefined();
      if (!target) return;

      const withDelegate = setMoveDelegate(state, 'liu', 'delegate-unit', target);
      expect(withDelegate.units['delegate-unit'].delegate).toBeDefined();

      const ready = freshTurn(structuredClone(withDelegate));
      const dest = movementCells(ready, 'delegate-unit')[0];
      expect(dest).toBeDefined();
      if (!dest) return;

      const after = reduceGameIntent(ready, 'liu', { type: 'moveUnit', unitId: 'delegate-unit', destination: dest });
      expect(after.units['delegate-unit'].delegate).toBeUndefined();
    }, 30000);

    it('委任移动到空城：本旬已能踏进城内即进驻，不会停在城外等下一旬', () => {
      const state = createGame('liu', 1);

      // 找一个「空城 + 城 footprint 外站位」组合：本旬移动力够踏进城内任一格，但不够走到中心格
      let targetCity: City | undefined;
      let spawn: { q: number; r: number } | undefined;
      let stepCost = 0;
      for (const city of Object.values(state.cities)) {
        if (city.ownerId !== null || city.troops > 0) continue;
        const centerKey = `${city.gridQ},${city.gridR}`;
        const footprint = sevenCellCityFootprint({ q: city.gridQ, r: city.gridR });
        const footprintKeys = new Set(footprint.map((coord) => `${coord.q},${coord.r}`));
        for (const cell of footprint) {
          for (const neighbor of neighborsOf(cell.q, cell.r)) {
            const key = `${neighbor.q},${neighbor.r}`;
            if (footprintKeys.has(key) || !cellAt(state, neighbor)) continue;
            injectUnit(state, neighbor, { movementRemaining: 60 });
            const costs = reachableCosts(state, state.units['delegate-unit']);
            const centerCost = costs.get(centerKey) ?? Number.POSITIVE_INFINITY;
            const entryCost = Math.min(
              ...footprint
                .filter((coord) => `${coord.q},${coord.r}` !== centerKey)
                .map((coord) => costs.get(`${coord.q},${coord.r}`) ?? Number.POSITIVE_INFINITY),
            );
            if (Number.isFinite(entryCost) && centerCost > entryCost) {
              targetCity = city;
              spawn = neighbor;
              stepCost = entryCost;
              break;
            }
          }
          if (spawn) break;
        }
        if (spawn) break;
      }
      expect(spawn).toBeDefined();
      expect(targetCity).toBeDefined();
      if (!spawn || !targetCity) return;

      // 移动力刚好够踏进城内、不足以走到中心格：本旬应直接进驻（而非停在城外）
      injectUnit(state, spawn, { movementRemaining: stepCost });
      const next = setMoveDelegate(state, 'liu', 'delegate-unit', { q: targetCity.gridQ, r: targetCity.gridR });

      expect(next.units['delegate-unit']).toBeUndefined();
      expect(next.cities[targetCity.id].ownerId).toBe('liu');
    }, 30000);

    it('委任自动进驻空城后：随军武将本旬标记为已行动，旬末重置后需补回', () => {
      const state = createGame('liu', 1);
      const found = findEmptyCityAndSpawn(state);
      expect(found).toBeDefined();
      if (!found) return;
      const { city: targetCity, spawn } = found;

      injectUnit(state, spawn, {
        movementRemaining: 60,
        delegate: { kind: 'move', target: { q: targetCity.gridQ, r: targetCity.gridR } },
      });

      const delegated = executeDelegations(state);
      expect(delegated.units['delegate-unit']).toBeUndefined();
      expect(delegated.cities[targetCity.id].ownerId).toBe('liu');
      // 进驻本身会把随军武将标记为已行动
      expect(delegated.officers['liu-bei'].acted).toBe(true);

      const merged = delegationMergedOfficerIds(state, delegated);
      expect(merged).toContain('liu-bei');

      const settled = settleTenDay(delegated);
      // 旬末会重置全部武将的「本旬已行动」——这正是玩家看到"刚进城还能行动"的原因
      expect(settled.officers['liu-bei'].acted).toBe(false);
      // 补回标记后，新的一旬该武将不可行动
      keepDelegationMergedOfficersActed(settled, merged);
      expect(settled.officers['liu-bei'].acted).toBe(true);
      expect(cityAvailableOfficers(settled, 'liu', targetCity.id).map((officer) => officer.id)).not.toContain('liu-bei');
    }, 30000);

    it('advanceTenDay：单机推进一旬时委任进驻的武将，新一旬仍为已行动', () => {
      const state = createGame('liu', 1);
      const found = findEmptyCityAndSpawn(state);
      expect(found).toBeDefined();
      if (!found) return;
      const { city: targetCity, spawn } = found;

      injectUnit(state, spawn, {
        movementRemaining: 60,
        delegate: { kind: 'move', target: { q: targetCity.gridQ, r: targetCity.gridR } },
      });

      const next = advanceTenDay(state);

      expect(next.cities[targetCity.id].ownerId).toBe('liu');
      expect(next.officers['liu-bei'].location).toEqual({ kind: 'city', cityId: targetCity.id });
      expect(next.officers['liu-bei'].acted).toBe(true);
      expect(cityAvailableOfficers(next, 'liu', targetCity.id).map((officer) => officer.id)).not.toContain('liu-bei');
    }, 30000);

    it('advanceTenDay：可为非当前行动势力执行委任（联网旬末逐个玩家势力结算）', () => {
      const state = createGame('liu', 1);
      const found = findEmptyCityAndSpawn(state);
      expect(found).toBeDefined();
      if (!found) return;
      const { city: targetCity, spawn } = found;
      // 联网状态下 turnForceId 指向房主势力，其他玩家势力的委任同样要能执行
      state.turnForceId = 'cao';

      injectUnit(state, spawn, {
        movementRemaining: 60,
        delegate: { kind: 'move', target: { q: targetCity.gridQ, r: targetCity.gridR } },
      });

      const next = advanceTenDay(state, { delegatedForceIds: ['liu'] });

      expect(next.cities[targetCity.id].ownerId).toBe('liu');
      expect(next.officers['liu-bei'].acted).toBe(true);
    }, 30000);

    it('computeDelegatePath：远方陆格返回路径，敌方城池中心不可达', () => {
      const state = createGame('liu', 1);
      const spawn = neighborsOf(state.cities.jiangling.gridQ, state.cities.jiangling.gridR)
        .find((n) => cellAt(state, n))!;
      injectUnit(state, spawn);
      const target = findRemoteLandCell(state, spawn, 6);
      expect(target).toBeDefined();
      if (!target) return;

      const path = computeDelegatePath(state, 'delegate-unit', target);
      expect(path).toBeDefined();
      expect(path!.length).toBeGreaterThan(2);
      expect(path![0]).toEqual({ q: spawn.q, r: spawn.r });
      expect(path![path!.length - 1]).toEqual(target);

      const enemyCity = Object.values(state.cities).find((c) => c.ownerId !== 'liu')!;
      expect(computeDelegatePath(state, 'delegate-unit', { q: enemyCity.gridQ, r: enemyCity.gridR })).toBeUndefined();

      // 本方城中心可达（回城）；无守军无主城中心可达（进驻）
      const ownCity = Object.values(state.cities).find((c) => c.ownerId === 'liu')!;
      expect(computeDelegatePath(state, 'delegate-unit', { q: ownCity.gridQ, r: ownCity.gridR })).toBeDefined();
      const reachableEmptyCity = Object.values(state.cities)
        .filter((c) => c.ownerId === null && c.troops === 0)
        .find((c) => computeDelegatePath(state, 'delegate-unit', { q: c.gridQ, r: c.gridR }));
      expect(reachableEmptyCity).toBeDefined();
    }, 30000);

    it('跨江目标：路径沿江向东跨河（岸边停靠/上下水分旬），而非向西绕汉津渡口', () => {
      // 原版地图河边被 shore 封死时，寻路只能绕行西侧渡口 → 第一步朝反方向。
      // 岸边按水域消耗放行后：从江陵出生点向东跨江，第一步应缩小与目标距离。
      const state = createGame('liu', 1);
      const spawned = deployUnitWithId(state, 'liu', {
        cityId: 'jiangling',
        officerId: 'liu-bei',
        troopType: 'sword',
        troops: 3000,
        gold: 0,
        food: 6000,
      });
      const unitId = spawned.unitId;
      const target = { q: 96, r: 143 }; // 长江南岸陆格
      const path = computeDelegatePath(spawned.state, unitId, target);
      expect(path).toBeDefined();
      if (!path) return;
      const start = { q: spawned.state.units[unitId]!.q, r: spawned.state.units[unitId]!.r };
      const dist = (a: { q: number; r: number }, b: { q: number; r: number }) => {
        const dq = a.q - b.q;
        const ar = (a.r - Math.floor(a.q / 2)) - (b.r - Math.floor(b.q / 2));
        return (Math.abs(dq) + Math.abs(ar) + Math.abs(dq + ar)) / 2;
      };
      // 旧实现：第一步向西 (76,136)（绕汉津渡口），距离反而增大
      expect(dist(path[1]!, target)).toBeLessThan(dist(start, target));
    }, 30000);

    it('出征超距委任的出生格选在朝向目标最近的部署格（不固定取第一个）', () => {
      const state = createGame('liu', 1);
      const city = state.cities.jiangling;
      const cityQ = city.gridQ;
      const deployCells = deploymentCells(state, city.id, undefined, 'sword');
      // 目标分别取城东、城西足够远处（各方向目标都能让最近部署格偏向对应侧）
      const eastTarget = { q: cityQ + 26, r: city.gridR + 4 };
      const westTarget = { q: cityQ - 26, r: city.gridR - 4 };
      const spawnNearEast = chooseDelegateSpawnCell(deployCells, eastTarget);
      const spawnNearWest = chooseDelegateSpawnCell(deployCells, westTarget);
      expect(spawnNearEast).toBeDefined();
      expect(spawnNearWest).toBeDefined();
      if (!spawnNearEast || !spawnNearWest) return;
      // 东目标的出生格应显著偏东、西目标的出生格显著偏西
      expect(spawnNearEast.q).toBeGreaterThan(cityQ);
      expect(spawnNearWest.q).toBeLessThan(cityQ);
      expect(spawnNearEast.q - spawnNearWest.q).toBeGreaterThan(4);
    }, 30000);
  });

  describe('建设委任', () => {
    it('相邻建设点：自动建设，未建成转修补委任', () => {
      const state = createGame('liu', 1);
      const spawn = findBuildSpawn(state);
      expect(spawn).toBeDefined();
      if (!spawn) return;
      injectUnit(state, spawn, { gold: 2000 });
      const buildTarget = facilityBuildTargets(state, 'delegate-unit', undefined, 'fireSeed')[0];
      expect(buildTarget).toBeDefined();
      if (!buildTarget) return;

      const next = setBuildDelegate(state, 'liu', 'delegate-unit', buildTarget, 'fireSeed');
      const unit = next.units['delegate-unit'];
      const facility = Object.values(next.facilities ?? {})[0];

      expect(facility).toMatchObject({ type: 'fireSeed', q: buildTarget.q, r: buildTarget.r, completed: false });
      expect(unit.gold).toBe(2000 - FACILITY_BUILD_COSTS.fireSeed);
      expect(unit.acted).toBe(true);
      expect(unit.delegate?.kind).toBe('repair');
    });

    it('修补委任：每旬自动修补，建成后清除委任', () => {
      const state = createGame('liu', 1);
      const spawn = findBuildSpawn(state);
      expect(spawn).toBeDefined();
      if (!spawn) return;
      injectUnit(state, spawn, { gold: 2000 });
      const buildTarget = facilityBuildTargets(state, 'delegate-unit', undefined, 'fireSeed')[0];
      expect(buildTarget).toBeDefined();
      if (!buildTarget) return;

      let cursor = setBuildDelegate(state, 'liu', 'delegate-unit', buildTarget, 'fireSeed');
      const facilityId = Object.keys(cursor.facilities ?? {})[0];
      expect(cursor.units['delegate-unit'].delegate).toEqual({ kind: 'repair', facilityId });

      let guard = 0;
      while (cursor.units['delegate-unit']?.delegate && guard < 10) {
        cursor = executeDelegations(freshTurn(cursor));
        guard += 1;
      }

      expect(cursor.facilities![facilityId].completed).toBe(true);
      expect(cursor.units['delegate-unit'].delegate).toBeUndefined();
    });

    it('修补委任每旬自动修补设施时记录耐久增加报告', () => {
      const state = createGame('liu', 1);
      const spawn = findBuildSpawn(state);
      expect(spawn).toBeDefined();
      if (!spawn) return;
      injectUnit(state, spawn, { gold: 2000 });
      const buildTarget = facilityBuildTargets(state, 'delegate-unit', undefined, 'fireSeed')[0];
      expect(buildTarget).toBeDefined();
      if (!buildTarget) return;

      let cursor = setBuildDelegate(state, 'liu', 'delegate-unit', buildTarget, 'fireSeed');
      const facilityId = Object.keys(cursor.facilities ?? {})[0];
      const beforeDurability = cursor.facilities![facilityId].durability;

      cursor = executeDelegations(freshTurn(cursor));

      const report = (cursor.facilityRepairReports ?? []).find((entry) => entry.facilityId === facilityId);
      expect(report).toBeDefined();
      expect(report).toMatchObject({ kind: 'repair', q: buildTarget.q, r: buildTarget.r });
      expect(report!.amount).toBeGreaterThan(0);
      expect(cursor.facilities![facilityId].durability).toBe(beforeDurability + report!.amount);
    });

    it('远方未完成设施：setRepairDelegate 首触即朝设施移动并保留修补委任，最终建成清除', () => {
      const state = createGame('liu', 1);
      const spawn = findBuildSpawn(state);
      expect(spawn).toBeDefined();
      if (!spawn) return;
      injectUnit(state, spawn, { gold: 2000 });
      // 先在邻格建设一座未完成的火种设施，获得 facilityId 与设施坐标
      const buildTarget = facilityBuildTargets(state, 'delegate-unit', undefined, 'fireSeed')[0];
      expect(buildTarget).toBeDefined();
      if (!buildTarget) return;
      const built = setBuildDelegate(state, 'liu', 'delegate-unit', buildTarget, 'fireSeed');
      const facilityId = Object.keys(built.facilities ?? {})[0];
      const facility = built.facilities![facilityId];
      expect(facility.completed).toBe(false);

      // 找一处「到设施可达、且离设施至少 3 格」的站位，模拟远方发起。
      // 目标设施格被 occupiedFacilityKeys 排除，不能作为路径终点；故对齐实现中的
      // passableNeighborOfFacility，用「设施任一可通行邻格」作为接近目标来判断可达。
      const allCityFootprint = new Set(Object.values(built.cities).flatMap((city) => (
        sevenCellCityFootprint({ q: city.gridQ, r: city.gridR }).map((c) => `${c.q},${c.r}`)
      )));
      const passableNeighbors = neighborsOf(facility.q, facility.r).filter((n) => (
        cellAt(built, n)
        && !allCityFootprint.has(`${n.q},${n.r}`)
        && Number.isFinite(movementCostForCell(cellAt(built, n), undefined, undefined))
      ));
      expect(passableNeighbors.length).toBeGreaterThan(0);
      let far: { q: number; r: number } | undefined;
      const probe = makeUnit('liu', 'jiangling', buildTarget.q, buildTarget.r, { gold: 2000 });
      for (const [dq, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, -1], [-1, 1]] as const) {
        for (let d = 3; d <= 12 && !far; d += 1) {
          const coord = { q: facility.q + dq * d, r: facility.r + dr * d };
          if (!cellAt(built, coord) || allCityFootprint.has(`${coord.q},${coord.r}`)) continue;
          probe.q = coord.q;
          probe.r = coord.r;
          built.units['delegate-unit'] = { ...probe, id: 'delegate-unit' };
          const reachable = passableNeighbors.some((n) => {
            const path = computeDelegatePath(built, 'delegate-unit', n);
            return !!path && path.length > 2;
          });
          if (reachable) far = coord;
        }
      }
      expect(far).toBeDefined();
      if (!far) return;

      // 部队转移到该远方站位，重新发起委任修补
      let cursor = built;
      cursor.units['delegate-unit'] = { ...probe, id: 'delegate-unit', q: far.q, r: far.r };

      const next = setRepairDelegate(cursor, 'liu', 'delegate-unit', facilityId);
      // 未相邻：保留修补委任并本旬靠近
      expect(next.units['delegate-unit'].delegate).toEqual({ kind: 'repair', facilityId });
      expect(next.units['delegate-unit'].moved).toBe(true);

      let guard = 0;
      cursor = next;
      while (cursor.units['delegate-unit']?.delegate && guard < 30) {
        cursor = executeDelegations(freshTurn(cursor));
        guard += 1;
      }
      expect(cursor.facilities![facilityId].completed).toBe(true);
      expect(cursor.units['delegate-unit'].delegate).toBeUndefined();
    });

    it('远方建设点：先自动移动到相接格，再自动建设并转修补委任', () => {
      const state = createGame('liu', 1);
      const spawn = findBuildSpawn(state);
      expect(spawn).toBeDefined();
      if (!spawn) return;
      injectUnit(state, spawn, { gold: 2000 });
      // 找一处离部队较远的可建设格
      const buildTarget = findRemoteBuildCell(state, spawn, 5);
      expect(buildTarget).toBeDefined();
      if (!buildTarget) return;

      const next = setBuildDelegate(state, 'liu', 'delegate-unit', buildTarget, 'fireSeed');
      // 未相邻：保留建设委任并靠近
      expect(next.units['delegate-unit'].delegate?.kind).toBe('build');
      expect(next.units['delegate-unit'].moved).toBe(true);

      let cursor = next;
      let guard = 0;
      let built = false;
      while (guard < 30) {
        cursor = executeDelegations(freshTurn(cursor));
        guard += 1;
        const facility = Object.values(cursor.facilities ?? {}).find((f) => f.q === buildTarget.q && f.r === buildTarget.r);
        if (facility) {
          built = true;
          expect(cursor.units['delegate-unit'].delegate?.kind).toBe('repair');
          break;
        }
      }
      expect(built).toBe(true);
    });
  });

  describe('手动建设', () => {
    it('手动建设未建成：自动转为修补委任（下一旬显示「委」）', () => {
      const state = createGame('liu', 1);
      const spawn = findBuildSpawn(state);
      expect(spawn).toBeDefined();
      if (!spawn) return;
      injectUnit(state, spawn, { gold: 2000 });
      const buildTarget = facilityBuildTargets(state, 'delegate-unit', undefined, 'fireSeed')[0];
      expect(buildTarget).toBeDefined();
      if (!buildTarget) return;

      const next = buildFacility(state, 'liu', 'delegate-unit', 'fireSeed', buildTarget);
      const facility = Object.values(next.facilities ?? {})[0];
      expect(facility.completed).toBe(false);
      expect(next.units['delegate-unit'].delegate?.kind).toBe('repair');
    });

    it('一次建成：清除委任', () => {
      const state = createGame('liu', 1);
      const spawn = findBuildSpawn(state);
      expect(spawn).toBeDefined();
      if (!spawn) return;
      // 10000 兵：一次建设量 500 ≥ 火种耐久 200，直接建成
      injectUnit(state, spawn, { gold: 2000, troops: 10000 });
      const buildTarget = facilityBuildTargets(state, 'delegate-unit', undefined, 'fireSeed')[0];
      expect(buildTarget).toBeDefined();
      if (!buildTarget) return;

      const next = buildFacility(state, 'liu', 'delegate-unit', 'fireSeed', buildTarget);
      expect(Object.values(next.facilities ?? {})[0].completed).toBe(true);
      expect(next.units['delegate-unit'].delegate).toBeUndefined();
    });

    it('手动修补与委任目标不同的设施：取消委任', () => {
      const state = createGame('liu', 1);
      const spawn = findBuildSpawn(state);
      expect(spawn).toBeDefined();
      if (!spawn) return;
      injectUnit(state, spawn, { gold: 2000 });
      const buildTarget = facilityBuildTargets(state, 'delegate-unit', undefined, 'fireSeed')[0];
      expect(buildTarget).toBeDefined();
      if (!buildTarget) return;

      const next = buildFacility(state, 'liu', 'delegate-unit', 'fireSeed', buildTarget);
      expect(next.units['delegate-unit'].delegate?.kind).toBe('repair');

      // 委任目标改为另一设施（模拟部队原本委任修补的是别处设施），手动修补当前设施 → 委任被取消
      const ready = freshTurn(structuredClone(next));
      const facilityId = Object.keys(ready.facilities!)[0];
      const unit = ready.units['delegate-unit'];
      unit.delegate = { kind: 'repair', facilityId: 'some-other-facility' };
      const repaired = reduceGameIntent(ready, 'liu', { type: 'repairFacility', unitId: 'delegate-unit', facilityId });
      expect(repaired.units['delegate-unit'].delegate).toBeUndefined();
    });
  });
});
