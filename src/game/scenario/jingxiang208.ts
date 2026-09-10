import { initialArmaments } from '../armaments';
import { hasCityTrait } from '../cityTraits';
import { initCityPopulation, initConstructionPlots } from '../innerAffairs';
import { DEFAULT_OFFICER_LOYALTY, LEADER_INITIAL_LOYALTY } from '../loyalty';
import { createScenarioPasses } from '../passes';
import { INITIAL_OFFICER_MERIT, rankForCityCount } from '../ranks';
import { derivePersonality } from '../debate';
import { TREASURES } from '../treasures';
import type { City, CityId, Force, ForceId, GameState, GridCell, Officer, OfficerAptitudes, Stats, TreasureState } from '../types';
import china42Data from './maps/china42x.json';

type CitySeed = Omit<City, 'durability' | 'gridQ' | 'gridR' | 'id' | 'maxDurability'> & { id: CityId };
type OfficerSeed = Omit<Officer, 'acted' | 'location'>;

/** 自定义城新建时的默认经济资源（创建城池时复制一份） */
export const DEFAULT_CITY_ECONOMY = {
  gold: 5000,
  food: 30000,
  population: 400000,
  troops: 12000,
  commerce: 50,
  agriculture: 55,
  order: 80,
  training: 65,
};

const forces: Record<ForceId, Force> = {
  cao: {
    id: 'cao',
    name: '曹操',
    leaderId: 'cao-cao',
    color: '#2088ff',
    description: '据守北境重镇，政务与统率均衡。',
    // 开局技巧P 10000，便于直接测试/验证科技研究效果
    techP: 10000,
    techs: { spear: 1 },
  },
  liu: {
    id: 'liu',
    name: '刘备',
    leaderId: 'liu-bei',
    color: '#f2c230',
    description: '人才出众，以民心和武将能力见长。',
    techP: 10000,
    techs: { cavalry: 1 },
  },
  sun: {
    id: 'sun',
    name: '孙权',
    leaderId: 'sun-quan',
    color: '#e23d34',
    description: '立足江东水网，城市资源较为充裕。',
    techP: 10000,
    techs: { crossbow: 1 },
  },
  biao: {
    id: 'biao',
    name: '刘表',
    leaderId: 'liu-biao',
    color: '#30b45a',
    description: '深耕荆南，治安稳定且人才待发掘。',
    techP: 10000,
    techs: { civil: 1 },
  },
};

export const SCENARIO_FORCES = forces;

/**
 * 剧本城市：前 8 座为荆襄有主城（曹/刘/孙/刘表），
 * 其余 34 座为华夏全图无主城（ownerId=null，仅显示与原版建设用地，不参与内政结算）。
 * 城市坐标/小地图定位/建设用地均以 china42x.json 的原版精确数据为准。
 */
const citySeeds: CitySeed[] = [
  { id: 'wan', name: '宛', ownerId: 'cao', governorId: 'cao-cao', gold: 9000, food: 30000, population: 600000, troops: 16000, commerce: 60, agriculture: 45, order: 82, training: 72, mapX: 0.37, mapY: 0.17 },
  { id: 'xiangyang', name: '襄阳', ownerId: 'cao', governorId: 'cao-ren', gold: 8200, food: 34000, population: 575000, troops: 14500, commerce: 52, agriculture: 55, order: 78, training: 68, mapX: 0.25, mapY: 0.42 },
  { id: 'jiangling', name: '江陵', ownerId: 'liu', governorId: 'liu-bei', gold: 7600, food: 38000, population: 285000, troops: 13500, commerce: 48, agriculture: 65, order: 80, training: 72, mapX: 0.47, mapY: 0.53 },
  { id: 'wuling', name: '武陵', ownerId: 'liu', governorId: 'zhang-fei', gold: 6800, food: 32000, population: 425000, troops: 12000, commerce: 42, agriculture: 58, order: 84, training: 66, mapX: 0.15, mapY: 0.68 },
  { id: 'jiangxia', name: '江夏', ownerId: 'sun', governorId: 'sun-quan', gold: 8500, food: 32000, population: 500000, troops: 15000, commerce: 56, agriculture: 52, order: 78, training: 74, mapX: 0.78, mapY: 0.17 },
  { id: 'changsha', name: '长沙', ownerId: 'sun', governorId: 'lu-su', gold: 7300, food: 36000, population: 490000, troops: 13200, commerce: 50, agriculture: 60, order: 82, training: 70, mapX: 0.78, mapY: 0.38 },
  { id: 'lingling', name: '零陵', ownerId: 'biao', governorId: 'liu-biao', gold: 8500, food: 35000, population: 410000, troops: 11000, commerce: 48, agriculture: 62, order: 90, training: 65, mapX: 0.57, mapY: 0.87 },
  { id: 'guiyang', name: '桂阳', ownerId: 'biao', governorId: 'wen-pin', gold: 7100, food: 36000, population: 240000, troops: 11500, commerce: 47, agriculture: 63, order: 88, training: 67, mapX: 0.84, mapY: 0.71 },
  // ---- 以下为无主城（人口按原版都市规模分档：大城≥50万、中城25~50万、小城<25万） ----
  { id: 'xiangping', name: '襄平', ownerId: null, governorId: null, gold: 2000, food: 10000, population: 280000, troops: 0, commerce: 40, agriculture: 40, order: 70, training: 50, mapX: 0.5, mapY: 0.5 },
  { id: 'beiping', name: '北平', ownerId: null, governorId: null, gold: 2000, food: 10000, population: 320000, troops: 0, commerce: 40, agriculture: 40, order: 70, training: 50, mapX: 0.5, mapY: 0.5 },
  { id: 'ji', name: '蓟', ownerId: null, governorId: null, gold: 2000, food: 10000, population: 340000, troops: 0, commerce: 40, agriculture: 40, order: 70, training: 50, mapX: 0.5, mapY: 0.5 },
  { id: 'nanpi', name: '南皮', ownerId: null, governorId: null, gold: 2000, food: 10000, population: 400000, troops: 0, commerce: 40, agriculture: 40, order: 70, training: 50, mapX: 0.5, mapY: 0.5 },
  { id: 'pingyuan', name: '平原', ownerId: null, governorId: null, gold: 2000, food: 10000, population: 380000, troops: 0, commerce: 40, agriculture: 40, order: 70, training: 50, mapX: 0.5, mapY: 0.5 },
  { id: 'jinyang', name: '晋阳', ownerId: null, governorId: null, gold: 2000, food: 10000, population: 350000, troops: 0, commerce: 40, agriculture: 40, order: 70, training: 50, mapX: 0.5, mapY: 0.5 },
  { id: 'ye', name: '邺', ownerId: null, governorId: null, gold: 2000, food: 10000, population: 530000, troops: 0, commerce: 40, agriculture: 40, order: 70, training: 50, mapX: 0.5, mapY: 0.5 },
  { id: 'beihai', name: '北海', ownerId: null, governorId: null, gold: 2000, food: 10000, population: 360000, troops: 0, commerce: 40, agriculture: 40, order: 70, training: 50, mapX: 0.5, mapY: 0.5 },
  { id: 'xiapi', name: '下邳', ownerId: null, governorId: null, gold: 2000, food: 10000, population: 420000, troops: 0, commerce: 40, agriculture: 40, order: 70, training: 50, mapX: 0.5, mapY: 0.5 },
  { id: 'xiaopei', name: '小沛', ownerId: null, governorId: null, gold: 2000, food: 10000, population: 300000, troops: 0, commerce: 40, agriculture: 40, order: 70, training: 50, mapX: 0.5, mapY: 0.5 },
  { id: 'shouchun', name: '寿春', ownerId: null, governorId: null, gold: 2000, food: 10000, population: 480000, troops: 0, commerce: 40, agriculture: 40, order: 70, training: 50, mapX: 0.5, mapY: 0.5 },
  { id: 'puyang', name: '濮阳', ownerId: null, governorId: null, gold: 2000, food: 10000, population: 390000, troops: 0, commerce: 40, agriculture: 40, order: 70, training: 50, mapX: 0.5, mapY: 0.5 },
  { id: 'chenliu', name: '陈留', ownerId: null, governorId: null, gold: 2000, food: 10000, population: 430000, troops: 0, commerce: 40, agriculture: 40, order: 70, training: 50, mapX: 0.5, mapY: 0.5 },
  { id: 'xuchang', name: '许昌', ownerId: null, governorId: null, gold: 2000, food: 10000, population: 520000, troops: 0, commerce: 40, agriculture: 40, order: 70, training: 50, mapX: 0.5, mapY: 0.5 },
  { id: 'runan', name: '汝南', ownerId: null, governorId: null, gold: 2000, food: 10000, population: 460000, troops: 0, commerce: 40, agriculture: 40, order: 70, training: 50, mapX: 0.5, mapY: 0.5 },
  { id: 'luoyang', name: '洛阳', ownerId: null, governorId: null, gold: 2000, food: 10000, population: 600000, troops: 0, commerce: 40, agriculture: 40, order: 70, training: 50, mapX: 0.5, mapY: 0.5 },
  { id: 'changan', name: '长安', ownerId: null, governorId: null, gold: 2000, food: 10000, population: 600000, troops: 0, commerce: 40, agriculture: 40, order: 70, training: 50, mapX: 0.5, mapY: 0.5 },
  { id: 'shangyong', name: '上庸', ownerId: null, governorId: null, gold: 2000, food: 10000, population: 260000, troops: 0, commerce: 40, agriculture: 40, order: 70, training: 50, mapX: 0.5, mapY: 0.5 },
  { id: 'anding', name: '安定', ownerId: null, governorId: null, gold: 2000, food: 10000, population: 200000, troops: 0, commerce: 40, agriculture: 40, order: 70, training: 50, mapX: 0.5, mapY: 0.5 },
  { id: 'tianshui', name: '天水', ownerId: null, governorId: null, gold: 2000, food: 10000, population: 230000, troops: 0, commerce: 40, agriculture: 40, order: 70, training: 50, mapX: 0.5, mapY: 0.5 },
  { id: 'wuwei', name: '武威', ownerId: null, governorId: null, gold: 2000, food: 10000, population: 180000, troops: 0, commerce: 40, agriculture: 40, order: 70, training: 50, mapX: 0.5, mapY: 0.5 },
  { id: 'jianye', name: '建业', ownerId: null, governorId: null, gold: 2000, food: 10000, population: 540000, troops: 0, commerce: 40, agriculture: 40, order: 70, training: 50, mapX: 0.5, mapY: 0.5 },
  { id: 'wu', name: '吴', ownerId: null, governorId: null, gold: 2000, food: 10000, population: 450000, troops: 0, commerce: 40, agriculture: 40, order: 70, training: 50, mapX: 0.5, mapY: 0.5 },
  { id: 'kuaiji', name: '会稽', ownerId: null, governorId: null, gold: 2000, food: 10000, population: 400000, troops: 0, commerce: 40, agriculture: 40, order: 70, training: 50, mapX: 0.5, mapY: 0.5 },
  { id: 'lujiang', name: '庐江', ownerId: null, governorId: null, gold: 2000, food: 10000, population: 330000, troops: 0, commerce: 40, agriculture: 40, order: 70, training: 50, mapX: 0.5, mapY: 0.5 },
  { id: 'chaisang', name: '柴桑', ownerId: null, governorId: null, gold: 2000, food: 10000, population: 350000, troops: 0, commerce: 40, agriculture: 40, order: 70, training: 50, mapX: 0.5, mapY: 0.5 },
  { id: 'xinye', name: '新野', ownerId: null, governorId: null, gold: 2000, food: 10000, population: 260000, troops: 0, commerce: 40, agriculture: 40, order: 70, training: 50, mapX: 0.5, mapY: 0.5 },
  { id: 'yongan', name: '永安', ownerId: null, governorId: null, gold: 2000, food: 10000, population: 240000, troops: 0, commerce: 40, agriculture: 40, order: 70, training: 50, mapX: 0.5, mapY: 0.5 },
  { id: 'hanzhong', name: '汉中', ownerId: null, governorId: null, gold: 2000, food: 10000, population: 420000, troops: 0, commerce: 40, agriculture: 40, order: 70, training: 50, mapX: 0.5, mapY: 0.5 },
  { id: 'zitong', name: '梓潼', ownerId: null, governorId: null, gold: 2000, food: 10000, population: 300000, troops: 0, commerce: 40, agriculture: 40, order: 70, training: 50, mapX: 0.5, mapY: 0.5 },
  { id: 'jiangzhou', name: '江州', ownerId: null, governorId: null, gold: 2000, food: 10000, population: 320000, troops: 0, commerce: 40, agriculture: 40, order: 70, training: 50, mapX: 0.5, mapY: 0.5 },
  { id: 'chengdu', name: '成都', ownerId: null, governorId: null, gold: 2000, food: 10000, population: 560000, troops: 0, commerce: 40, agriculture: 40, order: 70, training: 50, mapX: 0.5, mapY: 0.5 },
  { id: 'jianning', name: '建宁', ownerId: null, governorId: null, gold: 2000, food: 10000, population: 260000, troops: 0, commerce: 40, agriculture: 40, order: 70, training: 50, mapX: 0.5, mapY: 0.5 },
  { id: 'yunnan', name: '云南', ownerId: null, governorId: null, gold: 2000, food: 10000, population: 200000, troops: 0, commerce: 40, agriculture: 40, order: 70, training: 50, mapX: 0.5, mapY: 0.5 },
];

export const CITY_IDS = citySeeds.map((city) => city.id);

function stats(leadership: number, war: number, intelligence: number, politics: number, charisma: number): Stats {
  return { leadership, war, intelligence, politics, charisma };
}

function aptitudes(
  spear: OfficerAptitudes['spear'],
  halberd: OfficerAptitudes['halberd'],
  crossbow: OfficerAptitudes['crossbow'],
  cavalry: OfficerAptitudes['cavalry'],
  siege: OfficerAptitudes['siege'],
  navy: OfficerAptitudes['navy'],
): OfficerAptitudes {
  return { spear, halberd, crossbow, cavalry, siege, navy };
}

const defaultAptitudes = aptitudes('B', 'B', 'B', 'B', 'C', 'C');
export { defaultAptitudes };

export const officerProfiles: Partial<Record<string, { skill: string; aptitudes: OfficerAptitudes }>> = {
  'cao-cao': { skill: '奸雄', aptitudes: aptitudes('A', 'A', 'A', 'S', 'A', 'B') },
  'cao-ren': { skill: '坚守', aptitudes: aptitudes('A', 'S', 'B', 'A', 'B', 'C') },
  'xun-yu': { skill: '王佐', aptitudes: aptitudes('C', 'C', 'B', 'C', 'A', 'C') },
  'xu-huang': { skill: '沉着', aptitudes: aptitudes('A', 'S', 'B', 'A', 'B', 'C') },
  'xiahou-dun': { skill: '刚将', aptitudes: aptitudes('A', 'A', 'B', 'S', 'C', 'C') },
  'xiahou-yuan': { skill: '急袭', aptitudes: aptitudes('B', 'A', 'S', 'S', 'C', 'C') },
  'zhang-liao': { skill: '威风', aptitudes: aptitudes('A', 'A', 'A', 'S', 'B', 'C') },
  'guo-jia': { skill: '鬼谋', aptitudes: aptitudes('C', 'C', 'A', 'B', 'A', 'C') },
  'liu-bei': { skill: '仁德', aptitudes: aptitudes('A', 'A', 'B', 'B', 'C', 'C') },
  'guan-yu': { skill: '神将', aptitudes: aptitudes('S', 'S', 'B', 'A', 'C', 'C') },
  'zhang-fei': { skill: '斗神', aptitudes: aptitudes('S', 'A', 'B', 'A', 'C', 'C') },
  'zhuge-liang': { skill: '神算', aptitudes: aptitudes('B', 'B', 'A', 'C', 'S', 'B') },
  'jian-yong': { skill: '论客', aptitudes: aptitudes('C', 'C', 'B', 'C', 'C', 'C') },
  'sun-qian': { skill: '能吏', aptitudes: aptitudes('C', 'C', 'B', 'C', 'C', 'C') },
  'chen-dao': { skill: '白毦', aptitudes: aptitudes('A', 'A', 'B', 'A', 'C', 'C') },
  'liao-hua': { skill: '踏破', aptitudes: aptitudes('B', 'A', 'B', 'B', 'C', 'C') },
  'ma-su': { skill: '百出', aptitudes: aptitudes('B', 'C', 'A', 'B', 'A', 'C') },
  'sun-quan': { skill: '明君', aptitudes: aptitudes('B', 'B', 'A', 'B', 'B', 'A') },
  'zhou-yu': { skill: '火神', aptitudes: aptitudes('A', 'B', 'A', 'B', 'S', 'S') },
  'lu-su': { skill: '富豪', aptitudes: aptitudes('B', 'B', 'A', 'C', 'A', 'S') },
  'gan-ning': { skill: '威风', aptitudes: aptitudes('A', 'A', 'A', 'B', 'C', 'S') },
  'taishi-ci': { skill: '弓神', aptitudes: aptitudes('A', 'B', 'S', 'A', 'C', 'A') },
  'lu-meng': { skill: '攻心', aptitudes: aptitudes('A', 'A', 'A', 'B', 'A', 'S') },
  'wen-pin': { skill: '水将', aptitudes: aptitudes('A', 'A', 'B', 'B', 'C', 'A') },
  'zhao-yun': { skill: '洞察', aptitudes: aptitudes('S', 'A', 'A', 'S', 'C', 'C') },
  'pang-tong': { skill: '连环', aptitudes: aptitudes('B', 'C', 'A', 'C', 'S', 'B') },
  'huang-zhong': { skill: '弓神', aptitudes: aptitudes('A', 'B', 'S', 'A', 'C', 'C') },
  'wei-yan': { skill: '猛者', aptitudes: aptitudes('S', 'A', 'B', 'A', 'C', 'C') },
  'ma-liang': { skill: '能吏', aptitudes: aptitudes('C', 'C', 'B', 'C', 'A', 'C') },
  'cai-wenji': { skill: '诗想', aptitudes: aptitudes('C', 'C', 'C', 'B', 'C', 'C') },
  'zhen-ji': { skill: '倾国', aptitudes: aptitudes('C', 'C', 'B', 'C', 'C', 'C') },
  'huang-yueying': { skill: '工神', aptitudes: aptitudes('C', 'C', 'S', 'C', 'S', 'A') },
  'sun-shangxiang': { skill: '弓将', aptitudes: aptitudes('A', 'B', 'S', 'B', 'C', 'C') },
  'xiao-qiao': { skill: '乐奏', aptitudes: aptitudes('C', 'C', 'C', 'C', 'C', 'C') },
  'fan-shi': { skill: '乐奏', aptitudes: aptitudes('C', 'C', 'C', 'C', 'C', 'C') },
};

// 武将性格（义理/野望）：影响季初忠诚波动与挖角难度；未列出的武将取默认 义理55/野望50
export const officerPersonalities: Partial<Record<string, { ambition?: number; righteousness?: number }>> = {
  'xun-yu': { righteousness: 82 },
  'zhang-liao': { righteousness: 74 },
  'guo-jia': { ambition: 66 },
  'guan-yu': { righteousness: 90 },
  'zhang-fei': { righteousness: 82 },
  'zhuge-liang': { righteousness: 86, ambition: 44 },
  'ma-su': { ambition: 68 },
  'gan-ning': { ambition: 76, righteousness: 52 },
  'lu-meng': { ambition: 66, righteousness: 70 },
  'lu-su': { righteousness: 78 },
  'wei-yan': { ambition: 66, righteousness: 60 },
  'mi-fang': { ambition: 72, righteousness: 32 },
};

export const officerSeeds: OfficerSeed[] = [
  { id: 'cao-cao', name: '曹操', forceId: 'cao', cityId: 'wan', stats: stats(96, 72, 91, 94, 96) },
  { id: 'cao-ren', name: '曹仁', forceId: 'cao', cityId: 'xiangyang', stats: stats(89, 86, 71, 62, 75) },
  { id: 'xun-yu', name: '荀彧', forceId: 'cao', cityId: 'wan', stats: stats(52, 14, 95, 98, 92) },
  { id: 'xu-huang', name: '徐晃', forceId: 'cao', cityId: 'xiangyang', stats: stats(91, 90, 78, 63, 78) },
  { id: 'xiahou-dun', name: '夏侯惇', forceId: 'cao', cityId: 'wan', stats: stats(87, 90, 63, 58, 76) },
  { id: 'xiahou-yuan', name: '夏侯渊', forceId: 'cao', cityId: 'wan', stats: stats(86, 91, 61, 52, 72) },
  { id: 'zhang-liao', name: '张辽', forceId: 'cao', cityId: 'xiangyang', stats: stats(93, 92, 78, 58, 82) },
  { id: 'yu-jin', name: '于禁', forceId: 'cao', cityId: 'xiangyang', stats: stats(84, 78, 70, 66, 65) },
  { id: 'yue-jin', name: '乐进', forceId: 'cao', cityId: 'wan', stats: stats(80, 84, 62, 48, 66) },
  { id: 'guo-jia', name: '郭嘉', forceId: 'cao', cityId: 'xiangyang', stats: stats(45, 18, 98, 85, 86) },
  { id: 'cai-wenji', name: '蔡文姬', forceId: 'cao', cityId: 'wan', stats: stats(6, 4, 76, 80, 85), gender: 'female' },
  { id: 'zhen-ji', name: '甄氏', forceId: 'cao', cityId: 'wan', stats: stats(30, 40, 76, 62, 94), gender: 'female' },
  { id: 'liu-bei', name: '刘备', forceId: 'liu', cityId: 'jiangling', stats: stats(78, 75, 78, 80, 99) },
  { id: 'guan-yu', name: '关羽', forceId: 'liu', cityId: 'jiangling', stats: stats(95, 97, 76, 62, 94) },
  { id: 'zhang-fei', name: '张飞', forceId: 'liu', cityId: 'wuling', stats: stats(85, 98, 35, 22, 45) },
  { id: 'zhuge-liang', name: '诸葛亮', forceId: 'liu', cityId: 'wuling', stats: stats(92, 38, 100, 98, 92) },
  { id: 'jian-yong', name: '简雍', forceId: 'liu', cityId: 'jiangling', stats: stats(35, 24, 76, 72, 86) },
  { id: 'sun-qian', name: '孙乾', forceId: 'liu', cityId: 'jiangling', stats: stats(38, 26, 78, 75, 84) },
  { id: 'mi-fang', name: '糜芳', forceId: 'liu', cityId: 'wuling', stats: stats(62, 64, 45, 48, 55) },
  { id: 'chen-dao', name: '陈到', forceId: 'liu', cityId: 'jiangling', stats: stats(82, 86, 62, 48, 70) },
  { id: 'liao-hua', name: '廖化', forceId: 'liu', cityId: 'wuling', stats: stats(74, 78, 58, 45, 64) },
  { id: 'ma-su', name: '马谡', forceId: 'liu', cityId: 'wuling', stats: stats(68, 55, 88, 72, 62) },
  { id: 'gan-shi', name: '甘氏', forceId: 'liu', cityId: 'jiangling', stats: stats(6, 4, 18, 22, 42), gender: 'female' },
  { id: 'huang-yueying', name: '黄月英', forceId: 'liu', cityId: 'wuling', stats: stats(51, 30, 88, 87, 79), gender: 'female' },
  { id: 'sun-quan', name: '孙权', forceId: 'sun', cityId: 'jiangxia', stats: stats(78, 67, 83, 89, 94) },
  { id: 'zhou-yu', name: '周瑜', forceId: 'sun', cityId: 'jiangxia', stats: stats(97, 71, 96, 86, 93) },
  { id: 'lu-su', name: '鲁肃', forceId: 'sun', cityId: 'changsha', stats: stats(78, 56, 92, 94, 91) },
  { id: 'gan-ning', name: '甘宁', forceId: 'sun', cityId: 'changsha', stats: stats(86, 94, 76, 55, 81) },
  { id: 'cheng-pu', name: '程普', forceId: 'sun', cityId: 'jiangxia', stats: stats(84, 82, 72, 66, 78) },
  { id: 'huang-gai', name: '黄盖', forceId: 'sun', cityId: 'jiangxia', stats: stats(82, 85, 69, 58, 75) },
  { id: 'han-dang', name: '韩当', forceId: 'sun', cityId: 'changsha', stats: stats(79, 82, 61, 46, 68) },
  { id: 'taishi-ci', name: '太史慈', forceId: 'sun', cityId: 'jiangxia', stats: stats(88, 93, 70, 50, 82) },
  { id: 'lu-meng', name: '吕蒙', forceId: 'sun', cityId: 'changsha', stats: stats(86, 81, 89, 74, 78) },
  { id: 'ling-tong', name: '凌统', forceId: 'sun', cityId: 'changsha', stats: stats(78, 86, 58, 44, 70) },
  { id: 'sun-shangxiang', name: '孙尚香', forceId: 'sun', cityId: 'jiangxia', stats: stats(69, 83, 64, 45, 83), gender: 'female' },
  { id: 'xiao-qiao', name: '小乔', forceId: 'sun', cityId: 'jiangxia', stats: stats(16, 14, 70, 56, 92), gender: 'female' },
  { id: 'liu-biao', name: '刘表', forceId: 'biao', cityId: 'lingling', stats: stats(67, 42, 69, 83, 84) },
  { id: 'kuai-yue', name: '蒯越', forceId: 'biao', cityId: 'lingling', stats: stats(48, 31, 89, 91, 82) },
  { id: 'cai-mao', name: '蔡瑁', forceId: 'biao', cityId: 'guiyang', stats: stats(75, 68, 72, 73, 58) },
  { id: 'wen-pin', name: '文聘', forceId: 'biao', cityId: 'guiyang', stats: stats(87, 84, 74, 66, 79) },
  { id: 'huang-zu', name: '黄祖', forceId: 'biao', cityId: 'lingling', stats: stats(70, 72, 50, 45, 52) },
  { id: 'zhang-yun', name: '张允', forceId: 'biao', cityId: 'guiyang', stats: stats(68, 66, 58, 55, 50) },
  { id: 'liu-qi', name: '刘琦', forceId: 'biao', cityId: 'lingling', stats: stats(54, 42, 65, 70, 72) },
  { id: 'liu-cong', name: '刘琮', forceId: 'biao', cityId: 'guiyang', stats: stats(42, 28, 60, 68, 62) },
  { id: 'han-song', name: '韩嵩', forceId: 'biao', cityId: 'lingling', stats: stats(36, 20, 82, 86, 76) },
  { id: 'deng-xi', name: '邓羲', forceId: 'biao', cityId: 'guiyang', stats: stats(45, 34, 78, 80, 70) },
  { id: 'cai-shi', name: '蔡氏', forceId: 'biao', cityId: 'lingling', stats: stats(12, 10, 52, 62, 68), gender: 'female' },
  { id: 'fan-shi', name: '樊氏', forceId: 'biao', cityId: 'guiyang', stats: stats(14, 12, 40, 44, 76), gender: 'female' },
  { id: 'zhao-yun', name: '赵云', forceId: null, cityId: 'jiangling', stats: stats(91, 96, 76, 65, 81) },
  { id: 'pang-tong', name: '庞统', forceId: null, cityId: 'xiangyang', stats: stats(78, 36, 98, 92, 69) },
  { id: 'huang-zhong', name: '黄忠', forceId: null, cityId: 'changsha', stats: stats(88, 94, 68, 60, 74) },
  { id: 'wei-yan', name: '魏延', forceId: null, cityId: 'wuling', stats: stats(89, 92, 69, 54, 65) },
  { id: 'ma-liang', name: '马良', forceId: null, cityId: 'jiangling', stats: stats(46, 28, 88, 91, 89) },
  { id: 'jiang-wan', name: '蒋琬', forceId: null, cityId: 'lingling', stats: stats(52, 31, 87, 94, 84) },
  { id: 'yi-ji', name: '伊籍', forceId: null, cityId: 'xiangyang', stats: stats(38, 24, 82, 86, 90) },
  { id: 'mi-zhu', name: '糜竺', forceId: null, cityId: 'guiyang', stats: stats(32, 22, 78, 92, 88) },
];

export const OFFICER_IDS = officerSeeds.map((officer) => officer.id);

/** 剧本起始年份（建安十三年，公元 208 年；month 为局内相对月份） */
export const SCENARIO_START_YEAR = 208;

/**
 * 武将出生年（公元纪年），用于老龄病逝判定。
 * 《三国志》未载生年者采用光荣《三国志》系列的通行推定值。
 */
export const officerBirthYears: Record<string, number> = {
  // 曹操势力
  'cao-cao': 155, 'cao-ren': 168, 'xun-yu': 163, 'xu-huang': 165,
  'xiahou-dun': 157, 'xiahou-yuan': 160, 'zhang-liao': 169, 'yu-jin': 165,
  'yue-jin': 165, 'guo-jia': 170, 'cai-wenji': 177, 'zhen-ji': 183,
  // 刘备势力
  'liu-bei': 161, 'guan-yu': 160, 'zhang-fei': 165, 'zhuge-liang': 181,
  'jian-yong': 163, 'sun-qian': 165, 'mi-fang': 170, 'chen-dao': 175,
  'liao-hua': 185, 'ma-su': 190, 'gan-shi': 185, 'huang-yueying': 186,
  // 孙权势力
  'sun-quan': 182, 'zhou-yu': 175, 'lu-su': 172, 'gan-ning': 172,
  'cheng-pu': 148, 'huang-gai': 150, 'han-dang': 152, 'taishi-ci': 166,
  'lu-meng': 178, 'ling-tong': 189, 'sun-shangxiang': 191, 'xiao-qiao': 178,
  // 刘表势力
  'liu-biao': 142, 'kuai-yue': 155, 'cai-mao': 158, 'wen-pin': 160,
  'huang-zu': 150, 'zhang-yun': 160, 'liu-qi': 172, 'liu-cong': 182,
  'han-song': 150, 'deng-xi': 160, 'cai-shi': 160, 'fan-shi': 165,
  // 在野/人才池
  'zhao-yun': 160, 'pang-tong': 179, 'huang-zhong': 148, 'wei-yan': 172,
  'ma-liang': 187, 'jiang-wan': 193, 'yi-ji': 165, 'mi-zhu': 165,
};

function toRecord<T extends { id: string }>(items: T[]): Record<string, T> {
  return Object.fromEntries(items.map((item) => [item.id, item]));
}

export const FORCE_IDS: ForceId[] = ['cao', 'liu', 'sun', 'biao'];

/** china42x.json 中的城市条目（原版精确坐标 + 原版建设用地坐标） */
export interface China42CityEntry {
  id: string;
  label: string;
  q: number;
  r: number;
  /** 原版建设用地坐标（interior 平面，按距城心由近到远排序） */
  interior?: Array<[number, number]>;
}

export function getChina42Grid(): GridCell[] {
  return (china42Data.grid as { q: number; r: number; terrain: GridCell['terrain'] }[]).map(
    (cell) => ({ q: cell.q, r: cell.r, terrain: cell.terrain }),
  );
}

export function china42CityEntry(cityId: CityId): China42CityEntry {
  const city = (china42Data.cities as China42CityEntry[]).find((c) => c.id === cityId);
  if (!city) throw new Error(`华夏42城中找不到城市: ${cityId}`);
  return city;
}

/** 各城原版建设用地坐标（距城心由近到远），供 initConstructionPlots 与存档迁移使用 */
export function china42InteriorByCityId(): Map<string, Array<{ q: number; r: number }>> {
  return new Map((china42Data.cities as China42CityEntry[]).map((city) => [
    city.id,
    (city.interior ?? []).map(([q, r]) => ({ q, r })),
  ]));
}

/** 原版据点锚点（关所/港口，单格，来自 Scen000.s11 建筑坐标记录） */
export interface StrongholdAnchor {
  id: string;
  label: string;
  q: number;
  r: number;
}

/** 原版 10 关所锚点（地图标记用） */
export function china42Passes(): StrongholdAnchor[] {
  return (china42Data.passes ?? []) as StrongholdAnchor[];
}

/** 原版 35 港口锚点（地图标记用） */
export function china42Ports(): StrongholdAnchor[] {
  return (china42Data.ports ?? []) as StrongholdAnchor[];
}

/** 构建剧本 42 城实体（8 座有主 + 34 座无主），开局与旧存档城市注入共用 */
export function createScenarioCities(): Record<CityId, City> {
  return toRecord(citySeeds.map((city, index) => {
    const center = china42CityEntry(city.id);
    return {
      ...city,
      gridQ: center.q,
      gridR: center.r,
      // 小地图定位直接由原版精确坐标推导（seed 中的 mapX/mapY 仅为类型占位）
      mapX: (center.q + 0.5) / china42Data.width,
      mapY: (center.r + 0.5) / china42Data.height,
      maxDurability: 3000,
      durability: 3000,
      armaments: initialArmaments(),
      // 开局各城粮价在 3~7 之间错落分布
      grainPrice: 3 + (index % 5),
      // 开局商人：商贸城必有，其余按 1/4 错落分布
      merchantPresent: hasCityTrait(city.id, 'commerce') || index % 4 === 2,
    };
  })) as Record<CityId, City>;
}

export function createGame(playerForceId: ForceId, seed = Date.now()): GameState {
  const cities = createScenarioCities();
  const officers = toRecord(officerSeeds.map((officer) => {
    const profile = officerProfiles[officer.id];
    const personality = officerPersonalities[officer.id];
    const force = officer.forceId ? forces[officer.forceId] : undefined;
    return {
      ...officer,
      birthYear: officerBirthYears[officer.id],
      loyalty: officer.forceId === null ? 0 : force?.leaderId === officer.id ? LEADER_INITIAL_LOYALTY : DEFAULT_OFFICER_LOYALTY,
      merit: officer.merit ?? INITIAL_OFFICER_MERIT,
      ambition: personality?.ambition ?? 50,
      righteousness: personality?.righteousness ?? 55,
      location: { kind: officer.forceId === null ? 'unaffiliated' : 'city', cityId: officer.cityId } as Officer['location'],
      stats: { ...officer.stats },
      personality: derivePersonality(officer.stats),
      skill: profile?.skill ?? '无',
      aptitudes: { ...(profile?.aptitudes ?? defaultAptitudes) },
      acted: false,
    };
  }));

  // 开局即按城市数量初始化爵位（不等月末结算，否则首月全体官职被"无爵"锁定）
  const initialForces = structuredClone(forces);
  for (const force of Object.values(initialForces)) {
    const cityCount = Object.values(cities).filter((city) => city.ownerId === force.id).length;
    force.rank = rankForCityCount(cityCount).id;
  }

  const grid = getChina42Grid();
  const state: GameState = {
    schemaVersion: 2,
    scenarioId: 'jingxiang-208',
    seed: seed >>> 0,
    rngCursor: 0,
    month: 1,
    tenDay: 1,
    turnForceId: playerForceId,
    playerForceId,
    phase: 'playing',
    actionPoints: { cao: 80, liu: 80, sun: 80, biao: 80 },
    forces: initialForces,
    cities,
    officers,
    grid,
    gridWidth: china42Data.width,
    gridHeight: china42Data.height,
    units: {},
    // 关隘据点：归属=最近/设定城池的所有者，有主关隘初始 2000 兵/1000 金/10000 粮/枪戟箭马各500
    passes: createScenarioPasses({ cities, grid }),
    // 宝物开局散落于各城，尚未出土
    treasures: toRecord(TREASURES.map((treasure): TreasureState => ({
      id: treasure.id,
      ownerId: null,
      cityId: treasure.initialCityId,
      holderId: null,
    }))),
    battleDamageReports: [],
    cityEffectReports: [],
    logs: [
      {
        id: 'opening',
        month: 1,
        forceId: null,
        message: '建安十三年四月，荆襄各方开始整顿政务。',
      },
    ],
  };
  // 初始化建设用地：按原版 interior 平面位置落位（42 城全覆盖）
  initConstructionPlots(state, china42InteriorByCityId());
  // 开局按城市规模初始化城市人口（15%~20%）与农村人口
  initCityPopulation(state);
  return state;
}
