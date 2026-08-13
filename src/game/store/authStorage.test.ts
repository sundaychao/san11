import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import * as authStorageModule from './authStorage';

it('provides versioned authentication storage helpers', () => {
  expect(existsSync(resolve(process.cwd(), 'src/game/store/authStorage.ts'))).toBe(true);
});

class MemoryStorage {
  readonly values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
  removeItem(key: string) { this.values.delete(key); }
}

describe('authentication storage', () => {
  const storageApi = authStorageModule as typeof authStorageModule & Record<string, (...args: any[]) => any>;
  const requiredFunctions = [
    'readStoredAuthSession',
    'writeStoredAuthSession',
    'clearStoredAuthSession',
    'readStoredLastRoom',
    'writeStoredLastRoom',
    'clearStoredLastRoom',
  ];

  it('exports all storage operations', () => {
    for (const name of requiredFunctions) expect(typeof storageApi[name]).toBe('function');
  });

  it('round-trips and clears an authentication session', () => {
    if (requiredFunctions.some((name) => typeof storageApi[name] !== 'function')) return;
    const storage = new MemoryStorage();
    const session = { token: 'token-1', userId: 'user-1', username: 'Liu Bei' };

    storageApi.writeStoredAuthSession(storage, session);
    expect(storageApi.readStoredAuthSession(storage)).toEqual(session);

    storageApi.clearStoredAuthSession(storage);
    expect(storageApi.readStoredAuthSession(storage)).toBeNull();
  });

  it('rejects malformed and incomplete authentication sessions', () => {
    if (typeof storageApi.readStoredAuthSession !== 'function') return;
    const storage = new MemoryStorage();
    storage.setItem('jingxiang-208-auth-session-v1', '{broken');
    expect(storageApi.readStoredAuthSession(storage)).toBeNull();

    storage.setItem('jingxiang-208-auth-session-v1', JSON.stringify({ token: 'token-1', userId: 'user-1' }));
    expect(storageApi.readStoredAuthSession(storage)).toBeNull();
  });

  it('round-trips and clears the last online room', () => {
    if (requiredFunctions.some((name) => typeof storageApi[name] !== 'function')) return;
    const storage = new MemoryStorage();
    const room = { serverUrl: 'http://server.test', roomId: 'ABCD' };

    storageApi.writeStoredLastRoom(storage, room);
    expect(storageApi.readStoredLastRoom(storage)).toEqual(room);

    storageApi.clearStoredLastRoom(storage);
    expect(storageApi.readStoredLastRoom(storage)).toBeNull();
  });
});
