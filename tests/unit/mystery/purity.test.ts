// Guards the Deno-shared pure modules and the determinism rule of the whole sim.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = join(__dirname, '../../../src/mystery');
const SHARED = ['draft.ts', 'stats.ts', 'scoring.ts', 'caseLogic.ts', 'prf.ts', 'config.ts'];
const ALLOWED = /^(\.\/types\.ts|\.\/data\/[a-z_]+\.ts|\.\.\/game\/types\.ts|\.\.\/game\/constants\.ts|\.\/(draft|stats|scoring|caseLogic|prf|config)\.ts)$/;
/** Case content + answer keys are shared with the Edge Functions (generated registry): types only, nothing else. */
const SHARED_DATA = ['data/cases.ts', 'data/solutions.ts'];
const DATA_ALLOWED = /^\.\.\/types\.ts$/;

function imports(file: string): string[] {
  const src = readFileSync(join(SRC, file), 'utf8');
  return [...src.matchAll(/from\s+'([^']+)'/g)].map((m) => m[1]);
}

function code(file: string): string {
  return readFileSync(join(SRC, file), 'utf8').replace(/\/\/.*$/gm, '');
}

describe('purity', () => {
  for (const f of SHARED) {
    it(`${f} imports only shared modules`, () => {
      for (const i of imports(f)) expect(i, `${f} → ${i}`).toMatch(ALLOWED);
    });
  }

  for (const f of SHARED_DATA) {
    it(`${f} imports only ../types.ts (type-only) and has no side effects`, () => {
      const src = code(f);
      for (const i of imports(f)) expect(i, `${f} → ${i}`).toMatch(DATA_ALLOWED);
      for (const m of src.matchAll(/^import\s+(.*)$/gm)) expect(m[1], `${f}: ${m[0]}`).toMatch(/^type\s/);
      expect(src).not.toMatch(/\bimport\s*\(|\brequire\s*\(|\bprocess\.|\bglobalThis\b|\bDeno\b/);
    });
  }

  it('caseLogic.ts never imports the answer keys (they are a parameter)', () => {
    expect(imports('caseLogic.ts').some((i) => i.includes('solutions'))).toBe(false);
  });

  it('no Math.random / Date / performance in any sim or data module (determinism)', () => {
    const files = [
      ...readdirSync(SRC).filter((f) => f.endsWith('.ts')),
      ...readdirSync(join(SRC, 'data')).filter((f) => f.endsWith('.ts')).map((f) => `data/${f}`),
    ];
    for (const f of files) {
      expect(code(f), f).not.toMatch(/Math\.random|Date\.now|new Date|performance\.now|\bwindow\.|\bdocument\./);
    }
  });
});
