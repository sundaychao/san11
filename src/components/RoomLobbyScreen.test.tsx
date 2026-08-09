import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RoomLobbyScreen } from './RoomLobbyScreen';

type GameContextTestValue = Record<string, any>;

const gameValue = vi.hoisted(() => ({ current: null as GameContextTestValue | null }));

vi.mock('../game/store/GameProvider', () => ({
  useGame: () => {
    if (!gameValue.current) throw new Error('missing game value');
    return gameValue.current;
  },
}));

describe('RoomLobbyScreen', () => {
  beforeEach(() => {
    gameValue.current = {
      auth: { token: 'token', userId: 'host', username: 'Host', loading: false, error: null },
      online: {
        mode: 'online',
        connecting: false,
        connected: true,
        serverUrl: 'http://server.test',
        roomId: 'ABCD',
        phase: 'lobby',
        hostPlayerId: 'host',
        playerId: 'host',
        revision: 2,
        players: [
          { id: 'host', name: 'Host', forceId: 'liu', connected: true },
          { id: 'guest', name: 'Guest', forceId: null, connected: true },
        ],
        turnPlayerIds: [],
        activePlayerId: null,
        completedTurnPlayerIds: [],
        tenDayReadyForceIds: [],
        error: null,
      },
      disconnectOnline: vi.fn(),
      selectOnlineForce: vi.fn().mockResolvedValue(undefined),
      startOnlineGame: vi.fn().mockResolvedValue(undefined),
    };
  });

  it('shows room members and lets the player choose an unoccupied force', async () => {
    const user = userEvent.setup();
    render(<RoomLobbyScreen />);

    expect(screen.getByRole('heading', { name: '房间 ABCD' })).toBeVisible();
    expect(screen.getByText('Host')).toBeVisible();
    expect(screen.getByText('Guest')).toBeVisible();
    expect(screen.getByRole('button', { name: '刘备 已选择' })).toBeDisabled();

    await user.click(screen.getByRole('button', { name: '曹操' }));

    expect(gameValue.current?.selectOnlineForce).toHaveBeenCalledWith('cao');
  });

  it('enables start only for the host after all players choose forces', async () => {
    const user = userEvent.setup();
    gameValue.current!.online.players[1] = { id: 'guest', name: 'Guest', forceId: 'cao', connected: true };
    render(<RoomLobbyScreen />);

    await user.click(screen.getByRole('button', { name: '开始游戏' }));

    expect(gameValue.current?.startOnlineGame).toHaveBeenCalledTimes(1);
    const guestRow = screen.getByText('Guest').closest('li');
    expect(guestRow).toBeTruthy();
    expect(within(guestRow!).getByText('曹操')).toBeVisible();
  });
});
