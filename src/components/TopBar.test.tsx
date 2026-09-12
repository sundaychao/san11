import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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
    };
  });

  it('shows the active player prompt on the local online turn', () => {
    render(<TopBar />);

    expect(screen.getByRole('status')).toHaveTextContent('请你操作行动');
    expect(screen.getByRole('status')).toHaveClass('is-active');
    expect(screen.getByTestId('online-active-player')).toHaveTextContent('Host');
  });

  it('shows the waiting prompt outside the local online turn', () => {
    gameValue.current!.state.turnForceId = 'cao';
    gameValue.current!.online = onlineState('guest');

    render(<TopBar />);

    expect(screen.getByRole('status')).toHaveTextContent('等其他玩家操作中');
    expect(screen.getByRole('status')).toHaveClass('is-waiting');
    expect(screen.getByTestId('online-active-player')).toHaveTextContent('Guest');
  });

  it('不再渲染武将/存档/结束本旬/进行下月按钮（改由地图右键菜单承载）', () => {
    render(<TopBar />);

    for (const testId of ['open-officer-list-button', 'end-ten-day-button', 'end-month-button']) {
      expect(screen.queryByTestId(testId)).not.toBeInTheDocument();
    }
    expect(screen.queryByRole('button', { name: '存档' })).not.toBeInTheDocument();
  });

  it('右上角「查看特技」按钮打开特技一览面板并展示名称与说明', async () => {
    const user = userEvent.setup();
    render(<TopBar />);

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await user.click(screen.getByTestId('open-skill-catalog-button'));

    const dialog = screen.getByRole('dialog', { name: '特技一览' });
    expect(dialog).toBeInTheDocument();
    expect(screen.getByTestId('skill-catalog-item-飞将')).toHaveTextContent('陆地移动忽略敌方ZOC');
    expect(screen.getByTestId('skill-catalog-item-飞将')).toHaveTextContent('已启用');
    expect(screen.getByTestId('skill-catalog-item-辅佐')).toHaveTextContent('未启用');
    expect(screen.getByTestId('skill-catalog-item-猛者')).toHaveTextContent('待依赖');

    await user.click(screen.getByRole('button', { name: '关闭' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
