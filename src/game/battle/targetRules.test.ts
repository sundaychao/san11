import { describe, expect, it } from 'vitest';
import { createGame } from '../scenario/jingxiang208';
import type { ArmyUnit } from '../types';
import { attackableUnits, areAdjacent, gridDistanceWithin } from './targetRules';

function unit(id: string, forceId: 'liu' | 'cao', q: number, r: number): ArmyUnit {
  return {
    id,
    kind: 'combat',
    forceId,
    leaderId: forceId === 'liu' ? 'liu-bei' : 'cao-ren',
    homeCityId: forceId === 'liu' ? 'jiangling' : 'xiangyang',
    troopType: 'crossbow',
    q,
    r,
    troops: 3000,
    food: 3000,
    energy: 100,
    movementRemaining: 20,
    moved: false,
    acted: false,
  };
}

describe('battle target rules', () => {
  it('keeps hex adjacency and range calculation independent from UI modules', () => {
    const state = createGame('liu', 1);
    const attacker = unit('attacker', 'liu', 10, 10);
    state.units = {
      attacker,
      adjacent: unit('adjacent', 'cao', 11, 10),
      inRange: unit('in-range', 'cao', 12, 10),
      outOfRange: unit('out-of-range', 'cao', 13, 10),
    };

    expect(areAdjacent(attacker, state.units.adjacent)).toBe(true);
    expect(gridDistanceWithin(attacker, state.units.outOfRange, 2)).toBeGreaterThan(2);
    expect(attackableUnits(state, attacker.id).map((target) => target.id)).toEqual(['adjacent', 'in-range']);
  });
});
