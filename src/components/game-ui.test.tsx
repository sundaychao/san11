import { beforeEach, describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from '../app/App';
import { createGame } from '../game/scenario/jingxiang208';
import { GameProvider } from '../game/store/GameProvider';
import { writeSave } from '../game/persistence';
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
});
