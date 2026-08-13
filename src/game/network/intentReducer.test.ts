import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
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
