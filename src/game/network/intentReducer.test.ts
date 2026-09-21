import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  attackUnit,
  deployTransportUnitWithId,
  deployUnitWithId,
  deploymentCells,
  moveUnit,
  movementAllowanceForUnit,
  movementCells,
  supplyUnit,
} from '../battle/actions';
import { neighborsOf } from '../battle/grid';
import { hexGridDistance } from '../battle/deployment';
import { plotTargetKey } from '../battle/targetRules';
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
      energy: 100, stamina: 100, movementRemaining: 20, moved: false, acted: false,
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
    state.officers['guan-yu'].skill = '连击';
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
      name: '连击普通攻击',
      attackerSkill: '连击',
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
    } else if (name === '连击普通攻击') {
      expect(onlineState.battleDamageReports?.filter((report) => report.unitId === 'guest-unit')).toHaveLength(2);
    } else if (name === '百出扰乱') {
      expect(onlineState.units['host-unit']).toMatchObject({ stamina: 99, acted: true });
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

  it('turns a remote repair chosen during deployment into a repair delegation', () => {
    expect(typeof reduceGameIntent).toBe('function');
    if (!reduceGameIntent) return;

    const state = createGame('liu', 1);
    // 落位会消耗出征移动力：选离城心最近的部署格，保证本旬还有剩余移动力立即朝设施靠近
    const center = { q: state.cities.jiangling.gridQ, r: state.cities.jiangling.gridR };
    const spawn = deploymentCells(state, 'jiangling')
      .reduce((best, cell) => (hexGridDistance(cell, center) < hexGridDistance(best, center) ? cell : best));
    const input = {
      cityId: 'jiangling' as const,
      officerIds: ['guan-yu'],
      troopType: 'sword' as const,
      destination: spawn,
      troops: 4000,
      food: 6000,
    };
    // 出征后的目标设施不在出生格相邻范围：旧实现会直接调用 repairFacility 而拒绝这次操作。
    state.facilities = {
      repairing: {
        id: 'repairing',
        type: 'arrowTower',
        forceId: 'liu',
        q: spawn.q + 3,
        r: spawn.r,
        durability: 100,
        completed: false,
      },
    };

    const next = reduceGameIntent(state, 'liu', {
      type: 'deployUnitAction',
      input,
      action: { type: 'repairFacility', facilityId: 'repairing' },
    });
    const unit = Object.values(next.units).find((candidate) => candidate.leaderId === 'guan-yu');

    expect(unit).toBeDefined();
    expect(unit).toMatchObject({ delegate: { kind: 'repair', facilityId: 'repairing' }, moved: true });
    expect(unit).not.toMatchObject({ q: spawn.q, r: spawn.r });
    expect(next.facilities?.repairing.durability).toBe(100);
    expect(next.facilityRepairReports).toEqual([]);
  });

  it('keeps transport deployment plus its follow-up action atomic (落位菜单出城即攻击)', () => {
    expect(typeof reduceGameIntent).toBe('function');
    if (!reduceGameIntent) return;

    const state = createGame('liu', 1);
    const destination = deploymentCells(state, 'jiangling', undefined, 'transport')[0]!;
    const input = {
      cityId: 'jiangling' as const,
      officerIds: ['guan-yu'],
      destination,
      troops: 4000,
      gold: 0,
      food: 6000,
    };
    // 在落位格相邻处放一支敌部队（出城后立即攻击的目标）
    const adjacent = neighborsOf(destination.q, destination.r)
      .find((coord) => coord.q !== destination.q || coord.r !== destination.r)!;
    state.units['enemy-near'] = {
      id: 'enemy-near',
      kind: 'combat',
      forceId: 'cao',
      leaderId: 'xiahou-dun',
      officerIds: ['xiahou-dun'],
      homeCityId: 'xuchang',
      troopType: 'sword',
      vehicle: 'boat',
      q: adjacent.q,
      r: adjacent.r,
      troops: 4000,
      gold: 0,
      food: 2000,
      energy: 100,
      stamina: 100,
      movementRemaining: 0,
      moved: true,
      acted: false,
    };

    // 待命跟随 = 纯部署
    const deployed = deployTransportUnitWithId(state, 'liu', input);
    expect(reduceGameIntent(state, 'liu', {
      type: 'deployTransportUnit',
      input,
      action: { type: 'wait' },
    })).toEqual(deployed.state);

    // 攻击跟随：与「部署 → attackUnit」同口径 —— 部署出的输送队直接攻击相邻敌部队
    const expected = attackUnit(deployed.state, 'liu', deployed.unitId, 'enemy-near');
    const result = reduceGameIntent(state, 'liu', {
      type: 'deployTransportUnit',
      input,
      action: { type: 'attackUnit', targetId: 'enemy-near' },
    });
    expect(result.units[deployed.unitId]).toBeDefined();
    expect(result.units['enemy-near'].troops).toBe(expected.units['enemy-near'].troops);
    expect(result.units['enemy-near'].troops).toBeLessThan(4000);
  });

  it('keeps transport deployment plus supply follow-up atomic (落位菜单出城即补给)', () => {
    expect(typeof reduceGameIntent).toBe('function');
    if (!reduceGameIntent) return;

    const state = createGame('liu', 1);
    const destination = deploymentCells(state, 'jiangling', undefined, 'transport')[0]!;
    const input = {
      cityId: 'jiangling' as const,
      officerIds: ['guan-yu'],
      destination,
      troops: 4000,
      gold: 3000,
      food: 6000,
    };
    // 在落位格相邻处放一支己方作战部队（出城后立即补给的目标）
    const adjacent = neighborsOf(destination.q, destination.r)
      .find((coord) => coord.q !== destination.q || coord.r !== destination.r)!;
    state.units['friend-near'] = {
      id: 'friend-near',
      kind: 'combat',
      forceId: 'liu',
      leaderId: 'liu-bei',
      officerIds: ['liu-bei'],
      homeCityId: 'jiangling',
      troopType: 'sword',
      q: adjacent.q,
      r: adjacent.r,
      troops: 3000,
      gold: 0,
      food: 3000,
      energy: 100,
      movementRemaining: 0,
      moved: true,
      acted: false,
    };

    // 补给跟随 = 「部署 → supplyUnit」两步的合成结果
    const deployed = deployTransportUnitWithId(state, 'liu', input);
    const expected = supplyUnit(deployed.state, 'liu', deployed.unitId, 'friend-near', {
      troops: 1000,
      gold: 1500,
      food: 2000,
    });
    const result = reduceGameIntent(state, 'liu', {
      type: 'deployTransportUnit',
      input,
      action: { type: 'supplyUnit', targetId: 'friend-near', troops: 1000, gold: 1500, food: 2000 },
    });
    expect(result).toEqual(expected);
    // 落位即补给一步到位：运输队已行动、资源转清
    expect(result.units[deployed.unitId]).toMatchObject({ troops: 3000, gold: 1500, acted: true });
    expect(result.units['friend-near']).toMatchObject({ troops: 4000, gold: 1500, food: 5000, acted: false });
  });

  it('routes a siege tactic aimed at a development plot down the structure channel', () => {
    expect(typeof reduceGameIntent).toBe('function');
    if (!reduceGameIntent) return;

    const state = createGame('liu', 1);
    for (const cell of state.grid) cell.terrain = 'plain';
    // 冲车贴着一格敌方（襄阳）开发设施：意图里的目标用 `cityId:plotIndex` 标识这个地格
    const plotCoord = neighborsOf(20, 20)[0];
    state.officers['guan-yu'].location = { kind: 'unit', unitId: 'siege' };
    state.units.siege = {
      id: 'siege',
      kind: 'combat',
      forceId: 'liu',
      leaderId: 'guan-yu',
      officerIds: ['guan-yu'],
      homeCityId: 'jiangling',
      troopType: 'siege',
      siegeWeapon: 'ram',
      q: 20,
      r: 20,
      troops: 6000,
      food: 6000,
      stamina: 100,
      energy: 100,
      movementRemaining: 16,
      moved: false,
      acted: false,
    };
    state.cities.xiangyang.plots = [
      { id: 'p-market', type: 'market', level: 1, value: 0, q: plotCoord.q, r: plotCoord.r, durability: 5000 },
    ];

    const after = reduceGameIntent(state, 'liu', {
      type: 'useUnitTactic',
      attackerId: 'siege',
      targetId: plotTargetKey('xiangyang', 0),
      tacticId: 'siege-break',
    });

    // 落到普攻的建筑通道：扣地格耐久 + 扣战力（不是打在部队上的兵力伤害）
    expect(after.cities.xiangyang.plots![0].durability).toBeLessThan(5000);
    expect(after.units.siege).toMatchObject({ stamina: 80, energy: 100, acted: true });
  });
});
