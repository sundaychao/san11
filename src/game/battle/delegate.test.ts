import { describe, expect, it } from 'vitest';
import { reduceGameIntent } from '../network/intentReducer';
import { createGame } from '../scenario/jingxiang208';
import type { ArmyUnit, FacilityType } from '../types';
import { movementCells } from './movementRules';
import { cellAt } from './movementRules';
import { neighborsOf } from './grid';
import { FACILITY_BUILD_COSTS, facilityBuildTargets, movementAllowanceForUnit } from './legacyCore';
import { buildFacility } from './facilities';
import {
  computeDelegatePath,
  executeDelegations,
  setBuildDelegate,
  setMoveDelegate,
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
