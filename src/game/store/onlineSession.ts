import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { createOnlineSocket, DEFAULT_ONLINE_SERVER_URL, type OnlineSocket } from '../../network/socketClient';
import type { AuthSessionView, OnlineSnapshot } from '../network/protocol';
import type { GameIntent } from '../network/intents';
import type { ForceId, GameState } from '../types';
import type { SaveAdapter } from '../persistence';
import {
  AUTH_TOKEN_KEY,
  clearStoredAuthSession,
  clearStoredLastRoom,
  readStoredAuthSession,
  readStoredLastRoom,
  writeStoredAuthSession,
  writeStoredLastRoom,
} from './authStorage';
import {
  createAuthenticatedAuthState,
  createOfflineOnlineState,
  createOnlineClientState,
  createUnauthenticatedAuthState,
  type AuthClientState,
  type OnlineClientState,
} from './onlineState';

interface UseOnlineSessionOptions {
  storage: SaveAdapter;
  applySnapshotState: (state: GameState | null) => void;
  setError: Dispatch<SetStateAction<string | null>>;
}

function authStorage(fallback: SaveAdapter): SaveAdapter {
  return typeof window !== 'undefined' ? window.localStorage : fallback;
}

function storedAuthSession(storage: SaveAdapter): Pick<AuthClientState, 'token' | 'userId' | 'username'> {
  const session = readStoredAuthSession(authStorage(storage));
  if (session) return session;
  return {
    token: authStorage(storage).getItem(AUTH_TOKEN_KEY),
    userId: null,
    username: null,
  };
}

function isAuthExpired(reason: string) {
  return reason.includes('请先登录') || reason.includes('登录') || reason.includes('鐧诲綍');
}

export function useOnlineSession({ storage, applySnapshotState, setError }: UseOnlineSessionOptions) {
  const savedAuth = storedAuthSession(storage);
  const [online, setOnline] = useState<OnlineClientState>(() => createOnlineClientState({
    resumingRoom: Boolean(savedAuth.token && readStoredLastRoom(storage)),
  }));
  const [auth, setAuth] = useState<AuthClientState>(() => (
    savedAuth.token && savedAuth.userId && savedAuth.username
      ? createAuthenticatedAuthState(savedAuth as AuthSessionView)
      : createUnauthenticatedAuthState()
  ));
  const socketRef = useRef<OnlineSocket | null>(null);
  const attemptedResumeRef = useRef(false);
  const onlineRef = useRef(online);
  const authRef = useRef(auth);
  onlineRef.current = online;
  authRef.current = auth;

  const applyAuthSession = useCallback((session: AuthSessionView) => {
    writeStoredAuthSession(authStorage(storage), session);
    setAuth(createAuthenticatedAuthState(session));
  }, [storage]);

  const applyOnlineSnapshot = useCallback((snapshot: OnlineSnapshot) => {
    writeStoredLastRoom(storage, {
      serverUrl: onlineRef.current.serverUrl,
      roomId: snapshot.room.id,
    });
    applySnapshotState(snapshot.state);
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
  }, [applySnapshotState, setError, storage]);

  const disconnectOnline = useCallback(() => {
    const socket = socketRef.current;
    const token = authRef.current.token;
    const roomId = onlineRef.current.roomId;
    if (socket && token && roomId) socket.emit('room:leave', { token, roomId }, () => undefined);
    socket?.disconnect();
    socketRef.current = null;
    clearStoredLastRoom(storage);
    setOnline(createOfflineOnlineState());
  }, [storage]);

  const expireAuthSession = useCallback((message: string) => {
    clearStoredAuthSession(authStorage(storage));
    clearStoredLastRoom(storage);
    socketRef.current?.disconnect();
    socketRef.current = null;
    setAuth(createUnauthenticatedAuthState(message));
    setOnline({ ...createOfflineOnlineState(), error: message });
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
      setOnline((current) => ({ ...current, mode: 'online', rooms: update.rooms, error: null }));
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
        setOnline((current) => ({ ...current, mode: 'online', connecting: true, resumingRoom: true, serverUrl: lastRoom.serverUrl, error: null }));
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
    clearStoredAuthSession(authStorage(storage));
    setAuth(createUnauthenticatedAuthState());
    disconnectOnline();
  }, [disconnectOnline, storage]);

  const requireToken = useCallback(() => {
    const token = authRef.current.token;
    if (token) return token;
    const message = '请先登录';
    setAuth((current) => ({ ...current, error: message }));
    throw new Error(message);
  }, []);

  const loadOnlineRooms = useCallback(async (input: { serverUrl?: string } = {}) => {
    if (onlineRef.current.resumingRoom) return;
    const token = requireToken();
    const socket = await connectOnlineSocket(input.serverUrl ?? onlineRef.current.serverUrl);
    await new Promise<void>((resolve, reject) => {
      socket.emit('room:list', { token }, (response) => {
        if (!response.ok) {
          if (isAuthExpired(response.reason)) expireAuthSession(response.reason);
          setOnline((current) => ({ ...current, connecting: false, error: response.reason }));
          reject(new Error(response.reason));
          return;
        }
        setOnline((current) => ({ ...current, mode: 'online', connecting: false, connected: true, rooms: response.rooms, error: null }));
        resolve();
      });
    });
  }, [connectOnlineSocket, expireAuthSession, requireToken]);

  const createOnlineRoom = useCallback(async (input: { serverUrl?: string; seed?: number }) => {
    const token = requireToken();
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
  }, [applyOnlineSnapshot, connectOnlineSocket, expireAuthSession, requireToken]);

  const joinOnlineRoom = useCallback(async (input: { roomId: string; serverUrl?: string }) => {
    const token = requireToken();
    const socket = await connectOnlineSocket(input.serverUrl ?? onlineRef.current.serverUrl);
    await new Promise<void>((resolve, reject) => {
      socket.emit('room:join', { token, roomId: input.roomId.trim().toUpperCase() }, (response) => {
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
  }, [applyOnlineSnapshot, connectOnlineSocket, expireAuthSession, requireToken]);

  const resumeOnlineRoom = useCallback(async (input: { serverUrl?: string; roomId?: string } = {}) => {
    const token = requireToken();
    setOnline((current) => ({ ...current, resumingRoom: true }));
    try {
      const socket = await connectOnlineSocket(input.serverUrl ?? onlineRef.current.serverUrl);
      await new Promise<void>((resolve, reject) => {
        socket.emit('room:resume', { token, ...(input.roomId ? { roomId: input.roomId.trim().toUpperCase() } : {}) }, (response) => {
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
  }, [applyOnlineSnapshot, connectOnlineSocket, expireAuthSession, requireToken]);

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
      socket.emit('room:selectForce', { token, roomId, forceId }, (response) => {
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
      socket.emit('room:startGame', { token, roomId }, (response) => {
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
  }, [applyOnlineSnapshot, setError]);

  const setOnlineError = useCallback((message: string | null) => {
    setOnline((current) => ({ ...current, error: message }));
  }, []);

  const isOnline = useCallback(() => onlineRef.current.mode === 'online', []);

  useEffect(() => () => {
    socketRef.current?.disconnect();
  }, []);

  return {
    online,
    auth,
    isOnline,
    setOnlineError,
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
  };
}
