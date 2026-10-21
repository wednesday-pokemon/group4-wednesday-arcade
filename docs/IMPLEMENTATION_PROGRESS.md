# Implementation progress — mystery v3.1 "The Silent Evidence"

Requirements: `docs/v3.1/MASTER_PROMPT_v3_1.md`, `docs/v3.1/GAME_PLAN_v3_1.md`. Contract: `docs/MYSTERY_CONTRACT.md`.
Honesty rule: a box is ticked only with evidence (test output, browser playtest, file). Agents/skills: `docs/AGENT_SKILL_LOG.md`.

## Phase 0 — audit and freeze (2026-10-21) ✅
- Git: branch `EscapeGame`, one local commit `79c088d Initial Draft` (push to github.com/wednesday-pokemon/wednesday-system
  was rejected 403 — pending user credentials). Checkpoint tag **`pre-mystery-v3.1`** = full rowing build.
- Baseline (before any v3.1 edit): `tsc --noEmit` exit 0; `vitest run` 26 files / 941 tests pass; `vite build` OK;
  Supabase checks (functions typecheck, unit, PGlite pgTAP, 300-race round trip) pass.
- Existing, reusable:
  - Home page `src/ui/screens/Splash.tsx` (gothic identity, works at `/`), `Nickname.tsx`, header tools, settings
    (reduced motion, low graphics, mute), fonts/tokens `src/ui/styles/**`, audio engine `src/app/audio.ts`,
    keyboard mount guard, test hooks (`render_game_to_text`, `advanceTime`).
  - Portraits for all 7 Nightshades + 18 Pokémon in `public/art/**` (D-30/D-34 rights caveat).
  - Three.js toolkit: `src/three/{util,shaders,particles,actors}.ts`, Hyde rig `src/three/action/hydeRig.ts`, land/landmark
    builders, fx materials.
  - Supabase project (v2.5 schema, RLS, Edge Functions, live dashboard, operator reset) + live adapter `src/lib/supabase/**`.
  - Dashboard `/?mode=dashboard` (v2.5 board).
- Superseded (kept, not deleted): v2.5 decision race (`/?legacy=1`), v3.0 rowing (`src/action/**`, `src/three/action/**`,
  `src/app/v3/**`) → to be moved to `/?mode=rowing`; separate character/Pokémon selection screens (removed from the journey,
  files kept). Old rowing/v2.5 stored results stay in their own rules_version partitions.
- Not found: official activity rubric (see `docs/ACTIVITY_COMPLIANCE.md`); client GDD v2.5 PDF no longer on disk (was never
  committed; content summarised in docs/RULES_SPEC.md).

## Phases 1–3 — vertical slice, narrative, full roster (built; one blocker)
- Sim `src/mystery/**` (game-developer): nav grid + A*, noise/occlusion hearing, sight cone/fog/cover/hiding, Hyde FSM
  PATROL→INVESTIGATE_SOUND→SEARCH→CHASE→COOLDOWN with reasons, grab (−35 HP × mods, egg loss/drop, safe release,
  invulnerability, 2nd catch / HP 0 = DNF, King's Shield blocks damage but counts), egg tiers 50/35/15, hold-E drop,
  tower deposit → accusation (incl. accuse(null)), verdict truth table, score, 7 F powers + 18 Q moves via one
  effect-kind interpreter, seeded 3-card draft with role diversity, card stats derived from real mods. 171 tests.
  Bots: stealthy 139/140 finish (median 171 s), careless 126/140; all 126 duos finish (no softlock).
- Data `src/mystery/data/**` (game-designer): island map, tuning, roster, case, Thing lines; moves 18/18 verified
  (docs/MOVE_LEGALITY.md → data/legality.ts).
- Renderer `src/three/mystery/**` (3d-artist): island, 7 distinct avatars, Hyde biped with mode body language, Thing
  (10 poses), clues/egg/tower, VFX for every effect kind, follow camera.
- App `src/app/mystery/**`, `src/ui/mystery/**` (frontend): restored home + Thing sigil, nickname, 3 duo cards
  (refresh-stable), ≤ 25 s tutorial with the exact Stay Silent line, HUD per docs/UX_MYSTERY.md, evidence board +
  accusation, results, pause/settings, C crouch + keyboard-lock-gated Ctrl, pointer-lock pause, arrow-key look.
- Verified by orchestrator: tsc 0, full vitest green, build OK; two full KEYBOARD playthroughs through the real input
  path (docs/PLAYTEST_RESULTS.md): Enid+Gengar Case Solved 192.6 s score 107.4; Ajax+Gholdengo Case Solved 201.8 s 398.2.
- **Open blocker:** GPU fill-rate — 12 fps at 1366×768 on the Intel UHD (rowing scene did 57 fps); camera occluded by a
  wall at the egg. With the 3d-artist.

## Phase 4 — four analytics (services built; UI wiring in progress)
- `src/mystery/analytics/**` (fullstack-developer): TelemetryCollector → Descriptive / Diagnostic (cause vs pattern)
  / Predictive / Prescriptive; no character-id branches (source-scan test); all 126 duos smoke-tested.
- Predictive: 756 simulated episodes (126 duos × 6 profiles), session-grouped split 591/165; P(detected within 15 s)
  held-out Brier 0.083 vs base-rate 0.120, AUC 0.883; rule-based fallback labelled; docs/MYSTERY_MODEL_REPORT.md.
  Simulated bots ≠ people (stated everywhere).
- Wired (frontend): HUD risk chip (exact label), Thing V/context advice with Why:, four results panels, Laptop 1 dashboard
  (local + live) with ModelCard. 4-duo proof: Enid+Gengar, Morticia+Aegislash, Ajax+Gholdengo, Wednesday+Gengar.
## Phase 5 — backend (built + tested offline; NOT deployed — awaiting owner approval)
- supabase/: 4 additive migrations, 5 Edge Functions, admin-reset scope, RLS, leaderboard views (finishers above DNFs),
  pgTAP 001–005 + 300 v2.5 + 150 mystery round trips pass.
- Live client (src/lib/supabase/mystery*.ts, src/app/mystery/live*): server-issued offers, select, batched event upload
  with retry/offline/SEQ_CONFLICT recovery, finalize with server rank, operator reset watch, live dashboard + heartbeat.
  Fake-server tests (21). Routes in docs/SUPABASE_SETUP.md §12.4.
## Phase 6 — polish & acceptance (in progress)
- Done: perf fix (60 fps cap on this Intel UHD), camera visibility audit (272/0), PokéAPI artwork for all 18 partners
  (cards, HUD, in-world companion; D-36), card text merge, F-hotkey fix, OPERATOR_RUNBOOK + THREE_LAPTOP_RUNBOOK +
  scripts/kiosk, 3 scripted keyboard playtests (docs/PLAYTEST_RESULTS.md).
- Pending (owner): deploy approval, ≥ 10 HUMAN playtests on event laptops, 2-station + dashboard rehearsal, laptop
  settings via scripts/kiosk/check-laptop.ps1, official rubric.
