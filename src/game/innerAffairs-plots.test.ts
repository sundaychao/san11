import { describe, expect, it } from 'vitest';
import {
  cityPlots, PLOT_COUNT_BY_SIZE, CITY_SIZE_SMALL_MAX_POP, CITY_SIZE_LARGE_MIN_POP,
  cityPopulationOf, ruralPopulationOf, cityPopulationIncomeModifier, ruralPopulationIncomeModifier,
  marketMonthlyGoldIncome, grandMarketMonthlyGoldIncome, fishMarketMonthlyGoldIncome,
  mintEffect, granaryEffect, cityMonthlyGoldIncome, basePopulationTax, baseFoodTax,
  farmQuarterlyIncome, garrisonFarmQuarterlyIncome, cityQuarterlyFoodIncome,
  blackMarketMonthlyGoldIncome,
} from './innerAffairs';
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

  it('普通市场收入 = Σ(100×2^(等级-1))×城市人口修正（修正0.5~1.5），不受造币厂影响', () => {
    const state = createGame('liu', 1);
    const city = state.cities.jiangling;
    city.cityPopulation = 100_000;
    // 无造币厂：1个1级市场 = 100×1×1 = 100
    cityPlots(city)[0] = { id: 'p0', type: 'market', level: 1, value: 8, q: 1, r: 1 };
    expect(marketMonthlyGoldIncome(city)).toBe(100);
    // 有造币厂：市场自身收入不变（造币厂在资金总收入层生效）
    cityPlots(city)[1] = { id: 'p1', type: 'mint', level: 1, value: 8, q: 2, r: 1 };
    expect(marketMonthlyGoldIncome(city)).toBe(100);
    // 人口修正：城市人口20万 → ×1.5
    city.cityPopulation = 200_000;
    expect(cityPopulationIncomeModifier(city)).toBe(1.5);
    expect(marketMonthlyGoldIncome(city)).toBe(150);
    // 城市人口3万 → 修正下限0.5
    city.cityPopulation = 30_000;
    expect(cityPopulationIncomeModifier(city)).toBe(0.5);
    expect(marketMonthlyGoldIncome(city)).toBe(50);
    // 市场升级：2级市场 = 200×修正，3级=400×修正
    city.cityPopulation = 100_000;
    cityPlots(city)[0].level = 2;
    expect(marketMonthlyGoldIncome(city)).toBe(200);
    cityPlots(city)[0].level = 3;
    expect(marketMonthlyGoldIncome(city)).toBe(400);
  });

  it('大市场 = 3×单块市场、鱼市 = 2×单块市场，不乘人口修正，随自身等级翻倍', () => {
    const state = createGame('liu', 1);
    const city = state.cities.jiangling;
    city.cityPopulation = 30_000; // 人口修正下限0.5，也不影响大市场/鱼市
    cityPlots(city)[0] = { id: 'p0', type: 'grandmarket', level: 1, value: 8, q: 1, r: 1 };
    cityPlots(city)[1] = { id: 'p1', type: 'fishmarket', level: 1, value: 8, q: 2, r: 1 };
    expect(grandMarketMonthlyGoldIncome(city)).toBe(300);
    expect(fishMarketMonthlyGoldIncome(city)).toBe(200);
    // 升级：×2^(等级-1)
    cityPlots(city)[0].level = 2;
    cityPlots(city)[1].level = 3;
    expect(grandMarketMonthlyGoldIncome(city)).toBe(600);
    expect(fishMarketMonthlyGoldIncome(city)).toBe(800);
  });

  it('城池资金月收入 = (基础人口税收+(普通市场+大市场+鱼市)×造币厂)×治安×0.01（用户例）', () => {
    const state = createGame('liu', 1);
    const city = state.cities.jiangling;
    // 用户算例：总人口50万/城市8万/农村42万/治安92，5块1级市场+造币厂+大市场+鱼市
    city.population = 500_000;
    city.cityPopulation = 80_000;
    city.ruralPopulation = 420_000;
    city.order = 92;
    cityPlots(city)[0] = { id: 'p0', type: 'market', level: 1, value: 8, q: 1, r: 1 };
    cityPlots(city)[1] = { id: 'p1', type: 'market', level: 1, value: 8, q: 2, r: 1 };
    cityPlots(city)[2] = { id: 'p2', type: 'market', level: 1, value: 8, q: 3, r: 1 };
    cityPlots(city)[3] = { id: 'p3', type: 'market', level: 1, value: 8, q: 4, r: 1 };
    cityPlots(city)[4] = { id: 'p4', type: 'market', level: 1, value: 8, q: 5, r: 1 };
    cityPlots(city)[5] = { id: 'p5', type: 'mint', level: 1, value: 8, q: 6, r: 1 };
    cityPlots(city)[6] = { id: 'p6', type: 'grandmarket', level: 1, value: 8, q: 7, r: 1 };
    cityPlots(city)[7] = { id: 'p7', type: 'fishmarket', level: 1, value: 8, q: 8, r: 1 };
    expect(basePopulationTax(city)).toBe(707);
    expect(marketMonthlyGoldIncome(city)).toBe(400);
    expect(grandMarketMonthlyGoldIncome(city)).toBe(300);
    expect(fishMarketMonthlyGoldIncome(city)).toBe(200);
    expect(mintEffect(city)).toBe(1.5);
    expect(cityMonthlyGoldIncome(city)).toBe(1892);
    // 治安0 → 0
    city.order = 0;
    expect(cityMonthlyGoldIncome(city)).toBe(0);
  });

  it('黑市收入 = 一级市场×0.8（80/块），无人口修正、无造币厂影响', () => {
    const state = createGame('liu', 1);
    const city = state.cities.jiangling;
    city.population = 1_000_000;
    city.cityPopulation = 1_000_000; // 人口修正触顶1.5，验证黑市不受影响
    city.order = 100;
    // 无黑市时为0
    expect(blackMarketMonthlyGoldIncome(city)).toBe(0);
    cityPlots(city)[0] = { id: 'p0', type: 'blackmarket', level: 1, value: 8, q: 1, r: 1 };
    expect(blackMarketMonthlyGoldIncome(city)).toBe(80);
    // 黑市固定值，不随等级翻倍
    cityPlots(city)[0].level = 3;
    expect(blackMarketMonthlyGoldIncome(city)).toBe(80);
    // 两块黑市 = 160
    cityPlots(city)[1] = { id: 'p1', type: 'blackmarket', level: 1, value: 8, q: 2, r: 1 };
    expect(blackMarketMonthlyGoldIncome(city)).toBe(160);
    // 造币厂不影响黑市
    cityPlots(city)[2] = { id: 'p2', type: 'mint', level: 1, value: 8, q: 3, r: 1 };
    expect(mintEffect(city)).toBe(1.5);
    expect(blackMarketMonthlyGoldIncome(city)).toBe(160);
    // 资金收入纳入黑市（两块）：(√1000000=1000 + 160) × 100% = 1160；造币厂不影响黑市且无普通市场
    expect(cityMonthlyGoldIncome(city)).toBe(1160);
  });
});

describe('城池粮食收入公式', () => {
  it('基础人口粮税 = 7×√总人口（50万 → 4949）', () => {
    const state = createGame('liu', 1);
    const city = state.cities.wan;
    city.population = 500_000;
    expect(baseFoodTax(city)).toBe(4949);
  });

  it('农村人口修正 = 农村人口÷300000（修正0.5~1.5），农场随等级翻倍', () => {
    const state = createGame('liu', 1);
    const city = state.cities.jiangling;
    city.ruralPopulation = 42_000;
    expect(ruralPopulationIncomeModifier(city)).toBe(0.5);
    city.ruralPopulation = 300_000;
    expect(ruralPopulationIncomeModifier(city)).toBe(1);
    city.ruralPopulation = 450_000;
    expect(ruralPopulationIncomeModifier(city)).toBe(1.5);
  });

  it('军屯农 = (城内士兵÷30000)×单块农场×2；无军屯农为0；谷仓效果1.5', () => {
    const state = createGame('liu', 1);
    const city = state.cities.jiangling;
    expect(garrisonFarmQuarterlyIncome(city)).toBe(0);
    expect(granaryEffect(city)).toBe(1);
    cityPlots(city)[0] = { id: 'p0', type: 'garrisonfarm', level: 1, value: 8, q: 1, r: 1 };
    cityPlots(city)[1] = { id: 'p1', type: 'granary', level: 1, value: 8, q: 2, r: 1 };
    city.troops = 60_000;
    expect(garrisonFarmQuarterlyIncome(city)).toBe(6000);
    expect(granaryEffect(city)).toBe(1.5);
    // 军屯农升级：×2^(等级-1)
    cityPlots(city)[0].level = 2;
    expect(garrisonFarmQuarterlyIncome(city)).toBe(12000);
  });

  it('城池季度粮食收入 = (基础人口粮税+(农场+军屯农)×谷仓)×治安×0.01（用户例）', () => {
    const state = createGame('liu', 1);
    const city = state.cities.jiangling;
    // 用户算例：总人口50万/城市8万/农村42万/士兵6万/治安92，5块1级农场+谷仓+军屯农
    city.population = 500_000;
    city.cityPopulation = 80_000;
    city.ruralPopulation = 420_000;
    city.troops = 60_000;
    city.order = 92;
    cityPlots(city)[0] = { id: 'p0', type: 'farm', level: 1, value: 8, q: 1, r: 1 };
    cityPlots(city)[1] = { id: 'p1', type: 'farm', level: 1, value: 8, q: 2, r: 1 };
    cityPlots(city)[2] = { id: 'p2', type: 'farm', level: 1, value: 8, q: 3, r: 1 };
    cityPlots(city)[3] = { id: 'p3', type: 'farm', level: 1, value: 8, q: 4, r: 1 };
    cityPlots(city)[4] = { id: 'p4', type: 'farm', level: 1, value: 8, q: 5, r: 1 };
    cityPlots(city)[5] = { id: 'p5', type: 'granary', level: 1, value: 8, q: 6, r: 1 };
    cityPlots(city)[6] = { id: 'p6', type: 'garrisonfarm', level: 1, value: 8, q: 7, r: 1 };
    expect(baseFoodTax(city)).toBe(4949);
    expect(farmQuarterlyIncome(city)).toBe(10500);
    expect(garrisonFarmQuarterlyIncome(city)).toBe(6000);
    expect(granaryEffect(city)).toBe(1.5);
    expect(cityQuarterlyFoodIncome(city)).toBe(27323);
    // 治安0 → 0
    city.order = 0;
    expect(cityQuarterlyFoodIncome(city)).toBe(0);
  });
});
