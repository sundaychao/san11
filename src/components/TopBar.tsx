import { LogOut } from 'lucide-react';
import { useGame } from '../game/store/GameProvider';

const MONTH_NAMES = ['四月', '五月', '六月', '七月', '八月', '九月', '十月', '冬月', '腊月', '正月', '二月', '三月'];
const TEN_DAY_LABELS = { 1: '上旬', 2: '中旬', 3: '下旬' } as const;

/**
 * 顶部信息条：只保留日期/旬/势力/行动力/技巧P 等信息展示。
 * 武将一览、存档、结束本旬、进行下月等操作改由地图右键菜单承载，这里不再重复放置按钮。
 */
export function TopBar() {
  const { state, disconnectOnline, online } = useGame();
  if (!state) return null;
  const force = state.forces[state.playerForceId];
  const year = 13 + Math.floor((state.month + 2) / 12);
  const monthName = MONTH_NAMES[(state.month - 1) % 12];
  const isOnline = online.mode === 'online';
  const activePlayer = isOnline ? online.players.find((player) => player.id === online.activePlayerId) : undefined;
  const isMyOnlineTurn = !isOnline || !online.activePlayerId || online.activePlayerId === online.playerId;

  return (
    <header className="top-bar">
      <div className="imperial-seal" aria-hidden="true">汉</div>
      <div className="date-block"><span>建安{year}年</span><strong>{monthName}</strong></div>
      <div className="top-metric"><span>旬</span><strong data-testid="ten-day-label">{TEN_DAY_LABELS[state.tenDay]}</strong></div>
      <div className="top-metric"><span>势力</span><strong className="top-force-name" style={{ color: force.color }}>{force.name}</strong></div>
      <div className="top-metric"><span>行动力</span><strong data-testid="action-points">{state.actionPoints[state.playerForceId]}</strong></div>
      <div className="top-metric"><span>技巧P</span><strong data-testid="tech-points">{(force.techP ?? 0).toLocaleString('en-US')}</strong></div>
      {isOnline && (
        <div className="top-metric online-top-status">
          <span>{online.connected ? '联网' : '断线'}</span>
          <strong>{online.roomId} · <span data-testid="online-active-player">{activePlayer?.name ?? '等待'}</span></strong>
        </div>
      )}
      {isOnline && (
        <div className={`turn-prompt ${isMyOnlineTurn ? 'is-active' : 'is-waiting'}`} role="status">
          {isMyOnlineTurn ? '请你操作行动' : '等其他玩家操作中'}
        </div>
      )}
      {isOnline && (
        <div className="top-actions">
          <button className="next-month" type="button" onClick={disconnectOnline}><LogOut aria-hidden="true" />退出房间</button>
        </div>
      )}
    </header>
  );
}
