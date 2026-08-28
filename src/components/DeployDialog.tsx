import { AlertCircle, Swords, X } from 'lucide-react';
import { useMemo, useRef, useState, type FormEvent } from 'react';
import { useAudioEventAdapter, type AudioEventAdapter } from '../audio/reactAudioEventAdapter';
import { armamentsOf, TROOP_ARMAMENT, TROOP_LABELS, TROOP_MOVEMENT } from '../game/armaments';
import { DEPLOY_AP_COST } from '../game/battle/actions';
import { useGame } from '../game/store/GameProvider';
import type { CityId, Officer, OfficerAptitudes, Stats, TroopType } from '../game/types';
import { closePopupOnContextMenu } from './popupEvents';

export interface DeployConfirmInput {
  cityId: CityId;
  officerIds: string[];
  troopType: TroopType;
  vehicle: 'boat' | 'ship';
  siegeWeapon?: 'ram' | 'tower';
  troops: number;
  gold: number;
  food: number;
}

interface DeployDialogProps {
  cityId: CityId;
  onConfirm(input: DeployConfirmInput): void;
  onClose(): void;
}

interface DeployTroopOption {
  id: string;
  label: string;
  troopType: TroopType;
  siegeWeapon?: 'ram' | 'tower';
  attack: number;
  defense: number;
  movement: number;
}

const TROOP_TYPES: DeployTroopOption[] = [
  { id: 'sword', troopType: 'sword', label: '剑兵', attack: 33, defense: 33, movement: 22 },
  { id: 'spear', troopType: 'spear', label: '枪兵', attack: 38, defense: 31, movement: 22 },
  { id: 'halberd', troopType: 'halberd', label: '戟兵', attack: 31, defense: 39, movement: 20 },
  { id: 'crossbow', troopType: 'crossbow', label: '弩兵', attack: 36, defense: 28, movement: 19 },
  { id: 'cavalry', troopType: 'cavalry', label: '骑兵', attack: 42, defense: 27, movement: 30 },
  { id: 'ram', troopType: 'siege', siegeWeapon: 'ram', label: '冲车', attack: 30, defense: 26, movement: 16 },
  { id: 'tower', troopType: 'siege', siegeWeapon: 'tower', label: '井阑', attack: 26, defense: 22, movement: 16 },
];
const VEHICLE_TYPES: Array<{ id: 'boat' | 'ship'; label: string }> = [
  { id: 'boat', label: '小舟' },
  { id: 'ship', label: '楼船' },
];
type OfficerPickerView = 'ability' | 'skill' | 'aptitude';
type OfficerPickerSortDirection = 'desc' | 'asc';
type OfficerPickerSortKey = 'name' | keyof Stats | 'skill' | keyof OfficerAptitudes;
interface OfficerPickerColumn {
  label: string;
  sortKey: OfficerPickerSortKey;
}
const OFFICER_PICKER_TABS: Array<{ id: OfficerPickerView; label: string }> = [
  { id: 'ability', label: '能力' },
  { id: 'skill', label: '特技' },
  { id: 'aptitude', label: '适性' },
];
const fallbackAptitudes: OfficerAptitudes = { spear: 'B', halberd: 'B', crossbow: 'B', cavalry: 'B', siege: 'C', navy: 'C' };
const aptitudeRank: Record<OfficerAptitudes[keyof OfficerAptitudes], number> = {
  S: 4,
  A: 3,
  B: 2,
  C: 1,
};
type DeployAptitudeTroop = keyof OfficerAptitudes;

function toAmount(value: string) {
  const amount = Number(value);
  return Number.isFinite(amount) ? amount : -1;
}

function officerAbility(officer: Officer | undefined, troopType: TroopType) {
  const troop = TROOP_TYPES.find((item) => item.troopType === troopType) ?? TROOP_TYPES[0];
  if (!officer) return { attack: troop.attack, defense: troop.defense, intelligence: 0, construction: 0, movement: TROOP_MOVEMENT[troopType] };
  return {
    attack: officer.stats.leadership,
    defense: officer.stats.leadership,
    intelligence: officer.stats.intelligence,
    construction: officer.stats.politics,
    movement: TROOP_MOVEMENT[troopType],
  };
}

function aptitudeScoreForTroop(officer: Officer, troopType: TroopType) {
  if (troopType === 'sword') return 0;
  const aptitudes = officer.aptitudes ?? fallbackAptitudes;
  return aptitudeRank[aptitudes[troopType as keyof OfficerAptitudes]];
}

function compareDeployRecommendation(left: Officer, right: Officer, troopType: TroopType) {
  return (
    aptitudeScoreForTroop(right, troopType) - aptitudeScoreForTroop(left, troopType) ||
    right.stats.leadership - left.stats.leadership ||
    right.stats.war - left.stats.war ||
    right.stats.intelligence - left.stats.intelligence ||
    right.stats.politics - left.stats.politics ||
    left.name.localeCompare(right.name) ||
    left.id.localeCompare(right.id)
  );
}

function recommendedOfficerIdsForTroop(officers: Officer[], troopType: TroopType) {
  const recommended = [...officers].sort((left, right) => compareDeployRecommendation(left, right, troopType))[0];
  return recommended ? [recommended.id] : [];
}

function columnsForOfficerPicker(activeView: OfficerPickerView): OfficerPickerColumn[] {
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

function officerPickerSortValue(officer: Officer, sortKey: OfficerPickerSortKey) {
  if (sortKey === 'name') return officer.name;
  if (sortKey === 'skill') return officer.skill ?? '无';
  if (sortKey in fallbackAptitudes) {
    const aptitudes = officer.aptitudes ?? fallbackAptitudes;
    return aptitudeRank[aptitudes[sortKey as keyof OfficerAptitudes]];
  }
  return officer.stats[sortKey as keyof Stats];
}

function compareOfficerPickerSortValues(left: string | number, right: string | number, direction: OfficerPickerSortDirection) {
  const result = typeof left === 'number' && typeof right === 'number'
    ? left - right
    : String(left).localeCompare(String(right));
  return direction === 'desc' ? -result : result;
}

function OfficerPicker({
  officers,
  selectedIds,
  onLeader,
  onDeputy,
  onConfirm,
  onBack,
  audio,
}: {
  officers: Officer[];
  selectedIds: string[];
  onLeader(id: string): void;
  onDeputy(id: string): void;
  onConfirm(): void;
  onBack(): void;
  audio: AudioEventAdapter;
}) {
  const leaderId = selectedIds[0];
  const deputyIds = selectedIds.slice(1);
  const canConfirm = Boolean(leaderId);
  const [activeView, setActiveView] = useState<OfficerPickerView>('ability');
  const [sort, setSort] = useState<{ key: OfficerPickerSortKey; direction: OfficerPickerSortDirection } | null>(null);

  const columns = columnsForOfficerPicker(activeView);
  const sortedOfficers = useMemo(() => {
    if (!sort) return officers;
    return [...officers].sort((left, right) => (
      compareOfficerPickerSortValues(
        officerPickerSortValue(left, sort.key),
        officerPickerSortValue(right, sort.key),
        sort.direction,
      ) ||
      left.name.localeCompare(right.name) ||
      left.id.localeCompare(right.id)
    ));
  }, [officers, sort]);
  const changeView = (view: OfficerPickerView) => {
    setActiveView(view);
    setSort(null);
  };
  const sortBy = (sortKey: OfficerPickerSortKey) => {
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
      return <span>{officer.skill ?? '无'}</span>;
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
            <p>出征人员编制</p>
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
          {OFFICER_PICKER_TABS.map((tab) => (
            <button key={tab.id} type="button" className={activeView === tab.id ? 'is-active' : undefined} onClick={() => changeView(tab.id)}>
              {tab.label}
            </button>
          ))}
        </div>

        <section className={`officer-picker-table is-${activeView}`} aria-label="可出征武将">
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
                <strong>{officer.name}</strong>
                {renderOfficerCells(officer)}
                <div className="officer-picker-actions">
                  <button type="button" aria-label={`选择${officer.name}为主将`} disabled={officer.acted} className={isLeader ? 'is-active' : undefined} onClick={() => onLeader(officer.id)}>主将</button>
                  <button type="button" aria-label={`选择${officer.name}为副将`} disabled={officer.acted || isLeader || (selectedIds.length >= 3 && !isDeputy)} className={isDeputy ? 'is-active' : undefined} onClick={() => onDeputy(officer.id)}>{isDeputy ? '取消' : '副将'}</button>
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

export function DeployDialog({ cityId, onClose, onConfirm }: DeployDialogProps) {
  const audio = useAudioEventAdapter();
  const { state } = useGame();
  const [officerIds, setOfficerIds] = useState<string[]>([]);
  const [troopType, setTroopType] = useState<TroopType>('sword');
  const [vehicle, setVehicle] = useState<'boat' | 'ship'>('boat');
  const [siegeWeapon, setSiegeWeapon] = useState<'ram' | 'tower'>('ram');
  const [troops, setTroops] = useState('');
  const [gold, setGold] = useState('');
  const [food, setFood] = useState('');
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [officerPickerOpen, setOfficerPickerOpen] = useState(false);
  const dialogRef = useRef<HTMLFormElement>(null);

  if (!state) return null;
  const city = state.cities[cityId];
  const officers = Object.values(state.officers).filter((officer) => (
    officer.forceId === state.playerForceId &&
    officer.location.kind === 'city' &&
    officer.location.cityId === cityId
  ));
  const availableOfficers = officers.filter((officer) => !officer.acted);
  const recommendedOfficerIds = recommendedOfficerIdsForTroop(availableOfficers, troopType);
  const selectedAvailableIds = officerIds.filter((id) => availableOfficers.some((officer) => officer.id === id));
  const activeOfficerIds = selectedAvailableIds.length > 0 ? selectedAvailableIds : recommendedOfficerIds;
  const activeOfficerId = activeOfficerIds[0] ?? '';
  const activeOfficer = state.officers[activeOfficerId];
  const armamentType = TROOP_ARMAMENT[troopType];
  const cityArmaments = armamentsOf(city.armaments);
  const armamentStock = armamentType ? cityArmaments[armamentType] : null;
  const shipStock = cityArmaments.ship;
  const troopMax = Math.min(
    10000,
    Math.max(0, city.troops - 500),
    armamentStock ?? Number.POSITIVE_INFINITY,
  );
  const troopMin = 1000;
  const troopRangeDisabled = troopMax < troopMin;
  const troopRangeMax = Math.max(troopMin, troopMax);
  const activeTroops = String(troopRangeDisabled
    ? troopMin
    : Math.min(troopMax, Math.max(troopMin, toAmount(troops || String(Math.min(4000, troopMax))))));
  const goldMax = Math.max(0, city.gold);
  const activeGold = String(Math.min(goldMax, Math.max(0, toAmount(gold || String(Math.min(1000, goldMax))))));
  const foodMax = Math.max(0, city.food);
  const activeFood = String(Math.min(foodMax, Math.max(0, toAmount(food || String(Math.min(6000, foodMax))))));
  const troopAmount = toAmount(activeTroops);
  const goldAmount = toAmount(activeGold);
  const foodAmount = toAmount(activeFood);
  const ability = useMemo(() => officerAbility(activeOfficer, troopType), [activeOfficer, troopType]);
  const errors = [
    state.actionPoints[state.playerForceId] < DEPLOY_AP_COST ? `行动力不足 ${DEPLOY_AP_COST}` : '',
    !activeOfficerId ? '没有可出征武将' : '',
    !Number.isInteger(troopAmount) || troopAmount < 1000 || troopAmount > 10000 ? '士兵必须为 1000-10000' : '',
    city.troops - troopAmount < 500 ? '城市至少保留 500 兵力' : '',
    !Number.isInteger(goldAmount) || goldAmount < 0 || goldAmount > city.gold ? '资金不足' : '',
    !Number.isInteger(foodAmount) || foodAmount < 0 || foodAmount > city.food ? '兵粮不足' : '',
    armamentType && armamentStock !== null && armamentStock < troopAmount ? `${TROOP_LABELS[troopType]}兵装不足` : '',
    vehicle === 'ship' && shipStock < 1 ? '楼船兵装不足' : '',
    troopType === 'siege' && cityArmaments[siegeWeapon] < 1 ? `${TROOP_TYPES.find((item) => item.siegeWeapon === siegeWeapon)?.label}不足` : '',
  ].filter(Boolean);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (errors.length > 0) return;
    try {
      onConfirm({
        cityId,
        officerIds: activeOfficerIds,
        troopType,
        vehicle,
        ...(troopType === 'siege' ? { siegeWeapon } : {}),
        troops: troopAmount,
        gold: goldAmount,
        food: foodAmount,
      });
      onClose();
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : '出征失败');
    }
  };

  if (officerPickerOpen) {
    return (
      <OfficerPicker
        officers={officers}
        selectedIds={activeOfficerIds}
        onLeader={(id) => setOfficerIds((current) => [id, ...current.slice(1).filter((candidate) => candidate !== id)])}
        onDeputy={(id) => setOfficerIds((current) => current.includes(id) ? current.filter((candidate) => candidate !== id) : [...current, id].slice(0, 3))}
        onConfirm={() => setOfficerPickerOpen(false)}
        onBack={() => setOfficerPickerOpen(false)}
        audio={audio}
      />
    );
  }

  return (
    <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()} onContextMenu={(event) => closePopupOnContextMenu(event, onClose, audio)}>
      <form ref={dialogRef} className="deploy-dialog tool-panel" role="dialog" aria-modal="true" aria-labelledby="deploy-title" onSubmit={submit}>
        <header>
          <div>
            <p>{city.name} · 行动力 20</p>
            <h2 id="deploy-title">出征编制</h2>
          </div>
          <button type="button" className="icon-button" aria-label="关闭出征编制" title="关闭" onClick={onClose}><X /></button>
        </header>

        <section className="deploy-left" aria-label="出征设定">
          <label className="officer-picker-field">
            <span>主将</span>
            <button type="button" aria-label="选择武将" className="officer-picker-trigger" onClick={() => setOfficerPickerOpen(true)}>
              <strong data-testid="deploy-officer-summary">{activeOfficerIds.map((id) => state.officers[id]?.name).filter(Boolean).join(' / ') || '未选择'}</strong>
              <small>点击选择 1 名主将、最多 2 名副将</small>
            </button>
          </label>

          <div className="deploy-troop-grid" aria-label="兵装选择">
            {TROOP_TYPES.map((type) => {
              const disabled = type.siegeWeapon ? cityArmaments[type.siegeWeapon] < 1 : false;
              const active = troopType === type.troopType && (!type.siegeWeapon || siegeWeapon === type.siegeWeapon);
              return (
                <button key={type.id} type="button" aria-label={type.label} disabled={disabled} className={`${active ? 'is-active' : ''}${disabled ? 'is-disabled' : ''}`} onClick={() => {
                  if (disabled) return;
                  setTroopType(type.troopType);
                  if (type.siegeWeapon) setSiegeWeapon(type.siegeWeapon);
                  setOfficerIds(recommendedOfficerIdsForTroop(availableOfficers, type.troopType));
                  setSubmitError(null);
                }}>
                  <Swords aria-hidden="true" />
                  <span>{type.label}</span>
                  <small>{type.siegeWeapon ? `${cityArmaments[type.siegeWeapon]}` : TROOP_ARMAMENT[type.troopType] ? `${cityArmaments[TROOP_ARMAMENT[type.troopType]!]}` : '不限'}</small>
                </button>
              );
            })}
          </div>

          <span className="deploy-section-label">交通工具</span>
          <div className="deploy-troop-grid vehicle-grid" aria-label="交通工具选择">
            {VEHICLE_TYPES.map((item) => {
              const disabled = item.id === 'ship' && shipStock < 1;
              return (
                <button key={item.id} type="button" aria-label={item.label} disabled={disabled} className={`${vehicle === item.id ? 'is-active' : ''}${disabled ? 'is-disabled' : ''}`} onClick={() => {
                  if (disabled) return;
                  setVehicle(item.id);
                  setSubmitError(null);
                }}>
                  <Swords aria-hidden="true" />
                  <span>{item.label}</span>
                  <small>{item.id === 'ship' ? `${shipStock}` : '免费'}</small>
                </button>
              );
            })}
          </div>

          <div className="amount-grid deploy-ranges">
            <label className="range-field">
              <span>士兵</span>
              <input id="deploy-troops" aria-label="出征士兵" type="range" min={troopMin} max={troopRangeMax} step="100" value={activeTroops} disabled={troopRangeDisabled} onChange={(event) => setTroops(event.target.value)} />
              <output htmlFor="deploy-troops" data-testid="deploy-troop-value" className={troopRangeDisabled ? 'is-disabled' : undefined}>{Number(activeTroops).toLocaleString('en-US')} / {troopRangeMax.toLocaleString('en-US')}</output>
            </label>
            <label className="range-field">
              <span>兵粮</span>
              <input id="deploy-food" aria-label="出征兵粮" type="range" min="0" max={foodMax} step="100" value={activeFood} onChange={(event) => setFood(event.target.value)} />
              <output htmlFor="deploy-food" data-testid="deploy-food-value">{Number(activeFood).toLocaleString('en-US')} / {foodMax.toLocaleString('en-US')}</output>
            </label>
            <label className="range-field">
              <span>资金</span>
              <input id="deploy-gold" aria-label="出征资金" type="range" min="0" max={goldMax} step="100" value={activeGold} onChange={(event) => setGold(event.target.value)} />
              <output htmlFor="deploy-gold" data-testid="deploy-gold-value">{Number(activeGold).toLocaleString('en-US')} / {goldMax.toLocaleString('en-US')}</output>
            </label>
          </div>
        </section>

        <aside className="deploy-right" aria-label="部队能力">
          <h3>部队能力 · 主将统率 {activeOfficer?.stats.leadership ?? 0}</h3>
          <div className="deploy-ability">
            <span>攻击</span><strong data-testid="deploy-attack">{ability.attack}</strong>
            <span>防御</span><strong data-testid="deploy-defense">{ability.defense}</strong>
            <span>智力</span><strong>{ability.intelligence}</strong>
            <span>建设</span><strong>{ability.construction}</strong>
            <span>移动</span><strong>{ability.movement}</strong>
          </div>
          <h3>据点库存</h3>
          <dl className="deploy-stock">
            <div><dt>士兵</dt><dd>{city.troops.toLocaleString('en-US')} → {Math.max(0, city.troops - Math.max(0, troopAmount)).toLocaleString('en-US')}</dd></div>
            <div><dt>兵粮</dt><dd>{city.food.toLocaleString('en-US')} → {Math.max(0, city.food - Math.max(0, foodAmount)).toLocaleString('en-US')}</dd></div>
            <div><dt>兵装</dt><dd>{armamentStock === null ? '剑兵不限' : `${armamentStock.toLocaleString('en-US')} → ${Math.max(0, armamentStock - Math.max(0, troopAmount)).toLocaleString('en-US')}`}</dd></div>
            <div><dt>资金</dt><dd>{city.gold.toLocaleString('en-US')} → {Math.max(0, city.gold - Math.max(0, goldAmount)).toLocaleString('en-US')}</dd></div>
          </dl>
        </aside>

        {(errors.length > 0 || submitError) && (
          <div className="validation-errors deploy-errors" role="alert"><AlertCircle /> <span>{submitError ?? errors.join('；')}</span></div>
        )}

        <footer>
          <button type="button" className="secondary-button" onClick={onClose}>返回</button>
          <button type="submit" className="primary-button" disabled={errors.length > 0}>确定出征</button>
        </footer>
      </form>
    </div>
  );
}
