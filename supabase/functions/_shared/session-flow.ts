// The one code path every state transition takes:
//   load (ownership-scoped) -> idempotent receipt check -> engine computes next state from the SECRET seed
//   -> redacted response -> commit_session_transition (row locks + revision check + receipt + projections).
// The client never supplies state, rolls, scores or completion; only its decision and expectedRevision.
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.45.4';
import { buildSessionView } from './game/index.ts';
import type { ActionRejection, GameState, LegResolution, StationId } from './game/index.ts';
import { actorOf, type Caller } from './auth.ts';
import { callRpc, findReceipt, loadSeed, loadSession } from './db.ts';
import { HttpError, fromRejection } from './errors.ts';
import type { RequestContext } from './http.ts';
import { redactResolution, redactView, type PublicLegResolution, type PublicSessionView } from './redact.ts';
import { jsonEqual } from './validation.ts';

export interface SessionMeta {
  sessionId: string;
  stationId: StationId;
  status: GameState['status'];
  abandonedReason: 'player_reset' | 'operator_reset' | 'superseded' | null;
}

/** Response body of create-session, get-session, prepare-leg, resolve-leg and finish-session. */
export interface SessionEnvelope {
  view: PublicSessionView;
  meta: SessionMeta;
  resolution?: PublicLegResolution; // resolve-leg only
}

export function buildEnvelope(
  state: GameState,
  seed: string,
  seedCommitment: string,
  stationId: StationId,
  abandonedReason: SessionMeta['abandonedReason'],
  resolution?: LegResolution,
): SessionEnvelope {
  const view = redactView(buildSessionView(state, seed, true, seedCommitment));
  const envelope: SessionEnvelope = {
    view,
    meta: { sessionId: state.sessionId, stationId, status: state.status, abandonedReason },
  };
  if (resolution) envelope.resolution = redactResolution(resolution, state.status === 'in_progress');
  return envelope;
}

type Computation =
  | { ok: true; state: GameState; resolution?: LegResolution }
  | { ok: false; error: ActionRejection };

export interface TransitionSpec {
  caller: Caller;
  /** Station the caller is bound to; null = operator (any station). */
  scopeStationId: StationId | null;
  sessionId: string;
  actionId: string;
  actionType: 'prepare' | 'resolve' | 'abandon';
  /** Validated request body; stored in the receipt and compared on replay. */
  body: Record<string, unknown>;
  abandonReason?: 'player_reset' | 'operator_reset';
  /** Client-supplied revision, or 'current' for server-initiated transitions (retried on races). */
  expectedRevision: number | 'current';
  compute: (state: GameState, seed: string, expectedRevision: number) => Computation;
}

const MAX_ATTEMPTS = 3;

export async function runTransition(
  admin: SupabaseClient,
  spec: TransitionSpec,
  ctx: RequestContext,
): Promise<{ body: Record<string, unknown>; replay: boolean }> {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const row = await loadSession(admin, spec.sessionId, spec.scopeStationId);

    const receipt = await findReceipt(admin, row.id, spec.actionId);
    if (receipt) {
      if (receipt.action_type !== spec.actionType || !jsonEqual(receipt.request?.body, spec.body)) {
        throw new HttpError('ACTION_ID_CONFLICT', 'actionId was already used for a different request');
      }
      return { body: receipt.response, replay: true };
    }

    if (row.status !== 'in_progress') {
      throw new HttpError('SESSION_CLOSED', `Session is ${row.status}`, {
        status: row.status,
        abandonedReason: row.abandoned_reason,
      });
    }

    const seed = await loadSeed(admin, row.id);
    const expected = spec.expectedRevision === 'current' ? row.revision : spec.expectedRevision;
    const result = spec.compute(row.state, seed, expected);
    if (!result.ok) throw fromRejection(result.error, row.revision);

    const response = buildEnvelope(
      result.state, seed, row.seed_commitment, row.station_id,
      result.state.status === 'abandoned' ? spec.abandonReason ?? null : null,
      result.resolution,
    );
    const request: Record<string, unknown> = { body: spec.body, actor: actorOf(spec.caller) };
    if (spec.abandonReason) request.abandonReason = spec.abandonReason;

    try {
      const out = await callRpc(admin, 'commit_session_transition', {
        p_session_id: row.id,
        p_expected_revision: expected,
        p_action_id: spec.actionId,
        p_action_type: spec.actionType,
        p_request: request,
        p_new_state: result.state,
        p_leg_result: result.resolution ?? null, // full resolution; the RPC splits draws into a private column
        p_response: response,
      });
      ctx.log('info', 'transition_committed', {
        sessionId: row.id, actionType: spec.actionType, replay: out.replay === true, revision: result.state.revision,
        status: result.state.status,
      });
      return { body: (out.response ?? response) as Record<string, unknown>, replay: out.replay === true };
    } catch (err) {
      if (err instanceof HttpError && err.code === 'STALE_REVISION' && spec.expectedRevision === 'current' && attempt < MAX_ATTEMPTS) {
        ctx.log('warn', 'stale_retry', { sessionId: row.id, attempt });
        continue;
      }
      throw err;
    }
  }
  throw new HttpError('STALE_REVISION', 'Session kept changing; reload and retry');
}
