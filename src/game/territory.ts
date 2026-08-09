import type { City, ForceId, GameState, GridCell } from './types';

function gridDistance(a: { q: number; r: number }, b: { q: number; r: number }) {
  return Math.abs(a.q - b.q) + Math.abs(a.r - b.r);
}

export function territoryCityAt(state: GameState, cell: GridCell): City {
  return Object.values(state.cities)
    .sort((a: City, b: City) => (
      gridDistance(cell, { q: a.gridQ, r: a.gridR }) - gridDistance(cell, { q: b.gridQ, r: b.gridR }) ||
      a.gridQ - b.gridQ ||
      a.gridR - b.gridR ||
      a.id.localeCompare(b.id)
    ))[0];
}

export function territoryForceAt(state: GameState, cell: GridCell): ForceId {
  return territoryCityAt(state, cell).ownerId;
}
