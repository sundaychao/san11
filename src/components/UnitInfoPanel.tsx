import type { CSSProperties } from 'react';
import { effectiveUnitAbilities } from '../game/battle/actions';
import type { ArmyUnit, GameState } from '../game/types';

interface UnitInfoPanelProps {
  unit: ArmyUnit;
  state: GameState;
  position: { x: number; y: number };
  strategyChance?: { name: string; percent: number };
  onPointerEnter?(): void;
  onPointerLeave?(): void;
}

export function UnitInfoPanel({ unit, state, position, strategyChance, onPointerEnter, onPointerLeave }: UnitInfoPanelProps) {
  const leader = state.officers[unit.leaderId];
  const officerIds = unit.officerIds ?? [unit.leaderId];
  const deputies = officerIds.slice(1).map((id) => state.officers[id]?.name).filter(Boolean);
  const abilities = effectiveUnitAbilities(state, unit);
  const aptitude = abilities.aptitude.grade ?? '—';
  const style = {
    left: Math.max(8, Math.min(position.x, window.innerWidth - 166)),
    top: Math.max(8, Math.min(position.y, window.innerHeight - 226)),
  } as CSSProperties;

  return (
    <aside
      className="unit-info-panel tool-panel"
      data-testid="unit-info-panel"
      aria-label="部队信息"
      style={style}
      onPointerEnter={onPointerEnter}
      onPointerLeave={onPointerLeave}
    >
      <header>
        <strong>{leader?.name ?? '部队'}部队</strong>
        <span>{officerIds.length}</span>
      </header>
      <div className="unit-info-officers">
        <div><span>主将</span><strong>{leader?.name ?? '未知'}</strong></div>
        <div><span>副将</span><strong>{deputies.join('、') || '—'}</strong></div>
      </div>
      <div className="unit-info-abilities" data-testid="unit-effective-abilities">
        <span>统<strong>{abilities.leadership.value}</strong></span>
        <span>武<strong>{abilities.war.value}</strong></span>
        <span>智<strong>{abilities.intelligence.value}</strong></span>
        <span>适<strong>{aptitude}</strong></span>
      </div>
      {strategyChance && <p className="unit-info-strategy-chance">{strategyChance.name}成功率 {strategyChance.percent}%</p>}
      <dl>
        <div><dt>资金</dt><dd>{(unit.gold ?? 0).toLocaleString('en-US')}</dd></div>
        <div><dt>兵粮</dt><dd>{unit.food.toLocaleString('en-US')}</dd></div>
        <div><dt>士气</dt><dd>{unit.energy}/100</dd></div>
      </dl>
    </aside>
  );
}
