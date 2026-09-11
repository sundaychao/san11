import { describe, expect, it } from 'vitest';
import { createGame } from '../scenario/jingxiang208';
import { deployTransportUnit, deployUnit } from './deployment';
import { deploymentCellsForStronghold } from './movementRules';
import { allCityKeys } from './movementRules';
import { allPassAnchorKeys } from './movementRules';

/** 把武关设为本方据点并把刘备驻进关内，返回可断言的初始状态 */
function setupPassWithOfficer() {
  const state = createGame('liu', 1);
  const pass = state.passes!.wuguan;
  pass.ownerId = 'liu';
  pass.troops = 6000;
  pass.gold = 2000;
  pass.food = 20000;
  pass.armaments = { spear: 4000, halberd: 4000, crossbow: 4000, cavalry: 4000, ram: 2, tower: 2, ship: 2 };
  const officer = state.officers['liu-bei'];
  officer.location = { kind: 'pass', passId: 'wuguan' };
  officer.acted = false;
  return { state, pass };
}

function firstSpawnCell(state: ReturnType<typeof createGame>, passId: 'wuguan') {
  const cells = deploymentCellsForStronghold(state, passId, 20, 'sword');
  expect(cells.length).toBeGreaterThan(0);
  return cells[0];
}

describe('deploymentCellsForStronghold（关隘部署格）', () => {
  it('关隘从锚点出发产生部署格，不含城池格/关隘锚点/翼格', () => {
    const { state } = setupPassWithOfficer();
    const cells = deploymentCellsForStronghold(state, 'wuguan', 20, 'sword');
    expect(cells.length).toBeGreaterThan(0);
    const excluded = new Set([...allCityKeys(state), ...allPassAnchorKeys(state)]);
    for (const cell of cells) {
      expect(excluded.has(`${cell.q},${cell.r}`)).toBe(false);
    }
  });

  it('城池部署格行为不变（回归保护）', () => {
    const state = createGame('liu', 1);
    const cells = deploymentCellsForStronghold(state, 'jiangling', 20, 'sword');
    expect(cells.length).toBeGreaterThan(0);
  });
});

describe('关隘出征（deployUnit）', () => {
  it('从本方关隘出阵：扣资源兵装、武将上部队、日志提及关名', () => {
    const { state, pass } = setupPassWithOfficer();
    const spawn = firstSpawnCell(state, 'wuguan');

    const next = deployUnit(state, 'liu', {
      passId: 'wuguan',
      officerIds: ['liu-bei'],
      troopType: 'spear',
      troops: 3000,
      gold: 500,
      food: 4000,
      destination: spawn,
    });

    const unit = Object.values(next.units).find((candidate) => candidate.leaderId === 'liu-bei')!;
    expect(unit).toBeDefined();
    expect(unit.troops).toBe(3000);
    expect(unit.homeCityId).toBe(pass.homeCityId);
    expect(next.officers['liu-bei'].location).toEqual({ kind: 'unit', unitId: unit.id });
    expect(next.passes!.wuguan.troops).toBe(3000);
    expect(next.passes!.wuguan.gold).toBe(1500);
    expect(next.passes!.wuguan.food).toBe(16000);
    expect(next.passes!.wuguan.armaments!.spear).toBe(1000);
    expect(next.logs.some((log) => log.message.includes('武关') && log.message.includes('出征'))).toBe(true);
  });

  it('武将不在关内时拒绝出征', () => {
    const { state } = setupPassWithOfficer();
    state.officers['liu-bei'].location = { kind: 'city', cityId: 'jiangling' };

    expect(() => deployUnit(state, 'liu', {
      passId: 'wuguan',
      officerIds: ['liu-bei'],
      troops: 3000,
      food: 1000,
    })).toThrow('武将不在出征据点');
  });

  it('敌方关隘拒绝出征', () => {
    const { state } = setupPassWithOfficer();
    state.passes!.wuguan.ownerId = 'cao';

    expect(() => deployUnit(state, 'liu', {
      passId: 'wuguan',
      officerIds: ['liu-bei'],
      troops: 3000,
      food: 1000,
    })).toThrow();
  });
});

describe('关隘输送（deployTransportUnit）', () => {
  it('从本方关隘输送物资：扣资源、创建输送部队', () => {
    const { state } = setupPassWithOfficer();
    const spawn = firstSpawnCell(state, 'wuguan');

    const next = deployTransportUnit(state, 'liu', {
      passId: 'wuguan',
      officerId: 'liu-bei',
      troops: 2000,
      gold: 300,
      food: 5000,
      destination: spawn,
    });

    const unit = Object.values(next.units).find((candidate) => candidate.kind === 'transport' && candidate.leaderId === 'liu-bei')!;
    expect(unit).toBeDefined();
    expect(unit.troops).toBe(2000);
    expect(next.passes!.wuguan.troops).toBe(4000);
    expect(next.passes!.wuguan.gold).toBe(1700);
    expect(next.passes!.wuguan.food).toBe(15000);
    expect(next.officers['liu-bei'].location.kind).toBe('unit');
    expect(next.logs.some((log) => log.message.includes('武关') && log.message.includes('输送'))).toBe(true);
  });
});
