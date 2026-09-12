import { ArrowLeft, RotateCcw } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';
import { useAudioEventAdapter } from '../audio/reactAudioEventAdapter';
import { effectiveUnitAbilities, harmfulStrategySuccessChance, deployUnitPreviewWithId, FACILITY_BUILD_COSTS, unitFacilities, unitFacilityMenuOptions, unitIsIncapacitated, unitStrategies, type StrategyId, type TacticId } from '../game/battle/actions';
import type { CSSProperties } from 'react';
import { gridKey, sevenCellCityFootprint, type GridCoord } from '../game/battle/grid';
import { getDeploymentTargets, getFacilityBuildTargets, getMovementTargets, getRepairTargets, getStrategyCellTargets, getStrategyUnitTargets, getTacticFacilityTargets, getTacticUnitTargets, getUnitActionQuery, getUnitTacticOptions } from '../game/battle/queries';
import { computeDelegatePath, hasExecutableDelegation } from '../game/battle/delegate';
import { chooseDelegateSpawnCell } from '../game/battle/deployment';
import { strategyEnergyCostForUnit } from '../game/battle/strategies';
import { canBuildPlotAtCoord, hasEnemyUnitsNear, isPlotOccupiedByOtherCity, PLOT_GOLD_COST, PLOT_LABELS, startBuildCityPlot, type PlotType } from '../game/innerAffairs';
import { cityCenter, ownCityAt, unoccupiedCityAt } from '../game/battle/movementRules';
import { canBuildFacility } from '../game/techs';
import { ownPassAt, passAt, passBlockedKeys, unoccupiedPassAt } from '../game/passes';
import { allPassAnchorKeys } from '../game/battle/movementRules';
import { useGame } from '../game/store/GameProvider';
import { territoryForceAt } from '../game/territory';
import type { MapCamera } from '../game/saveSlots';
import type { BattleDamageReport, CityEffectReport, CityId, ForceId, FacilityRepairReport, FacilityType, GameCommand, GameState, GridCell, PassId, StrategyResultReport, TerrainType } from '../game/types';
import { BattlePanel } from './BattlePanel';
import { CityInfoPanel } from './CityInfoPanel';
import { CityInfoDialog } from './CityInfoDialog';
import { PassInfoDialog } from './PassInfoDialog';
import { CityCommandMenu } from './CityCommandMenu';
import { CityStatusPanel } from './CityStatusPanel';
import { PassCommandMenu } from './PassCommandMenu';
import { PassStatusPanel } from './PassStatusPanel';
import { PassInfoPanel } from './PassInfoPanel';
import { CommandDialog } from './CommandDialog';
import { PositionPanel } from './PositionPanel';
import { CultivateDialog, type CultivateCategory } from './CultivateDialog';
import { CultivatePickerDialog } from './CultivatePickerDialog';
import { DeployDialog, type DeployConfirmInput } from './DeployDialog';
import { CityPlotInfoPanel } from './CityPlotInfoPanel';
import { DebateDialog } from './DebateDialog';
import { DuelDialog } from './DuelDialog';
import { EventLog } from './EventLog';
import { FacilityInfoPanel } from './FacilityInfoPanel';
import { ForceOverviewPanel } from './ForceOverviewPanel';
import { GlobalIntelDialog } from './GlobalIntelDialog';
import { OfficerListDialog } from './OfficerListDialog';
import { ResultOverlay } from './ResultOverlay';
import { SaveLoadDialog, type SaveLoadDialogMode } from './SaveLoadDialog';
import { StrategicMap } from './StrategicMap';
import { TopBar } from './TopBar';
import { TransportDialog, type TransportConfirmInput } from './TransportDialog';
import { UnitDetailDialog } from './UnitDetailDialog';
import { UnitInfoPanel } from './UnitInfoPanel';
import { useUnitMenuInteraction } from './useUnitMenuInteraction';

const UNIT_COMMANDS = ['待命', '攻击', '齐攻', '战法', '单挑', '计略', '设置', '修补'] as const;
const UNIT_STRATEGIES = unitStrategies();
const UNIT_FACILITIES = unitFacilities();
const PENDING_DEPLOY_UNIT_ID = '__pending-deploy__';
const HARMFUL_UNIT_STRATEGIES = new Set<StrategyId>(['false-report', 'disturb', 'discord']);

const TERRAIN_LABELS: Record<TerrainType, string> = {
  road: '主径',
  path: '小径',
  plank: '栈道',
  plain: '平地',
  grass: '草地',
  sand: '沙地',
  wasteland: '荒地',
  wetland: '湿地',
  poison: '毒泉',
  forest: '森林',
  hill: '丘陵',
  mountain: '山崖',
  shore: '岸',
  water: '水域',
  stream: '川',
  river: '河',
  sea: '海',
  shallow: '浅滩',
  ferry: '渡口',
  pass: '关隘',
  construction: '建设用地',
};

/** 出征超距点击弹出的委任菜单携带的出征参数（点击菜单项后立即出征并设置委任） */
type DeployDelegateMenuState = {
  unitId: string;
  target: GridCoord;
  position: { x: number; y: number };
  deployInput?: DeployConfirmInput & { destination?: GridCoord };
};

export function GameShell() {
  const { attackCity, attackFacility, attackPass, attackPlot, attackUnit, jointAttackUnit, buildFacility, deployTransportUnit, deployUnit, deployUnitAction, deployUnitDelegate, dismantleFacility, duelUnit, endTenDay, executeDelegatedUnits, clearPendingCamera, issueCommand, moveUnit, online, pendingCamera, repairFacility, setBuildDelegate, setMoveDelegate, setRepairDelegate, state, selectedCityId, resetGame, useUnitStrategy, useUnitTactic, waitUnit } = useGame();
  const { emit: emitAudioEvent } = useAudioEventAdapter();
  /** 储存 / 载入对话框：null 表示关闭 */
  const [saveDialogMode, setSaveDialogMode] = useState<SaveLoadDialogMode | null>(null);
  /** 主地图实时镜头：存档时随档记录，读档时原样还原 */
  const cameraRef = useRef<MapCamera | null>(null);
  const [cameraRestore, setCameraRestore] = useState<{ camera: MapCamera; token: number } | null>(null);
  const cameraTokenRef = useRef(0);
  /** 右侧概览列表点击后的镜头跳转请求（城池/武将/部队），token 变化即执行一次 */
  const [mapFocus, setMapFocus] = useState<{ cell: GridCoord; token: number } | null>(null);
  const mapFocusTokenRef = useRef(0);
  const [activeCommand, setActiveCommand] = useState<GameCommand['type'] | null>(null);
  /** 当前命令/培育对话框的关隘宿主：非空时以关隘为据点宿主执行命令（cityId 仅作归辖城） */
  const [activeCommandPassId, setActiveCommandPassId] = useState<PassId | null>(null);
  const [activeCultivate, setActiveCultivate] = useState<CultivateCategory | null>(null);
  const [cultivatePickerOpen, setCultivatePickerOpen] = useState(false);
  const [positionPanelOpen, setPositionPanelOpen] = useState(false);
  const [positionPanelLockForceId, setPositionPanelLockForceId] = useState<ForceId | undefined>(undefined);
  const [deployCityId, setDeployCityId] = useState<CityId | PassId | null>(null);
  const [transportCityId, setTransportCityId] = useState<CityId | PassId | null>(null);
  const [pendingDeploy, setPendingDeploy] = useState<DeployConfirmInput | null>(null);
  const [pendingTransport, setPendingTransport] = useState<TransportConfirmInput | null>(null);
  const [pendingDeployCommand, setPendingDeployCommand] = useState<{ input: DeployConfirmInput; destination: GridCoord } | null>(null);
  const [pendingDeployAction, setPendingDeployAction] = useState<{ input: DeployConfirmInput & { destination: GridCoord }; unitId: string } | null>(null);
  /** 待选建设用地的开发参数 */
  const [pendingConstruction, setPendingConstruction] = useState<{ cityId: NonNullable<typeof selectedCityId>; officerIds: string[]; facility: PlotType } | null>(null);
  /** 反映最新渲染状态的 ref，避免事件闭包中使用陈旧值导致重复提交命令 */
  const latestStateRef = useRef(state);
  latestStateRef.current = state;
  const pendingConstructionRef = useRef(pendingConstruction);
  pendingConstructionRef.current = pendingConstruction;
  const [selectedUnitId, setSelectedUnitId] = useState<string | null>(null);
  /** 超距移动委任：当前展示的最优路径（黄色高亮，含目标格） */
  const [delegatePath, setDelegatePath] = useState<GridCoord[]>([]);
  /** 超距点击目标后弹出的选项：移动 / 设置 */
  const [delegateMenu, setDelegateMenu] = useState<DeployDelegateMenuState | null>(null);
  /** 超距「设置」后弹出的设施选择 */
  const [delegateFacilityMenu, setDelegateFacilityMenu] = useState<DeployDelegateMenuState | null>(null);
  const {
    unitCommandMenu,
    unitTacticMenu,
    unitStrategyMenu,
    unitFacilityMenu,
    setUnitCommandMenu,
    setUnitTacticMenu,
    setUnitStrategyMenu,
    setUnitFacilityMenu,
  } = useUnitMenuInteraction();
  const [unitIntelMenu, setUnitIntelMenu] = useState<{ unitId: string; position: { x: number; y: number } } | null>(null);
  const [unitDetailId, setUnitDetailId] = useState<string | null>(null);
  const [unitOfficerListId, setUnitOfficerListId] = useState<string | null>(null);
  const [targetingAttack, setTargetingAttack] = useState<{ unitId: string; origin?: GridCoord; joint?: boolean } | null>(null);
  const [targetingTactic, setTargetingTactic] = useState<{ unitId: string; tacticId: TacticId; origin?: GridCoord } | null>(null);
  const [targetingFirePlot, setTargetingFirePlot] = useState<{ unitId: string; strategyId: StrategyId; origin?: GridCoord } | null>(null);
  const [targetingUnitStrategy, setTargetingUnitStrategy] = useState<{ unitId: string; strategyId: StrategyId; origin?: GridCoord } | null>(null);
  const [targetingFacility, setTargetingFacility] = useState<{ unitId: string; facilityType: FacilityType; origin?: GridCoord } | null>(null);
  const [targetingRepair, setTargetingRepair] = useState<{ unitId: string; origin?: GridCoord } | null>(null);
  const [duelDialogUnit, setDuelDialogUnit] = useState<{ unitId: string; origin?: GridCoord } | null>(null);
  const [visibleDamageReports, setVisibleDamageReports] = useState<BattleDamageReport[]>([]);
  const [visibleStrategyResultReports, setVisibleStrategyResultReports] = useState<StrategyResultReport[]>([]);
  const [visibleCityEffectReports, setVisibleCityEffectReports] = useState<CityEffectReport[]>([]);
  const [visibleFacilityRepairReports, setVisibleFacilityRepairReports] = useState<FacilityRepairReport[]>([]);
  const [hoveredCell, setHoveredCell] = useState<GridCell | null>(null);
  const [hoveredUnit, setHoveredUnit] = useState<{ unitId: string; position: { x: number; y: number } } | null>(null);
  const [hoveredCity, setHoveredCity] = useState<{ cityId: NonNullable<typeof selectedCityId>; position: { x: number; y: number } } | null>(null);
  const [hoveredFacility, setHoveredFacility] = useState<{ facilityId: string; position: { x: number; y: number } } | null>(null);
  const [hoveredPlot, setHoveredPlot] = useState<{ cityId: NonNullable<typeof selectedCityId>; plotIndex: number; position: { x: number; y: number } } | null>(null);
  const [cityMenu, setCityMenu] = useState<{ cityId: NonNullable<typeof selectedCityId>; position: { x: number; y: number } } | null>(null);
  /** 左键点击我方关隘后打开的关隘命令菜单（无都市段） */
  const [passMenu, setPassMenu] = useState<{ passId: PassId; position: { x: number; y: number } } | null>(null);
  /** 左侧关隘信息面板：点击我方关隘后显示（对标城池信息面板） */
  const [passStatusId, setPassStatusId] = useState<PassId | null>(null);
  /** 悬停关隘中心锚点：关隘信息弹窗 */
  const [hoveredPass, setHoveredPass] = useState<{ passId: PassId; position: { x: number; y: number } } | null>(null);
  /** 右键关隘：信息菜单（对标城池右键信息菜单） */
  const [passInfoMenu, setPassInfoMenu] = useState<{ passId: PassId; position: { x: number; y: number } } | null>(null);
  const [passInfoDialogId, setPassInfoDialogId] = useState<PassId | null>(null);
  const [passOfficerListPassId, setPassOfficerListPassId] = useState<PassId | null>(null);
  /** 左侧都市信息面板：默认不显示，点击我方城池后显示 */
  const [cityStatusId, setCityStatusId] = useState<CityId | null>(null);
  const [cityInfoMenu, setCityInfoMenu] = useState<{ cityId: NonNullable<typeof selectedCityId>; position: { x: number; y: number } } | null>(null);
  const [cityInfoDialogId, setCityInfoDialogId] = useState<NonNullable<typeof selectedCityId> | null>(null);
  const [cityOfficerListCityId, setCityOfficerListCityId] = useState<NonNullable<typeof selectedCityId> | null>(null);
  const [facilityContextMenu, setFacilityContextMenu] = useState<{ facilityId: string; position: { x: number; y: number } } | null>(null);
  const [plotContextMenu, setPlotContextMenu] = useState<{ cityId: string; plotIndex: number; position: { x: number; y: number } } | null>(null);
  /** 撤销确认弹窗（点击「撤销」后弹出，样式与城池命令菜单一致） */
  const [cancelConfirm, setCancelConfirm] = useState<
    | { kind: 'plot'; cityId: string; plotIndex: number; label: string; position: { x: number; y: number } }
    | { kind: 'facility'; facilityId: string; label: string; position: { x: number; y: number } }
    | null
  >(null);
  /** 回城/进驻确认弹窗（部队点击本方城池 → 回城；点击无守军无主城池/关隘 → 进驻占领） */
  const [returnCityConfirm, setReturnCityConfirm] = useState<
    | { unitId: string; coord: GridCoord; label: string; position: { x: number; y: number }; occupying?: boolean }
    | null
  >(null);
  /** 委任修补确认弹窗（移动模式下点击未完成的己方设施后弹出） */
  const [repairConfirm, setRepairConfirm] = useState<
    | { unitId: string; facilityId: string; label: string; position: { x: number; y: number } }
    | null
  >(null);
  const [mapContextMenu, setMapContextMenu] = useState<{ x: number; y: number } | null>(null);
  const [showGlobalIntel, setShowGlobalIntel] = useState(false);
  const [showMapIntelOptions, setShowMapIntelOptions] = useState(false);
  const [mapOfficerListScope, setMapOfficerListScope] = useState<'player' | 'all' | { forceId: ForceId } | null>(null);
  const [viewFinalMap, setViewFinalMap] = useState(false);
  const mapContextMenuRef = useRef<HTMLElement>(null);
  const cityInfoMenuRef = useRef<HTMLElement>(null);
  const passInfoMenuRef = useRef<HTMLElement>(null);
  const unitCommandMenuRef = useRef<HTMLElement>(null);
  const delegateMenuRef = useRef<HTMLElement>(null);
  const delegateFacilityMenuRef = useRef<HTMLElement>(null);
  const unitTacticMenuRef = useRef<HTMLElement>(null);
  const unitStrategyMenuRef = useRef<HTMLElement>(null);
  const unitFacilityMenuRef = useRef<HTMLElement>(null);
  const unitIntelMenuRef = useRef<HTMLElement>(null);
  const facilityContextMenuRef = useRef<HTMLElement>(null);
  const plotContextMenuRef = useRef<HTMLElement>(null);
  const cancelConfirmRef = useRef<HTMLElement>(null);
  const returnCityConfirmRef = useRef<HTMLElement>(null);
  const repairConfirmRef = useRef<HTMLElement>(null);
  const unitHoverCloseTimerRef = useRef<number | null>(null);
  const canOperateCurrentTurn = !state || state.turnForceId === state.playerForceId;
  /** 右键菜单「委任部队行动」可用性：本方存在尚未行动的委任部队；联网由服务器统一推进，故置灰 */
  const canExecuteDelegation = canOperateCurrentTurn
    && online.mode !== 'online'
    && Boolean(state && hasExecutableDelegation(state, state.playerForceId));
  /** 命令/培育宿主：关隘宿主用其归辖城充当 cityId，否则用当前选中城池 */
  const activeHostPass = activeCommandPassId ? state?.passes?.[activeCommandPassId] : undefined;
  const activeHostCityId = activeHostPass ? activeHostPass.homeCityId : selectedCityId;
  const closeCommand = useCallback(() => {
    setActiveCommand(null);
    setActiveCommandPassId(null);
  }, []);
  const closeCultivate = useCallback(() => {
    setActiveCultivate(null);
    setActiveCommandPassId(null);
  }, []);
  const closeCultivatePicker = useCallback(() => setCultivatePickerOpen(false), []);
  const openCultivatePicker = useCallback((passId?: PassId | null) => {
    setActiveCommandPassId(passId ?? null);
    setCultivatePickerOpen(true);
    setActiveCommand(null);
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
    setPlotContextMenu(null);
  }, []);
  const launchCultivate = useCallback((category: CultivateCategory, passId?: PassId | null) => {
    setCultivatePickerOpen(false);
    setActiveCultivate(category);
    setActiveCommandPassId(passId ?? null);
    setActiveCommand(null);
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
    setPlotContextMenu(null);
  }, []);
  const cancelUnitHoverClose = useCallback(() => {
    if (unitHoverCloseTimerRef.current === null) return;
    window.clearTimeout(unitHoverCloseTimerRef.current);
    unitHoverCloseTimerRef.current = null;
  }, []);
  const scheduleUnitHoverClose = useCallback(() => {
    cancelUnitHoverClose();
    unitHoverCloseTimerRef.current = window.setTimeout(() => {
      unitHoverCloseTimerRef.current = null;
      setHoveredUnit(null);
    }, 120);
  }, [cancelUnitHoverClose]);
  const launchCommand = useCallback((type: GameCommand['type'], passId?: PassId | null) => {
    setActiveCommand(type);
    setActiveCommandPassId(passId ?? null);
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
    setPlotContextMenu(null);
  }, []);

  const openDeployDialog = useCallback((strongholdId: CityId | PassId) => {
    setDeployCityId(strongholdId);
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
    setPlotContextMenu(null);
  }, []);

  const openTransportDialog = useCallback((strongholdId: CityId | PassId) => {
    setTransportCityId(strongholdId);
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
    setPlotContextMenu(null);
  }, []);

  // 输送仍沿用独立的落位范围；出征已与普通移动统一（见下方 moveTargets）
  const deployTargets = useMemo(() => {
    if (!state || !pendingTransport) return [];
    if (targetingFacility || targetingFirePlot || targetingRepair) return [];
    return getDeploymentTargets(state, { cityId: pendingTransport.cityId, passId: pendingTransport.passId, kind: 'transport' });
  }, [pendingTransport, state, targetingFacility, targetingFirePlot, targetingRepair]);
  const isPendingDeployCommandMenu = unitCommandMenu?.unitId === PENDING_DEPLOY_UNIT_ID;
  // 出征落位前：在据点中心创建临时部队，展示与移动范围都复用普通部队的渲染与 movementCells。
  const placingDeployPreview = useMemo(() => {
    if (!state || !pendingDeploy) return null;
    const deployPass = pendingDeploy.passId ? state.passes?.[pendingDeploy.passId] : undefined;
    const deployCity = deployPass ? undefined : pendingDeploy.cityId ? state.cities[pendingDeploy.cityId] : undefined;
    if (!deployPass && !deployCity) return null;
    const origin = deployPass ? { q: deployPass.q, r: deployPass.r } : cityCenter(deployCity!);
    try {
      const preview = deployUnitPreviewWithId(state, state.playerForceId, {
        ...pendingDeploy,
        destination: origin,
      });
      const previewUnit = preview.state.units[preview.unitId];
      if (!previewUnit) return null;
      preview.state.units[preview.unitId] = { ...previewUnit, moved: false };
      return preview;
    } catch {
      return null;
    }
  }, [pendingDeploy, state]);
  const deployPreviewUnits = useMemo(() => {
    if (!placingDeployPreview) return [];
    const unit = placingDeployPreview.state.units[placingDeployPreview.unitId];
    return unit ? [unit] : [];
  }, [placingDeployPreview]);
  const moveControlState = placingDeployPreview?.state ?? state;
  const moveControlUnitId = placingDeployPreview?.unitId ?? selectedUnitId;
  const moveTargets = useMemo(() => {
    if (!moveControlState || !moveControlUnitId) return [];
    if (targetingAttack || targetingTactic || targetingFirePlot || targetingUnitStrategy || targetingFacility || targetingRepair) return [];
    const cells = getMovementTargets(moveControlState, moveControlUnitId);
    if (!placingDeployPreview) return cells;
    // 出征落位：排除所有城池 footprint 与关隘锚点/翼格（普通移动可进入本方城格，但出征落点不能是据点格）
    const cityKeys = new Set<string>();
    for (const city of Object.values(moveControlState.cities)) {
      for (const coord of sevenCellCityFootprint({ q: city.gridQ, r: city.gridR })) cityKeys.add(gridKey(coord));
    }
    const excluded = new Set([...cityKeys, ...allPassAnchorKeys(moveControlState), ...passBlockedKeys(moveControlState)]);
    return cells.filter((coord) => !excluded.has(gridKey(coord)));
  }, [moveControlState, moveControlUnitId, placingDeployPreview, targetingAttack, targetingFacility, targetingFirePlot, targetingRepair, targetingTactic, targetingUnitStrategy]);
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
  const unitMenuQuery = useMemo(() => (
    unitMenuState && unitMenuUnitId ? getUnitActionQuery(unitMenuState, unitMenuUnitId, unitMenuDestination) : null
  ), [unitMenuDestination, unitMenuState, unitMenuUnitId]);
  const unitMenuStrategies = unitMenuQuery?.availableStrategies ?? [];
  const unitMenuFacilities = unitMenuQuery?.availableFacilities ?? [];
  // 部队建造菜单的可见项：升级链（阵→砦→城塞 / 土垒→石墙 / 箭楼→连弩楼）只保留当前档位那一个入口，
  // 高档设施不单独列条目（研究完科技后入口自己改名并升级）。
  const facilityMenuForceId = (
    unitFacilityMenu?.unitId ? unitMenuState?.units[unitFacilityMenu.unitId]?.forceId : undefined
  ) ?? (
    delegateFacilityMenu?.unitId ? state?.units[delegateFacilityMenu.unitId]?.forceId : undefined
  ) ?? state?.playerForceId;
  const facilityMenuOptions = useMemo(
    () => unitFacilityMenuOptions(unitMenuState ?? state, facilityMenuForceId),
    [facilityMenuForceId, state, unitMenuState],
  );
  const tacticMenuState = pendingDeployActionPreview?.state ?? state;
  const tacticMenuOptions = (
    tacticMenuState && unitTacticMenu
      ? getUnitTacticOptions(tacticMenuState, unitTacticMenu.unitId, unitTacticMenu.destination)
      : []
  );
  const firePlotTargets = useMemo(() => (
    (pendingDeployActionPreview?.state ?? state) && targetingFacility
      ? getFacilityBuildTargets((pendingDeployActionPreview?.state ?? state)!, targetingFacility.unitId, targetingFacility.origin, targetingFacility.facilityType)
      : (pendingDeployActionPreview?.state ?? state) && targetingFirePlot ? getStrategyCellTargets((pendingDeployActionPreview?.state ?? state)!, targetingFirePlot.unitId, targetingFirePlot.strategyId, targetingFirePlot.origin) : []
  ), [pendingDeployActionPreview, state, targetingFacility, targetingFirePlot]);
  const attackTargetUnitIds = useMemo(() => {
    const targetState = pendingDeployActionPreview?.state ?? state;
    if (!targetState) return [];
    if (targetingAttack?.joint) return getUnitActionQuery(targetState, targetingAttack.unitId, targetingAttack.origin).jointAttackUnits.map((unit) => unit.id);
    if (targetingAttack) return getUnitActionQuery(targetState, targetingAttack.unitId, targetingAttack.origin).attackUnits.map((unit) => unit.id);
    if (targetingTactic) return getTacticUnitTargets(targetState, targetingTactic.unitId, targetingTactic.tacticId, targetingTactic.origin).map((unit) => unit.id);
    if (targetingUnitStrategy) return getStrategyUnitTargets(targetState, targetingUnitStrategy.unitId, targetingUnitStrategy.strategyId, targetingUnitStrategy.origin).map((unit) => unit.id);
    return [];
  }, [pendingDeployActionPreview, state, targetingAttack, targetingTactic, targetingUnitStrategy]);
  const hoveredStrategyChance = useMemo(() => {
    const targetState = pendingDeployActionPreview?.state ?? state;
    if (!targetState || !targetingUnitStrategy || !hoveredUnit) return undefined;
    if (!HARMFUL_UNIT_STRATEGIES.has(targetingUnitStrategy.strategyId)) return undefined;
    if (!attackTargetUnitIds.includes(hoveredUnit.unitId)) return undefined;
    const source = targetState.units[targetingUnitStrategy.unitId];
    const target = targetState.units[hoveredUnit.unitId];
    const strategy = UNIT_STRATEGIES.find((candidate) => candidate.id === targetingUnitStrategy.strategyId);
    if (!source || !target || !strategy) return undefined;
    return {
      name: strategy.name,
      percent: harmfulStrategySuccessChance(
        effectiveUnitAbilities(targetState, source).intelligence.value,
        effectiveUnitAbilities(targetState, target).intelligence.value,
      ),
    };
  }, [attackTargetUnitIds, hoveredUnit, pendingDeployActionPreview, state, targetingUnitStrategy]);
  const attackTargetCityIds = useMemo(() => {
    const targetState = pendingDeployActionPreview?.state ?? state;
    if (!targetState || !targetingAttack || targetingAttack.joint) return [];
    return getUnitActionQuery(targetState, targetingAttack.unitId, targetingAttack.origin).attackCities.map((city) => city.id);
  }, [pendingDeployActionPreview, state, targetingAttack]);
  const attackTargetPassIds = useMemo(() => {
    const targetState = pendingDeployActionPreview?.state ?? state;
    if (!targetState || !targetingAttack || targetingAttack.joint) return [];
    return getUnitActionQuery(targetState, targetingAttack.unitId, targetingAttack.origin).attackPasses.map((pass) => pass.id);
  }, [pendingDeployActionPreview, state, targetingAttack]);
  const targetFacilityIds = useMemo(() => {
    const targetState = pendingDeployActionPreview?.state ?? state;
    if (!targetState) return [];
    if (targetingAttack && !targetingAttack.joint) return getUnitActionQuery(targetState, targetingAttack.unitId, targetingAttack.origin).attackFacilities.map((facility) => facility.id);
    if (targetingTactic) return getTacticFacilityTargets(targetState, targetingTactic.unitId, targetingTactic.tacticId, targetingTactic.origin).map((facility) => facility.id);
    if (targetingRepair) return getRepairTargets(targetState, targetingRepair.unitId, targetingRepair.origin).map((facility) => facility.id);
    return [];
  }, [pendingDeployActionPreview, state, targetingAttack, targetingRepair, targetingTactic]);
  const attackTargetPlotKeys = useMemo(() => {
    const targetState = pendingDeployActionPreview?.state ?? state;
    if (!targetState || !targetingAttack || targetingAttack.joint) return new Set<string>();
    return new Set(getUnitActionQuery(targetState, targetingAttack.unitId, targetingAttack.origin).attackPlots.map((plot) => `${plot.cityId}:${plot.plotIndex}`));
  }, [pendingDeployActionPreview, state, targetingAttack]);

  const closeDeployDialog = useCallback(() => {
    setDeployCityId(null);
  }, []);

  const closeTransportDialog = useCallback(() => {
    setTransportCityId(null);
  }, []);

  const confirmDeploySetup = useCallback((input: DeployConfirmInput) => {
    setPendingDeploy(input);
    setDeployCityId(null);
    setSelectedUnitId(PENDING_DEPLOY_UNIT_ID);
  }, []);

  const confirmTransportSetup = useCallback((input: TransportConfirmInput) => {
    setPendingTransport(input);
    setTransportCityId(null);
  }, []);

  const selectDeployTarget = useCallback((coord: GridCoord, position: { x: number; y: number }) => {
    if (!canOperateCurrentTurn) return;
    if (!pendingDeploy && !pendingTransport) return;
    if (deployTargets.some((target) => target.q === coord.q && target.r === coord.r)) {
      setDelegateMenu(null);
      setDelegateFacilityMenu(null);
      setDelegatePath([]);
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
      return;
    }
    // 超距点击：按出征预演计算最优路径，可达则高亮路径并弹出「移动/设置」选项（与部队移动的超距委任一致）。
    // 出征落点（出生格）优先取玩家已选的部署格；否则选朝委任目标最近的部署格，
    // 让路径从城池面向目标的一侧出发，而不是固定第一个部署格导致先反向绕路。
    if (!pendingDeploy || !state) return;
    // 出征超距：出生格从出征可部署格中选「朝委任目标最近」者（与出征菜单的超距处理一致，
    // 否则退化为 preferredSpawnCell 固定取第一个部署格，部队会停在城边不动）。
    const deployCells = getDeploymentTargets(state, {
      cityId: pendingDeploy.cityId,
      passId: pendingDeploy.passId,
      troopType: pendingDeploy.troopType,
      officerIds: pendingDeploy.officerIds,
    });
    const fallbackSpawn = chooseDelegateSpawnCell(deployCells, coord);
    const deployInput: DeployConfirmInput & { destination?: GridCoord } = pendingDeployCommand
      ? { ...pendingDeployCommand.input, destination: pendingDeployCommand.destination }
      : fallbackSpawn
        ? { ...pendingDeploy, destination: fallbackSpawn }
        : pendingDeploy;
    try {
      const preview = deployUnitPreviewWithId(state, state.playerForceId, deployInput);
      const path = computeDelegatePath(preview.state, preview.unitId, coord);
      if (!path || path.length <= 1) return;
      setDelegatePath(path);
      setDelegateMenu({ unitId: PENDING_DEPLOY_UNIT_ID, target: coord, position, deployInput });
      setDelegateFacilityMenu(null);
      setUnitCommandMenu(null);
      setUnitTacticMenu(null);
      setUnitStrategyMenu(null);
      setUnitFacilityMenu(null);
      setSelectedUnitId(null);
      setPendingDeployAction(null);
    } catch {
      return;
    }
  }, [canOperateCurrentTurn, deployTargets, deployTransportUnit, pendingDeploy, pendingDeployCommand, pendingTransport, state]);

  const selectUnit = useCallback((unitId: string, position: { x: number; y: number }) => {
    cancelUnitHoverClose();
    setHoveredUnit(null);
    if (!state) return;
    const unit = state.units[unitId];
    if (!canOperateCurrentTurn || !unit || unit.forceId !== state.playerForceId || unit.moved || unit.acted || unitIsIncapacitated(unit) || unit.movementRemaining <= 0) {
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
    setPlotContextMenu(null);
      return;
    }
    if (selectedUnitId !== unitId) emitAudioEvent({ type: 'menu-waiting-for-target' });
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
    setPlotContextMenu(null);
    setDelegateMenu(null);
    setDelegateFacilityMenu(null);
    setDelegatePath([]);
    if (selectedUnitId === unitId) {
      setUnitCommandMenu({ unitId, position });
      return;
    }
    setUnitCommandMenu(null);
    setSelectedUnitId(unitId);
  }, [cancelUnitHoverClose, canOperateCurrentTurn, emitAudioEvent, selectedUnitId, state]);

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
    setPlotContextMenu(null);
    setSelectedUnitId(null);
    setDelegateMenu(null);
    setDelegateFacilityMenu(null);
    setDelegatePath([]);
    setUnitIntelMenu({ unitId, position });
  }, [state]);

  const openUnitDetail = useCallback(() => {
    if (!unitIntelMenu) return;
    emitAudioEvent({ type: 'menu-click-on' });
    setUnitDetailId(unitIntelMenu.unitId);
    setUnitIntelMenu(null);
  }, [emitAudioEvent, unitIntelMenu]);

  const openUnitOfficers = useCallback(() => {
    if (!unitIntelMenu) return;
    emitAudioEvent({ type: 'menu-click-on' });
    setUnitOfficerListId(unitIntelMenu.unitId);
    setUnitIntelMenu(null);
  }, [emitAudioEvent, unitIntelMenu]);

  const openPassInfoMenu = useCallback((passId: PassId, position: { x: number; y: number }) => {
    emitAudioEvent({ type: 'menu-click-on' });
    setMapContextMenu(null);
    setShowMapIntelOptions(false);
    setPassMenu(null);
    setPassInfoMenu({ passId, position });
  }, [emitAudioEvent]);

  const selectMoveTarget = useCallback((coord: GridCoord, position: { x: number; y: number }) => {
    if (!canOperateCurrentTurn) return;
    if (!selectedUnitId) return;
    const placingDeploy = pendingDeploy && placingDeployPreview ? placingDeployPreview : null;
    if (moveTargets.some((target) => target.q === coord.q && target.r === coord.r)) {
      setDelegatePath([]);
      setDelegateMenu(null);
      setDelegateFacilityMenu(null);
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
      // 出征落位：与普通移动一致，点选目标格后弹出行动菜单
      if (placingDeploy) {
        setPendingDeployCommand({ input: pendingDeploy!, destination: coord });
        setUnitCommandMenu({ unitId: PENDING_DEPLOY_UNIT_ID, position, destination: coord });
        setPendingDeployAction(null);
        return;
      }
      // 目标为本方城池格 → 弹出「是/否」回城确认框；无守军无主城 → 弹出「进入/进驻」确认框
      if (state) {
        const ownCity = ownCityAt(state, state.playerForceId, coord);
        const freeCity = ownCity ? undefined : unoccupiedCityAt(state, coord);
        const city = ownCity ?? freeCity;
        if (city) {
          setReturnCityConfirm({
            unitId: selectedUnitId, coord, label: city.name, position, occupying: Boolean(freeCity),
          });
          return;
        }
        // 目标为本方关隘 / 无守军无主关隘 → 与进城一致，弹出进入确认框
        const ownPass = ownPassAt(state, state.playerForceId, coord);
        const freePass = ownPass ? undefined : unoccupiedPassAt(state, coord);
        const pass = ownPass ?? freePass;
        if (pass) {
          setReturnCityConfirm({
            unitId: selectedUnitId, coord, label: pass.name, position, occupying: Boolean(freePass),
          });
          return;
        }
      }
      setUnitCommandMenu({ unitId: selectedUnitId, position, destination: coord });
      return;
    }
    // 超距点击：计算最优路径，可达则高亮路径并弹出「移动/设置」选项
    if (placingDeploy) {
      // 出征超距委任：出生格选在朝委任目标最近的部署格（与普通移动一致，从城池面向目标的一侧出发，
      // 避免固定第一个部署格导致先反向绕路）；预演与实际部署使用同一 destination。
      const deployCells = getDeploymentTargets(state!, {
        cityId: pendingDeploy!.cityId,
        passId: pendingDeploy!.passId,
        troopType: pendingDeploy!.troopType,
        officerIds: pendingDeploy!.officerIds,
      });
      const fallbackSpawn = chooseDelegateSpawnCell(deployCells, coord);
      const deployInput: DeployConfirmInput & { destination?: GridCoord } = fallbackSpawn
        ? { ...pendingDeploy!, destination: fallbackSpawn }
        : pendingDeploy!;
      const spawnPreview = deployUnitPreviewWithId(state!, state!.playerForceId, deployInput);
      const path = computeDelegatePath(spawnPreview.state, spawnPreview.unitId, coord);
      if (!path || path.length <= 1) return;
      setDelegatePath(path);
      setDelegateMenu({ unitId: PENDING_DEPLOY_UNIT_ID, target: coord, position, deployInput });
      setDelegateFacilityMenu(null);
      return;
    }
    const unit = state?.units[selectedUnitId];
    // 部队无法再行动（已行动/已移动/混乱）时算不出委任路径，同样走下面的关隘兜底
    const canDelegate = Boolean(unit) && !unit!.acted && !unit!.moved && !unitIsIncapacitated(unit!);
    const path = canDelegate ? computeDelegatePath(state!, selectedUnitId, coord) : null;
    if (!path || path.length <= 1) {
      // 走不到这个格子：若它正好是关隘锚点，至少把关隘情报弹出来。
      // 否则「选中部队 → 点敌方/远处的关隘」会完全没反应，玩家会以为关隘不可点。
      const unreachablePass = state ? passAt(state, coord) : undefined;
      if (unreachablePass) openPassInfoMenu(unreachablePass.id, position);
      return;
    }
    setDelegatePath(path);
    setDelegateMenu({ unitId: selectedUnitId, target: coord, position });
    setDelegateFacilityMenu(null);
  }, [canOperateCurrentTurn, moveTargets, openPassInfoMenu, pendingDeploy, placingDeployPreview, selectedUnitId, state]);

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
      !unitMenuQuery?.commandAvailability.attack
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
  }, [beginPendingDeployAction, canOperateCurrentTurn, isPendingDeployCommandMenu, unitCommandMenu, unitMenuDestination, unitMenuQuery, unitMenuState, unitMenuUnitId]);

  const executeUnitJointAttackCommand = useCallback(() => {
    if (
      !canOperateCurrentTurn ||
      !unitCommandMenu ||
      !unitMenuState ||
      !unitMenuUnitId ||
      !unitMenuQuery?.commandAvailability.jointAttack
    ) return;
    const deployAction = isPendingDeployCommandMenu ? beginPendingDeployAction() : null;
    const commandUnitId = deployAction?.unitId ?? unitMenuUnitId;
    setSelectedUnitId(commandUnitId);
    setTargetingAttack({ unitId: commandUnitId, origin: deployAction ? undefined : unitMenuDestination, joint: true });
    setTargetingTactic(null);
    setTargetingFirePlot(null);
    setTargetingUnitStrategy(null);
    setTargetingFacility(null);
    setTargetingRepair(null);
    setUnitTacticMenu(null);
    setUnitStrategyMenu(null);
    setUnitCommandMenu(null);
  }, [beginPendingDeployAction, canOperateCurrentTurn, isPendingDeployCommandMenu, unitCommandMenu, unitMenuDestination, unitMenuQuery, unitMenuState, unitMenuUnitId]);

  const executeUnitRepairCommand = useCallback(() => {
    if (!canOperateCurrentTurn || !unitCommandMenu || !unitMenuUnitId || !unitMenuQuery?.commandAvailability.repair) return;
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
  }, [beginPendingDeployAction, canOperateCurrentTurn, isPendingDeployCommandMenu, unitCommandMenu, unitMenuDestination, unitMenuQuery, unitMenuUnitId]);

  const executeUnitDuelCommand = useCallback(() => {
    if (!canOperateCurrentTurn || !unitCommandMenu || !unitMenuUnitId || !unitMenuQuery?.commandAvailability.duel) return;
    emitAudioEvent({ type: 'menu-click-on' });
    const deployAction = isPendingDeployCommandMenu ? beginPendingDeployAction() : null;
    const commandUnitId = deployAction?.unitId ?? unitMenuUnitId;
    setSelectedUnitId(commandUnitId);
    setDuelDialogUnit({ unitId: commandUnitId, origin: deployAction ? undefined : unitMenuDestination });
    setUnitStrategyMenu(null);
    setUnitTacticMenu(null);
    setUnitFacilityMenu(null);
    setUnitCommandMenu(null);
  }, [beginPendingDeployAction, canOperateCurrentTurn, emitAudioEvent, isPendingDeployCommandMenu, unitCommandMenu, unitMenuDestination, unitMenuQuery, unitMenuUnitId]);

  const executeUnitTacticCommand = useCallback(() => {
    if (!canOperateCurrentTurn || !unitCommandMenu || !unitMenuUnitId || !unitMenuQuery?.commandAvailability.tactic) return;
    emitAudioEvent({ type: 'menu-click-on' });
    const deployAction = isPendingDeployCommandMenu ? beginPendingDeployAction() : null;
    setUnitStrategyMenu(null);
    setUnitTacticMenu({
      unitId: deployAction?.unitId ?? unitMenuUnitId,
      position: { x: unitCommandMenu.position.x + 108, y: unitCommandMenu.position.y },
      destination: deployAction ? undefined : unitMenuDestination,
    });
  }, [beginPendingDeployAction, canOperateCurrentTurn, emitAudioEvent, isPendingDeployCommandMenu, unitCommandMenu, unitMenuDestination, unitMenuQuery, unitMenuUnitId]);

  const executeUnitStrategyCommand = useCallback(() => {
    if (!canOperateCurrentTurn || !unitCommandMenu || !unitMenuUnitId || !unitMenuQuery?.commandAvailability.strategy) return;
    emitAudioEvent({ type: 'menu-click-on' });
    const deployAction = isPendingDeployCommandMenu ? beginPendingDeployAction() : null;
    setUnitTacticMenu(null);
    setUnitFacilityMenu(null);
    setUnitStrategyMenu({
      unitId: deployAction?.unitId ?? unitMenuUnitId,
      position: { x: unitCommandMenu.position.x + 108, y: unitCommandMenu.position.y },
      destination: deployAction ? undefined : unitMenuDestination,
    });
  }, [beginPendingDeployAction, canOperateCurrentTurn, emitAudioEvent, isPendingDeployCommandMenu, unitCommandMenu, unitMenuDestination, unitMenuQuery, unitMenuUnitId]);

  const executeUnitFacilityCommand = useCallback(() => {
    if (!canOperateCurrentTurn || !unitCommandMenu || !unitMenuUnitId || !unitMenuQuery?.commandAvailability.facility) return;
    emitAudioEvent({ type: 'menu-click-on' });
    const deployAction = isPendingDeployCommandMenu ? beginPendingDeployAction() : null;
    setUnitTacticMenu(null);
    setUnitStrategyMenu(null);
    setUnitFacilityMenu({
      unitId: deployAction?.unitId ?? unitMenuUnitId,
      position: { x: unitCommandMenu.position.x + 108, y: unitCommandMenu.position.y },
      destination: deployAction ? undefined : unitMenuDestination,
    });
  }, [beginPendingDeployAction, canOperateCurrentTurn, emitAudioEvent, isPendingDeployCommandMenu, unitCommandMenu, unitMenuDestination, unitMenuQuery, unitMenuUnitId]);

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

  /** 超距选项「移动」：本回合沿最优路径移动到最远处并记录移动委任 */
  const executeDelegateMove = useCallback(() => {
    if (!canOperateCurrentTurn || !delegateMenu) return;
    emitAudioEvent({ type: 'menu-click-on' });
    if (delegateMenu.deployInput) {
      deployUnitDelegate(delegateMenu.deployInput, delegateMenu.target);
      setPendingDeploy(null);
      setPendingDeployCommand(null);
      setPendingDeployAction(null);
    } else {
      setMoveDelegate(delegateMenu.unitId, delegateMenu.target);
    }
    setDelegateMenu(null);
    setDelegateFacilityMenu(null);
    setDelegatePath([]);
    setSelectedUnitId(null);
    setUnitCommandMenu(null);
    setUnitTacticMenu(null);
    setUnitStrategyMenu(null);
    setUnitFacilityMenu(null);
  }, [canOperateCurrentTurn, delegateMenu, deployUnitDelegate, emitAudioEvent, setMoveDelegate]);

  /** 超距选项「设置」：打开设施选择列表 */
  const openDelegateFacilityMenu = useCallback(() => {
    if (!canOperateCurrentTurn || !delegateMenu) return;
    emitAudioEvent({ type: 'menu-click-on' });
    setDelegateFacilityMenu({ ...delegateMenu, position: { x: delegateMenu.position.x + 108, y: delegateMenu.position.y } });
    setDelegateMenu(null);
  }, [canOperateCurrentTurn, delegateMenu, emitAudioEvent]);

  /** 选择指定设施后：发起建设委任（自动移动到目标相接点建设） */
  const executeDelegateFacilitySelect = useCallback((facility: FacilityType) => {
    if (!canOperateCurrentTurn || !delegateFacilityMenu) return;
    emitAudioEvent({ type: 'menu-click-on' });
    if (delegateFacilityMenu.deployInput) {
      deployUnitDelegate(delegateFacilityMenu.deployInput, delegateFacilityMenu.target, facility);
      setPendingDeploy(null);
      setPendingDeployCommand(null);
      setPendingDeployAction(null);
    } else {
      setBuildDelegate(delegateFacilityMenu.unitId, delegateFacilityMenu.target, facility);
    }
    setDelegateFacilityMenu(null);
    setDelegateMenu(null);
    setDelegatePath([]);
    setSelectedUnitId(null);
    setUnitCommandMenu(null);
    setUnitTacticMenu(null);
    setUnitStrategyMenu(null);
    setUnitFacilityMenu(null);
  }, [canOperateCurrentTurn, delegateFacilityMenu, deployUnitDelegate, emitAudioEvent, setBuildDelegate]);

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
    } else if (targetingAttack?.joint) {
      const handled = pendingDeployAction?.unitId === targetingAttack.unitId &&
        finishPendingDeployAction({ type: 'jointAttackUnit', targetId });
      if (!handled) {
        jointAttackUnit(targetingAttack.unitId, targetId, targetingAttack.origin);
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
  }, [attackTargetUnitIds, attackUnit, jointAttackUnit, canOperateCurrentTurn, finishPendingDeployAction, pendingDeployAction, targetingAttack, targetingTactic, targetingUnitStrategy, useUnitStrategy, useUnitTactic]);

  const selectFacilityTarget = useCallback((facilityId: string) => {
    if (!canOperateCurrentTurn) return;
    if (!targetFacilityIds.includes(facilityId)) return;
    if (targetingAttack) {
      const handled = pendingDeployAction?.unitId === targetingAttack.unitId &&
        finishPendingDeployAction({ type: 'attackFacility', facilityId });
      if (!handled) {
        attackFacility(targetingAttack.unitId, facilityId, targetingAttack.origin);
      }
    } else if (targetingTactic) {
      const handled = pendingDeployAction?.unitId === targetingTactic.unitId &&
        finishPendingDeployAction({ type: 'useUnitTactic', targetId: facilityId, tacticId: targetingTactic.tacticId });
      if (!handled) {
        useUnitTactic(targetingTactic.unitId, facilityId, targetingTactic.tacticId, targetingTactic.origin);
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
  }, [attackFacility, canOperateCurrentTurn, finishPendingDeployAction, pendingDeployAction, repairFacility, targetFacilityIds, targetingAttack, targetingRepair, targetingTactic, useUnitTactic]);

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

  /** 关隘与城池同构：攻击目标阶段点关隘即确认攻击（此前漏接回调，导致点关隘攻击无反应） */
  const selectAttackPassTarget = useCallback((passId: PassId) => {
    if (!canOperateCurrentTurn) return;
    if (!targetingAttack || !attackTargetPassIds.includes(passId)) return;
    if (pendingDeployAction?.unitId === targetingAttack.unitId) {
      finishPendingDeployAction({ type: 'attackPass', passId });
    } else {
      attackPass(targetingAttack.unitId, passId, targetingAttack.origin);
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
  }, [attackPass, attackTargetPassIds, canOperateCurrentTurn, finishPendingDeployAction, pendingDeployAction, targetingAttack]);

  const openFacilityContextMenu = useCallback((facilityId: string, position: { x: number; y: number }) => {
    if (!state || !canOperateCurrentTurn) return;
    const facility = state.facilities?.[facilityId];
    if (!facility || facility.forceId !== state.playerForceId) return;
    emitAudioEvent({ type: 'menu-right-click' });
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
    setCancelConfirm(null);
    setFacilityContextMenu({ facilityId, position });
  }, [canOperateCurrentTurn, emitAudioEvent, state]);

  const revokeFacilityFromMenu = useCallback(() => {
    if (!facilityContextMenu || !state) return;
    emitAudioEvent({ type: 'menu-click-on' });
    const facilityObject = state.facilities?.[facilityContextMenu.facilityId];
    const facilityName = facilityObject ? (UNIT_FACILITIES.find((f) => f.type === facilityObject.type)?.name ?? '设施') : '设施';
    setFacilityContextMenu(null);
    setPlotContextMenu(null);
    setCancelConfirm({
      kind: 'facility',
      facilityId: facilityContextMenu.facilityId,
      label: facilityName,
      position: facilityContextMenu.position,
    });
  }, [emitAudioEvent, facilityContextMenu, state]);

  const openCityPlotMenu = useCallback((cityId: string, plotIndex: number, position: { x: number; y: number }) => {
    if (!state || !canOperateCurrentTurn) return;
    const city = state.cities[cityId as CityId];
    if (!city || city.ownerId !== state.playerForceId) return;
    emitAudioEvent({ type: 'menu-right-click' });
    setHoveredUnit(null);
    setHoveredCity(null);
    setCityMenu(null);
    setCityInfoMenu(null);
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
    setFacilityContextMenu(null);
    setCancelConfirm(null);
    setPlotContextMenu({ cityId, plotIndex, position });
  }, [canOperateCurrentTurn, emitAudioEvent, state]);

  const selectPlotAttackTarget = useCallback((cityId: string, plotIndex: number) => {
    if (!canOperateCurrentTurn) return;
    const plotKey = `${cityId}:${plotIndex}`;
    if (!targetingAttack || targetingAttack.joint || !attackTargetPlotKeys.has(plotKey)) return;
    if (pendingDeployAction?.unitId === targetingAttack.unitId) {
      finishPendingDeployAction({ type: 'attackPlot', cityId: cityId as CityId, plotIndex });
    } else {
      attackPlot(targetingAttack.unitId, cityId as CityId, plotIndex, targetingAttack.origin);
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
  }, [attackPlot, attackTargetPlotKeys, canOperateCurrentTurn, finishPendingDeployAction, pendingDeployAction, targetingAttack]);

  const handleCityPlotSelect = useCallback((cityId: string, plotIndex: number, position: { x: number; y: number }) => {
    if (targetingAttack && attackTargetPlotKeys.has(`${cityId}:${plotIndex}`)) {
      selectPlotAttackTarget(cityId, plotIndex);
      return;
    }
    openCityPlotMenu(cityId, plotIndex, position);
  }, [attackTargetPlotKeys, openCityPlotMenu, selectPlotAttackTarget, targetingAttack]);

  const cancelCityPlotFromMenu = useCallback(() => {
    if (!plotContextMenu || !state) return;
    emitAudioEvent({ type: 'menu-click-on' });
    const plotCity = state.cities[plotContextMenu.cityId as CityId];
    const plot = plotCity?.plots?.[plotContextMenu.plotIndex];
    const plotLabel = plot?.constructing
      ? PLOT_LABELS[plot.constructing.facility]
      : plot && plot.type !== 'empty' ? PLOT_LABELS[plot.type] : '设施';
    setPlotContextMenu(null);
    setFacilityContextMenu(null);
    setCancelConfirm({
      kind: 'plot',
      cityId: plotContextMenu.cityId,
      plotIndex: plotContextMenu.plotIndex,
      label: plotLabel,
      position: plotContextMenu.position,
    });
  }, [emitAudioEvent, plotContextMenu, state]);

  /** 确认撤销：执行并关闭确认弹窗 */
  const confirmCancel = useCallback(() => {
    if (!cancelConfirm) return;
    emitAudioEvent({ type: 'menu-click-on' });
    try {
      if (cancelConfirm.kind === 'plot') {
        issueCommand({ type: 'cancelCityPlot', cityId: cancelConfirm.cityId as CityId, plotIndex: cancelConfirm.plotIndex });
      } else {
        dismantleFacility(cancelConfirm.facilityId);
      }
    } catch (error) {
      console.warn('撤销设施失败:', error);
    }
    setCancelConfirm(null);
  }, [cancelConfirm, dismantleFacility, emitAudioEvent, issueCommand]);

  /** 取消撤销 */
  const dismissCancelConfirm = useCallback(() => {
    emitAudioEvent({ type: 'menu-left-click' });
    setCancelConfirm(null);
  }, [emitAudioEvent]);

  /** 确认回城：执行 moveUnit 并关闭确认弹窗 */
  const confirmReturnCity = useCallback(() => {
    if (!returnCityConfirm) return;
    emitAudioEvent({ type: 'unit-moved' });
    try {
      moveUnit(returnCityConfirm.unitId, returnCityConfirm.coord);
      setSelectedUnitId(null);
    } catch (error) {
      console.warn('回城失败:', error);
    }
    setReturnCityConfirm(null);
  }, [emitAudioEvent, moveUnit, returnCityConfirm]);

  /** 取消回城 */
  const dismissReturnCityConfirm = useCallback(() => {
    emitAudioEvent({ type: 'menu-left-click' });
    setReturnCityConfirm(null);
  }, [emitAudioEvent]);

  /** 弹出委任修补确认（移动模式下点击未完成的己方设施） */
  const promptRepairConfirm = useCallback((facilityId: string, position: { x: number; y: number }) => {
    if (!canOperateCurrentTurn || !selectedUnitId || !state) return;
    const unit = state.units[selectedUnitId];
    if (!unit || unit.acted || unit.moved || unitIsIncapacitated(unit)) return;
    const facility = state.facilities?.[facilityId];
    if (!facility || facility.forceId !== state.playerForceId) return;
    emitAudioEvent({ type: 'menu-click-on' });
    const facilityName = UNIT_FACILITIES.find((f) => f.type === facility.type)?.name ?? '设施';
    setRepairConfirm({ unitId: selectedUnitId, facilityId, label: facilityName, position });
  }, [canOperateCurrentTurn, emitAudioEvent, selectedUnitId, state]);

  /** 确认委任修补：部队移动到设施旁并持续修补 */
  const confirmRepair = useCallback(() => {
    if (!repairConfirm) return;
    emitAudioEvent({ type: 'project-started' });
    try {
      setRepairDelegate(repairConfirm.unitId, repairConfirm.facilityId);
      setSelectedUnitId(null);
    } catch (error) {
      console.warn('委任修补失败:', error);
    }
    setRepairConfirm(null);
  }, [emitAudioEvent, repairConfirm, setRepairDelegate]);

  /** 取消委任修补 */
  const dismissRepairConfirm = useCallback(() => {
    emitAudioEvent({ type: 'menu-left-click' });
    setRepairConfirm(null);
  }, [emitAudioEvent]);

  const openMapContextMenu = useCallback((position: { x: number; y: number }) => {
    // 委任选项菜单打开时，右键仅退出当前选项，不取消出征/选中等流程
    if (delegateMenu || delegateFacilityMenu || delegatePath.length > 0) {
      emitAudioEvent({ type: 'menu-right-click' });
      setDelegateMenu(null);
      setDelegateFacilityMenu(null);
      setDelegatePath([]);
      return;
    }
    // 撤销菜单/确认弹窗打开时，右键空白处仅关闭它们，不弹地图主菜单（与城池菜单行为一致）
    if (facilityContextMenu || plotContextMenu || cancelConfirm || returnCityConfirm || repairConfirm) {
      emitAudioEvent({ type: 'menu-right-click' });
      setFacilityContextMenu(null);
      setPlotContextMenu(null);
      setCancelConfirm(null);
      setReturnCityConfirm(null);
      setRepairConfirm(null);
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
      if (pendingDeployAction || pendingDeploy) {
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
    if (cityMenu || deployCityId || transportCityId || pendingDeploy || pendingTransport) {
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
  }, [cancelConfirm, cityMenu, delegateFacilityMenu, delegateMenu, delegatePath, deployCityId, emitAudioEvent, facilityContextMenu, mapContextMenu, pendingDeploy, pendingDeployAction, pendingTransport, plotContextMenu, returnCityConfirm, selectedUnitId, targetingAttack, targetingFacility, targetingFirePlot, targetingRepair, targetingTactic, targetingUnitStrategy, transportCityId, unitCommandMenu, unitFacilityMenu, unitStrategyMenu, unitTacticMenu]);

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

  /** 右键菜单「委任部队行动」：让委任部队立刻行动一步，不推进回合、不结算旬末 */
  const executeDelegationFromMap = useCallback(() => {
    setMapContextMenu(null);
    setShowMapIntelOptions(false);
    executeDelegatedUnits();
  }, [executeDelegatedUnits]);

  const openIntelFromMap = useCallback(() => {
    setShowMapIntelOptions((current) => {
      if (!current) emitAudioEvent({ type: 'menu-click-on' });
      return !current;
    });
  }, [emitAudioEvent]);

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

  /** 关闭右键菜单及其衍生的所有浮层，再打开存档界面 */
  const openSaveDialog = useCallback((mode: SaveLoadDialogMode) => {
    setMapContextMenu(null);
    setShowMapIntelOptions(false);
    setUnitCommandMenu(null);
    setUnitTacticMenu(null);
    setUnitStrategyMenu(null);
    setTargetingAttack(null);
    setTargetingTactic(null);
    setTargetingFirePlot(null);
    setTargetingUnitStrategy(null);
    setSaveDialogMode(mode);
  }, []);

  const saveFromMap = useCallback(() => {
    openSaveDialog('save');
  }, [openSaveDialog]);

  const loadFromMap = useCallback(() => {
    openSaveDialog('load');
  }, [openSaveDialog]);

  /** 读取实时镜头：存档时随档落盘 */
  const readCamera = useCallback(() => cameraRef.current, []);

  /** 右侧概览列表点击：把主镜头居中到目标格（保留当前缩放） */
  const focusMapCell = useCallback((cell: GridCoord) => {
    mapFocusTokenRef.current += 1;
    setMapFocus({ cell, token: mapFocusTokenRef.current });
  }, []);

  // 读档（含从首页读档）后把存档镜头写回主地图，保证画面与存档时完全一致
  useEffect(() => {
    if (!pendingCamera) return;
    cameraTokenRef.current += 1;
    setCameraRestore({ camera: pendingCamera, token: cameraTokenRef.current });
    clearPendingCamera();
  }, [pendingCamera, clearPendingCamera]);

  const closeMapContextMenuFromRightClick = useCallback((event: ReactMouseEvent<HTMLElement>) => {
    event.preventDefault();
    event.stopPropagation();
    emitAudioEvent({ type: 'menu-right-click' });
    setMapContextMenu(null);
    setShowMapIntelOptions(false);
    setFacilityContextMenu(null);
    setPlotContextMenu(null);
  }, [emitAudioEvent]);

  const openCityInfoMenu = useCallback((cityId: NonNullable<typeof selectedCityId>, position: { x: number; y: number }) => {
    emitAudioEvent({ type: 'menu-click-on' });
    setMapContextMenu(null);
    setShowMapIntelOptions(false);
    setCityMenu(null);
    setPassInfoMenu(null);
    setCityInfoMenu({ cityId, position });
  }, [emitAudioEvent]);

  const closeCityInfoFromRightClick = useCallback((event: ReactMouseEvent<HTMLElement>) => {
    event.preventDefault();
    event.stopPropagation();
    emitAudioEvent({ type: 'menu-right-click' });
    setCityInfoMenu(null);
  }, [emitAudioEvent]);

  const closePassInfoFromRightClick = useCallback((event: ReactMouseEvent<HTMLElement>) => {
    event.preventDefault();
    event.stopPropagation();
    emitAudioEvent({ type: 'menu-right-click' });
    setPassInfoMenu(null);
  }, [emitAudioEvent]);

  const closeUnitCommandMenuFromRightClick = useCallback((event: ReactMouseEvent<HTMLElement>) => {
    event.preventDefault();
    event.stopPropagation();
    emitAudioEvent({ type: 'menu-right-click' });
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
    setPlotContextMenu(null);
  }, [emitAudioEvent]);

  const closeUnitIntelMenuFromRightClick = useCallback((event: ReactMouseEvent<HTMLElement>) => {
    event.preventDefault();
    event.stopPropagation();
    emitAudioEvent({ type: 'menu-right-click' });
    setUnitIntelMenu(null);
  }, [emitAudioEvent]);

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
    if (!cityInfoMenu) return undefined;
    const closeOnLeftClickOutside = (event: globalThis.MouseEvent) => {
      if (event.button !== 0) return;
      if (cityInfoMenuRef.current?.contains(event.target as Node)) return;
      setCityInfoMenu(null);
    };

    document.addEventListener('mousedown', closeOnLeftClickOutside);
    return () => document.removeEventListener('mousedown', closeOnLeftClickOutside);
  }, [cityInfoMenu]);

  useEffect(() => {
    if (!passInfoMenu) return undefined;
    const closeOnLeftClickOutside = (event: globalThis.MouseEvent) => {
      if (event.button !== 0) return;
      if (passInfoMenuRef.current?.contains(event.target as Node)) return;
      setPassInfoMenu(null);
    };

    document.addEventListener('mousedown', closeOnLeftClickOutside);
    return () => document.removeEventListener('mousedown', closeOnLeftClickOutside);
  }, [passInfoMenu]);

  useEffect(() => {
    if (!facilityContextMenu) return undefined;
    const closeOnLeftClickOutside = (event: globalThis.MouseEvent) => {
      if (event.button !== 0) return;
      if (facilityContextMenuRef.current?.contains(event.target as Node)) return;
      setFacilityContextMenu(null);
    setPlotContextMenu(null);
    };

    // 延迟注册：菜单在 pointerdown 时打开，同一击的 mousedown 随后才触发，
    // 立即注册会把刚打开的菜单当成"外部点击"立刻关闭
    const timer = window.setTimeout(() => document.addEventListener('mousedown', closeOnLeftClickOutside), 0);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('mousedown', closeOnLeftClickOutside);
    };
  }, [facilityContextMenu]);

  useEffect(() => {
    if (!plotContextMenu) return undefined;
    const closeOnLeftClickOutside = (event: globalThis.MouseEvent) => {
      if (event.button !== 0) return;
      if (plotContextMenuRef.current?.contains(event.target as Node)) return;
      setPlotContextMenu(null);
    };

    const timer = window.setTimeout(() => document.addEventListener('mousedown', closeOnLeftClickOutside), 0);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('mousedown', closeOnLeftClickOutside);
    };
  }, [plotContextMenu]);

  useEffect(() => {
    if (!cancelConfirm) return undefined;
    const closeOnLeftClickOutside = (event: globalThis.MouseEvent) => {
      if (event.button !== 0) return;
      if (cancelConfirmRef.current?.contains(event.target as Node)) return;
      setCancelConfirm(null);
    };

    document.addEventListener('mousedown', closeOnLeftClickOutside);
    return () => document.removeEventListener('mousedown', closeOnLeftClickOutside);
  }, [cancelConfirm]);

  useEffect(() => {
    if (!returnCityConfirm) return undefined;
    const closeOnLeftClickOutside = (event: globalThis.MouseEvent) => {
      if (event.button !== 0) return;
      if (returnCityConfirmRef.current?.contains(event.target as Node)) return;
      setReturnCityConfirm(null);
    };

    // 弹窗在 pointerdown 中打开（早于 mousedown），延迟挂监听避免同一次点击立即关闭
    const timer = window.setTimeout(() => document.addEventListener('mousedown', closeOnLeftClickOutside), 0);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('mousedown', closeOnLeftClickOutside);
    };
  }, [returnCityConfirm]);

  useEffect(() => {
    if (!repairConfirm) return undefined;
    const closeOnLeftClickOutside = (event: globalThis.MouseEvent) => {
      if (event.button !== 0) return;
      if (repairConfirmRef.current?.contains(event.target as Node)) return;
      setRepairConfirm(null);
    };

    // 弹窗在 pointerdown 中打开（早于 mousedown），延迟挂监听避免同一次点击立即关闭
    const timer = window.setTimeout(() => document.addEventListener('mousedown', closeOnLeftClickOutside), 0);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('mousedown', closeOnLeftClickOutside);
    };
  }, [repairConfirm]);

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
    if (!delegateMenu && !delegateFacilityMenu) return undefined;
    const closeOnPointerOutside = (event: globalThis.PointerEvent) => {
      if (event.button !== 0) return;
      if (delegateMenuRef.current?.contains(event.target as Node)) return;
      if (delegateFacilityMenuRef.current?.contains(event.target as Node)) return;
      setDelegateMenu(null);
      setDelegateFacilityMenu(null);
      setDelegatePath([]);
    };

    document.addEventListener('pointerdown', closeOnPointerOutside);
    return () => document.removeEventListener('pointerdown', closeOnPointerOutside);
  }, [delegateFacilityMenu, delegateMenu]);

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

  // 左侧都市信息面板：点击面板/城池格/城池菜单以外区域时隐藏（左键或右键均可关闭）
  useEffect(() => {
    if (!cityStatusId) return undefined;
    const closeOnPointerOutside = (event: globalThis.PointerEvent) => {
      if (event.button !== 0 && event.button !== 2) return;
      const target = event.target as Element | null;
      if (!target?.closest) return;
      if (target.closest('.city-status-panel')) return;
      if (target.closest('.city-command-menu')) return;
      // 城池格点击由选中逻辑处理：我方城池刷新面板，他势力城池因选中城变更自动隐藏
      if (target.closest('[data-city-id]')) return;
      setCityStatusId(null);
    };

    document.addEventListener('pointerdown', closeOnPointerOutside);
    return () => document.removeEventListener('pointerdown', closeOnPointerOutside);
  }, [cityStatusId]);

  // 左侧关隘信息面板：点击面板/关隘锚点/关隘菜单以外区域时隐藏（左键或右键均可关闭，与城池信息面板一致）
  useEffect(() => {
    if (!passStatusId) return undefined;
    const closeOnPointerOutside = (event: globalThis.PointerEvent) => {
      if (event.button !== 0 && event.button !== 2) return;
      const target = event.target as Element | null;
      if (!target?.closest) return;
      if (target.closest('.city-status-panel')) return;
      if (target.closest('.city-command-menu')) return;
      // 关隘锚点点击由选中逻辑处理：我方关隘刷新面板
      if (target.closest('[data-testid="pass-marker"]')) return;
      setPassStatusId(null);
    };

    document.addEventListener('pointerdown', closeOnPointerOutside);
    return () => document.removeEventListener('pointerdown', closeOnPointerOutside);
  }, [passStatusId]);

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
    const reports = state?.strategyResultReports ?? [];
    if (reports.length === 0) {
      setVisibleStrategyResultReports([]);
      return undefined;
    }

    setVisibleStrategyResultReports(reports);
    const timer = window.setTimeout(() => setVisibleStrategyResultReports([]), 2000);
    return () => window.clearTimeout(timer);
  }, [state?.strategyResultReports]);

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

  useEffect(() => () => cancelUnitHoverClose(), [cancelUnitHoverClose]);

  return (
    <main className="game-shell">
      <TopBar />
      <StrategicMap
        onCityMenu={(cityId, position) => {
          if (!canOperateCurrentTurn) return;
          emitAudioEvent({ type: 'menu-left-click' });
          setMapContextMenu(null);
          setCityMenu({ cityId, position });
          setCityStatusId(cityId);
        }}
        onPassMenu={(passId, position) => {
          if (!canOperateCurrentTurn) return;
          emitAudioEvent({ type: 'menu-left-click' });
          setMapContextMenu(null);
          setPassMenu({ passId, position });
          setPassStatusId(passId);
        }}
        onPassHover={(passId, position) => setHoveredPass({ passId, position })}
        onPassLeave={() => setHoveredPass(null)}
        onPassInfoMenu={(passId, position) => {
          openPassInfoMenu(passId, position);
        }}
        onCityInfoMenu={(cityId, position) => {
          openCityInfoMenu(cityId, position);
        }}
        deployTargets={deployTargets}
        constructionTargets={pendingConstruction && state?.cities[pendingConstruction.cityId]
          ? (state.cities[pendingConstruction.cityId].plots ?? [])
              .filter((p) => p && p.q != null && p.r != null && p.type === 'empty' && !p.constructing)
              .map((p) => ({ q: p.q!, r: p.r! }))
          : []}
        onConstructionTargetSelect={(coord) => {
          const pending = pendingConstructionRef.current;
          const current = latestStateRef.current;
          if (!pending || !current) return;
          const city = current.cities[pending.cityId];
          const plotIndex = canBuildPlotAtCoord(city, coord.q, coord.r);
          if (plotIndex == null) {
            console.warn('Selected plot is not buildable', coord);
            return;
          }
          if (isPlotOccupiedByOtherCity(current, city.id, coord.q, coord.r)) {
            console.warn('Plot is occupied by another city', coord);
            return;
          }
          emitAudioEvent({ type: 'menu-left-click' });
          try {
            issueCommand({
              type: 'buildFacilityPlot',
              cityId: pending.cityId,
              officerIds: pending.officerIds,
              plotIndex,
              facility: pending.facility,
            });
          } catch (e) {
            console.warn('Construction command failed:', e);
          } finally {
            pendingConstructionRef.current = null;
            setPendingConstruction(null);
            closeCommand();
          }
        }}
        onDeployTargetSelect={selectDeployTarget}
        moveTargets={moveTargets}
        delegatePath={delegatePath}
        deployDelegateMode={Boolean(pendingDeploy) && deployTargets.length > 0}
        firePlotTargets={firePlotTargets}
        firePlots={state?.firePlots}
        attackTargetCityIds={attackTargetCityIds}
        attackTargetPassIds={attackTargetPassIds}
        attackTargetFacilityIds={targetFacilityIds}
        attackTargetUnitIds={attackTargetUnitIds}
        attackTargetPlotKeys={attackTargetPlotKeys}
        damageReports={visibleDamageReports}
        strategyResultReports={visibleStrategyResultReports}
        cityEffectReports={visibleCityEffectReports}
        facilityRepairReports={visibleFacilityRepairReports}
        selectedUnitId={selectedUnitId}
        onCellHover={setHoveredCell}
        onMoveTargetSelect={selectMoveTarget}
        onFirePlotTargetSelect={selectFirePlotTarget}
        onUnitSelect={selectUnit}
        onUnitContextMenu={openUnitIntelMenu}
        onUnitHover={(unitId, position) => {
          cancelUnitHoverClose();
          setHoveredUnit({ unitId, position });
        }}
        onUnitLeave={scheduleUnitHoverClose}
        onCityHover={(cityId, position) => setHoveredCity({ cityId, position })}
        onCityLeave={() => setHoveredCity(null)}
        onAttackTargetSelect={selectAttackTarget}
        onAttackCityTargetSelect={selectAttackCityTarget}
        onAttackPassTargetSelect={selectAttackPassTarget}
        onFacilityTargetSelect={selectFacilityTarget}
        onFacilityContextMenu={openFacilityContextMenu}
        onFacilityRepairPrompt={promptRepairConfirm}
        onFacilityHover={(facilityId, position) => setHoveredFacility({ facilityId, position })}
        onFacilityLeave={() => setHoveredFacility(null)}
        onCityPlotSelect={handleCityPlotSelect}
        onCityPlotHover={(cityId, plotIndex, position) => setHoveredPlot({ cityId, plotIndex, position })}
        onCityPlotLeave={() => setHoveredPlot(null)}
        onMapContextClose={() => setMapContextMenu(null)}
        onFacilityMenuClose={() => {
          setFacilityContextMenu(null);
          setPlotContextMenu(null);
          setCancelConfirm(null);
        }}
        onMapContextMenu={openMapContextMenu}
        previewUnits={deployPreviewUnits}
        onViewChange={(camera) => { cameraRef.current = camera; }}
        restoreCamera={cameraRestore?.camera ?? null}
        restoreCameraToken={cameraRestore?.token ?? 0}
        focusCell={mapFocus?.cell ?? null}
        focusToken={mapFocus?.token ?? 0}
        freezeView={Boolean(
          mapContextMenu || unitIntelMenu || cityInfoMenu || facilityContextMenu
          || plotContextMenu || cancelConfirm || saveDialogMode,
        )}
      />
      {state && hoveredCell && (
        <div className="hover-coordinate tool-panel" data-testid="hover-coordinate">
          坐标：{hoveredCell.q},{hoveredCell.r} 地形：{TERRAIN_LABELS[hoveredCell.terrain]} 疆域：{(() => { const owner = territoryForceAt(state, hoveredCell); return owner ? state.forces[owner].name : '无主'; })()}
        </div>
      )}
      {state && hoveredUnit && state.units[hoveredUnit.unitId] && (
        <UnitInfoPanel
          unit={state.units[hoveredUnit.unitId]}
          state={state}
          position={hoveredUnit.position}
          strategyChance={hoveredStrategyChance}
          onPointerEnter={cancelUnitHoverClose}
          onPointerLeave={scheduleUnitHoverClose}
        />
      )}
      {state && hoveredCity && state.cities[hoveredCity.cityId] && (
        <CityInfoPanel city={state.cities[hoveredCity.cityId]} state={state} position={hoveredCity.position} />
      )}
      {state && hoveredFacility && state.facilities?.[hoveredFacility.facilityId] && (
        <FacilityInfoPanel facility={state.facilities[hoveredFacility.facilityId]} state={state} position={hoveredFacility.position} />
      )}
      {state && hoveredPlot && state.cities[hoveredPlot.cityId] && (
        <CityPlotInfoPanel city={state.cities[hoveredPlot.cityId]} plotIndex={hoveredPlot.plotIndex} state={state} position={hoveredPlot.position} />
      )}
      {state && hoveredPass && state.passes?.[hoveredPass.passId] && (
        <PassInfoPanel pass={state.passes[hoveredPass.passId]} state={state} position={hoveredPass.position} />
      )}
      <ForceOverviewPanel onFocus={focusMapCell} />
      {state && cityStatusId && selectedCityId === cityStatusId
        && state.cities[cityStatusId]?.ownerId === state.playerForceId && (
          <CityStatusPanel city={state.cities[cityStatusId]} state={state} />
      )}
      {state && passStatusId && state.passes?.[passStatusId]?.ownerId === state.playerForceId && (
        <PassStatusPanel pass={state.passes[passStatusId]} state={state} />
      )}
      <BattlePanel />
      <EventLog />
      {positionPanelOpen && state && (
        <PositionPanel
          lockForceId={positionPanelLockForceId}
          onClose={() => setPositionPanelOpen(false)}
        />
      )}
      {cityMenu && (
        <CityCommandMenu
          cityId={cityMenu.cityId}
          actionPoints={state ? state.actionPoints[state.playerForceId] : 0}
          merchantAvailable={Boolean(state && state.cities[cityMenu.cityId].merchantPresent && !state.cities[cityMenu.cityId].merchantTradedThisTenDay)}
          position={cityMenu.position}
          onCommand={launchCommand}
          onAppointPosition={() => {
            setPositionPanelLockForceId(state?.playerForceId);
            setPositionPanelOpen(true);
            setCityMenu(null);
          }}
          onCultivate={launchCultivate}
          onOpenCultivatePicker={openCultivatePicker}
          onDeploy={openDeployDialog}
          onTransport={openTransportDialog}
          onClose={() => setCityMenu(null)}
        />
      )}
      {passMenu && state?.passes?.[passMenu.passId] && (
        <PassCommandMenu
          passId={passMenu.passId}
          actionPoints={state ? state.actionPoints[state.playerForceId] : 0}
          position={passMenu.position}
          onCommand={launchCommand}
          onAppointPosition={() => {
            setPositionPanelLockForceId(state?.playerForceId);
            setPositionPanelOpen(true);
            setPassMenu(null);
          }}
          onCultivate={launchCultivate}
          onOpenCultivatePicker={openCultivatePicker}
          onDeploy={openDeployDialog}
          onTransport={openTransportDialog}
          onClose={() => setPassMenu(null)}
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
          <button
            type="button"
            className={!canExecuteDelegation ? 'is-disabled' : undefined}
            data-testid="map-context-delegate-button"
            onClick={executeDelegationFromMap}
            disabled={!canExecuteDelegation}
          >
            委任部队行动
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
      {cityInfoMenu && (
        <nav
          ref={cityInfoMenuRef}
          className="city-info-menu tool-panel"
          data-testid="city-info-menu"
          style={{ left: cityInfoMenu.position.x, top: cityInfoMenu.position.y }}
          aria-label="城池信息菜单"
          onContextMenu={closeCityInfoFromRightClick}
        >
          <button
            type="button"
            data-testid="city-info-detail-button"
            onClick={() => {
              setCityInfoMenu(null);
              setCityInfoDialogId(cityInfoMenu.cityId);
            }}
          >
            城池详细信息
          </button>
          <button
            type="button"
            data-testid="city-info-officers-button"
            onClick={() => {
              setCityInfoMenu(null);
              setCityOfficerListCityId(cityInfoMenu.cityId);
            }}
          >
            所属武将
          </button>
          <button
            type="button"
            data-testid="city-info-force-officers-button"
            disabled={!state?.cities[cityInfoMenu.cityId]?.ownerId}
            className={state?.cities[cityInfoMenu.cityId]?.ownerId ? undefined : 'is-disabled'}
            title={state?.cities[cityInfoMenu.cityId]?.ownerId ? undefined : '无主城池没有所属势力'}
            onClick={() => {
              setCityInfoMenu(null);
              const city = state?.cities[cityInfoMenu.cityId];
              if (city?.ownerId) setMapOfficerListScope({ forceId: city.ownerId });
            }}
          >
            势力武将
          </button>
        </nav>
      )}
      {passInfoMenu && state?.passes?.[passInfoMenu.passId] && (
        <nav
          ref={passInfoMenuRef}
          className="city-info-menu tool-panel"
          data-testid="pass-info-menu"
          style={{ left: passInfoMenu.position.x, top: passInfoMenu.position.y }}
          aria-label="关隘信息菜单"
          onContextMenu={closePassInfoFromRightClick}
        >
          <button
            type="button"
            data-testid="pass-info-detail-button"
            onClick={() => {
              setPassInfoMenu(null);
              setPassInfoDialogId(passInfoMenu.passId);
            }}
          >
            关隘详细信息
          </button>
          <button
            type="button"
            data-testid="pass-info-officers-button"
            onClick={() => {
              setPassInfoMenu(null);
              setPassOfficerListPassId(passInfoMenu.passId);
            }}
          >
            所属武将
          </button>
          <button
            type="button"
            data-testid="pass-info-force-officers-button"
            disabled={!state?.passes?.[passInfoMenu.passId]?.ownerId}
            className={state?.passes?.[passInfoMenu.passId]?.ownerId ? undefined : 'is-disabled'}
            title={state?.passes?.[passInfoMenu.passId]?.ownerId ? undefined : '无主关隘没有所属势力'}
            onClick={() => {
              setPassInfoMenu(null);
              const pass = state?.passes?.[passInfoMenu.passId];
              if (pass?.ownerId) setMapOfficerListScope({ forceId: pass.ownerId });
            }}
          >
            势力武将
          </button>
        </nav>
      )}
      {facilityContextMenu && (() => {
        const facilityObject = state?.facilities?.[facilityContextMenu.facilityId];
        const enemyNearFacility = facilityObject
          ? hasEnemyUnitsNear(state!, facilityObject.forceId, facilityObject.q, facilityObject.r, 2)
          : false;
        return (
          <nav
            ref={facilityContextMenuRef}
            className="city-command-menu tool-panel"
            data-testid="facility-context-menu"
            style={{ left: facilityContextMenu.position.x, top: facilityContextMenu.position.y }}
            aria-label="设施命令菜单"
            onContextMenu={(event) => {
              event.preventDefault();
              event.stopPropagation();
              emitAudioEvent({ type: 'menu-right-click' });
              setFacilityContextMenu(null);
              setPlotContextMenu(null);
            }}
          >
            <div className="city-command-secondary">
              <button
                type="button"
                data-testid="facility-dismantle-button"
                disabled={enemyNearFacility}
                className={enemyNearFacility ? 'is-disabled' : undefined}
                onClick={revokeFacilityFromMenu}
              >
                {enemyNearFacility ? '敌近无法撤销' : '撤销'}
              </button>
            </div>
          </nav>
        );
      })()}
      {plotContextMenu && (() => {
        const plotCity = state?.cities[plotContextMenu.cityId as CityId];
        const plot = plotCity?.plots?.[plotContextMenu.plotIndex];
        if (!plotCity || !plot) return null;
        const plotLabel = plot.constructing
          ? PLOT_LABELS[plot.constructing.facility]
          : plot.type !== 'empty'
            ? PLOT_LABELS[plot.type]
            : '设施';
        const plotEnemyNear = plot.q != null && plot.r != null && plotCity.ownerId != null
          ? hasEnemyUnitsNear(state!, plotCity.ownerId, plot.q, plot.r, 2)
          : false;
        return (
          <nav
            ref={plotContextMenuRef}
            className="city-command-menu tool-panel"
            data-testid="city-plot-menu"
            style={{ left: plotContextMenu.position.x, top: plotContextMenu.position.y }}
            aria-label="设施撤销菜单"
            onContextMenu={(event) => {
              event.preventDefault();
              event.stopPropagation();
              emitAudioEvent({ type: 'menu-right-click' });
              setPlotContextMenu(null);
            }}
          >
            <div className="city-command-secondary">
              <button
                type="button"
                data-testid="city-plot-cancel-button"
                disabled={plotEnemyNear}
                className={plotEnemyNear ? 'is-disabled' : undefined}
                onClick={cancelCityPlotFromMenu}
              >
                {plotEnemyNear ? '敌近无法撤销' : `撤销${plotLabel}`}
              </button>
            </div>
          </nav>
        );
      })()}
      {returnCityConfirm && (() => {
        const style = {
          left: Math.max(8, Math.min(returnCityConfirm.position.x, window.innerWidth - 160)),
          top: Math.max(8, Math.min(returnCityConfirm.position.y, window.innerHeight - 140)),
        } as CSSProperties;
        return (
          <nav
            ref={returnCityConfirmRef}
            className="city-command-menu tool-panel"
            data-testid="return-city-confirm-menu"
            style={style}
            aria-label={returnCityConfirm.occupying ? '进驻确认' : '回城确认'}
            onContextMenu={(event) => {
              event.preventDefault();
              event.stopPropagation();
              emitAudioEvent({ type: 'menu-right-click' });
              setReturnCityConfirm(null);
            }}
          >
            <div className="city-command-secondary">
              <div className="city-command-menu-title">
                {returnCityConfirm.occupying ? '是否进驻' : '是否进入'}{returnCityConfirm.label}？
              </div>
              <button type="button" data-testid="return-city-confirm-yes" onClick={confirmReturnCity}>是</button>
              <button type="button" data-testid="return-city-confirm-no" onClick={dismissReturnCityConfirm}>否</button>
            </div>
          </nav>
        );
      })()}
      {repairConfirm && (() => {
        const style = {
          left: Math.max(8, Math.min(repairConfirm.position.x, window.innerWidth - 160)),
          top: Math.max(8, Math.min(repairConfirm.position.y, window.innerHeight - 140)),
        } as CSSProperties;
        return (
          <nav
            ref={repairConfirmRef}
            className="city-command-menu tool-panel"
            data-testid="repair-confirm-menu"
            style={style}
            aria-label="委任修补确认"
            onContextMenu={(event) => {
              event.preventDefault();
              event.stopPropagation();
              emitAudioEvent({ type: 'menu-right-click' });
              setRepairConfirm(null);
            }}
          >
            <div className="city-command-secondary">
              <div className="city-command-menu-title">是否委任修补{repairConfirm.label}？</div>
              <button type="button" data-testid="repair-confirm-yes" onClick={confirmRepair}>是</button>
              <button type="button" data-testid="repair-confirm-no" onClick={dismissRepairConfirm}>否</button>
            </div>
          </nav>
        );
      })()}
      {cancelConfirm && (() => {
        const style = {
          left: Math.max(8, Math.min(cancelConfirm.position.x, window.innerWidth - 160)),
          top: Math.max(8, Math.min(cancelConfirm.position.y, window.innerHeight - 140)),
        } as CSSProperties;
        return (
          <nav
            ref={cancelConfirmRef}
            className="city-command-menu tool-panel"
            data-testid="cancel-confirm-menu"
            style={style}
            aria-label="撤销确认"
            onContextMenu={(event) => {
              event.preventDefault();
              event.stopPropagation();
              emitAudioEvent({ type: 'menu-right-click' });
              setCancelConfirm(null);
            }}
          >
            <div className="city-command-secondary">
              <div className="city-command-menu-title">是否撤销{cancelConfirm.label}？</div>
              <button type="button" data-testid="cancel-confirm-yes" onClick={confirmCancel}>是</button>
              <button type="button" data-testid="cancel-confirm-no" onClick={dismissCancelConfirm}>否</button>
            </div>
          </nav>
        );
      })()}
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
            const disabled = command === '待命'
              ? !unitMenuQuery?.commandAvailability.wait
              : commandIndex === 1
                ? !unitMenuQuery?.commandAvailability.attack
                : command === '齐攻'
                  ? !unitMenuQuery?.commandAvailability.jointAttack
                  : command === '战法'
                    ? !unitMenuQuery?.commandAvailability.tactic
                    : command === '单挑'
                      ? !unitMenuQuery?.commandAvailability.duel
                      : command === '计略'
                        ? !unitMenuQuery?.commandAvailability.strategy
                        : command === '设置'
                          ? !unitMenuQuery?.commandAvailability.facility
                          : command === '修补'
                            ? !unitMenuQuery?.commandAvailability.repair
                            : true;
            const onClick =
              command === '待命' ? executeUnitWaitCommand :
              commandIndex === 1 ? executeUnitAttackCommand :
              command === '齐攻' ? executeUnitJointAttackCommand :
              command === '战法' ? executeUnitTacticCommand :
              command === '单挑' ? executeUnitDuelCommand :
              command === '计略' ? executeUnitStrategyCommand :
              commandIndex === 7 ? executeUnitRepairCommand :
              undefined;
            return (
              <button
                key={command}
                type="button"
                className={disabled ? 'is-disabled' : undefined}
                disabled={disabled}
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
            emitAudioEvent({ type: 'menu-right-click' });
            setUnitFacilityMenu(null);
          }}
        >
          {facilityMenuOptions.map((facility) => {
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
      {delegateMenu && (
        <nav
          ref={delegateMenuRef}
          className="unit-command-menu tool-panel"
          data-testid="delegate-menu"
          style={{ left: delegateMenu.position.x, top: delegateMenu.position.y }}
          aria-label="部队委任选项"
          onContextMenu={(event) => {
            event.preventDefault();
            event.stopPropagation();
            emitAudioEvent({ type: 'menu-right-click' });
            setDelegateMenu(null);
            setDelegateFacilityMenu(null);
            setDelegatePath([]);
          }}
        >
          <button type="button" data-testid="delegate-move" onClick={executeDelegateMove}>移动</button>
          <button type="button" data-testid="delegate-build" onClick={openDelegateFacilityMenu}>设置</button>
        </nav>
      )}
      {delegateFacilityMenu && (
        <nav
          ref={delegateFacilityMenuRef}
          className="unit-strategy-menu tool-panel"
          data-testid="delegate-facility-menu"
          style={{ left: delegateFacilityMenu.position.x, top: delegateFacilityMenu.position.y }}
          aria-label="部队委任设置菜单"
          onContextMenu={(event) => {
            event.preventDefault();
            event.stopPropagation();
            emitAudioEvent({ type: 'menu-right-click' });
            setDelegateFacilityMenu(null);
          }}
        >
          {facilityMenuOptions.map((facility) => {
            // 科技未解锁的设施在委任菜单里同样置灰（与部队设置菜单、validateCommand 同一口径）
            const enabled = !state || canBuildFacility(state, facilityMenuForceId, facility.type);
            return (
              <button
                key={facility.type}
                type="button"
                disabled={!enabled}
                title={enabled ? undefined : '尚未研究出建造该设施的科技'}
                onClick={() => executeDelegateFacilitySelect(facility.type)}
              >
                {facility.name}（{FACILITY_BUILD_COSTS[facility.type]}）
              </button>
            );
          })}
        </nav>
      )}
      {unitStrategyMenu && unitMenuState && (
        <nav
          ref={unitStrategyMenuRef}
          className="unit-strategy-menu tool-panel"
          data-testid="unit-strategy-menu"
          style={{ left: unitStrategyMenu.position.x, top: unitStrategyMenu.position.y }}
          aria-label="部队计略菜单"
          onContextMenu={(event) => {
            event.preventDefault();
            event.stopPropagation();
            emitAudioEvent({ type: 'menu-right-click' });
            setUnitStrategyMenu(null);
          }}
        >
          {UNIT_STRATEGIES.map((strategy) => {
            const strategyState = pendingDeployActionPreview?.state ?? unitMenuState;
            const cost = strategyState.units[unitStrategyMenu.unitId]
              ? strategyEnergyCostForUnit(strategyState, unitStrategyMenu.unitId, strategy.id)
              : strategy.cost;
            return (
              <button
                key={strategy.id}
                type="button"
                disabled={!unitMenuStrategies.some((candidate) => candidate.id === strategy.id)}
                onClick={() => selectUnitStrategy(strategy.id)}
              >
                {strategy.name}（{cost}）
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
            emitAudioEvent({ type: 'menu-right-click' });
            setUnitTacticMenu(null);
          }}
        >
          {tacticMenuOptions.map(({ tactic, unavailableReason }) => {
            return (
              <button
                key={tactic.id}
                type="button"
                disabled={Boolean(unavailableReason)}
                title={unavailableReason}
                onClick={() => selectUnitTactic(tactic.id)}
              >
                {tactic.name}
              </button>
            );
          })}
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
      {mapOfficerListScope && <OfficerListDialog scope={typeof mapOfficerListScope === 'object' ? mapOfficerListScope : mapOfficerListScope} onClose={() => setMapOfficerListScope(null)} />}
      {cityInfoDialogId && state?.cities[cityInfoDialogId] && (
        <CityInfoDialog cityId={cityInfoDialogId} onClose={() => setCityInfoDialogId(null)} />
      )}
      {cityOfficerListCityId && state?.cities[cityOfficerListCityId] && (
        <OfficerListDialog
          title={state.cities[cityOfficerListCityId].name}
          officerIds={Object.values(state.officers)
            .filter((officer) =>
              officer.forceId === state.cities[cityOfficerListCityId].ownerId &&
              officer.cityId === cityOfficerListCityId,
            )
            .map((officer) => officer.id)}
          onClose={() => setCityOfficerListCityId(null)}
        />
      )}
      {passInfoDialogId && state?.passes?.[passInfoDialogId] && (
        <PassInfoDialog passId={passInfoDialogId} onClose={() => setPassInfoDialogId(null)} />
      )}
      {passOfficerListPassId && state?.passes?.[passOfficerListPassId] && (
        <OfficerListDialog
          title={state.passes?.[passOfficerListPassId]?.name}
          officerIds={Object.values(state.officers)
            .filter((officer) =>
              officer.forceId === state.passes?.[passOfficerListPassId]?.ownerId &&
              officer.location.kind === 'pass' &&
              officer.location.passId === passOfficerListPassId,
            )
            .map((officer) => officer.id)}
          onClose={() => setPassOfficerListPassId(null)}
        />
      )}
      {unitDetailId && state?.units[unitDetailId] && (
        <UnitDetailDialog unit={state.units[unitDetailId]} state={state} onClose={() => setUnitDetailId(null)} />
      )}
      {unitOfficerListId && state?.units[unitOfficerListId] && (
        <OfficerListDialog
          title="所属部队"
          officerIds={state.units[unitOfficerListId].officerIds ?? [state.units[unitOfficerListId].leaderId]}
          onClose={() => setUnitOfficerListId(null)}
        />
      )}
      {activeCommand && activeHostCityId && (
        <CommandDialog
          type={activeCommand}
          cityId={activeHostCityId}
          passId={activeCommandPassId ?? undefined}
          onClose={() => {
            setPendingConstruction(null);
            pendingConstructionRef.current = null;
            closeCommand();
          }}
          onSubmitOverride={activeCommand === 'buildFacilityPlot'
            ? ({ command }) => {
                if (command.type !== 'buildFacilityPlot') return;
                closeCommand();
                const nextPending = { cityId: command.cityId, officerIds: command.officerIds, facility: command.facility };
                pendingConstructionRef.current = nextPending;
                setPendingConstruction(nextPending);
              }
            : undefined}
        />
      )}
      {state?.debateSession
        && state.officers[state.debateSession.recruiterId]?.forceId === state.playerForceId
        && <DebateDialog onClose={() => undefined} />}
      {duelDialogUnit && state?.units[duelDialogUnit.unitId] && (
        <DuelDialog unitId={duelDialogUnit.unitId} origin={duelDialogUnit.origin} onClose={() => setDuelDialogUnit(null)} />
      )}
      {activeCultivate && activeHostCityId && (
        <CultivateDialog cityId={activeHostCityId} passId={activeCommandPassId ?? undefined} category={activeCultivate} onClose={closeCultivate} />
      )}
      {cultivatePickerOpen && activeHostCityId && (
        <CultivatePickerDialog onSelect={(category) => launchCultivate(category, activeCommandPassId)} onClose={closeCultivatePicker} />
      )}
      {deployCityId && (state?.passes?.[deployCityId as PassId] ? (
        <DeployDialog
          passId={deployCityId as PassId}
          onConfirm={confirmDeploySetup}
          onClose={closeDeployDialog}
        />
      ) : (
        <DeployDialog
          cityId={deployCityId as CityId}
          onConfirm={confirmDeploySetup}
          onClose={closeDeployDialog}
        />
      ))}
      {transportCityId && (state?.passes?.[transportCityId as PassId] ? (
        <TransportDialog
          passId={transportCityId as PassId}
          onConfirm={confirmTransportSetup}
          onClose={closeTransportDialog}
        />
      ) : (
        <TransportDialog
          cityId={transportCityId as CityId}
          onConfirm={confirmTransportSetup}
          onClose={closeTransportDialog}
        />
      ))}
      {saveDialogMode && (
        <SaveLoadDialog
          mode={saveDialogMode}
          getCamera={readCamera}
          onClose={() => setSaveDialogMode(null)}
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
