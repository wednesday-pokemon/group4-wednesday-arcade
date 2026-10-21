// POST /functions/v1/finish-session   (station account)
// body: { sessionId, actionId, reason: 'player_reset' }
// In progress -> abandoned (unranked), station shows idle with notice 'player_reset'.  200 -> SessionEnvelope
// Already completed/dnf -> no state change; the station display is released to idle.  200 -> SessionEnvelope + released
// Already abandoned -> 200 -> SessionEnvelope (no-op).
import { abandonSession } from '../_shared/game/index.ts';
import { requireCaller, requireStation } from '../_shared/auth.ts';
import { adminClient, callRpc, findReceipt, loadSeed, loadSession } from '../_shared/db.ts';
import { readJson, serve } from '../_shared/http.ts';
import { buildEnvelope, runTransition } from '../_shared/session-flow.ts';
import { parseFinishSession } from '../_shared/validation.ts';

serve('finish-session', async (req, ctx) => {
  const admin = adminClient();
  const caller = await requireCaller(req, admin);
  const stationId = requireStation(caller);
  const body = parseFinishSession(await readJson(req));

  const row = await loadSession(admin, body.sessionId, stationId);
  const receipt = await findReceipt(admin, row.id, body.actionId);
  if (row.status === 'in_progress' || receipt) {
    const out = await runTransition(admin, {
      caller,
      scopeStationId: stationId,
      sessionId: body.sessionId,
      actionId: body.actionId,
      actionType: 'abandon',
      body: { ...body },
      abandonReason: 'player_reset',
      expectedRevision: 'current',
      compute: (state) => ({ ok: true, state: abandonSession(state) }),
    }, ctx);
    return { body: out.body, replay: out.replay };
  }

  // Ended session: nothing to change in the race; just free the station display if it still shows this one.
  let released = false;
  if (row.status === 'completed' || row.status === 'dnf') {
    const out = await callRpc(admin, 'release_station', { p_station_id: stationId, p_session_id: row.id });
    released = out.cleared === true;
  }
  const seed = await loadSeed(admin, row.id);
  return {
    body: { ...buildEnvelope(row.state, seed, row.seed_commitment, row.station_id, row.abandoned_reason), released },
  };
});
