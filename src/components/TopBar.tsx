import { useState } from 'react';
import { LogOut } from 'lucide-react';
import { useGame } from '../game/store/GameProvider';
import { calendarDateLabel, calendarYear, seasonLabel } from '../game/calendar';
import { GameRulesDialog } from './GameRulesDialog';
import { SkillCatalogDialog } from './SkillCatalogDialog';

/**
 * 顶部信息条：只保留日期/势力/行动力/技巧P 等信息展示。
 * 日期统一显示成「6月1号」这类月号 + 日号（不再出现上/中/下旬），最左侧方印显示当前季节。
 * 武将一览、存档、结束本旬、进行下月等操作改由地图右键菜单承载，这里不再重复放置按钮。
 * 右上角的「游戏规则」「查看特技」为临时面板入口，仅用于开发期查阅。
 */
export function TopBar() {
  const { state, disconnectOnline, online } = useGame();
  const [showSkillCatalog, setShowSkillCatalog] = useState(false);
  const [showGameRules, setShowGameRules] = useState(false);
  if (!state) return null;
  const force = state.forces[state.playerForceId];
  const year = calendarYear(state.month);
  const dateLabel = calendarDateLabel(state.month, state.tenDay);
  const season = seasonLabel(state.month);
  const isOnline = online.mode === 'online';
  const activePlayer = isOnline ? online.players.find((player) => player.id === online.activePlayerId) : undefined;
  const isMyOnlineTurn = !isOnline || !online.activePlayerId || online.activePlayerId === online.playerId;

  return (
    <>
      <header className="top-bar">
        <div className="imperial-seal" data-testid="season-seal" data-season={season} title={`季节：${season}`} aria-label={`季节：${season}`}>{season}</div>
        <div className="date-block"><span>建安{year}年</span><strong data-testid="ten-day-label">{dateLabel}</strong></div>
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
        <div className="top-actions">
          <button
            className="skill-catalog-trigger"
            type="button"
            data-testid="open-game-rules-button"
            onClick={() => setShowGameRules(true)}
          >
            游戏规则
          </button>
          <button
            className="skill-catalog-trigger"
            type="button"
            data-testid="open-skill-catalog-button"
            onClick={() => setShowSkillCatalog(true)}
          >
            查看特技
          </button>
          {isOnline && (
            <button className="next-month" type="button" onClick={disconnectOnline}><LogOut aria-hidden="true" />退出房间</button>
          )}
        </div>
      </header>
      {showSkillCatalog && <SkillCatalogDialog onClose={() => setShowSkillCatalog(false)} />}
      {showGameRules && <GameRulesDialog onClose={() => setShowGameRules(false)} />}
    </>
  );
}
