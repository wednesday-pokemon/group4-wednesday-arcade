# UX_OVERHAUL — HUD, compass, minimap, live analytics, evidence (ui-ux-designer spec, 2026-10-23)

> Saved verbatim by the orchestrator from the ui-ux-designer's report, followed by the orchestrator's RULINGS (binding).
> Read-only spec for frontend-developer + 3d-artist. Sizes in px at 1366×768 (1rem = 16 px; the fluid root in
> tokens.css scales ×1.406 at 1920×1080 so the layout is identical in rem). Tokens / fonts (Cinzel display, Alegreya Sans
> UI) and docs/UX_MYSTERY.md binding rulings still apply unless replaced here.

## Orchestrator rulings (binding)
- **R1** Tutorial step 2 headline = "Stay quiet. The Hyde hunts by sound."; the exact owner line "Stay Silent: Move slowly
  and avoid making noise — Hydes are sensitive to sound." stays IN the tutorial as that step's one-line detail text
  (`data-testid="tutorial-text"` keeps starting with it) and also heads Pause → Controls.
- **R2** INVESTIGATION diagnostics never name a suspect (unnamed form: "This clue clashes with a statement. Check Tab.").
- **R3** Accusation gate is UI-side: naming a suspect requires all 3 clues; with fewer, the accusation offers only
  "Leave the case unsolved" + "Find all 3 clues to accuse." The tower prompt warns before deposit ("1 of 3 clues — the
  case will stay unsolved."). Sim verdict rules unchanged (case_solved already needs all three clues).
- **R4** F is a silent alias for the power, never displayed; M leaves the HUD (Pause/Controls only).
- **R5** Egg copy never names a site: objective "Find the egg."; thing.findEgg generic.
- **R6** Prescriptive copy limits follow this spec (action ≤ 52, why ≤ 48), superseding the contract's 70/80.
- **R7** Hint ladder: analytics computes the level content + target (L1 area line, L2 area target, L3 most-likely site
  target); the frontend owns the idle timer (40/80/120 s, paused in SEARCH/CHASE/overlays, reset on progress) and V.
  The 3D Thing scuttle/point at L3 is optional (3d-artist, if cheap); the minimap route + compass marker are required.

## Verdict
The current HUD is honest and greyscale-safe (threat word+icon+border, exact risk labels, ability rings, directional
captions — keep). It fails the brief on: (1) no orientation — no compass, no minimap, objective "Search the ruins for
evidence" says nothing about where; (2) wasted top-centre — in PATROL the 420×64 ThreatMeter is an empty bar; (3)
footstep rings in a chase cover ~40% of the lower screen, competing with the Hyde exactly when the threat must be read;
(4) the evidence board is ~400 words on one screen and the accusation step pushes Continue off the 768 px edge. The
overhaul adds a compass + heading-up minimap, shrinks the threat display into a pill, gives predictive analytics a
permanent compact home (Odds panel under the minimap), routes all Thing text through one rate-limited stack, and
replaces the board with a map-based Investigation overlay.

**Global encoding:** red = the Hyde only · lantern amber = objective / primary action / focus · violet
`--c-accent-text` = clues/mystery · ivory `--c-egg-common` = the egg (tier unknown) · cyan = prediction.
**New tokens:** `--c-hyde #e5484d`, `--c-hyde-text #ff8a8a`, `--c-predict #5cc0e6`, layer colours `--c-layer-desc #d4cbb5`,
`--c-layer-diag #b3a8ff`, `--c-layer-pred #5cc0e6`, `--c-layer-presc #6fd6a0`; map `--c-map-void #070a14`,
`--c-map-ground #121733`, `--c-map-room #1b2046`, `--c-map-wall #6b6aa8`, `--c-map-water #0d1d33`.
**Steady-HUD budget:** ≤ 40 words, ≤ 9 live numbers; centre 560×320 (x 403–963, y 176–496) empty except the reticle.

## 1. HUD layout map (1366×768)
```
 x16                    x451           x915              x1126        x1350
 ┌──────────────────────────────────────────────────────────────────────┐ y0
 │[OBJECTIVE 288×84]     [COMPASS 464×36, y12]          ( MINIMAP ⌀224 ) │
 │ Find 3 clues.          W · · NW · · N ◆58m · NE       ( heading-up    ) │
 │ ◇◆◇ 1/3               [HYDE PILL 416×40, y56]        (  y16–240      ) │
 │ Egg: not found         ◉ Patrolling │ ◔ Risk: Low · next 15 s          │
 │                                     │   ML estimate  [ODDS 224×≤176]   │
 │[CLUE CARD 400×≤132, y112, 6 s]                        y248–424         │
 │                                                       [KEYSTRIP 224×26]│
 │          keep-clear 560×320 (403–963 × 176–496)                        │
 │                 [E PROMPT / EXAMINE TOAST y512–556 (+20 warn)]         │
 │                 [captions ≤ 2 × 26]                                    │
 │[VITALS 272×76]  [THING STACK 560 wide: log 28 + card ≤ 72]  [Q/R 288×112]│
 └──────────────────────────────────────────────────────────────────────┘ y768
```
| # | Component | Box (x,y,w×h) | Content |
|---|---|---|---|
| 1 | ObjectivePanel | 16,16, 288×84 | L1 objective (Cinzel fs-md lantern) · L2 3 clue lozenges (22 px) + "1/3" · L3 egg status |
| 2 | ClueCard (transient) | 16,112, 400×≤132 | §5 |
| 3 | Compass | 451,12, 464×36 | §2 |
| 4 | HydeStatus pill | 475,56, 416×40 | left ≈220: state icon + word · 1 px divider · right ≈180: gauge + "Risk: Low · next 15 s" / "ML estimate" (exact existing strings). Suspicion = 3 px underline inside pill bottom. Effect chip ("STUNNED 1.8 s", success) hangs as 140×22 tab under pill centre |
| 5 | Pointer-lock hint (transient) | centred, y128, auto×28 | "Click to look around" (lantern pill) |
| 6 | Minimap | 1126,16, ⌀224 | §3 |
| 7 | Odds panel | 1126,248, 224×≤176 | Predictive §7 |
| 8 | KeyStrip | 1126, Odds-bottom+8, 224×26 | `Tab` Evidence · `V` Hint · `Esc` Pause |
| 9 | InteractPrompt / ExamineToast | centred, y512, ≤480×44 | unchanged position |
| 10 | Captions | centred ≤560, ≤2×26 | directly above ThingStack |
| 11 | ThingStack | x403–963, bottom 16 | 1 log line (28) + 4 gap + 1 card (52–72), left-aligned |
| 12 | Vitals | 16, bottom 16, 272×76 (+24 hidden) | HP row: bar 120×8 + value + "Caught ○○" · Noise row: 10 segments + word + "· 12 m" |
| 13 | Abilities | right 16, bottom 16, 288×112 | two 52 px rows: 44 px ring + key cap **Q** / **R** + name + state |
| 14 | Edges | — | ThreatEdge chevron, danger mist, catch vignette unchanged |

Hyde pill states: existing table (word + icon + border per mode) plus **DORMANT** (before emergence): hourglass icon,
"Hyde emerges in 0:20", `--c-border-strong` dotted. CHASE: 3 px `--c-hyde` border + glow, risk side "Risk: High ·
detected now".
Objective copy: find_clues (also from spawn) "Find 3 clues." · find_egg "Find the egg." · retrieve_egg "Pick up the egg
(E)." · deliver_egg "Take the egg to Iago Tower." · accuse "Name the culprit."
Egg line: "Egg: not found" → seen "Egg: seen · Potting shed" → carried tier gem + "Rare · 3 pts" + 64×6 security bar +
"slower, louder" → dropped amber "Egg DROPPED — go back" → delivered "Egg secured".
**Moves / merges / goes:** ThreatMeter (420×64, y16) → HydeStatus pill (416×40, y56), suspicion bar → 3 px underline,
"Caught ○○ 0/2" → Vitals HP row · RiskChip (top-right) → pill right segment (strings unchanged) · key chips (Esc·Tab·V·M)
→ KeyStrip under Odds, **M removed from HUD** (Pause/Controls only) · pointer-lock hint → centre y128 · EvidenceToast
(3.5 s) → ClueCard (6 s) at same anchor · ThingCaption + "Why:" advisory → one ThingStack · ability caps F/Q → **Q/R**
via `ABILITY_KEY_LABEL`; slot height 68 → 52 · objective copy shortened · 3D: footstep noise rings removed,
interactable white ground ring → object outline, hiding-spot sigils only within 8 m (§5). New: Compass, Minimap, Odds,
KeyStrip, ClueCard.
Scaling: all rem; at 1920×1080 minimap 315 px, compass 652 px. Canvas backing store = CSS px × devicePixelRatio, redraw
on resize; the min(vw,vh) root keeps short windows proportional.

## 2. Compass
- 464×36, top 12, centred; `--c-hud` bg, 1 px `--c-border`, `--r-sm`, 32 px fade masks both ends; optional 1 px lantern
  hairlines α.3 top/bottom.
- Visible arc 150° (±75°) ≈ 3.09 px/°; heading = camera yaw (same source as minimap); not tweened (camera already smooth).
- Ticks on bottom edge: minor every 15° (4 px, 1 px, `--c-text-muted` α.6); major every 45° (8 px, 1.5 px, `--c-text-2`).
  Letters mid-height: N E S W Cinzel 600 fs-sm (N `--c-lantern`, others `--c-text`); NE SE SW NW fs-xs muted.
- Centre index: 1 px `--c-text` α.5 hairline full height + 8 px lantern caret above (y 4–12).
- Markers (12–16 px icons on the letter line; a marker within 12 px of a letter hides the letter):

| Marker | Glyph / colour | When | Label |
|---|---|---|---|
| Active objective | filled diamond 14 `--c-lantern` | tower while carrying; dropped egg; area named by ADVICE / hint L2 (16 s) | distance "58 m" fs-xs |
| Unfinished clue areas | dashed diamond 12 `--c-accent-text` | find_clues | within ±10° of centre: "Greenhouse Annex · 34 m" |
| Egg candidate sites | egg outline 12 ivory (filled once seen) | find_egg or after any egg-odds update | "%" inline |
| Iago Tower | tower glyph 14 `--c-text-2` (lantern when objective) | always | focus label as above |
| Landmarks | small-caps fs-xs muted (PIER, CRYPT, ARCHIVE, GREENHOUSE, SHRINE, GATE) | nearest 2 within 45 m | text is the marker |
| Hyde heard | claw outline 12 `--c-hyde` | 3 s after a directional Hyde caption, bearing rounded to 22.5° | — |
| Hyde seen | claw filled 14 `--c-hyde` | while hydeVisible | — |

- Off-range clamping: only lantern markers clamp — at x 8 / 456 as a half-diamond + ◂/▸ chevron + distance, on the side
  of the shortest turn; 15° hysteresis near 180°. Others simply hide off-range.
- No autopilot: during find_clues there is no single lantern waypoint, only areas.

## 3. Minimap
- Circle ⌀224, top-right (1126,16). Frame 2 px `--c-border-strong` + inner 1 px lantern α.4. N notch: 18 px lantern tab
  "N" (Cinzel 14) riding the rim at the north bearing. Current-area chip: fs-xs `--c-hud` pill overlapping the bottom rim
  by 10 px ("Greenhouse Annex" or room name).
- **Heading-up**: map rotates with camera yaw, player arrow fixed centre pointing up, N notch rotates (forward-up wins
  for egocentric marker search with free mouse-look; compass + N notch keep the world reference). The Tab map is
  north-up (global planning).
- Fixed radius 28 m (4.0 px/m: 3 m doorway = 12 px, room ≈ 96 px), no auto-zoom. Off-map lantern markers and the top egg
  site clamp to the rim as pips with a direction tick.
- Layers (bottom → top):

| # | Layer | Encoding |
|---|---|---|
| 1 | Void/cliff, water | `--c-map-void`, `--c-map-water` |
| 2 | Ground, rooms | ground `--c-map-ground`; rooms `--c-map-room` + 1 px `--c-border` edge; paths = open lanes between walls |
| 3 | Hyde zones (risk) | zone rects `--c-hyde`, fill α = .08 + .32·p, 45° hatch spacing 10 / 6 / 3 px for p < .3 / < .6 / ≥ .6, edge 1 px α.6; % label for ≤ 2 zones (yours + highest neighbour) |
| 4 | Walls, cover | walls 2.5 px `--c-map-wall`; cliffs 3 px `--c-border`; hedges 2 px #4d6a73; closed gate/passage dashed; high cover 2 px-radius dots; low cover omitted |
| 5 | Known hazards | noisy floors: amber 45° hatch patch; searchlights: amber wedge α.25 rotating with the real beam; shown once seen within 12 m LOS, or under revealHazards |
| 6 | Clue areas | dashed 1.5 px `--c-accent-text` circle at AreaDef.radiusM, fill α.08; name + "80%" (P ≥ 1 unfound clue in area) inside top edge |
| 7 | Candidate clue sites | 8 px hollow violet diamond + "60%" (within its group); only inside/within 12 m of the area, at hint L2, or visited areas on Tab; checked empty → ✕ muted |
| 8 | Egg sites | 14 px ivory egg glyph; 5 m ring dashed α .35 + .65·p; top site solid 2 px ring; always "%"; checked ✕ "Not here"; seen filled + "Seen" |
| 9 | Iago Tower | 18 px tower glyph `--c-text-2` (lantern when objective) + deposit circle r 3 m |
| 10 | Hiding spots | 12 px eye-closed glyph `--c-role-stealth` #9cc3d0 α.8 |
| 11 | Route | dotted lantern 2 px along the nav path; only deliver_egg, retrieve_egg, hint L3 (10 s) |
| 12 | Revealed pins | clue: lantern star 10 px + glow (only after knownClueSites / revealedClues / hint L3); egg: filled lantern egg (eggSeenAt / revealEgg) |
| 13 | Hyde | red claw 14 px only while hydeVisible or CHASE; else claw outline fading 8 s at lastHydeSighting; never truth-based |
| 14 | Player | ivory 14 px arrow + 60° view cone (α.12, 40 px); **noise ring** radius = current hearing radius × 4 px/m — Quiet muted, Audible `--c-text-2`, LOUD `--c-lantern`; dashed while crouched; none idle (replaces 3D footstep rings) |
| 15 | Frame | CHASE → 2 px `--c-hyde` |

- **Hidden until justified:** minimap/HUD read only CaseWorldDef + InvestigationState (+ LiveForecasts), never
  MapDef.clues / eggSpawn / SessionLayout. Areas + egg candidates are public; exact clue/egg pins need seen / power reveal
  / hint L3; the Hyde point needs hydeVisible or CHASE; a power switch only for duos with `power_switch`; the lever once
  seen, the passage once open.
- Updates: clue found → its site pips vanish; an area with nothing left shows a check badge 1.5 s then a faint α.25
  outline · site checked empty → ✕ + the group's labels re-weight over 600 ms · egg/zone odds change → 600 ms crossfade
  at ≤ 1 Hz · reveal → 200 ms fade-in + one 600 ms pulse ring.
- Static layers pre-rendered once per case at 8 px/m; dynamic layers at 30 Hz in canvas 2D outside React render. Labels
  counter-rotated upright, ≤ 4 text labels in view (priority objective > egg % > area % > zone %).
- No legend needed (each symbol self-labels or is a familiar glyph; colours match compass + Odds). Full legend on Tab map.

## 4. Tab "Investigation" overlay (replaces the review-mode board)
- Tab opens (sim + clock paused), blocked during CHASE ("Board locked while you're chased"), Tab/Esc closes. Scrim
  rgba(6,9,20,.94), 16 px padding. Grid: header 48 / body 616 / footer 40 (12 gaps); columns **400 | 456 | 446** (16 gaps).
- Header: kicker "CASE 02 · THE CRYPT'S LAST WITNESS" (caps fs-xs lantern) + H2 "Investigation" (Cinzel fs-xl); right:
  clue pips + "2 of 3 clues" + [Close · Tab].
- **Column 1 EVIDENCE:** three EvidenceSlots 400×128, 8 apart. Found slot = 40 px lantern diamond icon · "EVIDENCE 1"
  (caps fs-xs muted) + title (Cinzel fs-md 700, one line) · `short` (fs-sm, ≤ 2 lines) · *Meaning:* (`--c-accent-text`)
  + meaning (fs-xs `--c-text-2`) · "Mentions:" + identical neutral outline chips per `mentions` name. Enter/click expands
  full `text` (slot grows to 240, others collapse to 56 px title rows). Locked slot = 1.5 px dashed muted border, α.06
  hatch, lock icon, "EVIDENCE 2 — not found", "Search: Maintenance Tunnel · 2 spots left"; focusing it outlines that
  clue's area + sites on the map in lantern. Below: "SUSPECTS" — three 400×56 rows (40 px oval with Cinzel initial +
  name fs-sm 700 + role fs-xs muted / statement one italic line with ellipsis; Enter expands); then "Case-file notes (2)"
  collapsed 32 px row.
- **Column 2 MAP** north-up 456×608 (5.07 px/m): same renderer/encodings as the minimap plus all case room names, zone
  names with %, every area with %, candidate pips for visited areas, all egg sites, hazards seen, lever/passage, last
  sighting. Layer bar over the map top (36 px, toggles with aria-pressed, all on): [1 Hyde zones] [2 Egg sites] [3 Clue
  areas]. Hover/focus on an Odds row highlights its map item and vice versa.
- **Column 3 THE ODDS:** each block = gauge icon + question header, bar rows 22 px (name 150 | bar 200×6 | % 48 | band
  word), source line:

| Block | Rows | Source line |
|---|---|---|
| "Where is the Hyde likely?" (dormant: "Where may it emerge?" + "Emerges in 0:20") | all zones sorted (dormant: 3 spawns) | "Bayesian estimate · patrol route + what you saw and heard" (dormant: "Rule-based estimate · case spawn rules") |
| "Where is the egg likely?" | 3 sites + 1-line history for the top site "50% → 80% · straw trace" | "Bayesian estimate · priors, traces, searched spots" |
| "Where are the clues likely?" | areas with unfound clues | "Bayesian estimate · case priors, searched spots" |
| "Will you reach the tower?" / "Detected in the next 15 s?" | extraction % + risk band | "ML estimate" / "Rule-based estimate" (risk keeps "Rule-based risk estimate") |

  Column footer: "Estimates, not facts. They change as you learn more."
- Footer (review): disabled "Accuse at Iago Tower" + "Deliver the egg first." + fs-xs "Jobs and events are invented for
  this game's story."
- **Accusation mode** (auto after deposit; existing focus trap; no close): H2 "Name the culprit". Column 2 → SUSPECTS
  (three 456×190 cards: 72 px cameo, name Cinzel fs-lg, role, full statement fs-sm; role=radio). Column 3 → step panel:
  "Step 1 of 2 · Who released the Hyde?" [Accuse {name}…] [Leave the case unsolved]; step 2 "Which evidence supports
  it?" + "2 cited" + [Change suspect] [Continue]. In step 2 each found slot gets a 28×28 "Cite" checkbox top-right; the
  two case-file notes replace the suspect mini-list as citable 400×44 rows. AccuseConfirm unchanged. **No probability in
  accusation mode; nothing computes P(suspect).** (R3: naming a suspect requires 3 clues.)

## 5. Clue card, E prompt, examine/lever feedback, discovery aids
- **ClueCard:** 16,112, 400×≤132; `--c-hud` α.92, 1 px lantern border, 4 px lantern left edge, `--r-lg`, soft
  `--glow-lantern`; 40 px lantern diamond with the clue icon. L1 "CLUE FOUND" caps fs-xs lantern · L2 title in caps
  (Cinzel fs-md 700) · L3 `short` (≤ 90, ≤ 2 lines, fs-sm) · L4 **Meaning:** + `meaning` (≤ 60, fs-xs `--c-text-2`).
  In: 200 ms slide (16 px) + fade; hold 6 s; out: flies into its objective pip (300 ms FLIP), pip pulses once. Sound:
  3-note chime + paper. SR: polite "Clue found: {title}. {short} Meaning: {meaning}." Never names a culprit (copy test bans
  culprit / guilty / did it / released the Hyde).
- **Interaction tiers** (candidate site props, examines, levers, egg, tower, switch): (1) within 6 m + LOS → 3D lantern
  outline α.35, no UI; the true clue also glints and plays a positional **shimmer** loop (0 at 6 m → −20 dB at 2 m; same
  truth radius as the glint, reveals nothing the eye wouldn't), captioned once per area "[Faint shimmer ▸]". (2) In
  interact range → outline α1 + InteractPrompt "`E` Search the archive desk" (interactLabel / ExamineDef.label /
  PassageDef.label); hold ring for searches (searchS), examines, levers; moving shows "Stand still to search". At the
  tower with < 3 clues: "1 of 3 clues — the case will stay unsolved." Carrying with nothing else in reach: "Hold E: set
  the egg down". Checked sites: no prompt, outline off.
- **ExamineToast** (replaces the prompt in place 3 s): icon + ExamineDef.text (≤ 90); if it gave a trace, a second cyan
  line with gauge icon "Egg odds: Potting shed 50% → 80%" (the Odds panel animates the same delta). Empty candidate site:
  "Nothing here." + cyan "Clue odds updated."
- **Lever / hidden passage** (and Gomez switch, same pattern): hold E; toast at the prompt position 3 s "PASSAGE OPEN"
  (caps lantern) + PassageDef.text (≤ 60) (switch: "GATE POWERED"); caption "[Stone grinds open ▸]"; minimap: wall
  disappears, gap flashes lantern dashes twice over 1.2 s; log "Hidden passage open."; 3D dust burst + 150 ms camera
  nudge (none with reduced motion).
- **Progressive hint ladder** (no-progress timer pauses in SEARCH, CHASE, overlays; resets on clue_found, egg pickup,
  site_checked; V jumps one level, 10 s cooldown): L0 always — glint/shimmer/outlines, area circles on the minimap · L1
  (40 s or V) THING'S LOG whereHint, area circles pulse once · L2 (80 s or V again) ADVICE "Try the Greenhouse Annex. Clue
  chance 80%." — that area's marker lantern on compass + minimap 16 s, its candidate pips appear · L3 (120 s or V again)
  most likely candidate site (Bayesian; may be wrong — honest) + dotted lantern route 10 s (optional: 3D Thing scuttles
  4 m toward it and points).
- **3D asks:** delete footstep rings (every stance); keep one ring only for ability / decoy / egg_drop / impact / hazard
  noises; interactable white ground ring → lantern Fresnel rim or inverted-hull outline; hiding-spot sigils nothing
  beyond 8 m; keep the Hyde "!" mark, ability VFX, deposit flourish, reveal beams.

## 6. Message system: one ThingStack
Max **1 card + 1 log line** visible (+ ≤ 2 captions above), left-aligned in the 560 px column. Fade in 200 ms (6 px
rise), out 300 ms. A card holds ≥ 1.2 s before pre-emption; 1.5 s gap before the next automatic card (P5 exempt). Queue
length 2; a WHY older than 4 s when its turn comes is dropped. Nothing automatic during the tutorial, the first 2 s of a
ClueCard, CatchToast, DepositMoment or overlays.

| Type | Treatment | Copy | Duration | Rate limits | Sound |
|---|---|---|---|---|---|
| THING'S LOG (descriptive; barChart icon `--c-layer-desc`) | 28 px `--c-hud` pill; caps fs-xs tag "THING'S LOG" + fs-sm `--c-text-2`; no sigil | ≤ 34 chars | 3.5 s | ≥ 2.5 s apart; same type coalesces, latest wins | none |
| WHY (diagnostic; link icon `--c-layer-diag`) | card 52–56; 3 px violet left border — **solid** rule-verified, **dashed + "≈"** pattern; headword caps fs-xs by subject: HYDE ALERT `--c-hyde-text`, POWER STATUS `--c-success`, EGG STATUS lantern, INVESTIGATION `--c-accent-text`, PATTERN muted; body fs-sm one line | headword ≤ 13, body ≤ 48 | 4.5 s | same code ≥ 45 s apart; ≤ 3/min; patterns ≤ 1 per run, never during a threat, end with "Not proof." | Hyde none (sting already); POWER STATUS soft 2-note rise −22 dB; INVESTIGATION page flip −24 dB |
| THING'S ADVICE (prescriptive; signpost icon `--c-layer-presc`) | card ≤ 72; ThingSigil 32 (pose point); 3 px `--c-layer-presc` left border; tag "THING'S ADVICE"; action fs-md 500 one line; "Why:" fs-xs `--c-text-2` | action ≤ 52, why ≤ 48 | 6 s | automatic ≥ 12 s apart; same action not within 30 s; skipped if already done; V on demand | Thing double knock −20 dB |

Priority (higher interrupts after the 1.2 s minimum; equal waits): P5 HYDE ALERT at CHASE start / catch · P4 ADVICE
during threat, V-requested ADVICE · P3 WHY egg damage / escape · P2 routine ADVICE · P1 INVESTIGATION / PATTERN · P0 LOG
(own slot).
Rule-verified WHY sources: hyde_mode reason heard_noise + last own noise source + stance → noise causes; saw_player →
sighting; hyde_lost within 5 s of own lure/distract/stun → POWER STATUS; hyde_lost while hidden → hiding; egg_damage
cause → EGG STATUS; hazard_triggered → hazard cause.
Examples: THING'S LOG "2 of 3 clues found." · "Hyde lost you. Escapes: 1." · "Egg secured." · HYDE ALERT "Your
sprinting made too much noise." · "The broken glass crunched under you." · POWER STATUS "Gengar's distraction helped you
escape." · EGG STATUS "The egg was damaged after a collision." · INVESTIGATION "Clashes with a statement. Compare on
Tab." · PATTERN ≈ "2 of 3 alerts came while sprinting. Not proof." · ADVICE "Hyde risk is high. Take the corridor on your
right." / Why "It's likely in the Ravine (45%)." · "Search the greenhouse. The egg is most likely there." / Why "Egg odds
70% · Bayesian estimate." · "Use Shadow Ball (R) to distract the Hyde." / Why "It's 9 m away and R is ready." · "Stay
quiet. Hyde nearby." / Why "Hyde likely in this zone (45%)." (own zone p ≥ 40%).

## 7. Predictive display rules
1. Bars on a common baseline + rounded number + verbal band (position/length beat area/colour). Map rings/tints only
   say *where*; never use them to compare.
2. Round to 5%, largest-remainder so each group sums to 100; estimates display 5–95 ("<5%" below); **facts are words**:
   "Seen", "Searched", "Found", "Not here" (never 0/100).
3. Bands everywhere: ≥ 60 "likely", 30–55 "maybe", ≤ 25 "unlikely".
4. Bars: HUD 56×6, Tab 200×6; track `--c-surface-2`, fill `--c-predict`; Hyde rows `--c-hyde` α.85 + 45° hatch; top row
   bold; numbers right-aligned tabular-nums.
5. HUD Odds panel by phase (≤ 4 rows): Hyde dormant → HYDE MAY EMERGE AT: 3 spawns · CLUE: top area · find_clues → HYDE
   LIKELY IN: top 2 · CLUE: top area · EGG: top site · find_egg → HYDE: top 1 · EGG LIKELY AT: 3 sites · retrieve/deliver
   → HYDE: top 3 · REACH THE TOWER: 1 row · tutorial/accuse → hidden. Single-row groups use an inline 44 px caps tag
   (CLUE, EGG, TOWER). One footer source line when every group shares a source, else one per group.
6. Update animation: bar tweens 600 ms (`--ease-out`), number swaps at the end; delta chip "50% → 80%" (cyan fs-xs, ▲/▼)
   replaces the band word 3 s; rows re-sort after the tween (200 ms FLIP); glass tick −24 dB for egg/clue changes ≥ 10
   pts. Delta chips only for observation-caused changes ≥ 10 pts (trace, site checked, clue found, sighting); Hyde zones
   drift continuously → crossfade only. Render ≤ 1 Hz; keep the 2 s band hold for risk. Reduced motion: no tween, delta
   chip still 3 s.
7. Source labels, exact: "ML estimate" · "Rule-based estimate" (risk keeps "Rule-based risk estimate") · "Bayesian
   estimate". ML only when the value comes from the loaded trained artifact; scripted numbers never ML. HUD: one fs-xs
   muted line; Tab: label + "how" clause.
8. Never imply certainty: "likely / maybe / most likely", never "the Hyde is in…"; zones are areas, never points; an
   empty likely site → log "Not here. Odds updated."

## 8. Duo card additions
Names row (22 px, no new height): left names fs-sm 700; right vitals chip heart 14 + "100 HP · grab −35" (fs-xs
`--c-text-2`) from tuning.player.maxHp and round(grab.hpLoss × catchDamageMult) (same formula as run.ts; e.g. Bianca
−42). SR "100 HP. A Hyde grab costs 35 HP. Two grabs end the run." Overflow fallback "♥ 100 · −42/grab". AbilityBox key
caps from ABILITY_KEY_LABEL (Q power, R move); kind labels unchanged. Unchanged: six 1–5 stats with best-of-three ▲,
2 advantages + 1–2 disadvantages, card 426×576. Tests: 126-pair copy budget asserts names row + chip ≤ 394 px; grep test
no F caps in mystery UI. Medium priority: Pause shows the chosen duo as a compact read-only card (360×220).

## 9. Control reference + first 20 seconds
One data source (`CONTROLS` + ABILITY_KEY_LABEL): W A S D Move · Mouse / ← → ↑ ↓ Look · Shift Sprint (LOUD) · C (+ Ctrl
cap only while keyboard.lock() is active) Crouch · E Search · use (hold for long actions) · Q {power} · R {move} · Tab
Evidence + map · V Ask Thing · Esc Pause. M only in Pause; F never displayed.
`KeyLegend` component, variants: `card` (onboarding 280 wide at 16,200, 32 px rows; current-step rows lantern, others
50%; after the tutorial collapses into the KeyStrip, 300 ms FLIP) · `full` (Pause → Controls, 2 cols × 5 rows) · `strip`
(HUD) · inline caps (prompt, ability slots, duo cards, Home steps).
Onboarding (pier, Hyde dormant, clock stopped, "Skip (Enter)" always visible, ≤ 3 steps, done by 20 s):
0–2 s DuoIntro (2 s) · 2–8 s step 1 **"Find 3 clues. Save the egg."** — banner (Cinzel fs-xl, y140) shrinks into the
ObjectivePanel after 2 s; rows WASD Move · Mouse Look; compass + minimap area circles pulse once; done when moved 3 m or
6 s · 8–14 s step 2 **"Stay quiet. The Hyde hunts by sound."** (+ R1 detail line) — rows C Crouch · Shift Sprint (LOUD);
noise meter lantern outline; minimap noise ring shrinks while crouching; done when crouched 1 s or 6 s · 14–20 s step 3
**"Search with E. Powers: Q and R."** — rows E · Q {power} · R {move} · Tab Evidence; practice crate outlined; done
when crate searched or 6 s. Then log "Go. Tab shows your evidence." and the pill starts "Hyde emerges in 0:30".
Later first-time tips (once each, as ADVICE): first carry "Hold E: set the egg down"; first time an ability is relevant
"Use {move} (R) to …"; first threat near a hiding spot.

## 10. Spectator dashboard (Laptop 1)
StationLiveCard (cols 1–4, ≈430×216): R1 28 station label · phase badge · active time right (Cinzel fs-lg tabular
"2:14") · R2 28 two 28 px portraits + nickname (fs-md 700) + "Wednesday & Gengar" · R3 18 "Case 02 · The Crypt's Last
Witness" · R4 28 progress track ◆◆◇ clues → egg (resting/seen/carried/dropped/delivered) → tower + objective word
("Finding clues") · R5 24 HP bar 96×6 + "72" · "Caught 1/2" · "Chases 2" · Hyde chip (icon+word) · R6 24 "Risk Low · ML"
· "Tower 80% · ML" · "Egg: Shed 80% · Bayesian" · R7 20 newest Thing item (ADVICE ≤ 52 + "followed ✓ / not yet / —", or
WHY headword + body) · R8 14 heartbeat age. Priority: phase+time > progress > danger > predictions > Thing. States: CHASE
2 px `--c-hyde` border + "CHASING" chip; DNF claw icon greyed; signal lost dashed border + "Signal lost".
Header KPI ribbon (real aggregates, existing case scope): Runs · Case solved % · Extraction success % · Median time ·
Hyde chases per run; "—" when n = 0, "small sample" when n < 10. Never show the culprit, the accused or the true egg site.
Leaderboard, layer panels, ModelCard unchanged.

## 11. Accessibility
Contrast on #0b1020: `--c-text` ≈15:1, muted 7.5:1, `--c-predict` 9.2:1, lantern 10:1, `--c-hyde` 4.8:1 (UI only; Hyde
text uses `--c-hyde-text`), map walls 3.5:1. Hyde zone tints ≈1.6:1 → every zone also gets 1 px α.6 edge + hatch + %.
HUD panels α ≥ .86. Colour-blind: risk/zones = hue + hatch density (10/6/3 px) + % + band word; risk band = word +
gauge needle + border; no red/green pairs (good = cyan/lantern + icon; checked = ✕ muted; deltas ▲▼ + text); verify with
DevTools vision-deficiency emulation (protan, deutan, tritan, achromat). Text ≥ 14 px at 1366 (`--fs-xs`) incl. minimap/
compass labels (3 px `--c-bg` halo); tabular-nums. Reduced motion: no pulses, card slide/fly, bar tweens, FLIP, camera
nudge, outline shimmer; compass/minimap keep tracking (information); delta chips still show; Thing poses switch without
animation. SR: ThingStack polite; CHASE HYDE ALERT assertive once; ClueCard polite; Odds announced politely only for
observation-driven egg/clue changes ≥ 20 pts; minimap/compass aria-hidden (text equivalents = ObjectivePanel, Odds,
Tab lists). Captions for new sounds: "[Faint shimmer ▸]", "[Stone grinds open ▸]", "[Glass crunches]", "[Searchlight
hums]". High contrast: minimap fills off, walls 2 px white, zones hatch-only + white edges, cyan → #8fe3ff. Keyboard: Tab
overlay 1/2/3 toggle layers, ↑↓ lists, Enter expands; focus never hidden; targets ≥ 24 px, buttons 44 px. Setting: rename
"Show risk estimate" → "Show predictions" (hides Odds panel, pill risk segment, map tints).

## 12. Verification checklist (screenshot-based)
1. 1366×768 find_clues: every region at its §1 box, no overlaps, centre 560×320 empty. 2. 1920×1080 identical
proportions, minimap crisp at DPR 1/2. 3. No **F** key cap anywhere in mystery UI. 4. Sprint 10 s → no 3D ground rings;
noise meter LOUD; minimap noise ring amber. 5. Facing north centres N; objective behind → lantern marker clamps at an
edge with ◂/▸ + distance. 6. Minimap arrow fixed up, N notch rotates, areas name + %, tower, area chip. 7. Exact pins only
after a reveal; Hyde claw only while visible/CHASE. 8. Odds panel follows §7.5 (screens: dormant, find_clues, find_egg,
carrying), ≤ 4 rows. 9. Every probability group has an exact source label; risk "ML estimate" / "Rule-based risk
estimate". 10. Groups sum to 100; no estimate reads 0/100%; facts read Seen / Searched / Not here. 11. Examine with trace
→ toast cyan delta; Odds "50% → 80%" 3 s; Tab map same value. 12. ClueCard: CLUE FOUND + title + one sentence + Meaning,
~6 s, pip lights; no culprit wording. 13. E prompt only in range with the outline; checked sites no prompt. 14. Lever:
PASSAGE OPEN toast + minimap gap flash + caption. 15. ThingStack ≤ 1 card + 1 log; exact tags/headwords; PATTERN dashed +
"Not proof." 16. Sprint 60 s → ≤ 2 copies of the same HYDE ALERT. 17. Idle 40/80/120 s → L1 log, L2 lantern area, L3
site + route. 18. Tab: 3 slots, north-up map with 3 layer toggles, Odds with sources; locked slots show only the area;
no culprit. 19. Accusation: suspects replace map, odds gone, Cite boxes, confirm works. 20. Duo cards vitals chip correct
(Bianca −42), Q/R caps, no overflow (126 pairs). 21. Onboarding 3 steps, Hyde countdown by 20 s, Skip works. 22. Pause →
Controls full KeyLegend from the same data, Ctrl only under keyboard lock. 23. Spectator card rows + KPI ribbon from real
data; never culprit / accused / true egg site. 24. Greyscale + deuteranopia: zones by hatch + %, risk by word. 25. Reduced
motion: no pulses/flies/tweens, compass/minimap update, HUD text ≥ 14 px.

## Data / view-model asks
- Predictions view model ≤ 1 Hz from InvestigationState + CaseWorldDef only (the contract's `LiveForecasts` covers it).
- Thing feed items `{kind: log|why|advice, code, head?, text, why?, priority, t, followed?}` (contract `LiveMessage`).
- Copy budgets (game-designer): ZoneDef.name ≤ 14 · EggSiteDef.label ≤ 14 · AreaDef.name ≤ 18 · ClueDef.title ≤ 26 (or a
  shortTitle) · short ≤ 90 · meaning ≤ 60 · PassageDef.text ≤ 60 · ExamineDef.text ≤ 90.
- Prescriptive MAX_TEXT 52, MAX_REASON 48; egg advice uses the egg posterior; key labels from ABILITY_KEY_LABEL.
- Heartbeat additions: objective, chases, extraction p + source, top egg site {name, p}, hydeEmerged, last Thing item
  {kind, text, followed}.
- Guard: minimap / HUD / analytics never read MapDef.clues / eggSpawn / SessionLayout (lint or unit guard).

Sources cited by the designer: NN/g progressive disclosure + horizontal attention; Darken & Cevik 1999; Aretz 1991;
Levine 1982; Cleveland & McGill 1984; Mosteller & Youtz 1990; Kay et al. 2016; BBC subtitle reading rate; Game
Accessibility Guidelines; WCAG 2.2.
