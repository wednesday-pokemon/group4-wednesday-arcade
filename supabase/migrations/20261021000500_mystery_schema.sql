-- "The Silent Evidence" (rules mystery-v3.1) — ADDITIVE schema. Nothing in the v2.5 schema is altered or dropped:
-- the v2.5 tables (sessions, leg_results, station_status, leaderboard_entries, ...) keep serving `/?legacy=1`.
-- Re-used read-only: public.stations (station ids/labels), public.app_users (station/operator binding),
-- private.current_station_id() / private.is_operator() (RLS predicates), private.rpc_error() (RPC envelope).
--
-- Authority split (docs/SECURITY.md §7):
--   * Edge Functions (Deno, service role) compute the duo offer with the shared pure `draftOffer(seed)`, validate
--     event order with the shared case data, and recompute verdict + score with the shared scoring rules.
--   * These tables + the SECURITY DEFINER RPCs (next migrations) serialize writers, dedupe (session, seq),
--     enforce lifecycle/coherence constraints and publish exactly one immutable result per session.
-- Units: sim time `t` in seconds as double precision (the browser's exact float, so round1(t) matches the client);
-- active_time_s / score numeric 1 decimal, as in RunResult.

-- ---------------------------------------------------------------------------------------------
-- Sessions
-- ---------------------------------------------------------------------------------------------
create table public.mystery_sessions (
  id                  uuid primary key,
  station_id          text not null references public.stations (id),
  rules_version       text not null default 'mystery-v3.1'
                      constraint mystery_sessions_rules_version_check check (rules_version = 'mystery-v3.1'),
  create_action_id    text not null
                      constraint mystery_sessions_create_action_id_check check (create_action_id ~ '^[A-Za-z0-9_-]{8,64}$'),
  -- Server-issued 128-bit seed. NOT a secret in v3.1: the browser runs the deterministic sim from it.
  seed                text not null constraint mystery_sessions_seed_check check (seed ~ '^[0-9a-f]{32}$'),
  is_test             boolean not null default false, -- operator-controlled seed reuse; never ranked
  nickname            text not null
                      constraint mystery_sessions_nickname_check check (
                        char_length(nickname) between 3 and 15
                        and nickname !~ '[<>&"''`[:cntrl:]]'
                        and nickname = btrim(nickname)
                      ),
  status              text not null default 'offered'
                      constraint mystery_sessions_status_check check (status in ('offered', 'playing', 'finished', 'dnf', 'abandoned')),
  selected_slot       smallint null constraint mystery_sessions_selected_slot_check check (selected_slot between 0 and 2),
  character_id        text null constraint mystery_sessions_character_id_check check (character_id in (
                        'wednesday', 'morticia', 'enid', 'bianca', 'eugene', 'gomez', 'ajax')),
  pokemon_id          text null constraint mystery_sessions_pokemon_id_check check (pokemon_id in (
                        'gengar', 'alolan_marowak', 'misdreavus', 'galarian_corsola', 'sableye', 'dusknoir',
                        'drifblim', 'froslass', 'jellicent', 'chandelure', 'aegislash', 'trevenant',
                        'dhelmise', 'decidueye', 'dragapult', 'basculegion', 'ceruledge', 'gholdengo')),
  selected_at         timestamptz null,
  -- Event-stream projections maintained by mystery_append_events (validated progress lives in `progress`).
  last_seq            integer not null default -1 constraint mystery_sessions_last_seq_check check (last_seq >= -1),
  last_t              double precision not null default 0 constraint mystery_sessions_last_t_check check (last_t between 0 and 14400),
  event_count         integer not null default 0 constraint mystery_sessions_event_count_check check (event_count between 0 and 20000),
  clues_found         smallint not null default 0 constraint mystery_sessions_clues_check check (clues_found between 0 and 3),
  catches             smallint not null default 0 constraint mystery_sessions_catches_check check (catches between 0 and 2),
  sightings           integer not null default 0 constraint mystery_sessions_sightings_check check (sightings >= 0),
  egg_state           text not null default 'resting'
                      constraint mystery_sessions_egg_state_check check (egg_state in ('resting', 'carried', 'dropped', 'delivered')),
  terminal_type       text null constraint mystery_sessions_terminal_check check (terminal_type in ('finish', 'dnf')),
  progress            jsonb not null default '{}'::jsonb
                      constraint mystery_sessions_progress_check check (jsonb_typeof(progress) = 'object'),
  abandoned_reason    text null
                      constraint mystery_sessions_abandoned_reason_check check (abandoned_reason in ('player_reset', 'operator_reset', 'superseded')),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  finalized_at        timestamptz null,
  abandoned_at        timestamptz null,

  constraint mystery_sessions_selection_check check (
    (selected_slot is null) = (character_id is null)
    and (selected_slot is null) = (pokemon_id is null)
    and (selected_slot is null) = (selected_at is null)
  ),
  constraint mystery_sessions_offered_check check (status <> 'offered' or (selected_slot is null and last_seq = -1)),
  constraint mystery_sessions_playing_check check (status not in ('playing', 'finished', 'dnf') or selected_slot is not null),
  constraint mystery_sessions_final_check check ((status in ('finished', 'dnf')) = (finalized_at is not null)),
  constraint mystery_sessions_final_terminal_check check (
    status not in ('finished', 'dnf') or terminal_type = case status when 'finished' then 'finish' else 'dnf' end
  ),
  constraint mystery_sessions_abandoned_check check (
    (status = 'abandoned') = (abandoned_reason is not null and abandoned_at is not null)
  )
);
comment on table public.mystery_sessions is 'mystery-v3.1 sessions: server seed, lifecycle offered -> playing -> finished|dnf (or abandoned).';
comment on column public.mystery_sessions.seed is 'Server-issued draw seed. Returned to the owning station (the browser sim needs it); not a secret.';
comment on column public.mystery_sessions.progress is 'Validated MysteryProgress (rule-relevant event state) written by mystery_append_events.';

-- At most one open (offered/playing) mystery session per station; idempotent create per (station, actionId).
create unique index mystery_sessions_one_open_per_station_idx
  on public.mystery_sessions (station_id) where status in ('offered', 'playing');
create unique index mystery_sessions_create_action_idx on public.mystery_sessions (station_id, create_action_id);
create index mystery_sessions_station_created_idx on public.mystery_sessions (station_id, created_at desc);
create index mystery_sessions_status_idx on public.mystery_sessions (status);

-- ---------------------------------------------------------------------------------------------
-- The three server-computed duo cards of a session (immutable once written)
-- ---------------------------------------------------------------------------------------------
create table public.mystery_offered_duos (
  session_id   uuid not null references public.mystery_sessions (id) on delete cascade,
  station_id   text not null references public.stations (id),
  slot         smallint not null constraint mystery_offered_duos_slot_check check (slot between 0 and 2),
  character_id text not null constraint mystery_offered_duos_character_id_check check (character_id in (
                 'wednesday', 'morticia', 'enid', 'bianca', 'eugene', 'gomez', 'ajax')),
  pokemon_id   text not null constraint mystery_offered_duos_pokemon_id_check check (pokemon_id in (
                 'gengar', 'alolan_marowak', 'misdreavus', 'galarian_corsola', 'sableye', 'dusknoir',
                 'drifblim', 'froslass', 'jellicent', 'chandelure', 'aegislash', 'trevenant',
                 'dhelmise', 'decidueye', 'dragapult', 'basculegion', 'ceruledge', 'gholdengo')),
  duo_name     text not null constraint mystery_offered_duos_duo_name_check check (char_length(duo_name) between 1 and 60),
  role         text not null constraint mystery_offered_duos_role_check check (role in (
                 'investigation', 'stealth', 'mobility', 'control', 'defense', 'support')),
  rarity       text not null constraint mystery_offered_duos_rarity_check check (rarity in ('common', 'rare', 'epic')),
  stats        jsonb not null constraint mystery_offered_duos_stats_check check (
                 jsonb_typeof(stats) = 'object'
                 and stats ?& array['investigation', 'stealth', 'mobility', 'defense', 'hydeControl', 'eggProtection']
               ),
  card         jsonb not null constraint mystery_offered_duos_card_check check (
                 jsonb_typeof(card) = 'object' and card ->> 'characterId' = character_id and card ->> 'pokemonId' = pokemon_id
               ),
  created_at   timestamptz not null default now(),
  constraint mystery_offered_duos_pkey primary key (session_id, slot),
  constraint mystery_offered_duos_pair_key unique (session_id, character_id, pokemon_id)
);
comment on table public.mystery_offered_duos is 'Exactly the three DuoCards computed server-side by draftOffer(seed) at session creation.';

-- The selected duo must be one of the offered ones (composite FK on (session, slot)).
alter table public.mystery_sessions
  add constraint mystery_sessions_selected_offer_fk foreign key (id, selected_slot)
  references public.mystery_offered_duos (session_id, slot) deferrable initially deferred;

-- ---------------------------------------------------------------------------------------------
-- Gameplay event stream (append-only, deduped on (session_id, seq))
-- ---------------------------------------------------------------------------------------------
create table public.mystery_events (
  id          bigint generated always as identity primary key,
  session_id  uuid not null references public.mystery_sessions (id) on delete cascade,
  station_id  text not null references public.stations (id),
  seq         integer not null constraint mystery_events_seq_check check (seq between 0 and 10000000),
  t           double precision not null constraint mystery_events_t_check check (t between 0 and 14400),
  type        text not null constraint mystery_events_type_check check (type in (
                'noise', 'stance', 'room_enter', 'hyde_mode', 'hyde_heard', 'hyde_sighted', 'hyde_lost', 'catch',
                'clue_search_start', 'clue_found', 'egg_pickup', 'egg_drop', 'egg_damage', 'egg_delivered',
                'ability_used', 'ability_denied', 'hint_requested', 'accusation', 'finish', 'dnf')),
  payload     jsonb not null constraint mystery_events_payload_check check (
                jsonb_typeof(payload) = 'object' and not (payload ?| array['type', 't', 'seq'])
              ),
  received_at timestamptz not null default now(),
  constraint mystery_events_session_seq_key unique (session_id, seq)
);
-- Database-level backstops for the order rules the Edge Function validates:
create unique index mystery_events_one_terminal_idx on public.mystery_events (session_id) where type in ('finish', 'dnf');
create unique index mystery_events_one_accusation_idx on public.mystery_events (session_id) where type = 'accusation';
create unique index mystery_events_one_delivery_idx on public.mystery_events (session_id) where type = 'egg_delivered';
create index mystery_events_rule_idx on public.mystery_events (session_id, seq) where type in (
  'catch', 'clue_found', 'egg_pickup', 'egg_drop', 'egg_damage', 'egg_delivered', 'accusation', 'finish', 'dnf',
  'hyde_sighted', 'hint_requested');
create index mystery_events_station_idx on public.mystery_events (station_id, received_at desc);
comment on table public.mystery_events is 'StampedEvents (type + payload, t = active sim seconds, seq = per-run monotonic). Append-only.';

-- Clue discoveries (derived server-side from validated clue_found events; one row per clue per session).
create table public.mystery_clue_events (
  session_id  uuid not null references public.mystery_sessions (id) on delete cascade,
  station_id  text not null references public.stations (id),
  clue_id     text not null constraint mystery_clue_events_clue_id_check check (clue_id in ('transfer_note', 'master_key', 'greenhouse_trace')),
  found_order smallint not null constraint mystery_clue_events_order_check check (found_order between 1 and 3),
  seq         integer not null,
  t           double precision not null constraint mystery_clue_events_t_check check (t between 0 and 14400),
  created_at  timestamptz not null default now(),
  constraint mystery_clue_events_pkey primary key (session_id, clue_id),
  constraint mystery_clue_events_order_key unique (session_id, found_order),
  constraint mystery_clue_events_event_fk foreign key (session_id, seq) references public.mystery_events (session_id, seq)
);

-- Predictive analytics: what was predicted AT TIME OF ISSUE (never back-filled).
create table public.mystery_forecasts (
  session_id    uuid not null references public.mystery_sessions (id) on delete cascade,
  station_id    text not null references public.stations (id),
  forecast_no   integer not null constraint mystery_forecasts_no_check check (forecast_no between 0 and 100000),
  t             double precision not null constraint mystery_forecasts_t_check check (t between 0 and 14400),
  target        text not null constraint mystery_forecasts_target_check check (target in ('detection_15s', 'extraction', 'eta_s')),
  value         numeric(12, 4) not null,
  model_label   text not null constraint mystery_forecasts_model_label_check check (model_label in ('ml', 'rule_based')),
  model_version text null constraint mystery_forecasts_model_version_check check (model_version ~ '^[A-Za-z0-9._-]{1,32}$'),
  features      jsonb not null constraint mystery_forecasts_features_check check (jsonb_typeof(features) = 'object'),
  created_at    timestamptz not null default now(),
  constraint mystery_forecasts_pkey primary key (session_id, forecast_no),
  constraint mystery_forecasts_probability_check check (target = 'eta_s' or value between 0 and 1)
);

-- Prescriptive analytics: advice given, whether the player followed it, and what happened next.
create table public.mystery_recommendations (
  session_id  uuid not null references public.mystery_sessions (id) on delete cascade,
  station_id  text not null references public.stations (id),
  rec_no      integer not null constraint mystery_recommendations_no_check check (rec_no between 0 and 100000),
  t           double precision not null constraint mystery_recommendations_t_check check (t between 0 and 14400),
  action      text not null constraint mystery_recommendations_action_check check (action ~ '^[a-z][a-z0-9_]{0,39}$'),
  advice      text not null constraint mystery_recommendations_advice_check check (
                char_length(advice) between 1 and 240 and advice !~ '[<>[:cntrl:]]'),
  trigger     text not null default 'hint' constraint mystery_recommendations_trigger_check check (trigger in ('hint', 'context')),
  accepted    boolean null,
  outcome     text null constraint mystery_recommendations_outcome_check check (outcome ~ '^[a-z][a-z0-9_]{0,31}$'),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint mystery_recommendations_pkey primary key (session_id, rec_no)
);

-- ---------------------------------------------------------------------------------------------
-- Results: exactly one immutable, server-recomputed row per finalized session
-- ---------------------------------------------------------------------------------------------
create table public.mystery_results (
  session_id    uuid primary key references public.mystery_sessions (id) on delete cascade,
  station_id    text not null references public.stations (id),
  nickname      text not null,
  character_id  text not null,
  pokemon_id    text not null,
  rules_version text not null constraint mystery_results_rules_version_check check (rules_version = 'mystery-v3.1'),
  outcome       text not null constraint mystery_results_outcome_check check (outcome in ('finished', 'dnf')),
  dnf_reason    text null constraint mystery_results_dnf_reason_check check (dnf_reason in ('second_catch', 'hp_depleted')),
  verdict       text not null constraint mystery_results_verdict_check check (verdict in ('case_solved', 'egg_secured_mystery_unsolved', 'not_accused')),
  accused       text null constraint mystery_results_accused_check check (accused in ('thornhill', 'isaac', 'barry')),
  correct       boolean not null,
  clues_found   text[] not null constraint mystery_results_clues_check check (
                  clues_found <@ array['transfer_note', 'master_key', 'greenhouse_trace']::text[] and cardinality(clues_found) <= 3),
  clue_count    smallint generated always as (cardinality(clues_found)) stored,
  egg_tier      text null constraint mystery_results_egg_tier_check check (egg_tier in ('common', 'rare', 'legendary')),
  egg_points    integer not null constraint mystery_results_egg_points_check check (egg_points in (0, 1, 3, 6)),
  egg_security  numeric(5, 1) not null constraint mystery_results_egg_security_check check (egg_security between 0 and 100),
  active_time_s numeric(8, 1) not null constraint mystery_results_time_check check (active_time_s between 0 and 14400),
  score         numeric(9, 1) null,
  catches       smallint not null constraint mystery_results_catches_check check (catches between 0 and 2),
  sightings     integer not null default 0 constraint mystery_results_sightings_check check (sightings >= 0),
  hints_used    integer not null default 0 constraint mystery_results_hints_check check (hints_used >= 0),
  client_claim  jsonb null constraint mystery_results_client_claim_check check (client_claim is null or jsonb_typeof(client_claim) = 'object'),
  claim_matches boolean null,
  is_test       boolean not null default false,
  finalized_at  timestamptz not null,

  constraint mystery_results_finished_check check (
    outcome <> 'finished' or (
      score is not null and dnf_reason is null and egg_tier is not null and egg_points > 0
      and (accused is null) = (verdict = 'not_accused')       -- accuse(null) = "leave the case unsolved"
      and score = egg_points * 100 - active_time_s            -- the v3.1 formula, exact on 1-dp numerics
    )
  ),
  constraint mystery_results_dnf_check check (
    outcome <> 'dnf' or (score is null and dnf_reason is not null and verdict = 'not_accused' and accused is null and egg_points = 0)
  ),
  constraint mystery_results_solved_check check (verdict <> 'case_solved' or (correct and cardinality(clues_found) = 3)),
  constraint mystery_results_correct_check check (accused is not null or not correct)
);
comment on table public.mystery_results is 'Server-recomputed RunResult per finalized mystery session. Written once by mystery_finalize_session; immutable.';
create index mystery_results_ranked_idx on public.mystery_results (outcome, score desc, active_time_s asc, finalized_at asc, session_id asc);
create index mystery_results_station_idx on public.mystery_results (station_id, finalized_at desc);

-- ---------------------------------------------------------------------------------------------
-- Receipts / audit (create, select, finalize, abandon)
-- ---------------------------------------------------------------------------------------------
create table public.mystery_session_actions (
  id            bigint generated always as identity primary key,
  session_id    uuid not null references public.mystery_sessions (id) on delete cascade,
  action_id     text not null constraint mystery_session_actions_action_id_check check (action_id ~ '^[A-Za-z0-9_-]{8,80}$'),
  action_type   text not null constraint mystery_session_actions_type_check check (action_type in ('create', 'select', 'finalize', 'abandon')),
  actor_user_id uuid null,
  request       jsonb not null constraint mystery_session_actions_request_check check (jsonb_typeof(request) = 'object'),
  created_at    timestamptz not null default now(),
  constraint mystery_session_actions_session_action_key unique (session_id, action_id)
);
create index mystery_session_actions_created_idx on public.mystery_session_actions (created_at desc);

-- ---------------------------------------------------------------------------------------------
-- Public, sanitized live projection of each terminal for the mystery game (Realtime-published)
-- ---------------------------------------------------------------------------------------------
create table public.mystery_station_status (
  station_id    text primary key references public.stations (id),
  label         text not null,
  session_id    uuid null references public.mystery_sessions (id) on delete set null,
  nickname      text null,
  character_id  text null,
  pokemon_id    text null,
  status        text not null default 'idle'
                constraint mystery_station_status_status_check check (status in ('idle', 'offered', 'playing', 'finished', 'dnf')),
  clues_found   smallint null constraint mystery_station_status_clues_check check (clues_found between 0 and 3),
  catches       smallint null constraint mystery_station_status_catches_check check (catches between 0 and 2),
  sightings     integer null constraint mystery_station_status_sightings_check check (sightings >= 0),
  egg_state     text null constraint mystery_station_status_egg_check check (egg_state in ('resting', 'carried', 'dropped', 'delivered')),
  active_time_s numeric(8, 1) null,
  verdict       text null constraint mystery_station_status_verdict_check check (verdict in ('case_solved', 'egg_secured_mystery_unsolved', 'not_accused')),
  score         numeric(9, 1) null,
  is_test       boolean not null default false,
  notice        text null constraint mystery_station_status_notice_check check (notice in ('operator_reset', 'player_reset', 'superseded')),
  revision      integer not null default 0,
  updated_at    timestamptz not null default now(),
  constraint mystery_station_status_idle_check check ((status = 'idle') = (session_id is null))
);
comment on table public.mystery_station_status is 'Public live view of each terminal for mystery-v3.1. No seeds, offers or raw events.';

insert into public.mystery_station_status (station_id, label)
select id, label from public.stations
on conflict (station_id) do nothing;

-- ---------------------------------------------------------------------------------------------
-- Immutability (append-only history; deletes stay possible for the owner, e.g. moderation)
-- ---------------------------------------------------------------------------------------------
create function private.mystery_forbid_update() returns trigger
language plpgsql set search_path = '' as $$
begin
  raise exception '% rows are immutable', tg_table_name using errcode = '42501';
end;
$$;
create trigger mystery_results_immutable before update on public.mystery_results
  for each row execute function private.mystery_forbid_update();
create trigger mystery_events_immutable before update on public.mystery_events
  for each row execute function private.mystery_forbid_update();
create trigger mystery_offered_duos_immutable before update on public.mystery_offered_duos
  for each row execute function private.mystery_forbid_update();
create trigger mystery_clue_events_immutable before update on public.mystery_clue_events
  for each row execute function private.mystery_forbid_update();
create trigger mystery_forecasts_immutable before update on public.mystery_forecasts
  for each row execute function private.mystery_forbid_update();

-- ---------------------------------------------------------------------------------------------
-- Leaderboard views (rules_version partition; test sessions never ranked)
-- ---------------------------------------------------------------------------------------------
-- Ranked board: finishers only, score desc, then active time asc, then who finalized first.
create view public.mystery_leaderboard with (security_invoker = true) as
select
  rank() over (order by r.score desc, r.active_time_s asc, r.finalized_at asc)::integer as rank,
  r.session_id, r.nickname, r.station_id, r.character_id, r.pokemon_id, r.score, r.active_time_s,
  r.egg_tier, r.egg_points, r.egg_security, r.verdict, r.correct, r.accused, r.clue_count, r.catches,
  r.finalized_at, r.rules_version
from public.mystery_results r
where r.outcome = 'finished' and r.rules_version = 'mystery-v3.1' and not r.is_test
order by r.score desc, r.active_time_s asc, r.finalized_at asc, r.session_id asc;

-- DNFs: unranked log.
create view public.mystery_defeated with (security_invoker = true) as
select
  r.session_id, r.nickname, r.station_id, r.character_id, r.pokemon_id, r.dnf_reason, r.active_time_s,
  r.clue_count, r.catches, r.finalized_at, r.rules_version
from public.mystery_results r
where r.outcome = 'dnf' and r.rules_version = 'mystery-v3.1' and not r.is_test
order by r.finalized_at desc, r.session_id asc;

-- Combined standings: EVERY finisher (even with a negative score) above every DNF. DNFs have rank null and are listed
-- longest-survival first — the same order as the shared compareResults() in src/mystery/scoring.ts.
create view public.mystery_standings with (security_invoker = true) as
select
  case when r.outcome = 'finished' then 0 else 1 end as standing_group,
  case when r.outcome = 'finished'
       then rank() over (partition by r.outcome = 'finished' order by r.score desc, r.active_time_s asc, r.finalized_at asc)::integer
  end as rank,
  r.session_id, r.nickname, r.station_id, r.character_id, r.pokemon_id, r.outcome, r.dnf_reason, r.score,
  r.active_time_s, r.verdict, r.correct, r.clue_count, r.catches, r.finalized_at, r.rules_version
from public.mystery_results r
where r.rules_version = 'mystery-v3.1' and not r.is_test
order by standing_group asc, r.score desc nulls last,
  case when r.outcome = 'finished' then r.active_time_s end asc,
  case when r.outcome = 'dnf' then r.active_time_s end desc,
  r.finalized_at asc, r.session_id asc;
