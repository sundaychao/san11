import { describe, expect, it } from 'vitest';
import { ARMAMENT_GOLD_COST, ARMAMENT_TYPES, armamentCost } from './armaments';
import { executeCommand, rollMerchants, validateCommand } from './commands';
import {
  CITY_SPECIALTY_LABELS,
  cityCanBuildFacility,
  citySpecialtyOf,
  cityTraitsOf,
  hasCityTrait,
} from './cityTraits';
import { armamentYieldMultiplier, cityPlots } from './innerAffairs';
import { createGame } from './scenario/jingxiang208';
import { settleTenDay } from './turn';
import type { ArmyUnit, CityId, GameCommand } from './types';

describe('city traits and specialties', () => {
  it('assigns every city at most one specialty and all listed cities exist in the scenario', () => {
    const state = createGame('liu', 1);
    const knownCityIds = new Set(Object.keys(state.cities));
    const seen = new Map<string, string>();
    for (const [specialty, label] of Object.entries(CITY_SPECIALTY_LABELS)) {
      for (const cityId of specialtyCities(specialty)) {
        expect(knownCityIds).toContain(cityId);
        expect(seen.has(cityId), `${cityId} 同时出现在 ${seen.get(cityId)} 与 ${label}`).toBe(false);
        seen.set(cityId, label);
      }
    }
  });

  it('discounts armament costs to 60% for metropolis and matching specialty cities', () => {
    const state = createGame('liu', 1);
    // 洛阳=大都市：所有兵装 600
    for (const armamentType of ARMAMENT_TYPES) {
      expect(armamentCost(state.cities.luoyang, armamentType)).toBe(600);
    }
    // 江陵=箭矢特色：仅弩 600，其余原价
    expect(armamentCost(state.cities.jiangling, 'crossbow')).toBe(600);
    expect(armamentCost(state.cities.jiangling, 'spear')).toBe(ARMAMENT_GOLD_COST);
    expect(armamentCost(state.cities.jiangling, 'ram')).toBe(ARMAMENT_GOLD_COST);
    // 武陵无特色：全部原价
    for (const armamentType of ARMAMENT_TYPES) {
      expect(armamentCost(state.cities.wuling, armamentType)).toBe(ARMAMENT_GOLD_COST);
    }
  });

  it('blocks shipyard and taixue construction outside water-port and academy cities', () => {
    const state = createGame('liu', 1);
    const wulingPlot = cityPlots(state.cities.wuling).findIndex((p) => p.type === 'empty');
    const jianglingPlot = cityPlots(state.cities.jiangling).findIndex((p) => p.type === 'empty');

    // 武陵非水港非学术：两种设施均被特性拒绝
    const shipyard: GameCommand = { type: 'buildFacilityPlot', cityId: 'wuling', officerIds: ['zhang-fei'], plotIndex: wulingPlot, facility: 'shipyard' };
    const taixue: GameCommand = { type: 'buildFacilityPlot', cityId: 'wuling', officerIds: ['zhang-fei'], plotIndex: wulingPlot, facility: 'taixue' };
    expect(validateCommand(state, 'liu', shipyard)).toContain('只有水港城市可以建造造船厂');
    expect(validateCommand(state, 'liu', taixue)).toContain('只有学术城市可以建造太学');

    // 江陵为水港+学术城：不报特性错误
    const okShipyard: GameCommand = { type: 'buildFacilityPlot', cityId: 'jiangling', officerIds: ['liu-bei'], plotIndex: jianglingPlot, facility: 'shipyard' };
    const okTaixue: GameCommand = { type: 'buildFacilityPlot', cityId: 'jiangling', officerIds: ['liu-bei'], plotIndex: jianglingPlot, facility: 'taixue' };
    expect(validateCommand(state, 'liu', okShipyard)).not.toContain('只有水港城市可以建造造船厂');
    expect(validateCommand(state, 'liu', okTaixue)).not.toContain('只有学术城市可以建造太学');

    expect(cityCanBuildFacility('wuling', 'shipyard')).toBe(false);
    expect(cityCanBuildFacility('jiangling', 'shipyard')).toBe(true);
  });

  it('guarantees merchant visits in commerce cities each ten-day', () => {
    const state = createGame('liu', 1);
    state.cities.jiangling.merchantPresent = false;
    rollMerchants(state);
    // 江陵为商贸城：商人必到
    expect(state.cities.jiangling.merchantPresent).toBe(true);
  });

  it('applies craftsman and ranch yield multipliers to armament production', () => {
    const state = createGame('liu', 1);
    // 洛阳=匠造：锻冶系（弩）系数 ×1.5
    expect(armamentYieldMultiplier(state.cities.luoyang, 'crossbow')).toBe(1.5);
    // 江陵非匠造：系数 1
    expect(armamentYieldMultiplier(state.cities.jiangling, 'crossbow')).toBe(1);
    // 武威=畜牧：军马系数 0.6；江陵非畜牧：0.2
    expect(armamentYieldMultiplier(state.cities.wuwei, 'cavalry')).toBeCloseTo(0.6);
    expect(armamentYieldMultiplier(state.cities.jiangling, 'cavalry')).toBeCloseTo(0.2);
  });

  it('recruits valor-city soldiers at the force maximum training', () => {
    const state = createGame('liu', 1);
    // 武陵预置兵舍（征兵需兵舍）
    const wulingPlots = state.cities.wuling.plots ?? (state.cities.wuling.plots = []);
    wulingPlots[0] = { ...wulingPlots[0], id: 'test-barracks', type: 'barracks', level: 1, constructing: undefined };
    state.cities.wuling.training = 60;
    state.cities.jiangling.training = 95;
    const prevTroops = state.cities.wuling.troops;

    const next = executeCommand(state, 'liu', {
      type: 'recruit', cityId: 'wuling', officerIds: ['zhang-fei'],
    });

    const gain = next.cities.wuling.troops - prevTroops;
    // 劲勇：新征士兵士气按势力最大士气（江陵95）计算
    const expected = Math.round((prevTroops * 95 + gain * 50) / next.cities.wuling.troops);
    expect(next.cities.wuling.training).toBe(expected);
    expect(next.cities.wuling.training).toBeGreaterThan(60);
  });

  it('boosts fortress-city ranged arrow damage by 50%', () => {
    const state = createGame('liu', 1);
    state.units['fortress-probe'] = probeUnit('fortress-probe', 'liu', 80, 117);
    const cityTroops = state.cities.xiangyang.troops;

    const next = settleTenDay(state);

    // 襄阳=要塞城：箭矢伤害 = 14500×5%×1.5 = 1088
    const damage = Math.max(100, Math.round(cityTroops * 0.05 * 1.5));
    expect(next.units['fortress-probe']?.troops).toBe(3000 - damage);
  });

  it('drains enemy unit energy by 2 each ten-day on wilderness territory', () => {
    const state = createGame('liu', 1);
    state.units['wilderness-probe'] = probeUnit('wilderness-probe', 'liu', 73, 185);

    const next = settleTenDay(state);

    // 零陵=蛮荒城（刘表领地）：刘备军驻其领土，士气 80+5回复-2蛮荒=83
    expect(next.units['wilderness-probe']?.energy).toBe(83);
  });

  it('exposes traits and specialty lookups for the UI', () => {
    const state = createGame('liu', 1);
    expect(cityTraitsOf('wuwei')).toContain('ranch');
    expect(hasCityTrait('wuwei', 'wilderness')).toBe(true);
    expect(cityTraitsOf('wuling')).toContain('valor');
    expect(citySpecialtyOf('luoyang')).toBe('metropolis');
    expect(citySpecialtyOf('wuling')).toBeUndefined();
    // 编辑器地图等未知城市返回空
    expect(cityTraitsOf('unknown-city' as CityId)).toEqual([]);
  });
});

/** 从静态表反查特色城市列表（仅测试用） */
function specialtyCities(specialty: string): string[] {
  const table: Record<string, string[]> = {
    metropolis: ['luoyang', 'changan', 'chengdu', 'ye', 'jianye'],
    spear: ['lujiang', 'wu', 'beihai', 'xuchang', 'hanzhong', 'nanpi'],
    halberd: ['shouchun', 'chenliu', 'jiangzhou', 'xiaopei', 'runan', 'xinye', 'jiangxia'],
    cavalry: ['wuwei', 'anding', 'jinyang', 'ji', 'beiping', 'xiangping'],
    arrow: ['xiangyang', 'jiangling'],
    ship: ['chaisang', 'changsha', 'xiapi', 'kuaiji'],
    siege: ['wan', 'puyang', 'shangyong', 'tianshui'],
  };
  return table[specialty] ?? [];
}

function probeUnit(id: string, forceId: 'liu', q: number, r: number): ArmyUnit {
  return {
    id,
    kind: 'combat',
    forceId,
    leaderId: 'liu-bei',
    officerIds: ['liu-bei'],
    homeCityId: 'jiangling',
    troopType: 'sword',
    q,
    r,
    troops: 3000,
    food: 3000,
    energy: 80,
    movementRemaining: 5,
    moved: false,
    acted: false,
  };
}
