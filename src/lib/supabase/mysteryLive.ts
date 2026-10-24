// LIVE (verified) services for "Nevermore: Deadly Secrets" (mystery-v4; v3.1 rows stay readable): station kiosk, Laptop 1 board, home leaderboard.
// Anon/publishable key only (client.ts refuses privileged keys); station identity comes from the signed-in account's
// JWT. Loaded with a dynamic import so supabase-js never reaches the LOCAL DEMO bundle.
import type { SupabaseClient } from '@supabase/supabase-js';
import { isStationId } from '../../game/index.ts';
import type { StationId } from '../../game/index.ts';
import { BackendError, newActionId, type AppServices, type OperatorConsole } from '../backend.ts';
import { createLiveAuth, type LiveAuth } from './auth.ts';
import { readLiveConfig, sharedSupabase, type LiveConfig } from './client.ts';
import type { FunctionTransport } from './functions.ts';
import { MysteryStationApi, classifyFailure, mysteryCaller, type MysteryCaller } from './mysteryApi.ts';
import { createMysteryBoardFeed, type MysteryBoardFeed } from './mysteryDashboardFeed.ts';
import { createMysteryStationWatch, type MysteryResetCheck, type MysteryStationWatch } from './mysteryStationWatch.ts';
import type { MysteryAdminResetResponse } from './mysteryWire.ts';
import { browserOnline, type OnlineSource, type RealtimeHost } from './realtime.ts';
import { createTop5Feed, type Top5Feed } from './mysteryLeaderboard.ts';

/** Same bounds as admin-reset's `reason` (sanitized note, audit log). */
const ADMIN_REASON = { min: 3, max: 200 } as const;

export interface MysteryLiveDeps {
  config: LiveConfig;
  client: SupabaseClient;
  /** Defaults to `client`; tests inject a fake Realtime host. */
  realtime?: RealtimeHost;
  /** Defaults to `fetch`; tests route it to the in-memory server. */
  fetch?: typeof fetch;
  online?: OnlineSource;
  transport?: Partial<Pick<FunctionTransport, 'timeoutMs' | 'maxAttempts' | 'sleep'>>;
  retryDelaysMs?: number[];
}

export interface MysteryStationServices {
  mode: 'live';
  stationId: StationId;
  auth: LiveAuth;
  api: MysteryStationApi;
  watch: MysteryStationWatch;
  online: OnlineSource;
  /** Home-page leaderboard (mystery_top5 + full board + defeat log, Realtime refresh) — FINAL_CONTRACT §10. */
  leaderboard: Top5Feed;
}

export interface MysteryBoardServices {
  mode: 'live';
  auth: LiveAuth;
  /** admin-reset with scope 'all' (the mystery session AND any v2.5 race of that station), operator only. */
  operator: OperatorConsole;
  feed: MysteryBoardFeed;
  /** The v4 top 5 / full board / defeat log (the dashboard laptop may show it too). */
  leaderboard: Top5Feed;
  /** The same auth + operator shaped for the shared OperatorDrawer (its other members refuse). */
  drawerServices: AppServices;
}

function transportFor(deps: MysteryLiveDeps, auth: LiveAuth): FunctionTransport {
  return {
    url: deps.config.url,
    anonKey: deps.config.anonKey,
    getAccessToken: () => auth.getAccessToken(),
    refreshAccessToken: () => auth.refreshAccessToken(),
    ...(deps.fetch ? { fetch: deps.fetch } : {}),
    ...deps.transport,
  };
}

export function buildMysteryStationServices(deps: MysteryLiveDeps & { stationId: StationId }): MysteryStationServices {
  const { stationId } = deps;
  if (!isStationId(stationId)) throw new Error(`Unknown station "${String(stationId)}".`);
  const auth = createLiveAuth(deps.client, stationId);
  const api = new MysteryStationApi({ stationId, auth, call: mysteryCaller(transportFor(deps, auth)) });
  const online = deps.online ?? browserOnline;

  async function confirmReset(sessionId: string): Promise<MysteryResetCheck> {
    try {
      const env = await api.get(sessionId);
      if (!env) return 'unknown';
      if (env.session.status === 'offered' || env.session.status === 'playing') return 'active';
      return env.session.status === 'abandoned' && env.session.abandonedReason === 'operator_reset' ? 'reset' : 'unknown';
    } catch (err) {
      return classifyFailure(err) === 'reset' ? 'reset' : 'unknown';
    }
  }

  const watch = createMysteryStationWatch({
    stationId, rest: deps.client, realtime: deps.realtime ?? deps.client, confirmReset, online, retryDelaysMs: deps.retryDelaysMs,
  });
  const leaderboard = createTop5Feed({ rest: deps.client, realtime: deps.realtime ?? deps.client, online, retryDelaysMs: deps.retryDelaysMs, full: true });
  return { mode: 'live', stationId, auth, api, watch, online, leaderboard };
}

export function operatorConsole(auth: Pick<LiveAuth, 'requireOperator'>, call: MysteryCaller): OperatorConsole {
  return {
    async resetStation(target, reason) {
      if (!isStationId(target)) throw new BackendError('INVALID_INPUT', 'Choose Station A or Station B.');
      const note = reason.replace(/\s+/g, ' ').trim();
      if (note.length < ADMIN_REASON.min || note.length > ADMIN_REASON.max) {
        throw new BackendError('INVALID_INPUT', `Reset reason must be ${ADMIN_REASON.min}-${ADMIN_REASON.max} characters.`);
      }
      await auth.requireOperator();
      const res = await call<MysteryAdminResetResponse>('admin-reset', { stationId: target, reason: note, actionId: newActionId(), scope: 'all' });
      if (res.data.stationId !== target) throw new BackendError('SERVER', 'The server reset a different station.');
    },
  };
}

export function buildMysteryBoardServices(deps: MysteryLiveDeps & { pollMs?: number; tickMs?: number; now?: () => number }): MysteryBoardServices {
  const auth = createLiveAuth(deps.client, null);
  const call = mysteryCaller(transportFor(deps, auth));
  const operator = operatorConsole(auth, call);
  const feed = createMysteryBoardFeed({
    rest: deps.client,
    realtime: deps.realtime ?? deps.client,
    isOperator: async () => (await auth.currentUser())?.role === 'operator',
    online: deps.online,
    pollMs: deps.pollMs,
    tickMs: deps.tickMs,
    now: deps.now,
    retryDelaysMs: deps.retryDelaysMs,
  });
  // Operator sign-in / sign-out changes what RLS returns: reload (outside the auth callback, which must stay sync).
  deps.client.auth.onAuthStateChange((event) => {
    if (event === 'SIGNED_IN' || event === 'SIGNED_OUT') setTimeout(() => void feed.refresh().catch(() => undefined), 0);
  });
  const refuse = async (): Promise<never> => {
    throw new BackendError('UNAUTHORIZED', 'This page is not a station terminal.');
  };
  const drawerServices: AppServices = {
    mode: 'live',
    backend: {
      mode: 'live', stationId: 'local', createSession: refuse, getActiveSession: async () => null, prepareLeg: refuse,
      resolveLeg: refuse, abandonSession: refuse,
    },
    dashboard: { mode: 'live', subscribe: () => () => undefined, refresh: async () => undefined },
    auth,
    operator,
    subscribeStation: () => () => undefined,
  };
  const leaderboard = createTop5Feed({ rest: deps.client, realtime: deps.realtime ?? deps.client, online: deps.online, retryDelaysMs: deps.retryDelaysMs, full: true });
  return { mode: 'live', auth, operator, feed, leaderboard, drawerServices };
}

export async function createMysteryStationServices(stationId: StationId): Promise<MysteryStationServices> {
  const config = readLiveConfig();
  return buildMysteryStationServices({ stationId, config, client: sharedSupabase(config, stationId) });
}

export async function createMysteryBoardServices(): Promise<MysteryBoardServices> {
  const config = readLiveConfig();
  return buildMysteryBoardServices({ config, client: sharedSupabase(config, null) });
}
