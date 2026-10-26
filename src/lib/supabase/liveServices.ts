// LIVE (verified) services: Supabase Auth + Edge Functions + Realtime, anon/publishable key only.
// Entry point used by src/lib/services.ts via dynamic import (keeps supabase-js out of the LOCAL DEMO bundle).
import type { SupabaseClient } from '@supabase/supabase-js';
import { isStationId } from '../../game/index.ts';
import type { StationId } from '../../game/index.ts';
import { BackendError, newActionId, type AppServices, type OperatorConsole } from '../backend.ts';
import { createLiveAuth, type LiveAuth } from './auth.ts';
import { readLiveConfig, sharedSupabase, type LiveConfig } from './client.ts';
import { createLiveDashboardFeed } from './dashboardFeed.ts';
import { invokeFunction, type FunctionTransport } from './functions.ts';
import { LiveBackend, SessionTracker, type FunctionCaller } from './liveBackend.ts';
import { parseGetSession, type AdminResetResponse } from './mappers.ts';
import type { OnlineSource, RealtimeHost } from './realtime.ts';
import { createStationWatch, type ResetCheck } from './stationWatch.ts';

export interface LiveServiceDeps {
  stationId: StationId | null;
  config: LiveConfig;
  client: SupabaseClient;
  /** Defaults to `client`; tests inject a fake Realtime host. */
  realtime?: RealtimeHost;
  /** Defaults to `fetch`; the same fetch supabase-js uses for Auth/REST in tests. */
  fetch?: typeof fetch;
  online?: OnlineSource;
  transport?: Partial<Pick<FunctionTransport, 'timeoutMs' | 'maxAttempts' | 'sleep'>>;
  dashboardPollMs?: number;
}

export const ADMIN_REASON = { min: 3, max: 200 } as const;

/** A GameBackend for pages that are not a station terminal (dashboard): every call is refused. */
function noStationBackend(): AppServices['backend'] {
  const refuse = async (): Promise<never> => {
    throw new BackendError('UNAUTHORIZED', 'This page is not a station terminal.');
  };
  return {
    mode: 'live',
    stationId: 'local', // type-level placeholder: the dashboard has no station; all calls are refused
    createSession: refuse,
    getActiveSession: async () => null,
    prepareLeg: refuse,
    resolveLeg: refuse,
    abandonSession: refuse,
  };
}

export function buildLiveServices(deps: LiveServiceDeps): AppServices & { auth: LiveAuth } {
  const { stationId, client, config } = deps;
  const realtime = deps.realtime ?? client;
  const auth = createLiveAuth(client, stationId);
  const transport: FunctionTransport = {
    url: config.url,
    anonKey: config.anonKey,
    getAccessToken: () => auth.getAccessToken(),
    refreshAccessToken: () => auth.refreshAccessToken(),
    ...(deps.fetch ? { fetch: deps.fetch } : {}),
    ...deps.transport,
  };
  const call: FunctionCaller = (name, body) => invokeFunction(transport, name, body);
  const tracker = new SessionTracker();

  async function confirmReset(sessionId: string): Promise<ResetCheck> {
    if (!stationId) return 'unknown';
    try {
      await auth.requireStation(stationId);
      const res = parseGetSession((await call<unknown>('get-session', { sessionId })).data);
      if (!res.view || !res.meta) return 'unknown';
      if (res.meta.status === 'in_progress') return 'active';
      return res.meta.abandonedReason === 'operator_reset' ? 'reset' : 'unknown';
    } catch (err) {
      if (err instanceof BackendError && (err.code === 'NOT_FOUND' || err.code === 'RESET_BY_OPERATOR')) return 'reset';
      return 'unknown';
    }
  }

  const watch = createStationWatch({ stationId, rest: client, realtime, tracker, confirmReset, online: deps.online });
  const backend = stationId
    ? new LiveBackend({ stationId, auth, call, tracker, onOperatorReset: (reason) => watch.emitReset(reason) })
    : noStationBackend();
  const dashboard = createLiveDashboardFeed({ rest: client, realtime, online: deps.online, pollMs: deps.dashboardPollMs });

  const operator: OperatorConsole = {
    async resetStation(target, reason) {
      if (!isStationId(target)) throw new BackendError('INVALID_INPUT', 'Choose Station A or Station B.');
      const note = reason.replace(/\s+/g, ' ').trim();
      if (note.length < ADMIN_REASON.min || note.length > ADMIN_REASON.max) {
        throw new BackendError('INVALID_INPUT', `Reset reason must be ${ADMIN_REASON.min}-${ADMIN_REASON.max} characters.`);
      }
      await auth.requireOperator();
      const res = await call<AdminResetResponse>('admin-reset', { stationId: target, reason: note, actionId: newActionId() });
      if (res.data.stationId !== target) throw new BackendError('SERVER', 'The server reset a different station.');
    },
  };

  return {
    mode: 'live',
    backend,
    dashboard,
    auth,
    operator,
    subscribeStation: (listener) => watch.subscribe(listener),
  };
}

export async function createLiveServices(stationId: StationId | null): Promise<AppServices> {
  if (stationId !== null && !isStationId(stationId)) throw new Error(`Unknown station "${String(stationId)}".`);
  const config = readLiveConfig();
  return buildLiveServices({ stationId, config, client: sharedSupabase(config, stationId) });
}
