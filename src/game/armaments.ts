import type { ArmamentType, CityArmaments, Officer, TroopType, VehicleType } from './types';

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

export function produceArmamentYield(officer: Officer, armamentType: ArmamentType) {
  if (isDelayedArmament(armamentType)) return 2;
  return ARMAMENT_BASE_YIELD[armamentType] + officer.stats.politics * 8;
}
