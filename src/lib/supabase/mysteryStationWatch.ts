// Station-side Realtime for the mystery kiosk:
//  * connection state (Realtime channel + navigator.onLine) for the header badge / "Offline" chip;
//  * operator reset watch: this station's `mystery_station_status` row turning idle with notice 'operator_reset'.
//    The notice is attributed to the session this kiosk shows and CONFIRMED with mystery-get-session first, so a
//    stale notice (late REST answer, duplicate event) can never wipe a live run;
//  * heartbeat sender: an ephemeral Realtime broadcast every ~2 s so Laptop 1 can show "Signal lost" after 15 s.
import type { RealtimeChannel, RealtimePostgresChangesPayload, SupabaseClient } from '@supabase/supabase-js';
import type { StationId } from '../../game/index.ts';
import type { ConnectionState } from '../backend.ts';
import {
  HEARTBEAT_EVENT, HEARTBEAT_TOPIC, MYSTERY_STATION_COLUMNS, isNewerMysteryRow, type MysteryHeartbeat, type MysteryStationRow,
} from './mysteryWire.ts';
import {
  browserOnline, connectionFrom, openManagedChannel, type ChannelPhase, type ManagedChannel, type OnlineSource, type RealtimeHost,
} from './realtime.ts';

export type MysteryResetCheck = 'reset' | 'active' | 'unknown';

export type MysteryStationEvent =
  | { type: 'connection'; state: ConnectionState }
  | { type: 'reset_by_operator'; sessionId: string };

export interface MysteryStationWatchDeps {
  stationId: StationId;
  rest: Pick<SupabaseClient, 'from'>;
  realtime: RealtimeHost;
  /** Asks the server whether `sessionId` was abandoned by an operator. */
  confirmReset(sessionId: string): Promise<MysteryResetCheck>;
  online?: OnlineSource;
  retryDelaysMs?: number[];
}

export interface MysteryStationWatch {
  subscribe(listener: (event: MysteryStationEvent) => void): () => void;
  /** The session this kiosk currently shows; `active` = offered / playing (a reset may end it). */
  track(sessionId: string | null, active: boolean): void;
  connection(): ConnectionState;
  /** Sends one heartbeat (dropped while the broadcast channel is not joined). */
  heartbeat(beat: MysteryHeartbeat): boolean;
}

/** A broadcast channel with a FIXED topic (all kiosks and the board must share it), re-created after errors. */
export function openBroadcastChannel(
  host: RealtimeHost,
  opts: { topic: string; bind?(ch: RealtimeChannel): RealtimeChannel; onPhase?(p: ChannelPhase): void; retryDelaysMs?: number[] },
): { send(event: string, payload: unknown): boolean; kick(): void; stop(): void } {
  const delays = opts.retryDelaysMs ?? [2000, 5000, 10_000, 20_000, 30_000];
  let current: RealtimeChannel | null = null;
  let joined = false;
  let failures = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;

  function create(): void {
    const raw = host.channel(opts.topic, { config: { broadcast: { self: false, ack: false } } });
    const channel = opts.bind ? opts.bind(raw) : raw;
    current = channel;
    joined = false;
    opts.onPhase?.('connecting');
    channel.subscribe((status) => {
      if (stopped || channel !== current) return;
      if (status === 'SUBSCRIBED') {
        joined = true;
        failures = 0;
        opts.onPhase?.('SUBSCRIBED');
        return;
      }
      joined = false;
      opts.onPhase?.(status);
      if (timer === null) {
        const delay = delays[Math.min(failures++, delays.length - 1)];
        timer = setTimeout(() => {
          timer = null;
          if (!stopped && !joined) recreate();
        }, delay);
      }
    });
  }

  function recreate(): void {
    const old = current;
    current = null;
    if (old) void host.removeChannel(old).catch(() => undefined);
    create();
  }

  create();
  return {
    send(event, payload) {
      if (!joined || !current) return false;
      void current.send({ type: 'broadcast', event, payload }).catch(() => undefined);
      return true;
    },
    kick() {
      if (stopped || joined) return;
      if (timer !== null) clearTimeout(timer);
      timer = null;
      recreate();
    },
    stop() {
      stopped = true;
      if (timer !== null) clearTimeout(timer);
      timer = null;
      const old = current;
      current = null;
      if (old) void host.removeChannel(old).catch(() => undefined);
    },
  };
}

export function createMysteryStationWatch(deps: MysteryStationWatchDeps): MysteryStationWatch {
  const online = deps.online ?? browserOnline;
  const listeners = new Set<(e: MysteryStationEvent) => void>();
  let isOnline = online.isOnline();
  let phase: ChannelPhase | null = null;
  let lastState: ConnectionState | null = null;
  let lastRow: MysteryStationRow | undefined;
  let tracked: { sessionId: string; active: boolean } | null = null;
  let channel: ManagedChannel | null = null;
  let beats: ReturnType<typeof openBroadcastChannel> | null = null;
  let stopOnline: (() => void) | null = null;
  const reported = new Set<string>();

  const connection = () => connectionFrom(isOnline, phase);
  const broadcast = (e: MysteryStationEvent) => listeners.forEach((l) => l(e));
  const emitConnection = () => {
    const next = connection();
    if (next === lastState) return;
    lastState = next;
    broadcast({ type: 'connection', state: next });
  };

  async function handleRow(row: MysteryStationRow): Promise<void> {
    if (!row || row.station_id !== deps.stationId) return;
    if (!isNewerMysteryRow(row, lastRow)) return;
    lastRow = row;
    if (row.status !== 'idle' || row.notice !== 'operator_reset') return;
    const t = tracked;
    if (!t || !t.active || reported.has(t.sessionId)) return;
    const check = await deps.confirmReset(t.sessionId).catch((): MysteryResetCheck => 'unknown');
    if (check !== 'reset') return; // stale notice or unreachable server: the run continues
    if (tracked?.sessionId !== t.sessionId || reported.has(t.sessionId)) return;
    reported.add(t.sessionId);
    broadcast({ type: 'reset_by_operator', sessionId: t.sessionId });
  }

  async function fetchOwnRow(): Promise<void> {
    const { data, error } = await deps.rest.from('mystery_station_status').select(MYSTERY_STATION_COLUMNS).eq('station_id', deps.stationId);
    if (error || !Array.isArray(data)) return;
    for (const row of data as unknown as MysteryStationRow[]) await handleRow(row);
  }

  function start(): void {
    const stationId = deps.stationId;
    channel = openManagedChannel(deps.realtime, {
      topic: `mystery-station-${stationId}`,
      bind: (ch) =>
        ch.on(
          'postgres_changes',
          { event: 'UPDATE', schema: 'public', table: 'mystery_station_status', filter: `station_id=eq.${stationId}` },
          (payload: RealtimePostgresChangesPayload<MysteryStationRow>) => {
            if (payload.eventType === 'UPDATE') void handleRow(payload.new as MysteryStationRow);
          },
        ),
      onPhase: (p) => {
        phase = p;
        emitConnection();
      },
      onSubscribed: () => void fetchOwnRow().catch(() => undefined), // notices missed while disconnected
      retryDelaysMs: deps.retryDelaysMs,
    });
    beats = openBroadcastChannel(deps.realtime, { topic: HEARTBEAT_TOPIC, retryDelaysMs: deps.retryDelaysMs });
    stopOnline = online.subscribe((value) => {
      isOnline = value;
      emitConnection();
      if (value) {
        channel?.kick();
        beats?.kick();
      }
    });
  }

  function stop(): void {
    channel?.stop();
    channel = null;
    beats?.stop();
    beats = null;
    stopOnline?.();
    stopOnline = null;
    phase = null;
    lastState = null;
  }

  return {
    subscribe(listener) {
      listeners.add(listener);
      const first = listeners.size === 1;
      if (first) start();
      if (!first || lastState === null) {
        lastState = connection();
        listener({ type: 'connection', state: lastState });
      }
      return () => {
        if (!listeners.delete(listener)) return;
        if (listeners.size === 0) stop();
      };
    },
    track(sessionId, active) {
      tracked = sessionId ? { sessionId, active } : null;
      // A reset that landed while nothing active was shown is still visible in the row: re-check it.
      if (tracked?.active && lastRow) {
        const row = lastRow;
        lastRow = undefined;
        void handleRow(row);
      }
    },
    connection,
    heartbeat(beat) {
      return beats?.send(HEARTBEAT_EVENT, beat) ?? false;
    },
  };
}
