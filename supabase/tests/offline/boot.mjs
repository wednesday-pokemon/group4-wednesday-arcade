// Boots a PGlite database with a minimal Supabase-compatibility layer, applies supabase/migrations/*.sql
// and supabase/seed.sql. Shared by run-pglite.mjs (pgTAP) and engine-roundtrip.ts (engine <-> RPC parity).
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const ROOT = resolve(fileURLToPath(new URL('../../..', import.meta.url)));

export const SUPABASE_COMPAT = `
create role anon nologin noinherit;
create role authenticated nologin noinherit;
create role service_role nologin noinherit bypassrls;
create schema extensions;
grant usage on schema extensions to public;
create schema auth;
grant usage on schema auth to anon, authenticated, service_role;
create table auth.users (id uuid primary key, email text, created_at timestamptz not null default now());
create function auth.uid() returns uuid language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid
$$;
grant execute on function auth.uid() to anon, authenticated, service_role;
grant usage on schema public to anon, authenticated, service_role;
-- Supabase's permissive default privileges, which the migrations must revoke:
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
create publication supabase_realtime;
`;

export async function bootDatabase({ pgliteDir, pgtapPath, log = console.log } = {}) {
  if (!pgliteDir) throw new Error('PGLITE_DIR is required (folder containing node_modules/@electric-sql/pglite)');
  const { PGlite } = await import(
    pathToFileURL(resolve(pgliteDir, 'node_modules/@electric-sql/pglite/dist/index.js')).href
  );
  const db = new PGlite();
  await db.exec(SUPABASE_COMPAT);
  if (pgtapPath) {
    const pgtap = readFileSync(pgtapPath, 'utf8').replace(/__OS__/g, 'pglite').replace(/__VERSION__/g, '1.33');
    await db.exec(`set search_path = extensions; ${pgtap}; reset search_path;`);
  }
  await db.exec('set search_path = public, extensions;');
  const migDir = join(ROOT, 'supabase', 'migrations');
  for (const file of readdirSync(migDir).filter((f) => f.endsWith('.sql')).sort()) {
    try {
      await db.exec(readFileSync(join(migDir, file), 'utf8'));
      log(`# migration ok: ${file}`);
    } catch (e) {
      throw new Error(`migration ${file} failed: ${e.message}`);
    }
  }
  await db.exec(readFileSync(join(ROOT, 'supabase', 'seed.sql'), 'utf8'));
  log('# seed ok');
  return db;
}
