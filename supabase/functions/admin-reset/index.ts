// POST /functions/v1/admin-reset   (operator account)
// body: { stationId, reason, actionId, scope? }   reason = free-text note (3-200 chars) kept in operator_audit
//   scope 'all' (default) | 'legacy' (v2.5 race only) | 'mystery' (mystery-v3.1 session only)
// v2.5: abandons the station's in-progress race (abandoned_reason 'operator_reset', unranked) through the engine and
//       clears station_status to idle with notice 'operator_reset'.
// mystery-v3.1: abandons the station's open (offered/playing) mystery session ('operator_reset', unranked; its events
//       stay for analytics) and clears mystery_station_status to idle with notice 'operator_reset'.
// One operator_audit row per call lists every abandoned session id (both games).
// 200 -> { stationId, scope, abandonedSessionIds, abandonedMysterySessionIds, notice: 'operator_reset' }
import { abandonSession } from '../_shared/game/index.ts';
import { actorOf, requireCaller, requireOperator } from '../_shared/auth.ts';
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
  if (body.scope !== 'mystery') {
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
  }

  let mysteryAbandoned: string[] = [];
  if (body.scope !== 'legacy') {
    const out = await callRpc(admin, 'mystery_abandon_station', {
      p_station_id: body.stationId,
      p_reason: 'operator_reset',
      p_request: { body: { ...body }, actor: actorOf(caller) },
    });
    mysteryAbandoned = (out.abandonedSessionIds as string[] | undefined) ?? [];
  }

  if (body.scope !== 'mystery') {
    // Clears the v2.5 public row and writes the (single) audit record for both games.
    await callRpc(admin, 'operator_reset_station', {
      p_station_id: body.stationId,
      p_actor_user_id: caller.userId,
      p_note: body.reason,
      p_session_ids: [...abandoned, ...mysteryAbandoned],
    });
  } else {
    // Mystery-only reset: audit without touching the v2.5 station row.
    const { error } = await admin.from('operator_audit').insert({
      actor_user_id: caller.userId, station_id: body.stationId, action: 'station_reset',
      session_ids: mysteryAbandoned, note: `[mystery] ${body.reason}`.slice(0, 200),
    });
    if (error) throw new HttpError('INTERNAL', 'Could not write the audit record');
  }
  ctx.log('warn', 'operator_reset', {
    stationId: body.stationId, scope: body.scope, actor: caller.userId, abandoned, mysteryAbandoned,
  });
  return {
    body: {
      stationId: body.stationId, scope: body.scope, abandonedSessionIds: abandoned,
      abandonedMysterySessionIds: mysteryAbandoned, notice: 'operator_reset',
    },
  };
});
