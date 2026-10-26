// POST /functions/v1/prepare-leg   (station account)
// body: { sessionId, expectedRevision, route, pushLevel, actionId }
// 200 -> SessionEnvelope (phase awaiting_egg; leg.visibleOffers now shows the selected route's egg)
// Same actionId again -> stored response (x-idempotent-replay: true).
import { prepareWithSeed } from '../_shared/game/index.ts';
import { requireCaller, requireStation } from '../_shared/auth.ts';
import { adminClient } from '../_shared/db.ts';
import { readJson, serve } from '../_shared/http.ts';
import { runTransition } from '../_shared/session-flow.ts';
import { parsePrepareLeg } from '../_shared/validation.ts';

serve('prepare-leg', async (req, ctx) => {
  const admin = adminClient();
  const caller = await requireCaller(req, admin);
  const stationId = requireStation(caller);
  const body = parsePrepareLeg(await readJson(req));

  const out = await runTransition(admin, {
    caller,
    scopeStationId: stationId,
    sessionId: body.sessionId,
    actionId: body.actionId,
    actionType: 'prepare',
    body: { ...body },
    expectedRevision: body.expectedRevision,
    compute: (state, seed, expected) =>
      prepareWithSeed(state, seed, { route: body.route, pushLevel: body.pushLevel }, expected),
  }, ctx);
  return { body: out.body, replay: out.replay };
});
