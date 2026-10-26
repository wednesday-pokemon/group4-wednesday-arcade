// LIVE GameBackend: every decision goes to the Edge Functions, which own the seed, the rules engine run and
// all outcomes. The client sends ONLY decisions + expectedRevision + actionId (strict server allow-lists);
// nothing computed in the browser (advisory analytics, predictions) is ever sent as an outcome.
import { sanitizeNickname } from '../../game/index.ts';
import type { SessionStatus, SessionView, StationId } from '../../game/index.ts';
import {
  BackendError, newActionId, type CreateSessionInput, type GameBackend, type PrepareLegInput, type ResolveLegInput,
  type ResolveLegResult,
} from '../backend.ts';
import type { LiveAuth } from './auth.ts';
import type { FunctionName, InvokeResult } from './functions.ts';
import { parseEnvelope, parseGetSession, type SessionEnvelope } from './mappers.ts';

export type FunctionCaller = <T>(name: FunctionName, body: Record<string, unknown>) => Promise<InvokeResult<T>>;

/** The session this terminal is currently showing (used to attribute operator-reset notices). */
export class SessionTracker {
  private value: { sessionId: string; status: SessionStatus } | null = null;
  current() {
    return this.value;
  }
  track(view: SessionView | null): void {
    this.value = view ? { sessionId: view.state.sessionId, status: view.state.status } : null;
  }
  clear(): void {
    this.value = null;
  }
}

export interface LiveBackendDeps {
  stationId: StationId;
  auth: Pick<LiveAuth, 'requireStation'>;
  call: FunctionCaller;
  tracker: SessionTracker;
  /** Fired when the server reports that the tracked session was reset by an operator. */
  onOperatorReset: (reason: string) => void;
}

export class LiveBackend implements GameBackend {
  readonly mode = 'live' as const;
  readonly stationId: StationId;

  constructor(private readonly deps: LiveBackendDeps) {
    this.stationId = deps.stationId;
  }

  /** Station-bound call: refuses unless this page's account is the URL's station; clears tracking on closure. */
  private async send<T>(name: FunctionName, body: Record<string, unknown>): Promise<T> {
    await this.deps.auth.requireStation(this.stationId);
    try {
      return (await this.deps.call<T>(name, body)).data;
    } catch (err) {
      if (err instanceof BackendError && ['RESET_BY_OPERATOR', 'SESSION_CLOSED', 'NOT_FOUND', 'UNAUTHORIZED'].includes(err.code)) {
        const tracked = this.deps.tracker.current();
        if (!tracked || typeof body.sessionId !== 'string' || body.sessionId === tracked.sessionId) this.deps.tracker.clear();
      }
      throw err;
    }
  }

  private accept(envelope: SessionEnvelope): SessionView {
    if (envelope.meta.stationId !== this.stationId) {
      this.deps.tracker.clear();
      throw new BackendError('UNAUTHORIZED', 'The server bound this account to a different station.');
    }
    this.deps.tracker.track(envelope.view);
    return envelope.view;
  }

  async createSession(input: CreateSessionInput): Promise<SessionView> {
    const nickname = sanitizeNickname(input.nickname);
    if (!nickname.ok) throw new BackendError('INVALID_INPUT', nickname.message);
    const actionId = newActionId(); // once per intent; functions.ts re-sends it unchanged on retry
    const data = await this.send<unknown>('create-session', {
      nickname: nickname.value, characterId: input.characterId, pokemonId: input.pokemonId, actionId,
    });
    return this.accept(parseEnvelope(data));
  }

  async getActiveSession(): Promise<SessionView | null> {
    const res = parseGetSession(await this.send<unknown>('get-session', {}));
    if (res.station.stationId !== this.stationId) {
      this.deps.tracker.clear();
      throw new BackendError('UNAUTHORIZED', 'The server bound this account to a different station.');
    }
    const tracked = this.deps.tracker.current();
    if (!res.view || !res.meta) {
      this.deps.tracker.clear();
      if (tracked && res.station.notice === 'operator_reset') this.deps.onOperatorReset('operator_reset');
      return null;
    }
    const view = this.accept({ view: res.view, meta: res.meta });
    if (res.meta.abandonedReason === 'operator_reset' && tracked?.sessionId === view.state.sessionId) {
      this.deps.tracker.clear();
      this.deps.onOperatorReset('operator_reset');
    }
    return view;
  }

  async prepareLeg(input: PrepareLegInput): Promise<SessionView> {
    const data = await this.send<unknown>('prepare-leg', {
      sessionId: input.sessionId, expectedRevision: input.expectedRevision, route: input.route, pushLevel: input.pushLevel,
      actionId: input.actionId,
    });
    return this.accept(parseEnvelope(data));
  }

  async resolveLeg(input: ResolveLegInput): Promise<ResolveLegResult> {
    // `input.advisory` is deliberately NOT sent: resolve-leg's body is a strict allow-list
    // {sessionId, expectedRevision, eggDecision, actionId} and unknown keys are rejected with 422.
    const data = await this.send<unknown>('resolve-leg', {
      sessionId: input.sessionId, expectedRevision: input.expectedRevision, eggDecision: input.eggDecision,
      actionId: input.actionId,
    });
    const envelope = parseEnvelope(data, true);
    const view = this.accept(envelope);
    return { view, resolution: envelope.resolution! };
  }

  async abandonSession(sessionId: string, actionId: string): Promise<SessionView | null> {
    try {
      const data = await this.send<unknown>('finish-session', { sessionId, actionId, reason: 'player_reset' });
      const view = this.accept(parseEnvelope(data));
      this.deps.tracker.clear();
      return view;
    } catch (err) {
      if (err instanceof BackendError && err.code === 'NOT_FOUND') return null;
      throw err;
    }
  }
}
