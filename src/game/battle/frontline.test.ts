import { describe, expect, it } from 'vitest';
import { createGame } from '../scenario/jingxiang208';
import type { ArmyUnit, TroopType } from '../types';
import { committedTroops, frontCount, frontWidthForTerrain } from './frontline';

function addUnit(
  state: ReturnType<typeof createGame>,
  unit: { id: string; leaderId: string; forceId: 'liu' | 'cao'; q: number; r: number; troops?: number; troopType?: TroopType },
) {
  state.units[unit.id] = {
    id: unit.id,
    kind: 'combat',
    forceId: unit.forceId,
    leaderId: unit.leaderId,
    homeCityId: unit.forceId === 'liu' ? 'jiangling' : 'xiangyang',
    troopType: unit.troopType ?? 'halberd',
    q: unit.q,
    r: unit.r,
    troops: unit.troops ?? 6000,
    food: 6000,
    stamina: 100,
    energy: 100,
    movementRemaining: 20,
    moved: false,
    acted: false,
  } as ArmyUnit;
  state.officers[unit.leaderId].location = { kind: 'unit', unitId: unit.id };
}

function freshState() {
  const state = createGame('liu', 1);
  for (const cell of state.grid) cell.terrain = 'plain';
  return state;
}

describe('frontline split system', () => {
  it('maps terrain to front width', () => {
    expect(frontWidthForTerrain('plain')).toBe(4000);
    expect(frontWidthForTerrain('grass')).toBe(4000);
    expect(frontWidthForTerrain('poison')).toBe(3000);
    expect(frontWidthForTerrain('forest')).toBe(3000);
    expect(frontWidthForTerrain('ferry')).toBe(3000);
    expect(frontWidthForTerrain('plank')).toBe(2000);
    expect(frontWidthForTerrain('path')).toBe(2000);
  });

  it('caps a 6000-strong unit at 4000 against one adjacent enemy on open terrain', () => {
    const state = freshState();
    addUnit(state, { id: 'me', leaderId: 'guan-yu', forceId: 'liu', q: 10, r: 10, troops: 6000 });
    addUnit(state, { id: 'enemy', leaderId: 'cao-ren', forceId: 'cao', q: 11, r: 10, troops: 6000 });
    expect(frontCount(state, state.units.me, state.units.enemy)).toBe(1);
    expect(committedTroops(state, state.units.me, state.units.enemy)).toBe(4000);
  });

  it('splits troops across two adjacent enemies', () => {
    const state = freshState();
    addUnit(state, { id: 'me', leaderId: 'guan-yu', forceId: 'liu', q: 10, r: 10, troops: 6000 });
    addUnit(state, { id: 'enemy-a', leaderId: 'cao-ren', forceId: 'cao', q: 11, r: 10, troops: 6000 });
    addUnit(state, { id: 'enemy-b', leaderId: 'xu-huang', forceId: 'cao', q: 11, r: 9, troops: 6000 });
    expect(frontCount(state, state.units.me, state.units['enemy-a'])).toBe(2);
    // 6000/2 = 3000，两条战线各投入3000
    expect(committedTroops(state, state.units.me, state.units['enemy-a'])).toBe(3000);
    expect(committedTroops(state, state.units.me, state.units['enemy-b'])).toBe(3000);
  });

  it('a 3000-strong unit surrounded by three enemies commits 1000 per front', () => {
    const state = freshState();
    addUnit(state, { id: 'me', leaderId: 'guan-yu', forceId: 'liu', q: 10, r: 10, troops: 3000 });
    addUnit(state, { id: 'a', leaderId: 'cao-ren', forceId: 'cao', q: 11, r: 10, troops: 6000 });
    addUnit(state, { id: 'b', leaderId: 'xu-huang', forceId: 'cao', q: 11, r: 9, troops: 6000 });
    addUnit(state, { id: 'c', leaderId: 'zhang-liao', forceId: 'cao', q: 10, r: 9, troops: 6000 });
    expect(frontCount(state, state.units.me, state.units.a)).toBe(3);
    expect(committedTroops(state, state.units.me, state.units.a)).toBe(1000);
  });

  it('counts a distant ranged target as an extra front', () => {
    const state = freshState();
    addUnit(state, { id: 'crossbow', leaderId: 'guan-yu', forceId: 'liu', q: 10, r: 10, troops: 6000, troopType: 'crossbow' });
    addUnit(state, { id: 'adjacent', leaderId: 'cao-ren', forceId: 'cao', q: 11, r: 10, troops: 6000 });
    addUnit(state, { id: 'ranged-target', leaderId: 'xu-huang', forceId: 'cao', q: 13, r: 10, troops: 6000 });
    // 邻接1支 + 远程目标1支 = 分摊2，6000/2 = 3000
    expect(frontCount(state, state.units.crossbow, state.units['ranged-target'])).toBe(2);
    expect(committedTroops(state, state.units.crossbow, state.units['ranged-target'])).toBe(3000);
  });

  it('counts a distant ranged attacker as an extra front on counter-attack', () => {
    const state = freshState();
    addUnit(state, { id: 'crossbow', leaderId: 'guan-yu', forceId: 'liu', q: 10, r: 10, troops: 6000, troopType: 'crossbow' });
    addUnit(state, { id: 'adjacent', leaderId: 'cao-ren', forceId: 'cao', q: 11, r: 10, troops: 6000 });
    addUnit(state, { id: 'ranged-attacker', leaderId: 'xu-huang', forceId: 'cao', q: 13, r: 10, troops: 6000 });
    // 反击：邻接1支 + 远程攻击者1支 = 分摊2
    expect(frontCount(state, state.units.crossbow, state.units['ranged-attacker'])).toBe(2);
    expect(committedTroops(state, state.units.crossbow, state.units['ranged-attacker'])).toBe(3000);
  });

  it('exempts cavalry from splitting but keeps the width cap', () => {
    const state = freshState();
    addUnit(state, { id: 'cavalry', leaderId: 'guan-yu', forceId: 'liu', q: 10, r: 10, troops: 8000, troopType: 'cavalry' });
    addUnit(state, { id: 'a', leaderId: 'cao-ren', forceId: 'cao', q: 11, r: 10, troops: 6000 });
    addUnit(state, { id: 'b', leaderId: 'xu-huang', forceId: 'cao', q: 11, r: 9, troops: 6000 });
    expect(frontCount(state, state.units.cavalry, state.units.a)).toBe(1);
    // 8000骑兵不被分摊，但受普通地形4000宽度上限
    expect(committedTroops(state, state.units.cavalry, state.units.a)).toBe(4000);

    const plank = freshState();
    const cell = plank.grid.find((c) => c.q === 10 && c.r === 10);
    if (cell) cell.terrain = 'plank';
    addUnit(plank, { id: 'cavalry', leaderId: 'guan-yu', forceId: 'liu', q: 10, r: 10, troops: 8000, troopType: 'cavalry' });
    addUnit(plank, { id: 'a', leaderId: 'cao-ren', forceId: 'cao', q: 11, r: 10, troops: 6000 });
    // 骑兵在栈道仍受2000宽度上限
    expect(committedTroops(plank, plank.units.cavalry, plank.units.a)).toBe(2000);
  });

  it('narrows the front on restrictive terrain', () => {
    const state = freshState();
    for (const coord of [[10, 10], [11, 10]]) {
      const cell = state.grid.find((c) => c.q === coord[0] && c.r === coord[1]);
      if (cell) cell.terrain = 'forest';
    }
    addUnit(state, { id: 'me', leaderId: 'guan-yu', forceId: 'liu', q: 10, r: 10, troops: 6000 });
    addUnit(state, { id: 'enemy', leaderId: 'cao-ren', forceId: 'cao', q: 11, r: 10, troops: 6000 });
    // 森林宽度3000：单条战线也最多投入3000
    expect(committedTroops(state, state.units.me, state.units.enemy)).toBe(3000);
  });

  it('scales damage linearly with committed troops', () => {
    const base = freshState();
    addUnit(base, { id: 'attacker', leaderId: 'guan-yu', forceId: 'liu', q: 10, r: 10, troops: 6000 });
    addUnit(base, { id: 'defender', leaderId: 'cao-ren', forceId: 'cao', q: 11, r: 10, troops: 6000 });

    const split = freshState();
    addUnit(split, { id: 'attacker', leaderId: 'guan-yu', forceId: 'liu', q: 10, r: 10, troops: 6000 });
    addUnit(split, { id: 'defender', leaderId: 'cao-ren', forceId: 'cao', q: 11, r: 10, troops: 6000 });
    addUnit(split, { id: 'extra', leaderId: 'xu-huang', forceId: 'cao', q: 11, r: 9, troops: 6000 });

    const single = committedTroops(base, base.units.attacker, base.units.defender);
    const divided = committedTroops(split, split.units.attacker, split.units.defender);
    expect(single / divided).toBeCloseTo(4000 / 3000, 5);
  });

  it('ignores friendly units when counting fronts', () => {
    const state = freshState();
    addUnit(state, { id: 'me', leaderId: 'guan-yu', forceId: 'liu', q: 10, r: 10, troops: 6000 });
    addUnit(state, { id: 'ally', leaderId: 'liu-bei', forceId: 'liu', q: 11, r: 10, troops: 6000 });
    addUnit(state, { id: 'enemy', leaderId: 'cao-ren', forceId: 'cao', q: 10, r: 9, troops: 6000 });
    expect(frontCount(state, state.units.me, state.units.enemy)).toBe(1);
    expect(committedTroops(state, state.units.me, state.units.enemy)).toBe(4000);
  });
});
