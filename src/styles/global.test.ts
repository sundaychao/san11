import { describe, expect, it } from 'vitest';
import css from './global.css?raw';

function cssRule(selector: string) {
  const escapedSelector = selector.replaceAll('.', '\\.');
  const match = css.match(new RegExp(`${escapedSelector}\\s*\\{([^}]*)\\}`));
  return match?.[1] ?? '';
}

describe('global map styles', () => {
  it('keeps normal terrain grid lines thin so they do not dominate the map', () => {
    const normalRule = cssRule('.battle-cell');
    const editingRule = cssRule('.battle-grid-overlay.is-editing .battle-cell');
    const normalStrokeWidth = Number(normalRule.match(/stroke-width:\s*([\d.]+)/)?.[1]);
    const editingStrokeWidth = Number(editingRule.match(/stroke-width:\s*([\d.]+)/)?.[1]);

    expect(normalStrokeWidth).toBeLessThanOrEqual(0.45);
    expect(editingStrokeWidth).toBeLessThanOrEqual(0.45);
  });

  it('draws move targets as white outlines without covering terrain fill colors', () => {
    const rule = cssRule('.battle-grid-overlay.is-moving .battle-cell.is-move-target');
    const strokeWidth = Number(rule.match(/stroke-width:\s*([\d.]+)/)?.[1]);

    expect(rule).toContain('stroke: rgba(255, 255, 255');
    expect(strokeWidth).toBeLessThanOrEqual(1.2);
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
});
