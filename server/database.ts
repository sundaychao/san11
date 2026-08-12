import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { OnlineRoom } from '../src/game/network/session';

export const DEFAULT_DB_PATH = path.resolve(process.cwd(), 'server/data/game.db');

export interface StoredUser {
  id: string;
  username: string;
  normalizedUsername: string;
  passwordSalt: string;
  passwordHash: string;
  createdAt: string;
}

export interface StoredSession {
  userId: string;
  username: string;
  token: string;
  createdAt: string;
}

interface UserRow {
  id: string;
  username: string;
  normalized_username: string;
  password_salt: string;
  password_hash: string;
  created_at: string;
}

interface SessionRow {
  token: string;
  user_id: string;
  username: string;
  created_at: string;
}

interface RoomRow {
  room_json: string;
}

export class GameDatabase {
  private readonly db: DatabaseSync;

  constructor(dbPath = DEFAULT_DB_PATH) {
    mkdirSync(path.dirname(dbPath), { recursive: true });
    this.db = new DatabaseSync(dbPath);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        username TEXT NOT NULL,
        normalized_username TEXT NOT NULL UNIQUE,
        password_salt TEXT NOT NULL,
        password_hash TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS sessions (
        token TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        username TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS rooms (
        id TEXT PRIMARY KEY,
        room_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
  }

  insertUser(user: StoredUser) {
    this.db.prepare(`
      INSERT INTO users (id, username, normalized_username, password_salt, password_hash, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(user.id, user.username, user.normalizedUsername, user.passwordSalt, user.passwordHash, user.createdAt);
  }

  findUserByNormalizedUsername(normalizedUsername: string): StoredUser | null {
    const row = this.db.prepare('SELECT * FROM users WHERE normalized_username = ?').get(normalizedUsername) as UserRow | undefined;
    return row ? {
      id: row.id,
      username: row.username,
      normalizedUsername: row.normalized_username,
      passwordSalt: row.password_salt,
      passwordHash: row.password_hash,
      createdAt: row.created_at,
    } : null;
  }

  saveSession(session: StoredSession) {
    this.db.prepare(`
      INSERT OR REPLACE INTO sessions (token, user_id, username, created_at)
      VALUES (?, ?, ?, ?)
    `).run(session.token, session.userId, session.username, session.createdAt);
  }

  findSession(token: string): StoredSession | null {
    const row = this.db.prepare('SELECT * FROM sessions WHERE token = ?').get(token) as SessionRow | undefined;
    return row ? {
      token: row.token,
      userId: row.user_id,
      username: row.username,
      createdAt: row.created_at,
    } : null;
  }

  deleteSession(token: string) {
    this.db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
  }

  saveRoom(room: OnlineRoom) {
    this.db.prepare(`
      INSERT OR REPLACE INTO rooms (id, room_json, updated_at)
      VALUES (?, ?, ?)
    `).run(room.id, JSON.stringify(room), new Date().toISOString());
  }

  deleteRoom(roomId: string) {
    this.db.prepare('DELETE FROM rooms WHERE id = ?').run(roomId);
  }

  loadRooms(): OnlineRoom[] {
    const rows = this.db.prepare('SELECT room_json FROM rooms').all() as unknown as RoomRow[];
    return rows.flatMap((row) => {
      try {
        return [JSON.parse(row.room_json) as OnlineRoom];
      } catch {
        return [];
      }
    });
  }

  close() {
    this.db.close();
  }
}
