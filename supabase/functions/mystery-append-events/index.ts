// POST /functions/v1/mystery-append-events   (station account)   rules mystery-v4 (v3.1 sessions keep v3.1 rules)
// body: { sessionId, events: StampedEvent[] (≤ 500, strictly increasing seq), forecasts?: ForecastIn[] (≤ 50),
//         recommendations?: RecommendationIn[] (≤ 50) }            body ≤ 256 KB
// Send batches SEQUENTIALLY (one in flight). Resending a batch is safe: events with seq ≤ lastSeq that equal the
// stored ones are counted as duplicates and ignored. Gaps in seq are allowed (the client may drop cosmetic events such
// as footstep noise); back-filling below lastSeq is not.
// 200 -> { sessionId, accepted, duplicates, lastSeq, lastT, eventCount, terminal, progress, forecastsInserted,
//          recommendationsUpserted, forecastsDropped, recommendationsDropped, clues }
//   clues = the session murderer's clue texts for every clue the SERVER has recorded as found ({} before the first);
//           an unfound clue's text never leaves the server (the browser shows it sealed until this ack).
// Analytics records are best-effort: an invalid forecast / recommendation is dropped and counted (warn log
// `mystery_analytics_dropped`), never a rejection — a rejected append would leave the visitor's run unverified.
// 422 EVENT_REJECTED { seq, rule } (order/rule violation; whole batch rejected, nothing stored)
// 409 SEQ_CONFLICT { seq, lastSeq } | NOT_SELECTED | SESSION_CLOSED { status, abandonedReason }
import { requireCaller, requireStation } from '../_shared/auth.ts';
import { adminClient, callRpc } from '../_shared/db.ts';
import { HttpError } from '../_shared/errors.ts';
import { readJson, serve } from '../_shared/http.ts';
import { loadEventsBySeq, loadMysterySession, sessionCulprit } from '../_shared/mystery-db.ts';
import { applyBatch, progressFromRow, progressSummary, splitResend } from '../_shared/mystery-events.ts';
import {
  PLAYER_MAX_HP, culpritDraw, requireData, requireEggRules, resolveCase, revealedClues, rulesContext, sessionRulesVersion,
} from '../_shared/mystery-rules.ts';
import type { ClueId } from '../_shared/mystery/types.ts';
import { MAX_APPEND_BYTES, parseMysteryAppend } from '../_shared/mystery-validation.ts';

const MAX_ATTEMPTS = 3;

serve('mystery-append-events', async (req, ctx) => {
  const admin = adminClient();
  const caller = await requireCaller(req, admin);
  const stationId = requireStation(caller);
  const body = parseMysteryAppend(await readJson(req, MAX_APPEND_BYTES));
  const data = requireData();
  const egg = requireEggRules();
  const dropped = { forecastsDropped: body.dropped.forecasts, recommendationsDropped: body.dropped.recommendations };
  if (body.dropped.forecasts + body.dropped.recommendations > 0) {
    ctx.log('warn', 'mystery_analytics_dropped', { sessionId: body.sessionId, ...dropped, reasons: body.dropped.reasons });
  }

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const row = await loadMysterySession(admin, body.sessionId, stationId);
    const progress = progressFromRow(row.progress);
    const resent = body.events.filter((e) => e.seq <= row.last_seq).map((e) => e.seq);
    const { duplicates, fresh } = splitResend(body.events, row.last_seq, await loadEventsBySeq(admin, row.id, resent));
    // Texts of the FOUND clues only, from the session's own murderer (one extra RPC, only once a clue is found).
    const reveal = async (found: readonly ClueId[]) => found.length === 0 ? {} : revealedClues(
      resolveCase(row.case_id, row.case_version, data, await sessionCulprit(admin, row.id, culpritDraw(row.case_id, row.case_version))), found);
    const ack = (extra: Record<string, unknown>) => ({
      sessionId: row.id, accepted: 0, duplicates, lastSeq: row.last_seq, lastT: Number(row.last_t),
      eventCount: row.event_count, terminal: progress.terminal?.type ?? null, progress: progressSummary(progress),
      forecastsInserted: 0, recommendationsUpserted: 0, ...dropped, ...extra,
    });

    // Pure resend of already-stored events: acknowledge without writing (works even after finalization).
    if (fresh.length === 0 && body.forecasts.length === 0 && body.recommendations.length === 0) {
      let clues = {};
      try {
        clues = await reveal(progress.cluesFound);
      } catch {
        // an outdated case version still acknowledges a pure resend (it just cannot reveal)
      }
      return { body: ack({ clues }), replay: duplicates > 0 };
    }
    if (row.status === 'offered') throw new HttpError('NOT_SELECTED', 'Select a duo before sending gameplay events');
    if (row.status !== 'playing') {
      throw new HttpError('SESSION_CLOSED', `Session is ${row.status}`, { status: row.status, abandonedReason: row.abandoned_reason });
    }

    // The SESSION's case decides which clue ids exist (validated against the version it was created with); the SESSION's
    // rules version decides the v4 checks (a v3.1 session stays v3.1 forever).
    const { caseDef } = resolveCase(row.case_id, row.case_version, data);
    const next = applyBatch(progress, fresh, rulesContext(row.seed, caseDef, egg, PLAYER_MAX_HP, sessionRulesVersion(row.rules_version)));
    try {
      const out = await callRpc(admin, 'mystery_append_events', {
        p_session_id: row.id,
        p_station_id: stationId,
        p_expected_last_seq: row.last_seq,
        p_events: fresh,
        p_progress: next,
        p_forecasts: body.forecasts,
        p_recommendations: body.recommendations,
      });
      ctx.log('info', 'mystery_events_appended', {
        sessionId: row.id, accepted: fresh.length, duplicates, lastSeq: out.lastSeq, terminal: out.terminal ?? null,
      });
      return {
        body: ack({
          accepted: fresh.length, lastSeq: out.lastSeq, lastT: out.lastT, eventCount: out.eventCount,
          terminal: out.terminal ?? null, progress: progressSummary(next),
          forecastsInserted: out.forecastsInserted, recommendationsUpserted: out.recommendationsUpserted,
          clues: await reveal(next.cluesFound),
        }),
      };
    } catch (err) {
      if (err instanceof HttpError && err.code === 'STALE_EVENTS' && attempt < MAX_ATTEMPTS) {
        ctx.log('warn', 'mystery_stale_retry', { sessionId: row.id, attempt });
        continue; // a concurrent batch landed: reload and re-split (our events may now be duplicates)
      }
      throw err;
    }
  }
  throw new HttpError('STALE_EVENTS', 'Session kept changing; resync with mystery-get-session and resend');
});
