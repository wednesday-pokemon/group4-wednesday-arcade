// POST /functions/v1/mystery-select-duo   (station account)   rules mystery-v4 (v3.1 sessions keep v3.1 rules)
// body: { sessionId, characterId, pokemonId }
// 200 -> MysterySessionEnvelope (status 'playing'); repeating the SAME choice replays (x-idempotent-replay: true).
// 422 DUO_NOT_OFFERED  the pair is not one of the session's three stored cards
// 409 ALREADY_SELECTED a different duo was already chosen (details.slot)
// 409 SESSION_CLOSED   superseded / reset / finished (details.status, details.abandonedReason)
import { actorOf, requireCaller, requireStation } from '../_shared/auth.ts';
import { adminClient, callRpc } from '../_shared/db.ts';
import { readJson, serve } from '../_shared/http.ts';
import { loadEnvelope, loadMysterySession } from '../_shared/mystery-db.ts';
import { parseMysterySelect } from '../_shared/mystery-validation.ts';

serve('mystery-select-duo', async (req, ctx) => {
  const admin = adminClient();
  const caller = await requireCaller(req, admin);
  const stationId = requireStation(caller);
  const body = parseMysterySelect(await readJson(req));
  await loadMysterySession(admin, body.sessionId, stationId); // ownership (404 for other stations)

  const out = await callRpc(admin, 'mystery_select_duo', {
    p_session_id: body.sessionId,
    p_station_id: stationId,
    p_character_id: body.characterId,
    p_pokemon_id: body.pokemonId,
    p_request: { body, actor: actorOf(caller) },
  });
  const replay = out.replay === true;
  ctx.log('info', 'mystery_duo_selected', { sessionId: body.sessionId, slot: out.slot, replay });
  const row = await loadMysterySession(admin, body.sessionId, stationId);
  return { body: await loadEnvelope(admin, row), replay };
});
