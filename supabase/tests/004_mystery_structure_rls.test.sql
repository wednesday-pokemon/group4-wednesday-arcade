-- mystery-v3.1: structural security invariants, RLS behaviour per role, and table constraints.
-- Runs inside one transaction that is ROLLED BACK (nothing persists). Run with `supabase test db` or the PGlite runner.
begin;
create extension if not exists pgtap with schema extensions;
select plan(109);

do $$
begin
  perform private.mystery_clear_status('station_a', null);
  perform private.mystery_clear_status('station_b', null);
  delete from public.mystery_sessions; -- cascades to offers, events, clue events, forecasts, recs, results, receipts
end;
$$;

-- ---------------------------------------------------------------- fixtures (as postgres) -------
insert into auth.users (id, email) values
  ('aaaaaaaa-0000-4000-8000-0000000000a1', 'm-station-a@test.local'),
  ('bbbbbbbb-0000-4000-8000-0000000000b2', 'm-station-b@test.local'),
  ('cccccccc-0000-4000-8000-0000000000c3', 'm-operator@test.local'),
  ('dddddddd-0000-4000-8000-0000000000d4', 'm-stranger@test.local');
insert into public.app_users (user_id, role, station_id) values
  ('aaaaaaaa-0000-4000-8000-0000000000a1', 'station', 'station_a'),
  ('bbbbbbbb-0000-4000-8000-0000000000b2', 'station', 'station_b'),
  ('cccccccc-0000-4000-8000-0000000000c3', 'operator', null);

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
  select '{"poisoned_archive":1,"crypt_last_witness":1,"midnight_signal":1}'::jsonb
$$;
create function pg_temp.req(p_body jsonb) returns jsonb language sql as $$
  select jsonb_build_object('body', p_body, 'actor', jsonb_build_object('userId', 'aaaaaaaa-0000-4000-8000-0000000000a1'))
$$;
create function pg_temp.mk(p_id uuid, p_station text, p_action text, p_seed text, p_nick text, p_test boolean default false)
returns jsonb language sql as $$
  select public.mystery_create_session(p_id, p_station, p_action, p_seed, p_nick, pg_temp.offer(p_seed), p_test,
    pg_temp.req(jsonb_build_object('actionId', p_action, 'nickname', p_nick)), pg_temp.versions())
$$;
create function pg_temp.ev(p_seq int, p_t float8, p_type text, p_payload jsonb default '{}'::jsonb) returns jsonb
language sql as $$ select jsonb_build_object('seq', p_seq, 't', p_t, 'type', p_type, 'payload', p_payload) $$;

select is(pg_temp.mk('a1111111-1111-4111-8111-111111111111', 'station_a', 'm_create_a_01', '0123456789abcdef0123456789abcdef', 'Alice') ->> 'ok', 'true', 'fixture: mystery session on station_a');
select is(pg_temp.mk('b2222222-2222-4222-8222-222222222222', 'station_b', 'm_create_b_01', 'fedcba9876543210fedcba9876543210', 'Bobby') ->> 'ok', 'true', 'fixture: mystery session on station_b');
select is(public.mystery_select_duo('a1111111-1111-4111-8111-111111111111', 'station_a', 'enid', 'drifblim', pg_temp.req('{}')) ->> 'ok', 'true', 'fixture: duo selected on station_a');
select is(public.mystery_append_events('a1111111-1111-4111-8111-111111111111', 'station_a', -1,
  jsonb_build_array(pg_temp.ev(0, 0.5, 'stance', '{"stance":"crouch"}'), pg_temp.ev(1, 9.25, 'clue_found', '{"clueId":"falsified_transfer","cluesFound":1}')),
  '{"v":1,"egg":"resting"}', jsonb_build_array(jsonb_build_object('forecastNo', 0, 't', 3, 'target', 'detection_15s', 'value', 0.2, 'modelLabel', 'rule_based', 'features', '{"dist":12}'::jsonb)),
  jsonb_build_array(jsonb_build_object('recNo', 0, 't', 4, 'action', 'crouch', 'advice', 'Crouch: the Hyde is near'))) ->> 'ok',
  'true', 'fixture: events + forecast + recommendation on station_a');

-- ---------------------------------------------------------------- structure -----------------------
select ok((select bool_and(c.relrowsecurity) from pg_class c where c.oid in (
    'public.mystery_sessions'::regclass, 'public.mystery_offered_duos'::regclass, 'public.mystery_events'::regclass,
    'public.mystery_clue_events'::regclass, 'public.mystery_forecasts'::regclass, 'public.mystery_recommendations'::regclass,
    'public.mystery_results'::regclass, 'public.mystery_session_actions'::regclass, 'public.mystery_station_status'::regclass)),
  'RLS enabled on all nine mystery tables');
select is((select count(*)::int from pg_policies where schemaname = 'public' and tablename like 'mystery%' and cmd <> 'SELECT'), 0,
  'no INSERT/UPDATE/DELETE/ALL policy on any mystery table');
select is((select count(*)::int from pg_policies where schemaname = 'public' and tablename in (
    'mystery_sessions', 'mystery_offered_duos', 'mystery_events', 'mystery_clue_events', 'mystery_forecasts',
    'mystery_recommendations', 'mystery_session_actions') and 'anon' = any(roles)), 0,
  'no policy grants anon access to station-scoped mystery tables');
select ok(not has_any_column_privilege('anon', t::regclass, 'SELECT'), 'anon cannot select ' || t)
from unnest(array['public.mystery_sessions', 'public.mystery_offered_duos', 'public.mystery_events', 'public.mystery_clue_events',
                  'public.mystery_forecasts', 'public.mystery_recommendations', 'public.mystery_session_actions']) t;
select ok(has_table_privilege('anon', t::regclass, 'SELECT'), 'anon can select ' || t)
from unnest(array['public.mystery_station_status', 'public.mystery_leaderboard',
                  'public.mystery_defeated', 'public.mystery_standings']) t;
select ok(has_column_privilege('anon', 'public.mystery_results', 'verdict', 'SELECT')
          and has_column_privilege('anon', 'public.mystery_results', 'case_id', 'SELECT')
          and has_column_privilege('anon', 'public.mystery_results', 'deduction_correct', 'SELECT'),
  'anon can select the public columns of mystery_results (verdict, case_id, deduction_correct)');
select ok(not has_column_privilege(r, 'public.mystery_results', c, 'SELECT'), r || ' cannot select mystery_results.' || c)
from unnest(array['anon', 'authenticated']) r, unnest(array['accused', 'evidence', 'client_claim']) c;
select ok(not has_table_privilege('anon', 'public.mystery_results', 'SELECT'), 'anon has no table-wide SELECT on mystery_results (column grants only)');
select ok(not exists (select 1 from information_schema.columns where table_schema = 'public'
    and table_name in ('mystery_leaderboard', 'mystery_defeated', 'mystery_standings') and column_name in ('accused', 'evidence', 'client_claim')),
  'public mystery views expose no accused / evidence / client_claim column');
select ok((select bool_and(exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = v and column_name = 'case_id'))
  from unnest(array['mystery_leaderboard', 'mystery_defeated', 'mystery_standings', 'mystery_station_status']) v),
  'leaderboard, defeated, standings and station status carry case_id');
select ok((select c.relrowsecurity from pg_class c where c.oid = 'public.mystery_case_bags'::regclass)
          and not has_any_column_privilege('anon', 'public.mystery_case_bags', 'SELECT')
          and not has_any_column_privilege('authenticated', 'public.mystery_case_bags', 'SELECT')
          and not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'mystery_case_bags'),
  'mystery_case_bags: RLS on, no client privilege, no policy (service role only)');
select ok(not has_table_privilege('anon', 'public.mystery_result_audit', 'SELECT'), 'anon cannot select the operator audit view');
select ok((select reloptions from pg_class where oid = t::regclass) @> array['security_invoker=true'], t || ' is security_invoker')
from unnest(array['public.mystery_leaderboard', 'public.mystery_defeated', 'public.mystery_standings']) t;
select is(
  (select count(*)::int from unnest(array[
      'public.mystery_create_session(uuid,text,text,text,text,jsonb,boolean,jsonb,jsonb,text,text)', -- + p_rules_version (20261025000100)
      'public.mystery_select_duo(uuid,text,text,text,jsonb)',
      'public.mystery_append_events(uuid,text,integer,jsonb,jsonb,jsonb,jsonb)',
      'public.mystery_finalize_session(uuid,text,integer,jsonb,jsonb)',
      'public.mystery_abandon_station(text,text,jsonb)',
      'public.mystery_assign_culprit(uuid,text)']) f, -- randomized murderer (20261026000100)
     unnest(array['anon', 'authenticated', 'public']) r
   where case when r = 'public'
              then exists (select 1 from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                           where p.oid = f::regprocedure and a.grantee = 0 and a.privilege_type = 'EXECUTE')
              else has_function_privilege(r, f, 'EXECUTE') end),
  0, 'anon, authenticated and PUBLIC cannot execute any mystery RPC');
select is((select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname like 'mystery\_%' and p.prosecdef and p.proconfig @> array['search_path=""']
     and has_function_privilege('service_role', p.oid, 'EXECUTE')),
  6, 'all six mystery RPCs are SECURITY DEFINER, empty search_path, executable by service_role');
select ok(exists (select 1 from pg_constraint where conname = 'mystery_events_session_seq_key'), 'unique (session_id, seq) on mystery_events');
select ok(exists (select 1 from pg_constraint where conname = 'mystery_offered_duos_pair_key'), 'unique (session, character, pokemon) on mystery_offered_duos');
select ok(exists (select 1 from pg_constraint where conname = 'mystery_offered_duos_pkey'), 'unique (session, slot) on mystery_offered_duos');
select ok(exists (select 1 from pg_constraint where conname = 'mystery_results_pkey'), 'one mystery_results row per session');
select ok(exists (select 1 from pg_indexes where indexname = 'mystery_sessions_one_open_per_station_idx'), 'one open mystery session per station');
select ok(exists (select 1 from pg_indexes where indexname = 'mystery_events_one_terminal_idx'), 'at most one finish/dnf event per session');
select is((select count(*)::int from public.mystery_station_status), 3, 'mystery_station_status has a row per station (A, B, C)');
select ok(not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename in (
    'mystery_sessions', 'mystery_events', 'mystery_offered_duos', 'mystery_forecasts', 'mystery_recommendations', 'mystery_session_actions')),
  'raw mystery tables are never published to Realtime');

-- ---------------------------------------------------------------- anon ---------------------------
set local role anon;
set local request.jwt.claims to '{"role":"anon"}';
select throws_ok(format('insert into public.%I default values', t), '42501', null, 'anon cannot INSERT into ' || t)
from unnest(array['mystery_sessions', 'mystery_offered_duos', 'mystery_events', 'mystery_clue_events', 'mystery_forecasts',
                  'mystery_recommendations', 'mystery_results', 'mystery_session_actions', 'mystery_station_status']) t;
select throws_ok('delete from public.mystery_results', '42501', null, 'anon cannot DELETE mystery_results');
select throws_ok('update public.mystery_station_status set score = 999', '42501', null, 'anon cannot UPDATE mystery_station_status');
select throws_ok('select seed from public.mystery_sessions', '42501', null, 'anon cannot read mystery seeds/sessions');
select is((select count(*)::int from public.mystery_station_status), 3, 'anon reads all three mystery station rows');
select lives_ok('select * from public.mystery_standings', 'anon reads mystery_standings');
select throws_ok($$select public.mystery_finalize_session('a1111111-1111-4111-8111-111111111111', 'station_a', 1, '{}', '{}')$$,
  '42501', null, 'anon cannot execute mystery_finalize_session');
reset role;

-- ---------------------------------------------------------------- station A ----------------------
set local role authenticated;
set local request.jwt.claims to '{"sub":"aaaaaaaa-0000-4000-8000-0000000000a1","role":"authenticated"}';
select is((select array_agg(station_id) from public.mystery_sessions), array['station_a'], 'station A sees only its own mystery session');
select is((select count(*)::int from public.mystery_sessions where id = 'b2222222-2222-4222-8222-222222222222'), 0, 'station A cannot read station B session by id');
select is((select count(*)::int from public.mystery_offered_duos), 3, 'station A sees exactly its own three cards');
select is((select count(*)::int from public.mystery_events), 2, 'station A sees its own events');
select is((select count(*)::int from public.mystery_clue_events), 1, 'clue_found produced one clue event row');
select is((select count(*)::int from public.mystery_forecasts), 1, 'station A sees its forecast');
select is((select count(*)::int from public.mystery_recommendations), 1, 'station A sees its recommendation');
select is((select count(*)::int from public.mystery_session_actions), 0, 'stations cannot read receipts/audit');
select throws_ok($$update public.mystery_sessions set nickname = 'Hacker' where id = 'a1111111-1111-4111-8111-111111111111'$$,
  '42501', null, 'station A cannot UPDATE its own session');
select throws_ok($$insert into public.mystery_events (session_id, station_id, seq, t, type, payload)
  values ('a1111111-1111-4111-8111-111111111111', 'station_a', 99, 1, 'finish', '{}')$$, '42501', null, 'station A cannot insert events directly');
select throws_ok($$select public.mystery_append_events('a1111111-1111-4111-8111-111111111111', 'station_a', 1, '[]', '{}', null, null)$$,
  '42501', null, 'station A cannot execute mystery_append_events (functions only)');
reset role;

-- ---------------------------------------------------------------- station B / stranger -----------
set local role authenticated;
set local request.jwt.claims to '{"sub":"bbbbbbbb-0000-4000-8000-0000000000b2","role":"authenticated"}';
select is((select count(*)::int from public.mystery_events), 0, 'station B sees none of station A''s events');
select is((select count(*)::int from public.mystery_forecasts), 0, 'station B sees none of station A''s forecasts');
reset role;
set local role authenticated;
set local request.jwt.claims to '{"sub":"dddddddd-0000-4000-8000-0000000000d4","role":"authenticated"}';
select is((select count(*)::int from public.mystery_sessions), 0, 'unprovisioned user sees no mystery sessions');
reset role;

-- ---------------------------------------------------------------- operator -----------------------
set local role authenticated;
set local request.jwt.claims to '{"sub":"cccccccc-0000-4000-8000-0000000000c3","role":"authenticated"}';
select is((select count(*)::int from public.mystery_sessions), 2, 'operator sees both stations'' mystery sessions');
select ok((select count(*)::int from public.mystery_session_actions) >= 3, 'operator reads receipts');
select throws_ok('delete from public.mystery_sessions', '42501', null, 'operator cannot DELETE mystery sessions');
reset role;

-- ---------------------------------------------------------------- constraints (as postgres) ------
select throws_ok($$insert into public.mystery_sessions (id, station_id, rules_version, create_action_id, seed, nickname, case_id, case_version)
  values (gen_random_uuid(), 'station_a', 'v2.5', 'm_bad_rules_01', '0123456789abcdef0123456789abcdef', 'Carol', 'midnight_signal', 1)$$,
  '23514', null, 'rules_version must be mystery-v3.1');
select throws_ok($$insert into public.mystery_sessions (id, station_id, create_action_id, seed, nickname, case_id, case_version)
  values (gen_random_uuid(), 'station_a', 'm_bad_seed_001', 'not-a-seed', 'Carol', 'midnight_signal', 1)$$, '23514', null, 'seed must be 32 hex');
select throws_ok($$insert into public.mystery_sessions (id, station_id, create_action_id, seed, nickname, case_id, case_version)
  values (gen_random_uuid(), 'station_a', 'm_bad_nick_001', '0123456789abcdef0123456789abcdef', '<b>x</b>', 'midnight_signal', 1)$$, '23514', null, 'nickname markup rejected');
select throws_ok($$insert into public.mystery_sessions (id, station_id, create_action_id, seed, nickname, case_id, case_version)
  values (gen_random_uuid(), 'station_b', 'm_bad_case_001', '0123456789abcdef0123456789abcdef', 'Carol', 'silent_evidence', 1)$$,
  '23514', null, 'case_id must be one of the three cases');
select throws_ok($$insert into public.mystery_sessions (id, station_id, create_action_id, seed, nickname, case_version)
  values (gen_random_uuid(), 'station_b', 'm_no_case_0001', '0123456789abcdef0123456789abcdef', 'Carol', 1)$$,
  '23502', null, 'a session must name its case (no default)');
select throws_ok($$insert into public.mystery_offered_duos (session_id, station_id, slot, character_id, pokemon_id, duo_name, role, rarity, stats, card)
  values ('b2222222-2222-4222-8222-222222222222', 'station_b', 1, 'xavier', 'gengar', 'X', 'stealth', 'common', '{}', '{}')$$,
  '23514', null, 'offered character must be one of the seven Nightshades');
select throws_ok($$insert into public.mystery_offered_duos (session_id, station_id, slot, character_id, pokemon_id, duo_name, role, rarity, stats, card)
  values ('b2222222-2222-4222-8222-222222222222', 'station_b', 3, 'enid', 'gengar', 'X', 'stealth', 'common',
          '{"investigation":1,"stealth":1,"mobility":1,"defense":1,"hydeControl":1,"eggProtection":1}', '{"characterId":"enid","pokemonId":"gengar"}')$$,
  '23514', null, 'slot must be 0..2');
select throws_ok($$select public.mystery_create_session('c3333333-3333-4333-8333-333333333333', 'station_b', 'm_dup_pair_01',
  '00000000000000000000000000000003', 'Dupe', jsonb_build_object('seed', '00000000000000000000000000000003', 'cards',
  jsonb_build_array(pg_temp.card('enid', 'gengar'), pg_temp.card('enid', 'gengar'), pg_temp.card('ajax', 'sableye'))),
  false, pg_temp.req('{}'), pg_temp.versions())$$, '23505', null, 'an offer with a duplicate pair is refused by the database');
select throws_ok($$insert into public.mystery_events (session_id, station_id, seq, t, type, payload)
  values ('a1111111-1111-4111-8111-111111111111', 'station_a', 1, 10, 'stance', '{"stance":"walk"}')$$,
  '23505', null, 'duplicate (session_id, seq) rejected');
select throws_ok($$insert into public.mystery_events (session_id, station_id, seq, t, type, payload)
  values ('a1111111-1111-4111-8111-111111111111', 'station_a', 50, 10, 'teleport', '{}')$$, '23514', null, 'unknown event type rejected');
select throws_ok($$insert into public.mystery_events (session_id, station_id, seq, t, type, payload)
  values ('a1111111-1111-4111-8111-111111111111', 'station_a', 51, 10, 'stance', '{"seq":3}')$$, '23514', null, 'payload may not shadow seq/t/type');
select lives_ok($$insert into public.mystery_events (session_id, station_id, seq, t, type, payload)
  values ('a1111111-1111-4111-8111-111111111111', 'station_a', 60, 10, 'dnf', '{"reason":"hp_depleted"}')$$, 'first terminal event accepted');
select throws_ok($$insert into public.mystery_events (session_id, station_id, seq, t, type, payload)
  values ('a1111111-1111-4111-8111-111111111111', 'station_a', 61, 11, 'finish', '{}')$$, '23505', null, 'second terminal event rejected');
select throws_ok($$insert into public.mystery_clue_events (session_id, station_id, clue_id, found_order, seq, t)
  values ('a1111111-1111-4111-8111-111111111111', 'station_a', 'falsified_transfer', 2, 60, 10)$$, '23505', null, 'the same clue cannot be found twice');
select throws_ok($$insert into public.mystery_clue_events (session_id, station_id, clue_id, found_order, seq, t)
  values ('a1111111-1111-4111-8111-111111111111', 'station_a', 'diary_page', 2, 60, 10)$$, '23514', null, 'an unknown clue id is refused');
select lives_ok($$insert into public.mystery_clue_events (session_id, station_id, clue_id, found_order, seq, t)
  values ('a1111111-1111-4111-8111-111111111111', 'station_a', 'watchtower_signal', 2, 60, 10)$$, 'clue ids of every case are accepted');
select throws_ok($$update public.mystery_events set t = 0 where session_id = 'a1111111-1111-4111-8111-111111111111'$$,
  '42501', null, 'mystery_events are append-only even for the owner');
-- result coherence (case_id / case_version / evidence / deduction_correct have no defaults: the RPC must name them)
create function pg_temp.res(p_verdict text, p_accused text, p_correct boolean, p_deduction boolean, p_clues text[], p_evidence text[],
  p_points int, p_time numeric, p_score numeric, p_outcome text default 'finished', p_dnf text default null) returns void
language sql as $$
  insert into public.mystery_results (session_id, station_id, nickname, character_id, pokemon_id, rules_version, case_id, case_version,
    outcome, dnf_reason, verdict, accused, correct, deduction_correct, evidence, clues_found, egg_tier, egg_points, egg_security,
    active_time_s, score, catches, finalized_at)
  values ('a1111111-1111-4111-8111-111111111111', 'station_a', 'Alice', 'enid', 'drifblim', 'mystery-v3.1', 'poisoned_archive', 1,
    p_outcome, p_dnf, p_verdict, p_accused, p_correct, p_deduction, p_evidence, p_clues, 'rare', p_points, 80, p_time, p_score, 0, now())
$$;
select throws_ok($$select pg_temp.res('case_solved', 'thornhill', true, true, array['falsified_transfer','botanical_residue','access_ledger'],
  array['falsified_transfer','botanical_residue','access_ledger'], 3, 200.0, 999.0)$$,
  '23514', null, 'finished score must equal points x 100 - active time');
select throws_ok($$select pg_temp.res('case_solved', 'thornhill', true, true, array['falsified_transfer'], array['falsified_transfer'], 3, 200.0, 100.0)$$,
  '23514', null, 'case_solved requires all three clues');
select throws_ok($$select pg_temp.res('case_solved', 'thornhill', true, false, array['falsified_transfer','botanical_residue','access_ledger'],
  array['falsified_transfer','note_drain_mud'], 3, 200.0, 100.0)$$,
  '23514', null, 'case_solved requires the correct deduction (exactly the supporting evidence)');
select throws_ok($$select pg_temp.res('case_solved', 'isaac', false, true, array['falsified_transfer','botanical_residue','access_ledger'],
  array['falsified_transfer','botanical_residue','access_ledger'], 3, 200.0, 100.0)$$,
  '23514', null, 'case_solved requires the correct suspect');
select throws_ok($$select pg_temp.res('not_accused', null, false, true, array['falsified_transfer'], array['falsified_transfer'], 3, 200.0, 100.0)$$,
  '23514', null, 'no suspect -> no cited evidence and no deduction');
select throws_ok($$select pg_temp.res('egg_secured_mystery_unsolved', 'barry', false, false, array['falsified_transfer'],
  array['a','b','c','d','e','f'], 3, 200.0, 100.0)$$, '23514', null, 'at most five evidence ids');
select throws_ok($$select pg_temp.res('egg_secured_mystery_unsolved', 'barry', false, false, array['falsified_transfer'],
  array['<script>'], 3, 200.0, 100.0)$$, '23514', null, 'evidence ids must be snake_case ids');
select throws_ok($$select pg_temp.res('not_accused', null, false, false, '{}', '{}', 0, 200.0, 0.0, 'dnf', 'second_catch')$$,
  '23514', null, 'a DNF has no score (null)');
select lives_ok($$select pg_temp.res('not_accused', null, false, false, array['falsified_transfer'], '{}', 1, 345.7, -245.7)$$,
  'a finisher who left the case unsolved (accused null, not_accused) with a NEGATIVE score is valid');
select throws_ok($$update public.mystery_results set score = 600 where session_id = 'a1111111-1111-4111-8111-111111111111'$$,
  '42501', null, 'published mystery results are immutable');
select is((select score from public.mystery_results where session_id = 'a1111111-1111-4111-8111-111111111111'), -245.7::numeric(9,1),
  'stored negative score unchanged');

-- ---------------------------------------------------------------- secret columns per role --------
set local role anon;
set local request.jwt.claims to '{"role":"anon"}';
select throws_ok('select accused from public.mystery_results', '42501', null, 'anon cannot select mystery_results.accused');
select throws_ok('select * from public.mystery_results', '42501', null, 'anon cannot select * from mystery_results');
select is((select count(*)::int from public.mystery_results), 1, 'anon still reads the public columns (count)');
reset role;
set local role authenticated;
set local request.jwt.claims to '{"sub":"aaaaaaaa-0000-4000-8000-0000000000a1","role":"authenticated"}';
select throws_ok('select evidence from public.mystery_results', '42501', null, 'a station account cannot select mystery_results.evidence');
select is((select count(*)::int from public.mystery_result_audit), 0, 'a station account sees no rows in the operator audit view');
reset role;
set local role authenticated;
set local request.jwt.claims to '{"sub":"cccccccc-0000-4000-8000-0000000000c3","role":"authenticated"}';
select results_eq($$select accused, evidence, deduction_correct from public.mystery_result_audit$$,
  $$values (null::text, '{}'::text[], false)$$, 'the operator reads accused / evidence through mystery_result_audit');
reset role;

select * from finish();
rollback;
