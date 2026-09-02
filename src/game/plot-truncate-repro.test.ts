import { describe, expect, it } from 'vitest';
import { cityPlots, PLOT_COUNT_BY_SIZE } from './innerAffairs';
import { createGame } from './scenario/jingxiang208';

describe('建设用地数量在剧本创建时固定，不随人口波动', () => {
  it('人口跌破大城市阈值时不截断地格（已建设施不消失）', () => {
    const state = createGame('liu', 1);
    const city = Object.values(state.cities).find((c) => c.population >= 100_000)!;
    const before = cityPlots(city).length;
    // 疫病等事件使人口跌破10万阈值
    city.population = 99_000;
    expect(cityPlots(city).length).toBe(before);
  });

  it('人口涨过大城市阈值时不新增无坐标地格', () => {
    const state = createGame('liu', 1);
    const city = Object.values(state.cities).find((c) => c.population >= 95_000 && c.population < 100_000)!;
    const before = cityPlots(city).length;
    city.population = 120_000;
    const plots = cityPlots(city);
    expect(plots.length).toBe(before);
    // 所有地格都应有坐标（可在地图上选中）
    expect(plots.every((p) => p.q != null && p.r != null)).toBe(true);
  });

  it('剧本创建时按城市大小分配地格数量', () => {
    const state = createGame('liu', 1);
    for (const city of Object.values(state.cities)) {
      const expected = city.population >= 100_000
        ? PLOT_COUNT_BY_SIZE.large
        : city.population >= 50_000 ? PLOT_COUNT_BY_SIZE.medium : PLOT_COUNT_BY_SIZE.small;
      const plots = cityPlots(city);
      expect(plots.length).toBe(expected);
      expect(plots.every((p) => p.q != null && p.r != null)).toBe(true);
    }
  });
});
