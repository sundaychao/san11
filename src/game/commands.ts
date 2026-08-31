import { nextRandom } from './random';
import { ARMAMENT_GOLD_COST, ARMAMENT_LABELS, ARMAMENT_TYPES, armamentsOf, isDelayedArmament, produceArmamentYield, DELAYED_ARMAMENT_TEN_DAYS } from './armaments';
import { ABILITY_NODE_MAP, ABILITY_RESEARCH_GOLD, CULTIVATE_TEN_DAYS, abilityCultivateRemaining, abilityNodeStatus, canCultivateOfficer } from './abilityResearch';
import { commandYieldMultiplier } from './skills/rules/city';
import { officerSkillNames } from './skills';
import { MAX_TECH_LEVEL, RESEARCH_AP_COST, TECH_BRANCHES, TECH_COSTS, TECHP_PER_CIVIL_ACTION, TECHP_PER_TRADE, developMultiplier, recruitMultiplier, researchTenDays, techLevelOf } from './techs';
import { EXPLORE_AP_PER_OFFICER, EXPLORE_GOLD_CHANCE, EXPLORE_GOLD_MAX, EXPLORE_GOLD_MIN, EXPLORE_GOLD_PER_OFFICER, EXPLORE_TREASURE_BASE_CHANCE, EXPLORE_TREASURE_INT_BONUS_MAX, treasureDefinition } from './treasures';
import type { City, ForceId, GameCommand, GameState, Officer, TechBranchId } from './types';

export const COMMAND_AP = {
  develop: 20,
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
  trade: 20,
} as const;

export const COMMAND_LABELS: Record<GameCommand['type'], string> = {
  develop: '开发',
  recruit: '征兵',
  produceArmament: '生产兵装',
  train: '训练',
  patrol: '巡察',
  talent: '人才',
  explore: '探索',
  grantTreasure: '收授宝物',
  research: '科技研究',
  abilityResearch: '能力研究',
  cultivate: '培育武将',
  transfer: '调动',
  trade: '商人',
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

// 每旬各城独立掷点决定商人是否到访（1/4），并重置本旬交易次数
export function rollMerchants(state: GameState): void {
  for (const city of Object.values(state.cities)) {
    const roll = nextRandom(state.seed, state.rngCursor);
    state.rngCursor = roll.cursor;
    city.merchantPresent = roll.value < MERCHANT_ARRIVAL_CHANCE;
    city.merchantTradedThisTenDay = false;
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

function commandGoldCost(command: GameCommand) {
  switch (command.type) {
    case 'develop': return 500;
    case 'recruit': return 800;
    case 'produceArmament': return ARMAMENT_GOLD_COST;
    case 'patrol': return 300;
    case 'talent': return 500;
    case 'abilityResearch': return ABILITY_RESEARCH_GOLD;
    default: return 0;
  }
}

/** 研究下一级科技的金钱消耗 */
export function researchGoldCost(state: GameState, forceId: ForceId, branch: TechBranchId): number {
  return TECH_COSTS[techLevelOf(state, forceId, branch)]?.gold ?? 0;
}

/** 研究下一级科技的技巧P消耗 */
export function researchTechPCost(state: GameState, forceId: ForceId, branch: TechBranchId): number {
  return TECH_COSTS[techLevelOf(state, forceId, branch)]?.techP ?? 0;
}

function validateTransfer(state: GameState, forceId: ForceId, command: Extract<GameCommand, { type: 'transfer' }>) {
  const errors: string[] = [];
  const source = state.cities[command.cityId];
  const target = state.cities[command.targetCityId];
  if (!target || target.ownerId !== forceId) errors.push('只能调往己方城市');
  if (command.targetCityId === command.cityId) errors.push('目标城市不能与出发城市相同');
  if (command.officerIds.length === 0) errors.push('至少调动一名武将');

  for (const officerId of command.officerIds) {
    const officer = state.officers[officerId];
    if (!officer || officer.forceId !== forceId || officer.location.kind !== 'city' || officer.location.cityId !== command.cityId) {
      errors.push('只能调动出发城市内的己方武将');
      break;
    }
    if (source?.governorId === officerId) {
      errors.push('太守不可调离任所');
      break;
    }
  }
  return errors;
}

function localOfficer(state: GameState, forceId: ForceId, command: Exclude<GameCommand, { type: 'transfer' } | { type: 'abilityResearch' } | { type: 'explore' } | { type: 'grantTreasure' }>) {
  const officer = state.officers[command.officerId];
  return officer?.forceId === forceId && officer.location.kind === 'city' && officer.location.cityId === command.cityId
    ? officer
    : undefined;
}

export function validateCommand(state: GameState, forceId: ForceId, command: GameCommand): string[] {
  const errors: string[] = [];
  const city = state.cities[command.cityId];
  if (state.phase !== 'playing') errors.push('本局已经结束');
  if (!city || city.ownerId !== forceId) errors.push('只能管理己方城市');

  if (command.type !== 'transfer' && command.type !== 'abilityResearch' && command.type !== 'explore' && command.type !== 'grantTreasure') {
    const officer = localOfficer(state, forceId, command);
    if (!officer) {
      errors.push('武将不在目标城市');
    } else if (officer.acted) {
      errors.push(`${officer.name}本月已行动`);
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

  if (state.actionPoints[forceId] < COMMAND_AP[command.type]) {
    errors.push(`行动力不足 ${COMMAND_AP[command.type]}`);
  }
  if (!city) return [...new Set(errors)];

  const goldCost = commandGoldCost(command);
  if (city.gold < goldCost) errors.push(`资金不足 ${goldCost}`);
  if (command.type === 'recruit') {
    if (city.food < 500) errors.push('兵粮不足 500');
    if (city.population < 500) errors.push('人口不足 500');
  }
  if (command.type === 'train' && city.food < 300) errors.push('兵粮不足 300');
  if (command.type === 'produceArmament' && !ARMAMENT_TYPES.includes(command.armamentType)) {
    errors.push('兵装类型无效');
  }
  if (command.type === 'trade') {
    if (!city.merchantPresent) {
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
        if ((state.forces[forceId]?.techP ?? 0) < cost.techP) errors.push(`技巧P不足 ${cost.techP}`);
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
  return [...new Set(errors)];
}

/** 技巧P入账（击破/占领/登庸/交易/内政等） */
export function addTechP(state: GameState, forceId: ForceId, amount: number): void {
  const force = state.forces[forceId];
  if (!force || amount <= 0) return;
  force.techP = (force.techP ?? 0) + amount;
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
  const talentRoll = nextRandom(state.seed, state.rngCursor);
  state.rngCursor = talentRoll.cursor;
  const talentChance = Math.min(85, 35 + Math.floor(officer.stats.intelligence / 2)) / 100;
  if (talent && talentRoll.value < talentChance) {
    talent.forceId = forceId;
    talent.location = { kind: 'city', cityId: city.id };
    talent.cityId = city.id;
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
    officer.location = {
      kind: 'transfer',
      fromCityId: command.cityId,
      targetCityId: command.targetCityId,
      remainingTenDays: duration,
    };
    officer.cityId = command.cityId;
    officer.acted = true;
  }
  return `${source.name}向${target.name}调动${names.join('、')}，预计${duration}旬抵达`;
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
    case 'develop': {
      const officer = next.officers[command.officerId];
      city.gold -= 500;
      const baseGain = 4 + Math.floor(officer.stats.politics / 20);
      const gain = Math.max(1, Math.round(baseGain * developMultiplier(next, forceId, command.focus)));
      city[command.focus] = clamp(city[command.focus] + gain, 0, 100);
      const focusName = command.focus === 'commerce' ? '商业' : '农业';
      addTechP(next, forceId, TECHP_PER_CIVIL_ACTION);
      message = `${officer.name}开发${city.name}${focusName}，提升了${gain}点`;
      officer.acted = true;
      break;
    }
    case 'recruit': {
      const officer = next.officers[command.officerId];
      const baseGain = 300 + officer.stats.charisma * 10;
      const gain = Math.round(baseGain * commandYieldMultiplier(next, command) * recruitMultiplier(next, forceId));
      city.gold -= 800;
      city.food -= 500;
      city.population -= 500;
      city.troops += gain;
      city.order = clamp(city.order - 2, 0, 100);
      addTechP(next, forceId, TECHP_PER_CIVIL_ACTION);
      message = `${officer.name}在${city.name}征募士兵`;
      next.cityEffectReports = [{
        id: `city-effect-${next.month}-${next.logs.length}`,
        cityId: city.id,
        q: city.gridQ,
        r: city.gridR,
        amount: gain,
        label: '士兵',
        kind: 'recruit',
      }];
      officer.acted = true;
      break;
    }
    case 'produceArmament': {
      const officer = next.officers[command.officerId];
      const current = armamentsOf(city.armaments);
      const baseGain = produceArmamentYield(officer, command.armamentType);
      const gain = Math.round(baseGain * commandYieldMultiplier(next, command));
      city.gold -= ARMAMENT_GOLD_COST;
      if (isDelayedArmament(command.armamentType)) {
        officer.location = {
          kind: 'task',
          cityId: city.id,
          task: 'armament',
          armamentType: command.armamentType,
          amount: gain,
          remainingTenDays: DELAYED_ARMAMENT_TEN_DAYS,
        };
        message = `${officer.name}开始生产${city.name}${ARMAMENT_LABELS[command.armamentType]}，预计1个月完成`;
      } else {
        city.armaments = {
          ...current,
          [command.armamentType]: current[command.armamentType] + gain,
        };
        message = `${officer.name}生产${city.name}${ARMAMENT_LABELS[command.armamentType]}，增加了${gain.toLocaleString('en-US')}`;
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
      officer.acted = true;
      break;
    }
    case 'train': {
      const officer = next.officers[command.officerId];
      city.food -= 300;
      const gain = 5 + Math.floor(officer.stats.leadership / 20);
      city.training = clamp(city.training + gain, 0, 100);
      message = `${officer.name}训练${city.name}守军`;
      officer.acted = true;
      break;
    }
    case 'patrol': {
      const officer = next.officers[command.officerId];
      city.gold -= 300;
      const gain = 4 + Math.floor(officer.stats.charisma / 20);
      city.order = clamp(city.order + gain, 0, 100);
      message = `${officer.name}巡察${city.name}，安抚百姓`;
      officer.acted = true;
      break;
    }
    case 'talent': {
      const officer = next.officers[command.officerId];
      city.gold -= 500;
      message = resolveTalentSearch(next, forceId, city, officer);
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
      const officer = next.officers[command.officerId];
      const branchDef = TECH_BRANCHES.find((candidate) => candidate.id === command.branch)!;
      const level = techLevelOf(next, forceId, command.branch);
      const cost = TECH_COSTS[level];
      city.gold -= cost.gold;
      const force = next.forces[forceId];
      force.techP = (force.techP ?? 0) - cost.techP;
      const statValue = branchDef.researchStat === 'leadership'
        ? officer.stats.leadership
        : officer.stats.politics;
      const tenDays = researchTenDays(cost.baseTenDays, statValue);
      officer.location = {
        kind: 'task',
        cityId: city.id,
        task: 'research',
        branch: command.branch,
        remainingTenDays: tenDays,
      };
      officer.acted = true;
      message = `${officer.name}在${city.name}开始研究${branchDef.name}系「${branchDef.levels[level].name}」，预计${tenDays}旬完成`;
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
