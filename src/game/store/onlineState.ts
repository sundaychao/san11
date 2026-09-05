import { DEFAULT_ONLINE_SERVER_URL } from '../../network/socketClient';
import type { AuthSessionView, OnlineRoomListItem, OnlineRoomView } from '../network/protocol';
import type { RoomMap } from '../network/session';
import type { ForceId } from '../types';

export interface OnlineClientState {
  mode: 'local' | 'online';
  connecting: boolean;
  resumingRoom: boolean;
  connected: boolean;
  serverUrl: string;
  roomId: string | null;
  phase: OnlineRoomView['phase'] | null;
  map: RoomMap;
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

export function createOnlineClientState(input: { resumingRoom: boolean; serverUrl?: string }): OnlineClientState {
  return {
    mode: 'local',
    connecting: false,
    resumingRoom: input.resumingRoom,
    connected: false,
    serverUrl: input.serverUrl ?? DEFAULT_ONLINE_SERVER_URL,
    roomId: null,
    phase: null,
    map: 'small',
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
  };
}

export function createOfflineOnlineState(): OnlineClientState {
  return createOnlineClientState({ resumingRoom: false });
}

export function createAuthenticatedAuthState(session: AuthSessionView): AuthClientState {
  return {
    ...session,
    loading: false,
    error: null,
  };
}

export function createUnauthenticatedAuthState(error: string | null = null): AuthClientState {
  return {
    token: null,
    userId: null,
    username: null,
    loading: false,
    error,
  };
}
