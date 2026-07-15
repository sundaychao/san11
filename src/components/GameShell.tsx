import { ArrowLeft, RotateCcw } from 'lucide-react';
import { useCallback, useState } from 'react';
import { useGame } from '../game/store/GameProvider';
import type { GameCommand } from '../game/types';
import { BattlePanel } from './BattlePanel';
import { CityCommandMenu } from './CityCommandMenu';
import { CityPanel } from './CityPanel';
import { CommandDialog } from './CommandDialog';
import { EventLog } from './EventLog';
import { ResultOverlay } from './ResultOverlay';
import { StrategicMap } from './StrategicMap';
import { TopBar } from './TopBar';

export function GameShell() {
  const { deployUnit, state, selectedCityId, resetGame } = useGame();
  const [activeCommand, setActiveCommand] = useState<GameCommand['type'] | null>(null);
  const [cityMenu, setCityMenu] = useState<{ cityId: NonNullable<typeof selectedCityId>; position: { x: number; y: number } } | null>(null);
  const [viewFinalMap, setViewFinalMap] = useState(false);
  const closeCommand = useCallback(() => setActiveCommand(null), []);
  const launchCommand = useCallback((type: GameCommand['type']) => {
    setActiveCommand(type);
    setCityMenu(null);
  }, []);

  const quickDeployFromCity = useCallback((cityId: NonNullable<typeof selectedCityId>) => {
    if (!state) return;
    const city = state.cities[cityId];
    const officer = Object.values(state.officers).find((candidate) => (
      candidate.forceId === state.playerForceId &&
      candidate.location.kind === 'city' &&
      candidate.location.cityId === cityId &&
      !candidate.acted
    ));
    const target = Object.values(state.cities).find((candidate) => candidate.ownerId !== state.playerForceId);
    if (!officer || !target || city.ownerId !== state.playerForceId) return;
    deployUnit({ cityId, officerId: officer.id, targetCityId: target.id, troops: 4000, food: 6000 });
    setCityMenu(null);
  }, [deployUnit, state]);

  return (
    <main className="game-shell">
      <TopBar />
      <StrategicMap onCityMenu={(cityId, position) => setCityMenu({ cityId, position })} />
      <CityPanel onCommand={launchCommand} />
      <BattlePanel />
      <EventLog />
      {cityMenu && (
        <CityCommandMenu
          cityId={cityMenu.cityId}
          position={cityMenu.position}
          onCommand={launchCommand}
          onDeploy={quickDeployFromCity}
          onClose={() => setCityMenu(null)}
        />
      )}
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
