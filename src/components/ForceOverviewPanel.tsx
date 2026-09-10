import { useMemo, useState } from 'react';
import { useAudioEventAdapter } from '../audio/reactAudioEventAdapter';
import { TROOP_LABELS } from '../game/armaments';
import { officerIsBusy } from '../game/commands';
import type { GridCoord } from '../game/battle/grid';
import { china42Passes } from '../game/scenario/jingxiang208';
import { useGame } from '../game/store/GameProvider';
import type { ArmyUnit, CityId, GameState, Officer } from '../game/types';

type OverviewTab = 'city' | 'officer' | 'unit';

/** 关隘锚点：武将驻扎关隘时用来定位镜头（与地图绘制关隘用的是同一份数据） */
const PASS_ANCHORS = china42Passes();

function cityCell(state: GameState, cityId: CityId): GridCoord | null {
  const city = state.cities[cityId];
  return city ? { q: city.gridQ, r: city.gridR } : null;
}

function officerLocationText(officer: Officer, state: GameState) {
  const location = officer.location;
  if (location.kind === 'city') return state.cities[location.cityId]?.name ?? '城池';
  if (location.kind === 'pass') return state.passes?.[location.passId]?.name ?? '关隘';
  if (location.kind === 'unit') return '部队';
  if (location.kind === 'transfer') return '在途';
  if (location.kind === 'captive') return '被俘';
  if (location.kind === 'task') return state.cities[location.cityId]?.name ?? '执行中';
  return state.cities[location.cityId]?.name ?? '未任官';
}

/** 武将当前所在格：城池/关隘据点取据点锚点，在部队上取部队坐标，调动途中取目标城池 */
function officerCell(officer: Officer, state: GameState): GridCoord | null {
  const location = officer.location;
  if (location.kind === 'pass') {
    const anchor = PASS_ANCHORS.find((item) => item.id === location.passId);
    if (anchor) return { q: anchor.q, r: anchor.r };
    const pass = state.passes?.[location.passId];
    return pass ? cityCell(state, pass.homeCityId) : null;
  }
  if (location.kind === 'unit') {
    const unit = state.units[location.unitId];
    return unit ? { q: unit.q, r: unit.r } : null;
  }
  if (location.kind === 'transfer') return cityCell(state, location.targetCityId);
  return cityCell(state, location.cityId);
}

function unitKindLabel(unit: ArmyUnit) {
  if (unit.kind === 'transport') return '运输队';
  return TROOP_LABELS[unit.troopType ?? 'sword'];
}

/**
 * 部队本旬是否已行动完毕：`acted`（攻击/战法/待命）或 `moved`（移动）任一成立即算。
 * 引擎侧两个标记都是终态 —— `combat.ts` 的攻击可用判定与 `targetRules` 的可选目标判定
 * 都要求 `!acted && !moved`，即移动过的部队本旬同样不能再攻击。
 */
function unitHasActed(unit: ArmyUnit) {
  return unit.acted || unit.moved;
}

/**
 * 武将是否视为「本旬已行动」：
 * - `acted` 主标记；
 * - 在途 / 执行任务 / 被俘无条件算已行动 —— 这三类不在据点里，本旬下不了令；
 * - 随军出征（`location.kind === 'unit'`）时跟随所属部队：部队动了就算该武将已行动，
 *   否则会出现「部队已灰、武将还亮」的错位（引擎只在部队进城时同步 officer.acted）。
 *
 * 前两类引擎侧旬末重置已按同一口径保留 acted，这里再兜一层是防旧存档状态不一致。
 */
function officerHasActed(officer: Officer, state: GameState) {
  if (officer.acted || officerIsBusy(officer)) return true;
  if (officer.location.kind === 'unit') {
    const unit = state.units[officer.location.unitId];
    return unit ? unitHasActed(unit) : false;
  }
  return false;
}

interface ForceOverviewPanelProps {
  /** 点击列表项：把镜头居中到目标格 */
  onFocus?(cell: GridCoord): void;
}

/**
 * 本势力概览：城池 / 武将 / 在外部队 三个页签。
 * 点击任意一行都把主镜头居中到对应位置（城池中心、武将所在据点、部队所在格）。
 */
export function ForceOverviewPanel({ onFocus }: ForceOverviewPanelProps = {}) {
  const { state } = useGame();
  const audio = useAudioEventAdapter();
  const [activeTab, setActiveTab] = useState<OverviewTab>('city');

  const playerForceId = state?.playerForceId;

  const cities = useMemo(
    () => {
      if (!state) return [];
      return Object.values(state.cities)
        .filter((city) => city.ownerId === playerForceId)
        .sort((left, right) => left.name.localeCompare(right.name));
    },
    [state, playerForceId],
  );
  const officers = useMemo(
    () => {
      if (!state) return [];
      return Object.values(state.officers)
        .filter((officer) => officer.forceId === playerForceId)
        .sort((left, right) => {
          const leftLocation = officerLocationText(left, state);
          const rightLocation = officerLocationText(right, state);
          return leftLocation.localeCompare(rightLocation) || right.stats.leadership - left.stats.leadership;
        });
    },
    [state, playerForceId],
  );
  /** 在外部队（含运输队）：`state.units` 里挂着的都是我方的在外部队，城内部队不存在此表 */
  const units = useMemo(
    () => {
      if (!state) return [];
      return Object.values(state.units)
        .filter((unit) => unit.forceId === playerForceId)
        .sort((left, right) => {
          const leftKind = left.kind === 'transport' ? 1 : 0;
          const rightKind = right.kind === 'transport' ? 1 : 0;
          return leftKind - rightKind
            || (state.officers[left.leaderId]?.name ?? '').localeCompare(state.officers[right.leaderId]?.name ?? '');
        });
    },
    [state, playerForceId],
  );

  if (!state) return null;

  const focusOn = (cell: GridCoord | null) => {
    if (!cell || !onFocus) return;
    audio.emit({ type: 'menu-click-on' });
    onFocus(cell);
  };

  return (
    <aside className="force-overview-panel tool-panel" data-testid="force-overview-panel" aria-label="本势力概览">
      <nav className="force-overview-tabs" aria-label="本势力列表分类">
        <button type="button" className={activeTab === 'city' ? 'is-active' : undefined} onClick={() => setActiveTab('city')}>
          城池
        </button>
        <button type="button" className={activeTab === 'officer' ? 'is-active' : undefined} onClick={() => setActiveTab('officer')}>
          武将
        </button>
        <button type="button" className={activeTab === 'unit' ? 'is-active' : undefined} onClick={() => setActiveTab('unit')}>
          部队
        </button>
      </nav>

      {activeTab === 'city' && (
        <ol className="force-overview-list">
          {cities.map((city) => (
            <li key={city.id}>
              <button
                type="button"
                className="force-overview-row"
                data-testid={`force-overview-city-${city.id}`}
                title={`${city.name}：居中显示该城池`}
                onClick={() => focusOn(cityCell(state, city.id))}
              >
                <strong>{city.name}</strong>
                <small>{city.troops.toLocaleString('en-US')}兵 / {city.population.toLocaleString('en-US')}人</small>
              </button>
            </li>
          ))}
        </ol>
      )}

      {activeTab === 'officer' && (
        <ol className="force-overview-list">
          {officers.map((officer) => (
            <li key={officer.id}>
              <button
                type="button"
                className={`force-overview-row ${officerHasActed(officer, state) ? 'has-acted' : 'is-ready'}`}
                data-testid={`force-overview-officer-${officer.id}`}
                title={`${officer.name}：居中显示所在位置`}
                onClick={() => focusOn(officerCell(officer, state))}
              >
                <strong>{officer.name}</strong>
                <small>{officerLocationText(officer, state)} / {officerHasActed(officer, state) ? '已行动' : '未行动'}</small>
              </button>
            </li>
          ))}
        </ol>
      )}

      {activeTab === 'unit' && (
        <ol className="force-overview-list" data-testid="force-overview-units">
          {units.map((unit) => (
            <li key={unit.id}>
              <button
                type="button"
                className={`force-overview-row ${unitHasActed(unit) ? 'has-acted' : 'is-ready'}`}
                data-testid={`force-overview-unit-${unit.id}`}
                title={`${state.officers[unit.leaderId]?.name ?? '部队'}：居中显示该部队`}
                onClick={() => focusOn({ q: unit.q, r: unit.r })}
              >
                <strong>{state.officers[unit.leaderId]?.name ?? '部队'}</strong>
                <small>
                  {unitKindLabel(unit)} {unit.troops.toLocaleString('en-US')}兵 · {unitHasActed(unit) ? '已行动' : '未行动'}
                </small>
              </button>
            </li>
          ))}
          {units.length === 0 && (
            <li className="force-overview-blank">暂无在外部队</li>
          )}
        </ol>
      )}
    </aside>
  );
}
