import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from '../app/App';
import { deployUnit } from '../game/battle/actions';
import { GRID_HEIGHT as DEFAULT_GRID_HEIGHT, GRID_WIDTH as DEFAULT_GRID_WIDTH } from '../game/battle/scenario';
import { cityPlots, PLOT_BASE_VALUE } from '../game/innerAffairs';
import { initialArmaments } from '../game/armaments';
import { createGame } from '../game/scenario/jingxiang208';
import { GameProvider } from '../game/store/GameProvider';
import type { CityId } from '../game/types';
import { writeSave } from '../game/persistence';
import { buildSlotMeta, slotMetaKey, slotStateKey, writeSlot } from '../game/saveSlots';
import { settleTenDay } from '../game/turn';
import { completeTechResearch } from '../game/techs';
import { GameShell } from './GameShell';
import { OfficerListDialog } from './OfficerListDialog';
import { UnitDetailDialog } from './UnitDetailDialog';
import css from '../styles/global.css?raw';

function cssRule(selector: string) {
  const escapedSelector = selector.replaceAll('.', '\\.');
  return css.match(new RegExp(`${escapedSelector}\\s*\\{([^}]*)\\}`))?.[1] ?? '';
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

  it('shows the home screen with four entry options', () => {
    signInForStartScreen();
    render(<App />);

    expect(screen.getByRole('heading', { name: '建安十三年' })).toBeVisible();
    expect(screen.getByRole('button', { name: /重新开始新游戏/ })).toBeEnabled();
    expect(screen.getByRole('button', { name: /联网对战/ })).toBeEnabled();
    expect(screen.getByRole('button', { name: /编辑地图/ })).toBeEnabled();
    expect(screen.getByRole('button', { name: /载入进度/ })).toBeDisabled();
  });

  it('starts the selected force in the game shell through map → force selection', async () => {
    const user = userEvent.setup();
    signInForStartScreen();
    render(<App />);

    await user.click(screen.getByRole('button', { name: /重新开始新游戏/ }));
    await user.click(screen.getByTestId('map-card-china42x'));
    await user.click(screen.getByRole('button', { name: '选择孙权' }));

    expect(screen.getByText('孙权', { selector: '.top-force-name' })).toBeVisible();
    expect(screen.getByTestId('action-points')).toBeVisible();
    expect(screen.getByRole('region', { name: '军情与政务' })).toBeVisible();
  });

  it('offers continue only for a valid autosave', () => {
    signInForStartScreen();
    writeSave(window.localStorage, 'auto', createGame('cao', 1));

    render(<App />);

    expect(screen.getByRole('button', { name: '继续上次进度' })).toBeEnabled();
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

  it('renders a deployed battle unit and advances the ten-day turn from the map menu', async () => {
    const user = userEvent.setup();
    const deployed = deployUnit(createGame('liu', 1), 'liu', {
      cityId: 'jiangling',
      officerId: 'guan-yu',
      targetCityId: 'xiangyang',
      troopType: 'spear',
      troops: 4000,
      food: 6000,
    });
    render(
      <GameProvider initialState={deployed} storage={window.localStorage}>
        <GameShell />
      </GameProvider>,
    );

    expect(screen.getByTestId('battle-unit-marker')).toBeVisible();
    expect(screen.getByTestId('ten-day-label')).toHaveTextContent('上旬');

    fireEvent.contextMenu(screen.getByTestId('map-viewport'), { clientX: 320, clientY: 180 });
    await user.click(screen.getByTestId('map-context-proceed-button'));

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

    const liuBeiRow = within(panel).getByTestId('force-overview-officer-liu-bei');
    const guanYuRow = within(panel).getByTestId('force-overview-officer-guan-yu');
    expect(liuBeiRow).toHaveClass('has-acted');
    expect(guanYuRow).toHaveClass('is-ready');
  });

  it('centers the map camera on the city/officer/unit row clicked from the overview', async () => {
    const user = userEvent.setup();
    const state = createGame('liu', 1);
    // 部署一支部队，让「部队」tab 有内容可点
    const deployed = deployUnit(state, 'liu', {
      cityId: 'jiangling',
      officerId: 'guan-yu',
      targetCityId: 'wuling',
      troopType: 'sword',
      troops: 3000,
      food: 5000,
    });
    render(
      <GameProvider initialState={deployed} storage={window.localStorage}>
        <GameShell />
      </GameProvider>,
    );

    const panel = screen.getByTestId('force-overview-panel');

    /** 断言：map-content 镜头让指定 (q, r) 落在视口正中（按 jsdom fallback 视口 1280×720 换算） */
    const viewport = { width: 1280, height: 720 };
    function expectCenteredOn(q: number, r: number) {
      const mapContent = screen.getByTestId('map-content');
      const cell = screen.getByTestId(`map-cell-${q}-${r}`);
      const cellSize = Number(cell.getAttribute('width'));
      const viewX = Number.parseFloat(mapContent.getAttribute('data-view-x')!);
      const viewY = Number.parseFloat(mapContent.getAttribute('data-view-y')!);
      const scale = Number.parseFloat(mapContent.style.getPropertyValue('--map-scale'));
      const worldWidth = (state.gridWidth ?? DEFAULT_GRID_WIDTH) * cellSize;
      const worldHeight = (state.gridHeight ?? DEFAULT_GRID_HEIGHT) * cellSize;
      const cssWidth = viewport.width * scale;
      const cssHeight = cssWidth * (worldHeight / worldWidth);
      const left = (viewport.width - cssWidth) / 2 + viewX;
      const top = (viewport.height - cssHeight) / 2 + viewY;
      const centerX = Number(cell.getAttribute('x')) + cellSize / 2;
      const centerY = Number(cell.getAttribute('y')) + cellSize / 2;
      expect(left + (centerX * cssWidth) / worldWidth).toBeCloseTo(viewport.width / 2, 0);
      expect(top + (centerY * cssHeight) / worldHeight).toBeCloseTo(viewport.height / 2, 0);
    }

    // 开局自动居中到玩家势力城池（江陵）
    expectCenteredOn(state.cities.jiangling.gridQ, state.cities.jiangling.gridR);

    // 城池 tab：点击「武陵」应跳到武陵
    await user.click(within(panel).getByTestId('force-overview-city-wuling'));
    expectCenteredOn(state.cities.wuling.gridQ, state.cities.wuling.gridR);

    // 武将 tab：点击张飞（驻扎在武陵）应跳到武陵
    await user.click(within(panel).getByRole('button', { name: '武将' }));
    await user.click(within(panel).getByTestId('force-overview-officer-zhang-fei'));
    expectCenteredOn(state.cities.wuling.gridQ, state.cities.wuling.gridR);

    // 部队 tab：点击部署的部队应跳到部队所在格（guan-yu 从江陵朝 wuling 行军）
    await user.click(within(panel).getByRole('button', { name: '部队' }));
    const unitRow = within(panel).getByTestId('force-overview-units').querySelector('button');
    expect(unitRow).toBeTruthy();
    const unitCell = Object.values(deployed.units)[0]!;
    await user.click(unitRow!);
    expectCenteredOn(unitCell.q, unitCell.r);
  });

  it('marks a field unit and its officers as idle while the unit has neither moved nor acted', async () => {
    const user = userEvent.setup();
    const state = createGame('liu', 1);
    const deployed = deployUnit(state, 'liu', {
      cityId: 'jiangling',
      officerId: 'guan-yu',
      targetCityId: 'wuling',
      troopType: 'sword',
      troops: 3000,
      food: 5000,
    });
    const unit = Object.values(deployed.units)[0]!;
    // 新的一旬：部队与本旬行动标记都已恢复
    unit.acted = false;
    unit.moved = false;
    deployed.officers['guan-yu'].acted = false;
    render(
      <GameProvider initialState={deployed} storage={window.localStorage}>
        <GameShell />
      </GameProvider>,
    );

    const panel = screen.getByTestId('force-overview-panel');
    await user.click(within(panel).getByRole('button', { name: '武将' }));
    expect(within(panel).getByTestId('force-overview-officer-guan-yu')).toHaveClass('is-ready');

    await user.click(within(panel).getByRole('button', { name: '部队' }));
    expect(within(panel).getByTestId(`force-overview-unit-${unit.id}`)).toHaveClass('is-ready');
  });

  it.each([
    ['moved', { moved: true, acted: false }],
    ['acted', { moved: false, acted: true }],
  ])('greys out a field unit and its officers once the unit has %s', async (_label, flags) => {
    const user = userEvent.setup();
    const state = createGame('liu', 1);
    const deployed = deployUnit(state, 'liu', {
      cityId: 'jiangling',
      officerId: 'guan-yu',
      targetCityId: 'wuling',
      troopType: 'sword',
      troops: 3000,
      food: 5000,
    });
    const unit = Object.values(deployed.units)[0]!;
    unit.acted = flags.acted;
    unit.moved = flags.moved;
    // 引擎只在部队进城时同步随军武将的 acted，其它行动路径不会 —— 列表必须自己跟随部队
    deployed.officers['guan-yu'].acted = false;
    render(
      <GameProvider initialState={deployed} storage={window.localStorage}>
        <GameShell />
      </GameProvider>,
    );

    const panel = screen.getByTestId('force-overview-panel');
    await user.click(within(panel).getByRole('button', { name: '武将' }));
    expect(within(panel).getByTestId('force-overview-officer-guan-yu')).toHaveClass('has-acted');

    await user.click(within(panel).getByRole('button', { name: '部队' }));
    expect(within(panel).getByTestId(`force-overview-unit-${unit.id}`)).toHaveClass('has-acted');
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

  it('部队情报吃科技：研究「机械」后兵种与随身兵装显示「木兽」而非「冲车」', () => {
    const game = createGame('liu', 1);
    game.cities['jiangling'].armaments = { ...initialArmaments(), ram: 5 };
    const state = deployUnit(game, 'liu', {
      cityId: 'jiangling',
      officerId: 'liu-bei',
      troopType: 'siege',
      siegeWeapon: 'ram',
      troops: 4000,
      food: 6000,
    });
    const unit = Object.values(state.units)[0];
    unit.armaments = { ...(unit.armaments ?? {}), ram: 1 };

    // 对照：未研究「机械」时仍是「冲车」
    const first = render(<UnitDetailDialog unit={unit} state={state} onClose={vi.fn()} />);
    let dialog = screen.getByTestId('unit-detail-dialog');
    const detailRow = (label: string) => within(dialog).getByText(label, { selector: 'dt' }).closest('div')!;
    expect(detailRow('兵种')).toHaveTextContent('冲车');
    expect(detailRow('随身兵装')).toHaveTextContent('冲车 1');
    first.unmount();

    completeTechResearch(state, 'liu', 'jixie');
    render(<UnitDetailDialog unit={unit} state={state} onClose={vi.fn()} />);
    dialog = screen.getByTestId('unit-detail-dialog');
    const upgradedRow = (label: string) => within(dialog).getByText(label, { selector: 'dt' }).closest('div')!;
    expect(upgradedRow('兵种')).toHaveTextContent('木兽');
    // 只换显示名：随身兵装的存储字段仍是 ram，数量不变
    expect(upgradedRow('随身兵装')).toHaveTextContent('木兽 1');
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
    expect(within(dialog).getByTitle('刘备 · 魅力99')).toBeVisible();
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
    // 默认页签只放我方军情，AI 势力的记录收在「他方」页签里
    await user.click(within(eventLog).getByRole('button', { name: '他方' }));
    expect(within(eventLog).getAllByRole('listitem').some((item) => {
      const swatch = item.querySelector('i') as HTMLElement | null;
      return swatch ? aiForceColors.includes(swatch.style.backgroundColor) || aiForceColors.includes(swatch.style.backgroundColor.toLowerCase()) : false;
    })).toBe(true);
  });

  it('点「进行」时若尚有未行动的委任部队：界面最下方弹原版式横幅、鼠标处弹是/否，点「是」才推进', async () => {
    const user = userEvent.setup();
    const state = deployUnit(createGame('liu', 1), 'liu', {
      cityId: 'jiangling',
      officerIds: ['liu-bei'],
      troopType: 'spear',
      troops: 4000,
      food: 6000,
    });
    // 一支「已委任移动、本旬尚未行动」的部队 —— 正是原版提示的触发条件
    const unit = Object.values(state.units)[0];
    unit.delegate = { kind: 'move', target: { q: unit.q + 2, r: unit.r } };
    unit.moved = false;
    unit.acted = false;
    unit.movementRemaining = 20;

    render(
      <GameProvider initialState={state} storage={window.localStorage}>
        <GameShell />
      </GameProvider>,
    );

    const openProceed = () => {
      fireEvent.contextMenu(screen.getByTestId('map-viewport'), { clientX: 320, clientY: 240 });
      expect(screen.getByTestId('map-context-proceed-button')).toBeVisible();
    };

    expect(screen.getByTestId('ten-day-label')).toHaveTextContent('上旬');
    openProceed();
    await user.click(screen.getByTestId('map-context-proceed-button'));

    // 尚未推进：界面最下方出现原版式横幅（势力名高亮），鼠标处出现是/否
    expect(screen.getByTestId('ten-day-label')).toHaveTextContent('上旬');
    const banner = screen.getByTestId('strategy-end-banner');
    expect(banner).toHaveTextContent('将结束刘备军的战略，');
    expect(banner).toHaveTextContent('有尚未行动的部队存在，');
    expect(banner).toHaveTextContent('请问是否确定？');
    expect(within(screen.getByTestId('proceed-confirm-menu')).getByTestId('proceed-confirm-no')).toBeVisible();

    // 点「否」→ 只收提示，不推进
    await user.click(screen.getByTestId('proceed-confirm-no'));
    expect(screen.queryByTestId('strategy-end-banner')).toBeNull();
    expect(screen.queryByTestId('proceed-confirm-menu')).toBeNull();
    expect(screen.getByTestId('ten-day-label')).toHaveTextContent('上旬');

    // 再来一次，这次点「是」→ 直接推进一旬
    openProceed();
    await user.click(screen.getByTestId('map-context-proceed-button'));
    await user.click(screen.getByTestId('proceed-confirm-yes'));
    expect(screen.queryByTestId('strategy-end-banner')).toBeNull();
    expect(screen.getByTestId('ten-day-label')).toHaveTextContent('中旬');
  });

  it('尚未行动但未委任的部队不触发「进行」确认（判据是委任部队）', async () => {
    const user = userEvent.setup();
    const state = deployUnit(createGame('liu', 1), 'liu', {
      cityId: 'jiangling',
      officerIds: ['liu-bei'],
      troopType: 'spear',
      troops: 4000,
      food: 6000,
    });
    const unit = Object.values(state.units)[0];
    unit.moved = false;
    unit.acted = false;

    render(
      <GameProvider initialState={state} storage={window.localStorage}>
        <GameShell />
      </GameProvider>,
    );

    fireEvent.contextMenu(screen.getByTestId('map-viewport'), { clientX: 320, clientY: 240 });
    await user.click(screen.getByTestId('map-context-proceed-button'));
    expect(screen.queryByTestId('strategy-end-banner')).toBeNull();
    expect(screen.getByTestId('ten-day-label')).toHaveTextContent('中旬');
  });

  it('splits the 军情与政务 info bar into 我方 / 他方 tabs and defaults to 我方', async () => {
    const user = userEvent.setup();
    const initialState = createGame('liu', 1);
    initialState.logs = [
      { id: 'own-log', month: 1, forceId: 'liu', message: '我方军情：江陵完成巡察' },
      { id: 'other-log', month: 1, forceId: 'cao', message: '他方军情：宛城出兵' },
      { id: 'global-log', month: 1, forceId: null, message: '全局通告：进入上旬' },
    ];

    render(
      <GameProvider initialState={initialState} storage={window.localStorage}>
        <GameShell />
      </GameProvider>,
    );

    const eventLog = screen.getByRole('region', { name: '军情与政务' });
    const ownTab = within(eventLog).getByTestId('event-log-tab-own');
    const othersTab = within(eventLog).getByTestId('event-log-tab-others');

    // 默认停在「我方」：本方记录 + 全局通告可见，其他势力的记录不出现
    expect(ownTab).toHaveAttribute('aria-pressed', 'true');
    expect(within(eventLog).getByText('我方军情：江陵完成巡察')).toBeVisible();
    expect(within(eventLog).getByText('全局通告：进入上旬')).toBeVisible();
    expect(within(eventLog).queryByText('他方军情：宛城出兵')).not.toBeInTheDocument();

    await user.click(othersTab);

    expect(othersTab).toHaveAttribute('aria-pressed', 'true');
    expect(within(eventLog).getByText('他方军情：宛城出兵')).toBeVisible();
    expect(within(eventLog).queryByText('我方军情：江陵完成巡察')).not.toBeInTheDocument();
    expect(within(eventLog).queryByText('全局通告：进入上旬')).not.toBeInTheDocument();
  });

  it('shows an empty hint in the 他方 tab when no other force has reported', async () => {
    const user = userEvent.setup();
    const initialState = createGame('liu', 1);
    initialState.logs = [{ id: 'own-log', month: 1, forceId: 'liu', message: '我方军情：江陵完成巡察' }];

    render(
      <GameProvider initialState={initialState} storage={window.localStorage}>
        <GameShell />
      </GameProvider>,
    );

    const eventLog = screen.getByRole('region', { name: '军情与政务' });
    await user.click(within(eventLog).getByTestId('event-log-tab-others'));

    expect(within(eventLog).getByText('暂无其他势力的军情')).toBeVisible();
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

  it('saves into a chosen slot and loads it back from the map context menu', async () => {
    const user = userEvent.setup();
    render(
      <GameProvider initialState={createGame('liu', 1)} storage={window.localStorage}>
        <GameShell />
      </GameProvider>,
    );

    fireEvent.contextMenu(screen.getByTestId('map-viewport'), { clientX: 320, clientY: 240 });
    await user.click(within(screen.getByTestId('map-context-menu')).getByRole('button', { name: '储存' }));

    const dialog = await screen.findByTestId('save-load-dialog');
    // 默认停在第一页
    expect(within(dialog).getByTestId('save-slot-1')).toBeVisible();
    await user.click(within(dialog).getByTestId('save-page-3'));
    await user.click(within(dialog).getByTestId('save-slot-19'));
    await user.click(within(dialog).getByTestId('save-confirm-submit'));

    await waitFor(() => {
      expect(window.localStorage.getItem(slotStateKey(19))).not.toBeNull();
      expect(window.localStorage.getItem(slotMetaKey(19))).not.toBeNull();
    });

    // 保存完成即退出到游戏界面，不再停留在存档列表页
    await waitFor(() => {
      expect(screen.queryByTestId('save-load-dialog')).not.toBeInTheDocument();
    });

    fireEvent.contextMenu(screen.getByTestId('map-viewport'), { clientX: 320, clientY: 180 });
    await user.click(screen.getByTestId('map-context-proceed-button'));
    expect(screen.getByTestId('ten-day-label')).toHaveTextContent('中旬');

    fireEvent.contextMenu(screen.getByTestId('map-viewport'), { clientX: 320, clientY: 240 });
    await user.click(within(screen.getByTestId('map-context-menu')).getByRole('button', { name: '载入' }));

    // 载入沿用同一套界面，并自动停在最近一次保存所在页
    const loadDialog = await screen.findByTestId('save-load-dialog');
    await user.click(await within(loadDialog).findByTestId('save-slot-19'));

    await waitFor(() => {
      expect(screen.queryByTestId('save-load-dialog')).not.toBeInTheDocument();
    });
    expect(screen.getByTestId('ten-day-label')).toHaveTextContent('上旬');
  });

  it('warns before overwriting an occupied save slot', async () => {
    const user = userEvent.setup();
    const state = createGame('liu', 1);
    state.month = 4;
    await writeSlot(window.localStorage, 2, state, buildSlotMeta(state, { slot: 2, note: '旧档' }));

    render(
      <GameProvider initialState={createGame('liu', 1)} storage={window.localStorage}>
        <GameShell />
      </GameProvider>,
    );

    fireEvent.contextMenu(screen.getByTestId('map-viewport'), { clientX: 320, clientY: 240 });
    await user.click(within(screen.getByTestId('map-context-menu')).getByRole('button', { name: '储存' }));

    const dialog = await screen.findByTestId('save-load-dialog');
    await user.click(within(dialog).getByTestId('save-slot-2'));
    expect(within(dialog).getByTestId('save-confirm')).toHaveTextContent('覆盖');

    await user.click(within(dialog).getByRole('button', { name: '取消' }));
    expect(within(dialog).queryByTestId('save-confirm')).not.toBeInTheDocument();
  });

  it('restores the exact camera position that was saved with the slot', async () => {
    const user = userEvent.setup();
    render(
      <GameProvider initialState={createGame('liu', 1)} storage={window.localStorage}>
        <GameShell />
      </GameProvider>,
    );

    const readView = () => {
      const content = screen.getByTestId('map-content');
      return {
        x: Number.parseFloat(content.getAttribute('data-view-x') ?? '0'),
        y: Number.parseFloat(content.getAttribute('data-view-y') ?? '0'),
        scale: Number.parseFloat(content.style.getPropertyValue('--map-scale')),
      };
    };

    // 缩放到最低角度并向右上平移，得到与开局默认镜头不同的视角
    const viewport = screen.getByTestId('map-viewport');
    fireEvent.wheel(viewport, { deltaY: -240 });
    fireEvent.pointerDown(viewport, { pointerId: 1, button: 0, buttons: 1, clientX: 640, clientY: 360 });
    fireEvent.pointerMove(viewport, { pointerId: 1, clientX: 480, clientY: 280 });
    fireEvent.pointerUp(viewport, { pointerId: 1 });
    const savedView = readView();
    const defaultView = { x: 0, y: 0, scale: savedView.scale };
    expect(savedView.x).not.toBeCloseTo(defaultView.x, 0);

    fireEvent.contextMenu(viewport, { clientX: 320, clientY: 240 });
    await user.click(within(screen.getByTestId('map-context-menu')).getByRole('button', { name: '储存' }));
    const dialog = await screen.findByTestId('save-load-dialog');
    await user.click(within(dialog).getByTestId('save-slot-7'));
    await user.click(within(dialog).getByTestId('save-confirm-submit'));
    await waitFor(() => expect(window.localStorage.getItem(slotStateKey(7))).not.toBeNull());
    // 保存完成即退出到游戏界面
    await waitFor(() => expect(screen.queryByTestId('save-load-dialog')).not.toBeInTheDocument());

    // 把镜头复位到地图中心，确保接下来的还原真的来自存档而不是残留状态
    await user.click(screen.getByRole('button', { name: '复位地图' }));
    expect(readView().x).toBeCloseTo(0, 0);

    fireEvent.contextMenu(viewport, { clientX: 320, clientY: 240 });
    await user.click(within(screen.getByTestId('map-context-menu')).getByRole('button', { name: '载入' }));
    const loadDialog = await screen.findByTestId('save-load-dialog');
    await user.click(await within(loadDialog).findByTestId('save-slot-7'));
    await waitFor(() => expect(screen.queryByTestId('save-load-dialog')).not.toBeInTheDocument());

    await waitFor(() => {
      const restored = readView();
      expect(restored.x).toBeCloseTo(savedView.x, 4);
      expect(restored.y).toBeCloseTo(savedView.y, 4);
      expect(restored.scale).toBeCloseTo(savedView.scale, 4);
    });
  });

  it('shows the selected save detail with force info and a force map', async () => {
    const user = userEvent.setup();
    const state = createGame('liu', 1);
    await writeSlot(window.localStorage, 5, state, buildSlotMeta(state, { slot: 5, playSeconds: 125 }));

    render(
      <GameProvider initialState={createGame('cao', 1)} storage={window.localStorage}>
        <GameShell />
      </GameProvider>,
    );

    fireEvent.contextMenu(screen.getByTestId('map-viewport'), { clientX: 320, clientY: 240 });
    await user.click(within(screen.getByTestId('map-context-menu')).getByRole('button', { name: '储存' }));

    const dialog = await screen.findByTestId('save-load-dialog');
    // 未选中槽位时右侧回落到「当前进度」
    expect(within(dialog).getByTestId('save-detail-slot')).toHaveTextContent('--');

    await user.click(within(dialog).getByTestId('save-slot-5'));
    expect(within(dialog).getByTestId('save-detail-slot')).toHaveTextContent('05');
    // 势力图打点覆盖全部城池，并按存档里的势力着色
    expect(within(dialog).getByTestId('save-force-map').querySelectorAll('.save-force-dot').length)
      .toBe(Object.keys(state.cities).length);
    expect(within(dialog).getAllByText(state.forces[state.playerForceId].name).length).toBeGreaterThan(0);
    expect(within(dialog).getByText('1人游玩')).toBeVisible();
    expect(within(dialog).getByText('0:02:05')).toBeVisible();
  });

  it('右侧信息跟随鼠标悬停的存档，而不是固定显示最新存档', async () => {
    const user = userEvent.setup();
    const state5 = createGame('liu', 1);
    const state9 = createGame('cao', 1);
    await writeSlot(window.localStorage, 5, state5, buildSlotMeta(state5, { slot: 5, playSeconds: 125 }));
    await writeSlot(window.localStorage, 9, state9, buildSlotMeta(state9, { slot: 9, playSeconds: 7200 }));

    render(
      <GameProvider initialState={createGame('sun', 1)} storage={window.localStorage}>
        <GameShell />
      </GameProvider>,
    );

    fireEvent.contextMenu(screen.getByTestId('map-viewport'), { clientX: 320, clientY: 240 });
    await user.click(within(screen.getByTestId('map-context-menu')).getByRole('button', { name: '载入' }));

    const dialog = await screen.findByTestId('save-load-dialog');
    // 载入模式默认选中最近存档（9 号在第 2 页）
    expect(within(dialog).getByTestId('save-detail-slot')).toHaveTextContent('09');
    expect(within(dialog).getByText('2:00:00')).toBeVisible();

    await user.click(within(dialog).getByTestId('save-page-1'));
    const slot5 = within(dialog).getByTestId('save-slot-5');

    // 鼠标扫过 5 号 → 右侧立即切换到 5 号存档，且出现悬停高亮
    fireEvent.mouseOver(slot5, { relatedTarget: document.body });
    expect(slot5.className).toContain('is-previewed');
    expect(within(dialog).getByTestId('save-detail-slot')).toHaveTextContent('05');
    expect(within(dialog).getByText('0:02:05')).toBeVisible();

    // 移开后回落到「已选中」的 9 号，而不是停在 5 号
    fireEvent.mouseOut(slot5, { relatedTarget: document.body });
    expect(slot5.className).not.toContain('is-previewed');
    expect(within(dialog).getByTestId('save-detail-slot')).toHaveTextContent('09');
    expect(within(dialog).getByText('2:00:00')).toBeVisible();

    // 翻页后不得残留上一页的悬停预览（槽位行被卸载，mouseleave 不会触发）
    fireEvent.mouseOver(slot5, { relatedTarget: document.body });
    expect(within(dialog).getByTestId('save-detail-slot')).toHaveTextContent('05');
    await user.click(within(dialog).getByTestId('save-page-2'));
    expect(within(dialog).getByTestId('save-detail-slot')).toHaveTextContent('09');
  });
});

describe('OfficerListDialog 空城所属武将', () => {
  it('显式传入空 officerIds 时不回退显示我方势力武将', () => {
    const state = createGame('liu', 1);
    const playerLeaderId = state.forces[state.playerForceId].leaderId;
    const playerLeaderName = state.officers[playerLeaderId].name;
    render(
      <GameProvider initialState={state}>
        <OfficerListDialog officerIds={[]} onClose={() => {}} />
      </GameProvider>,
    );
    const dialog = screen.getByRole('dialog');
    // 空列表：不应显示任何武将行，更不应回退到玩家势力武将
    expect(within(dialog).queryAllByRole('rowheader')).toHaveLength(0);
    expect(within(dialog).queryByText(playerLeaderName)).not.toBeInTheDocument();
    // 标题为通用「所属武将」，而非玩家势力名
    expect(within(dialog).getByText('所属武将')).toBeInTheDocument();
  });
});

describe('空城武将入口', () => {
  it('无主城池的「势力武将」为禁用状态，避免显示我方武将', () => {
    const state = createGame('liu', 1);
    // 洛阳为开局无主城
    expect(state.cities.luoyang.ownerId).toBeNull();
    render(
      <GameProvider initialState={state}>
        <GameShell />
      </GameProvider>,
    );

    const marker = screen.getAllByTestId('city-marker').find((node) => node.textContent?.includes('洛阳'));
    expect(marker).toBeTruthy();
    fireEvent.contextMenu(marker!);

    const menu = screen.getByTestId('city-info-menu');
    // 无主城没有所属势力 → 势力武将不可点（不再回退显示我方武将）
    expect(within(menu).getByTestId('city-info-force-officers-button')).toBeDisabled();
    // 所属武将仍可查看（空城则显示空列表）
    expect(within(menu).getByTestId('city-info-officers-button')).toBeEnabled();
  });
});
