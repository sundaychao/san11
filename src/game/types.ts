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

export interface Officer {
  id: string;
  name: string;
  forceId: ForceId | null;
  cityId: CityId;
  stats: Stats;
  acted: boolean;
}

export interface City {
  id: CityId;
  name: string;
  ownerId: ForceId;
  governorId: string;
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

export interface GameState {
  schemaVersion: 1;
  scenarioId: 'jingxiang-208';
  seed: number;
  rngCursor: number;
  month: number;
  playerForceId: ForceId;
  phase: 'playing' | 'finished';
  actionPoints: Record<ForceId, number>;
  forces: Record<ForceId, Force>;
  cities: Record<CityId, City>;
  officers: Record<string, Officer>;
  logs: GameLog[];
}

export type GameCommand =
  | { type: 'develop'; cityId: CityId; officerId: string; focus: 'commerce' | 'agriculture' }
  | { type: 'recruit'; cityId: CityId; officerId: string }
  | { type: 'train'; cityId: CityId; officerId: string }
  | { type: 'patrol'; cityId: CityId; officerId: string }
  | { type: 'talent'; cityId: CityId; officerId: string }
  | {
      type: 'transfer';
      cityId: CityId;
      officerId: string;
      targetCityId: CityId;
      gold: number;
      food: number;
      troops: number;
      officerIds: string[];
    };

export interface ForceRanking {
  forceId: ForceId;
  name: string;
  score: number;
  rank: number;
  tied: boolean;
}
