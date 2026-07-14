import { FORCE_IDS } from './scenario/jingxiang208';
import type { City, GameState, Officer } from './types';

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
    Object.values(stats!).every((stat) => finite(stat) && stat >= 1 && stat <= 100)
  );
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
    !finite(state.seed) ||
    !Number.isInteger(state.rngCursor) ||
    state.rngCursor! < 0
  ) return false;

  const cities = Object.values(state.cities);
  const officers = Object.values(state.officers);
  return (
    cities.length === 8 &&
    cities.every(validCity) &&
    officers.length === 24 &&
    officers.every(validOfficer) &&
    FORCE_IDS.every((forceId) => validResource(state.actionPoints![forceId]) && Boolean(state.forces![forceId])) &&
    state.logs.every((log) => Boolean(log) && typeof log.id === 'string' && typeof log.message === 'string' && finite(log.month))
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
