/**
 * 新版科技树「布局层」（仅界面用）。
 *
 * 说明：节点的名称、等级、系统归属与前置关系**一律从 src/game/techs.ts 派生**，
 * 本文件只保留画布排布信息（每个节点的 row 行号、系统配色 color/fill）与画布常量，
 * 避免科技数值与界面两处维护（等级一改，这里自动跟随）。
 */

import { TECH_LEVEL_COSTS, TECH_SYSTEMS, techNodeOf } from '../game/techs';
import type { TechNodeId, TechSystemId } from '../game/types';

export type { TechNodeId, TechSystemId };

export interface TechSystemDef {
  id: TechSystemId;
  /** 系统名（图例文字） */
  name: string;
  /** 描边／文字色 */
  color: string;
  /** 底色 */
  fill: string;
}

export interface TechLevelDef {
  level: number;
  /** 该层级研究所需资金 */
  gold: number;
  /** 该层级研究所需技巧值 */
  techP: number;
}

export interface TechTreeNodeDef {
  id: string;
  name: string;
  /** 所在层级 1-6（派生自 game/techs.ts，决定列位与费用） */
  level: number;
  /** 画布行号（1 起，用于纵向排布；同一行即同一水平线） */
  row: number;
  system: TechSystemId;
  /** 前置科技 id（用于绘制箭头；根科技无前置） */
  prev?: string;
}

/** 六个层级的资金／技巧值需求（派生自 game/techs.ts 的 TECH_LEVEL_COSTS） */
export const TECH_TREE_LEVELS: TechLevelDef[] = TECH_LEVEL_COSTS.map((cost) => ({
  level: cost.level,
  gold: cost.gold,
  techP: cost.techP,
}));

/**
 * 九大系统配色（本文件独有）。
 *
 * color = 描边（亮色，保留各系色相以作区分）；fill = 节点底色（**深色**，
 * 与游戏 UI 深色主题一致，且保证白色文字有足够对比度）。
 */
const SYSTEM_COLORS: Record<TechSystemId, { color: string; fill: string }> = {
  infantry: { color: '#0ab7ef', fill: '#12384f' },
  archery: { color: '#1fb7c6', fill: '#0f4249' },
  military: { color: '#ee7f0f', fill: '#5a360e' },
  cavalry: { color: '#d1ac5e', fill: '#494022' },
  navy: { color: '#0a8bdd', fill: '#12355c' },
  engineering: { color: '#7235b9', fill: '#38205a' },
  economy: { color: '#8fb012', fill: '#364714' },
  culture: { color: '#e5c10a', fill: '#544a0e' },
  chemistry: { color: '#cc0567', fill: '#540f34' },
};

/** 九大科技系统（图例顺序与配色）：名称取自 game/techs.ts 的 TECH_SYSTEMS */
export const TECH_TREE_SYSTEMS: TechSystemDef[] = TECH_SYSTEMS.map((system) => ({
  id: system.id,
  name: system.name,
  ...SYSTEM_COLORS[system.id],
}));

/**
 * 节点排布表：[节点 id, 画布行号]，数组顺序即绘制顺序（与参考图一致，行 1 在最上）。
 * 名称／等级／系统／前置全部由 game/techs.ts 派生，此处只负责「画在哪一行」。
 * 共 64 项（与科技树节点总数一致，缺失或多余都会被 techTreePanel.test.tsx 拦下）。
 */
const NODE_ROWS: readonly (readonly [TechNodeId, number])[] = [
  // 行 1：步战系·枪
  ['qiangshuxunlian', 1],
  ['bingliangxiji', 1],
  ['qixi', 1],
  ['qiangbingjingzhuan', 1],
  // 行 2：步战系·戟
  ['jishuxunlian', 2],
  ['dunpaifangyu', 2],
  ['liansuofangyu', 2],
  ['jibingjingzhuan', 2],
  // 行 3：军制系·制度
  ['zhiyehua', 3],
  ['yaoyizhidu', 3],
  ['mubingzhidu', 3],
  ['jiedushi', 3],
  // 行 4：军制系·行军
  ['suijuncanmou', 4],
  ['kailujun', 4],
  ['jixingjun', 4],
  ['houqintixi', 4],
  // 行 5：射击系
  ['sheshuxunlian', 5],
  ['huanshe', 5],
  ['banzhi', 5],
  ['jinnu', 5],
  ['nubingjingzhuan', 5],
  // 行 6：骑牧系·骑兵
  ['qishuxunlian', 6],
  ['madeng', 6],
  ['youji', 6],
  ['qibingjingzhuan', 6],
  // 行 7：骑牧系·马政
  ['liangmayuzhong', 7],
  ['sheliMashi', 7],
  ['kaipimuchang', 7],
  // 行 8：理工系·器械
  ['gongbing', 8],
  ['lunzhou', 8],
  ['jixie', 8],
  ['yunti', 8],
  ['dandao', 8],
  ['pili', 8],
  // 行 9：理工系·土木
  ['shigongshu', 9],
  ['jianzhuxue', 9],
  ['gongchengxue', 9],
  ['duoqiang', 9],
  ['xiuzhuyaosai', 9],
  // 行 10：经济系·商贸
  ['liutonghuobi', 10],
  ['maoyixinghui', 10],
  // 行 11：经济系·农政
  ['chuanwu', 11],
  ['tunken', 11],
  ['guangaishuiqu', 11],
  ['xiangshenzhuangyuan', 11],
  // 行 12：航行系
  ['shuijunxunlian', 12],
  ['zhuangjia', 12],
  ['luopan', 12],
  ['zaochuanshu', 12],
  ['shuijunjingzhuan', 12],
  // 行 13：化工系·兵器铸造
  ['wuqijingzao', 13],
  // 行 14：化工系·冶铸
  ['duanzao', 14],
  ['yelian', 14],
  ['fangjujingzao', 14],
  // 行 15：文教系
  ['gonggongjiaoyu', 15],
  ['zhongyixue', 15],
  ['wenguanzhidu', 15],
  ['sanshengliubu', 15],
  ['yinshuashu', 15],
  ['kejifuli', 15],
  // 行 16：化工系·火药
  ['xiaoshi', 16],
  ['menghuoyou', 16],
  ['huoyao', 16],
  ['huaxue', 16],
];

/** 全部 64 个科技节点：内容取自 game/techs.ts，row 为本文件的画布排布 */
export const TECH_TREE_NODES: TechTreeNodeDef[] = NODE_ROWS.flatMap(([id, row]) => {
  const def = techNodeOf(id);
  if (!def) return [];
  return [{
    id: def.id,
    name: def.name,
    level: def.level,
    row,
    system: def.system,
    prev: def.prev,
  }];
});
