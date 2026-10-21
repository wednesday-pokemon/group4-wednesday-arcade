-- Escape from Raven Island: The Hyde's Regatta — core schema (rules v2.5)
-- All writes happen through Edge Functions (service role) calling SECURITY DEFINER RPCs.
-- Game math NEVER lives in SQL: columns below are projections of the engine's GameState / LegResolution.
-- Units: simulated time in integer centiseconds (*_cs); scores numeric(10,2).

create schema if not exists private;
comment on schema private is 'Internal helpers (RLS predicates). Not exposed through the Data API.';

-- ---------------------------------------------------------------------------------------------
-- Reference data
-- ---------------------------------------------------------------------------------------------
create table public.stations (
  id                text primary key
                    constraint stations_id_check check (id in ('station_a', 'station_b')),
  label             text not null
                    constraint stations_label_check check (char_length(label) between 1 and 40),
  active_session_id uuid null,               -- FK added after public.sessions exists
  created_at        timestamptz not null default now()
);
comment on table public.stations is 'The two physical race terminals. active_session_id = in-progress session or null.';

-- Operator-provisioned identities. One row per Supabase Auth user that may use the system.
create table public.app_users (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  role       text not null constraint app_users_role_check check (role in ('station', 'operator')),
  station_id text null references public.stations (id),
  created_at timestamptz not null default now(),
  constraint app_users_station_binding_check check (
    (role = 'station' and station_id is not null) or (role = 'operator' and station_id is null)
  )
);
create index app_users_station_id_idx on public.app_users (station_id);
comment on table public.app_users is 'Role binding for Auth users. Unlisted Auth users have no capabilities.';

-- ---------------------------------------------------------------------------------------------
-- Authoritative sessions
-- ---------------------------------------------------------------------------------------------
create table public.sessions (
  id                      uuid primary key,
  station_id              text not null references public.stations (id),
  create_action_id        text not null
                          constraint sessions_create_action_id_check check (create_action_id ~ '^[A-Za-z0-9_-]{8,64}$'),
  nickname                text not null
                          constraint sessions_nickname_check check (
                            char_length(nickname) between 3 and 15
                            and nickname !~ '[<>&"''`[:cntrl:]]'
                            and nickname = btrim(nickname)
                          ),
  character_id            text not null constraint sessions_character_id_check check (character_id in (
                            'wednesday', 'enid', 'bianca', 'xavier', 'ajax', 'yoko',
                            'kent', 'divina', 'rowan', 'eugene', 'morticia', 'gomez')),
  pokemon_id              text not null constraint sessions_pokemon_id_check check (pokemon_id in (
                            'gengar', 'alolan_marowak', 'misdreavus', 'galarian_corsola', 'sableye', 'dusknoir',
                            'drifblim', 'froslass', 'jellicent', 'chandelure', 'aegislash', 'trevenant',
                            'dhelmise', 'decidueye', 'dragapult', 'basculegion', 'ceruledge', 'gholdengo')),
  status                  text not null
                          constraint sessions_status_check check (status in ('in_progress', 'completed', 'dnf', 'abandoned')),
  phase                   text not null
                          constraint sessions_phase_check check (phase in ('awaiting_route', 'awaiting_egg', 'complete')),
  leg_index               smallint not null constraint sessions_leg_index_check check (leg_index between 1 and 3),
  revision                integer not null constraint sessions_revision_check check (revision >= 0),
  hp                      smallint not null constraint sessions_hp_check check (hp between 0 and 100),
  stamina                 smallint not null constraint sessions_stamina_check check (stamina between 0 and 7),
  gap_m                   integer not null constraint sessions_gap_check check (gap_m between -1000 and 1000),
  hyde_catch_count        smallint not null constraint sessions_catch_check check (hyde_catch_count between 0 and 2),
  banked_egg_points       integer not null constraint sessions_banked_check check (banked_egg_points between 0 and 1000),
  unbanked_egg_points     integer not null constraint sessions_unbanked_check check (unbanked_egg_points between 0 and 1000),
  total_simulated_time_cs integer not null constraint sessions_time_check check (total_simulated_time_cs between 0 and 10000000),
  final_egg_points        integer null constraint sessions_final_eggs_check check (final_egg_points between 0 and 1000),
  final_score             numeric(10, 2) null,
  dnf_reason              text null constraint sessions_dnf_reason_check check (dnf_reason in ('second_catch', 'hp_depleted')),
  flags                   jsonb not null constraint sessions_flags_check check (jsonb_typeof(flags) = 'object'),
  prepared                jsonb null constraint sessions_prepared_check check (prepared is null or jsonb_typeof(prepared) = 'object'),
  state                   jsonb not null constraint sessions_state_check check (jsonb_typeof(state) = 'object'),
  rules_version           text not null constraint sessions_rules_version_check check (rules_version ~ '^v[0-9]+\.[0-9]+$'),
  model_version           text null constraint sessions_model_version_check check (model_version ~ '^[A-Za-z0-9._-]{1,32}$'),
  seed_commitment         text not null constraint sessions_seed_commitment_check check (seed_commitment ~ '^[0-9a-f]{64}$'),
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  completed_at            timestamptz null,
  verified_at             timestamptz null,
  abandoned_at            timestamptz null,
  abandoned_reason        text null
                          constraint sessions_abandoned_reason_check check (abandoned_reason in ('player_reset', 'operator_reset', 'superseded')),

  -- lifecycle coherence (defence in depth against a buggy writer)
  constraint sessions_phase_status_check check ((status = 'in_progress') = (phase <> 'complete')),
  constraint sessions_prepared_phase_check check (status <> 'in_progress' or phase <> 'awaiting_egg' or prepared is not null),
  constraint sessions_completed_check check (
    status <> 'completed'
    or (final_score is not null and final_egg_points is not null and completed_at is not null and verified_at is not null)
  ),
  constraint sessions_dnf_check check (
    status <> 'dnf' or (dnf_reason is not null and final_score = 0 and completed_at is not null and verified_at is not null)
  ),
  constraint sessions_abandoned_check check ((status = 'abandoned') = (abandoned_reason is not null and abandoned_at is not null)),
  constraint sessions_in_progress_score_check check (status <> 'in_progress' or (final_score is null and completed_at is null))
);
comment on table public.sessions is 'Authoritative race sessions. Column `state` holds the full engine GameState snapshot (service role only).';
comment on column public.sessions.state is 'Full GameState incl. per-leg draws; never granted to anon/authenticated.';

-- At most one in-progress session per station, enforced by the database itself.
create unique index sessions_one_active_per_station_idx on public.sessions (station_id) where status = 'in_progress';
create unique index sessions_create_action_idx on public.sessions (station_id, create_action_id);
create index sessions_station_created_idx on public.sessions (station_id, created_at desc);
create index sessions_status_idx on public.sessions (status);

alter table public.stations
  add constraint stations_active_session_fk foreign key (active_session_id) references public.sessions (id) on delete set null;

-- Secret seed: separate table, RLS enabled with NO policies; only the service role / definer RPCs touch it.
create table public.session_secrets (
  session_id uuid primary key references public.sessions (id) on delete cascade,
  seed       text not null constraint session_secrets_seed_check check (seed ~ '^[0-9a-f]{32}$'),
  created_at timestamptz not null default now()
);
comment on table public.session_secrets is '128-bit hex seed per session. Never exposed; revealed only through Edge Function responses after the session ends.';

-- One row per resolved leg (append-only).
create table public.leg_results (
  id             bigint generated always as identity primary key,
  session_id     uuid not null references public.sessions (id) on delete cascade,
  station_id     text not null references public.stations (id),
  leg_index      smallint not null constraint leg_results_leg_index_check check (leg_index between 1 and 3),
  route          text not null constraint leg_results_route_check check (route in ('safe', 'shortcut')),
  push_level     smallint not null constraint leg_results_push_check check (push_level between 1 and 3),
  weather        text not null constraint leg_results_weather_check check (weather in ('clear', 'strong_currents', 'heavy_fog')),
  egg_offer      text not null constraint leg_results_egg_offer_check check (egg_offer in ('none', 'common', 'rare', 'legendary')),
  egg_decision   text not null constraint leg_results_egg_decision_check check (egg_decision in ('collect', 'skip')),
  crash          boolean not null,
  hyde_catch     boolean not null,
  outcome        text not null constraint leg_results_outcome_check check (outcome in ('survived', 'finished', 'dnf')),
  leg_time_cs    integer not null constraint leg_results_time_check check (leg_time_cs between 1000 and 1000000),
  time_breakdown jsonb not null constraint leg_results_breakdown_check check (jsonb_typeof(time_breakdown) = 'object'),
  resolution     jsonb not null constraint leg_results_resolution_check check (jsonb_typeof(resolution) = 'object' and not (resolution ? 'draws')),
  draws          jsonb not null constraint leg_results_draws_check check (jsonb_typeof(draws) = 'object'),
  created_at     timestamptz not null default now(),
  constraint leg_results_session_leg_key unique (session_id, leg_index)
);
create index leg_results_station_idx on public.leg_results (station_id, created_at desc);
comment on column public.leg_results.resolution is 'LegResolution without `draws` (draws are stored separately, service role only).';
comment on column public.leg_results.draws is 'Raw uniform draws. Service role only: revealing them mid-race leaks the RNG state (see docs/SECURITY.md T-06b).';

-- Idempotency receipts + audit trail for every state transition.
create table public.session_actions (
  id              bigint generated always as identity primary key,
  session_id      uuid not null references public.sessions (id) on delete cascade,
  action_id       text not null constraint session_actions_action_id_check check (action_id ~ '^[A-Za-z0-9_-]{8,64}$'),
  action_type     text not null constraint session_actions_type_check check (action_type in ('create', 'prepare', 'resolve', 'abandon')),
  actor_user_id   uuid null,
  revision_before integer null,
  revision_after  integer not null,
  request         jsonb not null constraint session_actions_request_check check (jsonb_typeof(request) = 'object'),
  response        jsonb not null constraint session_actions_response_check check (jsonb_typeof(response) = 'object'),
  created_at      timestamptz not null default now(),
  constraint session_actions_session_action_key unique (session_id, action_id)
);
create index session_actions_created_idx on public.session_actions (created_at desc);
create index session_actions_actor_idx on public.session_actions (actor_user_id);

-- Operator interventions that are not tied to a single transition (e.g. clearing a station display).
create table public.operator_audit (
  id            bigint generated always as identity primary key,
  actor_user_id uuid not null,
  station_id    text not null references public.stations (id),
  action        text not null constraint operator_audit_action_check check (action in ('station_reset')),
  session_ids   uuid[] not null default '{}',
  note          text null constraint operator_audit_note_check check (char_length(note) <= 200),
  created_at    timestamptz not null default now()
);
create index operator_audit_station_idx on public.operator_audit (station_id, created_at desc);

-- ---------------------------------------------------------------------------------------------
-- Sanitized public projections (Realtime-published)
-- ---------------------------------------------------------------------------------------------
create table public.station_status (
  station_id      text primary key references public.stations (id),
  label           text not null,
  session_id      uuid null references public.sessions (id) on delete set null,
  nickname        text null,
  character_id    text null,
  pokemon_id      text null,
  status          text not null default 'idle'
                  constraint station_status_status_check check (status in ('idle', 'in_progress', 'completed', 'dnf')),
  phase           text null constraint station_status_phase_check check (phase in ('awaiting_route', 'awaiting_egg', 'complete')),
  leg_index       smallint null constraint station_status_leg_check check (leg_index between 1 and 3),
  route           text null constraint station_status_route_check check (route in ('safe', 'shortcut')),
  push_level      smallint null constraint station_status_push_check check (push_level between 1 and 3),
  weather         text null constraint station_status_weather_check check (weather in ('clear', 'strong_currents', 'heavy_fog')),
  hp              smallint null constraint station_status_hp_check check (hp between 0 and 100),
  stamina         smallint null constraint station_status_stamina_check check (stamina between 0 and 7),
  gap_m           integer null,
  catches         smallint null constraint station_status_catches_check check (catches between 0 and 2),
  banked_eggs     integer null constraint station_status_banked_check check (banked_eggs >= 0),
  sim_time_cs     integer null constraint station_status_time_check check (sim_time_cs >= 0),
  final_score     numeric(10, 2) null,
  notice          text null constraint station_status_notice_check check (notice in ('operator_reset', 'player_reset', 'superseded')),
  revision        integer not null default 0,
  updated_at      timestamptz not null default now(),
  constraint station_status_idle_check check ((status = 'idle') = (session_id is null))
);
comment on table public.station_status is 'Public, sanitized live view of each terminal. Realtime-published. No seeds, offers or draws.';

create table public.leaderboard_entries (
  session_id              uuid primary key references public.sessions (id) on delete cascade,
  nickname                text not null,
  station_id              text not null references public.stations (id),
  character_id            text not null,
  pokemon_id              text not null,
  status                  text not null constraint leaderboard_status_check check (status in ('completed', 'dnf')),
  final_egg_points        integer not null constraint leaderboard_eggs_check check (final_egg_points >= 0),
  total_simulated_time_cs integer not null constraint leaderboard_time_check check (total_simulated_time_cs >= 0),
  final_score             numeric(10, 2) not null,
  dnf_reason              text null constraint leaderboard_dnf_reason_check check (dnf_reason in ('second_catch', 'hp_depleted')),
  dnf_leg                 smallint null constraint leaderboard_dnf_leg_check check (dnf_leg between 1 and 3),
  rules_version           text not null,
  verified_at             timestamptz not null,
  constraint leaderboard_dnf_coherence_check check (
    (status = 'dnf') = (dnf_reason is not null) and (status <> 'dnf' or final_score = 0)
  )
);
create index leaderboard_ranked_idx on public.leaderboard_entries
  (status, final_score desc, final_egg_points desc, total_simulated_time_cs asc, verified_at asc, session_id asc);
comment on table public.leaderboard_entries is 'Server-verified results, written exactly once per session by commit_session_transition.';

-- Published results are immutable (a second publication or a later edit is impossible).
create function private.forbid_leaderboard_update() returns trigger
language plpgsql set search_path = '' as $$
begin
  raise exception 'leaderboard entries are immutable' using errcode = '42501';
end;
$$;
create trigger leaderboard_entries_immutable
  before update on public.leaderboard_entries
  for each row execute function private.forbid_leaderboard_update();

-- Ranked board (completed only). rank() ties only on identical score/eggs/time/verification instant.
create view public.verified_leaderboard with (security_invoker = true) as
select
  rank() over (
    order by e.final_score desc, e.final_egg_points desc, e.total_simulated_time_cs asc, e.verified_at asc
  )::integer as rank,
  e.session_id, e.nickname, e.station_id, e.character_id, e.pokemon_id,
  e.final_egg_points, e.total_simulated_time_cs, e.final_score, e.verified_at, e.rules_version
from public.leaderboard_entries e
where e.status = 'completed'
order by e.final_score desc, e.final_egg_points desc, e.total_simulated_time_cs asc, e.verified_at asc, e.session_id asc;

create view public.defeated_log with (security_invoker = true) as
select
  e.session_id, e.nickname, e.station_id, e.character_id, e.pokemon_id,
  e.dnf_reason, e.dnf_leg, e.total_simulated_time_cs, e.verified_at, e.rules_version
from public.leaderboard_entries e
where e.status = 'dnf'
order by e.verified_at desc, e.session_id asc;

-- Reference rows (also in seed.sql for local resets; `db push` does not run seed.sql).
insert into public.stations (id, label) values
  ('station_a', 'Station A'),
  ('station_b', 'Station B')
on conflict (id) do nothing;

insert into public.station_status (station_id, label)
select id, label from public.stations
on conflict (station_id) do nothing;
