import { ArrowLeft, RotateCcw } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { deploymentCells, movementCells } from '../game/battle/actions';
import type { GridCoord } from '../game/battle/grid';
import {
  clearEditor,
  createEditorState,
  exportEditorJson,
  exportEditorSvg,
  exportTerrainMaskSvgs,
  exportTerrainControlSvg,
  paintTerrain,
  placeCity,
  redoEditor,
  undoEditor,
  type MapEditorState,
  type MapEditorTool,
} from '../game/map-editor/editor';
import { useGame } from '../game/store/GameProvider';
import type { GameCommand, GridCell, TerrainType } from '../game/types';
import { BattlePanel } from './BattlePanel';
import { CityCommandMenu } from './CityCommandMenu';
import { CityPanel } from './CityPanel';
import { CommandDialog } from './CommandDialog';
import { DeployDialog, type DeployConfirmInput } from './DeployDialog';
import { EventLog } from './EventLog';
import { ForceOverviewPanel } from './ForceOverviewPanel';
import { MapEditorPanel } from './MapEditorPanel';
import { ResultOverlay } from './ResultOverlay';
import { StrategicMap } from './StrategicMap';
import { TopBar } from './TopBar';
import { TransportDialog, type TransportConfirmInput } from './TransportDialog';

const TERRAIN_LABELS: Record<TerrainType, string> = {
  road: '道路',
  plain: '平地',
  forest: '森林',
  hill: '丘陵',
  mountain: '高山',
  deepWater: '水域',
};

function downloadTextFile(filename: string, content: string) {
  const blob = new Blob([content], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export function GameShell() {
  const { deployTransportUnit, deployUnit, endTenDay, hasAutosave, hasManualSave, loadGame, manualSave, moveUnit, state, selectedCityId, resetGame } = useGame();
  const [activeCommand, setActiveCommand] = useState<GameCommand['type'] | null>(null);
  const [deployCityId, setDeployCityId] = useState<NonNullable<typeof selectedCityId> | null>(null);
  const [transportCityId, setTransportCityId] = useState<NonNullable<typeof selectedCityId> | null>(null);
  const [pendingDeploy, setPendingDeploy] = useState<DeployConfirmInput | null>(null);
  const [pendingTransport, setPendingTransport] = useState<TransportConfirmInput | null>(null);
  const [selectedUnitId, setSelectedUnitId] = useState<string | null>(null);
  const [hoveredCell, setHoveredCell] = useState<GridCell | null>(null);
  const [cityMenu, setCityMenu] = useState<{ cityId: NonNullable<typeof selectedCityId>; position: { x: number; y: number } } | null>(null);
  const [mapContextMenu, setMapContextMenu] = useState<{ x: number; y: number } | null>(null);
  const [showIntel, setShowIntel] = useState(false);
  const [viewFinalMap, setViewFinalMap] = useState(false);
  const [editorState, setEditorState] = useState<MapEditorState | null>(null);
  const [editorTool, setEditorTool] = useState<MapEditorTool>('plain');
  const [editorExport, setEditorExport] = useState('');
  const mapContextMenuRef = useRef<HTMLElement>(null);
  const closeCommand = useCallback(() => setActiveCommand(null), []);
  const launchCommand = useCallback((type: GameCommand['type']) => {
    setActiveCommand(type);
    setCityMenu(null);
    setMapContextMenu(null);
    setShowIntel(false);
    setSelectedUnitId(null);
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
    setShowIntel(false);
    setSelectedUnitId(null);
  }, [state]);

  const exportTerrainControl = useCallback(() => {
    if (!editorState) return;
    const svg = exportTerrainControlSvg(editorState);
    setEditorExport(svg);
    downloadTextFile('terrain-control.svg', svg);
  }, [editorState]);

  const exportTerrainMasks = useCallback(() => {
    if (!editorState) return;
    const masks = exportTerrainMaskSvgs(editorState);
    for (const mask of Object.values(masks)) {
      downloadTextFile(mask.filename, mask.content);
    }
    setEditorExport(Object.values(masks).map((mask) => mask.filename).join('\n'));
  }, [editorState]);

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
    setTransportCityId(null);
    setPendingDeploy(null);
    setPendingTransport(null);
    setCityMenu(null);
    setMapContextMenu(null);
    setShowIntel(false);
    setSelectedUnitId(null);
  }, []);

  const openTransportDialog = useCallback((cityId: NonNullable<typeof selectedCityId>) => {
    setTransportCityId(cityId);
    setDeployCityId(null);
    setPendingDeploy(null);
    setPendingTransport(null);
    setCityMenu(null);
    setMapContextMenu(null);
    setShowIntel(false);
    setSelectedUnitId(null);
  }, []);

  const deployTargets = useMemo(() => (
    state && (pendingDeploy || pendingTransport)
      ? deploymentCells(state, (pendingDeploy ?? pendingTransport)!.cityId)
      : []
  ), [pendingDeploy, pendingTransport, state]);
  const moveTargets = useMemo(() => (
    state && selectedUnitId ? movementCells(state, selectedUnitId) : []
  ), [selectedUnitId, state]);

  const closeDeployDialog = useCallback(() => {
    setDeployCityId(null);
  }, []);

  const closeTransportDialog = useCallback(() => {
    setTransportCityId(null);
  }, []);

  const confirmDeploySetup = useCallback((input: DeployConfirmInput) => {
    setPendingDeploy(input);
    setDeployCityId(null);
  }, []);

  const confirmTransportSetup = useCallback((input: TransportConfirmInput) => {
    setPendingTransport(input);
    setTransportCityId(null);
  }, []);

  const selectDeployTarget = useCallback((coord: GridCoord) => {
    if (!pendingDeploy && !pendingTransport) return;
    if (!deployTargets.some((target) => target.q === coord.q && target.r === coord.r)) return;
    if (pendingTransport) {
      deployTransportUnit({ ...pendingTransport, destination: coord });
      setPendingTransport(null);
      return;
    }
    deployUnit({ ...pendingDeploy!, destination: coord });
    setPendingDeploy(null);
  }, [deployTargets, deployTransportUnit, deployUnit, pendingDeploy, pendingTransport]);

  const selectUnit = useCallback((unitId: string) => {
    if (!state) return;
    const unit = state.units[unitId];
    if (!unit || unit.forceId !== state.playerForceId || unit.moved || unit.movementRemaining <= 0) {
      setSelectedUnitId(null);
      return;
    }
    setCityMenu(null);
    setMapContextMenu(null);
    setSelectedUnitId(unitId);
  }, [state]);

  const selectMoveTarget = useCallback((coord: GridCoord) => {
    if (!selectedUnitId) return;
    if (!moveTargets.some((target) => target.q === coord.q && target.r === coord.r)) return;
    moveUnit(selectedUnitId, coord);
    setSelectedUnitId(null);
  }, [moveTargets, moveUnit, selectedUnitId]);

  const openMapContextMenu = useCallback((position: { x: number; y: number }) => {
    if (cityMenu || editorState || deployCityId || transportCityId || pendingDeploy || pendingTransport) {
      setCityMenu(null);
      return;
    }
    setSelectedUnitId(null);
    setMapContextMenu(position);
  }, [cityMenu, deployCityId, editorState, pendingDeploy, pendingTransport, transportCityId]);

  const proceedTenDayFromMap = useCallback(() => {
    setMapContextMenu(null);
    endTenDay();
    setSelectedUnitId(null);
  }, [endTenDay]);

  const openIntelFromMap = useCallback(() => {
    setMapContextMenu(null);
    setShowIntel(true);
  }, []);

  const saveFromMap = useCallback(() => {
    manualSave();
    setMapContextMenu(null);
  }, [manualSave]);

  const loadFromMap = useCallback(() => {
    if (hasManualSave) loadGame('manual');
    else if (hasAutosave) loadGame('auto');
    setMapContextMenu(null);
  }, [hasAutosave, hasManualSave, loadGame]);

  useEffect(() => {
    if (!mapContextMenu) return undefined;
    const closeOnLeftClickOutside = (event: globalThis.MouseEvent) => {
      if (event.button !== 0) return;
      if (mapContextMenuRef.current?.contains(event.target as Node)) return;
      setMapContextMenu(null);
    };

    document.addEventListener('mousedown', closeOnLeftClickOutside);
    return () => document.removeEventListener('mousedown', closeOnLeftClickOutside);
  }, [mapContextMenu]);

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
        moveTargets={moveTargets}
        selectedUnitId={selectedUnitId}
        onCellHover={setHoveredCell}
        onMoveTargetSelect={selectMoveTarget}
        onUnitSelect={selectUnit}
        onMapContextMenu={openMapContextMenu}
      />
      {hoveredCell && (
        <div className="hover-coordinate tool-panel" data-testid="hover-coordinate">
          坐标：{hoveredCell.q},{hoveredCell.r} 地形：{TERRAIN_LABELS[hoveredCell.terrain]}
        </div>
      )}
      <button type="button" className="map-editor-toggle primary-button" onClick={openEditor}>地图编辑</button>
      <ForceOverviewPanel />
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
          onExportMasks={exportTerrainMasks}
          onExportSvg={() => setEditorExport(exportEditorSvg(editorState))}
          onExportTerrainControl={exportTerrainControl}
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
          onTransport={openTransportDialog}
          onClose={() => setCityMenu(null)}
        />
      )}
      {mapContextMenu && (
        <nav
          ref={mapContextMenuRef}
          className="map-context-menu tool-panel"
          data-testid="map-context-menu"
          style={{ left: mapContextMenu.x, top: mapContextMenu.y }}
          aria-label="地图命令菜单"
        >
          <button type="button" onClick={proceedTenDayFromMap}>进行</button>
          <button type="button" onClick={openIntelFromMap}>情报</button>
          <button type="button" onClick={saveFromMap}>储存</button>
          <button type="button" onClick={loadFromMap}>载入</button>
        </nav>
      )}
      {showIntel && state && (
        <section className="intel-panel tool-panel" role="dialog" aria-modal="false" aria-labelledby="intel-title">
          <header>
            <div>
              <p>全局情报</p>
              <h2 id="intel-title">情报</h2>
            </div>
            <button type="button" className="secondary-button" onClick={() => setShowIntel(false)}>关闭</button>
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
              {Object.values(state.cities).map((city) => (
                <div key={city.id} className="intel-row">
                  <span style={{ '--force-color': state.forces[city.ownerId].color } as CSSProperties} />
                  <strong>{city.name}</strong>
                  <small>{state.forces[city.ownerId].name} / {city.troops.toLocaleString('en-US')} 兵</small>
                </div>
              ))}
            </section>
          </div>
        </section>
      )}
      {activeCommand && selectedCityId && <CommandDialog type={activeCommand} cityId={selectedCityId} onClose={closeCommand} />}
      {deployCityId && (
        <DeployDialog
          cityId={deployCityId}
          onConfirm={confirmDeploySetup}
          onClose={closeDeployDialog}
        />
      )}
      {transportCityId && (
        <TransportDialog
          cityId={transportCityId}
          onConfirm={confirmTransportSetup}
          onClose={closeTransportDialog}
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
