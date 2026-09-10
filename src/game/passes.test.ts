import { describe, expect, it } from 'vitest';
import { attackPass } from './battle/actions';
import { gridKey, ringCoordsWithinRange } from './battle/grid';
import { isLegalUnitCell, reachableCosts } from './battle/movementRules';
import { createGame } from './scenario/jingxiang208';
import { settleMonth } from './turn';
import {
  PASS_ATTACK_RANGE,
  PASS_HOME_CITY,
  PASS_IDS,
  PASS_MAX_DURABILITY,
  PASS_POPULATION_MIN,
  PASS_POPULATION_SPREAD,
  isInPassAttackRange,
  isPassBlocked,
  passAt,
  passAttackRangeCoords,
  passBlockedKeys,
  passCenterBlockedFor,
  passIncomeMultiplierByBlockade,
  passMonthlyGoldIncome,
  passQuarterlyFoodIncome,
  settlePassRangedAttack,
} from './passes';
import type { ArmyUnit, PassId } from './types';

function addUnit(state: ReturnType<typeof createGame>, unit: ArmyUnit) {
  state.units[unit.id] = unit;
}

function makeUnit(overrides: Partial<ArmyUnit> & Pick<ArmyUnit, 'id' | 'forceId' | 'q' | 'r'>): ArmyUnit {
  return {
    kind: 'combat',
    leaderId: 'liu-bei',
    homeCityId: 'jiangling',
    troopType: 'sword',
    troops: 3000,
    food: 3000,
    energy: 100,
    movementRemaining: 12,
    moved: false,
    acted: false,
    ...overrides,
  } as ArmyUnit;
}

describe('passes (关隘据点)', () => {
  it('creates all passes with home-city ownership and home city assignment', () => {
    const state = createGame('liu', 202608);
    expect(PASS_IDS.length).toBeGreaterThanOrEqual(10);
    expect(Object.keys(state.passes!).length).toBe(PASS_IDS.length);
    for (const [passId, homeCityId] of Object.entries(PASS_HOME_CITY)) {
      const pass = state.passes![passId as PassId];
      expect(pass).toBeDefined();
      expect(pass.homeCityId).toBe(homeCityId);
      // 归属=最近/设定城池的所有者：城无主则关隘也无主
      expect(pass.ownerId).toBe(state.cities[homeCityId].ownerId);
    }
  });

  it('gives occupied passes initial garrison, gold, food and armaments while unowned passes stay empty', () => {
    const state = createGame('liu', 1);
    // 函谷关属宛（曹操开局有主）→ 有主关隘
    const occupied = state.passes!.hanguguan;
    expect(occupied.ownerId).toBe('cao');
    expect(occupied.troops).toBe(2000);
    expect(occupied.gold).toBe(1000);
    expect(occupied.food).toBe(10_000);
    expect(occupied.armaments).toEqual({
      spear: 500, halberd: 500, crossbow: 500, cavalry: 500,
      ram: 0, tower: 0, ship: 0,
    });
    // 潼关属长安（无主）→ 空关：士兵 0、钱粮 0、无兵装
    const idle = state.passes!.tongguan;
    expect(idle.ownerId).toBeNull();
    expect(idle.troops).toBe(0);
    expect(idle.gold).toBe(0);
    expect(idle.food).toBe(0);
    expect(idle.armaments).toEqual({
      spear: 0, halberd: 0, crossbow: 0, cavalry: 0,
      ram: 0, tower: 0, ship: 0,
    });
  });

  it('assigns each pass a random population between 40,000 and 80,000', () => {
    const state = createGame('liu', 7);
    expect(state.passes!.tongguan.population).toBeGreaterThanOrEqual(PASS_POPULATION_MIN);
    expect(state.passes!.tongguan.population).toBeLessThanOrEqual(PASS_POPULATION_MIN + PASS_POPULATION_SPREAD);
    for (const pass of Object.values(state.passes!)) {
      expect(pass.population).toBeGreaterThanOrEqual(PASS_POPULATION_MIN);
      expect(pass.population).toBeLessThanOrEqual(PASS_POPULATION_MIN + PASS_POPULATION_SPREAD);
    }
  });

  it('gives every pass full durability like a city', () => {
    const state = createGame('liu', 7);
    for (const pass of Object.values(state.passes!)) {
      expect(pass.maxDurability).toBe(PASS_MAX_DURABILITY);
      expect(pass.durability).toBe(PASS_MAX_DURABILITY);
    }
  });

  it('blocks only the flank cells while the center anchor stays traversable', () => {
    const state = createGame('liu', 1);
    expect(state.passes!.tongguan.flankKeys.length).toBeGreaterThanOrEqual(1);
    const blocked = passBlockedKeys(state);
    const anchorKey = gridKey(state.passes!.tongguan);
    expect(blocked.has(anchorKey)).toBe(false);
    for (const flankKey of state.passes!.tongguan.flankKeys) {
      expect(blocked.has(flankKey)).toBe(true);
    }
  });

  it('lets any force march straight through the pass center and prevents entering flank cells', () => {
    const state = createGame('liu', 1);
    // 选中一个锚点周边有平地可达的关隘（江油关位于山间，其邻格多为小路/山）
    const pass = state.passes!.jiangyouguan;
    // 把整图铺为平地，仅保留锚点与翼格为 pass 地形，隔离其余地形/水域因素
    const anchorCell = state.grid.find((cell) => cell.q === pass.q && cell.r === pass.r)!;
    const keepKeys = new Set<string>([gridKey(pass), ...pass.flankKeys]);
    for (const cell of state.grid) {
      cell.terrain = keepKeys.has(`${cell.q},${cell.r}`) ? 'pass' : 'plain';
    }
    // 在锚点旁边放一支部队（liu），验证：中心格可通行、翼格不可通行
    const flank = pass.flankKeys[0]!.split(',').map(Number);
    addUnit(state, {
      id: 'pass-march-test',
      kind: 'combat',
      forceId: 'liu',
      leaderId: 'liu-bei',
      homeCityId: 'jiangling',
      troopType: 'sword',
      q: flank[0],
      r: flank[1],
      troops: 3000,
      food: 3000,
      energy: 100,
      movementRemaining: 12,
      moved: false,
      acted: false,
    });
    const costs = reachableCosts(state, state.units['pass-march-test']);
    expect(costs.get(gridKey(pass))).toBeDefined();
    expect(costs.has(`${pass.q},${pass.r}`)).toBe(true);
    // 其余翼格不可进入（被 passBlockedKeys 挡下）
    for (const flankKey of pass.flankKeys) {
      if (flankKey === `${flank[0]},${flank[1]}`) continue; // 起点本身
      expect(costs.has(flankKey)).toBe(false);
    }
  });

  it('settles money and quarter food income for occupied passes without security modifiers', () => {
    const state = createGame('liu', 4394);
    // 给潼关一个势力归属，便于观察收入结算
    state.passes!.tongguan.ownerId = 'liu';
    state.month = 3; // 下月进入季初（4月）：金币+粮都会增长
    const before = state.passes!.tongguan;
    const expectedGold = before.gold + passMonthlyGoldIncome(before);
    const expectedFood = before.food + passQuarterlyFoodIncome(before);
    const expectedPopulation = before.population + Math.floor(before.population * 0.005);

    const next = settleMonth(state);
    const after = next.passes!.tongguan;

    expect(next.month).toBe(4);
    expect(after.gold).toBe(expectedGold);
    expect(after.food).toBe(expectedFood);
    expect(after.population).toBe(expectedPopulation);

    // 无主关隘不参与结算
    expect(next.passes!.jiange.ownerId).toBeNull();
    expect(next.passes!.jiange.gold).toBe(0);
    expect(next.passes!.jiange.population).toBe(next.passes!.jiange.population);
  });

  it('prevents entrance into any pass flank cell via reachable costs', () => {
    const state = createGame('liu', 1);
    const pass = state.passes!.huguan;
    expect(pass.flankKeys.length).toBeGreaterThanOrEqual(1);
    const blocked = passBlockedKeys(state);
    expect(blocked.has(gridKey(pass))).toBe(false);
  });

  it('resolves passAt for center anchors only', () => {
    const state = createGame('liu', 1);
    const pass = state.passes!.tongguan;
    expect(passAt(state, { q: pass.q, r: pass.r })?.id).toBe('tongguan');
    expect(state.passes?.jiange?.name).toBe('剑阁');
  });

  it('exposes a 1..2 ring attack zone around the pass center', () => {
    const state = createGame('liu', 1);
    const pass = state.passes!.tongguan;
    const coords = passAttackRangeCoords(pass);
    expect(coords.length).toBeGreaterThan(0);
    // 攻击区不含关隘中心本身
    expect(coords.some((c) => c.q === pass.q && c.r === pass.r)).toBe(false);
    for (const coord of coords) {
      expect(isInPassAttackRange(pass, coord.q, coord.r)).toBe(true);
    }
    expect(isInPassAttackRange(pass, pass.q, pass.r)).toBe(false);
    for (const coord of ringCoordsWithinRange({ q: pass.q, r: pass.r }, PASS_ATTACK_RANGE + 1)) {
      expect(isInPassAttackRange(pass, coord.q, coord.r)).toBe(false);
    }
  });

  it('marks a pass blockaded only when an enemy unit stands in its attack zone', () => {
    const state = createGame('liu', 1);
    const pass = state.passes!.hanguguan; // 曹操有主
    const cell = passAttackRangeCoords(pass)[0]!;
    // 归属方部队在范围内：不算封锁
    addUnit(state, makeUnit({ id: 'pass-friendly', forceId: 'cao', q: cell.q, r: cell.r }));
    expect(isPassBlocked(state, pass)).toBe(false);
    expect(passIncomeMultiplierByBlockade(state, pass)).toBe(1);
    // 敌方部队进入范围：封锁且收入归零
    addUnit(state, makeUnit({ id: 'pass-enemy', forceId: 'liu', q: cell.q, r: cell.r }));
    expect(isPassBlocked(state, pass)).toBe(true);
    expect(passIncomeMultiplierByBlockade(state, pass)).toBe(0);
    // 移回关隘中心（不在攻击区内）后解除封锁
    state.units['pass-enemy'].q = pass.q;
    state.units['pass-enemy'].r = pass.r;
    expect(isPassBlocked(state, pass)).toBe(false);
  });

  it('gives a blockaded pass no monthly income', () => {
    const state = createGame('liu', 1);
    const pass = state.passes!.hanguguan;
    const cell = passAttackRangeCoords(pass)[0]!;
    addUnit(state, makeUnit({ id: 'blockader', forceId: 'liu', q: cell.q, r: cell.r }));
    const goldBefore = pass.gold;
    const next = settleMonth(state);
    expect(next.passes!.hanguguan.gold).toBe(goldBefore);
  });

  it('blocks enemy units from an owned pass center while letting the owner and neutral passes through', () => {
    const state = createGame('liu', 1);
    const pass = state.passes!.hanguguan; // 曹操有主
    expect(passCenterBlockedFor(state, { q: pass.q, r: pass.r }, 'liu')).toBe(true);
    expect(passCenterBlockedFor(state, { q: pass.q, r: pass.r }, 'cao')).toBe(false);
    expect(isLegalUnitCell(state, { q: pass.q, r: pass.r }, undefined, 'sword', 'liu')).toBe(false);
    expect(isLegalUnitCell(state, { q: pass.q, r: pass.r }, undefined, 'sword', 'cao')).toBe(true);
    // 无主关隘任何势力均可通行
    const idle = state.passes!.tongguan;
    expect(idle.ownerId).toBeNull();
    expect(passCenterBlockedFor(state, { q: idle.q, r: idle.r }, 'liu')).toBe(false);
  });

  it('deals pass arrow damage to enemy units inside the attack zone', () => {
    const state = createGame('liu', 1);
    const pass = state.passes!.hanguguan;
    const cell = passAttackRangeCoords(pass)[0]!;
    addUnit(state, makeUnit({ id: 'arrow-target', forceId: 'liu', q: cell.q, r: cell.r, troops: 3000 }));
    const events = settlePassRangedAttack(state);
    expect(state.units['arrow-target'].troops).toBeLessThan(3000);
    expect(events.some((message) => message.includes('箭矢'))).toBe(true);
  });

  it('transfers a broken pass to the attacker', () => {
    const state = createGame('liu', 1);
    const pass = state.passes!.hanguguan; // 曹操有主
    const adjacent = ringCoordsWithinRange({ q: pass.q, r: pass.r }, 1)[0]!;
    addUnit(state, makeUnit({ id: 'breaker', forceId: 'liu', q: adjacent.q, r: adjacent.r, troops: 5000, energy: 100 }));
    // 削弱守军与耐久，使一次攻击即可破关
    pass.troops = 1;
    pass.durability = 1;
    const next = attackPass(state, 'liu', 'breaker', 'hanguguan');
    expect(next.passes!.hanguguan.ownerId).toBe('liu');
  });
});