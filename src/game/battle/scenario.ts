import type { CityId, GridCell, TerrainType } from '../types';

export const GRID_WIDTH = 36;
export const GRID_HEIGHT = 22;

export const CITY_GRID_CENTERS: Record<CityId, { q: number; r: number }> = {
  wan: { q: 9, r: 4 },
  xiangyang: { q: 12, r: 10 },
  jiangling: { q: 17, r: 12 },
  wuling: { q: 7, r: 16 },
  jiangxia: { q: 27, r: 5 },
  changsha: { q: 28, r: 10 },
  lingling: { q: 20, r: 18 },
  guiyang: { q: 30, r: 16 },
};

function terrainAt(q: number, r: number): TerrainType {
  const riverBand = (q >= 13 && q <= 15 && r >= 2 && r <= 16) || (q >= 16 && q <= 33 && r >= 13 && r <= 14);
  if (riverBand) return 'deepWater';
  if ((q >= 1 && q <= 5 && r >= 1 && r <= 6) || (q >= 22 && q <= 25 && r >= 2 && r <= 8)) return 'mountain';
  if ((q >= 4 && q <= 11 && r >= 13 && r <= 20) || (q >= 24 && q <= 33 && r >= 15 && r <= 20)) return 'forest';
  if ((q >= 17 && q <= 22 && r >= 4 && r <= 9) || (q >= 8 && q <= 13 && r >= 6 && r <= 9)) return 'hill';
  if (r === 10 || q === 18 || (q >= 6 && q <= 31 && r === 12)) return 'road';
  return 'plain';
}

export function createBattleGrid(): GridCell[] {
  const cells: GridCell[] = [];
  for (let r = 0; r < GRID_HEIGHT; r += 1) {
    for (let q = 0; q < GRID_WIDTH; q += 1) {
      cells.push({ q, r, terrain: terrainAt(q, r) });
    }
  }
  return cells;
}
