import { CITY_IDS, FORCE_IDS, OFFICER_IDS } from './scenario/jingxiang208';
import { ARMAMENT_TYPES } from './armaments';
import type { ArmyUnit, ArmamentType, BattleDamageReport, City, CityEffectReport, Force, GameState, GridCell, Officer, Stats } from './types';

export const AUTO_SAVE_KEY = 'jingxiang-208-autosave-v1';
export const MANUAL_SAVE_KEY = 'jingxiang-208-manual-v1';

export type SaveSlot = 'auto' | 'manual';

const TROOP_TYPES = ['sword', 'spear', 'halberd', 'crossbow', 'cavalry', 'siege'];
const APTITUDE_GRADES = ['S', 'A', 'B', 'C'];

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
  const armaments = city.armaments as Record<string, unknown> | undefined;
  return (
    typeof city.id === 'string' &&
    typeof city.name === 'string' &&
    FORCE_IDS.includes(city.ownerId!) &&
    (city.governorId === null || typeof city.governorId === 'string') &&
    validResource(city.gold) &&
    validResource(city.food) &&
    validResource(city.population) &&
    validResource(city.troops) &&
    validPercentage(city.commerce) &&
    validPercentage(city.agriculture) &&
    validPercentage(city.order) &&
    validPercentage(city.training) &&
    finite(city.mapX) && city.mapX >= 0 && city.mapX <= 1 &&
    finite(city.mapY) && city.mapY >= 0 && city.mapY <= 1 &&
    Number.isInteger(city.gridQ) && city.gridQ! >= 0 &&
    Number.isInteger(city.gridR) && city.gridR! >= 0 &&
    validResource(city.maxDurability) &&
    validResource(city.durability) &&
    city.durability! <= city.maxDurability! &&
    (armaments === undefined || (
      exactKeys(armaments, ARMAMENT_TYPES) &&
      ARMAMENT_TYPES.every((type) => validResource(armaments[type]) && Number.isInteger(armaments[type]))
    ))
  );
}

function validOfficerLocation(location: unknown) {
  if (!location || typeof location !== 'object') return false;
  const value = location as Record<string, unknown>;
  if (value.kind === 'unit') return typeof value.unitId === 'string';
  if (value.kind === 'city' || value.kind === 'unaffiliated') return CITY_IDS.includes(value.cityId as City['id']);
  if (value.kind === 'task') return CITY_IDS.includes(value.cityId as City['id']) &&
    ARMAMENT_TYPES.includes(value.armamentType as ArmamentType) &&
    value.task === 'armament' &&
    Number.isInteger(value.amount) && Number(value.amount) >= 0 &&
    Number.isInteger(value.remainingTenDays) && Number(value.remainingTenDays) > 0;
  return value.kind === 'transfer' &&
    CITY_IDS.includes(value.fromCityId as City['id']) &&
    CITY_IDS.includes(value.targetCityId as City['id']) &&
    Number.isInteger(value.remainingTenDays) &&
    Number(value.remainingTenDays) > 0;
}

function validOfficerAptitudes(value: unknown) {
  if (!value || typeof value !== 'object') return false;
  const aptitudes = value as Record<string, unknown>;
  return exactKeys(aptitudes, ['spear', 'halberd', 'crossbow', 'cavalry', 'siege', 'navy']) &&
    Object.values(aptitudes).every((grade) => APTITUDE_GRADES.includes(String(grade)));
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
    validOfficerLocation(officer.location) &&
    typeof officer.acted === 'boolean' &&
    (officer.skill === undefined || typeof officer.skill === 'string') &&
    (officer.aptitudes === undefined || validOfficerAptitudes(officer.aptitudes)) &&
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

function validGridCell(value: unknown): value is GridCell {
  if (!value || typeof value !== 'object') return false;
  const cell = value as Partial<GridCell>;
  return Number.isInteger(cell.q) && cell.q! >= 0 &&
    Number.isInteger(cell.r) && cell.r! >= 0 &&
    ['road', 'plain', 'forest', 'hill', 'mountain', 'shallowWater', 'deepWater'].includes(cell.terrain!);
}

function validUnit(value: unknown): value is ArmyUnit {
  if (!value || typeof value !== 'object') return false;
  const unit = value as Partial<ArmyUnit>;
  return typeof unit.id === 'string' &&
    FORCE_IDS.includes(unit.forceId!) &&
    (unit.kind === undefined || unit.kind === 'combat' || unit.kind === 'transport') &&
    typeof unit.leaderId === 'string' &&
    CITY_IDS.includes(unit.homeCityId!) &&
    (unit.troopType === undefined || TROOP_TYPES.includes(unit.troopType)) &&
    (unit.gold === undefined || validResource(unit.gold)) &&
    Number.isInteger(unit.q) &&
    Number.isInteger(unit.r) &&
    validResource(unit.troops) &&
    validResource(unit.food) &&
    validResource(unit.energy) &&
    unit.energy! <= 100 &&
    validResource(unit.movementRemaining) &&
    typeof unit.moved === 'boolean' &&
    typeof unit.acted === 'boolean';
}

function validBattleDamageReport(value: unknown): value is BattleDamageReport {
  if (!value || typeof value !== 'object') return false;
  const report = value as Partial<BattleDamageReport>;
  return typeof report.id === 'string' &&
    typeof report.unitId === 'string' &&
    Number.isInteger(report.q) &&
    Number.isInteger(report.r) &&
    typeof report.amount === 'number' &&
    Number.isInteger(report.amount) &&
    report.amount >= 0 &&
    (report.kind === 'attack' || report.kind === 'counter');
}

function validCityEffectReport(value: unknown): value is CityEffectReport {
  if (!value || typeof value !== 'object') return false;
  const report = value as Partial<CityEffectReport>;
  return typeof report.id === 'string' &&
    CITY_IDS.includes(report.cityId!) &&
    Number.isInteger(report.q) &&
    Number.isInteger(report.r) &&
    typeof report.amount === 'number' &&
    Number.isInteger(report.amount) &&
    report.amount >= 0 &&
    typeof report.label === 'string' &&
    (report.kind === 'recruit' || report.kind === 'armament');
}

export function isGameState(value: unknown): value is GameState {
  if (!value || typeof value !== 'object') return false;
  const state = value as Partial<GameState>;
  if (
    state.schemaVersion !== 2 ||
    state.scenarioId !== 'jingxiang-208' ||
    !Number.isInteger(state.month) ||
    state.month! < 1 ||
    state.month! > 24 ||
    ![1, 2, 3].includes(state.tenDay!) ||
    !FORCE_IDS.includes(state.turnForceId!) ||
    !FORCE_IDS.includes(state.playerForceId!) ||
    !['playing', 'finished'].includes(state.phase!) ||
    !state.cities ||
    !state.officers ||
    !state.actionPoints ||
    !state.forces ||
    !Array.isArray(state.grid) ||
    !state.units ||
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
  const validOfficerReferences = (officer: Officer) => {
    if (!CITY_IDS.includes(officer.cityId)) return false;
    if (officer.location.kind === 'unit') return Boolean(state.units![officer.location.unitId]);
    if (officer.location.kind === 'transfer') {
      return officer.forceId !== null &&
        CITY_IDS.includes(officer.location.fromCityId) &&
        CITY_IDS.includes(officer.location.targetCityId) &&
        cityById[officer.location.fromCityId].ownerId === officer.forceId &&
        cityById[officer.location.targetCityId].ownerId === officer.forceId;
    }
    return CITY_IDS.includes(officer.location.cityId);
  };
  return (
    cities.every((city) => validCity(city) && cityById[city.id] === city &&
      (city.governorId === null || (
        Boolean(officerById[city.governorId]) &&
        officerById[city.governorId].forceId === city.ownerId &&
        officerById[city.governorId].cityId === city.id
      ))) &&
    officers.every((officer) => validOfficer(officer) && officerById[officer.id] === officer &&
      CITY_IDS.includes(officer.cityId) &&
      (officer.forceId === null || cityById[officer.cityId].ownerId === officer.forceId) &&
      validOfficerReferences(officer)) &&
    state.grid.every(validGridCell) &&
    Object.values(state.units).every((unit) => validUnit(unit) && state.units![unit.id] === unit &&
      Boolean(officerById[unit.leaderId])) &&
    (state.battleDamageReports === undefined || (
      Array.isArray(state.battleDamageReports) &&
      state.battleDamageReports.every(validBattleDamageReport)
    )) &&
    (state.cityEffectReports === undefined || (
      Array.isArray(state.cityEffectReports) &&
      state.cityEffectReports.every(validCityEffectReport)
    )) &&
    FORCE_IDS.every((forceId) => Number.isInteger(state.actionPoints![forceId]) && validResource(state.actionPoints![forceId]) &&
      state.actionPoints![forceId] <= 160 && validForce(state.forces![forceId]) &&
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
    if (parsed?.schemaVersion !== 2) return { ok: false, reason: '存档版本不兼容' };
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

export function clearSave(storage: SaveAdapter, slot: SaveSlot) {
  storage.removeItem(keyFor(slot));
}
