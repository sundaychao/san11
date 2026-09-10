import { describe, expect, it } from 'vitest';
import {
  createOnlineRoom,
  joinOnlineRoom,
  playerState,
  reduceOnlineIntent,
  selectPlayerForce,
  startOnlineRoom,
} from './session';
import { neighborsOf, sevenCellCityFootprint } from '../battle/grid';
import { cellAt } from '../battle/movementRules';
import { settleForceTurnStart } from '../skills/rules/turn';
import { reduceGameIntent } from './intentReducer';
import type { City } from '../types';

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

  /** 大地图（含空城）双人房间，用于验证联网旬末的委任执行 */
  function readyHomelandRoom() {
    const created = createOnlineRoom({ roomId: 'HOME', hostPlayerId: 'host', hostName: 'Host', seed: 1, map: 'homeland' });
    const joined = joinOnlineRoom(created, { playerId: 'guest', playerName: 'Guest' });
    const ready = selectPlayerForce(
      selectPlayerForce(joined, { playerId: 'host', forceId: 'liu' }),
      { playerId: 'guest', forceId: 'cao' },
    );
    return startOnlineRoom(ready, { playerId: 'host' });
  }

  /** 自定义图 payload：两座分属 liu/cao 的有主城，注册表里无此 mapId */
  function customPayload() {
    const width = 20;
    const height = 20;
    const grid = [];
    for (let r = 0; r < height; r++) {
      for (let q = 0; q < width; q++) grid.push({ q, r, terrain: 'plain' as const });
    }
    return {
      schemaVersion: 2,
      width,
      height,
      backgroundImage: '',
      grid,
      cities: [
        { type: 'city', id: 'my-city-a', label: '甲城', q: 6, r: 6, forceId: 'liu' },
        { type: 'city', id: 'my-city-b', label: '乙城', q: 14, r: 14, forceId: 'cao' },
      ],
    };
  }

  it('starts a lobby with a custom-map payload that is absent from the server registry', () => {
    // 回归：服务端 getMap 找不到自定义图 mapId → 之前 startOnlineRoom 抛「找不到所选的剧本地图」。
    // 修复后开局应优先用建房时客户端带入的 mapPayload 生成场景。
    const payload = customPayload();
    const created = createOnlineRoom({
      roomId: 'CSTM', hostPlayerId: 'host', hostName: 'Host', seed: 1,
      map: 'my-custom-map', mapPayload: payload,
    });
    const joined = joinOnlineRoom(created, { playerId: 'guest', playerName: 'Guest' });
    const ready = selectPlayerForce(
      selectPlayerForce(joined, { playerId: 'host', forceId: 'liu' }),
      { playerId: 'guest', forceId: 'cao' },
    );

    const started = startOnlineRoom(ready, { playerId: 'host' });

    expect(started.phase).toBe('playing');
    expect(started.state?.cities).toBeDefined();
  });

  function addTurnStartMusicians(room: ReturnType<typeof readyStartedRoom>) {
    room.state!.officers['zhang-fei'].skill = '乐奏';
    room.state!.officers['cao-cao'].skill = '乐奏';
    room.state!.officers['zhang-fei'].location = { kind: 'unit', unitId: 'host-musician' };
    room.state!.officers['cao-cao'].location = { kind: 'unit', unitId: 'guest-musician' };
    room.state!.units['host-musician'] = {
      id: 'host-musician', kind: 'combat', forceId: 'liu', leaderId: 'zhang-fei', officerIds: ['zhang-fei'],
      homeCityId: 'jiangling', troopType: 'spear', q: 0, r: 0, troops: 4000, food: 4000,
      energy: 80, movementRemaining: 20, moved: false, acted: false,
    };
    room.state!.units['guest-musician'] = {
      id: 'guest-musician', kind: 'combat', forceId: 'cao', leaderId: 'cao-cao', officerIds: ['cao-cao'],
      homeCityId: 'xiangyang', troopType: 'spear', q: 15, r: 32, troops: 4000, food: 4000,
      energy: 80, movementRemaining: 20, moved: false, acted: false,
    };
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
      stamina: 100,
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

  it('allows a homeland host to start alone and fills the rest with AI forces', () => {
    const created = createOnlineRoom({ roomId: 'ABCD', hostPlayerId: 'host', hostName: 'Host', seed: 1, map: 'homeland' });
    // 大地图不同于小地图：房主一人选势力即可开局，其余势力由电脑代管
    expect(() => startOnlineRoom(created, { playerId: 'host' })).toThrow('所有玩家都需要选择势力');
    const ready = selectPlayerForce(created, { playerId: 'host', forceId: 'liu' });
    const started = startOnlineRoom(ready, { playerId: 'host' });

    expect(started.phase).toBe('playing');
    expect(started.state?.scenarioId).toBe('jingxiang-208');
    expect(started.state?.playerForceId).toBe('liu');
    expect(started.turnPlayerIds).toEqual(['host']);
  });

  it('limits a homeland lobby room to four players', () => {
    const created = createOnlineRoom({ roomId: 'ABCD', hostPlayerId: 'host', hostName: 'Host', seed: 1, map: 'homeland' });
    const joined = ['p2', 'p3'].reduce((room, playerId) =>
      joinOnlineRoom(room, { playerId, playerName: playerId }), created);
    const four = joinOnlineRoom(joined, { playerId: 'p4', playerName: 'p4' });

    expect(Object.keys(four.players).length).toBe(4);
    expect(() => joinOnlineRoom(four, { playerId: 'p5', playerName: 'p5' })).toThrow('大地图房间最多支持 4 名玩家');
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
      command: { type: 'patrol', cityId: 'jiangling', officerIds: ['liu-bei'] },
    });
    const wrongForce = reduceOnlineIntent(room, 'host', room.revision, {
      type: 'issueCommand',
      command: { type: 'patrol', cityId: 'xiangyang', officerIds: ['cao-ren'] },
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
      command: { type: 'patrol', cityId: 'jiangling', officerIds: ['liu-bei'] },
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

  it('联网：全部玩家点进行后，人类势力的委任同样自动执行（进驻空城 → 武将已行动）', () => {
    const room = structuredClone(readyHomelandRoom());
    if (!room.state) throw new Error('room state should exist');
    const state = room.state;

    // 找一处「无主空城 + 城外陆格站位」
    let targetCity: City | undefined;
    let spawn: { q: number; r: number } | undefined;
    for (const city of Object.values(state.cities)) {
      if (city.ownerId !== null || city.troops > 0) continue;
      const footprint = sevenCellCityFootprint({ q: city.gridQ, r: city.gridR });
      const footprintKeys = new Set(footprint.map((coord) => `${coord.q},${coord.r}`));
      for (const cell of footprint) {
        const found = neighborsOf(cell.q, cell.r)
          .find((coord) => cellAt(state, coord) && !footprintKeys.has(`${coord.q},${coord.r}`));
        if (found) {
          spawn = found;
          break;
        }
      }
      if (spawn) {
        targetCity = city;
        break;
      }
    }
    expect(targetCity).toBeDefined();
    expect(spawn).toBeDefined();
    if (!targetCity || !spawn) return;

    state.units['host-delegate-unit'] = {
      id: 'host-delegate-unit', kind: 'combat', forceId: 'liu', leaderId: 'liu-bei', officerIds: ['liu-bei'],
      homeCityId: 'jiangling', troopType: 'sword', q: spawn.q, r: spawn.r, troops: 3000, food: 6000,
      energy: 100, movementRemaining: 60, moved: false, acted: false,
      delegate: { kind: 'move', target: { q: targetCity.gridQ, r: targetCity.gridR } },
    };
    state.officers['liu-bei'].location = { kind: 'unit', unitId: 'host-delegate-unit' };

    const hostReady = reduceOnlineIntent(room, 'host', room.revision, { type: 'endTenDay' });
    expect(hostReady.ok).toBe(true);
    if (!hostReady.ok) return;
    const guestReady = reduceOnlineIntent(hostReady.room, 'guest', hostReady.room.revision, { type: 'endTenDay' });
    expect(guestReady.ok).toBe(true);
    if (!guestReady.ok) return;

    const next = guestReady.room.state;
    expect(next?.cities[targetCity.id].ownerId).toBe('liu');
    expect(next?.officers['liu-bei'].location).toEqual({ kind: 'city', cityId: targetCity.id });
    // 委任进驻的武将，新一旬仍为已行动
    expect(next?.officers['liu-bei'].acted).toBe(true);
  }, 30000);

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
    expect(result.room.state?.firePlots).toEqual([
      expect.objectContaining({ ...target, remainingTenDays: expect.any(Number) }),
    ]);
    expect(result.room.state?.firePlots?.[0].remainingTenDays).toBeGreaterThanOrEqual(1);
    expect(result.room.state?.firePlots?.[0].remainingTenDays).toBeLessThanOrEqual(3);
    expect(playerState(result.room, 'guest')?.firePlots).toEqual([
      expect.objectContaining({ ...target, remainingTenDays: expect.any(Number) }),
    ]);
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
      stamina: 100,
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
    expect(result.room.state?.units['host-strategy-unit']).toMatchObject({ stamina: 85, acted: true });
    expect(result.room.state?.units['guest-strategy-target'].confusedTenDays).toBeGreaterThanOrEqual(1);
    expect(result.room.state?.units['guest-strategy-target'].confusedTenDays).toBeLessThanOrEqual(3);
    expect(playerState(result.room, 'guest')?.units['guest-strategy-target'].confusedTenDays).toBe(
      result.room.state?.units['guest-strategy-target'].confusedTenDays,
    );
  });

  it.each([
    ['disturb', 85],
    ['discord', 80],
  ] as const)('matches the complete seeded %s outcome through local and online reducers', (strategyId, expectedStamina) => {
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
    expect(onlineOutcome.rngCursor).toBe(localStart.rngCursor + (strategyId === 'disturb' ? 2 : 1));
    expect(onlineOutcome.strategyResultReports).toEqual(localOutcome.strategyResultReports);
    expect(onlineOutcome.strategyResultReports).toEqual([expect.objectContaining({
      strategyId, succeeded: true, q: 9, r: 25,
    })]);
    expect(onlineOutcome.units['host-strategy-unit']).toMatchObject({ stamina: expectedStamina, acted: true });
    expect(localOutcome.units['host-strategy-unit']).toMatchObject({ stamina: expectedStamina, acted: true });

    if (strategyId === 'disturb') {
      expect(onlineOutcome.units['guest-strategy-target'].confusedTenDays).toBeGreaterThanOrEqual(1);
      expect(onlineOutcome.units['guest-strategy-target'].confusedTenDays).toBeLessThanOrEqual(3);
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

  it('keeps 百出 and 连环 cost, status duration, reports, and RNG identical online', () => {
    const room = readyStrategyRoom();
    if (!room.state) throw new Error('room state should exist');
    room.state.officers['liu-bei'].skill = '连环';
    room.state.officers['liu-bei'].stats.intelligence = 100;
    room.state.officers['liu-bei'].location = { kind: 'unit', unitId: 'host-strategy-unit' };
    room.state.officers['zhuge-liang'].skill = '百出';
    room.state.officers['zhuge-liang'].location = { kind: 'unit', unitId: 'host-strategy-unit' };
    room.state.officers['cao-cao'].stats.intelligence = 1;
    room.state.officers['cao-ren'].stats.intelligence = 1;
    room.state.units['host-strategy-unit'].officerIds = ['liu-bei', 'zhuge-liang'];
    room.state.units['host-strategy-unit'].stamina = 1;
    const localStart = playerState(room, 'host');
    if (!localStart) throw new Error('host state should exist');
    const intent = {
      type: 'useUnitStrategy' as const,
      unitId: 'host-strategy-unit',
      strategyId: 'disturb' as const,
      selection: { targetUnitId: 'guest-strategy-target' } as const,
    };

    const localOutcome = reduceGameIntent(localStart, 'liu', intent);
    const onlineResult = reduceOnlineIntent(room, 'host', room.revision, intent);

    expect(onlineResult.ok).toBe(true);
    if (!onlineResult.ok || !onlineResult.room.state) throw new Error('online strategy should succeed');
    const onlineOutcome = onlineResult.room.state;
    expect(onlineOutcome).toEqual(localOutcome);
    expect(onlineOutcome.units['host-strategy-unit']).toMatchObject({ stamina: 0, acted: true });
    expect(onlineOutcome.units['guest-strategy-target'].confusedTenDays).toBe(
      onlineOutcome.units['guest-discord-victim'].confusedTenDays,
    );
    expect(onlineOutcome.rngCursor).toBe(localStart.rngCursor + 2);
    expect(onlineOutcome.strategyResultReports).toEqual(localOutcome.strategyResultReports);
  });

  it('keeps guaranteed occupied-target 火神 fire identical through direct and online reducers', () => {
    const room = readyStrategyRoom();
    if (!room.state) throw new Error('room state should exist');
    room.state.officers['liu-bei'].skill = '火神';
    room.state.officers['liu-bei'].stats.intelligence = 100;
    room.state.officers['liu-bei'].location = { kind: 'unit', unitId: 'host-strategy-unit' };
    room.state.officers['cao-cao'].stats.intelligence = 1;
    room.state.officers['cao-cao'].location = { kind: 'unit', unitId: 'guest-strategy-target' };
    const localStart = playerState(room, 'host');
    if (!localStart) throw new Error('host state should exist');
    const intent = {
      type: 'useUnitStrategy' as const,
      unitId: 'host-strategy-unit',
      strategyId: 'fire' as const,
      selection: { coord: { q: 9, r: 25 } } as const,
    };

    const localOutcome = reduceGameIntent(localStart, 'liu', intent);
    const onlineResult = reduceOnlineIntent(room, 'host', room.revision, intent);

    expect(onlineResult.ok).toBe(true);
    if (!onlineResult.ok || !onlineResult.room.state) throw new Error('online strategy should succeed');
    const onlineOutcome = onlineResult.room.state;
    expect(onlineOutcome).toEqual(localOutcome);
    expect(onlineOutcome.strategyResultReports).toEqual([
      expect.objectContaining({ strategyId: 'fire', succeeded: true, q: 9, r: 25 }),
    ]);
    expect(onlineOutcome.firePlots).toContainEqual(expect.objectContaining({ q: 9, r: 25 }));
    expect(onlineOutcome.units['guest-strategy-target'].troops).toBe(2000);
    expect(onlineOutcome.battleDamageReports).toEqual([
      expect.objectContaining({ unitId: 'guest-strategy-target', amount: 1000, q: 9, r: 25 }),
    ]);
    expect(onlineOutcome.units['host-strategy-unit']).toMatchObject({ stamina: 90, acted: true });
    expect(onlineOutcome.rngCursor).toBe(localStart.rngCursor + 1);
  });

  it('keeps hostile fire rejection by target 火神 identical through direct and online reducers', () => {
    const room = readyStrategyRoom();
    if (!room.state) throw new Error('room state should exist');
    room.state.officers['liu-bei'].skill = '无';
    room.state.officers['liu-bei'].location = { kind: 'unit', unitId: 'host-strategy-unit' };
    room.state.officers['cao-cao'].skill = '火神';
    room.state.officers['cao-cao'].location = { kind: 'unit', unitId: 'guest-strategy-target' };
    const localStart = playerState(room, 'host');
    if (!localStart) throw new Error('host state should exist');
    const intent = {
      type: 'useUnitStrategy' as const,
      unitId: 'host-strategy-unit',
      strategyId: 'fire' as const,
      selection: { coord: { q: 9, r: 25 } } as const,
    };

    const localOutcome = reduceGameIntent(localStart, 'liu', intent);
    const onlineResult = reduceOnlineIntent(room, 'host', room.revision, intent);

    expect(onlineResult.ok).toBe(true);
    if (!onlineResult.ok || !onlineResult.room.state) throw new Error('online strategy should succeed');
    const onlineOutcome = onlineResult.room.state;
    expect(onlineOutcome).toEqual(localOutcome);
    expect(onlineOutcome.strategyResultReports).toEqual([
      expect.objectContaining({ strategyId: 'fire', succeeded: false, q: 9, r: 25 }),
    ]);
    expect(onlineOutcome.firePlots ?? []).not.toContainEqual(expect.objectContaining({ q: 9, r: 25 }));
    expect(onlineOutcome.units['guest-strategy-target'].troops).toBe(3000);
    expect(onlineOutcome.battleDamageReports).toEqual([]);
    expect(onlineOutcome.units['host-strategy-unit']).toMatchObject({ stamina: 90, acted: true });
    expect(onlineOutcome.rngCursor).toBe(localStart.rngCursor);
  });

  it('keeps hostile disturb rejection by target 洞察 identical through direct and online reducers', () => {
    const room = readyStrategyRoom();
    if (!room.state) throw new Error('room state should exist');
    room.state.officers['liu-bei'].skill = '无';
    room.state.officers['liu-bei'].location = { kind: 'unit', unitId: 'host-strategy-unit' };
    room.state.officers['cao-cao'].skill = '洞察';
    room.state.officers['cao-cao'].location = { kind: 'unit', unitId: 'guest-strategy-target' };
    const localStart = playerState(room, 'host');
    if (!localStart) throw new Error('host state should exist');
    const intent = {
      type: 'useUnitStrategy' as const,
      unitId: 'host-strategy-unit',
      strategyId: 'disturb' as const,
      selection: { targetUnitId: 'guest-strategy-target' } as const,
    };

    const localOutcome = reduceGameIntent(localStart, 'liu', intent);
    const onlineResult = reduceOnlineIntent(room, 'host', room.revision, intent);

    expect(onlineResult.ok).toBe(true);
    if (!onlineResult.ok || !onlineResult.room.state) throw new Error('online strategy should succeed');
    const onlineOutcome = onlineResult.room.state;
    expect(onlineOutcome).toEqual(localOutcome);
    expect(onlineOutcome.strategyResultReports).toEqual([
      expect.objectContaining({ strategyId: 'disturb', succeeded: false, q: 9, r: 25 }),
    ]);
    expect(onlineOutcome.units['guest-strategy-target'].confusedTenDays).toBeUndefined();
    expect(onlineOutcome.battleDamageReports).toEqual([]);
    expect(onlineOutcome.units['host-strategy-unit']).toMatchObject({ stamina: 85, acted: true });
    expect(onlineOutcome.rngCursor).toBe(localStart.rngCursor);
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
      command: { type: 'patrol', cityId: 'xiangyang', officerIds: ['cao-ren'] },
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
    addTurnStartMusicians(room);
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
    // cao 箭楼位于襄阳（要塞特性、cao 领地）境内，伤害 300×1.5=450
    expect(hostDone.room.state?.units['liu-target'].troops).toBe(2550);
    expect(hostDone.room.state?.units['cao-target'].troops).toBe(3000);
    expect(hostDone.room.state?.units['guest-musician'].energy).toBe(85);
    expect(hostDone.room.state?.units['host-musician'].energy).toBe(80);
    expect((hostDone.room.state?.battleDamageReports ?? []).map((report) => report.unitId)).toEqual(['liu-target']);
  });

  it('keeps seeded 乐奏 handoff units, facility reports, resources, and RNG identical to direct settlement', () => {
    const room = readyStartedRoom();
    addTurnStartMusicians(room);
    if (!room.state) throw new Error('room state should exist');
    room.seed = 73;
    room.state.seed = 73;
    room.state.rngCursor = 0;
    room.state.units['handoff-target'] = {
      id: 'handoff-target', kind: 'combat', forceId: 'liu', leaderId: 'liu-bei', officerIds: ['liu-bei'],
      homeCityId: 'jiangling', troopType: 'spear', q: 12, r: 10, troops: 3000, food: 3000,
      energy: 80, movementRemaining: 20, moved: false, acted: false,
    };
    room.state.facilities = {
      handoffTower: {
        id: 'handoffTower', type: 'arrowTower', forceId: 'cao', q: 10, r: 10, durability: 700, completed: true,
      },
    };
    const local = playerState(room, 'host');
    if (!local) throw new Error('host state should exist');
    local.battleDamageReports = [];
    local.facilityRepairReports = [];
    local.strategyResultReports = [];

    settleForceTurnStart(local, 'cao');
    const online = reduceOnlineIntent(room, 'host', room.revision, { type: 'endTenDay' });

    expect(online.ok).toBe(true);
    if (!online.ok) throw new Error('online handoff should succeed');
    const onlineGuest = playerState(online.room, 'guest');
    if (!onlineGuest) throw new Error('guest state should exist');
    expect({ ...onlineGuest, playerForceId: local.playerForceId, turnForceId: local.turnForceId }).toEqual(local);
    expect(onlineGuest.units['guest-musician'].energy).toBe(85);
    expect(local.units['guest-musician'].energy).toBe(85);
    expect(onlineGuest.battleDamageReports).toEqual(local.battleDamageReports);
    expect(onlineGuest.battleDamageReports?.map((report) => report.unitId)).toEqual(['handoff-target']);
    expect(onlineGuest.rngCursor).toBe(local.rngCursor);
  });

  it('fires only the first active player arrow towers when online players advance to the next ten-day turn', () => {
    const room = readyStartedRoom();
    addTurnStartMusicians(room);
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
    expect(hostDone.room.state?.units['guest-musician'].energy).toBe(85);
    expect(hostDone.room.state?.units['host-musician'].energy).toBe(80);
    const guestDone = reduceOnlineIntent(hostDone.room, 'guest', hostDone.room.revision, { type: 'endTenDay' });

    expect(guestDone.ok).toBe(true);
    if (!guestDone.ok) return;
    expect(guestDone.room.state?.tenDay).toBe(2);
    // cao 箭楼位于襄阳（要塞特性、cao 领地）境内，伤害 300×1.5=450；liu 箭楼在敌方境内无加成，伤害 300
    expect(guestDone.room.state?.units['liu-target'].troops).toBe(2550);
    expect(guestDone.room.state?.units['cao-target'].troops).toBe(2700);
    expect(guestDone.room.state?.units['host-musician'].energy).toBe(90);
    expect(guestDone.room.state?.units['guest-musician'].energy).toBe(90);
    expect((guestDone.room.state?.battleDamageReports ?? []).map((report) => report.unitId)).toEqual(['cao-target']);
  });

  it('settles facilities and 乐奏 once before each unoccupied AI force turn', () => {
    const room = readyStartedRoom();
    room.state!.officers['biao-musician-leader'] = {
      ...room.state!.officers['liu-bei'],
      id: 'biao-musician-leader',
      name: 'Biao Musician',
      forceId: 'biao',
      cityId: 'lingling',
      location: { kind: 'unit', unitId: 'biao-musician' },
      skill: '乐奏',
      acted: false,
    };
    room.state!.units['biao-musician'] = {
      id: 'biao-musician',
      kind: 'combat',
      forceId: 'biao',
      leaderId: 'biao-musician-leader',
      officerIds: ['biao-musician-leader'],
      homeCityId: 'lingling',
      troopType: 'spear',
      q: 12,
      r: 10,
      troops: 4000,
      food: 4000,
      energy: 60,
      stamina: 40,
      movementRemaining: 20,
      moved: false,
      acted: false,
    };
    room.state!.facilities = {
      biaoMusic: {
        id: 'biaoMusic',
        type: 'musicTower',
        forceId: 'biao',
        q: 10,
        r: 10,
        durability: 800,
        completed: true,
      },
    };

    const hostDone = reduceOnlineIntent(room, 'host', room.revision, { type: 'endTenDay' });
    expect(hostDone.ok).toBe(true);
    if (!hostDone.ok) return;
    const guestDone = reduceOnlineIntent(hostDone.room, 'guest', hostDone.room.revision, { type: 'endTenDay' });

    expect(guestDone.ok).toBe(true);
    if (!guestDone.ok) return;
    // 气力：每旬基础 +5 + 乐奏 +5；军乐台只回战力（+6），不回气力
    expect(guestDone.room.state?.units['biao-musician'].energy).toBe(70);
    expect(guestDone.room.state?.units['biao-musician'].stamina).toBe(40 + (room.state?.officers['biao-musician-leader'].stats.politics ?? 0) * 0.12 + 6);
  });
});
