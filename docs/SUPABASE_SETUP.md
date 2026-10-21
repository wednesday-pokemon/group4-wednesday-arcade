# Supabase setup — Escape from Raven Island: The Hyde's Regatta (live/verified mode)

Without Supabase the game runs in **LOCAL DEMO** mode (unverified, single browser). This guide turns on the
verified mode: two station terminals + a public dashboard, with all rules executed server-side.

Everything below works **without Docker** (hosted project). Docker is only needed for the optional local
stack in §11. Shell examples use bash (Git Bash on Windows); PowerShell equivalents are given where the syntax differs.

What you will deploy:

| Piece | Location |
|---|---|
| Schema, RLS, RPCs, Realtime publication | `supabase/migrations/*.sql` (4 files) |
| Reference rows (two stations) | inside the first migration (and `supabase/seed.sql` for local resets) |
| Edge Functions | `supabase/functions/{create-session,get-session,prepare-leg,resolve-leg,finish-session,admin-reset}` |
| Shared rules engine (generated copy) | `supabase/functions/_shared/game/` ← `npm run sync:shared` |
| Account provisioning | `supabase/scripts/provision-users.mjs` |
| Tests | `supabase/tests/*.test.sql` (pgTAP), `supabase/tests/unit` (Vitest), `supabase/tests/offline` (PGlite) |

---

## 1. Create the project

1. <https://supabase.com/dashboard> → **New project**. Pick the region closest to the event venue.
2. Set a long database password and store it in a password manager (needed for `supabase link` / `db push`).
3. Wait for provisioning, then note from **Project Settings**:
   * **Project ref** (General) — e.g. `abcdefghijklmnopqrst`
   * **Project URL** (Data API) — `https://<ref>.supabase.co`
   * **anon / publishable key** (API Keys) — browser-safe
   * **service_role / secret key** (API Keys) — **server-only**; used once by the provisioning script on the
     operator's laptop. Never put it in `.env` for Vite, never commit it.
4. **Settings → Infrastructure**: confirm Postgres major version ≥ 15 (the views use `security_invoker`).
   If it is not 17, change `major_version` in `supabase/config.toml` to match.

## 2. Lock down Auth (Dashboard — `db push` does not apply `[auth]` from config.toml)

**Authentication → Sign In / Providers**:
* **Allow new users to sign up: OFF** (accounts are created only by the operator).
* **Allow anonymous sign-ins: OFF**.
* Email provider: ON. "Confirm email" may stay ON — provisioned users are created already confirmed.

**Authentication → Policies / Passwords** (if shown): minimum length 12, require lower+upper+digits.

(Even if sign-up were left on, a self-registered user has no `app_users` row, so every function answers
`403 NOT_PROVISIONED` and RLS shows them nothing. Turning it off is defence in depth.)

## 3. Link the repo and push the schema

```bash
cd /d/PokemonDay
npx supabase login                                  # browser login, or export SUPABASE_ACCESS_TOKEN=...
npx supabase link --project-ref <ref>               # prompts for the database password
npx supabase db push --dry-run                      # should list the 4 migrations 20261021000100..400
npx supabase db push
```

Verify in **SQL Editor**:

```sql
select id, label from public.stations;                                   -- station_a, station_b
select station_id, status from public.station_status;                    -- both 'idle'
select tablename from pg_publication_tables where pubname = 'supabase_realtime';
-- exactly: leaderboard_entries, station_status
```

## 4. Deploy the Edge Functions

The functions import the rules engine from `_shared/game/`, which is a generated copy of `src/game`.
**Always re-sync before deploying** so the server runs byte-identical rules:

```bash
npm run sync:shared
npx supabase functions deploy --use-api \
  create-session get-session prepare-leg resolve-leg finish-session admin-reset
```

`--use-api` bundles server-side (no Docker). `verify_jwt = true` for every function comes from
`supabase/config.toml`. `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are injected by the platform —
**no secrets need to be set** for a default project.

Optional secrets:

```bash
# Pin the browser origins allowed by CORS (default: any origin; auth is a bearer header, not cookies)
npx supabase secrets set ALLOWED_ORIGINS="https://kiosk.example.com,https://dashboard.example.com"
# Only if you disabled the legacy JWT API keys: provide a secret key for the functions
npx supabase secrets set RAVEN_SERVICE_KEY="<sb_secret_... key>"
```

> **Troubleshooting — every call returns 401 "Invalid JWT" from the gateway** (projects using the new
> asymmetric JWT signing keys): redeploy with `--no-verify-jwt`. This is safe here because each function
> independently verifies the token with `auth.getUser()` and requires an `app_users` row
> (`supabase/functions/_shared/auth.ts`).

## 5. Create the station and operator accounts

Use one Auth account per station terminal and one per operator. Use emails you control (they are never
mailed). Passwords: ≥ 12 chars with upper, lower and digits; different per account.

Run on the operator laptop from the repo root (the service key is read from the environment, never from argv):

```bash
export SUPABASE_URL="https://<ref>.supabase.co"
export SUPABASE_SERVICE_ROLE_KEY="<service_role key>"     # do not save this in any file

PROVISION_PASSWORD='<password A>' node supabase/scripts/provision-users.mjs station  station_a station-a@regatta.example
PROVISION_PASSWORD='<password B>' node supabase/scripts/provision-users.mjs station  station_b station-b@regatta.example
PROVISION_PASSWORD='<password O>' node supabase/scripts/provision-users.mjs operator -         ops@regatta.example

unset SUPABASE_SERVICE_ROLE_KEY
```

PowerShell:

```powershell
$env:SUPABASE_URL = "https://<ref>.supabase.co"; $env:SUPABASE_SERVICE_ROLE_KEY = "<service_role key>"
$env:PROVISION_PASSWORD = "<password A>"; node supabase/scripts/provision-users.mjs station station_a station-a@regatta.example
Remove-Item Env:SUPABASE_SERVICE_ROLE_KEY, Env:PROVISION_PASSWORD
```

Re-running for the same email rotates the password and re-binds the role (idempotent).

**Alternative (Dashboard only):** Authentication → Users → **Add user** → "Create new user", tick
**Auto Confirm User**. Then bind roles in the SQL Editor:

```sql
insert into public.app_users (user_id, role, station_id)
select id, 'station', 'station_a' from auth.users where email = 'station-a@regatta.example'
on conflict (user_id) do update set role = excluded.role, station_id = excluded.station_id;

insert into public.app_users (user_id, role, station_id)
select id, 'station', 'station_b' from auth.users where email = 'station-b@regatta.example'
on conflict (user_id) do update set role = excluded.role, station_id = excluded.station_id;

insert into public.app_users (user_id, role, station_id)
select id, 'operator', null from auth.users where email = 'ops@regatta.example'
on conflict (user_id) do update set role = excluded.role, station_id = excluded.station_id;

select u.email, a.role, a.station_id from public.app_users a join auth.users u on u.id = a.user_id;
```

## 6. Realtime

Nothing to click: migration `20261021000400_realtime.sql` adds **only** `public.station_status` and
`public.leaderboard_entries` to the `supabase_realtime` publication. Check **Database → Publications →
supabase_realtime** (or the SQL in §3). Never add `sessions`, `session_secrets`, `leg_results` or
`session_actions` there.

## 7. Configure the Vite app

Create `.env.local` in the repo root (git-ignored) with **browser-safe values only**:

```dotenv
VITE_SUPABASE_URL=https://<ref>.supabase.co
VITE_SUPABASE_ANON_KEY=<anon or publishable key>
```

Never put the service role / secret key in any `VITE_` variable — Vite inlines them into the public bundle.
Restart `npm run dev` / rebuild after changing them. Leaving both blank keeps LOCAL DEMO mode.

Terminal setup on event day: open the game on each kiosk, sign in with that station's account, verify the
header shows the right station. The public dashboard needs no login (anon key + Realtime); operators sign
in with the operator account to use **Reset station**.

## 8. Smoke test (curl)

```bash
URL="https://<ref>.supabase.co"; ANON="<anon key>"
TOKEN=$(curl -s "$URL/auth/v1/token?grant_type=password" -H "apikey: $ANON" -H "Content-Type: application/json" \
  -d '{"email":"station-a@regatta.example","password":"<password A>"}' | node -pe 'JSON.parse(require("fs").readFileSync(0)).access_token')

curl -s "$URL/functions/v1/create-session" -H "Authorization: Bearer $TOKEN" -H "apikey: $ANON" \
  -H "Content-Type: application/json" \
  -d '{"nickname":"Smoke Test","characterId":"eugene","pokemonId":"gengar","actionId":"smoke-0000001"}'
# -> 201 {"view":{...,"verified":true,"seedCommitment":"<64 hex>","revealedSeed":null},"meta":{...}}

curl -s "$URL/functions/v1/create-session" -H "Authorization: Bearer $ANON" -H "apikey: $ANON" \
  -H "Content-Type: application/json" -d '{}'
# -> 401 UNAUTHENTICATED  (the anon key alone can never create or resolve)

curl -s "$URL/rest/v1/session_secrets?select=seed" -H "apikey: $ANON" -H "Authorization: Bearer $ANON"
# -> 401/403 permission denied   (and with the station TOKEN as well)
```

Then reset the smoke session (operator token) or finish it: `finish-session` with `reason: "player_reset"`.

## 9. Tests

| Suite | Command | Needs |
|---|---|---|
| pgTAP (RLS, privileges, RPC semantics) | `npx supabase test db` (local) or `npx supabase test db --linked` | Local: Docker. `--linked` runs against the hosted DB (all statements are rolled back); the CLI may still need Docker for `pg_prove` — if it does, use the offline runner. Prefer a staging project; do not run during the event. |
| Same pgTAP files, offline | see header of `supabase/tests/offline/run-pglite.mjs` | Node + one-time download of PGlite and pgTAP into `supabase/.cache/` (git-ignored) |
| Engine ↔ DB round-trip (real engine through real RPCs) | `PGLITE_DIR=supabase/.cache/pglite npx tsx supabase/tests/offline/engine-roundtrip.ts 300` | same as above, after `npm run sync:shared` |
| Edge helpers (validation, error mapping, redaction, crypto, CORS, RNG-leak regression) | `npx vitest run --config supabase/tests/unit/vitest.config.mts` | after `npm run sync:shared` |

## 10. Event-day operations

* **Stuck terminal / player walked away:** dashboard (operator) → Reset station → calls `admin-reset`. The race is
  marked `abandoned` (`operator_reset`, unranked), the terminal shows "Reset by operator". Audited in
  `operator_audit` and `session_actions`.
* **Station password leaked:** re-run the provisioning script for that email with a new password (rotates it),
  then sign the kiosk in again. To block an account immediately: Dashboard → Users → user → **Ban user**
  (functions reject banned users).
* **Offensive nickname on the board:** SQL Editor (project owner):
  `delete from public.leaderboard_entries where session_id = '<id>';` (published entries cannot be *edited*,
  only removed; the removal is visible to all dashboards via Realtime).
* **Logs:** Dashboard → Edge Functions → *function* → Logs. Each line is JSON with `fn`, `requestId`,
  `status`, `durationMs`; the client receives the same id in the `x-request-id` header and error bodies.

## 11. Optional: full local stack (requires Docker)

```bash
npx supabase start                 # applies migrations + seed.sql
npm run sync:shared
npx supabase functions serve       # serves all functions on http://127.0.0.1:54321/functions/v1/*
npx supabase test db
SUPABASE_URL=http://127.0.0.1:54321 SUPABASE_SERVICE_ROLE_KEY=<from `npx supabase status`> \
  PROVISION_PASSWORD='LocalStation1' node supabase/scripts/provision-users.mjs station station_a a@local.test
```

Use `VITE_SUPABASE_URL=http://127.0.0.1:54321` and the local anon key from `npx supabase status`.
