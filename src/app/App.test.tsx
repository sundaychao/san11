import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { App } from './App';

describe('App', () => {
  it('opens on the force selection screen', () => {
    render(<App />);

    expect(screen.getByRole('heading', { name: '建安十三年：荆襄争夺' })).toBeVisible();
    expect(screen.getByRole('button', { name: '选择刘备' })).toBeEnabled();
  });
});
