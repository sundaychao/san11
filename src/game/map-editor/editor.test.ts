import { describe, expect, it } from 'vitest';
import { PLOT_COUNT_BY_SIZE } from '../innerAffairs';
import { createBattleGrid, GRID_HEIGHT, GRID_WIDTH } from '../battle/scenario';
import type { GridCell } from '../types';
import {
  assignPlot,
  autoAssignEditorPlots,
  autoPlotsForCity,
  clearEditor,
  createBlankMap,
  createEditorState,
  eraseStronghold,
  exportEditorJson,
  exportEditorSvg,
  exportTerrainMaskSvgs,
  exportTerrainControlSvg,
  importEditorJson,
  paintTerrain,
  placeCity,
  placePass,
  redoEditor,
  TERRAIN_CONTROL_COLORS,
  undoEditor,
} from './editor';

describe('map editor core', () => {
  it('paints a single terrain cell without mutating the source grid', () => {
    const sourceGrid = createBattleGrid();
    const state = createEditorState(sourceGrid);

    const edited = paintTerrain(state, { q: 0, r: 0 }, 'mountain');

    expect(sourceGrid.find((cell) => cell.q === 0 && cell.r === 0)?.terrain).toBe('plain');
    expect(edited.grid.find((cell) => cell.q === 0 && cell.r === 0)?.terrain).toBe('mountain');
    expect(edited.history).toHaveLength(1);
  });

  it('undoes and redoes terrain edits', () => {
    const state = createEditorState(createBattleGrid());
    const edited = paintTerrain(state, { q: 3, r: 3 }, 'forest');

    const undone = undoEditor(edited);
    const redone = redoEditor(undone);

    expect(undone.grid.find((cell) => cell.q === 3 && cell.r === 3)?.terrain).toBe(
      state.grid.find((cell) => cell.q === 3 && cell.r === 3)?.terrain,
    );
    expect(redone.grid.find((cell) => cell.q === 3 && cell.r === 3)?.terrain).toBe('forest');
  });

  it('places seven-cell city markers in exports', () => {
    const state = createEditorState(createBattleGrid());
    const edited = placeCity(state, { id: 'city-1', label: '新城', q: 6, r: 6 });

    const json = JSON.parse(exportEditorJson(edited));
    const svg = exportEditorSvg(edited);

    expect(json.cities).toEqual([{ id: 'city-1', label: '新城', q: 6, r: 6, type: 'city', forceId: null }]);
    expect(svg).toContain('data-city-id="city-1"');
    expect(svg.match(/data-city-cell="city-1/g)).toHaveLength(7);
  });

  it('clears terrain and exports a versioned grid payload', () => {
    const edited = clearEditor(createEditorState(createBattleGrid()), 'plain');
    const json = JSON.parse(exportEditorJson(edited));

    expect(json.schemaVersion).toBe(2);
    expect(json.width).toBe(GRID_WIDTH);
    expect(json.height).toBe(GRID_HEIGHT);
    expect(json.grid).toHaveLength(GRID_WIDTH * GRID_HEIGHT);
    expect(json.grid.every((cell: { terrain: string }) => cell.terrain === 'plain')).toBe(true);
  });

  it('imports a versioned grid payload into the editor state', () => {
    const source = createEditorState(createBattleGrid());
    const payload = JSON.parse(exportEditorJson(source));
    payload.backgroundImage = 'exports/generated-map.png';
    payload.grid = payload.grid.map((cell: { q: number; r: number; terrain: string }) => (
      cell.q === 0 && cell.r === 0 ? { ...cell, terrain: 'forest' } : cell
    ));
    payload.cities = [{ id: 'jiangling', label: '江陵', q: 10, r: 12 }];

    const imported = importEditorJson(source, JSON.stringify(payload));

    expect(imported.backgroundImage).toBe('exports/generated-map.png');
    expect(imported.grid.find((cell) => cell.q === 0 && cell.r === 0)?.terrain).toBe('forest');
    expect(imported.cities).toEqual([{ id: 'jiangling', label: '江陵', q: 10, r: 12, type: 'city', forceId: null }]);
    expect(imported.history).toHaveLength(1);
  });

  it('rejects invalid editor map json', () => {
    const source = createEditorState(createBattleGrid());
    const payload = JSON.parse(exportEditorJson(source));
    payload.grid[0].terrain = 'lava';

    expect(() => importEditorJson(source, JSON.stringify(payload))).toThrow('地图 JSON 无效');
  });

  it('imports and re-exports custom size maps with their dimensions', () => {
    const width = 12;
    const height = 9;
    const grid: GridCell[] = [];
    for (let q = 0; q < width; q += 1) {
      for (let r = 0; r < height; r += 1) grid.push({ q, r, terrain: 'plain' });
    }
    const source = createEditorState(grid, [{ id: 'luoyang', label: '洛阳', q: 6, r: 4 }], width, height);

    const payload = JSON.parse(exportEditorJson(source));
    expect(payload.width).toBe(width);
    expect(payload.height).toBe(height);
    payload.grid = payload.grid.map((cell: { q: number; r: number; terrain: string }) => (
      cell.q === 5 && cell.r === 5 ? { ...cell, terrain: 'water' } : cell
    ));

    const imported = importEditorJson(source, JSON.stringify(payload));

    expect(imported.width).toBe(width);
    expect(imported.height).toBe(height);
    expect(imported.grid.find((cell) => cell.q === 5 && cell.r === 5)?.terrain).toBe('water');
  });

  it('rejects custom size maps whose markers fall outside the declared bounds', () => {
    const width = 12;
    const height = 9;
    const grid: GridCell[] = [];
    for (let q = 0; q < width; q += 1) {
      for (let r = 0; r < height; r += 1) grid.push({ q, r, terrain: 'plain' });
    }
    const source = createEditorState(grid, [], width, height);
    const payload = JSON.parse(exportEditorJson(source));
    payload.cities = [{ id: 'bad', label: '越界', q: 50, r: 50 }];

    expect(() => importEditorJson(source, JSON.stringify(payload))).toThrow('地图 JSON 无效');
  });

  it('exports a terrain control svg with exact staggered grid metadata', () => {
    const state = createEditorState(createBattleGrid(), [{ id: 'jiangling', label: '江陵', q: 34, r: 22 }]);

    const svg = exportTerrainControlSvg(state);

    expect(svg).toContain('data-export="terrain-control"');
    expect(svg).toContain(`data-grid-width="${GRID_WIDTH}"`);
    expect(svg).toContain(`data-grid-height="${GRID_HEIGHT}"`);
    expect(svg).toContain('data-cell-shape="staggered-square-even-columns-up-half"');
    expect(svg).toContain('data-q="0" data-r="0" data-terrain="plain" x="0" y="-12"');
    expect(svg).toContain('data-q="1" data-r="0" data-terrain="plain" x="24" y="0"');
    expect(svg).toContain('data-terrain="forest"');
    // 森林控制色取自色板，调色时不写死字面值（`#1a5228`）
    expect(svg).toContain(`fill="${TERRAIN_CONTROL_COLORS.forest}"`);
    expect(svg).toContain('data-control-city="jiangling:34,22"');
    expect(svg).not.toContain('<text');
  });

  it('exports layered terrain mask svgs for generation control', () => {
    const state = createEditorState(createBattleGrid(), [{ id: 'jiangling', label: '江陵', q: 34, r: 22 }]);

    const masks = exportTerrainMaskSvgs(state);

    expect(Object.keys(masks)).toEqual(['water', 'mountain', 'forest', 'road', 'city']);
    expect(masks.water.filename).toBe('mask-water.svg');
    expect(masks.water.content).toContain('data-export="terrain-mask"');
    expect(masks.water.content).toContain('data-mask-layer="water"');
    expect(masks.water.content).toContain('data-source-terrain="water"');
    expect(masks.mountain.content).toContain('data-source-terrain="mountain"');
    expect(masks.forest.content).toContain('data-source-terrain="forest"');
    expect(masks.road.content).toContain('data-source-terrain="road"');
    expect(masks.city.content).toContain('data-mask-layer="city"');
    expect(masks.city.content).toContain('data-control-city="jiangling:34,22"');
    expect(masks.water.content).not.toContain('<text');
  });

  it('creates a blank 200x200 all-plain map with no markers', () => {
    const blank = createBlankMap();

    expect(blank.width).toBe(200);
    expect(blank.height).toBe(200);
    expect(blank.grid).toHaveLength(200 * 200);
    expect(blank.grid.every((cell) => cell.terrain === 'plain')).toBe(true);
    expect(blank.cities).toEqual([]);
  });

  it('places and serializes a pass marker with force assignment', () => {
    const state = createEditorState(createBattleGrid());
    const edited = placePass(state, { id: 'pass-1', label: '关隘', q: 5, r: 5, type: 'pass', forceId: 'cao' });

    const json = JSON.parse(exportEditorJson(edited));
    expect(json.cities).toEqual([{ id: 'pass-1', label: '关隘', q: 5, r: 5, type: 'pass', forceId: 'cao' }]);
  });

  it('erases a stronghold and resets its footprint to plain', () => {
    const source = createEditorState(createBattleGrid());
    const painted = paintTerrain(source, { q: 5, r: 5 }, 'mountain');
    const placed = placeCity(painted, { id: 'city-x', label: 'X', q: 5, r: 5 });

    const erased = eraseStronghold(placed, 'city-x');

    expect(erased.cities).toEqual([]);
    expect(erased.grid.find((cell) => cell.q === 5 && cell.r === 5)?.terrain).toBe('plain');
  });

  it('upgrades a v1 payload with an embedded passes array', () => {
    const source = createEditorState(createBattleGrid());
    const v1 = {
      schemaVersion: 1,
      width: GRID_WIDTH,
      height: GRID_HEIGHT,
      backgroundImage: '',
      grid: source.grid.map((cell) => ({ ...cell })),
      cities: [{ id: 'c', label: '城', q: 2, r: 2 }],
      passes: [{ id: 'p', label: '关', q: 9, r: 9 }],
    };

    const imported = importEditorJson(source, JSON.stringify(v1));

    expect(imported.cities).toEqual([
      { id: 'c', label: '城', q: 2, r: 2, type: 'city', forceId: null },
      { id: 'p', label: '关', q: 9, r: 9, type: 'pass', forceId: null },
    ]);
  });
});

describe('map editor 建设用地归属 (plots)', () => {
  function base() {
    return createEditorState(
      createBattleGrid(),
      [
        { id: 'city-a', label: '甲城', q: 8, r: 8, type: 'city', forceId: null },
        { id: 'city-b', label: '乙城', q: 20, r: 20, type: 'city', forceId: null },
      ],
      GRID_WIDTH,
      GRID_HEIGHT,
    );
  }

  it('assigns a plot coord to an existing city', () => {
    const state = base();
    const edited = assignPlot(state, 'city-a', { q: 9, r: 8 });

    expect(edited.plots).toEqual([{ cityId: 'city-a', q: 9, r: 8 }]);
    expect(edited.history.length).toBeGreaterThan(0);
  });

  it('re-assigns one coord from one city to another (一格一主)', () => {
    const state = assignPlot(base(), 'city-a', { q: 9, r: 8 });
    const edited = assignPlot(state, 'city-b', { q: 9, r: 8 });

    expect(edited.plots).toEqual([{ cityId: 'city-b', q: 9, r: 8 }]);
  });

  it('cancels a plot assignment with null cityId', () => {
    const state = assignPlot(base(), 'city-a', { q: 9, r: 8 });
    const edited = assignPlot(state, null, { q: 9, r: 8 });

    expect(edited.plots).toEqual([]);
  });

  it('ignores assignment when the target city does not exist', () => {
    const edited = assignPlot(base(), 'ghost', { q: 9, r: 8 });

    expect(edited.plots).toEqual([]);
  });

  it('never assigns a plot onto a city center coord', () => {
    const edited = assignPlot(base(), 'city-a', { q: 8, r: 8 });

    expect(edited.plots).toEqual([]);
  });

  it('round-trips plots through export and import', () => {
    const state = assignPlot(assignPlot(base(), 'city-a', { q: 9, r: 8 }), 'city-b', { q: 21, r: 20 });
    const json = JSON.parse(exportEditorJson(state));
    expect(json.plots).toEqual([
      { cityId: 'city-a', q: 9, r: 8 },
      { cityId: 'city-b', q: 21, r: 20 },
    ]);

    const imported = importEditorJson(base(), JSON.stringify(json));
    expect(imported.plots).toEqual(json.plots);
  });

  it('drops orphan plots and duplicate coords on import (一格一主)', () => {
    const source = base();
    const payload = JSON.parse(exportEditorJson(source));
    payload.cities = [
      { id: 'city-a', label: '甲城', q: 8, r: 8, type: 'city', forceId: null },
      { id: 'city-c', label: '丙城', q: 30, r: 30, type: 'city', forceId: null },
    ];
    payload.plots = [
      { cityId: 'city-a', q: 9, r: 8 },
      { cityId: 'ghost', q: 1, r: 1 },      // 指向不存在的城 → 丢弃
      { cityId: 'city-c', q: 31, r: 30 },
      { cityId: 'city-c', q: 31, r: 30 },   // 重复坐标 → 保留首次
    ];

    const imported = importEditorJson(source, JSON.stringify(payload));
    expect(imported.plots).toEqual([
      { cityId: 'city-a', q: 9, r: 8 },
      { cityId: 'city-c', q: 31, r: 30 },
    ]);
  });

  it('releases a city plots when its stronghold is erased', () => {
    const state = assignPlot(assignPlot(base(), 'city-a', { q: 9, r: 8 }), 'city-b', { q: 21, r: 20 });
    const edited = eraseStronghold(state, 'city-a');

    expect(edited.plots).toEqual([{ cityId: 'city-b', q: 21, r: 20 }]);
  });

  it('undo restores prior plots state and redo reapplies it', () => {
    const state = base();
    const assigned = assignPlot(state, 'city-a', { q: 9, r: 8 });
    const undone = undoEditor(assigned);
    const redone = redoEditor(undone);

    expect(undone.plots).toEqual([]);
    expect(redone.plots).toEqual([{ cityId: 'city-a', q: 9, r: 8 }]);
  });

  it('exported svg includes plot-cell markers', () => {
    const svg = exportEditorSvg(assignPlot(base(), 'city-a', { q: 9, r: 8 }));
    expect(svg).toContain('data-plot-cell="city-a:9,8"');
  });
});

describe('autoAssignEditorPlots（新建地图自动分配建设用地）', () => {
  const build = (cities: Parameters<typeof createEditorState>[1]) =>
    createEditorState(createBattleGrid(), cities, GRID_WIDTH, GRID_HEIGHT);

  it('为没有建设用地的城池自动圈地，规模取默认中城档位', () => {
    const next = autoAssignEditorPlots(build([{ id: 'city-a', label: '甲城', q: 8, r: 8, type: 'city' }]));

    expect(next.plots).toHaveLength(PLOT_COUNT_BY_SIZE.medium);
    expect(next.plots.every((plot) => plot.cityId === 'city-a')).toBe(true);
    // 城址 7 格内不得占用
    expect(next.plots.every((plot) => Math.abs(plot.q - 8) + Math.abs(plot.r - 8) > 1)).toBe(true);
  });

  it('幂等：已有建设用地的城池不重算也不追加', () => {
    const once = autoAssignEditorPlots(build([{ id: 'city-a', label: '甲城', q: 8, r: 8, type: 'city' }]));

    expect(autoAssignEditorPlots(once)).toBe(once);
  });

  it('多城各自圈地且不重叠（一格一主）', () => {
    const next = autoAssignEditorPlots(build([
      { id: 'city-a', label: '甲城', q: 8, r: 8, type: 'city' },
      { id: 'city-b', label: '乙城', q: 20, r: 20, type: 'city' },
    ]));
    const keys = next.plots.map((plot) => `${plot.q},${plot.r}`);

    expect(next.plots).toHaveLength(PLOT_COUNT_BY_SIZE.medium * 2);
    expect(new Set(keys).size).toBe(keys.length);
    expect(next.plots.filter((plot) => plot.cityId === 'city-a')).toHaveLength(PLOT_COUNT_BY_SIZE.medium);
    expect(next.plots.filter((plot) => plot.cityId === 'city-b')).toHaveLength(PLOT_COUNT_BY_SIZE.medium);
  });

  it('关隘不分配建设用地', () => {
    const next = autoAssignEditorPlots(build([{ id: 'pass-a', label: '关', q: 8, r: 8, type: 'pass' }]));

    expect(next.plots).toEqual([]);
  });

  it('没有城池时不改动原状态', () => {
    const state = build([]);

    expect(autoAssignEditorPlots(state)).toBe(state);
  });

  it('全为水面时无处可选，不强行分配', () => {
    const grid = createBlankMap(40, 40).grid.map((cell) => ({ ...cell, terrain: 'sea' as const }));
    const state = createEditorState(grid, [{ id: 'city-a', label: '海城', q: 20, r: 20, type: 'city' }], 40, 40);

    expect(autoAssignEditorPlots(state).plots).toEqual([]);
  });
});

describe('map editor 建设用地的归属口径', () => {
  const build = (cities: Parameters<typeof createEditorState>[1]) =>
    createEditorState(createBattleGrid(), cities, GRID_WIDTH, GRID_HEIGHT);

  it('导出总是写出 plots 与 plotsSpecified（圈地为空也写）', () => {
    const json = JSON.parse(exportEditorJson(createBlankMap(8, 8), '空白图')) as {
      plots?: unknown[];
      plotsSpecified?: boolean;
    };

    expect(json.plots).toEqual([]);
    expect(json.plotsSpecified).toBe(true);

    // 导入编辑器后再次保存，标记仍在（不会因为一次导入就丢掉口径）
    const imported = importEditorJson(createBlankMap(8, 8), JSON.stringify(json));
    const reexported = JSON.parse(exportEditorJson(imported)) as { plotsSpecified?: boolean };
    expect(reexported.plotsSpecified).toBe(true);
  });

  it('autoAssignEditorPlots 传 cityId 时只补该城，留空的其他城保持原样', () => {
    const cities = [
      { id: 'city-a', label: '甲城', q: 8, r: 8, type: 'city' as const },
      { id: 'city-b', label: '乙城', q: 20, r: 20, type: 'city' as const },
    ];
    const next = autoAssignEditorPlots(build(cities), 'city-a');

    expect(next.plots).toHaveLength(PLOT_COUNT_BY_SIZE.medium);
    expect(next.plots.every((plot) => plot.cityId === 'city-a')).toBe(true);
  });

  it('autoPlotsForCity 忽略本城现有地格，可把本城整体重置为标准一份', () => {
    const assigned = assignPlot(
      build([{ id: 'city-a', label: '甲城', q: 8, r: 8, type: 'city' }]),
      'city-a',
      { q: 8, r: 20 },
    );
    const picked = autoPlotsForCity(assigned, 'city-a');
    const keys = picked.map((plot) => `${plot.q},${plot.r}`);

    expect(picked).toHaveLength(PLOT_COUNT_BY_SIZE.medium);
    expect(picked.every((plot) => plot.cityId === 'city-a')).toBe(true);
    expect(new Set(keys).size).toBe(keys.length);
    // 重置后只剩标准一份，不含原来那格更远的手工圈地
    expect(keys).not.toContain('8,20');
  });

  it('autoPlotsForCity 对不存在的城返回空', () => {
    expect(autoPlotsForCity(build([{ id: 'city-a', label: '甲城', q: 8, r: 8, type: 'city' }]), 'city-z')).toEqual([]);
  });
});
