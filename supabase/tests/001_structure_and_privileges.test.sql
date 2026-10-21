-- Structural security invariants: RLS on, no write policies, minimal grants, RPC execute revoked,
-- Realtime publication limited to the sanitized projections. Run with `supabase test db`.
begin;
create extension if not exists pgtap with schema extensions;
select plan(32);

-- RLS enabled on every public table ------------------------------------------------------------
select is(
  (select count(*)::int from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity),
  0, 'every table in public has RLS enabled');

select ok(
  (select bool_and(c.relrowsecurity) from pg_class c
   where c.oid in ('public.stations'::regclass, 'public.app_users'::regclass, 'public.sessions'::regclass,
                   'public.session_secrets'::regclass, 'public.leg_results'::regclass,
                   'public.session_actions'::regclass, 'public.operator_audit'::regclass,
                   'public.station_status'::regclass, 'public.leaderboard_entries'::regclass)),
  'RLS enabled on all nine application tables');

-- Policies ---------------------------------------------------------------------------------------
select is((select count(*)::int from pg_policies where schemaname = 'public' and cmd <> 'SELECT'), 0,
  'no INSERT/UPDATE/DELETE/ALL policies exist on any public table');
select is((select count(*)::int from pg_policies where schemaname = 'public' and tablename = 'session_secrets'), 0,
  'session_secrets has no policies at all');
select is((select count(*)::int from pg_policies where schemaname = 'public' and tablename in ('sessions', 'leg_results', 'session_actions', 'app_users', 'stations', 'operator_audit') and 'anon' = any(roles)), 0,
  'no policy grants anon access to private tables');

-- Table privileges ---------------------------------------------------------------------------------
select is(
  (select count(*)::int
   from pg_class c join pg_namespace n on n.oid = c.relnamespace,
        unnest(array['anon', 'authenticated']) r,
        unnest(array['INSERT', 'UPDATE', 'REFERENCES']) p
   where n.nspname = 'public' and c.relkind in ('r', 'v') and has_any_column_privilege(r, c.oid, p)),
  0, 'anon/authenticated hold no INSERT/UPDATE/REFERENCES (table or column) on public relations');
select is(
  (select count(*)::int
   from pg_class c join pg_namespace n on n.oid = c.relnamespace,
        unnest(array['anon', 'authenticated']) r,
        unnest(array['DELETE', 'TRUNCATE', 'TRIGGER']) p
   where n.nspname = 'public' and c.relkind in ('r', 'v') and has_table_privilege(r, c.oid, p)),
  0, 'anon/authenticated hold no DELETE/TRUNCATE/TRIGGER on public relations');

select ok(not has_any_column_privilege('anon', 'public.sessions', 'SELECT'), 'anon cannot select sessions');
select ok(not has_any_column_privilege('anon', 'public.session_secrets', 'SELECT'), 'anon cannot select session_secrets');
select ok(not has_any_column_privilege('authenticated', 'public.session_secrets', 'SELECT'), 'authenticated cannot select session_secrets');
select ok(not has_any_column_privilege('anon', 'public.leg_results', 'SELECT'), 'anon cannot select leg_results');
select ok(not has_any_column_privilege('anon', 'public.session_actions', 'SELECT'), 'anon cannot select session_actions');
select ok(not has_any_column_privilege('anon', 'public.app_users', 'SELECT'), 'anon cannot select app_users');
select ok(not has_column_privilege('authenticated', 'public.sessions', 'state', 'SELECT'), 'authenticated cannot select sessions.state');
select ok(not has_column_privilege('authenticated', 'public.leg_results', 'draws', 'SELECT'), 'authenticated cannot select leg_results.draws');
select ok(has_table_privilege('anon', 'public.station_status', 'SELECT'), 'anon can select station_status');
select ok(has_table_privilege('anon', 'public.leaderboard_entries', 'SELECT'), 'anon can select leaderboard_entries');
select ok(has_table_privilege('anon', 'public.verified_leaderboard', 'SELECT'), 'anon can select verified_leaderboard');

-- Views run with the caller's privileges --------------------------------------------------------
select ok((select reloptions from pg_class where oid = 'public.verified_leaderboard'::regclass) @> array['security_invoker=true'],
  'verified_leaderboard is security_invoker');
select ok((select reloptions from pg_class where oid = 'public.defeated_log'::regclass) @> array['security_invoker=true'],
  'defeated_log is security_invoker');

-- RPC execute privileges --------------------------------------------------------------------------
select is(
  (select count(*)::int from unnest(array[
      'public.create_session_atomic(uuid,text,text,text,text,jsonb,jsonb,jsonb,text)',
      'public.commit_session_transition(uuid,integer,text,text,jsonb,jsonb,jsonb,jsonb)',
      'public.release_station(text,uuid)',
      'public.operator_reset_station(text,uuid,text,uuid[])']) f,
     unnest(array['anon', 'authenticated', 'public']) r
   where case when r = 'public'
              then exists (select 1 from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                           where p.oid = f::regprocedure and a.grantee = 0 and a.privilege_type = 'EXECUTE')
              else has_function_privilege(r, f, 'EXECUTE') end),
  0, 'anon, authenticated and PUBLIC cannot execute any write RPC');
select ok(has_function_privilege('service_role', 'public.commit_session_transition(uuid,integer,text,text,jsonb,jsonb,jsonb,jsonb)', 'EXECUTE'),
  'service_role can execute commit_session_transition');
select ok(has_function_privilege('service_role', 'public.create_session_atomic(uuid,text,text,text,text,jsonb,jsonb,jsonb,text)', 'EXECUTE'),
  'service_role can execute create_session_atomic');
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('create_session_atomic', 'commit_session_transition', 'release_station', 'operator_reset_station')
     and p.prosecdef and p.proconfig @> array['search_path=""']),
  4, 'all four RPCs are SECURITY DEFINER with an empty search_path');
select ok(not has_function_privilege('anon', 'private.is_operator()', 'EXECUTE'), 'anon cannot execute private.is_operator');
select ok(not has_schema_privilege('anon', 'private', 'USAGE'), 'anon has no usage on schema private');

-- Realtime publication ----------------------------------------------------------------------------
select is(
  (select array_agg(tablename::text order by tablename) from pg_publication_tables
   where pubname = 'supabase_realtime' and schemaname = 'public'),
  array['leaderboard_entries', 'station_status'],
  'supabase_realtime publishes exactly station_status and leaderboard_entries from public');
select ok(not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime'
                      and tablename in ('sessions', 'session_secrets', 'leg_results', 'session_actions')),
  'sessions/secrets/leg_results/actions are never published');

-- Integrity constraints ---------------------------------------------------------------------------
select ok(exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'sessions_one_active_per_station_idx'),
  'partial unique index enforces one in-progress session per station');
select ok(exists (select 1 from pg_constraint where conname = 'session_actions_session_action_key'),
  'unique (session_id, action_id) on session_actions');
select ok(exists (select 1 from pg_constraint where conname = 'leg_results_session_leg_key'),
  'unique (session_id, leg_index) on leg_results');
select is((select count(*)::int from public.stations), 2, 'two stations seeded');

select * from finish();
rollback;
