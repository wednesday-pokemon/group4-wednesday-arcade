// Browser Supabase client for LIVE mode. Only the public URL + anon/publishable key ever reach the browser;
// a privileged key is refused outright (docs/SECURITY.md T-11). One client per page scope (station / dashboard)
// with its own auth storage key so two stations open in one browser profile never share a session.
import { createClient, type SupabaseClient, type SupportedStorage } from '@supabase/supabase-js';
import type { StationId } from '../../game/index.ts';

export interface LiveConfig {
  url: string;
  anonKey: string;
}

export interface ClientOverrides {
  fetch?: typeof fetch;
  storage?: SupportedStorage;
  autoRefreshToken?: boolean;
}

/** Decodes the payload of a JWT-shaped key without verifying it (only used to refuse privileged keys). */
function jwtRole(key: string): string | null {
  const parts = key.split('.');
  if (parts.length !== 3) return null;
  try {
    const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const json = JSON.parse(atob(b64.padEnd(b64.length + ((4 - (b64.length % 4)) % 4), '='))) as { role?: unknown };
    return typeof json.role === 'string' ? json.role : null;
  } catch {
    return null;
  }
}

/** Throws unless `key` is a browser-safe key: legacy JWT with role "anon", or an `sb_publishable_` key. */
export function assertBrowserSafeKey(key: string): void {
  if (key.startsWith('sb_secret_')) throw new Error('Refusing a secret Supabase key in the browser; use the anon/publishable key.');
  const role = jwtRole(key);
  if (role !== null && role !== 'anon') {
    throw new Error(`Refusing a privileged Supabase key (role "${role}") in the browser; use the anon/publishable key.`);
  }
}

export function readLiveConfig(env: Record<string, unknown> = import.meta.env): LiveConfig {
  const url = typeof env.VITE_SUPABASE_URL === 'string' ? env.VITE_SUPABASE_URL.trim().replace(/\/+$/, '') : '';
  const anonKey = typeof env.VITE_SUPABASE_ANON_KEY === 'string' ? env.VITE_SUPABASE_ANON_KEY.trim() : '';
  if (!url || !anonKey) throw new Error('Live mode is not configured (VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY).');
  if (!/^https?:\/\//i.test(url)) throw new Error('VITE_SUPABASE_URL must be an http(s) URL.');
  assertBrowserSafeKey(anonKey);
  return { url, anonKey };
}

export function storageKeyFor(stationId: StationId | null): string {
  return `raven-regatta:auth:${stationId ?? 'dashboard'}`;
}

export function createSupabase(config: LiveConfig, stationId: StationId | null, overrides: ClientOverrides = {}): SupabaseClient {
  assertBrowserSafeKey(config.anonKey);
  return createClient(config.url, config.anonKey, {
    auth: {
      persistSession: true,
      storageKey: storageKeyFor(stationId),
      autoRefreshToken: overrides.autoRefreshToken ?? true,
      detectSessionInUrl: false,
      ...(overrides.storage ? { storage: overrides.storage } : {}),
    },
    realtime: { params: { eventsPerSecond: 20 } },
    ...(overrides.fetch ? { global: { fetch: overrides.fetch } } : {}),
  });
}

const clients = new Map<string, SupabaseClient>();

/** Process-wide singleton per page scope (App may call createServices again on "Retry"). */
export function sharedSupabase(config: LiveConfig, stationId: StationId | null): SupabaseClient {
  const key = `${config.url}|${storageKeyFor(stationId)}`;
  let client = clients.get(key);
  if (!client) {
    client = createSupabase(config, stationId);
    clients.set(key, client);
  }
  return client;
}
