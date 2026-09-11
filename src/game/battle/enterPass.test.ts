import { describe, expect, it } from 'vitest';
import { createGame } from '../scenario/jingxiang208';
import type { ArmyUnit } from '../types';
import { attackPass } from './combat';
import { applyGroundFireDamageToPasses, applyImmediateFireDamageToCityAndPlot, GROUND_FIRE_CITY_DURABILITY } from './fire';
import { cellAt, movementCells } from './movementRules';
import { moveUnit } from './movement';
import { attackablePasses } from './targetRules';
import { neighborsOf } from './grid';
import { ownPassAt, passAt, unoccupiedPassAt } from '../passes';

function makeUnit(forceId: string, homeCityId: string, q: number, r: number): ArmyUnit {
  return {
    id: 'pass-test-unit',
    kind: 'combat',
    forceId,
    leaderId: 'liu-bei',
    homeCityId,
    troopType: 'sword',
    q,
    r,
    troops: 3000,
    food: 3000,
    energy: 100,
    movementRemaining: 20,
    moved: false,
    acted: false,
  } as ArmyUnit;
}

/** 在关隘中心附近找一格可通行格（非关隘中心/翼格，保证部队离关够近） */
function spawnCellNearPass(state: ReturnType<typeof createGame>, pass: { q: number; r: number }) {
  const nearCoords = [
    { q: pass.q, r: pass.r },
    ...neighborsOf(pass.q, pass.r),
    ...neighborsOf(pass.q, pass.r).flatMap((n) => neighborsOf(n.q, n.r)),
  ];
  const blocked = new Set(
    nearCoords.filter((c) => cellAt(state, c)?.terrain === 'pass').map((c) => `${c.q},${c.r}`),
  );
  return nearCoords.find(
    (c) => !blocked.has(`${c.q},${c.r}`) && cellAt(state, c) && cellAt(state, c)!.terrain !== 'pass',
  )!;
}

describe('部队进入关隘（移动到关隘锚点格）', () => {
  it('movementCells 包含可达的本方关隘锚点与无主关隘锚点，不含敌方关隘', () => {
    const state = createGame('liu', 1);
    const pass = state.passes!.wuguan;
    pass.ownerId = 'liu'; // 改为本方关隘
    const spawn = spawnCellNearPass(state, pass);
    state.units['pass-test-unit'] = makeUnit('liu', 'jiangling', spawn.q, spawn.r);

    const targets = movementCells(state, 'pass-test-unit');

    expect(targets).toContainEqual({ q: pass.q, r: pass.r });
    const enemyPass = Object.values(state.passes!).find((p) => p.ownerId && p.ownerId !== 'liu')!;
    expect(targets).not.toContainEqual({ q: enemyPass.q, r: enemyPass.r });
  });

  it('moveUnit 到本方关隘：部队消失、兵力军粮归关、武将驻关', () => {
    const state = createGame('liu', 1);
    const pass = state.passes!.wuguan;
    pass.ownerId = 'liu';
    const spawn = spawnCellNearPass(state, pass);
    state.units['pass-test-unit'] = makeUnit('liu', 'jiangling', spawn.q, spawn.r);
    const before = { troops: pass.troops, food: pass.food };

    const next = moveUnit(state, 'liu', 'pass-test-unit', { q: pass.q, r: pass.r });

    expect(next.units['pass-test-unit']).toBeUndefined();
    expect(next.passes![pass.id].troops).toBe(before.troops + 3000);
    expect(next.passes![pass.id].food).toBe(before.food + 3000);
    const officer = next.officers['liu-bei'];
    expect(officer.location).toEqual({ kind: 'pass', passId: pass.id });
    expect(officer.cityId).toBe(pass.homeCityId);
    expect(officer.acted).toBe(true);
    expect(next.logs.some((log) => log.message.includes('返回'))).toBe(true);
  });

  it('moveUnit 到无主关隘：进驻占领（关隘易主、兵不血刃）', () => {
    const state = createGame('liu', 1);
    const pass = state.passes!.wuguan;
    expect(pass.ownerId).toBeNull();
    const spawn = spawnCellNearPass(state, pass);
    state.units['pass-test-unit'] = makeUnit('liu', 'jiangling', spawn.q, spawn.r);

    const next = moveUnit(state, 'liu', 'pass-test-unit', { q: pass.q, r: pass.r });

    expect(next.units['pass-test-unit']).toBeUndefined();
    expect(next.passes![pass.id].ownerId).toBe('liu');
    expect(next.passes![pass.id].troops).toBe(3000);
    expect(next.officers['liu-bei'].location).toEqual({ kind: 'pass', passId: pass.id });
    expect(next.logs.some((log) => log.message.includes('进驻'))).toBe(true);
  });

  it('moveUnit 到敌方关隘仍被拒绝', () => {
    const state = createGame('liu', 1);
    const enemyPass = Object.values(state.passes!).find((p) => p.ownerId && p.ownerId !== 'liu')!;
    const spawn = spawnCellNearPass(state, enemyPass);
    state.units['pass-test-unit'] = makeUnit('liu', 'jiangling', spawn.q, spawn.r);

    expect(() => moveUnit(state, 'liu', 'pass-test-unit', { q: enemyPass.q, r: enemyPass.r }))
      .toThrow();
  });

  it('ownPassAt / unoccupiedPassAt 只匹配对应归属的关隘锚点', () => {
    const state = createGame('liu', 1);
    const owned = state.passes!.wuguan;
    owned.ownerId = 'liu';
    const enemyPass = Object.values(state.passes!).find((p) => p.ownerId && p.ownerId !== 'liu')!;

    expect(ownPassAt(state, 'liu', { q: owned.q, r: owned.r })?.id).toBe(owned.id);
    expect(ownPassAt(state, 'liu', { q: enemyPass.q, r: enemyPass.r })).toBeUndefined();
    expect(unoccupiedPassAt(state, { q: owned.q, r: owned.r })).toBeUndefined();
    expect(passAt(state, { q: owned.q + 1, r: owned.r })).toBeUndefined();
  });
});

describe('无主关隘的攻击与火攻', () => {
  it('attackablePasses 包含无主无守军关隘，attackPass 一次即攻破占领', () => {
    const state = createGame('liu', 1);
    const pass = state.passes!.wuguan;
    expect(pass.ownerId).toBeNull();
    expect(pass.troops).toBe(0);
    const spawn = spawnCellNearPass(state, pass);
    state.units['pass-test-unit'] = makeUnit('liu', 'jiangling', spawn.q, spawn.r);

    expect(attackablePasses(state, 'pass-test-unit').map((target) => target.id)).toContain(pass.id);

    // 无守军 → 守军归零条件成立，一击即破关；资源减半、耐久重置 20%，
    // 且攻方主力直接进关接管（部队解散、兵力与随军武将并入关隘）
    const unitTroops = state.units['pass-test-unit'].troops;
    const next = attackPass(state, 'liu', 'pass-test-unit', pass.id);
    expect(next.passes![pass.id].ownerId).toBe('liu');
    expect(next.passes![pass.id].durability).toBe(Math.ceil(pass.maxDurability * 0.2));
    expect(next.units['pass-test-unit']).toBeUndefined();
    expect(next.passes![pass.id].troops).toBe(unitTroops);
    expect(next.officers['liu-bei'].location).toEqual({ kind: 'pass', passId: pass.id });
    expect(next.officers['liu-bei'].acted).toBe(true);
  });

  it('火攻无主关隘：锚点格着火时点火即时掉耐久，每旬再按火焰结算掉耐久', () => {
    const state = createGame('liu', 1);
    const pass = state.passes!.wuguan;
    expect(pass.ownerId).toBeNull();
    const before = pass.durability;

    applyImmediateFireDamageToCityAndPlot(state, { q: pass.q, r: pass.r });
    expect(state.passes!.wuguan.durability).toBe(before - GROUND_FIRE_CITY_DURABILITY);

    state.firePlots = [{ q: pass.q, r: pass.r, remainingTenDays: 3 }];
    applyGroundFireDamageToPasses(state);
    expect(state.passes!.wuguan.durability).toBe(before - GROUND_FIRE_CITY_DURABILITY * 2);
  });
});
