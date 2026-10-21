// POST /functions/v1/resolve-leg   (station account)
// body: { sessionId, expectedRevision, eggDecision, actionId }
// 200 -> SessionEnvelope + resolution (PublicLegResolution). On the last leg / DNF the session ends,
//        the server stamps completed_at/verified_at, publishes the leaderboard entry exactly once and the
//        response reveals the seed (view.revealedSeed) and all draws.
import { resolveWithSeed } from '../_shared/game/index.ts';
import { requireCaller, requireStation } from '../_shared/auth.ts';
import { adminClient } from '../_shared/db.ts';
import { readJson, serve } from '../_shared/http.ts';
import { runTransition } from '../_shared/session-flow.ts';
import { parseResolveLeg } from '../_shared/validation.ts';

serve('resolve-leg', async (req, ctx) => {
  const admin = adminClient();
  const caller = await requireCaller(req, admin);
  const stationId = requireStation(caller);
  const body = parseResolveLeg(await readJson(req));

  const out = await runTransition(admin, {
    caller,
    scopeStationId: stationId,
    sessionId: body.sessionId,
    actionId: body.actionId,
    actionType: 'resolve',
    body: { ...body },
    expectedRevision: body.expectedRevision,
    compute: (state, seed, expected) => resolveWithSeed(state, seed, body.eggDecision, expected),
  }, ctx);
  return { body: out.body, replay: out.replay };
});
