-- mystery-v3.1 RPC semantics: idempotent create + supersede, offered-duo selection, event dedupe/order backstops,
-- idempotent finalization, leaderboard ordering (negative finishers above DNFs), operator reset, and proof that the
-- v2.5 rows are untouched by all of it. Rolled back at the end.
begin;
create extension if not exists pgtap with schema extensions;
select plan(64);

do $$
begin
  perform private.mystery_clear_status('station_a', null);
  perform private.mystery_clear_status('station_b', null);
  delete from public.mystery_sessions;
end;
$$;

-- ---------------------------------------------------------------- fixtures ---------------------
create function pg_temp.card(p_char text, p_pkmn text) returns jsonb language sql as $$
  select jsonb_build_object('characterId', p_char, 'pokemonId', p_pkmn, 'duoName', 'The Test Duo', 'role', 'defense',
    'rarity', 'rare', 'stats', jsonb_build_object('investigation', 2, 'stealth', 3, 'mobility', 4, 'defense', 5,
    'hydeControl', 1, 'eggProtection', 3), 'mods', '{}'::jsonb, 'advantages', '[]'::jsonb, 'disadvantages', '[]'::jsonb)
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
-- Same, then age the row so the per-station rate limit (6/min) does not interfere with later fixtures.
create function pg_temp.mk_old(p_id uuid, p_station text, p_nick text, p_test boolean default false) returns jsonb
language plpgsql as $$
declare r jsonb;
begin
  r := pg_temp.mk(p_id, p_station, 'act_' || replace(p_id::text, '-', ''), md5(p_id::text), p_nick, p_test);
  update public.mystery_sessions set created_at = created_at - interval '5 minutes' where id = p_id;
  return r;
end $$;
create function pg_temp.ev(p_seq int, p_t float8, p_type text, p_payload jsonb default '{}'::jsonb) returns jsonb
language sql as $$ select jsonb_build_object('seq', p_seq, 't', p_t, 'type', p_type, 'payload', p_payload) $$;
-- A full finished run (select -> 4 events -> finalize). Score follows the v3.1 formula.
create function pg_temp.finish_run(p_id uuid, p_station text, p_points int, p_tier text, p_t float8, p_accused text, p_verdict text,
  p_clues text[]) returns jsonb language plpgsql as $$
declare v_time numeric := round(p_t::numeric, 1);
begin
  perform public.mystery_select_duo(p_id, p_station, 'wednesday', 'gengar', pg_temp.req('{}'));
  perform public.mystery_append_events(p_id, p_station, -1, jsonb_build_array(
      pg_temp.ev(0, 1, 'egg_pickup'),
      pg_temp.ev(1, p_t, 'egg_delivered', jsonb_build_object('tier', p_tier, 'points', p_points, 'security', 90)),
      pg_temp.ev(2, p_t, 'accusation', jsonb_build_object('suspectId', p_accused, 'correct', p_verdict = 'case_solved', 'cluesFound', cardinality(p_clues))),
      pg_temp.ev(3, p_t, 'finish', jsonb_build_object('verdict', p_verdict, 'score', p_points * 100 - v_time))),
    '{"v":1,"egg":"delivered"}', null, null);
  return public.mystery_finalize_session(p_id, p_station, 3, jsonb_build_object(
    'outcome', 'finished', 'dnfReason', null, 'verdict', p_verdict, 'accused', p_accused, 'correct', p_verdict = 'case_solved',
    'cluesFound', to_jsonb(p_clues), 'eggTier', p_tier, 'eggPoints', p_points, 'eggSecurity', 90, 'activeTimeS', v_time,
    'score', p_points * 100 - v_time, 'catches', 0,
    'evidence', case when p_accused is null then '[]'::jsonb else to_jsonb(p_clues) end,
    'deductionCorrect', p_verdict = 'case_solved'), pg_temp.req('{}'));
end $$;
create function pg_temp.dnf_run(p_id uuid, p_station text, p_t float8) returns jsonb language plpgsql as $$
begin
  perform public.mystery_select_duo(p_id, p_station, 'gomez', 'aegislash', pg_temp.req('{}'));
  perform public.mystery_append_events(p_id, p_station, -1, jsonb_build_array(
      pg_temp.ev(0, p_t / 2, 'catch', '{"catchNumber":1,"hpLost":35,"eggSecurityLost":0,"blocked":false}'),
      pg_temp.ev(1, p_t, 'catch', '{"catchNumber":2,"hpLost":35,"eggSecurityLost":0,"blocked":false}'),
      pg_temp.ev(2, p_t, 'dnf', '{"reason":"second_catch"}')),
    '{"v":1,"egg":"resting"}', null, null);
  return public.mystery_finalize_session(p_id, p_station, 2, jsonb_build_object(
    'outcome', 'dnf', 'dnfReason', 'second_catch', 'verdict', 'not_accused', 'accused', null, 'correct', false,
    'cluesFound', '[]'::jsonb, 'eggTier', 'rare', 'eggPoints', 0, 'eggSecurity', 100, 'activeTimeS', round(p_t::numeric, 1),
    'score', null, 'catches', 2), pg_temp.req('{}'));
end $$;

-- v2.5 baseline: one legacy session + leaderboard entry, snapshotted before any mystery work.
insert into public.sessions (id, station_id, create_action_id, nickname, character_id, pokemon_id, status, phase, leg_index,
  revision, hp, stamina, gap_m, hyde_catch_count, banked_egg_points, unbanked_egg_points, total_simulated_time_cs,
  final_egg_points, final_score, flags, state, rules_version, seed_commitment, completed_at, verified_at)
values ('99999999-9999-4999-8999-999999999999', 'station_a', 'legacy_v25_001', 'Legacy', 'xavier', 'gengar', 'completed', 'complete', 3,
  7, 60, 2, 40, 1, 9, 0, 54321, 9, 812.34, '{}', '{"legacy":true}', 'v2.5', repeat('a', 64), now(), now());
insert into public.leaderboard_entries (session_id, nickname, station_id, character_id, pokemon_id, status, final_egg_points,
  total_simulated_time_cs, final_score, rules_version, verified_at)
values ('99999999-9999-4999-8999-999999999999', 'Legacy', 'station_a', 'xavier', 'gengar', 'completed', 9, 54321, 812.34, 'v2.5', now());
create temp table v25_before as
  select (select jsonb_agg(to_jsonb(s) order by s.id) from public.sessions s) as sessions,
         (select jsonb_agg(to_jsonb(l) order by l.session_id) from public.leaderboard_entries l) as board,
         (select jsonb_agg(to_jsonb(ss) order by ss.station_id) from public.station_status ss) as status,
         (select jsonb_agg(to_jsonb(v) order by v.session_id) from public.verified_leaderboard v) as ranked;

-- ---------------------------------------------------------------- create -----------------------
select is(pg_temp.mk('10000000-0000-4000-8000-000000000001', 'station_a', 'm_act_a_0001', '11111111111111111111111111111111', 'Annie') ->> 'replay',
  'false', 'create: new session');
select is((select count(*)::int from public.mystery_offered_duos where session_id = '10000000-0000-4000-8000-000000000001'), 3,
  'create: exactly three cards stored');
select is((select status from public.mystery_station_status where station_id = 'station_a'), 'offered', 'create: station A shows offered');
select is(pg_temp.mk('10000000-0000-4000-8000-0000000000ff', 'station_a', 'm_act_a_0001', '22222222222222222222222222222222', 'Annie'),
  jsonb_build_object('ok', true, 'replay', true, 'sessionId', '10000000-0000-4000-8000-000000000001',
    'caseId', (select case_id from public.mystery_sessions where id = '10000000-0000-4000-8000-000000000001'), 'caseVersion', 1, 'rulesVersion', 'mystery-v3.1'),
  'create: same actionId replays the ORIGINAL session and its case (new seed/offer ignored, nothing drawn)');
select is((select count(*)::int from public.mystery_sessions where station_id = 'station_a'), 1, 'create: replay inserted nothing');
select is((select seed from public.mystery_sessions where id = '10000000-0000-4000-8000-000000000001'), '11111111111111111111111111111111',
  'create: the stored seed is unchanged by the replay');
select is(pg_temp.mk('10000000-0000-4000-8000-0000000000fe', 'station_a', 'm_act_a_0001', '22222222222222222222222222222222', 'Other') ->> 'error',
  'ACTION_ID_CONFLICT', 'create: same actionId with a different body is a conflict');
select is(public.mystery_create_session('10000000-0000-4000-8000-0000000000fd', 'station_a', 'm_act_a_bad1', '33333333333333333333333333333333',
  'Annie', jsonb_build_object('seed', '33333333333333333333333333333333', 'cards', jsonb_build_array(pg_temp.card('enid', 'gengar'))), false,
  pg_temp.req('{}'), pg_temp.versions()) ->> 'error', 'INVALID_INPUT', 'create: an offer that is not exactly three cards is refused');
select is(public.mystery_create_session('10000000-0000-4000-8000-0000000000fc', 'station_a', 'm_act_a_bad2', '33333333333333333333333333333333',
  'Annie', pg_temp.offer('44444444444444444444444444444444'), false, pg_temp.req('{}'), pg_temp.versions()) ->> 'error', 'INVALID_INPUT',
  'create: an offer drawn from another seed is refused');
select is(public.mystery_create_session('10000000-0000-4000-8000-0000000000fb', 'station_z', 'm_act_z_0001', '33333333333333333333333333333333',
  'Annie', pg_temp.offer('33333333333333333333333333333333'), false, pg_temp.req('{}'), pg_temp.versions()) ->> 'error', 'STATION_NOT_FOUND', 'create: unknown station');
select is(public.mystery_create_session('10000000-0000-4000-8000-0000000000fa', 'station_a', 'm_act_a_bad3', '33333333333333333333333333333333',
  'Annie', pg_temp.offer('33333333333333333333333333333333'), false, pg_temp.req('{}'), '{"poisoned_archive":1}') ->> 'error', 'INVALID_INPUT',
  'create: case versions must cover all three cases');
select ok((select case_id in ('poisoned_archive', 'crypt_last_witness', 'midnight_signal') and case_version = 1
  from public.mystery_sessions where id = '10000000-0000-4000-8000-000000000001'), 'create: the session was assigned a case (+ deployed version)');

-- ---------------------------------------------------------------- select -----------------------
select is(public.mystery_append_events('10000000-0000-4000-8000-000000000001', 'station_a', -1, jsonb_build_array(pg_temp.ev(0, 1, 'egg_pickup')),
  '{"v":1}', null, null) ->> 'error', 'NOT_SELECTED', 'append: refused before a duo is selected');
select is(public.mystery_select_duo('10000000-0000-4000-8000-000000000001', 'station_a', 'ajax', 'gengar', pg_temp.req('{}')) ->> 'error',
  'DUO_NOT_OFFERED', 'select: a pair that was not offered is refused');
select is(public.mystery_select_duo('10000000-0000-4000-8000-000000000001', 'station_a', 'wednesday', 'drifblim', pg_temp.req('{}')) ->> 'error',
  'DUO_NOT_OFFERED', 'select: mixing character and Pokemon of two different cards is refused');
select is(public.mystery_select_duo('10000000-0000-4000-8000-000000000001', 'station_b', 'enid', 'drifblim', pg_temp.req('{}')) ->> 'error',
  'SESSION_NOT_FOUND', 'select: another station cannot select on this session');
select is(public.mystery_select_duo('10000000-0000-4000-8000-000000000001', 'station_a', 'enid', 'drifblim', pg_temp.req('{}')),
  jsonb_build_object('ok', true, 'replay', false, 'slot', 1), 'select: offered card 1 selected');
select is(public.mystery_select_duo('10000000-0000-4000-8000-000000000001', 'station_a', 'enid', 'drifblim', pg_temp.req('{}')) ->> 'replay',
  'true', 'select: the same choice again is an idempotent replay');
select is(public.mystery_select_duo('10000000-0000-4000-8000-000000000001', 'station_a', 'gomez', 'aegislash', pg_temp.req('{}')) ->> 'error',
  'ALREADY_SELECTED', 'select: a different duo afterwards is refused');
select results_eq($$select status, character_id, pokemon_id, selected_slot::int from public.mystery_sessions where id = '10000000-0000-4000-8000-000000000001'$$,
  $$values ('playing'::text, 'enid'::text, 'drifblim'::text, 1)$$, 'select: session is playing with the chosen duo');

-- ---------------------------------------------------------------- append -----------------------
select is(public.mystery_append_events('10000000-0000-4000-8000-000000000001', 'station_a', -1, jsonb_build_array(
    pg_temp.ev(0, 0.25, 'stance', '{"stance":"crouch"}'), pg_temp.ev(1, 4.5, 'clue_found', '{"clueId":"falsified_transfer","cluesFound":1}'),
    pg_temp.ev(3, 9.125, 'hyde_sighted', '{"distanceM":11.2}')),
  '{"v":1,"egg":"resting","cluesFound":["falsified_transfer"]}', null, null) ->> 'lastSeq', '3', 'append: batch with a seq gap accepted');
select is(public.mystery_append_events('10000000-0000-4000-8000-000000000001', 'station_a', -1, jsonb_build_array(pg_temp.ev(4, 10, 'egg_pickup')),
  '{"v":1}', null, null) ->> 'error', 'STALE_EVENTS', 'append: stale expected last_seq -> STALE_EVENTS');
select is(public.mystery_append_events('10000000-0000-4000-8000-000000000001', 'station_a', 3, jsonb_build_array(pg_temp.ev(3, 10, 'egg_pickup')),
  '{"v":1}', null, null) ->> 'error', 'EVENT_REJECTED', 'append: a seq at or below last_seq is refused (no overwrite)');
select is(public.mystery_append_events('10000000-0000-4000-8000-000000000001', 'station_a', 3, jsonb_build_array(pg_temp.ev(4, 8, 'egg_pickup')),
  '{"v":1}', null, null) ->> 'error', 'EVENT_REJECTED', 'append: t going backwards is refused');
select is(public.mystery_append_events('10000000-0000-4000-8000-000000000001', 'station_a', 3, jsonb_build_array(
    pg_temp.ev(4, 12, 'stance', '{"stance":"walk"}'), pg_temp.ev(4, 12, 'stance', '{"stance":"idle"}')),
  '{"v":1}', null, null) ->> 'error', 'EVENT_REJECTED', 'append: a duplicate seq inside one batch is refused');
select throws_ok($$select public.mystery_append_events('10000000-0000-4000-8000-000000000001', 'station_a', 3, jsonb_build_array(
    pg_temp.ev(4, 12, 'clue_found', '{"clueId":"falsified_transfer","cluesFound":2}')), '{"v":1}', null, null)$$,
  '23505', null, 'append: a clue found twice violates the clue uniqueness backstop');
select results_eq($$select last_seq, event_count, clues_found::int, sightings from public.mystery_sessions where id = '10000000-0000-4000-8000-000000000001'$$,
  $$values (3, 3, 1, 1)$$, 'append: projections (last_seq, count, clues, sightings) consistent after rejected batches');
select is((select t from public.mystery_events where session_id = '10000000-0000-4000-8000-000000000001' and seq = 3), 9.125::float8,
  'append: sim time stored exactly (double precision)');
select is(public.mystery_finalize_session('10000000-0000-4000-8000-000000000001', 'station_a', 3, '{"outcome":"finished"}', pg_temp.req('{}')) ->> 'error',
  'RUN_NOT_FINISHED', 'finalize: refused before a finish/dnf event');
-- analytics: forecast immutability + recommendation fill-only upsert
select is(public.mystery_append_events('10000000-0000-4000-8000-000000000001', 'station_a', 3, '[]', '{"v":1,"egg":"resting"}',
  jsonb_build_array(jsonb_build_object('forecastNo', 1, 't', 9.5, 'target', 'detection_15s', 'value', 0.73, 'modelLabel', 'ml', 'modelVersion', 'lr-1', 'features', '{"d":4}'::jsonb)),
  jsonb_build_array(jsonb_build_object('recNo', 1, 't', 9.5, 'action', 'hide', 'advice', 'Hide in the alcove'))) ->> 'forecastsInserted',
  '1', 'append: forecast stored with model label');
select is(public.mystery_append_events('10000000-0000-4000-8000-000000000001', 'station_a', 3, '[]', '{"v":1,"egg":"resting"}',
  jsonb_build_array(jsonb_build_object('forecastNo', 1, 't', 9.5, 'target', 'detection_15s', 'value', 0.01, 'modelLabel', 'ml', 'features', '{}'::jsonb)),
  jsonb_build_array(jsonb_build_object('recNo', 1, 't', 9.5, 'action', 'hide', 'advice', 'Hide in the alcove', 'accepted', true, 'outcome', 'escaped'))) ->> 'forecastsInserted',
  '0', 'append: a resent forecast is ignored (prediction kept as issued)');
select results_eq($$select f.value, r.accepted, r.outcome from public.mystery_forecasts f, public.mystery_recommendations r
  where f.session_id = '10000000-0000-4000-8000-000000000001' and r.session_id = f.session_id$$,
  $$values (0.73::numeric(12,4), true, 'escaped'::text)$$, 'append: forecast value unchanged, recommendation acceptance + outcome filled');
select is(public.mystery_append_events('10000000-0000-4000-8000-000000000001', 'station_a', 3, '[]', '{"v":1,"egg":"resting"}', null,
  jsonb_build_array(jsonb_build_object('recNo', 1, 't', 9.5, 'action', 'hide', 'advice', 'Hide in the alcove', 'accepted', false, 'outcome', 'caught'))) ->> 'recommendationsUpserted',
  '0', 'append: a filled recommendation outcome cannot be rewritten');

-- ---------------------------------------------------------------- finalize ---------------------
select is(public.mystery_append_events('10000000-0000-4000-8000-000000000001', 'station_a', 3, jsonb_build_array(
    pg_temp.ev(4, 20, 'egg_pickup'),
    pg_temp.ev(5, 123.45, 'egg_delivered', '{"tier":"rare","points":3,"security":72.5}'),
    pg_temp.ev(6, 123.45, 'accusation', '{"suspectId":"isaac","correct":false,"cluesFound":1,"evidence":["falsified_transfer"],"deductionCorrect":false}'),
    pg_temp.ev(7, 123.45, 'finish', '{"verdict":"egg_secured_mystery_unsolved","score":176.5}')),
  '{"v":1,"egg":"delivered"}', null, null) ->> 'terminal', 'finish', 'append: terminal finish event recorded');
select is(public.mystery_finalize_session('10000000-0000-4000-8000-000000000001', 'station_a', 7, '{"outcome":"dnf"}', pg_temp.req('{}')) ->> 'error',
  'INVALID_TRANSITION', 'finalize: outcome must match the recorded terminal event');
select is(public.mystery_finalize_session('10000000-0000-4000-8000-000000000001', 'station_a', 6, '{"outcome":"finished"}', pg_temp.req('{}')) ->> 'error',
  'STALE_EVENTS', 'finalize: computed from a stale event set -> STALE_EVENTS');
select is(public.mystery_finalize_session('10000000-0000-4000-8000-000000000001', 'station_a', 7, jsonb_build_object('outcome', 'finished',
  'caseId', 'not_' || (select case_id from public.mystery_sessions where id = '10000000-0000-4000-8000-000000000001')), pg_temp.req('{}')) ->> 'error',
  'INVALID_TRANSITION', 'finalize: a result computed for another case is refused');
create temp table fin1 as select public.mystery_finalize_session('10000000-0000-4000-8000-000000000001', 'station_a', 7, jsonb_build_object(
  'outcome', 'finished', 'dnfReason', null, 'verdict', 'egg_secured_mystery_unsolved', 'accused', 'isaac', 'correct', false,
  'cluesFound', '["falsified_transfer"]'::jsonb, 'eggTier', 'rare', 'eggPoints', 3, 'eggSecurity', 72.5, 'activeTimeS', 123.5, 'score', 176.5,
  'catches', 0, 'sightings', 1, 'hintsUsed', 0, 'clientClaim', '{"finishScore":176.5}'::jsonb, 'claimMatches', true,
  'evidence', '["falsified_transfer"]'::jsonb, 'deductionCorrect', false), pg_temp.req('{}')) as r;
select is((select r ->> 'replay' from fin1), 'false', 'finalize: first call publishes');
select is((select (r #>> '{result,score}')::numeric from fin1), 176.5, 'finalize: score = 3 x 100 - 123.5');
select results_eq($$select r.case_id, r.case_version::int, r.evidence, r.deduction_correct from public.mystery_results r
  join public.mystery_sessions s on s.id = r.session_id and s.case_id = r.case_id
  where r.session_id = '10000000-0000-4000-8000-000000000001'$$,
  $$values ((select case_id from public.mystery_sessions where id = '10000000-0000-4000-8000-000000000001'), 1, array['falsified_transfer'], false)$$,
  'finalize: result stores the SESSION''s case, the cited evidence and the deduction flag');
create temp table fin2 as select public.mystery_finalize_session('10000000-0000-4000-8000-000000000001', 'station_a', 0,
  '{"outcome":"finished","score":600}', pg_temp.req('{}')) as r;
select is((select r ->> 'replay' from fin2), 'true', 'finalize: second call is a replay (whatever the body)');
select is((select r -> 'result' from fin2), (select r -> 'result' from fin1), 'finalize: second call returns the SAME stored row');
select is((select count(*)::int from public.mystery_results where session_id = '10000000-0000-4000-8000-000000000001'), 1, 'finalize: exactly one result row');
select results_eq($$select status, score, verdict from public.mystery_station_status where station_id = 'station_a'$$,
  $$values ('finished'::text, 176.5::numeric(9,1), 'egg_secured_mystery_unsolved'::text)$$, 'finalize: station A shows the verified result');
select is(public.mystery_append_events('10000000-0000-4000-8000-000000000001', 'station_a', 7, jsonb_build_array(pg_temp.ev(8, 130, 'noise',
  '{"source":"footstep","x":0,"z":0,"loudness":0.3,"radiusM":7}')), '{"v":1}', null, null) ->> 'error', 'SESSION_CLOSED', 'append: refused after finalization');
select is(public.mystery_select_duo('10000000-0000-4000-8000-000000000001', 'station_a', 'gomez', 'aegislash', pg_temp.req('{}')) ->> 'error',
  'ALREADY_SELECTED', 'select: cannot change the duo of a finished run');

-- ---------------------------------------------------------------- supersede + rate limit -------
select is(pg_temp.mk('10000000-0000-4000-8000-000000000002', 'station_a', 'm_act_a_0002', '55555555555555555555555555555555', 'Bert') ->> 'ok', 'true',
  'create: a second session on station A');
select is(pg_temp.mk('10000000-0000-4000-8000-000000000003', 'station_a', 'm_act_a_0003', '66666666666666666666666666666666', 'Cleo') -> 'supersededSessionIds',
  '["10000000-0000-4000-8000-000000000002"]'::jsonb, 'create: the open session is superseded (the finished one is not)');
select results_eq($$select status, abandoned_reason from public.mystery_sessions where id = '10000000-0000-4000-8000-000000000002'$$,
  $$values ('abandoned'::text, 'superseded'::text)$$, 'supersede: old session abandoned, unranked');
select is((select count(*)::int from public.mystery_sessions where station_id = 'station_a' and status in ('offered', 'playing')), 1,
  'supersede: still exactly one open session per station');
select throws_ok($$insert into public.mystery_sessions (id, station_id, create_action_id, seed, nickname, case_id, case_version)
  values (gen_random_uuid(), 'station_a', 'm_direct_0001', '77777777777777777777777777777777', 'Dora', 'midnight_signal', 1)$$, '23505', null,
  'the database itself refuses a second open session on a station');
do $$ begin
  perform pg_temp.mk(gen_random_uuid(), 'station_a', 'm_rl_000' || i, lpad(i::text, 32, '0'), 'Rate') from generate_series(1, 3) i;
end $$;
select is(pg_temp.mk('10000000-0000-4000-8000-0000000000aa', 'station_a', 'm_rl_0009', '99999999999999999999999999999999', 'Rate') ->> 'error',
  'RATE_LIMITED', 'create: more than 6 sessions per station per minute -> RATE_LIMITED');

-- ---------------------------------------------------------------- operator reset ---------------
select is(jsonb_array_length(public.mystery_abandon_station('station_a', 'operator_reset', pg_temp.req('{"note":"stuck"}')) -> 'abandonedSessionIds'), 1,
  'reset: the open session on station A is abandoned');
select results_eq($$select status, notice from public.mystery_station_status where station_id = 'station_a'$$,
  $$values ('idle'::text, 'operator_reset'::text)$$, 'reset: station A shows idle with an operator_reset notice');
select is((select count(*)::int from public.mystery_results where session_id = '10000000-0000-4000-8000-000000000001'), 1,
  'reset: published results are never touched by a reset');
select is(public.mystery_abandon_station('station_a', 'hacked', pg_temp.req('{}')) ->> 'error', 'INVALID_INPUT', 'reset: unknown reason refused');

-- ---------------------------------------------------------------- leaderboard ordering ---------
-- clear station A/B leaderboard fixtures: finishers with high / low / NEGATIVE scores, DNFs, a test run.
do $$ begin
  delete from public.mystery_sessions where id <> '10000000-0000-4000-8000-000000000001';
  perform pg_temp.mk_old('20000000-0000-4000-8000-000000000001', 'station_b', 'High');
  perform pg_temp.finish_run('20000000-0000-4000-8000-000000000001', 'station_b', 6, 'legendary', 300.04, 'thornhill', 'case_solved',
    array['falsified_transfer', 'botanical_residue', 'access_ledger']);                            -- 300.0
  perform pg_temp.mk_old('20000000-0000-4000-8000-000000000002', 'station_b', 'Neg');
  perform pg_temp.finish_run('20000000-0000-4000-8000-000000000002', 'station_b', 1, 'common', 345.66, 'barry', 'egg_secured_mystery_unsolved',
    array['access_ledger']);                                                                       -- -245.7
  perform pg_temp.mk_old('20000000-0000-4000-8000-000000000003', 'station_b', 'Quit');
  perform pg_temp.finish_run('20000000-0000-4000-8000-000000000003', 'station_b', 1, 'common', 100, null, 'not_accused', array[]::text[]); -- 0.0
  perform pg_temp.mk_old('20000000-0000-4000-8000-000000000004', 'station_b', 'Doom');
  perform pg_temp.dnf_run('20000000-0000-4000-8000-000000000004', 'station_b', 50);
  perform pg_temp.mk_old('20000000-0000-4000-8000-000000000005', 'station_b', 'Doom2');
  perform pg_temp.dnf_run('20000000-0000-4000-8000-000000000005', 'station_b', 500);
  perform pg_temp.mk_old('20000000-0000-4000-8000-000000000006', 'station_b', 'Test', true);
  perform pg_temp.finish_run('20000000-0000-4000-8000-000000000006', 'station_b', 6, 'legendary', 10, 'thornhill', 'egg_secured_mystery_unsolved', array['access_ledger']);
end $$;
select results_eq($$select nickname, rank, score from public.mystery_leaderboard$$,
  $$values ('High'::text, 1, 300.0::numeric(9,1)), ('Annie', 2, 176.5), ('Quit', 3, 0.0), ('Neg', 4, -245.7)$$,
  'leaderboard: finishers only, score desc (negative scores included), test run excluded');
select results_eq($$select nickname, standing_group, rank from public.mystery_standings$$,
  $$values ('High'::text, 0, 1), ('Annie', 0, 2), ('Quit', 0, 3), ('Neg', 0, 4), ('Doom2', 1, null::int), ('Doom', 1, null::int)$$,
  'standings: every finisher (even negative) above every DNF; DNFs unranked');
select is((select array_agg(nickname order by nickname) from public.mystery_defeated), array['Doom', 'Doom2'], 'defeated view lists only the DNFs');
select is((select count(*)::int from public.mystery_results where is_test), 1, 'the test-seed run is stored (is_test) but never ranked');

-- ---------------------------------------------------------------- v2.5 untouched ---------------
select is((select jsonb_agg(to_jsonb(s) order by s.id) from public.sessions s), (select sessions from v25_before), 'v2.5 sessions rows untouched');
select is((select jsonb_agg(to_jsonb(l) order by l.session_id) from public.leaderboard_entries l), (select board from v25_before), 'v2.5 leaderboard_entries untouched');
select is((select jsonb_agg(to_jsonb(ss) order by ss.station_id) from public.station_status ss), (select status from v25_before), 'v2.5 station_status untouched');
select is((select jsonb_agg(to_jsonb(v) order by v.session_id) from public.verified_leaderboard v), (select ranked from v25_before),
  'v2.5 verified_leaderboard unchanged (no mystery row leaks into it)');

select * from finish();
rollback;
