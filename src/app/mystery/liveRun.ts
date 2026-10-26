// LIVE station controller for "The Silent Evidence" (mystery-v4; v3.1 sessions stay readable). Owns the verified session lifecycle of one kiosk:
//   restore (refresh / reconnect) → create (actionId persisted first) → select → per-run uploader → finalize,
// plus the operator-reset watch, the ~2 s heartbeat for Laptop 1 and a tiny UI store (sync chip, verification state).
// React-free (MysteryApp reads it through LiveStationHandle / LiveRunContext); integration-tested against the fake
// server in tests/integration/mystery*.test.ts.
import { revealClues } from '../../mystery/caseVariant.ts';
import type { MysteryAnalytics } from '../../mystery/analytics/index.ts';
import type { HeartbeatAnalytics } from '../../mystery/analytics/live.ts';
import type { Duo } from '../../mystery/types.ts';
import type { StationId } from '../../game/index.ts';
import { classifyFailure } from '../../lib/supabase/mysteryApi.ts';
import type { MysteryStationServices } from '../../lib/supabase/mysteryLive.ts';
import {
  MysteryUploader, finalizeRun, realTimers, type FinalState, type FinalizeHandle, type SyncStatus, type Timers,
} from '../../lib/supabase/mysterySync.ts';
import { HEARTBEAT_EVERY_MS, type MysteryHeartbeat, type MysterySessionEnvelope } from '../../lib/supabase/mysteryWire.ts';
import {
  LiveStepError, type LiveFinal, type LiveRestore, type LiveRunHooks, type LiveSessionData, type LiveStationHandle, type LiveUiState,
} from './liveContext.ts';
import { clearLiveSession, readLiveSession, writeLiveSession, type LiveSessionRecord } from './liveSession.ts';
import type { LiveStatus } from './records.ts';
import type { MysteryRunLike } from './runTypes.ts';

type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null;

export interface LiveControllerDeps {
  services: Pick<MysteryStationServices, 'stationId' | 'api' | 'watch' | 'online'> & Partial<Pick<MysteryStationServices, 'leaderboard'>>;
  storage: Store;
  stationName: string;
  newActionId?: () => string;
  now?: () => Date;
  timers?: Timers;
  heartbeatMs?: number;
  /** Uploader / finalizer tuning (tests). */
  flushIntervalMs?: number;
  backoffMs?: number[];
  /** How long a new create waits for the previous run's pending finalize (ms). */
  finalizeGraceMs?: number;
}

export interface LiveController extends LiveStationHandle {
  /** Diagnostics for render_game_to_text and tests. */
  debug(): {
    sessionId: string | null; status: string | null; caseId: string | null; lastSeq: number | null; sync: SyncStatus | null; final: LiveFinal;
    pendingUpload: number | null; requests: number;
  };
  /** The finalize of the last run (tests await it). */
  finalizing(): Promise<FinalState> | null;
}

function toData(env: MysterySessionEnvelope): LiveSessionData {
  const s = env.session;
  return {
    sessionId: s.sessionId,
    seed: s.seed,
    caseId: s.caseId,
    caseVersion: s.caseVersion,
    offer: env.offer,
    selected: s.selected ? { characterId: s.selected.characterId, pokemonId: s.selected.pokemonId } : null,
    nickname: s.nickname,
    status: s.status,
    lastSeq: s.lastSeq,
    rulesVersion: s.rulesVersion,
  };
}

const NETWORK_TEXT = 'Could not reach the case server. Check the connection and try again.';
const RESET_TEXT = 'This station was reset by the operator.';

function stepError(err: unknown, session: LiveSessionData | null = null): LiveStepError {
  const kind = classifyFailure(err);
  const message = err instanceof Error ? err.message : String(err);
  switch (kind) {
    case 'network':
      return new LiveStepError('network', NETWORK_TEXT, session);
    case 'auth':
      return new LiveStepError('auth', 'This station is signed out. Ask a staff member to sign in again.', session);
    case 'reset':
      return new LiveStepError('reset', RESET_TEXT, session);
    case 'closed':
    case 'not_found':
      return new LiveStepError('closed', 'This case file was closed on the server. Start a new investigation.', session);
    case 'not_offered':
      return new LiveStepError('not_offered', 'That duo is not one of your three cards. Pick one of them.', session);
    case 'already_selected':
      return new LiveStepError('already_selected', 'This case already has a duo.', session);
    default:
      return new LiveStepError('other', message, session);
  }
}

/**
 * The heartbeat for Laptop 1. `a` = the live analytics numbers of the running visit (MysteryAnalytics.heartbeat()),
 * null between visits. Ids travel as tokens and the newest Thing item as { kind, code, ref, followed } — never free text.
 */
export function heartbeatFrom(stationId: StationId, s: LiveStatus, sync: LiveUiState['sync'], a: HeartbeatAnalytics | null = null): MysteryHeartbeat {
  const r3 = (x: number) => Math.round(x * 1000) / 1000;
  const inRun = a !== null && (s.phase === 'investigating' || s.phase === 'carrying' || s.phase === 'accusing' || s.phase === 'results' || s.phase === 'dnf');
  return {
    v: 1,
    stationId,
    phase: s.phase,
    clues: s.clues,
    hp: s.hp,
    catches: s.catches,
    hydeMode: s.hydeMode,
    risk: s.risk?.p ?? null,
    riskSource: s.risk ? (s.risk.label === 'ML estimate' ? 'ml' : 'rule_based') : null,
    eggState: (s.egg?.state ?? null) as MysteryHeartbeat['eggState'],
    eggTier: (s.egg?.tier ?? null) as MysteryHeartbeat['eggTier'],
    eggSecurity: s.egg?.security ?? null,
    activeTimeS: s.activeTimeS,
    sync,
    objective: inRun ? (a.objective as MysteryHeartbeat['objective']) : null,
    cluesTotal: inRun ? a.cluesTotal : null,
    chases: inRun ? a.chases : null,
    escapes: inRun ? a.escapes : null,
    hydeEmerged: inRun ? a.hydeEmerged : null,
    hydeZone: inRun && a.hydeZone ? { id: a.hydeZone.id, p: r3(a.hydeZone.p) } : null,
    eggSite: inRun && a.eggSite && !a.eggLocated ? { id: a.eggSite.id, p: r3(a.eggSite.p) } : null,
    eggLocated: inRun ? a.eggLocated : null,
    extraction: inRun && a.extraction ? r3(a.extraction.p) : null,
    extractionSource: inRun && a.extraction ? a.extraction.source : null,
    thing: inRun && a.lastThing ? { kind: a.lastThing.kind, code: a.lastThing.code, ref: a.lastThing.ref, followed: a.lastThing.followed } : null,
    // enemy contract (UX_ENEMIES §8): his public mode / chase flag / counts — never his position. The local live status
    // (records.ts LiveStatus.crackstoneMode / crackstonePresent, frontend-filled) is the fallback between analytics ticks.
    crackstonePresent: a?.crackstonePresent ?? s.crackstonePresent ?? null,
    crackstoneMode: inRun ? a.crackstoneMode : (s.crackstoneMode ?? null),
    crackstoneChase: inRun ? a.crackstoneChase : (s.crackstoneMode === 'CHASE' || s.crackstoneMode === 'ATTACK' ? true : s.crackstoneMode ? false : null),
    crackstoneChases: inRun ? a.crackstoneChases : null,
    crackstoneEscapes: inRun ? a.crackstoneEscapes : null,
    crackstoneRisk: inRun && a.crackstoneRisk !== null ? Math.round(a.crackstoneRisk * 100) / 100 : null,
    // final: director presence, Slurp's public mode / chase / counts / rule-based risk, the rule-event tally, cabinet door
    hydeActive: inRun ? a.enemies.hyde.active : null,
    crackstoneActive: inRun && a.enemies.crackstone.present ? a.enemies.crackstone.active : null,
    slurpPresent: a ? a.enemies.slurp.present : null,
    slurpActive: inRun && a.enemies.slurp.present ? a.enemies.slurp.active : null,
    slurpMode: inRun ? (a.enemies.slurp.mode as MysteryHeartbeat['slurpMode']) : null,
    slurpChase: inRun && a.enemies.slurp.present ? a.slurpChase : null,
    slurpChases: inRun && a.enemies.slurp.present ? a.slurpChases : null,
    slurpEscapes: inRun && a.enemies.slurp.present ? a.slurpEscapes : null,
    slurpRisk: inRun && a.slurpRisk !== null ? Math.round(a.slurpRisk * 100) / 100 : null,
    hintsUsed: inRun ? a.hintsUsed : null,
    detections: inRun ? a.detections : null,
    hits: inRun ? a.hits : null,
    cabinet: inRun ? a.cabinet : null,
  };
}

export function createLiveController(deps: LiveControllerDeps): LiveController {
  const { api, watch, online, stationId } = deps.services;
  const timers = deps.timers ?? realTimers;
  const newActionId = deps.newActionId ?? (() => crypto.randomUUID());
  const now = deps.now ?? (() => new Date());

  let current: LiveSessionData | null = null;
  let run: { uploader: MysteryUploader; analytics: MysteryAnalytics; sessionId: string } | null = null;
  let finalizer: FinalizeHandle | null = null;
  let finalPromise: Promise<FinalState> | null = null;
  let finalizeToken = 0;
  let finalPending = false;
  let finalUploader: MysteryUploader | null = null;
  let lastStatus: LiveStatus | null = null;
  let disposed = false;
  let ui: LiveUiState = { connection: watch.connection(), sync: 'idle', syncReason: null, final: { kind: 'none' } };
  const uiListeners = new Set<() => void>();
  const resetListeners = new Set<() => void>();

  const setUi = (patch: Partial<LiveUiState>) => {
    const next = { ...ui, ...patch };
    if ((Object.keys(next) as (keyof LiveUiState)[]).every((k) => next[k] === ui[k])) return;
    ui = next;
    uiListeners.forEach((l) => l());
  };

  const persist = (rec: LiveSessionRecord) => writeLiveSession(deps.storage, rec);
  const forget = () => clearLiveSession(deps.storage, stationId);

  function adopt(data: LiveSessionData | null): void {
    current = data;
    watch.track(data?.sessionId ?? null, data !== null && (data.status === 'offered' || data.status === 'playing'));
  }

  function stopRun(): void {
    run?.uploader.stop();
    run = null;
  }

  function sendHeartbeat(): void {
    if (!lastStatus || disposed) return;
    let numbers: HeartbeatAnalytics | null = null;
    try {
      numbers = run?.analytics.heartbeat?.() ?? null;
    } catch {
      numbers = null; // analytics must never break the liveness signal
    }
    watch.heartbeat(heartbeatFrom(stationId, lastStatus, ui.sync, numbers));
  }

  function noteStatus(s: LiveStatus): void {
    const phaseChanged = lastStatus?.phase !== s.phase;
    lastStatus = s;
    if (phaseChanged) sendHeartbeat();
  }

  const heartbeatTimer = timers.setInterval(sendHeartbeat, deps.heartbeatMs ?? HEARTBEAT_EVERY_MS);

  function handleReset(): void {
    stopRun();
    forget();
    adopt(null);
    if (ui.final.kind === 'verifying') setUi({ final: { kind: 'unverified', reason: 'The operator reset this station before the result was saved.' } });
    setUi({ sync: 'reset', syncReason: RESET_TEXT });
    resetListeners.forEach((l) => l());
  }

  const stopWatch = watch.subscribe((e) => {
    if (e.type === 'connection') setUi({ connection: e.state });
    else if (e.type === 'reset_by_operator' && (current?.sessionId === e.sessionId || run?.sessionId === e.sessionId)) handleReset();
  });

  function finalFrom(s: FinalState): LiveFinal {
    switch (s.kind) {
      case 'verifying':
        return { kind: 'verifying', offline: s.offline };
      case 'verified':
        return { kind: 'verified', result: s.response.result, rank: s.response.rank, reveal: s.response.reveal };
      case 'reset':
        return { kind: 'unverified', reason: 'The operator reset this station before the result was saved.' };
      default:
        return { kind: 'unverified', reason: s.reason };
    }
  }

  /** Waits (bounded) for the previous run's finalize so a new create cannot supersede it first. */
  async function settlePreviousFinalize(): Promise<void> {
    if (!finalPromise || !finalPending) return;
    const grace = deps.finalizeGraceMs ?? 5000;
    let timer: unknown = null;
    await Promise.race([
      finalPromise.catch(() => undefined),
      new Promise<void>((resolve) => {
        timer = timers.setTimeout(resolve, grace);
      }),
    ]);
    if (timer !== null) timers.clearTimeout(timer);
  }

  const hooks: LiveRunHooks = {
    runStarted(liveSimRun: MysteryRunLike, analytics: MysteryAnalytics) {
      stopRun();
      if (!current || current.status !== 'playing') {
        // No verified session behind this run (should not happen in live mode): play on, clearly unverified.
        setUi({ sync: 'unverified', syncReason: 'No verified session for this run.', final: { kind: 'none' } });
        return;
      }
      const sessionId = current.sessionId;
      const uploader = new MysteryUploader({
        sessionId,
        api,
        source: analytics,
        online,
        timers,
        intervalMs: deps.flushIntervalMs,
        backoffMs: deps.backoffMs,
        onStatus: (s) => {
          if (run?.uploader !== uploader) return;
          setUi({ sync: s.state, syncReason: s.reason });
          if (s.state === 'reset') handleReset();
        },
        // The server releases the murderer's text of each clue only once it has recorded the clue as found.
        onAck: (ack) => {
          if (run?.uploader === uploader) revealClues(liveSimRun.caseDef, ack.clues);
        },
      });
      run = { uploader, analytics, sessionId };
      setUi({ sync: online.isOnline() ? 'live' : 'offline', syncReason: null, final: { kind: 'none' } });
      uploader.start();
    },
    flushNow() {
      void run?.uploader.flush();
    },
    runEnded(r: MysteryRunLike, analytics: MysteryAnalytics) {
      const active = run;
      if (!active || active.analytics !== analytics) {
        setUi({ final: { kind: 'unverified', reason: ui.syncReason ?? 'This run was not connected to the leaderboard.' } });
        return;
      }
      const clientResult = r.result();
      finalizer?.cancel();
      const token = ++finalizeToken; // finalizeRun emits its first state synchronously, before `handle` exists
      const handle = finalizeRun({
        uploader: active.uploader,
        api,
        clientResult,
        online,
        timers,
        backoffMs: deps.backoffMs,
        onState: (s) => {
          if (finalizeToken !== token) return;
          setUi({ final: finalFrom(s) });
        },
      });
      finalizer = handle;
      finalUploader = active.uploader;
      finalPending = true;
      finalPromise = handle.done.then((s) => {
        finalPending = false;
        if (s.kind === 'verified' && current?.sessionId === active.sessionId) {
          current = { ...current, status: s.response.result.outcome };
          watch.track(current.sessionId, false);
          forget(); // the session is over: a refresh starts a new visitor
        }
        if (s.kind === 'reset' && current?.sessionId === active.sessionId) handleReset();
        return s;
      });
    },
    status(s: LiveStatus) {
      noteStatus(s);
    },
  };

  /** Finalize a run whose terminal event is already stored (page reloaded during verification). Fire and forget. */
  function finalizeOrphan(sessionId: string): void {
    void api.finalize(sessionId, null).catch(() => undefined);
  }

  const controller: LiveController = {
    stationId,
    stationName: deps.stationName,
    hooks,
    ...(deps.services.leaderboard ? { leaderboard: { subscribe: (l: (s: unknown) => void) => deps.services.leaderboard!.subscribe(l) } } : {}),

    async restore(): Promise<LiveRestore> {
      const rec = readLiveSession(deps.storage, stationId);
      if (!rec) {
        adopt(null);
        return { kind: 'fresh' };
      }
      let env: MysterySessionEnvelope | null;
      try {
        if (rec.sessionId) env = await api.get(rec.sessionId);
        else {
          // The create was sent (or about to be) but its answer never arrived: replay it with the SAME actionId.
          env = (await api.create(rec.actionId, rec.nickname)).envelope;
          persist({ ...rec, sessionId: env.session.sessionId });
        }
      } catch (err) {
        const kind = classifyFailure(err);
        if (kind === 'network') return { kind: 'error', message: NETWORK_TEXT };
        if (kind === 'auth') return { kind: 'error', message: 'This station is signed out. Ask a staff member to sign in again.' };
        forget();
        adopt(null);
        return { kind: 'fresh' };
      }
      if (!env) {
        forget();
        adopt(null);
        return { kind: 'fresh' };
      }
      const data = toData(env);
      const s = env.session;
      if (s.status === 'offered') {
        adopt(data);
        return { kind: 'offered', session: data };
      }
      if (s.status === 'playing' && data.selected && s.lastSeq < 1 && s.progress.terminal === null) {
        adopt(data);
        return { kind: 'selected', session: data };
      }
      forget();
      adopt(null);
      if (s.status === 'playing' && s.progress.terminal !== null) {
        finalizeOrphan(s.sessionId); // the run had ended: store its verified result, then start fresh
        return { kind: 'fresh' };
      }
      return s.status === 'playing' ? { kind: 'interrupted' } : { kind: 'fresh' };
    },

    async createSession(nickname: string): Promise<LiveSessionData> {
      if (current && current.status === 'offered' && current.nickname === nickname) return current; // Back + same name: same cards
      stopRun();
      await settlePreviousFinalize();
      setUi({ final: { kind: 'none' }, sync: 'idle', syncReason: null });
      const stored = readLiveSession(deps.storage, stationId);
      let rec: LiveSessionRecord = stored && stored.sessionId === null && stored.nickname === nickname
        ? stored // an earlier attempt for this visitor never got its answer: same actionId
        : { v: 1, stationId, actionId: newActionId(), nickname, sessionId: null, createdAt: now().toISOString() };
      persist(rec); // BEFORE the request (refresh / retry → same session, same offer)
      let env: MysterySessionEnvelope | null = null;
      for (let attempt = 0; attempt < 2 && !env; attempt++) {
        try {
          const out = await api.create(rec.actionId, nickname);
          if (out.envelope.session.status !== 'offered') {
            // A replayed actionId whose session has already moved on: this visitor needs a fresh case file.
            rec = { ...rec, actionId: newActionId(), sessionId: null };
            persist(rec);
            continue;
          }
          env = out.envelope;
        } catch (err) {
          if (classifyFailure(err) === 'action_conflict' && attempt === 0) {
            rec = { ...rec, actionId: newActionId(), sessionId: null };
            persist(rec);
            continue;
          }
          throw stepError(err);
        }
      }
      if (!env) throw new LiveStepError('other', 'The case server could not open a new case file. Try again.');
      persist({ ...rec, sessionId: env.session.sessionId });
      const data = toData(env);
      adopt(data);
      return data;
    },

    async selectDuo(duo: Duo): Promise<LiveSessionData> {
      const session = current;
      if (!session) throw new LiveStepError('closed', 'This case file is no longer open. Start a new investigation.');
      try {
        const data = toData(await api.select(session.sessionId, duo));
        adopt(data);
        return data;
      } catch (err) {
        const kind = classifyFailure(err);
        if (kind === 'not_offered' || kind === 'already_selected') {
          // Adopt the server's canonical session (its offer / its selection) and let the UI follow it.
          let canonical: LiveSessionData | null = null;
          try {
            const env = await api.get(session.sessionId);
            canonical = env ? toData(env) : null;
          } catch {
            canonical = null;
          }
          if (canonical) adopt(canonical);
          throw stepError(err, canonical);
        }
        if (kind === 'closed' || kind === 'not_found' || kind === 'reset') {
          forget();
          adopt(null);
        }
        throw stepError(err);
      }
    },

    leave() {
      if (finalPending) run = null; // the background finalize still owns this run's uploader (it stops it when done)
      else stopRun();
      forget();
      adopt(null);
      // A pending finalize keeps running in the background (it is idempotent); the next create waits for it briefly.
      finalizeToken++; // a background finalize of the previous run no longer drives this visitor's UI
      setUi({ sync: 'idle', syncReason: null, final: { kind: 'none' } });
    },

    getUi: () => ui,
    subscribeUi(listener) {
      uiListeners.add(listener);
      return () => void uiListeners.delete(listener);
    },
    onReset(listener) {
      resetListeners.add(listener);
      return () => void resetListeners.delete(listener);
    },
    menuStatus(s: LiveStatus) {
      noteStatus(s);
    },
    dispose() {
      disposed = true;
      stopRun();
      finalizer?.cancel();
      finalUploader?.stop();
      timers.clearInterval(heartbeatTimer);
      stopWatch();
      uiListeners.clear();
      resetListeners.clear();
    },

    debug() {
      const pending = run ? run.analytics.pendingBatch() : null;
      return {
        sessionId: current?.sessionId ?? null,
        status: current?.status ?? null,
        caseId: current?.caseId ?? null, // the case id is public (announced to the visitor); never the culprit
        lastSeq: run ? run.uploader.status().lastSeq : current?.lastSeq ?? null,
        sync: run ? run.uploader.status() : null,
        final: ui.final,
        pendingUpload: run ? (pending ? pending.events.length + pending.forecasts.length + pending.recommendations.length : 0) : null,
        requests: run?.uploader.sent ?? 0,
      };
    },
    finalizing: () => finalPromise,
  };
  return controller;
}
