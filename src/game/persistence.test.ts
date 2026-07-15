import { beforeEach, describe, expect, it } from 'vitest';
import { executeCommand } from './commands';
import {
  AUTO_SAVE_KEY,
  MANUAL_SAVE_KEY,
  loadSave,
  type SaveAdapter,
  writeSave,
} from './persistence';
import { createGame } from './scenario/jingxiang208';

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

  it('loads older v2 saves without officer skill and aptitude fields', () => {
    const state = createGame('liu', 9);
    for (const officer of Object.values(state.officers)) {
      delete officer.skill;
      delete officer.aptitudes;
    }
    storage.setItem(AUTO_SAVE_KEY, JSON.stringify(state));

    expect(loadSave(storage, 'auto')).toEqual({ ok: true, state });
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
