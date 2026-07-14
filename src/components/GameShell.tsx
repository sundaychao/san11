import { useState } from 'react';
import { useGame } from '../game/store/GameProvider';
import type { GameCommand } from '../game/types';
import { CityPanel } from './CityPanel';
import { CommandDialog } from './CommandDialog';
import { EventLog } from './EventLog';
import { ResultOverlay } from './ResultOverlay';
import { StrategicMap } from './StrategicMap';
import { TopBar } from './TopBar';

export function GameShell() {
  const { state, selectedCityId } = useGame();
  const [activeCommand, setActiveCommand] = useState<GameCommand['type'] | null>(null);
  const [viewFinalMap, setViewFinalMap] = useState(false);

  return (
    <main className="game-shell">
      <TopBar />
      <StrategicMap />
      <CityPanel onCommand={setActiveCommand} />
      <EventLog />
      {activeCommand && selectedCityId && <CommandDialog type={activeCommand} cityId={selectedCityId} onClose={() => setActiveCommand(null)} />}
      {state?.phase === 'finished' && !viewFinalMap && <ResultOverlay onViewMap={() => setViewFinalMap(true)} />}
    </main>
  );
}
