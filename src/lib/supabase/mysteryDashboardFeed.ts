// LIVE mystery board for Laptop 1 (anon key; operator sign-in adds event-level analytics).
//   REST:      mystery_station_status, mystery_standings_v4 (finishers above DNFs), mystery_results of THIS rules version
//              (MYSTERY_RULES_VERSION = 'mystery-v4'; v3.1 rows never mix into tonight's board — FINAL_CONTRACT §10)
//   Realtime:  postgres_changes on mystery_station_status (INSERT/UPDATE) and mystery_results (INSERT/DELETE),
//              plus the stations' heartbeat broadcast (liveness → "Signal lost" after 15 s)
//   Operator:  mystery_events / mystery_offered_duos / mystery_forecasts / mystery_recommendations per finalized
//              session (RLS: own station or operator), cached forever (finalized rows are immutable), rebuilt into
//              SessionRecords with eventFromRow for dashboard(records, clueIds).
// Tolerates duplicate / out-of-order Realtime delivery, refetches after every (re)subscribe, polls REST while Realtime
// is down. Pure state lives in MysteryBoardState (unit-testable).
// Cases: every row carries case_id; the snapshot offers the combined standings AND per-case standings. Public rows never
// carry who was accused or the cited evidence (column privileges + publicResultRow); nothing here reads them.
import type { RealtimeChannel, RealtimePostgresChangesPayload, SupabaseClient } from '@supabase/supabase-js';
import { isStationId } from '../../game/index.ts';
import type { StationId } from '../../game/index.ts';
import type { SessionRecord } from '../../mystery/analytics/types.ts';
import { MYSTERY_RULES_VERSION, type CaseId } from '../../mystery/types.ts';
import type { ConnectionState } from '../backend.ts';
import { openBroadcastChannel } from './mysteryStationWatch.ts';
import {
  HEARTBEAT_EVENT, HEARTBEAT_TOPIC, MYSTERY_RESULT_COLUMNS, MYSTERY_STANDING_COLUMNS, MYSTERY_STANDINGS_VIEW, MYSTERY_STATION_COLUMNS, SIGNAL_LOST_MS,
  isNewerMysteryRow, orderStandings, parseHeartbeat, publicResultRow, recordFromRows, standingFromResult, standingsByCase,
  type EventRow, type MysteryHeartbeat,
  type MysteryResultRow, type MysteryStandingRow, type MysteryStationRow, type SessionDetail,
} from './mysteryWire.ts';
import {
  browserOnline, connectionFrom, openManagedChannel, type ChannelPhase, type ManagedChannel, type OnlineSource, type RealtimeHost,
} from './realtime.ts';

export const BOARD_STATIONS: readonly StationId[] = ['station_a', 'station_b', 'station_c'];

export interface BoardStation {
  stationId: StationId;
  label: string;
  row: MysteryStationRow | null;
  heartbeat: MysteryHeartbeat | null;
  /** Dashboard clock (ms) of the last heartbeat; null = none since the board opened. */
  lastSeenAt: number | null;
  /** No heartbeat for SIGNAL_LOST_MS (after a start-up grace of the same length). */
  signalLost: boolean;
}

export interface MysteryBoardSnapshot {
  mode: 'live';
  connection: ConnectionState;
  stations: BoardStation[];
  /** Finishers (ranked) above DNFs (unranked), exactly the mystery_standings order, all cases (`rank` = combined). */
  standings: MysteryStandingRow[];
  /** The same rows per case (`rank` = rank within that case = `case_rank`); every case id present. */
  standingsByCase: Record<CaseId, MysteryStandingRow[]>;
  /** Verified sessions rebuilt for dashboard(records, clueIds). */
  records: SessionRecord[];
  /** True when the records carry events / offers / forecasts / advice (operator signed in). */
  detailed: boolean;
  /** Bumps whenever `records` changes (memoize expensive aggregates on it). */
  recordsVersion: number;
  loaded: boolean;
  error: string | null;
  updatedAt: number;
}

/** Pure, testable state of the board. */
export class MysteryBoardState {
  readonly stations = new Map<string, MysteryStationRow>();
  readonly beats = new Map<string, { beat: MysteryHeartbeat; at: number }>();
  readonly results = new Map<string, MysteryResultRow>();
  readonly details = new Map<string, SessionDetail>();
  standingRows: MysteryStandingRow[] = [];
  detailed = false;
  loaded = false;
  error: string | null = null;
  private readonly deleted = new Set<string>();
  /** Bumped on every change that affects records(); records() is cached per version. */
  version = 0;
  private cache: { version: number; records: SessionRecord[] } | null = null;

  constructor(readonly startedAt: number) {}

  touch(): void {
    this.version++;
  }

  mergeStation(row: MysteryStationRow | null | undefined): boolean {
    if (!row || !isStationId(row.station_id)) return false;
    if (!isNewerMysteryRow(row, this.stations.get(row.station_id))) return false;
    this.stations.set(row.station_id, row);
    return true;
  }

  heartbeat(raw: unknown, now: number): boolean {
    const beat = parseHeartbeat(raw);
    if (!beat) return false;
    this.beats.set(beat.stationId, { beat, at: now });
    return true;
  }

  /** Realtime INSERT (duplicates are idempotent: keyed by session_id). Test runs never reach the public board. */
  insertResult(raw: MysteryResultRow | null | undefined): boolean {
    const row = publicResultRow(raw);
    if (!row || row.is_test || row.rules_version !== MYSTERY_RULES_VERSION) return false;
    if (this.deleted.has(row.session_id)) return false;
    this.results.set(row.session_id, row);
    this.touch();
    if (!this.standingRows.some((s) => s.session_id === row.session_id)) {
      this.standingRows = orderStandings([...this.standingRows, standingFromResult(row)]);
    }
    return true;
  }

  /** Realtime DELETE (operator nickname moderation). */
  deleteResult(sessionId: string): boolean {
    if (!sessionId) return false;
    this.deleted.add(sessionId);
    this.results.delete(sessionId);
    this.details.delete(sessionId);
    this.standingRows = orderStandings(this.standingRows.filter((s) => s.session_id !== sessionId));
    this.touch();
    return true;
  }

  /** A full REST snapshot replaces results + standings (rows deleted meanwhile stay deleted). */
  applyLoad(stations: MysteryStationRow[], standings: MysteryStandingRow[], results: MysteryResultRow[]): void {
    stations.forEach((r) => this.mergeStation(r));
    const keep = results.map(publicResultRow).filter((r): r is MysteryResultRow => r !== null && !r.is_test && r.rules_version === MYSTERY_RULES_VERSION && !this.deleted.has(r.session_id));
    this.results.clear();
    keep.forEach((r) => this.results.set(r.session_id, r));
    const fromRest = standings.filter((s) => !this.deleted.has(s.session_id));
    const missing = keep.filter((r) => !fromRest.some((s) => s.session_id === r.session_id)).map(standingFromResult);
    this.standingRows = orderStandings([...fromRest, ...missing]);
    this.loaded = true;
    this.error = null;
    this.touch();
  }

  records(): SessionRecord[] {
    if (this.cache?.version === this.version) return this.cache.records;
    const records = [...this.results.values()]
      .sort((a, b) => a.finalized_at.localeCompare(b.finalized_at) || a.session_id.localeCompare(b.session_id))
      .map((r) => recordFromRows(r, this.detailed ? this.details.get(r.session_id) ?? null : null));
    this.cache = { version: this.version, records };
    return records;
  }

  snapshot(connection: ConnectionState, now: number): MysteryBoardSnapshot {
    const stations = BOARD_STATIONS.map((id): BoardStation => {
      const row = this.stations.get(id) ?? null;
      const b = this.beats.get(id);
      const reference = b ? b.at : this.startedAt;
      return {
        stationId: id,
        label: row?.label ?? (id === 'station_a' ? 'Station A' : 'Station B'),
        row,
        heartbeat: b?.beat ?? null,
        lastSeenAt: b?.at ?? null,
        signalLost: now - reference > SIGNAL_LOST_MS,
      };
    });
    return {
      mode: 'live', connection, stations, standings: this.standingRows, standingsByCase: standingsByCase(this.standingRows),
      records: this.records(), detailed: this.detailed,
      recordsVersion: this.version, loaded: this.loaded, error: this.error, updatedAt: now,
    };
  }
}

export interface MysteryBoardFeed {
  subscribe(listener: (s: MysteryBoardSnapshot) => void): () => void;
  /** Full reload (also re-checks operator access for the event-level analytics). */
  refresh(): Promise<void>;
  connection(): ConnectionState;
}

export interface MysteryBoardDeps {
  rest: Pick<SupabaseClient, 'from'>;
  realtime: RealtimeHost;
  /** True while an operator is signed in on this page (event-level rows are readable). */
  isOperator(): Promise<boolean>;
  online?: OnlineSource;
  /** REST poll while Realtime is down (ms). */
  pollMs?: number;
  /** Re-render tick for "Signal lost" (ms). */
  tickMs?: number;
  now?: () => number;
  resultsLimit?: number;
  retryDelaysMs?: number[];
}

const PAGE = 1000;
const IN_CHUNK = 40;
const DETAIL_CONCURRENCY = 4;

async function pageAll<T>(fetchPage: (from: number, to: number) => PromiseLike<{ data: unknown; error: { message: string } | null }>): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await fetchPage(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as T[];
    out.push(...rows);
    if (rows.length < PAGE) return out;
  }
}

/** Operator-only detail rows for a set of finalized sessions. */
export async function loadSessionDetails(rest: Pick<SupabaseClient, 'from'>, sessionIds: string[]): Promise<Map<string, SessionDetail>> {
  const out = new Map<string, SessionDetail>();
  for (const id of sessionIds) out.set(id, { events: [], offered: [], forecasts: [], recommendations: [] });
  for (let i = 0; i < sessionIds.length; i += IN_CHUNK) {
    const ids = sessionIds.slice(i, i + IN_CHUNK);
    const [offered, forecasts, recs] = await Promise.all([
      pageAll<{ session_id: string; slot: number; character_id: string; pokemon_id: string }>((a, b) =>
        rest.from('mystery_offered_duos').select('session_id,slot,character_id,pokemon_id').in('session_id', ids).order('session_id').order('slot').range(a, b)),
      pageAll<{ session_id: string; forecast_no: number; t: number; target: string; value: number; model_label: string }>((a, b) =>
        rest.from('mystery_forecasts').select('session_id,forecast_no,t,target,value,model_label').in('session_id', ids).order('session_id').order('forecast_no').range(a, b)),
      pageAll<{ session_id: string; rec_no: number; action: string; accepted: boolean | null; outcome: string | null }>((a, b) =>
        rest.from('mystery_recommendations').select('session_id,rec_no,action,accepted,outcome').in('session_id', ids).order('session_id').order('rec_no').range(a, b)),
    ]);
    for (const o of offered) out.get(o.session_id)?.offered.push(o);
    for (const f of forecasts) out.get(f.session_id)?.forecasts.push(f);
    for (const r of recs) out.get(r.session_id)?.recommendations.push(r);
  }
  // Events: per session (a run can hold thousands), a few sessions at a time.
  let next = 0;
  const worker = async () => {
    while (next < sessionIds.length) {
      const id = sessionIds[next++]!;
      const rows = await pageAll<EventRow>((a, b) =>
        rest.from('mystery_events').select('seq,t,type,payload').eq('session_id', id).order('seq', { ascending: true }).range(a, b));
      out.get(id)!.events = rows;
    }
  };
  await Promise.all(Array.from({ length: Math.min(DETAIL_CONCURRENCY, sessionIds.length) }, worker));
  return out;
}

export function createMysteryBoardFeed(deps: MysteryBoardDeps): MysteryBoardFeed {
  const online = deps.online ?? browserOnline;
  const now = deps.now ?? Date.now;
  const state = new MysteryBoardState(now());
  const listeners = new Set<(s: MysteryBoardSnapshot) => void>();
  let phase: ChannelPhase | null = null;
  let isOnline = online.isOnline();
  let channel: ManagedChannel | null = null;
  let beats: ReturnType<typeof openBroadcastChannel> | null = null;
  let stopOnline: (() => void) | null = null;
  let poll: ReturnType<typeof setInterval> | null = null;
  let tick: ReturnType<typeof setInterval> | null = null;
  let loadSeq = 0;
  let standingsTimer: ReturnType<typeof setTimeout> | null = null;
  let detailQueue: Promise<void> = Promise.resolve();

  const connection = () => connectionFrom(isOnline, phase);
  const emit = () => {
    const snap = state.snapshot(connection(), now());
    listeners.forEach((l) => l(snap));
  };

  /** Fetch details for finalized sessions not cached yet (operator only). Serialized; errors leave the cache as is. */
  function loadMissingDetails(): Promise<void> {
    detailQueue = detailQueue.then(async () => {
      if (!state.detailed) return;
      const missing = [...state.results.keys()].filter((id) => !state.details.has(id));
      if (missing.length === 0) return;
      try {
        const loaded = await loadSessionDetails(deps.rest, missing);
        for (const [id, d] of loaded) state.details.set(id, d);
        state.touch();
        emit();
      } catch {
        // keep the board running on result-level data; the next load retries
      }
    });
    return detailQueue;
  }

  async function load(): Promise<void> {
    const id = ++loadSeq;
    try {
      const [st, sd, rs, operator] = await Promise.all([
        deps.rest.from('mystery_station_status').select(MYSTERY_STATION_COLUMNS),
        deps.rest.from(MYSTERY_STANDINGS_VIEW).select(MYSTERY_STANDING_COLUMNS).limit(deps.resultsLimit ?? 1000),
        deps.rest.from('mystery_results').select(MYSTERY_RESULT_COLUMNS).eq('rules_version', MYSTERY_RULES_VERSION)
          .order('finalized_at', { ascending: false }).limit(deps.resultsLimit ?? 1000),
        deps.isOperator().catch(() => false),
      ]);
      const error = st.error ?? sd.error ?? rs.error;
      if (error) throw new Error(error.message);
      if (id !== loadSeq) return; // a newer load started meanwhile; it will apply its own snapshot
      state.applyLoad(
        (st.data ?? []) as unknown as MysteryStationRow[],
        (sd.data ?? []) as unknown as MysteryStandingRow[],
        (rs.data ?? []) as unknown as MysteryResultRow[],
      );
      if (state.detailed !== operator) {
        state.detailed = operator;
        if (!operator) state.details.clear();
        state.touch();
      }
      emit();
      await loadMissingDetails();
    } catch (err) {
      state.error = err instanceof Error ? err.message : String(err);
      emit();
      throw err;
    }
  }
  const safeLoad = () => void load().catch(() => undefined);

  /** Standings ranks come from the view: refetch shortly after a result arrives (several may arrive together). */
  function refreshStandingsSoon(): void {
    if (standingsTimer !== null) return;
    standingsTimer = setTimeout(() => {
      standingsTimer = null;
      void (async () => {
        const { data, error } = await deps.rest.from(MYSTERY_STANDINGS_VIEW).select(MYSTERY_STANDING_COLUMNS).limit(deps.resultsLimit ?? 1000);
        if (error || !Array.isArray(data)) return;
        state.applyLoad([], data as unknown as MysteryStandingRow[], [...state.results.values()]);
        emit();
      })().catch(() => undefined);
    }, 300);
  }

  function bind(ch: RealtimeChannel): RealtimeChannel {
    return ch
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'mystery_station_status' }, (p: RealtimePostgresChangesPayload<MysteryStationRow>) => {
        if (p.eventType === 'INSERT' && state.mergeStation(p.new as MysteryStationRow)) emit();
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'mystery_station_status' }, (p: RealtimePostgresChangesPayload<MysteryStationRow>) => {
        if (p.eventType === 'UPDATE' && state.mergeStation(p.new as MysteryStationRow)) emit();
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'mystery_results' }, (p: RealtimePostgresChangesPayload<MysteryResultRow>) => {
        if (p.eventType === 'INSERT' && state.insertResult(p.new as MysteryResultRow)) {
          emit();
          refreshStandingsSoon();
          void loadMissingDetails();
        }
      })
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'mystery_results' }, (p: RealtimePostgresChangesPayload<MysteryResultRow>) => {
        if (p.eventType === 'DELETE' && state.deleteResult(String((p.old as Partial<MysteryResultRow>).session_id ?? ''))) emit();
      });
  }

  function start(): void {
    channel = openManagedChannel(deps.realtime, {
      topic: 'mystery-board',
      bind,
      onPhase: (p) => {
        phase = p;
        emit();
      },
      onSubscribed: safeLoad,
      retryDelaysMs: deps.retryDelaysMs,
    });
    beats = openBroadcastChannel(deps.realtime, {
      topic: HEARTBEAT_TOPIC,
      retryDelaysMs: deps.retryDelaysMs,
      bind: (ch) => ch.on('broadcast', { event: HEARTBEAT_EVENT }, (msg: { payload?: unknown }) => {
        if (state.heartbeat(msg?.payload, now())) emit();
      }),
    });
    stopOnline = online.subscribe((value) => {
      isOnline = value;
      emit();
      if (value) {
        channel?.kick();
        beats?.kick();
        safeLoad();
      }
    });
    poll = setInterval(() => {
      if (connection() !== 'connected') safeLoad();
    }, deps.pollMs ?? 15_000);
    tick = setInterval(emit, deps.tickMs ?? 1000);
    safeLoad();
  }

  function stop(): void {
    channel?.stop();
    channel = null;
    beats?.stop();
    beats = null;
    stopOnline?.();
    stopOnline = null;
    if (poll !== null) clearInterval(poll);
    if (tick !== null) clearInterval(tick);
    if (standingsTimer !== null) clearTimeout(standingsTimer);
    poll = null;
    tick = null;
    standingsTimer = null;
    phase = null;
  }

  return {
    subscribe(listener) {
      listeners.add(listener);
      if (listeners.size === 1) start();
      else listener(state.snapshot(connection(), now()));
      return () => {
        if (!listeners.delete(listener)) return;
        if (listeners.size === 0) stop();
      };
    },
    refresh: load,
    connection,
  };
}
