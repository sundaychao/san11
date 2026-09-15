import { describe, expect, it } from 'vitest';
import { ARMAMENT_GOLD_COST, armamentCost, produceArmamentYield } from './armaments';
import { COMMAND_AP, TRADE_MAX_GRAIN, executeCommand, grainPriceOf, patrolGoldCost, quoteTrade, rollGrainPrices, rollMerchants, strongholdTransferDuration, tradeEffectPercent, transferDuration, validateCommand } from './commands';
import { recruitWillOf, talentDebateTriggerChance, willSuccessChance } from './loyalty';
import { nextRandom } from './random';
import type { PlotType } from './innerAffairs';
import { armamentYieldMultiplier, barracksYieldMultiplier, cityAttackRangeCoords, patrolOrderGain, recruitBaseYield } from './innerAffairs';
import { hasCityTrait } from './cityTraits';
import { POSITIONS, forceRankOf } from './ranks';
import { createGame } from './scenario/jingxiang208';
import type { CityId, GameState, Officer } from './types';

/** 在指定城池注入一名在野武将（可选喜/恶列表，供跨城登庸测试设定抵达判定） */
function injectFieldOfficer(state: GameState, cityId: string, opts?: { likes?: string[]; hates?: string[] }): Officer {
  const officer: Officer = {
    id: `field-${cityId}`,
    name: '田野在野',
    forceId: null,
    cityId: cityId as never,
    location: { kind: 'unaffiliated', cityId: cityId as never },
    stats: { leadership: 60, war: 60, intelligence: 70, politics: 65, charisma: 60 },
    personality: 'calm',
    acted: false,
    ...(opts?.likes ? { likes: opts.likes } : {}),
    ...(opts?.hates ? { hates: opts.hates } : {}),
  };
  state.officers[officer.id] = officer;
  return officer;
}

/** 构造：曹操（宛）跨城登庸「汉中在野武将」（无主城，符合默认登庸口径），返回执行后的状态与目标武将 */
function setupCrossCityJourney(seed = 42) {
  const state = createGame('cao', seed);
  const target = injectFieldOfficer(state, 'hanzhong');
  const travel = Math.max(1, strongholdTransferDuration(state, state.cities.wan, state.cities.hanzhong));
  const command = { type: 'talent' as const, cityId: 'wan' as CityId, officerId: 'cao-cao', targetOfficerId: target.id };
  return { state, target, travel, command };
}

/** 为江陵预置军事设施（征兵需兵舍，枪/戟/弩需锻冶，冲车/井阑需工房，军马需厩舍，楼船需造船） */
function withFacilities(state: GameState, facilities: PlotType[] = ['barracks', 'forge', 'smithy', 'stable', 'shipyard']) {
  const city = state.cities.jiangling;
  const plots = city.plots ?? (city.plots = []);
  facilities.forEach((facility, index) => {
    plots[index] = { ...plots[index], id: `test-${facility}`, type: facility, level: 1, constructing: undefined };
  });
  return state;
}

describe('command engine', () => {
  it('dilutes city training when recruiting fresh troops at morale 50', () => {
    const state = withFacilities(createGame('liu', 1));
    const city = state.cities.jiangling;
    city.troops = 4000;
    city.training = 90;
    const next = executeCommand(state, 'liu', {
      type: 'recruit', cityId: 'jiangling', officerIds: ['liu-bei'],
    });

    const gain = next.cities.jiangling.troops - 4000;
    // (4000×90 + gain×50) ÷ (4000+gain)（城池士气取整存储）
    const expected = Math.round((4000 * 90 + gain * 50) / (4000 + gain));
    expect(next.cities.jiangling.training).toBe(expected);
    // 士气从90被稀释，必然下降但仍高于新兵50
    expect(next.cities.jiangling.training).toBeLessThan(90);
    expect(next.cities.jiangling.training).toBeGreaterThan(50);
  });

  it('recruits troops with population, food, gold, and order costs', () => {
    const state = withFacilities(createGame('liu', 1));
    const next = executeCommand(state, 'liu', {
      type: 'recruit', cityId: 'jiangling', officerIds: ['liu-bei'],
    });

    // 基础 1495（1000 + 魅99×(治安80+20)×5÷100）× 兵舍1级加成 1.15 = 1719
    const expected = Math.round(recruitBaseYield([state.officers['liu-bei']], state.cities.jiangling) * barracksYieldMultiplier(state.cities.jiangling));
    expect(next.cities.jiangling.troops).toBe(state.cities.jiangling.troops + expected);
    expect(next.cities.jiangling.population).toBe(state.cities.jiangling.population - 500);
    expect(next.cities.jiangling.food).toBe(state.cities.jiangling.food - 500);
    expect(next.cities.jiangling.gold).toBe(state.cities.jiangling.gold - 800);
    expect(next.cities.jiangling.order).toBe(state.cities.jiangling.order - 2);
    expect(next.cityEffectReports).toEqual([expect.objectContaining({
      cityId: 'jiangling',
      amount: expected,
      label: '士兵',
      kind: 'recruit',
    })]);
  });

  it('applies 名声 after the existing recruit formula without changing costs', () => {
    const state = withFacilities(createGame('liu', 1));
    state.officers['liu-bei'].skill = '名声';
    const next = executeCommand(state, 'liu', {
      type: 'recruit', cityId: 'jiangling', officerIds: ['liu-bei'],
    });
    const base = recruitBaseYield([state.officers['liu-bei']], state.cities.jiangling);

    // 名声 ×1.5 与兵舍1级 ×1.15 同时生效
    expect(next.cities.jiangling.troops - state.cities.jiangling.troops)
      .toBe(Math.round(base * 1.5 * barracksYieldMultiplier(state.cities.jiangling)));
    expect(next.cities.jiangling.gold).toBe(state.cities.jiangling.gold - 800);
    expect(next.cities.jiangling.food).toBe(state.cities.jiangling.food - 500);
    expect(next.cities.jiangling.population).toBe(state.cities.jiangling.population - 500);
    expect(next.cities.jiangling.order).toBe(state.cities.jiangling.order - 2);
    expect(next.actionPoints.liu).toBe(state.actionPoints.liu - COMMAND_AP.recruit);
    expect(next.officers['liu-bei'].acted).toBe(true);
  });

  it('clears stale battle reports when executing a city command', () => {
    const state = withFacilities(createGame('liu', 1));
    state.battleDamageReports = [{
      id: 'old-damage',
      unitId: 'old-target',
      q: 10,
      r: 10,
      amount: 900,
      kind: 'attack',
    }];
    state.strategyResultReports = [{
      id: 'old-strategy', strategyId: 'disturb', q: 10, r: 10,
      label: '计略失败', succeeded: false,
    }];

    const next = executeCommand(state, 'liu', {
      type: 'recruit', cityId: 'jiangling', officerIds: ['liu-bei'],
    });

    expect(next.battleDamageReports).toEqual([]);
    expect(next.strategyResultReports).toEqual([]);
  });

  it('produces selected armaments with gold and officer action costs', () => {
    const state = withFacilities(createGame('liu', 1));
    const currentCrossbows = state.cities.jiangling.armaments?.crossbow ?? 0;
    const next = executeCommand(state, 'liu', {
      type: 'produceArmament', cityId: 'jiangling', officerIds: ['liu-bei'], armamentType: 'crossbow',
    });

    // 基础 1980（1200 + 智78×10）× 锻冶1级加成 1.15 = 2277
    const expected = Math.round(produceArmamentYield([state.officers['liu-bei']], 'crossbow') * armamentYieldMultiplier(state.cities.jiangling, 'crossbow'));
    expect(next.cities.jiangling.armaments?.crossbow).toBe(currentCrossbows + expected);
    // 江陵为箭矢特色城：弩生产价格 600（原价60%）
    expect(next.cities.jiangling.gold).toBe(state.cities.jiangling.gold - armamentCost(state.cities.jiangling, 'crossbow'));
    expect(next.actionPoints.liu).toBe(60);
    expect(next.officers['liu-bei'].acted).toBe(true);
    expect(next.logs.at(-1)?.message).toContain('弩');
    expect(next.cityEffectReports).toEqual([expect.objectContaining({
      cityId: 'jiangling',
      amount: expected,
      label: '弩',
      kind: 'armament',
    })]);
  });

  it('applies 能吏 to spear, halberd, and crossbow production only', () => {
    const state = withFacilities(createGame('liu', 1));
    state.officers['liu-bei'].skill = '能吏';
    const base = produceArmamentYield([state.officers['liu-bei']], 'crossbow');
    const before = state.cities.jiangling.armaments!.crossbow;
    const next = executeCommand(state, 'liu', {
      type: 'produceArmament', cityId: 'jiangling', officerIds: ['liu-bei'], armamentType: 'crossbow',
    });

    const expected = Math.round(produceArmamentYield([state.officers['liu-bei']], 'crossbow')
      * 2 * armamentYieldMultiplier(state.cities.jiangling, 'crossbow'));
    expect(next.cities.jiangling.armaments!.crossbow - before).toBe(expected);
    // 江陵为箭矢特色城：弩生产价格 600（原价60%）
    expect(next.cities.jiangling.gold).toBe(state.cities.jiangling.gold - armamentCost(state.cities.jiangling, 'crossbow'));
    expect(next.actionPoints.liu).toBe(state.actionPoints.liu - COMMAND_AP.produceArmament);
    expect(next.officers['liu-bei'].acted).toBe(true);
  });

  it('does not apply 能吏 to delayed armament production', () => {
    const state = withFacilities(createGame('liu', 1));
    state.officers['liu-bei'].skill = '能吏';
    const next = executeCommand(state, 'liu', {
      type: 'produceArmament', cityId: 'jiangling', officerIds: ['liu-bei'], armamentType: 'ram',
    });

    // 工期按综合智力计算：智78 → ⌈(220−78)÷12⌉×10 = 120日 = 12旬
    expect(next.officers['liu-bei'].location).toEqual({
      kind: 'task',
      cityId: 'jiangling',
      task: 'armament',
      armamentType: 'ram',
      amount: 2,
      remainingTenDays: 12,
      lead: true,
    });
    expect(next.cities.jiangling.gold).toBe(state.cities.jiangling.gold - ARMAMENT_GOLD_COST);
  });

  it('starts a delayed armament production task with duration from combined intelligence', () => {
    const state = withFacilities(createGame('liu', 1));
    const currentRams = state.cities.jiangling.armaments?.ram ?? 0;
    const next = executeCommand(state, 'liu', {
      type: 'produceArmament', cityId: 'jiangling', officerIds: ['liu-bei'], armamentType: 'ram',
    });

    expect(next.cities.jiangling.armaments?.ram).toBe(currentRams);
    expect(next.cities.jiangling.gold).toBe(state.cities.jiangling.gold - 1000);
    expect(next.officers['liu-bei'].location).toEqual({
      kind: 'task',
      cityId: 'jiangling',
      task: 'armament',
      armamentType: 'ram',
      amount: 2,
      remainingTenDays: 12,
      lead: true,
    });
    expect(next.officers['liu-bei'].acted).toBe(true);
  });

  it('trains troops from war', () => {
    const state = createGame('liu', 1);
    const next = executeCommand(state, 'liu', {
      type: 'train', cityId: 'jiangling', officerIds: ['guan-yu'],
    });

    // 气力提升 = 【(武97+97) ÷ (13500÷2000+20)】+ 3 = 7 + 3 = 10
    expect(next.cities.jiangling.training).toBe(82);
    expect(next.cities.jiangling.food).toBe(state.cities.jiangling.food - 300);
    expect(next.cityEffectReports).toEqual([expect.objectContaining({
      cityId: 'jiangling',
      amount: 10,
      label: '士气',
      kind: 'train',
    })]);
  });

  it('关隘训练的效果报告指向关隘（passId + 关隘坐标）', () => {
    const state = createGame('liu', 1);
    const pass = state.passes!.wuguan;
    pass.ownerId = 'liu';
    pass.troops = 6000;
    pass.food = 20000;
    pass.gold = 2000;
    state.officers['liu-bei'].location = { kind: 'pass', passId: 'wuguan' };
    const next = executeCommand(state, 'liu', {
      type: 'train', cityId: pass.homeCityId, passId: 'wuguan', officerIds: ['liu-bei'],
    });
    expect(next.cityEffectReports).toEqual([expect.objectContaining({
      cityId: pass.homeCityId,
      passId: 'wuguan',
      q: pass.q,
      r: pass.r,
      label: '士气',
      kind: 'train',
    })]);
  });

  it('allows training only once per city per ten days and resets at the next ten-day', () => {
    const state = createGame('liu', 1);
    const once = executeCommand(state, 'liu', { type: 'train', cityId: 'jiangling', officerIds: ['guan-yu'] });
    expect(once.cities.jiangling.trainedThisTenDay).toBe(true);
    expect(validateCommand(once, 'liu', { type: 'train', cityId: 'jiangling', officerIds: ['zhang-fei'] })).toContain('本旬该城已训练');

    // 下一旬重置后可再次训练
    rollMerchants(once);
    expect(once.cities.jiangling.trainedThisTenDay).toBe(false);
  });

  it('refuses to transfer an already-acted officer', () => {
    const state = createGame('liu', 1);
    state.officers['guan-yu'].acted = true;
    expect(validateCommand(state, 'liu', {
      type: 'transfer', cityId: 'jiangling', targetCityId: 'wuling', officerIds: ['guan-yu'],
    })).toContain('关羽本月已行动，无法移动');
  });

  it('allows patrol only once per city per ten days and resets at the next ten-day', () => {
    const state = createGame('liu', 1);
    const once = executeCommand(state, 'liu', { type: 'patrol', cityId: 'jiangling', officerIds: ['guan-yu'] });
    expect(once.cities.jiangling.patrolledThisTenDay).toBe(true);
    expect(validateCommand(once, 'liu', { type: 'patrol', cityId: 'jiangling', officerIds: ['zhang-fei'] })).toContain('本旬该城已巡查');

    rollMerchants(once);
    expect(once.cities.jiangling.patrolledThisTenDay).toBe(false);
  });

  it('patrols from leadership and caps public order', () => {
    const state = createGame('liu', 1);
    state.cities.jiangling.order = 99;
    const next = executeCommand(state, 'liu', {
      type: 'patrol', cityId: 'jiangling', officerIds: ['liu-bei'],
    });

    expect(next.cities.jiangling.order).toBe(100);
    expect(next.cities.jiangling.gold).toBe(state.cities.jiangling.gold - patrolGoldCost(state.cities.jiangling));
    expect(next.cityEffectReports).toEqual([expect.objectContaining({
      cityId: 'jiangling',
      amount: patrolOrderGain([state.officers['liu-bei']]),
      label: '治安',
      kind: 'patrol',
    })]);
  });

  it('charges patrol cost proportional to city population (50 gold per 100,000)', () => {
    const state = createGame('liu', 1);
    state.cities.jiangling.population = 1_000_000;
    expect(patrolGoldCost(state.cities.jiangling)).toBe(500);
    state.cities.jiangling.population = 475_000;
    expect(patrolGoldCost(state.cities.jiangling)).toBe(238);
    state.cities.jiangling.population = 10_000;
    expect(patrolGoldCost(state.cities.jiangling)).toBe(5);
  });

  /**
   * 探测登庸首掷（原版时机：登庸按舌战触发率掷点，触发则舌战、未触发按成功率直接判定）。
   * 登庸路径在意愿判定后恰好消费两次掷点（触发掷、成功掷），可用同种子预演选出目标分支的种子。
   */
  function findTalentSeed(want: 'debate' | 'direct-success' | 'direct-fail'): number {
    // xorshift32 对小种子的首个输出值接近 0，须在大数值域选种才能覆盖「未触发」分支
    const base = 0x40000000;
    for (let i = 0; i < 4000; i += 1) {
      const seed = base + i * 7919;
      const state = createGame('liu', seed);
      const executor = state.officers['liu-bei'];
      const target = state.officers['zhao-yun'];
      const will = recruitWillOf(state, executor, target);
      if (will.verdict !== 'maybe' || will.will <= 0) continue;
      const chance = talentDebateTriggerChance(state, executor, target);
      const trigger = nextRandom(state.seed, state.rngCursor);
      if (want === 'debate') {
        if (trigger.value < chance) return seed;
        continue;
      }
      if (trigger.value < chance) continue;
      const success = nextRandom(state.seed, trigger.cursor);
      const successHit = success.value < willSuccessChance(will.will) / 100;
      if (want === 'direct-success' && successHit) return seed;
      if (want === 'direct-fail' && !successHit) return seed;
    }
    throw new Error(`no seed for ${want}`);
  }

  it('starts a debate when finding a local talent to recruit', () => {
    const state = createGame('liu', findTalentSeed('debate'));
    const next = executeCommand(state, 'liu', {
      type: 'talent', cityId: 'jiangling', officerId: 'liu-bei', targetOfficerId: 'zhao-yun',
    });

    expect(next.debateSession?.status).toBe('ongoing');
    expect(next.debateSession?.recruiterId).toBe('liu-bei');
    expect(next.debateSession?.targetId).toBe('zhao-yun');
    expect(next.cities.jiangling.gold).toBe(state.cities.jiangling.gold - 500);
    expect(next.officers['liu-bei'].acted).toBe(true);
  });

  it('does not recruit the talent before the debate finishes regardless of seed', () => {
    const state = createGame('liu', findTalentSeed('debate'));
    const next = executeCommand(state, 'liu', {
      type: 'talent', cityId: 'jiangling', officerId: 'liu-bei', targetOfficerId: 'zhao-yun',
    });

    expect(next.debateSession?.status).toBe('ongoing');
    expect(next.officers['zhao-yun'].forceId).toBeNull();
    expect(next.logs.some((log) => log.message.includes('舌战'))).toBe(true);
  });

  it('未触发舌战时按意愿成功率直接判定：成功则登用（原版时机）', () => {
    const state = createGame('liu', findTalentSeed('direct-success'));
    const next = executeCommand(state, 'liu', {
      type: 'talent', cityId: 'jiangling', officerId: 'liu-bei', targetOfficerId: 'zhao-yun',
    });

    expect(next.debateSession).toBeFalsy();
    expect(next.officers['zhao-yun'].forceId).toBe('liu');
    expect(next.officers['zhao-yun'].serviceYears).toBe(0);
    expect(next.officers['zhao-yun'].acted).toBe(true);
    expect(next.officers['liu-bei'].acted).toBe(true);
  });

  it('未触发舌战且判定失败：目标不禁仕、下月可再试', () => {
    const state = createGame('liu', findTalentSeed('direct-fail'));
    const next = executeCommand(state, 'liu', {
      type: 'talent', cityId: 'jiangling', officerId: 'liu-bei', targetOfficerId: 'zhao-yun',
    });

    expect(next.debateSession).toBeFalsy();
    expect(next.officers['zhao-yun'].forceId).toBeNull();
    expect(next.officers['zhao-yun'].bannedUntilMonth).toBeUndefined();
    expect(next.officers['liu-bei'].acted).toBe(true);
  });

  it('默认不可登庸寄居其他势力城池的在野武将（本城与无主城照常）', () => {
    const state = createGame('liu', 1);
    const command = (targetOfficerId: string) => ({
      type: 'talent' as const, cityId: 'jiangling' as CityId, officerId: 'liu-bei', targetOfficerId,
    });

    // 庞统寄居襄阳（曹操势力）→ 拒绝，理由可读
    expect(state.cities.xiangyang.ownerId).toBe('cao');
    expect(validateCommand(state, 'liu', command('pang-tong'))).toContain('庞统寄居他方城池，无法前往登庸');

    // 本城（江陵）在野赵云 → 放行
    expect(validateCommand(state, 'liu', command('zhao-yun'))).toEqual([]);

    // 无主城池里的在野武将不属于任何势力 → 放行
    const field = injectFieldOfficer(state, 'wuwei');
    expect(state.cities.wuwei.ownerId).toBeNull();
    expect(validateCommand(state, 'liu', command(field.id))).toEqual([]);

    // 该城一旦有主（曹操），随即封禁
    state.cities.wuwei.ownerId = 'cao';
    expect(validateCommand(state, 'liu', command(field.id))).toContain('田野在野寄居他方城池，无法前往登庸');
  });

  it('starts a personnel-only transfer with travel time based on city distance', () => {
    const state = createGame('liu', 1);
    const next = executeCommand(state, 'liu', {
      type: 'transfer', cityId: 'jiangling', targetCityId: 'wuling', officerIds: ['guan-yu'],
    });

    expect(next.cities.jiangling.gold).toBe(state.cities.jiangling.gold);
    expect(next.cities.wuling.gold).toBe(state.cities.wuling.gold);
    expect(next.officers['guan-yu'].cityId).toBe('jiangling');
    expect(next.officers['guan-yu'].location).toEqual({
      kind: 'transfer',
      fromCityId: 'jiangling',
      targetCityId: 'wuling',

      remainingTenDays: 4,
    });
    expect(next.actionPoints.liu).toBe(70);
    expect(next.logs.at(-1)?.message).toContain('4旬');
  });

  it('calculates transfer duration in ten-cell bands', () => {
    const state = createGame('liu', 1);
    expect(transferDuration(state.cities.jiangling, { ...state.cities.jiangling, gridQ: state.cities.jiangling.gridQ + 10 })).toBe(1);
    expect(transferDuration(state.cities.jiangling, { ...state.cities.jiangling, gridQ: state.cities.jiangling.gridQ + 11 })).toBe(2);
    expect(transferDuration(state.cities.jiangling, { ...state.cities.jiangling, gridQ: state.cities.jiangling.gridQ + 30 })).toBe(3);
  });

  it('rejects enemy destinations and transfers without officers', () => {
    const state = createGame('liu', 1);
    const enemy = validateCommand(state, 'liu', {
      type: 'transfer', cityId: 'jiangling', targetCityId: 'wan', officerIds: ['guan-yu'],
    });
    const empty = validateCommand(state, 'liu', {
      type: 'transfer', cityId: 'jiangling', targetCityId: 'wuling', officerIds: [],
    });

    expect(enemy).toContain('只能调往己方据点');
    expect(empty).toContain('至少移动一名武将');
  });

  it('auto-appoints the highest-politics resident officer as successor governor when the governor transfers away', () => {
    const state = createGame('liu', 1);
    const next = executeCommand(state, 'liu', {
      type: 'transfer', cityId: 'jiangling', targetCityId: 'wuling', officerIds: ['liu-bei'],
    });

    expect(next.officers['liu-bei'].location.kind).toBe('transfer');
    // 刘备（太守）调离江陵：留守武将中孙乾政治75最高 → 自动接任太守
    expect(next.cities.jiangling.governorId).toBe('sun-qian');
    expect(next.officers['sun-qian'].location.kind).toBe('city');
  });

  it('auto-appoints a successor governor when the governor is summoned away', () => {
    const state = createGame('liu', 1);
    const next = executeCommand(state, 'liu', {
      type: 'summon', cityId: 'wuling', officerIds: ['liu-bei'],
    });

    expect(next.officers['liu-bei'].location.kind).toBe('transfer');
    // 太守刘备被召唤离开江陵：留守最高政治孙乾自动接任
    expect(next.cities.jiangling.governorId).toBe('sun-qian');
  });

  it('does not allow officers outside the source city to transfer', () => {
    const state = createGame('liu', 1);
    state.officers['guan-yu'].location = { kind: 'transfer', fromCityId: 'jiangling', targetCityId: 'wuling', remainingTenDays: 1 };

    expect(validateCommand(state, 'liu', {
      type: 'transfer', cityId: 'jiangling', targetCityId: 'wuling', officerIds: ['guan-yu'],
    })).toContain('只能移动出发据点内的己方武将');
  });

  it('summons an officer from another owned city to the current city with the same travel time', () => {
    const state = createGame('liu', 1);
    state.officers['guan-yu'].location = { kind: 'city', cityId: 'wuling' };
    const next = executeCommand(state, 'liu', {
      type: 'summon', cityId: 'jiangling', officerIds: ['guan-yu'],
    });

    expect(next.officers['guan-yu'].location).toEqual({
      kind: 'transfer',
      fromCityId: 'wuling',
      targetCityId: 'jiangling',
      remainingTenDays: 4,
    });
    expect(next.officers['guan-yu'].acted).toBe(true);
  });

  it('rejects summoning without officers or of officers already in this city', () => {
    const state = createGame('liu', 1);
    const empty = validateCommand(state, 'liu', {
      type: 'summon', cityId: 'jiangling', officerIds: [],
    });
    const self = validateCommand(state, 'liu', {
      type: 'summon', cityId: 'jiangling', officerIds: ['guan-yu'],
    });

    expect(empty).toContain('至少召唤一名武将');
    expect(self.some((error) => error.includes('无需召唤'))).toBe(true);
  });

  it('swears two or three same-gender officers as sworn brothers with pairwise relationships', () => {
    const state = createGame('liu', 1);
    const next = executeCommand(state, 'liu', {
      type: 'sworn', cityId: 'jiangling', officerIds: ['guan-yu', 'jian-yong', 'sun-qian'],
    });

    for (const officerId of ['guan-yu', 'jian-yong', 'sun-qian']) {
      expect(next.officers[officerId].acted).toBe(true);
    }
    expect(next.officers['guan-yu'].relationships?.['jian-yong']).toBe('sworn');
    expect(next.officers['guan-yu'].relationships?.['sun-qian']).toBe('sworn');
    expect(next.officers['jian-yong'].relationships?.['sun-qian']).toBe('sworn');
  });

  it('rejects sworn brothers of mixed gender or fewer than two officers', () => {
    const state = createGame('liu', 1);
    state.officers['chen-dao'].gender = 'female';

    const mixed = validateCommand(state, 'liu', {
      type: 'sworn', cityId: 'jiangling', officerIds: ['guan-yu', 'chen-dao'],
    });
    const one = validateCommand(state, 'liu', {
      type: 'sworn', cityId: 'jiangling', officerIds: ['guan-yu'],
    });

    expect(mixed.some((error) => error.includes('性别须相同'))).toBe(true);
    expect(one).toContain('至少选择两名武将结义');
  });

  it('marries two opposite-gender officers as spouses', () => {
    const state = createGame('liu', 1);
    state.officers['sun-qian'].gender = 'female';
    const next = executeCommand(state, 'liu', {
      type: 'marry', cityId: 'jiangling', officerIdA: 'guan-yu', officerIdB: 'sun-qian', relation: 'spouse',
    });

    expect(next.officers['guan-yu'].relationships?.['sun-qian']).toBe('spouse');
    expect(next.officers['sun-qian'].relationships?.['guan-yu']).toBe('spouse');
    expect(next.officers['guan-yu'].acted).toBe(true);
    expect(next.officers['sun-qian'].acted).toBe(true);
  });

  it('rejects marrying two officers of the same gender', () => {
    const state = createGame('liu', 1);
    state.officers['guan-yu'].gender = 'male';
    state.officers['jian-yong'].gender = 'male';
    expect(validateCommand(state, 'liu', {
      type: 'marry', cityId: 'jiangling', officerIdA: 'guan-yu', officerIdB: 'jian-yong', relation: 'spouse',
    }).some((error) => error.includes('一男一女'))).toBe(true);
  });

  it('rejects an officer who already acted', () => {
    const state = createGame('liu', 1);
    state.officers['liu-bei'].acted = true;

    expect(validateCommand(state, 'liu', {
      type: 'patrol', cityId: 'jiangling', officerIds: ['liu-bei'],
    })).toContain('刘备本月已行动');
  });

  it('buys a fixed amount of grain at the city price, charging gold rounded up with the politics effect', () => {
    const state = createGame('liu', 1);
    state.cities.jiangling.grainPrice = 5;
    state.cities.jiangling.merchantPresent = true;
    const politics = state.officers['liu-bei'].stats.politics;
    const expected = quoteTrade(state.cities.jiangling, politics, 'buy', 5000);

    const next = executeCommand(state, 'liu', {
      type: 'trade', cityId: 'jiangling', officerId: 'liu-bei', mode: 'buy', amount: 5000,
    });

    expect(next.cities.jiangling.food).toBe(state.cities.jiangling.food + 5000);
    expect(next.cities.jiangling.gold).toBe(state.cities.jiangling.gold + expected.goldDelta);
    // 政治80 → 交易效果108%，买5000粮需金 ceil(5000 ÷ (5 × 1.0857)) = 922
    expect(expected.foodDelta).toBe(5000);
    expect(expected.goldDelta).toBe(-922);
    expect(next.actionPoints.liu).toBe(state.actionPoints.liu - COMMAND_AP.trade);
    expect(next.officers['liu-bei'].acted).toBe(true);
  });

  it('sells grain for gold with a twenty percent fee and the politics trade effect', () => {
    const state = createGame('liu', 1);
    state.cities.jiangling.grainPrice = 5;
    state.cities.jiangling.merchantPresent = true;
    const politics = state.officers['liu-bei'].stats.politics;
    const expected = quoteTrade(state.cities.jiangling, politics, 'sell', 5000);

    const next = executeCommand(state, 'liu', {
      type: 'trade', cityId: 'jiangling', officerId: 'liu-bei', mode: 'sell', amount: 5000,
    });

    expect(next.cities.jiangling.food).toBe(state.cities.jiangling.food - 5000);
    expect(next.cities.jiangling.gold).toBe(state.cities.jiangling.gold + expected.goldDelta);
    // 卖粮 = 5000 ÷ 5 × 0.8 × 1.0857 ≈ 868
    expect(expected.goldDelta).toBe(868);
  });

  it('rejects trades with non-positive amounts, over-cap amounts, or insufficient resources', () => {
    const state = createGame('liu', 1);
    state.cities.jiangling.grainPrice = 5;
    state.cities.jiangling.merchantPresent = true;
    state.cities.jiangling.gold = 500;
    state.cities.jiangling.food = 1000;

    expect(validateCommand(state, 'liu', {
      type: 'trade', cityId: 'jiangling', officerId: 'liu-bei', mode: 'buy', amount: 0,
    })).toContain('交易数量必须为正整数');
    expect(validateCommand(state, 'liu', {
      type: 'trade', cityId: 'jiangling', officerId: 'liu-bei', mode: 'buy', amount: TRADE_MAX_GRAIN + 1,
    })).toContain(`单次交易最多${TRADE_MAX_GRAIN.toLocaleString('en-US')}兵粮`);
    // 买3000粮需金 ceil(3000 ÷ 5.43) ≈ 553 > 500
    expect(validateCommand(state, 'liu', {
      type: 'trade', cityId: 'jiangling', officerId: 'liu-bei', mode: 'buy', amount: 3000,
    })).toContain('资金不足');
    expect(validateCommand(state, 'liu', {
      type: 'trade', cityId: 'jiangling', officerId: 'liu-bei', mode: 'sell', amount: 2000,
    })).toContain('兵粮不足');
  });

  it('rolls monthly grain prices between three and seven per city', () => {
    const state = createGame('liu', 1);
    const cityCount = Object.keys(state.cities).length;

    rollGrainPrices(state);

    const after = Object.values(state.cities).map((city) => city.grainPrice!);
    expect(after).toHaveLength(cityCount);
    expect(after.every((price) => Number.isInteger(price) && price >= 3 && price <= 7)).toBe(true);
    expect(state.rngCursor).toBe(cityCount);
  });

  it('rolls merchants per city each ten-day and resets the trade flag', () => {
    const state = createGame('liu', 1);
    const cityCount = Object.keys(state.cities).length;
    const commerceCount = Object.values(state.cities).filter((c) => hasCityTrait(c.id, 'commerce')).length;
    state.cities.jiangling.merchantTradedThisTenDay = true;

    rollMerchants(state);

    // 商贸城不掷点（商人必到），仅其余城市消耗随机数
    expect(state.rngCursor).toBe(cityCount - commerceCount);
    for (const city of Object.values(state.cities)) {
      if (hasCityTrait(city.id, 'commerce')) expect(city.merchantPresent).toBe(true);
      else expect(typeof city.merchantPresent).toBe('boolean');
      expect(city.merchantTradedThisTenDay).toBe(false);
    }
  });

  it('rejects trading when the merchant is absent or already traded this ten-day', () => {
    const absent = createGame('liu', 1);
    absent.cities.jiangling.merchantPresent = false;
    expect(validateCommand(absent, 'liu', {
      type: 'trade', cityId: 'jiangling', officerId: 'liu-bei', mode: 'buy', amount: 1000,
    })).toContain('商人本旬未到访');

    const once = createGame('liu', 1);
    once.cities.jiangling.grainPrice = 5;
    once.cities.jiangling.merchantPresent = true;
    const traded = executeCommand(once, 'liu', {
      type: 'trade', cityId: 'jiangling', officerId: 'liu-bei', mode: 'buy', amount: 1000,
    });
    expect(traded.cities.jiangling.merchantTradedThisTenDay).toBe(true);
    expect(validateCommand(traded, 'liu', {
      type: 'trade', cityId: 'jiangling', officerId: 'jian-yong', mode: 'sell', amount: 1000,
    })).toContain('本旬已完成一次粮食交易');
  });

  it('rejects trading while the city is under enemy siege (blocked)', () => {
    const state = createGame('liu', 1);
    state.cities.jiangling.merchantPresent = true;
    state.cities.jiangling.grainPrice = 5;
    const [coord] = cityAttackRangeCoords(state.cities.jiangling);
    state.units['liu-siege-enemy'] = {
      id: 'liu-siege-enemy', kind: 'combat', forceId: 'cao', leaderId: 'cao-cao', officerIds: ['cao-cao'],
      homeCityId: 'xiangyang', troopType: 'spear', q: coord.q, r: coord.r, troops: 1000,
      food: 1000, energy: 80, movementRemaining: 20, moved: false, acted: false,
    };
    expect(validateCommand(state, 'liu', {
      type: 'trade', cityId: 'jiangling', officerId: 'liu-bei', mode: 'buy', amount: 1000,
    })).toContain('城池被敌方封锁，无法进行交易');
  });

  it('computes trade effect percent from officer politics', () => {
    expect(tradeEffectPercent(50)).toBe(100);
    expect(tradeEffectPercent(80)).toBe(108);
    expect(tradeEffectPercent(100)).toBe(114);
  });

  it('starts research with gold, techP, action point, and task costs', () => {
    const state = createGame('liu', 1);
    state.forces.liu.techP = 3200;
    state.forces.liu.techNodes = ['zhiyehua'];
    const startGold = state.cities.jiangling.gold;

    const next = executeCommand(state, 'liu', {
      type: 'research', cityId: 'jiangling', officerIds: ['liu-bei'], nodeId: 'qiangshuxunlian',
    });

    // 枪术训练（步战2级）：2000金/2000技巧P；刘备统率78，2级基本70日 −【78÷7】= 59日 → 6旬完成
    expect(next.officers['liu-bei'].location).toEqual({
      kind: 'task', cityId: 'jiangling', task: 'research', nodeId: 'qiangshuxunlian', remainingTenDays: 6, lead: true,
    });
    expect(next.cities.jiangling.gold).toBe(startGold - 2000);
    expect(next.forces.liu.techP).toBe(3200 - 2000);
    expect(next.actionPoints.liu).toBe(80 - 20);
    expect(next.officers['liu-bei'].acted).toBe(true);
  });

  it('rejects research without techP or when another research is running', () => {
    const poor = createGame('liu', 1);
    poor.forces.liu.techP = 500;
    expect(validateCommand(poor, 'liu', {
      type: 'research', cityId: 'jiangling', officerIds: ['liu-bei'], nodeId: 'zhiyehua',
    })).toContain('技巧P不足 1000');

    const busy = createGame('liu', 1);
    busy.forces.liu.techP = 5000;
    busy.officers['jian-yong'].location = {
      kind: 'task', cityId: 'wuling', task: 'research', nodeId: 'gonggongjiaoyu', remainingTenDays: 2,
    };
    expect(validateCommand(busy, 'liu', {
      type: 'research', cityId: 'jiangling', officerIds: ['liu-bei'], nodeId: 'zhiyehua',
    })).toContain('已有科技正在研究中');

    const finished = createGame('liu', 1);
    finished.forces.liu.techP = 99999;
    finished.forces.liu.techNodes = ['zhiyehua'];
    expect(validateCommand(finished, 'liu', {
      type: 'research', cityId: 'jiangling', officerIds: ['liu-bei'], nodeId: 'zhiyehua',
    })).toContain('该科技已研究完成');
  });

  it('军制系徭役制度解锁2级兵舍，征兵产出本身不再受科技加成', () => {
    const state = withFacilities(createGame('liu', 1));
    const plain = withFacilities(createGame('liu', 1));
    state.forces.liu.techNodes = ['zhiyehua', 'yaoyizhidu'];
    plain.forces.liu.techNodes = [];

    const boosted = executeCommand(state, 'liu', { type: 'recruit', cityId: 'jiangling', officerIds: ['liu-bei'] });
    const base = executeCommand(plain, 'liu', { type: 'recruit', cityId: 'jiangling', officerIds: ['liu-bei'] });

    const boostedGain = boosted.cities.jiangling.troops - state.cities.jiangling.troops;
    const baseGain = base.cities.jiangling.troops - plain.cities.jiangling.troops;
    // 征兵量只由基础值与兵舍等级加成决定（无科技乘数）
    const rawBase = recruitBaseYield([state.officers['liu-bei']], state.cities.jiangling);
    const facility = barracksYieldMultiplier(state.cities.jiangling);
    expect(baseGain).toBe(Math.round(rawBase * facility));
    expect(boostedGain).toBe(baseGain);
  });

  it('applies tactic power and movement techs to combat math', async () => {
    const { tacticPowerMultiplier, movementTechBonus, deployTroopCapOf, energyCapOf } = await import('./techs');
    const state = createGame('liu', 1);
    state.forces.liu.techNodes = ['qiangshuxunlian'];
    // 枪术训练：枪兵战法威力＋10%（只对战法生效）
    expect(tacticPowerMultiplier(state, 'liu', { kind: 'combat', troopType: 'spear' })).toBeCloseTo(1.1);
    expect(tacticPowerMultiplier(state, 'liu', { kind: 'combat', troopType: 'cavalry' })).toBe(1);
    expect(movementTechBonus(state, 'liu', { kind: 'combat', troopType: 'spear' })).toBe(0);

    state.forces.liu.techNodes = ['zhiyehua', 'jiedushi', 'qiangshuxunlian', 'qiangbingjingzhuan', 'jixingjun'];
    // 枪术训练＋10% 与 枪兵专精＋25% 叠加；急行军步兵移动＋6
    expect(tacticPowerMultiplier(state, 'liu', { kind: 'combat', troopType: 'spear' })).toBeCloseTo(1.35);
    expect(movementTechBonus(state, 'liu', { kind: 'combat', troopType: 'spear' })).toBe(6);
    // 节度使：带兵上限＋3000（基准10000）；职业化：最大士气＋20
    expect(deployTroopCapOf(state, 'liu')).toBe(13000);
    expect(energyCapOf(state, 'liu')).toBe(120);
  });

  it('starts ability research with gold and action point cost', () => {
    const state = createGame('liu', 1);
    const startGold = state.cities.jiangling.gold;

    const next = executeCommand(state, 'liu', {
      type: 'abilityResearch', cityId: 'jiangling', nodeId: 'warLow',
    });

    expect(next.cities.jiangling.gold).toBe(startGold - 300);
    expect(next.actionPoints.liu).toBe(80 - COMMAND_AP.abilityResearch);
    expect(next.forces.liu.abilityResearch?.active).toEqual({ nodeId: 'warLow', remainingMonths: 1 });
  });

  it('rejects ability research with missing prerequisites or another active research', () => {
    const state = createGame('liu', 1);
    // spearA 需前置 spearB
    expect(validateCommand(state, 'liu', {
      type: 'abilityResearch', cityId: 'jiangling', nodeId: 'spearA',
    })).toContain('前置能力尚未研究');

    const researching = executeCommand(state, 'liu', {
      type: 'abilityResearch', cityId: 'jiangling', nodeId: 'warLow',
    });
    expect(validateCommand(researching, 'liu', {
      type: 'abilityResearch', cityId: 'jiangling', nodeId: 'leadLow',
    })).toContain('已有能力正在研究中');
  });

  it('never allows re-researching a completed ability node', () => {
    const state = createGame('liu', 1);
    state.forces.liu.abilityResearch = { researched: ['warLow'], remaining: { warLow: 5 } };

    // 校验层：已完成节点直接拒绝
    expect(validateCommand(state, 'liu', {
      type: 'abilityResearch', cityId: 'jiangling', nodeId: 'warLow',
    })).toContain('该能力已研究完成');

    // 执行层：同样抛错，不会产生重复研究
    expect(() => executeCommand(state, 'liu', {
      type: 'abilityResearch', cityId: 'jiangling', nodeId: 'warLow',
    })).toThrow('该能力已研究完成');
  });

  it('rejects cultivation before research completion or when officer is ineligible', () => {
    const state = createGame('liu', 1);
    state.forces.liu.abilityResearch = { researched: ['warLow'], remaining: { warLow: 5 } };

    // 武力92的关羽已达低级节点上限70，不可培育
    expect(validateCommand(state, 'liu', {
      type: 'cultivate', cityId: 'jiangling', officerId: 'guan-yu', nodeId: 'warLow',
    })).toContain('该武将能力已达上限');

    // 未研究的节点不可培育
    expect(validateCommand(state, 'liu', {
      type: 'cultivate', cityId: 'jiangling', officerId: 'jian-yong', nodeId: 'warHigh',
    })).toContain('该能力尚未研究完成');
  });

  it('allows researching a skill node once its prerequisites are done', () => {
    const state = createGame('liu', 1);
    // 连击 前置 枪兵A；枪兵A 前置 弩兵A；弩兵A 前置 武+5中……这里直接完成该链最末端的前置即可
    state.forces.liu.abilityResearch = { researched: ['crossbowA', 'warMid', 'spearA'], remaining: {} };

    expect(validateCommand(state, 'liu', {
      type: 'abilityResearch', cityId: 'jiangling', nodeId: 'sk-lianji',
    })).toEqual([]);

    const researched = executeCommand(state, 'liu', {
      type: 'abilityResearch', cityId: 'jiangling', nodeId: 'sk-lianji',
    });
    expect(researched.forces.liu.abilityResearch?.active).toEqual({ nodeId: 'sk-lianji', remainingMonths: 1 });
  });

  it('grants the learned skill to an officer after cultivating a skill node', () => {
    const state = createGame('liu', 1);
    state.forces.liu.abilityResearch = { researched: ['sk-lianji'], remaining: { 'sk-lianji': 3 } };

    expect(validateCommand(state, 'liu', {
      type: 'cultivate', cityId: 'jiangling', officerId: 'jian-yong', nodeId: 'sk-lianji',
    })).toEqual([]);

    const next = executeCommand(state, 'liu', {
      type: 'cultivate', cityId: 'jiangling', officerId: 'jian-yong', nodeId: 'sk-lianji',
    });
    expect(next.officers['jian-yong'].location).toMatchObject({
      kind: 'task', task: 'cultivate', nodeId: 'sk-lianji', remainingTenDays: 3,
    });
    expect(next.forces.liu.abilityResearch?.remaining).toEqual({ 'sk-lianji': 3 });
  });
});

describe('appoint position', () => {
  it('initializes force rank from city count at scenario creation', () => {
    const state = createGame('liu', 1);
    expect(state.forces.liu.rank).toBe('zhou-cishi');
    expect(state.forces.cao.rank).toBe('zhou-cishi');
  });

  it('derives rank from city count for saves without rank', () => {
    const state = createGame('liu', 1);
    delete state.forces.liu.rank;
    expect(forceRankOf(state, 'liu')).toBe('zhou-cishi');
  });

  it('grants the lowest position without any merit', () => {
    const state = createGame('liu', 1);
    const position = POSITIONS.find((candidate) => candidate.name === '主簿')!;
    expect(position.merit).toBe(0);
    state.officers['guan-yu'].merit = 0;
    expect(validateCommand(state, 'liu', {
      type: 'appointPosition', cityId: 'jiangling', officerId: 'guan-yu', positionId: position.id,
    })).toEqual([]);
    const next = executeCommand(state, 'liu', {
      type: 'appointPosition', cityId: 'jiangling', officerId: 'guan-yu', positionId: position.id,
    });
    expect(next.officers['guan-yu'].positionId).toBe(position.id);
  });
  it('blocks appointing or dismissing officers leading troops outside a city', () => {
    const state = createGame('liu', 1);
    const position = POSITIONS.find((candidate) => candidate.name === '主簿')!;
    const granted = executeCommand(state, 'liu', {
      type: 'appointPosition', cityId: 'jiangling', officerId: 'guan-yu', positionId: position.id,
    });
    granted.units['field-u1'] = {
      id: 'field-u1', forceId: 'liu', leaderId: 'guan-yu', homeCityId: 'jiangling',
      q: 999, r: 999, troops: 3000, food: 100, energy: 100, movementRemaining: 0, moved: false, acted: false,
    };
    granted.officers['guan-yu'].location = { kind: 'unit', unitId: 'field-u1' };
    expect(validateCommand(granted, 'liu', {
      type: 'appointPosition', cityId: 'jiangling', officerId: 'guan-yu', positionId: '',
    })).toEqual([expect.stringContaining('城外')]);
    // 部队驻于本势力城市格视同回城，可正常免官
    granted.units['field-u1'].q = granted.cities.jiangling.gridQ;
    granted.units['field-u1'].r = granted.cities.jiangling.gridR;
    expect(validateCommand(granted, 'liu', {
      type: 'appointPosition', cityId: 'jiangling', officerId: 'guan-yu', positionId: '',
    })).toEqual([]);
  });
});

describe('跨城登庸差旅命令', () => {
  it('跨城登庸不即时结算：执行武将转入差旅行程，扣除资金并视为本旬已行动', () => {
    const { state, target, travel, command } = setupCrossCityJourney();
    expect(validateCommand(state, 'cao', command)).toEqual([]);
    const next = executeCommand(state, 'cao', command);

    const location = next.officers['cao-cao'].location;
    expect(location).toMatchObject({
      kind: 'recruitJourney',
      fromCityId: 'wan',
      targetCityId: 'hanzhong',
      targetOfficerId: target.id,
      phase: 'outbound',
      remainingTenDays: travel,
      returnTenDays: travel,
    });
    // 成功与否留待抵达当旬见分晓：目标此刻未被登走、无舌战会话
    expect(next.officers[target.id].forceId).toBeNull();
    expect(next.debateSession).toBeFalsy();
    expect(next.cities.wan.gold).toBe(state.cities.wan.gold - 500);
    expect(next.officers['cao-cao'].acted).toBe(true);
  });

  it('行程在途武将不可再执行指令（非常驻据点的待命武将）', () => {
    const { state, command } = setupCrossCityJourney();
    const next = executeCommand(state, 'cao', command);
    // 调动（transfer）同城命令：行程中武将不在本城待命
    expect(validateCommand(next, 'cao', {
      type: 'transfer', cityId: 'wan', officerIds: ['cao-cao'], targetCityId: 'xiangyang',
    })).toEqual([expect.stringContaining('只能移动出发据点内')]);
  });

  it('chooseRecruitDebate → accept：创建说客舌战会话并清空待决事项', () => {
    const { state, target, command } = setupCrossCityJourney();
    const journey = executeCommand(state, 'cao', command);
    // 抵达目标城并挂起舌战抉择（模拟结算层落下的待决状态）
    const loc = journey.officers['cao-cao'].location as Extract<Officer['location'], { kind: 'recruitJourney' }>;
    loc.remainingTenDays = 0;
    journey.pendingRecruitDebate = { recruiterId: 'cao-cao', targetId: target.id };

    const accept = { type: 'acceptRecruitDebate' as const, cityId: 'wan' as CityId, officerId: 'cao-cao', targetOfficerId: target.id };
    expect(validateCommand(journey, 'cao', accept)).toEqual([]);
    const next = executeCommand(journey, 'cao', accept);
    expect(next.pendingRecruitDebate).toBeNull();
    expect(next.debateSession).toMatchObject({ status: 'ongoing', recruiterId: 'cao-cao', targetId: target.id });
  });

  it('reject：放弃舌战，执行武将转入返程、目标不被登走', () => {
    const { state, target, travel, command } = setupCrossCityJourney();
    const journey = executeCommand(state, 'cao', command);
    const loc = journey.officers['cao-cao'].location as Extract<Officer['location'], { kind: 'recruitJourney' }>;
    loc.remainingTenDays = 0;
    journey.pendingRecruitDebate = { recruiterId: 'cao-cao', targetId: target.id };

    const reject = { type: 'rejectRecruitDebate' as const, cityId: 'wan' as CityId, officerId: 'cao-cao', targetOfficerId: target.id };
    expect(validateCommand(journey, 'cao', reject)).toEqual([]);
    const next = executeCommand(journey, 'cao', reject);
    expect(next.pendingRecruitDebate).toBeNull();
    expect(next.officers['cao-cao'].location).toMatchObject({ kind: 'recruitJourney', phase: 'return', remainingTenDays: travel });
    expect(next.officers[target.id].forceId).toBeNull();
  });

  it('无待决事项时不可响应舌战抉择命令', () => {
    const { state, command } = setupCrossCityJourney();
    const journey = executeCommand(state, 'cao', command);
    expect(validateCommand(journey, 'cao', {
      type: 'acceptRecruitDebate', cityId: 'wan', officerId: 'cao-cao', targetOfficerId: 'field-hanzhong',
    })).toEqual([expect.stringContaining('没有待处理')]);
  });
});

describe('批量探索日志', () => {
  it('批量探索：每名武将的探索结果单独记一条日志，不合并成一段', () => {
    const state = createGame('liu', 7);
    const next = executeCommand(state, 'liu', {
      type: 'explore', cityId: 'jiangling', officerIds: ['liu-bei', 'guan-yu'],
    });
    const exploreLogs = next.logs.filter((log) => log.message.includes('探索'));
    expect(exploreLogs).toHaveLength(2);
    // 每条日志只含本人结果，且带各自武将名
    expect(exploreLogs[0].message).toContain('刘备');
    expect(exploreLogs[1].message).toContain('关羽');
    expect(exploreLogs[0].message).not.toContain('关羽');
    expect(exploreLogs[1].message).not.toContain('刘备');
    // 两名武将均已行动、行动力按人次扣除
    expect(next.officers['liu-bei'].acted).toBe(true);
    expect(next.officers['guan-yu'].acted).toBe(true);
  });

  it('单将探索仍只有一条日志', () => {
    const state = createGame('liu', 7);
    const next = executeCommand(state, 'liu', {
      type: 'explore', cityId: 'jiangling', officerIds: ['liu-bei'],
    });
    const exploreLogs = next.logs.filter((log) => log.message.includes('探索'));
    expect(exploreLogs).toHaveLength(1);
    expect(exploreLogs[0].message).toContain('刘备');
  });
});
