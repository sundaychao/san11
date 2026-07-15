import { ArrowLeft, RotateCcw } from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';
import { deploymentCells } from '../game/battle/actions';
import type { GridCoord } from '../game/battle/grid';
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
import { DeployDialog, type DeployConfirmInput } from './DeployDialog';
import { EventLog } from './EventLog';
import { MapEditorPanel } from './MapEditorPanel';
import { ResultOverlay } from './ResultOverlay';
import { StrategicMap } from './StrategicMap';
import { TopBar } from './TopBar';

export function GameShell() {
  const { deployUnit, endTenDay, state, selectedCityId, resetGame } = useGame();
  const [activeCommand, setActiveCommand] = useState<GameCommand['type'] | null>(null);
  const [deployCityId, setDeployCityId] = useState<NonNullable<typeof selectedCityId> | null>(null);
  const [pendingDeploy, setPendingDeploy] = useState<DeployConfirmInput | null>(null);
  const [cityMenu, setCityMenu] = useState<{ cityId: NonNullable<typeof selectedCityId>; position: { x: number; y: number } } | null>(null);
  const [mapContextMenu, setMapContextMenu] = useState<{ x: number; y: number } | null>(null);
  const [viewFinalMap, setViewFinalMap] = useState(false);
  const [editorState, setEditorState] = useState<MapEditorState | null>(null);
  const [editorTool, setEditorTool] = useState<MapEditorTool>('plain');
  const [editorExport, setEditorExport] = useState('');
  const closeCommand = useCallback(() => setActiveCommand(null), []);
  const launchCommand = useCallback((type: GameCommand['type']) => {
    setActiveCommand(type);
    setCityMenu(null);
    setMapContextMenu(null);
  }, []);

  const openEditor = useCallback(() => {
    if (!state) return;
    setEditorState(createEditorState(
      state.grid,
      Object.values(state.cities).map((city) => ({ id: city.id, label: city.name, q: city.gridQ, r: city.gridR })),
    ));
    setEditorExport('');
    setCityMenu(null);
    setMapContextMenu(null);
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

  const openDeployDialog = useCallback((cityId: NonNullable<typeof selectedCityId>) => {
    setDeployCityId(cityId);
    setPendingDeploy(null);
    setCityMenu(null);
    setMapContextMenu(null);
  }, []);

  const deployTargets = useMemo(() => (
    state && pendingDeploy ? deploymentCells(state, pendingDeploy.cityId) : []
  ), [pendingDeploy, state]);

  const closeDeployDialog = useCallback(() => {
    setDeployCityId(null);
  }, []);

  const confirmDeploySetup = useCallback((input: DeployConfirmInput) => {
    setPendingDeploy(input);
    setDeployCityId(null);
  }, []);

  const selectDeployTarget = useCallback((coord: GridCoord) => {
    if (!pendingDeploy) return;
    if (!deployTargets.some((target) => target.q === coord.q && target.r === coord.r)) return;
    deployUnit({ ...pendingDeploy, destination: coord });
    setPendingDeploy(null);
  }, [deployTargets, deployUnit, pendingDeploy]);

  const openMapContextMenu = useCallback((position: { x: number; y: number }) => {
    if (cityMenu || editorState || deployCityId || pendingDeploy) {
      setCityMenu(null);
      return;
    }
    setMapContextMenu(position);
  }, [cityMenu, deployCityId, editorState, pendingDeploy]);

  const proceedTenDayFromMap = useCallback(() => {
    setMapContextMenu(null);
    endTenDay();
  }, [endTenDay]);

  return (
    <main className="game-shell">
      <TopBar />
      <StrategicMap
        onCityMenu={(cityId, position) => {
          setMapContextMenu(null);
          setCityMenu({ cityId, position });
        }}
        editorGrid={editorState?.grid}
        editorCities={editorState?.cities}
        editorMode={Boolean(editorState)}
        onEditorCellPaint={editCell}
        deployTargets={deployTargets}
        onDeployTargetSelect={selectDeployTarget}
        onMapContextMenu={openMapContextMenu}
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
          onDeploy={openDeployDialog}
          onClose={() => setCityMenu(null)}
        />
      )}
      {mapContextMenu && (
        <nav
          className="map-context-menu tool-panel"
          data-testid="map-context-menu"
          style={{ left: mapContextMenu.x, top: mapContextMenu.y }}
          aria-label="地图命令菜单"
        >
          <button type="button" onClick={proceedTenDayFromMap}>进行</button>
        </nav>
      )}
      {activeCommand && selectedCityId && <CommandDialog type={activeCommand} cityId={selectedCityId} onClose={closeCommand} />}
      {deployCityId && (
        <DeployDialog
          cityId={deployCityId}
          onConfirm={confirmDeploySetup}
          onClose={closeDeployDialog}
        />
      )}
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
