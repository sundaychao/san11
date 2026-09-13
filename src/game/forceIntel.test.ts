import { describe, expect, it } from 'vitest';
import { ARMAMENT_TYPES } from './armaments';
import { forceRelationView, relationTierLabel, relationTierOf } from './diplomacy';
import { forceIntelOf } from './forceIntel';
import { createGame } from './scenario/jingxiang208';
import type { ForceId } from './types';

/** 取一个非玩家势力（外交一览只列他方势力） */
function otherForce(state: ReturnType<typeof createGame>): ForceId {
  return (Object.keys(state.forces) as ForceId[]).find((id) => id !== state.playerForceId)!;
}

describe('友好度档位', () => {
  it('按原版 80 / 60 / 40 / 20 切成五档（每 20 点一档）', () => {
    expect(relationTierOf(100)).toBe('intimate');
    expect(relationTierOf(80)).toBe('intimate');
    expect(relationTierOf(79)).toBe('friendly');
    expect(relationTierOf(60)).toBe('friendly');
    expect(relationTierOf(59)).toBe('neutral');
    expect(relationTierOf(40)).toBe('neutral');
    expect(relationTierOf(39)).toBe('discord');
    expect(relationTierOf(20)).toBe('discord');
    expect(relationTierOf(19)).toBe('hostile');
    expect(relationTierOf(0)).toBe('hostile');
  });

  it('档位中文名与原版一致（险恶/不和/中立/友好/亲密）', () => {
    expect([90, 70, 50, 30, 10].map(relationTierLabel)).toEqual(['亲密', '友好', '中立', '不和', '险恶']);
  });
});

describe('势力外交视图', () => {
  it('开局无盟约：中立、友好度 50、履行 ✕', () => {
    const state = createGame('liu', 1);
    const view = forceRelationView(state, state.playerForceId, otherForce(state));
    expect(view).toMatchObject({
      friendly: 50,
      tier: 'neutral',
      tierLabel: '中立',
      relationLabel: '中立',
      allied: false,
      truceTenDays: 0,
      honored: false,
    });
  });

  it('同盟：关系为同盟、履行 ✓', () => {
    const state = createGame('liu', 1);
    const target = otherForce(state);
    state.forces[state.playerForceId].allies = [target];
    state.forces[target].allies = [state.playerForceId];

    const view = forceRelationView(state, state.playerForceId, target);
    expect(view.allied).toBe(true);
    expect(view.relationLabel).toBe('同盟');
    expect(view.honored).toBe(true);
  });

  it('停战：关系为停战、按旬记录剩余期，单边记录也认', () => {
    const state = createGame('liu', 1);
    const target = otherForce(state);
    // 只有对方那一侧写了记录（旧存档/异常写入），也应视为停战期内
    state.forces[target].truces = { [state.playerForceId]: 12 };

    const view = forceRelationView(state, state.playerForceId, target);
    expect(view.truceTenDays).toBe(12);
    expect(view.relationLabel).toBe('停战');
    expect(view.honored).toBe(true);
  });

  it('友好度归档与相性差一并返回', () => {
    const state = createGame('liu', 1);
    const target = otherForce(state);
    state.forces[state.playerForceId].diplomacy = { [target]: 85 };

    const view = forceRelationView(state, state.playerForceId, target);
    expect(view.friendly).toBe(85);
    expect(view.tierLabel).toBe('亲密');
    expect(view.compatibleDiff).toBeGreaterThanOrEqual(0);
    expect(view.compatibleDiff).toBeLessThanOrEqual(75);
  });
});

describe('势力情报汇总', () => {
  it('城池/兵力/资金/兵粮与 state 中该势力的据点一一对应', () => {
    const state = createGame('liu', 1);
    const id = otherForce(state);
    const cities = Object.values(state.cities).filter((city) => city.ownerId === id);
    const passes = Object.values(state.passes ?? {}).filter((pass) => pass.ownerId === id);

    const intel = forceIntelOf(state, id);

    expect(intel.cityCount).toBe(cities.length);
    expect(intel.passCount).toBe(passes.length);
    expect(intel.cityTroops).toBe(cities.reduce((sum, city) => sum + city.troops, 0));
    expect(intel.cityGold).toBe(cities.reduce((sum, city) => sum + city.gold, 0));
    expect(intel.cityFood).toBe(cities.reduce((sum, city) => sum + city.food, 0));
    expect(intel.gold).toBe(intel.cityGold + intel.passGold);
    expect(intel.food).toBe(intel.cityFood + intel.passFood);
    expect(intel.troops).toBe(intel.cityTroops + intel.unitTroops);
    expect(intel.alive).toBe(cities.length > 0 || passes.length > 0);
  });

  it('兵装按据点库存合计（含关隘）', () => {
    const state = createGame('liu', 1);
    const id = otherForce(state);
    // 清空该势力所有据点库存后重新写入，验证合计只统计自家据点
    for (const city of Object.values(state.cities)) {
      if (city.ownerId === id) city.armaments = undefined;
    }
    for (const pass of Object.values(state.passes ?? {})) {
      if (pass.ownerId === id) pass.armaments = undefined;
    }
    const owned = Object.values(state.cities).filter((city) => city.ownerId === id);
    owned[0].armaments = { spear: 1000, halberd: 0, crossbow: 0, cavalry: 0, ram: 1, tower: 0, ship: 0 };
    if (owned[1]) owned[1].armaments = { spear: 2500, halberd: 0, crossbow: 0, cavalry: 0, ram: 0, tower: 0, ship: 0 };

    const intel = forceIntelOf(state, id);
    expect(intel.armaments.spear).toBe(owned[1] ? 3500 : 1000);
    expect(intel.armaments.ram).toBe(1);
    for (const type of ARMAMENT_TYPES) {
      expect(Number.isFinite(intel.armaments[type])).toBe(true);
    }
  });

  it('失去全部据点即视为灭亡', () => {
    const state = createGame('liu', 1);
    const id = otherForce(state);
    for (const city of Object.values(state.cities)) if (city.ownerId === id) city.ownerId = null;
    for (const pass of Object.values(state.passes ?? {})) if (pass.ownerId === id) pass.ownerId = null;

    const intel = forceIntelOf(state, id);
    expect(intel.alive).toBe(false);
    expect(intel.troops).toBe(0);
    expect(intel.gold).toBe(0);
  });
});
