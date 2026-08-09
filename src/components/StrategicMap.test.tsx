import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { CITY_GRID_CENTERS, GRID_HEIGHT, GRID_WIDTH } from '../game/battle/scenario';
import { deployUnit } from '../game/battle/actions';
import { createGame } from '../game/scenario/jingxiang208';
import { GameProvider } from '../game/store/GameProvider';
import { settleTenDay } from '../game/turn';
import type { TerrainType } from '../game/types';
import { GameShell } from './GameShell';

const TERRAIN_LABELS: Record<TerrainType, string> = {
  road: '道路',
  plain: '平地',
  forest: '森林',
  hill: '丘陵',
  mountain: '高山',
  shallowWater: '浅水',
  deepWater: '深水',
};

function renderGame(state = createGame('liu', 1)) {
  return render(
    <GameProvider initialState={state}>
      <GameShell />
    </GameProvider>,
  );
}

async function chooseDeployLeader(user: ReturnType<typeof userEvent.setup>, officerName = '刘备') {
  const deployDialog = screen.getByRole('dialog', { name: '出征编制' });
  await user.click(within(deployDialog).getByRole('button', { name: '选择武将' }));
  const officerDialog = screen.getByRole('dialog', { name: '武将选择' });
  await user.click(within(officerDialog).getByRole('button', { name: `选择${officerName}为主将` }));
  await user.click(within(officerDialog).getByRole('button', { name: '确定武将' }));
  return screen.getByRole('dialog', { name: '出征编制' });
}

describe('StrategicMap', () => {
  it('selects a city from its map marker', async () => {
    const user = userEvent.setup();
    renderGame();

    await user.click(screen.getByRole('button', { name: /江陵.*刘备/ }));

    expect(screen.getByRole('heading', { name: '江陵' })).toBeVisible();
    expect(screen.getAllByText('13,500').length).toBeGreaterThan(0);
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
    const deployDialog = await chooseDeployLeader(user, '刘备');
    await user.click(within(deployDialog).getByRole('button', { name: '确定出征' }));

    const deploymentCell = screen.getAllByTestId(/deploy-target-/)[0];
    const [, q, r] = deploymentCell.getAttribute('data-testid')!.match(/deploy-target-(\d+)-(\d+)/)!;
    const terrain = [...deploymentCell.classList].find((className) => className.startsWith('terrain-'))?.replace('terrain-', '') as TerrainType;
    fireEvent.pointerEnter(deploymentCell);

    expect(deploymentCell).toHaveAttribute('data-testid', `deploy-target-${q}-${r}`);
    expect(deploymentCell).toHaveClass(`terrain-${terrain}`);
    expect(screen.getByTestId('hover-coordinate')).toBeInTheDocument();

    fireEvent.pointerLeave(screen.getByTestId('map-viewport'));

    expect(screen.queryByTestId('hover-coordinate')).not.toBeInTheDocument();
  });

  it('shows coordinates and terrain while hovering the normal map grid', () => {
    renderGame();

    const mapCell = screen.getByTestId('map-cell-0-0');
    fireEvent.pointerEnter(mapCell);

    expect(screen.getByTestId('hover-coordinate')).toBeInTheDocument();
  });

  it('marks a player unit with remaining movement as not acted until it moves', async () => {
    const user = userEvent.setup();
    const deployed = deployUnit(createGame('liu', 1), 'liu', {
      cityId: 'jiangling',
      officerId: 'guan-yu',
      targetCityId: 'xiangyang',
      troopType: 'spear',
      troops: 4000,
      food: 6000,
    });
    renderGame(settleTenDay(deployed));

    expect(screen.getByTestId('battle-unit-ready-badge')).toBeInTheDocument();

    await user.click(screen.getByTestId('battle-unit-marker'));
    fireEvent.pointerDown(screen.getAllByTestId(/move-target-/)[0], { button: 0, buttons: 1 });
    await user.click(within(screen.getByTestId('unit-command-menu')).getByRole('button', { name: '待命' }));

    expect(screen.queryByTestId('battle-unit-ready-badge')).not.toBeInTheDocument();
  });

  it('blocks city and unit command entry while another player is active', async () => {
    const user = userEvent.setup();
    const deployed = deployUnit(createGame('liu', 1), 'liu', {
      cityId: 'jiangling',
      officerId: 'guan-yu',
      targetCityId: 'xiangyang',
      troopType: 'spear',
      troops: 4000,
      food: 6000,
    });
    const waiting = settleTenDay(deployed);
    waiting.turnForceId = 'cao';
    renderGame(waiting);

    expect(screen.queryByTestId('battle-unit-ready-badge')).not.toBeInTheDocument();

    const jianglingMarker = screen.getAllByTestId('city-marker').find((marker) => marker.textContent?.includes('江陵'));
    expect(jianglingMarker).toBeTruthy();
    await user.click(jianglingMarker!);
    expect(screen.queryByTestId('city-command-menu')).not.toBeInTheDocument();

    await user.click(screen.getByTestId('battle-unit-marker'));
    expect(screen.queryByTestId('unit-command-menu')).not.toBeInTheDocument();
  });

  it('shows the active opponent unit ready badge while another player is active', async () => {
    const user = userEvent.setup();
    const initial = createGame('liu', 1);
    initial.turnForceId = 'cao';
    const deployed = deployUnit(initial, 'cao', {
      cityId: 'xiangyang',
      officerId: 'cao-ren',
      targetCityId: 'jiangling',
      troopType: 'spear',
      troops: 4000,
      food: 6000,
    });
    const waiting = settleTenDay(deployed);
    waiting.playerForceId = 'liu';
    waiting.turnForceId = 'cao';
    renderGame(waiting);

    expect(screen.getByTestId('battle-unit-ready-badge')).toBeInTheDocument();

    await user.click(screen.getByTestId('battle-unit-marker'));
    expect(screen.queryByTestId('unit-command-menu')).not.toBeInTheDocument();
  });

  it('shows unit information while hovering a field unit and hides it after leaving', () => {
    const deployed = deployUnit(createGame('liu', 1), 'liu', {
      cityId: 'jiangling',
      officerId: 'guan-yu',
      targetCityId: 'xiangyang',
      troopType: 'spear',
      troops: 4000,
      food: 6000,
    });
    renderGame(deployed);

    const unitMarker = screen.getByTestId('battle-unit-marker');
    fireEvent.pointerEnter(unitMarker, { clientX: 300, clientY: 180 });

    const info = screen.getByTestId('unit-info-panel');
    expect(info).toHaveTextContent('关羽部队');
    expect(info).toHaveTextContent('4,000');
    expect(info).toHaveTextContent('6,000');
    expect(info).toHaveTextContent('枪兵');

    fireEvent.pointerLeave(unitMarker);

    expect(screen.queryByTestId('unit-info-panel')).not.toBeInTheDocument();
  });

  it('hides unit information when the hovered unit marker is clicked', () => {
    const deployed = deployUnit(createGame('liu', 1), 'liu', {
      cityId: 'jiangling',
      officerId: 'guan-yu',
      targetCityId: 'xiangyang',
      troopType: 'spear',
      troops: 4000,
      food: 6000,
    });
    renderGame(deployed);

    const unitMarker = screen.getByTestId('battle-unit-marker');
    fireEvent.pointerEnter(unitMarker, { clientX: 300, clientY: 180 });
    expect(screen.getByTestId('unit-info-panel')).toBeInTheDocument();

    fireEvent.pointerDown(unitMarker, { button: 0, buttons: 1, clientX: 300, clientY: 180 });

    expect(screen.queryByTestId('unit-info-panel')).not.toBeInTheDocument();
  });

  it('hides unit information when the hovered unit marker is right clicked', () => {
    const deployed = deployUnit(createGame('liu', 1), 'liu', {
      cityId: 'jiangling',
      officerId: 'guan-yu',
      targetCityId: 'xiangyang',
      troopType: 'spear',
      troops: 4000,
      food: 6000,
    });
    renderGame(deployed);

    const unitMarker = screen.getByTestId('battle-unit-marker');
    fireEvent.pointerEnter(unitMarker, { clientX: 300, clientY: 180 });
    expect(screen.getByTestId('unit-info-panel')).toBeInTheDocument();

    fireEvent.contextMenu(unitMarker, { clientX: 300, clientY: 180 });

    expect(screen.queryByTestId('unit-info-panel')).not.toBeInTheDocument();
  });

  it('shows city information beside a hovered city and hides it after leaving', () => {
    const state = createGame('liu', 1);
    renderGame(state);

    const city = state.cities.jiangling;
    const governor = state.officers[city.governorId!];
    const localOfficers = Object.values(state.officers).filter((officer) =>
      officer.forceId === city.ownerId && officer.location.kind === 'city' && officer.location.cityId === city.id,
    );
    const forceOfficers = Object.values(state.officers).filter((officer) => officer.forceId === city.ownerId);
    const jianglingMarker = screen.getAllByTestId('city-marker').find((marker) => marker.textContent?.includes(city.name));
    expect(jianglingMarker).toBeTruthy();

    fireEvent.pointerEnter(jianglingMarker!, { clientX: 520, clientY: 250 });

    const info = screen.getByTestId('city-info-panel');
    expect(info).toHaveTextContent(city.name);
    expect(info).toHaveTextContent(`${state.forces[city.ownerId].name}军`);
    expect(info).toHaveTextContent(governor.name);
    expect(info).toHaveTextContent(city.gold.toLocaleString('en-US'));
    expect(info).toHaveTextContent(city.food.toLocaleString('en-US'));
    expect(info).toHaveTextContent(`${city.order}/100`);
    expect(info).toHaveTextContent(city.durability.toLocaleString('en-US'));
    expect(info).toHaveTextContent(city.troops.toLocaleString('en-US'));
    expect(info).toHaveTextContent(`${localOfficers.length}/${forceOfficers.length}`);

    fireEvent.pointerLeave(jianglingMarker!);

    expect(screen.queryByTestId('city-info-panel')).not.toBeInTheDocument();
  });

  it('hides city information when the hovered city marker is clicked', () => {
    const state = createGame('liu', 1);
    renderGame(state);

    const city = state.cities.jiangling;
    const jianglingMarker = screen.getAllByTestId('city-marker').find((marker) => marker.textContent?.includes(city.name));
    expect(jianglingMarker).toBeTruthy();

    fireEvent.pointerEnter(jianglingMarker!, { clientX: 520, clientY: 250 });
    expect(screen.getByTestId('city-info-panel')).toBeInTheDocument();

    fireEvent.click(jianglingMarker!, { clientX: 520, clientY: 250 });

    expect(screen.queryByTestId('city-info-panel')).not.toBeInTheDocument();
  });

  it('hides city information when the hovered city marker is right clicked', () => {
    const state = createGame('liu', 1);
    renderGame(state);

    const city = state.cities.jiangling;
    const jianglingMarker = screen.getAllByTestId('city-marker').find((marker) => marker.textContent?.includes(city.name));
    expect(jianglingMarker).toBeTruthy();

    fireEvent.pointerEnter(jianglingMarker!, { clientX: 520, clientY: 250 });
    expect(screen.getByTestId('city-info-panel')).toBeInTheDocument();

    fireEvent.contextMenu(jianglingMarker!, { clientX: 520, clientY: 250 });

    expect(screen.queryByTestId('city-info-panel')).not.toBeInTheDocument();
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

  it('shows top-level management command categories for an owned city', async () => {
    const user = userEvent.setup();
    renderGame();

    const ownedCityMarker = screen.getAllByTestId('city-marker').find((marker) => marker.textContent?.includes('13500'));
    expect(ownedCityMarker).toBeTruthy();
    await user.click(ownedCityMarker!);

    expect(within(screen.getByTestId('city-command-menu')).getAllByRole('button')).toHaveLength(3);
  });
});
