# Rules Engine Specification — rules v2.5 (canonical, implementation-level)

Authority: master prompt §3–§6 > GDD v2.5 PDF > this file's engineering clarifications (logged in `DECISIONS.md`).
Source files: `src/game/types.ts` (contract), `src/game/constants.ts` (only source of numbers), `src/game/random.ts` (keyed RNG).

## Units
* **Time = integer centiseconds (`Cs`)**. Base seconds are integers and discounts are integer percentage points, so
  `savingsCs = baseS * discountPct` is an exact integer. Every delay is an integer or half second → exact in Cs.
  Seconds for display = `cs / 100` formatted with 2 decimals. Never accumulate float seconds.
* Score: `scoreCenti = finalEggPoints * 10000 - totalSimulatedTimeCs`; `finalScore = scoreCenti / 100` (exact 2 dp).
* Probabilities: fractions; compare `draw < p` (draw ∈ [0,1)). p = 0 never fires, p = 0.95 is the max.

## Public engine API (`src/game/index.ts` barrel)
```ts
// rules.ts — pure, no seed knowledge; everything trusted comes in as LegContext + LegDraws
createInitialState(i: { sessionId: string; nickname: string; characterId: CharacterId; pokemonId: PokemonId }): GameState
getPushOptions(state: GameState): PushOption[]                    // always 3 entries, levels 1..3, for state.legIndex
buildLegView(state: GameState, ctx: LegContext): LegView          // offer visibility rules below
prepareLeg(state, ctx, choice: LegChoice, expectedRevision: number): Result<{ state: GameState }>
resolvePreparedLeg(state, ctx, draws: LegDraws, egg: EggDecision, expectedRevision: number): Result<{ state: GameState; resolution: LegResolution }>
abandonSession(state): GameState                                  // status 'abandoned', phase 'complete', score null
type Result<T> = ({ ok: true } & T) | { ok: false; error: ActionRejection }

// session.ts — seed wrappers used by LOCAL DEMO adapter and the Edge Functions (same code)
prepareWithSeed(state, seed, choice, expectedRevision)
resolveWithSeed(state, seed, egg, expectedRevision)
buildSessionView(state, seed, verified: boolean, seedCommitment: string | null): SessionView // reveals seed only when status !== 'in_progress'

// scoring.ts
computeFinalEggPoints(bankedEggPoints, pokemonId): number
computeFinalScore(finalEggPoints, totalSimulatedTimeCs): number
compareScoreRecords(a: ScoreRecord, b: ScoreRecord): number      // ranked sort comparator
rankLeaderboard(records: ScoreRecord[]): ScoreRecord[]           // completed only, sorted; dnf/abandoned/in_progress excluded
formatSeconds(cs: number): string                                // "45.60"

// simulation.ts — used by tests, synthetic data, advisor
sampleLegContext(rng: () => number, leg: LegIndex): LegContext
sampleLegDraws(rng: () => number): LegDraws
type RacePolicy = { chooseLeg(state, view: LegView, options: PushOption[]): LegChoice; chooseEgg(state, offer: EggTier): EggDecision }
simulateRace(i: { seed: string; characterId; pokemonId; policy: RacePolicy; sessionId?: string }): { state: GameState; contexts: LegContext[] }
simulateFromState(state, rng, policy): GameState   // continue an in-progress state with sampled (not seeded-secret) contexts

// validation.ts
sanitizeNickname(raw: string): { ok: true; value: string } | { ok: false; message: string } // trim, collapse spaces, strip control/markup chars <>&"'`, length 3–15
isCharacterId(x: unknown): x is CharacterId ; isPokemonId(x: unknown): x is PokemonId
isRouteId, isPushLevel, isEggDecision
```

## State machine
`awaiting_route --prepareLeg--> awaiting_egg --resolvePreparedLeg--> awaiting_route (next leg) | complete`.
* `prepareLeg` requires status `in_progress`, phase `awaiting_route`, `expectedRevision === state.revision`, legal push.
  It sets `prepared` (incl. `selectedOffer = ctx.offers[route]`, `weather`), phase `awaiting_egg`, revision+1.
  No rolls, no stamina deduction yet (deducted at resolve). Repeating prepare with a stale revision → `STALE_REVISION`
  (adapters handle idempotent retry by returning stored state when the same choice was already prepared).
* `resolvePreparedLeg` requires phase `awaiting_egg`, matching revision. `collect` on `selectedOffer === 'none'` → `NO_EGG_TO_COLLECT`.
  Produces exactly one `LegResolution`, appends it, revision+1.
* Errors never mutate state. Functions are pure (return new objects; never mutate inputs).

## Visibility (`buildLegView`)
weather always visible for current leg. `visibleOffers`: Eugene → both routes always; others → `{}` in `awaiting_route`,
`{ [prepared.route]: selectedOffer }` in `awaiting_egg`. Offers come from the seed and never change after selection.

## Stamina
Cost: level n costs n, except **Dragapult level 3 costs 4**. Remaining legs after this one `r = 3 - legIndex`.
Legal iff `stamina - cost >= r`. Illegal option → `disabledReason` e.g. "Needs 4 stamina but must keep 1 for each of the 2 remaining legs".
Push discount pct: 1→5, 2→12, 3→20; Yoko level 3 → 24; Dragapult level 3 → 30; Corsola leg 2 level 1 → 12.
Yoko+Dragapult level 3 → max(24, 30) = 30 (DECISIONS D-04).

## Resolution order (one leg)
1. **Speed discount** (integer pct, additive, cap 50): push pct + Bianca 15 (weather strong_currents) + Gomez 10 (shortcut)
   + Dragapult 10 (all routes) + Drifblim 10 (push ≥2) + Basculegion 10 (gapStart ≥ 70) + Ceruledge 15 (leg 3 & push 3).
   Record each source in `discountSources`. `speedSavingsCs = baseS * min(50, sum)`.
2. **Weather delay** (route column): currents 3/6 s, fog 4/7 s. Cancellations first: Jellicent zeroes currents;
   Chandelure zeroes fog. Then Gengar: if delay > 0 and `!flags.gengarWeatherUsed` → delay 0, consume flag. Then Divina halves
   currents (partial reducer). Result in Cs.
3. **Egg collect delay**: `collect` (only possible with a real egg) → +5 s; provisional points = tier points (+1 Sableye on rare/legendary).
4. **Crash** (shortcut only): `crashOccurred = draws.crash < leg.shortcutCrashP`. If crash:
   * Rowan & `!rowanCrashUsed` → consume; fully negated: no HP, no time, no gap, **no egg-failure roll**. `crashNegatedBy='rowan'`.
   * else Xavier & `!xavierCrashUsed` → consume; HP 0 and time 0; gap −25 still applies (unless Trevenant); egg failure still rolls.
     `crashNegatedBy='xavier'`.
   * else HP −10; time 8 − 3 (Ajax) − 4 (Marowak), clamped ≥ 0.
   * gap loss 25 unless Trevenant (or Rowan negation).
   * egg failure (if eggAttempted and not Rowan-negated): `draws.eggFailure < 0.25` → lose provisional points, keep +5 s.
   Flags are consumed by the first crash of the race even if a later crash happens (Xavier/Rowan only cover the first crash).
5. **Gap** from `gapStart = state.pursuitGapM`: deltas route (+10 safe / −15 shortcut), Misdreavus +10 (shortcut),
   push3 +10 (selected level 3, incl. Dragapult), Kent +15 (leg 2), crash −25 (if applicable), fog −10 (heavy_fog & shortcut).
   Decidueye on leg 3: every negative delta is recorded with `negatedBy:'decidueye'` and contributes 0.
   `gapBeforeCatch = gapStart + Σ applied deltas` (each effect once).
6. **Hyde**: if `gapBeforeCatch <= 0` → catch (`proximity`), no random draw used (`hydeProbability=null`).
   Else safe → no catch. Else shortcut: `p = leg.shortcutHydeBaseP + gapRisk(gapBeforeCatch) + (fog ? .15 : 0)
   − (Wednesday & fog ? .15 : 0) − (Dusknoir & fog ? .10 : 0)`; then Froslass `p *= .85`; clamp [0, .95]; catch iff `draws.hyde < p`.
   gapRisk: `<40` → .15, `<70` → .05, else 0. At most one catch per leg.
7. **Catch effects**: catchCount+1. If it becomes 2 → DNF (`second_catch`) with NO catch penalties (no time/HP/egg loss,
   no gap reset; `gapEndM = gapBeforeCatchM`) — DECISIONS D-13.
   If first: (consume `firstCatchResolved`) Aegislash → no HP/time/egg loss. Otherwise HP −35, time +10 s (Morticia: 5 s total),
   egg loss `floor(unbanked * 0.5)` unless Dhelmise. Surviving first catch → gap = 30 m.
8. **HP**: hp ≤ 0 → DNF (`hp_depleted`).
9. **Time**: `raw = base − savings + weather + crash + egg + hyde`; `total = max(1000, raw)`; `floorAdjustment = total − raw`.
   Add total to `totalSimulatedTimeCs` (DNF legs included in the descriptive time but DNF score is 0).
10. **Banking / advance**: survived → banked += unbanked, unbanked = 0, stamina −= cost, legIndex+1, phase awaiting_route;
    if this was leg 3 → status completed, phase complete, finalEggPoints (Gholdengo floor(banked×1.25)), finalScore.
    DNF → status dnf, phase complete, finalScore 0, finalEggPoints 0, unbanked eggs not banked, stamina still deducted.

## Required tests (tests/unit/game/*.test.ts)
All 216 pairings complete + DNF paths without exception; egg tables sum to 1 and empirical frequencies (fixed seeds, n≥20k) within ±1.5 pp;
stamina legality incl. Dragapult 4-cost and Enid; safe route never rolls but proximity catch works; one catch per leg; 30 m reset;
second-catch DNF; 1-point egg loses 0 on first catch; rare (3)→ loses 1; Sableye rare (4)→ loses 2; no-egg collect rejected;
Eugene offers stable before/after prepare; Gengar one use and not consumed by zero delay; Xavier vs Rowan precedence (+Trevenant,
+Marowak, +Ajax); Aegislash still counts the catch (second catch DNF); Morticia +5; Dhelmise; Decidueye pre-existing ≤0 gap
still catches; Froslass after flat; Wednesday/Dusknoir only in fog; discount cap 50; floor adjustment reconstruction;
Gholdengo floor; negative scores allowed; leaderboard tiebreak order; same seed + decisions → identical resolutions (A10);
stale revision / wrong phase rejected; inputs never mutated.
