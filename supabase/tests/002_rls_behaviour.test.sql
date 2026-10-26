-- Behavioural RLS tests: what anon, station users, an unprovisioned user and an operator can actually do.
begin;
create extension if not exists pgtap with schema extensions;
select plan(55);

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


-- ---------------------------------------------------------------- fixtures (as postgres) -------
insert into auth.users (id, email) values
  ('aaaaaaaa-0000-4000-8000-000000000001', 'station-a@test.local'),
  ('bbbbbbbb-0000-4000-8000-000000000002', 'station-b@test.local'),
  ('cccccccc-0000-4000-8000-000000000003', 'operator@test.local'),
  ('dddddddd-0000-4000-8000-000000000004', 'stranger@test.local');
insert into public.app_users (user_id, role, station_id) values
  ('aaaaaaaa-0000-4000-8000-000000000001', 'station', 'station_a'),
  ('bbbbbbbb-0000-4000-8000-000000000002', 'station', 'station_b'),
  ('cccccccc-0000-4000-8000-000000000003', 'operator', null);

create function pg_temp.st(p_id uuid, p_nick text, p_extra jsonb default '{}'::jsonb) returns jsonb
language sql as $$
  select jsonb_build_object(
    'rulesVersion', 'v2.5', 'sessionId', p_id, 'nickname', p_nick, 'characterId', 'wednesday', 'pokemonId', 'gengar',
    'status', 'in_progress', 'phase', 'awaiting_route', 'legIndex', 1, 'revision', 0, 'hp', 100, 'stamina', 6,
    'pursuitGapM', 100, 'hydeCatchCount', 0, 'bankedEggPoints', 0, 'unbankedEggPoints', 0, 'totalSimulatedTimeCs', 0,
    'flags', jsonb_build_object('gengarWeatherUsed', false, 'xavierCrashUsed', false, 'rowanCrashUsed', false, 'firstCatchResolved', false),
    'prepared', null, 'legResults', '[]'::jsonb, 'finalEggPoints', null, 'finalScore', null, 'dnfReason', null) || p_extra
$$;
create function pg_temp.mk(p_id uuid, p_station text, p_action text, p_seed text, p_nick text) returns jsonb
language sql as $$
  select public.create_session_atomic(
    p_id, p_station, p_action, p_seed, encode(sha256(convert_to(p_seed, 'UTF8')), 'hex'),
    pg_temp.st(p_id, p_nick),
    jsonb_build_object('body', jsonb_build_object('nickname', p_nick), 'actor', jsonb_build_object('userId', null)),
    jsonb_build_object('view', jsonb_build_object('sessionId', p_id)))
$$;

select is((pg_temp.mk('11111111-1111-4111-8111-111111111111', 'station_a', 'create_a_0001', '0123456789abcdef0123456789abcdef', 'Alice')) ->> 'ok', 'true', 'fixture: session on station_a');
select is((pg_temp.mk('22222222-2222-4222-8222-222222222222', 'station_b', 'create_b_0001', 'fedcba9876543210fedcba9876543210', 'Bobby')) ->> 'ok', 'true', 'fixture: session on station_b');
-- one resolved leg on station_a for leg_results visibility
select is((public.commit_session_transition(
  '11111111-1111-4111-8111-111111111111', 0, 'resolve_a_0001', 'resolve',
  jsonb_build_object('body', jsonb_build_object('eggDecision', 'skip')),
  pg_temp.st('11111111-1111-4111-8111-111111111111', 'Alice', jsonb_build_object('revision', 1, 'legIndex', 2, 'totalSimulatedTimeCs', 4560)),
  jsonb_build_object('legIndex', 1, 'route', 'safe', 'pushLevel', 1, 'weather', 'clear', 'eggOffer', 'none', 'eggDecision', 'skip',
                     'crashOccurred', false, 'hydeCatch', false, 'outcome', 'survived',
                     'time', jsonb_build_object('totalCs', 4560), 'draws', jsonb_build_object('crash', 0.5, 'eggFailure', 0.5, 'hyde', 0.5)),
  jsonb_build_object('view', 'x'))) ->> 'ok', 'true', 'fixture: leg result on station_a');

-- ---------------------------------------------------------------- anon ---------------------------
set local role anon;
set local request.jwt.claims to '{"role":"anon"}';

select throws_ok(format('insert into public.%I default values', t), '42501', null, 'anon cannot INSERT into ' || t)
from unnest(array['stations', 'app_users', 'sessions', 'session_secrets', 'leg_results', 'session_actions',
                  'operator_audit', 'station_status', 'leaderboard_entries']) t;
select throws_ok(format('update public.%I set %I = %I', t, c, c), '42501', null, 'anon cannot UPDATE ' || t)
from (values ('stations', 'label'), ('app_users', 'role'), ('sessions', 'hp'), ('session_secrets', 'seed'),
             ('leg_results', 'crash'), ('session_actions', 'response'), ('operator_audit', 'note'),
             ('station_status', 'hp'), ('leaderboard_entries', 'final_score')) v(t, c);
select throws_ok(format('delete from public.%I', t), '42501', null, 'anon cannot DELETE from ' || t)
from unnest(array['stations', 'app_users', 'sessions', 'session_secrets', 'leg_results', 'session_actions',
                  'operator_audit', 'station_status', 'leaderboard_entries']) t;

select throws_ok('select id from public.sessions', '42501', null, 'anon cannot read sessions');
select throws_ok('select seed from public.session_secrets', '42501', null, 'anon cannot read session_secrets');
select throws_ok('select id from public.leg_results', '42501', null, 'anon cannot read leg_results');
select is((select count(*)::int from public.station_status), 3, 'anon reads all three station_status rows');
select lives_ok('select * from public.verified_leaderboard', 'anon reads verified_leaderboard');
select throws_ok($$select public.commit_session_transition('11111111-1111-4111-8111-111111111111', 1, 'evil_action_1', 'abandon', '{}', '{}', null, '{}')$$,
  '42501', null, 'anon cannot execute commit_session_transition');
reset role;

-- ---------------------------------------------------------------- station A ----------------------
set local role authenticated;
set local request.jwt.claims to '{"sub":"aaaaaaaa-0000-4000-8000-000000000001","role":"authenticated"}';

select is((select array_agg(station_id) from public.sessions), array['station_a'], 'station A sees only station_a sessions');
select is((select count(*)::int from public.sessions where id = '22222222-2222-4222-8222-222222222222'), 0, 'station A cannot read station B session by id');
select is((select count(*)::int from public.leg_results), 1, 'station A sees its own leg result');
select throws_ok('select state from public.sessions', '42501', null, 'station A cannot read sessions.state');
select throws_ok('select draws from public.leg_results', '42501', null, 'station A cannot read leg_results.draws');
select throws_ok('select seed from public.session_secrets', '42501', null, 'station A cannot read session_secrets');
select is((select count(*)::int from public.session_actions), 0, 'station A sees no audit receipts');
select is((select count(*)::int from public.app_users), 1, 'station A sees only its own app_users row');
select throws_ok($$update public.sessions set hp = 100$$, '42501', null, 'station A cannot UPDATE sessions');
select throws_ok($$insert into public.leaderboard_entries (session_id) values ('11111111-1111-4111-8111-111111111111')$$, '42501', null, 'station A cannot INSERT leaderboard entries');
select throws_ok($$select public.create_session_atomic('33333333-3333-4333-8333-333333333333', 'station_a', 'evil_create_1', '0123456789abcdef0123456789abcdef', 'x', '{}', '{}', '{}')$$,
  '42501', null, 'station A cannot execute create_session_atomic');
reset role;

-- ---------------------------------------------------------------- station B ----------------------
set local role authenticated;
set local request.jwt.claims to '{"sub":"bbbbbbbb-0000-4000-8000-000000000002","role":"authenticated"}';
select is((select array_agg(id) from public.sessions), array['22222222-2222-4222-8222-222222222222'::uuid], 'station B sees only its session');
select is((select count(*)::int from public.leg_results), 0, 'station B cannot see station A leg results');
reset role;

-- ---------------------------------------------------------------- unprovisioned user -------------
set local role authenticated;
set local request.jwt.claims to '{"sub":"dddddddd-0000-4000-8000-000000000004","role":"authenticated"}';
select is((select count(*)::int from public.sessions), 0, 'unprovisioned user sees no sessions');
select is((select count(*)::int from public.app_users), 0, 'unprovisioned user has no app_users row');
reset role;

-- ---------------------------------------------------------------- operator -----------------------
set local role authenticated;
set local request.jwt.claims to '{"sub":"cccccccc-0000-4000-8000-000000000003","role":"authenticated"}';
select is((select count(*)::int from public.sessions), 2, 'operator sees sessions of both stations');
select ok((select count(*)::int from public.session_actions) >= 3, 'operator can audit session_actions');
select throws_ok('select seed from public.session_secrets', '42501', null, 'operator cannot read session_secrets either');
select throws_ok($$delete from public.sessions$$, '42501', null, 'operator cannot DELETE sessions');
reset role;

select * from finish();
rollback;
