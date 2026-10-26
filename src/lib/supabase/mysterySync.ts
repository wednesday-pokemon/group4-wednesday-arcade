// Event upload + finalization for ONE verified mystery run (docs/SUPABASE_SETUP.md §12.3 steps 4-5).
//
//   analytics.pendingBatch() → mystery-append-events → analytics.ackBatch() on 200
//
// * one request in flight; a flush requested meanwhile runs right after it (no overlap, no reordering)
// * flush every ~2 s (interval) and on demand (deposit, finish); batches loop until nothing is pending
// * network failure → "offline" (the run keeps playing locally), retry with backoff and immediately on `online`;
//   the SAME batch is re-sent (pendingBatch returns the same content until acked; the server ignores duplicates)
// * SEQ_CONFLICT / STALE_EVENTS → mystery-get-session, drop everything ≤ lastSeq, resend the rest
// * EVENT_REJECTED (or any other rejection) → "unverified": stop uploading, the run continues locally only
// * SESSION_CLOSED by an operator reset → "reset"; superseded / closed → "closed" (unverified)
// Pure TypeScript with injected timers / online source: unit- and integration-tested in Node.
import type { SupabaseBatch } from '../../mystery/analytics/types.ts';
import type { RunResult } from '../../mystery/types.ts';
import { classifyFailure, type MysteryFailure } from './mysteryApi.ts';
import type { MysteryAppendAck, MysteryFinalizeResponse, MysterySessionEnvelope } from './mysteryWire.ts';
import { browserOnline, type OnlineSource } from './realtime.ts';

export interface BatchSource {
  pendingBatch(): SupabaseBatch | null;
  ackBatch(batch: SupabaseBatch): void;
}

export interface UploadApi {
  append(sessionId: string, batch: Pick<SupabaseBatch, 'events' | 'forecasts' | 'recommendations'>): Promise<MysteryAppendAck>;
  get(sessionId: string): Promise<MysterySessionEnvelope | null>;
}

export interface FinalizeApi extends UploadApi {
  finalize(sessionId: string, clientResult: RunResult | null): Promise<MysteryFinalizeResponse>;
}

/** live = uploading normally; offline = saving locally, will resync; unverified/closed/reset = stopped for good. */
export type SyncState = 'live' | 'offline' | 'unverified' | 'closed' | 'reset';

export interface SyncStatus {
  state: SyncState;
  /** Highest seq the server acknowledged (-1 = nothing yet). */
  lastSeq: number;
  /** The server stored the run's finish / dnf event. */
  terminal: 'finish' | 'dnf' | null;
  /** Human-readable reason for unverified / closed / reset. */
  reason: string | null;
  /** Server rule that rejected the run (EVENT_REJECTED details.rule). */
  rule: string | null;
  failures: number;
}

export interface Timers {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
  setInterval(fn: () => void, ms: number): unknown;
  clearInterval(handle: unknown): void;
}

export const realTimers: Timers = {
  setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
  clearTimeout: (h) => globalThis.clearTimeout(h as ReturnType<typeof setTimeout>),
  setInterval: (fn, ms) => globalThis.setInterval(fn, ms),
  clearInterval: (h) => globalThis.clearInterval(h as ReturnType<typeof setInterval>),
};

export const FLUSH_INTERVAL_MS = 2000;
export const RETRY_BACKOFF_MS = [1000, 2000, 5000, 10_000, 20_000, 30_000];
/** Give up re-syncing after this many conflicts in a row (something is badly out of step). */
const MAX_CONFLICTS = 4;

export interface UploaderDeps {
  sessionId: string;
  api: UploadApi;
  source: BatchSource;
  online?: OnlineSource;
  timers?: Timers;
  intervalMs?: number;
  backoffMs?: number[];
  onStatus?: (s: SyncStatus) => void;
  /** Every accepted append ack (e.g. the found clues' texts the server releases). */
  onAck?: (ack: MysteryAppendAck) => void;
}

const STOPPED: readonly SyncState[] = ['unverified', 'closed', 'reset'];

function errorRule(err: unknown): string | null {
  const d = (err as { details?: Record<string, unknown> } | null)?.details;
  return d && typeof d.rule === 'string' ? d.rule : null;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function abandonedReason(err: unknown): string | null {
  const d = (err as { details?: Record<string, unknown> } | null)?.details;
  return d && typeof d.abandonedReason === 'string' ? d.abandonedReason : null;
}

export class MysteryUploader {
  private status_: SyncStatus = { state: 'live', lastSeq: -1, terminal: null, reason: null, rule: null, failures: 0 };
  private inflight: Promise<SyncState> | null = null;
  private again = false;
  private retryTimer: unknown = null;
  private interval: unknown = null;
  private stopOnline: (() => void) | null = null;
  private stopped = false;
  private conflicts = 0;
  private readonly timers: Timers;
  private readonly online: OnlineSource;
  /** Requests actually sent (diagnostics / tests). */
  sent = 0;

  constructor(private readonly deps: UploaderDeps) {
    this.timers = deps.timers ?? realTimers;
    this.online = deps.online ?? browserOnline;
  }

  get sessionId(): string {
    return this.deps.sessionId;
  }

  status(): SyncStatus {
    return { ...this.status_ };
  }

  /** Starts the ~2 s flush interval and the online listener. */
  start(): void {
    if (this.interval !== null || this.stopped) return;
    this.interval = this.timers.setInterval(() => {
      if (this.retryTimer === null) void this.flush();
    }, this.deps.intervalMs ?? FLUSH_INTERVAL_MS);
    this.stopOnline = this.online.subscribe((on) => {
      if (on && !this.isStopped()) {
        this.clearRetry();
        void this.flush();
      } else if (!on && this.status_.state === 'live') {
        this.set({ state: 'offline' });
      }
    });
    if (!this.online.isOnline()) this.set({ state: 'offline' });
  }

  /** Stops timers and listeners; an in-flight request is allowed to finish but nothing new is sent. */
  stop(): void {
    this.stopped = true;
    this.clearRetry();
    if (this.interval !== null) this.timers.clearInterval(this.interval);
    this.interval = null;
    this.stopOnline?.();
    this.stopOnline = null;
  }

  isStopped(): boolean {
    return this.stopped || STOPPED.includes(this.status_.state);
  }

  /** Uploads everything pending (one request at a time). Resolves with the state after this flush. */
  flush(): Promise<SyncState> {
    if (this.isStopped()) return Promise.resolve(this.status_.state);
    if (this.inflight) {
      this.again = true;
      return this.inflight;
    }
    const run = (async () => {
      let state: SyncState;
      do {
        this.again = false;
        state = await this.loop();
      } while (this.again && state === 'live' && !this.isStopped());
      return state;
    })();
    this.inflight = run.finally(() => {
      this.inflight = null;
    });
    return this.inflight;
  }

  /** Flushes until nothing is pending (or the uploader can't continue). */
  async drain(): Promise<SyncState> {
    for (let i = 0; i < 200; i++) {
      if (this.isStopped()) return this.status_.state;
      const state = await this.flush();
      if (state !== 'live') return state;
      if (!this.inflight && this.deps.source.pendingBatch() === null) return 'live';
    }
    return this.status_.state;
  }

  private set(patch: Partial<SyncStatus>): void {
    const next = { ...this.status_, ...patch };
    const changed = (Object.keys(next) as (keyof SyncStatus)[]).some((k) => next[k] !== this.status_[k]);
    this.status_ = next;
    if (changed) this.deps.onStatus?.(this.status());
  }

  private clearRetry(): void {
    if (this.retryTimer !== null) this.timers.clearTimeout(this.retryTimer);
    this.retryTimer = null;
  }

  private scheduleRetry(): void {
    if (this.stopped || this.retryTimer !== null) return;
    const delays = this.deps.backoffMs ?? RETRY_BACKOFF_MS;
    const delay = delays[Math.min(this.status_.failures - 1, delays.length - 1)] ?? 1000;
    this.retryTimer = this.timers.setTimeout(() => {
      this.retryTimer = null;
      void this.flush();
    }, delay);
  }

  private stopWith(state: Extract<SyncState, 'unverified' | 'closed' | 'reset'>, reason: string, rule: string | null = null): SyncState {
    this.set({ state, reason, rule });
    this.clearRetry();
    return state;
  }

  private async loop(): Promise<SyncState> {
    while (!this.isStopped()) {
      if (!this.online.isOnline()) {
        this.set({ state: 'offline' });
        return 'offline'; // the `online` event resumes; the interval keeps probing in case onLine is wrong
      }
      const batch = this.deps.source.pendingBatch();
      if (!batch) {
        if (this.status_.state === 'offline') this.set({ state: 'live', failures: 0 });
        return 'live';
      }
      try {
        this.sent++;
        const ack = await this.deps.api.append(this.deps.sessionId, batch);
        this.deps.source.ackBatch(batch);
        this.deps.onAck?.(ack);
        this.conflicts = 0;
        this.set({ state: 'live', lastSeq: ack.lastSeq, terminal: ack.terminal ?? this.status_.terminal, failures: 0 });
      } catch (err) {
        const kind = classifyFailure(err);
        const handled = await this.onFailure(kind, err);
        if (handled !== null) return handled;
      }
    }
    return this.status_.state;
  }

  /** null = continue the loop (resynced); otherwise the state to stop this flush with. */
  private async onFailure(kind: MysteryFailure, err: unknown): Promise<SyncState | null> {
    switch (kind) {
      case 'network':
      case 'auth':
        this.set({ state: 'offline', failures: this.status_.failures + 1 });
        this.scheduleRetry();
        return 'offline';
      case 'conflict':
        return this.resync();
      case 'reset':
        return this.stopWith('reset', 'This station was reset by the operator.');
      case 'closed': {
        const why = abandonedReason(err);
        if (why === 'operator_reset') return this.stopWith('reset', 'This station was reset by the operator.');
        return this.stopWith('closed', why === 'superseded' ? 'A newer session replaced this one.' : 'This session is closed on the server.');
      }
      case 'not_found':
        return this.stopWith('closed', 'The server no longer knows this session.');
      default:
        // EVENT_REJECTED, TOO_MANY_EVENTS, invalid body, NOT_SELECTED, ...: this run cannot be verified.
        return this.stopWith('unverified', errorMessage(err), errorRule(err));
    }
  }

  /** SEQ_CONFLICT / STALE_EVENTS: adopt the server's lastSeq, drop everything ≤ it, resend the rest. */
  private async resync(): Promise<SyncState | null> {
    if (++this.conflicts > MAX_CONFLICTS) return this.stopWith('unverified', 'The upload kept conflicting with the server.');
    let env: MysterySessionEnvelope | null;
    try {
      env = await this.deps.api.get(this.deps.sessionId);
    } catch (err) {
      const kind = classifyFailure(err);
      if (kind === 'network' || kind === 'auth') {
        this.set({ state: 'offline', failures: this.status_.failures + 1 });
        this.scheduleRetry();
        return 'offline';
      }
      if (kind === 'not_found') return this.stopWith('closed', 'The server no longer knows this session.');
      return this.stopWith('unverified', errorMessage(err));
    }
    if (!env) return this.stopWith('closed', 'The server no longer knows this session.');
    const s = env.session;
    if (s.status === 'abandoned') {
      return s.abandonedReason === 'operator_reset'
        ? this.stopWith('reset', 'This station was reset by the operator.')
        : this.stopWith('closed', 'A newer session replaced this one.');
    }
    if (s.status !== 'playing') {
      // Already finalized by an earlier call: nothing more can be stored; finalize will return the stored result.
      this.set({ lastSeq: s.lastSeq, terminal: s.progress.terminal });
      this.deps.source.ackBatch({ events: [], forecasts: [], recommendations: [], cursor: { lastSeq: Number.MAX_SAFE_INTEGER, forecastNos: [], recNos: [], recVersions: [] } });
      return 'live';
    }
    this.deps.source.ackBatch({ events: [], forecasts: [], recommendations: [], cursor: { lastSeq: s.lastSeq, forecastNos: [], recNos: [], recVersions: [] } });
    this.set({ lastSeq: s.lastSeq, terminal: s.progress.terminal ?? this.status_.terminal });
    return null;
  }
}

// ------------------------------------------------------------------------------------------------- finalize
export type FinalState =
  | { kind: 'verifying'; offline: boolean }
  | { kind: 'verified'; response: MysteryFinalizeResponse }
  | { kind: 'unverified'; reason: string; rule: string | null }
  | { kind: 'reset'; reason: string };

export interface FinalizeDeps {
  uploader: MysteryUploader;
  api: FinalizeApi;
  clientResult: RunResult | null;
  timers?: Timers;
  backoffMs?: number[];
  online?: OnlineSource;
  onState?: (s: FinalState) => void;
  /** Max finalize attempts that fail with network errors before reporting "not verified" (keeps retrying is the default). */
  maxNetworkAttempts?: number;
}

export interface FinalizeHandle {
  done: Promise<FinalState>;
  cancel(): void;
}

/**
 * After finish / dnf: drain the uploader (so the terminal event is stored), then mystery-finalize with the browser's
 * RunResult as an audit claim. Retries network failures with backoff (and on `online`) until it succeeds, the run
 * proves unverifiable, or it is cancelled. Finalize is idempotent server-side, so retrying is always safe.
 */
export function finalizeRun(deps: FinalizeDeps): FinalizeHandle {
  const timers = deps.timers ?? realTimers;
  const online = deps.online ?? browserOnline;
  const delays = deps.backoffMs ?? RETRY_BACKOFF_MS;
  let cancelled = false;
  let wake: (() => void) | null = null;
  let timer: unknown = null;
  const emit = (s: FinalState) => {
    if (!cancelled) deps.onState?.(s);
  };
  const stopOnline = online.subscribe((on) => {
    if (on) wake?.();
  });
  const pause = (attempt: number) => new Promise<void>((resolve) => {
    wake = () => {
      if (timer !== null) timers.clearTimeout(timer);
      timer = null;
      wake = null;
      resolve();
    };
    timer = timers.setTimeout(() => wake?.(), delays[Math.min(attempt, delays.length - 1)] ?? 1000);
  });

  // 'closed' is not final here: the session may already be finalized (an earlier answer was lost), and finalize then
  // returns the stored result. Only reset / rejected runs skip the finalize call.
  const fromSync = (s: SyncStatus): FinalState | null => {
    if (s.state === 'reset') return { kind: 'reset', reason: s.reason ?? 'This station was reset by the operator.' };
    if (s.state === 'unverified') return { kind: 'unverified', reason: s.reason ?? 'The run could not be verified.', rule: s.rule };
    return null;
  };

  const done = (async (): Promise<FinalState> => {
    let attempt = 0;
    let notFinished = 0;
    let networkFailures = 0;
    emit({ kind: 'verifying', offline: false });
    while (!cancelled) {
      const state = await deps.uploader.drain();
      const stop = fromSync(deps.uploader.status());
      if (stop) return stop;
      if (state === 'offline') {
        emit({ kind: 'verifying', offline: true });
        await pause(attempt++);
        continue;
      }
      try {
        const response = await deps.api.finalize(deps.uploader.sessionId, deps.clientResult);
        deps.uploader.stop();
        return { kind: 'verified', response };
      } catch (err) {
        const kind = classifyFailure(err);
        if (kind === 'network' || kind === 'auth') {
          networkFailures++;
          if (deps.maxNetworkAttempts !== undefined && networkFailures >= deps.maxNetworkAttempts) {
            return { kind: 'unverified', reason: 'The case server could not be reached.', rule: null };
          }
          emit({ kind: 'verifying', offline: true });
          await pause(attempt++);
          continue;
        }
        if (kind === 'not_finished' && ++notFinished <= 2) {
          // The finish / dnf event is not stored yet (e.g. it was still queued): upload and try again.
          await deps.uploader.flush();
          continue;
        }
        if (kind === 'reset') return { kind: 'reset', reason: 'This station was reset by the operator.' };
        if (kind === 'closed') {
          const why = abandonedReason(err);
          if (why === 'operator_reset') return { kind: 'reset', reason: 'This station was reset by the operator.' };
          return { kind: 'unverified', reason: 'This session was closed on the server before it could be verified.', rule: null };
        }
        const synced = deps.uploader.status();
        if (synced.state === 'closed') return { kind: 'unverified', reason: synced.reason ?? 'This session is closed on the server.', rule: null };
        return { kind: 'unverified', reason: errorMessage(err), rule: errorRule(err) };
      }
    }
    return { kind: 'unverified', reason: 'Verification was cancelled.', rule: null };
  })().then((final) => {
    stopOnline();
    emit(final);
    return final;
  });

  return {
    done,
    cancel() {
      cancelled = true;
      stopOnline();
      wake?.();
    },
  };
}
