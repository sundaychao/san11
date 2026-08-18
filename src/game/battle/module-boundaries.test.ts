import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { initSync, parse } from 'es-module-lexer';
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

const skillRoot = resolve('src/game/skills');
initSync();

function skillModuleFiles() {
  return readdirSync(skillRoot, { recursive: true })
    .filter((name): name is string => typeof name === 'string' && name.endsWith('.ts') && !name.endsWith('.test.ts'))
    .map((name) => resolve(skillRoot, name));
}

function moduleSpecifiers(filename: string, runtimeOnly = false) {
  const source = readFileSync(filename, 'utf8');
  const [imports] = parse(source, filename);
  return imports.flatMap((entry) => {
    if (!entry.n) return [];
    const statement = source.slice(entry.ss, entry.se);
    if (runtimeOnly && /^\s*import\s+type\b/.test(statement)) return [];
    return [entry.n];
  });
}

function resolveSkillDependency(filename: string, specifier: string) {
  if (!specifier.startsWith('.')) return null;
  const imported = resolve(dirname(filename), specifier);
  for (const candidate of [`${imported}.ts`, resolve(imported, 'index.ts')]) {
    if (candidate.startsWith(skillRoot) && existsSync(candidate)) return candidate;
  }
  return null;
}

function skillRuntimeCycle() {
  const files = skillModuleFiles();
  const graph = new Map(files.map((filename) => [
    filename,
    moduleSpecifiers(filename, true)
      .map((specifier) => resolveSkillDependency(filename, specifier))
      .filter((dependency): dependency is string => dependency !== null),
  ]));
  const visited = new Set<string>();
  const active = new Set<string>();
  const path: string[] = [];

  const visit = (filename: string): string[] | null => {
    if (active.has(filename)) {
      return [...path.slice(path.indexOf(filename)), filename]
        .map((entry) => relative(skillRoot, entry).replaceAll('\\', '/'));
    }
    if (visited.has(filename)) return null;
    active.add(filename);
    path.push(filename);
    for (const dependency of graph.get(filename) ?? []) {
      const cycle = visit(dependency);
      if (cycle) return cycle;
    }
    path.pop();
    active.delete(filename);
    visited.add(filename);
    return null;
  };

  for (const filename of files) {
    const cycle = visit(filename);
    if (cycle) return cycle;
  }
  return null;
}

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
    for (const filename of skillModuleFiles()) {
      const source = readFileSync(filename, 'utf8');
      expect(source).not.toMatch(/from ['"]react|window\.|document\.|soundEffects|socket\.io/);
      expect(moduleSpecifiers(filename)).not.toEqual(expect.arrayContaining([
        expect.stringMatching(/(^|\/)(components|network)(\/|$)/),
      ]));
    }
  });

  it('keeps every skill module free of runtime dependency cycles', () => {
    expect(skillRuntimeCycle()).toBeNull();
  });
});
