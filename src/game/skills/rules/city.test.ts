import { describe, expect, it } from 'vitest';
import { createGame } from '../../scenario/jingxiang208';
import { cityIncomeMultiplier, commandYieldMultiplier } from './city';

describe('city skill rules', () => {
  it('uses only the acting officer for 名声 and 能吏 command multipliers', () => {
    const state = createGame('liu', 1);
    state.officers['liu-bei'].skill = '名声';
    state.officers['guan-yu'].skill = '能吏';

    expect(commandYieldMultiplier(state, {
      type: 'recruit', cityId: 'jiangling', officerIds: ['liu-bei'],
    })).toBe(1.5);
    expect(commandYieldMultiplier(state, {
      type: 'produceArmament', cityId: 'jiangling', officerIds: ['guan-yu'], armamentType: 'crossbow',
    })).toBe(2);
    expect(commandYieldMultiplier(state, {
      type: 'produceArmament', cityId: 'jiangling', officerIds: ['guan-yu'], armamentType: 'cavalry',
    })).toBe(1);
  });

  it('does not use a non-acting resident officer command skill', () => {
    const state = createGame('liu', 1);
    state.officers['liu-bei'].skill = '仁德';
    state.officers['guan-yu'].skill = '名声';

    expect(commandYieldMultiplier(state, {
      type: 'recruit', cityId: 'jiangling', officerIds: ['liu-bei'],
    })).toBe(1);
  });

  it('limits 能吏 to spear, halberd, and crossbow production', () => {
    const state = createGame('liu', 1);
    state.officers['liu-bei'].skill = '能吏';

    for (const armamentType of ['spear', 'halberd', 'crossbow'] as const) {
      expect(commandYieldMultiplier(state, {
        type: 'produceArmament', cityId: 'jiangling', officerIds: ['liu-bei'], armamentType,
      })).toBe(2);
    }
    for (const armamentType of ['cavalry', 'ram', 'tower', 'ship'] as const) {
      expect(commandYieldMultiplier(state, {
        type: 'produceArmament', cityId: 'jiangling', officerIds: ['liu-bei'], armamentType,
      })).toBe(1);
    }
  });

  it('uses same-force resident and local production task income skills for the city owner', () => {
    const state = createGame('liu', 4394);
    state.officers['lu-su'].skill = '富豪';
    state.officers['zhou-yu'].skill = '米道';
    state.officers['zhou-yu'].location = {
      kind: 'task', cityId: 'changsha', task: 'armament', armamentType: 'ram', amount: 2, remainingTenDays: 2,
    };

    expect(cityIncomeMultiplier(state, 'changsha', 'gold')).toBe(1.5);
    expect(cityIncomeMultiplier(state, 'changsha', 'food')).toBe(1.5);
  });

  it('does not stack duplicate same-name city income skills', () => {
    const state = createGame('sun', 4394);
    state.officers['lu-su'].skill = '富豪';
    state.officers['gan-ning'].skill = '富豪';

    expect(cityIncomeMultiplier(state, 'changsha', 'gold')).toBe(1.5);
  });

  it('stops city income skills after transfer, force change, or relocation', () => {
    const state = createGame('sun', 4394);
    state.officers['lu-su'].skill = '富豪';
    state.officers['lu-su'].location = {
      kind: 'transfer', fromCityId: 'changsha', targetCityId: 'jiangxia', remainingTenDays: 1,
    };
    expect(cityIncomeMultiplier(state, 'changsha', 'gold')).toBe(1);

    state.officers['lu-su'].location = { kind: 'city', cityId: 'changsha' };
    state.officers['lu-su'].forceId = 'cao';
    expect(cityIncomeMultiplier(state, 'changsha', 'gold')).toBe(1);

    state.officers['lu-su'].forceId = 'sun';
    state.officers['lu-su'].location = { kind: 'city', cityId: 'jiangxia' };
    expect(cityIncomeMultiplier(state, 'changsha', 'gold')).toBe(1);
  });
});
