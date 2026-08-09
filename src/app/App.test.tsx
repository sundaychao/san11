import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { App } from './App';

describe('App', () => {
  it('opens on the standalone auth screen before the game start screen', () => {
    render(<App />);

    expect(screen.getByRole('heading', { name: '账号登录' })).toBeVisible();
    expect(screen.getByRole('button', { name: '登录' })).toBeEnabled();
    expect(screen.getByRole('tab', { name: '注册' })).toBeEnabled();
    expect(screen.queryByRole('heading', { name: '建安十三年：荆襄争夺' })).not.toBeInTheDocument();
  });

  it('keeps the online battle actions off the auth screen', () => {
    render(<App />);

    expect(screen.queryByRole('button', { name: '创建房间' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '加入房间' })).not.toBeInTheDocument();
  });
});
