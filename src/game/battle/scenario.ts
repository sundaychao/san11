import type { CityId, GridCell, TerrainType } from '../types';
import { neighborsOf } from './grid';

export const GRID_WIDTH = 70;
export const GRID_HEIGHT = 40;

export const CITY_GRID_CENTERS: Record<CityId, { q: number; r: number }> = {
  wan: { q: 18, r: 7 },
  xiangyang: { q: 24, r: 19 },
  jiangling: { q: 34, r: 22 },
  wuling: { q: 14, r: 30 },
  jiangxia: { q: 53, r: 9 },
  changsha: { q: 55, r: 19 },
  lingling: { q: 39, r: 33 },
  guiyang: { q: 59, r: 30 },
};

function terrainAt(q: number, r: number): TerrainType {
  const riverBand = (q >= 28 && q <= 31 && r >= 4 && r <= 30) || (q >= 32 && q <= 66 && r >= 25 && r <= 26);
  const shallowRiverBand = (q >= 27 && q <= 32 && r >= 4 && r <= 30) || (q >= 32 && q <= 66 && r >= 24 && r <= 27);
  if (riverBand || shallowRiverBand) return 'water';
  if ((q >= 2 && q <= 10 && r >= 1 && r <= 11) || (q >= 43 && q <= 50 && r >= 3 && r <= 15)) return 'mountain';
  if ((q >= 8 && q <= 22 && r >= 24 && r <= 37) || (q >= 48 && q <= 66 && r >= 28 && r <= 37)) return 'forest';
  if ((q >= 33 && q <= 44 && r >= 7 && r <= 16) || (q >= 16 && q <= 26 && r >= 11 && r <= 18)) return 'hill';
  if (r === 19 || q === 35 || (q >= 12 && q <= 62 && r === 22) || (q >= 8 && q <= 58 && r === 30)) return 'road';
  return 'plain';
}

export function createBattleGrid(): GridCell[] {
  const cells: GridCell[] = [];
  for (let r = 0; r < GRID_HEIGHT; r += 1) {
    for (let q = 0; q < GRID_WIDTH; q += 1) {
      cells.push({ q, r, terrain: terrainAt(q, r) });
    }
  }
  const waterKeys = new Set(cells.filter((cell) => cell.terrain === 'water').map((cell) => `${cell.q},${cell.r}`));
  for (const cell of cells) {
    if (cell.terrain === 'water' || cell.terrain === 'mountain') continue;
    const touchesWater = neighborsOf(cell.q, cell.r).some((coord) => waterKeys.has(`${coord.q},${coord.r}`));
    if (touchesWater) cell.terrain = 'water';
  }
  return cells;
}
