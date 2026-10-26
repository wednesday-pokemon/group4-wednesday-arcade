-- Third player station (2026-10-27): station_c joins station_a / station_b (3 players + 1 spectator dashboard).
-- ADDITIVE: the stations CHECK becomes a strict superset, one reference row + its two status rows are added. Every
-- table that names a station references public.stations (FK), so nothing else changes. Safe to re-run.
-- After `db push`: provision the Station C login (docs/SUPABASE_SETUP.md, supabase/scripts/provision-users.mjs).

alter table public.stations
  drop constraint if exists stations_id_check,
  add constraint stations_id_check check (id in ('station_a', 'station_b', 'station_c'));
comment on table public.stations is 'The physical player terminals (A, B, C). active_session_id = in-progress session or null.';

insert into public.stations (id, label) values ('station_c', 'Station C') on conflict (id) do nothing;

insert into public.station_status (station_id, label)
select id, label from public.stations where id = 'station_c'
on conflict (station_id) do nothing;

insert into public.mystery_station_status (station_id, label)
select id, label from public.stations where id = 'station_c'
on conflict (station_id) do nothing;
