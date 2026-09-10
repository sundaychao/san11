import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { addSessionMap, listMaps, removeSessionMap } from '../game/mapRegistry';
import type { EditorMapPayload } from '../game/map-editor/editor';
import china42Data from '../game/scenario/maps/china42x.json';
import { downloadTextFile } from '../utils/download';
import { MapEditorScreen } from './MapEditorScreen';

vi.mock('../utils/download', () => ({ downloadTextFile: vi.fn() }));

// 用轻量替身替换地图画布：只暴露一个「绘制格子」入口，测试聚焦编辑器逻辑本身
vi.mock('./StrategicMap', () => ({
  StrategicMap: ({ onEditorCellPaint }: { onEditorCellPaint?(coord: { q: number; r: number }): void }) => (
    <button type="button" data-testid="mock-paint" onClick={() => onEditorCellPaint?.({ q: 1, r: 1 })}>
      paint
    </button>
  ),
}));

/** 新建 4×4 空白地图并进入画布 */
function renderEditor() {
  const onSave = vi.fn();
  render(<MapEditorScreen mapId="new" onSave={onSave} onBack={vi.fn()} />);
  fireEvent.change(screen.getByTestId('editor-size-width'), { target: { value: '4' } });
  fireEvent.change(screen.getByTestId('editor-size-height'), { target: { value: '4' } });
  fireEvent.click(screen.getByTestId('editor-size-create'));
  return { onSave };
}

function placeAt() {
  fireEvent.click(screen.getByRole('button', { name: '城池' }));
  fireEvent.click(screen.getByTestId('mock-paint'));
}

function fillMapName(name: string) {
  fireEvent.change(screen.getByLabelText('地图名'), { target: { value: name } });
}

function savedPayload(onSave: ReturnType<typeof vi.fn>): EditorMapPayload {
  return onSave.mock.calls[0][0] as EditorMapPayload;
}

afterEach(() => {
  // 清理本用例写入 registry 的自定义地图，避免污染后续测试
  for (const map of listMaps()) {
    if (!map.builtin) removeSessionMap(map.id);
  }
});

describe('MapEditorScreen 城池命名', () => {
  beforeEach(() => vi.clearAllMocks());

  it('选完势力后必须输入名字，确认才落地', () => {
    const { onSave } = renderEditor();
    placeAt();

    expect(screen.getByTestId('editor-placement-menu')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('placement-force-刘备'));

    // 命名框出现，且此时尚未落地
    const dialog = screen.getByTestId('editor-name-dialog');
    expect(dialog).toBeInTheDocument();
    expect(screen.getByTestId('editor-name-confirm')).toBeDisabled();

    fireEvent.change(screen.getByTestId('editor-name-input'), { target: { value: '成都' } });
    expect(screen.getByTestId('editor-name-confirm')).toBeEnabled();
    fireEvent.click(screen.getByTestId('editor-name-confirm'));

    expect(screen.queryByTestId('editor-name-dialog')).not.toBeInTheDocument();
    fillMapName('测试图');
    fireEvent.click(screen.getByTestId('editor-save-cache'));

    expect(savedPayload(onSave).cities).toEqual([
      { id: 'city-1-1', type: 'city', label: '成都', q: 1, r: 1, forceId: 'liu' },
    ]);
  });

  it('取名字时确认不落地', () => {
    const { onSave } = renderEditor();
    placeAt();
    fireEvent.click(screen.getByTestId('placement-force-曹操'));
    fireEvent.click(screen.getByTestId('editor-name-cancel'));

    expect(screen.queryByTestId('editor-name-dialog')).not.toBeInTheDocument();
    fillMapName('测试图');
    fireEvent.click(screen.getByTestId('editor-save-cache'));

    expect(savedPayload(onSave).cities).toEqual([]);
  });

  it('已存在的城池改归属时保留原名，不弹命名框', () => {
    const { onSave } = renderEditor();
    placeAt();
    fireEvent.click(screen.getByTestId('placement-force-刘备'));
    fireEvent.change(screen.getByTestId('editor-name-input'), { target: { value: '江陵' } });
    fireEvent.click(screen.getByTestId('editor-name-confirm'));

    // 再次点击同一城址：只切势力，直接生效
    fireEvent.click(screen.getByTestId('mock-paint'));
    fireEvent.click(screen.getByTestId('placement-force-曹操'));
    expect(screen.queryByTestId('editor-name-dialog')).not.toBeInTheDocument();

    fillMapName('测试图');
    fireEvent.click(screen.getByTestId('editor-save-cache'));
    expect(savedPayload(onSave).cities).toEqual([
      { id: 'city-1-1', type: 'city', label: '江陵', q: 1, r: 1, forceId: 'cao' },
    ]);
  });
});

describe('MapEditorScreen 保存', () => {
  beforeEach(() => vi.clearAllMocks());

  it('缓存保存只写缓存，不下载文件', () => {
    const { onSave } = renderEditor();
    fillMapName('荆南图');
    fireEvent.click(screen.getByTestId('editor-save-cache'));

    expect(downloadTextFile).not.toHaveBeenCalled();
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave.mock.calls[0][1]).toBe('荆南图');
    expect(listMaps().some((map) => !map.builtin && map.name === '荆南图')).toBe(true);
  });

  it('本地保存写缓存并下载同名 JSON', () => {
    const { onSave } = renderEditor();
    fillMapName('荆南图');
    fireEvent.click(screen.getByTestId('editor-save-local'));

    expect(downloadTextFile).toHaveBeenCalledTimes(1);
    expect((downloadTextFile as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0]).toBe('荆南图.json');
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it('地图名为空时两个保存按钮都不可用', () => {
    renderEditor();
    expect(screen.getByTestId('editor-save-cache')).toBeDisabled();
    expect(screen.getByTestId('editor-save-local')).toBeDisabled();
  });
});

/** 造一张 4×4 的既有自定义地图，返回其 id */
function seedCustomMap(name: string): string {
  const size = 4;
  const payload: EditorMapPayload = {
    schemaVersion: 2,
    width: size,
    height: size,
    backgroundImage: '',
    grid: Array.from({ length: size * size }, (_, i) => ({
      q: i % size,
      r: Math.floor(i / size),
      terrain: 'plain' as const,
    })),
    cities: [],
    plots: [],
  };
  return addSessionMap(payload, name);
}

describe('MapEditorScreen 既有地图的保存', () => {
  beforeEach(() => vi.clearAllMocks());

  it('进入编辑时地图名预填原名', () => {
    const id = seedCustomMap('荆南图');
    render(<MapEditorScreen mapId={id} onSave={vi.fn()} onBack={vi.fn()} />);
    expect(screen.getByLabelText('地图名')).toHaveValue('荆南图');
  });

  it('改了名字保存会另存为新地图，原图保留', () => {
    const id = seedCustomMap('荆南图');
    render(<MapEditorScreen mapId={id} onSave={vi.fn()} onBack={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('地图名'), { target: { value: '荆南新图' } });
    fireEvent.click(screen.getByTestId('editor-save-cache'));

    const names = listMaps().filter((map) => !map.builtin).map((map) => map.name).sort();
    expect(names).toEqual(['荆南图', '荆南新图']);
  });

  it('沿用原名保存则覆盖原图，不新增', () => {
    const id = seedCustomMap('荆南图');
    render(<MapEditorScreen mapId={id} onSave={vi.fn()} onBack={vi.fn()} />);
    fireEvent.click(screen.getByTestId('editor-save-cache'));

    const customs = listMaps().filter((map) => !map.builtin);
    expect(customs).toHaveLength(1);
    expect(customs[0].id).toBe(id);
    expect(customs[0].name).toBe('荆南图');
  });

  it('内置图改名后缓存保存会生成新的自定义地图，不再刷新即丢', () => {
    render(<MapEditorScreen mapId="china42x" onSave={vi.fn()} onBack={vi.fn()} />);
    expect(screen.getByLabelText('地图名')).toHaveValue('荆襄地图');

    fireEvent.change(screen.getByLabelText('地图名'), { target: { value: '我的荆襄' } });
    fireEvent.click(screen.getByTestId('editor-save-cache'));

    expect(listMaps().filter((map) => !map.builtin).map((map) => map.name)).toEqual(['我的荆襄']);
    // 内置图本身仍在，未被顶掉
    expect(listMaps().some((map) => map.builtin && map.id === 'china42x')).toBe(true);
  });

  it('打开内置图编辑时，原版建设用地已载入，保存会一并带走', () => {
    const onSave = vi.fn();
    render(<MapEditorScreen mapId="china42x" onSave={onSave} onBack={vi.fn()} />);

    fireEvent.change(screen.getByLabelText('地图名'), { target: { value: '我的荆襄' } });
    fireEvent.click(screen.getByTestId('editor-save-cache'));

    // 编辑器载入多少建设用地，保存就带出多少 —— 一格不丢
    const payload = savedPayload(onSave);
    const source = china42Data as unknown as {
      plots?: unknown[];
      cities?: Array<{ interior?: unknown[] }>;
    };
    const expectedCount = source.plots?.length
      ?? (source.cities ?? []).reduce((sum, city) => sum + (city.interior?.length ?? 0), 0);
    expect(expectedCount).toBeGreaterThan(0);
    expect(payload.plots).toHaveLength(expectedCount);
    expect(payload.plots?.some((plot) => plot.cityId === 'xiangping' && plot.q === 176 && plot.r === 21)).toBe(true);
  });
});
