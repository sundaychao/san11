import { nextRandom } from './random';
import { cityCanBuildFacility, hasCityTrait, forceMaxTraining } from './cityTraits';
import { REWARD_AP_COST, REWARD_GOLD_COST, REWARD_LOYALTY_GAIN, officerLoyalty, recruitmentInitialLoyalty, setOfficerLoyalty } from './loyalty';
import { addOfficerMerit, applyPositionStatDelta, MERIT_PER_COMMAND, officerIsOnCampaign, officerMerit, positionDefinition, forceRankOf, rankDefinition, rankIndex } from './ranks';
import { ARMAMENT_GOLD_COST, ARMAMENT_LABELS, ARMAMENT_TYPES, armamentCost, armamentsOf, armamentProductionTenDays, isDelayedArmament, produceArmamentYield } from './armaments';
import { ABILITY_NODE_MAP, ABILITY_RESEARCH_GOLD, CULTIVATE_TEN_DAYS, abilityCultivateRemaining, abilityNodeStatus, canCultivateOfficer } from './abilityResearch';
import { armamentProductionSpeedMultiplier, commandYieldMultiplier } from './skills/rules/city';
import { effectsOfKind, officerSkillNames, resolveCommandSkills, resolveOfficerSkills } from './skills';
import { MAX_TECH_LEVEL, RESEARCH_AP_COST, TECH_BRANCHES, TECH_COSTS, TECHP_PER_CIVIL_ACTION, TECHP_PER_CONSTRUCTION, TECHP_PER_PATROL, TECHP_PER_PRODUCE_ARMAMENT, TECHP_PER_TRADE, TECHP_PER_TRAIN, addTechP, recruitMultiplier, researchTenDays, techLevelOf } from './techs';
import { EXPLORE_AP_PER_OFFICER, EXPLORE_GOLD_CHANCE, EXPLORE_GOLD_MAX, EXPLORE_GOLD_MIN, EXPLORE_GOLD_PER_OFFICER, EXPLORE_TREASURE_BASE_CHANCE, EXPLORE_TREASURE_INT_BONUS_MAX, treasureDefinition } from './treasures';
import { RUMOR_AP_COST, RUMOR_GOLD_COST, resolveRumor, POACH_AP_COST, POACH_GOLD_COST, resolvePoach, canPoach } from './rumor';
import { DIPLOMACY_AP_COST, GOODWILL_GOLD_COST, DIPLOMACY_GOLD_MAX, REINFORCEMENT_TEN_DAYS, TRUCE_MONTHS_MAX, TRUCE_MONTHS_MIN, adjustDiplomacy, areAllies, forceHasCity, goodwillGain, resolveAlliance, resolveRequestTroops, resolveTruce } from './diplomacy';
import { CAPTIVE_RECRUIT_LOYALTY_THRESHOLD, capturableByLoyalty, executeCaptive, recruitCaptiveChance, releaseCaptive, resolveRecruitCaptive } from './captives';
import { MARRY_TECHP_COST, RELATIONSHIP_LABELS, areRelated, enterRelationship, relationshipValidation } from './relationship';
import { createDebate } from './debate';
import { PLOT_AP_COST, PLOT_BASE_VALUE, PLOT_LABELS, PLOT_LEVEL_MULTIPLIER, LEGION_AP_COST, STRATEGIST_AP_COST, CAPTIVE_DISPOSE_AP_COST, applyLegionCommand, armamentYieldMultiplier, ARMAMENT_FACILITY, armamentFacilityLabel, barracksYieldMultiplier, canBuildPlot, canBuildPlotAtCoord, canDevelopWhenBlocked, cancelCityPlot, cityPlots, COMMAND_OFFICER_MAX,
                             hasEnemyUnitsNear, hasPlotFacility, isCityBlocked, isPlotOccupiedByOtherCity, patrolOrderGain, plotCost, plotCountIncludingConstructing, plotTotalLevel, recruitBaseYield, startBuildCityPlot, trainMoraleGain, UNIQUE_FACILITIES } from './innerAffairs';
import type { City, CityId, ForceId, GameCommand, GameState, Legion, Officer, TechBranchId } from './types';

export const COMMAND_AP = {
  recruit: 20,
  produceArmament: 20,
  train: 15,
  patrol: 15,
  talent: 20,
  explore: EXPLORE_AP_PER_OFFICER,
  grantTreasure: 10,
  research: RESEARCH_AP_COST,
  abilityResearch: 20,
  cultivate: 20,
  transfer: 10,
  summon: 10,
  sworn: 10,
  trade: 20,
  reward: REWARD_AP_COST,
  appointPosition: 0,
  rumor: RUMOR_AP_COST,
  poach: POACH_AP_COST,
  diplomacy: DIPLOMACY_AP_COST,
  captiveDispose: CAPTIVE_DISPOSE_AP_COST,
  marry: 10,
  legion: LEGION_AP_COST,
  buildFacilityPlot: PLOT_AP_COST,
  cancelCityPlot: 0,
  appointStrategist: STRATEGIST_AP_COST,
} as const;

/** 新征士兵的初始士气（征兵会按此值稀释城池士气） */
export const RECRUIT_TROOP_MORALE = 50;

export const COMMAND_LABELS: Record<GameCommand['type'], string> = {
  recruit: '征兵',
  produceArmament: '生产兵装',
  train: '训练',
  patrol: '巡察',
  talent: '登庸',
  explore: '探索',
  grantTreasure: '收授宝物',
  research: '科技研究',
  abilityResearch: '能力研究',
  cultivate: '培育武将',
  transfer: '移动',
  summon: '召唤',
  sworn: '义兄弟',
  trade: '商人',
  reward: '褒奖',
  appointPosition: '任命官职',
  rumor: '流言',
  poach: '挖角',
  diplomacy: '亲善',
  captiveDispose: '处置俘虏',
  marry: '仲介',
  legion: '委任军团',
  buildFacilityPlot: '开发',
  cancelCityPlot: '撤销设施',
  appointStrategist: '任命军师',
};

// 商人粮价：1金可兑换的兵粮数，每月每城在 3~7 之间独立波动（标准价5）
export const GRAIN_PRICE_MIN = 3;
export const GRAIN_PRICE_MAX = 7;
export const DEFAULT_GRAIN_PRICE = 5;
// 卖出兵粮需扣除两成手续费
const SELL_FEE_RATIO = 0.8;
// 单次交易上限（兵粮）
export const TRADE_MAX_GRAIN = 30000;
// 每旬各城商人到访概率
export const MERCHANT_ARRIVAL_CHANCE = 1 / 4;

export function grainPriceOf(city: City): number {
  const price = city.grainPrice;
  return typeof price === 'number' && price >= GRAIN_PRICE_MIN && price <= GRAIN_PRICE_MAX
    ? price
    : DEFAULT_GRAIN_PRICE;
}

export function rollGrainPrices(state: GameState): void {
  for (const city of Object.values(state.cities)) {
    const roll = nextRandom(state.seed, state.rngCursor);
    state.rngCursor = roll.cursor;
    city.grainPrice = GRAIN_PRICE_MIN + Math.floor(roll.value * (GRAIN_PRICE_MAX - GRAIN_PRICE_MIN + 1));
  }
}

// 每旬各城独立掷点决定商人是否到访（商贸城100%，其余1/4），并重置本旬交易次数
export function rollMerchants(state: GameState): void {
  for (const city of Object.values(state.cities)) {
    if (hasCityTrait(city.id, 'commerce')) {
      city.merchantPresent = true;
    } else {
      const roll = nextRandom(state.seed, state.rngCursor);
      state.rngCursor = roll.cursor;
      city.merchantPresent = roll.value < MERCHANT_ARRIVAL_CHANCE;
    }
    city.merchantTradedThisTenDay = false;
    // 训练/巡查次数每旬重置
    city.trainedThisTenDay = false;
    city.patrolledThisTenDay = false;
  }
}

// 交易效果：政治50为100%，每点政治约增减 1/350（政治81≈108%，政治100≈114%）
export function tradeEffectMultiplier(politics: number): number {
  return 1 + (politics - 50) / 350;
}

export function tradeEffectPercent(politics: number): number {
  return Math.floor(tradeEffectMultiplier(politics) * 100);
}

export interface TradeQuote {
  goldDelta: number;
  foodDelta: number;
}

// amount 统一为兵粮数量：买入时为拟购入的兵粮数（所需资金向上取整），卖出时为拟售出的兵粮数
export function quoteTrade(city: City, politics: number, mode: 'buy' | 'sell', amount: number): TradeQuote {
  const price = grainPriceOf(city);
  const effect = tradeEffectMultiplier(politics);
  if (mode === 'buy') {
    return { goldDelta: -Math.ceil(amount / (price * effect)), foodDelta: amount };
  }
  return { goldDelta: Math.floor((amount / price) * SELL_FEE_RATIO * effect), foodDelta: -amount };
}

export function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, Math.round(value)));
}

export function transferDistance(source: City, target: City) {
  return Math.abs(source.gridQ - target.gridQ) + Math.abs(source.gridR - target.gridR);
}

export function transferDuration(source: City, target: City) {
  return Math.max(1, Math.ceil(transferDistance(source, target) / 10));
}

/** 巡查费用：每 100,000 人口 50 金 */
export function patrolGoldCost(city: City): number {
  return Math.max(1, Math.ceil((city.population / 100_000) * 50));
}

function commandGoldCost(command: GameCommand, city?: City) {
  switch (command.type) {
    case 'recruit': return 800;
    case 'produceArmament': return city ? armamentCost(city, command.armamentType) : ARMAMENT_GOLD_COST;
    case 'patrol': return city ? patrolGoldCost(city) : 300;
    case 'talent': return 500;
    case 'abilityResearch': return ABILITY_RESEARCH_GOLD;
    case 'reward': return REWARD_GOLD_COST * command.officerIds.length;
    case 'rumor': return RUMOR_GOLD_COST;
    case 'poach': return POACH_GOLD_COST;
    case 'diplomacy': return command.action === 'goodwill' ? GOODWILL_GOLD_COST : 0;
    case 'buildFacilityPlot': return plotCost(command.facility);
    default: return 0;
  }
}

/** 研究下一级科技的金钱消耗 */
export function researchGoldCost(state: GameState, forceId: ForceId, branch: TechBranchId): number {
  return TECH_COSTS[techLevelOf(state, forceId, branch)]?.gold ?? 0;
}

/** 研究下一级科技的技巧P消耗（指导：消耗减半；多名执行武将中任一人持有即生效） */
export function researchTechPCost(state: GameState, forceId: ForceId, branch: TechBranchId, officerIds?: string[]): number {
  const base = TECH_COSTS[techLevelOf(state, forceId, branch)]?.techP ?? 0;
  if (!officerIds || officerIds.length === 0) return base;
  const multiplier = effectsOfKind(resolveOfficerSkills(state, officerIds), 'researchTechPCostMultiplier')
    .reduce((lowest, { effect }) => Math.min(lowest, effect.multiplier), 1);
  return Math.max(0, Math.round(base * multiplier));
}

function validateTransfer(state: GameState, forceId: ForceId, command: Extract<GameCommand, { type: 'transfer' }>) {
  const errors: string[] = [];
  const target = state.cities[command.targetCityId];
  if (!target || target.ownerId !== forceId) errors.push('只能调往己方城市');
  if (command.targetCityId === command.cityId) errors.push('目标城市不能与出发城市相同');
  if (command.officerIds.length === 0) errors.push('至少移动一名武将');
  if (isCityBlocked(state, state.cities[command.cityId])) errors.push('城池被敌方封锁，无法调动武将');

  for (const officerId of command.officerIds) {
    const officer = state.officers[officerId];
    if (!officer || officer.forceId !== forceId || officer.location.kind !== 'city' || officer.location.cityId !== command.cityId) {
      errors.push('只能移动出发城市内的己方武将');
      break;
    }
    if (officer.acted) {
      errors.push(`${officer.name}本月已行动，无法移动`);
      break;
    }
  }
  return errors;
}

/** 召唤：将本方势力其他城池的待命武将召唤至本城，耗时与移动相同 */
function validateSummon(state: GameState, forceId: ForceId, command: Extract<GameCommand, { type: 'summon' }>) {
  const errors: string[] = [];
  const target = state.cities[command.cityId];
  if (command.officerIds.length === 0) errors.push('至少召唤一名武将');
  for (const officerId of command.officerIds) {
    const officer = state.officers[officerId];
    if (!officer || officer.forceId !== forceId) {
      errors.push('只能召唤本方势力的武将');
      break;
    }
    const sourceCity = officer.location.kind === 'city' ? state.cities[officer.location.cityId] : undefined;
    if (officer.location.kind !== 'city' || !sourceCity) {
      errors.push(`只能召唤${officer.name}所在城池的待命武将`);
      break;
    }
    if (sourceCity.ownerId !== forceId) {
      errors.push('只能召唤本方势力城池的武将');
      break;
    }
    if (officer.location.cityId === command.cityId) {
      errors.push(`${officer.name}已在${target.name}，无需召唤`);
      break;
    }
    if (officer.acted) {
      errors.push(`${officer.name}本月已行动`);
      break;
    }
  }
  return errors;
}

type SingleOfficerCommand = Exclude<GameCommand, { type: 'transfer' } | { type: 'summon' } | { type: 'sworn' } | { type: 'abilityResearch' } | { type: 'explore' } | { type: 'grantTreasure' } | { type: 'appointPosition' } | { type: 'captiveDispose' } | { type: 'marry' } | { type: 'legion' } | { type: 'cancelCityPlot' } | { type: 'appointStrategist' } | { type: 'recruit' } | { type: 'produceArmament' } | { type: 'train' } | { type: 'patrol' } | { type: 'research' } | { type: 'buildFacilityPlot' } | { type: 'reward' }>;

function localOfficer(state: GameState, forceId: ForceId, command: SingleOfficerCommand) {
  const officer = state.officers[command.officerId];
  return officer?.forceId === forceId && officer.location.kind === 'city' && officer.location.cityId === command.cityId
    ? officer
    : undefined;
}

/** 多人执行指令（征兵/兵装/训练/巡查/科技研究/开发建设）：提取执行武将数组 */
export function commandOfficerIds(command: GameCommand): string[] | null {
  if (command.type === 'recruit' || command.type === 'produceArmament' || command.type === 'train'
    || command.type === 'patrol' || command.type === 'research' || command.type === 'buildFacilityPlot') {
    return command.officerIds;
  }
  return null;
}

/** 城市中可执行命令的武将（本城待命、未行动、在世） */
export function cityAvailableOfficers(state: GameState, forceId: ForceId, cityId: CityId): Officer[] {
  return Object.values(state.officers).filter(
    (officer) => officer.forceId === forceId && officer.location.kind === 'city'
      && officer.location.cityId === cityId && !officer.acted && !officer.deathMonth,
  );
}

/** 需要本城武将执行的命令类型（执行时消耗一名武将行动） */
export const OFFICER_COMMANDS: ReadonlySet<GameCommand['type']> = new Set([
  'recruit', 'produceArmament', 'train', 'patrol', 'talent', 'explore',
  'trade', 'reward', 'research', 'rumor', 'poach', 'diplomacy', 'buildFacilityPlot', 'marry', 'sworn',
]);

export function validateCommand(state: GameState, forceId: ForceId, command: GameCommand): string[] {
  const errors: string[] = [];
  const city = state.cities[command.cityId];
  if (state.phase !== 'playing') errors.push('本局已经结束');
  if (!city || city.ownerId !== forceId) errors.push('只能管理己方城市');

  // 需要武将执行的命令：本城无可用（待命未行动）武将时统一拦截
  if (city && city.ownerId === forceId && OFFICER_COMMANDS.has(command.type)
    && cityAvailableOfficers(state, forceId, city.id).length === 0) {
    errors.push('城中没有可行动的武将');
  }

  // 褒奖：可勾选多位本城待命的己方武将（不受行动状态限制），按忠诚从低到高排序由 UI 决定
  if (command.type === 'reward') {
    const invited = command.officerIds;
    if (invited.length === 0) {
      errors.push('至少选择一名褒奖武将');
    } else if (new Set(invited).size !== invited.length) {
      errors.push('褒奖武将不可重复');
    } else {
      for (const officerId of invited) {
        const officer = state.officers[officerId];
        if (!officer || officer.forceId !== forceId) {
          errors.push('只能褒奖己方武将');
          break;
        }
        if (officerIsOnCampaign(state, officerId)) {
          errors.push('只能褒奖本势力未出征的武将');
          break;
        }
        if (officer.id === state.forces[forceId]?.leaderId) {
          errors.push('不能褒奖君主');
          break;
        }
        if (officer.rewarded) {
          errors.push(`${officer.name}本旬已受褒奖`);
          break;
        }
      }
    }
  }

  if (command.type !== 'transfer' && command.type !== 'summon' && command.type !== 'sworn' && command.type !== 'abilityResearch' && command.type !== 'explore' && command.type !== 'grantTreasure' && command.type !== 'appointPosition' && command.type !== 'captiveDispose' && command.type !== 'marry' && command.type !== 'legion' && command.type !== 'cancelCityPlot' && command.type !== 'appointStrategist' && command.type !== 'reward') {
    const officerIds = commandOfficerIds(command);
    if (officerIds) {
      // 多人执行指令：1~3名本城待命、未行动、不重复的己方武将
      if (officerIds.length === 0) {
        errors.push('至少指派一名武将');
      } else if (officerIds.length > COMMAND_OFFICER_MAX) {
        errors.push(`至多指派${COMMAND_OFFICER_MAX}名武将`);
      } else if (new Set(officerIds).size !== officerIds.length) {
        errors.push('执行武将不可重复');
      } else {
        for (const officerId of officerIds) {
          const officer = state.officers[officerId];
          if (!officer || officer.forceId !== forceId || officer.location.kind !== 'city' || officer.location.cityId !== command.cityId) {
            errors.push('只能指派本城待命的己方武将');
            break;
          }
          if (officer.acted) {
            errors.push(`${officer.name}本月已行动`);
            break;
          }
        }
      }
    } else {
      const officer = localOfficer(state, forceId, command as SingleOfficerCommand);
      if (!officer) {
        errors.push('武将不在目标城市');
      } else if (officer.acted) {
        errors.push(`${officer.name}本月已行动`);
      }
    }
  }

  if (command.type === 'explore') {
    const count = command.officerIds.length;
    if (count === 0) {
      errors.push('至少指派一名武将探索');
    } else {
      for (const officerId of command.officerIds) {
        const officer = state.officers[officerId];
        if (!officer || officer.forceId !== forceId || officer.location.kind !== 'city' || officer.location.cityId !== command.cityId) {
          errors.push('只能指派本城待命的己方武将');
          break;
        }
        if (officer.acted) {
          errors.push(`${officer.name}本月已行动`);
          break;
        }
      }
      const apCost = EXPLORE_AP_PER_OFFICER * count;
      if (state.actionPoints[forceId] < apCost) errors.push(`行动力不足 ${apCost}`);
      if (city.gold < EXPLORE_GOLD_PER_OFFICER * count) errors.push(`资金不足 ${EXPLORE_GOLD_PER_OFFICER * count}`);
    }
  }

  if (command.type === 'grantTreasure') {
    const treasure = state.treasures?.[command.treasureId];
    if (!treasure || treasure.ownerId !== forceId) {
      errors.push('只能授予本势力已出土的宝物');
    } else if (command.officerId) {
      const officer = state.officers[command.officerId];
      if (!officer || officer.forceId !== forceId) errors.push('只能授予己方武将');
    }
  }

  if (command.type === 'appointPosition') {
    const officer = state.officers[command.officerId];
    if (!officer || officer.forceId !== forceId) {
      errors.push('只能任命己方武将官职');
    } else if (state.forces[forceId]?.leaderId === officer.id) {
      errors.push('君主无需任命官职');
    } else if (officerIsOnCampaign(state, officer.id)) {
      errors.push(`${officer.name}正带部队在城外，无法任免官职`);
    } else if (command.positionId) {
      const position = positionDefinition(command.positionId);
      if (!position) {
        errors.push('官职无效');
      } else {
        if (officerMerit(officer) < position.merit) errors.push(`功绩不足 ${position.merit}`);
        if (rankIndex(forceRankOf(state, forceId)) < rankIndex(position.rankNeeded)) errors.push(`爵位不足（需${rankDefinition(position.rankNeeded).name}）`);
      }
    }
  }

  if (command.type === 'talent') {
    if (state.debateSession && state.debateSession.status === 'ongoing') {
      errors.push('已有舌战正在进行');
    } else {
      const target = findLocalTalent(state, city);
      if (!target) {
        errors.push('本城没有可登用的在野武将');
      } else if (target.bannedUntilMonth && target.bannedUntilMonth > state.month) {
        errors.push(`${target.name}短期内不愿仕官，暂时无法登用`);
      }
      if (city.gold < 500) errors.push('资金不足 500');
    }
  }

  if (command.type === 'rumor') {
    const target = state.cities[command.targetCityId];
    if (!target || !target.ownerId || target.ownerId === forceId) errors.push('只能对敌城散布流言');
  }

  if (command.type === 'poach') {
    const officer = state.officers[command.officerId];
    const target = state.officers[command.targetOfficerId];
    if (!officer || officer.forceId !== forceId || officer.location.kind !== 'city' || officer.location.cityId !== command.cityId) {
      errors.push('执行武将不在本城待命');
    } else if (officer.acted) {
      errors.push(`${officer.name}本月已行动`);
    }
    if (!target || !canPoach(state, forceId, target)) errors.push('该目标无法挖角');
    else if (target.location.kind !== 'city' || target.location.cityId !== command.targetCityId) errors.push('目标武将不在所选城市');
  }

  if (command.type === 'diplomacy') {
    if (command.targetForceId === forceId) {
      errors.push('不能对己方势力外交');
    } else if (!state.forces[command.targetForceId]) {
      errors.push('目标势力无效');
    } else if (command.action === 'goodwill') {
      if (city.gold < GOODWILL_GOLD_COST) errors.push(`资金不足 ${GOODWILL_GOLD_COST}`);
    } else if (command.action === 'alliance' || command.action === 'truce') {
      const gold = command.gold ?? 0;
      if (gold < 0 || gold > city.gold) errors.push('资金不足');
      if (gold > DIPLOMACY_GOLD_MAX) errors.push(`最多送出${DIPLOMACY_GOLD_MAX.toLocaleString('en-US')}金`);
      if (command.action === 'truce') {
        const months = command.months ?? 0;
        if (months < TRUCE_MONTHS_MIN || months > TRUCE_MONTHS_MAX) errors.push(`停战期限须在${TRUCE_MONTHS_MIN}~${TRUCE_MONTHS_MAX}个月`);
      } else if (areAllies(state, forceId, command.targetForceId)) {
        errors.push('双方已是同盟');
      }
    } else if (command.action === 'requestTroops') {
      if (!areAllies(state, forceId, command.targetForceId)) errors.push('仅同盟可请求援军');
    } else if (command.action === 'break') {
      if (!areAllies(state, forceId, command.targetForceId)) errors.push('双方并非同盟');
    }
  }

  if (command.type === 'captiveDispose') {
    const target = state.officers[command.targetOfficerId];
    if (!target || target.location.kind !== 'captive' || target.location.captorForceId !== forceId) {
      errors.push('只能处置本势力关押的俘虏');
    } else if (command.action === 'recruit' && !capturableByLoyalty(target)) {
      errors.push(`俘虏忠诚未降至${CAPTIVE_RECRUIT_LOYALTY_THRESHOLD}以下，暂时无法登用`);
    }
  }

  if (command.type === 'marry') {
    const a = state.officers[command.officerIdA];
    const b = state.officers[command.officerIdB];
    if (!a || !b) {
      errors.push('武将无效');
    } else {
      errors.push(...relationshipValidation(state, forceId, a, b, command.relation === 'sworn' ? 'sworn' : 'spouse'));
      if (a.acted) errors.push(`${a.name}本月已行动`);
      if (b.acted) errors.push(`${b.name}本月已行动`);
    }
    if ((state.forces[forceId]?.techP ?? 0) < MARRY_TECHP_COST) errors.push(`技巧P不足 ${MARRY_TECHP_COST}`);
  }

  if (command.type === 'sworn') {
    const officers = command.officerIds.map((id) => state.officers[id]).filter((o): o is Officer => Boolean(o));
    if (command.officerIds.length < 2) {
      errors.push('至少选择两名武将结义');
    } else if (command.officerIds.length > 3) {
      errors.push('至多选择三名武将结义');
    } else if (officers.length !== command.officerIds.length) {
      errors.push('武将无效');
    } else if (new Set(command.officerIds).size !== command.officerIds.length) {
      errors.push('结义武将不可重复');
    } else {
      const genders = new Set(officers.map((o) => o.gender ?? 'male'));
      if (genders.size > 1) errors.push('结义双方性别须相同');
      const leaderId = state.forces[forceId]?.leaderId;
      for (const officer of officers) {
        if (officer.forceId !== forceId) errors.push(`只能与己方武将结义（${officer.name}）`);
        if (officer.id === leaderId) errors.push('君主不能参与结义');
        if (officer.location.kind !== 'city' || officer.location.cityId !== command.cityId) errors.push(`${officer.name}必须在本城待命`);
        if (officer.acted) errors.push(`${officer.name}本月已行动`);
        if (officer.deathMonth) errors.push('已故武将无法结义');
      }
      for (let i = 0; i < officers.length; i++) {
        for (let j = i + 1; j < officers.length; j++) {
          if (areRelated(officers[i], officers[j])) errors.push(`${officers[i].name}与${officers[j].name}已结为关系`);
        }
      }
    }
    if ((state.forces[forceId]?.techP ?? 0) < MARRY_TECHP_COST) errors.push(`技巧P不足 ${MARRY_TECHP_COST}`);
  }

  if (command.type === 'legion') {
    if (command.commanderId && command.commanderId !== 'none') {
      const commander = state.officers[command.commanderId];
      if (!commander || commander.forceId !== forceId) errors.push('军团长必须是己方武将');
    } else if (!command.targetCityId) {
      errors.push('缺少解散目标城市');
    }
  }

  if (command.type === 'buildFacilityPlot') {
    const plot = cityPlots(city)[command.plotIndex];
    if (!plot) errors.push('该地格无法建设');
    else if (plot.constructing) errors.push('该地格正在建设中，请选择空闲的建设用地');
    else if (plot.type !== 'empty') errors.push('该地格已有设施，请选择空闲的建设用地');
    // 检查该地块坐标是否已被其他城市占用（防止旧存档建设用地重叠）
    else if (plot.q != null && plot.r != null && isPlotOccupiedByOtherCity(state, city.id, plot.q, plot.r)) {
      errors.push('该地块已被其他城市占用');
    }
    // 城池特性限制：水港才能建造船厂，学术才能建太学
    if (!cityCanBuildFacility(city.id, command.facility)) {
      errors.push(command.facility === 'shipyard' ? '只有水港城市可以建造船厂' : '只有学术城市可以建造太学');
    }
    // 一城限一设施（造币/谷仓/大市场/鱼市/军屯农/六部/太学/铜雀台）：建设中也占用名额
    if (UNIQUE_FACILITIES.includes(command.facility) && plotCountIncludingConstructing(city, command.facility) > 0) {
      errors.push('该设施一城只能建造一座（同类型正在建设中）');
    }
    if (city.gold < plotCost(command.facility)) errors.push(`资金不足 ${plotCost(command.facility)}`);
    if (!canDevelopWhenBlocked(state, city)) errors.push('城池被敌方封锁，无法开发建设');
  }

  if (command.type === 'cancelCityPlot') {
    const plots = cityPlots(city);
    const plot = plots[command.plotIndex];
    if (!plot || (plot.type === 'empty' && !plot.constructing)) errors.push('该地格没有设施可撤销');
    else if (plot.q != null && plot.r != null && hasEnemyUnitsNear(state, forceId, plot.q, plot.r, 2)) {
      errors.push('有敌军在设施附近，无法撤销');
    }
  }

  if (command.type === 'appointStrategist') {
    if (command.officerId) {
      const officer = state.officers[command.officerId];
      if (!officer || officer.forceId !== forceId) errors.push('只能任命己方武将担任军师');
      else if (officer.location.kind === 'captive') errors.push('俘虏不可担任军师');
    }
  }

  if (state.actionPoints[forceId] < COMMAND_AP[command.type]) {
    errors.push(`行动力不足 ${COMMAND_AP[command.type]}`);
  }
  if (!city) return [...new Set(errors)];

  const goldCost = commandGoldCost(command, city);
  if (city.gold < goldCost) errors.push(`资金不足 ${goldCost}`);
  if (command.type === 'recruit') {
    if (!hasPlotFacility(city, 'barracks')) errors.push('需先建设兵舍才能征兵');
    if (city.food < 500) errors.push('兵粮不足 500');
    if (city.population < 500) errors.push('人口不足 500');
  }
  if (command.type === 'train') {
    if (city.trainedThisTenDay) errors.push('本旬该城已训练');
    if (city.food < 300) errors.push('兵粮不足 300');
  }
  if (command.type === 'patrol' && city.patrolledThisTenDay) errors.push('本旬该城已巡查');
  if (command.type === 'produceArmament') {
    if (!ARMAMENT_TYPES.includes(command.armamentType)) {
      errors.push('兵装类型无效');
    } else if (!hasPlotFacility(city, ARMAMENT_FACILITY[command.armamentType])) {
      errors.push(`需先建设${armamentFacilityLabel(command.armamentType)}才能生产`);
    }
  }
  if (command.type === 'trade') {
    if (isCityBlocked(state, city)) {
      errors.push('城池被敌方封锁，无法进行交易');
    } else if (!city.merchantPresent) {
      errors.push('商人本旬未到访');
    } else if (city.merchantTradedThisTenDay) {
      errors.push('本旬已完成一次粮食交易');
    } else if (!Number.isInteger(command.amount) || command.amount <= 0) {
      errors.push('交易数量必须为正整数');
    } else if (command.amount > TRADE_MAX_GRAIN) {
      errors.push(`单次交易最多${TRADE_MAX_GRAIN.toLocaleString('en-US')}兵粮`);
    } else if (command.mode === 'sell' && command.amount > city.food) {
      errors.push('兵粮不足');
    } else if (command.mode === 'buy') {
      const officer = localOfficer(state, forceId, command);
      const goldCost = Math.ceil(command.amount / (grainPriceOf(city) * tradeEffectMultiplier(officer?.stats.politics ?? 50)));
      if (goldCost > city.gold) errors.push('资金不足');
    }
  }
  if (command.type === 'research') {
    const branch = TECH_BRANCHES.find((candidate) => candidate.id === command.branch);
    if (!branch) errors.push('科技方向无效');
    else {
      const level = techLevelOf(state, forceId, command.branch);
      if (level >= MAX_TECH_LEVEL) errors.push('该方向科技已研究完毕');
      else {
        const cost = TECH_COSTS[level];
        if (city.gold < cost.gold) errors.push(`资金不足 ${cost.gold}`);
        const requiredTechP = researchTechPCost(state, forceId, command.branch, command.officerIds);
        if ((state.forces[forceId]?.techP ?? 0) < requiredTechP) errors.push(`技巧P不足 ${requiredTechP}`);
        // 每旬每势力同时只能研究一项（含城间）
        const busy = Object.values(state.officers).some((officer) =>
          officer.forceId === forceId && officer.location.kind === 'task' && officer.location.task === 'research');
        if (busy) errors.push('已有科技正在研究中');
      }
    }
  }
  if (command.type === 'abilityResearch') {
    const node = ABILITY_NODE_MAP[command.nodeId];
    const activeNode = state.forces[forceId]?.abilityResearch?.active;
    if (activeNode) errors.push('已有能力正在研究中');
    else if (!node) errors.push('能力节点无效');
    else {
      const status = abilityNodeStatus(state, forceId, node);
      if (status === 'done') errors.push('该能力已研究完成');
      else if (status === 'locked') errors.push('前置能力尚未研究');
    }
  }
  if (command.type === 'cultivate') {
    const node = ABILITY_NODE_MAP[command.nodeId];
    const officer = localOfficer(state, forceId, command);
    if (!node) {
      errors.push('能力节点无效');
    } else if (abilityNodeStatus(state, forceId, node) !== 'done') {
      errors.push('该能力尚未研究完成');
    } else if (abilityCultivateRemaining(state, forceId, node.id) <= 0) {
      errors.push('该能力培育次数已用完');
    } else if (officer && !canCultivateOfficer(officer, node)) {
      errors.push(node.kind === 'aptitude' ? '该武将适性不符合培育条件' : '该武将能力已达上限');
    }
  }
  if (command.type === 'transfer') errors.push(...validateTransfer(state, forceId, command));
  if (command.type === 'summon') errors.push(...validateSummon(state, forceId, command));
  return [...new Set(errors)];
}

function findLocalTalent(state: GameState, city: City) {
  return Object.values(state.officers).find((officer) =>
    officer.forceId === null && officer.location.kind === 'unaffiliated' && officer.location.cityId === city.id,
  );
}

function resolveTalentSearch(state: GameState, forceId: ForceId, city: City, officer: Officer) {
  const talent = findLocalTalent(state, city);
  const roll = nextRandom(state.seed, state.rngCursor);
  state.rngCursor = roll.cursor;
  const chance = Math.min(85, 35 + Math.floor(officer.stats.intelligence / 2)) / 100;
  if (talent && roll.value < chance) {
    talent.forceId = forceId;
    talent.location = { kind: 'city', cityId: city.id };
    talent.cityId = city.id;
    talent.loyalty = recruitmentInitialLoyalty(talent);
    addTechP(state, forceId, 150);
    return `${officer.name}在${city.name}登用了${talent.name}`;
  }
  return talent
    ? `${officer.name}尝试登用${talent.name}，但未能登用`
    : `${officer.name}在${city.name}搜索人才，但一无所获`;
}

/** 探索结算：人才 → 宝物 → 小份金钱，逐人独立掷点 */
function resolveExplore(state: GameState, forceId: ForceId, city: City, officer: Officer) {
  const parts: string[] = [];

  const talent = findLocalTalent(state, city);
  // 眼力：搜索时必定发现在野人才
  const eyeForTalent = effectsOfKind(resolveOfficerSkills(state, [officer.id]), 'exploreTalentGuaranteed').length > 0;
  const talentRoll = nextRandom(state.seed, state.rngCursor);
  state.rngCursor = talentRoll.cursor;
  const talentChance = Math.min(85, 35 + Math.floor(officer.stats.intelligence / 2)) / 100;
  if (talent && (eyeForTalent || talentRoll.value < talentChance)) {
    talent.forceId = forceId;
    talent.location = { kind: 'city', cityId: city.id };
    talent.cityId = city.id;
    talent.loyalty = recruitmentInitialLoyalty(talent);
    addTechP(state, forceId, 150);
    parts.push(`登用了${talent.name}`);
  } else if (talent) {
    parts.push(`尝试登用${talent.name}，但未能登用`);
  }

  const buried = Object.values(state.treasures ?? {}).filter((item) => item.ownerId === null && item.cityId === city.id);
  if (buried.length > 0) {
    const treasureRoll = nextRandom(state.seed, state.rngCursor);
    state.rngCursor = treasureRoll.cursor;
    const treasureChance = EXPLORE_TREASURE_BASE_CHANCE + (officer.stats.intelligence / 100) * EXPLORE_TREASURE_INT_BONUS_MAX;
    if (treasureRoll.value < treasureChance) {
      const found = buried[Math.min(buried.length - 1, Math.floor(treasureRoll.value * buried.length * 10) % buried.length)];
      found.ownerId = forceId;
      found.cityId = null;
      found.holderId = null;
      parts.push(`发现了宝物「${treasureDefinition(found.id)?.name ?? found.id}」，已归主公所有`);
    }
  }

  const goldRoll = nextRandom(state.seed, state.rngCursor);
  state.rngCursor = goldRoll.cursor;
  if (goldRoll.value < EXPLORE_GOLD_CHANCE) {
    const amountRoll = nextRandom(state.seed, state.rngCursor);
    state.rngCursor = amountRoll.cursor;
    const gold = EXPLORE_GOLD_MIN + Math.floor(amountRoll.value * (EXPLORE_GOLD_MAX - EXPLORE_GOLD_MIN + 1));
    city.gold += gold;
    parts.push(`拾得金钱${gold}`);
  }

  if (parts.length === 0) return `${officer.name}在${city.name}探索，一无所获`;
  return `${officer.name}在${city.name}探索，${parts.join('，')}`;
}

/** 装备/卸下宝物时同步增减武将五维（卸下精确还原） */
function applyTreasureStatDelta(officer: Officer, treasureId: string, sign: 1 | -1) {
  const definition = treasureDefinition(treasureId);
  if (!definition) return;
  for (const [key, bonus] of Object.entries(definition.stats)) {
    officer.stats[key as keyof Officer['stats']] += sign * (bonus ?? 0);
  }
}

function applyTransfer(state: GameState, command: Extract<GameCommand, { type: 'transfer' }>) {
  const source = state.cities[command.cityId];
  const target = state.cities[command.targetCityId];
  const duration = transferDuration(source, target);
  const names: string[] = [];
  for (const officerId of command.officerIds) {
    const officer = state.officers[officerId];
    names.push(officer.name);
    // 若为出发城太守，调离后该城太守空缺
    if (source.governorId === officerId) source.governorId = null;
    officer.location = {
      kind: 'transfer',
      fromCityId: command.cityId,
      targetCityId: command.targetCityId,
      remainingTenDays: duration,
    };
    officer.cityId = command.cityId;
    officer.acted = true;
  }
  return `${source.name}向${target.name}移动${names.join('、')}，预计${duration}旬抵达`;
}

/** 召唤结算：各武将自所在城池向本城移动，耗时与移动相同 */
function applySummon(state: GameState, command: Extract<GameCommand, { type: 'summon' }>) {
  const target = state.cities[command.cityId];
  const parts: string[] = [];
  for (const officerId of command.officerIds) {
    const officer = state.officers[officerId];
    const source = state.cities[officer.location.kind === 'city' ? officer.location.cityId : command.cityId];
    const duration = transferDuration(source, target);
    // 若为所在城太守，被召唤后该城太守空缺
    if (source.governorId === officerId) source.governorId = null;
    officer.location = {
      kind: 'transfer',
      fromCityId: source.id,
      targetCityId: command.cityId,
      remainingTenDays: duration,
    };
    // cityId 保留在原出发城池（与移动一致），抵达后再归属本城
    officer.acted = true;
    parts.push(`${officer.name}自${source.name}向${target.name}移动，预计${duration}旬抵达`);
  }
  return parts.join('；');
}

export function executeCommand(state: GameState, forceId: ForceId, command: GameCommand): GameState {
  const errors = validateCommand(state, forceId, command);
  if (errors.length > 0) throw new Error(errors.join('；'));

  const next = structuredClone(state);
  const city = next.cities[command.cityId];
  let message = '';
  next.battleDamageReports = [];
  next.cityEffectReports = [];
  next.strategyResultReports = [];

  switch (command.type) {
    case 'recruit': {
      const officers = command.officerIds.map((officerId) => next.officers[officerId]);
      const names = officers.map((officer) => officer.name).join('、');
      // 征兵量 = 1000 + 魅力总和 × (治安+20) × 5 ÷ 100，再乘特技/科技/兵舍修正
      const baseGain = recruitBaseYield(officers, city);
      const gain = Math.round(baseGain * commandYieldMultiplier(next, command)
        * recruitMultiplier(next, forceId) * barracksYieldMultiplier(city));
      city.gold -= 800;
      city.food -= 500;
      city.population -= 500;
      // 新征士兵士气50，稀释城池士气：(原有士兵×原有士气 + 新增士兵×50) ÷ 征兵后总士兵
      // 劲勇城：新征士兵士气以势力最大士气值计算
      const prevTroops = city.troops;
      const prevTraining = hasCityTrait(city.id, 'valor')
        ? forceMaxTraining((Object.keys(next.cities) as CityId[]).filter((id) => next.cities[id].ownerId === forceId), next.cities)
        : city.training;
      city.troops += gain;
      city.training = Math.round(clamp((prevTroops * prevTraining + gain * RECRUIT_TROOP_MORALE) / city.troops, 0, 100));
      city.order = clamp(city.order - 2, 0, 100);
      addTechP(next, forceId, TECHP_PER_CIVIL_ACTION);
      message = `${names}在${city.name}征募士兵${gain.toLocaleString('en-US')}`;
      next.cityEffectReports = [{
        id: `city-effect-${next.month}-${next.logs.length}`,
        cityId: city.id,
        q: city.gridQ,
        r: city.gridR,
        amount: gain,
        label: '士兵',
        kind: 'recruit',
      }];
      for (const officer of officers) officer.acted = true;
      break;
    }
    case 'produceArmament': {
      const officers = command.officerIds.map((officerId) => next.officers[officerId]);
      const names = officers.map((officer) => officer.name).join('、');
      const current = armamentsOf(city.armaments);
      // 生产数量 = 1000 + 最高智力×10 + 其余2人智力各×5，再乘特技/设施修正
      const baseGain = produceArmamentYield(officers, command.armamentType);
      const gain = Math.round(baseGain * commandYieldMultiplier(next, command)
        * armamentYieldMultiplier(city, command.armamentType));
      city.gold -= armamentCost(city, command.armamentType);
      if (isDelayedArmament(command.armamentType)) {
        // 兵器/舰船：按综合智力计算工期，逐旬推进（发明/造船特技日数减半）
        const tenDays = armamentProductionTenDays(officers, armamentProductionSpeedMultiplier(next, command));
        for (const [index, officer] of officers.entries()) {
          officer.location = {
            kind: 'task',
            cityId: city.id,
            task: 'armament',
            armamentType: command.armamentType,
            amount: gain,
            remainingTenDays: tenDays,
            lead: index === 0,
          };
        }
        addTechP(next, forceId, TECHP_PER_PRODUCE_ARMAMENT);
        message = `${names}开始生产${city.name}${ARMAMENT_LABELS[command.armamentType]}，预计${tenDays}旬完成`;
      } else {
        city.armaments = {
          ...current,
          [command.armamentType]: current[command.armamentType] + gain,
        };
        addTechP(next, forceId, TECHP_PER_PRODUCE_ARMAMENT);
        message = `${names}生产${city.name}${ARMAMENT_LABELS[command.armamentType]}，增加了${gain.toLocaleString('en-US')}`;
        next.cityEffectReports = [{
          id: `city-effect-${next.month}-${next.logs.length}`,
          cityId: city.id,
          q: city.gridQ,
          r: city.gridR,
          amount: gain,
          label: ARMAMENT_LABELS[command.armamentType],
          kind: 'armament',
        }];
      }
      for (const officer of officers) officer.acted = true;
      break;
    }
    case 'train': {
      const officers = command.officerIds.map((officerId) => next.officers[officerId]);
      const names = officers.map((officer) => officer.name).join('、');
      city.food -= 300;
      city.trainedThisTenDay = true;
      // 气力提升 = 【(武力总和 + 武力最大值) ÷ 基数】+ 3，基数 = 士兵数÷2000 + 20
      // 兵部：城池建有兵部时训练效果翻倍
      let gain = trainMoraleGain(officers, city.troops);
      if (hasPlotFacility(city, 'bingbu')) gain *= 2;
      city.training = clamp(city.training + gain, 0, 100);
      addTechP(next, forceId, TECHP_PER_TRAIN);
      message = `${names}训练${city.name}守军，气力+${gain}`;
      for (const officer of officers) officer.acted = true;
      break;
    }
    case 'patrol': {
      const officers = command.officerIds.map((officerId) => next.officers[officerId]);
      const names = officers.map((officer) => officer.name).join('、');
      city.gold -= patrolGoldCost(city);
      city.patrolledThisTenDay = true;
      // 治安提升 = 【统率总和 ÷ 28】+ 2
      const gain = patrolOrderGain(officers);
      city.order = clamp(city.order + gain, 0, 100);
      addTechP(next, forceId, TECHP_PER_PATROL);
      message = `${names}巡察${city.name}，治安+${gain}`;
      for (const officer of officers) officer.acted = true;
      break;
    }
    case 'talent': {
      const officer = next.officers[command.officerId];
      city.gold -= 500;
      const target = findLocalTalent(next, city);
      if (!target) {
        message = `${officer.name}在${city.name}登庸人才，但城中无在野武将`;
        break;
      }
      // 登庸触发舌战：胜利则登用，失败则目标短期禁仕
      next.debateSession = createDebate(next, officer, target);
      next.logs.push({
        id: `debate-start-${next.month}-${next.rngCursor}`,
        month: next.month,
        forceId,
        message: `${officer.name}向${target.name}发起说客舌战`,
      });
      message = `${officer.name}与${target.name}舌战开始`;
      officer.acted = true;
      break;
    }
    case 'explore': {
      const reports = command.officerIds.map((officerId) => {
        const officer = next.officers[officerId];
        city.gold -= EXPLORE_GOLD_PER_OFFICER;
        officer.acted = true;
        return resolveExplore(next, forceId, city, officer);
      });
      message = reports.join('；');
      break;
    }
    case 'grantTreasure': {
      const treasure = next.treasures?.[command.treasureId];
      if (treasure) {
        const treasureName = treasureDefinition(treasure.id)?.name ?? treasure.id;
        const previousHolder = treasure.holderId ? next.officers[treasure.holderId] : undefined;
        if (previousHolder) {
          applyTreasureStatDelta(previousHolder, treasure.id, -1);
          previousHolder.treasureId = undefined;
        }
        const target = command.officerId ? next.officers[command.officerId] : undefined;
        if (target) {
          // 目标已装备其它宝物时先卸下
          if (target.treasureId && target.treasureId !== treasure.id) {
            const oldTreasure = next.treasures?.[target.treasureId];
            applyTreasureStatDelta(target, target.treasureId, -1);
            if (oldTreasure) oldTreasure.holderId = null;
          }
          applyTreasureStatDelta(target, treasure.id, 1);
          target.treasureId = treasure.id;
          treasure.holderId = target.id;
          message = `将宝物「${treasureName}」授予${target.name}`;
        } else {
          treasure.holderId = null;
          message = previousHolder ? `收回${previousHolder.name}装备的宝物「${treasureName}」` : `收回宝物「${treasureName}」`;
        }
      }
      break;
    }
    case 'research': {
      const officers = command.officerIds.map((officerId) => next.officers[officerId]);
      const names = officers.map((officer) => officer.name).join('、');
      const branchDef = TECH_BRANCHES.find((candidate) => candidate.id === command.branch)!;
      const level = techLevelOf(next, forceId, command.branch);
      const cost = TECH_COSTS[level];
      city.gold -= cost.gold;
      const force = next.forces[forceId];
      // 指导：研究技巧P消耗减半（多名执行武将中任一人持有即生效）
      force.techP = Math.max(0, (force.techP ?? 0) - researchTechPCost(next, forceId, command.branch, command.officerIds));
      // 相关能力纯等权重加和：枪/戟/弩/骑兵→统率，军制/内政→政治
      const statSum = officers.reduce((sum, officer) => sum + (branchDef.researchStat === 'leadership'
        ? officer.stats.leadership
        : officer.stats.politics), 0);
      const tenDays = researchTenDays(cost.baseDays, statSum);
      for (const [index, officer] of officers.entries()) {
        officer.location = {
          kind: 'task',
          cityId: city.id,
          task: 'research',
          branch: command.branch,
          remainingTenDays: tenDays,
          lead: index === 0,
        };
      }
      for (const officer of officers) officer.acted = true;
      message = `${names}在${city.name}开始研究${branchDef.name}系「${branchDef.levels[level].name}」，预计${tenDays}旬完成`;
      break;
    }
    case 'abilityResearch': {
      const node = ABILITY_NODE_MAP[command.nodeId];
      city.gold -= ABILITY_RESEARCH_GOLD;
      const force = next.forces[forceId];
      const current = force.abilityResearch ?? { researched: [], remaining: {} };
      force.abilityResearch = {
        ...current,
        active: { nodeId: node.id, remainingMonths: node.months },
      };
      message = `${force.name}开始研究能力「${node.label}」，预计${node.months}个月完成，耗金${ABILITY_RESEARCH_GOLD}`;
      break;
    }
    case 'cultivate': {
      const officer = next.officers[command.officerId];
      const node = ABILITY_NODE_MAP[command.nodeId];
      officer.location = {
        kind: 'task',
        cityId: city.id,
        task: 'cultivate',
        nodeId: node.id,
        remainingTenDays: CULTIVATE_TEN_DAYS,
      };
      officer.acted = true;
      message = `${officer.name}开始培育「${node.label}」，预计${CULTIVATE_TEN_DAYS}旬完成`;
      break;
    }
    case 'trade': {
      const officer = next.officers[command.officerId];
      const quote = quoteTrade(city, officer.stats.politics, command.mode, command.amount);
      city.gold += quote.goldDelta;
      city.food += quote.foodDelta;
      city.merchantTradedThisTenDay = true;
      addTechP(next, forceId, TECHP_PER_TRADE);
      const price = grainPriceOf(city);
      message = command.mode === 'buy'
        ? `${officer.name}在${city.name}以1金${price}粮的价格购入${quote.foodDelta.toLocaleString('en-US')}兵粮，耗金${(-quote.goldDelta).toLocaleString('en-US')}`
        : `${officer.name}在${city.name}以1金${price}粮的价格卖出${command.amount.toLocaleString('en-US')}兵粮，得金${quote.goldDelta.toLocaleString('en-US')}`;
      officer.acted = true;
      break;
    }
    case 'transfer':
      message = applyTransfer(next, command);
      break;
    case 'summon':
      message = applySummon(next, command);
      break;
    case 'reward': {
      const names: string[] = [];
      for (const officerId of command.officerIds) {
        const officer = next.officers[officerId];
        const current = officerLoyalty(officer);
        setOfficerLoyalty(officer, current + REWARD_LOYALTY_GAIN);
        officer.rewarded = true;
        names.push(`${officer.name} ${current} → ${officerLoyalty(officer)}`);
      }
      city.gold -= REWARD_GOLD_COST * command.officerIds.length;
      message = `褒奖${names.join('、')}，忠诚+${REWARD_LOYALTY_GAIN}`;
      break;
    }
    case 'appointPosition': {
      const officer = next.officers[command.officerId];
      const previous = officer.positionId;
      applyPositionStatDelta(officer, previous, -1);
      if (command.positionId) {
        const position = positionDefinition(command.positionId);
        if (position) {
          applyPositionStatDelta(officer, command.positionId, 1);
          officer.positionId = command.positionId;
          message = `任命${officer.name}为「${position.name}」，指挥兵数上限提升至${position.troopCommand}`;
        }
      } else {
        officer.positionId = undefined;
        message = `免去${officer.name}的官职`;
      }
      break;
    }
    case 'rumor': {
      const officer = next.officers[command.officerId];
      const target = next.cities[command.targetCityId];
      city.gold -= RUMOR_GOLD_COST;
      const result = resolveRumor(next, officer, target);
      officer.acted = true;
      if (result.captured) {
        officer.location = {
          kind: 'captive',
          cityId: target.id,
          // 散布流言仅可对敌城执行（上方校验 target.ownerId 非空）
          captorForceId: target.ownerId!,
          capturedTenDays: 0,
        };
        officer.cityId = target.id;
        message = `${officer.name}向${target.name}散布流言时被识破逮捕，沦为俘虏！`;
      } else if (result.success) {
        const loyaltyPart = result.loyaltyLosses.length > 0
          ? `，${result.loyaltyLosses.map((l) => `${l.name}忠诚 ${l.before}→${l.after}`).join('、')}`
          : '';
        message = `${officer.name}在${target.name}散布流言成功，治安下降${result.orderLoss}${loyaltyPart}`;
      } else {
        message = `${officer.name}向${target.name}散布流言失败，未能动摇民心`;
      }
      break;
    }
    case 'poach': {
      const officer = next.officers[command.officerId];
      const target = next.officers[command.targetOfficerId];
      city.gold -= POACH_GOLD_COST;
      const result = resolvePoach(next, officer, target);
      officer.acted = true;
      message = result.success
        ? `${officer.name}成功说服${target.name}弃暗投明，正式加入${next.forces[forceId].name}！`
        : `${officer.name}试图挖角${target.name}，未能成功${result.bannedUntilMonth ? `（${target.name}短期内无法再被登用）` : ''}`;
      break;
    }
    case 'diplomacy': {
      const officer = next.officers[command.officerId];
      const targetForce = next.forces[command.targetForceId];
      const fromAllies = next.forces[forceId].allies ?? [];
      const toAllies = next.forces[command.targetForceId].allies ?? [];
      officer.acted = true;
      switch (command.action) {
        case 'goodwill': {
          city.gold -= GOODWILL_GOLD_COST;
          const gain = goodwillGain(next, forceId, command.targetForceId, officer);
          adjustDiplomacy(next, forceId, command.targetForceId, gain);
          message = `${officer.name}出使${targetForce.name}，增进双方友好度 ${gain}`;
          break;
        }
        case 'alliance': {
          const gold = command.gold ?? 0;
          city.gold -= gold;
          const result = resolveAlliance(next, forceId, command.targetForceId, officer, gold);
          if (result.success) {
            next.forces[forceId].allies = [...fromAllies, command.targetForceId];
            next.forces[command.targetForceId].allies = [...toAllies, forceId];
            adjustDiplomacy(next, forceId, command.targetForceId, 30);
            message = `${officer.name}促成与${targetForce.name}的同盟！从此互不侵犯、可请求援军`;
          } else {
            adjustDiplomacy(next, forceId, command.targetForceId, -10);
            message = `${officer.name}出使${targetForce.name}结盟失败（判定值${result.judgment}）`;
          }
          break;
        }
        case 'truce': {
          const gold = command.gold ?? 0;
          const months = command.months ?? TRUCE_MONTHS_MIN;
          city.gold -= gold;
          const result = resolveTruce(next, forceId, command.targetForceId, officer, gold, months);
          if (result.success) {
            const tenDays = months * 3;
            next.forces[forceId].truces = { ...(next.forces[forceId].truces ?? {}), [command.targetForceId]: tenDays };
            next.forces[command.targetForceId].truces = { ...(next.forces[command.targetForceId].truces ?? {}), [forceId]: tenDays };
            message = `${officer.name}与${targetForce.name}达成停战协定（${months}个月）`;
          } else {
            message = `${officer.name}与${targetForce.name}停战交涉失败（判定值${result.judgment}）`;
          }
          break;
        }
        case 'requestTroops': {
          const result = resolveRequestTroops(next, forceId, command.targetForceId, officer);
          if (result.success) {
            // 目标：与请求方最近的敌城（不含盟友）
            const enemies = Object.values(next.cities).filter((c) => c.ownerId && c.ownerId !== forceId && c.ownerId !== command.targetForceId);
            const targetCity = enemies.sort((a, b) =>
              (Math.abs(a.gridQ - city.gridQ) + Math.abs(a.gridR - city.gridR))
              - (Math.abs(b.gridQ - city.gridQ) + Math.abs(b.gridR - city.gridR)))[0] ?? city;
            const allyCity = Object.values(next.cities).find((c) => c.ownerId === command.targetForceId);
            if (allyCity) {
              const allyOfficers = Object.values(next.officers).filter((o) =>
                o.forceId === command.targetForceId && o.location.kind === 'city' && o.location.cityId === allyCity.id && o.id !== next.forces[command.targetForceId].leaderId && !o.deathMonth);
              const commander = allyOfficers.sort((a, b) => b.stats.leadership - a.stats.leadership)[0];
              if (commander) {
                const allyCityState = next.cities[allyCity.id];
                const troops = Math.min(5000, allyCityState.troops - 1000);
                if (troops >= 2000) {
                  allyCityState.troops -= troops;
                  commander.location = { kind: 'unit', unitId: `reinforce-${forceId}-${commander.id}` };
                  next.units[`reinforce-${forceId}-${commander.id}`] = {
                    id: `reinforce-${forceId}-${commander.id}`,
                    kind: 'combat',
                    forceId: command.targetForceId,
                    leaderId: commander.id,
                    officerIds: [commander.id],
                    homeCityId: allyCity.id,
                    q: targetCity.gridQ,
                    r: targetCity.gridR,
                    troops,
                    food: 5000,
                    energy: 20,
                    movementRemaining: 10,
                    expiresTenDay: next.month * 3 + (next.tenDay ?? 1) + REINFORCEMENT_TEN_DAYS,
                    moved: false,
                    acted: false,
                  };
                  commander.cityId = targetCity.id;
                  message = `${targetForce.name}接受请求，派${commander.name}率${troops.toLocaleString('en-US')}军驰援${targetCity.name}！`;
                  break;
                }
              }
            }
            message = `${targetForce.name}接受请求，但无兵可派`;
          } else {
            message = `${targetForce.name}拒绝了请求援军的要求`;
          }
          break;
        }
        case 'break': {
          next.forces[forceId].allies = fromAllies.filter((id) => id !== command.targetForceId);
          next.forces[command.targetForceId].allies = toAllies.filter((id) => id !== forceId);
          adjustDiplomacy(next, forceId, command.targetForceId, -40);
          message = `${officer.name}代表${next.forces[forceId].name}宣布与${targetForce.name}断交（破盟）！`;
          break;
        }
      }
      break;
    }
    case 'captiveDispose': {
      const target = next.officers[command.targetOfficerId];
      if (!target || target.location.kind !== 'captive') break;
      if (command.action === 'recruit') {
        const executor = Object.values(next.officers).find((o) =>
          o.forceId === forceId && o.location.kind === 'city' && o.location.cityId === city.id && !o.acted && o.id !== next.forces[forceId].leaderId);
        if (!executor) {
          message = '本城没有可用于登用俘虏的武将';
          break;
        }
        const result = resolveRecruitCaptive(next, forceId, executor, target);
        executor.acted = true;
        message = result.success
          ? `${executor.name}成功劝降俘虏${target.name}，其加入${next.forces[forceId].name}（忠诚${target.loyalty}）`
          : `${executor.name}劝降${target.name}失败（成功率${result.chance}%）`;
      } else if (command.action === 'release') {
        releaseCaptive(next, target);
        message = `释放俘虏${target.name}，没收其随身宝物`;
      } else {
        executeCaptive(next, target);
        message = `处决俘虏${target.name}，其已伏诛`;
      }
      break;
    }
    case 'marry': {
      const a = next.officers[command.officerIdA];
      const b = next.officers[command.officerIdB];
      const kind = command.relation === 'sworn' ? 'sworn' : 'spouse';
      const force = next.forces[forceId];
      force.techP = (force.techP ?? 0) - MARRY_TECHP_COST;
      const messages = enterRelationship(next, a, b, kind);
      a.acted = true;
      b.acted = true;
      const label = kind === 'sworn' ? '结为义兄弟' : '结为夫妻';
      message = `${a.name}与${b.name}${label}${messages.length > 0 ? `，${messages[0]}` : ''}`;
      break;
    }
    case 'sworn': {
      const officers = command.officerIds.map((id) => next.officers[id]);
      const force = next.forces[forceId];
      force.techP = (force.techP ?? 0) - MARRY_TECHP_COST;
      for (let i = 0; i < officers.length; i++) {
        for (let j = i + 1; j < officers.length; j++) {
          enterRelationship(next, officers[i], officers[j], 'sworn');
        }
      }
      for (const officer of officers) officer.acted = true;
      message = `${officers.map((o) => o.name).join('、')}结为义兄弟`;
      break;
    }
    case 'legion': {
      const result = applyLegionCommand(next, forceId, command.commanderId, command.targetCityId, command.policy ?? 'balanced');
      message = result.message;
      break;
    }
    case 'buildFacilityPlot': {
      const officers = command.officerIds.map((officerId) => next.officers[officerId]);
      const result = startBuildCityPlot(city, command.plotIndex, command.facility, officers);
      // 建设黑市不加技巧P，其他设施+30
      if (command.facility !== 'blackmarket') addTechP(next, forceId, TECHP_PER_CONSTRUCTION);
      message = result.message;
      for (const officer of officers) officer.acted = true;
      break;
    }
    case 'cancelCityPlot': {
      message = cancelCityPlot(next, next.cities[command.cityId], command.plotIndex);
      break;
    }
    case 'appointStrategist': {
      const force = next.forces[forceId];
      force.strategistId = command.officerId ?? undefined;
      message = command.officerId
        ? `任命${next.officers[command.officerId].name}为军师，为外交、流言、登用出谋划策`
        : '解除军师任命';
      break;
    }
  }

  // 依行动累积功绩（任命官职/授予宝物/能力研究本身不计功绩）
  if (command.type !== 'appointPosition' && command.type !== 'grantTreasure' && command.type !== 'abilityResearch') {
    const involvedIds = 'officerIds' in command && Array.isArray(command.officerIds)
      ? command.officerIds
      : 'officerId' in command && command.officerId
        ? [command.officerId]
        : [];
    for (const officerId of involvedIds) {
      const officer = next.officers[officerId];
      if (officer) addOfficerMerit(officer, MERIT_PER_COMMAND);
    }
  }

  // 探索按人数结算行动力（每人20）
  const apCost = command.type === 'explore'
    ? EXPLORE_AP_PER_OFFICER * command.officerIds.length
    : COMMAND_AP[command.type];
  next.actionPoints[forceId] -= apCost;
  next.logs.push({
    id: `command-${next.month}-${next.logs.length}`,
    month: next.month,
    forceId,
    message,
  });
  return next;
}
