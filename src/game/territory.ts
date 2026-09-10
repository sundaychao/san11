import type { City, ForceId, GameState } from './types';

/** 仅需坐标即可判定领土归属（兼容 GridCell/ArmyUnit/Facility 等） */
type TerritoryCell = { q: number; r: number };

function gridDistance(a: { q: number; r: number }, b: { q: number; r: number }) {
  return Math.abs(a.q - b.q) + Math.abs(a.r - b.r);
}

export function territoryCityAt(state: GameState, cell: TerritoryCell): City {
  return Object.values(state.cities)
    .sort((a: City, b: City) => (
      gridDistance(cell, { q: a.gridQ, r: a.gridR }) - gridDistance(cell, { q: b.gridQ, r: b.gridR }) ||
      a.gridQ - b.gridQ ||
      a.gridR - b.gridR ||
      a.id.localeCompare(b.id)
    ))[0];
}

export function territoryForceAt(state: GameState, cell: TerritoryCell): ForceId | null {
  return territoryCityAt(state, cell).ownerId;
}

/**
 * 君主所在城池：优先取该势力君主当前驻扎的城池；
 * 君主出征/被俘/已故等不在城中时，退回本方首座城池（与开局选中城池的口径一致）。
 */
export function rulerCityOf(state: GameState, forceId: ForceId): City | undefined {
  const rulerId = state.forces[forceId]?.leaderId;
  const ruler = rulerId ? state.officers[rulerId] : undefined;
  if (ruler && ruler.location.kind === 'city') {
    const city = state.cities[ruler.location.cityId];
    if (city) return city;
  }
  return Object.values(state.cities).find((city) => city.ownerId === forceId);
}
