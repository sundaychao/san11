/**
 * 新版科技树「展示」数据（仅界面用）。
 *
 * 说明：本文件只描述新版科技树的名称、等级与排布，供 TechTreePanel 绘制，
 * 暂不接入 src/game/techs.ts 的既有科技系统（研究指令、技巧P、效果结算等仍走旧机制）。
 */

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
  /** 所在层级 1-6 */
  level: number;
  /** 画布行号（1 起，用于纵向排布；同一行即同一水平线） */
  row: number;
  system: TechSystemId;
  /** 前置科技 id（用于绘制箭头；根科技无前置） */
  prev?: string;
}

/** 六个层级的资金／技巧值需求 */
export const TECH_TREE_LEVELS: TechLevelDef[] = [
  { level: 1, gold: 1000, techP: 1000 },
  { level: 2, gold: 2000, techP: 2000 },
  { level: 3, gold: 3000, techP: 4000 },
  { level: 4, gold: 4000, techP: 6000 },
  { level: 5, gold: 6000, techP: 8000 },
  { level: 6, gold: 8000, techP: 10000 },
];

/**
 * 九大科技系统（图例顺序与配色）。
 *
 * color = 描边（亮色，保留各系色相以作区分）；fill = 节点底色（**深色**，
 * 与游戏 UI 深色主题一致，且保证白色文字有足够对比度）。
 */
export const TECH_TREE_SYSTEMS: TechSystemDef[] = [
  { id: 'infantry', name: '步战系', color: '#0ab7ef', fill: '#12384f' },
  { id: 'archery', name: '射击系', color: '#1fb7c6', fill: '#0f4249' },
  { id: 'military', name: '军制系', color: '#ee7f0f', fill: '#5a360e' },
  { id: 'cavalry', name: '骑牧系', color: '#d1ac5e', fill: '#494022' },
  { id: 'navy', name: '航行系', color: '#0a8bdd', fill: '#12355c' },
  { id: 'engineering', name: '理工系', color: '#7235b9', fill: '#38205a' },
  { id: 'economy', name: '经济系', color: '#8fb012', fill: '#364714' },
  { id: 'culture', name: '文教系', color: '#e5c10a', fill: '#544a0e' },
  { id: 'chemistry', name: '化工系', color: '#cc0567', fill: '#540f34' },
];

/** 全部科技节点（按图中排布：row 决定纵向位置，level 决定所在层级列） */
export const TECH_TREE_NODES: TechTreeNodeDef[] = [
  // 行 1：步战系·枪
  { id: 'qiangshuxunlian', name: '枪术训练', level: 2, row: 1, system: 'infantry', prev: 'zhiyehua' },
  { id: 'bingliangxiji', name: '兵粮袭击', level: 3, row: 1, system: 'infantry', prev: 'qiangshuxunlian' },
  { id: 'qixi', name: '奇袭', level: 5, row: 1, system: 'infantry', prev: 'bingliangxiji' },
  { id: 'qiangbingjingzhuan', name: '枪兵专精', level: 6, row: 1, system: 'infantry', prev: 'qixi' },
  // 行 2：步战系·戟
  { id: 'jishuxunlian', name: '戟术训练', level: 2, row: 2, system: 'infantry', prev: 'zhiyehua' },
  { id: 'dunpaifangyu', name: '盾牌防御', level: 3, row: 2, system: 'infantry', prev: 'jishuxunlian' },
  { id: 'liansuofangyu', name: '连锁防御', level: 5, row: 2, system: 'infantry', prev: 'dunpaifangyu' },
  { id: 'jibingjingzhuan', name: '戟兵专精', level: 6, row: 2, system: 'infantry', prev: 'liansuofangyu' },
  // 行 3：军制系·制度
  { id: 'zhiyehua', name: '职业化', level: 1, row: 3, system: 'military' },
  { id: 'yaoyizhidu', name: '徭役制度', level: 2, row: 3, system: 'military', prev: 'zhiyehua' },
  { id: 'mubingzhidu', name: '募兵制度', level: 3, row: 3, system: 'military', prev: 'yaoyizhidu' },
  { id: 'jiedushi', name: '节度使', level: 5, row: 3, system: 'military', prev: 'mubingzhidu' },
  // 行 4：军制系·行军
  { id: 'suijuncanmou', name: '随军参谋', level: 2, row: 4, system: 'military', prev: 'zhiyehua' },
  { id: 'kailujun', name: '开路军', level: 3, row: 4, system: 'military', prev: 'suijuncanmou' },
  { id: 'jixingjun', name: '急行军', level: 4, row: 4, system: 'military', prev: 'kailujun' },
  { id: 'houqintixi', name: '后勤体系', level: 6, row: 4, system: 'military', prev: 'jixingjun' },
  // 行 5：射击系
  { id: 'sheshuxunlian', name: '射术训练', level: 2, row: 5, system: 'archery', prev: 'zhiyehua' },
  { id: 'huanshe', name: '还射', level: 3, row: 5, system: 'archery', prev: 'sheshuxunlian' },
  { id: 'banzhi', name: '扳指', level: 4, row: 5, system: 'archery', prev: 'huanshe' },
  { id: 'jinnu', name: '劲弩', level: 5, row: 5, system: 'archery', prev: 'banzhi' },
  { id: 'nubingjingzhuan', name: '弩兵专精', level: 6, row: 5, system: 'archery', prev: 'jinnu' },
  // 行 6：骑牧系·骑兵
  { id: 'qishuxunlian', name: '骑术训练', level: 3, row: 6, system: 'cavalry', prev: 'liangmayuzhong' },
  { id: 'madeng', name: '马镫', level: 4, row: 6, system: 'cavalry', prev: 'qishuxunlian' },
  { id: 'youji', name: '游击', level: 5, row: 6, system: 'cavalry', prev: 'madeng' },
  { id: 'qibingjingzhuan', name: '骑兵专精', level: 6, row: 6, system: 'cavalry', prev: 'youji' },
  // 行 7：骑牧系·马政
  { id: 'liangmayuzhong', name: '良马育种', level: 1, row: 7, system: 'cavalry' },
  { id: 'sheliMashi', name: '设立马市', level: 2, row: 7, system: 'cavalry', prev: 'liangmayuzhong' },
  { id: 'kaipimuchang', name: '开辟牧场', level: 3, row: 7, system: 'cavalry', prev: 'sheliMashi' },
  // 行 8：理工系·器械
  { id: 'gongbing', name: '工兵', level: 1, row: 8, system: 'engineering' },
  { id: 'lunzhou', name: '轮轴', level: 2, row: 8, system: 'engineering', prev: 'gongbing' },
  { id: 'jixie', name: '机械', level: 3, row: 8, system: 'engineering', prev: 'lunzhou' },
  { id: 'yunti', name: '云梯', level: 4, row: 8, system: 'engineering', prev: 'jixie' },
  { id: 'dandao', name: '弹道', level: 5, row: 8, system: 'engineering', prev: 'yunti' },
  { id: 'pili', name: '霹雳', level: 6, row: 8, system: 'engineering', prev: 'dandao' },
  // 行 9：理工系·土木
  { id: 'shigongshu', name: '石工术', level: 2, row: 9, system: 'engineering', prev: 'gongbing' },
  { id: 'jianzhuxue', name: '建筑学', level: 3, row: 9, system: 'engineering', prev: 'shigongshu' },
  { id: 'gongchengxue', name: '工程学', level: 4, row: 9, system: 'engineering', prev: 'jianzhuxue' },
  { id: 'duoqiang', name: '垛墙', level: 5, row: 9, system: 'engineering', prev: 'gongchengxue' },
  { id: 'xiuzhuyaosai', name: '修筑要塞', level: 6, row: 9, system: 'engineering', prev: 'duoqiang' },
  // 行 10：经济系·商贸
  { id: 'liutonghuobi', name: '流通货币', level: 3, row: 10, system: 'economy', prev: 'chuanwu' },
  { id: 'maoyixinghui', name: '贸易行会', level: 4, row: 10, system: 'economy', prev: 'liutonghuobi' },
  // 行 11：经济系·农政
  { id: 'chuanwu', name: '船坞', level: 1, row: 11, system: 'economy' },
  { id: 'tunken', name: '屯垦', level: 2, row: 11, system: 'economy', prev: 'chuanwu' },
  { id: 'guangaishuiqu', name: '灌溉水渠', level: 3, row: 11, system: 'economy', prev: 'tunken' },
  { id: 'xiangshenzhuangyuan', name: '乡绅庄园', level: 4, row: 11, system: 'economy', prev: 'guangaishuiqu' },
  // 行 12：航行系
  { id: 'shuijunxunlian', name: '水军训练', level: 2, row: 12, system: 'navy', prev: 'chuanwu' },
  { id: 'zhuangjia', name: '装甲', level: 3, row: 12, system: 'navy', prev: 'shuijunxunlian' },
  { id: 'luopan', name: '罗盘', level: 4, row: 12, system: 'navy', prev: 'zhuangjia' },
  { id: 'zaochuanshu', name: '造船术', level: 5, row: 12, system: 'navy', prev: 'luopan' },
  { id: 'shuijunjingzhuan', name: '水军专精', level: 6, row: 12, system: 'navy', prev: 'zaochuanshu' },
  // 行 13：化工系·兵器铸造
  { id: 'wuqijingzao', name: '武器精造', level: 5, row: 13, system: 'chemistry', prev: 'yelian' },
  // 行 14：化工系·冶铸
  { id: 'duanzao', name: '锻造', level: 2, row: 14, system: 'chemistry', prev: 'gonggongjiaoyu' },
  { id: 'yelian', name: '冶炼', level: 3, row: 14, system: 'chemistry', prev: 'duanzao' },
  { id: 'fangjujingzao', name: '防具精造', level: 5, row: 14, system: 'chemistry', prev: 'yelian' },
  // 行 15：文教系
  { id: 'gonggongjiaoyu', name: '公共教育', level: 1, row: 15, system: 'culture' },
  { id: 'zhongyixue', name: '中医学', level: 2, row: 15, system: 'culture', prev: 'gonggongjiaoyu' },
  { id: 'wenguanzhidu', name: '文官制度', level: 3, row: 15, system: 'culture', prev: 'zhongyixue' },
  { id: 'sanshengliubu', name: '三省六部', level: 4, row: 15, system: 'culture', prev: 'wenguanzhidu' },
  { id: 'yinshuashu', name: '印刷术', level: 5, row: 15, system: 'culture', prev: 'sanshengliubu' },
  { id: 'kejifuli', name: '克己复礼', level: 6, row: 15, system: 'culture', prev: 'yinshuashu' },
  // 行 16：化工系·火药
  { id: 'xiaoshi', name: '硝石', level: 2, row: 16, system: 'chemistry', prev: 'gonggongjiaoyu' },
  { id: 'menghuoyou', name: '猛火油', level: 4, row: 16, system: 'chemistry', prev: 'xiaoshi' },
  { id: 'huoyao', name: '火药', level: 5, row: 16, system: 'chemistry', prev: 'menghuoyou' },
  { id: 'huaxue', name: '化学', level: 6, row: 16, system: 'chemistry', prev: 'huoyao' },
];
