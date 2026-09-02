import { describe, expect, it } from 'vitest';
import { createGame } from './scenario/jingxiang208';
import { deployUnit } from './battle/actions';
import { effectiveUnitAbilities } from './battle/officerAbilities';
import {
  DEFEAT_DEATH_CHANCE,
  DUEL_KILL_CHANCE,
  HEALTH_TEN_DAYS,
  applyDefeatInjuries,
  applyIllness,
  applyInjury,
  canDieInBattle,
  effectiveStat,
  injuryMultiplier,
  isInjured,
  markDeath,
  rollDeath,
  settleOfficerHealth,
} from './health';
import type { GameState, Officer } from './types';

function officerOf(state: GameState, id: string): Officer {
  return state.officers[id];
}

describe('伤病数值', () => {
  it('伤病按等级定义恢复旬数：轻伤9/中等18/重伤27', () => {
    expect(HEALTH_TEN_DAYS.light).toBe(9);
    expect(HEALTH_TEN_DAYS.moderate).toBe(18);
    expect(HEALTH_TEN_DAYS.severe).toBe(27);
  });

  it('能力衰减系数：无伤100%/轻伤90%/中等75%/重伤50%', () => {
    const state = createGame('liu', 1);
    const officer = officerOf(state, 'guan-yu');
    expect(injuryMultiplier(officer)).toBe(1);

    officer.health = { level: 'light', remainingTenDays: 9 };
    expect(injuryMultiplier(officer)).toBeCloseTo(0.9);
    expect(effectiveStat(officer, 'war')).toBe(Math.round(officer.stats.war * 0.9));

    officer.health = { level: 'moderate', remainingTenDays: 18 };
    expect(injuryMultiplier(officer)).toBeCloseTo(0.75);

    officer.health = { level: 'severe', remainingTenDays: 27 };
    expect(injuryMultiplier(officer)).toBeCloseTo(0.5);
    expect(isInjured(officer)).toBe(true);
  });
});

describe('applyInjury / applyIllness', () => {
  it('普通武将按等级进入伤病状态', () => {
    const state = createGame('liu', 1);
    const officer = officerOf(state, 'guan-yu');

    expect(applyInjury(state, officer, 'moderate')).toBe(true);
    expect(officer.health).toEqual({ level: 'moderate', remainingTenDays: 18 });
  });

  it('强运武将免于负伤，forced 可越过豁免', () => {
    const state = createGame('liu', 1);
    const officer = officerOf(state, 'guan-yu');
    officer.skill = '强运';

    expect(applyInjury(state, officer, 'severe')).toBe(false);
    expect(officer.health).toBeUndefined();

    expect(applyInjury(state, officer, 'severe', true)).toBe(true);
    expect(officer.health?.level).toBe('severe');
  });

  it('染病按中等伤病处理', () => {
    const state = createGame('liu', 1);
    const officer = officerOf(state, 'guan-yu');

    expect(applyIllness(state, officer)).toBe(true);
    expect(officer.health).toEqual({ level: 'moderate', remainingTenDays: 18 });
  });

  it('已死亡武将不再负伤', () => {
    const state = createGame('liu', 1);
    const officer = officerOf(state, 'guan-yu');
    markDeath(state, officer, '阵亡');

    expect(applyInjury(state, officer, 'light')).toBe(false);
  });
});

describe('settleOfficerHealth（旬末恢复）', () => {
  it('恢复旬数递减，归零时痊愈并写日志', () => {
    const state = createGame('liu', 1);
    const officer = officerOf(state, 'guan-yu');
    officer.health = { level: 'light', remainingTenDays: 1 };
    const logsBefore = state.logs.length;

    settleOfficerHealth(state);

    expect(officer.health).toBeUndefined();
    expect(state.logs.length).toBe(logsBefore + 1);
    expect(state.logs.at(-1)?.message).toContain('伤势痊愈');
    expect(state.logs.at(-1)?.message).toContain(officer.name);
  });

  it('未归零时仅递减不痊愈；被俘武将不参与结算', () => {
    const state = createGame('liu', 1);
    const injured = officerOf(state, 'guan-yu');
    injured.health = { level: 'severe', remainingTenDays: 27 };
    const captive = officerOf(state, 'zhang-fei');
    captive.health = { level: 'light', remainingTenDays: 9 };
    captive.location = { kind: 'captive', cityId: 'xiangyang', captorForceId: 'cao', capturedTenDays: 0 };

    settleOfficerHealth(state);

    expect(injured.health).toEqual({ level: 'severe', remainingTenDays: 26 });
    expect(captive.health).toEqual({ level: 'light', remainingTenDays: 9 });
  });
});

describe('markDeath / rollDeath', () => {
  it('markDeath：清空势力与伤病、记录死亡月份并写日志', () => {
    const state = createGame('liu', 1);
    const officer = officerOf(state, 'guan-yu');
    officer.health = { level: 'light', remainingTenDays: 9 };

    markDeath(state, officer, '力战阵亡');

    expect(officer.deathMonth).toBe(state.month);
    expect(officer.forceId).toBeNull();
    expect(officer.health).toBeUndefined();
    expect(officer.location.kind).toBe('unaffiliated');
    expect(state.logs.at(-1)?.message).toContain('力战阵亡');
  });

  it('rollDeath：概率为 1 时必死，概率为 0 时必不死', () => {
    const state = createGame('liu', 1);
    const doomed = officerOf(state, 'guan-yu');
    const safe = officerOf(state, 'zhang-fei');

    expect(rollDeath(state, doomed, 1, '于部队覆灭中阵亡')).toBe(true);
    expect(doomed.deathMonth).toBe(state.month);

    expect(rollDeath(state, safe, 0)).toBe(false);
    expect(safe.deathMonth).toBeUndefined();
  });

  it('强运武将免于战死；已死亡武将不重复判定', () => {
    const state = createGame('liu', 1);
    const lucky = officerOf(state, 'guan-yu');
    lucky.skill = '强运';
    expect(canDieInBattle(state, lucky)).toBe(false);
    expect(rollDeath(state, lucky, 1)).toBe(false);
    expect(lucky.deathMonth).toBeUndefined();

    const dead = officerOf(state, 'zhang-fei');
    markDeath(state, dead, '阵亡');
    expect(rollDeath(state, dead, 1)).toBe(false);
  });

  it('战死概率常量与设计一致', () => {
    expect(DEFEAT_DEATH_CHANCE).toBe(0.12);
    expect(DUEL_KILL_CHANCE).toBe(0.25);
  });
});

describe('applyDefeatInjuries（败军负伤）', () => {
  it('概率为 0 时无人负伤', () => {
    const state = createGame('liu', 1);
    const survivors = [officerOf(state, 'guan-yu'), officerOf(state, 'zhang-fei')];

    expect(applyDefeatInjuries(state, survivors, 0)).toEqual([]);
    expect(survivors.every((officer) => !officer.health)).toBe(true);
  });

  it('已带伤或已死亡武将不重复结算', () => {
    const state = createGame('liu', 1);
    const alreadyInjured = officerOf(state, 'guan-yu');
    alreadyInjured.health = { level: 'light', remainingTenDays: 9 };
    const dead = officerOf(state, 'zhang-fei');
    markDeath(state, dead, '阵亡');
    const logsBefore = state.logs.length;

    applyDefeatInjuries(state, [alreadyInjured, dead], 1);

    expect(alreadyInjured.health).toEqual({ level: 'light', remainingTenDays: 9 });
    expect(dead.health).toBeUndefined();
    // 无新增武将状态日志（负伤名单为空，不产生额外结算）
    expect(state.logs.length).toBe(logsBefore);
  });
});

describe('伤病衰减接入战斗能力（effectiveUnitAbilities）', () => {
  function deployFormation() {
    const game = createGame('liu', 1);
    game.officers['zhuge-liang'].cityId = 'jiangling';
    game.officers['zhuge-liang'].location = { kind: 'city', cityId: 'jiangling' };
    const state = deployUnit(game, 'liu', {
      cityId: 'jiangling', officerIds: ['jian-yong', 'guan-yu', 'zhuge-liang'],
      troopType: 'spear', troops: 4000, food: 5000,
    });
    return { state, unit: Object.values(state.units)[0] };
  }

  it('无伤武将能力不变', () => {
    const { state, unit } = deployFormation();
    const abilities = effectiveUnitAbilities(state, unit);

    expect(abilities.leadership.value).toBe(state.officers['jian-yong'].stats.leadership);
    expect(abilities.war.value).toBe(state.officers['guan-yu'].stats.war);
    expect(abilities.intelligence.value).toBe(state.officers['zhuge-liang'].stats.intelligence);
  });

  it('主将重伤时统率减半；武/智担当带伤时按衰减后取值', () => {
    const { state, unit } = deployFormation();
    state.officers['jian-yong'].health = { level: 'severe', remainingTenDays: 27 };
    state.officers['guan-yu'].health = { level: 'moderate', remainingTenDays: 18 };
    state.officers['zhuge-liang'].health = { level: 'light', remainingTenDays: 9 };

    const abilities = effectiveUnitAbilities(state, unit);

    expect(abilities.leadership.value).toBe(Math.round(state.officers['jian-yong'].stats.leadership * 0.5));
    expect(abilities.war.value).toBe(Math.round(state.officers['guan-yu'].stats.war * 0.75));
    expect(abilities.intelligence.value).toBe(Math.round(state.officers['zhuge-liang'].stats.intelligence * 0.9));
  });
});
