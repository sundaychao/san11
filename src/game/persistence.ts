import { CITY_IDS, FORCE_IDS, OFFICER_IDS } from './scenario/jingxiang208';
import type { City, Force, GameState, Officer, Stats } from './types';

export const AUTO_SAVE_KEY = 'jingxiang-208-autosave-v1';
export const MANUAL_SAVE_KEY = 'jingxiang-208-manual-v1';

export type SaveSlot = 'auto' | 'manual';

export interface SaveAdapter {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export type LoadResult =
  | { ok: true; state: GameState }
  | { ok: false; reason: '没有存档' | '存档无法读取' | '存档版本不兼容' };

function keyFor(slot: SaveSlot) {
  return slot === 'auto' ? AUTO_SAVE_KEY : MANUAL_SAVE_KEY;
}

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function validPercentage(value: unknown) {
  return finite(value) && value >= 0 && value <= 100;
}

function validResource(value: unknown) {
  return finite(value) && value >= 0;
}

function exactKeys(value: object, expected: readonly string[]) {
  const keys = Object.keys(value);
  return keys.length === expected.length && expected.every((key) => Object.hasOwn(value, key));
}

function validCity(value: unknown): value is City {
  if (!value || typeof value !== 'object') return false;
  const city = value as Partial<City>;
  return (
    typeof city.id === 'string' &&
    typeof city.name === 'string' &&
    FORCE_IDS.includes(city.ownerId!) &&
    typeof city.governorId === 'string' &&
    validResource(city.gold) &&
    validResource(city.food) &&
    validResource(city.population) &&
    validResource(city.troops) &&
    validPercentage(city.commerce) &&
    validPercentage(city.agriculture) &&
    validPercentage(city.order) &&
    validPercentage(city.training) &&
    finite(city.mapX) && city.mapX >= 0 && city.mapX <= 1 &&
    finite(city.mapY) && city.mapY >= 0 && city.mapY <= 1
  );
}

function validOfficer(value: unknown): value is Officer {
  if (!value || typeof value !== 'object') return false;
  const officer = value as Partial<Officer>;
  const stats = officer.stats;
  return (
    typeof officer.id === 'string' &&
    typeof officer.name === 'string' &&
    (officer.forceId === null || FORCE_IDS.includes(officer.forceId!)) &&
    typeof officer.cityId === 'string' &&
    typeof officer.acted === 'boolean' &&
    Boolean(stats) &&
    exactKeys(stats!, ['leadership', 'war', 'intelligence', 'politics', 'charisma'] satisfies Array<keyof Stats>) &&
    Object.values(stats!).every((stat) => finite(stat) && stat >= 1 && stat <= 100)
  );
}

function validForce(value: unknown): value is Force {
  if (!value || typeof value !== 'object') return false;
  const force = value as Partial<Force>;
  return typeof force.id === 'string' && FORCE_IDS.includes(force.id as Force['id']) &&
    typeof force.name === 'string' && typeof force.leaderId === 'string' &&
    typeof force.color === 'string' && typeof force.description === 'string';
}

export function isGameState(value: unknown): value is GameState {
  if (!value || typeof value !== 'object') return false;
  const state = value as Partial<GameState>;
  if (
    state.schemaVersion !== 1 ||
    state.scenarioId !== 'jingxiang-208' ||
    !Number.isInteger(state.month) ||
    state.month! < 1 ||
    state.month! > 24 ||
    !FORCE_IDS.includes(state.playerForceId!) ||
    !['playing', 'finished'].includes(state.phase!) ||
    !state.cities ||
    !state.officers ||
    !state.actionPoints ||
    !state.forces ||
    !Array.isArray(state.logs) ||
    !Number.isSafeInteger(state.seed) || state.seed! < 0 || state.seed! > 0xffffffff ||
    !Number.isInteger(state.rngCursor) ||
    state.rngCursor! < 0 || !Number.isSafeInteger(state.rngCursor) ||
    (state.phase === 'finished' && state.month !== 24)
  ) return false;

  if (!exactKeys(state.cities, CITY_IDS) || !exactKeys(state.officers, OFFICER_IDS) ||
      !exactKeys(state.actionPoints, FORCE_IDS) || !exactKeys(state.forces, FORCE_IDS)) return false;

  const cities = Object.values(state.cities);
  const officers = Object.values(state.officers);
  const cityById = state.cities;
  const officerById = state.officers;
  return (
    cities.every((city) => validCity(city) && cityById[city.id] === city &&
      Boolean(officerById[city.governorId]) &&
      officerById[city.governorId].forceId === city.ownerId &&
      officerById[city.governorId].cityId === city.id) &&
    officers.every((officer) => validOfficer(officer) && officerById[officer.id] === officer &&
      CITY_IDS.includes(officer.cityId) &&
      (officer.forceId === null || cityById[officer.cityId].ownerId === officer.forceId)) &&
    FORCE_IDS.every((forceId) => Number.isInteger(state.actionPoints![forceId]) && validResource(state.actionPoints![forceId]) &&
      state.actionPoints![forceId] <= 80 && validForce(state.forces![forceId]) &&
      state.forces![forceId].id === forceId &&
      officerById[state.forces![forceId].leaderId]?.forceId === forceId) &&
    state.logs.every((log) => Boolean(log) && typeof log.id === 'string' && typeof log.message === 'string' &&
      Number.isInteger(log.month) && log.month >= 1 && log.month <= 24 &&
      (log.forceId === null || FORCE_IDS.includes(log.forceId)))
  );
}

export function writeSave(storage: SaveAdapter, slot: SaveSlot, state: GameState) {
  if (!isGameState(state)) throw new Error('拒绝写入无效存档');
  storage.setItem(keyFor(slot), JSON.stringify(state));
}

export function loadSave(storage: SaveAdapter, slot: SaveSlot): LoadResult {
  const raw = storage.getItem(keyFor(slot));
  if (raw === null) return { ok: false, reason: '没有存档' };
  try {
    const parsed = JSON.parse(raw) as { schemaVersion?: unknown };
    if (parsed?.schemaVersion !== 1) return { ok: false, reason: '存档版本不兼容' };
    if (!isGameState(parsed)) return { ok: false, reason: '存档无法读取' };
    return { ok: true, state: parsed };
  } catch {
    return { ok: false, reason: '存档无法读取' };
  }
}

export function clearSaves(storage: SaveAdapter) {
  storage.removeItem(AUTO_SAVE_KEY);
  storage.removeItem(MANUAL_SAVE_KEY);
}
