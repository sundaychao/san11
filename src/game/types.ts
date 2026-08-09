export type ForceId = 'cao' | 'liu' | 'sun' | 'biao';

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
  aptitudes?: OfficerAptitudes;
  acted: boolean;
}

export type OfficerLocation =
  | { kind: 'city'; cityId: CityId }
  | { kind: 'unit'; unitId: string }
  | { kind: 'unaffiliated'; cityId: CityId }
  | { kind: 'transfer'; fromCityId: CityId; targetCityId: CityId; remainingTenDays: number }
  | { kind: 'task'; cityId: CityId; task: 'armament'; armamentType: ArmamentType; amount: number; remainingTenDays: number };

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
}

export interface Force {
  id: ForceId;
  name: string;
  leaderId: string;
  color: string;
  description: string;
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
  kind: 'attack' | 'counter';
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

export interface GameState {
  schemaVersion: 2;
  scenarioId: 'jingxiang-208';
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
  logs: GameLog[];
}

export type TenDay = 1 | 2 | 3;

export type TerrainType = 'road' | 'plain' | 'forest' | 'hill' | 'mountain' | 'shallowWater' | 'deepWater';
export type TroopType = 'sword' | 'spear' | 'halberd' | 'crossbow' | 'cavalry' | 'siege';
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
  gold?: number;
  q: number;
  r: number;
  troops: number;
  food: number;
  energy: number;
  movementRemaining: number;
  confusedTenDays?: number;
  burningTenDays?: number;
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
  | {
      type: 'transfer';
      cityId: CityId;
      targetCityId: CityId;
      officerIds: string[];
    };

export interface ForceRanking {
  forceId: ForceId;
  name: string;
  score: number;
  rank: number;
  tied: boolean;
}
