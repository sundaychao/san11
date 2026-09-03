import { describe, expect, it } from 'vitest';
import { ARMAMENT_GOLD_COST, produceArmamentYield } from './armaments';
import { COMMAND_AP, TRADE_MAX_GRAIN, executeCommand, grainPriceOf, patrolGoldCost, quoteTrade, rollGrainPrices, rollMerchants, tradeEffectPercent, transferDuration, validateCommand } from './commands';
import type { PlotType } from './innerAffairs';
import { armamentYieldMultiplier, barracksYieldMultiplier } from './innerAffairs';
import { createGame } from './scenario/jingxiang208';
import type { GameState } from './types';

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
  it('recruits troops with population, food, gold, and order costs', () => {
    const state = withFacilities(createGame('liu', 1));
    const next = executeCommand(state, 'liu', {
      type: 'recruit', cityId: 'jiangling', officerId: 'liu-bei',
    });

    // 基础 1290 × 兵舍1级加成 1.15 = 1483
    const expected = Math.round(1290 * barracksYieldMultiplier(state.cities.jiangling));
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
      type: 'recruit', cityId: 'jiangling', officerId: 'liu-bei',
    });
    const base = 300 + state.officers['liu-bei'].stats.charisma * 10;

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
      type: 'recruit', cityId: 'jiangling', officerId: 'liu-bei',
    });

    expect(next.battleDamageReports).toEqual([]);
    expect(next.strategyResultReports).toEqual([]);
  });

  it('produces selected armaments with gold and officer action costs', () => {
    const state = withFacilities(createGame('liu', 1));
    const currentCrossbows = state.cities.jiangling.armaments?.crossbow ?? 0;
    const next = executeCommand(state, 'liu', {
      type: 'produceArmament', cityId: 'jiangling', officerId: 'liu-bei', armamentType: 'crossbow',
    });

    // 基础 1840 × 锻冶1级加成 1.15 = 2116
    const expected = Math.round(1840 * armamentYieldMultiplier(state.cities.jiangling, 'crossbow'));
    expect(next.cities.jiangling.armaments?.crossbow).toBe(currentCrossbows + expected);
    expect(next.cities.jiangling.gold).toBe(state.cities.jiangling.gold - 1000);
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
    const base = produceArmamentYield(state.officers['liu-bei'], 'crossbow');
    const before = state.cities.jiangling.armaments!.crossbow;
    const next = executeCommand(state, 'liu', {
      type: 'produceArmament', cityId: 'jiangling', officerId: 'liu-bei', armamentType: 'crossbow',
    });

    const expected = Math.round(produceArmamentYield(state.officers['liu-bei'], 'crossbow')
      * 1.5 * armamentYieldMultiplier(state.cities.jiangling, 'crossbow'));
    expect(next.cities.jiangling.armaments!.crossbow - before).toBe(expected);
    expect(next.cities.jiangling.gold).toBe(state.cities.jiangling.gold - ARMAMENT_GOLD_COST);
    expect(next.actionPoints.liu).toBe(state.actionPoints.liu - COMMAND_AP.produceArmament);
    expect(next.officers['liu-bei'].acted).toBe(true);
  });

  it('does not apply 能吏 to delayed armament production', () => {
    const state = withFacilities(createGame('liu', 1));
    state.officers['liu-bei'].skill = '能吏';
    const next = executeCommand(state, 'liu', {
      type: 'produceArmament', cityId: 'jiangling', officerId: 'liu-bei', armamentType: 'ram',
    });

    expect(next.officers['liu-bei'].location).toEqual({
      kind: 'task',
      cityId: 'jiangling',
      task: 'armament',
      armamentType: 'ram',
      amount: 2,
      remainingTenDays: 3,
    });
    expect(next.cities.jiangling.gold).toBe(state.cities.jiangling.gold - ARMAMENT_GOLD_COST);
  });

  it('starts a one-month special armament production task with two units', () => {
    const state = withFacilities(createGame('liu', 1));
    const currentRams = state.cities.jiangling.armaments?.ram ?? 0;
    const next = executeCommand(state, 'liu', {
      type: 'produceArmament', cityId: 'jiangling', officerId: 'liu-bei', armamentType: 'ram',
    });

    expect(next.cities.jiangling.armaments?.ram).toBe(currentRams);
    expect(next.cities.jiangling.gold).toBe(state.cities.jiangling.gold - 1000);
    expect(next.officers['liu-bei'].location).toEqual({
      kind: 'task',
      cityId: 'jiangling',
      task: 'armament',
      armamentType: 'ram',
      amount: 2,
      remainingTenDays: 3,
    });
    expect(next.officers['liu-bei'].acted).toBe(true);
  });

  it('trains troops from leadership', () => {
    const state = createGame('liu', 1);
    const next = executeCommand(state, 'liu', {
      type: 'train', cityId: 'jiangling', officerId: 'guan-yu',
    });

    expect(next.cities.jiangling.training).toBe(81);
    expect(next.cities.jiangling.food).toBe(state.cities.jiangling.food - 300);
  });

  it('patrols from charisma and caps public order', () => {
    const state = createGame('liu', 1);
    state.cities.jiangling.order = 99;
    const next = executeCommand(state, 'liu', {
      type: 'patrol', cityId: 'jiangling', officerId: 'liu-bei',
    });

    expect(next.cities.jiangling.order).toBe(100);
    expect(next.cities.jiangling.gold).toBe(state.cities.jiangling.gold - patrolGoldCost(state.cities.jiangling));
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

  it('starts a debate when finding a local talent to recruit', () => {
    const state = createGame('liu', 1);
    const next = executeCommand(state, 'liu', {
      type: 'talent', cityId: 'jiangling', officerId: 'liu-bei',
    });

    expect(next.debateSession?.status).toBe('ongoing');
    expect(next.debateSession?.recruiterId).toBe('liu-bei');
    expect(next.debateSession?.targetId).toBe('zhao-yun');
    expect(next.cities.jiangling.gold).toBe(state.cities.jiangling.gold - 500);
    expect(next.officers['liu-bei'].acted).toBe(true);
  });

  it('does not recruit the talent before the debate finishes regardless of seed', () => {
    const state = createGame('liu', 14336);
    const next = executeCommand(state, 'liu', {
      type: 'talent', cityId: 'jiangling', officerId: 'liu-bei',
    });

    expect(next.debateSession?.status).toBe('ongoing');
    expect(next.officers['zhao-yun'].forceId).toBeNull();
    expect(next.logs.some((log) => log.message.includes('舌战'))).toBe(true);
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
      remainingTenDays: 3,
    });
    expect(next.actionPoints.liu).toBe(70);
    expect(next.logs.at(-1)?.message).toContain('3旬');
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

    expect(enemy).toContain('只能调往己方城市');
    expect(empty).toContain('至少调动一名武将');
  });

  it('does not allow a city governor to be transferred', () => {
    const state = createGame('liu', 1);

    expect(validateCommand(state, 'liu', {
      type: 'transfer', cityId: 'jiangling', targetCityId: 'wuling', officerIds: ['liu-bei'],
    })).toContain('太守不可调离任所');
  });

  it('does not allow officers outside the source city to transfer', () => {
    const state = createGame('liu', 1);
    state.officers['guan-yu'].location = { kind: 'transfer', fromCityId: 'jiangling', targetCityId: 'wuling', remainingTenDays: 1 };

    expect(validateCommand(state, 'liu', {
      type: 'transfer', cityId: 'jiangling', targetCityId: 'wuling', officerIds: ['guan-yu'],
    })).toContain('只能调动出发城市内的己方武将');
  });

  it('rejects an officer who already acted', () => {
    const state = createGame('liu', 1);
    state.officers['liu-bei'].acted = true;

    expect(validateCommand(state, 'liu', {
      type: 'patrol', cityId: 'jiangling', officerId: 'liu-bei',
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
    state.cities.jiangling.merchantTradedThisTenDay = true;

    rollMerchants(state);

    expect(state.rngCursor).toBe(cityCount);
    for (const city of Object.values(state.cities)) {
      expect(typeof city.merchantPresent).toBe('boolean');
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

  it('computes trade effect percent from officer politics', () => {
    expect(tradeEffectPercent(50)).toBe(100);
    expect(tradeEffectPercent(80)).toBe(108);
    expect(tradeEffectPercent(100)).toBe(114);
  });

  it('starts research with gold, techP, action point, and task costs', () => {
    const state = createGame('liu', 1);
    state.forces.liu.techP = 3200;
    state.forces.liu.techs = { cavalry: 1 };
    const startGold = state.cities.jiangling.gold;

    const next = executeCommand(state, 'liu', {
      type: 'research', cityId: 'jiangling', officerId: 'liu-bei', branch: 'cavalry',
    });

    // 刘备统率80，2级基础4旬，80/20=4省4旬 → 1旬完成
    expect(next.officers['liu-bei'].location).toEqual({
      kind: 'task', cityId: 'jiangling', task: 'research', branch: 'cavalry', remainingTenDays: 1,
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
      type: 'research', cityId: 'jiangling', officerId: 'liu-bei', branch: 'spear',
    })).toContain('技巧P不足 1000');

    const busy = createGame('liu', 1);
    busy.forces.liu.techP = 5000;
    busy.officers['jian-yong'].location = {
      kind: 'task', cityId: 'wuling', task: 'research', branch: 'civil', remainingTenDays: 2,
    };
    expect(validateCommand(busy, 'liu', {
      type: 'research', cityId: 'jiangling', officerId: 'liu-bei', branch: 'spear',
    })).toContain('已有科技正在研究中');

    const finished = createGame('liu', 1);
    finished.forces.liu.techP = 99999;
    finished.forces.liu.techs = { spear: 4 };
    expect(validateCommand(finished, 'liu', {
      type: 'research', cityId: 'jiangling', officerId: 'liu-bei', branch: 'spear',
    })).toContain('该方向科技已研究完毕');
  });

  it('boosts recruit yield with the corvee civil tech', () => {
    const state = withFacilities(createGame('liu', 1));
    const plain = withFacilities(createGame('liu', 1));
    state.forces.liu.techs = { civil: 3 };
    plain.forces.liu.techs = {};

    const boosted = executeCommand(state, 'liu', { type: 'recruit', cityId: 'jiangling', officerId: 'liu-bei' });
    const base = executeCommand(plain, 'liu', { type: 'recruit', cityId: 'jiangling', officerId: 'liu-bei' });

    const boostedGain = boosted.cities.jiangling.troops - state.cities.jiangling.troops;
    const baseGain = base.cities.jiangling.troops - plain.cities.jiangling.troops;
    // 科技徭役 ×1.3 与兵舍1级 ×1.15 均以同一基础值计算，不应对已取整的结果再乘一次
    const rawBase = 300 + state.officers['liu-bei'].stats.charisma * 10;
    const facility = barracksYieldMultiplier(state.cities.jiangling);
    expect(baseGain).toBe(Math.round(rawBase * facility));
    expect(boostedGain).toBe(Math.round(rawBase * facility * 1.3));
  });

  it('applies troop damage and movement techs to combat math', async () => {
    const { troopDamageMultiplier, troopMovementBonus, deployTroopCapOf, energyCapOf } = await import('./techs');
    const state = createGame('liu', 1);
    state.forces.liu.techs = { spear: 1 };
    expect(troopDamageMultiplier(state, 'liu', 'spear')).toBeCloseTo(1.1);
    expect(troopDamageMultiplier(state, 'liu', 'cavalry')).toBe(1);
    expect(troopMovementBonus(state, 'liu', 'spear')).toBe(0);

    state.forces.liu.techs = { spear: 4, military: 3 };
    expect(troopDamageMultiplier(state, 'liu', 'spear')).toBeCloseTo(1.2);
    expect(troopMovementBonus(state, 'liu', 'spear')).toBe(6);
    expect(deployTroopCapOf(state, 'liu')).toBe(13000);
    // 军制3级含1级熟练兵：气力上限+20
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
