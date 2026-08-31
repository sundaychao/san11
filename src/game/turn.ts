import { clamp, rollGrainPrices, rollMerchants, addTechP } from './commands';
import { ABILITY_NODE_MAP, applyCultivation } from './abilityResearch';
import { ARMAMENT_LABELS, armamentsOf } from './armaments';
import { MAX_TECH_LEVEL, TECH_BRANCHES, TECHP_POP_DIVISOR, techLevelOf } from './techs';
import { movementAllowanceForUnit, unitSupplyMultiplier } from './battle/actions';
import { applyGroundFireDamageToFacilities, applyGroundFireDamageToUnits } from './battle/fire';
import { cellAt } from './battle/movementRules';
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
  // 每月初各城粮价独立波动（1金=3~7粮）
  rollGrainPrices(next);
  const enteringMonth = next.month === 24 ? next.month : next.month + 1;
  const shouldSettleQuarterFood = isQuarterStartMonth(enteringMonth);

  for (const city of Object.values(next.cities)) {
    const baseGold = city.commerce * 20 + city.population / 100;
    city.gold += Math.round(baseGold * cityIncomeMultiplier(next, city.id, 'gold'));
    if (shouldSettleQuarterFood) {
      const baseFood = city.agriculture * 60 + city.population / 40;
      city.food += Math.round(baseFood * cityIncomeMultiplier(next, city.id, 'food'));
    }
    city.population += Math.floor((city.population * 0.005 * city.order) / 100);
    applyPossibleEvent(next, city);
  }
  for (const forceId of FORCE_IDS) next.actionPoints[forceId] = BASE_TEN_DAY_ACTION_POINTS;
  for (const officer of Object.values(next.officers)) officer.acted = false;
  settleAbilityResearch(next);

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

function settleUnitBurning(next: GameState, unit: ArmyUnit) {
  if (!unit.burningTenDays) return;
  const burnDamage = Math.max(200, Math.ceil(unit.troops * 0.05));
  unit.troops = Math.max(0, unit.troops - burnDamage);
  next.battleDamageReports ??= [];
  next.battleDamageReports.push({
    id: `burn-${next.month}-${next.tenDay}-${unit.id}-${next.battleDamageReports.length}`,
    unitId: unit.id,
    q: unit.q,
    r: unit.r,
    amount: burnDamage,
    kind: 'attack',
    label: '火伤',
  });
  if (unit.troops <= 0) removeUnit(next, unit);
}

function settleCitySupply(next: GameState, city: City) {
  const foodCost = Math.max(0, Math.ceil((city.troops * CITY_FOOD_PER_TEN_THOUSAND_TROOPS) / 10000));
  city.food = Math.max(0, city.food - foodCost);
  // 内政4级仁政：治安自然回升翻倍
  if (city.ownerId && techLevelOf(next, city.ownerId, 'civil') >= 4) {
    city.order = clamp(city.order + 2, 0, 100);
  }
  // 技巧P：每旬每城按人口产出
  if (city.ownerId) addTechP(next, city.ownerId, Math.floor(city.population / TECHP_POP_DIVISOR));
}

function settleUnitSupply(next: GameState, unit: ArmyUnit) {
  const energyCap = unit.forceId ? (100 + (techLevelOf(next, unit.forceId, 'military') >= 1 ? 20 : 0)) : 100;
  const energyRegen = unit.forceId && techLevelOf(next, unit.forceId, 'military') >= 4 ? 10 : 5;
  const baseFoodCost = Math.max(0, Math.ceil((unit.troops * UNIT_FOOD_PER_TEN_THOUSAND_TROOPS) / 10000));
  const foodCost = Math.ceil(baseFoodCost * unitSupplyMultiplier(next, unit));
  if (unit.food >= foodCost) {
    unit.food -= foodCost;
    unit.energy = Math.min(energyCap, unit.energy + energyRegen);
  } else {
    unit.food = 0;
    unit.energy = Math.max(0, unit.energy - 20);
    unit.troops = Math.max(0, unit.troops - Math.max(100, Math.ceil(unit.troops * 0.08)));
  }

  if (unit.troops <= 0) {
    removeUnit(next, unit);
    return;
  }

  settleUnitBurning(next, unit);
  if (unit.troops <= 0) return;

  unit.movementRemaining = movementAllowanceForUnit(unit) + movementAllowanceBonus(next, unit, cellAt(next, unit)?.terrain);
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

function settleFirePlots(next: GameState) {
  next.firePlots = (next.firePlots ?? [])
    .map((plot) => ({ ...plot, remainingTenDays: (plot.remainingTenDays ?? 3) - 1 }))
    .filter((plot) => plot.remainingTenDays > 0);
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

function settleAbilityResearch(next: GameState) {
  for (const force of Object.values(next.forces)) {
    const research = force.abilityResearch;
    if (!research?.active) continue;
    research.active.remainingMonths -= 1;
    if (research.active.remainingMonths > 0) continue;

    const node = ABILITY_NODE_MAP[research.active.nodeId];
    if (node && !research.researched.includes(node.id)) {
      research.researched = [...research.researched, node.id];
      research.remaining = { ...research.remaining, [node.id]: node.learnCount };
      next.logs.push({
        id: `ability-research-${next.month}-${force.id}-${next.logs.length}`,
        month: next.month,
        forceId: force.id,
        message: `${force.name}完成能力「${node.label}」研究，可培育${node.learnCount}名武将`,
      });
    }
    research.active = undefined;
  }
}

function settleOfficerTasks(next: GameState) {
  for (const officer of Object.values(next.officers)) {
    if (officer.location.kind !== 'task') continue;
    officer.location.remainingTenDays -= 1;
    if (officer.location.remainingTenDays > 0) continue;

    const task = officer.location;
    const city = next.cities[task.cityId];
    if (task.task === 'research') {
      // 研究完成：势力科技等级+1
      const force = officer.forceId ? next.forces[officer.forceId] : undefined;
      const branchDef = TECH_BRANCHES.find((candidate) => candidate.id === task.branch);
      if (force && branchDef) {
        const currentLevel = force.techs?.[task.branch] ?? 0;
        force.techs = { ...force.techs, [task.branch]: Math.min(MAX_TECH_LEVEL, currentLevel + 1) };
        next.logs.push({
          id: `research-complete-${next.month}-${officer.id}-${next.logs.length}`,
          month: next.month,
          forceId: officer.forceId,
          message: `${officer.name}完成「${branchDef.levels[currentLevel].name}」研究，${force.name}科技提升`,
        });
      }
      officer.location = { kind: 'city', cityId: city.id };
      officer.cityId = city.id;
      officer.acted = false;
      continue;
    }
    if (task.task === 'cultivate') {
      // 培育完成：提升武将能力/适性，扣减该节点剩余培育次数
      const node = ABILITY_NODE_MAP[task.nodeId];
      const force = officer.forceId ? next.forces[officer.forceId] : undefined;
      if (node && force) {
        applyCultivation(officer, node);
        const research = force.abilityResearch ?? { researched: [], remaining: {} };
        research.remaining = { ...research.remaining, [node.id]: Math.max(0, (research.remaining[node.id] ?? 0) - 1) };
        force.abilityResearch = research;
        next.logs.push({
          id: `cultivate-complete-${next.month}-${officer.id}-${next.logs.length}`,
          month: next.month,
          forceId: officer.forceId,
          message: `${officer.name}完成「${node.label}」培育`,
        });
      }
      officer.location = { kind: 'city', cityId: city.id };
      officer.cityId = city.id;
      officer.acted = false;
      continue;
    }
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
  // 每旬各城商人独立掷点到访（1/4），并重置交易次数
  rollMerchants(next);
  for (const city of Object.values(next.cities)) settleCitySupply(next, city);
  for (const unit of [...Object.values(next.units)]) settleUnitSupply(next, unit);
  applyGroundFireDamageToUnits(next, 'ten-day-fire');
  applyGroundFireDamageToFacilities(next);
  settleFirePlots(next);
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
