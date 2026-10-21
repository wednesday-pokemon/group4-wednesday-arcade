-- mystery-v3.1 atomic RPCs. SECURITY DEFINER, empty search_path, EXECUTE for service_role only.
-- The Edge Functions compute everything rule-related with the shared pure modules (draftOffer, case data,
-- scoring); these RPCs (1) serialize writers with row locks, (2) dedupe / enforce idempotency and
-- optimistic concurrency on last_seq, (3) persist rows + receipts + the public projection in ONE transaction.
--
-- Lock order: public.stations row (create/reset only) -> mystery_sessions row(s) -> mystery_station_status row.
-- Envelope (same as v2.5): {"ok": true, ...} or {"ok": false, "error": CODE, "message": ..., ...details}.
-- Unexpected faults (CHECK/unique violations from a buggy writer) raise and roll back the whole transaction.

-- ---------------------------------------------------------------------------------------------
-- Projections
-- ---------------------------------------------------------------------------------------------
create function private.mystery_project_status(p_session_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  insert into public.mystery_station_status as ss (
    station_id, label, session_id, nickname, character_id, pokemon_id, status, clues_found, catches, sightings,
    egg_state, active_time_s, verdict, score, is_test, notice, revision, updated_at
  )
  select
    s.station_id, st.label, s.id, s.nickname, s.character_id, s.pokemon_id, s.status, s.clues_found, s.catches,
    s.sightings, s.egg_state,
    coalesce(r.active_time_s, round(s.last_t::numeric, 1)), r.verdict, r.score, s.is_test, null, 1, now()
  from public.mystery_sessions s
  join public.stations st on st.id = s.station_id
  left join public.mystery_results r on r.session_id = s.id
  where s.id = p_session_id and s.status <> 'abandoned'
  on conflict (station_id) do update set
    label = excluded.label, session_id = excluded.session_id, nickname = excluded.nickname,
    character_id = excluded.character_id, pokemon_id = excluded.pokemon_id, status = excluded.status,
    clues_found = excluded.clues_found, catches = excluded.catches, sightings = excluded.sightings,
    egg_state = excluded.egg_state, active_time_s = excluded.active_time_s, verdict = excluded.verdict,
    score = excluded.score, is_test = excluded.is_test, notice = null, revision = ss.revision + 1,
    updated_at = excluded.updated_at;
end;
$$;

create function private.mystery_clear_status(p_station_id text, p_notice text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  update public.mystery_station_status set
    session_id = null, nickname = null, character_id = null, pokemon_id = null, status = 'idle', clues_found = null,
    catches = null, sightings = null, egg_state = null, active_time_s = null, verdict = null, score = null,
    is_test = false, notice = p_notice, revision = revision + 1, updated_at = now()
  where station_id = p_station_id;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- mystery_create_session: new session + its three server-computed cards; supersedes the station's open session.
-- Idempotent per (station, actionId): a replay returns {replay:true, sessionId} and changes nothing.
-- ---------------------------------------------------------------------------------------------
create function public.mystery_create_session(
  p_session_id uuid,
  p_station_id text,
  p_action_id  text,
  p_seed       text,
  p_nickname   text,
  p_offer      jsonb,
  p_is_test    boolean,
  p_request    jsonb
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_now        timestamptz := date_trunc('milliseconds', now());
  v_actor      uuid := nullif(p_request #>> '{actor,userId}', '')::uuid;
  v_existing   record;
  v_old        record;
  v_superseded uuid[] := '{}';
  v_recent     integer;
begin
  if p_session_id is null or p_station_id is null or p_action_id is null or p_seed is null or p_nickname is null
     or p_offer is null or p_is_test is null or p_request is null then
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

  perform 1 from public.stations st where st.id = p_station_id for update;
  if not found then
    return private.rpc_error('STATION_NOT_FOUND', 'unknown station');
  end if;

  -- Idempotent replay (double click, network retry, refresh before the response was persisted).
  select s.id, a.request into v_existing
  from public.mystery_sessions s
  join public.mystery_session_actions a on a.session_id = s.id and a.action_type = 'create'
  where s.station_id = p_station_id and s.create_action_id = p_action_id;
  if found then
    if (v_existing.request -> 'body') is distinct from (p_request -> 'body') then
      return private.rpc_error('ACTION_ID_CONFLICT', 'action id already used with a different request');
    end if;
    return jsonb_build_object('ok', true, 'replay', true, 'sessionId', v_existing.id);
  end if;

  select count(*) into v_recent from public.mystery_sessions s
  where s.station_id = p_station_id and s.created_at > v_now - interval '60 seconds';
  if v_recent >= 6 then
    return private.rpc_error('RATE_LIMITED', 'too many sessions created on this station; wait a minute');
  end if;

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
    id, station_id, rules_version, create_action_id, seed, is_test, nickname, status, created_at, updated_at
  ) values (
    p_session_id, p_station_id, 'mystery-v3.1', p_action_id, p_seed, p_is_test, p_nickname, 'offered', v_now, v_now
  );

  insert into public.mystery_offered_duos (session_id, station_id, slot, character_id, pokemon_id, duo_name, role, rarity, stats, card)
  select p_session_id, p_station_id, (c.ord - 1)::smallint, c.card ->> 'characterId', c.card ->> 'pokemonId',
         c.card ->> 'duoName', c.card ->> 'role', c.card ->> 'rarity', c.card -> 'stats', c.card
  from jsonb_array_elements(p_offer -> 'cards') with ordinality as c(card, ord);

  insert into public.mystery_session_actions (session_id, action_id, action_type, actor_user_id, request)
  values (p_session_id, p_action_id, 'create', v_actor, p_request);

  perform private.mystery_project_status(p_session_id);

  return jsonb_build_object('ok', true, 'replay', false, 'sessionId', p_session_id,
                            'supersededSessionIds', to_jsonb(v_superseded));
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- mystery_select_duo: the chosen pair MUST be one of the three stored cards. Naturally idempotent.
-- ---------------------------------------------------------------------------------------------
create function public.mystery_select_duo(
  p_session_id   uuid,
  p_station_id   text,
  p_character_id text,
  p_pokemon_id   text,
  p_request      jsonb
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_now     timestamptz := date_trunc('milliseconds', now());
  v_session public.mystery_sessions%rowtype;
  v_slot    smallint;
begin
  if p_session_id is null or p_station_id is null or p_character_id is null or p_pokemon_id is null or p_request is null then
    return private.rpc_error('INVALID_INPUT', 'missing argument');
  end if;
  select * into v_session from public.mystery_sessions s where s.id = p_session_id for update;
  if not found or v_session.station_id <> p_station_id then
    return private.rpc_error('SESSION_NOT_FOUND', 'session not found');
  end if;
  if v_session.selected_slot is not null then
    if v_session.character_id = p_character_id and v_session.pokemon_id = p_pokemon_id then
      return jsonb_build_object('ok', true, 'replay', true, 'slot', v_session.selected_slot);
    end if;
    return private.rpc_error('ALREADY_SELECTED', 'a different duo was already selected for this session',
      jsonb_build_object('slot', v_session.selected_slot));
  end if;
  if v_session.status <> 'offered' then
    return private.rpc_error('SESSION_CLOSED', 'session is no longer open',
      jsonb_build_object('status', v_session.status, 'abandonedReason', v_session.abandoned_reason));
  end if;

  select o.slot into v_slot from public.mystery_offered_duos o
  where o.session_id = p_session_id and o.character_id = p_character_id and o.pokemon_id = p_pokemon_id;
  if not found then
    return private.rpc_error('DUO_NOT_OFFERED', 'that duo is not one of the three offered cards');
  end if;

  update public.mystery_sessions set
    status = 'playing', selected_slot = v_slot, character_id = p_character_id, pokemon_id = p_pokemon_id,
    selected_at = v_now, updated_at = v_now
  where id = p_session_id;
  insert into public.mystery_session_actions (session_id, action_id, action_type, actor_user_id, request)
  values (p_session_id, 'sys_select_duo', 'select', nullif(p_request #>> '{actor,userId}', '')::uuid, p_request);
  perform private.mystery_project_status(p_session_id);
  return jsonb_build_object('ok', true, 'replay', false, 'slot', v_slot);
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- mystery_append_events: one validated batch (Edge Function already checked payloads + order rules and
-- removed exact duplicates). Optimistic concurrency on last_seq; DB re-checks monotonic seq/t, uniqueness,
-- one terminal/accusation/delivery and unique clues as backstops.
-- ---------------------------------------------------------------------------------------------
create function public.mystery_append_events(
  p_session_id        uuid,
  p_station_id        text,
  p_expected_last_seq integer,
  p_events            jsonb,
  p_progress          jsonb,
  p_forecasts         jsonb,
  p_recommendations   jsonb
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_now      timestamptz := now();
  v_session  public.mystery_sessions%rowtype;
  v_n        integer;
  v_ok       boolean;
  v_last_seq integer;
  v_last_t   double precision;
  v_terminal text;
  v_fc       integer := 0;
  v_rc       integer := 0;
begin
  if p_session_id is null or p_station_id is null or p_expected_last_seq is null or p_progress is null then
    return private.rpc_error('INVALID_INPUT', 'missing argument');
  end if;
  p_events := coalesce(p_events, '[]'::jsonb);
  p_forecasts := coalesce(p_forecasts, '[]'::jsonb);
  p_recommendations := coalesce(p_recommendations, '[]'::jsonb);
  if jsonb_typeof(p_events) <> 'array' or jsonb_typeof(p_forecasts) <> 'array' or jsonb_typeof(p_recommendations) <> 'array'
     or jsonb_typeof(p_progress) <> 'object' then
    return private.rpc_error('INVALID_INPUT', 'events, forecasts and recommendations must be arrays');
  end if;

  select * into v_session from public.mystery_sessions s where s.id = p_session_id for update;
  if not found or v_session.station_id <> p_station_id then
    return private.rpc_error('SESSION_NOT_FOUND', 'session not found');
  end if;
  if v_session.status = 'offered' then
    return private.rpc_error('NOT_SELECTED', 'select a duo before sending gameplay events');
  end if;
  if v_session.status <> 'playing' then
    return private.rpc_error('SESSION_CLOSED', 'session is no longer open',
      jsonb_build_object('status', v_session.status, 'abandonedReason', v_session.abandoned_reason));
  end if;
  if v_session.last_seq <> p_expected_last_seq then
    return private.rpc_error('STALE_EVENTS', 'events were appended since the session was read',
      jsonb_build_object('lastSeq', v_session.last_seq));
  end if;

  v_n := jsonb_array_length(p_events);
  if v_session.event_count + v_n > 20000 then
    return private.rpc_error('TOO_MANY_EVENTS', 'session event budget (20000) exhausted');
  end if;

  if v_n > 0 then
    -- strictly increasing seq above last_seq, non-decreasing t, in array order
    select bool_and(e.seq > coalesce(e.prev_seq, v_session.last_seq) and e.t >= coalesce(e.prev_t, v_session.last_t)),
           max(e.seq), max(e.t)
      into v_ok, v_last_seq, v_last_t
    from (
      select x.seq, x.t,
             lag(x.seq) over (order by x.ord) as prev_seq,
             lag(x.t) over (order by x.ord) as prev_t
      from rows from (jsonb_to_recordset(p_events) as (seq integer, t double precision, type text, payload jsonb))
           with ordinality as x(seq, t, type, payload, ord)
    ) e;
    if not coalesce(v_ok, false) then
      return private.rpc_error('EVENT_REJECTED', 'events must have strictly increasing seq and non-decreasing t',
        jsonb_build_object('rule', 'order', 'lastSeq', v_session.last_seq));
    end if;

    insert into public.mystery_events (session_id, station_id, seq, t, type, payload, received_at)
    select p_session_id, p_station_id, x.seq, x.t, x.type, x.payload, v_now
    from jsonb_to_recordset(p_events) as x(seq integer, t double precision, type text, payload jsonb);

    insert into public.mystery_clue_events (session_id, station_id, clue_id, found_order, seq, t)
    select p_session_id, p_station_id, x.payload ->> 'clueId', (x.payload ->> 'cluesFound')::smallint, x.seq, x.t
    from jsonb_to_recordset(p_events) as x(seq integer, t double precision, type text, payload jsonb)
    where x.type = 'clue_found';

    select x.type into v_terminal
    from jsonb_to_recordset(p_events) as x(seq integer, t double precision, type text, payload jsonb)
    where x.type in ('finish', 'dnf');
  else
    v_last_seq := v_session.last_seq;
    v_last_t := v_session.last_t;
  end if;

  update public.mystery_sessions s set
    last_seq      = v_last_seq,
    last_t        = v_last_t,
    event_count   = s.event_count + v_n,
    progress      = p_progress,
    clues_found   = (select count(*) from public.mystery_clue_events c where c.session_id = p_session_id),
    catches       = (select count(*) from public.mystery_events e where e.session_id = p_session_id and e.type = 'catch'),
    sightings     = (select count(*) from public.mystery_events e where e.session_id = p_session_id and e.type = 'hyde_sighted'),
    egg_state     = coalesce(p_progress ->> 'egg', s.egg_state),
    terminal_type = coalesce(s.terminal_type, v_terminal),
    updated_at    = v_now
  where s.id = p_session_id;

  -- Forecasts: immutable once issued (a resend of the same forecastNo is ignored).
  insert into public.mystery_forecasts (session_id, station_id, forecast_no, t, target, value, model_label, model_version, features)
  select p_session_id, p_station_id, f."forecastNo", f.t, f.target, f.value, f."modelLabel", f."modelVersion", f.features
  from jsonb_to_recordset(p_forecasts) as f("forecastNo" integer, t double precision, target text, value numeric,
                                             "modelLabel" text, "modelVersion" text, features jsonb)
  on conflict (session_id, forecast_no) do nothing;
  get diagnostics v_fc = row_count;

  -- Recommendations: the advice is fixed at issue; `accepted` / `outcome` may only go from null to a value.
  insert into public.mystery_recommendations as r (session_id, station_id, rec_no, t, action, advice, trigger, accepted, outcome)
  select p_session_id, p_station_id, x."recNo", x.t, x.action, x.advice, coalesce(x.trigger, 'hint'), x.accepted, x.outcome
  from jsonb_to_recordset(p_recommendations) as x("recNo" integer, t double precision, action text, advice text, trigger text,
                                                   accepted boolean, outcome text)
  on conflict (session_id, rec_no) do update set
    accepted   = coalesce(r.accepted, excluded.accepted),
    outcome    = coalesce(r.outcome, excluded.outcome),
    updated_at = now()
  where r.accepted is null or r.outcome is null;
  get diagnostics v_rc = row_count;

  perform private.mystery_project_status(p_session_id);

  return jsonb_build_object('ok', true, 'lastSeq', v_last_seq, 'lastT', v_last_t, 'inserted', v_n,
                            'eventCount', v_session.event_count + v_n, 'terminal', coalesce(v_session.terminal_type, v_terminal),
                            'forecastsInserted', v_fc, 'recommendationsUpserted', v_rc);
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- mystery_finalize_session: publish the server-recomputed result exactly once. A second call (any body)
-- returns the stored row unchanged ({replay:true}).
-- ---------------------------------------------------------------------------------------------
create function public.mystery_finalize_session(
  p_session_id        uuid,
  p_station_id        text,
  p_expected_last_seq integer,
  p_result            jsonb,
  p_request           jsonb
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_now     timestamptz := date_trunc('milliseconds', now());
  v_session public.mystery_sessions%rowtype;
  v_row     public.mystery_results%rowtype;
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

  insert into public.mystery_results (
    session_id, station_id, nickname, character_id, pokemon_id, rules_version, outcome, dnf_reason, verdict, accused,
    correct, clues_found, egg_tier, egg_points, egg_security, active_time_s, score, catches, sightings, hints_used,
    client_claim, claim_matches, is_test, finalized_at
  ) values (
    p_session_id, v_session.station_id, v_session.nickname, v_session.character_id, v_session.pokemon_id,
    v_session.rules_version, v_outcome, p_result ->> 'dnfReason', p_result ->> 'verdict', p_result ->> 'accused',
    (p_result ->> 'correct')::boolean,
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

-- ---------------------------------------------------------------------------------------------
-- mystery_abandon_station: operator reset (admin-reset) — abandons every open mystery session of the station
-- (unranked) and puts the public row back to idle with a notice. Audit row is written by admin-reset through
-- the v2.5 operator_reset_station RPC (one audit row per reset, covering both games).
-- ---------------------------------------------------------------------------------------------
create function public.mystery_abandon_station(
  p_station_id text,
  p_reason     text,
  p_request    jsonb
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_now  timestamptz := date_trunc('milliseconds', now());
  v_old  record;
  v_ids  uuid[] := '{}';
begin
  if p_station_id is null or p_reason is null or p_request is null then
    return private.rpc_error('INVALID_INPUT', 'missing argument');
  end if;
  if p_reason not in ('operator_reset', 'player_reset') then
    return private.rpc_error('INVALID_INPUT', 'unknown abandon reason');
  end if;
  perform 1 from public.stations st where st.id = p_station_id for update;
  if not found then
    return private.rpc_error('STATION_NOT_FOUND', 'unknown station');
  end if;
  for v_old in
    select s.id from public.mystery_sessions s
    where s.station_id = p_station_id and s.status in ('offered', 'playing')
    for update
  loop
    update public.mystery_sessions set
      status = 'abandoned', abandoned_reason = p_reason, abandoned_at = v_now, updated_at = v_now
    where id = v_old.id;
    insert into public.mystery_session_actions (session_id, action_id, action_type, actor_user_id, request)
    values (v_old.id, 'sys_abandon', 'abandon', nullif(p_request #>> '{actor,userId}', '')::uuid,
            p_request || jsonb_build_object('abandonReason', p_reason));
    v_ids := array_append(v_ids, v_old.id);
  end loop;
  perform private.mystery_clear_status(p_station_id, p_reason);
  return jsonb_build_object('ok', true, 'abandonedSessionIds', to_jsonb(v_ids));
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Privileges: service_role only.
-- ---------------------------------------------------------------------------------------------
revoke execute on function public.mystery_create_session(uuid, text, text, text, text, jsonb, boolean, jsonb) from public, anon, authenticated;
revoke execute on function public.mystery_select_duo(uuid, text, text, text, jsonb) from public, anon, authenticated;
revoke execute on function public.mystery_append_events(uuid, text, integer, jsonb, jsonb, jsonb, jsonb) from public, anon, authenticated;
revoke execute on function public.mystery_finalize_session(uuid, text, integer, jsonb, jsonb) from public, anon, authenticated;
revoke execute on function public.mystery_abandon_station(text, text, jsonb) from public, anon, authenticated;

grant execute on function public.mystery_create_session(uuid, text, text, text, text, jsonb, boolean, jsonb) to service_role;
grant execute on function public.mystery_select_duo(uuid, text, text, text, jsonb) to service_role;
grant execute on function public.mystery_append_events(uuid, text, integer, jsonb, jsonb, jsonb, jsonb) to service_role;
grant execute on function public.mystery_finalize_session(uuid, text, integer, jsonb, jsonb) to service_role;
grant execute on function public.mystery_abandon_station(text, text, jsonb) to service_role;

revoke execute on function private.mystery_project_status(uuid) from public, anon, authenticated;
revoke execute on function private.mystery_clear_status(text, text) from public, anon, authenticated;
