// Edge Function transport: POST {URL}/functions/v1/<name> with the caller's JWT, a per-attempt timeout,
// server error envelope -> BackendError mapping, and idempotent retries (the SAME body, hence the SAME
// actionId, is re-sent after a network failure / timeout / INTERNAL). Tokens are never logged.
import { BackendError, type BackendErrorCode } from '../backend.ts';

export type FunctionName = 'create-session' | 'get-session' | 'prepare-leg' | 'resolve-leg' | 'finish-session' | 'admin-reset';

export interface FunctionTransport {
  url: string;
  anonKey: string;
  /** Current access token of the signed-in account, or null when signed out. */
  getAccessToken(): Promise<string | null>;
  /** Optional one-shot refresh after a 401 (expired token). */
  refreshAccessToken?(): Promise<string | null>;
  fetch?: typeof fetch;
  timeoutMs?: number;
  maxAttempts?: number;
  sleep?: (ms: number) => Promise<void>;
}

export interface InvokeResult<T> {
  status: number;
  data: T;
  replay: boolean;
  requestId: string | null;
  attempts: number;
}

/** BackendError plus the server's diagnostic fields (request id for log correlation). */
export class FunctionCallError extends BackendError {
  constructor(
    code: BackendErrorCode,
    message: string,
    retryable: boolean,
    readonly serverCode: string | null,
    readonly status: number | null,
    readonly requestId: string | null,
    readonly details: Record<string, unknown> | undefined,
  ) {
    super(code, message, retryable);
    this.name = 'FunctionCallError';
  }
}

export const DEFAULT_TIMEOUT_MS = 10_000;
export const DEFAULT_MAX_ATTEMPTS = 3;
const BACKOFF_MS = [400, 1200, 2500];

/** Server error code -> client BackendErrorCode (docs/CLIENT_CONTRACT.md "Errors"). */
export const SERVER_CODE_MAP: Readonly<Record<string, BackendErrorCode>> = {
  STALE_REVISION: 'STALE_REVISION',
  WRONG_PHASE: 'WRONG_PHASE',
  SESSION_CLOSED: 'SESSION_CLOSED',
  ILLEGAL_STAMINA: 'ILLEGAL_STAMINA',
  NO_EGG_TO_COLLECT: 'NO_EGG_TO_COLLECT',
  INVALID_INPUT: 'INVALID_INPUT',
  MALFORMED_JSON: 'INVALID_INPUT',
  PAYLOAD_TOO_LARGE: 'INVALID_INPUT',
  UNAUTHENTICATED: 'UNAUTHORIZED',
  NOT_PROVISIONED: 'UNAUTHORIZED',
  FORBIDDEN_ROLE: 'UNAUTHORIZED',
  ORIGIN_NOT_ALLOWED: 'UNAUTHORIZED',
  SESSION_NOT_FOUND: 'NOT_FOUND',
  STATION_NOT_FOUND: 'NOT_FOUND',
  // actionId reused for a different request: the client's view is out of date -> refetch canonical state.
  ACTION_ID_CONFLICT: 'STALE_REVISION',
  SESSION_STILL_ACTIVE: 'WRONG_PHASE',
  RATE_LIMITED: 'SERVER',
  METHOD_NOT_ALLOWED: 'SERVER',
  INVALID_TRANSITION: 'SERVER',
  MISCONFIGURED: 'SERVER',
  INTERNAL: 'SERVER',
  // mystery-v3.1 (none retryable: re-sending the same request cannot succeed; refetch / restart the step instead)
  NOT_SELECTED: 'WRONG_PHASE', // run endpoints called before a duo was selected
  ALREADY_SELECTED: 'WRONG_PHASE', // the session's duo is fixed once chosen
  DUO_NOT_OFFERED: 'INVALID_INPUT', // selection must be one of the three offered cards
  STALE_EVENTS: 'STALE_REVISION', // event batch behind the server's last seq -> refetch canonical state
  SEQ_CONFLICT: 'STALE_REVISION', // same (session, seq) with different content
  EVENT_REJECTED: 'INVALID_INPUT', // event order / content failed server validation
  RUN_NOT_FINISHED: 'WRONG_PHASE', // finalisation before deposit + accusation / DNF
  TOO_MANY_EVENTS: 'INVALID_INPUT', // batch over the size limit
  TEST_SEED_FORBIDDEN: 'UNAUTHORIZED', // fixed operator seeds need an operator account
};

/** Server codes the client may safely re-send with the same actionId. */
const RETRY_SERVER_CODES = new Set(['INTERNAL']);
/** Codes surfaced as retryable to the UI (manual "Try again" keeps the actionId). */
const RETRYABLE_SERVER_CODES = new Set(['INTERNAL', 'RATE_LIMITED']);

interface ErrorEnvelope {
  error?: { code?: unknown; message?: unknown; retryable?: unknown; details?: unknown };
  requestId?: unknown;
}

function statusFallback(status: number): BackendErrorCode {
  if (status === 401 || status === 403) return 'UNAUTHORIZED';
  if (status === 404) return 'NOT_FOUND';
  if (status === 409) return 'STALE_REVISION';
  if (status === 400 || status === 413 || status === 422) return 'INVALID_INPUT';
  return 'SERVER';
}

/** Maps an HTTP error status + (possibly missing) error envelope to a BackendError. */
export function toBackendError(status: number, body: unknown, requestIdHeader: string | null = null): FunctionCallError {
  const env = (body && typeof body === 'object' ? body : {}) as ErrorEnvelope;
  const err = env.error && typeof env.error === 'object' ? env.error : undefined;
  const serverCode = typeof err?.code === 'string' ? err.code : null;
  const message = typeof err?.message === 'string' && err.message ? err.message : `Server responded ${status}`;
  const details = err?.details && typeof err.details === 'object' ? (err.details as Record<string, unknown>) : undefined;
  const requestId = typeof env.requestId === 'string' ? env.requestId : requestIdHeader;

  let code: BackendErrorCode;
  if (serverCode === 'SESSION_CLOSED' && details?.abandonedReason === 'operator_reset') code = 'RESET_BY_OPERATOR';
  else if (serverCode && serverCode in SERVER_CODE_MAP) code = SERVER_CODE_MAP[serverCode];
  else code = statusFallback(status);

  const retryable = serverCode ? RETRYABLE_SERVER_CODES.has(serverCode) : status >= 500 || status === 429;
  return new FunctionCallError(code, message, retryable, serverCode, status, requestId, details);
}

function networkError(message: string): FunctionCallError {
  return new FunctionCallError('NETWORK', message, true, null, null, null, undefined);
}

function shouldRetry(err: FunctionCallError): boolean {
  if (err.code === 'NETWORK') return true;
  if (err.serverCode) return RETRY_SERVER_CODES.has(err.serverCode);
  // Gateway faults without our envelope (502/503/504, worker boot errors): the request may not have run.
  return err.status !== null && err.status >= 500;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function newRequestId(): string {
  return crypto.randomUUID();
}

async function attempt<T>(t: FunctionTransport, name: FunctionName, payload: string, token: string): Promise<InvokeResult<T>> {
  const doFetch = t.fetch ?? globalThis.fetch.bind(globalThis);
  const controller = new AbortController();
  const timeoutMs = t.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let res: Response;
  let text: string;
  try {
    res = await doFetch(`${t.url}/functions/v1/${name}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        apikey: t.anonKey,
        'Content-Type': 'application/json',
        'x-request-id': newRequestId(),
      },
      body: payload,
      signal: controller.signal,
    });
    text = await res.text();
  } catch (err) {
    const aborted = controller.signal.aborted || (err instanceof Error && err.name === 'AbortError');
    throw networkError(aborted ? `No answer from the race server within ${Math.round(timeoutMs / 1000)} s.` : 'Could not reach the race server.');
  } finally {
    clearTimeout(timer);
  }
  const requestId = res.headers.get('x-request-id');
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = null;
    }
  }
  if (!res.ok) throw toBackendError(res.status, data, requestId);
  if (data === null || typeof data !== 'object') {
    throw new FunctionCallError('SERVER', 'The race server sent an unreadable answer.', true, null, res.status, requestId, undefined);
  }
  return { status: res.status, data: data as T, replay: res.headers.get('x-idempotent-replay') === 'true', requestId, attempts: 1 };
}

/**
 * Calls an Edge Function. The body is serialized ONCE, so every retry re-sends byte-identical JSON
 * (same actionId) and the server's idempotency receipt makes the retry safe.
 */
export async function invokeFunction<T>(t: FunctionTransport, name: FunctionName, body: Record<string, unknown>): Promise<InvokeResult<T>> {
  const payload = JSON.stringify(body);
  const maxAttempts = Math.max(1, t.maxAttempts ?? DEFAULT_MAX_ATTEMPTS);
  const sleep = t.sleep ?? defaultSleep;
  let token = await t.getAccessToken();
  if (!token) throw new FunctionCallError('UNAUTHORIZED', 'Sign in with this station account first.', false, null, null, null, undefined);
  let refreshed = false;
  let lastError: FunctionCallError | null = null;
  for (let i = 1; i <= maxAttempts; i++) {
    try {
      const result = await attempt<T>(t, name, payload, token);
      return { ...result, attempts: i };
    } catch (err) {
      const e = err instanceof FunctionCallError ? err : networkError('Could not reach the race server.');
      lastError = e;
      if (e.status === 401 && e.code === 'UNAUTHORIZED' && !refreshed && t.refreshAccessToken) {
        refreshed = true;
        const next = await t.refreshAccessToken().catch(() => null);
        if (next) {
          token = next;
          i--; // a token refresh does not consume a retry attempt
          continue;
        }
      }
      if (!shouldRetry(e) || i === maxAttempts) throw e;
      await sleep(BACKOFF_MS[Math.min(i - 1, BACKOFF_MS.length - 1)]);
    }
  }
  throw lastError ?? networkError('Could not reach the race server.');
}
