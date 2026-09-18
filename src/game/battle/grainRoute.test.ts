import { describe, expect, it } from 'vitest';
import { createGame } from '../scenario/jingxiang208';
import { settleTenDay } from '../turn';
import type { GameState } from '../types';
import {
  GRAIN_ROUTE_CITY_FOOD_FLOOR,
  GRAIN_ROUTE_MOVEMENT_BUDGET,
  GRAIN_ROUTE_TEN_DAY_STEP,
  grainRouteBlockedOf,
  grainRouteCostsOf,
  grainRouteKeysOf,
} from './grainRoute';

function clearUnits(state: GameState) {
  state.units = {};
}

function flattenAround(state: GameState, cityId: string, radius: number) {
  const city = state.cities[cityId as 'jiangling']!;
  for (const cell of state.grid) {
    if (Math.abs(cell.q - city.gridQ) + Math.abs(cell.r - city.gridR) <= radius) {
      cell.terrain = 'plain';
    }
  }
}

function unitAt(state: GameState, id: string, q: number, r: number, overrides: Record<string, unknown> = {}) {
  state.units[id] = {
    id,
    kind: 'combat',
    forceId: 'liu',
    leaderId: 'liu-bei',
    homeCityId: 'jiangling',
    troopType: 'sword',
    q,
    r,
    troops: 10000,
    food: 5000,
    energy: 80,
    movementRemaining: 5,
    moved: false,
    acted: false,
    ...overrides,
  } as typeof state.units[string];
}

describe('grain route range', () => {
  it('covers the home city itself and far cells within the 20-ten-day transport budget', () => {
    const state = createGame('liu', 1);
    clearUnits(state);
    const jl = state.cities.jiangling;
    const keys = grainRouteKeysOf(state, 'jiangling');

    expect(keys.has(`${jl.gridQ},${jl.gridR}`)).toBe(true);
    // 预算 = 运输队移动力 20 × 20 旬 = 400；平地消耗 4，可覆盖上百格
    expect(GRAIN_ROUTE_MOVEMENT_BUDGET).toBe(400);
    const far = [...keys].map((key) => key.split(',').map(Number))
      .filter(([q, r]) => Math.abs(q - jl.gridQ) + Math.abs(r - jl.gridR) >= 10);
    expect(far.length).toBeGreaterThan(0);
  });

  it('excludes enemy-occupied cells and aligns ZOC entry to the next ten-day', () => {
    const state = createGame('liu', 1);
    clearUnits(state);
    flattenAround(state, 'jiangling', 6);
    const jl = state.cities.jiangling;
    const { gridQ: q0, gridR: r0 } = jl;

    // 基准：东侧 3 格（全平地、无阻挡）消耗 = 3×4
    const baseCosts = grainRouteCostsOf(state, 'jiangling');
    expect(baseCosts.get(`${q0 + 3},${r0}`)).toBe(12);

    // 放一队敌方部队在东侧 2 格：其占格不可达；相邻格（ZOC）进入即当旬终止
    state.units['cao-blocker'] = {
      id: 'cao-blocker', kind: 'combat', forceId: 'cao', leaderId: 'cao-ca',
      homeCityId: 'wan', troopType: 'sword', q: q0 + 2, r: r0, troops: 3000, food: 3000,
      energy: 80, movementRemaining: 5, moved: false, acted: false,
    } as typeof state.units[string];

    const costs = grainRouteCostsOf(state, 'jiangling');
    expect(costs.has(`${q0 + 2},${r0}`)).toBe(false);
    // 东侧 3 格成了敌方 ZOC 格：进入即当旬终止，累计消耗必是旬移动力（20）的整数倍，
    // 且因本旬剩余作废而高于无阻挡时的 12
    const zocCost = costs.get(`${q0 + 3},${r0}`);
    expect(zocCost).toBeGreaterThan(12);
    expect(zocCost! % GRAIN_ROUTE_TEN_DAY_STEP).toBe(0);
    expect(zocCost!).toBeLessThanOrEqual(GRAIN_ROUTE_MOVEMENT_BUDGET);
  });

  it('excludes enemy facility cells from the route', () => {
    const state = createGame('liu', 1);
    clearUnits(state);
    const jl = state.cities.jiangling;
    state.facilities = {
      'enemy-tower': { id: 'enemy-tower', type: 'arrowTower', forceId: 'cao', q: jl.gridQ + 3, r: jl.gridR, durability: 700 },
    };

    const keys = grainRouteKeysOf(state, 'jiangling');
    expect(keys.has(`${jl.gridQ + 3},${jl.gridR}`)).toBe(false);
  });

  it('marks a unit blocked when outside the route, when the home city fell, or when city food is low', () => {
    const state = createGame('liu', 1);
    clearUnits(state);
    const jl = state.cities.jiangling;
    const inRoute = [...grainRouteKeysOf(state, 'jiangling')]
      .map((key) => key.split(',').map(Number))
      .find(([q, r]) => Math.abs(q - jl.gridQ) + Math.abs(r - jl.gridR) >= 3 && Math.abs(q - jl.gridQ) + Math.abs(r - jl.gridR) <= 6)!;

    unitAt(state, 'in-route', inRoute[0], inRoute[1]);
    expect(grainRouteBlockedOf(state, state.units['in-route']!)).toBe(false);

    // 范围外：找一个山格（地形不可通行 → 必不可达）
    const mountain = state.grid.find((cell) => cell.terrain === 'mountain')!;
    unitAt(state, 'far-out', mountain.q, mountain.r);
    expect(grainRouteBlockedOf(state, state.units['far-out']!)).toBe(true);

    // 本城存粮低于门槛
    state.cities.jiangling.food = GRAIN_ROUTE_CITY_FOOD_FLOOR - 1;
    expect(grainRouteBlockedOf(state, state.units['in-route']!)).toBe(true);

    // 出发城易主
    state.cities.jiangling.food = 38000;
    state.cities.jiangling.ownerId = 'cao';
    expect(grainRouteBlockedOf(state, state.units['in-route']!)).toBe(true);
  });
});

describe('grain route settlement', () => {
  it('splits the ten-day food cost in half between unit and home city while supplied', () => {
    const state = createGame('liu', 1);
    clearUnits(state);
    const jl = state.cities.jiangling;
    const inRoute = [...grainRouteKeysOf(state, 'jiangling')]
      .map((key) => key.split(',').map(Number))
      .find(([q, r]) => Math.abs(q - jl.gridQ) + Math.abs(r - jl.gridR) >= 3 && Math.abs(q - jl.gridQ) + Math.abs(r - jl.gridR) <= 6)!;
    unitAt(state, 'grain-unit', inRoute[0], inRoute[1]);

    // settleTenDay 不修改入参（structuredClone），先算带部队的，再清部队算基线
    const withUnit = settleTenDay(state);
    delete state.units['grain-unit'];
    const baseline = settleTenDay(state);

    // 10000 兵每旬耗 1000：粮道通 → 部队扣 500、本城另担 500
    expect(withUnit.units['grain-unit']!.food).toBe(4500);
    expect(baseline.cities.jiangling.food - withUnit.cities.jiangling.food).toBe(500);
    // 士气正常回复 +5，不受阻
    expect(withUnit.units['grain-unit']!.energy).toBe(85);
  });

  it('makes the unit pay full cost, get no city share, and lose 3 morale when blocked', () => {
    const state = createGame('liu', 1);
    clearUnits(state);
    const jl = state.cities.jiangling;
    const inRoute = [...grainRouteKeysOf(state, 'jiangling')]
      .map((key) => key.split(',').map(Number))
      .find(([q, r]) => Math.abs(q - jl.gridQ) + Math.abs(r - jl.gridR) >= 3 && Math.abs(q - jl.gridQ) + Math.abs(r - jl.gridR) <= 6)!;
    state.cities.jiangling.food = GRAIN_ROUTE_CITY_FOOD_FLOOR - 1; // 跌破门槛 → 粮道受阻
    unitAt(state, 'blocked-unit', inRoute[0], inRoute[1]);

    expect(grainRouteBlockedOf(state, state.units['blocked-unit']!)).toBe(true);

    const withUnit = settleTenDay(state);
    delete state.units['blocked-unit'];
    const baseline = settleTenDay(state);

    // 全额自耗 1000（不是 500），本城一分不出
    expect(withUnit.units['blocked-unit']!.food).toBe(4000);
    expect(baseline.cities.jiangling.food - withUnit.cities.jiangling.food).toBe(0);
    // 受阻：不回复士气且每旬 -3（80 → 77），而不是粮道通时的 +5
    expect(withUnit.units['blocked-unit']!.energy).toBe(77);
  });

  it('keeps transport units outside the grain-route rules', () => {
    const state = createGame('liu', 1);
    clearUnits(state);
    const jl = state.cities.jiangling;
    const inRoute = [...grainRouteKeysOf(state, 'jiangling')]
      .map((key) => key.split(',').map(Number))
      .find(([q, r]) => Math.abs(q - jl.gridQ) + Math.abs(r - jl.gridR) >= 3 && Math.abs(q - jl.gridQ) + Math.abs(r - jl.gridR) <= 6)!;
    unitAt(state, 'transport-unit', inRoute[0], inRoute[1], { kind: 'transport', troops: 1000 });

    expect(grainRouteBlockedOf(state, state.units['transport-unit']!)).toBe(false);

    const next = settleTenDay(state);

    // 1000 兵每旬耗 100：运输队全额自耗、不降士气
    expect(next.units['transport-unit']!.food).toBe(4900);
    expect(next.units['transport-unit']!.energy).toBe(85);
  });
});
