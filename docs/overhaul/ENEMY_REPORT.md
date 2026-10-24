# Enemy report — Joseph Crackstone + Hyde visual overhaul (2026-10-24)

Contract: `docs/overhaul/ENEMY_CONTRACT.md` · UX spec: `docs/overhaul/UX_ENEMIES.md` · decision D-43 ·
agents/skills: `docs/AGENT_SKILL_LOG.md` (section "Enemy addition") · references: `docs/overhaul/refs/`.
Built on the uncommitted overhaul tree (HEAD 2842ec1; backup `D:\PokemonDay-cache\backups\pre-enemy-20261024-0532.tgz`).
Nothing was committed or deployed.

## 1. What changed
**Joseph Crackstone (second enemy, sight-based)** — per-case data (`CaseWorldDef.crackstone`):
| Case | Cursed area | Patrol | Presence |
|---|---|---|---|
| 01 The Poisoned Archive | Archive Stacks (archive bookshelves + dead-end stacks) | 8 waypoints, ~41 s lap, leash 16 m | standard |
| 02 The Crypt's Last Witness | Crypt Catacombs (lower hall + four catacomb pillars) | 12 waypoints, ~86 s lap, leash 25 m | stronger: scan every 20 s, sight × 1.15 |
| 03 The Midnight Signal | Restricted Yard (watchtower yard hut + crates) | 5 waypoints, ~46 s lap, leash 17 m | scan every 28 s, sight × 0.9 |

States `PATROL → INVESTIGATE → CHASE → ATTACK → SEARCH → RETURN`. Deaf; detects by sight (cone 90°, 14 m, fog 9 m,
crouching 0.6×; walls and high cover block, hiding spots hide), proximity (2.5 m all round, line of sight required) and a
telegraphed 360° **scan** (2.2 s warning, 10 m, walls and hiding spots block, crouching does not). Attack = telegraphed
**curse circle** (1.8 m, 1.4 s wind-up, 15 HP × catch-damage mod + 2.5 s slow; not a catch; `block_grab` blocks it).
Chase 3.5 m/s (walk 3.2 < chase < slowest sprint 4.22), leashed to his area, yields to a chasing Hyde (no simultaneous
chases), never walks through walls (shared nav + collision code with the Hyde, `src/mystery/enemyNav.ts`).

**Hyde** — behaviour unchanged (22 pre-change log hashes still byte-identical); 3D model rebuilt from the statue photos
(`src/three/mystery/hydeBeast.ts`): high-hip arched stance, hump, ribcage/spine, long arms with oversized claws planted
ahead, bulging eyes in sockets, O-scream face; IK crawl / gallop / lunge / listen; 5,999 triangles, 2 draw calls.

**Abilities (effect-kind based, R8)** — stun / slow / distract / power-switch fallback hit every enemy in reach; Psychic
Vision, Bee Swarm and Chandelure's reveal also reveal enemies; Premonition shows both paths; lures pull Crackstone within
20 m of the decoy; King's Shield–type blocks also stop a curse. No move was renamed.

**Analytics** — descriptive (encounters, detections by sight/proximity/scan, escapes, scans, curses cast/hit/dodged,
"Curses dodged %" KPI), diagnostic (rule causes for each detection and escape), predictive (rule-based Crackstone risk
map + odds row, labelled "Rule-based estimate"; Hyde model re-evaluated), prescriptive (take cover, leave the curse ring,
break line of sight, avoid his area, a power that can hit him now). His position is only used/shown while the player
could know it (seen, chasing/attacking, revealed) — source-scan + behavioural tests.

**HUD / audio / board** — Crackstone plaque (witch-light green, squared, double border when hunting), exposure-aware
scan/curse banners ("Crouching won't help"), CURSED vitals row, minimap cursed area + stipple risk + curse circle + hat
marker per R4, compass markers, one threat-edge chevron, odds row, CRACKSTONE ThingStack cards, six synthesized cues
(knell, chant, pulse, curseCast, curseHit, curseFizzle) and a drone crossfade, spectator chip + "Curses dodged" KPI.
Screen overlay tint/edge glow is now green for Crackstone (red stays reserved for the Hyde).

**Server** — additive migration `supabase/migrations/20261024000100_mystery_crackstone.sql` (event types, rule index,
forecast target `crackstone_risk`); `curse` is a rule event; the server now checks that an `hp_depleted` DNF really lost
≥ 100 HP (catch + curse), which it did not check before.

## 2. Evidence (orchestrator re-runs on the final tree)
| Check | Result |
|---|---|
| `npx tsc --noEmit` / `npm run typecheck:functions` | 0 errors / 0 errors |
| Full `npx vitest run` | 80 files, **1761 / 1761** |
| Supabase unit (incl. sim-contract replaying real Crackstone episodes through the server parser) | **104 / 104** |
| pgTAP (PGlite) | all 8 files pass (008 Crackstone 33/33, migration idempotent) |
| Engine ↔ DB round trip | PASSED — 150 sessions incl. 14 curse deaths, 48 `crackstone_risk` forecasts, 33,121 assertions |
| `npm run build` | OK, no warnings |
| Patrol loops on the real nav grid (`output/enemy-check-routes.ts`) | ROUTES OK — every waypoint + segment walkable, ≥ 55 m from the pier, ≥ 22 m from the tower |
| Browser acceptance (`output/overhaul-acceptance.mjs`, real keys) | A: 15 abilities fire, 10 targeted ones correctly decline with no enemy in reach (= overhaul baseline); B: **6/6 full runs case_solved** (3 cases × 2 duos, 128–224 s active, 0 catches), 0 console errors |
| e2e `mystery-cases`, `mystery-prologue` | all parts passed (3 cases reveal → prologue → tutorial → accusation; skip / reduced motion / layouts 1366, 1920, 360; prologue A–D) |
| Bots, 126 duos × 3 cases | finish 126 / 121 / 126 (before 126 / 124 / 126); median active 156.4 / 150.9 / 128.1 s (before 148.2 / 143.1 / 125.7); curses landed 1 / 0 / 0 of 313 / 257 / 60 cast |
| Perf (Intel UHD, 1366×768) | 1× CPU: 60 fps before and after; preview with both enemies + scan ring + curse circle 2.2 / 2.7 / 2.6 ms per case at 50–58 draw calls; transparent-material re-validation 4–5/frame → 0 (`forceSinglePass`); low graphics frontend JS −39 % |

**Analytics honesty.** Crackstone risk (236 held-out sessions, 2.16 M cell forecasts): Brier 0.126 vs static patrol
0.165, area rate 0.188, constant 0.208; over-confident in the top bin (0.97 predicted vs 0.88 observed). At the player's
own cell it does NOT beat the in/out-of-area rate (0.0548 vs 0.0534) — reported as such. Hyde detection model kept
(Brier 0.0819 vs baseline 0.1122, AUC 0.857 on regenerated episodes; a retrain was not better). Details:
`docs/MYSTERY_MODEL_REPORT.md` §7.

**Visual likeness.** `output/enemies/hyde-vs-reference.png`, `output/enemies/crackstone-vs-reference.png` (three review
rounds; final: Hyde silhouette matches photos 1/2/4/5, face matches 3; Crackstone hat/cloak/staff/palette match the
illustration). Remaining gap: no sinew surface detail at the triangle budget; the scene's purple light gives the Hyde a
lavender cast. HUD checklist screenshots: `output/enemies/hud/` (all 15 UX items ✓).

## 3. Code review (code-review skill, medium) and outcome
Fixed by the orchestrator: lure ignored `lureBreaksChase` for Crackstone; risk-table cache kept a whole finished
MysteryRun alive per entry (kiosk memory over a day) → cached copies are now detached; cache key missed inputs → keyed on
the full tuning + definition; empty patrol would crash the forecast → guarded; PETRIFIED shown for a pin and no timer for
a held slow (same pre-existing quirk on the Hyde chip) → "PINNED" / correct timer for both enemies; three centroid copies
→ one; dead code. Judged not a bug: the bot's scan dodge uses his position only when it is "exposed", which requires his
line of sight within 10 m — i.e. the player can see him too. Accepted limitation: a lure that redirects him while he is
already investigating does not refocus the risk map until his next mode change (≤ 10 s).

## 4. Known limits / to watch
- Case 02 bots: 5 DNFs (test limit 6), all Hyde second catches — little headroom if anything is retuned.
- Bots (which ignore him) suffer ~4 Crackstone chases per run in Case 01; real players who avoid his sight will see far
  fewer — worth watching in a human playtest. Human pacing (5–7 min) is not yet measured with real visitors.
- Off-screen companion sometimes fills the lower-left foreground (pre-existing overhaul behaviour).

## 5. Deploy order (BLOCKING before a kiosk runs this build live)
The hosted server has the overhaul only. This client emits Crackstone events and uploads `crackstone_risk` forecasts,
which the current server REJECTS (422 EVENT_REJECTED → runs unverified). Order (docs/SUPABASE_SETUP.md §12.8):
1. `npx supabase db push --linked` (dry run must list only `20261024000100`);
2. redeploy all six mystery functions in one command;
3. publish the frontend and hard-reload every laptop. LOCAL DEMO (no network) works without any of this.
