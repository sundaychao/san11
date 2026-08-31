export type ForceId = 'cao' | 'liu' | 'sun' | 'biao';

/** 科技方向：枪兵/戟兵/弩兵/骑兵/军制/内政 */
export type TechBranchId = 'spear' | 'halberd' | 'crossbow' | 'cavalry' | 'military' | 'civil';

export type CityId =
  | 'wan'
  | 'xiangyang'
  | 'jiangling'
  | 'wuling'
  | 'jiangxia'
  | 'changsha'
  | 'lingling'
  | 'guiyang';

export interface Stats {
  leadership: number;
  war: number;
  intelligence: number;
  politics: number;
  charisma: number;
}

export type AptitudeGrade = 'S' | 'A' | 'B' | 'C';

export interface OfficerAptitudes {
  spear: AptitudeGrade;
  halberd: AptitudeGrade;
  crossbow: AptitudeGrade;
  cavalry: AptitudeGrade;
  siege: AptitudeGrade;
  navy: AptitudeGrade;
}

export interface Officer {
  id: string;
  name: string;
  forceId: ForceId | null;
  cityId: CityId;
  location: OfficerLocation;
  stats: Stats;
  skill?: string;
  /** 通过能力研究「特技」培育额外习得的特技名列表（与主特技 skill 并存） */
  learnedSkills?: string[];
  aptitudes?: OfficerAptitudes;
  acted: boolean;
}

export type OfficerLocation =
  | { kind: 'city'; cityId: CityId }
  | { kind: 'unit'; unitId: string }
  | { kind: 'unaffiliated'; cityId: CityId }
  | { kind: 'transfer'; fromCityId: CityId; targetCityId: CityId; remainingTenDays: number }
  | { kind: 'task'; cityId: CityId; task: 'armament'; armamentType: ArmamentType; amount: number; remainingTenDays: number }
  | { kind: 'task'; cityId: CityId; task: 'research'; branch: TechBranchId; remainingTenDays: number }
  | { kind: 'task'; cityId: CityId; task: 'cultivate'; nodeId: string; remainingTenDays: number };

export interface City {
  id: CityId;
  name: string;
  ownerId: ForceId;
  governorId: string | null;
  gold: number;
  food: number;
  population: number;
  troops: number;
  commerce: number;
  agriculture: number;
  order: number;
  training: number;
  mapX: number;
  mapY: number;
  gridQ: number;
  gridR: number;
  durability: number;
  maxDurability: number;
  armaments?: CityArmaments;
  grainPrice?: number;
  /** 商人本旬是否到访（每旬独立 1/4 概率） */
  merchantPresent?: boolean;
  /** 本旬是否已与商人完成一次粮食交易 */
  merchantTradedThisTenDay?: boolean;
}

export interface Force {
  id: ForceId;
  name: string;
  leaderId: string;
  color: string;
  description: string;
  /** 技巧P（研究科技用） */
  techP?: number;
  /** 各科技方向已研究等级 0-4 */
  techs?: Partial<Record<TechBranchId, number>>;
  /** 能力研究（PK版研究能力树）状态 */
  abilityResearch?: AbilityResearchState;
}

/** 能力研究状态：已研究完成的节点、各节点剩余培育次数、正在研究的节点 */
export interface AbilityResearchState {
  researched: string[];
  remaining: Record<string, number>;
  active?: { nodeId: string; remainingMonths: number };
}

export interface GameLog {
  id: string;
  month: number;
  forceId: ForceId | null;
  message: string;
}

export interface BattleDamageReport {
  id: string;
  unitId: string;
  q: number;
  r: number;
  amount: number;
  kind: 'attack' | 'counter' | 'jointAttack';
  critical?: boolean;
  label?: string;
}

export interface CityEffectReport {
  id: string;
  cityId: CityId;
  q: number;
  r: number;
  amount: number;
  label: string;
  kind: 'recruit' | 'armament';
}

export interface FacilityRepairReport {
  id: string;
  facilityId: string;
  q: number;
  r: number;
  amount: number;
  kind: 'build' | 'repair';
}

export interface StrategyResultReport {
  id: string;
  strategyId: 'fire' | 'extinguish' | 'false-report' | 'disturb' | 'calm' | 'inspire' | 'discord';
  q: number;
  r: number;
  label: string;
  succeeded: boolean;
}

export interface FirePlot {
  q: number;
  r: number;
  remainingTenDays?: number;
}

export type FacilityType = 'drum' | 'arrowTower' | 'musicTower' | 'fortress' | 'earthwork' | 'fireSeed' | 'fireBall';

export interface Facility {
  id: string;
  type: FacilityType;
  forceId: ForceId;
  q: number;
  r: number;
  durability: number;
  completed?: boolean;
}

export interface GameState {
  schemaVersion: 2;
  scenarioId: 'jingxiang-208' | 'mobile-duel';
  gridWidth?: number;
  gridHeight?: number;
  seed: number;
  rngCursor: number;
  month: number;
  tenDay: TenDay;
  turnForceId: ForceId;
  playerForceId: ForceId;
  phase: 'playing' | 'finished';
  actionPoints: Record<ForceId, number>;
  forces: Record<ForceId, Force>;
  cities: Record<CityId, City>;
  officers: Record<string, Officer>;
  grid: GridCell[];
  units: Record<string, ArmyUnit>;
  battleDamageReports?: BattleDamageReport[];
  cityEffectReports?: CityEffectReport[];
  facilityRepairReports?: FacilityRepairReport[];
  strategyResultReports?: StrategyResultReport[];
  firePlots?: FirePlot[];
  facilities?: Record<string, Facility>;
  logs: GameLog[];
}

export type TenDay = 1 | 2 | 3;

export type TerrainType = 'road' | 'plain' | 'forest' | 'hill' | 'mountain' | 'water' | 'ferry';
export type TroopType = 'sword' | 'spear' | 'halberd' | 'crossbow' | 'cavalry' | 'siege';
export type VehicleType = 'boat' | 'ship';
export type ArmamentType = 'spear' | 'halberd' | 'crossbow' | 'cavalry' | 'ram' | 'tower' | 'ship';
export type CityArmaments = Record<ArmamentType, number>;

export interface GridCell {
  q: number;
  r: number;
  terrain: TerrainType;
}

export interface ArmyUnit {
  id: string;
  kind?: 'combat' | 'transport';
  forceId: ForceId;
  leaderId: string;
  officerIds?: string[];
  homeCityId: CityId;
  troopType?: TroopType;
  vehicle?: VehicleType;
  siegeWeapon?: 'ram' | 'tower';
  gold?: number;
  q: number;
  r: number;
  troops: number;
  food: number;
  energy: number;
  movementRemaining: number;
  confusedTenDays?: number;
  burningTenDays?: number;
  falseReportedTenDays?: number;
  moved: boolean;
  acted: boolean;
}

export type GameCommand =
  | { type: 'develop'; cityId: CityId; officerId: string; focus: 'commerce' | 'agriculture' }
  | { type: 'recruit'; cityId: CityId; officerId: string }
  | { type: 'produceArmament'; cityId: CityId; officerId: string; armamentType: ArmamentType }
  | { type: 'train'; cityId: CityId; officerId: string }
  | { type: 'patrol'; cityId: CityId; officerId: string }
  | { type: 'talent'; cityId: CityId; officerId: string }
  | { type: 'research'; cityId: CityId; officerId: string; branch: TechBranchId }
  | { type: 'abilityResearch'; cityId: CityId; nodeId: string }
  | { type: 'cultivate'; cityId: CityId; officerId: string; nodeId: string }
  | {
      type: 'transfer';
      cityId: CityId;
      targetCityId: CityId;
      officerIds: string[];
    }
  | { type: 'trade'; cityId: CityId; officerId: string; mode: 'buy' | 'sell'; amount: number };

export interface ForceRanking {
  forceId: ForceId;
  name: string;
  score: number;
  rank: number;
  tied: boolean;
}
