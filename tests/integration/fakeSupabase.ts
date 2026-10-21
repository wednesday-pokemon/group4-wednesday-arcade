// In-memory fake of the LIVE contract (docs/CLIENT_CONTRACT.md) for integration tests without a real project.
// Fidelity choices:
//  * Edge Functions run the REAL rules engine (createInitialState / prepareWithSeed / resolveWithSeed /
//    abandonSession / buildSessionView) and the REAL server modules for body validation, error envelopes and
//    redaction (supabase/functions/_shared/{validation,errors,redact}.ts), so unknown keys are rejected,
//    draws are null while in progress, and error bodies are byte-compatible.
//  * Idempotency receipts, revision checks, supersede, ownership (other station -> 404), operator reset and the
//    station_status / leaderboard_entries projections mirror session-flow.ts and the SQL RPCs.
//  * Auth (/auth/v1) and PostgREST (/rest/v1) are served to the REAL supabase-js client through a custom fetch.
//  * Realtime is a fake channel host (postgres_changes only) with pause/flush for out-of-order delivery.
import {
  abandonSession, buildSessionView, createInitialState, getPushOptions, prepareWithSeed, resolveWithSeed,
} from '../../src/game/index.ts';
import type { GameState, LegResolution, PushLevel, RouteId, SessionView, StationId } from '../../src/game/index.ts';
import { sha256Hex } from '../../src/game/sha256.ts';
import { HttpError, errorBody, fromRejection } from '../../supabase/functions/_shared/errors.ts';
import { redactResolution, redactView } from '../../supabase/functions/_shared/redact.ts';
import {
  jsonEqual, parseAdminReset, parseCreateSession, parseFinishSession, parseGetSession, parseJsonText, parsePrepareLeg,
  parseResolveLeg,
} from '../../supabase/functions/_shared/validation.ts';
import type { GameBackend } from '../../src/lib/backend.ts';
import { createSupabase, type LiveConfig } from '../../src/lib/supabase/client.ts';
import { buildLiveServices } from '../../src/lib/supabase/liveServices.ts';
import type { OnlineSource, RealtimeHost } from '../../src/lib/supabase/realtime.ts';

// ------------------------------------------------------------------------------------------------
// helpers

function b64url(obj: unknown): string {
  return Buffer.from(JSON.stringify(obj)).toString('base64url');
}

export function fakeJwt(payload: Record<string, unknown>): string {
  return `${b64url({ alg: 'HS256', typ: 'JWT' })}.${b64url(payload)}.c2ln`;
}

export const FAKE_URL = 'https://fakeproject.supabase.co';
export const ANON_KEY = fakeJwt({ iss: 'supabase', ref: 'fakeproject', role: 'anon', iat: 1, exp: 4102444800 });
export const CONFIG: LiveConfig = { url: FAKE_URL, anonKey: ANON_KEY };

export function memoryStorage() {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
    keys: () => [...m.keys()],
  };
}

export function fakeOnline(initial = true): OnlineSource & { set(v: boolean): void } {
  let value = initial;
  const listeners = new Set<(v: boolean) => void>();
  return {
    isOnline: () => value,
    subscribe(l) {
      listeners.add(l);
      return () => void listeners.delete(l);
    },
    set(v) {
      value = v;
      listeners.forEach((l) => l(v));
    },
  };
}

/** Lets pending promise chains / zero-delay timers run (real timers only). */
export async function settle(rounds = 25): Promise<void> {
  for (let i = 0; i < rounds; i++) await new Promise((r) => setTimeout(r, 0));
}

function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

function wire<T>(x: T): T {
  return JSON.parse(JSON.stringify(x)) as T;
}

// ------------------------------------------------------------------------------------------------
// Realtime fake

type Binding = { filter: { event: string; schema: string; table: string; filter?: string }; cb: (payload: unknown) => void };

export class FakeChannel {
  readonly bindings: Binding[] = [];
  statusCb: ((status: string) => void) | null = null;
  subscribed = false;
  removed = false;
  constructor(readonly topic: string, private readonly hub: FakeRealtime) {}
  on(_type: string, filter: Binding['filter'], cb: (payload: unknown) => void): this {
    this.bindings.push({ filter, cb });
    return this;
  }
  subscribe(cb: (status: string) => void): this {
    this.statusCb = cb;
    if (this.hub.autoSubscribe) queueMicrotask(() => !this.removed && this.status('SUBSCRIBED'));
    return this;
  }
  status(s: string): void {
    this.subscribed = s === 'SUBSCRIBED';
    this.statusCb?.(s);
  }
  deliver(table: string, eventType: string, row: Record<string, unknown>, old: Record<string, unknown>): void {
    if (!this.subscribed || this.removed) return;
    for (const b of this.bindings) {
      if (b.filter.table !== table || (b.filter.event !== '*' && b.filter.event !== eventType)) continue;
      if (b.filter.filter) {
        const m = /^(\w+)=eq\.(.+)$/.exec(b.filter.filter);
        if (m && String((eventType === 'DELETE' ? old : row)[m[1]]) !== m[2]) continue;
      }
      b.cb({ schema: 'public', table, commit_timestamp: new Date().toISOString(), eventType, new: wire(row), old: wire(old), errors: null });
    }
  }
}

type QueuedEvent = { table: string; eventType: string; row: Record<string, unknown>; old: Record<string, unknown> };

export class FakeRealtime {
  readonly channels: FakeChannel[] = [];
  autoSubscribe = true;
  paused = false;
  readonly queue: QueuedEvent[] = [];
  readonly log: QueuedEvent[] = [];

  channel(topic: string): FakeChannel {
    const ch = new FakeChannel(topic, this);
    this.channels.push(ch);
    return ch;
  }
  async removeChannel(ch: FakeChannel): Promise<'ok'> {
    if (!ch.removed) {
      ch.removed = true;
      ch.status('CLOSED');
    }
    return 'ok';
  }
  active(): FakeChannel[] {
    return this.channels.filter((c) => !c.removed);
  }
  emit(table: string, eventType: string, row: Record<string, unknown>, old: Record<string, unknown> = {}): void {
    const ev = { table, eventType, row: wire(row), old: wire(old) };
    this.log.push(ev);
    if (this.paused) this.queue.push(ev);
    else this.deliver(ev);
  }
  deliver(ev: QueuedEvent): void {
    for (const ch of this.active()) ch.deliver(ev.table, ev.eventType, ev.row, ev.old);
  }
  /** Delivers the queued events, optionally reversed and/or each twice (duplicates). */
  flush(opts: { reverse?: boolean; duplicate?: boolean } = {}): void {
    const events = this.queue.splice(0);
    const ordered = opts.reverse ? events.reverse() : events;
    for (const ev of ordered) {
      this.deliver(ev);
      if (opts.duplicate) this.deliver(ev);
    }
    this.paused = false;
  }
  setStatus(status: 'SUBSCRIBED' | 'CHANNEL_ERROR' | 'TIMED_OUT' | 'CLOSED'): void {
    for (const ch of this.active()) ch.status(status);
  }
  asHost(): RealtimeHost {
    return this as unknown as RealtimeHost;
  }
}

// ------------------------------------------------------------------------------------------------
// Server fake

export interface FakeUser {
  id: string;
  email: string;
  password: string;
  role: 'station' | 'operator' | null; // null = Auth user without app_users row
  stationId: StationId | null;
}

interface ServerSession {
  id: string;
  stationId: StationId;
  state: GameState;
  seed: string;
  commitment: string;
  abandonedReason: 'player_reset' | 'operator_reset' | 'superseded' | null;
  createdAt: string;
  completedAt: string | null;
  verifiedAt: string | null;
  receipts: Map<string, { type: string; body: unknown; response: unknown }>;
}

export type Fault =
  | { fn: string; kind: 'network-before' }
  | { fn: string; kind: 'network-after' }
  | { fn: string; kind: 'internal' }
  | { fn: string; kind: 'hang' }
  | { fn: string; kind: 'raw'; status: number; body?: unknown };

export interface LoggedRequest {
  fn: string;
  body: Record<string, unknown>;
  authorization: string | null;
  apikey: string | null;
  requestId: string | null;
}

type Caller = { userId: string; role: 'station' | 'operator'; stationId: StationId | null };

const LABELS: Record<StationId, string> = { station_a: 'Station A', station_b: 'Station B' };

export class FakeSupabaseServer {
  readonly realtime = new FakeRealtime();
  readonly users: FakeUser[] = [];
  readonly sessions = new Map<string, ServerSession>();
  readonly stationRows = new Map<StationId, Record<string, unknown>>();
  readonly entries = new Map<string, Record<string, unknown>>();
  readonly requests: LoggedRequest[] = [];
  readonly restRequests: string[] = [];
  readonly faults: Fault[] = [];
  readonly createReceipts = new Map<string, { body: unknown; response: unknown; sessionId: string }>();
  readonly tokens = new Map<string, string>(); // access token -> user id
  readonly refreshTokens = new Map<string, string>();
  restFailures = 0;
  private clock = Date.parse('2026-10-31T18:00:00.000Z');
  private tokenCounter = 0;

  constructor() {
    for (const id of ['station_a', 'station_b'] as const) this.stationRows.set(id, this.idleRow(id, null, 0));
    this.addUser({ id: '00000000-0000-4000-8000-00000000000a', email: 'station-a@regatta.test', password: 'pw-A-123456789', role: 'station', stationId: 'station_a' });
    this.addUser({ id: '00000000-0000-4000-8000-00000000000b', email: 'station-b@regatta.test', password: 'pw-B-123456789', role: 'station', stationId: 'station_b' });
    this.addUser({ id: '00000000-0000-4000-8000-0000000000ff', email: 'ops@regatta.test', password: 'pw-O-123456789', role: 'operator', stationId: null });
    this.addUser({ id: '00000000-0000-4000-8000-0000000000ee', email: 'nobody@regatta.test', password: 'pw-N-123456789', role: null, stationId: null });
  }

  addUser(u: FakeUser): void {
    this.users.push(u);
  }

  tick(): string {
    this.clock += 1000;
    return new Date(this.clock).toISOString();
  }

  /** Invalidates every issued access token (simulates expiry); refresh tokens keep working. */
  expireAccessTokens(): void {
    this.tokens.clear();
  }

  functionCalls(fn?: string): LoggedRequest[] {
    return fn ? this.requests.filter((r) => r.fn === fn) : this.requests;
  }

  sessionsOf(stationId: StationId): ServerSession[] {
    return [...this.sessions.values()].filter((s) => s.stationId === stationId);
  }

  // ---------------------------------------------------------------- projections
  private idleRow(stationId: StationId, notice: string | null, revision: number): Record<string, unknown> {
    return {
      station_id: stationId, label: LABELS[stationId], session_id: null, nickname: null, character_id: null, pokemon_id: null,
      status: 'idle', phase: null, leg_index: null, route: null, push_level: null, weather: null, hp: null, stamina: null,
      gap_m: null, catches: null, banked_eggs: null, sim_time_cs: null, final_score: null, notice, revision,
      updated_at: new Date(this.clock).toISOString(),
    };
  }

  private project(s: ServerSession): void {
    const st = s.state;
    const row = {
      station_id: s.stationId, label: LABELS[s.stationId], session_id: s.id, nickname: st.nickname,
      character_id: st.characterId, pokemon_id: st.pokemonId, status: st.status, phase: st.phase, leg_index: st.legIndex,
      route: st.prepared?.route ?? null, push_level: st.prepared?.pushLevel ?? null, weather: st.prepared?.weather ?? null,
      hp: Math.max(0, Math.min(100, st.hp)), stamina: st.stamina, gap_m: st.pursuitGapM, catches: st.hydeCatchCount,
      banked_eggs: st.bankedEggPoints, sim_time_cs: st.totalSimulatedTimeCs,
      final_score: st.finalScore === null ? null : st.finalScore.toFixed(2), // numeric arrives as a string
      notice: null, revision: st.revision, updated_at: this.tick(),
    };
    this.stationRows.set(s.stationId, row);
    this.realtime.emit('station_status', 'UPDATE', row);
  }

  private clearStation(stationId: StationId, notice: string | null): void {
    const prev = this.stationRows.get(stationId)!;
    this.tick();
    const row = this.idleRow(stationId, notice, Number(prev.revision) + 1);
    this.stationRows.set(stationId, row);
    this.realtime.emit('station_status', 'UPDATE', row);
  }

  private publish(s: ServerSession): void {
    if (this.entries.has(s.id)) return; // ON CONFLICT DO NOTHING
    const st = s.state;
    const lastLeg = st.legResults[st.legResults.length - 1];
    const entry = {
      session_id: s.id, nickname: st.nickname, station_id: s.stationId, character_id: st.characterId, pokemon_id: st.pokemonId,
      status: st.status, final_egg_points: st.status === 'completed' ? st.finalEggPoints ?? 0 : 0,
      total_simulated_time_cs: st.totalSimulatedTimeCs,
      final_score: (st.status === 'completed' ? st.finalScore ?? 0 : 0).toFixed(2),
      dnf_reason: st.dnfReason, dnf_leg: st.status === 'dnf' ? lastLeg?.legIndex ?? null : null, rules_version: st.rulesVersion,
      verified_at: s.verifiedAt,
    };
    this.entries.set(s.id, entry);
    this.realtime.emit('leaderboard_entries', 'INSERT', entry);
  }

  /** Operator nickname moderation (manual SQL delete in production). */
  moderateDelete(sessionId: string): void {
    const entry = this.entries.get(sessionId);
    if (!entry) return;
    this.entries.delete(sessionId);
    this.realtime.emit('leaderboard_entries', 'DELETE', {}, { session_id: sessionId });
  }

  // ---------------------------------------------------------------- envelopes
  private envelope(s: ServerSession, resolution?: LegResolution): Record<string, unknown> {
    const view = redactView(buildSessionView(s.state, s.seed, true, s.commitment) as never);
    const out: Record<string, unknown> = {
      view,
      meta: { sessionId: s.id, stationId: s.stationId, status: s.state.status, abandonedReason: s.abandonedReason },
    };
    if (resolution) out.resolution = redactResolution(resolution as never, s.state.status === 'in_progress');
    return wire(out);
  }

  private load(sessionId: string, scope: StationId | null): ServerSession {
    const s = this.sessions.get(sessionId);
    if (!s || (scope !== null && s.stationId !== scope)) throw new HttpError('SESSION_NOT_FOUND', 'Session not found');
    return s;
  }

  private transition(
    scope: StationId | null, sessionId: string, actionId: string, type: 'prepare' | 'resolve' | 'abandon',
    body: Record<string, unknown>, abandonReason: 'player_reset' | 'operator_reset' | null,
    compute: (state: GameState, seed: string) => { ok: true; state: GameState; resolution?: LegResolution } | { ok: false; error: { code: string; message: string } },
  ): { body: unknown; replay: boolean } {
    const s = this.load(sessionId, scope);
    const receipt = s.receipts.get(actionId);
    if (receipt) {
      if (receipt.type !== type || !jsonEqual(receipt.body, body)) {
        throw new HttpError('ACTION_ID_CONFLICT', 'actionId was already used for a different request');
      }
      return { body: receipt.response, replay: true };
    }
    if (s.state.status !== 'in_progress') {
      throw new HttpError('SESSION_CLOSED', `Session is ${s.state.status}`, { status: s.state.status, abandonedReason: s.abandonedReason });
    }
    const result = compute(s.state, s.seed);
    if (!result.ok) throw fromRejection(result.error as never, s.state.revision);
    if (result.state.revision <= s.state.revision) throw new HttpError('INVALID_TRANSITION', 'revision must increase');
    s.state = result.state;
    if (s.state.status === 'abandoned') s.abandonedReason = abandonReason;
    if (s.state.status === 'completed' || s.state.status === 'dnf') {
      s.completedAt = this.tick();
      s.verifiedAt = s.completedAt;
    }
    const response = this.envelope(s, result.resolution);
    s.receipts.set(actionId, { type, body: wire(body), response });
    // projections (commit_session_transition)
    const row = this.stationRows.get(s.stationId)!;
    if (s.state.status === 'abandoned') {
      if (row.session_id === s.id) this.clearStation(s.stationId, abandonReason);
    } else {
      this.project(s);
    }
    if (s.state.status === 'completed' || s.state.status === 'dnf') this.publish(s);
    return { body: response, replay: false };
  }

  // ---------------------------------------------------------------- identity
  private caller(authorization: string | null): Caller {
    const m = /^Bearer\s+(.+)$/.exec(authorization ?? '');
    const userId = m ? this.tokens.get(m[1]) : undefined;
    if (!userId) throw new HttpError('UNAUTHENTICATED', 'Invalid or expired session; sign in again');
    const user = this.users.find((u) => u.id === userId)!;
    if (!user.role) throw new HttpError('NOT_PROVISIONED', 'This account is not provisioned for the regatta');
    return { userId, role: user.role, stationId: user.stationId };
  }

  private requireStation(c: Caller): StationId {
    if (c.role !== 'station' || !c.stationId) throw new HttpError('FORBIDDEN_ROLE', 'Only station terminal accounts can do this');
    return c.stationId;
  }

  // ---------------------------------------------------------------- functions
  private handle(fn: string, raw: unknown, c: Caller): { status?: number; body: unknown; replay?: boolean } {
    switch (fn) {
      case 'create-session': {
        const stationId = this.requireStation(c);
        const body = parseCreateSession(raw);
        const key = `${stationId}:${body.actionId}`;
        const prior = this.createReceipts.get(key);
        if (prior) {
          if (!jsonEqual(prior.body, body)) throw new HttpError('ACTION_ID_CONFLICT', 'actionId was already used for a different request');
          return { status: 200, body: prior.response, replay: true };
        }
        for (const s of this.sessionsOf(stationId)) {
          if (s.state.status === 'in_progress') {
            s.state = abandonSession(s.state);
            s.abandonedReason = 'superseded';
          }
        }
        const id = crypto.randomUUID();
        const seed = Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('');
        const s: ServerSession = {
          id, stationId, state: createInitialState({ sessionId: id, nickname: body.nickname, characterId: body.characterId, pokemonId: body.pokemonId }),
          seed, commitment: sha256Hex(seed), abandonedReason: null, createdAt: this.tick(), completedAt: null, verifiedAt: null,
          receipts: new Map(),
        };
        this.sessions.set(id, s);
        const response = this.envelope(s);
        this.createReceipts.set(key, { body: wire(body), response, sessionId: id });
        this.project(s);
        return { status: 201, body: response };
      }
      case 'get-session': {
        const stationId = this.requireStation(c);
        const body = parseGetSession(raw);
        const row = this.stationRows.get(stationId)!;
        const station = { stationId, label: row.label, status: row.status, notice: row.notice };
        const sessionId = body.sessionId ?? (row.session_id as string | null);
        if (!sessionId) return { body: { view: null, meta: null, station } };
        const s = this.load(sessionId, stationId);
        const env = this.envelope(s);
        return {
          body: { ...env, meta: { ...(env.meta as object), createdAt: s.createdAt, completedAt: s.completedAt, verifiedAt: s.verifiedAt }, station },
        };
      }
      case 'prepare-leg': {
        const stationId = this.requireStation(c);
        const body = parsePrepareLeg(raw);
        return this.transition(stationId, body.sessionId, body.actionId, 'prepare', { ...body }, null, (state, seed) =>
          prepareWithSeed(state, seed, { route: body.route, pushLevel: body.pushLevel }, body.expectedRevision));
      }
      case 'resolve-leg': {
        const stationId = this.requireStation(c);
        const body = parseResolveLeg(raw);
        return this.transition(stationId, body.sessionId, body.actionId, 'resolve', { ...body }, null, (state, seed) =>
          resolveWithSeed(state, seed, body.eggDecision, body.expectedRevision));
      }
      case 'finish-session': {
        const stationId = this.requireStation(c);
        const body = parseFinishSession(raw);
        const s = this.load(body.sessionId, stationId);
        if (s.state.status === 'in_progress' || s.receipts.has(body.actionId)) {
          return this.transition(stationId, body.sessionId, body.actionId, 'abandon', { ...body }, 'player_reset', (state) => ({
            ok: true, state: abandonSession(state),
          }));
        }
        let released = false;
        if ((s.state.status === 'completed' || s.state.status === 'dnf') && this.stationRows.get(stationId)!.session_id === s.id) {
          this.clearStation(stationId, null);
          released = true;
        }
        return { body: { ...this.envelope(s), released } };
      }
      case 'admin-reset': {
        if (c.role !== 'operator') throw new HttpError('FORBIDDEN_ROLE', 'Only operator accounts can do this');
        const body = parseAdminReset(raw);
        const abandoned: string[] = [];
        for (const s of this.sessionsOf(body.stationId)) {
          if (s.state.status !== 'in_progress') continue;
          this.transition(null, s.id, body.actionId, 'abandon', { ...body }, 'operator_reset', (state) => ({ ok: true, state: abandonSession(state) }));
          abandoned.push(s.id);
        }
        this.clearStation(body.stationId, 'operator_reset');
        return { body: { stationId: body.stationId, abandonedSessionIds: abandoned, notice: 'operator_reset' } };
      }
      default:
        throw new HttpError('METHOD_NOT_ALLOWED', 'Unknown function');
    }
  }

  private async functions(fn: string, init: RequestInit | undefined, headers: Headers): Promise<Response> {
    const text = typeof init?.body === 'string' ? init.body : '';
    let logged: Record<string, unknown> = {};
    try {
      logged = JSON.parse(text) as Record<string, unknown>;
    } catch {
      logged = {};
    }
    this.requests.push({
      fn, body: logged, authorization: headers.get('authorization'), apikey: headers.get('apikey'), requestId: headers.get('x-request-id'),
    });
    const faultIndex = this.faults.findIndex((f) => f.fn === fn);
    const fault = faultIndex >= 0 ? this.faults.splice(faultIndex, 1)[0] : null;
    if (fault?.kind === 'network-before') throw new TypeError('fetch failed');
    if (fault?.kind === 'internal') return json(500, errorBody(new HttpError('INTERNAL', 'Unexpected server error'), 'req-internal-0001'));
    if (fault?.kind === 'raw') return json(fault.status, fault.body);
    if (fault?.kind === 'hang') {
      return new Promise<Response>((_, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('The operation was aborted.', 'AbortError')));
      });
    }
    const requestId = headers.get('x-request-id') ?? 'req-generated-0001';
    let response: Response;
    try {
      const caller = this.caller(headers.get('authorization'));
      const result = this.handle(fn, parseJsonText(text), caller);
      response = json(result.status ?? 200, result.body, { 'x-request-id': requestId, ...(result.replay ? { 'x-idempotent-replay': 'true' } : {}) });
    } catch (err) {
      const e = err instanceof HttpError ? err : new HttpError('INTERNAL', 'Unexpected server error');
      response = json(e.status, errorBody(e, requestId), { 'x-request-id': requestId });
    }
    if (fault?.kind === 'network-after') throw new TypeError('fetch failed'); // committed, but the answer is lost
    return response;
  }

  // ---------------------------------------------------------------- auth
  private issue(userId: string) {
    const n = ++this.tokenCounter;
    const access = fakeJwt({ sub: userId, role: 'authenticated', aud: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600, n });
    const refresh = `refresh-${n}-${userId}`;
    this.tokens.set(access, userId);
    this.refreshTokens.set(refresh, userId);
    const user = this.users.find((u) => u.id === userId)!;
    return {
      access_token: access, token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: refresh,
      user: {
        id: userId, aud: 'authenticated', role: 'authenticated', email: user.email, app_metadata: { provider: 'email' }, user_metadata: {},
        created_at: '2026-10-01T00:00:00Z',
      },
    };
  }

  private auth(url: URL, init: RequestInit | undefined, headers: Headers): Response {
    const body = typeof init?.body === 'string' && init.body ? (JSON.parse(init.body) as Record<string, unknown>) : {};
    if (url.pathname === '/auth/v1/token' && url.searchParams.get('grant_type') === 'password') {
      const user = this.users.find((u) => u.email === body.email && u.password === body.password);
      if (!user) return json(400, { code: 400, error_code: 'invalid_credentials', msg: 'Invalid login credentials' });
      return json(200, this.issue(user.id));
    }
    if (url.pathname === '/auth/v1/token' && url.searchParams.get('grant_type') === 'refresh_token') {
      const userId = this.refreshTokens.get(String(body.refresh_token));
      if (!userId) return json(400, { code: 400, error_code: 'refresh_token_not_found', msg: 'Invalid Refresh Token' });
      return json(200, this.issue(userId));
    }
    if (url.pathname === '/auth/v1/logout') {
      const m = /^Bearer\s+(.+)$/.exec(headers.get('authorization') ?? '');
      if (m) this.tokens.delete(m[1]);
      return new Response(null, { status: 204 });
    }
    if (url.pathname === '/auth/v1/user') {
      const m = /^Bearer\s+(.+)$/.exec(headers.get('authorization') ?? '');
      const userId = m ? this.tokens.get(m[1]) : undefined;
      if (!userId) return json(401, { code: 401, msg: 'invalid JWT' });
      return json(200, this.issue(userId).user);
    }
    return json(404, { msg: 'not found' });
  }

  // ---------------------------------------------------------------- PostgREST
  private rest(url: URL, headers: Headers): Response {
    const table = url.pathname.replace('/rest/v1/', '');
    this.restRequests.push(table);
    if (this.restFailures > 0) {
      this.restFailures--;
      return json(503, { message: 'upstream unavailable' });
    }
    let rows: Record<string, unknown>[];
    if (table === 'app_users') {
      const m = /^Bearer\s+(.+)$/.exec(headers.get('authorization') ?? '');
      const userId = m ? this.tokens.get(m[1]) : undefined; // anon key -> no user -> RLS returns nothing
      const user = userId ? this.users.find((u) => u.id === userId) : undefined;
      rows = user?.role ? [{ role: user.role, station_id: user.stationId }] : [];
    } else if (table === 'station_status') {
      rows = [...this.stationRows.values()];
    } else if (table === 'verified_leaderboard') {
      const completed = [...this.entries.values()].filter((e) => e.status === 'completed');
      completed.sort((a, b) =>
        Number(b.final_score) - Number(a.final_score) || Number(b.final_egg_points) - Number(a.final_egg_points)
        || Number(a.total_simulated_time_cs) - Number(b.total_simulated_time_cs)
        || String(a.verified_at).localeCompare(String(b.verified_at)) || String(a.session_id).localeCompare(String(b.session_id)));
      rows = completed.map((e, i) => {
        const { status: _s, dnf_reason: _r, dnf_leg: _l, ...rest } = e;
        return { rank: i + 1, ...rest, final_score: Number(e.final_score) }; // PostgREST: numeric as JSON number
      });
    } else if (table === 'defeated_log') {
      rows = [...this.entries.values()].filter((e) => e.status === 'dnf')
        .sort((a, b) => String(b.verified_at).localeCompare(String(a.verified_at)))
        .map(({ status: _s, final_egg_points: _e, final_score: _f, ...rest }) => rest);
    } else {
      return json(404, { code: '42P01', message: `relation "${table}" does not exist` });
    }
    for (const [key, value] of url.searchParams) {
      const m = /^eq\.(.+)$/.exec(value);
      if (m && !['select', 'order', 'limit'].includes(key)) rows = rows.filter((r) => String(r[key]) === m[1]);
    }
    const limit = Number(url.searchParams.get('limit') ?? 'NaN');
    if (Number.isFinite(limit)) rows = rows.slice(0, limit);
    return json(200, wire(rows));
  }

  readonly fetch: typeof fetch = async (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
    if (url.origin !== FAKE_URL) throw new TypeError(`unexpected origin ${url.origin}`);
    if (url.pathname.startsWith('/functions/v1/')) return this.functions(url.pathname.slice('/functions/v1/'.length), init, headers);
    if (url.pathname.startsWith('/auth/v1/')) return this.auth(url, init, headers);
    if (url.pathname.startsWith('/rest/v1/')) return this.rest(url, headers);
    throw new TypeError(`unexpected path ${url.pathname}`);
  };
}

// ------------------------------------------------------------------------------------------------
// Wiring the real adapter to the fake

export interface Page {
  services: ReturnType<typeof buildLiveServices>;
  online: ReturnType<typeof fakeOnline>;
  storage: ReturnType<typeof memoryStorage>;
}

export function openPage(
  server: FakeSupabaseServer,
  stationId: StationId | null,
  opts: { timeoutMs?: number; storage?: ReturnType<typeof memoryStorage>; sleeps?: number[]; dashboardPollMs?: number } = {},
): Page {
  const storage = opts.storage ?? memoryStorage();
  const online = fakeOnline(true);
  const client = createSupabase(CONFIG, stationId, { fetch: server.fetch, storage, autoRefreshToken: false });
  const services = buildLiveServices({
    stationId, config: CONFIG, client, realtime: server.realtime.asHost(), fetch: server.fetch, online,
    transport: { timeoutMs: opts.timeoutMs ?? 2000, sleep: async (ms) => void opts.sleeps?.push(ms) },
    dashboardPollMs: opts.dashboardPollMs ?? 60_000,
  });
  return { services, online, storage };
}

export function stationCredentials(stationId: StationId): { email: string; password: string } {
  return stationId === 'station_a'
    ? { email: 'station-a@regatta.test', password: 'pw-A-123456789' }
    : { email: 'station-b@regatta.test', password: 'pw-B-123456789' };
}
export const OPERATOR = { email: 'ops@regatta.test', password: 'pw-O-123456789' };

/** Deterministic tiny PRNG for test choices (not game randomness). */
export function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

/** Plays one full race through a GameBackend with legal (randomly chosen) decisions; returns every view. */
export async function playRace(
  backend: GameBackend,
  nickname: string,
  rand: () => number,
  onStep?: (view: SessionView, resolution?: LegResolution) => void | Promise<void>,
): Promise<{ views: SessionView[]; resolutions: LegResolution[] }> {
  const views: SessionView[] = [];
  const resolutions: LegResolution[] = [];
  let view = await backend.createSession({ nickname, characterId: 'eugene', pokemonId: 'gengar' });
  views.push(view);
  await onStep?.(view);
  while (view.state.status === 'in_progress') {
    const route: RouteId = rand() < 0.5 ? 'safe' : 'shortcut';
    const legal = getPushOptions(view.state).filter((o) => o.isLegal);
    const pushLevel: PushLevel = legal[Math.floor(rand() * legal.length)].pushLevel;
    view = await backend.prepareLeg({ sessionId: view.state.sessionId, expectedRevision: view.state.revision, route, pushLevel, actionId: crypto.randomUUID() });
    views.push(view);
    await onStep?.(view);
    const offer = view.leg?.visibleOffers[route] ?? 'none';
    const eggDecision = offer !== 'none' && rand() < 0.8 ? 'collect' : 'skip';
    const res = await backend.resolveLeg({
      sessionId: view.state.sessionId, expectedRevision: view.state.revision, actionId: crypto.randomUUID(), eggDecision,
      advisory: { predictedLegTimeS: 42, predictedCatchP: 0.1, advice: null },
    });
    view = res.view;
    views.push(view);
    resolutions.push(res.resolution);
    await onStep?.(view, res.resolution);
  }
  return { views, resolutions };
}

