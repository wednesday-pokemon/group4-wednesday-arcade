-- Three cases (rules mystery-v3.1, case system v1; docs/MYSTERY_CASES.md). ADDITIVE on top of 20261021000500..800.
--
--   * mystery_sessions.case_id / case_version: ONE case per session, assigned by mystery_create_session BEFORE the duo
--     cards, independent of the seed. Even distribution per station via a shuffled bag (mystery_case_bags, row-locked
--     inside the existing stations row lock): pop the next id; an empty bag is refilled with a fresh random
--     permutation that never starts with the case just dealt. A replayed actionId returns the SAME session/case.
--   * Clue CHECKs widened to the nine CLUE_IDS of the three cases (+ the three legacy ids so old rows stay valid).
--   * mystery_results: case_id, case_version, evidence (cited ids), deduction_correct; case_solved now requires
--     correct ∧ deduction_correct ∧ all three clues.
--   * Public views/standings carry case_id (+ per-case rank) and no longer expose `accused`; column privileges keep
--     `accused`, `evidence` and `client_claim` of mystery_results away from anon/authenticated. Operators read them
--     through public.mystery_result_audit.
-- The case CONTENT (clue ids per case, culprit, versions) is never stored in SQL: the Edge Functions own it (generated
-- registry) and pass the deployed case versions to mystery_create_session.

-- ---------------------------------------------------------------------------------------------
-- Sessions: assigned case
-- ---------------------------------------------------------------------------------------------
-- Pre-existing rows (all played "The Silent Evidence", the ancestor of case 01) are backfilled as poisoned_archive v1;
-- the defaults are dropped right after, so every new row must name its case explicitly.
alter table public.mystery_sessions
  add column case_id text not null default 'poisoned_archive'
    constraint mystery_sessions_case_id_check check (case_id in ('poisoned_archive', 'crypt_last_witness', 'midnight_signal')),
  add column case_version smallint not null default 1
    constraint mystery_sessions_case_version_check check (case_version between 1 and 9999);
alter table public.mystery_sessions alter column case_id drop default, alter column case_version drop default;
comment on column public.mystery_sessions.case_id is 'Case assigned at creation (per-station shuffled bag). Never derived from the seed; never changes.';
comment on column public.mystery_sessions.case_version is 'CaseDef.version deployed when the session was created (the functions refuse to verify against another version).';
create index mystery_sessions_case_idx on public.mystery_sessions (case_id, created_at desc);

-- ---------------------------------------------------------------------------------------------
-- Per-station case bag (service role only; written by mystery_create_session under the station row lock)
-- ---------------------------------------------------------------------------------------------
create table public.mystery_case_bags (
  station_id text primary key references public.stations (id),
  bag        text[] not null default '{}'
             constraint mystery_case_bags_bag_check check (
               bag <@ array['poisoned_archive', 'crypt_last_witness', 'midnight_signal']::text[]
               and cardinality(bag) <= 3 and array_position(bag, null) is null),
  last_case  text null
             constraint mystery_case_bags_last_case_check check (last_case in ('poisoned_archive', 'crypt_last_witness', 'midnight_signal')),
  updated_at timestamptz not null default now()
);
comment on table public.mystery_case_bags is 'Remaining case ids of the current shuffled bag per station (even case distribution). Service role only.';

alter table public.mystery_case_bags enable row level security;
revoke all on table public.mystery_case_bags from public, anon, authenticated;
grant all on table public.mystery_case_bags to service_role;
-- deliberately no policy: no client role can read or write the bag (it would reveal the next visitor's case)

-- ---------------------------------------------------------------------------------------------
-- Clues: the nine ids of the three cases (+ legacy ids of "The Silent Evidence" for pre-existing rows)
-- ---------------------------------------------------------------------------------------------
alter table public.mystery_clue_events drop constraint mystery_clue_events_clue_id_check;
alter table public.mystery_clue_events add constraint mystery_clue_events_clue_id_check check (clue_id in (
  'falsified_transfer', 'botanical_residue', 'access_ledger',
  'sabotaged_gate', 'tunnel_access_record', 'equipment_match',
  'falsified_patrol_log', 'alarm_override', 'watchtower_signal',
  'transfer_note', 'master_key', 'greenhouse_trace'));

-- ---------------------------------------------------------------------------------------------
-- Results: case + cited evidence + deduction
-- ---------------------------------------------------------------------------------------------
-- ADD COLUMN with a constant default is a catalog-only change (no UPDATE, so the immutability trigger is not fired).
alter table public.mystery_results
  add column case_id text not null default 'poisoned_archive'
    constraint mystery_results_case_id_check check (case_id in ('poisoned_archive', 'crypt_last_witness', 'midnight_signal')),
  add column case_version smallint not null default 1
    constraint mystery_results_case_version_check check (case_version between 1 and 9999),
  add column evidence text[] not null default '{}'
    constraint mystery_results_evidence_check check (
      cardinality(evidence) <= 5 and array_position(evidence, null) is null
      and array_to_string(evidence, ',') ~ '^([a-z][a-z0-9_]{0,39}(,|$))*$'),
  add column deduction_correct boolean not null default false;
alter table public.mystery_results
  alter column case_id drop default, alter column case_version drop default,
  alter column evidence drop default, alter column deduction_correct drop default;
comment on column public.mystery_results.evidence is 'Evidence ids cited with the accusation, sanitized server-side (found clues + case notes). Operator-only column.';
comment on column public.mystery_results.deduction_correct is 'The cited evidence is exactly the case''s supporting evidence (server-recomputed).';
comment on column public.mystery_results.accused is 'Accused suspect. Operator-only column (never readable by anon / stations; spectators see verdict/correct only).';

alter table public.mystery_results drop constraint mystery_results_clues_check;
alter table public.mystery_results add constraint mystery_results_clues_check check (
  clues_found <@ array[
    'falsified_transfer', 'botanical_residue', 'access_ledger',
    'sabotaged_gate', 'tunnel_access_record', 'equipment_match',
    'falsified_patrol_log', 'alarm_override', 'watchtower_signal',
    'transfer_note', 'master_key', 'greenhouse_trace']::text[]
  and cardinality(clues_found) <= 3);

-- case_solved ⇔ all three clues ∧ culprit ∧ exactly the supporting evidence (caseLogic.verdictFor). NOT VALID: legacy
-- rows (solved before evidence existed, deduction_correct backfilled false) are kept; every new row is checked.
alter table public.mystery_results drop constraint mystery_results_solved_check;
alter table public.mystery_results add constraint mystery_results_solved_check check (
  verdict <> 'case_solved' or (correct and deduction_correct and cardinality(clues_found) = 3)) not valid;
-- No suspect (left unsolved / DNF) ⇒ nothing cited, no deduction.
alter table public.mystery_results add constraint mystery_results_deduction_check check (
  accused is not null or (not deduction_correct and cardinality(evidence) = 0));

create index mystery_results_case_ranked_idx on public.mystery_results (case_id, outcome, score desc, active_time_s asc, finalized_at asc);

-- ---------------------------------------------------------------------------------------------
-- Public station status: which case each terminal is playing (the case is announced to the visitor; not a secret)
-- ---------------------------------------------------------------------------------------------
alter table public.mystery_station_status
  add column case_id text null
    constraint mystery_station_status_case_id_check check (case_id in ('poisoned_archive', 'crypt_last_witness', 'midnight_signal'));

create or replace function private.mystery_project_status(p_session_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  insert into public.mystery_station_status as ss (
    station_id, label, session_id, nickname, character_id, pokemon_id, case_id, status, clues_found, catches, sightings,
    egg_state, active_time_s, verdict, score, is_test, notice, revision, updated_at
  )
  select
    s.station_id, st.label, s.id, s.nickname, s.character_id, s.pokemon_id, s.case_id, s.status, s.clues_found, s.catches,
    s.sightings, s.egg_state,
    coalesce(r.active_time_s, round(s.last_t::numeric, 1)), r.verdict, r.score, s.is_test, null, 1, now()
  from public.mystery_sessions s
  join public.stations st on st.id = s.station_id
  left join public.mystery_results r on r.session_id = s.id
  where s.id = p_session_id and s.status <> 'abandoned'
  on conflict (station_id) do update set
    label = excluded.label, session_id = excluded.session_id, nickname = excluded.nickname,
    character_id = excluded.character_id, pokemon_id = excluded.pokemon_id, case_id = excluded.case_id,
    status = excluded.status, clues_found = excluded.clues_found, catches = excluded.catches,
    sightings = excluded.sightings, egg_state = excluded.egg_state, active_time_s = excluded.active_time_s,
    verdict = excluded.verdict, score = excluded.score, is_test = excluded.is_test, notice = null,
    revision = ss.revision + 1, updated_at = excluded.updated_at;
end;
$$;

create or replace function private.mystery_clear_status(p_station_id text, p_notice text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  update public.mystery_station_status set
    session_id = null, nickname = null, character_id = null, pokemon_id = null, case_id = null, status = 'idle',
    clues_found = null, catches = null, sightings = null, egg_state = null, active_time_s = null, verdict = null,
    score = null, is_test = false, notice = p_notice, revision = revision + 1, updated_at = now()
  where station_id = p_station_id;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Case draw (caller MUST hold the public.stations row lock of p_station_id)
-- ---------------------------------------------------------------------------------------------
create function private.mystery_draw_case(p_station_id text)
returns text language plpgsql security definer set search_path = '' as $$
declare
  v_ids  constant text[] := array['poisoned_archive', 'crypt_last_witness', 'midnight_signal'];
  v_bag  text[];
  v_last text;
  v_case text;
  v_swap integer;
  v_tmp  text;
begin
  insert into public.mystery_case_bags (station_id) values (p_station_id) on conflict (station_id) do nothing;
  select b.bag, b.last_case into v_bag, v_last from public.mystery_case_bags b where b.station_id = p_station_id for update;
  if coalesce(cardinality(v_bag), 0) = 0 then
    -- fresh uniform permutation (random() is seeded per backend by PostgreSQL; the bag only needs fairness, not secrecy
    -- against the server, and it is never readable by clients)
    v_bag := array(select c from unnest(v_ids) as c order by random());
    if v_bag[1] = v_last then
      -- never deal the same case twice in a row across a refill: swap the head with a uniformly chosen other slot
      -- (keeps the result uniform over the permutations that do not start with last_case)
      v_swap := 2 + floor(random() * (cardinality(v_bag) - 1))::integer;
      v_tmp := v_bag[1];
      v_bag[1] := v_bag[v_swap];
      v_bag[v_swap] := v_tmp;
    end if;
  end if;
  v_case := v_bag[1];
  update public.mystery_case_bags set bag = v_bag[2:], last_case = v_case, updated_at = now()
  where station_id = p_station_id;
  return v_case;
end;
$$;
revoke execute on function private.mystery_draw_case(text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- mystery_create_session: + case draw. New signature (p_case_versions, optional p_test_case), so drop the old one.
-- ---------------------------------------------------------------------------------------------
drop function public.mystery_create_session(uuid, text, text, text, text, jsonb, boolean, jsonb);

create function public.mystery_create_session(
  p_session_id    uuid,
  p_station_id    text,
  p_action_id     text,
  p_seed          text,
  p_nickname      text,
  p_offer         jsonb,
  p_is_test       boolean,
  p_request       jsonb,
  p_case_versions jsonb,
  p_test_case     text default null
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
     or p_offer is null or p_is_test is null or p_request is null or p_case_versions is null then
    return private.rpc_error('INVALID_INPUT', 'missing argument');
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

  -- Idempotent replay (double click, network retry, refresh before the response was persisted): same session, SAME
  -- case, nothing drawn.
  select s.id, s.case_id, s.case_version, a.request into v_existing
  from public.mystery_sessions s
  join public.mystery_session_actions a on a.session_id = s.id and a.action_type = 'create'
  where s.station_id = p_station_id and s.create_action_id = p_action_id;
  if found then
    if (v_existing.request -> 'body') is distinct from (p_request -> 'body') then
      return private.rpc_error('ACTION_ID_CONFLICT', 'action id already used with a different request');
    end if;
    return jsonb_build_object('ok', true, 'replay', true, 'sessionId', v_existing.id,
                              'caseId', v_existing.case_id, 'caseVersion', v_existing.case_version);
  end if;

  select count(*) into v_recent from public.mystery_sessions s
  where s.station_id = p_station_id and s.created_at > v_now - interval '60 seconds';
  if v_recent >= 6 then
    return private.rpc_error('RATE_LIMITED', 'too many sessions created on this station; wait a minute');
  end if;

  -- The case: forced (operator test seed) or the next one from this station's bag. A forced case never touches the bag.
  v_case := coalesce(p_test_case, private.mystery_draw_case(p_station_id));
  v_version := (p_case_versions ->> v_case)::smallint;

  -- Supersede whatever is still open on this station (unranked; its events stay for analytics).
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
    p_session_id, p_station_id, 'mystery-v3.1', p_action_id, p_seed, p_is_test, p_nickname, v_case, v_version, 'offered',
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
                            'caseVersion', v_version, 'supersededSessionIds', to_jsonb(v_superseded));
end;
$$;

revoke execute on function public.mystery_create_session(uuid, text, text, text, text, jsonb, boolean, jsonb, jsonb, text) from public, anon, authenticated;
grant execute on function public.mystery_create_session(uuid, text, text, text, text, jsonb, boolean, jsonb, jsonb, text) to service_role;

-- ---------------------------------------------------------------------------------------------
-- mystery_finalize_session: + case (from the SESSION, never from the body), evidence, deduction_correct
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
  if p_result ? 'evidence' and jsonb_typeof(p_result -> 'evidence') <> 'array' then
    return private.rpc_error('INVALID_INPUT', 'evidence must be an array');
  end if;

  insert into public.mystery_results (
    session_id, station_id, nickname, character_id, pokemon_id, rules_version, case_id, case_version, outcome, dnf_reason,
    verdict, accused, correct, evidence, deduction_correct, clues_found, egg_tier, egg_points, egg_security, active_time_s,
    score, catches, sightings, hints_used, client_claim, claim_matches, is_test, finalized_at
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
-- (create or replace keeps the existing service_role-only EXECUTE privileges)

-- ---------------------------------------------------------------------------------------------
-- Public views: + case_id / per-case rank, WITHOUT accused
-- ---------------------------------------------------------------------------------------------
drop view public.mystery_leaderboard;
drop view public.mystery_defeated;
drop view public.mystery_standings;

-- Ranked board: finishers only, score desc, then active time asc, then who finalized first. `rank` = combined board,
-- `case_rank` = rank among the finishers of the same case.
create view public.mystery_leaderboard with (security_invoker = true) as
select
  rank() over (order by r.score desc, r.active_time_s asc, r.finalized_at asc)::integer as rank,
  rank() over (partition by r.case_id order by r.score desc, r.active_time_s asc, r.finalized_at asc)::integer as case_rank,
  r.session_id, r.nickname, r.station_id, r.case_id, r.case_version, r.character_id, r.pokemon_id, r.score,
  r.active_time_s, r.egg_tier, r.egg_points, r.egg_security, r.verdict, r.correct, r.deduction_correct, r.clue_count,
  r.catches, r.finalized_at, r.rules_version
from public.mystery_results r
where r.outcome = 'finished' and r.rules_version = 'mystery-v3.1' and not r.is_test
order by r.score desc, r.active_time_s asc, r.finalized_at asc, r.session_id asc;

-- DNFs: unranked log.
create view public.mystery_defeated with (security_invoker = true) as
select
  r.session_id, r.nickname, r.station_id, r.case_id, r.case_version, r.character_id, r.pokemon_id, r.dnf_reason,
  r.active_time_s, r.clue_count, r.catches, r.finalized_at, r.rules_version
from public.mystery_results r
where r.outcome = 'dnf' and r.rules_version = 'mystery-v3.1' and not r.is_test
order by r.finalized_at desc, r.session_id asc;

-- Combined standings: EVERY finisher (even with a negative score) above every DNF (same order as the shared
-- compareResults()). `rank` is over all cases, `case_rank` within the row's case (filter by case_id for a per-case board).
create view public.mystery_standings with (security_invoker = true) as
select
  case when r.outcome = 'finished' then 0 else 1 end as standing_group,
  case when r.outcome = 'finished'
       then rank() over (partition by r.outcome = 'finished' order by r.score desc, r.active_time_s asc, r.finalized_at asc)::integer
  end as rank,
  case when r.outcome = 'finished'
       then rank() over (partition by r.outcome = 'finished', r.case_id order by r.score desc, r.active_time_s asc, r.finalized_at asc)::integer
  end as case_rank,
  r.session_id, r.nickname, r.station_id, r.case_id, r.case_version, r.character_id, r.pokemon_id, r.outcome,
  r.dnf_reason, r.score, r.active_time_s, r.verdict, r.correct, r.deduction_correct, r.clue_count, r.catches,
  r.finalized_at, r.rules_version
from public.mystery_results r
where r.rules_version = 'mystery-v3.1' and not r.is_test
order by standing_group asc, r.score desc nulls last,
  case when r.outcome = 'finished' then r.active_time_s end asc,
  case when r.outcome = 'dnf' then r.active_time_s end desc,
  r.finalized_at asc, r.session_id asc;

-- Operator audit of the secret columns. A definer view (runs as its owner, so it can read the protected columns) that
-- returns rows ONLY to operators; anon has no privilege at all, station accounts get zero rows.
create view public.mystery_result_audit as
select
  r.session_id, r.station_id, r.case_id, r.case_version, r.outcome, r.verdict, r.accused, r.correct, r.evidence,
  r.deduction_correct, r.clues_found, r.client_claim, r.claim_matches, r.is_test, r.finalized_at
from public.mystery_results r
where (select private.is_operator());
comment on view public.mystery_result_audit is 'Operator-only audit of accused / evidence / client_claim (security definer view filtered by private.is_operator()).';

revoke all on table public.mystery_leaderboard, public.mystery_defeated, public.mystery_standings, public.mystery_result_audit
  from public, anon, authenticated;
grant all on table public.mystery_leaderboard, public.mystery_defeated, public.mystery_standings, public.mystery_result_audit
  to service_role;
grant select on table public.mystery_leaderboard, public.mystery_defeated, public.mystery_standings to anon, authenticated;
grant select on table public.mystery_result_audit to authenticated;

-- ---------------------------------------------------------------------------------------------
-- Column privileges: anon / authenticated read every mystery_results column EXCEPT accused, evidence, client_claim.
-- (Revoking the table-level SELECT also revokes column grants; Realtime postgres_changes drops non-selectable columns.)
-- ---------------------------------------------------------------------------------------------
revoke select on table public.mystery_results from anon, authenticated;
grant select (
  session_id, station_id, nickname, character_id, pokemon_id, rules_version, case_id, case_version, outcome, dnf_reason,
  verdict, correct, deduction_correct, clues_found, clue_count, egg_tier, egg_points, egg_security, active_time_s, score,
  catches, sightings, hints_used, claim_matches, is_test, finalized_at
) on table public.mystery_results to anon, authenticated;
