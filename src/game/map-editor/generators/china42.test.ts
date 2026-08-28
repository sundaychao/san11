import { describe, expect, it } from 'vitest';
import { neighborsOf } from '../../battle/grid';
import { generateChina42Map } from './china42';

describe('china42 map generator', () => {
  const map = generateChina42Map();

  const cellAt = (q: number, r: number) => map.grid.find((cell) => cell.q === q && cell.r === r);

  it('generates a deterministic 200 by 200 grid', () => {
    expect(map.width).toBe(200);
    expect(map.height).toBe(200);
    expect(map.grid).toHaveLength(200 * 200);
    expect(JSON.stringify(generateChina42Map())).toBe(JSON.stringify(map));
  });

  it('places forty-three uniquely identified cities on habitable ground', () => {
    expect(map.cities).toHaveLength(43);
    expect(new Set(map.cities.map((city) => city.id)).size).toBe(43);
    for (const city of map.cities) {
      expect(city.label.length).toBeGreaterThan(0);
      const center = cellAt(city.q, city.r)?.terrain;
      expect(center).not.toBe('water');
      expect(center).not.toBe('mountain');
      for (const coord of neighborsOf(city.q, city.r)) {
        const terrain = cellAt(coord.q, coord.r)?.terrain;
        expect(terrain).not.toBe('water');
        expect(terrain).not.toBe('mountain');
      }
    }
  });

  it('keeps every city at least eight cells apart', () => {
    for (let a = 0; a < map.cities.length; a += 1) {
      for (let b = a + 1; b < map.cities.length; b += 1) {
        const distance = Math.max(
          Math.abs(map.cities[a].q - map.cities[b].q),
          Math.abs(map.cities[a].r - map.cities[b].r),
        );
        expect(distance).toBeGreaterThanOrEqual(8);
      }
    }
  });

  it('links all cities through traversable land and ferries', () => {
    const passable = new Set<string>();
    for (const cell of map.grid) {
      if (cell.terrain !== 'water' && cell.terrain !== 'mountain') passable.add(`${cell.q},${cell.r}`);
    }
    const adjacent = new Map<string, string[]>();
    for (const key of passable) {
      const [q, r] = key.split(',').map(Number);
      adjacent.set(key, neighborsOf(q, r).map((coord) => `${coord.q},${coord.r}`).filter((key) => passable.has(key)));
    }
    const cityKeys = map.cities.map((city) => `${city.q},${city.r}`);
    const seen = new Set([cityKeys[0]]);
    const queue = [cityKeys[0]];
    while (queue.length > 0) {
      const current = queue.shift()!;
      for (const next of adjacent.get(current) ?? []) {
        if (seen.has(next)) continue;
        seen.add(next);
        queue.push(next);
      }
    }
    for (const cityKey of cityKeys) expect(seen.has(cityKey)).toBe(true);
  });

  it('shapes china geography with seas, rivers, passes and ferry crossings', () => {
    const counts = map.grid.reduce((tally, cell) => {
      tally[cell.terrain] = (tally[cell.terrain] ?? 0) + 1;
      return tally;
    }, {} as Record<string, number>);
    expect(counts.water ?? 0).toBeGreaterThan(1500);
    expect(counts.mountain ?? 0).toBeGreaterThan(1500);
    expect(counts.ferry ?? 0).toBeGreaterThan(8);
    expect(cellAt(190, 100)?.terrain).toBe('water');
    expect(cellAt(10, 10)?.terrain).not.toBe('water');
  });
});
