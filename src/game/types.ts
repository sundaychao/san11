export type ForceId = 'cao' | 'liu' | 'sun' | 'biao';

/** 爵位：势力级身份，随城市数量自动晋升（皇帝为终极爵位） */
export type RankId =
  | 'none'
  | 'zhou-cishi'
  | 'zhou-mu'
  | 'yulin-zhonglang'
  | 'wuguan-zhonglang'
  | 'da-jiangjun'
  | 'da-sima'
  | 'gong'
  | 'wang'
  | 'huangdi';

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
  /** 装备的宝物 id（宝物归属势力，装备后获得其能力与特技加成） */
  treasureId?: string;
  /** 忠诚度 0~127（100为基准，越高越难被挖角） */
  loyalty?: number;
  /** 功绩（官职授予/晋升的依据，随行动与时间累积） */
  merit?: number;
  /** 担任的官职 id（在 ranks.ts 中定义；无官为空） */
  positionId?: string;
  /** 野望 0~100（越高季首忠诚越易下降） */
  ambition?: number;
  /** 义理 0~100（越高忠诚越稳定，被俘不易变节） */
  righteousness?: number;
  /** 人际关系：对方武将id → 关系（义兄弟/配偶，登用联动） */
  relationships?: Record<string, 'sworn' | 'spouse'>;
  /** 伤病状态（轻伤/中等/重伤），按旬恢复；伤愈前能力按比例衰减 */
  health?: OfficerHealth;
  /** 禁止仕官到期月份（被释放或登用失败后，约6个月/3个月） */
  bannedUntilMonth?: number;
  /** 性别：婚姻/配偶系统（默认男性） */
  gender?: 'male' | 'female';
  /** 武将性格（单挑/舌战愤怒模式）：莽撞/刚胆/冷静/胆小 */
  personality?: 'reckless' | 'bold' | 'calm' | 'timid';
  /** 出生年（公元纪年；用于老龄病逝判定。史书未载者采用通行推定值） */
  birthYear?: number;
  /** 死亡月份（处决或战死；在局中保留记录但不参与任何结算） */
  deathMonth?: number;
  acted: boolean;
}

/** 伤病等级与剩余恢复旬数 */
export interface OfficerHealth {
  level: 'light' | 'moderate' | 'severe';
  remainingTenDays: number;
}

/** 宝物实例状态：归属势力、散落/所在城市、装备武将 */
export interface TreasureState {
  id: string;
  ownerId: ForceId | null;
  cityId: CityId | null;
  holderId: string | null;
}

export type OfficerLocation =
  | { kind: 'city'; cityId: CityId }
  | { kind: 'unit'; unitId: string }
  | { kind: 'unaffiliated'; cityId: CityId }
  | { kind: 'transfer'; fromCityId: CityId; targetCityId: CityId; remainingTenDays: number }
  | { kind: 'task'; cityId: CityId; task: 'armament'; armamentType: ArmamentType; amount: number; remainingTenDays: number }
  | { kind: 'task'; cityId: CityId; task: 'research'; branch: TechBranchId; remainingTenDays: number }
  | { kind: 'task'; cityId: CityId; task: 'cultivate'; nodeId: string; remainingTenDays: number }
  | { kind: 'task'; cityId: CityId; task: 'construction'; facility: string; plotIndex: number; remainingTenDays: number }
  | { kind: 'captive'; cityId: CityId; captorForceId: ForceId; capturedTenDays: number };

export interface City {
  id: CityId;
  name: string;
  ownerId: ForceId;
  governorId: string | null;
  gold: number;
  food: number;
  population: number;
  /** 城市人口（城镇居民；影响市场收入修正。旧存档缺失时按城市规模估算占比15%~20%） */
  cityPopulation?: number;
  /** 农村人口（乡村居民；总人口=城市人口+农村人口） */
  ruralPopulation?: number;
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
  /** 都市地格设施（市场/农场/兵舍/工房等），编号0~5 */
  plots?: CityPlot[];
}

export interface Force {
  id: ForceId;
  name: string;
  leaderId: string;
  color: string;
  description: string;
  /** 相性 1~150（决定外交成功与登用难度；曹操25、刘备75、孙权125、刘表130） */
  xing?: number;
  /** 技巧P（研究科技用） */
  techP?: number;
  /** 各科技方向已研究等级 0-4 */
  techs?: Partial<Record<TechBranchId, number>>;
  /** 能力研究（PK版研究能力树）状态 */
  abilityResearch?: AbilityResearchState;
  /** 当前爵位（随城市数量每月自动晋升） */
  rank?: RankId;
  /** 外交关系：对方势力id → 好感度（-100~100，亲善/流言会影响） */
  diplomacy?: Partial<Record<ForceId, number>>;
  /** 同盟势力（互相不攻击、可请求援军） */
  allies?: ForceId[];
  /** 停战到期旬数与对象：记录 [目标势力, 剩余旬] */
  truces?: Partial<Record<ForceId, number>>;
  /** 军团：军团id → 军团长武将id与委任城市列表 */
  legions?: Record<string, Legion>;
  /** 军师：对外交/流言/登用提供智力加成（君主可任命） */
  strategistId?: string;
}

/** 都市地格设施（参考原版都市内政界面） */
export interface CityPlot {
  id: string;
  type: 'market' | 'farm' | 'barracks' | 'smithy' | 'forge' | 'stable' | 'shipyard' | 'mint' | 'granary' | 'blackmarket' | 'grandmarket' | 'fishmarket' | 'garrisonfarm' | 'hubu' | 'xingbu' | 'bingbu' | 'gongbu' | 'libu' | 'personnel' | 'taixue' | 'tongqueta' | 'empty';
  /** 建筑等级：0=空地，1~3级 */
  level: number;
  /** 设施耐久（建成时为满值，受损后降低；旧存档无此字段时视为满值） */
  durability?: number;
  /** 该格产生的基础数值（市场=金/旬，农场=粮/月，兵舍=征兵上限，工房=兵装上限） */
  value: number;
  /** 本旬是否已收成（用于市场/农场的旬结算） */
  collected?: boolean;
  /** 地格在战斗地图上的格子坐标（建设用地 terrain=construction 所在位置） */
  q?: number;
  r?: number;
  /** 建设中状态：存在时表示该地格正在修建设施 */
  constructing?: {
    facility: 'market' | 'farm' | 'barracks' | 'smithy' | 'forge' | 'stable' | 'shipyard' | 'mint' | 'granary' | 'blackmarket' | 'grandmarket' | 'fishmarket' | 'garrisonfarm' | 'hubu' | 'xingbu' | 'bingbu' | 'gongbu' | 'libu' | 'personnel' | 'taixue' | 'tongqueta';
    officerId: string;
    remainingTenDays: number;
  };
}

/** 军团定义：委任给军团长自动管理的一组城市 */
export interface Legion {
  id: string;
  commanderId: string;
  cityIds: CityId[];
  /** 方针：内政优先/军备优先/均衡 */
  policy: 'civil' | 'military' | 'balanced';
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

/** 单挑结果记录（用于战斗弹窗逐回合展示） */
export interface DuelRoundRecord {
  num: number;
  attackerAction: string;
  defenderAction: string;
  attackerDamage: number;
  defenderDamage: number;
  attackerRage: number;
  defenderRage: number;
  narration: string;
}

export interface DuelReport {
  id: string;
  attackerUnitId: string;
  defenderUnitId: string;
  attackerId: string;
  defenderId: string;
  attackerName: string;
  defenderName: string;
  winner: 'attacker' | 'defender' | null;
  rounds: DuelRoundRecord[];
  attackerHpAtEnd: number;
  defenderHpAtEnd: number;
  attackerCaptured: boolean;
  defenderCaptured: boolean;
  attackerInjured: boolean;
  defenderInjured: boolean;
  attackerDied?: boolean;
  defenderDied?: boolean;
  attackerUnitLoss: number;
  defenderUnitLoss: number;
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
  /** 正在进行的舌战会话（登庸在野武将触发，结束后清空） */
  debateSession?: import('./debate').DebateSession | null;
  /** 最近一次单挑结果（用于单挑弹窗逐回合展示，回合结束后清空） */
  lastDuelReport?: DuelReport | null;
  firePlots?: FirePlot[];
  facilities?: Record<string, Facility>;
  /** 宝物实例状态（未出土时散落在城市，出土后归势力所有） */
  treasures?: Record<string, TreasureState>;
  logs: GameLog[];
}

export type TenDay = 1 | 2 | 3;

export type TerrainType = 'road' | 'plain' | 'forest' | 'hill' | 'mountain' | 'water' | 'ferry' | 'construction';
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
  /** 临时部队到期旬数（如援军，到期自动撤退），格式 month*3+tenDay */
  expiresTenDay?: number;
  moved: boolean;
  acted: boolean;
}

export type GameCommand =
  | { type: 'recruit'; cityId: CityId; officerId: string }
  | { type: 'produceArmament'; cityId: CityId; officerId: string; armamentType: ArmamentType }
  | { type: 'train'; cityId: CityId; officerId: string }
  | { type: 'patrol'; cityId: CityId; officerId: string }
  | { type: 'talent'; cityId: CityId; officerId: string }
  | { type: 'explore'; cityId: CityId; officerIds: string[] }
  | { type: 'grantTreasure'; cityId: CityId; treasureId: string; officerId: string | null }
  | { type: 'research'; cityId: CityId; officerId: string; branch: TechBranchId }
  | { type: 'abilityResearch'; cityId: CityId; nodeId: string }
  | { type: 'cultivate'; cityId: CityId; officerId: string; nodeId: string }
  | { type: 'transfer';
      cityId: CityId;
      targetCityId: CityId;
      officerIds: string[];
    }
  | { type: 'trade'; cityId: CityId; officerId: string; mode: 'buy' | 'sell'; amount: number }
  | { type: 'reward'; cityId: CityId; officerId: string }
  | { type: 'appointPosition'; cityId: CityId; officerId: string; positionId: string | null }
  | { type: 'rumor'; cityId: CityId; officerId: string; targetCityId: CityId }
  | { type: 'poach'; cityId: CityId; officerId: string; targetCityId: CityId; targetOfficerId: string }
  | { type: 'diplomacy';
      cityId: CityId;
      officerId: string;
      targetForceId: ForceId;
      action: 'goodwill' | 'alliance' | 'truce' | 'requestTroops' | 'break';
      months?: number;
      gold?: number;
    }
  | { type: 'captiveDispose'; cityId: CityId; targetOfficerId: string; action: 'release' | 'execute' | 'recruit' }
  | { type: 'marry'; cityId: CityId; officerIdA: string; officerIdB: string; relation?: 'spouse' | 'sworn' }
  | { type: 'legion'; cityId: CityId; commanderId: string | null; targetCityId: CityId | null; policy?: Legion['policy'] }
  | { type: 'buildFacilityPlot'; cityId: CityId; officerId: string; plotIndex: number; facility: 'market' | 'farm' | 'barracks' | 'smithy' | 'forge' | 'stable' | 'shipyard' | 'mint' | 'granary' | 'blackmarket' | 'grandmarket' | 'fishmarket' | 'garrisonfarm' | 'hubu' | 'xingbu' | 'bingbu' | 'gongbu' | 'libu' | 'personnel' | 'taixue' | 'tongqueta' }
  | { type: 'cancelCityPlot'; cityId: CityId; plotIndex: number }
  | { type: 'appointStrategist'; cityId: CityId; officerId: string | null };

export interface ForceRanking {
  forceId: ForceId;
  name: string;
  score: number;
  rank: number;
  tied: boolean;
}
