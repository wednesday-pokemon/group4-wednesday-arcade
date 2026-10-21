# Stage 1: Raven Lake (open haunted lake)

Data: `src/action/data/lake.ts` → `buildLakeCourse()`. It also exports `LAKE_CHECKPOINTS` (the start plus the safe
lantern line, z monotonic) and `polygonSignedArea()`. Rules v3.0-realtime. This course replaces the Phase 1 corridor
(84 u wide, lane buoys, repeating rock rows).

Axes: +X is east and +Z is south (toward the start). Heading 0 faces −Z (north). Start is (0, 0). The finish ring is
(0, −520) r7, so the straight-line distance is 520 u.

## 1. Flow

You push off from the Nevermore boathouse inside a wide, calm cove (warm-up) and row north to **Nevermore Gate**, a
40 u rocky throat. In the gate, fog rolls in and the bell tolls (disturbance). As you leave the gate, the Hyde rises
in your wake (emerge). You burst into the **Bell Pool**, where the bell buoy marks a three-way fork:

* west passage → **Western Bay**
* straight ahead → **Reef Run**
* east passage → **Gallows Narrows**

Two islands separate the routes: Hollow Isle (west) and Gallows Isle (east). Each island is split by a crossover:

* **Drowned Cut**: bay ↔ reef, z ≈ −290.
* **Gallows Gap**: reef ↔ narrows, z ≈ −320.

All routes rejoin in the **North Reach**. They enter **Raven Harbour** through a single 52 u mouth, watched by the
harbour lighthouse (late surge there), then slow down in the narrow inlet (safe harbour) and dock.

## 2. Map (north up; 1 column = 10 u, column 0 = x −180; 1 row ≈ 20 u of z)

```
 z      |.......|.........|.........|.....   '|' = x -180, -100, 0, +100
 -540   #################.|.##############   | raven_dock (0,-534) · RAVEN ISLAND landmark (0,-620)
 -520   ################..F..#############   F finish ring (0,-520) r7, >= 25 u from land
 -500   ################..:..#############   : SAFE HARBOUR (0,-494) r23 · inlet 44 u
 -480   ################.....#############
 -460   ##############.d.....o.####C######   inner harbour (94 u) · C crypt (90,-470)
 -440   ##############.........###########
 -420   ##############L.=...=.############   L lighthouse (-44,-421) · = breakwater ruins · SURGE 2 (0,-408) r30
 -400   ###.o...........=...=...........##   harbour mouth 52 u (tips +-26, z -401)
 -380   ##...........oo.%...%...o....%####   NORTH REACH: all routes rejoin
 -360   ##%.......######/..o.#######o^####   HN Hollow Isle N | reef exit | GN Gallows Isle N | squeeze 2 (17.9 u)
 -340   #..l....####T###..=..######...d###   T shrine · = wreck plank · d drifting log
 -320   #..d....########..*r%.>.d...^..###   * wreck on Wreck Reef · > Gallows Race through the GAP · ^ Narrows Flow
 -300   #...@...%......%..>do######..d.###   @ Gibbet Rock · DROWNED CUT (21 u) · > Thornwater
 -280   ##.......######...../#######^.####   HS Hollow Isle S | GS Gallows Isle S
 -260   #.o.....########%.r..#######/.####   r Thorn Reef (lanes 13 / 15 u) · SURGE 1 (0,-248) r23 · squeeze 1 (18.3 u)
 -240   #........#######.o...######..o.###
 -220   ##..........o.....B.....o.....l.##   B bell buoy (-3,-212): the fork
 -200   ##......%........................#   west passage <- BELL POOL -> east passage
 -180   ################/..%.#############   NEVERMORE GATE (40.7-46 u) · HYDE EMERGE (0,-196) r24
 -160   ################.....#############   DISTURBANCE (0,-152) r24
 -140   ################u...u#############   gate buoys (one per side)
 -120   ##############..l......###########
 -100   ############......h..o...#########   h hydeSpawn (-4,-96), dormant and hidden
  -80   ###########...............########
  -60   ##########....o............#######   NEVERMORE COVE: warm-up
  -40   #########..........%........######
  -20   #########................o..######
    0   #########.........S.........######   S start (0,0) hdg 0 · CALM (0,0) r20 · start_dock (0,7)
   20   ###########....=.....=....########   = boathouse pier stubs
   40   #############...........##########   cove bottom z +54
  100   ##################A###############   A Nevermore Academy (0,100)
```

Legend: `#` land, `.` water, `o` rock, `%` debris, `/` sunken branch, `l` log, `d` drifting log, `=` dock piece,
`u` buoy, `r` reef. `^` and `>` show current direction (`^` = north). The West shore runs at x ≈ −165…−174. The east
shore bulges in to x ≈ 111–114 at the two squeezes.

## 3. Routes and trade-offs

| Route (`routes` id) | Risk | Lantern length | Clean @ 8.5 u/s | Narrowest water | Hazards | Why take it |
|---|---|---|---|---|---|---|
| **Western Bay** (`western_bay`) | safe | **~690 u** | 81 s | 35 u (west passage); the bay is ≥ 60 u, with 16.6 / 27 u lanes around Gibbet Rock | 2 rock clusters near the shore, 1 static and 1 slow drifting log, light haze (0.02) | Almost hit-free. You keep the Hyde gap and your HP. Costs ~12–18 s. |
| **Reef Run** (`reef_run`) | risky | **~527 u** | 62 s | Thorn Reef lanes 13 / 15 u; Wreck Reef lane 15 u (east squeeze 12.5 u) | 2 reefs, 7 rocks, sunken branches, wreck debris, a drifting log, the **Thornwater** cross-current (2.2 u/s east, toward rocks), **Drowned Mist** fog (0.035), and **Surge 1** right at the reef entrance | Shortest by ~160 u. A strong player's line. Mistakes compound under the surge. |
| **Gallows Narrows** (`gallows_narrows`) | risky | **~655 u** | 77 s − ~2.3 s current ≈ **75 s** | two 18 u squeezes (z −262, z −352) | Three **Narrows Flow** currents (2.5–2.8 u/s **north**, i.e. helping), 3 drifting logs (bank, gap, squeeze 2), rocks and a branch at the squeezes, **Gallows Fog** (0.03) | The middle option. Ride the current down the centre and it pays back; drift onto the banks and the logs punish you. |

**Cross-overs (decisions after the fork):**

* **Drowned Cut** (21 u, two debris pieces leave 12 / 13.6 u lanes). Reef boats escape the mist into the bay
  (+~60 u). Bay boats cut into the reef's wreck lanes (−~50 u, but into fog and rocks).
* **Gallows Gap** (19.4 u). The **Gallows Race** current (2 u/s east) carries reef boats into the narrows' current.
  Going west against it is slow. A log shuttles across the gap (amplitude 9, period 7 s) and always leaves ≥ 8.4 u
  of clear water on one side.

No lane buoys and no repeated rows: every cluster sits beside a lane or splits one into two unequal choices.

## 4. Encounters (each fires once on entering `radius`)

| id | kind | Centre, r | Params | Where it fires | Straight-line progress |
|---|---|---|---|---|---|
| calm_start | calm | (0,0) r20 | – | immediately | 0 % |
| gate_disturbance | disturbance | (0,−152) r24 | `fogDensity 0.035, durationS 16` | z −128…−140, in the gate. The throat is ≤ 46 u wide, so **every** boat crosses it | 24.6–26.9 % (~16 s) |
| gate_hyde_emerge | hyde_emerge | (0,−196) r24 | – | z −172…−190, at the gate exit (≤ 43 u wide), so **every** boat crosses it | 33–35.6 % (~21 s) |
| surge_thorn_reef | surge | (0,−248) r23 | `boost 3.0, durationS 4.0` | Reef: on entering the channel, z −225…−233 (r covers the whole 42–44 u width at z −248). Bay and Narrows: via the director's progress fallback at 53.7 % (bay ≈ (−122,−313), narrows ≈ (106,−304)) | reef 43–45 % (~26 s); bay ~57 % of path (~46 s); narrows ~56 % (~43 s) |
| surge_harbour_mouth | surge | (0,−408) r30 | `boost 3.0, durationS 4.0` | z −378…−393, the single 52 u harbour mouth. **Every** route crosses it | 72.7–75.6 % (reef ~45 s, narrows ~63 s, bay ~65 s) |
| raven_safe_harbour | safe_harbour | (0,−494) r23 | – | z −471…−483. The inlet is ≤ 46 u wide, so **every** boat crosses it, ~40 u before the dock | 90.6–93 % |

How the triggers are placed:

* **Disturbance → emerge.** Both sit in the shared gate, so they fire 44–50 u (~5–6 s) apart on every route. The
  disturbance always fires first: its circle ends at z −176, and the emerge circle starts at z −172.
* **Surge spacing.** The two surges are 158–170 u apart on every route (≥ 18 s). That is more than the 12 s minimum
  spacing plus the 5.5 s telegraph-and-burst, so neither surge gets deferred or skipped.
* **Surge 2 vs. the safe harbour.** Surge 2 finishes ~4–5 s before the safe harbour fires.
* **Mid surge.** The divergent middle has no point shared by all three routes, so a single radius can't serve them
  all. Surge 1 is placed on the Reef Run, where pressure on the risky shortcut is the point. The director's
  +0.06 progress fallback then delivers it mid-route on the side routes.
* **`hydeSpawn` (−4,−96), heading 0.** This is in open cove water, 56 u south of the disturbance centre. When the
  disturbance fires (boat at z ≤ −128) that spot is already behind the boat, and `wake()` then places the Hyde on the
  wake 45 u back. At t = 0 the spawn is north of the start, but the Hyde is dormant (visibility 0) there.

## 5. Pacing estimate (the 75 s lake-spirit assist only affects the bay at the end)

| Route | Strong (~10 u/s) | Typical (8.5 u/s) | Typical (6.8 u/s, GDD avg) | Struggling (~7 u/s, more hits) |
|---|---|---|---|---|
| Reef Run | ~55 s | ~68–72 s (current correction ~1 s, fog caution ~2 s, 1–3 hits) | ~84 s | ~90 s, crash-heavy |
| Gallows Narrows | ~65 s | ~75–77 s | ~93 s | ~92 s |
| Western Bay | ~69 s | ~81–82 s | ~97 s with assist | ~96 s, nearly hit-free |

Beats for a typical player:

| Time | Beat | Feeling |
|---|---|---|
| 0–14 s | Cove warm-up: rhythm and steering. Clusters sit well off the line. | calm |
| ~16 s | Gate: fog and bell | dread |
| ~21 s | Hyde emerges behind you (camera glance) | spike |
| ~23 s | Bell Pool fork | the big decision |
| 26–46 s | Surge 1, on whichever route you chose (reef early, sides mid) | pressure |
| 45–65 s | North Reach, then harbour mouth: Surge 2 under the lighthouse | climax |
| 55–76 s | Safe harbour: the ravens hold him off; brake and dock | relief |

## 6. Geometry and validation (hand-checked; the grid-BFS test is the authority)

* **Winding.** "CCW" means `polygonSignedArea > 0`, where area = ½ Σ (x_i·z_{i+1} − x_{i+1}·z_i). `landMass()`
  normalises every outline to this sign, reversing the outline if the hand-listed order is negative.
  * The islets are hand-listed already positive. Example: the bounding box of Hollow Isle S, traversed in the same
    order, gives +3520.
  * Drawn north-up, these loops look clockwise on screen.
  * Every polygon is simple: the shores are monotone along their lake edge, and the islets and reefs are single
    loops.
  * Two shores are concave U-shapes: `nevermore_shore` (the cove plus the gate) and `raven_island` (the harbour).
* **Land.** 11 polygons:
  * 4 shores: nevermore, west, east, raven_island. They overlap each other inland, so the edge is watertight.
  * 5 islets: Hollow S/N, Gallows S/N, Gibbet Rock.
  * 2 reefs: Thorn, Wreck.
* **Bounds.** x ±330, z −740…210, outside every shore.
* **Start and finish.**
  * The start is 54 u from the cove bottom and ≥ 88 u from the cove sides. The AFK-forced wake point (45 u behind
    the start) is still in water.
  * The finish centre is ≥ 25 u from land, so the ring edge is ≥ 18 u from land.
* **Narrowest water on each route** (the clear width ≥ 8 u requirement):

  | Place | Width |
  |---|---|
  | Gate | 40.7 u |
  | Thorn lanes | 13 / 15 u. A rock at the west-lane entrance leaves 8 / 13 u. |
  | Wreck lane | 15 u |
  | Wreck–Gallows N squeeze | 12.5 u |
  | Narrows squeezes | 18.3 / 17.9 u. Obstacles there leave lanes ≥ 12.6 / 14.5 u. |
  | Drowned Cut | 21 u |
  | Gallows Gap | 19.4 u. The drifting log leaves ≥ 8.4 u at every phase. |
  | Harbour mouth | 52 u |
  | Inlet | 44 u |

* **Lantern lines.**
  * Every point *and segment* keeps ≥ 4 u from obstacle surfaces at **every drift phase**. The drift sweeps were
    checked at both extremes. The tightest cases are the narrows rock (95.5,−361) at 4.7 u, the bank log at 5.35 u,
    the harbour-mouth ruins at 5.55 u, the reef branch at 5.6 u and the narrows sway log at 5.95 u.
  * Every point and segment keeps ≥ 6.8 u from land. The tightest cases are the Thorn east lane at z −262 (6.8 u),
    the mouth tips (6.9–7.0 u) and the narrows banks (8 u).
  * All three lines are z-monotonic.
  * They share the first 5 points (start → gate exit) and the last 4 (harbour mouth → inside the finish ring).
* **Obstacles: 66.**

  | Zone | Count |
  |---|---|
  | Cove | 16 |
  | Pool | 7 |
  | Reef | 13 |
  | Narrows and gap | 8 |
  | Bay | 8 |
  | Reach and harbour | 14 |

  * By kind: 26 rocks, 15 debris, 9 logs (6 drifting), 5 dock pieces, 6 branches, 5 buoys. One buoy is the bell
    buoy; the others are 2 gate markers and 2 dock moorings.
  * Ids are `<zone>-<kind>-<n>`.
  * Damage follows the Phase 1 table: rock 14, log 10, dock 12, branch 8, buoy 3, debris 6.
* **Currents and fog.**
  * 5 currents, all 2.0–2.8 u/s. Three Narrows Flow currents help northbound boats; Thornwater and Gallows Race push
    sideways.
  * 3 fog banks: 0.035 r42, 0.03 r28, 0.02 r30. Fog uses renderer units, on the same scale as Phase 1's 0.03.

## 7. Notes for other roles

* **3d-artist.**
  * `start_dock` is at (0,7) in open water, 47 u from the cove-bottom shore. Draw it as a long boathouse jetty or a
    floating landing; it has no collider.
  * `raven_dock` is at (0,−534) with rotation π (rotation uses the heading convention: 0 faces −Z). It reaches from
    the harbour's north wall (z −546) toward the ring.
  * The wreck sits on `wreck_reef`. The lighthouse sits on Raven Island land, just west of the harbour mouth.
* **game-developer.**
  * Before the disturbance, the Hyde's seeded wake runs straight south of the start. Only the first ~54 u of it is
    water.
  * Surge 1 reaches the side routes only through `EncounterDirector`'s progress fallback (+0.06). If that margin
    changes, revisit its timing.
