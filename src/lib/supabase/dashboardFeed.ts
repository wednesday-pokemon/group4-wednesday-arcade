// LIVE DashboardFeed (works for anonymous spectators: anon key + RLS SELECT on the public projections).
// Initial REST loads of verified_leaderboard / defeated_log / station_status, then Realtime postgres_changes
// (station_status UPDATE, leaderboard_entries INSERT/DELETE). Tolerates duplicate and out-of-order events,
// refetches after every (re)subscribe, and polls REST while Realtime is not connected (e.g. venue firewalls).
import type { RealtimePostgresChangesPayload, SupabaseClient } from '@supabase/supabase-js';
import { rankLeaderboard } from '../../game/index.ts';
import type { ScoreRecord } from '../../game/index.ts';
import type { ConnectionState, DashboardFeed, DashboardSnapshot, StationStatus } from '../backend.ts';
import {
  DEFEATED_COLUMNS, LEADERBOARD_COLUMNS, STATION_STATUS_COLUMNS, isNewerStationRow, mapScoreRow, mapStationRow,
  type LeaderboardRow, type StationStatusRow,
} from './mappers.ts';
import {
  browserOnline, connectionFrom, openManagedChannel, type ChannelPhase, type ManagedChannel, type OnlineSource, type RealtimeHost,
} from './realtime.ts';

export interface LiveDashboardDeps {
  rest: Pick<SupabaseClient, 'from'>;
  realtime: RealtimeHost;
  online?: OnlineSource;
  /** REST poll interval while Realtime is not connected (ms). */
  pollMs?: number;
  leaderboardLimit?: number;
  defeatedLimit?: number;
}

type JournalEntry = { seq: number; op: 'upsert'; record: ScoreRecord } | { seq: number; op: 'delete'; sessionId: string };

/** Pure, testable state of the feed. */
export class DashboardState {
  readonly leaderboard = new Map<string, ScoreRecord>();
  readonly defeated = new Map<string, ScoreRecord>();
  readonly stations = new Map<string, StationStatusRow>();
  private journal: JournalEntry[] = [];
  private seq = 0;
  private loadCounter = 0;
  private appliedLoad = 0;
  private readonly inflight = new Map<number, number>(); // load id -> journal seq at start

  private applyRecord(record: ScoreRecord): void {
    if (record.status === 'completed') this.leaderboard.set(record.sessionId, record);
    else if (record.status === 'dnf') this.defeated.set(record.sessionId, record);
  }

  private applyDelete(sessionId: string): void {
    this.leaderboard.delete(sessionId);
    this.defeated.delete(sessionId);
  }

  /** Realtime leaderboard_entries INSERT (duplicates are idempotent: keyed by session_id). */
  insertEntry(row: LeaderboardRow): boolean {
    const record = mapScoreRow(row, row.status === 'dnf' ? 'dnf' : 'completed');
    if (!record) return false;
    this.journal.push({ seq: ++this.seq, op: 'upsert', record });
    this.applyRecord(record);
    return true;
  }

  /** Realtime leaderboard_entries DELETE (operator nickname moderation). */
  deleteEntry(sessionId: string): boolean {
    if (!sessionId) return false;
    this.journal.push({ seq: ++this.seq, op: 'delete', sessionId });
    this.applyDelete(sessionId);
    return true;
  }

  /** Station row from REST or Realtime; kept only when newer than what we have (see isNewerStationRow). */
  mergeStation(row: StationStatusRow): boolean {
    if (!row || typeof row.station_id !== 'string') return false;
    if (!isNewerStationRow(row, this.stations.get(row.station_id))) return false;
    this.stations.set(row.station_id, row);
    return true;
  }

  beginLoad(): number {
    const id = ++this.loadCounter;
    this.inflight.set(id, this.seq);
    return id;
  }

  failLoad(id: number): void {
    this.inflight.delete(id);
    this.trimJournal();
  }

  /**
   * Applies a full REST snapshot. Results of a load that started before an already-applied load are
   * dropped; Realtime events that arrived while this load was in flight are re-applied on top.
   */
  completeLoad(id: number, leaderboard: LeaderboardRow[], defeated: LeaderboardRow[], stations: StationStatusRow[]): boolean {
    const startSeq = this.inflight.get(id) ?? this.seq;
    this.inflight.delete(id);
    stations.forEach((row) => this.mergeStation(row));
    if (id < this.appliedLoad) {
      this.trimJournal();
      return true;
    }
    this.appliedLoad = id;
    this.leaderboard.clear();
    this.defeated.clear();
    leaderboard.forEach((row) => {
      const r = mapScoreRow(row, 'completed');
      if (r) this.applyRecord(r);
    });
    defeated.forEach((row) => {
      const r = mapScoreRow(row, 'dnf');
      if (r) this.applyRecord(r);
    });
    for (const entry of this.journal) {
      if (entry.seq <= startSeq) continue;
      if (entry.op === 'upsert') this.applyRecord(entry.record);
      else this.applyDelete(entry.sessionId);
    }
    this.trimJournal();
    return true;
  }

  private trimJournal(): void {
    if (this.inflight.size === 0) {
      this.journal = [];
      return;
    }
    const oldest = Math.min(...this.inflight.values());
    this.journal = this.journal.filter((e) => e.seq > oldest);
  }

  snapshot(connection: ConnectionState, now = new Date().toISOString()): DashboardSnapshot {
    const stations = [...this.stations.values()]
      .map(mapStationRow)
      .filter((s): s is StationStatus => s !== null)
      .sort((a, b) => String(a.stationId).localeCompare(String(b.stationId)));
    const defeated = [...this.defeated.values()].sort(
      (a, b) => b.completedAt.localeCompare(a.completedAt) || a.sessionId.localeCompare(b.sessionId),
    );
    return {
      mode: 'live',
      connection,
      leaderboard: rankLeaderboard([...this.leaderboard.values()]),
      defeated,
      stations,
      updatedAt: now,
    };
  }
}

export interface LiveDashboardFeed extends DashboardFeed {
  /** Current connection state (for diagnostics/tests). */
  connection(): ConnectionState;
}

export function createLiveDashboardFeed(deps: LiveDashboardDeps): LiveDashboardFeed {
  const online = deps.online ?? browserOnline;
  const pollMs = deps.pollMs ?? 15_000;
  const state = new DashboardState();
  const listeners = new Set<(s: DashboardSnapshot) => void>();
  let phase: ChannelPhase | null = null;
  let isOnline = online.isOnline();
  let ready = false;
  let channel: ManagedChannel | null = null;
  let stopOnline: (() => void) | null = null;
  let poll: ReturnType<typeof setInterval> | null = null;

  const connection = () => connectionFrom(isOnline, phase);
  const emit = () => {
    if (!ready) return;
    const snap = state.snapshot(connection());
    listeners.forEach((l) => l(snap));
  };

  async function load(): Promise<void> {
    const id = state.beginLoad();
    try {
      const [lb, df, st] = await Promise.all([
        deps.rest.from('verified_leaderboard').select(LEADERBOARD_COLUMNS).order('rank', { ascending: true }).limit(deps.leaderboardLimit ?? 500),
        deps.rest.from('defeated_log').select(DEFEATED_COLUMNS).order('verified_at', { ascending: false }).limit(deps.defeatedLimit ?? 100),
        deps.rest.from('station_status').select(STATION_STATUS_COLUMNS),
      ]);
      const error = lb.error ?? df.error ?? st.error;
      if (error) throw new Error(error.message);
      state.completeLoad(
        id,
        (lb.data ?? []) as unknown as LeaderboardRow[],
        (df.data ?? []) as unknown as LeaderboardRow[],
        (st.data ?? []) as unknown as StationStatusRow[],
      );
    } catch (err) {
      state.failLoad(id);
      throw err;
    } finally {
      ready = true;
      emit();
    }
  }

  const safeLoad = () => {
    load().catch(() => undefined); // the snapshot's connection state already tells the UI it may be stale
  };

  function start(): void {
    channel = openManagedChannel(deps.realtime, {
      topic: 'regatta-dashboard',
      bind: (ch) =>
        ch
          .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'station_status' }, (payload: RealtimePostgresChangesPayload<StationStatusRow>) => {
            if (payload.eventType === 'UPDATE' && state.mergeStation(payload.new)) emit();
          })
          .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'leaderboard_entries' }, (payload: RealtimePostgresChangesPayload<LeaderboardRow>) => {
            if (payload.eventType === 'INSERT' && state.insertEntry(payload.new)) emit();
          })
          .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'leaderboard_entries' }, (payload: RealtimePostgresChangesPayload<LeaderboardRow>) => {
            if (payload.eventType === 'DELETE' && state.deleteEntry(String(payload.old.session_id ?? ''))) emit();
          }),
      onPhase: (p) => {
        phase = p;
        emit();
      },
      onSubscribed: safeLoad,
    });
    stopOnline = online.subscribe((value) => {
      isOnline = value;
      emit();
      if (value) {
        channel?.kick();
        safeLoad();
      }
    });
    poll = setInterval(() => {
      if (connection() !== 'connected') safeLoad();
    }, pollMs);
    safeLoad();
  }

  function stop(): void {
    channel?.stop();
    channel = null;
    stopOnline?.();
    stopOnline = null;
    if (poll !== null) clearInterval(poll);
    poll = null;
    phase = null;
  }

  return {
    mode: 'live',
    connection,
    subscribe(listener) {
      listeners.add(listener);
      if (listeners.size === 1) start();
      else if (ready) listener(state.snapshot(connection()));
      return () => {
        if (!listeners.delete(listener)) return;
        if (listeners.size === 0) stop();
      };
    },
    refresh: load,
  };
}
