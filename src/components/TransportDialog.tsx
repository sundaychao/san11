import { AlertCircle, X } from 'lucide-react';
import { useRef, useState, type FormEvent } from 'react';
import { useAudioEventAdapter } from '../audio/reactAudioEventAdapter';
import { ARMAMENT_TYPES, armamentLabelFor, armamentsOf, emptyArmaments } from '../game/armaments';
import { DEPLOY_AP_COST } from '../game/battle/actions';
import { movementAllowanceForProfile, TERRAIN_COST_BY_PROFILE, TRANSPORT_COMBAT_RATING } from '../game/battle/catalog';
import { TRANSPORT_TROOP_CAP } from '../game/battle/deployment';
import { effectiveStat } from '../game/health';
import { officerSkillsText } from '../game/skills';
import { useGame } from '../game/store/GameProvider';
import { moraleCapOf } from '../game/techs';
import { UNIT_FOOD_PER_TEN_THOUSAND_TROOPS } from '../game/turn';
import type { ArmamentType, CityArmaments, CityId, Officer, PassId } from '../game/types';
import { FORMATION_OFFICER_MAX, FormationOfficerPicker } from './FormationOfficerPicker';
import { OfficerHealthBadge } from './OfficerHealthBadge';
import { closePopupOnContextMenu } from './popupEvents';

export interface TransportConfirmInput {
  /** 出发城池 id（从城池输送时） */
  cityId?: CityId;
  /** 出发关隘 id（从关隘输送时；与 cityId 二选一） */
  passId?: PassId;
  /** 押运编制：主将 + 最多 2 名副将（与出征同口径） */
  officerIds: string[];
  troops: number;
  gold: number;
  food: number;
  /** 押运的兵装（货物）：并账时整件返还，见 `strongholds.returnArmamentsToStronghold` */
  armaments?: Partial<CityArmaments>;
}

interface TransportDialogProps {
  cityId?: CityId;
  passId?: PassId;
  onConfirm(input: TransportConfirmInput): void;
  onClose(): void;
}

/** 兵科名：运输队没有 `TroopType`，面板上的「兵科」一栏用这个常量。 */
const TRANSPORT_TROOP_KIND_LABEL = '输送';

function toAmount(value: string) {
  const amount = Number(value);
  return Number.isFinite(amount) ? amount : -1;
}

function clampAmount(value: number, max: number) {
  return Math.min(max, Math.max(0, Number.isFinite(value) ? Math.round(value) : 0));
}

/** 押运清单：士兵 / 资金 / 兵粮 各一份，兵装按类型各一份 */
interface TransportLoad {
  troops: number;
  gold: number;
  food: number;
  armaments: CityArmaments;
}

export function TransportDialog({ cityId, passId, onClose, onConfirm }: TransportDialogProps) {
  const { state } = useGame();
  const audio = useAudioEventAdapter();
  const [officerIds, setOfficerIds] = useState<string[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [draft, setDraft] = useState<TransportLoad | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLFormElement>(null);

  if (!state) return null;
  const pass = passId ? state.passes?.[passId] : undefined;
  const source = pass ?? (cityId ? state.cities[cityId] : undefined);
  if (!source) return null;
  const ownerForceId = source.ownerId ?? state.playerForceId;
  const officers = Object.values(state.officers).filter((officer) => (
    officer.forceId === state.playerForceId &&
    (pass
      ? officer.location.kind === 'pass' && officer.location.passId === passId
      : officer.location.kind === 'city' && officer.location.cityId === cityId)
  ));
  const availableOfficers = officers.filter((officer) => !officer.acted);
  // 默认主将取据点第一名可行动武将（与出征一致：不预置副将）
  const selectedIds = officerIds.filter((id) => availableOfficers.some((officer) => officer.id === id));
  const activeOfficerIds = selectedIds.length > 0 ? selectedIds : (availableOfficers[0] ? [availableOfficers[0].id] : []);
  const activeOfficers = activeOfficerIds
    .map((id) => state.officers[id])
    .filter((officer): officer is Officer => Boolean(officer));
  const leader = activeOfficers[0];

  const stock = armamentsOf(source.armaments);
  const goldMax = Math.max(0, source.gold);
  const foodMax = Math.max(0, source.food);
  const troopMax = Math.min(TRANSPORT_TROOP_CAP, Math.max(0, source.troops - 500));
  const maxLoad: TransportLoad = { troops: troopMax, gold: goldMax, food: foodMax, armaments: stock };
  const defaultLoad: TransportLoad = {
    troops: Math.min(1000, troopMax),
    gold: Math.min(1000, goldMax),
    food: Math.min(3000, foodMax),
    armaments: emptyArmaments(),
  };
  const rawLoad = draft ?? defaultLoad;
  const clampLoad = (value: TransportLoad): TransportLoad => ({
    troops: clampAmount(value.troops, troopMax),
    gold: clampAmount(value.gold, goldMax),
    food: clampAmount(value.food, foodMax),
    armaments: ARMAMENT_TYPES.reduce((acc, type) => {
      acc[type] = clampAmount(value.armaments[type], stock[type]);
      return acc;
    }, emptyArmaments()),
  });
  const load = clampLoad(rawLoad);
  const patchLoad = (patch: Partial<TransportLoad>) => {
    setDraft(clampLoad({ ...load, ...patch }));
    setSubmitError(null);
  };
  const setArmament = (type: ArmamentType, amount: number) => {
    patchLoad({ armaments: { ...load.armaments, [type]: amount } });
  };
  const carriedArmaments = ARMAMENT_TYPES.reduce((acc, type) => {
    if (load.armaments[type] > 0) acc[type] = load.armaments[type];
    return acc;
  }, {} as Partial<CityArmaments>);

  const troopAmount = load.troops;
  const goldAmount = load.gold;
  const foodAmount = load.food;
  const carriesSomething = troopAmount > 0 || goldAmount > 0 || foodAmount > 0 || Object.keys(carriedArmaments).length > 0;

  const ability = (() => {
    const bestOf = (key: 'intelligence' | 'politics') => activeOfficers.reduce(
      (best, officer) => Math.max(best, effectiveStat(officer, key)),
      0,
    );
    return {
      attack: TRANSPORT_COMBAT_RATING,
      defense: TRANSPORT_COMBAT_RATING,
      intelligence: bestOf('intelligence'),
      construction: bestOf('politics'),
      movement: movementAllowanceForProfile('transport'),
    };
  })();

  // 运输队只有一种移动形态（`movementProfileForUnit` → `'transport'`），行军一栏固定按
  // 平地口径给参考值，不再做陆上/水上切换。
  const marchCost = TERRAIN_COST_BY_PROFILE.transport.plain;
  const marchTiles = Number.isFinite(marchCost) && marchCost > 0 ? Math.floor(ability.movement / marchCost) : 0;
  const moraleCap = moraleCapOf(state, ownerForceId);
  // 押运兵粮可支撑旬数：与 turn.settleUnitSupply 同口径（每万兵每旬 1000 粮），
  // 据点外设施补给系数未知，故文案给「约」。
  const foodPerTenDays = Math.ceil((troopAmount * UNIT_FOOD_PER_TEN_THOUSAND_TROOPS) / 10000);
  const foodDays = foodPerTenDays > 0 ? Math.floor(foodAmount / foodPerTenDays) * 10 : 0;

  const errors = [
    state.actionPoints[state.playerForceId] < DEPLOY_AP_COST ? `行动力不足 ${DEPLOY_AP_COST}` : '',
    !leader ? '没有可执行输送的武将' : '',
    !carriesSomething ? '至少输送一种资源' : '',
  ].filter(Boolean);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (errors.length > 0) return;
    try {
      onConfirm({
        ...(passId ? { passId } : { cityId }),
        officerIds: activeOfficerIds,
        troops: troopAmount,
        gold: goldAmount,
        food: foodAmount,
        ...(Object.keys(carriedArmaments).length > 0 ? { armaments: carriedArmaments } : {}),
      });
      onClose();
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : '输送失败');
    }
  };

  if (pickerOpen) {
    return (
      <FormationOfficerPicker
        officers={officers}
        selectedIds={activeOfficerIds}
        subtitle="输送人员编制"
        listLabel="可押运武将"
        onLeader={(id) => setOfficerIds((current) => [id, ...current.slice(1).filter((candidate) => candidate !== id)])}
        onDeputy={(id) => setOfficerIds((current) => current.includes(id)
          ? current.filter((candidate) => candidate !== id)
          : [...current, id].slice(0, FORMATION_OFFICER_MAX))}
        onConfirm={() => setPickerOpen(false)}
        onBack={() => setPickerOpen(false)}
        audio={audio}
      />
    );
  }

  // 兵装条与资源条共用一套「拖动条 + 现量/上限」行
  const loadRow = (
    key: string,
    label: string,
    opts: { value: number; max: number; step: number; disabled?: boolean; note?: string; onChange(value: number): void },
  ) => {
    const inputId = `transport-load-${key}`;
    return (
      <label className={`range-field transport-range${opts.disabled ? ' is-disabled' : ''}`} key={key}>
        <span>{label}</span>
        <input
          id={inputId}
          aria-label={`输送${label}`}
          type="range"
          min={0}
          max={Math.max(0, opts.max)}
          step={opts.step}
          value={opts.value}
          disabled={opts.disabled || opts.max <= 0}
          onChange={(event) => opts.onChange(toAmount(event.target.value))}
        />
        <output htmlFor={inputId} className={opts.disabled || opts.max <= 0 ? 'is-disabled' : undefined}>
          {opts.value.toLocaleString('en-US')}/{opts.max.toLocaleString('en-US')}{opts.note ?? ''}
        </output>
      </label>
    );
  };

  const officerSlot = (slot: 'leader' | 'deputy', index: number) => {
    const officer = slot === 'leader' ? activeOfficers[0] : activeOfficers[index + 1];
    const label = slot === 'leader' ? '主将' : `副将 ${index + 1}`;
    return (
      <div className={`transport-officer-slot${slot === 'leader' ? ' is-leader' : ''}${officer ? '' : ' is-empty'}`} key={label} data-testid={`transport-officer-${slot === 'leader' ? 'leader' : `deputy-${index + 1}`}`}>
        <span>{label}</span>
        <strong>{officer?.name ?? '未选择'}</strong>
        {officer ? (
          <>
            <small>统{effectiveStat(officer, 'leadership')} 政{effectiveStat(officer, 'politics')}<OfficerHealthBadge officer={officer} /></small>
            <em>{officerSkillsText(officer)}</em>
          </>
        ) : <small>—</small>}
      </div>
    );
  };

  return (
    <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()} onContextMenu={(event) => closePopupOnContextMenu(event, onClose, audio)}>
      <form ref={dialogRef} className="deploy-dialog transport-dialog tool-panel" role="dialog" aria-modal="true" aria-labelledby="transport-title" onSubmit={submit}>
        <header>
          <div>
            <p>{source.name}</p>
            <h2 id="transport-title">输送编制</h2>
          </div>
          <button type="button" className="icon-button" aria-label="关闭输送编制" title="关闭" onClick={onClose}><X /></button>
        </header>

        <section className="deploy-left" aria-label="输送设定">
          <span className="deploy-section-label">
            武将
            <small className="transport-officer-hint">点击进入武将列表，选 1 名主将、最多 2 名副将</small>
          </span>
          <button type="button" className="transport-officer-panel" aria-label="选择押运武将" data-testid="transport-officer-trigger" onClick={() => setPickerOpen(true)}>
            {officerSlot('leader', 0)}
            {officerSlot('deputy', 0)}
            {officerSlot('deputy', 1)}
          </button>

          <span className="deploy-section-label">兵装</span>
          <div className="transport-range-group" aria-label="输送兵装">
            {ARMAMENT_TYPES.map((type) => loadRow(type, armamentLabelFor(state, ownerForceId, type), {
              value: load.armaments[type],
              max: stock[type],
              step: 1,
              onChange: (amount) => setArmament(type, amount),
            }))}
          </div>

          <span className="deploy-section-label">资源</span>
          <div className="transport-range-group" aria-label="输送资源">
            {loadRow('troops', '士兵', { value: troopAmount, max: troopMax, step: 100, onChange: (amount) => patchLoad({ troops: amount }) })}
            {loadRow('gold', '资金', { value: goldAmount, max: goldMax, step: 100, onChange: (amount) => patchLoad({ gold: amount }) })}
            {loadRow('food', '兵粮', {
              value: foodAmount,
              max: foodMax,
              step: 100,
              note: foodPerTenDays > 0 ? ` 约${foodDays}日` : '',
              onChange: (amount) => patchLoad({ food: amount }),
            })}
          </div>

          <div className="transport-footer-row">
            <div className="transport-bulk">
              <button type="button" className="secondary-button" onClick={() => setDraft(clampLoad(maxLoad))}>一括最大</button>
              <button type="button" className="secondary-button" onClick={() => setDraft(clampLoad({ ...load, troops: 0, gold: 0, food: 0, armaments: emptyArmaments() }))}>一括最小</button>
            </div>
            <div className="transport-ap" aria-label="行动力">
              <span>行动力</span>
              <strong data-testid="transport-ap">{state.actionPoints[state.playerForceId]}</strong>
              <small>耗 {DEPLOY_AP_COST}</small>
            </div>
          </div>
        </section>

        <aside className="deploy-right" aria-label="部队能力">
          <h3>部队能力</h3>
          <div className="transport-ability-line">
            <span>攻击<strong data-testid="transport-attack">{ability.attack}</strong></span>
            <span>防御<strong data-testid="transport-defense">{ability.defense}</strong></span>
            <span>智力<strong data-testid="transport-intelligence">{ability.intelligence}</strong></span>
            <span>建设<strong data-testid="transport-construction">{ability.construction}</strong></span>
            <span>移动<strong data-testid="transport-movement">{ability.movement}</strong></span>
          </div>
          <dl className="transport-facts">
            <div><dt>兵科</dt><dd>{TRANSPORT_TROOP_KIND_LABEL}</dd></div>
            <div><dt>士气</dt><dd data-testid="transport-morale">{Math.min(moraleCap, source.training)}/{moraleCap}</dd></div>
            <div><dt>行军</dt><dd>{Number.isFinite(marchCost) ? `平地 ${marchCost}/格 · 约 ${marchTiles} 格` : '不可通行'}</dd></div>
          </dl>

          <h3>据点库存</h3>
          <dl className="deploy-stock">
            {ARMAMENT_TYPES.map((type) => (
              <div key={type}>
                <dt>{armamentLabelFor(state, ownerForceId, type)}</dt>
                <dd data-testid={`transport-stock-${type}`}>{stock[type].toLocaleString('en-US')} → {Math.max(0, stock[type] - load.armaments[type]).toLocaleString('en-US')}</dd>
              </div>
            ))}
            <div><dt>士兵</dt><dd data-testid="transport-stock-troops">{source.troops.toLocaleString('en-US')} → {Math.max(0, source.troops - troopAmount).toLocaleString('en-US')}</dd></div>
            <div><dt>资金</dt><dd data-testid="transport-stock-gold">{source.gold.toLocaleString('en-US')} → {Math.max(0, source.gold - goldAmount).toLocaleString('en-US')}</dd></div>
            <div><dt>兵粮</dt><dd data-testid="transport-stock-food">{source.food.toLocaleString('en-US')} → {Math.max(0, source.food - foodAmount).toLocaleString('en-US')}</dd></div>
          </dl>
          <p className="deploy-note">兵装按「货物」押运，并入据点时<strong>整件返还</strong>。</p>
        </aside>

        {(errors.length > 0 || submitError) && (
          <div className="validation-errors deploy-errors" role="alert"><AlertCircle /> <span>{submitError ?? errors.join('；')}</span></div>
        )}

        <footer>
          <button type="button" className="secondary-button" onClick={onClose}>返回</button>
          <button type="submit" className="primary-button" disabled={errors.length > 0}>确定输送</button>
        </footer>
      </form>
    </div>
  );
}
