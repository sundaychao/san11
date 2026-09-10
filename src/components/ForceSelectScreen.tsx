import { Play } from 'lucide-react';
import { getMap } from '../game/mapRegistry';
import { SCENARIO_FORCES } from '../game/scenario/jingxiang208';
import { forcesOfMap } from '../game/scenario/customMap';
import { useGame } from '../game/store/GameProvider';
import type { ForceId } from '../game/types';

interface ForceSelectScreenProps {
  mapId: string;
  onBack(): void;
}

/**
 * 单机选择势力：列出该地图有主城池的势力。
 */
export function ForceSelectScreen({ mapId, onBack }: ForceSelectScreenProps) {
  const { startGame } = useGame();
  const map = getMap(mapId);
  const forces = map ? forcesOfMap(map.payload) : [];

  return (
    <main className="force-select-screen" data-testid="force-select-screen">
      <header className="force-select-header">
        <button type="button" className="secondary-button" onClick={onBack}>{'< 返回'}</button>
        <h1>选择势力</h1>
        <p>地图：{map?.name ?? '未知'}</p>
      </header>

      <section className="force-selection" aria-label="选择势力">
        {forces.length === 0 ? (
          <p className="force-select-empty">该地图没有可用的有主城池。</p>
        ) : forces.map((forceId: ForceId) => {
          const force = SCENARIO_FORCES[forceId];
          return (
            <button
              className="force-choice"
              key={forceId}
              type="button"
              onClick={() => startGame(forceId, Date.now(), mapId)}
              aria-label={`选择${force.name}`}
            >
              <span className="force-swatch" style={{ backgroundColor: force.color }} aria-hidden="true" />
              <span className="force-copy">
                <strong>{force.name}</strong>
                <small>{force.description}</small>
              </span>
              <Play aria-hidden="true" />
            </button>
          );
        })}
      </section>
    </main>
  );
}