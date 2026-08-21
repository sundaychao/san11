import { describe, expect, it } from 'vitest';
import { createGame } from '../scenario/jingxiang208';
import { eventsForIntent } from './events';

describe('game engine events', () => {
  it('describes a successful move without mentioning a renderer or sound', () => {
    const before = createGame('liu', 1);
    before.units.scout = {
      id: 'scout', kind: 'combat', forceId: 'liu', leaderId: 'liu-bei',
      homeCityId: 'jiangling', troopType: 'sword', q: 10, r: 10, troops: 3000,
      food: 3000, energy: 100, movementRemaining: 20, moved: false, acted: false,
    };
    const after = structuredClone(before);
    after.units.scout.q = 10;
    after.units.scout.r = 11;

    expect(eventsForIntent(before, after, { type: 'moveUnit', unitId: 'scout', destination: { q: 10, r: 11 } })).toEqual([
      { type: 'unit-moved', unitId: 'scout', from: { q: 10, r: 10 }, to: { q: 10, r: 11 } },
    ]);
  });

  it('describes a strategy as a domain event instead of a sound effect', () => {
    const state = createGame('liu', 2);
    expect(eventsForIntent(state, state, {
      type: 'useUnitStrategy',
      unitId: 'unit-1',
      strategyId: 'fire',
      selection: { coord: { q: 10, r: 10 } },
    })).toEqual([
      { type: 'strategy-used', unitId: 'unit-1', strategyId: 'fire' },
    ]);
  });
});
