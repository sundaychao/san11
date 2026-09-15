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

/** 科技系统：步战/射击/军制/骑牧/航行/理工/经济/文教/化工 */
export type TechSystemId =
  | 'infantry'
  | 'archery'
  | 'military'
  | 'cavalry'
  | 'navy'
  | 'engineering'
  | 'economy'
  | 'culture'
  | 'chemistry';

/** 科技节点 id（64 个，具体清单见 game/techs.ts 的 TECH_NODES） */
export type TechNodeId = string;

export type CityId =
  // 剧本开局有主的 8 城（荆襄）
  | 'wan'
  | 'xiangyang'
  | 'jiangling'
  | 'wuling'
  | 'jiangxia'
  | 'changsha'
  | 'lingling'
  | 'guiyang'
  // 华夏全图其余 34 城（开局无主，随剧本推进可争夺）
  | 'xiangping'
  | 'beiping'
  | 'ji'
  | 'nanpi'
  | 'pingyuan'
  | 'jinyang'
  | 'ye'
  | 'beihai'
  | 'xiapi'
  | 'xiaopei'
  | 'shouchun'
  | 'puyang'
  | 'chenliu'
  | 'xuchang'
  | 'runan'
  | 'luoyang'
  | 'changan'
  | 'shangyong'
  | 'anding'
  | 'tianshui'
  | 'wuwei'
  | 'jianye'
  | 'wu'
  | 'kuaiji'
  | 'lujiang'
  | 'chaisang'
  | 'xinye'
  | 'yongan'
  | 'hanzhong'
  | 'zitong'
  | 'jiangzhou'
  | 'chengdu'
  | 'jianning'
  | 'yunnan';

export interface Stats {
  leadership: number;
  war: number;
  intelligence: number;
  politics: number;
  charisma: number;
}

export type AptitudeGrade = 'S++' | 'S+' | 'S' | 'A' | 'B' | 'C';

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
  /** 驻扎的关隘 id（当 location.kind === 'pass' 时有效），与城池武将互不共享 */
  passId?: PassId;
  location: OfficerLocation;
  stats: Stats;
  skill?: string;
  /** 通过能力研究「特技」培育额外习得的特技名列表（与主特技 skill 并存） */
  learnedSkills?: string[];
  aptitudes?: OfficerAptitudes;
  /** 装备的宝物 id（宝物归属势力，装备后获得其能力与特技加成） */
  treasureId?: string;
  /** 相性 1~150（默认沿用势力相性，可对个别武将单独设定） */
  xing?: number;
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
  /** 亲爱武将 id 列表：对己方君主忠诚稳定、登庸容易 */
  likes?: string[];
  /** 厌恶武将 id 列表：相斥必降忠诚、且绝不能被对方登庸 */
  hates?: string[];
  /** 伤病状态（轻伤/中等/重伤），按旬恢复；伤愈前能力按比例衰减 */
  health?: OfficerHealth;
  /** 禁止仕官到期月份（被释放或登用失败后，约6个月/3个月） */
  bannedUntilMonth?: number;
  /** 仕龄（整年数，血色衣冠6.0新忠诚系统）：换主时重置为0、被俘仍累计；在仕武将缺省视为已仕1年 */
  serviceYears?: number;
  /** 性别：婚姻/配偶系统（默认男性） */
  gender?: 'male' | 'female';
  /** 武将性格（单挑/舌战愤怒模式）：莽撞/刚胆/冷静/胆小 */
  personality?: 'reckless' | 'bold' | 'calm' | 'timid';
  /** 出生年（公元纪年；用于老龄病逝判定。史书未载者采用通行推定值） */
  birthYear?: number;
  /** 死亡月份（处决或战死；在局中保留记录但不参与任何结算） */
  deathMonth?: number;
  acted: boolean;
  /** 本旬是否已受褒奖（每旬重置；受褒奖后当旬不再出现在奖赏列表） */
  rewarded?: boolean;
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
  | { kind: 'pass'; passId: PassId }
  | { kind: 'unit'; unitId: string }
  | { kind: 'unaffiliated'; cityId: CityId }
  | { kind: 'transfer'; fromCityId: CityId; fromPassId?: PassId; targetCityId: CityId; targetPassId?: PassId; remainingTenDays: number }
  | { kind: 'task'; cityId: CityId; passId?: PassId; task: 'armament'; armamentType: ArmamentType; amount: number; remainingTenDays: number; lead?: boolean }
  | { kind: 'task'; cityId: CityId; passId?: PassId; task: 'research'; nodeId: TechNodeId; remainingTenDays: number; lead?: boolean }
  | { kind: 'task'; cityId: CityId; passId?: PassId; task: 'cultivate'; nodeId: string; remainingTenDays: number }
  | { kind: 'task'; cityId: CityId; passId?: PassId; task: 'construction'; facility: string; plotIndex: number; remainingTenDays: number }
  | { kind: 'captive'; cityId: CityId; captorForceId: ForceId; capturedTenDays: number }
  | {
    /**
     * 外交使者：奉命出使对方势力。去程/返程各按「出发据点 → 对方势力君主所在城池」的移动旬数计，
     * 去程到点当旬结算外交效果（亲善/同盟/停战/请求援军/破弃），随后自动转返程，回到出发据点才恢复可用。
     */
    kind: 'envoy';
    /** 出发城池（关隘宿主时为该关隘的所属城，也是返程落点依据） */
    fromCityId: CityId;
    /** 出发据点为关隘时的关隘 id；返程回到这个关隘而不是城池 */
    fromPassId?: PassId;
    targetForceId: ForceId;
    action: DiplomacyAction;
    /** 随行礼金（同盟/停战用，出发时已从出发据点扣除） */
    gold?: number;
    /** 停战期限（月） */
    months?: number;
    /** 去程与返程旬数：出发当刻定格，避免途中对方迁都导致行程中途变化 */
    outboundTenDays: number;
    returnTenDays: number;
    phase: 'outbound' | 'return';
    remainingTenDays: number;
  }
  | {
    /**
     * 登庸差旅：跨城登庸时执行武将先前往目标武将所在城（去程）。
     * 抵达后当旬结算：亲善/必拒/无意愿直接出结果并转返程；
     * 可能舌战时挂起等待玩家抉择（是否舌战劝说）；舌战胜负见分晓后，
     * 成功则被登庸武将同行返程、失败则执行武将只身返回出发据点。
     * remainingTenDays 为 0 且 phase 为 outbound 时表示「已抵达目标城，等待者」，
     * 该状态下不再推进计时（等待舌战抉择或舌战进行中）。
     */
    kind: 'recruitJourney';
    /** 出发据点（返程落点，目标武将最终归宿） */
    fromCityId: CityId;
    /** 目标武将所在城池 */
    targetCityId: CityId;
    /** 登庸目标武将 id */
    targetOfficerId: string;
    /** 返程所需旬数（去程/返程同距） */
    returnTenDays: number;
    phase: 'outbound' | 'return';
    remainingTenDays: number;
  }
  | {
    /**
     * 流言差旅：奉命亲赴敌方据点（城池/关隘）散布流言。
     * 去程/返程各按「出发据点 → 目标据点」的移动旬数计（去程=返程），
     * 抵达当旬才散布流言并见分晓：成功后转返程，失败且被识破逮捕则就地成为该据点势力的俘虏（行程终止）。
     */
    kind: 'rumorJourney';
    /** 出发城池（关隘宿主时为该关隘的所属城） */
    fromCityId: CityId;
    /** 出发据点为关隘时的关隘 id；返程回到这个关隘而不是城池 */
    fromPassId?: PassId;
    /** 目标据点为城池时的城池 id（与 targetPassId 二选一） */
    targetCityId?: CityId;
    /** 目标据点为关隘时的关隘 id（与 targetCityId 二选一） */
    targetPassId?: PassId;
    /** 返程所需旬数（去程/返程同距） */
    returnTenDays: number;
    phase: 'outbound' | 'return';
    remainingTenDays: number;
  };

export interface City {
  id: CityId;
  name: string;
  /** 所属势力（null = 无主/空白城市，仅显示不做内政结算） */
  ownerId: ForceId | null;
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
  /** 据点士气（训练指令提升；与部队 `energy` 是同一资源，上限同为 techs.moraleCapOf：基础 100，职业化后 120） */
  training: number;
  mapX: number;
  mapY: number;
  gridQ: number;
  gridR: number;
  durability: number;
  maxDurability: number;
  /** 已因科技提升的耐久额度（工程学「据点最大耐久＋3000」的幂等标记）。
   *  旬结算按归属势力补齐到应得额度；易主后由新主补上，已吃过的份额不会重复叠加。 */
  techDurabilityBonus?: number;
  armaments?: CityArmaments;
  grainPrice?: number;
  /** 商人本旬是否到访（每旬独立 1/4 概率） */
  merchantPresent?: boolean;
  /** 本旬是否已与商人完成一次粮食交易 */
  merchantTradedThisTenDay?: boolean;
  /** 本旬是否已训练过守军（每旬每城仅一次） */
  trainedThisTenDay?: boolean;
  /** 本旬是否已巡查过（每旬每城仅一次） */
  patrolledThisTenDay?: boolean;
  /** 本旬已征兵的次数（上限＝该据点已建成兵舍座数，见 `innerAffairs.recruitTimesPerTenDay`） */
  recruitedThisTenDay?: number;
  /** 都市地格设施（市场/农场/兵舍/工房等），编号0~5 */
  plots?: CityPlot[];
}

/** 原版 10 座关隘 id（对应 Scen000.s11 关所坐标） */
export type PassId =
  | 'huguan'      // 壶关
  | 'hulaoguan'   // 虎牢关
  | 'tongguan'    // 潼关
  | 'hanguguan'   // 函谷关
  | 'wuguan'      // 武关
  | 'yangpingguan'// 阳平关
  | 'jiange'      // 剑阁
  | 'jiamengguan' // 葭萌关
  | 'fushuiguan'  // 涪水关
  | 'jiangyouguan'; // 江油关

/** 关隘据点：功能与城池一致（钱粮产出），但无都市内政操作、无需治安值 */
export interface Pass {
  id: PassId;
  name: string;
  /** 归属城池（关隘所属势力 = 归属城池的所有者） */
  homeCityId: CityId;
  ownerId: ForceId | null;
  /** 关隘太守（驻扎武将的领帅；开局为空，由玩家自派） */
  governorId: string | null;
  gold: number;
  food: number;
  /** 关隘人口（开局 4万~8万 随机） */
  population: number;
  troops: number;
  /** 关隘守军士气（与城池 `training` 同一资源、同一上限；训练指令提升；无治安值故巡查不作用于城市治安） */
  training: number;
  /** 关隘治安（供巡查指令等机制复用；因无需治安值，开局按 100 无特殊修正） */
  order: number;
  /** 关隘耐久（与城池同款属性；当前关隘不可被攻击，仅作据点基础属性展示） */
  durability: number;
  maxDurability: number;
  /** 已因科技提升的耐久额度（工程学「据点最大耐久＋3000」的幂等标记，语义同 City.techDurabilityBonus） */
  techDurabilityBonus?: number;
  armaments?: CityArmaments;
  /** 本旬是否已训练过守军（每旬每据点仅一次） */
  trainedThisTenDay?: boolean;
  /** 本旬是否已巡查过（每旬每据点仅一次） */
  patrolledThisTenDay?: boolean;
  /** 本旬已征兵的次数（上限＝该据点已建成兵舍座数，见 `innerAffairs.recruitTimesPerTenDay`） */
  recruitedThisTenDay?: number;
  /** 地格设施（与城池同构；关隘当前不开放建设，供兵舍/锻冶等加成逻辑复用） */
  plots?: CityPlot[];
  /** 唯一可通行的中心锚点格 */
  q: number;
  r: number;
  /** 两侧翼格（不可通行、渲染隐藏） */
  flankKeys: string[];
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
  /** 已研究的科技节点 id（9 系统 × 6 级共 64 个节点，见 game/techs.ts） */
  techNodes?: TechNodeId[];
  /** 能力研究（PK版研究能力树）状态 */
  abilityResearch?: AbilityResearchState;
  /** 当前爵位（随城市数量每月自动晋升） */
  rank?: RankId;
  /** 外交关系：对方势力id → 友好度（0~100，50 为中立；亲善与同盟成败/破盟会改变它） */
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
    officerIds: string[];
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
  /** 效果发生在关隘时为该关隘 id（渲染在关隘标记上） */
  passId?: PassId;
  q: number;
  r: number;
  amount: number;
  label: string;
  kind: 'recruit' | 'armament' | 'train' | 'patrol';
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

/** 着火格：remainingTenDays 为剩余旬数（普通火焰 1~3 旬；业火种/业火球点燃的业火 2~4 旬） */
export interface FirePlot {
  q: number;
  r: number;
  remainingTenDays?: number;
}

/**
 * 野外设施类型（科技解锁见 game/techs.ts 的 TECH_FACILITY_GATES）：
 * - 据点型：formation 阵（无门槛）→ fort 砦（石工术）→ fortress 城塞（建筑学），提供 ZOC、移动阻挡与逐级增强的防护/补给；
 * - 阻挡型：earthwork 土垒（无门槛）→ stoneWall 石墙（石工术），只阻挡移动、可被任意势力修补；
 * - 攻击型：arrowTower 箭楼（无门槛）→ crossbowTower 连弩楼（建筑学）→ catapultTower 投石台（弹道，射程 2~3 格）；
 * - 辅助型：drum 太鼓台 / musicTower 军乐台；
 * - 陷阱型：fireSeed 火种 / fireBall 火球（无门槛）→ flameSeed 火焰种 / flameBall 火焰球（火药）→ hellfireSeed 业火种 / hellfireBall 业火球（化学）。
 *
 * **升级链（catalog.FACILITY_UPGRADE_CHAIN）**：阵→砦、砦→城塞、土垒→石墙、箭楼→连弩楼 是「同一设施的档位」，
 * 高档不作为独立建造选项（建造菜单只列基础档这个入口，按科技解析成当前档），且研究完科技后场上已建成的
 * 低档设施会自动升级改名为高档（`facilityIsCompleted` 的才升）。
 * 投石台与陷阱的高低档不是升级关系，各自是独立选项。
 */
export type FacilityType =
  | 'drum'
  | 'arrowTower'
  | 'crossbowTower'
  | 'catapultTower'
  | 'musicTower'
  | 'formation'
  | 'fort'
  | 'fortress'
  | 'earthwork'
  | 'stoneWall'
  | 'fireSeed'
  | 'fireBall'
  | 'flameSeed'
  | 'flameBall'
  | 'hellfireSeed'
  | 'hellfireBall';

/** 部队委任（自动行动，点击「进行」时对未手动操作且有委任的部队自动执行）：
 * - move：沿最优路径向目标移动，到达后结束；
 * - build：先移动到目标建设格相邻处，自动设置设施，建设完成后转为修补委任；
 * - repair：自动修补指定未完成设施，建成后结束。 */
export type UnitDelegate =
  | { kind: 'move'; target: { q: number; r: number } }
  | { kind: 'build'; target: { q: number; r: number }; facility: FacilityType }
  | { kind: 'repair'; facilityId: string };


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
  /**
   * 存档结构版本。改动字段的语义（如友好度区间）时必须递增，
   * 并在 `persistence.migrateSaveToCurrent` 里补上对应迁移。
   */
  schemaVersion: 3;
  scenarioId: 'jingxiang-208' | 'mobile-duel' | 'custom-map';
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
  /** 跨城登庸：执行武将已抵达目标城且可能触发舌战，等待玩家抉择是否舌战劝说（进行/放弃） */
  pendingRecruitDebate?: { recruiterId: string; targetId: string } | null;
  /** 最近一次单挑结果（用于单挑弹窗逐回合展示，回合结束后清空） */
  lastDuelReport?: DuelReport | null;
  firePlots?: FirePlot[];
  facilities?: Record<string, Facility>;
  /** 关隘据点（10 座原版关隘，独立于城池结算） */
  passes?: Record<PassId, Pass>;
  /** 宝物实例状态（未出土时散落在城市，出土后归势力所有） */
  treasures?: Record<string, TreasureState>;
  logs: GameLog[];
}

export type TenDay = 1 | 2 | 3;

/**
 * 地形词表（含三国志11原版 20 值细分地形，映射自 San11pkres.bin SHEX0008）：
 *   草地 grass / 土 plain / 砂地 sand / 湿地 wetland / 毒泉 poison / 森林 forest
 *   川 stream(不可走水面) / 河 river / 海 sea(可下水水面) / 荒地 wasteland
 *   主径 road / 栈道 plank / 渡所 ferry / 浅滩 shallow(非水面可直接通行)
 *   岸 shore(不可走) / 崖 mountain / 都市 construction / 关所 pass / 港 ferry(渡口)
 *   小径 path；hill/water 为旧手绘地图兼容值（旧剧本/编辑器仍在用）
 */
export type TerrainType =
  | 'road'
  | 'path'
  | 'plank'
  | 'plain'
  | 'grass'
  | 'sand'
  | 'wasteland'
  | 'wetland'
  | 'poison'
  | 'forest'
  | 'hill'
  | 'mountain'
  | 'shore'
  | 'water'
  | 'stream'
  | 'river'
  | 'sea'
  | 'shallow'
  | 'ferry'
  | 'pass'
  | 'construction';
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
  /**
   * 出征时从据点带走的兵装（枪戟弩马按兵力 1:1，楼船/冲车/井阑各 1）。
   * 战斗部队回城/进关并账时按实际并入兵力返还（枪戟弩马）或整件返还（楼船/冲车/井阑）；
   * **输送队押运的是货物**，一律整件返还 —— 两种口径见 `strongholds.mergeUnitIntoStronghold`
   * 与 `returnArmamentsToStronghold`。未记录该字段的部队（疆域防御队、旧存档）不返还。
   */
  armaments?: Partial<CityArmaments>;
  q: number;
  r: number;
  troops: number;
  food: number;
  /** 士气：与据点 `training` 是同一资源（出征时由出发据点带入、回城时按兵力加权稀释并入），上限 techs.moraleCapOf */
  energy: number;
  /** 战力（战术/计略的能量来源，0~100）。仅战斗部队拥有，运输队无此属性。 */
  stamina?: number;
  movementRemaining: number;
  confusedTenDays?: number;
  burningTenDays?: number;
  falseReportedTenDays?: number;
  /** 临时部队到期旬数（如援军，到期自动撤退），格式 month*3+tenDay */
  expiresTenDay?: number;
  moved: boolean;
  acted: boolean;
  /** 部队委任（自动行动）：移动/建设/修补，未手动操作时点击「进行」自动执行 */
  delegate?: UnitDelegate;
}

/** 外交子行动：命令菜单「外交」段的各项，也是 diplomacy 指令的 action 取值 */
export type DiplomacyAction = 'goodwill' | 'alliance' | 'truce' | 'requestTroops' | 'break';

export type GameCommand =
  | { type: 'recruit'; cityId: CityId; passId?: PassId; officerIds: string[] }
  | { type: 'produceArmament'; cityId: CityId; passId?: PassId; officerIds: string[]; armamentType: ArmamentType }
  | { type: 'train'; cityId: CityId; passId?: PassId; officerIds: string[] }
  | { type: 'patrol'; cityId: CityId; passId?: PassId; officerIds: string[] }
  | { type: 'talent'; cityId: CityId; passId?: PassId; officerId: string; targetOfficerId: string }
  | { type: 'explore'; cityId: CityId; passId?: PassId; officerIds: string[] }
  | { type: 'grantTreasure'; cityId: CityId; passId?: PassId; treasureId: string; officerId: string | null }
  | { type: 'research'; cityId: CityId; passId?: PassId; officerIds: string[]; nodeId: TechNodeId }
  | { type: 'abilityResearch'; cityId: CityId; passId?: PassId; nodeId: string }
  | { type: 'cultivate'; cityId: CityId; passId?: PassId; officerId: string; nodeId: string }
  | { type: 'transfer';
      cityId: CityId;
      passId?: PassId;
      targetCityId: CityId;
      targetPassId?: PassId;
      officerIds: string[];
    }
  | { type: 'summon'; cityId: CityId; passId?: PassId; officerIds: string[] }
  | { type: 'sworn'; cityId: CityId; passId?: PassId; officerIds: string[] }
  | { type: 'trade'; cityId: CityId; passId?: PassId; officerId: string; mode: 'buy' | 'sell'; amount: number }
  | { type: 'reward'; cityId: CityId; passId?: PassId; officerIds: string[] }
  | { type: 'appointPosition'; cityId: CityId; passId?: PassId; officerId: string; positionId: string | null }
  | { type: 'rumor'; cityId: CityId; passId?: PassId; officerId: string; targetCityId?: CityId; targetPassId?: PassId }
  | { type: 'poach'; cityId: CityId; passId?: PassId; officerId: string; targetCityId: CityId; targetOfficerId: string }
  | { type: 'diplomacy';
      cityId: CityId;
      passId?: PassId;
      officerId: string;
      targetForceId: ForceId;
      action: DiplomacyAction;
      months?: number;
      gold?: number;
    }
  | { type: 'captiveDispose'; cityId: CityId; passId?: PassId; targetOfficerId: string; action: 'release' | 'execute' | 'recruit' }
  | { type: 'marry'; cityId: CityId; passId?: PassId; officerIdA: string; officerIdB: string; relation?: 'spouse' | 'sworn' }
  | { type: 'legion'; cityId: CityId; passId?: PassId; commanderId: string | null; targetCityId: CityId | null; policy?: Legion['policy'] }
  | { type: 'acceptRecruitDebate'; cityId: CityId; officerId: string; targetOfficerId: string }
  | { type: 'rejectRecruitDebate'; cityId: CityId; officerId: string; targetOfficerId: string }
  | { type: 'buildFacilityPlot'; cityId: CityId; passId?: PassId; officerIds: string[]; plotIndex: number; facility: 'market' | 'farm' | 'barracks' | 'smithy' | 'forge' | 'stable' | 'shipyard' | 'mint' | 'granary' | 'blackmarket' | 'grandmarket' | 'fishmarket' | 'garrisonfarm' | 'hubu' | 'xingbu' | 'bingbu' | 'gongbu' | 'libu' | 'personnel' | 'taixue' | 'tongqueta' }
  | { type: 'cancelCityPlot'; cityId: CityId; passId?: PassId; plotIndex: number }
  | { type: 'appointStrategist'; cityId: CityId; passId?: PassId; officerId: string | null }
  | { type: 'banish'; cityId: CityId; passId?: PassId; officerIds: string[] };

export interface ForceRanking {
  forceId: ForceId;
  name: string;
  score: number;
  rank: number;
  tied: boolean;
}
