import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { createGame } from '../game/scenario/jingxiang208';
import { GameProvider } from '../game/store/GameProvider';
import type { TerrainType } from '../game/types';
import { GameShell } from './GameShell';

const TERRAIN_LABELS: Record<TerrainType, string> = {
  road: '道路',
  plain: '平地',
  forest: '森林',
  hill: '丘陵',
  mountain: '高山',
  deepWater: '水域',
};

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

  it('shows the hovered grid coordinate at the bottom center of the interface', async () => {
    const user = userEvent.setup();
    renderGame();

    const jianglingMarker = screen.getAllByTestId('city-marker').find((marker) => marker.textContent?.includes('江陵'));
    expect(jianglingMarker).toBeTruthy();
    await user.click(jianglingMarker!);
    await user.click(screen.getByRole('button', { name: '军事' }));
    await user.click(screen.getByRole('button', { name: '出征' }));
    await user.click(screen.getByRole('button', { name: '确定出征' }));

    const deploymentCell = screen.getAllByTestId(/deploy-target-/)[0];
    const [, q, r] = deploymentCell.getAttribute('data-testid')!.match(/deploy-target-(\d+)-(\d+)/)!;
    const terrain = [...deploymentCell.classList].find((className) => className.startsWith('terrain-'))?.replace('terrain-', '') as TerrainType;
    fireEvent.pointerEnter(deploymentCell);

    expect(screen.getByTestId('hover-coordinate')).toHaveTextContent(`坐标：${q},${r} 地形：${TERRAIN_LABELS[terrain]}`);

    fireEvent.pointerLeave(screen.getByTestId('map-viewport'));

    expect(screen.queryByTestId('hover-coordinate')).not.toBeInTheDocument();
  });

  it('shows all six management commands for an owned city', () => {
    renderGame();

    for (const command of ['开发', '征兵', '训练', '巡察', '人才', '调动']) {
      expect(screen.getByRole('button', { name: command })).toBeVisible();
    }
  });
});
