import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from '../app/App';
import { createGame } from '../game/scenario/jingxiang208';
import { GameProvider } from '../game/store/GameProvider';
import { MANUAL_SAVE_KEY, writeSave } from '../game/persistence';
import { GameShell } from './GameShell';

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

describe('game interface shell', () => {
  beforeEach(() => window.localStorage.clear());

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
    expect(within(menu).getByRole('button', { name: '探索人才' })).toBeVisible();
    expect(within(menu).getByRole('button', { name: '调动' })).toBeVisible();
  });

  it('opens a recruit officer selection dialog from the urban city menu', async () => {
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
    await user.click(within(menu).getByRole('button', { name: '都市' }));
    await user.click(within(menu).getByRole('button', { name: '征兵' }));

    const dialog = screen.getByRole('dialog', { name: '征兵' });
    expect(within(dialog).getByLabelText('执行武将')).toBeVisible();
    expect(within(dialog).getByRole('button', { name: '执行征兵' })).toBeEnabled();
  });

  it('shows temporary city gain numbers after recruit and armament production', () => {
    vi.useFakeTimers();
    try {
      render(
        <GameProvider initialState={createGame('liu', 1)} storage={window.localStorage}>
          <GameShell />
        </GameProvider>,
      );

      const jianglingMarker = screen.getAllByTestId('city-marker').find((marker) => marker.textContent?.includes('江陵'));
      expect(jianglingMarker).toBeTruthy();
      fireEvent.click(jianglingMarker!);
      fireEvent.click(within(screen.getByTestId('city-command-menu')).getByRole('button', { name: '都市' }));
      fireEvent.click(within(screen.getByTestId('city-command-menu')).getByRole('button', { name: '征兵' }));
      fireEvent.click(within(screen.getByRole('dialog', { name: '征兵' })).getByRole('button', { name: '执行征兵' }));

      const recruitEffect = screen.getByTestId('city-effect-number');
      expect(recruitEffect).toHaveTextContent('士兵 +1,290');
      expect(recruitEffect.closest('[data-testid="city-marker"]')).toBe(jianglingMarker);

      act(() => vi.advanceTimersByTime(2000));
      expect(screen.queryByTestId('city-effect-number')).not.toBeInTheDocument();

      fireEvent.click(jianglingMarker!);
      fireEvent.click(within(screen.getByTestId('city-command-menu')).getByRole('button', { name: '都市' }));
      fireEvent.click(within(screen.getByTestId('city-command-menu')).getByRole('button', { name: '生产兵装' }));

      const dialog = screen.getByRole('dialog', { name: '生产兵装' });
      expect(within(dialog).getByLabelText('执行武将')).toBeVisible();
      fireEvent.click(within(dialog).getByRole('button', { name: '弩' }));
      fireEvent.click(within(dialog).getByRole('button', { name: '执行生产兵装' }));

      expect(screen.queryByRole('dialog', { name: '生产兵装' })).not.toBeInTheDocument();
      expect(screen.getByText(/生产江陵弩/)).toBeVisible();
      expect(screen.getByTestId('city-effect-number')).toHaveTextContent('弩 +1,696');

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

  it('closes the whole city command menu on any right click', async () => {
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

    const defaultWasAllowed = fireEvent.contextMenu(menu);
    expect(defaultWasAllowed).toBe(false);
    expect(screen.queryByTestId('city-command-menu')).not.toBeInTheDocument();
    return;
    expect(within(menu).queryByRole('button', { name: '出征' })).not.toBeInTheDocument();
    expect(screen.getByTestId('city-command-menu')).toBeVisible();

    await user.pointer({ keys: '[MouseRight]', target: menu });
    expect(screen.queryByTestId('city-command-menu')).not.toBeInTheDocument();
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

    fireEvent.mouseDown(screen.getByTestId('map-viewport'), { button: 0 });
    expect(within(menu).queryByRole('button', { name: '出征' })).not.toBeInTheDocument();
    expect(screen.getByTestId('city-command-menu')).toBeVisible();

    fireEvent.mouseDown(screen.getByTestId('map-viewport'), { button: 0 });
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
    const aiForceColors = ['#4f9eae', '#c65e51', '#6ba35f', 'rgb(79, 158, 174)', 'rgb(198, 94, 81)', 'rgb(107, 163, 95)'];
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

    await user.click(screen.getByRole('button', { name: '高山' }));
    fireEvent.pointerDown(screen.getByTestId('editor-cell-0-0'), { button: 0, buttons: 1 });
    await user.click(screen.getByRole('button', { name: '城市' }));
    fireEvent.pointerDown(screen.getByTestId('editor-cell-4-4'), { button: 0, buttons: 1 });

    await user.click(screen.getByRole('button', { name: '导出最终游戏地图 JSON' }));
    const exportOutput = screen.getByTestId('map-editor-export');
    const exportValue = (exportOutput as HTMLTextAreaElement).value;

    expect(exportValue).toContain('"terrain": "mountain"');
    expect(exportValue).toContain('"cities"');
    expect(exportValue).toContain('"q": 4');

    await user.click(screen.getByRole('button', { name: '导出 AI 控制图' }));
    const terrainControlValue = (exportOutput as HTMLTextAreaElement).value;
    expect(terrainControlValue).toContain('data-export="terrain-control"');
    expect(terrainControlValue).toContain('data-cell-shape="staggered-square-even-columns-up-half"');
    expect(terrainControlValue).toContain('data-q="0" data-r="0"');
    clickSpy.mockRestore();
  });

  it('closes the map editor popup on right click', async () => {
    const user = userEvent.setup();
    render(
      <GameProvider initialState={createGame('liu', 1)} storage={window.localStorage}>
        <GameShell />
      </GameProvider>,
    );

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

    await user.click(screen.getByRole('button', { name: '地图编辑' }));
    await user.click(screen.getByRole('checkbox', { name: '显示生成地图，进入校准模式' }));
    fireEvent.change(screen.getByLabelText('底图地址'), { target: { value: 'exports/watercolor-map-realistic-preview.png' } });

    const mapImage = screen.getByTestId('map-image');
    expect(mapImage).toHaveAttribute('src', 'exports/watercolor-map-realistic-preview.png');

    await user.click(screen.getByRole('button', { name: '森林' }));
    fireEvent.pointerDown(screen.getByTestId('editor-cell-0-0'), { button: 0, buttons: 1 });
    await user.click(screen.getByRole('button', { name: '导出最终游戏地图 JSON' }));

    const json = JSON.parse((screen.getByTestId('map-editor-export') as HTMLTextAreaElement).value);
    expect(json.backgroundImage).toBe('exports/watercolor-map-realistic-preview.png');
    expect(json.grid.find((cell: { q: number; r: number; terrain: string }) => cell.q === 0 && cell.r === 0)?.terrain).toBe('forest');
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
    const payload = {
      schemaVersion: 1,
      width: 70,
      height: 40,
      backgroundImage: '',
      grid: base.grid.map((cell) => (
        cell.q === 0 && cell.r === 0 ? { ...cell, terrain: 'forest' } : cell
      )),
      cities: [{ id: 'jiangling', label: '江陵', q: 10, r: 12 }],
    };
    render(
      <GameProvider initialState={base} storage={window.localStorage}>
        <GameShell />
      </GameProvider>,
    );

    await user.click(screen.getByRole('button', { name: '地图编辑' }));
    await user.upload(
      screen.getByLabelText('导入最终游戏地图 JSON'),
      new File([JSON.stringify(payload)], 'final-map.json', { type: 'application/json' }),
    );

    await waitFor(() => expect(screen.getByText('已导入最终游戏地图 JSON，并应用到当前游戏地图。')).toBeVisible());
    expect(screen.getByTestId('editor-cell-0-0')).toHaveClass('terrain-forest');

    await user.click(screen.getByRole('button', { name: '关闭' }));

    expect(screen.getByTestId('map-cell-0-0')).toHaveClass('terrain-forest');
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

      await user.click(screen.getByRole('button', { name: '地图编辑' }));
      await user.click(screen.getByRole('button', { name: '导出 AI 分层遮罩' }));

      expect(downloads.downloadedNames).toEqual([
        'mask-water.svg',
        'mask-shallow-water.svg',
        'mask-mountain.svg',
        'mask-forest.svg',
        'mask-road.svg',
        'mask-city.svg',
      ]);
      expect(downloads.createObjectUrl).toHaveBeenCalledTimes(6);
      const firstMask = downloads.createObjectUrl.mock.calls[0][0] as Blob;
      await expect(firstMask.text()).resolves.toContain('data-mask-layer="water"');
    } finally {
      downloads.restore();
    }
  });
});
