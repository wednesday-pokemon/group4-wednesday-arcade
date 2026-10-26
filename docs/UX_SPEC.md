> **Orchestrator note (integration owner):** This spec was produced by the `ui-ux-designer` agent and saved verbatim
> below. One override applies: the theme (docs/THEME.md, theme-factory) uses **Cinzel** (display, headings only) and
> **Alegreya Sans** (UI/body), both self-hosted via `@fontsource/cinzel` and `@fontsource/alegreya-sans` (already
> installed). Where this spec says Fraunces / Palatino / Segoe UI, substitute Cinzel / Alegreya Sans respectively and keep
> every other token (colors, scale, spacing, motion, focus) as specified. Use `font-variant-numeric: tabular-nums` for numbers.

# UX_SPEC: Escape from Raven Island: The Hyde's Regatta

Version 1.0 (rules v2.5). Targets: Chrome/Edge in fullscreen or kiosk mode on 16:9 laptops. The base design is 1366×768 CSS px, where 1rem = 16px. Everything scales with rem.

**Viewports.** Test these CSS viewports: 1280×720, 1366×768, 1536×864 and 1920×1080. A 1920×1080 laptop at Windows 125% or 150% scaling gives a CSS viewport of 1536×864 or 1280×720.

**Fullscreen.** A non-fullscreen 1366×768 window is only about 657px tall. If `innerHeight < screen.height - 40`, the splash shows the toast "Press F for fullscreen". The game cannot exit fullscreen by itself.

**Esc in fullscreen.** In fullscreen, Esc exits fullscreen at browser level. Call `navigator.keyboard.lock(['Escape'])` after `requestFullscreen()`, or launch with `--kiosk`. Never make Esc the only way to do anything.

---

## 1. Design tokens

**Fonts.**
- Display: Fraunces (OFL), self-hosted as a variable woff2 with a Latin subset of about 100 KB. Do not load it from a CDN.
- Fallback for display: Palatino Linotype. It ships with Windows and fits the dark-academia look.
- Body: Segoe UI Variable. It is native on the target OS, works offline and supports tabular numbers. The game's personality comes from Fraunces used at weight extremes, not from the body font.

```css
@font-face {
  font-family: "Fraunces";
  src: url("/fonts/Fraunces-Variable.latin.woff2") format("woff2-variations"),
       url("/fonts/Fraunces-Variable.latin.woff2") format("woff2");
  font-weight: 100 900; font-style: normal; font-display: swap;
}
@font-face {
  font-family: "Fraunces"; font-style: italic; font-weight: 100 900; font-display: swap;
  src: url("/fonts/Fraunces-Italic-Variable.latin.woff2") format("woff2");
}

/* Fluid root: 16px at 1366x768, 22.5px at 1920x1080, proportional on any 16:9; min() guards short/narrow windows */
html { font-size: clamp(15px, min(1.1713vw, 2.0833vh), 22.5px); }

:root {
  /* ---- Color: surfaces ---- */
  --c-bg: #0b1020;
  --c-surface-1: #161a3a;          /* cards, panels */
  --c-surface-2: #232857;          /* raised / hover / disabled fill */
  --c-hud: rgba(11, 16, 32, 0.86); /* HUD over 3D: alpha must stay >= .86 */
  --c-scrim: rgba(6, 9, 20, 0.72);
  --c-border: #2e3366;             /* decorative only */
  --c-border-strong: #6b6aa8;      /* inputs, interactive outlines (>=3:1) */

  /* ---- Color: text ---- */
  --c-text: #f3ecdc;               /* parchment */
  --c-text-2: #d4cbb5;             /* secondary */
  --c-text-muted: #a49fbf;         /* metadata */
  --c-ink: #0b1020;                /* text on light fills */

  /* ---- Color: accent & semantic ---- */
  --c-accent: #8b7cf6;             /* fills, borders, glows; text only >= 24px on bg/surface-1 */
  --c-accent-text: #b3a8ff;        /* accent-colored text at any size */
  --c-accent-soft: rgba(139, 124, 246, 0.16);
  --c-lantern: #f5b04c;            /* primary CTA, key numbers, focus */
  --c-lantern-soft: rgba(245, 176, 76, 0.16);
  --c-success: #6fd6a0;
  --c-warning: #f5b04c;            /* always paired with "!" icon + word */
  --c-danger: #ff7b7b;
  --c-danger-soft: rgba(255, 123, 123, 0.14);

  /* ---- Eggs (always + label + shape) ---- */
  --c-egg-none: #a49fbf;
  --c-egg-common: #efe6cc;
  --c-egg-rare: #4fd8e8;
  --c-egg-legendary: #f2c94c;

  /* ---- Weather (always + icon + name) ---- */
  --c-wx-clear: #d9d4f2;
  --c-wx-currents: #5cc0e6;
  --c-wx-fog: #b8b3cc;

  /* ---- Typography ---- */
  --font-display: "Fraunces", "Palatino Linotype", "Book Antiqua", Palatino, Georgia, serif;
  --font-body: "Segoe UI Variable Text", "Segoe UI Variable", "Segoe UI", system-ui, sans-serif;
  --font-mono: "Cascadia Mono", Consolas, "Courier New", monospace; /* seeds/hashes only */

  /* px values at 1366x768 in comments; clamp floors protect 1280x720 */
  --fs-xs:   clamp(14px, 0.9375rem, 21px);  /* 15  badges, footnotes, caps labels */
  --fs-sm:   clamp(15px, 1.0625rem, 24px);  /* 17  card lines, reasons */
  --fs-md:   clamp(17px, 1.1875rem, 27px);  /* 19  body */
  --fs-lg:   clamp(21px, 1.5rem,    34px);  /* 24  decision labels, stat values */
  --fs-xl:   clamp(28px, 2rem,      45px);  /* 32  panel headlines, route names */
  --fs-2xl:  clamp(38px, 2.75rem,   62px);  /* 44  key numbers */
  --fs-3xl:  clamp(58px, 4.25rem,   96px);  /* 68  screen titles */
  --fs-hero: clamp(80px, 6rem,     135px);  /* 96  final score */
  --lh-tight: 1.05; --lh-snug: 1.25; --lh-body: 1.4;
  --fw-light: 300; --fw-regular: 400; --fw-semi: 600; --fw-bold: 700; --fw-black: 850;
  --tracking-caps: 0.08em;

  /* ---- Spacing (4px base) ---- */
  --sp-1: 0.25rem; --sp-2: 0.5rem; --sp-3: 0.75rem; --sp-4: 1rem;
  --sp-5: 1.5rem;  --sp-6: 2rem;   --sp-7: 3rem;    --sp-8: 4rem;
  --page-pad: 1.5rem;              /* 24 */
  --gutter: 1rem;                  /* 16 */

  /* ---- Radii ---- */
  --r-sm: 4px; --r-md: 8px; --r-lg: 14px; --r-pill: 999px;

  /* ---- Elevation & glow (navy-tinted, never pure black) ---- */
  --shadow-1: 0 2px 8px rgba(3, 5, 15, 0.5);
  --shadow-2: 0 12px 32px rgba(3, 5, 15, 0.65), 0 0 0 1px rgba(139, 124, 246, 0.12);
  --glow-accent: 0 0 0 1px rgba(139, 124, 246, 0.6), 0 0 20px rgba(139, 124, 246, 0.3);
  --glow-lantern: 0 0 24px rgba(245, 176, 76, 0.4);
  --glow-rare: 0 0 28px rgba(79, 216, 232, 0.45);
  --glow-legendary: 0 0 36px rgba(242, 201, 76, 0.55);

  /* ---- Focus ---- */
  --c-focus: #f5b04c;
  --focus-ring: 0 0 0 3px var(--c-bg), 0 0 0 6px var(--c-focus);

  /* ---- Motion ---- */
  --dur-1: 120ms;  /* hover / press */
  --dur-2: 200ms;  /* state change, panel in/out */
  --dur-3: 300ms;  /* screen transition */
  --dur-reveal: 700ms; /* egg reveal, score count-up: narrative moments only */
  --stagger: 40ms;
  --ease-out: cubic-bezier(0.22, 1, 0.36, 1);
  --ease-in-out: cubic-bezier(0.65, 0, 0.35, 1);

  /* ---- Layers ---- */
  --z-canvas: 0; --z-scrim: 10; --z-hud: 20; --z-overlay: 30; --z-modal: 40; --z-toast: 50;
}

/* Reduced motion: OS preference OR operator toggle (class on <html>) */
@media (prefers-reduced-motion: reduce) {
  :root { --dur-1: 0ms; --dur-2: 0ms; --dur-3: 0ms; --dur-reveal: 0ms; --stagger: 0ms; }
  *, *::before, *::after { animation-duration: .01ms !important; animation-iteration-count: 1 !important;
    transition-duration: .01ms !important; scroll-behavior: auto !important; }
}
.reduced-motion { --dur-1: 0ms; --dur-2: 0ms; --dur-3: 0ms; --dur-reveal: 0ms; --stagger: 0ms; }
.reduced-motion *, .reduced-motion *::before, .reduced-motion *::after {
  animation-duration: .01ms !important; animation-iteration-count: 1 !important; transition-duration: .01ms !important; }

/* High contrast (operator toggle) */
.high-contrast {
  --c-bg: #000; --c-surface-1: #000; --c-surface-2: #111; --c-hud: #000; --c-scrim: rgba(0,0,0,.95);
  --c-border: #fff; --c-border-strong: #fff;
  --c-text: #fff; --c-text-2: #fff; --c-text-muted: #e6e6e6;
  --c-accent: #c4b8ff; --c-accent-text: #d9d2ff; --c-lantern: #ffc766; --c-focus: #ffff00;
  --c-success: #8cf0b8; --c-danger: #ff9a9a;
  --shadow-1: none; --shadow-2: none; --glow-accent: none; --glow-lantern: none; --glow-rare: none; --glow-legendary: none;
}
.high-contrast .panel, .high-contrast .card { border-width: 2px; }
```

**JS hook.** The 3D layer reads the same preference:

```ts
const reduceMotion = () =>
  matchMedia('(prefers-reduced-motion: reduce)').matches ||
  document.documentElement.classList.contains('reduced-motion');
```

When reduced motion is on, the 3D scene changes as follows:
- Camera cuts instead of sweeps.
- No camera shake.
- Water bob amplitude ≤ 25%.
- No particle bursts.

### Verified contrast (WCAG 2.1 AA)

"HUD worst" means the `--c-hud` panel at 86% opacity composited over pure white. That gives an effective background of about #2d313f, L ≈ 0.032.

| Foreground | on bg #0b1020 | on surface-1 | on surface-2 | on HUD worst | Use |
|---|---|---|---|---|---|
| text #f3ecdc | **16.1** | 14.4 | 11.8 | 10.9 | all |
| text-2 #d4cbb5 | 11.7 | 10.5 | 8.6 | 8.0 | all |
| text-muted #a49fbf | 7.5 | 6.7 | 5.5 | 5.1 | all |
| accent-text #b3a8ff | 9.0 | 8.0 | 6.6 | 6.1 | all |
| accent #8b7cf6 | 5.7 | 5.1 | **4.2 (fail small)** | **3.9 (fail small)** | Text only on bg or surface-1. Elsewhere use it for borders and fills. |
| lantern #f5b04c | 10.1 | 9.0 | 7.4 | 6.9 | all |
| success #6fd6a0 | 10.6 | 9.5 | n/a | 7.2 | all |
| danger #ff7b7b | 7.6 | 6.7 | 5.5 | 5.1 | all |
| egg rare #4fd8e8 / legendary #f2c94c / common #efe6cc | 11.1 / 11.9 / 15.2 | – | – | – | all |
| weather currents #5cc0e6 / fog #b8b3cc / clear #d9d4f2 | 9.1 / 9.3 / 13.2 | – | – | – | all |

**Ink #0b1020 on fills:**

| Fill | Ratio |
|---|---|
| lantern | 10.1 |
| accent | 5.7 |
| danger | 7.6 |
| success | 10.6 |
| rare | 11.1 |
| legendary | 11.9 |

**Non-text UI (needs 3:1):**

| Element | Ratio |
|---|---|
| border-strong vs bg | 3.8 |
| border-strong vs surface-1 | 3.4 |
| accent selected border vs surface-1 | 5.1 |
| focus ring vs bg | 10.1 |

Ivory text on an accent fill is only 2.8. **Never put light text on `--c-accent` fills.**

High contrast mode: white on black is 21:1, and muted is about 16:1.

---

## 2. Base CSS

```css
body { margin:0; height:100dvh; overflow:hidden; background:var(--c-bg); color:var(--c-text);
  font: var(--fw-regular) var(--fs-md)/var(--lh-body) var(--font-body);
  font-variant-numeric: tabular-nums lining-nums; -webkit-font-smoothing: antialiased; }
#scene { position:fixed; inset:0; z-index:var(--z-canvas); }
.screen { position:fixed; inset:0; z-index:var(--z-hud); padding:var(--page-pad); display:grid; overflow:hidden; }
.panel { background:var(--c-hud); border:1px solid var(--c-border); border-radius:var(--r-lg); box-shadow:var(--shadow-2); }
/* No backdrop-filter: blur on top of a WebGL canvas costs too much on integrated GPUs. */
.scrim-left { background: linear-gradient(90deg, rgba(11,16,32,.94) 0%, rgba(11,16,32,.86) 40%, rgba(11,16,32,0) 64%); }
.scrim-full { background: radial-gradient(120% 90% at 50% 40%, rgba(11,16,32,.82), rgba(6,9,20,.95)); }
.title { font: var(--fw-black) var(--fs-3xl)/var(--lh-tight) var(--font-display); letter-spacing:-0.02em; font-variation-settings:"SOFT" 50, "WONK" 1; }
.caps { font-size:var(--fs-xs); font-weight:var(--fw-bold); letter-spacing:var(--tracking-caps); text-transform:uppercase; color:var(--c-text-muted); }
:focus { outline:none; }
:focus-visible { outline:3px solid transparent; /* visible in forced-colors */ box-shadow:var(--focus-ring); }
.sr-only { position:absolute; width:1px; height:1px; padding:0; margin:-1px; overflow:hidden; clip:rect(0 0 0 0); white-space:nowrap; border:0; }
kbd { font:var(--fw-bold) var(--fs-xs)/1 var(--font-body); padding:.2em .45em; border:1px solid currentColor; border-radius:var(--r-sm); opacity:.85; }
@media (forced-colors: active) { .card[aria-checked="true"] { outline:3px solid Highlight; } svg { fill:none; stroke:CanvasText; } }
```

**Icons.** Use inline SVG from Lucide (ISC license), 1.25em, stroke 2, `currentColor`, and always `aria-hidden="true"` next to visible text.

| Concept | Lucide icon |
|---|---|
| HP | `heart` |
| Stamina | `zap` |
| Lead | `move-horizontal` |
| Catches | `ghost` |
| Eggs | `egg` |
| Time | `timer` |
| Weather | `moon-star` / `waves` / `cloud-fog` |
| Warning | `triangle-alert` |
| Verified / Unverified | `shield-check` / `shield-alert` |
| Connection | `wifi` / `wifi-off` |
| Mute | `volume-2` / `volume-x` |
| Fullscreen | `maximize` |

No emoji anywhere in the UI.

---

## 3. Layouts at 1366×768

**Sightline zone.** On every in-race screen, the 3D camera must frame the boat and Hyde inside the sightline zone:
- x 32–68% (437–929px)
- y 18–80% (138–614px)

No opaque HUD may enter this zone. The only exceptions are transient toasts, the egg card and the leg result card, which appear while the race is paused or settled.

### Splash
```
+------------------------------------------------------------------------------+
| STATION A                                       [LIVE] [mute][fullscreen]   | 56
|                                                                              |
|  ESCAPE FROM                         (Fraunces 850, fs-3xl, left-aligned)    |
|  RAVEN ISLAND                                                                |
|  The Hyde's Regatta                  (Fraunces 300 italic, fs-xl)            |
|                                                         3D: boat idling in    |
|  1  Pick a captain and a ghost Pokemon                  fog (right ~45%)      |
|  2  Each leg: Safe or Shortcut, then push                                     |
|  3  Grab eggs, stay ahead of Hyde                                             |
|                                                                              |
|  [  Start   (Enter)  ]   lg primary                                           |
|  Most egg points in the least time wins. About 4 minutes.                    |
+------------------------------------------------------------------------------+
```
- Left column max width is 40rem, over `.scrim-left`.
- The step numbers are Fraunces 850 at fs-xl in lantern; step text is fs-lg.

### Nickname (step 1 of 4)
The left column has, in order:
1. A "STEP 1 OF 4" caps label.
2. The title "What should the board call you?" (fs-xl, display).
3. An input 35rem wide and 64px tall, with fs-xl text and a counter at the right ("7/15").
4. The hint "3–15 letters, numbers or spaces" (sm, text-2).
5. The error line (danger, with an icon).
6. A button row: [Back] ghost and [Continue (Enter)] primary.

### Captain select (step 2 of 4): 4×3 grid
```
+------------------------------------------------------------------------------+
| STEP 2 OF 4  Choose your captain                 [LIVE][mute][fs]       h 72 |
| Arrows to browse - Enter to continue                                         |
+-------------------+-------------------+-------------------+------------------+
| (W) Wednesday     | (E) Enid          | (B) Bianca        | (X) Xavier       |  3 rows
|     Dark Vision   |     High Energy   |     Siren Navig.  |     Painted Decoy|  x 160
| Heavy Fog: Hyde catch risk -15 pts    | ...               |                  |  gap 12
+-------------------+-------------------+-------------------+------------------+
| ... 2 more rows ...                                                          |
+------------------------------------------------------------------------------+
| [Back]        Selected: Wednesday - Dark Vision          [Continue (Enter)]  | h 72
+------------------------------------------------------------------------------+
```
- Height budget: 24 + 72 + 16 + (3×160 + 2×12) + 16 + 72 + 24 = **728 ≤ 768**.
- Each card is about 305×160.
- Uses `.scrim-full`.

### Pokémon select (step 3 of 4): 6×3 grid
- Same frame as Captain select, with 6 columns of about 198×164.
- The header shows a captain chip: "Captain: Wednesday · Dark Vision".
- Height budget: 24 + 72 + 16 + (3×164 + 24) + 16 + 72 + 24 = **740**.

### Confirm (step 4 of 4)
```
| Ready to sail, Mia?                                        (fs-3xl)          |
| [ Captain card, large 420x200 ]  +  [ Pokemon card, large 420x200 ]          |
| 3 legs - 2nd Hyde catch or 0 HP ends your run - Score = egg pts x 100 - secs |
| [LIVE] Your score goes on the big board   |or|  [LOCAL DEMO] Not ranked live |
| [Change crew]                                   [Start the regatta (Enter)]  |
```
All content is left-aligned.

### Decision HUD (per leg)
```
+------------------------------------------------------------------------------+
|LEG 1/3      |[fog] Heavy |HP      |STAMINA       |LEAD    |CATCHES|EGGS |RACE TIME |[LIVE][m][f]| h 72
|Misty Shallows| Fog       |100/100 |[####..] 6    |100 m   | 0/2   |0 pts|0.00 s    |            |
+-----------------+----------------------------------------+-------------------+
| SAFE        [S] |                                        | WEDNESDAY'S       |
| Base   48.00 s  |                                        | STRATEGIC ADVICE  |
| Weather +4.00 s |                                        | Shortcut - Push 2 |
| Crash   None    |         3D VIEW (sightline zone)       |  [Use advice (A)] |
| Hyde    None    |           boat  ...  Hyde              | Race-ending risk  |
| Lead    +10 m   |                                        | 18%  [===|--] 25% |
| Eggs Common 70% |                                        | - reason 1        |
+-----------------+                                        | - reason 2        |
| SHORTCUT [H] ADVISED                                     | - reason 3        |
| Base   35.00 s  |                                        +-------------------+
| Weather +7.00 s |                                        | RAVEN VISION      |
| Crash   20%     |                                        | 41.20 s  | 22%    |
| Hyde    30%     |                                        | leg time | catch  |
| Lead    -25 m   |                                        | Trained on        |
| Eggs Rare 60%.. |                                        | simulated data    |
+-----------------+----------------------------------------+-------------------+
| PUSH  [1  -5%  1 stamina] [2  -12%  2 stamina] [3 -20% 3 stamina +10 m]  [ SET SAIL (Enter) ] | h 128
|       reason under a disabled option                             "Choose a route first"       |
+------------------------------------------------------------------------------+
```
**Geometry:**
- Left column is 26.25rem (420px) at x 24–444.
- Right column is 23.75rem (380px) at x 962–1342.
- Middle band: y 112–616, which is 504px tall.

**Left column (504px):** the two route cards are 244px each with a 16px gap.

**Right column (504px):**

| Block | Height |
|---|---|
| Advice panel | about 300px |
| Gap | 16px |
| Raven Vision | about 168px |

**Top bar:**
- A single row.
- If it overflows, the weather chip drops its word and keeps the icon plus a short name ("Fog").
- Stats never wrap.

**Bottom bar:**
- Push buttons are 200×80 each.
- A 24px reason row sits under them.
- Set Sail is 260×80 at the right. That is the standard, conventional position for the final CTA.

### Egg reveal (overlay after Set sail)
- A centered `.panel`, 34rem wide, over `--c-scrim`. The race is paused, so the center may be used.

Content, top to bottom:
1. Tier label (caps), e.g. "RARE EGG".
2. Egg SVG, 160px.
3. "+3 pts" (fs-2xl).
4. Trade-off list.
5. Wednesday's egg advice line.
6. Button row: [Collect (C)] [Skip (K)].

### Cinematic
- Top-left pill, 48px tall: "LEG 1 · Misty Shallows · HP 90 · Lead 75 m".
- Bottom-left event caption: max 4 words, fs-xl display, for example "CRASH: −10 HP". It appears in sync with the event and stays 1.5 s.
- Bottom-right [Skip animation (Space)] appears after 2 s, fading in over `--dur-2`.
- Nothing else is shown.

### Leg result
```
+---------------------------------------------------------------------- 65rem -+
| LEG 1 COMPLETE - Misty Shallows                               [Survived]    |
+-------------------------------+---------------------------------------------+
| WHAT HAPPENED (24rem)         | TIME BREAKDOWN (waterfall, 36rem)           |
| [fog] Fog rolled in: +7.00 s  | Base             ############  48.00 s     |
| [boat] Shortcut, push 2       | Speed savings 12%       ###  -5.76 s       |
| [egg] Rare egg banked: +3 pts | Weather                  ##  +7.00 s       |
| [ghost] Hyde roll 30%: escaped| Egg pickup               #   +5.00 s       |
|                               | Leg time         ############# 54.24 s     |
+-------------------------------+---------------------------------------------+
| HP 100 > 100 | Lead 100 > 75 m | Stamina 6 > 4 | Eggs 0 > 3 pts | Race 54.24 s |
|                                                           [Next leg (Enter)] |
+------------------------------------------------------------------------------+
```

### Victory and Defeat
```
| LEFT 38rem                                | RIGHT 40rem: YOUR RACE              |
| YOU ESCAPED RAVEN ISLAND (fs-3xl)         | Leg | Route | Push | Wx | Time | Lead |
| FINAL SCORE (caps)                        | 1   | Short | 2    | Fog| 54.24| 75 m |
| 1,057.70        (fs-hero, lantern)        | ... 3 rows, events as small badges  |
| 12 pts x 100 - 142.30 s                   | Advice followed: 2 of 3 legs        |
| Rank #4 of 37 today   [VERIFIED]          | Raven Vision: 138.20 s predicted,   |
|                                           |   142.30 s actual                   |
| [Next visitor (Enter)]                    | Seed: 9f3a... (mono, xs, muted)     |
```
**Defeat** uses the same grid, with these differences:
- Title: "CAUGHT BY HYDE" or "YOUR BOAT IS WRECKED", in fs-3xl, colored text.
- Reason line: "Leg 3 · second Hyde catch".
- In place of the score: "Unranked: runs that don't finish score 0 and stay off the board."
- A "What happened" list of 3 lines.
- The same analytics column.
- The danger color appears only in the title icon and reason line. No red flood.

### Laptop 1 Dashboard
```
+------------------------------------------------------------------------------+
| RAVEN ISLAND REGATTA - LIVE BOARD   [LIVE][VERIFIED]  [wifi Connected] 20:41  [Operator] | 64
+---------------------------------------------- 60% -+--------------- 40% ------+
| LEADERBOARD                                        | STATION A   [Racing]     |
| #   Name        Crew               Eggs  Time   Score | Mia (fs-xl)            |
| 1   Raven       Wednesday+Gengar   14  128.40 1,271.60| Enid + Froslass         |
| ... top 8 rows x 44px                              | Leg 2 of 3 [##-] HP 65 Lead 40 m |
|                                                    | STATION B   [Idle]       |
|                                                    | Waiting for next visitor |
+---------------------------+------------------------+--------------------------+
| RECENT FINISHES (4)       | OUT OF THE RACE (4)    | TODAY                    |
| Mia  1,057.70  2 min ago  | Leo - caught twice, L3 | 37 runs - 29 done - 8 out|
|                           |                        | Avg score 812.40         |
|                           |                        | Route mix [Safe 58|Shortcut 42] |
+------------------------------------------------------------------------------+
```
- Height budget: 24 + 64 + 16 + 420 + 16 + 180 + 24 = **744**.
- **Operator:**
  - Clicking [Operator] (ghost, small, top-right corner, away from public content) opens the PIN modal.
  - After login, a 26rem drawer slides over the Stations column. It contains:
    - Reset Station A
    - Reset Station B
    - Clear demo leaderboard (LOCAL DEMO only)
    - Accessibility toggles (reduced motion, high contrast) for each station
    - Sign out
  - Operator mode auto-signs out after 5 min idle.

---

## 4. Components

### Button
| Size | Height | Padding | Font |
|---|---|---|---|
| sm | 44px | 0 16px | fs-sm 600 |
| md | 52px | 0 24px | fs-md 600, min-width 10rem |
| lg | 64–80px | 0 32px | fs-lg 700 |

**Variants:**

| Variant | Fill and border | Text | Hover |
|---|---|---|---|
| primary | lantern fill | ink | `--glow-lantern` |
| secondary | transparent, 2px `--c-accent` border | accent-text | – |
| ghost | none | text-2 | underline |
| danger | danger fill | ink | – |

**States:**
- Hover: `translateY(-1px)` over `--dur-1`.
- Active: `scale(.98)`.
- Focus: `--focus-ring`.
- Busy: `aria-busy="true"` and the label changes to a verb ("Raising sails…"). No spinner-only state.

**Disabled with reason.** Use `aria-disabled="true"`, not the `disabled` attribute, so the button stays focusable and its reason is announced.
- Fill is `--c-surface-2` with a 45° hatch. The label is in text-muted.
- A visible reason line sits below it: icon plus text-2 at fs-sm, linked with `aria-describedby`.
- Clicking or pressing it does nothing to the game state. The reason line pulses its outline once and the reason is announced politely.
- Reasons are always visible. Never put a reason only in a tooltip.

**Hotkey hint.** A `<kbd>` chip sits at the right end of the label.

```css
.btn{display:inline-flex;align-items:center;gap:var(--sp-3);height:52px;padding:0 var(--sp-5);border-radius:var(--r-md);
  font:var(--fw-semi) var(--fs-md)/1 var(--font-body);border:2px solid transparent;cursor:pointer;
  transition:transform var(--dur-1) var(--ease-out),box-shadow var(--dur-1) var(--ease-out),background-color var(--dur-1);}
.btn--primary{background:var(--c-lantern);color:var(--c-ink);}
.btn--primary:hover{box-shadow:var(--glow-lantern);transform:translateY(-1px);}
.btn--secondary{background:transparent;border-color:var(--c-accent);color:var(--c-accent-text);}
.btn--ghost{background:transparent;color:var(--c-text-2);} .btn--ghost:hover{text-decoration:underline;}
.btn--danger{background:var(--c-danger);color:var(--c-ink);}
.btn--lg{height:64px;padding:0 var(--sp-6);font-size:var(--fs-lg);font-weight:var(--fw-bold);}
.btn:active{transform:scale(.98);}
.btn:focus-visible{box-shadow:var(--focus-ring);}
.btn[aria-disabled="true"]{background:repeating-linear-gradient(45deg,var(--c-surface-2) 0 8px,var(--c-surface-1) 8px 16px);
  color:var(--c-text-muted);border-color:var(--c-border);cursor:not-allowed;box-shadow:none;transform:none;}
.reason{display:flex;gap:var(--sp-2);font-size:var(--fs-sm);color:var(--c-text-2);margin-top:var(--sp-2);}
```

### SelectCard (captain or Pokémon)
**Semantics.** The grid is `role="radiogroup"` with `aria-labelledby` pointing at the screen title. Each card is `role="radio"` with `aria-checked`, a roving `tabindex`, and `aria-describedby` pointing at its ability text.

**Captain card anatomy:**
1. Row 1: a 48px crest and a name stack.
   - The crest is a circle with three palette bands and the initial in Fraunces 850.
   - The stack is the name (fs-lg 700) and the ability name (fs-sm 600, accent-text).
2. Row 2: the short line, full width, fs-sm, text-2.

**Pokémon card anatomy:**
1. A 6px top stripe in a gradient of the two palette colors.
2. Name, fs-md 700, wrapping to at most 2 lines with `text-wrap: balance`.
3. Trait name, fs-sm 600, accent-text.
4. Short line, fs-sm, text-2.

**No truncation and no line-clamp.** Check against the longest strings:
- "Galarian Corsola"
- "All routes +10%; push 3 = 30% for 4 stamina"
- "First crash: no HP or time loss (gap loss stays)"

**States:**
- Default: surface-1 fill, 1px border.
- Hover: surface-2.
- Focus: ring.
- **Selected:** 3px `--c-accent` border, `--c-accent-soft` fill, and a top-right badge (check icon plus "Selected", xs).
- Selected and focused: both the border and the ring.

### StatMeter (top bar and station cards)
Each meter is a caps label over the value at fs-lg (fs-2xl on the dashboard), plus an icon. Every state has a word.

**HP:**
- 4px bar under the value, plus "72/100".
- Above 50: success.
- 26–50: warning, with "Low".
- 25 or less: danger, with "Critical".

**Stamina:**
- One pip per point; Enid has 7.
- Filled pips are available stamina.
- Pips reserved for remaining legs are **hatched**, and the meter reads "keep 2" in xs.
- While a push option is selected or hovered, the pips it will spend get a lantern outline. This makes the legality rule visible.

**Lead:**
- Value such as "72 m".
- A 64px mini-track with a boat dot and a Hyde dot.
- 70 m or more: "Safe".
- 40–69 m: "Closing" (warning).
- Under 40 m: "Danger" (danger). These bands match the gap-risk brackets.

**Catches:**
- Two ghost slots plus "0/2".
- At 1/2, the slot fills with danger and the label reads "Next catch ends the race".

**Eggs:** "4 pts banked".

**Race time:** "83.45 s".

**Live updates.** When a value changes, flash its background for 600 ms with `--c-lantern-soft`. Show a static frame under reduced motion.

### Badge
- 28px pill, icon plus caps text at fs-xs 700.

| Badge | Style | Text |
|---|---|---|
| LIVE | success outline, filled dot | "LIVE" |
| LOCAL DEMO | lantern fill, ink | "LOCAL DEMO" |
| VERIFIED | success, `shield-check` | "VERIFIED" |
| UNVERIFIED | dashed muted border, `shield-alert` | "UNVERIFIED" |
| Connected | `wifi`, success | "Connected" |
| Reconnecting | `wifi`, warning, dot pulse (static when reduced) | "Reconnecting" |
| Offline | `wifi-off`, danger | "Offline" |

Each badge's text differs, so the state never depends on color alone.

### RouteCard
- `role="radio"` in the "Route" radiogroup.
- Header: route name at fs-xl in Fraunces 700, the `<kbd>` S or H, and an "ADVISED" ribbon (accent fill, ink, xs caps) when it matches the advice.
- Body is a `<dl>` of six rows. Labels are fs-sm muted; values are fs-md, right-aligned, tabular.

| Row | Content |
|---|---|
| Base | base time |
| Weather | delay after abilities, with a note, e.g. "0.00 s (Jellicent)" |
| Crash | percentage, or "None" |
| Hyde catch | chance for this leg assuming no crash, computed for the currently selected push; Safe shows "None" unless the lead would reach 0 m |
| Lead | signed net change, breakdown in the description |
| Eggs | odds for that route and leg, e.g. "Rare 60% · Common 30% · None 10%" |

- For **Eugene**, the Eggs row shows the actual tier as an egg chip, e.g. "Rare egg (3 pts)".
- Risk values at or above 30% get a warning icon. Danger color is used only for lead below 40.
- Selected state is the same as SelectCard.

### PushButton
- `role="radio"` in the "Push" radiogroup.
- Content:
  1. "PUSH 2", fs-lg 700.
  2. "−12% time", fs-md.
  3. "Costs 2 stamina", fs-sm.
  4. An extra line for level 3: "+10 m lead".
  5. The `<kbd>` hotkey.
  6. An ADVISED corner tag when it matches the advice.
- The discount shown must be the effective one: Yoko 24%, Dragapult 30% for 4 stamina, Corsola on leg 2 shows 12% for push 1.
- **Illegal option:** the hatched disabled style, with `disabledReason` shown verbatim under the group.
- Push 1 is preselected at leg start.

### AdvicePanel
- Header: `ghost` icon and "WEDNESDAY'S STRATEGIC ADVICE" (caps, accent-text).
- Recommendation: "Shortcut · Push 2" at fs-xl display, with a [Use advice (A)] secondary sm button on the right. The button only selects the advised route and push; it never sails.
- Risk row:
  - "Race-ending risk" label.
  - The value, e.g. "18%", at fs-lg.
  - A 120px bar with a tick at the cap ("limit 25%").
  - Value and bar are accent-text when within the cap, and warning with an icon when over it.
- Reasons: at most 3 bullets, fs-sm, each 12 words or fewer.
- Warning: when `constraintMet === false` or `warning` is set, show an amber-bordered box with an icon.
- Footer (xs, muted): "Monte Carlo · 512 races per option".
- **Loading** (at most 1.5 s):
  - Text: "Wednesday is thinking… simulating 512 races per option".
  - Three paragraph-shaped skeleton bars with a shimmer, static under reduced motion.
- **Error:** "Advice unavailable. You can still race." The panel never blocks play.

### Raven Vision
- Updates whenever route or push changes.
- Two big numbers at fs-2xl lantern: "41.20 s" (predicted leg time) and "22%" (catch chance).
- Footnote, fs-xs, muted, always visible: "Machine-learning estimate, trained on simulated data, not a promise."
- **Loading:** "Raven is looking ahead…".

### EggReveal
**Egg SVG, which encodes tier by shape as well as color:**

| Tier | Shape |
|---|---|
| Common | plain ivory egg |
| Rare | cyan egg with 1 star mark |
| Legendary | gold egg with 3 star marks and `--glow-legendary` |
| None | dashed empty nest outline in muted |

**Reveal animation:** scale from .85 to 1 with opacity 0 to 1 over `--dur-reveal`, plus one shimmer pass for legendary. Under reduced motion it appears instantly.

**Trade-off list** (icon plus text):
- "+5.00 s to collect".
- Only when the route is Shortcut: "25% chance to drop it if you crash".
- "Hyde catch: lose half your unbanked eggs".
  - With Dhelmise, or Aegislash before its first catch: "Protected by Dhelmise".
  - With Sableye on rare or legendary: "+1 pt from Sableye" and the points shown include the bonus.
- Advice line: "Wednesday: Collect. 3 pts outweigh 5 s."

**No egg:**
- [Collect egg (C)] uses `aria-disabled`, with the reason "No egg on this route, nothing to collect."
- The skip button becomes primary, labelled "Continue without egg (K)".

### Waterfall chart
Use a horizontal waterfall, because labels stay readable. Each row has:
- A label column, 10rem.
- The bar area.
- A value column, 7rem, right-aligned, tabular.

**Bars:**

| Row | Bar |
|---|---|
| Base | text-2 fill, from 0 |
| Savings | accent hatch, from the running end back down |
| Weather | wx color |
| Crash / Hyde | danger |
| Egg | egg-common |
| 10 s minimum | muted |
| Total | lantern solid, from 0 |

- A 1px dashed connector joins each row's end to the next row's start.
- The scale maximum is the largest running value.
- Zero rows are hidden from the chart. The table lists them as "0.00 s".

**Accessibility:** the chart is an `<svg role="img" aria-labelledby="wf-title wf-desc">`, followed by an `.sr-only` `<table>` with caption, columns Step / Change / Running total, and every row. The description reads: "Base 48.00 seconds, minus 5.76 for speed, plus 7.00 fog, plus 5.00 egg, equals 54.24 seconds."

**Exact-sum guard (required):**
```ts
import type { TimeBreakdown } from '../game/types';
export type WfStep = { key: string; label: string; deltaCs: number; startCs: number; endCs: number; kind: 'base'|'minus'|'plus'|'total' };
export function waterfallSteps(t: TimeBreakdown): WfStep[] {
  const raw = [
    { key: 'base',    label: 'Base time',                         deltaCs: t.baseCs,           kind: 'base'  as const },
    { key: 'savings', label: `Speed savings ${t.discountPct}%`,   deltaCs: -t.speedSavingsCs,  kind: 'minus' as const },
    { key: 'weather', label: 'Weather',                           deltaCs: t.weatherDelayCs,   kind: 'plus'  as const },
    { key: 'crash',   label: 'Crash',                             deltaCs: t.crashDelayCs,     kind: 'plus'  as const },
    { key: 'egg',     label: 'Egg pickup',                        deltaCs: t.eggDelayCs,       kind: 'plus'  as const },
    { key: 'hyde',    label: 'Hyde catch',                        deltaCs: t.hydeDelayCs,      kind: 'plus'  as const },
    { key: 'floor',   label: '10 s minimum',                      deltaCs: t.floorAdjustmentCs,kind: 'plus'  as const },
  ];
  let run = 0; const out: WfStep[] = [];
  for (const s of raw) { const startCs = run; run += s.deltaCs; if (s.kind === 'base' || s.deltaCs !== 0) out.push({ ...s, startCs, endCs: run }); }
  if (run !== t.totalCs) throw new Error(`Waterfall mismatch: ${run} != ${t.totalCs}`); // integer Cs: must be exact
  out.push({ key: 'total', label: 'Leg time', deltaCs: t.totalCs, startCs: 0, endCs: t.totalCs, kind: 'total' });
  return out;
}
```
Add the discount sources under the savings label as xs muted text, e.g. "Push 2 12% · Gomez 10%".

### LeaderboardRow (dashboard)
**Grid columns:**

| Column | Width |
|---|---|
| Rank | 4rem |
| Name | 1fr |
| Crew | 1.3fr |
| Eggs | 5rem |
| Time | 7rem |
| Score | 8rem |
| Badge | 8rem |

**Row content:**
- Row height is 44px.
- Rank is Fraunces 850, fs-xl. Rank 1 is lantern with "1st" in xs below it; ranks 2 and 3 are text.
- Name is fs-lg 600. Crew is fs-sm text-2.
- Score is fs-lg 700, lantern, tabular.

**New entry:**
- "NEW" lantern badge.
- `--c-lantern-soft` background fading out over 6 s.
- Under reduced motion: only the badge, for 60 s.

**Unverified entry:** an UNVERIFIED badge on the row.

**Zebra striping:** none. Use 1px `--c-border` separators.

### StationCard
- Header: "STATION A" (caps) and a phase badge: Idle, Choosing route, Egg decision, Racing, Finished, Out of race, or Signal lost.
- Nickname at fs-xl.
- Crew: "Enid + Froslass".
- Leg progress: 3 labelled segments, "Leg 2 of 3".
- Compact HP and Lead StatMeters.
- Footer (xs, muted): "Updated 3 s ago".
- **Stale for more than 15 s:** card at 60% opacity with a "Signal lost" badge.
- **Idle:** "Waiting for next visitor" in italic display text.

### Modal and Confirm
- `role="dialog"`, `aria-modal="true"`, `aria-labelledby`, `aria-describedby`.
- 35rem panel over a scrim, with a focus trap. Focus returns to the trigger on close.
- **Initial focus:** the **Cancel** button for destructive actions; otherwise the primary button.
- Esc cancels, which requires the keyboard lock described at the top.
- **Labels are verbs.** For example:
  - "Reset Station A" next to "Keep playing".
  - Never "OK".
- **Clear leaderboard** requires typing `RESET`. The danger button stays `aria-disabled` until the typed text matches.

### Toast
- **Position:**
  - In the HUD: bottom-center, max 30rem wide, 16px above the bottom bar, at most one visible.
  - Elsewhere: bottom-left, at most two visible.
- Each toast has an icon and one line of 10 words or fewer.

| Kind | Role | Dismissal |
|---|---|---|
| info, success | `role="status"` | auto-dismiss after 5 s |
| warning, error | `role="alert"` | persistent, with an action ("Retry") and a close button |

- **Slow server:** if a request is pending for more than 3 s, show "Still reaching the server…".

---

## 5. Keyboard and screen reader

**Global keys:**

| Key | Action |
|---|---|
| Tab / Shift+Tab | move focus |
| Enter / Space | activate the focused control |
| M | mute |
| F | toggle fullscreen |

**When hotkeys are ignored:**
- Focus is in an input.
- A modal is open (only Tab and Esc work).
- Ctrl, Alt or Meta is held.
- `event.repeat` is set.

Match keys with `event.key.toLowerCase()`.

**Hotkey hints.** Show every hotkey as a `<kbd>` on its control.

**Debounce.** Ignore Enter and Space for 500 ms after any screen mounts. **On Victory and Defeat, "Next visitor" ignores activation for 2 s**, so a visitor mashing keys cannot wipe their own result.

**On every screen change**, move focus to the screen's `<h1 tabindex="-1">`. The exception is when an initial-focus control is listed below.

| Screen | Tab order (DOM = reading order) | Keys |
|---|---|---|
| Splash | Start (initial) → Mute → Fullscreen | Enter = Start |
| Nickname | Input (initial) → Continue → Back | Enter in input = submit; validation runs live and on submit |
| Captain / Pokémon | Grid (one tab stop) → Continue → Back | Arrows: Left/Right ±1, Up/Down ±columns (no wrap). Home/End = row start/end, Ctrl+Home/End = first/last. Selection follows focus (radio pattern). Space = select, **Enter = continue** when a card is selected. Double-click = select and continue. |
| Confirm | Start the regatta (initial) → Change crew | Enter |
| Decision HUD | Route group → Use advice → Push group → Set sail → utilities | S = Safe, H = Shortcut, 1/2/3 = push, A = use advice, Enter = Set sail (only when focus is not on another button). Arrows work inside each group. Disabled push radios stay focusable and announce their reason. |
| Egg reveal | Collect (initial if a real egg, else Continue) → Skip | C = collect, K = skip, Enter = focused |
| Cinematic | Skip animation (after 2 s) | Space / Enter = skip after 2 s. Do not steal focus when the button appears. |
| Leg result | Next leg (initial) | Enter |
| Victory / Defeat | h1 (initial) → Next visitor | Enter on the button after 2 s |
| Dashboard | Operator → (drawer) controls | Esc closes the drawer or modal |

**Grid navigation sketch:**
```ts
function onGridKey(e: KeyboardEvent, i: number, n: number, cols: number, select: (j: number) => void, cont: () => void) {
  const map: Record<string, number> = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: cols, ArrowUp: -cols };
  let j = i;
  if (e.key in map) j = i + map[e.key];
  else if (e.key === 'Home') j = e.ctrlKey ? 0 : i - (i % cols);
  else if (e.key === 'End') j = e.ctrlKey ? n - 1 : Math.min(n - 1, i - (i % cols) + cols - 1);
  else if (e.key === ' ') { select(i); e.preventDefault(); return; }
  else if (e.key === 'Enter') { select(i); cont(); e.preventDefault(); return; }
  else return;
  e.preventDefault();
  if (j >= 0 && j < n) select(j); // moves roving tabindex + focus + aria-checked
}
```

**Live regions** live in the app shell, so they persist across screens:
```html
<div id="sr-polite" class="sr-only" aria-live="polite" aria-atomic="true"></div>
<div id="sr-alert"  class="sr-only" role="alert" aria-atomic="true"></div>
```

**Announcement templates.** Write units out in full ("seconds", "metres", "percent"). Debounce selection announcements by 400 ms.

| Moment | Region | Template |
|---|---|---|
| Screen change | polite | "Step 2 of 4. Choose your captain." |
| HUD selection | polite | "Shortcut, push 2. Predicted leg time 41.20 seconds. Catch chance 22 percent." |
| Advice ready | polite | "Wednesday advises Shortcut, push 2. Race-ending risk 18 percent." |
| Egg reveal | polite | "Rare egg, 3 points. Collecting adds 5 seconds." |
| Crash / Hyde catch / DNF | **alert** | "Crash. Minus 10 HP." / "Hyde caught you. Catch 1 of 2." / "Race over: second Hyde catch." |
| Leg result | polite | "Leg 1 complete. Leg time 54.24 seconds. HP 100. Lead 75 metres. Banked 3 egg points. Race time 54.24 seconds." |
| Finish | polite | "Race complete. Score 1,057.70. Rank 4 of 37." |

The animated score count-up is `aria-hidden`. A static `.sr-only` final value sits beside it.

---

## 6. Arcade readability and microcopy

**Sizes at 1366, read from 1–2 m:**

| Text | Minimum |
|---|---|
| Body | 19px |
| Decision labels and stat values | 24px |
| Key numbers | 32–44px |
| Titles | 68px |
| Final score | 96px |
| Metadata only | 15px |

Nothing smaller than 15px.

**Layout and copy rules:**
- **One primary (lantern) action per screen**, always in the same place: the bottom-right of the content area, or the end of the left column on left-column screens.
- **Words:** headlines 8 words or fewer. Reasons, story lines and toasts 12 words or fewer. At most 3 reasons. Line length 60 characters or fewer. No HUD text block longer than 2 lines.
- **Lead with the consequence or number:** "+7.00 s fog delay", not "A fog delay of 7 seconds was added."
- Use second person, present tense and sentence case. Use caps only for xs labels, with letter-spacing .08em.
- **Never rely on color alone.** Every risk or state is an icon, a word and a color. No information appears only on hover.

**Number formats.** Use NBSP before units, U+2212 for minus, and tabular numerals.

| Value | Format | Example |
|---|---|---|
| Time | 2 dp + " s" | `45.60 s`, deltas `+5.00 s` / `−9.60 s` |
| Distance | integer + " m" | `72 m`, `−25 m` |
| Probability | integer % | `18%`; `<1%` when 0 < p < 0.005; `0%` only when p = 0 |
| Discount | integer % | `−12% time` |
| Egg points | integer | `1 pt`, `3 pts` |
| Score | 2 dp, thousands separator | `1,057.70`, `−42.30` |
| Rank | | `#4 of 37 today` |

```ts
import { formatSeconds } from '../game';
const NB = ' ', MINUS = '−';
export const fmtS = (cs: number) => (cs < 0 ? MINUS : '') + formatSeconds(Math.abs(cs)) + NB + 's';
export const fmtDS = (cs: number) => (cs < 0 ? MINUS : '+') + formatSeconds(Math.abs(cs)) + NB + 's';
export const fmtM = (m: number) => (m < 0 ? MINUS : '') + Math.abs(m) + NB + 'm';
export const fmtDM = (m: number) => (m < 0 ? MINUS : '+') + Math.abs(m) + NB + 'm';
export const fmtPct = (p: number) => (p <= 0 ? '0%' : p < 0.005 ? '<1%' : Math.round(p * 100) + '%');
export const fmtPts = (n: number) => `${n}${NB}${n === 1 ? 'pt' : 'pts'}`;
export const fmtScore = (n: number) => (n < 0 ? MINUS : '') +
  Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
```

**Glossary.** Use one term per concept everywhere.

| Term | Meaning |
|---|---|
| **Lead on Hyde** | Never "gap" in visitor copy; "Hyde gap" is OK only as an internal label. |
| **HP** | |
| **Stamina** | |
| **Push 1/2/3** | |
| **Safe / Shortcut** | |
| **Egg points (pts)** | |
| **Banked** | |
| **Race time** | |
| **Hyde catch** | |
| **Race-ending risk** | The advisor's pDnf. Never "risk" alone next to a per-leg chance. |
| **Out of the race** | The visitor-facing word for DNF. Use "Unranked" for the board. |

**Copy issues in `constants.ts` for the content owner.** These strings are the single source of truth, so the orchestrator should log them in DECISIONS:
1. Wednesday says "risk −15 pts" and Dusknoir "−10 pts". Here "pts" collides with egg points.
   - Suggested Wednesday: "Heavy Fog: cancels fog's extra Hyde risk". This is true, because fog adds +15 and her ability subtracts 15.
   - Suggested Dusknoir: "Heavy Fog: Hyde catch chance 10% lower".
2. Xavier says "gap loss stays". Suggested: "lead loss stays".
3. Trevenant and Decidueye say "pursuit distance". Suggested: "lead".

**Microcopy examples:**

| Where | Text |
|---|---|
| Set Sail, no route | "Choose a route first" |
| Push illegal | the `disabledReason` verbatim, e.g. "Needs 3 stamina but must keep 1 for each of the 2 remaining legs" |
| Nickname too short | "At least 3 characters" |
| Cinematic captions | "CRASH: −10 HP" · "FOG: +7.00 s" · "HYDE CLOSES IN" · "ESCAPED" · "CAUGHT: 1 of 2" |
| Rowan | "Rowan's Telekinetic Push stopped the crash" |
| DNF, second catch | "Hyde caught you twice. The regatta ends here." |
| DNF, HP | "Your boat ran out of HP." |
| Demo | "LOCAL DEMO: scores aren't verified or ranked live" |

---

## 7. Review checklist (implementation audit)

**Layout and fit**
- [ ] No scrollbars on any screen at 1280×720, 1366×768, 1536×864 or 1920×1080 at 100% zoom. `body{overflow:hidden}` hides no content.
- [ ] Captain grid is 4×3 and Pokémon grid is 6×3. The longest strings wrap fully with no ellipsis or clamp.
- [ ] HUD panels stay outside the sightline zone (x 32–68%, y 18–80%). The camera frames the boat and Hyde inside it.
- [ ] Key content is left-aligned (titles, steps, story lines). Only the egg card and result card are centered.
- [ ] The splash shows the fullscreen prompt when not fullscreen. Keyboard lock is active, or the app runs in kiosk mode.

**Tokens and visuals**
- [ ] All colors, sizes, durations and radii come from tokens, with no stray hex values.
- [ ] Fraunces is self-hosted from `/fonts`, with no CDN requests (check DevTools Network). Palatino Linotype fallback renders acceptably.
- [ ] `--c-accent` is never used for text below 24px, and never as text on surface-2 or the HUD. Text on accent fills is ink.
- [ ] HUD background alpha is at least .86 and no `backdrop-filter` is used.
- [ ] Egg tiers and weather are distinguishable in grayscale, by shape, icon and label.

**Components**
- [ ] Disabled controls use `aria-disabled`, stay focusable, and show a visible reason linked by `aria-describedby`.
- [ ] Collect is disabled on No Egg, with the explanation, and Continue becomes primary.
- [ ] Eugene sees both routes' egg tiers on the route cards before choosing. Other characters see odds only.
- [ ] Push buttons show effective discount and cost (Yoko 24%, Dragapult 30% for 4 stamina, Corsola leg 2 at 12%). Illegal options are hatched and show `disabledReason`.
- [ ] Stamina pips show the reserved pips (hatched) and the cost preview.
- [ ] The advice panel shows the recommendation, at most 3 reasons, race-ending risk against the 25% cap, a loading skeleton and an error fallback. "Use advice" selects but does not sail.
- [ ] Raven Vision shows "trained on simulated data" at all times.
- [ ] `waterfallSteps` throws on mismatch. The displayed rows sum exactly to the leg time. An sr-only table is present.
- [ ] "Skip animation" appears at 2 s, not before. The cinematic HUD is minimal.
- [ ] Victory shows the score formula and rank. Defeat shows the reason, "Unranked" and score 0. Both show per-leg analytics.
- [ ] Dashboard has the LIVE or LOCAL DEMO badge, the connection badge, unverified rows marked, stale stations marked "Signal lost", and operator controls only behind PIN, in a separate drawer, with confirmation (typed RESET to clear).

**Keyboard and screen reader**
- [ ] Every interactive element can be reached with Tab and shows the amber focus ring (`:focus-visible`), including inside modals.
- [ ] Arrow navigation works on the selection grids, route group and push group. Enter continues from the grids.
- [ ] Hotkeys work: S, H, 1, 2, 3, A, C, K, M, F, Space for skip. They are ignored in inputs and modals and when modifier keys are held.
- [ ] The 500 ms post-mount debounce and the 2 s Next-visitor guard work.
- [ ] Focus moves to the h1 on each screen change. Modals trap focus and restore it. Destructive confirms focus Cancel first.
- [ ] Live regions announce the templates in §5. Crash, catch and DNF use `role="alert"`. The count-up score is `aria-hidden`.
- [ ] NVDA or Narrator smoke test: complete one full race using only the keyboard and a screen reader.

**Motion and contrast modes**
- [ ] OS reduced motion and the `.reduced-motion` class both remove CSS animation, egg and score animation, camera sweeps and shake.
- [ ] `.high-contrast` produces white-on-black, 2px borders, a yellow focus ring and no glows. `forced-colors` mode keeps selection visible.
- [ ] Spot-check text pairs with a contrast tool against the §1 table (at least 4.5:1 text, at least 3:1 UI).

**Copy and numbers**
- [ ] Times are always "x.xx s", distances "N m", probabilities "N%" (never "0.18"), and points use correct pt/pts.
- [ ] Minus signs are U+2212, units use NBSP, and numerals are tabular.
- [ ] "Lead on Hyde" is used consistently. There are no emoji. Pokémon is spelled with é everywhere.
- [ ] No text block exceeds the word limits in §6, and no information is available only on hover.

---

**The single highest-impact item.** Get the Decision HUD right:
- Two radio-group route cards on the left.
- Advice on the right.
- Push and Set Sail along the bottom.
- The center left clear for the boat.
- Visible disabled reasons and stamina-reserve pips.

That is the screen where visitors make every decision. A clear HUD turns the rules from something they have to remember into something they can see on screen, which is the core of "recognition over recall" (NN Group, *10 Usability Heuristics*, #6, https://www.nngroup.com/articles/ten-usability-heuristics/).

**Other evidence used:**
- NN Group, *Horizontal Attention Leans Left*: https://www.nngroup.com/articles/horizontal-attention-leans-left/
- NN Group, *F-Shaped Pattern*: https://www.nngroup.com/articles/f-shaped-pattern-reading-web-content/
- WCAG 2.2:
  - SC 1.4.3 / 1.4.11 contrast
  - SC 2.4.7 / 2.4.11 focus
  - SC 2.3.3 motion
  - SC 4.1.3 status messages
- WAI-ARIA APG radio group and dialog patterns.