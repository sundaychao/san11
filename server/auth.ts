import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCallback);
const DEFAULT_USERS_FILE = path.resolve(process.cwd(), 'server/data/users.json');

export interface AuthSession {
  userId: string;
  username: string;
  token: string;
}

interface UserRecord {
  id: string;
  username: string;
  normalizedUsername: string;
  passwordSalt: string;
  passwordHash: string;
  createdAt: string;
}

interface SessionRecord extends AuthSession {
  createdAt: string;
}

interface UsersFile {
  users: UserRecord[];
  sessions?: SessionRecord[];
}

export interface AuthManagerOptions {
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
  private readonly filePath: string;

  private loaded = false;

  private users: UserRecord[] = [];

  private readonly sessions = new Map<string, AuthSession>();

  constructor(options: AuthManagerOptions = {}) {
    this.filePath = options.filePath ?? DEFAULT_USERS_FILE;
  }

  private async load() {
    if (this.loaded) return;
    try {
      const raw = await readFile(this.filePath, 'utf8');
      const data = JSON.parse(raw) as Partial<UsersFile>;
      this.users = Array.isArray(data.users) ? data.users : [];
      this.sessions.clear();
      if (Array.isArray(data.sessions)) {
        for (const session of data.sessions) {
          if (
            typeof session.userId === 'string'
            && typeof session.username === 'string'
            && typeof session.token === 'string'
          ) {
            this.sessions.set(session.token, {
              userId: session.userId,
              username: session.username,
              token: session.token,
            });
          }
        }
      }
    } catch {
      this.users = [];
      this.sessions.clear();
    }
    this.loaded = true;
  }

  private async save() {
    await mkdir(path.dirname(this.filePath), { recursive: true });
    const data: UsersFile = {
      users: this.users,
      sessions: [...this.sessions.values()].map((session) => ({
        ...session,
        createdAt: new Date().toISOString(),
      })),
    };
    await writeFile(this.filePath, JSON.stringify(data, null, 2), 'utf8');
  }

  private async createSession(user: UserRecord): Promise<AuthSession> {
    const session = {
      userId: user.id,
      username: user.username,
      token: randomBytes(32).toString('hex'),
    };
    this.sessions.set(session.token, session);
    await this.save();
    return session;
  }

  async register(input: { username: string; password: string }): Promise<AuthSession> {
    await this.load();
    const username = input.username.trim();
    const normalizedUsername = validateCredentials(username, input.password);
    if (this.users.some((user) => user.normalizedUsername === normalizedUsername)) throw new Error('用户名已存在');

    const passwordSalt = randomBytes(16).toString('hex');
    const passwordHash = await hashPassword(input.password, passwordSalt);
    const user: UserRecord = {
      id: randomBytes(12).toString('hex'),
      username,
      normalizedUsername,
      passwordSalt,
      passwordHash,
      createdAt: new Date().toISOString(),
    };
    this.users.push(user);
    return this.createSession(user);
  }

  async login(input: { username: string; password: string }): Promise<AuthSession> {
    await this.load();
    const normalizedUsername = normalizeUsername(input.username);
    const user = this.users.find((candidate) => candidate.normalizedUsername === normalizedUsername);
    if (!user) throw new Error('用户名或密码错误');

    const passwordHash = await hashPassword(input.password, user.passwordSalt);
    const actual = Buffer.from(passwordHash, 'hex');
    const expected = Buffer.from(user.passwordHash, 'hex');
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw new Error('用户名或密码错误');
    return this.createSession(user);
  }

  async authenticate(token: string | undefined): Promise<AuthSession | null> {
    await this.load();
    if (!token) return null;
    return this.sessions.get(token) ?? null;
  }

  logout(token: string | undefined) {
    if (!token) return;
    this.sessions.delete(token);
    void this.save();
  }
}
