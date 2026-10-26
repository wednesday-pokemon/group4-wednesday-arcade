-- mystery-v3.1: Row Level Security + explicit privileges (same model as 20261021000200 for v2.5).
-- Supabase's default privileges grant ALL on new public tables to anon/authenticated, so REVOKE first and grant
-- back only SELECTs. No INSERT/UPDATE/DELETE privilege or policy for any client role: every write goes
-- Edge Function (service role) -> SECURITY DEFINER RPC.

alter table public.mystery_sessions        enable row level security;
alter table public.mystery_offered_duos    enable row level security;
alter table public.mystery_events          enable row level security;
alter table public.mystery_clue_events     enable row level security;
alter table public.mystery_forecasts       enable row level security;
alter table public.mystery_recommendations enable row level security;
alter table public.mystery_results         enable row level security;
alter table public.mystery_session_actions enable row level security;
alter table public.mystery_station_status  enable row level security;

revoke all on table
  public.mystery_sessions, public.mystery_offered_duos, public.mystery_events, public.mystery_clue_events,
  public.mystery_forecasts, public.mystery_recommendations, public.mystery_results, public.mystery_session_actions,
  public.mystery_station_status, public.mystery_leaderboard, public.mystery_defeated, public.mystery_standings
from public, anon, authenticated;

grant all on table
  public.mystery_sessions, public.mystery_offered_duos, public.mystery_events, public.mystery_clue_events,
  public.mystery_forecasts, public.mystery_recommendations, public.mystery_results, public.mystery_session_actions,
  public.mystery_station_status, public.mystery_leaderboard, public.mystery_defeated, public.mystery_standings
to service_role;

-- ---------------------------------------------------------------------------------------------
-- Public (anon dashboard on Laptop 1 + kiosks): live station status and verified results only
-- ---------------------------------------------------------------------------------------------
grant select on table public.mystery_station_status, public.mystery_results to anon, authenticated;
grant select on table public.mystery_leaderboard, public.mystery_defeated, public.mystery_standings to anon, authenticated;

create policy mystery_station_status_public_read on public.mystery_station_status
  for select to anon, authenticated using (true);
-- Test (operator seed-reuse) results are hidden from the public; operators see them through the second policy.
create policy mystery_results_public_read on public.mystery_results
  for select to anon, authenticated using (not is_test);
create policy mystery_results_operator_read on public.mystery_results
  for select to authenticated using ((select private.is_operator()));

-- ---------------------------------------------------------------------------------------------
-- Station-scoped detail: own station (station JWT) or operator. Never anon.
-- ---------------------------------------------------------------------------------------------
grant select on table
  public.mystery_sessions, public.mystery_offered_duos, public.mystery_events, public.mystery_clue_events,
  public.mystery_forecasts, public.mystery_recommendations
to authenticated;

create policy mystery_sessions_station_or_operator_read on public.mystery_sessions
  for select to authenticated
  using (station_id = (select private.current_station_id()) or (select private.is_operator()));
create policy mystery_offered_duos_station_or_operator_read on public.mystery_offered_duos
  for select to authenticated
  using (station_id = (select private.current_station_id()) or (select private.is_operator()));
create policy mystery_events_station_or_operator_read on public.mystery_events
  for select to authenticated
  using (station_id = (select private.current_station_id()) or (select private.is_operator()));
create policy mystery_clue_events_station_or_operator_read on public.mystery_clue_events
  for select to authenticated
  using (station_id = (select private.current_station_id()) or (select private.is_operator()));
create policy mystery_forecasts_station_or_operator_read on public.mystery_forecasts
  for select to authenticated
  using (station_id = (select private.current_station_id()) or (select private.is_operator()));
create policy mystery_recommendations_station_or_operator_read on public.mystery_recommendations
  for select to authenticated
  using (station_id = (select private.current_station_id()) or (select private.is_operator()));

-- Receipts / audit: operators only.
grant select on table public.mystery_session_actions to authenticated;
create policy mystery_session_actions_operator_read on public.mystery_session_actions
  for select to authenticated using ((select private.is_operator()));

-- Identity sequences: no client access.
revoke all on all sequences in schema public from public, anon, authenticated;

revoke execute on function private.mystery_forbid_update() from public, anon, authenticated;
