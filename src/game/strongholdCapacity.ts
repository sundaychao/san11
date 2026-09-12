import { ARMAMENT_TYPES, armamentsExceedCap, CITY_ARMAMENT_CAPS, clampArmamentsTo, PASS_ARMAMENT_CAPS } from './armaments';
import { CITY_FOOD_CAP, CITY_GOLD_CAP, cityTroopCap } from './innerAffairs';
import { PASS_FOOD_CAP, PASS_GOLD_CAP, PASS_TROOP_CAP } from './passes';
import { strongholdCapacityMultiplier } from './techs';
import type { City, CityArmaments, ForceId, GameState, Pass } from './types';

/**
 * 据点（城池/关隘）资源容纳上限的统一收口。
 *
 * 设计要点：上限是**不变量**，而不是某几条产粮/产金指令的局部规则 —— 所以这里不逐个改写
 * 各处 `city.gold += x`，而是在指令结算、旬月结算、部队回城/回关并账等边界上统一截断。
 * 任何新增的资源写入路径只要经过这些边界就自动受约束。
 *
 * 溢出部分直接丢弃（与原版三国志11 一致），不做寄存/回退。
 *
 * 科技「修筑要塞」（xiuzhuyaosai）使本方据点容量＋100%：上限因此与**归属势力**相关，
 * 带 state 的入口（clampStrongholdsInPlace / clampStrongholdResources / strongholdsExceedCaps）
 * 会自动乘上 `strongholdCapacityMultiplier`；不带 state 的单体入口按基准上限处理（旧调用兼容）。
 */

/** 据点资源上限（金/粮/兵/兵装） */
export interface StrongholdResourceCaps {
  gold: number;
  food: number;
  troops: number;
  armaments: CityArmaments;
}

/** 科技「修筑要塞」带来的容量倍率（无主据点或未提供 state 时为 1） */
function capacityMultiplierOf(state: GameState | undefined, forceId: ForceId | null | undefined): number {
  if (!state || !forceId) return 1;
  return strongholdCapacityMultiplier(state, forceId);
}

function scaledArmamentCaps(caps: CityArmaments, multiplier: number): CityArmaments {
  if (multiplier === 1) return { ...caps };
  const scaled = { ...caps };
  for (const type of ARMAMENT_TYPES) scaled[type] = Math.round(caps[type] * multiplier);
  return scaled;
}

/** 城池资源上限（含科技「修筑要塞」倍率；state 缺省时按基准上限） */
export function cityResourceCaps(state: GameState | undefined, city: City): StrongholdResourceCaps {
  const multiplier = capacityMultiplierOf(state, city.ownerId);
  return {
    gold: Math.round(CITY_GOLD_CAP * multiplier),
    food: Math.round(CITY_FOOD_CAP * multiplier),
    troops: Math.round(cityTroopCap(city) * multiplier),
    armaments: scaledArmamentCaps(CITY_ARMAMENT_CAPS, multiplier),
  };
}

/** 关隘资源上限（含科技「修筑要塞」倍率；state 缺省时按基准上限） */
export function passResourceCaps(state: GameState | undefined, pass: Pass): StrongholdResourceCaps {
  const multiplier = capacityMultiplierOf(state, pass.ownerId);
  return {
    gold: Math.round(PASS_GOLD_CAP * multiplier),
    food: Math.round(PASS_FOOD_CAP * multiplier),
    troops: Math.round(PASS_TROOP_CAP * multiplier),
    armaments: scaledArmamentCaps(PASS_ARMAMENT_CAPS, multiplier),
  };
}

/** 截断城池资源到上限（**就地修改**，调用方需保证 state 已克隆）。
 * 传入 state 时按该城归属势力的科技倍率计算上限。 */
export function clampCityResources(city: City, state?: GameState): void {
  const caps = cityResourceCaps(state, city);
  if (city.gold > caps.gold) city.gold = caps.gold;
  else if (city.gold < 0) city.gold = 0;
  if (city.food > caps.food) city.food = caps.food;
  else if (city.food < 0) city.food = 0;
  if (city.troops > caps.troops) city.troops = caps.troops;
  else if (city.troops < 0) city.troops = 0;
  if (city.armaments) clampArmamentsTo(city.armaments, caps.armaments);
}

/** 截断关隘资源到上限（**就地修改**，调用方需保证 state 已克隆）。
 * 传入 state 时按该关隘归属势力的科技倍率计算上限。 */
export function clampPassResources(pass: Pass, state?: GameState): void {
  const caps = passResourceCaps(state, pass);
  if (pass.gold > caps.gold) pass.gold = caps.gold;
  else if (pass.gold < 0) pass.gold = 0;
  if (pass.food > caps.food) pass.food = caps.food;
  else if (pass.food < 0) pass.food = 0;
  if (pass.troops > caps.troops) pass.troops = caps.troops;
  else if (pass.troops < 0) pass.troops = 0;
  if (pass.armaments) clampArmamentsTo(pass.armaments, caps.armaments);
}

/** 某城池是否有资源超出上限（含负数兜底） */
function cityExceedsCaps(city: City, state?: GameState): boolean {
  const caps = cityResourceCaps(state, city);
  return city.gold > caps.gold || city.gold < 0
    || city.food > caps.food || city.food < 0
    || city.troops > caps.troops || city.troops < 0
    || armamentsExceedCap(city.armaments, caps.armaments);
}

/** 某关隘是否有资源超出上限（含负数兜底） */
function passExceedsCaps(pass: Pass, state?: GameState): boolean {
  const caps = passResourceCaps(state, pass);
  return pass.gold > caps.gold || pass.gold < 0
    || pass.food > caps.food || pass.food < 0
    || pass.troops > caps.troops || pass.troops < 0
    || armamentsExceedCap(pass.armaments, caps.armaments);
}

/** 全图是否存在超限据点（负数同样视为需要修正）；按各据点归属势力的容量倍率判定 */
export function strongholdsExceedCaps(state: GameState): boolean {
  for (const city of Object.values(state.cities)) {
    if (cityExceedsCaps(city, state)) return true;
  }
  for (const pass of Object.values(state.passes ?? {})) {
    if (passExceedsCaps(pass, state)) return true;
  }
  return false;
}

/**
 * 把所有城池/关隘的资源截断到上限，返回新的 state。
 * **无超限时原样返回入参**（保持引用相等，避免无谓的重渲染与存档写入）；
 * 有超限时**先克隆再截断**，绝不就地修改调用方持有的 state。
 */
export function clampStrongholdResources(state: GameState): GameState {
  if (!strongholdsExceedCaps(state)) return state;
  const next = structuredClone(state);
  clampStrongholdsInPlace(next);
  return next;
}

/**
 * 就地截断全图据点资源。仅用于**已经克隆过**的 state（如旬/月结算的 `next`），
 * 不要直接作用于外部传入的状态对象。
 */
export function clampStrongholdsInPlace(state: GameState): void {
  for (const city of Object.values(state.cities)) clampCityResources(city, state);
  for (const pass of Object.values(state.passes ?? {})) clampPassResources(pass, state);
}
