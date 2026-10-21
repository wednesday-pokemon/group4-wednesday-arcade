// Race controller: the only place that talks to the GameBackend. Persists pending intents before sending,
// retries with the same actionId, refetches canonical state on STALE_REVISION and honours operator resets.
import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import type { EggDecision, SessionView } from '../game/index.ts';
import { BackendError, newActionId, type AppServices, type ConnectionState } from '../lib/backend.ts';
import { readDemoData } from '../lib/local/demoStore.ts';
import { advisoryFrom } from '../analytics/descriptive.ts';
import { flowReducer, initialFlow, type FlowError, type LegNotes, type RetryKind } from './flow.ts';
import {
  clearPendingIntent, intentMatches, loadPendingIntent, savePendingIntent, type PendingIntent,
} from './pendingIntent.ts';

export const RESET_NOTICE = 'This race was reset by the operator.';
const GONE_NOTICE = 'That race is no longer active. Start a new one when ready.';
const DEMO_CHANNEL = 'raven-regatta-demo';

function toFlowError(err: unknown, retry: RetryKind | null): FlowError {
  if (err instanceof BackendError) {
    const retryable = err.code === 'NETWORK' || err.code === 'SERVER' || err.retryable;
    return { code: err.code, message: err.message, retry: retryable ? retry : null };
  }
  // fetch/TypeError and friends: treat as a network problem that can be retried.
  return { code: 'NETWORK', message: err instanceof Error ? err.message : String(err), retry };
}

export function useRace(services: AppServices, stationKey: string) {
  const { backend } = services;
  const [flow, dispatch] = useReducer(flowReducer, initialFlow);
  const [connection, setConnection] = useState<ConnectionState>('connected');
  const flowRef = useRef(flow);
  flowRef.current = flow;
  const intentRef = useRef<PendingIntent | null>(null);
  const notesRef = useRef<LegNotes | null>(null);
  const selfAbandonRef = useRef(false);
  const resetByOperatorRef = useRef(false);

  const operatorReset = useCallback(() => {
    resetByOperatorRef.current = true;
    clearPendingIntent(stationKey);
    intentRef.current = null;
    if (flowRef.current.view) dispatch({ type: 'reset', notice: RESET_NOTICE });
  }, [stationKey]);

  const refetchCanonical = useCallback(async () => {
    clearPendingIntent(stationKey);
    intentRef.current = null;
    try {
      const view = await backend.getActiveSession();
      if (view && view.state.sessionId === flowRef.current.view?.state.sessionId) dispatch({ type: 'restore', view, showResult: false });
      else dispatch({ type: 'reset', notice: resetByOperatorRef.current ? RESET_NOTICE : GONE_NOTICE });
    } catch (err) {
      dispatch({ type: 'error', error: toFlowError(err, null) });
    }
  }, [backend, stationKey]);

  const handleFailure = useCallback(
    async (err: unknown, retry: RetryKind | null) => {
      const code = err instanceof BackendError ? err.code : 'NETWORK';
      if (code === 'RESET_BY_OPERATOR') return operatorReset();
      if (code === 'STALE_REVISION' || code === 'WRONG_PHASE') return refetchCanonical();
      if (code === 'NOT_FOUND' || code === 'SESSION_CLOSED') {
        clearPendingIntent(stationKey);
        return dispatch({ type: 'reset', notice: GONE_NOTICE });
      }
      const error = toFlowError(err, retry);
      if (!error.retry) clearPendingIntent(stationKey);
      dispatch({ type: 'error', error });
    },
    [operatorReset, refetchCanonical, stationKey],
  );

  /** Sends (or re-sends, with the same actionId) a persisted prepare/resolve intent. */
  const sendIntent = useCallback(
    async (intent: PendingIntent) => {
      intentRef.current = intent;
      savePendingIntent(stationKey, intent);
      dispatch({ type: 'busy', busy: intent.kind });
      const base = { sessionId: intent.sessionId, expectedRevision: intent.expectedRevision, actionId: intent.actionId };
      try {
        if (intent.kind === 'prepare') {
          const view = await backend.prepareLeg({ ...base, ...intent.payload });
          clearPendingIntent(stationKey);
          intentRef.current = null;
          dispatch({ type: 'prepared', view, notes: notesRef.current ?? { prediction: null, advice: null, followedAdvice: null } });
        } else {
          const { view, resolution } = await backend.resolveLeg({ ...base, ...intent.payload });
          clearPendingIntent(stationKey);
          intentRef.current = null;
          dispatch({ type: 'resolved', view, resolution });
        }
      } catch (err) {
        await handleFailure(err, intent.kind);
      }
    },
    [backend, handleFailure, stationKey],
  );

  const startRace = useCallback(async () => {
    const { nickname, characterId, pokemonId } = flowRef.current.draft;
    if (!characterId || !pokemonId) return;
    resetByOperatorRef.current = false;
    dispatch({ type: 'busy', busy: 'create' });
    try {
      const view = await backend.createSession({ nickname, characterId, pokemonId });
      dispatch({ type: 'sessionCreated', view });
    } catch (err) {
      await handleFailure(err, 'create');
    }
  }, [backend, handleFailure]);

  const setSail = useCallback(
    (notes: LegNotes) => {
      const { view, selection, busy } = flowRef.current;
      if (!view || !selection.route || busy) return;
      notesRef.current = notes;
      void sendIntent({
        sessionId: view.state.sessionId, kind: 'prepare', actionId: newActionId(), expectedRevision: view.state.revision,
        payload: { route: selection.route, pushLevel: selection.pushLevel },
      });
    },
    [sendIntent],
  );

  const decideEgg = useCallback(
    (eggDecision: EggDecision) => {
      const { view, notes, busy } = flowRef.current;
      if (!view || busy) return;
      const legNotes = notes[view.state.legIndex];
      void sendIntent({
        sessionId: view.state.sessionId, kind: 'resolve', actionId: newActionId(), expectedRevision: view.state.revision,
        payload: { eggDecision, advisory: advisoryFrom(legNotes?.prediction ?? null, legNotes?.advice ?? null) },
      });
    },
    [sendIntent],
  );

  const quitRace = useCallback(async () => {
    const view = flowRef.current.view;
    clearPendingIntent(stationKey);
    intentRef.current = null;
    if (!view) return dispatch({ type: 'reset' });
    selfAbandonRef.current = true;
    dispatch({ type: 'busy', busy: 'abandon' });
    try {
      await backend.abandonSession(view.state.sessionId, newActionId());
      dispatch({ type: 'reset' });
    } catch (err) {
      await handleFailure(err, 'abandon');
    } finally {
      selfAbandonRef.current = false;
    }
  }, [backend, handleFailure, stationKey]);

  /**
   * "Next visitor": releases the finished session (LOCAL DEMO clears it from this browser; LIVE finish-session
   * frees the station card on the dashboard). The finished result itself is never changed.
   */
  const nextVisitor = useCallback(async () => {
    const view = flowRef.current.view;
    dispatch({ type: 'reset' });
    if (!view) return;
    selfAbandonRef.current = true;
    await backend.abandonSession(view.state.sessionId, newActionId()).catch(() => null);
    selfAbandonRef.current = false;
  }, [backend]);

  const retry = useCallback(() => {
    const error = flowRef.current.error;
    dispatch({ type: 'clearError' });
    if (!error?.retry) return;
    if (error.retry === 'create') void startRace();
    else if (error.retry === 'abandon') void quitRace();
    else if (intentRef.current) void sendIntent(intentRef.current);
  }, [quitRace, sendIntent, startRace]);

  // Reload / reconnect: canonical state first, then replay a still-matching pending intent.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      dispatch({ type: 'busy', busy: 'restore' });
      try {
        const view: SessionView | null = await backend.getActiveSession();
        const intent = loadPendingIntent(stationKey);
        if (cancelled) return;
        if (!view || view.state.status === 'abandoned') {
          clearPendingIntent(stationKey);
          dispatch({ type: 'busy', busy: null });
          return;
        }
        if (intent && intentMatches(intent, view.state.sessionId, view.state.revision, view.state.status)) {
          dispatch({ type: 'restore', view, showResult: false });
          await sendIntent(intent);
          return;
        }
        const resolvedBeforeReload = intent?.kind === 'resolve' && intent.sessionId === view.state.sessionId
          && view.state.revision === intent.expectedRevision + 1;
        clearPendingIntent(stationKey);
        dispatch({ type: 'restore', view, showResult: resolvedBeforeReload });
      } catch (err) {
        if (!cancelled) dispatch({ type: 'error', error: toFlowError(err, null) });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [backend, sendIntent, stationKey]);

  // Operator resets and connection changes pushed to this terminal.
  useEffect(
    () => services.subscribeStation((event) => {
      if (event.type === 'reset_by_operator') operatorReset();
      else setConnection(event.state);
    }),
    [services, operatorReset],
  );

  // LOCAL DEMO: an operator reset from the dashboard tab arrives through the demo BroadcastChannel.
  useEffect(() => {
    if (services.mode !== 'local_demo' || typeof BroadcastChannel === 'undefined') return;
    const channel = new BroadcastChannel(DEMO_CHANNEL);
    channel.onmessage = () => {
      const view = flowRef.current.view;
      if (!view || view.state.status !== 'in_progress' || selfAbandonRef.current) return;
      const station = readDemoData().station;
      const wasReset = station === null || (station.sessionId === view.state.sessionId && station.status === 'abandoned');
      if (!wasReset) return;
      void backend.abandonSession(view.state.sessionId, newActionId()).catch(() => null);
      operatorReset();
    };
    return () => channel.close();
  }, [backend, operatorReset, services.mode]);

  return { flow, dispatch, connection, startRace, setSail, decideEgg, quitRace, nextVisitor, retry };
}

export type RaceController = ReturnType<typeof useRace>;
