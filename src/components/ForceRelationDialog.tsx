import { X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react';
import { ARMAMENT_LABELS } from '../game/armaments';
import { forceRelationView, forceXing, type ForceRelationView } from '../game/diplomacy';
import { forceIntelOf, type ForceIntel } from '../game/forceIntel';
import type { ArmamentType, ForceId, GameState } from '../game/types';

/**
 * 「选择对象势力」页（参考原版外交的势力一览窗口）：
 * 列出除我方外的所有势力与我方的关系（交情档位 / 关系 / 停战期间 / 友好度 / 履行），
 * 点击任意一行即把该势力带回外交指令页，与「返回」等价关闭。
 *
 * 顶部标签页对应原版「势力情报」的分类：本作只保留有真实数据支撑的 7 类，
 * 其余（设施 / 研究 / 各兵科）本作没有对应概念，不伪造空白标签。
 */

type ForceTabKey = 'object' | 'status' | 'power' | 'armament' | 'diplomacy' | 'gold' | 'food';

interface ForceTabColumn {
  key: string;
  label: string;
  /** 列宽（CSS 长度；缺省由表格自动分配） */
  width?: string;
  align?: 'left' | 'center' | 'right';
}

interface ForceTabDefinition {
  key: ForceTabKey;
  label: string;
  columns: ForceTabColumn[];
}

/**
 * 姓名列固定占 26%，其余列不设宽度 —— 表格用 `table-layout: fixed`，
 * 未指定宽度的列平分剩余空间，正好得到「姓名略宽、数值列等宽」的原版观感。
 * （注意不能用 `fr`：表格布局不认 flex 单位，写了等于没写。）
 */
const NAME_COLUMN: ForceTabColumn = { key: 'name', label: '姓名', width: '26%' };

/** 兵装列顺序：枪/戟/弩/军马 在前，舰船器械在后（与原版一览表一致） */
const ARMAMENT_COLUMN_ORDER: ArmamentType[] = ['spear', 'halberd', 'crossbow', 'cavalry', 'ship', 'ram', 'tower'];

export const FORCE_TABS: ForceTabDefinition[] = [
  {
    key: 'object',
    label: '对象',
    columns: [
      NAME_COLUMN,
      { key: 'tier', label: '交情', align: 'center' },
      { key: 'relation', label: '关系', align: 'center' },
      { key: 'truce', label: '停战期间', align: 'center' },
      { key: 'friendly', label: '友好度', align: 'right' },
      { key: 'honored', label: '履行', align: 'center' },
    ],
  },
  {
    key: 'status',
    label: '状态',
    columns: [
      NAME_COLUMN,
      { key: 'cities', label: '城池', align: 'center' },
      { key: 'passes', label: '关隘', align: 'center' },
      { key: 'officers', label: '武将', align: 'center' },
      { key: 'morale', label: '士气', align: 'center' },
      { key: 'rank', label: '爵位', align: 'center' },
      { key: 'alive', label: '状态', align: 'center' },
    ],
  },
  {
    key: 'power',
    label: '战力',
    columns: [
      NAME_COLUMN,
      { key: 'cityTroops', label: '守军', align: 'right' },
      { key: 'units', label: '部队', align: 'center' },
      { key: 'unitTroops', label: '野战兵', align: 'right' },
      { key: 'troops', label: '合计兵力', align: 'right' },
    ],
  },
  {
    key: 'armament',
    label: '兵装',
    columns: [
      NAME_COLUMN,
      ...ARMAMENT_COLUMN_ORDER.map((type) => ({
        key: `armament-${type}`,
        label: ARMAMENT_LABELS[type],
        align: 'right' as const,
      })),
    ],
  },
  {
    key: 'diplomacy',
    label: '外交',
    columns: [
      NAME_COLUMN,
      { key: 'xing', label: '相性', align: 'center' },
      { key: 'compat', label: '相性差', align: 'center' },
      { key: 'tier', label: '交情', align: 'center' },
      { key: 'relation', label: '关系', align: 'center' },
      { key: 'friendly', label: '友好度', align: 'right' },
    ],
  },
  {
    key: 'gold',
    label: '资金',
    columns: [
      NAME_COLUMN,
      { key: 'cityGold', label: '城池', align: 'right' },
      { key: 'passGold', label: '关隘', align: 'right' },
      { key: 'gold', label: '合计', align: 'right' },
    ],
  },
  {
    key: 'food',
    label: '兵粮',
    columns: [
      NAME_COLUMN,
      { key: 'cityFood', label: '城池', align: 'right' },
      { key: 'passFood', label: '关隘', align: 'right' },
      { key: 'food', label: '合计', align: 'right' },
    ],
  },
];

function formatNumber(value: number): string {
  return value.toLocaleString('en-US');
}

/** 友好度显示：与原版一致取 `0 ~ 100`，`50` 为中立，故不带到正负号 */
function formatFriendly(value: number): string {
  return String(value);
}

function tierTone(tier: ForceRelationView['tier']): 'good' | 'neutral' | 'bad' {
  if (tier === 'intimate' || tier === 'friendly') return 'good';
  if (tier === 'neutral') return 'neutral';
  return 'bad';
}

/** 无外交关系时留白（「—」），与原版一览表的空单元格同义 */
function relationCell(relation: ForceRelationView): string {
  return relation.relationLabel === '中立' ? '—' : relation.relationLabel;
}

function nameCell(intel: ForceIntel): ReactNode {
  return (
    <>
      <span className="force-select-name">{intel.leaderName}</span>
      {intel.name !== intel.leaderName && <small className="force-select-sub">{intel.name}</small>}
    </>
  );
}

function tierCell(relation: ForceRelationView): ReactNode {
  return <em className={`force-tier is-${tierTone(relation.tier)}`}>{relation.tierLabel}</em>;
}

function cellsFor(tab: ForceTabKey, intel: ForceIntel, relation: ForceRelationView, xing: number): ReactNode[] {
  switch (tab) {
    case 'object':
      return [
        nameCell(intel),
        tierCell(relation),
        relationCell(relation),
        relation.truceTenDays > 0 ? `${relation.truceTenDays}旬` : '—',
        formatFriendly(relation.friendly),
        relation.honored ? '✓' : '✕',
      ];
    case 'status':
      return [
        nameCell(intel),
        intel.cityCount,
        intel.passCount,
        intel.officerCount,
        intel.morale,
        intel.rankLabel,
        intel.alive ? '存续' : '灭亡',
      ];
    case 'power':
      return [
        nameCell(intel),
        formatNumber(intel.cityTroops),
        intel.unitCount,
        formatNumber(intel.unitTroops),
        formatNumber(intel.troops),
      ];
    case 'armament':
      return [
        nameCell(intel),
        ...ARMAMENT_COLUMN_ORDER.map((type) => formatNumber(intel.armaments[type])),
      ];
    case 'diplomacy':
      return [
        nameCell(intel),
        xing,
        relation.compatibleDiff,
        tierCell(relation),
        relationCell(relation),
        formatFriendly(relation.friendly),
      ];
    case 'gold':
      return [nameCell(intel), formatNumber(intel.cityGold), formatNumber(intel.passGold), formatNumber(intel.gold)];
    case 'food':
      return [nameCell(intel), formatNumber(intel.cityFood), formatNumber(intel.passFood), formatNumber(intel.food)];
    default:
      return [];
  }
}

export interface ForceRelationDialogProps {
  state: GameState;
  /** 当前已选中的外交对象（打开时高亮并定位光标） */
  selectedForceId: ForceId | '';
  onPick(forceId: ForceId): void;
  onClose(): void;
}

export function ForceRelationDialog({ state, selectedForceId, onPick, onClose }: ForceRelationDialogProps) {
  const playerForceId = state.playerForceId;
  // 默认停在「对象」分类 —— 与原版外交打开即看关系一览一致
  const [tab, setTab] = useState<ForceTabKey>('object');
  const dialogRef = useRef<HTMLDivElement>(null);

  /** 势力行：存续的排在前面，其余保持 state.forces 的原始顺序（排序稳定） */
  const rows = useMemo(() => {
    const list = (Object.keys(state.forces) as ForceId[])
      .filter((id) => id !== playerForceId)
      .map((id) => ({
        key: id,
        intel: forceIntelOf(state, id),
        relation: forceRelationView(state, playerForceId, id),
        xing: forceXing(state, id),
      }));
    return list.sort((a, b) => Number(b.intel.alive) - Number(a.intel.alive));
  }, [state, playerForceId]);

  const activeTab = FORCE_TABS.find((item) => item.key === tab) ?? FORCE_TABS[0];
  const selectableRows = rows.filter((row) => row.intel.alive);
  const selectedKey = selectedForceId || selectableRows[0]?.key || '';
  const [cursorKey, setCursorKey] = useState<ForceId | ''>(selectedKey);
  // 势力灭亡等导致行变化时，把光标拉回一个仍可选项
  const cursor = selectableRows.some((row) => row.key === cursorKey) ? cursorKey : selectedKey;

  useEffect(() => {
    const target = dialogRef.current?.querySelector<HTMLElement>('.force-select-row.is-cursor');
    (target ?? dialogRef.current)?.focus();
  }, []);

  const focusRow = (forceId: ForceId) => {
    setCursorKey(forceId);
    dialogRef.current?.querySelector<HTMLElement>(`[data-force-id="${forceId}"]`)?.focus();
  };

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      onClose();
      return;
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      if (selectableRows.length === 0) return;
      event.preventDefault();
      const current = Math.max(0, selectableRows.findIndex((row) => row.key === cursor));
      const step = event.key === 'ArrowDown' ? 1 : -1;
      const next = selectableRows[(current + step + selectableRows.length) % selectableRows.length];
      focusRow(next.key);
      return;
    }
    if (event.key === 'Enter' && cursor) {
      event.preventDefault();
      onPick(cursor);
    }
  };

  return (
    <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div
        ref={dialogRef}
        className="force-select-dialog tool-panel"
        role="dialog"
        aria-modal="true"
        aria-label="选择对象势力"
        tabIndex={-1}
        onKeyDown={handleKeyDown}
      >
        <header>
          <div>
            <p>外交 · 点击势力即选定交涉对象</p>
            <h2>选择对象势力</h2>
          </div>
          <button type="button" className="icon-button" aria-label="关闭势力一览" title="关闭" onClick={onClose}><X /></button>
        </header>

        <div className="force-select-tabs" role="tablist" aria-label="势力情报分类">
          {FORCE_TABS.map((item) => (
            <button
              key={item.key}
              type="button"
              role="tab"
              aria-selected={tab === item.key}
              className={tab === item.key ? 'is-active' : ''}
              onClick={() => setTab(item.key)}
            >
              {item.label}
            </button>
          ))}
        </div>

        <div className="force-select-table-wrap">
          <table className="force-select-table" aria-label={`势力${activeTab.label}一览`}>
            <thead>
              <tr>
                {activeTab.columns.map((column) => (
                  <th
                    key={column.key}
                    scope="col"
                    className={`is-${column.align ?? 'left'}`}
                    style={column.width ? { width: column.width } : undefined}
                  >
                    {column.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map(({ key, intel, relation, xing }) => {
                const pickable = intel.alive;
                const isSelected = pickable && key === selectedKey;
                return (
                  <tr
                    key={key}
                    data-force-id={key}
                    tabIndex={pickable ? 0 : -1}
                    aria-selected={isSelected}
                    className={[
                      'force-select-row',
                      isSelected ? 'is-selected' : '',
                      pickable && key === cursor ? 'is-cursor' : '',
                      pickable ? '' : 'is-defunct',
                    ].filter(Boolean).join(' ')}
                    onClick={() => pickable && onPick(key)}
                    onMouseEnter={() => pickable && setCursorKey(key)}
                    title={pickable
                      ? `选择 ${intel.name}（${relation.tierLabel} · 友好度 ${formatFriendly(relation.friendly)}）`
                      : `${intel.name} 已被灭亡`}
                  >
                    {cellsFor(tab, intel, relation, xing).map((cell, index) => {
                      const column = activeTab.columns[index];
                      return (
                        <td key={column.key} className={`is-${column.align ?? 'left'}`}>{cell}</td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="command-note">
          交情按友好度分档：亲密 ≥80、友好 60~79、中立 40~59、不和 20~39、险恶 ＜20；
          亲善、同盟成败与破盟都会改变友好度。停战期间以旬计（3旬＝1个月），「履行」表示当前是否存在有效盟约。
        </div>

        <footer>
          <button type="button" className="secondary-button" onClick={onClose}>返回</button>
        </footer>
      </div>
    </div>
  );
}
