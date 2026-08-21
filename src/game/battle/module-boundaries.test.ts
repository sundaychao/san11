import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, extname, isAbsolute, join, relative, resolve } from 'node:path';
import { initSync, parse } from 'es-module-lexer';
import {
  isElementAccessExpression,
  isIdentifier,
  isParenthesizedExpression,
  isPropertyAccessExpression,
  isStringLiteral,
  isTypeNode,
  SyntaxKind,
  type Identifier,
  type Node,
} from 'typescript/unstable/ast';
import { API } from 'typescript/unstable/sync';
import { describe, expect, it } from 'vitest';

const modules = [
  'catalog',
  'definitions',
  'shared',
  'movement',
  'movementRules',
  'targetRules',
  'facilities',
  'combat',
  'tactics',
  'strategies',
  'deployment',
  'queries',
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

function resolveSourceDependency(filename: string, specifier: string, sourceRoot: string) {
  if (!specifier.startsWith('.')) return null;
  const imported = resolve(dirname(filename), specifier);
  const extension = extname(imported);
  const candidates = extension === '.ts' || extension === '.tsx'
    ? [imported]
    : extension === '.js' || extension === '.jsx'
      ? [
          `${imported.slice(0, -extension.length)}${extension === '.jsx' ? '.tsx' : '.ts'}`,
          `${imported.slice(0, -extension.length)}${extension === '.jsx' ? '.ts' : '.tsx'}`,
        ]
      : [`${imported}.ts`, `${imported}.tsx`, resolve(imported, 'index.ts'), resolve(imported, 'index.tsx')];
  for (const candidate of candidates) {
    if (
      pathIsWithin(sourceRoot, candidate) &&
      existsSync(candidate) &&
      statSync(candidate).isFile() &&
      isProductionTypeScriptFile(relative(sourceRoot, candidate))
    ) {
      return candidate;
    }
  }
  return null;
}

function isOutsideSourceRoot(filename: string, specifier: string, sourceRoot: string) {
  return specifier.startsWith('.') && !pathIsWithin(sourceRoot, resolve(dirname(filename), specifier));
}

function isPropertyOrMarkupName(identifier: Identifier) {
  const parent = identifier.parent as Node & { name?: Node; propertyName?: Node };
  if (parent.propertyName === identifier && parent.kind === SyntaxKind.BindingElement) return true;
  if (parent.name !== identifier) return false;
  return (
    parent.kind === SyntaxKind.PropertyAccessExpression ||
    parent.kind === SyntaxKind.PropertyAssignment ||
    parent.kind === SyntaxKind.PropertyDeclaration ||
    parent.kind === SyntaxKind.PropertySignature ||
    parent.kind === SyntaxKind.MethodDeclaration ||
    parent.kind === SyntaxKind.MethodSignature ||
    parent.kind === SyntaxKind.GetAccessor ||
    parent.kind === SyntaxKind.SetAccessor ||
    parent.kind === SyntaxKind.JsxAttribute ||
    parent.kind === SyntaxKind.ImportSpecifier ||
    parent.kind === SyntaxKind.ExportSpecifier
  );
}

function isRuntimeIdentifier(identifier: Identifier) {
  if (isPropertyOrMarkupName(identifier)) return false;
  return isRuntimeNode(identifier);
}

function isRuntimeNode(node: Node) {
  for (let parent = node.parent; parent.kind !== SyntaxKind.SourceFile; parent = parent.parent) {
    if (isTypeNode(parent)) return false;
  }
  return true;
}

type BrowserGlobalName = 'window' | 'document';

interface GlobalThisBrowserReference {
  name: BrowserGlobalName;
  globalThis: Identifier;
}

function browserGlobalName(node: Node): BrowserGlobalName | null {
  if ((isIdentifier(node) || isStringLiteral(node)) && (node.text === 'window' || node.text === 'document')) {
    return node.text;
  }
  return null;
}

function unwrappedGlobalThis(node: Node): Identifier | null {
  let expression = node;
  while (isParenthesizedExpression(expression)) expression = expression.expression;
  return isIdentifier(expression) && expression.text === 'globalThis' ? expression : null;
}

function globalThisBrowserReference(node: Node): GlobalThisBrowserReference | null {
  if (!isRuntimeNode(node)) return null;

  if (isPropertyAccessExpression(node)) {
    const name = browserGlobalName(node.name);
    const globalThis = unwrappedGlobalThis(node.expression);
    return name && globalThis ? { name, globalThis } : null;
  }

  if (isElementAccessExpression(node)) {
    const name = isStringLiteral(node.argumentExpression)
      ? browserGlobalName(node.argumentExpression)
      : null;
    const globalThis = unwrappedGlobalThis(node.expression);
    return name && globalThis ? { name, globalThis } : null;
  }

  if (node.kind !== SyntaxKind.BindingElement) return null;
  const binding = node as Node & { name?: Node; propertyName?: Node };
  const name = binding.propertyName ?? binding.name;
  const declaration = node.parent.parent as Node & { initializer?: Node };
  const globalThis = declaration.initializer ? unwrappedGlobalThis(declaration.initializer) : null;
  const browserName = name ? browserGlobalName(name) : null;
  return browserName && globalThis ? { name: browserName, globalThis } : null;
}

function browserGlobalReferences(filenames: readonly string[], sourceRoot: string) {
  const references = new Map<string, string[]>();
  if (!filenames.some((filename) => /\b(?:window|document)\b/.test(readFileSync(filename, 'utf8')))) {
    return references;
  }

  const api = new API({ cwd: sourceRoot });
  const snapshot = api.updateSnapshot({ openFiles: [...filenames] });
  try {
    for (const filename of filenames) {
      const project = snapshot.getDefaultProjectForFile(filename);
      const sourceFile = project?.program.getSourceFile(filename);
      if (!project || !sourceFile) continue;

      const identifiers: Identifier[] = [];
      const globalThisReferences: GlobalThisBrowserReference[] = [];
      const visit = (node: Node): void => {
        const globalThisReference = globalThisBrowserReference(node);
        if (globalThisReference) globalThisReferences.push(globalThisReference);
        if (
          isIdentifier(node) &&
          (node.text === 'window' || node.text === 'document') &&
          isRuntimeIdentifier(node)
        ) {
          identifiers.push(node);
        }
        node.forEachChild(visit);
      };
      sourceFile.forEachChild(visit);

      const identifierSymbols = project.checker.getSymbolAtPosition(
        filename,
        identifiers.map((identifier) => identifier.getStart(sourceFile)),
      );
      const globalThisSymbols = project.checker.getSymbolAtPosition(
        filename,
        globalThisReferences.map((reference) => reference.globalThis.getStart(sourceFile)),
      );
      const globals = new Set<string>();
      identifiers.forEach((identifier, index) => {
        const symbol = identifierSymbols[index];
        const hasNonLibraryDeclaration = symbol?.declarations.some((declaration) => {
          const node = declaration.resolve(project);
          return node !== undefined && !project.program.isSourceFileDefaultLibrary(node.getSourceFile());
        }) ?? false;
        if (!hasNonLibraryDeclaration) globals.add(identifier.text);
      });
      globalThisReferences.forEach((reference, index) => {
        const symbol = globalThisSymbols[index];
        const declarations = symbol?.declarations
          .map((declaration) => declaration.resolve(project))
          .filter((declaration): declaration is Node => declaration !== undefined) ?? [];
        if (
          symbol?.name === 'globalThis' &&
          declarations.every((declaration) => project.program.isSourceFileDefaultLibrary(declaration.getSourceFile()))
        ) {
          globals.add(reference.name);
        }
      });
      if (globals.size > 0) references.set(filename, [...globals].sort());
    }
  } finally {
    snapshot.dispose();
    api.close();
  }
  return references;
}

function forbiddenSkillDependencies(root = skillRoot) {
  const sourceRoot = resolve(root, '../..');
  const skillFiles = skillModuleFiles(root);
  const pending = [...skillFiles];
  const visited = new Set<string>();
  const forbidden: Array<{ file: string; specifier: string }> = [];

  while (pending.length > 0) {
    const filename = pending.pop()!;
    if (visited.has(filename)) continue;
    visited.add(filename);
    for (const { specifier } of moduleReferences(filename)) {
      if (isForbiddenModuleSpecifier(filename, specifier)) {
        forbidden.push({ file: posixPath(relative(root, filename)), specifier });
      }
      if (isOutsideSourceRoot(filename, specifier, sourceRoot)) {
        forbidden.push({ file: posixPath(relative(root, filename)), specifier });
        continue;
      }
      const dependency = resolveSourceDependency(filename, specifier, sourceRoot);
      if (dependency && !visited.has(dependency)) pending.push(dependency);
    }
  }

  for (const [filename, globals] of browserGlobalReferences([...visited], sourceRoot)) {
    for (const specifier of globals) {
      forbidden.push({ file: posixPath(relative(root, filename)), specifier });
    }
  }

  return forbidden
    .filter((dependency, index, entries) => entries.findIndex((entry) => (
      entry.file === dependency.file && entry.specifier === dependency.specifier
    )) === index)
    .sort((left, right) => comparePaths(`${left.file}:${left.specifier}`, `${right.file}:${right.specifier}`));
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

  it('follows relative static, reexported, dynamic, and type-only dependencies outside the skill root', () => {
    withSkillFixture({
      'entry.ts': [
        "import '../shared/staticBridge';",
        "export { reexported } from '../shared/reexportBridge';",
        "void import('../shared/dynamicBridge');",
        "import type { NetworkType } from '../shared/typeBridge';",
      ].join('\n'),
      '../shared/staticBridge.ts': "import '../../components/GameShell';",
      '../shared/reexportBridge.ts': "export { reexported } from '../network/session';",
      '../shared/dynamicBridge.ts': "void import('react');",
      '../shared/typeBridge.ts': "export type { NetworkType } from '../network/types';",
    }, (root) => {
      expect(forbiddenSkillDependencies(root)).toEqual([
        { file: '../shared/dynamicBridge.ts', specifier: 'react' },
        { file: '../shared/reexportBridge.ts', specifier: '../network/session' },
        { file: '../shared/staticBridge.ts', specifier: '../../components/GameShell' },
        { file: '../shared/typeBridge.ts', specifier: '../network/types' },
      ]);
    });
  });

  it('follows TypeScript sources imported through Bundler-style .js and .jsx specifiers', () => {
    withSkillFixture({
      'entry.ts': [
        "import '../shared/bridge.js';",
        "export { view } from '../shared/view.jsx';",
      ].join('\n'),
      '../shared/bridge.ts': "import 'react';",
      '../shared/view.tsx': 'export const view = document.body;',
    }, (root) => {
      expect(forbiddenSkillDependencies(root)).toEqual([
        { file: '../shared/bridge.ts', specifier: 'react' },
        { file: '../shared/view.tsx', specifier: 'document' },
      ]);
    });
  });

  it('rejects browser globals in recursively visited source dependencies', () => {
    withSkillFixture({
      'entry.ts': "export { bridge } from '../shared/bridge';",
      '../shared/bridge.ts': [
        'export function bridge() {',
        '  window.addEventListener("resize", bridge);',
        '  return document.body;',
        '}',
      ].join('\n'),
    }, (root) => {
      expect(forbiddenSkillDependencies(root)).toEqual([
        { file: '../shared/bridge.ts', specifier: 'document' },
        { file: '../shared/bridge.ts', specifier: 'window' },
      ]);
    });
  });

  it('rejects relative dependencies that escape the source root', () => {
    withSkillFixture({
      'entry.ts': "export { serverBridge } from '../../../server/bridge';",
      '../../../server/bridge.ts': 'export const serverBridge = true;',
    }, (root) => {
      expect(forbiddenSkillDependencies(root)).toEqual([
        { file: 'entry.ts', specifier: '../../../server/bridge' },
      ]);
    });
  });

  it('rejects runtime window and document references in skill production source', () => {
    withSkillFixture({
      'entry.tsx': [
        'export function mount() {',
        '  window.addEventListener("resize", mount);',
        '  return document.body;',
        '}',
      ].join('\n'),
    }, (root) => {
      expect(forbiddenSkillDependencies(root)).toEqual([
        { file: 'entry.tsx', specifier: 'document' },
        { file: 'entry.tsx', specifier: 'window' },
      ]);
    });
  });

  it('rejects window and document references accessed through globalThis', () => {
    withSkillFixture({
      'direct.ts': 'export const browserWindow = globalThis.window;',
      'parenthesized.ts': 'export const browserDocument = (globalThis).document;',
      'computed.ts': [
        "export const browserWindow = globalThis['window'];",
        "export const browserDocument = globalThis['document'];",
      ].join('\n'),
      'destructured.ts': [
        'const { window: browserWindow, document: browserDocument } = globalThis;',
        'export { browserWindow, browserDocument };',
      ].join('\n'),
    }, (root) => {
      expect(forbiddenSkillDependencies(root)).toEqual([
        { file: 'computed.ts', specifier: 'document' },
        { file: 'computed.ts', specifier: 'window' },
        { file: 'destructured.ts', specifier: 'document' },
        { file: 'destructured.ts', specifier: 'window' },
        { file: 'direct.ts', specifier: 'window' },
        { file: 'parenthesized.ts', specifier: 'document' },
      ]);
    });
  });

  it('ignores locally bound globalThis and type-only globalThis references', () => {
    withSkillFixture({
      'local.ts': [
        'const globalThis = { window: "local", document: "local" };',
        'const localWindow = globalThis.window;',
        "const localDocument = globalThis['document'];",
        'const { window, document } = globalThis;',
        'export { localWindow, localDocument, window, document };',
      ].join('\n'),
      'type-only.ts': [
        'type BrowserWindow = typeof globalThis.window;',
        'type BrowserDocument = typeof globalThis.document;',
        'export type { BrowserWindow, BrowserDocument };',
      ].join('\n'),
    }, (root) => {
      expect(forbiddenSkillDependencies(root)).toEqual([]);
    });
  });

  it('ignores property names, type members, JSX attributes, and locally bound browser names', () => {
    withSkillFixture({
      'entry.tsx': [
        'declare const object: { window: string; document: string };',
        'declare const Widget: (props: { window: string; document: string }) => unknown;',
        'const propertyValues = [object.window, object.document];',
        'const namedProperties = { window: "local", document: "local" };',
        'type BrowserShape = { window: string; document: string };',
        'function scoped(window: string, document: string) {',
        '  const local = { window, document };',
        '  return [window, document, local];',
        '}',
        'function declaredLocally() {',
        '  const window = "local";',
        '  const document = "local";',
        '  return [window, document];',
        '}',
        'const dynamicBrowserProperty = "window";',
        'const dynamicGlobalThisProperty = globalThis[dynamicBrowserProperty];',
        'const view = <Widget window="local" document="local" />;',
        'export { propertyValues, namedProperties, scoped, declaredLocally, dynamicGlobalThisProperty, view };',
        'export type { BrowserShape };',
      ].join('\n'),
    }, (root) => {
      expect(forbiddenSkillDependencies(root)).toEqual([]);
    });
  });

  it('ignores forbidden words that occur only in comments and string literals', () => {
    withSkillFixture({
      'entry.ts': [
        "const note = \"import('react') socket.io-client ../components ../network\";",
        "const browserGlobals = 'window document';",
        '// window.alert(document.title);',
        '/* document.body.append(window.name); */',
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
