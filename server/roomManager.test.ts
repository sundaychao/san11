import { describe, expect, it } from 'vitest';
import { RoomManager } from './roomManager';

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
        maxPlayers: 4,
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
        maxPlayers: 4,
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
});
