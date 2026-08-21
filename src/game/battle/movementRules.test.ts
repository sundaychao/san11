import { describe, expect, it } from 'vitest';
import { createGame } from '../scenario/jingxiang208';
import type { ArmyUnit } from '../types';
import { isLegalUnitCell, movementCells, reachableCosts } from './movementRules';
import { sevenCellCityFootprint } from './grid';

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
});

function cityCenter(city: { gridQ: number; gridR: number }) {
  return { q: city.gridQ, r: city.gridR };
}
