import type { CSSProperties } from 'react';
import type { ArmyUnit, GameState, OfficerAptitudes, TroopType } from '../game/types';

const TROOP_LABELS: Record<TroopType, string> = {
  sword: '剑兵',
  spear: '枪兵',
  halberd: '戟兵',
  crossbow: '弩兵',
  cavalry: '骑兵',
  siege: '兵器',
};

interface UnitInfoPanelProps {
  unit: ArmyUnit;
  state: GameState;
  position: { x: number; y: number };
}

function unitArmamentLabel(unit: ArmyUnit) {
  if (unit.kind === 'transport') return '输送队';
  if (unit.troopType === 'siege') return '兵器';
  return unit.troopType ? TROOP_LABELS[unit.troopType] : '剑兵';
}

function aptitudeKey(unit: ArmyUnit): keyof OfficerAptitudes | null {
  if (unit.troopType === 'spear') return 'spear';
  if (unit.troopType === 'halberd') return 'halberd';
  if (unit.troopType === 'crossbow') return 'crossbow';
  if (unit.troopType === 'cavalry') return 'cavalry';
  if (unit.troopType === 'siege') return 'siege';
  return null;
}

export function UnitInfoPanel({ unit, state, position }: UnitInfoPanelProps) {
  const leader = state.officers[unit.leaderId];
  const officerIds = unit.officerIds ?? [unit.leaderId];
  const deputies = officerIds.slice(1).map((id) => state.officers[id]?.name).filter(Boolean);
  const aptitudeField = aptitudeKey(unit);
  const aptitude = unit.kind === 'transport' || !leader?.aptitudes || !aptitudeField
    ? '—'
    : leader.aptitudes[aptitudeField] ?? '—';
  const style = {
    left: Math.max(8, Math.min(position.x, window.innerWidth - 190)),
    top: Math.max(8, Math.min(position.y, window.innerHeight - 250)),
  } as CSSProperties;

  return (
    <aside className="unit-info-panel tool-panel" data-testid="unit-info-panel" aria-label="部队信息" style={style}>
      <header>
        <strong>{leader?.name ?? '部队'}部队</strong>
        <span>{officerIds.length}</span>
      </header>
      <div className="unit-info-officers">
        <div><span>主将</span><strong>{leader?.name ?? '未知'}</strong></div>
        <div><span>副将</span><strong>{deputies.join('、') || '—'}</strong></div>
      </div>
      <dl>
        <div><dt>资金</dt><dd>{(unit.gold ?? 0).toLocaleString('en-US')}</dd></div>
        <div><dt>兵粮</dt><dd>{unit.food.toLocaleString('en-US')}</dd></div>
        <div><dt>士兵</dt><dd>{unit.troops.toLocaleString('en-US')}</dd></div>
        <div><dt>士气</dt><dd>{unit.energy}/100</dd></div>
        <div><dt>兵科</dt><dd>{unitArmamentLabel(unit)} <em>{aptitude}</em></dd></div>
      </dl>
    </aside>
  );
}
