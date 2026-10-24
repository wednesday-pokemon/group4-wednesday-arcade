# MYSTERY_DESIGN: "The Silent Evidence" (rules `mystery-v3.1`)

Game-designer document. Sources: `docs/v3.1/GAME_PLAN_v3_1.md` (source of truth), `docs/v3.1/MASTER_PROMPT_v3_1.md`,
`docs/MYSTERY_CONTRACT.md`, `docs/UX_MYSTERY.md`. The data lives in `src/mystery/data/`:

| File | Export |
|---|---|
| `tuning.ts` | `MYSTERY_TUNING`, `hearingRadiusM(loudness)` |
| `nightshades.ts` | `NIGHTSHADES`, `DUO_NAME_ADJECTIVE` |
| `partners.ts` | `PARTNERS`, `DUO_NAME_NOUN` |
| `cases.ts` | `CASES` (three cases, public), `isCaseId`, `caseById`, `ROOM_LABELS`, `CASE_DISCLAIMER` — answers in `solutions.ts` (`CASE_SOLUTIONS`) |
| `thing.ts` | `THING`, `THING_STAY_SILENT`, `formatThingLine`, `ThingPose`, `ThingLine`, `TutorialLine` |
| `island.ts` | `buildIsland()`, `PRACTICE_CRATE`, `SHORTCUT_GATE_WALL_ID` |
| `caseWorlds.ts` | `CASE_WORLDS`, `caseWorld()` — per-case layout, candidate sites, spawns, zones, examines, passage, hazards (§10); compact `playArea`, cabinets, Slurp, `encounterSpawns` (§12) |
| `thing.ts` (final) | also `WEEMS` (optional scored hints), `DEATH_LINES`, `CABINET_PROMPTS`; `THING.prescriptive / slurp / cabinet / status` (§12) |

> **Current source of truth for cases, maps and the three enemies: §12 "Final (2026-10-24)".** §2–§4b and §10 describe
> the full-island layout and the earlier case texts (Isaac Night as a suspect is retired; he is now the monster Slurp).

**Honesty notes.** Every number is a proposed default for playtesting. It is not validated balance. Distances and
times below are computed from the map geometry. They are not playtest measurements. Move legality is tracked in
`docs/MOVE_LEGALITY.md`; in the data every `legality` field stays `unverified` until the orchestrator fills it in.
Character jobs, the crime and Gomez's electricity power are adaptations made for this game.

---

## 1. Core loop and design pillars

1. **Stay Silent.** Noise is the main resource. Crouching (0.10) is heard at 2 m, walking (0.35) at 7 m, sprinting
   (0.95) at 13 m and a forced egg drop (1.00) at 17 m. Each wall between the noise and the Hyde halves the radius.
2. **Read the Clues.** There are three clues in three rooms. Each one adds a single link to the chain of evidence and
   clears at most one innocent suspect.
3. **Escape the Hyde.** Carrying the egg makes you slower (×0.85) and louder (+0.10). The final run to Iago Tower is
   where the tension peaks.

Fair-threat rules: the Hyde patrols a fixed loop the player can learn. Suspicion builds visibly before a chase (at
least 0.55 s, and about 1.1 s at the edge of sight range). A grab has a 0.7 s wind-up that a stun can interrupt. The
first catch costs HP and then releases the player at a safe point with 3 s of invulnerability. The second catch is a
DNF. The chasing Hyde (4.0 m/s) is faster than walking (3.2 m/s) and slower than any duo sprinting, even with the egg
(at least 4.22 m/s).

---

## 2. The island map (`buildIsland()`)

Coordinates are in metres. −Z is north (the tower) and +Z is south (the pier). Bounds are x −45..45 and z −60..60
(90 × 120 m). The schematic is not to scale; exact numbers are in the tables.

```
 z \ x  -44            -18   -12        2        12        26  31  36    44
 -59  #####################################################################  cliff_n
      #  COURTYARD (path to the tower)                                    #
      #  hs_court_w(-18,-52)   +--IAGO TOWER--+ x3..13 z-57..-46           #
      #  bush(-24,-50)         |  DEPOSIT     |   hs_court_e(20,-54)       #
      #       tomb(-4,-52)     | (8,-51.5) r3 |   statue(22,-46)           #
 -46  #                        +---door x8----+                            #
      #  statue(-16,-42)  P10(-2,-42) HYDE START  P11(12,-40)  bush(24,-40) #
 -34  #==egg N wall (no door)==|=W gate x-10=|=====|=E gate x12=|==|GATE|==##   courtyard south wall
      #  EGG CHAMBER (wet)     |  P9            GREENHOUSE TERRACE |ALLEY |##
      #  cage|latch(-40,-31)   |  P8(-12,-24)   greenhouse(3,-24)  |26..36|##
      #  pillars around        D z-24  P7   planters  P12(12,-28)  |      |##
      #   EGG (-28,-20)        |       P14(2,-16)   P13(20,-20)    |switch|##
      #                        |              hs_terrace(16,-13)   |33,-13|##
 -10  #                        |=ridge=[RAVINE x-12]=ridge=========+-D x31+==#
  -8  #=======D x-36===========|  P6(-12,-4)  P5(2,-6)  ruin_mid    RESEARCH  #
      #  CRYPT (fog)  hall     |                         P4(14,4)   ROOM      #
      #  hs_alcove(-41.5,-5.5) D z4  P16(-11,4)                 D z6  note    #
      #  vault  | entrance hall|      chapel L + hs_chapel(0,14)   (38,-6)    #
      #  hs_sarc(-39,18)| KEY(-22,21)          P3(15,14)  shelf z-2          #
  26  #=========|====D x-24====| hedge_mid(-10..6,z24)   P2(30,22) =D x30====#
      #   SOUTH LAWN / GRAVEYARD    P19(-22,34) P18  P0(0,36)  P1(14,30)     #
      #   hs_lawn_w(-30,36)         P20(-8,42)              hs_lawn_e(26,42) #
  46  #==========shore===========+   PIER   +===========shore===============#
                                 | start (0,54) facing N
                                 | practice crate (3,50)  hs_pier(-6,50)
  59                             +----------+
```
Key: `D` = doorway, `Pn` = patrol waypoint, `hs_*` = hiding spot, `#` = cliff or rock.

### 2.1 Rooms (`MapDef.rooms`; rectangles CCW seen from above, first match wins)

| Order | RoomId | Name | Rectangle (x, z) | Flags |
|---|---|---|---|---|
| 1 | tower | Iago Tower | 3..13, −57..−46 | |
| 2 | pier | Pier | −9..9, 44..60 | wet |
| 3 | research_room | Research Room | 20..44, −10..14 | |
| 4 | crypt | Ruined Crypt | −44..−18, −8..26 | **fog** (sight 8 m) |
| 5 | egg_chamber | Egg Chamber | −44..−18, −34..−8 | wet |
| 6 | shortcut | Shortcut Alley | 26..36, −34..−10 | |
| 7 | courtyard | Iago Tower Courtyard | −44..44, −60..−34 | |
| 8 | path | Island Path (fallback: lawn, middle path, terrace) | −45..45, −60..60 | |

### 2.2 Doorways (clear width = gap between wall endpoints minus wall thickness)

| Doorway | Centre | Clear width | Connects |
|---|---|---|---|
| Pier mouth | (0, 46) | ~16 m | pier ↔ lawn |
| Crypt main entrance (south) | (−24, 26) | 4.0 m | lawn ↔ crypt entrance hall |
| Crypt east door | (−18, 4) | 4.0 m | middle path ↔ crypt hall |
| Crypt ↔ Egg Chamber | (−36, −8) | 4.0 m | crypt hall ↔ egg chamber |
| Egg Chamber east door | (−18, −24) | 4.0 m | egg chamber ↔ terrace |
| Ravine pass | (−12, −10) | 3.5 m | middle path ↔ terrace |
| Research west door | (20, 6) | 3.0 m | middle path ↔ research |
| Research south door | (30, 14) | 3.0 m | lawn ↔ research |
| Research north door | (31, −10) | 3.0 m | research ↔ shortcut alley |
| Courtyard west gate | (−10, −34) | 4.0 m | terrace ↔ courtyard |
| Courtyard east gate | (12, −34) | 4.0 m | terrace ↔ courtyard |
| **Shortcut gate** (`gate_shortcut`) | (31, −34) | 3.0 m when open | alley ↔ courtyard (Gomez's F only, opens permanently: `openS: 0`) |
| Tower door | (8, −46) | 3.0 m | courtyard ↔ tower |

Internal openings are wide: the crypt vault opens 8+ m north toward the hall, and the research bookshelf leaves
6.7 m and 7.3 m passages at its two ends. The player radius is 0.4 m and the Hyde radius is 0.6 m. No passage is
narrower than 2.2 m.

### 2.3 Connectivity: there is always a long way round

- **North–south links:** (a) the ravine at x −12, and (b) crypt → egg chamber → east door. The shortcut alley is a dead
  end until Gomez powers the gate. Nobody ever needs it.
- **Research to tower, long way:** note (38,−6) → west door → ravine → east gate → tower = **~109 m**.
  **Shortcut:** note → north door → gate → tower = **~61 m**, which saves ~48 m (~15 s walking, ~30 s crouched).
- Every clue and the egg can be reached on foot from the pier by every duo without using any power.

### 2.4 Clues, egg, tower, switch

| Object | Position | Room | Search | Notes |
|---|---|---|---|---|
| transfer_note ("Search the desk") | (38, −6) | research_room | 2.5 s | behind the bookshelf (28..36, z −2), in the far corner |
| master_key ("Examine the pouch") | (−22, 21) | crypt | 2.5 s | 5 m inside the main entrance, in fog |
| greenhouse_trace ("Inspect the latch") | (−40, −31) | egg_chamber | 3.0 s | inside the open Hyde cage (bars at x −36) |
| Egg spawn | (−28, −20) | egg_chamber | pickup 1.2 s | shrine between four high pillars |
| Tower deposit | (8, −51.5), r 3 | tower | deposit 1.0 s | inside the tower, 5.5 m past the door |
| Power switch | (33, −13) | shortcut | Gomez F within 4 m | opens `gate_shortcut` permanently |
| Practice crate (tutorial) | (3, 50), r 0.8 | pier | 1.0 s | `PRACTICE_CRATE`; the Hyde never enters the pier |

Search times are multiplied by `interactTimeMult` (range 0.77–1.21 across duos).

### 2.5 Hiding spots (11). Crouch inside to hide; the Hyde sees you only within `revealM`

| Id | Pos | Kind | revealM | Route it serves | Nearest patrol line |
|---|---|---|---|---|---|
| hs_pier | (−6, 50) | alcove | 2.0 | tutorial practice | 8 m (P20) |
| hs_lawn_w | (−30, 36) | hedge | 2.0 | crypt main entrance | 8 m (P19) |
| hs_lawn_e | (26, 42) | hedge | 2.0 | pier → research | 18 m |
| hs_chapel | (0, 14) | alcove | 2.0 | middle crossing | 11 m |
| hs_research | (21.8, −8.2) | wardrobe | 1.5 | research room | 14 m + wall |
| hs_crypt_sarc | (−39, 18) | sarcophagus | 1.5 | crypt vault | indoor |
| hs_crypt_alcove | (−41.5, −5.5) | alcove | 2.0 | crypt → egg chamber | indoor |
| hs_egg_alcove | (−21.5, −31.5) | alcove | 2.0 | egg chamber | 10 m + wall |
| hs_terrace | (16, −13) | hedge | 2.0 | terrace / shortcut | 6 m (P13–P14) |
| hs_court_w | (−18, −52) | hedge | 2.0 | west-gate approach | 16 m |
| hs_court_e | (20, −54) | hedge | 2.0 | east-gate approach / behind tower | 16 m |

No hiding spot sits on the patrol line. The closest is 6 m away, which is more than any `revealM`. A hidden player can
still be heard, so the HUD should say "it can still hear you".

### 2.6 Cover (37 pieces)

Low cover (crates, tombs, bushes, barrels) blocks sight only to a crouching player. High cover (pillars, statues,
trees) blocks sight and movement. Clusters: pier (2), lawn graveyard (8), middle path (4 plus the chapel L,
hedge_mid and ruin_mid walls), research desks and pillar (4), crypt (5), the egg-chamber pillar ring (5), terrace
planters, post and tree (4), courtyard statues, bushes and tomb (5).

### 2.7 Safe release points

(0, 49) pier · (−36, 40) lawn west · (36, 40) lawn east · (−6, 20) middle · (−36, −46) courtyard west · (36, −48)
courtyard east. **Recommended rule:** from the points at least 18 m from the Hyde, pick the one **nearest to where the
grab happened**. This keeps a grab from teleporting a carrier closer to the tower. If no point is 18 m away, pick the
one farthest from the Hyde.

---

## 3. Patrol loop and why it is shaped this way

21 waypoints in one closed loop, **~288 m**, which takes **~120 s per lap** at 2.4 m/s.

| # | Point | Purpose | # | Point | Purpose |
|---|---|---|---|---|---|
| P0 | (0, 36) | lawn centre | P11 | (12, −40) | in front of the tower door (6 m) |
| P1 | (14, 30) | lawn east | P12 | (12, −28) | back out the east gate |
| P2 | (30, 22) | 8 m outside research south door | P13 | (20, −20) | terrace NE, by the shortcut alley |
| P3 | (15, 14) | | P14 | (2, −16) | greenhouse |
| P4 | (14, 4) | 6 m outside research west door | P15 | (−12, −14) | ravine, north side |
| P5 | (2, −6) | | P16 | (−11, 4) | 7 m outside crypt east door |
| P6 | (−12, −4) | ravine, south side | P17 | (−13, 18) | |
| P7 | (−12, −16) | ravine, north side | P18 | (−12, 30) | |
| P8 | (−12, −24) | 6 m outside egg chamber east door | P19 | (−22, 34) | 8 m outside crypt main door |
| P9 | (−10, −38) | through the west gate | P20 | (−8, 42) | lawn above the pier |
| P10 | (−2, −42) | courtyard; **Hyde start** (96 m from the player start) | | | |

- **Near every room, never inside one.** The loop passes 6–8 m from every key doorway, so walking (7 m) and sprinting
  (13 m) inside a room near a door can be heard. Crouching inside cannot. Walls halve the radii, so the deep corners of
  rooms are safe places to work.
- **Learnable.** The loop keeps one direction: south lawn → research → ravine → courtyard → terrace → ravine → crypt →
  lawn. Because it uses the ravine twice, the ravine is the hot spot. Players learn to time it or to take the crypt
  route instead.
- **Fair start.** The Hyde starts 96 m away in the courtyard. It needs about 60 s to reach the lawn. By then most
  players are inside the research room or the crypt.
- **Clearance-checked.** Every straight segment (including P20 → P0) keeps ≥ 0.6 m plus the obstacle radius from every
  wall and cover piece, so patrol works even before nav-grid smoothing.
- The patrol never enters the pier pocket. That keeps the tutorial safe, and the safe-release point (0, 49) stays calm.

---

## 4. The case: truth table (RETIRED — the single "Silent Evidence" case; see §4b for the three live cases)

Culprit: **thornhill** (fixed). Each clue adds one chain link against the same person and clears at most one other
suspect:

| Clue | Link | implicates | exonerates |
|---|---|---|---|
| transfer_note | ACCESS: vault sequence plus signed slip, 11:32/11:40 pm | thornhill | none |
| master_key | KEY: guard key in an archive pouch; Dort reported it missing at 10:55 pm, watch log co-signed | thornhill | barry |
| greenhouse_trace | RELEASE: resin and seal from signed-out kit on the latch; Isaac's prints are old and explained by his repair log | thornhill | isaac |

Recommended board logic: *still possible = all suspects − exonerated by found clues*; *links against X = found clues
that implicate X*.

| Clues found | Still possible | Links on Thornhill | What the player may fairly conclude | Verdict if Thornhill accused | Verdict if other accused |
|---|---|---|---|---|---|
| none | T, I, B | 0 | nothing | unsolved | unsolved |
| note | T, I, B | access | T had the chance; nobody is cleared | unsolved | unsolved |
| key | T, I | key | Dort is cleared; Isaac is unexplained | unsolved | unsolved |
| trace | T, B | release | Isaac is cleared; Dort (key holder) is unexplained | unsolved | unsolved |
| note + key | T, I | access, key | strong case against T; Isaac still unexplained | unsolved | unsolved |
| note + trace | T, B | access, release | strong case against T; Dort's key unexplained | unsolved | unsolved |
| key + trace | T | key, release | **only T remains by elimination**, but the access and timing link is missing | unsolved | unsolved |
| all three | T | full chain | **T, proven**: access + key + release, both others explained | **case_solved** | unsolved |

**Design caveat (logical limit).** With three suspects and per-clue implicate/exonerate sets, *some* pair of clues
must clear both innocents. That is a mathematical property of any monotone elimination rule, so it cannot be avoided.
I put that pair at key + trace. A careful player can name Thornhill after two clues there. The contract still
requires all three clues for "Case Solved", and the board should say "by elimination, chain incomplete" for that row.
No single clue clears both alternatives, and no single clue is an unfair leap. No clue text or deduction says who is
the killer. Suspect `alibiOrContext` is neutral. Exonerating facts only appear inside found clues.

Wrong accusations and "Leave the case unsolved" both give `egg_secured_mystery_unsolved` / `not_accused`. The results
screen never reveals the culprit on a wrong verdict.

---

## 4b. Three cases (case system v1)

§4 above and the `case.ts` row of the file table describe the retired single case (`SILENT_EVIDENCE`, clue ids
`transfer_note` / `master_key` / `greenhouse_trace`). Since the three-case feature the public case data lives in
`src/mystery/data/cases.ts` (`CASES`) and the answer keys only in `src/mystery/data/solutions.ts` (`CASE_SOLUTIONS`,
never imported statically by browser code — `tests/unit/mystery/caseSecrecy.test.ts`). Integration contract:
`docs/MYSTERY_CASES.md`. The three cases are alternate scenarios of the same night on the same island: walls, cover,
hiding spots and the Hyde patrol are identical; a case moves its three clues and the egg and renames rooms.

**One rule for every case.** Three clues, each proving one link against the SAME person: METHOD, OPPORTUNITY and a
BROKEN ALIBI. The culprit is named in all three clues; each innocent is named in exactly one clue, and that clue is the
one that clears them. So no single clue settles anything, one clue (the one naming only the culprit) clears nobody, and
the remaining pair clears both innocents *by elimination* while one link of the chain is still missing. `case_solved`
needs all three clues found ∧ the culprit accused ∧ exactly the three clues cited (`caseLogic.verdictFor`). Two
case-file notes are held from the start: tempting, they name nobody and support nobody; citing one makes the
deduction incorrect. `deductionCorrect` reports the cited evidence only (an innocent accused with the right three
clues still has `deductionCorrect = true`, `correct = false`, verdict unsolved).

Enforced by tests: `cases.test.ts` (structure, names, links, wording and length budgets), `rules.test.ts` (8 clue
subsets × 3 suspects × 6 evidence sets per case), `caseIslands.test.ts` (rooms, clearance, reachability),
`caseRuns.test.ts` (21 duos per case solved by the bot, accusation rules, F powers per case, determinism).

### Case 01 — The Poisoned Archive (culprit: Marilyn Thornhill)

| Clue (room, spot, search) | Proves | Names | Clears | Why |
|---|---|---|---|---|
| `falsified_transfer` — Research Archive (`research_room`, 38, −6, 2.5 s) | opportunity | Thornhill | — | the false transfer was filed with her archive credentials from an archive terminal at 11:31 pm |
| `botanical_residue` — Greenhouse Annex (`path`, 1, −26, 3 s) | method | Thornhill, Isaac | Isaac | the teacup poison is the tincture signed out under Thornhill at 10:58 pm; Isaac returned the only other key at 9:05 pm |
| `access_ledger` — Records Crypt (`crypt`, −22, 21, 2.5 s) | alibi | Thornhill, Barry | Barry | her badge opened the annex (10:55) and the archive (11:29) while she claims the reading room; Barry's card stays on the east wall all night |

Egg: Egg Chamber shrine (−28, −20). Notes: *Muddy Boots in the Hall* (hints at the groundskeeper; his logged drain
work), *Keys Heard at Midnight* (hints at Barry's key ring; his rounds). Innocents: Isaac (key back at 9:05, never
retaken), Barry (east-wall gate checks every ten minutes). Elimination pair: residue + ledger (opportunity missing).

### Case 02 — The Crypt's Last Witness (culprit: Isaac Night)

| Clue (room, spot, search) | Proves | Names | Clears | Why |
|---|---|---|---|---|
| `sabotaged_gate` — Collapsed Crypt (`crypt`, −22, 21, 2.5 s) | method | Isaac | — | pin drawn, chain filed; the mechanism is assigned to Isaac alone |
| `tunnel_access_record` — Maintenance Tunnel (`shortcut`, 31, −22, 2.5 s) | opportunity | Isaac, Thornhill | Thornhill | Isaac signed into the tunnel at 11:12 pm, minutes before the fall; Thornhill signed out at 8:55 pm |
| `equipment_match` — Egg Chamber by the cage (`egg_chamber`, −40, −31, 3 s) | alibi | Isaac, Barry | Barry | his "I.N." tool roll holds the filings, the brass pin and fresh tunnel clay (he says he never went into the tunnels); the harbour master logs Barry at the pier at 11:15 pm |

Egg: the crypt's burial vault (−38, 18), west of the inner wall. Notes: *Archive Boxes in the Tunnel* (hints at
Thornhill; her 8:40 pm visit), *The Crypt Bell* (nobody). Elimination pair: tunnel + tool roll (method missing).

### Case 03 — The Midnight Signal (culprit: Barry Dort)

| Clue (room, spot, search) | Proves | Names | Clears | Why |
|---|---|---|---|---|
| `falsified_patrol_log` — Guard Post Passage (`shortcut`, 30, −28, 2.5 s) | alibi | Barry | — | his own "north wall — all clear" entry is rewritten in fresh ink; the north-wall lamps were never lit |
| `alarm_override` — Security Control Room (`research_room`, 40, 8, 2.5 s) | method | Barry, Thornhill | Thornhill | alarms off and the false lockdown sent with security card #3 (Barry's); archive cards have no clearance here |
| `watchtower_signal` — Watchtower Yard (`courtyard`, 18, −48, 3 s) | opportunity | Barry (as "the guard"), Isaac | Isaac | the guard's all-clear code was flashed from beside the egg path at 11:22 pm; Isaac's vent crank turned every five minutes 11:00–11:45 |

Egg: greenhouse potting shed (5, −27), beside planter 1 (0.4 m clear of it). Notes: *Light in the Greenhouse* (hints
at Isaac), *Archive Door Ajar* (hints at Thornhill). Elimination pair: override + watchtower (alibi missing).
Content note: `watchtower_signal` refers to Barry only by role ("the guard's"); `mentions` counts it and the tests
accept role words. Writing "B. Dort's" into that text would make the name count plain to every reader.

### Board states (same shape in every case)

| Clues found | Innocents still unexplained | Chain against the culprit | Fair conclusion | Verdict if culprit accused |
|---|---|---|---|---|
| none / any one | 1–2 | at most 1 link | nothing certain | unsolved |
| the two clues that each name an innocent | 0 | 2 links | culprit by elimination, chain incomplete | unsolved |
| any other pair | 1 | 2 links | strong suspicion, one alternative open | unsolved |
| all three | 0 | method + opportunity + alibi | proven | **case_solved** (if exactly the 3 clues are cited) |

### Routes and pacing (computed on the nav grid, player radius, shortcut gate closed)

| Case | Nearest-first tour (what the bot walks), metres | Shortest order | Search total | Human estimate (active) | Bot median, 21 duos (126 duos) | Bot runs caught / 126 |
|---|---|---|---|---|---|---|
| 01 | ledger 42 → residue 54 → transfer 79 → egg 83 → tower 51 = **308 m** | ledger → transfer → residue, 282 m | 8 s | ~185–230 s | 171 s (161 s) | 7 |
| 02 | gate 42 → tool roll 56 → tunnel 106 → egg 95 → tower 90 = **389 m** | tunnel → gate → tool roll, 365 m | 8 s | ~225–270 s | 196 s (191 s) | 12 |
| 03 | console 62 → patrol log 39 → watchtower 122 → egg 25 → tower 27 = **275 m** | the same, 275 m | 8 s | ~180–215 s | 172 s (174 s) | 20 |

Human estimate = route × 1.3 at ~2.7 m/s mixed movement + ~10 s of searching / pickup / deposit + 25–45 s hiding +
15–25 s orientation (the same model as §8). Add ~90–120 s for menus, case-file reveal, prologue, tutorial and
accusation, which gives a **5–7 min visit** in every case. Case 02 is the longest walk: the tunnel clue sits in the
dead-end alley in the far east, and the egg is back in the far-west crypt. Case 03 is the shortest walk but the most
dangerous. The watchtower clue, the egg and the tower all sit on the Hyde's courtyard/terrace loop (P9–P14), so bot
catches are about 3× Case 01 and the spread is the widest (bot max 351 s over 126 duos). In the bot sweep all 126 duos
solved every case (stealthy profile, abilities on for every other duo, 0 DNF, 0 timeouts). Powers help but are never
required. These are bot numbers, not playtest measurements.

---

## 5. Roster balance

Base values: walk 3.2 m/s, sprint 5.5 m/s, clue search 2.5 s, grab 35 HP, grab egg loss 40.
"Walk heard" uses walk loudness 0.35 × footstepNoiseMult through `hearingRadiusM`.
**Ctrl s/min** = Hyde-control effect-seconds per minute = Σ duration × weight × 60 / cooldown. Weights: stun 1,
slow × magnitude, distract 0.6, lure 0.5.

### 5.1 Nightshades (F)

| Character | Roles | Walk / Sprint m/s | Walk heard | Search | Grab HP | Grab egg loss | F power | CD | Noise | Ctrl s/min |
|---|---|---|---|---|---|---|---|---|---|---|
| Wednesday | investigation, stealth | 3.20 / 5.23 | 6.3 m | 2.13 s | 35 | 40 | reveal nearest clue ≤ 35 m, 6 s | 40 | 0 | 0 |
| Morticia | stealth, support | 3.04 / 5.23 | 5.6 m | 2.75 s | 35 | 40 | premonition: 6 s path shown for 5 s | 40 | 0 | 0 |
| Enid | mobility, investigation | 3.36 / 6.35 | 7.5 m | 2.75 s | 35 | 40 | +25 % speed 7 s (steps ×1.4) + scent trail ≤ 25 m | 45 | 0.3 | 0 |
| Bianca | control, support | 3.20 / 5.50 | 6.7 m | 2.50 s | **42** | 40 | lure ≤ 18 m, 4 s | 50 | 0.3 | 2.4 |
| Eugene | investigation, control | 3.04 / 5.23 | 7.0 m | 2.13 s | 35 | **44** | reveal clue ≤ 15 m + distract ≤ 12 m, 5 s | 45 | 0.3 | 4.0 |
| Gomez | control, mobility | 3.36 / 5.78 | 7.4 m | 2.50 s | **28** | 40 | power switch ≤ 4 m, else stun 2 s ≤ 8 m (LOS) | 50 | **0.8** | 2.4 |
| Ajax | control, defense | 3.04 / 5.23 | 7.0 m | 2.50 s | 35 | **32** | stun (petrify) 2.5 s, 12 m, 40° cone, LOS | 60 | 0.1 | 2.5 |

Bianca's `hydeEffectDurationMult` 1.15 lengthens the stun, slow and distract effects of her Pokémon move. Under the
current contract wording it does **not** stretch lures (see §9).

### 5.2 Pokémon (Q)

| Pokémon | Types | Roles | Mods | Move | Effect(s) | CD | Noise | Ctrl s/min |
|---|---|---|---|---|---|---|---|---|
| Gengar | Ghost/Poison | control, stealth | foot 0.95 | Shadow Ball | lure 22 m 3 s (0.9) + stun 0.8 s LOS | 25 | 0.2 | 5.5 |
| Alolan Marowak | Fire/Ghost | investigation, support | egg 0.9 | Will-O-Wisp | reveal_hazards 15 m 8 s + lure 10 m 2 s | 22 | 0.2 | 2.7 |
| Misdreavus | Ghost | stealth, control | foot 0.9 | Confuse Ray | distract 4 s, 14 m, LOS | 26 | 0.05 | 5.5 |
| Galarian Corsola | Ghost | defense, control | walk 0.95, catch 0.9 | Strength Sap | slow 40 % 5 s 8 m LOS + heal 10 | 30 | 0.2 | 4.0 |
| Sableye | Dark/Ghost | control, investigation | interact 0.9 | Shadow Sneak | stun 1.2 s 6 m LOS | **18** | 0.15 | 4.0 |
| Dusknoir | Ghost | defense, control | walk 0.95, catch 0.9 | Shadow Punch | stun 1.8 s 3 m, no LOS (grab breaker) | 24 | 0.4 | 4.5 |
| Drifblim | Ghost/Flying | mobility | egg 1.1 | Tailwind | +30 % speed 6 s, steps ×1.3 | 30 | 0.25 | 0 |
| Froslass | Ice/Ghost | control, stealth | foot 0.9 | Icy Wind | slow 45 % 5 s, 10 m 60° cone LOS | 26 | 0.35 | 5.2 |
| Jellicent | Water/Ghost | control, defense | catch 0.9, sprint 0.95 | Water Pulse | lure 14 m 5 s (0.7) + stun 0.6 s LOS | 28 | 0.3 | 6.6 |
| Chandelure | Ghost/Fire | investigation | interact 0.9 | Will-O-Wisp | reveal clue 20 m 6 s + reveal_hazards 12 m | 30 | 0.45 | 0 |
| Aegislash | Steel/Ghost | defense | walk 0.95, egg 0.9 | King's Shield | block_grab 6 s (catch still counts) | 35 | 0.2 | 0 |
| Trevenant | Ghost/Grass | control, support | egg 0.9, sprint 0.95 | Leech Seed | slow 35 % 6 s 12 m (no LOS) + heal 8 | 30 | 0.15 | 4.2 |
| Dhelmise | Ghost/Grass | defense, control | walk 0.95, egg 0.85 | Anchor Shot | slow 60 % 3 s 10 m LOS + egg_shield 75 % 8 s | 32 | 0.4 | 3.4 |
| Decidueye | Grass/Ghost | control, investigation | interact 0.95 | Spirit Shackle | stun (pin) 2 s 15 m LOS | 30 | 0.2 | 4.0 |
| Dragapult | Dragon/Ghost | mobility, control | sprint 1.05, foot 1.05 | Dragon Darts | stun 1 s 18 m LOS + lure 18 m 3 s | 26 | 0.3 | 5.8 |
| Basculegion | Water/Ghost | mobility | walk 1.03, interact 1.1 | Aqua Jet | dash 5 m | **18** | 0.45 | 0 |
| Ceruledge | Fire/Ghost | defense, control | catch 0.9, foot 1.05 | Bitter Blade | stun 1.5 s 3.5 m no LOS + heal 10 | 28 | 0.45 | 3.2 |
| Gholdengo | Steel/Ghost | control, defense | walk 0.95, egg 0.9 | Make It Rain | lure 15 m 4 s (0.9) + egg_shield 50 % 6 s | 35 | 0.5 | 3.4 |

Pure-utility moves (Drifblim, Chandelure, Aegislash, Basculegion, Marowak) score 0–2.7 on control. They pay for that
with mobility, investigation or defense. That makes each card a trade-off rather than a power ranking.

### 5.3 Extremes of the 126 combinations (raw products, before the 0.6–1.4 clamp)

| Quantity | Best duo | Worst duo | Range |
|---|---|---|---|
| Grab HP | Gomez × (Corsola, Dusknoir, Jellicent or Ceruledge): 25 | Bianca × anything without a catch mod: 42 | 25–42 |
| Grab egg loss | Ajax × Dhelmise: 27 | Eugene × Drifblim: 48 | 27–48 |
| Search of a 2.5 s clue | Wednesday/Eugene × Chandelure/Sableye: 1.9 s | Enid/Morticia × Basculegion: 3.0 s | 1.9–3.0 s |
| Sprint carrying egg | Enid × Dragapult: 5.67 m/s | e.g. Morticia × Aegislash: 4.22 m/s | always > Hyde chase 4.0 |
| Walk heard | Morticia × Misdreavus/Froslass: 5.0 m | Enid × Dragapult: 7.7 m | 5.0–7.7 m |

Nothing is permanent. Effects last ≤ 8 s after multipliers. Stuns repeated within 10 s are halved. Slows never go
below 40 % of Hyde speed. King's Shield blocks damage but the catch still counts. Make It Rain never changes egg
points.

---

## 6. Stat formula intent (for `src/mystery/stats.ts`, game-developer)

All six card stats must be **monotone functions of the real numbers above**. Each is computed on the combined
`PlayMods` (`combineMods` = Nightshade × Pokémon, then clamped to `MYSTERY_TUNING.modsClamp` 0.6–1.4) plus the F and Q
`effects`. Shape: `stat = round(1 + 4 × clamp01(score))`, an integer from 1 to 5. A neutral duo (all mods 1, no
relevant effect) lands at **2**, which is "typical" on the UX scale (1 low, 3 typical, 5 high). The legend says
typical = 3, so if the UI team prefers neutral to be 3, change the constant 1 to 2 and the multiplier 4 to 3.

Helpers:
- `lin(x, best, worst)` = clamp01((worst − x) / (worst − best)), so a smaller multiplier is better.
- `u(e)` = effect-seconds per minute = `min(e.durationS × durMult, 8) × 60 / cooldownS`. `durMult` = `hydeEffectDurationMult`
  for stun, slow and distract, and 1 otherwise.

| Stat | Passive part (weight) | Active part (weight) | Anchors |
|---|---|---|---|
| **Investigation** | `lin(interactTimeMult, 0.8, 1.2)` (0.5) | `min(1, R / 9)` (0.5), where `R = Σ reveal_clues u × min(1, rangeM/25) + Σ reveal_hazards 0.5 × u × min(1, rangeM/15)` | Wednesday alone: R = 9, so 5; Eugene 4; Enid 4; neutral 2 |
| **Stealth** | `lin(footstepNoiseMult, 0.75, 1.25)` (0.6) | `min(1, S / 8)` (0.4), where `S = Σ distract 0.6·u + Σ premonition u + Σ lure 0.5·u`; subtract `Σ speed_boost u × (noiseMult − 1) × 0.5` | Morticia 5; Wednesday 3; Enid 1 |
| **Mobility** | `clamp01((walk × (0.5 + 0.5 × sprint) − 0.85) / 0.35)` (0.6) | `min(1, M / 15)` (0.4), where M = metres gained per minute: speed_boost `magnitude × durationS × 3.2 × 60 / cd`; dash `magnitude × 60 / cd`; power_switch `+6` | Enid 4; Enid × Basculegion 5; neutral 2 |
| **Defense** | `lin(catchDamageMult, 0.75, 1.25)` (0.6) | `min(1, D)` (0.4), where `D = 0.8·[block_grab] + Σ healHp × 60 / cd / 25 + 0.4·[stun with rangeM ≤ 4 and no LOS]` | Gomez 3; Gomez × Aegislash 4; Bianca 1 |
| **Hyde Control** | none | `min(1, C / 10)` (1.0), where `C = Σ (stun u + slow u × magnitude + distract 0.6·u + lure 0.5·u)` over F and Q | Wednesday × Aegislash 1; Ajax × Decidueye 4; Eugene × Jellicent 5 |
| **Egg Protection** | `lin(eggSecurityLossMult, 0.75, 1.25)` (0.6) | `min(1, E / 6)` (0.4), where `E = Σ egg_shield magnitude × u + 0.4 × u(block_grab)` | Ajax × Dhelmise 5; Eugene × Drifblim 1; neutral 2 |

Rules for truthfulness:
1. Each stat must depend only on the variables listed. A unit test should assert monotonicity, for example that
   lowering `interactTimeMult` never lowers Investigation.
2. Card advantages and disadvantages should come from the registries' strings: two from the character and Pokémon
   pool, picked by largest deviation, and 1–2 disadvantages. Never write new claims.
3. **Role** for the card should be the role tag shared by both members, or else the role whose stat is highest:
   investigation → Investigation, stealth → Stealth, mobility → Mobility, defense → max(Defense, Egg Protection),
   control → Hyde Control, support → mean(Defense, Investigation).

---

## 7. Tuning rationale (key timings)

| Mechanic | Value | Why |
|---|---|---|
| Patrol 2.4 / investigate 3.0 / search 2.2 / chase 4.0 / cooldown 2.0 m/s | | Walking (3.2) outpaces a patrol. Sprinting (≥ 4.96 empty, ≥ 4.22 carrying) beats a chase. Walking does not. |
| Sight 100° cone, 13 m (8 m in fog), crouch × 0.7 | | A crouching player in the open is seen at 9.1 m, or 5.6 m in fog |
| Suspicion: sight 0.9/s × (1 + closeness); chase at 1.0 | | A visible ramp of 0.55–1.1 s before a chase, unless within 3 m |
| Hearing: + 0.6 × loudness per heard step; investigate at 0.3 | | Two walking steps (1 s) or one sprint step starts an investigation. Crouch steps (+0.06) almost never do. |
| Chase loss 4 s → search 8 s → cooldown 5 s | | Plan values. Breaking line of sight for 4 s is the main escape skill. |
| Grab: range 1.2 m, wind-up 0.7 s, −35 HP, −40 egg security, 3 s invulnerable, Hyde cooldown 6 s | | A fair reaction window for Q/F interrupts. A release never chains into a second grab. |
| Egg security: impact −8 (sprint ≥ 4.5 m/s into an obstacle), drop when ≤ 30, never below 0 | | Security is tension and feedback. It never makes delivery impossible and never changes points. |
| Search noise 0.15 per second | | Searching beside a doorway can be heard at ~3 m. Searching in the corner of a room is safe. |

---

## 8. Pacing estimate (target: play portion ≈ 245 s of the 360 s visit)

Shortest legal walking routes, computed from waypoints around obstacles:

| Order | Route | Metres |
|---|---|---|
| A | pier → research note → crypt key → egg-chamber trace → egg → west gate → tower | **~271 m** |
| B (Gomez) | pier → crypt key → trace → egg → ravine → research note → **shortcut** → tower | **~261 m** |
| B (others) | same as above, long way back via the ravine | **~308 m** |

Real players walk about 1.25–1.4 times the shortest route (looking around, backtracking, detours to hiding spots).
That gives **~340–430 m walked**, which falls in the requested 350–450 m band.

| Component | Estimate |
|---|---|
| Movement: 271–308 m × 1.3, mixed 55 % walk / 25 % crouch / 20 % sprint or carry | 130–150 s |
| Searches (2.5 + 2.5 + 3.0) + egg pickup 1.2 + deposit 1.0 | ~10 s |
| Hiding and waiting for the patrol (2–3 encounters × 10–15 s) | 25–45 s |
| Orientation, power use, reading captions | 15–25 s |
| **Active play total** (the board pauses the clock) | **~180–230 s** |
| Evidence-board reading (clock paused, still visit time) | 15–25 s |

That lands at or just under the plan's 245 s. The margin is intentional, because first-time visitors are slower than
any estimate. If playtests run long, the first knobs are: shorten the patrol lap (move P1/P2 closer), reduce search
times to 2.0 s, or raise walk speed to 3.4 m/s. Score check: a Rare egg delivered at 200 s scores 300 − 200 = 100. A
Common egg at 200 s scores −100. Negative scores are allowed by the rules.

---

## 9. Open items and requests to the orchestrator (types are not edited)

1. **`AbilityEffect` parameter semantics** are not documented in `types.ts` for: `reveal_clues.magnitude` (I use the
   max number of clues, nearest first), `lure.magnitude` (I use decoy loudness 0..1), and `premonition.rangeM` (I use
   the max Hyde distance). Please add these to the kind comments.
2. **Scent trail:** `ActiveEffects.scentTrail` has no effect kind. Wolf Shift is expressed as `speed_boost` +
   `reveal_clues`. Either add a `'scent_trail'` kind, or rule that "reveal_clues inside an ability that also has
   speed_boost renders as scentTrail".
3. **Petrify / pin visuals:** `hydePetrified` cannot be derived from `kind: 'stun'` alone. Suggest an optional
   `AbilityEffect.visual?: 'petrify' | 'pin' | 'shock' | 'impact'` field. Until then, use the rule "stun with coneDeg →
   petrified; stun with needsLineOfSight and rangeM ≥ 15 → pinned".
4. **`hydeEffectDurationMult` and lure:** the contract limits it to stun, slow, distract and pin. Bianca's advantage
   text follows that wording. Including lure would be more intuitive, but the change is optional.
5. **`power_switch` fallback:** documented in data as "otherwise apply the next effect (stun)". Please confirm this in
   the interpreter.
6. **Wet terrain:** `RoomDef.wet` exists, but no effect reads it. The plan says Aqua Jet is a "dash through wet
   terrain". Optional: `dash` magnitude × 1.4 inside wet rooms (the pier and the egg chamber).
7. **Traps:** plan §7 says "preserve … trap damage". `MapDef` has no hazard or trap type, so none are placed. If wanted:
   `hazards?: { id; x; z; radius; hpLoss; noise }[]`.
8. **Thing line types:** `ThingLine` and `ThingPose` live in `thing.ts`. Move them into `types.ts` if the frontend
   prefers to import from there.
9. **Clue labels:** each `ClueDef` carries its own `interactLabel` (case system v1; `CLUE_INTERACT_LABELS` is retired).

---

## 10. Overhaul (2026-10-23): case worlds, candidate sites, Hyde emergence

Data: `src/mystery/data/caseWorlds.ts` (`CASE_WORLDS`, `caseWorld()`), contract `docs/overhaul/OVERHAUL_CONTRACT.md`.
Content version **2** for all cases (`CaseDef.version` = `CaseSolution.version` = 2; answers unchanged). §2.4 and
the §4b position columns are now only the *default* layout (`buildIsland()` uses the first site of each group).
Everything below is computed from geometry by hand, not measured in play or by the bot (no shell this pass).

### 10.1 What every case adds to the shared island

| | Case 01 Poisoned Archive (`archive`) | Case 02 Crypt's Last Witness (`crypt`) | Case 03 Midnight Signal (`signal`) |
|---|---|---|---|
| Layout | 2 bookshelf rows in the archive, 2 staggered stacks in the alley, vine-walled greenhouse (open east), record-shelf serpentine in the crypt vault, lab bench / centrifuge / smashed still | rubble narrows the vault mouth to 3.4 m and the cage pocket, 2 rock falls zig-zag the tunnel (3.15 / 3.5 m squeezes), 3 coffins, fallen gate, broken boiler | east-lawn guard hut (3.4 m door), 2 server racks, fence chicane in the guard post, 37 m security fence at x 17 with a checkpoint gate, L-shaped yard hut, 5 equipment crates |
| Passage | `pa_bookcase` closes crypt → vault door (x −36, z −8); lever (−32, −4.5) on the crypt side | `cw_rubble_door` fills the catacombs' east door (x −18, z −24); winch (−22, −27) inside | `ms_gate` in the fence (x 17, z −39.5..−43.5); lever (15, −43) by the tower |
| Without the passage | vault via its east door (terrace) | catacombs via the crypt's north door | yard round the fence's north end (3.35 m corridor behind the tower) |
| Shortcut saves | crypt hall → vault shrine 65 m → 15 m | catacombs → tower 102 m → 51 m | tower door ↔ yard 33 m → 10 m (each way) |
| Hazards | broken glass (greenhouse floor), creaky boards (archive north aisle), +0.25 per step | loose rubble (crypt east door), tunnel puddles, +0.25 per step | yard searchlight (30, −48) r 14 m 24° 10 s; tower searchlight (−3, −49) r 13 m 24° 12 s (west-gate approach only — the east gate avoids it) |
| Examines (trace?) | cracked vial (archive, ✓), toppled books (crypt hall, ✓), cut vines (greenhouse, ✗) | flickering lantern (crypt hall, ✓), cobwebbed winch (tunnel, ✓), torn cobwebs (catacomb door, ✗) | crackling radio (control room, ✓), boot prints (yard, ✓), silenced alarm (guard hut, ✗) |
| Renamed rooms | research_room Research Archive · crypt Records Crypt · egg_chamber Restricted Vault · shortcut Rare Book Stacks | crypt Collapsed Crypt · shortcut Maintenance Tunnel · egg_chamber Catacombs · research_room Lamp Room | research_room Security Control Room · shortcut Guard Post Passage · courtyard Watchtower Yard · egg_chamber Old Kennel |

Sketches (only the case additions; `S` = clue site, `E` = egg site, `L` = lever, `H` = Hyde spawn, `*` = searchlight,
`~` = noisy floor, `X` = passage wall, `=`/`|` = new wall). Not to scale.

```
CASE 01 — west half                          CASE 01 — east half (Research Archive + Rare Book Stacks)
 crypt vault (x -43..-30, z 8..26)            z -10 ===res_n===[N door]=========    alley x 26..36
   |===pa_rec_1 z15===|   E reliquary(-33.5,18.5)  ~~~~ boards ~~~~ S desk(38,-6)  |==stack_1 z-18
   |      |===pa_rec_2 z11 (to inner wall)    z -2   ====res_shelf====              |  S stacks(31,-24)
 hall: books(-26,2)  L(-32,-4.5)             z 3  pa_shelf_2(x24)  ====pa_shelf_1===  stack_2 z-29==|
 ====X pa_bookcase (x -38.5..-33.5, z -8)====       vial(23,7)  bench  centrifuge  cabinet-hide
 Restricted Vault: S specimen(-40,-20) E shrine(-28,-20)
 terrace: E store(-6,-28)  |greenhouse| S shelf(1,-26)  H gh entrance(11,-18)  H vault door(-12,-24)
          (vines hide -6,-24)   ~glass~ open east       H archive hall (14,4)

CASE 02 — crypt + catacombs                  CASE 02 — Maintenance Tunnel (alley)
  vault: coffin(-40.5,12)  E altar(-36.5,15)   z -10 [N door]   switch(33,-13)
         S niche(-32.5,17.5) coffin(-33,22.5)  z -16 ====cw_tunnel_1====   . 3.15 m
  ====cw_rubble_vault z8==== . 3.4 m mouth     z -20.5 S sign-in(29.5,-20.5)   winch examine(33.5,-20)
  hall: ~rubble~ at east door  E gatehouse(-22,10)  S gate(-26,21.5)  fallen gate  lantern(-20.5,14)
  catacombs: coffin(-36.5,-12.5)  E nest(-28,-20)  L winch(-22,-27)  X cw_rubble_door (x -18)
  cage: ===cw_rubble_cage z-26=== . 3.4 m gap   S by the cage(-40,-31)    ~puddles~ z -24..-17
  H side door(-11,4)  H ravine(-12,-16)  H terrace drain(19,-19.8)   lamp room: S locker(38,-6) boiler

CASE 03 — courtyard / Watchtower Yard (north)            CASE 03 — east lawn + control room
 cliff ------------------------------------------- z-58    hut  |=====ms_hut_n z20=====|
   tower x3..13 |corridor| fence end z-54.5   E crates(37,-52)   door|  S? none  hide  |cliff
   *(-3,-49)    |3.35 m  |ms_fence_2   S recorder(25,-51) *(30,-48)  |=====ms_hut_s z27.5==|
   crates (-8,-46) (0,-50)  L(15,-43) X ms_gate  prints(21,-44)  yard hut L (35,-39)  alarm examine(35,25.5)
   S relay (-22,-46)        |ms_fence_1  S booth(20.5,-38)            H control lawn (30,22)
 ====west gate (H -10,-38)===east gate===|==court_s_3==|GOMEZ GATE|==   control room: S console(40,8), 2 racks,
                                                                       radio examine (25,9)
 guard post (alley): ==ms_post_fence z-22== S desk(30,-27) crates   E shed(3.5,-28) terrace  H greenhouse(2,-16)
```

### 10.2 Candidate clue sites (priors per clue; `location` reads true for every site)

| Case | Clue | Site → prior (area, room, x, z) | Why these places |
|---|---|---|---|
| 01 | falsified_transfer | archive desk **0.6** (Research Archive, research_room, 38, −6) · stacks terminal **0.4** (Rare Book Stacks, shortcut, 31, −24) | "filed from an archive terminal": both are archive terminals; the desk is the obvious one |
| 01 | botanical_residue | inventory shelf **0.6** (Greenhouse Annex, path, 1, −26) · specimen cabinet **0.4** (Restricted Vault, egg_chamber, −40, −20) | the tincture inventory sits with the plants or in the locked specimen store |
| 01 | access_ledger | door ledger **1.0** (Records Crypt, crypt, −22, 21) | the text says the ledger is *stored in the old crypt*; a fixed, close first objective (42 m) |
| 02 | sabotaged_gate | gate mechanism **1.0** (Collapsed Crypt, crypt, −26, 21.5) | the gate is where it is |
| 02 | tunnel_access_record | tunnel sign-in desk **0.55** (Maintenance Tunnel, shortcut, 29.5, −20.5) · lamp-room locker **0.45** (Lamp Room, research_room, 38, −6) | a "lamp-room sign-in for the tunnel" can lie at either end |
| 02 | equipment_match | by the cage **0.6** (Catacombs, egg_chamber, −40, −31) · coffin niche **0.4** (Burial Vault, crypt, −32.5, 17.5) | stashed underground; text broadened from "by the Hyde's cage" to "underground" |
| 03 | falsified_patrol_log | guard post desk **0.55** (Guard Post Passage, shortcut, 30, −27) · checkpoint booth **0.45** (Restricted Yard, courtyard, 20.5, −38) | a guard's log lives at a guard post |
| 03 | alarm_override | override console **1.0** (Control Room, research_room, 40, 8) | the console is fixed hardware |
| 03 | watchtower_signal | signal recorder **0.6** (Restricted Yard, courtyard, 25, −51) · relay recorder **0.4** (West Signal Post, courtyard, −22, −46) | both are watchtower recorders in the Watchtower Yard; text now says "flashed from beside the egg path" |

All clue searches are 2.5 s (× interactTimeMult). Every site is ≥ 1.5 m from every wall surface (so no walkable cell
on the far side of a wall is within the 1.8 m interact range: 1.5 + wall thickness + 0.4 player radius > 1.8),
≥ 0.3 m from cover, and in the room it declares (first match: tower, pier, research_room, crypt, egg_chamber,
shortcut, courtyard, path). Sites of one case are ≥ 3 m apart (closest pair: Case 02 coffin niche ↔ vault altar 4.7 m).

### 10.3 Egg sites (priors, traces) — `traceAccuracy` 0.75 in every case

| Case | Site → prior | Trace text | Role |
|---|---|---|---|
| 01 | Potting store (−6, −28) **0.5** | Nest straw leads toward the greenhouse storage. | central, by the patrol (S8 5.4 m); short carry (~32 m) |
| 01 | Vault shrine (−28, −20) **0.3** | Cold shell dust trails toward the Restricted Vault. | **guarded**: behind the bookcase / beside the cage, pillar ring |
| 01 | Reliquary (−33.5, 18.5) **0.2** | Warm wax drips lead into the Records Crypt. | deep in the shelf serpentine |
| 02 | Vault altar (−36.5, 15) **0.5** | Scraped dust leads toward the burial vault. | through the 3.4 m rubble mouth |
| 02 | Catacomb nest (−28, −20) **0.3** | Damp straw trails down into the catacombs. | **guarded**: the cage room; the winch shortcut matters most here |
| 02 | Gatehouse (−22, 10) **0.2** | Shell grit glitters by the collapsed gatehouse. | open hall, near the gate clue |
| 03 | Potting shed (3.5, −28) **0.5** | Soil tracks lead toward the potting shed. | central; carry ~30 m |
| 03 | Yard crates (37, −52) **0.3** | Crate marks lead into the restricted yard. | **guarded**: fence + searchlight |
| 03 | Kennel straw (−28, −20) **0.2** | Straw drifts toward the old kennel. | far west decoy-risk |

Case 02's egg sites are deliberately clustered in the west (≤ 40 m apart) because its tunnel clue is in the far east —
this caps the longest case's walking. Bayes example (Case 01, one trace pointing at the potting store): posterior ∝
0.5×0.75 : 0.3×0.125 : 0.2×0.125 = 0.375 : 0.0375 : 0.025 → **86 % / 9 % / 6 %**. A second agreeing trace → 97 %.
A site seen empty → 0 and the rest renormalise. With 3 clue traces + 2 examine traces per case the egg is usually
pinned down before the third clue — the probabilities *visibly* earn their keep.

### 10.4 Hyde emergence points (weights; renormalised over spawns ≥ 25 m from the player at t = 20 s)

| Case | Spawn (x, z) → weight | Zone | On patrol | From pier start |
|---|---|---|---|---|
| 01 | Archive Hallway (14, 4) **0.45** · Greenhouse Entrance (11, −18) **0.35** · Restricted Vault Door (−12, −24) **0.20** | mid · terrace · terrace | P4 · on P13→P14 · P8 | 52 · 73 · 98 m |
| 02 | Crypt Side Door (−11, 4) **0.40** · Ravine Pass (−12, −16) **0.35** · Terrace Drain (19, −19.8) **0.25** | mid · terrace · terrace | P16 · P7 · on P13→P14 | 51 · 71 · 77 m |
| 03 | West Courtyard Gate (−10, −38) **0.45** · Greenhouse Path (2, −16) **0.35** · Control Room Lawn (30, 22) **0.20** | court · terrace · east | P9 · P14 · P2 | 93 · 70 · 44 m |

Each spawn faces along the patrol (yaw toward the next waypoint) and has ≥ 1.5 m clearance (closest: none under
4 m). Fairness: a player who heads straight for the nearest building is usually *within* 25 m of the spawn guarding
it, so that spawn drops out — e.g. Case 01 player at (25, 18) at 20 s: Archive Hallway is 17.8 m away → the draw is
Greenhouse 0.35/0.55 = **64 %**, Vault Door **36 %**. The Hyde therefore appears in a part of the island the player is
*not* in, then walks its learnable loop toward them. The predictive layer shows exactly this renormalised table.

### 10.5 Risk zones (identical rectangles, case names ≤ 14 chars)

| Zone id | Rectangle | 01 | 02 | 03 |
|---|---|---|---|---|
| z_lawn | x −45..45, z 26..60 | Graveyard Lawn | Graveyard Lawn | Pier Lawn |
| z_crypt | x −45..−18, z −8..26 | Records Crypt | Crypt Ruins | Old Crypt |
| z_chamber | x −45..−18, z −34..−8 | Locked Vault | Catacombs | Old Kennel |
| z_mid | x −18..20, z −10..26 | Middle Path | Middle Path | Middle Path |
| z_east | x 20..45, z −34..26 | Archive Wing | Tunnel Wing | Security Wing |
| z_terrace | x −18..20, z −34..−10 | Greenhouse | Greenhouse | Greenhouse |
| z_court | x −45..45, z −60..−34 | Tower Yard | Tower Yard | Watchtower |

They tile the bounds exactly (no gap, no overlap except shared edges); the patrol visits them in the order lawn → east
→ mid → terrace → court → terrace → mid → lawn, which gives the HMM its transition structure.

### 10.6 Clearance verification (by hand; please let the tests confirm)

- **Patrol** (21 segments incl. P20→P0): all case walls inside the research room, crypt, egg chamber and alley are ≥ 6 m
  from the loop (the loop never enters a room and passes ≥ 6 m outside every door). Outdoor walls: `pa_vine_s` 5.4 m
  (S13), `pa_vine_n` 9 m (S8), `ms_fence_*` 5 m (P11), `ms_hut_*` ≥ 7 m (P2), `cw_rubble_door` 6 m (S7/S8). Outdoor
  cover: `pa_lab_still` 4 m (S11), `ms_ccrate_1` 6.3 m (S9). Required: 0.6 m + radius (≤ 1.6 m).
- **Gaps ≥ 3.0 m clear**: vault mouth 3.4 (02), cage gap 3.44 (02), tunnel 3.15 / 3.5 (02), stacks 4.9 / 5.2 (01),
  record-shelf serpentine 3.4 / 5.7 / 6.2 (01), greenhouse mouth 3.1 / 3.4 to planter 1 (01), archive shelf ends 3.2 /
  3.3 (01), guard-hut door 3.4 (03), guard-post chicane 4.1 (03), yard corridor 3.35 + fence-end 3.65 (03), checkpoint
  gate 3.7 when open (03), yard hut to cliff 3.2 (03). Furniture aisles inside rooms ≥ 1.9 m (Hyde needs 1.2).
- **Never blocked**: pier pocket (no additions south of z 28), tower door (8, −46) (nearest addition 9 m), Gomez's
  switch (33, −13) and gate (31, −34) (Case 01/02/03 alley pieces keep ≥ 3.15 m routes to both), every site / spawn /
  examine / lever (≥ 1.3 m from any addition).
- **Shared arrays untouched** (WALLS / COVER / HIDING / PATROL / ROOMS in island.ts). Note: `caseIslands.test.ts`
  ("walls … never change between cases") needs updating to "shared prefix unchanged + case extras".

### 10.7 Pacing (expected route = sensible order, priors weighted; human = route × 1.3 / 2.7 m/s)

| Case | Expected route | Movement | Interactions (3 searches, 2 examines, lever, pickup, deposit) | Hiding / waits | Orientation | Active | + menus 90–120 s |
|---|---|---|---|---|---|---|---|
| 01 | pier → ledger 42 → books 19 → lever 9 → vault 25 → greenhouse 31 → archive 80 (+stacks 0.4 × 36) → egg + carry E≈136 = **~356 m** | 171 s | ~14 s | 25–45 s | 15–25 s | **225–255 s** | **5.3–6.3 min** |
| 02 | pier → lamp room / tunnel (E≈+25) → ravine → catacombs → vault → gate → egg → tower = **~380 m** | 183 s | ~14 s | 25–45 s | 15–25 s | **237–267 s** | **5.5–6.5 min** |
| 03 | pier → console 62 → guard post 25 → back out 36 → ravine → east gate → lever → yard 25 (+west post 0.4 × 90) → egg + carry E≈60 = **~324 m** | 156 s | ~13 s | 25–45 s | 15–25 s | **209–239 s** | **5.0–6.0 min** |

The v1 bot medians were 171 / 196 / 172 s; with the extra uncertain sites I expect bots at ~190–240 s (still
2.5–4 min). Bot medians for v2 are **not measured yet** (no shell this pass) — the orchestrator's sweep should report
them. If humans run long, knobs in order: lower the far site's prior (01 stacks, 02 lamp room, 03 west post) by 0.1,
raise `traceAccuracy` to 0.8, then trim `hyde.searchS` 8 → 6.

### 10.8 Hyde fairness and tuning changes

- **Emergence 20 s**: the first 20 s are threat-free (read the objective, learn the noise meter, reach a building).
  Thing warns with a countdown (`THING.hyde.soon`), the minimap shows the spawn odds, and spawn selection never puts
  the Hyde within 25 m. The old design started the Hyde 96 m away (first contact ~60 s); now first contact is likely
  30–60 s in — earlier suspense, but never at spawn.
- **Calm window 10 s, hearing × 0.5** after every chase ends: one SEARCH (8 s) + part of COOLDOWN (5 s). An escaped
  player can walk away (heard at 3.5 m instead of 7 m) instead of being re-acquired by their next step. This answers
  the brief's "no constant attacks" without making the Hyde slower.
- **Player sees Hyde at 18 m** (LOS) vs Hyde sight 13 m: a watchful player always gets the first look.
- **Searchlights** only make noise (loudness 0.75 → 11 m radius, halved by walls); they never detect directly. A beam
  lights a given direction for 24/360 × period ≈ 0.7–0.8 s per turn, so a 2.5 s search is caught ~1 time in 3 in the
  open; crates/huts give shade. Recommended sim rule: LOS from the light uses `crouchTarget = player.crouched`, so low
  crates shade a crouching player ("crouch behind cover").
- **Noisy floors** add +0.25 to walk/sprint steps (walk 0.35 → 0.60 ≈ 9.5 m radius); crouching is silent, and every
  floor has a way round or is short enough to cross crouched (≤ 6 m).
- **Lever noise 0.5** (~8.5 m): pulling a lever beside the patrol (Case 03, 4.2 m from P11) is a timing decision.
- **Examine 1.0 s, lever 1.5 s**: short holds; examines scale with interactTimeMult, levers do not.
- **Hint cooldown 10 → 8 s**; clue searches all 2.5 s. Speeds, hearing, sight, suspicion and grab are unchanged (see
  the header of `tuning.ts`).

---

## 11. Joseph Crackstone (enemy contract 2026-10-24)

Contract: `docs/overhaul/ENEMY_CONTRACT.md` (rules R1–R9, sim rules 1–12). Data: `CaseWorldDef.crackstone` in
`src/mystery/data/caseWorlds.ts`, `MYSTERY_TUNING.crackstone` in `tuning.ts`, `THING.crackstone` in `thing.ts`.
Everything below is computed by hand from the geometry (no shell this pass). It is not a playtest or bot measurement.
The game-developer's walkability test is the authority.

### 11.1 Design intent

The Hyde is the ears of the island. It roams, it is drawn by noise, and you beat it by being quiet. **Crackstone is the
eyes of one place.** He is a gaunt pilgrim in a buckled hat, with a long tattered cloak and a staff, and he guards one
named, public area per case. He walks it slowly and on purpose. The visitor's question changes from "am I quiet?" to
"can he see me?", which is a second stealth skill (walls, angles, timing his look-around pauses) that every first-timer
already understands. He brings tension to **one region per case** and is never constant pressure:

- **Public area, private position (R4).** Thing names the area at the start of play and the minimap draws its outline,
  so a visitor can choose to avoid it or plan the visit. His live marker appears only per R4.
- **Leashed guardian (R5).** Every encounter is local. Leaving his area always ends it.
- **Telegraphed threats (R9).** The scan has a 2.2 s warning and the curse has a 1.4 s visible circle. Nothing he does
  is instant except being seen point-blank (≤ 2.5 m), which is the same rule as the Hyde's instant chase.

### 11.2 Deliberate differences from the Hyde

| | Hyde | Crackstone |
|---|---|---|
| Detects by | **hearing** (+ sight) | **sight, proximity, scan**. He is deaf: footsteps, levers, glass, searchlight alarms and decoy *sounds* do nothing to him (a lure works only as a visible decoy within 20 m, R8) |
| Where | whole island, 288 m loop, emerges at 20 s | one cursed area per case, present from t = 0, loop 48–107 m |
| Patrol speed | 2.4 m/s | 1.5 m/s, with a 1.2 s look-around pause at every waypoint |
| Sight | 100°, 13 m (fog 8), crouch × 0.7 | 90°, 14 m (fog 9), crouch × 0.6, × per-case mult |
| Chase | 4.0 m/s, roams | 3.5 m/s, gives up beyond `leashM` from his area's centroid |
| Attack | grab: 0.7 s wind-up, −35 HP, **a catch**, egg damage | curse: 1.4 s circle, −15 HP, slow × 0.75 for 2.5 s. **Never a catch, never egg damage** (R7) |
| Special | — | scan every 21–29 s: 10 m pulse that only walls, high cover or hiding beat (crouching does not) |
| Counter-play | be quiet, walls muffle | break line of sight, keep a wall between you, hide, don't tail him (2.5 m proximity) |

### 11.3 The three haunts

Clearance rule (all three): the **centre** of his 0.5 m body stays ≥ 1.2 m from every wall surface (segment distance
minus thickness/2) and every cover edge (distance minus radius), on every waypoint and every straight segment including
last → first. Waypoints are ≥ 3 m from every clue and egg site, and no waypoint brings him within a hiding spot's
`revealM`. Every waypoint is ≥ 55 m and every polygon ≥ 50 m from the pier start (0, 54); every loop is ≥ 16 m from
the Iago Tower rooms (x 3..13, z −57..−46).
The polygon is the loop's bounding box plus 2 m (rect convention: NW → SW → SE → NE).

| Case | Area (`areaName`) | Polygon / centroid | Lap | Leash | Overrides | Sites inside / near |
|---|---|---|---|---|---|---|
| 01 | **Archive Stacks**: north half of the Research Archive + a look into the Rare Book Stacks | x 24..41, z −16.5..2.8 / (32.5, −6.85) | 47.7 m, ~41 s | 16 m | none (default) | archive desk (0.6) inside; the stacks terminal (0.4) is behind his door |
| 02 | **Crypt Catacombs**: the crypt's lower hall + the catacombs' pillar ring | x −38.5..−18.5, z −30.5..6.5 / (−28.5, −12) | 107.1 m, ~86 s | 25 m | `scanEveryS` 20, `sightRangeMult` 1.15 | nest egg (0.3) inside the ring; the cage pocket (clue 0.6) opens off his south lane |
| 03 | **Restricted Yard**: the fenced yard east of the security fence | x 27..43, z −58..−34.8 / (35, −46.4) | 59.3 m, ~46 s | 17 m | `scanEveryS` 28, `sightRangeMult` 0.9 | yard egg crates (0.3) inside his loop; signal recorder (0.6) 5.7 m off his path |

Lap time = length / 1.5 m/s + 1.2 s × waypoints (turning time not included).

**Case 01: Archive Stacks.** C0 (31.2, −7) → C1 (31, −14.5) → C2 (30.8, −7) → C3 (26.8, −3.9) → C4 (26, −0.5) →
C5 (33, 0.8) → C6 (39, −1) → C7 (34.5, −7); start C7 facing west. He circles the archive's central bookshelf (`res_shelf`)
and once per lap dips through the north door to look down the stacks.
- *Why here:* the stacks are a dead end reachable only through the archive's north door. Guarding the aisle in front
  of that door covers both "archive" sites of `falsified_transfer` without sitting on either one. The three shelf rows
  give constant line-of-sight breaks, so this is the gentlest haunt and uses default numbers.
- *Leash 16:* he gives up ~2 m inside the west door (17.9 m), at the lab benches before the south door (21 m), and by
  the stacks terminal (17.2 m). The stacks hiding spot and stack 2 give a cornered player a way out.
- *Walls/cover checked:* `res_n_w`, `res_n_e` (door caps), `res_shelf` (both caps), `pa_shelf_1`, `pa_shelf_2`,
  `pa_stack_1`, `alley_w`, `alley_e`, `res_w_n`, `cliff_e`, `c_res_pillar`, `c_desk_1`, `c_desk_3`; hiding `hs_research`,
  `pa_hs_stacks`, `pa_hs_cabinet`. Tightest: C3→C4 1.30 m (res_shelf west cap), the three door crossings 1.38 m,
  C6→C7 1.50 m, C5→C6 1.52 m.

**Case 02: Crypt Catacombs (stronger).** H0 (−26, 4.5) → H1 (−33, 3) → H2 (−33, −3) → D_in (−36.5, −5.5) →
C_NW (−34, −12.5) → C_NE (−21, −12.5) → C_SE (−20.7, −25.5) → C_SW (−33, −28.5) → C_W (−35.5, −20) → C_NW2 (−34, −12) →
D_out (−36.5, −5) → H3 (−27.5, −5.5); start H0 facing west. He loops round pillar 2 in the lower hall, passes through
the north door (x −36) and circles all four catacomb pillars.
- *Why here:* "underground" is the case's theme. The catacombs are only reachable through the crypt's north door
  until the winch is cranked, so he guards the deep half of the case (nest egg, cage clue) while the mandatory gate
  clue by the south door (17 m from his nearest point, in fog) stays a calm first objective.
- *Stronger, through data:* scans every 16–24 s (20 ± 4) instead of 21–29 s. Sight × 1.15 gives 10.4 m in the foggy
  crypt and 16.1 m in the clear catacombs, still under the player's 20 m. Leash 25 lets him follow into the
  burial-vault mouth and ~6 m out of the east door. He also has the longest lap (86 s), so he spends ~60 % of it in the
  catacombs.
- *Still escapable:* the same chase speed (3.5 < 4.22), the pillar ring breaks his sight every few metres, and there
  are three hiding spots (catacomb coffin, egg-chamber alcove, crypt alcove) ≥ 1 m beyond `revealM` from his path. He
  never parks on the winch (−22, −27): his path passes it at 1.2 m and his nearest pause (C_SE) is 2.0 m away. The
  lever is interact-only, not an obstacle.
- *Walls/cover checked:* `crypt_inner` (cap −30, 8), `crypt_egg_w` / `crypt_egg_e` (door caps), `crypt_e_n`,
  `cw_rubble_door`, `egg_e_n`, `court_s_egg`, `cage_bars`, `cw_rubble_cage`, `cw_rubble_vault`; cover
  `c_crypt_pillar_2`, `c_sarc_1`, `c_sarc_2`, `c_egg_pillar_1..4`, `c_egg_crate`, `cw_coffin_3`; hiding
  `hs_crypt_alcove`, `cw_hs_catacomb`, `hs_egg_alcove` (edges ≥ 4 m from his pauses). Tightest: C_NW2→D_out 1.31 m
  (crypt_egg_e cap), C_SW→C_W 1.43 m and C_SE→C_SW 1.44 m (catacomb pillars), D_in→C_NW 1.46 m (coffin 3) / 1.49 m
  (door cap).

**Case 03: Restricted Yard.** Y0 (32, −36.8) → Y1 (41.4, −36.8) → Y2 (41, −55.5) → Y3 (29.5, −56) → Y4 (32.8, −44.5);
start Y0 facing east (his back to the yard's two entrances). He walks round the L-shaped yard hut and the egg crates.
- *Why here:* it splits Case 03 cleanly. The Hyde owns the courtyard west of the security fence (its loop never
  crosses x 17), and Crackstone owns the yard east of it. Case 03 was already the most dangerous case for bots
  (Hyde catches), so a guardian in the Hyde-free yard adds a different kind of danger instead of more of the same.
  This also makes R6 conflicts rare.
- *Lighter numbers:* the yard is open and already has a searchlight, so sight × 0.9 (12.6 m) and scans every 24–32 s.
  The recorder site sits west of his loop, where the statue and crates give shade.
- *Leash 17:* he gives up 1.7 m before the checkpoint gate and 3.4 m before the fence's north end. Leaving the yard
  always ends the encounter.
- *Walls/cover checked:* `court_s_3`, `court_s_alley_w`, `gate_shortcut`, `court_s_alley_e`, `court_s_4`, `alley_e`
  north cap (36, −34), `ms_yhut_a`, `ms_yhut_b`, `cliff_e`, `cliff_n`, `ms_fence_1/2`, `ms_gate` (≥ 12 m); cover
  `ms_ycrate_1..3`, `c_statue_c2`, `c_bush_c2`; hiding `ms_hs_yhut`, `hs_court_e`; the searchlight post (30, −48).
  Tightest: Y1→Y2 1.55 m (ms_yhut_a east cap) / 1.65 m (cliff), Y3→Y4 1.64 m (crate 2), 1.72 m from the searchlight.

### 11.4 Numbers and rationale (`MYSTERY_TUNING.crackstone`)

| Group | Value | Why |
|---|---|---|
| Body | radius 0.5 m, turn 3.0 rad/s | Slower turning than the Hyde (4.0), so slipping past behind him during a pause is a learnable skill |
| Speeds | PATROL 1.5 · INVESTIGATE 2.2 · CHASE 3.5 · ATTACK 0 · SEARCH 1.8 · RETURN 1.8 | walk 3.2 < chase 3.5 < slowest legal sprint 4.22 (carrying). The escape margin is 0.72 m/s, against the Hyde's 0.22 |
| Pause | 1.2 s per waypoint | Gives a readable rhythm and a window to cross his path |
| Sight | 90°, 14 m clear, 9 m fog, crouch × 0.6, instant 2.5 m | The "eyes" enemy: narrower cone but longer range than the Hyde. Crouching in the open is seen at 8.4 m (5.4 m in fog) |
| Proximity | 2.5 m (LOS, not hidden) | Tailing him is punished even when crouched. Hiding still works |
| Suspicion | +1.0/s × (1 + closeness), chase at 1, decay 0.2/s | A visible ramp of 1.0 s at the edge of his sight, ~0.5 s point-blank. Same feel as the Hyde |
| Timers | chase loss 3.5 s, search 7 s (r 6 m), investigate ≤ 10 s, waypoint 1.0 m, return sight × 0.6 | Breaking his sight pays off faster than with the Hyde (4 / 8 / 12 s) |
| Scan | every 25 ± 4 s (per case 20 / 28), warn **2.2 s**, radius **10 m**, flash 0.6 s | See 11.5 |
| Curse | range 7 m, circle 1.8 m, wind-up **1.4 s**, cooldown 10 s, −15 HP, slow × 0.75 for **2.5 s**, invulnerable 2.5 s | See 11.5 |
| Other | lure 20 m, player sees him 20 m, Hyde-release ≥ 12 m from him | 20 m is above his best sight (16.1 m in Case 02), so a watchful player always gets the first look |

**Changed from the proposal:**
- scanEveryS 26 → 25 and jitter 6 → 4. The interval becomes 21–29 s, inside the 20–30 s brief. The proposed ±6 with
  Case 02's faster scans would have dropped to 14 s.
- scanWarnS 2.0 → 2.2. This adds a first-timer reaction allowance (see 11.5).
- scanRadiusM 11 → 10. From the outer half of the ring, a walker can now get out in time.
- curseWindupS 1.3 → 1.4. The slowest walker carrying the egg needs 1.33 s to get out.
- curseSlowS 3 → 2.5. It now equals `curseInvulnerableS`, so the slow can never be exploited.

### 11.5 Fairness math

- **Scan escape.** Window = 2.2 s warning − ~0.6 s reaction = 1.6 s. Walking covers 5.1 m, so anyone ≥ 4.9 m from him
  can walk out of the 10 m ring. Sprinting at the slowest 4.22 m/s covers 6.8 m. Closer in, the answer is a wall, high
  cover or a hiding spot. On his loops one is almost always within 4 m (shelves in 01, pillars and walls in 02, the
  hut and walls in 03). The worst open spot is the yard's west half in Case 03, which is outside his loop. Crouching
  does NOT beat a scan, and Thing's warning says so in plain words ("Get behind a wall or hide!").
- **Curse escape.** He casts on the player's position. Leaving a 1.8 m circle from its centre takes 0.56 s walking, or
  0.73 s for the slowest carrying walker (Morticia-type 3.04 × 0.95 × 0.85 = 2.45 m/s). Adding 0.6 s reaction gives
  1.33 s, which is under the 1.4 s wind-up. A player who keeps moving is already out. The curse punishes **standing
  still in his sight**: searching, picking up the egg, or freezing. It costs 15 HP (3/7 of a grab), never a catch,
  and never egg security. King's Shield (`block_grab`) also blocks it (R7).
- **Chase.** 3.5 m/s with a 3.5 s loss timer and a leash of 16 / 25 / 17 m. A sprinting player opens ≥ 0.72 m/s, which
  is ~2.5 m per 3.5 s. One corner or shelf ends the chase, and leaving his area always does.
- **Slow never stacks with danger.** The curse slow (× 0.75 for 2.5 s; slowest sprint 4.22 → 3.17 m/s, which is below
  both chases) is fully covered by 2.5 s of invulnerability. This assumes `invulnerableUntil` makes *both* enemies
  ignore the player, as the existing grab-release rule does for the Hyde. After a landed curse he RETURNs anyway.
- **Two enemies, one chase (R6).** The haunts are placed where the Hyde's loop does not go: inside rooms (01), underground
  (02), behind the fence (03). Simultaneous pressure is rare, and R6 cancels it when it happens.

### 11.6 Pacing

Time in his area per visit, estimated: Case 01 30–50 s (desk + stacks), Case 02 20–60 s (only if the egg or clue is in
the catacombs; P(nest or cage) = 1 − 0.7 × 0.4 = 72 %), Case 03 20–45 s (P(recorder or crates) = 1 − 0.4 × 0.7 =
72 %). At one scan per ~25 s that is 1–2 scan warnings per visit, each costing ~3–8 s of hiding or detouring. One
encounter (chase or curse) adds ~10–15 s. **Estimated +15–30 s of active time**, which moves §10.7's 5.0–6.5 min to
**~5.3–7.0 min**. If playtests run long, change these in order: Case 02 `scanEveryS` 20 → 24, global `scanEveryS` 25 → 30,
then `sight.rangeClearM` 14 → 12. Bot medians with Crackstone have **not** been measured (no shell); the orchestrator's
sweep should report them.

### 11.7 Thing lines (`THING.crackstone`)

Advice-style (≤ 52 filled): `crackstone_area` "Crackstone haunts the {area}. Stay unseen." (max 51 with "Crypt
Catacombs"), `crackstone_deaf` "He can't hear you, but he sees far. Use walls." Log-style (≤ 34): `crackstone_scan_warn`,
`crackstone_curse_warn`, `crackstone_glimpse` (INVESTIGATE), `crackstone_seen` / `crackstone_sensed` /
`crackstone_scan_hit` (CHASE by sight / proximity / scan), `crackstone_escaped`, `crackstone_curse_hit`,
`crackstone_curse_blocked`, `crackstone_curse_dodged`, `crackstone_gave_up` (SEARCH → RETURN), `crackstone_returned`
(→ PATROL), `crackstone_deferred` (R6). None of them names a suspect.

### 11.8 Open items for the orchestrator / game-developer

1. **Safe release point (36, −48) is inside the Case 03 yard** (4.7 m from Y4, 5.3 m from his east lane). `releaseMinDistM`
   12 handles it dynamically, but I recommend that the release rule also skip points inside `crackstone.polygon`.
   (`island.ts` is shared and was not edited.)
2. **Curse HP and `catchDamageMult`.** I recommend `curseHp × catchDamageMult` (rounded) so that the card's Defense
   stat stays honest for both enemies. Otherwise the advantage texts about "grab damage" stay grab-only, which is
   still true.
3. **Invulnerability scope.** The 11.5 slow argument needs `invulnerableUntil` (set by a landed curse) to make the Hyde
   ignore the player too, as after a grab release.
4. **Searchlight post collision** (Case 03) is not in walls/cover. If the renderer adds a collider, it must stay
   ≤ 1.2 m radius (his path passes 1.72 m from (30, −48)).
5. Case 02's path passes the winch lever (−22, −27) at 1.2 m. Levers have no collider today, so this is fine. If one
   is added, keep it ≤ 0.4 m. *(Final: that lever moved to the tunnel office, see §12.)*

---

## 12. Final (2026-10-24): Galpin, compact maps, cabinets, Slurp, encounter director, Weems

Requirements: `docs/final/FINAL_BRIEF.md`, contract `docs/final/FINAL_CONTRACT.md` §1–§8. Data: `cases.ts` /
`solutions.ts` (content version **3**), `caseWorlds.ts` (`playArea`, cabinets, `slurp`, `encounterSpawns`),
`tuning.ts` (`director`, `slurp`, `cabinet`, `scoring`), `thing.ts` (`WEEMS`, `DEATH_LINES`, `CABINET_PROMPTS`,
`THING.prescriptive / slurp / cabinet / status`). **Everything below is computed by hand from the geometry — no shell
this pass, no bot or playtest numbers.** The game-developer's walkability tests and the orchestrator's bot sweep are the
authority; where they disagree, they win and I will move points.

### 12.1 Suspects and culprits (all three cases)

| Suspect | Role (this story only, not canon) | Culprit in |
|---|---|---|
| Marilyn Thornhill | Archivist and greenhouse curator | 01 The Poisoned Archive |
| Françoise Galpin (`galpin`) | Visiting historian restoring the crypt | 02 The Crypt's Last Witness |
| Barry Dort | Night guard and security watch | 03 The Midnight Signal |

Isaac Night is no suspect anywhere; he roams as **Slurp**. The only in-fiction mention is Case 02's prologue egg line
("the tunnels under the crypt — Slurp's haunt"). In Cases 01 / 03 Galpin simply takes Isaac's old innocent slot: Case 01
`botanical_residue` (she returned the only other greenhouse key at 9:05 pm), Case 03 `watchtower_signal` (her observatory
star log runs every five minutes 11:00–11:45). Case 01 note *Muddy Boots* became *Chalk Dust in the Hall* (stone
rubbings — a role hint, no name).

### 12.2 Case 02 rewritten — truth table (culprit Françoise Galpin)

Statements: Thornhill "returned archive boxes to the tunnel early, then worked upstairs" · Galpin "my restoration kit
was locked in the library all night; I never went below" · Barry "at the pier gate when the crypt bell rang".

| Clue (id kept) | Proves | Names | Clears | Text in one line |
|---|---|---|---|---|
| `sabotaged_gate` — Sabotaged Crypt Gate | **method** | Galpin | — | pin drawn, chain sawn with a wire saw; the gate lock opened with the crypt restoration key issued only to F. Galpin |
| `tunnel_access_record` — Restricted Tunnel Sign-In | **opportunity** | Galpin, Thornhill | Thornhill | "F. Galpin — 11:12 pm", minutes before the fall; Thornhill in 8:40, out 8:55 pm |
| `equipment_match` — Restorer's Tool Satchel | **broken alibi** | Galpin, Barry | Barry | her stamped satchel, found underground: wire saw, chain filings, the gate's brass pin, fresh tunnel clay (the kit "locked in the library"); harbour master logs Barry's lantern at the pier 11:15 pm |

| Clues found | Unexplained innocents | Fair conclusion | Verdict if Galpin accused |
|---|---|---|---|
| gate only | Thornhill, Barry | a key-holder made it fall | unsolved |
| sign-in only | Barry | Galpin was below at 11:12 | unsolved |
| satchel only | Thornhill | Galpin's kit went below | unsolved |
| gate + sign-in | Barry | strong; Barry open | unsolved |
| gate + satchel | Thornhill | strong; Thornhill open | unsolved |
| sign-in + satchel | none | Galpin by elimination, method missing | unsolved |
| all three | none | method + opportunity + alibi | **case_solved** (exactly the 3 cited) |

Notes (support nobody): *Archive Boxes in the Tunnel* (tempts toward Thornhill; her 8:40 visit) and *The Crypt Bell*.
Tests to update (game-developer): `cases.test.ts` `NAME_PATTERNS` / `ROLE_PATTERNS` need a `galpin` entry, e.g.
`/\bGalpin\b|\bFrançoise\b|\bF\. ?G\./` and `/\bhistorian\b|\brestorer\b/i`, and `isaac` removed. No other clue text uses
"historian" / "restorer" / "Galpin".

### 12.3 Compact play areas (`CaseWorldDef.playArea`)

| Case | Bounds (m) | Boundary pieces (case extraWalls) | Start (facing) | Hyde lap |
|---|---|---|---|---|
| 01 | x −19..45 × z −60..9 (64 × 69) | `pa_bnd_vine_s` + `pa_bnd_shelf_s` (z 8), `pa_rubble_crypt_door`, `pa_rubble_vault_door`, `pa_bnd_vine_court` (x −12.5) | (10, 5.5) east, at the archive's west door | 8 pts, 116 m, ~48 s |
| 02 | x −45..19.5 × z −60..9 (64.5 × 69) | `cw_bnd_rubble_s` + `cw_bnd_hedge_s` (z 8), `cw_bnd_hedge_e` (x −6), `cw_bnd_fence_t` (x 18.7), `cw_bnd_fence_c` (x 17.5) | (14, −16) west, terrace east edge | 10 pts, 142 m, ~59 s |
| 03 | x −19..45 × z −60..−5 (64 × 55) | `ms_fence_ravine` (ravine sealed), `ms_rubble_kennel`, `ms_bnd_fence_w` (x −12.5) | (2, −12.5) north, under the ridge | 7 pts, 93 m, ~39 s |

Every boundary piece either joins an island wall (gap < 0.8 m) or keeps ≥ 3 m (doorway) / ≥ 2.5 m (corridor) to every
wall incl. those outside the bounds (the `caseIslands.test.ts` rule). Tricky ones: the south boundary sits at z 8 (not 9)
so it keeps 3.2 m from `chapel_s` / `chapel_e`'s end and 3.2 m from `res_w_n`'s door cap; terrace fences start at x 18.7
(0.6 m from the `res_w_n` / `res_n_w` caps at (20, −10)); Case 02's courtyard fence moves to x 17.5 to leave
`hs_court_e` outside and keep 3.7 m to the tower. `c_pillar_m2` (8, 8) becomes a fence post in Cases 01 / 02. Zones tile
the bounds rectangle exactly, so unreachable cells between a fence and the bounds edge are still zoned.

```
CASE 01 — Poisoned Archive (x −19..45, z −60..9)
 z-58 ##########################################################  cliff
      |hedge|  TOWER YARD   [TOWER 3..13] cab   statue   E crate(30,-51)
      |x-12.5  Hw(-10,-38)    door z-46   H(12,-40)        Slurp yard
 z-34 ======|W gate|=========|E gate|==|POISON GARDEN|=|STACKS|==(Gomez gate)
      GREENHOUSE (vines) S shelf(2.5,-27.5)  vine x17   S bed(23.5,-31)  cab  S term
      E store(-6,-28) cab   L trellis(18.8,-32)  E nest(22.5,-21)  stacks  hide
      H ravine(-12,-16)  H loop -> (12,-16) -> (-11,-13)   cab(24.7,-15)
 z-10 ===ridge==[RAVINE]=====ridge=====+==res_n==[N door]===== archive N half
      PORTER'S LODGE  books(5,-7) S ledger(12,-7) ruin  | ARCHIVE  boards  S desk(38,-6) cab
      cab(13,-2.7)  practice(6,3.5)  START(10,5.5)-> D | shelves (Crackstone loop)  vial
 z  8 =====hedge (pa_bnd_vine_s)=========================+===bookcase (pa_bnd_shelf_s)====
```
```
CASE 02 — Crypt's Last Witness (x −45..19.5, z −60..9)
 z-58 #######################################################  cliff
      | N tunnel (puddles) ...........  mouth                [TOWER] |fence x17.5
      | W tunnel  [OFFICE x-38..-26: S desk, E nest, cab, L winch] door x-26   H(12,-40)
      |  S bend   X rubble(x-38)        S tunnel (winch examine)  Ht mouth(-21,-43)
 z-34 =====court_s_egg=========|W gate Hw|=========|E gate|====|
      CATACOMBS (Crackstone ring) S cage(-40,-31)  E nest(-28,-20)  EAST DOOR open  TERRACE  start(14,-16)<-
      cab(-42.2,-11) cobweb  [N door = the GATE] coffin                 cab(-3.3,-27)   fence x18.7
 z -8 ==egg_w==|GATE|====egg_e===   SIDE PATH(x-17.5..-6)  H(-12,-3)  RAVINE x-12
      CRYPT HALL  S gate mech(-40,-4)  pillar  E altar(-22,1) rubble  D(-18,4) S register(-9.5,4) cab
 z  8 =====collapse (cw_bnd_rubble_s)==========+==hedge==+ (x -6)
```
```
CASE 03 — Midnight Signal (x −19..45, z −60..−5)
 z-58 ###########################################################  cliff
      |fence  Slurp  crates *tower light  [TOWER] |corridor|  S recorder(25,-51) *yard  E crates(37,-52)
      |x-12.5 cab(-11.6,-42) S relay(-5,-49.5)  L(15,-43) X gate x17  booth S(20.5,-38) yard hut  (Crackstone)
 z-34 ======|W gate Hw|====|E gate He|===court_s_3===|alley (closed)
      OLD KENNEL E straw(-14,-30)  SHED cab E shed(3.5,-28)  tree   CONTROL HUT (x18.7..26) N door
      S post(-12,-13.5) cab(-16.7,-15)  alarm  START(2,-12.5)  practice  W door  rack  S console cab
 z-10 ==ridge==[FENCE: ravine sealed]========ridge=========+==res_n (research room out of play)==
```

Distances (straight-line, then routed estimates on the open floor):

| Case | Start → nearest clue | Farthest site → tower door | Typical tour (expected, priors weighted) |
|---|---|---|---|
| 01 | ledger 18.8 m / archive door 10 m | Poison bed ~40 m (via trellis 25 m) | door 10 → desk 22 → door 22 → lodge 15 → ravine 24 → shelf 21 → egg 7 → tower 34 = **156 m**; + stacks 0.4 × 44, garden 0.4 × 27, far eggs ≈ 12 → **~196 m** |
| 02 | register 24 m (via ravine) | tunnel bend ~52 m | ravine 27 → register 14 → crypt door 9 → gate 23 → N door 6 → cage 23 → E door 23 → W gate 13 → tunnel mouth 14 → office 15 → tower 46 = **213 m**; + bend 0.4 × 20, hall egg 0.35 × 35 → **~235 m** |
| 03 | post 14 m | relay ~22 m, yard crates ~33 m (gate) | post 14 → hut 31 → console 6 → N door 11 → E gate 15 → lever 10 → booth 8 → recorder 14 → tower 28 = **135 m**; + relay 0.4 × 27, shed carry 0.5 × 45, others ≈ 15 → **~185 m** |

Old full-island tours were 275–389 m (§4b). **Every area has ≥ 2 ways out** except where noted: 01 archive = west door +
in-room shelf loops + cabinet + Gomez's stacks gate (the only single-door room; Crackstone's leash 16 m ends at the door);
01 garden = south entrance + trellis; 02 catacombs = north door + east door (now open); 02 tunnel = ring with two mouths +
office passage; 03 control hut = west + north doors; 03 yard = fence end corridor + checkpoint gate.

### 12.4 Sites, levers, examines (all inside the areas)

| Case | Clue sites → prior | Egg sites → prior | Passage (lever) | Examines (trace?) |
|---|---|---|---|---|
| 01 | transfer: archive desk (38, −6) .6 / stacks terminal (31, −24) .4 · residue: greenhouse shelf (2.5, −27.5) .6 / Poison bed (23.5, −31) .4 · ledger: porter's lodge (12, −7) 1 | potting store (−6, −28) .5 · garden nest (22.5, −21) .3 · yard crate (30, −51) .2 | `pa_vine_trellis` x 17 z −29.5..−25 (lever 18.8, −32): garden ↔ east gate saves ~19 m | vial (23, 5.5) ✓ · books (5, −7) ✓ · cut vines (−4.5, −21) ✗ |
| 02 | gate: mechanism (−40, −4) 1 · sign-in: tunnel office (−31, −42.5) .55 / side-path register (−9.5, 4) .45 · satchel: by the cage (−40, −31) .6 / tunnel bend (−40.8, −47) .4 | catacomb nest (−28, −20) .4 · hall altar (−22, 1) .35 · office nest (−33, −49) .25 | `cw_rubble_tunnel` x −38 z −48.5..−44 (winch −36.2, −42): office ↔ west tunnel saves ~44 m | lantern (−21, 6) ✓ · winch (−34, −36.7) ✓ · cobwebs (−38, −10.5) ✗ |
| 03 | log: ravine post (−12, −13.5) .55 / checkpoint booth (20.5, −38) .45 · override: console (23.8, −12.6) 1 · signal: yard recorder (25, −51) .6 / tower relay (−5, −49.5) .4 | potting shed (3.5, −28) .5 · yard crates (37, −52) .3 · kennel straw (−14, −30) .2 | `ms_gate` (unchanged, lever 15, −43) | radio (20.2, −19.5) ✓ · prints (21, −44) ✓ · silenced alarm (−5, −12.5) ✗ |

Each site is ≥ 1.5 m from wall surfaces, ≥ 0.3 m from cover, ≥ 3 m from every other site of its case, and in its
declared room (first match). Removed (outside the areas): Case 01 `pa_rec_1/2`, `pa_bookcase`, centrifuge; Case 02
`cw_rubble_vault`, `cw_tunnel_1/2`, `cw_rubble_door`, coffins 1/2, fallen gate, boiler, `cw_hs_tunnel`; Case 03
`ms_hut_n/w/s` (east lawn), `ms_post_fence`, racks 1/2 (research room), alley crates, `ms_hs_hut`, `ms_hs_post`.

### 12.5 Cabinets (`kind: 'cabinet'`, radius 0.6, revealM 1.2) and crouch spots

| Case | Cabinet (x, z) → door faces | Serves |
|---|---|---|
| 01 | `pa_cab_archive` (42.2, −4.5) W · `pa_cab_stacks` (34.45, −26.5) W · `pa_cab_lodge` (13, −2.7) S · `pa_cab_greenhouse` (−0.7, −23.4) E · `pa_cab_garden` (24.7, −15) W · `pa_cab_tower` (1.7, −50) W | desk / Crackstone, stacks dead end, start + tutorial, greenhouse, garden entrance, final carry |
| 02 | `cw_cab_hall` (−40, 6.9) N · `cw_cab_catacomb` (−42.2, −11) E · `cw_cab_side` (−7.1, −4) W · `cw_cab_chamber` (−29, −51.6) S · `cw_cab_terrace` (−3.3, −27) W · `cw_cab_tower` (1.7, −50) W | gate clue, Crackstone's door, side path, tunnel office, terrace, carry |
| 03 | `ms_cab_control` (24.7, −21) W · `ms_cab_post` (−16.7, −15) E · `ms_cab_shed` (−3.3, −27) W · `ms_cab_tower` (−11.55, −42) E · `ms_cab_yard` (17.9, −50) E | console, post, shed egg, out of the tower light, inside the yard |

Rules used: back ≤ 0.2 m from a wall surface; 1.6 m in front of the door clear of walls and cover; the exit point
(door + 1.2 m) on open floor; ≥ 3.5 m from any site / examine / lever door-to-prompt (no E conflict); ≥ 2.2 m from
Crackstone waypoints and Slurp wander points; ≥ 4 m from every Hyde leg (closest: `ms_cab_tower` 4.2 m from C→D).
Crouch spots kept: 01 `pa_hs_vines`, `pa_hs_stacks` + island `hs_research`, `hs_terrace`, `hs_court_e`; 02
`cw_hs_catacomb` + `hs_crypt_alcove`, `hs_egg_alcove`, `hs_terrace`, `hs_court_w`; 03 `ms_hs_yhut` + `hs_terrace`,
`hs_court_e`. Open question for the game-developer: whether a cabinet is a collider (radius 0.6) — placements assume it
may be (none narrows a passage below 2.0 m).

### 12.6 Encounter spawns (`encounterSpawns`; `hydeSpawns` = the Hyde rows, same ids)

| Case | Hyde (weight) | Crackstone | Slurp |
|---|---|---|---|
| 01 | Ravine Pass (−12, −16) .40 · West Gate (−10, −38) .25 · East Gate (12, −31) .35 — 31 / 48 / 37 m from start | North Aisle (34.5, −7) .4 · Middle Aisle (33, 0.8) .3 · Stacks Door (31, −14.5) .3 — 28 / 24 / 29 m | Greenhouse Path (−4, −17) .3 · Yard West (−6, −46) .25 · Yard East (34, −44) .25 · Poison Garden (20.5, −17.5) .2 — 27 / 54 / 56 / 25 m |
| 02 | Side Path (−12, −3) .40 · West Gate (−11, −37.5) .35 · Tunnel Mouth (−21, −43) .25 — 29 / 33 / 44 m | Crypt Hall (−33, 3) .4 · Catacomb Ring (−21, −12.5) .3 · Cage Lane (−33, −28.5) .3 — 51 / 35 / 49 m | North Tunnel (−32, −56) .3 · North Mouth (−22, −55) .25 · West Tunnel (−40.8, −42) .25 · Ravine Terrace (−6, −24) .2 — 61 / 53 / 61 / 22 m |
| 03 | West Gate (−10, −38) .40 · Watchtower Steps (−2, −43) .30 · East Gate (12, −37) .30 — 28 / 31 / 27 m | Yard Entrance (32, −36.8) .4 · Yard Corner (41, −55.5) .3 · Searchlight Post (32.8, −44.5) .3 — 39 / 58 / 44 m | Tower Garden (−6, −55) .3 · Behind the Tower (15.2, −56) .25 · Control Hut Path (22, −30) .25 · West Fence (−10.5, −50) .2 — 43 / 45 / 27 / 40 m |

Hyde spawns are on their loop and ≥ 25 m from the start (so the legacy `hyde.minSpawnDistanceM` 25 still holds);
Crackstone spawns are his own loop waypoints (he then walks the unchanged haunt); every spawn is ≥ 20 m from the start,
≥ 1.5 m from walls / cover and sits in the zone it names. The director's honest odds (contract §4): P = w′ / Σw′ over
spawns ≥ 18 m from the player and out of view. Example, Case 01, player at the lodge ledger (12, −7) at t = 20 s:
Ravine 24.5 m, West Gate 37.6 m, East Gate 24 m → all eligible if out of view; if the player looks north-west (ravine in
the cone) → P(East Gate) = .35 / .60 = **58 %**, P(West Gate) **42 %**.

### 12.7 Slurp (`CaseWorldDef.slurp`, `MYSTERY_TUNING.slurp`)

| Case | areaName | Wander (7 pts) | Centroid | leashM |
|---|---|---|---|---|
| 01 | Garden Paths | lodge W (−6, −4), terrace (−4, −18), garden (20.5, −17.5), yard W (−6, −46), yard E (24, −52), (36, −42), (16, −37) | (11.5, −30.9) | 35 (max point 32 m; archive door 38 m — outside) |
| 02 | Maintenance Tunnel | W tunnel (−40.8, −42), N tunnel (−32, −56), S tunnel (−29, −36.7), yard (−4, −40), terrace (−6, −24), (−15, −28), N mouth (−22, −55) | (−21.3, −40.2) | 25 (max 21.6 m; catacombs ring > 25 → Crackstone's) |
| 03 | Watchtower Grounds | (−15, −20), (−6, −55), (6, −38), (22, −30), (−8, −30), behind tower (15.2, −56), (−10.5, −50) | (0.5, −39.9) | 28 (max 24.9 m; never into the fenced yard) |

**leashM semantics (assumed; the sim decides):** max chase distance from the wander centroid; every wander point lies
inside it. Each enemy owns a part of the map: Hyde = the central hub (ears), Crackstone = one building (eyes), Slurp =
the open grounds / tunnel (smell + short sight + loud-noise ears) — so the director rarely stacks two of them.

Tuning rationale (`tuning.ts` `slurp`): WANDER 1.4 (slowest enemy, unsettling pauses 0.8–2.4 s), INVESTIGATE 2.4,
CHASE **3.8** (walk 3.2 < 3.8 < slowest carrying sprint 4.22; margin 0.42 m/s between Crackstone's 0.72 and the Hyde's
0.22), SEARCH 1.8, LEAVE 2.2; sight 90° / 10 m / fog 7 m / crouch × 0.7 (7 m); proximity 3 m; hears only ≥ 0.8; attack
range 1.6, wind-up 0.6 s, connect 2.0 m, 30 HP, knock-back 3 m, 3 s invulnerable, cooldown 6 s, then LEAVE. Player sees
him at 18 m. Cycle = 4 wander waypoints (≈ 4 × (≈ 25 m / 1.4 + 1.6 s) ≈ 75 s) → the director may despawn him.

### 12.8 Director tuning (`tuning.ts` `director`)

| Key | Value | Why |
|---|---|---|
| minSpawnM | 18 | = the player's sight of the Hyde; on 55–70 m maps an eligible spawn should almost always exist (spot-checked by hand: from the start, the archive desk, the crypt gate and the control console at least one spawn per enemy is ≥ 25 m away; visibility not checked) |
| despawnM | 24 | > minSpawnM: hysteresis, no pop-out / pop-in at the same range |
| minActiveS | 35 | ≈ one Hyde lap (39–59 s) minus the walk in: each appearance can be read and avoided |
| recentSpawnS / recentMult | 60 s / × 0.3 | the same doorway rarely spawns twice in a row (contract) |
| objectiveMult | × 1.5 | pressure follows the objective without being certain |
| maxActive | 2 | plus "one engaged at a time" (sim) |
| firstSpawnS | Hyde 20 · Crackstone 35 · Slurp 50 | one new threat per ~15 s in the first minute; the tutorial's lessons (crouch, hide, cabinet) come one at a time |
| respawnCooldownS | Hyde 25 · Crackstone 30 · Slurp 30 | after a despawn, ≥ 25 s of calm from that enemy (contract: "cooldown before respawn") |

### 12.9 Pacing (active play; target investigation 2–3 min humans, 90–150 s bot)

Bot ≈ route / ~2.0 m/s (the v2 sweep: 308 m → 171 s incl. hiding) + 12 s interactions; human = route × 1.3 / 2.7 m/s +
14 s interactions + 25–45 s hiding / waiting + 15–25 s orientation.

| Case | Expected route | Bot estimate | Human active | + menus / prologue / results 120–150 s |
|---|---|---|---|---|
| 01 | ~196 m | **~110–130 s** | 148–178 s | **4.5–5.5 min** |
| 02 | ~235 m | **~130–150 s** | 167–197 s | **4.8–5.8 min** |
| 03 | ~185 m | **~105–125 s** | 143–173 s | **4.4–5.4 min** |

Three enemies add encounters; with the director caps I expect +20–40 s (2–3 short encounters, each solvable by a
cabinet in ≤ 10 s), landing the whole visit at **~5–6.5 min**. Knobs if long: Case 02 register prior .45 → .55 (shortens
the tunnel trip), `director.firstSpawnS.slurp` 50 → 70, `slurp.cycleWaypoints` 4 → 3. If short / too easy:
`director.minActiveS` 35 → 45, Slurp CHASE 3.8 → 3.9. Score check (v4): a clean 150 s finisher = 1000 + 300 + 300 + 150
+ 150 + 150 = **2050**; one hint and one hit = 2050 − 150 (no-hints bonus) − 50 − 150 (no-detection bonus, assuming the
hit followed a detection) − 75 = 1625.

### 12.10 Thing vs Weems copy

Thing (free, never `hint_requested`): `THING.prescriptive` (17 lines ≤ 52: "Hide. The Hyde is approaching.", "Close the
cabinet. Press E.", "Take the safer path through the {area}.", "Use your Pokémon’s defensive move.", "Search the {area}
to the {direction}." …), `THING.slurp` / `cabinet` / `status` reactions (≤ 34: "Slurp heard the cabinet door.", "Your
Pokémon blocked the attack."). Tutorial `tut_hint` / `tut_go` now point V at Weems. `THING_STAY_SILENT` unchanged.
Weems (`WEEMS`, ≤ 90, scored −50 each): `templates` L1 "Nevermore hides its secrets in the {area}. Begin there." / L2
"The {label}, in the {area}. Look properly this time." filled from the live posterior, and `byCase[case][level]` (2 lines
per level). L3 lines only describe the reasoning ("A key, a signature, a satchel. Find the one person all three belong
to.") and never name or gender a suspect. Death cards: `DEATH_LINES` ("Defeated by Slurp" / "Slurp dragged you into the
dark."). Cabinet prompts: `CABINET_PROMPTS` = "E — Hide", "E — Close Door", "Stay Quiet", "E — Exit".

### 12.11 Open items (types.ts and other owners — asked, not edited)

1. **No `types.ts` change needed.** Case 02 clue ids are unchanged; `SuspectId` 'galpin' is used as declared.
2. `buildIsland()` (data/island.ts) still returns the full island (bounds, pier start, island patrol) — I left the
   playArea application to the game-developer's `caseMap()` per contract §3, so the existing "shared prefix" test keeps
   its meaning until they switch. If they prefer, I can make `buildIsland` apply `playArea` (bounds, start, patrol,
   release points) — say so.
3. `practiceCrateFor()` should use `playArea.practicePoint` (the pier crate is outside every area).
4. Tests: `cases.test.ts` name / role patterns for `galpin`; `caseIslands.test.ts` must read `playArea.playerStart`
   (the pier start is outside all areas) and `playArea.hydePatrol`; the Case 02 tunnel tight-spot test referenced
   `cw_tunnel_1/2` (now gone) — suggested replacement: west tunnel 4.4 m (`cw_tunnel_w1` ↔ `cliff_w`), path
   (−24, −56) → (−40.8, −47).
5. `tuning.slurp` uses `pauseMinS` / `pauseMaxS` (the config reader's names) for the requested `wanderPauseS [min, max]`.
