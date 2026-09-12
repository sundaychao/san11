import type { CityId } from './types';

/** 城池特性（一城可多个）：影响内政/军事规则 */
export type CityTrait =
  | 'waterPort' // 水港：可建造造船厂
  | 'commerce' // 商贸：商人100%到访
  | 'craftsman' // 匠造：锻冶产量+50%
  | 'ranch' // 畜牧：厩舍产量+200%
  | 'academy' // 学术：可建太学，人口技巧P+50%
  | 'valor' // 劲勇：新征士兵士气按势力最大士气计算
  | 'fortress' // 要塞：本方据点与工事伤害+50%
  | 'wilderness'; // 蛮荒：领土上敌方部队每旬士气-2

/** 城池特色（一城仅一个）：兵装生产价格折扣 */
export type CitySpecialty = 'metropolis' | 'spear' | 'halberd' | 'cavalry' | 'arrow' | 'ship' | 'siege';

export const CITY_TRAIT_LABELS: Record<CityTrait, string> = {
  waterPort: '水港',
  commerce: '商贸',
  craftsman: '匠造',
  ranch: '畜牧',
  academy: '学术',
  valor: '劲勇',
  fortress: '要塞',
  wilderness: '蛮荒',
};

export const CITY_SPECIALTY_LABELS: Record<CitySpecialty, string> = {
  metropolis: '大都市',
  spear: '枪',
  halberd: '戟',
  cavalry: '马',
  arrow: '箭矢',
  ship: '舰船',
  siege: '攻城器',
};

/** 特色图标字形（与地图兵种/设施模型同风格的汉字字形） */
export const CITY_SPECIALTY_GLYPHS: Record<CitySpecialty, string> = {
  metropolis: '都',
  spear: '枪',
  halberd: '戟',
  cavalry: '马',
  arrow: '矢',
  ship: '船',
  siege: '械',
};

export const CITY_SPECIALTY_DESCRIPTIONS: Record<CitySpecialty, string> = {
  metropolis: '大都市：生产所有兵器价格为原来的60%',
  spear: '枪特色：生产枪价格为原来的60%',
  halberd: '戟特色：生产戟价格为原来的60%',
  cavalry: '马特色：生产军马价格为原来的60%',
  arrow: '箭矢特色：生产弩价格为原来的60%',
  ship: '舰船特色：生产楼船价格为原来的60%',
  siege: '攻城器特色：生产冲车/井阑价格为原来的60%',
};

export const CITY_TRAIT_DESCRIPTIONS: Record<CityTrait, string> = {
  waterPort: '水港：可以建造造船厂以生产大型舰船',
  commerce: '商贸：商人100%到访（非商贸城25%概率）',
  craftsman: '匠造：锻冶厂产量+50%',
  ranch: '畜牧：厩舍产量+200%',
  academy: '学术：可以建造太学，人口产生的技巧值+50%',
  valor: '劲勇：新征士兵的士气以势力最大士气值计算',
  fortress: '要塞：本方据点与工事之伤害+50%',
  wilderness: '蛮荒：领土上之敌方部队每旬士气-2',
};

/** 特性归属城市（静态表，不随存档变化） */
const TRAIT_CITIES: Record<CityTrait, readonly string[]> = {
  waterPort: ['jianye', 'lujiang', 'beihai', 'chaisang', 'jiangling', 'changsha', 'xiapi'],
  commerce: ['luoyang', 'changan', 'chengdu', 'jianye', 'ye', 'xiangyang', 'wuwei', 'beihai', 'jiangling'],
  craftsman: ['luoyang', 'lujiang', 'wu', 'beihai', 'xuchang', 'hanzhong', 'nanpi'],
  ranch: ['wuwei', 'anding', 'jinyang', 'ji', 'beiping', 'xiangping'],
  academy: ['luoyang', 'jianye', 'jiangling', 'ye', 'chengdu', 'puyang'],
  valor: ['wuwei', 'anding', 'zitong', 'yongan', 'wuling', 'shangyong', 'pingyuan'],
  fortress: ['xiangyang', 'shouchun', 'chenliu', 'jiangzhou', 'xiaopei', 'runan', 'xinye', 'jiangxia'],
  wilderness: ['yunnan', 'jianning', 'kuaiji', 'wuwei', 'anding', 'tianshui', 'guiyang', 'lingling'],
};

/** 特色归属城市（每城仅一个特色） */
const SPECIALTY_CITIES: Record<CitySpecialty, readonly string[]> = {
  metropolis: ['luoyang', 'changan', 'chengdu', 'ye', 'jianye'],
  spear: ['lujiang', 'wu', 'beihai', 'xuchang', 'hanzhong', 'nanpi'],
  halberd: ['shouchun', 'chenliu', 'jiangzhou', 'xiaopei', 'runan', 'xinye', 'jiangxia'],
  cavalry: ['wuwei', 'anding', 'jinyang', 'ji', 'beiping', 'xiangping'],
  arrow: ['xiangyang', 'jiangling'],
  ship: ['chaisang', 'changsha', 'xiapi', 'kuaiji'],
  siege: ['wan', 'puyang', 'shangyong', 'tianshui'],
};

const TRAITS_BY_CITY = new Map<string, CityTrait[]>();
for (const [trait, cities] of Object.entries(TRAIT_CITIES) as Array<[CityTrait, readonly string[]]>) {
  for (const cityId of cities) {
    const list = TRAITS_BY_CITY.get(cityId) ?? [];
    list.push(trait);
    TRAITS_BY_CITY.set(cityId, list);
  }
}

const SPECIALTY_BY_CITY = new Map<string, CitySpecialty>();
for (const [specialty, cities] of Object.entries(SPECIALTY_CITIES) as Array<[CitySpecialty, readonly string[]]>) {
  for (const cityId of cities) SPECIALTY_BY_CITY.set(cityId, specialty);
}

/** 城池拥有的全部特性（编辑器地图等未知城市返回空） */
export function cityTraitsOf(cityId: string): CityTrait[] {
  return TRAITS_BY_CITY.get(cityId) ?? [];
}

/** 城池特色（无特色或未知城市返回 undefined） */
export function citySpecialtyOf(cityId: string): CitySpecialty | undefined {
  return SPECIALTY_BY_CITY.get(cityId);
}

export function hasCityTrait(cityId: string, trait: CityTrait): boolean {
  return cityTraitsOf(cityId).includes(trait);
}

/** 势力全部城池中的最大士气（劲勇：新征士兵按此值计入） */
export function forceMaxTraining(cityIds: Iterable<string>, cities: Record<string, { training: number }>): number {
  let max = 0;
  for (const id of cityIds) {
    const city = cities[id];
    if (city) max = Math.max(max, city.training);
  }
  return max;
}

/** 该城是否可建设指定设施（水港限定造船厂、学术限定太学） */
export function cityCanBuildFacility(cityId: string, facility: string): boolean {
  if (facility === 'shipyard' && !hasCityTrait(cityId, 'waterPort')) return false;
  if (facility === 'taixue' && !hasCityTrait(cityId, 'academy')) return false;
  return true;
}

export type { CityId };
