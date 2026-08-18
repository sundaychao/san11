import { describe, expect, it } from 'vitest';
import { createGame } from '../../scenario/jingxiang208';
import { applyForceTurnStartSkillEffects, settleForceTurnStart } from './turn';

describe('force turn-start officer skill rules', () => {
  it('restores exactly five energy without duplicate-name stacking, caps at 100, and excludes enemy forces', () => {
    const state = createGame('liu', 1);
    state.officers['liu-bei'].skill = '乐奏';
    state.officers['guan-yu'].skill = '乐奏';
    state.officers['cao-ren'].skill = '乐奏';
    state.units.musician = {
      id: 'musician', kind: 'combat', forceId: 'liu', leaderId: 'liu-bei', officerIds: ['liu-bei', 'guan-yu'],
      homeCityId: 'jiangling', troopType: 'spear', q: 20, r: 20, troops: 4000, food: 4000,
      energy: 90, movementRemaining: 20, moved: false, acted: false,
    };
    state.units.enemyMusician = {
      id: 'enemyMusician', kind: 'combat', forceId: 'cao', leaderId: 'cao-ren', officerIds: ['cao-ren'],
      homeCityId: 'xiangyang', troopType: 'spear', q: 21, r: 20, troops: 4000, food: 4000,
      energy: 80, movementRemaining: 20, moved: false, acted: false,
    };

    applyForceTurnStartSkillEffects(state, 'liu');
    expect(state.units.musician.energy).toBe(95);
    expect(state.units.enemyMusician.energy).toBe(80);

    applyForceTurnStartSkillEffects(state, 'liu');
    applyForceTurnStartSkillEffects(state, 'liu');
    expect(state.units.musician.energy).toBe(100);
  });

  it('settles active-force facilities before applying that force skill effects', () => {
    const state = createGame('liu', 1);
    state.officers['liu-bei'].skill = '乐奏';
    state.units.musician = {
      id: 'musician', kind: 'combat', forceId: 'liu', leaderId: 'liu-bei', officerIds: ['liu-bei'],
      homeCityId: 'jiangling', troopType: 'spear', q: 20, r: 20, troops: 4000, food: 4000,
      energy: 80, movementRemaining: 20, moved: false, acted: false,
    };
    state.units.target = {
      id: 'target', kind: 'combat', forceId: 'cao', leaderId: 'cao-ren', officerIds: ['cao-ren'],
      homeCityId: 'xiangyang', troopType: 'spear', q: 12, r: 10, troops: 3000, food: 3000,
      energy: 80, movementRemaining: 20, moved: false, acted: false,
    };
    state.facilities = {
      tower: { id: 'tower', type: 'arrowTower', forceId: 'liu', q: 10, r: 10, durability: 700, completed: true },
    };

    settleForceTurnStart(state, 'liu');

    expect(state.units.target.troops).toBe(2700);
    expect(state.units.musician.energy).toBe(85);
    expect(state.battleDamageReports?.map((report) => report.unitId)).toEqual(['target']);
  });
});
