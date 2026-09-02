import { X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { DUEL_STANCE_LABELS, type DuelStance } from '../game/duel';
import { useGame } from '../game/store/GameProvider';
import { officerSkillsText } from '../game/skills';
import type { GridCoord } from '../game/battle/grid';
import type { ArmyUnit } from '../game/types';

interface DuelDialogProps {
  unitId: string;
  origin?: GridCoord;
  onClose(): void;
}

/** 与我军相邻的敌部队（单挑候选） */
function duelCandidates(state: { units: Record<string, ArmyUnit> }, attacker: ArmyUnit): ArmyUnit[] {
  return Object.values(state.units).filter((unit) => (
    unit.forceId !== attacker.forceId
    && Math.abs(unit.q - attacker.q) + Math.abs(unit.r - attacker.r) === 1
  ));
}

const STANCES: DuelStance[] = ['attack', 'defense', 'spirit', 'finisher'];

const STANCE_HINTS: Record<DuelStance, string> = {
  attack: '伤害+35%，受到伤害+15%',
  defense: '伤害大幅降低，受到的伤害减半',
  spirit: '斗志（怒气）积攒更快，攒满发动必杀',
  finisher: '低概率造成三倍伤害',
};

export function DuelDialog({ unitId, origin, onClose }: DuelDialogProps) {
  const { state, duelUnit } = useGame();
  const [stance, setStance] = useState<DuelStance>('attack');
  const [targetUnitId, setTargetUnitId] = useState<string>('');
  // 回放进度：-1=选择阶段，0..n=展示第 n+1 回合，-2=已播完结局
  const [playback, setPlayback] = useState(-1);
  const [done, setDone] = useState(false);

  const attacker = state?.units[unitId];
  const candidates = useMemo(() => (state && attacker ? duelCandidates(state, attacker) : []), [state, attacker]);
  const activeTargetId = targetUnitId || candidates[0]?.id || '';
  const activeTarget = activeTargetId ? state?.units[activeTargetId] : undefined;

  const attackerOfficer = attacker ? state?.officers[attacker.leaderId] : undefined;
  const targetOfficer = activeTarget ? state?.officers[activeTarget.leaderId] : undefined;

  // 单挑结果回放
  const report = state?.lastDuelReport ?? null;
  const showingResult = done && report && report.attackerUnitId === unitId;
  const currentRound = showingResult && report ? report.rounds[playback] : undefined;

  useEffect(() => {
    // 单挑执行完成后自动进入回放模式
    if (report && playback === -1 && report.attackerUnitId === unitId) {
      setPlayback(0);
      setDone(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [report]);

  if (!state || !attacker || !attackerOfficer) return null;

  const startDuel = () => {
    if (!activeTargetId) return;
    setDone(true);
    setPlayback(0);
    duelUnit(unitId, activeTargetId, stance, origin);
  };

  const close = () => {
    onClose();
  };

  const rageBar = (value: number) => (
    <span className="duel-rage-bar" aria-hidden="true">
      <span className="duel-rage-fill" style={{ width: `${Math.min(100, value)}%` }} />
    </span>
  );

  return (
    <div className="modal-backdrop" aria-label="单挑" onMouseDown={(event) => event.target === event.currentTarget && close()}>
      <section className="duel-dialog tool-panel" data-testid="duel-dialog" aria-label="单挑">
        <header className="dialog-title-bar">
          <strong>单挑</strong>
          <button type="button" className="dialog-close-button" data-testid="duel-close-button" onClick={close} aria-label="关闭">
            <X aria-hidden="true" />
          </button>
        </header>

        {/* 对战双方 */}
        <div className="duel-opponents">
          <div className="duel-participant">
            <span className="duel-participant-name">{attackerOfficer.name}</span>
            <span className="duel-participant-sub">
              武力 {attackerOfficer.stats.war}・{officerSkillsText(attackerOfficer)}
            </span>
          </div>
          <span className="duel-vs">VS</span>
          <div className="duel-participant">
            {targetOfficer ? (
              <>
                <span className="duel-participant-name">{targetOfficer.name}</span>
                <span className="duel-participant-sub">
                  武力 {targetOfficer.stats.war}・{officerSkillsText(targetOfficer)}
                </span>
              </>
            ) : (
              <span className="duel-participant-sub">无邻近敌军</span>
            )}
          </div>
        </div>

        {/* 目标选择 */}
        {!showingResult && candidates.length > 0 && (
          <div className="duel-target-row">
            <label>对手部队：</label>
            <select
              data-testid="duel-target-select"
              value={activeTargetId}
              onChange={(event) => setTargetUnitId(event.target.value)}
            >
              {candidates.map((unit) => {
                const officer = state.officers[unit.leaderId];
                return <option key={unit.id} value={unit.id}>{officer?.name ?? unit.id}（{unit.troops.toLocaleString('en-US')}兵）</option>;
              })}
            </select>
          </div>
        )}

        {/* 方针选择 */}
        {!showingResult && candidates.length > 0 && (
          <div className="duel-stance-row">
            {STANCES.map((key) => (
              <button
                key={key}
                type="button"
                data-testid={`duel-stance-${key}`}
                className={stance === key ? 'is-active' : undefined}
                onClick={() => setStance(key)}
              >
                {DUEL_STANCE_LABELS[key]}
                <em>{STANCE_HINTS[key]}</em>
              </button>
            ))}
          </div>
        )}

        {/* 发起/回放 */}
        {!showingResult && candidates.length > 0 && (
          <footer className="duel-actions">
            <button type="button" className="primary" data-testid="duel-start-button" onClick={startDuel}>
              发起单挑
            </button>
          </footer>
        )}

        {!showingResult && candidates.length === 0 && (
          <p className="duel-empty">附近没有可挑战的敌军部队</p>
        )}

        {/* 回合回放 */}
        {showingResult && report && (
          <div className="duel-replay" data-testid="duel-replay">
            <div className="duel-hp-row">
              <span>HP {report.attackerHpAtEnd}</span>
              <span>HP {report.defenderHpAtEnd}</span>
            </div>
            {currentRound && (
              <div className="duel-round" data-testid="duel-round">
                <div className="duel-round-narration">{currentRound.narration}</div>
                <div className="duel-round-detail">
                  <span>{report.attackerName}（{currentRound.attackerAction}）：{currentRound.attackerDamage}</span>
                  <span>{report.defenderName}（{currentRound.defenderAction}）：{currentRound.defenderDamage}</span>
                </div>
                <div className="duel-rage-row">
                  <span>怒气</span>
                  {rageBar(currentRound.attackerRage)}
                  {rageBar(currentRound.defenderRage)}
                </div>
              </div>
            )}
            <footer className="duel-actions">
              {playback < (report.rounds.length - 1) ? (
                <button type="button" className="primary" data-testid="duel-next-round-button" onClick={() => setPlayback(playback + 1)}>
                  下一步
                </button>
              ) : (
                <div className="duel-outcome" data-testid="duel-outcome">
                  <p>
                    {report.winner === 'attacker'
                      ? `${report.attackerName}获胜！`
                      : report.winner === 'defender'
                        ? `${report.defenderName}获胜！`
                        : '平局'}
                    {report.defenderCaptured && `（生擒${report.defenderName}）`}
                    {report.attackerCaptured && `（${report.attackerName}被生擒）`}
                  </p>
                  <p className="duel-outcome-sub">
                    {report.attackerInjured && `${report.attackerName}负伤 `}
                    {report.defenderInjured && `${report.defenderName}负伤`}
                  </p>
                  <button type="button" className="primary" data-testid="duel-finish-button" onClick={close}>
                    确定
                  </button>
                </div>
              )}
            </footer>
          </div>
        )}
      </section>
    </div>
  );
}