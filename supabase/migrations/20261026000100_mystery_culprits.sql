-- Randomized murderer (2026-10-26, docs/MYSTERY_CASES.md "Randomized murderer"): every session's murderer is drawn
-- once, server-side, from thornhill / galpin / barry (any suspect in any case: 9 case × murderer scenarios). ADDITIVE:
-- one new table + one RPC; nothing existing is changed. Safe to re-run.
--
--   * public.mystery_session_secrets: one row per session, the drawn murderer. RLS on, NO client grant or policy at all
--     (unlike mystery_sessions, which a station JWT may read): only the service role (Edge Functions) sees it. Rows go
--     with their session (on delete cascade).
--   * mystery_assign_culprit(session, culprit): idempotent. The first call stores the Edge Function's crypto-random draw;
--     every later call (refresh / replay / lost response) returns the STORED murderer, so nothing can reroll it.
-- The murderer leaves the server only after finalize (the reveal); the culprit's clue texts only for FOUND clues.

create table if not exists public.mystery_session_secrets (
  session_id uuid primary key references public.mystery_sessions (id) on delete cascade,
  culprit_id text not null check (culprit_id in ('thornhill', 'galpin', 'barry')),
  created_at timestamptz not null default now()
);

alter table public.mystery_session_secrets enable row level security;
revoke all on table public.mystery_session_secrets from public, anon, authenticated;
grant all on table public.mystery_session_secrets to service_role;

create or replace function public.mystery_assign_culprit(p_session_id uuid, p_culprit text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_culprit text;
begin
  if p_session_id is null or p_culprit is null or p_culprit not in ('thornhill', 'galpin', 'barry') then
    return private.rpc_error('INVALID_INPUT', 'unknown culprit');
  end if;
  if not exists (select 1 from public.mystery_sessions s where s.id = p_session_id) then
    return private.rpc_error('SESSION_NOT_FOUND', 'session not found');
  end if;
  insert into public.mystery_session_secrets (session_id, culprit_id) values (p_session_id, p_culprit)
  on conflict (session_id) do nothing;
  select x.culprit_id into v_culprit from public.mystery_session_secrets x where x.session_id = p_session_id;
  return jsonb_build_object('ok', true, 'culprit', v_culprit);
end;
$$;

revoke execute on function public.mystery_assign_culprit(uuid, text) from public, anon, authenticated;
grant execute on function public.mystery_assign_culprit(uuid, text) to service_role;
