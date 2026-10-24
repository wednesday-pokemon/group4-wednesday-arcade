// POST /functions/v1/mystery-get-session   (station account)   rules mystery-v4 (v3.1 sessions keep v3.1 rules)
// body: { sessionId? }
// 200 -> MysterySessionEnvelope { session, offer, result } of that session (own station only; other stations' ids 404),
//        or of the station's OPEN (offered/playing) session when sessionId is omitted;
//        { session: null, offer: null, result: null } when sessionId is omitted and nothing is open.
// Use on refresh/reconnect: the stored offer is returned unchanged, `session.lastSeq` is the last acknowledged event
// (resend everything after it), `session.status` tells whether the session was superseded / reset by the operator.
import { requireCaller, requireStation } from '../_shared/auth.ts';
import { adminClient } from '../_shared/db.ts';
import { readJson, serve } from '../_shared/http.ts';
import { loadEnvelope, loadMysterySession, loadOpenMysterySession } from '../_shared/mystery-db.ts';
import { parseMysteryGet } from '../_shared/mystery-validation.ts';

serve('mystery-get-session', async (req) => {
  const admin = adminClient();
  const caller = await requireCaller(req, admin);
  const stationId = requireStation(caller);
  const body = parseMysteryGet(await readJson(req));
  const row = body.sessionId
    ? await loadMysterySession(admin, body.sessionId, stationId)
    : await loadOpenMysterySession(admin, stationId);
  if (!row) return { body: { session: null, offer: null, result: null } };
  return { body: await loadEnvelope(admin, row) };
});
