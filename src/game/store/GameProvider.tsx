import {
  createContext,
  type PropsWithChildren,
  useCallback,
  useContext,
  useMemo,
  useReducer,
  useRef,
  useState,
} from 'react';
import { playSpearThrustSound, playTroopAttackSound, playTroopMoveSound } from '../../audio/soundEffects';
import { runAiTurn } from '../ai';
import {
  attackCity as resolveAttackCity,
  attackUnit as resolveAttackUnit,
  deployTransportUnit as resolveDeployTransportUnit,
  deployUnit as resolveDeployUnit,
  moveUnit as resolveMoveUnit,
  useUnitTactic as resolveUseUnitTactic,
  waitUnit as resolveWaitUnit,
  type TacticId,
} from '../battle/actions';
import { executeCommand } from '../commands';
import type { GameIntent } from '../network/intents';
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
import { settleMonth, settleTenDay } from '../turn';
import type { EditableCityMarker } from '../map-editor/editor';
import type { City, CityId, ForceId, GameCommand, GameState, GridCell, TroopType } from '../types';
import { createOnlineSocket, DEFAULT_ONLINE_SERVER_URL, type OnlineSocket } from '../../network/socketClient';

const AUTH_TOKEN_KEY = 'jingxiang-208-auth-token-v1';
const AUTH_SESSION_KEY = 'jingxiang-208-auth-session-v1';

export interface OnlineClientState {
  mode: 'local' | 'online';
  connecting: boolean;
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
  selectOnlineForce(forceId: ForceId): Promise<void>;
  startOnlineGame(): Promise<void>;
  disconnectOnline(): void;
  loadGame(slot: SaveSlot): LoadResult;
  issueCommand(command: GameCommand): void;
  deployUnit(input: { cityId: CityId; officerId?: string; officerIds?: string[]; targetCityId?: CityId; troopType?: TroopType; destination?: GridCoord; troops: number; food: number }): void;
  deployTransportUnit(input: { cityId: CityId; officerId: string; destination?: GridCoord; troops: number; gold: number; food: number }): void;
  moveUnit(unitId: string, destination: { q: number; r: number }): void;
  attackUnit(attackerId: string, targetId: string, destination?: GridCoord): void;
  useUnitTactic(attackerId: string, targetId: string, tacticId: TacticId, destination?: GridCoord): void;
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

  const rawSession = window.localStorage.getItem(AUTH_SESSION_KEY);
  if (rawSession) {
    try {
      const session = JSON.parse(rawSession) as Partial<AuthSessionView>;
      if (
        typeof session.token === 'string'
        && typeof session.userId === 'string'
        && typeof session.username === 'string'
      ) {
        return {
          token: session.token,
          userId: session.userId,
          username: session.username,
        };
      }
    } catch {
      window.localStorage.removeItem(AUTH_SESSION_KEY);
    }
  }

  return {
    token: window.localStorage.getItem(AUTH_TOKEN_KEY),
    userId: null,
    username: null,
  };
}

function clearStoredAuthSession() {
  if (typeof window === 'undefined') return;
  window.localStorage.removeItem(AUTH_TOKEN_KEY);
  window.localStorage.removeItem(AUTH_SESSION_KEY);
}

function isAuthExpired(reason: string) {
  return reason.includes('请先登录') || reason.includes('登录') || reason.includes('鐧诲綍');
}

function runOpponentTurns(state: GameState) {
  let next = state;
  for (const forceId of FORCE_IDS) {
    if (forceId !== state.playerForceId) next = runAiTurn(next, forceId);
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
  const onlineRef = useRef(online);
  const authRef = useRef(auth);
  onlineRef.current = online;
  authRef.current = auth;

  const applyAuthSession = useCallback((session: AuthSessionView) => {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(AUTH_TOKEN_KEY, session.token);
      window.localStorage.setItem(AUTH_SESSION_KEY, JSON.stringify(session));
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
  }, []);

  const disconnectOnline = useCallback(() => {
    socketRef.current?.disconnect();
    socketRef.current = null;
    setOnline({
      mode: 'local',
      connecting: false,
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
  }, []);

  const expireAuthSession = useCallback((message: string) => {
    clearStoredAuthSession();
    socketRef.current?.disconnect();
    socketRef.current = null;
    setAuth({ token: null, userId: null, username: null, loading: false, error: message });
    setOnline({
      mode: 'local',
      connecting: false,
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
  }, []);

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
    clearStoredAuthSession();
    setAuth({ token: null, userId: null, username: null, loading: false, error: null });
    disconnectOnline();
  }, [disconnectOnline]);

  const loadOnlineRooms = useCallback(async (input: { serverUrl?: string } = {}) => {
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
      const next = executeCommand(state, state.playerForceId, command);
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

  const deployBattleUnit = useCallback((input: { cityId: CityId; officerId?: string; officerIds?: string[]; targetCityId?: CityId; troopType?: TroopType; destination?: GridCoord; troops: number; food: number }) => {
    if (onlineRef.current.mode === 'online') {
      sendOnlineIntent({ type: 'deployUnit', input }, playTroopMoveSound);
      return;
    }
    applyBattleAction((current) => resolveDeployUnit(current, current.playerForceId, input), playTroopMoveSound);
  }, [applyBattleAction, sendOnlineIntent]);

  const deployTransport = useCallback((input: { cityId: CityId; officerId: string; destination?: GridCoord; troops: number; gold: number; food: number }) => {
    if (onlineRef.current.mode === 'online') {
      sendOnlineIntent({ type: 'deployTransportUnit', input });
      return;
    }
    applyBattleAction((current) => resolveDeployTransportUnit(current, current.playerForceId, input));
  }, [applyBattleAction, sendOnlineIntent]);

  const moveBattleUnit = useCallback((unitId: string, destination: { q: number; r: number }) => {
    if (onlineRef.current.mode === 'online') {
      sendOnlineIntent({ type: 'moveUnit', unitId, destination }, playTroopMoveSound);
      return;
    }
    applyBattleAction((current) => resolveMoveUnit(current, current.playerForceId, unitId, destination), playTroopMoveSound);
  }, [applyBattleAction, sendOnlineIntent]);

  const attackBattleUnit = useCallback((attackerId: string, targetId: string, destination?: GridCoord) => {
    if (onlineRef.current.mode === 'online') {
      sendOnlineIntent({ type: 'attackUnit', attackerId, targetId, destination }, () => {
        playTroopAttackSound();
      });
      return;
    }
    applyBattleAction((current) => {
      const attacker = current.units[attackerId];
      const needsMove = destination && attacker && (attacker.q !== destination.q || attacker.r !== destination.r);
      const moved = needsMove ? resolveMoveUnit(current, current.playerForceId, attackerId, destination) : current;
      return resolveAttackUnit(moved, moved.playerForceId, attackerId, targetId);
    }, () => {
      playTroopAttackSound();
    });
  }, [applyBattleAction, sendOnlineIntent]);

  const useBattleTactic = useCallback((attackerId: string, targetId: string, tacticId: TacticId, destination?: GridCoord) => {
    if (onlineRef.current.mode === 'online') {
      sendOnlineIntent({ type: 'useUnitTactic', attackerId, targetId, tacticId, destination }, () => {
        if (tacticId === 'spear-thrust') playSpearThrustSound();
      });
      return;
    }
    applyBattleAction((current) => {
      const attacker = current.units[attackerId];
      const needsMove = destination && attacker && (attacker.q !== destination.q || attacker.r !== destination.r);
      const moved = needsMove ? resolveMoveUnit(current, current.playerForceId, attackerId, destination) : current;
      return resolveUseUnitTactic(moved, moved.playerForceId, attackerId, targetId, tacticId);
    }, () => {
      if (tacticId === 'spear-thrust') playSpearThrustSound();
    });
  }, [applyBattleAction, sendOnlineIntent]);

  const attackBattleCity = useCallback((attackerId: string, cityId: CityId, destination?: GridCoord) => {
    if (onlineRef.current.mode === 'online') {
      sendOnlineIntent({ type: 'attackCity', attackerId, cityId, destination }, () => {
        playTroopAttackSound();
      });
      return;
    }
    applyBattleAction((current) => {
      const attacker = current.units[attackerId];
      const needsMove = destination && attacker && (attacker.q !== destination.q || attacker.r !== destination.r);
      const moved = needsMove ? resolveMoveUnit(current, current.playerForceId, attackerId, destination) : current;
      return resolveAttackCity(moved, moved.playerForceId, attackerId, cityId);
    }, () => {
      playTroopAttackSound();
    });
  }, [applyBattleAction, sendOnlineIntent]);

  const waitBattleUnit = useCallback((unitId: string) => {
    if (onlineRef.current.mode === 'online') {
      sendOnlineIntent({ type: 'waitUnit', unitId });
      return;
    }
    applyBattleAction((current) => resolveWaitUnit(current, current.playerForceId, unitId));
  }, [applyBattleAction, sendOnlineIntent]);

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
    selectOnlineForce,
    startOnlineGame,
    disconnectOnline,
    loadGame,
    issueCommand,
    deployUnit: deployBattleUnit,
    deployTransportUnit: deployTransport,
    moveUnit: moveBattleUnit,
    attackUnit: attackBattleUnit,
    useUnitTactic: useBattleTactic,
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
  }), [applyMapEditorMap, attackBattleCity, attackBattleUnit, auth, availability, clearSaveSlot, createOnlineRoom, deployBattleUnit, deployTransport, disconnectOnline, endMonth, endTenDay, error, issueCommand, joinOnlineRoom, loadGame, loadOnlineRooms, loginAccount, logoutAccount, manualSave, moveBattleUnit, online, registerAccount, resetGame, selectedCityId, selectOnlineForce, startGame, startOnlineGame, state, useBattleTactic, waitBattleUnit]);

  return <GameContext.Provider value={value}>{children}</GameContext.Provider>;
}

export function useGame() {
  const value = useContext(GameContext);
  if (!value) throw new Error('useGame 必须在 GameProvider 内使用');
  return value;
}
