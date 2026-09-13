import { X } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { AudioEventAdapter } from '../audio/reactAudioEventAdapter';
import { officerSkillsText } from '../game/skills';
import type { Officer, OfficerAptitudes, Stats } from '../game/types';
import { OfficerHealthBadge } from './OfficerHealthBadge';
import { closePopupOnContextMenu } from './popupEvents';

/**
 * 「武将一览」编制选择页：出征编制与输送编制共用（**主将 / 副将 ×2** 的编制式选将）。
 *
 * 与 `OfficerPickerDialog`（勾选式「执行武将」弹窗，用于内政共同执行）语汇不同，故单独成组件。
 * 从 `DeployDialog` 抽出：输送队原本只用下拉框选一名武将，改成与出征一致的主将 + 副将编制后，
 * 两处需求完全相同。页面只负责「选谁」，编制上限、是否允许重复、已行动武将可否操作
 * 都由调用方通过 `selectedIds` / `onLeader` / `onDeputy` 表达。
 */

export type FormationPickerView = 'ability' | 'skill' | 'aptitude';
export type FormationPickerSortDirection = 'desc' | 'asc';
export type FormationPickerSortKey = 'name' | keyof Stats | 'skill' | keyof OfficerAptitudes;

export interface FormationPickerColumn {
  label: string;
  sortKey: FormationPickerSortKey;
}

/** 编制上限：1 名主将 + 2 名副将 */
export const FORMATION_OFFICER_MAX = 3;

const FORMATION_PICKER_TABS: Array<{ id: FormationPickerView; label: string }> = [
  { id: 'ability', label: '能力' },
  { id: 'skill', label: '特技' },
  { id: 'aptitude', label: '适性' },
];

/** 武将缺适性字段时的兜底档位（与 `officerAbilities.DEFAULT_OFFICER_APTITUDES` 同口径） */
export const fallbackAptitudes: OfficerAptitudes = { spear: 'B', halberd: 'B', crossbow: 'B', cavalry: 'B', siege: 'C', navy: 'C' };

/** 适性档位 → 可比较的序号（越大越好） */
export const aptitudeRank: Record<OfficerAptitudes[keyof OfficerAptitudes], number> = {
  'S++': 6,
  'S+': 5,
  S: 4,
  A: 3,
  B: 2,
  C: 1,
};

function columnsForPicker(activeView: FormationPickerView): FormationPickerColumn[] {
  if (activeView === 'ability') return [
    { label: '武将', sortKey: 'name' },
    { label: '统帅', sortKey: 'leadership' },
    { label: '武力', sortKey: 'war' },
    { label: '智力', sortKey: 'intelligence' },
    { label: '政治', sortKey: 'politics' },
    { label: '魅力', sortKey: 'charisma' },
  ];
  if (activeView === 'skill') return [
    { label: '武将', sortKey: 'name' },
    { label: '特技', sortKey: 'skill' },
  ];
  return [
    { label: '武将', sortKey: 'name' },
    { label: '枪', sortKey: 'spear' },
    { label: '戟', sortKey: 'halberd' },
    { label: '弩', sortKey: 'crossbow' },
    { label: '骑', sortKey: 'cavalry' },
    { label: '兵器', sortKey: 'siege' },
    { label: '水军', sortKey: 'navy' },
  ];
}

function pickerSortValue(officer: Officer, sortKey: FormationPickerSortKey) {
  if (sortKey === 'name') return officer.name;
  if (sortKey === 'skill') return officerSkillsText(officer);
  if (sortKey in fallbackAptitudes) {
    const aptitudes = officer.aptitudes ?? fallbackAptitudes;
    return aptitudeRank[aptitudes[sortKey as keyof OfficerAptitudes]];
  }
  return officer.stats[sortKey as keyof Stats];
}

function comparePickerSortValues(left: string | number, right: string | number, direction: FormationPickerSortDirection) {
  const result = typeof left === 'number' && typeof right === 'number'
    ? left - right
    : String(left).localeCompare(String(right));
  return direction === 'desc' ? -result : result;
}

export interface FormationOfficerPickerProps {
  officers: Officer[];
  selectedIds: string[];
  /** 页面副标题（如「出征人员编制」/「输送人员编制」） */
  subtitle: string;
  /** 列表区无障碍标签（如「可出征武将」/「可押运武将」） */
  listLabel: string;
  onLeader(id: string): void;
  onDeputy(id: string): void;
  onConfirm(): void;
  onBack(): void;
  audio: AudioEventAdapter;
}

export function FormationOfficerPicker({
  officers,
  selectedIds,
  subtitle,
  listLabel,
  onLeader,
  onDeputy,
  onConfirm,
  onBack,
  audio,
}: FormationOfficerPickerProps) {
  const leaderId = selectedIds[0];
  const deputyIds = selectedIds.slice(1);
  const canConfirm = Boolean(leaderId);
  const [activeView, setActiveView] = useState<FormationPickerView>('ability');
  const [sort, setSort] = useState<{ key: FormationPickerSortKey; direction: FormationPickerSortDirection } | null>(null);

  const columns = columnsForPicker(activeView);
  const sortedOfficers = useMemo(() => {
    if (!sort) return officers;
    return [...officers].sort((left, right) => (
      comparePickerSortValues(
        pickerSortValue(left, sort.key),
        pickerSortValue(right, sort.key),
        sort.direction,
      ) ||
      left.name.localeCompare(right.name) ||
      left.id.localeCompare(right.id)
    ));
  }, [officers, sort]);
  const changeView = (view: FormationPickerView) => {
    setActiveView(view);
    setSort(null);
  };
  const sortBy = (sortKey: FormationPickerSortKey) => {
    setSort((current) => (
      current?.key === sortKey
        ? { key: sortKey, direction: current.direction === 'desc' ? 'asc' : 'desc' }
        : { key: sortKey, direction: 'desc' }
    ));
  };

  const renderOfficerCells = (officer: Officer) => {
    if (activeView === 'ability') {
      return (
        <>
          <span>{officer.stats.leadership}</span>
          <span>{officer.stats.war}</span>
          <span>{officer.stats.intelligence}</span>
          <span>{officer.stats.politics}</span>
          <span>{officer.stats.charisma}</span>
        </>
      );
    }
    if (activeView === 'skill') {
      return <span>{officerSkillsText(officer)}</span>;
    }
    const aptitudes = officer.aptitudes ?? fallbackAptitudes;
    return (
      <>
        <span>{aptitudes.spear}</span>
        <span>{aptitudes.halberd}</span>
        <span>{aptitudes.crossbow}</span>
        <span>{aptitudes.cavalry}</span>
        <span>{aptitudes.siege}</span>
        <span>{aptitudes.navy}</span>
      </>
    );
  };

  return (
    <div className="modal-backdrop" onContextMenu={(event) => closePopupOnContextMenu(event, onBack, audio)}>
      <section className="deploy-dialog officer-picker-dialog tool-panel" role="dialog" aria-modal="true" aria-labelledby="officer-picker-title">
        <header>
          <div>
            <p>{subtitle}</p>
            <h2 id="officer-picker-title">武将选择</h2>
          </div>
          <button type="button" className="icon-button" aria-label="关闭武将选择" title="关闭" onClick={onBack}><X /></button>
        </header>

        <section className="officer-picker-selected" aria-label="已选武将">
          <div className="officer-slot is-leader"><span>主将</span><strong>{officers.find((officer) => officer.id === leaderId)?.name ?? '未选择'}</strong></div>
          <div className="officer-slot"><span>副将 1</span><strong>{officers.find((officer) => officer.id === deputyIds[0])?.name ?? '未选择'}</strong></div>
          <div className="officer-slot"><span>副将 2</span><strong>{officers.find((officer) => officer.id === deputyIds[1])?.name ?? '未选择'}</strong></div>
        </section>

        <div className="officer-picker-tabs" role="tablist" aria-label="武将显示切换">
          {FORMATION_PICKER_TABS.map((tab) => (
            <button key={tab.id} type="button" className={activeView === tab.id ? 'is-active' : undefined} onClick={() => changeView(tab.id)}>
              {tab.label}
            </button>
          ))}
        </div>

        <section className={`officer-picker-table is-${activeView}`} aria-label={listLabel}>
          <div className="officer-picker-heading">
            {columns.map((column) => {
              const active = sort?.key === column.sortKey;
              return (
                <button
                  key={column.sortKey}
                  type="button"
                  aria-label={`按${column.label}排序`}
                  className={active ? 'is-active' : undefined}
                  onClick={() => sortBy(column.sortKey)}
                >
                  {column.label}{active ? (sort.direction === 'desc' ? ' ↓' : ' ↑') : ''}
                </button>
              );
            })}
            <span>编制</span>
          </div>
          {sortedOfficers.map((officer) => {
            const selected = selectedIds.includes(officer.id);
            const isLeader = leaderId === officer.id;
            const isDeputy = deputyIds.includes(officer.id);
            return (
              <div className={`officer-picker-row${selected ? ' is-selected' : ''}${officer.acted ? ' is-acted' : ''}`} key={officer.id}>
                <strong>{officer.name}<OfficerHealthBadge officer={officer} /></strong>
                {renderOfficerCells(officer)}
                <div className="officer-picker-actions">
                  <button type="button" aria-label={`选择${officer.name}为主将`} disabled={officer.acted} className={isLeader ? 'is-active' : undefined} onClick={() => onLeader(officer.id)}>主将</button>
                  <button type="button" aria-label={`选择${officer.name}为副将`} disabled={officer.acted || isLeader || (selectedIds.length >= FORMATION_OFFICER_MAX && !isDeputy)} className={isDeputy ? 'is-active' : undefined} onClick={() => onDeputy(officer.id)}>{isDeputy ? '取消' : '副将'}</button>
                </div>
              </div>
            );
          })}
        </section>

        <footer>
          <button type="button" className="secondary-button" onClick={onBack}>返回</button>
          <button type="button" className="primary-button" disabled={!canConfirm} onClick={onConfirm}>确定武将</button>
        </footer>
      </section>
    </div>
  );
}
