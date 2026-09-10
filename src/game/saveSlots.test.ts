import { beforeEach, describe, expect, it } from 'vitest';
import {
  SAVE_SLOT_COUNT,
  SAVE_SLOT_PAGE_COUNT,
  SAVE_SLOT_PAGE_SIZE,
  buildSlotMeta,
  decodeSaveBlob,
  encodeSaveBlob,
  latestSlotNumber,
  listSlotMetas,
  readSlotMeta,
  readSlotState,
  removeSlot,
  slotMetaKey,
  slotPageLabel,
  slotPageRange,
  slotStateKey,
  writeSlot,
} from './saveSlots';
import type { SaveAdapter } from './persistence';
import { createGame } from './scenario/jingxiang208';
import type { GridCell } from './types';

class MemoryStorage implements SaveAdapter {
  readonly values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
  removeItem(key: string) { this.values.delete(key); }
}

describe('saveSlots 槽位与分页', () => {
  it('固定 32 个槽位、4 页、每页 8 个', () => {
    expect(SAVE_SLOT_COUNT).toBe(32);
    expect(SAVE_SLOT_PAGE_COUNT).toBe(4);
    expect(SAVE_SLOT_PAGE_SIZE).toBe(8);
    expect([1, 2, 3, 4].map(slotPageLabel)).toEqual(['1 - 8', '9 - 16', '17 - 24', '25 - 32']);
    expect(slotPageRange(1)).toEqual([1, 8]);
    expect(slotPageRange(4)).toEqual([25, 32]);
  });

  it('每个槽位有独立的状态键与摘要键', () => {
    expect(slotStateKey(19)).not.toBe(slotStateKey(20));
    expect(slotMetaKey(19)).not.toBe(slotStateKey(19));
  });
});

describe('saveSlots 存档编解码', () => {
  it('紧凑网格编码后单份存档远小于原始 JSON，且完整还原地形', async () => {
    const state = createGame('liu', 7);
    const blob = await encodeSaveBlob(state);
    expect(blob.length).toBeLessThan(JSON.stringify(state).length / 4);

    const restored = await decodeSaveBlob(blob);
    expect(restored.ok).toBe(true);
    if (!restored.ok) return;
    expect(restored.state.grid.length).toBe(state.grid.length);
    expect(restored.state.grid).toEqual(state.grid);
    expect(restored.state.gridWidth).toBe(state.gridWidth);
    expect(restored.state.cities).toEqual(state.cities);
    expect(restored.state.officers).toEqual(state.officers);
    expect(restored.state.units).toEqual(state.units);
    expect(restored.state.month).toBe(state.month);
    expect(restored.state.rngCursor).toBe(state.rngCursor);
  });

  it('非规则点阵网格（稀疏/自定义）回退为原样存储并同样可还原', async () => {
    const state = createGame('liu', 3);
    const sparse: GridCell[] = [
      { q: 0, r: 0, terrain: 'road' },
      { q: 0, r: 1, terrain: 'forest' },
      { q: 5, r: 9, terrain: 'water' },
      { q: 199, r: 199, terrain: 'mountain' },
    ];
    const custom = { ...state, grid: sparse, gridWidth: 200, gridHeight: 200 };

    const restored = await decodeSaveBlob(await encodeSaveBlob(custom));
    expect(restored.ok).toBe(true);
    if (!restored.ok) return;
    expect(restored.state.grid).toEqual(sparse);
  });

  it('拒绝非 v2 存档并识别损坏内容', async () => {
    expect(await decodeSaveBlob('{"schemaVersion":1}')).toEqual({ ok: false, reason: '存档版本不兼容' });
    expect(await decodeSaveBlob('raw1:{not json')).toEqual({ ok: false, reason: '存档无法读取' });
    expect(await decodeSaveBlob('gz1:@@@@')).toEqual({ ok: false, reason: '存档无法读取' });
  });

  it('兼容早期明文存档', async () => {
    const state = createGame('liu', 5);
    const restored = await decodeSaveBlob(JSON.stringify(state));
    expect(restored.ok).toBe(true);
  });
});

describe('saveSlots 槽位读写', () => {
  let storage: MemoryStorage;

  beforeEach(() => { storage = new MemoryStorage(); });

  it('写入后可读回整局状态，并生成 32 长度的摘要列表', async () => {
    const state = createGame('liu', 11);
    // 制造与初始不同的进度，确认回读的是存档而非重新开局
    state.month = 9;
    state.tenDay = 2;

    await writeSlot(storage, 19, state, buildSlotMeta(state, { slot: 19, playSeconds: 61, note: '三顾茅庐' }));

    const metas = listSlotMetas(storage);
    expect(metas).toHaveLength(32);
    expect(metas[0]).toBeNull();
    const meta = metas[18];
    expect(meta).not.toBeNull();
    expect(meta!.slot).toBe(19);
    expect(meta!.note).toBe('三顾茅庐');
    expect(meta!.playSeconds).toBe(61);
    expect(meta!.cities.length).toBeGreaterThan(0);
    expect(latestSlotNumber(metas)).toBe(19);

    const loaded = await readSlotState(storage, 19);
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.state.month).toBe(9);
    expect(loaded.state.tenDay).toBe(2);
  });

  it('覆盖同一槽位时只保留最新进度', async () => {
    const state = createGame('liu', 2);
    await writeSlot(storage, 3, state, buildSlotMeta(state, { slot: 3 }));
    const later = createGame('liu', 2);
    later.month = 5;
    await writeSlot(storage, 3, later, buildSlotMeta(later, { slot: 3 }));

    const loaded = await readSlotState(storage, 3);
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.state.month).toBe(5);
  });

  it('删除槽位会同时清掉状态与摘要', async () => {
    const state = createGame('liu', 4);
    await writeSlot(storage, 8, state, buildSlotMeta(state, { slot: 8 }));
    expect(readSlotMeta(storage, 8)).not.toBeNull();

    removeSlot(storage, 8);
    expect(readSlotMeta(storage, 8)).toBeNull();
    expect(storage.getItem(slotStateKey(8))).toBeNull();
    expect((await readSlotState(storage, 8)).ok).toBe(false);
  });

  it('空槽位读取失败但摘要为 null，不抛异常', async () => {
    expect(readSlotMeta(storage, 32)).toBeNull();
    expect((await readSlotState(storage, 32)).ok).toBe(false);
  });

  it('32 个槽位全部写满仍显著低于 localStorage 配额', async () => {
    const state = createGame('liu', 1);
    for (let slot = 1; slot <= SAVE_SLOT_COUNT; slot += 1) {
      await writeSlot(storage, slot, state, buildSlotMeta(state, { slot }));
    }
    let total = 0;
    for (const value of storage.values.values()) total += value.length;

    expect(total).toBeLessThan(2_000_000);
    expect(listSlotMetas(storage).filter(Boolean)).toHaveLength(SAVE_SLOT_COUNT);
    expect((await readSlotState(storage, SAVE_SLOT_COUNT)).ok).toBe(true);
  });
});

describe('saveSlots 存档摘要', () => {
  it('摘要包含势力、游戏内日期、势力图打点与镜头', () => {
    const state = createGame('liu', 6);
    const camera = { cx: 0.42, cy: 0.55, scale: 0.09 };
    const meta = buildSlotMeta(state, { slot: 1, playSeconds: 3661, camera });

    expect(meta.forceId).toBe('liu');
    expect(meta.forceName).toBe(state.forces.liu.name);
    expect(meta.leaderName).toBe(state.officers[state.forces.liu.leaderId].name);
    expect(meta.monthLabel).toBeTruthy();
    expect(meta.tenDayLabel).toBeTruthy();
    expect(meta.scenarioLabel).toBe('荆襄208');
    expect(meta.camera).toEqual(camera);
    expect(meta.cityCount).toBeGreaterThan(0);
    expect(meta.cities.length).toBe(Object.keys(state.cities).length);
    expect(meta.legend.length).toBeGreaterThan(0);
  });
});
