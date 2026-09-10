import { citySpecialtyOf, type CitySpecialty } from './cityTraits';
import type { ArmamentType, CityArmaments, City, Officer, Pass, TroopType, VehicleType } from './types';

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
