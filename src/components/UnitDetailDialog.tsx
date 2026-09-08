import { X } from 'lucide-react';
import { useAudioEventAdapter } from '../audio/reactAudioEventAdapter';
import { TROOP_LABELS, VEHICLE_LABELS } from '../game/armaments';
import { effectiveUnitAbilities, fireStrategySuccessChance, tacticCriticalChance } from '../game/battle/actions';
import { effectiveStat } from '../game/health';
import type { ArmyUnit, GameState, Officer } from '../game/types';
import { OfficerHealthBadge } from './OfficerHealthBadge';
import { closePopupOnContextMenu } from './popupEvents';

interface UnitDetailDialogProps {
  unit: ArmyUnit;
  state: GameState;
  onClose(): void;
}

function unitName(unit: ArmyUnit, state: GameState) {
  const leader = state.officers[unit.leaderId];
  return `${leader?.name ?? '部队'}队`;
}

function unitKind(unit: ArmyUnit) {
  if (unit.kind === 'transport') return '输送队';
  if (unit.troopType === 'siege' && unit.siegeWeapon) {
    return unit.siegeWeapon === 'ram' ? '冲车' : '井阑';
  }
  return TROOP_LABELS[unit.troopType ?? 'sword'];
}

function unitVehicle(unit: ArmyUnit) {
  return unit.vehicle ? VEHICLE_LABELS[unit.vehicle] : null;
}

function unitStatus(unit: ArmyUnit) {
  if (unit.acted) return '已行动';
  if (unit.moved) return '已移动';
  return '普通';
}

export function UnitDetailDialog({ unit, state, onClose }: UnitDetailDialogProps) {
  const audio = useAudioEventAdapter();
  const officerIds = unit.officerIds ?? [unit.leaderId];
  const officers = officerIds.map((id) => state.officers[id]).filter(Boolean);
  const leader = officers[0];
  const deputies = officers.slice(1);
  const abilities = effectiveUnitAbilities(state, unit);
  const officerName = (officerId: string | null) => officerId ? state.officers[officerId]?.name ?? '未知' : '—';
  const aptitude = abilities.aptitude.grade;
  const criticalChance = aptitude ? `${tacticCriticalChance(abilities.war.value, aptitude)}%` : '—';
  const fireChance = `${fireStrategySuccessChance(abilities.intelligence.value)}%`;

  return (
    <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()} onContextMenu={(event) => closePopupOnContextMenu(event, onClose, audio)}>
      <section className="unit-detail-dialog tool-panel" data-testid="unit-detail-dialog" role="dialog" aria-modal="true" aria-labelledby="unit-detail-title">
        <header>
          <div>
            <p>部队情报</p>
            <h2 id="unit-detail-title">{unitName(unit, state)}</h2>
          </div>
          <button type="button" className="icon-button" aria-label="关闭部队情报" title="关闭" onClick={onClose}><X /></button>
        </header>

        <section className="unit-detail-commanders" aria-label="所属武将">
          <article>
            <span>主将</span>
            <strong>{leader?.name ?? '未知'}{leader ? <OfficerHealthBadge officer={leader} /> : null}</strong>
            <small>{leader ? `统率 ${effectiveStat(leader, 'leadership')} 武力 ${effectiveStat(leader, 'war')}` : '-'}</small>
          </article>
          <article>
            <span>副将</span>
            <strong>{deputies.length > 0
              ? deputies.map((officer: Officer, index) => (
                <span key={officer.id}>{index > 0 ? ' / ' : ''}{officer.name}<OfficerHealthBadge officer={officer} /></span>
              ))
              : '-'}</strong>
            <small>{deputies.length > 0 ? `${deputies.length} 人` : '无'}</small>
          </article>
        </section>

        <dl className="unit-detail-grid unit-detail-effective-grid" aria-label="有效部队能力">
          <div><dt>统率</dt><dd><strong>{abilities.leadership.value}</strong><span>{officerName(abilities.leadership.officerId)}</span></dd></div>
          <div><dt>武力</dt><dd><strong>{abilities.war.value}</strong><span>{officerName(abilities.war.officerId)}</span></dd></div>
          <div><dt>智力</dt><dd><strong>{abilities.intelligence.value}</strong><span>{officerName(abilities.intelligence.officerId)}</span></dd></div>
          <div><dt>适性</dt><dd><strong>{aptitude ?? '—'}</strong><span>{officerName(abilities.aptitude.officerId)}</span></dd></div>
          <div><dt>战法暴击率</dt><dd>{criticalChance}</dd></div>
          <div><dt>火计成功率</dt><dd>{fireChance}</dd></div>
        </dl>

        <dl className="unit-detail-grid">
          <div><dt>势力</dt><dd>{state.forces[unit.forceId].name}</dd></div>
          <div><dt>军团</dt><dd>{state.cities[unit.homeCityId].name}</dd></div>
          <div><dt>兵种</dt><dd>{unitKind(unit)}</dd></div>
          {unitVehicle(unit) && <div><dt>工具</dt><dd>{unitVehicle(unit)}</dd></div>}
          <div><dt>坐标</dt><dd>{unit.q},{unit.r}</dd></div>
          <div><dt>士兵</dt><dd>{unit.troops.toLocaleString('en-US')}</dd></div>
          <div><dt>士气</dt><dd>{unit.energy}</dd></div>
          <div><dt>战力</dt><dd>{unit.stamina === undefined ? '—' : Math.round(unit.stamina)}</dd></div>
          <div><dt>资金</dt><dd>{(unit.gold ?? 0).toLocaleString('en-US')}</dd></div>
          <div><dt>兵粮</dt><dd>{unit.food.toLocaleString('en-US')}</dd></div>
          <div><dt>行动</dt><dd>{unit.movementRemaining}</dd></div>
          <div><dt>状态</dt><dd>{unitStatus(unit)}</dd></div>
        </dl>
      </section>
    </div>
  );
}
