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
import { createGame } from '../scenario/jingxiang208';
import type { ForceId, GameState } from '../types';
import type { GameIntent } from './intents';
import * as intentReducerModule from './intentReducer';

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
