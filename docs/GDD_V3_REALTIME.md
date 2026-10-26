# GDD v3.0-realtime: Escape from Raven Island: The Hyde's Regatta

Pokémon Day III Halloween arcade, 27 Oct 2026. This document replaces the decision race (rules v2.5) with a real-time,
third-person 3D rowing and exploration game. Data lives in `src/action/data/{characters,pokemon,stages}.ts`. The
contract is `src/action/types.ts`.

**Notation.** `[T]` = tuning default (expected to change in playtests). `[L]` = locked by the client. World units (u)
are roughly metres. Speeds are in u/s. "Gap" is the Hyde's distance behind the boat, measured **along the player's
own wake** (see 5.1). Every number in this document is mirrored in the data files. If they disagree, the data files win.

---

## 0. Pillars

1. **Rhythm beats mashing.** A steady 2.5–4 taps/s is near-optimal. Mashing hits the cadence cap and drains stamina.
2. **The Hyde is a mirror of your mistakes.** He closes when you slow down, crash or panic, and backs off when you
   row cleanly. He is always visible, and the HUD Hyde meter shows the gap even in fog.
3. **Your Pokémon is a real choice.** Each one is either a speed, safety, egg or hunt specialist. Q is always a
   decision: spend it now, or save it for the rescue window.
4. **Everyone finishes most of the time.** Mercy rules and lake assists catch struggling players. Skilled players are
   rewarded with time (score), not with immunity.

## 1. Controls and session loop

| Key | Boat (Stages 1 and 3) | On foot (Stage 2) |
|---|---|---|
| SPACE | Stroke (each tap = impulse, cadence-capped). In hold-to-row mode, holding = 2.5 strokes/s | – |
| A / D | Steer | Strafe / turn (WASD move) |
| W | Glide forward (pulls you up to 4.5 u/s; you recover stamina) | Move |
| S | Brake | Move |
| Q | Pokémon ability, and the rescue in a catch window | **Seek** (universal, 4.3) |
| E | Dock / scoop a fallen egg / deliver | Collect the egg / board the boat |
| ESC | Pause (excluded from score; deferred while a rescue window is open) | Pause |

Session (target 5–7 min): Welcome + nickname 30 s → Character + Pokémon selection 45 s → **Stage 1 The Crossing →
Stage 2 The Egg Hunt → Stage 3 Escape to Iago Tower** (gameplay 3.5–4.5 min) → Results 40 s.

**Score** `[L]` = delivered egg points × 100 − active gameplay seconds. Egg points are Common 1, Rare 3, Legendary 6
(from `EGG_POINTS` in `constants.ts`, not duplicated). Gholdengo's pristine bonus was removed by D-27 (whole points only; replaced by an egg-security floor). The score clock
counts **sim seconds while the player has control**. It stops during pause, scripted docking and push-off
transitions, and the delivery animation. During the rescue window it runs at the time scale (0.25×).

---

## 2. Rowing and stamina model

### 2.1 Formulas (engine reference)

Per **accepted** stroke (at least `minStrokeIntervalS` = 0.15 s `[T]` after the last accepted one; faster presses are
"missed strokes", cost 0.5 stamina `[T]` and flash "Too fast"):

```
Δv = baseImpulse[L 1.2] × P_char × E_stam × (1 − (v / Vmax)^8) × traitMult
Vmax = maxSpeed[L 12] × T_char (+ active boosts)
E_stam = 1                                   if stamina ≥ 25% of max
       = lerp(0.45, 1, stamina / (0.25·max))  below that (lowStaminaFloor 0.45, threshold 0.25)
stamina −= strokeStaminaCost 1.6 (clamped at 0; strokes still work at the floor)
```

Per frame (frame-rate independent):

```
v ← v · exp(−(drag 0.36 + brakeDrag 1.8·[S held]) · dt) − linearDrag 0.4 · dt ;  v ≥ 0
W held and v < cruiseSpeed 4.5 → v ← min(4.5, v + cruiseAccel 1.6 · dt) ; stamina −= 1.0·dt
v > Vmax (boost leftover) → v ← max(Vmax, v − 3·dt)
yawRate = steerRate[L 2.4] × H_char × lerp(steerMinAuthority 0.35, 1, min(1, v / 4))
regen: if now − lastStroke ≥ regenDelayS 0.3 → stamina += 14 × R_char × dt   (max 100 × S_char)
currents add their push vector to POSITION (not to speed); speed stays forward-only.
```

The fixed cadence cap (6.7 Hz), the 0.3 s regen delay and the `(v/Vmax)^8` fall-off together make **useful cadence
2–6 taps/s `[L]`**. Above about 4 Hz, extra taps buy little speed and cost a lot of stamina.

### 2.2 Steady state (base stats, model output)

| Cadence | Steady speed | Stamina net/s | Time from full to empty |
|---|---|---|---|
| W only | 4.5 | +13 | sustainable |
| 2.0 Hz | 5.5 | +2.4 | sustainable |
| 2.5 Hz (hold-to-row) | 7.1 | −0.5 | ~200 s |
| 3.0 Hz | 8.3 | −3.4 | ~29 s |
| 4.0 Hz | 9.7 | −6.4 | ~16 s |
| 6.0 Hz | 10.7 | −9.6 | ~10 s |

Coasting from 9.7 u/s loses about half the speed in 2 s (time constant ≈ 2.8 s), so rhythm matters. Full brake
(S) takes you from 8 to ~1 u/s in about 1 s. A full stamina refill while gliding takes about 7 s. Hold-to-row
(accessibility) gives exactly a "typical" player's pace. Tapping on top of it still adds bursts.

**Intended rhythm:** burst at 4–5 Hz for 8–12 s (overtaking the Hyde, surge response), glide 1.5–2 s, then cruise
at 2.5 Hz.

---

## 3. Hull, collisions and damage

Hull HP 100 (no stat scaling). The hull is restored to 100 at the island dock before Stage 3 `[T]`. At **HP 0 the
boat is Swamped**: you stall for 2.5 s bailing water and come back at 35 HP. This is not a DNF, but the Hyde will
close in. HP never ends a run by itself.

Collision when the boat capsule overlaps an obstacle shape:

```
f        = (min(v_impact, 12) / 12)^1.5     (0 if v_impact < 2 → harmless nudge)
hull     = baseDamage_kind × f × D_char × modifiers
egg loss = (5 + 25 f) × tierMult × D_char      (Stage 3 only, see 8.3)
speed    = v × retain_kind ; bounce 1.5 u along the normal ; 0.6 s invulnerability
glancing hit (approach ≤ 20° + 2° per handling point above 5) → hull and egg ×0.35, speed retain 0.8
```

| Kind | Base | Retain | 4 u/s | 7 u/s | 10 u/s | 12 u/s |
|---|---|---|---|---|---|---|
| rock | 24 | 0.30 | 4.6 | 10.7 | 18.3 | 24 |
| dock (broken pier) | 26 | 0.25 | 5.0 | 11.6 | 19.8 | 26 |
| log (often drifting) | 18 | 0.40 | 3.5 | 8.0 | 13.7 | 18 |
| branch (sunken, seen late) | 10 | 0.60 | 1.9 | 4.5 | 7.6 | 10 |
| buoy | 6 | 0.70 | 1.2 | 2.7 | 4.6 | 6 |
| Hyde catch | 25 (S1) / 30 (S3) | – | flat | | | |

Expected collisions per boat stage: strong 1–2, typical 4–6, struggling 8–12. A typical run therefore ends Stage 1
at ~55–65 HP. The real cost of a crash is time plus the Hyde gap: you lose 60–75 % of your speed, which is about
2 s and 6–8 u of gap.

---

## 4. Stage 1: The Crossing

**Objective:** row from the Nevermore boathouse to Raven Island's arrival dock. Slow to ≤ 4 u/s inside the 6 u dock
ring and press E. Docking freezes the Hyde (the island's ravens hold him off) and starts Stage 2.

### 4.1 Layout (course frame: start (0, 0), forward = −Z, width 120 u, length 460 u)

```
          x=-60                    0                     +60
z=-470   ~~~~~~~~~~~~~~~~~~ RAVEN ISLAND shore ~~~~~~~~~~~~~~~~~~
z=-460   ~~~~~~~~~~~~~~~~~~~~~ [D] arrival dock (10,-460) r6 ~~~~
         ~   =╗  ╔=      ╔==    =╗      ╔=    broken docks      ~  E  dock approach  6/100u
z=-380   ~ <<<<<<<< current B 2.0 u/s (−X) <<<<<<<<    o        ~     (surge 2 at z≈-377)
z=-360   ████████████████████  ┆ 14u ┆  ██████████████████████
         ████████████████████  ┆  ≈  ┆  ██████████████████████  D  narrow passage x 0..14
z=-300   ████████████████████  ┆     ┆  ██████████████████████     60 u long, 1 branch
z=-270   ░░░ o ░░░░ ═log═>(drift ±4u) ░░░ o ░░░ ≈br≈ ░░░ o ░░░░  C  FOG BANK density 0.7
z=-170   ░ o ░░ ≈br≈ ░░░░ o ░░░░░ ═log═ ░░░░░░ o ░░░░░ ≈br≈ ░░░     8/100u (visibility ~19 u)
         ~      o           o            o              o      ~  B  open water 6.5/100u
z=-100   ~ >>>>>>>> current A 1.8 u/s (+X) >>>>>>>>             ~     (surge 1 at z≈-152)
z=-80    ~            o                       o                ~  A  warm-up 2.5/100u, hints
z=0      ~~~~~~~~~~~~~~~~~ [S] boathouse (0,0) ~~~~~~~~~~~~~~~~~
                          ▼ Hyde lurks 45 u behind for 6 s
o rock (r 1.5–4)   ═log═ capsule r0.6 hl 3–5   ≈br≈ sunken branch (visible ≤ 8 u)   =╗ broken dock
```

### 4.2 Difficulty curve (obstacles per 100 u of course, ~26 obstacles total `[T]`)

| Segment | z range | Density | Teaches | Hyde |
|---|---|---|---|---|
| A Warm-up | 0 → −80 | 2.5 | Rowing, steering, glide | Lurk 6 s, then chase |
| B Open water | −80 → −170 | 6.5 | Currents, weaving | Surge 1 at 33 % progress |
| C Fog bank | −170 → −270 | 8.0 | Reading fog, sunken branches | Chase, fog silhouette |
| D Narrow passage | −300 → −360 | 5.0 | Brake + line-up | Chase |
| E Dock approach | −360 → −460 | 6.0 | Slalom, docking speed | Surge 2 at 82 % progress |

Assist `[T]`: if Stage 1 has run for more than 75 s, a faint "lake spirit" current of 1.2 u/s pushes along the
course axis toward the dock, so struggling players stay inside the session budget.

---

## 5. Hyde AI

### 5.1 Model

The Hyde rides a black gondola and follows the **player's breadcrumb wake**. He ignores obstacles (he smashes
through them), so his gap is always the path distance and he can never appear in front of you. The HUD **Hyde meter**
(0–70 u, pulses red below 15) shows the gap at all times, including in fog. In fog the Hyde is drawn as a silhouette
with lantern eyes.

```
v_avg  = exponential moving average of player speed (τ = 6 s)
v_h    = max(floorSpeed + tierBonus, paceFactor · v_avg) + rubberK · (gap − targetGap)
v_h    = clamp(v_h, minSpeed, maxSpeed)
not surging → v_h ≤ v_player + maxClosingRel                 (fairness cap)
gap > leashGap → v_h ≥ v_player + leashRelSpeed (2.0)       (he never falls out of sight)
equilibrium gap ≈ targetGap + (v − max(floor, pace·v)) / rubberK
```

He closes when you are slower than **your own recent pace** (crash, coasting, stalling) or slower than the
**absolute floor** (W-only or weak rowing). Clean rowing above your average earns gap.

### 5.2 State machine

```
            stage start
                │
             [LURK] ── lurkS elapsed ──► [CHASE] ◄──────────────┐
           (v_h = v_p)                     │  │                  │
                           progress ≥ mark │  │ gap ≤ catchRadius│
                    (telegraph 1.5 s first)│  ▼                  │
                                       [SURGE] ──► [CATCH] ─► rescue window (6)
                     duration elapsed ─────┘  ▲       │
                                              │       ▼
                    gap ≤ catchRadius ────────┘  [RECOVER] stun, then CHASE
         progress ≥ finalChaseAt (S3) ─► [FINAL CHASE] (CHASE with final params, surges done)
```

* **LURK**: holds the start gap (v_h = v_player), visible, growling. Tutorial hints play here.
* **CHASE**: the 5.1 formula.
* **SURGE**: scripted at fixed course-progress marks. After a 1.5 s telegraph (horn, red mist, Wednesday line;
  Wednesday the character gets +1.0 s), `v_h = v_avg + surgeBoost` for `surgeDurationS`, capped at maxSpeed. Because
  it is relative to *your* pace, the counterplay is the same for every skill level: row harder than usual, or use
  Q. **Fairness:** a surge never starts at gap < 18 u. It is deferred until the gap is ≥ 18, and skipped after 10 s.
* **CATCH**: gap ≤ 3.0 u (Dusknoir passive 2.4 u). Opens the rescue window (6). Never possible during LURK, docking,
  the egg scoop (where his closing speed is capped at +2), delivery, or within 5 s of a previous catch.
* **RECOVER**: the Hyde is placed at `postCatchGapU + pushHydeBackM (+ Kent bonus)` behind you, stunned for
  `recoverStunS`, then returns to CHASE.
* **FINAL CHASE (Stage 3, last 20 %)**: floor +0.4, pace 0.95, target gap 16. Docking at Iago Tower needs braking
  (≤ 4 u/s), so the finale is a test of brake timing under pressure.

### 5.3 Parameters per stage (all `[T]`)

| Param | Stage 1 | Stage 3 |
|---|---|---|
| lurk / start gap | 6 s / 45 u | 3 s / **50 − 0.15 × (hunt s − 40)**, clamped 28–50 u (+12 Kent) |
| floorSpeed / paceFactor | 5.2 / 0.85 | 5.0 / 0.90 (+0.2 rare, +0.4 legendary carried) |
| rubberK / targetGap / leash | 0.07 / 28 / 70 | 0.075 / 22 / 60 |
| min / max speed | 3.5 / 11.5 | 4.0 / 12.5 |
| maxClosingRel (not surging) | 4.5 | 5.0 |
| surges at progress | 0.33, 0.82 | 0.30, 0.66 |
| surgeBoost × duration | +3.0 × 4.0 s (≈ −12 u if you keep pace) | +3.5 × 4.0 s (≈ −14 u) |
| catch hull / egg security | 25 / – | 30 / −40 |
| post-catch gap / stun | 32 u / 3.0 s | 28 u / 2.5 s |
| final chase | – | at 0.80: floor +0.4, pace 0.95, target 16 |

**Equilibrium gaps (model):** Stage 1 is strong 49 u / typical 43 u / struggling 22 u. Stage 3 is strong 34 u /
typical 30 u / struggling 15 u, rising to 27 u once the assist current kicks in. A typical player survives a surge
with 12–24 u to spare. A crash during a surge is what turns it into a catch. Expected catch rate per run: strong
~5 %, typical ~35 % (mostly in Stage 3), struggling ~70 %. Target DNF rate: strong < 1 %, typical ~5 %, struggling
≤ 20 %.

### 5.4 Fairness and mercy rules

1. The Hyde never spawns ahead of you and never cuts corners (wake-following).
2. Closing speed outside surges is capped (4.5 / 5.0 u/s). A single crash at a healthy gap is never a catch.
3. Surges are telegraphed (≥ 1.5 s) and never start inside 18 u.
4. No catch during docking, delivery, scripted moments, or 5 s after a catch (player invulnerability).
5. Leash at 70 / 60 u: skilled players stay in a tense chase rather than in a solo time trial.
6. **Last-chance mode** (after the first counted catch, for the rest of the run): floor −1.0 u/s, surge boost ×0.5,
   closing cap 3.0 u/s, no final-chase floor bonus, rescue window +0.5 s. Wednesday announces it.
7. **Lake assist** (Stage 1 > 75 s, Stage 3 > 95 s): +1.2 u/s guiding current along the course.

---

## 6. Rescue window ("PRESS Q")

When a catch triggers, the world drops to **0.25× time scale for 2.0 real seconds `[T]`** (Morticia +0.8 s,
last-chance mode +0.5 s). The Hyde's hand closes on the stern. The HUD shows **PRESS Q** with a ring timer and
"mash SPACE".

| Player action | Result |
|---|---|
| Q within the first **0.5 s** (Morticia 0.8 s) with the ability ready | **Clean Escape**: the catch is **not counted** (max 1 per run `[T]`). The Pokémon's rescue effect also applies. |
| Q later in the window with the ability ready | **Rescue**: the catch **counts** (defensive negation still counts `[L]`). Apply the Pokémon's `rescue` flags: `negateDamage`, `protectEgg`, `pushHydeBackM`. |
| No Q, or ability not ready | Full catch: counted, full hull damage, −40 egg security in Stage 3. |
| SPACE presses (always available) | Each press −6 % catch hull damage (max −48 %) and +0.5 u knockback (max +4 u). Stacks with a rescue. |

* "Ready" means charges > 0 **and** at least 75 % of the cooldown elapsed `[T]` ("your Pokémon digs deep"). A rescue
  consumes a use exactly like a normal Q press.
* **Second counted catch = DNF** `[L]` (catch limit 2). The Hyde drags the boat into the fog, and the run ends with the
  time survived.
* An active **Aegislash King's Shield** at the moment of contact repels the Hyde (+10 u) with **no catch at all**. That
  is its passive, and it is a pre-emptive skill play.
* A catch with the egg aboard in Stage 3: −40 security unless `protectEgg`. If that takes security to 0, the egg goes
  overboard (8.3).

---

## 7. Stage 2: The Egg Hunt

**Objective:** find the egg (one per run), press E to collect it (0.6 s), walk back to the boat, and press E to
launch. The Hyde circles the island in his gondola (menace only, never lands). Time spent here shrinks your Stage 3
head start (5.3).

### 7.1 Layout (island frame: dock at (0, 0), inland = −Z, 100 × 92 u, walk 4.5 u/s)

```
 z    x=-50        -30          -10   0   10          30          50
-86   ############################ cliffs ##############################
-72        [L1 CRYPT VAULT]  ######## crypt ########   [L2 RAVEN OSSUARY]
-68         (-22,-68) 76u    <-- Shade B loop (inside) -->  (18,-72) 78u
-56        ### crypt entrance (dark, lantern r6) ###   ~~ crumbling bridge ~~
-42   [R1 BELL RUIN]  :: broken stone path ::   ^^^ fog forest ^^^ [R2 HOLLOW OAK]
-38    (-34,-38) 50u  <-------- Shade A loop around hub r14 -------->  (30,-42) 52u
-34                           ( RAVEN STATUE hub )
-14      [C1 LANTERN SHRINE] (-18,-14) 24u        [C2 OLD BOATHOUSE] (20,-10) 24u
  0   ~~~~~~~~~~~~~~~~~~~~~~~~~ [DOCK / boat (0,0)] ~~~~~~~~~~~~~~~~~~~~~~~~~
                        lake (Hyde circling offshore)
 (distances = walking path length from the dock)
```

### 7.2 Spawn spots, seed and tier

* There are 6 candidate spots in 3 **reach classes**: Common C1/C2 (open, lit, ≤ 24 u), Rare R1/R2 (≈ 50 u past a
  hazard), Legendary L1/L2 (≈ 77 u in the dark crypt, with a Shade patrol and a 1.5 s lid interaction).
* The session seed (mulberry32, drawn in a fixed order: tier → spot → active decoys → Shade phase) **rolls the
  tier** from the configurable distribution `[T]`: **Common 0.5 / Rare 0.375 / Legendary 0.125** (exact binary
  fractions, sum exactly 1; E[points] = 2.375). It then places the egg at one of the two spots of the **matching reach
  class**.
* It also activates **3–4 glowing spots** in total: the egg spot, one spot from each other class, and (50 %) one
  extra. Non-egg active spots show **wisps**: flickering green, never tier-coloured, fading within 6 u. The real egg
  glows steadily in its tier colour (`#f3eee2` / `#5ee0f0` / `#f2c14e`). The glow is visible within 18 u and
  intensifies linearly as you approach.

### 7.3 Rarer eggs are harder to REACH (and to deliver), not only rarer

| Class | Round trip | Hazard | Typical extra time | Stage 3 consequence |
|---|---|---|---|---|
| Common | ~48 u, ~15–20 s | none | – | egg loss ×0.8, Hyde floor +0 |
| Rare | ~100 u, ~35–45 s | crumbling stones (stand > 0.8 s → fall, 2 s reset), or fog forest roots (×0.7 walk), Shade A crosses | +20 s | loss ×1.0, floor +0.2, ~3 u less head start |
| Legendary | ~155 u, ~55–70 s | dark crypt (lantern r 6), Shade B patrol, hold E 1.5 s on the lid (a Shade interrupts it) | +40 s | loss ×1.25, floor +0.4, ~6 u less head start |

### 7.4 Clues and Pokémon help

1. **Landing shards:** three eggshell shards in the tier colour at the dock point toward the egg's sector.
2. **Raven statue:** the hub statue's eyes glow toward the egg spot.
3. **Glow:** the egg's halo is visible within 18 u (Sableye ×1.6). Within 10 u it shows a light column through walls.
4. **Pokémon reaction:** your Pokémon chirps faster within 25 u (audio plus animation).
5. **Seek (Q, universal on foot, 12 s cooldown):**

| Pokémon specialty | Seek effect |
|---|---|
| `egg_sense` (Sableye) | exact egg position, tier and lantern trail for 6 s |
| `obstacle_detection`, `fog_clear` (Decidueye, Chandelure) | lantern trail to the egg for 4 s |
| `shield`, `hyde_distraction`, `pursuit_slow` | direction arrow 2.5 s, **and repels Shades within 8 u (3 s stun)** |
| `speed_boost`, `current_ride` | direction arrow 2.5 s, and walk +30 % for 3 s |
| `stamina_restore`, `egg_protection` | direction arrow 2.5 s, and the next Shade touch is ignored |

6. **Assists:** after 60 s the egg glow becomes a beacon visible from anywhere. After 100 s a raven walks ahead of
   you to the egg and then back to the boat. After collection, a lantern trail always shows the way back to the boat.

### 7.5 Roaming threats: Crypt Shades (do not count as Hyde catches)

There are two Shades on fixed loops, one around the hub (A) and one inside the crypt (B). They patrol at 3.0 u/s and
chase at 4.0 u/s (slower than the 4.5 u/s walk) once you are within 9 u. They give up at 14 u or after 4 s. A touch
staggers you for 1.2 s and knocks you back 3 u. If you are carrying the egg it drops 1.5 u away, and E picks it up
again in 0.5 s. Shades cost time, never the run.

---

## 8. Stage 3: Escape to Iago Tower

**Objective:** row the egg from Raven Island's slipway to Iago Tower's delivery dock on the far shore. This is a
different route from Stage 1, and it is harder. Slow to ≤ 4 u/s inside the 6 u ring and press E to deliver (1.0 s,
the Hyde freezes).

### 8.1 Layout (course frame: start (0, 0), forward = −Z, width 140 u, length 520 u)

```
          x=-70                       0                        +70
z=-520   ~~~~~~~~~~~~~~~~~~~~ IAGO TOWER shore ~~~~~~~~~~~~~~~~~~~~
z=-515   ~~~~~~~~~~~~~~~~~~~ [T] delivery dock (0,-515) r6 ~~~~~~~
         ~   b     b    o     b     b    o    b   (buoy lane)     ~  F  FINAL CHASE 7/100u
z=-420   ~~~~~~~ final chase starts at 80 % progress (z≈-416) ~~~~~~
         ░░ ≈br≈ ░░ o ░░░ ═log═> ░░░ ≈br≈ ░░ o ░░░ ≈br≈ ░░ o ░░░░  E  DEEP FOG density 0.85
z=-340   ░░░░░░░░░░ surge 2 at 66 % (z≈-343) ░░░░░░░░░░░░░░░░░░░░     10/100u
         ███████████  ┆10u┆ ██████████████████████████████████████
z=-300   ████████████  ╲    chicane     ╲  ███████████████████████  D  TWIN NARROWS 12 u then 10 u
         ██████████████████████████  ┆12u┆ ██████████████████████     8/100u
z=-260   ~ >>> cur 2.6 >>>  ~  <<< cur 3.0 <<<  ~  >>> cur 3.2 >>> ~  C  RAPIDS 10/100u
z=-180   ~ =╗ ╔=  wreck  ═log═>   =╗  o   ╔==  wreck   ═log═>  o  ~  B  GRAVEYARD OF BOATS
z=-156   ~~~~~~~~~~~~~~ surge 1 at 30 % ~~~~~~~~~~~~~~~~~~~~~~~~~~~     9/100u, 35 % drifting logs
z=-60    ~        o            o              o                    ~  A  push-off 4/100u
z=0      ~~~~~~~~~~~~ [S] Raven Island slipway (0,0) ~~~~~~~~~~~~~~
                           ▼ Hyde 28–50 u behind (5.3)
```

### 8.2 Difficulty curve (~43 obstacles `[T]`)

| Segment | z range | Density | New pressure |
|---|---|---|---|
| A Push-off | 0 → −60 | 4 | Egg aboard: gentle bumps already cost security |
| B Graveyard of Boats | −60 → −180 | 9 | Drifting logs (35 %), wrecks; surge 1 |
| C Rapids | −180 → −260 | 10 | Three alternating currents of 2.6–3.2 u/s |
| D Twin Narrows | −260 → −340 | 8 | 12 u and 10 u gaps with a chicane |
| E Deep Fog | −340 → −420 | 10 | Visibility ~15 u, sunken branches; surge 2 |
| F Final Chase | −420 → −520 | 7 | Buoy lane, aggressive Hyde, brake to dock |

### 8.3 Egg security (0–100)

* Starts at **100** when collected. Shades do not reduce security.
* **Collision loss** = (5 + 25 f) × tierMult (Common 0.8 / Rare 1.0 / Legendary 1.25) × D_char. Typical rock hits
  at 7 u/s cost 16 (rare). Light bumps (< 2 u/s) cost nothing.
* **Hyde catch** −40 (negated by `protectEgg`).
* **Settling:** after 5 s with no impact, security regenerates 1/s up to a cap of 70 (it never "heals" to pristine).
* **Fall-off (deterministic, no dice):** security reaches 0, **or** a hard hit (≥ 9 u/s) lands while security < 35.
* **Overboard:** the egg floats at the impact point, drifting 1.2 u/s with the current, with a glowing beacon.
  **Recovery:** get within 4 u at ≤ 5 u/s and press E. That starts a 0.8 s scoop (speed ×0.5; the Hyde's closing
  speed is capped at +2 meanwhile). Security comes back at 40. A typical recovery costs 4–8 s and 8–15 u of gap.
* **Sinking:** an un-recovered egg sinks after 15 s, with a warning at 5 s (Dhelmise: never sinks). You can still
  deliver nothing and finish (score = −seconds).
* **Pristine:** delivering with security ≥ 90 earns a results badge. With Gholdengo it is also worth +0.5 points.

### 8.4 Delivery

The Iago Tower dock ring has a 6 u radius and requires ≤ 4 u/s. Wednesday warns when you arrive too fast. E delivers
in 1.0 s while the Hyde is frozen. The score clock stops on E.

---

## 9. Pokémon abilities

### 9.1 Shared rules

* Q activates the ability if it is ready (cooldown elapsed and charges > 0). The cooldown starts at activation.
* **Cooldowns are reset to ready, and charges refilled, at the start of each boat stage.** On foot, Q is Seek (7.4).
* The ability system reads only the data fields. **Magnitude by specialty:**

| Specialty | `magnitude` means | Effect for `durationS` |
|---|---|---|
| `speed_boost` | u/s | Instant +mag speed. The speed cap is raised by +mag. |
| `shield` | hits | Absorbs up to mag obstacle hits (0 hull, 0 egg loss, keeps 85 % speed). |
| `hyde_distraction` | Hyde speed multiplier | The Hyde chases a lure: v_h × mag. **Cancels an active surge.** |
| `pursuit_slow` | Hyde speed multiplier | v_h × mag, also applied during surges (surge timer keeps running). |
| `obstacle_detection` | radius u | Outlines all hazards in range (sunken too), current arrows, and the safest line. |
| `egg_protection` | fraction prevented | Egg loss × (1 − mag). Hull × (1 − mag/2). The egg cannot fall off. |
| `stamina_restore` | stamina points | Instant +mag stamina. Strokes are free for the duration. |
| `fog_clear` | radius u | Fog density 0 within range. Hazards in range are outlined. |
| `egg_sense` | radius u | On foot: egg reveal radius. On water: hazard glints at mag × 0.5. |
| `current_ride` | multiplier and u/s | In currents, push is re-aimed along your heading × mag. Outside currents, +mag u/s forward push. |

### 9.2 Roster (numbers are all `[T]` and live in `pokemon.ts`)

Rescue column: N = negate catch damage, E = protect egg, then push u.

| Pokémon | Ability | Specialty | CD s | Charges | Dur s | Mag | Rescue | Passive |
|---|---|---|---|---|---|---|---|---|
| Gengar | Shadow Double | hyde_distraction | 26 | ∞ | 3.5 | 0.25 | N · 10 | Slips through sunken branches |
| Alolan Marowak | Bone Shield | shield | 16 | ∞ | 8 | 2 | N · 10 | – |
| Misdreavus | Spite Echo | hyde_distraction | 20 | ∞ | 5 | 0.5 | 14 | Surges close 25 % less |
| Galarian Corsola | Cursed Body | stamina_restore | 22 | ∞ | 4 | 45 | N · 8 | After a catch, Hyde ×0.75 for 8 s |
| Sableye | Gem Sense | egg_sense | 16 | ∞ | 6 | 70 | E · 6 | Egg glow radius ×1.6 |
| Dusknoir | Pressure Grip | pursuit_slow | 24 | ∞ | 7 | 0.65 | 18 | Catch radius ×0.8 |
| Drifblim | Tailwind | speed_boost | 24 | ∞ | 6 | 2.5 | E · 10 | Strokes cost ×0.5 during boost |
| Froslass | Freezing Mist | pursuit_slow | 20 | ∞ | 4.5 | 0.45 | N · 10 | In fog, Hyde ×0.85 |
| Jellicent | Water Barrier | shield | 28 | ∞ | 5 | 3 | N E · 4 | Current push on you ×0.25 |
| Chandelure | Flash Fire Flare | fog_clear | 16 | ∞ | 8 | 40 | E · 12 | Flare stuns a Hyde ≤ 20 u for 1.5 s |
| Aegislash | King's Shield | shield | 20 | ∞ | 2.5 | 3 | N E · 6 | Active shield blocks the Hyde's grab (+10 u, no catch) |
| Trevenant | Forest Anchor | shield | 26 | ∞ | 6 | 4 | E · 8 | Each of your collisions roots the Hyde 1.5 s (×0.5) |
| Dhelmise | Ghost Anchor | egg_protection | 22 | ∞ | 12 | 1.0 | N E · 4 | Fallen egg never sinks; scoop radius ×2 |
| Decidueye | Spirit Sight | obstacle_detection | 15 | ∞ | 8 | 45 | E · 10 | Sunken hazards within 20 u always outlined |
| Dragapult | Dragon Darts | speed_boost | 8 | 4 / stage | 2.5 | 5 | 20 | – |
| Basculegion | Wave Rider | current_ride | 22 | ∞ | 8 | 1.5 | 16 | Gap ≥ 25 u: top speed +0.6 (was 50 u; D-32) |
| Ceruledge | Bitter Blade | speed_boost | 20 | ∞ | 2.5 | 3.5 | N · 10 | Boost slices logs, branches, buoys |
| Gholdengo | Golden Body | egg_protection | 20 | ∞ | 6 | 0.75 | E · 10 | ~~Delivery at security ≥ 90: +0.5 pts~~ → egg security floor 40 (D-27) |

### 9.3 Balance model (no strictly dominant pick)

**Power Index (PI)** = effect value per use × practical uses per boat stage × situational factor. Uses are
min(charges, 1 + (75 s − dur)/cd) × 0.8 (players don't fire on cooldown). Effect values are in **equivalent
seconds (ES)**: 1 s saved = 1, 1 u of Hyde gap = 0.2, 1 absorbed collision = 2.5, 1 egg security = 0.15.
**Rescue value R** = 1.0·N + 1.5·E + push/10. Weighted total = PI + 1.5 R. The target band is 13.5–16.

| Pokémon | PI/stage | R | Total | Profile (Speed / Safety / Egg / Hunt) |
|---|---|---|---|---|
| Gengar | 12.4 | 2.0 | 15.4 | – / ●●● / – / ● |
| Marowak | 11.5 | 2.0 | 14.5 | ● / ●● / ●● / ● |
| Misdreavus | 13.0 | 1.4 | 15.1 | – / ●●● / – / ● |
| Corsola | 12.4 | 1.8 | 15.1 | ●● / ● / – / – |
| Sableye | 12.2* | 2.1 | 15.4 | – / ● / ● / ●●● |
| Dusknoir | 11.0 | 1.8 | 13.7 | – / ●●● / – / ● |
| Drifblim | 11.5 | 2.5 | 15.3 | ●● / ● / ● / – |
| Froslass | 12.9 | 2.0 | 15.9 | – / ●●● / – / ● |
| Jellicent | 9.6 | 2.9 | 14.0 | ● / ●● / ●● / ● |
| Chandelure | 10.0 | 2.7 | 14.0 | ● / ● / ● / ●● (fog specialist) |
| Aegislash | 9.5 (+Hyde block) | 3.1 | 14.2+ | – / ●●● / ●● / ● (timing skill) |
| Trevenant | 12.3 | 2.3 | 15.8 | – / ●● / ● / ● (forgives crashers) |
| Dhelmise | 10.0 | 2.9 | 14.4 | – / ● / ●●● / – |
| Decidueye | 10.6* | 2.5 | 14.4 | ● / ● / ● / ●● |
| Dragapult | 11.0 | 2.0 | 14.0 | ●●● / – / – / ● (no rescue once charges are spent) |
| Basculegion | 12.7 | 1.6 | 15.1 | ●●● (in rapids) / – / – / ● |
| Ceruledge | 10.9 | 2.0 | 13.9 | ●● / ● / ● / ● |
| Gholdengo | 5.8 typical / 9.6 strong | 2.5 | 9.5–13.4 + ceiling | – / ● / ●● / – (score-ceiling pick) |

\* Includes a share of the Stage 2 time saving.

**Why nothing dominates:**
* **Speed** Pokémon (Dragapult, Drifblim, Basculegion, Ceruledge) save time but have no damage negation (Drifblim
  is the exception, with an egg rescue). They reward strong players.
* **Safety** Pokémon (Gengar, Misdreavus, Froslass, Dusknoir, Aegislash) buy gap, not time. They are what struggling
  players need.
* **Egg** Pokémon (Dhelmise, Gholdengo, Jellicent, Marowak) shine only in Stage 3.
* **Hunt** Pokémon (Sableye, Decidueye, Chandelure) win Stage 2 and fog.
* The rescue strength is inversely tied to field strength. Cooldowns/charges also create a real "use it or keep it"
  tension.
* Gholdengo is deliberately weak for novices and has the highest ceiling. Watch its pick and score rates (15).

Designed redundancies (acceptable): Bianca + Jellicent (currents ×0.4 × 0.25 = 0.1); Wednesday + Chandelure (fog);
Xavier/Ajax + shields.

---

## 10. Characters

### 10.1 Stats

Every character has five 1–10 ratings summing to **30** (range 3–9; the current roster uses 4–9). They are converted
to multipliers of the base values. Neutral rating = 5.

| Stat | Multiplier per point above 5 | Rating 4 → 9 |
|---|---|---|
| Rowing power (impulse) | +4 % | 0.96 → 1.16 |
| Top speed (Vmax) | +4 % | 11.5 → 13.9 u/s |
| Stamina (max / regen) | +8 % / +5 % | 92 → 132 / 13.3 → 16.8 per s |
| Handling (steer / glancing angle) | +6 % / +2° | 2.26 → 2.98 rad/s / 18° → 28° |
| Defense (hull + egg loss) | −6 % | ×1.06 → ×0.76 |

Power helps everyone; top speed only matters above ~9 u/s (strong players). This is the main lever if one archetype
dominates.

### 10.2 Roster (all `[T]`; trait numbers are in `CHARACTER_TRAIT_TUNING`)

| Character | Pow | Top | Sta | Hnd | Def | Trait | Real-time effect | Trade-off |
|---|---|---|---|---|---|---|---|---|
| Wednesday | 5 | 5 | 5 | **9** | 6 | Dark Vision | Fog density ×0.35; surge telegraph +1.0 s | Average engine |
| Enid | **8** | 5 | **9** | 4 | 4 | High Energy | Strokes below 3 u/s ×1.6 impulse; regen delay 0.15 s | Clumsy, fragile |
| Bianca | 5 | 7 | 6 | 7 | 5 | Siren Navigation | Current push ×0.4; heading with a current (≤ 45°) +15 % impulse | Ordinary off-current |
| Xavier | 4 | 5 | 6 | 6 | **9** | Painted Decoy | First 2 collisions per boat stage: no hull, egg or speed loss | Slowest stroke |
| Ajax | 7 | 4 | 7 | 4 | 8 | Stone Shield | Collisions keep at least 60 % speed (retain = max(kind, 0.6); normally 25–70 % by kind) | Low top speed, heavy steering |
| Yoko | 7 | **9** | 4 | 6 | 4 | Night Sprint | Walk ×1.2; strokes above 75 % Vmax cost ×0.75 | Short stamina, fragile |
| Kent | 6 | 6 | 6 | 5 | 7 | Hydro Wave | Hyde starts +12 u back each boat stage; catch knockback +10 u | No speed edge |
| Divina | 4 | 7 | 8 | 6 | 5 | Siren Drift | Coasting (no stroke for 0.5 s) drag ×0.6 | Weak stroke |
| Rowan | 5 | 6 | 5 | 8 | 6 | Telekinetic Push | Every 6 s, auto-shoves a log/branch/buoy within 4 u ahead | Rocks/docks unaffected |
| Eugene | 4 | 5 | 7 | 7 | 7 | Hive Swarm | Bees point to the egg for 5 s on landing; Seek CD ×0.5 | Weak rowing |
| Morticia | 5 | 6 | 6 | 7 | 6 | Graceful Escape | Rescue window +0.8 s; Clean Escape timing +0.3 s | Only shines when caught |
| Gomez | **8** | 8 | 5 | 4 | 5 | Fearless Dash | Hyde within 18 u: strokes ×1.25 | Clumsy, average stamina |

**Balance read:**
* **Time** characters (Enid, Gomez, Yoko) win on the clock but crash more, because of low handling or defense.
* **Forgiveness** characters (Xavier, Ajax, Rowan) self-balance: they help most the players who hit things most.
* **Survival** characters (Kent, Morticia) cut DNF risk.
* **Information** characters (Wednesday, Eugene, Bianca) save time only where their condition holds (fog, the hunt,
  currents), and the courses guarantee those conditions in every run.
* Estimated trait value per run is about 8–15 ES for all twelve. Validate it with pick/score analytics.

---

## 11. Pacing budget (seconds of gameplay)

| Segment | Strong | Typical | Struggling (with assists) |
|---|---|---|---|
| Stage 1 intro + 3-2-1 | 4 | 4 | 4 |
| Stage 1 crossing (avg 9.2 / 6.8 / 5.1 u/s) | 50 | 68 | 90 |
| Dock + step ashore | 3 | 3 | 3 |
| Stage 2 hunt (incl. return to the boat) | 40 | 65 | 90 |
| Push-off | 3 | 3 | 3 |
| Stage 3 escape (avg 8.7 / 6.3 / 5.2 u/s) | 60 | 82 | 100 |
| Delivery + rescue windows | 2 | 4 | 7 |
| **Gameplay total** | **162** | **229** | **297** |
| Session incl. menus (30 + 45 + 40) | 4.6 min | 5.7 min | 6.9 min |

Hard limits `[T]`: Stage 2 beacon at 60 s and raven guide at 100 s; lake assist (Stage 1 at 75 s, Stage 3 at 95 s).
Idle handling: after 20 s of no input, Wednesday prompts; after 40 s, a "Still there?" overlay; after a further
15 s, the session is abandoned.

---

## 12. Tutorial hints (≤ 8 words; each shown once, at first relevance)

| Trigger | Hint |
|---|---|
| Stage 1 start | Tap SPACE in a steady rhythm to row. |
| 2 s later | A and D steer the boat. |
| First stamina < 40 % | Hold W to glide and catch breath. |
| First missed stroke | Too fast! Steady taps row harder. |
| Narrow passage at 40 u | Hold S to brake before tight gaps. |
| Lurk ends | Watch the Hyde meter. Don't slow down. |
| First time Q is ready with the Hyde < 30 u | Q unleashes your Pokémon. |
| First catch window | Grabbed! PRESS Q! Mash SPACE! |
| Dock ring | Slow down, then E to dock. |
| Stage 2 start | Follow the glow. E grabs the egg. |
| Stage 2 at 15 s | Q: your Pokémon seeks the egg. |
| First Shade within 12 u | Shades knock eggs loose. Walk around. |
| Stage 3 start | Bumps crack the egg. Row cleanly. |
| Egg overboard | Egg overboard! Steer close, press E. |
| Iago dock ring | Slow to dock, then E to deliver. |

---

## 13. Wednesday's contextual advice

Wednesday is the advisor voice whichever character is picked. Rules `[T]`:
* At most **one line every 6 s**, and each line at most 2× per run. The highest-priority valid trigger wins.
* Never during a rescue window or a tutorial hint.
* Subtitled for 2.5 s.

| Prio | Trigger | Line (≤ 8 words) |
|---|---|---|
| 1 | Surge telegraph starts | He's surging. Row like you mean it. |
| 2 | Gap < 12 u and ability ready | Use your Pokémon. Now would be polite. |
| 3 | Gap < 12 u and ability not ready | He's close. Row, don't think. |
| 4 | First counted catch resolved | One more grab and we're his. |
| 5 | Egg overboard | The egg is swimming. Fetch it. E. |
| 6 | Egg security < 35 | That egg is cracking. Gentler. |
| 7 | Inside a dock ring at > 4 u/s | Too fast to dock. Hold S. |
| 8 | Final chase begins | Final stretch. Everything you have left. |
| 9 | Stamina < 15 % while stroking | You're spent. Glide with W, briefly. |
| 10 | ≥ 3 missed strokes in 2 s | Mashing isn't rowing. Find a rhythm. |
| 11 | 2 collisions within 6 s | Fewer rocks. More lake. |
| 12 | Narrow passage ≤ 30 u ahead at > 9 u/s | Narrow gap ahead. Line up first. |
| 13 | Entering fog | Fog. Slow hands, sharp eyes. |
| 14 | Lateral current push > 1.5 u/s for 1 s | The current wants you. Steer against it. |
| 15 | Stage 2: no egg after 35 s | Press Q. Let your Pokémon sniff. |
| 16 | Stage 2: Shade within 10 u | A shade. Walk around, not through. |
| 17 | Stage 2: egg collected | Got it. Now back to the boat. |
| 18 | Stage 3 start | Iago Tower. Don't drop the egg. |
| 19 | Gap ≥ 55 u (once per stage) | He's falling behind. Don't get smug. |
| 20 | No strokes 5 s, speed < 2, not docking | Rowing requires SPACE. Repeatedly. |

---

## 14. Results

The results screen shows:
* Score (count-up), with egg points, delivery status and time.
* Badges: Pristine, Clean Escape, No Collisions, Legendary Courier.
* Hyde stats (closest gap, surges survived) and leaderboard placement.

**Recommended ranking:** finishers by score, then DNFs ranked below every finisher (see concern C2). Negative scores
are routine with Common eggs, so the copy should treat them with dry humour.

---

## 15. Analytics

Per session:
* seed, egg tier and spot, character, Pokémon, input mode (tap/hold), total gameplay seconds per stage, score,
  status (completed/DNF/abandoned), DNF stage and cause.

Per boat stage:
* Cadence: mean and p90 taps/s, missed strokes, time below 25 % stamina, glide seconds.
* Speed: average speed and % of time above 9 u/s.
* Collisions: by kind, impact speed, glancing share, hull damage, swamped count.
* Hyde: gap min/mean, surge outcomes (gap before and after), catch timeline, assist activation time.

Q usage:
* Count and timing relative to the Hyde gap, uses that hit nothing (shield expired unused), and wasted presses on
  cooldown.

Rescue windows:
* Reaction time to Q, Clean/Rescue/None outcome, SPACE presses, ability-ready state.

Stage 2:
* Time to first sight of the egg glow, Seek uses, wisp visits, Shade touches, falls, time to collect, return time.

Stage 3 egg:
* Security curve (sampled every 1 s), falls, recoveries, recovery times, sinks, security at delivery.

Wednesday:
* Line triggers, and player compliance within 3 s (e.g. stamina recovers after "glide" advice).

Derived dashboards:
* Score variance split by egg tier vs time.
* Pick rates and mean score per character × Pokémon.
* DNF rate by skill tercile (by Stage 1 time).
* Session length distribution.

---

## 16. Balancing levers (first knobs to turn)

| Symptom | Lever (file → key) |
|---|---|
| Too many DNFs | `stages.ts` hyde.stageN.floorSpeed ↓, mercy.floorPenalty ↑, rescue.readyAtCooldownFraction ↓, rescue.maxCleanEscapesPerRun ↑ |
| The Hyde feels toothless | paceFactor ↑ (0.85 → 0.9), surgeBoost ↑, add a third surge mark |
| Mashing wins | ROWING_DEFAULTS.minStrokeIntervalS ↑ (0.15 → 0.18), ROWING_EXTRAS.impulseFalloffExponent ↓ (8 → 6), missedStrokeStaminaCost ↑ |
| Players run dry constantly | strokeStaminaCost ↓ (1.6 → 1.4) or staminaRegenPerS ↑ |
| Sessions too long | lake assist earlier (assistAfterS), Stage 2 beaconAfterS ↓, course length ↓ |
| Egg falls too often | egg.collisionImpactLoss ↓, settleCap ↑, hardHitFallBelowSecurity ↓ |
| One Pokémon dominates | its cooldownS ↑ / magnitude ↓ / rescue push ↓ (one at a time, ±15 %) |
| One character dominates | statScaling per-point values; trait numbers in CHARACTER_TRAIT_TUNING |
| Tier luck dominates the leaderboard | egg.tierDistribution, shared seed rotation (C1) |
| Kids can't cope | "Gentle mode" kiosk toggle (recommended): floor −1.5, no surges, catch limit 3, scores flagged |

---

## 17. Concerns about the requirements (for the client)

* **C1: Luck vs skill.**
  * The problem: with a single random-tier egg (0.5 / 0.375 / 0.125), the tier's score spread is σ ≈ 165. The
    spread from time across players is σ ≈ 45 s. Model estimate: about **90 % of leaderboard variance comes from
    the egg roll**, which conflicts with "skill must matter more than luck". Reach difficulty and delivery risk make
    rarer eggs harder, but they cannot offset a 500-point jump.
  * Recommendation: **rotate a shared seed per 15-minute slot** across both stations, so rivals face the same egg
    and the leaderboard compares skill.
  * Alternative: a "choice mode" where each active spot holds its class's egg and the player carries one, which
    turns tier into a risk decision.
* **C2: DNF vs negative scores.** v2.5 gave DNF a score of 0. Typical Common finishes score about −130, so getting
  caught twice would *beat* finishing. DNFs must rank below all finishers (or score −seconds − 100).
* **C3: Most scores are negative.** About half the players get a Common egg (≈ +100 vs ~230 s). This is fine if the
  copy owns it. Otherwise consider a finish bonus (formula change, client decision).
* **C4: Repetitive tapping.** About 600–900 taps per session raises comfort and hardware-wear concerns at a
  two-station arcade. Hold-to-row should be offered on the welcome screen. Test the kiosk keyboards for
  SPACE + W + A/D rollover (cheap membrane boards ghost).
* **C5: Two-catch DNF for struggling players** depends on mercy and assists that need playtests. The ≤ 20 %
  struggling DNF target is a model estimate.
* **C6: Gholdengo's +0.5 point** needs fractional egg points in scoring and the leaderboard. Set the passive value to 0
  if the client wants points strictly 1/3/6.
* **C7: Pause exploit.** ESC is deferred during the rescue window, otherwise players could pause to prepare a Clean
  Escape.
