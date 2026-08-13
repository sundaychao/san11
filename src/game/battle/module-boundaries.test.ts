import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const modules = [
  'definitions',
  'shared',
  'movement',
  'facilities',
  'combat',
  'tactics',
  'strategies',
  'deployment',
];

describe('battle module boundaries', () => {
  it('keeps actions as a compatibility export surface', () => {
    const source = readFileSync('src/game/battle/actions.ts', 'utf8');

    expect(source.split(/\r?\n/).length).toBeLessThan(120);
    expect(source).not.toMatch(/function\s+(movementCost|damageRoll|applyTacticDamage|igniteGroundFire)/);
  });

  it.each(modules)('%s has no frontend dependency', (name) => {
    const filename = `src/game/battle/${name}.ts`;
    expect(existsSync(filename)).toBe(true);
    if (!existsSync(filename)) return;

    const source = readFileSync(filename, 'utf8');
    expect(source).not.toMatch(/from ['"]react|window\.|document\.|soundEffects|socket\.io/);
  });
});
