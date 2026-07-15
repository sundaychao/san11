import { X } from 'lucide-react';
import { useState } from 'react';
import { useGame } from '../game/store/GameProvider';
import type { GameState, Officer, OfficerAptitudes } from '../game/types';

interface OfficerListDialogProps {
  onClose(): void;
}

type OfficerListTab = '所属' | '能力' | '特技' | '适性' | '状态';

const officerListTabs: OfficerListTab[] = ['所属', '能力', '特技', '适性', '状态'];
const fallbackAptitudes: OfficerAptitudes = {
  spear: 'B',
  halberd: 'B',
  crossbow: 'B',
  cavalry: 'B',
  siege: 'C',
  navy: 'C',
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
  return { status: '', task: '', time: '' };
}

function renderHeader(activeTab: OfficerListTab) {
  if (activeTab === '所属') return ['武将', '所属', '所在'];
  if (activeTab === '能力') return ['武将', '统帅', '武力', '智力', '政治', '魅力'];
  if (activeTab === '特技') return ['武将', '特技'];
  if (activeTab === '适性') return ['武将', '枪', '戟', '弩', '骑', '兵器', '水军'];
  return ['武将', '状态', '任务', '时间'];
}

function renderOfficerCells(officer: Officer, state: GameState, activeTab: OfficerListTab) {
  if (activeTab === '所属') {
    return (
      <>
        <td>{ownershipText(officer, state)}</td>
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
    return <td>{officer.skill ?? '无'}</td>;
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

export function OfficerListDialog({ onClose }: OfficerListDialogProps) {
  const { state } = useGame();
  const [activeTab, setActiveTab] = useState<OfficerListTab>('所属');
  if (!state) return null;
  const officers = Object.values(state.officers)
    .filter((officer) => officer.forceId === state.playerForceId)
    .sort((left, right) => left.cityId.localeCompare(right.cityId) || right.stats.leadership - left.stats.leadership);
  const headers = renderHeader(activeTab);

  return (
    <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="officer-list-dialog tool-panel" role="dialog" aria-modal="true" aria-labelledby="officer-list-title">
        <header>
          <div>
            <p>{state.forces[state.playerForceId].name}军</p>
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
              onClick={() => setActiveTab(tab)}
            >
              {tab}
            </button>
          ))}
        </nav>
        <div className="officer-table-wrap">
          <table className="officer-table">
            <thead>
              <tr>
                {headers.map((header) => <th key={header} scope="col">{header}</th>)}
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
