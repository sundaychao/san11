import { beforeEach, describe, expect, it } from 'vitest';
import { executeCommand } from './commands';
import { deployUnit, effectiveUnitAbilities } from './battle/actions';
import {
  AUTO_SAVE_KEY,
  MANUAL_SAVE_KEY,
  loadSave,
  migrateSaveToCurrent,
  type SaveAdapter,
  writeSave,
} from './persistence';
import { relationTierOf } from './diplomacy';
import { PLOT_COUNT_BY_SIZE } from './innerAffairs';
import { createGame } from './scenario/jingxiang208';
import { createGameFromMap } from './scenario/customMap';
import type { EditorMapPayload } from './map-editor/editor';
import china42Data from './scenario/china42.json';
import china42xData from './scenario/maps/china42x.json';
import type { City, ForceId, GridCell, OfficerLocation } from './types';
import { createMobileDuelGame } from './scenario/mobileDuel';

class MemoryStorage implements SaveAdapter {
  readonly values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
  removeItem(key: string) { this.values.delete(key); }
}

/** 在途外交使者位置（江陵出使宛，去程第 5 旬） */
function envoyLocation(): OfficerLocation {
  return {
    kind: 'envoy',
    fromCityId: 'jiangling',
    targetForceId: 'cao',
    action: 'goodwill',
    outboundTenDays: 5,
    returnTenDays: 5,
    phase: 'outbound',
    remainingTenDays: 5,
  };
}

/** 全平地自定义地图荷载：城池归属固定，供存档校验用例复用 */
function customMapPayload(
  cities: Array<{ id: string; label: string; q: number; r: number; forceId: ForceId | null }>,
): EditorMapPayload {
  const width = 40;
  const height = 40;
  const grid: GridCell[] = [];
  for (let r = 0; r < height; r += 1) {
    for (let q = 0; q < width; q += 1) grid.push({ q, r, terrain: 'plain' });
  }
  return {
    schemaVersion: 2,
    width,
    height,
    backgroundImage: '',
    grid,
    cities: cities.map((city) => ({ ...city, type: 'city' as const })),
  };
}

/** 把城里第一块地格改成指定设施（征兵要兵舍、生产兵装要锻冶厂等） */
function withPlotFacility(state: ReturnType<typeof createGameFromMap>, cityId: string, type: string) {
  const city = (state.cities as Record<string, City>)[cityId];
  const plots = city.plots ?? (city.plots = []);
  plots[0] = { ...plots[0], id: `test-${type}`, type: type as never, level: 1, constructing: undefined };
  return state;
}

/** 该城可行动的武将 */
function availableOfficer(state: ReturnType<typeof createGameFromMap>, cityId: string, forceId: ForceId) {
  return Object.values(state.officers).find((officer) => officer.cityId === cityId && officer.forceId === forceId && !officer.acted)!;
}

describe('persistence', () => {
  let storage: MemoryStorage;

  beforeEach(() => { storage = new MemoryStorage(); });

  it('round-trips a valid v3 autosave', () => {
    const state = createGame('liu', 9);

    writeSave(storage, 'auto', state);
    const restored = loadSave(storage, 'auto');

    expect(restored).toEqual({ ok: true, state });
    expect(storage.getItem(AUTO_SAVE_KEY)).not.toBeNull();
  });

  it('accepts custom-map states whose cities/units use arbitrary ids (editor cities like city-20-25)', () => {
    // 编辑器创建的新城 id 形如 city-20-25，不在内置 CITY_IDS 中；
    // 部队的 homeCityId 指向此类自定义城，存档校验必须放行，否则部署/移动后 persist 抛错、
    // 导致指令执行中断、UI 菜单与可移动范围格残留。
    const width = 40;
    const height = 40;
    const grid = [];
    for (let r = 0; r < height; r++) {
      for (let q = 0; q < width; q++) grid.push({ q, r, terrain: 'plain' as const });
    }
    const map: EditorMapPayload = {
      schemaVersion: 2,
      width,
      height,
      backgroundImage: '',
      grid,
      cities: [
        { type: 'city', id: 'city-20-25', label: '新城', q: 20, r: 25, forceId: 'liu' },
        { type: 'city', id: 'city-30-15', label: '敌城', q: 30, r: 15, forceId: 'cao' },
      ],
    };
    const state = createGameFromMap(map, 'liu', 5);
    expect((state.cities as Record<string, { id: string }> )['city-20-25']).toBeDefined();

    writeSave(storage, 'auto', state); // 不应抛「拒绝写入无效存档」
    expect(storage.getItem(AUTO_SAVE_KEY)).not.toBeNull();
  });

  it('自定义地图：征兵战报里的自定义城 id 不会让存档失格（曾抛「拒绝写入无效存档」）', () => {
    const map = customMapPayload([
      { id: 'city-10-10', label: '我方城', q: 10, r: 10, forceId: 'liu' },
      { id: 'city-30-30', label: '敌方城', q: 30, r: 30, forceId: 'cao' },
    ]);
    const state = withPlotFacility(createGameFromMap(map, 'liu', 5), 'city-10-10', 'barracks');
    const officer = availableOfficer(state, 'city-10-10', 'liu');

    const next = executeCommand(state, 'liu', {
      type: 'recruit',
      cityId: 'city-10-10' as never,
      officerIds: [officer.id],
    });

    // 战报带着自定义城 id，存档校验必须按「自定义地图」放行（否则征兵后自动存档被拒、手动存档点确认没反应）
    expect(next.cityEffectReports?.[0]?.cityId).toBe('city-10-10');
    writeSave(storage, 'auto', next);
    expect(loadSave(storage, 'auto').ok).toBe(true);
  });

  it('自定义地图：生产兵装战报同样可存档', () => {
    const map = customMapPayload([
      { id: 'city-10-10', label: '我方城', q: 10, r: 10, forceId: 'liu' },
      { id: 'city-30-30', label: '敌方城', q: 30, r: 30, forceId: 'cao' },
    ]);
    const state = withPlotFacility(createGameFromMap(map, 'liu', 5), 'city-10-10', 'forge');
    const officer = availableOfficer(state, 'city-10-10', 'liu');

    const next = executeCommand(state, 'liu', {
      type: 'produceArmament',
      cityId: 'city-10-10' as never,
      officerIds: [officer.id],
      armamentType: 'crossbow',
    });

    expect(next.cityEffectReports?.[0]?.kind).toBe('armament');
    writeSave(storage, 'auto', next);
    expect(loadSave(storage, 'auto').ok).toBe(true);
  });

  it('编辑器摆放的军事设施进游戏即为成品设施（耐久满、已建成），无主/城内项跳过', () => {
    const width = 40;
    const height = 40;
    const grid: GridCell[] = [];
    for (let r = 0; r < height; r += 1) {
      for (let q = 0; q < width; q += 1) grid.push({ q, r, terrain: 'plain' });
    }
    const map: EditorMapPayload = {
      schemaVersion: 2,
      width,
      height,
      backgroundImage: '',
      grid,
      cities: [
        { type: 'city', id: 'city-10-10', label: '我方城', q: 10, r: 10, forceId: 'liu' },
      ],
      plotsSpecified: true,
      plots: [{ cityId: 'city-10-10', q: 11, r: 10 }],
      facilities: [
        { type: 'arrowTower', forceId: 'liu', cityId: 'city-10-10', q: 14, r: 10 },
        { type: 'drum', forceId: null, q: 16, r: 10 }, // 无主：跳过
        { type: 'arrowTower', forceId: 'liu', q: 10, r: 10 }, // 城中心：跳过
      ],
    };

    const state = createGameFromMap(map, 'liu', 5);
    const facilities = Object.values(state.facilities ?? {});
    expect(facilities).toHaveLength(1);
    expect(facilities[0]).toMatchObject({
      id: 'facility-14-10',
      type: 'arrowTower',
      forceId: 'liu',
      q: 14,
      r: 10,
      durability: 700,
      completed: true,
    });

    // 带设施的自定义图整局可存档
    writeSave(storage, 'auto', state);
    expect(loadSave(storage, 'auto').ok).toBe(true);
  });

  it('内置剧本的战报仍拒绝未知城 id：放行只对自定义地图生效', () => {
    const state = createGame('liu', 3);
    state.cityEffectReports = [{
      id: 'bogus',
      cityId: 'city-10-10' as never,
      q: 0,
      r: 0,
      amount: 1,
      label: '士兵',
      kind: 'recruit',
    }];

    expect(() => writeSave(storage, 'auto', state)).toThrow('拒绝写入无效存档');
  });

  it('honors editor-designated construction plots (map.plots) over auto-fallback', () => {
    const width = 20;
    const height = 20;
    const grid = [];
    for (let r = 0; r < height; r++) {
      for (let q = 0; q < width; q++) grid.push({ q, r, terrain: 'plain' as const });
    }
    const map: EditorMapPayload = {
      schemaVersion: 2,
      width,
      height,
      backgroundImage: '',
      grid,
      cities: [
        { type: 'city', id: 'city-10-10', label: '都城', q: 10, r: 10, forceId: 'liu' },
        { type: 'city', id: 'city-16-16', label: '邻城', q: 16, r: 16, forceId: 'cao' },
      ],
      plots: [
        { cityId: 'city-10-10', q: 11, r: 10 },
        { cityId: 'city-10-10', q: 11, r: 11 },
        { cityId: 'city-10-10', q: 9, r: 11 },
        { cityId: 'city-16-16', q: 17, r: 16 },
      ],
    };

    const state = createGameFromMap(map, 'liu', 5);
    const cities = state.cities as Record<string, { plots?: Array<{ q: number; r: number }> }>;
    const city = cities['city-10-10'];
    const coords = (city.plots ?? []).map((plot) => `${plot.q},${plot.r}`);
    const gridByKey = new Map(state.grid.map((cell) => [`${cell.q},${cell.r}`, cell.terrain]));

    expect(coords).toEqual(['11,10', '11,11', '9,11']);
    expect(gridByKey.get('11,10')).toBe('construction');
    expect(gridByKey.get('11,11')).toBe('construction');
    // 邻城按其手动归属落位，而不是争夺 11,11
    expect((cities['city-16-16'.toLowerCase()]?.plots ?? []).map((plot) => `${plot.q},${plot.r}`)).toEqual(['17,16']);
  });

  it('编辑器保存过的图（plotsSpecified）以圈地为唯一口径：刻意留空的城就是 0 格', () => {
    const width = 40;
    const height = 40;
    const grid = [];
    for (let r = 0; r < height; r++) {
      for (let q = 0; q < width; q++) grid.push({ q, r, terrain: 'plain' as const });
    }
    const map: EditorMapPayload = {
      schemaVersion: 2,
      width,
      height,
      backgroundImage: '',
      grid,
      cities: [
        { type: 'city', id: 'city-10-10', label: '都城', q: 10, r: 10, forceId: 'liu' },
        { type: 'city', id: 'city-30-30', label: '空城', q: 30, r: 30, forceId: 'cao' },
      ],
      plotsSpecified: true,
      plots: [{ cityId: 'city-10-10', q: 10, r: 20 }],
    };

    const state = createGameFromMap(map, 'liu', 5);
    const cities = state.cities as Record<string, { plots?: Array<{ q: number; r: number }> }>;

    expect((cities['city-10-10'].plots ?? []).map((plot) => `${plot.q},${plot.r}`)).toEqual(['10,20']);
    // 刻意留空的城不再被自动补地
    expect(cities['city-30-30'].plots ?? []).toEqual([]);
    expect(state.grid.filter((cell) => cell.terrain === 'construction')).toHaveLength(1);
  });

  it('旧图没有 plotsSpecified 标记时仍然自动补齐建设用地', () => {
    const width = 40;
    const height = 40;
    const grid = [];
    for (let r = 0; r < height; r++) {
      for (let q = 0; q < width; q++) grid.push({ q, r, terrain: 'plain' as const });
    }
    const map: EditorMapPayload = {
      schemaVersion: 2,
      width,
      height,
      backgroundImage: '',
      grid,
      cities: [
        { type: 'city', id: 'city-10-10', label: '都城', q: 10, r: 10, forceId: 'liu' },
        { type: 'city', id: 'city-30-30', label: '空城', q: 30, r: 30, forceId: 'cao' },
      ],
    };

    const state = createGameFromMap(map, 'liu', 5);
    const cities = state.cities as Record<string, { plots?: Array<{ q: number; r: number }> }>;

    expect(cities['city-10-10'].plots).toHaveLength(PLOT_COUNT_BY_SIZE.medium);
    expect(cities['city-30-30'].plots).toHaveLength(PLOT_COUNT_BY_SIZE.medium);
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
    expect((JSON.parse(serialized) as { schemaVersion: number }).schemaVersion).toBe(3);
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

  it('round-trips an in-transit diplomacy envoy location', () => {
    const state = createGame('liu', 1);
    const envoy = envoyLocation();
    const officer = Object.values(state.officers).find((o) => o.forceId === 'liu' && o.location.kind === 'city')!;
    officer.location = envoy;
    officer.acted = true;

    writeSave(storage, 'auto', state);
    const restored = loadSave(storage, 'auto');

    expect(restored.ok).toBe(true);
    if (!restored.ok) return;
    expect(restored.state.officers[officer.id].location).toEqual(envoy);
  });

  it('accepts an envoy whose origin city was captured mid-journey', () => {
    const state = createGame('liu', 1);
    const officer = Object.values(state.officers).find((o) =>
      o.forceId === 'liu' && o.location.kind === 'city' && o.location.cityId === 'jiangling')!;
    // 出发城（宛）已在出使途中被敌方攻占：使者仍在返程，存档不能因此被判无效
    // —— 返程时由 settleEnvoys 改回本方仍持有的城池
    officer.location = { ...envoyLocation(), fromCityId: 'wan' } as OfficerLocation;
    officer.acted = true;

    writeSave(storage, 'auto', state);

    const restored = loadSave(storage, 'auto');
    expect(restored.ok).toBe(true);
    if (!restored.ok) return;
    expect(restored.state.officers[officer.id].location.kind).toBe('envoy');
  });

  it('rejects an envoy location with an unknown diplomacy action', () => {
    const state = createGame('liu', 1);
    const officer = Object.values(state.officers).find((o) => o.forceId === 'liu' && o.location.kind === 'city')!;
    officer.location = { ...envoyLocation(), action: 'bribe' } as unknown as typeof officer.location;
    storage.setItem(AUTO_SAVE_KEY, JSON.stringify(state));

    expect(loadSave(storage, 'auto')).toEqual({ ok: false, reason: '存档无法读取' });
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

  it('migrates v2 diplomacy (−100~100) into the original 0~100 range', () => {
    const state = createGame('liu', 1);
    const other = (Object.keys(state.forces) as ForceId[]).find((id) => id !== state.playerForceId)!;
    // 伪造旧档：破盟一次后双方都是 −60
    storage.setItem(AUTO_SAVE_KEY, JSON.stringify({
      ...state,
      schemaVersion: 2,
      forces: {
        ...state.forces,
        [state.playerForceId]: { ...state.forces[state.playerForceId], diplomacy: { [other]: -60 } },
        [other]: { ...state.forces[other], diplomacy: { [state.playerForceId]: -60 } },
      },
    }));

    const result = loadSave(storage, 'auto');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.schemaVersion).toBe(3);
    // −60 / 2 + 50 = 20（「不和」档）
    expect(result.state.forces[state.playerForceId].diplomacy?.[other]).toBe(20);
    expect(result.state.forces[other].diplomacy?.[state.playerForceId]).toBe(20);
  });

  it('migrates v2 neutral 0 to 50 so old saves do not fall into 险恶', () => {
    const state = createGame('liu', 1);
    const other = (Object.keys(state.forces) as ForceId[]).find((id) => id !== state.playerForceId)!;
    storage.setItem(AUTO_SAVE_KEY, JSON.stringify({
      ...state,
      schemaVersion: 2,
      forces: {
        ...state.forces,
        [state.playerForceId]: { ...state.forces[state.playerForceId], diplomacy: { [other]: 0 } },
      },
    }));

    const result = loadSave(storage, 'auto');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.forces[state.playerForceId].diplomacy?.[other]).toBe(50);
    expect(relationTierOf(50)).toBe('neutral');
  });

  it('maps the v2 extremes onto the v3 bounds and leaves v3 untouched', () => {
    const upgraded = migrateSaveToCurrent({
      schemaVersion: 2,
      forces: { cao: { diplomacy: { liu: -100, sun: 100, biao: 0 } } },
    }) as { schemaVersion: number; forces: { cao: { diplomacy: Record<string, number> } } };
    expect(upgraded.schemaVersion).toBe(3);
    expect(upgraded.forces.cao.diplomacy).toEqual({ liu: 0, sun: 100, biao: 50 });

    const current = migrateSaveToCurrent({
      schemaVersion: 3,
      forces: { cao: { diplomacy: { liu: 70 } } },
    }) as { forces: { cao: { diplomacy: Record<string, number> } } };
    expect(current.forces.cao.diplomacy).toEqual({ liu: 70 });
    expect(migrateSaveToCurrent({ schemaVersion: 1 })).toBeNull();
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
