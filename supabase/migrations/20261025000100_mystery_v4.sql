-- Final wave (2026-10-24, docs/final/FINAL_CONTRACT.md §1, §2, §4, §10): rules `mystery-v4` (new scoring), Françoise
-- Galpin as a suspect, the encounter director / Slurp / cabinet events and the home-page top-5 leaderboard. ADDITIVE on
-- top of 20261021000500..800 + 20261022000100 + 20261023000100 + 20261024000100: no table, column, row or v3.1 view is
-- dropped; every replaced CHECK is a strict SUPERSET of its previous definition (the ADD re-validates every existing row);
-- one partial index is rebuilt with two more types; two RPCs are redefined (create: + p_rules_version with a v3.1 default;
-- finalize: + the four v4 result columns). Safe to re-run (IF EXISTS / OR REPLACE everywhere).
--
--   * rules_version: sessions + results accept 'mystery-v3.1' AND 'mystery-v4'. mystery_create_session takes
--     p_rules_version (default 'mystery-v3.1', so the PREVIOUS function bundle keeps creating v3.1 sessions until the new
--     bundle is deployed; the new mystery-create-session passes MYSTERY_RULES_VERSION = 'mystery-v4').
--   * mystery_results.accused: + 'galpin' (Case 02's culprit); 'isaac' stays valid for v3.1 rows (he is now Slurp).
--   * mystery_events.type: + 'enemy_spawned', 'enemy_despawned', 'slurp_mode', 'cabinet' (TELEMETRY, analytics only) and
--     'enemy_detected', 'enemy_hit' (RULE events: the v4 score counts them). hint_requested was already a rule event.
--     mystery_events_rule_idx gains the two new rule types.
--   * mystery_forecasts.target: + 'slurp_risk', 'enemy_spawn' (probabilities; the probability CHECK already covers them).
--   * mystery_results gains (nullable, no default -> catalog-only ADD, the immutability trigger never fires):
--       detections int, hits int           v4: required (>= 0); v3.1 rows: null (never tracked)
--       defeated_by text                   DNF only: 'hyde' | 'crackstone' | 'slurp' | null
--       score_breakdown jsonb              v4 finishers: the nine ScoreBreakdown parts; DNF / v3.1: null
--     A v4 finisher's breakdown must equal the contract formula recomputed from the row's own columns, and score = total:
--       delivery 1000 + accusation (300 if correct) + clues 100 × min(clue_count, 3) + noDetection (150 if detections = 0)
--       + noHints (150 if hints_used = 0) + timeBonus max(0, 300 − floor(active_time_s)) − 50 × hints_used − 75 × hits,
--       total = max(0, sum). The v3.1 formula (score = egg_points × 100 − active_time_s) now applies to v3.1 rows only.
--   * Views (security_invoker, v3.1 views untouched and still v3.1-only): mystery_leaderboard_v4, mystery_defeated_v4,
--     mystery_standings_v4 and the narrow home-page feed mystery_top5 (rank, nickname, score, duo, case, finalized_at).
--     None of them exposes seed, accused, evidence, client_claim or any answer key.
--   * Column grants: anon / authenticated may read the four new mystery_results columns (needed by the invoker views and
--     by Realtime postgres_changes on mystery_results, which is already published). accused / evidence / client_claim stay
--     operator-only.
-- Keep-in-sync lists: MYSTERY_EVENT_TYPES / RULE_EVENT_TYPES (_shared/mystery-events.ts), SUSPECT_IDS / ENEMY_IDS
-- (src/mystery/types.ts); supabase/tests/unit/mystery-v4.test.ts fails if this file drifts from them.
-- Deploy order: `supabase db push` FIRST, then all mystery-* functions in one command, then hard-reload every laptop
-- (docs/SUPABASE_SETUP.md §12.9). No session may be open across the switch (the case versions change too).

-- ---------------------------------------------------------------------------------------------
-- rules_version (supersets)
-- ---------------------------------------------------------------------------------------------
alter table public.mystery_sessions
  drop constraint if exists mystery_sessions_rules_version_check,
  add constraint mystery_sessions_rules_version_check check (rules_version in ('mystery-v3.1', 'mystery-v4'));
alter table public.mystery_results
  drop constraint if exists mystery_results_rules_version_check,
  add constraint mystery_results_rules_version_check check (rules_version in ('mystery-v3.1', 'mystery-v4'));

-- ---------------------------------------------------------------------------------------------
-- Suspects (superset: + galpin; isaac kept for v3.1 rows)
-- ---------------------------------------------------------------------------------------------
alter table public.mystery_results
  drop constraint if exists mystery_results_accused_check,
  add constraint mystery_results_accused_check check (accused in ('thornhill', 'isaac', 'barry', 'galpin'));

-- ---------------------------------------------------------------------------------------------
-- Event types (superset) + rule-event index
-- ---------------------------------------------------------------------------------------------
alter table public.mystery_events
  drop constraint if exists mystery_events_type_check,
  add constraint mystery_events_type_check check (type in (
    'noise', 'stance', 'room_enter', 'hyde_mode', 'hyde_heard', 'hyde_sighted', 'hyde_lost', 'catch',
    'clue_search_start', 'clue_found', 'egg_pickup', 'egg_drop', 'egg_damage', 'egg_delivered',
    'ability_used', 'ability_denied', 'hint_requested',
    'hyde_emerged', 'site_checked', 'trace_found', 'examined', 'passage_opened', 'hazard_triggered',
    'crackstone_mode', 'crackstone_sighted', 'crackstone_lost', 'crackstone_scan', 'curse',
    'enemy_spawned', 'enemy_despawned', 'enemy_detected', 'enemy_hit', 'slurp_mode', 'cabinet',
    'accusation', 'finish', 'dnf'));

drop index if exists public.mystery_events_rule_idx;
create index mystery_events_rule_idx on public.mystery_events (session_id, seq) where type in (
  'catch', 'clue_found', 'egg_pickup', 'egg_drop', 'egg_damage', 'egg_delivered', 'accusation', 'finish', 'dnf',
  'hyde_sighted', 'hint_requested', 'curse', 'enemy_detected', 'enemy_hit');

-- ---------------------------------------------------------------------------------------------
-- Forecast targets (superset): + slurp_risk (rule-based P(Slurp finds the player within the horizon); features
-- {enemy:'slurp', zone?/cell?}) and enemy_spawn (the director's exact spawn probability of one spawn of an INACTIVE enemy;
-- features {enemy, spawn, area}). Both are probabilities: mystery_forecasts_probability_check (target = 'eta_s' or value
-- between 0 and 1) already covers them.
-- ---------------------------------------------------------------------------------------------
alter table public.mystery_forecasts
  drop constraint if exists mystery_forecasts_target_check,
  add constraint mystery_forecasts_target_check check (target in (
    'detection_15s', 'extraction', 'eta_s',
    'egg_site', 'clue_area', 'hyde_zone', 'hyde_spawn',
    'crackstone_risk',
    'slurp_risk', 'enemy_spawn'));

comment on column public.mystery_forecasts.target is
  'detection_15s | extraction | eta_s (seconds) | egg_site | clue_area | hyde_zone | hyde_spawn | crackstone_risk | '
  'slurp_risk | enemy_spawn. Probabilities except eta_s. One candidate per row, its id in features (site | area | zone | '
  'spawn; enemy_spawn also names the enemy). slurp_risk / crackstone_risk: rule-based risk estimates.';

comment on column public.mystery_events.type is
  'GameEvent type. Rule events (catch, clue_found, egg_*, accusation, finish, dnf, hyde_sighted, hint_requested, curse, '
  'enemy_detected, enemy_hit) drive the server result; everything else (overhaul telemetry, Crackstone telemetry, '
  'enemy_spawned, enemy_despawned, slurp_mode, cabinet) is analytics-only.';

-- ---------------------------------------------------------------------------------------------
-- Results: v4 columns
-- ---------------------------------------------------------------------------------------------
alter table public.mystery_results
  add column if not exists detections integer null,
  add column if not exists hits integer null,
  add column if not exists defeated_by text null,
  add column if not exists score_breakdown jsonb null;

alter table public.mystery_results
  drop constraint if exists mystery_results_detections_check,
  add constraint mystery_results_detections_check check (detections is null or detections between 0 and 100000),
  drop constraint if exists mystery_results_hits_check,
  add constraint mystery_results_hits_check check (hits is null or hits between 0 and 100000),
  drop constraint if exists mystery_results_defeated_by_check,
  add constraint mystery_results_defeated_by_check check (
    defeated_by is null or (outcome = 'dnf' and defeated_by in ('hyde', 'crackstone', 'slurp'))),
  drop constraint if exists mystery_results_score_breakdown_check,
  add constraint mystery_results_score_breakdown_check check (score_breakdown is null or jsonb_typeof(score_breakdown) = 'object');

-- The v3.1 score formula now binds v3.1 rows only (superset: every existing row is v3.1 and still satisfies it).
alter table public.mystery_results
  drop constraint if exists mystery_results_finished_check,
  add constraint mystery_results_finished_check check (
    outcome <> 'finished' or (
      score is not null and dnf_reason is null and egg_tier is not null and egg_points > 0
      and (accused is null) = (verdict = 'not_accused')       -- accuse(null) = "leave the case unsolved"
      and (rules_version <> 'mystery-v3.1' or score = egg_points * 100 - active_time_s)
    )
  );

-- v4 rows: counts present; a breakdown exactly for finishers.
alter table public.mystery_results
  drop constraint if exists mystery_results_v4_check,
  add constraint mystery_results_v4_check check (
    rules_version <> 'mystery-v4' or (
      detections is not null and hits is not null
      and (outcome = 'finished') = (score_breakdown is not null)
    )
  );

-- v4 finishers: the stored breakdown is the contract formula of the row's own columns, and score = total. Every part must
-- be present as a JSON number (a missing key would make a comparison NULL, which a CHECK lets through).
alter table public.mystery_results
  drop constraint if exists mystery_results_v4_score_check,
  add constraint mystery_results_v4_score_check check (
    rules_version <> 'mystery-v4' or outcome <> 'finished' or (
      jsonb_typeof(score_breakdown -> 'delivery') = 'number'
      and jsonb_typeof(score_breakdown -> 'accusation') = 'number'
      and jsonb_typeof(score_breakdown -> 'clues') = 'number'
      and jsonb_typeof(score_breakdown -> 'noDetection') = 'number'
      and jsonb_typeof(score_breakdown -> 'noHints') = 'number'
      and jsonb_typeof(score_breakdown -> 'timeBonus') = 'number'
      and jsonb_typeof(score_breakdown -> 'hintPenalty') = 'number'
      and jsonb_typeof(score_breakdown -> 'hitPenalty') = 'number'
      and jsonb_typeof(score_breakdown -> 'total') = 'number'
      and (score_breakdown ->> 'delivery')::numeric = 1000
      and (score_breakdown ->> 'accusation')::numeric = case when correct then 300 else 0 end
      and (score_breakdown ->> 'clues')::numeric = 100 * least(cardinality(clues_found), 3)
      and (score_breakdown ->> 'noDetection')::numeric = case when detections = 0 then 150 else 0 end
      and (score_breakdown ->> 'noHints')::numeric = case when hints_used = 0 then 150 else 0 end
      and (score_breakdown ->> 'timeBonus')::numeric = greatest(0, 300 - floor(active_time_s))
      and (score_breakdown ->> 'hintPenalty')::numeric = -50 * hints_used
      and (score_breakdown ->> 'hitPenalty')::numeric = -75 * hits
      and (score_breakdown ->> 'total')::numeric = greatest(0,
            (score_breakdown ->> 'delivery')::numeric + (score_breakdown ->> 'accusation')::numeric
            + (score_breakdown ->> 'clues')::numeric + (score_breakdown ->> 'noDetection')::numeric
            + (score_breakdown ->> 'noHints')::numeric + (score_breakdown ->> 'timeBonus')::numeric
            + (score_breakdown ->> 'hintPenalty')::numeric + (score_breakdown ->> 'hitPenalty')::numeric)
      and score = (score_breakdown ->> 'total')::numeric
    )
  );

comment on column public.mystery_results.detections is 'mystery-v4: enemy_detected rule events of the run (server-counted); null for v3.1 rows.';
comment on column public.mystery_results.hits is 'mystery-v4: enemy_hit rule events of the run (blocked hits count; server-counted); null for v3.1 rows.';
comment on column public.mystery_results.defeated_by is 'DNF only: the enemy of the last enemy_hit before the dnf (hyde | crackstone | slurp); null otherwise.';
comment on column public.mystery_results.score_breakdown is 'mystery-v4 finishers: ScoreBreakdown {delivery, accusation, clues, noDetection, noHints, timeBonus, hintPenalty, hitPenalty, total}.';

create index if not exists mystery_results_v4_ranked_idx on public.mystery_results (score desc, active_time_s asc, finalized_at asc)
  where rules_version = 'mystery-v4' and outcome = 'finished' and not is_test;

-- ---------------------------------------------------------------------------------------------
-- mystery_create_session: + p_rules_version (default 'mystery-v3.1' = what the previous function bundle creates).
-- New signature, so drop the 10-argument one first (named-argument callers without p_rules_version still resolve).
-- ---------------------------------------------------------------------------------------------
drop function if exists public.mystery_create_session(uuid, text, text, text, text, jsonb, boolean, jsonb, jsonb, text);

create or replace function public.mystery_create_session(
  p_session_id    uuid,
  p_station_id    text,
  p_action_id     text,
  p_seed          text,
  p_nickname      text,
  p_offer         jsonb,
  p_is_test       boolean,
  p_request       jsonb,
  p_case_versions jsonb,
  p_test_case     text default null,
  p_rules_version text default 'mystery-v3.1'
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_ids        constant text[] := array['poisoned_archive', 'crypt_last_witness', 'midnight_signal'];
  v_now        timestamptz := date_trunc('milliseconds', now());
  v_actor      uuid := nullif(p_request #>> '{actor,userId}', '')::uuid;
  v_existing   record;
  v_old        record;
  v_superseded uuid[] := '{}';
  v_recent     integer;
  v_case       text;
  v_version    smallint;
begin
  if p_session_id is null or p_station_id is null or p_action_id is null or p_seed is null or p_nickname is null
     or p_offer is null or p_is_test is null or p_request is null or p_case_versions is null or p_rules_version is null then
    return private.rpc_error('INVALID_INPUT', 'missing argument');
  end if;
  if p_rules_version not in ('mystery-v3.1', 'mystery-v4') then
    return private.rpc_error('INVALID_INPUT', 'unknown rules version');
  end if;
  if p_action_id !~ '^[A-Za-z0-9_-]{8,64}$' then
    return private.rpc_error('INVALID_INPUT', 'malformed action id');
  end if;
  if p_seed !~ '^[0-9a-f]{32}$' then
    return private.rpc_error('INVALID_INPUT', 'malformed seed');
  end if;
  if jsonb_typeof(p_offer -> 'cards') is distinct from 'array' or jsonb_array_length(p_offer -> 'cards') <> 3
     or (p_offer ->> 'seed') is distinct from p_seed then
    return private.rpc_error('INVALID_INPUT', 'offer must be exactly three cards drawn from this seed');
  end if;
  if jsonb_typeof(p_case_versions) <> 'object'
     or exists (select 1 from unnest(v_ids) c
                where jsonb_typeof(p_case_versions -> c) is distinct from 'number'
                   or (p_case_versions ->> c) !~ '^[1-9][0-9]{0,3}$') then
    return private.rpc_error('INVALID_INPUT', 'case versions must map every case id to a version 1..9999');
  end if;
  if p_test_case is not null and (not p_is_test or not (p_test_case = any (v_ids))) then
    return private.rpc_error('INVALID_INPUT', 'a forced case is only accepted for a test seed and must be a known case id');
  end if;

  perform 1 from public.stations st where st.id = p_station_id for update;
  if not found then
    return private.rpc_error('STATION_NOT_FOUND', 'unknown station');
  end if;

  -- Idempotent replay: same session, SAME case and rules version, nothing drawn.
  select s.id, s.case_id, s.case_version, s.rules_version, a.request into v_existing
  from public.mystery_sessions s
  join public.mystery_session_actions a on a.session_id = s.id and a.action_type = 'create'
  where s.station_id = p_station_id and s.create_action_id = p_action_id;
  if found then
    if (v_existing.request -> 'body') is distinct from (p_request -> 'body') then
      return private.rpc_error('ACTION_ID_CONFLICT', 'action id already used with a different request');
    end if;
    return jsonb_build_object('ok', true, 'replay', true, 'sessionId', v_existing.id,
                              'caseId', v_existing.case_id, 'caseVersion', v_existing.case_version,
                              'rulesVersion', v_existing.rules_version);
  end if;

  select count(*) into v_recent from public.mystery_sessions s
  where s.station_id = p_station_id and s.created_at > v_now - interval '60 seconds';
  if v_recent >= 6 then
    return private.rpc_error('RATE_LIMITED', 'too many sessions created on this station; wait a minute');
  end if;

  v_case := coalesce(p_test_case, private.mystery_draw_case(p_station_id));
  v_version := (p_case_versions ->> v_case)::smallint;

  for v_old in
    select s.id from public.mystery_sessions s
    where s.station_id = p_station_id and s.status in ('offered', 'playing')
    for update
  loop
    update public.mystery_sessions set
      status = 'abandoned', abandoned_reason = 'superseded', abandoned_at = v_now, updated_at = v_now
    where id = v_old.id;
    insert into public.mystery_session_actions (session_id, action_id, action_type, actor_user_id, request)
    values (v_old.id, 'sys_superseded_' || replace(p_session_id::text, '-', ''), 'abandon', v_actor,
            jsonb_build_object('abandonReason', 'superseded', 'supersededBy', p_session_id, 'actor', p_request -> 'actor'));
    v_superseded := array_append(v_superseded, v_old.id);
  end loop;

  insert into public.mystery_sessions (
    id, station_id, rules_version, create_action_id, seed, is_test, nickname, case_id, case_version, status,
    created_at, updated_at
  ) values (
    p_session_id, p_station_id, p_rules_version, p_action_id, p_seed, p_is_test, p_nickname, v_case, v_version, 'offered',
    v_now, v_now
  );

  insert into public.mystery_offered_duos (session_id, station_id, slot, character_id, pokemon_id, duo_name, role, rarity, stats, card)
  select p_session_id, p_station_id, (c.ord - 1)::smallint, c.card ->> 'characterId', c.card ->> 'pokemonId',
         c.card ->> 'duoName', c.card ->> 'role', c.card ->> 'rarity', c.card -> 'stats', c.card
  from jsonb_array_elements(p_offer -> 'cards') with ordinality as c(card, ord);

  insert into public.mystery_session_actions (session_id, action_id, action_type, actor_user_id, request)
  values (p_session_id, p_action_id, 'create', v_actor, p_request);

  perform private.mystery_project_status(p_session_id);

  return jsonb_build_object('ok', true, 'replay', false, 'sessionId', p_session_id, 'caseId', v_case,
                            'caseVersion', v_version, 'rulesVersion', p_rules_version,
                            'supersededSessionIds', to_jsonb(v_superseded));
end;
$$;

revoke execute on function public.mystery_create_session(uuid, text, text, text, text, jsonb, boolean, jsonb, jsonb, text, text) from public, anon, authenticated;
grant execute on function public.mystery_create_session(uuid, text, text, text, text, jsonb, boolean, jsonb, jsonb, text, text) to service_role;

-- ---------------------------------------------------------------------------------------------
-- mystery_finalize_session: + detections, hits, defeated_by, score_breakdown; the result must be computed for the
-- session's own rules version (like caseId / caseVersion). Same signature (OR REPLACE keeps the service_role grant).
-- ---------------------------------------------------------------------------------------------
create or replace function public.mystery_finalize_session(
  p_session_id        uuid,
  p_station_id        text,
  p_expected_last_seq integer,
  p_result            jsonb,
  p_request           jsonb
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_now      timestamptz := date_trunc('milliseconds', now());
  v_session  public.mystery_sessions%rowtype;
  v_row      public.mystery_results%rowtype;
  v_outcome  text := p_result ->> 'outcome';
  v_expected text;
begin
  if p_session_id is null or p_station_id is null or p_expected_last_seq is null or p_result is null or p_request is null then
    return private.rpc_error('INVALID_INPUT', 'missing argument');
  end if;
  select * into v_session from public.mystery_sessions s where s.id = p_session_id for update;
  if not found or v_session.station_id <> p_station_id then
    return private.rpc_error('SESSION_NOT_FOUND', 'session not found');
  end if;

  select * into v_row from public.mystery_results r where r.session_id = p_session_id;
  if found then
    return jsonb_build_object('ok', true, 'replay', true, 'result', to_jsonb(v_row));
  end if;

  if v_session.status = 'offered' then
    return private.rpc_error('NOT_SELECTED', 'no duo selected; nothing to finalize');
  end if;
  if v_session.status <> 'playing' then
    return private.rpc_error('SESSION_CLOSED', 'session is no longer open',
      jsonb_build_object('status', v_session.status, 'abandonedReason', v_session.abandoned_reason));
  end if;
  if v_session.last_seq <> p_expected_last_seq then
    return private.rpc_error('STALE_EVENTS', 'events were appended since the result was computed',
      jsonb_build_object('lastSeq', v_session.last_seq));
  end if;
  if v_session.terminal_type is null then
    return private.rpc_error('RUN_NOT_FINISHED', 'no finish or dnf event has been recorded yet',
      jsonb_build_object('lastSeq', v_session.last_seq));
  end if;
  v_expected := case v_session.terminal_type when 'finish' then 'finished' else 'dnf' end;
  if v_outcome is distinct from v_expected then
    return private.rpc_error('INVALID_TRANSITION', 'result outcome does not match the recorded terminal event');
  end if;
  if (p_result ? 'caseId' and (p_result ->> 'caseId') is distinct from v_session.case_id)
     or (p_result ? 'caseVersion' and (p_result ->> 'caseVersion') is distinct from v_session.case_version::text) then
    return private.rpc_error('INVALID_TRANSITION', 'result was computed for another case than the session''s');
  end if;
  if p_result ? 'rulesVersion' and (p_result ->> 'rulesVersion') is distinct from v_session.rules_version then
    return private.rpc_error('INVALID_TRANSITION', 'result was computed under another rules version than the session''s');
  end if;
  if p_result ? 'evidence' and jsonb_typeof(p_result -> 'evidence') <> 'array' then
    return private.rpc_error('INVALID_INPUT', 'evidence must be an array');
  end if;
  if p_result ? 'scoreBreakdown' and jsonb_typeof(p_result -> 'scoreBreakdown') not in ('object', 'null') then
    return private.rpc_error('INVALID_INPUT', 'scoreBreakdown must be an object or null');
  end if;

  insert into public.mystery_results (
    session_id, station_id, nickname, character_id, pokemon_id, rules_version, case_id, case_version, outcome, dnf_reason,
    verdict, accused, correct, evidence, deduction_correct, clues_found, egg_tier, egg_points, egg_security, active_time_s,
    score, catches, sightings, hints_used, detections, hits, defeated_by, score_breakdown, client_claim, claim_matches,
    is_test, finalized_at
  ) values (
    p_session_id, v_session.station_id, v_session.nickname, v_session.character_id, v_session.pokemon_id,
    v_session.rules_version, v_session.case_id, v_session.case_version, v_outcome, p_result ->> 'dnfReason',
    p_result ->> 'verdict', p_result ->> 'accused', (p_result ->> 'correct')::boolean,
    array(select jsonb_array_elements_text(coalesce(p_result -> 'evidence', '[]'::jsonb))),
    coalesce((p_result ->> 'deductionCorrect')::boolean, false),
    array(select jsonb_array_elements_text(coalesce(p_result -> 'cluesFound', '[]'::jsonb))),
    p_result ->> 'eggTier', (p_result ->> 'eggPoints')::integer, (p_result ->> 'eggSecurity')::numeric,
    (p_result ->> 'activeTimeS')::numeric, (p_result ->> 'score')::numeric, (p_result ->> 'catches')::smallint,
    coalesce((p_result ->> 'sightings')::integer, 0), coalesce((p_result ->> 'hintsUsed')::integer, 0),
    (p_result ->> 'detections')::integer, (p_result ->> 'hits')::integer, p_result ->> 'defeatedBy',
    case when jsonb_typeof(p_result -> 'scoreBreakdown') = 'object' then p_result -> 'scoreBreakdown' end,
    p_result -> 'clientClaim', (p_result ->> 'claimMatches')::boolean, v_session.is_test, v_now
  )
  returning * into v_row;

  update public.mystery_sessions set status = v_outcome, finalized_at = v_now, updated_at = v_now
  where id = p_session_id;
  insert into public.mystery_session_actions (session_id, action_id, action_type, actor_user_id, request)
  values (p_session_id, 'sys_finalize', 'finalize', nullif(p_request #>> '{actor,userId}', '')::uuid, p_request);
  perform private.mystery_project_status(p_session_id);

  return jsonb_build_object('ok', true, 'replay', false, 'result', to_jsonb(v_row));
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- v4 views (v3.1 views mystery_leaderboard / mystery_defeated / mystery_standings stay v3.1-only and unchanged)
-- ---------------------------------------------------------------------------------------------
drop view if exists public.mystery_top5;
drop view if exists public.mystery_leaderboard_v4;
drop view if exists public.mystery_defeated_v4;
drop view if exists public.mystery_standings_v4;

-- Ranked v4 board: verified finishers only (a row exists only after server finalize), score desc, active time asc, then
-- who finalized first. `rank` = combined board, `case_rank` = rank among the finishers of the same case.
create view public.mystery_leaderboard_v4 with (security_invoker = true) as
select
  rank() over (order by r.score desc, r.active_time_s asc, r.finalized_at asc)::integer as rank,
  rank() over (partition by r.case_id order by r.score desc, r.active_time_s asc, r.finalized_at asc)::integer as case_rank,
  r.session_id, r.nickname, r.station_id, r.case_id, r.case_version, r.character_id, r.pokemon_id, r.score,
  r.active_time_s, r.verdict, r.correct, r.deduction_correct, r.clue_count, r.hints_used, r.detections, r.hits,
  r.catches, r.score_breakdown, r.finalized_at, r.rules_version
from public.mystery_results r
where r.outcome = 'finished' and r.rules_version = 'mystery-v4' and not r.is_test
order by r.score desc, r.active_time_s asc, r.finalized_at asc, r.session_id asc;

-- v4 defeat log (DNFs, unranked, newest first) with the monster that ended the run.
create view public.mystery_defeated_v4 with (security_invoker = true) as
select
  r.session_id, r.nickname, r.station_id, r.case_id, r.case_version, r.character_id, r.pokemon_id, r.dnf_reason,
  r.defeated_by, r.active_time_s, r.clue_count, r.hints_used, r.detections, r.hits, r.catches, r.finalized_at,
  r.rules_version
from public.mystery_results r
where r.outcome = 'dnf' and r.rules_version = 'mystery-v4' and not r.is_test
order by r.finalized_at desc, r.session_id asc;

-- v4 combined standings: every finisher above every DNF (shared compareResults order); DNFs have rank null.
create view public.mystery_standings_v4 with (security_invoker = true) as
select
  case when r.outcome = 'finished' then 0 else 1 end as standing_group,
  case when r.outcome = 'finished'
       then rank() over (partition by r.outcome = 'finished' order by r.score desc, r.active_time_s asc, r.finalized_at asc)::integer
  end as rank,
  case when r.outcome = 'finished'
       then rank() over (partition by r.outcome = 'finished', r.case_id order by r.score desc, r.active_time_s asc, r.finalized_at asc)::integer
  end as case_rank,
  r.session_id, r.nickname, r.station_id, r.case_id, r.case_version, r.character_id, r.pokemon_id, r.outcome,
  r.dnf_reason, r.defeated_by, r.score, r.active_time_s, r.verdict, r.correct, r.deduction_correct, r.clue_count,
  r.hints_used, r.detections, r.hits, r.catches, r.finalized_at, r.rules_version
from public.mystery_results r
where r.rules_version = 'mystery-v4' and not r.is_test
order by standing_group asc, r.score desc nulls last,
  case when r.outcome = 'finished' then r.active_time_s end asc,
  case when r.outcome = 'dnf' then r.active_time_s end desc,
  r.finalized_at asc, r.session_id asc;

-- Home-page feed: the five best verified v4 finishers, public columns only. `rank` is the true board rank (ties share a
-- rank); exactly the first five board rows are returned.
create view public.mystery_top5 with (security_invoker = true) as
select l.rank, l.session_id, l.nickname, l.score, l.character_id, l.pokemon_id, l.case_id, l.active_time_s,
       l.finalized_at, l.rules_version
from public.mystery_leaderboard_v4 l
order by l.score desc, l.active_time_s asc, l.finalized_at asc, l.session_id asc
limit 5;

comment on view public.mystery_leaderboard_v4 is 'mystery-v4 verified finishers (not is_test), score desc, active time asc. Public columns only.';
comment on view public.mystery_defeated_v4 is 'mystery-v4 defeat log (DNFs, never ranked) incl. defeated_by. Public columns only.';
comment on view public.mystery_standings_v4 is 'mystery-v4 finishers (ranked) above DNFs (rank null). Public columns only.';
comment on view public.mystery_top5 is 'Home-page top 5 (mystery-v4 verified finishers): rank, nickname, score, duo, case, time. Public columns only.';

revoke all on table public.mystery_leaderboard_v4, public.mystery_defeated_v4, public.mystery_standings_v4, public.mystery_top5
  from public, anon, authenticated;
grant all on table public.mystery_leaderboard_v4, public.mystery_defeated_v4, public.mystery_standings_v4, public.mystery_top5
  to service_role;
grant select on table public.mystery_leaderboard_v4, public.mystery_defeated_v4, public.mystery_standings_v4, public.mystery_top5
  to anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- Column privileges: the four new public result columns (accused / evidence / client_claim stay operator-only)
-- ---------------------------------------------------------------------------------------------
grant select (detections, hits, defeated_by, score_breakdown) on table public.mystery_results to anon, authenticated;

-- Realtime: public.mystery_results is already in supabase_realtime (20261021000800); the home panel listens for INSERTs
-- there and refetches mystery_top5. Nothing else is published.

notify pgrst, 'reload schema';
