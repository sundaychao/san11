import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
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

  it('shows live validation instead of executing an invalid transfer', async () => {
    const user = userEvent.setup();
    renderState();

    await user.click(screen.getByRole('button', { name: '调动' }));
    const dialog = screen.getByRole('dialog', { name: '调动' });
    await user.type(within(dialog).getByLabelText('调动资金'), '999999');

    expect(within(dialog).getByText(/资金不足/)).toBeVisible();
    expect(within(dialog).getByRole('button', { name: '执行调动' })).toBeDisabled();
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
});
