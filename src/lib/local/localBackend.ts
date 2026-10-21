// LOCAL DEMO authority: runs the same pure rules engine in the browser with a locally generated seed.
// Results are badged DEMO / UNVERIFIED. Idempotent by action ID like the live server.
import {
  buildSessionView, createInitialState, demoCommitment, prepareWithSeed, resolveWithSeed, abandonSession, sanitizeNickname,
} from '../../game/index.ts';
import type { GameState, ScoreRecord, SessionView } from '../../game/index.ts';
import {
  BackendError, type CreateSessionInput, type GameBackend, type PrepareLegInput, type ResolveLegInput,
  type ResolveLegResult, type StationStatus,
} from '../backend.ts';
import { buildTelemetryEvent } from '../../analytics/descriptive.ts';
import { updateDemoData, upsertRecord } from './demoStore.ts';

const SESSION_KEY = 'raven-regatta:demo-session:v2.5';

interface LocalSession { state: GameState; seed: string; receipts: Record<string, unknown> }

function randomSeed(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function toRecord(state: GameState): ScoreRecord {
  return {
    sessionId: state.sessionId, nickname: state.nickname, stationId: 'local', characterId: state.characterId,
    pokemonId: state.pokemonId, status: state.status, finalEggPoints: state.finalEggPoints ?? 0,
    totalSimulatedTimeCs: state.totalSimulatedTimeCs, finalScore: state.finalScore ?? 0,
    completedAt: new Date().toISOString(), verified: false, rulesVersion: state.rulesVersion,
  };
}

function toStationStatus(state: GameState): StationStatus {
  return {
    stationId: 'local', sessionId: state.sessionId, nickname: state.nickname, characterId: state.characterId,
    pokemonId: state.pokemonId, status: state.status, legIndex: state.legIndex, phase: state.phase, hp: state.hp,
    gapM: state.pursuitGapM, catches: state.hydeCatchCount, bankedEggs: state.bankedEggPoints,
    simTimeCs: state.totalSimulatedTimeCs, revision: state.revision, updatedAt: new Date().toISOString(),
  };
}

export class LocalBackend implements GameBackend {
  readonly mode = 'local_demo' as const;
  readonly stationId = 'local' as const;
  private session: LocalSession | null = null;

  constructor() {
    try {
      const raw = sessionStorage.getItem(SESSION_KEY);
      this.session = raw ? (JSON.parse(raw) as LocalSession) : null;
    } catch {
      this.session = null;
    }
  }

  private persist(): void {
    try {
      if (this.session) sessionStorage.setItem(SESSION_KEY, JSON.stringify(this.session));
      else sessionStorage.removeItem(SESSION_KEY);
    } catch {
      // Demo keeps running in memory.
    }
    if (!this.session) return;
    const state = this.session.state;
    updateDemoData((d) => ({
      ...d,
      station: toStationStatus(state),
      records: state.status === 'in_progress' ? d.records : upsertRecord(d.records, toRecord(state)),
    }));
  }

  private view(): SessionView {
    if (!this.session) throw new BackendError('NOT_FOUND', 'No active demo session.');
    const { state, seed } = this.session;
    return buildSessionView(state, seed, false, demoCommitment(seed));
  }

  private requireSession(sessionId: string): LocalSession {
    if (!this.session || this.session.state.sessionId !== sessionId) throw new BackendError('NOT_FOUND', 'That race is no longer active.');
    return this.session;
  }

  async createSession(input: CreateSessionInput): Promise<SessionView> {
    const nickname = sanitizeNickname(input.nickname);
    if (!nickname.ok) throw new BackendError('INVALID_INPUT', nickname.message);
    if (this.session?.state.status === 'in_progress') this.session.state = abandonSession(this.session.state);
    if (this.session) this.persist();
    const state = createInitialState({ sessionId: crypto.randomUUID(), nickname: nickname.value, characterId: input.characterId, pokemonId: input.pokemonId });
    this.session = { state, seed: randomSeed(), receipts: {} };
    this.persist();
    return this.view();
  }

  async getActiveSession(): Promise<SessionView | null> {
    return this.session ? this.view() : null;
  }

  async prepareLeg(input: PrepareLegInput): Promise<SessionView> {
    const session = this.requireSession(input.sessionId);
    if (session.receipts[input.actionId]) return this.view();
    const result = prepareWithSeed(session.state, session.seed, { route: input.route, pushLevel: input.pushLevel }, input.expectedRevision);
    if (!result.ok) throw new BackendError(result.error.code, result.error.message);
    session.state = result.state;
    session.receipts[input.actionId] = true;
    this.persist();
    return this.view();
  }

  async resolveLeg(input: ResolveLegInput): Promise<ResolveLegResult> {
    const session = this.requireSession(input.sessionId);
    const replay = session.receipts[input.actionId] as ResolveLegResult['resolution'] | undefined;
    if (replay) return { view: this.view(), resolution: replay };
    const result = resolveWithSeed(session.state, session.seed, input.eggDecision, input.expectedRevision);
    if (!result.ok) throw new BackendError(result.error.code, result.error.message);
    session.state = result.state;
    session.receipts[input.actionId] = result.resolution;
    const event = buildTelemetryEvent(session.state, 'local', result.resolution, input.advisory);
    updateDemoData((d) => ({ ...d, telemetry: [...d.telemetry, event] }));
    this.persist();
    return { view: this.view(), resolution: result.resolution };
  }

  async abandonSession(sessionId: string): Promise<SessionView | null> {
    if (!this.session || this.session.state.sessionId !== sessionId) return null;
    if (this.session.state.status === 'in_progress') this.session.state = abandonSession(this.session.state);
    this.persist();
    const view = this.view();
    this.session = null;
    this.persist();
    return view;
  }
}
