import { beforeEach, describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from '../app/App';
import { createGame } from '../game/scenario/jingxiang208';
import { writeSave } from '../game/persistence';

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
});
