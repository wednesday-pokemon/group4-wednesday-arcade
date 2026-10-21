-- Atomic session RPCs. SECURITY DEFINER, empty search_path, EXECUTE for service_role only.
-- The Edge Functions compute every new GameState with the shared engine; these RPCs only
-- (1) serialize writers with row locks, (2) enforce idempotency + optimistic concurrency,
-- (3) persist the snapshot, receipts and public projections in ONE transaction.
--
-- Lock order everywhere: stations row -> sessions row(s). This prevents deadlocks between
-- create_session_atomic (which supersedes the old session) and commit_session_transition.
--
-- Return envelope (never raises for expected business outcomes):
--   success: {"ok": true, "replay": <bool>, "response": <stored or new response>, ...}
--   failure: {"ok": false, "error": "<CODE>", "message": "...", ...details}
-- Unexpected faults (constraint violations, bad casts) raise and roll back the whole transaction.

create function private.rpc_error(p_code text, p_message text, p_details jsonb default '{}'::jsonb)
returns jsonb language sql immutable set search_path = '' as $$
  select jsonb_build_object('ok', false, 'error', p_code, 'message', p_message) || coalesce(p_details, '{}'::jsonb)
$$;

-- Upsert the sanitized public projection of a (non-abandoned) session onto its station row.
create function private.project_station_status(p_session_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  insert into public.station_status as ss (
    station_id, label, session_id, nickname, character_id, pokemon_id, status, phase, leg_index,
    route, push_level, weather, hp, stamina, gap_m, catches, banked_eggs, sim_time_cs, final_score,
    notice, revision, updated_at
  )
  select
    s.station_id, st.label, s.id, s.nickname, s.character_id, s.pokemon_id, s.status, s.phase, s.leg_index,
    s.prepared ->> 'route', (s.prepared ->> 'pushLevel')::smallint, s.prepared ->> 'weather',
    s.hp, s.stamina, s.gap_m, s.hyde_catch_count, s.banked_egg_points, s.total_simulated_time_cs, s.final_score,
    null, s.revision, now()
  from public.sessions s
  join public.stations st on st.id = s.station_id
  where s.id = p_session_id and s.status <> 'abandoned'
  on conflict (station_id) do update set
    label = excluded.label, session_id = excluded.session_id, nickname = excluded.nickname,
    character_id = excluded.character_id, pokemon_id = excluded.pokemon_id, status = excluded.status,
    phase = excluded.phase, leg_index = excluded.leg_index, route = excluded.route,
    push_level = excluded.push_level, weather = excluded.weather, hp = excluded.hp, stamina = excluded.stamina,
    gap_m = excluded.gap_m, catches = excluded.catches, banked_eggs = excluded.banked_eggs,
    sim_time_cs = excluded.sim_time_cs, final_score = excluded.final_score, notice = null,
    revision = excluded.revision, updated_at = excluded.updated_at;
end;
$$;

-- Put a station's public row back to idle, with a notice the terminal/dashboard can display.
create function private.clear_station_status(p_station_id text, p_notice text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  update public.station_status set
    session_id = null, nickname = null, character_id = null, pokemon_id = null, status = 'idle', phase = null,
    leg_index = null, route = null, push_level = null, weather = null, hp = null, stamina = null, gap_m = null,
    catches = null, banked_eggs = null, sim_time_cs = null, final_score = null,
    notice = p_notice, revision = revision + 1, updated_at = now()
  where station_id = p_station_id;
  update public.stations set active_session_id = null where id = p_station_id;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- create_session_atomic
-- ---------------------------------------------------------------------------------------------
create function public.create_session_atomic(
  p_session_id      uuid,
  p_station_id      text,
  p_action_id       text,
  p_seed            text,
  p_seed_commitment text,
  p_state           jsonb,
  p_request         jsonb,
  p_response        jsonb,
  p_model_version   text default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_now        timestamptz := date_trunc('milliseconds', now()); -- ms precision = engine compareScoreRecords tiebreak
  v_actor      uuid := nullif(p_request #>> '{actor,userId}', '')::uuid;
  v_existing   uuid;
  v_receipt    jsonb;
  v_old        record;
  v_superseded uuid[] := '{}';
  v_recent     integer;
begin
  if p_session_id is null or p_station_id is null or p_action_id is null or p_seed is null
     or p_seed_commitment is null or p_state is null or p_request is null or p_response is null then
    return private.rpc_error('INVALID_INPUT', 'missing argument');
  end if;
  if p_action_id !~ '^[A-Za-z0-9_-]{8,64}$' then
    return private.rpc_error('INVALID_INPUT', 'malformed action id');
  end if;
  if p_seed !~ '^[0-9a-f]{32}$' then
    return private.rpc_error('INVALID_INPUT', 'malformed seed');
  end if;
  -- Defence in depth: the published commitment must really be SHA-256(seed).
  if p_seed_commitment <> encode(sha256(convert_to(p_seed, 'UTF8')), 'hex') then
    return private.rpc_error('INVALID_INPUT', 'seed commitment mismatch');
  end if;

  -- Serialize all creates for this station.
  perform 1 from public.stations st where st.id = p_station_id for update;
  if not found then
    return private.rpc_error('STATION_NOT_FOUND', 'unknown station');
  end if;

  -- Idempotent replay of the same create request (double click / network retry).
  select s.id into v_existing from public.sessions s
  where s.station_id = p_station_id and s.create_action_id = p_action_id;
  if found then
    select a.response into v_receipt from public.session_actions a
    where a.session_id = v_existing and a.action_id = p_action_id and a.action_type = 'create';
    if (select a.request -> 'body' from public.session_actions a
        where a.session_id = v_existing and a.action_id = p_action_id) is distinct from p_request -> 'body' then
      return private.rpc_error('ACTION_ID_CONFLICT', 'action id already used with a different request');
    end if;
    return jsonb_build_object('ok', true, 'replay', true, 'response', v_receipt, 'sessionId', v_existing);
  end if;

  -- Abuse brake: at most 6 new sessions per station per minute.
  select count(*) into v_recent from public.sessions s
  where s.station_id = p_station_id and s.created_at > v_now - interval '60 seconds';
  if v_recent >= 6 then
    return private.rpc_error('RATE_LIMITED', 'too many sessions created on this station; wait a minute');
  end if;

  -- Validate the engine-produced initial state.
  if (p_state ->> 'sessionId') is distinct from p_session_id::text
     or (p_state ->> 'status') is distinct from 'in_progress'
     or (p_state ->> 'phase') is distinct from 'awaiting_route'
     or (p_state ->> 'legIndex') is distinct from '1'
     or jsonb_typeof(p_state -> 'flags') is distinct from 'object' then
    return private.rpc_error('INVALID_TRANSITION', 'initial state is not a fresh in-progress session');
  end if;

  -- Supersede whatever is still running on this station (unranked).
  for v_old in
    select s.id, s.revision, s.state from public.sessions s
    where s.station_id = p_station_id and s.status = 'in_progress'
    for update
  loop
    update public.sessions set
      status = 'abandoned', phase = 'complete', abandoned_reason = 'superseded', abandoned_at = v_now,
      final_score = null, final_egg_points = null, prepared = null, revision = v_old.revision + 1, updated_at = v_now,
      -- mirrors src/game/rules.ts abandonSession() field-for-field (status, phase, prepared, scores, revision+1)
      state = v_old.state || jsonb_build_object(
        'status', 'abandoned', 'phase', 'complete', 'prepared', null, 'revision', v_old.revision + 1,
        'finalScore', null, 'finalEggPoints', null)
    where id = v_old.id;
    insert into public.session_actions
      (session_id, action_id, action_type, actor_user_id, revision_before, revision_after, request, response)
    values (
      v_old.id, 'sys_superseded_' || replace(p_session_id::text, '-', ''), 'abandon', v_actor,
      v_old.revision, v_old.revision + 1,
      jsonb_build_object('body', jsonb_build_object('supersededBy', p_session_id),
                         'abandonReason', 'superseded', 'actor', p_request -> 'actor'),
      jsonb_build_object('supersededBy', p_session_id)
    );
    v_superseded := array_append(v_superseded, v_old.id);
  end loop;

  insert into public.sessions (
    id, station_id, create_action_id, nickname, character_id, pokemon_id, status, phase, leg_index, revision,
    hp, stamina, gap_m, hyde_catch_count, banked_egg_points, unbanked_egg_points, total_simulated_time_cs,
    final_egg_points, final_score, dnf_reason, flags, prepared, state, rules_version, model_version,
    seed_commitment, created_at, updated_at
  ) values (
    p_session_id, p_station_id, p_action_id, p_state ->> 'nickname', p_state ->> 'characterId', p_state ->> 'pokemonId',
    'in_progress', 'awaiting_route', 1, (p_state ->> 'revision')::integer,
    greatest(0, least(100, (p_state ->> 'hp')::numeric))::smallint,
    (p_state ->> 'stamina')::smallint,
    (p_state ->> 'pursuitGapM')::numeric::integer,
    (p_state ->> 'hydeCatchCount')::smallint,
    (p_state ->> 'bankedEggPoints')::integer,
    (p_state ->> 'unbankedEggPoints')::integer,
    (p_state ->> 'totalSimulatedTimeCs')::integer,
    null, null, null, p_state -> 'flags', null, p_state, p_state ->> 'rulesVersion', p_model_version,
    p_seed_commitment, v_now, v_now
  );

  insert into public.session_secrets (session_id, seed) values (p_session_id, p_seed);

  insert into public.session_actions
    (session_id, action_id, action_type, actor_user_id, revision_before, revision_after, request, response)
  values (p_session_id, p_action_id, 'create', v_actor, null, (p_state ->> 'revision')::integer, p_request, p_response);

  update public.stations set active_session_id = p_session_id where id = p_station_id;
  perform private.project_station_status(p_session_id);

  return jsonb_build_object('ok', true, 'replay', false, 'response', p_response,
                            'sessionId', p_session_id, 'supersededSessionIds', to_jsonb(v_superseded));
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- commit_session_transition
-- ---------------------------------------------------------------------------------------------
create function public.commit_session_transition(
  p_session_id        uuid,
  p_expected_revision integer,
  p_action_id         text,
  p_action_type       text,
  p_request           jsonb,
  p_new_state         jsonb,
  p_leg_result        jsonb,
  p_response          jsonb
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_now            timestamptz := date_trunc('milliseconds', now()); -- ms precision = engine compareScoreRecords tiebreak
  v_actor          uuid := nullif(p_request #>> '{actor,userId}', '')::uuid;
  v_station_id     text;
  v_session        public.sessions%rowtype;
  v_receipt        public.session_actions%rowtype;
  v_status         text;
  v_new_revision   integer;
  v_abandon_reason text;
  v_terminal       boolean;
begin
  if p_session_id is null or p_expected_revision is null or p_action_id is null or p_action_type is null
     or p_request is null or p_new_state is null or p_response is null then
    return private.rpc_error('INVALID_INPUT', 'missing argument');
  end if;
  if p_action_type not in ('prepare', 'resolve', 'abandon') then
    return private.rpc_error('INVALID_INPUT', 'unknown action type');
  end if;
  if p_action_id !~ '^[A-Za-z0-9_-]{8,64}$' then
    return private.rpc_error('INVALID_INPUT', 'malformed action id');
  end if;

  -- station_id is immutable, so reading it unlocked is safe; then lock station -> session.
  select s.station_id into v_station_id from public.sessions s where s.id = p_session_id;
  if not found then
    return private.rpc_error('SESSION_NOT_FOUND', 'session not found');
  end if;
  perform 1 from public.stations st where st.id = v_station_id for update;
  select * into v_session from public.sessions s where s.id = p_session_id for update;

  -- 1) Idempotent replay: same (session, action_id) => return the stored response unchanged.
  select * into v_receipt from public.session_actions a
  where a.session_id = p_session_id and a.action_id = p_action_id;
  if found then
    if v_receipt.action_type <> p_action_type or (v_receipt.request -> 'body') is distinct from (p_request -> 'body') then
      return private.rpc_error('ACTION_ID_CONFLICT', 'action id already used with a different request');
    end if;
    return jsonb_build_object('ok', true, 'replay', true, 'response', v_receipt.response);
  end if;

  -- 2) Closed sessions never change again.
  if v_session.status <> 'in_progress' then
    return private.rpc_error('SESSION_CLOSED', 'session is no longer in progress',
      jsonb_build_object('status', v_session.status, 'abandonedReason', v_session.abandoned_reason));
  end if;

  -- 3) Optimistic concurrency.
  if v_session.revision <> p_expected_revision then
    return private.rpc_error('STALE_REVISION', 'session changed since it was read',
      jsonb_build_object('currentRevision', v_session.revision));
  end if;

  -- 4) Sanity of the engine output (defence in depth; the engine is the authority on rules).
  v_status := p_new_state ->> 'status';
  v_new_revision := (p_new_state ->> 'revision')::integer;
  if (p_new_state ->> 'sessionId') is distinct from p_session_id::text
     or (p_new_state ->> 'nickname') is distinct from v_session.nickname
     or (p_new_state ->> 'characterId') is distinct from v_session.character_id
     or (p_new_state ->> 'pokemonId') is distinct from v_session.pokemon_id
     or v_new_revision is null or v_new_revision <= v_session.revision
     or v_status is null
     or (p_action_type = 'prepare' and (v_status <> 'in_progress' or p_leg_result is not null))
     or (p_action_type = 'resolve' and (v_status = 'abandoned' or p_leg_result is null))
     or (p_action_type = 'abandon' and (v_status <> 'abandoned' or p_leg_result is not null))
     or (p_leg_result is not null and (p_leg_result ->> 'legIndex') is distinct from v_session.leg_index::text)
  then
    return private.rpc_error('INVALID_TRANSITION', 'new state is not a valid successor of the stored state');
  end if;
  if v_status = 'abandoned' then
    v_abandon_reason := p_request ->> 'abandonReason';
    if v_abandon_reason is null or v_abandon_reason not in ('player_reset', 'operator_reset') then
      return private.rpc_error('INVALID_TRANSITION', 'abandon requires a server-set abandonReason');
    end if;
  end if;
  v_terminal := v_status in ('completed', 'dnf');

  update public.sessions set
    status                  = v_status,
    phase                   = p_new_state ->> 'phase',
    leg_index               = (p_new_state ->> 'legIndex')::smallint,
    revision                = v_new_revision,
    hp                      = greatest(0, least(100, (p_new_state ->> 'hp')::numeric))::smallint,
    stamina                 = (p_new_state ->> 'stamina')::smallint,
    gap_m                   = (p_new_state ->> 'pursuitGapM')::numeric::integer,
    hyde_catch_count        = (p_new_state ->> 'hydeCatchCount')::smallint,
    banked_egg_points       = (p_new_state ->> 'bankedEggPoints')::integer,
    unbanked_egg_points     = (p_new_state ->> 'unbankedEggPoints')::integer,
    total_simulated_time_cs = (p_new_state ->> 'totalSimulatedTimeCs')::integer,
    final_egg_points        = case when v_terminal then (p_new_state ->> 'finalEggPoints')::integer end,
    final_score             = case when v_terminal then (p_new_state ->> 'finalScore')::numeric(10, 2) end,
    dnf_reason              = p_new_state ->> 'dnfReason',
    flags                   = p_new_state -> 'flags',
    prepared                = nullif(p_new_state -> 'prepared', 'null'::jsonb),
    state                   = p_new_state,
    updated_at              = v_now,
    completed_at            = case when v_terminal then v_now end,
    verified_at             = case when v_terminal then v_now end,
    abandoned_at            = case when v_status = 'abandoned' then v_now end,
    abandoned_reason        = v_abandon_reason
  where id = p_session_id;

  if p_leg_result is not null then
    insert into public.leg_results (
      session_id, station_id, leg_index, route, push_level, weather, egg_offer, egg_decision, crash, hyde_catch,
      outcome, leg_time_cs, time_breakdown, resolution, draws
    ) values (
      p_session_id, v_station_id, (p_leg_result ->> 'legIndex')::smallint, p_leg_result ->> 'route',
      (p_leg_result ->> 'pushLevel')::smallint, p_leg_result ->> 'weather', p_leg_result ->> 'eggOffer',
      p_leg_result ->> 'eggDecision', (p_leg_result ->> 'crashOccurred')::boolean,
      (p_leg_result ->> 'hydeCatch')::boolean, p_leg_result ->> 'outcome',
      (p_leg_result #>> '{time,totalCs}')::integer, p_leg_result -> 'time',
      p_leg_result - 'draws', coalesce(p_leg_result -> 'draws', '{}'::jsonb)
    );
  end if;

  insert into public.session_actions
    (session_id, action_id, action_type, actor_user_id, revision_before, revision_after, request, response)
  values (p_session_id, p_action_id, p_action_type, v_actor, v_session.revision, v_new_revision, p_request, p_response);

  if v_status = 'abandoned' then
    if (select ss.session_id from public.station_status ss where ss.station_id = v_station_id) = p_session_id then
      perform private.clear_station_status(v_station_id, v_abandon_reason);
    end if;
    update public.stations set active_session_id = null where id = v_station_id and active_session_id = p_session_id;
  else
    perform private.project_station_status(p_session_id);
    if v_terminal then
      update public.stations set active_session_id = null where id = v_station_id and active_session_id = p_session_id;
      -- Single publication: the PK + ON CONFLICT DO NOTHING + immutability trigger make a second write impossible.
      insert into public.leaderboard_entries (
        session_id, nickname, station_id, character_id, pokemon_id, status, final_egg_points,
        total_simulated_time_cs, final_score, dnf_reason, dnf_leg, rules_version, verified_at
      )
      select s.id, s.nickname, s.station_id, s.character_id, s.pokemon_id, s.status,
             case when s.status = 'dnf' then 0 else s.final_egg_points end,
             s.total_simulated_time_cs,
             case when s.status = 'dnf' then 0 else s.final_score end,
             s.dnf_reason,
             case when s.status = 'dnf' then v_session.leg_index end,
             s.rules_version, s.verified_at
      from public.sessions s where s.id = p_session_id
      on conflict (session_id) do nothing;
    end if;
  end if;

  return jsonb_build_object('ok', true, 'replay', false, 'response', p_response);
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- release_station: player leaves the results screen -> station shows idle (only if that finished
-- session is still the one on display). No-op otherwise.
-- ---------------------------------------------------------------------------------------------
create function public.release_station(p_station_id text, p_session_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_cleared boolean := false;
begin
  perform 1 from public.stations st where st.id = p_station_id for update;
  if not found then
    return private.rpc_error('STATION_NOT_FOUND', 'unknown station');
  end if;
  if exists (
    select 1 from public.station_status ss
    where ss.station_id = p_station_id and ss.session_id = p_session_id and ss.status in ('completed', 'dnf')
  ) then
    perform private.clear_station_status(p_station_id, null);
    v_cleared := true;
  end if;
  return jsonb_build_object('ok', true, 'cleared', v_cleared);
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- operator_reset_station: called by admin-reset AFTER it abandoned any in-progress session through
-- commit_session_transition (engine-computed). Clears the public row and writes the audit record.
-- ---------------------------------------------------------------------------------------------
create function public.operator_reset_station(
  p_station_id text, p_actor_user_id uuid, p_note text, p_session_ids uuid[]
) returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if p_actor_user_id is null then
    return private.rpc_error('INVALID_INPUT', 'actor required');
  end if;
  perform 1 from public.stations st where st.id = p_station_id for update;
  if not found then
    return private.rpc_error('STATION_NOT_FOUND', 'unknown station');
  end if;
  if exists (select 1 from public.sessions s where s.station_id = p_station_id and s.status = 'in_progress') then
    return private.rpc_error('SESSION_STILL_ACTIVE', 'abandon the in-progress session first');
  end if;
  perform private.clear_station_status(p_station_id, 'operator_reset');
  insert into public.operator_audit (actor_user_id, station_id, action, session_ids, note)
  values (p_actor_user_id, p_station_id, 'station_reset', coalesce(p_session_ids, '{}'), left(p_note, 200));
  return jsonb_build_object('ok', true);
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Privileges: service_role only.
-- ---------------------------------------------------------------------------------------------
revoke execute on function public.create_session_atomic(uuid, text, text, text, text, jsonb, jsonb, jsonb, text)
  from public, anon, authenticated;
revoke execute on function public.commit_session_transition(uuid, integer, text, text, jsonb, jsonb, jsonb, jsonb)
  from public, anon, authenticated;
revoke execute on function public.release_station(text, uuid) from public, anon, authenticated;
revoke execute on function public.operator_reset_station(text, uuid, text, uuid[]) from public, anon, authenticated;

grant execute on function public.create_session_atomic(uuid, text, text, text, text, jsonb, jsonb, jsonb, text) to service_role;
grant execute on function public.commit_session_transition(uuid, integer, text, text, jsonb, jsonb, jsonb, jsonb) to service_role;
grant execute on function public.release_station(text, uuid) to service_role;
grant execute on function public.operator_reset_station(text, uuid, text, uuid[]) to service_role;

revoke execute on function private.rpc_error(text, text, jsonb) from public, anon, authenticated;
revoke execute on function private.project_station_status(uuid) from public, anon, authenticated;
revoke execute on function private.clear_station_status(text, text) from public, anon, authenticated;
