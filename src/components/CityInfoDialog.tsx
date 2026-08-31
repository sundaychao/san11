import { Users } from 'lucide-react';
import { useAudioEventAdapter } from '../audio/reactAudioEventAdapter';
import { useGame } from '../game/store/GameProvider';
import type { CityId } from '../game/types';
import { closePopupOnContextMenu } from './popupEvents';

interface CityInfoDialogProps {
  cityId: CityId;
  onClose(): void;
}

function formatNumber(value: number) {
  return value.toLocaleString('en-US');
}

export function CityInfoDialog({ cityId, onClose }: CityInfoDialogProps) {
  const { state } = useGame();
  const audio = useAudioEventAdapter();
  if (!state) return null;

  const city = state.cities[cityId];
  if (!city) return null;

  const force = state.forces[city.ownerId];
  const governor = city.governorId ? state.officers[city.governorId] : undefined;
  const localOfficers = Object.values(state.officers).filter((officer) =>
    officer.forceId === city.ownerId && officer.location.kind === 'city' && officer.location.cityId === city.id,
  );

  return (
    <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()} onContextMenu={(event) => closePopupOnContextMenu(event, onClose, audio)}>
      <section className="city-info-dialog tool-panel" role="dialog" aria-modal="true" aria-labelledby="city-info-title">
        <header>
          <div>
            <p>{force.name}军 · 太守 {governor?.name ?? '暂无'}</p>
            <h2 id="city-info-title">{city.name}</h2>
          </div>
          <button type="button" className="secondary-button" onClick={onClose}>关闭</button>
        </header>
        <div className="city-info-dialog-body">
          <section aria-label="城市概况">
            <h3>城池</h3>
            <dl className="city-info-dialog-grid">
              <div><dt>资金</dt><dd>{formatNumber(city.gold)}</dd></div>
              <div><dt>兵粮</dt><dd>{formatNumber(city.food)}</dd></div>
              <div><dt>兵力</dt><dd>{formatNumber(city.troops)}</dd></div>
              <div><dt>人口</dt><dd>{formatNumber(city.population)}</dd></div>
              <div><dt>商业</dt><dd>{city.commerce}</dd></div>
              <div><dt>农业</dt><dd>{city.agriculture}</dd></div>
              <div><dt>治安</dt><dd>{city.order}/100</dd></div>
              <div><dt>训练</dt><dd>{city.training}</dd></div>
              <div><dt>耐久</dt><dd>{formatNumber(city.durability)}</dd></div>
            </dl>
          </section>
          <section className="city-info-officer-list" aria-label="所属武将">
            <h3><Users aria-hidden="true" />所属武将 <span>{localOfficers.length}</span></h3>
            {localOfficers.length === 0 ? (
              <p className="city-info-empty">城中暂无武将</p>
            ) : (
              <ul>
                {localOfficers.map((officer) => (
                  <li key={officer.id}>
                    <span className="force-dot" style={{ backgroundColor: force.color }} aria-hidden="true" />
                    <strong>{officer.name}</strong>
                    <small>
                      统{officer.stats.leadership} 武{officer.stats.war} 智{officer.stats.intelligence} 政{officer.stats.politics} 魅{officer.stats.charisma}
                      {officer.acted ? ' · 已行动' : ' · 待命'}
                    </small>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </section>
    </div>
  );
}