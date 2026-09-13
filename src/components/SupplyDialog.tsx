import { AlertCircle, X } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { ARMAMENT_SUPPLY_LABELS, suppliableArmamentOf, supplyHeadroomOf, supplyTroopMaxOf, type SupplyArmament } from '../game/battle/supply';
import { useAudioEventAdapter } from '../audio/reactAudioEventAdapter';
import { useGame } from '../game/store/GameProvider';
import { moraleCapOf } from '../game/techs';
import { UNIT_FOOD_PER_TEN_THOUSAND_TROOPS } from '../game/turn';
import type { GameState } from '../game/types';
import { closePopupOnContextMenu } from './popupEvents';

export interface SupplyAmountInput {
  troops: number;
  gold: number;
  food: number;
  armaments?: Partial<SupplyArmament>;
}

interface SupplyDialogProps {
  unitId: string;
  targetId: string;
  /** 出城跟随补给：部队尚未真正落位，读数走落位预演态（资源已扣、武将已出城） */
  previewState?: GameState;
  onConfirm(amount: SupplyAmountInput): void;
  onClose(): void;
}

/** 兵粮可支撑日数：与 turn.settleUnitSupply / TransportDialog 同口径（每万兵每旬 1000 粮） */
function foodDaysOf(troops: number, food: number) {
  const perTenDays = Math.ceil((troops * UNIT_FOOD_PER_TEN_THOUSAND_TROOPS) / 10000);
  return perTenDays > 0 ? Math.floor(food / perTenDays) * 10 : 0;
}

function unitLabel(state: GameState, unitId: string) {
  const unit = state.units[unitId];
  return `${state.officers[unit.leaderId]?.name ?? '部队'}队`;
}

/**
 * 运输队 → 相邻己方作战部队的野外补给页（参考原版截图，按要求不画五维与雷达）。
 * 拖动条上限 = min(运输队携带量, 接收部队剩余容量)；接收容量：
 * 兵力 = 主将带兵上限、资金 10000、兵粮 50000（`battle/supply.ts`）。
 * 兵装无独立拖动条：按接收部队兵种判定，补给士兵时每兵一件随带对应兵装，
 * 士兵上限另受运输队该兵装携带量约束（`supplyTroopMaxOf`）。
 */
export function SupplyDialog({ unitId, targetId, previewState, onConfirm, onClose }: SupplyDialogProps) {
  const { state: realState } = useGame();
  const audio = useAudioEventAdapter();
  const [amount, setAmount] = useState<SupplyAmountInput>({ troops: 0, gold: 0, food: 0 });
  const [submitError, setSubmitError] = useState<string | null>(null);

  const state = previewState ?? realState;
  if (!state) return null;
  const giver = state.units[unitId];
  const receiver = state.units[targetId];
  if (!giver || !receiver) return null;
  const forceId = giver.forceId;

  const headroom = supplyHeadroomOf(state, forceId, receiver);
  // 兵装：按接收部队兵种判定，补给士兵时每兵一件随带对应兵装（无独立拖动条）
  const armamentType = suppliableArmamentOf(receiver.troopType);
  const armamentLabel = armamentType ? ARMAMENT_SUPPLY_LABELS[armamentType] ?? '' : '';
  const armamentHeldOf = (unit: typeof giver) => (armamentType ? unit.armaments?.[armamentType] ?? 0 : 0);
  // 士兵上限 = min(运输队士兵数, 运输队该兵装携带量, 接收部队带兵余量)；
  // 运输队没带对应兵装时一名兵都补不了（剑兵/攻城器无对应兵装，不受此卡口）
  const troopsDisabledReason = armamentType && (giver.armaments?.[armamentType] ?? 0) <= 0
    ? `运输队未携带${armamentLabel}，无法按每兵一件补给士兵`
    : null;
  // 单项上限 = 运输队携带量与接收方剩余容量取较小；资金字段旧存档可能缺失，按 0
  const maxTransfer = {
    troops: supplyTroopMaxOf(giver, receiver, headroom.troops),
    gold: Math.min(giver.gold ?? 0, headroom.gold),
    food: Math.min(giver.food, headroom.food),
  };
  const clampAmount = (value: SupplyAmountInput): SupplyAmountInput => {
    const troops = Math.min(maxTransfer.troops, Math.max(0, Math.round(value.troops) || 0));
    return {
      troops,
      gold: Math.min(maxTransfer.gold, Math.max(0, Math.round(value.gold) || 0)),
      food: Math.min(maxTransfer.food, Math.max(0, Math.round(value.food) || 0)),
      // 兵装与士兵 1:1 联动，随士兵一并转移
      armaments: armamentType && troops > 0 ? { [armamentType]: troops } : undefined,
    };
  };
  const current = clampAmount(amount);
  const currentArmament = armamentType ? current.troops : 0;
  const patch = (part: Partial<SupplyAmountInput>) => {
    setAmount(clampAmount({ ...current, ...part }));
    setSubmitError(null);
  };

  const after = {
    giver: {
      troops: giver.troops - current.troops,
      gold: (giver.gold ?? 0) - current.gold,
      food: giver.food - current.food,
      armament: armamentHeldOf(giver) - currentArmament,
    },
    receiver: {
      troops: receiver.troops + current.troops,
      gold: (receiver.gold ?? 0) + current.gold,
      food: receiver.food + current.food,
      armament: armamentHeldOf(receiver) + currentArmament,
    },
  };
  const carriesSomething = current.troops > 0 || current.gold > 0 || current.food > 0 || currentArmament > 0;

  const moraleCap = moraleCapOf(state, forceId);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!carriesSomething) return;
    try {
      onConfirm(current);
      onClose();
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : '补给失败');
    }
  };

  // 双栏面板：左运输队右接收队，各显示 士气 + 士兵/资金/兵粮/兵装 的 当前 → 补给后
  const partyPanel = (role: 'giver' | 'receiver', troops: number, gold: number, food: number, morale: number, armament: number) => (
    <section className="supply-party" aria-label={role === 'giver' ? '运输队' : '接收部队'}>
      <header>
        <strong>{unitLabel(state, role === 'giver' ? unitId : targetId)}</strong>
        {role === 'giver' && <span className="supply-party-tag">输送</span>}
      </header>
      <dl className="supply-facts">
        <div><dt>士气</dt><dd data-testid={`supply-${role}-morale`}>{Math.min(moraleCap, morale)}/{moraleCap}</dd></div>
        <div><dt>士兵</dt><dd data-testid={`supply-${role}-troops`}>{(role === 'giver' ? giver.troops : receiver.troops).toLocaleString('en-US')} → {troops.toLocaleString('en-US')}</dd></div>
        <div><dt>资金</dt><dd data-testid={`supply-${role}-gold`}>{(role === 'giver' ? giver.gold ?? 0 : receiver.gold ?? 0).toLocaleString('en-US')} → {gold.toLocaleString('en-US')}</dd></div>
        <div><dt>兵粮</dt><dd data-testid={`supply-${role}-food`}>{(role === 'giver' ? giver.food : receiver.food).toLocaleString('en-US')} → {food.toLocaleString('en-US')}</dd></div>
        {armamentType && (
          <div><dt>{armamentLabel}</dt><dd data-testid={`supply-${role}-armament`}>{armamentHeldOf(role === 'giver' ? giver : receiver).toLocaleString('en-US')} → {armament.toLocaleString('en-US')}</dd></div>
        )}
        <div><dt>兵粮日</dt><dd data-testid={`supply-${role}-food-days`}>约 {foodDaysOf(troops, food)} 日</dd></div>
      </dl>
    </section>
  );

  // 拖动条行：左侧运输队 当前→剩余，右侧接收队 现在→补给后
  const supplyRow = (key: 'troops' | 'gold' | 'food', label: string, step: number, disabledReason?: string | null) => {
    const inputId = `supply-input-${key}`;
    const rowTitle = disabledReason
      ?? (key === 'troops' && armamentType ? `每补一兵随带一件${armamentLabel}` : undefined);
    return (
      <label className={`supply-range${maxTransfer[key] <= 0 ? ' is-disabled' : ''}`} key={key} title={rowTitle}>
        <output className="supply-range-giver">
          {(key === 'troops' ? giver.troops : key === 'gold' ? giver.gold ?? 0 : giver.food).toLocaleString('en-US')}
          {' → '}
          {(key === 'troops' ? after.giver.troops : key === 'gold' ? after.giver.gold : after.giver.food).toLocaleString('en-US')}
        </output>
        <span>{label}</span>
        <input
          id={inputId}
          data-testid={`supply-input-${key}`}
          aria-label={`补给${label}`}
          type="range"
          min={0}
          max={maxTransfer[key]}
          step={step}
          value={current[key]}
          disabled={maxTransfer[key] <= 0}
          onChange={(event) => patch({ [key]: Number(event.target.value) })}
        />
        <output className="supply-range-receiver" data-testid={`supply-preview-${key}`}>
          {(key === 'troops' ? receiver.troops : key === 'gold' ? receiver.gold ?? 0 : receiver.food).toLocaleString('en-US')}
          {' → '}
          {(key === 'troops' ? after.receiver.troops : key === 'gold' ? after.receiver.gold : after.receiver.food).toLocaleString('en-US')}
        </output>
      </label>
    );
  };

  return (
    <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()} onContextMenu={(event) => closePopupOnContextMenu(event, onClose, audio)}>
      <form className="deploy-dialog supply-dialog tool-panel" role="dialog" aria-modal="true" aria-labelledby="supply-title" onSubmit={submit}>
        <header>
          <div>
            <p>{unitLabel(state, unitId)} → {unitLabel(state, targetId)}</p>
            <h2 id="supply-title">补给</h2>
          </div>
          <button type="button" className="icon-button" aria-label="关闭补给" title="关闭" onClick={onClose}><X /></button>
        </header>

        <div className="supply-parties">
          {partyPanel('giver', after.giver.troops, after.giver.gold, after.giver.food, giver.energy, after.giver.armament)}
          {partyPanel('receiver', after.receiver.troops, after.receiver.gold, after.receiver.food, receiver.energy, after.receiver.armament)}
        </div>

        <div className="supply-range-group" aria-label="补给数量">
          {supplyRow('troops', '士兵', 100, troopsDisabledReason)}
          {supplyRow('gold', '资金', 100)}
          {supplyRow('food', '兵粮', 100)}
        </div>

        <div className="supply-bulk">
          <button type="button" className="secondary-button" data-testid="supply-max" onClick={() => { setAmount(clampAmount(maxTransfer)); setSubmitError(null); }}>最大补给</button>
          <button type="button" className="secondary-button" data-testid="supply-reset" onClick={() => { setAmount({ troops: 0, gold: 0, food: 0 }); setSubmitError(null); }}>初始化</button>
        </div>

        {(submitError || !carriesSomething) && (
          <div className="validation-errors deploy-errors" role="alert"><AlertCircle /> <span>{submitError ?? '至少补给一种资源'}</span></div>
        )}

        <footer>
          <button type="button" className="secondary-button" onClick={onClose}>返回</button>
          <button type="submit" className="primary-button" data-testid="supply-confirm" disabled={!carriesSomething}>决定</button>
        </footer>
      </form>
    </div>
  );
}
