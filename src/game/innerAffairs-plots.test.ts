import { describe, expect, it } from 'vitest';
import {
  cityPlots, CITY_SIZE_SMALL_MAX_POP, CITY_SIZE_LARGE_MIN_POP,
  cityPopulationOf, ruralPopulationOf, cityPopulationIncomeModifier, ruralPopulationIncomeModifier,
  marketMonthlyGoldIncome, grandMarketMonthlyGoldIncome, fishMarketMonthlyGoldIncome,
  mintEffect, granaryEffect, cityMonthlyGoldIncome, basePopulationTax, baseFoodTax,
  farmQuarterlyIncome, garrisonFarmQuarterlyIncome, cityQuarterlyFoodIncome,
  blackMarketMonthlyGoldIncome, defaultOfficersFor, constructTenDaysForOfficers,
} from './innerAffairs';
import type { Officer } from './types';
import { createGame, china42InteriorByCityId } from './scenario/jingxiang208';

/** 快速生成 N 个可插入 useMemo 推荐的伪武将（politics/intelligence/war/leadership/charisma 指定） */
function mockOfficers(defs: Array<{ id: string; war?: number; leadership?: number; intelligence?: number; politics?: number; charisma?: number }>): Officer[] {
  const base = createGame('liu', 1).officers['liu-bei'];
  return defs.map((def) => ({
    ...base,
    id: def.id,
    name: def.id,
    stats: {
      ...base.stats,
      war: def.war ?? 50,
      leadership: def.leadership ?? 50,
      intelligence: def.intelligence ?? 50,
      politics: def.politics ?? 50,
      charisma: def.charisma ?? 50,
    },
  }));
}

describe('defaultOfficersFor 按效果自动推荐 1~3 人，饱和后停止增加', () => {
  it('征兵（魅力等权重永不饱和）：直接取前3高魅', () => {
    const state = createGame('liu', 1);
    const officers = mockOfficers([
      { id: 'c99', charisma: 99 }, { id: 'c90', charisma: 90 }, { id: 'c80', charisma: 80 }, { id: 'c40', charisma: 40 },
    ]);
    const picks = defaultOfficersFor(state.cities.jiangling, officers, { type: 'recruit' });
    expect(picks).toEqual(['c99', 'c90', 'c80']);
  });

  it('巡查：治安 100 或增益不提升时停止', () => {
    const state = createGame('liu', 1);
    state.cities.jiangling.order = 99; // 距离100差1，统28+2就够，第2人开始收益已饱和
    const officers = mockOfficers([
      { id: 'l90', leadership: 90 }, { id: 'l80', leadership: 80 }, { id: 'l40', leadership: 40 },
    ]);
    const picks = defaultOfficersFor(state.cities.jiangling, officers, { type: 'patrol' });
    // 90÷28+2 = 5.214 → 实际只需要 1 治安增量（clamp 到 1），加第 2 人无增益 → 停在 1 人
    expect(picks.length).toBe(1);
    expect(picks[0]).toBe('l90');
    expect(constructTenDaysForOfficers.length).toBeGreaterThan(0);
  });

  it('训练：士气满 100 时 1 人足够', () => {
    const state = createGame('liu', 1);
    state.cities.jiangling.training = 99;
    state.cities.jiangling.troops = 15000;
    const officers = mockOfficers([
      { id: 'w99', war: 99 }, { id: 'w97', war: 97 }, { id: 'w90', war: 90 },
    ]);
    const picks = defaultOfficersFor(state.cities.jiangling, officers, { type: 'train' });
    // 关羽99: 武总和+武最大=99+99=198 / (15000/2000+20=27.5) + 3 ≈ 10
    // 只需要 +1 士气就能到100，第2人增益为 0 → 停止，推荐1人
    expect(picks.length).toBe(1);
  });

  it('开发建设：第2/3人加入是否增益取决于政治÷3分数值', () => {
    const state = createGame('liu', 1);
    // 3人极端悬殊：主政100、副政 3 和 3 → 综合政 = 100 + (3+3)/3 = 102
    // 对比 1 人情况 = 100。两者工期是否差一个台阶需验证
    const officers = mockOfficers([
      { id: 'p100', politics: 100 }, { id: 'p3a', politics: 3 }, { id: 'p3b', politics: 3 },
    ]);
    const picks = defaultOfficersFor(state.cities.jiangling, officers, { type: 'buildFacilityPlot' });
    // 102 vs 100：每旬建设量= 102×1.5 = 153 vs 100×1.5 = 150（都远超 250）
    // 若工期在 1 旬封顶，推荐 1 人即止；否则人数会增加
    expect(['p100']).toContain(picks[0]);
    expect(picks.length).toBeGreaterThanOrEqual(1);
    expect(picks.length).toBeLessThanOrEqual(3);
  });

  it('研究：按分支属性取相关能力，最多3人', () => {
    const state = createGame('liu', 1);
    const officers = mockOfficers([
      { id: 's90', politics: 50, leadership: 90 },
      { id: 's80', politics: 50, leadership: 80 },
      { id: 's40', politics: 50, leadership: 40 },
    ]);
    // 枪兵方向使用统率
    const picks = defaultOfficersFor(state.cities.jiangling, officers, { type: 'research', branch: 'spear' });
    expect(picks).toEqual(['s90', 's80', 's40']);
  });

  it('兵装：生产弩（即时产量永不饱和，智高取前3）', () => {
    const state = createGame('liu', 1);
    const officers = mockOfficers([
      { id: 'i99', intelligence: 99 }, { id: 'i95', intelligence: 95 }, { id: 'i85', intelligence: 85 }, { id: 'i50', intelligence: 50 },
    ]);
    const picks = defaultOfficersFor(state.cities.jiangling, officers, { type: 'produceArmament', armamentType: 'crossbow' });
    expect(picks).toEqual(['i99', 'i95', 'i85']);
  });

  it('兵装延期（冲车，智极高者1人即可1旬封顶）', () => {
    const state = createGame('liu', 1);
    // 诸葛亮智100，综合智力 = 100 + 0 = 100 → (220-100)/12 = 10*10 = 100 日 = 10 旬（未封顶）
    // 我们需要一个足够高的智使得工期 == 1 旬 (最少10日 ≡ 1 旬)
    // 研究日数最低 10 日 → 只要 (220-combined)/12 ≤ 1 → combined ≥ 208，再靠 speedMul 才能到1旬
    // 所以对纯智延期，不出现"1人就封顶到1旬"的极端情形，因此应当加2人直到3人
    const officers = mockOfficers([
      { id: 'i120', intelligence: 120 },
      { id: 'i110', intelligence: 110 },
      { id: 'i80', intelligence: 80 },
    ]);
    const picks = defaultOfficersFor(state.cities.jiangling, officers, { type: 'produceArmament', armamentType: 'ram' });
    expect(picks.length).toBeGreaterThanOrEqual(2);
  });

  it('候选为 0 时返回空数组', () => {
    const state = createGame('liu', 1);
    expect(defaultOfficersFor(state.cities.jiangling, [], { type: 'recruit' })).toEqual([]);
  });
});

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

  it('剧本创建时按原版格数全量分配建设用地', () => {
    const state = createGame('liu', 1);
    const interior = china42InteriorByCityId();
    for (const city of Object.values(state.cities)) {
      const original = interior.get(city.id)?.length;
      const plots = cityPlots(city);
      // 原版 interior 数据的城：格数与原版一致（长安22/洛阳20/会稽4），不被规模档位截断
      if (original !== undefined) expect(plots.length).toBe(original);
      // 所有地格都应有坐标（可在地图上选中）
      expect(plots.every((p) => p.q != null && p.r != null)).toBe(true);
    }
  });

  it('大城市建设用地多于规模档位上限（原版长安22格不被截断为12格）', () => {
    const state = createGame('liu', 1);
    expect(cityPlots(state.cities.changan).length).toBe(22);
    expect(cityPlots(state.cities.luoyang).length).toBe(20);
    expect(cityPlots(state.cities.kuaiji).length).toBe(4);
    // 全图地格总数 = 原版 42 城 interior 总和
    const total = Object.values(state.cities).reduce((sum, city) => sum + cityPlots(city).length, 0);
    const originalTotal = [...china42InteriorByCityId().values()].reduce((sum, cells) => sum + cells.length, 0);
    expect(total).toBe(originalTotal);
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
