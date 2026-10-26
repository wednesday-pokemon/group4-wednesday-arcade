# UX_DUO_CARDS — the duo cards as Pokémon trading cards (ui-ux-designer, 2026-10-24)

Binding spec for the visual redesign of the three duo-selection cards. Reference: `refs/pokemon-card-ref.jpg` (owner's
Gemini card); before: `refs/duo-card-before.png`. Presentation only — draft/randomization, stats, powers, moves, values,
flow, testids unchanged. Orchestrator rulings are marked **[R]**.

## 0. Verdict
The old card reads as a dashboard (6-stat grid + two text boxes + four sentences; art ≈ 20 %). Fix = the trading-card
hierarchy: art ≈ 45 %, two attack-style rows (short effect + big cooldown number), stats reduced to one strengths /
weakness strip, everything else behind **Details**. Three cards at a true 63:88 fit at 1366×768.

## 1. Layout (rem; 1rem = 16 px at 1366, 22.5 px at 1920)
- Screen: keep `.duo-draft` rows `4.5rem 36rem 2.5rem`, gap .5rem, page padding 1.5rem → 752 px at 1366, 1057 px at 1920.
- Row: `.duo-row{grid-template-columns:repeat(3,25.75rem);justify-content:center;gap:1.25rem}`.
- Card `width:25.75rem;height:36rem` (63:88) = 412×576 px at 1366 (three = 1276 of 1318), 579×810 px at 1920.
- Compromise: the six stat rows + the advantage/disadvantage sentences move into Details.
- Frame (metal) .625rem; face padding .375rem/.5rem → content 376×544 px at 1366.
- Face grid `grid-template-rows:1.75rem 1.25rem 1fr 1.125rem 3.125rem 3.125rem 2.625rem 1rem 2.5rem; row-gap:.25rem`:

| Zone | @1366 | Content |
|---|---|---|
| Header 1 | 28 px | duo name + HP + type symbol |
| Header 2 | 20 px | duo-title ribbon + grab |
| Art (`1fr`) | 248 px | 43 % of card |
| Caption | 18 px | identity · types, role chip |
| Power | 50 px | Q ability |
| Move | 50 px | R ability |
| Strip | 42 px | strengths / weakness |
| Flavour | 16 px | rarity + set number |
| Buttons | 40 px | Select + Details |

Fonts: name Cinzel 700 1.0625rem; HP label Alegreya 700 .875rem + number Cinzel 700 1.375rem; ribbon Cinzel 600 .875rem;
ability name Alegreya 700 1.0625rem; effect Alegreya 400 .9375rem; cooldown Cinzel 700 1.375rem + "s" .875rem; strip and
flavour .875rem. Floor: nothing below 14 px at 1366.

**Details**: bottom row `[Select duo 1fr][Details 6.5rem]`. Details (and the **D** key) toggles the details of **all three
cards together** (comparison); Esc closes Details before Back. `aria-expanded`/`aria-controls`; testid `btn-duo-details-N`;
same roving tabindex as Select; disabled until settled. Panel covers the face from the art top to the button row
(376×442 px), header stays; `rgba(10,8,18,.94)`, 1 px type-accent border, 150 ms fade. Contents: vitals sentence; 2-column
stat grid with best-of-three ▲ (testid `stats`); full power + move texts with adaptation notes; original advantage /
disadvantage sentences (testid `trade-list`). Tests reading those must open Details first. Footer keys add "· D details";
legend: "Three duos were drawn for you. ⧗ = cooldown in seconds. D shows full stats. Frames are decoration only."

## 2. Art window (376×248 px at 1366, 529×349 at 1920; sources are 320 px — never upscale beyond ~1.15×)
Back to front:
1. Backdrop: the same portrait, `object-fit:cover; transform:scale(1.15); filter:blur(8px) brightness(.5)` (every portrait
   has a purple-night castle background → consistent scene for all 126 pairs).
2. Type tint: `var(--type-face-top)`, `mix-blend-mode:soft-light; opacity:.45`.
3. Sharp portrait: `height:100%; aspect-ratio:1; position:absolute; right:-.75rem; top:0; object-position:50% 0;
   mask-image:linear-gradient(90deg,transparent 0,#000 30%)` → the character stands behind, right.
4. Fog: `linear-gradient(0deg, var(--type-face-bottom) 0, transparent 35%)`.
5. Ground shadow: `radial-gradient(closest-side, rgba(0,0,0,.6), transparent)`, 60 %×12 % bottom-left.
6. Pokémon foreground left: box `left:.25rem; bottom:-3%; width:56%; height:94%`, `object-fit:contain;
   object-position:50% 100%`; rim + separation `filter: drop-shadow(0 0 1px rgba(255,255,255,.55)) drop-shadow(0 0 10px
   var(--type-accent)) drop-shadow(6px 4px 8px rgba(0,0,0,.55))`; optional `POKE_NUDGE` (scale, x, y) per Pokémon for
   outliers (Drifblim tall, Dragapult tail, Galarian Corsola branches); floating Pokémon get a fainter, lower shadow.
7. Vignette `box-shadow: inset 0 0 40px rgba(0,0,0,.6)`.
8. Frame: 3 px bevelled metal (`border-image: linear-gradient(145deg,#f3dc8a,#8a6a24,#d9b25a)`) + 1 px dark inner line.
The header ribbon may overlap the art top by .375rem (like the reference's STAGE banner).

## 3. Type theming
All 18 partners are part Ghost → theme = first non-Ghost type; pure Ghost = Ghost. Ghost shows as a 1rem secondary disc
under the main symbol. Face: `data-type`, 18 % accent radial glow at the top, texture (SVG feTurbulence 6 % +
`repeating-linear-gradient(135deg,rgba(255,255,255,.025) 0 2px,transparent 2px 6px)`).

| Type (partners) | Face top → bottom | Accent | ivory / secondary contrast |
|---|---|---|---|
| Ghost (Misdreavus, G-Corsola, Dusknoir) | #2e2250 → #0e0a1e | #a891e6 | 12.2 / 8.9 |
| Fire (A-Marowak, Chandelure, Ceruledge) | #6a2a12 → #200c08 | #f08a3c | 9.1 / 6.7 |
| Water (Jellicent, Basculegion) | #123a5a → #08142a | #4f8fd6 | 10.0 / 7.3 |
| Grass (Trevenant, Dhelmise, Decidueye) | #1f4a2a → #0a1a10 | #7cc46a | 8.6 / 6.3 |
| Ice (Froslass) | #1c4552 → #0a1820 | #9fe0f0 | 8.8 / 6.4 |
| Steel (Aegislash, Gholdengo) | #3a3e48 → #121418 | #c9d3e6 | 9.0 / 6.6 |
| Poison (Gengar) | #43204f → #150a1c | #c06ad8 | 11.5 / 8.4 |
| Dark (Sableye) | #2a2024 → #0c0a0c | #a8865c | 13.4 / 9.8 |
| Flying (Drifblim) | #2c3a66 → #0e1330 | #a9b8f0 | 9.4 / 6.8 |
| Dragon (Dragapult) | #2a2a6e → #0c0c26 | #6c7cf2 | 10.8 / 7.9 |

No red hues (red = Hyde). Type symbol: 1.75rem accent disc, rgba(255,255,255,.6) rim, ink glyph #120c14 (≥ 5:1 on every
accent), original 24-unit SVGs: Fire two-tongued flame · Water droplet with crescent cut-out · Grass two leaves on one
stem · Ice three crossed bars with V tips · Steel hex nut · Poison three rising bubbles · Dark crescent moon · Flying raven
feather · Dragon twin curved fangs · Ghost sheet-wisp with wavy hem + two eye holes. Type words always in the caption
("Siren · Fire / Ghost") → greyscale-safe.

## 4. Ability rows
`grid-template-columns:3rem 1fr 3.25rem`, padding .1875rem .5rem, `rgba(8,6,14,.42)`, accent hairline on top, radius 6 px.
- Line 1 (1.5rem): glyph disc 1.375rem (power = original "eye in a pointed diamond" crest on silver; move = main type
  symbol), `kbd.kcap` (Q power / R move, from ABILITY_KEY_LABEL) 1.375rem, ability name, "Game adaptation" dashed badge
  whenever `adaptationNote` is set (exact text; note in `title` + Details). **[R] confirmed — also on Gomez's power; honest
  labelling.**
- Line 2 (1.25rem): LOUD tag first (word on amber) when loud, then the short effect.
- Right column (spans both lines): hourglass + "50" + small "s", `aria-label="cooldown 50 seconds"`.
- Short text: hand-written `POWER_SHORT` / `MOVE_SHORT` maps in duoView (by character / Pokémon id); fallback = full text
  up to the first `.`/`;`/`:`. Width test ≤ 296 px (246 px when LOUD) at 15 px regular; line 1 ≤ 300 px.
  **[R] every number in a short text must appear in that ability's full data text (unit test), so the shortening never
  drifts from the data; the wording follows the data text (which names the Hyde).**
  Powers: Wednesday "Marks the nearest clue (35 m) for 6 s · silent" · Morticia "Shows the Hyde's next 6 s of path ·
  silent" · Enid "+25% speed and a trail to a clue for 7 s" · Bianca "Lures the Hyde up to 18 m away for 4 s" · Eugene
  "Marks a clue and distracts the Hyde for 5 s" · Gomez "Opens a shortcut or stuns a Hyde 2 s" · Ajax "Petrifies a Hyde you
  face for 2.5 s".
  Moves: Gengar "Decoy burst 22 m away; staggers a seen Hyde" · Alolan Marowak "Lights cover and hiding spots for 8 s" ·
  Misdreavus "A seen Hyde loses track of you for 4 s" · Galarian Corsola "Slows a seen Hyde 40% for 5 s, heals 10 HP" ·
  Sableye "Stops a seen Hyde (6 m) for 1.2 s" · Dusknoir "Stuns a close Hyde 1.8 s, even mid-grab" · Drifblim "+30% speed
  for 6 s; louder footsteps" · Froslass "Slows a Hyde you face by 45% for 5 s" · Jellicent "Splash decoy holds the Hyde
  for 5 s" · Chandelure "Lights the nearest clue and cover for 6 s" · Aegislash "Blocks one grab's damage (catch counts)"
  · Trevenant "Slows a Hyde 35% for 6 s, heals 8 HP" · Dhelmise "Tethers a seen Hyde 3 s, guards the egg 8 s" ·
  Decidueye "Pins a seen Hyde (15 m) for 2 s" · Dragapult "Stuns a seen Hyde 1 s, then lures it 3 s" · Basculegion
  "Instant 5 m dash where you face" · Ceruledge "Stuns a close Hyde 1.5 s and heals 10 HP" · Gholdengo "Coin decoy 4 s;
  halves egg damage 6 s". (Verify each against data; fix wording/numbers that do not match.)

## 5. Strengths / weakness strip
Strengths = stats ≥ 4, sorted by value, then best-of-three, then STAT_ROWS order, max 2 (none → the single highest);
best-of-three gets a small lantern ▲ (+ sr "best of the three"). Weakness = lowest stat if ≤ 2 → "Low Defense", else
"Balanced". Two lines: "(+) **Advantages:** Stealth, Investigation" / "(−) **Disadvantage:** Low Defense" (worst case 281 /
360 px). Plate `linear-gradient(#2a2733,#1a1820)`, 1 px #8d93a6 border. The old sentences move to Details.

## 6. Header
- Row 1 left: `h2#duo-N-title` = **"Bianca’s Alolan Marowak"** (character short name + ’s + Pokémon, as the reference
  writes it) **[R] chosen**, class `.duo-card__duo` kept. Budget 275 px; after `document.fonts.ready` shrink to .9375rem,
  then .875rem if needed; never ellipsis. 126-pair fit test with a measured Cinzel width table.
- Row 1 right: `data-testid="duo-vitals"` wraps "HP 100 [type symbol]" and, in row 2, "grab −42" (.875rem, secondary);
  screen readers get `vitalsSpeech`.
- Row 2 left: the generated duo title ("The Siren Keeper") on a slanted silver ribbon (ink #15121c on silver ≈ 12:1).
- Caption: "Siren · Fire / Ghost" (identity up to " (") left; role chip (icon + word) right.
- Flavour: "◆ Rare · Nevermore 034/126" (●/◆/★ + word), aria-hidden except the rarity word.
- `vitalsCompact` and the names-row budget test become obsolete **[R] — replaced by the 126-pair header-fit test.**

## 7. States
Frame antique gold for every card (`linear-gradient(145deg,#f3dc8a,#b8892e 22%,#6e4f17 48%,#d9b25a 70%,#7a5a1c)`);
common plain, rare + inner silver hairline, epic + corner fleurons + foil sheen across the art on hover. Hover/active:
`translateY(-6px)`, glow `0 0 28px color-mix(in srgb,var(--type-accent) 40%,transparent)`, one 600 ms frame sheen. Focus:
`outline:3px solid var(--c-focus); outline-offset:5px`; buttons keep `--focus-ring`. Chosen: `scale(1.03)`, lantern glow,
"Chosen" ribbon; others `opacity:.45; grayscale(.6)`. Face-down back: card-back image `object-fit:cover` over the whole
412×576 box; flip timings unchanged. Spin: same face grid + art-window layers cycling portrait and Pokémon (preload all
25 images at mount); name slot "Drawing…"; HP/ability/strip/flavour = shimmer blocks at the exact row heights; face stays
on the neutral Ghost palette during the spin (colour flicker every 70 ms = flash hazard); the real type face cross-fades
in over 300 ms on settle; `duo-settle` stays. Reduced motion: start settled, no lift/scale/sheen/pulse/fade. High
contrast: face #000, frame 2 px solid #fff, no textures/shadows, type discs white + black glyphs, all text #fff.

## 8. Acceptance checklist (1366×768 and 1920×1080)
1. Three 63:88 cards (412×576 / 579×810), even gaps, no scrollbar, header + footer fully visible.
2. Gold frame, rounded corners, textured type-coloured face — the reference's anatomy.
3. Art window ≥ 43 % of card height; Pokémon front-left with shadow + rim light; portrait behind-right, feathered, no seam.
4. All 18 Pokémon consistent in scale and baseline (debug grid of 18 art windows).
5. Header "Name’s Pokémon … HP 100 [symbol]" on one line, no ellipsis, all 126 pairs (unit test).
6. Two ability rows: glyph, Q/R cap, name, one effect line, big "⧗ N s"; LOUD / Game adaptation where the data says.
7. Strip "Advantages: …" / "Disadvantage: Low …" derived from the stats.
8. No text < 14 px at 1366.
9. All face text ≥ 4.5:1 (§3); no red outside Hyde UI; type + rarity readable in greyscale.
10. Details / D opens all three panels with full stats + texts, no scroll; Esc closes.
11. Back → flip → spin → settle with no box-size change; Skip and click-mid-spin still work.
12. Focus ring distinct from the gold frame; Chosen clear; reduced motion + high contrast correct.

**Biggest single win:** §1 + §2 first — the 63:88 card, the 248 px art window and the Details overlay.
