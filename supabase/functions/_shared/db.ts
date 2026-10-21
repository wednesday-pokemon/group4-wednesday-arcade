// Service-role data access. The service role key is injected by the platform (SUPABASE_SERVICE_ROLE_KEY)
// and never leaves the Edge runtime. All writes go through SECURITY DEFINER RPCs; reads are narrow selects.
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2.45.4';
import type { GameState, StationId } from './game/index.ts';
import { HttpError, fromRpcEnvelope } from './errors.ts';

let cached: SupabaseClient | null = null;

export function adminClient(): SupabaseClient {
  if (cached) return cached;
  const url = Deno.env.get('SUPABASE_URL');
  // Platform-injected service role key. RAVEN_SERVICE_KEY is an optional override for projects that disabled
  // the legacy JWT keys (user secrets may not start with SUPABASE_). Never sent to clients, never logged.
  const key = Deno.env.get('RAVEN_SERVICE_KEY') || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !key) throw new HttpError('MISCONFIGURED', 'Server is missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY');
  cached = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { headers: { 'x-client-info': 'raven-regatta-edge' } },
  });
  return cached;
}

export interface SessionRow {
  id: string;
  station_id: StationId;
  status: GameState['status'];
  revision: number;
  state: GameState;
  seed_commitment: string;
  abandoned_reason: 'player_reset' | 'operator_reset' | 'superseded' | null;
  created_at: string;
  completed_at: string | null;
  verified_at: string | null;
}

const SESSION_COLUMNS =
  'id, station_id, status, revision, state, seed_commitment, abandoned_reason, created_at, completed_at, verified_at';

function dbFault(context: string, error: { message?: string; code?: string } | null): HttpError {
  console.error(JSON.stringify({ level: 'error', msg: 'db_error', context, code: error?.code, detail: error?.message }));
  return new HttpError('INTERNAL', 'Database request failed');
}

/**
 * Load a session the caller may act on. A session of ANOTHER station is reported exactly like a missing
 * one (404) so session ids cannot be probed. Operators (stationId === null) may load any session.
 */
export async function loadSession(admin: SupabaseClient, sessionId: string, stationId: StationId | null): Promise<SessionRow> {
  const { data, error } = await admin.from('sessions').select(SESSION_COLUMNS).eq('id', sessionId).maybeSingle();
  if (error) throw dbFault('loadSession', error);
  if (!data || (stationId !== null && data.station_id !== stationId)) {
    throw new HttpError('SESSION_NOT_FOUND', 'Session not found for this station');
  }
  return data as SessionRow;
}

export async function loadInProgressSessions(admin: SupabaseClient, stationId: StationId): Promise<SessionRow[]> {
  const { data, error } = await admin
    .from('sessions').select(SESSION_COLUMNS).eq('station_id', stationId).eq('status', 'in_progress');
  if (error) throw dbFault('loadInProgressSessions', error);
  return (data ?? []) as SessionRow[];
}

export async function loadSeed(admin: SupabaseClient, sessionId: string): Promise<string> {
  const { data, error } = await admin.from('session_secrets').select('seed').eq('session_id', sessionId).single();
  if (error || !data) throw dbFault('loadSeed', error);
  return data.seed as string;
}

export interface Receipt {
  action_type: string;
  request: { body?: unknown };
  response: Record<string, unknown>;
}

export async function findReceipt(admin: SupabaseClient, sessionId: string, actionId: string): Promise<Receipt | null> {
  const { data, error } = await admin
    .from('session_actions').select('action_type, request, response')
    .eq('session_id', sessionId).eq('action_id', actionId).maybeSingle();
  if (error) throw dbFault('findReceipt', error);
  return (data as Receipt | null) ?? null;
}

export interface StationStatusRow {
  station_id: StationId;
  label: string;
  session_id: string | null;
  status: string;
  notice: 'operator_reset' | 'player_reset' | 'superseded' | null;
}

export async function loadStationStatus(admin: SupabaseClient, stationId: StationId): Promise<StationStatusRow> {
  const { data, error } = await admin
    .from('station_status').select('station_id, label, session_id, status, notice').eq('station_id', stationId).single();
  if (error || !data) throw dbFault('loadStationStatus', error);
  return data as StationStatusRow;
}

export interface RpcOk {
  ok: true;
  replay?: boolean;
  response?: Record<string, unknown>;
  [key: string]: unknown;
}

/** Call a write RPC; business failures in the {ok:false} envelope become typed HttpErrors. */
export async function callRpc(admin: SupabaseClient, fn: string, args: Record<string, unknown>): Promise<RpcOk> {
  const { data, error } = await admin.rpc(fn, args);
  if (error) throw dbFault(`rpc:${fn}`, error);
  const envelope = data as Record<string, unknown> | null;
  if (!envelope || typeof envelope !== 'object') throw new HttpError('INTERNAL', 'Empty database response');
  if (envelope.ok !== true) throw fromRpcEnvelope(envelope);
  return envelope as RpcOk;
}
