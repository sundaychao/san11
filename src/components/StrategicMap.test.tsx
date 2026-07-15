import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { CITY_GRID_CENTERS, GRID_HEIGHT, GRID_WIDTH } from '../game/battle/scenario';
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

  it('shows coordinates and terrain while hovering the normal map grid', () => {
    renderGame();

    const mapCell = screen.getByTestId('map-cell-0-0');
    fireEvent.pointerEnter(mapCell);

    expect(screen.getByTestId('hover-coordinate')).toHaveTextContent('坐标：0,0 地形：平地');
  });

  it('places city markers from their grid center instead of the old map percentage', () => {
    renderGame();

    const jianglingMarker = screen.getAllByTestId('city-marker').find((marker) => marker.textContent?.includes('江陵'));
    expect(jianglingMarker).toBeTruthy();
    const center = CITY_GRID_CENTERS.jiangling;
    const expectedLeft = ((center.q + 0.5) / GRID_WIDTH) * 100;
    const expectedTop = ((center.r + (center.q % 2 === 0 ? 0 : 0.5)) / GRID_HEIGHT) * 100;

    expect(Number.parseFloat(jianglingMarker!.style.left)).toBeCloseTo(expectedLeft, 4);
    expect(Number.parseFloat(jianglingMarker!.style.top)).toBeCloseTo(expectedTop, 4);
  });

  it('shows troop and population values next to the city name on map markers', () => {
    renderGame();

    const jianglingMarker = screen.getAllByTestId('city-marker').find((marker) => marker.textContent?.includes('江陵'));
    expect(jianglingMarker).toBeTruthy();

    expect(within(jianglingMarker!).getByTestId('city-marker-troops')).toHaveTextContent('13500');
    expect(within(jianglingMarker!).getByTestId('city-marker-stat-divider')).toBeVisible();
    expect(within(jianglingMarker!).getByTestId('city-marker-population')).toHaveTextContent('95000');
    expect(jianglingMarker!.querySelector('.city-marker-stat i')).not.toBeInTheDocument();
  });

  it('shows all six management commands for an owned city', () => {
    renderGame();

    for (const command of ['开发', '征兵', '训练', '巡察', '人才', '调动']) {
      expect(screen.getByRole('button', { name: command })).toBeVisible();
    }
  });
});
