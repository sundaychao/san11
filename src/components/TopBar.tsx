import { Save, SkipForward } from 'lucide-react';
import { useState } from 'react';
import { validateCommand } from '../game/commands';
import { useGame } from '../game/store/GameProvider';
import type { GameCommand, GameState } from '../game/types';

const MONTH_NAMES = ['四月', '五月', '六月', '七月', '八月', '九月', '十月', '冬月', '腊月', '正月', '二月', '三月'];
const TEN_DAY_LABELS = { 1: '上旬', 2: '中旬', 3: '下旬' } as const;

function hasLegalActions(state: GameState) {
  const forceId = state.playerForceId;
  const targetCity = Object.values(state.cities).find((city) => city.ownerId === forceId);
  return Object.values(state.officers)
    .filter((officer) => officer.forceId === forceId && !officer.acted)
    .some((officer) => {
      const commands: GameCommand[] = [
        { type: 'develop', cityId: officer.cityId, officerId: officer.id, focus: 'commerce' },
        { type: 'recruit', cityId: officer.cityId, officerId: officer.id },
        { type: 'train', cityId: officer.cityId, officerId: officer.id },
        { type: 'patrol', cityId: officer.cityId, officerId: officer.id },
        { type: 'talent', cityId: officer.cityId, officerId: officer.id },
      ];
      if (targetCity && targetCity.id !== officer.cityId) {
        commands.push({ type: 'transfer', cityId: officer.cityId, officerId: officer.id, targetCityId: targetCity.id, gold: 0, food: 0, troops: 0, officerIds: [] });
      }
      return commands.some((command) => validateCommand(state, forceId, command).length === 0);
    });
}

export function TopBar() {
  const { state, endMonth, endTenDay, manualSave } = useGame();
  const [confirmEnd, setConfirmEnd] = useState(false);
  if (!state) return null;
  const force = state.forces[state.playerForceId];
  const year = 13 + Math.floor((state.month + 2) / 12);
  const monthName = MONTH_NAMES[(state.month - 1) % 12];

  const requestEndMonth = () => {
    if (hasLegalActions(state)) setConfirmEnd(true);
    else endMonth();
  };

  const confirm = () => {
    setConfirmEnd(false);
    endMonth();
  };

  return (
    <>
      <header className="top-bar">
        <div className="imperial-seal" aria-hidden="true">汉</div>
        <div className="date-block"><span>建安{year}年</span><strong>{monthName}</strong></div>
        <div className="top-metric"><span>旬</span><strong data-testid="ten-day-label">{TEN_DAY_LABELS[state.tenDay]}</strong></div>
        <div className="top-metric"><span>势力</span><strong className="top-force-name" style={{ color: force.color }}>{force.name}</strong></div>
        <div className="top-metric"><span>行动力</span><strong data-testid="action-points">{state.actionPoints[state.playerForceId]}</strong></div>
        <div className="top-actions">
          <button className="icon-button" type="button" onClick={manualSave} title="手动存档" aria-label="手动存档"><Save aria-hidden="true" /></button>
          <button className="next-month" data-testid="end-ten-day-button" type="button" onClick={endTenDay} disabled={state.phase === 'finished'}><SkipForward aria-hidden="true" />结束本旬</button>
          <button className="next-month" type="button" onClick={requestEndMonth} aria-label="进行到下月" disabled={state.phase === 'finished'}><SkipForward aria-hidden="true" />进行·下月</button>
        </div>
      </header>
      {confirmEnd && (
        <div className="modal-backdrop">
          <section className="confirm-dialog tool-panel" role="dialog" aria-modal="true" aria-labelledby="end-month-title">
            <p>仍有武将和行动力可用</p>
            <h2 id="end-month-title">结束本月</h2>
            <p>未使用行动力的一半会结转到下一旬。确定交由其他势力行动并进入下月吗？</p>
            <footer>
              <button type="button" className="secondary-button" onClick={() => setConfirmEnd(false)}>取消</button>
              <button type="button" className="primary-button" onClick={confirm}>确认进行</button>
            </footer>
          </section>
        </div>
      )}
    </>
  );
}
