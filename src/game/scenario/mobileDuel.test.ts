import { describe, expect, it } from 'vitest';
import { sevenCellCityFootprint } from '../battle/grid';
import { createMobileDuelGame, MOBILE_DUEL_GRID_HEIGHT, MOBILE_DUEL_GRID_WIDTH } from './mobileDuel';

describe('mobile duel scenario', () => {
  it('creates a 16 by 33 two-city duel map for the selected online forces', () => {
    const game = createMobileDuelGame('liu', 'cao', 7);

    expect(game.scenarioId).toBe('mobile-duel');
    expect(game.gridWidth).toBe(16);
    expect(game.gridHeight).toBe(33);
    expect(game.grid).toHaveLength(MOBILE_DUEL_GRID_WIDTH * MOBILE_DUEL_GRID_HEIGHT);
    expect(Object.keys(game.cities).sort()).toEqual(['jiangling', 'xiangyang']);
    expect(game.cities.xiangyang).toMatchObject({ ownerId: 'cao', gridQ: 8, gridR: 3 });
    expect(game.cities.jiangling).toMatchObject({ ownerId: 'liu', gridQ: 8, gridR: 29 });
    expect(game.cities.xiangyang.mapX).toBeCloseTo((8 + 0.5) / 16, 4);
    expect(game.cities.jiangling.mapY).toBeCloseTo(29 / 33, 4);
  });

  it('keeps both seven-cell city footprints inside the phone-sized map', () => {
    const game = createMobileDuelGame('sun', 'biao', 11);

    for (const city of Object.values(game.cities)) {
      for (const coord of sevenCellCityFootprint({ q: city.gridQ, r: city.gridR })) {
        expect(coord.q).toBeGreaterThanOrEqual(0);
        expect(coord.q).toBeLessThan(MOBILE_DUEL_GRID_WIDTH);
        expect(coord.r).toBeGreaterThanOrEqual(0);
        expect(coord.r).toBeLessThan(MOBILE_DUEL_GRID_HEIGHT);
      }
    }
  });

  it('spans a seven-row middle river with shores and facing ferries', () => {
    const game = createMobileDuelGame('liu', 'cao', 7);

    for (let r = 13; r <= 19; r += 1) {
      expect(game.grid.find((cell) => cell.q === 0 && cell.r === r)?.terrain).toBe('water');
    }
    expect(game.grid.find((cell) => cell.q === 7 && cell.r === 12)?.terrain).toBe('shore');
    expect(game.grid.find((cell) => cell.q === 7 && cell.r === 20)?.terrain).toBe('shore');
    expect(game.grid.find((cell) => cell.q === 8 && cell.r === 12)?.terrain).toBe('ferry');
    expect(game.grid.find((cell) => cell.q === 8 && cell.r === 20)?.terrain).toBe('ferry');
    expect(game.grid.find((cell) => cell.q === 0 && cell.r === 12)?.terrain).toBe('shore');
    expect(game.grid.find((cell) => cell.q === 0 && cell.r === 20)?.terrain).toBe('shore');
    expect(game.cities.xiangyang.armaments).toMatchObject({ ram: 1, tower: 1, ship: 1 });
    expect(game.cities.jiangling.armaments).toMatchObject({ ram: 1, tower: 1, ship: 1 });
  });
});
