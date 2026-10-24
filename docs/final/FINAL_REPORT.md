# Final wave report — Nevermore: Deadly Secrets (2026-10-24/25)

Requirements `docs/final/FINAL_BRIEF.md` · contract `docs/final/FINAL_CONTRACT.md` · UX `docs/final/UX_FINAL.md` ·
agents/skills `docs/AGENT_SKILL_LOG.md` (section "Final improvement wave"). Every claim below has a test, script or
screenshot behind it.

## 1. What was implemented
| Brief § | Result | Evidence |
|---|---|---|
| 2 Characters | Culprits Thornhill (01) · **Françoise Galpin** (02, visiting historian; new method / opportunity / broken-alibi clues) · Barry Dort (03); Isaac Night removed as a suspect everywhere (data, solutions, prologue, server enum/CHECK superset); case + solution versions 3 | data tests; server pgTAP 009; results "What really happened" |
| 3 Slurp | Isaac Night's zombie form: wander/investigate/search/chase/telegraphed lunge/leave; sight + proximity + loud noise; escapable by hiding, LOS, abilities (all effect kinds reach all three monsters); orchid look, lurching rig | tests/unit/mystery/slurp*; output/final/3d/slurp-* |
| 4 Encounter director | Hyde / Crackstone / Slurp spawn, despawn, respawn; eligible = ≥ minSpawnM, out of view; exact weighted draw (`encounterSpawnDistribution`, shown 1:1 by analytics); ≤ 2 active, ≤ 1 engaged; hysteresis + cooldowns; never resets HP/catches/cooldowns | director tests + bot sweep; playtest: every run had real spawns AND despawns, max 2 active, max 1 engaged |
| 5 Cabinets | 5–6 per case; E Hide → E Close Door → E Exit (WASD exits when open); closed = invisible; witnessed / creak → pulled out (counts as a hit); solid; exit to walkable cells; 3 themed animated models + slat hiding camera + HUD overlay | cabinet tests; output/final/hud/*-12..15*, output/final/3d/cabinet-* |
| 6 Death cutscenes | Hyde lunge 3.2 s · Crackstone curse 4.0 s · Slurp grab 3.6 s, letterbox + Skip, then game-over card "Defeated by …" with WHY + tally → results; once, skippable, reduced-motion variant, no gore | finalHud tests; output/final/hud/*-16/17*, output/final/3d/death-* |
| 7 Smaller maps | Per-case play areas ≈ 64 × 55–69 m (was 90 × 120) with fenced/treeline edges, new starts, routes, levers, cabinets, zones | caseIslands tests (reachability for every site); bot medians 150 / 142 / 114 s |
| 8 Scoring v4 | 1000 delivery + 300 culprit + 100/clue + 150 no detections + 150 no hints + max(0, 300 − t) − 50/hint − 75/hit, clamp ≥ 0; DNF unranked; Thing advice and powers never penalised; server recomputes from rule events; rules `mystery-v4` (old scores never mix) | scoringV4 + server unit (5,000-input oracle) + pgTAP CHECK recomputing the breakdown; playtest 2081 = 1000+300+300+150+150+181 |
| 9 Home leaderboard | "Top Detectives" top-5 on the right (LIVE/LOCAL/Reconnecting), #1 highlight, live-update motion, empty state, full-leaderboard modal (Top scores / Defeat log); no overlap at 1366×768 or 1920×1080 | output/final/home/* (checklist 19–21) |
| 10 Analytics in play | Descriptive (Tally Seen/Hits/Hints, HP, noise, cooldowns, egg, objective), Diagnostic (WHY cards: "Crackstone spotted you.", "Slurp heard the cabinet door."…), Predictive (one-line "Danger soon" odds per monster + "Next: {area}" from the director, minimap danger lens on X, egg/clue Bayes, Hyde zone filter refit), Prescriptive (Thing, free) — every number honestly labelled; AnalyticsLegend | output/final/hud/*; MYSTERY_MODEL_REPORT §11 |
| 11 Weems | "Ask Weems" (V / button, −50, first-use note, cooldown, never while hunted, ladder L1→L2→L3 per objective step, L1 ≠ L2 ≠ L3, never names the culprit); Thing = free advice with a "free" chip | weems + finalHud tests; screenshots 10–11 |
| 12 Less clutter | One Threats strip (3 chips) instead of two pills; Odds one line per monster; zone lists moved to the map lens / Tab; short copy | UX_FINAL; screenshots |
| 13 Preserve | Home, Thing logo + prologue, 7 characters, 18 Pokémon, 3-card draft + slot reveal, case shuffle, trading cards, evidence + accusation, egg to Iago Tower, Supabase, dashboard | browser runs + suites |

## 2. Test results (orchestrator, final code)
- `npx tsc --noEmit -p tsconfig.json`: 0 errors.
- `npx vitest run`: 95 files, 1926 passed + 2 integration timeouts under machine load → `tests/integration/mysteryStation.test.ts` re-run alone 24/24. After the review fixes: mystery 925 + app/analytics 450 pass.
- Backend: typecheck:functions 0; supabase-unit 131/131; pgTAP 001–009 all pass; round trip 33,677 assertions; real-sim contract 48 episodes server = browser.
- Bot sweep (126 duos × 3 cases): finished 123 / 124 / 123, medians 150 / 142 / 114 s, no softlocks.
- Browser (`output/final-playtest.mjs`): 9 full runs, 8 case_solved (1781–2081 points), 1 DNF by the Hyde → death sequence → defeat results; 0 console errors.
- Reviews: code-review (8 findings → 3 fixed, rest documented below); earlier security review clean.

## 3. Performance (production build, Intel UHD, 1366×768)
1× CPU: 53–60 fps in all cases, normal and low graphics. 4× CPU throttle after the monsters appear: Case 01 23/33,
Case 02 15/17, Case 03 22/29 fps (normal/low). Case 02 is the weakest on a slow CPU; the debugger's cache fix did not
change it and the profile shows no single hotspot (47 % native). Test the real booth laptops; use Low graphics on weak
machines.

## 4. Known limitations
- **Supabase v4 not deployed** (owner): until then LIVE mode would be rejected; LOCAL DEMO works fully. Deploy order in
  `docs/SUPABASE_SETUP.md` §12.9 (reset stations → `db push` (only 20261025000100) → all mystery functions in one
  command → hard-reload laptops). After the deploy, move `slurp_risk` / `enemy_spawn` from LOCAL_ONLY to the upload list.
- Human pacing unmeasured (bots 105–150 s median active play; target 2–3 min humans, 5–7 min incl. menus).
- Case 02 at 4× CPU ≈ 15 fps (see §3).
- Not fixed from the review (low risk): server v3.1 HP accounting misses Crackstone cabinet pull-outs (unreachable after
  the deploy), duplicate weighted-draw helper in run.ts, hard-coded 5 s no-rechase window and 12 m Slurp release distance.
- Weems' portrait is an SVG bust (no licensed art); Slurp is an original low-poly interpretation (no reference asset).
- `output/mystery-app-check.mjs` is stale (old tagline/flow) — use `output/final-playtest.mjs`, `output/final-hud-check.mjs`,
  `output/final-home-check.mjs`.
