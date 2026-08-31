import type { CityId, Stats } from './types';

/** 宝物种类：剑 / 武器 / 名马 / 书籍 / 珍宝 */
export type TreasureCategory = '剑' | '武器' | '名马' | '书籍' | '珍宝';

export interface TreasureDefinition {
  id: string;
  name: string;
  category: TreasureCategory;
  /** 装备后附加的五维能力（血色衣冠6设定） */
  stats: Partial<Stats>;
  /** 附带特技名（复用现有特技注册表；未实装特技仅作展示） */
  skill?: string;
  /** 开局散落城市 */
  initialCityId: CityId;
  description: string;
}

/** 探索消耗：每名武将 20 行动力 */
export const EXPLORE_AP_PER_OFFICER = 20;
/** 探索消耗：每名武将 100 金 */
export const EXPLORE_GOLD_PER_OFFICER = 100;
/** 探索到小份金钱的概率与金额 */
export const EXPLORE_GOLD_CHANCE = 0.3;
export const EXPLORE_GOLD_MIN = 100;
export const EXPLORE_GOLD_MAX = 500;
/** 城中仍有未出土宝物时，探索发现宝物的基础概率（受执行武将智力加成） */
export const EXPLORE_TREASURE_BASE_CHANCE = 0.15;
/** 发现宝物概率的智力加成上限 */
export const EXPLORE_TREASURE_INT_BONUS_MAX = 0.2;

/**
 * 血色衣冠6 宝物一览（节选）：
 * 剑类附统率与特技，武器/名马/书籍/珍宝各带能力或特技加成。
 */
export const TREASURES: ReadonlyArray<TreasureDefinition> = [
  // —— 剑类 ——
  { id: 'xuanyuan-sword', name: '轩辕剑', category: '剑', stats: { leadership: 5 }, skill: '天命', initialCityId: 'wan', description: '上古圣剑，佩者不受战死、负伤与被俘之厄。' },
  { id: 'chixiao-sword', name: '赤霄剑', category: '剑', stats: { leadership: 3 }, skill: '攻心', initialCityId: 'xiangyang', description: '汉高祖斩蛇之剑，攻敌可夺其士气为己用。' },
  { id: 'zhanlu-sword', name: '湛卢剑', category: '剑', stats: { leadership: 3 }, skill: '怒发', initialCityId: 'jiangxia', description: '欧冶子所铸仁道之剑，受挫愈勇。' },
  { id: 'tai-e-sword', name: '太阿剑', category: '剑', stats: { leadership: 2 }, skill: '破竹', initialCityId: 'lingling', description: '楚王镇国之剑，破敌之势如竹之劈裂。' },
  // —— 武器 ——
  { id: 'fangtian-halberd', name: '方天画戟', category: '武器', stats: { war: 5 }, skill: '威风', initialCityId: 'xiangyang', description: '吕布所持画戟，一击之下敌胆俱寒。' },
  { id: 'liquan-spear', name: '沥泉枪', category: '武器', stats: { war: 2 }, skill: '连击', initialCityId: 'jiangling', description: '岳飞之枪，枪出如龙，连绵不绝。' },
  { id: 'zhangba-spear', name: '丈八蛇矛', category: '武器', stats: { war: 3 }, skill: '猛者', initialCityId: 'wuling', description: '张飞之矛，矛锋所至敌将披靡。' },
  { id: 'qinglong-blade', name: '青龙偃月刀', category: '武器', stats: { war: 4 }, skill: '昂扬', initialCityId: 'jiangling', description: '关羽之刀，刀沉势猛，破敌愈勇。' },
  // —— 名马 ——
  { id: 'chitu', name: '赤兔马', category: '名马', stats: {}, skill: '突袭', initialCityId: 'xiangyang', description: '日行千里之骏马，冲锋之际敌不及防。' },
  { id: 'dilu', name: '的卢马', category: '名马', stats: {}, skill: '遁走', initialCityId: 'wuling', description: '跃水三丈之良驹，危地亦可从容脱身。' },
  { id: 'jueying', name: '绝影马', category: '名马', stats: {}, skill: '强行', initialCityId: 'wan', description: '曹操坐骑，疾行无影，先人而至。' },
  // —— 书籍 ——
  { id: 'sunzi', name: '孙子兵法', category: '书籍', stats: { intelligence: 5 }, skill: '鬼谋', initialCityId: 'jiangxia', description: '兵家圣典，谋定而后动。' },
  { id: 'wuzi', name: '吴子兵法', category: '书籍', stats: { intelligence: 3 }, skill: '激励', initialCityId: 'changsha', description: '吴起兵书，善将者以治为胜。' },
  { id: 'zuozhuan', name: '春秋左传', category: '书籍', stats: { politics: 5 }, initialCityId: 'lingling', description: '经世之典，通古今之变。' },
  { id: 'shiji', name: '史记', category: '书籍', stats: { politics: 3 }, initialCityId: 'guiyang', description: '太史公绝唱，鉴往知来。' },
  // —— 珍宝 ——
  { id: 'yuxi', name: '玉玺', category: '珍宝', stats: { charisma: 5 }, initialCityId: 'xiangyang', description: '受命于天之玺，得之者名望大增。' },
  { id: 'heshibi', name: '和氏璧', category: '珍宝', stats: { charisma: 3 }, initialCityId: 'guiyang', description: '价值连城之璧，佩者声名远播。' },
  { id: 'shanhaijing', name: '山海经', category: '珍宝', stats: { intelligence: 2 }, skill: '五行', initialCityId: 'changsha', description: '志怪奇书，通晓山川五行之理。' },
  { id: 'qingnang-shu', name: '青囊书', category: '珍宝', stats: { intelligence: 2 }, skill: '解毒', initialCityId: 'wuling', description: '华佗医书，祛毒疗伤之法尽在其中。' },
  { id: 'taiping-yaoshu', name: '太平要术', category: '珍宝', stats: { intelligence: 3 }, skill: '风水', initialCityId: 'jiangxia', description: '南华老仙所授，晓阴阳风水之术。' },
];

const TREASURE_MAP = new Map(TREASURES.map((treasure) => [treasure.id, treasure]));

export function treasureDefinition(id: string): TreasureDefinition | undefined {
  return TREASURE_MAP.get(id);
}

/** 宝物效果说明文本：能力加成 + 附带特技 */
export function treasureEffectText(treasure: TreasureDefinition): string {
  const statLabels: Array<[keyof Stats, string]> = [
    ['leadership', '统率'],
    ['war', '武力'],
    ['intelligence', '智力'],
    ['politics', '政治'],
    ['charisma', '魅力'],
  ];
  const statParts = statLabels
    .filter(([key]) => (treasure.stats[key] ?? 0) > 0)
    .map(([key, label]) => `${label}+${treasure.stats[key]}`);
  const parts = [...statParts];
  if (treasure.skill) parts.push(`特技「${treasure.skill}」`);
  return parts.length > 0 ? parts.join('，') : '无附加效果';
}
