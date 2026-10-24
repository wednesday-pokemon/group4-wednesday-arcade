-- Overhaul (migration 20261023000100_mystery_overhaul.sql): the six telemetry event types and the four new forecast
-- targets go through the REAL append RPC, are stored, stay invisible to anon / the other station, never touch the rule
-- projections, and a run carrying them still finalizes exactly once (DNF path). Case content version 2 sessions.
-- Runs inside one transaction that is ROLLED BACK. Run with `supabase test db` or `npm run test:db:offline`.
begin;
create extension if not exists pgtap with schema extensions;
select plan(40);

do $$
begin
  perform private.mystery_clear_status('station_a', null);
  perform private.mystery_clear_status('station_b', null);
  delete from public.mystery_sessions;
end;
$$;

-- ---------------------------------------------------------------- fixtures (as postgres) -------
insert into auth.users (id, email) values
  ('aaaaaaaa-0000-4000-8000-0000000000a1', 'o-station-a@test.local'),
  ('bbbbbbbb-0000-4000-8000-0000000000b2', 'o-station-b@test.local'),
  ('cccccccc-0000-4000-8000-0000000000c3', 'o-operator@test.local');
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
-- the deployed case content versions after the overhaul
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

-- ---------------------------------------------------------------- constraints -------------------
select ok((select bool_and(position(quote_literal(t) in pg_get_constraintdef(c.oid)) > 0)
           from pg_constraint c, unnest(array['hyde_emerged', 'site_checked', 'trace_found', 'examined', 'passage_opened',
             'hazard_triggered', 'noise', 'clue_found', 'accusation', 'finish', 'dnf']) t
           where c.conname = 'mystery_events_type_check' and c.conrelid = 'public.mystery_events'::regclass),
  'mystery_events_type_check lists the six overhaul telemetry types and keeps the old ones');
select ok((select bool_and(position(quote_literal(t) in pg_get_constraintdef(c.oid)) > 0)
           from pg_constraint c, unnest(array['detection_15s', 'extraction', 'eta_s', 'egg_site', 'clue_area', 'hyde_zone', 'hyde_spawn']) t
           where c.conname = 'mystery_forecasts_target_check' and c.conrelid = 'public.mystery_forecasts'::regclass),
  'mystery_forecasts_target_check lists the old and the four new targets');
select is((select count(*)::int from pg_constraint where conrelid = 'public.mystery_events'::regclass and conname = 'mystery_events_type_check'), 1,
  'exactly one event type CHECK (replaced, not duplicated)');
select ok(exists (select 1 from pg_constraint where conname = 'mystery_forecasts_probability_check'),
  'the probability CHECK (everything but eta_s in [0, 1]) is still in place');
select ok((select indexdef from pg_indexes where indexname = 'mystery_events_rule_idx') !~ '(hyde_emerged|site_checked|trace_found|examined|passage_opened|hazard_triggered)',
  'the rule-event index does not include telemetry (telemetry is never a rule event)');

-- ---------------------------------------------------------------- sessions ----------------------
select is(pg_temp.mk('a7777777-7777-4777-8777-777777777777', 'station_a', 'o_create_a_01', '0123456789abcdef0123456789abcdef', 'Alice') ->> 'caseVersion',
  '2', 'create: a v2 case version is stored with the session');
select is(pg_temp.mk('b8888888-8888-4888-8888-888888888888', 'station_b', 'o_create_b_01', 'fedcba9876543210fedcba9876543210', 'Bobby') ->> 'ok',
  'true', 'fixture: independent session on station_b');
select is(public.mystery_select_duo('a7777777-7777-4777-8777-777777777777', 'station_a', 'enid', 'drifblim', pg_temp.req('{}')) ->> 'ok', 'true', 'fixture: select A');
select is(public.mystery_select_duo('b8888888-8888-4888-8888-888888888888', 'station_b', 'gomez', 'aegislash', pg_temp.req('{}')) ->> 'ok', 'true', 'fixture: select B');

-- ---------------------------------------------------------------- append: telemetry + forecasts --
create temp table app1 as select public.mystery_append_events('a7777777-7777-4777-8777-777777777777', 'station_a', -1, jsonb_build_array(
    pg_temp.ev(0, 0.5, 'stance', '{"stance":"walk"}'),
    pg_temp.ev(1, 4.0, 'site_checked', '{"site":"clue","siteId":"s_ft_desk","found":false}'),
    pg_temp.ev(2, 6.5, 'examined', '{"examineId":"ex_cracked_vial"}'),
    pg_temp.ev(3, 6.5, 'trace_found', '{"sourceId":"ex_cracked_vial","siteId":"e_shed"}'),
    pg_temp.ev(4, 12.0, 'passage_opened', '{"passageId":"p_bookcase"}'),
    pg_temp.ev(5, 20.0, 'hyde_emerged', '{"spawnId":"sp_court","x":-2,"z":-42}'),
    pg_temp.ev(6, 31.0, 'hazard_triggered', '{"hazardId":"hz_searchlight_1"}'),
    pg_temp.ev(7, 31.0, 'noise', '{"source":"hazard","x":10,"z":-3,"loudness":0.8,"radiusM":14}'),
    pg_temp.ev(8, 33.0, 'hyde_mode', '{"from":"INVESTIGATE_SOUND","to":"SEARCH","reason":"gave_up"}'),
    pg_temp.ev(9, 40.0, 'site_checked', '{"site":"egg","siteId":"e_shed","found":true}')),
  '{"v":1,"egg":"resting"}',
  jsonb_build_array(
    pg_temp.fc(0, 4, 'egg_site', 0.5, '{"site":"e_shed"}'),
    pg_temp.fc(1, 4, 'egg_site', 0.3, '{"site":"e_vault"}'),
    pg_temp.fc(2, 4, 'clue_area', 0.82, '{"area":"a_greenhouse"}'),
    pg_temp.fc(3, 10, 'hyde_spawn', 0.45, '{"spawn":"sp_court","emerges_in_s":10}'),
    pg_temp.fc(4, 25, 'hyde_zone', 0.31, '{"zone":"z_mid"}'),
    pg_temp.fc(5, 25, 'extraction', 0.66, '{"carried":false}')),
  null) as r;
select is((select r ->> 'ok' from app1), 'true', 'append: the six telemetry types + hazard noise + gave_up accepted by the RPC');
select is((select (r ->> 'lastSeq')::int from app1), 9, 'append: last_seq advanced over the telemetry');
select is((select (r ->> 'forecastsInserted')::int from app1), 6, 'append: the new forecast targets are stored');
select is((select count(*)::int from public.mystery_events where session_id = 'a7777777-7777-4777-8777-777777777777'
           and type in ('hyde_emerged', 'site_checked', 'trace_found', 'examined', 'passage_opened', 'hazard_triggered')), 7,
  'append: every telemetry row stored once');
select is((select array_agg(distinct target order by target) from public.mystery_forecasts where session_id = 'a7777777-7777-4777-8777-777777777777'),
  array['clue_area', 'egg_site', 'extraction', 'hyde_spawn', 'hyde_zone'], 'append: one forecast row per candidate, targets as issued');
select results_eq($$select clues_found::int, catches::int, sightings, egg_state, terminal_type from public.mystery_sessions
                    where id = 'a7777777-7777-4777-8777-777777777777'$$,
  $$values (0, 0, 0, 'resting'::text, null::text)$$, 'append: telemetry never changes the rule projections');
select results_eq($$select status, clues_found::int, catches::int, sightings, egg_state from public.mystery_station_status where station_id = 'station_a'$$,
  $$values ('playing'::text, 0, 0, 0, 'resting'::text)$$, 'append: public station status unchanged by telemetry');
select is((select count(*)::int from public.mystery_clue_events where session_id = 'a7777777-7777-4777-8777-777777777777'), 0,
  'append: site_checked{found:true} is not a clue discovery');

-- the DB backstops reject what the Edge Function would never send
select throws_ok($$select public.mystery_append_events('a7777777-7777-4777-8777-777777777777', 'station_a', 9,
  jsonb_build_array(pg_temp.ev(10, 41, 'egg_teleported', '{}')), '{"v":1}', null, null)$$,
  '23514', null, 'append: an unknown event type is still refused by the CHECK');
select throws_ok($$select public.mystery_append_events('a7777777-7777-4777-8777-777777777777', 'station_a', 9, '[]', '{"v":1}',
  jsonb_build_array(pg_temp.fc(50, 41, 'egg_location', 0.5, '{}')), null)$$,
  '23514', null, 'append: an unknown forecast target is refused');
select throws_ok($$select public.mystery_append_events('a7777777-7777-4777-8777-777777777777', 'station_a', 9, '[]', '{"v":1}',
  jsonb_build_array(pg_temp.fc(51, 41, 'egg_site', 1.5, '{"site":"e_shed"}')), null)$$,
  '23514', null, 'append: an egg_site probability above 1 is refused');
select throws_ok($$select public.mystery_append_events('a7777777-7777-4777-8777-777777777777', 'station_a', 9, '[]', '{"v":1}',
  jsonb_build_array(pg_temp.fc(52, 41, 'hyde_zone', -0.1, '{"zone":"z_mid"}')), null)$$,
  '23514', null, 'append: a negative hyde_zone probability is refused');
select is((select (public.mystery_append_events('a7777777-7777-4777-8777-777777777777', 'station_a', 9, '[]', '{"v":1,"egg":"resting"}',
  jsonb_build_array(pg_temp.fc(0, 4, 'egg_site', 0.01, '{"site":"e_shed"}')), null) ->> 'forecastsInserted')::int), 0,
  'append: a resent egg_site forecast is ignored (kept as issued)');
select is((select value from public.mystery_forecasts where session_id = 'a7777777-7777-4777-8777-777777777777' and forecast_no = 0),
  0.5::numeric(12,4), 'append: the issued egg_site value is unchanged');
select throws_ok($$update public.mystery_events set payload = '{"spawnId":"sp_other","x":0,"z":0}'
  where session_id = 'a7777777-7777-4777-8777-777777777777' and type = 'hyde_emerged'$$,
  '42501', null, 'telemetry rows are append-only like every event');
select throws_ok($$update public.mystery_forecasts set value = 0.9 where session_id = 'a7777777-7777-4777-8777-777777777777'$$,
  '42501', null, 'overhaul forecasts are immutable like every forecast');
select is(public.mystery_append_events('a7777777-7777-4777-8777-777777777777', 'station_b', 9,
  jsonb_build_array(pg_temp.ev(10, 41, 'examined', '{"examineId":"ex_x"}')), '{"v":1}', null, null) ->> 'error',
  'SESSION_NOT_FOUND', 'append: station B cannot write telemetry into station A''s session');

-- ---------------------------------------------------------------- RLS on the new rows ------------
set local role anon;
set local request.jwt.claims to '{"role":"anon"}';
select throws_ok('select type, payload from public.mystery_events', '42501', null, 'anon cannot read telemetry events');
select throws_ok('select target, value, features from public.mystery_forecasts', '42501', null, 'anon cannot read the overhaul forecasts');
reset role;
set local role authenticated;
set local request.jwt.claims to '{"sub":"bbbbbbbb-0000-4000-8000-0000000000b2","role":"authenticated"}';
select is((select count(*)::int from public.mystery_events where type in ('site_checked', 'trace_found', 'hyde_emerged')), 0,
  'station B sees none of station A''s telemetry (where the egg was, which spawn)');
select is((select count(*)::int from public.mystery_forecasts), 0, 'station B sees none of station A''s forecasts');
reset role;
set local role authenticated;
set local request.jwt.claims to '{"sub":"aaaaaaaa-0000-4000-8000-0000000000a1","role":"authenticated"}';
select is((select count(*)::int from public.mystery_events where type = 'site_checked'), 2, 'station A reads its own telemetry');
select is((select count(*)::int from public.mystery_forecasts where target = 'egg_site'), 2, 'station A reads its own egg_site forecasts');
reset role;
set local role authenticated;
set local request.jwt.claims to '{"sub":"cccccccc-0000-4000-8000-0000000000c3","role":"authenticated"}';
select is((select count(*)::int from public.mystery_events where type in ('hyde_emerged', 'site_checked', 'trace_found', 'examined',
  'passage_opened', 'hazard_triggered')), 7, 'the operator reads all telemetry (analytics)');
reset role;

-- ---------------------------------------------------------------- DNF with telemetry, finalized once
select is(public.mystery_append_events('a7777777-7777-4777-8777-777777777777', 'station_a', 9, jsonb_build_array(
    pg_temp.ev(10, 50, 'catch', '{"catchNumber":1,"hpLost":35,"eggSecurityLost":0,"blocked":false}'),
    pg_temp.ev(11, 51, 'hazard_triggered', '{"hazardId":"hz_searchlight_1"}'),
    pg_temp.ev(12, 70.04, 'catch', '{"catchNumber":2,"hpLost":35,"eggSecurityLost":0,"blocked":false}'),
    pg_temp.ev(13, 70.04, 'dnf', '{"reason":"second_catch"}')),
  '{"v":1,"egg":"resting"}', null, null) ->> 'terminal', 'dnf', 'append: catches + telemetry + dnf');
select is(public.mystery_append_events('a7777777-7777-4777-8777-777777777777', 'station_a', 13,
  jsonb_build_array(pg_temp.ev(14, 71, 'examined', '{"examineId":"ex_after"}')), '{"v":1}', null, null) ->> 'ok', 'true',
  'append: the RPC stores late telemetry (the Edge Function refuses it: after_terminal)');
create temp table dnf1 as select public.mystery_finalize_session('a7777777-7777-4777-8777-777777777777', 'station_a', 14, jsonb_build_object(
  'outcome', 'dnf', 'dnfReason', 'second_catch', 'verdict', 'not_accused', 'accused', null, 'correct', false,
  'cluesFound', '[]'::jsonb, 'eggTier', 'rare', 'eggPoints', 0, 'eggSecurity', 100, 'activeTimeS', 70, 'score', null,
  'catches', 2, 'sightings', 0, 'hintsUsed', 0, 'clientClaim', '{}'::jsonb, 'claimMatches', true,
  'caseId', (select case_id from public.mystery_sessions where id = 'a7777777-7777-4777-8777-777777777777'), 'caseVersion', 2,
  'evidence', '[]'::jsonb, 'deductionCorrect', false), pg_temp.req('{}')) as r;
select is((select r ->> 'replay' from dnf1), 'false', 'finalize: a DNF run with telemetry publishes once');
select results_eq($$select outcome, dnf_reason, score, case_version::int from public.mystery_results where session_id = 'a7777777-7777-4777-8777-777777777777'$$,
  $$values ('dnf'::text, 'second_catch'::text, null::numeric(9,1), 2)$$, 'finalize: DNF stored with score null and the v2 case version');
select is((public.mystery_finalize_session('a7777777-7777-4777-8777-777777777777', 'station_a', 0, '{"outcome":"finished","score":600}',
  pg_temp.req('{}')) -> 'result'), (select r -> 'result' from dnf1), 'finalize: a second call returns the SAME stored DNF row');
select is((select count(*)::int from public.mystery_results where session_id = 'a7777777-7777-4777-8777-777777777777'), 1,
  'finalize: exactly one result row');
select results_eq($$select status from public.mystery_sessions where id = 'b8888888-8888-4888-8888-888888888888'$$,
  $$values ('playing'::text)$$, 'station B''s session is untouched by everything on station A');

select * from finish();
rollback;
