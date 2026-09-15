import { describe, expect, it } from 'vitest';
import { armamentProductionTenDays } from './armaments';
import { executeCommand, strongholdTransferDuration } from './commands';
import { resolveDebateAbandon, resolveDebateRound } from './debate';
import { hasCityTrait } from './cityTraits';
import { cityMonthlyGoldIncome, cityMonthlyOfficerSalary, cityQuarterlyFoodIncome, cityPlots } from './innerAffairs';
import { createGame } from './scenario/jingxiang208';
import { resolveCitySkills } from './skills/sources';
import { orderDropResist } from './techs';
import { settleMonth, settleTenDay } from './turn';
import type { CityId, GameState, Officer } from './types';

describe('monthly settlement', () => {
  it('settles monthly gold and restores monthly actions without monthly food income', () => {
    const state = createGame('liu', 4394);
    state.actionPoints.liu = 0;
    state.officers['liu-bei'].acted = true;
    const before = state.cities.jiangling;
    const expectedGold = before.gold + cityMonthlyGoldIncome(before) - cityMonthlyOfficerSalary(state, before);

    const next = settleMonth(state);

    expect(next.month).toBe(2);
    expect(next.actionPoints.liu).toBe(80);
    expect(next.officers['liu-bei'].acted).toBe(false);
    expect(next.cities.jiangling.gold).toBe(expectedGold);
    expect(next.cities.jiangling.food).toBe(before.food);
    expect(next.cities.jiangling.population).toBeGreaterThan(state.cities.jiangling.population);
  });

  it('adds city food only when entering a quarter-start month', () => {
    const state = createGame('liu', 4394);
    state.month = 3;
    const before = state.cities.jiangling;
    const expectedFood = before.food + cityQuarterlyFoodIncome(before);

    const next = settleMonth(state);

    expect(next.month).toBe(4);
    expect(next.cities.jiangling.food).toBe(expectedFood);
  });

  it('dismantles black markets when entering the first lunar month (every year)', () => {
    const state = createGame('liu', 4394);
    state.month = 9; // 腊月 → 进入正月（month 10，TopBar 显示"正月"）
    const jiangling = state.cities.jiangling;
    cityPlots(jiangling)[0] = { id: 'p0', type: 'blackmarket', level: 1, value: 8, q: 1, r: 1 };
    cityPlots(jiangling)[1] = { id: 'p1', type: 'market', level: 1, value: 8, q: 2, r: 1 };
    const wan = state.cities.wan;
    cityPlots(wan)[0] = { id: 'p2', type: 'blackmarket', level: 1, value: 8, q: 1, r: 1 };

    const next = settleMonth(state);

    expect(next.month).toBe(10);
    expect(cityPlots(next.cities.jiangling)[0].type).toBe('empty');
    expect(cityPlots(next.cities.jiangling)[1].type).toBe('market');
    expect(cityPlots(next.cities.wan)[0].type).toBe('empty');
    expect(next.logs.some((log) => log.id.startsWith('blackmarket-jiangling'))).toBe(true);
    expect(next.logs.some((log) => log.id.startsWith('blackmarket-wan'))).toBe(true);
  });

  it('keeps black markets in non-new-year months', () => {
    const state = createGame('liu', 4394);
    state.month = 11; // 二月 → 三月，非正月
    const jiangling = state.cities.jiangling;
    cityPlots(jiangling)[0] = { id: 'p0', type: 'blackmarket', level: 1, value: 8, q: 1, r: 1 };

    const next = settleMonth(state);

    expect(next.month).toBe(12);
    expect(cityPlots(next.cities.jiangling)[0].type).toBe('blackmarket');
    expect(next.logs.some((log) => log.id.startsWith('blackmarket'))).toBe(false);
  });

  it('dismantles black markets still under construction at new year, releasing the builder', () => {
    const state = createGame('liu', 4394);
    state.month = 9; // 腊月 → 进入正月
    const jiangling = state.cities.jiangling;
    // 建设中黑市：type 仍为 empty，仅 constructing.facility 标记为 blackmarket
    cityPlots(jiangling)[0] = {
      id: 'p0', type: 'empty', level: 0, value: 0, q: 1, r: 1,
      constructing: { facility: 'blackmarket', officerIds: ['liu-bei'], remainingTenDays: 2 },
    };
    state.officers['liu-bei'].location = {
      kind: 'task', cityId: 'jiangling', task: 'construction', facility: 'blackmarket', plotIndex: 0, remainingTenDays: 2,
    };

    const next = settleMonth(state);

    expect(next.month).toBe(10);
    expect(cityPlots(next.cities.jiangling)[0].type).toBe('empty');
    expect(cityPlots(next.cities.jiangling)[0].constructing).toBeUndefined();
    // 建设武将释放回城待命
    expect(next.officers['liu-bei'].location).toEqual({ kind: 'city', cityId: 'jiangling' });
    expect(next.officers['liu-bei'].acted).toBe(false);
    expect(next.logs.some((log) => log.id.startsWith('blackmarket-jiangling'))).toBe(true);
  });

  it('multiplies generated city income once and stops after the resident transfers', () => {
    const state = createGame('sun', 4394);
    state.officers['lu-su'].skill = '富豪';
    const city = state.cities.changsha;
    const baseGold = cityMonthlyGoldIncome(city);
    const salary = cityMonthlyOfficerSalary(state, city);

    // 第一次：鲁肃在城（location.kind === 'city'），富豪生效 ×1.5，俸禄照常扣
    const first = settleMonth(state);
    expect(first.cities.changsha.gold).toBe(city.gold + Math.round(baseGold * 1.5) - salary);

    // 将鲁肃调动为途中状态——cityId 仍是 changsha，俸禄照常从长沙扣（按 cityId），
    // 但富豪特技只对 location.kind === 'city' 的武将生效，收入不再 ×1.5
    state.officers['lu-su'].location = {
      kind: 'transfer', fromCityId: 'changsha', targetCityId: 'jiangxia', remainingTenDays: 1,
    };
    expect(cityMonthlyOfficerSalary(state, state.cities.changsha)).toBe(salary); // 俸禄未变
    const firstGold = first.cities.changsha.gold;

    const second = settleMonth(state);
    // 第二次收入倍率回落到 1（baseGold），而非 1.5×baseGold
    expect(second.cities.changsha.gold - firstGold).toBeLessThan(Math.round(baseGold * 1.5) - salary);
  });

  it('counts a 米道 production task, does not stack duplicates, and multiplies only quarterly base food', () => {
    const state = createGame('sun', 4394);
    state.month = 3;
    state.officers['zhou-yu'].skill = '米道';
    state.officers['zhou-yu'].location = {
      kind: 'task', cityId: 'changsha', task: 'armament', armamentType: 'ram', amount: 2, remainingTenDays: 2,
    };
    state.officers['lu-su'].skill = '米道';
    const city = state.cities.changsha;
    const next = settleMonth(state);

    expect(next.cities.changsha.food).toBe(city.food + Math.round(cityQuarterlyFoodIncome(city) * 1.5));
  });

  it('does not multiply existing food outside the quarterly income boundary', () => {
    const state = createGame('sun', 4394);
    state.officers['lu-su'].skill = '米道';
    const before = state.cities.changsha.food;

    const next = settleMonth(state);

    expect(next.cities.changsha.food).toBe(before);
  });

  it('rounds skilled gold income only after applying the multiplier', () => {
    const state = createGame('sun', 4394);
    state.officers['lu-su'].skill = '富豪';
    const city = state.cities.changsha;
    city.commerce = 1;
    city.population = 151;

    const next = settleMonth(state);

    expect(next.cities.changsha.gold).toBe(city.gold + Math.round(cityMonthlyGoldIncome(city) * 1.5) - cityMonthlyOfficerSalary(state, city));
  });

  it('rounds skilled quarterly food income only after applying the multiplier', () => {
    const state = createGame('sun', 4394);
    state.month = 3;
    state.officers['lu-su'].skill = '米道';
    const city = state.cities.changsha;
    city.agriculture = 1;
    city.population = 61;

    const next = settleMonth(state);

    expect(next.cities.changsha.food).toBe(city.food + Math.round(cityQuarterlyFoodIncome(city) * 1.5));
  });

  it('preserves unskilled settlement values and RNG results for the same seed', () => {
    const state = createGame('liu', 20804);
    for (const officer of Object.values(state.officers)) officer.skill = undefined;
    // 老龄系统与该基线测试正交：将高龄武将年轻化，避免每月老龄掷点污染 RNG 与日志
    for (const officer of Object.values(state.officers)) officer.birthYear = Math.max(officer.birthYear ?? 170, 170);

    const next = settleMonth(state);

    expect(next.rngCursor).toBe(97);
    expect(next.logs.slice(-2)).toEqual([
      { id: 'event-1-wu-86', month: 1, forceId: null, message: '吴发生丰收' },
      { id: 'month-2', month: 2, forceId: null, message: '进入建安十三年后的第2个月。' },
    ]);
    // 长沙/零陵本月无事件影响，order/troops 维持种子值；population 按增长公式确定性增长
    const changsha = state.cities.changsha;
    const lingling = state.cities.lingling;
    const changshaGrowth = Math.floor(changsha.population * 0.005 * changsha.order / 100);
    const linglingGrowth = Math.floor(lingling.population * 0.005 * lingling.order / 100);
    expect(next.cities.changsha).toMatchObject({
      population: changsha.population + changshaGrowth,
      order: changsha.order,
      troops: changsha.troops,
    });
    expect(next.cities.lingling).toMatchObject({
      population: lingling.population + linglingGrowth,
      order: lingling.order,
      troops: lingling.troops,
    });
  });

  it('replays the same events from the same game state', () => {
    const first = settleMonth(createGame('liu', 20804));
    const second = settleMonth(createGame('liu', 20804));

    expect(first.cities).toEqual(second.cities);
    expect(first.logs).toEqual(second.logs);
    expect(first.rngCursor).toBe(second.rngCursor);
  });

  it('finishes after settling month 24', () => {
    const state = createGame('liu', 1);
    state.month = 24;

    const next = settleMonth(state);

    expect(next.month).toBe(24);
    expect(next.phase).toBe('finished');
  });

  it('does not mutate the previous month', () => {
    const state = createGame('liu', 1);
    const snapshot = structuredClone(state);

    settleMonth(state);

    expect(state).toEqual(snapshot);
  });

  it('clears previous battle damage reports when advancing the month', () => {
    const state = createGame('liu', 1);
    state.battleDamageReports = [{
      id: 'old-damage',
      unitId: 'old-target',
      q: 35,
      r: 20,
      amount: 500,
      kind: 'attack',
    }];

    const next = settleMonth(state);

    expect(next.battleDamageReports).toEqual([]);
  });
});

describe('ten-day settlement', () => {
  it('keeps a completing same-city 米道 production officer as the exact quarterly income source', () => {
    const state = createGame('sun', 4394);
    state.month = 3;
    state.tenDay = 3;
    for (const officer of Object.values(state.officers)) {
      if (officer.cityId === 'changsha') officer.skill = undefined;
    }
    state.officers['zhou-yu'].skill = '米道';
    state.officers['zhou-yu'].location = {
      kind: 'task', cityId: 'changsha', task: 'armament', armamentType: 'ram', amount: 2, remainingTenDays: 1,
    };
    const city = state.cities.changsha;
    // 军马与士兵同口粮消耗
    const cityFoodAfterSupply = city.food - Math.ceil(((city.troops + (city.armaments?.cavalry ?? 0)) * 500) / 10000);
    const quarterlyFood = cityQuarterlyFoodIncome(city);
    const skillSources = (current: typeof state) => resolveCitySkills(current, 'changsha').map((skill) => ({
      name: skill.definition.name,
      sourceOfficerIds: skill.sourceOfficerIds,
    }));

    expect(skillSources(state)).toEqual([{ name: '米道', sourceOfficerIds: ['zhou-yu'] }]);

    const next = settleTenDay(state);

    expect(next.month).toBe(4);
    expect(next.tenDay).toBe(1);
    expect(next.officers['zhou-yu'].location).toEqual({ kind: 'city', cityId: 'changsha' });
    expect(skillSources(next)).toEqual([{ name: '米道', sourceOfficerIds: ['zhou-yu'] }]);
    expect(next.cities.changsha.food).toBe(cityFoodAfterSupply + Math.round(quarterlyFood * 1.5));
    const completionLogIndex = next.logs.findIndex((log) => log.id.startsWith('armament-complete-3-zhou-yu-'));
    const monthFourLogIndex = next.logs.findIndex((log) => log.id === 'month-4');
    expect(completionLogIndex).toBeGreaterThanOrEqual(0);
    expect(monthFourLogIndex).toBeGreaterThanOrEqual(0);
    expect(monthFourLogIndex).toBeGreaterThan(completionLogIndex);
  });

  it('clears previous battle reports when advancing the ten-day turn', () => {
    const state = createGame('liu', 1);
    state.battleDamageReports = [{
      id: 'old-damage',
      unitId: 'old-target',
      q: 35,
      r: 20,
      amount: 500,
      kind: 'attack',
    }];
    state.strategyResultReports = [{
      id: 'old-strategy', strategyId: 'disturb', q: 35, r: 20,
      label: '计略失败', succeeded: false,
    }];

    const next = settleTenDay(state);

    expect(next.battleDamageReports).toEqual([]);
    expect(next.strategyResultReports).toEqual([]);
  });

  it('consumes city food in proportion to garrison size', () => {
    const state = createGame('liu', 1);
    state.tenDay = 1;
    state.cities.jiangling.troops = 10000;
    state.cities.jiangling.food = 10000;

    const next = settleTenDay(state);

    // 士兵 10000 + 军马 3000 同口粮：(10000+3000)×500÷10000 = 650
    expect(next.cities.jiangling.food).toBe(9350);
  });

  it('butchers horses as food substitute when the city runs short of grain', () => {
    const state = createGame('liu', 1);
    state.tenDay = 1;
    state.cities.jiangling.troops = 10000;
    state.cities.jiangling.armaments!.cavalry = 3000;
    // 存粮 300，缺口 350 → 宰马 ⌈350÷2⌉=175 匹抵 350 粮，士兵无损失
    state.cities.jiangling.food = 300;

    const next = settleTenDay(state);

    expect(next.cities.jiangling.food).toBe(0);
    expect(next.cities.jiangling.armaments!.cavalry).toBe(2825);
    expect(next.cities.jiangling.troops).toBe(10000);
    expect(next.logs.some((log) => log.message.includes('宰杀军马175匹'))).toBe(true);
  });

  it('starves 23% of current troops each ten-day when horses cannot cover the deficit', () => {
    const state = createGame('liu', 1);
    state.tenDay = 1;
    state.cities.jiangling.troops = 10000;
    state.cities.jiangling.armaments!.cavalry = 0;
    state.cities.jiangling.food = 0;

    const next = settleTenDay(state);

    // 完全无粮无马：饿死当前兵力 23% = 2300
    expect(next.cities.jiangling.troops).toBe(7700);
    expect(next.cities.jiangling.food).toBe(0);
    expect(next.logs.some((log) => log.message.includes('缺粮') && log.message.includes('2,300士兵'))).toBe(true);
  });

  it('consumes field unit food in proportion to unit size', () => {
    const state = createGame('liu', 1);
    state.tenDay = 1;
    state.units['supply-test'] = {
      id: 'supply-test',
      kind: 'combat',
      forceId: 'liu',
      leaderId: 'liu-bei',
      officerIds: ['liu-bei'],
      homeCityId: 'jiangling',
      troopType: 'sword',
      q: 35,
      r: 20,
      troops: 4000,
      food: 5000,
      energy: 70,
      movementRemaining: 0,
      moved: true,
      acted: true,
    };

    const next = settleTenDay(state);

    expect(next.units['supply-test'].food).toBe(4600);
  });

  it('sends expiring reinforcement officers to a friendly city when their home city has fallen', () => {
    const state = createGame('liu', 1);
    state.tenDay = 1;
    state.units['reinforcement'] = {
      id: 'reinforcement',
      kind: 'combat',
      forceId: 'liu',
      leaderId: 'liu-bei',
      officerIds: ['liu-bei'],
      homeCityId: 'jiangling',
      troopType: 'sword',
      q: 35,
      r: 20,
      troops: 3000,
      food: 5000,
      energy: 70,
      movementRemaining: 0,
      moved: true,
      acted: true,
      expiresTenDay: 0,
    };
    state.officers['liu-bei'].location = { kind: 'unit', unitId: 'reinforcement' };
    // 归属据点江陵已落入曹操之手，武将不得被送进敌城（刘备仍保有武陵）
    state.cities['jiangling'].ownerId = 'cao';

    const next = settleTenDay(state);

    expect(next.units.reinforcement).toBeUndefined();
    expect(next.officers['liu-bei'].location).toEqual({ kind: 'city', cityId: 'wuling' });
    expect(next.logs.some((log) => log.message.includes('武陵'))).toBe(true);
  });

  it('ticks down unit plot statuses each ten-day', () => {
    const state = createGame('liu', 1);
    state.units['plot-status-unit'] = {
      id: 'plot-status-unit',
      kind: 'combat',
      forceId: 'cao',
      leaderId: 'cao-ren',
      homeCityId: 'xiangyang',
      troopType: 'sword',
      q: 10,
      r: 10,
      troops: 3000,
      food: 3000,
      energy: 80,
      movementRemaining: 5,
      confusedTenDays: 1,
      falseReportedTenDays: 1,
      burningTenDays: 1,
      moved: false,
      acted: false,
    };

    const next = settleTenDay(state);

    expect(next.units['plot-status-unit'].confusedTenDays).toBeUndefined();
    expect(next.units['plot-status-unit'].falseReportedTenDays).toBeUndefined();
    expect(next.units['plot-status-unit'].burningTenDays).toBeUndefined();
  });

  it('restores a three-turn confused unit one turn at a time', () => {
    const state = createGame('liu', 1);
    state.units['long-confused-unit'] = {
      id: 'long-confused-unit',
      kind: 'combat',
      forceId: 'cao',
      leaderId: 'cao-ren',
      homeCityId: 'xiangyang',
      troopType: 'sword',
      q: 10,
      r: 10,
      troops: 3000,
      food: 3000,
      energy: 80,
      movementRemaining: 5,
      confusedTenDays: 3,
      moved: false,
      acted: false,
    };

    const secondTurn = settleTenDay(state);
    expect(secondTurn.units['long-confused-unit'].confusedTenDays).toBe(2);
    const thirdTurn = settleTenDay(secondTurn);
    expect(thirdTurn.units['long-confused-unit'].confusedTenDays).toBe(1);
    const recovered = settleTenDay(thirdTurn);
    expect(recovered.units['long-confused-unit'].confusedTenDays).toBeUndefined();
  });

  it('records arrow tower automatic damage reports when entering a new ten-day turn', () => {
    const state = createGame('liu', 1);
    state.units['arrow-target'] = {
      id: 'arrow-target',
      kind: 'combat',
      forceId: 'cao',
      leaderId: 'cao-ren',
      homeCityId: 'xiangyang',
      troopType: 'sword',
      q: 12,
      r: 10,
      troops: 3000,
      food: 3000,
      energy: 80,
      movementRemaining: 5,
      moved: false,
      acted: false,
    };
    state.facilities = {
      arrow: { id: 'arrow', type: 'arrowTower', forceId: 'liu', q: 10, r: 10, durability: 700 },
    };

    const next = settleTenDay(state);

    expect(next.units['arrow-target'].troops).toBe(2700);
    expect(next.battleDamageReports).toEqual([
      expect.objectContaining({
        unitId: 'arrow-target',
        q: 12,
        r: 10,
        amount: 300,
        kind: 'attack',
      }),
    ]);
  });

  it('damages units that remain on burning ground when entering a new ten-day turn', () => {
    const state = createGame('liu', 1);
    state.units['burning-ground-target'] = {
      id: 'burning-ground-target',
      kind: 'combat',
      forceId: 'cao',
      leaderId: 'cao-ren',
      homeCityId: 'xiangyang',
      troopType: 'sword',
      q: 12,
      r: 10,
      troops: 3000,
      food: 3000,
      energy: 80,
      movementRemaining: 5,
      moved: false,
      acted: false,
    };
    state.firePlots = [{ q: 12, r: 10 }];

    const next = settleTenDay(state);

    expect(next.units['burning-ground-target'].troops).toBe(2500);
    expect(next.battleDamageReports).toEqual([
      expect.objectContaining({
        unitId: 'burning-ground-target',
        q: 12,
        r: 10,
        amount: 500,
        kind: 'attack',
      }),
    ]);
  });

  it('ticks down and removes burning ground within its remaining ten-day duration', () => {
    const state = createGame('liu', 1);
    state.firePlots = [
      { q: 12, r: 10, remainingTenDays: 1 },
      { q: 13, r: 10, remainingTenDays: 2 },
      { q: 14, r: 10 },
    ];

    const next = settleTenDay(state);

    expect(next.firePlots).toEqual([
      { q: 13, r: 10, remainingTenDays: 1 },
      { q: 14, r: 10, remainingTenDays: 2 },
    ]);
  });

  it('damages facilities that remain on burning ground when entering a new ten-day turn', () => {
    const state = createGame('liu', 1);
    state.facilities = {
      tower: { id: 'tower', type: 'arrowTower', forceId: 'cao', q: 12, r: 10, durability: 700, completed: true },
    };
    state.firePlots = [{ q: 12, r: 10, remainingTenDays: 2 }];

    const next = settleTenDay(state);

    expect(next.facilities?.tower?.durability).toBeLessThan(700);
    expect(next.firePlots).toEqual([{ q: 12, r: 10, remainingTenDays: 1 }]);
  });

  it('damages city durability each turn by the number of burning cells among its 7 footprint cells', () => {
    const state = createGame('liu', 1);
    const city = state.cities.jiangling;
    const before = city.durability;
    // 城池中心 + 周围一圈共 7 格，将其中 3 格点燃（中心 + 两个邻居）
    state.firePlots = [
      { q: city.gridQ, r: city.gridR, remainingTenDays: 2 },
      { q: city.gridQ + 1, r: city.gridR, remainingTenDays: 2 },
      { q: city.gridQ, r: city.gridR + 1, remainingTenDays: 2 },
    ];

    const next = settleTenDay(state);

    // 火焰伤害 150×3 之后，本旬据点耐久自然回复 ceil(maxDurability×1%)（工兵科技前为 1 倍）
    expect(next.cities.jiangling.durability).toBe(before - 150 * 3 + Math.ceil(city.maxDurability * 0.01));
    expect(next.cities.jiangling.durability).toBeGreaterThan(0);
  });

  it('does not capture a city when on-going fire reduces durability to zero (needs a finishing strike)', () => {
    const state = createGame('liu', 1);
    const city = state.cities.jiangling;
    city.durability = 150; // 一次余火灼烧恰好归零
    state.firePlots = [{ q: city.gridQ, r: city.gridR, remainingTenDays: 2 }];
    const owner = city.ownerId;

    const next = settleTenDay(state);

    // 余火把耐久打到 0 后，本旬据点耐久自然回复 ceil(maxDurability×1%)：归零是当旬内的瞬时状态
    expect(next.cities.jiangling.durability).toBe(Math.ceil(city.maxDurability * 0.01));
    expect(next.cities.jiangling.ownerId).toBe(owner); // 持续火烧至 0 不算攻破
  });

  it('does not damage a city when there are no burning cells within its 7 footprint cells', () => {
    const state = createGame('liu', 1);
    const city = state.cities.jiangling;
    const before = city.durability;
    state.firePlots = [{ q: city.gridQ + 3, r: city.gridR + 2, remainingTenDays: 2 }];

    const next = settleTenDay(state);

    expect(next.cities.jiangling.durability).toBe(before);
  });

  it('damages city development plots standing on burning ground and clears the plot at zero durability', () => {
    const state = createGame('liu', 1);
    const city = state.cities.jiangling;
    city.plots = [
      { id: 'p-market', type: 'market', level: 2, value: 0, q: 12, r: 10, durability: 500 },
      // 该地格未着火，耐久不变
      { id: 'p-farm', type: 'farm', level: 1, value: 0, q: 13, r: 10, durability: 500 },
    ];
    state.firePlots = [{ q: 12, r: 10, remainingTenDays: 2 }];

    const next = settleTenDay(state);

    // 着火地格掉 150 后，本旬设施耐久自然回复 ceil(500×2%)（工兵科技前为 1 倍）
    expect(next.cities.jiangling.plots![0].durability).toBe(500 - 150 + Math.ceil(500 * 0.02));
    expect(next.cities.jiangling.plots![0].type).toBe('market');
    expect(next.cities.jiangling.plots![1]).toMatchObject({ type: 'farm', durability: 500 });
  });

  it('destroys a city development plot when fire reduces its durability to zero', () => {
    const state = createGame('liu', 1);
    state.cities.jiangling.plots = [
      { id: 'p-low', type: 'market', level: 3, value: 0, q: 12, r: 10, durability: 100 },
    ];
    state.firePlots = [{ q: 12, r: 10, remainingTenDays: 2 }];

    const next = settleTenDay(state);

    // 地格被烧毁后变为空地：空地无设施可修，不参与每旬耐久自然回复，durability 保持 0（已毁状态）
    expect(next.cities.jiangling.plots![0]).toMatchObject({ type: 'empty', level: 0, value: 0, durability: 0 });
  });

  it('fires only the current player force arrow tower when entering a new ten-day turn', () => {
    const state = createGame('liu', 1);
    state.officers['liu-bei'].skill = '乐奏';
    state.officers['guan-yu'].skill = '乐奏';
    state.officers['cao-ren'].skill = '乐奏';
    state.officers['liu-bei'].location = { kind: 'unit', unitId: 'liu-target' };
    state.officers['guan-yu'].location = { kind: 'unit', unitId: 'liu-target' };
    state.officers['cao-ren'].location = { kind: 'unit', unitId: 'cao-target' };
    state.units['liu-target'] = {
      id: 'liu-target',
      kind: 'combat',
      forceId: 'liu',
      leaderId: 'guan-yu',
      officerIds: ['guan-yu', 'liu-bei'],
      homeCityId: 'jiangling',
      troopType: 'sword',
      q: 12,
      r: 10,
      troops: 3000,
      food: 3000,
      energy: 80,
      movementRemaining: 5,
      moved: false,
      acted: false,
    };
    state.units['cao-target'] = {
      id: 'cao-target',
      kind: 'combat',
      forceId: 'cao',
      leaderId: 'cao-ren',
      officerIds: ['cao-ren'],
      homeCityId: 'xiangyang',
      troopType: 'sword',
      q: 4,
      r: 4,
      troops: 3000,
      food: 3000,
      energy: 80,
      movementRemaining: 5,
      moved: false,
      acted: false,
    };
    state.facilities = {
      liuArrow: { id: 'liuArrow', type: 'arrowTower', forceId: 'liu', q: 2, r: 4, durability: 700 },
      caoArrow: { id: 'caoArrow', type: 'arrowTower', forceId: 'cao', q: 10, r: 10, durability: 700 },
    };

    const next = settleTenDay(state);

    expect(next.units['cao-target'].troops).toBe(2700);
    expect(next.units['liu-target'].troops).toBe(3000);
    expect(next.units['liu-target'].energy).toBe(90);
    expect(next.units['cao-target'].energy).toBe(85);
    expect((next.battleDamageReports ?? []).map((report) => report.unitId)).toEqual(['cao-target']);
  });

  it('completes special armament production after the calculated ten-days', () => {
    const state = createGame('liu', 1);
    // 冲车生产需工房
    state.cities.jiangling.plots = [
      { ...(state.cities.jiangling.plots?.[0] ?? {}), id: 'test-smithy', type: 'smithy', level: 1, value: 0, constructing: undefined },
      ...(state.cities.jiangling.plots ?? []).slice(1),
    ];
    const currentRams = state.cities.jiangling.armaments?.ram ?? 0;
    const producing = executeCommand(state, 'liu', {
      type: 'produceArmament', cityId: 'jiangling', officerIds: ['liu-bei'], armamentType: 'ram',
    });

    // 工期 = ⌈⌈(220 − 综合智力) ÷ 12⌉ × 10 ÷ 10⌉ 旬（刘备智力78 → 12旬）
    const tenDays = armamentProductionTenDays([producing.officers['liu-bei']]);
    let settled = producing;
    for (let i = 1; i < tenDays; i += 1) {
      settled = settleTenDay(settled);
      expect(settled.cities.jiangling.armaments?.ram).toBe(currentRams);
      expect(settled.officers['liu-bei'].location.kind).toBe('task');
    }

    const completed = settleTenDay(settled);
    expect(completed.cities.jiangling.armaments?.ram).toBe(currentRams + 2);
    expect(completed.officers['liu-bei'].location).toEqual({ kind: 'city', cityId: 'jiangling' });
    expect(completed.officers['liu-bei'].acted).toBe(false);
  });

  it('never lets city food become negative during supply consumption', () => {
    const state = createGame('liu', 1);
    state.tenDay = 1;
    state.cities.jiangling.troops = 15000;
    state.cities.jiangling.food = 100;

    const next = settleTenDay(state);

    expect(next.cities.jiangling.food).toBe(0);
  });

  it('restores action points each ten-day and carries over half of the unused points', () => {
    const state = createGame('liu', 1);
    state.tenDay = 1;
    state.actionPoints.liu = 60;

    const next = settleTenDay(state);

    expect(next.tenDay).toBe(2);
    expect(next.actionPoints.liu).toBe(110);
  });

  it('carries action points across the month boundary into the next first ten-day', () => {
    const state = createGame('liu', 1);
    state.month = 1;
    state.tenDay = 3;
    state.actionPoints.liu = 40;

    const next = settleTenDay(state);

    expect(next.month).toBe(2);
    expect(next.tenDay).toBe(1);
    expect(next.actionPoints.liu).toBe(100);
  });

  it('advances personnel transfers and arrives after the required ten-days', () => {
    const state = createGame('liu', 1);
    const transferred = executeCommand(state, 'liu', {
      type: 'transfer', cityId: 'jiangling', targetCityId: 'wuling', officerIds: ['guan-yu'],
    });

    const afterOne = settleTenDay(transferred);
    const afterTwo = settleTenDay(afterOne);
    const afterThree = settleTenDay(afterTwo);
    const afterFour = settleTenDay(afterThree);

    expect(afterOne.officers['guan-yu'].location).toMatchObject({ kind: 'transfer', remainingTenDays: 3 });
    expect(afterTwo.officers['guan-yu'].location).toMatchObject({ kind: 'transfer', remainingTenDays: 2 });
    expect(afterThree.officers['guan-yu'].location).toMatchObject({ kind: 'transfer', remainingTenDays: 1 });
    expect(afterFour.officers['guan-yu'].location).toEqual({ kind: 'city', cityId: 'wuling' });
    expect(afterFour.officers['guan-yu'].cityId).toBe('wuling');
    expect(afterFour.logs.some((log) => log.message.includes('关羽抵达武陵'))).toBe(true);
  });

  it('keeps transferring officers marked as acted until they arrive', () => {
    const state = createGame('liu', 1);
    const transferred = executeCommand(state, 'liu', {
      type: 'transfer', cityId: 'jiangling', targetCityId: 'wuling', officerIds: ['guan-yu'],
    });
    expect(transferred.officers['guan-yu'].acted).toBe(true);

    // 途中每旬都保持「已行动」：人不在任何据点，本旬本就下不了命令
    const afterOne = settleTenDay(transferred);
    const afterTwo = settleTenDay(afterOne);
    const afterThree = settleTenDay(afterTwo);
    expect(afterOne.officers['guan-yu'].acted).toBe(true);
    expect(afterTwo.officers['guan-yu'].acted).toBe(true);
    expect(afterThree.officers['guan-yu'].acted).toBe(true);

    // 抵达当旬即可行动（settleOfficerTransfers 释放为 city 并置回 false）
    const afterFour = settleTenDay(afterThree);
    expect(afterFour.officers['guan-yu'].location).toEqual({ kind: 'city', cityId: 'wuling' });
    expect(afterFour.officers['guan-yu'].acted).toBe(false);

    // 同城的待命武将不受影响，照常每旬重置
    expect(afterOne.officers['liu-bei'].acted).toBe(false);
  });

  it('keeps officers on a multi-ten-day task marked as acted while the task runs', () => {
    const state = createGame('liu', 1);
    state.officers['guan-yu'].location = {
      kind: 'task', cityId: 'jiangling', task: 'armament', armamentType: 'ram', amount: 2, remainingTenDays: 3,
    };
    state.officers['guan-yu'].acted = true;

    const afterOne = settleTenDay(state);
    const afterTwo = settleTenDay(afterOne);
    expect(afterOne.officers['guan-yu'].acted).toBe(true);
    expect(afterTwo.officers['guan-yu'].acted).toBe(true);

    // 任务完成那一旬释放回城，即可再次下令
    const afterThree = settleTenDay(afterTwo);
    expect(afterThree.officers['guan-yu'].location).toEqual({ kind: 'city', cityId: 'jiangling' });
    expect(afterThree.officers['guan-yu'].acted).toBe(false);
  });

  it('completes tech research and unlocks the researched node', () => {
    const state = createGame('liu', 1);
    state.forces.liu.techNodes = ['zhiyehua'];
    state.officers['liu-bei'].location = {
      kind: 'task', cityId: 'jiangling', task: 'research', nodeId: 'qiangshuxunlian', remainingTenDays: 1,
    };

    const next = settleTenDay(state);

    expect(next.forces.liu.techNodes).toContain('qiangshuxunlian');
    expect(next.officers['liu-bei'].location).toEqual({ kind: 'city', cityId: 'jiangling' });
    expect(next.officers['liu-bei'].acted).toBe(false);
    expect(next.logs.some((log) => log.message.includes('「枪术训练」研究'))).toBe(true);
  });

  it('keeps a mid-progress research task running across ten-days', () => {
    const state = createGame('liu', 1);
    state.officers['liu-bei'].location = {
      kind: 'task', cityId: 'jiangling', task: 'research', nodeId: 'gonggongjiaoyu', remainingTenDays: 3,
    };

    const next = settleTenDay(state);

    expect(next.officers['liu-bei'].location).toMatchObject({ kind: 'task', remainingTenDays: 2 });
    expect(next.forces.liu.techNodes ?? []).not.toContain('gonggongjiaoyu');
  });

  it('accumulates techP from city population each ten-day', () => {
    const state = createGame('liu', 1);
    state.forces.liu.techP = 0;
    // techP = Σ round((floor(城市人口/3000) + floor(农村人口/12000)) × 学术系数)（学术城×1.5）
    const expected = Object.values(state.cities)
      .filter((c) => c.ownerId === 'liu')
      .reduce((sum, c) => {
        const urban = c.cityPopulation ?? Math.round(c.population * (c.population <= 250000 ? 0.15 : c.population < 500000 ? 0.175 : 0.2));
        const rural = c.ruralPopulation ?? Math.max(0, c.population - urban);
        const academicMultiplier = hasCityTrait(c.id, 'academy') ? 1.5 : 1;
        return sum + Math.round((Math.floor(urban / 3000) + Math.floor(rural / 12000)) * academicMultiplier);
      }, 0);

    const next = settleTenDay(state);

    expect(next.forces.liu.techP).toBe(state.forces.liu.techP + expected);
  });

  it('regenerates unit energy beyond 100 up to the 职业化 cap', () => {
    const state = createGame('liu', 1);
    // 职业化（军制1级）：部队最大士气（气力上限）＋20 → 120；每旬固定回复5
    state.forces.liu.techNodes = ['zhiyehua'];
    state.units['energy-tech-unit'] = {
      id: 'energy-tech-unit',
      kind: 'combat',
      forceId: 'liu',
      leaderId: 'liu-bei',
      homeCityId: 'jiangling',
      troopType: 'sword',
      q: 12,
      r: 10,
      troops: 3000,
      food: 3000,
      energy: 105,
      movementRemaining: 5,
      moved: false,
      acted: false,
    };

    const next = settleTenDay(state);

    // 每旬回复5，气力上限120：105 + 5 = 110
    expect(next.units['energy-tech-unit'].energy).toBe(110);
  });

  it('公共教育（文教1级）承接原「内政4级治安回升」：换季治安下降概率减半', () => {
    const state = createGame('liu', 1);
    state.forces.liu.techNodes = ['gonggongjiaoyu'];
    expect(orderDropResist(state, 'liu')).toBe(true);

    // 旧树「内政4级每旬治安+2」已随科技树重做删除：旬末结算不再无条件回升治安
    const startOrder = state.cities.jiangling.order;
    const next = settleTenDay(state);

    expect(next.cities.jiangling.order).toBe(startOrder);
  });

  it('completes ability research after its months and lets cultivation raise an officer', () => {
    let next = executeCommand(createGame('liu', 1), 'liu', {
      type: 'abilityResearch', cityId: 'jiangling', nodeId: 'warLow',
    });

    // warLow 耗时1个月：月结后研究完成并解锁5次培育
    next = settleMonth(next);
    expect(next.forces.liu.abilityResearch?.researched).toContain('warLow');
    expect(next.forces.liu.abilityResearch?.remaining.warLow).toBe(5);
    expect(next.forces.liu.abilityResearch?.active).toBeUndefined();

    // 培育简雍（武力24），耗时3旬（30日）
    const warBefore = next.officers['jian-yong'].stats.war;
    next = executeCommand(next, 'liu', {
      type: 'cultivate', cityId: 'jiangling', officerId: 'jian-yong', nodeId: 'warLow',
    });
    expect(next.officers['jian-yong'].location).toMatchObject({
      kind: 'task', task: 'cultivate', nodeId: 'warLow', remainingTenDays: 3,
    });

    next = settleTenDay(next);
    next = settleTenDay(next);
    next = settleTenDay(next);
    expect(next.officers['jian-yong'].stats.war).toBe(warBefore + 5);
    expect(next.forces.liu.abilityResearch?.remaining.warLow).toBe(4);
    expect(next.officers['jian-yong'].location.kind).toBe('city');
  });

  it('grants a learned skill to an officer after cultivating a researched skill node', () => {
    const state = createGame('liu', 1);
    state.forces.liu.abilityResearch = { researched: ['sk-lianji'], remaining: { 'sk-lianji': 3 } };

    let next = executeCommand(state, 'liu', {
      type: 'cultivate', cityId: 'jiangling', officerId: 'jian-yong', nodeId: 'sk-lianji',
    });
    expect(next.officers['jian-yong'].skill).not.toBe('连击');

    next = settleTenDay(next);
    next = settleTenDay(next);
    next = settleTenDay(next);

    expect(next.officers['jian-yong'].learnedSkills).toContain('连击');
    expect(next.officers['jian-yong'].skill).toBe('论客');
    expect(next.forces.liu.abilityResearch?.remaining['sk-lianji']).toBe(2);
    expect(next.officers['jian-yong'].location.kind).toBe('city');
  });
});

describe('跨城登庸旬结算', () => {
  /** 在指定城池注入在野武将（可选喜/恶，决定抵达当旬的登庸判定） */
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

  function journeyLocOf(state: GameState, officerId: string): Extract<Officer['location'], { kind: 'recruitJourney' }> {
    const location = state.officers[officerId].location;
    if (location.kind !== 'recruitJourney') throw new Error('武将不在登庸差旅中');
    return location;
  }

  /** 曹操（宛）→ 汉中（无主城）跨城登庸的起点状态：目标城不属任何势力，符合默认登庸口径 */
  function startJourney(opts?: { likes?: string[]; hates?: string[] }) {
    const state = createGame('cao', 42);
    const target = injectFieldOfficer(state, 'hanzhong', opts);
    const travel = Math.max(1, strongholdTransferDuration(state, state.cities.wan, state.cities.hanzhong));
    const next = executeCommand(state, 'cao', {
      type: 'talent', cityId: 'wan', officerId: 'cao-cao', targetOfficerId: target.id,
    } as never);
    return { next, target, travel };
  }

  it('去程推进→抵达即允（亲善君主）：目标随行返程，两人按时同城归队', () => {
    const { next: journey } = startJourney({ likes: ['cao-cao'] });
    let state = journey;
    const targetId = 'field-hanzhong';
    const techPBefore = state.forces.cao.techP ?? 0;

    // 把去程压在最后一旬，一旬后抵达结算
    journeyLocOf(state, 'cao-cao').remainingTenDays = 1;
    state = settleTenDay(state);

    // 抵达即允：目标换主、两人一同转入返程（技P +150）
    expect(state.officers[targetId].forceId).toBe('cao');
    expect(state.officers[targetId].location).toMatchObject({ kind: 'recruitJourney', phase: 'return' });
    expect(state.officers['cao-cao'].location).toMatchObject({ kind: 'recruitJourney', phase: 'return' });
    expect(journeyLocOf(state, targetId).fromCityId).toBe('wan');
    // 同旬结算里其它系统（月度收入等）也可能入账技巧P，这里只断言登庸部分 ≥ +150
    expect(state.forces.cao.techP).toBeGreaterThanOrEqual(techPBefore + 150);

    // 返程在途逐旬推进（若行程大于 1 旬，两人剩余旬数始终同步）
    const tramp = journeyLocOf(state, 'cao-cao');
    if (tramp.remainingTenDays > 1) {
      const next = settleTenDay(state);
      expect(journeyLocOf(next, 'cao-cao').remainingTenDays).toBe(tramp.remainingTenDays - 1);
      expect(state.officers[targetId].location).toMatchObject({ kind: 'recruitJourney', remainingTenDays: tramp.remainingTenDays - 1 });
    }

    // 返程到点：双双回到出发城（宛），恢复待命
    journeyLocOf(state, 'cao-cao').remainingTenDays = 1;
    state.officers[targetId].location = { kind: 'recruitJourney', fromCityId: 'wan', targetCityId: 'hanzhong', targetOfficerId: targetId, remainingTenDays: 1, returnTenDays: 1, phase: 'return' };
    state = settleTenDay(state);
    expect(state.officers['cao-cao'].location).toEqual({ kind: 'city', cityId: 'wan' });
    expect(state.officers['cao-cao'].cityId).toBe('wan');
    expect(state.officers[targetId].location).toEqual({ kind: 'city', cityId: 'wan' });
    expect(state.officers[targetId].cityId).toBe('wan');
  });

  it('抵达被拒：执行武将只身返程，目标依然在野', () => {
    let state = startJourney({ hates: ['cao-cao'] }).next;
    const targetId = 'field-hanzhong';
    journeyLocOf(state, 'cao-cao').remainingTenDays = 1;
    state = settleTenDay(state);

    expect(state.officers[targetId].forceId).toBeNull();
    expect(state.officers['cao-cao'].location).toMatchObject({ kind: 'recruitJourney', phase: 'return' });

    journeyLocOf(state, 'cao-cao').remainingTenDays = 1;
    state = settleTenDay(state);
    expect(state.officers['cao-cao'].location).toEqual({ kind: 'city', cityId: 'wan' });
    expect(state.officers[targetId].forceId).toBeNull();
  });

  it('抵达可舌战：要么挂起抉择等待玩家，要么直接按意愿掷点结算返程', () => {
    let state = startJourney().next;
    journeyLocOf(state, 'cao-cao').remainingTenDays = 1;
    state = settleTenDay(state);

    const loc = journeyLocOf(state, 'cao-cao');
    if (state.pendingRecruitDebate?.recruiterId === 'cao-cao') {
      // 挂起抉择：去程 remaining=0 保持不动，等待玩家 accept/reject
      expect(state.debateSession?.status).toBeUndefined();
      expect(loc).toMatchObject({ phase: 'outbound', remainingTenDays: 0 });
      // 等待期间旬推进不动程（不再重复结算抵达）
      const stalled = settleTenDay(state);
      expect(stalled.pendingRecruitDebate?.recruiterId).toBe('cao-cao');
      expect(journeyLocOf(stalled, 'cao-cao').remainingTenDays).toBe(0);
    } else {
      // 未触发舌战：按意愿成功率直接判成败，执行武将至少进入返程
      expect(loc.phase).toBe('return');
    }
  });

  it('舌战占优：目标应允后随执行武将同行归来', () => {
    let state = startJourney().next;
    const targetId = 'field-hanzhong';
    journeyLocOf(state, 'cao-cao').remainingTenDays = 0;
    state.pendingRecruitDebate = { recruiterId: 'cao-cao', targetId };
    const techPBefore = state.forces.cao.techP ?? 0;

    state = executeCommand(state, 'cao', { type: 'acceptRecruitDebate', cityId: 'wan', officerId: 'cao-cao', targetOfficerId: targetId } as never);
    expect(state.debateSession?.status).toBe('ongoing');

    // 直接裁定我方获胜：目标同程返程、归城后正式归队
    state.debateSession!.p2.hp = 0;
    state.debateSession!.p2.cards = state.debateSession!.p2.cards.filter((card) => card.type === 'topic');
    state = resolveDebateRound(state, state.debateSession!.p1.cards[0].uid);
    expect(state.debateSession?.winner).toBe('recruiter');
    expect(state.forces.cao.techP).toBe(techPBefore + 150);

    expect(state.officers[targetId].forceId).toBe('cao');
    expect(state.officers[targetId].location).toMatchObject({ kind: 'recruitJourney', phase: 'return' });
    expect(state.officers['cao-cao'].location).toMatchObject({ kind: 'recruitJourney', phase: 'return' });

    journeyLocOf(state, 'cao-cao').remainingTenDays = 1;
    journeyLocOf(state, targetId).remainingTenDays = 1;
    state = settleTenDay(state);
    expect(state.officers[targetId].location).toEqual({ kind: 'city', cityId: 'wan' });
    expect(state.officers[targetId].cityId).toBe('wan');
  });

  it('舌战失利：目标禁仕 3 个月，执行武将只身返回', () => {
    let state = startJourney().next;
    const targetId = 'field-hanzhong';
    journeyLocOf(state, 'cao-cao').remainingTenDays = 0;
    state.pendingRecruitDebate = { recruiterId: 'cao-cao', targetId };

    state = executeCommand(state, 'cao', { type: 'acceptRecruitDebate', cityId: 'wan', officerId: 'cao-cao', targetOfficerId: targetId } as never);
    state = resolveDebateAbandon(state);
    expect(state.debateSession?.winner).toBe('target');

    expect(state.officers[targetId].forceId).toBeNull();
    expect(state.officers[targetId].bannedUntilMonth).toBeGreaterThan(state.month);
    expect(state.officers['cao-cao'].location).toMatchObject({ kind: 'recruitJourney', phase: 'return' });

    journeyLocOf(state, 'cao-cao').remainingTenDays = 1;
    state = settleTenDay(state);
    expect(state.officers['cao-cao'].location).toEqual({ kind: 'city', cityId: 'wan' });
    expect(state.officers[targetId].forceId).toBeNull();
  });
});
