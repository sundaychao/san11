import { describe, expect, it } from 'vitest';
import { createGame } from './scenario/jingxiang208';
import type { ArmyUnit, ForceId } from './types';
import { captureChance, hasNamedHorse, captureCityOnCapture } from './captives';

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

describe('captureCityOnCapture', () => {
  /** 刘晓军（刘）攻占曹操的襄阳；返回守将 cao-ren。 */
  function siegeFixture() {
    const state = createGame('liu', 1);
    const attacker = looterFixture(state, 'liu');
    attacker.homeCityId = 'jiangling';
    attacker.skill = undefined;
    const defender = state.officers['cao-ren'];
    defender.forceId = 'cao';
    defender.location = { kind: 'city', cityId: 'xiangyang' };
    defender.cityId = 'xiangyang';
    state.cities.xiangyang.ownerId = 'cao';
    return { state, attacker, defender };
  }

  it('captures defending officers into the captor force when capture succeeds', () => {
    const { state, attacker, defender } = siegeFixture();
    state.officers['guan-yu'].skill = '捕缚'; // 必定被俘

    captureCityOnCapture(state, attacker, 'xiangyang');

    expect(state.cities.xiangyang.ownerId).toBe('liu');
    expect(defender.location.kind).toBe('captive');
    expect(defender.location.kind === 'captive' && defender.location.captorForceId).toBe('liu');
    expect(defender.location.kind === 'captive' && defender.location.cityId).toBe('jiangling');
  });

  it('flees uncaptured defenders as a transfer toward the ruler city, timed by distance', () => {
    const { state, attacker, defender } = siegeFixture();
    defender.skill = '强运'; // 不受俘
    // 曹操君主 cao-cao 在宛（wan）

    captureCityOnCapture(state, attacker, 'xiangyang');

    expect(defender.location.kind).toBe('transfer');
    const flee = defender.location as { targetCityId: string; remainingTenDays: number };
    expect(flee.targetCityId).toBe('wan');
    expect(flee.remainingTenDays).toBeGreaterThan(0);
  });

  it('routes defenders to the nearest own city when the ruler city is the captured one', () => {
    const { state, attacker, defender } = siegeFixture();
    defender.skill = '强运';
    // 君主 cao-cao 移入被攻的襄阳；宛改属刘，桂阳改属曹 → 曹操仅余桂阳一个本方城
    state.officers['cao-cao'].location = { kind: 'city', cityId: 'xiangyang' };
    state.officers['cao-cao'].cityId = 'xiangyang';
    state.cities.wan.ownerId = 'liu';
    state.cities.guiyang.ownerId = 'cao';
    state.officers['cao-cao'].skill = '强运';

    captureCityOnCapture(state, attacker, 'xiangyang');

    expect(defender.location.kind).toBe('transfer');
    const flee = defender.location as { targetCityId: string };
    expect(flee.targetCityId).toBe('guiyang');
  });

  it('leaves defenders unaffiliated when the force has no remaining city', () => {
    const { state, attacker, defender } = siegeFixture();
    defender.skill = '强运';
    // 曹操仅余襄阳一城，被攻后无本方城可退
    state.cities.wan.ownerId = 'liu';

    captureCityOnCapture(state, attacker, 'xiangyang');

    expect(defender.location.kind).toBe('unaffiliated');
  });
});