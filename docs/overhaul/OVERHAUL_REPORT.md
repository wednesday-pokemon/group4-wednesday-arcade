# Overhaul report — Nevermore: Deadly Secrets (2026-10-23 → 10-24)

Requirements: `docs/overhaul/OVERHAUL_BRIEF.md` · contract: `docs/overhaul/OVERHAUL_CONTRACT.md` · UX spec + rulings:
`docs/overhaul/UX_OVERHAUL.md` · decision D-42 in `docs/DECISIONS.md` · agents/skills: `docs/AGENT_SKILL_LOG.md`.
Every claim below links to a test, a script or a screenshot. Nothing is marked done without evidence.

## 1. What changed (summary)
**Usability (Phase A)**
- Compass strip (N/E/S/W, objective marker with distance, clue areas, egg sites with %, landmarks, Hyde only when seen).
- Heading-up minimap (28 m radius): walls/rooms, clue search areas with %, egg sites with %, Hyde-risk zone tint,
  hazards once seen, tower, hiding spots, the player's noise ring. Never draws the hidden truth (source-scan test).
- TL;DR clue card: "CLUE FOUND · DOOR ACCESS LEDGER · one sentence · Meaning: …" (all 9 clues have `short` + `meaning`).
- Clue discovery: lantern outline on interactables in range, glint + shimmer sound near a known clue, E prompt, progressive
  hints (idle 40/80/120 s or V): area → direction marker → most likely spot with route + the 3D Thing pointing.
- Walking rings removed for every stance; noise shown by the meter + minimap ring + sound. Strong effects only for powers,
  moves, detection, evidence, passage, emergence.
- Controls: WASD · Shift sprint · C (Ctrl in kiosk lock) crouch · E · **Q character power** (F alias) · **R Pokémon move** ·
  Tab investigation map · V hint · Esc pause — one `KeyLegend` component everywhere. 3-step onboarding ≤ 20 s.

**Live analytics (Phase B)** — see §5 for before/after.

**Distinct cases (Phase C)** — each case has its own layout on the island footprint (extra walls/cover/hiding spots), a lever
hidden passage, 3 examinable objects (2 give egg traces), a hazard (01 broken glass + creaky boards, 02 rubble + puddles,
03 two sweeping searchlights), its own clue/egg candidate sites and Hyde emergence points, and its own look: 01 dim green
archive + greenhouse (bookshelves, vines, lab glass), 02 amber crypt + tunnels (rock falls, lanterns, cobwebs), 03 storm
watchtower (rain, lightning, alarm beacons, fences, guard huts, searchlights).

**Gameplay loop / suspense** — the Hyde emerges after ~20 s of quiet investigation from one of 3 weighted spots, patrols
visibly, investigates noises, searches nearby hiding spots / behind cover, then a calm window after a chase (no constant
attacks). Clue and egg positions are drawn per session (less repetition).

**Visual polish (Phase D)** — per-case lighting/fog/sky/weather (look.ts), props at every candidate site, hazard decals and
searchlight cones, Hyde emergence from violet mist, smaller companion that fades when it would block the view, contact
shadows. Frame budget kept (§4).

## 2. Files changed (by area; ~124 source files, ≈ +17k / −2.6k lines, plus ~35 test files)
- Sim `src/mystery/`: new `layout.ts`, `hazards.ts`, `investigation.ts`; changed `run.ts`, `hyde.ts`, `interact.ts`,
  `player.ts`, `abilities.ts`, `bot.ts`, `config.ts`, `context.ts`, `nav.ts`, `types.ts`.
- Data `src/mystery/data/`: new `caseWorlds.ts`; changed `cases.ts` (v2, TL;DR), `solutions.ts` (v2), `island.ts`,
  `tuning.ts`, `thing.ts`.
- Analytics `src/mystery/analytics/`: new `bayes.ts`, `hydeZones.ts`, `live.ts`, `liveMessages.ts`, `publicState.ts`,
  `view.ts`, `thingCodes.ts`; changed `prescriptive.ts`, `session.ts`, `telemetry.ts`, `features.ts`, `state.ts`,
  `model/mystery-model.json` (retrained); scripts `mystery-{generate,train,evaluate,zones}.ts`.
- Renderer `src/three/mystery/`: new `look.ts`, `siteProps.ts`, `interactables.ts`, `wallStyles.ts`, `hazards.ts`,
  `weather.ts`, `investigationView.ts`; changed `MysteryScene.ts`, `world.ts`, `dressing.ts`, `caseDressing.ts`,
  `terrain.ts`, `walls.ts`, `vfx.ts`, `items.ts`, `clueModels.ts`, `characters.ts`.
- App/UI: `src/app/mystery/hud/*` (compass, navFeed, oddsModel, thingStack, hintLadder, publicRun), `useMysteryLoop.ts`,
  `PlayView.tsx`, `hudModel.ts`, `input.ts`, `kiosk.ts`, `settings.ts`, `audio.ts`; `src/ui/mystery/{controls.tsx, odds.ts,
  map/*, hud/*, InvestigationMap.tsx, investigationView.ts, stationView.ts}`, `EvidenceBoard.tsx`, `DuoCards.tsx`,
  `MysteryHud.tsx`, `MysteryTutorial.tsx`, `MysteryPause.tsx`, `MysteryDashboard.tsx`, styles `mhud.css`,
  `investigation.css`, `tokens.css`, …
- Supabase: migration `20261023000100_mystery_overhaul.sql`; `_shared/mystery-events.ts`, `mystery-validation.ts`,
  `mystery-append-events/index.ts`; pgTAP `007_mystery_overhaul.test.sql`; unit `mystery-overhaul.test.ts`,
  `mystery-sim-contract.test.ts`. **Not deployed.**
- Live client: `src/lib/supabase/mysteryWire.ts`, `src/app/mystery/{liveRun.ts, liveDashboard.tsx}`.
- Docs: `docs/overhaul/*`, `MYSTERY_DESIGN.md` §10, `MYSTERY_CASES.md`, `MYSTERY_MODEL_REPORT.md` §6,
  `SUPABASE_SETUP.md` §12.7, `SECURITY.md` §7.7, `DECISIONS.md` D-42, runbooks (deployment-engineer).

## 3. Automated test results (orchestrator re-runs, final code)
| Check | Result |
|---|---|
| `npx tsc --noEmit -p tsconfig.json` | 0 errors |
| `npx vitest run` | **76 files, 1672 tests passed** |
| `npm run typecheck:functions` | clean |
| `npm run test:supabase-unit` | 88/88 |
| `npm run test:db:offline` (PGlite pgTAP) | 7 suites passed (new 007: 40/40) |
| `npm run test:db:roundtrip` | passed (150 mystery sessions, every forecast target stored once) |
| `npx vite build` | OK |
| Bot sweep, 126 duos × 3 cases (stealthy) | medians 148 / 143 / 126 s; finish 126 / 124 / 126 (2 DNF in Case 02); no softlocks |

Notable tests: layout draw frequencies ≈ priors (3000 seeds); Bayesian bucket check + 30,000-session Monte-Carlo of the
posteriors (within 4 SE); leak guard (two hidden layouts, same seed → identical forecasts/advice/hints); renderer audit
(static world byte-identical across layouts); no-F-key-cap grep; ThingStack priority/dedupe; review regressions
(`tests/unit/mystery/review.test.ts`).

## 4. Browser playtest results
- `output/overhaul-acceptance.mjs` part B (real app, autopilot through the live update path): 6/6 full runs — Case 01
  Enid+Gengar 127 s, Bianca+Froslass 196 s; Case 02 Ajax+Gholdengo 228 s (1 catch), Eugene+Chandelure 131 s; Case 03
  Morticia+Aegislash 126 s, Gomez+Dusknoir 118 s — every one `case_solved`, Hyde emerged at ~21 s, egg traces 3–4 per run,
  0 console errors. Messages seen include "Creaky floorboards raised the alarm.", "The searchlight caught you.", "Take the
  egg to Iago Tower.", "Hide in the hedge 8 m behind you.", "Not here. Odds updated.".
- Part A: all 25 abilities through the real keys — 7 powers on Q (+ F alias), 18 moves on R; 15 fired, the 10 targeted
  ones (stun/slow/distract) correctly answered "No Hyde in range" (`output/overhaul/acceptance/A-*.png`).
- `output/overhaul-controls.mjs`: home → name → 3 cards → case reveal → prologue → tutorial → play by keyboard only;
  W/Shift/C/arrows/Tab (clock stops)/1-2-3 layers/Esc/V/E all verified; 0 console errors.
- `output/overhaul-tutorial.mjs`: onboarding finishes within 20 s in real time.
- Frontend checks: `output/overhaul-hud-check.mjs` (36 screenshots, 0 problems), `output/overhaul-board-check.mjs` (Tab
  overlay + accusation, 3 cases, 1366×768 and 1920×1080), `tests/e2e/mystery-cases.mjs` (solve / weak evidence / wrong
  suspect).
- Frame rate (this machine's GPU): 59–60 fps through the real app in all cases, normal and low graphics; 2.8–3.5 ms/frame
  render, 60–72 draw calls, ~96k triangles.

Screenshots: `output/overhaul/before/` (baseline) · `output/overhaul/after/` (HUD) · `output/overhaul-board/` (Tab overlay,
accusation, cards, dashboard) · `output/overhaul/3d/` (case looks, hazards, Hyde emergence, companion) ·
`output/overhaul/acceptance/` (full runs, abilities) · `output/overhaul/controls/` (keyboard journey).

## 4b. Deployment readiness (deployment-engineer, `docs/overhaul/DEPLOY_READINESS.md`)
- Production build: 0 warnings, dist 23 MB, largest chunk 606 kB, no privileged keys in the bundle.
- Offline (all non-localhost requests blocked): home → cards → case reveal → prologue → tutorial → play → accusation →
  results `case_solved`, 0 console errors (Galarian Corsola falls back to its artwork, by design D-37).
- Two stations at once (LOCAL DEMO): 18/18 checks — independent seeds, cases (each bag dealt all three), records.
- Performance (final code incl. the second enemy, production build, Intel UHD): 60 fps cap at 1× CPU in every case (draw
  calls 37–40). Weak-laptop proxy (4× CPU throttle) after emergence: 19 / 13 / 19 fps (Case 01 / 02 / 03), up from
  12 / 13 / 14 after removing runtime shader compiles, per-frame resizes and HUD text redraws. Case 02 (crypt) at 4× is
  the weakest spot — test the real booth laptops; low graphics helps Cases 01/03 (24–26 fps).
- Verdict: **Plan D (local demo) GO with conditions; Plan L (live Supabase): backend deployed 2026-10-24, live rehearsal pending.**

## 5. The four analytics — before vs after
| | Before | After |
|---|---|---|
| Descriptive | End-of-run panel + dashboard; HUD showed HP/noise/clue pips | Live: HP, noise meter + minimap ring, objective, clue pips, egg status, Q/R cooldowns; THING'S LOG on events ("Egg picked up.", "Hyde lost you. Escapes: 1."); duo cards now show HP and grab cost |
| Diagnostic | Computed only on the results screen | Live rate-limited cause cards: HYDE ALERT (noise source + stance, hazards, sightings), POWER STATUS (ability outcome before an escape), EGG STATUS (damage cause), INVESTIGATION (never names a suspect), PATTERN (labelled correlation, "Not proof.") |
| Predictive | One number: P(detected in 15 s) (risk chip) | Hyde spawn odds before emergence (exact rule); Hyde zone filter after (HMM, fitted on training sessions: Brier 0.543 vs 0.782 occupancy baseline, top-1 55% vs 29%); egg-site posterior (exact Bayes over traces + searched spots: top-1 83%, Brier 0.231 vs 0.627 prior); clue-area probabilities (exact Bayes); detection (retrained, Brier 0.0868 / AUC 0.853 vs base 0.1175); extraction (Brier 0.0814 vs 0.0913). Every number carries "ML estimate" / "Bayesian estimate" / "Rule-based estimate"; shown in the Odds panel, minimap, compass, Tab map |
| Prescriptive | V/context advice on exact clue/egg positions (it read the hidden truth) | One feasible action from public information only (posteriors, zone risk, noise, HP, cooldowns by effect kind, carried egg), ≤ 52 chars + why; compass/minimap target; progressive hints; never suggests used-up abilities, collected clues or Hyde-targeted moves before emergence |
All metrics are on held-out SIMULATED sessions (bots ≠ people) — `docs/MYSTERY_MODEL_REPORT.md` §6.

## 6. Known limitations (honest)
- **Supabase DEPLOYED 2026-10-24** by the owner (all 6 mystery migrations + 5 mystery functions + admin-reset; verified:
  migration list 10/10, functions ACTIVE, anon calls rejected 401). Not yet done: a live station rehearsal (needs the station
  logins) — until then Plan L is unrehearsed; Plan D (local demo) remains the fallback.
- **Human pacing unverified**: bots finish in 2–4 min of active play; first-time students are expected at ~5–7 min including
  menus — please run a few real playtests.
- **Real booth laptops not measured**: 60 fps here; Intel UHD measured only by proxy (see deployment readiness).
- The detection model uses the true Hyde distance as a feature (as before), so the risk chip can rise before the Hyde is
  visible ("danger sense").
- The Hyde's walk between search spots can still pass close to a hiding spot (the stops cannot).
- Hint level 3 points at the most probable spot, which can be wrong (by design, honest).
- Not built: compact duo card in Pause; Odds re-sort / step-1 area pulse animations; old `output/mystery-app-check.mjs` is
  stale (predates the case reveal) — use the new scripts.
- Layout can be derived from the seed with devtools (accepted Low risk; score/verdict are recomputed server-side).
