import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createGame } from '../game/scenario/jingxiang208';
import { TopBar } from './TopBar';

type GameContextTestValue = Record<string, any>;

const gameValue = vi.hoisted(() => ({ current: null as GameContextTestValue | null }));

vi.mock('../game/store/GameProvider', () => ({
  useGame: () => {
    if (!gameValue.current) throw new Error('missing game value');
    return gameValue.current;
  },
}));

function onlineState(activePlayerId: string) {
  return {
    mode: 'online',
    connecting: false,
    connected: true,
    serverUrl: 'http://server.test',
    roomId: 'ABCD',
    phase: 'playing',
    hostPlayerId: 'host',
    playerId: 'host',
    revision: 3,
    players: [
      { id: 'host', name: 'Host', forceId: 'liu', connected: true },
      { id: 'guest', name: 'Guest', forceId: 'cao', connected: true },
    ],
    turnPlayerIds: ['host', 'guest'],
    activePlayerId,
    completedTurnPlayerIds: [],
    rooms: [],
    tenDayReadyForceIds: [],
    error: null,
  };
}

describe('TopBar online turn prompts', () => {
  beforeEach(() => {
    gameValue.current = {
      state: createGame('liu', 1),
      online: onlineState('host'),
      disconnectOnline: vi.fn(),
      endMonth: vi.fn(),
      endTenDay: vi.fn(),
      manualSave: vi.fn(),
    };
  });

  it('shows the active player prompt and keeps proceed enabled on the local online turn', () => {
    render(<TopBar />);

    expect(screen.getByRole('status')).toHaveTextContent('请你操作行动');
    expect(screen.getByRole('status')).toHaveClass('is-active');
    expect(screen.getByTestId('online-active-player')).toHaveTextContent('Host');
    expect(screen.getByTestId('end-ten-day-button')).toBeEnabled();
  });

  it('shows the waiting prompt and disables proceed outside the local online turn', () => {
    gameValue.current!.state.turnForceId = 'cao';
    gameValue.current!.online = onlineState('guest');

    render(<TopBar />);

    expect(screen.getByRole('status')).toHaveTextContent('等其他玩家操作中');
    expect(screen.getByRole('status')).toHaveClass('is-waiting');
    expect(screen.getByTestId('online-active-player')).toHaveTextContent('Guest');
    expect(screen.getByTestId('end-ten-day-button')).toBeDisabled();
  });
});
