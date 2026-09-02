import { nextRandom } from './random';
import { effectsOfKind, resolveOfficerSkills } from './skills';
import { clampLoyalty, recruitmentInitialLoyalty, setOfficerLoyalty } from './loyalty';
import { compatDifference } from './diplomacy';
import { treasureDefinition } from './treasures';
import { applyDefeatInjuries, DEFEAT_DEATH_CHANCE, rollDeath } from './health';
import type { ArmyUnit, CityId, ForceId, GameState, Officer } from './types';

/**
 * 俘虏系统（参考《三国志11》原版）：
 * - 追击损灭敌部队时按捕获率判定俘获敌将；「强运」不受俘、「血路」部队全员不受俘、
 *   名马宝物不受俘、攻击方有「捕缚」则必俘；武/智越高越难被抓。
 * - 俘虏每月忠诚下降（1/4/7/10月额外下降），忠诚降至 94 以下才可登用。
 * - 处置：登用/释放（没收宝物，禁仕6个月）/处决（死亡）。
 * - 俘虏每月有概率逃走；关押势力失去全部城市时俘虏自动获得自由。
 */
export const CAPTIVE_LOYALTY_DROP_PER_MONTH = 2;
export const CAPTIVE_LOYALTY_DROP_QUARTER_BONUS = 3;
/** 忠诚低于该值方可登用俘虏 */
export const CAPTIVE_RECRUIT_LOYALTY_THRESHOLD = 94;
/** 释放俘虏后的禁仕期限（月） */
export const CAPTIVE_BAN_MONTHS_RELEASE = 6;
/** 每月逃跑基础概率 */
export const CAPTIVE_ESCAPE_CHANCE_BASE = 0.04;

/** 名马宝物 id 集合（持有者不会被俘） */
const NAMED_HORSE_IDS = new Set(['chitu', 'dilu', 'jueying']);

export function isHoldingCaptives(state: GameState, forceId: string): boolean {
  return Object.values(state.officers).some(
    (officer) => officer.location.kind === 'captive' && officer.location.captorForceId === forceId,
  );
}

export function captivesOf(state: GameState, forceId: string): Officer[] {
  return Object.values(state.officers).filter(
    (officer) => officer.location.kind === 'captive' && officer.location.captorForceId === forceId,
  );
}

/** 装备了名马宝物（不会为对方所捕获） */
export function hasNamedHorse(officer: Officer): boolean {
  return NAMED_HORSE_IDS.has(officer.treasureId ?? '');
}

/**
 * 捕获率（参考原版公式，做了简化）：
 * 捕获率 = ((120 − 敌将较高武力/智力)÷3 × 紧邻我方部队数 × 地形系数 ÷ 难度) + 戟兵击破加成
 * 简化为 0~100 数值，最终受captured上限85约束。
 */
export function captureChance(
  state: GameState,
  victim: Officer,
  looter: ArmyUnit,
  adjacentCount: number,
): number {
  // 强运/血路：captureImmune 效果——部队武将不会被俘
  if (effectsOfKind(resolveOfficerSkills(state, [victim.id]), 'captureImmune').length > 0) return 0;
  // 名马：持名马者不会被俘
  if (hasNamedHorse(victim)) return 0;
  // 捕缚：攻击方必定俘虏敌将
  if (looter.forceId && effectsOfKind(resolveOfficerSkills(state, [looter.leaderId]), 'guaranteedCapture').length > 0) return 100;

  const peak = Math.max(victim.stats.war, victim.stats.intelligence);
  const a = (120 - peak) / 3;
  const b = 1 + Math.min(2, adjacentCount);
  const e = looter.troopType === 'halberd' ? 30 : 0;
  const chance = Math.min(85, Math.max(5, a * b + e));
  return chance;
}

/**
 * 部队被击破后的俘获结算：
 * - 每名武将先进行战死判定（概率阵亡，强运/护卫免死）；
 * - 幸存者按捕获率独立掷点，捕获成功则成为战俘（进入击破方归所城市）；
 * - 未被俘者退回最近己城；所有幸存者均有概率负伤（强运免疫）。
 * 返回值：被俘与阵亡武将名单。
 */
export function captureOfficersOnDestroy(state: GameState, unit: ArmyUnit, looter?: ArmyUnit): { captured: string[]; dead: string[] } {
  if (!looter || looter.forceId === unit.forceId) return { captured: [], dead: [] };
  const adjacentCount = Object.values(state.units).filter(
    (candidate) => candidate.forceId === looter.forceId
      && candidate.id !== unit.id
      && Math.abs(candidate.q - unit.q) + Math.abs(candidate.r - unit.r) === 1,
  ).length;
  const officerIds = unit.officerIds ?? [unit.leaderId];
  const captured: string[] = [];
  const dead: string[] = [];
  const retreatCity = Object.values(state.cities).find((city) => city.ownerId === unit.forceId);
  const captureHome = state.cities[looter.homeCityId];

  for (const officerId of officerIds) {
    const officer = state.officers[officerId];
    if (!officer) continue;
    // 战死判定：部队覆灭时概率阵亡（强运/护卫免死，rollDeath 内部处理）
    if (rollDeath(state, officer, DEFEAT_DEATH_CHANCE, '于部队覆灭中阵亡')) {
      dead.push(officer.name);
      continue;
    }
    const chance = captureChance(state, officer, looter, adjacentCount);
    const roll = nextRandom(state.seed, state.rngCursor);
    state.rngCursor = roll.cursor;
    if (roll.value * 100 < chance && captureHome) {
      officer.location = {
        kind: 'captive',
        cityId: captureHome.id,
        captorForceId: looter.forceId,
        capturedTenDays: 0,
      };
      officer.cityId = captureHome.id;
      captured.push(officer.name);
    } else {
      officer.location = retreatCity ? { kind: 'city', cityId: retreatCity.id } : { kind: 'unaffiliated', cityId: unit.homeCityId };
      officer.cityId = officer.location.cityId;
      officer.acted = false;
    }
  }
  // 负伤结算：未被俘获/未阵亡的败军武将概率负伤（强运免疫由 applyDefeatInjuries 内部处理）
  const survivors = officerIds
    .map((officerId) => state.officers[officerId])
    .filter((officer): officer is Officer => Boolean(officer)
      && officer.location.kind !== 'captive'
      && officer.deathMonth === undefined);
  if (survivors.length > 0) applyDefeatInjuries(state, survivors);
  return { captured, dead };
}

/**
 * 每月俘虏结算：忠诚下降 + 逃生判定 + 释放登用冷却。
 * 在每月初（settleMonth）调用；1/4/7/10月额外下降（同原版季度波动）。
 */
export function settleCaptives(state: GameState): void {
  const month = state.month;
  const quarterBonus = (month - 1) % 3 === 0 ? CAPTIVE_LOYALTY_DROP_QUARTER_BONUS : 0;
  const events: string[] = [];

  for (const officer of Object.values(state.officers)) {
    if (officer.location.kind !== 'captive') continue;
    const holder = state.forces[officer.location.captorForceId];
    // 关押势力已覆灭 → 获得自由
    if (!holder || !Object.values(state.cities).some((city) => city.ownerId === holder.id)) {
      const originalOwner = officer.forceId
        ? Object.values(state.cities).find((city) => city.ownerId === officer.forceId)
        : undefined;
      officer.location = originalOwner
        ? { kind: 'city', cityId: originalOwner.id }
        : { kind: 'unaffiliated', cityId: officer.location.cityId };
      officer.cityId = officer.location.cityId;
      events.push(`${officer.name}趁乱逃回${originalOwner ? state.cities[originalOwner.id].name : '故地'}`);
      continue;
    }

    // 忠诚下降（俘虏原忠诚来自敌势力，随时间逐步剥落）
    const before = officer.loyalty ?? 92;
    if (before > 0) setOfficerLoyalty(officer, before - CAPTIVE_LOYALTY_DROP_PER_MONTH - quarterBonus);

    // 逃生判定：基础概率 + 关押城无太守加成
    const holdingCity = state.cities[officer.location.cityId];
    const escapeChance = CAPTIVE_ESCAPE_CHANCE_BASE + (holdingCity && !holdingCity.governorId ? 0.04 : 0);
    const roll = nextRandom(state.seed, state.rngCursor);
    state.rngCursor = roll.cursor;
    if (roll.value < escapeChance) {
      const ownCity = officer.forceId
        ? Object.values(state.cities).find((city) => city.ownerId === officer.forceId)
        : undefined;
      officer.location = ownCity
        ? { kind: 'city', cityId: ownCity.id }
        : { kind: 'unaffiliated', cityId: officer.location.cityId };
      officer.cityId = officer.location.cityId;
      events.push(`${officer.name}越狱逃走`);
    }
  }

  if (events.length > 0) {
    state.logs.push({
      id: `captive-${month}-${state.logs.length}`,
      month,
      forceId: null,
      message: events.slice(0, 4).join('，'),
    });
  }
}

/** 登用俘虏的成功概率：忠诚越低、执行者能力越高、相性越近越易成功 */
export function recruitCaptiveChance(state: GameState, forceId: ForceId, executor: Officer, target: Officer): number {
  const loyalty = target.loyalty ?? 92;
  const compatibilityPenalty = target.forceId ? compatDifference(state, forceId, target.forceId) / 2 : 0;
  const raw = (executor.stats.politics + executor.stats.charisma) / 2
    + (CAPTIVE_RECRUIT_LOYALTY_THRESHOLD - loyalty) * 1.5
    - compatibilityPenalty;
  return Math.min(90, Math.max(5, Math.floor(raw)));
}

export interface CaptiveRecruitResult {
  success: boolean;
  chance: number;
}

/** 执行登用俘虏：成功则入伍（初始忠诚按义理计算），失败标记禁仕冷却 */
export function resolveRecruitCaptive(state: GameState, forceId: ForceId, executor: Officer, target: Officer): CaptiveRecruitResult {
  const chance = recruitCaptiveChance(state, forceId, executor, target);
  const roll = nextRandom(state.seed, state.rngCursor);
  state.rngCursor = roll.cursor;
  const success = roll.value * 100 < chance;
  if (success) {
    const destCityId: CityId = executor.location.kind === 'city'
      ? executor.location.cityId
      : (target.location as { kind: 'captive'; cityId: CityId }).cityId;
    target.forceId = forceId;
    target.location = { kind: 'city', cityId: destCityId };
    target.cityId = destCityId;
    target.loyalty = recruitmentInitialLoyalty(target);
    target.bannedUntilMonth = undefined;
  } else {
    target.bannedUntilMonth = state.month + 6;
  }
  return { success, chance };
}

/** 释放俘虏：没收其宝物，禁仕6个月后返回原势力 */
export function releaseCaptive(state: GameState, target: Officer): void {
  const captiveLocation = target.location as { kind: 'captive'; cityId: CityId };
  // 没收宝物
  if (target.treasureId) {
    const treasure = state.treasures?.[target.treasureId];
    if (treasure && treasure.holderId === target.id) {
      for (const [key, value] of Object.entries(treasureDefinition(target.treasureId)?.stats ?? {})) {
        target.stats[key as keyof typeof target.stats] -= value ?? 0;
      }
      treasure.holderId = null;
      target.treasureId = undefined;
    }
  }
  target.bannedUntilMonth = state.month + CAPTIVE_BAN_MONTHS_RELEASE;
  const ownCity = target.forceId
    ? Object.values(state.cities).find((city) => city.ownerId === target.forceId)
    : undefined;
  const destCityId: CityId = ownCity ? ownCity.id : captiveLocation.cityId;
  target.location = ownCity
    ? { kind: 'city', cityId: destCityId }
    : { kind: 'unaffiliated', cityId: destCityId };
  target.cityId = destCityId;
}

/** 处决俘虏：武将死亡（保留记录供履历展示） */
export function executeCaptive(state: GameState, target: Officer): void {
  if (target.treasureId) {
    const treasure = state.treasures?.[target.treasureId];
    if (treasure && treasure.holderId === target.id) {
      treasure.holderId = null;
      target.treasureId = undefined;
    }
  }
  target.forceId = null;
  target.location = { kind: 'unaffiliated', cityId: target.cityId };
  target.deathMonth = state.month;
  target.acted = false;
}

/** 与俘虏的对话标签（用于弹窗选中项展示） */
export function captiveStatusLabel(officer: Officer): string {
  return `战俘 · 忠${officer.loyalty ?? 92}`;
}

/** 战俘类别的敌军武将：目标势力关押的俘虏数量 */
export function captiveCountForForce(state: GameState): Map<string, number> {
  const counts = new Map<string, number>();
  for (const officer of captivesOfStored(state)) {
    const key = (officer.location as { captorForceId: string }).captorForceId;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

function captivesOfStored(state: GameState): Officer[] {
  return Object.values(state.officers).filter((officer) => officer.location.kind === 'captive');
}

/** 释放后可登用前的剩余月数（<=0 表示可仕官） */
export function bannedRemainingMonths(state: GameState, officer: Officer): number {
  const bannedUntil = typeof officer.bannedUntilMonth === 'number' ? officer.bannedUntilMonth : -Infinity;
  return Math.max(0, bannedUntil - state.month);
}

/** 忠诚是否已合格（可登用俘虏） */
export function capturableByLoyalty(officer: Officer): boolean {
  return (officer.loyalty ?? 92) < CAPTIVE_RECRUIT_LOYALTY_THRESHOLD;
}

export { };