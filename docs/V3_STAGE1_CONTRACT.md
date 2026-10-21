# v3 Stage 1 integration contract (Phase 1 corrections)

Shared by game-developer (`src/action/**`), 3d-artist (`src/three/action/**`), frontend-developer (`src/app/**`,
`src/ui/**`) and game-designer (`src/action/data/lake.ts`). Types live in `src/action/types.ts` (already extended:
LandMass, Landmark, RouteHint, EncounterTrigger, HydeState, RescueState, AbilityRuntime, RunStatus, new ActionEvents).
Design source: `docs/GDD_V3_REALTIME.md` + user decisions D-25…D-28 in `docs/DECISIONS.md`.

## Course data — `src/action/data/lake.ts` (game-designer)
`export function buildLakeCourse(): CourseDef` — an OPEN haunted lake, not a corridor:
* Start: Nevermore start dock (south), Nevermore academy silhouette behind the start. Finish: Raven Island dock (north).
* Land polygons (`land`) shape curved waterways: at least 2–3 genuinely different routes between start and dock
  (e.g. open western bay = longer/safer, central reef channel = shorter/riskier, eastern narrows = tight + currents).
* Islets/reefs, shoreline with twisted trees, debris fields, a few drifting obstacles (`drift.axisAngle` allowed),
  currents and fog banks placed where they create decisions. No repeating rows or lane buoys down the middle.
* Landmarks: nevermore_academy, start_dock, raven_island, raven_dock, lighthouse and/or wreck/bell_buoy as wayfinding.
* `routes`: lantern lines for each route (visual guidance only). `encounters`: calm (start), disturbance (fog + sound,
  ~25–30 % of the way), hyde_emerge (~35 %), one or two surge triggers mid-course, safe_harbour near the dock.
* `hydeSpawn`: behind/below the boat near the disturbance trigger. World scale: boat 8–9 u/s typical; target 70–100 s
  for a typical player; total straight-line distance ≈ 450–550 u; bounds generous (no invisible walls inside the lake).

## Run API — `src/action/run.ts` (game-developer) — `export class StageOneRun`
```ts
constructor(o: { characterId: CharacterId; pokemonId: PokemonId; course?: CourseDef /* default buildLakeCourse() */ })
readonly course: CourseDef; readonly boat: BoatState; readonly hyde: HydeState; readonly rescue: RescueState
readonly ability: AbilityRuntime; readonly abilityDef: PokemonAbilityDef; readonly characterDef: CharacterActionDef
status: RunStatus;             // 'playing' | 'rescue' | 'finished' | 'dnf'   ('intro' unused by the run itself)
catches: 0 | 1 | 2; t: number; // active sim seconds (excludes pause; rescue slow-mo counts real-time-scaled)
stats: RunStats;               // SessionStats + { hydeCloseCalls, abilitiesUsed, rescues, cleanEscapes, timeInDangerS }
update(frameDt: number, input: InputSnapshot): ActionEvent[]   // Q = ability, E reserved; strokes as Phase 1
canPause(): boolean            // false during the rescue window (anti-exploit)
cinematic(): { kind: 'hyde_reveal'; remainingS: number } | null // brief (≤3 s) camera moment when Hyde emerges
skipCinematic(): void          // SPACE/Enter may skip it; gameplay never stops during it
abilityStatus(): { ready: boolean; cooldownLeftS: number; chargesLeft: number | null; activeLeftS: number }
effects(): { shield: boolean; speedBoost: boolean; hydeSlowed: boolean; hydeDistracted: boolean; decoy: Vec2 | null;
             fogCleared: boolean; obstaclesRevealed: boolean; currentShield: boolean; anchored: boolean; staminaSurge: boolean }
fogAt(): number; progress: number /* 0..1 toward the dock */; distanceToDock(): number
```
Rules: Hyde is a real pursuer with position/velocity (HydeState) following the boat's wake (never spawns ahead),
closes when the player is slow or crashes, loses ground when the player rows well; telegraphed surges; threat 0..1.
Catch radius → `hyde_catch` → rescue window (`RescueState`, ~2 s real time at ~0.25× sim speed): Q within the
window with the ability ready applies the Pokémon's `rescue` data (negateDamage / protectEgg / pushHydeBackM);
a defensive negation still counts the catch unless it is a "clean escape" per GDD. Second counted catch → `dnf`.
HP never ends the run (GDD "swamped" rule). Every Pokémon effect is driven by `POKEMON_ABILITY_DEFS` data
(specialty/magnitude/duration/cooldown/charges) — no Pokémon-id branches outside one interpreter module.
Character stats come from `CHARACTER_ACTION_DEFS` (register them in characterStats). Gholdengo: no fractional
points (D-27) — use its egg-protection effect. Keep Phase 1 rowing feel (D-28).

## Renderer — `src/three/action/ActionScene.ts` (3d-artist)
`new ActionScene(container, course, crew, options)`, `render(run: StageOneRun, events: ActionEvent[], dt)`,
`setOptions`, `getDebugState(run)`, `dispose()`. Reads only public run state. Must draw: land polygons (extruded
shore with twisted trees), landmarks, route lanterns, debris/rocks/drifting obstacles, fog banks, currents, the
Hyde (dark monstrous silhouette, large claws, glowing eyes; underwater shadow while stalking; emerge, swim/wade,
surge, lunge/attack, stunned, distracted; visibility/threat-driven), Pokémon companion reacting to threat and
ability VFX per specialty, the cinematic camera glance, and a chase camera that keeps both the water ahead and the
Hyde readable (pull back/up as threat rises; never lose the boat).

## UI — frontend-developer
Journey at `/` (v3 is now the default): Home (existing Splash) → Nickname → Character select (12, portrait
`/art/characters/<id>.webp`, name, ability, 5 stat bars from CHARACTER_ACTION_DEFS + real-time trait) → Pokémon
select (18, `/art/pokemon/<id>.webp`, name, type/specialty, ability text, cooldown) → Confirm → short interactive
tutorial (row/steer/ability, hold-to-row option offered) → Stage 1 (StageOneRun + ActionScene + HUD) → Stage 1
complete screen ("Raven Island reached — egg hunt next phase"). Legacy v2.5 decision race stays reachable at
`/?legacy=1`. HUD adds: Hyde proximity meter + warning states, catches 0/2, ability button with cooldown/charges
(Q), urgent rescue prompt "THE HYDE HAS CAUGHT YOU! PRESS Q", cinematic skip hint, DNF screen.
