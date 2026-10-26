-- Randomized murderer (migration 20261026000100_mystery_culprits.sql): mystery_assign_culprit stores the FIRST draw and
-- returns it on every later call (no reroll), rejects unknown suspects / sessions, cascades with its session, and the
-- secrets table is readable by NOBODY but the service role (not anon, not the station, not the operator's JWT).
-- Runs inside one transaction that is ROLLED BACK. Run with `supabase test db` or `npm run test:db:offline`.
begin;
create extension if not exists pgtap with schema extensions;
select plan(13);

do $$
begin
  perform private.mystery_clear_status('station_a', null);
  perform private.mystery_clear_status('station_b', null);
  delete from public.mystery_sessions;
end;
$$;

insert into auth.users (id, email) values
  ('aaaaaaaa-0000-4000-8000-0000000000a1', 'm-station-a@test.local'),
  ('cccccccc-0000-4000-8000-0000000000c3', 'm-operator@test.local');
insert into public.app_users (user_id, role, station_id) values
  ('aaaaaaaa-0000-4000-8000-0000000000a1', 'station', 'station_a'),
  ('cccccccc-0000-4000-8000-0000000000c3', 'operator', null);

create function pg_temp.card(p_char text, p_pkmn text) returns jsonb language sql as $$
  select jsonb_build_object('characterId', p_char, 'pokemonId', p_pkmn, 'duoName', 'The Test Duo', 'role', 'stealth',
    'rarity', 'common', 'stats', jsonb_build_object('investigation', 3, 'stealth', 4, 'mobility', 2, 'defense', 3,
    'hydeControl', 3, 'eggProtection', 2), 'mods', '{}'::jsonb, 'advantages', '[]'::jsonb, 'disadvantages', '[]'::jsonb)
$$;
create function pg_temp.mk(p_id uuid, p_action text, p_seed text) returns jsonb language sql as $$
  select public.mystery_create_session(p_id, 'station_a', p_action, p_seed, 'Murder Test',
    jsonb_build_object('seed', p_seed, 'cards', jsonb_build_array(
      pg_temp.card('wednesday', 'gengar'), pg_temp.card('enid', 'drifblim'), pg_temp.card('gomez', 'aegislash'))),
    false, jsonb_build_object('body', jsonb_build_object('actionId', p_action), 'actor', jsonb_build_object('userId', 'aaaaaaaa-0000-4000-8000-0000000000a1')),
    '{"poisoned_archive":4,"crypt_last_witness":4,"midnight_signal":4}'::jsonb, null, 'mystery-v4')
$$;

select is((pg_temp.mk('d1111111-1111-4111-8111-111111111111', 'act-murder-1', 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa') ->> 'ok')::boolean, true,
  'fixture session created');

-- first draw is stored, later draws never replace it
select is(public.mystery_assign_culprit('d1111111-1111-4111-8111-111111111111', 'galpin') ->> 'culprit', 'galpin', 'the first draw is stored');
select is(public.mystery_assign_culprit('d1111111-1111-4111-8111-111111111111', 'barry') ->> 'culprit', 'galpin', 'a later draw returns the STORED murderer');
select is(public.mystery_assign_culprit('d1111111-1111-4111-8111-111111111111', 'thornhill') ->> 'culprit', 'galpin', 'refresh / replay cannot reroll');
select is((select count(*)::int from public.mystery_session_secrets), 1, 'one secret row per session');

-- invalid input
select is(public.mystery_assign_culprit('d1111111-1111-4111-8111-111111111111', 'isaac') ->> 'error', 'INVALID_INPUT', 'isaac is no longer a suspect');
select is(public.mystery_assign_culprit('d1111111-1111-4111-8111-111111111111', null) ->> 'error', 'INVALID_INPUT', 'null culprit refused');
select is(public.mystery_assign_culprit('d9999999-9999-4999-8999-999999999999', 'barry') ->> 'error', 'SESSION_NOT_FOUND', 'unknown session refused');

-- nobody but the service role reads or assigns it
set local role anon;
select throws_ok('select culprit_id from public.mystery_session_secrets', '42501', null, 'anon cannot read the murderer');
reset role;
set local role authenticated;
set local request.jwt.claims to '{"sub":"aaaaaaaa-0000-4000-8000-0000000000a1","role":"authenticated"}';
select throws_ok('select culprit_id from public.mystery_session_secrets', '42501', null, 'the station cannot read its own murderer');
select throws_ok($$select public.mystery_assign_culprit('d1111111-1111-4111-8111-111111111111', 'barry')$$, '42501', null,
  'the station cannot call mystery_assign_culprit');
reset role;
set local role authenticated;
set local request.jwt.claims to '{"sub":"cccccccc-0000-4000-8000-0000000000c3","role":"authenticated"}';
select throws_ok('select culprit_id from public.mystery_session_secrets', '42501', null, 'not even an operator JWT reads it');
reset role;

-- cascades with its session
select private.mystery_clear_status('station_a', null);
delete from public.mystery_sessions where id = 'd1111111-1111-4111-8111-111111111111';
select is((select count(*)::int from public.mystery_session_secrets), 0, 'the secret goes with its session');

select * from finish();
rollback;
