import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { PLOT_LABELS, cityPlots, plotBuiltCount, plotConstructingCount, plotCountIncludingConstructing, type PlotType } from '../game/innerAffairs';
import { createGame } from '../game/scenario/jingxiang208';
import { GameProvider } from '../game/store/GameProvider';
import type { City, CityId } from '../game/types';
import { CommandDialog } from './CommandDialog';

/**
 * 开发（设施选择）界面的计数显示：
 * - 已建成数量直接跟在设施名后面，如「市场(3)」；
 * - 若该设施还有格子正在建设，追加淡蓝色的下一个序号，如「市场(3)(4)」。
 */

type State = ReturnType<typeof createGame>;

/** 往城池地格表里追加一座已建成 / 正在建设的设施（不占用真实空地，仅用于渲染断言） */
function addPlot(city: City, type: PlotType, kind: 'built' | 'building') {
  const plots = cityPlots(city);
  const base = { id: `${city.id}-${type}-${kind}-${plots.length}`, level: 1, value: 8, durability: 500 };
  if (kind === 'built') {
    plots.push({ ...base, type });
  } else {
    plots.push({ ...base, type: 'empty', constructing: { facility: type, officerIds: [], remainingTenDays: 2 } });
  }
}

function renderBuildDialog(state: State, cityId: CityId = 'jiangling') {
  return render(
    <GameProvider initialState={state}>
      <CommandDialog type="buildFacilityPlot" cityId={cityId} onClose={() => undefined} />
    </GameProvider>,
  );
}

/** 按可见名称前缀定位某设施卡片（卡片可访问名 = 「名称(计数) 造价 金」） */
function facilityButton(label: string) {
  return within(screen.getByRole('dialog')).getByRole('button', { name: new RegExp(`^${label}`) });
}

describe('开发设施选择框：已建成数量与建设中提示', () => {
  it('已建成的设施在名字右边显示数量，如「市场(3)」', () => {
    const state = createGame('liu', 3);
    const city = state.cities.jiangling;
    for (let i = 0; i < 3; i += 1) addPlot(city, 'market', 'built');

    renderBuildDialog(state);

    const market = facilityButton('市场');
    expect(market).toHaveTextContent('市场(3)');
    expect(within(market).getByText('(3)')).toHaveClass('plot-facility-count');
    expect(within(market).getByText('(3)')).not.toHaveClass('is-building');
  });

  it('1 座已建成 + 1 座在建：只显示合计「市场(2)」，不做「(1)(2)」拆分', () => {
    const state = createGame('liu', 3);
    const city = state.cities.jiangling;
    addPlot(city, 'market', 'built');
    addPlot(city, 'market', 'building');

    renderBuildDialog(state);

    const market = facilityButton('市场');
    expect(market).toHaveTextContent('市场(2)');
    expect(market.textContent).not.toContain('(1)');
    // 有在建 → 合计数字整串淡蓝
    expect(within(market).getByText('(2)')).toHaveClass('plot-facility-count', 'is-building');
  });

  it('多座在建时仍只保留一个合计数字（3 已建成 + 2 在建 → 农场(5)）', () => {
    const state = createGame('liu', 3);
    const city = state.cities.jiangling;
    for (let i = 0; i < 3; i += 1) addPlot(city, 'farm', 'built');
    addPlot(city, 'farm', 'building');
    addPlot(city, 'farm', 'building');

    renderBuildDialog(state);

    const farm = facilityButton('农场');
    expect(farm).toHaveTextContent('农场(5)');
    expect(within(farm).getByText('(5)')).toHaveClass('plot-facility-count', 'is-building');
    // 卡片里只出现一个括号数字
    expect(within(farm).getAllByText(/^\(\d+\)$/)).toHaveLength(1);
  });

  it('只有在建、尚无一建成时同样显示合计（市场(1)，淡蓝）', () => {
    const state = createGame('liu', 3);
    addPlot(state.cities.jiangling, 'market', 'building');

    renderBuildDialog(state);

    const market = facilityButton('市场');
    expect(market).toHaveTextContent('市场(1)');
    expect(within(market).getByText('(1)')).toHaveClass('plot-facility-count', 'is-building');
  });

  it('尚未建成、也没有在建的设施不显示括号计数，界面保持干净', () => {
    const state = createGame('liu', 3);
    renderBuildDialog(state);

    const barracks = facilityButton('兵舍');
    expect(barracks).toHaveTextContent('兵舍');
    expect(barracks.textContent).not.toContain('(');
  });

  it('一城限一设施建成后仍显示数量（造币厂(1)）并保持置灰', () => {
    const state = createGame('liu', 3);
    addPlot(state.cities.jiangling, 'mint', 'built');

    renderBuildDialog(state);

    const mint = facilityButton('造币厂');
    expect(mint).toHaveTextContent('造币厂(1)');
    expect(mint).toBeDisabled();
  });

  it('设施名统一带「厂」后缀：造币厂 / 锻冶厂 / 造船厂', () => {
    expect(PLOT_LABELS.mint).toBe('造币厂');
    expect(PLOT_LABELS.forge).toBe('锻冶厂');
    expect(PLOT_LABELS.shipyard).toBe('造船厂');

    const state = createGame('liu', 3);
    renderBuildDialog(state);

    expect(facilityButton('造币厂')).toBeInTheDocument();
    expect(facilityButton('锻冶厂')).toBeInTheDocument();
    expect(facilityButton('造船厂')).toBeInTheDocument();
  });

  it('统计口径：已建成与在建分开计数，合计等于 plotCountIncludingConstructing', () => {
    const state = createGame('liu', 3);
    const city = state.cities.jiangling;
    addPlot(city, 'market', 'built');
    addPlot(city, 'market', 'built');
    addPlot(city, 'market', 'building');

    expect(plotBuiltCount(city, 'market')).toBe(2);
    expect(plotConstructingCount(city, 'market')).toBe(1);
    expect(plotCountIncludingConstructing(city, 'market')).toBe(3);
    // 未涉及的设施计数为 0，不误报
    expect(plotBuiltCount(city, 'stable')).toBe(0);
    expect(plotConstructingCount(city, 'stable')).toBe(0);
    expect(PLOT_LABELS.market).toBe('市场');
  });
});
