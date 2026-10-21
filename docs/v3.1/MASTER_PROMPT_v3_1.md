# CLAUDE CODE MASTER IMPLEMENTATION PROMPT v3.1
## Escape from Raven Island: The Hyde's Regatta — The Silent Evidence

> Saved verbatim from the user's attachment `Claude_Code_Master_Revision_Prompt_v3_1.md` (2026-10-21). Source of truth
> together with `docs/v3.1/GAME_PLAN_v3_1.md`. Supersedes rowing / race-leg / separate-selection requirements.

**ROLE:** You are the lead engineer and integrator of an existing Three.js/Supabase school arcade game. The owner has changed the design. Implement a playable, polished **third-person murder-mystery / stealth / Pokémon egg extraction** game, not a boat game. Read `Escape_from_Raven_Island_Game_Development_Plan_v3_1.md` completely and use it as the current source of truth. This prompt and v3.1 supersede older rowing, race-leg, separate-selection and character-specific-analytics requirements.

**DO NOT only plan. Inspect repository, implement progressively, build and test, integrate contributions, and report the actual results. Do not claim agents ran, models were trained, moves verified or Supabase deployed unless evidence exists.**

## 0. First: audit repo, recover prior work and reconcile rubric

1. Inspect root readme, package/scripts, `src`, scenes, routes, assets, database migrations, tests, Git log/diff and current branch. Record which working home page and selection components exist or can be recovered from Git; make a safe checkpoint before disruptive edits. Do not revert valuable concurrent user changes.
2. Locate any official **Pokémon Day III / Analytics Application activity instructions or grading rubric** in repository or attached accessible materials. Build a compliance checklist using their exact requirements. If absent, say “original official rubric unavailable; based on existing GDD” rather than pretending it was checked. Documented existing constraints: Oct 27 exhibition; exactly 3 laptops (dashboard + two simultaneous standalone player terminals); four analytics; 5–7-minute full visitor experience; Supabase and leaderboard.
3. Preserve existing backend / HUD / fonts / art / animations / brand where useful. Remove gameplay references to rowing, WASD boat steering, SPACE rowing, three boat racing legs, stamina spending per leg, and simulated boat time. Do **not** indiscriminately delete historical files or stored race results.
4. Create `docs/IMPLEMENTATION_PROGRESS.md`, `docs/ACTIVITY_COMPLIANCE.md`, `docs/MOVE_LEGALITY.md`, `docs/PLAYTEST_RESULTS.md`, `docs/OPERATOR_RUNBOOK.md`. Update as work progresses. If external inputs are unavailable, continue completing the local game and report blockers.

## 1. Mandatory agents, skills, delegation and integration

Use the available installed skills when relevant: `using-superpowers`, `game-development`, `develop-web-game`, `3d-web-experience`, `frontend-design`, `ui-ux-pro-max`, `ui-design-system`, `theme-factory`, `senior-frontend`, `senior-backend`, `senior-fullstack`, `clean-code`, `code-reviewer`, `file-organizer`.

Delegate appropriate bounded tasks to available named agents: `game-designer` (loop/balancing), `game-developer` (mechanics), `3d-artist` (world, Thing, monster, VFX), `ui-ux-designer` (cards, HUD, evidence board), `frontend-developer` (screen integration), `backend-architect` (Supabase/RLS), `fullstack-developer` (integration), `debugger` (regression/bugs), `deployment-engineer` (booth/runbook). `unity-game-developer` and `unreal-engine-developer` are not suited to the Three.js implementation; do not start unrelated engines. Only invoke agents/skills if available in this actual session. If an agent invocation needs explicit permission, follow tool requirements; do not silently fabricate agent completion.

**Ownership boundaries:** one owner for each module or group of files; shared interfaces agreed first; parallelize design/docs/tests only where merge-safe. Lead integrator reviews patches, runs the build/tests, resolves conflicts, and manually tests game browser behavior. Log actual agent/skill usage.

## 2. Fixed product direction and visitor journey

The game is **a Wednesday-themed haunted-island murder mystery with R.E.P.O.-inspired stealth and egg extraction**, single-player on two concurrent kiosks. No boat rowing, no lane runner, no multiplayer co-op. Keep title as legacy event name for now. The objective is: “**Stay Silent. Read the Clues. Escape the Hyde.**”

**User journey:** RESTORED ORIGINAL HOME → THREE RANDOM BUNDLED PARTNER CARDS → THING'S SHORT TUTORIAL → INVESTIGATE 3 CLUES → FIND / CARRY THE EGG → REACH IAGO TOWER → ACCUSE ONE SUSPECT → RESULTS / ANALYTICS / LEADERBOARD → RESET. Full visit naturally 5–7 minutes, aiming 6 minutes; no forced countdown, but fair failure states.

**Controls:** WASD walk, mouse look, Shift sprint/loud, Ctrl or C crouch/quiet, E interact/pickup/drop/deliver, F character power, Q Pokémon move, Tab evidence board, V Thing hint, Esc pause, M mute. Consider adjustable sensitivity, remappable controls and hold/toggle crouch. Prevent browser accidental scroll/focus while playing. Audio cues must have readable captions.

## 3. RANDOM THREE-CARD PARTNER SELECTION — must replace separate screens

Selectable character pool exactly: **Wednesday Addams, Enid Sinclair, Bianca Barclay, Eugene Ottinger, Morticia Addams, Gomez Addams, Ajax Petropolus**. Retain **all 18 existing Pokémon**: Gengar, Alolan Marowak, Misdreavus, Galarian Corsola, Sableye, Dusknoir, Drifblim, Froslass, Jellicent, Chandelure, Aegislash, Trevenant, Dhelmise, Decidueye, Dragapult, Basculegion, Ceruledge, Gholdengo. 126 theoretical valid pairs.

Generate exactly **three session-specific pre-bundled duos** using a seeded RNG. Each card is one character + one Pokémon. No duplicate exact pair. Prefer distinct characters and Pokémon and maximize role diversity among investigation/stealth, mobility/escape and defense/control, with deterministic graceful fallback. Do NOT regenerate three options on React rerender, browser refresh or reconnect; persist initial offered trio and seed to session store/Supabase and recover same set. New sessions get new offers. No forced character choice beyond the three options and no separate Pokémon menu.

**Card visual requirement:** polished original **Pokémon-trading-card-inspired gothic cards**, not exact official TCG card clones. Each displays dual portrait/art, duo name, role, F power name/effect, real Q move name/effect, advantages, disadvantages and **six consistent stat bars** (Investigation, Stealth, Mobility, Defense, Hyde Control, Egg Protection), plus one clear Select button. Three side-by-side on laptop when possible; focus/hover states, keyboard Left/Right + Enter, mouse support, responsive and reduced motion. Every stat must correspond to an actual tuning variable or be clearly labeled comparative; generate from central character/Pokémon typed registries and synergy rules, never random untruthful claims. Store `offered_duos`, `selected_duo`, character and pokemon IDs in telemetry.

**Preserve original homepage** and gothic identity. Retrieve original working pages from Git if required, but do not reintroduce separate picks. Thing reacts to selected duo and introduces both. Show selected pairing during gameplay and results.

## 4. Mystery case and deterministic evidence logic

Professor **Orloff** is the victim (game adaptation: researcher); **Marilyn Thornhill** the archivist and guilty mastermind; **Isaac Night** the groundskeeper and alternative suspect; **Barry Dort** the night guard and alternative suspect. Additional future-only villains: Rowan Laslow, Joseph Crackstone (Pilgrim). These are **adapted jobs/events within an original alternate-universe game plot**, not documented canon claims.

Single launch case: Thornhill accessed a hidden restricted vault sequence, stole a guard key and released the Hyde while stealing a mysterious Pokémon egg. Three interactable evidence objects in three distinct, reachable locations:

- Research Room: restricted transfer note signed by Thornhill, corroborating secret vault knowledge and timing.
- Crypt Entrance: guard's missing key in archive-issue pouch bearing Thornhill's log identity; guard's report shows key was previously missing.
- Egg Chamber: botanical residue + torn greenhouse seal on the Hyde release latch, matching Thornhill's inventory record; Isaac's old muddy tracks are explainable by repairs.

Each clue is physically found using real 3D locomotion and E. No randomness in culprit for Case 1, no unfair single-clue leap. An evidence board (Tab) lists 3 collected clues, candidate suspects, short deductions and a final one-shot accusation. Do not spoil culprit via objective marker, Thing or analytics. Correct and incorrect are both supported; player may deliver egg with incorrect verdict (partial success). Missing clues must not make extraction impossible, but full “Case Solved” requires all three plus correct accusation. Persist clue IDs and verdict. Test truth table and alternate pathways. Avoid large dialogue sequences that break six-minute pacing.

## 5. Sound-sensitive Hyde and physically interactive extraction

Build a compact **walkable Three.js map**, not an endless corridor: pier / arrival point, research room, ruined crypt, egg chamber, optional shortcut and Iago Tower courtyard. Include real cover, sight-blocking walls and hiding spots. Hyde must be **visible 3D entity** with navigable pursuit and responsive audio. State machine PATROL → INVESTIGATE_SOUND → SEARCH → CHASE → COOLDOWN; noise and sight determine transitions, not a hidden instant-catch roll. Crouch/walk/sprint/drop/abilities emit distinct noise events, fall off with distance, account for walls. Suggested config: crouch 0.10; walk 0.35; sprint 0.95; dropped egg 1.0; patrol hearing walk ~7m, sprint ~13m, egg drop ~17m; line-of-sight cone ~100 degrees, 13m clear and 8m fog; loss-of-sight chase decays after ~4s, SEARCH ~8s. Tune via playtest, not a claim of validated balance.

Display suspicion meter, threat-state warnings, stealth feedback and reliable sound captions. Teach exact tagline: “**Stay Silent: Move slowly and avoid making noise — Hydes are sensitive to sound.**” Include crouch/cover as counterplay, fair reaction window, predictable patrol starts, and no spawn on player. Hyde can catch, first grab −35 HP and egg security damage if carried; short safe-release/temporary invulnerability; second catch DNF; HP 0 DNF. Aegislash protection reduces consequences as defined but does not trivially reset catches. No Pokémon permanently kills Hyde.

Spawn **one physical Pokémon egg** in the egg chamber; tier Common=1 / Rare=3 / Legendary=6, seeded weights proposed 50/35/15 (configuration). E picks up/drops and E deposits at Iago Tower. Carrying egg affects movement/noise; protect egg security (0–100) from collisions/catches; if dropped, allow fair retrieval and prevent softlock. Winning does not occur from collecting a UI checkbox. The tower deposit and verdict result should be visibly satisfying and idempotent.

Score a finished delivery as `(whole delivered egg points * 100) - active gameplay seconds`, rounded one decimal; negative scores allowed. “Completed” players sort ahead of DNF even if negative; DNF log distinct. Accusation success is tracked separately (no invented score bonus). New `rules_version='mystery-v3.1'` leaderboard partition; do not mix old boat scores. Pause/loading time excluded from active time.

## 6. All seven powers must be visible, independent and balanced

**F is a selected Nightshade's ability; Q is the selected Pokémon move; both are separate from analytics.** Per-user powers:
- Wednesday — Psychic Vision: 6-second highlight of nearby uncollected evidence; 40-second cooldown. Do not secretly reveal culprit.
- Morticia — Psychic Premonition: 5-second ghosted preview of Hyde's near-future patrol direction; 40 seconds.
- Enid — Werewolf Shift: 7-second enhanced speed and scent path; sprint/noise tradeoff; 45 seconds.
- Bianca — Siren Call: ~4-second targeted attention redirection; sonic noise; 50 seconds.
- Eugene — Bee Swarm: clue location or ~5-second distraction; buzzing noise; 45 seconds.
- Gomez — Electric Spark: interacts with electric puzzle switch or stuns Hyde 2 seconds, makes noise; 50 seconds. This is a requested alternate-universe adaptation, not a verified canon claim.
- Ajax — Gorgon Gaze: line-of-sight 2.5-second petrification; 60 seconds.

Implement all seven with actual VFX/SFX, cooldown indicators, activated events and tests. Ensure every character can independently find all clues and finish without powers. No instant reveal of final killer, infinite invulnerability or permanent petrification.

## 7. Eighteen actual Pokémon move names and legally verified learnsets

Maintain all 18 Pokémon and recognizable abilities. Use the following **candidate move registry**, then verify each move's learnability for that **exact regional form/species and chosen generation** before calling it canonical. Record a reliable move database/reference URL, game version and move-legal result in `docs/MOVE_LEGALITY.md`. If invalid, choose and document a legal move for that exact Pokémon. The game effect can be adapted for stealth rather than literal turn-based battle; label it accordingly.

| Pokémon | Candidate real move | Intended in-game effect |
|---|---|---|
| Gengar | Shadow Ball | Sound/impact decoy, Hyde interruption |
| Alolan Marowak | Will-O-Wisp | Illuminate hazard and distract |
| Misdreavus | Confuse Ray | Disrupt targeting |
| Galarian Corsola | Strength Sap | Slow Hyde, heal slightly |
| Sableye | Shadow Sneak | Quick interrupt |
| Dusknoir | Shadow Punch | Melee interruption |
| Drifblim | Tailwind | Short speed boost / noise tradeoff |
| Froslass | Icy Wind | Slow Hyde in cone |
| Jellicent | Water Pulse | Splash decoy |
| Chandelure | Will-O-Wisp | Reveal symbol and distract |
| Aegislash | King's Shield | Timed block; catch count unchanged |
| Trevenant | Leech Seed | Root zone, minor healing |
| Dhelmise | Anchor Shot | Tether Hyde / egg security |
| Decidueye | Spirit Shackle | Pin Hyde briefly |
| Dragapult | Dragon Darts | Interrupt/divert |
| Basculegion | Aqua Jet | Short mobility dash |
| Ceruledge | Bitter Blade | Slash interruption and minor healing |
| Gholdengo | Make It Rain | Coin decoy / temporary egg protection |

All have Q activation, cooldown, range, targeting, readable VFX, and logged success/failure. A species/form move candidate is **not considered verified just because its name exists**. Do not create fake move names or silently swap Pokémon species. Make a per-partner move smoke test. For rights-sensitive artwork, reuse licensed/approved assets or clear placeholders; don't assume generated images are official.

## 8. CRITICAL REFACTOR: FOUR ANALYTICS ARE GAME-WIDE, NOT WEDNESDAY'S SKILL

This is the user's latest highest-priority requirement. The four analytics must operate for **ANY of 126 possible selected duos**. They are distinct from F/Q supernatural powers. Thing is a *UI messenger*, not the calculation engine. Never place the predictive classifier inside `WednesdayAbility` or restrict analytics to Wednesday or Morticia.

Use architecture akin to:
`GameEngine/GameState + EventBus -> TelemetryCollector -> {DescriptiveService, DiagnosticService, PredictiveService, PrescriptiveService} -> {ThingHints, HUD, Results, SpectatorDashboard, Supabase}`.

### 8A. Descriptive Analytics — What happened?
For every station/session record immutable meaningful events and aggregate: movement time/distance, walk/crouch/sprint proportions, noise emissions, alerts, Hyde chase/grabs, three clue discoveries, time to egg, egg condition, chosen bundle and abilities, hint requests, verdict, extraction, active elapsed time, score. Accurate session report and Laptop 1 aggregate. Avoid frame-by-frame DB writes; batch structured events with `seq`/time and compute derived metrics.

### 8B. Diagnostic Analytics — Why?
Produce grounded reasons: e.g., a configured noise event triggered INVESTIGATE_SOUND; sight triggered CHASE; egg was dropped because a collision reduced security. Only assert direct causation when explicit game rules/event transition support it. Separate correlations (e.g., sprinting preceded Hyde detection) from causal conclusions. Show a simple timeline/impact breakdown at results and aggregate frequent failure causes on dashboard.

### 8C. Predictive Analytics — What is likely?
The old linear simulated race-leg time / Hyde event model trained on simulated boat races is **invalid for the new game**. Generate **new seeded mystery-stealth simulated episodes** with realistic movement choices and AI; save training CSV/data generation code. Train/test grouped by session to avoid leakage. Required classification target: Hyde DETECTION within next 15 seconds; second target extraction success if feasible; optional regression: estimated seconds to current objective if class rubric requires regression. Record pre-prediction-only features: distance to Hyde, noise state, movement/crouch, occlusion, HP, egg status, clue count, ability availability, current room/objective, character and Pokémon factors. Evaluate with Brier score, calibration, base-rate baseline, and MAE/naive ETA baseline for regression. Publish measured metrics, not arbitrary promised thresholds; never claim simulated data are real people.

If real model artifact is unavailable, show explicitly **“Rule-based risk estimate”** and do not advertise it as trained ML; maintain safe gameplay. Keep training/validation data separate from player events. Display optional lightweight risk icon in HUD and richer model explanation on Laptop 1/results. All seven characters receive equivalent access.

### 8D. Prescriptive Analytics — What should be done?
Evaluate currently *feasible* choices based on actual game state, objectives, Hyde location/visibility/noise, ability cooldown, egg and clues. Candidate actions: crouch, hide, take safe alternative corridor, stop sprinting, use a currently ready and relevant Q/F, inspect nearby clue, retrieve dropped egg, proceed to tower. Explain one action briefly using a real reason. DO NOT recommend unreachable evidence, unavailable moves, already-completed tasks, or a supernatural vision belonging to a different character. Thing presents one concise suggestion on V or context trigger; record advice, acceptance and outcome for course demonstration. The rule engine can be honest deterministic prescriptive analytics; do not falsely claim reinforcement learning/optimization if not done.

**All four layers MUST have a distinct visible, testable demonstration in the operator dashboard.** No layer is merely a theme name or a character skill. Test selected combinations including `Enid+Gengar`, `Morticia+Aegislash`, `Ajax+Gholdengo` and `Wednesday+Gengar` to prove independence.

## 9. Thing as mascot, storyteller and analytics presenter

Thing's animated disembodied hand should appear as game emblem/home logo motif and useful in-world guide. Show short text narration with expressive gestures: begin case, guide controls, remind to “Stay Silent”, introduce clues, communicate threats, announce delivery and results. Via V, present one contextual hint; don't reveal the culprit. Thing delivers analytics outputs from services when appropriate; it is not secretly the model and is NOT an eighth selectable character. Use readable subtitles, optional nonverbal audio, mute support. Avoid long blocking dialogue.

## 10. Supabase architecture, score integrity and three stations

Use existing Supabase PostgreSQL + Realtime, not Firebase. Add migrations for offered bundle draws, character/pokemon IDs, event log, clues, evidence, Hyde encounters, powers, forecasts, advice, finalized scores and metadata. Recommended constrained tables: `stations`, `sessions`, `offered_duos`, `game_events`, `clue_events`, `forecast_events`, `recommendations`, `final_results`; materialized/view leaderboard optional. Use unique `(session_id, sequence_number)` and unique final result `session_id`, status check constraints, correct FKs; RLS; authenticated operator reset. Avoid destructive rewrites of old stored data.

Trusted Supabase Edge Functions / RPC validate server-issued session offered options, selected combo, allowed event order, clue acquisition, egg delivery, scoring/version and idempotent finalization. Never expose Supabase service-role key in browser. Since movement is browser-controlled, explicitly document practical anti-cheat limits. Anonymous client sessions cannot write another station's results. Restore state safely on refresh and reconnect; offline local demo is allowed, but show unverified/pending sync and avoid polluting verified leaderboard.

**Kiosk hardware:** Laptop 1 spectator/operator dashboard, A and B independent fullscreen browser gameplay. Dashboard Realtime statuses, finished / DNF standings, clue solve rate, Hyde detection trends, Pokémon/character popularity, model validation metrics and at least one visible panel per analytics layer. Laptop 1 is not the database server. Admin can securely clear a stuck station; never let public terminal issue privileged reset. Document exact `.env.example`, migrations, Edge deployment, hosting, operator start/reset and network-failure steps.

## 11. Gameplay HUD, visual language and accessibility

Gothic Nevermore art direction, simple performant low-poly island; no generic endless runner. Third-person follow-camera, controllable player, real collision volumes and line-of-sight blockers, spatial audio with caption equivalents, fog and moody lighting. Camera transitions smooth, avoid disorienting shakes. HUD minimalist: HP, suspicion/noise, clue counter, egg status, F/Q cooldown, objective and one Thing advisory. Evidence Board and results show deeper analytics. Good text contrast, visible focus states, keyboard-only support, remap/help, reduced motion and mute.

## 12. Phased implementation with gated acceptance

**Phase 0 — audit and freeze:** preserve home, inspect current repo/official rubric, create docs, module ownership and Git checkpoint. Run baseline build/test.

**Phase 1 — vertical slice:** randomized 3-card duo screen; character selected; Thing tutorial; 3D walk/crouch/sprint; 1 clue with E; visible Hyde patrol/hearing/sight; egg pickup/delivery; victory/defeat. Manually play in browser before moving on.

**Phase 2 — narrative:** all three clues, suspect board and accusation logic; physical island locations, Iago Tower, fair hiding; no softlock. Validate culprit logically deducible.

**Phase 3 — full roster:** all seven active powers, all eighteen verified Pokémon moves, unique stats and role-diverse cards; tests for all 126 pairing combinations and ability interactions. Character moves are neither cosmetic nor required to solve the case.

**Phase 4 — four analytics:** event stream, all four independently working services, ML trained and evaluated or explicit labeled fallback, Thing hints, per-session report, operator dashboard panels. Prove non-Wednesday accessibility.

**Phase 5 — backend:** Supabase schema/RLS/security/Edge Functions, Realtime both stations, recover/reconnect, deduplicated finalization, versioned leaderboard; preserve demo mode without credentials.

**Phase 6 — polish & acceptance:** artwork/audio; accessibility; browser performance; at least 10 visitor playtests, measure full sessions and tune toward 5–7 mins without forced timeout; test both station laptops simultaneously and operator dashboard; document exact reproducible start commands.

### Mandatory acceptance matrix
- [ ] Previous home page works; separate selection menus removed; new **three duo cards** shown every new session.
- [ ] Three options unique and role-diverse, stable on refresh/reconnect, logged and reproducible by seed.
- [ ] Exactly 7 valid playable Nightshades and 18 original Pokémon; all **126 theoretical pairs** supported.
- [ ] All six displayed stats/trade-offs correspond to real play variables.
- [ ] WASD movement, crouch/sprint, physical clue/E pickup, tower drop-off, camera and collision work.
- [ ] Thing mascot, tutorial, subtitles, “Stay Silent” instruction and narrative hints work.
- [ ] Hyde visibly hears noisy movement, investigates, sees, chases, loses track, catches and can be escaped.
- [ ] All 7 F powers and all 18 Q moves matter, have VFX/cooldown and obey form-specific move legality.
- [ ] Professor Orloff case and 3 clues logically implicate Marilyn Thornhill; Isaac Night and Barry Dort have fair exonerating context.
- [ ] Correct / wrong accusation and successful extraction / DNF all work; no automatic accusation reveal.
- [ ] Four system-level analytics work for EVERY selectable duo; Wednesday's psychic power is separate.
- [ ] Predictive estimates truthfully labeled and measured; prescriptive hints always feasible and evidence-based.
- [ ] Score uses actual active game time; negative completion scores remain ranked above all DNFs; old rowing results isolated.
- [ ] Two simultaneous player terminals, live spectator dashboard, secure Supabase data, no cross-session leakage.
- [ ] At least ten full playtests; most complete naturally within 5–7 minutes and performance stable on the actual laptops.
- [ ] Official activity rubric checked verbatim if available; otherwise gap documented and team asked to supply it.

## 13. Execution instruction / final response contract

**Start real implementation now.** At the end of each phase run actual repo tests/build, repair failures, and update progress docs. If you cannot complete everything in a single run, prioritize a fun playable vertical slice and report precise next executable steps, not vague promises. Never present placeholder UI/logic as completed. Report (a) changed files, (b) what was kept, (c) actual agents/skills invoked, (d) commands executed and pass/fail outcomes, (e) playable URL / local start instructions, (f) any blockers requiring Supabase credentials, rights-cleared assets or official rubric, and (g) 3-laptop release checklist. Do not stop at a plan or rewrite this prompt instead of coding.
