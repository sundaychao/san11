import { Save, SkipForward } from 'lucide-react';
import { useGame } from '../game/store/GameProvider';

const MONTH_NAMES = ['四月', '五月', '六月', '七月', '八月', '九月', '十月', '冬月', '腊月', '正月', '二月', '三月'];

export function TopBar() {
  const { state, endMonth, manualSave } = useGame();
  if (!state) return null;
  const force = state.forces[state.playerForceId];
  const year = 13 + Math.floor((state.month + 2) / 12);
  const monthName = MONTH_NAMES[(state.month - 1) % 12];

  return (
    <header className="top-bar">
      <div className="imperial-seal" aria-hidden="true">汉</div>
      <div className="date-block"><span>建安{year}年</span><strong>{monthName}</strong></div>
      <div className="top-metric"><span>势力</span><strong className="top-force-name" style={{ color: force.color }}>{force.name}</strong></div>
      <div className="top-metric"><span>行动力</span><strong>{state.actionPoints[state.playerForceId]}</strong></div>
      <div className="top-actions">
        <button className="icon-button" type="button" onClick={manualSave} title="手动存档" aria-label="手动存档"><Save aria-hidden="true" /></button>
        <button className="next-month" type="button" onClick={endMonth} aria-label="进行到下月"><SkipForward aria-hidden="true" />进行·下月</button>
      </div>
    </header>
  );
}
