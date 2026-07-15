import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { deployTransportUnit } from '../game/battle/actions';
import { executeCommand } from '../game/commands';
import { createGame } from '../game/scenario/jingxiang208';
import { GameProvider } from '../game/store/GameProvider';
import { GameShell } from './GameShell';

function renderState(state = createGame('liu', 3)) {
  return render(
    <GameProvider initialState={state}>
      <GameShell />
    </GameProvider>,
  );
}

describe('command interface', () => {
  it('confirms before ending a month with legal actions remaining', async () => {
    const user = userEvent.setup();
    renderState();

    await user.click(screen.getByRole('button', { name: '进行到下月' }));

    expect(screen.getByRole('dialog', { name: '结束本月' })).toBeVisible();
    await user.click(screen.getByRole('button', { name: '确认进行' }));
    expect(screen.queryByRole('dialog', { name: '结束本月' })).not.toBeInTheDocument();
    expect(screen.getByText('五月')).toBeVisible();
  });

  it('opens a categorized force officer list with ownership, stats, skills, aptitudes, and status', async () => {
    const user = userEvent.setup();
    renderState();

    await user.click(screen.getByRole('button', { name: '武将' }));

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
    expect(officerRow('刘备')).toHaveTextContent('仁德');

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

    await user.click(screen.getByRole('button', { name: '武将' }));

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
    await user.selectOptions(within(dialog).getByLabelText('兵种'), 'spear');
    await user.click(within(dialog).getByRole('button', { name: '确定出征' }));

    expect(screen.queryByRole('dialog', { name: '出征编制' })).not.toBeInTheDocument();
    expect(screen.queryByTestId('battle-unit-marker')).not.toBeInTheDocument();
    const deploymentCell = screen.getAllByTestId(/deploy-target-/)[0];
    fireEvent.pointerDown(deploymentCell, { button: 0, buttons: 1 });

    const unitMarker = screen.getByTestId('battle-unit-marker');
    expect(unitMarker).toBeVisible();
    expect(unitMarker).toHaveAttribute('data-troop-type', 'spear');
    expect(within(unitMarker).getByText('枪')).toBeVisible();
    expect(within(unitMarker).getByText('刘备')).toBeVisible();
    expect(within(unitMarker).getByText('4,000')).toBeVisible();
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

  it('shows movement range for a refreshed unit and moves it to a selected cell', async () => {
    const user = userEvent.setup();
    renderState();

    const jianglingMarker = screen.getAllByTestId('city-marker').find((marker) => marker.textContent?.includes('江陵'));
    expect(jianglingMarker).toBeTruthy();
    await user.click(jianglingMarker!);
    const menu = screen.getByTestId('city-command-menu');
    await user.click(within(menu).getByRole('button', { name: '军事' }));
    await user.click(within(menu).getByRole('button', { name: '出征' }));

    const dialog = screen.getByRole('dialog', { name: '出征编制' });
    await user.click(within(dialog).getByRole('button', { name: '确定出征' }));
    fireEvent.pointerDown(screen.getAllByTestId(/deploy-target-/)[0], { button: 0, buttons: 1 });

    await user.click(screen.getByTestId('end-ten-day-button'));
    const unitMarker = screen.getByTestId('battle-unit-marker');
    fireEvent.pointerDown(unitMarker, { button: 0, buttons: 1 });

    const moveTarget = screen.getAllByTestId(/move-target-/)[0];
    const [, q, r] = moveTarget.getAttribute('data-testid')!.match(/move-target-(\d+)-(\d+)/)!;
    fireEvent.pointerDown(moveTarget, { button: 0, buttons: 1 });

    expect(screen.queryByTestId(/move-target-/)).not.toBeInTheDocument();
    expect(screen.getByTestId('battle-unit-marker')).toHaveAttribute('data-grid-position', `${q},${r}`);
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
