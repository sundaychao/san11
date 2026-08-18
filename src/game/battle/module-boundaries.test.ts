import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, extname, isAbsolute, join, relative, resolve } from 'node:path';
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

interface ModuleReference {
  specifier: string;
  runtime: boolean;
}

function posixPath(path: string) {
  return path.replaceAll('\\', '/');
}

function comparePaths(left: string, right: string) {
  const normalizedLeft = posixPath(left);
  const normalizedRight = posixPath(right);
  return normalizedLeft < normalizedRight ? -1 : normalizedLeft > normalizedRight ? 1 : 0;
}

function isProductionTypeScriptFile(name: string) {
  const normalized = posixPath(name);
  const segments = normalized.split('/');
  const basename = segments.at(-1) ?? '';
  return /\.tsx?$/.test(basename) &&
    !/\.d\.tsx?$/.test(basename) &&
    !/\.(?:test|spec)\.tsx?$/.test(basename) &&
    !segments.some((segment) => segment === '__tests__' || segment === 'test' || segment === 'tests');
}

function skillModuleFiles(root = skillRoot) {
  return readdirSync(root, { recursive: true })
    .filter((name): name is string => typeof name === 'string' && isProductionTypeScriptFile(name))
    .map((name) => resolve(root, name))
    .filter((filename) => statSync(filename).isFile())
    .sort(comparePaths);
}

function sourceWithTypeReexportsVisible(source: string) {
  return source.replace(/\bexport(\s+)type(?=\s*(?:\{|\*))/g, (_match, whitespace: string) => (
    `export${whitespace}    `
  ));
}

function stripComments(statement: string) {
  return statement
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/.*$/gm, ' ');
}

function isTypeOnlyStatement(statement: string) {
  const normalized = stripComments(statement).trim();
  if (/^(?:import|export)\s+type\b/.test(normalized)) return true;

  const named = normalized.match(/^(?:import|export)\s*\{([\s\S]*?)\}\s*from\b/);
  if (!named) return false;
  const bindings = named[1].split(',').map((binding) => binding.trim()).filter(Boolean);
  return bindings.length > 0 && bindings.every((binding) => /^type\s+(?!as(?:\s|$))/.test(binding));
}

function moduleReferences(filename: string): ModuleReference[] {
  const source = readFileSync(filename, 'utf8');
  const [imports] = parse(sourceWithTypeReexportsVisible(source), filename);
  return imports.flatMap((entry) => {
    if (!entry.n) return [];
    const statement = source.slice(entry.ss, entry.se);
    return [{ specifier: entry.n, runtime: entry.d >= 0 || !isTypeOnlyStatement(statement) }];
  });
}

function moduleSpecifiers(filename: string, runtimeOnly = false) {
  return moduleReferences(filename)
    .filter((reference) => !runtimeOnly || reference.runtime)
    .map((reference) => reference.specifier);
}

function pathIsWithin(root: string, filename: string) {
  const pathFromRoot = posixPath(relative(root, filename));
  return pathFromRoot !== '' && pathFromRoot !== '..' && !pathFromRoot.startsWith('../') && !isAbsolute(pathFromRoot);
}

function resolveSkillDependency(filename: string, specifier: string, root = skillRoot, files = skillModuleFiles(root)) {
  if (!specifier.startsWith('.')) return null;
  const imported = resolve(dirname(filename), specifier);
  const candidates = extname(imported) === '.ts' || extname(imported) === '.tsx'
    ? [imported]
    : [`${imported}.ts`, `${imported}.tsx`, resolve(imported, 'index.ts'), resolve(imported, 'index.tsx')];
  const available = new Set(files);
  for (const candidate of candidates) {
    if (pathIsWithin(root, candidate) && available.has(candidate)) return candidate;
  }
  return null;
}

function skillRuntimeCycle(root = skillRoot) {
  const files = skillModuleFiles(root);
  const graph = new Map(files.map((filename) => [
    filename,
    [...new Set(moduleSpecifiers(filename, true)
      .map((specifier) => resolveSkillDependency(filename, specifier, root, files))
      .filter((dependency): dependency is string => dependency !== null))]
      .sort(comparePaths),
  ]));
  const visited = new Set<string>();
  const active = new Set<string>();
  const path: string[] = [];

  const visit = (filename: string): string[] | null => {
    if (active.has(filename)) {
      return [...path.slice(path.indexOf(filename)), filename]
        .map((entry) => posixPath(relative(root, entry)));
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

function isForbiddenModuleSpecifier(filename: string, specifier: string) {
  const normalized = posixPath(specifier);
  if (
    normalized === 'react' || normalized.startsWith('react/') ||
    normalized === 'react-dom' || normalized.startsWith('react-dom/') ||
    normalized === 'lucide-react' || normalized.startsWith('socket.io')
  ) {
    return true;
  }

  const specifierSegments = normalized.split('/').filter((segment) => segment && segment !== '.' && segment !== '..');
  const resolvedSegments = specifier.startsWith('.')
    ? posixPath(resolve(dirname(filename), specifier)).split('/').filter(Boolean)
    : [];
  return [...specifierSegments, ...resolvedSegments]
    .some((segment) => segment === 'components' || segment === 'network' || segment === 'audio');
}

function forbiddenSkillDependencies(root = skillRoot) {
  return skillModuleFiles(root).flatMap((filename) => (
    moduleSpecifiers(filename)
      .filter((specifier) => isForbiddenModuleSpecifier(filename, specifier))
      .map((specifier) => ({ file: posixPath(relative(root, filename)), specifier }))
  )).sort((left, right) => comparePaths(`${left.file}:${left.specifier}`, `${right.file}:${right.specifier}`));
}

function withSkillFixture<T>(files: Record<string, string>, run: (root: string) => T) {
  const fixtureRoot = mkdtempSync(join(tmpdir(), 'san11-skill-boundaries-'));
  const root = join(fixtureRoot, 'src', 'game', 'skills');
  try {
    for (const [name, source] of Object.entries(files)) {
      const filename = join(root, name);
      mkdirSync(dirname(filename), { recursive: true });
      writeFileSync(filename, source, 'utf8');
    }
    return run(root);
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
}

describe('battle module boundaries', () => {
  it('keeps actions as a compatibility export surface', () => {
    const source = readFileSync('src/game/battle/actions.ts', 'utf8');

    expect(source.split(/\r?\n/).length).toBeLessThan(120);
    expect(source).not.toMatch(/function\s+(movementCost|damageRoll|applyTacticDamage|igniteGroundFire)/);
  });

  it.each(modules)('%s has no frontend dependency', (name) => {
    const filename = `src/game/battle/${name}.ts`;
    expect(moduleSpecifiers(filename).filter((specifier) => isForbiddenModuleSpecifier(filename, specifier))).toEqual([]);
  });

  it('keeps every skill module independent from frontend and networking', () => {
    expect(forbiddenSkillDependencies()).toEqual([]);
  });

  it('keeps every skill module free of runtime dependency cycles', () => {
    expect(skillRuntimeCycle()).toBeNull();
  });

  it('recursively discovers production .ts and .tsx modules only', () => {
    withSkillFixture({
      'entry.ts': 'export const entry = true;',
      'nested/view.tsx': 'export const view = <div />;',
      'ignored.test.ts': 'export const testOnly = true;',
      'nested/ignored.spec.tsx': 'export const specOnly = true;',
      'types.d.ts': 'export interface Declared {}',
      '__tests__/helper.ts': 'export const helper = true;',
    }, (root) => {
      expect(skillModuleFiles(root).map((filename) => posixPath(relative(root, filename)))).toEqual([
        'entry.ts',
        'nested/view.tsx',
      ]);
    });
  });

  it('classifies type-only imports and reexports while keeping mixed and dynamic imports runtime', () => {
    withSkillFixture({
      'entry.ts': [
        "import type { Imported } from './imported';",
        "export type { Exported } from './exported';",
        "import { type Named } from './named';",
        "export { type Reexported } from './reexported';",
        "import { type MixedType, runtimeValue } from './mixed';",
        "void import('react');",
      ].join('\n'),
    }, (root) => {
      expect(moduleReferences(resolve(root, 'entry.ts'))).toEqual([
        { specifier: './imported', runtime: false },
        { specifier: './exported', runtime: false },
        { specifier: './named', runtime: false },
        { specifier: './reexported', runtime: false },
        { specifier: './mixed', runtime: true },
        { specifier: 'react', runtime: true },
      ]);
    });
  });

  it('rejects forbidden static, reexported, aliased, and dynamic module specifiers', () => {
    withSkillFixture({
      'entry.tsx': [
        "import 'socket.io-client';",
        "export { GameShell } from '../../components/GameShell';",
        "export { reduceOnlineIntent } from '../network/session';",
        "import Button from '@/components/Button';",
        "import session from '@/game/network/session';",
        "void import('react');",
        "void import('react/jsx-runtime');",
      ].join('\n'),
    }, (root) => {
      const forbidden = forbiddenSkillDependencies(root);
      expect(forbidden).toHaveLength(7);
      expect(forbidden.map((dependency) => dependency.specifier)).toEqual(expect.arrayContaining([
        'socket.io-client',
        '../../components/GameShell',
        '../network/session',
        '@/components/Button',
        '@/game/network/session',
        'react',
        'react/jsx-runtime',
      ]));
    });
  });

  it('ignores forbidden words that occur only in comments and string literals', () => {
    withSkillFixture({
      'entry.ts': [
        "const note = \"import('react') socket.io-client ../components ../network\";",
        "// export { GameShell } from '../../components/GameShell';",
        "/* import io from 'socket.io-client'; */",
        'export { note };',
      ].join('\n'),
    }, (root) => {
      expect(forbiddenSkillDependencies(root)).toEqual([]);
    });
  });

  it('does not create a runtime cycle from an all-type named import', () => {
    withSkillFixture({
      'a.ts': "import { type B } from './b'; export const a = true;",
      'b.ts': "import { a } from './a'; export type B = typeof a;",
    }, (root) => {
      expect(skillRuntimeCycle(root)).toBeNull();
    });
  });

  it('detects mixed runtime cycles through .tsx and index module resolution', () => {
    withSkillFixture({
      'a.tsx': "import { type B, b } from './b'; export const a = b;",
      'b/index.tsx': "import { a } from '../a.tsx'; export type B = typeof a; export const b = 'b';",
    }, (root) => {
      expect(skillRuntimeCycle(root)).toEqual(['a.tsx', 'b/index.tsx', 'a.tsx']);
    });
  });
});
