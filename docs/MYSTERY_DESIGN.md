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
