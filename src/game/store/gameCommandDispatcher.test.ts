import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, it } from 'vitest';
import {
  deployUnitWithId,
  deploymentCells,
  moveUnit,
  movementAllowanceForUnit,
  movementCells,
} from '../battle/actions';
import { createGame } from '../scenario/jingxiang208';
import type { GameState } from '../types';
import type { ActionGameIntent } from '../network/intentReducer';
import * as dispatcherModule from './gameCommandDispatcher';

it('provides a local game intent dispatcher module', () => {
  expect(existsSync(resolve(process.cwd(), 'src/game/store/gameCommandDispatcher.ts'))).toBe(true);
});

it('uses the player force when applying a local intent', () => {
  const applyLocalIntent = (dispatcherModule as {
    applyLocalIntent?: (state: GameState, intent: ActionGameIntent) => GameState;
  }).applyLocalIntent;
  expect(typeof applyLocalIntent).toBe('function');
  if (!applyLocalIntent) return;

  const initial = createGame('liu', 1);
  const deployed = deployUnitWithId(initial, 'liu', {
    cityId: 'jiangling',
    officerIds: ['guan-yu'],
    troopType: 'sword',
    destination: deploymentCells(initial, 'jiangling')[0],
    troops: 4000,
    food: 6000,
  });
  const ready = structuredClone(deployed.state);
  ready.units[deployed.unitId].moved = false;
  ready.units[deployed.unitId].movementRemaining = movementAllowanceForUnit(ready.units[deployed.unitId]);
  const destination = movementCells(ready, deployed.unitId)[0];
  const intent: ActionGameIntent = { type: 'moveUnit', unitId: deployed.unitId, destination };

  expect(applyLocalIntent(ready, intent)).toEqual(moveUnit(ready, 'liu', deployed.unitId, destination));
});
