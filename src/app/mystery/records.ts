// LOCAL DEMO persistence for the Laptop 1 mystery dashboard (until the Supabase deploy provides the live feed):
//  - 'raven.mystery.records': finished / DNF sessions as analytics SessionRecords (events thinned exactly like the
//    upload, capped at MAX_RECORDS newest), plus the nickname and end time for the standings;
//  - 'raven.mystery.live': this station's live status (phase, duo, clues, egg, HP, Hyde, risk, advice), refreshed ~1 Hz.
// Pure functions over an injected Storage so they are unit-testable. Never stores seeds or who was accused.
import { thinForUpload } from '../../mystery/analytics/telemetry.ts';
import type { SessionRecord } from '../../mystery/analytics/types.ts';
import type { Duo, HydeMode } from '../../mystery/types.ts';

export const RECORDS_KEY = 'raven.mystery.records';
export const LIVE_KEY = 'raven.mystery.live';
export const MAX_RECORDS = 200;

type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null;

export interface StoredRecord {
  record: SessionRecord;
  nickname: string;
  stationId: string;
  endedAt: string;
}

export function loadRecords(storage: Store): StoredRecord[] {
  try {
    const raw = storage?.getItem(RECORDS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as StoredRecord[]).filter((r) => r && typeof r === 'object' && r.record && Array.isArray(r.record.events)) : [];
  } catch {
    return [];
  }
}

/** Thin + strip a record for storage (no seeds, no accusation details). */
export function compactRecord(r: SessionRecord): SessionRecord {
  const events = thinForUpload(r.events).map((e) => (e.type === 'accusation' ? { ...e, suspectId: 'redacted' as never } : e));
  return { ...r, events };
}

/** Adds (or replaces, by sessionId) a record, keeping the newest MAX_RECORDS. Shrinks further if the quota is hit. */
export function appendRecord(storage: Store, rec: StoredRecord, max = MAX_RECORDS): StoredRecord[] {
  const next = [...loadRecords(storage).filter((r) => r.record.sessionId !== rec.record.sessionId), { ...rec, record: compactRecord(rec.record) }].slice(-max);
  let keep = next;
  for (;;) {
    try {
      storage?.setItem(RECORDS_KEY, JSON.stringify(keep));
      return keep;
    } catch {
      if (keep.length <= 1) return keep;
      keep = keep.slice(Math.ceil(keep.length / 4)); // quota: drop the oldest quarter and retry
    }
  }
}

export function clearRecords(storage: Store): void {
  try {
    storage?.removeItem(RECORDS_KEY);
  } catch {
    // ignore
  }
}

export type LivePhase = 'idle' | 'name' | 'duo' | 'tutorial' | 'investigating' | 'carrying' | 'accusing' | 'results' | 'dnf';

export interface LiveStatus {
  stationId: string;
  phase: LivePhase;
  nickname: string;
  duo: Duo | null;
  clues: number;
  egg: { state: string; tier: string | null; security: number } | null;
  hp: number | null;
  catches: number | null;
  hydeMode: HydeMode | null;
  risk: { p: number; label: string } | null;
  advice: { text: string; followed: boolean | null } | null;
  activeTimeS: number | null;
  updatedAt: number;
}

export function writeLive(storage: Store, s: LiveStatus): void {
  try {
    storage?.setItem(LIVE_KEY, JSON.stringify(s));
  } catch {
    // ignore
  }
}

export function readLive(storage: Store): LiveStatus | null {
  try {
    const raw = storage?.getItem(LIVE_KEY);
    return raw ? (JSON.parse(raw) as LiveStatus) : null;
  } catch {
    return null;
  }
}

export function browserStorage(): Store {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}
