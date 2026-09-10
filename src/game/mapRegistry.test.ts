import { describe, expect, it } from 'vitest';
import { EditorMapPayload } from './map-editor/editor';
import {
  addSessionMap,
  BUILTIN_MAP_CHINA42_ID,
  getMap,
  listMaps,
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
});