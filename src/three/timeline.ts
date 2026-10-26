// Pure, deterministic cinematic timeline: LegResolution -> pose as a function of normalised time t in [0,1].
// No three.js / DOM dependency, so it is unit-testable and identical for skip(), advanceTime() and live play.
import type { LegResolution, RaceBeat, RouteId } from './types.ts';
import { TRACK_LEN, pathX, pathZ } from './layout.ts';
import { clamp, lerp, pulse, smoothstep } from './util.ts';

export const DURATION_MS = { normal: 9000, reduced: 5000 } as const;

export interface BeatTime {
  t: number;
  beat: RaceBeat;
}

export interface Pose {
  t: number;
  /** progress along the track 0..1 */
  p: number;
  boatX: number;
  boatZ: number;
  heading: number;
  /** 0..~1.3 relative rowing speed */
  speed: number;
  /** speed-boost visual intensity 0..1 */
  boost: number;
  /** Hyde pursuit gap in metres (clamped >=0) */
  hydeGap: number;
  /** 0..1 lunge towards the boat */
  lunge: number;
  shield: number;
  /** 0..1 boat knocked by crash */
  crashHit: number;
  /** true while a collected egg is aboard */
  eggCarried: boolean;
  /** 0..1 pickup glow burst */
  eggPickup: number;
  /** 0 (not lost) .. 1 (lost anim complete) */
  eggLost: number;
  flash: number;
  flashColor: [number, number, number];
  shake: number;
  darkness: number;
  finishGlow: number;
  camYaw: number;
  wreck: number;
}

export interface Timeline {
  res: LegResolution;
  durationMs: number;
  beats: BeatTime[];
  tEgg: number;
  tCrash: number;
  /** world-space obstacle/egg anchor points on the route */
  eggAt: { x: number; z: number } | null;
  crashAt: { x: number; z: number } | null;
  /** t at which the (possibly lost) egg is lost, or -1 */
  tEggLost: number;
  poseAt(t: number): Pose;
  endPose(): Pose;
}

const N = 800;
const deg = (d: number) => (d * Math.PI) / 180;

const T = {
  start: 0,
  route: 0.06,
  egg: 0.34,
  crash: 0.5,
  hyde: 0.6,
  catch: 0.72,
  escape: 0.83,
  dock: 0.9,
  dnf: 0.94,
  finish: 0.97,
};

export function buildTimeline(res: LegResolution, reducedMotion: boolean): Timeline {
  const route: RouteId = res.route;
  const dnf = res.outcome === 'dnf';
  const finished = res.outcome === 'finished';
  const crash = res.crashOccurred;
  const negated = crash && res.crashNegatedBy !== null;
  const hardCrash = crash && !negated;
  const catchIt = res.hydeCatch;
  const egg = res.eggAttempted;
  const hpDnfNoCatch = dnf && !catchIt;

  const tEgg = T.egg;
  const tCrash = T.crash;
  const stallFrom = catchIt ? 0.74 : hpDnfNoCatch ? (crash ? 0.58 : 0.7) : 2;

  // ---- speed profile -> cumulative progress table
  const speedAt = (t: number): number => {
    let s = smoothstep(0, 0.07, t) * 0.9 + 0.1;
    const push = (res.pushLevel - 1) / 2;
    s *= 1 + 0.22 * push * pulse(0.08, 0.16, 0.8, 0.9, t);
    if (hardCrash) s *= 1 - 0.8 * Math.exp(-(((t - 0.525) / 0.045) ** 2));
    else if (negated) s *= 1 - 0.25 * Math.exp(-(((t - 0.5) / 0.025) ** 2));
    if (catchIt && !dnf) s *= 1 - 0.75 * Math.exp(-(((t - 0.755) / 0.05) ** 2));
    if (!dnf) s *= 1 + (catchIt ? 0.9 : 0.5) * smoothstep(0.78, 0.86, t) * (1 - smoothstep(0.92, 1, t));
    if (stallFrom < 2) s *= 1 - smoothstep(stallFrom, stallFrom + 0.1, t) * 0.97;
    else if (finished) s *= 1 - 0.92 * smoothstep(0.86, 1, t);
    else s *= 1 - 0.55 * smoothstep(0.9, 1, t);
    return s;
  };
  const cum = new Float64Array(N + 1);
  for (let i = 1; i <= N; i++) cum[i] = cum[i - 1] + speedAt((i - 0.5) / N);
  const pEnd = dnf ? (catchIt ? 0.74 : crash ? 0.6 : 0.78) : 1;
  const total = cum[N] || 1;
  const progressAt = (t: number): number => {
    const x = clamp(t, 0, 1) * N;
    const i = Math.min(N - 1, Math.floor(x));
    const f = x - i;
    return ((cum[i] + (cum[i + 1] - cum[i]) * f) / total) * pEnd;
  };

  // Anchors are slightly ahead of the boat so the bow touches them at the event time.
  const anchorAhead = (t: number, ahead: number) => {
    const p = progressAt(t) + ahead / TRACK_LEN;
    return { x: pathX(route, p), z: pathZ(p) };
  };
  const eggAt = egg ? anchorAhead(tEgg, 1.3) : null;
  const crashAt = crash ? anchorAhead(tCrash, 1.9) : null;
  const tEggLost = egg
    ? res.eggFailed
      ? crash
        ? tCrash + 0.025
        : 0.62
      : catchIt && res.eggPointsLostToCatch > 0
        ? T.catch + 0.02
        : -1
    : -1;

  // ---- Hyde gap
  const gA = Math.max(0, res.gapStartM);
  const gB = Math.max(0, res.gapBeforeCatchM);
  const gC = Math.max(0, res.gapEndM);
  const crashM = res.gapDeltas.find((d) => d.source === 'crash' && !d.negatedBy)?.meters ?? 0;
  const gPre = crashM < 0 ? gB - crashM : gB;
  const gapAt = (t: number): number => {
    let g = lerp(gA, gPre, smoothstep(0.04, 0.48, t));
    g = lerp(g, gB, smoothstep(0.5, 0.56, t));
    if (catchIt && !dnf) g = lerp(g, gC, smoothstep(0.78, 0.9, t));
    else if (!catchIt) g = lerp(g, gC, smoothstep(0.62, 0.9, t));
    return g;
  };

  const lungeAt = (t: number): number => {
    if (!catchIt) return 0;
    const up = smoothstep(0.6, T.catch, t);
    return dnf ? up : up * (1 - smoothstep(0.78, 0.88, t));
  };

  // ---- camera yaw keyframes (rad); 0 = straight behind the boat, ~pi/2 = side, >pi/2 = from ahead looking back
  // inside the narrow shortcut corridor the rear camera is kept nearly straight behind the boat so rocks never block the view
  const rear = route === 'shortcut' ? 12 : 30;
  const rear2 = route === 'shortcut' ? 14 : 38;
  const rawKeys: [number, number][] = reducedMotion
    ? [[0, 100], [1, 100]]
    : catchIt
      ? [[0, 78], [0.1, rear], [0.5, rear2], [0.6, 108], [0.8, 120], [0.9, dnf ? 122 : rear2], [1, dnf ? 122 : 28]]
      : [[0, 78], [0.1, rear], [0.5, rear2], [0.6, 102], [0.78, 108], [0.9, rear2], [1, finished ? 22 : 34]];
  const yawKeys = rawKeys.map(([a, b]) => [a, deg(b)] as [number, number]);
  const yawAt = (t: number): number => {
    if (t <= yawKeys[0][0]) return yawKeys[0][1];
    for (let i = 1; i < yawKeys.length; i++) {
      if (t <= yawKeys[i][0]) {
        const [t0, y0] = yawKeys[i - 1];
        const [t1, y1] = yawKeys[i];
        return lerp(y0, y1, smoothstep(t0, t1, t));
      }
    }
    return yawKeys[yawKeys.length - 1][1];
  };

  const beats: BeatTime[] = [
    { t: T.start, beat: 'start' },
    { t: T.route, beat: 'route' },
  ];
  if (egg) beats.push({ t: tEgg, beat: 'egg' });
  if (crash) beats.push({ t: tCrash, beat: 'crash' });
  beats.push({ t: T.hyde, beat: 'hyde' });
  if (catchIt) beats.push({ t: T.catch, beat: 'catch' });
  if (!dnf) beats.push({ t: T.escape, beat: 'escape' });
  if (finished) {
    beats.push({ t: T.dock, beat: 'dock' });
    beats.push({ t: T.finish, beat: 'finish' });
  }
  if (dnf) beats.push({ t: T.dnf, beat: 'dnf' });
  beats.sort((a, b) => a.t - b.t);

  const poseAt = (tt: number): Pose => {
    const t = clamp(tt, 0, 1);
    const p = progressAt(t);
    const x = pathX(route, p);
    const z = pathZ(p);
    const p2 = Math.min(1.2, p + 0.004);
    const heading = Math.atan2(-(pathX(route, p2) - x), -(pathZ(p2) - z));
    const push = (res.pushLevel - 1) / 2;
    const boost = clamp(
      push * pulse(0.06, 0.16, 0.78, 0.9, t) * 0.8 + (!catchIt && !dnf ? 0.5 * pulse(0.78, 0.84, 0.88, 0.94, t) : 0),
      0,
      1,
    );

    // flashes
    const fCatch = catchIt && t >= T.catch ? Math.exp(-((t - T.catch) / 0.022)) * 0.85 : 0;
    const fCrash = hardCrash && t >= tCrash ? Math.exp(-((t - tCrash) / 0.015)) * 0.4 : 0;
    const fShield = negated && t >= tCrash ? Math.exp(-((t - tCrash) / 0.03)) * 0.45 : 0;
    const fFinish = finished ? pulse(0.955, 0.97, 0.972, 0.99, t) * 0.2 : 0;
    let flash: number;
    let flashColor: [number, number, number];
    if (fCatch >= fCrash && fCatch >= fShield && fCatch >= fFinish) {
      flash = fCatch;
      flashColor = [0.85, 0.7, 1];
    } else if (fShield >= fCrash && fShield >= fFinish) {
      flash = fShield * 0.45;
      flashColor = [0.45, 0.95, 1];
    } else if (fCrash >= fFinish) {
      flash = fCrash;
      flashColor = [1, 0.95, 0.9];
    } else {
      flash = fFinish;
      flashColor = [1, 0.85, 0.45];
    }

    const shake =
      (hardCrash && t >= tCrash ? Math.exp(-((t - tCrash) / 0.03)) : 0) * 0.9 +
      (negated && t >= tCrash ? Math.exp(-((t - tCrash) / 0.02)) : 0) * 0.3 +
      (catchIt && t >= T.catch ? Math.exp(-((t - T.catch) / 0.04)) : 0);

    return {
      t,
      p,
      boatX: x,
      boatZ: z,
      heading,
      speed: speedAt(t),
      boost,
      hydeGap: gapAt(t),
      lunge: lungeAt(t),
      shield: negated ? pulse(tCrash - 0.005, tCrash + 0.008, tCrash + 0.03, tCrash + 0.1, t) : 0,
      crashHit: hardCrash
        ? pulse(tCrash - 0.004, tCrash + 0.01, tCrash + 0.04, tCrash + 0.12, t)
        : negated
          ? 0.3 * pulse(tCrash - 0.004, tCrash + 0.008, tCrash + 0.02, tCrash + 0.06, t)
          : 0,
      eggCarried: egg && t >= tEgg && !(tEggLost >= 0 && t >= tEggLost),
      eggPickup: egg ? pulse(tEgg - 0.01, tEgg + 0.005, tEgg + 0.03, tEgg + 0.12, t) : 0,
      eggLost: tEggLost >= 0 ? smoothstep(tEggLost, tEggLost + 0.07, t) : 0,
      flash,
      flashColor,
      shake,
      darkness: dnf ? smoothstep(0.8, 0.97, t) : 0,
      finishGlow: finished ? smoothstep(0.9, 0.99, t) : 0,
      camYaw: yawAt(t),
      wreck: dnf ? smoothstep(stallFrom < 2 ? stallFrom : 0.8, 0.97, t) : 0,
    };
  };

  return {
    res,
    durationMs: reducedMotion ? DURATION_MS.reduced : DURATION_MS.normal,
    beats,
    tEgg,
    tCrash,
    eggAt,
    crashAt,
    tEggLost,
    poseAt,
    endPose: () => poseAt(1),
  };
}
