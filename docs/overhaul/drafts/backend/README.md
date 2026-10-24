# Backend drafts: Joseph Crackstone (backend-architect, 2026-10-24)

Status: **APPLIED to the repo on 2026-10-24** (after the orchestrator confirmed that the owner's overhaul deploy was done).
**NOT DEPLOYED.** This folder records exactly what was applied. Each file here mirrors its target path and is
byte-identical to the applied file.

## Files (target path = path below `docs/overhaul/drafts/backend/`)

| File | Kind |
|---|---|
| `supabase/migrations/20261024000100_mystery_crackstone.sql` | new (additive, re-runnable) |
| `supabase/functions/_shared/mystery-events.ts` | modified: 5 event types, Crackstone enums, `curse` rule event, `curses` + HP in fingerprint, hp_depleted check |
| `supabase/functions/_shared/mystery-rules.ts` | modified: `PLAYER_MAX_HP`, `rulesContext(..., maxHp)` |
| `supabase/functions/_shared/mystery-validation.ts` | modified: `FORECAST_TARGETS` + `crackstone_risk` |
| `supabase/tests/008_mystery_crackstone.test.sql` | new pgTAP (33 assertions) |
| `supabase/tests/unit/mystery-crackstone.test.ts` | new unit tests (13) |
| `supabase/tests/unit/mystery-overhaul.test.ts` | modified drift guards |
| `supabase/tests/unit/mystery-sim-contract.test.ts` | modified: hand-built Crackstone/curse stream incl. curse DNF |
| `supabase/tests/offline/mystery-roundtrip.ts` | modified: Crackstone telemetry, curses, curse deaths, RULE_TYPES from `RULE_EVENT_TYPES` |

Docs edited in place (not mirrored here): `docs/SUPABASE_SETUP.md` §12.2 + new §12.8, `docs/SECURITY.md` §7 scope + new §7.8.

## Apply steps (already done; how to repeat them)

```bash
cp -r docs/overhaul/drafts/backend/supabase/. supabase/
npm run sync:shared            # copies the Crackstone types.ts into _shared/mystery (re-run if a data file is half-edited)
npm run typecheck:functions
npm run test:supabase-unit     # 7 files, 104 tests
npm run test:db:offline        # 8 pgTAP files, 008 = 33/33
npm run test:db:roundtrip
```

## Deploy (owner, later): `docs/SUPABASE_SETUP.md` §12.8

`db push` (only 20261024000100) → all six functions in ONE `functions deploy` → Crackstone frontend → hard-reload
every laptop. A Crackstone client against the current (overhaul) server gets `422 EVENT_REJECTED: type` → unverified runs.
