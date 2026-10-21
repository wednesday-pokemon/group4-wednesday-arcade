# Progress

Original prompt: Claude Code Master Build Prompt rev 2.6 — build "Escape from Raven Island: The Hyde's Regatta" (GDD v2.5)
end-to-end: deterministic rules, playable Three.js local demo, four analytics layers, secure Supabase backend, 3-laptop kiosk mode.

## Checklist

### Phase 1 — Foundations
- [x] Repo inspected (empty except GDD + visual guide PDFs); git init; Vite/React/TS/Three/Vitest/Playwright installed
- [x] Canonical contracts: src/game/types.ts, constants.ts, random.ts; docs/RULES_SPEC.md; docs/DECISIONS.md
- [ ] Rules engine + 216-pairing tests (game-developer)
- [ ] Design review + copy (game-designer)

### Phase 2 — Playable local demo
- [ ] Three.js RaceScene (3d-artist)
- [ ] UX spec (ui-ux-designer) → screens (frontend-developer)
- [ ] Local demo adapter + app shell

### Phase 3 — Analytics
- [ ] Telemetry + diagnostic waterfall
- [ ] Synthetic data (10k races) + OLS / logistic training + report
- [ ] Monte Carlo strategist (512 rollouts, 25 % DNF cap) in a Web Worker

### Phase 4 — Supabase
- [ ] Migrations, RLS, atomic RPC, Edge Functions, pgTAP (backend-architect)

### Phase 5 — Multi-terminal
- [ ] Live adapter, Realtime dashboard, reconnect/idempotency (fullstack-developer)

### Phase 6 — Polish & handoff
- [ ] Code review, debugger sweep, runbook, test report, README

## Blocked / external
- Docker not installed → local Supabase stack / pgTAP cannot run here.
- No Supabase project credentials → live mode cannot be deployed or verified here.
- Physical 3-laptop tests and 10 real visitor sessions (A02/A18) require the event hardware and people.

## Live deployment log
- 2026-10-21: user created project `abkohhdjlufhsbqrchpn` (ap-northeast-1), supplied the anon key (stored in gitignored `.env`),
  ran `supabase login`, disabled public sign-ups, and explicitly approved deployment.
- `supabase link` + `db push`: 4 migrations applied (core schema, RLS/grants, session RPCs, realtime).
- `functions deploy --use-api`: create-session, get-session, prepare-leg, resolve-leg, finish-session, admin-reset deployed (after `npm run sync:shared`).
- Anon smoke test against the live project: station_status/leaderboard readable; sessions, session_secrets, leaderboard writes
  denied (42501); create-session and admin-reset → 401 UNAUTHENTICATED (functions boot on hosted Deno); commit RPC not exposed.
- PENDING (user): provision station_a / station_b / operator accounts with the service_role key locally (never via chat).


# v3.0-realtime overhaul (client revision prompt, 2026-10-21)
Original revision prompt: "Real-Time Interactive Gameplay Overhaul" — row with SPACE, steer WASD, explore for the egg,
escape the Hyde to Iago Tower, active Pokémon abilities; delivered phase by phase, user tests after each phase.

## Phase 1 — Interactive rowing ✅ (ready for user testing at /?mode=play)
- Logic: src/action/{types,config,characterStats,input,rowing,collision,course,session}.ts
- Render: src/three/action/{ActionScene,obstacleMeshes}.ts (reuses boat rig, water/sky shaders, particle pool)
- UI: src/app/action/{ActionApp.tsx,useRowingLoop.ts}, src/ui/action/ActionHud.tsx, src/ui/styles/action.css; route `mode=play`
- Audio: splash/scrape synth added to src/app/audio.ts
- Tests: tests/unit/action/rowing.test.ts (21) — tapping, key-repeat, cadence cap, decay, frame-rate independence,
  steering, W glide, stamina drain/recovery, collisions/cooldown/defense, crash recovery, shore slide, course navigable
- Browser playtest (headless Chromium): 6 s @3 taps/s → 24.7 m; held SPACE = 1 stroke; pause freezes clock;
  collision −14/−15 HP with flash + particles; recovery after crash; 24 draw calls; no console errors
- Autopilot pacing: crossing in 49–64 s; 4 taps/s ends with 1 stamina and is slower than 3 taps/s
- Fixed during playtest: boundary killed speed (now slides); rock contact pinned boat (impact vs sustained contact)

## Next: Phase 2 — Stage 1 + Hyde (pursuit AI, damage, docking checkpoint, stage transition)

## Phase 1 corrections — status 2026-10-21 (continuation session)
Client feedback: "home/selection screens missing", "Hyde doesn't appear", "feels like Subway Surfers with a boat".
- Open haunted lake `src/action/data/lake.ts` (designer; docs/STAGE1_LAKE.md): 520 u crossing, Nevermore Gate → Bell Pool
  three-way fork (Western Bay safe ~690 u, Reef Run risky ~527 u, Gallows Narrows currents ~655 u), 2 cross-overs,
  Raven Harbour approach; 66 obstacles, 11 land polygons, 9 landmarks, 5 currents, 3 fog banks, authored encounters.
  `tests/unit/lake/lakeNavigability.test.ts` 16/16 (BFS start→dock at 8 drift phases + per-route bands).
- Renderer `src/three/action/ActionScene.ts` composes land/landmarks/lanterns/Hyde rig/companion/ability VFX; threat camera.
- Gameplay tests: 191 new in tests/unit/action (stats, 18 abilities, Hyde AI, rescue, encounters, land, determinism,
  autopilot end-to-end incl. 216 crew pairs). D-32 Hyde retune; D-33 Gholdengo passive.
- Frontend: e2e smoke moved to /?legacy=1 (PASS), new tests/e2e/v3-stage1.mjs (PASS), tutorial freeze + rescue-step fixes,
  stamina over-pace cue, 15/15 UX checklist.
- Verified by orchestrator: tsc 0; vitest 26 files / 941 tests; typecheck:functions, test:supabase-unit,
  test:db:offline (pgTAP PGlite), test:db:roundtrip (300 races, 31,324 assertions), vite build — all pass.
- Real-time playtest through the real UI (output/orchestrator-playtest.mjs, preview build, headless Chromium on the
  real Intel UHD GPU, D3D11):
  | Run | Result | Hyde | FPS / draw calls |
  |---|---|---|---|
  | Wednesday+Gengar, Western Bay, 3 taps/s | finished 82.0 s, 0 catches, 1 collision, 1 close call | emerged 23.6 s, median gap 21 u, min 7.6 u, on screen 92 % while hunting | ~57 fps, ≤ 74 calls |
  | Xavier+Aegislash, Reef Run, 1.5 taps/s | finished 88.5 s; caught at 53 s → Q → clean escape (catch not counted) | lunge 51.8 s, min 3.1 u, on screen 78 % | ~58 fps, ≤ 74 calls |
- OPEN (being fixed): camera clips inside the Hyde at ≤ 3 u (lunge/rescue) and frames the boat too small from behind
  the Hyde at 20–26 u (3d-artist).
- Camera fixed (3d-artist round 2, verified by orchestrator after the agent stalled). Re-run of the real-UI playtests:
  Western Bay 3 taps/s (Wednesday+Sableye) finished 80.9 s, 0 catches, Hyde on screen 97 % while hunting, ~54 fps;
  Reef Run 1.5 taps/s (Xavier+Aegislash) caught at 53.6 s → Q clean escape → finished 87.8 s, Hyde on screen 93 %, ~52 fps.
- Portraits (D-34): 7 new client portraits wired in, 18 Pokémon restored; output/art-check.mjs → 0 broken images.
- Final: tsc 0; vitest 26 files green. Phase 1 corrections READY FOR USER TESTING. Do not start Stage 2 until accepted.
