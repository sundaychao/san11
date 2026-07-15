import { sevenCellCityFootprint } from '../battle/grid';
import { GRID_HEIGHT, GRID_WIDTH } from '../battle/scenario';
import type { GridCell, TerrainType } from '../types';

export interface EditableCityMarker {
  id: string;
  label: string;
  q: number;
  r: number;
}

interface EditorSnapshot {
  grid: GridCell[];
  cities: EditableCityMarker[];
}

export interface MapEditorState {
  grid: GridCell[];
  cities: EditableCityMarker[];
  history: EditorSnapshot[];
  future: EditorSnapshot[];
}

export type MapEditorTool = TerrainType | 'city';

const TERRAIN_COLORS: Record<TerrainType, string> = {
  plain: '#69775f',
  road: '#a58d57',
  forest: '#2f5f3a',
  hill: '#696851',
  mountain: '#303837',
  deepWater: '#2c6570',
};

const CELL_SIZE = 24;

function cloneGrid(grid: GridCell[]) {
  return grid.map((cell) => ({ ...cell }));
}

function cloneCities(cities: EditableCityMarker[]) {
  return cities.map((city) => ({ ...city }));
}

function snapshot(state: Pick<MapEditorState, 'grid' | 'cities'>): EditorSnapshot {
  return {
    grid: cloneGrid(state.grid),
    cities: cloneCities(state.cities),
  };
}

function withHistory(state: MapEditorState, next: EditorSnapshot): MapEditorState {
  return {
    ...next,
    history: [...state.history, snapshot(state)],
    future: [],
  };
}

function cellPosition(q: number, r: number) {
  return {
    x: q * CELL_SIZE,
    y: r * CELL_SIZE + (q % 2 === 0 ? -CELL_SIZE / 2 : 0),
  };
}

export function createEditorState(grid: GridCell[], cities: EditableCityMarker[] = []): MapEditorState {
  return {
    grid: cloneGrid(grid),
    cities: cloneCities(cities),
    history: [],
    future: [],
  };
}

export function paintTerrain(state: MapEditorState, coord: { q: number; r: number }, terrain: TerrainType): MapEditorState {
  const target = state.grid.find((cell) => cell.q === coord.q && cell.r === coord.r);
  if (!target || target.terrain === terrain) return state;

  return withHistory(state, {
    grid: state.grid.map((cell) => (cell.q === coord.q && cell.r === coord.r ? { ...cell, terrain } : { ...cell })),
    cities: cloneCities(state.cities),
  });
}

export function placeCity(state: MapEditorState, city: EditableCityMarker): MapEditorState {
  return withHistory(state, {
    grid: cloneGrid(state.grid),
    cities: [...state.cities.filter((candidate) => candidate.id !== city.id).map((candidate) => ({ ...candidate })), { ...city }],
  });
}

export function undoEditor(state: MapEditorState): MapEditorState {
  const previous = state.history.at(-1);
  if (!previous) return state;

  return {
    grid: cloneGrid(previous.grid),
    cities: cloneCities(previous.cities),
    history: state.history.slice(0, -1).map(snapshot),
    future: [snapshot(state), ...state.future.map(snapshot)],
  };
}

export function redoEditor(state: MapEditorState): MapEditorState {
  const next = state.future[0];
  if (!next) return state;

  return {
    grid: cloneGrid(next.grid),
    cities: cloneCities(next.cities),
    history: [...state.history.map(snapshot), snapshot(state)],
    future: state.future.slice(1).map(snapshot),
  };
}

export function clearEditor(state: MapEditorState, terrain: TerrainType = 'plain'): MapEditorState {
  return withHistory(state, {
    grid: state.grid.map((cell) => ({ ...cell, terrain })),
    cities: [],
  });
}

export function exportEditorJson(state: MapEditorState): string {
  return JSON.stringify(
    {
      schemaVersion: 1,
      width: GRID_WIDTH,
      height: GRID_HEIGHT,
      grid: state.grid,
      cities: state.cities,
    },
    null,
    2,
  );
}

export function exportEditorSvg(state: MapEditorState): string {
  const width = GRID_WIDTH * CELL_SIZE;
  const height = GRID_HEIGHT * CELL_SIZE;
  const cells = state.grid.map((cell) => {
    const position = cellPosition(cell.q, cell.r);
    return `<rect x="${position.x}" y="${position.y}" width="${CELL_SIZE}" height="${CELL_SIZE}" fill="${TERRAIN_COLORS[cell.terrain]}" stroke="rgba(236,231,211,0.38)" data-q="${cell.q}" data-r="${cell.r}" data-terrain="${cell.terrain}" />`;
  });
  const cities = state.cities.flatMap((city) => {
    const footprint = sevenCellCityFootprint(city);
    const cityCells = footprint.map((coord) => {
      const position = cellPosition(coord.q, coord.r);
      return `<rect x="${position.x + 1}" y="${position.y + 1}" width="${CELL_SIZE - 2}" height="${CELL_SIZE - 2}" fill="rgba(197,173,111,0.36)" stroke="#f2d778" data-city-cell="${city.id}:${coord.q},${coord.r}" />`;
    });
    const center = cellPosition(city.q, city.r);
    return [
      ...cityCells,
      `<text x="${center.x + CELL_SIZE / 2}" y="${center.y + CELL_SIZE / 2 + 4}" text-anchor="middle" fill="#fff4cd" font-size="10" data-city-id="${city.id}">${city.label}</text>`,
    ];
  });

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">${[...cells, ...cities].join('')}</svg>`;
}
