import { describe, expect, it } from 'vitest';
import { ARMAMENT_TYPES, CITY_ARMAMENT_CAPS, PASS_ARMAMENT_CAPS, armamentsOf } from './armaments';
import { moveUnit } from './battle/movement';
import { cellAt } from './battle/movementRules';
import { neighborsOf, sevenCellCityFootprint } from './battle/grid';
import { executeCommand, validateCommand } from './commands';
import { CITY_FOOD_CAP, CITY_GOLD_CAP, cityTroopCap } from './innerAffairs';
import { PASS_FOOD_CAP, PASS_GOLD_CAP, PASS_TROOP_CAP } from './passes';
import { createGame } from './scenario/jingxiang208';
import { clampCityResources, clampPassResources, clampStrongholdResources, strongholdsExceedCaps } from './strongholdCapacity';
import { settleTenDay } from './turn';
import type { ArmyUnit, GameState } from './types';
import { reduceGameIntent } from './network/intentReducer';

type GameLike = ReturnType<typeof createGame>;

/** 为江陵预置军事设施（生产枪需锻冶等） */
function withFacilities(state: GameState, facilities: string[]) {
  const city = state.cities.jiangling;
  const plots = city.plots ?? (city.plots = []);
  facilities.forEach((facility, index) => {
    plots[index] = { ...plots[index], id: `test-${facility}`, type: facility as never, level: 1, constructing: undefined };
  });
  return state;
}

describe('据点资源容纳上限', () => {
  it('上限常量与设定一致（城池/关隘各自的九项容量）', () => {
    expect({ gold: CITY_GOLD_CAP, food: CITY_FOOD_CAP }).toEqual({ gold: 100_000, food: 1_000_000 });
    expect(CITY_ARMAMENT_CAPS).toEqual({
      spear: 100_000, halberd: 100_000, crossbow: 100_000, cavalry: 50_000, ram: 20, tower: 20, ship: 20,
    });
    expect({ gold: PASS_GOLD_CAP, food: PASS_FOOD_CAP, troops: PASS_TROOP_CAP })
      .toEqual({ gold: 30_000, food: 300_000, troops: 30_000 });
    expect(PASS_ARMAMENT_CAPS).toEqual({
      spear: 30_000, halberd: 30_000, crossbow: 30_000, cavalry: 10_000, ram: 5, tower: 5, ship: 5,
    });
    // 关隘容量处处小于等于城池
    for (const type of ARMAMENT_TYPES) {
      expect(PASS_ARMAMENT_CAPS[type]).toBeLessThanOrEqual(CITY_ARMAMENT_CAPS[type]);
    }
  });

  it('clampCityResources 截断金钱/粮食/兵力/兵装，负值回零', () => {
    const state = createGame('liu', 1);
    const city = state.cities.jiangling;
    city.gold = 999_999;
    city.food = 9_999_999;
    city.troops = 999_999;
    city.armaments = { spear: 500_000, halberd: 500_000, crossbow: 500_000, cavalry: 500_000, ram: 99, tower: 99, ship: 99 };

    clampCityResources(city);

    expect(city.gold).toBe(CITY_GOLD_CAP);
    expect(city.food).toBe(CITY_FOOD_CAP);
    expect(city.troops).toBe(cityTroopCap(city));
    expect(city.armaments).toEqual({ ...CITY_ARMAMENT_CAPS });

    city.gold = -5;
    city.food = -5;
    city.troops = -5;
    clampCityResources(city);
    expect({ gold: city.gold, food: city.food, troops: city.troops }).toEqual({ gold: 0, food: 0, troops: 0 });
  });

  it('clampPassResources 用关隘自己的上限（比城池紧得多）', () => {
    const state = createGame('liu', 1);
    const pass = Object.values(state.passes!)[0]!;
    pass.gold = 500_000;
    pass.food = 5_000_000;
    pass.troops = 90_000;
    pass.armaments = { spear: 90_000, halberd: 90_000, crossbow: 90_000, cavalry: 90_000, ram: 50, tower: 50, ship: 50 };

    clampPassResources(pass);

    expect(pass.gold).toBe(PASS_GOLD_CAP);
    expect(pass.food).toBe(PASS_FOOD_CAP);
    expect(pass.troops).toBe(PASS_TROOP_CAP);
    expect(pass.armaments).toEqual({ ...PASS_ARMAMENT_CAPS });
  });

  it('clampStrongholdResources：未超限时原样返回同一引用，超限时整体截断', () => {
    const state = createGame('liu', 1);
    expect(strongholdsExceedCaps(state)).toBe(false);
    expect(clampStrongholdResources(state)).toBe(state);

    state.cities.jiangling.gold = CITY_GOLD_CAP + 1;
    expect(strongholdsExceedCaps(state)).toBe(true);
    const next = clampStrongholdResources(state);
    expect(next).not.toBe(state);
    expect(next.cities.jiangling.gold).toBe(CITY_GOLD_CAP);
    // 原 state 不被就地修改
    expect(state.cities.jiangling.gold).toBe(CITY_GOLD_CAP + 1);
  });

  it('征兵把兵力顶到上限：不会越过城池兵力容量，溢出部分丢弃', () => {
    const state = withFacilities(createGame('liu', 1), ['barracks']);
    const city = state.cities.jiangling;
    const troopCap = cityTroopCap(city);
    city.troops = troopCap - 10;
    city.gold = 9000;
    city.food = 30_000;

    const next = reduceGameIntent(state, 'liu', {
      type: 'issueCommand',
      command: { type: 'recruit', cityId: 'jiangling', officerIds: ['liu-bei'] },
    });

    expect(next.cities.jiangling.troops).toBe(troopCap);
  });

  it('生产兵装把兵装满：不越界，且战报只报实际入库量', () => {
    const state = withFacilities(createGame('liu', 1), ['forge']);
    const city = state.cities.jiangling;
    city.gold = 9000;
    const cap = CITY_ARMAMENT_CAPS.spear;
    city.armaments = { ...armamentsOf(city.armaments), spear: cap - 100 };

    const next = reduceGameIntent(state, 'liu', {
      type: 'issueCommand',
      command: { type: 'produceArmament', cityId: 'jiangling', officerIds: ['liu-bei'], armamentType: 'spear' },
    });

    expect(next.cities.jiangling.armaments!.spear).toBe(cap);
    // 实际只入库 100，战报与飘字都必须按 100 报，不能照抄理论产量
    const report = (next.cityEffectReports ?? []).find((entry) => entry.kind === 'armament');
    expect(report?.amount).toBe(100);
  });

  it('商人买入：城池粮食已满 / 余量不足时被拦下，绝不花金买进后被上限丢弃', () => {
    const state = createGame('liu', 1);
    const city = state.cities.jiangling;
    city.merchantPresent = true;
    city.gold = 90_000;
    city.food = CITY_FOOD_CAP;

    const errors = validateCommand(state, 'liu', {
      type: 'trade', cityId: 'jiangling', officerId: 'liu-bei', mode: 'buy', amount: 1000,
    });
    expect(errors.some((error) => error.includes('兵粮容纳上限'))).toBe(true);
    // 满载时直接拒绝执行（宁可报错，也不让玩家花了金却拿不到粮）
    expect(() => reduceGameIntent(state, 'liu', {
      type: 'issueCommand',
      command: { type: 'trade', cityId: 'jiangling', officerId: 'liu-bei', mode: 'buy', amount: 1000 },
    })).toThrow(/兵粮容纳上限/);

    // 余量只剩 100：买 1000 仍被拦（超容量），但买 100 合法且落袋
    city.food = CITY_FOOD_CAP - 100;
    expect(validateCommand(state, 'liu', {
      type: 'trade', cityId: 'jiangling', officerId: 'liu-bei', mode: 'buy', amount: 1000,
    }).some((error) => error.includes('兵粮容纳上限'))).toBe(true);
    const next = reduceGameIntent(state, 'liu', {
      type: 'issueCommand',
      command: { type: 'trade', cityId: 'jiangling', officerId: 'liu-bei', mode: 'buy', amount: 100 },
    });
    expect(next.cities.jiangling.food).toBe(CITY_FOOD_CAP);
  });

  it('部队回城并账后按城池上限截断（钱粮兵装都不越界）', () => {
    const state = createGame('liu', 1);
    const city = state.cities.jiangling;
    const footprint = new Set(sevenCellCityFootprint({ q: city.gridQ, r: city.gridR }).map((c) => `${c.q},${c.r}`));
    const spawn = neighborsOf(city.gridQ, city.gridR)
      .flatMap((n) => neighborsOf(n.q, n.r))
      .find((c) => !footprint.has(`${c.q},${c.r}`) && cellAt(state, c))!;
    city.gold = CITY_GOLD_CAP - 100;
    city.food = CITY_FOOD_CAP - 100;
    state.units['cap-unit'] = {
      id: 'cap-unit', kind: 'combat', forceId: 'liu', leaderId: 'liu-bei', homeCityId: 'jiangling',
      troopType: 'sword', q: spawn.q, r: spawn.r, troops: 1000, food: 9999, gold: 9999,
      energy: 100, movementRemaining: 20, moved: false, acted: false,
    } as ArmyUnit;

    const next = moveUnit(state, 'liu', 'cap-unit', { q: city.gridQ, r: city.gridR });

    expect(next.units['cap-unit']).toBeUndefined();
    expect(next.cities.jiangling.gold).toBe(CITY_GOLD_CAP);
    expect(next.cities.jiangling.food).toBe(CITY_FOOD_CAP);
    expect(next.cities.jiangling.troops).toBeLessThanOrEqual(cityTroopCap(city));
  });

  it('部队入关并账后按关隘上限截断（粮/金/兵都远低于城池上限）', () => {
    const state = createGame('cao', 1);
    // 函谷关开局属曹操（宛），直接拉满资源模拟运输队入关
    const pass = Object.values(state.passes!).find((candidate) => candidate.ownerId === 'cao')!;
    pass.gold = PASS_GOLD_CAP - 10;
    pass.food = PASS_FOOD_CAP - 10;
    pass.troops = PASS_TROOP_CAP - 10;
    // 关隘锚点旁找一格可站位置
    const occupied = new Set(Object.values(state.units).map((unit) => `${unit.q},${unit.r}`));
    const spawn = neighborsOf(pass.q, pass.r).find((c) => cellAt(state, c) && !occupied.has(`${c.q},${c.r}`))!;
    state.units['cap-pass-unit'] = {
      id: 'cap-pass-unit', kind: 'combat', forceId: 'cao', leaderId: 'cao-cao', homeCityId: pass.homeCityId,
      troopType: 'sword', q: spawn.q, r: spawn.r, troops: 5000, food: 9999, gold: 9999,
      energy: 100, movementRemaining: 20, moved: false, acted: false,
    } as ArmyUnit;

    const next = moveUnit(state, 'cao', 'cap-pass-unit', { q: pass.q, r: pass.r });

    const after = next.passes![pass.id];
    expect(after.gold).toBe(PASS_GOLD_CAP);
    expect(after.food).toBe(PASS_FOOD_CAP);
    expect(after.troops).toBe(PASS_TROOP_CAP);
  });

  it('旬末结算（含兵装生产完成、城池收入）不会突破上限', () => {
    const state = createGame('liu', 1);
    for (const city of Object.values(state.cities)) {
      city.gold = CITY_GOLD_CAP;
      city.food = CITY_FOOD_CAP;
      city.troops = cityTroopCap(city);
      city.armaments = { ...CITY_ARMAMENT_CAPS };
    }
    for (const pass of Object.values(state.passes ?? {})) {
      pass.gold = PASS_GOLD_CAP;
      pass.food = PASS_FOOD_CAP;
      pass.troops = PASS_TROOP_CAP;
      pass.armaments = { ...PASS_ARMAMENT_CAPS };
    }

    const next = settleTenDay(state);

    for (const city of Object.values(next.cities)) {
      expect(city.gold).toBeLessThanOrEqual(CITY_GOLD_CAP);
      expect(city.food).toBeLessThanOrEqual(CITY_FOOD_CAP);
      expect(city.troops).toBeLessThanOrEqual(cityTroopCap(city));
      for (const type of ARMAMENT_TYPES) expect(city.armaments![type]).toBeLessThanOrEqual(CITY_ARMAMENT_CAPS[type]);
    }
    for (const pass of Object.values(next.passes ?? {})) {
      expect(pass.gold).toBeLessThanOrEqual(PASS_GOLD_CAP);
      expect(pass.food).toBeLessThanOrEqual(PASS_FOOD_CAP);
      expect(pass.troops).toBeLessThanOrEqual(PASS_TROOP_CAP);
      for (const type of ARMAMENT_TYPES) expect(pass.armaments![type]).toBeLessThanOrEqual(PASS_ARMAMENT_CAPS[type]);
    }
  });
});
