import { describe, expect, it } from 'vitest';
import type { AuthSessionView } from '../network/protocol';
import {
  createAuthenticatedAuthState,
  createOfflineOnlineState,
  createOnlineClientState,
  createUnauthenticatedAuthState,
} from './onlineState';

describe('online state factories', () => {
  it('creates a reconnectable initial state without marking the socket connected', () => {
    const state = createOnlineClientState({ resumingRoom: true, serverUrl: 'http://server.test' });

    expect(state).toMatchObject({
      mode: 'local',
      resumingRoom: true,
      connected: false,
      serverUrl: 'http://server.test',
      rooms: [],
      error: null,
    });
  });

  it('creates the same offline state for disconnect and session expiry', () => {
    expect(createOfflineOnlineState()).toEqual(createOnlineClientState({ resumingRoom: false }));
  });

  it('maps authenticated and expired sessions to stable auth state shapes', () => {
    const session: AuthSessionView = { token: 'token-1', userId: 'user-1', username: '玩家一' };

    expect(createAuthenticatedAuthState(session)).toEqual({ ...session, loading: false, error: null });
    expect(createUnauthenticatedAuthState('会话失效')).toEqual({
      token: null,
      userId: null,
      username: null,
      loading: false,
      error: '会话失效',
    });
  });
});
