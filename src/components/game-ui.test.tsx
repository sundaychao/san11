import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from '../app/App';
import { deployUnit } from '../game/battle/actions';
import { cityPlots, PLOT_BASE_VALUE } from '../game/innerAffairs';
import { createGame } from '../game/scenario/jingxiang208';
import { GameProvider } from '../game/store/GameProvider';
import type { CityId } from '../game/types';
import { MANUAL_SAVE_KEY, writeSave } from '../game/persistence';
import { settleTenDay } from '../game/turn';
import { GameShell } from './GameShell';
import { UnitDetailDialog } from './UnitDetailDialog';
import css from '../styles/global.css?raw';

function cssRule(selector: string) {
  const escapedSelector = selector.replaceAll('.', '\\.');
  return css.match(new RegExp(`${escapedSelector}\\s*\\{([^}]*)\\}`))?.[1] ?? '';
}

function zoomToTerrain() {
  // china42 大地图（200×200）默认全图视图下地形格子过小不渲染；
  // 放大到 scale=4 后可见格子数低于阈值，地形与交互格子开始渲染。
  const viewport = screen.getByTestId('map-viewport');
  for (let i = 0; i < 20; i += 1) {
    fireEvent.wheel(viewport, { deltaY: -120 });
  }
}

/**
 * 为城市预置一座已建成的设施。
 * 当前规则中，征兵要求城市已建成兵舍，生产兵装要求已建成锻冶/工房/厩舍/造船之一，
 * 未建成时对应命令按钮为禁用状态。
 */
function seedCityFacility(state: ReturnType<typeof createGame>, cityId: CityId, type: 'barracks' | 'forge') {
  const city = state.cities[cityId];
  const plots = cityPlots(city);
  const emptyPlot = plots.find((plot) => plot.type === 'empty' && !plot.constructing);
  if (emptyPlot) {
    emptyPlot.type = type;
    emptyPlot.level = 1;
    return;
  }
  plots.push({ id: `${cityId}-${type}`, type, level: 1, value: PLOT_BASE_VALUE, q: city.gridQ, r: city.gridR });
}

function mockFileDownloads() {
  const originalCreateObjectUrl = URL.createObjectURL;
  const originalRevokeObjectUrl = URL.revokeObjectURL;
  let blobIndex = 0;
  const createObjectUrl = vi.fn((blob: Blob) => {
    void blob;
    const url = `blob:download-${blobIndex}`;
    blobIndex += 1;
    return url;
  });
  const revokeObjectUrl = vi.fn();
  const downloadedNames: string[] = [];
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: createObjectUrl });
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revokeObjectUrl });
  const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function clickDownload(this: HTMLAnchorElement) {
    downloadedNames.push(this.download);
  });

  return {
    createObjectUrl,
    downloadedNames,
    restore() {
      clickSpy.mockRestore();
      Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: originalCreateObjectUrl });
      Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: originalRevokeObjectUrl });
    },
    revokeObjectUrl,
  };
}

function mockObjectUrl(url = 'blob:uploaded-map') {
  const originalCreateObjectUrl = URL.createObjectURL;
  const originalRevokeObjectUrl = URL.revokeObjectURL;
  const createObjectUrl = vi.fn(() => url);
  const revokeObjectUrl = vi.fn();
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: createObjectUrl });
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revokeObjectUrl });

  return {
    createObjectUrl,
    restore() {
      Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: originalCreateObjectUrl });
      Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: originalRevokeObjectUrl });
    },
    revokeObjectUrl,
  };
}

function signInForStartScreen() {
  window.localStorage.setItem('jingxiang-208-auth-session-v1', JSON.stringify({
    token: 'test-token',
    userId: 'test-user',
    username: 'tester',
  }));
}

function mockAudioPlayback() {
  const play = vi.fn().mockResolvedValue(undefined);
  const AudioMock = vi.fn(function AudioMock(this: { play: typeof play; volume: number }) {
    this.play = play;
    this.volume = 1;
  });
  vi.stubGlobal('Audio', AudioMock);
  return { AudioMock, play };
}

describe('game interface shell', () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.unstubAllGlobals();
  });

  it('offers all four playable forces', () => {
    signInForStartScreen();
    render(<App />);

    expect(screen.getByRole('heading', { name: '建安十三年：荆襄争夺' })).toBeVisible();
    for (const name of ['曹操', '刘备', '孙权', '刘表']) {
      expect(screen.getByRole('button', { name: `选择${name}` })).toBeEnabled();
    }
  });

  it('starts the selected force in the game shell', async () => {
    const user = userEvent.setup();
    signInForStartScreen();
    render(<App />);

    await user.click(screen.getByRole('button', { name: '选择孙权' }));

    expect(screen.getByText('孙权', { selector: '.top-force-name' })).toBeVisible();
    expect(screen.getByRole('button', { name: '进行到下月' })).toBeEnabled();
    expect(screen.getByRole('region', { name: '军情与政务' })).toBeVisible();
  });

  it('offers continue only for a valid autosave', () => {
    signInForStartScreen();
    writeSave(window.localStorage, 'auto', createGame('cao', 1));

    render(<App />);

    expect(screen.getByRole('button', { name: '继续游戏' })).toBeEnabled();
  });

  it('reports and can clear an unreadable save', async () => {
    const user = userEvent.setup();
    signInForStartScreen();
    window.localStorage.setItem('jingxiang-208-autosave-v1', '{broken');
    writeSave(window.localStorage, 'manual', createGame('sun', 2));

    render(<App />);

    expect(screen.getByRole('alert')).toHaveTextContent('存档无法读取');
    await user.click(screen.getByRole('button', { name: '清除损坏的自动存档' }));
    expect(window.localStorage.getItem('jingxiang-208-autosave-v1')).toBeNull();
    expect(window.localStorage.getItem('jingxiang-208-manual-v1')).not.toBeNull();
  });

  it('deploys a visible battle unit and advances the ten-day turn from the shell', async () => {
    const user = userEvent.setup();
    render(
      <GameProvider initialState={createGame('liu', 1)} storage={window.localStorage}>
        <GameShell />
      </GameProvider>,
    );

    await user.click(screen.getByTestId('quick-deploy-button'));

    expect(screen.getByTestId('battle-unit-marker')).toBeVisible();
    expect(screen.getByTestId('ten-day-label')).toHaveTextContent('上旬');

    await user.click(screen.getByTestId('end-ten-day-button'));

    expect(screen.getByTestId('ten-day-label')).toHaveTextContent('中旬');
  });

  it('renders the battle map without a raster background image by default', () => {
    render(
      <GameProvider initialState={createGame('liu', 1)} storage={window.localStorage}>
        <GameShell />
      </GameProvider>,
    );

    expect(screen.queryByTestId('map-image')).not.toBeInTheDocument();
    expect(screen.getByTestId('battle-grid-overlay')).toBeVisible();
  });

  it('shows a left force overview with player cities and officer action states', async () => {
    const user = userEvent.setup();
    const state = createGame('liu', 1);
    state.officers['liu-bei'].acted = true;
    render(
      <GameProvider initialState={state} storage={window.localStorage}>
        <GameShell />
      </GameProvider>,
    );

    const panel = screen.getByTestId('force-overview-panel');
    expect(panel).toBeVisible();
    expect(within(panel).getByRole('button', { name: '城池' })).toHaveClass('is-active');
    expect(within(panel).getByText('江陵')).toBeVisible();
    expect(within(panel).getByText('武陵')).toBeVisible();
    expect(within(panel).queryByText('襄阳')).not.toBeInTheDocument();

    await user.click(within(panel).getByRole('button', { name: '武将' }));

    const liuBeiRow = within(panel).getByText('刘备').closest('li');
    const guanYuRow = within(panel).getByText('关羽').closest('li');
    expect(liuBeiRow).toHaveClass('has-acted');
    expect(guanYuRow).toHaveClass('is-ready');
  });

  it('opens a nested city command menu next to a clicked city', async () => {
    const user = userEvent.setup();
    render(
      <GameProvider initialState={createGame('liu', 1)} storage={window.localStorage}>
        <GameShell />
      </GameProvider>,
    );

    const jianglingMarker = screen.getAllByTestId('city-marker').find((marker) => marker.textContent?.includes('江陵'));
    expect(jianglingMarker).toBeTruthy();
    await user.click(jianglingMarker!);
    const menu = screen.getByTestId('city-command-menu');

    expect(within(menu).getByRole('button', { name: '都市' })).toBeVisible();
    expect(within(menu).getByRole('button', { name: '军事' })).toBeVisible();
    expect(within(menu).getByRole('button', { name: '人才' })).toBeVisible();

    await user.click(within(menu).getByRole('button', { name: '都市' }));
    expect(within(menu).getByRole('button', { name: '开发' })).toBeVisible();
    expect(within(menu).getByRole('button', { name: '征兵' })).toBeVisible();
    expect(within(menu).getByRole('button', { name: '生产兵装' })).toBeVisible();
    expect(within(menu).getByRole('button', { name: '巡查' })).toBeVisible();

    await user.click(within(menu).getByRole('button', { name: '军事' }));
    expect(within(menu).getByRole('button', { name: '训练' })).toBeVisible();
    expect(within(menu).queryByRole('button', { name: '生产兵装' })).not.toBeInTheDocument();
    expect(within(menu).getByRole('button', { name: '出征' })).toBeVisible();

    await user.click(within(menu).getByRole('button', { name: '人才' }));
    expect(within(menu).getByRole('button', { name: '探索' })).toBeVisible();
    expect(within(menu).getByRole('button', { name: '收授宝物' })).toBeVisible();
    expect(within(menu).getByRole('button', { name: '移动' })).toBeVisible();
  });

  it('plays the left mouse menu sound when clicking an owned city opens the first command menu', async () => {
    const user = userEvent.setup();
    const { AudioMock, play } = mockAudioPlayback();
    render(
      <GameProvider initialState={createGame('liu', 1)} storage={window.localStorage}>
        <GameShell />
      </GameProvider>,
    );

    const jianglingMarker = screen.getAllByTestId('city-marker').find((marker) => marker.textContent?.includes('13500'));
    expect(jianglingMarker).toBeTruthy();
    await user.click(jianglingMarker!);

    expect(screen.getByTestId('city-command-menu')).toBeVisible();
    expect(AudioMock).toHaveBeenCalledWith(expect.stringContaining('/assets/sound/menu/leftMouse.mp3'));
    expect(play).toHaveBeenCalledTimes(1);
  });

  it('plays the click-on menu sound when clicking a city command section opens the second menu', async () => {
    const user = userEvent.setup();
    const { AudioMock } = mockAudioPlayback();
    render(
      <GameProvider initialState={createGame('liu', 1)} storage={window.localStorage}>
        <GameShell />
      </GameProvider>,
    );

    const jianglingMarker = screen.getAllByTestId('city-marker').find((marker) => marker.textContent?.includes('13500'));
    expect(jianglingMarker).toBeTruthy();
    await user.click(jianglingMarker!);
    AudioMock.mockClear();

    await user.click(screen.getByTestId('city-command-section-military'));

    expect(within(screen.getByTestId('city-command-menu')).getByTestId('city-command-action-deploy')).toBeVisible();
    expect(AudioMock).toHaveBeenCalledWith(expect.stringContaining('/assets/sound/menu/clickOn.mp3'));
  });

  it('plays the right mouse menu sound when right clicking cancels a popup', async () => {
    const user = userEvent.setup();
    const { AudioMock } = mockAudioPlayback();
    render(
      <GameProvider initialState={createGame('liu', 1)} storage={window.localStorage}>
        <GameShell />
      </GameProvider>,
    );

    const jianglingMarker = screen.getAllByTestId('city-marker').find((marker) => marker.textContent?.includes('13500'));
    expect(jianglingMarker).toBeTruthy();
    await user.click(jianglingMarker!);
    await user.click(screen.getByTestId('city-command-section-military'));
    AudioMock.mockClear();
    const menu = screen.getByTestId('city-command-menu');

    fireEvent.contextMenu(menu);

    expect(screen.getByTestId('city-command-menu')).toBeVisible();
    expect(within(menu).queryByTestId('city-command-action-deploy')).not.toBeInTheDocument();
    expect(AudioMock).toHaveBeenCalledWith(expect.stringContaining('/assets/sound/menu/rightMouse.mp3'));

    AudioMock.mockClear();
    fireEvent.contextMenu(menu);

    expect(screen.queryByTestId('city-command-menu')).not.toBeInTheDocument();
    expect(AudioMock).toHaveBeenCalledWith(expect.stringContaining('/assets/sound/menu/rightMouse.mp3'));
  });

  it('plays the waiting-for-target sound when clicking a deployed unit', async () => {
    const user = userEvent.setup();
    const { AudioMock, play } = mockAudioPlayback();
    const deployed = deployUnit(createGame('liu', 1), 'liu', {
      cityId: 'jiangling',
      officerIds: ['guan-yu'],
      troopType: 'spear',
      troops: 4000,
      food: 6000,
    });

    render(
      <GameProvider initialState={settleTenDay(deployed)} storage={window.localStorage}>
        <GameShell />
      </GameProvider>,
    );

    await user.click(screen.getByTestId('battle-unit-marker'));

    expect(AudioMock).toHaveBeenCalledWith(expect.stringContaining('/assets/sound/menu/waitingForTarget.mp3'));
    expect(play).toHaveBeenCalledTimes(1);
  });

  it('does not replay the waiting-for-target sound when opening the selected unit menu', async () => {
    const user = userEvent.setup();
    const { AudioMock, play } = mockAudioPlayback();
    const deployed = deployUnit(createGame('liu', 1), 'liu', {
      cityId: 'jiangling',
      officerIds: ['guan-yu'],
      troopType: 'spear',
      troops: 4000,
      food: 6000,
    });

    render(
      <GameProvider initialState={settleTenDay(deployed)} storage={window.localStorage}>
        <GameShell />
      </GameProvider>,
    );

    const marker = screen.getByTestId('battle-unit-marker');
    await user.click(marker);
    await user.click(marker);

    expect(screen.getByTestId('unit-command-menu')).toBeVisible();
    expect(AudioMock).toHaveBeenCalledTimes(1);
    expect(play).toHaveBeenCalledTimes(1);
  });

  it('shows effective formation abilities, providers, and derived battle rates', async () => {
    const user = userEvent.setup();
    const state = deployUnit(createGame('liu', 1), 'liu', {
      cityId: 'jiangling',
      officerIds: ['liu-bei', 'guan-yu'],
      troopType: 'spear',
      troops: 4000,
      food: 6000,
    });
    const unit = Object.values(state.units)[0];
    unit.officerIds = ['liu-bei', 'guan-yu', 'zhuge-liang'];
    state.officers['zhuge-liang'].stats.intelligence = 88;
    Object.assign(unit, { q: 10, r: 10, energy: 100, moved: false, acted: false, movementRemaining: 22 });

    render(
      <GameProvider initialState={state} storage={window.localStorage}>
        <GameShell />
      </GameProvider>,
    );

    const marker = screen.getByTestId('battle-unit-marker');
    fireEvent.pointerEnter(marker, { clientX: 300, clientY: 180 });

    const hoverAbilities = within(screen.getByTestId('unit-info-panel')).getByTestId('unit-effective-abilities');
    expect(hoverAbilities).toHaveTextContent('统78');
    expect(hoverAbilities).toHaveTextContent('武97');
    expect(hoverAbilities).toHaveTextContent('智88');
    expect(hoverAbilities).toHaveTextContent('适S');

    fireEvent.pointerLeave(marker);
    fireEvent.contextMenu(marker, { clientX: 260, clientY: 190 });
    await user.click(within(screen.getByTestId('unit-intel-context-menu')).getByTestId('unit-detail-button'));

    const dialog = screen.getByTestId('unit-detail-dialog');
    const detailRow = (label: string) => within(dialog).getByText(label, { selector: 'dt' }).closest('div')!;
    expect(detailRow('统率')).toHaveTextContent('78刘备');
    expect(detailRow('武力')).toHaveTextContent('97关羽');
    expect(detailRow('智力')).toHaveTextContent('88诸葛亮');
    expect(detailRow('适性')).toHaveTextContent('S关羽');
    expect(detailRow('战法暴击率')).toHaveTextContent('26%');
    expect(detailRow('火计成功率')).toHaveTextContent('85%');
  });

  it.each([
    ['剑兵', { kind: 'combat' as const, troopType: 'sword' as const }],
    ['输送队', { kind: 'transport' as const, troopType: 'spear' as const }],
  ])('shows unavailable aptitude and tactic critical rate for %s', (_label, unitKind) => {
    const state = deployUnit(createGame('liu', 1), 'liu', {
      cityId: 'jiangling',
      officerId: 'liu-bei',
      troopType: 'spear',
      troops: 4000,
      food: 6000,
    });
    const unit = { ...Object.values(state.units)[0], ...unitKind };

    render(<UnitDetailDialog unit={unit} state={state} onClose={vi.fn()} />);

    const dialog = screen.getByTestId('unit-detail-dialog');
    const detailRow = (label: string) => within(dialog).getByText(label, { selector: 'dt' }).closest('div')!;
    expect(detailRow('适性')).toHaveTextContent('—');
    expect(detailRow('战法暴击率')).toHaveTextContent('—');
  });

  it('shows harmful strategy success chance for the eligible hovered enemy formation', async () => {
    const user = userEvent.setup();
    const state = deployUnit(createGame('liu', 1), 'liu', {
      cityId: 'jiangling',
      officerIds: ['liu-bei', 'guan-yu'],
      troopType: 'spear',
      troops: 4000,
      food: 6000,
    });
    const source = Object.values(state.units)[0];
    source.officerIds = ['liu-bei', 'guan-yu', 'zhuge-liang'];
    state.officers['zhuge-liang'].stats.intelligence = 88;
    state.officers['guo-jia'].stats.intelligence = 82;
    Object.assign(source, { q: 10, r: 10, energy: 100, moved: false, acted: false, movementRemaining: 22 });
    state.units['strategy-target'] = {
      id: 'strategy-target',
      forceId: 'cao',
      leaderId: 'cao-ren',
      officerIds: ['cao-ren', 'guo-jia'],
      homeCityId: 'xiangyang',
      troopType: 'halberd',
      q: 11,
      r: 10,
      troops: 3000,
      food: 3000,
      energy: 100,
      movementRemaining: 20,
      moved: false,
      acted: false,
    };

    render(
      <GameProvider initialState={state} storage={window.localStorage}>
        <GameShell />
      </GameProvider>,
    );

    const sourceMarker = screen.getAllByTestId('battle-unit-marker')
      .find((marker) => marker.getAttribute('data-grid-position') === '10,10')!;
    fireEvent.pointerDown(sourceMarker, { button: 0, buttons: 1, clientX: 240, clientY: 180 });
    fireEvent.pointerDown(sourceMarker, { button: 0, buttons: 1, clientX: 240, clientY: 180 });
    await user.click(within(screen.getByTestId('unit-command-menu')).getByRole('button', { name: '计略' }));
    await user.click(within(screen.getByTestId('unit-strategy-menu')).getByRole('button', { name: '伪报（15）' }));

    const targetMarker = screen.getAllByTestId('battle-unit-marker')
      .find((marker) => marker.getAttribute('data-grid-position') === '11,10')!;
    fireEvent.pointerEnter(targetMarker, { clientX: 300, clientY: 180 });

    expect(screen.getByTestId('unit-info-panel')).toHaveTextContent('伪报成功率 76%');
  });

  it('keeps hover and detail information scroll-contained inside short viewports', () => {
    const hoverRule = cssRule('.unit-info-panel');
    const detailRule = cssRule('.unit-detail-dialog');

    expect(hoverRule).toContain('max-height: calc(100dvh - 16px)');
    expect(hoverRule).toContain('overflow-y: auto');
    expect(hoverRule).toContain('pointer-events: auto');
    expect(hoverRule).toContain('touch-action: pan-y');
    expect(detailRule).toContain('max-height: min(680px, calc(100dvh - 40px))');
    expect(detailRule).toContain('overflow-y: auto');
    expect(css).toMatch(/@media \(max-width: 700px\)[\s\S]*?\.unit-detail-dialog\s*\{[^}]*max-height:/);
  });

  it('keeps unit information open during pointer handoff and closes after leaving the panel', () => {
    vi.useFakeTimers();
    try {
      const state = deployUnit(createGame('liu', 1), 'liu', {
        cityId: 'jiangling',
        officerId: 'liu-bei',
        troopType: 'spear',
        troops: 4000,
        food: 6000,
      });
      render(
        <GameProvider initialState={state} storage={window.localStorage}>
          <GameShell />
        </GameProvider>,
      );

      const marker = screen.getByTestId('battle-unit-marker');
      fireEvent.pointerEnter(marker, { clientX: 300, clientY: 180 });
      const panel = screen.getByTestId('unit-info-panel');

      fireEvent.pointerLeave(marker);
      fireEvent.pointerEnter(panel);
      act(() => vi.advanceTimersByTime(200));
      expect(panel).toBeVisible();

      fireEvent.pointerLeave(panel);
      act(() => vi.advanceTimersByTime(119));
      expect(panel).toBeVisible();
      act(() => vi.advanceTimersByTime(1));
      expect(screen.queryByTestId('unit-info-panel')).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it('hides harmful strategy chance while hovering an ineligible enemy', async () => {
    const user = userEvent.setup();
    const state = deployUnit(createGame('liu', 1), 'liu', {
      cityId: 'jiangling',
      officerIds: ['liu-bei', 'guan-yu'],
      troopType: 'spear',
      troops: 4000,
      food: 6000,
    });
    const source = Object.values(state.units)[0];
    Object.assign(source, { q: 10, r: 10, energy: 100, moved: false, acted: false, movementRemaining: 22 });
    state.units['eligible-strategy-target'] = {
      id: 'eligible-strategy-target', forceId: 'cao', leaderId: 'cao-ren', homeCityId: 'xiangyang', troopType: 'halberd',
      q: 11, r: 10, troops: 3000, food: 3000, energy: 100, movementRemaining: 20, moved: false, acted: false,
    };
    state.units['ineligible-strategy-target'] = {
      id: 'ineligible-strategy-target', forceId: 'cao', leaderId: 'guo-jia', homeCityId: 'xiangyang', troopType: 'crossbow',
      q: 20, r: 20, troops: 3000, food: 3000, energy: 100, movementRemaining: 20, moved: false, acted: false,
    };
    render(
      <GameProvider initialState={state} storage={window.localStorage}>
        <GameShell />
      </GameProvider>,
    );

    const sourceMarker = screen.getAllByTestId('battle-unit-marker')
      .find((marker) => marker.getAttribute('data-grid-position') === '10,10')!;
    fireEvent.pointerDown(sourceMarker, { button: 0, buttons: 1, clientX: 240, clientY: 180 });
    fireEvent.pointerDown(sourceMarker, { button: 0, buttons: 1, clientX: 240, clientY: 180 });
    await user.click(within(screen.getByTestId('unit-command-menu')).getByRole('button', { name: '计略' }));
    await user.click(within(screen.getByTestId('unit-strategy-menu')).getByRole('button', { name: '伪报（15）' }));

    const ineligibleMarker = screen.getAllByTestId('battle-unit-marker')
      .find((marker) => marker.getAttribute('data-grid-position') === '20,20')!;
    fireEvent.pointerEnter(ineligibleMarker, { clientX: 300, clientY: 180 });

    expect(screen.getByTestId('unit-info-panel')).not.toHaveTextContent('伪报成功率');
  });

  it('hides strategy chance for an eligible non-harmful strategy target', async () => {
    const user = userEvent.setup();
    const state = deployUnit(createGame('liu', 1), 'liu', {
      cityId: 'jiangling',
      officerId: 'liu-bei',
      troopType: 'spear',
      troops: 4000,
      food: 6000,
    });
    const source = Object.values(state.units)[0];
    Object.assign(source, { q: 10, r: 10, energy: 100, moved: false, acted: false, movementRemaining: 22 });
    state.units['inspire-target'] = {
      id: 'inspire-target', forceId: 'liu', leaderId: 'guan-yu', homeCityId: 'jiangling', troopType: 'spear',
      q: 11, r: 10, troops: 3000, food: 3000, energy: 60, movementRemaining: 22, moved: false, acted: false,
    };
    render(
      <GameProvider initialState={state} storage={window.localStorage}>
        <GameShell />
      </GameProvider>,
    );

    const sourceMarker = screen.getAllByTestId('battle-unit-marker')
      .find((marker) => marker.getAttribute('data-grid-position') === '10,10')!;
    fireEvent.pointerDown(sourceMarker, { button: 0, buttons: 1, clientX: 240, clientY: 180 });
    fireEvent.pointerDown(sourceMarker, { button: 0, buttons: 1, clientX: 240, clientY: 180 });
    await user.click(within(screen.getByTestId('unit-command-menu')).getByRole('button', { name: '计略' }));
    await user.click(within(screen.getByTestId('unit-strategy-menu')).getByRole('button', { name: '鼓舞（10）' }));

    const targetMarker = screen.getAllByTestId('battle-unit-marker')
      .find((marker) => marker.getAttribute('data-grid-position') === '11,10')!;
    fireEvent.pointerEnter(targetMarker, { clientX: 300, clientY: 180 });

    expect(screen.getByTestId('unit-info-panel')).not.toHaveTextContent('成功率');
  });

  it('opens a recruit officer selection dialog from the urban city menu', async () => {
    const user = userEvent.setup();
    const state = createGame('liu', 1);
    // 当前规则：征兵要求城市已建成兵舍
    seedCityFacility(state, 'jiangling', 'barracks');
    render(
      <GameProvider initialState={state} storage={window.localStorage}>
        <GameShell />
      </GameProvider>,
    );

    const jianglingMarker = screen.getAllByTestId('city-marker').find((marker) => marker.textContent?.includes('江陵'));
    expect(jianglingMarker).toBeTruthy();
    await user.click(jianglingMarker!);
    const menu = screen.getByTestId('city-command-menu');
    await user.click(within(menu).getByRole('button', { name: '都市' }));
    await user.click(within(menu).getByRole('button', { name: '征兵' }));

    const dialog = screen.getByRole('dialog', { name: '征兵' });
    expect(within(dialog).getByRole('button', { name: '执行武将' })).toBeVisible();
    // 头像占位区默认显示魅力最高的待命武将（刘备）
    expect(within(dialog).getByRole('button', { name: /刘备/ })).toBeVisible();
    expect(within(dialog).getByRole('button', { name: '决定·征兵' })).toBeEnabled();
  });

  it('shows temporary city gain numbers after recruit and armament production', () => {
    vi.useFakeTimers();
    try {
      const state = createGame('liu', 1);
      // 征兵需兵舍；生产弩属于锻冶类兵装，需已建成锻冶
      seedCityFacility(state, 'jiangling', 'barracks');
      seedCityFacility(state, 'jiangling', 'forge');
      render(
        <GameProvider initialState={state} storage={window.localStorage}>
          <GameShell />
        </GameProvider>,
      );

      const jianglingMarker = screen.getAllByTestId('city-marker').find((marker) => marker.textContent?.includes('江陵'));
      expect(jianglingMarker).toBeTruthy();
      fireEvent.click(jianglingMarker!);
      fireEvent.click(within(screen.getByTestId('city-command-menu')).getByRole('button', { name: '都市' }));
      fireEvent.click(within(screen.getByTestId('city-command-menu')).getByRole('button', { name: '征兵' }));
      fireEvent.click(within(screen.getByRole('dialog', { name: '征兵' })).getByRole('button', { name: '决定·征兵' }));

      const recruitEffect = screen.getByTestId('city-effect-number');
      // 魅力Top3：刘备(99)+关羽(94)+简雍(86)=279；基础(1000+279×(80+20)×5/100=2395) × 兵舍1级1.15 = 2754
      expect(recruitEffect).toHaveTextContent('士兵 +2,754');
      expect(recruitEffect.closest('[data-testid="city-marker"]')).toBe(jianglingMarker);

      act(() => vi.advanceTimersByTime(2000));
      expect(screen.queryByTestId('city-effect-number')).not.toBeInTheDocument();

      fireEvent.click(jianglingMarker!);
      fireEvent.click(within(screen.getByTestId('city-command-menu')).getByRole('button', { name: '都市' }));
      fireEvent.click(within(screen.getByTestId('city-command-menu')).getByRole('button', { name: '生产兵装' }));

      const dialog = screen.getByRole('dialog', { name: '生产兵装' });
      expect(within(dialog).getByRole('button', { name: '执行武将' })).toBeVisible();
      fireEvent.click(within(dialog).getByRole('button', { name: '弩' }));
      fireEvent.click(within(dialog).getByRole('button', { name: '决定·生产兵装' }));

      expect(screen.queryByRole('dialog', { name: '生产兵装' })).not.toBeInTheDocument();
      expect(screen.getByText(/生产江陵弩/)).toBeVisible();
      // 征兵已用刘备/关羽/简雍（已行动），生产默认贪心勾选孙乾（智78·能吏）+陈到（智62）+甘氏（智18）：(1000+78×10+62×5+18×5=2180) × 锻冶1级1.15 = 2507 × 能吏2 = 5014 + 随机460 = 5474
      expect(screen.getByTestId('city-effect-number')).toHaveTextContent('弩 +5,474');

      act(() => vi.advanceTimersByTime(1999));
      expect(screen.getByTestId('city-effect-number')).toBeVisible();
      act(() => vi.advanceTimersByTime(1));
      expect(screen.queryByTestId('city-effect-number')).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not open the command menu when clicking an enemy city', async () => {
    const user = userEvent.setup();
    render(
      <GameProvider initialState={createGame('liu', 1)} storage={window.localStorage}>
        <GameShell />
      </GameProvider>,
    );

    const xiangyangMarker = screen.getAllByTestId('city-marker').find((marker) => marker.textContent?.includes('襄阳'));
    expect(xiangyangMarker).toBeTruthy();
    await user.click(xiangyangMarker!);

    expect(screen.queryByTestId('city-command-menu')).not.toBeInTheDocument();
  });

  it('closes the city command menu one level per right click', async () => {
    const user = userEvent.setup();
    render(
      <GameProvider initialState={createGame('liu', 1)} storage={window.localStorage}>
        <GameShell />
      </GameProvider>,
    );

    const jianglingMarker = screen.getAllByTestId('city-marker').find((marker) => marker.textContent?.includes('江陵'));
    expect(jianglingMarker).toBeTruthy();
    await user.click(jianglingMarker!);
    const menu = screen.getByTestId('city-command-menu');

    await user.click(screen.getByTestId('city-command-section-military'));
    expect(within(menu).getByTestId('city-command-action-deploy')).toBeVisible();

    const defaultWasAllowed = fireEvent.contextMenu(menu);
    expect(defaultWasAllowed).toBe(false);
    expect(within(menu).queryByTestId('city-command-action-deploy')).not.toBeInTheDocument();
    expect(screen.getByTestId('city-command-menu')).toBeVisible();

    fireEvent.contextMenu(menu);
    expect(screen.queryByTestId('city-command-menu')).not.toBeInTheDocument();
  });

  it('treats right clicking empty map space like right clicking the open city command menu', async () => {
    const user = userEvent.setup();
    const { AudioMock } = mockAudioPlayback();
    render(
      <GameProvider initialState={createGame('liu', 1)} storage={window.localStorage}>
        <GameShell />
      </GameProvider>,
    );

    const jianglingMarker = screen.getAllByTestId('city-marker').find((marker) => marker.textContent?.includes('13500'));
    expect(jianglingMarker).toBeTruthy();
    await user.click(jianglingMarker!);
    await user.click(screen.getByTestId('city-command-section-military'));
    AudioMock.mockClear();
    const menu = screen.getByTestId('city-command-menu');

    fireEvent.contextMenu(screen.getByTestId('map-viewport'), { clientX: 360, clientY: 260 });

    expect(screen.getByTestId('city-command-menu')).toBeVisible();
    expect(within(menu).queryByTestId('city-command-action-deploy')).not.toBeInTheDocument();
    expect(screen.queryByTestId('map-context-menu')).not.toBeInTheDocument();
    expect(AudioMock).toHaveBeenCalledWith(expect.stringContaining('/assets/sound/menu/rightMouse.mp3'));

    AudioMock.mockClear();
    fireEvent.contextMenu(screen.getByTestId('map-viewport'), { clientX: 360, clientY: 260 });

    expect(screen.queryByTestId('city-command-menu')).not.toBeInTheDocument();
    expect(screen.queryByTestId('map-context-menu')).not.toBeInTheDocument();
    expect(AudioMock).toHaveBeenCalledWith(expect.stringContaining('/assets/sound/menu/rightMouse.mp3'));
  });

  it('closes the current city command menu level on each outside left click', async () => {
    const user = userEvent.setup();
    render(
      <GameProvider initialState={createGame('liu', 1)} storage={window.localStorage}>
        <GameShell />
      </GameProvider>,
    );

    const jianglingMarker = screen.getAllByTestId('city-marker').find((marker) => marker.textContent?.includes('江陵'));
    expect(jianglingMarker).toBeTruthy();
    await user.click(jianglingMarker!);
    const menu = screen.getByTestId('city-command-menu');

    await user.click(within(menu).getByRole('button', { name: '军事' }));
    expect(within(menu).getByRole('button', { name: '出征' })).toBeVisible();

    fireEvent.pointerDown(screen.getByTestId('map-viewport'), { button: 0 });
    expect(within(menu).queryByRole('button', { name: '出征' })).not.toBeInTheDocument();
    expect(screen.getByTestId('city-command-menu')).toBeVisible();

    fireEvent.pointerDown(screen.getByTestId('map-viewport'), { button: 0 });
    expect(screen.queryByTestId('city-command-menu')).not.toBeInTheDocument();
  });

  it('closes the first-level city command menu from a right click anywhere', async () => {
    const user = userEvent.setup();
    render(
      <GameProvider initialState={createGame('liu', 1)} storage={window.localStorage}>
        <GameShell />
      </GameProvider>,
    );

    const jianglingMarker = screen.getAllByTestId('city-marker').find((marker) => marker.textContent?.includes('江陵'));
    expect(jianglingMarker).toBeTruthy();
    await user.click(jianglingMarker!);
    expect(screen.getByTestId('city-command-menu')).toBeVisible();

    await user.pointer({ keys: '[MouseRight]', target: screen.getByTestId('map-viewport') });

    expect(screen.queryByTestId('city-command-menu')).not.toBeInTheDocument();
  });

  it('opens a proceed menu from a right click on empty map space and advances the ten-day turn', async () => {
    const user = userEvent.setup();
    render(
      <GameProvider initialState={createGame('liu', 1)} storage={window.localStorage}>
        <GameShell />
      </GameProvider>,
    );

    expect(screen.getByTestId('ten-day-label')).toHaveTextContent('上旬');

    fireEvent.contextMenu(screen.getByTestId('map-viewport'), { clientX: 320, clientY: 240 });
    const menu = screen.getByTestId('map-context-menu');
    expect(within(menu).getByRole('button', { name: '进行' })).toBeVisible();
    expect(within(menu).getByRole('button', { name: '情报' })).toBeVisible();
    expect(within(menu).getByRole('button', { name: '储存' })).toBeVisible();
    expect(within(menu).getByRole('button', { name: '载入' })).toBeVisible();

    await user.click(within(menu).getByRole('button', { name: '进行' }));

    expect(screen.queryByTestId('map-context-menu')).not.toBeInTheDocument();
    expect(screen.getByTestId('ten-day-label')).toHaveTextContent('中旬');
    const eventLog = screen.getByRole('region', { name: '军情与政务' });
    const aiForceColors = ['#2088ff', '#e23d34', '#30b45a', 'rgb(32, 136, 255)', 'rgb(226, 61, 52)', 'rgb(48, 180, 90)'];
    expect(within(eventLog).getAllByRole('listitem').some((item) => {
      const swatch = item.querySelector('i') as HTMLElement | null;
      return swatch ? aiForceColors.includes(swatch.style.backgroundColor) || aiForceColors.includes(swatch.style.backgroundColor.toLowerCase()) : false;
    })).toBe(true);
  });

  it('closes the map context menu when right clicking empty map space again', () => {
    render(
      <GameProvider initialState={createGame('liu', 1)} storage={window.localStorage}>
        <GameShell />
      </GameProvider>,
    );

    const viewport = screen.getByTestId('map-viewport');
    fireEvent.contextMenu(viewport, { clientX: 320, clientY: 240 });
    expect(screen.getByTestId('map-context-menu')).toBeVisible();

    fireEvent.contextMenu(viewport, { clientX: 360, clientY: 260 });

    expect(screen.queryByTestId('map-context-menu')).not.toBeInTheDocument();
  });

  it('closes the map context menu and suppresses the browser menu when right clicking on it', () => {
    render(
      <GameProvider initialState={createGame('liu', 1)} storage={window.localStorage}>
        <GameShell />
      </GameProvider>,
    );

    fireEvent.contextMenu(screen.getByTestId('map-viewport'), { clientX: 320, clientY: 240 });
    const menu = screen.getByTestId('map-context-menu');

    const defaultWasAllowed = fireEvent.contextMenu(menu);

    expect(defaultWasAllowed).toBe(false);
    expect(screen.queryByTestId('map-context-menu')).not.toBeInTheDocument();
  });

  it('closes the map context menu when right clicking a city marker', () => {
    render(
      <GameProvider initialState={createGame('liu', 1)} storage={window.localStorage}>
        <GameShell />
      </GameProvider>,
    );

    fireEvent.contextMenu(screen.getByTestId('map-viewport'), { clientX: 320, clientY: 240 });
    expect(screen.getByTestId('map-context-menu')).toBeVisible();

    const jianglingMarker = screen.getAllByTestId('city-marker').find((marker) => marker.textContent?.includes('江陵'));
    expect(jianglingMarker).toBeTruthy();
    fireEvent.contextMenu(jianglingMarker!, { clientX: 520, clientY: 260 });

    expect(screen.queryByTestId('map-context-menu')).not.toBeInTheDocument();
    expect(screen.queryByTestId('city-command-menu')).not.toBeInTheDocument();
  });

  it('closes the map context menu from a left click outside the menu', () => {
    render(
      <GameProvider initialState={createGame('liu', 1)} storage={window.localStorage}>
        <GameShell />
      </GameProvider>,
    );

    fireEvent.contextMenu(screen.getByTestId('map-viewport'), { clientX: 320, clientY: 240 });
    expect(screen.getByTestId('map-context-menu')).toBeVisible();

    fireEvent.mouseDown(screen.getByTestId('map-viewport'), { button: 0 });

    expect(screen.queryByTestId('map-context-menu')).not.toBeInTheDocument();
  });

  it('opens an intelligence submenu from the map context menu', async () => {
    const user = userEvent.setup();
    render(
      <GameProvider initialState={createGame('liu', 1)} storage={window.localStorage}>
        <GameShell />
      </GameProvider>,
    );

    fireEvent.contextMenu(screen.getByTestId('map-viewport'), { clientX: 320, clientY: 240 });
    await user.click(screen.getByTestId('map-context-intel-button'));

    const menu = screen.getByTestId('map-context-menu');
    expect(within(menu).getByRole('button', { name: '我方武将' })).toBeVisible();
    expect(within(menu).getByRole('button', { name: '所有武将' })).toBeVisible();
    expect(within(menu).getByRole('button', { name: '全局情报' })).toBeVisible();
    expect(screen.queryByRole('dialog', { name: '全局情报' })).not.toBeInTheDocument();
  });

  it('opens the force officer list from the intelligence submenu', async () => {
    const user = userEvent.setup();
    render(
      <GameProvider initialState={createGame('liu', 1)} storage={window.localStorage}>
        <GameShell />
      </GameProvider>,
    );

    fireEvent.contextMenu(screen.getByTestId('map-viewport'), { clientX: 320, clientY: 240 });
    await user.click(screen.getByTestId('map-context-intel-button'));
    await user.click(screen.getByTestId('map-context-player-officers-button'));

    const dialog = screen.getByRole('dialog', { name: '武将一览' });
    expect(screen.queryByTestId('map-context-menu')).not.toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: '所属' })).toBeVisible();
    expect(within(dialog).getByRole('button', { name: '能力' })).toBeVisible();
    expect(within(dialog).getByRole('rowheader', { name: '刘备' })).toBeVisible();
  });

  it('opens an all-force officer list from the intelligence submenu', async () => {
    const user = userEvent.setup();
    render(
      <GameProvider initialState={createGame('liu', 1)} storage={window.localStorage}>
        <GameShell />
      </GameProvider>,
    );

    fireEvent.contextMenu(screen.getByTestId('map-viewport'), { clientX: 320, clientY: 240 });
    await user.click(screen.getByTestId('map-context-intel-button'));
    await user.click(screen.getByTestId('map-context-all-officers-button'));

    const dialog = screen.getByRole('dialog', { name: '武将一览' });
    expect(screen.queryByTestId('map-context-menu')).not.toBeInTheDocument();
    expect(within(dialog).getByRole('rowheader', { name: '刘备' })).toBeVisible();
    expect(within(dialog).getByRole('rowheader', { name: '曹操' })).toBeVisible();
    expect(within(dialog).getByRole('rowheader', { name: '孙权' })).toBeVisible();
    expect(within(dialog).getByRole('rowheader', { name: '刘表' })).toBeVisible();
    expect(within(dialog).getByRole('rowheader', { name: '赵云' })).toBeVisible();
    expect(within(dialog).getAllByText('在野').length).toBeGreaterThan(0);
  });

  it('opens centered global intelligence from the intelligence submenu', async () => {
    const user = userEvent.setup();
    render(
      <GameProvider initialState={createGame('liu', 1)} storage={window.localStorage}>
        <GameShell />
      </GameProvider>,
    );

    fireEvent.contextMenu(screen.getByTestId('map-viewport'), { clientX: 320, clientY: 240 });
    await user.click(screen.getByTestId('map-context-intel-button'));
    await user.click(screen.getByTestId('map-context-global-intel-button'));

    const dialog = screen.getByRole('dialog', { name: '全局情报' });
    expect(screen.queryByTestId('map-context-menu')).not.toBeInTheDocument();
    expect(dialog.closest('.modal-backdrop')).not.toBeNull();
    expect(within(dialog).getByText('刘备')).toBeVisible();
    expect(within(dialog).getByText('江陵')).toBeVisible();
  });

  it('closes the global intelligence popup on right click', async () => {
    const user = userEvent.setup();
    render(
      <GameProvider initialState={createGame('liu', 1)} storage={window.localStorage}>
        <GameShell />
      </GameProvider>,
    );

    fireEvent.contextMenu(screen.getByTestId('map-viewport'), { clientX: 320, clientY: 240 });
    await user.click(screen.getByTestId('map-context-intel-button'));
    await user.click(screen.getByTestId('map-context-global-intel-button'));
    const dialog = screen.getAllByRole('dialog')[0];

    const defaultWasAllowed = fireEvent.contextMenu(dialog);

    expect(defaultWasAllowed).toBe(false);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('saves and loads from the map context menu', async () => {
    const user = userEvent.setup();
    render(
      <GameProvider initialState={createGame('liu', 1)} storage={window.localStorage}>
        <GameShell />
      </GameProvider>,
    );

    fireEvent.contextMenu(screen.getByTestId('map-viewport'), { clientX: 320, clientY: 240 });
    await user.click(within(screen.getByTestId('map-context-menu')).getByRole('button', { name: '储存' }));
    expect(window.localStorage.getItem(MANUAL_SAVE_KEY)).not.toBeNull();

    await user.click(screen.getByTestId('end-ten-day-button'));
    expect(screen.getByTestId('ten-day-label')).toHaveTextContent('中旬');

    fireEvent.contextMenu(screen.getByTestId('map-viewport'), { clientX: 320, clientY: 240 });
    await user.click(within(screen.getByTestId('map-context-menu')).getByRole('button', { name: '载入' }));

    expect(screen.getByTestId('ten-day-label')).toHaveTextContent('上旬');
  });

  it('guides map editing through rule editing, AI export, calibration, and final JSON steps', async () => {
    const user = userEvent.setup();
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    render(
      <GameProvider initialState={createGame('liu', 1)} storage={window.localStorage}>
        <GameShell />
      </GameProvider>,
    );

    zoomToTerrain();
    await user.click(screen.getByRole('button', { name: '地图编辑' }));
    const editor = screen.getByRole('region', { name: '地图编辑器' });
    expect(editor).toBeVisible();
    expect(within(editor).getByRole('heading', { name: '第一步：编辑规则地形' })).toBeVisible();
    expect(within(editor).getByRole('heading', { name: '第二步：导出给 AI 的素材' })).toBeVisible();
    expect(within(editor).getByRole('heading', { name: '第三步：导入生成地图并校准' })).toBeVisible();
    expect(within(editor).getByRole('heading', { name: '第四步：导出最终游戏数据' })).toBeVisible();
    expect(within(editor).getByText('这里编辑的是游戏规则数据，移动、战斗和城市占地都以这些方格为准。')).toBeVisible();
    expect(within(editor).getByText('导出后，把 terrain-control.svg 和所有 mask-*.svg 文件交给 AI，用 san11-map-generation 生成水墨地图图片。')).toBeVisible();
    expect(within(editor).getByText('AI 生成图片后，直接选择图片文件；编辑器会自动显示底图并进入校准模式。')).toBeVisible();

    await user.click(screen.getByRole('button', { name: '山崖' }));
    fireEvent.pointerDown(screen.getByTestId('editor-cell-100-100'), { button: 0, buttons: 1 });
    await user.click(screen.getByRole('button', { name: '城市' }));
    fireEvent.pointerDown(screen.getByTestId('editor-cell-104-100'), { button: 0, buttons: 1 });

    await user.click(screen.getByRole('button', { name: '导出最终游戏地图 JSON' }));
    const exportOutput = screen.getByTestId('map-editor-export');
    const exportValue = (exportOutput as HTMLTextAreaElement).value;

    expect(exportValue).toContain('"terrain": "mountain"');
    expect(exportValue).toContain('"cities"');
    expect(exportValue).toContain('"q": 104');

    await user.click(screen.getByRole('button', { name: '导出 AI 控制图' }));
    const terrainControlValue = (exportOutput as HTMLTextAreaElement).value;
    expect(terrainControlValue).toContain('data-export="terrain-control"');
    expect(terrainControlValue).toContain('data-cell-shape="staggered-square-even-columns-up-half"');
    expect(terrainControlValue).toContain('data-q="100" data-r="100"');
    clickSpy.mockRestore();
  });

  it('closes the map editor popup on right click', async () => {
    const user = userEvent.setup();
    render(
      <GameProvider initialState={createGame('liu', 1)} storage={window.localStorage}>
        <GameShell />
      </GameProvider>,
    );

    zoomToTerrain();
    await user.click(screen.getByTestId('map-editor-toggle-button'));
    const editor = screen.getByTestId('map-editor-panel');

    const defaultWasAllowed = fireEvent.contextMenu(editor);

    expect(defaultWasAllowed).toBe(false);
    expect(screen.queryByTestId('map-editor-panel')).not.toBeInTheDocument();
  });

  it('calibrates terrain markers against a generated map background', async () => {
    const user = userEvent.setup();
    render(
      <GameProvider initialState={createGame('liu', 1)} storage={window.localStorage}>
        <GameShell />
      </GameProvider>,
    );

    zoomToTerrain();
    await user.click(screen.getByRole('button', { name: '地图编辑' }));
    await user.click(screen.getByRole('checkbox', { name: '显示生成地图，进入校准模式' }));
    fireEvent.change(screen.getByLabelText('底图地址'), { target: { value: 'exports/watercolor-map-realistic-preview.png' } });

    const mapImage = screen.getByTestId('map-image');
    expect(mapImage).toHaveAttribute('src', 'exports/watercolor-map-realistic-preview.png');

    await user.click(screen.getByRole('button', { name: '森林' }));
    fireEvent.pointerDown(screen.getByTestId('editor-cell-100-100'), { button: 0, buttons: 1 });
    await user.click(screen.getByRole('button', { name: '导出最终游戏地图 JSON' }));

    const json = JSON.parse((screen.getByTestId('map-editor-export') as HTMLTextAreaElement).value);
    expect(json.backgroundImage).toBe('exports/watercolor-map-realistic-preview.png');
    expect(json.grid.find((cell: { q: number; r: number; terrain: string }) => cell.q === 100 && cell.r === 100)?.terrain).toBe('forest');
  });

  it('uploads a generated map image and enters calibration mode automatically', async () => {
    const user = userEvent.setup();
    const objectUrl = mockObjectUrl('blob:generated-map');

    try {
      render(
        <GameProvider initialState={createGame('liu', 1)} storage={window.localStorage}>
          <GameShell />
        </GameProvider>,
      );

      zoomToTerrain();
      await user.click(screen.getByRole('button', { name: '地图编辑' }));
      const upload = screen.getByLabelText('选择 AI 生成的地图图片');
      const file = new File(['fake image'], 'watercolor-map.png', { type: 'image/png' });

      await user.upload(upload, file);

      expect(objectUrl.createObjectUrl).toHaveBeenCalledWith(file);
      expect(screen.getByRole('checkbox', { name: '显示生成地图，进入校准模式' })).toBeChecked();
      expect(screen.getByTestId('map-image')).toHaveAttribute('src', 'blob:generated-map');
    } finally {
      objectUrl.restore();
    }
  });

  it('imports final map json and applies it to the playable map', async () => {
    const user = userEvent.setup();
    const base = createGame('liu', 1);
    const gridWidth = base.gridWidth ?? 70;
    const gridHeight = base.gridHeight ?? 40;
    const payload = {
      schemaVersion: 1,
      width: gridWidth,
      height: gridHeight,
      backgroundImage: '',
      grid: base.grid.map((cell) => (
        cell.q === 100 && cell.r === 100 ? { ...cell, terrain: 'forest' } : cell
      )),
      cities: [{ id: 'jiangling', label: '江陵', q: 10, r: 12 }],
    };
    render(
      <GameProvider initialState={base} storage={window.localStorage}>
        <GameShell />
      </GameProvider>,
    );

    zoomToTerrain();
    await user.click(screen.getByRole('button', { name: '地图编辑' }));
    await user.upload(
      screen.getByLabelText('导入最终游戏地图 JSON'),
      new File([JSON.stringify(payload)], 'final-map.json', { type: 'application/json' }),
    );

    await waitFor(() => expect(screen.getByText('已导入最终游戏地图 JSON，并应用到当前游戏地图。')).toBeVisible());
    expect(screen.getByTestId('editor-cell-100-100')).toHaveClass('terrain-forest');

    await user.click(screen.getByRole('button', { name: '关闭' }));
    zoomToTerrain();

    expect(screen.getByTestId('map-cell-100-100')).toHaveClass('terrain-forest');
  });

  it('downloads the terrain control svg when exporting the terrain map', async () => {
    const user = userEvent.setup();
    const downloads = mockFileDownloads();

    try {
      render(
        <GameProvider initialState={createGame('liu', 1)} storage={window.localStorage}>
          <GameShell />
        </GameProvider>,
      );

      zoomToTerrain();
      await user.click(screen.getByRole('button', { name: '地图编辑' }));
      await user.click(screen.getByRole('button', { name: '导出 AI 控制图' }));

      expect(downloads.createObjectUrl).toHaveBeenCalledWith(expect.any(Blob));
      const blob = downloads.createObjectUrl.mock.calls[0][0] as Blob;
      await expect(blob.text()).resolves.toContain('data-export="terrain-control"');
      expect(downloads.downloadedNames).toEqual(['terrain-control.svg']);
      expect(downloads.revokeObjectUrl).toHaveBeenCalledWith('blob:download-0');
    } finally {
      downloads.restore();
    }
  });

  it('downloads layered terrain masks for generation control', async () => {
    const user = userEvent.setup();
    const downloads = mockFileDownloads();

    try {
      render(
        <GameProvider initialState={createGame('liu', 1)} storage={window.localStorage}>
          <GameShell />
        </GameProvider>,
      );

      zoomToTerrain();
      await user.click(screen.getByRole('button', { name: '地图编辑' }));
      await user.click(screen.getByRole('button', { name: '导出 AI 分层遮罩' }));

      expect(downloads.downloadedNames).toEqual([
        'mask-water.svg',
        'mask-mountain.svg',
        'mask-forest.svg',
        'mask-road.svg',
        'mask-city.svg',
      ]);
      expect(downloads.createObjectUrl).toHaveBeenCalledTimes(5);
      const firstMask = downloads.createObjectUrl.mock.calls[0][0] as Blob;
      await expect(firstMask.text()).resolves.toContain('data-mask-layer="water"');
    } finally {
      downloads.restore();
    }
  });
});
