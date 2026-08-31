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
      { name: '治军严明', description: '部队每旬气力恢复翻倍' },
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

// 各级研究消耗：金钱、技巧P、基础耗时（旬）
export const TECH_COSTS: { gold: number; techP: number; baseTenDays: number }[] = [
  { gold: 1000, techP: 1000, baseTenDays: 3 },
  { gold: 2000, techP: 2000, baseTenDays: 4 },
  { gold: 5000, techP: 3000, baseTenDays: 6 },
  { gold: 10000, techP: 5000, baseTenDays: 9 },
];

export const RESEARCH_AP_COST = 20;
export const MAX_TECH_LEVEL = 4;

/** 技巧P获取来源数值 */
export const TECHP_PER_BREAK_UNIT = 200;
export const TECHP_PER_CITY_CAPTURE = 2000;
export const TECHP_PER_RECRUIT_OFFICER = 150;
export const TECHP_PER_TRADE = 80;
export const TECHP_PER_CIVIL_ACTION = 30;
export const TECHP_POP_DIVISOR = 4000;

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

/** 研究耗时：基础旬数随武将相关属性缩短（每20点属性省1旬） */
export function researchTenDays(baseTenDays: number, statValue: number): number {
  return Math.max(1, baseTenDays - Math.floor(statValue / 20));
}
