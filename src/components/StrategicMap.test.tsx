import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { CITY_GRID_CENTERS, GRID_HEIGHT, GRID_WIDTH } from '../game/battle/scenario';
import { deployUnit } from '../game/battle/actions';
import { sevenCellCityFootprint } from '../game/battle/grid';
import { createGame } from '../game/scenario/jingxiang208';
import { createMobileDuelGame } from '../game/scenario/mobileDuel';
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

  it('selects a city and opens the same menu from any cell in its seven-cell footprint', () => {
    const state = createGame('liu', 1);
    renderGame(state);

    const city = state.cities.jiangling;
    const footprintCell = screen.getByTestId(`city-footprint-${city.id}-${city.gridQ + 1}-${city.gridR}`);
    fireEvent.pointerDown(footprintCell, { button: 0, buttons: 1, clientX: 260, clientY: 190 });

    expect(screen.getByRole('heading', { name: city.name })).toBeVisible();
    expect(screen.getByTestId('city-command-menu')).toBeVisible();
  });

  it('opens a city menu when the underlying map cell is clicked inside its seven-cell footprint', () => {
    const state = createGame('liu', 1);
    renderGame(state);

    const city = state.cities.jiangling;
    const mapCell = screen.getByTestId(`map-cell-${city.gridQ + 1}-${city.gridR}`);
    fireEvent.pointerDown(mapCell, { button: 0, buttons: 1, clientX: 260, clientY: 190 });

    expect(screen.getByRole('heading', { name: city.name })).toBeVisible();
    expect(screen.getByTestId('city-command-menu')).toBeVisible();
  });

  it('represents a city with seven grid cells and no standalone fort icon', () => {
    const state = createGame('liu', 1);
    renderGame(state);

    const city = state.cities.jiangling;
    const footprint = sevenCellCityFootprint({ q: city.gridQ, r: city.gridR });

    expect(screen.getAllByTestId(/^city-footprint-jiangling-/)).toHaveLength(7);
    for (const coord of footprint) {
      expect(screen.getByTestId(`city-footprint-${city.id}-${coord.q}-${coord.r}`)).toHaveClass('city-footprint-cell');
    }
    expect(screen.queryByTestId(`city-hit-cell-${city.id}-${city.gridQ}-${city.gridR}`)).not.toBeInTheDocument();
    const cityMarker = screen.getAllByTestId('city-marker').find((marker) => marker.textContent?.includes(city.name));
    expect(cityMarker?.querySelector('.city-fort')).not.toBeInTheDocument();
  });

  it('opens the city menu from every rendered city footprint square', () => {
    const state = createGame('liu', 1);
    renderGame(state);

    const city = state.cities.jiangling;
    for (const coord of sevenCellCityFootprint({ q: city.gridQ, r: city.gridR })) {
      fireEvent.pointerDown(screen.getByTestId(`city-footprint-${city.id}-${coord.q}-${coord.r}`), {
        button: 0,
        buttons: 1,
        clientX: 260,
        clientY: 190,
      });
      expect(screen.getByTestId('city-command-menu')).toBeVisible();
    }
  });

  it('keeps the city menu open after a real click sequence on an owned footprint square', async () => {
    const user = userEvent.setup();
    const state = createGame('liu', 1);
    renderGame(state);

    const city = state.cities.jiangling;

    await user.click(screen.getByTestId(`city-footprint-${city.id}-${city.gridQ}-${city.gridR}`));

    expect(screen.getByTestId('city-command-menu')).toBeVisible();
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

  it('marks unfinished facilities as under construction without showing their effect range', () => {
    const state = createGame('liu', 1);
    state.facilities = {
      unfinishedTower: {
        id: 'unfinishedTower',
        type: 'arrowTower',
        forceId: 'liu',
        q: 10,
        r: 10,
        durability: 150,
        completed: false,
      },
    };
    renderGame(state);

    const marker = screen.getByTestId('battle-facility-marker');

    expect(screen.getByTestId('facility-construction-label')).toBeInTheDocument();

    fireEvent.pointerEnter(marker);

    expect(screen.queryByTestId('facility-range-cell')).not.toBeInTheDocument();
  });

  it('darkens map cells occupied by facilities', () => {
    const state = createGame('liu', 1);
    state.facilities = {
      tower: { id: 'tower', type: 'arrowTower', forceId: 'liu', q: 10, r: 10, durability: 700 },
    };

    renderGame(state);

    expect(screen.getByTestId('map-cell-10-10')).toHaveClass('is-facility-occupied');
    expect(screen.getByTestId('map-cell-10-11')).not.toHaveClass('is-facility-occupied');
  });

  it('uses the owning force color for support facility backgrounds', () => {
    const state = createGame('liu', 1);
    state.facilities = {
      drum: { id: 'drum', type: 'drum', forceId: 'liu', q: 10, r: 10, durability: 800 },
      tower: { id: 'tower', type: 'arrowTower', forceId: 'cao', q: 11, r: 10, durability: 700 },
      music: { id: 'music', type: 'musicTower', forceId: 'sun', q: 12, r: 10, durability: 800 },
      fortress: { id: 'fortress', type: 'fortress', forceId: 'biao', q: 13, r: 10, durability: 1200 },
      wall: { id: 'wall', type: 'earthwork', forceId: 'liu', q: 14, r: 10, durability: 400 },
    };

    renderGame(state);

    const backgrounds = screen.getAllByTestId('battle-facility-background');
    const byId = (id: string) => backgrounds.find((node) => node.getAttribute('data-facility-id') === id)!;

    expect(byId('drum')).toHaveClass('is-force-colored');
    expect(byId('drum').getAttribute('style')).toContain(`--force-color: ${state.forces.liu.color}`);
    expect(byId('tower')).toHaveClass('is-force-colored');
    expect(byId('tower').getAttribute('style')).toContain(`--force-color: ${state.forces.cao.color}`);
    expect(byId('music')).toHaveClass('is-force-colored');
    expect(byId('music').getAttribute('style')).toContain(`--force-color: ${state.forces.sun.color}`);
    expect(byId('fortress')).toHaveClass('is-force-colored');
    expect(byId('fortress').getAttribute('style')).toContain(`--force-color: ${state.forces.biao.color}`);
    expect(byId('wall')).not.toHaveClass('is-force-colored');
    expect(byId('wall')).not.toHaveAttribute('style');
  });

  it('shows arrow tower automatic damage numbers from battle reports', () => {
    const state = createGame('liu', 1);
    state.units['arrow-target'] = {
      id: 'arrow-target',
      kind: 'combat',
      forceId: 'cao',
      leaderId: 'cao-ren',
      homeCityId: 'xiangyang',
      troopType: 'sword',
      q: 12,
      r: 10,
      troops: 2700,
      food: 3000,
      energy: 80,
      movementRemaining: 5,
      moved: false,
      acted: false,
    };
    state.battleDamageReports = [{
      id: 'arrow-tower-damage',
      unitId: 'arrow-target',
      q: 12,
      r: 10,
      amount: 300,
      kind: 'attack',
    }];

    renderGame(state);

    expect(screen.getByTestId('battle-damage-number')).toHaveTextContent('-300');
  });

  it('renders critical damage and failed strategy feedback at their report coordinates', () => {
    const state = createGame('liu', 1);
    state.battleDamageReports = [{
      id: 'critical-damage',
      unitId: 'critical-target',
      q: 12,
      r: 10,
      amount: 640,
      kind: 'attack',
      critical: true,
      label: '暴击',
    }];
    state.strategyResultReports = [
      {
        id: 'failed-strategy',
        strategyId: 'fire',
        q: 10,
        r: 11,
        label: '计略失败',
        succeeded: false,
      },
      {
        id: 'successful-strategy',
        strategyId: 'fire',
        q: 11,
        r: 11,
        label: '计略成功',
        succeeded: true,
      },
    ];

    renderGame(state);

    const critical = screen.getByTestId('battle-critical-label');
    const damage = screen.getByTestId('battle-damage-number');
    const failure = screen.getByTestId('strategy-result-label');
    expect(critical).toHaveTextContent('暴击');
    expect(critical).toHaveAttribute('data-grid-position', '12,10');
    expect(critical).toHaveAttribute('x', '537.5');
    expect(critical).toHaveAttribute('y', '360.5');
    expect(damage).toHaveTextContent('-640');
    expect(damage).toHaveAttribute('data-grid-position', '12,10');
    expect(damage).toHaveAttribute('x', '537.5');
    expect(damage).toHaveAttribute('y', '377.5');
    expect(failure).toHaveTextContent('计略失败');
    expect(failure).toHaveAttribute('data-grid-position', '10,11');
    expect(failure).toHaveAttribute('x', '451.5');
    expect(failure).toHaveAttribute('y', '420.5');
    expect(screen.queryByText('计略成功')).not.toBeInTheDocument();
  });

  it('stacks two fire-arrow damage reports at the same ordinary grid position', () => {
    const state = createGame('liu', 1);
    state.battleDamageReports = [
      {
        id: 'fire-arrow-hit', unitId: 'fire-arrow-target', q: 12, r: 10,
        amount: 520, kind: 'attack',
      },
      {
        id: 'fire-arrow-burn', unitId: 'fire-arrow-target', q: 12, r: 10,
        amount: 300, kind: 'attack',
      },
    ];

    renderGame(state);

    const damageNumbers = screen.getAllByTestId('battle-damage-number');
    expect(damageNumbers.map((node) => node.getAttribute('y'))).toEqual(['360.5', '377.5']);
  });

  it('keeps top-row critical labels separated while preserving the normal damage baseline', () => {
    const state = createGame('liu', 1);
    state.battleDamageReports = [
      {
        id: 'top-row-critical',
        unitId: 'critical-target',
        q: 0,
        r: 0,
        amount: 640,
        kind: 'attack',
        critical: true,
        label: '暴击',
      },
      {
        id: 'top-row-normal',
        unitId: 'normal-target',
        q: 0,
        r: 0,
        amount: 320,
        kind: 'attack',
      },
    ];

    renderGame(state);

    const critical = screen.getByTestId('battle-critical-label');
    const damageNumbers = screen.getAllByTestId('battle-damage-number');
    const criticalDamage = damageNumbers.find((node) => node.textContent === '-640')!;
    const normalDamage = damageNumbers.find((node) => node.textContent === '-320')!;
    const criticalY = Number(critical.getAttribute('y'));
    const criticalDamageY = Number(criticalDamage.getAttribute('y'));
    expect(criticalY).toBe(12);
    expect(criticalDamageY).toBe(29);
    expect(criticalDamageY - criticalY).toBe(17);
    expect(normalDamage).toHaveAttribute('y', '46');
    expect(new Set([criticalY, criticalDamageY, Number(normalDamage.getAttribute('y'))]).size).toBe(3);
  });

  it('shows facility status while hovering a facility marker', () => {
    const state = createGame('liu', 1);
    state.facilities = {
      unfinishedTower: {
        id: 'unfinishedTower',
        type: 'arrowTower',
        forceId: 'liu',
        q: 10,
        r: 10,
        durability: 150,
        completed: false,
      },
    };
    renderGame(state);

    fireEvent.pointerEnter(screen.getByTestId('battle-facility-marker'), { clientX: 300, clientY: 180 });

    expect(screen.getByTestId('facility-info-panel')).toBeVisible();
    expect(screen.getByTestId('facility-info-status')).toHaveTextContent('建设中');
    expect(screen.getByTestId('facility-info-durability')).toHaveTextContent('150/700');

    fireEvent.pointerLeave(screen.getByTestId('battle-facility-marker'));

    expect(screen.queryByTestId('facility-info-panel')).not.toBeInTheDocument();
  });

  it('opens a right-click menu for own facilities and dismantles them', async () => {
    const user = userEvent.setup();
    const state = createGame('liu', 1);
    state.facilities = {
      ownWall: {
        id: 'ownWall',
        type: 'earthwork',
        forceId: 'liu',
        q: 10,
        r: 10,
        durability: 400,
        completed: true,
      },
    };
    renderGame(state);

    fireEvent.contextMenu(screen.getByTestId('battle-facility-marker'), { clientX: 320, clientY: 180 });

    expect(screen.getByTestId('facility-context-menu')).toBeVisible();

    await user.click(screen.getByTestId('facility-dismantle-button'));

    expect(screen.queryByTestId('battle-facility-marker')).not.toBeInTheDocument();
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

  it('shows the map proceed command as disabled while another player is active', () => {
    const state = createGame('liu', 1);
    state.turnForceId = 'cao';
    renderGame(state);

    fireEvent.contextMenu(screen.getByTestId('map-viewport'), { clientX: 320, clientY: 180 });

    const proceedButton = screen.getByTestId('map-context-proceed-button');
    expect(proceedButton).toBeDisabled();
    expect(proceedButton).toHaveClass('is-disabled');
  });

  it('does not mark or open commands for a confused player unit', async () => {
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
    const unit = Object.values(waiting.units)[0];
    waiting.units[unit.id].confusedTenDays = 1;
    renderGame(waiting);

    expect(screen.queryByTestId('battle-unit-ready-badge')).not.toBeInTheDocument();

    await user.click(screen.getByTestId('battle-unit-marker'));
    expect(screen.queryByTestId('unit-command-menu')).not.toBeInTheDocument();
    expect(screen.queryByTestId(/move-target-/)).not.toBeInTheDocument();
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

  it('shows unit information while hovering a field unit and hides it after leaving', async () => {
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
    expect(info).toHaveTextContent('资金');
    expect(info).toHaveTextContent('兵粮');
    expect(info).toHaveTextContent('士气');
    expect(info).not.toHaveTextContent('士兵');
    expect(info).not.toHaveTextContent('兵科');

    fireEvent.pointerLeave(unitMarker);

    await waitFor(() => expect(screen.queryByTestId('unit-info-panel')).not.toBeInTheDocument());
  });

  it('marks units with distinct force ids and force colors', () => {
    const state = deployUnit(createGame('liu', 1), 'liu', {
      cityId: 'jiangling',
      officerId: 'guan-yu',
      troopType: 'spear',
      troops: 4000,
      food: 6000,
    });
    const playerUnit = Object.values(state.units)[0];
    state.units[playerUnit.id].q = 10;
    state.units[playerUnit.id].r = 10;
    state.units['enemy-color-check'] = {
      id: 'enemy-color-check',
      kind: 'combat',
      forceId: 'cao',
      leaderId: 'cao-ren',
      homeCityId: 'xiangyang',
      troopType: 'spear',
      q: 11,
      r: 10,
      troops: 3000,
      food: 3000,
      energy: 100,
      movementRemaining: 22,
      moved: false,
      acted: false,
    };
    renderGame(state);

    const markers = screen.getAllByTestId('battle-unit-marker');
    const liuMarker = markers.find((marker) => marker.getAttribute('data-force-id') === 'liu');
    const caoMarker = markers.find((marker) => marker.getAttribute('data-force-id') === 'cao');

    expect(liuMarker).toBeTruthy();
    expect(caoMarker).toBeTruthy();
    expect(liuMarker).toHaveStyle({ '--force-color': state.forces.liu.color });
    expect(caoMarker).toHaveStyle({ '--force-color': state.forces.cao.color });
    expect(state.forces.liu.color).not.toBe(state.forces.cao.color);
  });

  it('shows range overlays while hovering arrow towers, drums, music towers, or fortresses', () => {
    const state = createGame('liu', 1);
    state.facilities = {
      tower: { id: 'tower', type: 'arrowTower', forceId: 'liu', q: 10, r: 10, durability: 700 },
      fortress: { id: 'fortress', type: 'fortress', forceId: 'liu', q: 16, r: 10, durability: 1200 },
      wall: { id: 'wall', type: 'earthwork', forceId: 'liu', q: 14, r: 10, durability: 400 },
    };
    renderGame(state);

    const tower = screen.getAllByTestId('battle-facility-marker')
      .find((marker) => marker.getAttribute('data-facility-id') === 'tower')!;
    fireEvent.pointerEnter(tower);

    expect(screen.getAllByTestId('facility-range-cell').length).toBeGreaterThan(6);
    expect(document.querySelector('[data-range-position="10,9"]')).toBeInTheDocument();
    expect(document.querySelector('[data-range-position="10,8"]')).toBeInTheDocument();

    fireEvent.pointerLeave(tower);
    expect(screen.queryAllByTestId('facility-range-cell')).toHaveLength(0);

    const wall = screen.getAllByTestId('battle-facility-marker')
      .find((marker) => marker.getAttribute('data-facility-id') === 'wall')!;
    fireEvent.pointerEnter(wall);
    expect(screen.queryAllByTestId('facility-range-cell')).toHaveLength(0);

    const fortress = screen.getAllByTestId('battle-facility-marker')
      .find((marker) => marker.getAttribute('data-facility-id') === 'fortress')!;
    fireEvent.pointerLeave(wall);
    fireEvent.pointerEnter(fortress);
    expect(document.querySelector('[data-range-position="16,7"]')).toBeInTheDocument();
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

  it('renders the mobile duel map with its own 16 by 33 grid dimensions', () => {
    const state = createMobileDuelGame('liu', 'cao', 1);
    renderGame(state);

    expect(screen.getByTestId('battle-grid-overlay')).toHaveAttribute('viewBox', '0 0 688 1419');
    expect(screen.getByTestId('battle-unit-layer')).toHaveAttribute('viewBox', '0 0 688 1419');

    const bottomMarker = screen.getAllByTestId('city-marker').find((marker) =>
      marker.textContent?.includes(state.cities.jiangling.name),
    );
    const topMarker = screen.getAllByTestId('city-marker').find((marker) =>
      marker.textContent?.includes(state.cities.xiangyang.name),
    );

    expect(bottomMarker).toBeTruthy();
    expect(topMarker).toBeTruthy();
    expect(Number.parseFloat(bottomMarker!.style.left)).toBeCloseTo((8.5 / 16) * 100, 4);
    expect(Number.parseFloat(bottomMarker!.style.top)).toBeCloseTo((29 / 33) * 100, 4);
    expect(Number.parseFloat(topMarker!.style.left)).toBeCloseTo((8.5 / 16) * 100, 4);
    expect(Number.parseFloat(topMarker!.style.top)).toBeCloseTo((3 / 33) * 100, 4);
  });

  it('puts the local city at the bottom for the top-side online player', () => {
    const state = createMobileDuelGame('liu', 'cao', 1);
    state.playerForceId = 'cao';
    renderGame(state);

    const localCity = screen.getAllByTestId('city-marker').find((marker) => marker.textContent?.includes(state.cities.xiangyang.name));
    const opponentCity = screen.getAllByTestId('city-marker').find((marker) => marker.textContent?.includes(state.cities.jiangling.name));

    expect(localCity).toBeTruthy();
    expect(opponentCity).toBeTruthy();
    expect(Number.parseFloat(localCity!.style.top)).toBeGreaterThan(80);
    expect(Number.parseFloat(opponentCity!.style.top)).toBeLessThan(20);
  });

  it('keeps all seven city cells aligned with the rotated guest grid', () => {
    const state = createMobileDuelGame('liu', 'cao', 1);
    state.playerForceId = 'cao';
    renderGame(state);

    const city = state.cities.xiangyang;
    for (const coord of sevenCellCityFootprint({ q: city.gridQ, r: city.gridR })) {
      const mapCell = screen.getByTestId(`map-cell-${coord.q}-${coord.r}`);
      const cityCell = screen.getByTestId(`city-footprint-${city.id}-${coord.q}-${coord.r}`);
      expect(cityCell.getAttribute('x')).toBe(`${Number(mapCell.getAttribute('x')) + 2}`);
      expect(cityCell.getAttribute('y')).toBe(`${Number(mapCell.getAttribute('y')) + 2}`);
    }
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
