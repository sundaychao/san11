import { describe, expect, it } from 'vitest';
import { gridKey, isSameCoord, neighborsOf, sevenCellCityFootprint } from './grid';

describe('staggered battle grid', () => {
  it('returns six symmetric neighbors for an even column shifted upward', () => {
    expect(neighborsOf(2, 5)).toEqual([
      { q: 2, r: 4 },
      { q: 2, r: 6 },
      { q: 1, r: 4 },
      { q: 1, r: 5 },
      { q: 3, r: 4 },
      { q: 3, r: 5 },
    ]);
  });

  it('returns six symmetric neighbors for an odd column', () => {
    expect(neighborsOf(3, 5)).toEqual([
      { q: 3, r: 4 },
      { q: 3, r: 6 },
      { q: 2, r: 5 },
      { q: 2, r: 6 },
      { q: 4, r: 5 },
      { q: 4, r: 6 },
    ]);
  });

  it('keeps every neighbor relationship bidirectional', () => {
    const center = { q: 6, r: 8 };
    for (const neighbor of neighborsOf(center.q, center.r)) {
      expect(neighborsOf(neighbor.q, neighbor.r)).toContainEqual(center);
    }
  });

  it('builds a seven-cell city footprint from the center and six neighbors', () => {
    expect(sevenCellCityFootprint({ q: 4, r: 7 })).toEqual([
      { q: 4, r: 7 },
      { q: 4, r: 6 },
      { q: 4, r: 8 },
      { q: 3, r: 6 },
      { q: 3, r: 7 },
      { q: 5, r: 6 },
      { q: 5, r: 7 },
    ]);
  });

  it('creates stable coordinate keys and exact coordinate equality', () => {
    expect(gridKey({ q: 12, r: 3 })).toBe('12,3');
    expect(isSameCoord({ q: 1, r: 2 }, { q: 1, r: 2 })).toBe(true);
    expect(isSameCoord({ q: 1, r: 2 }, { q: 2, r: 1 })).toBe(false);
  });
});
