// TelemetryCollector — the single ingestion point of the analytics layer for ONE session.
//
//   MysteryRun (StampedEvents + 1 Hz StateSnapshots) → TelemetryCollector → Descriptive / Diagnostic / Predictive /
//   Prescriptive services → Thing hints, HUD risk chip, results panels, dashboard aggregates, Supabase payloads.
//
// The log is append-only and immutable (frozen copies, strictly increasing seq; tutorial events with seq 0 and
// re-delivered events are ignored). Positions may be tracked per frame for the walked distance. Forecast and
// recommendation records are kept here too, shaped exactly like the `mystery_forecasts` / `mystery_recommendations`
// rows the `mystery-append-events` Edge Function accepts, and handed out in batches with an explicit ack so a failed
// upload is simply retried (the server ignores exact duplicates).
import type { CaseId, Duo, RunResult, Stance, StampedEvent } from '../types.ts';
import type { DuoFactors, ForecastRecord, RecommendationRecord, SupabaseBatch, TelemetrySample } from './types.ts';

export const MAX_BATCH_EVENTS = 500;
export const MAX_BATCH_ANALYTICS = 50;
/** A per-frame position jump longer than this is a teleport (safe release after a catch), not walking. */
export const MAX_STEP_JUMP_M = 6;

export interface TelemetryMeta {
  sessionId: string | null;
  stationId: string | null;
  /** The case this session plays (from run.caseDef); null / absent = unknown (legacy). */
  caseId?: CaseId | null;
  caseVersion?: number | null;
  duo: Duo;
  factors: DuoFactors;
}

/**
 * Upload thinning: every rule / state event is kept (clue_found, egg_*, catch, accusation, finish, dnf, hyde_*,
 * hint_requested, stance, room_enter, ability_*). Footstep `noise` events are dropped UNLESS the Hyde heard that step
 * (the next event is its `hyde_heard`) — those are evidence for the diagnostic causes.
 */
export function thinForUpload(events: readonly StampedEvent[]): StampedEvent[] {
  const out: StampedEvent[] = [];
  for (let i = 0; i < events.length; i++) {
    const e = events[i];
    if (e.type === 'noise' && e.source === 'footstep') {
      const next = events[i + 1];
      const heard = next !== undefined && next.type === 'hyde_heard' && next.source === 'footstep' && next.t === e.t;
      if (!heard) continue;
    }
    out.push(e);
  }
  return out;
}

interface RecEntry { record: RecommendationRecord; version: number; acked: number }

export class TelemetryCollector {
  readonly meta: TelemetryMeta;
  private readonly log: StampedEvent[] = [];
  private readonly sampleLog: TelemetrySample[] = [];
  private lastSeq = 0;
  private distance = 0;
  private lastPos: { x: number; z: number } | null = null;
  private tracked = false;
  private runResult: RunResult | null = null;
  private readonly forecastLog: ForecastRecord[] = [];
  private readonly forecastAcked = new Set<number>();
  private readonly recs = new Map<number, RecEntry>();
  private ackedSeq = 0;

  constructor(meta: TelemetryMeta) {
    this.meta = meta;
  }

  // ------------------------------------------------------------------------------------------------- ingestion

  /** Adds events (e.g. the array returned by `run.update`). Returns how many were new. */
  ingest(events: readonly StampedEvent[]): number {
    let added = 0;
    for (const e of events) {
      if (e.seq <= this.lastSeq) continue; // tutorial (seq 0) or already seen
      this.log.push(Object.freeze({ ...e }) as StampedEvent);
      this.lastSeq = e.seq;
      added++;
    }
    return added;
  }

  /** Catches up with a full run log (`run.log`), ingesting only what is new. */
  syncFromLog(log: readonly StampedEvent[]): number {
    // run.log holds seq 1, 2, 3, … in order, so the new tail starts at index lastSeq when the log is complete
    const start = log.length > this.lastSeq && log[this.lastSeq]?.seq === this.lastSeq + 1 ? this.lastSeq : 0;
    return this.ingest(start > 0 ? log.slice(start) : log);
  }

  addSample(sample: TelemetrySample): void {
    const last = this.sampleLog[this.sampleLog.length - 1];
    if (last && sample.snapshot.t < last.snapshot.t) return; // never out of order
    this.sampleLog.push(Object.freeze({
      snapshot: Object.freeze({ ...sample.snapshot }),
      context: sample.context ? Object.freeze({ ...sample.context }) : null,
    }));
  }

  /** Per-frame player position (walked distance). Teleports (> MAX_STEP_JUMP_M) are not counted. */
  trackPosition(x: number, z: number): void {
    this.tracked = true;
    if (this.lastPos) {
      const d = Math.hypot(x - this.lastPos.x, z - this.lastPos.z);
      if (d <= MAX_STEP_JUMP_M) this.distance += d;
    }
    this.lastPos = { x, z };
  }

  setResult(result: RunResult | null): void {
    if (result) this.runResult = Object.freeze({ ...result, cluesFound: [...result.cluesFound], evidence: [...(result.evidence ?? [])], duo: { ...result.duo } });
  }

  // ------------------------------------------------------------------------------------------------- reads

  get events(): readonly StampedEvent[] {
    return this.log;
  }

  get samples(): readonly TelemetrySample[] {
    return this.sampleLog;
  }

  get result(): RunResult | null {
    return this.runResult;
  }

  get lastEventSeq(): number {
    return this.lastSeq;
  }

  /** Walked metres, or null if positions were never tracked. */
  get distanceM(): number | null {
    return this.tracked ? Math.round(this.distance * 10) / 10 : null;
  }

  lastSample(): TelemetrySample | null {
    return this.sampleLog[this.sampleLog.length - 1] ?? null;
  }

  previousSample(): TelemetrySample | null {
    return this.sampleLog[this.sampleLog.length - 2] ?? null;
  }

  /** Stance at the start of the logged run (first sample), default idle. */
  initialStance(): Stance {
    return this.sampleLog[0]?.snapshot.stance ?? 'idle';
  }

  /** Latest active time seen (result → events → samples). */
  latestT(): number {
    if (this.runResult) return this.runResult.activeTimeS;
    const le = this.log[this.log.length - 1]?.t ?? 0;
    const ls = this.sampleLog[this.sampleLog.length - 1]?.snapshot.t ?? 0;
    return Math.max(le, ls);
  }

  terminal(): boolean {
    const last = this.log[this.log.length - 1];
    return last !== undefined && (last.type === 'finish' || last.type === 'dnf');
  }

  // ------------------------------------------------------------------------------------------------- analytics records

  addForecast(f: Omit<ForecastRecord, 'forecastNo'>): ForecastRecord {
    const rec: ForecastRecord = Object.freeze({ ...f, forecastNo: this.forecastLog.length, features: Object.freeze({ ...f.features }) }) as ForecastRecord;
    this.forecastLog.push(rec);
    return rec;
  }

  get forecasts(): readonly ForecastRecord[] {
    return this.forecastLog;
  }

  addRecommendation(r: Omit<RecommendationRecord, 'recNo'>): RecommendationRecord {
    const recNo = this.recs.size;
    const record = Object.freeze({ ...r, recNo }) as RecommendationRecord;
    this.recs.set(recNo, { record, version: 1, acked: 0 });
    return record;
  }

  /** Records the follow-up of a recommendation (accepted / outcome). It is re-sent (upserted) on the next batch. */
  updateRecommendation(recNo: number, patch: Partial<Pick<RecommendationRecord, 'accepted' | 'outcome'>>): void {
    const entry = this.recs.get(recNo);
    if (!entry) return;
    const next = { ...entry.record, ...patch };
    if (next.accepted === entry.record.accepted && next.outcome === entry.record.outcome) return;
    entry.record = Object.freeze(next);
    entry.version++;
  }

  get recommendations(): readonly RecommendationRecord[] {
    return [...this.recs.values()].map((e) => e.record);
  }

  // ------------------------------------------------------------------------------------------------- Supabase batches

  /**
   * The next upload for `mystery-append-events` (`{ sessionId, events, forecasts, recommendations }`), or null when
   * nothing is pending. Calling it again before `ackBatch` returns the same content (safe retry).
   */
  pendingBatch(maxEvents = MAX_BATCH_EVENTS): SupabaseBatch | null {
    const fresh = this.log.filter((e) => e.seq > this.ackedSeq);
    const thinned = thinForUpload(fresh);
    const events = thinned.slice(0, maxEvents);
    const lastSeq = thinned.length > maxEvents ? events[events.length - 1].seq : (fresh[fresh.length - 1]?.seq ?? this.ackedSeq);
    const forecasts = this.forecastLog.filter((f) => !this.forecastAcked.has(f.forecastNo)).slice(0, MAX_BATCH_ANALYTICS);
    const dirty = [...this.recs.values()].filter((e) => e.version > e.acked).slice(0, MAX_BATCH_ANALYTICS);
    if (events.length === 0 && forecasts.length === 0 && dirty.length === 0) {
      if (lastSeq > this.ackedSeq) this.ackedSeq = lastSeq; // only thinned-away events were pending
      return null;
    }
    return {
      events: events.map((e) => ({ ...e })),
      forecasts: forecasts.map((f) => ({ ...f, features: { ...f.features } })),
      recommendations: dirty.map((e) => ({ ...e.record })),
      cursor: {
        lastSeq,
        forecastNos: forecasts.map((f) => f.forecastNo),
        recNos: dirty.map((e) => e.record.recNo),
        recVersions: dirty.map((e) => e.version),
      },
    };
  }

  /** Marks a batch as stored by the server. */
  ackBatch(batch: SupabaseBatch): void {
    this.ackedSeq = Math.max(this.ackedSeq, batch.cursor.lastSeq);
    for (const n of batch.cursor.forecastNos) this.forecastAcked.add(n);
    batch.cursor.recNos.forEach((n, i) => {
      const e = this.recs.get(n);
      if (e) e.acked = Math.max(e.acked, batch.cursor.recVersions[i]);
    });
  }
}

/** Rebuilds a StampedEvent from a `mystery_events` row ({ seq, t, type, payload }). */
export function eventFromRow(row: { seq: number; t: number; type: string; payload: Record<string, unknown> }): StampedEvent {
  return { ...row.payload, type: row.type, t: Number(row.t), seq: row.seq } as StampedEvent;
}
