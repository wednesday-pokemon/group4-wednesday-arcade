// Guards the Deno-shared pure modules and the determinism rule of the whole sim.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = join(__dirname, '../../../src/mystery');
const SHARED = ['draft.ts', 'stats.ts', 'scoring.ts', 'caseLogic.ts', 'prf.ts', 'config.ts'];
const ALLOWED = /^(\.\/types\.ts|\.\/data\/[a-z_]+\.ts|\.\.\/game\/types\.ts|\.\.\/game\/constants\.ts|\.\/(draft|stats|scoring|caseLogic|prf|config)\.ts)$/;

function imports(file: string): string[] {
  const src = readFileSync(join(SRC, file), 'utf8');
  return [...src.matchAll(/from\s+'([^']+)'/g)].map((m) => m[1]);
}

describe('purity', () => {
  for (const f of SHARED) {
    it(`${f} imports only shared modules`, () => {
      for (const i of imports(f)) expect(i, `${f} → ${i}`).toMatch(ALLOWED);
    });
  }

  it('no Math.random / Date / performance in any sim module (determinism)', () => {
    const files = readdirSync(SRC).filter((f) => f.endsWith('.ts'));
    for (const f of files) {
      const src = readFileSync(join(SRC, f), 'utf8').replace(/\/\/.*$/gm, '');
      expect(src, f).not.toMatch(/Math\.random|Date\.now|new Date|performance\.now|\bwindow\.|\bdocument\./);
    }
  });
});
