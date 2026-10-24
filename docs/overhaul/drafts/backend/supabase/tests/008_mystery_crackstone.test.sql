-- Joseph Crackstone (migration 20261024000100_mystery_crackstone.sql): the four Crackstone telemetry types, the `curse`
-- rule event and the `crackstone_risk` forecast target go through the REAL append RPC, are stored, stay invisible to
-- anon / the other station, never touch the catch / sighting projections (a curse is not a catch, a Crackstone sighting
-- is not a Hyde sighting), and a run that died to curses finalizes exactly once as a dnf 'hp_depleted'.
-- Runs inside one transaction that is ROLLED BACK. Run with `supabase test db` or `npm run test:db:offline`.
begin;
create extension if not exists pgtap with schema extensions;
select plan(33);

do $$
begin
  perform private.mystery_clear_status('station_a', null);
  perform private.mystery_clear_status('station_b', null);
  delete from public.mystery_sessions;
end;
$$;

-- ---------------------------------------------------------------- fixtures (as postgres) -------
insert into auth.users (id, email) values
  ('aaaaaaaa-0000-4000-8000-0000000000a1', 'c-station-a@test.local'),
  ('bbbbbbbb-0000-4000-8000-0000000000b2', 'c-station-b@test.local'),
  ('cccccccc-0000-4000-8000-0000000000c3', 'c-operator@test.local');
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
  select '{"poisoned_archive":2,"crypt_last_witness":2,"midnight_signal":2}'::jsonb
$$;
create function pg_temp.req(p_body jsonb) returns jsonb language sql as $$
  select jsonb_build_object('body', p_body, 'actor', jsonb_build_object('userId', 'aaaaaaaa-0000-4000-8000-0000000000a1'))
$$;
create function pg_temp.mk(p_id uuid, p_station text, p_action text, p_seed text, p_nick text) returns jsonb language sql as $$
  select public.mystery_create_session(p_id, p_station, p_action, p_seed, p_nick, pg_temp.offer(p_seed), false,
    pg_temp.req(jsonb_build_object('actionId', p_action, 'nickname', p_nick)), pg_temp.versions())
$$;
create function pg_temp.ev(p_seq int, p_t float8, p_type text, p_payload jsonb default '{}'::jsonb) returns jsonb
language sql as $$ select jsonb_build_object('seq', p_seq, 't', p_t, 'type', p_type, 'payload', p_payload) $$;
create function pg_temp.fc(p_no int, p_t float8, p_target text, p_value numeric, p_features jsonb) returns jsonb
language sql as $$
  select jsonb_build_object('forecastNo', p_no, 't', p_t, 'target', p_target, 'value', p_value, 'modelLabel', 'rule_based',
    'modelVersion', null, 'features', p_features)
$$;

-- ---------------------------------------------------------------- constraints / index -----------
select ok((select bool_and(position(quote_literal(t) in pg_get_constraintdef(c.oid)) > 0)
           from pg_constraint c, unnest(array['crackstone_mode', 'crackstone_sighted', 'crackstone_lost', 'crackstone_scan', 'curse',
             'hyde_emerged', 'hazard_triggered', 'noise', 'catch', 'clue_found', 'accusation', 'finish', 'dnf']) t
           where c.conname = 'mystery_events_type_check' and c.conrelid = 'public.mystery_events'::regclass),
  'mystery_events_type_check lists the five Crackstone types and keeps the overhaul + original ones');
select is((select count(*)::int from pg_constraint where conrelid = 'public.mystery_events'::regclass and conname = 'mystery_events_type_check'), 1,
  'exactly one event type CHECK (replaced, not duplicated)');
select ok((select bool_and(position(quote_literal(t) in pg_get_constraintdef(c.oid)) > 0)
           from pg_constraint c, unnest(array['detection_15s', 'extraction', 'eta_s', 'egg_site', 'clue_area', 'hyde_zone', 'hyde_spawn', 'crackstone_risk']) t
           where c.conname = 'mystery_forecasts_target_check' and c.conrelid = 'public.mystery_forecasts'::regclass),
  'mystery_forecasts_target_check lists crackstone_risk and every earlier target');
select ok(exists (select 1 from pg_constraint where conname = 'mystery_forecasts_probability_check'),
  'the probability CHECK (everything but eta_s in [0, 1]) still covers crackstone_risk');
select is((select count(*)::int from pg_indexes where schemaname = 'public' and indexname = 'mystery_events_rule_idx'), 1,
  'exactly one rule-event index (rebuilt, not duplicated)');
select ok((select indexdef from pg_indexes where indexname = 'mystery_events_rule_idx') ~ '''curse''',
  'the rule-event index includes curse (a rule event: HP accounting)');
select ok((select indexdef from pg_indexes where indexname = 'mystery_events_rule_idx') ~ '''hint_requested''' and
          (select indexdef from pg_indexes where indexname = 'mystery_events_rule_idx') !~ '(crackstone_|hyde_emerged|site_checked)',
  'the rule-event index keeps the old rule types and excludes all telemetry');

-- ---------------------------------------------------------------- sessions ----------------------
select is(pg_temp.mk('c1111111-1111-4111-8111-111111111111', 'station_a', 'c_create_a_01', '00112233445566778899aabbccddeeff', 'Cora') ->> 'ok',
  'true', 'fixture: session on station_a');
select is(pg_temp.mk('d2222222-2222-4222-8222-222222222222', 'station_b', 'c_create_b_01', 'ffeeddccbbaa99887766554433221100', 'Dane') ->> 'ok',
  'true', 'fixture: independent session on station_b');
select is(public.mystery_select_duo('c1111111-1111-4111-8111-111111111111', 'station_a', 'enid', 'drifblim', pg_temp.req('{}')) ->> 'ok', 'true', 'fixture: select A');
select is(public.mystery_select_duo('d2222222-2222-4222-8222-222222222222', 'station_b', 'gomez', 'aegislash', pg_temp.req('{}')) ->> 'ok', 'true', 'fixture: select B');

-- ---------------------------------------------------------------- append: Crackstone + curses ----
create temp table app1 as select public.mystery_append_events('c1111111-1111-4111-8111-111111111111', 'station_a', -1, jsonb_build_array(
    pg_temp.ev(0, 2.0, 'crackstone_scan', '{"phase":"warning","radiusM":14,"hit":false}'),
    pg_temp.ev(1, 3.8, 'crackstone_scan', '{"phase":"pulse","radiusM":14,"hit":true}'),
    pg_temp.ev(2, 3.8, 'crackstone_sighted', '{"via":"scan","distanceM":11.2}'),
    pg_temp.ev(3, 3.8, 'crackstone_mode', '{"from":"PATROL","to":"CHASE","reason":"scan_hit"}'),
    pg_temp.ev(4, 6.0, 'crackstone_mode', '{"from":"CHASE","to":"ATTACK","reason":"curse_cast"}'),
    pg_temp.ev(5, 6.0, 'curse', '{"phase":"cast","hpLost":0,"blocked":false}'),
    pg_temp.ev(6, 7.2, 'curse', '{"phase":"hit","hpLost":25,"blocked":false}'),
    pg_temp.ev(7, 7.2, 'crackstone_mode', '{"from":"ATTACK","to":"RETURN","reason":"curse_done"}'),
    pg_temp.ev(8, 9.0, 'crackstone_lost'),
    pg_temp.ev(9, 20.0, 'curse', '{"phase":"hit","hpLost":25,"blocked":false}')),
  '{"v":1,"egg":"resting"}',
  jsonb_build_array(
    pg_temp.fc(0, 2, 'crackstone_risk', 0.35, '{"horizon_s":10,"mode":"PATROL"}'),
    pg_temp.fc(1, 9, 'crackstone_risk', 0.05, '{"horizon_s":10,"mode":"RETURN"}'),
    pg_temp.fc(2, 9, 'hyde_zone', 0.4, '{"zone":"z_mid"}')),
  null) as r;
select is((select r ->> 'ok' from app1), 'true', 'append: Crackstone telemetry + curse events accepted by the RPC');
select is((select (r ->> 'lastSeq')::int from app1), 9, 'append: last_seq advanced');
select is((select (r ->> 'forecastsInserted')::int from app1), 3, 'append: crackstone_risk forecasts stored');
select is((select count(*)::int from public.mystery_events where session_id = 'c1111111-1111-4111-8111-111111111111'
           and type in ('crackstone_mode', 'crackstone_sighted', 'crackstone_lost', 'crackstone_scan', 'curse')), 10,
  'append: every Crackstone row stored once');
select results_eq($$select catches::int, sightings, egg_state, terminal_type from public.mystery_sessions
                    where id = 'c1111111-1111-4111-8111-111111111111'$$,
  $$values (0, 0, 'resting'::text, null::text)$$, 'append: a curse is not a catch, a Crackstone sighting is not a Hyde sighting');

-- the DB backstops reject what the Edge Function would never send
select throws_ok($$select public.mystery_append_events('c1111111-1111-4111-8111-111111111111', 'station_a', 9,
  jsonb_build_array(pg_temp.ev(10, 21, 'crackstone_teleported', '{}')), '{"v":1}', null, null)$$,
  '23514', null, 'append: an unknown Crackstone event type is refused by the CHECK');
select throws_ok($$select public.mystery_append_events('c1111111-1111-4111-8111-111111111111', 'station_a', 9, '[]', '{"v":1}',
  jsonb_build_array(pg_temp.fc(50, 21, 'crackstone_zone', 0.5, '{}')), null)$$,
  '23514', null, 'append: an unknown forecast target is refused');
select throws_ok($$select public.mystery_append_events('c1111111-1111-4111-8111-111111111111', 'station_a', 9, '[]', '{"v":1}',
  jsonb_build_array(pg_temp.fc(51, 21, 'crackstone_risk', 1.5, '{}')), null)$$,
  '23514', null, 'append: a crackstone_risk probability above 1 is refused');
select throws_ok($$update public.mystery_events set payload = '{"phase":"hit","hpLost":0,"blocked":true}'
  where session_id = 'c1111111-1111-4111-8111-111111111111' and type = 'curse' and seq = 6$$,
  '42501', null, 'curse rows are append-only like every event (HP history cannot be rewritten)');
select is(public.mystery_append_events('c1111111-1111-4111-8111-111111111111', 'station_b', 9,
  jsonb_build_array(pg_temp.ev(10, 21, 'curse', '{"phase":"hit","hpLost":25,"blocked":false}')), '{"v":1}', null, null) ->> 'error',
  'SESSION_NOT_FOUND', 'append: station B cannot write curses into station A''s session');

-- ---------------------------------------------------------------- RLS on the new rows ------------
set local role anon;
set local request.jwt.claims to '{"role":"anon"}';
select throws_ok('select type, payload from public.mystery_events', '42501', null, 'anon cannot read Crackstone / curse events');
select throws_ok('select target, value from public.mystery_forecasts', '42501', null, 'anon cannot read crackstone_risk forecasts');
reset role;
set local role authenticated;
set local request.jwt.claims to '{"sub":"bbbbbbbb-0000-4000-8000-0000000000b2","role":"authenticated"}';
select is((select count(*)::int from public.mystery_events where type in ('curse', 'crackstone_sighted', 'crackstone_mode')), 0,
  'station B sees none of station A''s Crackstone events');
reset role;
set local role authenticated;
set local request.jwt.claims to '{"sub":"aaaaaaaa-0000-4000-8000-0000000000a1","role":"authenticated"}';
select is((select count(*)::int from public.mystery_events where type = 'curse'), 3, 'station A reads its own curse events');
select is((select count(*)::int from public.mystery_forecasts where target = 'crackstone_risk'), 2, 'station A reads its own crackstone_risk forecasts');
reset role;
set local role authenticated;
set local request.jwt.claims to '{"sub":"cccccccc-0000-4000-8000-0000000000c3","role":"authenticated"}';
select is((select count(*)::int from public.mystery_events where type like 'crackstone\_%' or type = 'curse'), 10,
  'the operator reads all Crackstone events (analytics)');
reset role;

-- ---------------------------------------------------------------- death by curses: dnf hp_depleted, finalized once
select is(public.mystery_append_events('c1111111-1111-4111-8111-111111111111', 'station_a', 9, jsonb_build_array(
    pg_temp.ev(10, 40, 'curse', '{"phase":"hit","hpLost":25,"blocked":false}'),
    pg_temp.ev(11, 60, 'curse', '{"phase":"hit","hpLost":25,"blocked":false}'),
    pg_temp.ev(12, 60, 'dnf', '{"reason":"hp_depleted"}')),
  '{"v":1,"egg":"resting","curses":4,"hpLost":100}', null, null) ->> 'terminal', 'dnf', 'append: four landed curses then dnf hp_depleted');
select results_eq($$select catches::int, terminal_type from public.mystery_sessions where id = 'c1111111-1111-4111-8111-111111111111'$$,
  $$values (0, 'dnf'::text)$$, 'append: the curse death recorded no catch');
create temp table dnf1 as select public.mystery_finalize_session('c1111111-1111-4111-8111-111111111111', 'station_a', 12, jsonb_build_object(
  'outcome', 'dnf', 'dnfReason', 'hp_depleted', 'verdict', 'not_accused', 'accused', null, 'correct', false,
  'cluesFound', '[]'::jsonb, 'eggTier', 'rare', 'eggPoints', 0, 'eggSecurity', 100, 'activeTimeS', 60, 'score', null,
  'catches', 0, 'sightings', 0, 'hintsUsed', 0, 'clientClaim', '{}'::jsonb, 'claimMatches', true,
  'caseId', (select case_id from public.mystery_sessions where id = 'c1111111-1111-4111-8111-111111111111'), 'caseVersion', 2,
  'evidence', '[]'::jsonb, 'deductionCorrect', false), pg_temp.req('{}')) as r;
select is((select r ->> 'replay' from dnf1), 'false', 'finalize: the curse DNF publishes once');
select results_eq($$select outcome, dnf_reason, score, catches::int from public.mystery_results where session_id = 'c1111111-1111-4111-8111-111111111111'$$,
  $$values ('dnf'::text, 'hp_depleted'::text, null::numeric(9,1), 0)$$, 'finalize: stored as dnf hp_depleted, score null, 0 catches');
select is((select count(*)::int from public.mystery_results where session_id = 'c1111111-1111-4111-8111-111111111111'), 1,
  'finalize: exactly one result row');
select results_eq($$select status from public.mystery_sessions where id = 'd2222222-2222-4222-8222-222222222222'$$,
  $$values ('playing'::text)$$, 'station B''s session is untouched by everything on station A');

select * from finish();
rollback;
