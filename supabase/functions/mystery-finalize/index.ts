// POST /functions/v1/mystery-finalize   (station account)   rules mystery-v3.1
// body: { sessionId, clientResult? }   clientResult = the browser's RunResult (audit only, never trusted)
// The server reloads every rule-relevant stored event, re-validates the whole sequence from scratch, and recomputes
// outcome, verdict, egg tier/points, active time and score with the shared scoring + caseLogic modules.
// 201 -> { sessionId, result: MysteryResultView, rank }              (first finalization; rank null for DNF / test)
// 200 + x-idempotent-replay -> the SAME stored result (every later call, whatever the body)
// 409 RUN_NOT_FINISHED (no finish/dnf event stored yet: flush events first) | NOT_SELECTED | SESSION_CLOSED
import { actorOf, requireCaller, requireStation } from '../_shared/auth.ts';
import { adminClient, callRpc } from '../_shared/db.ts';
import { HttpError } from '../_shared/errors.ts';
import { readJson, serve } from '../_shared/http.ts';
import {
  loadMysterySession, loadRank, loadResult, loadRuleEvents, resultView, type MysteryResultRow,
} from '../_shared/mystery-db.ts';
import { applyBatch, initialProgress, progressFromRow, ruleFingerprint } from '../_shared/mystery-events.ts';
import { computeResult, requireData, requireEggRules, rulesContext } from '../_shared/mystery-rules.ts';
import { MAX_FINALIZE_BYTES, parseMysteryFinalize } from '../_shared/mystery-validation.ts';

const MAX_ATTEMPTS = 3;

serve('mystery-finalize', async (req, ctx) => {
  const admin = adminClient();
  const caller = await requireCaller(req, admin);
  const stationId = requireStation(caller);
  const body = parseMysteryFinalize(await readJson(req, MAX_FINALIZE_BYTES));

  const respond = async (row: MysteryResultRow, replay: boolean) => ({
    status: replay ? 200 : 201,
    replay,
    body: {
      sessionId: row.session_id,
      result: resultView(row),
      rank: row.outcome === 'finished' && !row.is_test ? await loadRank(admin, row.session_id) : null,
    },
  });

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const row = await loadMysterySession(admin, body.sessionId, stationId);
    if (row.status === 'finished' || row.status === 'dnf') {
      const stored = await loadResult(admin, row.id);
      if (!stored) throw new HttpError('INTERNAL', 'Finalized session without a result row');
      return respond(stored, true);
    }
    if (row.status === 'offered') throw new HttpError('NOT_SELECTED', 'No duo selected; nothing to finalize');
    if (row.status !== 'playing') {
      throw new HttpError('SESSION_CLOSED', `Session is ${row.status}`, { status: row.status, abandonedReason: row.abandoned_reason });
    }

    const data = requireData();
    const egg = requireEggRules();
    const rules = rulesContext(row.seed, data.caseDef, egg);
    // Re-validate the stored rule events from scratch (independent of the incremental append-time state).
    const replayed = applyBatch(initialProgress(), await loadRuleEvents(admin, row.id), rules);
    if (ruleFingerprint(replayed) !== ruleFingerprint(progressFromRow(row.progress))) {
      ctx.log('error', 'mystery_progress_mismatch', { sessionId: row.id });
      throw new HttpError('INVALID_TRANSITION', 'Stored events and stored progress disagree');
    }
    const result = computeResult(replayed, data.caseDef, rules.expectedTier, body.clientResult);

    try {
      const out = await callRpc(admin, 'mystery_finalize_session', {
        p_session_id: row.id,
        p_station_id: stationId,
        p_expected_last_seq: row.last_seq,
        p_result: result,
        p_request: { body, actor: actorOf(caller) },
      });
      const stored = out.result as unknown as MysteryResultRow;
      ctx.log(result.claimMatches ? 'info' : 'warn', 'mystery_finalized', {
        sessionId: row.id, replay: out.replay === true, outcome: stored.outcome, score: stored.score,
        verdict: stored.verdict, claimMatches: result.claimMatches,
      });
      return respond(stored, out.replay === true);
    } catch (err) {
      if (err instanceof HttpError && err.code === 'STALE_EVENTS' && attempt < MAX_ATTEMPTS) continue;
      throw err;
    }
  }
  throw new HttpError('STALE_EVENTS', 'Session kept changing; retry finalize');
});
