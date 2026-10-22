# Three cases — integration contract (rules `mystery-v3.1`, case system v1)

Single source of truth for the three-case feature. Shared types: `src/mystery/types.ts` (`CaseId`, `CaseDef`,
`ClueDef`, `CaseNoteDef`, `CaseSolution`, `Accusation`, `RunResult.caseId/caseVersion/evidence/deductionCorrect`).
The rules version string stays `mystery-v3.1` (the DB pins it); the case is versioned separately (`CaseDef.version`).

## Journey
Home → nickname → three random duo cards (choose one) → **case-file reveal** (the already-assigned case; 3–5 s,
skippable, reduced motion) → **Thing's case-specific prologue** → tutorial → investigation → egg → Iago Tower →
**accusation = suspect + cited evidence** (one shot) → results (case resolution) + analytics.

## Cases (data: `src/mystery/data/cases.ts`, answers: `src/mystery/data/solutions.ts`)
| # | id | culprit (secret) | clues | egg |
|---|---|---|---|---|
| 01 | `poisoned_archive` | thornhill | falsified_transfer (research_room), botanical_residue (greenhouse terrace, room `path`), access_ledger (crypt) | egg_chamber shrine |
| 02 | `crypt_last_witness` | isaac | sabotaged_gate (crypt), tunnel_access_record (shortcut = Maintenance Tunnel), equipment_match (egg_chamber) | crypt burial vault |
| 03 | `midnight_signal` | barry | falsified_patrol_log (shortcut = Guard Post Passage), alarm_override (research_room = Security Control Room), watchtower_signal (courtyard) | greenhouse potting shed |

Same island, walls, cover, hiding spots and Hyde patrol for all cases; a case moves its 3 clues + the egg and renames
rooms (`buildIsland(caseDef)`, map id `raven_island_v31:<caseId>`, `caseMap(caseId)` in `src/mystery/defaults.ts`).
Every case is solvable with any duo: powers may help (reveal, scent trail), never required.

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
