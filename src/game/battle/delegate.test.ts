import { describe, expect, it } from 'vitest';
import { reduceGameIntent } from '../network/intentReducer';
import { createGame } from '../scenario/jingxiang208';
import type { ArmyUnit, City, FacilityType } from '../types';
import { ROUGH_TERRAINS, cellAt, movementCells, ownCityTransitKeysFor, reachableCosts, unitCanEnterCell } from './movementRules';
import { neighborsOf, sevenCellCityFootprint } from './grid';
import { FACILITY_BUILD_COSTS, dismantleFacility, facilityBuildTargets, facilityNeedsRepair, movementAllowanceForUnit } from './legacyCore';
import { MILITARY_FACILITY_TERRAINS, movementCostForCell, movementProfileForUnit } from './catalog';
import { buildFacility, repairFacility } from './facilities';
import { deployUnit, deployUnitWithId, deploymentCells, deploymentCostsForStronghold, deploymentMovementAllowance, chooseDelegateSpawnCell } from './deployment';
import { getDeploymentTargets } from './queries';
import { advanceTenDay, settleTenDay } from '../turn';
import { canCrossRoughTerrain } from '../techs';
import { cityAvailableOfficers } from '../commands';
import {
  canUnitReachRepairFacility,
  computeDelegatePath,
  delegationMergedOfficerIds,
  executeDelegations,
  hasExecutableDelegation,
  hasUnactedNonDelegatedUnits,
  keepDelegationMergedOfficersActed,
  optimalPathCells,
  runDelegatedUnits,
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
  // 与旬初重置同口径：委任执行标记也清掉，下一旬可再次执行
  delete unit.delegateActed;
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

/** 火种陷阱为基础档（无科技门槛也可建）；一并补上「火药」后势力可解析到更高级档位，用例行为不变 */
function grantFireSeedTech(state: GameLike) {
  const force = state.forces.liu;
  if (!force) return;
  force.techNodes = force.techNodes?.includes('huoyao') ? force.techNodes : [...(force.techNodes ?? []), 'huoyao'];
}

/** 在江陵附近找一处「邻格存在可建设格（火种）」的站位 */
function findBuildSpawn(state: GameLike) {
  grantFireSeedTech(state);
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
  grantFireSeedTech(state);
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

    it('落点是可达集中「已付消耗 + 到目标剩余消耗」最小且已付消耗最大者（宛骑兵→洛阳）', () => {
      // 回归用例：宛（曹操）骑兵委任洛阳。旧实现沿 Dijkstra 选出的单一最短路径取最远可达格，
      // 目标存在多条等价最短路径时会漏掉同样最优、却推进更多的落点（玩家反馈 (73,89) 不如 (73,88)）。
      const state = createGame('cao', 1);
      const luoyang = state.cities.luoyang;
      const target = { q: luoyang.gridQ, r: luoyang.gridR };
      state.cities.wan.armaments = { ...state.cities.wan.armaments, cavalry: 5000 } as NonNullable<typeof state.cities.wan.armaments>;
      const query = { cityId: 'wan' as const, troopType: 'cavalry' as const, officerIds: ['cao-cao'] };
      const deployCells = getDeploymentTargets(state, query);
      // 取最西侧部署格：此处到洛阳有多条等价最优路径，正是旧实现会选歪的场景
      const spawn = deployCells.reduce((west, cell) => (cell.q < west.q ? cell : west));
      expect(spawn).toBeDefined();
      const sim = deployUnitWithId(state, 'cao', {
        cityId: 'wan', officerIds: ['cao-cao'], troopType: 'cavalry',
        troops: 1500, food: 6000, destination: spawn,
      });
      const unit = sim.state.units[sim.unitId];
      unit.moved = false;
      unit.acted = false;
      // 出征落位按新口径已扣除到达出生格的移动力（边缘格剩余≈0）；
      // 本用例考察的是旬初满移动力下的委任选点，手动补足移动力模拟新的一旬。
      unit.movementRemaining = movementAllowanceForUnit(unit);

      const next = setMoveDelegate(sim.state, 'cao', sim.unitId, target);
      const landed = next.units[sim.unitId];
      expect(landed).toBeDefined();
      if (!landed) return;
      // 本旬已前进
      expect(landed.q !== spawn.q || landed.r !== spawn.r).toBe(true);

      const profile = movementProfileForUnit(unit);
      const pathOptions = {
        ignoredUnitId: sim.unitId,
        movingForceId: 'cao' as const,
        vehicle: unit.vehicle,
        profile,
        allowedCityTransitKeys: ownCityTransitKeysFor(sim.state, 'cao'),
      };
      const pathCostOf = (path: { q: number; r: number }[]) => path.slice(1)
        .reduce((sum, cell) => sum + movementCostForCell(cellAt(sim.state, cell), profile, unit.vehicle), 0);

      // 暴力基准：逐格枚举本旬可达集，求 min(已付消耗 + 剩余消耗)，并列取已付消耗最大者
      const reachable = reachableCosts(sim.state, unit);
      const startKey = `${spawn.q},${spawn.r}`;
      let baseline: { q: number; r: number; total: number; paid: number } | undefined;
      for (const [key, paid] of reachable) {
        if (key === startKey) continue;
        const [q, r] = key.split(',').map(Number);
        const restPath = optimalPathCells(sim.state, { q, r }, target, pathOptions);
        if (!restPath) continue;
        const total = paid + pathCostOf(restPath);
        if (!baseline || total < baseline.total || (total === baseline.total && paid > baseline.paid)) {
          baseline = { q, r, total, paid };
        }
      }
      expect(baseline).toBeDefined();
      if (!baseline) return;

      // 实际落点必须达到暴力基准：同样的最小总消耗，且已付消耗（推进量）也是最大的
      const paid = reachable.get(`${landed.q},${landed.r}`);
      expect(paid).toBeDefined();
      const restPath = optimalPathCells(sim.state, { q: landed.q, r: landed.r }, target, pathOptions);
      expect(restPath).toBeDefined();
      if (paid === undefined || !restPath) return;
      expect(paid + pathCostOf(restPath)).toBe(baseline.total);
      expect(paid).toBe(baseline.paid);
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

    it('出征落位消耗移动力：当旬委任行军的总位移不超过显示的可移动范围', () => {
      const state = createGame('liu', 1);
      const city = state.cities.jiangling;
      const budget = deploymentMovementAllowance(state, 'liu', ['liu-bei'], 'sword', 'boat');
      const deployCosts = deploymentCostsForStronghold(state, 'jiangling', budget, 'sword');
      const cells = deploymentCells(state, 'jiangling', budget, 'sword');
      // 取显示范围里消耗最大（最边缘）的落位格
      const destination = cells.reduce((best, coord) => (
        deployCosts.get(`${coord.q},${coord.r}`)! > deployCosts.get(`${best.q},${best.r}`)! ? coord : best
      ));
      const spawnCost = deployCosts.get(`${destination.q},${destination.r}`)!;
      expect(spawnCost).toBeGreaterThan(0);

      const deployed = deployUnitWithId(state, 'liu', {
        cityId: 'jiangling', officerId: 'liu-bei', troopType: 'sword', troops: 3000, food: 6000,
        destination,
      });
      const unit = deployed.state.units[deployed.unitId]!;
      // 落位本身即本旬位移：剩余移动力 = 出征移动力 − 到达落位格的消耗
      expect(unit.movementRemaining).toBe(budget - spawnCost);

      // 与 intentReducer 的 deployUnitDelegate 同口径：放开 moved 后下达超距移动委任
      unit.moved = false;
      const farTarget = { q: city.gridQ + 26, r: city.gridR + 4 };
      const after = setMoveDelegate(deployed.state, 'liu', deployed.unitId, farTarget);
      const movedUnit = after.units[deployed.unitId];
      expect(movedUnit).toBeDefined();
      if (!movedUnit) return;
      // 城心 → 最终落点的消耗（本旬总位移）不得超过出征时显示的可移动范围
      const fullCosts = deploymentCostsForStronghold(state, 'jiangling', budget + 30, 'sword');
      expect(fullCosts.get(`${movedUnit.q},${movedUnit.r}`)).toBeLessThanOrEqual(budget);
    }, 30000);

    it('跨河委任：不会在河/岸边交界反复来回，逐旬渡河抵达对岸', () => {
      // 回归用例：china42x 上 (49,104) 是岸边、(49,105)(49,106) 是河、(49,107) 是河对岸。
      // 跨水域边界「进入即当旬终止、消耗整旬移动力」，若反向搜索只按地形消耗估算，
      // 就会把「沿同岸绕」算得比「真的渡过去」便宜 → 部队在 49,104 ↔ 50,105 之间无限来回。
      const state = injectUnit(createGame('liu', 1), { q: 49, r: 104 });
      const target = { q: 49, r: 107 };
      expect(cellAt(state, { q: 49, r: 104 })?.terrain).toBe('shore');
      expect(cellAt(state, { q: 49, r: 105 })?.terrain).toBe('river');
      expect(cellAt(state, target)?.terrain).toBe('shore');

      let cur = setMoveDelegate(state, 'liu', 'delegate-unit', target);
      const positions: string[] = [];
      for (let index = 0; index < 4; index += 1) {
        cur = advanceTenDay(cur);
        const unit = cur.units['delegate-unit'];
        positions.push(`${unit.q},${unit.r}`);
      }

      // 逐旬渡河：入水 → 顺流 → 登岸；到岸后停在原地不再动
      expect(positions).toEqual(['49,105', '49,106', '49,107', '49,107']);
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
      // 移动力足够时下达当旬即到位并顺手修满（火种只差 50 耐久）：建成即清委任；
      // 走不到相邻格时保留修补委任并本旬靠近
      const issued = next.units['delegate-unit'];
      if (issued.delegate) {
        expect(issued.delegate).toEqual({ kind: 'repair', facilityId });
        expect(issued.moved).toBe(true);
      } else {
        expect(next.facilities![facilityId].completed).toBe(true);
      }

      let guard = 0;
      cursor = next;
      while (cursor.units['delegate-unit']?.delegate && guard < 30) {
        cursor = executeDelegations(freshTurn(cursor));
        guard += 1;
      }
      expect(cursor.facilities![facilityId].completed).toBe(true);
      expect(cursor.units['delegate-unit'].delegate).toBeUndefined();
    });

    it('本旬已行动部队确认修补委任：只登记委任且清除残留的建设弹字', () => {
      const state = createGame('liu', 1);
      const spawn = findBuildSpawn(state);
      expect(spawn).toBeDefined();
      if (!spawn) return;
      injectUnit(state, spawn, { gold: 2000 });
      const buildTarget = facilityBuildTargets(state, 'delegate-unit', undefined, 'fireSeed')[0];
      expect(buildTarget).toBeDefined();
      if (!buildTarget) return;

      // 建设后部队 acted=true，且产生一条「+N build」耐久弹字
      const built = setBuildDelegate(state, 'liu', 'delegate-unit', buildTarget, 'fireSeed');
      const facilityId = Object.keys(built.facilities ?? {})[0];
      expect(built.units['delegate-unit'].acted).toBe(true);
      expect(built.facilityRepairReports?.length).toBeGreaterThan(0);

      // 本旬已行动的部队再确认修补委任：本旬不移动也不修补（下个旬起执行），
      // 但残留的建设弹字必须立即清除 —— 否则玩家会误读成「已修补而耐久没加」
      const next = setRepairDelegate(built, 'liu', 'delegate-unit', facilityId);
      expect(next.units['delegate-unit'].delegate).toEqual({ kind: 'repair', facilityId });
      expect(next.units['delegate-unit'].q).toBe(built.units['delegate-unit'].q);
      expect(next.units['delegate-unit'].r).toBe(built.units['delegate-unit'].r);
      expect(next.facilityRepairReports).toEqual([]);
      // 耐久确实没有被本次确认改动
      expect(next.facilities![facilityId].durability).toBe(built.facilities![facilityId].durability);
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

    it('手动建设自动转修补委任：本旬不计入「进行」、不再修补第二次，下一旬才修补', () => {
      const state = createGame('liu', 1);
      const spawn = findBuildSpawn(state);
      expect(spawn).toBeDefined();
      if (!spawn) return;
      injectUnit(state, spawn, { gold: 2000 });
      const buildTarget = facilityBuildTargets(state, 'delegate-unit', undefined, 'fireSeed')[0];
      expect(buildTarget).toBeDefined();
      if (!buildTarget) return;

      const built = buildFacility(state, 'liu', 'delegate-unit', 'fireSeed', buildTarget);
      const facilityId = Object.keys(built.facilities!)[0];
      expect(built.facilities![facilityId].completed).toBe(false);
      expect(built.units['delegate-unit'].delegate).toEqual({ kind: 'repair', facilityId });
      // 建设本身就计为「本旬的委任行动」：隐藏「委」徽章，且点「进行」不再重复执行
      expect(built.units['delegate-unit'].delegateActed).toBe(true);

      // 即使强行把 acted/moved 清掉（模拟误触「委任部队行动」），delegateActed 也会跳过本旬执行
      const sameTenDay = structuredClone(built);
      sameTenDay.units['delegate-unit'].acted = false;
      sameTenDay.units['delegate-unit'].moved = false;
      const afterSameTenDay = executeDelegations(sameTenDay);
      expect(afterSameTenDay.facilities![facilityId].durability)
        .toBe(built.facilities![facilityId].durability);

      // 旬初重置清除标记后，新的一旬委任正常执行一次修补
      const nextTenDay = executeDelegations(freshTurn(structuredClone(built)));
      expect(nextTenDay.facilities![facilityId].durability)
        .toBeGreaterThan(built.facilities![facilityId].durability);
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

  describe('委任部队行动（右键菜单「委任部队行动」）', () => {
    it('hasExecutableDelegation：无委任部队为 false，有未行动的委任部队为 true', () => {
      const state = createGame('liu', 1);
      const spawn = neighborsOf(state.cities.jiangling.gridQ, state.cities.jiangling.gridR)
        .find((n) => cellAt(state, n))!;
      injectUnit(state, spawn);
      expect(hasExecutableDelegation(state, 'liu')).toBe(false);

      const target = findRemoteLandCell(state, spawn, 6);
      expect(target).toBeDefined();
      if (!target) return;

      // setMoveDelegate 本回合已前进（moved=true）→ 不可再执行一步
      const delegated = setMoveDelegate(state, 'liu', 'delegate-unit', target);
      expect(delegated.units['delegate-unit'].moved).toBe(true);
      expect(hasExecutableDelegation(delegated, 'liu')).toBe(false);

      // 旬初重置（未行动）→ 可执行；非本势力不适用
      const ready = freshTurn(structuredClone(delegated));
      expect(hasExecutableDelegation(ready, 'liu')).toBe(true);
      expect(hasExecutableDelegation(ready, 'cao')).toBe(false);
    }, 30000);

    it('hasExecutableDelegation：已行动 / 混乱的委任部队为 false', () => {
      const state = createGame('liu', 1);
      const spawn = neighborsOf(state.cities.jiangling.gridQ, state.cities.jiangling.gridR)
        .find((n) => cellAt(state, n))!;
      const target = { q: spawn.q + 4, r: spawn.r };

      injectUnit(state, spawn, { delegate: { kind: 'move', target }, acted: true });
      expect(hasExecutableDelegation(state, 'liu')).toBe(false);

      injectUnit(state, spawn, { delegate: { kind: 'move', target }, moved: true });
      expect(hasExecutableDelegation(state, 'liu')).toBe(false);

      injectUnit(state, spawn, { delegate: { kind: 'move', target }, confusedTenDays: 2 });
      expect(hasExecutableDelegation(state, 'liu')).toBe(false);

      injectUnit(state, spawn, { delegate: { kind: 'move', target } });
      expect(hasExecutableDelegation(state, 'liu')).toBe(true);
    });

    it('hasUnactedNonDelegatedUnits：「未行动且未委任」才算未下令（委任 / 已行动 / 已移动都不算）', () => {
      const state = createGame('liu', 1);
      const spawn = neighborsOf(state.cities.jiangling.gridQ, state.cities.jiangling.gridR)
        .find((n) => cellAt(state, n))!;
      const target = { q: spawn.q + 4, r: spawn.r };

      // 无部队 → false
      expect(hasUnactedNonDelegatedUnits(state, 'liu')).toBe(false);

      // 未行动、未委任 → true（「进行」前原版提示的触发条件）
      injectUnit(state, spawn);
      expect(hasUnactedNonDelegatedUnits(state, 'liu')).toBe(true);
      expect(hasUnactedNonDelegatedUnits(state, 'cao')).toBe(false);

      // 已委任 → false：推进时会自动行动一步，不该再问「是否确定」
      const delegated = structuredClone(state);
      delegated.units['delegate-unit'].delegate = { kind: 'move', target };
      expect(hasUnactedNonDelegatedUnits(delegated, 'liu')).toBe(false);

      // 已行动 / 已移动 → false：与部队列表「已行动」显示口径（acted || moved）一致
      const acted = structuredClone(state);
      acted.units['delegate-unit'].acted = true;
      expect(hasUnactedNonDelegatedUnits(acted, 'liu')).toBe(false);

      const moved = structuredClone(state);
      moved.units['delegate-unit'].moved = true;
      expect(hasUnactedNonDelegatedUnits(moved, 'liu')).toBe(false);
    }, 30000);

    it('runDelegatedUnits：委任部队各行动一步，且不推进回合；行动后无可执行委任', () => {
      const state = createGame('liu', 1);
      const spawn = neighborsOf(state.cities.jiangling.gridQ, state.cities.jiangling.gridR)
        .find((n) => cellAt(state, n))!;
      injectUnit(state, spawn);
      const target = findRemoteLandCell(state, spawn, 6);
      expect(target).toBeDefined();
      if (!target) return;

      const delegated = setMoveDelegate(state, 'liu', 'delegate-unit', target);
      const ready = freshTurn(structuredClone(delegated));
      const before = { q: ready.units['delegate-unit'].q, r: ready.units['delegate-unit'].r };
      const { month, tenDay, turnForceId } = ready;

      const after = runDelegatedUnits(ready, 'liu');
      const unit = after.units['delegate-unit'];
      expect(unit.q !== before.q || unit.r !== before.r).toBe(true);
      expect(unit.moved).toBe(true);
      // 「委任部队行动」入口的徽章契约：执行即记 delegateActed（旧 UI 正是据此把徽章藏掉，
      // 现在同一标记只让徽章不显示任何字）。若这一旬恰好走到目标，委任按规则结束（那是完成，不是隐藏）。
      expect(unit.delegateActed).toBe(true);
      // 不推进回合：时间与行动势力均不变
      expect(after.month).toBe(month);
      expect(after.tenDay).toBe(tenDay);
      expect(after.turnForceId).toBe(turnForceId);
      // 行动后没有可再执行的委任 → 菜单项置灰
      expect(hasExecutableDelegation(after, 'liu')).toBe(false);
    }, 30000);

    it('委任执行标记：下达即时行动即记 delegateActed（徽章不显示任何字），同旬重下达保持标记、下一旬初清除', () => {
      const state = createGame('liu', 1);
      const spawn = neighborsOf(state.cities.jiangling.gridQ, state.cities.jiangling.gridR)
        .find((n) => cellAt(state, n))!;
      injectUnit(state, spawn);
      const target = findRemoteLandCell(state, spawn, 12);
      expect(target).toBeDefined();
      if (!target) return;

      // 下达移动委任 = 本旬立即行军一步：记 delegateActed → 徽章不显示任何字、本旬「进行」不再重复执行
      const delegated = setMoveDelegate(state, 'liu', 'delegate-unit', target);
      expect(delegated.units['delegate-unit'].delegateActed).toBe(true);

      // 同旬重新下达：该部队本旬的行动已经用掉（moved + 移动力耗尽），新委任本旬同样不会执行 ——
      // 仍记 delegateActed，徽章保持不显示（显示亮色「委」会误导成「本旬还会再动一次」）
      expect(setMoveDelegate(delegated, 'liu', 'delegate-unit', target).units['delegate-unit'].delegateActed).toBe(true);

      // 下一旬旬初重置后恢复显示
      const settled = settleTenDay(delegated);
      expect(settled.units['delegate-unit'].delegateActed).toBeUndefined();
    }, 30000);

    it('出征落位已把移动力走完：委任本旬不执行（徽章不显示任何字），点「进行」也不补走一步', () => {
      // 用户口径：出征本身已经是本旬的行动，部队都出城了还挂「委」、点「进行」又走一大段 = 一旬走两次
      const state = createGame('liu', 1);
      const spawn = neighborsOf(state.cities.jiangling.gridQ, state.cities.jiangling.gridR)
        .find((n) => cellAt(state, n))!;
      // 模拟出征落位：moved=true，且出征移动力已经全部花在到达出生格上
      injectUnit(state, spawn, { moved: true, movementRemaining: 0 });
      const target = findRemoteLandCell(state, spawn, 12);
      expect(target).toBeDefined();
      if (!target) return;

      const issued = setMoveDelegate(state, 'liu', 'delegate-unit', target);
      const unit = issued.units['delegate-unit'];
      // 委任必须登记（否则玩家的指令静默丢失），但本旬已经执行过 → 徽章不显示任何字、本旬「进行」不再补走
      expect(unit.delegate).toEqual({ kind: 'move', target });
      expect(unit.delegateActed).toBe(true);
      expect(unit.q).toBe(spawn.q);
      expect(unit.r).toBe(spawn.r);

      // 点「进行」：本旬不再移动（旧实现会把移动力恢复成满值，让它再走一大段）
      const advanced = advanceTenDay(issued);
      expect(advanced.units['delegate-unit']).toMatchObject({ q: spawn.q, r: spawn.r });
      // 新旬已重置标记，委任保留，下一旬起正常执行
      expect(advanced.units['delegate-unit'].delegateActed).toBeUndefined();
      expect(advanced.units['delegate-unit'].delegate).toEqual({ kind: 'move', target });
      const next = advanceTenDay(advanced);
      expect(next.units['delegate-unit'].q !== spawn.q || next.units['delegate-unit'].r !== spawn.r).toBe(true);
    }, 30000);

    it('出征落位只剩零头移动力（不够走一步）：同样不显示任何徽章、点「进行」不补走', () => {
      // 实测踩过的变体：出征到朝目标最近的部署格后剩 2 点移动力（步兵最便宜的地形也要 4），
      // 委任当旬走不动 → 旧实现点「进行」时把移动力恢复成满值，部队同一旬又跳一大段
      const state = createGame('liu', 1);
      const spawn = neighborsOf(state.cities.jiangling.gridQ, state.cities.jiangling.gridR)
        .find((n) => cellAt(state, n))!;
      injectUnit(state, spawn, { moved: true, movementRemaining: 2 });
      const target = findRemoteLandCell(state, spawn, 12);
      expect(target).toBeDefined();
      if (!target) return;

      const issued = setMoveDelegate(state, 'liu', 'delegate-unit', target);
      const unit = issued.units['delegate-unit'];
      expect(unit.delegate).toEqual({ kind: 'move', target });
      // 零头移动力不允许在本旬再花：委任本旬的机会已用掉（徽章不显示任何字）
      expect(unit.delegateActed).toBe(true);

      // 点「进行」：2 点移动力本来就走不到任何格（步兵最便宜 4 点），更不许恢复成满值再走
      const advanced = advanceTenDay(issued);
      expect(advanced.units['delegate-unit']).toMatchObject({ q: spawn.q, r: spawn.r });
      // 新旬重置后正常执行
      expect(advanced.units['delegate-unit'].delegateActed).toBeUndefined();
      const next = advanceTenDay(advanced);
      expect(next.units['delegate-unit'].q !== spawn.q || next.units['delegate-unit'].r !== spawn.r).toBe(true);
    }, 30000);

    it('委任一旬只执行一次：下达时已即时修补的部队，点「进行」不再修补第二次', () => {
      const state = deployUnit(createGame('liu', 1), 'liu', {
        cityId: 'jiangling',
        officerId: 'guan-yu',
        targetCityId: 'xiangyang',
        troopType: 'spear',
        troops: 4000,
        food: 6000,
      });
      const unit = Object.values(state.units)[0];
      state.facilities = {
        'repair-target': {
          id: 'repair-target',
          type: 'drum',
          forceId: 'liu',
          q: unit.q,
          r: unit.r + 1,
          durability: 300,
          completed: true,
        },
      };

      // 出征落位 + 紧邻设施：确认委任立即修补一次并记 delegateActed
      const repaired = setRepairDelegate(state, 'liu', unit.id, 'repair-target');
      const durabilityAfterIssue = repaired.facilities!['repair-target'].durability;
      expect(repaired.units[unit.id].delegateActed).toBe(true);
      expect(durabilityAfterIssue).toBeGreaterThan(300);

      // 点「进行」：本旬已执行过 → 不再重复修补（旧版 prepare 重置行动标记导致一旬修两次）
      const advanced = advanceTenDay(repaired);
      expect(advanced.facilities!['repair-target'].durability).toBe(durabilityAfterIssue);
      // 新旬已重置标记，委任保留，下一旬继续修补
      expect(advanced.units[unit.id].delegateActed).toBeUndefined();
      expect(advanced.units[unit.id].delegate).toEqual({ kind: 'repair', facilityId: 'repair-target' });
    }, 30000);

    it('runDelegatedUnits：无委任部队时原样返回，不做任何改动', () => {
      const state = createGame('liu', 1);
      const spawn = neighborsOf(state.cities.jiangling.gridQ, state.cities.jiangling.gridR)
        .find((n) => cellAt(state, n))!;
      injectUnit(state, spawn);

      const after = runDelegatedUnits(state, 'liu');
      const unit = after.units['delegate-unit'];
      expect(unit.q).toBe(spawn.q);
      expect(unit.r).toBe(spawn.r);
      expect(unit.moved).toBe(false);
      expect(after.turnForceId).toBe(state.turnForceId);
    });

    it('runDelegatedUnits：委任进驻空城时，随军武将立即标记为已行动', () => {
      const state = createGame('liu', 1);
      const found = findEmptyCityAndSpawn(state);
      expect(found).toBeDefined();
      if (!found) return;
      const { city: targetCity, spawn } = found;

      injectUnit(state, spawn, {
        movementRemaining: 60,
        delegate: { kind: 'move', target: { q: targetCity.gridQ, r: targetCity.gridR } },
      });

      const after = runDelegatedUnits(state, 'liu');
      expect(after.units['delegate-unit']).toBeUndefined();
      expect(after.cities[targetCity.id].ownerId).toBe('liu');
      // 不经过旬末重置，也需保持「本旬已行动」
      expect(after.officers['liu-bei'].acted).toBe(true);
      expect(cityAvailableOfficers(after, 'liu', targetCity.id).map((officer) => officer.id)).not.toContain('liu-bei');
    }, 30000);
  });

  /**
   * 用户实测（08 号存档）：关羽在 (79,125)、敌方张辽在 (78,124)、未建成的太鼓台在 (78,121)。
   * 场景地形全为草地（消耗 4/格），移动力 22 —— 手动移动可越过张辽的控制区绕到 (78,122)。
   */
  describe('委任落点与敌方 ZOC（进入即被迫停留的格不能当跳板）', () => {
    /** 关羽 (79,125) + 张辽 (78,124)（敌方）+ 未建成太鼓台 (78,121) */
    function zocRepairScene() {
      const state = createGame('liu', 1);
      state.units = {};
      state.facilities = {
        drum: { id: 'drum', type: 'drum', forceId: 'liu', q: 78, r: 121, durability: 300, completed: false },
      };
      state.units['delegate-unit'] = makeUnit('liu', 'jiangling', 79, 125, { leaderId: 'guan-yu' });
      state.units['enemy-unit'] = makeUnit('cao', 'wan', 78, 124, { id: 'enemy-unit' });
      return state;
    }

    it('委任修补首步走到本旬可达的设施邻格，而不是停在 ZOC 死角（只挪一格）', () => {
      const state = zocRepairScene();
      state.units['delegate-unit'].movementRemaining = movementAllowanceForUnit(state.units['delegate-unit']);

      // 手动移动本旬可以摸到设施邻格 (78,122) —— 委任必须同样走到这里
      expect(movementCells(state, 'delegate-unit')).toContainEqual({ q: 78, r: 122 });

      const next = setRepairDelegate(state, 'liu', 'delegate-unit', 'drum');
      expect(next.units['delegate-unit']).toMatchObject({ q: 78, r: 122 });
      expect(next.units['delegate-unit'].delegate).toEqual({ kind: 'repair', facilityId: 'drum' });
    });

    it('委任修补随后每旬自动修补，直至太鼓台建成并清除委任', () => {
      const state = zocRepairScene();
      let cursor = setRepairDelegate(state, 'liu', 'delegate-unit', 'drum');
      const facilityId = 'drum';
      // 下达当旬走到邻格并顺手修补一次（移动+修补合计一次行动）：300 → 450
      expect(cursor.facilities![facilityId].durability).toBe(450);

      let guard = 0;
      while (cursor.units['delegate-unit']?.delegate && guard < 10) {
        cursor = executeDelegations(freshTurn(cursor));
        guard += 1;
      }

      expect(cursor.facilities![facilityId].durability).toBe(800);
      expect(cursor.facilities![facilityId].completed).not.toBe(false);
      expect(cursor.units['delegate-unit'].delegate).toBeUndefined();
      expect(cursor.units['delegate-unit']).toMatchObject({ q: 78, r: 122 });
    });

    it('目标被敌方 ZOC 完全隔断时仍挪一步靠近，不会原地冻住委任', () => {
      const state = createGame('liu', 1);
      state.units = {};
      state.facilities = {};
      injectUnit(state, { q: 79, r: 130 }, { movementRemaining: 22 });
      // 两名敌军把目标 (79,122) 的六个邻格全部纳入控制区：本旬无任何「落点后仍能继续推进」的格
      state.units['enemy-a'] = makeUnit('cao', 'wan', 78, 122, { id: 'enemy-a' });
      state.units['enemy-b'] = makeUnit('cao', 'wan', 80, 123, { id: 'enemy-b' });
      expect(reachableCosts(state, state.units['delegate-unit']).has('79,122')).toBe(false);

      const next = setMoveDelegate(state, 'liu', 'delegate-unit', { q: 79, r: 122 });
      expect(next.units['delegate-unit']).toMatchObject({ q: 79, r: 125, delegate: { kind: 'move', target: { q: 79, r: 122 } } });
    });
  });

  /**
   * 用户实测（08 号存档）：太鼓台建成后被打掉耐久，旧实现拿 facilityIsCompleted 当修补前置条件，
   * 把「已建成但受损」整类设施挡在门外 —— 部队走到旁边也始终不修补。
   * 判据改为「耐久未满」（facilityNeedsRepair）后应能委任修补至满。
   */
  describe('已建成设施被打掉耐久后的修补', () => {
    /** 关羽 (79,125) + 张辽 (78,124)（敌方）+ 已建成但受损（300/800）的太鼓台 (78,121) */
    function damagedCompletedScene() {
      const state = createGame('liu', 1);
      state.units = {};
      state.facilities = {
        drum: { id: 'drum', type: 'drum', forceId: 'liu', q: 78, r: 121, durability: 300, completed: true },
      };
      state.units['delegate-unit'] = makeUnit('liu', 'jiangling', 79, 125, { leaderId: 'guan-yu' });
      state.units['enemy-unit'] = makeUnit('cao', 'wan', 78, 124, { id: 'enemy-unit' });
      return state;
    }

    it('委任修补已建成的受损设施：走到邻格后持续修补，且修补期间 completed 不回退', () => {
      const cursor0 = setRepairDelegate(damagedCompletedScene(), 'liu', 'delegate-unit', 'drum');
      expect(cursor0.units['delegate-unit']).toMatchObject({ q: 78, r: 122, delegate: { kind: 'repair', facilityId: 'drum' } });

      let cursor = executeDelegations(freshTurn(cursor0));
      expect(cursor.facilities!.drum.durability).toBeGreaterThan(300);
      expect(cursor.facilities!.drum.completed).not.toBe(false);

      let guard = 0;
      while (cursor.units['delegate-unit']?.delegate && guard < 10) {
        cursor = executeDelegations(freshTurn(cursor));
        guard += 1;
      }
      expect(cursor.facilities!.drum).toMatchObject({ durability: 800 });
      expect(cursor.facilities!.drum.completed).not.toBe(false);
      expect(cursor.units['delegate-unit'].delegate).toBeUndefined();
      expect(cursor.units['delegate-unit']).toMatchObject({ q: 78, r: 122 });
    });

    it('已建成且耐久已满的设施无需修补：委任被拒绝且部队原地不动', () => {
      const state = damagedCompletedScene();
      state.facilities!.drum.durability = 800;
      const next = setRepairDelegate(state, 'liu', 'delegate-unit', 'drum');
      expect(next.units['delegate-unit']).toMatchObject({ q: 79, r: 125 });
      expect(next.units['delegate-unit'].delegate).toBeUndefined();
    });
  });

  /**
   * 玩家报告复现（引擎侧）：「张辽出城后摆了一座太鼓台，下一回合点曹操选太鼓台，没有委任修补」。
   *
   * 太鼓台满耐久 800，一旬建设量 = `ceil(兵力 / 10000 × 500)`：7000 兵（无官职时的出征上限）＝
   * 350/旬，一旬建不满。但建设当旬会把续建自动转成修补委任，之后**不需要玩家再下任何指令**，
   * 委任会一路把它补到满耐久并自清 —— 玩家看到「明明是自己摆的太鼓台」时，它往往已经被补满了，
   * 此时任何修补入口都不该出现（`facilityNeedsRepair` 的唯一判据是耐久未满）。
   */
  describe('张辽建太鼓台：一旬建不满，靠自动续建的委任补到满耐久', () => {
    /** 城外空野（城池反击区内不许摆军事设施），张辽带 7000 兵与会建太鼓台的资金 */
    function zhangDrumScene() {
      const state = createGame('cao', 1);
      state.units = {};
      state.facilities = {};
      state.units['build-unit'] = makeUnit('cao', 'wan', 0, 21, {
        id: 'build-unit', leaderId: 'zhang-liao', troops: 7000, gold: 2000,
      });
      return state;
    }

    /** 模拟旬初重置（与 advanceTenDay 的旬初同口径）后执行委任 */
    function executeNextTenDay(state: GameLike) {
      const unit = state.units['build-unit'];
      unit.moved = false;
      unit.acted = false;
      unit.movementRemaining = movementAllowanceForUnit(unit);
      delete unit.delegateActed;
      return executeDelegations(state);
    }

    it('7000 兵一旬只建到 350/800，续建委任每旬 +350 直至 800/800 并自动解除', () => {
      const state = zhangDrumScene();
      const target = facilityBuildTargets(state, 'build-unit', undefined, 'drum')[0]!;
      let cursor = buildFacility(state, 'cao', 'build-unit', 'drum', target);
      const facilityId = Object.keys(cursor.facilities!)[0]!;
      // 建设当旬：350/800（未建成），并且自动挂上续建委任
      expect(cursor.facilities![facilityId]).toMatchObject({ durability: 350, completed: false });
      expect(cursor.units['build-unit'].delegate).toEqual({ kind: 'repair', facilityId });

      // 建设当旬：部队本旬的行动已用掉（acted），续建委任当旬不再执行 —— 耐久仍是 350
      cursor = executeDelegations(cursor);
      expect(cursor.facilities![facilityId].durability).toBe(350);

      const durabilities: number[] = [];
      let guard = 0;
      while (cursor.units['build-unit'].delegate && guard < 5) {
        cursor = executeNextTenDay(cursor);
        durabilities.push(cursor.facilities![facilityId].durability);
        guard += 1;
      }

      // 之后每旬 +350：350 → 700 → 满 800，满值当旬委任自清
      expect(durabilities).toEqual([700, 800]);
      expect(cursor.facilities![facilityId].completed).not.toBe(false);
      expect(cursor.units['build-unit'].delegate).toBeUndefined();
      // 补满之后：引擎口径下这座太鼓台「无需修补」
      expect(facilityNeedsRepair(cursor.facilities![facilityId])).toBe(false);
    });
  });

  /**
   * 玩家报告的确切数字复现：张辽带 **3000 兵**建太鼓台 → 一旬建设量 `ceil(3000/10000×500)` = **150**，
   * 所以设施是 150/800、`completed:false`（远未建满，`facilityNeedsRepair` 必为 true）。玩家症状是
   * 「确认委任后委任立刻消失、没有「委」徽章」—— 这里要分清「委任其实登记了、只是徽章为『本旬已行动』
   * 而隐藏」与「委任被真的清掉」。
   */
  describe('玩家报告：3000 兵建出的 150/800 太鼓台，曹操下修补委任', () => {
    /** 曹操 (0,23)（太鼓台 (0,22) 的相邻格）；太鼓台由张辽以 3000 兵建到 150/800（未建成） */
    function halfBuiltDrumScene(overrides: Partial<ArmyUnit> = {}) {
      const state = createGame('cao', 1);
      state.units = {};
      state.facilities = {
        drum: { id: 'drum', type: 'drum', forceId: 'cao', q: 0, r: 22, durability: 150, completed: false },
      };
      state.units['cao-unit'] = makeUnit('cao', 'wan', 0, 23, {
        id: 'cao-unit',
        leaderId: 'cao-cao',
        troops: 3000,
        ...overrides,
      });
      return state;
    }

    /** 模拟旬初重置（moved/acted/移动力/delegateActed 全恢复） */
    function nextTurnFor(state: GameLike, unitId: string) {
      const unit = state.units[unitId];
      unit.moved = false;
      unit.acted = false;
      unit.movementRemaining = movementAllowanceForUnit(unit);
      delete unit.delegateActed;
      return state;
    }

    it('曹操本旬已移动（移动力 0）时下委任：委任登记成功（不是被清掉）、本旬不执行，下一旬立刻就地修补 150 → 300', () => {
      const confirmed = setRepairDelegate(halfBuiltDrumScene({ moved: true, movementRemaining: 0 }), 'cao', 'cao-unit', 'drum');

      // 症状的真相：委任**在**（`delegate` 已登记），只是本旬的行动已用掉 → 记 delegateActed（徽章不显示任何字）
      expect(confirmed.units['cao-unit'].delegate).toEqual({ kind: 'repair', facilityId: 'drum' });
      expect(confirmed.units['cao-unit'].delegateActed).toBe(true);
      // 本旬不再走一步：位置与耐久都不动
      expect(confirmed.units['cao-unit']).toMatchObject({ q: 0, r: 23, moved: true });
      expect(confirmed.facilities!.drum.durability).toBe(150);

      // 同旬点「进行」也不会补执行一次（executeUnitDelegation 判 acted || moved || delegateActed）
      const sameTenDay = executeDelegations(confirmed);
      expect(sameTenDay.units['cao-unit']).toMatchObject({ q: 0, r: 23 });
      expect(sameTenDay.facilities!.drum.durability).toBe(150);

      // 下一旬（旬初重置后）立刻就地修补：150 → 300，委任仍在（未满继续修）
      const nextTenDay = executeDelegations(nextTurnFor(sameTenDay, 'cao-unit'));
      expect(nextTenDay.facilities!.drum.durability).toBe(300);
      expect(nextTenDay.units['cao-unit'].delegate).toEqual({ kind: 'repair', facilityId: 'drum' });
    });

    it('曹操本旬未动时下委任：当旬就走一步（已相邻 → 就地修补 150 → 300）', () => {
      const confirmed = setRepairDelegate(halfBuiltDrumScene(), 'cao', 'cao-unit', 'drum');

      expect(confirmed.facilities!.drum.durability).toBe(300);
      expect(confirmed.units['cao-unit'].delegate).toEqual({ kind: 'repair', facilityId: 'drum' });
      expect(confirmed.units['cao-unit'].delegateActed).toBe(true);
      expect(confirmed.units['cao-unit'].movementRemaining).toBe(0);
    });

    it('曹操本旬未动、离太鼓台 2 格时下委任：当旬靠近并就地修补（移动+修补合计一次行动）', () => {
      const scene = halfBuiltDrumScene({ q: 0, r: 24, moved: false, movementRemaining: 20 });
      const confirmed = setRepairDelegate(scene, 'cao', 'cao-unit', 'drum');

      // 到达当旬顺手修补：走到设施旁的相邻格 (0,23)（不站上设施格），150 → 300
      expect(confirmed.units['cao-unit']).toMatchObject({ q: 0, r: 23, delegate: { kind: 'repair', facilityId: 'drum' } });
      expect(confirmed.facilities!.drum.durability).toBe(300);

      // 下一旬已在邻格 → 继续就地修补 300 → 450
      const nextTenDay = executeDelegations(nextTurnFor(confirmed, 'cao-unit'));
      expect(nextTenDay.facilities!.drum.durability).toBe(450);
    });
  });

  /**
   * 用户实测：出征落位（deployUnit 会把部队标记为 moved）或本旬手动移动过的部队，都应能下修补委任。
   * 手动移动后移动力已清零，本旬只登记委任；出征落位仍保留出征移动力时，则立即向设施靠近。
   */
  describe('本旬已行动/已移动（含出征落位）的部队也能下修补委任', () => {
    /** 关羽 (79,125)（moved，本旬已出征落位）+ 张辽 (78,124)（敌方）+ 已建成受损（300/800）太鼓台 (78,121) */
    function movedScene() {
      const state = createGame('liu', 1);
      state.units = {};
      state.facilities = {
        drum: { id: 'drum', type: 'drum', forceId: 'liu', q: 78, r: 121, durability: 300, completed: true },
      };
      state.units['delegate-unit'] = makeUnit('liu', 'jiangling', 79, 125, {
        leaderId: 'guan-yu',
        moved: true,
        movementRemaining: 0,
      });
      state.units['enemy-unit'] = makeUnit('cao', 'wan', 78, 124, { id: 'enemy-unit' });
      return state;
    }

    it('已移动的部队：只登记委任、本旬不再挪动（不产生第二次行动）', () => {
      const next = setRepairDelegate(movedScene(), 'liu', 'delegate-unit', 'drum');
      expect(next.units['delegate-unit'].delegate).toEqual({ kind: 'repair', facilityId: 'drum' });
      expect(next.units['delegate-unit']).toMatchObject({ q: 79, r: 125, moved: true });
      expect(next.facilities!.drum.durability).toBe(300);
    });

    it('出征落位仍有出征移动力时：确认委任后立即向设施靠近并就地修补', () => {
      const state = movedScene();
      // deployUnit 的出征落位状态：moved=true，但移动力尚未被普通移动消耗。
      state.units['delegate-unit'].movementRemaining = 20;

      const next = setRepairDelegate(state, 'liu', 'delegate-unit', 'drum');

      expect(next.units['delegate-unit']).toMatchObject({ q: 78, r: 122, moved: true, movementRemaining: 0 });
      expect(next.units['delegate-unit'].delegate).toEqual({ kind: 'repair', facilityId: 'drum' });
      // 到达当旬顺手修补（移动+修补合计一次行动）：300 → 450
      expect(next.facilities!.drum.durability).toBe(450);
    });

    it('下一旬起自动靠近并修补，直至耐久修满并清除委任', () => {
      let cursor = setRepairDelegate(movedScene(), 'liu', 'delegate-unit', 'drum');
      let guard = 0;
      while (cursor.units['delegate-unit']?.delegate && guard < 12) {
        cursor = executeDelegations(freshTurn(cursor));
        guard += 1;
      }
      expect(cursor.facilities!.drum).toMatchObject({ durability: 800 });
      expect(cursor.facilities!.drum.completed).not.toBe(false);
      expect(cursor.units['delegate-unit'].delegate).toBeUndefined();
      expect(cursor.units['delegate-unit']).toMatchObject({ q: 78, r: 122 });
    });

    it('已移动的部队委任敌方设施：仍被拒绝', () => {
      const state = movedScene();
      state.facilities!.drum.forceId = 'cao';
      const next = setRepairDelegate(state, 'liu', 'delegate-unit', 'drum');
      expect(next.units['delegate-unit'].delegate).toBeUndefined();
    });

    it('混乱（无法行动）的部队仍然不能下委任', () => {
      const state = movedScene();
      state.units['delegate-unit'].confusedTenDays = 2;
      const next = setRepairDelegate(state, 'liu', 'delegate-unit', 'drum');
      expect(next.units['delegate-unit'].delegate).toBeUndefined();
    });
  });

  /**
   * 用户实测：A 挂着某设施的修补委任、B 把这设施修好了，A 的「委」却还挂着 —— 委任必须当场解除。
   * 徽章口径只看 `unit.delegate`，而 delegateRepairStep 只在「A 自己轮到执行委任」时才检查目标是否还需修补，
   * 不主动清理的话 A 会多挂一旬「委」字（本旬显示 + 下一旬旬初重置 delegateActed 后再显示），
   * 看起来像是「设施都修好了还要白跑一趟」。
   */
  describe('修补委任目标被他人修好/消失后自动解除', () => {
    /** 关羽 (79,125) 挂着太鼓台 (78,121) 的修补委任（未行动）；张飞 (78,122) 站在设施旁可立刻修补 */
    function sharedTargetScene(durability = 799) {
      const state = createGame('liu', 1);
      state.units = {};
      state.facilities = {
        drum: { id: 'drum', type: 'drum', forceId: 'liu', q: 78, r: 121, durability, completed: true },
      };
      state.units['delegate-unit'] = makeUnit('liu', 'jiangling', 79, 125, {
        leaderId: 'guan-yu',
        delegate: { kind: 'repair', facilityId: 'drum' },
      });
      state.units['helper-unit'] = makeUnit('liu', 'jiangling', 78, 122, { id: 'helper-unit', leaderId: 'zhang-fei' });
      return state;
    }

    it('他部手动修补把耐久修满：委任部队立刻摘掉委任（徽章不再显示「委」）', () => {
      const next = repairFacility(sharedTargetScene(), 'liu', 'helper-unit', 'drum');
      expect(next.facilities!.drum.durability).toBe(800);
      expect(next.units['delegate-unit'].delegate).toBeUndefined();
      expect(next.units['delegate-unit']).toMatchObject({ q: 79, r: 125 });
    });

    it('他部修补但仍未修满：委任保留（该部队下个旬起继续前往修补）', () => {
      const next = repairFacility(sharedTargetScene(100), 'liu', 'helper-unit', 'drum');
      expect(next.facilities!.drum.durability).toBeGreaterThan(100);
      expect(next.facilities!.drum.durability).toBeLessThan(800);
      expect(next.units['delegate-unit'].delegate).toEqual({ kind: 'repair', facilityId: 'drum' });
    });

    it('他部委任修补执行时把设施修满：另一支部队的委任同样立刻解除', () => {
      const state = sharedTargetScene();
      state.units['helper-unit'].delegate = { kind: 'repair', facilityId: 'drum' };
      const next = executeDelegations(state);
      expect(next.facilities!.drum.durability).toBe(800);
      expect(next.units['helper-unit'].delegate).toBeUndefined();
      expect(next.units['delegate-unit'].delegate).toBeUndefined();
    });

    it('设施被撤销（目标消失）：挂在该设施上的委任一并解除', () => {
      const next = dismantleFacility(sharedTargetScene(), 'liu', 'drum');
      expect(next.facilities!.drum).toBeUndefined();
      expect(next.units['delegate-unit'].delegate).toBeUndefined();
    });
  });

  /**
   * 玩家原话：「委任我方武将 A 修复我方武将 B 新建的军事设施没效果」。
   * 这里的「B 新建」= B 亲手建到一半、还没建成的设施（completed:false、耐久未满）。
   * 它能且只能靠修补推进 —— 当初下建设委任的部队一旦被手动移动（手动行动会清掉委任），
   * 这座半成品就只剩「委任另一支部队来修」这条路。故这条链必须真的涨耐久。
   */
  describe('A 委任修补 B 新建（还没建成）的军事设施', () => {
    /** B（关羽，1000 兵 = 一次只建 50 耐久）在江陵附近建一座建不完的阵；A（张飞）站在设施邻格 */
    function halfBuiltFacilityScene() {
      const state = createGame('liu', 1);
      state.units = {};
      state.facilities = {};
      const city = state.cities.jiangling;
      let bAt: { q: number; r: number } | undefined;
      let target: { q: number; r: number } | undefined;
      for (let q = city.gridQ - 8; q <= city.gridQ + 8 && !bAt; q += 1) {
        for (let r = city.gridR - 8; r <= city.gridR + 8 && !bAt; r += 1) {
          if (!cellAt(state, { q, r })) continue;
          state.units['unit-b'] = makeUnit('liu', 'jiangling', q, r, {
            id: 'unit-b', leaderId: 'guan-yu', troops: 1000, gold: 2000,
          });
          const targets = facilityBuildTargets(state, 'unit-b', undefined, 'formation');
          if (targets.length > 0) {
            bAt = { q, r };
            target = targets[0];
          }
        }
      }
      if (!bAt || !target) return undefined;

      const built = buildFacility(state, 'liu', 'unit-b', 'formation', target);
      const facilityId = Object.keys(built.facilities ?? {})[0]!;
      const facility = built.facilities![facilityId]!;
      expect(facility).toMatchObject({ forceId: 'liu', completed: false });
      // 模拟玩家把 B 手动调走：手动行动会清掉它自动转出的续建委任 —— 半成品从此无人接手
      delete built.units['unit-b'].delegate;
      delete built.units['unit-b'].delegateActed;

      // A 站到设施的某个可通行邻格（非 B 所占、非城池 footprint）
      const footprint = new Set(Object.values(built.cities).flatMap((city2) => (
        sevenCellCityFootprint({ q: city2.gridQ, r: city2.gridR }).map((coord) => `${coord.q},${coord.r}`)
      )));
      const aCell = neighborsOf(facility.q, facility.r).find((coord) => (
        cellAt(built, coord)
        && !footprint.has(`${coord.q},${coord.r}`)
        && !(coord.q === bAt!.q && coord.r === bAt!.r)
        && Number.isFinite(movementCostForCell(cellAt(built, coord), undefined, undefined))
      ));
      if (!aCell) return undefined;
      built.units['unit-a'] = makeUnit('liu', 'jiangling', aCell.q, aCell.r, {
        id: 'unit-a', leaderId: 'zhang-fei', troops: 3000,
      });
      return { state: built, facilityId };
    }

    it('B 新建的半成品设施：A 的修补委任被接受，当旬即涨耐久', () => {
      const scene = halfBuiltFacilityScene();
      expect(scene).toBeDefined();
      if (!scene) return;
      const { state, facilityId } = scene;
      const before = state.facilities![facilityId]!.durability;

      const delegated = setRepairDelegate(state, 'liu', 'unit-a', facilityId);
      expect(delegated.units['unit-a']!.delegate).toEqual({ kind: 'repair', facilityId });
      expect(delegated.facilities![facilityId]!.durability).toBeGreaterThan(before);
    });

    it('逐旬继续修补直至建成，耐久修满后收口（委任解除）', () => {
      const scene = halfBuiltFacilityScene();
      expect(scene).toBeDefined();
      if (!scene) return;
      const { state, facilityId } = scene;

      let cursor = setRepairDelegate(state, 'liu', 'unit-a', facilityId);
      let guard = 0;
      while (cursor.units['unit-a']?.delegate && guard < 10) {
        cursor = advanceTenDay(cursor);
        guard += 1;
      }

      expect(cursor.facilities![facilityId]!.completed).toBe(true);
      expect(cursor.units['unit-a']!.delegate).toBeUndefined();
    });

    it('引擎侧同口径：repairFacility 直接修补他部新建的半成品设施是合法的', () => {
      const scene = halfBuiltFacilityScene();
      expect(scene).toBeDefined();
      if (!scene) return;
      const { state, facilityId } = scene;
      const before = state.facilities![facilityId]!.durability;

      const repaired = repairFacility(state, 'liu', 'unit-a', facilityId);
      expect(repaired.facilities![facilityId]!.durability).toBeGreaterThan(before);
    });
  });

  /**
   * 玩家原话：「曹操先出城，张辽出城的时候建的太鼓台，进行，下一回合，曹操委任修复该太鼓台，
   * **部队移动过去了，也播放了背景音，但是耐久没有增加**」。
   *
   * 张辽 3000 兵 → 一旬建设量 `ceil(3000/10000×500)` = **150** → 太鼓台 150/800、`completed:false`
   * （`facilityNeedsRepair` 必为 true）。这里钉死**整条链路**，且全部走真实的 `advanceTenDay`
   * （委任执行 → 旬末结算），不手写旬初重置：
   *   第 1 旬（下达当旬）只带兵靠近、**不涨耐久**（这是设计口径：委任当旬的行动用于移动）；
   *   相邻之后的每一旬都**真的 +150**，直到 800/800 自动解除委任；
   *   全程停留格必须是设施的**相邻格** —— 否则就是「每旬都在移动却永远进不了 repairFacility」。
   */
  describe('玩家复现：3000 兵建出的 150/800 太鼓台，曹操从远处下修补委任（走真实推旬）', () => {
    /** 张辽（3000 兵）在襄阳附近建一座建不完的太鼓台（150/800），随后被调走（续建委任一并清掉）；
     *  曹操放在距设施 3 格处 —— 与玩家原话一致：接手修补的是「不相邻的另一支部队」。 */
    function distantDrumScene() {
      const state = createGame('cao', 1);
      state.units = {};
      state.facilities = {};
      const city = state.cities.xiangyang;
      let built: GameLike | undefined;
      let drum: { q: number; r: number } | undefined;
      for (let q = city.gridQ - 8; q <= city.gridQ + 8 && !drum; q += 1) {
        for (let r = city.gridR - 8; r <= city.gridR + 8 && !drum; r += 1) {
          if (!cellAt(state, { q, r })) continue;
          state.units['unit-b'] = makeUnit('cao', 'xiangyang', q, r, {
            id: 'unit-b', leaderId: 'zhang-liao', troops: 3000, gold: 2000,
          });
          const targets = facilityBuildTargets(state, 'unit-b', undefined, 'drum');
          if (targets.length === 0) {
            delete state.units['unit-b'];
            continue;
          }
          built = buildFacility(state, 'cao', 'unit-b', 'drum', targets[0]);
          drum = targets[0];
        }
      }
      if (!built || !drum) return undefined;
      const facilityId = Object.keys(built.facilities ?? {})[0]!;
      const facility = built.facilities![facilityId]!;
      // 玩家口径的 150/800、未建成
      expect(facility).toMatchObject({ forceId: 'cao', completed: false });
      expect(facility.durability).toBe(150);

      // 模拟玩家把张辽手动调走：手动行动会清掉建设当旬自动转出的续建委任，
      // 这座半成品从此只能靠「委任另一支部队来修」——接手的是曹操
      delete built.units['unit-b'];

      // 曹操放在距设施 3 格的合法陆格
      const footprint = new Set(Object.values(built.cities).flatMap((city2) => (
        sevenCellCityFootprint({ q: city2.gridQ, r: city2.gridR }).map((coord) => `${coord.q},${coord.r}`)
      )));
      const start = built.grid.find((cell) => {
        const key = `${cell.q},${cell.r}`;
        if (footprint.has(key)) return false;
        if (Math.abs(cell.q - drum!.q) + Math.abs(cell.r - drum!.r) > 4) return false;
        // 与设施相距 3 格（六边形距离：用 neighborsOf 两跳排除）
        const ring1 = neighborsOf(drum!.q, drum!.r);
        const ring2 = ring1.flatMap((coord) => neighborsOf(coord.q, coord.r));
        const isRing1 = ring1.some((coord) => coord.q === cell.q && coord.r === cell.r);
        const isRing2 = ring2.some((coord) => coord.q === cell.q && coord.r === cell.r);
        if (isRing1 || isRing2 || (cell.q === drum!.q && cell.r === drum!.r)) return false;
        return Number.isFinite(movementCostForCell(cell, movementProfileForUnit({ kind: 'combat', troopType: 'sword' }), undefined));
      });
      if (!start) return undefined;
      built.units['delegate-unit'] = makeUnit('cao', 'xiangyang', start.q, start.r, {
        id: 'delegate-unit', leaderId: 'cao-cao', troops: 3000,
      });
      return { state: built, facilityId, drum };
    }

    it('逐旬：下达当旬即靠近并修补，之后每旬真的 +150 直至 800/800，且停留格始终与设施相邻', () => {
      const scene = distantDrumScene();
      expect(scene).toBeDefined();
      if (!scene) return;
      const { state, facilityId, drum } = scene;
      const isAdjacentToDrum = (q: number, r: number) => neighborsOf(drum.q, drum.r).some((coord) => coord.q === q && coord.r === r);

      // 下达当旬：委任登记成功；移动力足够时本旬行动＝靠近＋就地修补（合计一次行动）
      let cursor = setRepairDelegate(state, 'cao', 'delegate-unit', facilityId);
      expect(cursor.units['delegate-unit'].delegate).toEqual({ kind: 'repair', facilityId });

      const trace: Array<{ q: number; r: number; durability: number; delegate: boolean }> = [{
        q: cursor.units['delegate-unit'].q,
        r: cursor.units['delegate-unit'].r,
        durability: cursor.facilities![facilityId].durability,
        delegate: Boolean(cursor.units['delegate-unit'].delegate),
      }];
      for (let guard = 0; guard < 10 && cursor.units['delegate-unit']?.delegate; guard += 1) {
        cursor = advanceTenDay(cursor);
        const unit = cursor.units['delegate-unit'];
        if (!unit) break;
        trace.push({
          q: unit.q, r: unit.r,
          durability: cursor.facilities![facilityId].durability,
          delegate: Boolean(unit.delegate),
        });
      }
      console.log('[chain] ' + trace.map((entry, index) => `#${index}(${entry.q},${entry.r}) 耐久=${entry.durability} 相邻=${isAdjacentToDrum(entry.q, entry.r)} 委任=${entry.delegate}`).join(' | '));

      // 下达当旬靠近并就地修补：150 → 300
      expect(trace[0].durability).toBe(300);
      // 之后每旬 +150 直到 800/800
      const durabilities = trace.map((entry) => entry.durability);
      expect(durabilities).toContain(800);
      // 一旦开始修补就不再中断：出现过的耐久值必须单调不减（最后一旬封顶 800）
      const rising = durabilities.filter((value) => value > 150);
      expect(rising.length).toBeGreaterThan(1);
      for (let index = 1; index < durabilities.length; index += 1) {
        expect(durabilities[index]).toBeGreaterThanOrEqual(durabilities[index - 1]);
      }
      // 每一次「耐久上涨」当旬，曹操都必须站在设施的相邻格上（否则就是空转）
      trace.forEach((entry) => {
        if (entry.durability > 150) expect(isAdjacentToDrum(entry.q, entry.r)).toBe(true);
      });
      expect(cursor.facilities![facilityId].durability).toBe(800);
      expect(cursor.units['delegate-unit'].delegate).toBeUndefined();
    });
  });

  /**
   * 委任修补的「接近格」必须与**这支部队真实的移动口径**一致（兵种/载具 + 势力科技阻挡）。
   *
   * 旧实现只问 `movementCostForCell(cell, undefined, undefined)`（不判科技、不判兵种），于是把「未研究
   * 「开路军」时进不去的小径/浅滩/川」也算成可接近格：设施的邻格全是这类地形时，`passableNeighborOfFacility`
   * 会返回一个永远进不去的格，`pickBestDelegateStop`（并刻意排除「留在原地」）只好在它旁边反复换位 ——
   * 实测真实地图 (0,82) 一座太鼓台旁边，委任部队在 **(5,77) ↔ (6,78) 之间每旬来回移动**，
   * 部队明明在动、也有音效，却永远进不了 `repairFacility` 分支：正是玩家
   * 「部队移动过去了，也播放了背景音，但是耐久没有增加」的机械成因。
   *
   * 修复后：进不去的格不再作为接近格 → 委任**登记不丢**、部队原地等待（不再空转），
   * 研究「开路军」后同一座设施立刻变成可达并正常逐旬修补。
   */
  describe('接近格必须真的进得去：邻格全被科技阻挡的设施不能让委任部队每旬空转', () => {
    /** 真实地图上找一个「可建设、且所有存在的邻格对这支部队都进不去」的设施位（六邻格全是小径等阻挡地形） */
    function deadEndDrumCell(state: GameLike) {
      return state.grid.find((cell) => (
        MILITARY_FACILITY_TERRAINS.has(cell.terrain)
        && neighborsOf(cell.q, cell.r).filter((coord) => cellAt(state, coord)).length > 0
        && neighborsOf(cell.q, cell.r)
          .filter((coord) => cellAt(state, coord))
          .every((coord) => !unitCanEnterCell(state, coord, { profile: 'sword', movingForceId: 'cao' }))
      ));
    }

    /** 设施位 + 距它 3 格的合法起点（曹操 3000 兵），全部走真实 `advanceTenDay` */
    function deadEndScene() {
      const state = createGame('cao', 1);
      state.units = {};
      state.facilities = {};
      const drum = deadEndDrumCell(state);
      if (!drum) return undefined;
      const start = state.grid.find((cell) => (
        unitCanEnterCell(state, { q: cell.q, r: cell.r }, { profile: 'sword', movingForceId: 'cao' })
        && Math.abs(cell.q - drum.q) + Math.abs(cell.r - drum.r) >= 3
        && Math.abs(cell.q - drum.q) + Math.abs(cell.r - drum.r) <= 5
      ));
      if (!start) return undefined;
      state.facilities = {
        drum: { id: 'drum', type: 'drum', forceId: 'cao', q: drum.q, r: drum.r, durability: 150, completed: false },
      };
      state.units['delegate-unit'] = makeUnit('cao', 'wan', start.q, start.r, {
        id: 'delegate-unit', leaderId: 'cao-cao', troops: 3000,
      });
      return { state, drum, start };
    }

    it('未研究「开路军」：委任登记不丢、部队原地等待，不再每旬在两格之间空转', () => {
      const scene = deadEndScene();
      expect(scene, '真实地图上必须存在这种「邻格全被科技挡住」的设施位').toBeDefined();
      if (!scene) return;
      const { state, drum, start } = scene;
      // 成因可读化：六个邻格确实都是「未研究开路军时进不去」的地形
      expect(canCrossRoughTerrain(state, 'cao')).toBe(false);
      const ringTerrains = neighborsOf(drum.q, drum.r).filter((coord) => cellAt(state, coord)).map((coord) => cellAt(state, coord)!.terrain);
      expect(ringTerrains.every((terrain) => ROUGH_TERRAINS.includes(terrain))).toBe(true);

      let cursor = setRepairDelegate(state, 'cao', 'delegate-unit', 'drum');
      // 委任必须登记（否则玩家的指令静默丢失）
      expect(cursor.units['delegate-unit'].delegate).toEqual({ kind: 'repair', facilityId: 'drum' });
      // 进不去就不乱走：下达当旬不移动
      expect(`${cursor.units['delegate-unit'].q},${cursor.units['delegate-unit'].r}`).toBe(`${start.q},${start.r}`);

      const startKey = `${start.q},${start.r}`;
      for (let tenDay = 0; tenDay < 6; tenDay += 1) {
        cursor = advanceTenDay(cursor);
        // 旧实现在这里每旬换位（(5,77) ↔ (6,78)）：任何一次移动都是「有音效、没修补」的空转
        expect(`${cursor.units['delegate-unit'].q},${cursor.units['delegate-unit'].r}`).toBe(startKey);
      }
      // 不可达就不假装修补：耐久原地不动，委任保留等待科技/通路
      expect(cursor.facilities!.drum.durability).toBe(150);
      expect(cursor.units['delegate-unit'].delegate).toEqual({ kind: 'repair', facilityId: 'drum' });
      // UI 与引擎同口径：这座设施对该部队不可达（设施菜单不会把它自动挑中）
      expect(canUnitReachRepairFacility(cursor, 'delegate-unit', 'drum')).toBe(false);
    });

    it('研究「开路军」后同一座设施立刻可达：部队靠近并逐旬修补到 800/800', () => {
      const scene = deadEndScene();
      expect(scene).toBeDefined();
      if (!scene) return;
      const { state } = scene;
      state.forces.cao.techNodes = [...(state.forces.cao.techNodes ?? []), 'kailujun'];
      expect(canCrossRoughTerrain(state, 'cao')).toBe(true);

      let cursor = setRepairDelegate(state, 'cao', 'delegate-unit', 'drum');
      expect(cursor.units['delegate-unit'].delegate).toEqual({ kind: 'repair', facilityId: 'drum' });
      expect(canUnitReachRepairFacility(cursor, 'delegate-unit', 'drum')).toBe(true);

      let guard = 0;
      while (cursor.units['delegate-unit']?.delegate && guard < 10) {
        cursor = advanceTenDay(cursor);
        guard += 1;
      }
      expect(cursor.facilities!.drum.durability).toBe(800);
      expect(cursor.units['delegate-unit'].delegate).toBeUndefined();
      // 收口时人就停在设施相邻格（这一旬就是在这里修满的）
      const unit = cursor.units['delegate-unit'];
      expect(neighborsOf(cursor.facilities!.drum.q, cursor.facilities!.drum.r)
        .some((coord) => coord.q === unit.q && coord.r === unit.r)).toBe(true);
    });
  });
});
