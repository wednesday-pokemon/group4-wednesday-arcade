// AuthGate for LIVE mode. Email/password accounts are provisioned by the operator; the account's role and
// station come from `app_users` (RLS returns only the caller's row). A page is scoped either to one station
// terminal (role "station" bound to that station) or to the dashboard (role "operator"); any other account
// is signed out of this page immediately. The server re-derives the station from the JWT on every call.
import { isAuthRetryableFetchError, type SupabaseClient } from '@supabase/supabase-js';
import { isStationId } from '../../game/index.ts';
import type { StationId } from '../../game/index.ts';
import { BackendError, type AuthGate, type AuthUser } from '../backend.ts';

export interface LiveAuth extends AuthGate {
  /** Signed-in station account bound to `stationId`, else BackendError UNAUTHORIZED. */
  requireStation(stationId: StationId): Promise<AuthUser>;
  /** Signed-in operator account, else BackendError UNAUTHORIZED. */
  requireOperator(): Promise<AuthUser>;
  getAccessToken(): Promise<string | null>;
  refreshAccessToken(): Promise<string | null>;
}

interface Profile {
  role: 'station' | 'operator';
  stationId: StationId | null;
}

function stationName(id: StationId | null): string {
  return id === 'station_a' ? 'Station A' : id === 'station_b' ? 'Station B' : 'no station';
}

/** Why `profile` may not use a page scoped to `scope` (null = dashboard), or null when it may. */
export function scopeProblem(profile: Profile, scope: StationId | null): string | null {
  if (scope === null) return profile.role === 'operator' ? null : 'Only operator accounts can sign in on the dashboard.';
  if (profile.role !== 'station') return 'This is not a station terminal account.';
  if (profile.stationId !== scope) return `This account belongs to ${stationName(profile.stationId)}, not ${stationName(scope)}.`;
  return null;
}

export function createLiveAuth(client: SupabaseClient, scope: StationId | null): LiveAuth {
  const profiles = new Map<string, Profile>();
  client.auth.onAuthStateChange((event) => {
    // Synchronous only: Supabase forbids awaiting other auth calls inside this callback.
    if (event === 'SIGNED_OUT' || event === 'USER_UPDATED') profiles.clear();
  });

  async function loadProfile(userId: string): Promise<Profile | null> {
    const cached = profiles.get(userId);
    if (cached) return cached;
    const { data, error } = await client.from('app_users').select('role,station_id').maybeSingle();
    if (error) throw new BackendError('NETWORK', 'Could not load the account role. Check the connection and try again.', true);
    if (!data) return null;
    const row = data as { role?: unknown; station_id?: unknown };
    if (row.role !== 'station' && row.role !== 'operator') return null;
    const profile: Profile = { role: row.role, stationId: isStationId(row.station_id) ? row.station_id : null };
    profiles.set(userId, profile);
    return profile;
  }

  async function signOutLocal(): Promise<void> {
    profiles.clear();
    await client.auth.signOut({ scope: 'local' }).catch(() => undefined);
  }

  async function sessionUser(): Promise<{ id: string; email: string } | null> {
    const { data, error } = await client.auth.getSession();
    if (error || !data.session) return null;
    return { id: data.session.user.id, email: data.session.user.email ?? '' };
  }

  const gate: LiveAuth = {
    async currentUser() {
      const user = await sessionUser();
      if (!user) return null;
      const profile = await loadProfile(user.id);
      if (!profile || scopeProblem(profile, scope)) return null;
      return { email: user.email, role: profile.role, stationId: profile.stationId };
    },

    async signIn(email, password) {
      const { data, error } = await client.auth.signInWithPassword({ email: email.trim(), password });
      if (error || !data.session) {
        if (error && isAuthRetryableFetchError(error)) throw new BackendError('NETWORK', 'Could not reach the sign-in service.', true);
        throw new BackendError('UNAUTHORIZED', 'Wrong email or password.');
      }
      let profile: Profile | null;
      try {
        profile = await loadProfile(data.session.user.id);
      } catch (err) {
        await signOutLocal();
        throw err;
      }
      if (!profile) {
        await signOutLocal();
        throw new BackendError('UNAUTHORIZED', 'This account is not provisioned for the regatta.');
      }
      const problem = scopeProblem(profile, scope);
      if (problem) {
        await signOutLocal();
        throw new BackendError('UNAUTHORIZED', problem);
      }
      return { email: data.session.user.email ?? email.trim(), role: profile.role, stationId: profile.stationId };
    },

    async signOut() {
      await signOutLocal();
    },

    async requireStation(stationId) {
      const user = await gate.currentUser();
      if (!user || user.role !== 'station' || user.stationId !== stationId) {
        throw new BackendError('UNAUTHORIZED', `Sign in with the ${stationName(stationId)} account first.`);
      }
      return user;
    },

    async requireOperator() {
      const user = await gate.currentUser();
      if (!user || user.role !== 'operator') throw new BackendError('UNAUTHORIZED', 'Operator sign-in required.');
      return user;
    },

    async getAccessToken() {
      const { data } = await client.auth.getSession();
      return data.session?.access_token ?? null;
    },

    async refreshAccessToken() {
      const { data, error } = await client.auth.refreshSession();
      return error ? null : data.session?.access_token ?? null;
    },
  };
  return gate;
}
