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
  road: '#e6c84e',
  path: '#d2b478',
  plank: '#a06e3c',
  plain: '#c4aa6c',
  grass: '#70b256',
  sand: '#e0ca8a',
  wasteland: '#b2a87a',
  wetland: '#6c9e8e',
  poison: '#9448ac',
  forest: '#2f5f3a',
  hill: '#696851',
  mountain: '#303837',
  shore: '#94845c',
  water: '#1e4c60',
  stream: '#6caad2',
  river: '#2e6cb6',
  sea: '#123a7a',
  shallow: '#60bac4',
  ferry: '#a07440',
  pass: '#96764a',
  construction: '#8a7a50',
};

const TERRAIN_CONTROL_COLORS: Record<TerrainType, string> = {
  road: '#f0d45e',
  path: '#dcc28a',
  plank: '#b47e48',
  plain: '#d4ba7c',
  grass: '#82c266',
  sand: '#ecd898',
  wasteland: '#c4ba8a',
  wetland: '#7cae9e',
  poison: '#a65abe',
  forest: '#3a7048',
  hill: '#7b744f',
  mountain: '#2d3332',
  shore: '#a49468',
  water: '#1f546e',
  stream: '#7cbae0',
  river: '#3e7cc6',
  sea: '#1a4a8a',
  shallow: '#70c8d2',
  ferry: '#b0874c',
  pass: '#a68a54',
  construction: '#a08c5a',
};

const CELL_SIZE = 24;

const TERRAIN_MASK_LAYERS: Array<{ layer: TerrainMaskLayer; filename: string; terrains?: TerrainType[] }> = [
  { layer: 'water', filename: 'mask-water.svg', terrains: ['water', 'stream', 'river', 'sea'] },
  { layer: 'mountain', filename: 'mask-mountain.svg', terrains: ['mountain'] },
  { layer: 'forest', filename: 'mask-forest.svg', terrains: ['forest'] },
  { layer: 'road', filename: 'mask-road.svg', terrains: ['road', 'path', 'plank'] },
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

const TERRAIN_VALUES: readonly TerrainType[] = [
  'road', 'path', 'plank', 'plain', 'grass', 'sand', 'wasteland', 'wetland', 'poison',
  'forest', 'hill', 'mountain', 'shore', 'water', 'stream', 'river', 'sea', 'shallow',
  'ferry', 'pass', 'construction',
];

function isTerrain(value: unknown): value is TerrainType {
  return typeof value === 'string' && (TERRAIN_VALUES as readonly string[]).includes(value);
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

function exportTerrainMaskSvg(state: MapEditorState, layer: TerrainMaskLayer, terrains?: TerrainType[]): string {
  const width = state.width * CELL_SIZE;
  const height = state.height * CELL_SIZE;
  const cells = terrains
    ? state.grid
      .filter((cell) => terrains.includes(cell.terrain))
      .map((cell) => {
        const position = cellPosition(cell.q, cell.r);
        return `<rect data-q="${cell.q}" data-r="${cell.r}" data-source-terrain="${cell.terrain}" x="${position.x}" y="${position.y}" width="${CELL_SIZE}" height="${CELL_SIZE}" fill="#fff" />`;
      })
    : state.cities.flatMap((city) => sevenCellCityFootprint(city).map((coord) => {
      const position = cellPosition(coord.q, coord.r);
      return `<rect data-control-city="${city.id}:${coord.q},${coord.r}" x="${position.x}" y="${position.y}" width="${CELL_SIZE}" height="${CELL_SIZE}" fill="#fff" />`;
    }));

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" data-export="terrain-mask" data-mask-layer="${layer}" data-grid-width="${state.width}" data-grid-height="${state.height}" data-cell-size="${CELL_SIZE}" data-cell-shape="staggered-square-even-columns-up-half"><rect x="0" y="0" width="${width}" height="${height}" fill="#000" />${cells.join('')}</svg>`;
}

export function exportTerrainMaskSvgs(state: MapEditorState): Record<TerrainMaskLayer, TerrainMaskExport> {
  return TERRAIN_MASK_LAYERS.reduce((exports, { filename, layer, terrains }) => ({
    ...exports,
    [layer]: {
      filename,
      content: exportTerrainMaskSvg(state, layer, terrains),
    },
  }), {} as Record<TerrainMaskLayer, TerrainMaskExport>);
}
