-- Atomic RPC semantics: idempotent replay, stale revision, closed sessions, single leaderboard
-- publication, supersede-on-create, abandon -> station notice, operator reset audit.
begin;
create extension if not exists pgtap with schema extensions;
select plan(65);

-- Isolation: start from an empty game state even on a database with real data. Everything in this file
-- runs inside one transaction that is ROLLED BACK at the end, so nothing below is persisted.
do $$
begin
  perform private.clear_station_status('station_a', null);
  perform private.clear_station_status('station_b', null);
  delete from public.operator_audit;
  delete from public.sessions; -- cascades to secrets, leg_results, session_actions, leaderboard_entries
end;
$$;


create function pg_temp.st(p_id uuid, p_nick text, p_extra jsonb default '{}'::jsonb) returns jsonb
language sql as $$
  select jsonb_build_object(
    'rulesVersion', 'v2.5', 'sessionId', p_id, 'nickname', p_nick, 'characterId', 'eugene', 'pokemonId', 'sableye',
    'status', 'in_progress', 'phase', 'awaiting_route', 'legIndex', 1, 'revision', 0, 'hp', 100, 'stamina', 6,
    'pursuitGapM', 100, 'hydeCatchCount', 0, 'bankedEggPoints', 0, 'unbankedEggPoints', 0, 'totalSimulatedTimeCs', 0,
    'flags', jsonb_build_object('gengarWeatherUsed', false, 'xavierCrashUsed', false, 'rowanCrashUsed', false, 'firstCatchResolved', false),
    'prepared', null, 'legResults', '[]'::jsonb, 'finalEggPoints', null, 'finalScore', null, 'dnfReason', null) || p_extra
$$;
create function pg_temp.req(p_body jsonb, p_extra jsonb default '{}'::jsonb) returns jsonb
language sql as $$
  select jsonb_build_object('body', p_body, 'actor', jsonb_build_object('userId', 'aaaaaaaa-0000-4000-8000-000000000001', 'role', 'station')) || p_extra
$$;
create function pg_temp.mk(p_id uuid, p_station text, p_action text, p_seed text, p_nick text) returns jsonb
language sql as $$
  select public.create_session_atomic(
    p_id, p_station, p_action, p_seed, encode(sha256(convert_to(p_seed, 'UTF8')), 'hex'),
    pg_temp.st(p_id, p_nick), pg_temp.req(jsonb_build_object('nickname', p_nick)),
    jsonb_build_object('view', jsonb_build_object('sessionId', p_id, 'tag', 'created')))
$$;
create function pg_temp.leg(p_leg int, p_outcome text) returns jsonb
language sql as $$
  select jsonb_build_object('legIndex', p_leg, 'route', 'shortcut', 'pushLevel', 2, 'weather', 'heavy_fog', 'eggOffer', 'rare',
    'eggDecision', 'collect', 'crashOccurred', true, 'hydeCatch', false, 'outcome', p_outcome,
    'time', jsonb_build_object('totalCs', 3120), 'draws', jsonb_build_object('crash', 0.01, 'eggFailure', 0.9, 'hyde', 0.7))
$$;

-- ---------------------------------------------------------------- create -------------------------
select is((pg_temp.mk('a0000000-0000-4000-8000-000000000001', 'station_a', 'create_00000001', '00000000000000000000000000000001', 'Alice')) -> 'replay',
  'false'::jsonb, 'create succeeds (not a replay)');
select is((pg_temp.mk('a0000000-0000-4000-8000-000000000099', 'station_a', 'create_00000001', '00000000000000000000000000000099', 'Alice')) ->> 'sessionId',
  'a0000000-0000-4000-8000-000000000001', 'double-click create with same action id replays the original session');
select is((select count(*)::int from public.sessions where station_id = 'station_a'), 1, 'replayed create inserted nothing');
select is((pg_temp.mk('a0000000-0000-4000-8000-000000000098', 'station_a', 'create_00000001', '00000000000000000000000000000098', 'Mallory')) ->> 'error',
  'ACTION_ID_CONFLICT', 'same create action id with a different body is rejected');
select is((public.create_session_atomic('a0000000-0000-4000-8000-000000000097', 'station_a', 'create_00000097', '00000000000000000000000000000097',
            repeat('0', 64), pg_temp.st('a0000000-0000-4000-8000-000000000097', 'Eve'), pg_temp.req('{}'), '{}')) ->> 'error',
  'INVALID_INPUT', 'commitment that is not SHA-256(seed) is rejected');
select is((select seed from public.session_secrets where session_id = 'a0000000-0000-4000-8000-000000000001'),
  '00000000000000000000000000000001', 'seed stored only in session_secrets');
select is((select seed_commitment from public.sessions where id = 'a0000000-0000-4000-8000-000000000001'),
  encode(sha256(convert_to('00000000000000000000000000000001', 'UTF8')), 'hex'), 'commitment = sha256(seed)');
select is((select status || ':' || session_id::text from public.station_status where station_id = 'station_a'),
  'in_progress:a0000000-0000-4000-8000-000000000001', 'station_status projects the new session');
select is((select active_session_id from public.stations where id = 'station_a'),
  'a0000000-0000-4000-8000-000000000001'::uuid, 'stations.active_session_id set');

-- ---------------------------------------------------------------- prepare + replay + stale -------
select is((public.commit_session_transition('a0000000-0000-4000-8000-000000000001', 0, 'prepare_0000001', 'prepare',
            pg_temp.req('{"route":"shortcut","pushLevel":2}'),
            pg_temp.st('a0000000-0000-4000-8000-000000000001', 'Alice', jsonb_build_object('revision', 1, 'phase', 'awaiting_egg',
              'prepared', jsonb_build_object('route', 'shortcut', 'pushLevel', 2, 'weather', 'heavy_fog', 'legIndex', 1))),
            null, '{"view":"after-prepare"}')) -> 'response',
  '{"view":"after-prepare"}'::jsonb, 'prepare commits and returns the response');
select is((select revision from public.sessions where id = 'a0000000-0000-4000-8000-000000000001'), 1, 'revision bumped to 1');
select is((select phase || ':' || route || ':' || weather from public.station_status where station_id = 'station_a'),
  'awaiting_egg:shortcut:heavy_fog', 'station_status shows prepared route and weather');

select is((public.commit_session_transition('a0000000-0000-4000-8000-000000000001', 0, 'prepare_0000001', 'prepare',
            pg_temp.req('{"route":"shortcut","pushLevel":2}'),
            pg_temp.st('a0000000-0000-4000-8000-000000000001', 'Alice', jsonb_build_object('revision', 1, 'phase', 'awaiting_egg',
              'prepared', jsonb_build_object('route', 'shortcut', 'pushLevel', 2, 'weather', 'heavy_fog', 'legIndex', 1))),
            null, '{"view":"DIFFERENT"}')),
  '{"ok":true,"replay":true,"response":{"view":"after-prepare"}}'::jsonb, 'retry with same action id returns the STORED response');
select is((select count(*)::int from public.session_actions where session_id = 'a0000000-0000-4000-8000-000000000001' and action_type = 'prepare'),
  1, 'replay wrote no second receipt');
select is((select revision from public.sessions where id = 'a0000000-0000-4000-8000-000000000001'), 1, 'replay did not bump revision');

select is((public.commit_session_transition('a0000000-0000-4000-8000-000000000001', 0, 'prepare_0000002', 'prepare',
            pg_temp.req('{"route":"safe","pushLevel":1}'),
            pg_temp.st('a0000000-0000-4000-8000-000000000001', 'Alice', jsonb_build_object('revision', 1, 'phase', 'awaiting_egg',
              'prepared', jsonb_build_object('route', 'safe', 'pushLevel', 1, 'weather', 'heavy_fog', 'legIndex', 1))),
            null, '{}')) - 'message',
  '{"ok":false,"error":"STALE_REVISION","currentRevision":1}'::jsonb, 'different action on an old revision -> STALE_REVISION');
select is((public.commit_session_transition('a0000000-0000-4000-8000-000000000001', 1, 'prepare_0000001', 'resolve',
            pg_temp.req('{"eggDecision":"collect"}'), pg_temp.st('a0000000-0000-4000-8000-000000000001', 'Alice', '{"revision":2}'),
            pg_temp.leg(1, 'survived'), '{}')) ->> 'error',
  'ACTION_ID_CONFLICT', 'reusing an action id for another action type is rejected');
select is((public.commit_session_transition('a0000000-0000-4000-8000-000000000001', 1, 'resolve_0000bad', 'resolve',
            pg_temp.req('{"eggDecision":"collect"}'), pg_temp.st('a0000000-0000-4000-8000-000000000002', 'Alice', '{"revision":2}'),
            pg_temp.leg(1, 'survived'), '{}')) ->> 'error',
  'INVALID_TRANSITION', 'state for a different session id is rejected');
select is((public.commit_session_transition('a0000000-0000-4000-8000-000000000001', 1, 'resolve_0000bad', 'resolve',
            pg_temp.req('{"eggDecision":"collect"}'), pg_temp.st('a0000000-0000-4000-8000-000000000001', 'Hacker', '{"revision":2}'),
            pg_temp.leg(1, 'survived'), '{}')) ->> 'error',
  'INVALID_TRANSITION', 'changing the nickname mid-session is rejected');
select is((public.commit_session_transition('a0000000-0000-4000-8000-000000000001', 1, 'resolve_0000bad', 'resolve',
            pg_temp.req('{"eggDecision":"collect"}'), pg_temp.st('a0000000-0000-4000-8000-000000000001', 'Alice', '{"revision":1}'),
            pg_temp.leg(1, 'survived'), '{}')) ->> 'error',
  'INVALID_TRANSITION', 'non-increasing revision is rejected');
select is((public.commit_session_transition('a0000000-0000-4000-8000-000000000001', 1, 'resolve_0000bad', 'resolve',
            pg_temp.req('{"eggDecision":"collect"}'), pg_temp.st('a0000000-0000-4000-8000-000000000001', 'Alice', '{"revision":2}'),
            pg_temp.leg(2, 'survived'), '{}')) ->> 'error',
  'INVALID_TRANSITION', 'leg result for the wrong leg is rejected');
select is((public.commit_session_transition('a0000000-0000-4000-8000-000000000009', 0, 'resolve_0000bad', 'resolve',
            '{}', '{}', null, '{}')) ->> 'error',
  'SESSION_NOT_FOUND', 'unknown session id -> SESSION_NOT_FOUND');
select is((public.commit_session_transition('a0000000-0000-4000-8000-000000000001', 1, 'bad id!', 'resolve',
            '{}', '{}', null, '{}')) ->> 'error',
  'INVALID_INPUT', 'malformed action id -> INVALID_INPUT');

-- ---------------------------------------------------------------- resolve legs -> completed ------
select is((public.commit_session_transition('a0000000-0000-4000-8000-000000000001', 1, 'resolve_0000001', 'resolve',
            pg_temp.req('{"eggDecision":"collect"}'),
            pg_temp.st('a0000000-0000-4000-8000-000000000001', 'Alice', '{"revision":2,"legIndex":2,"bankedEggPoints":4,"totalSimulatedTimeCs":3120}'),
            pg_temp.leg(1, 'survived'), '{"view":"leg1"}')) ->> 'ok',
  'true', 'leg 1 resolve commits');
select is((select resolution ? 'draws' from public.leg_results where session_id = 'a0000000-0000-4000-8000-000000000001' and leg_index = 1),
  false, 'leg_results.resolution is stored without draws');
select is((select (draws ->> 'crash')::numeric from public.leg_results where session_id = 'a0000000-0000-4000-8000-000000000001' and leg_index = 1),
  0.01, 'draws kept in the service-only column');
select is((select leg_time_cs || ':' || crash::text || ':' || route from public.leg_results where session_id = 'a0000000-0000-4000-8000-000000000001'),
  '3120:true:shortcut', 'key columns projected from the resolution');
select is((select banked_eggs from public.station_status where station_id = 'station_a'), 4, 'station_status banked eggs updated');
select is((select count(*)::int from public.leaderboard_entries), 0, 'nothing published while in progress');

select is((public.commit_session_transition('a0000000-0000-4000-8000-000000000001', 2, 'resolve_0000002', 'resolve',
            pg_temp.req('{"eggDecision":"collect","leg":3}'),
            pg_temp.st('a0000000-0000-4000-8000-000000000001', 'Alice',
              '{"revision":3,"legIndex":3,"status":"completed","phase":"complete","bankedEggPoints":8,"finalEggPoints":8,"totalSimulatedTimeCs":9360,"finalScore":706.40}'),
            pg_temp.leg(2, 'finished'), '{"view":"final"}')) ->> 'ok',
  'true', 'finishing resolve commits');
select is((select status || ':' || final_score::text from public.sessions where id = 'a0000000-0000-4000-8000-000000000001'),
  'completed:706.40', 'session completed with numeric(10,2) score');
select ok((select completed_at is not null and verified_at is not null from public.sessions where id = 'a0000000-0000-4000-8000-000000000001'),
  'completed_at and verified_at stamped by the server');
select is((select count(*)::int from public.leaderboard_entries where session_id = 'a0000000-0000-4000-8000-000000000001'), 1, 'published exactly once');
select is((select active_session_id from public.stations where id = 'station_a'), null, 'active_session_id cleared on completion');
select is((select status from public.station_status where station_id = 'station_a'), 'completed', 'station_status shows completed');

select is((public.commit_session_transition('a0000000-0000-4000-8000-000000000001', 2, 'resolve_0000002', 'resolve',
            pg_temp.req('{"eggDecision":"collect","leg":3}'), '{}', null, '{}')) -> 'response',
  '{"view":"final"}'::jsonb, 'replaying the finishing action after completion returns the stored final response');
select is((public.commit_session_transition('a0000000-0000-4000-8000-000000000001', 3, 'resolve_0000003', 'resolve',
            pg_temp.req('{"eggDecision":"skip"}'), '{}', null, '{}')) ->> 'error',
  'SESSION_CLOSED', 'new actions on a completed session -> SESSION_CLOSED');
select is((select count(*)::int from public.leaderboard_entries where session_id = 'a0000000-0000-4000-8000-000000000001'), 1, 'still exactly one entry');
select throws_ok($$update public.leaderboard_entries set final_score = 9999 where session_id = 'a0000000-0000-4000-8000-000000000001'$$,
  '42501', null, 'published entries are immutable even for the owner role');

-- ---------------------------------------------------------------- dnf ----------------------------
select is((pg_temp.mk('b0000000-0000-4000-8000-000000000001', 'station_b', 'create_b0000001', '0000000000000000000000000000000b', 'Bobby')) ->> 'ok', 'true', 'station_b session created');
select is((public.commit_session_transition('b0000000-0000-4000-8000-000000000001', 0, 'resolve_b000001', 'resolve',
            pg_temp.req('{"eggDecision":"skip"}'),
            pg_temp.st('b0000000-0000-4000-8000-000000000001', 'Bobby',
              '{"revision":1,"status":"dnf","phase":"complete","hp":-5,"hydeCatchCount":2,"dnfReason":"second_catch","finalScore":0,"finalEggPoints":0,"totalSimulatedTimeCs":5000}'),
            pg_temp.leg(1, 'dnf'), '{"view":"dnf"}')) ->> 'ok',
  'true', 'DNF transition commits (hp below zero is clamped in the projection)');
select is((select dnf_reason || ':' || dnf_leg::text || ':' || total_simulated_time_cs::text from public.defeated_log where session_id = 'b0000000-0000-4000-8000-000000000001'),
  'second_catch:1:5000', 'DNF appears in defeated_log');
select is((select final_score from public.leaderboard_entries where session_id = 'b0000000-0000-4000-8000-000000000001'), 0.00, 'DNF entry has score 0');
select is((select count(*)::int from public.verified_leaderboard where session_id = 'b0000000-0000-4000-8000-000000000001'), 0, 'DNF is not ranked');

-- ---------------------------------------------------------------- ranking order ------------------
-- three more completed results on station_b: same score/eggs tie -> verified_at then session_id
create function pg_temp.complete(p_id uuid, p_action text, p_eggs int, p_time int, p_score numeric) returns jsonb
language sql as $$
  select public.commit_session_transition(p_id, 0, p_action, 'resolve', pg_temp.req('{}'),
    pg_temp.st(p_id, 'Racer', jsonb_build_object('revision', 1, 'status', 'completed', 'phase', 'complete',
      'finalEggPoints', p_eggs, 'bankedEggPoints', p_eggs, 'totalSimulatedTimeCs', p_time, 'finalScore', p_score)),
    pg_temp.leg(1, 'finished'), '{}')
$$;
select is((pg_temp.mk('c0000000-0000-4000-8000-000000000001', 'station_b', 'create_c0000001', '000000000000000000000000000000c1', 'Racer')) ->> 'ok', 'true', 'fixture: mk c0000000-0000-4000-8000-000000000001');
select is((pg_temp.complete('c0000000-0000-4000-8000-000000000001', 'finish_c000001', 9, 13600, 764.00)) ->> 'ok', 'true', 'fixture: complete c0000000-0000-4000-8000-000000000001');
select is((pg_temp.mk('c0000000-0000-4000-8000-000000000002', 'station_b', 'create_c0000002', '000000000000000000000000000000c2', 'Racer')) ->> 'ok', 'true', 'fixture: mk c0000000-0000-4000-8000-000000000002');
select is((pg_temp.complete('c0000000-0000-4000-8000-000000000002', 'finish_c000002', 8, 3600, 764.00)) ->> 'ok', 'true', 'fixture: complete c0000000-0000-4000-8000-000000000002');
select is((pg_temp.mk('c0000000-0000-4000-8000-000000000003', 'station_b', 'create_c0000003', '000000000000000000000000000000c3', 'Racer')) ->> 'ok', 'true', 'fixture: mk c0000000-0000-4000-8000-000000000003');
select is((pg_temp.complete('c0000000-0000-4000-8000-000000000003', 'finish_c000003', 1, 1000, 90.00)) ->> 'ok', 'true', 'fixture: complete c0000000-0000-4000-8000-000000000003');
select is((select array_agg(session_id::text order by ord) from (select session_id, row_number() over () ord from public.verified_leaderboard) x),
  array['c0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000002',
        'a0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000003'],
  'ranking: score desc, then egg points desc, then time asc');
select is((select array_agg(rank order by rank) from public.verified_leaderboard), array[1, 2, 3, 4], 'rank() column');

-- ---------------------------------------------------------------- supersede ----------------------
select is((pg_temp.mk('d0000000-0000-4000-8000-000000000001', 'station_a', 'create_d0000001', '000000000000000000000000000000d1', 'First')) ->> 'ok', 'true', 'new station_a session');
select is((pg_temp.mk('d0000000-0000-4000-8000-000000000002', 'station_a', 'create_d0000002', '000000000000000000000000000000d2', 'Second')) -> 'supersededSessionIds',
  '["d0000000-0000-4000-8000-000000000001"]'::jsonb, 'creating another session supersedes the running one');
select is((select status || ':' || abandoned_reason || ':' || (state ->> 'status') from public.sessions where id = 'd0000000-0000-4000-8000-000000000001'),
  'abandoned:superseded:abandoned', 'superseded session is abandoned (columns and snapshot)');
select is((select count(*)::int from public.sessions where station_id = 'station_a' and status = 'in_progress'), 1, 'exactly one in-progress session per station');
select throws_ok($$insert into public.sessions (id, station_id, create_action_id, nickname, character_id, pokemon_id, status, phase, leg_index, revision, hp, stamina, gap_m, hyde_catch_count, banked_egg_points, unbanked_egg_points, total_simulated_time_cs, flags, state, rules_version, seed_commitment)
  values ('d0000000-0000-4000-8000-000000000003', 'station_a', 'raw_insert_01', 'Raw', 'enid', 'gengar', 'in_progress', 'awaiting_route', 1, 0, 100, 7, 100, 0, 0, 0, 0, '{}', '{}', 'v2.5', repeat('a', 64))$$,
  '23505', null, 'the database itself refuses a second in-progress session on a station');

-- ---------------------------------------------------------------- abandon / reset ----------------
select is((public.commit_session_transition('d0000000-0000-4000-8000-000000000002', 0, 'abandon_d000002', 'abandon',
            pg_temp.req('{"reason":"player_reset"}'),
            pg_temp.st('d0000000-0000-4000-8000-000000000002', 'Second', '{"revision":1,"status":"abandoned","phase":"complete"}'),
            null, '{}')) ->> 'error',
  'INVALID_TRANSITION', 'abandon without a server-set abandonReason is rejected');
select is((public.operator_reset_station('station_a', 'cccccccc-0000-4000-8000-000000000003', 'stuck', null)) ->> 'error',
  'SESSION_STILL_ACTIVE', 'operator reset refuses while a session is still in progress');
select is((public.commit_session_transition('d0000000-0000-4000-8000-000000000002', 0, 'abandon_d000002', 'abandon',
            pg_temp.req('{"reason":"operator"}', '{"abandonReason":"operator_reset"}'),
            pg_temp.st('d0000000-0000-4000-8000-000000000002', 'Second', '{"revision":1,"status":"abandoned","phase":"complete"}'),
            null, '{}')) ->> 'ok',
  'true', 'operator abandon commits');
select is((select status || ':' || coalesce(notice, '-') from public.station_status where station_id = 'station_a'),
  'idle:operator_reset', 'station_status cleared with operator_reset notice');
select is((public.operator_reset_station('station_a', 'cccccccc-0000-4000-8000-000000000003', 'stuck terminal',
            array['d0000000-0000-4000-8000-000000000002'::uuid])) ->> 'ok', 'true', 'operator reset records audit');
select is((select count(*)::int from public.operator_audit where station_id = 'station_a'), 1, 'audit row written');

-- ---------------------------------------------------------------- release after results ---------
select is((public.release_station('station_b', 'c0000000-0000-4000-8000-000000000003')) -> 'cleared', 'true'::jsonb,
  'player leaving the results screen idles the station');
select is((public.release_station('station_b', 'c0000000-0000-4000-8000-000000000003')) -> 'cleared', 'false'::jsonb,
  'release is a no-op the second time');

select * from finish();
rollback;
