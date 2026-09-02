import { ChevronDown, ChevronUp, Coins, FlaskConical, Gem, GraduationCap, Hammer, Landmark, Route, ShieldCheck, Swords, UserSearch, Users } from 'lucide-react';
import { useState } from 'react';
import { COMMAND_AP, OFFICER_COMMANDS, cityAvailableOfficers } from '../game/commands';
import { hasPlotFacility } from '../game/innerAffairs';
import { officerHealthSummary } from '../game/health';
import { useGame } from '../game/store/GameProvider';
import type { GameCommand, GameState, Officer } from '../game/types';

type CommandType = GameCommand['type'];

/** 城市武将名单 chip 的伤病提示：受伤武将显示等级与痊愈旬数 */
function rosterHealth(officer: Officer) {
  const health = officerHealthSummary(officer);
  if (!health) return null;
  return { label: `${health.label}·${health.remainingTenDays}旬`, title: `${health.label}：能力下降 ${Math.round((1 - health.multiplier) * 100)}%，约 ${health.remainingTenDays} 旬后痊愈` };
}

/** 是否有科技正在研究中（城间任意己方武将执行 research 任务） */
function techResearching(state: GameState): boolean {
  return Object.values(state.officers).some((officer) =>
    officer.forceId === state.playerForceId && officer.location.kind === 'task' && officer.location.task === 'research');
}

/** 是否有能力正在研究中 */
function abilityResearching(state: GameState): boolean {
  return Boolean(state.forces[state.playerForceId]?.abilityResearch?.active);
}

interface CityPanelProps {
  onCommand?(type: CommandType): void;
  onOpenCultivatePicker?(): void;
}

const COMMANDS: Array<{ type: CommandType; label: string; Icon: typeof Landmark }> = [
  { type: 'buildFacilityPlot', label: '开发', Icon: Hammer },
  { type: 'recruit', label: '征兵', Icon: Users },
  { type: 'produceArmament', label: '生产兵装', Icon: Hammer },
  { type: 'train', label: '训练', Icon: Swords },
  { type: 'patrol', label: '巡察', Icon: ShieldCheck },
  { type: 'trade', label: '商人', Icon: Coins },
  { type: 'explore', label: '探索', Icon: UserSearch },
  { type: 'grantTreasure', label: '收授宝物', Icon: Gem },
  { type: 'research', label: '科技研究', Icon: FlaskConical },
  { type: 'abilityResearch', label: '能力研究', Icon: GraduationCap },
  { type: 'transfer', label: '调动', Icon: Route },
];

const formatNumber = (value: number) => value.toLocaleString('en-US');

export function CityPanel({ onCommand, onOpenCultivatePicker }: CityPanelProps) {
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
  const hasAvailableOfficers = cityAvailableOfficers(state, state.playerForceId, city.id).length > 0;

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
          {officers.map((officer) => {
            const health = rosterHealth(officer);
            return (
              <span key={officer.id} className={`${officer.acted ? 'has-acted' : ''}${health ? ' has-injury' : ''}`} title={health?.title}>
                {officer.name}<small>{health?.label ?? (officer.acted ? '已行动' : '待命')}</small>
              </span>
            );
          })}
        </div>
      </section>

      {owned && state.phase === 'playing' ? (
        <>
          <section className="command-grid" aria-label="城市指令">
            {COMMANDS.map(({ type, label, Icon }) => {
              let disabled = state.actionPoints[state.playerForceId] < COMMAND_AP[type];
              let title: string | undefined = disabled ? `行动力不足 ${COMMAND_AP[type]}` : undefined;
              let displayLabel = label;
              if (OFFICER_COMMANDS.has(type) && !hasAvailableOfficers) {
                disabled = true;
                title = '城中没有可行动的武将';
              }
              if (type === 'trade') {
                if (city.merchantTradedThisTenDay) {
                  disabled = true;
                  title = '本旬已完成一次粮食交易';
                } else if (!city.merchantPresent) {
                  disabled = true;
                  title = '商人本旬未到访';
                }
              } else if (type === 'grantTreasure' && !Object.values(state.treasures ?? {}).some((treasure) => treasure.ownerId === state.playerForceId)) {
                disabled = true;
                title = '尚无已出土的宝物';
              } else if (type === 'recruit' && !hasPlotFacility(city, 'barracks')) {
                disabled = true;
                title = '需先建设兵舍才能征兵';
              } else if (type === 'research' && techResearching(state)) {
                disabled = true;
                title = '科技研究中';
                displayLabel = '科技研究中';
              } else if (type === 'abilityResearch' && abilityResearching(state)) {
                disabled = true;
                title = '能力研究中';
                displayLabel = '能力研究中';
              }
              return (
                <button
                  key={type}
                  type="button"
                  data-testid={`command-${type}-button`}
                  disabled={disabled}
                  title={title}
                  onClick={() => onCommand?.(type)}
                >
                  <Icon aria-hidden="true" /><span>{displayLabel}</span>
                </button>
              );
            })}
          </section>
          <section className="cultivate-submenu" aria-label="培育武将">
            <button
              type="button"
              data-testid="cultivate-toggle-button"
              onClick={() => onOpenCultivatePicker?.()}
            >
              <ChevronUp aria-hidden="true" />
              <span>培育武将</span>
            </button>
          </section>
        </>
      ) : (
        <p className="readonly-note">{state.phase === 'finished' ? '经营期已经结束' : '仅可查看他势力城市情报'}</p>
      )}
    </aside>
  );
}
