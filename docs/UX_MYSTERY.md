# UX_MYSTERY — "The Silent Evidence" UX spec

> Author: ui-ux-designer agent (read-only; saved by the orchestrator 2026-10-21, lightly condensed). Base 1rem = 16 px at
> 1366×768; the fluid root in `src/ui/styles/tokens.css` makes 1920×1080 identical in rem (×1.41). Fonts/tokens unchanged
> (Cinzel display only, Alegreya Sans UI, lantern amber = primary action + focus). Carried over from `docs/UX_V3_ACTION.md`:
> **red means only the Hyde**; impacts flash a parchment edge; danger mist rises from the bottom; every threat level
> changes word + icon + shape (greyscale-safe); HUD panels `--c-hud` α ≥ .86; steady HUD ≤ 30 words, ≤ 5 live numbers.

## Orchestrator rulings (binding)
1. **Crouch default = C** (shown everywhere). Ctrl crouches only after `navigator.keyboard.lock()` resolves in element
   fullscreen (requested from the Home "Open the case" click); otherwise Ctrl is ignored (Ctrl+W closes the tab).
2. **Pause on `pointerlockchange`** whenever lock is lost (not on Esc keydown). Resume is a click that re-requests lock;
   on rejection keep showing "Click again to resume".
3. **Evidence board pauses the sim and the clock** during play (read-only browse; Tab/Esc close it), but is **blocked
   during CHASE** ("Board locked while you're chased", 1.2 s). In accusation mode Tab is normal focus navigation inside a
   focus trap; nothing closes the board.
4. **Egg drop = hold E 0.8 s** when nothing else is interactable; a tap never drops it (game-developer implements).
5. **Arrow keys look** (← → yaw 120°/s, ↑ ↓ pitch) for keyboard-only play (frontend maps into MysteryInput).
6. Home fullscreen hint must not say "Press F" (F = power): use a button / "F11".
7. "Leave the case unsolved" maps to verdict `not_accused` (shown as "Egg Secured, Mystery Unsolved").
8. Runbook: Windows Sticky Keys shortcut OFF on both kiosk laptops (5× Shift opens a dialog).

## 1. Restored home + nickname
**MysteryHome** = `Splash.tsx` with new props `emblem?: ReactNode`, `kicker?`, `subtitle?` (+ existing steps/startLabel/
footnote). Left column over scrim, 3D scene right (island + Iago Tower at night, Thing idling on the pier).
```
| STATION A                                                     [tools] |
| (ThingSigil 96px)                                                      |
| POKÉMON DAY III · HALLOWEEN ARCADE      (caps fs-xs muted)             |
| ESCAPE FROM / RAVEN ISLAND (Cinzel fs-3xl, lantern 2nd line)           |
| The Silent Evidence  (Cinzel fs-xl text-2)                             |
| 1 Stay Silent.     Crouch with C and move slowly. Hydes hunt by sound. |
| 2 Read the Clues.  Find three pieces of evidence. Tab opens your board.|
| 3 Escape the Hyde. Carry the egg to Iago Tower, then name the culprit. |
| [ Open the case (Enter) ]  Score: egg points × 100 − your time. ~6 min |
```
The three step titles ARE the tagline verbatim (`<ol aria-label="Stay Silent. Read the Clues. Escape the Hyde.">`).
"The Hyde's Regatta" may stay as a small fs-xs legacy line. CTA click also requests fullscreen + keyboard lock.

**ThingSigil** (`src/ui/components/ThingSigil.tsx`, original SVG; sizes 24/32/64/96; `pose: 'stand'|'wave'|'point'|
'shush'|'count1'|'count2'|'count3'|'thumbsUp'|'tap'|'fist'`, `animated?`):
```html
<svg viewBox="0 0 96 96" class="thing-sigil" aria-hidden="true">
  <circle cx="48" cy="48" r="44" class="thing-sigil__ring"/>
  <rect x="36" y="14" width="24" height="12" rx="4"/>
  <path d="M40 14v12M46 14v12M52 14v12M58 14v12" class="thing-sigil__stitch"/>
  <path d="M30 32a6 6 0 0 1 6-6h24a6 6 0 0 1 6 6v12a10 10 0 0 1-10 10H40a10 10 0 0 1-10-10z"/>
  <g class="thing-sigil__fingers"><path d="M35 52l-6 24"/><path d="M43 54l-2 26"/><path d="M53 54l2 26"/><path d="M61 52l6 24"/></g>
  <path d="M66 38l12 10"/>
</svg>
```
```css
.thing-sigil { width: 6rem; height: 6rem; color: var(--c-text); fill: none; stroke: currentColor; stroke-width: 2.5; stroke-linecap: round; }
.thing-sigil__ring { stroke: var(--c-lantern); stroke-width: 1.5; opacity: .7; }
.thing-sigil__stitch { stroke-width: 1.5; opacity: .6; }
.thing-sigil--animated .thing-sigil__fingers path { animation: thing-tap 3s var(--ease-in-out) infinite; }
.thing-sigil--animated .thing-sigil__fingers path:nth-child(2) { animation-delay: 60ms; }
.thing-sigil--animated .thing-sigil__fingers path:nth-child(3) { animation-delay: 120ms; }
.thing-sigil--animated .thing-sigil__fingers path:nth-child(4) { animation-delay: 180ms; }
@keyframes thing-tap { 0%, 88%, 100% { transform: translateY(0); } 92% { transform: translateY(-2px); } }
.reduced-motion .thing-sigil__fingers path { animation: none; }
```
**Nickname** = `Nickname.tsx` with `stepLabel` "Step 1 of 3 · Name", title "What should the case file call you?",
`thingLine` "Professor Orloff is dead. His egg is gone. Sign the case file." Preload the 6 offered portraits here.

## 2. Duo draft — `DuoDraftScreen` + `DuoCardView`
Frame (1366×768, no scroll): pad 24 · header 72 ("Step 2 of 3 · Duo", H1 "Choose your duo", legend "Three duos were
drawn for you. Stats compare duos: 1 low · 3 typical · 5 high. Frames are decoration only.") · cards 3 × 426w × 576h,
gap 20 · footer 40 ("← → choose · Enter selects · 1 2 3 jump" … ThingSigil 32 "Pick the pair you like.").

Card anatomy (426 × 576; 14 px padding + 2 px frame):
| # | Block | h | Content |
|---|---|---|---|
| a | Title bar | 32 | duo name (Cinzel fs-lg 700, ≤ 22 chars) · RarityGem + "Rare" (fs-xs caps muted) |
| b | DuoArt | 120 | character portrait 120² with gothic-arch top (`border-radius: 60px 60px 8px 8px`) + Pokémon medallion 104 circle overlapping; "&" ornament; role-tint radial bg; RoleChip bottom-right |
| c | Names | 22 | "Wednesday Addams · Gengar" fs-sm 700 |
| d | DuoStatGrid | 68 | 2×3: Investigation, Stealth, Mobility │ Defense, Hyde Control, Egg Protection |
| e | AbilityBox F | 58 | cap **F** · power name · "Character power" · cooldown · LoudTag (noise ≥ .5) / text ≤ 90 |
| f | AbilityBox Q | 58 | cap **Q** · real move name · dashed badge "Game adaptation" (title = adaptationNote) · cooldown · LoudTag / text |
| g | TradeoffList | 76 | 2 × "+" (success) and 1–2 × "−" (parchment-muted, never red), ≤ 46 chars each |
| h | Select | 44 | full-width "Select duo": secondary by default, primary (lantern) on the focused/hovered card only |
Copy budgets unit-tested over all 126 pairs; Playwright asserts no card overflows at 1366×768.

**Stats:** absolute 1–5 from `duoStats()` (never normalised per offer) as five lozenge pips + digit; the best value(s)
among the three cards get a lantern ▲ ("best of the three" for SR); `role="meter"` 1–5, `aria-valuetext="4 of 5, best of
the three"`.
```css
.stat-row { display: grid; grid-template-columns: 6.1rem auto 1.4rem; align-items: center; gap: .4rem; height: 1.25rem; font-size: var(--fs-xs); }
.stat-pips { display: inline-flex; gap: 3px; }
.stat-pip { width: 10px; height: 10px; transform: rotate(45deg); border: 1.5px solid var(--c-border-strong); }
.stat-pip.is-on { background: var(--c-text-2); border-color: var(--c-text-2); }
.stat-row__best { color: var(--c-lantern); font-size: .75em; margin-left: 2px; }
```
**Role colours (icon + word always):**
```css
:root {
  --c-role-investigation: #b3a8ff; --c-role-stealth: #9cc3d0; --c-role-mobility: #6fd6a0;
  --c-role-control: #5cc0e6; --c-role-defense: #d4cbb5; --c-role-support: #e7a6d6;
  --c-frame-common: #6b6aa8; --c-frame-rare: #c9d3e6; --c-frame-epic: #8b7cf6;
}
```
Icons: investigation=search, stealth=eyeClosed, mobility=footprints, control=lasso, defense=shield, support=handHeart.
Rarity frames never use egg-tier colours. Add Lucide (ISC) icons to `Icon.tsx`: search, footprints, lasso, handHeart,
ear, hourglass, key, fileText, sprout, gauge, link, signpost, barChart, chevronUp.
```css
.duo-card { --role: var(--c-role-stealth); --frame: var(--c-frame-common);
  position: relative; display: grid; grid-template-rows: 2rem 7.5rem auto auto auto auto 1fr 2.75rem; gap: .5rem;
  padding: .875rem; border-radius: var(--r-lg); border: 2px solid var(--frame);
  background: linear-gradient(180deg, color-mix(in srgb, var(--role) 14%, var(--c-surface-1)) 0, var(--c-surface-1) 9rem);
  box-shadow: var(--shadow-1), inset 0 0 0 4px var(--c-bg), inset 0 0 0 5px color-mix(in srgb, var(--frame) 50%, transparent);
  transition: transform var(--dur-2) var(--ease-out), box-shadow var(--dur-2) var(--ease-out), opacity var(--dur-3), filter var(--dur-3); }
.duo-card[data-rarity="rare"] { border-style: double; border-width: 4px; }
.duo-card:hover, .duo-card:focus-within { transform: translateY(-6px); box-shadow: var(--shadow-2), 0 0 24px color-mix(in srgb, var(--role) 35%, transparent); }
.duo-card:focus-within { outline: 3px solid var(--c-focus); outline-offset: 4px; }
.duo-card.is-chosen { outline: 3px solid var(--c-lantern); outline-offset: 4px; transform: scale(1.03); }
.duo-draft.is-committing .duo-card:not(.is-chosen) { opacity: .45; filter: grayscale(.6); }
.reduced-motion .duo-card, .reduced-motion .duo-card:hover, .reduced-motion .duo-card:focus-within, .reduced-motion .duo-card.is-chosen { transform: none; }
```
(Epic: four corner studs via a `::before` radial-gradient overlay.)
States: rest (staggered deal-in 80 ms, none in reduced motion) · hover/focus (lift, role glow, primary button) · chosen
(lantern outline, scale 1.03, "Chosen" ribbon, others 45 % + greyscale, then DuoIntro after 600 ms) · image failed
(crest with Cinzel initial / ghost medallion). Keyboard: initial focus on H1; ← → and 1/2/3 move focus among the Select
buttons (roving tabindex); Enter/Space select; ignore Enter 600 ms after mount and `e.repeat`. Mouse: clicking the card
body only focuses; only Select commits. SR: `<article aria-labelledby>`; button name "Select {duo}: {character} and
{pokemon}, {role}". Telemetry: only offered/selected (no focus logging).

## 3. Thing intro + tutorial (≤ 25 s, skippable)
**DuoIntro** (2.5 s): both portraits 64 px + duo name + role chip; Thing (wave): "{Character} and {Pokémon}. Good.
Follow me — quietly."
**ThingCaption** (shared): bottom-centre, `bottom:1rem`, max 35rem, ≤ 2 lines; ThingSigil 32 + "THING" label + text +
optional "Why:" line.
```css
.thing-caption { position: absolute; left: 50%; bottom: 1rem; transform: translateX(-50%); max-width: 35rem;
  display: grid; grid-template-columns: 2rem 1fr; gap: .25rem .6rem; align-items: start; padding: .5rem .9rem;
  background: var(--c-hud); border: 1px solid var(--c-border); border-left: 3px solid var(--c-accent); border-radius: var(--r-md);
  font: 500 var(--fs-md)/1.3 var(--font-body); color: var(--c-text); animation: fade-in var(--dur-2) var(--ease-out); }
.thing-caption__who { grid-column: 2; font-size: var(--fs-xs); letter-spacing: var(--tracking-caps); color: var(--c-accent-text); text-transform: uppercase; }
.thing-caption__why { grid-column: 2; font-size: var(--fs-xs); color: var(--c-text-2); }
.thing-caption--headline { max-width: 45rem; font-size: var(--fs-lg); border-left-color: var(--c-lantern); }
```
Poses: wave intro · point objective · shush Stay Silent · count1–3 clue n/3 · tap idle/hint · thumbsUp deposit/solved ·
fist caught/DNF. Reduced motion: pose swaps only.
**ThingTutorial** at the pier (Hyde inactive, clock not running); "Skip tutorial (Enter)" always visible:
| # | Prompt / line | Done when | Timeout |
|---|---|---|---|
| 0 | DuoIntro | 2.5 s / Enter | 2.5 s |
| 1 | `W A S D` walk · mouse or ← → look | moved 3 m | 5 s |
| 2 | Headline, exact: “Stay Silent: Move slowly and avoid making noise — Hydes are sensitive to sound.” · `C` Crouch; noise meter highlighted (walk "Audible · heard within 7 m" → crouch "Quiet") | crouched 1 s | 6 s (headline ≥ 4 s) |
| 3 | `E` Search the crate (practice crate, 1 s, real ring) | done | 5 s |
| 4 | `F` {power} · `Q` {move} — "Watch for the LOUD tag." (real VFX; cooldowns reset after) | either pressed | 4 s |
| 5 | "Shift sprints — but it's loud. Tab: your evidence. V: ask me. Go." | auto | 2 s |
Exact Stay Silent string lives in `thing.ts`, is asserted by e2e, and heads the Controls panel.

## 4. Gameplay HUD — `MysteryHud`
```
|16 [ObjectivePanel 304x96]     [ThreatMeter 420x64 top-centre]        [HudKeyChips]  |
|  Search the ruins for evidence (ear) HEARD A NOISE ▓▓▓░ Caught ○○     Esc Tab V M     |
|  Clues ◆◇◇ 1/3                 · STUNNED 1.8 s                         [RiskChip]     |
|  Egg not found                                                  Low · next 15 s       |
|          KEEP CLEAR: centre 560×320 (x 403–963, y 176–496)                            |
|                       [InteractPrompt  E  Search the desk ◔]  y 512–556               |
|[VitalsPanel 288x104] [CaptionStack ≤2 lines, y 640–690] [AbilitySlots 300x104]        |
| HP ███████░ 72        [Hyde growls nearby ▸]              (F) Psychic   (Q) Shadow    |
| NOISE ▮▮▮▯▯ Quiet ·2 m [ThingCaption ≤560x56 bottom 16]      Vision READY  Ball 12 s  |
| [HIDDEN · it can still hear you]                                                      |
```
ThreatEdge: when the Hyde is in SEARCH/CHASE and off-screen, a 32 px claw chevron on the screen edge at its bearing.

**ObjectivePanel** (top-left): objective copy — find_clues "Search the ruins for evidence"; find_egg "Find the egg in the
Egg Chamber"; retrieve_egg "Your egg was dropped — pick it up (E)"; deliver_egg "Carry the egg to Iago Tower"; accuse
"Name the culprit". Clues: three lozenges (fileText/key/sprout) + "n/3" (type only, never who). Egg: "Egg · not found" /
carried: tier gem + "Rare · 3 pts" + security bar 80×6 + "Heavy: slower, louder" / dropped amber "Egg DROPPED — go back
for it" / "Egg secured". Security bar amber + hatch below 40. EvidenceToast 3.5 s under the panel: icon + title + "Tab to
read"; Thing "That's 2 of 3." (no modal).

**ThreatMeter** (top-centre 420×64): state icon + WORD | suspicion bar 200×10 | "Caught ○○ 0/2".
| HydeMode | Word | Icon | Border | Fill | Edge | Caption |
|---|---|---|---|---|---|---|
| PATROL | Patrolling | eyeClosed | 1px solid border | muted | none | [Heavy footsteps] (≤ 15 m) |
| INVESTIGATE_SOUND | Heard a noise | ear | 2px dashed warning | warning | none | [Hyde sniffs the air] |
| SEARCH | Searching | search | 2px solid warning | warning hatched | bottom mist 90px .35 | [Hyde prowls nearby] |
| CHASE | CHASING YOU | claw | 3px solid #e5484d + glow | #e5484d | bottom + sides pulse | [Hyde growls nearby] |
| COOLDOWN | Losing interest | hourglass | 2px dotted accent | accent draining | mist fades 1 s | [Hyde grunts, turns away] |
Effect suffix chips from ActiveEffects: "· STUNNED 1.8 s", "· PETRIFIED", "· SLOWED", "· DISTRACTED", "· LURED"
(success colour). Hold a displayed state ≥ 0.5 s. `aria-live` polite ≤ 1/3 s; CHASE assertive once.
Catch: 400 ms red vignette then CatchToast 2 s "CAUGHT — 1 of 2 · −35 HP" / "Released at a safe spot. Next catch ends
the run."; Aegislash "BLOCKED — no damage. Catch still counts: 1 of 2"; 2nd catch "Dragged into the fog."
```css
.threat { position: absolute; top: 1rem; left: 50%; transform: translateX(-50%); width: 26.25rem; height: 4rem; padding: .45rem .8rem;
  display: grid; grid-template-columns: auto 1fr auto; align-items: center; column-gap: .75rem;
  background: var(--c-hud); border: 1px solid var(--c-border); border-radius: var(--r-lg); box-shadow: var(--shadow-1); }
.threat[data-mode="INVESTIGATE_SOUND"] { border: 2px dashed var(--c-warning); }
.threat[data-mode="SEARCH"] { border: 2px solid var(--c-warning); }
.threat[data-mode="SEARCH"] .threat__fill { background: repeating-linear-gradient(45deg, var(--c-warning) 0 4px, rgba(245,176,76,.45) 4px 8px); }
.threat[data-mode="CHASE"] { border: 3px solid #e5484d; box-shadow: var(--shadow-1), 0 0 18px rgba(229,72,77,.5); }
.threat[data-mode="CHASE"] .threat__word { color: #ff8a8a; }
.threat[data-mode="COOLDOWN"] { border: 2px dotted var(--c-accent); }
```
**VitalsPanel** (bottom-left): HP bar 160×10 success colour; ≤ 35 amber + hatch + "Low" (never red). NoiseMeter: 10
segments = round(recentNoise×10), > .5 amber; words Silent (0) / Quiet (≤ .15) / Audible (≤ .5) / LOUD; "· heard within N
m" from the stance's tuning radius. HiddenChip "HIDDEN · it can still hear you"; within revealM amber "Too close — it may
spot you".
**AbilitySlots** (bottom-right): F (character portrait) then Q (Pokémon medallion), 56 px circle + key cap + name +
state + LoudTag; conic sweep from UX_V3. States: READY (300 ms glow + chime on ready) · "18 s" cooling · "ACTIVE 3.2 s" ·
denied "Not ready · 18 s" / "No Hyde in range" (shake; reduced motion border flash) · Gomez near switch "Power the gate".
**Top-right:** HudKeyChips (Esc pause · Tab board · V hint (10 s cooldown shown) · M). **RiskChip** 200×44 (hideable):
gauge + "Risk: Low/Medium/High" (< .33 / < .66 / ≥ .66) "· next 15 s"; line 2 exactly "ML estimate" (solid border) or
"Rule-based risk estimate" (dashed); amber, never red; ≤ 1 Hz with 2 s band hold. Unsynced chip "Offline · saves
locally" only while unsynced.
**InteractPrompt** (centred, top 32rem): cap E 40 px + label ("Search the desk", "Examine the pouch", "Inspect the
latch", "Pick up the egg", "Deposit the egg"); progress ring; moving cancels ("Stand still to search"); at the tower with
< 3 clues add "You have 1 of 3 clues — the case may stay unsolved."; "Hold E to set the egg down". **Reticle** 6 px dot
only while an aimed F/Q is ready.
**CaptionStack** (≤ 2 lines, 3 s, de-duplicated, italic [brackets] + direction ◂ ▸ ▾ ▴): Hyde sounds and [Thud — egg
dropped], [Egg cracks], [Buzzing], [Siren song], [Crackle of electricity], [Coins clatter], [Splash]; own footsteps not
captioned. **Thing advisory** (prescriptive): line 1 action ≤ 60 chars, line 2 "Why: …" ≤ 60; 4 s; auto lines ≥ 8 s
apart, never during a catch toast or tutorial; V on demand then 10 s cooldown; never names a suspect.

## 5. Evidence board — `EvidenceBoard` (Tab)
Full-screen overlay, scrim rgba(6,9,20,.94): header 56 ("Evidence Board" · "Professor Orloff · The Silent Evidence" ·
[Close Tab]) · 3 × ClueCard 420×280 · EvidenceThreads band 36 · 3 × SuspectCard 420×220 · AccusePanel footer 64 · fs-xs
"Jobs and events are invented for this game's story."
- **ClueCard found:** icon + title + room chip / text ≤ 280 / "Deduction:" italic ≤ 120 / pins "Points to: {name}" (solid)
  and "Explains: {name}" (dashed + check). **Locked:** dashed, hatched, lock, "Evidence 2 — not found yet · Location: Crypt
  Entrance" (no title/text).
- **SuspectCard:** original silhouette cameo (72 px oval, Cinzel initial — no likenesses), name, "Archivist (role in this
  story)", neutral `alibiOrContext` ≤ 100; "Linked by:" / "Explained by:" chips derived ONLY from found clues;
  "Contradiction:" note when a found clue implicates and another explains.
- **EvidenceThreads:** SVG lines found clue → suspect (implicates solid parchment with pin; exonerates dashed accent),
  300 ms draw-in (instant in reduced motion), `aria-hidden`.
- **AccusePanel:** before deposit: disabled "Accuse at Iago Tower" + "Deliver the egg first, then name the culprit." In
  accusation mode (auto-opened after deposit): "Who released the Hyde?", suspects as `role="radiogroup"`, primary "Accuse
  {name}" (disabled until chosen) + ghost "Leave the case unsolved" (→ not_accused). **AccuseConfirm** modal 560: "Accuse
  Marilyn Thornhill?" / "You found 2 of 3 clues. You can accuse only once." / [Accuse] + [Review evidence] (initial focus);
  Enter ignored 500 ms.

## 6. Deposit, verdict, results
**DepositMoment** (1.5 s): egg rises into the tower beacon, chime; banner "Egg secured — Rare · 3 pts" + "Clock stopped
at 214.3 s"; Thing thumbsUp "Now — who released the Hyde?"; board opens in accusation mode.
**MysteryResults** (no scroll): left 456 (VerdictHeader, ScoreBreakdown, DuoBadge, MiniLeaderboard, CTA) | right
AnalyticsGrid 2×2.
| Verdict | Title | Tone | Sub-line |
|---|---|---|---|
| case_solved | Case Solved | lantern, seal | "Marilyn Thornhill released the Hyde. All three clues held." |
| wrong / not_accused | Egg Secured, Mystery Unsolved | accent violet | "You accused Isaac Night. The evidence pointed elsewhere — 2 of 3 clues found." Never reveal the culprit. |
| DNF | Dragged into the fog | Hyde red, claw | "Caught twice" / "HP ran out" · "Unranked — every finisher ranks above a DNF." No score. |
ScoreBreakdown (tabular): `Egg points 3 × 100 = 300` / `Active time − 214.3 s` / `Score 85.7` (hero, lantern) /
"Mystery: Solved — tracked separately, not part of the score." U+2212 for negatives; below 0 add "Negative scores still
rank above every DNF." DuoBadge (48 px portraits + duo name + role). MiniLeaderboard "Today's board" (mystery-v3.1 only):
top 5 + own row, divider, "Did not finish — unranked (n)". CTA "New investigation (Enter)" → Home + new session;
IdleReturn after 45 s idle ("Returning home in 20 s — press any key to stay").

**AnalyticsGrid** — four LayerPanels (≤ 45 words + one mini chart each; same badges on Laptop 1):
| Layer | Badge | Content |
|---|---|---|
| Descriptive — "What happened?" | barChart #d4cbb5 | tiles: time · clues n/3 · Hyde alerts (chases) · caught n/2 · egg security · hints; stance-mix bar (crouch/walk/sprint %, patterned); F/Q uses |
| Diagnostic — "Why?" | link #b3a8ff | timeline strip 380×40 with glyphs; ≤ 3 rows: **Cause** badge (solid) = rule-verified ("1:42 · Your sprint (loud) was heard 9 m away → the Hyde investigated."); **Pattern** badge (dashed ≈) = correlation ("2 of 3 sightings came within 5 s of sprinting. A pattern, not proof.") |
| Predictive — "What was likely?" | gauge #5cc0e6 | risk sparkline 380×90 with High band + claw ticks at detections; label exactly "ML estimate · trained on simulated episodes · held-out Brier X (baseline Y)" or "Rule-based risk estimate · no trained model loaded" — values from the artifact |
| Prescriptive — "What did Thing advise?" | signpost #6fd6a0 | ≤ 3 rows time · advice · Followed / Not followed / No chance to; "You followed 2 of 3 tips. After following, you stayed undetected for 15 s in 2 of 2 cases." ("after", never "because") |
Every panel renders for every duo; before Phase 4 show "Analytics unavailable for this run" (no placeholder numbers).

## 7. Pause, controls, settings, accessibility
**PauseOverlay** (pointer-lock loss or Esc): "Paused · clock stopped"; [Resume — click to continue] (re-locks; on
rejection "Click again to resume"), [Controls], [Settings], [Leave the case] (confirm: "This ends your run. It won't
appear on the leaderboard.").
**ControlsHelp** (header = exact Stay Silent line): W A S D Move · Mouse or ← → ↑ ↓ Look · Shift Sprint (LOUD) · C
Crouch (quiet) · E Search / pick up / deposit · Hold E Set the egg down · F {power} · Q {move} · Tab Evidence board · V
Ask Thing · Esc Pause · M Mute.
**SettingsPanel:** look sensitivity 1–10 (5) · invert Y (off) · crouch Toggle/Hold (**Toggle**) · reduced motion
System/On/Off · captions Normal/Large (always on) · sound On/Muted · show risk estimate (on) · high contrast (off). Visitor
settings reset on "New investigation".
**Accessibility:** text ≥ 4.5:1, UI ≥ 3:1 over `--c-hud`; focus ring everywhere; fully keyboard-playable; every sound
captioned; colour never the only signal; reduced motion removes card lift, deal-in, threat pulse, Thing bob, deposit rise,
thread draw-in, camera bob/FOV kick; live regions for Hyde state, clue found, objective, catch; min text 14 px; targets
≥ 24 px (buttons 44 px).

## 8. Operator dashboard (Laptop 1) — `MysteryDashboard` at `/?mode=dashboard`
12-col grid, 48rem tall. Header: title · `mystery-v3.1` chip · Realtime badge · operator sign-in.
| Row | cols 1–4 | 5–8 | 9–12 |
|---|---|---|---|
| A (200) | StationLiveCard A | StationLiveCard B | StandingsPanel |
| B (168) | ClueSolvePanel | DetectionTrendPanel | DuoPopularityPanel |
| C (248) | "The four analytics": Descriptive · Diagnostic · Predictive + ModelCard · Prescriptive (3 cols each) | | |
- **StationLiveCard:** phase badge (Idle / Name entry / Choosing duo / Tutorial / Investigating / Carrying egg / Accusing
  / Results / DNF / Signal lost > 15 s), nickname, duo, clue pips, egg (tier hidden until pickup) + security, HP, catches,
  Hyde mode chip, live risk "0.42 · ML" or "Rule-based", last advice + followed?, active time, "updated 3 s ago";
  operator-only "Reset station" with confirm.
- **StandingsPanel:** finishers by score desc, divider, "Did not finish — unranked". **Never shows the culprit or who was
  accused.**
- **ClueSolvePanel:** per-clue find rate, all-three %, Case Solved % of finishers, n. **DetectionTrendPanel:** detections
  per run (last 20), heard-vs-seen split, median time to first alert. **DuoPopularityPanel:** pick rate when offered
  (selected ÷ offered) for the 7 characters, top 5 / bottom 3 Pokémon, "Small sample" when offered < 10.
- **Layer panels:** Descriptive (runs, finished, DNF, solved %, median time, stance mix, top F/Q) · Diagnostic (top
  rule-verified failure causes | dashed "Patterns (correlation)") · Predictive **ModelCard** (model type, target "detected
  within 15 s", N simulated episodes, session-grouped holdout, base rate, Brier vs base-rate Brier, 10-bin reliability
  diagram, "Validated on simulated data; live outcomes shown separately", or "No trained model — stations show Rule-based
  risk estimate") · Prescriptive (advice by action type, uptake %, undetected 15 s after advice followed vs not —
  *observational*).

## 9. Data asks
- game-designer: copy budgets; Thing lines ≤ 60 chars with a pose key; neutral `alibiOrContext` (exoneration only via
  clues); interact labels per clue; practice crate at the pier.
- game-developer: hold-E drop 0.8 s; hearing radius per stance exposed; Hyde bearing; `not_accused` path.
- analytics: predictive output `source: 'ml'|'rule'` + band; diagnostic items `kind: 'cause'|'pattern'`; advice
  `{text, reason, followed: true|false|null}`.
- frontend: `MysteryHudVM` (hp/maxHp/catches, noise {level, word, radiusM}, hidden, hydeMode, suspicion, effects, bearing,
  objective, cluesFound, egg {state, tier|null, security}, power/move {def, status}, interact, thingLine, captions[],
  risk|null, unsynced).

## 10. Review checklist (15)
1. Ctrl crouches only after keyboard.lock(); Ctrl+W tested on both kiosks; UI shows C.
2. Losing pointer lock always pauses; resume by click survives a rejected re-lock.
3. Tab: board read-only + closes in play; focus trap in accusation; blocked during CHASE.
4. Tapping E never drops the egg; only a 0.8 s hold.
5. Three cards fit at 1366×768 and 1920×1080 for every card text (copy-budget unit test + Playwright overflow assert).
6. Cards: both portraits (fallback works), duo name, "decoration only" legend, role icon + word, 6 stats 1–5 with
   best-of-three, F power, Q real move + "Game adaptation", 2 adv, 1–2 disadv, one Select; one lantern button visible.
7. Duo keyboard: focus starts on H1; ← → / 1 2 3; Enter selects; Enter ignored 600 ms + on repeat; body click focuses.
8. Tutorial ≤ 25 s, Enter skips, exact Stay Silent string shown ≥ 4 s.
9. Greyscale screenshot distinguishes all five Hyde states; red only for the Hyde.
10. Steady HUD: centre 560×320 empty; ≤ 30 words; reticle only for aimed abilities; captions/Thing bottom-centre.
11. Risk chip text exactly "ML estimate" / "Rule-based risk estimate" from the service; hideable.
12. Every Hyde/egg/ability sound captioned with direction; captions on when muted.
13. Board: locked clues show only location; links only from found clues; nothing names the culprit before accusation;
    wrong verdict doesn't reveal it.
14. Results: verdict matches; score math shown; mystery "not part of the score"; DNF no score, below finishers; four panels
    render for non-Wednesday duos (Enid+Gengar, Ajax+Gholdengo).
15. Dashboard: both stations live, "Signal lost" after 15 s; finishers above DNFs; four badged layer panels; ModelCard real
    metrics or explicit fallback; reset operator-only with confirm.

Sources: NN/g left-side bias & confirmation dialogs; Game Accessibility Guidelines; BBC subtitle guidelines; WCAG 2.2;
MDN Pointer Lock API; MDN Keyboard API (`keyboard.lock()`).
