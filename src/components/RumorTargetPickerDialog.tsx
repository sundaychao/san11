import { X } from 'lucide-react';
import { strongholdTransferDuration } from '../game/commands';
import { rumorTargetOptions, type RumorTargetOption } from '../game/rumor';
import type { City, CityId, GameState, Pass, PassId } from '../game/types';

interface RumorTargetPickerDialogProps {
  state: GameState;
  /** 出发据点：用于逐行计算「单程」旬数（执行武将须亲赴目标据点，散布后原路返回） */
  origin?: City | Pass;
  selectedId: string;
  onPick(targetId: string): void;
  onClose(): void;
}

/** 据点类型显示名 */
function kindLabel(option: RumorTargetOption): string {
  return option.kind === 'pass' ? '关隘' : '都市';
}

/**
 * 「选择目标据点」列表页（原版三国志11 式）：
 * 全部敌城 + 有守将的敌关隘一览，并给出各目标的单程行程（往返为两倍）；
 * 点击行即选定为流言目标。
 */
export function RumorTargetPickerDialog({ state, origin, selectedId, onPick, onClose }: RumorTargetPickerDialogProps) {
  const rows = rumorTargetOptions(state, state.playerForceId);

  /** 单程旬数：出发据点 → 目标据点（去程与返程同距）；无出发据点时显示 — */
  const travelTenDaysOf = (option: RumorTargetOption): number | null => {
    if (!origin) return null;
    const target = option.kind === 'pass' ? state.passes?.[option.id as PassId] : state.cities[option.id as CityId];
    if (!target) return null;
    return Math.max(1, strongholdTransferDuration(state, origin, target));
  };

  return (
    <div
      className="modal-backdrop"
      data-testid="rumor-target-picker"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
      onContextMenu={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onClose();
      }}
    >
      <section className="talent-target-dialog tool-panel" role="dialog" aria-modal="true" aria-labelledby="rumor-target-title">
        <header className="talent-target-header">
          <h2 id="rumor-target-title">选择目标据点</h2>
          <button type="button" className="icon-button" aria-label="关闭" title="关闭" onClick={onClose}><X /></button>
        </header>

        <div className="talent-target-scroll">
          <table className="talent-target-table">
            <thead>
              <tr>
                <th scope="col">据点</th>
                <th scope="col">类型</th>
                <th scope="col">势力</th>
                <th scope="col">武将</th>
                <th scope="col">治安</th>
                <th scope="col">单程</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((option) => {
                const stronghold = option.kind === 'pass' ? state.passes?.[option.id as PassId] : state.cities[option.id as CityId];
                const travel = travelTenDaysOf(option);
                return (
                  <tr
                    key={option.id}
                    className={[
                      'talent-target-row',
                      option.id === selectedId ? 'is-selected' : '',
                      option.kind === 'pass' ? 'is-pass' : '',
                    ].join(' ').trim()}
                    onClick={() => onPick(option.id)}
                    data-testid={`rumor-target-${option.id}`}
                  >
                    <td className="talent-name">{option.name}</td>
                    <td>{kindLabel(option)}</td>
                    <td>{state.forces[option.ownerId]?.name ?? '—'}</td>
                    <td>{option.officerCount}</td>
                    <td>{stronghold?.order ?? '—'}</td>
                    <td>{travel === null ? '—' : `${travel}旬`}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {rows.length === 0 && <p className="talent-target-empty">没有可散布流言的敌方据点</p>}
        </div>

        <footer className="talent-target-footer">
          <span className="talent-target-hint">含有人驻守的关隘 · 单程旬数即去程（返程同距）· 点击行即选定目标</span>
          <button type="button" className="secondary-button" onClick={onClose}>返回</button>
        </footer>
      </section>
    </div>
  );
}
