import type { ForceId, GridCell } from '../types';
import rawMap from './maps/china42x.json';

/**
 * 内置地图（china42x.json）的统一读取入口。
 *
 * 该文件存在两种形态，历史上的读取方只认第一种，导致「编辑器里显示对、进游戏就乱」：
 * - **schemaVersion 1 原版格式**：`cities` / `passes` / `ports` 三个独立数组，
 *   建设用地坐标挂在各城的 `interior: [q, r][]` 上；
 * - **schemaVersion 2 编辑器导出格式**：关隘并入 `cities` 并用 `type: 'pass'` 区分，
 *   建设用地提升为顶层 `plots: { cityId, q, r }[]`，不再有 `interior` / `passes` / `ports`。
 *
 * 因此所有消费方（剧本创建、关隘锚点、地图渲染）都必须经由本模块取值，
 * 不要直接 import JSON 后假设某个字段存在。
 */

export interface China42CityEntry {
  id: string;
  label: string;
  q: number;
  r: number;
  /** 编辑器导出格式下才有：区分城池与关隘 */
  type?: 'city' | 'pass';
  forceId?: ForceId | null;
  /** 原版建设用地坐标（interior 平面，按距城心由近到远排序）；编辑器导出格式下不存在 */
  interior?: Array<[number, number]>;
}

export interface China42Anchor {
  id: string;
  label: string;
  q: number;
  r: number;
}

interface RawBuiltinMap {
  schemaVersion?: number;
  width: number;
  height: number;
  grid?: Array<{ q: number; r: number; terrain: string }>;
  cities?: China42CityEntry[];
  passes?: China42Anchor[];
  ports?: China42Anchor[];
  plots?: Array<{ cityId: string; q: number; r: number }>;
}

const data = rawMap as unknown as RawBuiltinMap;

export const BUILTIN_MAP_WIDTH = data.width;
export const BUILTIN_MAP_HEIGHT = data.height;

/** 全部据点标记（城池 + 关隘混排，按 id 查城址时用） */
export function builtinRawCities(): China42CityEntry[] {
  return data.cities ?? [];
}

/** 仅城池标记 */
export function builtinCityMarkers(): China42CityEntry[] {
  return builtinRawCities().filter((city) => (city.type ?? 'city') === 'city');
}

/** 关隘锚点：优先独立的 passes 数组，其次从 cities 里按 type==='pass' 还原（编辑器导出格式） */
export function builtinPassAnchors(): China42Anchor[] {
  if (Array.isArray(data.passes) && data.passes.length > 0) return data.passes;
  return builtinRawCities()
    .filter((city) => city.type === 'pass')
    .map(({ id, label, q, r }) => ({ id, label, q, r }));
}

/** 港口锚点（仅原版格式携带；编辑器不编辑港口，导出时不会保留） */
export function builtinPortAnchors(): China42Anchor[] {
  return data.ports ?? [];
}

export function builtinGrid(): GridCell[] {
  return (data.grid ?? []).map((cell) => ({ q: cell.q, r: cell.r, terrain: cell.terrain as GridCell['terrain'] }));
}

/** 各城建设用地坐标：优先该城 `interior`，缺失时回退到顶层 `plots` 按 cityId 分组 */
export function builtinInteriorByCityId(): Map<string, Array<{ q: number; r: number }>> {
  const fromPlots = new Map<string, Array<{ q: number; r: number }>>();
  for (const plot of data.plots ?? []) {
    const list = fromPlots.get(plot.cityId);
    if (list) list.push({ q: plot.q, r: plot.r });
    else fromPlots.set(plot.cityId, [{ q: plot.q, r: plot.r }]);
  }

  const result = new Map<string, Array<{ q: number; r: number }>>();
  for (const city of builtinRawCities()) {
    const interior = Array.isArray(city.interior)
      ? city.interior
        .filter((entry): entry is [number, number] =>
          Array.isArray(entry) && entry.length >= 2 && Number.isInteger(entry[0]) && Number.isInteger(entry[1]))
        .map(([q, r]) => ({ q, r }))
      : [];
    if (interior.length > 0) result.set(city.id, interior);
    else if (fromPlots.has(city.id)) result.set(city.id, fromPlots.get(city.id)!);
  }
  return result;
}
