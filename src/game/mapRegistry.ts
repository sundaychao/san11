import type { EditorMapPayload, EditorStrongholdMarker } from './map-editor/editor';
import {
  createScenarioCities,
  getChina42Grid,
  china42Passes,
} from './scenario/jingxiang208';
import china42Data from './scenario/china42x.json';

/** 可用地图条目：内置图 + 本会话导入/新建的自定义地图（刷新即逝，需重新导入 JSON） */
export interface SessionMap {
  id: string;
  name: string;
  builtin: boolean;
  payload: EditorMapPayload;
}

export const BUILTIN_MAP_CHINA42_ID = 'china42x';

const sessionMaps: SessionMap[] = [];
let builtinLoaded = false;

function loadBuiltinMaps(): void {
  if (builtinLoaded) return;
  builtinLoaded = true;

  const cityMarkers: EditorStrongholdMarker[] = Object.values(createScenarioCities()).map((city) => ({
    id: city.id,
    label: city.name,
    q: city.gridQ,
    r: city.gridR,
    type: 'city',
    forceId: city.ownerId,
  }));
  const passMarkers: EditorStrongholdMarker[] = china42Passes().map((p) => ({
    id: p.id,
    label: p.label,
    q: p.q,
    r: p.r,
    type: 'pass',
    forceId: null,
  }));

  sessionMaps.push({
    id: BUILTIN_MAP_CHINA42_ID,
    name: '荆襄地图',
    builtin: true,
    payload: {
      schemaVersion: 2,
      width: china42Data.width,
      height: china42Data.height,
      backgroundImage: '',
      grid: getChina42Grid(),
      cities: [...cityMarkers, ...passMarkers],
    },
  });
}

/** 注册内置荆襄大地图（只载入一次）。自定义图在会话内累加至此列表。 */
export function registerBuiltinMaps(loadOnce = true): void {
  if (loadOnce && builtinLoaded) return;
  loadBuiltinMaps();
}

/** 返回当前全部可用地图（含内置图） */
export function listMaps(): SessionMap[] {
  loadBuiltinMaps();
  return [...sessionMaps];
}

export function getMap(id: string): SessionMap | undefined {
  loadBuiltinMaps();
  return sessionMaps.find((map) => map.id === id);
}

/** 新增自定义地图，返回其 id */
export function addSessionMap(payload: EditorMapPayload, name: string): string {
  const id = `custom-${Date.now()}`;
  sessionMaps.push({ id, name, builtin: false, payload });
  return id;
}

/** 更新已存在的自定义地图 */
export function updateSessionMap(id: string, payload: EditorMapPayload): void {
  const index = sessionMaps.findIndex((map) => map.id === id);
  if (index !== -1) {
    sessionMaps[index] = { ...sessionMaps[index], payload, name: payload.name ?? sessionMaps[index].name };
  }
}