import { describe, expect, it } from 'vitest';
import {
  FACILITIES,
  FACILITY_BUILD_COSTS,
  PUBLIC_REPAIRABLE_FACILITY_TYPES,
  SPACING_LIMITED_FACILITY_TYPES,
  TACTICS,
  TACTICS_BY_TROOP,
  TERRAIN_COST_BY_PROFILE,
  ZOC_FACILITY_TYPES,
} from './catalog';

describe('battle catalog', () => {
  it('keeps unit definitions independent from battle execution code', () => {
    expect(TACTICS['spear-thrust']).toMatchObject({ name: '突刺', troopType: 'spear', cost: 15 });
    expect(TACTICS_BY_TROOP.spear).toEqual(['spear-thrust', 'spear-spiral', 'spear-double']);
    expect(FACILITIES.fortress).toMatchObject({ name: '城塞', durability: 1200 });
    expect(FACILITY_BUILD_COSTS.arrowTower).toBe(600);
    expect(TERRAIN_COST_BY_PROFILE.cavalry.forest).toBe(8);
  });

  it('defines the tech-unlocked field facilities with a clear durability/cost gradient', () => {
    // 据点型：阵 < 砦 < 城塞（城塞既有数值不变）
    expect(FACILITIES.formation).toMatchObject({ name: '阵', durability: 500 });
    expect(FACILITIES.fort).toMatchObject({ name: '砦', durability: 900 });
    expect(FACILITY_BUILD_COSTS.formation).toBe(300);
    expect(FACILITY_BUILD_COSTS.fort).toBe(700);
    expect(FACILITIES.formation!.durability).toBeLessThan(FACILITIES.fort!.durability);
    expect(FACILITIES.fort!.durability).toBeLessThan(FACILITIES.fortress!.durability);
    expect(FACILITY_BUILD_COSTS.formation).toBeLessThan(FACILITY_BUILD_COSTS.fort);
    expect(FACILITY_BUILD_COSTS.fort).toBeLessThan(FACILITY_BUILD_COSTS.fortress);

    // 阻挡型：土垒 < 石墙（同为只阻挡移动 + 可修补）
    expect(FACILITIES.stoneWall).toMatchObject({ name: '石墙', durability: 600 });
    expect(FACILITIES.stoneWall!.durability).toBeGreaterThan(FACILITIES.earthwork!.durability);
    expect(FACILITY_BUILD_COSTS.stoneWall).toBeGreaterThan(FACILITY_BUILD_COSTS.earthwork);

    // 攻击型：箭楼 < 连弩楼；投石台为弹道解锁的更高伤害工事
    expect(FACILITIES.crossbowTower).toMatchObject({ name: '连弩楼', durability: 900 });
    expect(FACILITIES.catapultTower).toMatchObject({ name: '投石台', durability: 800 });
    expect(FACILITIES.crossbowTower!.durability).toBeGreaterThan(FACILITIES.arrowTower!.durability);
    expect(FACILITY_BUILD_COSTS.crossbowTower).toBeGreaterThan(FACILITY_BUILD_COSTS.arrowTower);

    // 陷阱型：火焰种/火焰球 200 → 业火种/业火球 250（耐久），造价 400 → 600
    expect(FACILITIES.fireSeed).toMatchObject({ name: '火焰种', durability: 200 });
    expect(FACILITIES.fireBall).toMatchObject({ name: '火焰球', durability: 200 });
    expect(FACILITIES.hellfireSeed).toMatchObject({ name: '业火种', durability: 250 });
    expect(FACILITIES.hellfireBall).toMatchObject({ name: '业火球', durability: 250 });
    expect(FACILITY_BUILD_COSTS.hellfireSeed).toBeGreaterThan(FACILITY_BUILD_COSTS.fireSeed);
    expect(FACILITY_BUILD_COSTS.hellfireBall).toBeGreaterThan(FACILITY_BUILD_COSTS.fireBall);

    // 每种设施类型都必须同时有定义与造价
    for (const type of Object.keys(FACILITY_BUILD_COSTS)) {
      expect(FACILITIES[type as keyof typeof FACILITIES]).toBeDefined();
    }
  });

  it('classifies the new facilities into the spacing, ZOC, and public-repair sets', () => {
    for (const type of ['formation', 'fort', 'crossbowTower', 'catapultTower'] as const) {
      expect(SPACING_LIMITED_FACILITY_TYPES.has(type)).toBe(true);
      expect(ZOC_FACILITY_TYPES.has(type)).toBe(true);
      expect(PUBLIC_REPAIRABLE_FACILITY_TYPES.has(type)).toBe(false);
    }
    // 石墙与土垒同为公共可修补的纯阻挡设施；陷阱同样可被任意势力修补
    for (const type of ['earthwork', 'stoneWall', 'fireSeed', 'fireBall', 'hellfireSeed', 'hellfireBall'] as const) {
      expect(PUBLIC_REPAIRABLE_FACILITY_TYPES.has(type)).toBe(true);
      expect(ZOC_FACILITY_TYPES.has(type)).toBe(false);
    }
  });
});
