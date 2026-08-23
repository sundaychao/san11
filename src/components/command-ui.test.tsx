import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { initialArmaments } from '../game/armaments';
import { deployTransportUnit, deployUnit, movementCells } from '../game/battle/actions';
import { movementAllowanceForProfile } from '../game/battle/definitions';
import { deploymentCells } from '../game/battle/deployment';
import { gridKey, neighborsOf, sevenCellCityFootprint } from '../game/battle/grid';
import { executeCommand } from '../game/commands';
import { createGame } from '../game/scenario/jingxiang208';
import { GameProvider } from '../game/store/GameProvider';
import { settleTenDay } from '../game/turn';
import { GameShell } from './GameShell';

function renderState(state = createGame('liu', 3)) {
  return render(
    <GameProvider initialState={state}>
      <GameShell />
    </GameProvider>,
  );
}

function officerNamesIn(dialog: HTMLElement) {
  return within(dialog).getAllByRole('rowheader').map((header) => header.textContent ?? '');
}

async function chooseDeployLeader(user: ReturnType<typeof userEvent.setup>, officerName = '刘备') {
  const deployDialog = screen.getByRole('dialog', { name: '出征编制' });
  await user.click(within(deployDialog).getByRole('button', { name: '选择武将' }));
  const officerDialog = screen.getByRole('dialog', { name: '武将选择' });
  await user.click(within(officerDialog).getByRole('button', { name: `选择${officerName}为主将` }));
  await user.click(within(officerDialog).getByRole('button', { name: '确定武将' }));
  return screen.getByRole('dialog', { name: '出征编制' });
}

function cityKeys(state: ReturnType<typeof createGame>) {
  return new Set(Object.values(state.cities).flatMap((city) => (
    sevenCellCityFootprint({ q: city.gridQ, r: city.gridR }).map(gridKey)
  )));
}

function passableNonCityCell(state: ReturnType<typeof createGame>, coord: { q: number; r: number }) {
  const cell = state.grid.find((candidate) => candidate.q === coord.q && candidate.r === coord.r);
  return Boolean(cell && !['mountain', 'deepWater'].includes(cell.terrain) && !cityKeys(state).has(gridKey(coord)));
}

function destinationWithEnemyNeighbor(state: ReturnType<typeof createGame>, unitId: string) {
  for (const destination of movementCells(state, unitId)) {
    const enemyPosition = neighborsOf(destination.q, destination.r)
      .find((coord) => (
        passableNonCityCell(state, coord) &&
        !Object.values(state.units).some((unit) => unit.q === coord.q && unit.r === coord.r)
      ));
    if (enemyPosition) return { destination, enemyPosition };
  }
  throw new Error('No destination with enemy neighbor found');
}

describe('command interface', () => {
  it('shows and enables every 百出 strategy at the shared one-energy cost', async () => {
    const user = userEvent.setup();
    const state = deployUnit(createGame('liu', 1), 'liu', {
      cityId: 'jiangling', officerId: 'liu-bei', troops: 3000, food: 3000,
    });
    const caster = Object.values(state.units)[0];
    state.officers['liu-bei'].skill = '百出';
    state.officers['liu-bei'].location = { kind: 'unit', unitId: caster.id };
    Object.assign(caster, { q: 10, r: 10, energy: 1, moved: false, acted: false, movementRemaining: 22 });
    state.officers['cao-ren'].location = { kind: 'unit', unitId: 'strategy-menu-target' };
    state.units['strategy-menu-target'] = {
      id: 'strategy-menu-target', kind: 'combat', forceId: 'cao', leaderId: 'cao-ren', officerIds: ['cao-ren'],
      homeCityId: 'xiangyang', troopType: 'sword', q: 11, r: 10, troops: 3000, food: 3000,
      energy: 100, movementRemaining: 20, moved: false, acted: false,
    };
    renderState(state);

    const marker = screen.getAllByTestId('battle-unit-marker')
      .find((candidate) => candidate.getAttribute('data-grid-position') === '10,10')!;
    fireEvent.pointerDown(marker, { button: 0, buttons: 1, clientX: 240, clientY: 180 });
    fireEvent.pointerDown(marker, { button: 0, buttons: 1, clientX: 240, clientY: 180 });
    const strategyCommand = within(screen.getByTestId('unit-command-menu')).getByRole('button', { name: '计略' });

    expect(strategyCommand).toBeEnabled();
    await user.click(strategyCommand);
    const strategyMenu = screen.getByTestId('unit-strategy-menu');
    for (const button of within(strategyMenu).getAllByRole('button')) {
      expect(button).toHaveTextContent(/（1）$/);
    }
    expect(within(strategyMenu).getByRole('button', { name: '火计（1）' })).toBeEnabled();
    expect(within(strategyMenu).getByRole('button', { name: '扰乱（1）' })).toBeEnabled();

    await user.click(within(strategyMenu).getByRole('button', { name: '火计（1）' }));
    expect(screen.getByTestId('strategy-target-11-10')).toBeVisible();
    const enemyUnit = screen.getAllByTestId('battle-unit-marker')
      .find((candidate) => candidate.getAttribute('data-grid-position') === '11,10')!;
    fireEvent.pointerDown(enemyUnit, { button: 0, buttons: 1, clientX: 280, clientY: 180 });

    expect(screen.queryByTestId('unit-command-menu')).not.toBeInTheDocument();

    const actedCaster = screen.getAllByTestId('battle-unit-marker')
      .find((candidate) => candidate.getAttribute('data-grid-position') === '10,10')!;
    fireEvent.pointerDown(actedCaster, { button: 0, buttons: 1, clientX: 240, clientY: 180 });
    fireEvent.pointerDown(actedCaster, { button: 0, buttons: 1, clientX: 240, clientY: 180 });
    expect(screen.queryByTestId('unit-command-menu')).not.toBeInTheDocument();
  });

  it('confirms before ending a month with legal actions remaining', async () => {
    const user = userEvent.setup();
    renderState();

    await user.click(screen.getByRole('button', { name: '进行到下月' }));

    expect(screen.getByRole('dialog', { name: '结束本月' })).toBeVisible();
    await user.click(screen.getByRole('button', { name: '确认进行' }));
    expect(screen.queryByRole('dialog', { name: '结束本月' })).not.toBeInTheDocument();
    expect(screen.getByText('五月')).toBeVisible();
  });

  it('closes the end-month confirmation popup on right click', async () => {
    const user = userEvent.setup();
    renderState();

    await user.click(screen.getByTestId('end-month-button'));
    const dialog = screen.getAllByRole('dialog')[0];

    const defaultWasAllowed = fireEvent.contextMenu(dialog);

    expect(defaultWasAllowed).toBe(false);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('opens a categorized force officer list with ownership, stats, skills, aptitudes, and status', async () => {
    const user = userEvent.setup();
    renderState();

    await user.click(screen.getByTestId('open-officer-list-button'));

    const dialog = screen.getByRole('dialog', { name: '武将一览' });
    expect(within(dialog).getByRole('button', { name: '所属' })).toHaveClass('is-active');
    expect(within(dialog).getByRole('button', { name: '能力' })).toBeVisible();
    expect(within(dialog).getByRole('button', { name: '特技' })).toBeVisible();
    expect(within(dialog).getByRole('button', { name: '适性' })).toBeVisible();
    expect(within(dialog).getByRole('button', { name: '状态' })).toBeVisible();
    const officerRow = (name: string) => within(dialog).getByRole('rowheader', { name }).closest('tr')!;

    const ownershipRow = officerRow('刘备');
    expect(ownershipRow).toHaveTextContent('刘备军');
    expect(ownershipRow).toHaveTextContent('江陵');

    await user.click(within(dialog).getByRole('button', { name: '能力' }));
    const abilityRow = officerRow('刘备');
    expect(within(dialog).getByText('统帅')).toBeVisible();
    expect(within(dialog).getByText('武力')).toBeVisible();
    expect(within(dialog).getByText('智力')).toBeVisible();
    expect(within(dialog).getByText('政治')).toBeVisible();
    expect(within(dialog).getByText('魅力')).toBeVisible();
    expect(abilityRow).toHaveTextContent('78');
    expect(within(abilityRow).getByText('75')).toBeVisible();
    expect(within(abilityRow).getByText('99')).toBeVisible();

    await user.click(within(dialog).getByRole('button', { name: '特技' }));
    expect(within(dialog).getByRole('button', { name: '按说明排序' })).toBeVisible();
    expect(officerRow('刘备')).toHaveTextContent('仁德');
    expect(officerRow('刘备')).toHaveTextContent('项目自定义特技，效果将在单独规则设计中启用');
    const noSkillCells = within(officerRow('糜芳')).getAllByRole('cell');
    expect(noSkillCells[0].textContent).toBe('');
    expect(noSkillCells[1].textContent).toBe('');

    await user.click(within(dialog).getByRole('button', { name: '适性' }));
    expect(within(dialog).getByText('枪')).toBeVisible();
    expect(within(dialog).getByText('戟')).toBeVisible();
    expect(within(dialog).getByText('弩')).toBeVisible();
    expect(within(dialog).getByText('骑')).toBeVisible();
    expect(within(dialog).getByText('兵器')).toBeVisible();
    expect(within(dialog).getByText('水军')).toBeVisible();
    const aptitudeCells = within(officerRow('刘备')).getAllByRole('cell').map((cell) => cell.textContent);
    expect(aptitudeCells).toEqual(['A', 'A', 'B', 'B', 'C', 'C']);
  });

  it('sorts every officer-list column from its header and toggles direction', async () => {
    const user = userEvent.setup();
    const state = createGame('liu', 3);
    renderState(state);

    await user.click(screen.getByTestId('open-officer-list-button'));
    const dialog = screen.getByRole('dialog', { name: '武将一览' });
    const playerOfficers = Object.values(state.officers).filter((officer) => officer.forceId === state.playerForceId);

    for (const header of ['武将', '所属', '所在']) {
      expect(within(dialog).getByRole('button', { name: `按${header}排序` })).toBeVisible();
    }

    await user.click(within(dialog).getByRole('button', { name: '按武将排序' }));
    expect(officerNamesIn(dialog)).toEqual(
      [...playerOfficers].sort((left, right) => right.name.localeCompare(left.name) || left.id.localeCompare(right.id)).map((officer) => officer.name),
    );

    await user.click(within(dialog).getByRole('button', { name: '按武将排序' }));
    expect(officerNamesIn(dialog)).toEqual(
      [...playerOfficers].sort((left, right) => left.name.localeCompare(right.name) || left.id.localeCompare(right.id)).map((officer) => officer.name),
    );

    await user.click(within(dialog).getByRole('button', { name: '能力' }));
    for (const header of ['武将', '统帅', '武力', '智力', '政治', '魅力']) {
      expect(within(dialog).getByRole('button', { name: `按${header}排序` })).toBeVisible();
    }

    await user.click(within(dialog).getByRole('button', { name: '按智力排序' }));
    expect(officerNamesIn(dialog).slice(0, 3)).toEqual(['诸葛亮', '马谡', '刘备']);

    await user.click(within(dialog).getByRole('button', { name: '按智力排序' }));
    expect(officerNamesIn(dialog).slice(0, 3)).toEqual(['张飞', '糜芳', '廖化']);

    await user.click(within(dialog).getByRole('button', { name: '适性' }));
    for (const header of ['武将', '枪', '戟', '弩', '骑', '兵器', '水军']) {
      expect(within(dialog).getByRole('button', { name: `按${header}排序` })).toBeVisible();
    }

    await user.click(within(dialog).getByRole('button', { name: '按枪排序' }));
    expect(officerNamesIn(dialog).slice(0, 2)).toEqual(['关羽', '张飞']);

    await user.click(within(dialog).getByRole('button', { name: '按枪排序' }));
    expect(officerNamesIn(dialog).slice(0, 2)).toEqual(['简雍', '孙乾']);

    await user.click(within(dialog).getByRole('button', { name: '特技' }));
    for (const header of ['武将', '特技']) {
      expect(within(dialog).getByRole('button', { name: `按${header}排序` })).toBeVisible();
    }

    await user.click(within(dialog).getByRole('button', { name: '状态' }));
    for (const header of ['武将', '状态', '任务', '时间']) {
      expect(within(dialog).getByRole('button', { name: `按${header}排序` })).toBeVisible();
    }
  });

  it('closes the officer list popup on right click', async () => {
    const user = userEvent.setup();
    renderState();

    await user.click(screen.getByTestId('open-officer-list-button'));
    const dialog = screen.getAllByRole('dialog')[0];

    const defaultWasAllowed = fireEvent.contextMenu(dialog);

    expect(defaultWasAllowed).toBe(false);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('shows current officer task and time only when a task is active', async () => {
    const user = userEvent.setup();
    const transporting = deployTransportUnit(createGame('liu', 3), 'liu', {
      cityId: 'jiangling',
      officerId: 'jian-yong',
      troops: 1000,
      gold: 500,
      food: 500,
    });
    const state = executeCommand(transporting, 'liu', {
      type: 'transfer',
      cityId: 'jiangling',
      targetCityId: 'wuling',
      officerIds: ['guan-yu'],
    });
    renderState(state);

    await user.click(screen.getByTestId('open-officer-list-button'));

    const dialog = screen.getByRole('dialog', { name: '武将一览' });
    await user.click(within(dialog).getByRole('button', { name: '状态' }));
    const guanYuRow = within(dialog).getByRole('row', { name: /关羽/ });
    const jianYongRow = within(dialog).getByRole('row', { name: /简雍/ });
    const liuBeiRow = within(dialog).getByRole('row', { name: /刘备/ });
    expect(guanYuRow).toHaveTextContent('执行中');
    expect(guanYuRow).toHaveTextContent('调动 江陵→武陵');
    expect(guanYuRow).toHaveTextContent('3旬');
    expect(jianYongRow).toHaveTextContent('输送');
    expect(jianYongRow).toHaveTextContent('进行中');
    expect(liuBeiRow).not.toHaveTextContent('执行中');
    expect(liuBeiRow).not.toHaveTextContent('待命');
  });

  it('executes a patrol through the command dialog', async () => {
    const user = userEvent.setup();
    renderState();

    await user.click(screen.getByRole('button', { name: '巡察' }));
    const dialog = screen.getByRole('dialog', { name: '巡察' });
    await user.selectOptions(within(dialog).getByLabelText('执行武将'), 'liu-bei');
    await user.click(within(dialog).getByRole('button', { name: '执行巡察' }));

    expect(screen.queryByRole('dialog', { name: '巡察' })).not.toBeInTheDocument();
    expect(screen.getByText(/刘备巡察江陵/)).toBeVisible();
    expect(screen.getByText('已行动')).toBeVisible();
  });

  it('moves focus into the command dialog, closes on Escape, and restores focus', async () => {
    const user = userEvent.setup();
    renderState();
    const launcher = screen.getByRole('button', { name: '巡察' });

    await user.click(launcher);
    expect(screen.getByLabelText('执行武将')).toHaveFocus();
    await user.keyboard('{Escape}');

    expect(screen.queryByRole('dialog', { name: '巡察' })).not.toBeInTheDocument();
    expect(launcher).toHaveFocus();
  });

  it('closes a city command dialog on right click', async () => {
    const user = userEvent.setup();
    renderState();

    await user.click(screen.getByTestId('command-patrol-button'));
    const dialog = screen.getAllByRole('dialog')[0];

    const defaultWasAllowed = fireEvent.contextMenu(dialog);

    expect(defaultWasAllowed).toBe(false);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('opens a personnel-only transfer dialog and starts a transfer', async () => {
    const user = userEvent.setup();
    renderState();

    await user.click(screen.getByRole('button', { name: '调动' }));
    const dialog = screen.getByRole('dialog', { name: '调动' });
    expect(within(dialog).queryByLabelText('执行武将')).not.toBeInTheDocument();
    expect(within(dialog).queryByLabelText('调动资金')).not.toBeInTheDocument();
    expect(within(dialog).queryByText('调动兵粮')).not.toBeInTheDocument();
    expect(within(dialog).queryByText('调动兵力')).not.toBeInTheDocument();

    await user.click(within(dialog).getByLabelText(/关羽/));
    await user.click(within(dialog).getByRole('button', { name: '执行调动' }));

    expect(screen.queryByRole('dialog', { name: '调动' })).not.toBeInTheDocument();
    expect(screen.getByText(/调动关羽/)).toBeVisible();
  });

  it('closes the deployment setup popup on right click', async () => {
    const user = userEvent.setup();
    renderState();

    await user.click(screen.getAllByTestId('city-marker')[2]);
    await user.click(screen.getByTestId('city-command-section-military'));
    await user.click(screen.getByTestId('city-command-action-deploy'));
    const dialog = screen.getAllByRole('dialog')[0];

    const defaultWasAllowed = fireEvent.contextMenu(dialog);

    expect(defaultWasAllowed).toBe(false);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('selects the recommended officer by default when opening deployment', async () => {
    const user = userEvent.setup();
    renderState();

    await user.click(screen.getAllByTestId('city-marker')[2]);
    await user.click(screen.getByTestId('city-command-section-military'));
    await user.click(screen.getByTestId('city-command-action-deploy'));
    const dialog = screen.getByRole('dialog', { name: '出征编制' });

    expect(within(dialog).getByTestId('deploy-officer-summary')).toHaveTextContent('关羽');
    expect(within(dialog).getByRole('button', { name: '确定出征' })).toBeEnabled();
  });

  it('updates the recommended deployment officer when the troop type changes', async () => {
    const user = userEvent.setup();
    const state = createGame('liu', 3);
    state.officers['zhuge-liang'].location = { kind: 'city', cityId: 'jiangling' };
    state.officers['zhuge-liang'].cityId = 'jiangling';
    renderState(state);

    await user.click(screen.getAllByTestId('city-marker')[2]);
    await user.click(screen.getByTestId('city-command-section-military'));
    await user.click(screen.getByTestId('city-command-action-deploy'));
    const dialog = screen.getByRole('dialog', { name: '出征编制' });

    expect(within(dialog).getByTestId('deploy-officer-summary')).toHaveTextContent(state.officers['guan-yu'].name);

    await user.selectOptions(within(dialog).getByLabelText('兵种'), 'siege');

    expect(within(dialog).getByTestId('deploy-officer-summary')).toHaveTextContent(state.officers['zhuge-liang'].name);
  });

  it('opens a deployment dialog from the city menu and deploys the selected troop type', async () => {
    const user = userEvent.setup();
    renderState();

    const jianglingMarker = screen.getAllByTestId('city-marker').find((marker) => marker.textContent?.includes('江陵'));
    expect(jianglingMarker).toBeTruthy();
    await user.click(jianglingMarker!);
    const menu = screen.getByTestId('city-command-menu');
    await user.click(within(menu).getByRole('button', { name: '军事' }));
    await user.click(within(menu).getByRole('button', { name: '出征' }));

    const dialog = screen.getByRole('dialog', { name: '出征编制' });
    expect(within(dialog).getByLabelText('主将')).toBeVisible();
    expect(within(dialog).queryByLabelText('目标城池')).not.toBeInTheDocument();
    const shipButton = within(dialog).getByRole('button', { name: '楼船' });
    expect(shipButton).toBeVisible();
    expect(shipButton).toBeDisabled();
    expect(within(dialog).getByRole('button', { name: '小舟' })).toBeEnabled();
    await user.selectOptions(within(dialog).getByLabelText('兵种'), 'spear');
    const confirmedDialog = await chooseDeployLeader(user, '刘备');
    await user.click(within(confirmedDialog).getByRole('button', { name: '确定出征' }));

    expect(screen.queryByRole('dialog', { name: '出征编制' })).not.toBeInTheDocument();
    expect(screen.queryByTestId('battle-unit-marker')).not.toBeInTheDocument();
    const deploymentCell = screen.getAllByTestId(/deploy-target-/)[0];
    fireEvent.pointerDown(deploymentCell, { button: 0, buttons: 1 });
    await user.click(within(screen.getByTestId('unit-command-menu')).getByRole('button', { name: '待命' }));

    const unitMarker = screen.getByTestId('battle-unit-marker');
    expect(unitMarker).toBeVisible();
    expect(unitMarker).toHaveAttribute('data-troop-type', 'spear');
    expect(within(unitMarker).getByText('枪')).toBeVisible();
    expect(within(unitMarker).getByText('刘备')).toBeVisible();
    expect(within(unitMarker).getByText('4,000')).toBeVisible();
  });

  it('enables the ship vehicle button and shows its stock when the city has ships', async () => {
    const user = userEvent.setup();
    const state = createGame('liu', 1);
    state.cities['jiangling'].armaments = { ...initialArmaments(), ship: 3 };
    renderState(state);

    const jianglingMarker = screen.getAllByTestId('city-marker').find((marker) => marker.textContent?.includes('江陵'));
    expect(jianglingMarker).toBeTruthy();
    await user.click(jianglingMarker!);
    const menu = screen.getByTestId('city-command-menu');
    await user.click(within(menu).getByRole('button', { name: '军事' }));
    await user.click(within(menu).getByRole('button', { name: '出征' }));

    const dialog = screen.getByRole('dialog', { name: '出征编制' });
    const shipButton = within(dialog).getByRole('button', { name: '楼船' });
    expect(shipButton).toBeEnabled();
    expect(shipButton).toHaveTextContent('3');
  });

  it('opens the strategy menu for Ma Su during the first deployment action', async () => {
    const user = userEvent.setup();
    renderState();

    await user.click(screen.getByRole('button', { name: /^武陵 刘备/ }));
    const menu = screen.getByTestId('city-command-menu');
    await user.click(within(menu).getByRole('button', { name: '军事' }));
    await user.click(within(menu).getByRole('button', { name: '出征' }));
    const deployDialog = await chooseDeployLeader(user, '马谡');
    await user.click(within(deployDialog).getByRole('button', { name: '确定出征' }));

    fireEvent.pointerDown(screen.getAllByTestId(/deploy-target-/)[0], { button: 0, buttons: 1 });
    const unitMenu = screen.getByTestId('unit-command-menu');
    await user.click(within(unitMenu).getByRole('button', { name: '计略' }));

    expect(screen.getByTestId('unit-strategy-menu')).toBeVisible();
  });

  it('completes Ma Su deployment after selecting 火计 and a target cell', async () => {
    const user = userEvent.setup();
    renderState();

    await user.click(screen.getByRole('button', { name: /^武陵 刘备/ }));
    const menu = screen.getByTestId('city-command-menu');
    await user.click(within(menu).getByRole('button', { name: '军事' }));
    await user.click(within(menu).getByRole('button', { name: '出征' }));
    const deployDialog = await chooseDeployLeader(user, '马谡');
    await user.click(within(deployDialog).getByRole('button', { name: '确定出征' }));

    fireEvent.pointerDown(screen.getAllByTestId(/deploy-target-/)[0], { button: 0, buttons: 1 });
    const unitMenu = screen.getByTestId('unit-command-menu');
    await user.click(within(unitMenu).getByRole('button', { name: '计略' }));
    await user.click(within(screen.getByTestId('unit-strategy-menu')).getByRole('button', { name: /火计/ }));

    const target = screen.getAllByTestId(/strategy-target-/)[0];
    fireEvent.pointerDown(target, { button: 0, buttons: 1 });

    expect(screen.getByTestId('battle-unit-marker')).toBeVisible();
    expect(screen.queryByTestId('unit-command-menu')).not.toBeInTheDocument();
  });

  it('shows 强行 deployment targets for the selected officer', async () => {
    const user = userEvent.setup();
    const state = createGame('liu', 3);
    state.officers['liu-bei'].skill = '强行';
    const base = deploymentCells(state, 'jiangling', movementAllowanceForProfile('sword'), 'sword');
    const enhanced = deploymentCells(state, 'jiangling', movementAllowanceForProfile('sword') + 5, 'sword');
    const destination = enhanced.find((coord) => !base.some((cell) => cell.q === coord.q && cell.r === coord.r));
    expect(destination).toBeDefined();
    renderState(state);

    await user.click(screen.getByRole('button', { name: /^江陵 刘备/ }));
    const menu = screen.getByTestId('city-command-menu');
    await user.click(within(menu).getByRole('button', { name: '军事' }));
    await user.click(within(menu).getByRole('button', { name: '出征' }));
    const dialog = await chooseDeployLeader(user, '刘备');
    await user.click(within(dialog).getByRole('button', { name: '确定出征' }));

    expect(screen.getByTestId(`deploy-target-${destination!.q}-${destination!.r}`)).toBeVisible();
  });

  it('opens a separate officer picker and assigns one leader with two deputies', async () => {
    const user = userEvent.setup();
    renderState();

    const jianglingMarker = screen.getAllByTestId('city-marker').find((marker) => marker.textContent?.includes('江陵'));
    await user.click(jianglingMarker!);
    const menu = screen.getByTestId('city-command-menu');
    await user.click(within(menu).getByRole('button', { name: '军事' }));
    await user.click(within(menu).getByRole('button', { name: '出征' }));

    const deployDialog = screen.getByRole('dialog', { name: '出征编制' });
    await user.click(within(deployDialog).getByRole('button', { name: '选择武将' }));

    const officerDialog = screen.getByRole('dialog', { name: '武将选择' });
    expect(within(officerDialog).getByText('主将', { selector: '.officer-slot span' })).toBeVisible();
    expect(within(officerDialog).getByText('副将 1')).toBeVisible();
    expect(within(officerDialog).getByText('副将 2')).toBeVisible();

    await user.click(within(officerDialog).getByRole('button', { name: '选择关羽为主将' }));
    await user.click(within(officerDialog).getByRole('button', { name: '选择刘备为副将' }));
    await user.click(within(officerDialog).getByRole('button', { name: '选择简雍为副将' }));
    await user.click(within(officerDialog).getByRole('button', { name: '确定武将' }));

    expect(screen.getByRole('dialog', { name: '出征编制' })).toBeVisible();
    expect(screen.getByTestId('deploy-officer-summary')).toHaveTextContent('关羽 / 刘备 / 简雍');
    expect(within(screen.getByRole('dialog', { name: '出征编制' })).getByText('攻击')).toBeVisible();
    expect(within(screen.getByRole('dialog', { name: '出征编制' })).getByTestId('deploy-attack')).toHaveTextContent('95');
    expect(within(screen.getByRole('dialog', { name: '出征编制' })).getByTestId('deploy-defense')).toHaveTextContent('95');
  });

  it('switches the deploy officer picker fixed list area between ability, skill, and aptitude views', async () => {
    const user = userEvent.setup();
    renderState();

    const jianglingMarker = screen.getAllByTestId('city-marker').find((marker) => marker.textContent?.includes('江陵'));
    await user.click(jianglingMarker!);
    const menu = screen.getByTestId('city-command-menu');
    await user.click(within(menu).getByRole('button', { name: '军事' }));
    await user.click(within(menu).getByRole('button', { name: '出征' }));
    await user.click(within(screen.getByRole('dialog', { name: '出征编制' })).getByRole('button', { name: '选择武将' }));

    const officerDialog = screen.getByRole('dialog', { name: '武将选择' });
    const fixedArea = within(officerDialog).getByRole('region', { name: '可出征武将' });

    expect(within(officerDialog).getByRole('button', { name: '能力' })).toHaveClass('is-active');
    expect(within(fixedArea).getByText('统帅')).toBeVisible();
    expect(within(fixedArea).getByText('智力')).toBeVisible();
    expect(within(fixedArea).getByText('魅力')).toBeVisible();

    await user.click(within(officerDialog).getByRole('button', { name: '特技' }));

    expect(within(officerDialog).getByRole('button', { name: '特技' })).toHaveClass('is-active');
    expect(within(fixedArea).getByText('神将')).toBeVisible();
    expect(within(fixedArea).queryByText('智力')).not.toBeInTheDocument();

    await user.click(within(officerDialog).getByRole('button', { name: '适性' }));

    expect(within(officerDialog).getByRole('button', { name: '适性' })).toHaveClass('is-active');
    for (const label of ['枪', '戟', '弩', '骑', '兵器', '水军']) {
      expect(within(fixedArea).getByText(label)).toBeVisible();
    }
    const guanYuRow = within(fixedArea).getByText('关羽').closest('.officer-picker-row');
    expect(guanYuRow).toBeTruthy();
    expect(guanYuRow).toHaveTextContent('SSBACC');
  });

  it('sorts the deploy officer picker by clickable ability and aptitude headers', async () => {
    const user = userEvent.setup();
    renderState();

    const jianglingMarker = screen.getAllByTestId('city-marker').find((marker) => marker.textContent?.includes('江陵'));
    await user.click(jianglingMarker!);
    const menu = screen.getByTestId('city-command-menu');
    await user.click(within(menu).getByRole('button', { name: '军事' }));
    await user.click(within(menu).getByRole('button', { name: '出征' }));
    await user.click(within(screen.getByRole('dialog', { name: '出征编制' })).getByRole('button', { name: '选择武将' }));

    const officerDialog = screen.getByRole('dialog', { name: '武将选择' });
    const fixedArea = within(officerDialog).getByRole('region', { name: '可出征武将' });
    const names = () => [...fixedArea.querySelectorAll('.officer-picker-row > strong')].map((name) => name.textContent ?? '');

    await user.click(within(fixedArea).getByRole('button', { name: '按统帅排序' }));
    expect(names()[0]).toBe('关羽');

    await user.click(within(fixedArea).getByRole('button', { name: '按统帅排序' }));
    expect(names()[0]).toBe('简雍');

    await user.click(within(officerDialog).getByRole('button', { name: '适性' }));
    await user.click(within(fixedArea).getByRole('button', { name: '按枪排序' }));
    expect(names()[0]).toBe('关羽');
  });

  it('clears the previous leader when a different leader is selected', async () => {
    const user = userEvent.setup();
    renderState();

    const jianglingMarker = screen.getAllByTestId('city-marker').find((marker) => marker.textContent?.includes('江陵'));
    await user.click(jianglingMarker!);
    const menu = screen.getByTestId('city-command-menu');
    await user.click(within(menu).getByRole('button', { name: '军事' }));
    await user.click(within(menu).getByRole('button', { name: '出征' }));
    const deployDialog = screen.getByRole('dialog', { name: '出征编制' });
    await user.click(within(deployDialog).getByRole('button', { name: '选择武将' }));

    const officerDialog = screen.getByRole('dialog', { name: '武将选择' });
    const liuBeiLeader = within(officerDialog).getByRole('button', { name: '选择刘备为主将' });
    const guanYuLeader = within(officerDialog).getByRole('button', { name: '选择关羽为主将' });
    await user.click(liuBeiLeader);
    expect(liuBeiLeader).toHaveClass('is-active');

    await user.click(guanYuLeader);

    expect(guanYuLeader).toHaveClass('is-active');
    expect(liuBeiLeader).not.toHaveClass('is-active');
    expect(within(officerDialog).getByRole('region', { name: '已选武将' })).toHaveTextContent('主将关羽');
    expect(within(officerDialog).getByRole('region', { name: '已选武将' })).not.toHaveTextContent('刘备');
  });

  it('uses range sliders for troops and food and caps weapon troops by armament stock', async () => {
    const user = userEvent.setup();
    const state = createGame('liu', 3);
    state.cities.jiangling.armaments!.spear = 1500;
    state.cities.jiangling.food = 10000;
    renderState(state);

    const jianglingMarker = screen.getAllByTestId('city-marker').find((marker) => marker.textContent?.includes('江陵'));
    await user.click(jianglingMarker!);
    const menu = screen.getByTestId('city-command-menu');
    await user.click(within(menu).getByRole('button', { name: '军事' }));
    await user.click(within(menu).getByRole('button', { name: '出征' }));
    const dialog = screen.getByRole('dialog', { name: '出征编制' });

    await user.click(within(dialog).getByRole('button', { name: '枪兵' }));
    const troopSlider = within(dialog).getByRole('slider', { name: '出征士兵' });
    const foodSlider = within(dialog).getByRole('slider', { name: '出征兵粮' });
    expect(troopSlider).toHaveAttribute('max', '1500');
    expect(troopSlider).toHaveValue('1500');
    expect(foodSlider).toHaveAttribute('max', '10000');

    fireEvent.change(troopSlider, { target: { value: '1000' } });
    fireEvent.change(foodSlider, { target: { value: '2000' } });

    expect(troopSlider).toHaveValue('1000');
    expect(foodSlider).toHaveValue('2000');
    expect(within(dialog).getByTestId('deploy-troop-value')).toHaveTextContent('1,000');
    expect(within(dialog).getByTestId('deploy-food-value')).toHaveTextContent('2,000');
  });

  it('uses a gold slider for combat deployment and carries that gold on the unit', async () => {
    const user = userEvent.setup();
    const state = createGame('liu', 3);
    state.cities.jiangling.gold = 5000;
    renderState(state);

    const jianglingMarker = screen.getByRole('button', { name: /^江陵 刘备/ });
    await user.click(jianglingMarker);
    const menu = screen.getByTestId('city-command-menu');
    await user.click(within(menu).getByTestId('city-command-section-military'));
    await user.click(within(menu).getByTestId('city-command-action-deploy'));
    const dialog = screen.getByRole('dialog', { name: '出征编制' });
    const goldSlider = within(dialog).getByRole('slider', { name: '出征资金' });

    expect(goldSlider).toHaveAttribute('max', '5000');
    expect(goldSlider).toHaveValue('1000');
    fireEvent.change(goldSlider, { target: { value: '900' } });
    expect(within(dialog).getByTestId('deploy-gold-value')).toHaveTextContent('900');

    await user.click(within(dialog).getByRole('button', { name: '确定出征' }));
    fireEvent.pointerDown(screen.getAllByTestId(/deploy-target-/)[0], { button: 0, buttons: 1 });
    await user.click(within(screen.getByTestId('unit-command-menu')).getByRole('button', { name: '待命' }));

    expect(screen.getByTestId('battle-unit-marker')).toBeVisible();
    expect(window.localStorage.getItem('jingxiang-208-autosave-v1')).toContain('"gold":900');
  });

  it('shows deployed unit gold in the UI and spends it when building a facility', async () => {
    const user = userEvent.setup();
    const state = createGame('liu', 3);
    state.cities.jiangling.gold = 5000;
    renderState(state);

    await user.click(screen.getByRole('button', { name: /^江陵 刘备/ }));
    const menu = screen.getByTestId('city-command-menu');
    await user.click(within(menu).getByTestId('city-command-section-military'));
    await user.click(within(menu).getByTestId('city-command-action-deploy'));
    const dialog = screen.getByRole('dialog', { name: '出征编制' });
    fireEvent.change(within(dialog).getByRole('slider', { name: '出征资金' }), { target: { value: '900' } });
    await user.click(within(dialog).getByRole('button', { name: '确定出征' }));

    fireEvent.pointerDown(screen.getAllByTestId(/deploy-target-/)[0], { button: 0, buttons: 1, clientX: 320, clientY: 220 });
    await user.click(within(screen.getByTestId('unit-command-menu')).getByRole('button', { name: '待命' }));

    expect(screen.getByLabelText('城市经营面板')).toHaveTextContent('4,100');
    const unitMarker = screen.getByTestId('battle-unit-marker');
    fireEvent.pointerEnter(unitMarker, { clientX: 300, clientY: 180 });
    expect(screen.getByTestId('unit-info-panel')).toHaveTextContent('900');
    fireEvent.pointerLeave(unitMarker);

    await user.click(screen.getByTestId('end-ten-day-button'));
    fireEvent.pointerDown(screen.getByTestId('battle-unit-marker'), { button: 0, buttons: 1, clientX: 300, clientY: 180 });
    fireEvent.pointerDown(screen.getByTestId('battle-unit-marker'), { button: 0, buttons: 1, clientX: 300, clientY: 180 });
    await user.click(within(screen.getByTestId('unit-command-menu')).getByRole('button', { name: '设置' }));
    await user.click(within(screen.getByTestId('unit-facility-menu')).getByRole('button', { name: /箭楼/ }));
    fireEvent.pointerDown(screen.getAllByTestId(/strategy-target-/)[0], { button: 0, buttons: 1 });

    fireEvent.pointerEnter(screen.getByTestId('battle-unit-marker'), { clientX: 300, clientY: 180 });
    expect(screen.getByTestId('unit-info-panel')).toHaveTextContent('300');
  });

  it('caps weapon troop slider at available armament stock', async () => {
    const user = userEvent.setup();
    const state = createGame('liu', 3);
    state.cities.jiangling.armaments!.spear = 500;
    renderState(state);

    const jianglingMarker = screen.getAllByTestId('city-marker').find((marker) => marker.textContent?.includes('江陵'));
    await user.click(jianglingMarker!);
    const menu = screen.getByTestId('city-command-menu');
    await user.click(within(menu).getByRole('button', { name: '军事' }));
    await user.click(within(menu).getByRole('button', { name: '出征' }));
    const dialog = screen.getByRole('dialog', { name: '出征编制' });
    await user.click(within(dialog).getByRole('button', { name: '枪兵' }));

    expect(within(dialog).getByRole('slider', { name: '出征士兵' })).toHaveAttribute('max', '500');
    expect(within(dialog).getByRole('alert')).toHaveTextContent('士兵必须为 1000-10000');
    expect(within(dialog).getByRole('button', { name: '确定出征' })).toBeDisabled();
  });

  it('closes the transport setup popup on right click', async () => {
    const user = userEvent.setup();
    renderState();

    await user.click(screen.getAllByTestId('city-marker')[2]);
    await user.click(screen.getByTestId('city-command-section-military'));
    await user.click(screen.getByTestId('city-command-action-transport'));
    const dialog = screen.getAllByRole('dialog')[0];

    const defaultWasAllowed = fireEvent.contextMenu(dialog);

    expect(defaultWasAllowed).toBe(false);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('opens a transport dialog from the military menu and places a transport unit', async () => {
    const user = userEvent.setup();
    renderState();

    const jianglingMarker = screen.getAllByTestId('city-marker').find((marker) => marker.textContent?.includes('江陵'));
    expect(jianglingMarker).toBeTruthy();
    await user.click(jianglingMarker!);
    const menu = screen.getByTestId('city-command-menu');
    await user.click(within(menu).getByRole('button', { name: '军事' }));
    await user.click(within(menu).getByRole('button', { name: '输送' }));

    const dialog = screen.getByRole('dialog', { name: '输送编制' });
    expect(within(dialog).getByLabelText('执行武将')).toBeVisible();
    expect(within(dialog).getByLabelText('输送士兵')).toBeVisible();
    expect(within(dialog).getByLabelText('输送资金')).toBeVisible();
    expect(within(dialog).getByLabelText('输送兵粮')).toBeVisible();
    await user.clear(within(dialog).getByLabelText('输送资金'));
    await user.type(within(dialog).getByLabelText('输送资金'), '900');
    await user.click(within(dialog).getByRole('button', { name: '确定输送' }));

    expect(screen.queryByRole('dialog', { name: '输送编制' })).not.toBeInTheDocument();
    const transportCell = screen.getAllByTestId(/deploy-target-/)[0];
    fireEvent.pointerDown(transportCell, { button: 0, buttons: 1 });

    const unitMarker = screen.getByTestId('battle-unit-marker');
    expect(unitMarker).toBeVisible();
    expect(unitMarker).toHaveAttribute('data-unit-kind', 'transport');
    expect(within(unitMarker).getByText('输')).toBeVisible();
    expect(within(unitMarker).getByText('1,000')).toBeVisible();
  });

  it('shows unit commands on a selected unit and moves to a selected cell only after wait is chosen', async () => {
    const user = userEvent.setup();
    renderState();

    const jianglingMarker = screen.getAllByTestId('city-marker').find((marker) => marker.textContent?.includes('江陵'));
    expect(jianglingMarker).toBeTruthy();
    await user.click(jianglingMarker!);
    const menu = screen.getByTestId('city-command-menu');
    await user.click(within(menu).getByRole('button', { name: '军事' }));
    await user.click(within(menu).getByRole('button', { name: '出征' }));

    const dialog = screen.getByRole('dialog', { name: '出征编制' });
    const confirmedDialog = await chooseDeployLeader(user, '刘备');
    await user.click(within(confirmedDialog).getByRole('button', { name: '确定出征' }));
    fireEvent.pointerDown(screen.getAllByTestId(/deploy-target-/)[0], { button: 0, buttons: 1 });
    await user.click(within(screen.getByTestId('unit-command-menu')).getByRole('button', { name: '待命' }));

    await user.click(screen.getByTestId('end-ten-day-button'));
    const unitMarker = screen.getByTestId('battle-unit-marker');
    fireEvent.pointerDown(unitMarker, { button: 0, buttons: 1 });
    expect(screen.getAllByTestId(/move-target-/).length).toBeGreaterThan(0);

    const rightClickedMoveTarget = screen.getAllByTestId(/move-target-/)[0];
    fireEvent.pointerDown(rightClickedMoveTarget, { button: 2, buttons: 2, clientX: 300, clientY: 220 });
    expect(screen.queryByTestId('unit-command-menu')).not.toBeInTheDocument();

    fireEvent.contextMenu(rightClickedMoveTarget, { clientX: 300, clientY: 220 });

    expect(screen.queryByTestId(/move-target-/)).not.toBeInTheDocument();
    expect(screen.queryByTestId('map-context-menu')).not.toBeInTheDocument();

    fireEvent.pointerDown(unitMarker, { button: 0, buttons: 1 });

    fireEvent.pointerDown(unitMarker, { button: 0, buttons: 1, clientX: 240, clientY: 180 });
    const unitMenu = screen.getByTestId('unit-command-menu');
    for (const label of ['待命', '攻击', '齐攻', '战法', '单挑', '计略', '设置', '修补']) {
      expect(within(unitMenu).getByRole('button', { name: label })).toBeVisible();
    }
    fireEvent.pointerDown(screen.getByTestId('map-viewport'), { button: 0 });
    expect(screen.queryByTestId('unit-command-menu')).not.toBeInTheDocument();

    const moveTarget = screen.getAllByTestId(/move-target-/)[0];
    const [, q, r] = moveTarget.getAttribute('data-testid')!.match(/move-target-(\d+)-(\d+)/)!;
    fireEvent.pointerDown(moveTarget, { button: 0, buttons: 1, clientX: 320, clientY: 220 });

    const targetMenu = screen.getByTestId('unit-command-menu');
    for (const label of ['待命', '攻击', '齐攻', '战法', '单挑', '计略', '设置', '修补']) {
      expect(within(targetMenu).getByRole('button', { name: label })).toBeVisible();
    }
    expect(screen.getByTestId('battle-unit-marker')).not.toHaveAttribute('data-grid-position', `${q},${r}`);

    fireEvent.contextMenu(screen.getByTestId('map-viewport'), { clientX: 360, clientY: 260 });
    expect(screen.queryByTestId('unit-command-menu')).not.toBeInTheDocument();
    expect(screen.queryByTestId('map-context-menu')).not.toBeInTheDocument();

    fireEvent.pointerDown(moveTarget, { button: 0, buttons: 1, clientX: 320, clientY: 220 });

    await user.click(within(screen.getByTestId('unit-command-menu')).getByRole('button', { name: '待命' }));

    expect(screen.queryByTestId(/move-target-/)).not.toBeInTheDocument();
    expect(screen.queryByTestId('unit-command-menu')).not.toBeInTheDocument();
    expect(screen.getByTestId('battle-unit-marker')).toHaveAttribute('data-grid-position', `${q},${r}`);
  });

  it('attacks an enemy city from the unit command menu when no enemy unit is in range', async () => {
    const user = userEvent.setup();
    const deployed = deployUnit(createGame('liu', 1), 'liu', {
      cityId: 'jiangling',
      officerId: 'guan-yu',
      targetCityId: 'xiangyang',
      troopType: 'siege',
      troops: 4000,
      food: 6000,
    });
    const state = deployed;
    const attacker = Object.values(state.units)[0];
    const target = state.cities.xiangyang;
    const attackCell = sevenCellCityFootprint({ q: target.gridQ, r: target.gridR })
      .flatMap((coord) => neighborsOf(coord.q, coord.r))
      .find((coord) => !cityKeys(state).has(gridKey(coord)))!;
    state.units[attacker.id].q = attackCell.q;
    state.units[attacker.id].r = attackCell.r;
    state.units[attacker.id].moved = false;
    state.units[attacker.id].acted = false;
    state.units[attacker.id].movementRemaining = 16;
    renderState(state);

    const unitMarker = screen.getAllByTestId('battle-unit-marker')
      .find((marker) => marker.getAttribute('data-grid-position') === `${attacker.q},${attacker.r}`)!;
    fireEvent.pointerDown(unitMarker, { button: 0, buttons: 1, clientX: 240, clientY: 180 });
    fireEvent.pointerDown(unitMarker, { button: 0, buttons: 1, clientX: 240, clientY: 180 });

    const unitMenu = screen.getByTestId('unit-command-menu');
    await user.click(within(unitMenu).getByRole('button', { name: '攻击' }));

    const xiangyang = screen.getAllByTestId('city-marker')
      .find((marker) => marker.textContent?.includes('襄阳'))!;
    const troopsBefore = Number(within(xiangyang).getByTestId('city-marker-troops').textContent);
    await user.click(xiangyang);

    expect(Number(within(xiangyang).getByTestId('city-marker-troops').textContent)).toBeLessThan(troopsBefore);
    expect(screen.queryByTestId('unit-command-menu')).not.toBeInTheDocument();
  });

  it('disables attack commands when no enemy unit or city is in range', () => {
    const deployed = deployUnit(createGame('liu', 1), 'liu', {
      cityId: 'jiangling',
      officerId: 'guan-yu',
      troopType: 'spear',
      troops: 4000,
      food: 6000,
    });
    renderState(settleTenDay(deployed));

    const unitMarker = screen.getByTestId('battle-unit-marker');
    fireEvent.pointerDown(unitMarker, { button: 0, buttons: 1, clientX: 240, clientY: 180 });
    fireEvent.pointerDown(unitMarker, { button: 0, buttons: 1, clientX: 240, clientY: 180 });

    const unitMenu = screen.getByTestId('unit-command-menu');
    for (const label of ['攻击', '齐攻', '战法', '单挑']) {
      expect(within(unitMenu).getByRole('button', { name: label })).toBeDisabled();
    }
  });

  it('enables attack, tactics, and duel from a move destination adjacent to an enemy unit', () => {
    const deployed = deployUnit(createGame('liu', 1), 'liu', {
      cityId: 'jiangling',
      officerId: 'guan-yu',
      troopType: 'spear',
      troops: 4000,
      food: 6000,
    });
    const state = settleTenDay(deployed);
    const attacker = Object.values(state.units)[0];
    const { destination, enemyPosition } = destinationWithEnemyNeighbor(state, attacker.id);
    state.units['enemy-after-move'] = {
      id: 'enemy-after-move',
      forceId: 'cao',
      leaderId: 'cao-ren',
      homeCityId: 'xiangyang',
      q: enemyPosition.q,
      r: enemyPosition.r,
      troops: 3000,
      food: 3000,
      energy: 100,
      movementRemaining: 5,
      moved: false,
      acted: false,
    };
    renderState(state);

    const playerUnit = screen.getAllByTestId('battle-unit-marker')
      .find((marker) => marker.getAttribute('data-grid-position') === `${attacker.q},${attacker.r}`)!;
    fireEvent.pointerDown(playerUnit, { button: 0, buttons: 1, clientX: 240, clientY: 180 });
    fireEvent.pointerDown(screen.getByTestId(`move-target-${destination.q}-${destination.r}`), { button: 0, buttons: 1, clientX: 320, clientY: 220 });

    const menu = screen.getByTestId('unit-command-menu');
    expect(within(menu).getByRole('button', { name: '攻击' })).toBeEnabled();
    expect(within(menu).getByRole('button', { name: '战法' })).toBeEnabled();
    expect(within(menu).getByRole('button', { name: '单挑' })).toBeEnabled();
    expect(within(menu).getByRole('button', { name: '齐攻' })).toBeDisabled();

    fireEvent.click(within(menu).getByRole('button', { name: '攻击' }));

    expect(screen.getByTestId('attack-target-arrow')).toBeVisible();
  });

  it('opens troop tactics from the unit command menu and executes the selected tactic', async () => {
    const user = userEvent.setup();
    const state = deployUnit(createGame('liu', 1), 'liu', {
      cityId: 'jiangling',
      officerId: 'guan-yu',
      troopType: 'spear',
      troops: 3000,
      food: 3000,
    });
    const attacker = Object.values(state.units)[0];
    state.units[attacker.id].q = 10;
    state.units[attacker.id].r = 10;
    state.units[attacker.id].moved = false;
    state.units[attacker.id].acted = false;
    state.units[attacker.id].energy = 100;
    state.units[attacker.id].movementRemaining = 22;
    state.units['enemy-tactic-target'] = {
      id: 'enemy-tactic-target',
      forceId: 'cao',
      leaderId: 'cao-ren',
      homeCityId: 'xiangyang',
      q: 11,
      r: 10,
      troops: 3000,
      food: 3000,
      energy: 100,
      movementRemaining: 5,
      moved: false,
      acted: false,
    };
    renderState(state);

    const playerUnit = screen.getAllByTestId('battle-unit-marker')
      .find((marker) => marker.getAttribute('data-grid-position') === '10,10')!;
    fireEvent.pointerDown(playerUnit, { button: 0, buttons: 1, clientX: 240, clientY: 180 });
    fireEvent.pointerDown(playerUnit, { button: 0, buttons: 1, clientX: 240, clientY: 180 });

    await user.click(within(screen.getByTestId('unit-command-menu')).getByRole('button', { name: '战法' }));

    const tacticMenu = screen.getByTestId('unit-tactic-menu');
    expect(within(tacticMenu).getByRole('button', { name: '突刺' })).toBeVisible();
    expect(within(tacticMenu).getByRole('button', { name: '螺旋突刺' })).toBeVisible();
    expect(within(tacticMenu).getByRole('button', { name: '二段突刺' })).toBeVisible();

    await user.click(within(tacticMenu).getByRole('button', { name: '突刺' }));
    expect(screen.getByTestId('attack-target-arrow')).toBeVisible();

    const enemyUnit = screen.getAllByTestId('battle-unit-marker')
      .find((marker) => marker.getAttribute('data-grid-position') === '11,10')!;
    fireEvent.pointerDown(enemyUnit, { button: 0, buttons: 1, clientX: 280, clientY: 180 });

    expect(screen.getAllByTestId('battle-unit-marker')
      .find((marker) => marker.getAttribute('data-grid-position') === '12,11')).toBeTruthy();
    expect(screen.getByTestId('battle-damage-number')).toBeVisible();
  });

  it('shows all troop tactics while locking tiers above the formation aptitude', async () => {
    const user = userEvent.setup();
    const state = deployUnit(createGame('liu', 1), 'liu', {
      cityId: 'jiangling',
      officerId: 'guan-yu',
      troopType: 'spear',
      troops: 3000,
      food: 3000,
    });
    const attacker = Object.values(state.units)[0];
    state.officers['guan-yu'].aptitudes = { ...state.officers['guan-yu'].aptitudes!, spear: 'B' };
    Object.assign(attacker, { q: 10, r: 10, energy: 100, moved: false, acted: false, movementRemaining: 22 });
    state.units['enemy-aptitude-target'] = {
      id: 'enemy-aptitude-target',
      forceId: 'cao',
      leaderId: 'cao-ren',
      homeCityId: 'xiangyang',
      q: 11,
      r: 10,
      troops: 3000,
      food: 3000,
      energy: 100,
      movementRemaining: 5,
      moved: false,
      acted: false,
    };
    renderState(state);

    const marker = screen.getAllByTestId('battle-unit-marker')
      .find((candidate) => candidate.getAttribute('data-grid-position') === '10,10')!;
    fireEvent.pointerDown(marker, { button: 0, buttons: 1, clientX: 240, clientY: 180 });
    fireEvent.pointerDown(marker, { button: 0, buttons: 1, clientX: 240, clientY: 180 });
    const tacticCommand = within(screen.getByTestId('unit-command-menu')).getByRole('button', { name: '战法' });

    expect(tacticCommand).toBeEnabled();
    await user.click(tacticCommand);

    const tacticMenu = screen.getByTestId('unit-tactic-menu');
    expect(within(tacticMenu).getByRole('button', { name: '突刺' })).toBeEnabled();
    expect(within(tacticMenu).getByRole('button', { name: '螺旋突刺' })).toBeDisabled();
    expect(within(tacticMenu).getByRole('button', { name: '螺旋突刺' })).toHaveAttribute('title', '需要枪兵适性 A');
    expect(within(tacticMenu).getByRole('button', { name: '二段突刺' })).toBeDisabled();
    expect(within(tacticMenu).getByRole('button', { name: '二段突刺' })).toHaveAttribute('title', '需要枪兵适性 S');
  });

  it('locks tactics that cost more energy while keeping an affordable tactic usable', async () => {
    const user = userEvent.setup();
    const state = deployUnit(createGame('liu', 1), 'liu', {
      cityId: 'jiangling',
      officerId: 'guan-yu',
      troopType: 'spear',
      troops: 3000,
      food: 3000,
    });
    const attacker = Object.values(state.units)[0];
    Object.assign(attacker, { q: 10, r: 10, energy: 19, moved: false, acted: false, movementRemaining: 22 });
    state.units['enemy-energy-target'] = {
      id: 'enemy-energy-target',
      forceId: 'cao',
      leaderId: 'cao-ren',
      homeCityId: 'xiangyang',
      q: 11,
      r: 10,
      troops: 3000,
      food: 3000,
      energy: 100,
      movementRemaining: 5,
      moved: false,
      acted: false,
    };
    renderState(state);

    const marker = screen.getAllByTestId('battle-unit-marker')
      .find((candidate) => candidate.getAttribute('data-grid-position') === '10,10')!;
    fireEvent.pointerDown(marker, { button: 0, buttons: 1, clientX: 240, clientY: 180 });
    fireEvent.pointerDown(marker, { button: 0, buttons: 1, clientX: 240, clientY: 180 });
    const tacticCommand = within(screen.getByTestId('unit-command-menu')).getByRole('button', { name: '战法' });

    expect(tacticCommand).toBeEnabled();
    await user.click(tacticCommand);

    const tacticMenu = screen.getByTestId('unit-tactic-menu');
    expect(within(tacticMenu).getByRole('button', { name: '突刺' })).toBeEnabled();
    expect(within(tacticMenu).getByRole('button', { name: '螺旋突刺' })).toBeDisabled();
    expect(within(tacticMenu).getByRole('button', { name: '螺旋突刺' })).toHaveAttribute('title', '气力不足');
  });

  it('locks a tactic without a valid target while another tactic keeps the primary command enabled', async () => {
    const user = userEvent.setup();
    const state = deployUnit(createGame('liu', 1), 'liu', {
      cityId: 'jiangling',
      officerId: 'guan-yu',
      troopType: 'crossbow',
      troops: 2000,
      food: 3000,
    });
    const attacker = Object.values(state.units)[0];
    state.officers['guan-yu'].aptitudes = { ...state.officers['guan-yu'].aptitudes!, crossbow: 'S' };
    Object.assign(attacker, { q: 10, r: 10, energy: 100, moved: false, acted: false, movementRemaining: 19 });
    state.units['enemy-crossbow-target'] = {
      id: 'enemy-crossbow-target',
      forceId: 'cao',
      leaderId: 'cao-ren',
      homeCityId: 'xiangyang',
      q: 11,
      r: 10,
      troops: 3000,
      food: 3000,
      energy: 100,
      movementRemaining: 5,
      moved: false,
      acted: false,
    };
    renderState(state);

    const marker = screen.getAllByTestId('battle-unit-marker')
      .find((candidate) => candidate.getAttribute('data-grid-position') === '10,10')!;
    fireEvent.pointerDown(marker, { button: 0, buttons: 1, clientX: 240, clientY: 180 });
    fireEvent.pointerDown(marker, { button: 0, buttons: 1, clientX: 240, clientY: 180 });
    const tacticCommand = within(screen.getByTestId('unit-command-menu')).getByRole('button', { name: '战法' });

    expect(tacticCommand).toBeEnabled();
    await user.click(tacticCommand);

    const tacticMenu = screen.getByTestId('unit-tactic-menu');
    expect(within(tacticMenu).getByRole('button', { name: '火矢' })).toBeDisabled();
    expect(within(tacticMenu).getByRole('button', { name: '火矢' })).toHaveAttribute('title', '无有效目标');
    expect(within(tacticMenu).getByRole('button', { name: '贯箭' })).toBeDisabled();
    expect(within(tacticMenu).getByRole('button', { name: '乱射' })).toBeEnabled();
  });

  it('disables the primary tactic command when every tactic is unavailable', () => {
    const state = deployUnit(createGame('liu', 1), 'liu', {
      cityId: 'jiangling',
      officerId: 'guan-yu',
      troopType: 'spear',
      troops: 3000,
      food: 3000,
    });
    const attacker = Object.values(state.units)[0];
    Object.assign(attacker, { q: 10, r: 10, energy: 14, moved: false, acted: false, movementRemaining: 22 });
    state.units['enemy-unavailable-target'] = {
      id: 'enemy-unavailable-target',
      forceId: 'cao',
      leaderId: 'cao-ren',
      homeCityId: 'xiangyang',
      q: 11,
      r: 10,
      troops: 3000,
      food: 3000,
      energy: 100,
      movementRemaining: 5,
      moved: false,
      acted: false,
    };
    renderState(state);

    const marker = screen.getAllByTestId('battle-unit-marker')
      .find((candidate) => candidate.getAttribute('data-grid-position') === '10,10')!;
    fireEvent.pointerDown(marker, { button: 0, buttons: 1, clientX: 240, clientY: 180 });
    fireEvent.pointerDown(marker, { button: 0, buttons: 1, clientX: 240, clientY: 180 });

    expect(within(screen.getByTestId('unit-command-menu')).getByRole('button', { name: '战法' })).toBeDisabled();
  });

  it('does not enter target selection when a locked tactic is clicked', async () => {
    const user = userEvent.setup();
    const state = deployUnit(createGame('liu', 1), 'liu', {
      cityId: 'jiangling',
      officerId: 'guan-yu',
      troopType: 'spear',
      troops: 3000,
      food: 3000,
    });
    const attacker = Object.values(state.units)[0];
    state.officers['guan-yu'].aptitudes = { ...state.officers['guan-yu'].aptitudes!, spear: 'B' };
    Object.assign(attacker, { q: 10, r: 10, energy: 100, moved: false, acted: false, movementRemaining: 22 });
    state.units['enemy-locked-target'] = {
      id: 'enemy-locked-target',
      forceId: 'cao',
      leaderId: 'cao-ren',
      homeCityId: 'xiangyang',
      q: 11,
      r: 10,
      troops: 3000,
      food: 3000,
      energy: 100,
      movementRemaining: 5,
      moved: false,
      acted: false,
    };
    renderState(state);

    const marker = screen.getAllByTestId('battle-unit-marker')
      .find((candidate) => candidate.getAttribute('data-grid-position') === '10,10')!;
    fireEvent.pointerDown(marker, { button: 0, buttons: 1, clientX: 240, clientY: 180 });
    fireEvent.pointerDown(marker, { button: 0, buttons: 1, clientX: 240, clientY: 180 });
    await user.click(within(screen.getByTestId('unit-command-menu')).getByRole('button', { name: '战法' }));

    const lockedTactic = within(screen.getByTestId('unit-tactic-menu')).getByRole('button', { name: '螺旋突刺' });
    fireEvent.click(lockedTactic);

    expect(screen.queryByTestId('attack-target-arrow')).not.toBeInTheDocument();
    expect(screen.getByTestId('unit-tactic-menu')).toBeVisible();
  });

  it('ignites a completed fire ball facility when clicked as a fire strategy target', async () => {
    const user = userEvent.setup();
    const state = deployUnit(createGame('liu', 1), 'liu', {
      cityId: 'jiangling',
      officerId: 'guan-yu',
      troops: 4000,
      food: 6000,
    });
    const attacker = Object.values(state.units)[0];
    Object.assign(attacker, { q: 10, r: 10, energy: 100, moved: false, acted: false, movementRemaining: 22 });
    state.facilities = {
      ball: { id: 'ball', type: 'fireBall', forceId: 'liu', q: 11, r: 10, durability: 200, completed: true },
    };
    renderState(state);

    const marker = screen.getAllByTestId('battle-unit-marker')
      .find((candidate) => candidate.getAttribute('data-grid-position') === '10,10')!;
    fireEvent.pointerDown(marker, { button: 0, buttons: 1, clientX: 240, clientY: 180 });
    fireEvent.pointerDown(marker, { button: 0, buttons: 1, clientX: 240, clientY: 180 });
    await user.click(within(screen.getByTestId('unit-command-menu')).getAllByRole('button')[5]);
    await user.click(within(screen.getByTestId('unit-strategy-menu')).getAllByRole('button')[0]);

    expect(screen.getByTestId('strategy-target-11-10')).toBeVisible();
    fireEvent.pointerDown(screen.getByTestId('battle-facility-marker'), { button: 0, buttons: 1, clientX: 280, clientY: 180 });

    expect(screen.queryByTestId('battle-facility-marker')).not.toBeInTheDocument();
    expect(screen.getAllByTestId('fire-cell-marker')).toHaveLength(3);
  });

  it('ignites a completed fire ball facility when clicked as a fire arrow tactic target', async () => {
    const user = userEvent.setup();
    const state = deployUnit(createGame('liu', 1), 'liu', {
      cityId: 'jiangling',
      officerId: 'guan-yu',
      troopType: 'crossbow',
      troops: 1000,
      food: 6000,
    });
    const attacker = Object.values(state.units)[0];
    Object.assign(attacker, { q: 10, r: 10, energy: 100, moved: false, acted: false, movementRemaining: 22 });
    state.facilities = {
      ball: { id: 'ball', type: 'fireBall', forceId: 'liu', q: 12, r: 11, durability: 200, completed: true },
    };
    renderState(state);

    const marker = screen.getAllByTestId('battle-unit-marker')
      .find((candidate) => candidate.getAttribute('data-grid-position') === '10,10')!;
    fireEvent.pointerDown(marker, { button: 0, buttons: 1, clientX: 240, clientY: 180 });
    fireEvent.pointerDown(marker, { button: 0, buttons: 1, clientX: 240, clientY: 180 });
    await user.click(within(screen.getByTestId('unit-command-menu')).getByRole('button', { name: '战法' }));
    await user.click(within(screen.getByTestId('unit-tactic-menu')).getByRole('button', { name: '火矢' }));

    expect(screen.getByTestId('attack-facility-target-arrow')).toBeVisible();
    fireEvent.pointerDown(screen.getByTestId('battle-facility-marker'), { button: 0, buttons: 1, clientX: 300, clientY: 180 });

    expect(screen.queryByTestId('battle-facility-marker')).not.toBeInTheDocument();
    expect(screen.getAllByTestId('fire-cell-marker')).toHaveLength(3);
  });

  it('enables joint attack from a move destination when another actionable friendly unit also neighbors the enemy', () => {
    const deployed = deployUnit(createGame('liu', 1), 'liu', {
      cityId: 'jiangling',
      officerId: 'guan-yu',
      troops: 4000,
      food: 6000,
    });
    const state = settleTenDay(deployed);
    const attacker = Object.values(state.units)[0];
    const { destination, enemyPosition } = destinationWithEnemyNeighbor(state, attacker.id);
    const allyPosition = neighborsOf(enemyPosition.q, enemyPosition.r)
      .find((coord) => (
        (coord.q !== destination.q || coord.r !== destination.r) &&
        passableNonCityCell(state, coord) &&
        !Object.values(state.units).some((unit) => unit.q === coord.q && unit.r === coord.r)
      ))!;
    state.units['ally-joint'] = {
      id: 'ally-joint',
      forceId: 'liu',
      leaderId: 'zhang-fei',
      homeCityId: 'wuling',
      q: allyPosition.q,
      r: allyPosition.r,
      troops: 3000,
      food: 3000,
      energy: 100,
      movementRemaining: 5,
      moved: false,
      acted: false,
    };
    state.units['enemy-after-move'] = {
      id: 'enemy-after-move',
      forceId: 'cao',
      leaderId: 'cao-ren',
      homeCityId: 'xiangyang',
      q: enemyPosition.q,
      r: enemyPosition.r,
      troops: 3000,
      food: 3000,
      energy: 100,
      movementRemaining: 5,
      moved: false,
      acted: false,
    };
    renderState(state);

    const playerUnit = screen.getAllByTestId('battle-unit-marker')
      .find((marker) => marker.getAttribute('data-grid-position') === `${attacker.q},${attacker.r}`)!;
    fireEvent.pointerDown(playerUnit, { button: 0, buttons: 1, clientX: 240, clientY: 180 });
    fireEvent.pointerDown(screen.getByTestId(`move-target-${destination.q}-${destination.r}`), { button: 0, buttons: 1, clientX: 320, clientY: 220 });

    expect(within(screen.getByTestId('unit-command-menu')).getByRole('button', { name: '齐攻' })).toBeEnabled();
  });

  it('shows yellow arrows above enemy units that can be attacked', async () => {
    const user = userEvent.setup();
    const deployed = deployUnit(createGame('liu', 1), 'liu', {
      cityId: 'jiangling',
      officerId: 'guan-yu',
      troops: 4000,
      food: 6000,
    });
    const state = settleTenDay(deployed);
    const attacker = Object.values(state.units)[0];
    const targetPosition = neighborsOf(attacker.q, attacker.r)[0];
    state.units['enemy-target'] = {
      id: 'enemy-target',
      forceId: 'cao',
      leaderId: 'cao-ren',
      homeCityId: 'xiangyang',
      q: targetPosition.q,
      r: targetPosition.r,
      troops: 3000,
      food: 3000,
      energy: 100,
      movementRemaining: 5,
      moved: false,
      acted: false,
    };
    renderState(state);

    const playerUnit = screen.getAllByTestId('battle-unit-marker')
      .find((marker) => marker.getAttribute('data-grid-position') === `${attacker.q},${attacker.r}`)!;
    fireEvent.pointerDown(playerUnit, { button: 0, buttons: 1, clientX: 240, clientY: 180 });
    fireEvent.pointerDown(playerUnit, { button: 0, buttons: 1, clientX: 240, clientY: 180 });

    const unitMenu = screen.getByTestId('unit-command-menu');
    expect(within(unitMenu).getByRole('button', { name: '攻击' })).toBeEnabled();
    await user.click(within(unitMenu).getByRole('button', { name: '攻击' }));

    expect(screen.getByTestId('attack-target-arrow')).toBeVisible();
    expect(screen.getByTestId('attack-target-arrow')).toHaveTextContent('▼');
  });

  it('attacks a selected enemy unit and shows damage numbers above both units for two seconds after counterattack', async () => {
    vi.useFakeTimers();
    const deployed = deployUnit(createGame('liu', 1), 'liu', {
      cityId: 'jiangling',
      officerId: 'guan-yu',
      troops: 4000,
      food: 6000,
    });
    const state = settleTenDay(deployed);
    const attacker = Object.values(state.units)[0];
    const targetPosition = neighborsOf(attacker.q, attacker.r)[0];
    state.units['enemy-target'] = {
      id: 'enemy-target',
      forceId: 'cao',
      leaderId: 'cao-ren',
      homeCityId: 'xiangyang',
      q: targetPosition.q,
      r: targetPosition.r,
      troops: 3000,
      food: 3000,
      energy: 100,
      movementRemaining: 5,
      moved: false,
      acted: false,
    };
    try {
      renderState(state);

      const playerUnit = screen.getAllByTestId('battle-unit-marker')
        .find((marker) => marker.getAttribute('data-grid-position') === `${attacker.q},${attacker.r}`)!;
      fireEvent.pointerDown(playerUnit, { button: 0, buttons: 1, clientX: 240, clientY: 180 });
      fireEvent.pointerDown(playerUnit, { button: 0, buttons: 1, clientX: 240, clientY: 180 });

      fireEvent.click(within(screen.getByTestId('unit-command-menu')).getByRole('button', { name: '攻击' }));
      const enemyUnit = screen.getAllByTestId('battle-unit-marker')
        .find((marker) => marker.getAttribute('data-grid-position') === `${targetPosition.q},${targetPosition.r}`)!;
      fireEvent.pointerDown(enemyUnit, { button: 0, buttons: 1, clientX: 280, clientY: 180 });

      const damageNumbers = screen.getAllByTestId('battle-damage-number');
      expect(damageNumbers).toHaveLength(2);
      expect(damageNumbers.every((node) => node.textContent?.startsWith('-'))).toBe(true);
      expect(screen.queryByTestId('attack-target-arrow')).not.toBeInTheDocument();

      act(() => vi.advanceTimersByTime(1999));
      expect(screen.getAllByTestId('battle-damage-number')).toHaveLength(2);

      act(() => vi.advanceTimersByTime(1));
      expect(screen.queryByTestId('battle-damage-number')).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it('shows failed strategy feedback for two seconds without rendering successful outcomes', () => {
    vi.useFakeTimers();
    const state = createGame('liu', 1);
    state.strategyResultReports = [
      {
        id: 'strategy-failed',
        strategyId: 'fire',
        q: 10,
        r: 10,
        label: '计略失败',
        succeeded: false,
      },
      {
        id: 'strategy-succeeded',
        strategyId: 'fire',
        q: 11,
        r: 10,
        label: '计略成功',
        succeeded: true,
      },
    ];

    try {
      renderState(state);

      expect(screen.getByTestId('strategy-result-label')).toHaveTextContent('计略失败');
      expect(screen.queryByText('计略成功')).not.toBeInTheDocument();

      act(() => vi.advanceTimersByTime(1999));
      expect(screen.getByTestId('strategy-result-label')).toBeVisible();

      act(() => vi.advanceTimersByTime(1));
      expect(screen.queryByTestId('strategy-result-label')).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not show old damage numbers again after advancing the ten-day turn', () => {
    vi.useFakeTimers();
    const deployed = deployUnit(createGame('liu', 1), 'liu', {
      cityId: 'jiangling',
      officerId: 'guan-yu',
      troops: 4000,
      food: 6000,
    });
    const state = settleTenDay(deployed);
    const attacker = Object.values(state.units)[0];
    const targetPosition = neighborsOf(attacker.q, attacker.r)[0];
    state.units['enemy-target'] = {
      id: 'enemy-target',
      forceId: 'cao',
      leaderId: 'cao-ren',
      homeCityId: 'xiangyang',
      q: targetPosition.q,
      r: targetPosition.r,
      troops: 3000,
      food: 3000,
      energy: 100,
      movementRemaining: 5,
      moved: false,
      acted: false,
    };

    try {
      renderState(state);

      const playerUnit = screen.getAllByTestId('battle-unit-marker')
        .find((marker) => marker.getAttribute('data-grid-position') === `${attacker.q},${attacker.r}`)!;
      fireEvent.pointerDown(playerUnit, { button: 0, buttons: 1, clientX: 240, clientY: 180 });
      fireEvent.pointerDown(playerUnit, { button: 0, buttons: 1, clientX: 240, clientY: 180 });
      fireEvent.click(within(screen.getByTestId('unit-command-menu')).getByRole('button', { name: '攻击' }));

      const enemyUnit = screen.getAllByTestId('battle-unit-marker')
        .find((marker) => marker.getAttribute('data-grid-position') === `${targetPosition.q},${targetPosition.r}`)!;
      fireEvent.pointerDown(enemyUnit, { button: 0, buttons: 1, clientX: 280, clientY: 180 });
      expect(screen.getAllByTestId('battle-damage-number')).toHaveLength(2);

      act(() => vi.advanceTimersByTime(2000));
      expect(screen.queryByTestId('battle-damage-number')).not.toBeInTheDocument();

      fireEvent.click(screen.getByTestId('end-ten-day-button'));
      expect(screen.queryByTestId('battle-damage-number')).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not show old damage numbers again after recruiting troops', () => {
    vi.useFakeTimers();
    const state = createGame('liu', 1);
    state.battleDamageReports = [{
      id: 'old-damage',
      unitId: 'old-target',
      q: 10,
      r: 10,
      amount: 900,
      kind: 'attack',
    }];

    try {
      renderState(state);

      expect(screen.getByTestId('battle-damage-number')).toHaveTextContent('-900');
      act(() => vi.advanceTimersByTime(2000));
      expect(screen.queryByTestId('battle-damage-number')).not.toBeInTheDocument();

      const jianglingMarker = screen.getAllByTestId('city-marker').find((marker) => marker.textContent?.includes(state.cities.jiangling.name));
      expect(jianglingMarker).toBeTruthy();
      fireEvent.click(jianglingMarker!);
      fireEvent.click(screen.getByTestId('city-command-section-urban'));
      fireEvent.click(screen.getByTestId('city-command-command-recruit'));
      fireEvent.submit(screen.getByRole('dialog'));

      expect(screen.queryByTestId('battle-damage-number')).not.toBeInTheDocument();
      expect(screen.getByTestId('city-effect-number')).toBeVisible();
    } finally {
      vi.useRealTimers();
    }
  });

  it('closes the unit command menu and suppresses the browser menu when right clicking on it', () => {
    const deployed = deployUnit(createGame('liu', 1), 'liu', {
      cityId: 'jiangling',
      officerId: 'guan-yu',
      troops: 4000,
      food: 6000,
    });
    renderState(settleTenDay(deployed));

    const unitMarker = screen.getByTestId('battle-unit-marker');
    fireEvent.pointerDown(unitMarker, { button: 0, buttons: 1, clientX: 240, clientY: 180 });
    fireEvent.pointerDown(unitMarker, { button: 0, buttons: 1, clientX: 240, clientY: 180 });
    const menu = screen.getByTestId('unit-command-menu');

    const defaultWasAllowed = fireEvent.contextMenu(menu);

    expect(defaultWasAllowed).toBe(false);
    expect(screen.queryByTestId('unit-command-menu')).not.toBeInTheDocument();
  });

  it('opens unit intel actions from a unit right click and shows detailed unit information', async () => {
    const user = userEvent.setup();
    const deployed = deployUnit(createGame('liu', 1), 'liu', {
      cityId: 'jiangling',
      officerIds: ['guan-yu', 'liu-bei', 'jian-yong'],
      troopType: 'spear',
      troops: 3600,
      food: 6100,
    });
    const unit = Object.values(deployed.units)[0];
    renderState(deployed);

    const defaultWasAllowed = fireEvent.contextMenu(screen.getByTestId('battle-unit-marker'), { clientX: 260, clientY: 190 });

    expect(defaultWasAllowed).toBe(false);
    const intelMenu = screen.getByTestId('unit-intel-context-menu');
    expect(within(intelMenu).getByTestId('unit-detail-button')).toBeVisible();
    expect(within(intelMenu).getByTestId('unit-officers-button')).toBeVisible();
    expect(screen.queryByTestId('unit-command-menu')).not.toBeInTheDocument();

    await user.click(within(intelMenu).getByTestId('unit-detail-button'));

    const dialog = screen.getByTestId('unit-detail-dialog');
    expect(dialog).toHaveTextContent(deployed.officers['guan-yu'].name);
    expect(dialog).toHaveTextContent(deployed.officers['liu-bei'].name);
    expect(dialog).toHaveTextContent(deployed.forces[unit.forceId].name);
    expect(dialog).toHaveTextContent(unit.troops.toLocaleString('en-US'));
    expect(dialog).toHaveTextContent(unit.food.toLocaleString('en-US'));
    expect(dialog).toHaveTextContent(String(unit.energy));
    expect(dialog).toHaveTextContent(String(unit.movementRemaining));
    expect(screen.queryByTestId('unit-intel-context-menu')).not.toBeInTheDocument();
  });

  it('closes the unit right-click intel menu when left clicking another friendly unit', () => {
    let state = deployUnit(createGame('liu', 1), 'liu', {
      cityId: 'jiangling',
      officerId: 'guan-yu',
      troopType: 'spear',
      troops: 3600,
      food: 6100,
    });
    state = deployUnit(state, 'liu', {
      cityId: 'wuling',
      officerId: 'zhang-fei',
      troopType: 'sword',
      troops: 3200,
      food: 5000,
    });
    state = settleTenDay(state);
    const units = Object.values(state.units);
    state.units[units[0].id].q = 10;
    state.units[units[0].id].r = 10;
    state.units[units[1].id].q = 11;
    state.units[units[1].id].r = 10;
    renderState(state);

    const markers = screen.getAllByTestId('battle-unit-marker');
    fireEvent.contextMenu(markers[0], { clientX: 260, clientY: 190 });

    expect(screen.getByTestId('unit-intel-context-menu')).toBeVisible();

    fireEvent.pointerDown(markers[1], { button: 0, buttons: 1, clientX: 300, clientY: 190 });

    expect(screen.queryByTestId('unit-intel-context-menu')).not.toBeInTheDocument();
  });

  it('opens the selected unit officer list from a unit right click', async () => {
    const user = userEvent.setup();
    const deployed = deployUnit(createGame('liu', 1), 'liu', {
      cityId: 'jiangling',
      officerIds: ['guan-yu', 'liu-bei', 'jian-yong'],
      troopType: 'spear',
      troops: 3600,
      food: 6100,
    });
    renderState(deployed);

    fireEvent.contextMenu(screen.getByTestId('battle-unit-marker'), { clientX: 260, clientY: 190 });
    await user.click(within(screen.getByTestId('unit-intel-context-menu')).getByTestId('unit-officers-button'));

    const dialog = screen.getByTestId('unit-officer-list-dialog');
    expect(officerNamesIn(dialog)).toEqual(['guan-yu', 'liu-bei', 'jian-yong'].map((id) => deployed.officers[id].name));
    expect(within(dialog).queryByRole('rowheader', { name: deployed.officers['zhang-fei'].name })).not.toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: '能力' })).toHaveClass('is-active');
  });
});

describe('final settlement', () => {
  it('shows rankings and restart controls after month 24', () => {
    const state = createGame('liu', 5);
    state.month = 24;
    state.phase = 'finished';
    renderState(state);

    expect(screen.getByRole('heading', { name: '荆襄国力结算' })).toBeVisible();
    expect(screen.getAllByRole('row')).toHaveLength(5);
    expect(screen.getByRole('button', { name: '重新开局' })).toBeEnabled();
    expect(screen.getByRole('button', { name: '查看最终地图' })).toBeEnabled();
  });

  it('can return from the final map to the settlement', async () => {
    const user = userEvent.setup();
    const state = createGame('liu', 5);
    state.month = 24;
    state.phase = 'finished';
    renderState(state);

    await user.click(screen.getByRole('button', { name: '查看最终地图' }));
    expect(screen.getByRole('button', { name: '返回结算' })).toBeVisible();
    expect(screen.queryByRole('button', { name: '巡察' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '返回结算' }));
    expect(screen.getByRole('heading', { name: '荆襄国力结算' })).toBeVisible();
  });

  it('labels every row in a multi-way tied settlement', () => {
    const state = createGame('liu', 5);
    state.month = 24;
    state.phase = 'finished';
    for (const city of Object.values(state.cities)) {
      Object.assign(city, { gold: 5000, food: 20000, population: 90000, troops: 10000, commerce: 50, agriculture: 50, order: 80, training: 70 });
    }
    for (const officer of Object.values(state.officers)) {
      if (officer.forceId) Object.assign(officer.stats, { leadership: 70, war: 70, intelligence: 70, politics: 70, charisma: 70 });
    }

    renderState(state);

    expect(screen.getAllByText('并列 1')).toHaveLength(4);
    expect(screen.getByText(/最终并列第/)).toBeVisible();
  });
});
