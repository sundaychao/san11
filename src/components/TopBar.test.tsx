import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createGame } from '../game/scenario/jingxiang208';
import { calendarMonthNumber } from '../game/calendar';
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

describe('TopBar 日期与季节显示', () => {
  beforeEach(() => {
    gameValue.current = {
      state: createGame('liu', 1),
      online: { mode: 'local', players: [] },
      disconnectOnline: vi.fn(),
    };
  });

  it('日期显示「月号+日号」，不再出现上/中/下旬，最左侧方印显示季节', () => {
    render(<TopBar />);

    expect(screen.getByTestId('ten-day-label')).toHaveTextContent(/^4月1号$/);
    expect(screen.getByTestId('season-seal')).toHaveTextContent(/^夏$/);
    for (const label of ['上旬', '中旬', '下旬']) {
      expect(screen.queryByText(label)).not.toBeInTheDocument();
    }
  });

  it('季节与月号随月份变化：四月夏、七月秋、十月冬、正月春', () => {
    const state = gameValue.current!.state;
    const cases: [number, string][] = [[1, '夏'], [4, '秋'], [7, '冬'], [10, '春']];

    for (const [month, season] of cases) {
      state.month = month;
      state.tenDay = 2;
      const { unmount } = render(<TopBar />);

      expect(screen.getByTestId('season-seal')).toHaveTextContent(new RegExp(`^${season}$`));
      expect(screen.getByTestId('ten-day-label')).toHaveTextContent(new RegExp(`^${calendarMonthNumber(month)}月11号$`));

      unmount();
    }
  });
});

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

  it('「游戏规则」按钮打开左目录右内容面板，可切换规则项', async () => {
    const user = userEvent.setup();
    render(<TopBar />);

    await user.click(screen.getByTestId('open-game-rules-button'));
    const dialog = screen.getByRole('dialog', { name: '游戏规则' });
    expect(dialog).toBeInTheDocument();

    // 默认选中第一条：钱粮收入规则
    expect(screen.getByTestId('game-rule-content')).toHaveTextContent('城池月度资金收入');
    expect(screen.getByTestId('game-rule-tab-income')).toHaveAttribute('aria-current', 'true');
    expect(screen.getByTestId('game-rule-tab-damage')).not.toHaveAttribute('aria-current');

    // 切到伤害判定规则
    await user.click(screen.getByTestId('game-rule-tab-damage'));
    expect(screen.getByTestId('game-rule-content')).toHaveTextContent('完整公式');
    expect(screen.getByTestId('game-rule-content')).toHaveTextContent('逐项参数解释');
    expect(screen.getByTestId('game-rule-content')).toHaveTextContent('战线宽度');
    expect(screen.getByTestId('game-rule-tab-damage')).toHaveAttribute('aria-current', 'true');

    await user.click(screen.getByRole('button', { name: '返回' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
