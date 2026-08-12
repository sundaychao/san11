import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { AuthManager } from './auth';

let tempDir: string | null = null;
const authManagers: AuthManager[] = [];

async function authWithTempFile() {
  tempDir = await mkdtemp(path.join(tmpdir(), 'san11-auth-'));
  const auth = new AuthManager({ dbPath: path.join(tempDir, 'game.db') });
  authManagers.push(auth);
  return auth;
}

afterEach(async () => {
  for (const auth of authManagers.splice(0)) auth.close();
  if (tempDir) await rm(tempDir, { recursive: true, force: true });
  tempDir = null;
});

describe('AuthManager', () => {
  it('registers a user, stores a password hash, and logs in after reload', async () => {
    const auth = await authWithTempFile();
    const registered = await auth.register({ username: 'liubei', password: 'secret123' });

    expect(registered.username).toBe('liubei');
    expect(registered.token).toHaveLength(64);

    const db = new DatabaseSync(path.join(tempDir!, 'game.db'));
    const stored = db.prepare('SELECT username, password_hash FROM users WHERE username = ?').get('liubei') as { username: string; password_hash: string };
    expect(stored.username).toBe('liubei');
    expect(stored.password_hash).not.toBe('secret123');
    db.close();

    const reloaded = new AuthManager({ dbPath: path.join(tempDir!, 'game.db') });
    authManagers.push(reloaded);
    expect(await reloaded.authenticate(registered.token)).toMatchObject({ username: 'liubei' });

    const loggedIn = await reloaded.login({ username: 'liubei', password: 'secret123' });

    expect(loggedIn.username).toBe('liubei');
    expect(await reloaded.authenticate(loggedIn.token)).toMatchObject({ username: 'liubei' });
  });

  it('rejects duplicate users, short passwords, and invalid credentials', async () => {
    const auth = await authWithTempFile();

    await expect(auth.register({ username: 'caocao', password: '123' })).rejects.toThrow('密码至少 6 位');
    await auth.register({ username: 'caocao', password: 'secret123' });
    await expect(auth.register({ username: 'CAOCAO', password: 'secret456' })).rejects.toThrow('用户名已存在');
    await expect(auth.login({ username: 'caocao', password: 'wrongpass' })).rejects.toThrow('用户名或密码错误');
  });
});
