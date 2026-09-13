import { ARMAMENT_TYPES, armamentsOf } from './armaments';
import { forceRankOf, rankName } from './ranks';
import type { ArmamentType, ForceId, GameState } from './types';

/**
 * 势力情报（对应原版「势力情报」窗口）：
 * 把散落在城池 / 关隘 / 部队 / 武将上的数据按归属势力汇总，
 * 供外交「选择对象势力」页的各分类标签页展示。
 *
 * 口径约定：
 * - 只有归属该势力的据点 / 部队才计数；`alive` 判定为「仍拥有至少一座城池或关隘」。
 * - 兵装只统计据点库存（随军携带的那份仍在战场上，不计入国力）。
 * - `morale` 为据点（城池 + 关隘）士气的算术平均，无据点时为 0。
 */
export interface ForceIntel {
  forceId: ForceId;
  name: string;
  leaderName: string;
  alive: boolean;
  cityCount: number;
  passCount: number;
  officerCount: number;
  cityTroops: number;
  unitCount: number;
  unitTroops: number;
  troops: number;
  cityGold: number;
  passGold: number;
  gold: number;
  cityFood: number;
  passFood: number;
  food: number;
  morale: number;
  rankLabel: string;
  armaments: Record<ArmamentType, number>;
}

function emptyArmamentTotals(): Record<ArmamentType, number> {
  const totals = {} as Record<ArmamentType, number>;
  for (const type of ARMAMENT_TYPES) totals[type] = 0;
  return totals;
}

export function forceIntelOf(state: GameState, forceId: ForceId): ForceIntel {
  const force = state.forces[forceId];
  const cities = Object.values(state.cities).filter((city) => city.ownerId === forceId);
  const passes = Object.values(state.passes ?? {}).filter((pass) => pass.ownerId === forceId);
  const units = Object.values(state.units).filter((unit) => unit.forceId === forceId);

  const cityTroops = cities.reduce((sum, city) => sum + city.troops, 0);
  const unitTroops = units.reduce((sum, unit) => sum + unit.troops, 0);
  const cityGold = cities.reduce((sum, city) => sum + city.gold, 0);
  const passGold = passes.reduce((sum, pass) => sum + pass.gold, 0);
  const cityFood = cities.reduce((sum, city) => sum + city.food, 0);
  const passFood = passes.reduce((sum, pass) => sum + pass.food, 0);

  const armaments = emptyArmamentTotals();
  for (const stronghold of [...cities, ...passes]) {
    const stock = armamentsOf(stronghold.armaments);
    for (const type of ARMAMENT_TYPES) armaments[type] += stock[type];
  }

  const strongholds = [...cities, ...passes];
  const morale = strongholds.length > 0
    ? Math.round(strongholds.reduce((sum, item) => sum + item.training, 0) / strongholds.length)
    : 0;

  const leader = force?.leaderId ? state.officers[force.leaderId] : undefined;

  return {
    forceId,
    name: force?.name ?? String(forceId),
    leaderName: leader?.name ?? force?.name ?? String(forceId),
    alive: cities.length > 0 || passes.length > 0,
    cityCount: cities.length,
    passCount: passes.length,
    officerCount: Object.values(state.officers).filter((officer) => officer.forceId === forceId && !officer.deathMonth).length,
    cityTroops,
    unitCount: units.length,
    unitTroops,
    troops: cityTroops + unitTroops,
    cityGold,
    passGold,
    gold: cityGold + passGold,
    cityFood,
    passFood,
    food: cityFood + passFood,
    morale,
    rankLabel: rankName(forceRankOf(state, forceId)),
    armaments,
  };
}

/** 一次性汇总多个势力（外交列表 / 势力排名等界面用） */
export function forceIntelList(state: GameState, forceIds?: ForceId[]): ForceIntel[] {
  const ids = forceIds ?? (Object.keys(state.forces) as ForceId[]);
  return ids.map((id) => forceIntelOf(state, id));
}
