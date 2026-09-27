import type { ForceId } from './types';
import { normalizeEditorPayload, type EditorCityPlot, type EditorMapPayload } from './map-editor/editor';
import { createScenarioCities } from './scenario/jingxiang208';
import china42Data from './scenario/maps/china42x.json';

const STORAGE_KEY = 'san11-custom-maps-v1';

/** 荆襄地图（china42x）是游戏启动和默认加载的核心地图 */
export const BUILTIN_MAP_CHINA42_ID = 'china42x';

/** 可用地图条目：内置图（maps/ 目录下所有 .json）+ localStorage 自定义图 */
export interface SessionMap {
  id: string;
  name: string;
  builtin: boolean;
  payload: EditorMapPayload;
}

const sessionMaps: SessionMap[] = [];
let builtinLoaded = false;
let storageLoaded = false;

/**
 * 目录下所有 .json 在编译时被 Vite glob 捕获（浏览器/vite build 生效）。
 * vitest 环境下返回空对象，由 loadBuiltinFallback 兜底。
 */
const BUILTIN_MAP_GLOB: Record<string, unknown> = (() => {
  try {
    // vite 编译时展开；vitest 下 import.meta.glob 不存在或返回空
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore - vite 特有语法
    const mod = import.meta.glob('./scenario/maps/*.json', { eager: true, import: 'default' });
    return mod;
  } catch {
    return {};
  }
})();

function loadBuiltinFallback(): SessionMap[] {
  // 硬编码兜底：确保 vitest / 任何环境下至少有一张内置图
  return [{
    id: BUILTIN_MAP_CHINA42_ID,
    name: '荆襄地图',
    builtin: true,
    payload: normalizeBuiltinPayload(china42Data as unknown as ImportMetaPayload),
  }];
}

/** 原始 JSON 的 cities 和 passes 是分开的两个数组，不带 type 字段。
 * 统一合并进 cities 并补齐 type: 'city'/'pass'，构造完整 EditorMapPayload */
interface ImportMetaPayload {
  schemaVersion?: number;
  width: number;
  height: number;
  grid?: unknown[];
  cities?: unknown[];
  passes?: unknown[];
  name?: string;
  id?: string; // 由 glob 调用方注入，用于中文名称映射
}

/** 原版内置图（schemaVersion 1）把建设用地坐标挂在每座城的 `interior` 上，形如 [q, r][]。
 * 编辑器只认顶层 `plots`，因此载入时把它平移过来；已有显式 plots 的图不受影响。 */
interface RawCityWithInterior {
  id: string;
  q: number;
  r: number;
  type?: 'city' | 'pass';
  interior?: unknown;
}

function plotsFromCityInterior(cities: RawCityWithInterior[], width: number, height: number): EditorCityPlot[] {
  const centers = new Set(cities.map((city) => `${city.q},${city.r}`));
  const seen = new Set<string>();
  const plots: EditorCityPlot[] = [];
  for (const city of cities) {
    if ((city.type ?? 'city') !== 'city' || !Array.isArray(city.interior)) continue;
    for (const entry of city.interior as unknown[]) {
      if (!Array.isArray(entry) || entry.length < 2) continue;
      const [q, r] = entry as [unknown, unknown];
      if (typeof q !== 'number' || typeof r !== 'number' || !Number.isInteger(q) || !Number.isInteger(r)) continue;
      const key = `${q},${r}`;
      // 越界、重复（一格一主）、压在城心上的坐标一律丢弃
      if (q < 0 || q >= width || r < 0 || r >= height || seen.has(key) || centers.has(key)) continue;
      seen.add(key);
      plots.push({ cityId: city.id, q, r });
    }
  }
  return plots;
}

/** 去掉内置图遗留的 interior 字段，避免它被原样写回用户保存的地图 JSON */
function withoutInterior<T extends object>(markers: T[]): T[] {
  return markers.map((marker) => {
    const { interior: _interior, ...rest } = marker as T & { interior?: unknown };
    return rest as T;
  });
}

const BUILTIN_NAME_MAP: Record<string, string> = {
  china42x: '荆襄地图',
};

/** 荆襄 42 城的原始城池归属（从 createScenarioCities 提取）。
 * 只影响 china42x 内置图；其他内置图如果有独立归属，可在各自 JSON 里直接标注 forceId 字段。 */
const JINGXIANG_CITY_OWNERS: Record<string, string | null> = (() => {
  const cities = createScenarioCities();
  const map: Record<string, string | null> = {};
  for (const entry of Object.values(cities)) {
    map[entry.id] = entry.ownerId;
  }
  return map;
})();

function normalizeBuiltinPayload(raw: ImportMetaPayload): EditorMapPayload {
  // 如果已经是 EditorMapPayload 格式（schemaVersion:2 + cities 有 type），直接用
  const first = raw.cities?.[0] as Record<string, unknown> | undefined;
  if (raw.schemaVersion === 2 && Array.isArray(raw.cities) && raw.cities.length > 0 && first && 'type' in first) {
    const typed = raw as unknown as EditorMapPayload;
    if (!typed.name && raw.id) typed.name = BUILTIN_NAME_MAP[raw.id] ?? raw.id;
    if (!typed.plots?.length) {
      const plots = plotsFromCityInterior(typed.cities as RawCityWithInterior[], typed.width, typed.height);
      if (plots.length) typed.plots = plots;
    }
    typed.cities = withoutInterior(typed.cities);
    return typed;
  }
  // 原始 china42x 格式：cities + passes 分开数组，无 type；建设用地挂在各城 interior 上
  const rawCities = (raw.cities ?? []) as Array<RawCityWithInterior & { label: string; forceId?: ForceId | null }>;
  const rawPasses = (raw.passes ?? []) as Array<{ id: string; label: string; q: number; r: number }>;
  // 城池归属：优先用 JSON 自带 forceId 字段；否则查荆襄归属表
  const id = raw.id ?? '';
  const isJingxiang = id === BUILTIN_MAP_CHINA42_ID;
  const cities = [
    ...rawCities.map((c) => ({
      id: c.id,
      label: c.label,
      q: c.q,
      r: c.r,
      type: 'city' as const,
      forceId: ((c.forceId as ForceId | null | undefined) ?? (isJingxiang ? (JINGXIANG_CITY_OWNERS[c.id] as ForceId | null) ?? null : null)),
    })),
    ...rawPasses.map((p) => ({ id: p.id, label: p.label, q: p.q, r: p.r, type: 'pass' as const, forceId: null })),
  ];
  const plots = plotsFromCityInterior(rawCities.map((c) => ({ ...c, type: 'city' as const })), raw.width, raw.height);
  return {
    schemaVersion: 2,
    width: raw.width,
    height: raw.height,
    backgroundImage: '',
    grid: (raw.grid ?? []) as EditorMapPayload['grid'],
    cities,
    ...(plots.length ? { plots } : {}),
    name: raw.name ?? BUILTIN_NAME_MAP[id] ?? id,
  };
}

function loadBuiltinMaps(): void {
  if (builtinLoaded) return;
  builtinLoaded = true;

  const globEntries = Object.entries(BUILTIN_MAP_GLOB);
  const mapsFromGlob: SessionMap[] = [];

  for (const [path, raw] of globEntries) {
    const parsed = raw as ImportMetaPayload;
    // 必须有 width/height/grid 才算有效地图
    if (!parsed || parsed.width <= 0 || parsed.height <= 0 || !Array.isArray(parsed.grid)) continue;
    // 注入 id（文件名，不含路径和后缀）
    const id = path.replace(/^.*\//, '').replace(/\.json$/, '');
    parsed.id = id;
    const normalized = normalizeBuiltinPayload(parsed);
    mapsFromGlob.push({
      id,
      name: normalized.name ?? id,
      builtin: true,
      payload: normalized,
    });
  }

  const all = mapsFromGlob.length > 0 ? mapsFromGlob : loadBuiltinFallback();
  for (const map of all) {
    sessionMaps.push(map);
  }
}

/** 从 localStorage 恢复自定义地图 */
function loadStoredCustomMaps(): void {
  if (storageLoaded) return;
  storageLoaded = true;
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null;
    if (!raw) return;
    const parsed = JSON.parse(raw) as Array<{ id: string; name: string; payload: EditorMapPayload }>;
    if (!Array.isArray(parsed)) return;
    for (const entry of parsed) {
      if (!entry?.id) continue;
      // 会话内已注册（含本次 addSessionMap 刚写入的）→ 跳过，避免同一张图在列表里出现两次
      if (sessionMaps.some((map) => map.id === entry.id)) continue;
      // 本地缓存是「不可信来源」：早先版本写下的图可能没有 plots / facilities、城池没有 type。
      // 统一归一化补默认值；连栅格都没有的条目直接丢弃 —— 挡在列表页之外，不让它把编辑器打成白屏
      const payload = normalizeEditorPayload(entry.payload);
      if (!payload) continue;
      sessionMaps.push({ id: entry.id, name: entry.name ?? payload.name ?? '未命名', builtin: false, payload });
    }
  } catch { /* 损坏忽略 */ }
}

/** 将所有自定义地图写入 localStorage（内置图不写） */
function persistCustomMaps(): void {
  try {
    const custom = sessionMaps.filter((m) => !m.builtin);
    if (typeof localStorage === 'undefined') return;
    if (custom.length === 0) {
      localStorage.removeItem(STORAGE_KEY);
    } else {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(custom.map((m) => ({ id: m.id, name: m.name, payload: m.payload }))));
    }
  } catch { /* quota 或其他错误忽略 */ }
}

/** 注册内置地图（只载入一次）。自定义图在会话内累加至此列表。 */
export function registerBuiltinMaps(loadOnce = true): void {
  if (loadOnce && builtinLoaded && storageLoaded) return;
  loadBuiltinMaps();
  loadStoredCustomMaps();
}

/** 返回当前全部可用地图（含内置图） */
export function listMaps(): SessionMap[] {
  loadBuiltinMaps();
  loadStoredCustomMaps();
  return [...sessionMaps];
}

/**
 * 热拔插：从 public/maps 运行时加载地图（无需重新构建）。
 * 以 public/maps/index.json 为清单，列出待加载的地图 id；
 * 对已在会话中注册（含 glob 编译期内置图/自定义图）的 id 跳过，重复调用可发现新图。
 * 纯静态环境下无法枚举目录，故必须维护 index.json；拉取失败时静默，回退编译期 glob。
 */

/** 并发去重的共享 Promise：StrictMode 双执行 effect 等并发调用只实际加载一次，避免重复注册 */
let runtimeMapsPromise: Promise<void> | null = null;

export function loadRuntimeMaps(): Promise<void> {
  runtimeMapsPromise ??= doLoadRuntimeMaps().finally(() => { runtimeMapsPromise = null; });
  return runtimeMapsPromise;
}

async function doLoadRuntimeMaps(): Promise<void> {
  try {
    const base = String(import.meta.env.BASE_URL ?? '/').replace(/\/?$/, '/');
    const indexRes = await fetch(`${base}maps/index.json`);
    if (!indexRes.ok) return;
    const ids = (await indexRes.json()) as unknown;
    if (!Array.isArray(ids)) return;
    for (const id of ids) {
      if (typeof id !== 'string' || id.length === 0) continue;
      if (sessionMaps.some((map) => map.id === id)) continue;
      try {
        const mapRes = await fetch(`${base}maps/${encodeURIComponent(id)}.json`);
        if (!mapRes.ok) continue;
        const raw = (await mapRes.json()) as ImportMetaPayload;
        if (!raw || raw.width <= 0 || raw.height <= 0 || !Array.isArray(raw.grid)) continue;
        raw.id = id;
        // 运行时图是手写 / 早期导出的 JSON，普遍没有 plots / plotsSpecified / facilities，
        // 城池也可能没有 type：先按内置图口径平移（interior → plots、passes → cities），
        // 再统一归一化补默认值；连栅格都对不上的图直接跳过，不进列表
        const normalized = normalizeEditorPayload(normalizeBuiltinPayload(raw));
        if (!normalized) continue;
        sessionMaps.push({ id, name: normalized.name ?? id, builtin: true, payload: normalized });
      } catch { /* 单张图解析失败忽略 */ }
    }
  } catch { /* 无 index.json 或网络异常时静默，回退编译期 glob 地图 */ }
}

export function getMap(id: string): SessionMap | undefined {
  loadBuiltinMaps();
  loadStoredCustomMaps();
  return sessionMaps.find((map) => map.id === id);
}

/** 新增自定义地图，返回其 id；同步持久化到 localStorage */
export function addSessionMap(payload: EditorMapPayload, name: string): string {
  const id = `custom-${Date.now()}`;
  sessionMaps.push({ id, name, builtin: false, payload });
  persistCustomMaps();
  return id;
}

/** 更新已存在的自定义地图，同步持久化 */
export function updateSessionMap(id: string, payload: EditorMapPayload): void {
  const index = sessionMaps.findIndex((map) => map.id === id);
  if (index !== -1) {
    sessionMaps[index] = { ...sessionMaps[index], payload, name: payload.name ?? sessionMaps[index].name };
    persistCustomMaps();
  }
}

/** 删除自定义地图（内置图不可删） */
export function removeSessionMap(id: string): boolean {
  const index = sessionMaps.findIndex((map) => map.id === id);
  if (index === -1) return false;
  const target = sessionMaps[index];
  if (target.builtin) return false;
  sessionMaps.splice(index, 1);
  persistCustomMaps();
  return true;
}

/** 导入一个 JSON 地图文件（解析后追加或覆盖同名），返回 id。
 *  第三方文件按不可信来源处理：归一化补齐缺字段，连图都算不上的载荷抛错由调用方提示玩家。 */
export function importMapJson(payload: EditorMapPayload, suggestedName?: string): string {
  const normalized = normalizeEditorPayload(payload);
  if (!normalized) throw new Error('不是有效的地图 JSON 文件');
  const name = suggestedName ?? normalized.name ?? '未命名地图';
  const withName: EditorMapPayload = { ...normalized, name };
  const existing = sessionMaps.find((m) => !m.builtin && m.name === name);
  if (existing) {
    updateSessionMap(existing.id, withName);
    return existing.id;
  }
  return addSessionMap(withName, name);
}
