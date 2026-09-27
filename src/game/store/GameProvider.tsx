import {
  createContext,
  type PropsWithChildren,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from 'react';
import { runAiTurn } from '../ai';
import { autoResolveDebate } from '../debate';
import type { StrategyId, StrategySelection, SupplyArmament, TacticId } from '../battle/actions';
import type { ActionGameIntent } from '../network/intentReducer';
import type { DeployFollowupAction } from '../network/intents';
import {
  clearSave,
  clearSaves,
  loadSave,
  type LoadResult,
  type SaveAdapter,
  type SaveSlot,
  writeSave,
} from '../persistence';
import {
  buildSlotMeta,
  latestSlotNumber,
  listSlotMetas,
  readSlotMeta,
  readSlotState,
  removeSlot,
  writeSlot,
  type MapCamera,
  type SaveSlotMeta,
} from '../saveSlots';
import type { GridCoord } from '../battle/grid';
import { hasExecutableDelegation, runDelegatedUnits } from '../battle/delegate';
import { advanceTenDay, settleMonth, settleTenDay } from '../turn';
import { createGame } from '../scenario/jingxiang208';
import { createGameFromMap, facilitiesFromEditorMarkers } from '../scenario/customMap';
import { BUILTIN_MAP_CHINA42_ID, getMap } from '../mapRegistry';
import { settleForceTurnStart } from '../skills/rules/turn';
import type { EditableCityMarker, EditorFacilityMarker, EditorMapPayload } from '../map-editor/editor';
import type { City, CityArmaments, CityId, FacilityType, ForceId, GameCommand, GameState, GridCell, PassId, TroopType } from '../types';
import { createGameEngine, type GameEngine } from '../engine';
import {
  type AuthClientState,
  type OnlineClientState,
} from './onlineState';
import { useOnlineSession } from './onlineSession';
import { useAudioEventAdapter } from '../../audio/reactAudioEventAdapter';
import type { RoomMap } from '../network/session';

interface GameContextValue {
  state: GameState | null;
  selectedCityId: CityId | null;
  error: string | null;
  hasAutosave: boolean;
  hasManualSave: boolean;
  invalidSaves: Array<{ slot: SaveSlot; reason: string }>;
  /** 32 个单机存档槽摘要（下标 0 = 1 号槽，空槽为 null） */
  saveSlots: Array<SaveSlotMeta | null>;
  /** 最近一次保存的槽位号 */
  latestSaveSlot: number | null;
  /** 读档后待主地图消费的镜头（与存档时完全一致） */
  pendingCamera: MapCamera | null;
  online: OnlineClientState;
  auth: AuthClientState;
  startGame(forceId: ForceId, seed?: number, mapId?: string): void;
  registerAccount(input: { username: string; password: string; serverUrl?: string }): Promise<void>;
  loginAccount(input: { username: string; password: string; serverUrl?: string }): Promise<void>;
  logoutAccount(): void;
  loadOnlineRooms(input?: { serverUrl?: string }): Promise<void>;
  createOnlineRoom(input: { serverUrl?: string; seed?: number; map?: RoomMap; mapPayload?: EditorMapPayload }): Promise<void>;
  joinOnlineRoom(input: { roomId: string; serverUrl?: string }): Promise<void>;
  resumeOnlineRoom(input?: { serverUrl?: string; roomId?: string }): Promise<void>;
  selectOnlineForce(forceId: ForceId): Promise<void>;
  startOnlineGame(): Promise<void>;
  disconnectOnline(): void;
  loadGame(slot: SaveSlot): LoadResult;
  /** 将当前进度写入指定槽位（1~32），可覆盖 */
  saveToSlot(slot: number, options?: { note?: string; camera?: MapCamera | null }): Promise<{ ok: true } | { ok: false; reason: string }>;
  /** 读取指定槽位并整局替换，返回存档摘要以便恢复镜头 */
  loadFromSlot(slot: number): Promise<{ ok: true; meta: SaveSlotMeta | null } | { ok: false; reason: string }>;
  deleteSaveSlot(slot: number): void;
  clearPendingCamera(): void;
  issueCommand(command: GameCommand): void;
  deployUnit(input: { cityId?: CityId; passId?: PassId; officerId?: string; officerIds?: string[]; targetCityId?: CityId; troopType?: TroopType; vehicle?: 'boat' | 'ship'; siegeWeapon?: 'ram' | 'tower'; destination?: GridCoord; troops: number; gold?: number; food: number }): void;
  deployUnitDelegate(input: { cityId?: CityId; passId?: PassId; officerId?: string; officerIds?: string[]; targetCityId?: CityId; troopType?: TroopType; vehicle?: 'boat' | 'ship'; siegeWeapon?: 'ram' | 'tower'; destination?: GridCoord; troops: number; gold?: number; food: number }, target: { q: number; r: number }, facility?: FacilityType): void;
  deployUnitAction(input: { cityId?: CityId; passId?: PassId; officerId?: string; officerIds?: string[]; targetCityId?: CityId; troopType?: TroopType; vehicle?: 'boat' | 'ship'; siegeWeapon?: 'ram' | 'tower'; destination?: GridCoord; troops: number; gold?: number; food: number }, action: DeployFollowupAction): void;
  deployTransportUnit(input: { cityId?: CityId; passId?: PassId; officerId?: string; officerIds?: string[]; destination?: GridCoord; troops: number; gold: number; food: number; armaments?: Partial<CityArmaments> }, action?: DeployFollowupAction): void;
  moveUnit(unitId: string, destination: { q: number; r: number }): void;
  setMoveDelegate(unitId: string, target: { q: number; r: number }): void;
  setBuildDelegate(unitId: string, target: { q: number; r: number }, facility: FacilityType): void;
  setRepairDelegate(unitId: string, facilityId: string): void;
  attackUnit(attackerId: string, targetId: string, destination?: GridCoord): void;
  jointAttackUnit(attackerId: string, targetId: string, destination?: GridCoord): void;
  attackFacility(attackerId: string, facilityId: string, destination?: GridCoord): void;
  attackPlot(attackerId: string, cityId: CityId, plotIndex: number, destination?: GridCoord): void;
  useUnitTactic(attackerId: string, targetId: string, tacticId: TacticId, destination?: GridCoord): void;
  useUnitStrategy(unitId: string, strategyId: StrategyId, selection: StrategySelection, destination?: GridCoord): void;
  useFirePlot(unitId: string, target: GridCoord, destination?: GridCoord): void;
  buildFacility(unitId: string, facilityType: FacilityType, target: GridCoord, destination?: GridCoord): void;
  repairFacility(unitId: string, facilityId: string, destination?: GridCoord): void;
  supplyUnit(unitId: string, targetId: string, amount: { troops: number; gold: number; food: number }, destination?: GridCoord): void;
  dismantleFacility(facilityId: string): void;
  attackCity(attackerId: string, cityId: CityId, destination?: GridCoord): void;
  attackPass(attackerId: string, passId: PassId, destination?: GridCoord): void;
  duelUnit(unitId: string, targetUnitId: string, stance: 'attack' | 'defense' | 'spirit' | 'finisher', destination?: GridCoord): void;
  debateRound(cardUid: string): void;
  debateRethink(): void;
  debateAbandon(): void;
  dismissDebate(): void;
  waitUnit(unitId: string): void;
  applyMapEditorMap(map: { grid: GridCell[]; cities: EditableCityMarker[]; width?: number; height?: number; facilities?: EditorFacilityMarker[] }): void;
  endMonth(): void;
  endTenDay(): void;
  /** 让当前玩家的委任部队立刻行动一步（不推进回合、不结算旬末） */
  executeDelegatedUnits(): void;
  manualSave(): void;
  resetGame(): void;
  clearSave(slot: SaveSlot): void;
  selectCity(cityId: CityId | null): void;
  clearError(): void;
}

const GameContext = createContext<GameContextValue | null>(null);

interface GameProviderProps extends PropsWithChildren {
  initialState?: GameState | null;
  storage?: SaveAdapter;
}

function browserStorage(): SaveAdapter {
  if (typeof window === 'undefined') throw new Error('浏览器存储不可用');
  return window.localStorage;
}

function runOpponentTurns(state: GameState) {
  let next = state;
  const activeForceIds = Object.values(state.cities)
    .filter((city) => city.ownerId !== null)
    .map((city) => city.ownerId!);
  for (const forceId of new Set(activeForceIds)) {
    if (forceId !== state.playerForceId) {
      next = structuredClone(next);
      next.battleDamageReports = [];
      next.facilityRepairReports = [];
      next.strategyResultReports = [];
      settleForceTurnStart(next, forceId);
      next = runAiTurn(next, forceId);
    }
  }
  return next;
}

/**
 * 读档时丢弃「一次性飘字战报」：`battleDamageReports` / `cityEffectReports` /
 * `strategyResultReports` / `facilityRepairReports` 只是某一帧的展示数据（它们会随存档落盘），
 * 而 GameShell 的战报 effect 在 state 引用变化时会重新显示一次 —— 于是从存档进入游戏时，
 * 上一局最后一批飘字会被原样重放（如建设中的箭塔又飘一遍「+350」）。读档不应重现上一局的飘字。
 */
function withoutTransientReports(state: GameState): GameState {
  if (
    !state.battleDamageReports?.length &&
    !state.cityEffectReports?.length &&
    !state.strategyResultReports?.length &&
    !state.facilityRepairReports?.length
  ) return state;
  return {
    ...state,
    battleDamageReports: [],
    cityEffectReports: [],
    strategyResultReports: [],
    facilityRepairReports: [],
  };
}

function applyEditorMapToState(state: GameState, map: { grid: GridCell[]; cities: EditableCityMarker[]; width?: number; height?: number; facilities?: EditorFacilityMarker[] }): GameState {
  const markersById = new Map(map.cities.map((city) => [city.id, city]));
  const cities = Object.fromEntries(Object.entries(state.cities).map(([id, city]) => {
    const marker = markersById.get(id);
    return [id, marker ? { ...city, gridQ: marker.q, gridR: marker.r } : { ...city }];
  })) as Record<CityId, City>;

  return {
    ...state,
    cities,
    gridWidth: map.width ?? state.gridWidth,
    gridHeight: map.height ?? state.gridHeight,
    grid: map.grid.map((cell) => ({ ...cell })),
    // 编辑器摆放的军事设施随图应用（旧调用不传该字段时保持原设施不动）
    ...(map.facilities
      ? { facilities: facilitiesFromEditorMarkers(map.facilities, map.grid, Object.values(cities).map((city) => ({ q: city.gridQ, r: city.gridR }))) }
      : {}),
  };
}

export function GameProvider({ children, initialState = null, storage: storageProp }: GameProviderProps) {
  const storage = storageProp ?? browserStorage();
  const engineRef = useRef<GameEngine | null>(initialState ? createGameEngine(initialState, initialState.playerForceId) : null);
  const [state, setState] = useState<GameState | null>(() => initialState ? structuredClone(initialState) : null);
  const [selectedCityId, setSelectedCityId] = useState<CityId | null>(() => (
    initialState
      ? Object.values(initialState.cities).find((city) => city.ownerId === initialState.playerForceId)?.id ?? null
      : null
  ));
  const [error, setError] = useState<string | null>(null);
  const [saveRevision, setSaveRevision] = useState(0);
  const [pendingCamera, setPendingCamera] = useState<MapCamera | null>(null);
  /** 本局累计游玩秒数 = playSecondsRef + 本次读档/开局至此刻的时长 */
  const playSecondsRef = useRef(0);
  const playStartedAtRef = useRef(Date.now());
  const { emit: emitAudioEvent } = useAudioEventAdapter();

  const readPlaySeconds = useCallback(
    () => playSecondsRef.current + Math.max(0, (Date.now() - playStartedAtRef.current) / 1000),
    [],
  );
  const resetPlayClock = useCallback((seconds = 0) => {
    playSecondsRef.current = Math.max(0, Math.floor(seconds));
    playStartedAtRef.current = Date.now();
  }, []);

  const replaceGameState = useCallback((nextState: GameState | null) => {
    if (!nextState) {
      engineRef.current = null;
      setState(null);
      return null;
    }
    if (!engineRef.current) engineRef.current = createGameEngine(nextState, nextState.playerForceId);
    const snapshot = engineRef.current.replace(nextState);
    setState(snapshot);
    return snapshot;
  }, []);

  const dispatchGameIntent = useCallback((intent: ActionGameIntent) => {
    const engine = engineRef.current;
    if (!engine) throw new Error('尚未开始游戏');
    const next = engine.dispatch(intent);
    setState(next);
    return next;
  }, []);

  const applyOnlineSnapshotState = useCallback((snapshotState: GameState | null) => {
    if (snapshotState) {
      replaceGameState(snapshotState);
      setSelectedCityId(Object.values(snapshotState.cities).find((city) => city.ownerId === snapshotState.playerForceId)?.id ?? null);
    } else {
      replaceGameState(null);
      setSelectedCityId(null);
    }
  }, [replaceGameState]);

  const {
    online,
    auth,
    isOnline,
    registerAccount,
    loginAccount,
    logoutAccount,
    loadOnlineRooms,
    createOnlineRoom,
    joinOnlineRoom,
    resumeOnlineRoom,
    selectOnlineForce,
    startOnlineGame,
    disconnectOnline,
    sendOnlineIntent,
    setOnlineError,
  } = useOnlineSession({
    storage,
    applySnapshotState: applyOnlineSnapshotState,
    setError,
  });

  const persist = useCallback((slot: SaveSlot, next: GameState) => {
    writeSave(storage, slot, next);
    setSaveRevision((value) => value + 1);
  }, [storage]);

  const startGame = useCallback((forceId: ForceId, seed = Date.now(), mapId?: string) => {
    disconnectOnline();
    const next = (mapId && mapId !== BUILTIN_MAP_CHINA42_ID)
      ? createGameFromMap(getMap(mapId)!.payload, forceId, seed)
      : createGame(forceId, seed);
    replaceGameState(next);
    setSelectedCityId(Object.values(next.cities).find((city) => city.ownerId === forceId)?.id ?? null);
    setError(null);
    resetPlayClock(0);
    persist('auto', next);
  }, [disconnectOnline, persist, replaceGameState, resetPlayClock]);

  const loadGame = useCallback((slot: SaveSlot): LoadResult => {
    const result = loadSave(storage, slot);
    if (result.ok) {
      let loaded = withoutTransientReports(result.state);
      // 旧存档兼容：遗留的AI舌战会话（招募者非玩家势力）立即自动演算结算，不弹给玩家
      const staleSession = loaded.debateSession;
      if (staleSession?.status === 'ongoing'
        && loaded.officers[staleSession.recruiterId]?.forceId !== loaded.playerForceId) {
        loaded = autoResolveDebate(loaded);
      }
      replaceGameState(loaded);
      setSelectedCityId(Object.values(loaded.cities).find((city) => city.ownerId === loaded.playerForceId)?.id ?? null);
      setError(null);
    } else if (result.reason !== '没有存档') {
      setError(result.reason);
    }
    return result;
  }, [replaceGameState, storage]);

  /** 把当前进度写入指定槽位（1~32），已有存档直接覆盖 */
  const saveToSlot = useCallback(async (slot: number, options?: { note?: string; camera?: MapCamera | null }) => {
    if (isOnline()) {
      const reason = '联网模式由服务器自动保存';
      setError(reason);
      setOnlineError(reason);
      return { ok: false as const, reason };
    }
    if (!state) return { ok: false as const, reason: '尚未开始游戏' };
    try {
      const meta = buildSlotMeta(state, {
        slot,
        playSeconds: readPlaySeconds(),
        note: options?.note,
        camera: options?.camera ?? null,
      });
      await writeSlot(storage, slot, state, meta);
      setSaveRevision((value) => value + 1);
      setError(null);
      return { ok: true as const };
    } catch (saveError) {
      const reason = saveError instanceof Error ? saveError.message : '存档失败';
      setError(reason);
      return { ok: false as const, reason };
    }
  }, [isOnline, readPlaySeconds, setOnlineError, state, storage]);

  /** 读取指定槽位：整局状态与镜头一并还原 */
  const loadFromSlot = useCallback(async (slot: number) => {
    const meta = readSlotMeta(storage, slot);
    const result = await readSlotState(storage, slot);
    if (!result.ok) {
      setError(result.reason);
      return { ok: false as const, reason: result.reason };
    }
    let loaded = withoutTransientReports(result.state);
    // 旧存档兼容：遗留的AI舌战会话（招募者非玩家势力）立即自动演算结算，不弹给玩家
    const staleSession = loaded.debateSession;
    if (staleSession?.status === 'ongoing'
      && loaded.officers[staleSession.recruiterId]?.forceId !== loaded.playerForceId) {
      loaded = autoResolveDebate(loaded);
    }
    replaceGameState(loaded);
    setSelectedCityId(Object.values(loaded.cities).find((city) => city.ownerId === loaded.playerForceId)?.id ?? null);
    resetPlayClock(meta?.playSeconds ?? 0);
    // 镜头交给主地图消费：GameShell 挂载后（含从首页读档）会把它写回 StrategicMap
    setPendingCamera(meta?.camera ?? null);
    setError(null);
    return { ok: true as const, meta };
  }, [replaceGameState, resetPlayClock, storage]);

  const deleteSaveSlot = useCallback((slot: number) => {
    removeSlot(storage, slot);
    setSaveRevision((value) => value + 1);
  }, [storage]);

  const clearPendingCamera = useCallback(() => setPendingCamera(null), []);

  const issueCommand = useCallback((command: GameCommand) => {    if (isOnline()) {
      sendOnlineIntent({ type: 'issueCommand', command });
      return;
    }
    if (!state) throw new Error('尚未开始游戏');
    try {
      const next = dispatchGameIntent({ type: 'issueCommand', command });
      setError(null);
      persist('auto', next);
    } catch (commandError) {
      const message = commandError instanceof Error ? commandError.message : '命令执行失败';
      setError(message);
      throw commandError;
    }
  }, [dispatchGameIntent, isOnline, persist, sendOnlineIntent, state]);

  const dispatchLocalIntent = useCallback((intent: ActionGameIntent, afterSuccess?: () => void) => {
    try {
      const next = dispatchGameIntent(intent);
      setError(null);
      persist('auto', next);
      afterSuccess?.();
    } catch (battleError) {
      const message = battleError instanceof Error ? battleError.message : '战斗命令执行失败';
      setError(message);
      throw battleError;
    }
  }, [dispatchGameIntent, persist]);

  const dispatchIntent = useCallback((intent: ActionGameIntent, afterSuccess?: () => void) => {
    if (isOnline()) {
      sendOnlineIntent(intent, afterSuccess);
      return;
    }
    dispatchLocalIntent(intent, afterSuccess);
  }, [dispatchLocalIntent, isOnline, sendOnlineIntent]);

  const deployBattleUnit = useCallback((input: { cityId?: CityId; passId?: PassId; officerId?: string; officerIds?: string[]; targetCityId?: CityId; troopType?: TroopType; vehicle?: 'boat' | 'ship'; siegeWeapon?: 'ram' | 'tower'; destination?: GridCoord; troops: number; gold?: number; food: number }) => {
    dispatchIntent({ type: 'deployUnit', input }, () => emitAudioEvent({ type: 'unit-moved' }));
  }, [dispatchIntent, emitAudioEvent]);

  const deployBattleUnitDelegate = useCallback((input: { cityId?: CityId; passId?: PassId; officerId?: string; officerIds?: string[]; targetCityId?: CityId; troopType?: TroopType; vehicle?: 'boat' | 'ship'; siegeWeapon?: 'ram' | 'tower'; destination?: GridCoord; troops: number; gold?: number; food: number }, target: { q: number; r: number }, facility?: FacilityType) => {
    dispatchIntent({ type: 'deployUnitDelegate', input, target, facility }, () => emitAudioEvent({ type: 'unit-moved' }));
  }, [dispatchIntent, emitAudioEvent]);

  const afterDeployActionAudio = useCallback((action: DeployFollowupAction) => {
    if (action.type === 'wait') emitAudioEvent({ type: 'unit-waited' });
    if (action.type === 'attackUnit' || action.type === 'attackFacility' || action.type === 'attackPlot' || action.type === 'attackCity') emitAudioEvent({ type: 'unit-attacked' });
    if (action.type === 'useUnitTactic' && action.tacticId === 'spear-thrust') emitAudioEvent({ type: 'spear-thrust-used' });
    if (action.type === 'useUnitStrategy' && action.strategyId === 'fire') emitAudioEvent({ type: 'fire-used' });
    if (action.type === 'buildFacility' || action.type === 'repairFacility') emitAudioEvent({ type: 'project-started' });
  }, [emitAudioEvent]);

  const deployBattleUnitAction = useCallback((input: { cityId?: CityId; passId?: PassId; officerId?: string; officerIds?: string[]; targetCityId?: CityId; troopType?: TroopType; vehicle?: 'boat' | 'ship'; siegeWeapon?: 'ram' | 'tower'; destination?: GridCoord; troops: number; gold?: number; food: number }, action: DeployFollowupAction) => {
    const afterSuccess = () => afterDeployActionAudio(action);
    dispatchIntent({ type: 'deployUnitAction', input, action }, afterSuccess);
  }, [afterDeployActionAudio, dispatchIntent]);

  const deployTransport = useCallback((input: { cityId?: CityId; passId?: PassId; officerId?: string; officerIds?: string[]; destination?: GridCoord; troops: number; gold: number; food: number; armaments?: Partial<CityArmaments> }, action?: DeployFollowupAction) => {
    // 带跟随动作（落位菜单里的攻击等）与纯待命出城共用同一意图；音频按动作区分
    dispatchIntent({ type: 'deployTransportUnit', input, action }, action ? () => afterDeployActionAudio(action) : undefined);
  }, [afterDeployActionAudio, dispatchIntent]);

  const moveBattleUnit = useCallback((unitId: string, destination: { q: number; r: number }) => {
    dispatchIntent({ type: 'moveUnit', unitId, destination }, () => emitAudioEvent({ type: 'unit-moved' }));
  }, [dispatchIntent, emitAudioEvent]);

  const setMoveBattleDelegate = useCallback((unitId: string, target: { q: number; r: number }) => {
    dispatchIntent({ type: 'setMoveDelegate', unitId, target }, () => emitAudioEvent({ type: 'unit-moved' }));
  }, [dispatchIntent, emitAudioEvent]);

  const setBuildBattleDelegate = useCallback((unitId: string, target: { q: number; r: number }, facility: FacilityType) => {
    dispatchIntent({ type: 'setBuildDelegate', unitId, target, facility }, () => emitAudioEvent({ type: 'project-started' }));
  }, [dispatchIntent, emitAudioEvent]);

  const setRepairBattleDelegate = useCallback((unitId: string, facilityId: string) => {
    dispatchIntent({ type: 'setRepairDelegate', unitId, facilityId }, () => emitAudioEvent({ type: 'project-started' }));
  }, [dispatchIntent, emitAudioEvent]);

  const attackBattleUnit = useCallback((attackerId: string, targetId: string, destination?: GridCoord) => {
    dispatchIntent({ type: 'attackUnit', attackerId, targetId, destination }, () => emitAudioEvent({ type: 'unit-attacked' }));
  }, [dispatchIntent, emitAudioEvent]);

  const jointAttackBattleUnit = useCallback((attackerId: string, targetId: string, destination?: GridCoord) => {
    dispatchIntent({ type: 'jointAttackUnit', attackerId, targetId, destination }, () => emitAudioEvent({ type: 'unit-attacked' }));
  }, [dispatchIntent, emitAudioEvent]);

  const attackBattleFacility = useCallback((attackerId: string, facilityId: string, destination?: GridCoord) => {
    dispatchIntent({ type: 'attackFacility', attackerId, facilityId, destination }, () => emitAudioEvent({ type: 'unit-attacked' }));
  }, [dispatchIntent, emitAudioEvent]);

  const attackBattlePlot = useCallback((attackerId: string, cityId: CityId, plotIndex: number, destination?: GridCoord) => {
    dispatchIntent({ type: 'attackPlot', attackerId, cityId, plotIndex, destination }, () => emitAudioEvent({ type: 'unit-attacked' }));
  }, [dispatchIntent, emitAudioEvent]);

  const useBattleTactic = useCallback((attackerId: string, targetId: string, tacticId: TacticId, destination?: GridCoord) => {
    dispatchIntent({ type: 'useUnitTactic', attackerId, targetId, tacticId, destination }, () => {
      if (tacticId === 'spear-thrust') emitAudioEvent({ type: 'spear-thrust-used' });
    });
  }, [dispatchIntent, emitAudioEvent]);

  const useBattleStrategy = useCallback((unitId: string, strategyId: StrategyId, selection: StrategySelection, destination?: GridCoord) => {
    const afterSuccess = strategyId === 'fire' ? () => emitAudioEvent({ type: 'fire-used' }) : undefined;
    dispatchIntent({ type: 'useUnitStrategy', unitId, strategyId, selection, destination }, afterSuccess);
  }, [dispatchIntent, emitAudioEvent]);

  const useBattleFirePlot = useCallback((unitId: string, target: GridCoord, destination?: GridCoord) => {
    dispatchIntent({ type: 'useFirePlot', unitId, target, destination }, () => emitAudioEvent({ type: 'fire-used' }));
  }, [dispatchIntent, emitAudioEvent]);

  const buildBattleFacility = useCallback((unitId: string, facilityType: FacilityType, target: GridCoord, destination?: GridCoord) => {
    dispatchIntent({ type: 'buildFacility', unitId, facilityType, target, destination }, () => emitAudioEvent({ type: 'project-started' }));
  }, [dispatchIntent, emitAudioEvent]);

  const repairBattleFacility = useCallback((unitId: string, facilityId: string, destination?: GridCoord) => {
    dispatchIntent({ type: 'repairFacility', unitId, facilityId, destination }, () => emitAudioEvent({ type: 'project-started' }));
  }, [dispatchIntent, emitAudioEvent]);

  const supplyBattleUnit = useCallback((unitId: string, targetId: string, amount: { troops: number; gold: number; food: number; armaments?: Partial<SupplyArmament> }, destination?: GridCoord) => {
    dispatchIntent({ type: 'supplyUnit', unitId, targetId, ...amount, destination }, () => emitAudioEvent({ type: 'unit-waited' }));
  }, [dispatchIntent, emitAudioEvent]);

  const dismantleBattleFacility = useCallback((facilityId: string) => {
    dispatchIntent({ type: 'dismantleFacility', facilityId });
  }, [dispatchIntent]);

  const attackBattleCity = useCallback((attackerId: string, cityId: CityId, destination?: GridCoord) => {
    dispatchIntent({ type: 'attackCity', attackerId, cityId, destination }, () => emitAudioEvent({ type: 'unit-attacked' }));
  }, [dispatchIntent, emitAudioEvent]);

  const attackBattlePass = useCallback((attackerId: string, passId: PassId, destination?: GridCoord) => {
    dispatchIntent({ type: 'attackPass', attackerId, passId, destination }, () => emitAudioEvent({ type: 'unit-attacked' }));
  }, [dispatchIntent, emitAudioEvent]);

  const duelBattleUnit = useCallback((unitId: string, targetUnitId: string, stance: 'attack' | 'defense' | 'spirit' | 'finisher', destination?: GridCoord) => {
    dispatchIntent({ type: 'duelUnit', unitId, targetUnitId, stance, destination }, () => emitAudioEvent({ type: 'unit-attacked' }));
  }, [dispatchIntent, emitAudioEvent]);

  const playDebateRound = useCallback((cardUid: string) => {
    dispatchIntent({ type: 'debateRound', cardUid });
  }, [dispatchIntent]);

  const rethinkDebate = useCallback(() => {
    dispatchIntent({ type: 'debateRethink' });
  }, [dispatchIntent]);

  const abandonDebate = useCallback(() => {
    dispatchIntent({ type: 'debateAbandon' });
  }, [dispatchIntent]);

  const dismissDebateView = useCallback(() => {
    dispatchIntent({ type: 'debateDismiss' });
  }, [dispatchIntent]);

  const waitBattleUnit = useCallback((unitId: string) => {
    dispatchIntent({ type: 'waitUnit', unitId });
  }, [dispatchIntent]);

  const applyMapEditorMap = useCallback((map: { grid: GridCell[]; cities: EditableCityMarker[]; width?: number; height?: number; facilities?: EditorFacilityMarker[] }) => {
    if (!state) throw new Error('尚未开始游戏');
    const next = applyEditorMapToState(state, map);
    replaceGameState(next);
    setSelectedCityId(Object.values(next.cities).find((city) => city.ownerId === next.playerForceId)?.id ?? null);
    setError(null);
    persist('auto', next);
  }, [persist, replaceGameState, state]);

  const endMonth = useCallback(() => {
    if (isOnline()) {
      sendOnlineIntent({ type: 'endTenDay' });
      return;
    }
    if (!state) return;
    let next = runOpponentTurns(state);
    next = settleMonth(next);
    if (next.phase !== 'finished') settleForceTurnStart(next, next.playerForceId);
    replaceGameState(next);
    setError(null);
    persist('auto', next);
  }, [isOnline, persist, replaceGameState, sendOnlineIntent, state]);

  const endTenDay = useCallback(() => {
    if (isOnline()) {
      sendOnlineIntent({ type: 'endTenDay' });
      return;
    }
    if (!state) return;
    // 点击「进行」：统一走 turn.advanceTenDay（委任自动执行 → 对手 AI 回合 → 旬末结算），
    // 单机与联网共用同一条链路，避免两边行为分叉
    const next = advanceTenDay(state, { runAiTurns: runOpponentTurns });
    replaceGameState(next);
    setError(null);
    persist('auto', next);
  }, [isOnline, persist, replaceGameState, sendOnlineIntent, state]);

  /** 委任部队立刻行动一步：不推进回合，只跑 executeDelegations 这一步 */
  const executeDelegatedUnits = useCallback(() => {
    if (!state) return;
    if (!hasExecutableDelegation(state, state.playerForceId)) return;
    const next = runDelegatedUnits(state, state.playerForceId);
    replaceGameState(next);
    setError(null);
    persist('auto', next);
  }, [persist, replaceGameState, state]);

  const manualSave = useCallback(() => {
    if (isOnline()) {
      const message = '联网模式由服务器自动保存';
      setError(message);
      setOnlineError(message);
      return;
    }
    if (!state) return;
    persist('manual', state);
  }, [isOnline, persist, setOnlineError, state]);

  const resetGame = useCallback(() => {
    clearSaves(storage);
    replaceGameState(null);
    setSelectedCityId(null);
    setError(null);
    setPendingCamera(null);
    resetPlayClock(0);
    setSaveRevision((value) => value + 1);
  }, [replaceGameState, resetPlayClock, storage]);

  const clearSaveSlot = useCallback((slot: SaveSlot) => {
    clearSave(storage, slot);
    setSaveRevision((value) => value + 1);
  }, [storage]);

  const availability = useMemo(() => {
    const auto = loadSave(storage, 'auto');
    const manual = loadSave(storage, 'manual');
    const invalidSaves = ([['auto', auto], ['manual', manual]] as const).flatMap(([slot, result]) => (
      !result.ok && result.reason !== '没有存档' ? [{ slot, reason: result.reason }] : []
    ));
    return {
      hasAutosave: auto.ok,
      hasManualSave: manual.ok,
      invalidSaves,
    };
  }, [saveRevision, storage]);

  const saveSlots = useMemo(() => listSlotMetas(storage), [saveRevision, storage]);
  const latestSaveSlot = useMemo(() => latestSlotNumber(saveSlots), [saveSlots]);

  const value = useMemo<GameContextValue>(() => ({
    state,
    selectedCityId,
    error,
    ...availability,
    saveSlots,
    latestSaveSlot,
    pendingCamera,
    online,
    auth,
    startGame,
    registerAccount,
    loginAccount,
    logoutAccount,
    loadOnlineRooms,
    createOnlineRoom,
    joinOnlineRoom,
    resumeOnlineRoom,
    selectOnlineForce,
    startOnlineGame,
    disconnectOnline,
    loadGame,
    saveToSlot,
    loadFromSlot,
    deleteSaveSlot,
    clearPendingCamera,
    issueCommand,
    deployUnit: deployBattleUnit,
    deployUnitDelegate: deployBattleUnitDelegate,
    deployUnitAction: deployBattleUnitAction,
    deployTransportUnit: deployTransport,
    moveUnit: moveBattleUnit,
    setMoveDelegate: setMoveBattleDelegate,
    setBuildDelegate: setBuildBattleDelegate,
    setRepairDelegate: setRepairBattleDelegate,
    attackUnit: attackBattleUnit,
    jointAttackUnit: jointAttackBattleUnit,
    attackFacility: attackBattleFacility,
    attackPlot: attackBattlePlot,
    useUnitTactic: useBattleTactic,
    useUnitStrategy: useBattleStrategy,
    useFirePlot: useBattleFirePlot,
    buildFacility: buildBattleFacility,
    repairFacility: repairBattleFacility,
  supplyUnit: supplyBattleUnit,
    dismantleFacility: dismantleBattleFacility,
    attackCity: attackBattleCity,
    attackPass: attackBattlePass,
    duelUnit: duelBattleUnit,
    debateRound: playDebateRound,
    debateRethink: rethinkDebate,
    debateAbandon: abandonDebate,
    dismissDebate: dismissDebateView,
    waitUnit: waitBattleUnit,
    applyMapEditorMap,
    endMonth,
    endTenDay,
    executeDelegatedUnits,
    manualSave,
    resetGame,
    clearSave: clearSaveSlot,
    selectCity: setSelectedCityId,
    clearError: () => setError(null),
  }), [applyMapEditorMap, attackBattleCity, attackBattleFacility, attackBattlePass, attackBattlePlot, attackBattleUnit, jointAttackBattleUnit, auth, availability, buildBattleFacility, clearPendingCamera, clearSaveSlot, createOnlineRoom, deleteSaveSlot, deployBattleUnit, deployBattleUnitAction, deployBattleUnitDelegate, deployTransport, disconnectOnline, dismantleBattleFacility, dismissDebateView, duelBattleUnit, endMonth, endTenDay, executeDelegatedUnits, error, issueCommand, joinOnlineRoom, latestSaveSlot, loadFromSlot, loadGame, loadOnlineRooms, loginAccount, logoutAccount, manualSave, moveBattleUnit, online, pendingCamera, playDebateRound, registerAccount, repairBattleFacility, resetGame, resumeOnlineRoom, rethinkDebate, saveSlots, saveToSlot, selectedCityId, selectOnlineForce, setBuildBattleDelegate, setMoveBattleDelegate, setRepairBattleDelegate, startGame, startOnlineGame, state, useBattleFirePlot, useBattleStrategy, useBattleTactic, waitBattleUnit]);

  return <GameContext.Provider value={value}>{children}</GameContext.Provider>;
}

export function useGame() {
  const value = useContext(GameContext);
  if (!value) throw new Error('useGame 必须在 GameProvider 内使用');
  return value;
}
