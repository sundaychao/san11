import { ArrowLeft, RotateCcw } from 'lucide-react';
import { useCallback, useState } from 'react';
import {
  clearEditor,
  createEditorState,
  exportEditorJson,
  exportEditorSvg,
  paintTerrain,
  placeCity,
  redoEditor,
  undoEditor,
  type MapEditorState,
  type MapEditorTool,
} from '../game/map-editor/editor';
import { useGame } from '../game/store/GameProvider';
import type { GameCommand, TerrainType } from '../game/types';
import { BattlePanel } from './BattlePanel';
import { CityCommandMenu } from './CityCommandMenu';
import { CityPanel } from './CityPanel';
import { CommandDialog } from './CommandDialog';
import { EventLog } from './EventLog';
import { MapEditorPanel } from './MapEditorPanel';
import { ResultOverlay } from './ResultOverlay';
import { StrategicMap } from './StrategicMap';
import { TopBar } from './TopBar';

export function GameShell() {
  const { deployUnit, state, selectedCityId, resetGame } = useGame();
  const [activeCommand, setActiveCommand] = useState<GameCommand['type'] | null>(null);
  const [cityMenu, setCityMenu] = useState<{ cityId: NonNullable<typeof selectedCityId>; position: { x: number; y: number } } | null>(null);
  const [viewFinalMap, setViewFinalMap] = useState(false);
  const [editorState, setEditorState] = useState<MapEditorState | null>(null);
  const [editorTool, setEditorTool] = useState<MapEditorTool>('plain');
  const [editorExport, setEditorExport] = useState('');
  const closeCommand = useCallback(() => setActiveCommand(null), []);
  const launchCommand = useCallback((type: GameCommand['type']) => {
    setActiveCommand(type);
    setCityMenu(null);
  }, []);

  const openEditor = useCallback(() => {
    if (!state) return;
    setEditorState(createEditorState(
      state.grid,
      Object.values(state.cities).map((city) => ({ id: city.id, label: city.name, q: city.gridQ, r: city.gridR })),
    ));
    setEditorExport('');
    setCityMenu(null);
  }, [state]);

  const editCell = useCallback((coord: { q: number; r: number }) => {
    setEditorState((current) => {
      if (!current) return current;
      if (editorTool === 'city') {
        const nextIndex = current.cities.length + 1;
        return placeCity(current, { id: `editor-city-${nextIndex}`, label: `城${nextIndex}`, q: coord.q, r: coord.r });
      }
      return paintTerrain(current, coord, editorTool as TerrainType);
    });
  }, [editorTool]);

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
      <StrategicMap
        onCityMenu={(cityId, position) => setCityMenu({ cityId, position })}
        editorGrid={editorState?.grid}
        editorCities={editorState?.cities}
        editorMode={Boolean(editorState)}
        onEditorCellPaint={editCell}
      />
      <button type="button" className="map-editor-toggle primary-button" onClick={openEditor}>地图编辑</button>
      <CityPanel onCommand={launchCommand} />
      <BattlePanel />
      <EventLog />
      {editorState && (
        <MapEditorPanel
          activeTool={editorTool}
          canRedo={editorState.future.length > 0}
          canUndo={editorState.history.length > 0}
          exportValue={editorExport}
          onClear={() => setEditorState((current) => (current ? clearEditor(current, 'plain') : current))}
          onClose={() => setEditorState(null)}
          onExportJson={() => setEditorExport(exportEditorJson(editorState))}
          onExportSvg={() => setEditorExport(exportEditorSvg(editorState))}
          onRedo={() => setEditorState((current) => (current ? redoEditor(current) : current))}
          onSelectTool={setEditorTool}
          onUndo={() => setEditorState((current) => (current ? undoEditor(current) : current))}
        />
      )}
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
