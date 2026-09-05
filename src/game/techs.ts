import type { ForceId, GameState, TechBranchId } from './types';

// 科技树：6方向 × 4级 = 24个科技，线性解锁

export interface TechLevelDef {
  name: string;
  description: string;
}

export interface TechBranchDef {
  id: TechBranchId;
  name: string;
  /** 影响研究速度的武将属性 */
  researchStat: 'leadership' | 'politics';
  levels: [TechLevelDef, TechLevelDef, TechLevelDef, TechLevelDef];
}

export const TECH_BRANCHES: TechBranchDef[] = [
  {
    id: 'spear',
    name: '枪兵',
    researchStat: 'leadership',
    levels: [
      { name: '枪术训练', description: '枪兵战法与普攻伤害+10%' },
      { name: '兵粮袭击', description: '枪兵战法击中敌军时夺取其兵粮' },
      { name: '奇袭', description: '枪兵在森林地形攻击不受反击' },
      { name: '精锐枪兵', description: '枪兵伤害再+10%，移动力+6' },
    ],
  },
  {
    id: 'halberd',
    name: '戟兵',
    researchStat: 'leadership',
    levels: [
      { name: '戟术训练', description: '戟兵战法与普攻伤害+10%' },
      { name: '矢盾', description: '戟兵受弩兵远程攻击时30%概率免伤' },
      { name: '大盾', description: '戟兵受普通攻击时30%概率免伤' },
      { name: '精锐戟兵', description: '戟兵伤害再+10%，移动力+6' },
    ],
  },
  {
    id: 'crossbow',
    name: '弩兵',
    researchStat: 'leadership',
    levels: [
      { name: '射术训练', description: '弩兵战法与普攻伤害+10%' },
      { name: '还射', description: '弩兵受远程攻击时自动反击' },
      { name: '劲弩', description: '弩兵射程+1' },
      { name: '精锐弩兵', description: '弩兵伤害再+10%，移动力+6' },
    ],
  },
  {
    id: 'cavalry',
    name: '骑兵',
    researchStat: 'leadership',
    levels: [
      { name: '骑术训练', description: '骑兵战法与普攻伤害+10%' },
      { name: '马镫', description: '骑兵战法按本旬移动格数增伤，每格+4%' },
      { name: '游击', description: '骑兵攻击后可再次行动（二动）' },
      { name: '精锐骑兵', description: '骑兵伤害再+10%，移动力+6' },
    ],
  },
  {
    id: 'military',
    name: '军制',
    researchStat: 'politics',
    levels: [
      { name: '熟练兵', description: '部队气力上限+20' },
      { name: '随军参谋', description: '出征部队初始气力增加（政治×20%）' },
      { name: '军制改革', description: '出征兵力上限+3000' },
      { name: '掌握人心', description: '部队每旬气力恢复翻倍；且季初掉忠2/3概率免疫、敌方挖角成功率下降' },
    ],
  },
  {
    id: 'civil',
    name: '内政',
    researchStat: 'politics',
    levels: [
      { name: '屯田', description: '农业开发产出+25%' },
      { name: '市易', description: '商业开发产出+25%' },
      { name: '徭役', description: '征兵产出+30%' },
      { name: '仁政', description: '治安自然回升翻倍，人口增长+50%' },
    ],
  },
];

export const TECH_BRANCH_LABELS: Record<TechBranchId, string> = {
  spear: '枪兵',
  halberd: '戟兵',
  crossbow: '弩兵',
  cavalry: '骑兵',
  military: '军制',
  civil: '内政',
};

// 各级研究消耗：金钱、技巧P、基础耗时（日：60/70/90/120日 = 6/7/9/12旬）
export const TECH_COSTS: { gold: number; techP: number; baseDays: number }[] = [
  { gold: 1000, techP: 1000, baseDays: 60 },
  { gold: 2000, techP: 2000, baseDays: 70 },
  { gold: 5000, techP: 3000, baseDays: 90 },
  { gold: 10000, techP: 5000, baseDays: 120 },
];

export const RESEARCH_AP_COST = 20;
export const MAX_TECH_LEVEL = 4;

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

/** 获取势力已研究等级（0-4） */
export function techLevelOf(state: GameState, forceId: ForceId, branch: TechBranchId): number {
  return state.forces[forceId]?.techs?.[branch] ?? 0;
}

/** 兵种伤害系数（训练+精锐，1级+10%，4级再+10%） */
export function troopDamageMultiplier(state: GameState, forceId: ForceId, troop: 'spear' | 'halberd' | 'crossbow' | 'cavalry'): number {
  const level = techLevelOf(state, forceId, troop);
  return 1 + (level >= 1 ? 0.1 : 0) + (level >= 4 ? 0.1 : 0);
}

/** 精锐兵种移动力加成（4级+6） */
export function troopMovementBonus(state: GameState, forceId: ForceId, troop: 'spear' | 'halberd' | 'crossbow' | 'cavalry'): number {
  return techLevelOf(state, forceId, troop) >= 4 ? 6 : 0;
}

/** 精锐兵种移动力加成（宽松入参：非枪/戟/弩/骑兵种固定为0） */
export function troopMovementBonusForTroop(state: GameState, forceId: ForceId, troop: string | undefined): number {
  if (troop !== 'spear' && troop !== 'halberd' && troop !== 'crossbow' && troop !== 'cavalry') return 0;
  return troopMovementBonus(state, forceId, troop);
}

/** 气力上限（军制1级+20） */
export function energyCapOf(state: GameState, forceId: ForceId): number {
  return 100 + (techLevelOf(state, forceId, 'military') >= 1 ? 20 : 0);
}

/** 部队出征兵力上限（军制3级+3000） */
export function deployTroopCapOf(state: GameState, forceId: ForceId): number {
  return 10000 + (techLevelOf(state, forceId, 'military') >= 3 ? 3000 : 0);
}

/** 内政开发产出系数（屯田/市易 +25%） */
export function developMultiplier(state: GameState, forceId: ForceId, focus: 'commerce' | 'agriculture'): number {
  const level = techLevelOf(state, forceId, 'civil');
  // 1级=屯田（农业），2级=市易（商业）：各自独立生效
  if (focus === 'agriculture') return level >= 1 ? 1.25 : 1;
  return level >= 2 ? 1.25 : 1;
}

/** 征兵产出系数（徭役 +30%） */
export function recruitMultiplier(state: GameState, forceId: ForceId): number {
  return techLevelOf(state, forceId, 'civil') >= 3 ? 1.3 : 1;
}

/** 「掌握人心」：军制4级。季初掉忠2/3概率免疫，且敌方挖角成功率下降 */
export function hasMasterHearts(state: GameState, forceId: ForceId): boolean {
  return techLevelOf(state, forceId, 'military') >= 4;
}

/** 研究耗时（旬）：研究日数 = 基本日数 −【相关能力总和÷7】（最低10日），相关能力为执行武将纯等权重加和 */
export function researchTenDays(baseDays: number, statSum: number): number {
  const days = Math.max(10, baseDays - Math.floor(statSum / 7));
  return Math.ceil(days / 10);
}
