import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { createGame } from '../game/scenario/jingxiang208';
import { GameProvider } from '../game/store/GameProvider';
import { GameShell } from './GameShell';

function renderGame() {
  return render(
    <GameProvider initialState={createGame('liu', 1)}>
      <GameShell />
    </GameProvider>,
  );
}

describe('StrategicMap', () => {
  it('selects a city from its map marker', async () => {
    const user = userEvent.setup();
    renderGame();

    await user.click(screen.getByRole('button', { name: /江陵.*刘备/ }));

    expect(screen.getByRole('heading', { name: '江陵' })).toBeVisible();
    expect(screen.getByText('13,500')).toBeVisible();
  });

  it('zooms the image and city layer together', () => {
    renderGame();
    const viewport = screen.getByTestId('map-viewport');

    fireEvent.wheel(viewport, { deltaY: -120 });

    expect(screen.getByTestId('map-content').style.transform).toContain('scale(1.15)');
  });

  it('keeps zoom within the supported range', async () => {
    const user = userEvent.setup();
    renderGame();

    const zoomOut = screen.getByRole('button', { name: '缩小地图' });
    for (let index = 0; index < 5; index += 1) await user.click(zoomOut);

    expect(screen.getByTestId('map-content').style.transform).toContain('scale(0.85)');
  });

  it('shows all six management commands for an owned city', () => {
    renderGame();

    for (const command of ['开发', '征兵', '训练', '巡察', '人才', '调动']) {
      expect(screen.getByRole('button', { name: command })).toBeVisible();
    }
  });
});
