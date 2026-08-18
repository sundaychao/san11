import { describe, expect, it } from 'vitest';
import { createGame } from '../../scenario/jingxiang208';
import type { TroopType } from '../../types';
import { formationMovementAllowanceBonus, movementAllowanceBonus, unitIgnoresEnemyZoc } from '../index';

function stateWithSkillUnit(skill: string, troopType: TroopType) {
  const state = createGame('liu', 1);
  state.officers['liu-bei'].skill = skill;
  state.units.test = {
    id: 'test', kind: 'combat', forceId: 'liu', leaderId: 'liu-bei', officerIds: ['liu-bei'],
    homeCityId: 'jiangling', troopType, q: 0, r: 0, troops: 4000, food: 4000,
    energy: 100, movementRemaining: 30, moved: false, acted: false,
  };
  return state;
}

describe('movement skill rules', () => {
  it('exports the pure movement projections', () => {
    expect(movementAllowanceBonus).toBeTypeOf('function');
    expect(formationMovementAllowanceBonus).toBeTypeOf('function');
    expect(unitIgnoresEnemyZoc).toBeTypeOf('function');
  });

  it.each(['sword', 'spear', 'halberd', 'crossbow', 'cavalry'] as const)(
    'adds exactly five movement to a %s combat land formation with 强行',
    (troopType) => {
      const state = stateWithSkillUnit('强行', troopType);

      expect(movementAllowanceBonus(state, state.units.test)).toBe(5);
    },
  );

  it('does not add 强行 movement to siege or transport formations', () => {
    const state = stateWithSkillUnit('强行', 'siege');

    expect(movementAllowanceBonus(state, state.units.test)).toBe(0);
    state.units.test.kind = 'transport';
    state.units.test.troopType = 'spear';
    expect(movementAllowanceBonus(state, state.units.test)).toBe(0);
  });

  it('uses leader and deputy skills without stacking duplicate 强行 names', () => {
    const state = stateWithSkillUnit('强行', 'spear');
    state.officers['guan-yu'].skill = '强行';
    state.units.test.officerIds = ['liu-bei', 'guan-yu'];

    expect(movementAllowanceBonus(state, state.units.test)).toBe(5);
    expect(formationMovementAllowanceBonus(state, ['liu-bei', 'guan-yu'], 'spear')).toBe(5);
  });

  it('lets 飞将 ignore enemy land zoc', () => {
    const state = stateWithSkillUnit('飞将', 'spear');

    expect(unitIgnoresEnemyZoc(state, state.units.test)).toBe(true);
    state.officers['liu-bei'].skill = '无';
    expect(unitIgnoresEnemyZoc(state, state.units.test)).toBe(false);
  });
});
