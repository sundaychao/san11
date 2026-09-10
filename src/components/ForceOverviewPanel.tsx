import { useState } from 'react';
import { useGame } from '../game/store/GameProvider';
import type { GameState, Officer } from '../game/types';

type OverviewTab = 'city' | 'officer';

function officerLocationText(officer: Officer, state: GameState) {
  if (officer.location.kind === 'city') return state.cities[officer.location.cityId].name;
  if (officer.location.kind === 'pass') return state.passes?.[officer.location.passId]?.name ?? '关隘';
  if (officer.location.kind === 'unit') return '部队';
  if (officer.location.kind === 'transfer') return '在途';
  return state.cities[officer.location.cityId].name;
}

export function ForceOverviewPanel() {
  const { state } = useGame();
  const [activeTab, setActiveTab] = useState<OverviewTab>('city');
  if (!state) return null;

  const playerForceId = state.playerForceId;
  const cities = Object.values(state.cities)
    .filter((city) => city.ownerId === playerForceId)
    .sort((left, right) => left.name.localeCompare(right.name));
  const officers = Object.values(state.officers)
    .filter((officer) => officer.forceId === playerForceId)
    .sort((left, right) => {
      const leftLocation = officerLocationText(left, state);
      const rightLocation = officerLocationText(right, state);
      return leftLocation.localeCompare(rightLocation) || right.stats.leadership - left.stats.leadership;
    });

  return (
    <aside className="force-overview-panel tool-panel" data-testid="force-overview-panel" aria-label="本势力概览">
      <nav className="force-overview-tabs" aria-label="本势力列表分类">
        <button type="button" className={activeTab === 'city' ? 'is-active' : undefined} onClick={() => setActiveTab('city')}>
          城池
        </button>
        <button type="button" className={activeTab === 'officer' ? 'is-active' : undefined} onClick={() => setActiveTab('officer')}>
          武将
        </button>
      </nav>

      {activeTab === 'city' ? (
        <ol className="force-overview-list">
          {cities.map((city) => (
            <li key={city.id} className="force-overview-row">
              <strong>{city.name}</strong>
              <small>{city.troops.toLocaleString('en-US')}兵 / {city.population.toLocaleString('en-US')}人</small>
            </li>
          ))}
        </ol>
      ) : (
        <ol className="force-overview-list">
          {officers.map((officer) => (
            <li key={officer.id} className={`force-overview-row ${officer.acted ? 'has-acted' : 'is-ready'}`}>
              <strong>{officer.name}</strong>
              <small>{officerLocationText(officer, state)} / {officer.acted ? '已行动' : '未行动'}</small>
            </li>
          ))}
        </ol>
      )}
    </aside>
  );
}
