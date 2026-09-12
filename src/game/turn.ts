import { clamp, rollGrainPrices, rollMerchants, appointStrongholdSuccessor, officerIsBusy } from './commands';
import { ABILITY_NODE_MAP, applyCultivation } from './abilityResearch';
import { ARMAMENT_LABELS, armamentsOf } from './armaments';
import { TECHP_CITY_POP_DIVISOR, TECHP_RURAL_POP_DIVISOR, addTechP, completeTechResearch, energyCapOf, maxDurabilityBonus, movementTechBonus, orderDropResist, populationGrowthMultiplier } from './techs';
import { movementAllowanceForUnit, reconcileFacilityUpgrades, unitSupplyMultiplier } from './battle/actions';
import { unitMaxPolitics } from './battle/legacyCore';
import { applyGroundFireDamageToCities, applyGroundFireDamageToFacilities, applyGroundFireDamageToPasses, applyGroundFireDamageToPlots, applyGroundFireDamageToUnits } from './battle/fire';
import { cellAt } from './battle/movementRules';
import { battleShipMovementBonus } from './battle/catalog';
import { nextRandom } from './random';
import { FORCE_IDS } from './scenario/jingxiang208';
import { hasCityTrait } from './cityTraits';
import { territoryCityAt } from './territory';
import { movementAllowanceBonus } from './skills/rules/movement';
import { cityPopulationOf, ruralPopulationOf } from './innerAffairs';
import { appointSuccessorGovernor, applyFacilityLevelTech, settleDurabilityRecovery } from './innerAffairs';
import { settleLoyaltyDrift } from './loyalty';import { settleCaptives } from './captives';
import { applyIllness, settleAgingDeaths, settleOfficerHealth } from './health';
import { settleLegionAutomation, settlePlotConstruction, settleCityRangedAttack, isCityBlocked, cityMonthlyGoldIncome, cityQuarterlyFoodIncome, DEFAULT_OFFICER_SALARY } from './innerAffairs';
import { officerSkillNames, effectsOfKind, resolveCitySkills } from './skills';
import { settlePassRangedAttack } from './passes';
import { executeDelegations, delegationMergedOfficerIds, keepDelegationMergedOfficersActed } from './battle/delegate';
import { addOfficerMerit, MERIT_PER_MONTH, positionDefinition, rankDefinition, rankForCityCount, rankIndex } from './ranks';
import { settleForceTurnStart } from './skills/rules/turn';
import { cityIncomeMultiplier } from './skills/rules/city';
import { tenDayIndex } from './diplomacy';
import { passIncomeMultiplierByBlockade, passQuarterlyFoodIncome, passMonthlyGoldIncome } from './passes';
import { cityResourceCaps, clampStrongholdsInPlace, passResourceCaps } from './strongholdCapacity';
import type { ArmyUnit, City, CityId, FacilityRepairReport, ForceId, GameState, Pass } from './types';

interface CityEvent {
  name: string;
  apply(city: City): void;
}

const EVENTS: CityEvent[] = [
  { name: '丰收', apply: (city) => { city.food += 3000; } },
  { name: '蝗灾', apply: (city) => { const loss = 3000 + Math.floor(city.food * 0.08); city.food = Math.max(0, city.food - loss); city.order = clamp(city.order - 3, 0, 100); } },
  { name: '旱灾', apply: (city) => { city.food = Math.max(0, city.food - 3000); city.order = clamp(city.order - 2, 0, 100); } },
  { name: '洪水', apply: (city) => { city.troops = Math.max(0, city.troops - Math.max(300, Math.floor(city.troops * 0.04))); city.order = clamp(city.order - 4, 0, 100); } },
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
  state.cityEffectReports = [];
}

function applyPossibleEvent(state: GameState, city: City) {
  const roll = nextRandom(state.seed, state.rngCursor);
  state.rngCursor = roll.cursor;
  if (roll.value >= 0.18) return;

  // 「风水」特技：所辖城灾害/丰收类事件发生率减半
  const hasFengShui = city.ownerId && Object.values(state.officers).some((o) =>
    o.forceId === city.ownerId && (o.location.kind === 'city' || o.location.kind === 'task')
      && o.location.cityId === city.id && officerSkillNames(o).includes('风水'));
  if (hasFengShui && roll.value >= 0.09) return;

  const choice = nextRandom(state.seed, state.rngCursor);
  state.rngCursor = choice.cursor;
  let event = EVENTS[Math.floor(choice.value * EVENTS.length)];
  // 祈祷：所属城市发生非丰收事件时，有 1/3 概率转为丰收
  const hasPrayer = effectsOfKind(resolveCitySkills(state, city.id), 'harvestBlessed').length > 0;
  if (hasPrayer && event.name !== '丰收') {
    const blessingRoll = nextRandom(state.seed, state.rngCursor);
    state.rngCursor = blessingRoll.cursor;
    if (blessingRoll.value < 1 / 3) event = EVENTS[0];
  }
  // 丰收规模随农业值放大（农业越高收成越好）
  if (event.name === '丰收') city.food += city.agriculture * 30;
  // 疫病：城中武将随机染病（30%）
  if (event.name === '疫病') {
    for (const officer of Object.values(state.officers)) {
      if (officer.forceId !== city.ownerId || officer.location.kind !== 'city' || officer.location.cityId !== city.id) continue;
      const roll2 = nextRandom(state.seed, state.rngCursor);
      state.rngCursor = roll2.cursor;
      if (roll2.value < 0.3) applyIllness(state, officer);
    }
  }
  event.apply(city);
  state.logs.push({
    id: `event-${state.month}-${city.id}-${state.rngCursor}`,
    month: state.month,
    forceId: city.ownerId,
    message: `${city.name}发生${event.name}`,
  });
}

/**
 * 贼兵/异民族骚扰（简化版）：
 * 治安低于50的城每月有概率遭贼兵劫掠——损失金钱/粮草、守军折损、治安再降；
 * 「威压」特技持有者所在城免疫骚扰。
 */
function settleBarbarianRaids(next: GameState) {
  for (const city of Object.values(next.cities)) {
    if (!city.ownerId || city.order >= 50) continue;
    const hasRepress = Object.values(next.officers).some((o) =>
      o.forceId === city.ownerId && (o.location.kind === 'city' || o.location.kind === 'task')
        && o.location.cityId === city.id && officerSkillNames(o).includes('威压'));
    if (hasRepress) continue;
    const roll = nextRandom(next.seed, next.rngCursor);
    next.rngCursor = roll.cursor;
    // 公共教育：换季治安下降概率降低50%
    const baseChance = (50 - city.order) / 120;
    const chance = orderDropResist(next, city.ownerId) ? baseChance / 2 : baseChance;
    if (roll.value >= chance) continue;
    const goldLoss = Math.floor(city.gold * (0.02 + roll.value * 0.06));
    const foodLoss = Math.floor(city.food * (0.03 + roll.value * 0.07));
    const troopLoss = Math.min(city.troops, 200 + Math.floor(city.troops * 0.02));
    city.gold -= goldLoss;
    city.food -= foodLoss;
    city.troops -= troopLoss;
    city.order = clamp(city.order - 4, 0, 100);
    next.logs.push({
      id: `raid-${next.month}-${city.id}-${next.rngCursor}`,
      month: next.month,
      forceId: city.ownerId,
      message: `贼兵袭扰${city.name}！损失金钱${goldLoss}、兵粮${foodLoss}、守军${troopLoss}`,
    });
  }
}

/** 每旬递减停战剩余旬数，到期解除 */
function settleTruces(next: GameState) {
  for (const force of Object.values(next.forces)) {
    const truces = force.truces ?? {};
    let changed = false;
    for (const [target, remaining] of Object.entries(truces)) {
      const nextValue = remaining - 1;
      if (nextValue <= 0) {
        delete truces[target as ForceId];
        changed = true;
        next.logs.push({
          id: `truce-end-${next.month}-${force.id}-${target}-${next.logs.length}`,
          month: next.month,
          forceId: force.id,
          message: `${force.name}与${next.forces[target as ForceId]?.name ?? '对手'}的停战协定到期`,
        });
      } else {
        truces[target as ForceId] = nextValue;
        changed = true;
      }
    }
    if (changed) force.truces = truces;
  }
}

/** 部队退场后武将的落点：本方城池，或（本方已无城时）转为在野 */
type RetreatLocation = { kind: 'city'; cityId: CityId } | { kind: 'unaffiliated'; cityId: CityId };

/**
 * 部队退场时武将的去向：优先本队归属据点（须仍为本方所有），
 * 其次任意本方城池，都没有则转为在野。
 * 不能只看归属据点是否存在 —— 据点可能已被敌方攻占，那样会把武将送进敌城。
 */
function retreatLocationForUnit(next: GameState, unit: ArmyUnit): RetreatLocation {
  const home = next.cities[unit.homeCityId];
  if (home && home.ownerId === unit.forceId) return { kind: 'city', cityId: home.id };
  const friendly = Object.values(next.cities).find((city) => city.ownerId === unit.forceId);
  if (friendly) return { kind: 'city', cityId: friendly.id };
  return { kind: 'unaffiliated', cityId: unit.homeCityId };
}

/** 部队退场（援军到期 / 残兵溃散）时把编队武将送回本方据点，返回目的地名称 */
function returnOfficersToRear(next: GameState, unit: ArmyUnit): string {
  const destination = retreatLocationForUnit(next, unit);
  for (const officerId of unit.officerIds ?? [unit.leaderId]) {
    const officer = next.officers[officerId];
    if (!officer) continue;
    officer.location = { ...destination };
    officer.cityId = destination.cityId;
    officer.acted = false;
  }
  return next.cities[destination.cityId]?.name ?? '驻地';
}

/** 临时部队到期（援军）自动撤退 */
function settleExpiringUnits(next: GameState) {
  const current = tenDayIndex(next.month, next.tenDay ?? 1);
  for (const unit of Object.values(next.units)) {
    if (unit.expiresTenDay === undefined || current < unit.expiresTenDay) continue;
    const placeName = returnOfficersToRear(next, unit);
    const leaderName = next.officers[unit.leaderId]?.name ?? unit.leaderId;
    delete next.units[unit.id];
    next.logs.push({
      id: `reinforce-return-${next.month}-${unit.id}-${next.logs.length}`,
      month: next.month,
      forceId: unit.forceId,
      message: `援军部队（${leaderName}）任务结束，撤回${placeName}`,
    });
  }
}

/**
 * 每月初结算：
 * - 爵位：按城市数量自动晋升（达到皇帝时触发汉帝退位剧情）；
 * - 功绩：所有在职武将每月被动+30；
 * - 俸禄：有官职的武将每月从所在城资金扣俸禄。
 */
function settleRanksMeritSalaries(next: GameState) {
  const promotions: string[] = [];
  for (const force of Object.values(next.forces)) {
    const cityCount = Object.values(next.cities).filter((city) => city.ownerId === force.id).length;
    const desired = rankForCityCount(cityCount);
    if (rankIndex(force.rank) < rankIndex(desired.id)) {
      const previous = rankIndex(force.rank) >= 0 ? rankDefinition(force.rank as NonNullable<typeof force.rank>).name : '无';
      force.rank = desired.id;
      promotions.push(
        desired.id === 'huangdi'
          ? `${force.name}大业已成，属下劝汉帝退位，拥立其为皇帝！`
          : `${force.name}势力主晋升为${desired.name}（此前${previous}）`,
      );
    } else if (rankIndex(force.rank) === -1) {
      force.rank = desired.id;
    }
  }
  for (const officer of Object.values(next.officers)) {
    if (officer.forceId) addOfficerMerit(officer, MERIT_PER_MONTH);
    if (!officer.forceId) continue;
    // 俸禄：只要该武将所属城（officer.cityId）归属其势力，就按月扣俸禄
    // 无论该武将是在城内、带兵在外、在途或执行任务——从所属城结算
    const city = next.cities[officer.cityId];
    if (!city || city.ownerId !== officer.forceId) continue;
    const salary = officer.positionId
      ? (positionDefinition(officer.positionId)?.salary ?? DEFAULT_OFFICER_SALARY)
      : DEFAULT_OFFICER_SALARY;
    city.gold = Math.max(0, city.gold - salary);
  }
  for (const promotion of promotions) {
    next.logs.push({
      id: `rank-${next.month}-${promotion.length}-${next.logs.length}`,
      month: next.month,
      forceId: null,
      message: promotion,
    });
  }
}

export function settleMonth(state: GameState): GameState {
  const next = structuredClone(state);
  clearTransientBattleReports(next);
  // 每月初各城粮价独立波动（1金=3~7粮）
  rollGrainPrices(next);
  const enteringMonth = next.month === 24 ? next.month : next.month + 1;
  const shouldSettleQuarterFood = isQuarterStartMonth(enteringMonth);

  // 每年正月（农历新年）：黑市自动拆除（含建设中黑市）
  // 剧本为建安十三年四月开局，month 1=四月、9=腊月、10=正月，故正月对应 month % 12 === 10（10/22…）
  if (enteringMonth % 12 === 10) {
    for (const city of Object.values(next.cities)) {
      for (const plot of city.plots ?? []) {
        const isBlackMarketPlot = plot.type === 'blackmarket' || (plot.constructing?.facility ?? null) === 'blackmarket';
        if (isBlackMarketPlot) {
          // 建设中黑市跨年被拆：立即释放建设武将回城
          if (plot.constructing) {
            for (const officerId of plot.constructing.officerIds) {
              const officer = next.officers[officerId];
              if (officer && officer.location.kind === 'task' && officer.location.task === 'construction') {
                officer.location = { kind: 'city', cityId: city.id };
                officer.cityId = city.id;
                officer.acted = false;
              }
            }
          }
          plot.constructing = undefined;
          plot.type = 'empty';
          plot.level = 0;
          plot.value = 0;
          next.logs.push({
            id: `blackmarket-${city.id}-${enteringMonth}-${next.logs.length}`,
            month: enteringMonth,
            forceId: city.ownerId,
            message: `${city.name}的黑市到期，于正月初一被强制拆除。`,
          });
        }
      }
    }
  }

  // 季初（1/4/7/10月）忠诚自然波动
  if (shouldSettleQuarterFood) settleLoyaltyDrift(next);

  // 每月：爵位晋升 + 被动功绩 + 官职俸禄
  settleRanksMeritSalaries(next);

  // 每月：老龄武将病逝判定（主公继位/太守清空/部队处理在 health 内善后）
  settleAgingDeaths(next);

  // 每月：俘虏忠诚下降/逃生判定
  settleCaptives(next);

  for (const city of Object.values(next.cities)) {
    const blocked = city.ownerId ? isCityBlocked(next, city) : false;
    if (!blocked) {
      // 城池资金月收入 = (基础人口税收 + (普通市场+大市场+鱼市)×造币厂) × 治安值 × 0.01
      city.gold += Math.round(cityMonthlyGoldIncome(city) * cityIncomeMultiplier(next, city.id, 'gold'));
      // 季初（1/4/7/10月）结算城池季度粮食收入
      if (shouldSettleQuarterFood) {
        city.food += Math.round(cityQuarterlyFoodIncome(city) * cityIncomeMultiplier(next, city.id, 'food'));
      }
    }
    // 中医学：人口增长＋20%
    const popGrowth = Math.floor((city.population * 0.005 * city.order) / 100 * populationGrowthMultiplier(next, city.ownerId));
    city.population += popGrowth;
    // 城市/农村人口按各自占比同步增长（保持初始比例）
    if (city.cityPopulation != null && city.ruralPopulation != null) {
      const totalSplit = city.cityPopulation + city.ruralPopulation;
      const cityShare = totalSplit > 0 ? Math.round(popGrowth * (city.cityPopulation / totalSplit)) : 0;
      city.cityPopulation += cityShare;
      city.ruralPopulation += popGrowth - cityShare;
    }
    applyPossibleEvent(next, city);
  }
  // 关隘据点：与城池一致的钱粮产出与人口自然增长（无治安值，产出不乘治安修正）
  for (const pass of Object.values(next.passes ?? {})) {
    if (!pass.ownerId) continue;
    // 关隘被敌方封锁（攻击区内有敌军）时无收入
    const incomeMultiplier = passIncomeMultiplierByBlockade(next, pass);
    pass.gold += passMonthlyGoldIncome(pass) * incomeMultiplier;
    if (shouldSettleQuarterFood) {
      pass.food += passQuarterlyFoodIncome(pass) * incomeMultiplier;
    }
    pass.population += Math.floor(pass.population * 0.005);
  }
  // 应用据点金/粮/兵/兵装容量上限（月结算末统一收口，见 strongholdCapacity）
  clampStrongholdsInPlace(next);
  for (const forceId of FORCE_IDS) next.actionPoints[forceId] = BASE_TEN_DAY_ACTION_POINTS;
  // 与旬末同一口径：在途 / 执行任务 / 被俘的武将跨月也保持 acted=true（见 officerIsBusy）
  for (const officer of Object.values(next.officers)) {
    if (!officerIsBusy(officer)) officer.acted = false;
    officer.rewarded = false;
  }
  settleAbilityResearch(next);
  settleBarbarianRaids(next);

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

/** 缺粮时每旬饿死的当前兵力比例 */
const CITY_STARVATION_TROOP_LOSS_RATIO = 0.23;
/** 军马充饥替代比例：1马=2粮 */
const HORSE_FOOD_SUBSTITUTE = 2;

function settleCitySupply(next: GameState, city: City) {
  // 度支：所属城市士兵消费的兵粮减半
  const foodMultiplier = effectsOfKind(resolveCitySkills(next, city.id), 'cityFoodConsumptionMultiplier')
    .reduce((lowest, { effect }) => Math.min(lowest, effect.multiplier), 1);
  // 军马与士兵按同一口粮标准消耗
  const horses = city.armaments?.cavalry ?? 0;
  const foodCost = Math.max(0, Math.ceil(((city.troops + horses) * CITY_FOOD_PER_TEN_THOUSAND_TROOPS * foodMultiplier) / 10000));
  if (city.food >= foodCost) {
    city.food -= foodCost;
  } else {
    // 缺粮：先耗尽存粮，再宰杀军马充饥（1马=2粮）
    let deficit = foodCost - city.food;
    city.food = 0;
    const horsesEaten = Math.min(horses, Math.ceil(deficit / HORSE_FOOD_SUBSTITUTE));
    if (horsesEaten > 0 && city.armaments) {
      city.armaments.cavalry = horses - horsesEaten;
      deficit = Math.max(0, deficit - horsesEaten * HORSE_FOOD_SUBSTITUTE);
      next.logs.push({
        id: `city-horse-food-${city.id}-${next.month}-${next.tenDay}-${next.logs.length}`,
        month: next.month,
        forceId: city.ownerId,
        message: `${city.name}缺粮，宰杀军马${horsesEaten.toLocaleString('en-US')}匹充饥`,
      });
    }
    // 军马仍不足以抵粮：每旬饿死当前兵力的23%
    if (deficit > 0 && city.troops > 0) {
      const lost = Math.ceil(city.troops * CITY_STARVATION_TROOP_LOSS_RATIO);
      city.troops = Math.max(0, city.troops - lost);
      next.logs.push({
        id: `city-starve-${city.id}-${next.month}-${next.tenDay}-${next.logs.length}`,
        month: next.month,
        forceId: city.ownerId,
        message: `${city.name}缺粮，${lost.toLocaleString('en-US')}士兵饿死或逃亡`,
      });
    }
  }
  // 技巧P：每旬每城按城市/农村人口双系数产出（对应血色6.0 城市系数8、农村系数2，按旬分摊后近似 城市÷3000 + 农村÷12000）
  // 学术城：人口产生的技巧值+50%
  if (city.ownerId) {
    const urbanTechP = Math.floor(cityPopulationOf(city) / TECHP_CITY_POP_DIVISOR);
    const ruralTechP = Math.floor(ruralPopulationOf(city) / TECHP_RURAL_POP_DIVISOR);
    addTechP(next, city.ownerId, Math.round((urbanTechP + ruralTechP) * (hasCityTrait(city.id, 'academy') ? 1.5 : 1)));
  }
}

function settleUnitSupply(next: GameState, unit: ArmyUnit) {
  const energyCap = unit.forceId ? energyCapOf(next, unit.forceId) : 100;
  const energyRegen = 5;
  // 战力回复：每旬恢复 部队最高政治×12% 的战力（运输队无战力属性，跳过）
  if (unit.stamina !== undefined) {
    unit.stamina = Math.min(100, (unit.stamina ?? 0) + unitMaxPolitics(next, unit) * 0.12);
  }
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

  // 蛮荒城：领土上的敌方部队每旬士气-2
  const territoryCity = territoryCityAt(next, unit);
  if (territoryCity.ownerId && unit.forceId && unit.forceId !== territoryCity.ownerId
    && hasCityTrait(territoryCity.id, 'wilderness')) {
    unit.energy = Math.max(0, unit.energy - 2);
  }

  if (unit.troops <= 0) {
    removeUnit(next, unit);
    return;
  }

  settleUnitBurning(next, unit);
  if (unit.troops <= 0) return;

  unit.movementRemaining = movementAllowanceForUnit(unit)
    + movementAllowanceBonus(next, unit, cellAt(next, unit)?.terrain)
    + movementTechBonus(next, unit.forceId, unit)
    + battleShipMovementBonus(next, unit);
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

    const targetPassId = officer.location.targetPassId;
    const targetPass = targetPassId ? next.passes?.[targetPassId] : undefined;
    const targetCityId = officer.location.targetCityId;
    const target = targetPass ?? next.cities[targetCityId];
    // 抵达其他据点：若仍挂名原出发据点太守，原据点自动补任
    const governedCity = Object.values(next.cities).find((candidate) => candidate.governorId === officer.id && candidate.id !== targetCityId);
    if (governedCity) appointSuccessorGovernor(next, governedCity);
    const governedPass = Object.values(next.passes ?? {}).find((candidate) => candidate.governorId === officer.id && candidate.id !== targetPassId);
    if (governedPass) appointStrongholdSuccessor(next, governedPass);
    officer.location = targetPass
      ? { kind: 'pass', passId: targetPass.id }
      : { kind: 'city', cityId: targetCityId };
    officer.cityId = targetPass ? targetPass.homeCityId : targetCityId;
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

/** 科技研究完成时的连锁效果：已建成的内政设施自动升级、野外设施按升级链改名升级（阵→砦、箭楼→连弩楼…）。
 *  工程学「据点最大耐久＋3000」不在这里结算，改为每旬由 settleTechDurabilityBonuses 幂等收口，
 *  这样研究完成当旬起、以及此后新占领/易主的据点都能拿到这份上限。 */
function applyTechCompletionSideEffects(next: GameState, forceId: ForceId) {
  applyFacilityLevelTech(next, forceId);
  reconcileFacilityUpgrades(next, forceId);
}

/**
 * 工程学（据点最大耐久＋3000）的**幂等收口**：每旬按据点当前归属势力补齐应得的耐久加成。
 *
 * 只在研究完成当刻给「当时已有」的据点加成，会导致此后占领的据点永远拿不到这份上限；
 * 这里以 `techDurabilityBonus`（该据点已吃到的加成额度）为标记逐旬补齐：
 * 易主/新占自动补上，同一份加成不会重复叠加，未研究该科技的势力也不会凭空获得。
 */
function settleTechDurabilityBonuses(next: GameState) {
  const applyBonus = (stronghold: City | Pass) => {
    const ownerId = stronghold.ownerId;
    if (!ownerId) return;
    const bonus = maxDurabilityBonus(next, ownerId);
    const applied = stronghold.techDurabilityBonus ?? 0;
    if (applied >= bonus) return;
    const delta = bonus - applied;
    stronghold.maxDurability += delta;
    stronghold.durability += delta;
    stronghold.techDurabilityBonus = bonus;
  };
  for (const city of Object.values(next.cities)) applyBonus(city);
  for (const pass of Object.values(next.passes ?? {})) applyBonus(pass);
}

function settleOfficerTasks(next: GameState) {
  for (const officer of Object.values(next.officers)) {
    if (officer.location.kind !== 'task') continue;
    officer.location.remainingTenDays -= 1;
    if (officer.location.remainingTenDays > 0) continue;

    const task = officer.location;
    const taskPass = task.passId ? next.passes?.[task.passId] : undefined;
    const city = next.cities[task.cityId];
    // 任务结束后武将回到原据点（关隘或城池）
    const officerReturn = taskPass
      ? { kind: 'pass' as const, passId: taskPass.id }
      : { kind: 'city' as const, cityId: city.id };
    const returnCityId = taskPass ? taskPass.homeCityId : city.id;
    if (task.task === 'research') {
      // 研究完成：写入该科技节点（多人研究仅主将 lead 结算一次，随从静默释放）
      if (task.lead !== false && officer.forceId) {
        const force = next.forces[officer.forceId];
        const nodeDef = completeTechResearch(next, officer.forceId, task.nodeId);
        if (force && nodeDef) {
          applyTechCompletionSideEffects(next, officer.forceId);
          next.logs.push({
            id: `research-complete-${next.month}-${officer.id}-${next.logs.length}`,
            month: next.month,
            forceId: officer.forceId,
            message: `${officer.name}完成「${nodeDef.name}」研究，${force.name}科技提升`,
          });
        }
      }
      officer.location = officerReturn;
      officer.cityId = returnCityId;
      officer.acted = false;
      continue;
    }
    if (task.task === 'construction') {
      // 建设任务工期结束：释放武将回据点（设施完成由 settlePlotConstruction 结算）
      officer.location = officerReturn;
      officer.cityId = returnCityId;
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
      officer.location = officerReturn;
      officer.cityId = returnCityId;
      officer.acted = false;
      continue;
    }
    // 兵装生产完成：入账并释放（多人生产仅主将 lead 结算一次，随从静默释放）
    const armamentBase = taskPass ?? city;
    if (task.lead !== false) {
      const current = armamentsOf(armamentBase.armaments);
      // 容纳上限按该据点归属势力的科技（修筑要塞）计算，与指令侧同口径
      const armamentCaps = taskPass
        ? passResourceCaps(next, taskPass).armaments
        : cityResourceCaps(next, city).armaments;
      const capLimit = armamentCaps[task.armamentType];
      // 按容纳上限截断后再算实际入库量（据点已满时不会谎报"增加了X"）
      const applied = Math.max(0, Math.min(capLimit, current[task.armamentType] + task.amount) - current[task.armamentType]);
      armamentBase.armaments = {
        ...current,
        [task.armamentType]: current[task.armamentType] + applied,
      };
      next.cityEffectReports = [{
        id: `city-effect-${next.month}-${next.logs.length}`,
        cityId: taskPass ? taskPass.homeCityId : city.id,
        q: taskPass ? taskPass.q : city.gridQ,
        r: taskPass ? taskPass.r : city.gridR,
        amount: applied,
        label: ARMAMENT_LABELS[task.armamentType],
        kind: 'armament',
      }];
      next.logs.push({
        id: `armament-complete-${next.month}-${officer.id}-${next.logs.length}`,
        month: next.month,
        forceId: officer.forceId,
        message: `${officer.name}完成${armamentBase.name}${ARMAMENT_LABELS[task.armamentType]}生产，增加了${applied}`,
      });
    }
    officer.location = officerReturn;
    officer.cityId = returnCityId;
    officer.acted = false;
  }
}

export function settleTenDay(state: GameState): GameState {
  let next = structuredClone(state);
  clearTransientBattleReports(next);
  // 每旬各城商人独立掷点到访（1/4），并重置交易次数
  rollMerchants(next);
  // 城池箭矢射击（敌方部队进入攻击范围时先造成伤害）
  const cityArrowEvents = settleCityRangedAttack(next);
  for (const msg of cityArrowEvents) next.logs.push({ id: `city-arrow-${next.month}-${next.tenDay}-${next.logs.length}`, month: next.month, forceId: null, message: msg });
  // 关隘箭矢射击（敌方部队进入关隘攻击范围时先造成伤害）
  const passArrowEvents = settlePassRangedAttack(next);
  for (const msg of passArrowEvents) next.logs.push({ id: `pass-arrow-${next.month}-${next.tenDay}-${next.logs.length}`, month: next.month, forceId: null, message: msg });

  for (const city of Object.values(next.cities)) {
    settleCitySupply(next, city);
    // 市场/基础收入统一在每月结算（settleMonth）按新公式计入，此旬不再单独产出
  }
  for (const unit of [...Object.values(next.units)]) settleUnitSupply(next, unit);
  applyGroundFireDamageToUnits(next, 'ten-day-fire');
  applyGroundFireDamageToFacilities(next);
  applyGroundFireDamageToPlots(next);
  applyGroundFireDamageToCities(next);
  applyGroundFireDamageToPasses(next);
  settleFirePlots(next);
  settleForceTurnStart(next, state.playerForceId);
  settleOfficerTransfers(next);
  settleOfficerTasks(next);
  // 伤病按旬恢复、停战旬数递减、委任军团自动内政、援军到时撤退
  settleOfficerHealth(next);
  settleTruces(next);
  settleLegionAutomation(next);
  settleExpiringUnits(next);
  // 建设用地建设进度推进（完成则立即转为已建成设施）
  settlePlotConstruction(next);
  // 据点与内政设施的耐久每旬自然回复（工兵科技倍增）
  settleDurabilityRecovery(next);
  // 工程学「据点最大耐久＋3000」：按当前归属势力逐旬补齐（新占/易主的据点也能拿到，不重复叠加）
  settleTechDurabilityBonuses(next);
  // 野外设施升级链逐旬收口：补齐旧存档里「科技早已研究完」的设施，以及研究完成时还在施工、
  // 之后才落成（落成当刻已经是低档）的设施。幂等，只升不降。
  reconcileFacilityUpgrades(next);

  if (next.tenDay === 3) {
    next = settleMonth(next);
    next.tenDay = 1;
  } else {
    next.tenDay = next.tenDay === 1 ? 2 : 3;
  }

  restoreTenDayActionPoints(next, state);
  // 每旬推进都重置全部武将的"本旬已行动"标记，保证下一旬武将可再次执行指令。
  // 但仍在途 / 执行任务 / 被俘的武将下不了任何命令，保持 acted=true —— 否则列表显示"未行动"、
  // 玩家点进去却发现无将可用（抵达或任务完成后由 settleOfficerTransfers/Tasks 释放并置回 false）。
  for (const officer of Object.values(next.officers)) {
    if (!officerIsBusy(officer)) officer.acted = false;
    officer.rewarded = false;
  }
  next.turnForceId = next.playerForceId;
  // 旬/月结算里兵装生产完成、部队回城并账等都会往据点里加资源，出口统一截断到容纳上限
  clampStrongholdsInPlace(next);
  return next;
}

export interface TenDayAdvanceOptions {
  /** 需要自动执行委任的势力：单机＝当前行动势力；联网＝所有人类玩家势力 */
  delegatedForceIds?: readonly ForceId[];
  /** 在这些势力上跑 AI 回合（单机＝除玩家外全部势力；联网＝未被玩家占用的势力） */
  runAiTurns?: (state: GameState) => GameState;
  /** 旬末结算前的最后处理（联网用于切回房主视角） */
  prepareSettle?: (state: GameState) => GameState;
}

/**
 * 推进一旬的统一入口：委任自动执行 → 各势力 AI 回合 → 旬末结算。
 * 单机（GameProvider.endTenDay）与联网（session.advanceTenDay）都调用这里，
 * 保证两边行为一致：以后新增的旬末逻辑只改这一处即可同时生效。
 */
export function advanceTenDay(state: GameState, options: TenDayAdvanceOptions = {}): GameState {
  const delegatedForceIds = options.delegatedForceIds ?? [state.turnForceId];
  const mergedOfficerIds: string[] = [];
  // 委任产生的耐久报告会在后续 AI 回合/旬末被清空，先收集再补回
  const repairReports: FacilityRepairReport[] = [];
  let next = state;

  for (const forceId of delegatedForceIds) {
    const before = next;
    const beforeReports = before.facilityRepairReports ?? [];
    next = executeDelegations(next, forceId);
    const afterReports = next.facilityRepairReports ?? [];
    if (afterReports !== beforeReports && afterReports.length > 0) repairReports.push(...afterReports);
    // 委任自动进驻/回城的武将：旬末会重置全部「本旬已行动」，需在推进后补回标记
    mergedOfficerIds.push(...delegationMergedOfficerIds(before, next));
  }

  if (options.runAiTurns) next = options.runAiTurns(next);
  if (options.prepareSettle) next = options.prepareSettle(next);

  next = settleTenDay(next);
  keepDelegationMergedOfficersActed(next, mergedOfficerIds);
  if (repairReports.length > 0) {
    next.facilityRepairReports = [...(next.facilityRepairReports ?? []), ...repairReports];
  }
  return next;
}
