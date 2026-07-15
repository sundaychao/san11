import { AlertCircle, Swords, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { useGame } from '../game/store/GameProvider';
import type { CityId, Officer, TroopType } from '../game/types';

export interface DeployConfirmInput {
  cityId: CityId;
  officerId: string;
  targetCityId: CityId;
  troopType: TroopType;
  troops: number;
  food: number;
}

interface DeployDialogProps {
  cityId: CityId;
  onConfirm(input: DeployConfirmInput): void;
  onClose(): void;
}

const TROOP_TYPES: Array<{ id: TroopType; label: string; attack: number; defense: number; movement: number }> = [
  { id: 'sword', label: '剑兵', attack: 33, defense: 33, movement: 22 },
  { id: 'spear', label: '枪兵', attack: 38, defense: 31, movement: 22 },
  { id: 'halberd', label: '戟兵', attack: 31, defense: 39, movement: 20 },
  { id: 'crossbow', label: '弩兵', attack: 36, defense: 28, movement: 19 },
  { id: 'cavalry', label: '骑兵', attack: 42, defense: 27, movement: 30 },
  { id: 'siege', label: '兵器', attack: 28, defense: 24, movement: 16 },
];

function toAmount(value: string) {
  const amount = Number(value);
  return Number.isFinite(amount) ? amount : -1;
}

function officerAbility(officer: Officer | undefined, troopType: TroopType) {
  const troop = TROOP_TYPES.find((item) => item.id === troopType) ?? TROOP_TYPES[0];
  if (!officer) return { attack: troop.attack, defense: troop.defense, intelligence: 0, construction: 0, movement: troop.movement };
  return {
    attack: Math.round((officer.stats.war + troop.attack) / 2),
    defense: Math.round((officer.stats.leadership + troop.defense) / 2),
    intelligence: officer.stats.intelligence,
    construction: officer.stats.politics,
    movement: troop.movement,
  };
}

export function DeployDialog({ cityId, onClose, onConfirm }: DeployDialogProps) {
  const { state } = useGame();
  const [officerId, setOfficerId] = useState('');
  const [troopType, setTroopType] = useState<TroopType>('sword');
  const [targetCityId, setTargetCityId] = useState<CityId | ''>('');
  const [troops, setTroops] = useState('');
  const [food, setFood] = useState('');
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
  const activeOfficer = state.officers[activeOfficerId];
  const targetCities = Object.values(state.cities).filter((target) => target.ownerId !== state.playerForceId);
  const activeTargetId = targetCityId || targetCities[0]?.id || '';
  const activeTroops = troops || String(Math.min(4000, Math.max(1000, city.troops - 500)));
  const activeFood = food || String(Math.min(6000, city.food));
  const troopAmount = toAmount(activeTroops);
  const foodAmount = toAmount(activeFood);
  const ability = useMemo(() => officerAbility(activeOfficer, troopType), [activeOfficer, troopType]);
  const errors = [
    !activeOfficerId ? '没有可出征武将' : '',
    !activeTargetId ? '没有可攻击目标' : '',
    !Number.isInteger(troopAmount) || troopAmount < 1000 || troopAmount > 10000 ? '士兵必须为 1000-10000' : '',
    city.troops - troopAmount < 500 ? '城市至少保留 500 兵力' : '',
    !Number.isInteger(foodAmount) || foodAmount < 0 || foodAmount > city.food ? '兵粮不足' : '',
  ].filter(Boolean);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (errors.length > 0) return;
    try {
      onConfirm({
        cityId,
        officerId: activeOfficerId,
        targetCityId: activeTargetId as CityId,
        troopType,
        troops: troopAmount,
        food: foodAmount,
      });
      onClose();
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : '出征失败');
    }
  };

  return (
    <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <form ref={dialogRef} className="deploy-dialog tool-panel" role="dialog" aria-modal="true" aria-labelledby="deploy-title" onSubmit={submit}>
        <header>
          <div>
            <p>{city.name} · 行动力 20</p>
            <h2 id="deploy-title">出征编制</h2>
          </div>
          <button type="button" className="icon-button" aria-label="关闭出征编制" title="关闭" onClick={onClose}><X /></button>
        </header>

        <section className="deploy-left" aria-label="出征设定">
          <label className="field-row">
            <span>主将</span>
            <select aria-label="主将" value={activeOfficerId} onChange={(event) => setOfficerId(event.target.value)}>
              {officers.map((officer) => (
                <option key={officer.id} value={officer.id} disabled={officer.acted}>
                  {officer.name} · 统{officer.stats.leadership} 武{officer.stats.war}{officer.acted ? '（已行动）' : ''}
                </option>
              ))}
            </select>
          </label>

          <label className="field-row">
            <span>目标城池</span>
            <select aria-label="目标城池" value={activeTargetId} onChange={(event) => setTargetCityId(event.target.value as CityId)}>
              {targetCities.map((target) => <option key={target.id} value={target.id}>{target.name}</option>)}
            </select>
          </label>

          <label className="field-row">
            <span>兵种</span>
            <select aria-label="兵种" value={troopType} onChange={(event) => setTroopType(event.target.value as TroopType)}>
              {TROOP_TYPES.map((type) => <option key={type.id} value={type.id}>{type.label}</option>)}
            </select>
          </label>

          <div className="deploy-troop-grid" aria-label="兵装选择">
            {TROOP_TYPES.map((type) => (
              <button key={type.id} type="button" className={troopType === type.id ? 'is-active' : ''} onClick={() => setTroopType(type.id)}>
                <Swords aria-hidden="true" />
                <span>{type.label}</span>
              </button>
            ))}
          </div>

          <div className="amount-grid">
            <label><span>士兵</span><input aria-label="出征士兵" type="number" min="1000" max="10000" value={activeTroops} onChange={(event) => setTroops(event.target.value)} /></label>
            <label><span>兵粮</span><input aria-label="出征兵粮" type="number" min="0" value={activeFood} onChange={(event) => setFood(event.target.value)} /></label>
          </div>
        </section>

        <aside className="deploy-right" aria-label="部队能力">
          <h3>部队能力</h3>
          <div className="deploy-ability">
            <span>攻击</span><strong>{ability.attack}</strong>
            <span>防御</span><strong>{ability.defense}</strong>
            <span>智力</span><strong>{ability.intelligence}</strong>
            <span>建设</span><strong>{ability.construction}</strong>
            <span>移动</span><strong>{ability.movement}</strong>
          </div>
          <h3>据点库存</h3>
          <dl className="deploy-stock">
            <div><dt>士兵</dt><dd>{city.troops.toLocaleString('en-US')} → {Math.max(0, city.troops - Math.max(0, troopAmount)).toLocaleString('en-US')}</dd></div>
            <div><dt>兵粮</dt><dd>{city.food.toLocaleString('en-US')} → {Math.max(0, city.food - Math.max(0, foodAmount)).toLocaleString('en-US')}</dd></div>
            <div><dt>资金</dt><dd>{city.gold.toLocaleString('en-US')}</dd></div>
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
