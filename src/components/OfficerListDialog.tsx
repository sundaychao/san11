import { X } from 'lucide-react';
import { useGame } from '../game/store/GameProvider';
import type { GameState, Officer } from '../game/types';

interface OfficerListDialogProps {
  onClose(): void;
}

function locationText(officer: Officer, state: GameState) {
  if (officer.location.kind === 'city') return state.cities[officer.location.cityId].name;
  if (officer.location.kind === 'unit') return '部队';
  if (officer.location.kind === 'transfer') {
    return '在途';
  }
  return state.cities[officer.location.cityId].name;
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

export function OfficerListDialog({ onClose }: OfficerListDialogProps) {
  const { state } = useGame();
  if (!state) return null;
  const officers = Object.values(state.officers)
    .filter((officer) => officer.forceId === state.playerForceId)
    .sort((left, right) => left.cityId.localeCompare(right.cityId) || right.stats.leadership - left.stats.leadership);

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
        <div className="officer-table-wrap">
          <table className="officer-table">
            <thead>
              <tr>
                <th scope="col">武将</th>
                <th scope="col">所在</th>
                <th scope="col">状态</th>
                <th scope="col">任务</th>
                <th scope="col">时间</th>
                <th scope="col">统帅</th>
                <th scope="col">武力</th>
                <th scope="col">智力</th>
                <th scope="col">政治</th>
                <th scope="col">魅力</th>
              </tr>
            </thead>
            <tbody>
              {officers.map((officer) => {
                const task = taskInfo(officer, state);
                return (
                  <tr key={officer.id}>
                    <th scope="row">{officer.name}</th>
                    <td>{locationText(officer, state)}</td>
                    <td>{task.status}</td>
                    <td>{task.task}</td>
                    <td>{task.time}</td>
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
        </div>
      </section>
    </div>
  );
}
