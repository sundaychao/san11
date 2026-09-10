import { Shield } from 'lucide-react';
import { ARMAMENT_LABELS, armamentsOf } from '../game/armaments';
import type { GameState, Pass } from '../game/types';

interface PassStatusPanelProps {
  pass: Pass;
  state: GameState;
}

const formatNumber = (value: number) => value.toLocaleString('en-US');

/** 单条信息：左侧标签格 + 右侧数值格（与城池信息面板同款布局） */
function StatusRow({ label, value, centered }: { label: string; value: string; centered?: boolean }) {
  return (
    <div className="csp-row">
      <span className="csp-label">{label}</span>
      <span className={`csp-value${centered ? ' is-centered' : ''}`}>{value}</span>
    </div>
  );
}

/** 点击我方关隘后显示在屏幕左侧中间的关隘信息面板（对标城池信息面板，无治安值） */
export function PassStatusPanel({ pass, state }: PassStatusPanelProps) {
  const armaments = armamentsOf(pass.armaments);
  const owner = pass.ownerId ? state.forces[pass.ownerId] : undefined;
  const governor = pass.governorId ? state.officers[pass.governorId] : undefined;

  return (
    <aside className="city-status-panel" data-testid="pass-status-panel" aria-label="关隘信息">
      <header className="csp-heading">
        <h2>{pass.name}</h2>
        <Shield aria-hidden="true" />
      </header>

      <div className="csp-group">
        <StatusRow label="归属" value={owner ? `${owner.name}军` : '无主'} />
        <StatusRow label="太守" value={governor?.name ?? '暂无'} />
      </div>

      <div className="csp-group">
        <StatusRow label="资金" value={formatNumber(pass.gold)} />
        <StatusRow label="兵粮" value={formatNumber(pass.food)} />
      </div>

      <div className="csp-group">
        <StatusRow label="耐久" value={`${formatNumber(pass.durability)}/${formatNumber(pass.maxDurability)}`} />
        <StatusRow label="士兵" value={formatNumber(pass.troops)} />
        <StatusRow label="人口" value={formatNumber(pass.population)} />
      </div>

      <div className="csp-group csp-armaments">
        <span className="csp-label">{ARMAMENT_LABELS.spear}</span>
        <span className="csp-value">{formatNumber(armaments.spear)}</span>
        <span className="csp-label">{ARMAMENT_LABELS.halberd}</span>
        <span className="csp-value">{formatNumber(armaments.halberd)}</span>

        <span className="csp-label">{ARMAMENT_LABELS.crossbow}</span>
        <span className="csp-value">{formatNumber(armaments.crossbow)}</span>
        <span className="csp-label">{ARMAMENT_LABELS.cavalry}</span>
        <span className="csp-value">{formatNumber(armaments.cavalry)}</span>

        <span className="csp-blank" />
        <span className="csp-blank" />
        <span className="csp-blank" />
        <span className="csp-blank" />
      </div>
    </aside>
  );
}