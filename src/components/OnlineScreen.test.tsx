import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { OnlineScreen } from './OnlineScreen';

type GameContextTestValue = Record<string, any>;

const gameValue = vi.hoisted(() => ({ current: null as GameContextTestValue | null }));

vi.mock('../game/store/GameProvider', () => ({
  useGame: () => {
    if (!gameValue.current) throw new Error('missing game value');
    return gameValue.current;
  },
}));

describe('OnlineScreen online rooms', () => {
  beforeEach(() => {
    gameValue.current = {
      auth: { token: 'token', userId: 'user', username: 'Player', loading: false, error: null },
      online: {
        mode: 'online',
        connecting: false,
        resumingRoom: false,
        connected: true,
        serverUrl: 'http://server.test',
        roomId: null,
        phase: null,
        hostPlayerId: null,
        playerId: null,
        revision: 0,
        players: [],
        turnPlayerIds: [],
        activePlayerId: null,
        completedTurnPlayerIds: [],
        rooms: [{
          id: 'ABCD',
          hostName: 'Host',
          playerCount: 1,
          maxPlayers: 4,
          selectedForceIds: ['liu'],
          map: 'homeland',
        }],
        tenDayReadyForceIds: [],
        error: null,
      },
      clearError: vi.fn(),
      clearSave: vi.fn(),
      createOnlineRoom: vi.fn().mockResolvedValue(undefined),
      hasAutosave: false,
      hasManualSave: false,
      invalidSaves: [],
      joinOnlineRoom: vi.fn().mockResolvedValue(undefined),
      loadGame: vi.fn(),
      loadOnlineRooms: vi.fn().mockResolvedValue(undefined),
      logoutAccount: vi.fn(),
      resumeOnlineRoom: vi.fn().mockResolvedValue(undefined),
      startGame: vi.fn(),
      error: null,
    };
  });

  it('shows lobby rooms and joins by clicking the room entry', async () => {
    const user = userEvent.setup();
    render(<OnlineScreen onBack={() => {}} />);

    expect(screen.getByText('ABCD')).toBeVisible();
    expect(screen.getByText('Host · 大地图')).toBeVisible();
    expect(screen.getByText('1/4')).toBeVisible();

    await user.click(screen.getByRole('button', { name: '进入 ABCD' }));

    expect(gameValue.current?.joinOnlineRoom).toHaveBeenCalledWith({
      roomId: 'ABCD',
      serverUrl: 'http://server.test',
    });
  });

  it('loads the lobby rooms once after the authenticated online screen appears', async () => {
    render(<OnlineScreen onBack={() => {}} />);

    await waitFor(() => {
      expect(gameValue.current?.loadOnlineRooms).toHaveBeenCalledWith({ serverUrl: 'http://server.test' });
    });
    expect(gameValue.current?.loadOnlineRooms).toHaveBeenCalledTimes(1);
  });

  it('does not auto-load the room list while the previous room is resuming', async () => {
    gameValue.current!.online.resumingRoom = true;

    render(<OnlineScreen onBack={() => {}} />);

    await waitFor(() => {
      expect(gameValue.current?.loadOnlineRooms).not.toHaveBeenCalled();
    });
  });

  it('creates a lobby room on the default (builtin) map', async () => {
    const user = userEvent.setup();
    render(<OnlineScreen onBack={() => {}} />);

    await user.click(screen.getByRole('button', { name: /创建新房间/ }));

    expect(gameValue.current?.createOnlineRoom).toHaveBeenCalledWith({ serverUrl: 'http://server.test', map: 'china42x' });
  });

  it('lets the host pick a specific map from the available list', async () => {
    const user = userEvent.setup();
    render(<OnlineScreen onBack={() => {}} />);

    await user.click(screen.getByRole('radio', { name: /荆襄地图/ }));
    await user.click(screen.getByRole('button', { name: /创建新房间/ }));

    expect(gameValue.current?.createOnlineRoom).toHaveBeenCalledWith({ serverUrl: 'http://server.test', map: 'china42x' });
  });

  it('keeps creating a room available while the lobby connection is refreshing', async () => {
    const user = userEvent.setup();
    gameValue.current!.online.connecting = true;
    render(<OnlineScreen onBack={() => {}} />);

    const createButton = screen.getByRole('button', { name: /创建新房间/ });
    expect(createButton).toBeEnabled();

    await user.click(createButton);
    expect(gameValue.current?.createOnlineRoom).toHaveBeenCalledWith({ serverUrl: 'http://server.test', map: 'china42x' });
  });

  it('refreshes the room list from the current server', async () => {
    const user = userEvent.setup();
    render(<OnlineScreen onBack={() => {}} />);

    await user.click(screen.getByRole('button', { name: '刷新房间' }));

    expect(gameValue.current?.loadOnlineRooms).toHaveBeenCalledWith({ serverUrl: 'http://server.test' });
  });

  it('resumes the last playing room from the current server', async () => {
    const user = userEvent.setup();
    render(<OnlineScreen onBack={() => {}} />);

    await user.click(screen.getByRole('button', { name: '继续上次对战' }));

    expect(gameValue.current?.resumeOnlineRoom).toHaveBeenCalledWith({ serverUrl: 'http://server.test' });
  });
});