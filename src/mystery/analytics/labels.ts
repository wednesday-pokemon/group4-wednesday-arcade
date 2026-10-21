// Outcome definitions shared by training, evaluation, the live service and advice follow-up.
//
// DETECTION (the predictive target, "detected within the next 15 s"):
//   a detection event is a `hyde_mode` transition with `to === 'CHASE'` (the Hyde saw the player and started a chase)
//   or a `catch` event. For a snapshot at time t in which the Hyde is NOT already chasing, the label is 1 iff a
//   detection event e exists with t < e.t ≤ t + 15 s, else 0. Snapshots taken while the Hyde is already in CHASE are
//   not forecasts (the detection is happening now): they are excluded from training / evaluation and the live service
//   reports them as `detectedNow` (p = 1). Snapshots of runs that stopped for any reason other than finish / DNF within
//   15 s of their last sample (a bot timeout) are right-censored and dropped.
// EXTRACTION (second target): the episode ends with the egg delivered at Iago Tower (outcome 'finished').
// ETA (optional regression): seconds from t to the next progress event (clue_found, egg_pickup or egg_delivered).
import type { StampedEvent } from '../types.ts';

export const DETECTION_HORIZON_S = 15;

export function isDetectionEvent(e: StampedEvent): boolean {
  return (e.type === 'hyde_mode' && e.to === 'CHASE') || e.type === 'catch';
}

export function isProgressEvent(e: StampedEvent): boolean {
  return e.type === 'clue_found' || e.type === 'egg_pickup' || e.type === 'egg_delivered';
}

/** Ascending detection times of a log. */
export function detectionTimes(events: readonly StampedEvent[]): number[] {
  return events.filter(isDetectionEvent).map((e) => e.t);
}

/** True iff some time x in the ascending `times` satisfies t < x ≤ t + horizon. */
export function anyWithin(times: readonly number[], t: number, horizon = DETECTION_HORIZON_S): boolean {
  // binary search for the first x > t
  let lo = 0;
  let hi = times.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (times[mid] <= t) lo = mid + 1;
    else hi = mid;
  }
  return lo < times.length && times[lo] <= t + horizon + 1e-9;
}

/** Seconds from t to the first time in ascending `times` that is > t, or null. */
export function secondsToNext(times: readonly number[], t: number): number | null {
  for (const x of times) if (x > t) return x - t;
  return null;
}
