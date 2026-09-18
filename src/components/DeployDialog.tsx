import { AlertCircle, Swords, X } from 'lucide-react';
import { useMemo, useRef, useState, type FormEvent } from 'react';
import { useAudioEventAdapter } from '../audio/reactAudioEventAdapter';
import { armamentLabelFor, armamentsOf, siegeWeaponKindOf, TROOP_ARMAMENT, TROOP_LABELS, TROOP_MOVEMENT, vehicleLabelFor } from '../game/armaments';
import { unitFoodDaysOf } from '../game/innerAffairs';
import { DEPLOY_AP_COST } from '../game/battle/actions';
import type { TroopCombatForm } from '../game/battle/catalog';
import { troopCombatRating } from '../game/battle/officerAbilities';
import { unitTroopCapOf } from '../game/ranks';
import { effectiveStat } from '../game/health';
import { troopAttackTechBonus, troopDefenseTechBonus } from '../game/techs';
import { useGame } from '../game/store/GameProvider';
import type { CityId, ForceId, GameState, Officer, OfficerAptitudes, PassId, Stats, TroopType } from '../game/types';
import { FORMATION_OFFICER_MAX, FormationOfficerPicker, aptitudeRank, fallbackAptitudes } from './FormationOfficerPicker';
import { closePopupOnContextMenu } from './popupEvents';

export interface DeployConfirmInput {
  /** 出发城池 id（从城池出征时） */
  cityId?: CityId;
  /** 出发关隘 id（从关隘出征时；与 cityId 二选一） */
  passId?: PassId;
  officerIds: string[];
  troopType: TroopType;
  vehicle: 'boat' | 'ship';
  siegeWeapon?: 'ram' | 'tower';
  troops: number;
  gold: number;
  food: number;
}

interface DeployDialogProps {
  cityId?: CityId;
  passId?: PassId;
  onConfirm(input: DeployConfirmInput): void;
  onClose(): void;
}

interface DeployTroopOption {
  id: string;
  /** 静态显示名：**仅非兵器项使用**。兵器项（ram/tower）的显示名吃势力科技（冲车/木兽、井阑/投石车），
   *  渲染时由 `troopTypeLabelOf` 现取，故不在此维护，避免两处文案漂移。 */
  label?: string;
  troopType: TroopType;
  siegeWeapon?: 'ram' | 'tower';
  movement: number;
}

/**
 * 出征可选的兵种项。基础攻防**不在这里维护**——由 `TROOP_BASE_ATTACK/DEFENSE`（catalog.ts）
 * 按战斗形态现取，右侧「攻击 / 防御」面板见 `officerAbility`。
 */
const TROOP_TYPES: DeployTroopOption[] = [
  { id: 'sword', troopType: 'sword', label: '剑兵', movement: 22 },
  { id: 'spear', troopType: 'spear', label: '枪兵', movement: 22 },
  { id: 'halberd', troopType: 'halberd', label: '戟兵', movement: 20 },
  { id: 'crossbow', troopType: 'crossbow', label: '弩兵', movement: 19 },
  { id: 'cavalry', troopType: 'cavalry', label: '骑兵', movement: 30 },
  { id: 'ram', troopType: 'siege', siegeWeapon: 'ram', movement: 16 },
  { id: 'tower', troopType: 'siege', siegeWeapon: 'tower', movement: 16 },
];
const VEHICLE_TYPES: Array<{ id: 'boat' | 'ship'; label: string }> = [
  { id: 'boat', label: '小舟' },
  { id: 'ship', label: '楼船' },
];

/**
 * 出征兵种显示名（吃科技）：兵器项按势力科技取「冲车/木兽」「井阑/投石车」。
 * `TROOP_TYPES` 里的 `label` 保留为非兵器项的静态文案，存储口径仍是 `siegeWeapon: 'ram' | 'tower'`。
 */
function troopTypeLabelOf(state: GameState, forceId: ForceId | null | undefined, type: DeployTroopOption): string {
  return type.siegeWeapon ? armamentLabelFor(state, forceId, type.siegeWeapon) : type.label ?? TROOP_LABELS[type.troopType];
}

/** 兵器兵种项（按 siegeWeapon 取）：用于「XX不足」这类只有兵装类型、没有兵种项的文案 */
function siegeTroopLabelOf(state: GameState, forceId: ForceId | null | undefined, siegeWeapon: 'ram' | 'tower'): string {
  const type = TROOP_TYPES.find((item) => item.siegeWeapon === siegeWeapon);
  return type ? troopTypeLabelOf(state, forceId, type) : armamentLabelFor(state, forceId, siegeWeapon);
}

/** 载具显示名（吃科技）：造船术把楼船显示为斗舰 */
function vehicleTypeLabelOf(state: GameState, forceId: ForceId | null | undefined, id: 'boat' | 'ship'): string {
  return vehicleLabelFor(state, forceId, id);
}
function toAmount(value: string) {
  const amount = Number(value);
  return Number.isFinite(amount) ? amount : -1;
}

/**
 * 出征界面的部队能力预览。
 * 攻击 / 防御 = floor(编队最高统率 × 编队最高兵种适性乘数 × 兵种基础攻防 / 100)。
 * 兵种基础攻防吃科技：冲车→木兽、井阑→投石车（与显示名同源）；剑兵无适性，乘数按 1.0 计。
 * 武器精造 / 防具精造（各＋10）直接加在基础攻防上，与战斗结算 `unitCombatRating` 同口径
 * ——不然玩家在这里看到的数字会低于实际参战值。
 */
function officerAbility(
  state: GameState,
  forceId: ForceId | null | undefined,
  officers: Officer[],
  troopType: TroopType,
  siegeWeapon: 'ram' | 'tower',
) {
  // 无归属势力时不做科技升级，直接用冲车 / 井阑的基础值
  const form: TroopCombatForm = troopType !== 'siege'
    ? troopType
    : forceId
      ? siegeWeaponKindOf(state, { forceId, siegeWeapon }) ?? siegeWeapon
      : siegeWeapon;
  // 出征预览阶段尚未选定载具，按陆战计（与 form 的解析口径一致）
  const techProbe = { kind: 'combat' as const, troopType, vehicle: undefined };
  const rating = troopCombatRating({
    officers,
    form,
    aptitudeKey: troopType === 'sword' ? null : troopType,
    bonusAttack: troopAttackTechBonus(state, forceId, techProbe),
    bonusDefense: troopDefenseTechBonus(state, forceId, techProbe),
  });
  const bestOf = (key: keyof Stats) => officers.reduce(
    (best, officer) => Math.max(best, effectiveStat(officer, key)),
    0,
  );
  return {
    attack: rating.attack,
    defense: rating.defense,
    leadership: bestOf('leadership'),
    intelligence: bestOf('intelligence'),
    construction: bestOf('politics'),
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

export function DeployDialog({ cityId, passId, onClose, onConfirm }: DeployDialogProps) {
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
  const pass = passId ? state.passes?.[passId] : undefined;
  const source = pass ?? (cityId ? state.cities[cityId] : undefined);
  if (!source) return null;
  const officers = Object.values(state.officers).filter((officer) => (
    officer.forceId === state.playerForceId &&
    (pass
      ? officer.location.kind === 'pass' && officer.location.passId === passId
      : officer.location.kind === 'city' && officer.location.cityId === cityId)
  ));
  const availableOfficers = officers.filter((officer) => !officer.acted);
  const recommendedOfficerIds = recommendedOfficerIdsForTroop(availableOfficers, troopType);
  const selectedAvailableIds = officerIds.filter((id) => availableOfficers.some((officer) => officer.id === id));
  const activeOfficerIds = selectedAvailableIds.length > 0 ? selectedAvailableIds : recommendedOfficerIds;
  const activeOfficerId = activeOfficerIds[0] ?? '';
  const activeOfficers = activeOfficerIds
    .map((id) => state.officers[id])
    .filter((officer): officer is Officer => Boolean(officer));
  const armamentType = TROOP_ARMAMENT[troopType];
  // 显示名按出发据点的归属势力科技取值（出征只对本方据点开放，ownerId 即本方势力）；
  // 无主据点（ownerId === null）由 armamentLabelFor/vehicleLabelFor 自带回落。
  const ownerForceId = source.ownerId ?? state.playerForceId;
  const cityArmaments = armamentsOf(source.armaments);
  const armamentStock = armamentType ? cityArmaments[armamentType] : null;
  const shipStock = cityArmaments.ship;
  const leaderCap = unitTroopCapOf(state, state.playerForceId, activeOfficerId);
  const troopMax = Math.min(
    leaderCap,
    Math.max(0, source.troops - 500),
    armamentStock ?? Number.POSITIVE_INFINITY,
  );
  const troopMin = 1000;
  const troopRangeDisabled = troopMax < troopMin || leaderCap < troopMin;
  const troopRangeMax = Math.max(troopMin, troopMax);
  const activeTroops = String(troopRangeDisabled
    ? troopMin
    : Math.min(troopMax, Math.max(troopMin, toAmount(troops || String(Math.min(4000, troopMax))))));
  const goldMax = Math.max(0, source.gold);
  const activeGold = String(Math.min(goldMax, Math.max(0, toAmount(gold || String(Math.min(1000, goldMax))))));
  const foodMax = Math.max(0, source.food);
  const activeFood = String(Math.min(foodMax, Math.max(0, toAmount(food || String(Math.min(6000, foodMax))))));
  const troopAmount = toAmount(activeTroops);
  const goldAmount = toAmount(activeGold);
  const foodAmount = toAmount(activeFood);
  // 携带兵粮可支撑天数（随兵粮/士兵拖动实时刷新，按旬粒度取整）
  const foodDays = unitFoodDaysOf(foodAmount, troopAmount);
  const ability = useMemo(
    () => officerAbility(state, ownerForceId, activeOfficers, troopType, siegeWeapon),
    [state, ownerForceId, activeOfficers, troopType, siegeWeapon],
  );
  const errors = [
    state.actionPoints[state.playerForceId] < DEPLOY_AP_COST ? `行动力不足 ${DEPLOY_AP_COST}` : '',
    !activeOfficerId ? '没有可出征武将' : '',
    !Number.isInteger(troopAmount) || troopAmount < 1000 || troopAmount > leaderCap ? `士兵必须为 1000-${leaderCap}` : '',
    source.troops - troopAmount < 500 ? '城市至少保留 500 兵力' : '',
    !Number.isInteger(goldAmount) || goldAmount < 0 || goldAmount > source.gold ? '资金不足' : '',
    !Number.isInteger(foodAmount) || foodAmount < 0 || foodAmount > source.food ? '兵粮不足' : '',
    armamentType && armamentStock !== null && armamentStock < troopAmount ? `${TROOP_LABELS[troopType]}兵装不足` : '',
    vehicle === 'ship' && shipStock < 1 ? `${vehicleTypeLabelOf(state, ownerForceId, 'ship')}兵装不足` : '',
    troopType === 'siege' && cityArmaments[siegeWeapon] < 1 ? `${siegeTroopLabelOf(state, ownerForceId, siegeWeapon)}不足` : '',
  ].filter(Boolean);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (errors.length > 0) return;
    try {
      onConfirm({
        ...(passId ? { passId } : { cityId }),
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
      <FormationOfficerPicker
        officers={officers}
        selectedIds={activeOfficerIds}
        subtitle="出征人员编制"
        listLabel="可出征武将"
        onLeader={(id) => setOfficerIds((current) => [id, ...current.slice(1).filter((candidate) => candidate !== id)])}
        onDeputy={(id) => setOfficerIds((current) => current.includes(id) ? current.filter((candidate) => candidate !== id) : [...current, id].slice(0, FORMATION_OFFICER_MAX))}
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
            <p>{source.name} · 行动力 20</p>
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
              const troopLabel = troopTypeLabelOf(state, ownerForceId, type);
              return (
                <button key={type.id} type="button" aria-label={troopLabel} disabled={disabled} className={`${active ? 'is-active' : ''}${disabled ? 'is-disabled' : ''}`} onClick={() => {
                  if (disabled) return;
                  setTroopType(type.troopType);
                  if (type.siegeWeapon) setSiegeWeapon(type.siegeWeapon);
                  setOfficerIds(recommendedOfficerIdsForTroop(availableOfficers, type.troopType));
                  setSubmitError(null);
                }}>
                  <Swords aria-hidden="true" />
                  <span>{troopLabel}</span>
                  <small>{type.siegeWeapon ? `${cityArmaments[type.siegeWeapon]}` : TROOP_ARMAMENT[type.troopType] ? `${cityArmaments[TROOP_ARMAMENT[type.troopType]!]}` : '不限'}</small>
                </button>
              );
            })}
          </div>

          <span className="deploy-section-label">交通工具</span>
          <div className="deploy-troop-grid vehicle-grid" aria-label="交通工具选择">
            {VEHICLE_TYPES.map((item) => {
              const disabled = item.id === 'ship' && shipStock < 1;
              const vehicleLabel = vehicleTypeLabelOf(state, ownerForceId, item.id);
              return (
                <button key={item.id} type="button" aria-label={vehicleLabel} disabled={disabled} className={`${vehicle === item.id ? 'is-active' : ''}${disabled ? 'is-disabled' : ''}`} onClick={() => {
                  if (disabled) return;
                  setVehicle(item.id);
                  setSubmitError(null);
                }}>
                  <Swords aria-hidden="true" />
                  <span>{vehicleLabel}</span>
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
              <output htmlFor="deploy-food" data-testid="deploy-food-value">{Number(activeFood).toLocaleString('en-US')} / {foodMax.toLocaleString('en-US')}<span data-testid="deploy-food-days" className="deploy-food-days" title="携带兵粮可支撑天数（按旬取整）"> {foodDays}</span></output>
            </label>
            <label className="range-field">
              <span>资金</span>
              <input id="deploy-gold" aria-label="出征资金" type="range" min="0" max={goldMax} step="100" value={activeGold} onChange={(event) => setGold(event.target.value)} />
              <output htmlFor="deploy-gold" data-testid="deploy-gold-value">{Number(activeGold).toLocaleString('en-US')} / {goldMax.toLocaleString('en-US')}</output>
            </label>
          </div>
        </section>

        <aside className="deploy-right" aria-label="部队能力">
          <h3>部队能力 · 部队最高统率 {ability.leadership}</h3>
          <div className="deploy-ability">
            <span>攻击</span><strong data-testid="deploy-attack">{ability.attack}</strong>
            <span>防御</span><strong data-testid="deploy-defense">{ability.defense}</strong>
            <span>智力</span><strong>{ability.intelligence}</strong>
            <span>建设</span><strong>{ability.construction}</strong>
            <span>移动</span><strong>{ability.movement}</strong>
          </div>
          <h3>据点库存</h3>
          <dl className="deploy-stock">
            <div><dt>士兵</dt><dd>{source.troops.toLocaleString('en-US')} → {Math.max(0, source.troops - Math.max(0, troopAmount)).toLocaleString('en-US')}</dd></div>
            <div><dt>兵粮</dt><dd>{source.food.toLocaleString('en-US')} → {Math.max(0, source.food - Math.max(0, foodAmount)).toLocaleString('en-US')}</dd></div>
            <div><dt>兵装</dt><dd>{armamentStock === null ? '剑兵不限' : `${armamentStock.toLocaleString('en-US')} → ${Math.max(0, armamentStock - Math.max(0, troopAmount)).toLocaleString('en-US')}`}</dd></div>
            <div><dt>资金</dt><dd>{source.gold.toLocaleString('en-US')} → {Math.max(0, source.gold - Math.max(0, goldAmount)).toLocaleString('en-US')}</dd></div>
          </dl>
          <p className="deploy-note">带走的兵装随部队移动：回城/进军据点时，枪戟弩马按存活士兵返还，{vehicleTypeLabelOf(state, ownerForceId, 'ship')}/{armamentLabelFor(state, ownerForceId, 'ram')}/{armamentLabelFor(state, ownerForceId, 'tower')}整件返还。</p>
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
