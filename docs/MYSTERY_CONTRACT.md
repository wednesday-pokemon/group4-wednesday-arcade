# Mystery v3.1 integration contract ("The Silent Evidence")

Source of truth for requirements: `docs/v3.1/GAME_PLAN_v3_1.md` + `docs/v3.1/MASTER_PROMPT_v3_1.md`.
Shared types: `src/mystery/types.ts` (orchestrator-owned — request changes, don't edit). Rules version `mystery-v3.1`.
Checkpoint of the previous (rowing) build: git tag `pre-mystery-v3.1`.

## Module ownership (exclusive)

| Owner | Files | Delivers |
|---|---|---|
| orchestrator | `src/mystery/types.ts`, `docs/MYSTERY_CONTRACT.md`, `docs/IMPLEMENTATION_PROGRESS.md`, `docs/ACTIVITY_COMPLIANCE.md`, `docs/PLAYTEST_RESULTS.md`, integration | contract, integration, browser playtests |
| game-designer | `src/mystery/data/**`, `docs/MYSTERY_DESIGN.md` | roster registries, case text, map layout, Thing lines, tuning |
| research (general-purpose) | `docs/MOVE_LEGALITY.md` | per-species/form move verification with sources |
| game-developer | `src/mystery/**` except `data/`, `types.ts`, `analytics/`; `tests/unit/mystery/**` | sim: player, collision, noise, nav, Hyde FSM, egg, abilities interpreter, case logic, draft, scoring, bot |
| 3d-artist | `src/three/mystery/**`, `tools/mystery-preview.*` | walkable island renderer, characters, Hyde, Thing, egg, tower, VFX |
| frontend-developer | `src/app/**`, `src/ui/**`, `index.html`, `tests/e2e/**` | journey, cards, HUD, evidence board, results, Thing UI, persistence, routes |
| backend-architect | `supabase/**`, `docs/SUPABASE_SETUP.md` (mystery section) | additive migrations, RLS, Edge Functions, pgTAP |
| analytics (Phase 4) | `src/mystery/analytics/**`, `scripts/mystery-*.ts`, `tests/unit/mystery-analytics/**` | telemetry + four services + training |

Pure modules shared with Deno Edge Functions (copied by `scripts/sync-shared.mjs`): `src/mystery/types.ts`,
`src/mystery/data/**`, `src/mystery/draft.ts`, `src/mystery/stats.ts`, `src/mystery/scoring.ts`, `src/mystery/caseLogic.ts`, `src/mystery/prf.ts`, `src/mystery/config.ts`.
They may only import each other, `src/game/types.ts` and `src/game/constants.ts` — no DOM, no three, no Math.random, no Date.

## Data registries — `src/mystery/data/` (game-designer)
- `nightshades.ts`: `export const NIGHTSHADES: Record<NightshadeId, NightshadeDef>` — 7 entries, F powers per plan §5.
- `partners.ts`: `export const PARTNERS: Record<PokemonId, PokemonPartnerDef>` — 18 entries, Q moves per plan §6, `legality`
  initially `{ status: 'unverified', ... }` until `docs/MOVE_LEGALITY.md` is done (orchestrator flips them).
- `cases.ts`: `export const CASES: Record<CaseId, CaseDef>` — three alternate scenarios (Poisoned Archive / Crypt's Last
  Witness / Midnight Signal), PUBLIC data only. `solutions.ts`: `CASE_SOLUTIONS` (answer keys; server + post-accusation
  only). The retired single case `SILENT_EVIDENCE` (`case.ts`) is gone. Full contract: `docs/MYSTERY_CASES.md`.
- `island.ts`: `export function buildIsland(): MapDef` — compact walkable map (≈ 90 × 120 m): pier → path → research room,
  ruined crypt (entrance), egg chamber, optional shortcut behind Gomez's power gate (also walkable the long way), Iago Tower
  courtyard. Real walls, low/high cover, ≥ 6 hiding spots, a learnable patrol loop, fog in the crypt.
- `tuning.ts`: `export const MYSTERY_TUNING` — speeds, noise (crouch 0.10 / walk 0.35 / sprint 0.95 / egg drop 1.0), hearing
  radii (walk 7 / sprint 13 / egg drop 17 m), sight (cone 100°, 13 m clear / 8 m fog), chase-loss 4 s, search 8 s, catch
  −35 HP, safe-release invulnerability, egg tier weights 50/35/15, egg security losses, carry slowdown/noise, search times.
- `thing.ts`: Thing's short subtitled lines (tutorial incl. the exact “Stay Silent: Move slowly and avoid making noise —
  Hydes are sensitive to sound.”, clue intros, threat lines, delivery/results), never naming the culprit.
- `stats.ts` is NOT data: the stat formula lives in `src/mystery/stats.ts` (game-developer) — see below.

## Sim API — `src/mystery/run.ts` (game-developer)
```ts
export class MysteryRun {
  constructor(o: { duo: Duo; seed: string; map?: MapDef; caseDef?: CaseDef; tutorial?: boolean });
  readonly map: MapDef; readonly caseDef: CaseDef; readonly duo: Duo; readonly card: DuoCard; readonly seed: string;
  status: RunStatus; t: number;                 // active sim seconds (pause = app stops calling update)
  readonly player: PlayerState; readonly hyde: HydeRuntime; readonly egg: EggRuntime;
  readonly cluesFound: ClueId[]; readonly log: StampedEvent[];
  update(frameDt: number, input: MysteryInput): StampedEvent[]; // fixed 60 Hz inner step, deterministic per seed
  endTutorial(): void;                          // 'tutorial' → 'playing' (Hyde starts patrolling)
  powerStatus(): AbilityStatus; moveStatus(): AbilityStatus;
  effects(): ActiveEffects;                     // what the renderer/HUD draw (reveal list, premonition path, lure point, …)
  interactable(): { kind: 'clue' | 'egg' | 'tower' | 'switch' | 'practice'; id: string; label: string; progress: number } | null;
  objective(): Objective; isWallOpen(id: string): boolean;
  snapshot(): StateSnapshot;                    // 1 Hz analytics sample (no future info)
  accuse(suspect: SuspectId | null): StampedEvent[]; // only in status 'accusing' (after E deposit), once; null = leave unsolved → verdict not_accused
  result(): RunResult | null;
}
```
Rules: egg deposit with E inside `map.tower` → status `accusing` and the clock stops; `accuse()` → `finished` with
verdict (`case_solved` needs all three clues AND correct suspect; otherwise `egg_secured_mystery_unsolved`). Second catch
or HP 0 → `dnf`. Score = `round1(points × 100 − activeTimeS)`; DNF score `null`. Egg tier drawn from the seed
(weights in tuning). The Hyde never spawns within 25 m of the player, follows a nav grid built from walls/cover, and
changes mode only through hearing (distance + loudness + wall occlusion) or sight (cone + range + walls + fog + hiding).
Every F/Q is interpreted from `AbilityDef.effects` (switch on `kind`, never on character/Pokémon ids).

## Draft + stats — `src/mystery/draft.ts`, `src/mystery/stats.ts` (game-developer, pure)
- `combineMods(n: NightshadeDef, p: PokemonPartnerDef): PlayMods`; `duoStats(mods, power, move): DuoStats` — documented
  formula, clamped 1–5, each stat a monotone function of real numbers (e.g. stealth from footstepNoiseMult, mobility from
  speeds + dash/boost, hydeControl from stun/slow/distract seconds × hydeEffectDurationMult, eggProtection from
  eggSecurityLossMult + egg_shield/block_grab, defense from catchDamageMult + block_grab/heal, investigation from
  interactTimeMult + reveal_clues/reveal_hazards).
- `draftOffer(seed: string): DuoOffer` — seeded (string → 128-bit PRF, like src/game/random.ts), exactly 3 cards, no duplicate
  pair, prefers distinct characters AND Pokémon, deterministic scoring search maximising role diversity (target one
  investigation/stealth, one mobility/escape, one defense/control), deterministic fallback. Same seed → same offer.
- `buildCard(duo): DuoCard`.

## Renderer — `src/three/mystery/MysteryScene.ts` (3d-artist)
`new MysteryScene(container, map, duo, options: { reducedMotion; lowGraphics })`, `render(run, events, dt)`,
`setOptions`, `getDebugState(run)`, `dispose()`. Reads only public run state. Third-person follow camera from
`player.yaw/pitch` with wall avoidance; island from `MapDef` (walls, cover, hiding spots, rooms, fog, landmarks, tower,
switch/gate); player character model per Nightshade + Pokémon companion; the Hyde (reuse `src/three/action/hydeRig.ts`
look: monstrous, glowing eyes) walking with mode-driven animation (patrol, investigate, search, chase, grab, stunned,
petrified); clue objects (glint when revealed), egg (tier glow), Thing (hand) at the pier and as narrator; VFX for every
`AbilityEffectKind`; noise rings at `noise` events; Hyde premonition path; hidden-state vignette.

## App — frontend-developer
`/` = mystery journey: Restored Home (existing Splash, Thing emblem) → nickname → three duo cards → Thing tutorial →
play (HUD: HP, noise/suspicion, objective, clues 0/3, egg, F/Q cooldowns, Thing line, Hyde warning) → Tab evidence board
→ deposit at tower → accusation → results (+ four analytics panels) → reset. Pointer lock for mouse look; Esc pause;
prevent browser defaults (Tab, Ctrl, Space scroll). Session persistence: `localStorage['raven.mystery.session']` =
`{ sessionId, seed, offer, selected?, nickname }` — the offer is created once per new session (crypto seed) and restored on
refresh; "Play again"/reset starts a new session. Legacy routes kept: `/?legacy=1` (v2.5), `/?mode=rowing` (v3.0 rowing).

## Analytics — `src/mystery/analytics/` (Phase 4)
`TelemetryCollector` (StampedEvent + 1 Hz StateSnapshot) → `DescriptiveService`, `DiagnosticService`
(rule-verified causes vs labelled correlations), `PredictiveService` (P(detected within 15 s); trained logistic on
seeded simulated episodes with session-grouped holdout, else labelled "Rule-based risk estimate"), `PrescriptiveService`
(one feasible action + reason). Works for every duo; no character-specific gate. Thing presents; it computes nothing.

## Backend — backend-architect (additive, `rules_version = 'mystery-v3.1'`)
Tables: `mystery_sessions` (seed, offered duos, selected duo, station, status), `mystery_offered_duos`, `mystery_events`
(unique (session_id, seq)), `mystery_clue_events`, `mystery_forecasts`, `mystery_recommendations`, `mystery_results`
(unique session_id), leaderboard view ordering finishers (score desc) above DNFs. Edge Functions validate offered-duo
selection, event order (clue → egg → deposit → accusation), score recomputation, idempotent finalisation.
