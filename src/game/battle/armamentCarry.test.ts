import { describe, expect, it } from 'vitest';
import { armamentsOf, initialArmaments } from '../armaments';
import { createGame } from '../scenario/jingxiang208';
import type { ArmyUnit, GameState } from '../types';
import { deployUnit, deployUnitWithId } from './deployment';
import { moveUnit } from './movement';
import { cellAt } from './movementRules';
import { getDeploymentTargets } from './queries';
import { neighborsOf, sevenCellCityFootprint } from './grid';

/**
 * 部队随身兵装的「携带 → 返还」闭环。
 *
 * 玩家反馈：「骑兵占领空关隘后，进入关隘，军马的数量消失了」——
 * 出征时从据点扣了军马，并账（回城/回关/进驻）时却没有还回来，装备凭空蒸发。
 */
describe('部队随身兵装的携带与返还', () => {
  /** 在城池 footprint 外找一格邻接格（保证部队离城够近） */
  function spawnCellNearCity(state: GameState, city: { gridQ: number; gridR: number }) {
    const footprintKeys = new Set(sevenCellCityFootprint({ q: city.gridQ, r: city.gridR }).map((c) => `${c.q},${c.r}`));
    return neighborsOf(city.gridQ, city.gridR).flatMap((n) => neighborsOf(n.q, n.r))
      .find((c) => !footprintKeys.has(`${c.q},${c.r}`) && cellAt(state, c))!;
  }

  /** 在关隘附近找一格非关隘的可通行格 */
  function spawnCellNearPass(state: GameState, pass: { q: number; r: number }) {
    const near = [...neighborsOf(pass.q, pass.r), ...neighborsOf(pass.q, pass.r).flatMap((n) => neighborsOf(n.q, n.r))];
    return near.find((c) => cellAt(state, c) && cellAt(state, c)!.terrain !== 'pass')!;
  }

  function makeUnit(
    state: GameState,
    coord: { q: number; r: number },
    overrides: Partial<ArmyUnit> = {},
  ): ArmyUnit {
    const unit: ArmyUnit = {
      id: 'carry-test-unit',
      kind: 'combat',
      forceId: 'liu',
      leaderId: 'liu-bei',
      homeCityId: 'jiangling',
      troopType: 'cavalry',
      q: coord.q,
      r: coord.r,
      troops: 3000,
      food: 3000,
      energy: 100,
      movementRemaining: 30,
      moved: false,
      acted: false,
      ...overrides,
    };
    state.units[unit.id] = unit;
    return unit;
  }

  /** 出征（宛·曹操骑兵），返回新状态与部队 id */
  function deployWanCavalry(troops = 1500) {
    const state = createGame('cao', 1);
    state.cities.wan.armaments = { ...armamentsOf(state.cities.wan.armaments), cavalry: 5000 };
    const spawn = getDeploymentTargets(state, { cityId: 'wan', troopType: 'cavalry', officerIds: ['cao-cao'] })[0]!;
    const sim = deployUnitWithId(state, 'cao', {
      cityId: 'wan', officerIds: ['cao-cao'], troopType: 'cavalry', troops, food: 6000, destination: spawn,
    });
    return { sim, spawn };
  }

  it('骑兵出征：据点扣军马，部队记下带走的兵装', () => {
    const { sim } = deployWanCavalry();

    expect(sim.state.cities.wan.armaments!.cavalry).toBe(3500);
    expect(sim.state.units[sim.unitId].armaments).toEqual({ cavalry: 1500 });
  });

  it('骑兵回城：带走的军马全额回到据点', () => {
    const { sim } = deployWanCavalry();
    const unit = sim.state.units[sim.unitId];
    unit.moved = false;
    unit.acted = false;
    unit.movementRemaining = 30;

    const next = moveUnit(sim.state, 'cao', sim.unitId, { q: sim.state.cities.wan.gridQ, r: sim.state.cities.wan.gridR });

    expect(next.units[sim.unitId]).toBeUndefined();
    expect(next.cities.wan.armaments!.cavalry).toBe(5000);
  });

  it('骑兵进驻无主空关隘：军马随部队进入关隘（玩家反馈的场景）', () => {
    const { sim } = deployWanCavalry();
    const state = sim.state;
    const pass = Object.values(state.passes!).find((candidate) => !candidate.ownerId && candidate.troops === 0)!;
    const before = armamentsOf(pass.armaments).cavalry;
    // 把关隘周边当作行军若干旬后的位置，再走真实的「移动到关隘锚点」路径
    const near = spawnCellNearPass(state, pass);
    const unit = state.units[sim.unitId];
    unit.q = near.q;
    unit.r = near.r;
    unit.moved = false;
    unit.acted = false;
    unit.movementRemaining = 30;

    const next = moveUnit(state, 'cao', sim.unitId, { q: pass.q, r: pass.r });

    expect(next.passes![pass.id].ownerId).toBe('cao');
    expect(next.passes![pass.id].armaments!.cavalry).toBe(before + 1500);
  });

  it('战损后回城：枪戟弩马只按实际并入的兵力返还，楼船/兵器整件返还', () => {
    const state = createGame('liu', 1);
    const city = state.cities.jiangling;
    city.armaments = { ...initialArmaments() };
    const spawn = spawnCellNearCity(state, city);
    // 出征时带了 3000 军马与 1 辆冲车，打剩 1800 兵
    makeUnit(state, spawn, { troops: 1800, armaments: { cavalry: 3000, ram: 1 } });

    const next = moveUnit(state, 'liu', 'carry-test-unit', { q: city.gridQ, r: city.gridR });

    expect(next.cities.jiangling.armaments!.cavalry).toBe(initialArmaments().cavalry + 1800);
    expect(next.cities.jiangling.armaments!.ram).toBe(initialArmaments().ram + 1);
  });

  it('兵种兵装与楼船同时出征时都要扣（不再互相覆盖）', () => {
    const state = createGame('liu', 1);
    state.cities.jiangling.armaments = { ...initialArmaments(), ship: 5 };
    const deployed = deployUnit(state, 'liu', {
      cityId: 'jiangling', officerId: 'guan-yu', troopType: 'spear', vehicle: 'ship', troops: 4000, food: 5000,
    });
    const unit = Object.values(deployed.units)[0];

    expect(deployed.cities.jiangling.armaments!.spear).toBe(initialArmaments().spear - 4000);
    expect(deployed.cities.jiangling.armaments!.ship).toBe(4);
    expect(unit.armaments).toEqual({ spear: 4000, ship: 1 });
  });

  it('未记录随身兵装的部队并入据点不返还兵装（疆域防御队/输送队/旧存档）', () => {
    const state = createGame('liu', 1);
    const city = state.cities.jiangling;
    city.armaments = { ...initialArmaments() };
    // 这类部队是直接从城池兵力生成的，没有「出征时扣兵装」这一步，故不该返还
    makeUnit(state, spawnCellNearCity(state, city), { troopType: 'spear' });

    const next = moveUnit(state, 'liu', 'carry-test-unit', { q: city.gridQ, r: city.gridR });

    expect(next.cities.jiangling.armaments).toEqual(initialArmaments());
  });

  it('返还后按据点兵装上限截断（关隘军马上限 1 万）', () => {
    const state = createGame('cao', 1);
    const pass = Object.values(state.passes!).find((candidate) => !candidate.ownerId && candidate.troops === 0)!;
    const near = spawnCellNearPass(state, pass);
    makeUnit(state, near, {
      forceId: 'cao',
      leaderId: 'cao-cao',
      homeCityId: 'wan',
      troops: 12_000,
      armaments: { cavalry: 12_000 },
    });

    const next = moveUnit(state, 'cao', 'carry-test-unit', { q: pass.q, r: pass.r });

    expect(next.passes![pass.id].armaments!.cavalry).toBe(10_000);
  });
});
