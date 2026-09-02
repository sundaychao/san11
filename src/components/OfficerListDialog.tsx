import { X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useAudioEventAdapter } from '../audio/reactAudioEventAdapter';
import { useGame } from '../game/store/GameProvider';
import { ARMAMENT_LABELS } from '../game/armaments';
import { officerAge, oldAgeDeathChance } from '../game/health';
import { officerLoyalty } from '../game/loyalty';
import { PLOT_LABELS } from '../game/innerAffairs';
import { TECH_BRANCH_LABELS } from '../game/techs';
import { skillDefinition, officerSkillNames, officerSkillsText } from '../game/skills';
import type { ForceId, GameState, Officer, OfficerAptitudes, Stats } from '../game/types';
import { closePopupOnContextMenu } from './popupEvents';

interface OfficerListDialogProps {
  scope?: 'player' | 'all' | { forceId: ForceId };
  officerIds?: string[];
  onClose(): void;
}

type OfficerListTab = '所属' | '能力' | '特技' | '适性' | '状态';
type SortDirection = 'desc' | 'asc';
type SortKey =
  | 'name'
  | 'age'
  | 'owner'
  | 'loyalty'
  | 'location'
  | keyof Stats
  | 'skill'
  | 'skillDescription'
  | keyof OfficerAptitudes
  | 'status'
  | 'task'
  | 'time';

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

function locationText(officer: Officer, state: GameState) {
  if (officer.location.kind === 'city') return state.cities[officer.location.cityId].name;
  if (officer.location.kind === 'unit') return '部队';
  if (officer.location.kind === 'transfer') return '在途';
  return state.cities[officer.location.cityId].name;
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

function taskInfo(officer: Officer, state: GameState) {
  if (officer.location.kind === 'transfer') {
    const from = state.cities[officer.location.fromCityId].name;
    const target = state.cities[officer.location.targetCityId].name;
    return {
      status: '执行中',
      task: `调动 ${from}→${target}`,
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
      .find((plot) => plot?.constructing?.officerId === officer.id);
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

function columnsForTab(activeTab: OfficerListTab): OfficerColumn[] {
  if (activeTab === '所属') return [
    { label: '武将', sortKey: 'name' },
    { label: '所属', sortKey: 'owner' },
    { label: '年龄', sortKey: 'age' },
    { label: '忠诚', sortKey: 'loyalty' },
    { label: '所在', sortKey: 'location' },
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
    { label: '时间', sortKey: 'time' },
  ];
}

function renderOfficerCells(officer: Officer, state: GameState, activeTab: OfficerListTab) {
  if (activeTab === '所属') {
    return (
      <>
        <td>{ownershipText(officer, state)}</td>
        {ageCell(officer, state)}
        <td>{officerLoyalty(officer)}</td>
        <td>{locationText(officer, state)}</td>
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
      <td>{task.time}</td>
    </>
  );
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
  if (sortKey === 'owner') return ownershipText(officer, state);
  if (sortKey === 'loyalty') return officerLoyalty(officer);
  if (sortKey === 'location') return locationText(officer, state);
  if (sortKey === 'skill') return officerSkillsText(officer);
  if (sortKey === 'skillDescription') {
    const primary = officerSkillNames(officer)[0];
    return primary ? skillDefinition(primary)?.description ?? '暂无说明' : '';
  }
  if (sortKey === 'status' || sortKey === 'task' || sortKey === 'time') return taskInfo(officer, state)[sortKey];
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

export function OfficerListDialog({ scope = 'player', officerIds, onClose }: OfficerListDialogProps) {
  const audio = useAudioEventAdapter();
  const { state } = useGame();
  const [activeTab, setActiveTab] = useState<OfficerListTab>(() => (officerIds?.length ? officerListTabs[1] : officerListTabs[0]));
  const [sort, setSort] = useState<{ key: SortKey; direction: SortDirection } | null>(null);
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
  const columns = columnsForTab(activeTab);
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

  return (
    <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()} onContextMenu={(event) => closePopupOnContextMenu(event, onClose, audio)}>
      <section className="officer-list-dialog tool-panel" data-testid={officerIds?.length ? 'unit-officer-list-dialog' : undefined} role="dialog" aria-modal="true" aria-labelledby="officer-list-title">
        <header>
          <div>
            <p>{officerIds?.length ? '所属部队' : scope === 'all' ? '全势力' : typeof scope === 'object' && scope !== null ? `${state.forces[scope.forceId]?.name ?? ''}军` : `${state.forces[state.playerForceId].name}军`}</p>
            <h2 id="officer-list-title">武将一览</h2>
          </div>
          <button type="button" className="icon-button" aria-label="关闭武将一览" title="关闭" onClick={onClose}><X /></button>
        </header>
        <nav className="officer-list-tabs" aria-label="武将分类">
          {officerListTabs.map((tab) => (
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
              {officers.map((officer) => (
                <tr key={officer.id}>
                  <th scope="row">{officer.name}</th>
                  {renderOfficerCells(officer, state, activeTab)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
