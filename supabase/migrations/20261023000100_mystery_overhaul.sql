-- Gameplay / analytics overhaul (2026-10-23, docs/overhaul/OVERHAUL_CONTRACT.md). ADDITIVE on top of
-- 20261021000500..800 + 20261022000100: no table, column, row or view is dropped; two CHECK constraints are replaced by
-- strict SUPERSETS of themselves (every existing row stays valid, the ADD re-validates them).
--
--   * mystery_events.type: + the six overhaul TELEMETRY types (hyde_emerged, site_checked, trace_found, examined,
--     passage_opened, hazard_triggered). They are not rule events: mystery_events_rule_idx, the single-terminal /
--     accusation / delivery backstops and every RPC stay unchanged. Their payloads (ids ^[a-z][a-z0-9_]{0,39}$,
--     booleans, bounded finite numbers) are validated by the Edge Function (_shared/mystery-events.ts) before they
--     reach this table; noise source 'hazard' lives inside the payload (no SQL CHECK on payload contents).
--   * mystery_forecasts.target: + 'egg_site', 'clue_area', 'hyde_zone', 'hyde_spawn' (live Bayesian / zone-filter
--     estimates; each row is the probability of one candidate, whose id rides in `features`). All four are
--     probabilities: the existing mystery_forecasts_probability_check (target = 'eta_s' or value between 0 and 1)
--     already covers them.
--
-- Nothing else changes: RLS, grants, column privileges, Realtime publication, RPCs, views. Clue / egg POSITIONS are
-- never stored server-side (the per-session layout is drawn by the browser sim from the seed); case content versions
-- (CaseDef/CaseSolution v2) live in the Edge Functions' generated registry, not in SQL (case_version is 1..9999).
-- The keep-in-sync lists: MYSTERY_EVENT_TYPES (_shared/mystery-events.ts) and FORECAST_TARGETS
-- (_shared/mystery-validation.ts); supabase/tests/unit/mystery-overhaul.test.ts fails if this file drifts from them.

alter table public.mystery_events
  drop constraint mystery_events_type_check,
  add constraint mystery_events_type_check check (type in (
    'noise', 'stance', 'room_enter', 'hyde_mode', 'hyde_heard', 'hyde_sighted', 'hyde_lost', 'catch',
    'clue_search_start', 'clue_found', 'egg_pickup', 'egg_drop', 'egg_damage', 'egg_delivered',
    'ability_used', 'ability_denied', 'hint_requested',
    'hyde_emerged', 'site_checked', 'trace_found', 'examined', 'passage_opened', 'hazard_triggered',
    'accusation', 'finish', 'dnf'));

alter table public.mystery_forecasts
  drop constraint mystery_forecasts_target_check,
  add constraint mystery_forecasts_target_check check (target in (
    'detection_15s', 'extraction', 'eta_s',
    'egg_site', 'clue_area', 'hyde_zone', 'hyde_spawn'));

comment on column public.mystery_events.type is
  'GameEvent type. Rule events (catch, clue_found, egg_*, accusation, finish, dnf, hyde_sighted, hint_requested) drive '
  'the server result; everything else (incl. the overhaul telemetry hyde_emerged, site_checked, trace_found, examined, '
  'passage_opened, hazard_triggered) is analytics-only.';
comment on column public.mystery_forecasts.target is
  'detection_15s | extraction | eta_s (seconds) | egg_site | clue_area | hyde_zone | hyde_spawn. Probabilities except '
  'eta_s. Overhaul targets: the probability of one candidate, its id in features (site | area | zone | spawn).';
