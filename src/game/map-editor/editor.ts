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
  backgroundImage: string;
  grid: GridCell[];
  cities: EditableCityMarker[];
  width: number;
  height: number;
}

export interface MapEditorState {
  backgroundImage: string;
  grid: GridCell[];
  cities: EditableCityMarker[];
  width: number;
  height: number;
  history: EditorSnapshot[];
  future: EditorSnapshot[];
}

export type MapEditorTool = TerrainType | 'city';

export type TerrainMaskLayer = 'water' | 'mountain' | 'forest' | 'road' | 'city';

export interface TerrainMaskExport {
  filename: string;
  content: string;
}

interface EditorJsonPayload {
  schemaVersion: 1;
  width: number;
  height: number;
  backgroundImage: string;
  grid: GridCell[];
  cities: EditableCityMarker[];
}

export const MAX_EDITOR_GRID_SIZE = 512;

const TERRAIN_COLORS: Record<TerrainType, string> = {
  plain: '#69775f',
  road: '#a58d57',
  forest: '#2f5f3a',
  hill: '#696851',
  mountain: '#303837',
  water: '#1e4c60',
  ferry: '#a07440',
};

const TERRAIN_CONTROL_COLORS: Record<TerrainType, string> = {
  plain: '#6f7f62',
  road: '#c3a663',
  forest: '#245a34',
  hill: '#7b744f',
  mountain: '#2d3332',
  water: '#1f546e',
  ferry: '#b0874c',
};

const CELL_SIZE = 24;

const TERRAIN_MASK_LAYERS: Array<{ layer: TerrainMaskLayer; filename: string; terrain?: TerrainType }> = [
  { layer: 'water', filename: 'mask-water.svg', terrain: 'water' },
  { layer: 'mountain', filename: 'mask-mountain.svg', terrain: 'mountain' },
  { layer: 'forest', filename: 'mask-forest.svg', terrain: 'forest' },
  { layer: 'road', filename: 'mask-road.svg', terrain: 'road' },
  { layer: 'city', filename: 'mask-city.svg' },
];

function cloneGrid(grid: GridCell[]) {
  return grid.map((cell) => ({ ...cell }));
}

function cloneCities(cities: EditableCityMarker[]) {
  return cities.map((city) => ({ ...city }));
}

function snapshot(state: Pick<MapEditorState, 'backgroundImage' | 'grid' | 'cities' | 'width' | 'height'>): EditorSnapshot {
  return {
    backgroundImage: state.backgroundImage,
    grid: cloneGrid(state.grid),
    cities: cloneCities(state.cities),
    width: state.width,
    height: state.height,
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

function isTerrain(value: unknown): value is TerrainType {
  return value === 'road' || value === 'plain' || value === 'forest' || value === 'hill' || value === 'mountain' || value === 'water' || value === 'ferry';
}

function isGridCell(value: unknown, width: number, height: number): value is GridCell {
  if (!value || typeof value !== 'object') return false;
  const cell = value as Partial<GridCell>;
  return Number.isInteger(cell.q) &&
    cell.q! >= 0 &&
    cell.q! < width &&
    Number.isInteger(cell.r) &&
    cell.r! >= 0 &&
    cell.r! < height &&
    isTerrain(cell.terrain);
}

function isEditableCityMarker(value: unknown, width: number, height: number): value is EditableCityMarker {
  if (!value || typeof value !== 'object') return false;
  const city = value as Partial<EditableCityMarker>;
  return typeof city.id === 'string' &&
    city.id.length > 0 &&
    typeof city.label === 'string' &&
    Number.isInteger(city.q) &&
    Number.isInteger(city.r) &&
    city.q! >= 0 &&
    city.q! < width &&
    city.r! >= 0 &&
    city.r! < height;
}

function parseEditorJsonPayload(json: string): EditorJsonPayload {
  let payload: unknown;
  try {
    payload = JSON.parse(json);
  } catch {
    throw new Error('地图 JSON 无效');
  }

  if (!payload || typeof payload !== 'object') throw new Error('地图 JSON 无效');
  const value = payload as Partial<EditorJsonPayload>;
  if (
    !Number.isInteger(value.width) || value.width! < 1 || value.width! > MAX_EDITOR_GRID_SIZE ||
    !Number.isInteger(value.height) || value.height! < 1 || value.height! > MAX_EDITOR_GRID_SIZE
  ) throw new Error('地图 JSON 无效');
  const width: number = value.width!;
  const height: number = value.height!;
  const expectedCellCount = width * height;
  const seen = new Set<string>();
  if (
    value.schemaVersion !== 1 ||
    typeof value.backgroundImage !== 'string' ||
    !Array.isArray(value.grid) ||
    value.grid.length !== expectedCellCount ||
    !Array.isArray(value.cities) ||
    !value.grid.every((cell) => {
      if (!isGridCell(cell, width, height)) return false;
      const key = `${cell.q},${cell.r}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }) ||
    seen.size !== expectedCellCount ||
    !value.cities.every((city) => isEditableCityMarker(city, width, height))
  ) {
    throw new Error('地图 JSON 无效');
  }

  return {
    schemaVersion: 1,
    width,
    height,
    backgroundImage: value.backgroundImage,
    grid: cloneGrid(value.grid),
    cities: cloneCities(value.cities),
  };
}

export function createEditorState(grid: GridCell[], cities: EditableCityMarker[] = [], width: number = GRID_WIDTH, height: number = GRID_HEIGHT): MapEditorState {
  return {
    backgroundImage: '',
    grid: cloneGrid(grid),
    cities: cloneCities(cities),
    width,
    height,
    history: [],
    future: [],
  };
}

export function paintTerrain(state: MapEditorState, coord: { q: number; r: number }, terrain: TerrainType): MapEditorState {
  const target = state.grid.find((cell) => cell.q === coord.q && cell.r === coord.r);
  if (!target || target.terrain === terrain) return state;

  return withHistory(state, {
    backgroundImage: state.backgroundImage,
    width: state.width,
    height: state.height,
    grid: state.grid.map((cell) => (cell.q === coord.q && cell.r === coord.r ? { ...cell, terrain } : { ...cell })),
    cities: cloneCities(state.cities),
  });
}

export function placeCity(state: MapEditorState, city: EditableCityMarker): MapEditorState {
  return withHistory(state, {
    backgroundImage: state.backgroundImage,
    width: state.width,
    height: state.height,
    grid: cloneGrid(state.grid),
    cities: [...state.cities.filter((candidate) => candidate.id !== city.id).map((candidate) => ({ ...candidate })), { ...city }],
  });
}

export function undoEditor(state: MapEditorState): MapEditorState {
  const previous = state.history.at(-1);
  if (!previous) return state;

  return {
    backgroundImage: previous.backgroundImage,
    grid: cloneGrid(previous.grid),
    cities: cloneCities(previous.cities),
    width: previous.width,
    height: previous.height,
    history: state.history.slice(0, -1).map(snapshot),
    future: [snapshot(state), ...state.future.map(snapshot)],
  };
}

export function redoEditor(state: MapEditorState): MapEditorState {
  const next = state.future[0];
  if (!next) return state;

  return {
    backgroundImage: next.backgroundImage,
    grid: cloneGrid(next.grid),
    cities: cloneCities(next.cities),
    width: next.width,
    height: next.height,
    history: [...state.history.map(snapshot), snapshot(state)],
    future: state.future.slice(1).map(snapshot),
  };
}

export function clearEditor(state: MapEditorState, terrain: TerrainType = 'plain'): MapEditorState {
  return withHistory(state, {
    backgroundImage: state.backgroundImage,
    width: state.width,
    height: state.height,
    grid: state.grid.map((cell) => ({ ...cell, terrain })),
    cities: [],
  });
}

export function setEditorBackgroundImage(state: MapEditorState, backgroundImage: string): MapEditorState {
  if (state.backgroundImage === backgroundImage) return state;

  return withHistory(state, {
    backgroundImage,
    width: state.width,
    height: state.height,
    grid: cloneGrid(state.grid),
    cities: cloneCities(state.cities),
  });
}

export function exportEditorJson(state: MapEditorState): string {
  return JSON.stringify(
    {
      schemaVersion: 1,
      width: state.width,
      height: state.height,
      backgroundImage: state.backgroundImage,
      grid: state.grid,
      cities: state.cities,
    },
    null,
    2,
  );
}

export function importEditorJson(state: MapEditorState, json: string): MapEditorState {
  const payload = parseEditorJsonPayload(json);
  return withHistory(state, {
    backgroundImage: payload.backgroundImage,
    grid: payload.grid,
    cities: payload.cities,
    width: payload.width,
    height: payload.height,
  });
}

export function exportEditorSvg(state: MapEditorState): string {
  const width = state.width * CELL_SIZE;
  const height = state.height * CELL_SIZE;
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

export function exportTerrainControlSvg(state: MapEditorState): string {
  const width = state.width * CELL_SIZE;
  const height = state.height * CELL_SIZE;
  const cells = state.grid.map((cell) => {
    const position = cellPosition(cell.q, cell.r);
    return `<rect data-q="${cell.q}" data-r="${cell.r}" data-terrain="${cell.terrain}" x="${position.x}" y="${position.y}" width="${CELL_SIZE}" height="${CELL_SIZE}" fill="${TERRAIN_CONTROL_COLORS[cell.terrain]}" stroke="rgba(255,255,255,0.5)" />`;
  });
  const cities = state.cities.flatMap((city) => sevenCellCityFootprint(city).map((coord) => {
    const position = cellPosition(coord.q, coord.r);
    return `<rect data-control-city="${city.id}:${coord.q},${coord.r}" x="${position.x + 1}" y="${position.y + 1}" width="${CELL_SIZE - 2}" height="${CELL_SIZE - 2}" fill="rgba(214,180,92,0.58)" stroke="#f2d778" />`;
  }));
  const metadata = [
    '<desc>Terrain control map. Cell position formula: x=q*24; y=r*24; even columns move up by 12px.</desc>',
    ...cells,
    ...cities,
  ];

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" data-export="terrain-control" data-grid-width="${state.width}" data-grid-height="${state.height}" data-cell-size="${CELL_SIZE}" data-cell-shape="staggered-square-even-columns-up-half">${metadata.join('')}</svg>`;
}

function exportTerrainMaskSvg(state: MapEditorState, layer: TerrainMaskLayer, terrain?: TerrainType): string {
  const width = state.width * CELL_SIZE;
  const height = state.height * CELL_SIZE;
  const cells = terrain
    ? state.grid
      .filter((cell) => cell.terrain === terrain)
      .map((cell) => {
        const position = cellPosition(cell.q, cell.r);
        return `<rect data-q="${cell.q}" data-r="${cell.r}" data-source-terrain="${terrain}" x="${position.x}" y="${position.y}" width="${CELL_SIZE}" height="${CELL_SIZE}" fill="#fff" />`;
      })
    : state.cities.flatMap((city) => sevenCellCityFootprint(city).map((coord) => {
      const position = cellPosition(coord.q, coord.r);
      return `<rect data-control-city="${city.id}:${coord.q},${coord.r}" x="${position.x}" y="${position.y}" width="${CELL_SIZE}" height="${CELL_SIZE}" fill="#fff" />`;
    }));

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" data-export="terrain-mask" data-mask-layer="${layer}" data-grid-width="${state.width}" data-grid-height="${state.height}" data-cell-size="${CELL_SIZE}" data-cell-shape="staggered-square-even-columns-up-half"><rect x="0" y="0" width="${width}" height="${height}" fill="#000" />${cells.join('')}</svg>`;
}

export function exportTerrainMaskSvgs(state: MapEditorState): Record<TerrainMaskLayer, TerrainMaskExport> {
  return TERRAIN_MASK_LAYERS.reduce((exports, { filename, layer, terrain }) => ({
    ...exports,
    [layer]: {
      filename,
      content: exportTerrainMaskSvg(state, layer, terrain),
    },
  }), {} as Record<TerrainMaskLayer, TerrainMaskExport>);
}
