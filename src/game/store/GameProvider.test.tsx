import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { AUTO_SAVE_KEY, MANUAL_SAVE_KEY, type SaveAdapter } from '../persistence';
import { GameProvider, useGame } from './GameProvider';

class MemoryStorage implements SaveAdapter {
  readonly values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
  removeItem(key: string) { this.values.delete(key); }
}

function Probe() {
  const game = useGame();
  return (
    <div>
      <output aria-label="month">{game.state?.month ?? 0}</output>
      <output aria-label="logs">{game.state?.logs.length ?? 0}</output>
      <button onClick={() => game.startGame('liu', 1)}>start</button>
      <button onClick={() => game.issueCommand({ type: 'patrol', cityId: 'jiangling', officerId: 'liu-bei' })}>patrol</button>
      <button onClick={() => game.endMonth()}>end</button>
      <button onClick={() => game.manualSave()}>save</button>
      <button onClick={() => game.resetGame()}>reset</button>
    </div>
  );
}

describe('GameProvider', () => {
  it('runs commands, AI, settlement, and autosave', async () => {
    const user = userEvent.setup();
    const storage = new MemoryStorage();
    render(<GameProvider storage={storage}><Probe /></GameProvider>);

    await user.click(screen.getByRole('button', { name: 'start' }));
    await user.click(screen.getByRole('button', { name: 'patrol' }));
    await user.click(screen.getByRole('button', { name: 'end' }));

    expect(screen.getByLabelText('month')).toHaveTextContent('2');
    expect(Number(screen.getByLabelText('logs').textContent)).toBeGreaterThan(3);
    expect(storage.getItem(AUTO_SAVE_KEY)).not.toBeNull();
  });

  it('writes manual save and resets both slots', async () => {
    const user = userEvent.setup();
    const storage = new MemoryStorage();
    render(<GameProvider storage={storage}><Probe /></GameProvider>);

    await user.click(screen.getByRole('button', { name: 'start' }));
    await user.click(screen.getByRole('button', { name: 'save' }));
    expect(storage.getItem(MANUAL_SAVE_KEY)).not.toBeNull();

    await user.click(screen.getByRole('button', { name: 'reset' }));
    expect(storage.getItem(AUTO_SAVE_KEY)).toBeNull();
    expect(storage.getItem(MANUAL_SAVE_KEY)).toBeNull();
    expect(screen.getByLabelText('month')).toHaveTextContent('0');
  });
});
