// mystery-v3.1 Edge Function client for a station kiosk (docs/SUPABASE_SETUP.md §12.3). Uses the v2.5 transport
// (functions.ts: caller JWT + anon apikey, per-attempt timeout, body serialized ONCE so every retry re-sends the same
// bytes / the same actionId). The station is never sent: the server derives it from the JWT, and every answer is
// checked against this page's station before the app trusts it.
import type { StationId } from '../../game/index.ts';
import type { SupabaseBatch } from '../../mystery/analytics/types.ts';
import type { Duo, RunResult } from '../../mystery/types.ts';
import { BackendError } from '../backend.ts';
import type { LiveAuth } from './auth.ts';
import { FunctionCallError, invokeFunction, type FunctionName, type FunctionTransport, type InvokeResult } from './functions.ts';
import {
  parseAppendAck, parseEnvelope, parseFinalize, type MysteryAppendAck, type MysteryFinalizeResponse, type MysterySessionEnvelope,
} from './mysteryWire.ts';

export type MysteryFunctionName =
  | 'mystery-create-session' | 'mystery-get-session' | 'mystery-select-duo' | 'mystery-append-events' | 'mystery-finalize'
  | 'admin-reset';

export type MysteryCaller = <T>(name: MysteryFunctionName, body: Record<string, unknown>) => Promise<InvokeResult<T>>;

/** The shared transport only types the v2.5 names; the URL scheme and error envelope are identical for mystery-*. */
export function mysteryCaller(transport: FunctionTransport): MysteryCaller {
  return <T,>(name: MysteryFunctionName, body: Record<string, unknown>) => invokeFunction<T>(transport, name as FunctionName, body);
}

/** What a failed call means for the kiosk flow. */
export type MysteryFailure =
  | 'network' // no answer / gateway fault / rate limited: retry later with the same body
  | 'auth' // signed out / token refused: staff must sign in again
  | 'conflict' // SEQ_CONFLICT / STALE_EVENTS: resync with get-session, resend after lastSeq
  | 'rejected' // EVENT_REJECTED / TOO_MANY_EVENTS / invalid body: this run cannot be verified
  | 'reset' // the operator reset the station
  | 'closed' // superseded / already finalized / abandoned
  | 'not_found'
  | 'not_selected'
  | 'not_offered' // DUO_NOT_OFFERED
  | 'already_selected'
  | 'not_finished' // RUN_NOT_FINISHED: flush the terminal event first
  | 'action_conflict' // ACTION_ID_CONFLICT: the actionId was used for a different body
  | 'other';

export function classifyFailure(err: unknown): MysteryFailure {
  if (!(err instanceof BackendError)) return 'network';
  const server = err instanceof FunctionCallError ? err.serverCode : null;
  switch (server) {
    case 'SEQ_CONFLICT':
    case 'STALE_EVENTS':
      return 'conflict';
    case 'EVENT_REJECTED':
    case 'TOO_MANY_EVENTS':
    case 'CASE_OUTDATED': // the session was created for another version of its case: it cannot be verified
    case 'INVALID_INPUT':
    case 'MALFORMED_JSON':
    case 'PAYLOAD_TOO_LARGE':
      return 'rejected';
    case 'SESSION_CLOSED':
      return err.code === 'RESET_BY_OPERATOR' ? 'reset' : 'closed';
    case 'SESSION_NOT_FOUND':
      return 'not_found';
    case 'NOT_SELECTED':
      return 'not_selected';
    case 'DUO_NOT_OFFERED':
      return 'not_offered';
    case 'ALREADY_SELECTED':
      return 'already_selected';
    case 'RUN_NOT_FINISHED':
      return 'not_finished';
    case 'ACTION_ID_CONFLICT':
      return 'action_conflict';
    case 'RATE_LIMITED':
    case 'INTERNAL':
      return 'network';
    default:
      break;
  }
  if (err.code === 'RESET_BY_OPERATOR') return 'reset';
  if (err.code === 'NETWORK') return 'network';
  if (err.code === 'UNAUTHORIZED') return 'auth';
  if (err.code === 'NOT_FOUND') return 'not_found';
  if (err.code === 'SERVER' && err.retryable) return 'network';
  return 'other';
}

export interface MysteryStationApiDeps {
  stationId: StationId;
  auth: Pick<LiveAuth, 'requireStation'>;
  call: MysteryCaller;
}

export class MysteryStationApi {
  readonly stationId: StationId;

  constructor(private readonly deps: MysteryStationApiDeps) {
    this.stationId = deps.stationId;
  }

  private async send<T>(name: MysteryFunctionName, body: Record<string, unknown>): Promise<InvokeResult<T>> {
    await this.deps.auth.requireStation(this.stationId); // no request leaves a page that is not this station's
    return this.deps.call<T>(name, body);
  }

  private own(env: MysterySessionEnvelope | null): MysterySessionEnvelope | null {
    if (env && env.session.stationId !== this.stationId) {
      throw new BackendError('UNAUTHORIZED', 'The server bound this account to a different station.');
    }
    return env;
  }

  /** New visitor. `actionId` must be persisted BEFORE this call; a retry / refresh re-sends the same one. */
  async create(actionId: string, nickname: string): Promise<{ envelope: MysterySessionEnvelope; replay: boolean }> {
    const res = await this.send<unknown>('mystery-create-session', { actionId, nickname });
    const envelope = this.own(parseEnvelope(res.data));
    if (!envelope) throw new BackendError('SERVER', 'The case server did not return the new session.', true);
    return { envelope, replay: res.replay };
  }

  /** Refresh / reconnect. Without `sessionId`: the station's open session, or null. */
  async get(sessionId?: string): Promise<MysterySessionEnvelope | null> {
    const res = await this.send<unknown>('mystery-get-session', sessionId ? { sessionId } : {});
    return this.own(parseEnvelope(res.data));
  }

  async select(sessionId: string, duo: Duo): Promise<MysterySessionEnvelope> {
    const res = await this.send<unknown>('mystery-select-duo', { sessionId, characterId: duo.characterId, pokemonId: duo.pokemonId });
    const envelope = this.own(parseEnvelope(res.data));
    if (!envelope) throw new BackendError('SERVER', 'The case server did not return the session.', true);
    return envelope;
  }

  /** One batch exactly as `analytics.pendingBatch()` produced it (the cursor stays local). */
  async append(sessionId: string, batch: Pick<SupabaseBatch, 'events' | 'forecasts' | 'recommendations'>): Promise<MysteryAppendAck> {
    const body: Record<string, unknown> = { sessionId, events: batch.events };
    if (batch.forecasts.length > 0) body.forecasts = batch.forecasts;
    if (batch.recommendations.length > 0) body.recommendations = batch.recommendations;
    const ack = parseAppendAck((await this.send<unknown>('mystery-append-events', body)).data);
    if (ack.sessionId !== sessionId) throw new BackendError('SERVER', 'The case server acknowledged a different session.', true);
    return ack;
  }

  /** Always safe to retry: every later call returns the same stored result. `clientResult` is audit-only. */
  async finalize(sessionId: string, clientResult: RunResult | null): Promise<MysteryFinalizeResponse> {
    const body: Record<string, unknown> = { sessionId };
    if (clientResult) body.clientResult = clientResult;
    const out = parseFinalize((await this.send<unknown>('mystery-finalize', body)).data);
    if (out.sessionId !== sessionId || out.result.stationId !== this.stationId) {
      throw new BackendError('UNAUTHORIZED', 'The server finalized a session of a different station.');
    }
    return out;
  }
}
