# Browser ↔ Supabase Client Contract (from backend-architect, verified against supabase/functions/**)

Source of truth is the code in `supabase/functions/**` and `supabase/migrations/**`; this is the summary the browser
adapter (`src/lib/supabase/**`) implements. See `docs/SECURITY.md` §4 for rationale.

## Auth
* `createClient(VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY)` — never any other key in the browser.
* Station terminals and operators: `supabase.auth.signInWithPassword({ email, password })`.
* Own role: `from('app_users').select('role,station_id')` (RLS returns only the caller's row).
* Functions: `supabase.functions.invoke(name, { body })` (sends `Authorization: Bearer <access_token>` + `apikey`).
  Raw: `POST {URL}/functions/v1/<name>` with those headers + `Content-Type: application/json`. Anon key alone → 401.

## Idempotency
`actionId` = `crypto.randomUUID()` per player intent (pattern `[A-Za-z0-9_-]{8,64}`). On network error / `INTERNAL`,
resend the identical body with the same `actionId`. `expectedRevision` = `view.state.revision`.

## SessionEnvelope
`{ view: SessionView, meta: { sessionId, stationId, status, abandonedReason }, resolution?: LegResolution }`
* `view.verified === true`, `view.seedCommitment` = 64-hex SHA-256 of the seed.
* In progress: `revealedSeed: null` and `draws: null` on every leg result and on `resolution` (defence in depth).
* Ended: seed and draws revealed. `abandonedReason ∈ null | 'player_reset' | 'operator_reset' | 'superseded'`.

| Function | Caller | Body | Success |
|---|---|---|---|
| `create-session` | station | `{nickname, characterId, pokemonId, actionId, modelVersion?}` | 201 envelope (replay → 200 + header `x-idempotent-replay: true`) |
| `get-session` | station | `{}` or `{sessionId}` | 200 `{view|null, meta|null (+createdAt, completedAt, verifiedAt), station:{stationId,label,status,notice}}` |
| `prepare-leg` | station | `{sessionId, expectedRevision, route, pushLevel, actionId}` | 200 envelope |
| `resolve-leg` | station | `{sessionId, expectedRevision, eggDecision, actionId}` | 200 envelope + `resolution` |
| `finish-session` | station | `{sessionId, actionId, reason:'player_reset'}` | 200 envelope (+ `released: bool` if already ended) |
| `admin-reset` | operator | `{stationId, reason (3–200 chars), actionId}` | 200 `{stationId, abandonedSessionIds, notice:'operator_reset'}` |

## Errors
Body `{ error: { code, message, retryable, details? }, requestId }` + header `x-request-id`.
400 `MALFORMED_JSON` · 401 `UNAUTHENTICATED` · 403 `NOT_PROVISIONED` `FORBIDDEN_ROLE` `ORIGIN_NOT_ALLOWED` ·
404 `SESSION_NOT_FOUND` `STATION_NOT_FOUND` · 405 `METHOD_NOT_ALLOWED` · 409 `STALE_REVISION {currentRevision}` `WRONG_PHASE`
`SESSION_CLOSED {status, abandonedReason}` `ACTION_ID_CONFLICT` `SESSION_STILL_ACTIVE` · 413 `PAYLOAD_TOO_LARGE` ·
422 `INVALID_INPUT {field}` `ILLEGAL_STAMINA` `NO_EGG_TO_COLLECT` · 429 `RATE_LIMITED` · 500 `INVALID_TRANSITION` `MISCONFIGURED` `INTERNAL`.
On `STALE_REVISION` / `SESSION_CLOSED` → call `get-session` and re-render. `notice`/`abandonedReason === 'operator_reset'` → show "Reset by operator".

## Realtime + public reads (anon)
* `postgres_changes` on `public.station_status` (UPDATE only; filter `station_id=eq.station_a`). Columns: `station_id, label,
  session_id, nickname, character_id, pokemon_id, status, phase, leg_index, route, push_level, weather, hp, stamina, gap_m,
  catches, banked_eggs, sim_time_cs, final_score, notice, revision, updated_at`. Status includes `'idle'`.
* `postgres_changes` on `public.leaderboard_entries` (INSERT; DELETE only on operator nickname moderation). Columns:
  `session_id, nickname, station_id, character_id, pokemon_id, status, final_egg_points, total_simulated_time_cs,
  final_score, dnf_reason, dnf_leg, rules_version, verified_at`.
* Initial loads: REST `select` on views `verified_leaderboard` (adds `rank`, pre-sorted) and `defeated_log`.
* `final_score` may arrive as a string → `Number()`.
