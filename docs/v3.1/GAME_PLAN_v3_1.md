# Escape from Raven Island: The Hyde's Regatta — Game Development Plan v3.1 "The Silent Evidence"

> Transcribed from the user's attachment `Escape_from_Raven_Island_Game_Development_Plan_v3_1.pdf` (9 pages, updated
> 2026-10-21). Pokémon Day III – Halloween Arcades, October 27, 2026, Analytics Application.

**Status and authority:** This is a new implementation plan based on the user's latest decisions. It supersedes earlier
rowing / decision-based racing gameplay and separate character / Pokémon selection screens. Numerical tuning,
game-specific character powers, and exact case details below are proposed implementation defaults, not official series
canon or independently signed-off course requirements.

## 1. Executive product requirements

| Area | Implementation requirement |
|---|---|
| Genre | Single-player third-person 3D murder mystery, stealth and egg-extraction adventure inspired by exploration/extraction tension, without copying R.E.P.O. assets or mechanics verbatim |
| Player goal | Investigate Professor Orloff's death, gather three clues, identify who released the Hyde, retrieve a Pokémon egg, deliver it to Iago Tower |
| Arcade duration | Natural 5–7-minute visit (aim ~6 min) including home, selection, tutorial, play and results; **no forced time-out** |
| Hardware | **Exactly three laptops:** Laptop 1 admin/spectator/leaderboard; laptops 2 and 3 independent, concurrent single-player stations |
| Engine | Preserve existing browser frontend and Three.js low-poly 3D; Supabase PostgreSQL, Realtime and trusted server APIs |
| Core roster | **Exactly seven selectable Nightshades** and **18 existing Pokémon partners**; 126 possible character–Pokémon combinations |
| Partner selection | Each new visitor receives **three randomly generated, pre-bundled character + Pokémon cards**, selects one, and never has to pick them separately |
| AI threat | Visible Hyde that investigates noise, uses line of sight, searches, chases and catches; crouching/cover reduce detection |
| Character distinction | Seven powers affect gameplay; Wednesday's and Morticia's powers are psychic, independently of analytics |
| Pokémon fidelity | Named Pokémon moves must be real and legal for the selected species/form in the declared game-generation reference; game-adapted effects are labeled |
| Guide and mascot | Thing hand mascot delivers short subtitled story narration, tutorial and contextual system hints |
| Four analytics | Descriptive, Diagnostic, Predictive and Prescriptive are **game-system capabilities for all 126 pairings**, never gated by Wednesday |
| Mission outcomes | Delivered egg + correctly accused suspect = full success; delivered egg + wrong accusation = partial narrative success; DNF below all finishers |
| Existing software | Preserve working home page, visual assets, telemetry, leaderboard, Supabase components, kiosk configuration; do not wipe history |

**Event source caveat.** The requirements above are supported by earlier user-provided game planning/GDD materials and
newer user decisions. The independently issued original class/activity rubric was not found among the retrieved source
documents. **Do not claim formal rubric compliance** until Claude Code locates an authoritative rubric file in the
repository or the team uploads it and produces a line-by-line compliance matrix.

## 2. Narrative: a short, fair Wednesday-inspired case

**Case title: The Silent Evidence.** Professor Orloff is found dead near Raven Island's sealed research crypt. The
Pokémon egg he guarded is missing; a Hyde stalks the ruins. Thing directs the visitor to discover who used the monster as
cover for the theft and killing.

- **Victim:** Professor Orloff, assigned the role of Nevermore researcher in this game's alternate-universe case.
- **Culprit:** Marilyn Thornhill, assigned the role of archivist and mastermind **for this game's story**, not an assertion of her canonical job.
- **Suspect:** Isaac Night, assigned the role of groundskeeper for this game.
- **Suspect:** Barry Dort, assigned the role of night guard for this game.
- **Optional future antagonists:** Rowan Laslow and Joseph Crackstone (the Pilgrim); NOT extra suspects in the single launch case.

**Three physically discoverable clues, in any order:**
1. **Restricted-transfer note — Research Room:** records Orloff's concern that an archive-only vault sequence was accessed; a signed archive transfer slip names Thornhill at the relevant time. It connects opportunity and motive but does not prove murder alone.
2. **Master-key evidence — Crypt Entrance:** the guard's missing vault key appears inside an archive-issue pouch marked with Thornhill's signature and timestamp. The guard reported the key missing beforehand; her alibi is corroborated by a watch log.
3. **Greenhouse trace and release record — Egg Chamber:** a unique botanical residue and a torn greenhouse inventory seal appear on the Hyde-release latch, matching a sample from Thornhill's equipment record. Older groundskeeper footprints are distinguishable from the fresh approach path; Isaac's maintenance log explains his presence.

**Logical deduction:** The combined archive access + key custody + release-latch trace implicate Thornhill. Show concise
evidence-to-suspect links; the final answer must not be randomly swapped while the clues stay the same. Avoid portraying
the victim's identity or the other characters' adapted jobs as series-canonical facts.

**Evidence Board:** Tab opens a legible panel with three clue cards, three suspects, simple contradictions and one final
accusation. A correct verdict yields “Case Solved”; incorrect yields “Egg Secured, Mystery Unsolved”. Evidence must be
discoverable by **all** playable partners without exclusive powers. Thing may offer a limited hint, never automatically
disclose the culprit.

## 3. Flow and six-minute target

| Phase | Indicative time | Action |
|---|---|---|
| Home, nickname, Thing welcome | 25 s | Preserve gothic homepage and clear Start button |
| Three bundled partner card selection | 40 s | Compare advantages/disadvantages and choose one |
| Tutorial and entry | 25 s | Practice WASD, sneak, E, Q, F and review “Stay Silent” |
| Ruins investigation: 3 evidence objects | 135 s | Explore, hide, read, use powers and moves |
| Egg chamber discovery and pickup | 45 s | Locate, interact, carry physical egg |
| Reach Iago Tower; accuse and deliver | 65 s | Evade Hyde, extract egg, make final accusation |
| Results and analytics | 25 s | Score, deduction, analysis and leaderboard |
| **Total illustrative target** | **360 s** | Design pacing, not an enforced countdown |

No boat, rowing, paddles, route/spend decisions, simulated race clock, or auto-moving endless runner. Preserve title for
continuity only; “Regatta” is legacy branding.

## 4. Randomized bundled partner draft — key new requirement

**Randomization:** From 7 × 18 = 126 valid unique pairings, generate **exactly three cards per new session** and save the
draw seed, offered combos and selected combo. A rerender, reconnect or refresh must not generate a different offer.
Replays get a new seed; a controlled operator test may reuse a seed. No duplicate exact pair; preferably no repeated
character or Pokémon among three cards to increase immediate variety. Do not promise three role categories if impossible
with constraints; use a deterministic scoring search to maximize role diversity.

**Role tags:** investigation, stealth, mobility, control, defense, support. Each bundle combines character and Pokémon
tags into a calculated role score. Target one investigation/stealth, one mobility/escape and one defense/control oriented
**offer**, with deterministic fallback if exact diversity cannot be achieved. Random draw must not be hardcoded to favorite
three pairs or use a pay-to-reroll mechanic.

**Visual presentation:** Three large **Pokémon-card-inspired** original gothic cards in a responsive layout. Each card shows
BOTH portraits, character/Pokémon names, duo name, rarity-themed decorative frame (cosmetic only; not a strength promise),
role tag, six compact stat bars (Investigation, Stealth, Mobility, Defense, Hyde Control, Egg Protection), the F character
power, the Q authentic Pokémon move, 2 advantages and 1–2 disadvantages, and an obvious “Select Duo” interaction. Support
mouse, keyboard focus, arrow keys and Enter; reduced motion; fallback portrait art. Avoid copying an official Pokémon
Trading Card Game frame exactly.

**Statistics:** Numeric 1–5 or 0–100 ratings from a central typed registry, with a documented combination formula and
clamps. Make synergies meaningful but balanced; no pairing can auto-solve the case or permanently defeat the Hyde. Display
plain-English trade-offs; do not promise effects absent from the real gameplay. Once selected, the duo powers, portraits
and labels carry through HUD, Thing introductions, telemetry, gameplay and results.

## 5. Seven playable Nightshades and active character powers (F)

| Character | User-requested identity | Game effect and limitation |
|---|---|---|
| Wednesday Addams | Psychic | **Psychic Vision:** highlights nearest missing evidence in a reachable area for 6 s, supplies an inference prompt; 40 s cooldown, not the analytics system |
| Morticia Addams | Psychic | **Premonition:** visualizes the Hyde's near-future patrol direction for 5 s; 40 s cooldown, no automatic evasion |
| Enid Sinclair | Werewolf | **Wolf Shift:** 7 s faster movement and scent-trail detection; sprint noise increases; 45 s cooldown |
| Bianca Barclay | Siren/manipulation | **Siren Call:** briefly lures the Hyde to a targeted location or redirects its attention for ~4 s; makes noise; 50 s cooldown |
| Eugene Ottinger | Insect control | **Bee Swarm:** detects a nearby clue or distracts Hyde for ~5 s; buzz is audible; 45 s cooldown |
| Gomez Addams | Electricity (requested adaptation) | **Electric Spark:** enables a powered clue switch or staggers Hyde for 2 s, loudly; 50 s cooldown. Do not claim this specific power is verified series canon. |
| Ajax Petropolus | Gorgon petrification | **Gorgon Gaze:** petrifies Hyde ~2.5 s within line of sight; 60 s cooldown; broken by occlusion |

Every character has an animation/effect, cooldown, distinct sound/visual feedback and analytic event. The murder is
solvable with any character. Remove five older playable characters from current selection without deleting historical
rows.

## 6. All 18 Pokémon retained; authentic move names, adapted utility (Q)

**Move-verification rule:** Verify legal learnability for the specific species and regional form against an explicit
source and generation before shipping. The following is a **candidate registry**, not a certification that every move is
legal in every game generation. Replace any invalid candidate with a verified legal move of comparable purpose; preserve
the Pokémon species. Label gameplay effects as game adaptations rather than official battle mechanics.

| Pokémon | Candidate named move | Intended exploration / Hyde effect |
|---|---|---|
| Gengar | Shadow Ball | Impact sound decoy, minor interruption |
| Alolan Marowak | Will-O-Wisp | Reveal hazard boundary, weak distraction |
| Misdreavus | Confuse Ray | Disrupt Hyde targeting briefly |
| Galarian Corsola | Strength Sap | Slows Hyde and restores a small amount of HP |
| Sableye | Shadow Sneak | Quick interrupt from shadow |
| Dusknoir | Shadow Punch | Short range interrupt during grab windup |
| Drifblim | Tailwind | Temporary speed boost with audible-footstep trade-off |
| Froslass | Icy Wind | Slows Hyde within a cone |
| Jellicent | Water Pulse | Splash distraction / brief interruption |
| Chandelure | Will-O-Wisp | Flame highlights arcane markings and draws attention |
| Aegislash | King's Shield | Blocks damage of one timed Hyde grab; catch count remains |
| Trevenant | Leech Seed | Creates slow zone and mild recovery |
| Dhelmise | Anchor Shot | Tethers Hyde or safeguards egg from one impact |
| Decidueye | Spirit Shackle | Briefly pins Hyde |
| Dragapult | Dragon Darts | Targeted interruption / diversion |
| Basculegion | Aqua Jet | Very short dash through wet terrain |
| Ceruledge | Bitter Blade | Close-range interruption with slight HP recovery |
| Gholdengo | Make It Rain | Coin distraction, brief egg shield; no fractional egg points |

Each Q move has cooldown, range, target/line-of-sight behavior, animation, actual outcome, and telemetry; cannot
permanently destroy the Hyde. Include a verified-moves documentation table with source URL, generation, form, status and
replacement rationale if changed. Do not falsely call every move confirmed without checking.

## 7. Player mechanics and visible, sound-sensitive Hyde

- **Controls:** WASD move; mouse look; Shift sprint (noisy); Ctrl/C crouch (quiet); E interact/pick up/drop/deliver; F character power; Q Pokémon move; Tab evidence board; V Thing hint; Esc pause; M mute. Offer key help and subtitles; prevent browser-default actions in active game.
- **Tutorial:** Display exact message: **“Stay Silent: Move slowly and avoid making noise — Hydes are sensitive to sound.”** Noise rings or meter teach trade-offs; crouching is useful but not mandatory.
- **Hyde AI:** Actual visible 3D pursuer with PATROL → INVESTIGATE_SOUND → SEARCH → CHASE → COOLDOWN states; real nav path, not only random catch probabilities. Hearing uses distance, emission, environmental occlusion; sight uses cone, range, obstacles and fog. Example balancing: crouch noise 0.10, walk 0.35, sprint 0.95, dropped egg 1.00; hearing radii walk 7m, sprint 13m, egg drop 17m; LOS ~13m or 8m in fog. All configurable, playtest rather than claim final.
- **Fairness:** Visual and audible suspicion ramp; hiding niches; learnable patrol routes; lost-contact search; no spawn directly on player. First Hyde grab costs 35 HP, affects egg security if held, then releases player at safe point with brief invulnerability; second catch = DNF. Preserve 100 HP, trap damage and cooldown. Defensive move may block injury but catch count is not automatically erased.
- **Egg:** One physical egg, weighted proposed tier Common 50% (1 point), Rare 35% (3 points), Legendary 15% (6 points). E to pick up and carry; egg security 100; damage/impact may drop egg and allow retrieval. Iago Tower requires manual E deposit, followed by final verdict flow.
- **Result:** Score for successful delivery = (delivered whole-number egg points × 100) − active gameplay seconds rounded to one decimal. Negative scores allowed; all successful finishers rank above all DNFs. Mystery accuracy is a **separate result dimension**, not a hidden score bonus. New rules version `mystery-v3.1`, segregated from historical rowing sessions.

## 8. Four game-wide analytics — never character-locked

**Architectural principle:** Character powers are mechanics inside `CharacterAbilitySystem`. Analytics are **separate
system services** consuming standardized game-state and telemetry for **every** bundled duo. Wednesday's Psychic Vision ≠
predictive analytics. Morticia's Premonition ≠ predictive analytics. Thing is a narrator/presenter, not the statistical
processing engine.

| Layer | What it computes | Output |
|---|---|---|
| Descriptive | Accurate event counts and summary: time, movement, noise, clue progress, Hyde alerts/catches, power/move use, HP, egg state, accusation, extraction | Player results + control-center summary |
| Diagnostic | Timeline of rule-verified causes (e.g., dropped egg created noise which triggered investigate) and clearly labeled correlations (e.g., sprinting often preceded sightings) | Cause/event narrative, not unsupported causal claims |
| Predictive | Offline-trained, evaluated model(s) predicting Hyde detection in next 15 seconds / eventual extraction; optionally ETA regression | In-game risk estimate + dashboard model metrics, clear ML vs rule-based label |
| Prescriptive | Context-aware feasible action selector considering stealth, Hyde state, evidence, egg, ability cooldowns and progress | One concise Thing-delivered suggestion, rationale, optional recommendation uptake metric |

**Data:** `session_id`, `station_id`, `rules_version`, `offered_duos`, `selected_duo`, character/pokemon IDs, action and
timeline events, noise, distance, Hyde state, discovered clue IDs, prediction at time of issue, recommended options,
player actions, result and timing. Do not log keyboard presses or every frame to Supabase; aggregate/sparsely sample
privacy-minimizing gameplay telemetry.

**Predictive honesty:** Old boat-race models and 10,000 simulated *race* records are obsolete. Generate seeded
**stealth/mystery episodes**, train/evaluate with session-grouped holdout, report actual sample counts, base rate, Brier
and calibration for classifiers; MAE and baseline for optional ETA regression. Exclude future information from features.
If no trained valid model is available, show **Rule-based estimate** rather than falsely claiming ML predictions. Keep
synthetic/test and live observations separated.

**Prescriptions:** Never recommend undiscovered or unreachable clues, unavailable/cooling abilities, impossible hiding
spots, or accusing without enough evidence. Analytics must run in all 126 combinations, without Wednesday selected. Thing
UI is compact; four layers explicitly demonstrable on Laptop 1 and results.

## 9. Thing mascot and UI

Thing is home-page emblem, subtitled storyteller, tutorial hand, in-scene clue pointer and analytics presenter. Short
expressive gestures and optional caption/sound blips. Thing must not announce the culprit before user deduction or act as
an eighth character. Maintain dark gothic Wednesday atmosphere and Pokémon-card-inspired selection UI while using
original framing/art wherever licensing is uncertain.

Main screen progression: **Restored Home → Three Bundled Partner Cards → Tutorial / Thing → Explore & Investigate →
Retrieve Egg → Deliver to Iago Tower → Final Accusation → Results + four analytics → reset**. Player HUD: HP,
noise/suspicion, current objective, three-clue progress, egg condition, F/Q readiness, Thing hint, Hyde warning; keep
uncluttered.

## 10. Supabase, real-time 3-station operations, and integrity

- Preserve existing project; run **additive migrations**, not destructive DB recreation. Tables may include stations, sessions, offered_duos, gameplay_events, clue_events, powers_used, predictions, recommendations, results and verified leaderboard.
- Each player gets immutable session UUID, persistent station A/B identity, server-issued/random seed, offered trio and chosen pairing. Protect sessions with RLS/authorized Edge Functions; Supabase browser anon key is not admin authority; **never expose service-role key in browser**.
- Server validates allowed session transitions, valid offered-duo selection, clue/egg/delivery event order, valid outcome, score rules and idempotent finalization. Frontend telemetry cannot be treated as perfectly cheat-proof; avoid making strong anti-cheat claims for browser-controlled movement.
- Laptop 1 spectator/operator sees status of A and B concurrently, leaderboards for the new rules version, clue completion, detection, finish/solve rates, common failure causes, available model metrics; only privileged operator resets. Laptop 1 is not the cloud database host.
- Handle network loss with local uninterrupted demo state, reconnect dedupe and explicit unsynced indicator; failures must never contaminate verified leaderboard. No invented credentials. Provide `.env.example`, migrations, auth/policies, setup instructions and local demo mode.

## 11. Engineering phases and test gates

1. **Repository audit and backup:** inspect Git status, history, old flows and assets, installed skills/agents; identify keep/replace/remove and write a short implementation plan. No broad delete.
2. **Core game vertical slice:** restored home, **three bundled cards**, 3D walking/crouching, visible noise-sensitive Hyde, Thing, one clue, physical egg and tower delivery. Verify playable browser loop.
3. **Narrative and abilities:** expand all three clues and suspect deductions, all seven F powers and 18 verified Q moves; verify 126 combinations without auto-win or soft-lock.
4. **Four analytics:** centralized telemetry, descriptive, diagnostic, genuine validated prediction or labeled fallback, real prescriptive advice, independent of any chosen character.
5. **Backend + dashboards:** Supabase migrations, secured RPC/Edge Functions, Realtime stations, verified results, operator controls, resilience and old-data separation.
6. **Polish and event QA:** low-poly art, Thing animation, sounds/subtitles, accessibility, average 5–7-min playtests (at least 10 across difficulty/duos), simultaneous laptop tests, docs and setup runbook.

**Critical acceptance tests:** three unique offered cards; refresh stability; every character/move functional; clues
physically accessible for every pairing; correct vs wrong accusation; audible/visible fair Hyde state changes; silence
reduces threat; Thing narrates without spoiling; analytics for non-Wednesday combos; no fake ML; no rowing UI; DNF
unranked; leaderboard version isolation; simultaneous station isolation; secure RLS; duplicate-finalization rejected;
restart fully resets scene; responsive FPS; natural time target.

## 12. Release risk and scope controls

Event deadline is October 27. Prioritize a stable small-map single-case experience and functioning 3-laptop setup over
multiple procedural mystery cases, physics-object multiplayer, cinematic voice acting, ultra-detailed 3D models or online
leaderboards with untested security. If no official class activity rubric is available, list this as a verification
blocker. Use only approved/licensed third-party character and Pokémon visuals, or clearly marked original-inspired
placeholders; do not present newly generated art as official.
