import { nextRandom } from './random';
import { officerSkillNames } from './skills';
import { loyaltyLossResist } from './techs';
import { affinityOf, circleCompatDiff, officerCompatWithRuler } from './diplomacy';
import { POSITIONS, officerMerit, positionDefinition } from './ranks';
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

/* ============================================================
 * 《血色衣冠 6.0》新忠诚系统（sp10 / SIRE 2.09e 口径）
 * 三个子系统：忠诚度基准值（褒奖上限）/ 定期忠诚下降 / 登用接受意愿。
 * 参数以官方公开默认值为准，未公开的按文档 docs/血色衣冠6.0忠诚系统.md 记载的合理值落定。
 * ============================================================ */

/** 登用接受意愿基准值（sp10 重订为 72/68/64 三档，本作无难度分档取第一档） */
export const RECRUIT_WILL_BASE = 72;
/** 意愿浮动值上限（0 ~ N-1 的伪随机，由双方 id 与当前月决定，SL 不变） */
export const RECRUIT_WILL_FLOAT = 6;
/** 相性差系数：每 2 点相性差 −1 意愿（−50%） */
export const RECRUIT_WILL_COMPAT_FACTOR = 0.5;
/** 忠诚度系数：1 点忠诚 −1 意愿（−100%），低于 60 按 60 计 */
export const RECRUIT_WILL_LOYALTY_FACTOR = 1.0;
export const RECRUIT_WILL_LOYALTY_FLOOR = 60;
/** 登用武将魅力系数（+20%） */
export const RECRUIT_WILL_CHARISMA_FACTOR = 0.2;
/** 现任君主 / 登用君主 / 登用武将 的人际关系系数 */
export const RECRUIT_WILL_CURRENT_RULER_FACTOR = -0.4;
export const RECRUIT_WILL_NEW_RULER_FACTOR = 0.4;
export const RECRUIT_WILL_AGENT_FACTOR = 0.2;
/** 俘虏登用意愿加成 */
export const RECRUIT_WILL_CAPTIVE_BONUS = 10;
/** 仕官第一年（仕龄为 0）登用意愿惩罚 */
export const RECRUIT_WILL_FIRST_YEAR_PENALTY = 20;
/** 义理（有归属势力）/ 野心（无归属势力）每档对意愿的影响（每档 ±2） */
export const RECRUIT_WILL_RIGHTEOUSNESS_STEP = 2;
export const RECRUIT_WILL_AMBITION_STEP = 2;
/** 「论客」特技对登用意愿的加成（sp10 附加效果） */
export const LOBBYIST_WILL_BONUS = 5;
/** 必拒线：在仕武将忠诚高于该值必定拒绝登用 */
export const RECRUIT_REFUSE_LOYALTY = 96;
/** 意愿→成功率换算系数（poach/captive 路径；意愿 20 → 30%，60 → 90%） */
export const WILL_SUCCESS_FACTOR = 1.5;

/** 忠诚度基准值：相性差系数（−60%） */
export const LOYALTY_CAP_COMPAT_FACTOR = 0.6;
/** 忠诚度基准值：每仕龄年加成 */
export const LOYALTY_CAP_SERVICE_PER_YEAR = 3;
/** 忠诚度基准值：仕龄加成上限（血色 398~402 特技的「上限」口径） */
export const LOYALTY_CAP_SERVICE_MAX = 12;
/** 忠诚度基准值：满官阶加成（血色官阶 0~10 × C=2，本作按官职档位归一） */
export const LOYALTY_CAP_POSITION_MAX = 20;

/** 定期下降：君主魅力系数（sp10 由 50% 下调至 40%） */
export const LOYALTY_DROP_RULER_CHARISMA_FACTOR = 0.4;
/** 定期下降：功绩相对官职门槛每超出 1 点增加的下降概率（0.05%/点） */
export const LOYALTY_DROP_MERIT_FACTOR = 0.0005;
/** 定期下降：相性差不超过该值且非俘虏 → 本季不下降（血色「相性差小于 X」） */
export const LOYALTY_DROP_CLOSE_COMPAT = 15;
/** 定期下降：概率上限 */
export const LOYALTY_DROP_CHANCE_MAX = 0.9;

/** 登用意愿人际关系分（血色关系值参数）：亲爱 +10 / 厌恶 −60 / 结义·结婚 +10 */
export const WILL_RELATION_LOVE = 10;
export const WILL_RELATION_HATE = -60;
export const WILL_RELATION_SWORN = 10;
/** 基准值「与君主关系」分：亲爱 +10 / 厌恶 −10 / 结义每人 +5 / 配偶 +10 */
export const CAP_RELATION_LOVE = 10;
export const CAP_RELATION_HATE = -10;
export const CAP_RELATION_SWORN = 5;
export const CAP_RELATION_SPOUSE = 10;

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

/** 义理档位（0~4，血色义理按 20 点一档折算本作 0~100 义理） */
export function righteousnessTier(officer: Officer): number {
  return Math.min(4, Math.floor(officerRighteousness(officer) / 20));
}

/** 野心档位（0~4，同上折算） */
export function ambitionTier(officer: Officer): number {
  return Math.min(4, Math.floor(officerAmbition(officer) / 20));
}

/** 仕龄（整年数）：换主即重置为 0，被俘仍累计；旧档/开局未记录的按已仕 1 年兜底 */
export function serviceYearsOf(officer: Officer): number {
  if (officer.forceId === null) return 0;
  return officer.serviceYears ?? 1;
}

/** 褒奖实际提升的忠诚点数（固定 +5） */
export function rewardLoyaltyGain(_currentLoyalty: number): number {
  return REWARD_LOYALTY_GAIN;
}

export function setOfficerLoyalty(officer: Officer, value: number): void {
  officer.loyalty = clampLoyalty(value);
}

/** 武将对另一名武将的人际关系分（累加各类型；登用用 −60 厌恶，基准值用 −10；结义分默认按登用口径 +10，基准值传 +5） */
export function relationScoreTowards(
  officer: Officer,
  otherId: string | undefined,
  hateScore: number,
  swornScore: number = WILL_RELATION_SWORN,
): number {
  if (otherId === undefined) return 0;
  let score = 0;
  if ((officer.likes ?? []).includes(otherId)) score += WILL_RELATION_LOVE;
  if ((officer.hates ?? []).includes(otherId)) score += hateScore;
  const relation = officer.relationships?.[otherId];
  if (relation === 'sworn') score += swornScore;
  if (relation === 'spouse') score += CAP_RELATION_SPOUSE;
  return score;
}

/** 武将官职在官职表中的档位序号（0 ~ POSITION_TIERS-1），无官职返回 -1 */
export function officerPositionTierIndex(officer: Officer): number {
  if (!officer.positionId) return -1;
  const index = POSITIONS.findIndex((position) => position.id === officer.positionId);
  return index >= 0 ? Math.floor(index / 4) : -1;
}

/**
 * 忠诚度基准值（血色衣冠 6.0 子系统①）—— 决定褒奖能达到的忠诚上限：
 *   100 − 相性差(与君主)×60% + 仕龄(年)×3（上限+12） + 官阶加成（满阶+20）
 *   + 与君主关系（亲爱+10 / 厌恶−10 / 结义每人+5 / 配偶+10）
 * 君主自身不参与，返回忠诚上限。
 */
export function loyaltyCapOf(state: GameState, officer: Officer): number {
  const forceId = officer.forceId;
  if (!forceId) return LOYALTY_MAX;
  const force = state.forces[forceId];
  if (!force) return LOYALTY_MAX;
  if (officer.id === force.leaderId) return LOYALTY_MAX;
  let cap = 100;
  cap -= officerCompatWithRuler(state, officer, forceId).diff * LOYALTY_CAP_COMPAT_FACTOR;
  cap += Math.min(serviceYearsOf(officer) * LOYALTY_CAP_SERVICE_PER_YEAR, LOYALTY_CAP_SERVICE_MAX);
  const tierIndex = officerPositionTierIndex(officer);
  if (tierIndex >= 0) {
    const maxTier = Math.max(1, Math.ceil(POSITIONS.length / 4) - 1);
    cap += Math.round(LOYALTY_CAP_POSITION_MAX * (tierIndex / maxTier));
  }
  cap += relationScoreTowards(officer, force.leaderId, CAP_RELATION_HATE, CAP_RELATION_SWORN);
  return clampLoyalty(cap);
}

/** 登用意愿的浮动值：由执行者 id、目标 id 与当前月决定的确定性伪随机（0 ~ 5），SL 不会改变 */
function willFloatOf(state: GameState, executorId: string, targetId: string): number {
  const key = `${executorId}|${targetId}|${state.month}`;
  let hash = 0;
  for (let index = 0; index < key.length; index += 1) {
    hash = (hash * 31 + key.charCodeAt(index)) >>> 0;
  }
  return hash % RECRUIT_WILL_FLOAT;
}

export type RecruitVerdict = 'accept' | 'refuse' | 'maybe';

export interface RecruitWillResult {
  /** 登用接受意愿；accept 时为 999 */
  will: number;
  verdict: RecruitVerdict;
  /** 必拒原因（refuse 时非空），可直接用于界面提示 */
  reasons: string[];
}

/**
 * 登用接受意愿（血色衣冠 6.0 子系统③）：
 *   基准值 72 + 浮动值(0~5) − 相性差(与登用君主/登用武将折半)×50%
 *   − 忠诚度(下限60)×100% + 登用武将魅力×20%
 *   − 现任君主关系×40% + 登用君主关系×40% + 登用武将关系×20%
 *   + 俘虏10 − 初仕20 − 义理×2(有归属) + 野心×2(无归属) + 论客5
 * 硬性判定：亲爱登用君主且在野/俘虏 → 必定同意；目标是君主 / 双向厌恶 /
 * 在仕忠诚高于 96 → 必定拒绝。>0 才有可能，≥20 基本必中。
 */
export function recruitWillOf(state: GameState, executor: Officer, target: Officer): RecruitWillResult {
  const reasons: string[] = [];
  const executorForceId = executor.forceId;
  if (!executorForceId) return { will: 0, verdict: 'refuse', reasons: ['执行方无效'] };

  const rulerId = state.forces[executorForceId]?.leaderId;
  const ruler = rulerId ? state.officers[rulerId] : undefined;

  // 必定同意：目标亲爱登用方君主，且目标在野或被俘（血色「必定同意(在野或俘虏)」）
  const isCaptive = target.location.kind === 'captive';
  const isUnaffiliated = target.forceId === null;
  if (rulerId !== undefined && (target.likes ?? []).includes(rulerId) && (isUnaffiliated || isCaptive)) {
    return { will: 999, verdict: 'accept', reasons: ['素来亲善我方君主，必定同意'] };
  }

  // 必定拒绝 1：目标是君主
  if (target.forceId && state.forces[target.forceId]?.leaderId === target.id) {
    reasons.push('对方是一方君主');
  }
  // 必定拒绝 2：厌恶登用君主 / 厌恶登用武将（双向，沿用原版 crossHates 口径）
  const targetHatesRuler = rulerId !== undefined && (target.hates ?? []).includes(rulerId);
  const targetHatesAgent = (target.hates ?? []).includes(executor.id);
  const rulerHatesTarget = (ruler?.hates ?? []).includes(target.id);
  if (targetHatesRuler || rulerHatesTarget) reasons.push('厌恶我方君主，绝不相从');
  if (targetHatesAgent) reasons.push('厌恶执行武将，绝不相从');
  // 必定拒绝 3：在仕忠诚高于必拒线
  if (target.forceId && officerLoyalty(target) > RECRUIT_REFUSE_LOYALTY) {
    reasons.push(`忠诚高于 ${RECRUIT_REFUSE_LOYALTY}，拒不背主`);
  }
  if (reasons.length > 0) return { will: 0, verdict: 'refuse', reasons };

  // —— 意愿公式 ——
  const targetXing = affinityOf(state, target);
  // 相性差（sp10 过渡）：与登用君主相性差和与登用武将相性差各取一半
  const rulerXing = ruler ? affinityOf(state, ruler) : (rulerId ? state.forces[executorForceId].xing ?? 50 : 50);
  const agentXing = affinityOf(state, executor);
  const effectiveCompatDiff = (circleCompatDiff(targetXing, rulerXing) + circleCompatDiff(targetXing, agentXing)) / 2;

  // 忠诚度：低于 60 按 60 计（在野武将忠诚按 60 计）
  const loyaltyTerm = isUnaffiliated
    ? RECRUIT_WILL_LOYALTY_FLOOR
    : Math.max(officerLoyalty(target), RECRUIT_WILL_LOYALTY_FLOOR);

  // 现任君主关系（在野无现任君主 → 0）
  const currentRulerScore = target.forceId
    ? relationScoreTowards(target, state.forces[target.forceId]?.leaderId, WILL_RELATION_HATE)
    : 0;

  let will = RECRUIT_WILL_BASE
    + willFloatOf(state, executor.id, target.id)
    - effectiveCompatDiff * RECRUIT_WILL_COMPAT_FACTOR
    - loyaltyTerm * RECRUIT_WILL_LOYALTY_FACTOR
    + executor.stats.charisma * RECRUIT_WILL_CHARISMA_FACTOR
    + currentRulerScore * RECRUIT_WILL_CURRENT_RULER_FACTOR
    + relationScoreTowards(target, rulerId, WILL_RELATION_HATE) * RECRUIT_WILL_NEW_RULER_FACTOR
    + relationScoreTowards(target, executor.id, WILL_RELATION_HATE) * RECRUIT_WILL_AGENT_FACTOR;

  if (isCaptive) will += RECRUIT_WILL_CAPTIVE_BONUS;
  // 出仕第一年（在仕且仕龄为 0，换主当年）——在野武将不属于任何势力，不吃此项
  if (target.forceId && serviceYearsOf(target) === 0) will -= RECRUIT_WILL_FIRST_YEAR_PENALTY;
  if (target.forceId) will -= righteousnessTier(target) * RECRUIT_WILL_RIGHTEOUSNESS_STEP;
  if (isUnaffiliated) will += ambitionTier(target) * RECRUIT_WILL_AMBITION_STEP;
  if (officerSkillNames(executor).includes('论客')) will += LOBBYIST_WILL_BONUS;

  return { will: Math.round(will), verdict: 'maybe', reasons };
}

/** 意愿值 → 登用成功率（挖角/劝降路径）：意愿 20 → 30%，40 → 60%，60 → 90% */
export function willSuccessChance(will: number): number {
  return Math.min(90, Math.max(5, Math.round(will * WILL_SUCCESS_FACTOR)));
}

export type RecruitWillTierKey = 'high' | 'mid' | 'low' | 'none';

/** 登用意愿四档（血色 sp10 登庸界面颜色：深绿/浅绿/浅黄/白） */
export function recruitWillTier(will: number): { key: RecruitWillTierKey; label: string } {
  if (will >= 40) return { key: 'high', label: '意愿高' };
  if (will >= 20) return { key: 'mid', label: '意愿中' };
  if (will > 0) return { key: 'low', label: '意愿小' };
  return { key: 'none', label: '无意愿' };
}

/**
 * 每年正月结算仕龄（血色衣冠 6.0）：全体在仕武将（含被俘者）仕龄 +1；
 * 在野武将与已故武将不累计。换主（登用/招降/挖角成功）时由调用方重置为 0。
 */
export function settleServiceYears(state: GameState): void {
  for (const officer of Object.values(state.officers)) {
    if (officer.forceId === null) continue;
    if (officer.deathMonth) continue;
    officer.serviceYears = serviceYearsOf(officer) + 1;
  }
}

/**
 * 季初（1/4/7/10月的第一旬）忠诚自然波动 —— 血色衣冠 6.0 子系统②：
 *  1. 亲爱君主 → 必不下降；
 *  2. 仁政（城级）：武将所在城内有「仁政」持有者驻留 → 本城免疫；
 *  3. 必定下降：厌恶君主，或高野心低义理（野心≥3档且义理≤1档）；
 *  4. 相性差 ≤15 且非俘虏 → 不下降；
 *  5. 概率 = (基准值 − 君主魅力)×40% + (功绩 − 官职门槛功绩)×0.05%，上限 90%；
 *  6. 「克己复礼」科技：下降概率降低50%（厌恶君主者除外）；
 *  7. 数值 = 浮动值(1~3) + 2 − 义理档位，再按野心档位修正（÷4 / ÷2 / 不变 / ×2 / ×4）。
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
    const ruler = state.officers[leaderId];
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
      // 1. 亲爱君主：必不下降
      if ((officer.likes ?? []).includes(leaderId)) continue;
      const current = officerLoyalty(officer);
      if (current <= 0) continue;
      // 2. 仁政（城级）免疫
      if (officer.location.kind === 'city' && benevolentCityIds.has(officer.location.cityId)) continue;

      // 3. 必定下降分支：厌恶君主 / 高野心低义理
      const dislikesRuler = (officer.hates ?? []).includes(leaderId);
      const recklesslyAmbitious = ambitionTier(officer) >= 3 && righteousnessTier(officer) <= 1;
      const forcedDrop = dislikesRuler || recklesslyAmbitious;

      if (!forcedDrop) {
        // 4. 相性足够亲近（≤15）且不是俘虏 → 本季不下降
        const { diff } = officerCompatWithRuler(state, officer, forceId);
        if (diff <= LOYALTY_DROP_CLOSE_COMPAT && officer.location.kind !== 'captive') continue;

        // 5. 概率 = (基准值 − 君主魅力)×40% + (功绩 − 官职门槛)×0.05%
        const cap = loyaltyCapOf(state, officer);
        const rulerCharisma = ruler?.stats.charisma ?? 50;
        const position = positionDefinition(officer.positionId);
        const meritGap = officerMerit(officer) - (position?.merit ?? 0);
        const dropChance = Math.min(
          LOYALTY_DROP_CHANCE_MAX,
          Math.max(0, (cap - rulerCharisma) * LOYALTY_DROP_RULER_CHARISMA_FACTOR + meritGap * LOYALTY_DROP_MERIT_FACTOR),
        );
        if (dropChance <= 0) continue;

        // 6. 克己复礼：下降概率降低50%
        if (resistLoyaltyLoss) {
          const resistRoll = nextRandom(state.seed, state.rngCursor);
          state.rngCursor = resistRoll.cursor;
          if (resistRoll.value < 0.5) continue;
        }

        const roll = nextRandom(state.seed, state.rngCursor);
        state.rngCursor = roll.cursor;
        if (roll.value >= dropChance) continue;
      }

      // 7. 下降数值 = 浮动值(1~3) + 2 − 义理档位，按野心档位修正
      const floatRoll = nextRandom(state.seed, state.rngCursor);
      state.rngCursor = floatRoll.cursor;
      const giriTier = righteousnessTier(officer);
      const ambTier = ambitionTier(officer);
      const rawDrop = (1 + Math.floor(floatRoll.value * 3)) + 2 - giriTier;
      const scaled = ambTier === 0 ? rawDrop / 4
        : ambTier === 1 ? rawDrop / 2
          : ambTier === 3 ? rawDrop * 2
            : ambTier === 4 ? rawDrop * 4
              : rawDrop;
      // 非必降分支数值 ≤0 视为本季不降；必降分支至少掉 1
      const drop = Math.max(forcedDrop ? 1 : 0, Math.round(scaled));
      if (drop <= 0) continue;
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
