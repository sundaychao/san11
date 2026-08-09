import { ChevronDown, ChevronUp, Hammer, Landmark, Route, ShieldCheck, Swords, UserSearch, Users } from 'lucide-react';
import { useState } from 'react';
import { useGame } from '../game/store/GameProvider';
import type { GameCommand } from '../game/types';

type CommandType = GameCommand['type'];

interface CityPanelProps {
  onCommand?(type: CommandType): void;
}

const COMMANDS: Array<{ type: CommandType; label: string; Icon: typeof Landmark }> = [
  { type: 'develop', label: '开发', Icon: Landmark },
  { type: 'recruit', label: '征兵', Icon: Users },
  { type: 'produceArmament', label: '生产兵装', Icon: Hammer },
  { type: 'train', label: '训练', Icon: Swords },
  { type: 'patrol', label: '巡察', Icon: ShieldCheck },
  { type: 'talent', label: '人才', Icon: UserSearch },
  { type: 'transfer', label: '调动', Icon: Route },
];

const formatNumber = (value: number) => value.toLocaleString('en-US');

export function CityPanel({ onCommand }: CityPanelProps) {
  const { state, selectedCityId } = useGame();
  const [collapsed, setCollapsed] = useState(false);
  if (!state || !selectedCityId) return null;

  const city = state.cities[selectedCityId];
  const owner = state.forces[city.ownerId];
  const governor = city.governorId ? state.officers[city.governorId] : null;
  const officers = Object.values(state.officers).filter((officer) =>
    officer.forceId === city.ownerId && officer.location.kind === 'city' && officer.location.cityId === city.id,
  );
  const owned = city.ownerId === state.playerForceId;

  return (
    <aside className={`city-panel tool-panel${collapsed ? ' is-collapsed' : ''}`} aria-label="城市经营面板">
      <header className="city-heading">
        <span className="force-line" style={{ backgroundColor: owner.color }} aria-hidden="true" />
        <div>
          <p>{owner.name}军 · 太守 {governor?.name ?? '暂无'}</p>
          <h2>{city.name}</h2>
        </div>
        <b>{owned ? '本势力' : '他势力'}</b>
        <button
          type="button"
          className="sheet-toggle icon-button"
          aria-label={collapsed ? '展开城市面板' : '收起城市面板'}
          title={collapsed ? '展开城市面板' : '收起城市面板'}
          onClick={() => setCollapsed((value) => !value)}
        >
          {collapsed ? <ChevronUp /> : <ChevronDown />}
        </button>
      </header>

      <dl className="city-resources">
        <div><dt>资金</dt><dd>{formatNumber(city.gold)}</dd></div>
        <div><dt>兵粮</dt><dd>{formatNumber(city.food)}</dd></div>
        <div><dt>兵力</dt><dd>{formatNumber(city.troops)}</dd></div>
        <div><dt>人口</dt><dd>{formatNumber(city.population)}</dd></div>
      </dl>

      <section className="city-progress" aria-label="城市发展">
        {[
          ['商业', city.commerce],
          ['农业', city.agriculture],
          ['治安', city.order],
          ['训练', city.training],
        ].map(([label, value]) => (
          <div key={label}>
            <span>{label}</span><strong>{value}</strong>
            <i><em style={{ width: `${value}%` }} /></i>
          </div>
        ))}
      </section>

      <section className="officer-roster" aria-label="所属武将">
        <h3>所属武将 <span>{officers.length}</span></h3>
        <div>
          {officers.map((officer) => (
            <span key={officer.id} className={officer.acted ? 'has-acted' : ''}>
              {officer.name}<small>{officer.acted ? '已行动' : '待命'}</small>
            </span>
          ))}
        </div>
      </section>

      {owned && state.phase === 'playing' ? (
        <section className="command-grid" aria-label="城市指令">
          {COMMANDS.map(({ type, label, Icon }) => (
            <button key={type} type="button" data-testid={`command-${type}-button`} onClick={() => onCommand?.(type)}>
              <Icon aria-hidden="true" /><span>{label}</span>
            </button>
          ))}
        </section>
      ) : (
        <p className="readonly-note">{state.phase === 'finished' ? '经营期已经结束' : '仅可查看他势力城市情报'}</p>
      )}
    </aside>
  );
}
