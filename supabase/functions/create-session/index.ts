// POST /functions/v1/create-session   (station account)
// body: { nickname, characterId, pokemonId, actionId, modelVersion? }
// 201 -> SessionEnvelope (new)   200 + x-idempotent-replay -> original SessionEnvelope (same actionId)
// Any in-progress session on this station is abandoned ('superseded') in the same transaction.
import { buildSessionView, createInitialState } from '../_shared/game/index.ts';
import { actorOf, requireCaller, requireStation } from '../_shared/auth.ts';
import { generateSeed, sha256Hex } from '../_shared/crypto.ts';
import { adminClient, callRpc } from '../_shared/db.ts';
import { readJson, serve } from '../_shared/http.ts';
import { redactView } from '../_shared/redact.ts';
import type { SessionEnvelope } from '../_shared/session-flow.ts';
import { parseCreateSession } from '../_shared/validation.ts';

serve('create-session', async (req, ctx) => {
  const admin = adminClient();
  const caller = await requireCaller(req, admin);
  const stationId = requireStation(caller);
  const body = parseCreateSession(await readJson(req));

  const sessionId = crypto.randomUUID();
  const state = createInitialState({
    sessionId, nickname: body.nickname, characterId: body.characterId, pokemonId: body.pokemonId,
  });
  const seed = generateSeed();
  const seedCommitment = await sha256Hex(seed);
  const response: SessionEnvelope = {
    view: redactView(buildSessionView(state, seed, true, seedCommitment)), // seed hidden while in progress
    meta: { sessionId, stationId, status: state.status, abandonedReason: null },
  };

  const out = await callRpc(admin, 'create_session_atomic', {
    p_session_id: sessionId,
    p_station_id: stationId,
    p_action_id: body.actionId,
    p_seed: seed,
    p_seed_commitment: seedCommitment,
    p_state: state,
    p_request: { body, actor: actorOf(caller) },
    p_response: response,
    p_model_version: body.modelVersion ?? null,
  });
  const replay = out.replay === true;
  ctx.log('info', 'session_created', {
    sessionId: out.sessionId, stationId, replay, superseded: out.supersededSessionIds ?? [],
  });
  return { status: replay ? 200 : 201, body: out.response, replay };
});
