import { useMemo, type CSSProperties } from 'react';
import { effectiveUnitAbilities } from '../game/battle/actions';
import { grainRouteBlockedOf } from '../game/battle/grainRoute';
import { moraleCapOf } from '../game/techs';
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
  // 粮道受阻：每旬全额自耗兵粮且士气 -3（运输队不适用粮道）。范围只随局面变，与鼠标位置无关。
  const grainRouteBlocked = useMemo(
    () => (unit.kind === 'transport' ? false : grainRouteBlockedOf(state, unit)),
    [state, unit],
  );
  const style = {
    left: Math.max(8, Math.min(position.x, window.innerWidth - 166)),
    top: Math.max(8, Math.min(position.y, window.innerHeight - 248)),
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
        <div className="unit-info-officer-row"><span className="unit-info-officer-label">主将</span>{leader ? <strong>{leader.name}</strong> : <strong>未知</strong>}</div>
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
        <div><dt>士气</dt><dd>{unit.energy}/{moraleCapOf(state, unit.forceId)}</dd></div>
        <div><dt>战力</dt><dd>{unit.stamina === undefined ? '—' : `${Math.round(unit.stamina)}/100`}</dd></div>
        <div>
          <dt>粮道</dt>
          <dd
            data-testid="unit-grain-route"
            className={grainRouteBlocked ? 'unit-info-grain-route is-blocked' : 'unit-info-grain-route'}
            title={grainRouteBlocked ? '粮道受阻：兵粮全额自耗，每旬士气 -3' : '粮道通畅：本城分担一半兵粮'}
          >
            {unit.kind === 'transport' ? '—' : grainRouteBlocked ? '受阻' : '通畅'}
          </dd>
        </div>
      </dl>
    </aside>
  );
}
