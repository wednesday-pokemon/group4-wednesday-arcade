// Offline (no Docker) runner for the migrations + pgTAP suites, using PGlite (Postgres compiled to WASM).
// A SUBSTITUTE for `supabase test db`, not a replacement: boot.mjs emulates only the platform pieces the
// schema depends on (roles anon/authenticated/service_role, auth.users, auth.uid(), Supabase's default
// privileges on schema public, the supabase_realtime publication).
//
// Usage (nothing is added to package.json):
//   mkdir -p supabase/.cache/pglite && (cd supabase/.cache/pglite && npm init -y >/dev/null && npm i @electric-sql/pglite@0.5)
//   curl -sSfL -o supabase/.cache/pgtap.sql.in https://raw.githubusercontent.com/theory/pgtap/v1.3.3/sql/pgtap.sql.in
//   PGLITE_DIR=supabase/.cache/pglite PGTAP_SQL=supabase/.cache/pgtap.sql.in node supabase/tests/offline/run-pglite.mjs
// Exit code 0 = every TAP line ok and every plan satisfied.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, bootDatabase } from './boot.mjs';

const PGLITE_DIR = process.env.PGLITE_DIR ?? 'supabase/.cache/pglite';
const PGTAP_SQL = process.env.PGTAP_SQL ?? 'supabase/.cache/pgtap.sql.in';
if (!PGLITE_DIR || !PGTAP_SQL) {
  console.error('Set PGLITE_DIR (folder containing node_modules/@electric-sql/pglite) and PGTAP_SQL (pgtap.sql.in).');
  process.exit(2);
}

let db;
try {
  db = await bootDatabase({ pgliteDir: PGLITE_DIR, pgtapPath: PGTAP_SQL });
} catch (e) {
  console.error(`BOOT FAILED: ${e.message}`);
  process.exit(1);
}

const testDir = join(ROOT, 'supabase', 'tests');
let failures = 0;
for (const file of readdirSync(testDir).filter((f) => f.endsWith('.test.sql')).sort()) {
  const sql = readFileSync(join(testDir, file), 'utf8').replace(/^create extension if not exists pgtap.*$/m, '');
  let planned = null;
  let ran = 0;
  let notOk = 0;
  let failed = 0;
  console.log(`\n# ${file}`);
  try {
    const results = await db.exec(sql);
    for (const r of results) {
      for (const row of r.rows) {
        for (const value of Object.values(row)) {
          if (typeof value !== 'string') continue;
          for (const line of value.split('\n')) {
            if (/^1\.\.\d+/.test(line)) planned = Number(line.slice(3));
            else if (/^ok \d+/.test(line)) ran++;
            else if (/^not ok \d+/.test(line)) { ran++; notOk++; failed++; console.log(line); }
            else if (/^\s*#/.test(line)) console.log(line);
          }
        }
      }
    }
  } catch (e) {
    console.log(`not ok - ${file} aborted: ${e.message}`);
    failed++;
    await db.exec('rollback').catch(() => {});
  }
  if (planned === null || planned !== ran) {
    console.log(`not ok - plan mismatch: planned ${planned}, ran ${ran}`);
    failed++;
  }
  console.log(`# ${file}: ${ran - notOk}/${ran} assertions passed, planned ${planned}`);
  failures += failed;
}
console.log(failures === 0 ? '\nALL PGTAP SUITES PASSED (PGlite)' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
