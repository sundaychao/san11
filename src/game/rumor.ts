import { nextRandom } from './random';
import { forceStrategist } from './diplomacy';
import { officerLoyalty, setOfficerLoyalty, clampLoyalty, recruitWillOf, willSuccessChance, recruitmentInitialLoyalty } from './loyalty';
import type { City, ForceId, GameState, Officer } from './types';

/**
 * 流言计略（参考《三国志11》原版）：
 * - 对敌方城市散布流言：判定成功后可降低其治安，并随机使城中武将忠诚下降。
 * - 判定值 = 执行武将智力 + rand(执行武将智力/10) − 目标势力军师智力/2
 *   （若目标城市无太守，军师智力再减半）
 * - 成功条件：判定值/12 ≥ rand(100) 且 判定值 ≥ 60
 * - 失败时执行武将有概率被逮捕，成为目标势力俘虏。
 */
export const RUMOR_AP_COST = 20;
export const RUMOR_GOLD_COST = 200;
/** 流言失败被逮捕的基础概率 */
export const RUMOR_CAPTURED_CHANCE = 0.25;
/** 单城流言最多影响武将数 */
export const RUMOR_MAX_TARGET_OFFICERS = 2;

export interface RumorResult {
  judgment: number;
  success: boolean;
  captured: boolean;
  orderLoss: number;
  loyaltyLosses: Array<{ officerId: string; name: string; before: number; after: number }>;
}

/** 读取目标势力防御方智力：军师 → 太守 → 君主（参考原版取值顺序） */
function defenderIntelligence(state: GameState, city: City): number {
  const strategist = city.ownerId ? forceStrategist(state, city.ownerId) : undefined;
  let guard = strategist?.stats.intelligence ?? undefined;
  const governor = city.governorId ? state.officers[city.governorId] : undefined;
  if (guard === undefined && governor) guard = governor.stats.intelligence;
  if (guard === undefined) {
    const leaderId = city.ownerId ? state.forces[city.ownerId]?.leaderId : undefined;
    const leader = leaderId ? state.officers[leaderId] : undefined;
    guard = leader?.stats.intelligence ?? 0;
  }
  if (!governor) guard = Math.floor(guard / 2);
  return guard;
}

/** 流言后治安损失：判定值越高损失越大（5~15） */
export function rumorOrderLoss(judgment: number): number {
  return Math.min(15, Math.max(5, Math.floor(judgment / 10)));
}

export function resolveRumor(state: GameState, executor: Officer, city: City): RumorResult {
  const guard = defenderIntelligence(state, city);

  const jitterRoll = nextRandom(state.seed, state.rngCursor);
  state.rngCursor = jitterRoll.cursor;
  const jitter = Math.floor((executor.stats.intelligence / 10) * jitterRoll.value);
  const judgment = executor.stats.intelligence + jitter - Math.floor(guard / 2);

  const resultRoll = nextRandom(state.seed, state.rngCursor);
  state.rngCursor = resultRoll.cursor;
  const roll100 = Math.floor(resultRoll.value * 100);
  const success = judgment / 12 >= roll100 && judgment >= 60;

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
  city.order = Math.max(0, Math.min(100, city.order - result.orderLoss));

  // 目标城中未被俘虏的武将中随机抽取 1~2 人降忠诚（受义理影响，义理高者降幅小）
  const candidates = Object.values(state.officers).filter(
    (officer) => officer.forceId === city.ownerId && officer.location.kind === 'city' && officer.location.cityId === city.id,
  );
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