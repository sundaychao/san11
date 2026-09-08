import { beforeEach, describe, expect, it } from 'vitest';
import { executeCommand } from './commands';
import { deployUnit, effectiveUnitAbilities } from './battle/actions';
import {
  AUTO_SAVE_KEY,
  MANUAL_SAVE_KEY,
  loadSave,
  type SaveAdapter,
  writeSave,
} from './persistence';
import { createGame } from './scenario/jingxiang208';
import china42Data from './scenario/china42.json';
import china42xData from './scenario/china42x.json';
import type { GridCell } from './types';
import { createMobileDuelGame } from './scenario/mobileDuel';

class MemoryStorage implements SaveAdapter {
  readonly values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
  removeItem(key: string) { this.values.delete(key); }
}

describe('persistence', () => {
  let storage: MemoryStorage;

  beforeEach(() => { storage = new MemoryStorage(); });

  it('round-trips a valid v2 autosave', () => {
    const state = createGame('liu', 9);

    writeSave(storage, 'auto', state);
    const restored = loadSave(storage, 'auto');

    expect(restored).toEqual({ ok: true, state });
    expect(storage.getItem(AUTO_SAVE_KEY)).not.toBeNull();
  });

  it('normalizes legacy china42x pass cells from construction to pass on load', () => {
    // 关所地形独立为 pass 之前的旧 china42x 存档：38 个关所格仍写作 construction
    const passKeys = new Set(
      (china42xData.grid as { q: number; r: number; terrain: GridCell['terrain'] }[])
        .filter((cell) => cell.terrain === 'pass')
        .map((cell) => `${cell.q},${cell.r}`),
    );
    expect(passKeys.size).toBe(38);
    const legacy = createGame('liu', 9);
    legacy.grid = legacy.grid.map((cell) => (
      passKeys.has(`${cell.q},${cell.r}`)
        ? { ...cell, terrain: 'construction' as const }
        : cell
    ));
    writeSave(storage, 'manual', legacy);

    const loaded = loadSave(storage, 'manual');

    expect(loaded.ok).toBe(true);
    if (loaded.ok) {
      // 关所格全部归一为 pass，且不再残留 construction
      const passCells = loaded.state.grid.filter((cell) => cell.terrain === 'pass');
      expect(passCells).toHaveLength(38);
      expect(passCells.every((cell) => passKeys.has(`${cell.q},${cell.r}`))).toBe(true);
    }
  });

  it('expands truncated legacy plots to original counts without touching built facilities', () => {
    // 旧档建设用地曾被规模档位截断（长安22格→12格）：加载后补足至原版格数
    const legacy = createGame('liu', 9);
    const changan = legacy.cities.changan;
    const originalCount = changan.plots!.length;
    expect(originalCount).toBe(22);
    // 模拟旧档：保留前12格（含一座已建市场），其余截断
    const kept = changan.plots!.slice(0, 12);
    kept[0] = { ...kept[0], type: 'market', level: 2 };
    changan.plots = kept;
    writeSave(storage, 'manual', legacy);

    const loaded = loadSave(storage, 'manual');

    expect(loaded.ok).toBe(true);
    if (loaded.ok) {
      const plots = loaded.state.cities.changan.plots!;
      expect(plots).toHaveLength(originalCount);
      // 已建设施原样保留（仍是2级市场且位置不变）
      expect(plots[0].type).toBe('market');
      expect(plots[0].level).toBe(2);
      // 补足的地格均为带坐标的空地
      const appended = plots.slice(12);
      expect(appended).toHaveLength(originalCount - 12);
      expect(appended.every((plot) => plot.type === 'empty' && plot.q != null && plot.r != null)).toBe(true);
    }
  });

  it('migrates legacy shore terrain to water and restores missing ferries on load', () => {
    // 未编辑过的旧版 china42 手绘地图存档 → 整体升级为原版精确地图 china42x
    // （草地/渡口/浅滩等原版 20 值细分地形齐全）
    const untouched = createGame('liu', 9);
    untouched.grid = (china42Data.grid as { q: number; r: number; terrain: GridCell['terrain'] }[]).map(
      (cell) => ({ q: cell.q, r: cell.r, terrain: cell.terrain }),
    );
    writeSave(storage, 'auto', untouched);

    const upgraded = loadSave(storage, 'auto');

    expect(upgraded.ok).toBe(true);
    if (upgraded.ok) {
      expect(upgraded.state.grid.some((cell) => cell.terrain === 'grass')).toBe(true);
      expect(upgraded.state.grid.some((cell) => cell.terrain === 'ferry')).toBe(true);
      expect(upgraded.state.grid).toHaveLength(untouched.grid.length);
      expect(Object.values(upgraded.state.cities).every((city, index) => (
        city.gridQ === Object.values(untouched.cities)[index].gridQ &&
        city.gridR === Object.values(untouched.cities)[index].gridR
      ))).toBe(true);
    }

    // 编辑过的旧地图（残留旧 shore 值）→ shore 归一化为 water，城市位置不变
    const legacy = createGame('liu', 9);
    legacy.grid = (china42Data.grid as { q: number; r: number; terrain: GridCell['terrain'] }[]).map((cell) => (
      cell.terrain === 'water'
        ? { q: cell.q, r: cell.r, terrain: 'shore' as GridCell['terrain'] }
        : { q: cell.q, r: cell.r, terrain: cell.terrain }
    ));
    writeSave(storage, 'manual', legacy);

    const loaded = loadSave(storage, 'manual');

    expect(loaded.ok).toBe(true);
    if (loaded.ok) {
      expect(loaded.state.grid.some((cell) => (cell.terrain as string) === 'shore')).toBe(false);
      expect(loaded.state.grid).toHaveLength(legacy.grid.length);
      expect(Object.values(loaded.state.cities).every((city, index) => (
        city.gridQ === Object.values(legacy.cities)[index].gridQ &&
        city.gridR === Object.values(legacy.cities)[index].gridR
      ))).toBe(true);
    }
  });

  it('keeps a current terrain grid unchanged on load', () => {
    const state = createGame('liu', 9);
    writeSave(storage, 'auto', state);

    const loaded = loadSave(storage, 'auto');

    expect(loaded).toEqual({ ok: true, state });
  });

  it('round-trips every first-stage and unknown custom skill without persisting derived rules', () => {
    const state = createGame('liu', 9);
    const skillNames = [
      '强行', '飞将', '神将', '连击', '不屈', '百出', '火神', '洞察', '连环', '筑城', '乐奏', '富豪', '米道', '名声', '能吏', '自定义未登记',
    ] as const;
    const assignedOfficerIds = Object.values(state.officers)
      .slice(0, skillNames.length)
      .map((officer, index) => {
        officer.skill = skillNames[index];
        return officer.id;
      });

    writeSave(storage, 'auto', state);

    const loaded = loadSave(storage, 'auto');
    expect(loaded).toEqual({ ok: true, state });
    if (!loaded.ok) return;
    expect(assignedOfficerIds.map((officerId) => loaded.state.officers[officerId].skill)).toEqual(skillNames);

    const serialized = storage.getItem(AUTO_SAVE_KEY)!;
    expect((JSON.parse(serialized) as { schemaVersion: number }).schemaVersion).toBe(2);
    for (const derivedKey of [
      'ActiveSkill',
      'sourceOfficerIds',
      'definition',
      'effects',
      'implementationStatus',
      'movementAllowance',
      'ignoreEnemyZoc',
      'tacticCritical',
      'normalAttackCritical',
      'repeatNormalAttack',
      'negateIncomingDamage',
      'strategyEnergyCost',
      'strategyGuaranteed',
      'strategyImmunity',
      'fireDamageMultiplier',
      'buildPowerMultiplier',
      'turnStartEnergy',
      'commandYieldMultiplier',
      'cityIncomeMultiplier',
      'complexHandler',
    ]) {
      expect(serialized).not.toContain(`"${derivedKey}"`);
    }
  });

  it('round-trips a critical battle damage report', () => {
    const state = createGame('liu', 9);
    state.battleDamageReports = [{
      id: 'critical-1', unitId: 'enemy-1', q: 10, r: 11, amount: 777, kind: 'attack',
      critical: true, label: '暴击',
    }];

    writeSave(storage, 'auto', state);

    expect(loadSave(storage, 'auto')).toEqual({ ok: true, state });
  });

  it('loads an older v2 save without strategy result reports', () => {
    const state = createGame('liu', 9);
    delete state.strategyResultReports;
    storage.setItem(AUTO_SAVE_KEY, JSON.stringify(state));

    expect(loadSave(storage, 'auto')).toEqual({ ok: true, state });
  });

  it('round-trips a failed strategy result report', () => {
    const state = createGame('liu', 9);
    state.strategyResultReports = [{
      id: 'strategy-disturb-1', strategyId: 'disturb', q: 10, r: 11,
      label: '计略失败', succeeded: false,
    }];

    writeSave(storage, 'auto', state);

    expect(loadSave(storage, 'auto')).toEqual({ ok: true, state });
  });

  it('rejects an invalid strategy result report', () => {
    const state = createGame('liu', 9);
    (state as unknown as { strategyResultReports: Array<Record<string, unknown>> }).strategyResultReports = [{
      id: 'strategy-disturb-1', strategyId: 'unknown', q: 10, r: 11,
      label: '计略失败', succeeded: false,
    }];
    storage.setItem(AUTO_SAVE_KEY, JSON.stringify(state));

    expect(loadSave(storage, 'auto')).toEqual({ ok: false, reason: '存档无法读取' });
  });

  it.each([
    ['critical', { critical: 'yes' }],
    ['label', { label: 135 }],
  ] as const)('rejects an invalid battle damage report %s field', (_field, invalidField) => {
    const state = createGame('liu', 9);
    (state as unknown as { battleDamageReports: Array<Record<string, unknown>> }).battleDamageReports = [{
      id: 'critical-1', unitId: 'enemy-1', q: 10, r: 11, amount: 777, kind: 'attack',
      ...invalidField,
    }];
    storage.setItem(AUTO_SAVE_KEY, JSON.stringify(state));

    expect(loadSave(storage, 'auto')).toEqual({ ok: false, reason: '存档无法读取' });
  });

  it('loads older v2 saves without officer skill and aptitude fields', () => {
    const state = createGame('liu', 9);
    for (const officer of Object.values(state.officers)) {
      delete officer.skill;
      delete officer.aptitudes;
    }
    storage.setItem(AUTO_SAVE_KEY, JSON.stringify(state));

    expect(loadSave(storage, 'auto')).toEqual({ ok: true, state });
  });

  it('loads a valid older v2 unit whose formation list omits its leader', () => {
    const state = deployUnit(createGame('liu', 9), 'liu', {
      cityId: 'jiangling', officerIds: ['jian-yong', 'guan-yu'],
      troopType: 'spear', troops: 3000, food: 3000,
    });
    const unit = Object.values(state.units)[0];
    state.officers['jian-yong'].stats.intelligence = 100;
    unit.officerIds = ['guan-yu', 'missing-officer', 'guan-yu'];
    storage.setItem(AUTO_SAVE_KEY, JSON.stringify(state));

    const loaded = loadSave(storage, 'auto');

    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(effectiveUnitAbilities(loaded.state, loaded.state.units[unit.id])).toMatchObject({
      leadership: { officerId: 'jian-yong' },
      war: { officerId: 'guan-yu' },
      intelligence: { officerId: 'jian-yong' },
    });
  });

  it('uses an independent manual slot', () => {
    writeSave(storage, 'manual', createGame('sun', 2));

    expect(storage.getItem(MANUAL_SAVE_KEY)).not.toBeNull();
    expect(storage.getItem(AUTO_SAVE_KEY)).toBeNull();
  });

  it('round-trips officers moving between cities', () => {
    const state = executeCommand(createGame('liu', 9), 'liu', {
      type: 'transfer', cityId: 'jiangling', targetCityId: 'wuling', officerIds: ['guan-yu'],
    });

    writeSave(storage, 'auto', state);

    expect(loadSave(storage, 'auto')).toEqual({ ok: true, state });
  });

  it('round-trips a mobile duel state with fire plot markers', () => {
    const state = createMobileDuelGame('liu', 'cao', 9);
    state.firePlots = [{ q: 8, r: 12 }];

    writeSave(storage, 'auto', state);

    expect(loadSave(storage, 'auto')).toEqual({ ok: true, state });
  });

  it('rejects corrupt data without deleting it', () => {
    storage.setItem(AUTO_SAVE_KEY, '{broken');

    expect(loadSave(storage, 'auto')).toEqual({ ok: false, reason: '存档无法读取' });
    expect(storage.getItem(AUTO_SAVE_KEY)).toBe('{broken');
  });

  it('rejects incompatible schema versions', () => {
    const state = createGame('liu', 1) as unknown as Record<string, unknown>;
    state.schemaVersion = 99;
    storage.setItem(AUTO_SAVE_KEY, JSON.stringify(state));

    expect(loadSave(storage, 'auto')).toEqual({ ok: false, reason: '存档版本不兼容' });
  });

  it('rejects negative resources and invalid percentages', () => {
    const state = createGame('liu', 1);
    state.cities.jiangling.gold = -1;
    state.cities.wuling.order = 101;
    storage.setItem(AUTO_SAVE_KEY, JSON.stringify(state));

    expect(loadSave(storage, 'auto')).toEqual({ ok: false, reason: '存档无法读取' });
  });

  it('rejects missing city records and incomplete officer stats', () => {
    // 城市记录缺失不再拒绝：升级逻辑按剧本注入补全（旧 8 城存档升级 42 城依赖此行为）
    const missingCity = createGame('liu', 1) as unknown as { cities: Record<string, unknown> };
    delete missingCity.cities.jiangling;
    storage.setItem(AUTO_SAVE_KEY, JSON.stringify(missingCity));
    const restored = loadSave(storage, 'auto');
    expect(restored.ok).toBe(true);
    if (restored.ok) expect(restored.state.cities.jiangling).toBeTruthy();

    const missingStat = createGame('liu', 1) as unknown as { officers: Record<string, { stats: Record<string, number> }> };
    delete missingStat.officers['liu-bei'].stats.politics;
    storage.setItem(AUTO_SAVE_KEY, JSON.stringify(missingStat));
    expect(loadSave(storage, 'auto')).toEqual({ ok: false, reason: '存档无法读取' });
  });

  it('rejects broken governor and officer location references', () => {
    const state = createGame('liu', 1);
    state.cities.jiangling.governorId = 'cao-cao';
    storage.setItem(AUTO_SAVE_KEY, JSON.stringify(state));

    expect(loadSave(storage, 'auto')).toEqual({ ok: false, reason: '存档无法读取' });
  });

  it('reports an empty slot', () => {
    expect(loadSave(storage, 'auto')).toEqual({ ok: false, reason: '没有存档' });
  });
});
