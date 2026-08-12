import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { GameDatabase, type StoredUser } from './database';

const scrypt = promisify(scryptCallback);

export interface AuthSession {
  userId: string;
  username: string;
  token: string;
}

export interface AuthManagerOptions {
  db?: GameDatabase;
  dbPath?: string;
  filePath?: string;
}

function normalizeUsername(username: string) {
  return username.trim().toLowerCase();
}

function validateCredentials(username: string, password: string) {
  const normalized = normalizeUsername(username);
  if (!/^[a-zA-Z0-9_]{3,20}$/.test(username.trim())) throw new Error('用户名只能使用 3-20 位字母、数字或下划线');
  if (password.length < 6) throw new Error('密码至少 6 位');
  return normalized;
}

async function hashPassword(password: string, salt: string) {
  const derived = await scrypt(password, salt, 64) as Buffer;
  return derived.toString('hex');
}

export class AuthManager {
  private readonly db: GameDatabase;
  private readonly ownsDb: boolean;

  constructor(options: AuthManagerOptions = {}) {
    this.db = options.db ?? new GameDatabase(options.dbPath ?? options.filePath);
    this.ownsDb = !options.db;
  }

  private async createSession(user: StoredUser): Promise<AuthSession> {
    const session = {
      userId: user.id,
      username: user.username,
      token: randomBytes(32).toString('hex'),
    };
    this.db.saveSession({ ...session, createdAt: new Date().toISOString() });
    return session;
  }

  async register(input: { username: string; password: string }): Promise<AuthSession> {
    const username = input.username.trim();
    const normalizedUsername = validateCredentials(username, input.password);
    if (this.db.findUserByNormalizedUsername(normalizedUsername)) throw new Error('用户名已存在');

    const passwordSalt = randomBytes(16).toString('hex');
    const passwordHash = await hashPassword(input.password, passwordSalt);
    const user: StoredUser = {
      id: randomBytes(12).toString('hex'),
      username,
      normalizedUsername,
      passwordSalt,
      passwordHash,
      createdAt: new Date().toISOString(),
    };
    this.db.insertUser(user);
    return this.createSession(user);
  }

  async login(input: { username: string; password: string }): Promise<AuthSession> {
    const normalizedUsername = normalizeUsername(input.username);
    const user = this.db.findUserByNormalizedUsername(normalizedUsername);
    if (!user) throw new Error('用户名或密码错误');

    const passwordHash = await hashPassword(input.password, user.passwordSalt);
    const actual = Buffer.from(passwordHash, 'hex');
    const expected = Buffer.from(user.passwordHash, 'hex');
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw new Error('用户名或密码错误');
    return this.createSession(user);
  }

  async authenticate(token: string | undefined): Promise<AuthSession | null> {
    if (!token) return null;
    const session = this.db.findSession(token);
    return session ? { userId: session.userId, username: session.username, token: session.token } : null;
  }

  logout(token: string | undefined) {
    if (!token) return;
    this.db.deleteSession(token);
  }

  close() {
    if (this.ownsDb) this.db.close();
  }
}
