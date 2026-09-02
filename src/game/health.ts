import { nextRandom } from './random';
import { effectsOfKind, officerSkillNames, resolveOfficerSkills } from './skills';
import type { GameState, Officer, OfficerHealth } from './types';

/**
 * 伤病机制（参考《三国志11》原版）：
 * - 战败部队武将、被战法/单挑击败者均有概率负伤；瘟疫也可能使武将染病。
 * - 轻伤/中等/重伤三档，按旬恢复，恢复天数随等级递增；伤愈前能力按比例衰减。
 * - 「强运」与「解毒」（青囊书）免疫负伤/染病。
 */
export const HEALTH_TEN_DAYS: Record<NonNullable<OfficerHealth['level']>, number> = {
  light: 9,
  moderate: 18,
  severe: 27,
};

export const HEALTH_LABELS: Record<NonNullable<OfficerHealth['level']>, string> = {
  light: '轻伤',
  moderate: '中等',
  severe: '重伤',
};

/** 受伤状态下的能力衰减系数 */
export function injuryMultiplier(officer: Officer): number {
  switch (officer.health?.level) {
    case 'light': return 0.9;
    case 'moderate': return 0.75;
    case 'severe': return 0.5;
    default: return 1;
  }
}

/** 该武将当前是否带伤（能力衰减判断用） */
export function isInjured(officer: Officer): boolean {
  return Boolean(officer.health);
}

export function injuryTenDays(level: OfficerHealth['level']): number {
  return HEALTH_TEN_DAYS[level];
}

/** 受到伤害后进入受伤状态（强运/解毒豁免） */
export function applyInjury(state: GameState, officer: Officer, level: OfficerHealth['level'] = 'light', forced = false): boolean {
  if (officer.deathMonth) return false;
  if (!forced) {
    // 强运/护卫等：injuryImmune 效果豁免负伤
    if (effectsOfKind(resolveOfficerSkills(state, [officer.id]), 'injuryImmune').length > 0) return false;
    if (officerSkillNames(officer).includes('解毒')) return false;
  }
  officer.health = { level, remainingTenDays: injuryTenDays(level) };
  return true;
}

/** 武将染病（瘟疫事件）：中等或重伤，恢复更慢 */
export function applyIllness(state: GameState, officer: Officer): boolean {
  return applyInjury(state, officer, 'moderate');
}

/** 旬末：伤病按旬恢复；中等/重伤有小概率伤重不治；剩余0时痊愈 */
export function settleOfficerHealth(state: GameState): void {
  for (const officer of Object.values(state.officers)) {
    if (!officer.health || officer.location.kind === 'captive') continue;
    // 伤势恶化：中等 3%/旬、重伤 8%/旬 概率病逝（强运免死由 rollDeath 处理；轻伤不掷点）
    if (rollDeath(state, officer, ILLNESS_DEATH_CHANCE[officer.health.level], '伤重不治')) continue;
    officer.health.remainingTenDays -= 1;
    if (officer.health.remainingTenDays <= 0) {
      state.logs.push({
        id: `heal-${state.month}-${officer.id}-${state.logs.length}`,
        month: state.month,
        forceId: officer.forceId,
        message: `${officer.name}伤势痊愈`,
      });
      officer.health = undefined;
    }
  }
}

/** 战死 / 病逝：武将死亡（局中保留记录） */
export function markDeath(state: GameState, officer: Officer, cause: string): void {
  if (officer.deathMonth) return;
  officer.forceId = null;
  officer.location = { kind: 'unaffiliated', cityId: officer.cityId };
  officer.health = undefined;
  officer.deathMonth = state.month;
  state.logs.push({
    id: `death-${state.month}-${officer.id}-${state.logs.length}`,
    month: state.month,
    forceId: null,
    message: `${officer.name}${cause}`,
  });
}

/** 战败部队中的武将：按概率负伤（未受俘者，强运豁免） */
export function applyDefeatInjuries(state: GameState, officers: Officer[], woundedChance = 0.25): string[] {
  const wounded: string[] = [];
  for (const officer of officers) {
    if (!officer.health && officer.deathMonth === undefined) {
      const roll = nextRandom(state.seed, state.rngCursor);
      state.rngCursor = roll.cursor;
      if (roll.value < woundedChance) {
        if (applyInjury(state, officer, 'light')) wounded.push(officer.name);
      }
    }
  }
  return wounded;
}

/** 武将当前有效能力（含伤病衰减） */
export function effectiveStat(officer: Officer, key: keyof Officer['stats']): number {
  return Math.round(officer.stats[key] * injuryMultiplier(officer));
}

/** 部队被歼灭时武将战死的基础概率 */
export const DEFEAT_DEATH_CHANCE = 0.12;
/** 单挑中将对方 HP 打到 0 时的讨取概率 */
export const DUEL_KILL_CHANCE = 0.25;
/** 旬结算时伤重不治概率：中等 3%/旬，重伤 8%/旬（轻伤不判定） */
export const ILLNESS_DEATH_CHANCE: Record<NonNullable<OfficerHealth['level']>, number> = {
  light: 0,
  moderate: 0.03,
  severe: 0.08,
};

/** 武将是否可被战死（强运/护卫等 injuryImmune 效果免死） */
export function canDieInBattle(state: GameState, officer: Officer): boolean {
  return effectsOfKind(resolveOfficerSkills(state, [officer.id]), 'injuryImmune').length === 0;
}

/** 战死判定：掷点成功则武将阵亡并写日志；返回是否死亡（chance<=0 时不消耗 RNG） */
export function rollDeath(state: GameState, officer: Officer, chance: number, cause = '阵亡'): boolean {
  if (chance <= 0) return false;
  if (officer.deathMonth !== undefined) return false;
  if (!canDieInBattle(state, officer)) return false;
  const roll = nextRandom(state.seed, state.rngCursor);
  state.rngCursor = roll.cursor;
  if (roll.value >= chance) return false;
  markDeath(state, officer, cause);
  return true;
}