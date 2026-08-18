import { existsSync, readFileSync, readdirSync } from 'node:fs';
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

  it('keeps every skill module independent from frontend and networking', () => {
    const files = readdirSync('src/game/skills', { recursive: true })
      .filter((name): name is string => typeof name === 'string' && name.endsWith('.ts') && !name.endsWith('.test.ts'));
    for (const file of files) {
      const source = readFileSync(`src/game/skills/${file}`, 'utf8');
      expect(source).not.toMatch(/from ['"]react|window\.|document\.|soundEffects|socket\.io/);
    }
  });
});
