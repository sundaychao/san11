import type { ArmyUnit, CityId, ForceId, GameState, TechNodeId, TechSystemId, TroopType } from './types';

// 科技树：9 系统 × 6 级 = 64 个节点，节点之间用 prev 组成前置 DAG（跨系统连接）
// 数值与效果说明以设计图为准；效果实现集中在各调用点，通过 hasTech(...) 查询。

export type ResearchStat = 'leadership' | 'politics' | 'intelligence';

export interface TechSystemDef {
  id: TechSystemId;
  name: string;
}

export interface TechNodeDef {
  readonly id: string;
  readonly name: string;
  readonly system: TechSystemId;
  /** 所在层级 1-6，同时决定研究费用 */
  readonly level: number;
  /** 前置科技 id；根节点无前置 */
  readonly prev?: string;
  /** 研究速度相关属性 */
  readonly stat: ResearchStat;
  /** 效果说明（界面展示，与设计图一致） */
  readonly description: string;
}

/** 九大科技系统 */
export const TECH_SYSTEMS: readonly TechSystemDef[] = [
  { id: 'infantry', name: '步战系' },
  { id: 'archery', name: '射击系' },
  { id: 'military', name: '军制系' },
  { id: 'cavalry', name: '骑牧系' },
  { id: 'navy', name: '航行系' },
  { id: 'engineering', name: '理工系' },
  { id: 'economy', name: '经济系' },
  { id: 'culture', name: '文教系' },
  { id: 'chemistry', name: '化工系' },
];

/** 全部 64 个科技节点 */
export const TECH_NODES = [
  // 步战系·枪
  { id: 'qiangshuxunlian', name: '枪术训练', system: 'infantry', level: 2, prev: 'zhiyehua', stat: 'leadership', description: '枪兵战法威力＋10%' },
  { id: 'bingliangxiji', name: '兵粮袭击', system: 'infantry', level: 3, prev: 'qiangshuxunlian', stat: 'leadership', description: '枪兵战法击中敌军时夺取其兵粮' },
  { id: 'qixi', name: '奇袭', system: 'infantry', level: 5, prev: 'bingliangxiji', stat: 'leadership', description: '枪兵在森林地形攻击不受反击' },
  { id: 'qiangbingjingzhuan', name: '枪兵专精', system: 'infantry', level: 6, prev: 'qixi', stat: 'leadership', description: '枪兵战法威力＋25%' },
  // 步战系·戟
  { id: 'jishuxunlian', name: '戟术训练', system: 'infantry', level: 2, prev: 'zhiyehua', stat: 'leadership', description: '戟兵战法威力＋10%' },
  { id: 'dunpaifangyu', name: '盾牌防御', system: 'infantry', level: 4, prev: 'jishuxunlian', stat: 'leadership', description: '戟兵有1/3概率挡远程普攻' },
  { id: 'liansuofangyu', name: '连锁防御', system: 'infantry', level: 5, prev: 'dunpaifangyu', stat: 'leadership', description: '戟兵有1/3概率挡近距离普攻' },
  { id: 'jibingjingzhuan', name: '戟兵专精', system: 'infantry', level: 6, prev: 'liansuofangyu', stat: 'leadership', description: '戟兵战法威力＋25%' },
  // 射击系
  { id: 'sheshuxunlian', name: '射术训练', system: 'archery', level: 2, prev: 'zhiyehua', stat: 'leadership', description: '弩兵战法威力＋10%' },
  { id: 'huanshe', name: '还射', system: 'archery', level: 3, prev: 'sheshuxunlian', stat: 'leadership', description: '弩兵可远程还击' },
  { id: 'banzhi', name: '扳指', system: 'archery', level: 4, prev: 'huanshe', stat: 'leadership', description: '远程攻击伤害衰减减半' },
  { id: 'jinnu', name: '劲弩', system: 'archery', level: 5, prev: 'banzhi', stat: 'leadership', description: '弩兵和据点射程＋1' },
  { id: 'nubingjingzhuan', name: '弩兵专精', system: 'archery', level: 6, prev: 'jinnu', stat: 'leadership', description: '弩兵战法威力＋25%' },
  // 骑牧系
  { id: 'liangmayuzhong', name: '良马育种', system: 'cavalry', level: 1, stat: 'leadership', description: '骑兵移动＋4' },
  { id: 'sheliMashi', name: '设立马市', system: 'cavalry', level: 2, prev: 'liangmayuzhong', stat: 'leadership', description: '可以建造2级马厩' },
  { id: 'qishuxunlian', name: '骑术训练', system: 'cavalry', level: 3, prev: 'liangmayuzhong', stat: 'leadership', description: '骑兵战法威力＋10%' },
  { id: 'kaipimuchang', name: '开辟牧场', system: 'cavalry', level: 3, prev: 'sheliMashi', stat: 'leadership', description: '可以建造3级马厩' },
  { id: 'madeng', name: '马镫', system: 'cavalry', level: 4, prev: 'qishuxunlian', stat: 'leadership', description: '骑兵战法获得每移动格数＋4%的伤害加成' },
  { id: 'youji', name: '游击', system: 'cavalry', level: 5, prev: 'madeng', stat: 'leadership', description: '骑兵战法后可利用剩余移动力进行移动' },
  { id: 'qibingjingzhuan', name: '骑兵专精', system: 'cavalry', level: 6, prev: 'youji', stat: 'leadership', description: '骑兵战法威力＋25%' },
  // 军制系·制度
  { id: 'zhiyehua', name: '职业化', system: 'military', level: 1, stat: 'politics', description: '最大士气＋20' },
  { id: 'yaoyizhidu', name: '徭役制度', system: 'military', level: 2, prev: 'zhiyehua', stat: 'politics', description: '可以建造2级兵舍' },
  { id: 'mubingzhidu', name: '募兵制度', system: 'military', level: 3, prev: 'yaoyizhidu', stat: 'politics', description: '可以建造3级兵舍' },
  { id: 'jiedushi', name: '节度使', system: 'military', level: 5, prev: 'mubingzhidu', stat: 'politics', description: '部队带兵上限＋3000' },
  // 军制系·行军
  { id: 'suijuncanmou', name: '随军参谋', system: 'military', level: 2, prev: 'zhiyehua', stat: 'politics', description: '部队出征的初始士气值增加20%×相关属性' },
  { id: 'kailujun', name: '开路军', system: 'military', level: 3, prev: 'suijuncanmou', stat: 'politics', description: '部队可以进入小径、浅滩和川地形' },
  { id: 'jixingjun', name: '急行军', system: 'military', level: 4, prev: 'kailujun', stat: 'politics', description: '步兵移动＋6，骑兵移动＋4' },
  { id: 'houqintixi', name: '后勤体系', system: 'military', level: 6, prev: 'jixingjun', stat: 'politics', description: '运输队移动＋8，粮道提供的粮食损耗－50%' },
  // 理工系·器械
  { id: 'gongbing', name: '工兵', system: 'engineering', level: 1, stat: 'intelligence', description: '每回合耐久回复：据点＋150%，内政设施＋100%' },
  { id: 'lunzhou', name: '轮轴', system: 'engineering', level: 2, prev: 'gongbing', stat: 'intelligence', description: '兵器移动＋6' },
  { id: 'jixie', name: '机械', system: 'engineering', level: 3, prev: 'lunzhou', stat: 'intelligence', description: '可以使用木兽' },
  { id: 'yunti', name: '云梯', system: 'engineering', level: 4, prev: 'jixie', stat: 'intelligence', description: '对驻军的伤害：一般部队＋40%，攻城武器＋20%' },
  { id: 'dandao', name: '弹道', system: 'engineering', level: 5, prev: 'yunti', stat: 'intelligence', description: '可以使用投石车和设施「投石台」' },
  { id: 'pili', name: '霹雳', system: 'engineering', level: 6, prev: 'dandao', stat: 'intelligence', description: '投石战法有溅射效果' },
  // 理工系·土木
  { id: 'shigongshu', name: '石工术', system: 'engineering', level: 2, prev: 'gongbing', stat: 'intelligence', description: '可以使用设施「砦、石墙」' },
  { id: 'jianzhuxue', name: '建筑学', system: 'engineering', level: 3, prev: 'shigongshu', stat: 'intelligence', description: '可以使用设施「城塞、连弩楼」' },
  { id: 'gongchengxue', name: '工程学', system: 'engineering', level: 4, prev: 'jianzhuxue', stat: 'intelligence', description: '据点最大耐久＋3000' },
  { id: 'duoqiang', name: '垛墙', system: 'engineering', level: 5, prev: 'gongchengxue', stat: 'intelligence', description: '据点反击能力提升50%' },
  { id: 'xiuzhuyaosai', name: '修筑要塞', system: 'engineering', level: 6, prev: 'duoqiang', stat: 'intelligence', description: '港关容量＋100%，敌军在本地领移动消耗＋1' },
  // 经济系
  { id: 'chuanwu', name: '船坞', system: 'economy', level: 1, stat: 'politics', description: '可以建造鱼市' },
  { id: 'tunken', name: '屯垦', system: 'economy', level: 2, prev: 'chuanwu', stat: 'politics', description: '可以建造军屯农' },
  { id: 'liutonghuobi', name: '流通货币', system: 'economy', level: 3, prev: 'chuanwu', stat: 'politics', description: '可以建造2级市场' },
  { id: 'guangaishuiqu', name: '灌溉水渠', system: 'economy', level: 3, prev: 'tunken', stat: 'politics', description: '可以建造2级农田' },
  { id: 'maoyixinghui', name: '贸易行会', system: 'economy', level: 4, prev: 'liutonghuobi', stat: 'politics', description: '可以建造3级市场' },
  { id: 'xiangshenzhuangyuan', name: '乡绅庄园', system: 'economy', level: 4, prev: 'guangaishuiqu', stat: 'politics', description: '可以建造3级农田' },
  // 航行系
  { id: 'shuijunxunlian', name: '水军训练', system: 'navy', level: 2, prev: 'chuanwu', stat: 'leadership', description: '水军战法威力＋10%' },
  { id: 'zhuangjia', name: '装甲', system: 'navy', level: 3, prev: 'shuijunxunlian', stat: 'leadership', description: '水军攻击和防御＋10' },
  { id: 'luopan', name: '罗盘', system: 'navy', level: 4, prev: 'zhuangjia', stat: 'leadership', description: '水军移动＋6' },
  { id: 'zaochuanshu', name: '造船术', system: 'navy', level: 5, prev: 'luopan', stat: 'leadership', description: '可以使用斗舰' },
  { id: 'shuijunjingzhuan', name: '水军专精', system: 'navy', level: 6, prev: 'zaochuanshu', stat: 'leadership', description: '水军战法威力＋25%' },
  // 化工系·冶铸
  { id: 'duanzao', name: '锻造', system: 'chemistry', level: 2, prev: 'gonggongjiaoyu', stat: 'intelligence', description: '可以建造2级锻造' },
  { id: 'yelian', name: '冶炼', system: 'chemistry', level: 3, prev: 'duanzao', stat: 'intelligence', description: '可以建造3级锻造' },
  { id: 'wuqijingzao', name: '武器精造', system: 'chemistry', level: 5, prev: 'yelian', stat: 'intelligence', description: '枪、戟、弩、骑攻击＋10' },
  { id: 'fangjujingzao', name: '防具精造', system: 'chemistry', level: 5, prev: 'yelian', stat: 'intelligence', description: '枪、戟、弩、骑防御＋10' },
  // 化工系·火药
  { id: 'xiaoshi', name: '硝石', system: 'chemistry', level: 2, prev: 'gonggongjiaoyu', stat: 'intelligence', description: '火计范围＋2格' },
  { id: 'menghuoyou', name: '猛火油', system: 'chemistry', level: 4, prev: 'xiaoshi', stat: 'intelligence', description: '基础火伤害＋100%' },
  { id: 'huoyao', name: '火药', system: 'chemistry', level: 5, prev: 'menghuoyou', stat: 'intelligence', description: '可使用陷阱「火焰种、火焰球」' },
  { id: 'huaxue', name: '化学', system: 'chemistry', level: 6, prev: 'huoyao', stat: 'intelligence', description: '可使用陷阱「业火种、业火球」' },
  // 文教系
  { id: 'gonggongjiaoyu', name: '公共教育', system: 'culture', level: 1, stat: 'politics', description: '换季治安下降概率降低50%' },
  { id: 'zhongyixue', name: '中医学', system: 'culture', level: 2, prev: 'gonggongjiaoyu', stat: 'politics', description: '人口增长＋20%' },
  { id: 'wenguanzhidu', name: '文官制度', system: 'culture', level: 3, prev: 'zhongyixue', stat: 'politics', description: '行动力消耗－20%' },
  { id: 'sanshengliubu', name: '三省六部', system: 'culture', level: 4, prev: 'wenguanzhidu', stat: 'politics', description: '可以建造六部衙门' },
  { id: 'yinshuashu', name: '印刷术', system: 'culture', level: 5, prev: 'sanshengliubu', stat: 'politics', description: '军团直辖城市上限＋4' },
  { id: 'kejifuli', name: '克己复礼', system: 'culture', level: 6, prev: 'yinshuashu', stat: 'politics', description: '武将忠诚下降概率降低50%' },
] as const satisfies readonly TechNodeDef[];

export type { TechNodeId };

export const TECH_NODE_MAP = Object.fromEntries(TECH_NODES.map((node) => [node.id, node])) as Record<TechNodeId, TechNodeDef>;

export const MAX_TECH_LEVEL = 6;

export interface TechLevelCost {
  level: number;
  gold: number;
  techP: number;
  /** 基础研究日数（60/70/80/90/110/130 日） */
  baseDays: number;
}

/** 各层级研究费用：资金／技巧P／基础日数 */
export const TECH_LEVEL_COSTS: readonly TechLevelCost[] = [
  { level: 1, gold: 1000, techP: 1000, baseDays: 60 },
  { level: 2, gold: 2000, techP: 2000, baseDays: 70 },
  { level: 3, gold: 3000, techP: 4000, baseDays: 80 },
  { level: 4, gold: 4000, techP: 6000, baseDays: 90 },
  { level: 5, gold: 6000, techP: 8000, baseDays: 110 },
  { level: 6, gold: 8000, techP: 10000, baseDays: 130 },
];

export const RESEARCH_AP_COST = 20;
export const RESEARCH_AP_COST_MAX = 20;

/** 技巧P获取来源数值（对齐血色衣冠6.0分档，P0版） */
export const TECHP_PER_BREAK_UNIT = 200;
export const TECHP_PER_CITY_CAPTURE = 2000;
export const TECHP_PER_RECRUIT_OFFICER = 150;
export const TECHP_PER_TRADE = 80;
export const TECHP_PER_CIVIL_ACTION = 30; // 征兵
export const TECHP_PER_PRODUCE_ARMAMENT = 8; // 生产兵装
export const TECHP_PER_TRAIN = 8; // 训练（取原版浮动区间7~10的中值）
export const TECHP_PER_PATROL = 12; // 巡查
export const TECHP_PER_CONSTRUCTION = 30; // 开发建设（黑市除外）
export const TECHP_PER_DEFENSE_BUILD = 5; // 修建防御设施（修补一次）
export const TECHP_CITY_POP_DIVISOR = 3000; // 城市人口系数除数（城市人口÷此值≈每旬技巧P）
export const TECHP_RURAL_POP_DIVISOR = 12000; // 农村人口系数除数
export const TECHP_MAX = 60000; // 技巧P上限（对齐血色衣冠6.0 SIRE配置）

/** 技巧P入账（击破/占领/登庸/交易/内政等）。
 * 定义于此叶子模块，避免 commands.ts 与战斗模块形成循环依赖（启动时 TDZ 崩溃）。 */
export function addTechP(state: GameState, forceId: ForceId, amount: number): void {
  const force = state.forces[forceId];
  if (!force || amount <= 0) return;
  force.techP = Math.min(TECHP_MAX, (force.techP ?? 0) + amount);
}

/** 势力已研究的科技节点 id 列表 */
export function researchedTechs(state: GameState, forceId: ForceId): readonly TechNodeId[] {
  return state.forces[forceId]?.techNodes ?? [];
}

export function techNodeOf(nodeId: string): TechNodeDef | undefined {
  return TECH_NODE_MAP[nodeId as TechNodeId];
}

/** 势力是否已研究指定科技 */
export function hasTech(state: GameState, forceId: ForceId | null | undefined, nodeId: TechNodeId): boolean {
  if (!forceId) return false;
  return (state.forces[forceId]?.techNodes ?? []).includes(nodeId);
}

/** 前置科技是否已全部满足 */
export function techPrereqMet(state: GameState, forceId: ForceId, nodeId: TechNodeId): boolean {
  const node = techNodeOf(nodeId);
  if (!node?.prev) return true;
  return hasTech(state, forceId, node.prev as TechNodeId);
}

/** 节点研究费用 */
export function techCostOf(nodeId: TechNodeId): TechLevelCost | undefined {
  const node = techNodeOf(nodeId);
  if (!node) return undefined;
  return TECH_LEVEL_COSTS[node.level - 1];
}

/** 当前可研究（前置已满足且未研究）的节点 */
export function researchableTechs(state: GameState, forceId: ForceId): TechNodeId[] {
  return TECH_NODES
    .filter((node) => !hasTech(state, forceId, node.id as TechNodeId) && techPrereqMet(state, forceId, node.id as TechNodeId))
    .map((node) => node.id as TechNodeId);
}

/** 某系统已研究的节点数（界面用） */
export function researchedCountOf(state: GameState, forceId: ForceId, system: TechSystemId): number {
  const owned = new Set(researchedTechs(state, forceId));
  return TECH_NODES.filter((node) => node.system === system && owned.has(node.id as TechNodeId)).length;
}

/** 研究完成：把节点写入势力科技（重复研究不会重复写入），返回节点定义供调用方记录战报 */
export function completeTechResearch(state: GameState, forceId: ForceId, nodeId: TechNodeId): TechNodeDef | undefined {
  const force = state.forces[forceId];
  const node = techNodeOf(nodeId);
  if (!force || !node) return undefined;
  const owned = force.techNodes ?? [];
  if (!owned.includes(nodeId)) force.techNodes = [...owned, nodeId];
  return node;
}

/** 研究耗时（旬）：研究日数 = 基本日数 −【相关能力总和÷7】（最低10日），相关能力为执行武将纯等权重加和 */
export function researchTenDays(baseDays: number, statSum: number): number {
  const days = Math.max(10, baseDays - Math.floor(statSum / 7));
  return Math.ceil(days / 10);
}

// ---------------------------------------------------------------------------
// 效果查询层：所有科技效果都通过这些函数读取，调用点不再直接判断节点 id
// ---------------------------------------------------------------------------

/** 兵种类别：步兵（剑/枪/戟/弩）、骑兵、兵器（攻城器械）、水军、运输队 */
export type TroopCategory = 'infantry' | 'cavalry' | 'siege' | 'navy' | 'transport';

export function troopCategoryOf(unit: Pick<ArmyUnit, 'kind' | 'troopType' | 'vehicle'>): TroopCategory {
  if (unit.kind === 'transport') return 'transport';
  if (unit.vehicle) return 'navy';
  if (unit.troopType === 'cavalry') return 'cavalry';
  if (unit.troopType === 'siege') return 'siege';
  return 'infantry';
}

/** 各兵种的「训练 / 专精」科技节点（战法威力 +10% / +25%） */
const TACTIC_POWER_NODES: Partial<Record<TroopType | 'navy', [TechNodeId, TechNodeId]>> = {
  spear: ['qiangshuxunlian', 'qiangbingjingzhuan'],
  halberd: ['jishuxunlian', 'jibingjingzhuan'],
  crossbow: ['sheshuxunlian', 'nubingjingzhuan'],
  cavalry: ['qishuxunlian', 'qibingjingzhuan'],
  navy: ['shuijunxunlian', 'shuijunjingzhuan'],
};

/** 战法威力倍率（**只对战法生效，不影响普攻**）：训练＋10%，专精＋25% */
export function tacticPowerMultiplier(
  state: GameState,
  forceId: ForceId | null | undefined,
  unit: Pick<ArmyUnit, 'kind' | 'troopType' | 'vehicle'>,
): number {
  if (!forceId) return 1;
  const key = troopCategoryOf(unit) === 'navy' ? 'navy' : unit.troopType;
  const nodes = key ? TACTIC_POWER_NODES[key] : undefined;
  if (!nodes) return 1;
  let multiplier = 1;
  if (hasTech(state, forceId, nodes[0])) multiplier += 0.1;
  if (hasTech(state, forceId, nodes[1])) multiplier += 0.25;
  return multiplier;
}

/** 武器精造：枪、戟、弩、骑 攻击＋10；装甲：水军攻击＋10 */
export function troopAttackTechBonus(
  state: GameState,
  forceId: ForceId | null | undefined,
  unit: Pick<ArmyUnit, 'kind' | 'troopType' | 'vehicle'>,
): number {
  if (!forceId) return 0;
  if (troopCategoryOf(unit) === 'navy') return hasTech(state, forceId, 'zhuangjia') ? 10 : 0;
  const troop = unit.troopType;
  if (troop !== 'spear' && troop !== 'halberd' && troop !== 'crossbow' && troop !== 'cavalry') return 0;
  return hasTech(state, forceId, 'wuqijingzao') ? 10 : 0;
}

/** 防具精造：枪、戟、弩、骑 防御＋10；装甲：水军防御＋10 */
export function troopDefenseTechBonus(
  state: GameState,
  forceId: ForceId | null | undefined,
  unit: Pick<ArmyUnit, 'kind' | 'troopType' | 'vehicle'>,
): number {
  if (!forceId) return 0;
  if (troopCategoryOf(unit) === 'navy') return hasTech(state, forceId, 'zhuangjia') ? 10 : 0;
  const troop = unit.troopType;
  if (troop !== 'spear' && troop !== 'halberd' && troop !== 'crossbow' && troop !== 'cavalry') return 0;
  return hasTech(state, forceId, 'fangjujingzao') ? 10 : 0;
}

/** 科技带来的移动力加成：步兵（急行军）＋6、骑兵（良马育种＋急行军）＋8、兵器（轮轴）＋6、水军（罗盘）＋6、运输队（后勤体系）＋8 */
export function movementTechBonus(
  state: GameState,
  forceId: ForceId | null | undefined,
  unit: Pick<ArmyUnit, 'kind' | 'troopType' | 'vehicle'>,
): number {
  if (!forceId) return 0;
  switch (troopCategoryOf(unit)) {
    case 'transport':
      return hasTech(state, forceId, 'houqintixi') ? 8 : 0;
    case 'navy':
      return hasTech(state, forceId, 'luopan') ? 6 : 0;
    case 'siege':
      return hasTech(state, forceId, 'lunzhou') ? 6 : 0;
    case 'cavalry':
      return (hasTech(state, forceId, 'liangmayuzhong') ? 4 : 0) + (hasTech(state, forceId, 'jixingjun') ? 4 : 0);
    default:
      return hasTech(state, forceId, 'jixingjun') ? 6 : 0;
  }
}

/** 部队士气上限：职业化＋20 */
export function energyCapOf(state: GameState, forceId: ForceId | null | undefined): number {
  return 100 + (hasTech(state, forceId, 'zhiyehua') ? 20 : 0);
}

/**
 * 据点士气（训练度）上限：与部队士气上限同口径（基础 100，科技「职业化」＋20）。
 *
 * 虽然数值口径相同，但两者是**不同的字段**（`City/Pass.training` vs `ArmyUnit.energy`），
 * 单独成函数是为了将来二者可能分化（如只提升其中之一）。
 * 所有对 `training` 的写入（训练、征兵稀释、回城并账、委任）都必须用它收口，不要再硬编码 100。
 */
export function moraleCapOf(state: GameState, forceId: ForceId | null | undefined): number {
  return energyCapOf(state, forceId);
}

/** 随军参谋：出征初始士气增加「相关属性×20%」 */
export function initialEnergyBonus(state: GameState, forceId: ForceId | null | undefined, stat: number): number {
  return hasTech(state, forceId, 'suijuncanmou') ? Math.round(stat * 0.2) : 0;
}

/** 节度使：部队带兵上限＋3000 */
export function deployTroopCapOf(state: GameState, forceId: ForceId | null | undefined): number {
  return 10000 + (hasTech(state, forceId, 'jiedushi') ? 3000 : 0);
}

/** 劲弩：弩兵与据点射程＋1 */
export function rangedRangeBonus(state: GameState, forceId: ForceId | null | undefined): number {
  return hasTech(state, forceId, 'jinnu') ? 1 : 0;
}

/** 还射：弩兵可远程还击 */
export function canRangedCounter(state: GameState, forceId: ForceId | null | undefined): boolean {
  return hasTech(state, forceId, 'huanshe');
}

/** 扳指：远程攻击伤害衰减减半 */
export function rangedDecayHalved(state: GameState, forceId: ForceId | null | undefined): boolean {
  return hasTech(state, forceId, 'banzhi');
}

/** 盾牌防御：戟兵 1/3 概率挡下远程普攻 */
export function halberdBlocksRanged(state: GameState, forceId: ForceId | null | undefined): boolean {
  return hasTech(state, forceId, 'dunpaifangyu');
}

/** 连锁防御：戟兵 1/3 概率挡下近距离普攻 */
export function halberdBlocksMelee(state: GameState, forceId: ForceId | null | undefined): boolean {
  return hasTech(state, forceId, 'liansuofangyu');
}

/** 奇袭：枪兵在森林地形攻击不受反击 */
export function spearForestNoCounter(state: GameState, forceId: ForceId | null | undefined): boolean {
  return hasTech(state, forceId, 'qixi');
}

/** 兵粮袭击：枪兵战法击中敌军时夺取兵粮 */
export function spearSeizesFood(state: GameState, forceId: ForceId | null | undefined): boolean {
  return hasTech(state, forceId, 'bingliangxiji');
}

/** 马镫：骑兵战法按本旬移动格数增伤，每格＋4% */
export function cavalryStirrupBonus(state: GameState, forceId: ForceId | null | undefined): boolean {
  return hasTech(state, forceId, 'madeng');
}

/** 游击：骑兵战法后可利用剩余移动力继续移动 */
export function cavalryRaidMove(state: GameState, forceId: ForceId | null | undefined): boolean {
  return hasTech(state, forceId, 'youji');
}

/** 克己复礼：武将忠诚下降概率降低50% */
export function loyaltyLossResist(state: GameState, forceId: ForceId | null | undefined): boolean {
  return hasTech(state, forceId, 'kejifuli');
}

/** 公共教育：换季治安下降概率降低50% */
export function orderDropResist(state: GameState, forceId: ForceId | null | undefined): boolean {
  return hasTech(state, forceId, 'gonggongjiaoyu');
}

/** 中医学：人口增长＋20% */
export function populationGrowthMultiplier(state: GameState, forceId: ForceId | null | undefined): number {
  return hasTech(state, forceId, 'zhongyixue') ? 1.2 : 1;
}

/** 文官制度：指令行动力消耗－20% */
export function actionPointCostMultiplier(state: GameState, forceId: ForceId | null | undefined): number {
  return hasTech(state, forceId, 'wenguanzhidu') ? 0.8 : 1;
}

/** 工兵：据点耐久回复＋150%，内政设施耐久回复＋100% */
export function durabilityRecoveryMultiplier(state: GameState, forceId: ForceId | null | undefined, kind: 'stronghold' | 'facility'): number {
  if (!hasTech(state, forceId, 'gongbing')) return 1;
  return kind === 'stronghold' ? 2.5 : 2;
}

/** 工程学：据点最大耐久＋3000 */
export function maxDurabilityBonus(state: GameState, forceId: ForceId | null | undefined): number {
  return hasTech(state, forceId, 'gongchengxue') ? 3000 : 0;
}

/** 垛墙：据点反击（每旬箭雨）伤害倍率＋50% */
export function counterAttackMultiplier(state: GameState, forceId: ForceId | null | undefined): number {
  return hasTech(state, forceId, 'duoqiang') ? 1.5 : 1;
}

/** 云梯：对据点驻军伤害加成（一般部队＋40%，攻城武器＋20%） */
export function garrisonDamageMultiplier(
  state: GameState,
  forceId: ForceId | null | undefined,
  unit: Pick<ArmyUnit, 'kind' | 'troopType' | 'vehicle'>,
): number {
  if (!hasTech(state, forceId, 'yunti')) return 1;
  return troopCategoryOf(unit) === 'siege' ? 1.2 : 1.4;
}

/** 修筑要塞：港关容量＋100%；敌军在我方领地移动消耗＋1 */
export function strongholdCapacityMultiplier(state: GameState, forceId: ForceId | null | undefined): number {
  return hasTech(state, forceId, 'xiuzhuyaosai') ? 2 : 1;
}

export function enemyTerritoryMoveCostBonus(state: GameState, forceId: ForceId | null | undefined): number {
  return hasTech(state, forceId, 'xiuzhuyaosai') ? 1 : 0;
}

/** 硝石：火计范围＋2格 */
export function fireRangeBonus(state: GameState, forceId: ForceId | null | undefined): number {
  return hasTech(state, forceId, 'xiaoshi') ? 2 : 0;
}

/** 猛火油：基础火伤害＋100% */
export function fireDamageMultiplier(state: GameState, forceId: ForceId | null | undefined): number {
  return hasTech(state, forceId, 'menghuoyou') ? 2 : 1;
}

/** 机械：可以使用木兽 */
export function canUseWoodenBeast(state: GameState, forceId: ForceId | null | undefined): boolean {
  return hasTech(state, forceId, 'jixie');
}

/** 弹道：可以使用投石车与设施「投石台」 */
export function canUseCatapult(state: GameState, forceId: ForceId | null | undefined): boolean {
  return hasTech(state, forceId, 'dandao');
}

/** 霹雳：投石攻击带溅射 */
export function catapultSplash(state: GameState, forceId: ForceId | null | undefined): boolean {
  return hasTech(state, forceId, 'pili');
}

/** 造船术：可以使用斗舰 */
export function canUseBattleShip(state: GameState, forceId: ForceId | null | undefined): boolean {
  return hasTech(state, forceId, 'zaochuanshu');
}

/** 开路军：可进入小径、浅滩、川地形；经过栈道不损失士兵 */
export function canCrossRoughTerrain(state: GameState, forceId: ForceId | null | undefined): boolean {
  return hasTech(state, forceId, 'kailujun');
}

export interface TechFacilityGate {
  /** 设施类型（城市内政设施或野外设施） */
  facility: string;
  /** 需要的等级（内政设施 1-3；无等级的设施为 1） */
  level: number;
  /** 解锁所需科技节点 */
  node: TechNodeId;
}

/** 设施等级／种类解锁表：市场、农田、厩舍、兵舍、锻冶、鱼市、军屯农、六部衙门、砦、石墙、城塞、连弩楼、投石台、陷阱 */
export const TECH_FACILITY_GATES: readonly TechFacilityGate[] = [
  // 城市内政设施等级（PlotType 名称）
  { facility: 'market', level: 2, node: 'liutonghuobi' },
  { facility: 'market', level: 3, node: 'maoyixinghui' },
  { facility: 'farm', level: 2, node: 'guangaishuiqu' },
  { facility: 'farm', level: 3, node: 'xiangshenzhuangyuan' },
  { facility: 'stable', level: 2, node: 'sheliMashi' },
  { facility: 'stable', level: 3, node: 'kaipimuchang' },
  { facility: 'barracks', level: 2, node: 'yaoyizhidu' },
  { facility: 'barracks', level: 3, node: 'mubingzhidu' },
  { facility: 'forge', level: 2, node: 'duanzao' },
  { facility: 'forge', level: 3, node: 'yelian' },
  // 需要科技才能建造的设施
  { facility: 'fishmarket', level: 1, node: 'chuanwu' },
  { facility: 'garrisonfarm', level: 1, node: 'tunken' },
  { facility: 'hubu', level: 1, node: 'sanshengliubu' },
  { facility: 'xingbu', level: 1, node: 'sanshengliubu' },
  { facility: 'bingbu', level: 1, node: 'sanshengliubu' },
  { facility: 'gongbu', level: 1, node: 'sanshengliubu' },
  { facility: 'libu', level: 1, node: 'sanshengliubu' },
  { facility: 'personnel', level: 1, node: 'sanshengliubu' },
  // 野外设施
  { facility: 'fort', level: 1, node: 'shigongshu' },
  { facility: 'stoneWall', level: 1, node: 'shigongshu' },
  { facility: 'crossbowTower', level: 1, node: 'jianzhuxue' },
  { facility: 'fortress', level: 1, node: 'jianzhuxue' },
  { facility: 'catapultTower', level: 1, node: 'dandao' },
  // 陷阱
  { facility: 'fireSeed', level: 1, node: 'huoyao' },
  { facility: 'fireBall', level: 1, node: 'huoyao' },
  { facility: 'hellfireSeed', level: 1, node: 'huaxue' },
  { facility: 'hellfireBall', level: 1, node: 'huaxue' },
];

/** 某设施在指定等级是否需要科技（返回所需节点，无门槛返回 undefined） */
export function facilityGateNode(facility: string, level: number): TechNodeId | undefined {
  return TECH_FACILITY_GATES.find((gate) => gate.facility === facility && gate.level === level)?.node;
}

/** 势力已解锁的设施最高等级（内政设施）：1 级默认可用 */
export function facilityLevelCap(state: GameState, forceId: ForceId | null | undefined, facility: string): number {
  let cap = 1;
  for (const gate of TECH_FACILITY_GATES) {
    if (gate.facility !== facility || gate.level <= cap) continue;
    if (hasTech(state, forceId, gate.node)) cap = gate.level;
  }
  return cap;
}

/** 科技是否允许建造该设施（含等级门槛） */
export function canBuildFacility(state: GameState, forceId: ForceId | null | undefined, facility: string, level = 1): boolean {
  const node = facilityGateNode(facility, level);
  if (!node) return true;
  return hasTech(state, forceId, node);
}
