-- Row Level Security + explicit privileges.
-- Supabase's default privileges grant ALL on new public tables/functions to anon and authenticated, so we
-- first REVOKE everything and then grant back only the minimal SELECTs. RLS is the second, independent layer.
-- Nothing in this file allows INSERT/UPDATE/DELETE to anon or authenticated: all writes go through Edge
-- Functions (service role) -> SECURITY DEFINER RPCs.

-- ---------------------------------------------------------------------------------------------
-- Helper predicates (SECURITY DEFINER so they can read app_users regardless of its RLS)
-- ---------------------------------------------------------------------------------------------
create function private.current_station_id() returns text
language sql stable security definer set search_path = '' as $$
  select au.station_id
  from public.app_users au
  where au.user_id = (select auth.uid()) and au.role = 'station'
$$;

create function private.is_operator() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.app_users au
    where au.user_id = (select auth.uid()) and au.role = 'operator'
  )
$$;

revoke all on schema private from public, anon;
grant usage on schema private to authenticated, service_role;
revoke execute on all functions in schema private from public, anon;
grant execute on function private.current_station_id() to authenticated, service_role;
grant execute on function private.is_operator() to authenticated, service_role;

-- ---------------------------------------------------------------------------------------------
-- Enable RLS everywhere
-- ---------------------------------------------------------------------------------------------
alter table public.stations            enable row level security;
alter table public.app_users           enable row level security;
alter table public.sessions            enable row level security;
alter table public.session_secrets     enable row level security;
alter table public.leg_results         enable row level security;
alter table public.session_actions     enable row level security;
alter table public.operator_audit      enable row level security;
alter table public.station_status      enable row level security;
alter table public.leaderboard_entries enable row level security;

-- ---------------------------------------------------------------------------------------------
-- Strip default privileges, then grant the minimum
-- ---------------------------------------------------------------------------------------------
revoke all on table
  public.stations, public.app_users, public.sessions, public.session_secrets, public.leg_results,
  public.session_actions, public.operator_audit, public.station_status, public.leaderboard_entries,
  public.verified_leaderboard, public.defeated_log
from public, anon, authenticated;

grant all on table
  public.stations, public.app_users, public.sessions, public.session_secrets, public.leg_results,
  public.session_actions, public.operator_audit, public.station_status, public.leaderboard_entries,
  public.verified_leaderboard, public.defeated_log
to service_role;

-- Public projections: readable by everyone (dashboard runs with the anon key).
grant select on table public.station_status, public.leaderboard_entries to anon, authenticated;
grant select on table public.verified_leaderboard, public.defeated_log to anon, authenticated;

create policy station_status_public_read on public.station_status
  for select to anon, authenticated using (true);
create policy leaderboard_public_read on public.leaderboard_entries
  for select to anon, authenticated using (true);

-- Stations: signed-in users only (labels).
grant select on table public.stations to authenticated;
create policy stations_authenticated_read on public.stations
  for select to authenticated using (true);

-- app_users: a signed-in user may read only their own binding (the client uses it to pick terminal/dashboard).
grant select on table public.app_users to authenticated;
create policy app_users_read_own on public.app_users
  for select to authenticated using (user_id = (select auth.uid()));

-- sessions: column-level grant EXCLUDES `state` (full snapshot with draws). Station -> own station; operator -> all.
grant select (
  id, station_id, nickname, character_id, pokemon_id, status, phase, leg_index, revision, hp, stamina, gap_m,
  hyde_catch_count, banked_egg_points, unbanked_egg_points, total_simulated_time_cs, final_egg_points, final_score,
  dnf_reason, rules_version, model_version, seed_commitment, created_at, updated_at, completed_at, verified_at,
  abandoned_at, abandoned_reason
) on table public.sessions to authenticated;
create policy sessions_station_or_operator_read on public.sessions
  for select to authenticated
  using (station_id = (select private.current_station_id()) or (select private.is_operator()));

-- leg_results: column-level grant EXCLUDES `draws`.
grant select (
  id, session_id, station_id, leg_index, route, push_level, weather, egg_offer, egg_decision, crash, hyde_catch,
  outcome, leg_time_cs, time_breakdown, resolution, created_at
) on table public.leg_results to authenticated;
create policy leg_results_station_or_operator_read on public.leg_results
  for select to authenticated
  using (station_id = (select private.current_station_id()) or (select private.is_operator()));

-- session_actions + operator_audit: operators only (audit). Stored responses are already draw-redacted.
grant select on table public.session_actions, public.operator_audit to authenticated;
create policy session_actions_operator_read on public.session_actions
  for select to authenticated using ((select private.is_operator()));
create policy operator_audit_operator_read on public.operator_audit
  for select to authenticated using ((select private.is_operator()));

-- session_secrets: RLS enabled, privileges revoked, and deliberately NO policy for any client role.

-- Sequences behind identity columns: no client access.
revoke all on all sequences in schema public from public, anon, authenticated;
