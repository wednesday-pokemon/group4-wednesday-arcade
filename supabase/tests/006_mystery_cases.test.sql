-- Three cases: per-station shuffled-bag case assignment inside mystery_create_session, replay keeps the case, stations
-- are independent, forced test cases, per-case standings, and the secrecy of `accused` / `evidence`. Rolled back.
begin;
create extension if not exists pgtap with schema extensions;
select plan(24);

do $$
begin
  perform private.mystery_clear_status('station_a', null);
  perform private.mystery_clear_status('station_b', null);
  delete from public.mystery_sessions;
  delete from public.mystery_case_bags;
end;
$$;

-- ---------------------------------------------------------------- fixtures ---------------------
create function pg_temp.card(p_char text, p_pkmn text) returns jsonb language sql as $$
  select jsonb_build_object('characterId', p_char, 'pokemonId', p_pkmn, 'duoName', 'The Test Duo', 'role', 'stealth',
    'rarity', 'common', 'stats', jsonb_build_object('investigation', 3, 'stealth', 4, 'mobility', 2, 'defense', 3,
    'hydeControl', 3, 'eggProtection', 2), 'mods', '{}'::jsonb, 'advantages', '[]'::jsonb, 'disadvantages', '[]'::jsonb)
$$;
create function pg_temp.offer(p_seed text) returns jsonb language sql as $$
  select jsonb_build_object('seed', p_seed, 'cards', jsonb_build_array(
    pg_temp.card('wednesday', 'gengar'), pg_temp.card('enid', 'drifblim'), pg_temp.card('gomez', 'aegislash')))
$$;
create function pg_temp.versions() returns jsonb language sql as $$
  select '{"poisoned_archive":1,"crypt_last_witness":2,"midnight_signal":3}'::jsonb
$$;
create function pg_temp.req(p_body jsonb) returns jsonb language sql as $$
  select jsonb_build_object('body', p_body, 'actor', jsonb_build_object('userId', 'aaaaaaaa-0000-4000-8000-0000000000a1'))
$$;
-- create with a given action id; returns the RPC envelope (rows are aged so the 6/min rate limit never interferes)
create function pg_temp.mk(p_station text, p_action text, p_test boolean default false, p_case text default null) returns jsonb
language plpgsql as $$
declare
  r jsonb;
  v_seed text := md5(p_station || p_action);
begin
  r := public.mystery_create_session(gen_random_uuid(), p_station, p_action, v_seed, 'Visitor', pg_temp.offer(v_seed), p_test,
         pg_temp.req(jsonb_build_object('actionId', p_action, 'nickname', 'Visitor')), pg_temp.versions(), p_case);
  update public.mystery_sessions set created_at = created_at - interval '5 minutes' where station_id = p_station;
  return r;
end $$;
create function pg_temp.ev(p_seq int, p_t float8, p_type text, p_payload jsonb default '{}'::jsonb) returns jsonb
language sql as $$ select jsonb_build_object('seq', p_seq, 't', p_t, 'type', p_type, 'payload', p_payload) $$;
create function pg_temp.finish(p_id uuid, p_station text, p_t float8, p_accused text) returns jsonb language plpgsql as $$
declare v_time numeric := round(p_t::numeric, 1);
begin
  perform public.mystery_select_duo(p_id, p_station, 'wednesday', 'gengar', pg_temp.req('{}'));
  perform public.mystery_append_events(p_id, p_station, -1, jsonb_build_array(
      pg_temp.ev(0, 1, 'egg_pickup'),
      pg_temp.ev(1, p_t, 'egg_delivered', '{"tier":"rare","points":3,"security":90}'),
      pg_temp.ev(2, p_t, 'accusation', jsonb_build_object('suspectId', p_accused, 'correct', false, 'cluesFound', 0,
        'evidence', '["note_bell_rope"]'::jsonb, 'deductionCorrect', false)),
      pg_temp.ev(3, p_t, 'finish', jsonb_build_object('verdict', 'egg_secured_mystery_unsolved', 'score', 300 - v_time))),
    '{"v":1,"egg":"delivered"}', null, null);
  return public.mystery_finalize_session(p_id, p_station, 3, jsonb_build_object(
    'outcome', 'finished', 'dnfReason', null, 'verdict', 'egg_secured_mystery_unsolved', 'accused', p_accused, 'correct', false,
    'evidence', '["note_bell_rope"]'::jsonb, 'deductionCorrect', false, 'cluesFound', '[]'::jsonb, 'eggTier', 'rare',
    'eggPoints', 3, 'eggSecurity', 90, 'activeTimeS', v_time, 'score', 300 - v_time, 'catches', 0), pg_temp.req('{}'));
end $$;

-- ---------------------------------------------------------------- bag distribution -------------
create temp table draws_a (n int, case_id text, case_version int);
do $$ begin
  for i in 1..6 loop
    insert into draws_a select i, r ->> 'caseId', (r ->> 'caseVersion')::int from pg_temp.mk('station_a', 'bag_a_' || lpad(i::text, 4, '0')) r;
  end loop;
end $$;
select results_eq($$select case_id, count(*)::int from draws_a group by case_id order by case_id$$,
  $$values ('crypt_last_witness'::text, 2), ('midnight_signal', 2), ('poisoned_archive', 2)$$,
  'six creates on one station deal every case exactly twice');
select is((select count(distinct case_id)::int from draws_a where n <= 3), 3, 'the first three creates are one full bag (a permutation)');
select is((select count(distinct case_id)::int from draws_a where n > 3), 3, 'the next three are a fresh permutation');
select ok(not exists (select 1 from draws_a a join draws_a b on b.n = a.n + 1 and b.case_id = a.case_id),
  'never the same case twice in a row (a refill never starts with the case just dealt)');
select ok((select bool_and(d.case_id = s.case_id and d.case_version = s.case_version)
  from draws_a d join public.mystery_sessions s on s.create_action_id = 'bag_a_' || lpad(d.n::text, 4, '0') and s.station_id = 'station_a'),
  'the envelope case equals the stored session case');
select ok((select bool_and(case_version = case case_id when 'poisoned_archive' then 1 when 'crypt_last_witness' then 2 else 3 end) from draws_a),
  'case_version is the deployed version of the drawn case (p_case_versions)');

-- many more draws: still balanced per completed bag and never a repeat
do $$ begin
  for i in 7..30 loop
    insert into draws_a select i, r ->> 'caseId', (r ->> 'caseVersion')::int from pg_temp.mk('station_a', 'bag_a_' || lpad(i::text, 4, '0')) r;
  end loop;
end $$;
select results_eq($$select count(*)::int from draws_a group by case_id order by case_id$$, $$values (10), (10), (10)$$,
  '30 creates: 10 of each case');
select ok(not exists (select 1 from draws_a a join draws_a b on b.n = a.n + 1 and b.case_id = a.case_id), '30 creates: no case twice in a row');
select ok((select bool_and(c = 3) from (select count(distinct case_id) c from draws_a group by (n - 1) / 3) x),
  'every consecutive triple of draws is a permutation of the three cases');

-- ---------------------------------------------------------------- replay keeps the case ---------
create temp table bag_before as select bag, last_case from public.mystery_case_bags where station_id = 'station_a';
select is((pg_temp.mk('station_a', 'bag_a_0030') ->> 'caseId'), (select case_id from draws_a where n = 30),
  'replaying the same actionId returns the SAME case');
select is((pg_temp.mk('station_a', 'bag_a_0030') ->> 'replay'), 'true', 'it is a replay (no new session)');
select results_eq($$select bag, last_case from public.mystery_case_bags where station_id = 'station_a'$$,
  $$select bag, last_case from bag_before$$, 'a replay draws nothing (the bag is unchanged)');
select is((select count(*)::int from public.mystery_sessions where station_id = 'station_a' and create_action_id = 'bag_a_0030'), 1,
  'still exactly one session for that actionId');

-- ---------------------------------------------------------------- stations are independent ------
create temp table draws_b (n int, case_id text);
do $$ begin
  for i in 1..3 loop
    insert into draws_b select i, r ->> 'caseId' from pg_temp.mk('station_b', 'bag_b_' || lpad(i::text, 4, '0')) r;
  end loop;
end $$;
select is((select count(distinct case_id)::int from draws_b), 3, 'station B gets its own full bag (a permutation of the three cases)');
select results_eq($$select bag, last_case from public.mystery_case_bags where station_id = 'station_a'$$,
  $$select bag, last_case from bag_before$$, 'station B''s draws never touch station A''s bag');
select is((select count(*)::int from public.mystery_case_bags), 2, 'one bag row per station');

-- ---------------------------------------------------------------- forced case (test seeds only) -
select is(pg_temp.mk('station_a', 'forced_0001', false, 'midnight_signal') ->> 'error', 'INVALID_INPUT',
  'a forced case without a test seed is refused');
select is(pg_temp.mk('station_a', 'forced_0002', true, 'silent_evidence') ->> 'error', 'INVALID_INPUT', 'an unknown forced case is refused');
select is(pg_temp.mk('station_a', 'forced_0003', true, 'crypt_last_witness') ->> 'caseId', 'crypt_last_witness',
  'a test session may force its case');
select results_eq($$select bag, last_case from public.mystery_case_bags where station_id = 'station_a'$$,
  $$select bag, last_case from bag_before$$, 'a forced case leaves the visitor bag untouched');
select is((select case_id from public.mystery_station_status where station_id = 'station_a'), 'crypt_last_witness',
  'the public station status shows which case the terminal is playing');

-- ---------------------------------------------------------------- per-case standings + secrecy -----
do $$
begin
  -- three fresh station-B sessions (the second bag: one per case), each finished with a different score
  for i in 4..6 loop
    perform pg_temp.mk('station_b', 'bag_b_' || lpad(i::text, 4, '0'));
    perform pg_temp.finish((select id from public.mystery_sessions where create_action_id = 'bag_b_' || lpad(i::text, 4, '0')),
      'station_b', 100 + i * 10, 'barry');
  end loop;
end $$;
select results_eq($$select count(distinct case_id)::int, bool_and(case_rank = 1), array_agg(rank order by rank)
  from public.mystery_standings$$, $$values (3, true, array[1, 2, 3])$$,
  'standings: three finishers of three different cases -> combined ranks 1..3, each first of its case');

set local role anon;
set local request.jwt.claims to '{"role":"anon"}';
select throws_ok('select accused from public.mystery_results', '42501', null, 'anon cannot select who was accused');
select is((select count(*)::int from public.mystery_standings where case_id is not null), 3, 'anon reads per-case standings (case_id)');
reset role;

select * from finish();
rollback;
