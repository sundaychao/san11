import { describe, expect, it } from 'vitest';
import { sevenCellCityFootprint } from './grid';
import { createBattleGrid, GRID_HEIGHT, GRID_WIDTH } from './scenario';
import { createGame } from '../scenario/jingxiang208';

describe('battle scenario state', () => {
  it('creates a schema v2 game with ten-day battle fields', () => {
    const game = createGame('liu', 20804);

    expect(GRID_WIDTH).toBe(70);
    expect(GRID_HEIGHT).toBe(40);
    expect(game.schemaVersion).toBe(2);
    expect(game.tenDay).toBe(1);
    expect(game.turnForceId).toBe('liu');
    expect(game.units).toEqual({});
    expect(game.grid).toHaveLength(GRID_WIDTH * GRID_HEIGHT);
  });

  it('assigns every city a seven-cell center footprint and durability', () => {
    const game = createGame('cao', 1);
    const occupiedKeys = new Set<string>();

    for (const city of Object.values(game.cities)) {
      expect(city.gridQ).toBeGreaterThanOrEqual(0);
      expect(city.gridR).toBeGreaterThanOrEqual(0);
      expect(city.maxDurability).toBeGreaterThan(0);
      expect(city.durability).toBe(city.maxDurability);

      for (const coord of sevenCellCityFootprint({ q: city.gridQ, r: city.gridR })) {
        const key = `${coord.q},${coord.r}`;
        expect(occupiedKeys.has(key)).toBe(false);
        occupiedKeys.add(key);
      }
    }
  });

  it('creates deterministic terrain cells with passable routes and blocked mountains', () => {
    const grid = createBattleGrid();

    expect(grid.find((cell) => cell.terrain === 'road')).toBeTruthy();
    expect(grid.find((cell) => cell.terrain === 'plain')).toBeTruthy();
    expect(grid.find((cell) => cell.terrain === 'forest')).toBeTruthy();
    expect(grid.find((cell) => cell.terrain === 'hill')).toBeTruthy();
    expect(grid.find((cell) => cell.terrain === 'mountain')).toBeTruthy();
    expect(grid.find((cell) => cell.terrain === 'water')).toBeTruthy();
  });
});
