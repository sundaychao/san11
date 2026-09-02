import { nextRandom } from './random';
import { officerSkillNames } from './skills';
import type { ForceId, GameState, Officer } from './types';

/**
 * 外交系统（参考《三国志11》原版）：
 * - 亲善：固定花1000金，提升双方友好度；增长与执行者政治、君主相性差、亲疏关系相关。
 * - 同盟：无期限互不侵犯，成功与否由「金钱/政治/相性/友好度」判定；成功后可请求援军。
 * - 停战：有明确期限（1~24个月）的互不侵犯；期限越长判定门槛越高。
 * - 请求援军：仅同盟可用，向盟友请求出兵攻击指定敌城；成功后盟友将在目标城旁出兵。
 */

export const DIPLOMACY_AP_COST = 20;
export const GOODWILL_GOLD_COST = 1000;
/** 同盟/停战可送出的资金上限 */
export const DIPLOMACY_GOLD_MAX = 10000;
/** 停战期限范围（月，1~24） */
export const TRUCE_MONTHS_MIN = 1;
export const TRUCE_MONTHS_MAX = 24;
/** 请求援军预期驻留旬数（约3个月=9旬） */
export const REINFORCEMENT_TEN_DAYS = 9;

/** 每旬一旬共计 month*3+tenDay，用于换算 */
export function tenDayIndex(month: number, tenDay: 1 | 2 | 3): number {
  return month * 3 + tenDay;
}

export function clampDiplomacy(value: number): number {
  return Math.min(100, Math.max(-100, Math.round(value)));
}

/** 读取 from 势力对 to 势力的好感度（-100~100，默认0） */
export function forceDiplomacy(state: GameState, from: ForceId, to: ForceId): number {
  if (from === to) return 100;
  return state.forces[from]?.diplomacy?.[to] ?? 0;
}

/** 双向增减好感度（亲善/流言/破盟等统一入口） */
export function adjustDiplomacy(state: GameState, from: ForceId, to: ForceId, delta: number): void {
  if (from === to) return;
  for (const [source, target] of [[from, to], [to, from]] as const) {
    const force = state.forces[source];
    if (!force) continue;
    const diplomacy = force.diplomacy ?? {};
    diplomacy[target] = clampDiplomacy((diplomacy[target] ?? 0) + delta);
    force.diplomacy = diplomacy;
  }
}

export function areAllies(state: GameState, a: ForceId, b: ForceId): boolean {
  return a !== b && (state.forces[a]?.allies ?? []).includes(b);
}

/** 双方势力是否互不侵犯（同盟或停战期内） */
export function areNonAggressed(state: GameState, attacker: ForceId, defender: ForceId): boolean {
  return areAllies(state, attacker, defender) || (state.forces[attacker]?.truces?.[defender] ?? 0) > 0;
}

/** 相性（默认与势力存档一致，缺失时按势力顺序给25/75/125/130） */
export function forceXing(state: GameState, forceId: ForceId): number {
  const stored = state.forces[forceId]?.xing;
  if (typeof stored === 'number') return stored;
  const defaults: Record<ForceId, number> = { cao: 25, liu: 75, sun: 125, biao: 130 };
  return defaults[forceId] ?? 50;
}

/** 相性差（同一圆环上取最短距离，范围0~75） */
export function compatDifference(state: GameState, a: ForceId, b: ForceId): number {
  const diff = Math.abs(forceXing(state, a) - forceXing(state, b));
  return Math.min(diff, 150 - diff);
}

/** 亲疏系数 c：执行者与目标君主为义兄弟/配偶 → 1.5，否则 1.0 */
function relationshipCoefficient(state: GameState, from: ForceId, to: ForceId, officer: Officer): number {
  const targetLeader = state.forces[to]?.leaderId;
  if (!targetLeader) return 1.0;
  const relation = officer.relationships?.[targetLeader];
  return relation === 'sworn' || relation === 'spouse' ? 1.5 : 1.0;
}

/**
 * 亲善成功后友好度增长：
 * ( c*20 + max(执行者政治 − 相性差/2, 0) + 100 ) / 10，至少1点。
 */
export function goodwillGain(state: GameState, from: ForceId, to: ForceId, officer: Officer): number {
  const c = relationshipCoefficient(state, from, to, officer);
  const compat = compatDifference(state, from, to);
  const raw = (c * 20 + Math.max(officer.stats.politics - Math.floor(compat / 2), 0) + 100) / 10;
  return Math.max(1, Math.floor(raw));
}

export interface DiplomacyJudgment {
  success: boolean;
  captured: boolean;
  judgment: number;
}

function roll100(state: GameState): number {
  const roll = nextRandom(state.seed, state.rngCursor);
  state.rngCursor = roll.cursor;
  return Math.floor(roll.value * 100);
}

/**
 * 同盟判定：
 * 判定值 = (金钱/150 + 执行者政治 − 相性差/5 + c*10) * t（t取1.0）
 * 判定值 > (100 − 友好度)*2 → 成功。
 */
export function resolveAlliance(
  state: GameState,
  from: ForceId,
  to: ForceId,
  officer: Officer,
  gold: number,
): DiplomacyJudgment {
  const c = relationshipCoefficient(state, from, to, officer);
  const judgment = Math.floor(gold / 150) + officer.stats.politics
    - Math.ceil(compatDifference(state, from, to) / 5) + Math.round(c * 10);
  const friendly = Math.max(0, forceDiplomacy(state, from, to));
  return {
    success: judgment > (100 - friendly) * 2,
    captured: false,
    judgment,
  };
}

/**
 * 停战判定：
 * 判定值 = (金钱/400 + 执行者政治 − 相性差/5 + c) * t（t取1.0）
 * 判定值 > 80 + 期限/2 − 友好度/4 → 成功。
 */
export function resolveTruce(
  state: GameState,
  from: ForceId,
  to: ForceId,
  officer: Officer,
  gold: number,
  months: number,
): DiplomacyJudgment {
  const c = relationshipCoefficient(state, from, to, officer) === 1.5 ? 20 : 10;
  const judgment = Math.floor(gold / 400) + officer.stats.politics
    - Math.ceil(compatDifference(state, from, to) / 5) + c;
  const friendly = Math.max(0, forceDiplomacy(state, from, to));
  return {
    success: judgment > 80 + months / 2 - friendly / 4,
    captured: false,
    judgment,
  };
}

/**
 * 请求援军判定：友好度与执行者政治越高越易被接受。
 */
export function resolveRequestTroops(
  state: GameState,
  from: ForceId,
  to: ForceId,
  officer: Officer,
): { success: boolean } {
  const friendly = forceDiplomacy(state, from, to);
  const chance = Math.min(95, 45 + Math.floor(friendly / 2) + Math.floor(officer.stats.politics / 3));
  return { success: roll100(state) < chance };
}

/** 某势力当前是否仍拥有城市（无城势力无法关押俘虏/出兵援军） */
export function forceHasCity(state: GameState, forceId: ForceId): boolean {
  return Object.values(state.cities).some((city) => city.ownerId === forceId);
}

/** 获取某势力当前拥有（且未被关押）的最高智力武将，用于流言防御方 */
export function forceStrategist(state: GameState, forceId: ForceId): Officer | undefined {
  return Object.values(state.officers)
    .filter((officer) => officer.forceId === forceId && officer.location.kind !== 'captive')
    .sort((a, b) => b.stats.intelligence - a.stats.intelligence)[0];
}

/** 武将是否持有「强运」特技 */
export function hasStrongLuckSkill(officer: Officer): boolean {
  return officerSkillNames(officer).includes('强运');
}

/** 武将是否持有「论客」特技 */
export function hasLobbyistSkill(officer: Officer): boolean {
  return officerSkillNames(officer).includes('论客');
}