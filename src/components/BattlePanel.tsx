import { Swords } from 'lucide-react';
import { useGame } from '../game/store/GameProvider';

export function BattlePanel() {
  const { selectedCityId, state } = useGame();

  if (!state || !selectedCityId) return null;

  const unitCount = Object.values(state.units).filter((unit) => unit.forceId === state.playerForceId).length;

  return (
    <section className="battle-panel tool-panel" aria-label="战斗面板">
      <header>
        <Swords aria-hidden="true" />
        <div>
          <p>部队</p>
          <strong>{unitCount}</strong>
        </div>
      </header>
    </section>
  );
}
