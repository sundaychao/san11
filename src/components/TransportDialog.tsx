import { AlertCircle, X } from 'lucide-react';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useGame } from '../game/store/GameProvider';
import type { CityId } from '../game/types';

export interface TransportConfirmInput {
  cityId: CityId;
  officerId: string;
  troops: number;
  gold: number;
  food: number;
}

interface TransportDialogProps {
  cityId: CityId;
  onConfirm(input: TransportConfirmInput): void;
  onClose(): void;
}

function toAmount(value: string) {
  const amount = Number(value);
  return Number.isFinite(amount) ? amount : -1;
}

export function TransportDialog({ cityId, onClose, onConfirm }: TransportDialogProps) {
  const { state } = useGame();
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
  const city = state.cities[cityId];
  const officers = Object.values(state.officers).filter((officer) => (
    officer.forceId === state.playerForceId &&
    officer.location.kind === 'city' &&
    officer.location.cityId === cityId
  ));
  const availableOfficers = officers.filter((officer) => !officer.acted);
  const activeOfficerId = officerId || availableOfficers[0]?.id || '';
  const activeTroops = troops ?? String(Math.min(1000, Math.max(0, city.troops - 500)));
  const activeGold = gold ?? String(Math.min(1000, city.gold));
  const activeFood = food ?? String(Math.min(3000, city.food));
  const troopAmount = toAmount(activeTroops);
  const goldAmount = toAmount(activeGold);
  const foodAmount = toAmount(activeFood);
  const errors = [
    !activeOfficerId ? '没有可执行输送的武将' : '',
    !Number.isInteger(troopAmount) || troopAmount < 0 || troopAmount > 10000 ? '输送士兵必须为 0-10000' : '',
    city.troops - troopAmount < 500 ? '城市至少保留 500 兵力' : '',
    !Number.isInteger(goldAmount) || goldAmount < 0 || goldAmount > city.gold ? '资金不足' : '',
    !Number.isInteger(foodAmount) || foodAmount < 0 || foodAmount > city.food ? '兵粮不足' : '',
    troopAmount === 0 && goldAmount === 0 && foodAmount === 0 ? '至少输送一种资源' : '',
  ].filter(Boolean);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (errors.length > 0) return;
    try {
      onConfirm({
        cityId,
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
    <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <form ref={dialogRef} className="deploy-dialog tool-panel" role="dialog" aria-modal="true" aria-labelledby="transport-title" onSubmit={submit}>
        <header>
          <div>
            <p>{city.name} · 行动力 20</p>
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
                  {officer.name} · 统{officer.stats.leadership} 政{officer.stats.politics}{officer.acted ? '（已行动）' : ''}
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
            <div><dt>士兵</dt><dd>{city.troops.toLocaleString('en-US')} → {Math.max(0, city.troops - Math.max(0, troopAmount)).toLocaleString('en-US')}</dd></div>
            <div><dt>资金</dt><dd>{city.gold.toLocaleString('en-US')} → {Math.max(0, city.gold - Math.max(0, goldAmount)).toLocaleString('en-US')}</dd></div>
            <div><dt>兵粮</dt><dd>{city.food.toLocaleString('en-US')} → {Math.max(0, city.food - Math.max(0, foodAmount)).toLocaleString('en-US')}</dd></div>
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
