import { describe, expect, it } from 'vitest';
import {
  createOnlineRoom,
  joinOnlineRoom,
  playerState,
  reduceOnlineIntent,
  selectPlayerForce,
  startOnlineRoom,
} from './session';

describe('online room session', () => {
  function readyStartedRoom() {
    const created = createOnlineRoom({ roomId: 'ABCD', hostPlayerId: 'host', hostName: 'Host', seed: 1 });
    const joined = joinOnlineRoom(created, { playerId: 'guest', playerName: 'Guest' });
    const ready = selectPlayerForce(
      selectPlayerForce(joined, { playerId: 'host', forceId: 'liu' }),
      { playerId: 'guest', forceId: 'cao' },
    );
    return startOnlineRoom(ready, { playerId: 'host' });
  }

  it('keeps a created and joined room in lobby until forces are selected and the host starts', () => {
    const created = createOnlineRoom({ roomId: 'ABCD', hostPlayerId: 'host', hostName: 'Host', seed: 1 });
    const joined = joinOnlineRoom(created, { playerId: 'guest', playerName: 'Guest' });

    expect(joined.phase).toBe('lobby');
    expect(joined.state).toBeNull();
    expect(joined.players.host.forceId).toBeNull();
    expect(joined.players.guest.forceId).toBeNull();
    expect(playerState(joined, 'host')).toBeNull();
  });

  it('lets lobby players choose unique forces before the host starts the game', () => {
    const created = createOnlineRoom({ roomId: 'ABCD', hostPlayerId: 'host', hostName: 'Host', seed: 1 });
    const joined = joinOnlineRoom(created, { playerId: 'guest', playerName: 'Guest' });
    const hostSelected = selectPlayerForce(joined, { playerId: 'host', forceId: 'liu' });

    expect(hostSelected.players.host.forceId).toBe('liu');
    expect(() => selectPlayerForce(hostSelected, { playerId: 'guest', forceId: 'liu' })).toThrow('该势力已被占用');

    const ready = selectPlayerForce(hostSelected, { playerId: 'guest', forceId: 'cao' });
    expect(ready.players.guest.forceId).toBe('cao');
  });

  it('starts the game only when the host has at least two force-ready players', () => {
    const created = createOnlineRoom({ roomId: 'ABCD', hostPlayerId: 'host', hostName: 'Host', seed: 1 });
    expect(() => startOnlineRoom(created, { playerId: 'host' })).toThrow('至少需要 2 名玩家');

    const joined = joinOnlineRoom(created, { playerId: 'guest', playerName: 'Guest' });
    expect(() => startOnlineRoom(joined, { playerId: 'guest' })).toThrow('只有房主可以开始游戏');
    expect(() => startOnlineRoom(joined, { playerId: 'host' })).toThrow('所有玩家都需要选择势力');

    const ready = selectPlayerForce(
      selectPlayerForce(joined, { playerId: 'host', forceId: 'liu' }),
      { playerId: 'guest', forceId: 'cao' },
    );
    const started = startOnlineRoom(ready, { playerId: 'host' });

    expect(started.phase).toBe('playing');
    expect(started.state?.playerForceId).toBe('liu');
    expect(playerState(started, 'guest')?.playerForceId).toBe('cao');
  });

  it('creates a room and personalizes the game state for each joined player', () => {
    const joined = readyStartedRoom();

    expect(joined.players.host.forceId).toBe('liu');
    expect(joined.players.guest.forceId).toBe('cao');
    expect(playerState(joined, 'host')?.playerForceId).toBe('liu');
    expect(playerState(joined, 'guest')?.playerForceId).toBe('cao');
  });

  it('rejects stale revisions and actions from forces a player does not control', () => {
    const room = readyStartedRoom();
    const stale = reduceOnlineIntent(room, 'host', room.revision - 1, {
      type: 'issueCommand',
      command: { type: 'patrol', cityId: 'jiangling', officerId: 'liu-bei' },
    });
    const wrongForce = reduceOnlineIntent(room, 'host', room.revision, {
      type: 'issueCommand',
      command: { type: 'patrol', cityId: 'xiangyang', officerId: 'cao-ren' },
    });

    expect(stale.ok).toBe(false);
    if (stale.ok) throw new Error('stale revision should be rejected');
    expect(stale.reason).toBe('状态已更新，请重试');
    expect(wrongForce.ok).toBe(false);
    if (wrongForce.ok) throw new Error('wrong force should be rejected');
    expect(wrongForce.reason).toContain('只能管理己方城市');
  });

  it('applies player intents and advances ten days after all joined forces are ready', () => {
    const room = readyStartedRoom();
    const commanded = reduceOnlineIntent(room, 'host', room.revision, {
      type: 'issueCommand',
      command: { type: 'patrol', cityId: 'jiangling', officerId: 'liu-bei' },
    });

    expect(commanded.ok).toBe(true);
    if (!commanded.ok) return;
    expect(commanded.room.revision).toBe(room.revision + 1);
    expect(commanded.room.state?.cities.jiangling.order).toBeGreaterThan(room.state?.cities.jiangling.order ?? 0);

    const hostReady = reduceOnlineIntent(commanded.room, 'host', commanded.room.revision, { type: 'endTenDay' });
    expect(hostReady.ok).toBe(true);
    if (!hostReady.ok) return;
    expect(hostReady.room.tenDayReadyForceIds).toEqual(['liu']);
    expect(hostReady.room.state?.tenDay).toBe(1);

    const guestReady = reduceOnlineIntent(hostReady.room, 'guest', hostReady.room.revision, { type: 'endTenDay' });
    expect(guestReady.ok).toBe(true);
    if (!guestReady.ok) return;
    expect(guestReady.room.tenDayReadyForceIds).toEqual([]);
    expect(guestReady.room.state?.tenDay).toBe(2);
  });

  it('lets online players act one by one and advances the ten-day turn after the last player', () => {
    const room = readyStartedRoom();

    expect(room.turnPlayerIds).toEqual(['host', 'guest']);
    expect(room.activePlayerId).toBe('host');
    expect(playerState(room, 'host')?.turnForceId).toBe('liu');
    expect(playerState(room, 'guest')?.turnForceId).toBe('liu');

    const guestCommand = reduceOnlineIntent(room, 'guest', room.revision, {
      type: 'issueCommand',
      command: { type: 'patrol', cityId: 'xiangyang', officerId: 'cao-ren' },
    });
    expect(guestCommand.ok).toBe(false);
    if (guestCommand.ok) throw new Error('inactive player should be rejected');
    expect(guestCommand.reason).toBe('等待其他玩家操作中');

    const hostDone = reduceOnlineIntent(room, 'host', room.revision, { type: 'endTenDay' });
    expect(hostDone.ok).toBe(true);
    if (!hostDone.ok) return;
    expect(hostDone.room.activePlayerId).toBe('guest');
    expect(hostDone.room.completedTurnPlayerIds).toEqual(['host']);
    expect(hostDone.room.state?.tenDay).toBe(1);
    expect(playerState(hostDone.room, 'guest')?.turnForceId).toBe('cao');

    const guestDone = reduceOnlineIntent(hostDone.room, 'guest', hostDone.room.revision, { type: 'endTenDay' });
    expect(guestDone.ok).toBe(true);
    if (!guestDone.ok) return;
    expect(guestDone.room.activePlayerId).toBe('host');
    expect(guestDone.room.completedTurnPlayerIds).toEqual([]);
    expect(guestDone.room.state?.tenDay).toBe(2);
  });
});
