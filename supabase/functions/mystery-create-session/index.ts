// POST /functions/v1/mystery-create-session   (station account)   rules mystery-v3.1
// body: { actionId, nickname, testSeed? }
//   actionId  8-64 [A-Za-z0-9_-]; generate ONCE per new visitor and persist it with the session in localStorage, so a
//             refresh/retry before the response arrived replays the same session instead of drawing a new offer.
//   testSeed  32 hex; only accepted when the MYSTERY_ALLOW_TEST_SEEDS secret is "true" (operator test; session is_test,
//             never ranked). Otherwise 403 TEST_SEED_FORBIDDEN.
// 201 -> MysterySessionEnvelope { session, offer, result: null }   (new session; open session on this station superseded)
// 200 + x-idempotent-replay -> CURRENT envelope of the session created by this actionId (offer unchanged; may already
//       have a selected duo / events / a result)
// The server issues the seed (crypto.getRandomValues) and computes + stores the three cards with the shared pure
// draftOffer, so the browser can neither choose its seed nor forge cards.
import { actorOf, requireCaller, requireStation } from '../_shared/auth.ts';
import { generateSeed } from '../_shared/crypto.ts';
import { adminClient, callRpc } from '../_shared/db.ts';
import { readJson, serve } from '../_shared/http.ts';
import { loadEnvelope, loadMysterySession } from '../_shared/mystery-db.ts';
import { computeOffer, requireData } from '../_shared/mystery-rules.ts';
import { parseMysteryCreate } from '../_shared/mystery-validation.ts';

serve('mystery-create-session', async (req, ctx) => {
  const admin = adminClient();
  const caller = await requireCaller(req, admin);
  const stationId = requireStation(caller);
  const body = parseMysteryCreate(await readJson(req), Deno.env.get('MYSTERY_ALLOW_TEST_SEEDS') === 'true');
  requireData();

  const seed = body.testSeed ?? generateSeed();
  const sessionId = crypto.randomUUID();
  const offer = computeOffer(seed);

  const out = await callRpc(admin, 'mystery_create_session', {
    p_session_id: sessionId,
    p_station_id: stationId,
    p_action_id: body.actionId,
    p_seed: seed,
    p_nickname: body.nickname,
    p_offer: offer,
    p_is_test: body.testSeed !== undefined,
    p_request: { body, actor: actorOf(caller) },
  });
  const replay = out.replay === true;
  const row = await loadMysterySession(admin, String(out.sessionId), stationId);
  ctx.log('info', 'mystery_session_created', {
    sessionId: row.id, stationId, replay, isTest: row.is_test, superseded: out.supersededSessionIds ?? [],
  });
  return { status: replay ? 200 : 201, body: await loadEnvelope(admin, row), replay };
});
