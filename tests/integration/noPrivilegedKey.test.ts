// Static guard (T-11): the browser bundle inputs never reference a privileged Supabase key.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(__dirname, '..', '..');
const FORBIDDEN = /service_role|SUPABASE_SERVICE|sb_secret_[A-Za-z0-9]/i;

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx|js|mjs|json|html|css)$/.test(name)) out.push(p);
  }
  return out;
}

describe('no privileged key in browser code or build config', () => {
  it('src/** never mentions service_role / SUPABASE_SERVICE / sb_secret_ keys (only the secret-prefix guard)', () => {
    const offenders: string[] = [];
    for (const file of walk(join(ROOT, 'src'))) {
      const text = readFileSync(file, 'utf8');
      text.split(/\r?\n/).forEach((line, i) => {
        if (FORBIDDEN.test(line)) offenders.push(`${relative(ROOT, file)}:${i + 1}: ${line.trim()}`);
      });
    }
    expect(offenders).toEqual([]);
  });

  it('vite config and index.html are clean', () => {
    for (const f of ['vite.config.ts', 'index.html']) {
      const p = join(ROOT, f);
      if (existsSync(p)) expect(FORBIDDEN.test(readFileSync(p, 'utf8'))).toBe(false);
    }
  });

  it('the live adapter reads only VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY from the environment', () => {
    const names = new Set<string>();
    for (const file of walk(join(ROOT, 'src', 'lib', 'supabase'))) {
      for (const m of readFileSync(file, 'utf8').matchAll(/\bVITE_[A-Z0-9_]+/g)) names.add(m[0]);
    }
    expect([...names].sort()).toEqual(['VITE_SUPABASE_ANON_KEY', 'VITE_SUPABASE_URL']);
  });

  it('local .env files (if any) expose no privileged VITE_ variable', () => {
    for (const f of ['.env', '.env.local', '.env.production', '.env.production.local']) {
      const p = join(ROOT, f);
      if (!existsSync(p)) continue;
      for (const line of readFileSync(p, 'utf8').split(/\r?\n/)) {
        if (!/^\s*VITE_/.test(line)) continue;
        expect(FORBIDDEN.test(line), `${f}: ${line.split('=')[0]}`).toBe(false);
        const value = line.split('=').slice(1).join('=').trim();
        const payload = value.split('.')[1];
        if (payload) {
          try {
            const role = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')).role;
            if (role !== undefined) expect(role, `${f}: ${line.split('=')[0]}`).toBe('anon');
          } catch {
            /* not a JWT */
          }
        }
      }
    }
  });
});
