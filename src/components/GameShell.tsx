import { ArrowLeft, RotateCcw } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';
import { attackableCities, attackableUnits, deploymentCells, jointAttackableUnits, movementCells, tacticTargetUnits, unitTactics, type TacticId } from '../game/battle/actions';
import type { GridCoord } from '../game/battle/grid';
import {
  clearEditor,
  createEditorState,
  exportEditorJson,
  exportTerrainMaskSvgs,
  exportTerrainControlSvg,
  importEditorJson,
  paintTerrain,
  placeCity,
  redoEditor,
  setEditorBackgroundImage,
  undoEditor,
  type MapEditorState,
  type MapEditorTool,
} from '../game/map-editor/editor';
import { useGame } from '../game/store/GameProvider';
import { territoryForceAt } from '../game/territory';
import type { BattleDamageReport, CityEffectReport, GameCommand, GridCell, TerrainType } from '../game/types';
import { BattlePanel } from './BattlePanel';
import { CityInfoPanel } from './CityInfoPanel';
import { CityCommandMenu } from './CityCommandMenu';
import { CityPanel } from './CityPanel';
import { CommandDialog } from './CommandDialog';
import { DeployDialog, type DeployConfirmInput } from './DeployDialog';
import { EventLog } from './EventLog';
import { ForceOverviewPanel } from './ForceOverviewPanel';
import { GlobalIntelDialog } from './GlobalIntelDialog';
import { MapEditorPanel } from './MapEditorPanel';
import { OfficerListDialog } from './OfficerListDialog';
import { ResultOverlay } from './ResultOverlay';
import { StrategicMap } from './StrategicMap';
import { TopBar } from './TopBar';
import { TransportDialog, type TransportConfirmInput } from './TransportDialog';
import { UnitDetailDialog } from './UnitDetailDialog';
import { UnitInfoPanel } from './UnitInfoPanel';

const UNIT_COMMANDS = ['待命', '攻击', '齐攻', '战法', '单挑', '计略', '设置', '修补'] as const;

const TERRAIN_LABELS: Record<TerrainType, string> = {
  road: '道路',
  plain: '平地',
  forest: '森林',
  hill: '丘陵',
  mountain: '高山',
  shallowWater: '浅水',
  deepWater: '深水',
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
  const { applyMapEditorMap, attackCity, attackUnit, deployTransportUnit, deployUnit, endTenDay, hasAutosave, hasManualSave, loadGame, manualSave, moveUnit, state, selectedCityId, resetGame, useUnitTactic, waitUnit } = useGame();
  const [activeCommand, setActiveCommand] = useState<GameCommand['type'] | null>(null);
  const [deployCityId, setDeployCityId] = useState<NonNullable<typeof selectedCityId> | null>(null);
  const [transportCityId, setTransportCityId] = useState<NonNullable<typeof selectedCityId> | null>(null);
  const [pendingDeploy, setPendingDeploy] = useState<DeployConfirmInput | null>(null);
  const [pendingTransport, setPendingTransport] = useState<TransportConfirmInput | null>(null);
  const [selectedUnitId, setSelectedUnitId] = useState<string | null>(null);
  const [unitCommandMenu, setUnitCommandMenu] = useState<{ unitId: string; position: { x: number; y: number }; destination?: GridCoord } | null>(null);
  const [unitTacticMenu, setUnitTacticMenu] = useState<{ unitId: string; position: { x: number; y: number }; destination?: GridCoord } | null>(null);
  const [unitIntelMenu, setUnitIntelMenu] = useState<{ unitId: string; position: { x: number; y: number } } | null>(null);
  const [unitDetailId, setUnitDetailId] = useState<string | null>(null);
  const [unitOfficerListId, setUnitOfficerListId] = useState<string | null>(null);
  const [targetingAttack, setTargetingAttack] = useState<{ unitId: string; origin?: GridCoord } | null>(null);
  const [targetingTactic, setTargetingTactic] = useState<{ unitId: string; tacticId: TacticId; origin?: GridCoord } | null>(null);
  const [visibleDamageReports, setVisibleDamageReports] = useState<BattleDamageReport[]>([]);
  const [visibleCityEffectReports, setVisibleCityEffectReports] = useState<CityEffectReport[]>([]);
  const [hoveredCell, setHoveredCell] = useState<GridCell | null>(null);
  const [hoveredUnit, setHoveredUnit] = useState<{ unitId: string; position: { x: number; y: number } } | null>(null);
  const [hoveredCity, setHoveredCity] = useState<{ cityId: NonNullable<typeof selectedCityId>; position: { x: number; y: number } } | null>(null);
  const [cityMenu, setCityMenu] = useState<{ cityId: NonNullable<typeof selectedCityId>; position: { x: number; y: number } } | null>(null);
  const [mapContextMenu, setMapContextMenu] = useState<{ x: number; y: number } | null>(null);
  const [showGlobalIntel, setShowGlobalIntel] = useState(false);
  const [showMapIntelOptions, setShowMapIntelOptions] = useState(false);
  const [mapOfficerListScope, setMapOfficerListScope] = useState<'player' | 'all' | null>(null);
  const [viewFinalMap, setViewFinalMap] = useState(false);
  const [editorState, setEditorState] = useState<MapEditorState | null>(null);
  const [editorCalibrationMode, setEditorCalibrationMode] = useState(false);
  const [editorTool, setEditorTool] = useState<MapEditorTool>('plain');
  const [editorExport, setEditorExport] = useState('');
  const mapContextMenuRef = useRef<HTMLElement>(null);
  const unitCommandMenuRef = useRef<HTMLElement>(null);
  const unitTacticMenuRef = useRef<HTMLElement>(null);
  const unitIntelMenuRef = useRef<HTMLElement>(null);
  const uploadedMapUrlRef = useRef<string | null>(null);
  const canOperateCurrentTurn = !state || state.turnForceId === state.playerForceId;
  const closeCommand = useCallback(() => setActiveCommand(null), []);
  const launchCommand = useCallback((type: GameCommand['type']) => {
    setActiveCommand(type);
    setCityMenu(null);
    setMapContextMenu(null);
    setShowMapIntelOptions(false);
    setUnitCommandMenu(null);
    setUnitTacticMenu(null);
    setTargetingAttack(null);
    setTargetingTactic(null);
    setShowGlobalIntel(false);
    setMapOfficerListScope(null);
    setSelectedUnitId(null);
  }, []);

  const revokeUploadedMapPreview = useCallback(() => {
    if (!uploadedMapUrlRef.current) return;
    URL.revokeObjectURL(uploadedMapUrlRef.current);
    uploadedMapUrlRef.current = null;
  }, []);

  const openEditor = useCallback(() => {
    if (!state) return;
    revokeUploadedMapPreview();
    setEditorState(createEditorState(
      state.grid,
      Object.values(state.cities).map((city) => ({ id: city.id, label: city.name, q: city.gridQ, r: city.gridR })),
    ));
    setEditorCalibrationMode(false);
    setEditorExport('');
    setCityMenu(null);
    setMapContextMenu(null);
    setShowMapIntelOptions(false);
    setUnitCommandMenu(null);
    setUnitTacticMenu(null);
    setTargetingAttack(null);
    setTargetingTactic(null);
    setShowGlobalIntel(false);
    setMapOfficerListScope(null);
    setSelectedUnitId(null);
  }, [revokeUploadedMapPreview, state]);

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

  const uploadEditorBackgroundImage = useCallback((file: File) => {
    revokeUploadedMapPreview();
    const url = URL.createObjectURL(file);
    uploadedMapUrlRef.current = url;
    setEditorState((current) => (current ? setEditorBackgroundImage(current, url) : current));
    setEditorCalibrationMode(true);
  }, [revokeUploadedMapPreview]);

  const importEditorJsonFile = useCallback(async (file: File) => {
    if (!editorState) return;
    setEditorExport('正在导入最终游戏地图 JSON...');
    try {
      const json = await file.text();
      const imported = importEditorJson(editorState, json);
      setEditorState(imported);
      applyMapEditorMap({ grid: imported.grid, cities: imported.cities });
      setEditorCalibrationMode(Boolean(imported.backgroundImage));
      setEditorExport('已导入最终游戏地图 JSON，并应用到当前游戏地图。');
    } catch (error) {
      const message = error instanceof Error ? error.message : '地图 JSON 无效';
      setEditorExport(`导入失败：${message}`);
    }
  }, [applyMapEditorMap, editorState]);

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
    setShowMapIntelOptions(false);
    setUnitCommandMenu(null);
    setUnitTacticMenu(null);
    setTargetingAttack(null);
    setTargetingTactic(null);
    setShowGlobalIntel(false);
    setMapOfficerListScope(null);
    setSelectedUnitId(null);
  }, []);

  const openTransportDialog = useCallback((cityId: NonNullable<typeof selectedCityId>) => {
    setTransportCityId(cityId);
    setDeployCityId(null);
    setPendingDeploy(null);
    setPendingTransport(null);
    setCityMenu(null);
    setMapContextMenu(null);
    setShowMapIntelOptions(false);
    setUnitCommandMenu(null);
    setUnitTacticMenu(null);
    setTargetingAttack(null);
    setTargetingTactic(null);
    setShowGlobalIntel(false);
    setMapOfficerListScope(null);
    setSelectedUnitId(null);
  }, []);

  const deployTargets = useMemo(() => {
    const pending = pendingDeploy ?? pendingTransport;
    if (!state || !pending) return [];
    return deploymentCells(state, pending.cityId, undefined, pendingDeploy ? pendingDeploy.troopType : 'transport');
  }, [pendingDeploy, pendingTransport, state]);
  const moveTargets = useMemo(() => (
    state && selectedUnitId && !targetingAttack && !targetingTactic ? movementCells(state, selectedUnitId) : []
  ), [selectedUnitId, state, targetingAttack, targetingTactic]);
  const unitMenuAttackTargets = useMemo(() => (
    state && unitCommandMenu ? attackableUnits(state, unitCommandMenu.unitId, unitCommandMenu.destination) : []
  ), [state, unitCommandMenu]);
  const unitMenuAttackCities = useMemo(() => (
    state && unitCommandMenu ? attackableCities(state, unitCommandMenu.unitId, unitCommandMenu.destination) : []
  ), [state, unitCommandMenu]);
  const unitMenuJointAttackTargets = useMemo(() => (
    state && unitCommandMenu ? jointAttackableUnits(state, unitCommandMenu.unitId, unitCommandMenu.destination) : []
  ), [state, unitCommandMenu]);
  const unitMenuTactics = useMemo(() => (
    state && unitCommandMenu
      ? unitTactics(state, unitCommandMenu.unitId).filter((tactic) => tacticTargetUnits(state, unitCommandMenu.unitId, tactic.id, unitCommandMenu.destination).length > 0)
      : []
  ), [state, unitCommandMenu]);
  const unitMenuTacticTargets = useMemo(() => (
    state && unitCommandMenu
      ? unitMenuTactics.flatMap((tactic) => tacticTargetUnits(state, unitCommandMenu.unitId, tactic.id, unitCommandMenu.destination))
      : []
  ), [state, unitCommandMenu, unitMenuTactics]);
  const tacticMenuTactics = useMemo(() => (
    state && unitTacticMenu
      ? unitTactics(state, unitTacticMenu.unitId).filter((tactic) => tacticTargetUnits(state, unitTacticMenu.unitId, tactic.id, unitTacticMenu.destination).length > 0)
      : []
  ), [state, unitTacticMenu]);
  const attackTargetUnitIds = useMemo(() => {
    if (!state) return [];
    if (targetingAttack) return attackableUnits(state, targetingAttack.unitId, targetingAttack.origin).map((unit) => unit.id);
    if (targetingTactic) return tacticTargetUnits(state, targetingTactic.unitId, targetingTactic.tacticId, targetingTactic.origin).map((unit) => unit.id);
    return [];
  }, [state, targetingAttack, targetingTactic]);
  const attackTargetCityIds = useMemo(() => {
    if (!state || !targetingAttack) return [];
    return attackableCities(state, targetingAttack.unitId, targetingAttack.origin).map((city) => city.id);
  }, [state, targetingAttack]);

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
    if (!canOperateCurrentTurn) return;
    if (!pendingDeploy && !pendingTransport) return;
    if (!deployTargets.some((target) => target.q === coord.q && target.r === coord.r)) return;
    if (pendingTransport) {
      deployTransportUnit({ ...pendingTransport, destination: coord });
      setPendingTransport(null);
      return;
    }
    deployUnit({ ...pendingDeploy!, destination: coord });
    setPendingDeploy(null);
  }, [canOperateCurrentTurn, deployTargets, deployTransportUnit, deployUnit, pendingDeploy, pendingTransport]);

  const selectUnit = useCallback((unitId: string, position: { x: number; y: number }) => {
    if (!state) return;
    const unit = state.units[unitId];
    if (!canOperateCurrentTurn || !unit || unit.forceId !== state.playerForceId || unit.moved || unit.movementRemaining <= 0) {
      setSelectedUnitId(null);
      setUnitCommandMenu(null);
      setUnitTacticMenu(null);
      setTargetingAttack(null);
      setTargetingTactic(null);
      return;
    }
    setCityMenu(null);
    setMapContextMenu(null);
    setUnitTacticMenu(null);
    setTargetingAttack(null);
    setTargetingTactic(null);
    if (selectedUnitId === unitId) {
      setUnitCommandMenu({ unitId, position });
      return;
    }
    setUnitCommandMenu(null);
    setSelectedUnitId(unitId);
  }, [canOperateCurrentTurn, selectedUnitId, state]);

  const openUnitIntelMenu = useCallback((unitId: string, position: { x: number; y: number }) => {
    if (!state?.units[unitId]) return;
    setHoveredUnit(null);
    setHoveredCity(null);
    setCityMenu(null);
    setMapContextMenu(null);
    setShowMapIntelOptions(false);
    setUnitCommandMenu(null);
    setUnitTacticMenu(null);
    setTargetingAttack(null);
    setTargetingTactic(null);
    setSelectedUnitId(null);
    setUnitIntelMenu({ unitId, position });
  }, [state]);

  const openUnitDetail = useCallback(() => {
    if (!unitIntelMenu) return;
    setUnitDetailId(unitIntelMenu.unitId);
    setUnitIntelMenu(null);
  }, [unitIntelMenu]);

  const openUnitOfficers = useCallback(() => {
    if (!unitIntelMenu) return;
    setUnitOfficerListId(unitIntelMenu.unitId);
    setUnitIntelMenu(null);
  }, [unitIntelMenu]);

  const selectMoveTarget = useCallback((coord: GridCoord, position: { x: number; y: number }) => {
    if (!canOperateCurrentTurn) return;
    if (!selectedUnitId) return;
    if (!moveTargets.some((target) => target.q === coord.q && target.r === coord.r)) return;
    setCityMenu(null);
    setMapContextMenu(null);
    setUnitTacticMenu(null);
    setTargetingAttack(null);
    setTargetingTactic(null);
    setUnitCommandMenu({ unitId: selectedUnitId, position, destination: coord });
  }, [canOperateCurrentTurn, moveTargets, selectedUnitId]);

  const executeUnitAttackCommand = useCallback(() => {
    if (
      !canOperateCurrentTurn ||
      !state ||
      !unitCommandMenu ||
      (attackableUnits(state, unitCommandMenu.unitId, unitCommandMenu.destination).length === 0 &&
        attackableCities(state, unitCommandMenu.unitId, unitCommandMenu.destination).length === 0)
    ) return;
    setSelectedUnitId(unitCommandMenu.unitId);
    setTargetingAttack({ unitId: unitCommandMenu.unitId, origin: unitCommandMenu.destination });
    setTargetingTactic(null);
    setUnitTacticMenu(null);
    setUnitCommandMenu(null);
  }, [canOperateCurrentTurn, state, unitCommandMenu]);

  const executeUnitTacticCommand = useCallback(() => {
    if (!canOperateCurrentTurn || !unitCommandMenu || unitMenuTactics.length === 0) return;
    setUnitTacticMenu({
      unitId: unitCommandMenu.unitId,
      position: { x: unitCommandMenu.position.x + 108, y: unitCommandMenu.position.y },
      destination: unitCommandMenu.destination,
    });
  }, [canOperateCurrentTurn, unitCommandMenu, unitMenuTactics.length]);

  const selectUnitTactic = useCallback((tacticId: TacticId) => {
    if (!canOperateCurrentTurn) return;
    if (!unitTacticMenu) return;
    setSelectedUnitId(unitTacticMenu.unitId);
    setTargetingAttack(null);
    setTargetingTactic({ unitId: unitTacticMenu.unitId, tacticId, origin: unitTacticMenu.destination });
    setUnitCommandMenu(null);
    setUnitTacticMenu(null);
  }, [canOperateCurrentTurn, unitTacticMenu]);

  const executeUnitWaitCommand = useCallback(() => {
    if (!canOperateCurrentTurn) return;
    if (!unitCommandMenu) return;
    if (unitCommandMenu.destination) {
      moveUnit(unitCommandMenu.unitId, unitCommandMenu.destination);
    } else {
      waitUnit(unitCommandMenu.unitId);
    }
    setUnitCommandMenu(null);
    setUnitTacticMenu(null);
    setTargetingAttack(null);
    setTargetingTactic(null);
    setSelectedUnitId(null);
  }, [canOperateCurrentTurn, moveUnit, unitCommandMenu, waitUnit]);

  const selectAttackTarget = useCallback((targetId: string) => {
    if (!canOperateCurrentTurn) return;
    if (!attackTargetUnitIds.includes(targetId)) return;
    if (targetingTactic) {
      useUnitTactic(targetingTactic.unitId, targetId, targetingTactic.tacticId, targetingTactic.origin);
    } else if (targetingAttack) {
      attackUnit(targetingAttack.unitId, targetId, targetingAttack.origin);
    } else {
      return;
    }
    setTargetingAttack(null);
    setTargetingTactic(null);
    setSelectedUnitId(null);
    setUnitCommandMenu(null);
    setUnitTacticMenu(null);
  }, [attackTargetUnitIds, attackUnit, canOperateCurrentTurn, targetingAttack, targetingTactic, useUnitTactic]);

  const selectAttackCityTarget = useCallback((cityId: NonNullable<typeof selectedCityId>) => {
    if (!canOperateCurrentTurn) return;
    if (!targetingAttack || !attackTargetCityIds.includes(cityId)) return;
    attackCity(targetingAttack.unitId, cityId, targetingAttack.origin);
    setTargetingAttack(null);
    setTargetingTactic(null);
    setSelectedUnitId(null);
    setUnitCommandMenu(null);
    setUnitTacticMenu(null);
  }, [attackCity, attackTargetCityIds, canOperateCurrentTurn, targetingAttack]);

  const openMapContextMenu = useCallback((position: { x: number; y: number }) => {
    if (unitCommandMenu || unitTacticMenu) {
      setUnitCommandMenu(null);
      setUnitTacticMenu(null);
      setTargetingAttack(null);
      setTargetingTactic(null);
      return;
    }
    if (selectedUnitId || targetingAttack || targetingTactic) {
      setSelectedUnitId(null);
      setTargetingAttack(null);
      setTargetingTactic(null);
      return;
    }
    if (mapContextMenu) {
      setMapContextMenu(null);
      setShowMapIntelOptions(false);
      return;
    }
    if (cityMenu || editorState || deployCityId || transportCityId || pendingDeploy || pendingTransport) {
      setCityMenu(null);
      return;
    }
    setSelectedUnitId(null);
    setUnitCommandMenu(null);
    setUnitTacticMenu(null);
    setTargetingAttack(null);
    setTargetingTactic(null);
    setShowMapIntelOptions(false);
    setMapContextMenu(position);
  }, [cityMenu, deployCityId, editorState, mapContextMenu, pendingDeploy, pendingTransport, selectedUnitId, targetingAttack, targetingTactic, transportCityId, unitCommandMenu, unitTacticMenu]);

  const proceedTenDayFromMap = useCallback(() => {
    setMapContextMenu(null);
    setShowMapIntelOptions(false);
    setUnitCommandMenu(null);
    setUnitTacticMenu(null);
    setTargetingAttack(null);
    setTargetingTactic(null);
    if (canOperateCurrentTurn) endTenDay();
    setSelectedUnitId(null);
  }, [canOperateCurrentTurn, endTenDay]);

  const openIntelFromMap = useCallback(() => {
    setShowMapIntelOptions((current) => !current);
  }, []);

  const openPlayerOfficersFromMap = useCallback(() => {
    setMapContextMenu(null);
    setShowMapIntelOptions(false);
    setUnitCommandMenu(null);
    setUnitTacticMenu(null);
    setTargetingAttack(null);
    setTargetingTactic(null);
    setMapOfficerListScope('player');
  }, []);

  const openAllOfficersFromMap = useCallback(() => {
    setMapContextMenu(null);
    setShowMapIntelOptions(false);
    setUnitCommandMenu(null);
    setUnitTacticMenu(null);
    setTargetingAttack(null);
    setTargetingTactic(null);
    setMapOfficerListScope('all');
  }, []);

  const openGlobalIntelFromMap = useCallback(() => {
    setMapContextMenu(null);
    setShowMapIntelOptions(false);
    setUnitCommandMenu(null);
    setUnitTacticMenu(null);
    setTargetingAttack(null);
    setTargetingTactic(null);
    setMapOfficerListScope(null);
    setShowGlobalIntel(true);
  }, []);

  const saveFromMap = useCallback(() => {
    manualSave();
    setMapContextMenu(null);
    setShowMapIntelOptions(false);
    setUnitCommandMenu(null);
    setUnitTacticMenu(null);
    setTargetingAttack(null);
    setTargetingTactic(null);
  }, [manualSave]);

  const loadFromMap = useCallback(() => {
    if (hasManualSave) loadGame('manual');
    else if (hasAutosave) loadGame('auto');
    setMapContextMenu(null);
    setShowMapIntelOptions(false);
    setUnitCommandMenu(null);
    setUnitTacticMenu(null);
    setTargetingAttack(null);
    setTargetingTactic(null);
  }, [hasAutosave, hasManualSave, loadGame]);

  const closeMapContextMenuFromRightClick = useCallback((event: ReactMouseEvent<HTMLElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setMapContextMenu(null);
    setShowMapIntelOptions(false);
  }, []);

  const closeUnitCommandMenuFromRightClick = useCallback((event: ReactMouseEvent<HTMLElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setUnitCommandMenu(null);
    setUnitTacticMenu(null);
  }, []);

  const closeUnitIntelMenuFromRightClick = useCallback((event: ReactMouseEvent<HTMLElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setUnitIntelMenu(null);
  }, []);

  useEffect(() => {
    if (!mapContextMenu) return undefined;
    const closeOnLeftClickOutside = (event: globalThis.MouseEvent) => {
      if (event.button !== 0) return;
      if (mapContextMenuRef.current?.contains(event.target as Node)) return;
      setMapContextMenu(null);
      setShowMapIntelOptions(false);
    };

    document.addEventListener('mousedown', closeOnLeftClickOutside);
    return () => document.removeEventListener('mousedown', closeOnLeftClickOutside);
  }, [mapContextMenu]);

  useEffect(() => {
    if (!unitCommandMenu) return undefined;
    const closeOnLeftClickOutside = (event: globalThis.PointerEvent) => {
      if (event.button !== 0) return;
      if (unitCommandMenuRef.current?.contains(event.target as Node)) return;
      if (unitTacticMenuRef.current?.contains(event.target as Node)) return;
      setUnitCommandMenu(null);
    };

    document.addEventListener('pointerdown', closeOnLeftClickOutside);
    return () => document.removeEventListener('pointerdown', closeOnLeftClickOutside);
  }, [unitCommandMenu]);

  useEffect(() => {
    if (!unitTacticMenu) return undefined;
    const closeOnPointerOutside = (event: globalThis.PointerEvent) => {
      if (unitTacticMenuRef.current?.contains(event.target as Node)) return;
      if (unitCommandMenuRef.current?.contains(event.target as Node)) return;
      setUnitTacticMenu(null);
    };

    document.addEventListener('pointerdown', closeOnPointerOutside);
    return () => document.removeEventListener('pointerdown', closeOnPointerOutside);
  }, [unitTacticMenu]);

  useEffect(() => {
    if (!unitIntelMenu) return undefined;
    const closeOnPointerOutside = (event: globalThis.PointerEvent) => {
      if (unitIntelMenuRef.current?.contains(event.target as Node)) return;
      setUnitIntelMenu(null);
    };

    document.addEventListener('pointerdown', closeOnPointerOutside);
    return () => document.removeEventListener('pointerdown', closeOnPointerOutside);
  }, [unitIntelMenu]);

  useEffect(() => {
    const reports = state?.battleDamageReports ?? [];
    if (reports.length === 0) {
      setVisibleDamageReports([]);
      return undefined;
    }

    setVisibleDamageReports(reports);
    const timer = window.setTimeout(() => setVisibleDamageReports([]), 2000);
    return () => window.clearTimeout(timer);
  }, [state?.battleDamageReports]);

  useEffect(() => {
    const reports = state?.cityEffectReports ?? [];
    if (reports.length === 0) {
      setVisibleCityEffectReports([]);
      return undefined;
    }

    setVisibleCityEffectReports(reports);
    const timer = window.setTimeout(() => setVisibleCityEffectReports([]), 2000);
    return () => window.clearTimeout(timer);
  }, [state?.cityEffectReports]);

  useEffect(() => revokeUploadedMapPreview, [revokeUploadedMapPreview]);

  return (
    <main className="game-shell">
      <TopBar />
      <StrategicMap
        onCityMenu={(cityId, position) => {
          if (!canOperateCurrentTurn) return;
          setMapContextMenu(null);
          setCityMenu({ cityId, position });
        }}
        backgroundImage={editorCalibrationMode ? editorState?.backgroundImage : undefined}
        editorGrid={editorState?.grid}
        editorCities={editorState?.cities}
        editorMode={Boolean(editorState)}
        onEditorCellPaint={editCell}
        deployTargets={deployTargets}
        onDeployTargetSelect={selectDeployTarget}
        moveTargets={moveTargets}
        attackTargetCityIds={attackTargetCityIds}
        attackTargetUnitIds={attackTargetUnitIds}
        damageReports={visibleDamageReports}
        cityEffectReports={visibleCityEffectReports}
        selectedUnitId={selectedUnitId}
        onCellHover={setHoveredCell}
        onMoveTargetSelect={selectMoveTarget}
        onUnitSelect={selectUnit}
        onUnitContextMenu={openUnitIntelMenu}
        onUnitHover={(unitId, position) => setHoveredUnit({ unitId, position })}
        onUnitLeave={() => setHoveredUnit(null)}
        onCityHover={(cityId, position) => setHoveredCity({ cityId, position })}
        onCityLeave={() => setHoveredCity(null)}
        onAttackTargetSelect={selectAttackTarget}
        onAttackCityTargetSelect={selectAttackCityTarget}
        onMapContextClose={() => setMapContextMenu(null)}
        onMapContextMenu={openMapContextMenu}
      />
      {state && hoveredCell && (
        <div className="hover-coordinate tool-panel" data-testid="hover-coordinate">
          坐标：{hoveredCell.q},{hoveredCell.r} 地形：{TERRAIN_LABELS[hoveredCell.terrain]} 疆域：{state.forces[territoryForceAt(state, hoveredCell)].name}
        </div>
      )}
      {state && hoveredUnit && state.units[hoveredUnit.unitId] && (
        <UnitInfoPanel unit={state.units[hoveredUnit.unitId]} state={state} position={hoveredUnit.position} />
      )}
      <button type="button" className="map-editor-toggle primary-button" data-testid="map-editor-toggle-button" onClick={openEditor}>地图编辑</button>
      {state && hoveredCity && state.cities[hoveredCity.cityId] && (
        <CityInfoPanel city={state.cities[hoveredCity.cityId]} state={state} position={hoveredCity.position} />
      )}
      <ForceOverviewPanel />
      <CityPanel onCommand={launchCommand} />
      <BattlePanel />
      <EventLog />
      {editorState && (
        <MapEditorPanel
          activeTool={editorTool}
          backgroundImage={editorState.backgroundImage}
          canRedo={editorState.future.length > 0}
          canUndo={editorState.history.length > 0}
          calibrationMode={editorCalibrationMode}
          exportValue={editorExport}
          onBackgroundImageChange={(value) => setEditorState((current) => (current ? setEditorBackgroundImage(current, value) : current))}
          onBackgroundImageUpload={uploadEditorBackgroundImage}
          onCalibrationModeChange={setEditorCalibrationMode}
          onClear={() => setEditorState((current) => (current ? clearEditor(current, 'plain') : current))}
          onClose={() => setEditorState(null)}
          onExportJson={() => setEditorExport(exportEditorJson(editorState))}
          onExportMasks={exportTerrainMasks}
          onExportTerrainControl={exportTerrainControl}
          onImportJsonFile={importEditorJsonFile}
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
          onContextMenu={closeMapContextMenuFromRightClick}
        >
          <button type="button" data-testid="map-context-proceed-button" onClick={proceedTenDayFromMap} disabled={!canOperateCurrentTurn}>进行</button>
          <button type="button" data-testid="map-context-intel-button" onClick={openIntelFromMap}>情报</button>
          <button type="button" data-testid="map-context-save-button" onClick={saveFromMap}>储存</button>
          <button type="button" data-testid="map-context-load-button" onClick={loadFromMap}>载入</button>
          {showMapIntelOptions && (
            <div className="map-context-submenu tool-panel" data-testid="map-context-intel-submenu">
              <button type="button" data-testid="map-context-player-officers-button" onClick={openPlayerOfficersFromMap}>我方武将</button>
              <button type="button" data-testid="map-context-all-officers-button" onClick={openAllOfficersFromMap}>所有武将</button>
              <button type="button" data-testid="map-context-global-intel-button" onClick={openGlobalIntelFromMap}>全局情报</button>
            </div>
          )}
        </nav>
      )}
      {unitCommandMenu && (
        <nav
          ref={unitCommandMenuRef}
          className="unit-command-menu tool-panel"
          data-testid="unit-command-menu"
          style={{ left: unitCommandMenu.position.x, top: unitCommandMenu.position.y }}
          aria-label="部队命令菜单"
          onContextMenu={closeUnitCommandMenuFromRightClick}
        >
          {UNIT_COMMANDS.map((command) => {
            const disabled =
              (command === '攻击' && unitMenuAttackTargets.length === 0 && unitMenuAttackCities.length === 0) ||
              (command === '单挑' && unitMenuAttackTargets.length === 0) ||
              (command === '齐攻' && unitMenuJointAttackTargets.length === 0) ||
              (command === '战法' && unitMenuTacticTargets.length === 0);
            const onClick =
              command === '待命' ? executeUnitWaitCommand :
              command === '攻击' ? executeUnitAttackCommand :
              command === '战法' ? executeUnitTacticCommand :
              undefined;
            return (
              <button
                key={command}
                type="button"
                className={disabled ? 'is-disabled' : undefined}
                disabled={disabled}
                onClick={onClick}
              >
                {command}
              </button>
            );
          })}
        </nav>
      )}
      {unitTacticMenu && (
        <nav
          ref={unitTacticMenuRef}
          className="unit-tactic-menu tool-panel"
          data-testid="unit-tactic-menu"
          style={{ left: unitTacticMenu.position.x, top: unitTacticMenu.position.y }}
          aria-label="部队战法菜单"
          onContextMenu={(event) => {
            event.preventDefault();
            event.stopPropagation();
            setUnitTacticMenu(null);
          }}
        >
          {tacticMenuTactics.map((tactic) => (
            <button key={tactic.id} type="button" onClick={() => selectUnitTactic(tactic.id)}>
              {tactic.name}
            </button>
          ))}
        </nav>
      )}
      {unitIntelMenu && (
        <nav
          ref={unitIntelMenuRef}
          className="unit-intel-context-menu tool-panel"
          data-testid="unit-intel-context-menu"
          style={{ left: unitIntelMenu.position.x, top: unitIntelMenu.position.y }}
          aria-label="部队情报菜单"
          onContextMenu={closeUnitIntelMenuFromRightClick}
        >
          <button type="button" data-testid="unit-detail-button" onClick={openUnitDetail}>详细情报</button>
          <button type="button" data-testid="unit-officers-button" onClick={openUnitOfficers}>所属武将</button>
        </nav>
      )}
      {showGlobalIntel && state && <GlobalIntelDialog state={state} onClose={() => setShowGlobalIntel(false)} />}
      {mapOfficerListScope && <OfficerListDialog scope={mapOfficerListScope} onClose={() => setMapOfficerListScope(null)} />}
      {unitDetailId && state?.units[unitDetailId] && (
        <UnitDetailDialog unit={state.units[unitDetailId]} state={state} onClose={() => setUnitDetailId(null)} />
      )}
      {unitOfficerListId && state?.units[unitOfficerListId] && (
        <OfficerListDialog
          officerIds={state.units[unitOfficerListId].officerIds ?? [state.units[unitOfficerListId].leaderId]}
          onClose={() => setUnitOfficerListId(null)}
        />
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
