import { describe, expect, it } from 'vitest';
import { createGame } from '../scenario/jingxiang208';
import type { ArmyUnit } from '../types';
import { cellAt, movementCells, ownCityAt } from './movementRules';
import { moveUnit } from './movement';
import { sevenCellCityFootprint, neighborsOf } from './grid';

function makeUnit(forceId: string, homeCityId: string, q: number, r: number): ArmyUnit {
  return {
    id: 'return-test-unit',
    kind: 'combat',
    forceId,
    leaderId: 'liu-bei',
    homeCityId,
    troopType: 'sword',
    q,
    r,
    troops: 3000,
    food: 3000,
    energy: 100,
    movementRemaining: 20,
    moved: false,
    acted: false,
  } as ArmyUnit;
}

/** 在城池 footprint 外找一格邻接格（保证部队离城够近） */
function spawnCellNear(state: ReturnType<typeof createGame>, city: { gridQ: number; gridR: number }) {
  const footprintKeys = new Set(sevenCellCityFootprint({ q: city.gridQ, r: city.gridR }).map((c) => `${c.q},${c.r}`));
  return neighborsOf(city.gridQ, city.gridR).flatMap((n) => neighborsOf(n.q, n.r))
    .find((c) => !footprintKeys.has(`${c.q},${c.r}`) && cellAt(state, c))!;
}

describe('部队回城（移动到本方城池格）', () => {
  it('movementCells 包含可达的本方城池中心格，不含敌方城池格', () => {
    const state = createGame('liu', 1);
    const city = state.cities.jiangling;
    const spawn = spawnCellNear(state, city);
    state.units['return-test-unit'] = makeUnit('liu', city.id, spawn.q, spawn.r);

    const targets = movementCells(state, 'return-test-unit');

    expect(targets).toContainEqual({ q: city.gridQ, r: city.gridR });
    const enemyCity = Object.values(state.cities).find((c) => c.ownerId !== 'liu')!;
    expect(targets).not.toContainEqual({ q: enemyCity.gridQ, r: enemyCity.gridR });
  });

  it('moveUnit 到本方城池中心格：部队消失、兵力军粮归城、武将回城', () => {
    const state = createGame('liu', 1);
    const city = state.cities.jiangling;
    const spawn = spawnCellNear(state, city);
    state.units['return-test-unit'] = makeUnit('liu', city.id, spawn.q, spawn.r);
    const before = { troops: city.troops, food: city.food };

    const next = moveUnit(state, 'liu', 'return-test-unit', { q: city.gridQ, r: city.gridR });

    expect(next.units['return-test-unit']).toBeUndefined();
    expect(next.cities[city.id].troops).toBe(before.troops + 3000);
    expect(next.cities[city.id].food).toBe(before.food + 3000);
    const officer = next.officers['liu-bei'];
    expect(officer.location).toEqual({ kind: 'city', cityId: city.id });
    expect(officer.cityId).toBe(city.id);
    expect(officer.acted).toBe(true);
    expect(next.logs.some((log) => log.message.includes('返回'))).toBe(true);
  });

  it('回城士兵按部队当前士气加权稀释城池士气（与征兵公式一致）', () => {
    const state = createGame('liu', 1);
    const city = state.cities.jiangling;
    const spawn = spawnCellNear(state, city);
    const unit = makeUnit('liu', city.id, spawn.q, spawn.r);
    unit.energy = 30; // 打残部队士气30
    state.units['return-test-unit'] = unit;

    const prevTroops = city.troops;
    const prevMorale = city.training;
    const returned = unit.troops; // 3000
    const expected = Math.round(Math.min(100, Math.max(0, (prevTroops * prevMorale + returned * 30) / (prevTroops + returned))));

    const next = moveUnit(state, 'liu', 'return-test-unit', { q: city.gridQ, r: city.gridR });

    expect(next.cities[city.id].troops).toBe(prevTroops + returned);
    expect(next.cities[city.id].training).toBe(expected);
    // 打残部队（士气30）回城会拉低原城士气
    expect(next.cities[city.id].training).toBeLessThan(prevMorale);
  });

  it('moveUnit 到敌方城池格仍被拒绝', () => {
    const state = createGame('liu', 1);
    const enemyCity = Object.values(state.cities).find((c) => c.ownerId !== 'liu')!;
    const spawn = spawnCellNear(state, enemyCity);
    state.units['return-test-unit'] = makeUnit('liu', 'jiangling', spawn.q, spawn.r);

    expect(() => moveUnit(state, 'liu', 'return-test-unit', { q: enemyCity.gridQ, r: enemyCity.gridR }))
      .toThrow('目标格被占用或不可通行');
  });

  it('ownCityAt 只匹配本方城池 footprint', () => {
    const state = createGame('liu', 1);
    const city = state.cities.jiangling;
    expect(ownCityAt(state, 'liu', { q: city.gridQ, r: city.gridR })?.id).toBe(city.id);
    const enemyCity = Object.values(state.cities).find((c) => c.ownerId !== 'liu')!;
    expect(ownCityAt(state, 'liu', { q: enemyCity.gridQ, r: enemyCity.gridR })).toBeUndefined();
  });
});
