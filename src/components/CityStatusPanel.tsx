import { Landmark } from 'lucide-react';
import { ARMAMENT_LABELS, armamentsOf } from '../game/armaments';
import { grainPriceOf } from '../game/commands';
import { cityPlotCount, cityPopulationOf, ruralPopulationOf } from '../game/innerAffairs';
import type { City, GameState } from '../game/types';

interface CityStatusPanelProps {
  city: City;
  state: GameState;
}

const formatNumber = (value: number) => value.toLocaleString('en-US');

/** 单条信息：左侧标签格 + 右侧数值格（对齐原版都市信息面板） */
function StatusRow({ label, value, centered }: { label: string; value: string; centered?: boolean }) {
  return (
    <div className="csp-row">
      <span className="csp-label">{label}</span>
      <span className={`csp-value${centered ? ' is-centered' : ''}`}>{value}</span>
    </div>
  );
}

/** 点击我方城池后显示在屏幕左侧中间的都市信息面板（布局对标原版三国志11） */
export function CityStatusPanel({ city, state }: CityStatusPanelProps) {
  const armaments = armamentsOf(city.armaments);
  const plots = city.plots ?? [];
  const facilityTotal = plots.length || cityPlotCount(city);
  const facilityUsed = plots.filter((plot) => plot.type !== 'empty').length;

  // 现役：分子=本城当前待命武将数，分母=本城在籍武将数
  const localOfficers = Object.values(state.officers).filter(
    (officer) => officer.forceId === city.ownerId && officer.cityId === city.id,
  );
  const idleOfficers = localOfficers.filter((officer) => officer.location.kind === 'city' && !officer.acted);
  // 俘虏：关押在本城的战俘
  const captiveCount = Object.values(state.officers).filter(
    (officer) => officer.location.kind === 'captive' && officer.location.cityId === city.id,
  ).length;
  // 在野：本城未出仕武将
  const freeCount = Object.values(state.officers).filter(
    (officer) => officer.forceId === null && officer.location.kind === 'unaffiliated' && officer.location.cityId === city.id,
  ).length;

  return (
    <aside className="city-status-panel" data-testid="city-status-panel" aria-label="都市信息">
      <header className="csp-heading">
        <h2>{city.name}</h2>
        <Landmark aria-hidden="true" />
      </header>

      <div className="csp-group">
        <StatusRow label="资金" value={formatNumber(city.gold)} />
        <StatusRow label="兵粮" value={formatNumber(city.food)} />
      </div>

      <div className="csp-group">
        <StatusRow label="治安" value={`${city.order}/100`} />
        <StatusRow label="设施数" value={`${facilityUsed}/${facilityTotal}`} />
        <StatusRow label="耐久" value={`${formatNumber(city.durability)}/${formatNumber(city.maxDurability)}`} />
      </div>

      <div className="csp-group">
        <StatusRow label="士兵" value={formatNumber(city.troops)} />
        <StatusRow label="士气" value={`${city.training}/100`} />
      </div>

      <div className="csp-group csp-armaments">
        <span className="csp-label">{ARMAMENT_LABELS.spear}</span>
        <span className="csp-value">{formatNumber(armaments.spear)}</span>
        <span className="csp-label">{ARMAMENT_LABELS.ram}</span>
        <span className="csp-value">{formatNumber(armaments.ram)}</span>

        <span className="csp-label">{ARMAMENT_LABELS.halberd}</span>
        <span className="csp-value">{formatNumber(armaments.halberd)}</span>
        <span className="csp-label">{ARMAMENT_LABELS.tower}</span>
        <span className="csp-value">{formatNumber(armaments.tower)}</span>

        <span className="csp-label">{ARMAMENT_LABELS.crossbow}</span>
        <span className="csp-value">{formatNumber(armaments.crossbow)}</span>
        <span className="csp-label">{ARMAMENT_LABELS.ship}</span>
        <span className="csp-value">{formatNumber(armaments.ship)}</span>

        <span className="csp-label">{ARMAMENT_LABELS.cavalry}</span>
        <span className="csp-value">{formatNumber(armaments.cavalry)}</span>
        <span className="csp-blank" />
        <span className="csp-blank" />
      </div>

      <div className="csp-group">
        <StatusRow label="城市人口" value={formatNumber(cityPopulationOf(city))} />
        <StatusRow label="农村人口" value={formatNumber(ruralPopulationOf(city))} />
      </div>

      <div className="csp-group">
        <StatusRow label="市价" value={`兵粮${grainPriceOf(city)}=资金1`} centered />
      </div>

      <div className="csp-group">
        <StatusRow label="现役" value={`${idleOfficers.length}/${localOfficers.length}`} />
        <StatusRow label="俘虏" value={formatNumber(captiveCount)} />
        <StatusRow label="在野" value={formatNumber(freeCount)} />
      </div>
    </aside>
  );
}
