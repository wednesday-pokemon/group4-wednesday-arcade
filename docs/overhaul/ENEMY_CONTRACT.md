# Enemy contract — Joseph Crackstone + Hyde visual overhaul (2026-10-24)

Owner request (binding): add **Joseph Crackstone** as a second, sight-based enemy and rebuild the **Hyde**'s 3D model and
animations from the owner's reference photos, integrated with the three cases, the abilities, the four live analytics,
the HUD/minimap and the server. Event: **Tue Oct 27 2026** — every step must leave tsc + vitest green and the game
playable. Builds on the uncommitted overhaul tree (docs/overhaul/OVERHAUL_CONTRACT.md still applies; backup of that tree:
`D:\PokemonDay-cache\backups\pre-enemy-20261024-0532.tgz`, base HEAD 2842ec1).

References (look at them before modelling): `docs/overhaul/refs/crackstone-ref.png` (pilgrim illustration) and
`docs/overhaul/refs/hyde-ref-1..5.png` (3D-printed Hyde statue, five angles).

## Ownership (exclusive — ask the orchestrator before editing outside your row)
| Owner | Files |
|---|---|
| orchestrator | `src/mystery/types.ts`, `docs/overhaul/ENEMY_CONTRACT.md`, `docs/AGENT_SKILL_LOG.md`, `docs/DECISIONS.md`, `output/*.mjs` |
| game-designer | `src/mystery/data/**` (caseWorlds `crackstone`, tuning `crackstone`, thing lines), `docs/MYSTERY_DESIGN.md` §11 |
| game-developer | `src/mystery/**` except `data/`, `types.ts`, `analytics/`; `tests/unit/mystery/**` |
| 3d-artist | `src/three/mystery/**`, `tools/mystery-preview*` |
| frontend-developer | `src/app/**` (not `live*`), `src/ui/**`, `tests/unit/mystery-app/**`, `tests/e2e/**` |
| fullstack-developer | `src/mystery/analytics/**`, `scripts/mystery-*.ts`, `tests/unit/mystery-analytics/**`, `docs/MYSTERY_MODEL_REPORT.md`, `src/lib/supabase/**`, `src/app/mystery/live*` |
| backend-architect | `supabase/**`, `scripts/sync-shared.mjs`, `docs/SUPABASE_SETUP.md`, `docs/SECURITY.md` |

## Design decisions (orchestrator rulings — DECISIONS D-43)
- **R1 Hyde modes keep their names** (`PATROL | INVESTIGATE_SOUND | SEARCH | CHASE | COOLDOWN`): renaming would ripple
  through server enums, the trained models and telemetry three days before the event. Mapping to the requested taxonomy:
  INVESTIGATE = INVESTIGATE_SOUND, ATTACK = the grab wind-up (`h.grabbing` / windup), RETURN = COOLDOWN (walks back to its
  loop). The Hyde's behaviour is unchanged except rule R6. Crackstone uses the exact requested names.
- **R2 Crackstone is per-case data** (`CaseWorldDef.crackstone: CrackstoneDef | null`). Maps without it (fixtures) have
  no Crackstone at all, so every existing fixture test keeps its meaning.
- **R3 Crackstone is deaf**: he never reacts to noise (that is the Hyde's job). He detects by **sight** (cone, range,
  walls + high cover block, low cover blocks a crouching player, fog shortens range, hiding spots hide), **proximity**
  (≤ proximityM all around him, LOS required, not through walls, not when hidden) and the **supernatural scan**.
- **R4 Present from the start of play** (t = 0 of 'playing', inactive in the tutorial), at `crackstone.start`, inside his
  cursed area, which is never within 25 m of the pier start. His cursed AREA (name + outline) is public (Thing announces
  it, minimap draws it); his POSITION is shown on HUD/minimap/compass only while the player can see him, while he is
  chasing / attacking, or while a reveal effect shows enemies (same rule as the Hyde).
- **R5 Leash**: he never chases farther than `leashM` from his area's centroid — he gives up (→ SEARCH → RETURN).
  Encounters stay local and escapable; he is a guardian of a place, the Hyde roams.
- **R6 No simultaneous chases**: while the Hyde is in CHASE, Crackstone does not start CHASE / ATTACK / scans; if he is
  chasing or attacking when the Hyde starts a chase, he cancels (curse fizzles) and goes to SEARCH (reason `deferred`).
  The Hyde is never changed by Crackstone.
- **R7 Curse ≠ catch**: a landed curse costs `curseHp` HP and slows the player (× `curseSlowMult` for `curseSlowS`); it
  does not add a catch and does not touch the egg. HP ≤ 0 is still a DNF (`hp_depleted`). `block_grab` also blocks the
  next curse's damage (consumed). After a landed curse he RETURNs (and the player gets `curseInvulnerableS`).
- **R8 Abilities stay effect-kind based** (no character-id branches; the existing scan test enforces it):
  - `stun`, `slow`, `distract`, `power_switch` fallback stun: apply to EVERY enemy that passes the effect's targeting
    (range / line of sight / facing cone). `no_target` only when no enemy qualifies. Diminishing stuns per enemy.
    Detail text names who was hit ("Hyde stunned 3.0 s", "Crackstone petrified 2.5 s", "Hyde and Crackstone stunned …").
  - `lure`: the Hyde as today; Crackstone too if he is within `crackstone.lureRangeM` of the decoy point (a siren /
    illusion he can see), he walks to it ignoring the player for the duration, then SEARCHes.
  - `premonition` (Morticia): predicted paths of every active enemy within rangeM.
  - `reveal_clues` WITHOUT the scent visual (Wednesday's Psychic Vision, Eugene's Bee Swarm, Chandelure): additionally
    reveals every enemy within the effect's rangeM (0 = anywhere) for durationS — "supernatural detection / scouting".
  - `block_grab`: next grab OR curse deals no damage. `speed_boost` / `dash`: escape tools against both.
  - Abilities never invent move names; data in nightshades.ts / partners.ts is not renamed.
- **R9 Telegraphs are public and early**: scan warning ≥ 1.8 s before the pulse, curse circle ≥ 1.2 s before it lands;
  both visible in 3D, on the HUD (word + icon + countdown) and audible. Everything an attack needs (circle, timer) is in
  the public runtime, so the bot and the HUD may read it.

## Sim rules (game-developer; numbers in tuning `crackstone`, designer)
Modes `PATROL → INVESTIGATE → CHASE → ATTACK → SEARCH → RETURN → PATROL`.
1. **PATROL**: walk the closed `patrol` loop at `speedMps.PATROL` (slow, deliberate), pausing `patrolPauseS` at every
   waypoint while slowly turning (looking around). Scans every `scanEveryS` (± `scanJitterS`, sim rng) while in PATROL or
   SEARCH and not deferred (R6).
2. **Perception each step** (when active, not stunned / lured / distracted, player not invulnerable):
   sight via `canSee(world, crackstone.sight, …)` (own SightTuning: coneDeg, rangeClearM, rangeFogM, crouchRangeMult,
   instantChaseM, hidingRevealDefaultM); proximity (≤ proximityM, LOS, not hidden). Seen → suspicion += sightGainPerS ×
   (1 + (1 − d/range)) × dt; suspicion ≥ chaseAt or d ≤ instantChaseM (or proximity) → CHASE (`saw_player` /
   `sensed_player`), else a glimpse → INVESTIGATE the last seen point. Not seen → suspicion decays (`decayPerS`).
   First detection of an encounter emits `crackstone_sighted {via}`; losing sight emits `crackstone_lost`.
3. **Scan**: `crackstone_scan {phase:'warning'}` → `scanWarnS` later `crackstone_scan {phase:'pulse', hit}`: hit = player
   within `scanRadiusM`, LOS from him, not hidden (crouching does NOT help; walls do). Hit → CHASE (`scan_hit`) and
   `crackstone_sighted {via:'scan'}`. He stands still while scanning (`runtime.scan` holds phase + times + radius).
4. **INVESTIGATE**: walk to the last seen point at `speedMps.INVESTIGATE`; arrive or `investigateMaxS` → SEARCH.
5. **CHASE**: follow the player (nav, replan like the Hyde) at `speedMps.CHASE` (walk 3.2 < chase < slowest sprint 4.22).
   Lost sight for `chaseLossS` → SEARCH (`lost_sight`); beyond `leashM` from the area centroid → SEARCH (`leash`).
   Within `curseRangeM` with LOS, curse ready (`curseCooldownS` since the last cast) → ATTACK.
6. **ATTACK (curse)**: stops, faces the player; `runtime.curse = {x,z,radiusM,startedAt,landsAt}` centred on the
   player's position at cast time; `curse {phase:'cast'}`. At `landsAt` (+`curseWindupS`): player inside the circle, LOS
   from him, not invulnerable, not hidden → `curse {phase:'hit', hpLost, blocked}`, apply R7, → RETURN (`curse_done`);
   else `curse {phase:'miss'}` → CHASE if he still sees the player, else SEARCH. A stun / lure / distract / R6 deferral
   during the wind-up cancels it (`curse {phase:'miss'}`).
7. **SEARCH**: `searchS` around the last known point (reuse the Hyde's safe wander rule: never stand within
   hidingSafeM of a hiding spot, so hidden players are not dragged out), then RETURN (`search_timeout`).
8. **RETURN**: walk to the nearest patrol waypoint at `speedMps.RETURN`; reduced perception (sight range × returnSightMult)
   so a just-escaped player is not re-acquired instantly → PATROL (`returned`).
9. **Movement**: nav grid with his own radius (`radiusM`, reuse `navGridFor`), `world.move` collision, turn rate; never
   through walls, never teleports. A stuck guard like the Hyde's.
10. **Effects**: stunned / slowed / distracted / lured fields like the Hyde; petrify / pin visuals per enemy.
11. **Events (types.ts)**: `crackstone_mode`, `crackstone_sighted`, `crackstone_lost`, `crackstone_scan`, `curse`.
    Deterministic (sim rng only). All events are telemetry the server must accept (backend: enums + additive migration).
12. **MysteryRun API** (keep everything existing): `crackstone: CrackstoneRuntime | null`, `crackstoneBrain`,
    `crackstoneDef` (public), `crackstonePresent` (getter), `crackstoneVisible()`, `crackstoneBearing()`;
    `snapshot()` new fields (types.ts); `investigation().lastCrackstoneSighting`; `effects()` new fields (types.ts).
    Release after a Hyde grab prefers safe points also ≥ 12 m from Crackstone when possible.

### Tuning keys (`MYSTERY_TUNING.crackstone` in src/mystery/data/tuning.ts — designer sets numbers; game-developer maps
them in src/mystery/config.ts to `SimTuning.crackstone`, building `sight` in the exact `SimTuning['sight']` shape so
`canSee()` is reused unchanged)
```
crackstone: {
  radiusM, turnRateRadPerS,
  speedMps: { PATROL, INVESTIGATE, CHASE, ATTACK, SEARCH, RETURN },   // ATTACK = 0; walk 3.2 < CHASE < 4.22
  patrolPauseS,                                    // look-around pause at each waypoint
  sight: { coneDeg, rangeClearM, rangeFogM, crouchRangeMult, instantChaseM },   // his own cone/range
  proximityM,                                      // senses a non-hidden player this close all around (LOS)
  suspicion: { sightGainPerS, chaseAt, decayPerS },
  chaseLossS, searchS, searchRadiusM, investigateMaxS, waypointReachedM,
  returnSightMult,                                 // sight range × this while RETURNing
  scanEveryS, scanJitterS, scanWarnS, scanRadiusM, scanPulseShowS,
  curseRangeM, curseRadiusM, curseWindupS, curseCooldownS, curseHp, curseSlowMult, curseSlowS, curseInvulnerableS,
  lureRangeM,                                      // a decoy this close to him pulls him too (R8)
  playerSeesCrackstoneM,                           // player sees him (HUD / minimap / lastCrackstoneSighting)
  releaseMinDistM,                                 // Hyde-grab release prefers safe points ≥ this from him
}
```
`SimTuning.crackstone.sight` = `{ coneDeg, rangeM, fogRangeM, crouchRangeMult, distractedRangeMult (abilities), instantM,
playerSeesHydeM: playerSeesCrackstoneM }`.

## Renderer (3d-artist)
- **Hyde** rebuilt to the statue photos: extremely hunched, muscular upper back and shoulders, lean ribbed torso,
  long thin arms ending in OVERSIZED clawed hands (long fingers, claws) that reach the ground, bent digitigrade-ish legs,
  distorted head with bulging round eyes, open screaming mouth with teeth, wild spiky hair tufts; grey/stone-silver flesh
  with dark crevices (shader or vertex colour), not a generic humanoid. Locomotion: crawling knuckle-walk on all fours
  at PATROL/SEARCH, faster loping gallop in CHASE, a lunge (arms forward) during the grab wind-up, head tilts when it
  hears (INVESTIGATE_SOUND), stunned / petrified / pinned looks kept. Keep the emergence effect.
- **Crackstone** from the illustration: tall gaunt man, wide-brimmed pilgrim hat (tall crown + buckle), long tattered
  cloak flaring behind, colonial coat, breeches, weathered buckled boots, a staff/cane, pale cursed face with faintly
  glowing eyes, subtle cursed aura (a few embers / a dim sickly-green light, not a particle storm). Slow upright stride
  in PATROL (cloak sway), forward-leaning aggressive stride in CHASE, staff raised in ATTACK, arms spread + aura flare in
  the scan warning. Stunned / petrified / pinned looks.
- **Telegraphs**: scan warning = a ring expanding on the ground to `scanRadiusM` over `scanWarnS` + aura flare, then a
  pulse flash; curse = a glyph circle on the ground at `runtime.curse` that fills over the wind-up, then a burst (hit) or
  fade (miss). Distinct colours: Hyde = red/violet (existing), Crackstone = spectral green/teal.
- Budget: keep the frame budget of DEPLOY_READINESS (≤ ~3.5 ms/frame normal on the dev laptop, low-graphics mode works),
  no new textures > 512², reuse materials, instanced / merged geometry where possible.

## HUD / minimap / audio (frontend-developer; spec by ui-ux-designer)
Crackstone pill next to the Hyde pill (state word + icon + border style, greyscale-safe; Hyde keeps red); scan warning
and curse warning as high-priority banners with a countdown; minimap: cursed-area outline + Crackstone risk tint
(analytics), his marker only per R4, curse circle when on screen; compass marker only per R4. Audio (synthesized like the
existing cues): Crackstone detection toll, chase drone, scan chime (warning) + pulse, curse cast + hit; Hyde keeps its own.

## Analytics (fullstack-developer) — every duo, honest, live
- Descriptive: encounters / detections (by enemy and via) / escapes / curses (cast, hit, dodged) in Thing's Log and the
  results + dashboard.
- Diagnostic: rule causes — Hyde heard <source + stance>; Crackstone saw you (distance, not crouched / in the open),
  sensed you (proximity), scan hit (not behind a wall / not hidden); curse landed (stayed in the circle).
- Predictive: Hyde as today (zone HMM + detection model). Crackstone: a RULE-BASED risk computed from his public patrol
  route and his actual sight / scan rules (e.g. P(he can see a point within the next N s) with a uniform loop-phase prior,
  conditioned on the last sighting), labelled "Rule-based estimate"; minimap tint + odds row. Re-generate episodes and
  re-evaluate / retrain the detection model if its inputs changed; report honestly (no invented numbers).
- Prescriptive: one feasible action including Crackstone cases (break line of sight, hide, crouch behind low cover is NOT
  enough for a scan, leave the curse circle, avoid his area, use a power that can hit him now).
- Leak rules unchanged: never read layout / map.clues / map.eggSpawn; enemy positions only per R4.

## Server (backend-architect)
New event types + reasons → `_shared/mystery-events.ts` enums, `mystery-validation.ts`, one additive migration
(`20261024000100_mystery_crackstone.sql`, event-type CHECK + any forecast targets), pgTAP + drift tests, `npm run
sync:shared`, deploy order note in SUPABASE_SETUP.

## Acceptance (orchestrator verifies, with evidence)
1. Both enemies resemble their references (screenshots side by side). 2. Hyde reacts to sound; Crackstone to sight /
proximity / scan. 3. Both navigate (no wall clipping, no teleports), attacks are telegraphed and escapable. 4. All three
cases (Crackstone area per case). 5. All 7 powers + 18 moves still work (acceptance harness A). 6. Analytics reflect both.
7. No regressions (full vitest, tsc, functions typecheck, supabase-unit, pgTAP/round trip, e2e cases + prologue). 8. Build
OK, browser gameplay tests, 126 duos × 3 cases bots finish, pacing still ~5–7 min.
