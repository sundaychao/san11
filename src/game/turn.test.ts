import { describe, expect, it } from 'vitest';
import { executeCommand } from './commands';
import { createGame } from './scenario/jingxiang208';
import { resolveCitySkills } from './skills/sources';
import { settleMonth, settleTenDay } from './turn';

describe('monthly settlement', () => {
  it('settles monthly gold and restores monthly actions without monthly food income', () => {
    const state = createGame('liu', 4394);
    state.actionPoints.liu = 0;
    state.officers['liu-bei'].acted = true;
    const before = state.cities.jiangling;
    const expectedGold = before.gold + Math.round(before.commerce * 20 + before.population / 100);

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
    const expectedFood = before.food + Math.round(before.agriculture * 60 + before.population / 40);

    const next = settleMonth(state);

    expect(next.month).toBe(4);
    expect(next.cities.jiangling.food).toBe(expectedFood);
  });

  it('multiplies generated city income once and stops after the resident transfers', () => {
    const state = createGame('sun', 4394);
    state.officers['lu-su'].skill = '富豪';
    const city = state.cities.changsha;
    const baseGold = city.commerce * 20 + city.population / 100;
    const first = settleMonth(state);

    expect(first.cities.changsha.gold).toBe(city.gold + Math.round(baseGold * 1.5));

    state.officers['lu-su'].location = {
      kind: 'transfer', fromCityId: 'changsha', targetCityId: 'jiangxia', remainingTenDays: 1,
    };
    const second = settleMonth(state);
    expect(second.cities.changsha.gold).toBe(city.gold + baseGold);
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
    const baseFood = city.agriculture * 60 + city.population / 40;
    const next = settleMonth(state);

    expect(next.cities.changsha.food).toBe(city.food + Math.round(baseFood * 1.5));
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

    expect(next.cities.changsha.gold).toBe(city.gold + Math.round((1 * 20 + 151 / 100) * 1.5));
  });

  it('rounds skilled quarterly food income only after applying the multiplier', () => {
    const state = createGame('sun', 4394);
    state.month = 3;
    state.officers['lu-su'].skill = '米道';
    const city = state.cities.changsha;
    city.agriculture = 1;
    city.population = 61;

    const next = settleMonth(state);

    expect(next.cities.changsha.food).toBe(city.food + Math.round((1 * 60 + 61 / 40) * 1.5));
  });

  it('preserves unskilled settlement values and RNG results for the same seed', () => {
    const state = createGame('liu', 20804);
    for (const officer of Object.values(state.officers)) officer.skill = undefined;

    const next = settleMonth(state);

    expect(next.rngCursor).toBe(9);
    expect(next.logs.slice(-2)).toEqual([
      { id: 'event-1-lingling-8', month: 1, forceId: 'biao', message: '零陵发生丰收' },
      { id: 'month-2', month: 2, forceId: null, message: '进入建安十三年后的第2个月。' },
    ]);
    expect(next.cities.changsha).toMatchObject({
      gold: 9280, food: 36000, population: 98401, order: 82, troops: 13200,
    });
    expect(next.cities.lingling).toMatchObject({
      gold: 10280, food: 38000, population: 82369, order: 90, troops: 11000,
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
    const cityFoodAfterSupply = city.food - Math.ceil((city.troops * 500) / 10000);
    const baseQuarterlyFood = city.agriculture * 60 + city.population / 40;
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
    expect(next.cities.changsha.food).toBe(cityFoodAfterSupply + Math.round(baseQuarterlyFood * 1.5));
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

    expect(next.cities.jiangling.food).toBe(9500);
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

  it('completes special armament production after one month', () => {
    const state = createGame('liu', 1);
    const currentRams = state.cities.jiangling.armaments?.ram ?? 0;
    const producing = executeCommand(state, 'liu', {
      type: 'produceArmament', cityId: 'jiangling', officerId: 'liu-bei', armamentType: 'ram',
    });

    const afterOne = settleTenDay(producing);
    const afterTwo = settleTenDay(afterOne);
    const afterThree = settleTenDay(afterTwo);

    expect(afterOne.cities.jiangling.armaments?.ram).toBe(currentRams);
    expect(afterTwo.cities.jiangling.armaments?.ram).toBe(currentRams);
    expect(afterThree.cities.jiangling.armaments?.ram).toBe(currentRams + 2);
    expect(afterThree.officers['liu-bei'].location).toEqual({ kind: 'city', cityId: 'jiangling' });
    expect(afterThree.officers['liu-bei'].acted).toBe(false);
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

    expect(afterOne.officers['guan-yu'].location).toMatchObject({ kind: 'transfer', remainingTenDays: 2 });
    expect(afterTwo.officers['guan-yu'].location).toMatchObject({ kind: 'transfer', remainingTenDays: 1 });
    expect(afterThree.officers['guan-yu'].location).toEqual({ kind: 'city', cityId: 'wuling' });
    expect(afterThree.officers['guan-yu'].cityId).toBe('wuling');
    expect(afterThree.logs.some((log) => log.message.includes('关羽抵达武陵'))).toBe(true);
  });
});
