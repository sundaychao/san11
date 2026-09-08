import type { CSSProperties } from 'react';
import { useAudioEventAdapter } from '../audio/reactAudioEventAdapter';
import type { GameState } from '../game/types';
import { closePopupOnContextMenu } from './popupEvents';

interface GlobalIntelDialogProps {
  state: GameState;
  onClose(): void;
}

export function GlobalIntelDialog({ state, onClose }: GlobalIntelDialogProps) {
  const audio = useAudioEventAdapter();
  return (
    <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()} onContextMenu={(event) => closePopupOnContextMenu(event, onClose, audio)}>
      <section className="intel-panel intel-panel-centered tool-panel" role="dialog" aria-modal="true" aria-labelledby="global-intel-title">
        <header>
          <div>
            <p>全局情报</p>
            <h2 id="global-intel-title">全局情报</h2>
          </div>
          <button type="button" className="secondary-button" onClick={onClose}>关闭</button>
        </header>
        <div className="intel-grid">
          <section aria-label="势力情报">
            <h3>势力</h3>
            {Object.values(state.forces).map((force) => {
              const ownedCities = Object.values(state.cities).filter((city) => city.ownerId === force.id);
              const troops = ownedCities.reduce((sum, city) => sum + city.troops, 0);
              return (
                <div key={force.id} className="intel-row">
                  <span style={{ '--force-color': force.color } as CSSProperties} />
                  <strong>{force.name}</strong>
                  <small>{ownedCities.length} 城 / {troops.toLocaleString('en-US')} 兵</small>
                </div>
              );
            })}
          </section>
          <section aria-label="城市情报">
            <h3>城市</h3>
            {Object.values(state.cities).map((city) => {
              const force = city.ownerId ? state.forces[city.ownerId] : undefined;
              return (
                <div key={city.id} className="intel-row">
                  <span style={{ '--force-color': force?.color ?? '#9aa0a6' } as CSSProperties} />
                  <strong>{city.name}</strong>
                  <small>{force?.name ?? '无主'} / {city.troops.toLocaleString('en-US')} 兵</small>
                </div>
              );
            })}
          </section>
        </div>
      </section>
    </div>
  );
}
