import { describe, expect, it } from 'vitest';
import { createGame } from '../scenario/jingxiang208';
import type { ArmyUnit } from '../types';
import { AURA_ATTACK_MULTIPLIER, auraRangeForLeadership, unitAuraRange, unitUnderAura } from './aura';
import { damageRoll } from './shared';

function addUnit(
  state: ReturnType<typeof createGame>,
  unit: { id: string; leaderId: string; forceId: 'liu' | 'cao'; q: number; r: number; troops?: number; kind?: 'combat' | 'transport' },
) {
  state.units[unit.id] = {
    id: unit.id,
    kind: unit.kind ?? 'combat',
    forceId: unit.forceId,
    leaderId: unit.leaderId,
    homeCityId: 'jiangling',
    troopType: 'sword',
    q: unit.q,
    r: unit.r,
    troops: unit.troops ?? 3000,
    food: 3000,
    stamina: 100,
    energy: 100,
    movementRemaining: 20,
    moved: false,
    acted: false,
  } as ArmyUnit;
  state.officers[unit.leaderId].location = { kind: 'unit', unitId: unit.id };
}

describe('officer aura system', () => {
  it('maps leadership to aura range tiers', () => {
    expect(auraRangeForLeadership(89)).toBe(0);
    expect(auraRangeForLeadership(90)).toBe(1);
    expect(auraRangeForLeadership(95)).toBe(1);
    expect(auraRangeForLeadership(96)).toBe(2);
    expect(auraRangeForLeadership(99)).toBe(2);
    expect(auraRangeForLeadership(100)).toBe(3);
  });

  it('derives unit aura range from the leader leadership', () => {
    const state = createGame('liu', 1);
    addUnit(state, { id: 'guan', leaderId: 'guan-yu', forceId: 'liu', q: 10, r: 10 });
    expect(unitAuraRange(state, state.units.guan)).toBe(1);

    state.officers['liu-bei'].stats.leadership = 100;
    addUnit(state, { id: 'liu', leaderId: 'liu-bei', forceId: 'liu', q: 12, r: 10 });
    expect(unitAuraRange(state, state.units.liu)).toBe(3);

    addUnit(state, { id: 'transport', leaderId: 'guan-yu', forceId: 'liu', q: 14, r: 10, kind: 'transport' });
    expect(unitAuraRange(state, state.units.transport)).toBe(0);
  });

  it('covers friendly units within range including the aura holder itself', () => {
    const state = createGame('liu', 1);
    addUnit(state, { id: 'plain', leaderId: 'liu-bei', forceId: 'liu', q: 10, r: 10 });
    addUnit(state, { id: 'guan', leaderId: 'guan-yu', forceId: 'liu', q: 11, r: 10 });
    // 关羽（统率95，光环1格）相邻：范围内
    expect(unitUnderAura(state, state.units.plain)).toBe(true);
    // 光环持有者自身在范围内
    expect(unitUnderAura(state, state.units.guan)).toBe(true);

    const distant = createGame('liu', 1);
    addUnit(distant, { id: 'plain', leaderId: 'liu-bei', forceId: 'liu', q: 10, r: 10 });
    addUnit(distant, { id: 'guan', leaderId: 'guan-yu', forceId: 'liu', q: 13, r: 10 });
    // 距离3，超出关羽1格光环
    expect(unitUnderAura(distant, distant.units.plain)).toBe(false);

    const enemy = createGame('liu', 1);
    addUnit(enemy, { id: 'cao', leaderId: 'cao-ren', forceId: 'cao', q: 10, r: 10 });
    addUnit(enemy, { id: 'guan', leaderId: 'guan-yu', forceId: 'liu', q: 11, r: 10 });
    // 光环只对同势力部队生效
    expect(unitUnderAura(enemy, enemy.units.cao)).toBe(false);
  });

  it('extends aura range to 2 cells for leadership 96', () => {
    const state = createGame('cao', 1);
    addUnit(state, { id: 'ren', leaderId: 'cao-ren', forceId: 'cao', q: 10, r: 10 });
    addUnit(state, { id: 'cao', leaderId: 'cao-cao', forceId: 'cao', q: 12, r: 10 });
    // 曹操统率96（光环2格）：距离2的曹仁在范围内
    expect(unitAuraRange(state, state.units.cao)).toBe(2);
    expect(unitUnderAura(state, state.units.ren)).toBe(true);
  });

  it('boosts attack damage by 5% for units under aura', () => {
    const state = createGame('liu', 1);
    addUnit(state, { id: 'attacker', leaderId: 'liu-bei', forceId: 'liu', q: 10, r: 10, troops: 4000 });
    addUnit(state, { id: 'defender', leaderId: 'cao-ren', forceId: 'cao', q: 11, r: 10, troops: 4000 });

    const cursor = state.rngCursor;
    const base = damageRoll(state, state.units.attacker, 'plain', false, state.units.defender);

    addUnit(state, { id: 'aura', leaderId: 'guan-yu', forceId: 'liu', q: 10, r: 9 });
    state.rngCursor = cursor;
    const boosted = damageRoll(state, state.units.attacker, 'plain', false, state.units.defender);

    expect(boosted).toBeGreaterThan(base);
    expect(boosted / base).toBeCloseTo(AURA_ATTACK_MULTIPLIER, 1);
  });

  it('reduces incoming damage by 5% for defenders under aura', () => {
    const state = createGame('liu', 1);
    addUnit(state, { id: 'attacker', leaderId: 'liu-bei', forceId: 'liu', q: 10, r: 10, troops: 4000 });
    addUnit(state, { id: 'defender', leaderId: 'cao-ren', forceId: 'cao', q: 11, r: 10, troops: 4000 });

    const cursor = state.rngCursor;
    const base = damageRoll(state, state.units.attacker, 'plain', false, state.units.defender);

    addUnit(state, { id: 'aura', leaderId: 'cao-cao', forceId: 'cao', q: 12, r: 10 });
    state.rngCursor = cursor;
    const reduced = damageRoll(state, state.units.attacker, 'plain', false, state.units.defender);

    expect(reduced).toBeLessThan(base);
    expect(reduced / base).toBeCloseTo(0.95, 1);
  });
});
