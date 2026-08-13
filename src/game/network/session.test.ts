import { describe, expect, it } from 'vitest';
import {
  createOnlineRoom,
  joinOnlineRoom,
  playerState,
  reduceOnlineIntent,
  selectPlayerForce,
  startOnlineRoom,
} from './session';
import { neighborsOf } from '../battle/grid';
import { reduceGameIntent } from './intentReducer';

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

  function readyStrategyRoom() {
    const room = structuredClone(readyStartedRoom());
    if (!room.state) throw new Error('room state should exist');
    room.state.units['host-strategy-unit'] = {
      id: 'host-strategy-unit',
      forceId: 'liu',
      leaderId: 'liu-bei',
      homeCityId: 'jiangling',
      troopType: 'spear',
      q: 8,
      r: 25,
      troops: 3000,
      gold: 1000,
      food: 3000,
      energy: 100,
      movementRemaining: 5,
      moved: false,
      acted: false,
    };
    room.state.units['guest-strategy-target'] = {
      id: 'guest-strategy-target',
      forceId: 'cao',
      leaderId: 'cao-cao',
      homeCityId: 'xiangyang',
      troopType: 'sword',
      q: 9,
      r: 25,
      troops: 3000,
      food: 3000,
      energy: 100,
      movementRemaining: 5,
      moved: false,
      acted: false,
    };
    room.state.units['guest-discord-victim'] = {
      id: 'guest-discord-victim',
      forceId: 'cao',
      leaderId: 'cao-ren',
      homeCityId: 'xiangyang',
      troopType: 'sword',
      q: 10,
      r: 25,
      troops: 3000,
      food: 3000,
      energy: 100,
      movementRemaining: 5,
      moved: false,
      acted: false,
    };
    return room;
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

  it('limits mobile duel lobby rooms to two players', () => {
    const created = createOnlineRoom({ roomId: 'ABCD', hostPlayerId: 'host', hostName: 'Host', seed: 1 });
    const joined = joinOnlineRoom(created, { playerId: 'guest', playerName: 'Guest' });

    expect(() => joinOnlineRoom(joined, { playerId: 'third', playerName: 'Third' })).toThrow(/2/);
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
    expect(started.state?.scenarioId).toBe('mobile-duel');
    expect(started.state?.gridWidth).toBe(16);
    expect(started.state?.gridHeight).toBe(33);
    expect(Object.keys(started.state?.cities ?? {}).sort()).toEqual(['jiangling', 'xiangyang']);
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

  it('applies fire plot intents in a mobile duel room', () => {
    const room = structuredClone(readyStartedRoom());
    if (!room.state) throw new Error('room state should exist');
    room.state.units['host-fire-unit'] = {
      id: 'host-fire-unit',
      forceId: 'liu',
      leaderId: 'liu-bei',
      homeCityId: 'jiangling',
      troopType: 'spear',
      q: 8,
      r: 25,
      troops: 3000,
      gold: 1000,
      food: 3000,
      energy: 100,
      movementRemaining: 5,
      moved: false,
      acted: false,
    };
    const hostState = playerState(room, 'host');
    if (!hostState) throw new Error('host state should exist');
    const unit = hostState.units['host-fire-unit'];
    const target = neighborsOf(unit.q, unit.r)[0];

    const result = reduceOnlineIntent(room, 'host', room.revision, {
      type: 'useFirePlot',
      unitId: unit.id,
      target,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.room.state?.firePlots).toEqual([target]);
    expect(playerState(result.room, 'guest')?.firePlots).toEqual([target]);
  });

  it('applies unit strategy intents in a mobile duel room', () => {
    const room = structuredClone(readyStartedRoom());
    if (!room.state) throw new Error('room state should exist');
    room.state.units['host-strategy-unit'] = {
      id: 'host-strategy-unit',
      forceId: 'liu',
      leaderId: 'liu-bei',
      homeCityId: 'jiangling',
      troopType: 'spear',
      q: 8,
      r: 25,
      troops: 3000,
      gold: 1000,
      food: 3000,
      energy: 100,
      movementRemaining: 5,
      moved: false,
      acted: false,
    };
    room.state.units['guest-strategy-target'] = {
      id: 'guest-strategy-target',
      forceId: 'cao',
      leaderId: 'cao-cao',
      homeCityId: 'xiangyang',
      troopType: 'sword',
      q: 9,
      r: 25,
      troops: 3000,
      food: 3000,
      energy: 100,
      movementRemaining: 5,
      moved: false,
      acted: false,
    };

    const result = reduceOnlineIntent(room, 'host', room.revision, {
      type: 'useUnitStrategy',
      unitId: 'host-strategy-unit',
      strategyId: 'disturb',
      selection: { targetUnitId: 'guest-strategy-target' },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.room.state?.units['host-strategy-unit']).toMatchObject({ energy: 85, acted: true });
    expect(result.room.state?.units['guest-strategy-target'].confusedTenDays).toBe(1);
    expect(playerState(result.room, 'guest')?.units['guest-strategy-target'].confusedTenDays).toBe(1);
  });

  it.each([
    ['disturb', 85],
    ['discord', 80],
  ] as const)('matches the complete seeded %s outcome through local and online reducers', (strategyId, expectedEnergy) => {
    const room = readyStrategyRoom();
    const localStart = playerState(room, 'host');
    if (!localStart) throw new Error('host state should exist');
    const intent = {
      type: 'useUnitStrategy' as const,
      unitId: 'host-strategy-unit',
      strategyId,
      selection: { targetUnitId: 'guest-strategy-target' } as const,
    };

    const localOutcome = reduceGameIntent(localStart, 'liu', intent);
    const onlineResult = reduceOnlineIntent(room, 'host', room.revision, intent);

    expect(onlineResult.ok).toBe(true);
    if (!onlineResult.ok) throw new Error('online strategy should succeed');
    if (!onlineResult.room.state) throw new Error('online strategy state should exist');
    const onlineOutcome = onlineResult.room.state;
    expect(onlineOutcome).toEqual(localOutcome);
    expect(onlineOutcome.rngCursor).toBe(localOutcome.rngCursor);
    expect(onlineOutcome.rngCursor).toBe(localStart.rngCursor + 1);
    expect(onlineOutcome.strategyResultReports).toEqual(localOutcome.strategyResultReports);
    expect(onlineOutcome.strategyResultReports).toEqual([expect.objectContaining({
      strategyId, succeeded: true, q: 9, r: 25,
    })]);
    expect(onlineOutcome.units['host-strategy-unit']).toMatchObject({ energy: expectedEnergy, acted: true });
    expect(localOutcome.units['host-strategy-unit']).toMatchObject({ energy: expectedEnergy, acted: true });

    if (strategyId === 'disturb') {
      expect(onlineOutcome.units['guest-strategy-target'].confusedTenDays).toBe(1);
      expect(onlineOutcome.units['guest-strategy-target']).toEqual(localOutcome.units['guest-strategy-target']);
    } else {
      expect(onlineOutcome.units['guest-discord-victim'].troops).toBeLessThan(3000);
      expect(onlineOutcome.units['guest-discord-victim']).toEqual(localOutcome.units['guest-discord-victim']);
      expect(onlineOutcome.battleDamageReports).toEqual(localOutcome.battleDamageReports);
      expect(onlineOutcome.battleDamageReports).toEqual([
        expect.objectContaining({ unitId: 'guest-discord-victim', q: 10, r: 25 }),
      ]);
    }
  });

  it('applies facility build intents in a mobile duel room', () => {
    const room = structuredClone(readyStartedRoom());
    if (!room.state) throw new Error('room state should exist');
    room.state.units['host-build-unit'] = {
      id: 'host-build-unit',
      forceId: 'liu',
      leaderId: 'liu-bei',
      homeCityId: 'jiangling',
      troopType: 'spear',
      q: 8,
      r: 25,
      troops: 3000,
      gold: 1000,
      food: 3000,
      energy: 100,
      movementRemaining: 5,
      moved: false,
      acted: false,
    };
    const target = neighborsOf(8, 25)[0];

    const result = reduceOnlineIntent(room, 'host', room.revision, {
      type: 'buildFacility',
      unitId: 'host-build-unit',
      facilityType: 'arrowTower',
      target,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const facility = Object.values(result.room.state?.facilities ?? {})[0];
    expect(facility).toMatchObject({ type: 'arrowTower', forceId: 'liu', q: target.q, r: target.r });
    expect(playerState(result.room, 'guest')?.facilities?.[facility.id]).toMatchObject({ type: 'arrowTower' });
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

  it('clears stale strategy reports when online control advances', () => {
    const room = readyStartedRoom();
    room.state!.strategyResultReports = [{
      id: 'old-strategy', strategyId: 'disturb', q: 9, r: 25,
      label: '计略失败', succeeded: false,
    }];

    const hostDone = reduceOnlineIntent(room, 'host', room.revision, { type: 'endTenDay' });

    expect(hostDone.ok).toBe(true);
    if (!hostDone.ok) return;
    expect(hostDone.room.activePlayerId).toBe('guest');
    expect(hostDone.room.state?.strategyResultReports).toEqual([]);
  });

  it('fires only the next active player arrow towers when online control passes to them', () => {
    const room = readyStartedRoom();
    room.state!.units['liu-target'] = {
      id: 'liu-target',
      kind: 'combat',
      forceId: 'liu',
      leaderId: 'liu-bei',
      homeCityId: 'jiangling',
      troopType: 'sword',
      q: 12,
      r: 10,
      troops: 3000,
      food: 3000,
      energy: 80,
      movementRemaining: 5,
      moved: false,
      acted: false,
    };
    room.state!.units['cao-target'] = {
      id: 'cao-target',
      kind: 'combat',
      forceId: 'cao',
      leaderId: 'cao-ren',
      homeCityId: 'xiangyang',
      troopType: 'sword',
      q: 4,
      r: 4,
      troops: 3000,
      food: 3000,
      energy: 80,
      movementRemaining: 5,
      moved: false,
      acted: false,
    };
    room.state!.facilities = {
      liuArrow: { id: 'liuArrow', type: 'arrowTower', forceId: 'liu', q: 2, r: 4, durability: 700 },
      caoArrow: { id: 'caoArrow', type: 'arrowTower', forceId: 'cao', q: 10, r: 10, durability: 700 },
    };

    const hostDone = reduceOnlineIntent(room, 'host', room.revision, { type: 'endTenDay' });

    expect(hostDone.ok).toBe(true);
    if (!hostDone.ok) return;
    expect(hostDone.room.activePlayerId).toBe('guest');
    expect(hostDone.room.state?.units['liu-target'].troops).toBe(2700);
    expect(hostDone.room.state?.units['cao-target'].troops).toBe(3000);
    expect((hostDone.room.state?.battleDamageReports ?? []).map((report) => report.unitId)).toEqual(['liu-target']);
  });
});
