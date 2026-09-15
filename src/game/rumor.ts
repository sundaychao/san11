import { nextRandom } from './random';
import { forceStrategist } from './diplomacy';
import { officerLoyalty, setOfficerLoyalty, clampLoyalty, recruitWillOf, willSuccessChance, recruitmentInitialLoyalty } from './loyalty';
import type { City, ForceId, GameState, Officer, Pass } from './types';

/** 流言目标据点：城池或关隘（关隘需有守将） */
export type RumorTarget = City | Pass;

/**
 * 流言计略（参考《三国志11》原版）：
 * - 对敌方城市散布流言：判定成功后可降低其治安，并随机使城中武将忠诚下降。
 * - 判定值（即成功率百分数）= 基础 60 + (执行武将智力 − 防御智力) × 1.5 + 抖动(0 ~ 执行智力/10)，
 *   收敛到 15 ~ 95。掷 0~99 小于判定值即成功。
 *   防御智力 = 目标势力军师（智力最高者）的智力；目标据点无太守时再减半。
 * - 失败时执行武将有概率被逮捕，成为目标势力俘虏。
 */
export const RUMOR_AP_COST = 20;
export const RUMOR_GOLD_COST = 500;
/** 流言失败被逮捕的基础概率 */
export const RUMOR_CAPTURED_CHANCE = 0.25;
/** 单城流言最多影响武将数 */
export const RUMOR_MAX_TARGET_OFFICERS = 2;
/** 流言基础成功率（%）：双方智力持平时的大致成功率（另叠加 0 ~ 执行智力/10 的抖动） */
export const RUMOR_BASE_CHANCE = 60;
/** 每 1 点智力差带来的成功率增减（%） */
export const RUMOR_INTELLIGENCE_SLOPE = 1.5;
/** 流言成功率下限（%）：再弱也能赌一把 */
export const RUMOR_MIN_CHANCE = 15;
/** 流言成功率上限（%）：不会必胜 */
export const RUMOR_MAX_CHANCE = 95;

export interface RumorResult {
  judgment: number;
  success: boolean;
  captured: boolean;
  orderLoss: number;
  loyaltyLosses: Array<{ officerId: string; name: string; before: number; after: number }>;
}

/** 读取目标据点防御方智力：城池=军师→太守→君主（无太守减半）；关隘=太守→君主（无太守减半） */
function defenderIntelligence(state: GameState, target: RumorTarget): number {
  const isCity = !('homeCityId' in target);
  const guardOf = (officer: Officer | undefined) => officer?.stats.intelligence;
  let guard: number | undefined;
  if (isCity) {
    guard = guardOf(target.ownerId ? forceStrategist(state, target.ownerId) : undefined);
  }
  const governor = target.governorId ? state.officers[target.governorId] : undefined;
  if (guard === undefined) guard = guardOf(governor);
  if (guard === undefined) {
    const leaderId = target.ownerId ? state.forces[target.ownerId]?.leaderId : undefined;
    guard = guardOf(leaderId ? state.officers[leaderId] : undefined);
  }
  if (guard === undefined) guard = 0;
  if (!governor) guard = Math.floor(guard / 2);
  return guard;
}

/** 流言后治安损失：判定值（成功率%）越高损失越大，实际 5 ~ 9（上限 15） */
export function rumorOrderLoss(judgment: number): number {
  return Math.min(15, Math.max(5, Math.floor(judgment / 10)));
}

/** 目标据点内驻扎的非俘虏武将（流言降忠对象） */
function residentOfficersOf(state: GameState, target: RumorTarget): Officer[] {
  return Object.values(state.officers).filter((officer) => {
    if (officer.forceId !== target.ownerId) return false;
    return 'homeCityId' in target
      ? officer.location.kind === 'pass' && officer.location.passId === target.id
      : officer.location.kind === 'city' && officer.location.cityId === target.id;
  });
}

/** 流言成功率基数（%）= 基础 60 + (执行智力 − 防御智力) × 1.5 */
function rumorChanceBase(executorIntelligence: number, guardIntelligence: number): number {
  return Math.round(RUMOR_BASE_CHANCE + (executorIntelligence - guardIntelligence) * RUMOR_INTELLIGENCE_SLOPE);
}

/** 判定值收敛：判定值即成功率百分数，限制在 15 ~ 95 之间 */
function clampRumorChance(value: number): number {
  return Math.min(RUMOR_MAX_CHANCE, Math.max(RUMOR_MIN_CHANCE, value));
}

export function resolveRumor(state: GameState, executor: Officer, target: RumorTarget): RumorResult {
  const guard = defenderIntelligence(state, target);

  const jitterRoll = nextRandom(state.seed, state.rngCursor);
  state.rngCursor = jitterRoll.cursor;
  const jitter = Math.floor((executor.stats.intelligence / 10) * jitterRoll.value);
  const judgment = clampRumorChance(rumorChanceBase(executor.stats.intelligence, guard) + jitter);

  const resultRoll = nextRandom(state.seed, state.rngCursor);
  state.rngCursor = resultRoll.cursor;
  const roll100 = Math.floor(resultRoll.value * 100);
  const success = roll100 < judgment;

  const result: RumorResult = {
    judgment,
    success,
    captured: false,
    orderLoss: 0,
    loyaltyLosses: [],
  };

  if (!success) {
    const captureRoll = nextRandom(state.seed, state.rngCursor);
    state.rngCursor = captureRoll.cursor;
    result.captured = captureRoll.value < RUMOR_CAPTURED_CHANCE;
    return result;
  }

  result.orderLoss = rumorOrderLoss(judgment);
  target.order = Math.max(0, Math.min(100, target.order - result.orderLoss));

  // 目标据点内未被俘虏的武将中随机抽取 1~2 人降忠诚（受义理影响，义理高者降幅小）
  const candidates = residentOfficersOf(state, target);
  const targetCountRoll = nextRandom(state.seed, state.rngCursor);
  state.rngCursor = targetCountRoll.cursor;
  const targetCount = Math.min(RUMOR_MAX_TARGET_OFFICERS, candidates.length, targetCountRoll.value < 0.5 ? 1 : 2);

  const shuffled = [...candidates];
  for (let index = 0; index < targetCount && shuffled.length > 0; index += 1) {
    const pickRoll = nextRandom(state.seed, state.rngCursor);
    state.rngCursor = pickRoll.cursor;
    const target = shuffled.splice(Math.floor(pickRoll.value * shuffled.length), 1)[0];
    const amountRoll = nextRandom(state.seed, state.rngCursor);
    state.rngCursor = amountRoll.cursor;
    // 基础2~4点 + 义理影响（义理越高减得越少）
    const base = 2 + Math.floor(amountRoll.value * 3);
    const righteousness = target.righteousness ?? 55;
    const loss = Math.max(1, Math.round(base * (1 - Math.min(0.5, (righteousness - 50) / 200))));
    const before = officerLoyalty(target);
    if (before <= 0) continue;
    const after = clampLoyalty(before - loss);
    setOfficerLoyalty(target, after);
    result.loyaltyLosses.push({ officerId: target.id, name: target.name, before, after });
  }

  return result;
}

/**
 * 流言成功率预估（0~100，供军师提示）：对判定值抖动的各档位求期望。
 * 判定值 = 60 + (执行智力 − 防御智力) × 1.5 + 抖动(0 ~ 执行智力/10)，收敛到 15 ~ 95，即成功率百分数。
 */
export function rumorSuccessChanceOf(state: GameState, executor: Officer, target: RumorTarget): number {
  const guard = defenderIntelligence(state, target);
  const base = rumorChanceBase(executor.stats.intelligence, guard);
  const bins = Math.max(1, Math.ceil(executor.stats.intelligence / 10));
  let total = 0;
  for (let jitter = 0; jitter < bins; jitter += 1) {
    total += clampRumorChance(base + jitter);
  }
  return total / bins;
}

/** 流言目标选项：全部敌城 + 有守将的敌关隘（供军师提示的目标列表页） */
export interface RumorTargetOption {
  kind: 'city' | 'pass';
  id: string;
  name: string;
  ownerId: ForceId;
  officerCount: number;
}

export function rumorTargetOptions(state: GameState, forceId: ForceId): RumorTargetOption[] {
  const options: RumorTargetOption[] = [];
  for (const city of Object.values(state.cities)) {
    if (!city.ownerId || city.ownerId === forceId) continue;
    const officerCount = residentOfficersOf(state, city).length;
    options.push({ kind: 'city', id: city.id, name: city.name, ownerId: city.ownerId, officerCount });
  }
  for (const pass of Object.values(state.passes ?? {})) {
    if (!pass.ownerId || pass.ownerId === forceId) continue;
    const officerCount = residentOfficersOf(state, pass).length;
    // 只列有人的关隘（空关隘散布流言无意义）
    if (officerCount === 0) continue;
    options.push({ kind: 'pass', id: pass.id, name: pass.name, ownerId: pass.ownerId, officerCount });
  }
  return options;
}

/** 挖角（登用敌方武将）判定：基于执行者智力/魅力、目标忠诚、相性与义理 */
export const POACH_AP_COST = 20;
export const POACH_GOLD_COST = 500;
export const POACH_BAN_MONTHS = 3;

export interface PoachResult {
  success: boolean;
  chance: number;
  bannedUntilMonth?: number;
}

/**
 * 挖角（登用敌方武将）成功率 —— 血色衣冠 6.0 新忠诚系统口径：
 * 统一走「登用接受意愿」公式（recruitWillOf）：
 * - 必拒（目标是君主 / 厌恶登用君主或武将 / 忠诚高于 96）→ 0%；
 * - 必成（目标亲爱登用方君主）→ 100%；
 * - 其余按意愿值换算：意愿 20 → 30%，40 → 60%，60 → 90%（willSuccessChance）。
 */
export function poachChance(state: GameState, executor: Officer, target: Officer): number {
  const verdict = recruitWillOf(state, executor, target);
  if (verdict.verdict === 'refuse') return 0;
  if (verdict.verdict === 'accept') return 100;
  return willSuccessChance(verdict.will);
}

export function resolvePoach(state: GameState, executor: Officer, target: Officer): PoachResult {
  const chance = poachChance(state, executor, target);
  const roll = nextRandom(state.seed, state.rngCursor);
  state.rngCursor = roll.cursor;
  const success = roll.value * 100 < chance;
  if (success) {
    target.forceId = executor.forceId;
    target.location = { kind: 'city', cityId: target.cityId };
    target.loyalty = recruitmentInitialLoyalty(target);
    // 血色衣冠 6.0：换主后仕龄从 0 重新计算（出仕第一年）
    target.serviceYears = 0;
    // 本旬新加入的武将视为已行动（与舌战登用/进驻一致），下一旬才可执行指令
    target.acted = true;
  } else {
    target.bannedUntilMonth = state.month + POACH_BAN_MONTHS;
  }
  return { success, chance, bannedUntilMonth: success ? undefined : state.month + POACH_BAN_MONTHS };
}

/** 是否能对某武将执行挖角（非君主、与己方敌对、在本城待命、未被禁止仕官） */
export function canPoach(state: GameState, forceId: ForceId, target: Officer): boolean {
  if (!target.forceId || target.forceId === forceId) return false;
  if (state.forces[target.forceId]?.leaderId === target.id) return false;
  if (target.location.kind !== 'city') return false;
  return typeof target.bannedUntilMonth !== 'number' || target.bannedUntilMonth <= state.month;
}

/** 流言可执行的目标城市：任意敌城 */
export function rumorTargets(state: GameState, forceId: ForceId): City[] {
  return Object.values(state.cities).filter((city) => city.ownerId !== forceId && !!city.ownerId);
}

export type { ForceId };