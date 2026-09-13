import { CITY_IDS, FORCE_IDS, OFFICER_IDS, china42InteriorByCityId, createScenarioCities } from './scenario/jingxiang208';
import { createScenarioPasses, PASS_IDS } from './passes';
import { createMobileDuelGrid } from './scenario/mobileDuel';
import { ARMAMENT_TYPES } from './armaments';
import type { ArmyUnit, ArmamentType, BattleDamageReport, City, CityEffectReport, CityId, DiplomacyAction, Facility, FacilityRepairReport, FirePlot, Force, GameState, GridCell, Officer, Pass, PassId, Stats, StrategyResultReport, TechNodeId } from './types';
import china42Data from './scenario/china42.json';
import china42xData from './scenario/maps/china42x.json';
import { initConstructionPlots } from './innerAffairs';
import { DIPLOMACY_ACTIONS, NEUTRAL_DIPLOMACY, clampDiplomacy } from './diplomacy';

export const AUTO_SAVE_KEY = 'jingxiang-208-autosave-v1';
export const MANUAL_SAVE_KEY = 'jingxiang-208-manual-v1';

/**
 * 当前存档结构版本。改动 `GameState` 字段的**语义**（不是新增可选字段）时必须递增，
 * 并在 `migrateSaveToCurrent` 里补上对应迁移，否则旧档会以错误语义被读取。
 */
export const SCHEMA_VERSION = 3;

export type SaveSlot = 'auto' | 'manual';

const TROOP_TYPES = ['sword', 'spear', 'halberd', 'crossbow', 'cavalry', 'siege'];
/** 合法野外设施类型（与 game/types.ts 的 FacilityType 同步；新增设施时必须同步此白名单，否则新档会被判为无效） */
const FACILITY_TYPES = [
  'drum', 'arrowTower', 'crossbowTower', 'catapultTower', 'musicTower',
  'formation', 'fort', 'fortress', 'earthwork', 'stoneWall',
  'fireSeed', 'fireBall', 'hellfireSeed', 'hellfireBall',
];
const APTITUDE_GRADES = ['S++', 'S+', 'S', 'A', 'B', 'C'];
const STRATEGY_IDS = ['fire', 'extinguish', 'false-report', 'disturb', 'calm', 'inspire', 'discord'];
const MOBILE_DUEL_CITY_IDS = ['xiangyang', 'jiangling'];
/** 部队士气上限：基础 100 + 科技「职业化」20（见 game/techs.ts 的 energyCapOf） */
const MAX_UNIT_ENERGY = 120;
/** 据点士气（训练度）上限：与部队士气同口径，基础 100 + 科技「职业化」20（见 game/techs.ts 的 moraleCapOf） */
const MAX_STRONGHOLD_MORALE = 120;
/** 全部合法地形值（含原版 20 值细分地形 + 旧手绘地图兼容值） */
const TERRAIN_VALUES = [
  'road', 'path', 'plank', 'plain', 'grass', 'sand', 'wasteland', 'wetland', 'poison',
  'forest', 'hill', 'mountain', 'shore', 'water', 'stream', 'river', 'sea', 'shallow',
  'ferry', 'pass', 'construction',
];

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

/** 据点士气（0 ~ MAX_STRONGHOLD_MORALE）：科技「职业化」会把上限抬到 120，不能用 validPercentage 卡 100 */
function validMorale(value: unknown) {
  return finite(value) && value >= 0 && value <= MAX_STRONGHOLD_MORALE;
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
    (city.ownerId === null || FORCE_IDS.includes(city.ownerId!)) &&
    (city.governorId === null || typeof city.governorId === 'string') &&
    validResource(city.gold) &&
    validResource(city.food) &&
    validResource(city.population) &&
    validResource(city.troops) &&
    validPercentage(city.commerce) &&
    validPercentage(city.agriculture) &&
    validPercentage(city.order) &&
    validMorale(city.training) &&
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

function validPass(value: unknown, custom?: boolean): value is Pass {
  if (!value || typeof value !== 'object') return false;
  const pass = value as Partial<Pass>;
  const armaments = pass.armaments as Record<string, unknown> | undefined;
  return (
    typeof pass.id === 'string' &&
    typeof pass.name === 'string' &&
    (custom || CITY_IDS.includes(pass.homeCityId as CityId)) &&
    (pass.ownerId === null || FORCE_IDS.includes(pass.ownerId!)) &&
    (pass.governorId === null || typeof pass.governorId === 'string') &&
    validResource(pass.gold) &&
    validResource(pass.food) &&
    validResource(pass.population) &&
    validResource(pass.troops) &&
    validMorale(pass.training) &&
    validPercentage(pass.order) &&
    (pass.durability === undefined || (
      validResource(pass.durability) &&
      validResource(pass.maxDurability) &&
      pass.durability! <= pass.maxDurability!
    )) &&
    Number.isInteger(pass.q) && pass.q! >= 0 &&
    Number.isInteger(pass.r) && pass.r! >= 0 &&
    Array.isArray(pass.flankKeys) &&
    pass.flankKeys!.every((key) => typeof key === 'string') &&
    (armaments === undefined || (
      exactKeys(armaments, ARMAMENT_TYPES) &&
      ARMAMENT_TYPES.every((type) => validResource(armaments[type]) && Number.isInteger(armaments[type]))
    ))
  );
}

function validOfficerLocation(location: unknown, custom?: boolean) {
  if (!location || typeof location !== 'object') return false;
  const value = location as Record<string, unknown>;
  const cityRef = (cityId: unknown) => typeof cityId === 'string' && (custom || CITY_IDS.includes(cityId as City['id']));
  const passRef = (passId: unknown) => typeof passId === 'string' && (custom || PASS_IDS.includes(passId as PassId));
  if (value.kind === 'unit') return typeof value.unitId === 'string';
  if (value.kind === 'city' || value.kind === 'unaffiliated') return cityRef(value.cityId);
  if (value.kind === 'pass') return passRef(value.passId);
  if (value.kind === 'task') {
    const validPassId = value.passId === undefined || passRef(value.passId);
    const validCity = cityRef(value.cityId) &&
      Number.isInteger(value.remainingTenDays) && Number(value.remainingTenDays) > 0;
    if (!validPassId || !validCity) return false;
    if (value.task === 'armament') {
      return ARMAMENT_TYPES.includes(value.armamentType as ArmamentType) &&
        Number.isInteger(value.amount) && Number(value.amount) >= 0;
    }
    if (value.task === 'research') return typeof value.nodeId === 'string';
    if (value.task === 'cultivate') return typeof value.nodeId === 'string';
    if (value.task === 'construction') {
      return typeof value.facility === 'string' && Number.isInteger(value.plotIndex) && Number(value.plotIndex) >= 0;
    }
    return false;
  }
  if (value.kind === 'envoy') {
    return cityRef(value.fromCityId) &&
      (value.fromPassId === undefined || passRef(value.fromPassId)) &&
      typeof value.targetForceId === 'string' &&
      DIPLOMACY_ACTIONS.includes(value.action as DiplomacyAction) &&
      (value.phase === 'outbound' || value.phase === 'return') &&
      Number.isInteger(value.outboundTenDays) && Number(value.outboundTenDays) > 0 &&
      Number.isInteger(value.returnTenDays) && Number(value.returnTenDays) > 0 &&
      Number.isInteger(value.remainingTenDays) && Number(value.remainingTenDays) > 0;
  }
  return value.kind === 'transfer' &&
    cityRef(value.fromCityId) &&
    cityRef(value.targetCityId) &&
    (value.fromPassId === undefined || passRef(value.fromPassId)) &&
    (value.targetPassId === undefined || passRef(value.targetPassId)) &&
    Number.isInteger(value.remainingTenDays) &&
    Number(value.remainingTenDays) > 0;
}

function validOfficerAptitudes(value: unknown) {
  if (!value || typeof value !== 'object') return false;
  const aptitudes = value as Record<string, unknown>;
  return exactKeys(aptitudes, ['spear', 'halberd', 'crossbow', 'cavalry', 'siege', 'navy']) &&
    Object.values(aptitudes).every((grade) => APTITUDE_GRADES.includes(String(grade)));
}

function validOfficer(value: unknown, custom?: boolean): value is Officer {
  if (!value || typeof value !== 'object') return false;
  const officer = value as Partial<Officer>;
  const stats = officer.stats;
  return (
    typeof officer.id === 'string' &&
    typeof officer.name === 'string' &&
    (officer.forceId === null || FORCE_IDS.includes(officer.forceId!)) &&
    typeof officer.cityId === 'string' &&
    validOfficerLocation(officer.location, custom) &&
    typeof officer.acted === 'boolean' &&
    (officer.skill === undefined || typeof officer.skill === 'string') &&
    (officer.learnedSkills === undefined ||
      (Array.isArray(officer.learnedSkills) && officer.learnedSkills.every((skill) => typeof skill === 'string'))) &&
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
    TERRAIN_VALUES.includes(cell.terrain!);
}

/** 部队随身兵装（可缺省，旧存档没有该字段）：只校验出现过的键与取值 */
function validCarriedArmaments(value: unknown): boolean {
  if (value === undefined) return true;
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return Object.entries(record).every(([type, amount]) => (
    ARMAMENT_TYPES.includes(type as ArmamentType) && validResource(amount)
  ));
}

function validUnit(value: unknown, custom?: boolean): value is ArmyUnit {  if (!value || typeof value !== 'object') return false;
  const unit = value as Partial<ArmyUnit>;
  const validStatus = (status: unknown) => status === undefined || (Number.isInteger(status) && Number(status) > 0);
  return typeof unit.id === 'string' &&
    FORCE_IDS.includes(unit.forceId!) &&
    (unit.kind === undefined || unit.kind === 'combat' || unit.kind === 'transport') &&
    typeof unit.leaderId === 'string' &&
    (custom || CITY_IDS.includes(unit.homeCityId!)) &&
    (unit.troopType === undefined || TROOP_TYPES.includes(unit.troopType)) &&
    (unit.vehicle === undefined || unit.vehicle === 'boat' || unit.vehicle === 'ship') &&
    (unit.siegeWeapon === undefined || unit.siegeWeapon === 'ram' || unit.siegeWeapon === 'tower') &&
    (unit.gold === undefined || validResource(unit.gold)) &&
    validCarriedArmaments(unit.armaments) &&
    Number.isInteger(unit.q) &&
    Number.isInteger(unit.r) &&
    validResource(unit.troops) &&
    validResource(unit.food) &&
    validResource(unit.energy) &&
    // 士气（气力）上限为基础 100，科技「职业化」再 +20（对齐 game/techs.ts 的 energyCapOf）
    unit.energy! <= MAX_UNIT_ENERGY &&
    validResource(unit.movementRemaining) &&
    validStatus(unit.confusedTenDays) &&
    validStatus(unit.falseReportedTenDays) &&
    validStatus(unit.burningTenDays) &&
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
    (report.kind === 'attack' || report.kind === 'counter' || report.kind === 'jointAttack') &&
    (report.critical === undefined || typeof report.critical === 'boolean') &&
    (report.label === undefined || typeof report.label === 'string');
}

function validCityEffectReport(value: unknown): value is CityEffectReport {
  if (!value || typeof value !== 'object') return false;
  const report = value as Partial<CityEffectReport>;
  return typeof report.id === 'string' &&
    CITY_IDS.includes(report.cityId!) &&
    (report.passId === undefined || typeof report.passId === 'string') &&
    Number.isInteger(report.q) &&
    Number.isInteger(report.r) &&
    typeof report.amount === 'number' &&
    Number.isInteger(report.amount) &&
    report.amount >= 0 &&
    typeof report.label === 'string' &&
    (report.kind === 'recruit' || report.kind === 'armament' || report.kind === 'train' || report.kind === 'patrol');
}

function validFacilityRepairReport(value: unknown): value is FacilityRepairReport {
  if (!value || typeof value !== 'object') return false;
  const report = value as Partial<FacilityRepairReport>;
  return typeof report.id === 'string' &&
    typeof report.facilityId === 'string' &&
    Number.isInteger(report.q) &&
    Number.isInteger(report.r) &&
    typeof report.amount === 'number' &&
    Number.isInteger(report.amount) &&
    report.amount >= 0 &&
    (report.kind === 'build' || report.kind === 'repair');
}

function validStrategyResultReport(value: unknown): value is StrategyResultReport {
  if (!value || typeof value !== 'object') return false;
  const report = value as Partial<StrategyResultReport>;
  return typeof report.id === 'string' &&
    STRATEGY_IDS.includes(report.strategyId!) &&
    Number.isInteger(report.q) &&
    Number.isInteger(report.r) &&
    typeof report.label === 'string' &&
    typeof report.succeeded === 'boolean';
}

function validFirePlot(value: unknown): value is FirePlot {
  if (!value || typeof value !== 'object') return false;
  const plot = value as Partial<FirePlot>;
  return Number.isInteger(plot.q) && plot.q! >= 0 &&
    Number.isInteger(plot.r) && plot.r! >= 0 &&
    (plot.remainingTenDays === undefined || (
      Number.isInteger(plot.remainingTenDays) &&
      plot.remainingTenDays >= 1 &&
      // 普通陷阱火 1~3 旬，业火种/业火球点燃的业火 2~4 旬
      plot.remainingTenDays <= 4
    ));
}

function validFacility(value: unknown): value is Facility {
  if (!value || typeof value !== 'object') return false;
  const facility = value as Partial<Facility>;
  return typeof facility.id === 'string' &&
    FACILITY_TYPES.includes(facility.type!) &&
    FORCE_IDS.includes(facility.forceId!) &&
    Number.isInteger(facility.q) && facility.q! >= 0 &&
    Number.isInteger(facility.r) && facility.r! >= 0 &&
    validResource(facility.durability) &&
    (facility.completed === undefined || typeof facility.completed === 'boolean');
}

export function isGameState(value: unknown): value is GameState {
  if (!value || typeof value !== 'object') return false;
  const state = value as Partial<GameState>;
  const validScenario = state.scenarioId === 'jingxiang-208' || state.scenarioId === 'mobile-duel' || state.scenarioId === 'custom-map';
  if (
    state.schemaVersion !== SCHEMA_VERSION ||
    !validScenario ||
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

  const isCustom = state.scenarioId === 'custom-map';
  const expectedCityIds = state.scenarioId === 'mobile-duel' ? MOBILE_DUEL_CITY_IDS : CITY_IDS;
  if (isCustom) {
    // 自定义地图：城标记 id 可任意，仅校验势力/行动力集合与内置势力一致（沿用 4 势力）
    if (!exactKeys(state.actionPoints, FORCE_IDS) || !exactKeys(state.forces, FORCE_IDS)) return false;
  } else if (!exactKeys(state.cities, expectedCityIds) ||
      !exactKeys(state.actionPoints, FORCE_IDS) || !exactKeys(state.forces, FORCE_IDS)) return false;
  if (state.scenarioId === 'jingxiang-208') {
    if (!exactKeys(state.officers, OFFICER_IDS)) return false;
  } else if (!isCustom && !Object.keys(state.officers).every((officerId) => OFFICER_IDS.includes(officerId as (typeof OFFICER_IDS)[number]))) {
    return false;
  }

  const cities = Object.values(state.cities);
  const officers = Object.values(state.officers);
  const cityById = state.cities;
  const officerById = state.officers;
  const validOfficerReferences = (officer: Officer) => {
    if (!cityById[officer.cityId]) return false;
    if (officer.location.kind === 'unit') return Boolean(state.units![officer.location.unitId]);
    if (officer.location.kind === 'pass') return Boolean(state.passes?.[officer.location.passId]);
    if (officer.location.kind === 'transfer') {
      // fromCityId 允许已易主的城（攻城撤退武将从被占城出发）；目标据点必须仍属本方
      const targetPass = officer.location.targetPassId ? state.passes?.[officer.location.targetPassId] : undefined;
      const targetValid = targetPass
        ? targetPass.ownerId === officer.forceId
        : Boolean(cityById[officer.location.targetCityId]) && cityById[officer.location.targetCityId].ownerId === officer.forceId;
      return officer.forceId !== null &&
        Boolean(cityById[officer.location.fromCityId]) &&
        targetValid;
    }
    if (officer.location.kind === 'envoy') {
      // 出使在途：出发城允许已易主（出使途中被夺城也要能读档），只要求城仍存在且使者有归属
      return officer.forceId !== null && Boolean(cityById[officer.location.fromCityId]);
    }
    return Boolean(cityById[officer.location.cityId]);
  };
  const participatingForceIds = new Set(cities.map((city) => city.ownerId));
  return (
    cities.every((city) => validCity(city) && cityById[city.id] === city &&
      (city.governorId === null || (
        Boolean(officerById[city.governorId]) &&
        officerById[city.governorId].forceId === city.ownerId &&
        officerById[city.governorId].cityId === city.id
      ))) &&
    officers.every((officer) => validOfficer(officer, isCustom) && officerById[officer.id] === officer &&
      Boolean(cityById[officer.cityId]) &&
      // 俘虏关押在敌方城，cityId 不要求属本方；关隘驻将按关隘归属校验。
      // 出使在途的使者同理：出发城可能在途中被敌方攻占，此时仍要能存读档（返程时由 settleEnvoys 改回本方据点）。
      (officer.location.kind === 'captive' || officer.location.kind === 'envoy' || officer.forceId === null ||
        (officer.location.kind === 'pass'
          ? Boolean(state.passes?.[officer.location.passId]) && state.passes![officer.location.passId].ownerId === officer.forceId
          : cityById[officer.cityId].ownerId === officer.forceId)) &&
      validOfficerReferences(officer)) &&
    Object.values(state.passes ?? {}).every((pass) => {
      if (!validPass(pass, isCustom)) return false;
      if (pass.governorId === null) return true;
      const governor = officerById[pass.governorId];
      return Boolean(governor) &&
        governor.forceId === pass.ownerId &&
        governor.location.kind === 'pass' &&
        governor.location.passId === pass.id;
    }) &&
    state.grid.every(validGridCell) &&
    Object.values(state.units).every((unit) => validUnit(unit, isCustom) && state.units![unit.id] === unit &&
      Boolean(officerById[unit.leaderId])) &&
    (state.battleDamageReports === undefined || (
      Array.isArray(state.battleDamageReports) &&
      state.battleDamageReports.every(validBattleDamageReport)
    )) &&
    (state.cityEffectReports === undefined || (
      Array.isArray(state.cityEffectReports) &&
      state.cityEffectReports.every(validCityEffectReport)
    )) &&
    (state.facilityRepairReports === undefined || (
      Array.isArray(state.facilityRepairReports) &&
      state.facilityRepairReports.every(validFacilityRepairReport)
    )) &&
    (state.strategyResultReports === undefined || (
      Array.isArray(state.strategyResultReports) &&
      state.strategyResultReports.every(validStrategyResultReport)
    )) &&
    (state.firePlots === undefined || (
      Array.isArray(state.firePlots) &&
      state.firePlots.every(validFirePlot)
    )) &&
    (state.facilities === undefined || (
      Object.values(state.facilities).every((facility) => validFacility(facility) && state.facilities![facility.id] === facility)
    )) &&
    FORCE_IDS.every((forceId) => Number.isInteger(state.actionPoints![forceId]) && validResource(state.actionPoints![forceId]) &&
      state.actionPoints![forceId] <= 160 && validForce(state.forces![forceId]) &&
      state.forces![forceId].id === forceId &&
      (!participatingForceIds.has(forceId) || officerById[state.forces![forceId].leaderId]?.forceId === forceId)) &&
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
    const upgraded = migrateSaveToCurrent(parsed);
    if (!upgraded) return { ok: false, reason: '存档版本不兼容' };
    const injected = injectMissingCities(migrateLegacyForceTechs(upgraded));
    if (!isGameState(injected)) return { ok: false, reason: '存档无法读取' };
    const migrated = migrateTerrainGrid(injected);
    const withPasses = injectMissingPasses(migrated);
    // 荆襄剧本：注入的无主新城按原版 interior 位置补建建设用地；
    // 旧档中被规模档位截断的城（如长安12格）也在此补足至原版格数，已有地格不受影响
    if (withPasses.scenarioId === 'jingxiang-208') initConstructionPlots(withPasses, china42InteriorByCityId());
    return { ok: true, state: withPasses };
  } catch {
    return { ok: false, reason: '存档无法读取' };
  }
}

/**
 * 存档版本迁移的唯一入口：把受支持的旧版本升到 `SCHEMA_VERSION`。
 * 版本不在支持范围内（含比当前更新的版本）时返回 null，由调用方报「存档版本不兼容」。
 */
export function migrateSaveToCurrent(value: unknown): unknown {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  if (record.schemaVersion === SCHEMA_VERSION) return record;
  if (record.schemaVersion === 2) {
    migrateDiplomacyRange(record);
    record.schemaVersion = SCHEMA_VERSION;
    return record;
  }
  return null;
}

/**
 * 版本 2 → 3 的迁移：外交友好度区间由自拟的 `−100 ~ 100`（0 = 中立）
 * 改为原版《三国志11》的 `0 ~ 100`（50 = 中立），线性映射 `new = round(old / 2 + 50)`。
 *
 * 必须迁移：旧档里「中立」存的是 `0`，直接按新体系读会变成最低档「险恶」，
 * 所有势力的外交关系会整体塌到谷底。新档（版本 3）不会进入本函数。
 */
function migrateDiplomacyRange(state: Record<string, unknown>): void {
  const forces = state.forces;
  if (!forces || typeof forces !== 'object') return;
  for (const force of Object.values(forces as Record<string, unknown>)) {
    if (!force || typeof force !== 'object') continue;
    const record = force as Record<string, unknown>;
    const diplomacy = record.diplomacy;
    if (!diplomacy || typeof diplomacy !== 'object') continue;
    const next: Record<string, number> = {};
    for (const [target, raw] of Object.entries(diplomacy as Record<string, unknown>)) {
      if (typeof raw !== 'number' || !Number.isFinite(raw)) continue;
      next[target] = clampDiplomacy(raw / 2 + NEUTRAL_DIPLOMACY);
    }
    record.diplomacy = next;
  }
}

/**
 * 旧版存档科技兼容：科技树从「6 方向 × 4 级」改为「9 系统 × 6 级」后，
 * 旧档势力上的 `techs: { spear: 1 }` 已无意义，按原方向映射为新树的根节点；
 * 已写入 `techNodes` 的新档（无 `techs` 字段）原样保留。
 */
const LEGACY_TECH_NODE_BY_BRANCH: Readonly<Record<string, TechNodeId>> = {
  spear: 'zhiyehua',
  halberd: 'zhiyehua',
  crossbow: 'gonggongjiaoyu',
  cavalry: 'liangmayuzhong',
  military: 'zhiyehua',
  civil: 'chuanwu',
};

function migrateLegacyForceTechs(value: unknown): unknown {
  if (!value || typeof value !== 'object') return value;
  const state = value as { forces?: Record<string, unknown> };
  if (!state.forces || typeof state.forces !== 'object') return value;
  let changed = false;
  const forces: Record<string, unknown> = { ...state.forces };
  for (const [forceId, rawForce] of Object.entries(forces)) {
    if (!rawForce || typeof rawForce !== 'object') continue;
    const force = rawForce as Record<string, unknown>;
    if (!Object.hasOwn(force, 'techs')) continue;
    const legacyTechs = (force.techs ?? {}) as Record<string, unknown>;
    const nodes = new Set<TechNodeId>(
      Array.isArray(force.techNodes) ? force.techNodes.filter((id): id is TechNodeId => typeof id === 'string') : [],
    );
    for (const [branch, level] of Object.entries(legacyTechs)) {
      const nodeId = LEGACY_TECH_NODE_BY_BRANCH[branch];
      if (nodeId && typeof level === 'number' && level >= 1) nodes.add(nodeId);
    }
    const migrated: Record<string, unknown> = { ...force, techNodes: [...nodes] };
    delete migrated.techs;
    forces[forceId] = migrated;
    changed = true;
  }
  return changed ? { ...state, forces } : value;
}

/**
 * 旧版存档（仅 8 座荆襄城）升级：补入华夏全图其余 34 座无主城，
 * 使其与当前剧本的 42 城结构一致；已存在的城市保持存档原样。
 */
function injectMissingCities(value: unknown): unknown {
  if (!value || typeof value !== 'object') return value;
  const state = value as Partial<GameState>;
  if (state.scenarioId !== 'jingxiang-208' || !state.cities || typeof state.cities !== 'object') return value;
  const defaults = createScenarioCities();
  const cities = { ...state.cities } as Record<string, City>;
  let injected = false;
  for (const id of CITY_IDS) {
    if (cities[id]) continue;
    cities[id] = defaults[id];
    injected = true;
  }
  return injected ? { ...state, cities } : value;
}

/**
 * 旧版存档升级：补入全部关隘据点，并为每个关隘补齐后续新增字段
 * （太守 governorId / 气力 training / 治安 order / 每旬训练巡查标记）。
 * 已有 passes 字段的存档保留其实际拥有权等变化，仅缺失字段补默认值。
 */
function injectMissingPasses(value: unknown): GameState {
  const state = value as GameState;
  if (state.scenarioId !== 'jingxiang-208' || !state.grid) return state;
  const defaults = createScenarioPasses(state);
  if (!state.passes || Object.keys(state.passes).length === 0) {
    return { ...state, passes: defaults };
  }
  let changed = false;
  const passes = { ...state.passes } as Record<PassId, Pass>;
  for (const id of PASS_IDS) {
    const def = defaults[id];
    const existing = passes[id];
    if (!existing) {
      passes[id] = def;
      changed = true;
      continue;
    }
    const patched: Pass = {
      ...def,
      ...existing,
      governorId: existing.governorId ?? null,
      training: existing.training ?? def.training,
      order: existing.order ?? def.order,
      durability: existing.durability ?? def.durability,
      maxDurability: existing.maxDurability ?? def.maxDurability,
      trainedThisTenDay: existing.trainedThisTenDay ?? false,
      patrolledThisTenDay: existing.patrolledThisTenDay ?? false,
      armaments: existing.armaments ?? def.armaments,
      flankKeys: existing.flankKeys ?? def.flankKeys,
      q: existing.q ?? def.q,
      r: existing.r ?? def.r,
    };
    if (existing.governorId == null || existing.training == null || existing.order == null ||
        existing.durability == null || existing.maxDurability == null ||
        existing.trainedThisTenDay == null || existing.patrolledThisTenDay == null) {
      changed = true;
    }
    passes[id] = patched;
  }
  return changed ? { ...state, passes } : state;
}

function migrateTerrainGrid(state: GameState): GameState {
  // 自定义地图自带完整显式 grid，不做任何地形迁移/兜底替换
  if (state.scenarioId === 'custom-map') return state;
  // 已是细分地形新地图（china42x，含草地等原版 20 值地形）：
  // 仅归一旧档关所格（曾与建设用地混同为 construction），其余保持原样
  if (state.grid.some((cell) => cell.terrain === 'grass')) return normalizePassCells(state);
  // 未编辑过的旧版 china42 地图 → 整体升级为原版精确地图 china42x（关所已是 pass）
  if (gridMatchesLegacyChina42(state.grid)) {
    const upgraded: GridCell[] = (china42xData.grid as { q: number; r: number; terrain: GridCell['terrain'] }[]).map(
      (cell) => ({ q: cell.q, r: cell.r, terrain: cell.terrain }),
    );
    return { ...state, grid: upgraded };
  }
  // 玩家编辑过或更早版本的地图：保留原样（含旧 shore→water 归一化）
  let changed = false;
  const normalized = state.grid.map((cell) => {
    if ((cell.terrain as string) === 'shore') {
      changed = true;
      return { ...cell, terrain: 'water' as const };
    }
    return cell;
  });
  if (changed) return { ...state, grid: normalized };
  const hasFerry = state.grid.some((cell) => cell.terrain === 'ferry');
  if (hasFerry) return state;
  const fallbackGrid: GridCell[] = (china42xData.grid as { q: number; r: number; terrain: GridCell['terrain'] }[]).map(
    (cell) => ({ q: cell.q, r: cell.r, terrain: cell.terrain }),
  );
  return {
    ...state,
    grid: state.scenarioId === 'mobile-duel' ? createMobileDuelGrid() : fallbackGrid,
  };
}

/** china42x 旧档关所格归一：关所地形独立为 pass 前曾与建设用地同映射为 construction */
function normalizePassCells(state: GameState): GameState {
  if (state.scenarioId !== 'jingxiang-208' || state.grid.length !== (china42xData.grid as unknown[]).length) return state;
  const passKeys = new Set(
    (china42xData.grid as { q: number; r: number; terrain: GridCell['terrain'] }[])
      .filter((cell) => cell.terrain === 'pass')
      .map((cell) => `${cell.q},${cell.r}`),
  );
  let changed = false;
  const grid = state.grid.map((cell) => {
    if (cell.terrain === 'construction' && passKeys.has(`${cell.q},${cell.r}`)) {
      changed = true;
      return { ...cell, terrain: 'pass' as const };
    }
    return cell;
  });
  return changed ? { ...state, grid } : state;
}

/** 存档 grid 是否与旧版 china42.json 地形完全一致（即未被地图编辑器改动） */
function gridMatchesLegacyChina42(grid: GridCell[]): boolean {
  const legacy = china42Data.grid as { q: number; r: number; terrain: GridCell['terrain'] }[];
  if (grid.length !== legacy.length) return false;
  for (let i = 0; i < legacy.length; i += 1) {
    if (grid[i].q !== legacy[i].q || grid[i].r !== legacy[i].r || grid[i].terrain !== legacy[i].terrain) return false;
  }
  return true;
}

export function clearSaves(storage: SaveAdapter) {
  storage.removeItem(AUTO_SAVE_KEY);
  storage.removeItem(MANUAL_SAVE_KEY);
}

export function clearSave(storage: SaveAdapter, slot: SaveSlot) {
  storage.removeItem(keyFor(slot));
}
