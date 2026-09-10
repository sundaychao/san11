import { Shield } from 'lucide-react';
import type { CSSProperties } from 'react';
import type { GameState, Pass } from '../game/types';

interface PassInfoPanelProps {
  pass: Pass;
  state: GameState;
  position: { x: number; y: number };
}

function formatNumber(value: number) {
  return value.toLocaleString('en-US');
}

/** 悬停关隘中心锚点时的信息弹窗（布局与城池信息弹窗一致，仅无治安值） */
export function PassInfoPanel({ pass, state, position }: PassInfoPanelProps) {
  const force = pass.ownerId ? state.forces[pass.ownerId] : undefined;
  const governor = pass.governorId ? state.officers[pass.governorId] : undefined;
  // 现役：分子=关隘当前待命武将数，分母=驻扎该关隘的武将数（含执行关隘任务的武将）
  const localOfficers = Object.values(state.officers).filter((officer) =>
    officer.forceId === pass.ownerId &&
    ((officer.location.kind === 'pass' && officer.location.passId === pass.id) ||
      (officer.location.kind === 'task' && officer.location.passId === pass.id)),
  );
  const idleOfficers = localOfficers.filter((officer) => officer.location.kind === 'pass' && !officer.acted);
  const style = {
    left: Math.max(8, Math.min(position.x, window.innerWidth - 190)),
    top: Math.max(8, Math.min(position.y, window.innerHeight - 300)),
  } as CSSProperties;

  return (
    <aside className="city-info-panel tool-panel" data-testid="pass-info-panel" aria-label="关隘信息" style={style}>
      <header>
        <strong>{pass.name}</strong>
        <Shield aria-hidden="true" />
      </header>
      <div className="city-info-owner">
        <span>{force ? `${force.name}军` : '无主'}</span>
      </div>
      <dl>
        <div><dt>太守</dt><dd>{governor?.name ?? '-'}</dd></div>
        <div><dt>资金</dt><dd>{formatNumber(pass.gold)}</dd></div>
        <div><dt>兵粮</dt><dd>{formatNumber(pass.food)}</dd></div>
        <div><dt>耐久</dt><dd>{formatNumber(pass.durability)}</dd></div>
        <div><dt>士兵</dt><dd>{formatNumber(pass.troops)}</dd></div>
        <div><dt>现役</dt><dd>{idleOfficers.length}/{localOfficers.length}</dd></div>
      </dl>
    </aside>
  );
}
