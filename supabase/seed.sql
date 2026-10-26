-- Local seed (`supabase db reset` / `supabase start`). Hosted projects get the same rows from the
-- core migration because `supabase db push` does not run this file. Idempotent.
insert into public.stations (id, label) values
  ('station_a', 'Station A'),
  ('station_b', 'Station B'),
  ('station_c', 'Station C')
on conflict (id) do nothing;

insert into public.station_status (station_id, label)
select id, label from public.stations
on conflict (station_id) do nothing;

-- Auth users are NOT created here (passwords must not live in the repo).
-- Use: node supabase/scripts/provision-users.mjs   (see docs/SUPABASE_SETUP.md)
