import { describe, expect, it } from 'vitest';
import { createBattleGrid, GRID_HEIGHT, GRID_WIDTH } from '../battle/scenario';
import {
  clearEditor,
  createEditorState,
  exportEditorJson,
  exportEditorSvg,
  paintTerrain,
  placeCity,
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

    expect(json.cities).toEqual([{ id: 'city-1', label: '新城', q: 6, r: 6 }]);
    expect(svg).toContain('data-city-id="city-1"');
    expect(svg.match(/data-city-cell="city-1/g)).toHaveLength(7);
  });

  it('clears terrain and exports a versioned grid payload', () => {
    const edited = clearEditor(createEditorState(createBattleGrid()), 'plain');
    const json = JSON.parse(exportEditorJson(edited));

    expect(json.schemaVersion).toBe(1);
    expect(json.width).toBe(GRID_WIDTH);
    expect(json.height).toBe(GRID_HEIGHT);
    expect(json.grid).toHaveLength(GRID_WIDTH * GRID_HEIGHT);
    expect(json.grid.every((cell: { terrain: string }) => cell.terrain === 'plain')).toBe(true);
  });
});
