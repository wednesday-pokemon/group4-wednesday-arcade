// Pending-intent journal: persisted BEFORE prepare/resolve is sent, cleared on acknowledgement.
// After a reload/reconnect the intent is retried with the SAME actionId only if it still matches
// the canonical revision; otherwise it is discarded (the server state wins).
import type { EggDecision, PushLevel, RouteId } from '../game/index.ts';
import type { ResolveLegInput } from '../lib/backend.ts';

export type PendingIntent =
  | { sessionId: string; kind: 'prepare'; actionId: string; expectedRevision: number; payload: { route: RouteId; pushLevel: PushLevel } }
  | {
      sessionId: string; kind: 'resolve'; actionId: string; expectedRevision: number;
      payload: { eggDecision: EggDecision; advisory?: ResolveLegInput['advisory'] };
    };

const keyFor = (stationKey: string) => `raven-regatta:pending-intent:${stationKey}`;

export function savePendingIntent(stationKey: string, intent: PendingIntent): void {
  try {
    localStorage.setItem(keyFor(stationKey), JSON.stringify(intent));
  } catch {
    // Storage blocked: the request still goes out; only reload recovery is lost.
  }
}

export function loadPendingIntent(stationKey: string): PendingIntent | null {
  try {
    const raw = localStorage.getItem(keyFor(stationKey));
    return raw ? (JSON.parse(raw) as PendingIntent) : null;
  } catch {
    return null;
  }
}

export function clearPendingIntent(stationKey: string): void {
  try {
    localStorage.removeItem(keyFor(stationKey));
  } catch {
    // ignore
  }
}

/** True when the stored intent can be replayed against this canonical state. */
export function intentMatches(intent: PendingIntent, sessionId: string, revision: number, status: string): boolean {
  return intent.sessionId === sessionId && intent.expectedRevision === revision && status === 'in_progress';
}
