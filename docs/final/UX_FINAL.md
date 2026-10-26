# UX_FINAL — HUD v3, cabinets, death, Weems vs Thing, home leaderboard, results (ui-ux-designer, 2026-10-24)

> Saved verbatim by the orchestrator. Builds on docs/overhaul/UX_OVERHAUL.md + docs/overhaul/UX_ENEMIES.md (unchanged
> unless replaced). px at 1366×768, written as rem in CSS (×1.406 at 1920×1080). Cinzel display, Alegreya Sans UI.
> Orchestrator note: "Ask for owners" items at the end are routed by the orchestrator. DuoCards.tsx belongs to frontend A.

## 0. Verdict + global rules
Top of the HUD is the bottleneck (Hyde pill 416 + Crackstone plaque 232 already fill x355–1011): a third monster can't
fit, the Hyde risk segment duplicates Odds, Odds rows take two lines. Fix: one **Threats strip** of three fixed 200 px
chips; **all predictive numbers move to one Odds panel** (one line per monster); **per-area odds move to a minimap
"danger view"** (key X). Zoning by purpose: left = investigation (objective, Ask Weems, clue/Weems card); top centre =
threats; right = map + odds; bottom centre = Why + Thing; bottom corners = you (vitals, abilities). Weems and Thing never
share a slot, a colour or a typeface.

New tokens (tokens.css):
```css
:root{
 --c-slurp:#d77be0; --c-slurp-text:#eeb0f3; --c-slurp-soft:rgba(215,123,224,.14);  /* 7.0:1 / 10.9:1 on --c-bg */
 --c-weems:#cfe0ff; --c-weems-text:#e4edff; --c-weems-glow:rgba(150,190,255,.45);     /* 14:1 */
 --font-weems:'Palatino Linotype','Book Antiqua',Palatino,Georgia,serif;               /* italic 400 = Weems' voice */
}
.high-contrast{ --c-slurp:#f0a8f5; --c-slurp-text:#ffd6ff; --c-weems:#fff; --c-weems-text:#fff; }
```
Slurp = orchid (only free hue: red Hyde, amber objective, green Crackstone, mint good/Thing, cyan prediction, violet
clues/why, ivory egg). Weems = pale ice, separated from cyan prediction by lightness (.74 vs .46), only ever inside her
portrait frame. Greyscale: Slurp (L .34) ≈ Hyde (L .22) → every Slurp element also differs by shape, icon, texture.
New icons (Icon.tsx): `slurp` `<path d="M6 10a6 6 0 0 1 12 0v4a3 3 0 0 1-3 3H9a3 3 0 0 1-3-3Z"/><path d="M9.5 10h.01M14.5 10h.01"/><path d="M9.5 14c1.5-1 3.5-1 5 0"/><path d="M10 17v3M14 17v2"/>`;
`cabinet` `<path d="M5 21V3h14v18"/><path d="M3 21h18"/><path d="M9 7h6M9 10h6M9 13h6"/>`;
`hush` `<path d="M12 4v10"/><circle cx="12" cy="18" r="2"/><path d="M4 12h3M17 12h3"/>`.
Keys: **X** = map danger view (add KeyX to preventDefault lists in input.ts + kiosk.ts). **V** = Ask Weems. F never
shown. CONTROLS: hint → `{keys:['V'], label:'Ask Weems (−50)', short:'Weems', in:['full']}` (leaves the strip — the Weems
button shows V); add `{id:'lens', keys:['X'], label:'Map: switch danger view', short:'Map', in:['full','strip']}`.

## 1. HUD v3 layout (1366×768)
```
 x16          x304 x375        x451 compass x915      x991  x1094 x1126      x1350
 ┌───────────────────────────────────────────────────────────────────────────┐ y0
 │[OBJECTIVE 288×84]            [COMPASS 464×36 y12]              ( MINIMAP ⌀224 )
 │[ASK WEEMS 288×36 y108] [HYDE 200][CRACKSTONE 200][SLURP 200] y56 ( heading-up )
 │[CLUE / WEEMS CARD          effect chips y100 · banner 400×44 y124  [LENS 224×28 y256]
 │  384×≤132, y152]                                              [ODDS 256×≤184 y292]
 │                       keep-clear 560×320 (403–963 × 176–496)  [KEYSTRIP 256×26 y484]
 │                 [E PROMPT / CABINET BLOCK y496–576]
 │                 [captions ≤2×26]
 │[VITALS 272×100 y652]   [WHY or THING card + 1 log, x403–963]      [Q/R 288×112]
 └───────────────────────────────────────────────────────────────────────────┘ y768
```
| # | Component | Box | Change vs today |
|---|---|---|---|
| 1 | ObjectivePanel | 16,16 · 288×84 | unchanged |
| 2 | AskWeems button | 16,108 · 288×36 | NEW (§4) |
| 3 | ClueCard / WeemsCard (shared slot; ClueCard wins, Weems waits ≤ 4 s) | 16,152 · 384×≤132 | ClueCard y112→152, width 400→384 |
| 4 | Compass | 451,12 · 464×36 | add Slurp markers |
| 5 | Threats strip | y56, three chips 200×40, gap 8, centred x375–991 | Hyde pill 416→200, risk segment REMOVED (now Odds row 1); Crackstone 232→200 |
| 6 | Effect chips | under each chip centre 140×22, y100 | unchanged pattern |
| 7 | Telegraph banner | centred y124 · 400×44 | unchanged (curse > scan) |
| 8 | Minimap | 1126,16 · ⌀224 | draws ONE threat layer at a time (lens) |
| 9 | Lens bar | 1126,256 · 224×28 | NEW |
| 10 | Odds panel | 1094,292 · 256×≤184 | 224→256 wide; one line per monster; HUD zone rows REMOVED (live on lens + Tab) |
| 11 | KeyStrip | 1094,484 · 256×26 | "Tab Evidence · X Map · Esc Pause" (V removed) |
| 12 | Prompt / cabinet block | centred y496–576 | §2 |
| 13 | Captions + ThingStack | x403–963, bottom 16 | adds SLURP headword |
| 14 | Vitals | 16,652 · 272×100 | adds Tally row 3 |
| 15 | Abilities Q/R | 1062,640 · 288×112 | unchanged |
Steady-HUD budget: ≤ 40 words, ≤ 12 live numbers.

### 1a. Threats strip
Fixed order Hyde · Crackstone · Slurp; an absent monster is omitted, the rest stay centred. Each chip: caps fs-xs muted
kicker (HYDE / CRACKSTONE / SLURP) + state word + icon + 3 px meter inside the bottom edge. Silhouettes: Hyde full pill
+ solid meter; Crackstone square `--r-sm` + segmented meter + double alarm border; Slurp `border-radius: 4px 4px 18px 18px`
("drooping coffin") + dotted meter `background: radial-gradient(circle, var(--c-slurp) 1.5px, transparent 2px) 0 50%/6px 3px repeat-x`
+ alarm border 3–4 px solid + glow `0 0 18px rgba(215,123,224,.45)`. Hyde words = existing THREAT table; Crackstone =
UX_ENEMIES §1. Slurp:
| Mode | Word | Icon | Border |
|---|---|---|---|
| WANDER | Wandering | slurp | 1px solid --c-border |
| sees you (not chasing) | SEES YOU | eye | 2px dashed --c-slurp |
| INVESTIGATE | Heard something | ear | 2px dashed --c-slurp |
| SEARCH | Searching | search | 2px solid --c-slurp |
| CHASE | CHASING YOU | slurp | 3px solid --c-slurp + glow, bold --c-slurp-text |
| ATTACK (windup) | GRABBING | slurp | 4px solid + glow |
| LEAVE | Wandering off | reset | 2px dotted --c-border-strong |
Director states (all three): not yet spawned → "Arrives in 0:20" (hourglass; "Arriving soon" once the timer ran out but
no eligible spawn yet); despawned → "Away" (no timer); both: opacity .6, 1.5px dotted --c-border-strong. ARIA assertive
only on CHASE/ATTACK; ThreatHold 0.5 s (CHASE/ATTACK bypass). Slurp elsewhere (as Crackstone): mist
`rgba(190,90,200,.30)`, edge chevron with slurp icon (priority: the single ENGAGED enemy, then Hyde SEARCH), minimap
frame on chase 2px dashed --c-slurp, compass `slurp_seen` (filled 14) / `slurp_heard` (outline, held 3 s).

### 1b. Where the four analytics live
| Layer (kid name) | Token / icon | In play | Rule |
|---|---|---|---|
| Descriptive "What happened" | --c-layer-desc / barChart | Objective panel (clues, egg), Vitals (HP, Caught, Noise, **Tally: Seen · Hits · Hints**), Q/R cooldowns | always on, counters only |
| Diagnostic "Why" | --c-layer-diag / link | WHY card in the bottom stack after an event; game-over "Why" | ≤ 1 card, 4.5 s |
| Predictive "What's likely" | --c-layer-pred / gauge | Odds panel + minimap danger view (lens) + compass egg % | ≤ 1 Hz, exact source labels |
| Prescriptive "What to do" | --c-layer-presc / signpost + Thing sigil | THING'S ADVICE card in the bottom stack | free, rate-limited |
Each region carries its layer icon (14 px) + layer-colour edge (Vitals 2px top --c-layer-desc + barChart top-right; Odds
2px top cyan + gauge in title; WHY 3px violet left; ADVICE 3px mint left). **AnalyticsLegend** (one component, 4 chips,
28 px tall): `[barChart] WHAT HAPPENED · [link] WHY · [gauge] WHAT'S LIKELY · [signpost] WHAT TO DO` — once for 4 s at the
end of onboarding (centred y140, 600×32), always at the top of Pause and in the Tab overlay header. Weems is NOT an
analytics layer and never appears in the legend. Tally row (Vitals row 3, 24 px): caps "TALLY" muted, `eye` Seen n ·
`shieldAlert` Hits n · `ghost` Hints n (from enemy_detected / enemy_hit / hint_requested); 0 in --c-text; on increment
lantern + one 600 ms pulse (none in reduced motion). "Caught ○○" stays in the HP row.

### 1c. Odds panel v3 (256×≤184 at 1094,292)
```
[gauge] DANGER SOON                         (caps fs-xs cyan, 22)
[claw]  Hears you  [48×6] 20%  unlikely     24   Hyde: red bar + 45° hatch
[hat]   Sees you   [48×6] <5%  unlikely     24   Crackstone: green stipple
[slurp] Finds you  [48×6] 10%  unlikely     24   Slurp: orchid + 0° line hatch
[CLUE]  Maintenance Tunnel                  40   (2 lines: name / bar 56×6 + % + band)
        [56×6] 55% maybe
Hyde: ML estimate · Clue: Bayesian estimate        16
Crackstone, Slurp: Rule-based estimate             16   (footer groups by source, ≤ 2 lines)
```
Columns: pad 8 | icon 16 | label 72 | bar 48 | % 40 (right, tabular) | band 52 | pad 8. Monster rows fixed order: Hyde =
existing 15 s detection risk (`data-testid="risk-chip"` + `data-band` move onto this row); Crackstone =
`forecasts.crackstone.here` (10 s); Slurp = `forecasts.slurp.here` (15 s horizon). Horizons in aria-label + Tab, not the
title. Facts are words: "Hunting you" (full bar), "Seen now", "Hidden" (Crackstone/Slurp while the cabinet door is
closed; empty bar). Away → "Away" (muted, no bar). Before a spawn / cooldown over → "Next: {area}" with % for the top
area of the director's `encounterSpawnDistribution` grouped by area, source "Rule-based estimate". Row 4 (objective,
two lines): find_clues → CLUE top area · find_egg/retrieve → EGG top site · deliver → TOWER reach; hidden in tutorial +
accuse. ≤ 1 Hz; 600 ms tween + delta chips on row 4 only; monster rows crossfade, no deltas, keep the 2 s band hold.
"Show predictions" off hides Odds, lens tints and the lens bar.

### 1d. Minimap danger view (lens bar 224×28 at 1126,256)
`[X] (A)(claw)(hat)(slurp)  Hyde odds · auto` — KeyCap X, four 24×24 icon toggles (selected = filled in its enemy colour +
2px border), label fs-xs. X cycles Auto → Hyde → Crackstone → Slurp → Auto (keyboard-only; pointer lock stays). Minimap
draws ONE threat layer: Hyde zone hatch + % (existing layer 3); Crackstone stipple cells (existing 3b); Slurp NEW 4 m
cells --c-slurp, 0° line hatch 10/6/3 px for p < .3 / < .6 / ≥ .6, α .5+.4p, fill α ≤ .10, p < .10 not drawn, % on the
player's own cell. For an INACTIVE enemy the lens shows its spawn areas as outline icon pins + "%" (director
distribution, pins ≥ 5%), labelled "may appear". Auto picks: engaged enemy (INVESTIGATE+) > active enemy with highest
Odds p > Hyde; 4 s hysteresis. Always drawn regardless of lens: clue areas, egg sites, tower, cabinets (`cabinet` glyph
12 px #9cc3d0), cursed area + curse circle, visible enemies, player noise ring. Tab map toggles become [1 Hyde] [2 Egg]
[3 Clue] [4 Crackstone] [5 Slurp]; Odds column adds "Will Slurp find you?" and "Where may monsters appear next?"
(director distribution for inactive enemies, "Rule-based estimate · spawn rules"); column 1 adds a collapsed row
"Weems' hints (n)" listing hint texts.

### 1e. Removed / shrunk
Hyde pill width + its risk segment; Odds two-line monster rows + HUD zone list; V from the KeyStrip; ClueCard −16 px; the
idle ladder's V behaviour (idle nudges = Thing's free ADVICE at 40/80/120 s, never hint_requested). 3D: no new ground
rings; cabinet outline only within cabinet.useM; hiding sigils ≤ 8 m.

## 2. Cabinets
Status chip 360×28 at y496; prompt row ≤ 480×44 at y532.
| State | Status chip | Prompt row |
|---|---|---|
| In range, unseen | — | `[E] Hide` |
| In range, an enemy can see you | — | `[E] Hide` + amber "It can see you. It will check this cabinet." |
| Entering 0.5 s / closing 0.4 s / exiting 0.6 s | "Closing…" (closing only) | none |
| Inside, door OPEN | `cabinet` + "DOOR OPEN · you can be spotted" (2px dashed --c-warning) | `[E] Close Door` + fs-xs muted "Move to step out" |
| Inside, door CLOSED | `cabinet` + "DOOR CLOSED · hidden from sight" (1px solid --c-success + shieldCheck) | `hush` "Stay quiet" · divider · `[E] Exit` |
| Creak in ≤ 5 s | chip line 2 lantern fs-xs "The door will creak soon." | same |
| Creak | chip flashes lantern 300 ms; caption "[Cabinet door creaks]"; noise meter spikes | same |
| Witnessed | border 2px solid in that enemy's colour + "{Name} saw you hide! Get out now." | `[E] Exit` in lantern |
| Enemy visible within 4 m of the door | line 2 "{Name} is right outside. Wait." | same |
| Pulled out | catch flash tinted in the enemy colour; WHY card | — |
Hiding view (frontend A): `.mhud-cabinet[data-door]` first child of `.mhud`, under the panels, pointer-events none; 300 ms
opacity transitions (instant in reduced motion). The 3d-artist puts the camera just inside the door facing out and
animates the door; the overlay is the reliable readable layer:
```css
.mhud-cabinet[data-door='open']{background:
  linear-gradient(90deg,rgba(10,8,14,.95) 0 16%,transparent 24%),
  radial-gradient(ellipse 70% 60% at 55% 50%,transparent 45%,rgba(5,7,15,.8) 100%);}
.mhud-cabinet[data-door='closed']{background:
  radial-gradient(ellipse 60% 45% at 50% 50%,transparent 40%,rgba(5,7,15,.85) 100%),
  repeating-linear-gradient(180deg,rgba(10,8,14,.93) 0 2.25rem,rgba(245,176,76,.10) 2.25rem 2.32rem,transparent 2.32rem 3.25rem);}
.mhud-cabinet[data-near]{box-shadow:inset 0 0 120px var(--near-tint);} /* enemy colour; only when that enemy is visible or heard within 8 m */
```
Inside, still visible: Objective, Ask Weems, Threats strip, compass, minimap + lens + Odds, Vitals, ThingStack, captions,
cabinet block. Vitals hidden row "IN CABINET · door open" / "IN CABINET · door closed". Dimmed 40%: Q/R ("Inside")
only if the sim blocks abilities inside. Hidden: reticle, lock hint. Audio heartbeat as now; captions
"[Footsteps outside ▸]".

## 3. Death sequence
1. t = 0 (`dnf`, guarded by `deathSeq`, once): sim input cut; Esc no longer pauses (it skips); HUD fades out 200 ms;
   letterbox bars 0→48 px top/bottom over 300 ms; SR assertive "Defeated by {Name}."
2. t = 0.5 s: Skip button bottom-right inside the letterbox, 112×32 (`Skip` + KeyCap `Enter`, aria-label "Skip
   cutscene"); Enter / Esc / click skip; only a keydown that STARTS after t0 counts. Skip jumps to the card (outcome
   already recorded).
3. Cutscene (3d-artist): Hyde 3.2 s · Crackstone 4.0 s · Slurp 3.6 s, each ending in a 400 ms fade to black. Caption in
   the bottom-left letterbox: "[The Hyde lunges]" / "[A curse flares]" / "[Slurp groans and grabs]".
4. GAME-OVER card: scrim rgba(6,9,20,.94); card 560×≈380 centred, fade 300 ms; pointer lock released, focus on the
   button. Medallion 80 px in the monster's chip silhouette (circle / square / drooping coffin), 2px enemy border, 40 px
   icon in enemy colour; kicker caps fs-xs muted "RUN OVER · CASE 02"; H1 Cinzel fs-2xl "Defeated by **Slurp**" (name in
   --c-{enemy}-text); flavour line fs-md text-2; WHY box (3px violet left edge, link icon + "WHY" caps, 1–2 diagnostic lines
   ≤ 52 from the diagnostic engine's dnf + last cause); tally fs-sm "2:14 played · 2/3 clues · 3 hits"; primary "See
   results" + KeyCap Enter; muted "Results in 12 s" countdown, then auto-continue.
5. Reduced motion: no camera move — 1.2 s still frame of the monster's pose → 300 ms crossfade → card; letterbox
   instant; Skip works.

## 4. Weems vs Thing
| | Principal Weems (paid hints) | Thing (free) |
|---|---|---|
| Where | Left column: button 16,108; card in the 16,152 slot | Bottom-centre ThingStack only |
| Look | Oval portrait 56×72 (ice 2px border, glow `0 0 20px var(--c-weems-glow)`, faint 3 s breathing opacity .85↔1, none in reduced motion); card bg --c-hud + 1px --c-weems α.6 border | Existing hand sigil, mint --c-layer-presc left edge |
| Voice | --font-weems italic 400 fs-md, --c-weems-text | Alegreya Sans, existing |
| Sound | Soft glass chime with reverb −20 dB | Existing double knock |
| Tag | "PRINCIPAL WEEMS · HINT 2 OF 3" | "THING'S ADVICE" + small "free" chip (fs-xs mint outline) |
Portrait (no art exists): SVG bust in the oval — bun `<ellipse cx="32" cy="16" rx="10" ry="8"/>`, head
`<circle cx="32" cy="32" r="11"/>`, shoulders `<path d="M8 80c2-16 12-24 24-24s22 8 24 24Z"/>`, vertical gradient
--c-weems α.85→.2 (a ghost render may replace it later). AskWeems button 288×36: portrait 28 | "Ask Weems" fs-sm 700 |
flex | "−50 · used {n}" fs-xs muted | KeyCap V.
| State | Shows | V / click |
|---|---|---|
| Ready | as above | first press of the run → note card; afterwards → `hint_requested{level}` |
| First-use note (once per run, 6 s) | Weems card: "My hints cost 50 points each." / "Press V again to ask." / "Thing's tips stay free." | V again within 6 s = hint |
| Cooldown (sim value) | ring on the V cap + "Ready in 12 s"; portrait greyscale | no-op, no charge |
| During CHASE / ATTACK | "Not while hunted" | no-op, no charge |
| All hints given (L3 used for the current step) | "No more hints here" (disabled) | no-op |
| Tutorial | hidden | — |
Hint card 384×≤132: portrait 56×72 left; kicker / text ≤ 90 chars ≤ 2 lines / footer fs-xs muted "−50 points · {n} hints
used"; with a target: "Marked on your map." (L1 area pulses; L2 location gets the lantern compass + minimap marker for
16 s with a 10 px ghost glyph). Hold 10 s; slide in 200 ms (none in reduced motion); text kept in Tab → "Weems' hints".
L1 general area · L2 location or evidence link · L3 deduction (never a name). Accusation step panel: a small "Ask Weems
(−50)" text button (same flow + card, docked top-left). Never: Weems text in the ThingStack, Thing's sigil on a Weems
card, Thing advice counted as a hint.

## 5. Home page leaderboard (frontend B)
`.home-board` absolute, right --page-pad, top 6rem, width 22rem: 1366×768 → x990–1342, y96–≈476 (left column ends x664,
topline tools at y68 → no overlap); 1920×1080 → x1391–1886, y135–669 (left column ends x934). < 1100 CSS px wide: hidden;
a trophy icon button "Leaderboard" in the topline instead. Panel --c-hud, 1px --c-border, --r-lg, padding 16. Header 52:
kicker "TONIGHT · TOP 5" (caps fs-xs lantern) + title "Top Detectives" (Cinzel fs-lg); right chip LIVE (mint dot + "LIVE")
/ LOCAL DEMO (lantern outline) / LIVE-disconnected (muted "Reconnecting…", keep last data). Rows 5 × 48: rank 32 (Cinzel
fs-lg) | duo portraits 2×28 overlapping −8 (omit if no duo) | nickname fs-md 700 ellipsis at 150 px | score right, Cinzel
fs-lg tabular. #1 row: --c-lantern-soft bg, 1px lantern border, --glow-lantern at 50%, 16 px trophy before the rank,
lantern score. Live update: new row slides in 16 px from the right + lantern bg flash 1.2 s; reorder FLIP 300 ms; new #1 →
"New #1!" chip in the header 4 s; reduced motion = bg flash only; loading = 5 skeleton rows (no shimmer in reduced
motion). Empty: trophy outline 32 + "No detectives on the board yet." + "Solve a case to claim #1." Footer: fs-xs muted
"Verified scores · new rules (v4)" (LIVE) / "This laptop only · not verified" (LOCAL); ghost button "View Full
Leaderboard" 100%×40 → MODAL (no route; kiosk flow kept) 60rem×37.5rem, scrim, tabs "Top scores" | "Defeat log"; Top
scores = top 20, columns # 40 · Detective 280 · Case 200 · Time 80 · Hints 64 · Score 120; Defeat log line "Runs that ended
early. Never ranked."; Esc/button closes, focus returns. Start keeps initial focus (Enter still starts). Same page copy:
footnote → "Deliver the egg, name the culprit, stay unseen. ~6 min"; step 3 → "Escape the monsters." / "Hide in cabinets
with E. Bring the egg to Iago Tower."; step 1 unchanged (R1).

## 6. Results (frontend B)
Score box (456 wide, ≈208 tall, replaces today's box; remove "Mystery: Solved — tracked separately" and the egg-tier
line; the rank chip replaces the board note):
```
SCORE   [#3 tonight]                                1,708   ← Cinzel fs-3xl lantern, header 56
Egg delivered     +1000 │ Never detected        +0 (seen 2×)
Right culprit      +300 │ No hints            +150
Clues 3/3          +300 │ Hints ×0               0
Time bonus (2:22)  +158 │ Hits ×2             −150
```
2 columns × 4 rows, 24 px each, fs-sm, values right/tabular; gains --c-text, penalties --c-danger, missed/zero muted with
the reason in brackets. Rank chip: LIVE "#3 tonight" / LOCAL "#2 on this laptop" / pending "Verifying…" / failed "Not
ranked". DNF variant: title "Defeated by {Name}" + 40 px medallion instead of the shield, flavour as sub; box header
"DEFEAT LOG" + chip "No score · not ranked"; one column: "Lasted 2:14" · "Clues 2/3" · "Egg: carried" · "Seen 4 · Hits 3 ·
Hints 1"; violet WHY line (as the game-over card); footer "Saved to tonight's defeat log."; CTA unchanged. Descriptive
panel fields: TIME · CLUES · SEEN · HITS · HINTS · EGG. Remove stale "Isaac Night did it" copy (comes from designer data).

## 7. Duo cards (frontend A)
Current card covers the brief (HP chip, six 1–5 stats, Q/R boxes, + strengths / − weaknesses). Add: (1) if abilities hit
all three monsters, rename stat "Hyde Control" → "Monster Control" and "Hyde" → "monster" in +/− lines (designer/data);
(2) a 14 px barChart icon in --c-layer-desc before "Stats compare duos…"; (3) no height change; 126-pair overflow test
still applies.

## 8. Copy (≤ 52 chars each)
| Key | String |
|---|---|
| chip.arrives / soon / away | Arrives in {m:ss} · Arriving soon · Away |
| slurp.words | Wandering · SEES YOU · Heard something · Searching · CHASING YOU · GRABBING · Wandering off |
| odds | DANGER SOON · Hears you · Sees you · Finds you · Next: {area} · Hunting you · Seen now · Hidden · Away |
| lens | {Hyde odds / Crackstone sight / Slurp odds}{ · auto} · may appear |
| strip | Tab Evidence · X Map · Esc Pause |
| tally | TALLY · Seen {n} · Hits {n} · Hints {n} |
| legend | WHAT HAPPENED · WHY · WHAT'S LIKELY · WHAT TO DO |
| cabinet | Hide · It can see you. It will check this cabinet. · DOOR OPEN · you can be spotted · Close Door · Move to step out · DOOR CLOSED · hidden from sight · Stay quiet · Exit · The door will creak soon. · [Cabinet door creaks] · {Name} saw you hide! Get out now. · {Name} is right outside. Wait. · IN CABINET · door open / closed |
| why (diag) | Hyde detected your footsteps. · Crackstone spotted you. · Slurp heard the cabinet door. · Your Pokémon blocked the attack. · Slurp saw you and gave chase. · Slurp saw you hide and pulled you out. · Lost Slurp: the cabinet door was shut. · The cabinet door creaked. |
| thing (presc) | Hide. The Hyde is approaching. · Close the cabinet. · Stay quiet. Let Slurp walk past. · It's clear. Step out and keep searching. · Use your Pokémon's defensive move. · Take the safer path. · Search the eastern corridor. |
| weems | Ask Weems · −50 · used {n} · Ready in {n} s · Not while hunted · No more hints here · My hints cost 50 points each. / Press V again to ask. / Thing's tips stay free. · PRINCIPAL WEEMS · HINT {n} OF 3 · −50 points · {n} hints used · Marked on your map. |
| death | Skip · RUN OVER · CASE {nn} · Defeated by {Name} · See results · Results in {n} s |
| death.flavour | Hyde: It followed your sound out of the fog. · Crackstone: His curse caught you in the open. · Slurp: Slurp lurched out of the dark and grabbed you. |
| death.caption | [The Hyde lunges] · [A curse flares] · [Slurp groans and grabs] |
| home | TONIGHT · TOP 5 · Top Detectives · LIVE · LOCAL DEMO · Reconnecting… · New #1! · No detectives on the board yet. · Solve a case to claim #1. · View Full Leaderboard · Verified scores · new rules (v4) · This laptop only · not verified · Top scores · Defeat log · Runs that ended early. Never ranked. · Deliver the egg, name the culprit, stay unseen. ~6 min |
| results | SCORE · Egg delivered · Right culprit · Clues {n}/3 · Time bonus ({m:ss}) · Never detected · No hints · Hints ×{n} · Hits ×{n} · #{n} tonight · #{n} on this laptop · Verifying… · Not ranked · DEFEAT LOG · No score · not ranked · Saved to tonight's defeat log. |
{Name} = "The Hyde" / "Crackstone" / "Slurp"; H1 uses ENEMY_NAMES.

## 9. Screenshot checklist
1 1366×768 find_clues with all three monsters: three 200 px chips x375–991, no overlap with objective/compass/minimap,
centre 560×320 empty · 2 greyscale + deuteranopia: chips told apart by silhouette/meter/icon · 3 Slurp chip WANDER,
CHASING YOU, GRABBING + an "Away" chip + an "Arrives in 0:xx" chip · 4 Odds: 3 one-line monster rows + 1 objective row,
≤ 184 px, footer source labels, no 0/100% · 5 inactive enemy: "Next: {area} %" and lens pins match
encounterSpawnDistribution · 6 X cycles the lens; one threat texture at a time; label updates · 7 Tally increments on a
detection, a hit, a Weems hint · 8 WHY card after an event, violet edge, no Thing sigil · 9 Thing ADVICE (sigil + free chip)
while a Weems card is in the left slot: clearly different · 10 Ask Weems: first-use note → second V gives L1; −50 + "used 1";
"Ready in n s"; "Not while hunted" · 11 Weems L2 card + map marker with ghost glyph; listed in Tab → Weems' hints · 12
cabinet in range "[E] Hide"; watched variant warning · 13 inside door open: overlay, DOOR OPEN chip, "[E] Close Door" · 14
door closed: slat overlay, DOOR CLOSED chip, "Stay quiet · [E] Exit"; Odds shows Crackstone/Slurp "Hidden" · 15 creak
warning + caption; witnessed chip in the enemy colour · 16 death: letterbox + Skip (Enter) at ~0.5 s for each monster · 17
game-over card complete · 18 reduced-motion death ≤ 1.5 s, Skip works · 19 home 1366×768 panel x990–1342, no overlap, #1
highlighted, LOCAL DEMO chip · 20 home 1920×1080 + empty state · 21 Full Leaderboard modal tabs, Esc closes, focus
returns · 22 results finisher 2×4 breakdown + total + rank chip; "+0 (seen 2×)" · 23 results DNF variant · 24 duo card
complete, no overflow, no F cap · 25 Pause: 4-chip legend + full KeyLegend with V Ask Weems (−50) and X Map.

## Asks for other owners (routed by the orchestrator)
game-dev view-model: per enemy present/active/mode/arrivesInS|null/engaged; run.player.cabinet + witnessedBy, creakInS,
enemyOutside {enemy, visible}; weems {cooldownLeftS, used, available, reason}; death {enemy, seq, durationS}; Weems
ladder resets per objective step (L1 again after a clue is found; disabled after L3 instead of charging repeats).
fullstack: `forecasts.slurp = {here:{p, fact}, cells:{x,z,sizeM:4,p}[], horizonS:15, label:'Rule-based estimate'}`;
spawn distribution grouped by area name; Weems hint {level, text ≤ 90, target?}; diagnostic codes for the WHY lines.
3d-artist: Slurp eye/drip glow #d77be0; cabinet door anim 0.4–0.6 s, camera inside behind slats, lantern outline within
useM; death cutscenes at §3 durations, cut to black at contact, no blood; optional Weems ghost bust.
