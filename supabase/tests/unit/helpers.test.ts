import { describe, expect, it } from 'vitest';
import {
  createInitialState, prepareWithSeed, resolveWithSeed, buildSessionView,
} from '../../functions/_shared/game/index.ts';
import type { ActionRejection, GameState } from '../../functions/_shared/game/index.ts';
import { HTTP_STATUS, HttpError, errorBody, fromRejection, fromRpcEnvelope } from '../../functions/_shared/errors.ts';
import {
  jsonEqual, parseAdminReset, parseCreateSession, parseFinishSession, parseGetSession, parseJsonText, parsePrepareLeg,
  parseResolveLeg,
} from '../../functions/_shared/validation.ts';
import { redactView, redactResolution } from '../../functions/_shared/redact.ts';
import { generateSeed, sha256Hex } from '../../functions/_shared/crypto.ts';
import { corsHeaders } from '../../functions/_shared/cors.ts';

const SID = '6f1d2c3b-4a59-4e6f-8a7b-9c0d1e2f3a4b';
const ACT = 'a1b2c3d4-e5f6-4711-8899-aabbccddeeff';

function code(fn: () => unknown): string {
  try {
    fn();
  } catch (e) {
    if (e instanceof HttpError) return `${e.code}:${e.status}:${(e.details?.field as string) ?? ''}`;
    throw e;
  }
  return 'no-error';
}

describe('error mapping', () => {
  it('maps every engine ActionRejection to 409 (state conflict) or 422 (illegal input)', () => {
    const expected: Record<ActionRejection['code'], number> = {
      WRONG_PHASE: 409, STALE_REVISION: 409, SESSION_CLOSED: 409,
      ILLEGAL_STAMINA: 422, NO_EGG_TO_COLLECT: 422, INVALID_INPUT: 422,
    };
    for (const [c, status] of Object.entries(expected)) {
      expect(fromRejection({ code: c as ActionRejection['code'], message: 'x' }).status).toBe(status);
    }
  });
  it('attaches currentRevision to STALE_REVISION', () => {
    expect(fromRejection({ code: 'STALE_REVISION', message: 'x' }, 7).details).toEqual({ currentRevision: 7 });
  });
  it('maps RPC envelopes and hides unknown codes as INTERNAL', () => {
    const e = fromRpcEnvelope({ ok: false, error: 'STALE_REVISION', message: 'm', currentRevision: 3 });
    expect([e.code, e.status, e.details]).toEqual(['STALE_REVISION', 409, { currentRevision: 3 }]);
    expect(fromRpcEnvelope({ ok: false, error: 'SOMETHING_NEW', message: 'm' }).code).toBe('INTERNAL');
    expect(fromRpcEnvelope({ ok: false, error: 'RATE_LIMITED' }).status).toBe(429);
  });
  it('produces the documented error body', () => {
    expect(errorBody(new HttpError('SESSION_CLOSED', 'gone', { status: 'abandoned' }), 'req_12345678')).toEqual({
      error: { code: 'SESSION_CLOSED', message: 'gone', retryable: false, details: { status: 'abandoned' } },
      requestId: 'req_12345678',
    });
    expect(Object.values(HTTP_STATUS).every((s) => s >= 400 && s < 600)).toBe(true);
  });
});

describe('request validation', () => {
  it('sanitizes nicknames with the engine and keeps valid ids', () => {
    const out = parseCreateSession({ nickname: '  <b>Ann</b>   Lee ', characterId: 'eugene', pokemonId: 'gengar', actionId: ACT });
    expect(out.nickname).not.toMatch(/[<>]/);
    expect(out).toMatchObject({ characterId: 'eugene', pokemonId: 'gengar', actionId: ACT });
  });
  it('rejects unknown keys, bad ids, short nicknames and client-sent state', () => {
    const base = { nickname: 'Annie', characterId: 'enid', pokemonId: 'sableye', actionId: ACT };
    expect(code(() => parseCreateSession({ ...base, finalScore: 999 }))).toBe('INVALID_INPUT:422:finalScore');
    expect(code(() => parseCreateSession({ ...base, characterId: 'hyde' }))).toBe('INVALID_INPUT:422:characterId');
    expect(code(() => parseCreateSession({ ...base, pokemonId: 'pikachu' }))).toBe('INVALID_INPUT:422:pokemonId');
    expect(code(() => parseCreateSession({ ...base, nickname: '<>' }))).toBe('INVALID_INPUT:422:nickname');
    expect(code(() => parseCreateSession({ ...base, actionId: 'short' }))).toBe('INVALID_INPUT:422:actionId');
    expect(code(() => parseCreateSession([base]))).toBe('INVALID_INPUT:422:(body)');
    expect(code(() => parseCreateSession({ ...base, modelVersion: 'x y' }))).toBe('INVALID_INPUT:422:modelVersion');
  });
  it('validates prepare/resolve bodies strictly', () => {
    const ok = parsePrepareLeg({ sessionId: SID.toUpperCase(), expectedRevision: 0, route: 'shortcut', pushLevel: 3, actionId: ACT });
    expect(ok.sessionId).toBe(SID);
    for (const bad of [-1, 1.5, '2', 1001, null]) {
      expect(code(() => parsePrepareLeg({ sessionId: SID, expectedRevision: bad, route: 'safe', pushLevel: 1, actionId: ACT })))
        .toBe('INVALID_INPUT:422:expectedRevision');
    }
    expect(code(() => parsePrepareLeg({ sessionId: SID, expectedRevision: 0, route: 'safe', pushLevel: 4, actionId: ACT }))).toBe('INVALID_INPUT:422:pushLevel');
    expect(code(() => parsePrepareLeg({ sessionId: 'nope', expectedRevision: 0, route: 'safe', pushLevel: 1, actionId: ACT }))).toBe('INVALID_INPUT:422:sessionId');
    expect(code(() => parseResolveLeg({ sessionId: SID, expectedRevision: 1, eggDecision: 'steal', actionId: ACT }))).toBe('INVALID_INPUT:422:eggDecision');
    expect(code(() => parseResolveLeg({ sessionId: SID, expectedRevision: 1, eggDecision: 'skip', actionId: ACT, roll: 0.01 }))).toBe('INVALID_INPUT:422:roll');
  });
  it('validates finish, get and admin bodies', () => {
    expect(parseGetSession({})).toEqual({});
    expect(code(() => parseFinishSession({ sessionId: SID, actionId: ACT, reason: 'operator_reset' }))).toBe('INVALID_INPUT:422:reason');
    const admin = parseAdminReset({ stationId: 'station_b', reason: ' kid left\n<script>', actionId: ACT });
    expect(admin.reason).toBe('kid left script');
    expect(code(() => parseAdminReset({ stationId: 'station_c', reason: 'stuck', actionId: ACT }))).toBe('INVALID_INPUT:422:stationId');
  });
  it('parses JSON text defensively', () => {
    expect(parseJsonText('')).toEqual({});
    expect(code(() => parseJsonText('{bad'))).toBe('MALFORMED_JSON:400:');
  });
  it('compares receipts order-insensitively like jsonb', () => {
    expect(jsonEqual({ a: 1, b: [1, { c: 2 }] }, { b: [1, { c: 2 }], a: 1 })).toBe(true);
    expect(jsonEqual({ a: 1 }, { a: 1, b: 2 })).toBe(false);
    expect(jsonEqual({ a: 1, u: undefined }, { a: 1 })).toBe(true);
    expect(jsonEqual([1, 2], [2, 1])).toBe(false);
  });
});

describe('redaction', () => {
  function playOneLeg(seed: string): GameState {
    let s = createInitialState({ sessionId: SID, nickname: 'Annie', characterId: 'eugene', pokemonId: 'gengar' });
    const p = prepareWithSeed(s, seed, { route: 'shortcut', pushLevel: 1 }, s.revision);
    if (!p.ok) throw new Error(p.error.message);
    const r = resolveWithSeed(p.state, seed, 'skip', p.state.revision);
    if (!r.ok) throw new Error(r.error.message);
    s = r.state;
    return s;
  }
  it('strips draws and seed while in progress without mutating the engine view', () => {
    const seed = '0123456789abcdef0123456789abcdef';
    const state = playOneLeg(seed);
    const view = buildSessionView(state, seed, true, 'c'.repeat(64));
    const before = JSON.stringify(view);
    const red = redactView(view);
    expect(state.status).toBe('in_progress');
    expect(red.revealedSeed).toBeNull();
    expect(red.state.legResults.every((r) => r.draws === null)).toBe(true);
    expect(JSON.stringify(red)).not.toContain(seed);
    expect(JSON.stringify(view)).toBe(before);
    expect(redactResolution(state.legResults[0], true).draws).toBeNull();
  });
  it('reveals draws and seed once the session has ended', () => {
    const seed = 'fedcba9876543210fedcba9876543210';
    const ended: GameState = { ...playOneLeg(seed), status: 'abandoned', phase: 'complete' };
    const red = redactView(buildSessionView(ended, seed, true, null));
    expect(red.revealedSeed).toBe(seed);
    expect(red.state.legResults[0].draws).not.toBeNull();
  });
});

describe('seed + commitment', () => {
  it('generates 128-bit lowercase hex seeds', () => {
    const seeds = new Set(Array.from({ length: 200 }, generateSeed));
    expect(seeds.size).toBe(200);
    for (const s of seeds) expect(s).toMatch(/^[0-9a-f]{32}$/);
  });
  it('commits with SHA-256 hex (matches Postgres sha256 used by create_session_atomic)', async () => {
    expect(await sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
});

describe('cors', () => {
  it('allows any origin when no allow-list is set', () => {
    expect(corsHeaders('https://x.example', undefined)?.['Access-Control-Allow-Origin']).toBe('*');
  });
  it('pins origins when an allow-list is set', () => {
    expect(corsHeaders('https://kiosk.example', 'https://kiosk.example, https://dash.example')?.['Access-Control-Allow-Origin'])
      .toBe('https://kiosk.example');
    expect(corsHeaders('https://evil.example', 'https://kiosk.example')).toBeNull();
    expect(corsHeaders(null, 'https://kiosk.example')).not.toBeNull();
  });
});
