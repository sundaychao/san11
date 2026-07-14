import { Play, ScrollText } from 'lucide-react';
import { FORCE_IDS, SCENARIO_FORCES } from '../game/scenario/jingxiang208';
import { useGame } from '../game/store/GameProvider';

export function StartScreen() {
  const { hasAutosave, hasManualSave, loadGame, startGame, error, clearError } = useGame();

  return (
    <main className="start-screen">
      <section className="start-title" aria-labelledby="game-title">
        <p>公元 208 年</p>
        <h1 id="game-title">建安十三年：荆襄争夺</h1>
      </section>

      <section className="force-selection" aria-label="选择势力">
        {FORCE_IDS.map((forceId) => {
          const force = SCENARIO_FORCES[forceId];
          return (
            <button
              className="force-choice"
              key={forceId}
              type="button"
              onClick={() => startGame(forceId)}
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

      {(hasAutosave || hasManualSave) && (
        <div className="save-actions">
          {hasAutosave && <button type="button" onClick={() => loadGame('auto')}><Play aria-hidden="true" />继续游戏</button>}
          {hasManualSave && <button type="button" onClick={() => loadGame('manual')}><ScrollText aria-hidden="true" />读取手动存档</button>}
        </div>
      )}
      {error && <button className="start-error" type="button" onClick={clearError}>{error}</button>}
    </main>
  );
}
