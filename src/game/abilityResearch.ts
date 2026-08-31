import type { AptitudeGrade, ForceId, GameState, Officer, OfficerAptitudes, Stats } from './types';
import { skillDefinition } from './skills';

// 能力研究（PK版「研究能力」）：节点树含兵种适性、五维+5 与特技节点。
// 研究消耗 300 金 + 20 行动力，耗时 1 个月（当月月结即完成）；研究完成后可培育武将，每次培育耗时 30 日（3旬）。
// 特技节点培育后武将习得该特技（learnedSkills 追加，主特技保留）。

export const ABILITY_RESEARCH_GOLD = 300;
export const ABILITY_RESEARCH_AP = 20;
export const CULTIVATE_AP = 20;
/** 培育一名武将所需旬数（30日） */
export const CULTIVATE_TEN_DAYS = 3;

export type AbilityCategory = 'attack' | 'defense' | 'wit' | 'civil' | 'skill';

export interface AbilityNodeDef {
  id: string;
  /** 显示名称，如 枪兵A / 武+5低 / 扫讨 */
  label: string;
  kind: 'aptitude' | 'stat' | 'skill';
  /** 分类颜色：攻击=红褐，防御=紫，计略=黄，内政=绿，特技=青蓝 */
  category: AbilityCategory;
  /** 树状图坐标（列/行，从1开始），用于 UI 布局 */
  col: number;
  row: number;
  /** 前置节点 id（全部研究完成才可研究本节点） */
  prereq: string[];
  /** 研究耗时（月） */
  months: number;
  /** 研究完成后可培育的次数 */
  learnCount: number;
  /** 适性节点：适性字段与目标等级（B节点 C→B，A节点 B→A） */
  aptitude?: keyof OfficerAptitudes;
  toGrade?: AptitudeGrade;
  /** 五维节点：属性字段与可提升上限 */
  stat?: keyof Stats;
  cap?: number;
}

// 所有能力研究耗时统一为 1 个月（当月月结即完成）。
const apt = (
  id: string,
  label: string,
  aptitude: keyof OfficerAptitudes,
  toGrade: AptitudeGrade,
  col: number,
  row: number,
  prereq: string[],
): AbilityNodeDef => ({
  id, label, kind: 'aptitude', category: 'attack', col, row, prereq, months: 1, learnCount: 5, aptitude, toGrade,
});

const stat = (
  id: string,
  label: string,
  statKey: keyof Stats,
  cap: number,
  category: AbilityCategory,
  col: number,
  row: number,
  prereq: string[],
  learnCount: number,
): AbilityNodeDef => ({
  id, label, kind: 'stat', category, col, row, prereq, months: 1, learnCount, stat: statKey, cap,
});

const skill = (id: string, label: string, col: number, row: number, prereq: string[]): AbilityNodeDef => ({
  id, label, kind: 'skill', category: 'skill', col, row, prereq, months: 1, learnCount: 3,
});

export const ABILITY_NODES: AbilityNodeDef[] = [
  // 布局严格对照原版「研究能力」截图：9列×7行，中心(5,4)为「研究开始」。
  // 前置（prereq）= 指向该节点的三角箭头上一级；被两个箭头指向的节点有两个前置，需全部研究完成。
  // 四个初始节点（武/统/智/政 +5低）无前置，从研究开始即可研究。
  //
  // —— 第一行：枪兵A 弩兵A 武+5中 戟兵A 水军A 辅佐 威风 ——
  apt('spearA', '枪兵A', 'spear', 'A', 1, 1, ['crossbowA']),
  apt('crossbowA', '弩兵A', 'crossbow', 'A', 2, 1, ['warMid']),
  stat('warMid', '武+5中', 'war', 80, 'attack', 3, 1, ['spearB', 'navyB'], 5),
  apt('halberdA', '戟兵A', 'halberd', 'A', 4, 1, ['halberdB']),
  apt('navyA', '水军A', 'navy', 'A', 5, 1, ['halberdA']),
  skill('sk-fuzuo', '辅佐', 6, 1, ['navyA']),
  skill('sk-weifeng', '威风', 7, 1, ['sk-fuzuo']),
  // —— 第二行：连击 枪兵B 水军B 戟兵B 血路 金刚 统+5中 统+5高 ——
  skill('sk-lianji', '连击', 2, 2, ['spearA']),
  apt('spearB', '枪兵B', 'spear', 'B', 3, 2, ['crossbowB']),
  apt('navyB', '水军B', 'navy', 'B', 4, 2, ['warLow', 'halberdB']),
  apt('halberdB', '戟兵B', 'halberd', 'B', 5, 2, ['leadLow']),
  skill('sk-xuelu', '血路', 6, 2, ['leadLow']),
  skill('sk-jingang', '金刚', 7, 2, ['leadLow']),
  stat('leadMid', '统+5中', 'leadership', 80, 'defense', 8, 2, ['sk-jingang'], 5),
  stat('leadHigh', '统+5高', 'leadership', 95, 'defense', 9, 2, ['leadMid'], 3),
  // —— 第三行：武+5高 弩兵B 武+5低 统+5低 不屈 攻心 名声 ——
  stat('warHigh', '武+5高', 'war', 95, 'attack', 1, 3, ['sk-lianji', 'cavalryA'], 3),
  apt('crossbowB', '弩兵B', 'crossbow', 'B', 3, 3, ['warLow']),
  stat('warLow', '武+5低', 'war', 70, 'attack', 4, 3, [], 5),
  stat('leadLow', '统+5低', 'leadership', 70, 'defense', 5, 3, [], 5),
  skill('sk-buqu', '不屈', 6, 3, ['leadLow']),
  skill('sk-gongxin', '攻心', 7, 3, ['sk-buqu', 'sk-jingang']),
  skill('sk-mingsheng', '名声', 8, 3, ['sk-gongxin']),
  // —— 第四行：骑兵A 射程 骑兵B 兵器B（中心为研究开始） 铁壁 繁殖 能吏 ——
  apt('cavalryA', '骑兵A', 'cavalry', 'A', 1, 4, ['siegeA']),
  skill('sk-shecheng', '射程', 2, 4, ['cavalryB']),
  apt('cavalryB', '骑兵B', 'cavalry', 'B', 3, 4, ['siegeB']),
  apt('siegeB', '兵器B', 'siege', 'B', 4, 4, ['warLow', 'intLow']),
  skill('sk-tiebi', '铁壁', 6, 4, ['sk-buqu']),
  skill('sk-fanzhi', '繁殖', 8, 4, ['polHigh']),
  skill('sk-nengli', '能吏', 9, 4, ['sk-fanzhi']),
  // —— 第五行：兵器A 沉着 规律 智+5低 政+5低 筑城 论客 政+5高 ——
  apt('siegeA', '兵器A', 'siege', 'A', 1, 5, ['cavalryB']),
  skill('sk-chenzhuo', '沉着', 2, 5, ['sk-guilv', 'sk-shecheng']),
  skill('sk-guilv', '规律', 3, 5, ['intLow']),
  stat('intLow', '智+5低', 'intelligence', 70, 'wit', 4, 5, [], 5),
  stat('polLow', '政+5低', 'politics', 70, 'civil', 5, 5, [], 5),
  skill('sk-zhucheng', '筑城', 6, 5, ['polLow']),
  skill('sk-lunke', '论客', 7, 5, ['sk-zhucheng']),
  stat('polHigh', '政+5高', 'politics', 95, 'civil', 8, 5, ['sk-lunke'], 3),
  // —— 第六行：智+5高 智+5中 魅+5低 魅+5高 搬运 发明 度支 ——
  stat('intHigh', '智+5高', 'intelligence', 95, 'wit', 2, 6, ['sk-chenzhuo'], 3),
  stat('intMid', '智+5中', 'intelligence', 80, 'wit', 3, 6, ['sk-guilv'], 5),
  stat('chaLow', '魅+5低', 'charisma', 70, 'civil', 5, 6, ['polLow'], 5),
  stat('chaHigh', '魅+5高', 'charisma', 95, 'civil', 6, 6, ['sk-zhucheng'], 3),
  skill('sk-banyun', '搬运', 7, 6, ['sk-lunke']),
  skill('sk-faming', '发明', 8, 6, ['sk-banyun']),
  skill('sk-duzhi', '度支', 9, 6, ['polHigh']),
  // —— 第七行：深谋 明镜 威压 魅+5中 政+5中 造船 ——
  skill('sk-shenmou', '深谋', 2, 7, ['intHigh', 'sk-mingjing']),
  skill('sk-mingjing', '明镜', 3, 7, ['intMid', 'sk-weiya']),
  skill('sk-weiya', '威压', 4, 7, ['chaLow']),
  stat('chaMid', '魅+5中', 'charisma', 80, 'civil', 5, 7, ['sk-weiya', 'polMid'], 5),
  stat('polMid', '政+5中', 'politics', 80, 'civil', 6, 7, ['chaHigh'], 5),
  skill('sk-zaochuan', '造船', 7, 7, ['polMid']),
];

export const ABILITY_NODE_MAP: Record<string, AbilityNodeDef> = Object.fromEntries(
  ABILITY_NODES.map((node) => [node.id, node]),
);

export const ABILITY_TREE_COLS = 9;
export const ABILITY_TREE_ROWS = 7;
/** 中心「研究开始」节点坐标 */
export const ABILITY_CENTER = { col: 5, row: 4 };

export const APTITUDE_NAMES: Record<keyof OfficerAptitudes, string> = {
  spear: '枪兵',
  halberd: '戟兵',
  crossbow: '弩兵',
  cavalry: '骑兵',
  siege: '兵器',
  navy: '水军',
};

export const STAT_NAMES: Record<keyof Stats, string> = {
  leadership: '统率',
  war: '武力',
  intelligence: '智力',
  politics: '政治',
  charisma: '魅力',
};

export function abilityNodeLabel(nodeId: string): string {
  return ABILITY_NODE_MAP[nodeId]?.label ?? nodeId;
}

/** 节点种类显示名 */
export function abilityKindLabel(node: AbilityNodeDef): string {
  if (node.kind === 'skill') return '特技';
  return node.kind === 'aptitude' ? '兵种适性' : '基本能力';
}

/** 节点效果描述 */
export function abilityEffectText(node: AbilityNodeDef): string {
  if (node.kind === 'skill') {
    const description = skillDefinition(node.label)?.description;
    return `培育后习得特技「${node.label}」${description ? `：${description}` : ''}`;
  }
  if (node.kind === 'aptitude' && node.aptitude && node.toGrade) {
    const name = APTITUDE_NAMES[node.aptitude];
    return node.toGrade === 'A'
      ? `将${name}适性为B的武将提升为A`
      : `将${name}适性为C的武将提升为B`;
  }
  if (node.kind === 'stat' && node.stat && node.cap) {
    const tier = node.cap === 95 ? '高级' : node.cap === 80 ? '中级' : '低级';
    return `${STAT_NAMES[node.stat]}+5（${tier}，最高可培育至${node.cap}）`;
  }
  return '';
}

export function abilityResearchOf(state: GameState, forceId: ForceId) {
  const research = state.forces[forceId]?.abilityResearch;
  return {
    researched: new Set(research?.researched ?? []),
    remaining: research?.remaining ?? {},
    active: research?.active,
  };
}

export function isAbilityResearched(state: GameState, forceId: ForceId, nodeId: string): boolean {
  return abilityResearchOf(state, forceId).researched.has(nodeId);
}

/** 节点剩余培育次数 */
export function abilityCultivateRemaining(state: GameState, forceId: ForceId, nodeId: string): number {
  return abilityResearchOf(state, forceId).remaining[nodeId] ?? 0;
}

export type AbilityNodeStatus = 'done' | 'active' | 'available' | 'locked';

export function abilityNodeStatus(state: GameState, forceId: ForceId, node: AbilityNodeDef): AbilityNodeStatus {
  const info = abilityResearchOf(state, forceId);
  if (info.researched.has(node.id)) return 'done';
  if (info.active?.nodeId === node.id) return 'active';
  const prereqMet = node.prereq.every((id) => info.researched.has(id));
  return prereqMet && !info.active ? 'available' : 'locked';
}

/** 可立即研究的节点（前置完成、未研究、无在研项目） */
export function availableAbilityNodes(state: GameState, forceId: ForceId): AbilityNodeDef[] {
  return ABILITY_NODES.filter((node) => abilityNodeStatus(state, forceId, node) === 'available');
}

const GRADE_ORDER: AptitudeGrade[] = ['C', 'B', 'A', 'S'];

function aptitudeGrade(officer: Officer, key: keyof OfficerAptitudes): AptitudeGrade {
  return officer.aptitudes?.[key] ?? 'C';
}

/** 判断武将是否可培育该节点（适性等级/五维上限/特技是否已习得） */
export function canCultivateOfficer(officer: Officer, node: AbilityNodeDef): boolean {
  if (node.kind === 'skill') {
    // 特技节点：只要武将尚未习得该特技即可培育（含主特技与已习得列表）
    return officer.skill !== node.label && !(officer.learnedSkills ?? []).includes(node.label);
  }
  if (node.kind === 'aptitude' && node.aptitude && node.toGrade) {
    const current = aptitudeGrade(officer, node.aptitude);
    // B节点要求当前为C，A节点要求当前为B
    const required: AptitudeGrade = node.toGrade === 'A' ? 'B' : 'C';
    return current === required;
  }
  if (node.kind === 'stat' && node.stat && node.cap) {
    return officer.stats[node.stat] < node.cap;
  }
  return false;
}

/** 培育生效：提升武将适性或五维，或习得特技（就地修改 officer） */
export function applyCultivation(officer: Officer, node: AbilityNodeDef): void {
  if (node.kind === 'skill') {
    if (officer.skill === node.label || (officer.learnedSkills ?? []).includes(node.label)) return;
    officer.learnedSkills = [...(officer.learnedSkills ?? []), node.label];
    return;
  }
  if (node.kind === 'aptitude' && node.aptitude && node.toGrade) {
    const current = aptitudeGrade(officer, node.aptitude);
    if (GRADE_ORDER.indexOf(current) < GRADE_ORDER.indexOf(node.toGrade)) {
      officer.aptitudes = {
        spear: officer.aptitudes?.spear ?? 'C',
        halberd: officer.aptitudes?.halberd ?? 'C',
        crossbow: officer.aptitudes?.crossbow ?? 'C',
        cavalry: officer.aptitudes?.cavalry ?? 'C',
        siege: officer.aptitudes?.siege ?? 'C',
        navy: officer.aptitudes?.navy ?? 'C',
        [node.aptitude]: node.toGrade,
      };
    }
    return;
  }
  if (node.kind === 'stat' && node.stat && node.cap) {
    const current = officer.stats[node.stat];
    if (current < node.cap) {
      officer.stats = { ...officer.stats, [node.stat]: Math.min(node.cap, current + 5) };
    }
  }
}
