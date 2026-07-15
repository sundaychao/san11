import { describe, expect, it } from 'vitest';
import { executeCommand, transferDuration, validateCommand } from './commands';
import { createGame } from './scenario/jingxiang208';

describe('command engine', () => {
  it('develops commerce and consumes resources and officer action', () => {
    const state = createGame('liu', 1);
    const next = executeCommand(state, 'liu', {
      type: 'develop', cityId: 'jiangling', officerId: 'liu-bei', focus: 'commerce',
    });

    expect(next.cities.jiangling.commerce).toBe(state.cities.jiangling.commerce + 8);
    expect(next.cities.jiangling.gold).toBe(state.cities.jiangling.gold - 500);
    expect(next.actionPoints.liu).toBe(60);
    expect(next.officers['liu-bei'].acted).toBe(true);
    expect(state.officers['liu-bei'].acted).toBe(false);
  });

  it('caps developed values at 100', () => {
    const state = createGame('liu', 1);
    state.cities.jiangling.agriculture = 99;

    const next = executeCommand(state, 'liu', {
      type: 'develop', cityId: 'jiangling', officerId: 'liu-bei', focus: 'agriculture',
    });

    expect(next.cities.jiangling.agriculture).toBe(100);
  });

  it('returns specific validation messages without mutating state', () => {
    const state = createGame('liu', 1);
    state.cities.jiangling.gold = 100;

    const errors = validateCommand(state, 'liu', {
      type: 'develop', cityId: 'jiangling', officerId: 'liu-bei', focus: 'commerce',
    });

    expect(errors).toContain('资金不足 500');
    expect(state.cities.jiangling.gold).toBe(100);
  });

  it('recruits troops with population, food, gold, and order costs', () => {
    const state = createGame('liu', 1);
    const next = executeCommand(state, 'liu', {
      type: 'recruit', cityId: 'jiangling', officerId: 'liu-bei',
    });

    expect(next.cities.jiangling.troops).toBe(state.cities.jiangling.troops + 1290);
    expect(next.cities.jiangling.population).toBe(state.cities.jiangling.population - 500);
    expect(next.cities.jiangling.food).toBe(state.cities.jiangling.food - 500);
    expect(next.cities.jiangling.gold).toBe(state.cities.jiangling.gold - 800);
    expect(next.cities.jiangling.order).toBe(state.cities.jiangling.order - 2);
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
    expect(next.cities.jiangling.gold).toBe(state.cities.jiangling.gold - 300);
  });

  it('finds a local talent with a successful seeded roll', () => {
    const state = createGame('liu', 1);
    const next = executeCommand(state, 'liu', {
      type: 'talent', cityId: 'jiangling', officerId: 'liu-bei',
    });

    expect(next.officers['zhao-yun'].forceId).toBe('liu');
    expect(next.rngCursor).toBe(1);
    expect(next.logs.at(-1)?.message).toContain('赵云');
  });

  it('logs a failed talent search from an unsuccessful seeded roll', () => {
    const state = createGame('liu', 14336);
    const next = executeCommand(state, 'liu', {
      type: 'talent', cityId: 'jiangling', officerId: 'liu-bei',
    });

    expect(next.officers['zhao-yun'].forceId).toBeNull();
    expect(next.rngCursor).toBe(1);
    expect(next.logs.at(-1)?.message).toContain('未能登用');
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
});
