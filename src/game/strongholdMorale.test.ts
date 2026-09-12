import { describe, expect, it } from 'vitest';
import { deployUnit } from './battle/deployment';
import { executeCommand } from './commands';
import { loadSave, type SaveAdapter, writeSave } from './persistence';
import { createGame } from './scenario/jingxiang208';
import { moraleCapOf } from './techs';

class MemoryStorage implements SaveAdapter {
  readonly values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
  removeItem(key: string) { this.values.delete(key); }
}

/**
 * 据点士气（City/Pass.training）与部队士气（ArmyUnit.energy）是**同一个资源**：
 * 同一套上限（基础 100，科技「职业化」+20）、出征带入、回城按兵力加权稀释并入。
 * 本文件钉住其中「上限」与「带入」两条，防止有人再把某处硬编码回 100。
 */
describe('据点士气与部队士气同口径', () => {
  it('士气上限：基础 100，研究「职业化」后 120', () => {
    const state = createGame('liu', 1);
    expect(moraleCapOf(state, 'liu')).toBe(100);
    state.forces.liu.techNodes = ['zhiyehua'];
    expect(moraleCapOf(state, 'liu')).toBe(120);
  });

  it('未研究「职业化」时，据点训练封顶 100', () => {
    const state = createGame('liu', 1);
    state.cities.jiangling.training = 98;

    const next = executeCommand(state, 'liu', {
      type: 'train', cityId: 'jiangling', officerIds: ['guan-yu'],
    });

    expect(next.cities.jiangling.training).toBe(100);
  });

  it('研究「职业化」后，城池可训练到 120', () => {
    const state = createGame('liu', 1);
    state.forces.liu.techNodes = ['zhiyehua'];
    state.cities.jiangling.training = 118;

    const next = executeCommand(state, 'liu', {
      type: 'train', cityId: 'jiangling', officerIds: ['guan-yu'],
    });

    expect(next.cities.jiangling.training).toBe(120);
  });

  it('关卡训练同样按士气上限收口（可到 120）', () => {
    const state = createGame('liu', 1);
    state.forces.liu.techNodes = ['zhiyehua'];
    const pass = state.passes!.wuguan;
    pass.ownerId = 'liu';
    pass.troops = 6000;
    pass.food = 20000;
    pass.training = 118;
    state.officers['liu-bei'].location = { kind: 'pass', passId: 'wuguan' };

    const next = executeCommand(state, 'liu', {
      type: 'train', cityId: pass.homeCityId, passId: 'wuguan', officerIds: ['liu-bei'],
    });

    expect(next.passes!.wuguan.training).toBe(120);
  });

  it('满士气时训练战报只报实际增量 0（不再显示「+N」却一点没涨）', () => {
    const state = createGame('liu', 1);
    state.cities.jiangling.training = 100;

    const next = executeCommand(state, 'liu', {
      type: 'train', cityId: 'jiangling', officerIds: ['guan-yu'],
    });

    expect(next.cities.jiangling.training).toBe(100);
    expect(next.cityEffectReports).toEqual([
      expect.objectContaining({ amount: 0, label: '士气', kind: 'train' }),
    ]);
  });

  it('出征部队士气 = 出发城池士气（不再固定 100）', () => {
    const state = createGame('liu', 1);
    state.cities.jiangling.training = 88;

    const next = deployUnit(state, 'liu', {
      cityId: 'jiangling', officerId: 'guan-yu', troops: 4000, food: 6000,
    });
    const unit = Object.values(next.units)[0];

    expect(unit.energy).toBe(88);
  });

  it('「随军参谋」在据点士气之上追加主将政治×20%，仍受 120 上限约束', () => {
    const state = createGame('liu', 1);
    state.forces.liu.techNodes = ['zhiyehua', 'suijuncanmou'];
    state.cities.jiangling.training = 110;
    const politics = state.officers['guan-yu'].stats.politics;

    const next = deployUnit(state, 'liu', {
      cityId: 'jiangling', officerId: 'guan-yu', troops: 4000, food: 6000,
    });

    expect(Object.values(next.units)[0].energy).toBe(Math.min(120, 110 + Math.round(politics * 0.2)));
  });

  it('存档校验接受超过 100 的据点士气（职业化后 120）', () => {
    const storage = new MemoryStorage();
    const state = createGame('liu', 1);
    state.forces.liu.techNodes = ['zhiyehua'];
    state.cities.jiangling.training = 120;

    writeSave(storage, 'auto', state);
    const restored = loadSave(storage, 'auto');

    expect(restored.ok).toBe(true);
    if (restored.ok) expect(restored.state.cities.jiangling.training).toBe(120);
  });
});
