import { nextRandom } from './random';
import { officerSkillNames } from './skills';
import type { ForceId, GameState, Officer } from './types';

/** 忠诚度上限（原版可超100） */
export const LOYALTY_MAX = 127;
/** 初始忠诚默认值（非君主、非在野） */
export const DEFAULT_OFFICER_LOYALTY = 92;
/** 君主初始忠诚 */
export const LEADER_INITIAL_LOYALTY = 100;
/** 褒奖单次消耗资金 */
export const REWARD_GOLD_COST = 100;
/** 褒奖行动力消耗 */
export const REWARD_AP_COST = 5;
/** 褒奖提升的忠诚（低忠诚效果更好） */
export const REWARD_LOYALTY_GAIN = 2;
export const REWARD_LOYALTY_GAIN_LOW = 3;
/** 忠诚低于该值时按低忠诚加成 */
export const REWARD_LOW_LOYALTY_THRESHOLD = 80;
/** 忠诚低于该值极易被挖角 */
export const LOYALTY_POACH_RISK = 95;

export function clampLoyalty(value: number): number {
  return Math.min(LOYALTY_MAX, Math.max(0, Math.round(value)));
}

/** 带默认值的忠诚读取（在野=0） */
export function officerLoyalty(officer: Officer): number {
  return officer.forceId === null ? 0 : officer.loyalty ?? DEFAULT_OFFICER_LOYALTY;
}

/** 带默认值的野心读取 */
export function officerAmbition(officer: Officer): number {
  return officer.ambition ?? 50;
}

/** 带默认值的义理读取 */
export function officerRighteousness(officer: Officer): number {
  return officer.righteousness ?? 50;
}

/** 褒奖实际提升的忠诚点数 */
export function rewardLoyaltyGain(currentLoyalty: number): number {
  return currentLoyalty < REWARD_LOW_LOYALTY_THRESHOLD ? REWARD_LOYALTY_GAIN_LOW : REWARD_LOYALTY_GAIN;
}

export function setOfficerLoyalty(officer: Officer, value: number): void {
  officer.loyalty = clampLoyalty(value);
}

/**
 * 季初（1/4/7/10月的第一旬）忠诚自然波动。
 * 参考原版：每季度忠诚随机下降，下降幅度受武将义理/野望影响；
 * 义理高、野望低的武将基本稳定，董卓吕布型容易下降；「仁政」特技持有者免除全势力下降。
 */
export function settleLoyaltyDrift(state: GameState): void {
  const officersByForce = new Map<ForceId, Officer[]>();
  for (const officer of Object.values(state.officers)) {
    if (officer.forceId === null) continue;
    const list = officersByForce.get(officer.forceId) ?? [];
    list.push(officer);
    officersByForce.set(officer.forceId, list);
  }

  const affected: string[] = [];

  for (const [forceId, officers] of officersByForce) {
    const force = state.forces[forceId];
    if (!force) continue;
    const leader = state.officers[force.leaderId];
    // 仁政：本势力武将季初不降忠诚
    const hasBenevolent = officers.some((officer) => officerSkillNames(officer).includes('仁政'));
    if (hasBenevolent) continue;
    void leader;

    for (const officer of officers) {
      const righteousness = officerRighteousness(officer);
      const ambition = officerAmbition(officer);
      const stability = 60 + righteousness - ambition;
      const dropChance = Math.min(1, Math.max(0, (100 - stability) / 100));
      if (dropChance === 0) continue;

      const roll = nextRandom(state.seed, state.rngCursor);
      state.rngCursor = roll.cursor;
      if (roll.value >= dropChance) continue;

      const drop = roll.value < dropChance * 0.3 ? 2 : 1;
      const current = officerLoyalty(officer);
      if (current <= 0) continue;
      setOfficerLoyalty(officer, current - drop);
      affected.push(`${officer.name} ${current}→${officerLoyalty(officer)}`);
    }
  }

  if (affected.length > 0) {
    state.logs.push({
      id: `loyalty-${state.month}-${state.logs.length}`,
      month: state.month,
      forceId: null,
      message: `四季交替，部分武将忠诚浮动：${affected.slice(0, 3).join('；')}${affected.length > 3 ? ` 等${affected.length}人` : ''}`,
    });
  }
}

/** 登用/探索人才成功后的初始忠诚（基于义理与魅力，落于 70~100） */
export function recruitmentInitialLoyalty(officer: Officer): number {
  const righteousness = officerRighteousness(officer);
  return clampLoyalty(70 + Math.floor(righteousness / 4));
}