import { describe, expect, it } from 'vitest';
import { deployUnit, movementCells, waitUnit } from './actions';
import { createGame } from '../scenario/jingxiang208';

describe('unit plot status action blocking', () => {
  function readyStatusUnit(status: 'confusedTenDays' | 'falseReportedTenDays') {
    const state = deployUnit(createGame('liu', 1), 'liu', {
      cityId: 'jiangling',
      officerId: 'guan-yu',
      targetCityId: 'xiangyang',
      troops: 3000,
      food: 3000,
    });
    const unit = Object.values(state.units)[0];
    state.units[unit.id].moved = false;
    state.units[unit.id].acted = false;
    state.units[unit.id].movementRemaining = 22;
    state.units[unit.id][status] = 1;
    return { state, unitId: unit.id };
  }

  it('does not offer movement or actions to confused units', () => {
    const { state, unitId } = readyStatusUnit('confusedTenDays');

    expect(movementCells(state, unitId)).toEqual([]);
    expect(() => waitUnit(state, 'liu', unitId)).toThrow(/混乱/);
  });

  it('does not offer movement or actions to false-reported units', () => {
    const { state, unitId } = readyStatusUnit('falseReportedTenDays');

    expect(movementCells(state, unitId)).toEqual([]);
    expect(() => waitUnit(state, 'liu', unitId)).toThrow(/伪报/);
  });
});
