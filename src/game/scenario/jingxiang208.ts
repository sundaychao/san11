import { CITY_GRID_CENTERS, createBattleGrid } from '../battle/scenario';
import type { City, CityId, Force, ForceId, GameState, Officer, Stats } from '../types';

type CitySeed = Omit<City, 'durability' | 'gridQ' | 'gridR' | 'id' | 'maxDurability'> & { id: CityId };
type OfficerSeed = Omit<Officer, 'acted' | 'location'>;

const forces: Record<ForceId, Force> = {
  cao: {
    id: 'cao',
    name: '曹操',
    leaderId: 'cao-cao',
    color: '#4f9eae',
    description: '据守北境重镇，政务与统率均衡。',
  },
  liu: {
    id: 'liu',
    name: '刘备',
    leaderId: 'liu-bei',
    color: '#d1b943',
    description: '人才出众，以民心和武将能力见长。',
  },
  sun: {
    id: 'sun',
    name: '孙权',
    leaderId: 'sun-quan',
    color: '#c65e51',
    description: '立足江东水网，城市资源较为充裕。',
  },
  biao: {
    id: 'biao',
    name: '刘表',
    leaderId: 'liu-biao',
    color: '#6ba35f',
    description: '深耕荆南，治安稳定且人才待发掘。',
  },
};

export const SCENARIO_FORCES = forces;

const citySeeds: CitySeed[] = [
  { id: 'wan', name: '宛', ownerId: 'cao', governorId: 'cao-cao', gold: 9000, food: 30000, population: 120000, troops: 16000, commerce: 60, agriculture: 45, order: 82, training: 72, mapX: 0.37, mapY: 0.17 },
  { id: 'xiangyang', name: '襄阳', ownerId: 'cao', governorId: 'cao-ren', gold: 8200, food: 34000, population: 115000, troops: 14500, commerce: 52, agriculture: 55, order: 78, training: 68, mapX: 0.25, mapY: 0.42 },
  { id: 'jiangling', name: '江陵', ownerId: 'liu', governorId: 'liu-bei', gold: 7600, food: 38000, population: 95000, troops: 13500, commerce: 48, agriculture: 65, order: 80, training: 72, mapX: 0.47, mapY: 0.53 },
  { id: 'wuling', name: '武陵', ownerId: 'liu', governorId: 'zhang-fei', gold: 6800, food: 32000, population: 85000, troops: 12000, commerce: 42, agriculture: 58, order: 84, training: 66, mapX: 0.15, mapY: 0.68 },
  { id: 'jiangxia', name: '江夏', ownerId: 'sun', governorId: 'sun-quan', gold: 8500, food: 32000, population: 100000, troops: 15000, commerce: 56, agriculture: 52, order: 78, training: 74, mapX: 0.78, mapY: 0.17 },
  { id: 'changsha', name: '长沙', ownerId: 'sun', governorId: 'lu-su', gold: 7300, food: 36000, population: 98000, troops: 13200, commerce: 50, agriculture: 60, order: 82, training: 70, mapX: 0.78, mapY: 0.38 },
  { id: 'lingling', name: '零陵', ownerId: 'biao', governorId: 'liu-biao', gold: 8500, food: 35000, population: 82000, troops: 11000, commerce: 48, agriculture: 62, order: 90, training: 65, mapX: 0.57, mapY: 0.87 },
  { id: 'guiyang', name: '桂阳', ownerId: 'biao', governorId: 'wen-pin', gold: 7100, food: 36000, population: 80000, troops: 11500, commerce: 47, agriculture: 63, order: 88, training: 67, mapX: 0.84, mapY: 0.71 },
];

export const CITY_IDS = citySeeds.map((city) => city.id);

function stats(leadership: number, war: number, intelligence: number, politics: number, charisma: number): Stats {
  return { leadership, war, intelligence, politics, charisma };
}

const officerSeeds: OfficerSeed[] = [
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

function toRecord<T extends { id: string }>(items: T[]): Record<string, T> {
  return Object.fromEntries(items.map((item) => [item.id, item]));
}

export const FORCE_IDS: ForceId[] = ['cao', 'liu', 'sun', 'biao'];

export function createGame(playerForceId: ForceId, seed = Date.now()): GameState {
  const cities = toRecord(citySeeds.map((city) => {
    const center = CITY_GRID_CENTERS[city.id];
    return {
      ...city,
      gridQ: center.q,
      gridR: center.r,
      maxDurability: 3000,
      durability: 3000,
    };
  })) as Record<CityId, City>;
  const officers = toRecord(officerSeeds.map((officer) => ({
    ...officer,
    location: { kind: officer.forceId === null ? 'unaffiliated' : 'city', cityId: officer.cityId } as Officer['location'],
    stats: { ...officer.stats },
    acted: false,
  })));

  return {
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
    forces: structuredClone(forces),
    cities,
    officers,
    grid: createBattleGrid(),
    units: {},
    logs: [
      {
        id: 'opening',
        month: 1,
        forceId: null,
        message: '建安十三年四月，荆襄各方开始整顿政务。',
      },
    ],
  };
}
