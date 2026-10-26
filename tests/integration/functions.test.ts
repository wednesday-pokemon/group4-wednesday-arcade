// Transport: server error envelope -> BackendError mapping table, timeouts, idempotent retries (same actionId).
import { describe, expect, it } from 'vitest';
import { BackendError } from '../../src/lib/backend.ts';
import { FunctionCallError, SERVER_CODE_MAP, invokeFunction, toBackendError, type FunctionTransport } from '../../src/lib/supabase/functions.ts';
import { assertBrowserSafeKey, readLiveConfig, storageKeyFor } from '../../src/lib/supabase/client.ts';
import { HTTP_STATUS, errorBody, HttpError, type ApiErrorCode } from '../../supabase/functions/_shared/errors.ts';
import { ANON_KEY, FAKE_URL, fakeJwt } from './fakeSupabase.ts';

function envelope(code: ApiErrorCode, details?: Record<string, unknown>) {
  return errorBody(new HttpError(code, `msg ${code}`, details), 'req-12345678');
}

describe('error-code mapping table (every server ApiErrorCode)', () => {
  const expected: Record<ApiErrorCode, [string, boolean]> = {
    STALE_REVISION: ['STALE_REVISION', false],
    WRONG_PHASE: ['WRONG_PHASE', false],
    SESSION_CLOSED: ['SESSION_CLOSED', false],
    ILLEGAL_STAMINA: ['ILLEGAL_STAMINA', false],
    NO_EGG_TO_COLLECT: ['NO_EGG_TO_COLLECT', false],
    INVALID_INPUT: ['INVALID_INPUT', false],
    MALFORMED_JSON: ['INVALID_INPUT', false],
    PAYLOAD_TOO_LARGE: ['INVALID_INPUT', false],
    UNAUTHENTICATED: ['UNAUTHORIZED', false],
    NOT_PROVISIONED: ['UNAUTHORIZED', false],
    FORBIDDEN_ROLE: ['UNAUTHORIZED', false],
    ORIGIN_NOT_ALLOWED: ['UNAUTHORIZED', false],
    SESSION_NOT_FOUND: ['NOT_FOUND', false],
    STATION_NOT_FOUND: ['NOT_FOUND', false],
    ACTION_ID_CONFLICT: ['STALE_REVISION', false],
    SESSION_STILL_ACTIVE: ['WRONG_PHASE', false],
    RATE_LIMITED: ['SERVER', true],
    METHOD_NOT_ALLOWED: ['SERVER', false],
    INVALID_TRANSITION: ['SERVER', false],
    MISCONFIGURED: ['SERVER', false],
    INTERNAL: ['SERVER', true],
    NOT_SELECTED: ['WRONG_PHASE', false],
    ALREADY_SELECTED: ['WRONG_PHASE', false],
    DUO_NOT_OFFERED: ['INVALID_INPUT', false],
    STALE_EVENTS: ['STALE_REVISION', false],
    SEQ_CONFLICT: ['STALE_REVISION', false],
    EVENT_REJECTED: ['INVALID_INPUT', false],
    RUN_NOT_FINISHED: ['WRONG_PHASE', false],
    TOO_MANY_EVENTS: ['INVALID_INPUT', false],
    TEST_SEED_FORBIDDEN: ['UNAUTHORIZED', false],
    CASE_OUTDATED: ['WRONG_PHASE', false],
  };

  for (const code of Object.keys(HTTP_STATUS) as ApiErrorCode[]) {
    it(`${HTTP_STATUS[code]} ${code} -> ${expected[code][0]} (retryable=${expected[code][1]})`, () => {
      const err = toBackendError(HTTP_STATUS[code], envelope(code));
      expect(err).toBeInstanceOf(BackendError);
      expect(err.code).toBe(expected[code][0]);
      expect(err.retryable).toBe(expected[code][1]);
      expect(err.serverCode).toBe(code);
      expect(err.requestId).toBe('req-12345678');
      expect(err.message).toBe(`msg ${code}`);
    });
  }

  it('covers every server code (map has no gaps)', () => {
    expect(Object.keys(SERVER_CODE_MAP).sort()).toEqual(Object.keys(HTTP_STATUS).sort());
  });

  it('SESSION_CLOSED with abandonedReason operator_reset -> RESET_BY_OPERATOR', () => {
    const err = toBackendError(409, envelope('SESSION_CLOSED', { status: 'abandoned', abandonedReason: 'operator_reset' }));
    expect(err.code).toBe('RESET_BY_OPERATOR');
    expect(toBackendError(409, envelope('SESSION_CLOSED', { status: 'abandoned', abandonedReason: 'superseded' })).code).toBe('SESSION_CLOSED');
  });

  it('STALE_REVISION keeps details.currentRevision', () => {
    const err = toBackendError(409, envelope('STALE_REVISION', { currentRevision: 4 }));
    expect(err.details).toEqual({ currentRevision: 4 });
  });

  it.each([
    [401, 'UNAUTHORIZED', false], [403, 'UNAUTHORIZED', false], [404, 'NOT_FOUND', false], [409, 'STALE_REVISION', false],
    [422, 'INVALID_INPUT', false], [429, 'SERVER', true], [500, 'SERVER', true], [502, 'SERVER', true], [503, 'SERVER', true],
    [418, 'SERVER', false],
  ])('status %i without an error envelope -> %s', (status, code, retryable) => {
    const err = toBackendError(status, null);
    expect(err.code).toBe(code);
    expect(err.retryable).toBe(retryable);
  });
});

// ------------------------------------------------------------------------------------------------

type Step = 'throw' | 'hang' | Response | (() => Response);

function scripted(steps: Step[]) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetchFn: typeof fetch = async (input, init) => {
    calls.push({ url: String(input), init: init ?? {} });
    const step = steps.shift();
    if (step === undefined) throw new Error('no more scripted responses');
    if (step === 'throw') throw new TypeError('Failed to fetch');
    if (step === 'hang') {
      return new Promise<Response>((_, reject) => init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))));
    }
    return typeof step === 'function' ? step() : step;
  };
  return { fetchFn, calls };
}

const ok = (body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json', ...headers } });
const err = (status: number, code: ApiErrorCode) => () =>
  new Response(JSON.stringify(envelope(code)), { status, headers: { 'Content-Type': 'application/json', 'x-request-id': 'req-12345678' } });

function transport(fetchFn: typeof fetch, extra: Partial<FunctionTransport> = {}) {
  const sleeps: number[] = [];
  const t: FunctionTransport = {
    url: FAKE_URL, anonKey: ANON_KEY, getAccessToken: async () => 'token-1', fetch: fetchFn, timeoutMs: 200,
    sleep: async (ms) => void sleeps.push(ms), ...extra,
  };
  return { t, sleeps };
}

const BODY = { sessionId: '7b0c4a52-5f43-4a3e-9d33-0f6c1d2b9e10', expectedRevision: 2, eggDecision: 'skip', actionId: 'act-0001-abcdef' };

describe('invokeFunction: retries re-send the identical body (same actionId)', () => {
  it('network failure, then success: 2 attempts, byte-identical bodies, headers set, backoff applied', async () => {
    const { fetchFn, calls } = scripted(['throw', ok({ ok: true }, { 'x-idempotent-replay': 'true', 'x-request-id': 'r-abcdefgh' })]);
    const { t, sleeps } = transport(fetchFn);
    const res = await invokeFunction(t, 'resolve-leg', BODY);
    expect(res.attempts).toBe(2);
    expect(res.replay).toBe(true);
    expect(res.requestId).toBe('r-abcdefgh');
    expect(calls).toHaveLength(2);
    expect(calls[0].init.body).toBe(calls[1].init.body);
    expect(JSON.parse(String(calls[1].init.body)).actionId).toBe('act-0001-abcdef');
    expect(calls[0].url).toBe(`${FAKE_URL}/functions/v1/resolve-leg`);
    const h = new Headers(calls[0].init.headers);
    expect(h.get('authorization')).toBe('Bearer token-1');
    expect(h.get('apikey')).toBe(ANON_KEY);
    expect(h.get('content-type')).toBe('application/json');
    expect(h.get('x-request-id')).toMatch(/^[A-Za-z0-9_-]{8,64}$/);
    expect(sleeps).toEqual([400]);
  });

  it('INTERNAL (500) is retried with the same actionId; succeeds on the 3rd attempt', async () => {
    const { fetchFn, calls } = scripted([err(500, 'INTERNAL'), err(500, 'INTERNAL'), ok({ fine: 1 })]);
    const { t, sleeps } = transport(fetchFn);
    const res = await invokeFunction(t, 'prepare-leg', BODY);
    expect(res.attempts).toBe(3);
    expect(new Set(calls.map((c) => c.init.body)).size).toBe(1);
    expect(sleeps).toEqual([400, 1200]);
  });

  it('gives up after 3 attempts: NETWORK, retryable', async () => {
    const { fetchFn, calls } = scripted(['throw', 'throw', 'throw']);
    const { t } = transport(fetchFn);
    const e = await invokeFunction(t, 'create-session', BODY).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(BackendError);
    expect((e as BackendError).code).toBe('NETWORK');
    expect((e as BackendError).retryable).toBe(true);
    expect(calls).toHaveLength(3);
  });

  it('timeout (AbortController) -> NETWORK retryable, then retried', async () => {
    const { fetchFn, calls } = scripted(['hang', ok({ done: true })]);
    const { t } = transport(fetchFn, { timeoutMs: 30 });
    const res = await invokeFunction(t, 'get-session', {});
    expect(res.data).toEqual({ done: true });
    expect(calls).toHaveLength(2);
    expect(calls[0].init.signal?.aborted).toBe(true);
  });

  it('timeout on every attempt -> NETWORK with a timeout message', async () => {
    const { fetchFn } = scripted(['hang', 'hang', 'hang']);
    const { t } = transport(fetchFn, { timeoutMs: 20 });
    const e = (await invokeFunction(t, 'get-session', {}).catch((x: unknown) => x)) as FunctionCallError;
    expect(e.code).toBe('NETWORK');
    expect(e.message).toMatch(/No answer/);
  });

  it('gateway 503 without our envelope is retried; 4xx and business errors are not', async () => {
    const gw = scripted([() => new Response('upstream connect error', { status: 503 }), ok({ x: 1 })]);
    expect((await invokeFunction(transport(gw.fetchFn).t, 'get-session', {})).attempts).toBe(2);

    for (const [status, code] of [[409, 'STALE_REVISION'], [409, 'WRONG_PHASE'], [422, 'ILLEGAL_STAMINA'], [429, 'RATE_LIMITED'], [500, 'INVALID_TRANSITION']] as const) {
      const s = scripted([err(status, code), ok({})]);
      const e = await invokeFunction(transport(s.fetchFn).t, 'prepare-leg', BODY).catch((x: unknown) => x);
      expect(e).toBeInstanceOf(BackendError);
      expect(s.calls).toHaveLength(1);
    }
  });

  it('401 triggers exactly one token refresh and a resend with the new token', async () => {
    const { fetchFn, calls } = scripted([err(401, 'UNAUTHENTICATED'), ok({ ok: 1 })]);
    let refreshes = 0;
    const { t } = transport(fetchFn, { refreshAccessToken: async () => (++refreshes, 'token-2') });
    const res = await invokeFunction(t, 'get-session', {});
    expect(res.data).toEqual({ ok: 1 });
    expect(refreshes).toBe(1);
    expect(new Headers(calls[1].init.headers).get('authorization')).toBe('Bearer token-2');

    const again = scripted([err(401, 'UNAUTHENTICATED'), err(401, 'UNAUTHENTICATED')]);
    const e = await invokeFunction(transport(again.fetchFn, { refreshAccessToken: async () => 'token-3' }).t, 'get-session', {}).catch((x: unknown) => x);
    expect((e as BackendError).code).toBe('UNAUTHORIZED');
    expect(again.calls).toHaveLength(2);
  });

  it('no access token -> UNAUTHORIZED without any request', async () => {
    const { fetchFn, calls } = scripted([]);
    const e = await invokeFunction(transport(fetchFn, { getAccessToken: async () => null }).t, 'create-session', BODY).catch((x: unknown) => x);
    expect((e as BackendError).code).toBe('UNAUTHORIZED');
    expect(calls).toHaveLength(0);
  });

  it('2xx with a non-JSON body -> SERVER', async () => {
    const { fetchFn } = scripted([() => new Response('<html>', { status: 200 })]);
    const e = await invokeFunction(transport(fetchFn).t, 'get-session', {}).catch((x: unknown) => x);
    expect((e as BackendError).code).toBe('SERVER');
  });
});

describe('browser config: anon/publishable key only', () => {
  it('accepts an anon JWT and an sb_publishable_ key', () => {
    expect(() => assertBrowserSafeKey(ANON_KEY)).not.toThrow();
    expect(() => assertBrowserSafeKey('sb_publishable_abc123')).not.toThrow();
  });
  it('refuses privileged keys', () => {
    const privileged = fakeJwt({ role: ['service', 'role'].join('_'), iss: 'supabase' });
    expect(() => assertBrowserSafeKey(privileged)).toThrow(/privileged/);
    expect(() => assertBrowserSafeKey('sb_secret_abc123')).toThrow(/secret/);
    expect(() => readLiveConfig({ VITE_SUPABASE_URL: FAKE_URL, VITE_SUPABASE_ANON_KEY: privileged })).toThrow();
  });
  it('requires both URL and key; trims trailing slashes', () => {
    expect(() => readLiveConfig({})).toThrow(/not configured/);
    expect(readLiveConfig({ VITE_SUPABASE_URL: `${FAKE_URL}/`, VITE_SUPABASE_ANON_KEY: ANON_KEY }).url).toBe(FAKE_URL);
  });
  it('separate auth storage per station / dashboard', () => {
    expect(new Set([storageKeyFor('station_a'), storageKeyFor('station_b'), storageKeyFor(null)]).size).toBe(3);
  });
});
