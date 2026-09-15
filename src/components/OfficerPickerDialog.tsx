import { X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { OfficerListTable, type OfficerListTab } from './OfficerListDialog';
import type { City, Officer, Pass } from '../game/types';

interface OfficerPickerDialogProps {
  /** 可选武将（本城待命、未行动，调用方已按相关能力排序） */
  officers: Officer[];
  /** 弹窗标题（默认「选择执行武将」，流放等特殊场合可自定义） */
  title?: string;
  /** 已选中的武将id */
  selectedIds: string[];
  /** 最多可选人数（默认3） */
  max?: number;
  /** 最少可选人数（达到该人数前确定按钮禁用，用于婚姻固定两人） */
  min?: number;
  /** 性别规则（婚姻/结义用）：
   *   'same'：已选某性别后仅可继续选相同性别（结义 2~3 同性）
   *   'opposite'：已选某性别后仅可继续选相反性别（婚姻须一男一女）
   */
  genderRule?: 'same' | 'opposite';
  /** 额外禁用（不可勾选）的武将 id（如太守），与性别规则锁定合并 */
  disabledOfficerIds?: Set<string>;
  /** 顶部说明（如"政治影响效果，已按政治降序排列"） */
  hint?: string;
  /** 左下角显示"一并/一并解除"按钮（一并=全选；解除=清空，可选） */
  selectAllable?: boolean;
  /** 一并最多勾选的人数上限（默认全部；探索按行动力上限传入） */
  selectAllLimit?: number;
  /** 可选：显示的分类 tab 列表（默认全部 5 类；自定义时传入并让奖赏放最前） */
  tabs?: OfficerListTab[];
  /** 初始选中的 tab（默认"能力"） */
  initialTab?: OfficerListTab;
  /** 召唤目标据点（启用"召唤"分类时用于计算各武将召唤日数） */
  summonTarget?: City | Pass;
  /** 计略目标据点（启用"计略"分类时用于评估各武将流言成功率与军师推荐） */
  tacticTarget?: City | Pass;
  /**
   * 选择方式：'multi'（默认，勾选框 + 确定按钮，可共同执行）
   * 或 'single'（无勾选框列，点击某一行即选定并立即返回，用于外交出使等只派一人的场合）。
   */
  pickMode?: 'multi' | 'single';
  onConfirm(ids: string[]): void;
  onClose(): void;
}

/** 执行武将勾选弹窗：复用武将一览的 tab + 可排序列 + checkbox，勾选 1~3 名武将共同执行指令 */
export function OfficerPickerDialog({ officers, title = '选择执行武将', selectedIds, max = 3, min = 0, genderRule, hint, disabledOfficerIds, selectAllable, selectAllLimit, tabs, initialTab, summonTarget, tacticTarget, pickMode = 'multi', onConfirm, onClose }: OfficerPickerDialogProps) {
  const [picked, setPicked] = useState<string[]>(() => selectedIds.filter((id) => officers.some((officer) => officer.id === id)));
  const dialogRef = useRef<HTMLDivElement>(null);
  const single = pickMode === 'single';

  const pickedSet = useMemo(() => new Set(picked), [picked]);

  /** 按性别规则锁定：已选某性别后，根据 same/opposite 决定禁止继续勾选的性别；并与额外禁用合并 */
  const disabledIds = useMemo(() => {
    const base = new Set<string>();
    for (const id of disabledOfficerIds ?? []) base.add(id);
    const roleModels = officers.filter((o) => picked.includes(o.id));
    if (roleModels.length === 0 || !genderRule) return base;
    const first = roleModels[0].gender ?? 'male';
    const lockout = genderRule === 'same' ? (first === 'male' ? 'female' : 'male') : first;
    for (const o of officers) if ((o.gender ?? 'male') === lockout) base.add(o.id);
    return base;
  }, [genderRule, officers, picked, disabledOfficerIds]);

  useEffect(() => {
    const root = dialogRef.current;
    if (!root) return;
    // 单选模式没有勾选框：把焦点落在弹窗本身，保证 Esc 关闭仍然可用
    (root.querySelector<HTMLElement>('input[type="checkbox"]:not([disabled])') ?? root).focus();
  }, []);

  const toggle = (id: string) => {
    if (disabledIds.has(id)) return;
    setPicked((current) => current.includes(id)
      ? current.filter((item) => item !== id)
      : [...current, id]);
  };

  // 一并：按传入顺序勾选（跳过不可选的），直至填满上限（默认全部）
  const selectAll = () => {
    const limit = Math.min(selectAllLimit ?? officers.length, officers.length);
    const list: string[] = [];
    for (const officer of officers) {
      if (list.length >= limit) break;
      if (disabledIds.has(officer.id)) continue;
      list.push(officer.id);
    }
    setPicked(list);
  };

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
    }
  };

  return (
    <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div ref={dialogRef} className="executor-picker-dialog tool-panel" role="dialog" aria-modal="true" aria-label={title} tabIndex={-1} onKeyDown={handleKeyDown}>
        <header>
          <div>
            <p>{single ? '点击武将即选定并返回' : '可共同执行，人数越多效果越强'}</p>
            <h2>{single ? title : `${title}（${picked.length}/${max}）`}</h2>
          </div>
          <button type="button" className="icon-button" aria-label="关闭选择" title="关闭" onClick={onClose}><X /></button>
        </header>
        {hint && <div className="executor-picker-hint">{hint}</div>}
        {officers.length === 0 ? (
          <div className="command-note">本城没有待命的武将</div>
        ) : (
          <OfficerListTable
            officerIds={officers.map((o) => o.id)}
            initialTab={initialTab ?? '能力'}
            tabs={tabs}
            summonTarget={summonTarget}
            tacticTarget={tacticTarget}
            checkboxes={single ? undefined : {
              checked: pickedSet,
              max,
              disabledIds,
              onToggle: toggle,
            }}
            onRowPick={single ? (officer) => onConfirm([officer.id]) : undefined}
          />
        )}
        <footer>
          {!single && selectAllable && (
            <div className="executor-picker-select-all">
              <button type="button" className="explore-select-all" onClick={selectAll}>一并</button>
              <button type="button" className="explore-select-all" onClick={() => setPicked([])}>一并解除</button>
            </div>
          )}
          <button type="button" className="secondary-button" onClick={onClose}>返回</button>
          {!single && (
            <button
              type="button"
              className="primary-button"
              disabled={picked.length < min || picked.length === 0}
              onClick={() => onConfirm(picked)}
            >
              确定（{picked.length}人）
            </button>
          )}
        </footer>
      </div>
    </div>
  );
}
