import type { CSSProperties } from 'react';
import { unitFacilities } from '../game/battle/actions';
import type { Facility, GameState } from '../game/types';

interface FacilityInfoPanelProps {
  facility: Facility;
  state: GameState;
  position: { x: number; y: number };
}

const FACILITY_INFO = new Map(unitFacilities().map((facility) => [facility.type, facility]));

function formatNumber(value: number) {
  return value.toLocaleString('en-US');
}

export function FacilityInfoPanel({ facility, state, position }: FacilityInfoPanelProps) {
  const definition = FACILITY_INFO.get(facility.type);
  const force = state.forces[facility.forceId];
  const leader = state.officers[force.leaderId];
  const maxDurability = definition?.durability ?? facility.durability;
  const status = facility.completed === false ? '建设中' : '完成';
  const style = {
    left: Math.max(8, Math.min(position.x, window.innerWidth - 174)),
    top: Math.max(8, Math.min(position.y, window.innerHeight - 128)),
  } as CSSProperties;

  return (
    <aside className="facility-info-panel tool-panel" data-testid="facility-info-panel" aria-label="设施信息" style={style}>
      <header>
        <strong>{definition?.name ?? '设施'}</strong>
        <span data-testid="facility-info-status">{status}</span>
      </header>
      <div className="facility-info-owner">
        <i aria-hidden="true" style={{ '--force-color': force.color } as CSSProperties} />
        <strong>{leader?.name ?? force.name}</strong>
      </div>
      <dl>
        <div>
          <dt>耐久</dt>
          <dd data-testid="facility-info-durability">{formatNumber(facility.durability)}/{formatNumber(maxDurability)}</dd>
        </div>
      </dl>
    </aside>
  );
}
