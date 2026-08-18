import { clamp } from './commands';
import { ARMAMENT_LABELS, armamentsOf } from './armaments';
import { movementAllowanceForUnit, unitSupplyMultiplier } from './battle/actions';
import { nextRandom } from './random';
import { FORCE_IDS } from './scenario/jingxiang208';
import { movementAllowanceBonus } from './skills/rules/movement';
import { settleForceTurnStart } from './skills/rules/turn';
import { cityIncomeMultiplier } from './skills/rules/city';
import type { ArmyUnit, City, GameState } from './types';

interface CityEvent {
  name: string;
  apply(city: City): void;
}

const EVENTS: CityEvent[] = [
  { name: '丰收', apply: (city) => { city.food += 3000; } },
  { name: '旱灾', apply: (city) => { city.food = Math.max(0, city.food - 3000); city.order = clamp(city.order - 2, 0, 100); } },
  { name: '商旅', apply: (city) => { city.gold += 1200; } },
  { name: '流民', apply: (city) => { city.population += 2000; city.order = clamp(city.order - 1, 0, 100); } },
  { name: '疫病', apply: (city) => { city.population = Math.max(0, city.population - 1500); city.troops = Math.max(0, city.troops - 500); city.order = clamp(city.order - 3, 0, 100); } },
  { name: '人才传闻', apply: () => undefined },
];

const BASE_TEN_DAY_ACTION_POINTS = 80;
const CITY_FOOD_PER_TEN_THOUSAND_TROOPS = 500;
const UNIT_FOOD_PER_TEN_THOUSAND_TROOPS = 1000;

function isQuarterStartMonth(month: number) {
  return (month - 1) % 3 === 0;
}

function clearTransientBattleReports(state: GameState) {
  state.battleDamageReports = [];
  state.facilityRepairReports = [];
  state.strategyResultReports = [];
}

function applyPossibleEvent(state: GameState, city: City) {
  const roll = nextRandom(state.seed, state.rngCursor);
  state.rngCursor = roll.cursor;
  if (roll.value >= 0.18) return;

  const choice = nextRandom(state.seed, state.rngCursor);
  state.rngCursor = choice.cursor;
  const event = EVENTS[Math.floor(choice.value * EVENTS.length)];
  event.apply(city);
  state.logs.push({
    id: `event-${state.month}-${city.id}-${state.rngCursor}`,
    month: state.month,
    forceId: city.ownerId,
    message: `${city.name}发生${event.name}`,
  });
}

export function settleMonth(state: GameState): GameState {
  const next = structuredClone(state);
  clearTransientBattleReports(next);
  const enteringMonth = next.month === 24 ? next.month : next.month + 1;
  const shouldSettleQuarterFood = isQuarterStartMonth(enteringMonth);

  for (const city of Object.values(next.cities)) {
    const baseGold = Math.round(city.commerce * 20 + city.population / 100);
    city.gold += Math.round(baseGold * cityIncomeMultiplier(next, city.id, 'gold'));
    if (shouldSettleQuarterFood) {
      const baseFood = Math.round(city.agriculture * 60 + city.population / 40);
      city.food += Math.round(baseFood * cityIncomeMultiplier(next, city.id, 'food'));
    }
    city.population += Math.floor((city.population * 0.005 * city.order) / 100);
    applyPossibleEvent(next, city);
  }
  for (const forceId of FORCE_IDS) next.actionPoints[forceId] = BASE_TEN_DAY_ACTION_POINTS;
  for (const officer of Object.values(next.officers)) officer.acted = false;

  if (next.month === 24) {
    next.phase = 'finished';
    next.logs.push({ id: 'final-settlement', month: 24, forceId: null, message: '二十四个月经营期结束，开始结算国力。' });
  } else {
    next.month += 1;
    next.logs.push({ id: `month-${next.month}`, month: next.month, forceId: null, message: `进入建安十三年后的第${next.month}个月。` });
  }
  return next;
}

function restoreTenDayActionPoints(next: GameState, previous: GameState) {
  for (const forceId of FORCE_IDS) {
    next.actionPoints[forceId] = BASE_TEN_DAY_ACTION_POINTS + Math.floor(previous.actionPoints[forceId] / 2);
  }
}

function removeUnit(next: GameState, unit: ArmyUnit) {
  const officerIds = unit.officerIds ?? [unit.leaderId];
  delete next.units[unit.id];
  const retreatCity = Object.values(next.cities).find((city) => city.ownerId === unit.forceId);
  for (const officerId of officerIds) {
    const officer = next.officers[officerId];
    if (!officer) continue;
    officer.location = retreatCity ? { kind: 'city', cityId: retreatCity.id } : { kind: 'unaffiliated', cityId: unit.homeCityId };
    officer.cityId = officer.location.cityId;
    officer.acted = false;
  }
}

function settleCitySupply(city: City) {
  const foodCost = Math.max(0, Math.ceil((city.troops * CITY_FOOD_PER_TEN_THOUSAND_TROOPS) / 10000));
  city.food = Math.max(0, city.food - foodCost);
}

function settleUnitSupply(next: GameState, unit: ArmyUnit) {
  const baseFoodCost = Math.max(0, Math.ceil((unit.troops * UNIT_FOOD_PER_TEN_THOUSAND_TROOPS) / 10000));
  const foodCost = Math.ceil(baseFoodCost * unitSupplyMultiplier(next, unit));
  if (unit.food >= foodCost) {
    unit.food -= foodCost;
    unit.energy = Math.min(100, unit.energy + 5);
  } else {
    unit.food = 0;
    unit.energy = Math.max(0, unit.energy - 20);
    unit.troops = Math.max(0, unit.troops - Math.max(100, Math.ceil(unit.troops * 0.08)));
  }

  if (unit.troops <= 0) {
    removeUnit(next, unit);
    return;
  }

  unit.movementRemaining = movementAllowanceForUnit(unit) + movementAllowanceBonus(next, unit);
  unit.moved = false;
  unit.acted = false;
  tickUnitStatus(unit, 'confusedTenDays');
  tickUnitStatus(unit, 'falseReportedTenDays');
  tickUnitStatus(unit, 'burningTenDays');
}

function tickUnitStatus(unit: ArmyUnit, key: 'confusedTenDays' | 'falseReportedTenDays' | 'burningTenDays') {
  const value = unit[key];
  if (!value) return;
  const nextValue = value - 1;
  if (nextValue > 0) unit[key] = nextValue;
  else delete unit[key];
}

function settleOfficerTransfers(next: GameState) {
  for (const officer of Object.values(next.officers)) {
    if (officer.location.kind !== 'transfer') continue;
    officer.location.remainingTenDays -= 1;
    if (officer.location.remainingTenDays > 0) continue;

    const targetCityId = officer.location.targetCityId;
    const target = next.cities[targetCityId];
    officer.location = { kind: 'city', cityId: targetCityId };
    officer.cityId = targetCityId;
    officer.acted = false;
    next.logs.push({
      id: `transfer-arrive-${next.month}-${officer.id}-${next.logs.length}`,
      month: next.month,
      forceId: officer.forceId,
      message: `${officer.name}抵达${target.name}`,
    });
  }
}

function settleOfficerTasks(next: GameState) {
  for (const officer of Object.values(next.officers)) {
    if (officer.location.kind !== 'task') continue;
    officer.location.remainingTenDays -= 1;
    if (officer.location.remainingTenDays > 0) continue;

    const task = officer.location;
    const city = next.cities[task.cityId];
    const current = armamentsOf(city.armaments);
    city.armaments = {
      ...current,
      [task.armamentType]: current[task.armamentType] + task.amount,
    };
    next.cityEffectReports = [{
      id: `city-effect-${next.month}-${next.logs.length}`,
      cityId: city.id,
      q: city.gridQ,
      r: city.gridR,
      amount: task.amount,
      label: ARMAMENT_LABELS[task.armamentType],
      kind: 'armament',
    }];
    officer.location = { kind: 'city', cityId: city.id };
    officer.cityId = city.id;
    officer.acted = false;
    next.logs.push({
      id: `armament-complete-${next.month}-${officer.id}-${next.logs.length}`,
      month: next.month,
      forceId: officer.forceId,
      message: `${officer.name}完成${city.name}${ARMAMENT_LABELS[task.armamentType]}生产，增加了${task.amount}`,
    });
  }
}

export function settleTenDay(state: GameState): GameState {
  let next = structuredClone(state);
  clearTransientBattleReports(next);
  for (const city of Object.values(next.cities)) settleCitySupply(city);
  for (const unit of [...Object.values(next.units)]) settleUnitSupply(next, unit);
  settleForceTurnStart(next, state.playerForceId);
  settleOfficerTransfers(next);
  settleOfficerTasks(next);

  if (next.tenDay === 3) {
    next = settleMonth(next);
    next.tenDay = 1;
  } else {
    next.tenDay = next.tenDay === 1 ? 2 : 3;
  }

  restoreTenDayActionPoints(next, state);
  next.turnForceId = next.playerForceId;
  return next;
}
