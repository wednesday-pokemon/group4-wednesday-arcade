# UX_ENEMIES — Joseph Crackstone HUD, map, audio and spectator spec (ui-ux-designer, 2026-10-24)

Binding spec for the frontend developer, with data requests for the game-developer, fullstack and 3D owners. Builds on
`UX_OVERHAUL.md` (sizes at 1366×768, rem) and `ENEMY_CONTRACT.md` R4/R6/R9. If `run.crackstone` is null nothing below
renders and the Hyde pill keeps its current box. Orchestrator notes are marked **[orch]**.

## 0. Colour token (tokens.css)
```css
:root { --c-crack:#a8e063; --c-crack-text:#c4ef8a; --c-crack-soft:rgba(168,224,99,.14); }
.high-contrast { --c-crack:#c8ff80; --c-crack-text:#e0ffb8; }
```
| Token | on `--c-bg` #0b1020 | `--c-map-ground` | `--c-map-room` | `--c-surface-2` |
|---|---|---|---|---|
| `--c-crack` | 12.2:1 | 11.3:1 | 10.1:1 | 8.9:1 |
| `--c-crack-text` | 14.5:1 | — | — | — |

- "Sickly witch-light" green, not teal: the cyan–mint band is taken by `--c-predict` #5cc0e6, `--c-success` /
  `--c-layer-presc` #6fd6a0 and the rare egg #4fd8e8; a teal enemy would make "prediction" and "good" look like danger.
- Greyscale: luminance 0.63 vs the Hyde red's 0.22 (2.5:1) → light grey vs mid grey.
- 3D: the scan ring and curse glyph use the same hue **[orch: forwarded to the 3d-artist]**.

## 1. Status pills
`.mhud-threats` flex row at top 3.5rem, centred, gap 0.5rem. Hyde pill 416×40 unchanged (x355); Crackstone pill 232×40
(x779–1011). Objective panel (ends 304) and minimap rim (≥ 1131 at y96) stay clear; the centre keep-clear is untouched.
Both pills get a caps `--fs-xs` muted kicker ("HYDE" / "CRACKSTONE").

| | Hyde | Crackstone |
|---|---|---|
| Shape | full pill (`--r-pill`) | squared plaque (`--r-sm`) |
| Alarm border | solid | **double** |
| Icons | claw / ear / eyeClosed | hat / eye / curse |
| Meter | solid underline | segmented underline |

| Mode | Word | Icon | Border | Colour |
|---|---|---|---|---|
| PATROL | Patrolling | `eye` | 1px solid `--c-border` | text |
| canSeePlayer, not chasing | SEES YOU | `eye` | 2px dashed `--c-crack` | crack-text |
| INVESTIGATE | Saw movement | `eye` | 2px dashed `--c-crack` | crack-text |
| SEARCH | Searching | `search` | 2px solid `--c-crack` | crack-text |
| CHASE | HUNTING YOU | `hat` (new) | 3px double `--c-crack` + glow `0 0 18px rgba(168,224,99,.45)` | crack-text, bold |
| ATTACK | CURSING | `curse` (new) | 5px double `--c-crack` + glow | crack-text, bold |
| RETURN | Going back | `reset` | 2px dotted `--c-border-strong` | text-2 |
| scan warning (any mode) | Scanning | `scanEye` (new) | 2px dashed `--c-crack` | crack-text |

- Suspicion meter: 3px underline, fill = min(1, suspicion / chaseAt);
  `background: repeating-linear-gradient(90deg, var(--c-crack) 0 8px, transparent 8px 10px)`.
- Effect chip under the pill centre (x825–965), Hyde chip words: PETRIFIED / STUNNED / SLOWED / DISTRACTED / LURED + s.
- ARIA `aria-label="Joseph Crackstone"`; assertive only on CHASE/ATTACK. ThreatHold 0.5 s; CHASE and ATTACK bypass it.
- New icons (Icon.tsx):
  - `hat`: `<path d="M3 18h18"/><path d="M7 18 8.5 5h7L17 18"/><rect x="10" y="12" width="4" height="3"/>`
  - `curse`: `<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4"/><path d="M12 3v5M4.2 16.5l4.3-2.5M19.8 16.5l-4.3-2.5"/>`
  - `scanEye`: the `eye` icon plus `<path d="M3 5a13 13 0 0 1 18 0"/>`
- Vitals: while `effects().cursed`, a row (hidden-row slot, stacking above if needed): `curse` icon + "CURSED · slowed
  2.4 s", 1.5px dashed `--c-crack` border.

## 2. Telegraph banners
One `TelegraphBanner` 400×44, centred at y124 (below effect chips, above the keep-clear), 4px depleting bar at the bottom.
Slot priority: curse > scan > catch/blocked toast > lock hint. While a banner is up the lock hint is suppressed and
toasts queue with their full duration.

Run helpers (game-developer): `scanExposure()` and `curseExposure()` → `'exposed' | 'covered' | 'out' | null`, using the
sim's own hit test (allowed by R9: the telegraph is public).

**Scan** — countdown = max(0, `scan.pulseAt − run.t`), one decimal, tabular numbers.
| Exposure | Line 1 (caps, bold) | Line 2 (`--fs-xs`) | Border |
|---|---|---|---|
| exposed | SCAN IN 1.6 s | Get behind a wall or hide. Crouching won't help. | 3px double crack |
| covered | SCAN IN 1.6 s | You're covered. Stay put. | 1px dashed muted |
| out | no banner; caption "[Crackstone chants ▸]" only within 40 m | | |
- Pulse hit: "SEEN BY THE SCAN" 1.2 s, then the pill goes HUNTING YOU. Pulse miss: "Scan passed. Unseen." 1.0 s, muted;
  the first miss of the run also logs once "Walls and hiding spots block scans."

**Curse** — countdown = `curse.landsAt − run.t`.
| State | Line 1 | Line 2 |
|---|---|---|
| inside | CURSE IN 0.9 s | Step out of the ring! |
| out / covered | CURSE IN 0.9 s | You're clear. Keep moving. (dashed, muted) |
| hit | CURSED −{hpLost} HP | Slowed for {curseSlowS} s (1.5 s) |
| blocked | CURSE BLOCKED | No damage. (`--c-success`, `shieldCheck`) |
| miss | Curse missed | (1.0 s, muted) |
- **[orch]** HP and slow numbers come from the `curse` event / tuning, never hard-coded.
- Edge cue: a `--c-crack` ThreatEdge chevron with the `curse` icon only when the circle centre is off-screen AND the
  player is inside the circle or within 2 m of its rim.
- Reduced motion: no depleting bar (number keeps counting), no glow pulse, no hit flash; 3D scan ring drawn at its final
  radius from the start and filled in place, no white flash.
- Screen reader (assertive, once): "Crackstone scan in 2 seconds. Get behind a wall or hide." (exposed only) ·
  "Curse! Leave the ring."

## 3. Minimap
New PublicMapState fields: `crackArea {name, polygon}`, `crackstone {x, z, yaw, coneDeg, kind: 'visible'|'chase'|
'attack'|'revealed'} | null` (R4), `curse`, `lastCrackstoneSighting`.

| # | Layer | Encoding |
|---|---|---|
| 3 | Hyde zones | unchanged: red fill + 45° hatch |
| 3b | Crackstone risk | dot stipple in `--c-crack`, r 1.5px, spacing 8/5/3px for p < .3 / < .6 / ≥ .6, α .5+.4p, fill α ≤ .10; p < .10 not drawn. Dots over hatch read as "both" in greyscale |
| 5b | Cursed area | 2px solid `--c-crack` outer + 1px dashed inner inset 3px; label "CURSED · {areaName}" (crack-text, `--fs-xs`); label priority between area % and zone %, promoted to egg-level for 30 s after the announcement or within 10 m |
| 12b | Curse circle | radius × 4 px/m, 2px stroke, pie fill of wind-up progress (kept in reduced motion), only within map radius |
| 13b | Crackstone | 14px filled `hat` + view-cone wedge (coneDeg, 40px, α .18) only per R4; otherwise a hat outline fading over 8 s at `lastCrackstoneSighting`. Scan ring drawn only while the marker is allowed (else it leaks his position) |
| 15 | Frame | CHASE/ATTACK: 2px double `--c-crack` ring (R6: never together with the Hyde's red frame) |

- % label only for the player's own cell: hat glyph + "22%" in crack-text; the 4-label cap still applies.
- Tab map: layer toggle [4 Crackstone]; legend rows "▨ Hyde likely here · Bayesian estimate"; "⁘ Crackstone may see
  this spot (next 10 s) · Rule-based estimate"; "Cursed area".
- Analytics request: `forecasts.crackstone = { cells: {x, z, sizeM: 4, p}[], here: {p, fact: 'seen'|'hidden'|'hunting'
  |null}, horizonS: 10, label: 'Rule-based estimate' }`, ≤ 1 Hz, cut to the leash disc; crossfade updates, no deltas.

## 4. Compass
- `crack_seen`: filled `hat`, 14px, `--c-crack`, while R4 allows. `crack_heard`: hat outline, held 3 s after a
  directional Crackstone caption, bearing rounded to 22.5°. `cursed_area`: text "CURSED" when the centroid is ≤ 60 m
  away and the player is outside the area.
- Label rank 3 like the Hyde; on collision the enemy in CHASE/ATTACK wins, else the nearer one.
- Threat edge (one chevron only): Hyde CHASE > Crackstone ATTACK > Crackstone CHASE > Hyde SEARCH. Crackstone SEARCH
  never gets a chevron (position not public).
- Mist: `.mhud-mist[data-enemy='crackstone']` while he chases: edge radial gradient `rgba(120,160,60,.35)` at opacity
  .45, no pulse.

## 5. Odds panel
Single-row Crackstone group, `hat` icon instead of the caps tag: "Sees this spot · 10 s" | 56×6 bar in `--c-crack` with
stipple | "22%" | band word. Facts are words: Seen now / Hidden / Hunting you. Footer "Crackstone · Rule-based
estimate". Shown only when p ≥ 5% or the player is within 15 m of the cursed area. 4-row budget; the Hyde group gives up
one row: find_clues Hyde 1 + Crackstone + Clue + Egg · find_egg Hyde 1 + Crackstone + Egg 2 · carry Hyde 2 + Crackstone
+ Tower · dormant Spawns 2 + Crackstone + Clue. Tab block "Will Crackstone see you?" with source line "Rule-based
estimate · his patrol route, sight rules, last sighting".

## 6. ThingStack
Headword **CRACKSTONE** in `--c-crack-text` ("CRACKSTONE ALERT" breaks the ≤ 13-char headword budget).
| Item | Priority | Example |
|---|---|---|
| Chase start (saw / sensed / scan_hit) | P5 | "He saw you in the open. Break line of sight!" |
| Curse hit | P5 | "The curse hit: you stayed in the ring." |
| Advice during his threat | P4 | "Get behind a wall. He hunts by sight." |
| Escape / curse dodged (WHY) | P3 | "Lost him: a wall broke his line of sight." |
| Area intro (once, ~3 s after "Go.") | P2 ADVICE | "Crackstone haunts {area}. Stay out of sight." / Why "He hunts by sight, not sound." |
| LOG | P0 | "Crackstone lost you. Escapes: 2." |
Dedupe / rate limits: scan and curse warnings never enter the stack (banners own them); a Crackstone P5 never pre-empts
a HYDE ALERT (equal priority waits); mode changes with reason `deferred` say nothing; Crackstone P5 ≤ 1 per 20 s, same
code ≥ 45 s apart; Hyde + Crackstone alerts ≤ 4 per minute.

## 7. Audio (new synthesized `Sfx` cues)
| Cue | When | Sound |
|---|---|---|
| `knell` | crackstone_sighted | single high bell (523 Hz, partials ×2.0/2.76/5.4, 1.6 s decay), −14 dB; distinct from the low DNF `toll` |
| `chant` | scan warning | two detuned saws, bandpass sweeping 400→900 Hz over scanWarnS, rising, −16 dB; ducks music a further 30% |
| `pulse` | scan pulse | 60 Hz sub thump + existing `whoosh`, −12 dB |
| `curseCast` | curse cast | 330→311 Hz triangle glide + whisper noise over the wind-up, −16 dB |
| `curseHit` | hit | tritone saw stab (185 + 262 Hz, lowpass 1.2 kHz) + crack noise, −10 dB |
| `curseFizzle` | miss / blocked | highpass hiss 0.4 s, −24 dB (blocked also plays existing `clean`) |
Captions: "[A bell tolls ▸]" · "[Crackstone chants ▸]" · "[A cold wave passes]" · "[A curse hisses]" · "[The curse
strikes you]" · "[The curse fizzles]" · "[Cloak rustles ▸]" (PATROL within 12 m).
Drone / heartbeat: `setThreat(threat, level, source)`; threat = max(hyde.suspicion, crack.suspicion / chaseAt);
Crackstone level 2 = CHASE/ATTACK, 1 = INVESTIGATE / SEARCH / scan warning while exposed; level = max of both; one
shared heartbeat; when the source is Crackstone crossfade over 0.6 s to an organ fifth (110 + 164.8 Hz, triangle, lowpass
900) instead of the Hyde's growl timbre.

## 8. Spectator board (Laptop 1)
- R5: HP bar · Caught pips · Hyde chip · Crackstone chip (`hat` + Patrol / Glimpse / HUNTING / CURSING / Search / Return,
  ≤ 100px). "Chases" moves to the right of R3 as "Chases H2 · C1".
- His chase: 2px double `--c-crack` card border + "HUNTED" chip; never show his position.
- Heartbeat request: `crackstoneMode`, `crackstonePresent`.
- KPI "Curses dodged %" = misses ÷ casts over ended runs (below 50% means a warning is too short); "—" when n = 0, "small
  sample" below 10 casts; needs `cursesCast` / `cursesHit` in DescriptiveAggregate.

## 9. Acceptance checklist (screenshot)
1. At 1366×768 the Hyde pill (355–771) and Crackstone pill (779–1011) don't overlap the objective panel or minimap; the
   centre keep-clear stays empty.
2. Both pills show their kicker; the Crackstone pill is a squared plaque with a double border in CHASE.
3. Greyscale + deuteranopia emulation: pills told apart by shape, border, icon and word.
4. All 7 Crackstone states (6 modes + scan) render word + icon from §1; SEES YOU while he sees you.
5. A case with `crackstone: null` shows the original centred Hyde pill and no Crackstone UI.
6. Scan while exposed: "SCAN IN x.x s" + line 2, counting down from ≥ 1.8 s.
7. Scan behind a wall: "You're covered"; the miss shows "Scan passed. Unseen."
8. Curse: "CURSE IN x.x s" from ≥ 1.2 s; the hit shows "CURSED −N HP" and the Vitals CURSED row.
9. Minimap: cursed-area double outline + label, stipple tint, no clash with the Hyde red; Odds footer "Rule-based
   estimate".
10. Hat marker + cone only while visible / chasing / attacking / revealed; afterwards an 8 s fading outline.
11. Minimap curse circle fills during the wind-up.
12. One threat-edge chevron at a time, §4 order.
13. Odds panel ≤ 4 rows; Crackstone row facts as words.
14. ThingStack: CRACKSTONE headword; no banner duplicates; ≤ 1 P5 per 20 s.
15. Reduced motion: no glows / pulses / depleting bar, countdown numbers still update. Spectator card shows the
    Crackstone chip and the "Curses dodged" KPI ("—" / small sample).

**If time is short, do one thing:** the exposure-aware scan banner (exposed vs covered) — the only new mechanic a
first-timer can't infer from the 3D alone ("crouching won't help").
