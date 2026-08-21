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
import type { StrategyId, StrategySelection, TacticId } from '../battle/actions';
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
import type { GridCoord } from '../battle/grid';
import { createGame, FORCE_IDS } from '../scenario/jingxiang208';
import { settleForceTurnStart } from '../skills/rules/turn';
import { settleMonth, settleTenDay } from '../turn';
import type { EditableCityMarker } from '../map-editor/editor';
import type { City, CityId, FacilityType, ForceId, GameCommand, GameState, GridCell, TroopType } from '../types';
import { createGameEngine, type GameEngine } from '../engine';
import {
  type AuthClientState,
  type OnlineClientState,
} from './onlineState';
import { useOnlineSession } from './onlineSession';
import { useAudioEventAdapter } from '../../audio/reactAudioEventAdapter';

interface GameContextValue {
  state: GameState | null;
  selectedCityId: CityId | null;
  error: string | null;
  hasAutosave: boolean;
  hasManualSave: boolean;
  invalidSaves: Array<{ slot: SaveSlot; reason: string }>;
  online: OnlineClientState;
  auth: AuthClientState;
  startGame(forceId: ForceId, seed?: number): void;
  registerAccount(input: { username: string; password: string; serverUrl?: string }): Promise<void>;
  loginAccount(input: { username: string; password: string; serverUrl?: string }): Promise<void>;
  logoutAccount(): void;
  loadOnlineRooms(input?: { serverUrl?: string }): Promise<void>;
  createOnlineRoom(input: { serverUrl?: string; seed?: number }): Promise<void>;
  joinOnlineRoom(input: { roomId: string; serverUrl?: string }): Promise<void>;
  resumeOnlineRoom(input?: { serverUrl?: string; roomId?: string }): Promise<void>;
  selectOnlineForce(forceId: ForceId): Promise<void>;
  startOnlineGame(): Promise<void>;
  disconnectOnline(): void;
  loadGame(slot: SaveSlot): LoadResult;
  issueCommand(command: GameCommand): void;
  deployUnit(input: { cityId: CityId; officerId?: string; officerIds?: string[]; targetCityId?: CityId; troopType?: TroopType; destination?: GridCoord; troops: number; gold?: number; food: number }): void;
  deployUnitAction(input: { cityId: CityId; officerId?: string; officerIds?: string[]; targetCityId?: CityId; troopType?: TroopType; destination?: GridCoord; troops: number; gold?: number; food: number }, action: DeployFollowupAction): void;
  deployTransportUnit(input: { cityId: CityId; officerId: string; destination?: GridCoord; troops: number; gold: number; food: number }): void;
  moveUnit(unitId: string, destination: { q: number; r: number }): void;
  attackUnit(attackerId: string, targetId: string, destination?: GridCoord): void;
  attackFacility(attackerId: string, facilityId: string, destination?: GridCoord): void;
  useUnitTactic(attackerId: string, targetId: string, tacticId: TacticId, destination?: GridCoord): void;
  useUnitStrategy(unitId: string, strategyId: StrategyId, selection: StrategySelection, destination?: GridCoord): void;
  useFirePlot(unitId: string, target: GridCoord, destination?: GridCoord): void;
  buildFacility(unitId: string, facilityType: FacilityType, target: GridCoord, destination?: GridCoord): void;
  repairFacility(unitId: string, facilityId: string, destination?: GridCoord): void;
  dismantleFacility(facilityId: string): void;
  attackCity(attackerId: string, cityId: CityId, destination?: GridCoord): void;
  waitUnit(unitId: string): void;
  applyMapEditorMap(map: { grid: GridCell[]; cities: EditableCityMarker[] }): void;
  endMonth(): void;
  endTenDay(): void;
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
  for (const forceId of FORCE_IDS) {
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

function applyEditorMapToState(state: GameState, map: { grid: GridCell[]; cities: EditableCityMarker[] }): GameState {
  const markersById = new Map(map.cities.map((city) => [city.id, city]));
  const cities = Object.fromEntries(Object.entries(state.cities).map(([id, city]) => {
    const marker = markersById.get(id);
    return [id, marker ? { ...city, gridQ: marker.q, gridR: marker.r } : { ...city }];
  })) as Record<CityId, City>;

  return {
    ...state,
    cities,
    grid: map.grid.map((cell) => ({ ...cell })),
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
  const { emit: emitAudioEvent } = useAudioEventAdapter();

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

  const startGame = useCallback((forceId: ForceId, seed = Date.now()) => {
    disconnectOnline();
    const next = createGame(forceId, seed);
    replaceGameState(next);
    setSelectedCityId(Object.values(next.cities).find((city) => city.ownerId === forceId)?.id ?? null);
    setError(null);
    persist('auto', next);
  }, [disconnectOnline, persist, replaceGameState]);

  const loadGame = useCallback((slot: SaveSlot) => {
    const result = loadSave(storage, slot);
    if (result.ok) {
      replaceGameState(result.state);
      setSelectedCityId(Object.values(result.state.cities).find((city) => city.ownerId === result.state.playerForceId)?.id ?? null);
      setError(null);
    } else if (result.reason !== '没有存档') {
      setError(result.reason);
    }
    return result;
  }, [replaceGameState, storage]);

  const issueCommand = useCallback((command: GameCommand) => {
    if (isOnline()) {
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

  const deployBattleUnit = useCallback((input: { cityId: CityId; officerId?: string; officerIds?: string[]; targetCityId?: CityId; troopType?: TroopType; destination?: GridCoord; troops: number; gold?: number; food: number }) => {
    dispatchIntent({ type: 'deployUnit', input }, () => emitAudioEvent({ type: 'unit-moved' }));
  }, [dispatchIntent, emitAudioEvent]);

  const afterDeployActionAudio = useCallback((action: DeployFollowupAction) => {
    if (action.type === 'wait') emitAudioEvent({ type: 'unit-waited' });
    if (action.type === 'attackUnit' || action.type === 'attackFacility' || action.type === 'attackCity') emitAudioEvent({ type: 'unit-attacked' });
    if (action.type === 'useUnitTactic' && action.tacticId === 'spear-thrust') emitAudioEvent({ type: 'spear-thrust-used' });
    if (action.type === 'useUnitStrategy' && action.strategyId === 'fire') emitAudioEvent({ type: 'fire-used' });
    if (action.type === 'buildFacility' || action.type === 'repairFacility') emitAudioEvent({ type: 'project-started' });
  }, [emitAudioEvent]);

  const deployBattleUnitAction = useCallback((input: { cityId: CityId; officerId?: string; officerIds?: string[]; targetCityId?: CityId; troopType?: TroopType; destination?: GridCoord; troops: number; gold?: number; food: number }, action: DeployFollowupAction) => {
    const afterSuccess = () => afterDeployActionAudio(action);
    dispatchIntent({ type: 'deployUnitAction', input, action }, afterSuccess);
  }, [afterDeployActionAudio, dispatchIntent]);

  const deployTransport = useCallback((input: { cityId: CityId; officerId: string; destination?: GridCoord; troops: number; gold: number; food: number }) => {
    dispatchIntent({ type: 'deployTransportUnit', input });
  }, [dispatchIntent]);

  const moveBattleUnit = useCallback((unitId: string, destination: { q: number; r: number }) => {
    dispatchIntent({ type: 'moveUnit', unitId, destination }, () => emitAudioEvent({ type: 'unit-moved' }));
  }, [dispatchIntent, emitAudioEvent]);

  const attackBattleUnit = useCallback((attackerId: string, targetId: string, destination?: GridCoord) => {
    dispatchIntent({ type: 'attackUnit', attackerId, targetId, destination }, () => emitAudioEvent({ type: 'unit-attacked' }));
  }, [dispatchIntent, emitAudioEvent]);

  const attackBattleFacility = useCallback((attackerId: string, facilityId: string, destination?: GridCoord) => {
    dispatchIntent({ type: 'attackFacility', attackerId, facilityId, destination }, () => emitAudioEvent({ type: 'unit-attacked' }));
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

  const dismantleBattleFacility = useCallback((facilityId: string) => {
    dispatchIntent({ type: 'dismantleFacility', facilityId });
  }, [dispatchIntent]);

  const attackBattleCity = useCallback((attackerId: string, cityId: CityId, destination?: GridCoord) => {
    dispatchIntent({ type: 'attackCity', attackerId, cityId, destination }, () => emitAudioEvent({ type: 'unit-attacked' }));
  }, [dispatchIntent, emitAudioEvent]);

  const waitBattleUnit = useCallback((unitId: string) => {
    dispatchIntent({ type: 'waitUnit', unitId });
  }, [dispatchIntent]);

  const applyMapEditorMap = useCallback((map: { grid: GridCell[]; cities: EditableCityMarker[] }) => {
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
    const next = settleTenDay(runOpponentTurns(state));
    replaceGameState(next);
    setError(null);
    persist('auto', next);
  }, [isOnline, persist, replaceGameState, sendOnlineIntent, state]);

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
    setSaveRevision((value) => value + 1);
  }, [replaceGameState, storage]);

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

  const value = useMemo<GameContextValue>(() => ({
    state,
    selectedCityId,
    error,
    ...availability,
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
    issueCommand,
    deployUnit: deployBattleUnit,
    deployUnitAction: deployBattleUnitAction,
    deployTransportUnit: deployTransport,
    moveUnit: moveBattleUnit,
    attackUnit: attackBattleUnit,
    attackFacility: attackBattleFacility,
    useUnitTactic: useBattleTactic,
    useUnitStrategy: useBattleStrategy,
    useFirePlot: useBattleFirePlot,
    buildFacility: buildBattleFacility,
    repairFacility: repairBattleFacility,
    dismantleFacility: dismantleBattleFacility,
    attackCity: attackBattleCity,
    waitUnit: waitBattleUnit,
    applyMapEditorMap,
    endMonth,
    endTenDay,
    manualSave,
    resetGame,
    clearSave: clearSaveSlot,
    selectCity: setSelectedCityId,
    clearError: () => setError(null),
  }), [applyMapEditorMap, attackBattleCity, attackBattleFacility, attackBattleUnit, auth, availability, buildBattleFacility, clearSaveSlot, createOnlineRoom, deployBattleUnit, deployBattleUnitAction, deployTransport, disconnectOnline, dismantleBattleFacility, endMonth, endTenDay, error, issueCommand, joinOnlineRoom, loadGame, loadOnlineRooms, loginAccount, logoutAccount, manualSave, moveBattleUnit, online, registerAccount, repairBattleFacility, resetGame, resumeOnlineRoom, selectedCityId, selectOnlineForce, startGame, startOnlineGame, state, useBattleFirePlot, useBattleStrategy, useBattleTactic, waitBattleUnit]);

  return <GameContext.Provider value={value}>{children}</GameContext.Provider>;
}

export function useGame() {
  const value = useContext(GameContext);
  if (!value) throw new Error('useGame 必须在 GameProvider 内使用');
  return value;
}
