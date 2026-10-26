// The single seam between the UI and the authority that owns randomness/state.
// LOCAL DEMO (in-browser, unverified) and LIVE (Supabase Edge Functions, verified) both implement it.
import type {
  ActionRejection, CharacterId, EggDecision, LegResolution, PokemonId, PushLevel, RouteId, ScoreRecord, SessionView,
  StationId, TelemetryEvent,
} from '../game/index.ts';

export type BackendMode = 'local_demo' | 'live';

export interface CreateSessionInput { nickname: string; characterId: CharacterId; pokemonId: PokemonId }
export interface PrepareLegInput { sessionId: string; expectedRevision: number; route: RouteId; pushLevel: PushLevel; actionId: string }
export interface ResolveLegInput {
  sessionId: string;
  expectedRevision: number;
  actionId: string;
  eggDecision: EggDecision;
  /** Advisory client-side analytics (prediction/advice) stored for diagnostics; never trusted for outcomes. */
  advisory?: Pick<TelemetryEvent, 'predictedLegTimeS' | 'predictedCatchP' | 'advice'>;
}
export interface ResolveLegResult { view: SessionView; resolution: LegResolution }

export type BackendErrorCode = ActionRejection['code'] | 'NETWORK' | 'UNAUTHORIZED' | 'NOT_FOUND' | 'RESET_BY_OPERATOR' | 'SERVER';

export class BackendError extends Error {
  constructor(public readonly code: BackendErrorCode, message: string, public readonly retryable = false) {
    super(message);
    this.name = 'BackendError';
  }
}

export interface GameBackend {
  readonly mode: BackendMode;
  readonly stationId: StationId | 'local';
  createSession(input: CreateSessionInput): Promise<SessionView>;
  /** Canonical state of this station's active session (used on reload/reconnect). */
  getActiveSession(): Promise<SessionView | null>;
  prepareLeg(input: PrepareLegInput): Promise<SessionView>;
  resolveLeg(input: ResolveLegInput): Promise<ResolveLegResult>;
  abandonSession(sessionId: string, actionId: string): Promise<SessionView | null>;
}

export interface StationStatus {
  stationId: StationId | 'local';
  sessionId: string | null;
  nickname: string | null;
  characterId: CharacterId | null;
  pokemonId: PokemonId | null;
  status: 'idle' | 'in_progress' | 'completed' | 'dnf' | 'abandoned';
  legIndex: number | null;
  phase: string | null;
  hp: number | null;
  gapM: number | null;
  catches: number | null;
  bankedEggs: number | null;
  simTimeCs: number | null;
  revision: number;
  updatedAt: string;
}

export type ConnectionState = 'connected' | 'connecting' | 'offline';

export interface DashboardSnapshot {
  mode: BackendMode;
  connection: ConnectionState;
  leaderboard: ScoreRecord[]; // ranked, completed + verified (live) or demo-completed (local)
  defeated: ScoreRecord[]; // DNF log, newest first
  stations: StationStatus[];
  updatedAt: string;
}

export interface DashboardFeed {
  readonly mode: BackendMode;
  subscribe(listener: (snapshot: DashboardSnapshot) => void): () => void;
  refresh(): Promise<void>;
}

export interface AuthUser { email: string; role: 'station' | 'operator'; stationId: StationId | null }

/** Live-mode sign-in for station terminals and operators. Absent in LOCAL DEMO. */
export interface AuthGate {
  currentUser(): Promise<AuthUser | null>;
  signIn(email: string, password: string): Promise<AuthUser>;
  signOut(): Promise<void>;
}

/** Operator-only controls (Laptop 1). Every call is authorised server-side. */
export interface OperatorConsole {
  resetStation(stationId: StationId | 'local', reason: string): Promise<void>;
}

export type StationEvent = { type: 'reset_by_operator'; reason: string } | { type: 'connection'; state: ConnectionState };

export interface AppServices {
  mode: BackendMode;
  backend: GameBackend;
  dashboard: DashboardFeed;
  auth: AuthGate | null;
  operator: OperatorConsole;
  /** Terminal-side notifications (operator reset, connection changes). */
  subscribeStation(listener: (event: StationEvent) => void): () => void;
}

export function newActionId(): string {
  return crypto.randomUUID();
}
