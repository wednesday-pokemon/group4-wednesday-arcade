// READ-ONLY key-leak check before serving / uploading a build. Never prints a key.
//
//   node scripts/kiosk/check-dist-keys.mjs            (checks dist/ and the repo-root .env* files)
//
// FAILS (exit 1) when:
//   - a Supabase secret key (sb_secret_...) or a JWT whose role is not "anon" appears in dist/**/*.js|html|css|json|map;
//   - a .env* file defines anything other than VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY with a non-empty value
//     that looks like a key, or VITE_SUPABASE_ANON_KEY holds a privileged key.
// Reports (no values) which browser-safe keys were found: role + project ref only.
// Note: the bundle legitimately contains the text "sb_secret_" inside the client-side guard that refuses such keys
// (src/lib/supabase/client.ts); only "sb_secret_" followed by key characters counts as a leak.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const DIST = join(ROOT, 'dist');
const problems = [];
const notes = new Set();

function jwtPayload(token) {
  try {
    const b64 = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(Buffer.from(b64, 'base64').toString('utf8'));
  } catch {
    return null;
  }
}

function scanText(text, where) {
  if (/sb_secret_[A-Za-z0-9_-]{12,}/.test(text)) problems.push(`${where}: contains a Supabase SECRET key (sb_secret_...)`);
  if (/sb_publishable_[A-Za-z0-9_-]{12,}/.test(text)) notes.add(`${where}: publishable key (browser-safe)`);
  for (const m of text.matchAll(/eyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g)) {
    const p = jwtPayload(m[0]);
    if (!p || typeof p !== 'object') continue;
    const role = typeof p.role === 'string' ? p.role : '(none)';
    if (role === 'anon') notes.add(`${where}: anon JWT key, ref ${p.ref ?? '?'} (browser-safe)`);
    else if (p.iss === 'supabase' || 'ref' in p) problems.push(`${where}: Supabase JWT with role "${role}" — must never ship to the browser`);
  }
}

function walk(dir) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full);
    else if (/\.(js|mjs|html|css|json|map|txt)$/i.test(name)) scanText(readFileSync(full, 'utf8'), relative(ROOT, full));
  }
}

if (existsSync(DIST)) walk(DIST);
else notes.add('dist/ not found (run npm run build first) — only .env files checked');

const ALLOWED = new Set(['VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY']);
for (const file of ['.env', '.env.local', '.env.production', '.env.production.local']) {
  const full = join(ROOT, file);
  if (!existsSync(full)) continue;
  for (const raw of readFileSync(full, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#') || !line.includes('=')) continue;
    const name = line.slice(0, line.indexOf('=')).replace(/^export\s+/, '').trim();
    const value = line.slice(line.indexOf('=') + 1).trim().replace(/^["']|["']$/g, '');
    if (!value) continue;
    if (!ALLOWED.has(name)) {
      if (/SERVICE|SECRET|PASSWORD|TOKEN/i.test(name) || /^sb_secret_|^eyJ/.test(value)) {
        problems.push(`${file}: defines ${name} — secrets do not belong in .env files of this repo (use the shell, then unset)`);
      } else notes.add(`${file}: also defines ${name}`);
      continue;
    }
    scanText(value, `${file} ${name}`);
  }
}

for (const n of notes) console.log(`ok    ${n}`);
for (const p of problems) console.log(`FAIL  ${p}`);
console.log(problems.length ? `\n${problems.length} problem(s). Do NOT serve or upload this build.` : '\nNo privileged keys found.');
process.exit(problems.length ? 1 : 0);
