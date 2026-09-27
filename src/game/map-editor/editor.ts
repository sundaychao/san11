import { FORCE_IDS } from '../scenario/jingxiang208';
import { sevenCellCityFootprint } from '../battle/grid';
import { BLOCKED_TERRAINS, FACILITIES, isWaterTerrain, type UnitFacility } from '../battle/catalog';
import { GRID_HEIGHT, GRID_WIDTH } from '../battle/scenario';
import { PLOT_COUNT_BY_SIZE, autoSearchCityPlots } from '../innerAffairs';
import type { FacilityType, ForceId, GridCell, TerrainType } from '../types';

export interface EditableCityMarker {
  id: string;
  label: string;
  q: number;
  r: number;
}

/** 城池/关隘统一标记（schema v2）：type 区分城池与关隘，forceId 缺省/null 表示无主（空城/空关隘） */
export interface EditorStrongholdMarker extends EditableCityMarker {
  type?: 'city' | 'pass';
  forceId?: ForceId | null;
}

/** 建设用地格子：手动圈定归属某座城（一格一主，坐标不得重复） */
export interface EditorCityPlot {
  cityId: string;
  q: number;
  r: number;
}

/** 军事设施标记（schema v2 可选字段）：归属势力随所选城池，进游戏即为已建成的成品设施 */
export interface EditorFacilityMarker {
  type: FacilityType;
  forceId: ForceId | null;
  /** 归属城（编辑器展示用；进游戏时设施只认势力，不绑城） */
  cityId?: string;
  q: number;
  r: number;
}

/**
 * 编辑器设施菜单的可选项：**catalog 里的全部野外设施**（名称取自 `FACILITIES`，单一出处）。
 *
 * 与游戏内建造菜单不同，这里不按 `UPGRADED_FACILITY_TYPES` 只列「当前档」：编辑器摆的是
 * 已建成的成品设施（进游戏即成品，见 `facilitiesFromEditorMarkers`），地图上本来就没有科技档位可言。
 * 按当前档过滤会让 砦 / 城塞 / 石墙 / 连弩楼 / 业火种 / 业火球 这些高档设施在编辑器里根本摆不出来，
 * 而开局与存档校验其实都接受它们。catalog 新增设施时会自动出现在菜单里，无需再同步第二份表。
 */
export const EDITOR_FACILITY_CHOICES: Array<{ type: FacilityType; label: string }> = Object.values(FACILITIES)
  .filter((definition): definition is UnitFacility => Boolean(definition))
  .map((definition) => ({ type: definition.type, label: definition.name }));

function isPlaceableFacilityTerrain(grid: GridCell[], q: number, r: number): boolean {
  const cell = grid.find((candidate) => candidate.q === q && candidate.r === r);
  if (!cell) return false;
  return !BLOCKED_TERRAINS.has(cell.terrain) && !isWaterTerrain(cell.terrain);
}

/** 可持久化的地图载荷（schema v2） */
export interface EditorMapPayload {
  schemaVersion: 2;
  width: number;
  height: number;
  backgroundImage: string;
  grid: GridCell[];
  cities: EditorStrongholdMarker[];
  /** 手动指定的建设用地归属（缺省=全部交给进游戏时的自动回退） */
  plots?: EditorCityPlot[];
  /**
   * `true`＝本图的建设用地由编辑器（人）说了算，**含刻意留空的城**：
   * 单机/联网开局原样照搬图上 `plots`，对没有圈地的城不再自动搜索补齐。
   * 编辑器每次保存都会写入 `true`；早先保存的自定义图与第三方导入图没有该字段，
   * 开局仍按 `initConstructionPlots` 的自动搜索补齐（老图不会突然变成没有建设用地）。
   */
  plotsSpecified?: boolean;
  /** 编辑器摆放的军事设施（缺省=图上没有设施） */
  facilities?: EditorFacilityMarker[];
  name?: string;
}

interface EditorSnapshot {
  backgroundImage: string;
  grid: GridCell[];
  cities: EditorStrongholdMarker[];
  plots: EditorCityPlot[];
  facilities: EditorFacilityMarker[];
  width: number;
  height: number;
}

export interface MapEditorState {
  backgroundImage: string;
  grid: GridCell[];
  cities: EditorStrongholdMarker[];
  plots: EditorCityPlot[];
  facilities: EditorFacilityMarker[];
  width: number;
  height: number;
  history: EditorSnapshot[];
  future: EditorSnapshot[];
}

export type MapEditorTool = TerrainType | 'city' | 'pass' | 'erase' | 'plot' | 'facility';

export type TerrainMaskLayer = 'water' | 'mountain' | 'forest' | 'road' | 'city';

export interface TerrainMaskExport {
  filename: string;
  content: string;
}

interface EditorJsonPayloadV1 {
  schemaVersion: 1;
  width: number;
  height: number;
  backgroundImage: string;
  grid: GridCell[];
  cities: EditableCityMarker[];
  /** v1 预留：可能带独立的关隘标记（无 type，视为 pass） */
  passes?: EditableCityMarker[];
}

export const MAX_EDITOR_GRID_SIZE = 512;

const TERRAIN_COLORS: Record<TerrainType, string> = {
  road: '#e6c84e',
  path: '#d2b478',
  plank: '#a06e3c',
  plain: '#aeaeae',
  grass: '#92cc74',
  sand: '#f2e4b0',
  wasteland: '#8c8058',
  wetland: '#aad4e4',
  poison: '#9448ac',
  forest: '#0e421e',
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

/** 地形控制图（导出给图像生成用的底图）配色；比 TERRAIN_COLORS 更亮一档便于辨识 */
export const TERRAIN_CONTROL_COLORS: Record<TerrainType, string> = {
  road: '#f0d45e',
  path: '#dcc28a',
  plank: '#b47e48',
  plain: '#bababa',
  grass: '#a4da86',
  sand: '#f8ecc2',
  wasteland: '#a09468',
  wetland: '#bce0ee',
  poison: '#a65abe',
  forest: '#1a5228',
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

function clonePlots(plots: EditorCityPlot[]) {
  return plots.map((plot) => ({ ...plot }));
}

function cloneFacilities(facilities: EditorFacilityMarker[]) {
  return facilities.map((facility) => ({ ...facility }));
}

function snapshot(state: Pick<MapEditorState, 'backgroundImage' | 'grid' | 'cities' | 'plots' | 'facilities' | 'width' | 'height'>): EditorSnapshot {
  return {
    backgroundImage: state.backgroundImage,
    grid: cloneGrid(state.grid),
    cities: cloneCities(state.cities),
    plots: clonePlots(state.plots),
    facilities: cloneFacilities(state.facilities),
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

/**
 * 栅格修整：把来源不可信（旧版本地缓存、热拔插 JSON、手改过的文件）的格子数组修整成
 * `width × height` 一份完整栅格 —— 越界 / 未知地形 / 重复坐标的格子丢弃，缺失的格子补平地。
 * 已经是完整合法栅格时原样克隆：编辑器自己导出的图走这条快路径，格子顺序与内容一个不动。
 */
function repairGrid(raw: unknown, width: number, height: number): GridCell[] {
  const cells: unknown[] = Array.isArray(raw) ? raw : [];
  const seen = new Set<string>();
  const complete = cells.length === width * height && cells.every((cell) => {
    if (!isGridCell(cell, width, height)) return false;
    const key = `${cell.q},${cell.r}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  if (complete) return cloneGrid(cells as GridCell[]);

  const byKey = new Map<string, GridCell>();
  for (const cell of cells) {
    if (!isGridCell(cell, width, height)) continue;
    const key = `${cell.q},${cell.r}`;
    if (!byKey.has(key)) byKey.set(key, { q: cell.q, r: cell.r, terrain: cell.terrain });
  }
  const grid: GridCell[] = [];
  for (let q = 0; q < width; q += 1) {
    for (let r = 0; r < height; r += 1) {
      grid.push(byKey.get(`${q},${r}`) ?? { q, r, terrain: 'plain' });
    }
  }
  return grid;
}

/**
 * 据点标记修整：id / 名字 / 坐标非法的项在画布上无法定位，一律丢弃（id 重复只留首个）；
 * `type` 缺省为城池、`forceId` 缺省为无主 —— 与 v1 载荷升级时的补齐口径一致。
 * 旧版载荷把关隘单独放在 `passes` 数组里，这里一并合入。
 */
function repairStrongholds(rawCities: unknown, rawPasses: unknown, width: number, height: number): EditorStrongholdMarker[] {
  const result: EditorStrongholdMarker[] = [];
  const seen = new Set<string>();
  const append = (entry: unknown, forcedType?: 'pass') => {
    if (!isEditableCityMarker(entry, width, height)) return;
    if (seen.has(entry.id)) return;
    seen.add(entry.id);
    const marker = entry as EditorStrongholdMarker;
    result.push({ ...marker, type: forcedType ?? (marker.type === 'pass' ? 'pass' : 'city'), forceId: marker.forceId ?? null });
  };
  if (Array.isArray(rawCities)) for (const entry of rawCities) append(entry);
  if (Array.isArray(rawPasses)) for (const entry of rawPasses) append(entry, 'pass');
  return result;
}

/** 建设用地归属修整（`plots` 可选字段）：只保留坐标合法、且确指向已存在城池（type==='city'）的项；
 *  同一格出现多次时保留首次（一格一主），指向关隘 / 不存在 id 的项静默丢弃。 */
function sanitizePlots(value: unknown, cities: EditorStrongholdMarker[], width: number, height: number): EditorCityPlot[] {
  const cityIds = new Set(cities.filter((city) => city.type === 'city').map((city) => city.id));
  const seenPlotKeys = new Set<string>();
  const plots: EditorCityPlot[] = [];
  if (!Array.isArray(value)) return plots;
  for (const plot of value as Array<Partial<EditorCityPlot>>) {
    if (
      !plot || typeof plot !== 'object' ||
      typeof plot.cityId !== 'string' || !cityIds.has(plot.cityId) ||
      !Number.isInteger(plot.q) || !Number.isInteger(plot.r) ||
      plot.q! < 0 || plot.q! >= width || plot.r! < 0 || plot.r! >= height
    ) continue;
    const key = `${plot.q},${plot.r}`;
    if (seenPlotKeys.has(key)) continue;
    seenPlotKeys.add(key);
    plots.push({ cityId: plot.cityId, q: plot.q!, r: plot.r! });
  }
  return plots;
}

/** 军事设施修整（`facilities` 可选字段）：类型合法、坐标在界、地形可放置、一格一设施；非法项静默丢弃。 */
function sanitizeFacilities(value: unknown, grid: unknown, width: number, height: number): EditorFacilityMarker[] {
  const facilityTypes = new Set(Object.keys(FACILITIES));
  const cells: GridCell[] = Array.isArray(grid) ? (grid as GridCell[]) : [];
  const seenFacilityKeys = new Set<string>();
  const facilities: EditorFacilityMarker[] = [];
  if (!Array.isArray(value)) return facilities;
  for (const facility of value as Array<Partial<EditorFacilityMarker>>) {
    if (
      !facility || typeof facility !== 'object' ||
      typeof facility.type !== 'string' || !facilityTypes.has(facility.type) ||
      (facility.forceId !== null && facility.forceId !== undefined && !FORCE_IDS.includes(facility.forceId)) ||
      !Number.isInteger(facility.q) || !Number.isInteger(facility.r) ||
      facility.q! < 0 || facility.q! >= width || facility.r! < 0 || facility.r! >= height ||
      !isPlaceableFacilityTerrain(cells, facility.q!, facility.r!)
    ) continue;
    const key = `${facility.q},${facility.r}`;
    if (seenFacilityKeys.has(key)) continue;
    seenFacilityKeys.add(key);
    facilities.push({
      type: facility.type as FacilityType,
      forceId: facility.forceId ?? null,
      ...(typeof facility.cityId === 'string' ? { cityId: facility.cityId } : {}),
      q: facility.q!,
      r: facility.r!,
    });
  }
  return facilities;
}

function parseEditorJsonPayload(json: string): EditorMapPayload {
  let payload: unknown;
  try {
    payload = JSON.parse(json);
  } catch {
    throw new Error('地图 JSON 无效');
  }

  if (!payload || typeof payload !== 'object') throw new Error('地图 JSON 无效');

  // 同时校验 v1 与 v2 公共字段
  const value = payload as Partial<EditorMapPayload> & Partial<EditorJsonPayloadV1>;
  if (
    !Number.isInteger(value.width) || value.width! < 1 || value.width! > MAX_EDITOR_GRID_SIZE ||
    !Number.isInteger(value.height) || value.height! < 1 || value.height! > MAX_EDITOR_GRID_SIZE
  ) throw new Error('地图 JSON 无效');
  const width: number = value.width!;
  const height: number = value.height!;
  const expectedCellCount = width * height;
  const seen = new Set<string>();
  if (
    (value.schemaVersion !== 1 && value.schemaVersion !== 2) ||
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

  // v1：补齐 type/forceId 并升级为 v2
  const rawCities = value.cities as Array<EditableCityMarker | EditorStrongholdMarker>;
  const rawPasses = (value.passes ?? []) as EditableCityMarker[];
  const cities: EditorStrongholdMarker[] = [
    ...rawCities.map((city) => {
      const marker = city as EditorStrongholdMarker;
      return { ...marker, type: marker.type ?? 'city', forceId: marker.forceId === undefined ? null : marker.forceId };
    }),
    ...rawPasses.map((pass) => ({ ...pass, type: 'pass' as const, forceId: null as ForceId | null })),
  ];

  // v2 中额外校验 type 合法性（v1 已升级，天然合法）
  if (!cities.every((city) => city.type === 'city' || city.type === 'pass')) {
    throw new Error('地图 JSON 无效');
  }

  const plots = sanitizePlots(value.plots, cities, width, height);

  const facilities = sanitizeFacilities(value.facilities, value.grid, width, height);

  return {
    schemaVersion: 2,
    width,
    height,
    backgroundImage: value.backgroundImage,
    grid: cloneGrid(value.grid),
    cities,
    plots,
    facilities,
    // 「建设用地由编辑器指定」的标记随图保留：导入编辑器再保存时会重新写入
    plotsSpecified: value.plotsSpecified === true,
    name: typeof value.name === 'string' ? value.name : undefined,
  };
}

/**
 * 载荷归一化（地块注册表用）：把来源不可信的 EditorMapPayload（本地缓存、热拔插 JSON、旧版文件）
 * 修整成编辑器与开局都吃的 schema v2 —— **不抛异常**，一律优雅降级：
 * - 缺 `plots` / `facilities` 按空处理；
 * - `cities` 缺 `type` 按城池补、缺 `forceId` 按无主补，旧版单独的 `passes` 数组合并进来；
 * - 栅格缺格补平地、越界 / 未知地形的格子丢弃（`grid: []` 的空白图补成整片平地，仍可编辑）；
 * - `plotsSpecified` 缺省为 `false`（旧图开局仍自动补建设用地，口径不变）。
 *
 * 只有「宽高不是 1~512 的整数 / 根本没有栅格数组」这种连图都算不上的载荷返回 `null`，
 * 调用方据此在**列表页**就把它过滤掉，而不是等玩家点进编辑器再炸白屏。
 */
export function normalizeEditorPayload(raw: unknown): EditorMapPayload | null {
  if (!raw || typeof raw !== 'object') return null;
  const value = raw as Partial<EditorMapPayload> & { passes?: unknown };
  const { width, height } = value;
  if (
    typeof width !== 'number' || typeof height !== 'number' ||
    !Number.isInteger(width) || !Number.isInteger(height) ||
    width < 1 || height < 1 || width > MAX_EDITOR_GRID_SIZE || height > MAX_EDITOR_GRID_SIZE
  ) return null;
  if (!Array.isArray(value.grid)) return null;

  const grid = repairGrid(value.grid, width, height);
  const cities = repairStrongholds(value.cities, value.passes, width, height);
  return {
    schemaVersion: 2,
    width,
    height,
    backgroundImage: typeof value.backgroundImage === 'string' ? value.backgroundImage : '',
    grid,
    cities,
    plots: sanitizePlots(value.plots, cities, width, height),
    facilities: sanitizeFacilities(value.facilities, grid, width, height),
    plotsSpecified: value.plotsSpecified === true,
    ...(typeof value.name === 'string' ? { name: value.name } : {}),
  };
}

/**
 * 由栅格 + 据点标记构造编辑器状态。
 * 入参来自真实载荷，可能缺字段或带脏数据（旧版本地缓存、第三方 JSON）：这里统一走修整，
 * 缺格补平地、非法据点丢弃、`type`/`forceId` 补默认值 —— 编辑器不会因为一张脏图直接白屏。
 */
export function createEditorState(grid: GridCell[], cities: EditorStrongholdMarker[] = [], width: number = GRID_WIDTH, height: number = GRID_HEIGHT, plots: EditorCityPlot[] = [], facilities: EditorFacilityMarker[] = []): MapEditorState {
  return {
    backgroundImage: '',
    grid: repairGrid(grid, width, height),
    cities: repairStrongholds(cities, undefined, width, height),
    plots: Array.isArray(plots) ? clonePlots(plots) : [],
    facilities: Array.isArray(facilities) ? cloneFacilities(facilities) : [],
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
    plots: clonePlots(state.plots),
    facilities: cloneFacilities(state.facilities),
  });
}

/** 放置城池/关隘标记（缺省 type 视为城池） */
export function placeCity(state: MapEditorState, city: EditorStrongholdMarker): MapEditorState {
  const normalized: EditorStrongholdMarker = {
    ...city,
    type: city.type ?? 'city',
    forceId: city.forceId === undefined ? null : city.forceId,
  };
  return withHistory(state, {
    backgroundImage: state.backgroundImage,
    width: state.width,
    height: state.height,
    grid: cloneGrid(state.grid),
    cities: [...state.cities.filter((candidate) => candidate.id !== normalized.id).map((candidate) => ({ ...candidate })), { ...normalized }],
    plots: clonePlots(state.plots),
    facilities: cloneFacilities(state.facilities),
  });
}

/** 放置关隘标记 */
export function placePass(state: MapEditorState, pass: EditorStrongholdMarker): MapEditorState {
  return placeCity(state, { ...pass, type: 'pass' });
}

/**
 * 圈定建设用地：把坐标格归属到指定城（一格一主——若该格已属于其它城则改判为本城）。
 * 目标城必须已存在；cityId 为 null 时表示取消该格的建设用地归属。
 */
export function assignPlot(state: MapEditorState, cityId: string | null, coord: { q: number; r: number }): MapEditorState {
  const index = state.plots.findIndex((plot) => plot.q === coord.q && plot.r === coord.r);
  const existing = index >= 0 ? state.plots[index] : undefined;

  // 取消归属：格上无归属或未圈定时直接短路
  if (cityId === null) {
    if (!existing) return state;
    const next = clonePlots(state.plots);
    next.splice(index, 1);
    return withHistory(state, {
      backgroundImage: state.backgroundImage,
      grid: cloneGrid(state.grid),
      cities: cloneCities(state.cities),
      plots: next,
      facilities: cloneFacilities(state.facilities),
      width: state.width,
      height: state.height,
    });
  }

  // 归属省份校验：cityId 必须能在 cities 中匹配到 type==='city' 的城池
  if (!state.cities.some((city) => city.id === cityId && city.type === 'city')) return state;
  // 缩放点本身就占用，不作为建设用地
  if (state.cities.some((city) => city.q === coord.q && city.r === coord.r)) return state;

  // 目标不存在或已归属本城 → 无需变更
  if (existing && existing.cityId === cityId) return state;

  if (existing) {
    if (existing.cityId === cityId) return state;
    const next = clonePlots(state.plots);
    next[index] = { cityId, q: coord.q, r: coord.r };
    return withHistory(state, {
      backgroundImage: state.backgroundImage,
      grid: cloneGrid(state.grid),
      cities: cloneCities(state.cities),
      plots: next,
      facilities: cloneFacilities(state.facilities),
      width: state.width,
      height: state.height,
    });
  }

  return withHistory(state, {
    backgroundImage: state.backgroundImage,
    grid: cloneGrid(state.grid),
    cities: cloneCities(state.cities),
    plots: [...clonePlots(state.plots), { cityId, q: coord.q, r: coord.r }],
    facilities: cloneFacilities(state.facilities),
    width: state.width,
    height: state.height,
  });
}

/** 擦除城池/关隘：移除标记并将该格地形重置为平地（擦除工具），并释放该城对应的建设用地归属 */
export function eraseStronghold(state: MapEditorState, id: string): MapEditorState {
  const stronghold = state.cities.find((candidate) => candidate.id === id);
  if (!stronghold) return state;
  const footprintKeys = new Set(sevenCellCityFootprint(stronghold).map((coord) => `${coord.q},${coord.r}`));
  const nextGrid = state.grid.map((cell) =>
    footprintKeys.has(`${cell.q},${cell.r}`) ? { ...cell, terrain: 'plain' as TerrainType } : cell,
  );
  return withHistory(state, {
    backgroundImage: state.backgroundImage,
    width: state.width,
    height: state.height,
    grid: nextGrid,
    cities: state.cities.filter((candidate) => candidate.id !== id).map((candidate) => ({ ...candidate })),
    plots: clonePlots(state.plots.filter((plot) => plot.cityId !== id)),
    facilities: cloneFacilities(state.facilities),
  });
}

/**
 * 放置军事设施标记（编辑器「军事设施」工具）：同格已有设施则整体替换。
 * 地形需可放置（山崖/川/水面不可），且不得落在城池 7 格 footprint 或关隘标记上 ——
 * 与游戏内 `isBuildableFacilityCell` 的「不可在城内建设」口径一致。
 */
export function placeFacility(state: MapEditorState, marker: EditorFacilityMarker): MapEditorState {
  const definition = FACILITIES[marker.type];
  if (!definition) return state;
  if (marker.q < 0 || marker.q >= state.width || marker.r < 0 || marker.r >= state.height) return state;
  if (!isPlaceableFacilityTerrain(state.grid, marker.q, marker.r)) return state;
  if (state.cities.some((city) => city.q === marker.q && city.r === marker.r)) return state;
  const occupied = new Set(
    state.cities.flatMap((city) => sevenCellCityFootprint({ q: city.q, r: city.r }).map((coord) => `${coord.q},${coord.r}`)),
  );
  if (occupied.has(`${marker.q},${marker.r}`)) return state;
  const cityIds = new Set(state.cities.filter((city) => city.type === 'city').map((city) => city.id));
  if (marker.cityId !== undefined && !cityIds.has(marker.cityId)) return state;

  const rest = state.facilities.filter((facility) => facility.q !== marker.q || facility.r !== marker.r);
  return withHistory(state, {
    backgroundImage: state.backgroundImage,
    width: state.width,
    height: state.height,
    grid: cloneGrid(state.grid),
    cities: cloneCities(state.cities),
    plots: clonePlots(state.plots),
    facilities: [...rest, { ...marker, forceId: marker.forceId ?? null }],
  });
}

/** 移除某格上的军事设施标记（编辑器擦除工具/设施菜单「拆除」用） */
export function removeFacilityAt(state: MapEditorState, coord: { q: number; r: number }): MapEditorState {
  if (!state.facilities.some((facility) => facility.q === coord.q && facility.r === coord.r)) return state;
  return withHistory(state, {
    backgroundImage: state.backgroundImage,
    width: state.width,
    height: state.height,
    grid: cloneGrid(state.grid),
    cities: cloneCities(state.cities),
    plots: clonePlots(state.plots),
    facilities: state.facilities.filter((facility) => facility.q !== coord.q || facility.r !== coord.r),
  });
}


export function createBlankMap(width: number = 200, height: number = 200): MapEditorState {
  const grid: GridCell[] = [];
  for (let q = 0; q < width; q += 1) {
    for (let r = 0; r < height; r += 1) grid.push({ q, r, terrain: 'plain' });
  }
  return {
    backgroundImage: '',
    grid,
    cities: [],
    plots: [],
    facilities: [],
    width,
    height,
    history: [],
    future: [],
  };
}

/**
 * 为缺少建设用地的城池自动圈定建设用地（与开局 `initConstructionPlots` 同一算法）。
 * **只在打开没有 `plotsSpecified` 标记的旧图时使用**：让编辑器里看到的圈地与开局实际
 * 采用的完全一致，避免旧图「一看没有地、进游戏又冒出来」。编辑器内不再有任何自动分配 ——
 * 放城不给地，全部由「建设用地」工具手动圈（或点「自动圈地」取标准一份）。
 * - 关隘不分配（关隘不开放建设）；
 * - 已有建设用地的城池（手动圈定 / 上次自动分配）保持原样，不重算也不追加。
 */
export function autoAssignEditorPlots(state: MapEditorState): MapEditorState {
  const cities = state.cities.filter((marker) => (marker.type ?? 'city') === 'city');
  if (cities.length === 0) return state;
  const taken = new Set(state.plots.map((plot) => `${plot.q},${plot.r}`));
  const alreadyHasPlots = new Set(state.plots.map((plot) => plot.cityId));
  const additions: EditorCityPlot[] = [];
  for (const city of cities) {
    if (alreadyHasPlots.has(city.id)) continue;
    const picked = autoSearchCityPlots(
      { id: city.id, gridQ: city.q, gridR: city.r, count: PLOT_COUNT_BY_SIZE.medium },
      cities.map((entry) => ({ id: entry.id, gridQ: entry.q, gridR: entry.r })),
      state.grid,
      taken,
    );
    for (const coord of picked) {
      const key = `${coord.q},${coord.r}`;
      if (taken.has(key)) continue;
      taken.add(key);
      additions.push({ cityId: city.id, q: coord.q, r: coord.r });
    }
  }
  return additions.length === 0 ? state : { ...state, plots: [...state.plots, ...additions] };
}

/**
 * 重新算一份某城「中城档」的自动圈地（忽略它自己现有的地格，故可整体替换成标准一份）。
 * 供编辑器的「自动圈地」按钮使用：把本城重置为标准 9 格，仍走草稿 → 确定流程。
 */
export function autoPlotsForCity(state: MapEditorState, cityId: string): EditorCityPlot[] {
  const cities = state.cities.filter((marker) => (marker.type ?? 'city') === 'city');
  const city = cities.find((candidate) => candidate.id === cityId);
  if (!city) return [];
  const taken = new Set(
    state.plots.filter((plot) => plot.cityId !== cityId).map((plot) => `${plot.q},${plot.r}`),
  );
  return autoSearchCityPlots(
    { id: city.id, gridQ: city.q, gridR: city.r, count: PLOT_COUNT_BY_SIZE.medium },
    cities.map((entry) => ({ id: entry.id, gridQ: entry.q, gridR: entry.r })),
    state.grid,
    taken,
  ).map((coord) => ({ cityId: city.id, q: coord.q, r: coord.r }));
}

export function undoEditor(state: MapEditorState): MapEditorState {
  const previous = state.history.at(-1);
  if (!previous) return state;

  return {
    backgroundImage: previous.backgroundImage,
    grid: cloneGrid(previous.grid),
    cities: cloneCities(previous.cities),
    plots: clonePlots(previous.plots),
    facilities: cloneFacilities(previous.facilities),
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
    plots: clonePlots(next.plots),
    facilities: cloneFacilities(next.facilities),
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
    plots: [],
    facilities: [],
  });
}

/**
 * 批量提交建设用地（编辑器「确定」用）：adds 覆盖同坐标归属，removes 指定坐标取消归属。
 * 作为一条历史记录落库；过滤无效坐标、非城 id、城中心格。
 */
export function commitPlots(state: MapEditorState, adds: EditorCityPlot[], removes: string[] = []): MapEditorState {
  const cityIds = new Set(state.cities.filter((city) => city.type === 'city').map((city) => city.id));
  const byKey = new Map<string, EditorCityPlot>();
  for (const plot of adds) {
    if (!cityIds.has(plot.cityId)) continue;
    if (state.cities.some((city) => city.q === plot.q && city.r === plot.r)) continue;
    if (plot.q < 0 || plot.q >= state.width || plot.r < 0 || plot.r >= state.height) continue;
    byKey.set(`${plot.q},${plot.r}`, { cityId: plot.cityId, q: plot.q, r: plot.r });
  }
  const removeSet = new Set(removes);
  let plots = clonePlots(state.plots);
  if (removeSet.size) plots = plots.filter((plot) => !removeSet.has(`${plot.q},${plot.r}`));
  for (const [key, plot] of byKey) {
    const index = plots.findIndex((candidate) => `${candidate.q},${candidate.r}` === key);
    if (index >= 0) plots[index] = plot;
    else plots.push(plot);
  }

  return withHistory(state, {
    backgroundImage: state.backgroundImage,
    grid: cloneGrid(state.grid),
    cities: cloneCities(state.cities),
    plots,
    facilities: cloneFacilities(state.facilities),
    width: state.width,
    height: state.height,
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
    plots: clonePlots(state.plots),
    facilities: cloneFacilities(state.facilities),
  });
}

/** 导出地图 JSON：`plots` 与 `plotsSpecified` 一律写出（哪怕圈地为空），
 *  这样「进游戏时以图上圈地为准、不再自动补地」这件事能随图落盘 */
export function exportEditorJson(state: MapEditorState, name?: string): string {
  const payload: EditorMapPayload = {
    schemaVersion: 2,
    width: state.width,
    height: state.height,
    backgroundImage: state.backgroundImage,
    grid: state.grid,
    cities: state.cities,
    plots: state.plots,
    facilities: state.facilities,
    plotsSpecified: true,
    ...(name ? { name } : {}),
  };
  return JSON.stringify(payload, null, 2);
}

export function importEditorJson(state: MapEditorState, json: string): MapEditorState {
  const payload = parseEditorJsonPayload(json);
  return withHistory(state, {
    backgroundImage: payload.backgroundImage,
    grid: payload.grid,
    cities: payload.cities,
    plots: payload.plots ?? [],
    facilities: payload.facilities ?? [],
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
  const plotRects = state.plots.map((plot) => {
    const position = cellPosition(plot.q, plot.r);
    return `<rect x="${position.x + 2}" y="${position.y + 2}" width="${CELL_SIZE - 4}" height="${CELL_SIZE - 4}" fill="rgba(120,180,220,0.5)" stroke="#7ac0e0" data-plot-cell="${plot.cityId}:${plot.q},${plot.r}" />`;
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

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">${[...cells, ...plotRects, ...cities].join('')}</svg>`;
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
