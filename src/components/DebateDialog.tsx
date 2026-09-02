import { RefreshCw, X } from 'lucide-react';
import { useEffect, useMemo, useRef } from 'react';
import {
  cardLabel,
  DEBATE_MAX_HP,
  DEBATE_MAX_RAGE,
  RAGE_KIND_LABELS_ZH,
  SIZE_LABELS_ZH,
  TOPIC_LABELS_ZH,
  type DebateCard,
  type DebateSession,
  type RageKind,
} from '../game/debate';
import type { Officer } from '../game/types';
import { useGame } from '../game/store/GameProvider';

interface DebateDialogProps {
  onClose(): void;
}

/** 卡牌提示文案 */
function cardHint(card: DebateCard): string {
  if (card.kind === 'topic') {
    return `话题卡・${TOPIC_LABELS_ZH[card.topic]}${SIZE_LABELS_ZH[card.size]}`;
  }
  const hint: Record<string, string> = {
    ignore: '本次不受对方伤害',
    shout: '大喝，造成较高伤害',
    sophistry: '诡辩，话题落败时反弹伤害',
    calm: '镇静，降低对方怒气并解除激愤',
    provoke: '逆上，快速积攒自身怒气',
  };
  return hint[card.skill] ?? '';
}

/** 心理值（HP）与怒气条 */
function gauges(hp: number, rage: number, rageMode: number, rageKind: RageKind | null) {
  return (
    <div className="debate-gauges">
      <div className="debate-gauge-row">
        <span className="debate-gauge-label">心理</span>
        <span className="debate-gauge-bar" aria-hidden="true">
          <span className="debate-gauge-fill is-hp" style={{ width: `${Math.min(100, (hp / DEBATE_MAX_HP) * 100)}%` }} />
        </span>
        <em>{hp}</em>
      </div>
      <div className="debate-gauge-row">
        <span className="debate-gauge-label">怒气</span>
        <span className="debate-gauge-bar" aria-hidden="true">
          <span className="debate-gauge-fill is-rage" style={{ width: `${Math.min(100, (rage / DEBATE_MAX_RAGE) * 100)}%` }} />
        </span>
        <em>{rage}</em>
      </div>
      {rageMode > 0 && rageKind && (
        <span className="debate-rage-mode">{RAGE_KIND_LABELS_ZH[rageKind]}激愤中</span>
      )}
    </div>
  );
}

function participantBlock(officer: Officer | undefined, hp: number, rage: number, rageMode: number, rageKind: RageKind | null, align: 'left' | 'right', handSize: number) {
  if (!officer) return null;
  return (
    <div className={`debate-participant is-${align}`}>
      <strong className="debate-participant-name">{officer.name}</strong>
      <span className="debate-participant-sub">
        智力 {officer.stats.intelligence}・手牌 {handSize}
      </span>
      {gauges(hp, rage, rageMode, rageKind)}
    </div>
  );
}

export function DebateDialog({ onClose }: DebateDialogProps) {
  const { state, debateRound, debateRethink, dismissDebate } = useGame();
  const logRef = useRef<HTMLOListElement>(null);

  const session = useMemo<DebateSession | null>(
    () => (state?.debateSession ?? null),
    [state],
  );

  const recruiter = session ? state?.officers[session.recruiterId] : undefined;
  const target = session ? state?.officers[session.targetId] : undefined;

  const ongoing = session?.status === 'ongoing';
  const finished = session?.status === 'finished';
  const canRethink = ongoing && !!session && !session.recruiterRethinkUsed && session.recruiterHand.length > 0;

  // 新回合日志自动滚动到底部
  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [session?.logs.length]);

  if (!session || !recruiter || !target || !state) return null;

  const close = () => {
    // 进行中不可关闭（关闭请求将被 reducer 忽略）；结束后由 dismissDebate 清空会话
    dismissDebate();
    if (session.status === 'finished') onClose();
  };

  const outcomeText = (() => {
    if (!finished) return null;
    if (session.winner === 'recruiter') {
      return `${recruiter.name}舌战告捷，说服${target.name}加入我方！`;
    }
    if (session.winner === 'target') {
      return `${recruiter.name}舌战受挫，${target.name}婉拒了招揽`;
    }
    return '双方难分胜负，登用宣告失败';
  })();

  const reversedLogs = [...session.logs].reverse();

  return (
    <div className="modal-backdrop" aria-label="舌战" onMouseDown={(event) => event.target === event.currentTarget && close()}>
      <section className="debate-dialog tool-panel" data-testid="debate-dialog" aria-label="舌战">
        <header className="dialog-title-bar">
          <strong>舌战 · {recruiter.name} VS {target.name}</strong>
          <button type="button" className="dialog-close-button" disabled={ongoing} onClick={close} aria-label="关闭">
            <X aria-hidden="true" />
          </button>
        </header>

        {/* 当前话题 */}
        <div className="debate-topic" data-testid="debate-topic">
          <span>当前话题</span>
          <b>{TOPIC_LABELS_ZH[session.topic]}</b>
          {ongoing && <em>{session.recruiterFirst ? `由${recruiter.name}先出言` : `由${target.name}先出言`}</em>}
        </div>

        {/* 双方状态 */}
        <div className="debate-arena">
          {participantBlock(recruiter, session.recruiterHp, session.recruiterRage, session.recruiterRageMode, session.recruiterRageKind, 'left', session.recruiterHand.length)}
          <span className="debate-vs" aria-hidden="true">VS</span>
          {participantBlock(target, session.targetHp, session.targetRage, session.targetRageMode, session.targetRageKind, 'right', session.targetHand.length)}
        </div>

        {/* 玩家出牌区 */}
        {ongoing && (
          <div className="debate-hand" data-testid="debate-hand">
            <p className="debate-hand-title">出牌招揽，胜过对方即可登用</p>
            <div className="debate-cards">
              {session.recruiterHand.map((card, index) => (
                <button
                  key={`${cardLabel(card)}-${index}`}
                  type="button"
                  className={`debate-card is-${card.kind}`}
                  data-testid={`debate-card-${index}`}
                  onClick={() => debateRound(index)}
                >
                  <b>{cardLabel(card)}</b>
                  <em>{cardHint(card)}</em>
                </button>
              ))}
            </div>
            <footer className="debate-actions">
              <button
                type="button"
                className="debate-rethink-button"
                disabled={!canRethink}
                onClick={() => debateRethink()}
              >
                <RefreshCw aria-hidden="true" />
                再考{canRethink ? '' : '（本回合已用）'}
              </button>
            </footer>
          </div>
        )}

        {/* 结算 */}
        {finished && (
          <div className="debate-outcome" data-testid="debate-outcome">
            <p>{outcomeText}</p>
            <button type="button" className="primary" data-testid="debate-finish-button" onClick={close}>
              确定
            </button>
          </div>
        )}

        {/* 战况日志 */}
        <div className="debate-log">
          <h4>舌战经过</h4>
          <ol ref={logRef} data-testid="debate-log">
            {reversedLogs.map((log, index) => (
              <li key={reversedLogs.length - index}>
                <span className="debate-log-round">第{log.round}合</span>
                <span className="debate-log-main">{log.narration}</span>
                {log.kind === 'rage' && log.rageSide && (
                  <span className={`debate-log-rage is-${log.rageSide}`}>激愤爆发</span>
                )}
              </li>
            ))}
            {session.logs.length === 0 && <li className="debate-log-empty">舌战尚未开始</li>}
          </ol>
        </div>
      </section>
    </div>
  );
}