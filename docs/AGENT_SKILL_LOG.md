# Agent & Skill Audit Log

Real audit trail of skills loaded and agents invoked through Claude Code's Skill/Agent tools. Rows are only marked
**INVOKED** when the tool call actually ran; outcomes are recorded from each agent's own final report plus orchestrator verification.

## Skills

| Phase | Skill | Status | Actionable lesson applied | Evidence (files/tests) |
|---|---|---|---|---|
| 0 | using-superpowers | INVOKED | Check/load skills before each phase; announce skill use; phase plan before code | This log; docs/PROGRESS.md |
| 1 | game-development | INVOKED | State machine for leg phases; separate input → update → render; profile-first perf | src/game/types.ts (SessionPhase), RULES_SPEC state machine |
| 1 | develop-web-game | INVOKED | Expose `window.render_game_to_text` + `window.advanceTime(ms)`; Playwright screenshot loop; progress notes | src/app (hooks), tests/e2e |
| 1 | clean-code | INVOKED | Small pure functions, named constants, no magic numbers (all rule numbers in constants.ts). Note: its "ask before fixing" rule is overridden by the master prompt's autonomous mandate. | src/game/constants.ts; replaced literal `5` egg delay with `EGG_COLLECT_DELAY_S` in src/analytics/* |
| 3 | senior-fullstack | INVOKED | One shared typed contract for local + live adapters; validate every input at the boundary | src/game/types.ts (SessionView/GameBackend contract), src/game/validation.ts |
| 2 | frontend-design | INVOKED | Plan tokens before code; one bold element (lantern amber) and quiet everything else; avoid templated tells (all-caps eyebrows, mono data labels, → buttons) | docs/THEME.md, src/ui/styles |
| 2 | theme-factory | INVOKED | No preset fit the brief → custom theme "Nevermore Lantern" derived from Midnight Galaxy (prompt forbids waiting for a choice) | docs/THEME.md |
| 2 | ui-design-system | INVOKED | Token-first system (color/type/spacing 8-pt grid/radii/motion), documented for handoff | src/ui/styles/tokens.css, docs/UX_SPEC.md |
| 2 | ui-ux-pro-max | INVOKED (ran `search.py --design-system` and `--domain ux`) | Kept: dark-mode style, visible focus, SVG not emoji icons, reduced-motion, tab order = visual order. Rejected its generic palette/fonts (Fira, blue/orange) as off-brief | docs/THEME.md, UX review |
| 2 | senior-frontend | INVOKED | Clear component boundaries (screens vs HUD vs scene adapter), state in one store, adapters behind an interface | src/app, src/ui |
| 2 | 3d-web-experience | INVOKED | Vanilla Three.js (max control, non-R3F), loading state + WebGL fallback, low-end quality mode | src/three, brief to 3d-artist |
| 3 | (orchestrator) analytics | DONE · TESTED · TRAINED (MAE 3.30 s vs 5.51 baseline — target <2.5 NOT met; Brier 0.1035 vs 0.1496 — target met) | Counterfactual engine probes with fixed draws → leak-free features; OLS/IRLS in TS shared by trainer + kiosk; MC advisor with CRN rounds under a time budget | src/analytics/*, scripts/*.ts |

## Agents

| Phase | Agent | Status | Exact delegated task | Files owned | Tests run (per agent report, verified by orchestrator) | Integration status | Blockers |
|---|---|---|---|---|---|---|---|
| 1 | game-developer | INVOKED · COMPLETED | Implement rules/session/scoring/simulation/validation per RULES_SPEC + 216-pairing tests; then applied orchestrator rulings D-13..D-16 and encoded designer EC-01..EC-30 | src/game/{rules,session,scoring,simulation,validation,abilities,index}.ts, tests/unit/game/** (8 files) | Agent: 591 tests pass. Orchestrator re-ran: 605/605 (incl. analytics) | Integrated (used by analytics, local backend, synthetic data) | — |
| 1 | game-designer | INVOKED · COMPLETED | Edge-case audit (30 hand-computed cases), 13 findings incl. 2 ambiguities (F-1 second-catch penalties, F-2 Morticia), balance read, pacing, player copy | docs/DESIGN_REVIEW.md, src/game/copy.ts | EC-01..EC-30 encoded by game-developer: all pass | Rulings D-13..D-18 issued; copy consumed by UI | — |
| 2 | 3d-artist | INVOKED · COMPLETED | Low-poly lake/island/boat/Hyde scene + cinematic API `RaceScene` (3 leg sets, weather, egg/crash/shield/catch/dock/DNF beats, reduced-motion + low-graphics) | src/three/** (11 files), tools/three-preview.* | Agent: tsc clean, Playwright SwiftShader screenshots, 21–31 draw calls. Orchestrator viewed 2 screenshots; fixed null-draws crash | Consumed by frontend | Real-GPU FPS unmeasured |
| 2 | ui-ux-designer | INVOKED · COMPLETED | Tokens, wireframes, components, keyboard flow, review checklist (read-only agent → 990-line spec returned) | docs/UX_SPEC.md (saved verbatim + font override note) | n/a | Handed to frontend-developer | Font choice overridden to theme (Cinzel/Alegreya Sans) |
| 4 | backend-architect | INVOKED · COMPLETED | Migrations, RLS, atomic commit RPC, 6 Edge Functions, pgTAP + PGlite offline harness, threat model; found RNG predictability flaw | supabase/** , docs/SUPABASE_SETUP.md, docs/SECURITY.md | Orchestrator re-ran after RNG change: pgTAP all suites PASS (PGlite), round trip 31,353 assertions PASS, 17 unit PASS, functions typecheck PASS | Contract → docs/CLIENT_CONTRACT.md → fullstack-developer | No Docker/credentials → hosted Supabase not executed |
| — | unity-game-developer | NOT INVOKED (by design) | Unity outside approved Three.js stack | — | — | — | — |
| — | unreal-engine-developer | NOT INVOKED (by design) | Unreal outside approved Three.js stack | — | — | — | — |

| 1 | code-reviewer (skill) | INVOKED | Bundled checker is a stub (0 findings for anything) → manual Gate 1 review | docs/CODE_REVIEW.md Gate 1 |
| 2 | frontend-developer | INVOKED · COMPLETED (v2.5; see v3 rows for later work) | All visitor screens, HUD, cinematic integration, dashboard, operator panel, audio, keyboard, test hooks, e2e smoke | index.html, src/main.tsx, src/app/**, src/ui/**, public/**, tests/e2e/** | pending | pending | — |
| 4 | senior-backend (skill) | INVOKED | Validate inputs, least-privilege grants, idempotent writes, lock ordering → used as Gate 4 review checklist | docs/CODE_REVIEW.md Gate 4 |
| 4–5 | fullstack-developer | INVOKED · COMPLETED | Live Supabase adapter (auth gate, functions client w/ retry+same actionId, realtime dashboard dedupe/reconnect, station reset watch, operator console) + integration tests w/ fake server running the real engine + real server validation/redaction modules | src/lib/supabase/** (9 files), tests/integration/** (7 files) | Agent: 92/92 integration incl. A03 isolation, mutation-checked. Orchestrator re-ran: full suite 700/700; no service_role in src/dist | 3 change requests forwarded to frontend-developer | Hosted Supabase not exercised (backend not yet deployed to user's project) |

## v3.0-realtime overhaul

| Phase | Agent / skill | Status | Task | Files | Tests | Notes |
|---|---|---|---|---|---|---|
| v3-0 | using-superpowers, game-development, develop-web-game, 3d-web-experience, clean-code, senior-frontend (already loaded this session) | APPLIED | Fixed-step loop + input abstraction (game-development); render_game_to_text/advanceTime + Playwright screenshot loop (develop-web-game); chase camera/perf budget (3d-web-experience) | src/action/**, src/app/action/** | — | Skills were loaded earlier in this session; re-applied, not re-invoked |
| v3-1 | game-designer | INVOKED · COMPLETED | Full v3 GDD (705 lines): 12 stat sets (budget 30), 18 abilities w/ cooldowns/charges/rescue effects, stage maps, Hyde AI (wake-following, rubber band, telegraphed surges), egg hunt (6 spots, 3 difficulty classes), egg security, pacing 4.6/5.7/6.9 min, 20 advice lines; raised 7 design concerns | docs/GDD_V3_REALTIME.md, src/action/data/{characters,pokemon,stages}.ts | Agent had no shell; orchestrator ran tsc → exit 0 | Feeds Phases 2–5; rowing numbers differ from tested Phase 1 values (kept Phase 1 values pending user feedback) | — |
| v3-1 | (orchestrator) | DONE | Phase 1 rowing engine, scene, HUD, tests, browser playtests, two physics bug fixes | see PROGRESS.md | 21 action + 721 total pass | Implemented directly for speed so the user can test Phase 1 quickly; specialist agents scheduled for Phases 2–6 |
| v3-1c | game-designer | INVOKED · SUPERSEDED (session ended; re-dispatched below) | Open haunted-lake Stage 1 layout: land polygons, 3+ routes, landmarks, encounters, Hyde spawn | src/action/data/lake.ts, docs/STAGE1_LAKE.md | pending | Phase 1 correction |
| v3-1c | game-developer | INVOKED · COMPLETED (2 rounds) | Tests for stats, 18 abilities, Hyde AI, rescue, encounters, land, determinism, autopilot end-to-end; then D-32 Hyde retune | src/action/** (not data/types), tests/unit/action/**; hyde.stage1 in data/stages.ts for D-32 | 191+ new tests; suite green; 216 pairs finish safe route with 0 catches | Fixed shore grinding (slide assist), added lastRescue, lunge-can-miss, surge hold, ground-speed pacing |
| v3-1c | 3d-artist | INVOKED · COMPLETED | Compose ActionScene from actionWorld/hydeRig/abilityFx/land/landmarks over RenderableRun; fix tsc; preview tool + SwiftShader screenshots | src/three/**, tools/three-action-preview.* | tsc 0; 50 screenshots in output/three-action (Hyde onScreen in every chase/surge/rescue shot); 44–66 draw calls, ~295k tris (low ~78k) | Orchestrator viewed chase/fork/aerial shots |
| v3-1c | frontend-developer | INVOKED · COMPLETED | Fix stale e2e smoke (legacy at /?legacy=1), new tests/e2e/v3-stage1.mjs, HUD audit vs UX_V3_ACTION | src/app/**, src/ui/**, tests/e2e/** | tsc 0; vitest 941; build OK; smoke PASS; v3-stage1 PASS (A full run, B+C rerun after SwiftShader timeout) | Fixed tutorial freeze + rescue-step cap; stamina trend/over-pace hint; 15/15 UX checklist pass |
| v3-1c | ui-ux-designer | INVOKED · COMPLETED | Action HUD / danger language / rescue prompt / selection cards / tutorial spec + 15-point audit checklist | docs/UX_V3_ACTION.md (saved by orchestrator, font override) | n/a | Forwarded to frontend-developer mid-build |

### v3-1c continuation (new session, 2026-10-21)
State found: `src/action/data/lake.ts` + `docs/STAGE1_LAKE.md` never written (corridor fallback still active);
`src/three/action/ActionScene.ts` still the Phase 1 renderer (new world/Hyde/ability modules never composed; 8 tsc errors);
no tests for Hyde/abilities/rescue/encounters/land/run. Frontend v3 journey present.

| Phase | Agent / skill | Status | Task | Files | Tests | Notes |
|---|---|---|---|---|---|---|
| v3-1c | game-designer | INVOKED · COMPLETED | Write the open haunted lake `buildLakeCourse()` + design doc | src/action/data/lake.ts, docs/STAGE1_LAKE.md | Orchestrator: tsc clean for lake.ts; tests/unit/lake 16/16 PASS (BFS at 8 drift phases + 3 route bands) | 520 u straight; routes Western Bay ~690 u (safe), Reef Run ~527 u, Gallows Narrows ~655 u; 66 obstacles, 11 land polygons, 9 landmarks |
| v3-1c | 3d-artist | INVOKED · COMPLETED | Compose ActionScene from actionWorld/hydeRig/abilityFx/land/landmarks over RenderableRun; fix tsc; preview tool + SwiftShader screenshots | src/three/**, tools/three-action-preview.* | tsc 0; 50 screenshots output/three-action (Hyde onScreen in every chase/surge/rescue shot); 44–66 draw calls, ~295k tris (low ~78k) | Orchestrator viewed chase/fork/aerial shots; not yet tested through the React stage loop |
| v3-1c | game-developer | INVOKED · COMPLETED (2 rounds) | Unit tests for stats, 18 abilities, Hyde AI, rescue, encounters, land, determinism, autopilot end-to-end; then D-32 Hyde retune | src/action/** (not data/types), tests/unit/action/**; + hyde.stage1 in data/stages.ts for D-32 | 191 new tests; full suite green; 216 pairs finish safe route 0 catches | Fixed shore-grinding (land slide assist), added lastRescue; lunge-can-miss, surge hold, ground-speed pacing |
| v3-1c | (orchestrator) | DONE | Lake navigability test: structure, landmarks/encounters/≥3 distinct routes, lantern lines clear, grid BFS start→dock at 8 drift phases + per-route band | tests/unit/lake/lakeNavigability.test.ts | runs once lake.ts exists | |
| v3-1c | frontend-developer | INVOKED · COMPLETED | Fix stale e2e smoke (legacy at /?legacy=1), new tests/e2e/v3-stage1.mjs, HUD audit vs UX_V3_ACTION | src/app/**, src/ui/**, tests/e2e/** | tsc 0; vitest 941; build OK; smoke PASS; v3-stage1 PASS (A full run, B+C rerun after SwiftShader timeout) | Fixed tutorial freeze + rescue-step cap; stamina trend/over-pace hint; 15/15 UX checklist pass |
| v3-1c | 3d-artist (round 2) | INVOKED · STALLED (watchdog after 600 s) | Camera fix: never inside/behind the Hyde; boat primary subject; Hyde over the shoulder; rescue framing | src/three/action/{ActionScene,hydeRig}.ts | Orchestrator verified the final code: tsc 0, vitest green, real-UI playtests Hyde on screen 93–97 % while hunting, lunge/surge/rescue frames correct | Agent's last edit (12:04) postdated its own screenshots; verified by orchestrator instead of re-dispatching |
| v3-1c | (orchestrator) | DONE | Real-time playtest harness through the real UI (output/orchestrator-playtest.mjs), portrait check (output/art-check.mjs), D-32/D-33/D-34 rulings, art wiring | docs/*, public/art/*, output/*.mjs | see PROGRESS.md | |
