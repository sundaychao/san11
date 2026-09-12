import { describe, expect, it } from 'vitest';
import { createGame } from '../scenario/jingxiang208';
import type { ArmyUnit } from '../types';
import { cellAt, deploymentCells, isLegalUnitCell, movementCells, reachableCosts } from './movementRules';
import { neighborsOf, sevenCellCityFootprint } from './grid';
import { territoryForceAt } from '../territory';

function addUnit(state: ReturnType<typeof createGame>, unit: ArmyUnit) {
  state.units[unit.id] = unit;
}

describe('movement rules', () => {
  it('applies troop-specific terrain costs while calculating reachable cells', () => {
    const state = createGame('liu', 1);
    for (const cell of state.grid) cell.terrain = 'plain';
    const unit: ArmyUnit = {
      id: 'movement-test',
      kind: 'combat',
      forceId: 'liu',
      leaderId: 'liu-bei',
      homeCityId: 'jiangling',
      troopType: 'cavalry',
      q: 10,
      r: 10,
      troops: 3000,
      food: 3000,
      energy: 100,
      movementRemaining: 6,
      moved: false,
      acted: false,
    };
    addUnit(state, unit);
    const forestCell = state.grid.find((cell) => cell.q === 10 && cell.r === 9);
    if (!forestCell) throw new Error('test cell missing');
    forestCell.terrain = 'forest';

    const costs = reachableCosts(state, unit);

    expect(costs.has('10,9')).toBe(false);
    expect(costs.get('10,11')).toBe(4);
    expect(movementCells(state, unit.id)).not.toContainEqual({ q: 10, r: 9 });
    expect(movementCells(state, unit.id)).toContainEqual({ q: 10, r: 11 });
  });

  it('treats all seven city cells and occupied unit cells as illegal destinations', () => {
    const state = createGame('liu', 1);
    for (const cell of state.grid) cell.terrain = 'plain';
    const city = state.cities.jiangling;
    const unit: ArmyUnit = {
      id: 'movement-test',
      kind: 'combat',
      forceId: 'liu',
      leaderId: 'liu-bei',
      homeCityId: city.id,
      troopType: 'sword',
      q: 10,
      r: 10,
      troops: 3000,
      food: 3000,
      energy: 100,
      movementRemaining: 10,
      moved: false,
      acted: false,
    };
    addUnit(state, unit);
    addUnit(state, { ...unit, id: 'blocking-unit', q: 11, r: 10 });

    expect(isLegalUnitCell(state, { q: city.gridQ, r: city.gridR }, unit.id)).toBe(false);
    expect(isLegalUnitCell(state, sevenCellCityFootprint(cityCenter(city))[1], unit.id)).toBe(false);
    expect(isLegalUnitCell(state, { q: 11, r: 10 }, unit.id)).toBe(false);
    expect(isLegalUnitCell(state, { q: 10, r: 11 }, unit.id)).toBe(true);
  });

  it('lets units stop on shore and board water from the bank in the next turn (岸边停靠/上下水分旬)', () => {
    // 原版地图江陵东侧：湿地(86,137) → 湿地(86,138) → 岸边(86,139) → 河(86,140)
    const state = createGame('liu', 1);
    const makeUnit = (id: string, mov: number): ArmyUnit => ({
      id,
      kind: 'combat',
      forceId: 'liu',
      leaderId: 'liu-bei',
      homeCityId: 'jiangling',
      troopType: 'sword',
      q: 86,
      r: 137,
      troops: 3000,
      food: 3000,
      energy: 100,
      movementRemaining: mov,
      moved: false,
      acted: false,
    });
    const unit = makeUnit('shore-test', 30);
    addUnit(state, unit);

    // 岸边格可按水域消耗进入（不是不可通行）
    expect(isLegalUnitCell(state, { q: 86, r: 139 }, 'shore-test')).toBe(true);
    let cells = movementCells(state, 'shore-test');
    expect(cells).toContainEqual({ q: 86, r: 139 });
    // 但同旬不能从岸边入水：入水必须旬初已停在岸边（停靠）
    expect(cells).not.toContainEqual({ q: 86, r: 140 });

    // 旬初在岸边出发：可以入水（消耗全部行动力，作为终点）
    const docked = structuredClone(state);
    docked.units['shore-test']!.q = 86;
    docked.units['shore-test']!.r = 139;
    cells = movementCells(docked, 'shore-test');
    expect(cells).toContainEqual({ q: 86, r: 140 });
    // 入水即终点，不能同旬深入
    expect(cells).not.toContainEqual({ q: 86, r: 141 });
  });

  it('deployment still crosses the launch city footprint', () => {
    const state = createGame('liu', 1);
    const cells = deploymentCells(state, 'jiangling', 20, 'sword');
    expect(cells.length).toBeGreaterThan(0);
  });

  it('科技「开路军」：未研究时小径／浅滩／川不可通行，研究后可通行', () => {
    const state = createGame('liu', 1);
    for (const cell of state.grid) cell.terrain = 'plain';
    // 目标格周围铺一条小径，其余保持平原（平地消耗 4）
    const pathCell = state.grid.find((cell) => cell.q === 10 && cell.r === 9);
    if (!pathCell) throw new Error('test cell missing');
    pathCell.terrain = 'path';
    const streamCell = state.grid.find((cell) => cell.q === 10 && cell.r === 11);
    if (!streamCell) throw new Error('test cell missing');
    streamCell.terrain = 'stream';
    const unit: ArmyUnit = {
      id: 'kailu-test',
      kind: 'combat',
      forceId: 'liu',
      leaderId: 'liu-bei',
      homeCityId: 'jiangling',
      troopType: 'sword',
      q: 10,
      r: 10,
      troops: 3000,
      food: 3000,
      energy: 100,
      movementRemaining: 20,
      moved: false,
      acted: false,
    };
    addUnit(state, unit);
    state.forces.liu.techNodes = [];

    expect(isLegalUnitCell(state, { q: 10, r: 9 }, 'kailu-test', 'sword', 'liu')).toBe(false);
    expect(isLegalUnitCell(state, { q: 10, r: 11 }, 'kailu-test', 'sword', 'liu')).toBe(false);

    // 研究开路军后：小径（消耗 5）与川都可通行
    state.forces.liu.techNodes = ['kailujun'];
    expect(isLegalUnitCell(state, { q: 10, r: 9 }, 'kailu-test', 'sword', 'liu')).toBe(true);
    expect(isLegalUnitCell(state, { q: 10, r: 11 }, 'kailu-test', 'sword', 'liu')).toBe(true);
    const costs = reachableCosts(state, state.units['kailu-test']);
    expect(costs.get('10,9')).toBe(5);
  });

  it('科技「修筑要塞」：敌军在我方领地内移动消耗 +1', () => {
    const state = createGame('liu', 1);
    for (const cell of state.grid) cell.terrain = 'plain';
    // 找一处「刘备领地内、且能从领地外一格踏进来」的平原格
    const target = state.grid.find((cell) => territoryForceAt(state, cell) === 'liu'
      && neighborsOf(cell.q, cell.r).some((n) => cellAt(state, n) && territoryForceAt(state, n) !== 'liu'));
    if (!target) throw new Error('找不到刘备领地边缘格');
    const origin = neighborsOf(target.q, target.r)
      .find((n) => cellAt(state, n) && territoryForceAt(state, n) !== 'liu')!;
    const key = `${target.q},${target.r}`;

    const unit: ArmyUnit = {
      id: 'territory-test',
      kind: 'combat',
      forceId: 'cao',
      leaderId: 'cao-cao',
      homeCityId: 'xiangyang',
      troopType: 'sword',
      q: origin.q,
      r: origin.r,
      troops: 3000,
      food: 3000,
      energy: 100,
      movementRemaining: 20,
      moved: false,
      acted: false,
    };
    addUnit(state, unit);
    state.forces.liu.techNodes = [];
    expect(reachableCosts(state, unit).get(key)).toBe(4);

    // 刘备研究「修筑要塞」后，曹军踏入其领地要多花 1 点移动力
    state.forces.liu.techNodes = ['xiuzhuyaosai'];
    expect(reachableCosts(state, state.units['territory-test']).get(key)).toBe(5);

    // 己方领地不受影响（刘备自己的部队走进自家领地仍是 4）
    const own: ArmyUnit = { ...unit, id: 'own-territory', forceId: 'liu' };
    addUnit(state, own);
    expect(reachableCosts(state, state.units['own-territory']).get(key)).toBe(4);
  });
});

function cityCenter(city: { gridQ: number; gridR: number }) {
  return { q: city.gridQ, r: city.gridR };
}
