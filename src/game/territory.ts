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
