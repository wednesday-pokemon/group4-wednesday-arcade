-- mystery-v4 (migration 20261025000100_mystery_v4.sql): rules-version supersets, 'galpin' as a suspect, the final-wave
-- event types through the REAL append RPC, the four new result columns and their CHECKs (the v4 score formula is
-- re-derived from the row's own columns; v3.1 rows keep the v3.1 formula), the v4 views (leaderboard / defeat log /
-- standings / home-page top 5) with v3.1 rows never mixed in, and the narrow public grants.
-- Runs inside one transaction that is ROLLED BACK. Run with `supabase test db` or `npm run test:db:offline`.
begin;
create extension if not exists pgtap with schema extensions;
select plan(83);

do $$
begin
  perform private.mystery_clear_status('station_a', null);
  perform private.mystery_clear_status('station_b', null);
  delete from public.mystery_sessions;
end;
$$;

-- ---------------------------------------------------------------- fixtures (as postgres) -------
insert into auth.users (id, email) values
  ('aaaaaaaa-0000-4000-8000-0000000000a1', 'v4-station-a@test.local'),
  ('bbbbbbbb-0000-4000-8000-0000000000b2', 'v4-station-b@test.local'),
  ('cccccccc-0000-4000-8000-0000000000c3', 'v4-operator@test.local');
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
  select '{"poisoned_archive":3,"crypt_last_witness":3,"midnight_signal":3}'::jsonb
$$;
create function pg_temp.req(p_body jsonb) returns jsonb language sql as $$
  select jsonb_build_object('body', p_body, 'actor', jsonb_build_object('userId', 'aaaaaaaa-0000-4000-8000-0000000000a1'))
$$;
-- create with an explicit rules version (what the new mystery-create-session sends)
create function pg_temp.mk4(p_id uuid, p_station text, p_action text, p_seed text, p_nick text,
                            p_rules text default 'mystery-v4', p_test boolean default false) returns jsonb language sql as $$
  select public.mystery_create_session(p_id, p_station, p_action, p_seed, p_nick, pg_temp.offer(p_seed), p_test,
    pg_temp.req(jsonb_build_object('actionId', p_action, 'nickname', p_nick)), pg_temp.versions(), null, p_rules)
$$;
-- create WITHOUT p_rules_version (what the previous function bundle sends during the deploy window)
create function pg_temp.mk_legacy(p_id uuid, p_station text, p_action text, p_seed text, p_nick text) returns jsonb language sql as $$
  select public.mystery_create_session(p_id, p_station, p_action, p_seed, p_nick, pg_temp.offer(p_seed), false,
    pg_temp.req(jsonb_build_object('actionId', p_action, 'nickname', p_nick)), pg_temp.versions())
$$;
create function pg_temp.ev(p_seq int, p_t float8, p_type text, p_payload jsonb default '{}'::jsonb) returns jsonb
language sql as $$ select jsonb_build_object('seq', p_seq, 't', p_t, 'type', p_type, 'payload', p_payload) $$;
create function pg_temp.sel(p_id uuid, p_station text) returns jsonb language sql as $$
  select public.mystery_select_duo(p_id, p_station, 'enid', 'drifblim', pg_temp.req('{}'))
$$;
create function pg_temp.fin(p_id uuid, p_station text, p_last int, p_result jsonb) returns jsonb language sql as $$
  select public.mystery_finalize_session(p_id, p_station, p_last, p_result, pg_temp.req(jsonb_build_object('sessionId', p_id)))
$$;
-- a finished v4 run's tail: pickup, delivery at p_t, accusation, finish (the RPC checks order, the Edge Function rules)
create function pg_temp.tail(p_seq int, p_t float8, p_suspect text) returns jsonb language sql as $$
  select jsonb_build_array(
    pg_temp.ev(p_seq, p_t - 10, 'egg_pickup'),
    pg_temp.ev(p_seq + 1, p_t, 'egg_delivered', '{"tier":"rare","points":3,"security":100}'),
    pg_temp.ev(p_seq + 2, p_t, 'accusation', jsonb_build_object('suspectId', p_suspect, 'correct', false, 'cluesFound', 0,
      'evidence', '[]'::jsonb, 'deductionCorrect', false)),
    pg_temp.ev(p_seq + 3, p_t, 'finish', '{"verdict":"not_accused","score":0}'))
$$;

-- The A1 result (server-computed shape): solved, 2 hints, 1 detection, 1 hit, 150.0 s
--   1000 + 300 + 300 + 0 + 0 + 150 − 100 − 75 = 1575
create function pg_temp.a1() returns jsonb language sql as $$
  select '{"outcome":"finished","dnfReason":null,"verdict":"case_solved","accused":"thornhill","correct":true,
    "evidence":["falsified_transfer","botanical_residue","access_ledger"],"deductionCorrect":true,
    "cluesFound":["falsified_transfer","botanical_residue","access_ledger"],"eggTier":"rare","eggPoints":3,"eggSecurity":100,
    "activeTimeS":150.0,"score":1575,"catches":0,"sightings":0,"hintsUsed":2,"detections":1,"hits":1,"defeatedBy":null,
    "rulesVersion":"mystery-v4",
    "scoreBreakdown":{"delivery":1000,"accusation":300,"clues":300,"noDetection":0,"noHints":0,"timeBonus":150,
                      "hintPenalty":-100,"hitPenalty":-75,"total":1575},
    "clientClaim":{},"claimMatches":true}'::jsonb
$$;

-- ---------------------------------------------------------------- constraints / index -----------
select ok((select pg_get_constraintdef(oid) from pg_constraint where conname = 'mystery_sessions_rules_version_check') ~ 'mystery-v3\.1'
          and (select pg_get_constraintdef(oid) from pg_constraint where conname = 'mystery_sessions_rules_version_check') ~ 'mystery-v4',
  'sessions accept mystery-v3.1 and mystery-v4');
select ok((select pg_get_constraintdef(oid) from pg_constraint where conname = 'mystery_results_rules_version_check') ~ 'mystery-v3\.1'
          and (select pg_get_constraintdef(oid) from pg_constraint where conname = 'mystery_results_rules_version_check') ~ 'mystery-v4',
  'results accept mystery-v3.1 and mystery-v4');
select ok((select bool_and(position(quote_literal(s) in pg_get_constraintdef(c.oid)) > 0)
           from pg_constraint c, unnest(array['thornhill', 'galpin', 'barry', 'isaac']) s
           where c.conname = 'mystery_results_accused_check'),
  'accused CHECK: + galpin, isaac kept for v3.1 rows');
select ok((select bool_and(position(quote_literal(t) in pg_get_constraintdef(c.oid)) > 0)
           from pg_constraint c, unnest(array['enemy_spawned', 'enemy_despawned', 'enemy_detected', 'enemy_hit', 'slurp_mode', 'cabinet',
             'curse', 'crackstone_scan', 'hyde_emerged', 'noise', 'hint_requested', 'accusation', 'finish', 'dnf']) t
           where c.conname = 'mystery_events_type_check' and c.conrelid = 'public.mystery_events'::regclass),
  'event type CHECK lists the six final-wave types and keeps every earlier one');
select is((select count(*)::int from pg_constraint where conrelid = 'public.mystery_events'::regclass and conname = 'mystery_events_type_check'), 1,
  'exactly one event type CHECK');
select ok((select indexdef from pg_indexes where indexname = 'mystery_events_rule_idx') ~ '''enemy_detected'''
          and (select indexdef from pg_indexes where indexname = 'mystery_events_rule_idx') ~ '''enemy_hit'''
          and (select indexdef from pg_indexes where indexname = 'mystery_events_rule_idx') ~ '''curse'''
          and (select indexdef from pg_indexes where indexname = 'mystery_events_rule_idx') !~ '(enemy_spawned|enemy_despawned|slurp_mode|cabinet|crackstone_)',
  'rule-event index: + enemy_detected / enemy_hit, no telemetry');
select is((select count(*)::int from information_schema.columns where table_schema = 'public' and table_name = 'mystery_results'
           and column_name in ('detections', 'hits', 'defeated_by', 'score_breakdown') and is_nullable = 'YES'), 4,
  'four new nullable result columns');
select throws_ok($$insert into public.mystery_sessions (id, station_id, rules_version, create_action_id, seed, nickname, case_id, case_version)
  values (gen_random_uuid(), 'station_a', 'mystery-v5', 'v4_bad_rules_1', '0123456789abcdef0123456789abcdef', 'Carol', 'midnight_signal', 3)$$,
  '23514', null, 'an unknown rules version is refused');

-- ---------------------------------------------------------------- create ------------------------
select is(pg_temp.mk4('a1111111-1111-4111-8111-111111111111', 'station_a', 'v4_create_a1', '00112233445566778899aabbccddeeff', 'Ava') ->> 'rulesVersion',
  'mystery-v4', 'create: a v4 session (p_rules_version)');
select is((select rules_version from public.mystery_sessions where id = 'a1111111-1111-4111-8111-111111111111'), 'mystery-v4', 'create: stored as mystery-v4');
select is(pg_temp.mk4('a1111111-1111-4111-8111-1111111111ff', 'station_a', 'v4_create_a1', 'ffeeddccbbaa99887766554433221100', 'Ava') ->> 'rulesVersion',
  'mystery-v4', 'create: a replay returns the stored rules version');
select is(pg_temp.mk4('a1111111-1111-4111-8111-1111111111fe', 'station_a', 'v4_create_bad', '00112233445566778899aabbccddeeff', 'Ava', 'mystery-v5') ->> 'error',
  'INVALID_INPUT', 'create: an unknown rules version is refused by the RPC');
select is(pg_temp.sel('a1111111-1111-4111-8111-111111111111', 'station_a') ->> 'ok', 'true', 'fixture: select A1');

-- ---------------------------------------------------------------- append: final-wave events ----
create temp table app1 as select public.mystery_append_events('a1111111-1111-4111-8111-111111111111', 'station_a', -1, jsonb_build_array(
    pg_temp.ev(0, 5.0, 'enemy_spawned', '{"enemy":"slurp","spawnId":"sp_slurp_vault","x":12.5,"z":-40}'),
    pg_temp.ev(1, 6.0, 'slurp_mode', '{"from":"WANDER","to":"CHASE","reason":"saw_player"}'),
    pg_temp.ev(2, 6.0, 'enemy_detected', '{"enemy":"slurp","via":"sight"}'),
    pg_temp.ev(3, 7.0, 'cabinet', '{"spotId":"cab_archive_1","action":"enter","loud":true}'),
    pg_temp.ev(4, 7.5, 'cabinet', '{"spotId":"cab_archive_1","action":"close","loud":false}'),
    pg_temp.ev(5, 20.0, 'hint_requested', '{"level":1}'),
    pg_temp.ev(6, 30.0, 'hint_requested', '{"level":2}'),
    pg_temp.ev(7, 40.0, 'enemy_hit', '{"enemy":"slurp","hpLost":30,"blocked":false}'),
    pg_temp.ev(8, 45.0, 'enemy_despawned', '{"enemy":"slurp","reason":"encounter_resolved"}')) || pg_temp.tail(9, 150.0, 'thornhill'),
  '{"v":1,"egg":"delivered"}', null, null) as r;
select is((select r ->> 'ok' from app1), 'true', 'append: every final-wave type accepted by the RPC');
select is((select (r ->> 'lastSeq')::int from app1), 12, 'append: last_seq advanced');
select is((select count(*)::int from public.mystery_events where session_id = 'a1111111-1111-4111-8111-111111111111'
           and type in ('enemy_spawned', 'enemy_despawned', 'enemy_detected', 'enemy_hit', 'slurp_mode', 'cabinet')), 7,
  'append: every final-wave row stored once');
select results_eq($$select catches::int, sightings, terminal_type from public.mystery_sessions where id = 'a1111111-1111-4111-8111-111111111111'$$,
  $$values (0, 0, 'finish'::text)$$, 'append: an enemy_hit is not a catch, an enemy_detected is not a Hyde sighting');
select throws_ok($$select public.mystery_append_events('a1111111-1111-4111-8111-111111111111', 'station_a', 12,
  jsonb_build_array(pg_temp.ev(13, 151, 'slurp_teleported', '{}')), '{"v":1}', null, null)$$,
  '23514', null, 'append: an unknown event type is refused by the CHECK');

-- final-wave forecast targets (forecast-only batch, as the kiosk sends between event flushes)
select ok((select bool_and(position(quote_literal(t) in pg_get_constraintdef(c.oid)) > 0)
           from pg_constraint c, unnest(array['slurp_risk', 'enemy_spawn', 'crackstone_risk', 'hyde_spawn', 'egg_site', 'detection_15s', 'eta_s']) t
           where c.conname = 'mystery_forecasts_target_check' and c.conrelid = 'public.mystery_forecasts'::regclass),
  'forecast target CHECK: + slurp_risk, enemy_spawn, every earlier target kept');
select is((public.mystery_append_events('a1111111-1111-4111-8111-111111111111', 'station_a', 12, '[]', '{"v":1,"egg":"delivered"}',
  jsonb_build_array(
    jsonb_build_object('forecastNo', 0, 't', 6, 'target', 'slurp_risk', 'value', 0.31, 'modelLabel', 'rule_based', 'modelVersion', null,
      'features', '{"enemy":"slurp","zone":"z_crypt"}'::jsonb),
    jsonb_build_object('forecastNo', 1, 't', 6, 'target', 'enemy_spawn', 'value', 0.42, 'modelLabel', 'rule_based', 'modelVersion', null,
      'features', '{"enemy":"crackstone","spawn":"sp_crypt_gate","area":"a_crypt"}'::jsonb)), null) ->> 'forecastsInserted')::int,
  2, 'append: slurp_risk and enemy_spawn forecasts stored');
select throws_ok($$select public.mystery_append_events('a1111111-1111-4111-8111-111111111111', 'station_a', 12, '[]', '{"v":1}',
  jsonb_build_array(jsonb_build_object('forecastNo', 2, 't', 7, 'target', 'enemy_spawn', 'value', 1.5, 'modelLabel', 'rule_based',
    'modelVersion', null, 'features', '{}'::jsonb)), null)$$,
  '23514', null, 'enemy_spawn is a probability (the existing probability CHECK covers it)');

set local role anon;
select throws_ok('select count(*) from public.mystery_events', '42501', null, 'anon cannot read the event rows');
reset role;
set local role authenticated;
set local request.jwt.claims to '{"sub":"bbbbbbbb-0000-4000-8000-0000000000b2","role":"authenticated"}';
select is((select count(*)::int from public.mystery_events where type in ('enemy_hit', 'cabinet')), 0, 'station B sees none of station A''s events');
reset role;

-- ---------------------------------------------------------------- finalize: the v4 CHECKs --------
select throws_ok($$select pg_temp.fin('a1111111-1111-4111-8111-111111111111', 'station_a', 12, pg_temp.a1() || '{"score":1576}')$$,
  '23514', null, 'v4: score must equal the breakdown total');
select throws_ok($$select pg_temp.fin('a1111111-1111-4111-8111-111111111111', 'station_a', 12, pg_temp.a1()
  || jsonb_build_object('score', 1600, 'scoreBreakdown', (pg_temp.a1() -> 'scoreBreakdown') || '{"total":1600}'))$$,
  '23514', null, 'v4: the total must be the clamped sum of the parts');
select throws_ok($$select pg_temp.fin('a1111111-1111-4111-8111-111111111111', 'station_a', 12, pg_temp.a1()
  || jsonb_build_object('score', 1576, 'scoreBreakdown', (pg_temp.a1() -> 'scoreBreakdown') || '{"timeBonus":151,"total":1576}'))$$,
  '23514', null, 'v4: timeBonus = max(0, 300 − floor(active_time_s))');
select throws_ok($$select pg_temp.fin('a1111111-1111-4111-8111-111111111111', 'station_a', 12, pg_temp.a1()
  || jsonb_build_object('score', 1875, 'scoreBreakdown', (pg_temp.a1() -> 'scoreBreakdown') || '{"noHints":150,"hintPenalty":0,"total":1875}'))$$,
  '23514', null, 'v4: noHints / hintPenalty follow hints_used');
select throws_ok($$select pg_temp.fin('a1111111-1111-4111-8111-111111111111', 'station_a', 12, pg_temp.a1()
  || jsonb_build_object('score', 1350, 'scoreBreakdown', (pg_temp.a1() -> 'scoreBreakdown') || '{"accusation":75,"total":1350}'))$$,
  '23514', null, 'v4: accusation = 300 iff correct');
select throws_ok($$select pg_temp.fin('a1111111-1111-4111-8111-111111111111', 'station_a', 12, pg_temp.a1()
  || jsonb_build_object('scoreBreakdown', (pg_temp.a1() -> 'scoreBreakdown') - 'noHints'))$$,
  '23514', null, 'v4: every breakdown part must be present (a missing key cannot slip through as NULL)');
select throws_ok($$select pg_temp.fin('a1111111-1111-4111-8111-111111111111', 'station_a', 12, pg_temp.a1() || '{"scoreBreakdown":null}')$$,
  '23514', null, 'v4: a finisher needs a breakdown');
select throws_ok($$select pg_temp.fin('a1111111-1111-4111-8111-111111111111', 'station_a', 12, pg_temp.a1() || '{"detections":null}')$$,
  '23514', null, 'v4: detections are required');
select throws_ok($$select pg_temp.fin('a1111111-1111-4111-8111-111111111111', 'station_a', 12, pg_temp.a1() || '{"defeatedBy":"hyde"}')$$,
  '23514', null, 'defeated_by only on a DNF');
select is(pg_temp.fin('a1111111-1111-4111-8111-111111111111', 'station_a', 12, pg_temp.a1() || '{"rulesVersion":"mystery-v3.1"}') ->> 'error',
  'INVALID_TRANSITION', 'a result computed under another rules version than the session''s is refused');
select is(pg_temp.fin('a1111111-1111-4111-8111-111111111111', 'station_a', 12, pg_temp.a1() || '{"scoreBreakdown":[1,2]}') ->> 'error',
  'INVALID_INPUT', 'scoreBreakdown must be an object');
create temp table fin1 as select pg_temp.fin('a1111111-1111-4111-8111-111111111111', 'station_a', 12, pg_temp.a1()) as r;
select is((select r ->> 'ok' from fin1), 'true', 'v4 finalize accepted by every CHECK');
select results_eq($$select rules_version, score, hints_used, detections, hits, defeated_by, (score_breakdown ->> 'total')::numeric, accused
                    from public.mystery_results where session_id = 'a1111111-1111-4111-8111-111111111111'$$,
  $$values ('mystery-v4'::text, 1575.0::numeric, 2, 1, 1, null::text, 1575::numeric, 'thornhill'::text)$$,
  'stored: v4 counts + breakdown');
select is(pg_temp.fin('a1111111-1111-4111-8111-111111111111', 'station_a', 0, '{"outcome":"finished","score":9999}') -> 'result',
  (select r -> 'result' from fin1), 'a second finalize returns the same row');

-- ---------------------------------------------------------------- v4 DNF (Slurp) ------------------
select is(pg_temp.mk4('b2222222-2222-4222-8222-222222222222', 'station_b', 'v4_create_b1', 'ffeeddccbbaa99887766554433221100', 'Ben') ->> 'ok', 'true', 'fixture: v4 session B1');
select is(pg_temp.sel('b2222222-2222-4222-8222-222222222222', 'station_b') ->> 'ok', 'true', 'fixture: select B1');
select is(public.mystery_append_events('b2222222-2222-4222-8222-222222222222', 'station_b', -1, jsonb_build_array(
    pg_temp.ev(0, 5, 'enemy_detected', '{"enemy":"slurp","via":"proximity"}'),
    pg_temp.ev(1, 10, 'enemy_hit', '{"enemy":"slurp","hpLost":25,"blocked":false}'),
    pg_temp.ev(2, 20, 'enemy_hit', '{"enemy":"slurp","hpLost":25,"blocked":false}'),
    pg_temp.ev(3, 30, 'enemy_detected', '{"enemy":"hyde","via":"sound"}'),
    pg_temp.ev(4, 35, 'enemy_hit', '{"enemy":"slurp","hpLost":25,"blocked":false}'),
    pg_temp.ev(5, 44, 'enemy_hit', '{"enemy":"slurp","hpLost":25,"blocked":false}'),
    pg_temp.ev(6, 44, 'dnf', '{"reason":"hp_depleted","by":"slurp"}')), '{"v":1}', null, null) ->> 'ok', 'true', 'append: a Slurp death');
create function pg_temp.b1() returns jsonb language sql as $$
  select '{"outcome":"dnf","dnfReason":"hp_depleted","verdict":"not_accused","accused":null,"correct":false,"evidence":[],
    "deductionCorrect":false,"cluesFound":[],"eggTier":"rare","eggPoints":0,"eggSecurity":100,"activeTimeS":44.0,"score":null,
    "catches":0,"sightings":0,"hintsUsed":0,"detections":2,"hits":4,"defeatedBy":"slurp","scoreBreakdown":null,
    "rulesVersion":"mystery-v4","clientClaim":{},"claimMatches":true}'::jsonb
$$;
select throws_ok($$select pg_temp.fin('b2222222-2222-4222-8222-222222222222', 'station_b', 6, pg_temp.b1()
  || '{"scoreBreakdown":{"delivery":0,"accusation":0,"clues":0,"noDetection":0,"noHints":150,"timeBonus":256,"hintPenalty":0,"hitPenalty":-300,"total":106}}')$$,
  '23514', null, 'v4 DNF: no breakdown (DNFs are never scored)');
select throws_ok($$select pg_temp.fin('b2222222-2222-4222-8222-222222222222', 'station_b', 6, pg_temp.b1() || '{"defeatedBy":"isaac"}')$$,
  '23514', null, 'defeated_by must be hyde | crackstone | slurp');
select is(pg_temp.fin('b2222222-2222-4222-8222-222222222222', 'station_b', 6, pg_temp.b1()) ->> 'ok', 'true', 'v4 DNF finalized');
select results_eq($$select outcome, score, defeated_by, hits, detections from public.mystery_results where session_id = 'b2222222-2222-4222-8222-222222222222'$$,
  $$values ('dnf'::text, null::numeric, 'slurp'::text, 4, 2)$$, 'stored: v4 DNF with defeated_by');

-- ---------------------------------------------------------------- clamp at 0, Galpin accused ------
select is(pg_temp.mk4('a3333333-3333-4333-8333-333333333333', 'station_a', 'v4_create_a2', '0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f', 'Cleo') ->> 'ok', 'true', 'fixture: v4 session A2');
select is(pg_temp.sel('a3333333-3333-4333-8333-333333333333', 'station_a') ->> 'ok', 'true', 'fixture: select A2');
select is(public.mystery_append_events('a3333333-3333-4333-8333-333333333333', 'station_a', -1, pg_temp.tail(0, 400, 'galpin'), '{"v":1}', null, null) ->> 'ok',
  'true', 'append: A2 run');
-- 12 hints, 16 hits, 0 detections, 400 s, wrong suspect: 1000 + 0 + 0 + 150 + 0 + 0 − 600 − 1200 < 0 → 0
select is(pg_temp.fin('a3333333-3333-4333-8333-333333333333', 'station_a', 3,
  '{"outcome":"finished","dnfReason":null,"verdict":"egg_secured_mystery_unsolved","accused":"galpin","correct":false,"evidence":[],
    "deductionCorrect":false,"cluesFound":[],"eggTier":"rare","eggPoints":3,"eggSecurity":100,"activeTimeS":400.0,"score":0,
    "catches":2,"sightings":0,"hintsUsed":12,"detections":0,"hits":16,"defeatedBy":null,"rulesVersion":"mystery-v4",
    "scoreBreakdown":{"delivery":1000,"accusation":0,"clues":0,"noDetection":150,"noHints":0,"timeBonus":0,"hintPenalty":-600,
                      "hitPenalty":-1200,"total":0},"clientClaim":{},"claimMatches":true}') ->> 'ok',
  'true', 'v4: a negative sum is clamped to 0 and stored; accused galpin is a valid suspect');

-- ---------------------------------------------------------------- v3.1 row (legacy bundle path) ---
select is(pg_temp.mk_legacy('b4444444-4444-4444-8444-444444444444', 'station_b', 'v31_create_b2', '1234567890abcdef1234567890abcdef', 'Dora') ->> 'rulesVersion',
  'mystery-v3.1', 'create without p_rules_version (previous function bundle) still creates a v3.1 session');
select is(pg_temp.sel('b4444444-4444-4444-8444-444444444444', 'station_b') ->> 'ok', 'true', 'fixture: select B2');
select is(public.mystery_append_events('b4444444-4444-4444-8444-444444444444', 'station_b', -1, pg_temp.tail(0, 99.5, 'isaac'), '{"v":1}', null, null) ->> 'ok',
  'true', 'append: B2 v3.1 run');
create function pg_temp.b2() returns jsonb language sql as $$
  select '{"outcome":"finished","dnfReason":null,"verdict":"egg_secured_mystery_unsolved","accused":"isaac","correct":false,"evidence":[],
    "deductionCorrect":false,"cluesFound":[],"eggTier":"rare","eggPoints":3,"eggSecurity":100,"activeTimeS":99.5,"score":200.5,
    "catches":0,"sightings":0,"hintsUsed":1,"clientClaim":{},"claimMatches":true}'::jsonb
$$;
select throws_ok($$select pg_temp.fin('b4444444-4444-4444-8444-444444444444', 'station_b', 3, pg_temp.b2() || '{"score":999}')$$,
  '23514', null, 'v3.1 rows keep the v3.1 formula (score = points × 100 − time)');
select is(pg_temp.fin('b4444444-4444-4444-8444-444444444444', 'station_b', 3, pg_temp.b2()) ->> 'ok', 'true', 'v3.1 finalize (accused isaac stays valid)');
select results_eq($$select rules_version, score, detections, hits, score_breakdown from public.mystery_results where session_id = 'b4444444-4444-4444-8444-444444444444'$$,
  $$values ('mystery-v3.1'::text, 200.5::numeric, null::int, null::int, null::jsonb)$$, 'stored: v3.1 row without v4 columns');

-- ---------------------------------------------------------------- a v4 TEST session (never public) ---
select is(pg_temp.mk4('a5555555-5555-4555-8555-555555555555', 'station_a', 'v4_create_t1', 'abcdefabcdefabcdefabcdefabcdefab', 'Tess', 'mystery-v4', true) ->> 'ok',
  'true', 'fixture: v4 test session');
select is(pg_temp.sel('a5555555-5555-4555-8555-555555555555', 'station_a') ->> 'ok', 'true', 'fixture: select T1');
select is(public.mystery_append_events('a5555555-5555-4555-8555-555555555555', 'station_a', -1, pg_temp.tail(0, 95.4, null), '{"v":1}', null, null) ->> 'ok',
  'true', 'append: T1');
select is(pg_temp.fin('a5555555-5555-4555-8555-555555555555', 'station_a', 3,
  '{"outcome":"finished","dnfReason":null,"verdict":"not_accused","accused":null,"correct":false,"evidence":[],"deductionCorrect":false,
    "cluesFound":[],"eggTier":"rare","eggPoints":3,"eggSecurity":100,"activeTimeS":95.4,"score":1505,"catches":0,"sightings":0,
    "hintsUsed":0,"detections":0,"hits":0,"defeatedBy":null,"rulesVersion":"mystery-v4",
    "scoreBreakdown":{"delivery":1000,"accusation":0,"clues":0,"noDetection":150,"noHints":150,"timeBonus":205,"hintPenalty":0,
                      "hitPenalty":0,"total":1505},"clientClaim":{},"claimMatches":true}') ->> 'ok', 'true', 'test session finalized (1505)');

-- ---------------------------------------------------------------- five more v4 finishers (top-5 cut) ---
-- 1000 + 0 + 0 + 150 + 150 + 0 = 1300 at 300 + i seconds (distinct ranks via the time tie-break)
do $$
declare
  i integer;
  v_id uuid;
  v_station text;
  v_seed text;
  r jsonb;
begin
  for i in 1..5 loop
    v_id := ('e0000000-0000-4000-8000-00000000000' || i)::uuid;
    v_station := case when i % 2 = 0 then 'station_a' else 'station_b' end;
    v_seed := repeat(to_hex(i + 1), 32);
    r := pg_temp.mk4(v_id, v_station, 'v4_bulk_00' || i, v_seed, 'Bulk' || i);
    if not (r ->> 'ok')::boolean then raise exception 'bulk % create failed: %', i, r; end if;
    update public.mystery_sessions set created_at = created_at - interval '10 minutes' where id = v_id;
    perform pg_temp.sel(v_id, v_station);
    r := public.mystery_append_events(v_id, v_station, -1, pg_temp.tail(0, 300 + i, null), '{"v":1}', null, null);
    if not (r ->> 'ok')::boolean then raise exception 'bulk % append failed: %', i, r; end if;
    r := pg_temp.fin(v_id, v_station, 3, jsonb_build_object(
      'outcome', 'finished', 'dnfReason', null, 'verdict', 'not_accused', 'accused', null, 'correct', false, 'evidence', '[]'::jsonb,
      'deductionCorrect', false, 'cluesFound', '[]'::jsonb, 'eggTier', 'rare', 'eggPoints', 3, 'eggSecurity', 100,
      'activeTimeS', 300 + i, 'score', 1300, 'catches', 0, 'sightings', 0, 'hintsUsed', 0, 'detections', 0, 'hits', 0,
      'defeatedBy', null, 'rulesVersion', 'mystery-v4', 'clientClaim', '{}'::jsonb, 'claimMatches', true,
      'scoreBreakdown', jsonb_build_object('delivery', 1000, 'accusation', 0, 'clues', 0, 'noDetection', 150, 'noHints', 150,
        'timeBonus', 0, 'hintPenalty', 0, 'hitPenalty', 0, 'total', 1300)));
    if not (r ->> 'ok')::boolean then raise exception 'bulk % finalize failed: %', i, r; end if;
  end loop;
end;
$$;
select is((select count(*)::int from public.mystery_results where rules_version = 'mystery-v4' and outcome = 'finished' and not is_test), 7,
  'fixture: seven public v4 finishers');

-- ---------------------------------------------------------------- views (as anon) ----------------
set local role anon;
select results_eq($$select nickname, rank, score from public.mystery_leaderboard_v4$$,
  $$values ('Ava'::text, 1, 1575.0::numeric), ('Bulk1', 2, 1300.0), ('Bulk2', 3, 1300.0), ('Bulk3', 4, 1300.0), ('Bulk4', 5, 1300.0),
           ('Bulk5', 6, 1300.0), ('Cleo', 7, 0.0)$$,
  'v4 leaderboard: verified v4 finishers only, score desc then time asc (no v3.1 row, no test row, no DNF)');
select results_eq($$select nickname, score from public.mystery_leaderboard$$, $$values ('Dora'::text, 200.5::numeric)$$,
  'the v3.1 leaderboard still shows only v3.1 rows');
select results_eq($$select nickname, defeated_by, dnf_reason, hits from public.mystery_defeated_v4$$,
  $$values ('Ben'::text, 'slurp'::text, 'hp_depleted'::text, 4)$$, 'v4 defeat log: the Slurp death');
select is((select count(*)::int from public.mystery_defeated), 0, 'the v3.1 defeat log has no v4 DNF');
select results_eq($$select nickname, standing_group, rank from public.mystery_standings_v4$$,
  $$values ('Ava'::text, 0, 1), ('Bulk1', 0, 2), ('Bulk2', 0, 3), ('Bulk3', 0, 4), ('Bulk4', 0, 5), ('Bulk5', 0, 6), ('Cleo', 0, 7),
           ('Ben', 1, null::int)$$,
  'v4 standings: every finisher (even score 0) above every DNF; DNFs unranked');
select results_eq($$select rank, nickname, score, character_id, pokemon_id from public.mystery_top5$$,
  $$values (1, 'Ava'::text, 1575.0::numeric, 'enid'::text, 'drifblim'::text), (2, 'Bulk1', 1300.0, 'enid', 'drifblim'),
           (3, 'Bulk2', 1300.0, 'enid', 'drifblim'), (4, 'Bulk3', 1300.0, 'enid', 'drifblim'), (5, 'Bulk4', 1300.0, 'enid', 'drifblim')$$,
  'home top 5: exactly the five best verified v4 finishers, best first');
select ok((select bool_and(case_id in ('poisoned_archive', 'crypt_last_witness', 'midnight_signal') and finalized_at is not null
                           and rules_version = 'mystery-v4') from public.mystery_top5), 'top 5 carries case, time and rules version');
select results_eq($$select detections, hits, defeated_by from public.mystery_results where session_id = 'b2222222-2222-4222-8222-222222222222'$$,
  $$values (2, 4, 'slurp'::text)$$, 'anon reads the new public result columns');
select throws_ok('select accused from public.mystery_results', '42501', null, 'anon still cannot read accused');
select is((select count(*)::int from public.mystery_results where is_test), 0, 'anon never sees test results');
reset role;

set local role authenticated;
set local request.jwt.claims to '{"sub":"bbbbbbbb-0000-4000-8000-0000000000b2","role":"authenticated"}';
select is((select count(*)::int from public.mystery_top5), 5, 'a station account reads the home top 5');
select is((select nickname from public.mystery_top5 where rank = 1), 'Ava', 'station B sees station A''s top score (public board)');
reset role;

-- ---------------------------------------------------------------- privileges / shape --------------
select is((select array_agg(column_name::text order by ordinal_position) from information_schema.columns
           where table_schema = 'public' and table_name = 'mystery_top5'),
  array['rank', 'session_id', 'nickname', 'score', 'character_id', 'pokemon_id', 'case_id', 'active_time_s', 'finalized_at', 'rules_version'],
  'mystery_top5 exposes exactly the public home-page columns');
select is((select count(*)::int from information_schema.columns c
           where c.table_schema = 'public'
             and c.table_name in ('mystery_leaderboard_v4', 'mystery_defeated_v4', 'mystery_standings_v4', 'mystery_top5')
             and c.column_name in ('seed', 'accused', 'evidence', 'client_claim', 'claim_matches', 'progress')), 0,
  'no v4 view exposes seed, accused, evidence, client_claim, claim_matches or progress');
select ok((select bool_and((select reloptions from pg_class where oid = t::regclass) @> array['security_invoker=true'])
           from unnest(array['public.mystery_leaderboard_v4', 'public.mystery_defeated_v4', 'public.mystery_standings_v4', 'public.mystery_top5']) t),
  'every v4 view is security_invoker (RLS of mystery_results applies)');
select ok((select bool_and(has_table_privilege(r, t, 'SELECT'))
           from unnest(array['public.mystery_leaderboard_v4', 'public.mystery_defeated_v4', 'public.mystery_standings_v4', 'public.mystery_top5']) t,
                unnest(array['anon', 'authenticated']) r),
  'anon and authenticated may SELECT every v4 view');
select ok(not (select bool_or(has_table_privilege(r, t, p))
           from unnest(array['public.mystery_leaderboard_v4', 'public.mystery_defeated_v4', 'public.mystery_standings_v4', 'public.mystery_top5']) t,
                unnest(array['anon', 'authenticated']) r, unnest(array['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']) p),
  'no client role can write through a v4 view');
select ok(not has_column_privilege('anon', 'public.mystery_results', 'client_claim', 'SELECT')
          and not has_column_privilege('authenticated', 'public.mystery_results', 'evidence', 'SELECT')
          and has_column_privilege('anon', 'public.mystery_results', 'score_breakdown', 'SELECT'),
  'column grants: + the v4 columns, still no accused / evidence / client_claim');
select is(has_function_privilege('authenticated', 'public.mystery_create_session(uuid,text,text,text,text,jsonb,boolean,jsonb,jsonb,text,text)', 'EXECUTE'),
  false, 'the new create signature is service-role only');
select ok(has_function_privilege('service_role', 'public.mystery_create_session(uuid,text,text,text,text,jsonb,boolean,jsonb,jsonb,text,text)', 'EXECUTE'),
  'service_role executes the new create signature');
select is((select count(*)::int from pg_proc where proname = 'mystery_create_session' and pronamespace = 'public'::regnamespace), 1,
  'exactly one mystery_create_session overload (the 10-argument one was replaced)');
select ok(exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'mystery_results'),
  'Realtime: mystery_results stays published (the home panel listens for INSERTs)');
select is((select count(*)::int from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public'
           and tablename in ('mystery_events', 'mystery_sessions', 'mystery_offered_duos')), 0, 'Realtime: no private mystery table published');

-- ---------------------------------------------------------------- immutability --------------------
select throws_ok($$update public.mystery_results set hits = 0 where session_id = 'a1111111-1111-4111-8111-111111111111'$$,
  '42501', null, 'v4 results are immutable');

select * from finish();
rollback;
