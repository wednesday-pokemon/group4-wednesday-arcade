// In-memory fake of the LIVE contract (docs/CLIENT_CONTRACT.md) for integration tests without a real project.
// Fidelity choices:
//  * Edge Functions run the REAL rules engine (createInitialState / prepareWithSeed / resolveWithSeed /
//    abandonSession / buildSessionView) and the REAL server modules for body validation, error envelopes and
//    redaction (supabase/functions/_shared/{validation,errors,redact}.ts), so unknown keys are rejected,
//    draws are null while in progress, and error bodies are byte-compatible.
//  * Idempotency receipts, revision checks, supersede, ownership (other station -> 404), operator reset and the
//    station_status / leaderboard_entries projections mirror session-flow.ts and the SQL RPCs.
//  * Auth (/auth/v1) and PostgREST (/rest/v1) are served to the REAL supabase-js client through a custom fetch.
//  * Realtime is a fake channel host (postgres_changes + broadcast) with pause/flush for out-of-order delivery.
//  * mystery-v3.1: the five mystery-* functions run the REAL server modules (supabase/functions/_shared/
//    mystery-{validation,events,rules}.ts + the synced shared draftOffer / scoring / caseLogic) exactly in the order
//    of supabase/functions/mystery-*/index.ts; the SQL RPC semantics (idempotent create receipts, rate limit,
//    supersede, select-from-offer, optimistic last_seq, fill-only recommendations, one immutable result, operator
//    reset with `scope`) and the RLS read rules (public status/results/views; events/offers/forecasts/advice own
//    station or operator; test runs hidden) are mirrored from migrations 20261021000500..800.
//  * three cases (migration 20261022000100): case drawn per station from a shuffled bag inside create (same algorithm
//    as private.mystery_draw_case, seeded RNG so tests are reproducible; `nextMysteryCases` forces the next draws),
//    replay keeps the case, the session's case decides clue ids + answer key, finalize returns `reveal`, and the
//    column privileges are mirrored: anon / station reads of mystery_results can never select accused, evidence or
//    client_claim (42501, like PostgREST), Realtime payloads drop those columns, operators read them through
//    mystery_result_audit.
import {
  abandonSession, buildSessionView, createInitialState, getPushOptions, prepareWithSeed, resolveWithSeed,
} from '../../src/game/index.ts';
import type { GameState, LegResolution, PushLevel, RouteId, SessionView, StationId } from '../../src/game/index.ts';
import { sha256Hex } from '../../src/game/sha256.ts';
import { HttpError, errorBody, fromRejection } from '../../supabase/functions/_shared/errors.ts';
import { redactResolution, redactView } from '../../supabase/functions/_shared/redact.ts';
import {
  MAX_BODY_BYTES, jsonEqual, parseAdminReset, parseCreateSession, parseFinishSession, parseGetSession, parseJsonText,
  parsePrepareLeg, parseResolveLeg,
} from '../../supabase/functions/_shared/validation.ts';
import {
  MAX_APPEND_BYTES, MAX_FINALIZE_BYTES, parseMysteryAppend, parseMysteryCreate, parseMysteryFinalize, parseMysteryGet,
  parseMysterySelect,
} from '../../supabase/functions/_shared/mystery-validation.ts';
import {
  RULE_EVENT_TYPES, applyBatch, initialProgress, progressFromRow, progressSummary, ruleFingerprint, splitResend,
  type ParsedEvent,
} from '../../supabase/functions/_shared/mystery-events.ts';
import {
  caseReveal, caseVersions, computeOffer, computeResult, drawCulprit, requireData, requireEggRules, resolveCase, revealedClues, rulesContext,
} from '../../supabase/functions/_shared/mystery-rules.ts';
import { fromRpcEnvelope } from '../../supabase/functions/_shared/errors.ts';
import { buildMysteryBoardServices, buildMysteryStationServices } from '../../src/lib/supabase/mysteryLive.ts';
import type { Timers } from '../../src/lib/supabase/mysterySync.ts';
import type { LiveController } from '../../src/app/mystery/liveRun.ts';
import { createMysteryAnalytics, type MysteryAnalytics } from '../../src/mystery/analytics/index.ts';
import { Bot } from '../../src/mystery/bot.ts';
import { MysteryRun } from '../../src/mystery/run.ts';
import { caseById } from '../../src/mystery/data/cases.ts';
import { caseSolution } from '../../src/mystery/data/solutions.ts';
import { provisionalCulprit, sessionCaseDef } from '../../src/mystery/caseVariant.ts';
import { CASE_IDS, MYSTERY_RULES_VERSION, type MysteryRulesVersion } from '../../src/mystery/types.ts';
import { scoreV4 } from '../../src/mystery/scoring.ts';
import type { Accusation, CaseId, Duo, DuoCard, SuspectId } from '../../src/mystery/types.ts';
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

type Binding = { type: string; filter: { event: string; schema?: string; table?: string; filter?: string }; cb: (payload: unknown) => void };

export class FakeChannel {
  readonly bindings: Binding[] = [];
  statusCb: ((status: string) => void) | null = null;
  subscribed = false;
  removed = false;
  constructor(readonly topic: string, private readonly hub: FakeRealtime) {}
  on(type: string, filter: Binding['filter'], cb: (payload: unknown) => void): this {
    this.bindings.push({ type, filter, cb });
    return this;
  }
  /** Broadcast to every OTHER joined channel with the same topic (config broadcast.self = false). */
  async send(msg: { type: string; event: string; payload: unknown }): Promise<'ok' | 'error'> {
    if (msg.type !== 'broadcast' || !this.subscribed || this.removed) return 'error';
    this.hub.broadcasts.push({ topic: this.topic, event: msg.event, payload: wire(msg.payload) });
    for (const ch of this.hub.active()) {
      if (ch === this || ch.topic !== this.topic || !ch.subscribed) continue;
      for (const b of ch.bindings) {
        if (b.type === 'broadcast' && b.filter.event === msg.event) b.cb({ type: 'broadcast', event: msg.event, payload: wire(msg.payload) });
      }
    }
    return 'ok';
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
      if (b.type !== 'postgres_changes') continue;
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
  readonly broadcasts: { topic: string; event: string; payload: unknown }[] = [];

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

/** mystery_sessions row (snake_case, as the SQL table). */
export interface FakeMysterySession {
  id: string;
  station_id: StationId;
  rules_version: MysteryRulesVersion;
  create_action_id: string;
  create_body: unknown;
  seed: string;
  is_test: boolean;
  nickname: string;
  case_id: CaseId;
  case_version: number;
  status: 'offered' | 'playing' | 'finished' | 'dnf' | 'abandoned';
  selected_slot: number | null;
  character_id: string | null;
  pokemon_id: string | null;
  selected_at: string | null;
  last_seq: number;
  last_t: number;
  event_count: number;
  terminal_type: 'finish' | 'dnf' | null;
  progress: unknown;
  abandoned_reason: 'player_reset' | 'operator_reset' | 'superseded' | null;
  created_at: string;
  created_ms: number;
  finalized_at: string | null;
}

type Row = Record<string, unknown>;
type Viewer = { role: 'anon' } | { role: 'station'; stationId: StationId | null } | { role: 'operator' };

/** mystery_results columns no client role may select (column privileges, migration 20261022000100). */
export const MYSTERY_SECRET_RESULT_COLUMNS = ['accused', 'evidence', 'client_claim'] as const;
const withoutSecrets = (r: Row): Row => {
  const out = { ...r };
  for (const k of MYSTERY_SECRET_RESULT_COLUMNS) delete out[k];
  return out;
};

/** Small deterministic PRNG (mulberry32) for the fake's case bag: reproducible tests. */
function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const LABELS: Record<StationId, string> = { station_a: 'Station A', station_b: 'Station B', station_c: 'Station C' };

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
  readonly operatorAudit: { stationId: StationId; scope: string; sessionIds: string[] }[] = [];
  readonly tokens = new Map<string, string>(); // access token -> user id
  readonly refreshTokens = new Map<string, string>();
  restFailures = 0;
  // ---- mystery-v3.1 state (tables of migrations 20261021000500..800)
  readonly mysterySessions = new Map<string, FakeMysterySession>();
  readonly mysteryOffers = new Map<string, DuoCard[]>();
  readonly mysteryEvents = new Map<string, Map<number, Row>>();
  readonly mysteryForecasts = new Map<string, Map<number, Row>>();
  readonly mysteryRecs = new Map<string, Map<number, Row>>();
  readonly mysteryResults = new Map<string, Row>();
  readonly mysteryStationRows = new Map<StationId, Row>();
  /** Seeds handed out by mystery-create-session before falling back to crypto randomness (deterministic tests). */
  readonly nextMysterySeeds: string[] = [];
  /** RATE_LIMITED threshold: creates per station per 60 s of server clock (SQL: 6). */
  mysteryRateLimit = 6;
  /** MYSTERY_ALLOW_TEST_SEEDS secret. */
  mysteryAllowTestSeeds = false;
  /** mystery_case_bags: remaining case ids of the current bag + the case dealt last, per station. */
  readonly mysteryCaseBags = new Map<StationId, { bag: CaseId[]; last: CaseId | null }>();
  /** Test hook: the next creates get these cases (in order) INSTEAD of a bag draw (the bag is not touched). */
  readonly nextMysteryCases: CaseId[] = [];
  /** mystery_session_secrets: the murderer drawn per session (server only; never in any pre-finalize response). */
  readonly mysteryCulprits = new Map<string, SuspectId>();
  /** Test hook: the next creates draw these murderers (in order) instead of a random one. */
  readonly nextMysteryCulprits: SuspectId[] = [];
  /** RNG of the murderer draw (Edge Function: crypto). Seeded per server for reproducible tests. */
  mysteryCulpritRandom: () => number = seededRandom(0xc01f);
  /** The rules version mystery-create-session writes (the deployed bundle's MYSTERY_RULES_VERSION). */
  mysteryRulesVersion: MysteryRulesVersion = MYSTERY_RULES_VERSION;
  /** RNG of the bag shuffle (SQL: random()). Seeded per server for reproducible tests. */
  mysteryCaseRandom: () => number = seededRandom(0x5eed);
  readonly origin: string;
  private clock = Date.parse('2026-10-31T18:00:00.000Z');
  private tokenCounter = 0;

  constructor(opts: { origin?: string } = {}) {
    this.origin = opts.origin ?? FAKE_URL;
    for (const id of ['station_a', 'station_b', 'station_c'] as const) this.stationRows.set(id, this.idleRow(id, null, 0));
    for (const id of ['station_a', 'station_b', 'station_c'] as const) this.mysteryStationRows.set(id, this.mysteryIdleRow(id, null, 0));
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

  /** Moves the server clock forward (e.g. past the 60 s create rate-limit window). */
  advanceClock(ms: number): void {
    this.clock += ms;
  }

  now(): number {
    return this.clock;
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
      case_id: null, status: 'idle', phase: null, leg_index: null, route: null, push_level: null, weather: null, hp: null, stamina: null,
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


  // ================================================================ mystery-v3.1
  mysterySessionsOf(stationId: StationId): FakeMysterySession[] {
    return [...this.mysterySessions.values()].filter((s) => s.station_id === stationId);
  }

  private mysteryIdleRow(stationId: StationId, notice: string | null, revision: number): Row {
    return {
      station_id: stationId, label: LABELS[stationId], session_id: null, nickname: null, character_id: null, pokemon_id: null,
      status: 'idle', clues_found: null, catches: null, sightings: null, egg_state: null, active_time_s: null, verdict: null,
      score: null, is_test: false, notice, revision, updated_at: new Date(this.clock).toISOString(),
    };
  }

  /** private.mystery_project_status */
  private mysteryProject(s: FakeMysterySession): void {
    if (s.status === 'abandoned') return;
    const prev = this.mysteryStationRows.get(s.station_id)!;
    const p = progressFromRow(s.progress);
    const r = this.mysteryResults.get(s.id);
    const row: Row = {
      station_id: s.station_id, label: LABELS[s.station_id], session_id: s.id, nickname: s.nickname, character_id: s.character_id,
      pokemon_id: s.pokemon_id, case_id: s.case_id, status: s.status, clues_found: p.cluesFound.length, catches: p.catches, sightings: p.sightings,
      egg_state: p.egg,
      active_time_s: r ? r.active_time_s : (Math.round(s.last_t * 10) / 10).toFixed(1), // numeric(8,1) arrives as a string
      verdict: r ? r.verdict : null, score: r ? r.score : null, is_test: s.is_test, notice: null,
      revision: Number(prev.revision) + 1, updated_at: this.tick(),
    };
    this.mysteryStationRows.set(s.station_id, row);
    this.realtime.emit('mystery_station_status', 'UPDATE', row);
  }

  /** private.mystery_clear_status */
  private mysteryClear(stationId: StationId, notice: string | null): void {
    const prev = this.mysteryStationRows.get(stationId)!;
    this.tick();
    const row = this.mysteryIdleRow(stationId, notice, Number(prev.revision) + 1);
    this.mysteryStationRows.set(stationId, row);
    this.realtime.emit('mystery_station_status', 'UPDATE', row);
  }

  private mysteryLoad(sessionId: string, stationId: StationId | null): FakeMysterySession {
    const s = this.mysterySessions.get(sessionId);
    if (!s || (stationId !== null && s.station_id !== stationId)) throw new HttpError('SESSION_NOT_FOUND', 'Session not found for this station');
    return s;
  }

  /** resultView (mystery-db.ts). */
  private mysteryResultView(r: Row): Row {
    return {
      sessionId: r.session_id, rulesVersion: r.rules_version, caseId: r.case_id, caseVersion: r.case_version, outcome: r.outcome,
      dnfReason: r.dnf_reason, verdict: r.verdict, accused: r.accused, correct: r.correct, evidence: r.evidence,
      deductionCorrect: r.deduction_correct, cluesFound: r.clues_found, eggTier: r.egg_tier, eggPoints: r.egg_points,
      eggSecurity: Number(r.egg_security), activeTimeS: Number(r.active_time_s), score: r.score === null ? null : Number(r.score),
      catches: r.catches, sightings: r.sightings, hintsUsed: r.hints_used,
      detections: r.detections ?? null, hits: r.hits ?? null, defeatedBy: r.defeated_by ?? null, scoreBreakdown: r.score_breakdown ?? null,
      duo: { characterId: r.character_id, pokemonId: r.pokemon_id }, nickname: r.nickname, stationId: r.station_id,
      isTest: r.is_test, claimMatches: r.claim_matches, verified: true, finalizedAt: r.finalized_at,
    };
  }

  /** loadEnvelope / sessionView (mystery-db.ts). */
  private mysteryEnvelope(s: FakeMysterySession): Row {
    const cards = this.mysteryOffers.get(s.id)!;
    const result = s.status === 'finished' || s.status === 'dnf' ? this.mysteryResults.get(s.id) ?? null : null;
    return wire({
      session: {
        sessionId: s.id, stationId: s.station_id, rulesVersion: s.rules_version, status: s.status, abandonedReason: s.abandoned_reason,
        seed: s.seed, nickname: s.nickname, isTest: s.is_test, caseId: s.case_id, caseVersion: s.case_version,
        selected: s.selected_slot === null || !s.character_id || !s.pokemon_id ? null : { characterId: s.character_id, pokemonId: s.pokemon_id, slot: s.selected_slot },
        lastSeq: s.last_seq, lastT: s.last_t, eventCount: s.event_count, progress: progressSummary(progressFromRow(s.progress)),
        createdAt: s.created_at, selectedAt: s.selected_at, finalizedAt: s.finalized_at,
      },
      offer: { seed: s.seed, cards },
      result: result ? this.mysteryResultView(result) : null,
    });
  }

  /** An RPC answered {ok:false, error, message, ...details}: the functions map it with the real fromRpcEnvelope. */
  private rpcFail(envelope: Row): never {
    throw fromRpcEnvelope(envelope);
  }

  /** private.mystery_draw_case: pop the station's bag; refill with a fresh permutation never starting with `last`. */
  /** The stored murderer (sessions created before the draw existed get one now, like mystery_assign_culprit). */
  mysteryCulpritOf(sessionId: string): SuspectId {
    let c = this.mysteryCulprits.get(sessionId);
    if (!c) this.mysteryCulprits.set(sessionId, (c = drawCulprit(this.mysteryCulpritRandom)));
    return c;
  }

  mysteryDrawCase(stationId: StationId): CaseId {
    const st = this.mysteryCaseBags.get(stationId) ?? { bag: [], last: null };
    if (st.bag.length === 0) {
      const bag = CASE_IDS.map((id) => ({ id, k: this.mysteryCaseRandom() })).sort((a, b) => a.k - b.k).map((x) => x.id);
      if (bag[0] === st.last) {
        const j = 1 + Math.floor(this.mysteryCaseRandom() * (bag.length - 1));
        [bag[0], bag[j]] = [bag[j]!, bag[0]!];
      }
      st.bag = bag;
    }
    const next = st.bag.shift()!;
    st.last = next;
    this.mysteryCaseBags.set(stationId, st);
    return next;
  }

  private mysteryNewSeed(): string {
    return this.nextMysterySeeds.shift() ?? Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('');
  }

  /**
   * Finished (non-test) results of ONE rules version in leaderboard order with SQL rank(): `mystery_leaderboard` (v3.1)
   * or `mystery_leaderboard_v4` (v4, migration 20261025000100). Versions never mix.
   */
  mysteryLeaderboard(version: MysteryRulesVersion = this.mysteryRulesVersion): Row[] {
    const fin = [...this.mysteryResults.values()].filter((r) => r.outcome === 'finished' && !r.is_test && r.rules_version === version);
    fin.sort((a, b) => Number(b.score) - Number(a.score) || Number(a.active_time_s) - Number(b.active_time_s)
      || String(a.finalized_at).localeCompare(String(b.finalized_at)) || String(a.session_id).localeCompare(String(b.session_id)));
    let rank = 0;
    const same = (p: Row, r: Row) => Number(p.score) === Number(r.score) && Number(p.active_time_s) === Number(r.active_time_s)
      && p.finalized_at === r.finalized_at;
    const perCase = new Map<unknown, { n: number; rank: number; prev: Row | null }>();
    return fin.map((r, i) => {
      const p = fin[i - 1];
      if (!p || !same(p, r)) rank = i + 1;
      const c = perCase.get(r.case_id) ?? { n: 0, rank: 0, prev: null };
      c.n++;
      if (!c.prev || !same(c.prev, r)) c.rank = c.n;
      c.prev = r;
      perCase.set(r.case_id, c);
      return { ...withoutSecrets(r), rank, case_rank: c.rank };
    });
  }

  /** mystery_standings: every finisher (ranked) above every DNF (unranked, longest survival first). */
  mysteryStandings(version: MysteryRulesVersion = this.mysteryRulesVersion): Row[] {
    const fin = this.mysteryLeaderboard(version).map((r) => ({ ...r, standing_group: 0 }));
    const dnf = [...this.mysteryResults.values()].filter((r) => r.outcome === 'dnf' && !r.is_test && r.rules_version === version)
      .sort((a, b) => Number(b.active_time_s) - Number(a.active_time_s) || String(a.finalized_at).localeCompare(String(b.finalized_at))
        || String(a.session_id).localeCompare(String(b.session_id)))
      .map((r) => ({ ...withoutSecrets(r), standing_group: 1, rank: null, case_rank: null }));
    return [...fin, ...dnf];
  }

  private mysteryHandle(fn: string, raw: unknown, c: Caller): { status?: number; body: unknown; replay?: boolean } {
    const stationId = this.requireStation(c);
    switch (fn) {
      case 'mystery-create-session': {
        const body = parseMysteryCreate(raw, this.mysteryAllowTestSeeds);
        requireData();
        // ---- RPC mystery_create_session: idempotent per (station, actionId)
        const existing = this.mysterySessionsOf(stationId).find((s) => s.create_action_id === body.actionId);
        if (existing) {
          if (!jsonEqual(existing.create_body, body)) this.rpcFail({ ok: false, error: 'ACTION_ID_CONFLICT', message: 'action id already used with a different request' });
          return { status: 200, body: this.mysteryEnvelope(existing), replay: true };
        }
        const seed = body.testSeed ?? this.mysteryNewSeed();
        const offer = computeOffer(seed);
        const versions = caseVersions(); // p_case_versions
        const recent = this.mysterySessionsOf(stationId).filter((s) => s.created_ms > this.clock - 60_000).length;
        if (recent >= this.mysteryRateLimit) this.rpcFail({ ok: false, error: 'RATE_LIMITED', message: 'too many sessions created on this station; wait a minute' });
        // forced (test seed) case or the next one from this station's bag; a forced case never touches the bag
        const caseId: CaseId = body.testCase ?? this.nextMysteryCases.shift() ?? this.mysteryDrawCase(stationId);
        for (const old of this.mysterySessionsOf(stationId)) {
          if (old.status === 'offered' || old.status === 'playing') {
            old.status = 'abandoned';
            old.abandoned_reason = 'superseded';
          }
        }
        const id = crypto.randomUUID();
        const createdAt = this.tick();
        const s: FakeMysterySession = {
          id, station_id: stationId, rules_version: this.mysteryRulesVersion, create_action_id: body.actionId, create_body: wire(body), seed,
          is_test: body.testSeed !== undefined, nickname: body.nickname, case_id: caseId, case_version: versions[caseId], status: 'offered', selected_slot: null, character_id: null,
          pokemon_id: null, selected_at: null, last_seq: -1, last_t: 0, event_count: 0, terminal_type: null, progress: {},
          abandoned_reason: null, created_at: createdAt, created_ms: this.clock, finalized_at: null,
        };
        this.mysterySessions.set(id, s);
        // ---- RPC mystery_assign_culprit (idempotent; a replay above returns before reaching it, keeping the stored one)
        this.mysteryCulprits.set(id, this.nextMysteryCulprits.shift() ?? drawCulprit(this.mysteryCulpritRandom));
        this.mysteryOffers.set(id, wire(offer.cards));
        this.mysteryEvents.set(id, new Map());
        this.mysteryForecasts.set(id, new Map());
        this.mysteryRecs.set(id, new Map());
        this.mysteryProject(s);
        return { status: 201, body: this.mysteryEnvelope(s) };
      }
      case 'mystery-get-session': {
        const body = parseMysteryGet(raw);
        const s = body.sessionId
          ? this.mysteryLoad(body.sessionId, stationId)
          : this.mysterySessionsOf(stationId).find((x) => x.status === 'offered' || x.status === 'playing') ?? null;
        if (!s) return { body: { session: null, offer: null, result: null } };
        return { body: this.mysteryEnvelope(s) };
      }
      case 'mystery-select-duo': {
        const body = parseMysterySelect(raw);
        const s = this.mysteryLoad(body.sessionId, stationId);
        // ---- RPC mystery_select_duo: the pair MUST be one of the stored cards; same choice again = replay
        if (s.selected_slot !== null) {
          if (s.character_id === body.characterId && s.pokemon_id === body.pokemonId) return { body: this.mysteryEnvelope(s), replay: true };
          this.rpcFail({ ok: false, error: 'ALREADY_SELECTED', message: 'a different duo was already selected for this session', slot: s.selected_slot });
        }
        if (s.status !== 'offered') {
          this.rpcFail({ ok: false, error: 'SESSION_CLOSED', message: 'session is no longer open', status: s.status, abandonedReason: s.abandoned_reason });
        }
        const slot = this.mysteryOffers.get(s.id)!.findIndex((card) => card.characterId === body.characterId && card.pokemonId === body.pokemonId);
        if (slot < 0) this.rpcFail({ ok: false, error: 'DUO_NOT_OFFERED', message: 'that duo is not one of the three offered cards' });
        s.status = 'playing';
        s.selected_slot = slot;
        s.character_id = body.characterId;
        s.pokemon_id = body.pokemonId;
        s.selected_at = this.tick();
        this.mysteryProject(s);
        return { body: this.mysteryEnvelope(s) };
      }
      case 'mystery-append-events': {
        const body = parseMysteryAppend(raw);
        const data = requireData();
        const egg = requireEggRules();
        const s = this.mysteryLoad(body.sessionId, stationId);
        const progress = progressFromRow(s.progress);
        const storedRows = this.mysteryEvents.get(s.id)!;
        const stored = new Map<number, ParsedEvent>();
        for (const e of body.events) {
          const r = e.seq <= s.last_seq ? storedRows.get(e.seq) : undefined;
          if (r) stored.set(e.seq, { seq: Number(r.seq), t: Number(r.t), type: r.type as ParsedEvent['type'], payload: wire(r.payload) as Record<string, unknown> });
        }
        const { duplicates, fresh } = splitResend(body.events, s.last_seq, stored);
        const ack = (extra: Row) => wire({
          sessionId: s.id, accepted: 0, duplicates, lastSeq: s.last_seq, lastT: s.last_t, eventCount: s.event_count,
          terminal: progress.terminal?.type ?? null, progress: progressSummary(progress), forecastsInserted: 0, recommendationsUpserted: 0,
          ...extra,
        });
        // Pure resend of already-stored events: acknowledge without writing (works even after finalization).
        if (fresh.length === 0 && body.forecasts.length === 0 && body.recommendations.length === 0) {
          const found = progress.cluesFound;
          return { body: ack({ clues: found.length ? revealedClues(resolveCase(s.case_id, undefined, data, this.mysteryCulpritOf(s.id)), found) : {} }), replay: duplicates > 0 };
        }
        if (s.status === 'offered') throw new HttpError('NOT_SELECTED', 'Select a duo before sending gameplay events');
        if (s.status !== 'playing') {
          throw new HttpError('SESSION_CLOSED', `Session is ${s.status}`, { status: s.status, abandonedReason: s.abandoned_reason });
        }
        const kase = resolveCase(s.case_id, s.case_version, data, this.mysteryCulpritOf(s.id));
        const next = applyBatch(progress, fresh, rulesContext(s.seed, kase.caseDef, egg));
        // ---- RPC mystery_append_events (the optimistic last_seq check always holds: one JS turn, no concurrency)
        if (s.event_count + fresh.length > 20_000) this.rpcFail({ ok: false, error: 'TOO_MANY_EVENTS', message: 'session event budget (20000) exhausted' });
        const receivedAt = this.tick();
        let terminal: 'finish' | 'dnf' | null = null;
        for (const e of fresh) {
          storedRows.set(e.seq, { session_id: s.id, station_id: s.station_id, seq: e.seq, t: e.t, type: e.type, payload: wire(e.payload), received_at: receivedAt });
          if (e.type === 'finish' || e.type === 'dnf') terminal = e.type;
        }
        if (fresh.length > 0) {
          s.last_seq = fresh[fresh.length - 1]!.seq;
          s.last_t = fresh[fresh.length - 1]!.t;
        }
        s.event_count += fresh.length;
        s.progress = wire(next);
        s.terminal_type = s.terminal_type ?? terminal;
        let fc = 0;
        const forecasts = this.mysteryForecasts.get(s.id)!;
        for (const f of body.forecasts) {
          if (forecasts.has(f.forecastNo)) continue; // immutable once issued
          forecasts.set(f.forecastNo, {
            session_id: s.id, station_id: s.station_id, forecast_no: f.forecastNo, t: f.t, target: f.target, value: f.value,
            model_label: f.modelLabel, model_version: f.modelVersion, features: wire(f.features),
          });
          fc++;
        }
        let rc = 0;
        const recs = this.mysteryRecs.get(s.id)!;
        for (const x of body.recommendations) {
          const prev = recs.get(x.recNo);
          if (!prev) {
            recs.set(x.recNo, {
              session_id: s.id, station_id: s.station_id, rec_no: x.recNo, t: x.t, action: x.action, advice: x.advice,
              trigger: x.trigger, accepted: x.accepted, outcome: x.outcome,
            });
            rc++;
          } else if (prev.accepted === null || prev.outcome === null) {
            prev.accepted = prev.accepted ?? x.accepted; // fill-only: null -> value, never rewritten
            prev.outcome = prev.outcome ?? x.outcome;
            rc++;
          }
        }
        this.mysteryProject(s);
        return {
          body: ack({
            accepted: fresh.length, lastSeq: s.last_seq, lastT: s.last_t, eventCount: s.event_count, terminal: s.terminal_type,
            progress: progressSummary(next), forecastsInserted: fc, recommendationsUpserted: rc, clues: revealedClues(kase, next.cluesFound),
          }),
        };
      }
      case 'mystery-finalize': {
        const body = parseMysteryFinalize(raw);
        const s = this.mysteryLoad(body.sessionId, stationId);
        const respond = (r: Row, replay: boolean) => ({
          status: replay ? 200 : 201,
          replay,
          body: wire({
            sessionId: s.id,
            result: this.mysteryResultView(r),
            rank: r.outcome === 'finished' && !r.is_test ? (this.mysteryLeaderboard(r.rules_version as MysteryRulesVersion).find((x) => x.session_id === s.id)?.rank ?? null) : null,
            reveal: caseReveal(resolveCase(r.case_id, undefined, undefined, this.mysteryCulpritOf(s.id)), r.outcome as 'finished' | 'dnf'),
          }),
        });
        if (s.status === 'finished' || s.status === 'dnf') {
          const stored = this.mysteryResults.get(s.id);
          if (!stored) throw new HttpError('INTERNAL', 'Finalized session without a result row');
          return respond(stored, true);
        }
        if (s.status === 'offered') throw new HttpError('NOT_SELECTED', 'No duo selected; nothing to finalize');
        if (s.status !== 'playing') throw new HttpError('SESSION_CLOSED', `Session is ${s.status}`, { status: s.status, abandonedReason: s.abandoned_reason });
        const data = requireData();
        const egg = requireEggRules();
        const kase = resolveCase(s.case_id, s.case_version, data, this.mysteryCulpritOf(s.id));
        const rules = rulesContext(s.seed, kase.caseDef, egg);
        // Re-validate the stored rule events from scratch (independent of the incremental append-time state).
        const ruleEvents: ParsedEvent[] = [...this.mysteryEvents.get(s.id)!.values()]
          .filter((r) => (RULE_EVENT_TYPES as readonly string[]).includes(String(r.type)))
          .sort((a, b) => Number(a.seq) - Number(b.seq))
          .map((r) => ({ seq: Number(r.seq), t: Number(r.t), type: r.type as ParsedEvent['type'], payload: wire(r.payload) as Record<string, unknown> }));
        const replayed = applyBatch(initialProgress(), ruleEvents, rules);
        if (ruleFingerprint(replayed) !== ruleFingerprint(progressFromRow(s.progress))) {
          throw new HttpError('INVALID_TRANSITION', 'Stored events and stored progress disagree');
        }
        const result = computeResult(replayed, kase, rules.expectedTier, body.clientResult, s.rules_version);
        // ---- RPC mystery_finalize_session
        if (s.terminal_type === null) this.rpcFail({ ok: false, error: 'RUN_NOT_FINISHED', message: 'no finish or dnf event has been recorded yet', lastSeq: s.last_seq });
        const finalizedAt = this.tick();
        const row: Row = {
          session_id: s.id, station_id: s.station_id, nickname: s.nickname, character_id: s.character_id, pokemon_id: s.pokemon_id,
          rules_version: s.rules_version, case_id: s.case_id, case_version: s.case_version, outcome: result.outcome,
          dnf_reason: result.dnfReason, verdict: result.verdict, accused: result.accused, correct: result.correct,
          evidence: [...result.evidence], deduction_correct: result.deductionCorrect,
          clues_found: [...result.cluesFound], clue_count: result.cluesFound.length,
          egg_tier: result.eggTier, egg_points: result.eggPoints, egg_security: result.eggSecurity.toFixed(1),
          active_time_s: result.activeTimeS.toFixed(1), score: result.score === null ? null : result.score.toFixed(1),
          catches: result.catches, sightings: result.sightings, hints_used: result.hintsUsed, client_claim: wire(result.clientClaim),
          claim_matches: result.claimMatches, is_test: s.is_test, finalized_at: finalizedAt,
          // mystery-v4 columns (migration 20261025000100): null on v3.1 rows
          detections: result.detections, hits: result.hits, defeated_by: result.defeatedBy, score_breakdown: wire(result.scoreBreakdown),
        };
        if (s.rules_version === 'mystery-v4') {
          // SQL CHECK backstop (v4): the breakdown is the contract formula of the row's own columns and score = total
          if (result.outcome === 'finished') {
            const want = scoreV4({
              delivered: true, correct: result.correct, cluesFound: result.cluesFound.length, detections: result.detections ?? -1,
              hintsUsed: result.hintsUsed, hits: result.hits ?? -1, activeTimeS: Number(row.active_time_s),
            });
            if (!jsonEqual(want, result.scoreBreakdown) || Number(row.score) !== want.total) throw new HttpError('INTERNAL', 'mystery_results_v4_score_check violated');
          } else if (row.score !== null || row.score_breakdown !== null) throw new HttpError('INTERNAL', 'mystery_results_v4_dnf_check violated');
        } else if (result.outcome === 'finished' && Math.round(Number(row.score) * 10) !== Math.round((result.eggPoints * 100 - Number(row.active_time_s)) * 10)) {
          // SQL CHECK backstop (v3.1): score = egg_points × 100 − active_time_s (exact on 1-dp numerics)
          throw new HttpError('INTERNAL', 'mystery_results_finished_check violated');
        }
        // SQL CHECK backstops of 20261022000100: solved ⇒ correct ∧ deduction ∧ 3 clues; no suspect ⇒ no evidence
        if (result.verdict === 'case_solved' && !(result.correct && result.deductionCorrect && result.cluesFound.length === 3)) {
          throw new HttpError('INTERNAL', 'mystery_results_solved_check violated');
        }
        if (result.accused === null && (result.deductionCorrect || result.evidence.length > 0)) {
          throw new HttpError('INTERNAL', 'mystery_results_deduction_check violated');
        }
        this.mysteryResults.set(s.id, row);
        s.status = result.outcome;
        s.finalized_at = finalizedAt;
        this.mysteryProject(s);
        // Realtime postgres_changes only carries the columns the subscriber may select (no accused / evidence / claim)
        if (!s.is_test) this.realtime.emit('mystery_results', 'INSERT', withoutSecrets(row));
        return respond(row, false);
      }
      default:
        throw new HttpError('METHOD_NOT_ALLOWED', 'Unknown function');
    }
  }

  /** Operator nickname moderation for the mystery board (manual SQL delete in production). */
  moderateMysteryDelete(sessionId: string): void {
    if (!this.mysteryResults.delete(sessionId)) return;
    this.realtime.emit('mystery_results', 'DELETE', {}, { session_id: sessionId });
  }

  /** mystery_abandon_station (admin-reset scope all | mystery). */
  private mysteryAbandonStation(stationId: StationId, reason: 'operator_reset' | 'player_reset'): string[] {
    const ids: string[] = [];
    for (const s of this.mysterySessionsOf(stationId)) {
      if (s.status !== 'offered' && s.status !== 'playing') continue;
      s.status = 'abandoned';
      s.abandoned_reason = reason;
      ids.push(s.id);
    }
    this.mysteryClear(stationId, reason);
    return ids;
  }

  // ---------------------------------------------------------------- PostgREST (mystery tables + RLS)
  private viewer(headers: Headers): Viewer {
    const m = /^Bearer\s+(.+)$/.exec(headers.get('authorization') ?? '');
    const userId = m ? this.tokens.get(m[1]) : undefined; // anon key -> anon
    const user = userId ? this.users.find((u) => u.id === userId) : undefined;
    if (!user?.role) return { role: 'anon' };
    return user.role === 'operator' ? { role: 'operator' } : { role: 'station', stationId: user.stationId };
  }

  private mysteryRows(table: string, v: Viewer): Row[] | null {
    const own = (r: Row) => v.role === 'operator' || (v.role === 'station' && r.station_id === v.stationId);
    switch (table) {
      case 'mystery_station_status':
        return [...this.mysteryStationRows.values()];
      case 'mystery_results':
        // public read hides test runs; accused / evidence / client_claim are not selectable by ANY client role
        return [...this.mysteryResults.values()].filter((r) => v.role === 'operator' || !r.is_test).map(withoutSecrets);
      case 'mystery_result_audit':
        // definer view filtered by private.is_operator(): anon has no privilege, stations get zero rows
        if (v.role === 'anon') return null;
        return v.role === 'operator' ? [...this.mysteryResults.values()].map((r) => ({
          session_id: r.session_id, station_id: r.station_id, case_id: r.case_id, case_version: r.case_version, outcome: r.outcome,
          verdict: r.verdict, accused: r.accused, correct: r.correct, evidence: r.evidence, deduction_correct: r.deduction_correct,
          clues_found: r.clues_found, client_claim: r.client_claim, claim_matches: r.claim_matches, is_test: r.is_test,
          finalized_at: r.finalized_at,
        })) : [];
      case 'mystery_leaderboard':
        return this.mysteryLeaderboard('mystery-v3.1');
      case 'mystery_defeated':
        return [...this.mysteryResults.values()].filter((r) => r.outcome === 'dnf' && !r.is_test && r.rules_version === 'mystery-v3.1').map(withoutSecrets);
      case 'mystery_standings':
        return this.mysteryStandings('mystery-v3.1');
      // ---- mystery-v4 views (20261025000100)
      case 'mystery_leaderboard_v4':
        return this.mysteryLeaderboard('mystery-v4');
      case 'mystery_defeated_v4':
        return [...this.mysteryResults.values()].filter((r) => r.outcome === 'dnf' && !r.is_test && r.rules_version === 'mystery-v4')
          .sort((a, b) => String(b.finalized_at).localeCompare(String(a.finalized_at)) || String(a.session_id).localeCompare(String(b.session_id)))
          .map(withoutSecrets);
      case 'mystery_standings_v4':
        return this.mysteryStandings('mystery-v4');
      case 'mystery_top5':
        return this.mysteryLeaderboard('mystery-v4').slice(0, 5).map((r) => ({
          rank: r.rank, session_id: r.session_id, nickname: r.nickname, score: r.score, character_id: r.character_id, pokemon_id: r.pokemon_id,
          case_id: r.case_id, active_time_s: r.active_time_s, finalized_at: r.finalized_at, rules_version: r.rules_version,
        }));
      case 'mystery_sessions':
        return [...this.mysterySessions.values()].map((s) => ({ ...s }) as unknown as Row).filter(own);
      case 'mystery_offered_duos':
        return [...this.mysteryOffers.entries()].flatMap(([sid, cards]) => {
          const s = this.mysterySessions.get(sid)!;
          return cards.map((c, slot): Row => ({
            session_id: sid, station_id: s.station_id, slot, character_id: c.characterId, pokemon_id: c.pokemonId, duo_name: c.duoName,
            role: c.role, rarity: c.rarity, stats: c.stats, card: c,
          }));
        }).filter(own);
      case 'mystery_events':
        return [...this.mysteryEvents.values()].flatMap((m) => [...m.values()]).filter(own);
      case 'mystery_forecasts':
        return [...this.mysteryForecasts.values()].flatMap((m) => [...m.values()]).filter(own);
      case 'mystery_recommendations':
        return [...this.mysteryRecs.values()].flatMap((m) => [...m.values()]).filter(own);
      default:
        return null;
    }
  }

  /** eq / in filters, order, offset + limit (range), select projection — the subset supabase-js emits here. */
  private applyQuery(rows: Row[], url: URL): Row[] {
    let out = rows;
    for (const [key, value] of url.searchParams) {
      if (['select', 'order', 'limit', 'offset'].includes(key)) continue;
      const eq = /^eq\.(.*)$/.exec(value);
      if (eq) {
        out = out.filter((r) => String(r[key]) === eq[1]);
        continue;
      }
      const inList = /^in\.\((.*)\)$/.exec(value);
      if (inList) {
        const set = new Set(inList[1]!.split(',').map((x) => x.replace(/^"|"$/g, '')));
        out = out.filter((r) => set.has(String(r[key])));
      }
    }
    const order = url.searchParams.get('order');
    if (order) {
      const keys = order.split(',').map((o) => {
        const [col, dir] = o.split('.');
        return { col: col!, desc: dir === 'desc' };
      });
      out = [...out].sort((a, b) => {
        for (const k of keys) {
          const x = a[k.col];
          const y = b[k.col];
          const c = typeof x === 'number' && typeof y === 'number' ? x - y : String(x ?? '').localeCompare(String(y ?? ''));
          if (c !== 0) return k.desc ? -c : c;
        }
        return 0;
      });
    }
    const offset = Number(url.searchParams.get('offset') ?? '0');
    const limit = Number(url.searchParams.get('limit') ?? 'NaN');
    if (offset > 0) out = out.slice(offset);
    if (Number.isFinite(limit)) out = out.slice(0, limit);
    const select = url.searchParams.get('select');
    if (select && select !== '*') {
      const cols = select.split(',').map((c) => c.trim());
      out = out.map((r) => Object.fromEntries(cols.map((c) => [c, r[c] ?? null])));
    }
    return out;
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
    if (fn.startsWith('mystery-')) return this.mysteryHandle(fn, raw, c);
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
        if (body.scope !== 'mystery') {
          for (const s of this.sessionsOf(body.stationId)) {
            if (s.state.status !== 'in_progress') continue;
            this.transition(null, s.id, body.actionId, 'abandon', { ...body }, 'operator_reset', (state) => ({ ok: true, state: abandonSession(state) }));
            abandoned.push(s.id);
          }
        }
        const mysteryAbandoned = body.scope !== 'legacy' ? this.mysteryAbandonStation(body.stationId, 'operator_reset') : [];
        if (body.scope !== 'mystery') this.clearStation(body.stationId, 'operator_reset');
        this.operatorAudit.push({ stationId: body.stationId, scope: body.scope, sessionIds: [...abandoned, ...mysteryAbandoned] });
        return {
          body: { stationId: body.stationId, scope: body.scope, abandonedSessionIds: abandoned, abandonedMysterySessionIds: mysteryAbandoned, notice: 'operator_reset' },
        };
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
      const maxBytes = fn === 'mystery-append-events' ? MAX_APPEND_BYTES : fn === 'mystery-finalize' ? MAX_FINALIZE_BYTES : MAX_BODY_BYTES;
      if (new TextEncoder().encode(text).length > maxBytes) throw new HttpError('PAYLOAD_TOO_LARGE', `Body exceeds ${maxBytes} bytes`);
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
    } else if (table.startsWith('mystery_')) {
      const viewer = this.viewer(headers);
      if (table === 'mystery_case_bags') return json(401, { code: '42501', message: 'permission denied for table mystery_case_bags' });
      if (table === 'mystery_result_audit' && viewer.role === 'anon') {
        return json(401, { code: '42501', message: 'permission denied for view mystery_result_audit' });
      }
      if (table === 'mystery_results') {
        // column privileges: selecting (or `*`-selecting) a secret column is a permission error, as in PostgREST
        const cols = (url.searchParams.get('select') ?? '*').split(',').map((c) => c.trim());
        if (cols.includes('*') || cols.some((c) => (MYSTERY_SECRET_RESULT_COLUMNS as readonly string[]).includes(c))) {
          return json(401, { code: '42501', message: 'permission denied for table mystery_results' });
        }
      }
      const mrows = this.mysteryRows(table, viewer);
      if (mrows === null) return json(404, { code: '42P01', message: `relation "${table}" does not exist` });
      return json(200, wire(this.applyQuery(mrows, url)));
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
    if (url.origin !== this.origin) throw new TypeError(`unexpected origin ${url.origin}`);
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


// ------------------------------------------------------------------------------------------------
// mystery-v3.1 pages wired to the fake (real adapter: supabase-js + functions transport + Realtime fake)

export interface MysteryStationPage {
  services: ReturnType<typeof buildMysteryStationServices>;
  online: ReturnType<typeof fakeOnline>;
  storage: ReturnType<typeof memoryStorage>;
  /** Sleeps the function transport would have taken between retries (no real waiting in tests). */
  sleeps: number[];
}

export function openMysteryStation(
  server: FakeSupabaseServer,
  stationId: StationId,
  opts: { storage?: ReturnType<typeof memoryStorage>; maxAttempts?: number; online?: ReturnType<typeof fakeOnline> } = {},
): MysteryStationPage {
  const storage = opts.storage ?? memoryStorage();
  const online = opts.online ?? fakeOnline(true);
  const sleeps: number[] = [];
  const config: LiveConfig = { url: server.origin, anonKey: ANON_KEY };
  const client = createSupabase(config, stationId, { fetch: server.fetch, storage, autoRefreshToken: false });
  const services = buildMysteryStationServices({
    stationId, config, client, realtime: server.realtime.asHost(), fetch: server.fetch, online,
    transport: { timeoutMs: 2000, maxAttempts: opts.maxAttempts, sleep: async (ms) => void sleeps.push(ms) },
    retryDelaysMs: [5, 5, 5],
  });
  return { services, online, storage, sleeps };
}

export interface MysteryBoardPage {
  services: ReturnType<typeof buildMysteryBoardServices>;
  online: ReturnType<typeof fakeOnline>;
  storage: ReturnType<typeof memoryStorage>;
  clock: { now: number };
}

export function openMysteryBoard(server: FakeSupabaseServer, opts: { pollMs?: number } = {}): MysteryBoardPage {
  const storage = memoryStorage();
  const online = fakeOnline(true);
  const clock = { now: Date.parse('2026-10-31T18:00:00.000Z') };
  const config: LiveConfig = { url: server.origin, anonKey: ANON_KEY };
  const client = createSupabase(config, null, { fetch: server.fetch, storage, autoRefreshToken: false });
  const services = buildMysteryBoardServices({
    config, client, realtime: server.realtime.asHost(), fetch: server.fetch, online,
    transport: { timeoutMs: 2000, sleep: async () => undefined },
    pollMs: opts.pollMs ?? 60_000, tickMs: 60_000, now: () => clock.now, retryDelaysMs: [5, 5, 5],
  });
  return { services, online, storage, clock };
}

/** Server seeds whose first card, played by the seeded Bot, ends 'finished' (stealthy) / 'dnf' (careless). */
// FINISH_SEED finishes (case solved) with the stealthy bot in EVERY case. The careless DNF is case dependent: push
// MYSTERY_DNF_CASE onto server.nextMysteryCases together with MYSTERY_DNF_SEED.
// Re-picked for the final sim (director + Slurp + compact maps, 2026-10-24): 'f…' finishes in 114 / 163 / 102 s,
// careless '6…' is defeated in Case 01 after 45 s.
export const MYSTERY_FINISH_SEED = 'f'.repeat(32);
export const MYSTERY_DNF_SEED = '6'.repeat(32);
export const MYSTERY_DNF_CASE: CaseId = 'poisoned_archive';
/** Bot runs at 60 Hz with the final sim take ~5–20 s of wall time each: the mystery integration files use this timeout. */
export const MYSTERY_TEST_TIMEOUT_MS = 300_000;

/** Deterministic timers for the uploader / heartbeat / finalize back-off (advance() fires what is due, in order). */
export class ManualTimers implements Timers {
  private t = 0;
  private seq = 0;
  private readonly items = new Map<number, { at: number; fn: () => void; every: number | null }>();
  setTimeout(fn: () => void, ms: number): unknown {
    const id = ++this.seq;
    this.items.set(id, { at: this.t + ms, fn, every: null });
    return id;
  }
  clearTimeout(h: unknown): void {
    this.items.delete(h as number);
  }
  setInterval(fn: () => void, ms: number): unknown {
    const id = ++this.seq;
    this.items.set(id, { at: this.t + ms, fn, every: Math.max(1, ms) });
    return id;
  }
  clearInterval(h: unknown): void {
    this.items.delete(h as number);
  }
  pending(): number {
    return this.items.size;
  }
  advance(ms: number): void {
    const end = this.t + ms;
    for (;;) {
      let nextId: number | null = null;
      let next: { at: number; fn: () => void; every: number | null } | null = null;
      for (const [id, it] of this.items) if (it.at <= end && (!next || it.at < next.at)) [nextId, next] = [id, it];
      if (!next || nextId === null) break;
      this.t = next.at;
      if (next.every === null) this.items.delete(nextId);
      else next.at += next.every;
      next.fn();
    }
    this.t = end;
  }
}

/** Plays a verified run like the kiosk does (sim at 60 Hz, bot decisions held between frames), driving the
 *  controller's hooks exactly as useMysteryLoop does. Every 2 s of sim time the timers advance and I/O settles. */
export async function driveRun(
  controller: LiveController,
  session: { sessionId: string; seed: string; caseId: CaseId; selected: Duo | null; offer: { cards: readonly Duo[] } },
  opts: {
    stationId: StationId; timers: ManualTimers; profile?: 'stealthy' | 'careless'; maxS?: number;
    /** Replace the bot's accusation (the run still sanitizes it, exactly like the app). */
    accusation?: (run: MysteryRun, bot: Accusation) => Accusation;
    /** Called every 2 s of sim time (after I/O settled). */
    onChunk?: (run: MysteryRun) => void | Promise<void>;
    /** Wraps the analytics batch source (tampering tests). */
    source?: (a: MysteryAnalytics) => MysteryAnalytics;
  },
): Promise<{ run: MysteryRun; analytics: MysteryAnalytics }> {
  // the kiosk plays the case the SERVER assigned (LiveSessionData.caseId)
  // ... sealed, in the session's suspect order; the found clues' texts arrive with the append acks (liveRun onAck)
  const run = new MysteryRun({ duo: session.selected!, seed: session.seed, tutorial: false, caseDef: sessionCaseDef(caseById(session.caseId), session.seed) });
  const real = createMysteryAnalytics(run, {
    sessionId: session.sessionId, stationId: opts.stationId, offered: session.offer.cards.map((c) => ({ characterId: c.characterId, pokemonId: c.pokemonId })),
  });
  const analytics = opts.source ? opts.source(real) : real;
  const bot = new Bot(run, { profile: opts.profile ?? 'stealthy', maxTimeS: opts.maxS ?? 600 }, session.seed);
  const every = Math.max(1, Math.round(60 / bot.o.decisionHz));
  controller.hooks.runStarted(run, analytics);
  let held = bot.decide();
  let step = 0;
  while (run.status === 'playing' && run.t < (opts.maxS ?? 600)) {
    const input = step % every === 0 ? (held = bot.decide()) : { ...held, lookYawDelta: 0, lookPitchDelta: 0, interact: false, power: false, move: false, hint: false };
    step++;
    real.frame(run, run.update(1 / 60, input));
    if (step % 120 === 0) {
      opts.timers.advance(2000);
      await settle(8);
      await opts.onChunk?.(run);
    }
  }
  if (run.status === 'accusing') {
    controller.hooks.flushNow('deposit');
    opts.timers.advance(2000);
    await settle(8); // the last found clue's text arrives with this ack
    // the app loads the answer key only now, for the murderer the READ clues imply (the server's verdict decides)
    const accusation = opts.accusation ? opts.accusation(run, bot.accusation()) : bot.accusation();
    real.frame(run, run.accuse(accusation, caseSolution(run.caseDef.id, provisionalCulprit(run.caseDef, run.cluesFound, accusation.suspectId))));
  }
  controller.hooks.runEnded(run, analytics);
  return { run, analytics };
}
