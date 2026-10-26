// The seam between the mystery journey (MysteryApp / useMysteryLoop) and the LIVE station controller (liveRun.ts).
// Types + a React context only: nothing here imports supabase-js, so the LOCAL DEMO bundle stays free of it.
import { createContext } from 'react';
import type { MysteryAnalytics } from '../../mystery/analytics/index.ts';
import type { CaseId, Duo, DuoOffer, MysteryRulesVersion } from '../../mystery/types.ts';
import type { StationId } from '../../game/index.ts';
import type { ConnectionState } from '../../lib/backend.ts';
import type { MysteryResultView, MysteryReveal } from '../../lib/supabase/mysteryWire.ts';
import type { LiveStatus } from './records.ts';
import type { MysteryRunLike } from './runTypes.ts';

/** Called by the sim loop (useMysteryLoop) for the verified run; null context = LOCAL DEMO. */
export interface LiveRunHooks {
  /** A new MysteryRun + analytics for the selected duo started (uploads begin). */
  runStarted(run: MysteryRunLike, analytics: MysteryAnalytics): void;
  /** Flush pending events now (egg deposit). */
  flushNow(reason: 'deposit' | 'finish' | 'clue'): void;
  /** finish / dnf reached the results moment: flush, then finalize in the background. */
  runEnded(run: MysteryRunLike, analytics: MysteryAnalytics): void;
  /** ~1 Hz station status (heartbeat to Laptop 1). */
  status(s: LiveStatus): void;
}

export const LiveRunContext = createContext<LiveRunHooks | null>(null);

/** The server's session as the journey needs it. */
export interface LiveSessionData {
  sessionId: string;
  seed: string;
  /**
   * The case the SERVER assigned at create (per-station bag; never derived from the seed). Identical on every restore /
   * refresh of this session; only a new session draws the next case. Play `caseById(caseId)`.
   */
  caseId: CaseId;
  /** CaseDef.version the session was created with (the server refuses to verify against another version). */
  caseVersion: number;
  offer: DuoOffer;
  selected: Duo | null;
  nickname: string;
  status: 'offered' | 'playing' | 'finished' | 'dnf' | 'abandoned';
  /** Highest acknowledged event seq (-1 = none). */
  lastSeq: number;
  /** The rules version the SERVER created the session with (a restored v3.1 session must keep v3.1 scoring). */
  rulesVersion?: MysteryRulesVersion;
}

export type LiveRestore =
  | { kind: 'fresh' } // nothing open: new visitor
  | { kind: 'offered'; session: LiveSessionData } // refresh on the cards: the SAME three cards
  | { kind: 'selected'; session: LiveSessionData } // duo chosen, no gameplay stored yet: the run restarts on the same seed
  | { kind: 'interrupted' } // a run with stored events was cut off by a reload: it cannot continue verified
  | { kind: 'error'; message: string };

export type LiveFinal =
  | { kind: 'none' }
  | { kind: 'verifying'; offline: boolean }
  /** `reveal` = the server's culprit + resolution of this session's case (finished runs; null for a DNF). */
  | { kind: 'verified'; result: MysteryResultView; rank: number | null; reveal: MysteryReveal | null }
  | { kind: 'unverified'; reason: string };

export type LiveSync = 'idle' | 'live' | 'offline' | 'unverified' | 'closed' | 'reset';

export interface LiveUiState {
  connection: ConnectionState;
  sync: LiveSync;
  syncReason: string | null;
  final: LiveFinal;
}

/** A failed live step, already classified for the UI. */
export class LiveStepError extends Error {
  constructor(
    readonly kind: 'network' | 'auth' | 'not_offered' | 'already_selected' | 'closed' | 'reset' | 'other',
    message: string,
    /** Server state to adopt (e.g. the canonical offer after DUO_NOT_OFFERED). */
    readonly session: LiveSessionData | null = null,
  ) {
    super(message);
    this.name = 'LiveStepError';
  }
}

/** What MysteryApp needs from the live station (implemented by liveRun.ts). */
export interface LiveStationHandle {
  readonly stationId: StationId;
  readonly stationName: string;
  readonly hooks: LiveRunHooks;
  restore(): Promise<LiveRestore>;
  /** New visitor: persists the actionId, then mystery-create-session. Returns the server's offer. */
  createSession(nickname: string): Promise<LiveSessionData>;
  /** mystery-select-duo for the current session. */
  selectDuo(duo: Duo): Promise<LiveSessionData>;
  /** "Leave the case" / "New investigation": stop uploading this run and forget the stored session. */
  leave(): void;
  getUi(): LiveUiState;
  subscribeUi(listener: () => void): () => void;
  /** Operator reset of the session shown here (confirmed with the server). */
  onReset(listener: () => void): () => void;
  menuStatus(s: LiveStatus): void;
  dispose(): void;
  /** Diagnostics for render_game_to_text (never includes the seed). */
  debug(): object;
  /**
   * Home-page leaderboard (FINAL_CONTRACT §10): emits { connection, loaded, error, top5, leaderboard, defeated } with the
   * RAW mystery_top5 / mystery_leaderboard_v4 / mystery_defeated_v4 rows (v4 only) + parsed `entries`, refreshed via
   * Realtime INSERT / DELETE on mystery_results. Absent when the services have no leaderboard feed.
   */
  readonly leaderboard?: { subscribe(listener: (snapshot: unknown) => void): () => void };
}
