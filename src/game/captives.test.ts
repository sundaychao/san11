import { describe, expect, it } from 'vitest';
import { createGame } from './scenario/jingxiang208';
import type { ArmyUnit, ForceId } from './types';
import { captureChance, hasNamedHorse, captureCityOnCapture, resolveRecruitCaptive } from './captives';

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

  it('mergeAttacker（近战/兵器攻破）：主力整体进城，兵粮金钱与武将并入，部队解散', () => {
    const { state, attacker } = siegeFixture();
    const city = state.cities.xiangyang;
    const beforeGold = city.gold;
    const beforeFood = city.food;
    const unitTroops = attacker.troops;
    const unitFood = attacker.food;
    const carriedGold = attacker.gold ?? 0;
    state.officers['guan-yu'].location = { kind: 'unit', unitId: 'attacker' };

    captureCityOnCapture(state, attacker, 'xiangyang', { mergeAttacker: true });

    expect(state.units.attacker).toBeUndefined();
    // 城破守军溃散，由入城主力接管（不是叠加）
    expect(city.troops).toBe(unitTroops);
    expect(city.gold).toBe(Math.floor(beforeGold / 2) + carriedGold);
    expect(city.food).toBe(Math.floor(beforeFood / 2) + unitFood);
    expect(state.officers['guan-yu'].location).toEqual({ kind: 'city', cityId: 'xiangyang' });
    expect(state.officers['guan-yu'].acted).toBe(true);
  });

  it('默认（火攻等远程破城）：主力留在野外，只拨 min(1000, 兵力20%) 守备队进城', () => {
    const { state, attacker } = siegeFixture();
    const city = state.cities.xiangyang;
    city.troops = 0;
    const unitTroops = attacker.troops;
    state.officers['guan-yu'].location = { kind: 'unit', unitId: 'attacker' };

    captureCityOnCapture(state, attacker, 'xiangyang');

    expect(state.units.attacker).toBeDefined();
    expect(city.troops).toBe(Math.min(1000, Math.floor(unitTroops * 0.2)));
    expect(attacker.troops).toBe(unitTroops - city.troops);
    // 远程破城时武将不进城，仍在原部队
    expect(state.officers['guan-yu'].location).toEqual({ kind: 'unit', unitId: 'attacker' });
  });
});

describe('resolveRecruitCaptive', () => {
  it('登用俘虏成功后，新加入武将本旬视为已行动', () => {
    const state = createGame('liu', 1);
    const executor = state.officers['zhuge-liang'];
    executor.acted = false;
    const target = state.officers['cao-ren'];
    target.forceId = 'cao';
    target.loyalty = 0;
    target.location = { kind: 'captive', cityId: 'jiangling', captorForceId: 'liu', capturedTenDays: 0 };
    target.cityId = 'jiangling';

    // 成功率上限 90%，循环直到本次判定成功
    let result = resolveRecruitCaptive(state, 'liu', executor, target);
    for (let guard = 0; !result.success && guard < 200; guard += 1) {
      result = resolveRecruitCaptive(state, 'liu', executor, target);
    }

    expect(result.success).toBe(true);
    expect(target.forceId).toBe('liu');
    expect(target.location.kind).toBe('city');
    expect(target.acted).toBe(true);
  });
});