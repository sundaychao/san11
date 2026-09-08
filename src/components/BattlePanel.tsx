import { Swords } from 'lucide-react';
import { useMemo } from 'react';
import { useGame } from '../game/store/GameProvider';

export function BattlePanel() {
  const { deployUnit, selectedCityId, state } = useGame();

  const deployPlan = useMemo(() => {
    if (!state || !selectedCityId) return null;
    const city = state.cities[selectedCityId];
    if (city.ownerId !== state.playerForceId) return null;
    const officer = Object.values(state.officers).find((candidate) => (
      candidate.forceId === state.playerForceId &&
      candidate.location.kind === 'city' &&
      candidate.location.cityId === city.id &&
      !candidate.acted
    ));
    const target = Object.values(state.cities).find((candidate) => candidate.ownerId !== null && candidate.ownerId !== state.playerForceId);
    if (!officer || !target || city.troops < 4500 || city.food < 6000) return null;
    return { city, officer, target };
  }, [selectedCityId, state]);

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
      <button
        type="button"
        className="primary-button"
        data-testid="quick-deploy-button"
        disabled={!deployPlan}
        onClick={() => {
          if (!deployPlan) return;
          deployUnit({
            cityId: deployPlan.city.id,
            officerId: deployPlan.officer.id,
            targetCityId: deployPlan.target.id,
            troops: 4000,
            food: 6000,
          });
        }}
      >
        <Swords aria-hidden="true" />快速出征
      </button>
    </section>
  );
}
