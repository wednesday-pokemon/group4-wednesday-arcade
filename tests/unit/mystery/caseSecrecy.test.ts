// Secrecy of the answer keys (docs/MYSTERY_CASES.md "Secrecy"): no browser module may STATICALLY reach
// src/mystery/data/solutions.ts (the culprits / supporting evidence) or src/mystery/episode.ts (which imports them).
// The app loads the key with a dynamic `import()` after the visitor committed the accusation — dynamic imports are
// separate chunks and are deliberately not followed here.
//
// The graph is read with the TypeScript parser (top-level ImportDeclaration / ExportDeclaration only, so dynamic
// imports inside functions are ignored by construction). Type-only imports (`import type`, `export type`, or every
// specifier marked `type`) are erased at build time and therefore are not edges.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, relative, resolve } from 'node:path';
import type * as TS from 'typescript';
import { describe, expect, it } from 'vitest';

// loaded through Node (not the vite transform) so vitest does not look for typescript.js.map
const ts: typeof TS = createRequire(import.meta.url)('typescript');

const ROOT = resolve(__dirname, '../../..');
const SRC = join(ROOT, 'src');
const norm = (p: string) => relative(ROOT, p).split('\\').join('/');

const SECRET = ['src/mystery/data/solutions.ts', 'src/mystery/episode.ts'];
/** Node-only modules that legitimately import the answer keys (tests, analytics generator, integration fake). */
const NODE_ONLY = new Set(['src/mystery/episode.ts', 'src/mystery/analytics/episodes.ts', 'src/mystery/data/solutions.ts']);
/** Files allowed to mention the answer-key module — only through a dynamic import (asserted below). */
const DYNAMIC_LOADERS = new Set(['src/app/mystery/integration.ts']);
const ROOT_DIRS = ['src/app', 'src/ui', 'src/three', 'src/lib', 'src/mystery'];

function walk(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (/\.(ts|tsx|mts)$/.test(name) && !/\.d\.ts$/.test(name)) out.push(p);
  }
  return out;
}

const sourceCache = new Map<string, TS.SourceFile>();
function parse(file: string): TS.SourceFile {
  let sf = sourceCache.get(file);
  if (!sf) {
    sf = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.ES2022, true, file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    sourceCache.set(file, sf);
  }
  return sf;
}

function resolveSpecifier(from: string, spec: string): string | null {
  if (!spec.startsWith('.')) return null; // packages; the repo uses no path aliases (tsconfig has no `paths`)
  const base = resolve(dirname(from), spec.replace(/\?.*$/, ''));
  for (const cand of [base, `${base}.ts`, `${base}.tsx`, join(base, 'index.ts'), join(base, 'index.tsx')]) {
    if (existsSync(cand) && statSync(cand).isFile() && /\.(ts|tsx|mts)$/.test(cand)) return cand;
  }
  return null; // css / images / json: leaves
}

/** Static, value-carrying edges of one module. */
function staticEdges(file: string): string[] {
  const out: string[] = [];
  for (const st of parse(file).statements) {
    let spec: TS.Expression | undefined;
    if (ts.isImportDeclaration(st)) {
      const c = st.importClause;
      if (c?.isTypeOnly) continue;
      const named = c?.namedBindings && ts.isNamedImports(c.namedBindings) ? c.namedBindings : null;
      if (c && !c.name && named && named.elements.length > 0 && named.elements.every((e) => e.isTypeOnly)) continue;
      spec = st.moduleSpecifier;
    } else if (ts.isExportDeclaration(st)) {
      if (st.isTypeOnly || !st.moduleSpecifier) continue;
      const ex = st.exportClause;
      if (ex && ts.isNamedExports(ex) && ex.elements.length > 0 && ex.elements.every((e) => e.isTypeOnly)) continue;
      spec = st.moduleSpecifier;
    } else if (ts.isImportEqualsDeclaration(st) && !st.isTypeOnly && ts.isExternalModuleReference(st.moduleReference)) {
      spec = st.moduleReference.expression;
    }
    if (spec && ts.isStringLiteral(spec)) {
      const r = resolveSpecifier(file, spec.text);
      if (r) out.push(r);
    }
  }
  return out;
}

/** Dynamic `import('…')` specifiers anywhere in the module. */
function dynamicSpecifiers(file: string): string[] {
  const out: string[] = [];
  const visit = (n: TS.Node) => {
    if (ts.isCallExpression(n) && n.expression.kind === ts.SyntaxKind.ImportKeyword && n.arguments[0] && ts.isStringLiteral(n.arguments[0])) {
      out.push(n.arguments[0].text);
    }
    ts.forEachChild(n, visit);
  };
  visit(parse(file));
  return out;
}

/** BFS from `start`; returns the import chain to the first secret module reached, or null. */
function chainToSecret(start: string): string[] | null {
  const prev = new Map<string, string | null>([[start, null]]);
  const queue = [start];
  while (queue.length) {
    const cur = queue.shift()!;
    if (cur !== start && SECRET.includes(norm(cur))) {
      const chain: string[] = [];
      for (let c: string | null = cur; c; c = prev.get(c) ?? null) chain.unshift(norm(c));
      return chain;
    }
    for (const nb of staticEdges(cur)) {
      if (prev.has(nb)) continue;
      prev.set(nb, cur);
      queue.push(nb);
    }
  }
  return null;
}

const roots = [join(SRC, 'main.tsx'), ...ROOT_DIRS.flatMap((d) => walk(join(ROOT, d)))]
  .filter((f) => existsSync(f) && !NODE_ONLY.has(norm(f)));

describe('case secrecy: no browser module statically reaches the answer keys', () => {
  it('scans a real graph (sanity)', () => {
    expect(roots.length).toBeGreaterThan(50);
    expect(roots.map(norm)).toContain('src/app/mystery/MysteryApp.tsx');
    expect(roots.map(norm)).toContain('src/mystery/bot.ts');
    // the scanner does see edges: episode.ts → solutions.ts is a real static edge
    expect(staticEdges(join(SRC, 'mystery/episode.ts')).map(norm)).toContain('src/mystery/data/solutions.ts');
    // and it ignores type-only imports (dataset.ts imports only a type from analytics/episodes.ts)
    const dataset = join(SRC, 'mystery/analytics/dataset.ts');
    if (existsSync(dataset)) expect(staticEdges(dataset).map(norm)).not.toContain('src/mystery/analytics/episodes.ts');
  });

  it('every module under src/app, src/ui, src/three, src/lib, src/mystery (+ main.tsx) is clean', () => {
    const leaks: string[] = [];
    for (const f of roots) {
      const chain = chainToSecret(f);
      if (chain) leaks.push(chain.join(' → '));
    }
    expect(leaks).toEqual([]);
  });

  it('the bot (also loaded by the app autopilot) and caseLogic never import the answer keys', () => {
    for (const f of ['mystery/bot.ts', 'mystery/caseLogic.ts', 'mystery/caseVariant.ts', 'mystery/run.ts', 'mystery/defaults.ts', 'mystery/data/cases.ts']) {
      expect(chainToSecret(join(SRC, f)), f).toBeNull();
    }
  });

  it('only whitelisted loaders mention the answer-key module, and only through a dynamic import()', () => {
    const offenders: string[] = [];
    for (const f of roots) {
      const rel = norm(f);
      const text = readFileSync(f, 'utf8');
      for (const name of ['CASE_SOLUTIONS', 'CASE_VARIANTS']) if (text.includes(name)) offenders.push(`${rel}: mentions ${name}`);
      const statics = staticEdges(f).map(norm).filter((p) => SECRET.includes(p));
      if (statics.length) offenders.push(`${rel}: static import of ${statics.join(', ')}`);
      const dyn = dynamicSpecifiers(f).map((s) => resolveSpecifier(f, s)).filter((p): p is string => !!p).map(norm).filter((p) => SECRET.includes(p));
      if (dyn.length && !DYNAMIC_LOADERS.has(rel)) offenders.push(`${rel}: unexpected dynamic import of ${dyn.join(', ')}`);
    }
    expect(offenders).toEqual([]);
    // the whitelisted loader really does use a dynamic import of data/solutions.ts
    for (const rel of DYNAMIC_LOADERS) {
      const f = join(ROOT, rel);
      const dyn = dynamicSpecifiers(f).map((s) => resolveSpecifier(f, s)).filter((p): p is string => !!p).map(norm);
      expect(dyn, rel).toContain('src/mystery/data/solutions.ts');
    }
  });
});
