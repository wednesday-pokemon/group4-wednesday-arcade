# HANDOFF — Escape from Raven Island: The Silent Evidence (master revision v3.1)

> **CURRENT DESIGN = MASTER REVISION v3.1** (user, 2026-10-21): `Escape_from_Raven_Island_Game_Development_Plan_v3_1.pdf`
> (transcribed verbatim to `docs/v3.1/GAME_PLAN_v3_1.md`) + `docs/v3.1/MASTER_PROMPT_v3_1.md`. It supersedes the rowing
> design (v3.0-realtime), the v2.5 decision race, separate character/Pokémon selection and character-specific analytics.
> Third-person murder mystery / stealth / egg extraction, 7 Nightshades × 18 Pokémon, three bundled duo cards, Thing
> narrator, four game-wide analytics, rules_version `mystery-v3.1`.
>
> Read in order: `docs/v3.1/GAME_PLAN_v3_1.md`, `docs/v3.1/MASTER_PROMPT_v3_1.md`, `docs/MYSTERY_CONTRACT.md`,
> `src/mystery/types.ts`, `docs/IMPLEMENTATION_PROGRESS.md`, `docs/UX_MYSTERY.md`, `docs/MYSTERY_DESIGN.md`,
> `docs/MOVE_LEGALITY.md`, `docs/ACTIVITY_COMPLIANCE.md`, `docs/DECISIONS.md` (D-35+), `docs/AGENT_SKILL_LOG.md`.
> Restore point for everything before v3.1: git tag `pre-mystery-v3.1`. Everything below this block is HISTORY.

## What the project is
Halloween arcade game for Pokémon Day III (event **Oct 27 2026**), 3 laptops: Laptop 1 dashboard/operator
(`/?mode=dashboard`), Laptops 2/3 player stations. Stack: Vite + React 18 + TypeScript (strict, explicit `.ts` imports)
+ Three.js 0.170 + Supabase (Postgres + Edge Functions + Realtime). Windows machine; Bash = Git Bash.

## History (two designs)
1. **v2.5 decision-based race** — COMPLETE and working. Pure engine `src/game/**` (591 tests), analytics `src/analytics/**`
   (OLS/logistic Raven Vision, Monte Carlo advisor), screens `src/app/**` + `src/ui/**`, 3D cinematic `src/three/RaceScene.ts`,
   Supabase backend `supabase/**` **DEPLOYED** to the user's project, live adapter `src/lib/supabase/**`.
   Being kept at `/?legacy=1` (after the current frontend work) — do not delete.
2. **v3.0-realtime overhaul** (user's revision prompt) — IN PROGRESS. Real-time rowing (SPACE taps), steering (A/D),
   W glide, S brake, Q Pokémon ability, E interact, Esc pause, H hold-to-row. 3 stages:
   Stage 1 The Crossing (row across haunted lake, Hyde chase) → Stage 2 Egg Hunt (on foot, choose egg) →
   Stage 3 Escape to Iago Tower (row back with egg, egg security, final chase, deliver with E) → Results.
   User wants **phase-by-phase delivery and to test after each phase**.

## Phase status (v3)
- **Phase 1 (rowing)** — delivered, user tested and gave correction feedback (see docs/PROGRESS.md):
  "home/selection screens missing", "Hyde doesn't appear", "feels like Subway Surfers with a boat".
- **STATUS @ 2026-10-21 ~09:40 SGT:** the corrections agents were cut off by the Claude account session limit
  (resets 1:10 pm SGT). Their partial work is saved on disk:
  - game-designer — **DONE**: `src/action/data/lake.ts` (`buildLakeCourse`, `LAKE_CHECKPOINTS`, `polygonSignedArea`) +
    `docs/STAGE1_LAKE.md` (3 routes 537/576/652 u, 70 obstacles, encounters, hydeSpawn (−8,−122); NOTE polygons have
    POSITIVE signed area by ½Σ(x_i z_{i+1} − x_{i+1} z_i) — land is the UNION of polygons; place Hyde at hydeSpawn on
    `hyde_emerge`). Not yet typechecked/tested (agent had no shell).
  - game-developer — PARTIAL: `src/action/{run,hyde,abilities,rescue,encounters,land,traits,courseResolver}.ts` exist;
    it reported its files typechecked and was writing an A* autopilot test helper + numeric probe when cut off.
  - 3d-artist — BARELY STARTED (was reading the contract); `src/three/action/{ActionScene,obstacleMeshes}.ts` show edits.
  - frontend-developer — PARTIAL: new v3 flow in `src/app/v3/*` (V3App, flow, useStageLoop, StageView, danger,
    wednesday, runTypes) and `src/ui/action/*` (ActionHud, HydeMeter, AbilityPanel, RescuePrompt, TutorialOverlay),
    `src/ui/v3/*`; it was wiring `run.rescueLeftS()`, `cleanEscapeWindowS`, `surgeTelegraphLeftS()` into the loop.
  - **BLOCKER:** drive C: was full (0.13 GB free) → npm/tsc/vitest/playwright fail with ENOSPC. Free space first
    (npm cache was 4.2 GB: `npm cache clean --force`). Then run `npx tsc --noEmit -p tsconfig.json` + `npx vitest run`.
  - Next session: resume/redo the three partial agents' remaining work (see table) and integrate.
- **Phase 1 corrections** — COMPLETE 2026-10-21, awaiting user acceptance (results in PROGRESS.md; D-32..D-34). Done via 4 parallel agents (exclusive file ownership):
  | Agent | Files | Task |
  |---|---|---|
  | game-designer | `src/action/data/lake.ts`, `docs/STAGE1_LAKE.md` | Open haunted lake `buildLakeCourse()`: land polygons, ≥3 routes, landmarks, encounters, hydeSpawn |
  | game-developer | `src/action/**` (not data/, not types.ts), `tests/unit/action/**` | Land collisions, character stats from CHARACTER_ACTION_DEFS, Hyde AI, encounter director, data-driven abilities, rescue window, `src/action/run.ts` `StageOneRun` |
  | 3d-artist | `src/three/**`, `tools/three-action-preview.*` | Lake world from course data, monstrous Hyde rig + phases, companion + ability VFX, threat-aware camera |
  | frontend-developer | `src/app/**`, `src/ui/**`, `index.html`, `tests/e2e/**` | v3 journey at `/` (Home→Nickname→12 chars w/ portraits+stats→18 Pokémon→Confirm→Tutorial→Stage 1→complete/DNF), HUD per docs/UX_V3_ACTION.md, audio cues, e2e |
  If those agents are gone in the new session: check what exists, run `npx tsc --noEmit -p tsconfig.json` and
  `npx vitest run`, and finish their remaining items against `docs/V3_STAGE1_CONTRACT.md`.
- **After corrections, the orchestrator must:** integrate (resolve API mismatches between run.ts / ActionScene / HUD),
  add a navigability test for `buildLakeCourse()` (grid BFS start→finish, hull clearance, all drift phases, each route),
  then **browser-playtest** (Playwright, `--use-angle=swiftshader`) against the user's 15 acceptance criteria
  (in the correction prompt: home restored; 12 chars; 18 Pokémon; selections affect play; WASD+SPACE; no lanes; Hyde
  visible; Hyde reacts; Hyde can catch; fair escape; abilities visibly matter; haunted lake not endless runner; Stage 1
  destination reachable; smooth on laptops; Supabase/analytics no regression). Use the debugger agent for failures.
  Then hand to the user with test instructions. **Do NOT start Stage 2 until the user accepts the corrected Stage 1.**
- **Phase 2** (in the revised plan the Hyde + Stage 1 were pulled into the corrections), **Phase 3** Egg Hunt (player CHOOSES
  egg: Common near/easy, Rare further behind hazards, Legendary deep guarded crypt — D-25), **Phase 4** Iago Tower escape
  + egg security + delivery, **Phase 5** full character/Pokémon balance pass, **Phase 6** analytics (descriptive/
  diagnostic/predictive/prescriptive for real-time), Supabase v3 tables + server-side plausibility validation, new
  `rules_version 'v3.0-realtime'` leaderboard separate from v2.5, dashboard, audio, perf, docs.

## Key user decisions (binding)
- D-25 player chooses egg tier · D-26 every finisher ranks above every DNF; score = egg points × 100 − active seconds
  (negative allowed) · D-27 whole egg points only (Gholdengo = egg protection) · D-28 keep Phase 1 rowing feel until user
  feedback · D-30 portraits extracted from the client's Visual Reference Guide PDF → `public/art/{characters,pokemon}/*.webp`
  (rights caveat recorded).

## Supabase (live)
- Project ref `abkohhdjlufhsbqrchpn` (ap-northeast-1). `.env` (gitignored) holds VITE_SUPABASE_URL + anon key.
  CLI is linked (`supabase/.temp`). 4 migrations pushed; 6 Edge Functions deployed (v2.5 rules). Accounts provisioned:
  station-a@regatta.example, station-b@regatta.example, ops@regatta.example (passwords were given to the user in chat).
- A test entry "LiveTest" (score 51.88) is on the live v2.5 leaderboard — ask the user whether to remove it.
- **Security TODO for the user:** rotate the service_role key (it was pasted in chat), then send the new publishable key
  for `.env` and set `RAVEN_SERVICE_KEY` secret for functions (see docs/SUPABASE_SETUP.md).
- v3 needs new migrations (stage progress, real-time telemetry, verified v3 scores) — Phase 6. Never put service keys in
  client code. Re-run `npm run sync:shared` before any function deploy.

## Commands
`npm run dev` (http://localhost:5173; restart it after dependency/route changes — stale dev servers caused a duplicate-React
blank page once) · `npx tsc --noEmit -p tsconfig.json` · `npx vitest run` (≈720+ tests) · `npm run typecheck:functions` ·
`npm run test:supabase-unit` · `npm run test:db:offline` (PGlite pgTAP) · `npm run test:db:roundtrip` · `npx vite build` ·
`node tests/e2e/smoke.mjs` · data/models: `npm run data:generate && npm run models:train && npm run models:evaluate`.
Playwright scripts must live inside the repo (e.g. `output/*.mjs`) to resolve the `playwright` package.

## Working agreements
- The user explicitly wants the installed agents + skills used and logged in `docs/AGENT_SKILL_LOG.md`.
- Exclusive file ownership per agent; orchestrator integrates and verifies in a real browser before reporting.
- Never claim untested things work; record honest results in docs/PROGRESS.md and docs/TEST_REPORT.md (not yet written).
- Nothing is committed to git yet (no commits). Ask the user before committing.
- Remaining Phase 6 docs to write: README.md, docs/TEST_REPORT.md, docs/THREE_LAPTOP_RUNBOOK.md, docs/ARCHITECTURE.md.
