import { Building2 } from 'lucide-react';
import type { CSSProperties } from 'react';
import type { City, GameState } from '../game/types';

interface CityInfoPanelProps {
  city: City;
  state: GameState;
  position: { x: number; y: number };
}

function formatNumber(value: number) {
  return value.toLocaleString('en-US');
}

export function CityInfoPanel({ city, state, position }: CityInfoPanelProps) {
  const force = state.forces[city.ownerId];
  const governor = city.governorId ? state.officers[city.governorId] : undefined;
  const localOfficers = Object.values(state.officers).filter((officer) =>
    officer.forceId === city.ownerId && officer.cityId === city.id,
  );
  // 现役：分子=该城当前待命武将数，分母=当前城池的武将数量（非势力）
  const idleOfficers = localOfficers.filter((officer) => officer.location.kind === 'city' && !officer.acted);
  const style = {
    left: Math.max(8, Math.min(position.x, window.innerWidth - 190)),
    top: Math.max(8, Math.min(position.y, window.innerHeight - 260)),
  } as CSSProperties;

  return (
    <aside className="city-info-panel tool-panel" data-testid="city-info-panel" aria-label="城池信息" style={style}>
      <header>
        <strong>{city.name}</strong>
        <Building2 aria-hidden="true" />
      </header>
      <div className="city-info-owner">
        <span>{force.name}军</span>
      </div>
      <dl>
        <div><dt>太守</dt><dd>{governor?.name ?? '-'}</dd></div>
        <div><dt>资金</dt><dd>{formatNumber(city.gold)}</dd></div>
        <div><dt>兵粮</dt><dd>{formatNumber(city.food)}</dd></div>
        <div><dt>治安</dt><dd>{city.order}/100</dd></div>
        <div><dt>耐久</dt><dd>{formatNumber(city.durability)}</dd></div>
        <div><dt>士兵</dt><dd>{formatNumber(city.troops)}</dd></div>
        <div><dt>现役</dt><dd>{idleOfficers.length}/{localOfficers.length}</dd></div>
      </dl>
    </aside>
  );
}
