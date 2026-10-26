# Final contract (2026-10-24) — Galpin, Slurp, encounter director, cabinets, death cutscenes, compact maps, v4 scoring, Weems

Requirements: `docs/final/FINAL_BRIEF.md` (binding). Builds on `docs/overhaul/OVERHAUL_CONTRACT.md`,
`docs/overhaul/ENEMY_CONTRACT.md` (Crackstone), `docs/overhaul/UX_OVERHAUL.md` (HUD) and `docs/overhaul/UX_ENEMIES.md`.
UX spec for this wave: `docs/final/UX_FINAL.md` (when saved). Types: `src/mystery/types.ts` — orchestrator-owned (the
final additions are already in; ask for changes). Event Oct 27 2026: keep tsc + vitest green at the end of your work;
errors in OTHER agents' files mid-flight are expected.

## Ownership (exclusive — ask the orchestrator before touching anything else)
| Owner | Files |
|---|---|
| orchestrator | `src/mystery/types.ts`, `docs/final/**`, `docs/AGENT_SKILL_LOG.md`, `output/*.mjs` |
| game-designer | `src/mystery/data/**`, `docs/MYSTERY_DESIGN.md`, `docs/MYSTERY_CASES.md` |
| game-developer | `src/mystery/**` except `data/`, `types.ts`, `analytics/` (incl. `scoring.ts`, `prf.ts`, new `director.ts`, `slurp.ts`, `cabinet.ts`); `tests/unit/mystery/**` |
| 3d-artist | `src/three/mystery/**`, `tools/mystery-preview*` |
| backend-architect | `supabase/**`, `scripts/sync-shared.mjs`, `docs/SUPABASE_SETUP.md`, `docs/SECURITY.md` |
| fullstack-developer | `src/mystery/analytics/**`, `scripts/mystery-*.ts`, `src/lib/supabase/**`, `src/app/mystery/live*.ts(x)`, `tests/unit/mystery-analytics/**`, `tests/integration/**`, `docs/MYSTERY_MODEL_REPORT.md` |
| frontend A (play) | `src/app/**` except `live*` and `MysteryApp.tsx` / `MysteryDashboardApp.tsx`; `src/ui/mystery/**` except frontend B's files; `src/ui/styles/{mhud,hud,tokens,mystery}.css`; `tests/e2e/**`; `tests/unit/mystery-app/**` except `finalB_*` |
| frontend B (home/results/board) | `src/app/mystery/MysteryApp.tsx`, `src/app/mystery/MysteryDashboardApp.tsx`, `src/ui/screens/Splash.tsx`, `src/ui/mystery/{MysteryResults,MysteryDashboard,LayerPanels,stationView}.tsx/ts`, new `src/ui/mystery/leaderboard/**`, `src/ui/styles/{screens,dashboard}.css` + new `leaderboard.css`, `tests/unit/mystery-app/finalB_*` |

## 1. Rules version + scoring (mystery-v4)
- `MYSTERY_RULES_VERSION = 'mystery-v4'` (types). v3.1 rows stay readable; leaderboards never mix versions. Keep the PRF
  salt literal used today (do not derive it from the rules version) unless you update every seeded test.
- Score (finishers = egg delivered + accusation step done; computed in shared `src/mystery/scoring.ts` `scoreV4(parts)`,
  used by client AND server): delivery 1000 + accusation 300 (correct culprit) + clues 100 × min(cluesFound, 3) +
  noDetection 150 (detections = 0) + noHints 150 (hintsUsed = 0) + timeBonus max(0, 300 − floor(activeTimeS)) −
  50 × hintsUsed − 75 × hits; total = max(0, …). `RunResult.scoreBreakdown` carries every part. DNF → score null,
  separate defeat log, never ranked above a finisher. activeTimeS = sim active time (pauses, loading, prologue, tutorial
  and overlays excluded — as today).
- Counted from RULE events only: hintsUsed = `hint_requested` events (explicit Ask-Weems presses — Thing's advice, idle
  nudges, tutorial and accessibility help are never `hint_requested`); detections = `enemy_detected` events; hits =
  `enemy_hit` events (Hyde grab, curse hit, Slurp attack; blocked hits count). Server recomputes all of it.

## 2. Case changes (game-designer)
Culprits: 01 Marilyn Thornhill · 02 **Françoise Galpin** (`SuspectId` 'galpin') · 03 Barry Dort. Victim Orloff.
Suspects per case = Thornhill, Galpin, Barry (Isaac Night is NOT a suspect; he is the Slurp monster). Rewrite Case 02's
three clues (method / opportunity / broken alibi against Françoise; each innocent cleared by exactly one clue; no leftover
Isaac evidence), statements, notes, prologue lines, Thing/Weems lines. Case versions → 3, solutions → 3.

## 3. Compact maps (game-designer data; game-developer map building)
Each case gets `CaseWorldDef.playArea` (bounds ≈ 55–70 m per side, enclosing Iago Tower at (8, −51.5) and the case's
landmarks), a new `playerStart` near the area's edge (no long pier walk), boundary walls in `extraWalls`, a Hyde patrol
loop inside, release points, practice point; every candidate clue / egg site, spawn, cabinet, examine, lever, hazard and
the Crackstone / Slurp haunts inside it; zones re-tiled to the play area. Target: bot investigation ≈ 90–150 s; humans
2–3 min. Multiple escape routes; well-placed cabinets (≥ 4 per case). Not so small that monsters corner the player.
`caseMap()` builds the per-case map from playArea when present (nav, minimap and renderer follow `map.bounds`).

## 4. Encounter director (game-developer: `src/mystery/director.ts`)
- Manages Hyde, Crackstone and Slurp lifecycles: inactive → spawned → active → despawned → cooldown → respawn.
- Spawn choice (exact, seeded Rng stream 'director'): eligible spawns of that enemy = distance from player ≥
  `director.minSpawnM` AND not visible to the player (no LOS within `sight.playerSeesHydeM`, and outside the player's
  ±60° forward cone within 35 m); weight w′ = w × (1.5 if the spawn's zone contains the active objective's area, else 1)
  × (0.3 if used in the last `director.recentSpawnS`); P = w′ / Σw′ (none eligible → wait 2 s, never force). Export the
  pure function `encounterSpawnDistribution(world, enemy, state)` — analytics shows exactly this.
- Schedule: first appearance per enemy (designer tuning, e.g. Hyde ~20 s, Crackstone ~35 s, Slurp ~50 s), then
  respawn after `respawnCooldownS[enemy]` once despawned. Caps: ≤ `director.maxActive` (2) active hostiles; ≤ 1 ENGAGED
  (CHASE / ATTACK) at a time — others defer (generalises Crackstone rule R6).
- Despawn only when not engaged/investigating the player, ≥ `director.despawnM` from the player, no LOS to the player for
  ≥ 4 s, and active ≥ `director.minActiveS` (or its patrol/wander cycle done, or right after a resolved encounter).
  Hysteresis: never despawn within 10 s of spawning; never respawn the same enemy within its cooldown. Despawn never
  resets HP, catches, ability cooldowns or the event log; stun/slow timers on that enemy are dropped.
- Events: `enemy_spawned`, `enemy_despawned`, `enemy_detected` (whenever an enemy starts hunting: Hyde → CHASE, Crackstone
  → CHASE/scan hit, Slurp → CHASE, or witnessed cabinet entry), `enemy_hit`.

## 5. Slurp (game-developer sim, 3d-artist look)
Isaac Night's zombie form, unpredictable stalker: WANDER between seeded random waypoints of `SlurpDef.wander` with
lurching pauses; detects by sight (cone ~90°, range ~10 m clear / 7 m fog) and proximity (~3 m); hears only LOUD noises
(≥ 0.8: sprint, egg drop, loud cabinet slam) → INVESTIGATE; SEARCH nearby spots (reuse enemyNav helpers) → LEAVE (walk off
and despawn); CHASE slower than sprint, faster than walk; ATTACK = telegraphed lunge (windup ~0.6 s) → `enemy_hit`
(HP ~30 × catchDamageMult), knock-back to a nearby free spot, invulnerability, then LEAVE. Escapable by hiding (crouch spots
or cabinets), breaking LOS, abilities (stun/slow/lure/distract through the existing `EnemyHandle` list). Uses
`slurp_mode` events. Not graphic.

## 6. Hiding cabinets (game-developer sim, 3d-artist animation, frontend prompts)
`HidingSpotDef.kind === 'cabinet'` with `doorYaw`. E within `cabinet.useM` of the door: **Hide** (enter, ~0.5 s, phase
entering → open, noise `cabinet.enterNoise`); inside & open: **E — Close Door** (~0.4 s → closed); inside & closed: **E —
Exit** (door opens, step out, ~0.6 s); WASD while open also exits. While inside: no movement; open = hidden like a crouch spot
(reveal radius); closed = invisible to sight and proximity for every enemy. Loud: `cabinet` event `loud` true when an
action's noise reaches an enemy (they investigate the sound like any noise). Witness: an enemy that could see the player
when they entered or closed the door remembers that cabinet → walks to it → `pulled_out` (counts as that enemy's hit).
No permanent invulnerability: after `cabinet.creakAfterS` inside, the door creaks (small noise every few s). Exit point =
door front, else sides/back — always a walkable cell (nav check). `PlayerState.cabinet` holds the state; snapshot
`inCabinet`.

## 7. Death cutscenes (game-developer event, 3d-artist scene, frontend A overlay)
`dnf.by` + `RunResult.defeatedBy` name the enemy. On DNF: player control off → 3d-artist `scene.playDeath(enemy)` (Hyde
sudden lunge toward camera; Crackstone cursed sigil + supernatural fade; Slurp lurching grab + close-up) 3–5 s, sound,
fade to a game-over card "Defeated by Slurp" → results. Triggers once; Skip (Enter / Esc / click) jumps to the card; the
recorded outcome is already fixed (skip changes nothing). Reduced motion: a short fade version. No gore.

## 8. Weems vs Thing (fullstack content, frontend A UI)
**Principal Weems** (ghostly portrait, distinct colour) = OPTIONAL hints only, on "Ask Weems" (V or a button), each press
→ `hint_requested {level}` (sim keeps the cooldown), −50 each: L1 general search area · L2 specific location or evidence
relationship · L3 stronger deduction guidance (never the culprit's name, never "X did it"). **Thing** = mascot/logo,
prologue, FREE prescriptive advice ("Hide. The Hyde is approaching." "Close the cabinet." "Search the eastern corridor."
"Use your Pokémon's defensive move." "Take the safer path.") rate-limited, plus status reactions. The idle hint ladder
becomes Thing's free nudges (never logged as `hint_requested`).

## 9. Analytics (fullstack)
Descriptive (HP, abilities + cooldowns, evidence, noise, objective, hints used, egg; duo cards show HP/strengths/weak
spots), Diagnostic (event causes: "Hyde detected your footsteps." "Crackstone spotted you." "Slurp heard the cabinet door."
"Your Pokémon blocked the attack."), Predictive (monster encounter probability by area per enemy: inactive → director's
exact spawn distribution; active Hyde → zone filter (refit or labelled rule estimate), Crackstone sight-risk cells, Slurp
rule-based encounter risk; egg posterior; Hyde detection risk from noise) and Prescriptive (Thing). Every number honest-
labelled; never the culprit or the hidden layout. Retrain detection/extraction on mystery-v4 sim episodes after the sim
lands.

## 10. Leaderboards (backend + fullstack + frontend B)
Server: mystery-v4 sessions, `enemy_detected` / `enemy_hit` / `hint_requested{level}` / `cabinet` / director / Slurp
events accepted; `computeResult` v4 = `scoreV4` from validated progress (delivery, accusation correctness from the
server's answer key, clue count, hint count, detections, hits, active time); suspect enum + DB CHECK include 'galpin'
(keep 'isaac' readable for old rows); results gain breakdown + defeated_by (additive); v4 leaderboard / defeated /
standings views (v3.1 rows never mixed). Home page (frontend B): top-5 verified panel on the right (Realtime in LIVE,
local records in LOCAL DEMO), highlight #1, "View Full Leaderboard", empty state, fits 1366×768 without touching the logo,
title or Start button.
