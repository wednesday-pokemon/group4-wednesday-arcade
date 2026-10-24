# Overhaul contract (2026-10-23) — "Easy to learn. Fun to play. Exciting. Analytics that help."

Requirements: `docs/overhaul/OVERHAUL_BRIEF.md` (owner's brief, binding). UX spec: `docs/overhaul/UX_OVERHAUL.md` (when
saved). Previous contract `docs/MYSTERY_CONTRACT.md` still applies unless changed here. Shared types:
`src/mystery/types.ts` (orchestrator-owned; ask for changes, don't edit). Event: **Oct 27 2026** — keep every change
shippable; tsc + vitest green at the end of your work.

## Ownership (exclusive — do not edit files outside your row; ask the orchestrator)

| Owner | Files |
|---|---|
| orchestrator | `src/mystery/types.ts`, `docs/overhaul/**`, `docs/AGENT_SKILL_LOG.md`, `docs/IMPLEMENTATION_PROGRESS.md`, `docs/PLAYTEST_RESULTS.md`, `output/*.mjs` |
| game-designer | `src/mystery/data/**` (cases, caseWorlds, island, tuning, thing, solutions; roster text only), `docs/MYSTERY_DESIGN.md`, `docs/MYSTERY_CASES.md` |
| game-developer | `src/mystery/**` except `data/`, `types.ts`, `analytics/`; `tests/unit/mystery/**` |
| fullstack-developer | `src/mystery/analytics/**`, `scripts/mystery-*.ts`, `tests/unit/mystery-analytics/**`, `docs/MYSTERY_MODEL_REPORT.md`, `src/lib/supabase/**`, `src/app/mystery/live*.ts(x)`, `tests/integration/mystery*` |
| 3d-artist | `src/three/mystery/**`, `tools/mystery-preview.*` |
| frontend-developer | `src/app/**` (except `src/app/mystery/live*`), `src/ui/**`, `index.html`, `public/**`, `tests/e2e/**`, `tests/unit/mystery-app/**` |
| backend-architect | `supabase/**`, `scripts/sync-shared.mjs`, `docs/SUPABASE_SETUP.md`, `docs/SECURITY.md` |

Rules version stays `mystery-v3.1` (nothing has been played on the server; the mystery backend is NOT deployed). Case
content versions bump to **2** (`CaseDef.version` and `CaseSolution.version` together). Ability SLOT ids stay `'F'`
(character power) and `'Q'` (Pokémon move) in data, events and the server; only the physical keys change (below).

## What changed in `types.ts` (already in place)
- `CaseDef.placements` and the egg coordinates are gone; `CaseDef.egg = { objective }`. Positions now come from
  `CaseWorldDef` (`src/mystery/data/caseWorlds.ts`, a stub until the designer lands the real data) and
  `MapDef.world`.
- New: `AreaDef`, `SiteDef`, `ClueSiteGroup`, `EggSiteDef`, `HydeSpawnDef`, `ZoneDef`, `ExamineDef`, `PassageDef`,
  `HazardDef`, `CaseTheme`, `CaseWorldDef`, `SessionLayout`, `EggTrace`, `InvestigationState`, `ABILITY_KEY_LABEL`.
- `ClueDef.short?` / `ClueDef.meaning?` (TL;DR card; required by tests once the designer fills them).
- `NoiseSource` + `'hazard'`. `GameEvent` + `hyde_emerged`, `site_checked`, `trace_found`, `examined`,
  `passage_opened`, `hazard_triggered` (telemetry, not rule events).
- `StateSnapshot` + `hydeEmerged`, `hydeVisible` (placeholders in run.ts / dataset.ts marked TODO for the owners).
- `MapDef.clues` / `MapDef.eggSpawn` are **hidden truth** for the session: sim, bot and the renderer's near-range
  glint may read them; minimap, HUD text and analytics must not.

## Controls (one reference everywhere)
WASD move · mouse / arrow keys look · Shift sprint · C (or Ctrl under the kiosk keyboard lock) crouch · E interact ·
**Q character power** (F also works) · **R Pokémon move** · Tab evidence + investigation map · V Thing hint · Esc pause ·
M mute. Display labels come from `ABILITY_KEY_LABEL` (`{ F: 'Q', Q: 'R' }` — slot id → key the player presses).

## Sim rules (game-developer implements; designer supplies numbers)
1. **Session layout.** `drawLayout(world, seed): SessionLayout` (new `src/mystery/layout.ts`): for each clue group pick
   one site with `prfUniform(seed, 'site:<clueId>')` against the cumulative priors (group order); egg site with
   `'site:egg'`. Never reuse `'egg:tier'`. `MysteryRun` builds the session map = the case map with `clues` and `eggSpawn`
   at the drawn sites (share wall/cover arrays; avoid rebuilding nav grids per run if cheap to do — e.g. key the nav cache
   on the walls array). `run.layout` is hidden truth.
2. **Site checks (Bayesian evidence).** Each step, for every unchecked candidate site within `siteCheckM` of the player
   with line of sight (walls + high cover): if the item is there → `knownClueSites[clueId] = siteId` / `eggSeenAt` and
   emit `site_checked{found:true}`; else add to `checkedClueSites` / `checkedEggSites` and emit `site_checked{found:false}`.
   Searching with E always counts as a check. Detection is certain within `siteCheckM` (likelihood 0 for "present but
   unseen"), so posteriors stay exact.
3. **Egg traces.** Every clue found and every `ExamineDef` with `givesTrace` yields one trace (`trace_found`,
   `sourceId` = clue id / examine id). Target: `u = prfUniform(seed, 'trace:<sourceId>')`; `u < a` (a =
   `world.traceAccuracy`) → the true egg site; else the other sites in `eggSites` order, index `floor((u − a) / (1 − a) ×
   (n − 1))`. Traces are generated even after the egg was seen (they are just no longer informative).
4. **Examine** (`InteractKind` `'examine'`): hold E `examineS` × interactTimeMult, noise like a clue search; once per
   object; emits `examined` (+ `trace_found`). **Lever** (`'lever'`): hold E `leverS`, noise `lever` (`'interact'`
   source); permanently opens `passage.wallId` (same mechanism as the powered gate: collision + LOS + nav); emits
   `passage_opened`.
5. **Hazards.** `noisy_floor`: while walking/sprinting inside the polygon each footstep loudness += `loudnessAdd`
   (crouch unaffected). `searchlight`: beam yaw at sim time t = `phase + 2π·t / periodS` (contract yaw convention; the
   renderer uses the same formula); a not-hidden player within `rangeM`, inside `coneDeg/2` of the beam, with LOS from the
   light → noise `'hazard'` at the player (`loudness`), at most once per `cooldownS`; emits `hazard_triggered`.
6. **Hyde emergence.** The Hyde is absent until `emergeAfterS` (designer; ~20 s) of active play. At that moment: valid
   spawns = `hydeSpawns` with distance ≥ `minSpawnDistanceM` from the player; draw with `prfUniform(seed, 'hyde:spawn')`
   over the valid spawns' weights renormalised (none valid → farthest spawn); snap to nav; patrol from the nearest
   waypoint; emit `hyde_emerged`. `investigation().hydeEmergesInS` counts down before. (The predictive layer shows exactly
   this renormalised distribution for the player's current position.)
7. **Hyde behaviour.** Visibly patrols; INVESTIGATE_SOUND walks to the noise; SEARCH sweeps nearby hiding spots / room
   corners around the last known point; then COOLDOWN back to the loop. Fairness: after a chase ends, a calm window
   `calmAfterChaseS` (reduced hearing) so encounters are not constant. Never unavoidable at spawn.
8. **Player sees Hyde.** `hydeVisible` = emerged ∧ LOS (walls + high cover) ∧ distance ≤ `playerSeesHydeM`; updates
   `lastHydeSighting`.
9. **API additions on MysteryRun:** `layout` (hidden), `investigation(): InvestigationState` (public copy),
   `interactable()` kinds incl. `'examine' | 'lever'`, `hydeEmerged`, snapshot fields filled. Keep every existing API.

## Data (game-designer)
- `caseWorlds.ts` per case: theme; 4–6 `areas`; `clueSites` (≥ 2 candidate sites for at least two of the three clues,
  plausible for the clue's story, ≥ 3 m apart; `ClueDef.location` must read true for every site — use the area-level
  phrase or broaden it); 3 `eggSites` (priors e.g. .5/.3/.2, different areas, one deeper/guarded) with `traceText`;
  `traceAccuracy` (~0.7–0.8); 3 `hydeSpawns` (weights, all ≥ 25 m from the pier start (0, 54), on/near the patrol, in
  open navigable space); 5–8 `zones` tiling the island bounds; case `extraWalls`/`extraCover`/`extraHiding` giving each
  case its own layout (archive bookshelf rows + lab benches; collapsed corridors + tunnel walls; patrol fences + guard
  huts) — keep every doorway ≥ 3 m clear, never block the patrol segments (≥ 0.6 m + wall radius), the tower, start,
  sites, spawns; 1 `passage` (lever + one extra wall it removes, a real shortcut); 3 `examines` (≥ 2 `givesTrace`); case
  hazards (01 glass/creaky floors, 02 rubble/puddles, 03 1–2 searchlights).
- `cases.ts`: `short` (≤ 90 chars) + `meaning` (≤ 60 chars, a link in the chain, never "X did it") for all 9 clues;
  shorter objective/Thing copy ("Find 3 clues."); versions → 2. `solutions.ts` versions → 2 (answers unchanged).
- `tuning.ts`: `hyde.emergeAfterS`, `hyde.calmAfterChaseS`, `sight.playerSeesHydeM`, `investigation.siteCheckM`,
  `player.examineS`, `player.leverS`, `noise.lever`; pacing target: typical human session 5–7 min (bots are faster;
  report bot medians per case). `thing.ts`: tutorial lines use Q (power) / R (move); short lines for the new events.

## Analytics (fullstack-developer) — live, every duo, no character-id branches
Add to `src/mystery/analytics/types.ts` (verbatim names; frontend codes against them):
```ts
export interface SiteProb { siteId: string; areaId: string; label: string; x: number; z: number; p: number; prevP: number | null; ruledOut: boolean }
export interface AreaProb { areaId: string; name: string; x: number; z: number; radiusM: number; p: number }
export interface ZoneProb { zoneId: string; name: string; p: number; polygon: Vec2[] }
export interface SpawnProb { spawnId: string; name: string; zoneId: string; x: number; z: number; p: number }
export interface LiveForecasts {
  detection: { p: number; band: RiskBand; source: 'ml' | 'rule'; label: string; topFactors: RiskFactor[] } | null; // null before emergence
  extraction: { p: number; source: 'ml' | 'rule'; label: string };
  egg: { sites: SiteProb[]; label: 'Bayesian estimate'; lastChange: { reason: string; t: number } | null } | null; // null once carried
  clueAreas: { areas: AreaProb[]; label: 'Bayesian estimate' } | null; // null when all clues found
  hyde: { phase: 'before_emergence'; emergesInS: number; spawns: SpawnProb[]; label: string }
      | { phase: 'active'; zones: ZoneProb[]; label: string };
}
export interface LiveMessage {
  id: string; kind: 'log' | 'diagnostic' | 'advice';
  title: string; // "THING'S LOG" | "HYDE ALERT" | "POWER STATUS" | "INVESTIGATION" | "EGG STATUS" | "THING'S ADVICE"
  text: string; // ≤ 70 chars
  why?: string; // ≤ 80 chars
  basis?: 'rule' | 'pattern'; // diagnostic: direct game-rule cause vs labelled correlation
  t: number; priority: number;
  target?: { x: number; z: number; label: string } | null; // compass/minimap marker for advice / hints
}
export interface LiveAnalytics { t: number; forecasts: LiveForecasts; messages: LiveMessage[]; advice: LiveMessage | null }
```
`MysteryAnalytics.live(): LiveAnalytics` (cheap, callable ~2–4 Hz; `messages` = new since the last call, already
rate-limited). Methods (exact, documented in docs/MYSTERY_MODEL_REPORT.md):
- **Egg** posterior ∝ prior × Π likelihoods: checked-empty site → 0; trace pointing at k → a if i = k else
  (1 − a)/(n − 1); egg seen → 1 at that site. **Clue areas**: per clue group posterior over its sites (checked-empty → 0,
  known → resolved); P(area holds ≥ 1 uncollected clue) = 1 − Π(1 − P(clue in area)).
- **Hyde before emergence**: the sim's renormalised spawn distribution for the player's current position (exact).
  **After**: a documented zone filter (HMM: transitions from the patrol loop's zone sequence + small diffusion;
  observations: sighting → collapse; not visible → the player's own zone down-weighted; CHASE → player's zone);
  calibration measured on simulated episodes (Brier / log-loss vs the patrol-occupancy baseline), reported honestly.
- **Detection**: existing model; **extraction**: existing `extraction()` wired live. Retrain on new episodes after the
  sim lands (session-grouped split, no leakage, metrics in the report; never call a rule estimate ML).
- **Descriptive** Thing's Log on events; **Diagnostic** live alerts from known causes (`hyde_heard` source + stance,
  ability outcomes, egg damage cause, clue contradicting a suspect's statement — use public `mentions` + alibi text,
  never the answer key); **Prescriptive** one feasible action using posteriors, zones, noise, HP, cooldowns, carried egg.
- Leakage guard test: analytics never read `layout`, `map.clues`, `map.eggSpawn` for player-facing estimates.
- Telemetry: forecasts for new targets + heartbeat fields for Laptop 1 (coordinate target names with the backend).

## Renderer (3d-artist)
Per-case identity (lighting, fog colour, sky/weather, props, palette): 01 archive/greenhouse (dim green, vines,
bookshelves, lab glass), 02 crypt/tunnels (stone, flickering lanterns, dust, cobwebs, collapsed corridors, darker), 03
watchtower/security (storm, rain, lightning, flicker, consoles, alarm beacons, searchlight beams). A prop at EVERY
candidate site (`SiteDef.prop`) so props never give the answer away; clue glint/beam and egg glow only when known
(`investigation().knownClueSites` / `eggSeenAt`), revealed by an ability, or within the interact prompt. No footstep
rings; noise rings only for loud non-footstep events, small. Interactable outline/glow within range; examine, lever +
opening passage, hazards (searchlight math above), Hyde hidden until `hyde_emerged` then an emergence effect. Keep the
60 fps cap on the Intel UHD (low-graphics mode must stay cheap).

## App (frontend-developer)
Per `docs/overhaul/UX_OVERHAUL.md`: compass, minimap (from `run.map` geometry + `world` + `investigation()` +
`LiveForecasts`; never `map.clues`/`eggSpawn`), TL;DR clue card, Tab investigation overlay (3 evidence slots + map
with probability layers + source labels), one message stack (log/diagnostic/advice), Q/R keys + one control reference,
duo cards with HP, short copy, proximity audio cue, Laptop 1 dashboard additions. `render_game_to_text` includes the
new public state.

## Backend (backend-architect)
Additive migration + `_shared` updates: new event types, noise source `'hazard'`, new forecast targets, case version 2;
sync-shared; pgTAP + unit tests; security review. No deploy (owner approval).
