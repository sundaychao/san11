import { describe, expect, it } from 'vitest';
import { createGame } from '../scenario/jingxiang208';
import type { ArmyUnit, GameState, OfficerAptitudes, TechNodeId } from '../types';
import {
  SIEGE_TACTIC_OF_WEAPON,
  isSiegeTactic,
  tacticHasAnyTarget,
  tacticTargetCities,
  tacticTargetPasses,
  tacticTargetPlots,
  tacticTargetUnits,
  unitCanUseTactic,
  unitTactics,
  useSiegeTacticOnStructure,
  useUnitTactic,
} from './actions';
import { coordsWithinRange } from './grid';
import { gridDistanceWithin, parsePlotTargetKey, plotTargetKey, type PlotAttackTarget } from './targetRules';

/**
 * 兵器战法（原版 PK 口径）：每种兵器只有一条战法、不看兵种适性、不会施展失败。
 * - 冲车「破碎」：邻接，只打建筑
 * - 木兽「放射」：邻接，建筑 + 部队（命中着火）
 * - 井阑「火矢」：恰第 2 格，部队 + 建筑
 * - 投石「投石」：2~3 格，部队 + 建筑
 */

function plainState(techNodes: TechNodeId[] = []) {
  const state = createGame('liu', 1);
  for (const cell of state.grid) cell.terrain = 'plain';
  state.forces.liu.techNodes = techNodes;
  return state;
}

function siegeUnit(state: GameState, coord: { q: number; r: number }, overrides: Partial<ArmyUnit> = {}): ArmyUnit {
  state.officers['guan-yu'].location = { kind: 'unit', unitId: 'siege' };
  state.units.siege = {
    id: 'siege',
    kind: 'combat',
    forceId: 'liu',
    leaderId: 'guan-yu',
    officerIds: ['guan-yu'],
    homeCityId: 'jiangling',
    troopType: 'siege',
    siegeWeapon: 'ram',
    q: coord.q,
    r: coord.r,
    troops: 6000,
    food: 6000,
    stamina: 100,
    energy: 100,
    movementRemaining: 16,
    moved: false,
    acted: false,
    ...overrides,
  };
  return state.units.siege;
}

function enemyUnit(state: GameState, coord: { q: number; r: number }, id = 'foe'): ArmyUnit {
  state.officers['xiahou-dun'].location = { kind: 'unit', unitId: id };
  state.units[id] = {
    id,
    kind: 'combat',
    forceId: 'cao',
    leaderId: 'xiahou-dun',
    officerIds: ['xiahou-dun'],
    homeCityId: 'xiangyang',
    troopType: 'sword',
    q: coord.q,
    r: coord.r,
    troops: 5000,
    food: 3000,
    energy: 100,
    stamina: 100,
    movementRemaining: 10,
    moved: false,
    acted: false,
  };
  return state.units[id];
}

/** 取以 origin 为心、恰 d 格的一个坐标 */
function ringAt(origin: { q: number; r: number }, d: number) {
  return coordsWithinRange(origin, d).find((coord) => gridDistanceWithin(origin, coord, d) === d)!;
}

describe('兵器战法可用性', () => {
  it('每种兵器只有一条战法，按兵器种类（含科技升级）取', () => {
    const state = plainState();
    const unit = siegeUnit(state, { q: 20, r: 20 });
    expect(unitTactics(state, unit.id).map((tactic) => tactic.id)).toEqual(['siege-break']);

    unit.siegeWeapon = 'tower';
    expect(unitTactics(state, unit.id).map((tactic) => tactic.id)).toEqual(['siege-fire']);

    // 科技「机械」把冲车升成木兽（放射），「弹道」把井阑升成投石车（投石）
    state.forces.liu.techNodes = ['jixie'];
    unit.siegeWeapon = 'ram';
    expect(unitTactics(state, unit.id).map((tactic) => tactic.id)).toEqual(['siege-radiate']);
    state.forces.liu.techNodes = ['dandao'];
    unit.siegeWeapon = 'tower';
    expect(unitTactics(state, unit.id).map((tactic) => tactic.id)).toEqual(['siege-stone']);

    expect(SIEGE_TACTIC_OF_WEAPON).toEqual({
      ram: 'siege-break',
      woodenBeast: 'siege-radiate',
      tower: 'siege-fire',
      catapult: 'siege-stone',
    });
    expect(isSiegeTactic('siege-break')).toBe(true);
    expect(isSiegeTactic('spear-thrust')).toBe(false);
  });

  it('兵器战法不看兵种适性（原版：无适性要求、不会施展失败）', () => {
    const state = plainState();
    const unit = siegeUnit(state, { q: 20, r: 20 });
    const guanYu = state.officers['guan-yu'];
    guanYu.aptitudes = { ...(guanYu.aptitudes as OfficerAptitudes), siege: 'C' };
    expect(unitCanUseTactic(state, unit.id, 'siege-break')).toBe(true);

    // 对照：枪兵战法仍然要求适性
    state.units.spear = { ...unit, id: 'spear', troopType: 'spear' };
    guanYu.aptitudes = { ...(guanYu.aptitudes as OfficerAptitudes), spear: 'C' };
    expect(unitCanUseTactic(state, 'spear', 'spear-thrust')).toBe(false);
  });
});

describe('兵器战法目标范围', () => {
  const origin = { q: 20, r: 20 };

  it('冲车「破碎」只打建筑，不打部队', () => {
    const state = plainState();
    const unit = siegeUnit(state, origin);
    enemyUnit(state, ringAt(origin, 1));

    expect(tacticTargetUnits(state, unit.id, 'siege-break')).toEqual([]);
  });

  it('木兽「放射」只打邻接的部队', () => {
    const state = plainState(['jixie']);
    const unit = siegeUnit(state, origin);
    const near = enemyUnit(state, ringAt(origin, 1));
    enemyUnit(state, ringAt(origin, 2), 'foe2');

    expect(tacticTargetUnits(state, unit.id, 'siege-radiate').map((target) => target.id)).toEqual([near.id]);
  });

  it('井阑「火矢」只打恰第 2 格的目标', () => {
    const state = plainState();
    const unit = siegeUnit(state, origin, { siegeWeapon: 'tower' });
    enemyUnit(state, ringAt(origin, 1));
    const second = enemyUnit(state, ringAt(origin, 2), 'foe2');
    enemyUnit(state, ringAt(origin, 3), 'foe3');

    expect(tacticTargetUnits(state, unit.id, 'siege-fire').map((target) => target.id)).toEqual([second.id]);
  });

  it('投石「投石」打 2~3 格的目标', () => {
    const state = plainState(['dandao']);
    const unit = siegeUnit(state, origin, { siegeWeapon: 'tower' });
    enemyUnit(state, ringAt(origin, 1));
    const second = enemyUnit(state, ringAt(origin, 2), 'foe2');
    const third = enemyUnit(state, ringAt(origin, 3), 'foe3');
    enemyUnit(state, ringAt(origin, 4), 'foe4');

    expect(tacticTargetUnits(state, unit.id, 'siege-stone').map((target) => target.id).sort())
      .toEqual([second.id, third.id].sort());
  });

  it('建筑目标：冲车贴城可打，井阑要隔一格（按城池轮廓最近格算距离）', () => {
    const state = plainState();
    const enemyCity = Object.values(state.cities).find((city) => city.ownerId !== 'liu')!;
    const anchor = { q: enemyCity.gridQ, r: enemyCity.gridR };
    // 城池轮廓 = 中心 + 6 邻居，站在邻居格上贴脸、站到外侧 2 格时轮廓距离为 1
    siegeUnit(state, ringAt(anchor, 2));
    expect(tacticTargetCities(state, 'siege', 'siege-break').some((city) => city.id === enemyCity.id)).toBe(true);

    state.units.siege.siegeWeapon = 'tower';
    // 井阑只打第 2 格：轮廓最近距离 1 时打不到
    expect(tacticTargetCities(state, 'siege', 'siege-fire')).toEqual([]);

    state.units.siege.q = ringAt(anchor, 3).q;
    state.units.siege.r = ringAt(anchor, 3).r;
    expect(tacticTargetCities(state, 'siege', 'siege-fire').some((city) => city.id === enemyCity.id)).toBe(true);
  });
});

describe('兵器战法结算', () => {
  it('冲车「破碎」打据点：扣耐久、扣战力（不动士气）、运输队之外不反击', () => {
    const state = plainState();
    const enemyCity = Object.values(state.cities).find((city) => city.ownerId !== 'liu')!;
    const anchor = { q: enemyCity.gridQ, r: enemyCity.gridR };
    const unit = siegeUnit(state, ringAt(anchor, 2));
    const durabilityBefore = enemyCity.durability;

    const after = useSiegeTacticOnStructure(state, 'liu', unit.id, enemyCity.id, 'siege-break');

    expect(after.cities[enemyCity.id].durability).toBeLessThan(durabilityBefore);
    expect(after.units[unit.id].stamina).toBe(100 - 20);
    expect(after.units[unit.id].energy).toBe(100);
    expect(after.units[unit.id].acted).toBe(true);
  });

  it('木兽「放射」打部队：造成伤害并使目标格着火', () => {
    const state = plainState(['jixie']);
    const origin = { q: 20, r: 20 };
    const unit = siegeUnit(state, origin);
    const foe = enemyUnit(state, ringAt(origin, 1));

    const after = useUnitTactic(state, 'liu', unit.id, foe.id, 'siege-radiate');

    expect(after.units[foe.id].troops).toBeLessThan(foe.troops);
    expect(after.units[unit.id].stamina).toBe(100 - 20);
    expect(after.firePlots?.some((plot) => plot.q === foe.q && plot.r === foe.r)).toBe(true);
  });

  it('冲车打部队被拒绝（破碎只打建筑）', () => {
    const state = plainState();
    const origin = { q: 20, r: 20 };
    const unit = siegeUnit(state, origin);
    const foe = enemyUnit(state, ringAt(origin, 1));

    expect(() => useUnitTactic(state, 'liu', unit.id, foe.id, 'siege-break')).toThrow(/目标不在战法范围/);
    expect(() => useUnitTactic(state, 'liu', unit.id, unit.id, 'siege-break')).toThrow();
    // 兵器战法不能打关隘以外的空目标
    expect(() => useSiegeTacticOnStructure(state, 'liu', unit.id, 'not-a-target', 'siege-break')).toThrow(/目标不在战法范围/);
  });
});

describe('兵器战法打开发设施', () => {
  const origin = { q: 20, r: 20 };
  const keyOf = (plot: PlotAttackTarget) => plotTargetKey(plot.cityId, plot.plotIndex);

  /** 清掉全部城市的开发地格，避免剧本自带地格混进断言 */
  function resetPlots(state: GameState) {
    for (const city of Object.values(state.cities)) city.plots = [];
  }

  /** 在敌方襄阳铺一格开发设施（返回它的 `cityId:plotIndex` 标识） */
  function addPlot(state: GameState, coord: { q: number; r: number }, id: string) {
    const city = state.cities.xiangyang;
    city.plots = [
      ...(city.plots ?? []),
      { id, type: 'market', level: 1, value: 0, q: coord.q, r: coord.r, durability: 500 },
    ];
    return plotTargetKey(city.id, city.plots.length - 1);
  }

  it('冲车「破碎」打相邻的敌方开发设施；只有开发设施可打时战法也可用', () => {
    const state = plainState();
    siegeUnit(state, origin);
    resetPlots(state);
    const nearKey = addPlot(state, ringAt(origin, 1), 'p-near');

    expect(tacticTargetPlots(state, 'siege', 'siege-break').map(keyOf)).toEqual([nearKey]);
    expect(tacticHasAnyTarget(state, 'siege', 'siege-break')).toBe(true);

    // 第 2 格的地格超出破碎射程（1 格）
    addPlot(state, ringAt(origin, 2), 'p-far');
    expect(tacticTargetPlots(state, 'siege', 'siege-break').map(keyOf)).toEqual([nearKey]);
  });

  it('井阑「火矢」恰第 2 格才能打开发设施（相邻格打不到）', () => {
    const state = plainState();
    siegeUnit(state, origin, { siegeWeapon: 'tower' });
    resetPlots(state);
    addPlot(state, ringAt(origin, 1), 'p-near');
    expect(tacticTargetPlots(state, 'siege', 'siege-fire')).toEqual([]);

    const secondKey = addPlot(state, ringAt(origin, 2), 'p-far');
    expect(tacticTargetPlots(state, 'siege', 'siege-fire').map(keyOf)).toEqual([secondKey]);
  });

  it('投石「投石」能打 2~3 格的开发设施，打不到相邻格', () => {
    const state = plainState(['dandao']);
    siegeUnit(state, origin, { siegeWeapon: 'tower' });
    resetPlots(state);
    addPlot(state, ringAt(origin, 1), 'p-near');
    const secondKey = addPlot(state, ringAt(origin, 2), 'p-second');
    const thirdKey = addPlot(state, ringAt(origin, 3), 'p-third');
    addPlot(state, ringAt(origin, 4), 'p-fourth');

    expect(tacticTargetPlots(state, 'siege', 'siege-stone').map(keyOf).sort()).toEqual([secondKey, thirdKey].sort());
  });

  it('冲车「破碎」打开发设施：扣地格耐久与战力（不动士气）', () => {
    const state = plainState();
    const unit = siegeUnit(state, origin);
    resetPlots(state);
    const key = addPlot(state, ringAt(origin, 1), 'p-market');
    // 抬高耐久，确保这一刀只削耐久、不把地格打空
    state.cities.xiangyang.plots![0].durability = 5000;

    const after = useSiegeTacticOnStructure(state, 'liu', unit.id, key, 'siege-break');

    expect(after.cities.xiangyang.plots![0].durability).toBeLessThan(5000);
    expect(after.cities.xiangyang.plots![0].type).toBe('market');
    expect(after.units[unit.id].stamina).toBe(100 - 20);
    expect(after.units[unit.id].energy).toBe(100);
    expect(after.units[unit.id].acted).toBe(true);
  });

  it('开发设施耐久归零后地格清空（与普攻同一结算）', () => {
    const state = plainState();
    const unit = siegeUnit(state, origin);
    resetPlots(state);
    const key = addPlot(state, ringAt(origin, 1), 'p-market');
    state.cities.xiangyang.plots![0].durability = 1;

    const destroyed = useSiegeTacticOnStructure(state, 'liu', unit.id, key, 'siege-break');

    expect(destroyed.cities.xiangyang.plots![0]).toMatchObject({ type: 'empty', level: 0, durability: 0 });
  });

  it('不能打己方开发设施，也不接受畸形的目标标识', () => {
    const state = plainState();
    const unit = siegeUnit(state, origin);
    resetPlots(state);
    const ownCity = state.cities.jiangling;
    const coord = ringAt(origin, 1);
    ownCity.plots = [{ id: 'p-own', type: 'market', level: 1, value: 0, q: coord.q, r: coord.r, durability: 500 }];
    const ownKey = plotTargetKey(ownCity.id, 0);

    expect(tacticTargetPlots(state, unit.id, 'siege-break')).toEqual([]);
    expect(() => useSiegeTacticOnStructure(state, 'liu', unit.id, ownKey, 'siege-break')).toThrow(/目标不在战法范围/);

    expect(parsePlotTargetKey(ownKey)).toEqual({ cityId: ownCity.id, plotIndex: 0 });
    expect(parsePlotTargetKey('not-a-target')).toBeNull();
    expect(parsePlotTargetKey('xiangyang:')).toBeNull();
  });
});
