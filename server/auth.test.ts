import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { AuthManager } from './auth';

let tempDir: string | null = null;

async function authWithTempFile() {
  tempDir = await mkdtemp(path.join(tmpdir(), 'san11-auth-'));
  return new AuthManager({ filePath: path.join(tempDir, 'users.json') });
}

afterEach(async () => {
  if (tempDir) await rm(tempDir, { recursive: true, force: true });
  tempDir = null;
});

describe('AuthManager', () => {
  it('registers a user, stores a password hash, and logs in after reload', async () => {
    const auth = await authWithTempFile();
    const registered = await auth.register({ username: 'liubei', password: 'secret123' });

    expect(registered.username).toBe('liubei');
    expect(registered.token).toHaveLength(64);

    const raw = await readFile(path.join(tempDir!, 'users.json'), 'utf8');
    expect(raw).not.toContain('secret123');
    expect(raw).toContain('passwordHash');

    const reloaded = new AuthManager({ filePath: path.join(tempDir!, 'users.json') });
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
