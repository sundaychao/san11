import { beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from '../app/App';
import { createGame } from '../game/scenario/jingxiang208';
import { GameProvider } from '../game/store/GameProvider';
import { MANUAL_SAVE_KEY, writeSave } from '../game/persistence';
import { GameShell } from './GameShell';

describe('game interface shell', () => {
  beforeEach(() => window.localStorage.clear());

  it('offers all four playable forces', () => {
    render(<App />);

    expect(screen.getByRole('heading', { name: '建安十三年：荆襄争夺' })).toBeVisible();
    for (const name of ['曹操', '刘备', '孙权', '刘表']) {
      expect(screen.getByRole('button', { name: `选择${name}` })).toBeEnabled();
    }
  });

  it('starts the selected force in the game shell', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole('button', { name: '选择孙权' }));

    expect(screen.getByText('孙权', { selector: '.top-force-name' })).toBeVisible();
    expect(screen.getByRole('button', { name: '进行到下月' })).toBeEnabled();
    expect(screen.getByRole('region', { name: '军情与政务' })).toBeVisible();
  });

  it('offers continue only for a valid autosave', () => {
    writeSave(window.localStorage, 'auto', createGame('cao', 1));

    render(<App />);

    expect(screen.getByRole('button', { name: '继续游戏' })).toBeEnabled();
  });

  it('reports and can clear an unreadable save', async () => {
    const user = userEvent.setup();
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

  it('renders the battle map without a raster background image for now', () => {
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
    expect(within(menu).getByRole('button', { name: '巡查' })).toBeVisible();

    await user.click(within(menu).getByRole('button', { name: '军事' }));
    expect(within(menu).getByRole('button', { name: '训练' })).toBeVisible();
    expect(within(menu).getByRole('button', { name: '出征' })).toBeVisible();

    await user.click(within(menu).getByRole('button', { name: '人才' }));
    expect(within(menu).getByRole('button', { name: '探索人才' })).toBeVisible();
    expect(within(menu).getByRole('button', { name: '调动' })).toBeVisible();
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

  it('closes the current city command menu level on each right click', async () => {
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

    await user.pointer({ keys: '[MouseRight]', target: menu });
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

  it('opens intelligence from the map context menu', async () => {
    const user = userEvent.setup();
    render(
      <GameProvider initialState={createGame('liu', 1)} storage={window.localStorage}>
        <GameShell />
      </GameProvider>,
    );

    fireEvent.contextMenu(screen.getByTestId('map-viewport'), { clientX: 320, clientY: 240 });
    await user.click(within(screen.getByTestId('map-context-menu')).getByRole('button', { name: '情报' }));

    const dialog = screen.getByRole('dialog', { name: '情报' });
    expect(within(dialog).getByText('刘备')).toBeVisible();
    expect(within(dialog).getByText('江陵')).toBeVisible();
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

  it('edits map cells and exports the edited grid from the map editor', async () => {
    const user = userEvent.setup();
    render(
      <GameProvider initialState={createGame('liu', 1)} storage={window.localStorage}>
        <GameShell />
      </GameProvider>,
    );

    await user.click(screen.getByRole('button', { name: '地图编辑' }));
    expect(screen.getByRole('region', { name: '地图编辑器' })).toBeVisible();

    await user.click(screen.getByRole('button', { name: '高山' }));
    fireEvent.pointerDown(screen.getByTestId('editor-cell-0-0'), { button: 0, buttons: 1 });
    await user.click(screen.getByRole('button', { name: '城市' }));
    fireEvent.pointerDown(screen.getByTestId('editor-cell-4-4'), { button: 0, buttons: 1 });

    await user.click(screen.getByRole('button', { name: '导出 JSON' }));
    const exportOutput = screen.getByTestId('map-editor-export');
    const exportValue = (exportOutput as HTMLTextAreaElement).value;

    expect(exportValue).toContain('"terrain": "mountain"');
    expect(exportValue).toContain('"cities"');
    expect(exportValue).toContain('"q": 4');

    await user.click(screen.getByRole('button', { name: '导出地形图' }));
    const terrainControlValue = (exportOutput as HTMLTextAreaElement).value;
    expect(terrainControlValue).toContain('data-export="terrain-control"');
    expect(terrainControlValue).toContain('data-cell-shape="staggered-square-even-columns-up-half"');
    expect(terrainControlValue).toContain('data-q="0" data-r="0"');
  });
});
