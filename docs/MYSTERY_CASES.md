# Three cases — integration contract (rules `mystery-v4`, case content version 3; history below)

Single source of truth for the three-case feature. Shared types: `src/mystery/types.ts` (`CaseId`, `CaseDef`,
`ClueDef`, `CaseNoteDef`, `CaseSolution`, `Accusation`, `RunResult.caseId/caseVersion/evidence/deductionCorrect`).
The rules version string stays `mystery-v3.1` (the DB pins it); the case is versioned separately (`CaseDef.version`).

## Journey
Home → nickname → three random duo cards (choose one) → **case-file reveal** (the already-assigned case; 3–5 s,
skippable, reduced motion) → **Thing's case-specific prologue** → tutorial → investigation → egg → Iago Tower →
**accusation = suspect + cited evidence** (one shot) → results (case resolution) + analytics.

## Content version 3 (final 2026-10-24) — current
- Rules version `mystery-v4` (types.ts). `CaseDef.version` = `CaseSolution.version` = **3** for all three cases.
- Suspects in every case: **Marilyn Thornhill** (archivist, `thornhill`), **Françoise Galpin** (visiting historian
  restoring the crypt — a role invented for this story, `galpin`), **Barry Dort** (night guard, `barry`). Isaac Night is
  no longer a suspect: he is the roaming monster **Slurp**. Old rows keep `isaac` readable server-side (backend).
- Culprits: 01 thornhill · **02 galpin** · 03 barry. Clue ids unchanged (no `ClueId` change).
- Case 02 rewritten: `sabotaged_gate` (METHOD, names Galpin: her restoration key opened the gate lock, chain sawn) ·
  `tunnel_access_record` (OPPORTUNITY, Galpin 11:12 pm, clears Thornhill 8:40–8:55 pm) · `equipment_match` → *Restorer's
  Tool Satchel* (BROKEN ALIBI: her stamped satchel with wire saw, brass pin and tunnel clay was below although she says
  her kit was locked in the library; clears Barry, pier lantern 11:15 pm). Truth table: `docs/MYSTERY_DESIGN.md` §12.2.
- Cases 01 / 03: Galpin replaces Isaac in the clue that cleared him (01 `botanical_residue` key returned 9:05 pm;
  03 `watchtower_signal` observatory star log 11:00–11:45). 01 `access_ledger` is now kept at the Porter's Lodge.
- Compact maps moved candidate sites (`caseWorlds.ts`, design §12.4); `location` strings and first-site `roomId`s
  follow: 01 residue "Greenhouse Annex or Poison Garden", ledger "Porter's Lodge" (`path`); 02 sign-in "Tunnel office or
  side path" (`courtyard`), satchel "By the cage or tunnel bend"; 03 patrol log / console now in `path` (ravine post,
  control hut). Every clue has `shortTitle` (≤ 26), `short` (≤ 90), `meaning` (≤ 60).

| # | id | culprit (secret) | clues (candidate sites → prior) | egg (candidate sites → prior) |
|---|---|---|---|---|
| 01 | `poisoned_archive` | thornhill | falsified_transfer (archive desk .6 / stacks terminal .4), botanical_residue (greenhouse shelf .6 / Poison bed .4), access_ledger (porter's lodge 1) | potting store .5 / garden nest .3 / yard crate .2 |
| 02 | `crypt_last_witness` | galpin | sabotaged_gate (gate mechanism 1), tunnel_access_record (tunnel office .55 / side-path register .45), equipment_match (by the cage .6 / tunnel bend .4) | catacomb nest .4 / hall altar .35 / office nest .25 |
| 03 | `midnight_signal` | barry | falsified_patrol_log (ravine guard post .55 / checkpoint booth .45), alarm_override (control-hut console 1), watchtower_signal (yard recorder .6 / tower relay .4) | potting shed .5 / yard crates .3 / kennel straw .2 |

Innocents (results screen): 01 Galpin (key back 9:05 pm), Barry (east-wall card) · 02 Thornhill (out 8:55 pm), Barry
(pier 11:15 pm) · 03 Thornhill (no console clearance), Galpin (star log every five minutes).

## Content version 2 (overhaul 2026-10-23) — superseded by version 3
- `CaseDef.version` and `CaseSolution.version` are **2** for all three cases (answers, links, innocents unchanged).
- Clue and egg positions are no longer fixed: each clue has 1–2 candidate sites and the egg 3, drawn once per session
  with the priors in `src/mystery/data/caseWorlds.ts` (`CaseWorldDef`; design `docs/MYSTERY_DESIGN.md` §10). The
  session's draw is hidden truth (`run.layout`, `MapDef.clues` / `eggSpawn`).
- `ClueDef.location` reads true for every candidate site ("Greenhouse Annex or Restricted Vault"); `ClueDef.roomId` is
  the first site's room. Multi-site clues use a generic `interactLabel`. Two texts were broadened so they hold at every
  site: `equipment_match` ("stashed underground", was "by the Hyde's cage") and `watchtower_signal` ("flashed from
  beside the egg path", was "from this yard").
- **TL;DR card fields** on all 9 clues: `short` (≤ 90 chars, one plain sentence: what the evidence shows) and
  `meaning` (≤ 60 chars, the link it establishes; never a verdict). The deduction structure is unchanged: the culprit
  is named in all three `short`s; each innocent appears in exactly one clue (its `meaning` says why they are cleared).
  Case 03 `watchtower_signal` keeps naming Barry only as "the guard" in `short` / `meaning` too.
- Egg copy never names a site: `egg.objective` = "Find the egg."; `thing.findEgg` generic; `thing.whereHint` lists
  the candidate clue areas.
- Case-specific room names now also cover `egg_chamber` (Restricted Vault / Catacombs / Old Kennel) and, in Cases 01–02,
  `shortcut` / `research_room` (Rare Book Stacks; Lamp Room).
- ClueDef titles longer than the 26-char UI budget (kept, `shortTitle` requested from the orchestrator):
  `falsified_transfer` (30), `botanical_residue` (28), `access_ledger` (36).

## Cases, version 2 (superseded — see version 3 above; data: `src/mystery/data/cases.ts`, answers: `src/mystery/data/solutions.ts`)
| # | id | culprit (secret) | clues (candidate sites → prior) | egg (candidate sites → prior) |
|---|---|---|---|---|
| 01 | `poisoned_archive` | thornhill | falsified_transfer (archive desk .6 / Rare Book Stacks .4), botanical_residue (greenhouse shelf .6 / Restricted Vault .4), access_ledger (Records Crypt 1) | potting store .5 / vault shrine .3 / crypt reliquary .2 |
| 02 | `crypt_last_witness` | isaac | sabotaged_gate (crypt gate 1), tunnel_access_record (Maintenance Tunnel .55 / Lamp Room .45), equipment_match (by the cage .6 / burial-vault niche .4) | vault altar .5 / catacomb nest .3 / gatehouse .2 |
| 03 | `midnight_signal` | barry | falsified_patrol_log (guard post .55 / checkpoint booth .45), alarm_override (control room 1), watchtower_signal (yard recorder .6 / west relay .4) | potting shed .5 / yard crates .3 / old kennel .2 |

Same base island, cover, hiding spots and Hyde patrol for all cases; since v2 each case also adds its own walls,
cover and hiding spots (`CaseWorldDef.extraWalls/extraCover/extraHiding`), one lever passage, three examinable objects
and its hazards, and renames rooms (`buildIsland(caseDef)`, map id `raven_island_v31:<caseId>`, `caseMap(caseId)` in
`src/mystery/defaults.ts`). Every case is solvable with any duo and without the lever: powers may help (reveal,
scent trail), never required.

Deduction design (every case): 3 clues = METHOD, OPPORTUNITY, BROKEN ALIBI against the same person. The culprit is
named in all three clues, each innocent in exactly one (the clue that clears them). Two case-file notes are held from
the start and support nobody. `case_solved` ⇔ all 3 clues found ∧ culprit accused ∧ cited evidence == exactly the 3
clues (`caseLogic.verdictFor`). Wrong suspect or weak evidence → `egg_secured_mystery_unsolved`; no accusation →
`not_accused`. An incorrect accusation is a valid recorded outcome; there is never a second attempt.
`deductionCorrect` means only "the cited evidence is exactly the supporting set" (independent of the suspect), so the
results/analytics can tell "right suspect, weak evidence" from "wrong suspect".

## Secrecy (hard rule)
- `ClueDef` carries no guilt links (`mentions` = names in the text, neutral). The culprit, `supportingEvidence`, per-clue
  `links` (what it proves / whom it clears), innocents' explanations and the resolution live ONLY in
  `data/solutions.ts` (`CaseSolution`).
- Browser code must NEVER import `data/solutions.ts` (or `src/mystery/episode.ts`, which does) statically. The app
  loads it with `loadCaseSolution(caseId)` (`src/app/mystery/integration.ts`, dynamic import) only after the visitor
  committed the accusation (and for results). Test: `tests/unit/mystery/caseSecrecy.test.ts`.
- No UI, debug output (`render_game_to_text`), Thing line, hint, prologue or case-file reveal names a culprit or shows a
  "points to / explains" link before the accusation. The live seed is never exposed in debug output.
- Server: the Edge Functions own their copy of the answer keys (generated registry) and recompute verdict/correct/
  deductionCorrect; client claims only feed `claim_matches`. Anon/public reads never include `accused`, `evidence` or
  `client_claim` (spectators see verdict/correct aggregates, never who was accused).

## Case assignment
- One case per session, assigned when the session is created, BEFORE the duo cards; independent of the duo offer
  (never derived from the seed). Even distribution via a shuffled bag of the three ids: when the bag is empty it is
  refilled with a fresh random permutation (never starting with the case just dealt).
- LIVE: server-side, per station, inside `mystery_create_session` (row-locked bag table). Stored as
  `mystery_sessions.case_id` + `case_version`; returned in the session envelope. Refresh/restore returns the same case;
  only a NEW session (after results / reset / supersede) draws the next case. `testCase` body field only when
  `MYSTERY_ALLOW_TEST_SEEDS=true`.
- LOCAL DEMO: `src/app/mystery/caseBag.ts` (crypto entropy, bag in `localStorage['raven.mystery.caseBag']`), case
  stored in the session; a session whose run ended is closed, so a refresh never re-opens a finished case.
- Dev/operator: `/?mode=mystery&case=<caseId>` forces a case for that ephemeral (never persisted) session.

## Wire / DB additions (backend)
- `mystery_sessions`: `case_id text not null` (check ∈ 3 ids), `case_version smallint not null`.
- New `mystery_case_bags(station_id pk, bag text[], last_case text, updated_at)`; service-role only.
- Clue CHECKs widened to the 9 clue ids of `CLUE_IDS` (legacy rows keep their old ids valid: allow both sets).
- `mystery_results`: `case_id`, `case_version`, `evidence text[]`, `deduction_correct bool`; `case_solved ⇒ correct ∧
  deduction_correct ∧ 3 clues`. Views/standings gain `case_id`; public views drop `accused`; anon cannot select
  `accused`, `evidence`, `client_claim`.
- Session envelope / `MysterySessionView`: `caseId`, `caseVersion`. Result view: `caseId`, `caseVersion`, `evidence`,
  `deductionCorrect`. Finalize response also carries `reveal: { culprit, resolution } | null` (post-accusation only).
- Accusation event payload: `{ suspectId, correct, cluesFound, evidence: string[] (≤ 5), deductionCorrect }`; the
  server sanitises `evidence` to citable ids (found clues + case notes) and ignores the client's `correct`.

## Analytics
All four layers + the dashboard are case-aware: `caseId` in telemetry meta, session record, dataset rows, episodes and
results; descriptive/diagnostic aggregates per case and combined (clue-find rates per case, solve accuracy,
completion time, extraction rate); prescriptive copy from the case (egg location, room names); predictive features
normalise clues by the case's clue count; the model is retrained on episodes of all three cases. No analytics depends
on Wednesday's power; Thing is only the messenger.

## Ownership for this feature
| owner | files |
|---|---|
| orchestrator | `src/mystery/types.ts`, `src/mystery/data/{cases,solutions,island,thing}.ts`, `src/mystery/{caseLogic,defaults,run,bot,episode}.ts`, `src/app/mystery/{flow,session,caseBag,MysteryApp,PlayView,useMysteryLoop,hudModel,thingLines,prologue,integration,runTypes,records}.ts(x)`, `src/app/audio.ts`, `src/ui/mystery/{ThingPrologue,PrologueScenes}.tsx`, this doc |
| game-developer | `tests/unit/mystery/**` (incl. new case tests), `docs/MYSTERY_DESIGN.md` §4b; may adjust ONLY `placements` / `egg` coordinates in `cases.ts` if a spot is unreachable |
| backend-architect | `supabase/**`, `scripts/sync-shared.mjs`, `src/lib/supabase/**`, `src/app/mystery/{liveRun,liveContext,liveStation}.ts(x)`, `tests/integration/**`, `docs/SUPABASE_SETUP.md` |
| frontend-developer | `src/ui/mystery/{CaseReveal,EvidenceBoard,MysteryResults}.tsx` (+ new UI files), `src/ui/styles/{caseReveal,mystery}.css`, `tests/unit/mystery-app/screens.test.ts`, `tests/e2e/**` except `mystery-prologue.mjs` |
| 3d-artist | `src/three/mystery/**`, `tools/mystery-preview.*` |
| analytics (fullstack-developer) | `src/mystery/analytics/**`, `scripts/mystery-*.ts`, `tests/unit/mystery-analytics/**`, `docs/MYSTERY_MODEL_REPORT.md`, dashboards: `src/ui/mystery/{MysteryDashboard,LayerPanels}.tsx`, `src/app/mystery/{MysteryDashboardApp,liveDashboard}.tsx` |
