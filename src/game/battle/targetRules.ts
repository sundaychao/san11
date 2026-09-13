import { PLOT_LABELS, PLOT_MAX_DURABILITY, type PlotType } from '../innerAffairs';
import type { ArmyUnit, City, Facility, ForceId, GameState, Pass } from '../types';
import { siegeWeaponKindOf, unitHasCatapultAttack } from '../armaments';
import { rangedRangeBonus } from '../techs';
import { effectsOfKind, resolveUnitSkills } from '../skills';
import { rangedTargetBlockedByForest } from '../skills/rules/combat';
import { CATAPULT_TOWER_MAX_RANGE, CATAPULT_TOWER_MIN_RANGE, isWaterTerrain } from './catalog';
import { gridKey, neighborsOf, sevenCellCityFootprint, type GridCoord } from './grid';
import { cellAt, cityCenter, unitIsIncapacitated } from './movementRules';

export function areAdjacent(a: GridCoord, b: GridCoord) {
  return neighborsOf(a.q, a.r).some((coord) => coord.q === b.q && coord.r === b.r);
}

export function gridDistanceWithin(from: GridCoord, to: GridCoord, maxDistance: number) {
  if (from.q === to.q && from.r === to.r) return 0;
  const seen = new Set<string>([gridKey(from)]);
  let frontier: GridCoord[] = [from];

  for (let distanceStep = 1; distanceStep <= maxDistance; distanceStep += 1) {
    const nextFrontier: GridCoord[] = [];
    for (const current of frontier) {
      for (const neighbor of neighborsOf(current.q, current.r)) {
        const key = gridKey(neighbor);
        if (seen.has(key)) continue;
        if (neighbor.q === to.q && neighbor.r === to.r) return distanceStep;
        seen.add(key);
        nextFrontier.push(neighbor);
      }
    }
    frontier = nextFrontier;
  }

  return Number.POSITIVE_INFINITY;
}

export function unitAttackRange(state: GameState, unit: ArmyUnit) {
  let range = 1;
  // 投石（弹道）：投石车 / 斗舰获得投石攻击方式，最大射程 3（与投石台同口径）
  const catapultRange = unitHasCatapultAttack(state, unit) ? CATAPULT_TOWER_MAX_RANGE : 0;
  if (isWaterTerrain(cellAt(state, unit)?.terrain)) {
    // 水域部队（含楼船/斗舰）射程 2；开发弹道后的斗舰按投石射程 3
    range = Math.max(2, catapultRange);
  } else if (['crossbow', 'siege'].includes(unit.troopType ?? 'sword')) {
    // 科技「劲弩」：弩兵射程+1
    if (unit.troopType === 'crossbow' && rangedRangeBonus(state, unit.forceId) > 0) range = 3;
    else range = Math.max(2, catapultRange);
  }
  // 白马：骑兵可远程攻击；射程：井阑和投石射程+1
  range += skillAttackRangeBonus(state, unit);
  return range;
}

/**
 * 最小射程（打不到更近的目标）。
 * - 投石车（弹道升级后的井阑）：所有目标都打不到相邻 1 格，最小射程 2；
 * - 斗舰投石：对**据点/设施**的投石与投石车同口径（2~3 格，不能贴脸轰），
 *   但对**部队**仍保留贴脸攻击（最小射程 1），否则斗舰在窄水道里会被完全锁死；
 * - 其余单位最小射程 1。
 */
export function unitMinAttackRange(
  state: GameState,
  unit: ArmyUnit,
  targetKind: 'unit' | 'structure' = 'unit',
) {
  if (siegeWeaponKindOf(state, unit) === 'catapult') return CATAPULT_TOWER_MIN_RANGE;
  if (targetKind === 'structure' && unitHasCatapultAttack(state, unit)) return CATAPULT_TOWER_MIN_RANGE;
  return 1;
}

/** 攻击射程特技加成：白马（骑兵+1）/射程（井阑投石+1） */
export function skillAttackRangeBonus(state: GameState, unit: ArmyUnit) {
  const troopType = unit.troopType ?? 'sword';
  const cavalryRanged = effectsOfKind(resolveUnitSkills(state, unit), 'unitAttackRangeBonus')
    .filter(({ effect }) => !effect.troopTypes || effect.troopTypes.includes(troopType))
    .reduce((sum, { effect }) => sum + effect.add, 0);
  const siegeRanged = troopType === 'siege'
    ? effectsOfKind(resolveUnitSkills(state, unit), 'siegeRangeBonus')
      .reduce((sum, { effect }) => sum + effect.add, 0)
    : 0;
  return cavalryRanged + siegeRanged;
}

/**
 * 距离是否落在 [最小射程, 最大射程] 内。
 * 距离 0（部队与目标同格，例如站在敌方城池的开发设施地格上）按「贴身」处理：
 * 最小射程 1 的单位照旧可以打，只有投石这类最小射程 ≥2 的攻击方式才排除。
 */
function isDistanceInAttackBand(distance: number, minRange: number, maxRange: number) {
  if (distance > maxRange) return false;
  if (distance === 0) return minRange <= 1;
  return distance >= minRange;
}

function isUnitInAttackRange(state: GameState, attacker: ArmyUnit, target: ArmyUnit) {
  const range = unitAttackRange(state, attacker);
  const distance = gridDistanceWithin(attacker, target, range);
  return isDistanceInAttackBand(distance, unitMinAttackRange(state, attacker), range);
}

/** 部队到城池 7 格轮廓的最近距离（超出射程返回 Infinity） */
export function cityAttackDistance(state: GameState, attacker: ArmyUnit, city: City) {
  const range = unitAttackRange(state, attacker);
  return Math.min(...sevenCellCityFootprint(cityCenter(city)).map((coord) => (
    gridDistanceWithin(attacker, coord, range)
  )));
}

export function isCityInAttackRange(state: GameState, attacker: ArmyUnit, city: City) {
  const range = unitAttackRange(state, attacker);
  const distance = cityAttackDistance(state, attacker, city);
  return isDistanceInAttackBand(distance, unitMinAttackRange(state, attacker, 'structure'), range);
}

function isFacilityInAttackRange(state: GameState, attacker: ArmyUnit, facility: Facility) {
  const range = unitAttackRange(state, attacker);
  const distance = gridDistanceWithin(attacker, facility, range);
  return isDistanceInAttackBand(distance, unitMinAttackRange(state, attacker, 'structure'), range);
}

function isActionableFriendlyUnit(unit: ArmyUnit, forceId: ArmyUnit['forceId']) {
  return unit.forceId === forceId && unit.kind !== 'transport' && !unit.moved && !unit.acted && !unitIsIncapacitated(unit) && unit.movementRemaining > 0;
}

/**
 * 射程内的敌方部队。
 *
 * 运输队**可以**攻击敌方部队（攻防力固定 20，见 `TRANSPORT_COMBAT_RATING`），因此这里不再按
 * `kind` 过滤攻击方；但运输队仍然不能攻城 / 攻关 / 打设施 / 打开发地格 —— 那四个入口各自保留
 * `kind === 'transport'` 的拦截，避免辎重队去拆城墙。
 */
export function attackableUnits(state: GameState, attackerId: string, origin?: GridCoord): ArmyUnit[] {
  const attacker = state.units[attackerId];
  if (!attacker) return [];
  const attackerAtOrigin = origin ? { ...attacker, q: origin.q, r: origin.r } : attacker;
  const range = unitAttackRange(state, attackerAtOrigin);
  return Object.values(state.units)
    .filter((unit) => unit.id !== attacker.id && unit.forceId !== attacker.forceId && isUnitInAttackRange(state, attackerAtOrigin, unit))
    // 射手：无射手特技时弩兵不能攻击森林中的目标
    .filter((unit) => !rangedTargetBlockedByForest(state, attackerAtOrigin, unit))
    .sort((a, b) => (
      gridDistanceWithin(attackerAtOrigin, a, range) - gridDistanceWithin(attackerAtOrigin, b, range) ||
      a.id.localeCompare(b.id)
    ));
}

export function attackableCities(state: GameState, attackerId: string, origin?: GridCoord): City[] {
  const attacker = state.units[attackerId];
  if (!attacker || attacker.kind === 'transport') return [];
  const attackerAtOrigin = origin ? { ...attacker, q: origin.q, r: origin.r } : attacker;
  return Object.values(state.cities)
    // 非己方城池一律可攻击，无主无守军城同样可打（守军为 0，只有耐久会掉；耐久归零即攻破占领）。
    // 想保住城内资源应改用「移动进驻」：兵不血刃、资源保留、耐久不减。
    .filter((city) => city.ownerId !== attacker.forceId && isCityInAttackRange(state, attackerAtOrigin, city))
    .sort((a, b) => (
      cityAttackDistance(state, attackerAtOrigin, a) - cityAttackDistance(state, attackerAtOrigin, b) ||
      a.id.localeCompare(b.id)
    ));
}

export function isPassInAttackRange(state: GameState, attacker: ArmyUnit, pass: Pass) {
  const range = unitAttackRange(state, attacker);
  const distance = gridDistanceWithin(attacker, { q: pass.q, r: pass.r }, range);
  return isDistanceInAttackBand(distance, unitMinAttackRange(state, attacker, 'structure'), range);
}

export function attackablePasses(state: GameState, attackerId: string, origin?: GridCoord): Pass[] {
  const attacker = state.units[attackerId];
  if (!attacker || attacker.kind === 'transport') return [];
  const attackerAtOrigin = origin ? { ...attacker, q: origin.q, r: origin.r } : attacker;
  const range = unitAttackRange(state, attackerAtOrigin);
  return Object.values(state.passes ?? {})
    // 同城池：非己方关隘一律可攻击，无主无守军关隘也可打（耐久归零即攻破占领）
    .filter((pass) => pass.ownerId !== attacker.forceId && isPassInAttackRange(state, attackerAtOrigin, pass))
    .sort((a, b) => (
      gridDistanceWithin(attackerAtOrigin, { q: a.q, r: a.r }, range) - gridDistanceWithin(attackerAtOrigin, { q: b.q, r: b.r }, range) ||
      a.id.localeCompare(b.id)
    ));
}

export function attackableFacilities(state: GameState, attackerId: string, origin?: GridCoord): Facility[] {
  const attacker = state.units[attackerId];
  if (!attacker || attacker.kind === 'transport') return [];
  const attackerAtOrigin = origin ? { ...attacker, q: origin.q, r: origin.r } : attacker;
  const range = unitAttackRange(state, attackerAtOrigin);
  return Object.values(state.facilities ?? {})
    .filter((facility) => facility.forceId !== attacker.forceId && isFacilityInAttackRange(state, attackerAtOrigin, facility))
    .sort((a, b) => (
      gridDistanceWithin(attackerAtOrigin, a, range) - gridDistanceWithin(attackerAtOrigin, b, range) ||
      a.id.localeCompare(b.id)
    ));
}

/** 射程内可攻击的敌方开发设施（都市地格市场/农场/兵舍等，具备战场坐标 q/r 的已建成或建设中地格） */
export interface PlotAttackTarget {
  cityId: string;
  plotIndex: number;
  q: number;
  r: number;
  type: PlotType;
  label: string;
  durability: number;
  forceId: ArmyUnit['forceId'] | null;
}

export function attackablePlots(state: GameState, attackerId: string, origin?: GridCoord): PlotAttackTarget[] {
  const attacker = state.units[attackerId];
  if (!attacker || attacker.kind === 'transport') return [];
  const attackerAtOrigin = origin ? { ...attacker, q: origin.q, r: origin.r } : attacker;
  const range = unitAttackRange(state, attackerAtOrigin);
  const minRange = unitMinAttackRange(state, attackerAtOrigin, 'structure');
  const targets: PlotAttackTarget[] = [];
  for (const city of Object.values(state.cities)) {
    // 有守军的无主城设施可攻击；无守军无主城直接进驻即可
    if (city.ownerId === attacker.forceId || (city.ownerId === null && city.troops === 0)) continue;
    const ownerForceId = city.ownerId;
    city.plots?.forEach((plot, plotIndex) => {
      if (plot.q == null || plot.r == null) return;
      if (plot.type === 'empty' && !plot.constructing) return;
      const distance = gridDistanceWithin(attackerAtOrigin, { q: plot.q, r: plot.r }, range);
      if (!isDistanceInAttackBand(distance, minRange, range)) return;
      // 空地被过滤后，剩下的一定是非 empty（要么建成设施，要么建设中）
      const type = (plot.constructing ? plot.constructing.facility : plot.type) as PlotType;
      targets.push({
        cityId: city.id,
        plotIndex,
        q: plot.q,
        r: plot.r,
        type,
        label: PLOT_LABELS[type],
        durability: plot.durability ?? PLOT_MAX_DURABILITY,
        forceId: ownerForceId,
      });
    });
  }
  return targets.sort((a, b) => (
    gridDistanceWithin(attackerAtOrigin, a, range) - gridDistanceWithin(attackerAtOrigin, b, range) ||
    `${a.cityId}:${a.plotIndex}`.localeCompare(`${b.cityId}:${b.plotIndex}`)
  ));
}

export function jointAttackableUnits(state: GameState, attackerId: string, origin?: GridCoord): ArmyUnit[] {
  const attacker = state.units[attackerId];
  if (!attacker || attacker.kind === 'transport') return [];
  const attackerAtOrigin = origin ? { ...attacker, q: origin.q, r: origin.r } : attacker;
  // 投石车最小射程 2，无法贴身攻击，因此不能发起齐攻（齐攻要求主攻者紧贴目标）
  if (unitMinAttackRange(state, attackerAtOrigin) > 1) return [];
  return Object.values(state.units)
    .filter((target) => (
      target.forceId !== attacker.forceId &&
      areAdjacent(attackerAtOrigin, target) &&
      Object.values(state.units).some((ally) => (
        ally.id !== attacker.id &&
        isActionableFriendlyUnit(ally, attacker.forceId) &&
        areAdjacent(ally, target)
      ))
    ))
    .sort((a, b) => (
      gridDistanceWithin(attackerAtOrigin, a, 1) - gridDistanceWithin(attackerAtOrigin, b, 1) ||
      a.id.localeCompare(b.id)
    ));
}
