import { coordsWithinRange, gridKey, neighborsOf, ringCoordsWithinRange, sevenCellCityFootprint, type GridCoord } from './battle/grid';
import { positionDefinition } from './ranks';
import type { ArmamentType, City, CityId, ForceId, GameState, GridCell, Legion, Officer, TerrainType } from './types';

/** 本地 clamp，避免与 commands.ts 的循环依赖 */
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/**
 * 都市内政扩展（参考《三国志11》原版都市内政界面与委任军团）：
 * - 都市地格设施：在城外的建设用地可建设市场/农场/兵舍等设施并升级
 *   （1级=8 基础值，每升一级翻倍：8/16/32）；
 * - 委任军团：军团长自动管理编制城市，按方针（内政/军备/均衡）每旬自动执行开发/训练/征兵等指令，
 *   不消耗君主行动力；
 * - 军师任命：对外交/流言/登用提供智力加成；
 * - 俘虏处置：登用/释放/处决统一行动力消耗。
 */

export const PLOT_AP_COST = 10;
export const PLOT_GOLD_COST = 300;
export const PLOT_BASE_VALUE = 8;
export const PLOT_LEVEL_MULTIPLIER = 2;
/** 城市设施耐久上限（建成时初始化为满值） */
export const PLOT_MAX_DURABILITY = 500;
export const PLOT_LABELS: Record<string, string> = {
  market: '市场',
  farm: '农场',
  barracks: '兵舍',
  smithy: '工房',
  forge: '锻冶',
  stable: '厩舍',
  shipyard: '造船',
  mint: '造币',
  granary: '谷仓',
  blackmarket: '黑市',
  grandmarket: '大市场',
  fishmarket: '鱼市',
  garrisonfarm: '军屯农',
  hubu: '户部',
  xingbu: '刑部',
  bingbu: '兵部',
  gongbu: '工部',
  libu: '礼部',
  personnel: '吏部',
  taixue: '太学',
  tongqueta: '铜雀台',
  empty: '空地',
};

export const PLOT_DESCRIPTIONS: Record<PlotType, string> = {
  market: '每旬产出金钱，可合并升级',
  farm: '每月产出兵粮，可合并升级',
  barracks: '征兵效率+15%/级，可合并升级',
  smithy: '兵装生产+15%/级',
  forge: '枪/戟/弩生产+15%/级，可合并升级',
  stable: '军马生产+15%/级，可合并升级',
  shipyard: '舰船生产+15%/级',
  mint: '周围市场金钱收入+50%（一城限一）',
  granary: '周围农场粮食收入+50%（一城限一）',
  blackmarket: '每月80金，无加成，每年正月初一自动拆除',
  grandmarket: '每月300金（大城市限一）',
  fishmarket: '每月200金（有港的城限一）',
  garrisonfarm: '按驻军征收兵粮（一城限一）',
  hubu: '户部：人口增长加成',
  xingbu: '刑部：降低叛乱风险',
  bingbu: '兵部：征兵费用降低',
  gongbu: '工部：建设费用降低',
  libu: '礼部：武将忠诚提升',
  personnel: '吏部：探索登用行动力减半',
  taixue: '太学：技巧P获取增加',
  tongqueta: '铜雀台：威名远扬',
};

/** 各设施的建造价格（金） */
export const PLOT_COSTS: Record<PlotType, number> = {
  market: 200,
  farm: 200,
  barracks: 300,
  smithy: 500,
  forge: 300,
  stable: 300,
  shipyard: 500,
  mint: 500,
  granary: 500,
  blackmarket: 50,
  grandmarket: 600,
  fishmarket: 400,
  garrisonfarm: 500,
  hubu: 500,
  xingbu: 500,
  bingbu: 500,
  gongbu: 500,
  libu: 500,
  personnel: 500,
  taixue: 800,
  tongqueta: 1500,
};

/** 获取指定设施的建造价格 */
export function plotCost(facility: PlotType): number {
  return PLOT_COSTS[facility] ?? PLOT_GOLD_COST;
}

export type PlotType = 'market' | 'farm' | 'barracks' | 'smithy' | 'forge' | 'stable' | 'shipyard' | 'mint' | 'granary'
  | 'blackmarket' | 'grandmarket' | 'fishmarket' | 'garrisonfarm'
  | 'hubu' | 'xingbu' | 'bingbu' | 'gongbu' | 'libu' | 'personnel' | 'taixue' | 'tongqueta';

/** 一城限一设施：造币、谷仓、大市场、鱼市、军屯农、六部、太学、铜雀台 */
export const UNIQUE_FACILITIES: readonly PlotType[] = ['mint', 'granary', 'grandmarket', 'fishmarket', 'garrisonfarm',
  'hubu', 'xingbu', 'bingbu', 'gongbu', 'libu', 'personnel', 'taixue', 'tongqueta'];

export const LEGION_AP_COST = 0;
export const STRATEGIST_AP_COST = 0;
export const CAPTIVE_DISPOSE_AP_COST = 10;

/** 城市大小分类（按人口，对应建设用地数量） */
export type CitySize = 'small' | 'medium' | 'large';

/** 小都市人口阈值 */
export const CITY_SIZE_SMALL_MAX_POP = 250_000;
/** 大都市人口阈值 */
export const CITY_SIZE_LARGE_MIN_POP = 500_000;

/** 城市大小对应的建设用地数量（距城8圈外：小城6、中城9、大城12） */
export const PLOT_COUNT_BY_SIZE: Record<CitySize, number> = {
  small: 6,
  medium: 9,
  large: 12,
};

/** 城池金币容纳上限 */
export const CITY_GOLD_CAP = 200_000;
/** 城池兵粮容纳上限 */
export const CITY_FOOD_CAP = 2_000_000;
/** 城池兵力容纳上限（按规模：小城8万、中城10万、大城15万） */
export const CITY_TROOP_CAP_BY_SIZE: Record<CitySize, number> = {
  small: 80_000,
  medium: 100_000,
  large: 150_000,
};
/** 每个无官职武将默认月俸禄（金） */
export const DEFAULT_OFFICER_SALARY = 10;
/** 城内士兵每旬每万人粮食消耗 */
export const CITY_TROOPS_FOOD_PER_TEN_THOUSAND_PER_TEN_DAYS = 500;
/** 城外部队每旬每万人粮食消耗 */
export const UNIT_TROOPS_FOOD_PER_TEN_THOUSAND_PER_TEN_DAYS = 1000;

/** 城池攻击范围（城池外1~3圈）：敌方部队进入此区域时每旬受箭矢攻击 */
export const CITY_ATTACK_RANGE = 3;
/** 建设用地距城池最近圈数（攻击范围外圈 + 6 = 9圈），确保远离城池 */
export const PLOT_MIN_DISTANCE_FROM_CITY = CITY_ATTACK_RANGE + 6;

/** 城池箭矢每回合基础伤害（按城池兵力比例） */
export const CITY_RANGED_BASE_DAMAGE_RATIO = 0.05;

/** 城池本身范围：中心格 + 外面一圈 = 7 格（sevenCellCityFootprint） */
export const CITY_BODY_RANGE = 1;
/** 反击区内圈起点：城池本身范围之外的紧邻一圈 */
export const CITY_ATTACK_MIN = CITY_BODY_RANGE + 1;

/** 获取城池反击区格子（距城心 CITY_ATTACK_MIN~CITY_ATTACK_RANGE 圈，不含城池本身7格） */
export function cityAttackRangeCoords(city: City): GridCoord[] {
  const coords: GridCoord[] = [];
  for (let d = CITY_ATTACK_MIN; d <= CITY_ATTACK_RANGE; d += 1) {
    coords.push(...ringCoordsWithinRange({ q: city.gridQ, r: city.gridR }, d));
  }
  return coords;
}

/** 判断某坐标是否在城池反击区内（距城心 CITY_ATTACK_MIN~CITY_ATTACK_RANGE 圈，不含城池本身7格） */
export function isInCityAttackRange(city: City, q: number, r: number): boolean {
  // 网格使用偶数列偏移坐标（even-q offset），需先转为轴向坐标再算六角格距离
  const toAxialR = (qVal: number, rVal: number) => rVal - Math.floor(qVal / 2);
  const aq = q - city.gridQ;
  const ar = toAxialR(q, r) - toAxialR(city.gridQ, city.gridR);
  // 轴向坐标的六角格距离：( |aq| + |ar| + |aq+ar| ) / 2
  const dist = (Math.abs(aq) + Math.abs(ar) + Math.abs(aq + ar)) / 2;
  return dist >= CITY_ATTACK_MIN && dist <= CITY_ATTACK_RANGE;
}

/** 判断某坐标是否在任意城池的反击区内（用于阻止军事设施/开发设施建造） */
export function isInAnyCityAttackRange(state: GameState, q: number, r: number): boolean {
  return Object.values(state.cities).some((city) => isInCityAttackRange(city, q, r));
}

/**
 * 旬结算：城池箭矢射击 + 封锁检测
 * 对每个城池，如果有敌方部队在攻击范围内，每旬造成箭矢伤害并封锁该城。
 * 返回事件消息数组。
 */
export function settleCityRangedAttack(state: GameState): string[] {
  const events: string[] = [];
  for (const city of Object.values(state.cities)) {
    if (!city.ownerId) continue;
    const attackKeys = new Set(cityAttackRangeCoords(city).map(gridKey));

    // 查找攻击范围内的敌方部队
    const enemyUnitsInRange = Object.values(state.units).filter((unit) => {
      if (!unit.forceId || unit.forceId === city.ownerId) return false;
      return attackKeys.has(gridKey({ q: unit.q, r: unit.r }));
    });

    for (const unit of enemyUnitsInRange) {
      // 箭矢伤害：城池兵力 × 5%，最低100
      const damage = Math.max(100, Math.round(city.troops * CITY_RANGED_BASE_DAMAGE_RATIO));
      unit.troops = Math.max(0, unit.troops - damage);
      state.battleDamageReports ??= [];
      state.battleDamageReports.push({
        id: `city-arrow-${state.month}-${state.tenDay}-${city.id}-${unit.id}-${state.battleDamageReports.length}`,
        unitId: unit.id,
        q: unit.q,
        r: unit.r,
        amount: damage,
        kind: 'attack',
        label: `${city.name}箭矢`,
      });
      events.push(`${city.name}向城外敌军射出箭矢，${damage}士兵被射杀（${state.officers[unit.leaderId]?.name ?? unit.id}部）`);
      if (unit.troops <= 0) {
        delete state.units[unit.id];
        events.push(`${state.officers[unit.leaderId]?.name ?? unit.id}部被${city.name}箭矢全歼`);
      }
    }
  }
  return events;
}

/** 城池是否被敌方封锁（攻击范围内有敌方部队） */
export function isCityBlocked(state: GameState, city: City): boolean {
  if (!city.ownerId) return false;
  const attackKeys = new Set(cityAttackRangeCoords(city).map(gridKey));
  return Object.values(state.units).some(
    (unit) => unit.forceId && unit.forceId !== city.ownerId && attackKeys.has(gridKey({ q: unit.q, r: unit.r })),
  );
}

/** 根据城池状态，返回实际应给予的收入（封锁时为0） */
export function cityIncomeMultiplierByBlockade(state: GameState, city: City): number {
  return isCityBlocked(state, city) ? 0 : 1;
}

/** 根据城池状态，判断是否允许开发建设（封锁时禁止） */
export function canDevelopWhenBlocked(state: GameState, city: City): boolean {
  return !isCityBlocked(state, city);
}

/** 撤销城市设施（不论是否建成）：清空建设中状态或拆除已有设施，恢复为空地 */
export function cancelCityPlot(state: GameState, city: City, plotIndex: number): string {
  const plots = cityPlots(city);
  const plot = plots[plotIndex];
  if (!plot) throw new Error('地格不存在');
  if (plot.type === 'empty' && !plot.constructing) throw new Error('该地格没有设施可撤销');
  const label = plot.constructing
    ? PLOT_LABELS[plot.constructing.facility]
    : plot.type !== 'empty'
      ? PLOT_LABELS[plot.type]
      : '';
  // 撤销建设中的设施时，立即释放负责建设的武将
  if (plot.constructing) {
    const officer = state.officers[plot.constructing.officerId];
    if (officer && officer.location.kind === 'task' && officer.location.task === 'construction') {
      officer.location = { kind: 'city', cityId: city.id };
      officer.cityId = city.id;
      officer.acted = false;
    }
  }
  plot.constructing = undefined;
  plot.type = 'empty';
  plot.level = 0;
  plot.value = 0;
  return `${city.name}的${label}已撤销，建设用地恢复为空地`;
}

/** 指定坐标周围 range 圈（BFS 距离）内是否有敌方部队（用于设施撤销禁用判定） */
export function hasEnemyUnitsNear(state: GameState, friendlyForceId: ForceId, q: number, r: number, range = 2): boolean {
  const seen = new Set<string>([gridKey({ q, r })]);
  let frontier: GridCoord[] = [{ q, r }];
  for (let distance = 1; distance <= range; distance += 1) {
    const nextFrontier: GridCoord[] = [];
    for (const current of frontier) {
      for (const neighbor of neighborsOf(current.q, current.r)) {
        const key = gridKey(neighbor);
        if (seen.has(key)) continue;
        seen.add(key);
        nextFrontier.push(neighbor);
      }
    }
    frontier = nextFrontier;
  }
  return Object.values(state.units).some(
    (unit) => unit.forceId && unit.forceId !== friendlyForceId && seen.has(gridKey({ q: unit.q, r: unit.r })),
  );
}

/** 根据城市人口判断大小（三国志11原版标准） */
export function citySizeOf(city: City): CitySize {
  if (city.population >= CITY_SIZE_LARGE_MIN_POP) return 'large';
  if (city.population >= CITY_SIZE_SMALL_MAX_POP) return 'medium';
  return 'small';
}

/** 各规模城市初始「城市人口」占总人口比例（小城15% / 中城17.5% / 大城20%） */
export const CITY_POPULATION_RATIO_BY_SIZE: Record<CitySize, number> = {
  small: 0.15,
  medium: 0.175,
  large: 0.2,
};

/** 城市人口：旧存档缺失字段时按当前规模占比估算 */
export function cityPopulationOf(city: City): number {
  if (city.cityPopulation != null) return city.cityPopulation;
  return Math.round(city.population * CITY_POPULATION_RATIO_BY_SIZE[citySizeOf(city)]);
}

/** 农村人口：总人口扣除城市人口 */
export function ruralPopulationOf(city: City): number {
  if (city.ruralPopulation != null) return city.ruralPopulation;
  return Math.max(0, city.population - cityPopulationOf(city));
}

/** 开局按规模为每城初始化城市/农村人口（总人口不变，城市人口占15%~20%） */
export function initCityPopulation(state: GameState): void {
  for (const city of Object.values(state.cities)) {
    const cityPopulation = Math.round(city.population * CITY_POPULATION_RATIO_BY_SIZE[citySizeOf(city)]);
    city.cityPopulation = cityPopulation;
    city.ruralPopulation = Math.max(0, city.population - cityPopulation);
  }
}

/** 单块一级市场基础收入（每月）= 100 */
export const MARKET_BASE_INCOME = 100;
/** 单块一级农场基础收入（每季度）= 1500 */
export const FARM_BASE_INCOME = 1500;
/** 大市场 = 单块市场基础收入的 3 倍 */
export const GRAND_MARKET_MULTIPLIER = 3;
/** 鱼市 = 单块市场基础收入的 2 倍 */
export const FISH_MARKET_MULTIPLIER = 2;
/** 黑市 = 单块一级市场基础收入的 0.8 倍（无人口修正、无造币厂影响） */
export const BLACK_MARKET_INCOME_RATIO = 0.8;
/** 造币厂效果 = 1.5（作用于普通市场/大市场/鱼市） */
export const MINT_EFFECT = 1.5;
/** 谷仓效果 = 1.5（作用于农场/军屯农产出） */
export const GRANARY_EFFECT = 1.5;
/** 基础人口粮税系数 = 7（每季度 7×√总人口） */
export const BASE_FOOD_TAX_COEFFICIENT = 7;
/** 农村人口修正基数 = 300000（农村人口÷300000，下限0.5、上限1.5） */
export const RURAL_POPULATION_MODIFIER_BASE = 300_000;
/** 军屯农士兵折算基数：城内每 30000 兵 = 1 份农场产出 */
export const GARRISON_FARM_TROOPS_BASE = 30_000;
/** 军屯农倍率 = 2 */
export const GARRISON_FARM_MULTIPLIER = 2;

/** 据设施等级计算基础产出（1级=base，每升一级×2） */
function facilityBaseIncome(base: number, level?: number): number {
  return base * Math.pow(PLOT_LEVEL_MULTIPLIER, Math.max(0, (level ?? 1) - 1));
}

/** 基础人口税收（每月）= √总人口（如100万人口→每月1000） */
export function basePopulationTax(city: City): number {
  return Math.floor(Math.sqrt(city.population));
}

/** 城市人口收入修正值 = 城市人口÷100000，下限0.5、上限1.5（作用于普通市场） */
export function cityPopulationIncomeModifier(city: City): number {
  return clamp(cityPopulationOf(city) / 100_000, 0.5, 1.5);
}

/** 农村人口修正值 = 农村人口÷300000，下限0.5、上限1.5（作用于普通农场） */
export function ruralPopulationIncomeModifier(city: City): number {
  return clamp(ruralPopulationOf(city) / RURAL_POPULATION_MODIFIER_BASE, 0.5, 1.5);
}

/** 普通市场总收入（每月）= Σ(单块市场等级基础收入) × 城市人口修正值（不受造币厂影响） */
export function marketMonthlyGoldIncome(city: City): number {
  const sum = (city.plots ?? []).reduce((acc, plot) => (
    acc + (plot.type === 'market' ? facilityBaseIncome(MARKET_BASE_INCOME, plot.level) : 0)
  ), 0);
  return Math.round(sum * cityPopulationIncomeModifier(city));
}

/** 大市场收入（每月）= Σ(单块市场等级基础收入×3)，不乘人口修正 */
export function grandMarketMonthlyGoldIncome(city: City): number {
  return (city.plots ?? []).reduce((acc, plot) => (
    acc + (plot.type === 'grandmarket' ? facilityBaseIncome(MARKET_BASE_INCOME, plot.level) * GRAND_MARKET_MULTIPLIER : 0)
  ), 0);
}

/** 鱼市收入（每月）= Σ(单块市场等级基础收入×2)，不乘人口修正 */
export function fishMarketMonthlyGoldIncome(city: City): number {
  return (city.plots ?? []).reduce((acc, plot) => (
    acc + (plot.type === 'fishmarket' ? facilityBaseIncome(MARKET_BASE_INCOME, plot.level) * FISH_MARKET_MULTIPLIER : 0)
  ), 0);
}

/** 造币厂效果：有造币厂为 1.5，否则 1 */
export function mintEffect(city: City): number {
  return (city.plots ?? []).some((plot) => plot.type === 'mint') ? MINT_EFFECT : 1;
}

/** 黑市收入（每月）= Σ(一级市场基础收入×0.8)，无人口修正、无造币厂影响 */
export function blackMarketMonthlyGoldIncome(city: City): number {
  return (city.plots ?? []).reduce((acc, plot) => (
    acc + (plot.type === 'blackmarket' ? MARKET_BASE_INCOME * BLACK_MARKET_INCOME_RATIO : 0)
  ), 0);
}

/** 城池资金月收入 = (基础人口税收 + (普通市场+大市场+鱼市)×造币厂效果 + 黑市收入) × 治安值 × 0.01 */
export function cityMonthlyGoldIncome(city: City): number {
  const markets = (
    marketMonthlyGoldIncome(city) + grandMarketMonthlyGoldIncome(city) + fishMarketMonthlyGoldIncome(city)
  ) * mintEffect(city);
  return Math.round((basePopulationTax(city) + markets + blackMarketMonthlyGoldIncome(city)) * city.order * 0.01);
}

/** 城市应有多少个建设用地（按人口大小） */
export function cityPlotCount(city: City): number {
  return PLOT_COUNT_BY_SIZE[citySizeOf(city)];
}

/** 读取城池地格。
 *  地格数量在剧本创建时（initConstructionPlots）按当时城市大小固定，
 *  之后不随人口波动增减——人口跌破阈值截断会删掉已建设施，
 *  涨过阈值补足的地格没有坐标、地图上无法选中建设。 */
export function cityPlots(city: City) {
  if (!city.plots) city.plots = [];
  return city.plots;
}

/** 建设耗时基数（旬） */
export const CONSTRUCT_BASE_TEN_DAYS = 10;
/** 建设最少耗时（旬） */
export const CONSTRUCT_MIN_TEN_DAYS = 2;
/** 建设武将政治值对耗时的影响系数：政治 100 → 减半时间 */
export function constructTenDaysFor(politics: number): number {
  // 政治 0 → CONSTRUCT_BASE (10旬)，政治 100 → 约 5 旬
  const reduction = (politics / 100) * CONSTRUCT_BASE_TEN_DAYS * 0.5;
  return Math.max(CONSTRUCT_MIN_TEN_DAYS, Math.round(CONSTRUCT_BASE_TEN_DAYS - reduction));
}

/** 从起始格 BFS 扩展，在候选集内选取互相邻接的最多 maxSize 个格子。 */
function growCluster(
  start: GridCoord,
  maxSize: number,
  candidateKeys: Set<string>,
  cellByKey: Map<string, GridCell>,
): GridCoord[] {
  const result: GridCoord[] = [];
  const visited = new Set<string>();
  const queue: GridCoord[] = [start];
  visited.add(gridKey(start));
  while (queue.length > 0 && result.length < maxSize) {
    const current = queue.shift()!;
    result.push(current);
    for (const neighbor of neighborsOf(current.q, current.r)) {
      const key = gridKey(neighbor);
      if (visited.has(key)) continue;
      if (!candidateKeys.has(key)) continue;
      const cell = cellByKey.get(key);
      if (!cell) continue;
      if (cell.terrain === 'water' || cell.terrain === 'mountain' || cell.terrain === 'ferry') continue;
      visited.add(key);
      queue.push(neighbor);
    }
  }
  return result;
}

/** 初始化场景中的建设用地地形和各城地格坐标。
 *  在每城 7 格城址外圈寻找可用的空地（非水/山/他城址），标记为 construction。
 *  为每城按大小分配 4/6/8 个 construction 格，并写入 CityPlot.q/r 坐标。
 *  建设用地距离城池至少 2 圈（不邻接城址），并形成一片互相邻接的区域。 */
export function initConstructionPlots(state: GameState): void {
  const grid = state.grid ?? [];
  const cellByKey = new Map<string, GridCell>();
  for (const cell of grid) cellByKey.set(gridKey(cell), cell);

  // 计算所有城市已占用格子（城址 7 格 footprint）
  const allCityFootprintKeys = new Set<string>();
  for (const city of Object.values(state.cities)) {
    for (const coord of sevenCellCityFootprint({ q: city.gridQ, r: city.gridR })) {
      allCityFootprintKeys.add(gridKey(coord));
    }
  }

  // 先恢复已有的 construction terrain（避免重复标记）
  for (const cell of grid) {
    if (cell.terrain === 'construction') cell.terrain = 'plain';
  }

  // 偏移坐标转轴向坐标的工具函数（用于计算六角格距离）
  const toAxialR = (qVal: number, rVal: number) => rVal - Math.floor(qVal / 2);
  const cityList = Object.values(state.cities);

  // 六角格距离（偏移坐标）
  const hexDistance = (q1: number, r1: number, q2: number, r2: number) => {
    const aq = q1 - q2;
    const ar = toAxialR(q1, r1) - toAxialR(q2, r2);
    return (Math.abs(aq) + Math.abs(ar) + Math.abs(aq + ar)) / 2;
  };

  // 为每城分配 construction 地格
  for (const city of cityList) {
    const footprint = new Set(sevenCellCityFootprint({ q: city.gridQ, r: city.gridR }).map(gridKey));

    // 判断候选格是否以本市为最近城市（避免建设用地落入他城领地）
    const isNearestToThisCity = (coord: GridCoord) => {
      const distToThis = hexDistance(coord.q, coord.r, city.gridQ, city.gridR);
      return !cityList.some((c) => c.id !== city.id && hexDistance(coord.q, coord.r, c.gridQ, c.gridR) < distToThis);
    };

    // 收集候选格：距城心 PLOT_MIN_DISTANCE_FROM_CITY ~ +2 圈（恰好该圈圆环），非水/山/他城址
    const candidates: GridCoord[] = [];
    const seen = new Set<string>();
    for (let distance = PLOT_MIN_DISTANCE_FROM_CITY; distance <= PLOT_MIN_DISTANCE_FROM_CITY + 2; distance += 1) {
      const ring = ringCoordsWithinRange({ q: city.gridQ, r: city.gridR }, distance);
      for (const coord of ring) {
        const key = gridKey(coord);
        if (seen.has(key)) continue;
        seen.add(key);
        if (footprint.has(key)) continue;
        if (allCityFootprintKeys.has(key)) continue;
        const cell = cellByKey.get(key);
        if (!cell) continue;
        if (cell.terrain === 'water' || cell.terrain === 'mountain') continue;
        if (cell.terrain === 'ferry') continue;
        if (cell.terrain === 'construction') continue; // 已被其他城市选中
        if (!isNearestToThisCity(coord)) continue; // 不分配到其他城市的领地
        candidates.push(coord);
      }
    }

    const needed = cityPlotCount(city);
    if (candidates.length < needed) {
      // 候选格不足，向外延伸 3~4 圈补充（同样是恰好某圈的圆环）
      const fallbackStart = PLOT_MIN_DISTANCE_FROM_CITY + 3;
      for (let distance = fallbackStart; distance <= fallbackStart + 2; distance += 1) {
        const ring = ringCoordsWithinRange({ q: city.gridQ, r: city.gridR }, distance);
        for (const coord of ring) {
          const key = gridKey(coord);
          if (seen.has(key)) continue;
          seen.add(key);
          if (footprint.has(key)) continue;
          if (allCityFootprintKeys.has(key)) continue;
          const cell = cellByKey.get(key);
          if (!cell) continue;
          if (cell.terrain === 'water' || cell.terrain === 'mountain') continue;
          if (cell.terrain === 'construction') continue; // 已被其他城市选中
          if (!isNearestToThisCity(coord)) continue; // 不分配到其他城市的领地
          candidates.push(coord);
        }
      }
    }

    // 优先选靠近城心、地形好的候选格作为"起始中心"
    const terrainPriority: Partial<Record<TerrainType, number>> = {
      road: 0, plain: 1, ferry: 2, forest: 3, hill: 4,
    };
    candidates.sort((a, b) => {
      const da = Math.abs(a.q - city.gridQ) + Math.abs(a.r - city.gridR);
      const db = Math.abs(b.q - city.gridQ) + Math.abs(b.r - city.gridR);
      if (da !== db) return da - db;
      const ta = terrainPriority[cellByKey.get(gridKey(a))?.terrain ?? 'plain'] ?? 5;
      const tb = terrainPriority[cellByKey.get(gridKey(b))?.terrain ?? 'plain'] ?? 5;
      return ta - tb;
    });

    // 从最佳起始格开始，BFS 扩展选取互相邻接的 needed 个格子
    const candidateKeys = new Set(candidates.map(gridKey));
    let picked: GridCoord[] = [];
    // 尝试前几个候选作为起点，找到能选出 needed 个邻接格子的
    for (const start of candidates.slice(0, 6)) {
      const cluster = growCluster(start, needed, candidateKeys, cellByKey);
      if (cluster.length >= needed) {
        picked = cluster.slice(0, needed);
        break;
      }
    }
    // 如果 BFS 失败（地形阻隔），回退到直接取前 needed 个候选
    if (picked.length < needed) {
      picked = candidates.slice(0, needed);
    }

    // 标记 grid cell 为 construction
    for (const coord of picked) {
      const cell = cellByKey.get(gridKey(coord));
      if (cell) cell.terrain = 'construction';
    }

    // 初始化 city.plots 并写入坐标
    const plots = city.plots ?? [];
    // 先把旧 plot 上的坐标保存到新 picked 位置
    const newPlots: City['plots'] = [];
    for (let i = 0; i < needed; i += 1) {
      const coord = picked[i];
      const existing = plots[i];
      if (existing) {
        newPlots.push({ ...existing, q: coord?.q, r: coord?.r });
      } else {
        newPlots.push({
          id: `${city.id}-plot-${i}`,
          type: 'empty',
          level: 0,
          value: 0,
          q: coord?.q,
          r: coord?.r,
        });
      }
    }
    city.plots = newPlots;
  }
}

/** 某类型地格的总等级（用于征兵/生产加成） */
export function plotTotalLevel(city: City, type: PlotType): number {
  return (city.plots ?? []).reduce((sum, plot) => sum + (plot.type === type ? plot.level : 0), 0);
}

/** 城市中指定设施的数量（含建设中），用于「一城限一」判断：建设中也占用名额，撤销建设后释放 */
export function plotCountIncludingConstructing(city: City, type: PlotType): number {
  return (city.plots ?? []).reduce(
    (count, plot) => count + (plot.type === type || plot.constructing?.facility === type ? 1 : 0),
    0,
  );
}

/** 城市是否已建成指定设施（至少 1 级） */
export function hasPlotFacility(city: City, type: PlotType): boolean {
  return plotTotalLevel(city, type) > 0;
}

/** 兵装生产所需设施：枪/戟/弩→锻冶，冲车/井阑→工房，军马→厩舍，楼船→造船 */
export const ARMAMENT_FACILITY: Record<ArmamentType, PlotType> = {
  spear: 'forge',
  halberd: 'forge',
  crossbow: 'forge',
  ram: 'smithy',
  tower: 'smithy',
  cavalry: 'stable',
  ship: 'shipyard',
};

/** 生产指定兵装所需的设施名称 */
export function armamentFacilityLabel(armament: ArmamentType): string {
  return PLOT_LABELS[ARMAMENT_FACILITY[armament]];
}

/** 兵舍加成系数：每级兵舍征兵量 +15% */
export function barracksYieldMultiplier(city: City): number {
  return 1 + (plotTotalLevel(city, 'barracks') * 15) / 100;
}

/**
 * 兵装加成系数：按该兵装**所需设施**的等级计算，每级 +15%。
 * 枪/戟/弩取锻冶等级，冲车/井阑取工房等级，军马取厩舍等级，楼船取造船等级。
 * 早先的 smithyYieldMultiplier 固定取工房等级，对枪/戟/弩（实际需要锻冶）无效，故改为按兵装取对应设施。
 */
export function armamentYieldMultiplier(city: City, armamentType: ArmamentType): number {
  return 1 + (plotTotalLevel(city, ARMAMENT_FACILITY[armamentType]) * 15) / 100;
}

/** 据等级计算设施产出（1级=base，每级×系数） */
export function plotValueFor(level: number): number {
  if (level < 1) return 0;
  return PLOT_BASE_VALUE * Math.pow(PLOT_LEVEL_MULTIPLIER, level - 1);
}

/** 校验能否在地格建设设施：地格须为空地（未建设/建设中/已有设施） */
export function canBuildPlot(city: City, plotIndex: number): boolean {
  const plots = cityPlots(city);
  const plot = plots[plotIndex];
  if (!plot) return false;
  return plot.type === 'empty' && plot.level === 0 && !plot.constructing;
}

/** 校验某建设用地是否可被指定城市用来建设（必须为本城、空闲） */
export function canBuildPlotAtCoord(city: City, q: number, r: number): number | null {
  const plots = cityPlots(city);
  for (let i = 0; i < plots.length; i += 1) {
    const p = plots[i];
    if (p.q === q && p.r === r && canBuildPlot(city, i)) return i;
  }
  return null;
}

/** 检查指定坐标是否已被其他城市占用（已建成设施或正在建设） */
export function isPlotOccupiedByOtherCity(state: GameState, cityId: string, q: number, r: number): boolean {
  return Object.values(state.cities).some((c) =>
    c.id !== cityId && (c.plots ?? []).some((p) =>
      p.q === q && p.r === r && (p.type !== 'empty' || p.constructing),
    ),
  );
}

/** 启动建设设施：扣金，设定建设中状态（不立即完成）。返回预计旬数 */
export function startBuildCityPlot(city: City, plotIndex: number, facility: PlotType, officer: Officer): { tenDays: number; message: string } {
  const plots = cityPlots(city);
  const plot = plots[plotIndex];
  if (!plot || !canBuildPlot(city, plotIndex)) throw new Error('该地格无法建设');
  city.gold = Math.max(0, city.gold - plotCost(facility));
  const tenDays = constructTenDaysFor(officer.stats.politics);
  plot.constructing = {
    facility,
    officerId: officer.id,
    remainingTenDays: tenDays,
  };
  // 建设启动即拥有满耐久（建设中也可悬停查看耐久值）
  plot.durability = PLOT_MAX_DURABILITY;
  // 建设期间武将进入任务状态，整个工期被占用（无法执行其他命令）
  officer.location = { kind: 'task', cityId: city.id, task: 'construction', facility, plotIndex, remainingTenDays: tenDays };
  return { tenDays, message: `${officer.name}在${city.name}选定${PLOT_LABELS[facility]}建设，预计 ${tenDays} 旬完成（政治 ${officer.stats.politics}）` };
}

/** 每旬推进所有城市地格建设进度。返回完成信息数组 */
export function settlePlotConstruction(state: GameState): string[] {
  const completed: string[] = [];
  for (const city of Object.values(state.cities)) {
    const plots = city.plots;
    if (!plots) continue;
    for (const plot of plots) {
      if (!plot.constructing) continue;
      plot.constructing.remainingTenDays -= 1;
      if (plot.constructing.remainingTenDays <= 0) {
        const facility = plot.constructing.facility;
        const officerId = plot.constructing.officerId;
        plot.constructing = undefined;
        plot.type = facility;
        plot.level = 1;
        plot.value = plotValueFor(1);
        plot.durability = PLOT_MAX_DURABILITY;
        // 建设完成：释放武将回城（若仍处于建设任务状态）
        const officer = state.officers[officerId];
        if (officer && officer.location.kind === 'task' && officer.location.task === 'construction') {
          officer.location = { kind: 'city', cityId: city.id };
          officer.cityId = city.id;
          officer.acted = false;
        }
        completed.push(`${city.name}的${PLOT_LABELS[facility]}建设完成`);
      }
    }
  }
  return completed;
}

/** 旧兼容接口：同步完成 construction（用于直接建设）。当前实现为异步建设，此函数保留但调用 startBuildCityPlot 的同步完成路径（供测试/军团自动用） */
export function buildCityPlot(state: GameState, city: City, plotIndex: number, facility: PlotType, officer: Officer): string {
  const result = startBuildCityPlot(city, plotIndex, facility, officer);
  // 同步立即完成（兼容旧调用处）
  const plots = cityPlots(city);
  const plot = plots[plotIndex];
  if (plot?.constructing) {
    plot.type = facility;
    plot.level = 1;
    plot.value = plotValueFor(1);
    plot.durability = PLOT_MAX_DURABILITY;
    plot.constructing = undefined;
  }
  // 同步完成路径：武将无需占用工期，立即恢复待命
  if (officer.location.kind === 'task' && officer.location.task === 'construction') {
    officer.location = { kind: 'city', cityId: city.id };
    officer.cityId = city.id;
    officer.acted = false;
  }
  void state;
  return `${officer.name}在${city.name}修建了${PLOT_LABELS[facility]}`;
}

/** 基础人口粮税（每季度）= 7 × √总人口（如500万总人口→7×√500000≈4949） */
export function baseFoodTax(city: City): number {
  return Math.floor(BASE_FOOD_TAX_COEFFICIENT * Math.sqrt(city.population));
}

/** 城池兵力容纳上限（按规模） */
export function cityTroopCap(city: City): number {
  return CITY_TROOP_CAP_BY_SIZE[citySizeOf(city)];
}

/** 普通农场总产出（每季度）= Σ(单块农场等级基础收入) × 农村人口修正值 */
export function farmQuarterlyIncome(city: City): number {
  const sum = (city.plots ?? []).reduce((acc, plot) => (
    acc + (plot.type === 'farm' ? facilityBaseIncome(FARM_BASE_INCOME, plot.level) : 0)
  ), 0);
  return Math.round(sum * ruralPopulationIncomeModifier(city));
}

/** 军屯农产出（每季度）= (城内士兵数÷30000) × 单块农场等级基础收入 × 2 */
export function garrisonFarmQuarterlyIncome(city: City): number {
  const plot = (city.plots ?? []).find((p) => p.type === 'garrisonfarm');
  if (!plot) return 0;
  const base = facilityBaseIncome(FARM_BASE_INCOME, plot.level);
  return Math.round((city.troops / GARRISON_FARM_TROOPS_BASE) * base * GARRISON_FARM_MULTIPLIER);
}

/** 谷仓效果：有谷仓为 1.5，否则 1 */
export function granaryEffect(city: City): number {
  return (city.plots ?? []).some((plot) => plot.type === 'granary') ? GRANARY_EFFECT : 1;
}

/** 城池季度粮食总收入 = (基础人口粮税 + (农场总产出 + 军屯农产出)×谷仓效果) × 治安值 × 0.01 */
export function cityQuarterlyFoodIncome(city: City): number {
  const farms = (
    farmQuarterlyIncome(city) + garrisonFarmQuarterlyIncome(city)
  ) * granaryEffect(city);
  return Math.round((baseFoodTax(city) + farms) * city.order * 0.01);
}

/** 城池下季度预估兵粮支出（9 旬合计：仅城内驻军消耗；
 *  城外部队的粮由出征时预支进 unit.food，不扣城粮，因此不计入） */
export function cityNextQuarterFoodExpense(state: GameState, city: City): number {
  void state; // 保留签名一致性，便于未来扩展（如部队回城补粮场景）
  // 城内驻军：每万人每旬 500 × 9 旬 = 每季度 4500 / 万
  return Math.max(0, Math.ceil((city.troops * CITY_TROOPS_FOOD_PER_TEN_THOUSAND_PER_TEN_DAYS) / 10_000) * 9);
}

/** 该城所有武将的月俸禄合计（只要所属城为该城且归属势力，均计入；无官职按 DEFAULT_OFFICER_SALARY=10 金/月） */
export function cityMonthlyOfficerSalary(state: GameState, city: City): number {
  if (!city.ownerId) return 0;
  let total = 0;
  for (const officer of Object.values(state.officers)) {
    if (officer.forceId !== city.ownerId) continue;
    if (officer.cityId !== city.id) continue;
    if (officer.positionId) {
      const pos = positionDefinition(officer.positionId);
      total += pos?.salary ?? DEFAULT_OFFICER_SALARY;
    } else {
      total += DEFAULT_OFFICER_SALARY;
    }
  }
  return total;
}

/** 城池下个月净资金（收入 - 俸禄开支，供界面预估用，不含其他随机开支） */
export function cityNextMonthNetGold(state: GameState, city: City): number {
  const income = cityMonthlyGoldIncome(city);
  const salary = cityMonthlyOfficerSalary(state, city);
  return income - salary;
}

/** 城池下季度预估总粮收入 = 季度粮食总收入（供界面预估，包含治安与谷仓效果） */
export function cityNextQuarterFoodIncome(city: City): number {
  return cityQuarterlyFoodIncome(city);
}

// ==================== 委任军团 ====================

export const LEGION_LABELS: Record<Legion['policy'], string> = {
  civil: '内政优先',
  military: '军备优先',
  balanced: '均衡发展',
};

/** 某势力的全部军团 */
export function legionsOf(state: GameState, forceId: string): Legion[] {
  return Object.values(state.forces[forceId as ForceId]?.legions ?? {});
}

/** 包含指定城市的军团（供解散/迁移查找） */
export function legionContaining(state: GameState, forceId: string, cityId: CityId): Legion | undefined {
  return legionsOf(state, forceId).find((legion) => legion.cityIds.includes(cityId));
}

export interface LegionChange {
  legion?: Legion;
  message: string;
}

/**
 * 执行军团指令：
 * - commanderId 为 null → 解散包含 targetCityId 的军团（该城市回归君主直辖）；
 * - 否则创建/更新军团：军团长不变则并入 targetCityId，否则新建军团。
 *   方针 policy 一并写入。
 */
export function applyLegionCommand(
  state: GameState,
  forceId: string,
  commanderId: string | null,
  targetCityId: CityId | null,
  policy: Legion['policy'],
): LegionChange {
  const force = state.forces[forceId as ForceId];
  if (!force) throw new Error('势力不存在');
  const legions: Record<string, Legion> = force.legions ?? {};

  if (commanderId === null) {
    if (!targetCityId) throw new Error('缺少解散目标');
    const found = legionContaining(state, forceId, targetCityId);
    if (!found) return { message: '该城市不属于任何军团' };
    const { [found.id]: _removed, ...rest } = legions;
    force.legions = rest;
    return { message: `解散了${force.name}军团，${state.cities[targetCityId].name}回归直辖` };
  }

  const commander = state.officers[commanderId];
  if (!commander || commander.forceId !== (forceId as ForceId)) throw new Error('军团长必须是己方武将');

  const existing = Object.values(legions).find((legion) => legion.commanderId === commanderId);
  let legion: Legion;
  if (existing) {
    const cityIds = [...new Set(existing.cityIds)];
    if (targetCityId && !cityIds.includes(targetCityId)) cityIds.push(targetCityId);
    if (!targetCityId && existing.cityIds.length === 0) throw new Error('军团无可编制城市');
    legion = { ...existing, cityIds, policy };
    legions[existing.id] = legion;
  } else {
    if (!targetCityId) throw new Error('新建军团须指定城市');
    // 城市若已在其它军团中，先移出
    const found = legionContaining(state, forceId, targetCityId);
    if (found) {
      const updated = { ...found, cityIds: found.cityIds.filter((cityId) => cityId !== targetCityId), policy };
      if (updated.cityIds.length === 0) {
        const { [updated.id]: _removed, ...rest } = legions;
        Object.assign(legions, rest);
      } else {
        legions[updated.id] = updated;
      }
    }
    legion = {
      id: `legion-${commanderId}-${Object.keys(legions).length}`,
      commanderId,
      cityIds: [targetCityId],
      policy,
    };
    legions[legion.id] = legion;
  }
  force.legions = legions;
  return { legion, message: `委任${commander.name}管理${legion.cityIds.map((id) => state.cities[id].name).join('、')}（${LEGION_LABELS[policy]}）` };
}

/**
 * 每旬军团自动执行：
 * 对每个军团，在其编制城市中挑选一名「在本城待命且未行动」的武将，按方针执行内政动作：
 * - 内政优先：开发（商业/农业轮流）；
 * - 军备优先：训练 > 征兵 > 生产兵装；
 * - 均衡：按城市缺额（治安/训练/人口）选择。
 * 消耗城市资源与本城武将（不消耗君主行动力）。
 * 返回本旬执行的事件描述数组。
 */
export function settleLegionAutomation(state: GameState): string[] {
  const events: string[] = [];
  for (const force of Object.values(state.forces)) {
    const legions = force.legions ?? {};
    for (const legion of Object.values(legions)) {
      const commander = state.officers[legion.commanderId];
      if (!commander) continue;
      for (const cityId of legion.cityIds) {
        const city = state.cities[cityId];
        if (!city || city.ownerId !== force.id) continue;
        // 军团长本人（本城待命）优先，其次本城未行动的其它武将
        const executor = commander.location.kind === 'city' && commander.location.cityId === cityId && !commander.acted
          ? commander
          : Object.values(state.officers).find(
              (officer) => officer.forceId === force.id && officer.location.kind === 'city'
                && officer.location.cityId === cityId && !officer.acted && officer.id !== force.leaderId,
            );
        if (!executor) continue;

        const action = pickLegionAction(legion.policy, city);
        const performed = runLegionAction(state, city, executor, action);
        if (performed) events.push(`【${state.cities[cityId].name}·委任】${performed}`);
      }
    }
  }
  return events;
}

type LegionAction = 'developCommerce' | 'developAgriculture' | 'train' | 'recruit' | 'patrol' | 'produceSpear';

function pickLegionAction(policy: Legion['policy'], city: City): LegionAction {
  if (policy === 'civil') {
    return city.commerce < city.agriculture ? 'developCommerce' : 'developAgriculture';
  }
  if (policy === 'military') {
    if (city.training < 70) return 'train';
    if (city.population >= 500 && city.food >= 800) return 'recruit';
    return 'produceSpear';
  }
  // 均衡：优先治安/训练，再补商业农业
  if (city.order < 75) return 'patrol';
  if (city.training < 60) return 'train';
  return (city.commerce + city.agriculture) / 2 < city.agriculture ? 'developCommerce' : 'developAgriculture';
}

function runLegionAction(state: GameState, city: City, officer: Officer, action: LegionAction): string | null {
  const gain = (base: number) => Math.max(1, Math.round(base));
  switch (action) {
    case 'developCommerce': {
      if (city.gold < 500) return null;
      city.gold -= 500;
      city.commerce = clamp(city.commerce + gain(4 + Math.floor(officer.stats.politics / 20)), 0, 100);
      officer.acted = true;
      return `${officer.name}开发商业 ${city.commerce}`;
    }
    case 'developAgriculture': {
      if (city.gold < 500) return null;
      city.gold -= 500;
      city.agriculture = clamp(city.agriculture + gain(4 + Math.floor(officer.stats.politics / 20)), 0, 100);
      officer.acted = true;
      return `${officer.name}开发农业 ${city.agriculture}`;
    }
    case 'train': {
      if (city.food < 300) return null;
      city.food -= 300;
      city.training = clamp(city.training + gain(5 + Math.floor(officer.stats.leadership / 20)), 0, 100);
      officer.acted = true;
      return `${officer.name}训练守军`;
    }
    case 'recruit': {
      if (city.gold < 800 || city.food < 500 || city.population < 500) return null;
      city.gold -= 800;
      city.food -= 500;
      city.population -= 500;
      const gained = gain((300 + officer.stats.charisma * 10) * barracksYieldMultiplier(city));
      city.troops += gained;
      city.order = clamp(city.order - 2, 0, 100);
      officer.acted = true;
      return `${officer.name}征募士兵${gained}`;
    }
    case 'patrol': {
      const cost = Math.max(1, Math.ceil((city.population / 100_000) * 50));
      if (city.gold < cost) return null;
      city.gold -= cost;
      city.order = clamp(city.order + gain(4 + Math.floor(officer.stats.charisma / 20)), 0, 100);
      officer.acted = true;
      return `${officer.name}巡察安抚百姓`;
    }
    case 'produceSpear': {
      if (city.gold < 300) return null;
      city.gold -= 300;
      const current = city.armaments?.spear ?? 0;
      const armaments = city.armaments ?? { spear: 0, halberd: 0, crossbow: 0, cavalry: 0, ram: 0, tower: 0, ship: 0 };
      city.armaments = { ...armaments, spear: current + gain(120 + officer.stats.war) };
      officer.acted = true;
      return `${officer.name}生产枪兵`;
    }
    default:
      return null;
  }
}