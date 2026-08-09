import { describe, expect, it } from 'vitest';
import { createGame } from './scenario/jingxiang208';
import { territoryForceAt } from './territory';

describe('territory ownership', () => {
  it('assigns each grid cell to the nearest city owner', () => {
    const state = createGame('liu', 1);
    const jianglingCell = state.grid.find((cell) => cell.q === state.cities.jiangling.gridQ && cell.r === state.cities.jiangling.gridR)!;
    const wanCell = state.grid.find((cell) => cell.q === 0 && cell.r === 0)!;

    expect(territoryForceAt(state, jianglingCell)).toBe('liu');
    expect(territoryForceAt(state, wanCell)).toBe('cao');
  });

  it('updates territory when the nearest city changes owner', () => {
    const state = createGame('liu', 1);
    const jianglingCell = state.grid.find((cell) => cell.q === state.cities.jiangling.gridQ && cell.r === state.cities.jiangling.gridR)!;
    state.cities.jiangling.ownerId = 'sun';

    expect(territoryForceAt(state, jianglingCell)).toBe('sun');
  });
});
