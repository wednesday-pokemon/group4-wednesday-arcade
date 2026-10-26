// Terminal-side station watch: connection state (Realtime channel + navigator.onLine) and operator resets.
// An operator reset shows up as this station's station_status row turning idle with notice 'operator_reset'.
// It is attributed to the session this terminal is showing; for a race still in progress the reset is
// confirmed with get-session first, so a stale notice (e.g. a late REST response) can never wipe a live race.
import type { RealtimePostgresChangesPayload, SupabaseClient } from '@supabase/supabase-js';
import type { StationId } from '../../game/index.ts';
import type { ConnectionState, StationEvent } from '../backend.ts';
import type { SessionTracker } from './liveBackend.ts';
import { STATION_STATUS_COLUMNS, isNewerStationRow, type StationStatusRow } from './mappers.ts';
import {
  browserOnline, connectionFrom, openManagedChannel, type ChannelPhase, type ManagedChannel, type OnlineSource, type RealtimeHost,
} from './realtime.ts';

export type ResetCheck = 'reset' | 'active' | 'unknown';

export interface StationWatchDeps {
  stationId: StationId | null;
  rest: Pick<SupabaseClient, 'from'>;
  realtime: RealtimeHost;
  tracker: SessionTracker;
  /** Asks the server whether `sessionId` was abandoned by an operator. */
  confirmReset(sessionId: string): Promise<ResetCheck>;
  online?: OnlineSource;
}

export interface StationWatch {
  subscribe(listener: (event: StationEvent) => void): () => void;
  /** Used by the backend when get-session itself reports an operator reset. */
  emitReset(reason: string): void;
  connection(): ConnectionState;
}

export function createStationWatch(deps: StationWatchDeps): StationWatch {
  const online = deps.online ?? browserOnline;
  const listeners = new Set<(e: StationEvent) => void>();
  let isOnline = online.isOnline();
  // Dashboards have no station channel: their terminal connection only follows navigator.onLine.
  let phase: ChannelPhase | null = deps.stationId ? null : 'SUBSCRIBED';
  let lastState: ConnectionState | null = null;
  let lastRow: StationStatusRow | undefined;
  let channel: ManagedChannel | null = null;
  let stopOnline: (() => void) | null = null;

  const connection = () => connectionFrom(isOnline, phase);
  const broadcast = (e: StationEvent) => listeners.forEach((l) => l(e));
  const emitConnection = () => {
    const next = connection();
    if (next === lastState) return;
    lastState = next;
    broadcast({ type: 'connection', state: next });
  };

  function emitReset(reason: string): void {
    deps.tracker.clear();
    broadcast({ type: 'reset_by_operator', reason });
  }

  async function handleRow(row: StationStatusRow): Promise<void> {
    if (!row || row.station_id !== deps.stationId) return;
    if (!isNewerStationRow(row, lastRow)) return;
    lastRow = row;
    if (row.status !== 'idle' || row.notice !== 'operator_reset') return;
    const tracked = deps.tracker.current();
    if (!tracked) return;
    if (tracked.status !== 'in_progress') return emitReset('operator_reset'); // finished race on screen: just release it
    const check = await deps.confirmReset(tracked.sessionId).catch((): ResetCheck => 'unknown');
    if (check === 'active') return; // stale notice: the race is still running
    if (deps.tracker.current()?.sessionId === tracked.sessionId) emitReset('operator_reset');
  }

  async function fetchOwnRow(): Promise<void> {
    if (!deps.stationId) return;
    const { data, error } = await deps.rest.from('station_status').select(STATION_STATUS_COLUMNS).eq('station_id', deps.stationId);
    if (error || !Array.isArray(data)) return;
    for (const row of data as unknown as StationStatusRow[]) await handleRow(row);
  }

  function start(): void {
    if (deps.stationId) {
      const stationId = deps.stationId;
      channel = openManagedChannel(deps.realtime, {
        topic: `regatta-station-${stationId}`,
        bind: (ch) =>
          ch.on(
            'postgres_changes',
            { event: 'UPDATE', schema: 'public', table: 'station_status', filter: `station_id=eq.${stationId}` },
            (payload: RealtimePostgresChangesPayload<StationStatusRow>) => {
              if (payload.eventType === 'UPDATE') void handleRow(payload.new);
            },
          ),
        onPhase: (p) => {
          phase = p;
          emitConnection();
        },
        onSubscribed: () => void fetchOwnRow().catch(() => undefined), // catch notices missed while disconnected
      });
    }
    stopOnline = online.subscribe((value) => {
      isOnline = value;
      emitConnection();
      if (value) channel?.kick();
    });
  }

  function stop(): void {
    channel?.stop();
    channel = null;
    stopOnline?.();
    stopOnline = null;
    if (deps.stationId) phase = null;
    lastState = null;
  }

  return {
    subscribe(listener) {
      listeners.add(listener);
      const first = listeners.size === 1;
      if (first) start(); // opening the channel already broadcasts 'connecting' to this listener
      if (!first || lastState === null) {
        lastState = connection();
        listener({ type: 'connection', state: lastState });
      }
      return () => {
        if (!listeners.delete(listener)) return;
        if (listeners.size === 0) stop();
      };
    },
    emitReset,
    connection,
  };
}
