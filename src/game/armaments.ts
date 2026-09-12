import { citySpecialtyOf, type CitySpecialty } from './cityTraits';
import { canUseBattleShip, canUseCatapult, canUseWoodenBeast } from './techs';
import type { ArmamentType, ArmyUnit, CityArmaments, City, ForceId, GameState, Officer, Pass, TroopType, VehicleType } from './types';

export const ARMAMENT_TYPES: ArmamentType[] = ['spear', 'halberd', 'crossbow', 'cavalry', 'ram', 'tower', 'ship'];
export const DELAYED_ARMAMENT_TYPES: ArmamentType[] = ['ram', 'tower', 'ship'];
export const DELAYED_ARMAMENT_TEN_DAYS = 3;

export const ARMAMENT_LABELS: Record<ArmamentType, string> = {
  spear: '枪',
  halberd: '戟',
  crossbow: '弩',
  cavalry: '军马',
  ram: '冲车',
  tower: '井阑',
  ship: '楼船',
};

/**
 * 攻城器械的「实际形态」。兵装存储口径只有冲车（ram）/井阑（tower）两种，
 * 科技会把已生产/已在外的器械就地升级，而不改动存档字段：
 * - 机械（jixie）：冲车 → 木兽（攻击时使被攻击地点着火）
 * - 弹道（dandao）：井阑 → 投石车（射程 2~3，命中后按霹雳溅射）
 */
export type SiegeWeaponKind = 'ram' | 'woodenBeast' | 'tower' | 'catapult';

export const SIEGE_WEAPON_KIND_LABELS: Record<SiegeWeaponKind, string> = {
  ram: '冲车',
  woodenBeast: '木兽',
  tower: '井阑',
  catapult: '投石车',
};

/** 斗舰：造船术解锁的楼船升级版 */
export const BATTLE_SHIP_LABEL = '斗舰';

/**
 * 部队当前实际使用的攻城器械（吃势力科技）。
 * `ram` 在拥有「机械」时升为 `woodenBeast`，`tower` 在拥有「弹道」时升为 `catapult`；
 * 非兵器部队（没有 siegeWeapon）返回 undefined。
 * 因为升级是运行时派生的，**已生产的冲车与在外部队的冲车都会自动变成木兽**，无需迁移存档。
 */
export function siegeWeaponKindOf(
  state: GameState,
  unit: Pick<ArmyUnit, 'forceId' | 'siegeWeapon'>,
): SiegeWeaponKind | undefined {
  if (unit.siegeWeapon === 'ram') return canUseWoodenBeast(state, unit.forceId) ? 'woodenBeast' : 'ram';
  if (unit.siegeWeapon === 'tower') return canUseCatapult(state, unit.forceId) ? 'catapult' : 'tower';
  return undefined;
}

/** 斗舰：`vehicle === 'ship'` 且势力已研究「造船术」（楼船的升级版：攻防与移动力更强） */
export function isBattleShip(
  state: GameState,
  unit: Pick<ArmyUnit, 'forceId' | 'vehicle'>,
): boolean {
  return unit.vehicle === 'ship' && canUseBattleShip(state, unit.forceId);
}

/**
 * 是否拥有「投石」攻击方式：投石车（弹道升级后的井阑），或开发「弹道」后的斗舰
 * （斗舰本身需要「造船术」，故斗舰投石需要造船术＋弹道两个节点）。
 */
export function unitHasCatapultAttack(
  state: GameState,
  unit: Pick<ArmyUnit, 'forceId' | 'vehicle' | 'siegeWeapon'>,
): boolean {
  if (siegeWeaponKindOf(state, unit) === 'catapult') return true;
  return isBattleShip(state, unit) && canUseCatapult(state, unit.forceId);
}

/** 兵装显示名（吃科技）：机械把冲车显示为木兽、弹道把井阑显示为投石车、造船术把楼船显示为斗舰；存储仍是原类型 */
export function armamentLabelFor(
  state: GameState,
  forceId: ForceId | null | undefined,
  armamentType: ArmamentType,
): string {
  if (armamentType === 'ram' && canUseWoodenBeast(state, forceId)) return SIEGE_WEAPON_KIND_LABELS.woodenBeast;
  if (armamentType === 'tower' && canUseCatapult(state, forceId)) return SIEGE_WEAPON_KIND_LABELS.catapult;
  if (armamentType === 'ship' && canUseBattleShip(state, forceId)) return BATTLE_SHIP_LABEL;
  return ARMAMENT_LABELS[armamentType];
}

/** 载具显示名（吃科技）：造船术把楼船显示为斗舰；存储仍是 `vehicle === 'ship'` */
export function vehicleLabelFor(
  state: GameState,
  forceId: ForceId | null | undefined,
  vehicle: VehicleType,
): string {
  if (vehicle === 'ship' && canUseBattleShip(state, forceId)) return BATTLE_SHIP_LABEL;
  return VEHICLE_LABELS[vehicle];
}

/** 部队当前器械/舰船的显示名（供界面直接取用）；非兵器且非舰船返回 undefined */
export function unitArmamentLabel(
  state: GameState,
  unit: Pick<ArmyUnit, 'forceId' | 'vehicle' | 'siegeWeapon'>,
): string | undefined {
  const kind = siegeWeaponKindOf(state, unit);
  if (kind) return SIEGE_WEAPON_KIND_LABELS[kind];
  if (unit.vehicle === 'ship') return vehicleLabelFor(state, unit.forceId, 'ship');
  return undefined;
}

export const ARMAMENT_BASE_YIELD: Record<ArmamentType, number> = {
  spear: 1000,
  halberd: 1000,
  crossbow: 1200,
  cavalry: 1600,
  ram: 2000,
  tower: 2400,
  ship: 2400,
};

export const ARMAMENT_GOLD_COST = 1000;

/** 兵装对应的城池特色（大都市覆盖全部兵装） */
const SPECIALTY_ARMAMENT: Partial<Record<CitySpecialty, ArmamentType[]>> = {
  spear: ['spear'],
  halberd: ['halberd'],
  cavalry: ['cavalry'],
  arrow: ['crossbow'],
  ship: ['ship'],
  siege: ['ram', 'tower'],
};

/** 兵装生产价格：大都市全部60%，对应特色城市该兵装60%，其余原价（关隘无特色，按原价） */
export function armamentCost(city: Pick<City | Pass, 'id'>, armamentType: ArmamentType): number {
  const specialty = citySpecialtyOf(city.id);
  if (!specialty) return ARMAMENT_GOLD_COST;
  if (specialty === 'metropolis') return Math.round(ARMAMENT_GOLD_COST * 0.6);
  return SPECIALTY_ARMAMENT[specialty]?.includes(armamentType)
    ? Math.round(ARMAMENT_GOLD_COST * 0.6)
    : ARMAMENT_GOLD_COST;
}

export const TROOP_ARMAMENT: Partial<Record<TroopType, ArmamentType>> = {
  spear: 'spear',
  halberd: 'halberd',
  crossbow: 'crossbow',
  cavalry: 'cavalry',
};

export const TROOP_LABELS: Record<TroopType, string> = {
  sword: '剑兵',
  spear: '枪兵',
  halberd: '戟兵',
  crossbow: '弩兵',
  cavalry: '骑兵',
  siege: '兵器',
};

export const TROOP_MOVEMENT: Record<TroopType, number> = {
  sword: 22,
  spear: 22,
  halberd: 20,
  crossbow: 19,
  cavalry: 30,
  siege: 16,
};

export const VEHICLE_LABELS: Record<VehicleType, string> = {
  boat: '小舟',
  ship: '楼船',
};

export const TRANSPORT_MOVEMENT = 20;

export function emptyArmaments(): CityArmaments {
  return {
    spear: 0,
    halberd: 0,
    crossbow: 0,
    cavalry: 0,
    ram: 0,
    tower: 0,
    ship: 0,
  };
}

/**
 * 城池兵装容纳上限：枪/戟/弩各 10 万，军马 5 万，冲车/井阑/楼船各 20。
 * 楼船/冲车/井阑按「艘/辆」计数（出征消耗 1），故上限是 20 而非 20 万。
 */
export const CITY_ARMAMENT_CAPS: CityArmaments = {
  spear: 100_000,
  halberd: 100_000,
  crossbow: 100_000,
  cavalry: 50_000,
  ram: 20,
  tower: 20,
  ship: 20,
};

/** 关隘兵装容纳上限：枪/戟/弩各 3 万，军马 1 万，冲车/井阑/楼船各 5 */
export const PASS_ARMAMENT_CAPS: CityArmaments = {
  spear: 30_000,
  halberd: 30_000,
  crossbow: 30_000,
  cavalry: 10_000,
  ram: 5,
  tower: 5,
  ship: 5,
};

/** 按上限截断兵装（**就地修改** value，调用方需保证对象已克隆） */
export function clampArmamentsTo(value: CityArmaments, caps: CityArmaments): CityArmaments {
  for (const type of ARMAMENT_TYPES) {
    const current = value[type] ?? 0;
    const capped = Math.min(caps[type] ?? 0, current);
    value[type] = capped < 0 ? 0 : capped;
  }
  return value;
}

/** 兵装是否已超出给定上限（用于判断能否跳过克隆） */
export function armamentsExceedCap(value: Partial<CityArmaments> | undefined, caps: CityArmaments): boolean {
  if (!value) return false;
  return ARMAMENT_TYPES.some((type) => (value[type] ?? 0) > (caps[type] ?? 0));
}

export function initialArmaments(): CityArmaments {
  return {
    spear: 4000,
    halberd: 2500,
    crossbow: 2000,
    cavalry: 3000,
    ram: 0,
    tower: 0,
    ship: 0,
  };
}

export function armamentsOf(value: Partial<CityArmaments> | undefined): CityArmaments {
  return { ...emptyArmaments(), ...value };
}

/**
 * 按兵力 1:1 计的兵装（枪/戟/弩/军马）——出征时随兵力从据点带走，
 * 回城/进关并账时也只按「实际并入据点的兵力」返还（伤亡带走装备）。
 * 冲车/井阑/楼船按「辆/艘」计，出征消耗 1、并账返还 1，不随兵力缩放。
 */
export const TROOP_SCALED_ARMAMENT_TYPES: ArmamentType[] = ['spear', 'halberd', 'crossbow', 'cavalry'];

/**
 * 一支部队出征时从据点带走的兵装（**唯一口径**：出征扣减与并账返还共用本函数）。
 * 枪戟弩马按兵力 1:1，楼船 1 艘、冲车/井阑 1 辆；剑兵/输送队没有对应兵装 → 空对象。
 */
export function armamentsCarriedByDeploy(
  troopType: TroopType,
  troops: number,
  vehicle?: VehicleType,
  siegeWeapon?: 'ram' | 'tower' | undefined,
): Partial<CityArmaments> {
  const carried: Partial<CityArmaments> = {};
  const armamentType = TROOP_ARMAMENT[troopType];
  if (armamentType && troops > 0) carried[armamentType] = Math.max(0, Math.floor(troops));
  if (vehicle === 'ship') carried.ship = (carried.ship ?? 0) + 1;
  if (troopType === 'siege' && siegeWeapon) carried[siegeWeapon] = (carried[siegeWeapon] ?? 0) + 1;
  return carried;
}

/**
 * 从据点的兵装里扣除 carried 指定的数量，返回新对象（不修改入参）。
 * 与 `armamentsCarriedByDeploy` 配对使用，替代逐项 `{ ...snapshot, x: n }` 的写法 ——
 * 后者在「兵种兵装 + 楼船/兵器」同时成立时会互相覆盖，导致有一项没被真正扣除。
 */
export function takeArmaments(source: Partial<CityArmaments> | undefined, carried: Partial<CityArmaments>): CityArmaments {
  const base = armamentsOf(source);
  const next = { ...base };
  for (const type of ARMAMENT_TYPES) {
    const amount = carried[type] ?? 0;
    if (amount > 0) next[type] = base[type] - amount;
  }
  return next;
}

export function isDelayedArmament(armamentType: ArmamentType) {
  return DELAYED_ARMAMENT_TYPES.includes(armamentType);
}

/** 生产数量 = 1000 + 最高智力×10 + 其余2人智力各×5（能吏/繁殖等特技与设施等级修正另计） */
export function produceArmamentYield(officers: Officer[], armamentType: ArmamentType) {
  if (isDelayedArmament(armamentType)) return 2;
  const sorted = officers.map((officer) => officer.stats.intelligence).sort((a, b) => b - a);
  const top = sorted[0] ?? 0;
  const rest = sorted.slice(1).reduce((sum, value) => sum + value, 0);
  return ARMAMENT_BASE_YIELD[armamentType] + top * 10 + rest * 5;
}

/** 兵器/舰船综合智力 = 最高智力 + 其余2人智力和 ÷ 2 */
export function armamentProductionIntelligence(officers: Officer[]): number {
  const sorted = officers.map((officer) => officer.stats.intelligence).sort((a, b) => b - a);
  const top = sorted[0] ?? 0;
  const rest = sorted.slice(1).reduce((sum, value) => sum + value, 0);
  return Math.round(top + rest / 2);
}

/** 兵器/舰船生产日数 = ⌈(220 − 综合智力) ÷ 12⌉ × 10（最低10日；发明/造船等速度特技日数减半） */
export function armamentProductionDays(officers: Officer[], speedMultiplier = 1): number {
  const combined = armamentProductionIntelligence(officers);
  const raw = Math.max(1, Math.ceil((220 - combined) / 12)) * 10;
  return Math.max(10, Math.round(raw / speedMultiplier));
}

/** 兵器/舰船生产工期（旬）：日数向上取整换算为旬（至少1旬） */
export function armamentProductionTenDays(officers: Officer[], speedMultiplier = 1): number {
  return Math.max(1, Math.ceil(armamentProductionDays(officers, speedMultiplier) / 10));
}
