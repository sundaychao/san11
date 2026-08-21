import { render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import type { GameState } from '../types';
import { useOnlineSession } from './onlineSession';

function storage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  };
}

function Harness() {
  const session = useOnlineSession({
    storage: storage(),
    applySnapshotState: vi.fn<(state: GameState | null) => void>(),
    setError: vi.fn(),
  });
  return <output data-testid="mode">{session.online.mode}</output>;
}

it('starts as a local session when no saved authentication exists', () => {
  render(<Harness />);
  expect(screen.getByTestId('mode')).toHaveTextContent('local');
});
