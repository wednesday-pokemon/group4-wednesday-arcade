// Caller identity. The gateway (verify_jwt = true) already rejects missing/invalid JWTs; we still verify the
// token with Auth (getUser also catches revoked/deleted/banned users) and bind it to an app_users row.
// The anon key alone is never enough: it carries no user, so getUser fails -> 401.
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.45.4';
import type { StationId } from './game/index.ts';
import { HttpError } from './errors.ts';

export interface Caller {
  userId: string;
  role: 'station' | 'operator';
  stationId: StationId | null;
}

export function bearerToken(req: Request): string {
  const header = req.headers.get('authorization') ?? '';
  const match = /^Bearer\s+([A-Za-z0-9._-]+)$/.exec(header.trim());
  if (!match) throw new HttpError('UNAUTHENTICATED', 'Missing bearer token');
  return match[1];
}

export async function requireCaller(req: Request, admin: SupabaseClient): Promise<Caller> {
  const jwt = bearerToken(req);
  const { data, error } = await admin.auth.getUser(jwt);
  const user = data?.user;
  if (error || !user) throw new HttpError('UNAUTHENTICATED', 'Invalid or expired session; sign in again');
  const bannedUntil = (user as { banned_until?: string | null }).banned_until;
  if (bannedUntil && Date.parse(bannedUntil) > Date.now()) {
    throw new HttpError('UNAUTHENTICATED', 'This account is disabled');
  }
  const { data: row, error: rowError } = await admin
    .from('app_users').select('role, station_id').eq('user_id', user.id).maybeSingle();
  if (rowError) throw new HttpError('INTERNAL', 'Could not load account role');
  if (!row) throw new HttpError('NOT_PROVISIONED', 'This account is not provisioned for the regatta');
  return { userId: user.id, role: row.role, stationId: row.station_id ?? null };
}

export function requireStation(caller: Caller): StationId {
  if (caller.role !== 'station' || !caller.stationId) {
    throw new HttpError('FORBIDDEN_ROLE', 'Only station terminal accounts can do this');
  }
  return caller.stationId;
}

export function requireOperator(caller: Caller): void {
  if (caller.role !== 'operator') throw new HttpError('FORBIDDEN_ROLE', 'Only operator accounts can do this');
}

export function actorOf(caller: Caller): { userId: string; role: Caller['role']; stationId: StationId | null } {
  return { userId: caller.userId, role: caller.role, stationId: caller.stationId };
}
