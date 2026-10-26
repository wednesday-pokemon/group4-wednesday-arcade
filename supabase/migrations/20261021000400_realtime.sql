-- Realtime: publish ONLY the sanitized projections. sessions, session_secrets, leg_results,
-- session_actions and operator_audit must never be added to this publication.
do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'station_status'
  ) then
    alter publication supabase_realtime add table public.station_status;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'leaderboard_entries'
  ) then
    alter publication supabase_realtime add table public.leaderboard_entries;
  end if;
end;
$$;
