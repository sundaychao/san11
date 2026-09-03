import { describe, expect, it } from 'vitest';
import { cityPlots, PLOT_COUNT_BY_SIZE, CITY_SIZE_SMALL_MAX_POP, CITY_SIZE_LARGE_MIN_POP, cityPopulationOf, ruralPopulationOf, cityPopulationIncomeModifier, marketMonthlyGoldIncome, cityMonthlyGoldIncome } from './innerAffairs';
import { createGame } from './scenario/jingxiang208';

describe('建设用地数量在剧本创建时固定，不随人口波动', () => {
  it('人口跌破大城市阈值时不截断地格（已建设施不消失）', () => {
    const state = createGame('liu', 1);
    const city = Object.values(state.cities).find((c) => c.population >= CITY_SIZE_LARGE_MIN_POP)!;
    const before = cityPlots(city).length;
    // 疫病等事件使人口跌破大城阈值
    city.population = CITY_SIZE_LARGE_MIN_POP - 10_000;
    expect(cityPlots(city).length).toBe(before);
  });

  it('人口涨过大城市阈值时不新增无坐标地格', () => {
    const state = createGame('liu', 1);
    const city = Object.values(state.cities).find((c) =>
      c.population >= CITY_SIZE_LARGE_MIN_POP - 25_000 && c.population < CITY_SIZE_LARGE_MIN_POP,
    )!;
    const before = cityPlots(city).length;
    city.population = CITY_SIZE_LARGE_MIN_POP + 10_000;
    const plots = cityPlots(city);
    expect(plots.length).toBe(before);
    // 所有地格都应有坐标（可在地图上选中）
    expect(plots.every((p) => p.q != null && p.r != null)).toBe(true);
  });

  it('剧本创建时按城市大小分配地格数量', () => {
    const state = createGame('liu', 1);
    for (const city of Object.values(state.cities)) {
      const expected = city.population >= CITY_SIZE_LARGE_MIN_POP
        ? PLOT_COUNT_BY_SIZE.large
        : city.population >= CITY_SIZE_SMALL_MAX_POP ? PLOT_COUNT_BY_SIZE.medium : PLOT_COUNT_BY_SIZE.small;
      const plots = cityPlots(city);
      expect(plots.length).toBe(expected);
      expect(plots.every((p) => p.q != null && p.r != null)).toBe(true);
    }
  });
});

describe('城市人口/农村人口初始化', () => {
  it('开局按规模设置城市人口占比（大城20%、中城约17.5%），且城乡人口之和等于总人口', () => {
    const state = createGame('liu', 1);
    for (const city of Object.values(state.cities)) {
      const ratio = cityPopulationOf(city) / city.population;
      const isLarge = city.population >= CITY_SIZE_LARGE_MIN_POP;
      expect(ratio).toBeGreaterThan(0.149);
      expect(ratio).toBeLessThanOrEqual(isLarge ? 0.2 : 0.18);
      expect(cityPopulationOf(city) + ruralPopulationOf(city)).toBe(city.population);
    }
  });
});

describe('城池资金收入公式', () => {
  it('基础人口税收 = √总人口（100万 → 每月1000）', () => {
    const state = createGame('liu', 1);
    const city = state.cities.wan;
    city.population = 1_000_000;
    // 略过 sqrt floor：1000000 开方恰好 1000
    expect(Math.floor(Math.sqrt(city.population))).toBe(1000);
  });

  it('市场总收入 = 100×市场数×造币厂1.5×人口修正（修正0.5~1.5）', () => {
    const state = createGame('liu', 1);
    const city = state.cities.jiangling;
    city.cityPopulation = 100_000;
    // 无造币厂：1个市场 = 100×1×1 = 100
    cityPlots(city)[0] = { id: 'p0', type: 'market', level: 1, value: 8, q: 1, r: 1 };
    expect(marketMonthlyGoldIncome(city)).toBe(100);
    // 有造币厂：×1.5
    cityPlots(city)[1] = { id: 'p1', type: 'mint', level: 1, value: 8, q: 2, r: 1 };
    expect(marketMonthlyGoldIncome(city)).toBe(150);
    // 人口修正：城市人口20万 → ×1.5
    city.cityPopulation = 200_000;
    expect(cityPopulationIncomeModifier(city)).toBe(1.5);
    expect(marketMonthlyGoldIncome(city)).toBe(225);
    // 城市人口3万 → 修正下限0.5
    city.cityPopulation = 30_000;
    expect(cityPopulationIncomeModifier(city)).toBe(0.5);
    expect(marketMonthlyGoldIncome(city)).toBe(75);
  });

  it('城池资金月收入 = (基础人口税收+市场总收入)×治安×0.01', () => {
    const state = createGame('liu', 1);
    const city = state.cities.jiangling;
    city.population = 1_000_000;
    city.cityPopulation = 100_000;
    city.order = 100;
    cityPlots(city)[0] = { id: 'p0', type: 'market', level: 1, value: 8, q: 1, r: 1 };
    // (√1000000=1000 + 100×1×1=100) × 100% = 1100
    expect(cityMonthlyGoldIncome(city)).toBe(1100);
    // 治安0 → 0
    city.order = 0;
    expect(cityMonthlyGoldIncome(city)).toBe(0);
  });
});
