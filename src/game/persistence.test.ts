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

    expect(loadSave(storage, 'auto')).toEqual({ ok: true, state });
    expect(storage.getItem(AUTO_SAVE_KEY)).not.toBeNull();
  });

  it('round-trips every first-stage and unknown custom skill without persisting derived rules', () => {
    const state = createGame('liu', 9);
    const skillNames = [
      '强行', '飞将', '神将', '连战', '不屈', '百出', '火神', '洞察', '连环', '筑城', '乐奏', '富豪', '米道', '名声', '能吏', '自定义未登记',
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
    const missingCity = createGame('liu', 1) as unknown as { cities: Record<string, unknown> };
    delete missingCity.cities.jiangling;
    storage.setItem(AUTO_SAVE_KEY, JSON.stringify(missingCity));
    expect(loadSave(storage, 'auto')).toEqual({ ok: false, reason: '存档无法读取' });

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
