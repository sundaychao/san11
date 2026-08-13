export const AUTH_TOKEN_KEY = 'jingxiang-208-auth-token-v1';
export const AUTH_SESSION_KEY = 'jingxiang-208-auth-session-v1';
export const LAST_ONLINE_ROOM_KEY = 'jingxiang-208-last-online-room-v1';

export type StorageAdapter = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export interface StoredAuthSession {
  token: string;
  userId: string;
  username: string;
}

export interface StoredLastRoom {
  serverUrl: string;
  roomId: string;
}

export function readStoredAuthSession(storage: StorageAdapter): StoredAuthSession | null {
  const raw = storage.getItem(AUTH_SESSION_KEY);
  if (!raw) return null;

  try {
    const session = JSON.parse(raw) as Partial<StoredAuthSession>;
    return typeof session.token === 'string'
      && typeof session.userId === 'string'
      && typeof session.username === 'string'
      ? { token: session.token, userId: session.userId, username: session.username }
      : null;
  } catch {
    storage.removeItem(AUTH_SESSION_KEY);
    return null;
  }
}

export function writeStoredAuthSession(storage: StorageAdapter, session: StoredAuthSession) {
  storage.setItem(AUTH_TOKEN_KEY, session.token);
  storage.setItem(AUTH_SESSION_KEY, JSON.stringify(session));
}

export function clearStoredAuthSession(storage: StorageAdapter) {
  storage.removeItem(AUTH_TOKEN_KEY);
  storage.removeItem(AUTH_SESSION_KEY);
}

export function readStoredLastRoom(storage: StorageAdapter): StoredLastRoom | null {
  const raw = storage.getItem(LAST_ONLINE_ROOM_KEY);
  if (!raw) return null;

  try {
    const room = JSON.parse(raw) as Partial<StoredLastRoom>;
    return typeof room.serverUrl === 'string' && typeof room.roomId === 'string'
      ? { serverUrl: room.serverUrl, roomId: room.roomId }
      : null;
  } catch {
    return null;
  }
}

export function writeStoredLastRoom(storage: StorageAdapter, room: StoredLastRoom) {
  storage.setItem(LAST_ONLINE_ROOM_KEY, JSON.stringify(room));
}

export function clearStoredLastRoom(storage: StorageAdapter) {
  storage.removeItem(LAST_ONLINE_ROOM_KEY);
}
