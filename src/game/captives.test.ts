import { describe, expect, it } from 'vitest';
import { createGame } from './scenario/jingxiang208';
import type { ArmyUnit, ForceId } from './types';
import { captureChance, hasNamedHorse } from './captives';

function looterFixture(state: ReturnType<typeof createGame>, forceId: ForceId): ArmyUnit {
  state.units.attacker = {
    id: 'attacker',
    kind: 'combat',
    forceId,
    leaderId: 'guan-yu',
    officerIds: ['guan-yu'],
    homeCityId: 'jiangling',
    troopType: 'spear',
    q: 10,
    r: 10,
    troops: 6000,
    food: 6000,
    energy: 100,
    movementRemaining: 20,
    moved: false,
    acted: false,
  };
  return state.units.attacker;
}

describe('capture skills', () => {
  it('guarantees capture with 捕缚 and blocks capture with 强运/血路 regardless of stats', () => {
    const state = createGame('liu', 1);
    const looter = looterFixture(state, 'liu');
    state.officers['guan-yu'].skill = '捕缚';
    const victim = state.officers['cao-cao'];
    state.officers['cao-cao'].stats.war = 99;
    state.officers['cao-cao'].stats.intelligence = 99;

    expect(captureChance(state, victim, looter, 1)).toBe(100);

    state.officers['cao-cao'].skill = '强运';
    expect(captureChance(state, victim, looter, 1)).toBe(0);

    state.officers['cao-cao'].skill = '血路';
    expect(captureChance(state, victim, looter, 1)).toBe(0);
  });

  it('blocks capture for officers holding a named horse', () => {
    const state = createGame('liu', 1);
    const looter = looterFixture(state, 'liu');
    state.officers['guan-yu'].skill = '捕缚';
    const victim = state.officers['cao-cao'];
    state.treasures = {
      chitu: { id: 'chitu', ownerId: null, cityId: null, holderId: 'cao-cao' },
    };
    victim.treasureId = 'chitu';

    expect(hasNamedHorse(victim)).toBe(true);
    expect(captureChance(state, victim, looter, 1)).toBe(0);
  });

  it('falls back to the formula when no capture skill applies', () => {
    const state = createGame('liu', 1);
    const looter = looterFixture(state, 'liu');
    state.officers['guan-yu'].skill = '无';
    const victim = state.officers['cao-cao'];
    state.officers['cao-cao'].stats.war = 99;
    state.officers['cao-cao'].stats.intelligence = 99;

    // (120 - 99) / 3 * (1 + 1) = 14，戟兵之外无加成
    expect(captureChance(state, victim, looter, 1)).toBe(14);
  });
});