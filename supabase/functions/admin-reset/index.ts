// POST /functions/v1/admin-reset   (operator account)
// body: { stationId, reason, actionId }   reason = free-text note (3-200 chars) kept in operator_audit
// Abandons the station's in-progress session (abandoned_reason 'operator_reset', unranked), clears
// station_status to idle with notice 'operator_reset' (the terminal sees it via Realtime / get-session),
// and writes an operator_audit row.  200 -> { stationId, abandonedSessionIds, notice: 'operator_reset' }
import { abandonSession } from '../_shared/game/index.ts';
import { requireCaller, requireOperator } from '../_shared/auth.ts';
import { adminClient, callRpc, loadInProgressSessions } from '../_shared/db.ts';
import { HttpError } from '../_shared/errors.ts';
import { readJson, serve } from '../_shared/http.ts';
import { runTransition } from '../_shared/session-flow.ts';
import { parseAdminReset } from '../_shared/validation.ts';

serve('admin-reset', async (req, ctx) => {
  const admin = adminClient();
  const caller = await requireCaller(req, admin);
  requireOperator(caller);
  const body = parseAdminReset(await readJson(req));

  const abandoned: string[] = [];
  for (const row of await loadInProgressSessions(admin, body.stationId)) {
    try {
      await runTransition(admin, {
        caller,
        scopeStationId: null,
        sessionId: row.id,
        actionId: body.actionId,
        actionType: 'abandon',
        body: { ...body },
        abandonReason: 'operator_reset',
        expectedRevision: 'current',
        compute: (state) => ({ ok: true, state: abandonSession(state) }),
      }, ctx);
      abandoned.push(row.id);
    } catch (err) {
      // The race finished between our read and the commit: nothing left to abandon.
      if (!(err instanceof HttpError && err.code === 'SESSION_CLOSED')) throw err;
    }
  }

  await callRpc(admin, 'operator_reset_station', {
    p_station_id: body.stationId,
    p_actor_user_id: caller.userId,
    p_note: body.reason,
    p_session_ids: abandoned,
  });
  ctx.log('warn', 'operator_reset', { stationId: body.stationId, actor: caller.userId, abandoned });
  return { body: { stationId: body.stationId, abandonedSessionIds: abandoned, notice: 'operator_reset' } };
});
