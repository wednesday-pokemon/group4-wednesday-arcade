-- mystery-v3.1 Realtime: publish ONLY the sanitized projections (live station status + verified results).
-- mystery_sessions, mystery_events, mystery_offered_duos, forecasts, recommendations and receipts are never published.
do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'mystery_station_status'
  ) then
    alter publication supabase_realtime add table public.mystery_station_status;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'mystery_results'
  ) then
    alter publication supabase_realtime add table public.mystery_results;
  end if;
end;
$$;
