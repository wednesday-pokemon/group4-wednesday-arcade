// POST /functions/v1/get-session   (station account) — reconnect / refresh after STALE_REVISION.
// body: {} -> the session currently shown on the caller's station (or none)
//       { sessionId } -> that session, only if it belongs to the caller's station (else 404)
// 200 -> { view: PublicSessionView | null, meta: SessionMeta | null,
//          station: { stationId, label, status, notice } }
import { adminClient, loadSeed, loadSession, loadStationStatus } from '../_shared/db.ts';
import { requireCaller, requireStation } from '../_shared/auth.ts';
import { readJson, serve } from '../_shared/http.ts';
import { buildEnvelope } from '../_shared/session-flow.ts';
import { parseGetSession } from '../_shared/validation.ts';

serve('get-session', async (req) => {
  const admin = adminClient();
  const caller = await requireCaller(req, admin);
  const stationId = requireStation(caller);
  const body = parseGetSession(await readJson(req));

  const station = await loadStationStatus(admin, stationId);
  const stationInfo = { stationId, label: station.label, status: station.status, notice: station.notice };
  const sessionId = body.sessionId ?? station.session_id;
  if (!sessionId) return { body: { view: null, meta: null, station: stationInfo } };

  const row = await loadSession(admin, sessionId, stationId);
  const seed = await loadSeed(admin, row.id);
  const envelope = buildEnvelope(row.state, seed, row.seed_commitment, row.station_id, row.abandoned_reason);
  return {
    body: {
      ...envelope,
      meta: { ...envelope.meta, createdAt: row.created_at, completedAt: row.completed_at, verifiedAt: row.verified_at },
      station: stationInfo,
    },
  };
});
