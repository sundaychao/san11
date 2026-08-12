import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { GameDatabase } from './database';
import { RoomManager } from './roomManager';

let tempDir: string | null = null;

async function database() {
  tempDir = await mkdtemp(path.join(tmpdir(), 'san11-room-'));
  return new GameDatabase(path.join(tempDir, 'game.db'));
}

afterEach(async () => {
  if (tempDir) await rm(tempDir, { recursive: true, force: true });
  tempDir = null;
});

describe('RoomManager room list', () => {
  it('lists only lobby rooms with host and player summary', () => {
    const manager = new RoomManager();
    const lobby = manager.createRoom({ playerId: 'host', playerName: 'Host', seed: 1 });
    manager.joinRoom({ roomId: lobby.room.id, playerId: 'guest', playerName: 'Guest' });
    manager.selectForce({ roomId: lobby.room.id, playerId: 'host', forceId: 'liu' });

    const started = manager.createRoom({ playerId: 'started-host', playerName: 'Started', seed: 2 });
    manager.joinRoom({ roomId: started.room.id, playerId: 'started-guest', playerName: 'Started Guest' });
    manager.selectForce({ roomId: started.room.id, playerId: 'started-host', forceId: 'sun' });
    manager.selectForce({ roomId: started.room.id, playerId: 'started-guest', forceId: 'cao' });
    manager.startRoom({ roomId: started.room.id, playerId: 'started-host' });

    expect(manager.listLobbyRooms()).toEqual([
      {
        id: lobby.room.id,
        hostName: 'Host',
        playerCount: 2,
        maxPlayers: 2,
        selectedForceIds: ['liu'],
      },
    ]);
  });

  it('removes lobby players on disconnect and deletes empty lobby rooms', () => {
    const manager = new RoomManager();
    const room = manager.createRoom({ playerId: 'host', playerName: 'Host', seed: 1 });
    manager.joinRoom({ roomId: room.room.id, playerId: 'guest', playerName: 'Guest' });

    const guestResult = manager.disconnectPlayer('guest');

    expect(guestResult?.removed).toBe(false);
    expect(manager.listLobbyRooms()).toEqual([
      {
        id: room.room.id,
        hostName: 'Host',
        playerCount: 1,
        maxPlayers: 2,
        selectedForceIds: [],
      },
    ]);

    const hostResult = manager.disconnectPlayer('host');

    expect(hostResult?.removed).toBe(true);
    expect(manager.listLobbyRooms()).toEqual([]);
  });

  it('keeps playing rooms when players disconnect', () => {
    const manager = new RoomManager();
    const room = manager.createRoom({ playerId: 'host', playerName: 'Host', seed: 1 });
    manager.joinRoom({ roomId: room.room.id, playerId: 'guest', playerName: 'Guest' });
    manager.selectForce({ roomId: room.room.id, playerId: 'host', forceId: 'liu' });
    manager.selectForce({ roomId: room.room.id, playerId: 'guest', forceId: 'cao' });
    manager.startRoom({ roomId: room.room.id, playerId: 'host' });

    const result = manager.disconnectPlayer('guest');

    expect(result?.removed).toBe(false);
    expect(manager.roomForPlayer('guest')?.players.guest.connected).toBe(false);
  });

  it('restores a saved playing room from the database and resumes the player', async () => {
    const db = await database();
    const manager = new RoomManager({ db });
    const room = manager.createRoom({ playerId: 'host', playerName: 'Host', seed: 1 });
    manager.joinRoom({ roomId: room.room.id, playerId: 'guest', playerName: 'Guest' });
    manager.selectForce({ roomId: room.room.id, playerId: 'host', forceId: 'liu' });
    manager.selectForce({ roomId: room.room.id, playerId: 'guest', forceId: 'cao' });
    manager.startRoom({ roomId: room.room.id, playerId: 'host' });
    manager.disconnectPlayer('guest');

    const reloaded = new RoomManager({ db });
    const resumed = reloaded.resumeRoom({ playerId: 'guest' });

    expect(resumed.room.id).toBe(room.room.id);
    expect(resumed.room.phase).toBe('playing');
    expect(resumed.state?.playerForceId).toBe('cao');
    expect(reloaded.roomForPlayer('guest')?.players.guest.connected).toBe(true);
    db.close();
  });

  it('does not list or resume stale lobby rooms after a server restart', async () => {
    const db = await database();
    const manager = new RoomManager({ db });
    const room = manager.createRoom({ playerId: 'host', playerName: 'Host', seed: 1 });
    manager.joinRoom({ roomId: room.room.id, playerId: 'guest', playerName: 'Guest' });

    const reloaded = new RoomManager({ db });

    expect(reloaded.listLobbyRooms()).toEqual([]);
    expect(() => reloaded.resumeRoom({ playerId: 'host' })).toThrow('房间不存在');
    db.close();
  });

  it('does not migrate stale legacy lobby room files into the lobby list', async () => {
    const db = await database();
    if (!tempDir) throw new Error('temp dir should exist');
    const legacyRoomDir = path.join(tempDir, 'rooms');
    await mkdir(legacyRoomDir);

    const legacyManager = new RoomManager();
    const room = legacyManager.createRoom({ playerId: 'host', playerName: 'Host', seed: 1 });
    await writeFile(path.join(legacyRoomDir, `${room.room.id}.json`), JSON.stringify(room.room), 'utf8');

    const migrated = new RoomManager({ db, legacyRoomDir });

    expect(migrated.listLobbyRooms()).toEqual([]);
    expect(() => migrated.resumeRoom({ playerId: 'host' })).toThrow('房间不存在');
    db.close();
  });

  it('migrates legacy JSON rooms into the database so players can resume', async () => {
    const db = await database();
    if (!tempDir) throw new Error('temp dir should exist');
    const legacyRoomDir = path.join(tempDir, 'rooms');
    await mkdir(legacyRoomDir);

    const legacyManager = new RoomManager();
    const room = legacyManager.createRoom({ playerId: 'host', playerName: 'Host', seed: 1 });
    legacyManager.joinRoom({ roomId: room.room.id, playerId: 'guest', playerName: 'Guest' });
    legacyManager.selectForce({ roomId: room.room.id, playerId: 'host', forceId: 'liu' });
    legacyManager.selectForce({ roomId: room.room.id, playerId: 'guest', forceId: 'cao' });
    legacyManager.startRoom({ roomId: room.room.id, playerId: 'host' });
    legacyManager.disconnectPlayer('guest');
    const savedRoom = legacyManager.roomForPlayer('guest');
    if (!savedRoom) throw new Error('legacy room should exist');
    await writeFile(path.join(legacyRoomDir, `${savedRoom.id}.json`), JSON.stringify(savedRoom), 'utf8');

    const migrated = new RoomManager({ db, legacyRoomDir } as any);
    const resumed = migrated.resumeRoom({ playerId: 'guest' });
    const reloaded = new RoomManager({ db });
    const resumedAfterReload = reloaded.resumeRoom({ playerId: 'guest' });

    expect(resumed.room.id).toBe(savedRoom.id);
    expect(resumed.state?.playerForceId).toBe('cao');
    expect(resumedAfterReload.room.id).toBe(savedRoom.id);
    expect(resumedAfterReload.state?.playerForceId).toBe('cao');
    db.close();
  });
});
