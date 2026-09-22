import { describe, expect, it } from 'vitest';
import { createGame } from '../scenario/jingxiang208';
import type { ArmyUnit, CityId } from '../types';
import { advanceTenDay } from '../turn';
import { cellAt, controlledZoneKeysForForce } from './movementRules';
import { gridKey, neighborsOf, sevenCellCityFootprint } from './grid';
import { movementAllowanceForUnit, movementCostForCell } from './catalog';

type GameLike = ReturnType<typeof createGame>;

function placeUnit(state: GameLike, id: string, forceId: string, homeCityId: string, q: number, r: number, overrides: Partial<ArmyUnit> = {}) {
  state.units[id] = {
    id,
    kind: 'combat',
    forceId,
    leaderId: 'guan-yu',
    officerIds: ['guan-yu'],
    homeCityId,
    troopType: 'sword',
    q,
    r,
    troops: 3000,
    food: 6000,
    gold: 0,
    energy: 100,
    stamina: 100,
    movementRemaining: 20,
    moved: false,
    acted: false,
    ...overrides,
  } as ArmyUnit;
  return state.units[id];
}

/** 城 footprint 之外、距离城内 minDistance 格以上的第一个可通行空地（当作「野外站位」） */
function outskirtCell(state: GameLike, cityId: CityId, minDistance: number) {
  const city = state.cities[cityId];
  const center = { q: city.gridQ, r: city.gridR };
  const occupied = new Set(Object.values(state.units).map((unit) => gridKey(unit)));
  const facilityKeys = new Set(Object.values(state.facilities ?? {}).map((facility) => gridKey(facility)));
  const cityKeys = new Set(Object.values(state.cities).flatMap((candidate) => (
    sevenCellCityFootprint({ q: candidate.gridQ, r: candidate.gridR }).map(gridKey)
  )));
  let frontier = [center];
  const seen = new Set([gridKey(center)]);
  for (let step = 1; step <= minDistance + 3; step += 1) {
    const nextFrontier: { q: number; r: number }[] = [];
    for (const coord of frontier) {
      for (const neighbor of neighborsOf(coord.q, coord.r)) {
        const key = gridKey(neighbor);
        if (seen.has(key)) continue;
        seen.add(key);
        nextFrontier.push(neighbor);
      }
    }
    if (step >= minDistance) {
      const found = nextFrontier.find((coord) => (
        cellAt(state, coord) !== undefined
        && !cityKeys.has(gridKey(coord))
        && !occupied.has(gridKey(coord))
        && !facilityKeys.has(gridKey(coord))
        && Number.isFinite(movementCostForCell(cellAt(state, coord), undefined, undefined))
      ));
      if (found) return found;
    }
    frontier = nextFrontier;
  }
  return undefined;
}

describe('伪报状态', () => {
  it('伪报部队仍然产生控制区，混乱部队不产生', () => {
    const state = createGame('liu', 1);
    state.units = {};
    state.facilities = {};
    const foe = placeUnit(state, 'foe', 'cao', 'xiangyang', 10, 10, { falseReportedTenDays: 2 });

    const neighborKeys = neighborsOf(10, 10).map(gridKey);
    const reportZoc = controlledZoneKeysForForce(state, 'liu');
    expect(neighborKeys.some((key) => reportZoc.has(key))).toBe(true);

    delete foe.falseReportedTenDays;
    foe.confusedTenDays = 2;
    const confuseZoc = controlledZoneKeysForForce(state, 'liu');
    expect(neighborKeys.some((key) => confuseZoc.has(key))).toBe(false);
  });

  it('伪报部队在新旬开始自动向出发地行军，走到城里即回城并账', () => {
    const state = createGame('liu', 1);
    state.units = {};
    state.facilities = {};
    const stand = outskirtCell(state, 'xiangyang', 1)!;
    expect(stand).toBeDefined();
    const troopsBefore = state.cities.xiangyang.troops;
    placeUnit(state, 'foe', 'cao', 'xiangyang', stand.q, stand.r, { falseReportedTenDays: 3 });

    const next = advanceTenDay(state);

    // 出发地 = 自己的城池：按委任规则走到城格 → moveUnit 回城并账，部队消失、兵力入城
    expect(next.units.foe).toBeUndefined();
    expect(next.cities.xiangyang.troops).toBeGreaterThan(troopsBefore);
  });

  it('出发地已不在自己手里时改退最近的己方城池，并把本旬行动用掉', () => {
    const state = createGame('liu', 1);
    state.facilities = {};
    const stand = outskirtCell(state, 'xiangyang', 4)!;
    expect(stand).toBeDefined();
    const mover = placeUnit(state, 'foe', 'cao', 'jiangling', stand.q, stand.r, { falseReportedTenDays: 3 });

    const next = advanceTenDay(state);

    const after = next.units.foe;
    expect(after).toBeDefined();
    // 一旬走不完 → 停在半路，位置必须变化，且本旬不能再被操作
    expect(after.q !== mover.q || after.r !== mover.r).toBe(true);
    expect(after.acted).toBe(true);
    // 撤退不是委任，不参与「委」徽章口径
    expect(after.delegate).toBeUndefined();
    expect(after.delegateActed).toBeUndefined();
  });

  it('一个己方城池都没有时原地不动', () => {
    const state = createGame('liu', 1);
    state.facilities = {};
    for (const city of Object.values(state.cities)) {
      if (city.ownerId === 'cao') city.ownerId = null;
    }
    const stand = outskirtCell(state, 'xiangyang', 4)!;
    const mover = placeUnit(state, 'foe', 'cao', 'jiangling', stand.q, stand.r, { falseReportedTenDays: 3 });

    const next = advanceTenDay(state);

    expect(next.units.foe.q).toBe(mover.q);
    expect(next.units.foe.r).toBe(mover.r);
  });

  it('伪报只差 1 旬时会在旬初恢复，不再撤退', () => {
    const state = createGame('liu', 1);
    state.units = {};
    state.facilities = {};
    const stand = outskirtCell(state, 'xiangyang', 1)!;
    const mover = placeUnit(state, 'foe', 'cao', 'xiangyang', stand.q, stand.r, { falseReportedTenDays: 1 });

    const next = advanceTenDay(state);

    // 旬初递减已把状态清掉：部队留在原地（没有「额外一旬的撤退」）
    expect(next.units.foe.falseReportedTenDays).toBeUndefined();
    expect(next.units.foe.q).toBe(mover.q);
    expect(next.units.foe.r).toBe(mover.r);
    expect(movementAllowanceForUnit(next.units.foe)).toBeGreaterThan(0);
  });
});
