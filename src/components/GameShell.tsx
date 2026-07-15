import { ArrowLeft, RotateCcw } from 'lucide-react';
import { useCallback, useState } from 'react';
import { useGame } from '../game/store/GameProvider';
import type { GameCommand } from '../game/types';
import { BattlePanel } from './BattlePanel';
import { CityPanel } from './CityPanel';
import { CommandDialog } from './CommandDialog';
import { EventLog } from './EventLog';
import { ResultOverlay } from './ResultOverlay';
import { StrategicMap } from './StrategicMap';
import { TopBar } from './TopBar';

export function GameShell() {
  const { state, selectedCityId, resetGame } = useGame();
  const [activeCommand, setActiveCommand] = useState<GameCommand['type'] | null>(null);
  const [viewFinalMap, setViewFinalMap] = useState(false);
  const closeCommand = useCallback(() => setActiveCommand(null), []);

  return (
    <main className="game-shell">
      <TopBar />
      <StrategicMap />
      <CityPanel onCommand={setActiveCommand} />
      <BattlePanel />
      <EventLog />
      {activeCommand && selectedCityId && <CommandDialog type={activeCommand} cityId={selectedCityId} onClose={closeCommand} />}
      {state?.phase === 'finished' && !viewFinalMap && <ResultOverlay onViewMap={() => setViewFinalMap(true)} />}
      {state?.phase === 'finished' && viewFinalMap && (
        <nav className="final-map-actions tool-panel" aria-label="最终地图操作">
          <button type="button" className="secondary-button" onClick={() => setViewFinalMap(false)}><ArrowLeft />返回结算</button>
          <button type="button" className="primary-button" onClick={resetGame}><RotateCcw />重新开局</button>
        </nav>
      )}
    </main>
  );
}
