import { nextRandom } from './random';
import { officerSkillNames } from './skills';
import { loyaltyLossResist } from './techs';
import { affinityOf, officerCompatWithRuler } from './diplomacy';
import type { CityId, ForceId, GameState, Officer } from './types';

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
/** 褒奖提升的忠诚（每位被褒奖武将固定 +5） */
export const REWARD_LOYALTY_GAIN = 5;
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

/** 褒奖实际提升的忠诚点数（固定 +5） */
export function rewardLoyaltyGain(_currentLoyalty: number): number {
  return REWARD_LOYALTY_GAIN;
}

export function setOfficerLoyalty(officer: Officer, value: number): void {
  officer.loyalty = clampLoyalty(value);
}

/**
 * 季初（1/4/7/10月的第一旬）忠诚自然波动。
 * 参照原版，逐要素判定——任一步命中即本旬不掉忠：
 *  1. 关系锁定：同势力内有配偶/义兄弟 → 完全锁定；
 *  2. 仁政（城级）：武将所在城内有「仁政」持有者驻留 → 本城免疫（原版只保当城）；
 *  3. 「克己复礼」科技：忠诚下降概率降低50%（厌恶君主者除外）；
 *  4. 相性差：相克(≥50)放大掉忠概率，同相(≤24)减半，中庸×1；
 *  5. 厌恶君主：必降忠诚（无视克己复礼，但仍受关系锁/仁政约束）。
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
    const leaderId = force.leaderId;
    // 仁政（城级）：收集各城是否有「仁政」持有者驻留
    const benevolentCityIds = new Set<CityId>();
    for (const officer of officers) {
      if (officer.location.kind === 'city' && officerSkillNames(officer).includes('仁政')) {
        benevolentCityIds.add(officer.location.cityId);
      }
    }
    const resistLoyaltyLoss = loyaltyLossResist(state, forceId);

    for (const officer of officers) {
      // 君主不参与忠诚系统（不掉忠，忠诚始终为初始满值）
      if (officer.id === force.leaderId) continue;
      // 1. 关系锁定：配偶/义兄弟在营 → 完全免疫
      if (Object.keys(officer.relationships ?? {}).length > 0) continue;
      const current = officerLoyalty(officer);
      if (current <= 0) continue;

      const righteousness = officerRighteousness(officer);
      const ambition = officerAmbition(officer);
      const stability = 60 + righteousness - ambition;
      // 4. 相性差档位放大掉忠概率
      const { tier } = officerCompatWithRuler(state, officer, forceId);
      // 5. 厌恶君主：必降（不受 3 干扰，但仍受 2 关系锁/城级仁政约束）
      const dislikesRuler = (officer.hates ?? []).includes(leaderId);
      const dropChance = dislikesRuler ? 1 : Math.min(1, Math.max(0, (100 - stability) / 100) * tier.factor);
      if (dropChance === 0) continue;

      // 2. 仁政（城级）免疫：仅当武将驻留在有仁政者的城内
      if (officer.location.kind === 'city' && benevolentCityIds.has(officer.location.cityId)) continue;

      // 3. 克己复礼：忠诚下降概率降低50%（厌恶君主者不适用）
      if (!dislikesRuler && resistLoyaltyLoss) {
        const resistRoll = nextRandom(state.seed, state.rngCursor);
        state.rngCursor = resistRoll.cursor;
        if (resistRoll.value < 0.5) continue;
      }

      const roll = nextRandom(state.seed, state.rngCursor);
      state.rngCursor = roll.cursor;
      if (roll.value >= dropChance) continue;

      const drop = roll.value < dropChance * 0.3 ? 2 : 1;
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