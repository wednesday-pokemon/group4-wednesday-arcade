# Stage 1 real-time UX spec (ui-ux-designer, saved by orchestrator)

> Orchestrator note: fonts follow docs/THEME.md — Cinzel (display) / Alegreya Sans (body) — wherever this spec says
> Fraunces / Segoe UI. Tokens (`--c-*`, `--fs-*`, `--sp-*`, `--dur-*`) as in src/ui/styles/tokens.css. 1rem = 16px @1366×768.

**Three Phase 1 HUD conflicts to fix first:** (1) the bottom-centre `.ahud-keys` strip sits exactly where the Hyde appears
behind the boat — remove it after the tutorial; (2) the red inset hit vignette is the Hyde's danger language — make
collisions a 250 ms parchment edge flash `rgba(243,236,220,.35)`, keep **red only for the Hyde**; (3) speed/cadence leaves
bottom-right (now the Q ability panel) and moves into the vitals panel.

## 1. Action HUD layout (1366×768)
```
+--------------------------------------------------------------------------------------+
|16 [OBJECTIVE 288x72]        [HYDE METER 420x60, centred, top 16]     [Esc][H][mute] |
|   Stage 1 · The Crossing     (claw) GAINING |////|---•--------[boat]| 22 m  ●○      |
|   ▬▬▬▬▬▬▬▬○──── 312 m · 41.2 s                                                       |
|                       [MESSAGE SLOT max 560x44, top 88, centred]                     |
|           KEEP CLEAR: water ahead, centre 900x320 (y 130–450)                        |
|                                 [ BOAT ~y 470–540 ]                                  |
|[VITALS 280x100, bl 16]       KEEP CLEAR: HYDE ZONE 560x220      [ABILITY 280x100]    |
| HP ██████░ 72                  (bottom-centre, y 548–768)       (img) Q  Shadow     |
| STA ████░░ 64                                                    Double   READY     |
| 8.4 m/s · 3.1 taps/s                                                                 |
+--------------------------------------------------------------------------------------+
```
Hyde meter top-centre ("boss bar"); catch pips inside it. One message slot shared by tutorial hints / one-shot hints /
Wednesday (never simultaneously). Panels `--c-hud` (α ≥ .86), `--r-lg`. Text budget: ≤ 30 words visible, ≤ 1 moving
sentence, ≤ 5 live numbers. Cinematic: all panels fade to 0 except the Hyde meter; bottom-right chip `[Space] Skip`.
ESC during rescue → 1.2 s chip "Pause after the rescue".

## 2. Hyde danger language
Meter: state icon (24px) + caps word · 240×12 track 70 m → 0 m, boat glyph fixed right, claw marker slides toward it ·
0–15 m segment permanently hatched · gap number (tabular, `--fs-lg`) · catch pips. > 70 m: marker parked left, "70+ m".
Shows the true gap even in fog. Hysteresis: exit a level only 3 m past its entry threshold; min 0.5 s per level.

| Level | Condition | Icon | Word | Marker / colour | Edge | Sound |
|---|---|---|---|---|---|---|
| 0 Calm | gap ≥ 25 | closed eye | DISTANT | 10px, text-muted | none | ambient |
| 1 Gaining | 15 ≤ gap < 25 or surge telegraph | open eye | GAINING / SURGE INCOMING | 14px, warning | bottom red mist 90px α .35 | heartbeat 1 Hz; horn on surge |
| 2 Close | gap < 15 | claw | RIGHT BEHIND YOU | 18px, danger + thick ring | bottom + sides 150px pulsing | heartbeat 2 Hz; growl sting once |

Colour-independent: every level changes word + icon + marker size + hatch. Mist always rises from the bottom.
```css
.ahud-danger{position:absolute;inset:0;pointer-events:none;opacity:0;transition:opacity var(--dur-2) ease-out;
  background:linear-gradient(to top,rgba(140,10,20,.75),transparent 150px),
             linear-gradient(to right,rgba(140,10,20,.5),transparent 110px),
             linear-gradient(to left,rgba(140,10,20,.5),transparent 110px);}
.ahud-danger[data-level="1"]{opacity:.35;background-size:100% 90px,0 0,0 0;background-repeat:no-repeat;background-position:bottom;}
.ahud-danger[data-level="2"]{opacity:.55;animation:hyde-pulse 1.2s ease-in-out infinite alternate;}
@keyframes hyde-pulse{to{opacity:.8}}
.reduced-motion .ahud-danger[data-level="2"]{animation:none;opacity:.65}
```
Reduced motion: no pulse/bob (heartbeat audio stays). `aria-live="polite"` level changes, ≤ 1 per 3 s.

## 3. Rescue prompt (~2 s real time)
560×176 panel centred, y 112–288 (above the boat). Never obscure: boat, stern + Hyde hand, catch pips, Q cap + ring.
Message slot suppressed; other panels dim to 40 % (ability panel stays 100 %, no animation).
Available:
```
THE HYDE HAS CAUGHT YOU!                       (display, fs-xl, caps, danger)
 ( ring 112px ( [ Q ] 72px ) )   PRESS Q       (fs-2xl, lantern)
                                 <Ability name> (fs-sm, text-2)
 [Space] Mash SPACE to kick free  ▮▮▮▯▯▯▯▯     (8 pips = max −48 %)
```
Not available: Q cap greyed + hatched with lock + "6 s"; primary line "{Pokémon} not ready — MASH SPACE!"; SPACE cap
200×56 primary. Last-chance (catches = 1): danger line "This catch ends the run." Countdown ring: SVG stroke depleting
clockwise, driven every frame by remaining real time + numeric "1.4" under it (always shown). Clean-escape portion of the
window (first 0.5 s; Morticia 0.8 s) drawn as a success arc with "CLEAN" tick, greyed after it passes; only drawn while
a clean escape is unused this run.
```css
.kcap--hero{width:72px;height:72px;display:grid;place-items:center;font:700 var(--fs-2xl)/1 var(--font-display);
  color:var(--c-ink);background:var(--c-lantern);border-radius:var(--r-md);box-shadow:0 5px 0 #a86f1f,var(--glow-lantern);}
.kcap--hero[data-pressed]{transform:translateY(4px);box-shadow:0 1px 0 #a86f1f;}
.kcap--denied{background:repeating-linear-gradient(45deg,var(--c-surface-2) 0 6px,var(--c-surface-1) 6px 12px);color:var(--c-text-muted);box-shadow:none;}
```
Outcome toasts (same box, 1.6 s; sub-line = the Pokémon's `rescue.text` + "Kicked: −30 % damage" if SPACE landed):

| Outcome | Headline | Style |
|---|---|---|
| Clean escape | CLEAN ESCAPE! Catch not counted. | success, check |
| Rescued | RESCUED! Catch counted — 1 of 2 | lantern, shield |
| Caught | CAUGHT! Catch 1 of 2 | danger, claw |
| Aegislash block | BLOCKED! No catch. | success |
| Second catch (DNF) | Dragged into the fog. | → DNF screen |

`aria-live="assertive"` only for "THE HYDE HAS CAUGHT YOU! PRESS Q".

## 4. Ability panel (bottom-right 280×100)
72px circular portrait (`/art/pokemon/<id>.webp`) with cooldown sweep; 36px Q cap overlapping its bottom-left; right
column ability name (fs-md 700) + state line (fs-sm). Unlimited → sweep only (never "∞"); limited charges → pips + sweep;
0 pips → "No charges left".
```css
.abil__sweep{position:absolute;inset:0;border-radius:50%;background:conic-gradient(rgba(11,16,32,.78) calc(var(--cd)*1turn),transparent 0);}
```
| State | Copy | Visual |
|---|---|---|
| Ready | READY | full colour; 300 ms lantern glow + chime on becoming ready; Q cap glows while gap < 30 m |
| Cooling | 12 s | sweep, portrait 60 % saturation |
| Rescue-ready (≥ 75 % cooldown) | Rescue ready · 4 s | shield-check glyph, success border |
| Active | ACTIVE 3.2 s / 2 hits left | type-colour ring + draining 4px bar |
| Denied | Not ready · 6 s | 2×6px shake 160 ms + low thunk (reduced motion: border flash) |

## 5. Selection screens (no scroll at 1366×768)
Frame: padding 24, header 56, footer 60 ([Back] / [Continue (Enter)]), body = grid 2/3 (860px) + detail panel 1/3
(440px), gap 18; body height 3 rows × 176 + 2 × 12 = 552 → total 748. `role="radiogroup"`, focus updates detail (no
hover dependency), Enter selects.
**Characters 4×3, cards 203×176:** portrait 203×128 (`object-position: top`), name fs-md 700, 5 vertical micro-bars
(4×24px) top-right "fingerprint", archetype chip (Speedster: Enid/Gomez/Yoko · Forgiving: Xavier/Ajax/Rowan · Survivor:
Kent/Morticia · Scout: Wednesday/Eugene/Bianca · Cruiser: Divina). Detail: 160px portrait, name fs-xl, trait name
accent-text, trait text fs-sm, five stat bars, "Best at: X · Weak at: Y" (highest/lowest stat), footnote "Every crew
has 30 points."
**Stat bars:** labels Power / Top speed / Stamina / Handling / Toughness; 10 fixed segments (18×10, 3px gap), absolute
1–10 scale (never normalised), neutral tick after 5; filled > 5 `--c-lantern`, ≤ 5 `--c-text-2`; below 5 shows a hatched
deficit; value + "+2"/"−1" delta (fs-xs).
**Pokémon 6×3, cards 136×176:** image 136×100, name fs-sm 700 (≤ 2 lines, `text-wrap: balance`, check "Galarian
Corsola"), type chip (icon + word). Detail: 180px image, name, type chip, ability name, description, "Cooldown 26 s"
(charges: "4 uses · 8 s"), "Rescue: blocks damage · +10 m" built from rescue flags, passive text, role profile 4 rows of
0–3 dots (Speed / Safety / Egg / Hunt from GDD §9.3).
**Type labels:** speed_boost Speed Burst (bolt, Speed) · current_ride Current Rider (wave, Speed) · stamina_restore Second
Wind (heart, Speed) · shield Shield (shield, Safety) · hyde_distraction Decoy (ghost, Safety) · pursuit_slow Slows the
Hyde (hand, Safety) · egg_protection Egg Guard (egg+shield, Egg) · obstacle_detection Hazard Sight (eye, Hunt) ·
fog_clear Fog Clearer (flame, Hunt) · egg_sense Egg Finder (gem, Hunt).

## 6. Tutorial (≤ 30 s, learn by doing)
Step 0 card before the water: "How do you like to row?" [Tap SPACE] (default) / [Hold SPACE — easier on hands];
"H switches anytime"; persistent "Skip tutorial (Enter)". Calm water at the start dock, no Hyde. Progress dots, ✓ 400 ms,
auto-advance on timeout.

| # | Prompt | Completes when | Timeout |
|---|---|---|---|
| 1 | Tap SPACE steadily to row | 6 accepted strokes and speed ≥ 5 (hold: held 2 s) | 8 s |
| 2 | Steer with A and D | pass a lantern gate 25° off-axis | 7 s |
| 3 | Hold W to glide | W held 1 s | 4 s |
| 4 | Hold S to brake | speed < 3 | 4 s |
| 5 | Press Q: Pokémon ability | Q fires (real VFX) | 4 s |
| 6 | Caught! Press Q to escape | Q or SPACE in a staged slow-mo ring using the real rescue UI | 3 s |

## 7. Wednesday's live advice line
Message slot, top-centre y 88: 32px Wednesday portrait chip, quote fs-md italic, 3px `--c-accent` left border.
≤ 8 words / 48 chars, one line, 2.5 s. ≥ 6 s between lines, each line ≤ 2× per run, ≥ 2 s after any toast; never during
rescue, cinematic, tutorial steps or hints. Highest GDD §13 priority wins; a higher one replaces after ≥ 1 s; triggers
older than 1.5 s are dropped; queue depth 1. Priority: surge > close+ready > close+not-ready > first catch >
egg/dock > technique (stamina, mashing, collisions, narrows, fog, current) > idle/smug.

## 8. Audit checklist
1. Bottom-centre 560×220 and centre 900×320 free of HUD in steady state. 2. Collision flash not red. 3. Hyde meter: gap in
fog, "70+ m", 3 m hysteresis. 4. Each danger level changes word + icon + marker size (greyscale check). 5. Reduced motion:
no pulse/shake/denied-shake; ring + numeric countdown still work. 6. Rescue panel never covers boat/stern/pips/Q cap;
message slot suppressed; ESC shows "Pause after the rescue". 7. Clean-escape arc only while unused, correct length.
8. Not-ready rescue variant for cooldown and 0 charges. 9. Toast headlines ≤ 6 words; sub-line from `rescue.text`.
10. Ability panel 5 states with distinct copy. 11. Both select screens fit 768 px, no truncation. 12. Stat bars absolute
1–10 with neutral tick + hatched deficit; values match data. 13. Type labels from one mapping table. 14. Tutorial ≤ 30 s,
hold-to-row before step 1, Enter skips. 15. Wednesday ≤ 48 chars, ≥ 6 s gap, ≤ 2× per run, never in rescue/cinematic;
panel text contrast ≥ 4.5:1.
**If time is short:** clear the bottom-centre and make red mean only the Hyde first.
