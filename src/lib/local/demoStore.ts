// LOCAL DEMO persistence: browser storage + BroadcastChannel so a dashboard tab in the SAME browser can watch.
// Everything here is UNVERIFIED and never represents official cross-laptop standings.
import { rankLeaderboard } from '../../game/index.ts';
import type { ScoreRecord, TelemetryEvent } from '../../game/index.ts';
import type { DashboardFeed, DashboardSnapshot, StationStatus } from '../backend.ts';

const STORE_KEY = 'raven-regatta:demo:v2.5';
const CHANNEL = 'raven-regatta-demo';
const MAX_RECORDS = 200;
const MAX_TELEMETRY = 600;

export interface DemoData {
  records: ScoreRecord[];
  station: StationStatus | null;
  telemetry: TelemetryEvent[];
}

const EMPTY: DemoData = { records: [], station: null, telemetry: [] };

function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

export function readDemoData(): DemoData {
  try {
    const raw = storage()?.getItem(STORE_KEY);
    return raw ? { ...EMPTY, ...(JSON.parse(raw) as DemoData) } : { ...EMPTY };
  } catch {
    return { ...EMPTY };
  }
}

function writeDemoData(data: DemoData): void {
  try {
    storage()?.setItem(STORE_KEY, JSON.stringify(data));
  } catch {
    // Storage full or blocked: the demo keeps working in memory.
  }
  try {
    const channel = new BroadcastChannel(CHANNEL);
    channel.postMessage('changed');
    channel.close();
  } catch {
    // BroadcastChannel unavailable: dashboard falls back to polling.
  }
}

export function updateDemoData(mutate: (data: DemoData) => DemoData): void {
  const next = mutate(readDemoData());
  writeDemoData({
    records: next.records.slice(-MAX_RECORDS),
    station: next.station,
    telemetry: next.telemetry.slice(-MAX_TELEMETRY),
  });
}

export function upsertRecord(records: ScoreRecord[], record: ScoreRecord): ScoreRecord[] {
  return [...records.filter((r) => r.sessionId !== record.sessionId), record];
}

export function clearDemoData(): void {
  writeDemoData({ ...EMPTY });
}

export function buildDemoSnapshot(data: DemoData): DashboardSnapshot {
  return {
    mode: 'local_demo',
    connection: 'connected',
    leaderboard: rankLeaderboard(data.records),
    defeated: data.records.filter((r) => r.status === 'dnf').sort((a, b) => b.completedAt.localeCompare(a.completedAt)),
    stations: data.station ? [data.station] : [],
    updatedAt: new Date().toISOString(),
  };
}

const POLL_MS = 3000;

export function createDemoDashboardFeed(): DashboardFeed {
  return {
    mode: 'local_demo',
    subscribe(listener) {
      const emit = () => listener(buildDemoSnapshot(readDemoData()));
      emit();
      let channel: BroadcastChannel | null = null;
      try {
        channel = new BroadcastChannel(CHANNEL);
        channel.onmessage = emit;
      } catch {
        channel = null;
      }
      const timer = setInterval(emit, POLL_MS);
      return () => {
        clearInterval(timer);
        channel?.close();
      };
    },
    async refresh() {
      /* subscribers re-read on every broadcast/poll */
    },
  };
}
