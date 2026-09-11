import { AlertCircle, X } from 'lucide-react';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useAudioEventAdapter } from '../audio/reactAudioEventAdapter';
import { DEPLOY_AP_COST } from '../game/battle/actions';
import { effectiveStat, officerHealthSummary } from '../game/health';
import { useGame } from '../game/store/GameProvider';
import type { CityId, Officer, PassId } from '../game/types';
import { closePopupOnContextMenu } from './popupEvents';

export interface TransportConfirmInput {
  /** 出发城池 id（从城池输送时） */
  cityId?: CityId;
  /** 出发关隘 id（从关隘输送时；与 cityId 二选一） */
  passId?: PassId;
  officerId: string;
  troops: number;
  gold: number;
  food: number;
}

interface TransportDialogProps {
  cityId?: CityId;
  passId?: PassId;
  onConfirm(input: TransportConfirmInput): void;
  onClose(): void;
}

function toAmount(value: string) {
  const amount = Number(value);
  return Number.isFinite(amount) ? amount : -1;
}

/** 输送选将下拉文案：用衰减后的有效统/政（带伤武将会标注） */
function transportOfficerLabel(officer: Officer) {
  const health = officerHealthSummary(officer);
  const injured = health ? `（${health.label}）` : '';
  return `${officer.name} · 统${effectiveStat(officer, 'leadership')} 政${effectiveStat(officer, 'politics')}${injured}`;
}

export function TransportDialog({ cityId, passId, onClose, onConfirm }: TransportDialogProps) {
  const { state } = useGame();
  const audio = useAudioEventAdapter();
  const [officerId, setOfficerId] = useState('');
  const [troops, setTroops] = useState<string | null>(null);
  const [gold, setGold] = useState<string | null>(null);
  const [food, setFood] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    dialogRef.current?.querySelector<HTMLElement>('select:not([disabled])')?.focus();
  }, []);

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
  const activeOfficerId = officerId || availableOfficers[0]?.id || '';
  const activeTroops = troops ?? String(Math.min(1000, Math.max(0, source.troops - 500)));
  const activeGold = gold ?? String(Math.min(1000, source.gold));
  const activeFood = food ?? String(Math.min(3000, source.food));
  const troopAmount = toAmount(activeTroops);
  const goldAmount = toAmount(activeGold);
  const foodAmount = toAmount(activeFood);
  const errors = [
    state.actionPoints[state.playerForceId] < DEPLOY_AP_COST ? `行动力不足 ${DEPLOY_AP_COST}` : '',
    !activeOfficerId ? '没有可执行输送的武将' : '',
    !Number.isInteger(troopAmount) || troopAmount < 0 || troopAmount > 10000 ? '输送士兵必须为 0-10000' : '',
    source.troops - troopAmount < 500 ? '城市至少保留 500 兵力' : '',
    !Number.isInteger(goldAmount) || goldAmount < 0 || goldAmount > source.gold ? '资金不足' : '',
    !Number.isInteger(foodAmount) || foodAmount < 0 || foodAmount > source.food ? '兵粮不足' : '',
    troopAmount === 0 && goldAmount === 0 && foodAmount === 0 ? '至少输送一种资源' : '',
  ].filter(Boolean);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (errors.length > 0) return;
    try {
      onConfirm({
        ...(passId ? { passId } : { cityId }),
        officerId: activeOfficerId,
        troops: troopAmount,
        gold: goldAmount,
        food: foodAmount,
      });
      onClose();
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : '输送失败');
    }
  };

  return (
    <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()} onContextMenu={(event) => closePopupOnContextMenu(event, onClose, audio)}>
      <form ref={dialogRef} className="deploy-dialog tool-panel" role="dialog" aria-modal="true" aria-labelledby="transport-title" onSubmit={submit}>
        <header>
          <div>
            <p>{source.name} · 行动力 20</p>
            <h2 id="transport-title">输送编制</h2>
          </div>
          <button type="button" className="icon-button" aria-label="关闭输送编制" title="关闭" onClick={onClose}><X /></button>
        </header>

        <section className="deploy-left" aria-label="输送设定">
          <label className="field-row">
            <span>执行武将</span>
            <select aria-label="执行武将" value={activeOfficerId} onChange={(event) => setOfficerId(event.target.value)}>
              {officers.map((officer) => (
                <option key={officer.id} value={officer.id} disabled={officer.acted}>
                  {transportOfficerLabel(officer)}{officer.acted ? '（已行动）' : ''}
                </option>
              ))}
            </select>
          </label>
          <div className="amount-grid">
            <label><span>士兵</span><input aria-label="输送士兵" type="number" min="0" max="10000" value={activeTroops} onChange={(event) => setTroops(event.target.value)} /></label>
            <label><span>资金</span><input aria-label="输送资金" type="number" min="0" value={activeGold} onChange={(event) => setGold(event.target.value)} /></label>
            <label><span>兵粮</span><input aria-label="输送兵粮" type="number" min="0" value={activeFood} onChange={(event) => setFood(event.target.value)} /></label>
          </div>
        </section>

        <aside className="deploy-right" aria-label="输送库存">
          <h3>据点库存</h3>
          <dl className="deploy-stock">
            <div><dt>士兵</dt><dd>{source.troops.toLocaleString('en-US')} → {Math.max(0, source.troops - Math.max(0, troopAmount)).toLocaleString('en-US')}</dd></div>
            <div><dt>资金</dt><dd>{source.gold.toLocaleString('en-US')} → {Math.max(0, source.gold - Math.max(0, goldAmount)).toLocaleString('en-US')}</dd></div>
            <div><dt>兵粮</dt><dd>{source.food.toLocaleString('en-US')} → {Math.max(0, source.food - Math.max(0, foodAmount)).toLocaleString('en-US')}</dd></div>
          </dl>
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
