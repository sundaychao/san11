import { armamentsExceedCap, CITY_ARMAMENT_CAPS, clampArmamentsTo, PASS_ARMAMENT_CAPS } from './armaments';
import { CITY_FOOD_CAP, CITY_GOLD_CAP, cityTroopCap } from './innerAffairs';
import { PASS_FOOD_CAP, PASS_GOLD_CAP, PASS_TROOP_CAP } from './passes';
import type { City, GameState, Pass } from './types';

/**
 * 据点（城池/关隘）资源容纳上限的统一收口。
 *
 * 设计要点：上限是**不变量**，而不是某几条产粮/产金指令的局部规则 —— 所以这里不逐个改写
 * 各处 `city.gold += x`，而是在指令结算、旬月结算、部队回城/回关并账等边界上统一截断。
 * 任何新增的资源写入路径只要经过这些边界就自动受约束。
 *
 * 溢出部分直接丢弃（与原版三国志11 一致），不做寄存/回退。
 */

/** 截断城池资源到上限（**就地修改**，调用方需保证 state 已克隆） */
export function clampCityResources(city: City): void {
  if (city.gold > CITY_GOLD_CAP) city.gold = CITY_GOLD_CAP;
  else if (city.gold < 0) city.gold = 0;
  if (city.food > CITY_FOOD_CAP) city.food = CITY_FOOD_CAP;
  else if (city.food < 0) city.food = 0;
  const troopCap = cityTroopCap(city);
  if (city.troops > troopCap) city.troops = troopCap;
  else if (city.troops < 0) city.troops = 0;
  if (city.armaments) clampArmamentsTo(city.armaments, CITY_ARMAMENT_CAPS);
}

/** 截断关隘资源到上限（**就地修改**，调用方需保证 state 已克隆） */
export function clampPassResources(pass: Pass): void {
  if (pass.gold > PASS_GOLD_CAP) pass.gold = PASS_GOLD_CAP;
  else if (pass.gold < 0) pass.gold = 0;
  if (pass.food > PASS_FOOD_CAP) pass.food = PASS_FOOD_CAP;
  else if (pass.food < 0) pass.food = 0;
  if (pass.troops > PASS_TROOP_CAP) pass.troops = PASS_TROOP_CAP;
  else if (pass.troops < 0) pass.troops = 0;
  if (pass.armaments) clampArmamentsTo(pass.armaments, PASS_ARMAMENT_CAPS);
}

/** 某城池是否有资源超出上限（含负数兜底） */
function cityExceedsCaps(city: City): boolean {
  return city.gold > CITY_GOLD_CAP || city.gold < 0
    || city.food > CITY_FOOD_CAP || city.food < 0
    || city.troops > cityTroopCap(city) || city.troops < 0
    || armamentsExceedCap(city.armaments, CITY_ARMAMENT_CAPS);
}

/** 某关隘是否有资源超出上限（含负数兜底） */
function passExceedsCaps(pass: Pass): boolean {
  return pass.gold > PASS_GOLD_CAP || pass.gold < 0
    || pass.food > PASS_FOOD_CAP || pass.food < 0
    || pass.troops > PASS_TROOP_CAP || pass.troops < 0
    || armamentsExceedCap(pass.armaments, PASS_ARMAMENT_CAPS);
}

/** 全图是否存在超限据点（负数同样视为需要修正） */
export function strongholdsExceedCaps(state: GameState): boolean {
  for (const city of Object.values(state.cities)) {
    if (cityExceedsCaps(city)) return true;
  }
  for (const pass of Object.values(state.passes ?? {})) {
    if (passExceedsCaps(pass)) return true;
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
  for (const city of Object.values(state.cities)) clampCityResources(city);
  for (const pass of Object.values(state.passes ?? {})) clampPassResources(pass);
}
