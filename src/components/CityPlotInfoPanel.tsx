import type { CSSProperties } from 'react';
import { PLOT_LABELS, PLOT_MAX_DURABILITY, cityPlots } from '../game/innerAffairs';
import type { City, GameState } from '../game/types';

interface CityPlotInfoPanelProps {
  city: City;
  plotIndex: number;
  state: GameState;
  position: { x: number; y: number };
}

function formatNumber(value: number) {
  return value.toLocaleString('en-US');
}

/** 城市设施悬停信息面板：与军事设施（FacilityInfoPanel）同样式，显示耐久值 */
export function CityPlotInfoPanel({ city, plotIndex, state, position }: CityPlotInfoPanelProps) {
  const plot = cityPlots(city)[plotIndex];
  if (!plot) return null;
  const force = state.forces[city.ownerId];
  const leader = force ? state.officers[force.leaderId] : undefined;
  const constructing = plot.constructing;
  const name = constructing
    ? PLOT_LABELS[constructing.facility]
    : plot.type !== 'empty' ? PLOT_LABELS[plot.type] : '空地';
  const status = constructing ? '建设中' : '完成';
  // 旧存档无耐久字段时视为满值
  const durability = plot.durability ?? PLOT_MAX_DURABILITY;
  const style = {
    left: Math.max(8, Math.min(position.x, window.innerWidth - 174)),
    top: Math.max(8, Math.min(position.y, window.innerHeight - 128)),
  } as CSSProperties;

  return (
    <aside className="facility-info-panel tool-panel" data-testid="city-plot-info-panel" aria-label="城市设施信息" style={style}>
      <header>
        <strong>{name}</strong>
        <span data-testid="city-plot-info-status">{status}</span>
      </header>
      <div className="facility-info-owner">
        <i aria-hidden="true" style={{ '--force-color': force?.color ?? '#888' } as CSSProperties} />
        <strong>
          {constructing
            ? (state.officers[constructing.officerId]?.name ?? '-')
            : (leader?.name ?? force?.name ?? '-')}
        </strong>
      </div>
      <dl>
        <div>
          <dt>耐久</dt>
          <dd data-testid="city-plot-info-durability">
            {formatNumber(durability)}/{formatNumber(PLOT_MAX_DURABILITY)}
          </dd>
        </div>
        {constructing && (
          <div>
            <dt>剩余</dt>
            <dd>{constructing.remainingTenDays}旬</dd>
          </div>
        )}
        {!constructing && (
          <div>
            <dt>等级</dt>
            <dd>Lv{plot.level}</dd>
          </div>
        )}
      </dl>
    </aside>
  );
}
