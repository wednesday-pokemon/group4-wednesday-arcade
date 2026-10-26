# Code Review Log (code-reviewer skill, per phase gate)

The skill's bundled `code_quality_checker.py` was executed but is a stub that reports 0 findings for any input, so it
provides no evidence; every gate below was reviewed manually by the orchestrator against `references/code_review_checklist.md`
themes (correctness, security, error handling, tests, maintainability).

## Gate 1 — deterministic gameplay (src/game)
Reviewed: `rules.ts` (all 565 lines), `random.ts`, `constants.ts`, `session.ts`, test inventory.

| # | Severity | Finding | Status |
|---|---|---|---|
| G1-1 | ✔ | Guards run in a fixed order (closed → stale revision → wrong phase → input → stamina/egg) and never mutate state. | OK |
| G1-2 | ✔ | Resolve uses the weather/offer locked at prepare (`prepared.*`), so a client cannot swap contexts between steps. | OK |
| G1-3 | ✔ | Crash resolved before gap; gap deltas each recorded once with `negatedBy`; Decidueye only negates *un-negated* negatives. | OK |
| G1-4 | ✔ | Hyde risk computed in integer basis points (exact), clamp after Froslass; one catch max; second catch → DNF with no penalties (D-13). | OK |
| G1-5 | ✔ | Time breakdown in integer centiseconds; waterfall reconstruction verified over 300 simulated races (tests/unit/analytics). | OK |
| G1-6 | minor | Froslass event message is emitted even when the risk was already 0 (cosmetic). | Accepted |
| G1-7 | ✔ | `abandonSession` is a no-op on terminal sessions — prevents un-finishing a completed race. | OK |

Evidence: `npx vitest run tests/unit` → 9 files, 605 tests passed (game 591 + analytics 14).

## Gate 2 — 3D scene (src/three) — spot review
* Viewed harness screenshots (idle leg 1 clear, crash+catch mid-cinematic): boat, Hyde and lanterns readable; 21–31 draw calls, ~28k tris.
* Fixed: `RaceScene.ts` read `resolution.draws.crash` for cosmetic rock rotation → would crash on live sessions where draws are null (D-20). Now falls back to a leg-derived value.
* Open (minor): shortcut corridor foreground rocks can briefly occlude the boat; no unit tests for the pure `timeline.ts`.

## Gate 4 — Supabase (supabase/**) — security review (senior-backend + code-reviewer)
| # | Severity | Finding | Status |
|---|---|---|---|
| G4-1 | HIGH | Non-cryptographic keyed RNG let revealed draws predict future rolls (found by backend-architect). | FIXED (D-19) + redaction kept (D-20) |
| G4-2 | ✔ | Service-role key read only from Edge runtime env (`_shared/db.ts`); grep of `src/**` finds no `service_role`. | OK |
| G4-3 | ✔ | Realtime publication contains only `station_status` and `leaderboard_entries` (sanitised projections). | OK |
| G4-4 | ✔ | anon/authenticated have SELECT-only grants; no INSERT/UPDATE/DELETE policies; all writes via SECURITY DEFINER RPCs callable by service_role only. | OK |
| G4-5 | ✔ | Every RPC locks station row then session row (deadlock-safe); idempotent receipts unique(session_id, action_id); leaderboard insert-once + immutable trigger. | OK |
| G4-6 | info | Not executable here: hosted Auth/PostgREST/Realtime/Deno runtime. Verified substitutes: PGlite pgTAP 152 assertions, engine↔DB round trip 31,353 assertions (300 races), 17 unit tests, functions typecheck. | Documented |
