import { useMemo, useState } from 'react';
import { useGame } from '../game/store/GameProvider';
import type { GameLog } from '../game/types';

/** 页签：我方势力军情 / 其他势力军情 */
type LogScope = 'own' | 'others';

/** 列表只保留最近这么多条，两个页签各自截取，避免长时间游戏后 DOM 膨胀 */
const LOG_WINDOW = 100;

/**
 * 左下角信息栏：军情与政务。
 *
 * 按势力归属分成两个页签：
 * - 「我方」（默认）：本方势力的全部记录，外加 `forceId === null` 的全局通告
 *   （换月、开局、最终结算等）。这类通告不属于任何势力，但玩家必须看到，
 *   所以归入默认页签，保证时间线不断档；
 * - 「他方」：其他所有势力的记录。
 *
 * 每条记录只会出现在其中一个页签里，不会重复。
 */
export function EventLog() {
  const { state } = useGame();
  const [scope, setScope] = useState<LogScope>('own');

  const playerForceId = state?.playerForceId;

  const grouped = useMemo(() => {
    const own: GameLog[] = [];
    const others: GameLog[] = [];
    if (!state) return { own, others };
    const recent = state.logs.slice(-LOG_WINDOW).reverse();
    for (const log of recent) {
      if (log.forceId == null || log.forceId === playerForceId) own.push(log);
      else others.push(log);
    }
    return { own, others };
  }, [state, playerForceId]);

  if (!state) return null;

  const logs = scope === 'own' ? grouped.own : grouped.others;

  return (
    <section className="event-log tool-panel" aria-label="军情与政务">
      <header className="event-log-header">
        <h2>军情与政务</h2>
        <nav className="event-log-tabs" aria-label="军情与政务分类">
          <button
            type="button"
            className={scope === 'own' ? 'is-active' : undefined}
            data-testid="event-log-tab-own"
            aria-pressed={scope === 'own'}
            onClick={() => setScope('own')}
          >
            我方
          </button>
          <button
            type="button"
            className={scope === 'others' ? 'is-active' : undefined}
            data-testid="event-log-tab-others"
            aria-pressed={scope === 'others'}
            onClick={() => setScope('others')}
          >
            他方
          </button>
        </nav>
      </header>
      <ol data-testid="event-log-list">
        {logs.map((log) => (
          <li key={log.id}>
            <i style={{ backgroundColor: log.forceId ? state.forces[log.forceId].color : '#c5ad6f' }} aria-hidden="true" />
            <span>{log.message}</span>
          </li>
        ))}
        {logs.length === 0 && (
          <li className="event-log-blank">
            {scope === 'own' ? '暂无我方军情' : '暂无其他势力的军情'}
          </li>
        )}
      </ol>
    </section>
  );
}
