# Design Review: Escape from Raven Island: The Hyde's Regatta (rules v2.5)

Reviewer role: game design (verification, edge cases, wording). **No rule math or roster changes are proposed.**
Sources: `docs/RULES_SPEC.md`, `docs/DECISIONS.md`, `src/game/constants.ts`, `src/game/types.ts`.
Companion file: `src/game/copy.ts` (all player-facing strings referenced in section 4).

---

## 0. Findings at a glance

| # | Finding | Type | Reference |
|---|---|---|---|
| F-1 | Whether the **second (DNF) catch** applies +10 s / −35 HP / egg loss is ambiguous. That changes `totalSimulatedTimeCs` on DNF legs. | **Spec ambiguity, needs a decision** | RULES_SPEC step 7 ("no further penalties needed but record") vs step 9 (`+ hyde` in time) and D-09 |
| F-2 | The Morticia wording "time +10 s (Morticia +5 s)" can be read as either 5 s total or 15 s total. | Spec wording | RULES_SPEC step 7 vs `CHARACTERS.morticia.shortAbility` "+5 s, not +10 s" |
| F-3 | The Gengar cancellation order (Jellicent/Chandelure first) can never apply, because all three are **Pokémon** and a player has only one. | Dead rule / test requirement can't be met | RULES_SPEC step 2, D-06, Required tests line "Gengar one use and not consumed by zero delay" |
| F-4 | "Xavier vs Rowan precedence (+Ajax)" can't happen: Xavier, Rowan and Ajax are all **characters**. | Dead rule / test requirement can't be met | RULES_SPEC step 4, Required tests line 107 |
| F-5 | The 10 s **time floor can't be reached** with the locked numbers. The shortest possible leg is 34 s × 50 % = 17.00 s. | Can't be reached | RULES_SPEC step 9, `RULE_CONFIG.minLegTimeS` |
| F-6 | **`hp_depleted` can't be reached.** The most HP you can lose before a second catch is 3 crashes × 10 + 1 catch × 35 = 65, so HP stays at 35 or more. HP is display-only. | Can't be reached | RULES_SPEC step 8, `DnfReason` |
| F-7 | The **0.95 Hyde clamp can't be reached**. The highest possible p is 0.35 + 0.15 + 0.15 = 0.65. | Can't be reached | RULES_SPEC step 6, `MAX_HYDE_P` |
| F-8 | **Collect is strictly dominant** (+100 score per point vs 5 s, and collecting never changes catch risk), so Collect/Skip is a non-choice. | Balance note (descriptive) | `EGG_COLLECT_DELAY_S`, score formula |
| F-9 | **Taking a shortcut while uncaught can never DNF.** "Shortcut until caught once, then Safe" has 0 % DNF risk. | Balance note (descriptive) | steps 6–7 |
| F-10 | The `disabledReason` template breaks grammatically for r = 1 ("1 remaining legs") and makes no sense for r = 0. | Copy bug | RULES_SPEC "Stamina" example string |
| F-11 | The pursuit gap has **no upper cap** (Safe from 100 m → 110 → 120 → 130). This is probably intended, but it isn't stated. | Unspecified | RULES_SPEC step 5 |
| F-12 | `gapEndM` on a DNF leg and `crashProbability` on a Safe leg are unspecified. | Unspecified (telemetry only) | `LegResolution` |
| F-13 | Probabilities are floats. A draw exactly equal to p (e.g. 0.50) depends on float rounding. Regression draws below are kept at least 0.01 away from every threshold. | Test hygiene | RULES_SPEC "Probabilities" |

Details and recommended resolutions are in section 1.3.

---

## 1. Edge-case audit (regression-test oracle)

### 1.1 Conventions

* Unless stated otherwise, each case starts a **fresh race at leg 1**: HP 100, stamina 6 (Enid 7), gap 100 m, catches 0, banked 0, time 0, all flags false.
* "Neutral" partners have no effect inside a leg. **Eugene** (character: information only) and **Gholdengo** (Pokémon: final multiplier only) are used as neutral partners.
* Draws are given as `crash / eggFailure / hyde`. A roll fires iff `draw < p`. Draws not consumed by the rules are listed anyway, to prove they are ignored.
* Time line: `base − savings + weather + crash + egg + hyde (+ floor 0)`. Values are in seconds to 2 dp (the engine uses Cs = ×100). `savingsCs = baseS × pct`.
* Gap line: `gapStart + Σ applied deltas = gapBeforeCatch → gapEnd`.
* "Second-catch" legs use **reading A (literal: no penalties applied on the DNF catch)**. Reading B values are given in brackets. See F-1.

### 1.2 Cases

**EC-01: Xavier + Trevenant, first crash with egg failure (L1)**
Clear, Shortcut, push 2, offer rare, collect. Draws 0.05 / 0.10 / 0.99.
* Discount 12 % → savings 35 × 12 = 420 cs = 4.20 s. Weather 0. Egg +5 s, provisional 3.
* Crash: 0.05 < 0.20 → yes. Xavier flag unused → consumed. HP loss 0, crash time 0, `crashNegatedBy='xavier'`. Gap −25 is recorded with `negatedBy:'trevenant'` and contributes 0. Egg failure **still rolls**: 0.10 < 0.25 → `eggFailed=true`, provisional → 0, the +5 s stays.
* Gap: 100 − 15 = **85**. Hyde p = 0.15 + 0 + 0 = **0.15**. 0.99 → no catch.
* Time = 35 − 4.20 + 0 + 0 + 5 + 0 = **35.80 s**. HP 100, stamina 4, banked 0, gap 85, `xavierCrashUsed=true`.

**EC-02: Xavier + Trevenant, second crash (L2, continues EC-01)**
Strong currents, Shortcut, push 1, offer legendary, collect. Draws 0.10 / 0.50 / 0.30.
* Discount 5 % → 38 × 5 = 190 cs = 1.90 s. Weather (shortcut currents) 6 s. Egg +5 s, provisional 6.
* Crash: 0.10 < 0.30 → yes. Xavier already used → HP −10, time +8 s. Trevenant cancels the −25. Egg failure 0.50 ≥ 0.25 → kept.
* Gap: 85 − 15 = **70**. gapRisk(70) = 0 (70 is not < 70). p = **0.25**. 0.30 → no catch.
* Time = 38 − 1.90 + 6 + 8 + 5 = **55.10 s**. HP 90, stamina 3, banked 6, gap 70. Running total **90.90 s**.

**EC-03: Xavier + Trevenant, leg 3 completion (continues EC-02)**
Heavy fog, Shortcut, push 3 (stamina 3 − 3 = 0 ≥ 0, legal), offer rare, collect. Draws 0.30 / 0.10 / 0.50.
* Discount 20 % → 34 × 20 = 680 cs = 6.80 s. Fog shortcut 7 s. Egg +5 s, provisional 3.
* Crash: 0.30 < 0.40 → yes. HP −10 → 80, +8 s. Trevenant cancels the gap loss. Egg failure 0.10 < 0.25 → lost (provisional 0).
* Gap: 70 − 15 + 10 (push3) − 10 (fog) = **55** → gapRisk 0.05. p = 0.35 + 0.05 + 0.15 = **0.55**. 0.50 → **catch (roll, first)**. HP −35 → 45, +10 s, egg loss floor(0 × 0.5) = 0. Gap → 30.
* Time = 34 − 6.80 + 7 + 8 + 5 + 10 = **57.20 s**. Total **148.10 s**. Completed, banked 6, final egg points 6.
* **finalScore = (6 × 10000 − 14810) / 100 = 451.90.**

**EC-04: Ajax + Alolan Marowak crash with no egg (L1)**
Clear, Shortcut, push 1, offer none, skip. Draws 0.00 / 0.00 / 0.90.
* Discount 5 % → 1.75 s. Crash 0.00 < 0.20 → HP −10 → 90. Crash time = max(0, 8 − 3 − 4) = **1 s**. `eggAttempted=false`, so **no egg-failure roll** (the 0.00 draw is ignored).
* Gap: 100 − 15 − 25 = **60** → gapRisk 0.05. p = **0.20**. 0.90 → no catch.
* Time = 35 − 1.75 + 1 = **34.25 s**. Stamina 5.
* Related check: Xavier + Marowak. The first crash costs 0 s (Xavier). The second crash costs 8 − 4 = **4 s**.

**EC-05: Rowan + Gholdengo, collected egg and crash, then caught anyway (L1)**
Heavy fog, Shortcut, push 2, offer rare, collect. Draws 0.01 / 0.00 / 0.20.
* Discount 12 % → 4.20 s. Fog 7 s. Egg +5 s, provisional 3.
* Crash 0.01 < 0.20 → `crashOccurred=true`, `crashNegatedBy='rowan'`, `rowanCrashUsed=true`. No HP, no time, the gap delta is recorded with `negatedBy:'rowan'` (0), and **no egg-failure roll** (draw 0.00 ignored, `eggFailed=false`).
* Gap: 100 − 15 − 10 = **75**. p = 0.15 + 0 + 0.15 = **0.30**. 0.20 → **catch (roll, first)**. HP 65, +10 s, egg loss floor(3 × 0.5) = **1** → unbanked 2. Gap → 30.
* Time = 35 − 4.20 + 7 + 0 + 5 + 10 = **52.80 s**. Stamina 4, banked 2, catches 1.

**EC-06: Rowan's shield is spent; post-reset crash becomes a proximity DNF (L2, continues EC-05)**
Clear, Shortcut, push 1, offer rare, collect. Draws 0.05 / 0.90 / 0.99.
* Discount 5 % → 1.90 s. Egg +5 s, provisional 3. Crash 0.05 < 0.30 → Rowan used → HP −10 → 55, +8 s, gap −25. Egg kept (0.90).
* Gap: 30 − 15 − 25 = **−10** → **proximity catch**, `hydeProbability=null`, hyde draw ignored. Catch #2 → **DNF `second_catch`**.
* Time = 38 − 1.90 + 8 + 5 = **49.10 s** [B: 59.10 s; HP 20]. Total **101.90 s** [B: 111.90]. finalScore 0, finalEggPoints 0, stamina 4 → 3 (deducted on DNF, D-08). Unbanked 3 is not banked.

**EC-07: Yoko + Dragapult, push 3 (L1)**
Clear, Shortcut, push 3, offer common, collect. Draws 0.50 / 0.50 / 0.90.
* Push pct = max(24, 30) = 30 (D-04), plus Dragapult all-route 10 → **40 %** → 35 × 40 = 1400 cs = 14.00 s. Cost **4** → stamina 6 − 4 = 2 (legal: 2 ≥ r = 2).
* Gap: 100 − 15 + 10 (push3) = **95**. p 0.15 → no catch.
* Time = 35 − 14.00 + 5 = **26.00 s**. Banked 1.
* Leg 2 push options with stamina 2: push 1 legal (2 − 1 = 1 ≥ 1). Push 2 illegal (0 < 1). Push 3 illegal (cost 4).

**EC-08: Bianca + Dragapult, discount cap (L1)**
Strong currents, Shortcut, push 3, offer rare, collect. Draws 0.90 / 0.90 / 0.90.
* Sources: push 30 + Bianca 15 + Dragapult 10 = 55 → **cap 50 %** → 35 × 50 = 1750 cs = 17.50 s. Currents shortcut 6 s.
* Gap 95, p 0.15 → no catch. Time = 35 − 17.50 + 6 + 5 = **28.50 s**. Stamina 2.
* Bianca + Dragapult in currents is the **only pairing that goes over the cap**. Gomez + Dragapult (shortcut, push 3) and Bianca + Ceruledge (L3, currents, push 3) hit exactly 50.

**EC-09: Divina + Gengar, currents twice (L1 → L2)**
L1: currents, Shortcut, push 1, offer rare, **skip**. Draws 0.90 / – / 0.90.
* Savings 1.75 s. Weather 6 s → Gengar (delay > 0, unused) → 0, flag consumed. Divina halves 0 → 0. No egg delay.
* Gap 85, p 0.15 → no catch. Time = **33.25 s**. Stamina 5.

L2: currents, **Safe**, push 2, offer common, collect.
* Savings 55 × 12 = 6.60 s. Safe currents 3 s → Gengar spent → Divina halves → **1.50 s** (150 cs). Egg +5 s.
* Gap 85 + 10 = 95 (Safe: no roll). Time = 55 − 6.60 + 1.50 + 5 = **54.90 s**. Total **88.15 s**. Stamina 3, banked 1.

**EC-10: Gengar wasted on a Safe leg; clear weather does not consume it (Eugene + Gengar)**
* Variant a: L1 clear (any route). Delay 0, so `gengarWeatherUsed` **stays false**.
* Variant b: L1 currents, Safe, push 1, common, collect. Safe currents 3 s → Gengar zeroes it and is consumed. Time = 48 − 2.40 + 0 + 5 = **50.60 s**, gap 110.
  L2 heavy fog, Shortcut, push 2, rare, collect, draws 0.90 / 0.90 / 0.90. Fog **7 s is now paid**. Gap 110 − 15 − 10 = 85, p = 0.25 + 0 + 0.15 = 0.40, no catch. Time = 38 − 4.56 + 7 + 5 = **45.44 s**. Total 96.04 s, banked 4.
* Design note: Gengar burns on the *first* nonzero delay, even a 3 s Safe one. The trait card should say this (see copy note in section 4).

**EC-11: Jellicent in currents; gap exactly 70 (L2, from gap 85)**
Eugene + Jellicent. Currents, Shortcut, push 2, offer legendary, collect. Draws 0.90 / 0.90 / 0.26.
* Savings 38 × 12 = 4.56 s. Currents zeroed by Jellicent. Gengar is not involved (it can't be paired with Jellicent, see F-3).
* Gap 85 − 15 = **70** → gapRisk 0. p = **0.25**. 0.26 → no catch.
* Time = 38 − 4.56 + 0 + 5 = **38.44 s**. Banked +6, gap 70.
* Variant: **Bianca + Jellicent**. Bianca's +15 still applies (the weather is still currents): 27 % → 10.26 s → time **32.74 s**.
* Variant: **Divina + Jellicent**. Half of 0 = 0, time 38.44 s.
* Follow-on: with **Basculegion** (not Jellicent), a leg-3 gapStart of exactly 70 qualifies (≥ 70) for +10 %.

**EC-12: Chandelure in fog (L1)**
Eugene + Chandelure. Fog, Shortcut, push 2, common, collect. Draws 0.90 / 0.90 / 0.31.
* Fog delay → 0. **Fog gap −10 and fog risk +0.15 still apply.** Gap 75, p 0.30, 0.31 → no catch.
* Time = 35 − 4.20 + 0 + 5 = **35.80 s**.

**EC-13: Decidueye, leg 3 shortcut in fog with a crash, then caught**
Eugene + Decidueye. State at L3: gap 60 (L1 clean shortcut 85, L2 shortcut fog 60), catches 0, HP 100, stamina 2, banked 4, total time 100.00 s.
Fog, Shortcut, push 2, offer legendary, collect. Draws 0.10 / 0.30 / 0.40.
* Savings 34 × 12 = 4.08 s. Fog 7 s. Egg +5 s, provisional 6.
* Crash 0.10 < 0.40 → HP −10 → 90, +8 s. Egg failure 0.30 ≥ 0.25 → kept.
* Gap deltas: route −15, crash −25 and fog −10 are **all recorded with `negatedBy:'decidueye'`** and contribute 0. gapBeforeCatch = **60** → gapRisk 0.05. p = 0.35 + 0.05 + 0.15 = **0.55** (Decidueye removes gap loss, not the fog risk). 0.40 → **catch (first)**. HP 55, +10 s, egg loss floor(6 × 0.5) = 3. Gap → 30.
* Time = 34 − 4.08 + 7 + 8 + 5 + 10 = **59.92 s**. Total 159.92 s. Completed, banked 4 + 3 = 7.
* **finalScore = (70000 − 15992)/100 = 540.08.**
* Variant: hyde 0.60 → no catch. Time 49.92 s, banked 10, score (100000 − 14992)/100 = **850.08**.

**EC-14: Decidueye turns a certain DNF into a coin flip (L3, already caught once)**
Eugene + Decidueye. State at L3: gap 30, catches 1, HP 65, stamina 3, banked 3.
Clear, Shortcut, push 1, rare, collect. Draws 0.10 / 0.90 / 0.60.
* Savings 1.70 s. Crash → HP 55, +8 s. Deltas −15 and −25 are both negated → gapBeforeCatch **30** → gapRisk 0.15. p = **0.50**. 0.60 → no catch.
* Time = 34 − 1.70 + 8 + 5 = **45.30 s**. Completed, banked 6, gap 30.
* hyde 0.40 → catch #2 → **DNF**, time 45.30 s [B: 55.30 s].
* Without Decidueye, the same draws give 30 − 15 − 25 = −10 → proximity → certain DNF.

**EC-15: Aegislash first catch, then second catch (Eugene + Aegislash)**
L1: clear, Shortcut, push 2, rare, collect. Draws 0.90 / 0.90 / 0.10.
* Gap 85, p 0.15, 0.10 → **catch (first)**. Aegislash: HP 0, time 0, egg loss 0. **The catch still counts** (catches = 1, `firstCatchResolved=true`). Gap still **resets to 30** (step 7, "surviving first catch").
* Time = 35 − 4.20 + 5 = **35.80 s**. HP 100, banked 3, stamina 4.

L2: clear, Shortcut, push 1, rare, collect. Draws 0.90 / 0.90 / 0.30.
* Gap 30 − 15 = 15 → gapRisk 0.15. p = **0.40**. 0.30 → catch #2 → **DNF `second_catch`**.
* Time = 38 − 1.90 + 5 = **41.10 s** [B: 51.10 s]. Total **76.90 s** [B: 86.90]. Score 0, stamina 3.

**EC-16: Morticia + Aegislash vs Morticia + Gholdengo (L2, from gap 85, banked 1, stamina 4)**
Fog, Shortcut, push 2, legendary, collect. Draws 0.90 / 0.90 / 0.30.
* Gap 85 − 15 − 10 = 60 → gapRisk 0.05. p = 0.25 + 0.05 + 0.15 = **0.45** → catch (first).
* **Aegislash takes priority**: hyde delay 0 (Morticia's ability is redundant here), HP 100, egg kept. Time = 38 − 4.56 + 7 + 5 = **45.44 s**. Banked 7, gap 30.
* **Morticia + Gholdengo**: hyde delay **5 s** (reading of F-2), HP 65, egg loss 3. Time **50.44 s**. Banked 1 + 3 = 4, gap 30.

**EC-17: Dhelmise with a rare egg (L1)**
Eugene + Dhelmise. Fog, Shortcut, push 2, rare, collect. Draws 0.90 / 0.90 / 0.25.
* Gap 75, p 0.30, 0.25 → catch (first). HP 65, +10 s, **egg loss 0** (Dhelmise). Gap 30.
* Time = 35 − 4.20 + 7 + 5 + 10 = **52.80 s**. Banked 3.
* Variant: crash draw 0.10 and eggFailure 0.10. The crash egg failure is **not** protected by Dhelmise, so the egg is lost (provisional 0). Time +8 s → 60.80 s, HP 55, gap 75 − 25 = 50 → p = 0.15 + 0.05 + 0.15 = 0.35 (0.25 → still a catch).

**EC-18: Basculegion before and after a first-catch reset (full race, Eugene + Basculegion)**
* L1: clear, Shortcut, push 2, rare, collect. Draws 0.90 / 0.90 / 0.05. gapStart 100 ≥ 70 → +10 → **22 %** → 35 × 22 = 770 cs = 7.70 s. Gap 85, p 0.15 → **catch**: HP 65, +10 s, egg loss 1 → banked 2. Gap → 30.
  Time = 35 − 7.70 + 5 + 10 = **42.30 s**. Stamina 4.
* L2: clear, Safe, push 2, common, collect. gapStart 30 < 70 → **no Basculegion**. 12 % → 6.60 s. Time = 55 − 6.60 + 5 = **53.40 s**. Gap 40, banked 3, stamina 2.
* L3: clear, Safe, push 2 (2 − 2 = 0 ≥ 0), offer none, skip. gapStart 40 → no bonus. 46 × 12 = 5.52 s. Time **40.48 s**. Gap 50.
* Total **136.18 s**. Banked 3. **finalScore = (30000 − 13618)/100 = 163.82.** HP 65.

**EC-19: Kent leg-2 lead (L2, from gap 85, stamina 4)**
Kent + Gholdengo. Fog, Shortcut, **push 3** (4 − 3 = 1 ≥ 1, legal), rare, collect. Draws 0.20 / 0.90 / 0.50.
* Savings 38 × 20 = 7.60 s. Fog 7 s. Egg +5 s. Crash 0.20 < 0.30 → HP 90, +8 s, gap −25. Egg kept.
* Gap: 85 − 15 + 10 (push3) + 15 (Kent) − 25 − 10 = **60** → gapRisk 0.05. p = **0.45**. 0.50 → no catch.
* Time = 38 − 7.60 + 7 + 8 + 5 = **50.40 s**. Stamina 1, gap 60, banked +3.
* Without Kent the gap would be 45. The p is the same (still in the 40–69 band), but leg 3 starts 15 m safer.

**EC-20: Galarian Corsola, leg 2 push 1**
Eugene + Corsola. L2 clear, Safe, push 1, common, collect.
* `getPushOptions` level 1: `pushDiscountPct 12`, `staminaCost 1`. Savings 55 × 12 = **6.60 s** (vs 2.75 s normally). No push3 gap bonus (it is still level 1).
* Time = 55 − 6.60 + 5 = **53.40 s**. Gap +10.
* Corsola L1/L3 push 1 → 5 % (no bonus). Corsola L2 push 2 → 12 % (no extra benefit).

**EC-21: Sableye with egg failure (L2, from gap 85)**
Eugene + Sableye. Clear, Shortcut, push 2, legendary, collect. Draws 0.10 / 0.20 / 0.90.
* Provisional 6 + 1 = **7**. Crash → HP 90, +8 s. Egg failure 0.20 < 0.25 → provisional **0** (+5 s stays).
* Gap 85 − 15 − 25 = 45 → gapRisk 0.05. p **0.30** → no catch.
* Time = 38 − 4.56 + 8 + 5 = **46.44 s**. Banked +0, gap 45.
* Variant (L1, required test): clear, Shortcut, push 2, rare, collect, draws 0.90 / 0.90 / 0.05 → catch. Provisional 4 → loss floor(4 × 0.5) = **2** → banked 2. Time 35 − 4.20 + 5 + 10 = **45.80 s**, HP 65.

**EC-22: Gholdengo floor (final multiplier only applies when completed)**

| banked | ×1.25 | finalEggPoints |
|---|---|---|
| 0 | 0 | 0 |
| 1 | 1.25 | 1 |
| 2 | 2.5 | 2 |
| 3 | 3.75 | 3 |
| 4 | 5.0 | 5 |
| 5 | 6.25 | 6 |
| 6 | 7.5 | 7 |
| 7 | 8.75 | 8 |
| 9 | 11.25 | 11 |
| 15 (max raw) | 18.75 | 18 |

Example: banked 7, total 120.00 s → (8 × 10000 − 12000)/100 = **680.00**. On a DNF, finalEggPoints is 0 whatever the bank. All ×1.25 products of integers are exact binary fractions, so `Math.floor` is safe.

**EC-23: Enid stamina 7, legal push sequences (non-Dragapult)**
Rule: legal iff `stamina − cost ≥ 3 − leg`. L1 allows every level (7 − 3 = 4 ≥ 2). L2 allows every level after any L1 choice (7 − 3 − 3 = 1 ≥ 1). L3 requires a + b + c ≤ 7.
* **23 legal sequences**: 111, 112, 121, 211, 113, 131, 311, 122, 212, 221, 123, 132, 213, 231, 312, 321, 222, 133, 313, 331, 223, 232, 322.
* **Illegal (4)**: 233, 323, 332 (blocked at L3: the push-3 button is disabled) and 333.
* Enid is the only character who can push 3 **twice** (133 / 313 / 331), which is worth **+20 m** of lead. Example: Enid + Gholdengo, L1 and L2 clean shortcuts with push 3 → gap 100 → 95 → 90, stamina 7 → 4 → 1, L3 push 1 only.
* For comparison, standard stamina 6 has **17 legal sequences** (sum ≤ 6). After an L1 push 3, the L2 push 3 is disabled (3 − 3 = 0 < 1).
* **Enid + Dragapult** (push-3 cost 4, so costs {1, 2, 4}): 17 legal (111, 112, 121, 211, 122, 212, 221, 222, 114, 141, 411, 124, 142, 214, 241, 412, 421). Dragapult alone (stamina 6): 11 legal (111, 112, 121, 211, 122, 212, 221, 222, 114, 141, 411).

**EC-24: Dragapult push-3 legality matrix (cost 4)**

| Leg (r) | Needs stamina ≥ | Standard (6) start-of-leg stamina → legal? | Enid (7) |
|---|---|---|---|
| L1 (2) | 6 | 6 → **legal** | 7 → legal |
| L2 (1) | 5 | after L1 p1: 5 → **legal**; after p2: 4 → **illegal**; after p3: 2 → illegal | after p1: 6 legal; p2: 5 **legal**; p3: 3 illegal |
| L3 (0) | 4 | after 1+1: 4 → **legal**; 1+2 / 2+1: 3 → illegal; 2+2: 2 → illegal | 1+1: 5 legal; 1+2 / 2+1: 4 **legal**; 2+2: 3 illegal |

Dragapult can never push 3 twice, not even with Enid (after an L1 push 3, Enid has 3 < 5). For comparison, non-Dragapult push 3 needs ≥ 5 / ≥ 4 / ≥ 3 at L1 / L2 / L3.

**EC-25: Wednesday + Froslass in fog: Froslass applies after the flat modifiers (L3)**
State at L3: gap 35 (L1 shortcut crash + fog → 50; L2 clean shortcut → 35), catches 0, HP 90, stamina 2.
Fog, Shortcut, push 1, common, collect. Draws 0.90 / 0.90 / **0.41**.
* Gap 35 − 15 − 10 = **10** → gapRisk 0.15. p = (0.35 + 0.15 + 0.15 − 0.15) × 0.85 = 0.50 × 0.85 = **0.425** → 0.41 → **catch**.
  If Froslass were wrongly applied before Wednesday: 0.65 × 0.85 − 0.15 = 0.4025 → 0.41 would **not** catch. This draw separates the two orders.
* HP 55, +10 s, egg loss floor(0.5) = 0. Time = 34 − 1.70 + 7 + 5 + 10 = **54.30 s**. Completed, banked +1, gap 30.

**EC-26: Wednesday + Dusknoir in fog (L1)**
Fog, Shortcut, push 2, rare, collect. Gap 75 → p = 0.15 + 0 + 0.15 − 0.15 − 0.10 = **0.05**.
* hyde 0.06 → no catch, time 35 − 4.20 + 7 + 5 = **42.80 s**.
* hyde 0.04 → catch, **52.80 s**, HP 65, banked 2, gap 30.
* In currents or clear weather, neither ability does anything (p = 0.15).

**EC-27: Proximity catch with no random draw (L2, from gap 50)**
Eugene + Gholdengo. State: gap 50 (L1 shortcut crash + fog), HP 90, stamina 4, catches 0.
Fog, Shortcut, push 1, common, collect. Draws 0.10 / 0.90 / **0.00** (ignored).
* Crash → HP 80, +8 s. Gap 50 − 15 − 25 − 10 = **0** → proximity catch, `hydeProbability=null`, `catchType='proximity'`.
* First catch → HP 45, +10 s, egg loss floor(1 × 0.5) = 0. Gap 30.
* Time = 38 − 1.90 + 7 + 8 + 5 + 10 = **66.10 s**. Banked +1.

**EC-28: Push 3 does not save a post-reset crash (L2, from gap 30, catches 1, stamina 4)**
Clear, Shortcut, push 3 (4 − 3 = 1, legal), rare, collect, crash 0.10.
* Gap 30 − 15 + 10 − 25 = **0** → proximity → **DNF**. Time = 38 − 7.60 + 8 + 5 = **43.40 s** [B: 53.40 s].
* Same draws with **Misdreavus**: 30 − 15 + 10 + 10 − 25 = 10 → roll p = 0.25 + 0.15 = **0.40**.
* Same draws with **Trevenant**: 30 − 15 + 10 = 25 → p **0.40**.

**EC-29: Gomez + Ceruledge, leg 3 push 3 (from gap 70, stamina 3)**
Clear, Shortcut, push 3, legendary, collect. Draws 0.90 / 0.90 / 0.50.
* Discount 20 + 10 (Gomez) + 15 (Ceruledge) = **45 %** → 34 × 45 = 1530 cs = 15.30 s.
* Gap 70 − 15 + 10 = 65 → gapRisk 0.05. p **0.40** → no catch.
* Time = 34 − 15.30 + 5 = **23.70 s**. Banked +6, stamina 0.
* Ceruledge with L3 push 2 → 12 % only. Ceruledge with L1/L2 push 3 → no bonus.

**EC-30: Rejections and visibility (non-numeric)**
* `collect` when `selectedOffer === 'none'` → `NO_EGG_TO_COLLECT`. State is unchanged and the revision is not incremented.
* Eugene: `visibleOffers` has both routes in `awaiting_route` **and** in `awaiting_egg`. The values are identical before and after prepare.
* Non-Eugene: `{}` in `awaiting_route`, then `{ [route]: offer }` in `awaiting_egg`.
* Safe route with any draws: `hydeProbability=null`, no crash, no fog gap loss. The crash draw is not consumed (record `crashProbability` as 0, see F-12).

### 1.3 Contradictions, ambiguities and dead rules (not silently fixed)

**F-1: Second-catch penalties (needs a product decision).**
RULES_SPEC step 7: "If it becomes 2 → DNF (`second_catch`); no further penalties needed but record." Step 9 still adds `hyde` to the leg time, and D-09 adds DNF leg time to `totalSimulatedTimeCs`. The spec does not say whether `catchHpLoss`, `hydeDelayCs` and `eggPointsLostToCatch` are 0 or 35 / 1000 / floor(½) on the DNF catch. This changes the stored time on every second-catch DNF (EC-06, 14, 15, 28).
*Recommendation:* use reading A (no penalties, record `catchNumber: 2` only) and state it in DECISIONS as D-13. The score is 0 either way, so only telemetry is affected.

**F-2: Morticia wording.** Step 7 says "time +10 s (Morticia +5 s)". Read on its own, "+5 s" could mean an extra 5 s (15 s total). `constants.ts` says "First Hyde catch costs +5 s, not +10 s", and the field is `CATCH.morticiaDelayS: 5`. The cases above use **5 s total**. *Recommendation:* reword step 7 to "time +10 s (Morticia: +5 s instead)".

**F-3: Gengar / Jellicent / Chandelure ordering is dead.** All three are Pokémon, so they can never be paired. The "cancellations first" clause in step 2 and D-06 can only be tested with a hand-built state. In real play, "Gengar not consumed by zero delay" can only happen through **clear weather** (EC-10a). The brief's "Gengar + Jellicent currents" case can't happen in play either. EC-09 and EC-11 cover the reachable parts (Divina + Gengar, Divina/Bianca + Jellicent).

**F-4: Xavier vs Rowan precedence is dead.** Both are characters, as is Ajax. The "+Ajax" part of "Xavier vs Rowan precedence (+Trevenant, +Marowak, +Ajax)" in Required tests can't happen for either of them. The reachable combinations are Xavier/Rowan × Trevenant/Marowak, plus Ajax × Marowak (EC-01–EC-06).

**F-5 / F-6 / F-7: Bounds that can't be reached.**
* The time floor (10 s) never applies: the lowest leg time is 34 × 0.5 = 17.00 s. "Floor adjustment reconstruction" therefore needs a hand-built `LegDef`/config.
* `hp_depleted` can't happen: worst completed HP is 100 − 30 − 35 = 35.
* The Hyde clamp at 0.95 can't be hit (max 0.65).
* Decidueye's pre-existing ≤ 0 gap can't happen (already noted in D-10).

**UX implication of F-6:** HP never ends a run. Present it as hull damage or flavour, and don't let players believe HP is a survival meter.

**F-10: `disabledReason` template.** "must keep 1 for each of the **1 remaining legs**" is ungrammatical, and at L3 (r = 0) a block is only ever caused by stamina < cost. `formatStaminaDisabledReason()` in `copy.ts` gives correct wording for both cases. Wiring it in is up to the rules/UI owner.

**F-11: No gap ceiling.** A Safe-heavy run gets 110 / 120 / 130 m. This is harmless (Basculegion stays active) but should be confirmed as intended.

**F-12: Unspecified telemetry fields.** The spec doesn't define `gapEndM` on a DNF leg (suggest `gapBeforeCatchM`), `crashProbability` on Safe (suggest 0), or how `discountSources` should label the Yoko/Dragapult `max` (suggest a single `push` entry of 30 plus `dragapult` 10).

**F-13: Float thresholds.** Example: 0.35 + 0.15 evaluates to exactly 0.5 in IEEE-754, but other sums may land 1 ulp either side. Keep regression draws at least 0.01 from p. Alternatively, an engine-internal fix is to compute p in integer basis points and compare `draw * 10000 < pBp`. That would change an engine detail, not a rule.

---

## 2. Strategy and balance read (qualitative; descriptive only)

### 2.1 Structural facts

* **One egg point = 100 score = 100 seconds.** A whole race takes roughly 90–160 s, so eggs dominate the score and time is mostly a tiebreaker.
* **Collect is strictly dominant** (F-8). The worst case for a common egg is +95, and its expected value is about +95 to +100. Collecting never changes Hyde or crash risk, so the advisor should always say Collect. The Collect/Skip screen is a moment of tension, not a real decision. That is fine for a 6-minute arcade game, but the copy should present it as an obvious grab.
* **The only way to DNF is a second catch** (F-6), and **one catch per leg** means a shortcut while uncaught can never DNF (F-9).
* **The near-dominant policy is: Shortcut + Collect while uncaught, then Safe after the first catch.** Its DNF risk is 0 %: after the reset, Safe gives 30 + 10 = 40 > 0 with no roll.
  After a catch, a shortcut on the next leg is a bad bet. From 30 m on L3, P(catch) = 0.45 × 0.50 + 0.15 × 0.65 + 0.40 × 1 = **0.7225**. That risks the whole score (≈ 300–600) to gain about 2 egg points.
* Stamina is also **lead**. Push 3 is the only player-controlled gap bonus (+10 m), and only Enid can use it twice.

### 2.2 Naive "all-shortcut, push 2, always collect" player (no gap or risk abilities)

Per-leg shortcut catch odds come from the gap tree (weather fog 0.25; crash 0.2 / 0.3 / 0.4).

* L1: p is 0.15 / 0.30 / 0.20 / 0.35 for {clean, fog, crash, crash + fog} → **P(catch L1) = 0.1975**.
* If caught on L1, L2 is run from 30 m. P(catch) = 0.606. If he survives, the gap is 15 or 5, so the L3 shortcut is a **certain proximity catch** (push 2 gives no +10). Result: DNF ≈ 100 % on this branch.
* If uncaught on L1, P(catch L2) ≈ 0.319–0.471 depending on the gap (weighted ≈ 0.2755 of all runs), followed by an L3 shortcut from 30 m (0.7225).
* **P(DNF) ≈ 0.1975 + 0.2755 × 0.7225 ≈ 0.40.** Roughly **2 in 5 naive shortcut players DNF**. Push 1 gives the same result, because only push 3 moves the gap.

### 2.3 Expected score ranges (estimates)

| Profile | Typical eggs | Typical time | Typical score | DNF |
|---|---|---|---|---|
| All Safe, push 2, collect | ~2.1 (0–3) | ~145 s | **~ +60** (range −150 … +160) | 0 % |
| Naive all-shortcut | ~6.5 when finishing | ~130 s | ~520 when finishing; **EV ~ 310–350** | ~40 % |
| "Shortcut until caught, then Safe" | ~5.2 | ~125 s | **~ 400 EV** (range ~0 … 1,400) | 0 % |
| Theoretical ceiling | 18 (Sableye R + L + L, or Gholdengo 15 → 18) | ~85 s (these Pokémon give no discount; 3 × collect = 15 s) | **~ 1,700** | n/a |

Negative scores are routine for Safe players who skip or miss eggs. The results copy should treat a negative score as dry humour, not as failure.

### 2.4 Character read

* **Strong: Rowan, Kent, Eugene.**
  * Rowan blocks −25 m, the egg-failure roll, and 8 s on the most likely crash. The crash gap is the single biggest driver of risk bands and proximity catches.
  * Kent's +15 m on L2 often moves the L3 start out of the danger band.
  * Eugene can see when the shortcut only offers a common egg (30 % on L2/L3) and take Safe at almost no cost in expected value.
* **Solid: Wednesday, Enid.**
  * Wednesday cancels the fog penalty, but only in fog (25 % of legs).
  * Enid's 7th stamina point allows two push-3s, i.e. +10 m extra lead plus speed.
* **Weak (time-only, worth ≲ 11 score per race): Bianca, Gomez, Yoko, Divina, Ajax, Morticia, Xavier.**
  * Xavier keeps the gap loss and the egg-failure roll. What he saves is 8 s plus HP, and HP is only for show.
  * Gomez is the best of the time characters (+10 % on every shortcut, ≈ 3.5 + 3.8 + 3.4 = 10.7 s per all-shortcut race).

### 2.5 Pokémon read

* **Strong:**
  * Sableye: about +0.7 points per shortcut leg. It slightly beats Gholdengo for shortcut runners.
  * Gholdengo: +25 % rounded down. It is better for commons-heavy runs.
  * Trevenant: crashes never cost gap.
  * Misdreavus: every shortcut costs 5 m instead of 15.
  * Froslass: every roll × 0.85.
  * Aegislash: a free catch, but it still counts toward the DNF.
* **Mid:**
  * Decidueye: only on L3, but it turns certain post-reset proximity DNFs into roughly 50 % rolls.
  * Dhelmise: saves 1–3 points when caught.
  * Dusknoir: fog only.
* **Weak (time-only):** Gengar, Marowak, Corsola, Jellicent, Chandelure, Drifblim, Basculegion, Ceruledge, Dragapult.
  * Dragapult's 4-cost push 3 also eats the stamina that would buy +10 m elsewhere.
* **Likely top pairings:** Rowan / Kent / Eugene with Sableye / Gholdengo / Trevenant / Misdreavus.
* **Likely bottom:** Divina / Ajax / Morticia with Gengar / Corsola / Marowak.
* Because eggs dominate, the gap between the top and bottom of the roster mostly appears as **finish rate and egg retention**, not time.
* **Dominant strategy:** yes, as described in 2.1. It is easy to explain, so the advisor's 25 % DNF cap will usually recommend it. Variance from egg tier draws keeps the leaderboard lively anyway.

---

## 3. Pacing plan (target 360 s, no forced waits)

**Principles.** Every screen advances on input. Timers exist only as idle safeguards: after 40 s without input show a "Still there?" prompt, and after a further 15 s call `abandonSession`. The advisor's Monte Carlo run (≤ 1.5 s) starts when the weather card appears, so it is ready before the player can read it.

| Screen | Budget (s) | Breakdown |
|---|---|---|
| Welcome + nickname | **30** | Tap to start 3 · nickname 15 (one-tap "Random spooky name" saves ~10) · 3 tutorial cards 12 (tap to advance; auto-advance after 6 s each; skip-all button) |
| Selection | **45** | Character grid 20 · Pokémon grid 20 · confirm 5 ("Surprise me" random pair available) |
| Leg 1 | **75** | Weather + advice 12 · route + push 20 · egg reveal (1.5 s anim) + collect 8 · **cinematic 22** · summary card 13 |
| Leg 2 | **85** | Weather + advice 10 · route + push 22 · egg 8 · **cinematic 30** · summary card 15 |
| Leg 3 | **75** | Weather + advice 8 · route + push 17 · egg 7 · **cinematic 30** · summary card 13 |
| Results | **50** | Score count-up 6 · breakdown 12 · leaderboard placement 12 · photo/QR 15 · return to attract 5 |
| **Total** | **360** | |

**Cinematics.**
* Each cinematic is a fixed base length plus event beats: crash +2.5 s, egg crack +1.5 s, Hyde catch +3.0 s, proximity catch +3.0 s, Hyde near-miss +1.5 s.

  | Leg | Base | Cap with beats |
  |---|---|---|
  | L1 | 18 s | 24 s |
  | L2 | 24 s | 30 s |
  | L3 | 24 s | 30 s (finish line + 2 s hold) |

* The race clock runs on simulated time, compressed so that it reaches `totalCs` as the bow crosses the line.
* **Skip unlocks after 2 s.** Skipping jumps to a 1.5 s outcome sting (crash / catch / escape pose) so that no information is lost.

**Summary card.** At most 4 lines, about 30–40 words, in this order:
1. Outcome line (`OUTCOME_COPY`).
2. Leg time.
3. Eggs banked.
4. Lead on Hyde and HP.

Design it for a 10–15 s read at ~3 words per second (arcade audience, standing, often children). "Continue" is active immediately.

**Throughput.** About 6.5 min per player including changeover, giving roughly 9 players per hour per station (≈ 18 per hour across `station_a` and `station_b`).

---

## 4. Player-facing copy

All strings are in `src/game/copy.ts`. It is a pure TS module whose only imports are type imports from `./types.ts`.

* Every line is ≤ 90 characters, and every tutorial body is ≤ 140.
* Numbers in the copy match `constants.ts` base values. The exact discount and stamina cost for push levels must come from `getPushOptions()` (Yoko, Dragapult and Corsola change them), so `PUSH_COPY` hints are deliberately qualitative apart from the universal push-3 "+10 m".
* Risk is phrased in "pts" (percentage points) to match the card wording in `constants.ts`.
* The copy avoids implying that HP can end a run (F-6). It names score = eggs × 100 − seconds, because that is the most important thing for a player to understand (F-8).
* Suggested trait-card clarifications (not changes to `constants.ts`; for the UI owner): Gengar → "first delay of the race, even on Safe"; Aegislash → "still counts as a catch".
* `formatStaminaDisabledReason(cost, stamina, remainingLegs)` is exported as a correct replacement for the F-10 template.
