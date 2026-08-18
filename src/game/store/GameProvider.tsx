import {
  createContext,
  type PropsWithChildren,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from 'react';
import { playFireEverythingSound, playSpearThrustSound, playStartProjectSound, playTroopAttackSound, playTroopMoveSound } from '../../audio/soundEffects';
import { runAiTurn } from '../ai';
import type { StrategyId, StrategySelection, TacticId } from '../battle/actions';
import type { ActionGameIntent } from '../network/intentReducer';
import type { DeployFollowupAction, GameIntent } from '../network/intents';
import type { AuthSessionView, OnlineRoomListItem, OnlineRoomView, OnlineSnapshot } from '../network/protocol';
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
import { createOnlineSocket, DEFAULT_ONLINE_SERVER_URL, type OnlineSocket } from '../../network/socketClient';
import {
  AUTH_TOKEN_KEY,
  clearStoredAuthSession as clearAuthSessionStorage,
  clearStoredLastRoom,
  readStoredAuthSession,
  readStoredLastRoom,
  writeStoredAuthSession,
  writeStoredLastRoom,
} from './authStorage';
import { applyLocalIntent } from './gameCommandDispatcher';

export interface OnlineClientState {
  mode: 'local' | 'online';
  connecting: boolean;
  resumingRoom: boolean;
  connected: boolean;
  serverUrl: string;
  roomId: string | null;
  phase: OnlineRoomView['phase'] | null;
  hostPlayerId: string | null;
  playerId: string | null;
  revision: number;
  players: OnlineRoomView['players'];
  turnPlayerIds: string[];
  activePlayerId: string | null;
  completedTurnPlayerIds: string[];
  rooms: OnlineRoomListItem[];
  tenDayReadyForceIds: ForceId[];
  error: string | null;
}

export interface AuthClientState {
  token: string | null;
  userId: string | null;
  username: string | null;
  loading: boolean;
  error: string | null;
}

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

type GameAction =
  | { type: 'start'; state: GameState }
  | { type: 'replace'; state: GameState }
  | { type: 'reset' };

function reducer(_state: GameState | null, action: GameAction): GameState | null {
  if (action.type === 'start' || action.type === 'replace') return action.state;
  return null;
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

function storedAuthSession(): Pick<AuthClientState, 'token' | 'userId' | 'username'> {
  if (typeof window === 'undefined') return { token: null, userId: null, username: null };
  const session = readStoredAuthSession(window.localStorage);
  if (session) return session;
  return {
    token: window.localStorage.getItem(AUTH_TOKEN_KEY),
    userId: null,
    username: null,
  };
}

function isAuthExpired(reason: string) {
  return reason.includes('请先登录') || reason.includes('登录') || reason.includes('鐧诲綍');
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
  const [state, dispatch] = useReducer(reducer, initialState);
  const [selectedCityId, setSelectedCityId] = useState<CityId | null>(() => (
    initialState
      ? Object.values(initialState.cities).find((city) => city.ownerId === initialState.playerForceId)?.id ?? null
      : null
  ));
  const [error, setError] = useState<string | null>(null);
  const [saveRevision, setSaveRevision] = useState(0);
  const [online, setOnline] = useState<OnlineClientState>({
    mode: 'local',
    connecting: false,
    resumingRoom: Boolean(storedAuthSession().token && readStoredLastRoom(storage)),
    connected: false,
    serverUrl: DEFAULT_ONLINE_SERVER_URL,
    roomId: null,
    phase: null,
    hostPlayerId: null,
    playerId: null,
    revision: 0,
    players: [],
    turnPlayerIds: [],
    activePlayerId: null,
    completedTurnPlayerIds: [],
    rooms: [],
    tenDayReadyForceIds: [],
    error: null,
  });
  const [auth, setAuth] = useState<AuthClientState>(() => ({
    ...storedAuthSession(),
    loading: false,
    error: null,
  }));
  const socketRef = useRef<OnlineSocket | null>(null);
  const attemptedResumeRef = useRef(false);
  const onlineRef = useRef(online);
  const authRef = useRef(auth);
  onlineRef.current = online;
  authRef.current = auth;

  const applyAuthSession = useCallback((session: AuthSessionView) => {
    if (typeof window !== 'undefined') {
      writeStoredAuthSession(window.localStorage, session);
    }
    setAuth({
      token: session.token,
      userId: session.userId,
      username: session.username,
      loading: false,
      error: null,
    });
  }, []);

  const applyOnlineSnapshot = useCallback((snapshot: OnlineSnapshot) => {
    writeStoredLastRoom(storage, {
      serverUrl: onlineRef.current.serverUrl,
      roomId: snapshot.room.id,
    });
    if (snapshot.state) {
      dispatch({ type: 'replace', state: snapshot.state });
      setSelectedCityId(Object.values(snapshot.state.cities).find((city) => city.ownerId === snapshot.state?.playerForceId)?.id ?? null);
    } else {
      dispatch({ type: 'reset' });
      setSelectedCityId(null);
    }
    setError(null);
    setOnline((current) => ({
      ...current,
      mode: 'online',
      connecting: false,
      resumingRoom: false,
      connected: true,
      roomId: snapshot.room.id,
      phase: snapshot.room.phase,
      hostPlayerId: snapshot.room.hostPlayerId,
      playerId: snapshot.playerId,
      revision: snapshot.room.revision,
      players: snapshot.room.players,
      turnPlayerIds: snapshot.room.turnPlayerIds,
      activePlayerId: snapshot.room.activePlayerId,
      completedTurnPlayerIds: snapshot.room.completedTurnPlayerIds,
      rooms: [],
      tenDayReadyForceIds: snapshot.room.tenDayReadyForceIds,
      error: null,
    }));
  }, [storage]);

  const disconnectOnline = useCallback(() => {
    const socket = socketRef.current;
    const token = authRef.current.token;
    const roomId = onlineRef.current.roomId;
    if (socket && token && roomId) {
      socket.emit('room:leave', { token, roomId }, () => undefined);
    }
    socket?.disconnect();
    socketRef.current = null;
    clearStoredLastRoom(storage);
    setOnline({
      mode: 'local',
      connecting: false,
      resumingRoom: false,
      connected: false,
      serverUrl: DEFAULT_ONLINE_SERVER_URL,
      roomId: null,
      phase: null,
      hostPlayerId: null,
      playerId: null,
      revision: 0,
      players: [],
      turnPlayerIds: [],
      activePlayerId: null,
      completedTurnPlayerIds: [],
      rooms: [],
      tenDayReadyForceIds: [],
      error: null,
    });
  }, [storage]);

  const expireAuthSession = useCallback((message: string) => {
    if (typeof window !== 'undefined') clearAuthSessionStorage(window.localStorage);
    clearStoredLastRoom(storage);
    socketRef.current?.disconnect();
    socketRef.current = null;
    setAuth({ token: null, userId: null, username: null, loading: false, error: message });
    setOnline({
      mode: 'local',
      connecting: false,
      resumingRoom: false,
      connected: false,
      serverUrl: DEFAULT_ONLINE_SERVER_URL,
      roomId: null,
      phase: null,
      hostPlayerId: null,
      playerId: null,
      revision: 0,
      players: [],
      turnPlayerIds: [],
      activePlayerId: null,
      completedTurnPlayerIds: [],
      rooms: [],
      tenDayReadyForceIds: [],
      error: message,
    });
  }, [storage]);

  const connectOnlineSocket = useCallback((serverUrl: string) => new Promise<OnlineSocket>((resolve, reject) => {
    socketRef.current?.disconnect();
    const socket = createOnlineSocket(serverUrl);
    socketRef.current = socket;
    setOnline((current) => ({ ...current, mode: 'online', connecting: true, connected: false, serverUrl, error: null }));

    const cleanup = () => {
      socket.off('connect', onConnect);
      socket.off('connect_error', onConnectError);
    };
    const onConnect = () => {
      cleanup();
      setOnline((current) => ({ ...current, connecting: false, connected: true, error: null }));
      resolve(socket);
    };
    const onConnectError = (connectError: Error) => {
      cleanup();
      socket.disconnect();
      setOnline((current) => ({ ...current, connecting: false, connected: false, error: connectError.message }));
      reject(connectError);
    };

    socket.on('connect', onConnect);
    socket.on('connect_error', onConnectError);
    socket.on('disconnect', () => {
      setOnline((current) => current.mode === 'online' ? { ...current, connected: false } : current);
    });
    socket.on('room:list:update', (update) => {
      setOnline((current) => ({
        ...current,
        mode: 'online',
        rooms: update.rooms,
        error: null,
      }));
    });
    socket.on('room:update', applyOnlineSnapshot);
    socket.connect();
  }), [applyOnlineSnapshot]);

  useEffect(() => {
    const token = auth.token;
    if (!token || attemptedResumeRef.current) return;
    attemptedResumeRef.current = true;
    const lastRoom = readStoredLastRoom(storage);
    if (!lastRoom) return;

    void (async () => {
      try {
        setOnline((current) => ({
          ...current,
          mode: 'online',
          connecting: true,
          resumingRoom: true,
          serverUrl: lastRoom.serverUrl,
          error: null,
        }));
        const socket = await connectOnlineSocket(lastRoom.serverUrl);
        await new Promise<void>((resolve, reject) => {
          socket.emit('auth:session', { token }, (response) => {
            if (!response.ok) {
              expireAuthSession(response.reason);
              reject(new Error(response.reason));
              return;
            }
            applyAuthSession(response.session);
            resolve();
          });
        });
        await new Promise<void>((resolve, reject) => {
          socket.emit('room:resume', { token, roomId: lastRoom.roomId }, (response) => {
            if (!response.ok) {
              setOnline((current) => ({ ...current, error: response.reason }));
              reject(new Error(response.reason));
              return;
            }
            applyOnlineSnapshot(response.snapshot);
            resolve();
          });
        });
      } catch {
        setOnline((current) => ({ ...current, connecting: false, resumingRoom: false }));
      }
    })();
  }, [applyAuthSession, applyOnlineSnapshot, auth.token, connectOnlineSocket, expireAuthSession, storage]);

  const registerAccount = useCallback(async (input: { username: string; password: string; serverUrl?: string }) => {
    setAuth((current) => ({ ...current, loading: true, error: null }));
    try {
      const socket = await connectOnlineSocket(input.serverUrl ?? onlineRef.current.serverUrl);
      await new Promise<void>((resolve, reject) => {
        socket.emit('auth:register', { username: input.username, password: input.password }, (response) => {
          if (!response.ok) {
            setAuth((current) => ({ ...current, loading: false, error: response.reason }));
            reject(new Error(response.reason));
            return;
          }
          applyAuthSession(response.session);
          resolve();
        });
      });
    } catch (authError) {
      const message = authError instanceof Error ? authError.message : '注册失败';
      setAuth((current) => ({ ...current, loading: false, error: message }));
      throw authError;
    }
  }, [applyAuthSession, connectOnlineSocket]);

  const loginAccount = useCallback(async (input: { username: string; password: string; serverUrl?: string }) => {
    setAuth((current) => ({ ...current, loading: true, error: null }));
    try {
      const socket = await connectOnlineSocket(input.serverUrl ?? onlineRef.current.serverUrl);
      await new Promise<void>((resolve, reject) => {
        socket.emit('auth:login', { username: input.username, password: input.password }, (response) => {
          if (!response.ok) {
            setAuth((current) => ({ ...current, loading: false, error: response.reason }));
            reject(new Error(response.reason));
            return;
          }
          applyAuthSession(response.session);
          resolve();
        });
      });
    } catch (authError) {
      const message = authError instanceof Error ? authError.message : '登录失败';
      setAuth((current) => ({ ...current, loading: false, error: message }));
      throw authError;
    }
  }, [applyAuthSession, connectOnlineSocket]);

  const logoutAccount = useCallback(() => {
    const token = authRef.current.token;
    if (token) socketRef.current?.emit('auth:logout', { token }, () => undefined);
    if (typeof window !== 'undefined') clearAuthSessionStorage(window.localStorage);
    setAuth({ token: null, userId: null, username: null, loading: false, error: null });
    disconnectOnline();
  }, [disconnectOnline]);

  const loadOnlineRooms = useCallback(async (input: { serverUrl?: string } = {}) => {
    if (onlineRef.current.resumingRoom) return;
    const token = authRef.current.token;
    if (!token) {
      const message = '请先登录';
      setAuth((current) => ({ ...current, error: message }));
      throw new Error(message);
    }
    const socket = await connectOnlineSocket(input.serverUrl ?? onlineRef.current.serverUrl);
    await new Promise<void>((resolve, reject) => {
      socket.emit('room:list', { token }, (response) => {
        if (!response.ok) {
          if (isAuthExpired(response.reason)) expireAuthSession(response.reason);
          setOnline((current) => ({ ...current, connecting: false, error: response.reason }));
          reject(new Error(response.reason));
          return;
        }
        setOnline((current) => ({
          ...current,
          mode: 'online',
          connecting: false,
          connected: true,
          rooms: response.rooms,
          error: null,
        }));
        resolve();
      });
    });
  }, [connectOnlineSocket, expireAuthSession]);

  const createOnlineRoom = useCallback(async (input: { serverUrl?: string; seed?: number }) => {
    const token = authRef.current.token;
    if (!token) {
      const message = '请先登录';
      setAuth((current) => ({ ...current, error: message }));
      throw new Error(message);
    }
    const socket = await connectOnlineSocket(input.serverUrl ?? onlineRef.current.serverUrl);
    await new Promise<void>((resolve, reject) => {
      socket.emit('room:create', { token, seed: input.seed }, (response) => {
        if (!response.ok) {
          if (isAuthExpired(response.reason)) expireAuthSession(response.reason);
          setOnline((current) => ({ ...current, connecting: false, error: response.reason }));
          reject(new Error(response.reason));
          return;
        }
        applyOnlineSnapshot(response.snapshot);
        resolve();
      });
    });
  }, [applyOnlineSnapshot, connectOnlineSocket, expireAuthSession]);

  const joinOnlineRoom = useCallback(async (input: { roomId: string; serverUrl?: string }) => {
    const token = authRef.current.token;
    if (!token) {
      const message = '请先登录';
      setAuth((current) => ({ ...current, error: message }));
      throw new Error(message);
    }
    const socket = await connectOnlineSocket(input.serverUrl ?? onlineRef.current.serverUrl);
    await new Promise<void>((resolve, reject) => {
      socket.emit('room:join', {
        token,
        roomId: input.roomId.trim().toUpperCase(),
      }, (response) => {
        if (!response.ok) {
          if (isAuthExpired(response.reason)) expireAuthSession(response.reason);
          setOnline((current) => ({ ...current, connecting: false, error: response.reason }));
          reject(new Error(response.reason));
          return;
        }
        applyOnlineSnapshot(response.snapshot);
        resolve();
      });
    });
  }, [applyOnlineSnapshot, connectOnlineSocket, expireAuthSession]);

  const resumeOnlineRoom = useCallback(async (input: { serverUrl?: string; roomId?: string } = {}) => {
    const token = authRef.current.token;
    if (!token) {
      const message = '请先登录';
      setAuth((current) => ({ ...current, error: message }));
      throw new Error(message);
    }
    setOnline((current) => ({ ...current, resumingRoom: true }));
    try {
      const socket = await connectOnlineSocket(input.serverUrl ?? onlineRef.current.serverUrl);
      await new Promise<void>((resolve, reject) => {
        socket.emit('room:resume', {
          token,
          ...(input.roomId ? { roomId: input.roomId.trim().toUpperCase() } : {}),
        }, (response) => {
          if (!response.ok) {
            if (isAuthExpired(response.reason)) expireAuthSession(response.reason);
            setOnline((current) => ({ ...current, connecting: false, resumingRoom: false, error: response.reason }));
            reject(new Error(response.reason));
            return;
          }
          applyOnlineSnapshot(response.snapshot);
          resolve();
        });
      });
    } catch (resumeError) {
      setOnline((current) => ({ ...current, connecting: false, resumingRoom: false }));
      throw resumeError;
    }
  }, [applyOnlineSnapshot, connectOnlineSocket, expireAuthSession]);

  const selectOnlineForce = useCallback(async (forceId: ForceId) => {
    const socket = socketRef.current;
    const current = onlineRef.current;
    const token = authRef.current.token;
    if (!socket || !current.roomId || !token) {
      const message = '尚未连接联网房间';
      setOnline((value) => ({ ...value, error: message }));
      throw new Error(message);
    }
    const roomId = current.roomId;
    await new Promise<void>((resolve, reject) => {
      socket.emit('room:selectForce', {
        token,
        roomId,
        forceId,
      }, (response) => {
        if (!response.ok) {
          if (isAuthExpired(response.reason)) expireAuthSession(response.reason);
          setOnline((value) => ({ ...value, error: response.reason }));
          reject(new Error(response.reason));
          return;
        }
        applyOnlineSnapshot(response.snapshot);
        resolve();
      });
    });
  }, [applyOnlineSnapshot, expireAuthSession]);

  const startOnlineGame = useCallback(async () => {
    const socket = socketRef.current;
    const current = onlineRef.current;
    const token = authRef.current.token;
    if (!socket || !current.roomId || !token) {
      const message = '尚未连接联网房间';
      setOnline((value) => ({ ...value, error: message }));
      throw new Error(message);
    }
    const roomId = current.roomId;
    await new Promise<void>((resolve, reject) => {
      socket.emit('room:startGame', {
        token,
        roomId,
      }, (response) => {
        if (!response.ok) {
          if (isAuthExpired(response.reason)) expireAuthSession(response.reason);
          setOnline((value) => ({ ...value, error: response.reason }));
          reject(new Error(response.reason));
          return;
        }
        applyOnlineSnapshot(response.snapshot);
        resolve();
      });
    });
  }, [applyOnlineSnapshot, expireAuthSession]);

  const sendOnlineIntent = useCallback((intent: GameIntent, afterSuccess?: () => void) => {
    const socket = socketRef.current;
    const current = onlineRef.current;
    const token = authRef.current.token;
    if (!socket || !current.roomId || !current.playerId || !token) {
      setOnline((value) => ({ ...value, error: '尚未连接联网房间' }));
      return;
    }
    socket.emit('game:intent', {
      roomId: current.roomId,
      token,
      requestId: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      baseRevision: current.revision,
      intent,
    }, (response) => {
      if (response.ok) {
        if (response.snapshot) applyOnlineSnapshot(response.snapshot);
        afterSuccess?.();
        return;
      }
      if (response.snapshot) applyOnlineSnapshot(response.snapshot);
      setOnline((value) => ({ ...value, error: response.reason }));
      setError(response.reason);
    });
  }, [applyOnlineSnapshot]);

  const persist = useCallback((slot: SaveSlot, next: GameState) => {
    writeSave(storage, slot, next);
    setSaveRevision((value) => value + 1);
  }, [storage]);

  const startGame = useCallback((forceId: ForceId, seed = Date.now()) => {
    disconnectOnline();
    const next = createGame(forceId, seed);
    dispatch({ type: 'start', state: next });
    setSelectedCityId(Object.values(next.cities).find((city) => city.ownerId === forceId)?.id ?? null);
    setError(null);
    persist('auto', next);
  }, [disconnectOnline, persist]);

  const loadGame = useCallback((slot: SaveSlot) => {
    const result = loadSave(storage, slot);
    if (result.ok) {
      dispatch({ type: 'replace', state: result.state });
      setSelectedCityId(Object.values(result.state.cities).find((city) => city.ownerId === result.state.playerForceId)?.id ?? null);
      setError(null);
    } else if (result.reason !== '没有存档') {
      setError(result.reason);
    }
    return result;
  }, [storage]);

  const issueCommand = useCallback((command: GameCommand) => {
    if (onlineRef.current.mode === 'online') {
      sendOnlineIntent({ type: 'issueCommand', command });
      return;
    }
    if (!state) throw new Error('尚未开始游戏');
    try {
      const next = applyLocalIntent(state, { type: 'issueCommand', command });
      dispatch({ type: 'replace', state: next });
      setError(null);
      persist('auto', next);
    } catch (commandError) {
      const message = commandError instanceof Error ? commandError.message : '命令执行失败';
      setError(message);
      throw commandError;
    }
  }, [persist, sendOnlineIntent, state]);

  const applyBattleAction = useCallback((action: (current: GameState) => GameState, afterSuccess?: () => void) => {
    if (!state) throw new Error('尚未开始游戏');
    try {
      const next = action(state);
      dispatch({ type: 'replace', state: next });
      setError(null);
      persist('auto', next);
      afterSuccess?.();
    } catch (battleError) {
      const message = battleError instanceof Error ? battleError.message : '战斗命令执行失败';
      setError(message);
      throw battleError;
    }
  }, [persist, state]);

  const dispatchIntent = useCallback((intent: ActionGameIntent, afterSuccess?: () => void) => {
    if (onlineRef.current.mode === 'online') {
      sendOnlineIntent(intent, afterSuccess);
      return;
    }
    applyBattleAction((current) => applyLocalIntent(current, intent), afterSuccess);
  }, [applyBattleAction, sendOnlineIntent]);

  const deployBattleUnit = useCallback((input: { cityId: CityId; officerId?: string; officerIds?: string[]; targetCityId?: CityId; troopType?: TroopType; destination?: GridCoord; troops: number; gold?: number; food: number }) => {
    dispatchIntent({ type: 'deployUnit', input }, playTroopMoveSound);
  }, [dispatchIntent]);

  const afterDeployActionSound = useCallback((action: DeployFollowupAction) => {
    if (action.type === 'wait') playTroopMoveSound();
    if (action.type === 'attackUnit' || action.type === 'attackFacility' || action.type === 'attackCity') playTroopAttackSound();
    if (action.type === 'useUnitTactic' && action.tacticId === 'spear-thrust') playSpearThrustSound();
    if (action.type === 'useUnitStrategy' && action.strategyId === 'fire') playFireEverythingSound();
    if (action.type === 'buildFacility' || action.type === 'repairFacility') playStartProjectSound();
  }, []);

  const deployBattleUnitAction = useCallback((input: { cityId: CityId; officerId?: string; officerIds?: string[]; targetCityId?: CityId; troopType?: TroopType; destination?: GridCoord; troops: number; gold?: number; food: number }, action: DeployFollowupAction) => {
    const afterSuccess = () => afterDeployActionSound(action);
    dispatchIntent({ type: 'deployUnitAction', input, action }, afterSuccess);
  }, [afterDeployActionSound, dispatchIntent]);

  const deployTransport = useCallback((input: { cityId: CityId; officerId: string; destination?: GridCoord; troops: number; gold: number; food: number }) => {
    dispatchIntent({ type: 'deployTransportUnit', input });
  }, [dispatchIntent]);

  const moveBattleUnit = useCallback((unitId: string, destination: { q: number; r: number }) => {
    dispatchIntent({ type: 'moveUnit', unitId, destination }, playTroopMoveSound);
  }, [dispatchIntent]);

  const attackBattleUnit = useCallback((attackerId: string, targetId: string, destination?: GridCoord) => {
    dispatchIntent({ type: 'attackUnit', attackerId, targetId, destination }, () => {
      playTroopAttackSound();
    });
  }, [dispatchIntent]);

  const attackBattleFacility = useCallback((attackerId: string, facilityId: string, destination?: GridCoord) => {
    dispatchIntent({ type: 'attackFacility', attackerId, facilityId, destination }, () => {
      playTroopAttackSound();
    });
  }, [dispatchIntent]);

  const useBattleTactic = useCallback((attackerId: string, targetId: string, tacticId: TacticId, destination?: GridCoord) => {
    dispatchIntent({ type: 'useUnitTactic', attackerId, targetId, tacticId, destination }, () => {
      if (tacticId === 'spear-thrust') playSpearThrustSound();
    });
  }, [dispatchIntent]);

  const useBattleStrategy = useCallback((unitId: string, strategyId: StrategyId, selection: StrategySelection, destination?: GridCoord) => {
    const afterSuccess = strategyId === 'fire' ? playFireEverythingSound : undefined;
    dispatchIntent({ type: 'useUnitStrategy', unitId, strategyId, selection, destination }, afterSuccess);
  }, [dispatchIntent]);

  const useBattleFirePlot = useCallback((unitId: string, target: GridCoord, destination?: GridCoord) => {
    dispatchIntent({ type: 'useFirePlot', unitId, target, destination }, playFireEverythingSound);
  }, [dispatchIntent]);

  const buildBattleFacility = useCallback((unitId: string, facilityType: FacilityType, target: GridCoord, destination?: GridCoord) => {
    dispatchIntent({ type: 'buildFacility', unitId, facilityType, target, destination }, playStartProjectSound);
  }, [dispatchIntent]);

  const repairBattleFacility = useCallback((unitId: string, facilityId: string, destination?: GridCoord) => {
    dispatchIntent({ type: 'repairFacility', unitId, facilityId, destination }, playStartProjectSound);
  }, [dispatchIntent]);

  const dismantleBattleFacility = useCallback((facilityId: string) => {
    dispatchIntent({ type: 'dismantleFacility', facilityId });
  }, [dispatchIntent]);

  const attackBattleCity = useCallback((attackerId: string, cityId: CityId, destination?: GridCoord) => {
    dispatchIntent({ type: 'attackCity', attackerId, cityId, destination }, () => {
      playTroopAttackSound();
    });
  }, [dispatchIntent]);

  const waitBattleUnit = useCallback((unitId: string) => {
    dispatchIntent({ type: 'waitUnit', unitId });
  }, [dispatchIntent]);

  const applyMapEditorMap = useCallback((map: { grid: GridCell[]; cities: EditableCityMarker[] }) => {
    if (!state) throw new Error('尚未开始游戏');
    const next = applyEditorMapToState(state, map);
    dispatch({ type: 'replace', state: next });
    setSelectedCityId(Object.values(next.cities).find((city) => city.ownerId === next.playerForceId)?.id ?? null);
    setError(null);
    persist('auto', next);
  }, [persist, state]);

  const endMonth = useCallback(() => {
    if (onlineRef.current.mode === 'online') {
      sendOnlineIntent({ type: 'endTenDay' });
      return;
    }
    if (!state) return;
    let next = runOpponentTurns(state);
    next = settleMonth(next);
    dispatch({ type: 'replace', state: next });
    setError(null);
    persist('auto', next);
  }, [persist, sendOnlineIntent, state]);

  const endTenDay = useCallback(() => {
    if (onlineRef.current.mode === 'online') {
      sendOnlineIntent({ type: 'endTenDay' });
      return;
    }
    if (!state) return;
    const next = settleTenDay(runOpponentTurns(state));
    dispatch({ type: 'replace', state: next });
    setError(null);
    persist('auto', next);
  }, [persist, sendOnlineIntent, state]);

  const manualSave = useCallback(() => {
    if (onlineRef.current.mode === 'online') {
      const message = '联网模式由服务器自动保存';
      setError(message);
      setOnline((current) => ({ ...current, error: message }));
      return;
    }
    if (!state) return;
    persist('manual', state);
  }, [persist, state]);

  const resetGame = useCallback(() => {
    clearSaves(storage);
    dispatch({ type: 'reset' });
    setSelectedCityId(null);
    setError(null);
    setSaveRevision((value) => value + 1);
  }, [storage]);

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
