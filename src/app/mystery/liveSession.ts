// LIVE station persistence: the visitor's create-intent and server session, per station.
//   localStorage['raven.mystery.session:<station>'] = { v, stationId, actionId, nickname, sessionId|null, createdAt }
// The actionId is written BEFORE mystery-create-session is called, so a refresh / retry before the answer arrived
// replays the SAME server session and offer instead of drawing a new one (no offer rerolling). The offer itself is
// never trusted from storage: a refresh asks mystery-get-session. Kept apart from the LOCAL DEMO key
// ('raven.mystery.session') so a demo session can never be mistaken for a verified one (and two station tabs in one
// browser profile never collide). Pure functions over an injected Storage.
import { isStationId } from '../../game/index.ts';
import type { StationId } from '../../game/index.ts';

export const LIVE_SESSION_PREFIX = 'raven.mystery.session:';

type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null;

export interface LiveSessionRecord {
  v: 1;
  stationId: StationId;
  actionId: string;
  nickname: string;
  /** null until mystery-create-session answered. */
  sessionId: string | null;
  createdAt: string;
}

export const liveSessionKey = (stationId: StationId) => `${LIVE_SESSION_PREFIX}${stationId}`;

const ACTION_RE = /^[A-Za-z0-9_-]{8,64}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function readLiveSession(storage: Store, stationId: StationId): LiveSessionRecord | null {
  try {
    const raw = storage?.getItem(liveSessionKey(stationId));
    if (!raw) return null;
    const r = JSON.parse(raw) as Partial<LiveSessionRecord>;
    if (r.v !== 1 || r.stationId !== stationId || !isStationId(r.stationId)) return null;
    if (typeof r.actionId !== 'string' || !ACTION_RE.test(r.actionId) || typeof r.nickname !== 'string') return null;
    if (r.sessionId !== null && (typeof r.sessionId !== 'string' || !UUID_RE.test(r.sessionId))) return null;
    return { v: 1, stationId: r.stationId, actionId: r.actionId, nickname: r.nickname, sessionId: r.sessionId ?? null, createdAt: String(r.createdAt ?? '') };
  } catch {
    return null;
  }
}

export function writeLiveSession(storage: Store, rec: LiveSessionRecord): boolean {
  try {
    storage?.setItem(liveSessionKey(rec.stationId), JSON.stringify(rec));
    return storage !== null;
  } catch {
    return false;
  }
}

export function clearLiveSession(storage: Store, stationId: StationId): void {
  try {
    storage?.removeItem(liveSessionKey(stationId));
  } catch {
    // ignore
  }
}
