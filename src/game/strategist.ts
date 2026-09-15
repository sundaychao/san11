/**
 * 军师模块（参考《三国志11》原版）：
 * - 军师对计略任务给出成败预估与执行人选建议，在界面底部弹出提示框。
 * - 已任命军师（Force.strategistId）优先；未任命时以势力智力最高者充任临时军师。
 * - 建议准确率暂取真实计算值（原版中军师智力越低报错越频繁，可在此扩展）。
 */
import { requiredAllianceGold, requiredTruceGold, resolveAlliance, resolveTruce } from './diplomacy';
import { recruitWillOf, willSuccessChance, type RecruitWillResult } from './loyalty';
import { rumorSuccessChanceOf } from './rumor';
import type { City, ForceId, GameState, Officer, Pass } from './types';

/**
 * 军师推举执行人选的门槛（%）：预估成功率**必须超过**此值才推荐人选。
 * 未超过则只出忠告（「可说是微乎其微啊」），不指名任何人。
 */
export const RUMOR_ADVICE_MIN_CHANCE = 80;

/** 势力军师：已任命的军师；未任命时以智力最高的在任武将（非俘虏）充任 */
export function strategistOf(state: GameState, forceId: ForceId): Officer | undefined {
  const force = state.forces[forceId];
  const appointed = force?.strategistId ? state.officers[force.strategistId] : undefined;
  if (appointed && appointed.forceId === forceId && appointed.location.kind !== 'captive') return appointed;
  return Object.values(state.officers)
    .filter((officer) => officer.forceId === forceId && officer.location.kind !== 'captive')
    .sort((a, b) => b.stats.intelligence - a.stats.intelligence)[0];
}

export interface StrategistAdvice {
  /** 有概率成功（存在建议人选） */
  viable: boolean;
  /** 建议人选的预估成功率（0~100 取整） */
  chance: number;
  /** 建议人选（viable 时有效） */
  executorId?: string;
  executorName?: string;
}

/** 军师对流言任务的评估：从执行据点可用武将中预估各人成功率，给出最佳人选（仅当成功率超过门槛） */
export function rumorAdviceOf(state: GameState, executors: Officer[], target: City | Pass): StrategistAdvice {
  let best: { officer: Officer; chance: number } | undefined;
  for (const officer of executors) {
    const chance = rumorSuccessChanceOf(state, officer, target);
    if (!best || chance > best.chance) best = { officer, chance };
  }
  // 门槛为「超过」：恰等于 80% 也不推举人选
  if (!best || Math.round(best.chance) <= RUMOR_ADVICE_MIN_CHANCE) return { viable: false, chance: 0 };
  return {
    viable: true,
    chance: Math.round(best.chance),
    executorId: best.officer.id,
    executorName: best.officer.name,
  };
}

/**
 * 军师推举登庸人选的门槛（%）：预估登用成功率**达到**此值才指名我方行动武将。
 * 未达到则只出忠告（「成算恐怕不足一半啊」），不推举人选 —— 与流言同构。
 * 取 50 即「须有过半把握」（约当意愿 34 以上，四档里介于「意愿中」高档与「意愿高」之间）。
 */
export const RECRUIT_ADVICE_MIN_CHANCE = 50;

/** 登用接受意愿结果 → 登庸成功率（0~100） */
export function recruitSuccessChanceOfWill(will: RecruitWillResult): number {
  // 必定同意：不待舌战直接出仕
  if (will.verdict === 'accept') return 100;
  // 必拒 / 意愿 ≤ 0：引擎里这两档根本进不了随机判定，直接算 0
  if (will.verdict === 'refuse' || will.will <= 0) return 0;
  return willSuccessChance(will.will);
}

/**
 * 登庸成功率（军师口径，0~100）：把「登用接受意愿」折算成百分比。
 * 与引擎结算同一套函数（`recruitWillOf` + `willSuccessChance`），改动即两处同步。
 * 注意：触发舌战的分支还取决于执行者辩才，军师口径不含该变量。
 */
export function recruitSuccessChance(state: GameState, executor: Officer, target: Officer): number {
  return recruitSuccessChanceOfWill(recruitWillOf(state, executor, target));
}

export interface RecruitAdvice {
  /** 有把握登庸（存在达到门槛的建议人选） */
  viable: boolean;
  /** 建议人选的预估成功率；viable 为 false 时是「我方最佳者」的成功率（均 0~100 取整） */
  chance: number;
  /** 建议人选（viable 时有效） */
  executorId?: string;
  executorName?: string;
  /** 我方任何武将都必然被回绝（必拒） */
  rejected: boolean;
  /** 众人共同的必拒原因（rejected 时非空，可直接用于忠告文案） */
  reasons: string[];
}

/**
 * 军师对登庸任务的评估：从可用武将中预估各人登用成功率，给出最佳人选。
 * 与流言同构——只有达到门槛才推举人选；达不到则返回 `viable: false` 让军师出忠告，
 * `rejected` 会让忠告带上「必拒」的共有原因（如「对方是一方君主」）。
 * 无可用武将时返回 `chance: 0` 的空评估。
 */
export function recruitAdviceOf(state: GameState, executors: Officer[], target: Officer): RecruitAdvice {
  const results = executors.map((officer) => ({ officer, will: recruitWillOf(state, officer, target) }));
  let best: { officer: Officer; chance: number } | undefined;
  for (const entry of results) {
    const chance = recruitSuccessChanceOfWill(entry.will);
    if (!best || chance > best.chance) best = { officer: entry.officer, chance };
  }
  if (!best) return { viable: false, chance: 0, rejected: false, reasons: [] };
  // 只有「每位执行者都被回绝」才算必拒；共有原因即与执行者无关的那几条（君主 / 忠诚 / 厌恶君主）
  const rejected = results.every((entry) => entry.will.verdict === 'refuse');
  const reasons = results[0].will.reasons.filter((reason) => results.every((entry) => entry.will.reasons.includes(reason)));
  const advice: RecruitAdvice = { viable: false, chance: best.chance, rejected, reasons };
  if (best.chance < RECRUIT_ADVICE_MIN_CHANCE) return advice;
  return { ...advice, viable: true, executorId: best.officer.id, executorName: best.officer.name };
}

/** 军师可给出礼金建议的外交行动（其余外交行动无礼金变量，不出提示） */
export const DIPLOMACY_ADVICE_ACTIONS = ['alliance', 'truce'] as const;
export type DiplomacyAdviceAction = (typeof DIPLOMACY_ADVICE_ACTIONS)[number];

export interface DiplomacyAdvice {
  /** 评估所用执行者（已选使者；未选时为政治最高的可用武将） */
  executorId: string;
  executorName: string;
  /** 现行礼金（与停战期限）是否足以谈成 */
  viable: boolean;
  /** 达成所需的最低礼金（已按滑块步长向上取整；viable 时为 0，可能超过规则/资金上限） */
  requiredGold: number;
}

/**
 * 军师对同盟/停战交涉的评估：判定式为确定式（无随机），故直接给出「能否谈成」。
 * 谈不成时报出所需最低礼金，谈得成则不报（`requiredGold` 为 0）。
 * 未指定执行者时返回 null —— 无从评估。
 */
export function diplomacyAdviceOf(
  state: GameState,
  from: ForceId,
  to: ForceId,
  action: DiplomacyAdviceAction,
  executor: Officer | undefined,
  gold: number,
  months: number,
): DiplomacyAdvice | null {
  if (!executor) return null;
  const viable = action === 'alliance'
    ? resolveAlliance(state, from, to, executor, gold).success
    : resolveTruce(state, from, to, executor, gold, months).success;
  return {
    executorId: executor.id,
    executorName: executor.name,
    viable,
    requiredGold: viable
      ? 0
      : (action === 'alliance'
        ? requiredAllianceGold(state, from, to, executor)
        : requiredTruceGold(state, from, to, executor, months)),
  };
}
