import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { autoAssignEditorPlots, createEditorState, normalizeEditorPayload, type EditorMapPayload } from './map-editor/editor';
import china42Data from './scenario/maps/china42x.json';
import { china42Passes } from './scenario/jingxiang208';
import {
  addSessionMap,
  BUILTIN_MAP_CHINA42_ID,
  getMap,
  listMaps,
  loadRuntimeMaps,
  registerBuiltinMaps,
  updateSessionMap,
} from './mapRegistry';

describe('map registry', () => {
  it('registers the builtin china42 map once and lists it', () => {
    registerBuiltinMaps();
    registerBuiltinMaps();

    const maps = listMaps();
    expect(maps.length).toBeGreaterThanOrEqual(1);
    const builtin = maps.find((m) => m.id === BUILTIN_MAP_CHINA42_ID);
    expect(builtin?.builtin).toBe(true);
    expect(builtin?.name).toBe('荆襄地图');
    expect(builtin?.payload.grid.length).toBe(200 * 200);
    expect(builtin?.payload.cities.some((c) => c.type === 'city')).toBe(true);
    expect(builtin?.payload.cities.some((c) => c.type === 'pass')).toBe(true);
  });

  it('内置图建设用地统一暴露为顶层 plots（原版 interior 会被平移，编辑器导出格式直接沿用）', () => {
    registerBuiltinMaps();
    const builtin = getMap(BUILTIN_MAP_CHINA42_ID);
    const source = china42Data as unknown as {
      plots?: Array<{ cityId: string; q: number; r: number }>;
      cities?: Array<{ interior?: Array<[number, number]> }>;
    };
    // 兼容两种内置图格式：有顶层 plots 就用它，否则按各城 interior 求和
    const expectedCount = source.plots?.length
      ?? (source.cities ?? []).reduce((sum, city) => sum + (city.interior?.length ?? 0), 0);

    expect(expectedCount).toBeGreaterThan(0);
    expect(builtin?.payload.plots).toHaveLength(expectedCount);
    // 一格一主：坐标不重复
    const keys = new Set(builtin?.payload.plots?.map((plot) => `${plot.q},${plot.r}`));
    expect(keys.size).toBe(expectedCount);
    // 归属必须落在已存在的城池上（关隘不算建设用地）
    const cityIds = new Set(builtin?.payload.cities.filter((c) => c.type === 'city').map((c) => c.id));
    expect(builtin?.payload.plots?.every((plot) => cityIds.has(plot.cityId))).toBe(true);
    // 遗留的 interior 字段不再挂在城池对象上
    expect(builtin?.payload.cities.every((c) => !('interior' in c))).toBe(true);
    // 抽样：襄平首格可用
    expect(builtin?.payload.plots?.some((plot) => plot.cityId === 'xiangping' && plot.q === 176 && plot.r === 21)).toBe(true);
  });

  it('关隘锚点兼容两种格式（原版 passes 数组 / 编辑器导出的 cities type=pass）', () => {
    registerBuiltinMaps();
    const builtin = getMap(BUILTIN_MAP_CHINA42_ID)!;
    const passMarkers = builtin.payload.cities.filter((c) => c.type === 'pass');
    // 无论哪种格式，编辑器侧看到的关隘标记都在（原版 10 座）
    expect(passMarkers).toHaveLength(10);
    expect(china42Passes()).toHaveLength(10);
    expect(china42Passes().map((anchor) => anchor.id)).toContain('tongguan');
  });

  it('adds and reads a custom session map', () => {
    const payload: EditorMapPayload = {
      schemaVersion: 2,
      width: 8,
      height: 8,
      backgroundImage: '',
      grid: [],
      cities: [],
      name: '测试图',
    };
    // 补足 grid 长度以满足结构
    for (let i = 0; i < 64; i += 1) payload.grid.push({ q: i % 8, r: Math.floor(i / 8), terrain: 'plain' });

    const id = addSessionMap(payload, '测试图');

    const map = getMap(id);
    expect(map?.name).toBe('测试图');
    expect(map?.builtin).toBe(false);
  });

  it('updates an existing custom map', () => {
    const payload: EditorMapPayload = {
      schemaVersion: 2,
      width: 4,
      height: 4,
      backgroundImage: '',
      grid: [],
      cities: [],
      name: '旧名',
    };
    for (let i = 0; i < 16; i += 1) payload.grid.push({ q: i % 4, r: Math.floor(i / 4), terrain: 'plain' });

    const id = addSessionMap(payload, '旧名');
    updateSessionMap(id, { ...payload, name: '新名' });

    expect(getMap(id)?.name).toBe('新名');
    expect(getMap('non-existent')).toBeUndefined();
  });

  it('hot-loads runtime maps from public/maps via the manifest (方案A 热拔插)', async () => {
    // 模拟静态托管：public/maps/index.json 列出 id，再逐个 fetch <id>.json
    const files: Record<string, object> = {
      '/maps/index.json': ['runtime-hero'],
      '/maps/runtime-hero.json': {
        schemaVersion: 2,
        width: 10,
        height: 10,
        name: '热插地图',
        grid: [],
        cities: [],
      },
    };
    const realFetch = globalThis.fetch;
    globalThis.fetch = ((input: RequestInfo | URL) => {
      const data = files[String(input).replace(/^https?:\/\/[^/]+/, '')];
      return Promise.resolve({ ok: data !== undefined, json: async () => data } as Response);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    }) as unknown as typeof fetch;
    try {
      await loadRuntimeMaps();

      const map = getMap('runtime-hero');
      expect(map?.builtin).toBe(true);
      expect(map?.name).toBe('热插地图');
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  it('does not double-register runtime maps under concurrent calls (StrictMode 双执行)', async () => {
    const id = 'race-hero';
    const realFetch = globalThis.fetch;
    globalThis.fetch = ((input: RequestInfo | URL) => {
      const data = String(input).includes('race-hero')
        ? { schemaVersion: 2, width: 6, height: 6, name: '并发图', grid: [], cities: [] }
        : [id];
      return Promise.resolve({ ok: true, json: async () => data } as Response);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    }) as unknown as typeof fetch;
    try {
      await Promise.all([loadRuntimeMaps(), loadRuntimeMaps()]); // 并发两次

      const entries = listMaps().filter((map) => map.id === id);
      expect(entries).toHaveLength(1);
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});

/** public/maps 下的真实运行时图（手动维护 index.json 清单的那批） */
const RUNTIME_MAPS_DIR = resolve(process.cwd(), 'public/maps');
const readRuntimeMapFile = (name: string) => JSON.parse(readFileSync(resolve(RUNTIME_MAPS_DIR, name), 'utf8')) as unknown;

describe('map registry 运行时图（public/maps 真实文件）', () => {
  it('真实运行时图归一化后可直接进编辑器：缺 plots / facilities / plotsSpecified 都不抛异常', async () => {
    const ids = readRuntimeMapFile('index.json') as string[];
    expect(ids.length).toBeGreaterThan(0); // 夹具健康检查：仓库里确实有运行时图

    const realFetch = globalThis.fetch;
    globalThis.fetch = ((input: RequestInfo | URL) => {
      const name = decodeURIComponent(String(input)).split('/').pop() ?? '';
      try {
        const data = readRuntimeMapFile(name);
        return Promise.resolve({ ok: true, json: async () => data } as Response);
      } catch {
        return Promise.resolve({ ok: false, json: async () => null } as Response);
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    }) as unknown as typeof fetch;
    try {
      await loadRuntimeMaps();

      for (const id of ids) {
        const payload = getMap(id)?.payload;
        expect(payload, `运行时图「${id}」没有注册进注册表`).toBeTruthy();
        // 老图没有这几个字段：归一化后必须是可用形态，而不是把 undefined 漏给编辑器
        expect(Array.isArray(payload!.plots)).toBe(true);
        expect(Array.isArray(payload!.facilities)).toBe(true);
        expect(payload!.plotsSpecified).not.toBe(true);
        expect(payload!.grid).toHaveLength(payload!.width * payload!.height);
        expect(payload!.cities.every((city) => city.type === 'city' || city.type === 'pass')).toBe(true);

        // 编辑器入口：修复前这里会因为 stub 城缺 troops/population 在渲染期抛 TypeError
        const editor = createEditorState(
          payload!.grid,
          payload!.cities,
          payload!.width,
          payload!.height,
          payload!.plots ?? [],
          payload!.facilities ?? [],
        );
        const opened = payload!.plotsSpecified ? editor : autoAssignEditorPlots(editor);
        expect(opened.grid).toHaveLength(payload!.width * payload!.height);
        // 每座有主城池都拿到建设用地（没有 plotsSpecified 的老图按开局同一口径自动补）
        const ownedCities = opened.cities.filter((city) => (city.type ?? 'city') === 'city' && city.forceId);
        for (const city of ownedCities) {
          expect(opened.plots.some((plot) => plot.cityId === city.id), `城池「${city.id}」没有建设用地`).toBe(true);
        }
      }
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  it('载荷归一化：缺字段补默认值、旧版 passes 合并、残缺栅格补平地', () => {
    const payload = normalizeEditorPayload({
      schemaVersion: 1,
      width: 4,
      height: 4,
      backgroundImage: '',
      grid: [
        { q: 0, r: 0, terrain: 'plain' },
        { q: 1, r: 1, terrain: 'forest' },
        { q: 9, r: 9, terrain: 'sea' }, // 越界 → 丢弃
        { q: 1, r: 1, terrain: 'water' }, // 同格重复 → 只留首个
        { q: 2, r: 2, terrain: 'swamp' }, // 旧版未知地形 → 丢弃后补平地
      ],
      cities: [{ id: 'c1', label: '城', q: 3, r: 3 }], // 缺 type / forceId
      passes: [{ id: 'p1', label: '关', q: 0, r: 3 }], // 旧版的关隘单独数组
    });

    expect(payload).toBeTruthy();
    expect(payload!.schemaVersion).toBe(2);
    expect(payload!.width).toBe(4);
    expect(payload!.grid).toHaveLength(16); // 缺格补平地
    expect(payload!.grid.find((cell) => cell.q === 1 && cell.r === 1)?.terrain).toBe('forest');
    expect(payload!.grid.find((cell) => cell.q === 2 && cell.r === 2)?.terrain).toBe('plain');
    expect(payload!.grid.find((cell) => cell.q === 9 && cell.r === 9)).toBeUndefined();
    expect(payload!.cities).toEqual([
      { id: 'c1', label: '城', q: 3, r: 3, type: 'city', forceId: null },
      { id: 'p1', label: '关', q: 0, r: 3, type: 'pass', forceId: null },
    ]);
    expect(payload!.plots).toEqual([]);
    expect(payload!.facilities).toEqual([]);
    expect(payload!.plotsSpecified).toBe(false);
  });

  it('归一化在列表页就拦掉「连图都算不上」的载荷，而不是等进编辑器再炸白屏', () => {
    // 本地缓存里手改过 / 半截写入的条目：没有栅格数组 → 不能当图用
    expect(normalizeEditorPayload({ width: 20, height: 20 })).toBeNull();
    expect(normalizeEditorPayload({ width: 20, height: 20, grid: 'oops' })).toBeNull();
    // 宽高不是 1~512 的整数
    expect(normalizeEditorPayload({ width: 0, height: 20, grid: [] })).toBeNull();
    expect(normalizeEditorPayload({ width: 20.5, height: 20, grid: [] })).toBeNull();
    expect(normalizeEditorPayload({ width: 9999, height: 20, grid: [] })).toBeNull();
    expect(normalizeEditorPayload(null)).toBeNull();

    // 空栅格是合法输入（空白图）：补成整片平地后仍可编辑
    expect(normalizeEditorPayload({ width: 20, height: 20, grid: [] })!.grid).toHaveLength(400);
  });
});