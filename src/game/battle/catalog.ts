import { TRANSPORT_MOVEMENT, TROOP_MOVEMENT } from '../armaments';
import type { AptitudeGrade, ArmyUnit, FacilityType, GridCell, TerrainType, TroopType } from '../types';
import type { GridCoord } from './grid';

export const DEPLOY_AP_COST = 20;
export const BASE_MOVEMENT = TROOP_MOVEMENT.sword;

export const DEFENSE_MIN_TROOPS = 1000;
export const DEFENSE_MAX_TROOPS = 3000;
export const DRUM_DAMAGE_MULTIPLIER = 1.15;
export const FORTRESS_DAMAGE_MULTIPLIER = 0.7;
export const FORTRESS_SUPPLY_MULTIPLIER = 0.7;
export const FORTRESS_RANGE = 3;
export const ARROW_TOWER_DAMAGE = 300;
export const FIRE_PLOT_DAMAGE = 500;
export const FIRE_FACILITY_DAMAGE = 150;
export const FIRE_SEED_DAMAGE = 700;
export const FIRE_BALL_DAMAGE = 700;
export const FACILITY_BUILD_DURABILITY_PER_TEN_THOUSAND = 500;

export type MovementProfile = TroopType | 'transport';

const INFANTRY_TERRAIN_COST: Record<TerrainType, number> = {
  road: 4,
  plain: 4,
  forest: 6,
  hill: 6,
  mountain: Number.POSITIVE_INFINITY,
  water: 6,
  shore: 4,
  ferry: 4,
};

const CAVALRY_TERRAIN_COST: Record<TerrainType, number> = {
  ...INFANTRY_TERRAIN_COST,
  forest: 8,
  water: 8,
};

const SIEGE_TERRAIN_COST: Record<TerrainType, number> = {
  ...INFANTRY_TERRAIN_COST,
  forest: 8,
  hill: 8,
  water: 8,
};

export const TERRAIN_COST_BY_PROFILE: Record<MovementProfile, Record<TerrainType, number>> = {
  sword: INFANTRY_TERRAIN_COST,
  spear: INFANTRY_TERRAIN_COST,
  halberd: INFANTRY_TERRAIN_COST,
  crossbow: INFANTRY_TERRAIN_COST,
  transport: INFANTRY_TERRAIN_COST,
  cavalry: CAVALRY_TERRAIN_COST,
  siege: SIEGE_TERRAIN_COST,
};

export const SHIP_WATER_COST = 4;
export const SHIP_WATER_ATTACK_MULTIPLIER = 1.1;
export const SHIP_WATER_DEFENSE_MULTIPLIER = 0.9;

export const TERRAIN_DEFENSE: Record<TerrainType, number> = {
  road: 1,
  plain: 1,
  forest: 0.85,
  hill: 0.8,
  mountain: 1,
  water: 0.95,
  shore: 1,
  ferry: 1,
};

export interface UnitTactic {
  id: TacticId;
  name: string;
  troopType: TroopType | 'naval';
  cost: number;
  range: number;
  power: number;
}

export type TacticId =
  | 'spear-thrust'
  | 'spear-spiral'
  | 'spear-double'
  | 'halberd-hook'
  | 'halberd-sweep'
  | 'halberd-whirlwind'
  | 'crossbow-fire'
  | 'crossbow-pierce'
  | 'crossbow-volley'
  | 'cavalry-charge'
  | 'cavalry-breakthrough'
  | 'cavalry-rush'
  | 'ship-ram'
  | 'ship-fire'
  | 'ship-whirl';

export const TACTICS: Record<TacticId, UnitTactic> = {
  'spear-thrust': { id: 'spear-thrust', name: '突刺', troopType: 'spear', cost: 15, range: 1, power: 1.18 },
  'spear-spiral': { id: 'spear-spiral', name: '螺旋突刺', troopType: 'spear', cost: 20, range: 1, power: 1.23 },
  'spear-double': { id: 'spear-double', name: '二段突刺', troopType: 'spear', cost: 25, range: 1, power: 1.27 },
  'halberd-hook': { id: 'halberd-hook', name: '熊手', troopType: 'halberd', cost: 15, range: 1, power: 1.18 },
  'halberd-sweep': { id: 'halberd-sweep', name: '横扫', troopType: 'halberd', cost: 20, range: 1, power: 1.23 },
  'halberd-whirlwind': { id: 'halberd-whirlwind', name: '旋风', troopType: 'halberd', cost: 30, range: 1, power: 1.27 },
  'crossbow-fire': { id: 'crossbow-fire', name: '火矢', troopType: 'crossbow', cost: 10, range: 2, power: 1.12 },
  'crossbow-pierce': { id: 'crossbow-pierce', name: '贯箭', troopType: 'crossbow', cost: 15, range: 2, power: 1.18 },
  'crossbow-volley': { id: 'crossbow-volley', name: '乱射', troopType: 'crossbow', cost: 25, range: 2, power: 1.22 },
  'cavalry-charge': { id: 'cavalry-charge', name: '突击', troopType: 'cavalry', cost: 15, range: 1, power: 1.4 },
  'cavalry-breakthrough': { id: 'cavalry-breakthrough', name: '突破', troopType: 'cavalry', cost: 20, range: 1, power: 1.45 },
  'cavalry-rush': { id: 'cavalry-rush', name: '突进', troopType: 'cavalry', cost: 25, range: 1, power: 1.5 },
  'ship-ram': { id: 'ship-ram', name: '冲角', troopType: 'naval', cost: 15, range: 1, power: 1.22 },
  'ship-fire': { id: 'ship-fire', name: '火箭', troopType: 'naval', cost: 20, range: 2, power: 1.18 },
  'ship-whirl': { id: 'ship-whirl', name: '回旋', troopType: 'naval', cost: 30, range: 1, power: 1.3 },
};

export const TACTICS_BY_TROOP: Partial<Record<TroopType, TacticId[]>> = {
  spear: ['spear-thrust', 'spear-spiral', 'spear-double'],
  halberd: ['halberd-hook', 'halberd-sweep', 'halberd-whirlwind'],
  crossbow: ['crossbow-fire', 'crossbow-pierce', 'crossbow-volley'],
  cavalry: ['cavalry-charge', 'cavalry-breakthrough', 'cavalry-rush'],
};

export const NAVAL_TACTIC_IDS: TacticId[] = ['ship-ram', 'ship-fire', 'ship-whirl'];

export const TACTIC_REQUIRED_APTITUDE: Record<1 | 2 | 3, AptitudeGrade> = {
  1: 'B',
  2: 'A',
  3: 'S',
};

export const TACTIC_APTITUDE_DAMAGE: Record<AptitudeGrade, number> = {
  C: 1,
  B: 1,
  A: 1.1,
  S: 1.2,
};

export const TROOP_LABEL: Partial<Record<TroopType, string>> = {
  spear: '枪兵',
  halberd: '戟兵',
  crossbow: '弩兵',
  cavalry: '骑兵',
};

export interface UnitStrategy {
  id: StrategyId;
  name: string;
  cost: number;
  target: 'cell' | 'unit';
}

export type StrategyId = 'fire' | 'extinguish' | 'false-report' | 'disturb' | 'calm' | 'inspire' | 'discord';

export type StrategySelection =
  | { coord: GridCoord; targetUnitId?: never }
  | { targetUnitId: string; coord?: never };

export const STRATEGIES: Record<StrategyId, UnitStrategy> = {
  fire: { id: 'fire', name: '火计', cost: 10, target: 'cell' },
  extinguish: { id: 'extinguish', name: '灭火', cost: 10, target: 'cell' },
  'false-report': { id: 'false-report', name: '伪报', cost: 15, target: 'unit' },
  disturb: { id: 'disturb', name: '扰乱', cost: 15, target: 'unit' },
  calm: { id: 'calm', name: '镇定', cost: 10, target: 'unit' },
  inspire: { id: 'inspire', name: '鼓舞', cost: 10, target: 'unit' },
  discord: { id: 'discord', name: '内讧', cost: 20, target: 'unit' },
};

export interface UnitFacility {
  type: FacilityType;
  name: string;
  durability: number;
}

export const FACILITY_BUILD_COSTS: Record<FacilityType, number> = {
  fortress: 900,
  arrowTower: 600,
  earthwork: 400,
  drum: 800,
  musicTower: 800,
  fireSeed: 400,
  fireBall: 400,
};

export const FACILITIES: Partial<Record<FacilityType, UnitFacility>> = {
  drum: { type: 'drum', name: '太鼓台', durability: 800 },
  arrowTower: { type: 'arrowTower', name: '箭楼', durability: 700 },
  musicTower: { type: 'musicTower', name: '军乐台', durability: 800 },
  earthwork: { type: 'earthwork', name: '土垒', durability: 400 },
  fireSeed: { type: 'fireSeed', name: '火种', durability: 200 },
  fireBall: { type: 'fireBall', name: '火球', durability: 200 },
  fortress: { type: 'fortress', name: '城塞', durability: 1200 },
};

export const SPACING_LIMITED_FACILITY_TYPES = new Set<FacilityType>(['arrowTower', 'drum', 'musicTower', 'fortress']);
export const ZOC_FACILITY_TYPES = new Set<FacilityType>(['arrowTower', 'drum', 'musicTower', 'fortress']);
export const PUBLIC_REPAIRABLE_FACILITY_TYPES = new Set<FacilityType>(['earthwork', 'fireSeed', 'fireBall']);

export function movementProfileForUnit(unit: Pick<ArmyUnit, 'kind' | 'troopType'>): MovementProfile {
  return unit.kind === 'transport' ? 'transport' : unit.troopType ?? 'sword';
}

export function movementAllowanceForProfile(profile: MovementProfile) {
  return profile === 'transport' ? TRANSPORT_MOVEMENT : TROOP_MOVEMENT[profile];
}

export function movementAllowanceForUnit(unit: Pick<ArmyUnit, 'kind' | 'troopType'>) {
  return movementAllowanceForProfile(movementProfileForUnit(unit));
}

export function movementCostForCell(cell: GridCell | undefined, profile: MovementProfile = 'sword', vehicle?: 'boat' | 'ship') {
  if (!cell) return Number.POSITIVE_INFINITY;
  if (vehicle === 'ship' && cell.terrain === 'water') {
    return SHIP_WATER_COST;
  }
  return TERRAIN_COST_BY_PROFILE[profile][cell.terrain];
}
