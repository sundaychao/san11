import { describe, expect, it } from 'vitest';
import { COMBAT_UNIT_FOOD_CAP, COMBAT_UNIT_GOLD_CAP } from './catalog';
import { deployTransportUnit, deploymentCells } from './deployment';
import { neighborsOf } from './grid';
import { cellAt } from './movementRules';
import { supplyArmamentHeadroomOf, supplyCarryCapOf, supplyHeadroomOf, supplyTroopMaxOf, suppliableArmamentOf, suppliableUnits, supplyUnit } from './supply';
import { unitTroopCapOf } from '../ranks';
import { createGame } from '../scenario/jingxiang208';
import type { ArmyUnit, GameState } from '../types';

/**
 * 运输队「补给」：把随队士兵/资金/兵粮转给周围 6 格内的己方作战部队。
 * 接收容量：兵力 = 主将带兵上限；资金 10000；兵粮 50000。
 */

function deployFromJiangling(state: GameState, input: Partial<Parameters<typeof deployTransportUnit>[2]> = {}) {
  const destination = deploymentCells(state, 'jiangling', undefined, 'transport')[0]!;
  const next = deployTransportUnit(state, 'liu', {
    cityId: 'jiangling',
    officerIds: ['guan-yu'],
    destination,
    troops: 1200,
    gold: 0,
    food: 3000,
    ...input,
  });
  const unit = Object.values(next.units)[0];
  return { next, unit };
}

function groundedNeighbor(state: GameState, coord: { q: number; r: number }) {
  return neighborsOf(coord.q, coord.r).find((candidate) => cellAt(state, candidate))!;
}

function friendlyCombatUnit(state: GameState, coord: { q: number; r: number }, id = 'friend'): ArmyUnit {
  const unit: ArmyUnit = {
    id,
    kind: 'combat',
    forceId: 'liu',
    leaderId: 'guan-yu',
    homeCityId: 'jiangling',
    troopType: 'sword',
    q: coord.q,
    r: coord.r,
    troops: 3000,
    food: 3000,
    energy: 100,
    movementRemaining: 20,
    moved: false,
    acted: false,
  };
  state.units[id] = unit;
  return unit;
}

describe('补给目标筛选', () => {
  it('只列周围 6 格内的己方作战部队（敌军/运输队/不相邻都排除）', () => {
    const state = createGame('liu', 1);
    const { next, unit } = deployFromJiangling(state);
    const near = groundedNeighbor(next, unit);
    friendlyCombatUnit(next, near);

    // 另一支运输队与一支敌军也都贴着：都不该成为补给目标
    const transportSpot = neighborsOf(unit.q, unit.r).find((candidate) => cellAt(next, candidate) && candidate.q !== near.q)!;
    next.units['convoy'] = {
      ...friendlyCombatUnit(next, transportSpot, 'convoy'),
      kind: 'transport',
      leaderId: 'jian-yong',
      troops: 100,
      food: 100,
    };    const enemySpot = neighborsOf(unit.q, unit.r).find((candidate) => cellAt(next, candidate) && candidate.q !== near.q && candidate.q !== transportSpot.q)!;
    next.units['foe'] = {
      ...friendlyCombatUnit(next, enemySpot, 'foe'),
      forceId: 'cao',
      leaderId: 'cao-ren',
      homeCityId: 'xiangyang',
    };

    expect(suppliableUnits(next, unit.id).map((candidate) => candidate.id)).toEqual(['friend']);
  });

  it('战斗部队自己没有「补给」目标（suppliableUnits 恒空）', () => {
    const state = createGame('liu', 1);
    const spot = groundedNeighbor(state, { q: state.cities.jiangling.gridQ, r: state.cities.jiangling.gridR });
    friendlyCombatUnit(state, spot, 'solo');

    expect(suppliableUnits(state, 'solo')).toEqual([]);
  });
});

describe('补给执行', () => {
  it('三项资源一次转清：运输队扣减、接收方增加、运输队转入已行动', () => {
    const state = createGame('liu', 1);
    const { next, unit } = deployFromJiangling(state, { troops: 5000, gold: 6000, food: 20000 });
    friendlyCombatUnit(next, groundedNeighbor(next, unit), 'friend');

    const after = supplyUnit(next, 'liu', unit.id, 'friend', { troops: 2000, gold: 1500, food: 8000 });

    expect(after.units[unit.id]).toMatchObject({ troops: 3000, gold: 4500, food: 12000, acted: true });
    expect(after.units.friend).toMatchObject({ troops: 5000, gold: 1500, food: 11000 });
    expect(after.units.friend.acted).toBe(false);
    // 战报里有一条补给记录
    expect(after.logs?.some((log) => log.message.includes('补给'))).toBe(true);
  });

  it('接收容量：兵力受主将带兵上限约束，资金 10000 / 兵粮 50000', () => {
    const state = createGame('liu', 1);
    const { next, unit } = deployFromJiangling(state, { troops: 5000, gold: 5000, food: 5000 });
    // 输送编制本身有 10000 兵上限，这里直接把运输队改成重载状态来压测接收方容量
    next.units[unit.id].troops = 20000;
    next.units[unit.id].gold = 30000;
    next.units[unit.id].food = 80000;
    const friend = friendlyCombatUnit(next, groundedNeighbor(next, unit), 'friend');
    const cap = supplyCarryCapOf(next, 'liu', friend);
    expect(cap).toEqual({ troops: unitTroopCapOf(next, 'liu', 'guan-yu'), gold: COMBAT_UNIT_GOLD_CAP, food: COMBAT_UNIT_FOOD_CAP });
    expect(cap.gold).toBe(10000);
    expect(cap.food).toBe(50000);

    const headroom = supplyHeadroomOf(next, 'liu', friend);
    expect(() => supplyUnit(next, 'liu', unit.id, 'friend', { troops: headroom.troops + 1, gold: 0, food: 0 })).toThrow(/带兵上限/);
    expect(() => supplyUnit(next, 'liu', unit.id, 'friend', { troops: 0, gold: headroom.gold + 1, food: 0 })).toThrow(/资金携带上限/);
    expect(() => supplyUnit(next, 'liu', unit.id, 'friend', { troops: 0, gold: 0, food: headroom.food + 1 })).toThrow(/兵粮携带上限/);

    // 恰好塞满上限是允许的
    const full = supplyUnit(next, 'liu', unit.id, 'friend', headroom);
    expect(full.units.friend.troops).toBe(cap.troops);
    expect(full.units.friend.gold).toBe(COMBAT_UNIT_GOLD_CAP);
    expect(full.units.friend.food).toBe(COMBAT_UNIT_FOOD_CAP);
  });

  it('非法补给一律拒绝：不是运输队 / 敌方目标 / 运输队之间 / 超携带量 / 三项全零', () => {
    const state = createGame('liu', 1);
    const { next, unit } = deployFromJiangling(state, { troops: 2000, gold: 1000, food: 2000 });
    const friend = friendlyCombatUnit(next, groundedNeighbor(next, unit), 'friend');

    expect(() => supplyUnit(next, 'liu', 'friend', unit.id, { troops: 1, gold: 0, food: 0 })).toThrow(/只有运输队/);
    expect(() => supplyUnit(next, 'liu', unit.id, 'friend', { troops: 0, gold: 0, food: 0 })).toThrow(/至少补给一种资源/);
    expect(() => supplyUnit(next, 'liu', unit.id, 'friend', { troops: 99999, gold: 0, food: 0 })).toThrow(/携带量/);
    expect(() => supplyUnit(next, 'liu', unit.id, 'friend', { troops: 0, gold: 99999, food: 0 })).toThrow(/携带量/);
    expect(() => supplyUnit(next, 'liu', unit.id, 'friend', { troops: 0, gold: 0, food: 99999 })).toThrow(/携带量/);
    // 运输队补给后至少自留 100 名士兵：把 2000 兵全给出去会拒绝，最多给 1900（自留 100）
    expect(() => supplyUnit(next, 'liu', unit.id, 'friend', { troops: 2000, gold: 0, food: 0 })).toThrow(/至少保留100名士兵/);
    const keepMin = supplyUnit(next, 'liu', unit.id, 'friend', { troops: 1900, gold: 0, food: 0 });
    expect(keepMin.units[unit.id].troops).toBe(100);

    // 敌军相邻也不能给
    const enemySpot = neighborsOf(unit.q, unit.r).find((candidate) => cellAt(next, candidate) && candidate.q !== friend.q)!;
    next.units['foe'] = {
      ...friendlyCombatUnit(next, enemySpot, 'foe'),
      forceId: 'cao',
      leaderId: 'cao-ren',
      homeCityId: 'xiangyang',
    };
    expect(() => supplyUnit(next, 'liu', unit.id, 'foe', { troops: 1, gold: 0, food: 0 })).toThrow(/己方部队/);
  });
});

describe('兵装补给', () => {
  /** 枪队接收兵（带 500 枪、3000 兵）贴着运输队 */
  function spearScenario(state: GameState, transportArmaments: { spear?: number }) {
    const { next, unit } = deployFromJiangling(state, { troops: 2000, gold: 1000, food: 2000, armaments: transportArmaments });
    const friend = friendlyCombatUnit(next, groundedNeighbor(next, unit), 'friend');
    friend.troopType = 'spear';
    friend.armaments = { spear: 500 };
    return { next, unit, friend };
  }

  it('兵种决定可补兵装：枪队收枪、剑兵/攻城器不收', () => {
    expect(suppliableArmamentOf('spear')).toBe('spear');
    expect(suppliableArmamentOf('halberd')).toBe('halberd');
    expect(suppliableArmamentOf('crossbow')).toBe('crossbow');
    expect(suppliableArmamentOf('cavalry')).toBe('cavalry');
    expect(suppliableArmamentOf('sword')).toBeNull();
    expect(suppliableArmamentOf('siege')).toBeNull();
    expect(suppliableArmamentOf(undefined)).toBeNull();
  });

  it('兵装上限 = min(运输队携带, 士兵数 − 已携带)，转移逐件记账', () => {
    const state = createGame('liu', 1);
    const { next, unit, friend } = spearScenario(state, { spear: 2000 });

    // 接收方每兵一件：3000 兵已带 500 枪 → 最多再收 2500；运输队只带了 2000 → 上限 2000
    expect(supplyArmamentHeadroomOf(next.units[unit.id], friend)).toEqual({ spear: 2000 });

    const after = supplyUnit(next, 'liu', unit.id, 'friend', { troops: 0, gold: 0, food: 0, armaments: { spear: 1200 } });
    expect(after.units[unit.id].armaments?.spear).toBe(800);
    expect(after.units.friend.armaments?.spear).toBe(1700);
    expect(after.units[unit.id].acted).toBe(true);
    expect(after.logs?.some((log) => log.message.includes('枪 1200'))).toBe(true);
  });

  it('超士兵数或超携带量一律拒绝', () => {
    const state = createGame('liu', 1);
    const { next, unit, friend } = spearScenario(state, { spear: 4000 });

    // 3000 兵已带 500 → 士兵口径上限 2500，补 2501 拒绝
    expect(() => supplyUnit(next, 'liu', unit.id, 'friend', { troops: 0, gold: 0, food: 0, armaments: { spear: 2501 } })).toThrow(/兵装上限/);
    // 运输队只带 4000，补 4001 拒绝
    expect(() => supplyUnit(next, 'liu', unit.id, 'friend', { troops: 0, gold: 0, food: 0, armaments: { spear: 4001 } })).toThrow(/携带量/);
    // 恰好到士兵上限允许
    const full = supplyUnit(next, 'liu', unit.id, 'friend', { troops: 0, gold: 0, food: 0, armaments: { spear: 2500 } });
    expect(full.units.friend.armaments?.spear).toBe(3000);
    expect(full.units.friend.troops).toBe(friend.troops);
  });

  it('士兵与兵装 1:1 联动：补兵必须随带等量兵装，上限 = min(士兵, 兵装, 带兵余量)', () => {
    const state = createGame('liu', 1);
    const { next, unit, friend } = spearScenario(state, { spear: 1200 });
    next.units[unit.id].troops = 3000;

    // 士兵上限：min(运输队士兵 3000, 枪 1200, 带兵余量) = 1200（兵装卡口）
    const headroom = supplyHeadroomOf(next, 'liu', friend);
    expect(supplyTroopMaxOf(next.units[unit.id], friend, headroom.troops)).toBe(1200);

    // 补 1000 兵自动随带 1000 枪（每兵一件）
    const after = supplyUnit(next, 'liu', unit.id, 'friend', { troops: 1000, gold: 0, food: 0, armaments: { spear: 1000 } });
    expect(after.units.friend.troops).toBe(4000);
    expect(after.units.friend.armaments?.spear).toBe(1500);
    expect(after.units[unit.id].armaments?.spear).toBe(200);
    expect(after.logs?.some((log) => log.message.includes('枪 1000'))).toBe(true);

    // 联动被破坏（兵装数量与士兵数对不上 / 没带兵装）一律拒绝
    expect(() => supplyUnit(next, 'liu', unit.id, 'friend', { troops: 1000, gold: 0, food: 0, armaments: { spear: 999 } })).toThrow(/每兵一件/);
    expect(() => supplyUnit(next, 'liu', unit.id, 'friend', { troops: 1000, gold: 0, food: 0 })).toThrow(/每兵一件/);
  });

  it('士兵上限受兵装卡口：运输队没带对应兵装时一名兵都补不了；剑兵不受限', () => {
    const state = createGame('liu', 1);
    const { next, unit, friend } = spearScenario(state, {});
    const headroom = supplyHeadroomOf(next, 'liu', friend);

    // 运输队没带枪 → 枪队士兵补给上限 0
    expect(supplyTroopMaxOf(next.units[unit.id], friend, headroom.troops)).toBe(0);
    expect(() => supplyUnit(next, 'liu', unit.id, 'friend', { troops: 100, gold: 0, food: 0 })).toThrow(/每兵一件/);

    // 剑兵无对应兵装，士兵补给不受兵装限制：上限 = min(运输队士兵 2000 − 自留 100, 带兵余量) = 1900
    friend.troopType = 'sword';
    expect(supplyTroopMaxOf(next.units[unit.id], friend, headroom.troops)).toBe(Math.min(next.units[unit.id].troops - 100, headroom.troops));
    const after = supplyUnit(next, 'liu', unit.id, 'friend', { troops: 100, gold: 0, food: 0 });
    expect(after.units.friend.troops).toBe(friend.troops + 100);
  });
});
