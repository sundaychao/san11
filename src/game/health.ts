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

/** 伤病摘要（供 UI 徽章/提示展示）：等级名、剩余恢复旬数、能力衰减系数 */
export function officerHealthSummary(officer: Officer): { level: OfficerHealth['level']; label: string; remainingTenDays: number; multiplier: number } | null {
  if (!officer.health) return null;
  return {
    level: officer.health.level,
    label: HEALTH_LABELS[officer.health.level],
    remainingTenDays: officer.health.remainingTenDays,
    multiplier: injuryMultiplier(officer),
  };
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

/** 战死 / 病逝：武将死亡（局中保留记录）。
 *  顺序关键：先记死亡日志、再执行善后（此时 forceId/location 尚未清理，
 *  主公继位与部队善后才能定位到死者归属），最后清空归属与伤病。 */
export function markDeath(state: GameState, officer: Officer, cause: string): void {
  if (officer.deathMonth) return;
  officer.deathMonth = state.month;
  state.logs.push({
    id: `death-${state.month}-${officer.id}-${state.logs.length}`,
    month: state.month,
    forceId: officer.forceId,
    message: `${officer.name}${cause}`,
  });
  applyDeathConsequences(state, officer);
  officer.forceId = null;
  officer.location = { kind: 'unaffiliated', cityId: officer.cityId };
  officer.health = undefined;
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

/** 剧本起始年份（按剧本 id 映射；两剧本同期开局）。
 *  注意：不可从 scenario/jingxiang208 导入——skills→captives/duel/turn→health 的
 *  既有依赖链会在模块初始化时形成循环，导致常量读取到 TDZ undefined。 */
const SCENARIO_START_YEARS: Record<GameState['scenarioId'], number> = {
  'jingxiang-208': 208,
  'mobile-duel': 208,
};

/** 指定月份的公元年份（局内 month 从 1 起，每 12 个月推进一年） */
export function scenarioYearAt(scenarioId: GameState['scenarioId'], month: number): number {
  return SCENARIO_START_YEARS[scenarioId] + Math.floor((month - 1) / 12);
}

/** 当前公元年份 */
export function scenarioYear(state: GameState): number {
  return scenarioYearAt(state.scenarioId, state.month);
}

/** 武将岁数：死亡则按死亡月份返回享年，健在返回当前年龄 */
export function officerAge(state: GameState, officer: Officer): number | null {
  if (officer.birthYear === undefined) return null;
  const year = officer.deathMonth !== undefined
    ? scenarioYearAt(state.scenarioId, officer.deathMonth)
    : scenarioYear(state);
  return year - officer.birthYear;
}

/** 老龄病逝：58 岁起每岁 +2%/月，上限 30% */
export function oldAgeDeathChance(age: number): number {
  return Math.min(0.3, Math.max(0, (age - 58) * 0.02));
}

/** 武将死亡善后：主公继位（统率高者继任）、清空太守、部队副将继任或溃散 */
export function applyDeathConsequences(state: GameState, officer: Officer): void {
  // 势力主公：由统率最高的在世同势力武将继任
  if (officer.forceId) {
    const force = state.forces[officer.forceId];
    if (force && force.leaderId === officer.id) {
      const successor = Object.values(state.officers)
        .filter((candidate) => candidate.forceId === officer.forceId
          && candidate.id !== officer.id
          && candidate.deathMonth === undefined)
        .sort((a, b) => b.stats.leadership - a.stats.leadership)[0];
      if (successor) {
        force.leaderId = successor.id;
        state.logs.push({
          id: `succession-${state.month}-${state.logs.length}`,
          month: state.month,
          forceId: officer.forceId,
          message: `${successor.name}继任${force.name}之主`,
        });
      }
    }
  }
  // 太守：清空即可，后续调城自动补任
  for (const city of Object.values(state.cities)) {
    if (city.governorId === officer.id) city.governorId = null;
  }
  // 部队主将：副将继任；无副将则部队溃散
  if (officer.location.kind === 'unit') {
    const unit = state.units[officer.location.unitId];
    if (unit && unit.leaderId === officer.id) {
      const successor = (unit.officerIds ?? [])
        .map((id) => state.officers[id])
        .find((candidate) => candidate && candidate.deathMonth === undefined && candidate.id !== officer.id);
      if (successor) {
        unit.leaderId = successor.id;
        unit.officerIds = (unit.officerIds ?? []).filter((id) => id !== officer.id);
      } else {
        delete state.units[unit.id];
      }
    }
  }
}

/**
 * 每月老龄结算：58 岁以上武将按年龄概率病逝（强运免死；在世者才判定）。
 * 在 settleMonth 调用；只有高龄武将会消耗 RNG。
 */
export function settleAgingDeaths(state: GameState): void {
  const year = scenarioYear(state);
  for (const officer of Object.values(state.officers)) {
    if (officer.deathMonth !== undefined || !officer.birthYear) continue;
    const age = year - officer.birthYear;
    // markDeath 内部已含死亡善后（主公继位/太守清位/部队善后）
    rollDeath(state, officer, oldAgeDeathChance(age), '寿终正寝');
  }
}