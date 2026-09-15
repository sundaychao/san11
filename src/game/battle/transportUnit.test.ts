import { describe, expect, it } from 'vitest';
import { armamentsOf, initialArmaments } from '../armaments';
import { createGame } from '../scenario/jingxiang208';
import type { ArmyUnit, GameState } from '../types';
import { attackUnit } from './combat';
import { TRANSPORT_COMBAT_RATING } from './catalog';
import { deployTransportUnit, deploymentCells } from './deployment';
import { neighborsOf } from './grid';
import { moveUnit } from './movement';
import { cellAt } from './movementRules';
import { unitCombatRating } from './officerAbilities';
import { attackableCities, attackableFacilities, attackablePasses, attackablePlots, attackableUnits } from './targetRules';

/**
 * 运输队（输送队）的两条独立规则：
 *
 * 1. **攻防力固定 `TRANSPORT_COMBAT_RATING`（20）**：不吃押运武将统率、适性与兵种基础值；
 * 2. **可以攻击敌方部队，但不能攻城/攻关/打设施/打开发地格** —— 辎重队不该能拆城墙。
 *
 * 以及输送编制新增的「主将 + 2 副将」与「押运兵装（货物，整件返还）」。
 */

function enemyUnit(state: GameState, coord: { q: number; r: number }, id = 'enemy'): ArmyUnit {
  const unit: ArmyUnit = {
    id,
    kind: 'combat',
    forceId: 'cao',
    leaderId: 'cao-ren',
    homeCityId: 'xiangyang',
    troopType: 'sword',
    q: coord.q,
    r: coord.r,
    troops: 5000,
    food: 5000,
    energy: 100,
    movementRemaining: 20,
    moved: false,
    acted: false,
  };
  state.units[id] = unit;
  return unit;
}

/** 江陵的近邻里挑一格地面格（运输队刚出征就落在这附近） */
function groundedNeighbor(state: GameState, coord: { q: number; r: number }) {
  return neighborsOf(coord.q, coord.r).find((candidate) => cellAt(state, candidate))!;
}

/** 从江陵派一支运输队到合法落点 */
function deployFromJiangling(
  state: GameState,
  input: Partial<Parameters<typeof deployTransportUnit>[2]> = {},
) {
  const destination = deploymentCells(state, 'jiangling', undefined, 'transport')[0]!;
  const next = deployTransportUnit(state, 'liu', {
    cityId: 'jiangling',
    officerIds: ['liu-bei'],
    destination,
    troops: 1200,
    gold: 0,
    food: 3000,
    ...input,
  });
  const unit = Object.values(next.units)[0];
  return { next, unit, destination };
}

describe('运输队的攻防力与攻击目标', () => {
  it('攻防力恒为 20：与押运武将的统率无关', () => {
    const state = createGame('liu', 1);
    // 关羽（统95）押运与简雍（统35）押运，攻防力必须一样
    const elite = deployFromJiangling(state, { officerIds: ['guan-yu', 'chen-dao'] });
    const clerk = deployFromJiangling(state, { officerIds: ['jian-yong'] });

    expect(unitCombatRating(elite.next, elite.unit)).toMatchObject({
      attack: TRANSPORT_COMBAT_RATING,
      defense: TRANSPORT_COMBAT_RATING,
    });
    expect(unitCombatRating(clerk.next, clerk.unit)).toMatchObject({
      attack: TRANSPORT_COMBAT_RATING,
      defense: TRANSPORT_COMBAT_RATING,
    });
    expect(TRANSPORT_COMBAT_RATING).toBe(20);
  });

  it('可以攻击射程内的敌方部队', () => {
    const { next, unit } = deployFromJiangling(createGame('liu', 1));
    enemyUnit(next, groundedNeighbor(next, unit));

    expect(attackableUnits(next, unit.id).map((target) => target.id)).toEqual(['enemy']);
  });

  it('攻击敌方部队能造成伤害，且自己进入「已行动」', () => {
    const { next, unit } = deployFromJiangling(createGame('liu', 1));
    const target = enemyUnit(next, groundedNeighbor(next, unit));
    const before = target.troops;

    const after = attackUnit(next, 'liu', unit.id, 'enemy');

    expect(after.units.enemy.troops).toBeLessThan(before);
    expect(after.units[unit.id].acted).toBe(true);
    expect(after.battleDamageReports?.length ?? 0).toBeGreaterThan(0);
  });

  it('不能攻城、攻关、打设施或打开发地格（同格的战斗部队则可以）', () => {
    const state = createGame('liu', 1);
    // 站到襄阳城旁：这一格战斗部队能打到襄阳，运输队不行
    const xiangyang = state.cities.xiangyang;
    const spot = neighborsOf(xiangyang.gridQ, xiangyang.gridR).find((candidate) => cellAt(state, candidate))!;

    const transport = deployFromJiangling(state, { officerIds: ['liu-bei'] });
    transport.unit.q = spot.q;
    transport.unit.r = spot.r;
    expect(attackableCities(transport.next, transport.unit.id)).toEqual([]);

    const combatState = structuredClone(state);
    combatState.units['probe'] = {
      ...enemyUnit(combatState, spot, 'probe'),
      forceId: 'liu',
      leaderId: 'guan-yu',
      homeCityId: 'jiangling',
      troopType: 'sword',
    };
    expect(attackableCities(combatState, 'probe').map((city) => city.id)).toEqual(['xiangyang']);

    // 另外四个入口对运输队一律短路
    expect(attackablePasses(transport.next, transport.unit.id)).toEqual([]);
    expect(attackableFacilities(transport.next, transport.unit.id)).toEqual([]);
    expect(attackablePlots(transport.next, transport.unit.id)).toEqual([]);
  });
});

describe('输送编制：多武将 + 押运兵装', () => {
  it('支持主将 + 2 名副将，三人都记为已行动', () => {
    const state = createGame('liu', 1);
    const { next, unit } = deployFromJiangling(state, {
      officerIds: ['liu-bei', 'guan-yu', 'jian-yong'],
    });

    expect(unit.officerIds).toEqual(['liu-bei', 'guan-yu', 'jian-yong']);
    for (const id of ['liu-bei', 'guan-yu', 'jian-yong']) {
      expect(next.officers[id].acted).toBe(true);
      expect(next.officers[id].location).toEqual({ kind: 'unit', unitId: unit.id });
    }
  });

  it('押运兵装逐项从据点扣减，并记在部队上', () => {
    const state = createGame('liu', 1);
    state.cities.jiangling.armaments = { ...initialArmaments(), ram: 3 };
    const before = armamentsOf(state.cities.jiangling.armaments);

    const { next, unit } = deployFromJiangling(state, {
      officerIds: ['guan-yu'],
      armaments: { spear: 800, ram: 2 },
    });

    expect(unit.armaments).toEqual({ spear: 800, ram: 2 });
    expect(next.cities.jiangling.armaments!.spear).toBe(before.spear - 800);
    expect(next.cities.jiangling.armaments!.ram).toBe(before.ram - 2);
  });

  it('编制校验：最多 3 人、不得重复、兵装不得超过库存', () => {
    const state = createGame('liu', 1);
    const base = { troops: 1200, gold: 0, food: 3000 };

    expect(() => deployFromJiangling(state, { ...base, officerIds: ['liu-bei', 'guan-yu', 'jian-yong', 'chen-dao'] }))
      .toThrow(/主将和两名副将/);
    expect(() => deployFromJiangling(state, { ...base, officerIds: ['liu-bei', 'liu-bei'] }))
      .toThrow(/主将和两名副将/);
    expect(() => deployFromJiangling(state, { ...base, officerIds: ['liu-bei'], armaments: { spear: 999_999 } }))
      .toThrow(/枪/);
  });

  it('押运兵装不必带钱粮，但运输队出门至少带 100 兵', () => {
    const state = createGame('liu', 1);
    state.cities.jiangling.armaments = { ...initialArmaments(), ram: 3 };

    const { next, unit } = deployFromJiangling(state, {
      officerIds: ['guan-yu'],
      troops: 100,
      food: 0,
      armaments: { ram: 2 },
    });

    expect(unit.armaments).toEqual({ ram: 2 });
    expect(unit.troops).toBe(100);
    expect(next.cities.jiangling.armaments!.ram).toBe(1);
    expect(() => deployFromJiangling(state, { officerIds: ['guan-yu'], troops: 0, food: 0, armaments: { ram: 2 } }))
      .toThrow(/输送士兵必须为 100/);
  });
});

describe('押运兵装的返还口径（货物 vs 装备）', () => {
  it('减员回城时兵装整件返还，不按并入兵力缩放', () => {
    const state = createGame('liu', 1);
    state.cities.jiangling.armaments = { ...initialArmaments(), ram: 3 };
    const before = armamentsOf(state.cities.jiangling.armaments);

    const { next, unit } = deployFromJiangling(state, {
      officerIds: ['guan-yu'],
      armaments: { spear: 800, ram: 2 },
    });
    // 途中减员到 300 兵：若是「随身装备」口径，800 杆枪只会返还 300
    next.units[unit.id].troops = 300;
    next.units[unit.id].moved = false;
    next.units[unit.id].acted = false;
    next.units[unit.id].movementRemaining = 30;

    const home = moveUnit(next, 'liu', unit.id, { q: state.cities.jiangling.gridQ, r: state.cities.jiangling.gridR });

    expect(home.units[unit.id]).toBeUndefined();
    expect(home.cities.jiangling.armaments!.spear).toBe(before.spear);
    expect(home.cities.jiangling.armaments!.ram).toBe(before.ram);
  });

  it('战斗部队的枪戟弩马仍按并入兵力缩放（两种口径不混淆）', () => {
    const state = createGame('liu', 1);
    state.cities.jiangling.armaments = { ...initialArmaments() };
    const before = armamentsOf(state.cities.jiangling.armaments);
    const spot = groundedNeighbor(state, { q: state.cities.jiangling.gridQ, r: state.cities.jiangling.gridR });
    state.units['scaled'] = {
      id: 'scaled',
      kind: 'combat',
      forceId: 'liu',
      leaderId: 'guan-yu',
      homeCityId: 'jiangling',
      troopType: 'spear',
      q: spot.q,
      r: spot.r,
      troops: 300,
      food: 3000,
      energy: 100,
      movementRemaining: 30,
      moved: false,
      acted: false,
      armaments: { spear: 800 },
    };

    const home = moveUnit(state, 'liu', 'scaled', { q: state.cities.jiangling.gridQ, r: state.cities.jiangling.gridR });

    expect(home.cities.jiangling.armaments!.spear).toBe(before.spear + 300);
  });
});
