import { describe, expect, it } from 'vitest';
import { createGame } from './scenario/jingxiang208';
import { deployUnit } from './battle/actions';
import { effectiveUnitAbilities } from './battle/officerAbilities';
import {
  DEFEAT_DEATH_CHANCE,
  DUEL_KILL_CHANCE,
  HEALTH_TEN_DAYS,
  ILLNESS_DEATH_CHANCE,
  applyDeathConsequences,
  applyDefeatInjuries,
  applyIllness,
  applyInjury,
  canDieInBattle,
  effectiveStat,
  injuryMultiplier,
  isInjured,
  markDeath,
  oldAgeDeathChance,
  rollDeath,
  scenarioYear,
  settleAgingDeaths,
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
    injured.health = { level: 'light', remainingTenDays: 9 };
    const captive = officerOf(state, 'zhang-fei');
    captive.health = { level: 'light', remainingTenDays: 9 };
    captive.location = { kind: 'captive', cityId: 'xiangyang', captorForceId: 'cao', capturedTenDays: 0 };

    settleOfficerHealth(state);

    expect(injured.health).toEqual({ level: 'light', remainingTenDays: 8 });
    expect(captive.health).toEqual({ level: 'light', remainingTenDays: 9 });
  });

  it('轻伤不判定伤重不治（0% 概率不消耗 RNG）', () => {
    const state = createGame('liu', 1);
    const officer = officerOf(state, 'guan-yu');
    officer.health = { level: 'light', remainingTenDays: 9 };
    const cursorBefore = state.rngCursor;

    settleOfficerHealth(state);

    expect(state.rngCursor).toBe(cursorBefore);
    expect(officer.health).toEqual({ level: 'light', remainingTenDays: 8 });
  });

  it('强运武将带重伤连续结算多旬不会病逝', () => {
    const state = createGame('liu', 1);
    const officer = officerOf(state, 'guan-yu');
    officer.skill = '强运';

    for (let i = 0; i < 12; i += 1) {
      officer.health = { level: 'severe', remainingTenDays: 27 };
      settleOfficerHealth(state);
      expect(officer.deathMonth).toBeUndefined();
    }
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

    const cursorBefore = state.rngCursor;
    expect(rollDeath(state, safe, 0)).toBe(false);
    expect(safe.deathMonth).toBeUndefined();
    // 概率为 0 时不消耗 RNG
    expect(state.rngCursor).toBe(cursorBefore);
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
    expect(ILLNESS_DEATH_CHANCE.light).toBe(0);
    expect(ILLNESS_DEATH_CHANCE.moderate).toBe(0.03);
    expect(ILLNESS_DEATH_CHANCE.severe).toBe(0.08);
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

describe('老龄病逝（寿命系统）', () => {
  it('scenarioYear：month 1-12 为 208 年，13-24 为 209 年', () => {
    const state = createGame('liu', 1);
    expect(scenarioYear(state)).toBe(208);
    state.month = 13;
    expect(scenarioYear(state)).toBe(209);
  });

  it('oldAgeDeathChance：58 岁起每岁 +2%/月，上限 30%', () => {
    expect(oldAgeDeathChance(58)).toBe(0);
    expect(oldAgeDeathChance(59)).toBeCloseTo(0.02);
    expect(oldAgeDeathChance(66)).toBeCloseTo(0.16);
    expect(oldAgeDeathChance(100)).toBe(0.3);
    expect(oldAgeDeathChance(30)).toBe(0);
  });

  it('settleAgingDeaths：年轻武将不判定、不消耗 RNG', () => {
    const state = createGame('liu', 1);
    // 诸葛亮 181 年生，208 年时 27 岁
    const young = state.officers['zhuge-liang'];
    // 剧本里有高龄武将（刘表 66 岁，16%/月）会掷点，全部年轻化以隔离本用例的 RNG 语义
    for (const officer of Object.values(state.officers)) officer.birthYear = Math.max(officer.birthYear ?? 170, 170);
    const cursorBefore = state.rngCursor;

    settleAgingDeaths(state);

    expect(young.deathMonth).toBeUndefined();
    expect(state.rngCursor).toBe(cursorBefore);
  });

  it('强运高龄武将连续结算 24 个月不会病逝', () => {
    const state = createGame('liu', 1);
    // 刘表 142 年生，208 年时 66 岁（16%/月）
    const elderly = state.officers['liu-biao'];
    elderly.skill = '强运';

    for (let month = 1; month <= 24; month += 1) {
      state.month = month;
      settleAgingDeaths(state);
      expect(elderly.deathMonth).toBeUndefined();
    }
  });

  it('剧本数据：56 名武将均有出生年', () => {
    const state = createGame('liu', 1);
    const officers = Object.values(state.officers);
    expect(officers.length).toBe(56);
    expect(officers.every((officer) => typeof officer.birthYear === 'number')).toBe(true);
  });
});

describe('死亡善后（applyDeathConsequences）', () => {
  it('势力主公死亡：统率最高的在世同势力武将继任并写日志', () => {
    const state = createGame('liu', 1);
    const liuBei = state.officers['liu-bei'];
    markDeath(state, liuBei, '寿终正寝');

    applyDeathConsequences(state, liuBei);

    // 关羽统率 95 为刘备势力在世最高
    expect(state.forces.liu.leaderId).toBe('guan-yu');
    const log = state.logs.at(-1);
    expect(log?.message).toContain('关羽');
    expect(log?.message).toContain('继任');
  });

  it('主公死亡后太守空缺；无同势力武将时不强行继任', () => {
    const state = createGame('liu', 1);
    const liuBei = state.officers['liu-bei'];
    markDeath(state, liuBei, '寿终正寝');

    applyDeathConsequences(state, liuBei);

    expect(state.cities.jiangling.governorId).toBeNull();
    expect(state.forces.liu.leaderId).toBe('guan-yu');
  });

  it('部队主将死亡：副将继任', () => {
    const state = createGame('liu', 1);
    state.units['u1'] = {
      id: 'u1', kind: 'combat', forceId: 'liu', leaderId: 'guan-yu',
      officerIds: ['guan-yu', 'chen-dao'], homeCityId: 'jiangling',
      troopType: 'spear', q: 10, r: 10, troops: 4000, food: 5000,
      energy: 100, movementRemaining: 20, moved: false, acted: false,
    };
    const guanYu = state.officers['guan-yu'];
    guanYu.location = { kind: 'unit', unitId: 'u1' };
    markDeath(state, guanYu, '阵亡');

    applyDeathConsequences(state, guanYu);

    expect(state.units['u1'].leaderId).toBe('chen-dao');
    expect(state.units['u1'].officerIds).toEqual(['chen-dao']);
  });

  it('部队主将死亡且无副将：部队溃散移除', () => {
    const state = createGame('liu', 1);
    state.units['u2'] = {
      id: 'u2', kind: 'combat', forceId: 'liu', leaderId: 'guan-yu',
      officerIds: ['guan-yu'], homeCityId: 'jiangling',
      troopType: 'spear', q: 10, r: 10, troops: 4000, food: 5000,
      energy: 100, movementRemaining: 20, moved: false, acted: false,
    };
    const guanYu = state.officers['guan-yu'];
    guanYu.location = { kind: 'unit', unitId: 'u2' };
    markDeath(state, guanYu, '阵亡');

    applyDeathConsequences(state, guanYu);

    expect(state.units['u2']).toBeUndefined();
  });
});
