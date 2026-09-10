import { describe, expect, it } from 'vitest';
import type { EditorMapPayload } from './map-editor/editor';
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