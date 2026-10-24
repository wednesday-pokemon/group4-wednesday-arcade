# FINAL BRIEF (owner, 2026-10-24) — Final gameplay & experience improvement (verbatim requirements)

> Saved by the orchestrator. Contract: `docs/final/FINAL_CONTRACT.md`. Event Oct 27 2026. Builds on the overhaul
> (`docs/overhaul/*`) and the enemy work (`docs/overhaul/ENEMY_*.md`), committed as c287cd6.

Improve the EXISTING Nevermore: Deadly Secrets game to make it more exciting, visually polished, beginner-friendly, and
appropriate for a 5–7-minute Halloween arcade experience. **Do not rebuild the project. Inspect the repository, preserve
working features, implement the changes, and test the actual game.** Main objective: FUN, understandable within seconds,
genuinely interactive, clearly demonstrating all four analytics categories DURING gameplay.

## 1. Agents and skills
Delegate: Explore (audit), game-designer (fun, pacing, balancing, objectives), game-developer (monsters, hiding,
interaction, scoring, death mechanics), 3d-artist (monster visuals, animations, environments, cutscenes), ui-ux-designer
(controls, HUD, analytics visibility, menus), frontend-developer (hiding UI, leaderboard, animations, presentation),
backend-architect (Supabase scoring, cases, persistence, verification), fullstack-developer (integrate gameplay,
analytics, leaderboard), debugger (defects). Skills: using-superpowers, game-development, develop-web-game,
3d-web-experience, frontend-design, ui-ux-pro-max, ui-design-system, senior-frontend, senior-backend, senior-fullstack,
clean-code, mattpocock-skills:tdd, mattpocock-skills:diagnosing-bugs, code-reviewer. Parallel only with clear file
ownership; main session integrates. Log actual usage in docs/AGENT_SKILL_LOG.md; never claim unused agents/skills.

## 2. Murder mystery characters
Culprits: Case 01 The Poisoned Archive — Marilyn Thornhill · Case 02 The Crypt's Last Witness — **Françoise Galpin** ·
Case 03 The Midnight Signal — Barry Dort. Victim: Professor Orloff. **Isaac Night is NO LONGER a culprit or
groundskeeper** — he is a roaming monster, **Slurp**. Update all three cases' evidence, dialogue, suspect profiles,
solutions, narration, Supabase case definitions, accusation validation. Rewrite Case 02 so its three clues logically
implicate Françoise (crypt setting may stay). Keep three distinct compact environments. No contradictory leftover
evidence. Alternate-universe stories, not canon.

## 3. Isaac Night / Slurp as a hunter
Zombie-like Slurp form (consistent with Wednesday Season 2), visually and behaviourally different from Hyde (feral,
noise-attracted predator) and Joseph Crackstone (sight-based cursed hunter with supernatural attacks). Slurp:
unpredictable zombie stalker that searches nearby areas and chases when alerted — spawns at designated valid locations,
wanders/patrols with unsettling movement, detects via sight + proximity, occasionally investigates suspicious activity,
chases and attacks when detected, escapable via hiding spots, movement and appropriate abilities, disappears after a
resolved encounter or patrol cycle. Preserve Hyde and Crackstone. Avoid multiple attacking monsters near the player.

## 4. Dynamic spawning / despawning (encounter director)
Monsters must not stay in one place. Controlled director dynamically spawns, despawns and respawns Hyde, Crackstone,
Slurp: predefined navigable spawn zones per case; weighted probabilities; accounts for player location, objective,
recent encounters, difficulty; never spawns in the player's view or beside them; despawns safely only when far, out of
sight, not chasing/attacking; cooldown before respawn; no flicker; limit active hostiles; predictable escapes; despawn
must not reset damage, cooldowns or session events incorrectly. Fair and avoidable. Expose ACTUAL encounter
probabilities to predictive analytics — never fake percentages.

## 5. Interactive hiding cabinets
Cabinets/lockers/wardrobes: approach → "Press E to Hide" → enter → camera transitions to a hiding view → close the door
with E → while hidden movement restricted and detection reduced → E to open and exit. Visible open/close animations;
monsters can't see a properly hidden player through closed doors; entering/closing too loudly may attract attention; a
monster that actually witnessed the entry may investigate the cabinet; no permanent invulnerability; never exit into
blocked geometry; attacks and collisions consistent. Prompts: "E — Hide", "E — Close Door", "Stay Quiet", "E — Exit".
Simple and accessible.

## 6. Death cutscenes
On defeat by Hyde, Crackstone or Slurp: a short distinct cinematic (Hyde sudden lunge toward camera; Crackstone cursed
attack + supernatural fade; Slurp zombie grab + close-up). ~3–5 s, smooth camera, sound, short attack animation, fade to
game-over, names the monster, player control disabled, triggers once, skippable without changing the recorded outcome.
Use supplied video files if present; otherwise Three.js models + camera + effects. Not excessively graphic (student event).

## 7. Smaller maps
Each case environment compact and intuitive: shorter distances between clues, fewer empty corridors, recognizable
landmarks, more meaningful interactive areas, working minimap + compass, well-placed cabinets, multiple escape routes,
faster clue→extraction movement. Typical investigation ~2–3 min; whole visitor session ~5–7 min incl. selection,
prologue, play, results. Not so small that monsters constantly corner the player. Short simple clues.

## 8. New scoring
Successful extraction: egg delivery +1000 · correct murderer accusation +300 · each required clue +100 (max +300) · no
monster detections +150 · no hints used +150 · time bonus max(0, 300 − floor(activeGameplaySeconds)) · each optional
hint −50 · each monster hit −75. Clamp ≥ 0. Active gameplay time excludes pauses, loading, prologue. DNF: separate
defeat log, never outranks finishers. Automatically displayed prescriptive recommendations are NOT hints — only explicit
optional Weems hints are penalised. No penalty for powers/moves. Track every component; show a short breakdown at the
end. New scoring/rules version (old scores never mix). Server-side validation incl. event evidence, hint counts,
accusation correctness, completion status.

## 9. Home-page leaderboard
Compact panel on the RIGHT of the existing home page: top 5 verified players (rank, nickname, score, optional duo),
Supabase Realtime updates, elegant highlight of the top score, "View Full Leaderboard", keep Thing logo + branding, no
overlap with logo/title/Start button, responsive incl. 1366×768, readable empty state.

## 10. Four analytics more visible DURING play (major priority)
Separate game-wide systems for every duo. **Descriptive**: HP, active abilities + cooldowns, evidence, noise, objective,
hints used, egg status — compact counters/icons/bars; duo cards show ability/strength/weakness/HP stats. **Diagnostic**:
short event-based causes ("Hyde detected your footsteps." "Crackstone spotted you." "Slurp heard the cabinet door."
"Your Pokémon blocked the attack.") only after events. **Predictive**: monster encounter probabilities by area,
estimated egg-location probabilities, Hyde detection risk from noise, Crackstone sight-risk zones, Slurp encounter risk —
compact probability map available during play; must match actual spawn rules / validated models and update when
information changes; never expose hidden answers or the culprit. **Prescriptive — Thing presents it**: "Hide. The Hyde is
approaching." "Search the eastern corridor." "Close the cabinet." "Use your Pokémon's defensive move." "Take the safer
path." — current state + available actions, rate-limited.

## 11. Principal Weems = optional hint guide
Principal Larissa Weems as a supernatural spirit guide: optional clue-location hints, evidence interpretation, mystery
guidance, progressive help. Thing keeps: mascot/logo, prologue, short prescriptive recommendations, status reactions.
Visually distinct. Small "Ask Weems" control. Progressive: 1 general search area → 2 more specific location / evidence
relationship → 3 stronger deduction guidance without revealing the culprit. Each requested hint counts toward the
penalty. Hints never mandatory. No charge for tutorial, accessibility help or Thing's advice. Ghostly portrait, subtle
effects, short dialogue.

## 12. Less text and clutter
One-line clue summaries, short objectives, small icons, clear prompts, concise analytics; never all four analytics as
large panels at once; compact HUD + optional expandable investigation info; no walking circles / excess particles;
consistent gothic style, readable contrast.

## 13. Preserve
Branding; Thing logo + prologue; 7 Nightshades; 18 Pokémon + legitimate moves; 3 randomized duo cards + slot reveal; 3
randomized case files + shuffle; Pokémon-style collectible card design; evidence + accusation; egg extraction to Iago
Tower; powers; Supabase; three-laptop setup; analytics (adapted); results + spectator dashboard. No rowing/boat.

## 14. Order + testing
1 case data/culprits/characters → 2 smaller maps → 3 hiding cabinets → 4 Slurp + encounter director → 5 death cutscenes
→ 6 scoring + verified leaderboards → 7 home leaderboard → 8 Weems hints + Thing prescriptive → 9 live analytics
visibility/accuracy → 10 polish (UI, visuals, perf, sound). Tests + real browser playtests after major changes. Verify:
3 cases solvable; Slurp/Hyde/Crackstone hunt and lose the player; cabinets vs all three; spawning never unavoidable;
cutscenes transition; all cases + both stations; new scoring + DNF excluded; home leaderboard shows verified scores;
Weems hint counts/penalties exact; Thing advice free + feasible; four analytics useful + visible; 5–7 min sessions;
build, tests, browser interactions pass. Final report: implemented, changed files, screenshots, test results, limits.
