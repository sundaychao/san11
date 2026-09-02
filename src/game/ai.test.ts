import { describe, expect, it } from 'vitest';
import { validateCommand } from './commands';
import { chooseAiCommand, runAiTurn } from './ai';
import { createGame } from './scenario/jingxiang208';

describe('AI turn', () => {
  it('prioritizes patrol when public order is below 60', () => {
    const state = createGame('liu', 1);
    state.cities.jiangling.order = 40;

    expect(chooseAiCommand(state, 'liu')?.type).toBe('patrol');
  });

  it('only chooses a legal command', () => {
    const state = createGame('liu', 1);
    const command = chooseAiCommand(state, 'liu');

    expect(command).not.toBeNull();
    expect(validateCommand(state, 'liu', command!)).toEqual([]);
  });

  it('runs several legal actions without exhausting below zero', () => {
    const state = createGame('liu', 1);

    const next = runAiTurn(state, 'liu');

    expect(next.actionPoints.liu).toBeGreaterThanOrEqual(0);
    expect(next.actionPoints.liu).toBeLessThan(80);
    expect(next.logs.length).toBeGreaterThan(state.logs.length);
    expect(state.actionPoints.liu).toBe(80);
  });

  it('returns only force-level ability research when no officer can act', () => {
    const state = createGame('liu', 1);
    for (const officer of Object.values(state.officers)) {
      if (officer.forceId === 'liu') officer.acted = true;
    }

    // 所有武将已行动时，只有无需武将的势力级「能力研究」可能发起
    const command = chooseAiCommand(state, 'liu');
    expect(command === null || command.type === 'abilityResearch').toBe(true);
  });

  it('falls back to facility development when no other action is available', () => {
    const state = createGame('liu', 77);
    for (const city of Object.values(state.cities)) {
      if (city.ownerId === 'liu') {
        city.order = 80;
        city.food = 99999;
        // 3100：避开商业开发(<3000)、流言(>=RUMOR_GOLD_COST+3000)、外交(>=5000)
        city.gold = 3100;
        city.training = 100;
        city.population = 0;
      }
    }
    for (const officer of Object.values(state.officers)) {
      if (officer.forceId === null && ['jiangling', 'wuling'].includes(officer.cityId)) officer.forceId = 'cao';
    }
    // 规避科技/能力/探索/军师等新AI命令，确保走到加权随机开发回退路径
    state.forces.liu.techP = 0;
    state.forces.liu.abilityResearch = { researched: [], remaining: {}, active: { nodeId: 'war-5-low', remainingMonths: 1 } };
    state.forces.liu.strategistId = 'zhu-ge-liang';
    state.treasures = {};

    const next = runAiTurn(state, 'liu');

    // 内政发展命令已移除：AI 回退到开发建设（兵舍/锻冶等设施），消息含「建设」
    expect(next.rngCursor).toBeGreaterThanOrEqual(state.rngCursor);
    expect(next.logs.some((log) => log.message.includes('建设'))).toBe(true);
  });
});
