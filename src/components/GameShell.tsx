import { ArrowLeft, RotateCcw } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';
import { playClickOnSound, playLeftMouseSound, playRightMouseSound, playWaitingForTargetSound } from '../audio/soundEffects';
import { attackableCities, attackableFacilities, attackableUnits, deploymentCells, deployUnitPreviewWithId, FACILITY_BUILD_COSTS, facilityBuildTargets, jointAttackableUnits, movementCells, repairableFacilities, strategyTargetCells, strategyTargetUnits, tacticTargetUnits, unitFacilities, unitIsIncapacitated, unitStrategies, unitTactics, type StrategyId, type TacticId } from '../game/battle/actions';
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
import type { BattleDamageReport, CityEffectReport, FacilityRepairReport, FacilityType, GameCommand, GridCell, TerrainType } from '../game/types';
import { BattlePanel } from './BattlePanel';
import { CityInfoPanel } from './CityInfoPanel';
import { CityCommandMenu } from './CityCommandMenu';
import { CityPanel } from './CityPanel';
import { CommandDialog } from './CommandDialog';
import { DeployDialog, type DeployConfirmInput } from './DeployDialog';
import { EventLog } from './EventLog';
import { FacilityInfoPanel } from './FacilityInfoPanel';
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
const UNIT_STRATEGIES = unitStrategies();
const UNIT_FACILITIES = unitFacilities();
const PENDING_DEPLOY_UNIT_ID = '__pending-deploy__';

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
  const { applyMapEditorMap, attackCity, attackFacility, attackUnit, buildFacility, deployTransportUnit, deployUnit, deployUnitAction, dismantleFacility, endTenDay, hasAutosave, hasManualSave, loadGame, manualSave, moveUnit, repairFacility, state, selectedCityId, resetGame, useUnitStrategy, useUnitTactic, waitUnit } = useGame();
  const [activeCommand, setActiveCommand] = useState<GameCommand['type'] | null>(null);
  const [deployCityId, setDeployCityId] = useState<NonNullable<typeof selectedCityId> | null>(null);
  const [transportCityId, setTransportCityId] = useState<NonNullable<typeof selectedCityId> | null>(null);
  const [pendingDeploy, setPendingDeploy] = useState<DeployConfirmInput | null>(null);
  const [pendingTransport, setPendingTransport] = useState<TransportConfirmInput | null>(null);
  const [pendingDeployCommand, setPendingDeployCommand] = useState<{ input: DeployConfirmInput; destination: GridCoord } | null>(null);
  const [pendingDeployAction, setPendingDeployAction] = useState<{ input: DeployConfirmInput & { destination: GridCoord }; unitId: string } | null>(null);
  const [selectedUnitId, setSelectedUnitId] = useState<string | null>(null);
  const [unitCommandMenu, setUnitCommandMenu] = useState<{ unitId: string; position: { x: number; y: number }; destination?: GridCoord } | null>(null);
  const [unitTacticMenu, setUnitTacticMenu] = useState<{ unitId: string; position: { x: number; y: number }; destination?: GridCoord } | null>(null);
  const [unitStrategyMenu, setUnitStrategyMenu] = useState<{ unitId: string; position: { x: number; y: number }; destination?: GridCoord } | null>(null);
  const [unitFacilityMenu, setUnitFacilityMenu] = useState<{ unitId: string; position: { x: number; y: number }; destination?: GridCoord } | null>(null);
  const [unitIntelMenu, setUnitIntelMenu] = useState<{ unitId: string; position: { x: number; y: number } } | null>(null);
  const [unitDetailId, setUnitDetailId] = useState<string | null>(null);
  const [unitOfficerListId, setUnitOfficerListId] = useState<string | null>(null);
  const [targetingAttack, setTargetingAttack] = useState<{ unitId: string; origin?: GridCoord } | null>(null);
  const [targetingTactic, setTargetingTactic] = useState<{ unitId: string; tacticId: TacticId; origin?: GridCoord } | null>(null);
  const [targetingFirePlot, setTargetingFirePlot] = useState<{ unitId: string; strategyId: StrategyId; origin?: GridCoord } | null>(null);
  const [targetingUnitStrategy, setTargetingUnitStrategy] = useState<{ unitId: string; strategyId: StrategyId; origin?: GridCoord } | null>(null);
  const [targetingFacility, setTargetingFacility] = useState<{ unitId: string; facilityType: FacilityType; origin?: GridCoord } | null>(null);
  const [targetingRepair, setTargetingRepair] = useState<{ unitId: string; origin?: GridCoord } | null>(null);
  const [visibleDamageReports, setVisibleDamageReports] = useState<BattleDamageReport[]>([]);
  const [visibleCityEffectReports, setVisibleCityEffectReports] = useState<CityEffectReport[]>([]);
  const [visibleFacilityRepairReports, setVisibleFacilityRepairReports] = useState<FacilityRepairReport[]>([]);
  const [hoveredCell, setHoveredCell] = useState<GridCell | null>(null);
  const [hoveredUnit, setHoveredUnit] = useState<{ unitId: string; position: { x: number; y: number } } | null>(null);
  const [hoveredCity, setHoveredCity] = useState<{ cityId: NonNullable<typeof selectedCityId>; position: { x: number; y: number } } | null>(null);
  const [hoveredFacility, setHoveredFacility] = useState<{ facilityId: string; position: { x: number; y: number } } | null>(null);
  const [cityMenu, setCityMenu] = useState<{ cityId: NonNullable<typeof selectedCityId>; position: { x: number; y: number } } | null>(null);
  const [facilityContextMenu, setFacilityContextMenu] = useState<{ facilityId: string; position: { x: number; y: number } } | null>(null);
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
  const unitStrategyMenuRef = useRef<HTMLElement>(null);
  const unitFacilityMenuRef = useRef<HTMLElement>(null);
  const unitIntelMenuRef = useRef<HTMLElement>(null);
  const facilityContextMenuRef = useRef<HTMLElement>(null);
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
    setUnitStrategyMenu(null);
    setPendingDeployCommand(null);
    setPendingDeployAction(null);
    setTargetingAttack(null);
    setTargetingTactic(null);
    setTargetingFirePlot(null);
    setTargetingUnitStrategy(null);
    setTargetingFacility(null);
    setTargetingRepair(null);
    setShowGlobalIntel(false);
    setMapOfficerListScope(null);
    setSelectedUnitId(null);
    setFacilityContextMenu(null);
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
    setUnitStrategyMenu(null);
    setPendingDeployCommand(null);
    setPendingDeployAction(null);
    setTargetingAttack(null);
    setTargetingTactic(null);
    setTargetingFirePlot(null);
    setTargetingUnitStrategy(null);
    setTargetingFacility(null);
    setTargetingRepair(null);
    setShowGlobalIntel(false);
    setMapOfficerListScope(null);
    setSelectedUnitId(null);
    setFacilityContextMenu(null);
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
    setPendingDeployCommand(null);
    setPendingDeployAction(null);
    setCityMenu(null);
    setMapContextMenu(null);
    setShowMapIntelOptions(false);
    setUnitCommandMenu(null);
    setUnitTacticMenu(null);
    setUnitStrategyMenu(null);
    setTargetingAttack(null);
    setTargetingTactic(null);
    setTargetingFirePlot(null);
    setTargetingUnitStrategy(null);
    setTargetingFacility(null);
    setTargetingRepair(null);
    setShowGlobalIntel(false);
    setMapOfficerListScope(null);
    setSelectedUnitId(null);
    setFacilityContextMenu(null);
  }, []);

  const openTransportDialog = useCallback((cityId: NonNullable<typeof selectedCityId>) => {
    setTransportCityId(cityId);
    setDeployCityId(null);
    setPendingDeploy(null);
    setPendingTransport(null);
    setPendingDeployCommand(null);
    setPendingDeployAction(null);
    setCityMenu(null);
    setMapContextMenu(null);
    setShowMapIntelOptions(false);
    setUnitCommandMenu(null);
    setUnitTacticMenu(null);
    setUnitStrategyMenu(null);
    setTargetingAttack(null);
    setTargetingTactic(null);
    setTargetingFirePlot(null);
    setTargetingUnitStrategy(null);
    setTargetingFacility(null);
    setTargetingRepair(null);
    setShowGlobalIntel(false);
    setMapOfficerListScope(null);
    setSelectedUnitId(null);
    setFacilityContextMenu(null);
  }, []);

  const deployTargets = useMemo(() => {
    const pending = pendingDeploy ?? pendingTransport;
    if (!state || !pending) return [];
    if (targetingFacility || targetingFirePlot || targetingRepair) return [];
    return deploymentCells(state, pending.cityId, undefined, pendingDeploy ? pendingDeploy.troopType : 'transport');
  }, [pendingDeploy, pendingTransport, state, targetingFacility, targetingFirePlot, targetingRepair]);
  const moveTargets = useMemo(() => (
    state && selectedUnitId && !targetingAttack && !targetingTactic && !targetingFirePlot && !targetingUnitStrategy && !targetingFacility && !targetingRepair ? movementCells(state, selectedUnitId) : []
  ), [selectedUnitId, state, targetingAttack, targetingFacility, targetingFirePlot, targetingRepair, targetingTactic, targetingUnitStrategy]);
  const isPendingDeployCommandMenu = unitCommandMenu?.unitId === PENDING_DEPLOY_UNIT_ID;
  const pendingDeployPreview = useMemo(() => {
    if (!state || !pendingDeployCommand || !isPendingDeployCommandMenu) return null;
    try {
      return deployUnitPreviewWithId(state, state.playerForceId, {
        ...pendingDeployCommand.input,
        destination: pendingDeployCommand.destination,
      });
    } catch {
      return null;
    }
  }, [isPendingDeployCommandMenu, pendingDeployCommand, state]);
  const pendingDeployActionPreview = useMemo(() => {
    if (!state || !pendingDeployAction) return null;
    try {
      return deployUnitPreviewWithId(state, state.playerForceId, pendingDeployAction.input);
    } catch {
      return null;
    }
  }, [pendingDeployAction, state]);
  const unitMenuState = pendingDeployPreview?.state ?? state;
  const unitMenuUnitId = pendingDeployPreview?.unitId ?? unitCommandMenu?.unitId;
  const unitMenuDestination = pendingDeployPreview ? undefined : unitCommandMenu?.destination;
  const unitMenuAttackTargets = useMemo(() => (
    unitMenuState && unitMenuUnitId ? attackableUnits(unitMenuState, unitMenuUnitId, unitMenuDestination) : []
  ), [unitMenuDestination, unitMenuState, unitMenuUnitId]);
  const unitMenuAttackCities = useMemo(() => (
    unitMenuState && unitMenuUnitId ? attackableCities(unitMenuState, unitMenuUnitId, unitMenuDestination) : []
  ), [unitMenuDestination, unitMenuState, unitMenuUnitId]);
  const unitMenuAttackFacilities = useMemo(() => (
    unitMenuState && unitMenuUnitId ? attackableFacilities(unitMenuState, unitMenuUnitId, unitMenuDestination) : []
  ), [unitMenuDestination, unitMenuState, unitMenuUnitId]);
  const unitMenuRepairTargets = useMemo(() => (
    unitMenuState && unitMenuUnitId ? repairableFacilities(unitMenuState, unitMenuUnitId, unitMenuDestination) : []
  ), [unitMenuDestination, unitMenuState, unitMenuUnitId]);
  const unitMenuJointAttackTargets = useMemo(() => (
    unitMenuState && unitMenuUnitId ? jointAttackableUnits(unitMenuState, unitMenuUnitId, unitMenuDestination) : []
  ), [unitMenuDestination, unitMenuState, unitMenuUnitId]);
  const unitMenuTactics = useMemo(() => (
    unitMenuState && unitMenuUnitId
      ? unitTactics(unitMenuState, unitMenuUnitId).filter((tactic) => tacticTargetUnits(unitMenuState, unitMenuUnitId, tactic.id, unitMenuDestination).length > 0)
      : []
  ), [unitMenuDestination, unitMenuState, unitMenuUnitId]);
  const unitMenuTacticTargets = useMemo(() => (
    unitMenuState && unitMenuUnitId
      ? unitMenuTactics.flatMap((tactic) => tacticTargetUnits(unitMenuState, unitMenuUnitId, tactic.id, unitMenuDestination))
      : []
  ), [unitMenuDestination, unitMenuState, unitMenuTactics, unitMenuUnitId]);
  const unitMenuStrategies = useMemo(() => (
    unitMenuState && unitMenuUnitId
      ? UNIT_STRATEGIES.filter((strategy) => {
        const unit = unitMenuState.units[unitMenuUnitId];
        if (!unit || unit.energy < strategy.cost) return false;
        if (strategy.target === 'cell') return strategyTargetCells(unitMenuState, unitMenuUnitId, strategy.id, unitMenuDestination).length > 0;
        return strategyTargetUnits(unitMenuState, unitMenuUnitId, strategy.id, unitMenuDestination).length > 0;
      })
      : []
  ), [unitMenuDestination, unitMenuState, unitMenuUnitId]);
  const unitMenuFacilities = useMemo(() => (
    unitMenuState && unitMenuUnitId
      ? UNIT_FACILITIES.filter((facility) => facilityBuildTargets(unitMenuState, unitMenuUnitId, unitMenuDestination, facility.type).length > 0)
      : []
  ), [unitMenuDestination, unitMenuState, unitMenuUnitId]);
  const tacticMenuTactics = useMemo(() => (
    state && unitTacticMenu
      ? unitTactics(state, unitTacticMenu.unitId).filter((tactic) => tacticTargetUnits(state, unitTacticMenu.unitId, tactic.id, unitTacticMenu.destination).length > 0)
      : []
  ), [state, unitTacticMenu]);
  const firePlotTargets = useMemo(() => (
    (pendingDeployActionPreview?.state ?? state) && targetingFacility
      ? facilityBuildTargets((pendingDeployActionPreview?.state ?? state)!, targetingFacility.unitId, targetingFacility.origin, targetingFacility.facilityType)
      : (pendingDeployActionPreview?.state ?? state) && targetingFirePlot ? strategyTargetCells((pendingDeployActionPreview?.state ?? state)!, targetingFirePlot.unitId, targetingFirePlot.strategyId, targetingFirePlot.origin) : []
  ), [pendingDeployActionPreview, state, targetingFacility, targetingFirePlot]);
  const attackTargetUnitIds = useMemo(() => {
    const targetState = pendingDeployActionPreview?.state ?? state;
    if (!targetState) return [];
    if (targetingAttack) return attackableUnits(targetState, targetingAttack.unitId, targetingAttack.origin).map((unit) => unit.id);
    if (targetingTactic) return tacticTargetUnits(targetState, targetingTactic.unitId, targetingTactic.tacticId, targetingTactic.origin).map((unit) => unit.id);
    if (targetingUnitStrategy) return strategyTargetUnits(targetState, targetingUnitStrategy.unitId, targetingUnitStrategy.strategyId, targetingUnitStrategy.origin).map((unit) => unit.id);
    return [];
  }, [pendingDeployActionPreview, state, targetingAttack, targetingTactic, targetingUnitStrategy]);
  const attackTargetCityIds = useMemo(() => {
    const targetState = pendingDeployActionPreview?.state ?? state;
    if (!targetState || !targetingAttack) return [];
    return attackableCities(targetState, targetingAttack.unitId, targetingAttack.origin).map((city) => city.id);
  }, [pendingDeployActionPreview, state, targetingAttack]);
  const targetFacilityIds = useMemo(() => {
    const targetState = pendingDeployActionPreview?.state ?? state;
    if (!targetState) return [];
    if (targetingAttack) return attackableFacilities(targetState, targetingAttack.unitId, targetingAttack.origin).map((facility) => facility.id);
    if (targetingRepair) return repairableFacilities(targetState, targetingRepair.unitId, targetingRepair.origin).map((facility) => facility.id);
    return [];
  }, [pendingDeployActionPreview, state, targetingAttack, targetingRepair]);

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

  const selectDeployTarget = useCallback((coord: GridCoord, position: { x: number; y: number }) => {
    if (!canOperateCurrentTurn) return;
    if (!pendingDeploy && !pendingTransport) return;
    if (!deployTargets.some((target) => target.q === coord.q && target.r === coord.r)) return;
    if (pendingTransport) {
      deployTransportUnit({ ...pendingTransport, destination: coord });
      setPendingTransport(null);
      return;
    }
    setPendingDeployCommand({ input: pendingDeploy!, destination: coord });
    setUnitCommandMenu({ unitId: PENDING_DEPLOY_UNIT_ID, position, destination: coord });
    setUnitTacticMenu(null);
    setUnitStrategyMenu(null);
    setUnitFacilityMenu(null);
    setSelectedUnitId(null);
    setPendingDeployAction(null);
  }, [canOperateCurrentTurn, deployTargets, deployTransportUnit, pendingDeploy, pendingTransport]);

  const selectUnit = useCallback((unitId: string, position: { x: number; y: number }) => {
    if (!state) return;
    const unit = state.units[unitId];
    if (!canOperateCurrentTurn || !unit || unit.forceId !== state.playerForceId || unit.moved || unitIsIncapacitated(unit) || unit.movementRemaining <= 0) {
      setSelectedUnitId(null);
      setUnitCommandMenu(null);
      setUnitIntelMenu(null);
      setUnitTacticMenu(null);
      setUnitStrategyMenu(null);
      setTargetingAttack(null);
      setTargetingTactic(null);
      setTargetingFirePlot(null);
      setTargetingUnitStrategy(null);
      setTargetingFacility(null);
      setTargetingRepair(null);
      setFacilityContextMenu(null);
      return;
    }
    playWaitingForTargetSound();
    setCityMenu(null);
    setMapContextMenu(null);
    setUnitIntelMenu(null);
    setUnitTacticMenu(null);
    setUnitStrategyMenu(null);
    setTargetingAttack(null);
    setTargetingTactic(null);
    setTargetingFirePlot(null);
    setTargetingUnitStrategy(null);
    setTargetingFacility(null);
    setTargetingRepair(null);
    setFacilityContextMenu(null);
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
    setUnitStrategyMenu(null);
    setUnitFacilityMenu(null);
    setTargetingAttack(null);
    setTargetingTactic(null);
    setTargetingFirePlot(null);
    setTargetingUnitStrategy(null);
    setTargetingFacility(null);
    setTargetingRepair(null);
    setFacilityContextMenu(null);
    setSelectedUnitId(null);
    setUnitIntelMenu({ unitId, position });
  }, [state]);

  const openUnitDetail = useCallback(() => {
    if (!unitIntelMenu) return;
    playClickOnSound();
    setUnitDetailId(unitIntelMenu.unitId);
    setUnitIntelMenu(null);
  }, [unitIntelMenu]);

  const openUnitOfficers = useCallback(() => {
    if (!unitIntelMenu) return;
    playClickOnSound();
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
    setUnitStrategyMenu(null);
    setTargetingAttack(null);
    setTargetingTactic(null);
    setTargetingFirePlot(null);
    setTargetingUnitStrategy(null);
    setTargetingFacility(null);
    setTargetingRepair(null);
    setUnitCommandMenu({ unitId: selectedUnitId, position, destination: coord });
  }, [canOperateCurrentTurn, moveTargets, selectedUnitId]);

  const beginPendingDeployAction = useCallback(() => {
    if (!pendingDeployCommand || !pendingDeployPreview) return null;
    const action = {
      input: {
        ...pendingDeployCommand.input,
        destination: pendingDeployCommand.destination,
      },
      unitId: pendingDeployPreview.unitId,
    };
    setPendingDeployAction(action);
    return action;
  }, [pendingDeployCommand, pendingDeployPreview]);

  const finishPendingDeployAction = useCallback((action: Parameters<typeof deployUnitAction>[1]) => {
    if (!pendingDeployAction) return false;
    deployUnitAction(pendingDeployAction.input, action);
    setPendingDeployAction(null);
    setPendingDeployCommand(null);
    setPendingDeploy(null);
    return true;
  }, [deployUnitAction, pendingDeployAction]);

  const executeUnitAttackCommand = useCallback(() => {
    if (
      !canOperateCurrentTurn ||
      !unitCommandMenu ||
      !unitMenuState ||
      !unitMenuUnitId ||
      (attackableUnits(unitMenuState, unitMenuUnitId, unitMenuDestination).length === 0 &&
        attackableCities(unitMenuState, unitMenuUnitId, unitMenuDestination).length === 0 &&
        attackableFacilities(unitMenuState, unitMenuUnitId, unitMenuDestination).length === 0)
    ) return;
    const deployAction = isPendingDeployCommandMenu ? beginPendingDeployAction() : null;
    const commandUnitId = deployAction?.unitId ?? unitMenuUnitId;
    setSelectedUnitId(commandUnitId);
    setTargetingAttack({ unitId: commandUnitId, origin: deployAction ? undefined : unitMenuDestination });
    setTargetingTactic(null);
    setTargetingFirePlot(null);
    setTargetingUnitStrategy(null);
    setTargetingFacility(null);
    setTargetingRepair(null);
    setUnitTacticMenu(null);
    setUnitStrategyMenu(null);
    setUnitCommandMenu(null);
  }, [beginPendingDeployAction, canOperateCurrentTurn, isPendingDeployCommandMenu, unitCommandMenu, unitMenuDestination, unitMenuState, unitMenuUnitId]);

  const executeUnitRepairCommand = useCallback(() => {
    if (!canOperateCurrentTurn || !unitCommandMenu || !unitMenuUnitId || unitMenuRepairTargets.length === 0) return;
    const deployAction = isPendingDeployCommandMenu ? beginPendingDeployAction() : null;
    const commandUnitId = deployAction?.unitId ?? unitMenuUnitId;
    setSelectedUnitId(commandUnitId);
    setTargetingAttack(null);
    setTargetingTactic(null);
    setTargetingFirePlot(null);
    setTargetingUnitStrategy(null);
    setTargetingFacility(null);
    setTargetingRepair({ unitId: commandUnitId, origin: deployAction ? undefined : unitMenuDestination });
    setUnitTacticMenu(null);
    setUnitStrategyMenu(null);
    setUnitFacilityMenu(null);
    setUnitCommandMenu(null);
  }, [beginPendingDeployAction, canOperateCurrentTurn, isPendingDeployCommandMenu, unitCommandMenu, unitMenuDestination, unitMenuRepairTargets.length, unitMenuUnitId]);

  const executeUnitTacticCommand = useCallback(() => {
    if (!canOperateCurrentTurn || !unitCommandMenu || !unitMenuUnitId || unitMenuTactics.length === 0) return;
    playClickOnSound();
    const deployAction = isPendingDeployCommandMenu ? beginPendingDeployAction() : null;
    setUnitStrategyMenu(null);
    setUnitTacticMenu({
      unitId: deployAction?.unitId ?? unitMenuUnitId,
      position: { x: unitCommandMenu.position.x + 108, y: unitCommandMenu.position.y },
      destination: deployAction ? undefined : unitMenuDestination,
    });
  }, [beginPendingDeployAction, canOperateCurrentTurn, isPendingDeployCommandMenu, unitCommandMenu, unitMenuDestination, unitMenuTactics.length, unitMenuUnitId]);

  const executeUnitStrategyCommand = useCallback(() => {
    if (!canOperateCurrentTurn || !unitCommandMenu || !unitMenuUnitId || unitMenuStrategies.length === 0) return;
    playClickOnSound();
    const deployAction = isPendingDeployCommandMenu ? beginPendingDeployAction() : null;
    setUnitTacticMenu(null);
    setUnitFacilityMenu(null);
    setUnitStrategyMenu({
      unitId: deployAction?.unitId ?? unitMenuUnitId,
      position: { x: unitCommandMenu.position.x + 108, y: unitCommandMenu.position.y },
      destination: deployAction ? undefined : unitMenuDestination,
    });
  }, [beginPendingDeployAction, canOperateCurrentTurn, isPendingDeployCommandMenu, unitCommandMenu, unitMenuDestination, unitMenuStrategies.length, unitMenuUnitId]);

  const executeUnitFacilityCommand = useCallback(() => {
    if (!canOperateCurrentTurn || !unitCommandMenu || !unitMenuUnitId || unitMenuFacilities.length === 0) return;
    playClickOnSound();
    const deployAction = isPendingDeployCommandMenu ? beginPendingDeployAction() : null;
    setUnitTacticMenu(null);
    setUnitStrategyMenu(null);
    setUnitFacilityMenu({
      unitId: deployAction?.unitId ?? unitMenuUnitId,
      position: { x: unitCommandMenu.position.x + 108, y: unitCommandMenu.position.y },
      destination: deployAction ? undefined : unitMenuDestination,
    });
  }, [beginPendingDeployAction, canOperateCurrentTurn, isPendingDeployCommandMenu, unitCommandMenu, unitMenuDestination, unitMenuFacilities.length, unitMenuUnitId]);

  const selectUnitTactic = useCallback((tacticId: TacticId) => {
    if (!canOperateCurrentTurn) return;
    if (!unitTacticMenu) return;
    setSelectedUnitId(unitTacticMenu.unitId);
    setTargetingAttack(null);
    setTargetingTactic({ unitId: unitTacticMenu.unitId, tacticId, origin: unitTacticMenu.destination });
    setTargetingFirePlot(null);
    setTargetingUnitStrategy(null);
    setTargetingFacility(null);
    setTargetingRepair(null);
    setUnitCommandMenu(null);
    setUnitTacticMenu(null);
    setUnitStrategyMenu(null);
    setUnitFacilityMenu(null);
  }, [canOperateCurrentTurn, unitTacticMenu]);

  const selectUnitFacility = useCallback((facilityType: FacilityType) => {
    if (!canOperateCurrentTurn || !unitFacilityMenu) return;
    setSelectedUnitId(unitFacilityMenu.unitId);
    setTargetingAttack(null);
    setTargetingTactic(null);
    setTargetingFirePlot(null);
    setTargetingUnitStrategy(null);
    setTargetingFacility({ unitId: unitFacilityMenu.unitId, facilityType, origin: unitFacilityMenu.destination });
    setTargetingRepair(null);
    setUnitCommandMenu(null);
    setUnitTacticMenu(null);
    setUnitStrategyMenu(null);
    setUnitFacilityMenu(null);
  }, [canOperateCurrentTurn, unitFacilityMenu]);

  const selectUnitStrategy = useCallback((strategyId: StrategyId) => {
    if (!canOperateCurrentTurn || !unitStrategyMenu) return;
    const strategy = UNIT_STRATEGIES.find((candidate) => candidate.id === strategyId);
    if (!strategy) return;
    setSelectedUnitId(unitStrategyMenu.unitId);
    setTargetingAttack(null);
    setTargetingTactic(null);
    setTargetingFacility(null);
    setTargetingRepair(null);
    setTargetingUnitStrategy(null);
    if (strategy.target === 'cell') {
      setTargetingFirePlot({ unitId: unitStrategyMenu.unitId, strategyId, origin: unitStrategyMenu.destination });
    } else {
      setTargetingFirePlot(null);
      setTargetingUnitStrategy({ unitId: unitStrategyMenu.unitId, strategyId, origin: unitStrategyMenu.destination });
    }
    setUnitCommandMenu(null);
    setUnitTacticMenu(null);
    setUnitStrategyMenu(null);
    setUnitFacilityMenu(null);
  }, [canOperateCurrentTurn, unitStrategyMenu]);

  const selectFirePlotTarget = useCallback((coord: GridCoord) => {
    if (!canOperateCurrentTurn || (!targetingFirePlot && !targetingFacility)) return;
    if (!firePlotTargets.some((target) => target.q === coord.q && target.r === coord.r)) return;
    if (targetingFacility) {
      const handled = pendingDeployAction?.unitId === targetingFacility.unitId &&
        finishPendingDeployAction({ type: 'buildFacility', facilityType: targetingFacility.facilityType, target: coord });
      if (!handled) {
        buildFacility(targetingFacility.unitId, targetingFacility.facilityType, coord, targetingFacility.origin);
      }
    } else if (targetingFirePlot) {
      const handled = pendingDeployAction?.unitId === targetingFirePlot.unitId &&
        finishPendingDeployAction({ type: 'useUnitStrategy', strategyId: targetingFirePlot.strategyId, selection: { coord } });
      if (!handled) {
        useUnitStrategy(targetingFirePlot.unitId, targetingFirePlot.strategyId, { coord }, targetingFirePlot.origin);
      }
    }
    setTargetingAttack(null);
    setTargetingTactic(null);
    setTargetingFirePlot(null);
    setTargetingUnitStrategy(null);
    setTargetingFacility(null);
    setTargetingRepair(null);
    setSelectedUnitId(null);
    setUnitCommandMenu(null);
    setUnitTacticMenu(null);
    setUnitStrategyMenu(null);
    setUnitFacilityMenu(null);
  }, [buildFacility, canOperateCurrentTurn, finishPendingDeployAction, firePlotTargets, pendingDeployAction, targetingFacility, targetingFirePlot, useUnitStrategy]);

  const executeUnitWaitCommand = useCallback(() => {
    if (!canOperateCurrentTurn) return;
    if (!unitCommandMenu) return;
    if (unitCommandMenu.unitId === PENDING_DEPLOY_UNIT_ID) {
      if (!pendingDeployCommand) return;
      deployUnitAction({ ...pendingDeployCommand.input, destination: pendingDeployCommand.destination }, { type: 'wait' });
      setPendingDeployCommand(null);
      setPendingDeploy(null);
      setPendingDeployAction(null);
    } else if (unitCommandMenu.destination) {
      moveUnit(unitCommandMenu.unitId, unitCommandMenu.destination);
    } else {
      waitUnit(unitCommandMenu.unitId);
    }
    setUnitCommandMenu(null);
    setUnitTacticMenu(null);
    setUnitStrategyMenu(null);
    setTargetingAttack(null);
    setTargetingTactic(null);
    setTargetingFirePlot(null);
    setTargetingUnitStrategy(null);
    setTargetingFacility(null);
    setTargetingRepair(null);
    setSelectedUnitId(null);
  }, [canOperateCurrentTurn, deployUnitAction, moveUnit, pendingDeployCommand, unitCommandMenu, waitUnit]);

  const selectAttackTarget = useCallback((targetId: string) => {
    if (!canOperateCurrentTurn) return;
    if (!attackTargetUnitIds.includes(targetId)) return;
    if (targetingTactic) {
      const handled = pendingDeployAction?.unitId === targetingTactic.unitId &&
        finishPendingDeployAction({ type: 'useUnitTactic', targetId, tacticId: targetingTactic.tacticId });
      if (!handled) {
        useUnitTactic(targetingTactic.unitId, targetId, targetingTactic.tacticId, targetingTactic.origin);
      }
    } else if (targetingUnitStrategy) {
      const handled = pendingDeployAction?.unitId === targetingUnitStrategy.unitId &&
        finishPendingDeployAction({ type: 'useUnitStrategy', strategyId: targetingUnitStrategy.strategyId, selection: { targetUnitId: targetId } });
      if (!handled) {
        useUnitStrategy(targetingUnitStrategy.unitId, targetingUnitStrategy.strategyId, { targetUnitId: targetId }, targetingUnitStrategy.origin);
      }
    } else if (targetingAttack) {
      const handled = pendingDeployAction?.unitId === targetingAttack.unitId &&
        finishPendingDeployAction({ type: 'attackUnit', targetId });
      if (!handled) {
        attackUnit(targetingAttack.unitId, targetId, targetingAttack.origin);
      }
    } else {
      return;
    }
    setTargetingAttack(null);
    setTargetingTactic(null);
    setTargetingFirePlot(null);
    setTargetingUnitStrategy(null);
    setTargetingFacility(null);
    setTargetingRepair(null);
    setSelectedUnitId(null);
    setUnitCommandMenu(null);
    setUnitTacticMenu(null);
    setUnitStrategyMenu(null);
  }, [attackTargetUnitIds, attackUnit, canOperateCurrentTurn, finishPendingDeployAction, pendingDeployAction, targetingAttack, targetingTactic, targetingUnitStrategy, useUnitStrategy, useUnitTactic]);

  const selectFacilityTarget = useCallback((facilityId: string) => {
    if (!canOperateCurrentTurn) return;
    if (!targetFacilityIds.includes(facilityId)) return;
    if (targetingAttack) {
      const handled = pendingDeployAction?.unitId === targetingAttack.unitId &&
        finishPendingDeployAction({ type: 'attackFacility', facilityId });
      if (!handled) {
        attackFacility(targetingAttack.unitId, facilityId, targetingAttack.origin);
      }
    } else if (targetingRepair) {
      const handled = pendingDeployAction?.unitId === targetingRepair.unitId &&
        finishPendingDeployAction({ type: 'repairFacility', facilityId });
      if (!handled) {
        repairFacility(targetingRepair.unitId, facilityId, targetingRepair.origin);
      }
    } else {
      return;
    }
    setTargetingAttack(null);
    setTargetingTactic(null);
    setTargetingFirePlot(null);
    setTargetingUnitStrategy(null);
    setTargetingFacility(null);
    setTargetingRepair(null);
    setSelectedUnitId(null);
    setUnitCommandMenu(null);
    setUnitTacticMenu(null);
    setUnitStrategyMenu(null);
    setUnitFacilityMenu(null);
  }, [attackFacility, canOperateCurrentTurn, finishPendingDeployAction, pendingDeployAction, repairFacility, targetFacilityIds, targetingAttack, targetingRepair]);

  const selectAttackCityTarget = useCallback((cityId: NonNullable<typeof selectedCityId>) => {
    if (!canOperateCurrentTurn) return;
    if (!targetingAttack || !attackTargetCityIds.includes(cityId)) return;
    if (pendingDeployAction?.unitId === targetingAttack.unitId) {
      finishPendingDeployAction({ type: 'attackCity', cityId });
    } else {
      attackCity(targetingAttack.unitId, cityId, targetingAttack.origin);
    }
    setTargetingAttack(null);
    setTargetingTactic(null);
    setTargetingFirePlot(null);
    setTargetingUnitStrategy(null);
    setTargetingFacility(null);
    setTargetingRepair(null);
    setSelectedUnitId(null);
    setUnitCommandMenu(null);
    setUnitTacticMenu(null);
    setUnitStrategyMenu(null);
  }, [attackCity, attackTargetCityIds, canOperateCurrentTurn, finishPendingDeployAction, pendingDeployAction, targetingAttack]);

  const openFacilityContextMenu = useCallback((facilityId: string, position: { x: number; y: number }) => {
    if (!state || !canOperateCurrentTurn) return;
    const facility = state.facilities?.[facilityId];
    if (!facility || facility.forceId !== state.playerForceId) return;
    playRightMouseSound();
    setHoveredUnit(null);
    setHoveredCity(null);
    setCityMenu(null);
    setMapContextMenu(null);
    setShowMapIntelOptions(false);
    setUnitCommandMenu(null);
    setUnitTacticMenu(null);
    setUnitStrategyMenu(null);
    setUnitFacilityMenu(null);
    setUnitIntelMenu(null);
    setTargetingAttack(null);
    setTargetingTactic(null);
    setTargetingFirePlot(null);
    setTargetingUnitStrategy(null);
    setTargetingFacility(null);
    setTargetingRepair(null);
    setSelectedUnitId(null);
    setFacilityContextMenu({ facilityId, position });
  }, [canOperateCurrentTurn, state]);

  const revokeFacilityFromMenu = useCallback(() => {
    if (!facilityContextMenu) return;
    playClickOnSound();
    dismantleFacility(facilityContextMenu.facilityId);
    setFacilityContextMenu(null);
  }, [dismantleFacility, facilityContextMenu]);

  const openMapContextMenu = useCallback((position: { x: number; y: number }) => {
    if (facilityContextMenu) {
      playRightMouseSound();
      setFacilityContextMenu(null);
      return;
    }
    if (unitCommandMenu || unitTacticMenu || unitStrategyMenu || unitFacilityMenu) {
      setUnitCommandMenu(null);
      setUnitTacticMenu(null);
      setUnitStrategyMenu(null);
      setUnitFacilityMenu(null);
      setPendingDeploy(null);
      setPendingDeployCommand(null);
      setPendingDeployAction(null);
      setTargetingAttack(null);
      setTargetingTactic(null);
      setTargetingFirePlot(null);
      setTargetingUnitStrategy(null);
      setTargetingFacility(null);
      setTargetingRepair(null);
      return;
    }
    if (selectedUnitId || targetingAttack || targetingTactic || targetingFirePlot || targetingUnitStrategy || targetingFacility || targetingRepair) {
      setSelectedUnitId(null);
      setTargetingAttack(null);
      setTargetingTactic(null);
      setTargetingFirePlot(null);
      setTargetingUnitStrategy(null);
      setTargetingFacility(null);
      setTargetingRepair(null);
      if (pendingDeployAction) {
        setPendingDeploy(null);
        setPendingDeployCommand(null);
        setPendingDeployAction(null);
      }
      return;
    }
    if (mapContextMenu) {
      setMapContextMenu(null);
      setShowMapIntelOptions(false);
      return;
    }
    if (cityMenu || editorState || deployCityId || transportCityId || pendingDeploy || pendingTransport) {
      setCityMenu(null);
      setDeployCityId(null);
      setTransportCityId(null);
      setPendingDeploy(null);
      setPendingTransport(null);
      setPendingDeployCommand(null);
      setPendingDeployAction(null);
      return;
    }
    setSelectedUnitId(null);
    setUnitCommandMenu(null);
    setUnitTacticMenu(null);
    setUnitStrategyMenu(null);
    setPendingDeployCommand(null);
    setPendingDeployAction(null);
    setTargetingAttack(null);
    setTargetingTactic(null);
    setTargetingFirePlot(null);
    setTargetingUnitStrategy(null);
    setTargetingFacility(null);
    setTargetingRepair(null);
    setShowMapIntelOptions(false);
    setMapContextMenu(position);
  }, [cityMenu, deployCityId, editorState, facilityContextMenu, mapContextMenu, pendingDeploy, pendingDeployAction, pendingTransport, selectedUnitId, targetingAttack, targetingFacility, targetingFirePlot, targetingRepair, targetingTactic, targetingUnitStrategy, transportCityId, unitCommandMenu, unitFacilityMenu, unitStrategyMenu, unitTacticMenu]);

  const proceedTenDayFromMap = useCallback(() => {
    setMapContextMenu(null);
    setShowMapIntelOptions(false);
    setUnitCommandMenu(null);
    setUnitTacticMenu(null);
    setUnitStrategyMenu(null);
    setTargetingAttack(null);
    setTargetingTactic(null);
    setTargetingFirePlot(null);
    setTargetingUnitStrategy(null);
    if (canOperateCurrentTurn) endTenDay();
    setSelectedUnitId(null);
  }, [canOperateCurrentTurn, endTenDay]);

  const openIntelFromMap = useCallback(() => {
    setShowMapIntelOptions((current) => {
      if (!current) playClickOnSound();
      return !current;
    });
  }, []);

  const openPlayerOfficersFromMap = useCallback(() => {
    setMapContextMenu(null);
    setShowMapIntelOptions(false);
    setUnitCommandMenu(null);
    setUnitTacticMenu(null);
    setUnitStrategyMenu(null);
    setTargetingAttack(null);
    setTargetingTactic(null);
    setTargetingFirePlot(null);
    setTargetingUnitStrategy(null);
    setMapOfficerListScope('player');
  }, []);

  const openAllOfficersFromMap = useCallback(() => {
    setMapContextMenu(null);
    setShowMapIntelOptions(false);
    setUnitCommandMenu(null);
    setUnitTacticMenu(null);
    setUnitStrategyMenu(null);
    setTargetingAttack(null);
    setTargetingTactic(null);
    setTargetingFirePlot(null);
    setTargetingUnitStrategy(null);
    setMapOfficerListScope('all');
  }, []);

  const openGlobalIntelFromMap = useCallback(() => {
    setMapContextMenu(null);
    setShowMapIntelOptions(false);
    setUnitCommandMenu(null);
    setUnitTacticMenu(null);
    setUnitStrategyMenu(null);
    setTargetingAttack(null);
    setTargetingTactic(null);
    setTargetingFirePlot(null);
    setTargetingUnitStrategy(null);
    setMapOfficerListScope(null);
    setShowGlobalIntel(true);
  }, []);

  const saveFromMap = useCallback(() => {
    manualSave();
    setMapContextMenu(null);
    setShowMapIntelOptions(false);
    setUnitCommandMenu(null);
    setUnitTacticMenu(null);
    setUnitStrategyMenu(null);
    setTargetingAttack(null);
    setTargetingTactic(null);
    setTargetingFirePlot(null);
    setTargetingUnitStrategy(null);
  }, [manualSave]);

  const loadFromMap = useCallback(() => {
    if (hasManualSave) loadGame('manual');
    else if (hasAutosave) loadGame('auto');
    setMapContextMenu(null);
    setShowMapIntelOptions(false);
    setUnitCommandMenu(null);
    setUnitTacticMenu(null);
    setUnitStrategyMenu(null);
    setTargetingAttack(null);
    setTargetingTactic(null);
    setTargetingFirePlot(null);
    setTargetingUnitStrategy(null);
  }, [hasAutosave, hasManualSave, loadGame]);

  const closeMapContextMenuFromRightClick = useCallback((event: ReactMouseEvent<HTMLElement>) => {
    event.preventDefault();
    event.stopPropagation();
    playRightMouseSound();
    setMapContextMenu(null);
    setShowMapIntelOptions(false);
    setFacilityContextMenu(null);
  }, []);

  const closeUnitCommandMenuFromRightClick = useCallback((event: ReactMouseEvent<HTMLElement>) => {
    event.preventDefault();
    event.stopPropagation();
    playRightMouseSound();
    setUnitCommandMenu(null);
    setUnitTacticMenu(null);
    setUnitStrategyMenu(null);
    setUnitFacilityMenu(null);
    setPendingDeployCommand(null);
    setPendingDeployAction(null);
    setTargetingUnitStrategy(null);
    setTargetingFacility(null);
    setTargetingRepair(null);
    setFacilityContextMenu(null);
  }, []);

  const closeUnitIntelMenuFromRightClick = useCallback((event: ReactMouseEvent<HTMLElement>) => {
    event.preventDefault();
    event.stopPropagation();
    playRightMouseSound();
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
    if (!facilityContextMenu) return undefined;
    const closeOnLeftClickOutside = (event: globalThis.MouseEvent) => {
      if (event.button !== 0) return;
      if (facilityContextMenuRef.current?.contains(event.target as Node)) return;
      setFacilityContextMenu(null);
    };

    document.addEventListener('mousedown', closeOnLeftClickOutside);
    return () => document.removeEventListener('mousedown', closeOnLeftClickOutside);
  }, [facilityContextMenu]);

  useEffect(() => {
    if (!unitCommandMenu) return undefined;
    const closeOnLeftClickOutside = (event: globalThis.PointerEvent) => {
      if (event.button !== 0) return;
      if (unitCommandMenuRef.current?.contains(event.target as Node)) return;
      if (unitTacticMenuRef.current?.contains(event.target as Node)) return;
      if (unitStrategyMenuRef.current?.contains(event.target as Node)) return;
      if (unitFacilityMenuRef.current?.contains(event.target as Node)) return;
      setUnitCommandMenu(null);
      setPendingDeployCommand(null);
      setPendingDeployAction(null);
    };

    document.addEventListener('pointerdown', closeOnLeftClickOutside);
    return () => document.removeEventListener('pointerdown', closeOnLeftClickOutside);
  }, [unitCommandMenu]);

  useEffect(() => {
    if (!unitTacticMenu) return undefined;
    const closeOnPointerOutside = (event: globalThis.PointerEvent) => {
      if (unitTacticMenuRef.current?.contains(event.target as Node)) return;
      if (unitCommandMenuRef.current?.contains(event.target as Node)) return;
      if (unitStrategyMenuRef.current?.contains(event.target as Node)) return;
      setUnitTacticMenu(null);
    };

    document.addEventListener('pointerdown', closeOnPointerOutside);
    return () => document.removeEventListener('pointerdown', closeOnPointerOutside);
  }, [unitTacticMenu]);

  useEffect(() => {
    if (!unitStrategyMenu) return undefined;
    const closeOnPointerOutside = (event: globalThis.PointerEvent) => {
      if (unitStrategyMenuRef.current?.contains(event.target as Node)) return;
      if (unitCommandMenuRef.current?.contains(event.target as Node)) return;
      if (unitTacticMenuRef.current?.contains(event.target as Node)) return;
      if (unitFacilityMenuRef.current?.contains(event.target as Node)) return;
      setUnitStrategyMenu(null);
    };

    document.addEventListener('pointerdown', closeOnPointerOutside);
    return () => document.removeEventListener('pointerdown', closeOnPointerOutside);
  }, [unitStrategyMenu]);

  useEffect(() => {
    if (!unitFacilityMenu) return undefined;
    const closeOnPointerOutside = (event: globalThis.PointerEvent) => {
      if (unitFacilityMenuRef.current?.contains(event.target as Node)) return;
      if (unitCommandMenuRef.current?.contains(event.target as Node)) return;
      if (unitTacticMenuRef.current?.contains(event.target as Node)) return;
      if (unitStrategyMenuRef.current?.contains(event.target as Node)) return;
      setUnitFacilityMenu(null);
    };

    document.addEventListener('pointerdown', closeOnPointerOutside);
    return () => document.removeEventListener('pointerdown', closeOnPointerOutside);
  }, [unitFacilityMenu]);

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

  useEffect(() => {
    const reports = state?.facilityRepairReports ?? [];
    if (reports.length === 0) {
      setVisibleFacilityRepairReports([]);
      return undefined;
    }

    setVisibleFacilityRepairReports(reports);
    const timer = window.setTimeout(() => setVisibleFacilityRepairReports([]), 2000);
    return () => window.clearTimeout(timer);
  }, [state?.facilityRepairReports]);

  useEffect(() => revokeUploadedMapPreview, [revokeUploadedMapPreview]);

  return (
    <main className="game-shell">
      <TopBar />
      <StrategicMap
        onCityMenu={(cityId, position) => {
          if (!canOperateCurrentTurn) return;
          playLeftMouseSound();
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
        firePlotTargets={firePlotTargets}
        firePlots={state?.firePlots}
        attackTargetCityIds={attackTargetCityIds}
        attackTargetFacilityIds={targetFacilityIds}
        attackTargetUnitIds={attackTargetUnitIds}
        damageReports={visibleDamageReports}
        cityEffectReports={visibleCityEffectReports}
        facilityRepairReports={visibleFacilityRepairReports}
        selectedUnitId={selectedUnitId}
        onCellHover={setHoveredCell}
        onMoveTargetSelect={selectMoveTarget}
        onFirePlotTargetSelect={selectFirePlotTarget}
        onUnitSelect={selectUnit}
        onUnitContextMenu={openUnitIntelMenu}
        onUnitHover={(unitId, position) => setHoveredUnit({ unitId, position })}
        onUnitLeave={() => setHoveredUnit(null)}
        onCityHover={(cityId, position) => setHoveredCity({ cityId, position })}
        onCityLeave={() => setHoveredCity(null)}
        onAttackTargetSelect={selectAttackTarget}
        onAttackCityTargetSelect={selectAttackCityTarget}
        onFacilityTargetSelect={selectFacilityTarget}
        onFacilityContextMenu={openFacilityContextMenu}
        onFacilityHover={(facilityId, position) => setHoveredFacility({ facilityId, position })}
        onFacilityLeave={() => setHoveredFacility(null)}
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
      {state && hoveredFacility && state.facilities?.[hoveredFacility.facilityId] && (
        <FacilityInfoPanel facility={state.facilities[hoveredFacility.facilityId]} state={state} position={hoveredFacility.position} />
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
          actionPoints={state ? state.actionPoints[state.playerForceId] : 0}
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
          <button
            type="button"
            className={!canOperateCurrentTurn ? 'is-disabled' : undefined}
            data-testid="map-context-proceed-button"
            onClick={proceedTenDayFromMap}
            disabled={!canOperateCurrentTurn}
          >
            进行
          </button>
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
      {facilityContextMenu && (
        <nav
          ref={facilityContextMenuRef}
          className="facility-context-menu tool-panel"
          data-testid="facility-context-menu"
          style={{ left: facilityContextMenu.position.x, top: facilityContextMenu.position.y }}
          aria-label="设施命令菜单"
          onContextMenu={(event) => {
            event.preventDefault();
            event.stopPropagation();
            playRightMouseSound();
            setFacilityContextMenu(null);
          }}
        >
          <button type="button" data-testid="facility-dismantle-button" onClick={revokeFacilityFromMenu}>撤销</button>
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
          {UNIT_COMMANDS.map((command, commandIndex) => {
            const disabled =
              (commandIndex === 1 && unitMenuAttackTargets.length === 0 && unitMenuAttackCities.length === 0 && unitMenuAttackFacilities.length === 0) ||
              (command === '单挑' && unitMenuAttackTargets.length === 0) ||
              (command === '齐攻' && unitMenuJointAttackTargets.length === 0) ||
              (command === '战法' && unitMenuTacticTargets.length === 0) ||
              (command === '计略' && unitMenuStrategies.length === 0) ||
              (commandIndex === 7 && unitMenuRepairTargets.length === 0);
            const onClick =
              command === '待命' ? executeUnitWaitCommand :
              commandIndex === 1 ? executeUnitAttackCommand :
              command === '战法' ? executeUnitTacticCommand :
              command === '计略' ? executeUnitStrategyCommand :
              commandIndex === 7 ? executeUnitRepairCommand :
              undefined;
            return (
              <button
                key={command}
                type="button"
                className={(disabled || (commandIndex === 6 && unitMenuFacilities.length === 0)) ? 'is-disabled' : undefined}
                disabled={disabled || (commandIndex === 6 && unitMenuFacilities.length === 0)}
                onClick={commandIndex === 6 ? executeUnitFacilityCommand : onClick}
              >
                {command}
              </button>
            );
          })}
        </nav>
      )}
      {unitFacilityMenu && (
        <nav
          ref={unitFacilityMenuRef}
          className="unit-strategy-menu tool-panel"
          data-testid="unit-facility-menu"
          style={{ left: unitFacilityMenu.position.x, top: unitFacilityMenu.position.y }}
          aria-label="部队设置菜单"
          onContextMenu={(event) => {
            event.preventDefault();
            event.stopPropagation();
            playRightMouseSound();
            setUnitFacilityMenu(null);
          }}
        >
          {UNIT_FACILITIES.map((facility) => {
            const enabled = unitMenuFacilities.some((candidate) => candidate.type === facility.type);
            return (
              <button
                key={facility.type}
                type="button"
                disabled={!enabled}
                onClick={() => selectUnitFacility(facility.type)}
              >
                {facility.name}（{FACILITY_BUILD_COSTS[facility.type]}）
              </button>
            );
          })}
        </nav>
      )}
      {unitStrategyMenu && (
        <nav
          ref={unitStrategyMenuRef}
          className="unit-strategy-menu tool-panel"
          data-testid="unit-strategy-menu"
          style={{ left: unitStrategyMenu.position.x, top: unitStrategyMenu.position.y }}
          aria-label="部队计略菜单"
          onContextMenu={(event) => {
            event.preventDefault();
            event.stopPropagation();
            playRightMouseSound();
            setUnitStrategyMenu(null);
          }}
        >
          {UNIT_STRATEGIES.map((strategy) => (
            <button
              key={strategy.id}
              type="button"
              disabled={!unitMenuStrategies.some((candidate) => candidate.id === strategy.id)}
              onClick={() => selectUnitStrategy(strategy.id)}
            >
              {strategy.name}（{strategy.cost}）
            </button>
          ))}
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
            playRightMouseSound();
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
