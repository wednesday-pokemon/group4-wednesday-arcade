# Overhaul brief (owner, 2026-10-23) — verbatim requirements

> Saved by the orchestrator so every agent reads the same requirements. Contract for the implementation:
> `docs/overhaul/OVERHAUL_CONTRACT.md`. Event: Oct 27 2026.

# NEVERMORE: DEADLY SECRETS — GAMEPLAY, ANALYTICS & VISUAL QUALITY OVERHAUL

## Main Instruction

I want you to significantly improve the current implementation of **Nevermore: Deadly Secrets**.

The game is functional, but it needs to become more enjoyable, visually polished, interactive, and easier to understand.

**The target audience is students visiting a Halloween arcade booth.** They should understand the controls and objectives almost immediately, enjoy solving the mystery, experience suspense from the Hyde, and finish a typical session in approximately 5–7 minutes.

This is an improvement pass on the EXISTING game, not permission to rebuild the project.

Preserve everything that already works, especially the home page, Thing mascot/logo and prologue, randomized duo cards, three case assignments, seven playable characters, eighteen Pokémon, Supabase, and leaderboard.

The four analytics categories are essential to the academic requirements, but they should be naturally integrated into gameplay rather than presented as lengthy explanations.

**The new design principle is:**

> Easy to learn. Fun to play. Difficult enough to feel exciting. Analytics that actually help.

## 1. Mandatory agent and skill workflow

Agents: Explore (inspect code), game-designer (fun, loop, difficulty, clue progression, pacing), game-developer (movement,
Hyde AI, interactions, powers, mechanics), 3d-artist (scenes, atmosphere, lighting, animation, visuals), ui-ux-designer
(simplify UI, evidence presentation, minimap, compass, analytics displays), frontend-developer (HUD, interactions, UI
animations, accessibility), backend-architect (case randomization, predictions, Supabase security, data processing),
fullstack-developer (integrate analytics and gameplay with Supabase), debugger (crashes, performance, gameplay bugs),
deployment-engineer (production build, three-laptop readiness). Parallel only with clear file ownership; main session
integrates, runs tests, ensures the complete game works. Skills: game-development, develop-web-game, 3d-web-experience,
frontend-design, ui-ux-pro-max, ui-design-system, senior-frontend, senior-backend, senior-fullstack, clean-code,
using-superpowers, mattpocock-skills:diagnosing-bugs, mattpocock-skills:tdd, code-reviewer, code-review, security-review,
simplify, chrome-browser/built-in-browser where available, dataviz for analytics charts. Log accurately in
`docs/AGENT_SKILL_LOG.md`. No Unity/Unreal agents.

## 2. Make the game fun and less repetitive

Players should feel like they investigate a real murder mystery while hunted by the Hyde. Loop: explore a mysterious
location → discover a clue → short understandable explanation → use the clue to narrow the investigation → avoid/escape
the Hyde → use character powers / Pokémon moves when appropriate → find and retrieve the egg → reach Iago Tower → final
accusation. Avoid excessive menus, repeated dialogue, long interactions.

Small, easy interactions: examining suspicious objects, opening a locked cabinet, finding a hidden passage, activating a
mechanism, using character powers to expose clues, using Pokémon abilities to avoid danger, hiding when the Hyde
approaches, carrying the egg while remaining quiet. No complex puzzles.

Tension and pacing: quiet investigation, suspicious sounds, approaching danger, hiding, escape. The Hyde visibly moves
through the environment, reacts to player noise, searches nearby areas, returns to patrol when it loses the player. No
constant attacks or unavoidable encounters. A player who understands the mechanics has a reasonable chance to finish.

## 3. Three cases must feel different

Visibly different settings, not the same map with different clues.
- **Case 01 — The Poisoned Archive** (culprit Marilyn Thornhill). Old archive + abandoned greenhouse: tall bookshelves,
  restricted research documents, dim green lighting, poisonous plants, broken laboratory equipment, creeping vines,
  locked research cabinets. Focus: searching documents, botanical evidence, suspicious research materials.
- **Case 02 — The Crypt's Last Witness** (culprit Isaac Night). Underground crypt + maintenance tunnels: ancient stone
  walls, crypt chambers, flickering lanterns, underground passages, broken machinery, dust and cobwebs, collapsed
  corridors. Focus: damaged mechanisms, maintenance records, clues through narrow passages.
- **Case 03 — The Midnight Signal** (culprit Barry Dort). Watchtower + abandoned security station: old security
  equipment, stormy night, flickering lights, security control panels, alarm devices, restricted patrol areas. Focus:
  security logs, control panels, suspicious signals and patrol records.
Reuse shared systems/assets but create distinct visual identities AND interactive layouts. Not three massive
environments: compact, intuitive, optimized, completable in the session. Three logically connected clues per case
supporting the culprit and innocent-suspect explanations.

## 4. Simplify clues and evidence

TL;DR format: **CLUE FOUND: STOLEN KEY** / "Someone used the archive key to enter the restricted room." / **Meaning:** The
Archivist had access. Most clue descriptions ~1–2 short sentences. Finding clues: subtle outlines on nearby interactables,
small glows, contextual E indicator, objective markers on the minimap, audio cues near evidence, Thing pointing toward
relevant areas when the player is struggling. Discoverable by ordinary exploration without a special character/Pokémon.
Evidence board: three clear slots (clue icon, short title, one-line description, relevant suspect or deduction); all three
unlock the final accusation. Never directly reveal the culprit through the clue interface. Thing offers optional,
progressive hints.

## 5. Minimap and compass

Minimap in the HUD: player position + facing, pathways, objective markers, evidence search areas, Iago Tower/extraction,
known danger zones. Do not reveal hidden evidence locations unless permitted by a power, move, discovered clue or hint.
Updates as evidence is found. Compass across the top: N/E/S/W, facing, direction to the active objective, nearby
landmarks. Accurate world coordinates. Players rarely feel lost, without turning every objective into an automatic
waypoint.

## 6. Reduce excessive walking effects

Reduce/remove large circular ground pulses, repeated ripple rings, glowing movement trails, frequent particles during
normal walking. Strong effects only for power activation, Pokémon move activation, Hyde detection, important evidence,
major interactions. Footstep visualisation, if any, small and subtle. Noise communicated mainly through a noise meter and
sound cues.

## 7. Four analytics active during gameplay (major academic + gameplay requirement)

Descriptive, Diagnostic, Predictive, Prescriptive operate throughout the game, for every character/Pokémon combination
(not tied to Wednesday). Compact analytics HUD + Thing's contextual messages; no statistics overload.

**A. Descriptive — what is happening?** Partner selection cards show character HP, mobility, stealth, investigation
skill, defense, special character power, Pokémon move, advantages, disadvantages — accurate to configured gameplay
values. During play: HP, noise level, evidence collected (2/3), current objective, available powers + cooldowns, egg
status. Compact summaries on events ("THING'S LOG — 2 of 3 clues found." "Hyde escaped: 1 time." "Egg secured."). No
large statistics dashboard over gameplay.

**B. Diagnostic — why did it happen?** Causes while playing: "HYDE ALERT — Your sprinting made too much noise." "POWER
STATUS — Gengar's distraction helped you escape." "INVESTIGATION — This clue contradicts Barry's alibi." "EGG STATUS — The
egg was damaged after a collision." Distinguish direct game-rule causes from broader correlations; use known causes; no
vague/unsupported explanations; only important messages, with cooldowns.

**C. Predictive — what is likely to happen?** One of the most noticeable, useful features: (1) Hyde spawn or patrol
probabilities, (2) Hyde detection probability, (3) Pokémon egg location probabilities, (4) possible clue location
probabilities, (5) probability of successful extraction.
- Hyde spawn probability zones: specific possible spawn/patrol regions per case with calibrated values (e.g. Archive
  Hallway 45% / Greenhouse Entrance 35% / Restricted Vault 20% — illustrative). Hyde spawns only in valid navigable
  positions, never randomly anywhere. A small risk map shows likely danger areas. Do not reveal the Hyde's exact position
  unless justified by gameplay rules.
- Egg probability areas: plausible egg locations per case (e.g. Research Cabinet 20% / Greenhouse Storage 50% / Hidden
  Vault 30%). The real egg position is chosen once per session. Displayed probabilities must be valid estimates based on
  the actual spawn rules and evidence known. Probabilities update as clues are uncovered using an explicit method
  (Bayesian updating or a calibrated probabilistic model) — **no arbitrary percentage changes**.
- Clue-location probability: similar system for likely evidence search areas; fair and understandable; helps without
  solving the mystery.
- Validity: actual model outputs or clearly labelled rule-based estimates. Trained models: suitable training data,
  appropriate features, no leakage, proper session split, evaluated, real metrics reported. Never present static
  scripted probabilities as trained ML. Rounded display OK; underlying math valid.

**D. Prescriptive — what should I do next?** Thing's short recommendations ("Hyde risk is high. Take the corridor on your
right." "Search the greenhouse. The egg is most likely there." "Walk slowly. Your noise level is increasing." "Use
Gengar's move to distract the Hyde." "Only one clue remains. Check the watchtower."). Consider location, Hyde threat,
noise, evidence collected, probable egg location, remaining objectives, available powers/moves/cooldowns, HP, known safe
paths. Only feasible actions; never unavailable moves or collected clues. Optional short why. Short and unobtrusive.

## 8. Make analytics visually interesting

Part of the gothic investigation interface: mini probability maps, noise meters, Hyde danger indicators, evidence
progress icons, Thing's advice panel, compact confidence indicators, short detective insights. Readable main HUD; never
all four as large panels at once; progressive disclosure + compact optional investigation interface. Laptop 1 spectator
dashboard keeps live progress, cases, duo choices, Hyde encounters, evidence, current risk, mystery accuracy, extraction
success, leaderboard — from actual gameplay data.

## 9. Graphics and game quality

Better lighting/shadows, distinct case environments, improved textures/materials, recognizable objects, smooth character
movement, better Hyde animation/movement, natural ability effects, improved evidence interactions, better camera,
atmospheric fog/lighting, environmental audio. Consistent Wednesday-inspired gothic style. Reuse approved assets.
Performance first. Keep 7 Nightshades, 18 Pokémon, 3 random duo cards, slot-machine reveal, authentic moves, Thing as
narrator/mascot/logo. Thing: short contextual messages, no repeated narration.

## 10. Simplify the UX

Objective understood within ~15–20 s of entering gameplay. Controls: WASD move · Shift sprint · Ctrl or C crouch · E
interact · Q character power · R Pokémon move · Tab evidence + investigation map · Esc pause. Preserve existing mappings
where changing them would cause regressions, but one clear consistent control reference. Brief contextual tutorials only
when needed. Short text standard ("Find 3 clues." / "Stay quiet. Hyde nearby.").

## 11. Preserve the three-case system

Case 01 Thornhill · Case 02 Isaac Night · Case 03 Barry Dort; victim Professor Orloff; randomized per session; stacked
case-file reveal animation; three randomized duo cards; slot-machine duo reveal; Thing's case-specific prologue; three
clues per case; accusation system; egg retrieval + extraction to Iago Tower. Evidence logically sufficient. No culprit
exposure in normal player-facing responses.

## 12. Supabase and data integrity

Keep Postgres + Realtime; Laptop 1 dashboard/analytics/leaderboard, Laptops 2–3 player terminals. Independent sessions,
correct randomized cases, correct partner selections, gameplay telemetry, analytics updates, verified final scores, DNF
handling, no duplicate results, secure permissions, reliable sync. No privileged keys in browsers. No destructive table
replacement or erasing history.

## 13. Priority

Phase A gameplay usability (TL;DR clues, clue discovery, objective guidance, minimap + compass, fewer walking effects,
controls/navigation) → Phase B live analytics (descriptive, diagnostic, probability-based Hyde + egg search, prescriptive,
telemetry to Supabase) → Phase C case environments (distinct, case interactions, balance) → Phase D visual polish
(lighting, camera, textures, animation, audio, UI, Thing, cards) → Phase E integration + testing (automated, browser
gameplay, each case, all 7 powers + 18 moves, duo draft, four analytics for any character, dual sessions, laptop perf).
Build + test after each phase; fix regressions before moving on.

## 14. Acceptance criteria

1 controls/objective understood quickly · 2 interactive + suspenseful · 3 visually distinct case environments · 4 clues
easy to locate/understand · 5 evidence supports logical deduction · 6 walking effects not distracting · 7 minimap +
compass accurate · 8 Hyde on valid routes, responds to sound · 9 predictive probabilities match actual mechanics · 10
predictions update meaningfully with evidence/state · 11 relevant prescriptive advice · 12 descriptive info in selection
+ play · 13 diagnostic feedback on meaningful events · 14 all four analytics for every duo · 15 analytics visible without
overcrowding · 16 powers/moves meaningfully affect play · 17 duo cards + case reveal animations still work · 18 typical
game 5–7 min without a forced countdown · 19 Supabase, dashboard, leaderboard functional · 20 smooth on arcade laptops.

Final deliverables: summary, files changed, screenshots, browser playtest results, automated test results, known
limitations, before/after comparison of the four analytics, accurate agents/skills list; update docs/AGENT_SKILL_LOG.md.
Do not claim a feature complete without implementing and testing it. Prioritize genuine gameplay improvements,
simplicity, visual quality, reliability over more words, menus or features.
