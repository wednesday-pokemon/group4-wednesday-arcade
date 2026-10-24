// POST /functions/v1/mystery-finalize   (station account)   rules mystery-v4 (v3.1 sessions keep v3.1 rules)
// body: { sessionId, clientResult? }   clientResult = the browser's RunResult (audit only, never trusted)
// The server reloads every rule-relevant stored event, re-validates the whole sequence from scratch, and recomputes
// outcome, verdict, correct, cited evidence (sanitized), deductionCorrect, egg tier/points, active time and score with
// the shared scoring + caseLogic modules and its OWN answer key for the session's case (client claims: audit only).
// 201 -> { sessionId, result: MysteryResultView, rank, reveal }      (first finalization; rank null for DNF / test)
//        reveal = { culprit, resolution } of the session's case for a finished run (post-accusation), null for a DNF
// 200 + x-idempotent-replay -> the SAME stored result + reveal (every later call, whatever the body)
// 409 CASE_OUTDATED (the session was created for another version of its case: cannot be verified)
// 409 RUN_NOT_FINISHED (no finish/dnf event stored yet: flush events first) | NOT_SELECTED | SESSION_CLOSED
import { actorOf, requireCaller, requireStation } from '../_shared/auth.ts';
import { adminClient, callRpc } from '../_shared/db.ts';
import { HttpError } from '../_shared/errors.ts';
import { readJson, serve } from '../_shared/http.ts';
import {
  loadMysterySession, loadRank, loadResult, loadRuleEvents, resultView, type MysteryResultRow,
} from '../_shared/mystery-db.ts';
import { applyBatch, initialProgress, progressFromRow, ruleFingerprint } from '../_shared/mystery-events.ts';
import {
  PLAYER_MAX_HP, caseReveal, computeResult, requireData, requireEggRules, resolveCase, rulesContext, sessionRulesVersion,
} from '../_shared/mystery-rules.ts';
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
      rank: row.outcome === 'finished' && !row.is_test ? await loadRank(admin, row.session_id, row.rules_version) : null,
      // only now (the run is finished and stored) may the answer of the session's case leave the server
      reveal: caseReveal(resolveCase(row.case_id, undefined), row.outcome),
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
    const kase = resolveCase(row.case_id, row.case_version, data);
    const rulesVersion = sessionRulesVersion(row.rules_version); // v3.1 sessions keep the v3.1 formula
    const rules = rulesContext(row.seed, kase.caseDef, egg, PLAYER_MAX_HP, rulesVersion);
    // Re-validate the stored rule events from scratch (independent of the incremental append-time state).
    const replayed = applyBatch(initialProgress(), await loadRuleEvents(admin, row.id), rules);
    if (ruleFingerprint(replayed) !== ruleFingerprint(progressFromRow(row.progress))) {
      ctx.log('error', 'mystery_progress_mismatch', { sessionId: row.id });
      throw new HttpError('INVALID_TRANSITION', 'Stored events and stored progress disagree');
    }
    const result = computeResult(replayed, kase, rules.expectedTier, body.clientResult, rulesVersion);

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
        sessionId: row.id, replay: out.replay === true, rulesVersion, caseId: stored.case_id, outcome: stored.outcome, score: stored.score,
        hints: stored.hints_used, detections: stored.detections, hits: stored.hits, defeatedBy: stored.defeated_by,
        verdict: stored.verdict, deductionCorrect: stored.deduction_correct, claimMatches: result.claimMatches,
      });
      return respond(stored, out.replay === true);
    } catch (err) {
      if (err instanceof HttpError && err.code === 'STALE_EVENTS' && attempt < MAX_ATTEMPTS) continue;
      throw err;
    }
  }
  throw new HttpError('STALE_EVENTS', 'Session kept changing; retry finalize');
});
