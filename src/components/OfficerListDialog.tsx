import { X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useAudioEventAdapter } from '../audio/reactAudioEventAdapter';
import { useGame } from '../game/store/GameProvider';
import { ARMAMENT_LABELS } from '../game/armaments';
import { officerAge, oldAgeDeathChance } from '../game/health';
import { officerLoyalty } from '../game/loyalty';
import { affinityOf, officerCompatWithRuler } from '../game/diplomacy';
import { hasMasterHearts } from '../game/techs';
import { officerMerit, positionDefinition } from '../game/ranks';
import { PLOT_LABELS } from '../game/innerAffairs';
import { TECH_BRANCH_LABELS } from '../game/techs';
import { skillDefinition, officerSkillNames, officerSkillsText } from '../game/skills';
import type { ForceId, GameState, Officer, OfficerAptitudes, Stats } from '../game/types';
import { OfficerHealthBadge } from './OfficerHealthBadge';
import { OfficerDetailDialog } from './OfficerDetailDialog';
import { closePopupOnContextMenu } from './popupEvents';

interface OfficerListDialogProps {
  scope?: 'player' | 'all' | { forceId: ForceId };
  officerIds?: string[];
  onClose(): void;
}

/** 可复用的武将列表表格：tab 切换 + 可排序列 + 可选 checkbox 列。
 *  不包含 modal 外壳和标题，调用方自己套。 */
export interface OfficerListTableProps {
  /** 可选：scope 过滤（与 OfficerListDialog 保持一致） */
  scope?: 'player' | 'all' | { forceId: ForceId };
  /** 可选：指定要显示的武将列表（优先级高于 scope） */
  officerIds?: string[];
  /** 可选：显示的分类 tab 列表（默认全部 5 类；如需自定义如奖赏页可传入，奖赏放最前） */
  tabs?: OfficerListTab[];
  /** 初始选中的 tab（默认"所属"，若指定 officerIds 则默认"能力"） */
  initialTab?: OfficerListTab;
  /** 可选：checkbox 配置，启用后第一列为勾选框 */
  checkboxes?: {
    /** 已选中的 id 集合 */
    checked: ReadonlySet<string>;
    /** 最多可选人数（超出时其他选项禁用） */
    max?: number;
    /** 禁用的武将 id 集合（不可勾选） */
    disabledIds?: ReadonlySet<string>;
    /** 勾选/取消时回调 */
    onToggle: (id: string) => void;
  };
  /** 表格容器 data-testid */
  testId?: string;
  /** 可选：点击武将名时回调（用于打开武将详情）；未提供则武将名不可点 */
  onRowClick?: (officer: Officer) => void;
}

export type OfficerListTab = '奖赏' | '所属' | '能力' | '特技' | '适性' | '状态';
type SortDirection = 'desc' | 'asc';
type SortKey =
  | 'name'
  | 'age'
  | 'force'
  | 'homeCity'
  | 'loyalty'
  | 'xing'
  | 'location'
  | 'position'
  | 'merit'
  | keyof Stats
  | 'skill'
  | 'skillDescription'
  | keyof OfficerAptitudes
  | 'status'
  | 'task'
  | 'time'
  | 'gender';

interface OfficerColumn {
  label: string;
  sortKey: SortKey;
}

const officerListTabs: OfficerListTab[] = ['所属', '能力', '特技', '适性', '状态'];
const fallbackAptitudes: OfficerAptitudes = {
  spear: 'B',
  halberd: 'B',
  crossbow: 'B',
  cavalry: 'B',
  siege: 'C',
  navy: 'C',
};
const aptitudeRank: Record<OfficerAptitudes[keyof OfficerAptitudes], number> = {
  S: 4,
  A: 3,
  B: 2,
  C: 1,
};

function scopeIsAll(scope: OfficerListDialogProps['scope']) {
  return scope === 'all';
}

function locationText(officer: Officer, state: GameState) {
  if (officer.location.kind === 'city') return state.cities[officer.location.cityId].name;
  if (officer.location.kind === 'unit') return '部队';
  if (officer.location.kind === 'transfer') return '在途';
  return state.cities[officer.location.cityId].name;
}

function homeCityText(officer: Officer, state: GameState) {
  return state.cities[officer.cityId]?.name ?? '—';
}

function ownershipText(officer: Officer, state: GameState) {
  return officer.forceId ? `${state.forces[officer.forceId].name}军` : '在野';
}

function ageText(officer: Officer, state: GameState) {
  const age = officerAge(state, officer);
  if (age === null) return '—';
  return officer.deathMonth !== undefined ? `终年${age}` : `${age}岁`;
}

/** 寿终风险悬停提示：58 岁起有月度风险（强运免疫） */
function ageCell(officer: Officer, state: GameState) {
  const age = officerAge(state, officer);
  if (age === null) return <td>—</td>;
  const risk = age >= 58 ? oldAgeDeathChance(age) : 0;
  return (
    <td className={risk > 0 && officer.deathMonth === undefined ? 'is-elder' : undefined} title={risk > 0 ? `58 岁起每月寿终风险 ${Math.round(risk * 100)}%（强运免疫）` : undefined}>
      {ageText(officer, state)}
    </td>
  );
}

export function taskInfo(officer: Officer, state: GameState) {
  if (officer.location.kind === 'transfer') {
    const from = state.cities[officer.location.fromCityId].name;
    const target = state.cities[officer.location.targetCityId].name;
    return {
      status: '执行中',
      task: `移动 ${from}→${target}`,
      time: `${officer.location.remainingTenDays}旬`,
    };
  }
  if (officer.location.kind === 'unit') {
    const unit = state.units[officer.location.unitId];
    if (!unit) return { status: '', task: '', time: '' };
    return {
      status: '执行中',
      task: unit.kind === 'transport' ? '输送' : '出征',
      time: '进行中',
    };
  }
  if (officer.location.kind === 'task') {
    const taskLabel = officer.location.task === 'research'
      ? `研究${TECH_BRANCH_LABELS[officer.location.branch]}系科技`
      : officer.location.task === 'cultivate'
        ? `培育能力`
        : officer.location.task === 'construction'
          ? `建设${PLOT_LABELS[officer.location.facility]}`
          : `生产${ARMAMENT_LABELS[officer.location.armamentType]}`;
    return {
      status: '执行中',
      task: taskLabel,
      time: `${officer.location.remainingTenDays}旬`,
    };
  }
  // 城内武将：正在建设设施 → 执行中；否则按已行动/待命显示
  if (officer.location.kind === 'city') {
    const constructingPlot = (state.cities[officer.location.cityId].plots ?? [])
      .find((plot) => plot?.constructing?.officerIds?.includes(officer.id));
    if (constructingPlot?.constructing) {
      return {
        status: '执行中',
        task: `建设${PLOT_LABELS[constructingPlot.constructing.facility]}`,
        time: `${constructingPlot.constructing.remainingTenDays}旬`,
      };
    }
    return {
      status: officer.acted ? '已行动' : '待命',
      task: '',
      time: '',
    };
  }
  return { status: '', task: '', time: '' };
}

/** 该武将是否为其所在势力的君主 */
function isForceLeader(officer: Officer, state: GameState): boolean {
  return !!officer.forceId && officer.id === state.forces[officer.forceId]?.leaderId;
}

/** 忠诚 hover 详情：相性/相性差/亲恶/掉忠原因（仅对有势力武将展示） */
function loyaltyHint(officer: Officer, state: GameState): string | undefined {
  if (!officer.forceId) return undefined;
  // 君主不参与忠诚系统，其忠诚项显示“-”
  if (officer.id === state.forces[officer.forceId]?.leaderId) return '君主不参与忠诚系统';
  const lines: string[] = [`忠诚 ${officerLoyalty(officer)}`];
  const { diff, tier } = officerCompatWithRuler(state, officer, officer.forceId);
  lines.push(`相性 ${affinityOf(state, officer)} · 与君主相性差 ${diff}（${tier.label}）`);

  const rulerId = state.forces[officer.forceId]?.leaderId;
  if (rulerId && (officer.likes ?? []).includes(rulerId)) lines.push('亲爱君主，忠诚稳定');
  const dislikesRuler = rulerId !== undefined && (officer.hates ?? []).includes(rulerId);
  if (dislikesRuler) lines.push('厌恶君主，必降忠诚');

  // 掉忠/稳定性说明
  if (Object.keys(officer.relationships ?? {}).length > 0) {
    lines.push('义兄弟/配偶在营，忠诚锁定');
  } else if (dislikesRuler) {
    lines.push('相斥必降忠诚'); // 关系/仁政免疫优先于该条，仅作提示
  } else if (tier.key === 'far') {
    lines.push('与君主相性相克，忠诚易流失');
  }
  if (hasMasterHearts(state, officer.forceId)) lines.push('本方掌握人心，掉忠概率下降');
  return lines.join('\n');
}

function columnsForTab(activeTab: OfficerListTab, scope: OfficerListDialogProps['scope']): OfficerColumn[] {
  if (activeTab === '所属') {
    const cols: OfficerColumn[] = [
      { label: '武将', sortKey: 'name' },
    ];
    if (scopeIsAll(scope)) cols.push({ label: '势力', sortKey: 'force' });
    cols.push(
      { label: '城池', sortKey: 'homeCity' },
      { label: '年龄', sortKey: 'age' },
      { label: '相性', sortKey: 'xing' },
      { label: '忠诚', sortKey: 'loyalty' },
      { label: '所在', sortKey: 'location' },
    );
    return cols;
  }
  if (activeTab === '奖赏') return [
    { label: '武将', sortKey: 'name' },
    { label: '忠诚', sortKey: 'loyalty' },
    { label: '城池', sortKey: 'homeCity' },
    { label: '身份', sortKey: 'position' },
    { label: '功绩', sortKey: 'merit' },
  ];
  if (activeTab === '能力') return [
    { label: '武将', sortKey: 'name' },
    { label: '统帅', sortKey: 'leadership' },
    { label: '武力', sortKey: 'war' },
    { label: '智力', sortKey: 'intelligence' },
    { label: '政治', sortKey: 'politics' },
    { label: '魅力', sortKey: 'charisma' },
  ];
  if (activeTab === '特技') return [
    { label: '武将', sortKey: 'name' },
    { label: '特技', sortKey: 'skill' },
    { label: '说明', sortKey: 'skillDescription' },
  ];
  if (activeTab === '适性') return [
    { label: '武将', sortKey: 'name' },
    { label: '枪', sortKey: 'spear' },
    { label: '戟', sortKey: 'halberd' },
    { label: '弩', sortKey: 'crossbow' },
    { label: '骑', sortKey: 'cavalry' },
    { label: '兵器', sortKey: 'siege' },
    { label: '水军', sortKey: 'navy' },
  ];
  return [
    { label: '武将', sortKey: 'name' },
    { label: '状态', sortKey: 'status' },
    { label: '任务', sortKey: 'task' },
    { label: '性别', sortKey: 'gender' },
  ];
}

function renderOfficerCells(officer: Officer, state: GameState, activeTab: OfficerListTab, scope: OfficerListDialogProps['scope']) {
  if (activeTab === '所属') {
    const hint = loyaltyHint(officer, state);
    const loyaltyCell = <td title={hint}>{isForceLeader(officer, state) ? '-' : officerLoyalty(officer)}</td>;
    if (scopeIsAll(scope)) {
      return (
        <>
          <td>{ownershipText(officer, state)}</td>
          <td>{homeCityText(officer, state)}</td>
          {ageCell(officer, state)}
          <td>{affinityOf(state, officer)}</td>
          {loyaltyCell}
          <td>{locationText(officer, state)}</td>
        </>
      );
    }
    return (
      <>
        <td>{homeCityText(officer, state)}</td>
        {ageCell(officer, state)}
        <td>{affinityOf(state, officer)}</td>
        {loyaltyCell}
        <td>{locationText(officer, state)}</td>
      </>
    );
  }
  if (activeTab === '奖赏') {
    const loyaltyHintText = loyaltyHint(officer, state);
    const position = positionDefinition(officer.positionId);
    return (
      <>
        <td title={loyaltyHintText}>{isForceLeader(officer, state) ? '-' : officerLoyalty(officer)}</td>
        <td>{homeCityText(officer, state)}</td>
        <td>{position?.name ?? '—'}</td>
        <td>{officerMerit(officer)}</td>
      </>
    );
  }
  if (activeTab === '能力') {
    return (
      <>
        <td>{officer.stats.leadership}</td>
        <td>{officer.stats.war}</td>
        <td>{officer.stats.intelligence}</td>
        <td>{officer.stats.politics}</td>
        <td>{officer.stats.charisma}</td>
      </>
    );
  }
  if (activeTab === '特技') {
    const skillNames = officerSkillNames(officer);
    const primary = skillNames[0];
    return (
      <>
        <td>{officerSkillsText(officer)}</td>
        <td className="officer-skill-description">{primary ? skillDefinition(primary)?.description ?? '暂无说明' : ''}</td>
      </>
    );
  }
  if (activeTab === '适性') {
    const aptitudes = officer.aptitudes ?? fallbackAptitudes;
    return (
      <>
        <td>{aptitudes.spear}</td>
        <td>{aptitudes.halberd}</td>
        <td>{aptitudes.crossbow}</td>
        <td>{aptitudes.cavalry}</td>
        <td>{aptitudes.siege}</td>
        <td>{aptitudes.navy}</td>
      </>
    );
  }

  const task = taskInfo(officer, state);
  return (
    <>
      <td>{task.status}</td>
      <td>{task.task}</td>
      <td><GenderBadge officer={officer} /></td>
    </>
  );
}

function GenderBadge({ officer }: { officer: Officer }) {
  return <span className={`officer-gender is-${officer.gender ?? 'male'}`}>{officer.gender === 'female' ? '女' : '男'}</span>;
}

function defaultOfficerCompare(left: Officer, right: Officer) {
  return left.cityId.localeCompare(right.cityId) ||
    right.stats.leadership - left.stats.leadership ||
    left.name.localeCompare(right.name) ||
    left.id.localeCompare(right.id);
}

function sortValue(officer: Officer, state: GameState, sortKey: SortKey) {
  if (sortKey === 'name') return officer.name;
  if (sortKey === 'age') return officerAge(state, officer) ?? -1;
  if (sortKey === 'force') return ownershipText(officer, state);
  if (sortKey === 'homeCity') return homeCityText(officer, state);
  if (sortKey === 'loyalty') return officerLoyalty(officer);
  if (sortKey === 'xing') return officer.forceId ? affinityOf(state, officer) : -1;
  if (sortKey === 'location') return locationText(officer, state);
  if (sortKey === 'position') return positionDefinition(officer.positionId)?.name ?? '—';
  if (sortKey === 'merit') return officerMerit(officer);
  if (sortKey === 'skill') return officerSkillsText(officer);
  if (sortKey === 'skillDescription') {
    const primary = officerSkillNames(officer)[0];
    return primary ? skillDefinition(primary)?.description ?? '暂无说明' : '';
  }
  if (sortKey === 'status' || sortKey === 'task' || sortKey === 'time') return taskInfo(officer, state)[sortKey];
  if (sortKey === 'gender') return (officer.gender ?? 'male') === 'female' ? '女' : '男';
  if (sortKey in fallbackAptitudes) {
    const aptitudes = officer.aptitudes ?? fallbackAptitudes;
    return aptitudeRank[aptitudes[sortKey as keyof OfficerAptitudes]];
  }
  return officer.stats[sortKey as keyof Stats];
}

function compareSortValues(left: string | number, right: string | number, direction: SortDirection) {
  const result = typeof left === 'number' && typeof right === 'number'
    ? left - right
    : String(left).localeCompare(String(right));
  return direction === 'desc' ? -result : result;
}

/** 可复用的武将列表表格：tab 切换 + 可排序列 + 可选 checkbox 列 */
export function OfficerListTable({
  scope = 'player',
  officerIds,
  initialTab,
  tabs = officerListTabs,
  checkboxes,
  testId,
  onRowClick,
}: OfficerListTableProps) {
  const { state } = useGame();
  const [activeTab, setActiveTab] = useState<OfficerListTab>(() => initialTab
    ?? (officerIds?.length ? '能力' : '所属'));
  const [sort, setSort] = useState<{ key: SortKey; direction: SortDirection } | null>(null);
  const scopeForColumns: OfficerListDialogProps['scope'] = scope;
  const officers = useMemo(() => {
    if (!state) return [];
    const base = officerIds?.length
      ? officerIds.map((id) => state.officers[id]).filter((officer): officer is Officer => Boolean(officer))
      : Object.values(state.officers).filter((officer) => {
        if (scope === 'all') return true;
        if (typeof scope === 'object' && scope !== null) return officer.forceId === scope.forceId;
        return officer.forceId === state.playerForceId;
      });
    if (officerIds?.length && !sort) return base;
    return [...base].sort((left, right) => {
      if (!sort) return defaultOfficerCompare(left, right);
      return compareSortValues(sortValue(left, state, sort.key), sortValue(right, state, sort.key), sort.direction) ||
        left.name.localeCompare(right.name) ||
        left.id.localeCompare(right.id);
    });
  }, [officerIds, scope, sort, state]);
  const columns = columnsForTab(activeTab, scopeForColumns);
  const changeTab = (tab: OfficerListTab) => {
    setActiveTab(tab);
    setSort(null);
  };
  const sortBy = (sortKey: SortKey) => {
    setSort((current) => (
      current?.key === sortKey
        ? { key: sortKey, direction: current.direction === 'desc' ? 'asc' : 'desc' }
        : { key: sortKey, direction: 'desc' }
    ));
  };
  if (!state) return null;

  const checkedIds = checkboxes?.checked ?? new Set<string>();
  const disabledIds = checkboxes?.disabledIds ?? new Set<string>();
  const max = checkboxes?.max ?? Infinity;

  return (
    <section
      className="officer-list-body"
      data-testid={testId}
      role="table"
      aria-label="武将列表"
    >
      <nav className="officer-list-tabs" aria-label="武将分类">
        {tabs.map((tab) => (
          <button
            key={tab}
            type="button"
            className={tab === activeTab ? 'is-active' : undefined}
            onClick={() => changeTab(tab)}
          >
            {tab}
          </button>
        ))}
      </nav>
      <div className="officer-table-wrap">
        <table className="officer-table">
          <thead>
            <tr>
              {checkboxes && <th scope="col" aria-label="选择" style={{ width: 36 }} />}
              {columns.map((column) => {
                const active = sort?.key === column.sortKey;
                return (
                  <th key={column.sortKey} scope="col" aria-sort={active ? (sort.direction === 'desc' ? 'descending' : 'ascending') : undefined}>
                    <button
                      type="button"
                      aria-label={`按${column.label}排序`}
                      className={active ? 'is-active' : undefined}
                      onClick={() => sortBy(column.sortKey)}
                    >
                      {column.label}{active ? (sort.direction === 'desc' ? ' ↓' : ' ↑') : ''}
                    </button>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {officers.map((officer) => {
              const isChecked = checkedIds.has(officer.id);
              const isOverLimit = !isChecked && checkedIds.size >= max;
              // 已勾选的项始终可取消，避免锁定性别/超出上限后无法撤销
              const isInputDisabled = (disabledIds.has(officer.id) || isOverLimit) && !isChecked;
              const rowClickable = Boolean(checkboxes) && !isInputDisabled;
              return (
                <tr
                  key={officer.id}
                  className={[isChecked ? 'is-selected' : '', rowClickable ? 'is-clickable' : ''].filter(Boolean).join(' ') || undefined}
                  title={rowClickable ? '点击行切换勾选' : undefined}
                  onClick={rowClickable ? (event) => {
                    // checkbox 自身已触发 onChange，跳过避免重复切换
                    if ((event.target as HTMLElement).closest('input')) return;
                    checkboxes!.onToggle(officer.id);
                  } : undefined}
                >
                  {checkboxes && (
                    <td>
                      <input
                        type="checkbox"
                        aria-label={officer.name}
                        checked={isChecked}
                        disabled={isInputDisabled}
                        onChange={() => checkboxes.onToggle(officer.id)}
                      />
                    </td>
                  )}
                  <th scope="row">
                    {onRowClick ? (
                      <button type="button" className="officer-name-button" onClick={() => onRowClick(officer)}>
                        {officer.name}<OfficerHealthBadge officer={officer} />
                      </button>
                    ) : (<>{officer.name}<OfficerHealthBadge officer={officer} /></>)}
                  </th>
                  {renderOfficerCells(officer, state, activeTab, scopeForColumns)}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/** 武将一览弹窗：全势力/玩家势力/指定势力的完整武将列表（不含选择器） */
export function OfficerListDialog({ scope = 'player', officerIds, onClose }: OfficerListDialogProps) {
  const audio = useAudioEventAdapter();
  const { state } = useGame();
  const [detailOfficerId, setDetailOfficerId] = useState<string | null>(null);
  if (!state) return null;

  const titleText = officerIds?.length
    ? '所属部队'
    : scope === 'all' ? '全势力'
      : typeof scope === 'object' && scope !== null
        ? `${state.forces[scope.forceId]?.name ?? ''}军`
        : `${state.forces[state.playerForceId].name}军`;
  const detailOfficer = detailOfficerId ? state.officers[detailOfficerId] : undefined;

  return (
    <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()} onContextMenu={(event) => closePopupOnContextMenu(event, onClose, audio)}>
      <div className="officer-list-dialog tool-panel" data-testid={officerIds?.length ? 'unit-officer-list-dialog' : undefined} role="dialog" aria-modal="true" aria-labelledby="officer-list-title">
        <header>
          <div>
            <p>{titleText}</p>
            <h2 id="officer-list-title">武将一览</h2>
          </div>
          <button type="button" className="icon-button" aria-label="关闭武将一览" title="关闭" onClick={onClose}><X /></button>
        </header>
        <OfficerListTable scope={scope} officerIds={officerIds} onRowClick={(officer) => setDetailOfficerId(officer.id)} />
      </div>
      {detailOfficer && (
        <OfficerDetailDialog officer={detailOfficer} state={state} onClose={() => setDetailOfficerId(null)} />
      )}
    </div>
  );
}
