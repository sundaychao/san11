import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it } from 'vitest';
import { useState } from 'react';
import { createGame } from '../game/scenario/jingxiang208';
import { GameProvider } from '../game/store/GameProvider';
import { OfficerListDialog } from './OfficerListDialog';

function Host() {
  const [open, setOpen] = useState(true);
  return open ? <OfficerListDialog onClose={() => setOpen(false)} /> : null;
}

function mount() {
  return render(
    <GameProvider initialState={createGame('liu', 3)}>
      <Host />
    </GameProvider>,
  );
}

it('探针A：render 后直接 cleanup，弹窗应被移除', () => {
  mount();
  expect(screen.getByRole('dialog', { name: '武将一览' })).toBeVisible();
  cleanup();
  expect(screen.queryByRole('dialog', { name: '武将一览' })).toBeNull();
});

it('探针B：点击三个 tab 后 cleanup，弹窗应被移除', async () => {
  const user = userEvent.setup();
  mount();
  const dialog = screen.getByRole('dialog', { name: '武将一览' });
  await user.click(screen.getAllByRole('button', { name: '能力' })[0]!);
  await user.click(screen.getAllByRole('button', { name: '特技' })[0]!);
  await user.click(screen.getAllByRole('button', { name: '适性' })[0]!);
  expect(dialog).toBeVisible();
  cleanup();
  expect(screen.queryByRole('dialog', { name: '武将一览' })).toBeNull();
});
