import { describe, expect, it } from 'vitest';
import css from './global.css?raw';

function cssRule(selector: string) {
  const escapedSelector = selector.replaceAll('.', '\\.');
  const match = css.match(new RegExp(`${escapedSelector}\\s*\\{([^}]*)\\}`));
  return match?.[1] ?? '';
}

describe('global map styles', () => {
  it('keeps normal terrain grid lines thin but editor grid lines clearer for cell editing', () => {
    const normalRule = cssRule('.battle-cell');
    const editingRule = cssRule('.battle-grid-overlay.is-editing .battle-cell');
    const normalStrokeWidth = Number(normalRule.match(/stroke-width:\s*([\d.]+)/)?.[1]);
    const editingStrokeWidth = Number(editingRule.match(/stroke-width:\s*([\d.]+)/)?.[1]);

    // 普通视图：格线细、不夺主
    expect(normalStrokeWidth).toBeLessThanOrEqual(0.45);
    // 编辑器模式：格线加粗清晰，便于逐格辨识与绘制地形
    expect(editingStrokeWidth).toBeGreaterThanOrEqual(0.8);
  });

  it('gives the editor canvas a full-height map region so the grid is visible', () => {
    const rule = cssRule('.map-editor-screen .map-editor-canvas .map-region');
    expect(rule).toContain('height: 100%');
    expect(rule).toContain('width: 100%');
  });

  it('draws move targets as yellow outlines without covering terrain fill colors', () => {
    const rule = cssRule('.battle-grid-overlay.is-moving .battle-cell.is-move-target');
    const strokeWidth = Number(rule.match(/stroke-width:\s*([\d.]+)/)?.[1]);

    expect(rule).toContain('stroke: rgba(255, 210, 60');
    expect(strokeWidth).toBeLessThanOrEqual(1.2);
    expect(rule).not.toMatch(/(?:^|;)\s*fill\s*:/);
  });

  it('draws deployment range as yellow outlines like normal movement range', () => {
    const rule = cssRule('.battle-grid-overlay.is-deploying .battle-cell.is-deploy-target');
    const strokeWidth = Number(rule.match(/stroke-width:\s*([\d.]+)/)?.[1]);

    expect(rule).toContain('stroke: rgba(255, 210, 60');
    expect(strokeWidth).toBeLessThanOrEqual(1.2);
    expect(rule).not.toMatch(/(?:^|;)\s*fill\s*:/);
  });

  it('draws delegated movement paths as white outlines without covering terrain fill colors', () => {
    const rule = cssRule('.battle-grid-overlay.is-moving .battle-cell.is-delegate-path');

    expect(rule).toContain('stroke: rgba(255, 255, 255');
    expect(rule).not.toMatch(/(?:^|;)\s*fill\s*:/);
  });

  it('keeps the officer list table as the mouse-scrollable dialog area', () => {
    const dialogRule = cssRule('.officer-list-dialog');
    const tableWrapRule = cssRule('.officer-table-wrap');

    expect(dialogRule).toContain('grid-template-rows: auto auto minmax(0, 1fr)');
    expect(tableWrapRule).toContain('max-height: 100%');
    expect(tableWrapRule).toContain('overflow-y: auto');
    expect(tableWrapRule).toContain('overscroll-behavior: contain');
  });

  it('positions the online turn prompt as a large centered banner below the top bar', () => {
    const rule = cssRule('.turn-prompt');
    const minHeight = Number(rule.match(/min-height:\s*(\d+)px/)?.[1]);
    const fontSize = Number(rule.match(/font-size:\s*(\d+)px/)?.[1]);

    expect(rule).toContain('position: fixed');
    expect(rule).toContain('top: 76px');
    expect(rule).toContain('left: 50%');
    expect(rule).toContain('transform: translateX(-50%)');
    expect(minHeight).toBeGreaterThanOrEqual(56);
    expect(fontSize).toBeGreaterThanOrEqual(18);
  });

  it('keeps the unit hover panel compact without losing its scroll boundary', () => {
    const rule = cssRule('.unit-info-panel');

    expect(Number(rule.match(/width:\s*(\d+)px/)?.[1])).toBeLessThanOrEqual(158);
    expect(rule).toContain('padding: 5px');
    expect(rule).toContain('overflow-y: auto');
  });
});
