import { useMemo, useState } from 'react';
import { X } from 'lucide-react';
import { officerLoyalty } from '../game/loyalty';
import { positionDefinition } from '../game/ranks';
import type { GameState, Officer } from '../game/types';

/** 登庸对象列表的排序页签（参照原版：在野武将永远排最上面） */
type TalentTargetTab = '登庸' | '所属' | '能力';

const TALENT_TARGET_TABS: TalentTargetTab[] = ['登庸', '所属', '能力'];

function statSum(officer: Officer): number {
  const stats = officer.stats;
  return stats.leadership + stats.war + stats.intelligence + stats.politics + stats.charisma;
}

/** 身份：在野 / 君主 / 官职名 / 一般 */
function identityOf(state: GameState, officer: Officer): string {
  if (officer.forceId === null) return '在野';
  const force = state.forces[officer.forceId];
  if (force?.leaderId === officer.id) return '君主';
  return officer.positionId ? positionDefinition(officer.positionId)?.name ?? '一般' : '一般';
}

/** 所属据点名：优先驻城，随军/任务按所在城显示 */
function stationName(state: GameState, officer: Officer): string {
  const cityId = officer.cityId
    ?? (officer.location.kind === 'city' || officer.location.kind === 'unaffiliated' || officer.location.kind === 'task'
      ? officer.location.cityId
      : undefined);
  return cityId ? state.cities[cityId]?.name ?? '—' : '—';
}

/** 所在：随军出阵显示带队武将名（「XX队」），任务/移动/出使显示状态，待命显示城名 */
function whereaboutOf(state: GameState, officer: Officer): string {
  const location = officer.location;
  if (location.kind === 'unit') {
    const leader = state.officers[state.units?.[location.unitId]?.leaderId ?? ''];
    return leader ? `${leader.name}队` : '出阵中';
  }
  if (location.kind === 'transfer') return '移动中';
  if (location.kind === 'task') return '任务中';
  if (location.kind === 'envoy') return '出使中';
  return stationName(state, officer);
}

interface TalentTargetPickerDialogProps {
  state: GameState;
  selectedId: string;
  onPick(officerId: string): void;
  onClose(): void;
}

/**
 * 「选择对象武将」列表页（原版三国志11 式）：
 * 全地图在野武将与其他势力武将一览，在野武将固定排最上面；
 * 点击行即选定为登庸对象，君主不可选（履行列标 ×）。
 */
export function TalentTargetPickerDialog({ state, selectedId, onPick, onClose }: TalentTargetPickerDialogProps) {
  const [tab, setTab] = useState<TalentTargetTab>('登庸');

  const rows = useMemo(() => {
    const candidates = Object.values(state.officers).filter((officer) =>
      !officer.deathMonth
      && officer.location.kind !== 'captive'
      && (officer.forceId === null || officer.forceId !== state.playerForceId));
    const unaffiliated = candidates.filter((officer) => officer.forceId === null);
    const affiliated = candidates.filter((officer) => officer.forceId !== null);
    const byLoyalty = (left: Officer, right: Officer) => officerLoyalty(left) - officerLoyalty(right);
    const forceOrder = (officer: Officer) => Object.keys(state.forces).indexOf(officer.forceId ?? '');
    let sortedAffiliated: Officer[];
    switch (tab) {
      case '所属':
        sortedAffiliated = [...affiliated].sort((left, right) =>
          forceOrder(left) - forceOrder(right) || byLoyalty(left, right));
        break;
      case '能力':
        sortedAffiliated = [...affiliated].sort((left, right) => statSum(right) - statSum(left));
        break;
      default:
        sortedAffiliated = [...affiliated].sort(byLoyalty);
    }
    return [...unaffiliated, ...sortedAffiliated];
  }, [state, tab]);

  return (
    <div
      className="modal-backdrop"
      data-testid="talent-target-picker"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
      onContextMenu={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onClose();
      }}
    >
      <section className="talent-target-dialog tool-panel" role="dialog" aria-modal="true" aria-labelledby="talent-target-title">
        <header className="talent-target-header">
          <h2 id="talent-target-title">选择对象武将</h2>
          <button type="button" className="icon-button" aria-label="关闭" title="关闭" onClick={onClose}><X /></button>
        </header>

        <div className="talent-target-tabs" role="tablist" aria-label="列表排序">
          {TALENT_TARGET_TABS.map((item) => (
            <button
              key={item}
              type="button"
              role="tab"
              aria-selected={tab === item}
              className={tab === item ? 'is-active' : ''}
              onClick={() => setTab(item)}
            >
              {item}
            </button>
          ))}
        </div>

        <div className="talent-target-scroll">
          <table className="talent-target-table">
            <thead>
              <tr>
                <th scope="col">武将</th>
                <th scope="col">势力</th>
                <th scope="col">身份</th>
                <th scope="col">忠诚</th>
                <th scope="col">所属</th>
                <th scope="col">所在</th>
                <th scope="col">履行</th>
                <th scope="col">统率</th>
                <th scope="col">武力</th>
                <th scope="col">智力</th>
                <th scope="col">政治</th>
                <th scope="col">魅</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((officer) => {
                const isMonarch = officer.forceId !== null && state.forces[officer.forceId]?.leaderId === officer.id;
                const forceName = officer.forceId ? state.forces[officer.forceId]?.name ?? '—' : '';
                return (
                  <tr
                    key={officer.id}
                    className={[
                      'talent-target-row',
                      isMonarch ? 'is-monarch' : '',
                      officer.id === selectedId ? 'is-selected' : '',
                      officer.forceId === null ? 'is-unaffiliated' : '',
                    ].join(' ').trim()}
                  onClick={isMonarch ? undefined : () => onPick(officer.id)}
                  data-testid={`talent-target-${officer.id}`}
                >
                  <td className="talent-name">{officer.name}</td>
                  <td>{forceName}</td>
                  <td>{identityOf(state, officer)}</td>
                  <td>{officer.forceId === null ? '---' : officerLoyalty(officer)}</td>
                  <td>{stationName(state, officer)}</td>
                  <td>{whereaboutOf(state, officer)}</td>
                  <td className="talent-ok">{isMonarch ? '×' : '○'}</td>
                  <td>{officer.stats.leadership}</td>
                  <td>{officer.stats.war}</td>
                  <td>{officer.stats.intelligence}</td>
                  <td>{officer.stats.politics}</td>
                  <td>{officer.stats.charisma}</td>
                </tr>
              );
            })}
            </tbody>
          </table>
          {rows.length === 0 && <p className="talent-target-empty">没有可登庸的武将</p>}
        </div>

        <footer className="talent-target-footer">
          <span className="talent-target-hint">在野武将排最上 · 点击行即选定 · 君主（×）不可登庸</span>
          <button type="button" className="secondary-button" onClick={onClose}>返回</button>
        </footer>
      </section>
    </div>
  );
}
