import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  attackUnit,
  deployUnitWithId,
  deploymentCells,
  moveUnit,
  movementAllowanceForUnit,
  movementCells,
} from '../battle/actions';
import { neighborsOf } from '../battle/grid';
import { createGame } from '../scenario/jingxiang208';
import type { ForceId, GameState } from '../types';
import type { GameIntent } from './intents';
import * as intentReducerModule from './intentReducer';
import {
  createOnlineRoom,
  joinOnlineRoom,
  playerState,
  reduceOnlineIntent,
  selectPlayerForce,
  startOnlineRoom,
} from './session';

type ActionIntent = Exclude<GameIntent, { type: 'endTenDay' }>;

function skillRoomFixture(attackerSkill: string, defenderSkill: string, seed: number) {
  const created = createOnlineRoom({ roomId: 'SKIL', hostPlayerId: 'host', hostName: 'Host', seed });
  const joined = joinOnlineRoom(created, { playerId: 'guest', playerName: 'Guest' });
  const selected = selectPlayerForce(
    selectPlayerForce(joined, { playerId: 'host', forceId: 'liu' }),
    { playerId: 'guest', forceId: 'cao' },
  );
  const room = startOnlineRoom(selected, { playerId: 'host' });
  if (!room.state) throw new Error('room state should exist');

  room.seed = seed;
  room.state.seed = seed;
  room.state.rngCursor = 0;
  room.state.officers['liu-bei'].skill = attackerSkill;
  room.state.officers['liu-bei'].stats.war = 100;
  room.state.officers['liu-bei'].stats.intelligence = 100;
  room.state.officers['liu-bei'].location = { kind: 'unit', unitId: 'host-unit' };
  room.state.officers['cao-cao'].skill = defenderSkill;
  room.state.officers['cao-cao'].stats.war = 1;
  room.state.officers['cao-cao'].stats.intelligence = 1;
  room.state.officers['cao-cao'].location = { kind: 'unit', unitId: 'guest-unit' };
  room.state.units = {
    'host-unit': {
      id: 'host-unit', kind: 'combat', forceId: 'liu', leaderId: 'liu-bei', officerIds: ['liu-bei'],
      homeCityId: 'jiangling', troopType: 'spear', q: 10, r: 10, troops: 10000, gold: 1000, food: 10000,
      energy: 100, movementRemaining: 20, moved: false, acted: false,
    },
    'guest-unit': {
      id: 'guest-unit', kind: 'combat', forceId: 'cao', leaderId: 'cao-cao', officerIds: ['cao-cao'],
      homeCityId: 'xiangyang', troopType: 'spear', q: 11, r: 10, troops: 10000, food: 10000,
      energy: 100, movementRemaining: 20, moved: false, acted: false,
    },
  };
  room.state.facilities = {};
  room.state.firePlots = [];
  room.state.battleDamageReports = [];
  room.state.facilityRepairReports = [];
  room.state.strategyResultReports = [];
  return room;
}

function withoutPersonalization(state: GameState) {
  const comparable = structuredClone(state) as Partial<GameState>;
  delete comparable.playerForceId;
  delete comparable.turnForceId;
  return comparable;
}

it('provides a shared game intent reducer module', () => {
  expect(existsSync(resolve(process.cwd(), 'src/game/network/intentReducer.ts'))).toBe(true);
});

describe('reduceGameIntent', () => {
  const reduceGameIntent = (intentReducerModule as {
    reduceGameIntent?: (
      state: GameState,
      forceId: ForceId,
      intent: Exclude<GameIntent, { type: 'endTenDay' }>,
    ) => GameState;
  }).reduceGameIntent;

  it('applies a move intent through the shared rules entry point', () => {
    expect(typeof reduceGameIntent).toBe('function');
    if (!reduceGameIntent) return;

    const state = createGame('liu', 1);
    const spawn = deploymentCells(state, 'jiangling')[0];
    const deployed = deployUnitWithId(state, 'liu', {
      cityId: 'jiangling',
      officerIds: ['guan-yu'],
      troopType: 'sword',
      destination: spawn,
      troops: 4000,
      food: 6000,
    });
    const ready = structuredClone(deployed.state);
    ready.units[deployed.unitId].moved = false;
    ready.units[deployed.unitId].movementRemaining = movementAllowanceForUnit(ready.units[deployed.unitId]);
    const destination = movementCells(ready, deployed.unitId)[0];

    expect(reduceGameIntent(ready, 'liu', {
      type: 'moveUnit',
      unitId: deployed.unitId,
      destination,
    })).toEqual(moveUnit(ready, 'liu', deployed.unitId, destination));
  });

  it('keeps combat skill state and RNG identical for direct and intent-reduced attacks', () => {
    expect(typeof reduceGameIntent).toBe('function');
    if (!reduceGameIntent) return;

    const state = createGame('liu', 3214);
    state.officers['guan-yu'].skill = '连战';
    state.officers['guan-yu'].stats.war = 97;
    state.officers['guan-yu'].location = { kind: 'unit', unitId: 'parity-attacker' };
    state.officers['liu-bei'].skill = '神将';
    state.officers['cao-ren'].skill = '不屈';
    state.officers['cao-ren'].stats.war = 60;
    state.officers['cao-ren'].location = { kind: 'unit', unitId: 'parity-target' };
    state.units = {
      'parity-attacker': {
        id: 'parity-attacker', kind: 'combat', forceId: 'liu', leaderId: 'guan-yu', officerIds: ['guan-yu', 'liu-bei'],
        homeCityId: 'jiangling', troopType: 'spear', q: 10, r: 10, troops: 6000, food: 6000,
        energy: 100, movementRemaining: 20, moved: false, acted: false,
      },
      'parity-target': {
        id: 'parity-target', kind: 'combat', forceId: 'cao', leaderId: 'cao-ren', officerIds: ['cao-ren'],
        homeCityId: 'xiangyang', troopType: 'spear', q: 11, r: 10, troops: 2999, food: 6000,
        energy: 100, movementRemaining: 20, moved: false, acted: false,
      },
    };

    const direct = attackUnit(state, 'liu', 'parity-attacker', 'parity-target');
    const reduced = reduceGameIntent(state, 'liu', {
      type: 'attackUnit', attackerId: 'parity-attacker', targetId: 'parity-target',
    });

    expect(reduced).toEqual(direct);
    expect(reduced.rngCursor).toBe(state.rngCursor + 6);
  });

  it.each([
    {
      name: '神将普通攻击',
      attackerSkill: '神将',
      defenderSkill: '无',
      seed: 1,
      intent: { type: 'attackUnit', attackerId: 'host-unit', targetId: 'guest-unit' },
      expectedCursor: 2,
    },
    {
      name: '连战普通攻击',
      attackerSkill: '连战',
      defenderSkill: '无',
      seed: 1,
      intent: { type: 'attackUnit', attackerId: 'host-unit', targetId: 'guest-unit' },
      expectedCursor: 4,
    },
    {
      name: '百出扰乱',
      attackerSkill: '百出',
      defenderSkill: '无',
      seed: 1,
      intent: {
        type: 'useUnitStrategy', unitId: 'host-unit', strategyId: 'disturb',
        selection: { targetUnitId: 'guest-unit' },
      },
      expectedCursor: 2,
    },
    {
      name: '火神火计',
      attackerSkill: '火神',
      defenderSkill: '无',
      seed: 1,
      intent: {
        type: 'useUnitStrategy', unitId: 'host-unit', strategyId: 'fire',
        selection: { coord: { q: 11, r: 10 } },
      },
      expectedCursor: 1,
    },
    {
      name: '洞察防御',
      attackerSkill: '无',
      defenderSkill: '洞察',
      seed: 1,
      intent: {
        type: 'useUnitStrategy', unitId: 'host-unit', strategyId: 'disturb',
        selection: { targetUnitId: 'guest-unit' },
      },
      expectedCursor: 0,
    },
  ] satisfies Array<{
    name: string;
    attackerSkill: string;
    defenderSkill: string;
    seed: number;
    intent: ActionIntent;
    expectedCursor: number;
  }>)('keeps seeded local and online $name outcomes identical', ({
    name, attackerSkill, defenderSkill, seed, intent, expectedCursor,
  }) => {
    expect(typeof reduceGameIntent).toBe('function');
    if (!reduceGameIntent) return;
    const room = skillRoomFixture(attackerSkill, defenderSkill, seed);
    const localStart = playerState(room, 'host');
    if (!localStart) throw new Error('host state should exist');

    const local = reduceGameIntent(localStart, 'liu', intent);
    const online = reduceOnlineIntent(room, 'host', room.revision, intent);

    expect(online.ok).toBe(true);
    if (!online.ok) throw new Error('online skill action should succeed');
    const onlineState = playerState(online.room, 'host');
    if (!onlineState) throw new Error('online host state should exist');
    expect(withoutPersonalization(onlineState)).toEqual(withoutPersonalization(local));
    expect(onlineState.rngCursor).toBe(expectedCursor);

    if (name === '神将普通攻击') {
      expect(onlineState.battleDamageReports?.[0]).toMatchObject({ unitId: 'guest-unit', critical: true, label: '暴击' });
    } else if (name === '连战普通攻击') {
      expect(onlineState.battleDamageReports?.filter((report) => report.unitId === 'guest-unit')).toHaveLength(2);
    } else if (name === '百出扰乱') {
      expect(onlineState.units['host-unit']).toMatchObject({ energy: 99, acted: true });
      expect(onlineState.strategyResultReports?.[0]).toMatchObject({ strategyId: 'disturb', succeeded: true });
    } else if (name === '火神火计') {
      expect(onlineState.units['guest-unit'].troops).toBe(9000);
      expect(onlineState.firePlots).toContainEqual(expect.objectContaining({ q: 11, r: 10 }));
    } else {
      expect(onlineState.units['guest-unit'].confusedTenDays).toBeUndefined();
      expect(onlineState.strategyResultReports?.[0]).toMatchObject({ strategyId: 'disturb', succeeded: false });
    }
  });

  it('keeps seeded 筑城 facility state, reports, resources, and RNG identical online', () => {
    expect(typeof reduceGameIntent).toBe('function');
    if (!reduceGameIntent) return;
    const room = skillRoomFixture('筑城', '无', 73);
    const localStart = playerState(room, 'host');
    if (!localStart) throw new Error('host state should exist');
    const target = neighborsOf(10, 10).find((coord) => coord.q !== 11 || coord.r !== 10);
    if (!target) throw new Error('build target should exist');
    const intent = {
      type: 'buildFacility' as const,
      unitId: 'host-unit',
      facilityType: 'arrowTower' as const,
      target,
    };

    const local = reduceGameIntent(localStart, 'liu', intent);
    const online = reduceOnlineIntent(room, 'host', room.revision, intent);

    expect(online.ok).toBe(true);
    if (!online.ok) throw new Error('online build should succeed');
    const onlineState = playerState(online.room, 'host');
    if (!onlineState) throw new Error('online host state should exist');
    expect(withoutPersonalization(onlineState)).toEqual(withoutPersonalization(local));
    expect(onlineState.facilities).toEqual(local.facilities);
    expect(onlineState.units).toEqual(local.units);
    expect(onlineState.facilityRepairReports).toEqual(local.facilityRepairReports);
    expect(onlineState.rngCursor).toBe(local.rngCursor);
    expect(Object.values(onlineState.facilities ?? {})[0]).toMatchObject({ durability: 700, completed: true });
    expect(onlineState.units['host-unit'].gold).toBe(localStart.units['host-unit'].gold! - 600);
  });

  it('keeps deployment plus its follow-up action atomic', () => {
    expect(typeof reduceGameIntent).toBe('function');
    if (!reduceGameIntent) return;

    const state = createGame('liu', 1);
    const input = {
      cityId: 'jiangling' as const,
      officerIds: ['guan-yu'],
      troopType: 'sword' as const,
      destination: deploymentCells(state, 'jiangling')[0],
      troops: 4000,
      food: 6000,
    };
    const expected = deployUnitWithId(state, 'liu', input);

    expect(reduceGameIntent(state, 'liu', {
      type: 'deployUnitAction',
      input,
      action: { type: 'wait' },
    })).toEqual(expected.state);
  });
});
