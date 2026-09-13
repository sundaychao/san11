import { CITY_IDS } from './scenario/jingxiang208';
import { isGameState, migrateSaveToCurrent, type SaveAdapter } from './persistence';
import type { CityId, ForceId, GameState, GridCell, TerrainType } from './types';

/** 单机模式存档槽总数（原版三国志11 为 32 个，分 4 页每页 8 个） */
export const SAVE_SLOT_COUNT = 32;
export const SAVE_SLOT_PAGE_SIZE = 8;
export const SAVE_SLOT_PAGE_COUNT = SAVE_SLOT_COUNT / SAVE_SLOT_PAGE_SIZE;

const SLOT_STATE_PREFIX = 'jingxiang-208-slot-';
const SLOT_META_PREFIX = 'jingxiang-208-slot-meta-';
const SLOT_KEY_SUFFIX = '-v1';

export const SLOT_META_VERSION = 1;

/** 镜头（与视口尺寸无关的归一化描述：cx/cy 为视野中心在地图内的比例位置） */
export interface MapCamera {
  cx: number;
  cy: number;
  scale: number;
}

/** 存档槽列表与右侧信息面板所需的全部摘要数据（不读取完整存档即可渲染） */
export interface SaveSlotMeta {
  version: typeof SLOT_META_VERSION;
  /** 1 ~ 32 */
  slot: number;
  /** 真实保存时刻（ISO 字符串） */
  savedAt: string;
  playSeconds: number;
  note: string;
  scenarioId: GameState['scenarioId'];
  scenarioLabel: string;
  year: number;
  month: number;
  monthLabel: string;
  tenDay: number;
  tenDayLabel: string;
  phase: GameState['phase'];
  forceId: ForceId;
  forceName: string;
  forceColor: string;
  leaderId: string;
  leaderName: string;
  cityCount: number;
  officerCount: number;
  gold: number;
  food: number;
  troops: number;
  camera: MapCamera | null;
  /** 势力图打点：全部城池的归一化位置与归属色 */
  cities: Array<{ id: string; name: string; x: number; y: number; color: string }>;
  /** 势力图图例：本局出现的势力 */
  legend: Array<{ id: string; name: string; color: string; cities: number }>;
}

export const SCENARIO_LABELS: Record<GameState['scenarioId'], string> = {
  'jingxiang-208': '荆襄208',
  'mobile-duel': '舌战',
  'custom-map': '自定义地图',
};

export const MONTH_LABELS = ['四月', '五月', '六月', '七月', '八月', '九月', '十月', '冬月', '腊月', '正月', '二月', '三月'];
export const TEN_DAY_LABELS: Record<number, string> = { 1: '上旬', 2: '中旬', 3: '下旬' };

export function slotNumberLabel(slot: number) {
  if (slot < 1 || slot > SAVE_SLOT_COUNT) throw new Error(`存档槽越界：${slot}`);
  return String(slot).padStart(2, '0');
}

export function slotStateKey(slot: number) {
  return `${SLOT_STATE_PREFIX}${slot}${SLOT_KEY_SUFFIX}`;
}

export function slotMetaKey(slot: number) {
  return `${SLOT_META_PREFIX}${slot}${SLOT_KEY_SUFFIX}`;
}

/** 第 slot 页（1~4）覆盖的槽位号区间 */
export function slotPageRange(page: number): [number, number] {
  const start = (page - 1) * SAVE_SLOT_PAGE_SIZE + 1;
  return [start, start + SAVE_SLOT_PAGE_SIZE - 1];
}

export function slotPageLabel(page: number) {
  const [start, end] = slotPageRange(page);
  return `${start} - ${end}`;
}

/* ------------------------------------------------------------------ *
 * 网格紧凑编码
 * 40000 格的 `[{q,r,terrain}]` 令单份存档 JSON 膨胀到 1.4MB，无法容纳 32 槽。
 * 规则点阵只存地形字符（每格 1 字符），非规则网格回退为原样存储。
 * ------------------------------------------------------------------ */

const TERRAIN_ALPHABET: TerrainType[] = [
  'road', 'path', 'plank', 'plain', 'grass', 'sand', 'wasteland', 'wetland', 'poison',
  'forest', 'hill', 'mountain', 'shore', 'water', 'stream', 'river', 'sea', 'shallow',
  'ferry', 'pass', 'construction',
];
const TERRAIN_CHARS = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';

interface CompactGrid {
  __compact: 1;
  width: number;
  height: number;
  /** qr：q 为外层、r 为内层；rq：r 为外层、q 为内层 */
  order: 'qr' | 'rq';
  t: string;
}

function isCompactGrid(value: unknown): value is CompactGrid {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const grid = value as Partial<CompactGrid>;
  return grid.__compact === 1
    && Number.isInteger(grid.width) && Number.isInteger(grid.height)
    && (grid.order === 'qr' || grid.order === 'rq')
    && typeof grid.t === 'string';
}

/** 识别从原点出发的规则点阵（覆盖全部格子且无重复），失败返回 null */
function detectLattice(grid: GridCell[]): { width: number; height: number; order: 'qr' | 'rq' } | null {
  if (grid.length === 0) return null;
  let maxQ = 0;
  let maxR = 0;
  for (const cell of grid) {
    if (!Number.isInteger(cell.q) || !Number.isInteger(cell.r) || cell.q < 0 || cell.r < 0) return null;
    if (cell.q > maxQ) maxQ = cell.q;
    if (cell.r > maxR) maxR = cell.r;
  }
  const width = maxQ + 1;
  const height = maxR + 1;
  if (width * height !== grid.length) return null;
  const qr = grid.every((cell, index) => cell.q === Math.floor(index / width) && cell.r === index % width);
  if (qr) return { width, height, order: 'qr' };
  const rq = grid.every((cell, index) => cell.r === Math.floor(index / width) && cell.q === index % width);
  if (rq) return { width, height, order: 'rq' };
  return null;
}

function encodeGrid(grid: GridCell[]): GridCell[] | CompactGrid {
  const lattice = detectLattice(grid);
  if (!lattice) return grid;
  let t = '';
  for (const cell of grid) {
    const code = TERRAIN_ALPHABET.indexOf(cell.terrain);
    if (code < 0) return grid;
    t += TERRAIN_CHARS[code];
  }
  return { __compact: 1, width: lattice.width, height: lattice.height, order: lattice.order, t };
}

function decodeGrid(grid: unknown): GridCell[] {
  if (!isCompactGrid(grid)) return grid as GridCell[];
  const cells: GridCell[] = [];
  const total = grid.width * grid.height;
  for (let index = 0; index < total; index += 1) {
    const code = TERRAIN_CHARS.indexOf(grid.t[index] ?? '');
    const terrain = TERRAIN_ALPHABET[code];
    if (!terrain) throw new Error(`存档地形编码损坏（第 ${index} 格）`);
    cells.push(grid.order === 'qr'
      ? { q: Math.floor(index / grid.width), r: index % grid.width, terrain }
      : { q: index % grid.width, r: Math.floor(index / grid.width), terrain });
  }
  return cells;
}

/* ------------------------------------------------------------------ *
 * 存档体编码：紧凑网格 + gzip（不可用环境降级为原始 JSON）
 * ------------------------------------------------------------------ */

const GZIP_PREFIX = 'gz1:';
const RAW_PREFIX = 'raw1:';

interface CompressionStreamLike {
  new (format: string): { readable: unknown; writable: unknown };
}
interface DecompressionStreamLike {
  new (format: string): { readable: unknown; writable: unknown };
}

function compressionCtor(): CompressionStreamLike | null {
  const ctor = (globalThis as { CompressionStream?: CompressionStreamLike }).CompressionStream;
  return typeof ctor === 'function' ? ctor : null;
}

function decompressionCtor(): DecompressionStreamLike | null {
  const ctor = (globalThis as { DecompressionStream?: DecompressionStreamLike }).DecompressionStream;
  return typeof ctor === 'function' ? ctor : null;
}

/** 压缩链路所需的浏览器 API 是否齐备（jsdom 等环境缺失时降级为明文存储） */
function canUseGzip(): boolean {
  return compressionCtor() !== null
    && decompressionCtor() !== null
    && typeof TextEncoder === 'function'
    && typeof TextDecoder === 'function'
    && typeof btoa === 'function'
    && typeof atob === 'function';
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const CHUNK = 0x8000;
  for (let index = 0; index < bytes.length; index += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(index, index + CHUNK));
  }
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

interface TransformPair {
  readable: ReadableStream<Uint8Array>;
  writable: WritableStream<Uint8Array>;
}

/** 手工泵送 TransformStream：不依赖 Blob.stream()/Response（jsdom 缺失） */
async function runThrough(transform: TransformPair, input: Uint8Array): Promise<Uint8Array> {
  const writer = transform.writable.getWriter();
  const pumping = (async () => {
    await writer.write(input);
    await writer.close();
  })();
  const reader = transform.readable.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value && value.length > 0) {
      chunks.push(value);
      total += value.length;
    }
  }
  await pumping;
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.length;
  }
  return merged;
}

async function gzipToBase64(text: string): Promise<string> {
  const Ctor = compressionCtor()!;
  const bytes = await runThrough(new Ctor('gzip') as unknown as TransformPair, new TextEncoder().encode(text));
  return bytesToBase64(bytes);
}

async function gunzipFromBase64(value: string): Promise<string> {
  const Ctor = decompressionCtor()!;
  const bytes = await runThrough(new Ctor('gzip') as unknown as TransformPair, base64ToBytes(value));
  return new TextDecoder().decode(bytes);
}

/** 存档对象 → 可写入 localStorage 的字符串（异步：需要 gzip 压缩） */
export async function encodeSaveBlob(state: GameState): Promise<string> {
  const json = JSON.stringify({ ...state, grid: encodeGrid(state.grid) });
  if (!canUseGzip()) return RAW_PREFIX + json;
  try {
    return GZIP_PREFIX + await gzipToBase64(json);
  } catch {
    // 浏览器支持压缩但运行异常时退回明文，保证存档不丢
    return RAW_PREFIX + json;
  }
}

export type DecodeSaveResult =
  | { ok: true; state: GameState }
  | { ok: false; reason: '存档无法读取' | '存档版本不兼容' };

/** localStorage 字符串 → 存档对象（含旧格式/明文降级兼容） */
export async function decodeSaveBlob(raw: string): Promise<DecodeSaveResult> {
  try {
    let json: string;
    if (raw.startsWith(GZIP_PREFIX)) {
      if (!canUseGzip()) return { ok: false, reason: '存档版本不兼容' };
      json = await gunzipFromBase64(raw.slice(GZIP_PREFIX.length));
    } else if (raw.startsWith(RAW_PREFIX)) {
      json = raw.slice(RAW_PREFIX.length);
    } else {
      // 早期未经编码的明文存档
      json = raw;
    }
    const parsed = JSON.parse(json) as { schemaVersion?: unknown; grid?: unknown };
    const upgraded = migrateSaveToCurrent(parsed) as { grid?: unknown } | null;
    if (!upgraded) return { ok: false, reason: '存档版本不兼容' };
    const restored = { ...(upgraded as unknown as GameState), grid: decodeGrid(upgraded.grid) };
    if (!isGameState(restored)) return { ok: false, reason: '存档无法读取' };
    return { ok: true, state: restored };
  } catch {
    return { ok: false, reason: '存档无法读取' };
  }
}

/* ------------------------------------------------------------------ *
 * 槽位读写
 * ------------------------------------------------------------------ */

export function readSlotMeta(storage: SaveAdapter, slot: number): SaveSlotMeta | null {
  const raw = storage.getItem(slotMetaKey(slot));
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as SaveSlotMeta;
    return parsed?.version === SLOT_META_VERSION ? parsed : null;
  } catch {
    return null;
  }
}

/** 读取全部 32 槽摘要（下标 0 对应 1 号槽） */
export function listSlotMetas(storage: SaveAdapter): Array<SaveSlotMeta | null> {
  return Array.from({ length: SAVE_SLOT_COUNT }, (_, index) => readSlotMeta(storage, index + 1));
}

/** 最近一次保存的槽位号，用于列表中的「最终更新」标记 */
export function latestSlotNumber(metas: Array<SaveSlotMeta | null>): number | null {
  let latest: SaveSlotMeta | null = null;
  for (const meta of metas) {
    if (!meta) continue;
    if (!latest || Date.parse(meta.savedAt) > Date.parse(latest.savedAt)) latest = meta;
  }
  return latest ? latest.slot : null;
}

export class SaveQuotaError extends Error {
  constructor() {
    super('存储空间不足，请先删除部分存档后重试');
    this.name = 'SaveQuotaError';
  }
}

export async function writeSlot(
  storage: SaveAdapter,
  slot: number,
  state: GameState,
  meta: SaveSlotMeta,
): Promise<void> {
  if (!isGameState(state)) throw new Error('拒绝写入无效存档');
  const blob = await encodeSaveBlob(state);
  try {
    storage.setItem(slotStateKey(slot), blob);
    storage.setItem(slotMetaKey(slot), JSON.stringify(meta));
  } catch (error) {
    // 配额超限时回滚，避免留下「有档体无摘要」的半截存档
    storage.removeItem(slotStateKey(slot));
    storage.removeItem(slotMetaKey(slot));
    const name = (error as { name?: string })?.name;
    if (name === 'QuotaExceededError' || name === 'NS_ERROR_DOM_QUOTA_REACHED') throw new SaveQuotaError();
    throw error;
  }
}

export async function readSlotState(storage: SaveAdapter, slot: number): Promise<DecodeSaveResult> {
  const raw = storage.getItem(slotStateKey(slot));
  if (raw === null) return { ok: false, reason: '存档无法读取' };
  return decodeSaveBlob(raw);
}

export function removeSlot(storage: SaveAdapter, slot: number) {
  storage.removeItem(slotStateKey(slot));
  storage.removeItem(slotMetaKey(slot));
}

/** 由游戏状态生成槽位摘要（含势力图打点） */
export function buildSlotMeta(
  state: GameState,
  input: { slot: number; savedAt?: string; playSeconds?: number; note?: string; camera?: MapCamera | null },
): SaveSlotMeta {
  const force = state.forces[state.playerForceId];
  const leader = state.officers[force.leaderId];
  const playerCities = Object.values(state.cities).filter((city) => city.ownerId === state.playerForceId);

  const legendCounts = new Map<string, number>();
  for (const city of Object.values(state.cities)) {
    const ownerId = city.ownerId;
    if (!ownerId) continue;
    legendCounts.set(ownerId, (legendCounts.get(ownerId) ?? 0) + 1);
  }

  const cities = Object.values(state.cities).map((city) => ({
    id: city.id,
    name: city.name,
    x: typeof city.mapX === 'number' ? city.mapX : 0.5,
    y: typeof city.mapY === 'number' ? city.mapY : 0.5,
    color: city.ownerId ? state.forces[city.ownerId]?.color ?? '#ffffff' : '#ffffff',
  }));

  return {
    version: SLOT_META_VERSION,
    slot: input.slot,
    savedAt: input.savedAt ?? new Date().toISOString(),
    playSeconds: Math.max(0, Math.floor(input.playSeconds ?? 0)),
    note: (input.note ?? '').slice(0, 60),
    scenarioId: state.scenarioId,
    scenarioLabel: SCENARIO_LABELS[state.scenarioId] ?? '荆襄208',
    year: 13 + Math.floor((state.month + 2) / 12),
    month: state.month,
    monthLabel: MONTH_LABELS[(state.month - 1) % 12],
    tenDay: state.tenDay,
    tenDayLabel: TEN_DAY_LABELS[state.tenDay] ?? '上旬',
    phase: state.phase,
    forceId: state.playerForceId,
    forceName: force.name,
    forceColor: force.color,
    leaderId: force.leaderId,
    leaderName: leader?.name ?? force.name,
    cityCount: playerCities.length,
    officerCount: Object.values(state.officers).filter((officer) => officer.forceId === state.playerForceId).length,
    gold: playerCities.reduce((sum, city) => sum + (city.gold ?? 0), 0),
    food: playerCities.reduce((sum, city) => sum + (city.food ?? 0), 0),
    troops: playerCities.reduce((sum, city) => sum + (city.troops ?? 0), 0),
    camera: input.camera ?? null,
    cities,
    legend: [...legendCounts.entries()]
      .map(([id, count]) => ({
        id,
        name: state.forces[id as ForceId]?.name ?? '无主',
        color: state.forces[id as ForceId]?.color ?? '#ffffff',
        cities: count,
      }))
      .sort((a, b) => b.cities - a.cities),
  };
}

/** 势力图打点用的城名缩写（城名过长时截断，避免小图上叠字） */
export function shortCityName(name: string) {
  return name.length > 2 ? name.slice(0, 2) : name;
}

/** 存档摘要里的城池是否属于内置剧本城池集合 */
export function isKnownCityId(id: string): id is CityId {
  return (CITY_IDS as readonly string[]).includes(id);
}
