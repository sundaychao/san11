import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PLOT_COUNT_BY_SIZE } from '../game/innerAffairs';
import type { EditorMapPayload } from '../game/map-editor/editor';
import { addSessionMap, getMap, listMaps, loadRuntimeMaps, removeSessionMap } from '../game/mapRegistry';
import { MapEditorScreen } from './MapEditorScreen';

vi.mock('../utils/download', () => ({ downloadTextFile: vi.fn() }));

/**
 * 回归用例：public/maps 下的「运行时热拔插地图」必须能进编辑器。
 *
 * 这类图的载荷只有 { schemaVersion, width, height, backgroundImage, grid, cities, name } ——
 * 没有 plots / plotsSpecified / facilities，城池也常常没有 type/forceId。它们曾经一进编辑器就白屏：
 * StrategicMap 在 editorMode 下仍然渲染游戏专用的城池标牌层，而编辑器给它的 GameState 是
 * MapEditorScreen 的极简 stub（伪城池只有 id/name/ownerId/gridQ/gridR），标牌里的
 * `city.troops.toLocaleString()` 直接抛 TypeError（StrategicMap.tsx:1833）。
 *
 * 所以这里刻意**不 mock StrategicMap**，并直接读仓库里的真实 JSON 当静态托管 —— 把
 * 「index.json 清单 → fetch 单图 → 注册表归一化 → 渲染编辑器」整条链路一次性走通。
 */
const PUBLIC_MAPS_DIR = resolve(process.cwd(), 'public/maps');
const readMapFile = (name: string) => JSON.parse(readFileSync(resolve(PUBLIC_MAPS_DIR, name), 'utf8')) as unknown;
const manifestIds = readMapFile('index.json') as string[];

/** 用仓库里的真实文件顶替静态托管的 fetch（jsdom 不会真的发请求，也不会走 vite 的 public 目录） */
function stubStaticFetch(): () => void {
  const realFetch = globalThis.fetch;
  globalThis.fetch = ((input: RequestInfo | URL) => {
    const name = decodeURIComponent(String(input)).split('/').pop() ?? '';
    try {
      const data = readMapFile(name);
      return Promise.resolve({ ok: true, json: async () => data } as Response);
    } catch {
      return Promise.resolve({ ok: false, json: async () => null } as Response);
    }
  }) as unknown as typeof fetch;
  return () => { globalThis.fetch = realFetch; };
}

/** 与 public/maps/我的地图2.json 同形的精简夹具：没有 plots / plotsSpecified / facilities，城池没有 type */
function legacyRuntimeMapPayload(): EditorMapPayload {
  const size = 20;
  return {
    schemaVersion: 2,
    width: size,
    height: size,
    backgroundImage: '',
    grid: Array.from({ length: size * size }, (_, index) => ({
      q: index % size,
      r: Math.floor(index / size),
      terrain: 'plain' as const,
    })),
    cities: [
      { id: 'city-8-17', label: '新煄', q: 8, r: 17, forceId: 'cao' },
      { id: 'city-9-2', label: '新煄', q: 9, r: 2, forceId: 'sun' },
    ],
  };
}

let restoreFetch: (() => void) | null = null;

beforeEach(async () => {
  restoreFetch = stubStaticFetch();
  await loadRuntimeMaps();
});

afterEach(() => {
  restoreFetch?.();
  restoreFetch = null;
  // 清掉本用例写入的自定义地图，避免污染同文件后续用例
  for (const map of listMaps()) if (!map.builtin) removeSessionMap(map.id);
});

describe('MapEditorScreen 打开 public/maps 下的运行时热拔插地图', () => {
  it('清单里的每张运行时图都会注册进注册表，并补齐 plots / facilities 缺省', () => {
    // 夹具健康检查：仓库里确实有运行时图，否则下面的用例会「空跑也全绿」
    expect(manifestIds.length).toBeGreaterThan(0);

    for (const id of manifestIds) {
      const map = getMap(id);
      expect(map, `运行时图「${id}」没有注册进注册表`).toBeTruthy();
      expect(map!.builtin).toBe(true);
      // 老图没有这几个字段：归一化后必须是可用形态，而不是把 undefined 漏进编辑器
      expect(Array.isArray(map!.payload.plots)).toBe(true);
      expect(Array.isArray(map!.payload.facilities)).toBe(true);
      expect(map!.payload.plotsSpecified).not.toBe(true);
      expect(map!.payload.grid.length).toBe(map!.payload.width * map!.payload.height);
      expect(map!.payload.cities.every((city) => city.type === 'city' || city.type === 'pass')).toBe(true);
      expect(map!.payload.cities.every((city) => 'forceId' in city)).toBe(true);
    }
  });

  it.each(manifestIds)('真实运行时图「%s」能在编辑器里正常打开（渲染期不再抛异常）', (id) => {
    // 修复前：这里抛 TypeError: Cannot read properties of undefined (reading 'toLocaleString')
    expect(() => render(<MapEditorScreen mapId={id} onSave={vi.fn()} onBack={vi.fn()} />)).not.toThrow();

    expect(screen.getByTestId('map-editor-screen')).toBeInTheDocument();
    // 已进入画布（而不是尺寸输入页）：保存入口在
    expect(screen.getByTestId('editor-save-cache')).toBeInTheDocument();
    // 游戏专用的城池标牌层整体跳过 —— 编辑器的据点由主画布 SVG 呈现，stub 城没有 troops/population
    expect(screen.queryAllByTestId('city-marker')).toHaveLength(0);
  });

  it('缺 plots / facilities / type 的载荷也能进编辑器，并自动补一份建设用地', () => {
    const id = addSessionMap(legacyRuntimeMapPayload(), '缺字段老图');
    const onSave = vi.fn();

    expect(() => render(<MapEditorScreen mapId={id} onSave={onSave} onBack={vi.fn()} />)).not.toThrow();
    // 城池缺 type 也按城池认（归一化补 'city'）：两座有主城池都算数
    expect(screen.getByTestId('editor-force-count').textContent).toContain('有主城池 2 座');

    fireEvent.change(screen.getByLabelText('地图名'), { target: { value: '缺字段老图' } });
    fireEvent.click(screen.getByTestId('editor-save-cache'));

    const payload = onSave.mock.calls[0][0] as EditorMapPayload;
    // 没有 plotsSpecified 的老图：打开时按开局同一口径自动补一份（两城各一中城档）
    expect(payload.plots).toHaveLength(PLOT_COUNT_BY_SIZE.medium * 2);
    // 没有 facilities 字段 → 空设施，而不是 undefined
    expect(payload.facilities).toEqual([]);
    expect(payload.plotsSpecified).toBe(true);
  });
});
