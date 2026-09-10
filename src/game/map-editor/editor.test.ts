import { describe, expect, it } from 'vitest';
import { createBattleGrid, GRID_HEIGHT, GRID_WIDTH } from '../battle/scenario';
import type { GridCell } from '../types';
import {
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
    expect(svg).toContain('fill="#3a7048"');
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
