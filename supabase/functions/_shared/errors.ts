// Typed API errors. Pure module (no Deno APIs) so it can be unit-tested under Node/Vitest.
import type { ActionRejection } from './game/index.ts';

export type ApiErrorCode =
  // transport / request shape
  | 'METHOD_NOT_ALLOWED'
  | 'ORIGIN_NOT_ALLOWED'
  | 'PAYLOAD_TOO_LARGE'
  | 'MALFORMED_JSON'
  | 'INVALID_INPUT'
  // identity
  | 'UNAUTHENTICATED'
  | 'NOT_PROVISIONED'
  | 'FORBIDDEN_ROLE'
  // resources
  | 'SESSION_NOT_FOUND'
  | 'STATION_NOT_FOUND'
  // state machine / concurrency (engine ActionRejection codes + DB envelope codes)
  | 'STALE_REVISION'
  | 'WRONG_PHASE'
  | 'SESSION_CLOSED'
  | 'ACTION_ID_CONFLICT'
  | 'ILLEGAL_STAMINA'
  | 'NO_EGG_TO_COLLECT'
  | 'SESSION_STILL_ACTIVE'
  | 'RATE_LIMITED'
  // mystery-v3.1
  | 'NOT_SELECTED'
  | 'ALREADY_SELECTED'
  | 'DUO_NOT_OFFERED'
  | 'STALE_EVENTS'
  | 'SEQ_CONFLICT'
  | 'EVENT_REJECTED'
  | 'RUN_NOT_FINISHED'
  | 'TOO_MANY_EVENTS'
  | 'TEST_SEED_FORBIDDEN'
  // server faults
  | 'INVALID_TRANSITION'
  | 'MISCONFIGURED'
  | 'INTERNAL';

export const HTTP_STATUS: Record<ApiErrorCode, number> = {
  METHOD_NOT_ALLOWED: 405,
  ORIGIN_NOT_ALLOWED: 403,
  PAYLOAD_TOO_LARGE: 413,
  MALFORMED_JSON: 400,
  INVALID_INPUT: 422,
  UNAUTHENTICATED: 401,
  NOT_PROVISIONED: 403,
  FORBIDDEN_ROLE: 403,
  SESSION_NOT_FOUND: 404,
  STATION_NOT_FOUND: 404,
  STALE_REVISION: 409,
  WRONG_PHASE: 409,
  SESSION_CLOSED: 409,
  ACTION_ID_CONFLICT: 409,
  SESSION_STILL_ACTIVE: 409,
  ILLEGAL_STAMINA: 422,
  NO_EGG_TO_COLLECT: 422,
  RATE_LIMITED: 429,
  NOT_SELECTED: 409,
  ALREADY_SELECTED: 409,
  DUO_NOT_OFFERED: 422,
  STALE_EVENTS: 409,
  SEQ_CONFLICT: 409,
  EVENT_REJECTED: 422,
  RUN_NOT_FINISHED: 409,
  TOO_MANY_EVENTS: 422,
  TEST_SEED_FORBIDDEN: 403,
  INVALID_TRANSITION: 500,
  MISCONFIGURED: 500,
  INTERNAL: 500,
};

/** Whether the client may safely retry the SAME request (same actionId) after this error. */
export const RETRYABLE: ReadonlySet<ApiErrorCode> = new Set<ApiErrorCode>(['INTERNAL', 'RATE_LIMITED']);

export class HttpError extends Error {
  readonly code: ApiErrorCode;
  readonly details: Record<string, unknown> | undefined;
  constructor(code: ApiErrorCode, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = 'HttpError';
    this.code = code;
    this.details = details;
  }
  get status(): number {
    return HTTP_STATUS[this.code];
  }
}

export interface ErrorBody {
  error: { code: ApiErrorCode; message: string; retryable: boolean; details?: Record<string, unknown> };
  requestId: string;
}

export function errorBody(err: HttpError, requestId: string): ErrorBody {
  return {
    error: {
      code: err.code,
      message: err.message,
      retryable: RETRYABLE.has(err.code),
      ...(err.details ? { details: err.details } : {}),
    },
    requestId,
  };
}

/** Engine rejection -> HTTP error. 409 = state conflict (refresh), 422 = illegal choice (fix input). */
export function fromRejection(rejection: ActionRejection, currentRevision?: number): HttpError {
  const details = rejection.code === 'STALE_REVISION' && currentRevision !== undefined ? { currentRevision } : undefined;
  return new HttpError(rejection.code, rejection.message, details);
}

const RPC_CODES: ReadonlySet<string> = new Set([
  'INVALID_INPUT', 'SESSION_NOT_FOUND', 'STATION_NOT_FOUND', 'STALE_REVISION', 'SESSION_CLOSED', 'ACTION_ID_CONFLICT',
  'SESSION_STILL_ACTIVE', 'RATE_LIMITED', 'INVALID_TRANSITION',
  // mystery-v3.1 RPCs
  'NOT_SELECTED', 'ALREADY_SELECTED', 'DUO_NOT_OFFERED', 'STALE_EVENTS', 'EVENT_REJECTED', 'RUN_NOT_FINISHED', 'TOO_MANY_EVENTS',
]);

/** DB RPC envelope {ok:false,error,message,...details} -> HTTP error. Unknown codes become INTERNAL. */
export function fromRpcEnvelope(envelope: Record<string, unknown>): HttpError {
  const { ok: _ok, error, message, ...details } = envelope;
  const code = typeof error === 'string' && RPC_CODES.has(error) ? (error as ApiErrorCode) : 'INTERNAL';
  const text = typeof message === 'string' ? message : 'Unexpected database response';
  return new HttpError(code, text, Object.keys(details).length > 0 ? details : undefined);
}
