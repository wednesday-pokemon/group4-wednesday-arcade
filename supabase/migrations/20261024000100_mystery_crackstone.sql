-- Joseph Crackstone, the second (sight-based) enemy (2026-10-24, docs/overhaul/ENEMY_CONTRACT.md "Server"). ADDITIVE on
-- top of 20261021000500..800 + 20261022000100 + 20261023000100: no table, column, row, RPC or view is dropped or
-- changed; two CHECK constraints are replaced by strict SUPERSETS of themselves (the ADD re-validates every existing row)
-- and one partial index is rebuilt with one more type. Safe to re-run (IF EXISTS everywhere).
--
--   * mystery_events.type: + 'crackstone_mode', 'crackstone_sighted', 'crackstone_lost', 'crackstone_scan' (TELEMETRY,
--     analytics only) and 'curse' (a RULE event: rule R7, a landed curse costs HP — it can end a run as a dnf
--     'hp_depleted' — but it is NOT a catch and never touches the egg). Payloads (enums, booleans, finite bounded
--     numbers: distanceM ≤ 1000, scan radiusM ≤ 100, curse hpLost ≤ 100 and 0 unless phase = 'hit' and not blocked)
--     are validated by the Edge Function (_shared/mystery-events.ts) before they reach this table.
--   * mystery_events_rule_idx (partial index of the rule events finalize re-reads): + 'curse'. finalize replays every
--     rule event; without 'curse' in RULE_EVENT_TYPES its HP accounting (ruleFingerprint) would disagree with the
--     append-time progress. The index is a performance aid only (correctness comes from the Edge Function's filter).
--   * mystery_forecasts.target: + 'crackstone_risk' (rule-based P(Crackstone sees / scans the player within the
--     horizon)). A probability: the existing mystery_forecasts_probability_check (target = 'eta_s' or value between
--     0 and 1) already covers it.
--
-- Unchanged on purpose: RLS policies, grants, column privileges, the Realtime publication, every RPC (the append RPC
-- stores any CHECK-valid type; mystery_sessions.catches / sightings keep counting only 'catch' / 'hyde_sighted' — a
-- curse is not a catch and a Crackstone sighting is not a Hyde sighting), mystery_results (HP is not a result column),
-- the single-terminal / accusation / delivery backstops. Crackstone telemetry rows are as private as every event row:
-- no anon access, a station reads only its own sessions, the operator reads all.
-- Keep-in-sync lists: MYSTERY_EVENT_TYPES / RULE_EVENT_TYPES (_shared/mystery-events.ts) and FORECAST_TARGETS
-- (_shared/mystery-validation.ts); supabase/tests/unit/mystery-overhaul.test.ts fails if this file drifts from them.
-- Deploy order: after 20261023000100, BEFORE (or together with) redeploying the functions that bundle _shared
-- (docs/SUPABASE_SETUP.md §12.8).

alter table public.mystery_events
  drop constraint if exists mystery_events_type_check,
  add constraint mystery_events_type_check check (type in (
    'noise', 'stance', 'room_enter', 'hyde_mode', 'hyde_heard', 'hyde_sighted', 'hyde_lost', 'catch',
    'clue_search_start', 'clue_found', 'egg_pickup', 'egg_drop', 'egg_damage', 'egg_delivered',
    'ability_used', 'ability_denied', 'hint_requested',
    'hyde_emerged', 'site_checked', 'trace_found', 'examined', 'passage_opened', 'hazard_triggered',
    'crackstone_mode', 'crackstone_sighted', 'crackstone_lost', 'crackstone_scan', 'curse',
    'accusation', 'finish', 'dnf'));

drop index if exists public.mystery_events_rule_idx;
create index mystery_events_rule_idx on public.mystery_events (session_id, seq) where type in (
  'catch', 'clue_found', 'egg_pickup', 'egg_drop', 'egg_damage', 'egg_delivered', 'accusation', 'finish', 'dnf',
  'hyde_sighted', 'hint_requested', 'curse');

alter table public.mystery_forecasts
  drop constraint if exists mystery_forecasts_target_check,
  add constraint mystery_forecasts_target_check check (target in (
    'detection_15s', 'extraction', 'eta_s',
    'egg_site', 'clue_area', 'hyde_zone', 'hyde_spawn',
    'crackstone_risk'));

comment on column public.mystery_events.type is
  'GameEvent type. Rule events (catch, clue_found, egg_*, accusation, finish, dnf, hyde_sighted, hint_requested, curse) '
  'drive the server result; everything else (incl. the overhaul telemetry hyde_emerged, site_checked, trace_found, '
  'examined, passage_opened, hazard_triggered and the Crackstone telemetry crackstone_mode, crackstone_sighted, '
  'crackstone_lost, crackstone_scan) is analytics-only. A curse hit costs HP (can cause dnf hp_depleted), never a catch.';
comment on column public.mystery_forecasts.target is
  'detection_15s | extraction | eta_s (seconds) | egg_site | clue_area | hyde_zone | hyde_spawn | crackstone_risk. '
  'Probabilities except eta_s. Overhaul targets: the probability of one candidate, its id in features (site | area | '
  'zone | spawn). crackstone_risk: rule-based P(Joseph Crackstone sees or scans the player within the horizon).';
