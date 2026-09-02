import { describe, expect, it } from 'vitest';
import { createGame } from '../../scenario/jingxiang208';
import { SUPPORT_SKILLS } from '../catalog/support';
import { facilityBuildPowerMultiplier } from './facility';

describe('facility officer skill rules', () => {
  it('activates 规律/沉着/明镜/乐奏/筑城 in the support catalog', () => {
    expect(SUPPORT_SKILLS
      .filter((definition) => definition.implementationStatus === 'active')
      .map((definition) => definition.name)).toEqual(['规律', '沉着', '明镜', '乐奏', '诗想', '筑城']);
  });

  it('uses deputy-provided 筑城 without stacking duplicate names', () => {
    const state = createGame('liu', 1);
    state.officers['guan-yu'].skill = '筑城';
    state.officers['zhang-fei'].skill = '筑城';
    state.officers['guan-yu'].location = { kind: 'unit', unitId: 'builder' };
    state.officers['zhang-fei'].location = { kind: 'unit', unitId: 'builder' };
    state.units.builder = {
      id: 'builder', kind: 'combat', forceId: 'liu', leaderId: 'liu-bei', officerIds: ['liu-bei', 'guan-yu', 'zhang-fei'],
      homeCityId: 'jiangling', troopType: 'spear', q: 10, r: 10, troops: 10_000, food: 5000,
      energy: 100, movementRemaining: 20, moved: false, acted: false,
    };

    expect(facilityBuildPowerMultiplier(state, state.units.builder)).toBe(2);
  });
});
