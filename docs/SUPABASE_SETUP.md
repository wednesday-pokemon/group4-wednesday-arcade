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
-- exactly: leaderboard_entries, station_status   (+ mystery_results, mystery_station_status once §12 is applied)
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
`session_actions` there. (Mystery v3.1 adds exactly `mystery_station_status` and `mystery_results`, see §12.)

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

---

## 12. Mystery v3.1 "The Silent Evidence" (rules `mystery-v3.1`) — additive backend

> **Status: built and tested offline only. NOT deployed.** Nothing below has been pushed to the hosted project;
> deployment needs the owner's explicit approval. Every step is additive: the v2.5 tables, rows, views, RPCs and
> functions keep working unchanged (`/?legacy=1`), and v2.5 results are never mixed with mystery results.

### 12.1 What is added

| Piece | Location |
|---|---|
| Schema (9 tables, 3 leaderboard views, immutability triggers) | `supabase/migrations/20261021000500_mystery_schema.sql` |
| RLS + grants | `supabase/migrations/20261021000600_mystery_rls_and_grants.sql` |
| Atomic RPCs (service role only) | `supabase/migrations/20261021000700_mystery_rpcs.sql` |
| Realtime (adds `mystery_station_status`, `mystery_results` only) | `supabase/migrations/20261021000800_mystery_realtime.sql` |
| Three cases: case per session (per-station bag), widened clue CHECKs, evidence/deduction, per-case views, column privileges (§12.6) | `supabase/migrations/20261022000100_mystery_cases.sql` |
| Edge Functions | `supabase/functions/{mystery-create-session,mystery-get-session,mystery-select-duo,mystery-append-events,mystery-finalize}`; `admin-reset` extended (`scope`) |
| Server rules (pure, unit-tested) | `supabase/functions/_shared/{mystery-events,mystery-rules,mystery-validation,mystery-db}.ts` |
| Generated copies of the browser's pure modules | `supabase/functions/_shared/mystery/**` and `_shared/mystery-registry.generated.ts` ← `npm run sync:shared` |
| Tests | `supabase/tests/004_*`, `005_*`, `006_mystery_cases` (pgTAP), `supabase/tests/unit/{mystery,shared-identity}.test.ts`, `supabase/tests/offline/mystery-roundtrip.ts` |

Tables (all RLS-enabled; no client role can INSERT/UPDATE/DELETE anything):

| Table | Purpose | Readable by |
|---|---|---|
| `mystery_sessions` | session UUID, station, `rules_version = 'mystery-v3.1'`, server seed, assigned `case_id` + `case_version`, status `offered → playing → finished/dnf` (or `abandoned`), selected duo, event projections, validated `progress` | own station, operator |
| `mystery_offered_duos` | the 3 server-computed cards (slot 0–2; unique (session, slot) and (session, character, pokemon); full `card` + `stats` jsonb) | own station, operator |
| `mystery_events` | StampedEvents (`seq`, `t`, `type`, `payload`), unique (session, seq), append-only; ≤ 1 finish/dnf, ≤ 1 accusation, ≤ 1 delivery per session | own station, operator |
| `mystery_clue_events` | one row per discovered clue (derived from validated `clue_found`) | own station, operator |
| `mystery_forecasts` | prediction **as issued** (`target`, `value`, `model_label` `ml`/`rule_based`, `model_version`, `features`) — immutable | own station, operator |
| `mystery_recommendations` | advice, `accepted`, `outcome` (fill-only: null → value, never rewritten) | own station, operator |
| `mystery_results` | one immutable server-recomputed result per session (case, outcome, verdict, accused, correct, cited evidence, deduction, clues, egg tier/points/security, active time, score — null for DNF —, catches, claim audit) | everyone, EXCEPT the columns `accused`, `evidence`, `client_claim` (no client role; operators via `mystery_result_audit`); test runs: operator only |
| `mystery_case_bags` | per station: remaining case ids of the current shuffled bag + the case dealt last | service role only (RLS on, no policy) |
| `mystery_session_actions` | receipts/audit (create, select, finalize, abandon) | operator |
| `mystery_station_status` | sanitized live status per terminal (Realtime) | everyone |

Views (security invoker, rules-version partitioned, test runs excluded, NO `accused` column): `mystery_leaderboard`
(finishers, `rank` over all cases + `case_rank` within the row's `case_id`, score desc → active time asc → finalized
first), `mystery_defeated` (DNFs only), `mystery_standings` (every finisher — negative scores included — above every DNF;
DNFs unranked, longest survival first; `standing_group` 0/1; `rank` combined, `case_rank` per case). Operator-only:
`mystery_result_audit` (definer view filtered by `private.is_operator()`: accused, evidence, client_claim).

### 12.2 Deploy (only after approval)

```bash
npm run sync:shared                       # copies src/mystery pure modules + data; fails on impure/out-of-tree imports
npm run typecheck:functions && npm run test:supabase-unit && npm run test:db:offline && npm run test:db:roundtrip
npx supabase db push --dry-run            # must list ONLY the mystery migrations not applied yet: 20261021000500..800 and 20261022000100_mystery_cases
npx supabase db push
npx supabase functions deploy --use-api \
  mystery-create-session mystery-get-session mystery-select-duo mystery-append-events mystery-finalize admin-reset
```

No new secrets are required. Optional: `npx supabase secrets set MYSTERY_ALLOW_TEST_SEEDS=true` lets
`mystery-create-session` accept a `testSeed` (operator seed-reuse tests) and, together with it, a `testCase` (one of
`poisoned_archive`, `crypt_last_witness`, `midnight_signal`) that forces the session's case without touching the station's
bag; such sessions are stored with `is_test = true` and never ranked or shown publicly. Leave it unset on event day
(without the flag both fields answer `403 TEST_SEED_FORBIDDEN`; `testCase` without `testSeed` is `422 INVALID_INPUT`). Redeploy the mystery functions whenever
`src/mystery/{types,draft,stats,scoring,caseLogic,config}.ts` or `src/mystery/data/**` change (after `npm run sync:shared`):
the server must compute the same offers, egg tiers and verdicts as the browser.

Verify in the SQL Editor:

```sql
select station_id, status from public.mystery_station_status;            -- both 'idle'
select tablename from pg_publication_tables where pubname = 'supabase_realtime' order by 1;
-- leaderboard_entries, mystery_results, mystery_station_status, station_status
select count(*) from public.sessions;                                     -- unchanged v2.5 history
```

### 12.3 Client contract (what the frontend adapter calls)

All calls: `POST {SUPABASE_URL}/functions/v1/<name>`, headers `Authorization: Bearer <station JWT>`, `apikey: <anon>`,
`Content-Type: application/json`, optional `x-request-id`. The station is always taken from the JWT; bodies never carry
it. Errors: `{ "error": { "code", "message", "retryable", "details?" }, "requestId" }` (same envelope as v2.5).

| # | Function | Request | Success | Errors |
|---|---|---|---|---|
| 1 | `mystery-create-session` | `{ actionId, nickname, testSeed?, testCase? }` | `201` new / `200` + `x-idempotent-replay` → `MysterySessionEnvelope` (with the assigned `caseId`; a replay returns the SAME case) | 422 INVALID_INPUT, 403 TEST_SEED_FORBIDDEN, 409 ACTION_ID_CONFLICT, 429 RATE_LIMITED (6 creates/min/station) |
| 2 | `mystery-get-session` | `{ sessionId? }` | `200` → envelope, or `{session:null,offer:null,result:null}` when nothing is open | 404 SESSION_NOT_FOUND (also for another station's id) |
| 3 | `mystery-select-duo` | `{ sessionId, characterId, pokemonId }` | `200` → envelope (`status: "playing"`); same choice again = replay | 422 DUO_NOT_OFFERED, 409 ALREADY_SELECTED, 409 SESSION_CLOSED |
| 4 | `mystery-append-events` | `{ sessionId, events: StampedEvent[≤500], forecasts?: [≤50], recommendations?: [≤50] }` (≤ 256 KB) | `200` → `{ sessionId, accepted, duplicates, lastSeq, lastT, eventCount, terminal, progress, forecastsInserted, recommendationsUpserted }` | 422 EVENT_REJECTED `{seq, rule}` (e.g. `clue_unknown` for a clue of another case, `accusation_duplicate`), 409 SEQ_CONFLICT `{seq, lastSeq}`, 409 NOT_SELECTED, 409 SESSION_CLOSED, 422 TOO_MANY_EVENTS (20 000/session), 409 CASE_OUTDATED |
| 5 | `mystery-finalize` | `{ sessionId, clientResult? }` (`clientResult` = the browser `RunResult`, audit only) | `201` → `{ sessionId, result: MysteryResultView, rank, reveal }` (`reveal = { culprit, resolution }` for a finished run, `null` for a DNF); every later call `200` + replay with the **same** result + reveal | 409 RUN_NOT_FINISHED, 409 NOT_SELECTED, 409 SESSION_CLOSED, 409 CASE_OUTDATED |
| – | `admin-reset` (operator) | `{ stationId, reason, actionId, scope?: "all" \| "legacy" \| "mystery" }` | `200` → `{ stationId, scope, abandonedSessionIds, abandonedMysterySessionIds, notice: "operator_reset" }` | as v2.5 |

```jsonc
// MysterySessionEnvelope
{
  "session": {
    "sessionId": "uuid", "stationId": "station_a", "rulesVersion": "mystery-v3.1",
    "status": "offered | playing | finished | dnf | abandoned", "abandonedReason": "null | superseded | operator_reset | player_reset",
    "seed": "32 hex (feed MysteryRun({ seed }))", "nickname": "Ann", "isTest": false,
    "caseId": "poisoned_archive | crypt_last_witness | midnight_signal", "caseVersion": 1, // feed MysteryRun({ caseDef: caseById(caseId) })
    "selected": null, // or { "characterId": "enid", "pokemonId": "drifblim", "slot": 1 }
    "lastSeq": -1, "lastT": 0, "eventCount": 0,
    "progress": { "cluesFound": [], "egg": "resting", "eggSecurity": 100, "catches": 0, "sightings": 0, "delivered": false, "accused": false, "terminal": null },
    "createdAt": "…", "selectedAt": null, "finalizedAt": null
  },
  "offer": { "seed": "same 32 hex", "cards": ["DuoCard", "DuoCard", "DuoCard"] }, // exactly draftOffer(seed)
  "result": null // or MysteryResultView
}
// MysteryResultView = RunResult fields (minus hp; incl. caseId, caseVersion, evidence, deductionCorrect) + { sessionId,
//   sightings, hintsUsed, nickname, stationId, isTest, claimMatches, verified: true, finalizedAt };
//   duo = { characterId, pokemonId }; score null for DNF. Returned to the OWNING station only.
// accusation event payload = { suspectId: SuspectId|null, correct, cluesFound, evidence: string[≤5], deductionCorrect }
// forecasts[i]       = { forecastNo, t, target: "detection_15s"|"extraction"|"eta_s", value, modelLabel: "ml"|"rule_based", modelVersion?, features: {name: number|bool|string|null} }
// recommendations[i] = { recNo, t, action: "snake_id", advice: "≤240 chars", trigger?: "hint"|"context", accepted?: bool|null, outcome?: "snake_id"|null }
```

Adapter flow (station kiosk):

1. **New visitor** (nickname entered): generate `actionId = crypto.randomUUID()`, persist it in
   `localStorage['raven.mystery.session']` **before** calling `mystery-create-session`; store the returned
   `{ sessionId, seed, offer }`. Show `offer.cards` exactly as returned (never call `draftOffer` locally in verified mode).
2. **Refresh / reconnect**: `mystery-get-session { sessionId }` (or re-send create with the same `actionId`) → the same
   offer, `selected`, `lastSeq`. If `status` is `abandoned` (superseded / operator reset), start a new visitor flow.
3. **Card chosen**: `mystery-select-duo`, then `new MysteryRun({ duo, seed: session.seed })`.
4. **During play**: queue the StampedEvents from `run.update()` / `run.accuse()`; flush every ~2 s or 100 events, **one
   request in flight**; on network failure resend the same batch (duplicates are ignored). Cosmetic events (e.g. footstep
   `noise`) may be thinned client-side — seq gaps are allowed — but **every** `clue_found`, `egg_*`, `catch`,
   `accusation`, `finish`, `dnf`, `hyde_sighted`, `hint_requested` must be sent. Forecasts/recommendations ride along in
   the same calls. On `409 SEQ_CONFLICT` / `STALE_EVENTS`: `mystery-get-session`, drop everything ≤ `lastSeq`, resend
   the rest. On `422 EVENT_REJECTED`: stop syncing that run and show it as **unverified** (local result only).
5. **Run over** (`finish` or `dnf` acknowledged, `terminal` non-null): send any last recommendation outcomes, then
   `mystery-finalize { sessionId, clientResult: run.result() }`; display the **server** `result` and `rank`.
   Retrying finalize is always safe.
6. **Play again**: new `actionId` → `mystery-create-session` (the old open session, if any, is superseded, unranked).
7. **Dashboard (anon)**: read `mystery_station_status`, `mystery_leaderboard`, `mystery_standings`, `mystery_defeated`,
   `mystery_results`; subscribe via Realtime to `mystery_station_status` and `mystery_results`. Operator sign-in
   additionally allows reading events/forecasts/recommendations for the analytics panels.

### 12.4 Tests

| Suite | Command | Covers |
|---|---|---|
| pgTAP `004_mystery_structure_rls` (109) + `005_mystery_rpcs` (64) + `006_mystery_cases` (24) | `npm run test:db:offline` (or `npx supabase test db`) | RLS/privileges per role (incl. column privileges: anon/stations cannot select `accused`/`evidence`/`client_claim`), constraints (case ids, widened clue ids, solved ⇒ correct ∧ deduction ∧ 3 clues, evidence ≤ 5 ids), duplicate seq rejected, single terminal, idempotent create/select/finalize, supersede, rate limit, leaderboard with negative scores above DNFs, operator reset, v2.5 rows untouched; case bag: 6 creates → each case exactly twice, never twice in a row, replay keeps the case, stations independent, forced test cases, per-case standings |
| Unit (Vitest) | `npm run test:supabase-unit` | parsers (incl. `testCase`, accusation evidence), every event-order rule (clue ids of the session's case only), resend dedupe, verdict/score/evidence/deduction recomputation with the server's answer keys for all three cases, forged evidence dropped, lying claims overruled, `CASE_OUTDATED`, reveal, SQL score-CHECK parity, offer determinism + sanity, shared-copy identity + registry binding |
| TS ↔ SQL round-trip | `npm run test:db:roundtrip` | 150 random mystery sessions through the real modules + RPCs (cases from the bag; replay keeps the case; per-station case counts never differ by more than one) + for EACH case: solved / wrong suspect / forged evidence, second finalize = same row, second accusation refused (plus the 300 v2.5 races) |
| Integration (fake project) | `npx vitest run tests/integration` | kiosk ↔ functions ↔ board end to end: case assigned at create and identical after restore / refresh / replayed create, own bag per station, forged evidence dropped, wrong accusation claimed as correct overruled, one-shot accusation, finalize `reveal`, board per-case standings, no secret column on any public read or Realtime payload |

### 12.5 Event-day operations (mystery)

* **Stuck terminal:** operator → Reset station → `admin-reset` (default `scope: "all"` resets the v2.5 race and the mystery
  session of that station). The mystery session becomes `abandoned/operator_reset` (unranked, events kept for analytics),
  `mystery_station_status` shows `idle` + `notice: operator_reset`. One `operator_audit` row lists all abandoned ids.
* **Offensive nickname:** `delete from public.mystery_results where session_id = '<id>';` (results cannot be edited).
* **Function errors:** logs carry `fn`, `requestId`, `status`, `durationMs` plus `mystery_events_appended`,
  `mystery_finalized` (`claimMatches=false` is logged at `warn`: the browser's own score/verdict differed from the server's).

### 12.6 Three cases (migration `20261022000100_mystery_cases.sql`, 2026-10-22)

Contract: `docs/MYSTERY_CASES.md`. Everything is additive; pre-existing rows are backfilled as `poisoned_archive` v1.

* **Assignment.** `mystery_create_session(…, p_case_versions jsonb, p_test_case text default null)` draws the case
  inside the existing `public.stations` row lock via `private.mystery_draw_case`: pop the head of
  `mystery_case_bags.bag`; an empty bag is refilled with a fresh `order by random()` permutation whose head is swapped
  away from `last_case` (so the same case is never dealt twice in a row and every 3 consecutive sessions of a station
  play all three cases). The function passes the deployed `CaseDef.version` of every case (`p_case_versions`), the
  RPC stores the drawn case's version. A replayed `actionId` returns `{ replay: true, sessionId, caseId, caseVersion }`
  and draws nothing. `p_test_case` is only accepted with `p_is_test` (it never touches the bag).
* **Validation.** append-events / finalize resolve the session's `case_id` → `CaseDef` + the server's own
  `CaseSolution` (generated registry: `MYSTERY_DATA.cases` / `MYSTERY_DATA.solutions`). Clue ids of other cases are
  `EVENT_REJECTED: clue_unknown`. A session whose stored `case_version` differs from the deployed one answers
  `409 CASE_OUTDATED` (cannot be verified) — so redeploy only between visitors.
* **Accusation.** Payload `{ suspectId, correct, cluesFound, evidence: string[≤5], deductionCorrect }` (strict). Finalize
  sanitizes `evidence` with the shared `caseLogic.sanitizeEvidence` (found clues + the case's notes; unknown / forged
  ids dropped; `[]` when nobody was accused) and recomputes `verdict` / `correct` / `deductionCorrect` with
  `verdictFor` + its own answer key. Client values only feed `claim_matches` (raw cited ids kept in `client_claim`).
* **Results.** `mystery_results.case_id / case_version` (copied from the session, never from the body),
  `evidence text[]`, `deduction_correct`; `case_solved ⇒ correct ∧ deduction_correct ∧ 3 clues` (NOT VALID: legacy
  rows kept). The finalize response adds `reveal: { culprit, resolution } | null` — the only response that ever
  contains the culprit, and only once the run is stored.
* **Secrecy.** Column privileges: `anon` / `authenticated` may select every `mystery_results` column except
  `accused`, `evidence`, `client_claim` (`select *` is a permission error — always list columns). Realtime
  `postgres_changes` omits non-selectable columns. Operators read them via `public.mystery_result_audit`.
* **Board.** `mystery_station_status.case_id`, `mystery_standings.case_id / case_rank`, `mystery_leaderboard.case_rank`.
  The feed exposes `snapshot.standings` (combined) and `snapshot.standingsByCase[caseId]` (rank within the case).

Verify after `db push`:

```sql
select station_id, bag, last_case from public.mystery_case_bags;          -- rows appear with the first create per station
select case_id, count(*) from public.mystery_sessions group by 1;          -- even per station
select has_column_privilege('anon', 'public.mystery_results', 'accused', 'SELECT');   -- false
```

### 12.4 Client notes (live mystery client, 2026-10-21)
- Routes: `/` = LOCAL DEMO (never touches the leaderboard); `/?mode=terminal&station=station_a|station_b` = live mystery
  kiosk (add `&legacy=1` for the v2.5 terminal); `/?mode=dashboard` = live mystery board (`&demo=1` local board,
  `&legacy=1[&demo=1]` v2.5 board).
- The live session record is per station: `localStorage['raven.mystery.session:<station>']` (actionId, nickname,
  sessionId) — separate from the demo's `raven.mystery.session`, so a demo session can never pass as verified.
- Heartbeat broadcast topic: `raven-mystery-live` (see SECURITY.md §7.5).
