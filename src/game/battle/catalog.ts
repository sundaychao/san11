import { isBattleShip, TRANSPORT_MOVEMENT, TROOP_MOVEMENT } from '../armaments';
import type { AptitudeGrade, ArmyUnit, FacilityType, GameState, GridCell, TerrainType, TroopType } from '../types';
import type { GridCoord } from './grid';

export const DEPLOY_AP_COST = 20;
export const BASE_MOVEMENT = TROOP_MOVEMENT.sword;

export const DEFENSE_MIN_TROOPS = 1000;
export const DEFENSE_MAX_TROOPS = 3000;
/**
 * 普攻/战法的固定伤害基数与伤害地板（满编兵力下生效）。
 * 两者配套校准：240 × 最惨乘区(≈0.503) ≈ 120。
 */
export const BASE_ATTACK_DAMAGE = 240;
export const MIN_ATTACK_DAMAGE = 120;
/**
 * 满编兵力。部队兵力低于此值时，固定基数与伤害地板按 兵力/满编 等比衰减，
 * 避免被打残的部队凭空打出远超自身兵力的伤害（出征下限为 1000 兵）。
 */
export const FULL_DAMAGE_TROOPS = 1000;
/**
 * 释放计略所需的最低兵力。兵力低于此值的部队不能使用计略（计略需要成建制调度），
 * 但普攻、战法、攻城等攻击行为不受影响。
 */
export const STRATEGY_MIN_TROOPS = 500;
export const DRUM_DAMAGE_MULTIPLIER = 1.15;
/**
 * 据点型设施的防护梯度（阵 → 砦 → 城塞）：射程内本方部队受到的伤害与补给消耗逐级降低。
 * 城塞的 0.7/0.7/3 为既有数值，保持不变。
 */
export const FORTRESS_DAMAGE_MULTIPLIER = 0.7;
export const FORTRESS_SUPPLY_MULTIPLIER = 0.7;
export const FORTRESS_RANGE = 3;
export const FORT_DAMAGE_MULTIPLIER = 0.8;
export const FORT_SUPPLY_MULTIPLIER = 0.8;
export const FORT_RANGE = 2;
export const FORMATION_DAMAGE_MULTIPLIER = 0.9;
export const FORMATION_SUPPLY_MULTIPLIER = 0.9;
export const FORMATION_RANGE = 1;
export const ARROW_TOWER_DAMAGE = 300;
/** 连弩楼：箭楼的升级版（建筑学），射程同为 1~2 格 */
export const CROSSBOW_TOWER_DAMAGE = 500;
/** 投石台：弹道解锁，只打距其 2~3 格的敌军（不含相邻 1 格） */
export const CATAPULT_TOWER_DAMAGE = 700;
export const CATAPULT_TOWER_MIN_RANGE = 2;
export const CATAPULT_TOWER_MAX_RANGE = 3;
/** 霹雳：投石命中后对中心 6 格内部队的溅射伤害倍率 */
export const CATAPULT_SPLASH_MULTIPLIER = 0.5;
export const FIRE_PLOT_DAMAGE = 500;
export const FIRE_FACILITY_DAMAGE = 150;
export const FIRE_SEED_DAMAGE = 700;
export const FIRE_BALL_DAMAGE = 700;
/** 业火种/业火球（化学）：伤害更高、留下的业火持续更久 */
export const HELLFIRE_SEED_DAMAGE = 1200;
export const HELLFIRE_BALL_DAMAGE = 1200;
/** 着火格持续旬数：普通陷阱 1~3 旬，业火 2~4 旬 */
export const FIRE_PLOT_MIN_TEN_DAYS = 1;
export const FIRE_PLOT_MAX_TEN_DAYS = 3;
export const HELLFIRE_PLOT_MIN_TEN_DAYS = 2;
export const HELLFIRE_PLOT_MAX_TEN_DAYS = 4;
export const FACILITY_BUILD_DURABILITY_PER_TEN_THOUSAND = 500;

export type MovementProfile = TroopType | 'transport';

/**
 * 水面地形集合（川/河/海/旧 water）：部队可经边界格入内（川不可通行）。
 * 浅滩/渡所是可通行的水陆交界地面，不算水面（与原版一致）。
 */
export const WATER_TERRAINS: ReadonlySet<TerrainType> = new Set<TerrainType>(['water', 'stream', 'river', 'sea']);

export function isWaterTerrain(terrain: TerrainType | undefined): boolean {
  return terrain !== undefined && WATER_TERRAINS.has(terrain);
}

/** 不可通行地形（川/崖/山；原版 baseCost=999）。
 * 岸边(shore)不在其中：本作按「岸边停靠」规则放开——岸是水陆交接的陆地格，
 * 移动消耗与水域一致，陆地↔岸边为普通移动、岸边↔水域为跨水边界（需旬初出发），
 * 部队在岸边停下后须下一旬才能下水/上岸，任何岸线都可作为渡点。 */
export const BLOCKED_TERRAINS: ReadonlySet<TerrainType> = new Set<TerrainType>(['stream', 'mountain']);

/**
 * 地形移动消耗（对齐原版基准：主径/土/草地 4、砂地/荒地/浅滩/小径 5、
 * 森林/湿地/栈道 6、毒泉 8；骑兵/攻城在森林、湿地、水面加倍）。
 */
const INFANTRY_TERRAIN_COST: Record<TerrainType, number> = {
  road: 4,
  path: 5,
  plank: 6,
  plain: 4,
  grass: 4,
  sand: 5,
  wasteland: 5,
  wetland: 6,
  poison: 8,
  forest: 6,
  hill: 6,
  mountain: Number.POSITIVE_INFINITY,
  shore: 6,
  water: 6,
  stream: Number.POSITIVE_INFINITY,
  river: 6,
  sea: 6,
  shallow: 5,
  ferry: 4,
  pass: 4,
  construction: 4,
};

const CAVALRY_TERRAIN_COST: Record<TerrainType, number> = {
  ...INFANTRY_TERRAIN_COST,
  forest: 8,
  wetland: 8,
  poison: 10,
  shore: 8,
  water: 8,
  river: 8,
  sea: 8,
};

const SIEGE_TERRAIN_COST: Record<TerrainType, number> = {
  ...INFANTRY_TERRAIN_COST,
  forest: 8,
  hill: 8,
  plank: 8,
  wetland: 8,
  poison: 10,
  shore: 8,
  water: 8,
  river: 8,
  sea: 8,
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
/** 楼船（造船术前）：水域攻击 ×1.1、受到伤害 ×0.9 */
export const SHIP_WATER_ATTACK_MULTIPLIER = 1.1;
export const SHIP_WATER_DEFENSE_MULTIPLIER = 0.9;
/** 斗舰（造船术）：楼船的升级版——水域攻击 ×1.2、受到伤害 ×0.85，移动力另加 4 */
export const BATTLESHIP_WATER_ATTACK_MULTIPLIER = 1.2;
export const BATTLESHIP_WATER_DEFENSE_MULTIPLIER = 0.85;
export const BATTLESHIP_MOVEMENT_BONUS = 4;

/** 地形防御系数（受伤倍率；森林/湿地/荒地有掩体减免，与原版方向一致） */
export const TERRAIN_DEFENSE: Record<TerrainType, number> = {
  road: 1,
  path: 1,
  plank: 1,
  plain: 1,
  grass: 1,
  sand: 1,
  wasteland: 0.95,
  wetland: 0.9,
  poison: 1,
  forest: 0.85,
  hill: 0.8,
  mountain: 1,
  shore: 1,
  water: 0.95,
  stream: 1,
  river: 0.95,
  sea: 0.95,
  shallow: 0.95,
  ferry: 1,
  pass: 1,
  construction: 1,
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

/**
 * 野外设施造价（金），由低到高：阵 300 < 土垒/火焰种/火焰球 400 < 石墙 500 < 箭楼/业火种/业火球 600 <
 * 砦 700 < 连弩楼 800 < 太鼓台/军乐台 800 < 城塞/投石台 900。既有设施数值保持不变。
 */
export const FACILITY_BUILD_COSTS: Record<FacilityType, number> = {
  formation: 300,
  fort: 700,
  fortress: 900,
  earthwork: 400,
  stoneWall: 500,
  arrowTower: 600,
  crossbowTower: 800,
  catapultTower: 900,
  drum: 800,
  musicTower: 800,
  fireSeed: 400,
  fireBall: 400,
  hellfireSeed: 600,
  hellfireBall: 600,
};

/**
 * 野外设施定义（耐久为满耐久）。既有设施数值保持不变：
 * 箭楼 700/600 金、城塞 1200/900、土垒 400/400、火焰种·火焰球 200/400。
 * 新增梯度：据点型 阵 500/300 → 砦 900/700 → 城塞 1200/900；
 * 阻挡型 土垒 400/400 → 石墙 600/500；
 * 攻击型 箭楼 700/600 → 连弩楼 900/800 → 投石台 800/900（耐久略低但伤害与射程更强）；
 * 陷阱型 火焰种·火焰球 200/400 → 业火种·业火球 250/600。
 */
export const FACILITIES: Partial<Record<FacilityType, UnitFacility>> = {
  drum: { type: 'drum', name: '太鼓台', durability: 800 },
  arrowTower: { type: 'arrowTower', name: '箭楼', durability: 700 },
  crossbowTower: { type: 'crossbowTower', name: '连弩楼', durability: 900 },
  catapultTower: { type: 'catapultTower', name: '投石台', durability: 800 },
  musicTower: { type: 'musicTower', name: '军乐台', durability: 800 },
  formation: { type: 'formation', name: '阵', durability: 500 },
  fort: { type: 'fort', name: '砦', durability: 900 },
  earthwork: { type: 'earthwork', name: '土垒', durability: 400 },
  stoneWall: { type: 'stoneWall', name: '石墙', durability: 600 },
  fireSeed: { type: 'fireSeed', name: '火焰种', durability: 200 },
  fireBall: { type: 'fireBall', name: '火焰球', durability: 200 },
  hellfireSeed: { type: 'hellfireSeed', name: '业火种', durability: 250 },
  hellfireBall: { type: 'hellfireBall', name: '业火球', durability: 250 },
  fortress: { type: 'fortress', name: '城塞', durability: 1200 },
};

/** 占用间距的设施（彼此需间隔 2 格以上）：据点型与攻击型设施，与箭楼/城塞同口径 */
export const SPACING_LIMITED_FACILITY_TYPES = new Set<FacilityType>([
  'formation', 'fort', 'fortress', 'arrowTower', 'crossbowTower', 'catapultTower', 'drum', 'musicTower',
]);
/** 提供 ZOC（敌方部队经过其控制区需要停止）的设施：与占用间距的据点型设施一致 */
export const ZOC_FACILITY_TYPES = new Set<FacilityType>([
  'formation', 'fort', 'fortress', 'arrowTower', 'crossbowTower', 'catapultTower', 'drum', 'musicTower',
]);
/** 可被任意势力修补的设施（只阻挡移动的土垒/石墙，以及陷阱） */
export const PUBLIC_REPAIRABLE_FACILITY_TYPES = new Set<FacilityType>([
  'earthwork', 'stoneWall', 'fireSeed', 'fireBall', 'hellfireSeed', 'hellfireBall',
]);

export function movementProfileForUnit(unit: Pick<ArmyUnit, 'kind' | 'troopType'>): MovementProfile {
  return unit.kind === 'transport' ? 'transport' : unit.troopType ?? 'sword';
}

export function movementAllowanceForProfile(profile: MovementProfile) {
  return profile === 'transport' ? TRANSPORT_MOVEMENT : TROOP_MOVEMENT[profile];
}

export function movementAllowanceForUnit(unit: Pick<ArmyUnit, 'kind' | 'troopType'>) {
  return movementAllowanceForProfile(movementProfileForUnit(unit));
}

/**
 * 斗舰移动力加成（造船术，`vehicle === 'ship'`）。
 * 水军科技「罗盘」的 +6 已由 `techs.movementTechBonus` 统一给到，这里只补斗舰相对楼船的 +4，
 * 避免同一份科技加成被重复计入。需要 state 判定科技，故不能并入 `movementAllowanceForUnit`：
 * 出征（deployment）与每旬重置（turn）两处都要显式加上本函数。
 */
export function battleShipMovementBonus(
  state: GameState,
  unit: Pick<ArmyUnit, 'forceId' | 'vehicle'>,
): number {
  return isBattleShip(state, unit) ? BATTLESHIP_MOVEMENT_BONUS : 0;
}

export function movementCostForCell(cell: GridCell | undefined, profile: MovementProfile = 'sword', vehicle?: 'boat' | 'ship') {
  if (!cell) return Number.POSITIVE_INFINITY;
  // 岸边并入水域：岸线是水陆交接的滩涂，移动消耗与水域一致（楼船按固定水域消耗 4），
  // 与地图生成器「岸边并入水域」及旧档「shore→water」归一约定一致。
  // 岸边仍不算水面（isWaterTerrain=false）：陆地↔岸边是普通移动，
  // 岸边↔水域是跨水边界（需旬初出发），从而形成「岸边停靠、上下水分旬」规则。
  const effectiveTerrain: TerrainType = cell.terrain === 'shore' ? 'water' : cell.terrain;
  if (vehicle === 'ship' && isWaterTerrain(effectiveTerrain)) {
    return SHIP_WATER_COST;
  }
  return TERRAIN_COST_BY_PROFILE[profile][effectiveTerrain];
}
