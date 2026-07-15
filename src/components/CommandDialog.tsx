import { AlertCircle, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { COMMAND_AP, COMMAND_LABELS, transferDuration, validateCommand } from '../game/commands';
import { useGame } from '../game/store/GameProvider';
import type { CityId, GameCommand } from '../game/types';

interface CommandDialogProps {
  type: GameCommand['type'];
  cityId: CityId;
  onClose(): void;
}

export function CommandDialog({ type, cityId, onClose }: CommandDialogProps) {
  const { state, issueCommand } = useGame();
  const [officerId, setOfficerId] = useState('');
  const [focus, setFocus] = useState<'commerce' | 'agriculture'>('commerce');
  const [targetCityId, setTargetCityId] = useState<CityId | ''>('');
  const [officerIds, setOfficerIds] = useState<string[]>([]);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLFormElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);

  useEffect(() => {
    previousFocus.current = document.activeElement as HTMLElement | null;
    const dialog = dialogRef.current;
    const firstControl = dialog?.querySelector<HTMLElement>('select:not([disabled]), input:not([disabled])') ??
      dialog?.querySelector<HTMLElement>('button:not([disabled])');
    firstControl?.focus();
    return () => previousFocus.current?.focus();
  }, []);

  if (!state) return null;
  const city = state.cities[cityId];
  const officers = Object.values(state.officers).filter((officer) =>
    officer.forceId === state.playerForceId && officer.location.kind === 'city' && officer.location.cityId === cityId,
  );
  const availableOfficers = officers.filter((officer) => !officer.acted);
  const activeOfficerId = officerId || availableOfficers[0]?.id || '';
  const targetCities = Object.values(state.cities).filter((item) => item.ownerId === state.playerForceId && item.id !== cityId);
  const activeTargetId = targetCityId || targetCities[0]?.id || '';
  const activeTargetCity = activeTargetId ? state.cities[activeTargetId] : undefined;
  const activeTransferDuration = activeTargetCity ? transferDuration(city, activeTargetCity) : null;

  const command = useMemo<GameCommand>(() => {
    if (type === 'transfer') {
      return { type, cityId, targetCityId: activeTargetId as CityId, officerIds };
    }
    const base = { cityId, officerId: activeOfficerId };
    if (type === 'develop') return { ...base, type, focus };
    return { ...base, type } as GameCommand;
  }, [activeOfficerId, activeTargetId, cityId, focus, officerIds, type]);

  const errors = validateCommand(state, state.playerForceId, command);
  const label = COMMAND_LABELS[type];

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (errors.length > 0) return;
    try {
      issueCommand(command);
      onClose();
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : '指令执行失败');
    }
  };

  const toggleTransferOfficer = (id: string) => {
    setOfficerIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  };

  const handleDialogKeyDown = (event: ReactKeyboardEvent<HTMLFormElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key !== 'Tab') return;
    const focusable = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button:not([disabled]), select:not([disabled]), input:not([disabled])'));
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable.at(-1)!;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  const estimatedCost = type === 'develop' || type === 'talent'
    ? '资金 500'
    : type === 'recruit'
      ? '资金 800 · 兵粮 500'
      : type === 'train'
        ? '兵粮 300'
        : type === 'patrol'
          ? '资金 300'
          : activeTransferDuration
            ? `人员调动 · ${activeTransferDuration}旬`
            : '人员调动';

  return (
    <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <form ref={dialogRef} className="command-dialog tool-panel" role="dialog" aria-modal="true" aria-labelledby="command-title" onSubmit={submit} onKeyDown={handleDialogKeyDown}>
        <header>
          <div><p>{city.name}政务 · 行动力 {COMMAND_AP[type]}</p><h2 id="command-title">{label}</h2></div>
          <button type="button" className="icon-button" aria-label="关闭指令" title="关闭" onClick={onClose}><X /></button>
        </header>

        {type !== 'transfer' && (
          <label className="field-row">
            <span>执行武将</span>
            <select aria-label="执行武将" value={activeOfficerId} onChange={(event) => setOfficerId(event.target.value)}>
              {officers.map((officer) => (
                <option key={officer.id} value={officer.id} disabled={officer.acted}>
                  {officer.name} · 政{officer.stats.politics} 智{officer.stats.intelligence}{officer.acted ? '（已行动）' : ''}
                </option>
              ))}
            </select>
          </label>
        )}

        {type === 'develop' && (
          <fieldset className="segmented-field">
            <legend>开发方向</legend>
            <div>
              <label><input type="radio" name="focus" checked={focus === 'commerce'} onChange={() => setFocus('commerce')} /><span>商业</span></label>
              <label><input type="radio" name="focus" checked={focus === 'agriculture'} onChange={() => setFocus('agriculture')} /><span>农业</span></label>
            </div>
          </fieldset>
        )}

        {type === 'transfer' && (
          <div className="transfer-fields">
            <label className="field-row">
              <span>目标城市</span>
              <select aria-label="目标城市" value={activeTargetId} onChange={(event) => setTargetCityId(event.target.value as CityId)}>
                {targetCities.map((target) => <option key={target.id} value={target.id}>{target.name}</option>)}
              </select>
            </label>
            <div className="command-note">
              {activeTargetCity ? `${city.name} → ${activeTargetCity.name}，预计${activeTransferDuration}旬抵达` : '没有可调往的己方城市'}
            </div>
            <fieldset className="transfer-officers">
              <legend>调动人员</legend>
              <div>
                {officers.map((officer) => (
                  <label key={officer.id}>
                    <input type="checkbox" checked={officerIds.includes(officer.id)} disabled={city.governorId === officer.id} onChange={() => toggleTransferOfficer(officer.id)} />
                    <span>{officer.name}{city.governorId === officer.id ? '（太守）' : ''}</span>
                  </label>
                ))}
              </div>
            </fieldset>
          </div>
        )}

        <div className="command-cost">
          <span>行动力</span><strong>-{COMMAND_AP[type]}</strong>
          <span>预计消耗</span><strong>{estimatedCost}</strong>
        </div>

        {(errors.length > 0 || submitError) && (
          <div className="validation-errors" role="alert"><AlertCircle /> <span>{submitError ?? errors.join('；')}</span></div>
        )}

        <footer>
          <button type="button" className="secondary-button" onClick={onClose}>取消</button>
          <button type="submit" className="primary-button" disabled={errors.length > 0}>执行{label}</button>
        </footer>
      </form>
    </div>
  );
}
