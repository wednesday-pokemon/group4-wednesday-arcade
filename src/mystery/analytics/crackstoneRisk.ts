// Joseph Crackstone risk — a RULE-BASED estimate (never ML), docs/MYSTERY_MODEL_REPORT.md §7, UX_ENEMIES.md §3/§5.
//
//   p(cell) = P(Crackstone can see a STANDING, not hidden player at the cell centre at some instant of (t, t + H]),
//   H = 10 s, from PUBLIC knowledge only:
//     • his public patrol loop (CrackstoneDef.patrol), walked on his own nav grid at speed.PATROL with a patrolPauseS
//       look-around at every waypoint (both sweep directions allowed) → a loop timeline of K phase states every 0.5 s;
//     • his actual sight rules — sight.ts canSee() with HIS cfg.sight (cone, range, fog, walls + high cover), the
//       proximity sense (≤ proximityM all around, line of sight) and the scan (radius, line of sight; crouching does not
//       help) — precomputed once per (case, open walls) into vis / window / scan tables over 4 m cells cut to his leash
//       disc (cached, lazily);
//     • a belief over the loop phase: uniform at the start of play, collapsed on a public sighting (position + facing,
//       rule R4), down-weighted where the player would see him but does not, advanced at his walking pace (frozen while
//       a scan warning holds him still), spread a little every step and relaxed to uniform over about one loop;
//     • his public mode (HUD pill): CHASE / ATTACK (position public, R4) → what he sees from there; INVESTIGATE / SEARCH
//       → a search disc around the point he is going to (where he last saw the player, a decoy) with all-around looks;
//       RETURN → the patrol belief restarted at the waypoint he walks back to;
//     • the scan schedule from his public telegraphs (every scanEveryS ± scanJitterS after the last pulse, warning
//       scanWarnS before it, none while the Hyde chases — R6 — or within scanGraceAfterChaseS of a chase).
//   Combination given a phase φ (deterministic): seen-by-sight-in-window OR (not seen AND a pulse covers the cell).
// `here` uses the player's EXACT position and current stance (crouched → × crouchRangeMult and low cover; hidden → only
// within the hiding spot's reveal distance and never by a scan). Live cost: one K × C pass per 1 Hz sample.
import type { CrackstoneTuning } from '../config.ts';
import { polygonCentroid } from '../crackstone.ts';
import type { World } from '../geometry.ts';
import { pointInPolygon } from '../geometry.ts';
import type { NavGrid } from '../nav.ts';
import { canSee } from '../sight.ts';
import type { CrackstoneDef, CrackstoneMode, HidingSpotDef, Vec2 } from '../types.ts';

export const CRACK_HORIZON_S = 10;
export const CRACK_CELL_M = 4;
export const CRACK_STEP_S = 0.5;
export const CRACK_LABEL = 'Rule-based estimate' as const;
export const CRACK_MODEL_VERSION = 'crack-rule-1';

/** Tuning of the belief (documented in the report; not fitted). */
export const CRACK_BELIEF = {
  /** Sighting likelihood width (m) and the distance beyond which a sighting is "off the loop". */
  sightSigmaM: 1.2,
  offLoopM: 3,
  /** Likelihood of a phase from which the player WOULD see him while they do not (negative evidence). */
  unseenLikelihood: 0.15,
  /** Relaxation to the uniform phase prior: time constant = this × the loop period. */
  relaxLoops: 1,
  /** Phase spread (states) of a restart at a waypoint (RETURN) and after he is back on his rounds. */
  returnSigma: 4,
  returnedSigma: 2,
  /** Independent looks during a 10 s search window; each covers about half of the circle (cone 90° + a ~1.5 rad sweep). */
  searchLooks: 2,
  lookCover: 0.5,
  /** Search-spot sampling grid (m). */
  searchGridM: 1.5,
} as const;

export interface RiskGeometry {
  world: World;
  inFog(x: number, z: number): boolean;
  /** His nav grid (his radius). */
  nav: Pick<NavGrid, 'findPath' | 'walkable' | 'nearestWalkable'>;
  /** The player's nav grid (which cells a player can stand in). */
  playerNav: Pick<NavGrid, 'walkable' | 'nearestWalkable'>;
  hidingSpots: readonly HidingSpotDef[];
  /** Range at which the player sees him (playerSeesCrackstoneM). */
  playerSeesM: number;
}

export interface PhaseState { x: number; z: number; yaw: number; sweep: number; fog: boolean; waypoint: number }
export interface RiskCell { x: number; z: number; px: number; pz: number; fog: boolean; inArea: boolean }
export interface RiskTarget { x: number; z: number; crouched: boolean; hidden: boolean; fog: boolean; revealM: number | null }

function wrapIndex(i: number, k: number): number {
  return ((i % k) + k) % k;
}

function headingOf(a: Vec2, b: Vec2, fallback: number): number {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  if (Math.hypot(dx, dz) < 1e-6) return fallback;
  return Math.atan2(-dx, -dz); // contract convention: forward = (−sin yaw, −cos yaw)
}

/** Leash-disc clamp (the sim clamps search / investigate targets the same way). */
export function clampToDisc(p: Vec2, c: Vec2, r: number): Vec2 {
  const d = Math.hypot(p.x - c.x, p.z - c.z);
  if (d <= r || d < 1e-6) return { x: p.x, z: p.z };
  return { x: c.x + ((p.x - c.x) * r) / d, z: c.z + ((p.z - c.z) * r) / d };
}

/**
 * Precomputed tables of one case map (patrol timeline × leash cells). Immutable; cached by `crackstoneRiskModel()`.
 */
export class CrackstoneRiskModel {
  readonly states: PhaseState[];
  readonly cells: RiskCell[];
  readonly K: number;
  readonly C: number;
  /** Window length in states (H / Δ). */
  readonly N: number;
  readonly periodS: number;
  /** Phase index at which he arrives at each waypoint. */
  readonly arrival: number[];
  /** vis[φ·C + c]: he sees a standing player at cell c from phase φ (sight or proximity). */
  readonly vis: Uint8Array;
  /** win[φ·C + c]: he sees cell c at some phase in φ … φ + N. */
  readonly win: Uint8Array;
  /** scan[φ·C + c]: a pulse from phase φ's position covers cell c (radius + line of sight). */
  readonly scan: Uint8Array;
  /** Static patrol-route baseline: uniform phase, sight window + an average scan chance (no observations). */
  readonly staticP: Float64Array;
  /** scanCum[c·(K + 1) + k] = Σ_{j < k} scan[j·C + c] (fast sums of the scan table over a phase range). */
  readonly scanCum: Int32Array;
  readonly centroid: Vec2;

  constructor(
    readonly def: CrackstoneDef,
    readonly cfg: CrackstoneTuning,
    readonly geo: RiskGeometry,
    readonly horizonS = CRACK_HORIZON_S,
    readonly stepS = CRACK_STEP_S,
    readonly cellM = CRACK_CELL_M,
  ) {
    this.centroid = polygonCentroid(def.polygon); // the sim's own leash centre (one implementation)
    const tl = buildTimeline(def, cfg, geo, stepS);
    this.states = tl.states;
    this.arrival = tl.arrival;
    this.K = this.states.length;
    this.periodS = this.K * stepS;
    this.N = Math.max(1, Math.round(horizonS / stepS));
    this.cells = buildCells(def, this.centroid, geo, cellM);
    this.C = this.cells.length;
    const K = this.K;
    const C = this.C;
    this.vis = new Uint8Array(K * C);
    this.scan = new Uint8Array(K * C);
    for (let k = 0; k < K; k++) {
      const s = this.states[k];
      for (let c = 0; c < C; c++) {
        const cell = this.cells[c];
        const t: RiskTarget = { x: cell.px, z: cell.pz, crouched: false, hidden: false, fog: cell.fog, revealM: null };
        if (this.seesFrom(s, t)) this.vis[k * C + c] = 1;
        if (this.scanCovers(s, t)) this.scan[k * C + c] = 1;
      }
    }
    this.scanCum = new Int32Array(C * (K + 1));
    for (let c = 0; c < C; c++) {
      const base = c * (K + 1);
      for (let k = 0; k < K; k++) this.scanCum[base + k + 1] = this.scanCum[base + k] + this.scan[k * C + c];
    }
    this.win = new Uint8Array(K * C);
    for (let c = 0; c < C; c++) {
      const next = nextTrue(K, (k) => this.vis[k * C + c] === 1);
      for (let k = 0; k < K; k++) if (next[k] <= this.N) this.win[k * C + c] = 1;
    }
    // static baseline: uniform phase, the sight window plus a pulse at a uniform offset with the steady-state chance
    // that one falls into a window of H (H / (scan interval + warning))
    const qs = Math.min(1, horizonS / (cfg.scanEveryS + cfg.scanWarnS));
    this.staticP = new Float64Array(C);
    for (let c = 0; c < C; c++) {
      let acc = 0;
      for (let k = 0; k < K; k++) {
        if (this.win[k * C + c]) {
          acc += 1;
          continue;
        }
        let s = 0;
        for (let u = 0; u <= this.N; u++) s += this.scan[wrapIndex(k + u, K) * C + c];
        acc += qs * (s / (this.N + 1));
      }
      this.staticP[c] = acc / K;
    }
  }

  /**
   * The same tables with another run's geometry (the cached tables are shared across runs of the same case and open-wall
   * state; live line-of-sight queries must use THIS run's world).
   */
  bind(geo: RiskGeometry): CrackstoneRiskModel {
    const m = Object.create(CrackstoneRiskModel.prototype) as CrackstoneRiskModel;
    return Object.assign(m, this, { geo });
  }

  /** Number of phases in φ … φ + len − 1 (circular) from which a pulse covers cell c. */
  scanCount(c: number, phi: number, len: number): number {
    const K = this.K;
    const base = c * (K + 1);
    let total = 0;
    let start = wrapIndex(phi, K);
    let left = len;
    while (left > 0) {
      const take = Math.min(left, K - start);
      total += this.scanCum[base + start + take] - this.scanCum[base + start];
      left -= take;
      start = 0;
    }
    return total;
  }

  /** His sight / proximity rule from a phase state against a target (both sweep directions during a pause). */
  seesFrom(s: { x: number; z: number; yaw: number; sweep: number; fog: boolean }, t: RiskTarget, sight = this.cfg.sight): boolean {
    const world = this.geo.world;
    const d = Math.hypot(t.x - s.x, t.z - s.z);
    if (!t.hidden && d <= this.cfg.proximityM && world.lineOfSight(s.x, s.z, t.x, t.z, false)) return true;
    const yaws = s.sweep > 0 ? [s.yaw + s.sweep, s.yaw - s.sweep, s.yaw] : [s.yaw];
    const target = { x: t.x, z: t.z, crouched: t.crouched, hiddenRevealM: t.hidden ? (t.revealM ?? 0) : null };
    for (const yaw of yaws) {
      const r = canSee(world, sight, { x: s.x, z: s.z, yaw }, target, { fog: s.fog || t.fog, distracted: false });
      if (r.seen) return true;
      if (r.blockedBy === 'range' || r.blockedBy === 'wall' || r.blockedBy === 'low_cover' || r.blockedBy === 'hidden') return false; // yaw-independent
    }
    return false;
  }

  /** The scan pulse hit test (radius, walls + high cover; crouching does not help; hiding does). */
  scanCovers(s: Vec2, t: RiskTarget): boolean {
    if (t.hidden) return false;
    if (Math.hypot(t.x - s.x, t.z - s.z) > this.cfg.scanRadiusM) return false;
    return this.geo.world.lineOfSight(s.x, s.z, t.x, t.z, false);
  }

  /** All-around sight from a point (search look-around): range (fog) + line of sight, or proximity. */
  sees360(s: Vec2 & { fog?: boolean }, t: RiskTarget): boolean {
    const fog = (s.fog ?? this.geo.inFog(s.x, s.z)) || t.fog;
    const d = Math.hypot(t.x - s.x, t.z - s.z);
    const world = this.geo.world;
    if (!t.hidden && d <= this.cfg.proximityM) return world.lineOfSight(s.x, s.z, t.x, t.z, false);
    const sight = this.cfg.sight;
    const range = (fog ? sight.fogRangeM : sight.rangeM) * (t.crouched ? sight.crouchRangeMult : 1);
    if (d > range) return false;
    if (t.hidden && d > (t.revealM ?? 0)) return false;
    if (!world.lineOfSight(s.x, s.z, t.x, t.z, false)) return false;
    if (t.crouched && !world.lineOfSight(s.x, s.z, t.x, t.z, true)) return false;
    return true;
  }

  /** Index of the cell containing (x, z), or −1. */
  cellAt(x: number, z: number): number {
    const h = this.cellM / 2;
    for (let c = 0; c < this.C; c++) {
      const cell = this.cells[c];
      if (Math.abs(x - cell.x) <= h && Math.abs(z - cell.z) <= h) return c;
    }
    return -1;
  }

  /** Walkable search spots on his grid within searchRadiusM of a (leash-clamped) focus. */
  searchSpots(focus: Vec2): (Vec2 & { fog: boolean })[] {
    const center = clampToDisc(focus, this.centroid, this.def.leashM);
    const r = this.cfg.searchRadiusM;
    const g = CRACK_BELIEF.searchGridM;
    const out: (Vec2 & { fog: boolean })[] = [];
    for (let dx = -r; dx <= r + 1e-9; dx += g) {
      for (let dz = -r; dz <= r + 1e-9; dz += g) {
        if (Math.hypot(dx, dz) > r) continue;
        const x = center.x + dx;
        const z = center.z + dz;
        if (!this.geo.nav.walkable(x, z)) continue;
        if (Math.hypot(x - this.centroid.x, z - this.centroid.z) > this.def.leashM + 1) continue;
        out.push({ x, z, fog: this.geo.inFog(x, z) });
      }
    }
    if (out.length === 0) {
      const snapped = this.geo.nav.nearestWalkable(center, 6) ?? center;
      out.push({ x: snapped.x, z: snapped.z, fog: this.geo.inFog(snapped.x, snapped.z) });
    }
    return out;
  }

  targetAt(x: number, z: number, crouched: boolean, hidden: boolean): RiskTarget {
    let revealM: number | null = null;
    if (hidden) for (const s of this.geo.hidingSpots) if (Math.hypot(s.x - x, s.z - z) <= s.radius) revealM = s.revealM;
    return { x, z, crouched, hidden, fog: this.geo.inFog(x, z), revealM };
  }
}

/** Steps (0 … K) until `pred` is next true going forward from each index (circular); K + 1 if never. */
function nextTrue(K: number, pred: (k: number) => boolean): Int32Array {
  const out = new Int32Array(K).fill(K + 1);
  let first = -1;
  for (let k = 0; k < K; k++) if (pred(k)) {
    first = k;
    break;
  }
  if (first < 0) return out;
  let dist = 0;
  for (let i = 0; i < K; i++) {
    const k = wrapIndex(first - i, K);
    if (pred(k)) dist = 0;
    else dist++;
    out[k] = dist;
  }
  return out;
}

/** The patrol loop as a timeline: walking legs (nav paths between waypoints) + a look-around pause at each waypoint. */
function buildTimeline(def: CrackstoneDef, cfg: CrackstoneTuning, geo: RiskGeometry, dt: number): { states: PhaseState[]; arrival: number[] } {
  const pts = def.patrol;
  const n = pts.length;
  type Leg = { kind: 'walk'; a: Vec2; b: Vec2; dur: number; waypoint: number } | { kind: 'pause'; at: Vec2; yaw: number; dur: number; waypoint: number };
  const legs: Leg[] = [];
  const speed = Math.max(0.1, cfg.speed.PATROL);
  let yaw = def.start.yaw;
  // loop starts at the arrival at waypoint 0
  for (let i = 0; i < n; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % n];
    // arrival heading at a = direction of the leg into a
    const prev = pts[(i - 1 + n) % n];
    yaw = headingOf(prev, a, yaw);
    legs.push({ kind: 'pause', at: a, yaw, dur: cfg.patrolPauseS, waypoint: i });
    const path = geo.nav.findPath(a, b);
    const poly: Vec2[] = [a, ...(path && path.length ? path : [b])];
    for (let j = 1; j < poly.length; j++) {
      const len = Math.hypot(poly[j].x - poly[j - 1].x, poly[j].z - poly[j - 1].z);
      if (len < 1e-6) continue;
      legs.push({ kind: 'walk', a: poly[j - 1], b: poly[j], dur: len / speed, waypoint: (i + 1) % n });
    }
  }
  const total = legs.reduce((s, l) => s + l.dur, 0);
  const K = Math.max(1, Math.round(total / dt));
  const states: PhaseState[] = [];
  const arrival = new Array<number>(n).fill(0);
  let legIdx = 0;
  let legStart = 0;
  for (let k = 0; k < K; k++) {
    const t = k * dt;
    while (legIdx < legs.length - 1 && t >= legStart + legs[legIdx].dur) {
      legStart += legs[legIdx].dur;
      legIdx++;
      const l = legs[legIdx];
      if (l.kind === 'pause') arrival[l.waypoint] = k;
    }
    const l = legs[legIdx];
    const tau = Math.max(0, t - legStart);
    if (l.kind === 'pause') {
      states.push({ x: l.at.x, z: l.at.z, yaw: l.yaw, sweep: Math.min(Math.PI, cfg.lookAroundRadPerS * tau), fog: geo.inFog(l.at.x, l.at.z), waypoint: l.waypoint });
    } else {
      const f = l.dur > 0 ? Math.min(1, tau / l.dur) : 1;
      const x = l.a.x + (l.b.x - l.a.x) * f;
      const z = l.a.z + (l.b.z - l.a.z) * f;
      states.push({ x, z, yaw: headingOf(l.a, l.b, 0), sweep: 0, fog: geo.inFog(x, z), waypoint: l.waypoint });
    }
  }
  return { states, arrival };
}

/** 4 m cells (global grid aligned to multiples of cellM) whose centre lies in the leash disc and a player can stand in. */
function buildCells(def: CrackstoneDef, centroid: Vec2, geo: RiskGeometry, cellM: number): RiskCell[] {
  const L = def.leashM;
  const out: RiskCell[] = [];
  const x0 = Math.floor((centroid.x - L) / cellM) * cellM;
  const z0 = Math.floor((centroid.z - L) / cellM) * cellM;
  for (let x = x0; x <= centroid.x + L; x += cellM) {
    for (let z = z0; z <= centroid.z + L; z += cellM) {
      const cx = x + cellM / 2;
      const cz = z + cellM / 2;
      if (Math.hypot(cx - centroid.x, cz - centroid.z) > L) continue;
      let px = cx;
      let pz = cz;
      if (!geo.playerNav.walkable(cx, cz)) {
        const q = geo.playerNav.nearestWalkable({ x: cx, z: cz }, cellM / 2);
        if (!q || Math.abs(q.x - cx) > cellM / 2 || Math.abs(q.z - cz) > cellM / 2) continue;
        px = q.x;
        pz = q.z;
      }
      out.push({ x: cx, z: cz, px, pz, fog: geo.inFog(px, pz), inArea: pointInPolygon(cx, cz, def.polygon) });
    }
  }
  return out;
}

// ----------------------------------------------------------------------------------------------------- tracker

export interface CrackSample {
  t: number;
  active: boolean;
  mode: CrackstoneMode;
  /** R4 pose (publicState.crackstonePose), else null. */
  pose: { x: number; z: number; yaw: number } | null;
  canSeePlayer: boolean;
  player: { x: number; z: number; crouched: boolean; hidden: boolean };
  hydeChasing: boolean;
  /** Remaining seconds of the player's own stun / lure on him. */
  perceptionOffS: number;
  /** Public telegraph: a scan warning in progress (pulse time). */
  scanWarning: { pulseAt: number } | null;
}

export interface CrackForecastOut {
  /** p per model cell (model.cells order). */
  cells: Float64Array;
  here: number;
  /** What `cells` was computed from (for tests / the report). */
  basis: 'patrol' | 'search' | 'chase' | 'inactive';
}

/** Per-session belief + public scan schedule + search focus. Pure (no run access): fed by the live engine / scripts. */
export class CrackstoneTracker {
  pi: Float64Array;
  model: CrackstoneRiskModel;
  private lastT: number | null = null;
  private warnStart: number | null = null;
  private pulseAt: number | null = null;
  private nextLo: number;
  private nextHi: number;
  private graceEnd = -Infinity;
  /** Where he searches / investigates (leash-clamped). */
  focus: Vec2 | null = null;
  private focusKey = '';
  private spots: (Vec2 & { fog: boolean })[] = [];
  private spotVis: Float64Array | null = null;
  private spotScan: Float64Array | null = null;
  /** The player's position the last time he could see them (HUD "SEES YOU"), and his last public pose. */
  lastSeenPlayer: Vec2 | null = null;
  lastPose: { x: number; z: number; yaw: number } | null = null;
  private returnWaypoint: number | null = null;
  /** Belief basis for diagnostics / tests. */
  observations = 0;

  constructor(model: CrackstoneRiskModel, startT = 0) {
    this.model = model;
    this.pi = new Float64Array(model.K).fill(1 / model.K);
    const cfg = model.cfg;
    this.nextLo = startT + Math.max(cfg.scanWarnS + 1, cfg.scanEveryS - cfg.scanJitterS);
    this.nextHi = startT + Math.max(cfg.scanWarnS + 1, cfg.scanEveryS + cfg.scanJitterS);
  }

  /** Swap the tables (a wall opened): the belief is kept when the loop timeline has the same length, else reset. */
  setModel(model: CrackstoneRiskModel): void {
    if (model === this.model) return;
    const keep = model.K === this.model.K;
    this.model = model;
    if (!keep) this.pi = new Float64Array(model.K).fill(1 / model.K);
    if (this.focus) {
      const f = this.focus;
      this.focusKey = '';
      this.setFocus(f);
    }
  }

  /** Per frame: the R4 pose (if allowed) and whether he sees the player. */
  notePublic(pose: CrackSample['pose'], canSeePlayer: boolean, player: Vec2): void {
    if (pose) this.lastPose = { ...pose };
    if (canSeePlayer) this.lastSeenPlayer = { x: player.x, z: player.z };
  }

  /** A crackstone_mode event (public: the HUD shows his mode). */
  onMode(t: number, from: CrackstoneMode, to: CrackstoneMode, reason: string, ctx: { player: Vec2; lurePoint: Vec2 | null }): void {
    const engaged = (m: CrackstoneMode) => m === 'CHASE' || m === 'ATTACK';
    if (engaged(from) && !engaged(to)) this.graceEnd = t + this.model.cfg.scanGraceAfterChaseS;
    if (engaged(to) && this.warnStart !== null) this.cancelWarning(t); // a chase start drops a pending warning
    const lastKnown = this.lastSeenPlayer ?? ctx.player;
    if (to === 'INVESTIGATE') {
      this.setFocus(reason === 'lured' && ctx.lurePoint ? ctx.lurePoint : lastKnown);
    } else if (to === 'SEARCH') {
      if (from === 'INVESTIGATE' && this.focus) {
        // he searches around the point he went to
      } else if (reason === 'stunned') this.setFocus(ctx.player);
      else if (reason === 'reached_target' && ctx.lurePoint) this.setFocus(ctx.lurePoint);
      else this.setFocus(lastKnown);
    } else if (to === 'RETURN') {
      const from0 = this.focus ?? this.lastPose ?? lastKnown;
      const i = this.nearestWaypoint(from0);
      const wp = this.model.def.patrol[i];
      const travel = Math.hypot(wp.x - from0.x, wp.z - from0.z) / Math.max(0.1, this.model.cfg.speed.RETURN);
      this.returnWaypoint = i;
      this.restartAt(this.model.arrival[i] - travel / this.model.stepS, CRACK_BELIEF.returnSigma);
    } else if (to === 'PATROL' && reason === 'returned' && this.returnWaypoint !== null) {
      this.restartAt(this.model.arrival[this.returnWaypoint], CRACK_BELIEF.returnedSigma);
      this.returnWaypoint = null;
    }
  }

  /** A crackstone_scan event (public telegraph, R9). */
  onScan(t: number, phase: 'warning' | 'pulse'): void {
    const cfg = this.model.cfg;
    if (phase === 'warning') {
      this.warnStart = t;
      this.pulseAt = t + cfg.scanWarnS;
    } else {
      this.warnStart = null;
      this.pulseAt = null;
      this.schedule(t);
    }
  }

  private schedule(t: number): void {
    const cfg = this.model.cfg;
    this.nextLo = t + Math.max(cfg.scanWarnS + 1, cfg.scanEveryS - cfg.scanJitterS);
    this.nextHi = t + Math.max(cfg.scanWarnS + 1, cfg.scanEveryS + cfg.scanJitterS);
  }

  private cancelWarning(t: number): void {
    this.warnStart = null;
    this.pulseAt = null;
    this.schedule(t);
  }

  private nearestWaypoint(p: Vec2): number {
    const pts = this.model.def.patrol;
    let best = 0;
    let bd = Infinity;
    for (let i = 0; i < pts.length; i++) {
      const d = Math.hypot(pts[i].x - p.x, pts[i].z - p.z);
      if (d < bd) {
        bd = d;
        best = i;
      }
    }
    return best;
  }

  private restartAt(phase: number, sigma: number): void {
    const K = this.model.K;
    let sum = 0;
    for (let k = 0; k < K; k++) {
      let d = Math.abs(k - phase) % K;
      d = Math.min(d, K - d);
      this.pi[k] = Math.exp(-(d * d) / (2 * sigma * sigma)) + 1e-9;
      sum += this.pi[k];
    }
    for (let k = 0; k < K; k++) this.pi[k] /= sum;
  }

  private setFocus(p: Vec2): void {
    const m = this.model;
    this.focus = clampToDisc(p, m.centroid, m.def.leashM);
    const key = `${this.focus.x.toFixed(1)},${this.focus.z.toFixed(1)}`;
    if (key === this.focusKey) return;
    this.focusKey = key;
    this.spots = m.searchSpots(this.focus);
    this.spotVis = new Float64Array(m.C);
    this.spotScan = new Float64Array(m.C);
    for (let c = 0; c < m.C; c++) {
      const cell = m.cells[c];
      const t: RiskTarget = { x: cell.px, z: cell.pz, crouched: false, hidden: false, fog: cell.fog, revealM: null };
      let v = 0;
      let s = 0;
      for (const sp of this.spots) {
        if (m.sees360(sp, t)) v++;
        if (m.scanCovers(sp, t)) s++;
      }
      this.spotVis[c] = (CRACK_BELIEF.lookCover * v) / this.spots.length;
      this.spotScan[c] = s / this.spots.length;
    }
  }

  /** 1 Hz: advance the phase belief to s.t and apply the public observation. */
  sample(s: CrackSample): void {
    const m = this.model;
    const K = m.K;
    if (this.pulseAt !== null && s.t > this.pulseAt + 0.35 && !s.scanWarning) this.cancelWarning(this.pulseAt); // cancelled silently
    if (s.scanWarning && this.pulseAt === null) {
      this.pulseAt = s.scanWarning.pulseAt;
      this.warnStart = s.scanWarning.pulseAt - m.cfg.scanWarnS;
    }
    const t0 = this.lastT ?? s.t;
    const dt = Math.max(0, s.t - t0);
    this.lastT = s.t;
    if (dt > 0) {
      // frozen while a scan warning holds him still, or while he is stunned
      let frozen = 0;
      if (this.warnStart !== null && this.pulseAt !== null) frozen += Math.max(0, Math.min(s.t, this.pulseAt) - Math.max(t0, this.warnStart));
      const n = Math.max(0, (dt - frozen) / m.stepS);
      this.shift(n);
      const rho = 1 - Math.exp(-dt / (CRACK_BELIEF.relaxLoops * m.periodS));
      for (let k = 0; k < K; k++) this.pi[k] = (1 - rho) * this.pi[k] + rho / K;
    }
    if (!s.active) return;
    if (s.mode !== 'PATROL' && s.mode !== 'RETURN') return;
    if (s.pose) {
      const pose = s.pose;
      let minD = Infinity;
      const L = new Float64Array(K);
      const sg = CRACK_BELIEF.sightSigmaM;
      for (let k = 0; k < K; k++) {
        const st = m.states[k];
        const d = Math.hypot(st.x - pose.x, st.z - pose.z);
        if (d < minD) minD = d;
        // his facing is public with his position (minimap cone): a walking phase must face the same way
        const head = st.sweep > 0 ? 1 : 0.02 + ((1 + Math.cos(st.yaw - pose.yaw)) / 2) ** 4;
        L[k] = Math.exp(-(d * d) / (2 * sg * sg)) * head + 1e-12;
      }
      if (minD > CRACK_BELIEF.offLoopM) {
        // off his loop (walking back): restart at the waypoint he returns to
        const i = this.nearestWaypoint(pose);
        const wp = m.def.patrol[i];
        const travel = Math.hypot(wp.x - pose.x, wp.z - pose.z) / Math.max(0.1, m.cfg.speed.RETURN);
        this.restartAt(m.arrival[i] - travel / m.stepS, CRACK_BELIEF.returnSigma);
      } else this.update(L);
      this.observations++;
      return;
    }
    // negative evidence: phases from which the player would see him (LOS within playerSeesM) are unlikely
    const L = new Float64Array(K).fill(1);
    const pr = m.geo.playerSeesM;
    let any = false;
    for (let k = 0; k < K; k++) {
      const st = m.states[k];
      if (Math.hypot(st.x - s.player.x, st.z - s.player.z) > pr) continue;
      if (m.geo.world.lineOfSight(s.player.x, s.player.z, st.x, st.z)) {
        L[k] = CRACK_BELIEF.unseenLikelihood;
        any = true;
      }
    }
    if (any) this.update(L);
  }

  private update(L: Float64Array): void {
    const K = this.model.K;
    let sum = 0;
    for (let k = 0; k < K; k++) sum += this.pi[k] * L[k];
    if (!(sum > 1e-300)) {
      sum = 0;
      for (let k = 0; k < K; k++) sum += L[k];
      for (let k = 0; k < K; k++) this.pi[k] = L[k] / sum;
      return;
    }
    for (let k = 0; k < K; k++) this.pi[k] = (this.pi[k] * L[k]) / sum;
  }

  /** Advance the belief by n states with a small triangular spread (pace / pause variations). */
  private shift(n: number): void {
    if (n <= 0) return;
    const K = this.model.K;
    const lo = Math.floor(n) - 1;
    const hi = Math.ceil(n) + 1;
    const w: number[] = [];
    let ws = 0;
    for (let o = lo; o <= hi; o++) {
      const v = Math.max(0, 1.5 - Math.abs(o - n));
      w.push(v);
      ws += v;
    }
    const out = new Float64Array(K);
    for (let k = 0; k < K; k++) {
      const p = this.pi[k];
      if (p < 1e-15) continue;
      for (let j = 0; j < w.length; j++) out[wrapIndex(k + lo + j, K)] += (p * w[j]) / ws;
    }
    this.pi = out;
  }

  /**
   * Distribution of the next pulse inside the window: {k = phase offset (states) of the warning start, w = probability}.
   * The phase is frozen during the warning, so the pulse position is the warning-start position.
   */
  scanOffsets(s: CrackSample): { k: number; w: number }[] {
    const m = this.model;
    const cfg = m.cfg;
    const H = m.horizonS;
    if (!s.active || s.hydeChasing || s.mode === 'CHASE' || s.mode === 'ATTACK') return [];
    if (s.scanWarning || (this.pulseAt !== null && this.pulseAt >= s.t)) {
      const pulse = s.scanWarning?.pulseAt ?? this.pulseAt!;
      return pulse - s.t <= H ? [{ k: 0, w: 1 }] : [];
    }
    const lo = Math.max(this.nextLo, s.t, this.graceEnd);
    const hi = Math.max(this.nextHi, lo + m.stepS);
    const out: { k: number; w: number }[] = [];
    const span = hi - lo;
    const bins = Math.max(1, Math.ceil(span / m.stepS));
    for (let j = 0; j < bins; j++) {
      const w0 = lo + (j + 0.5) * (span / bins);
      if (w0 + cfg.scanWarnS > s.t + H) break;
      out.push({ k: Math.max(0, Math.round((w0 - s.t) / m.stepS)), w: 1 / bins });
    }
    return out;
  }

  /** The forecast for every cell and the player's own spot (exact position, current stance). */
  forecast(s: CrackSample): CrackForecastOut {
    const m = this.model;
    const C = m.C;
    const K = m.K;
    const cells = new Float64Array(C);
    const target = m.targetAt(s.player.x, s.player.z, s.player.crouched, s.player.hidden);
    if (!s.active) return { cells, here: 0, basis: 'inactive' };
    const offFactor = Math.max(0, m.horizonS - s.perceptionOffS) / m.horizonS;
    const scans = this.scanOffsets(s);
    const qScan = scans.reduce((a, b) => a + b.w, 0);
    let here = 0;
    let basis: CrackForecastOut['basis'];
    if ((s.mode === 'CHASE' || s.mode === 'ATTACK') && s.pose) {
      basis = 'chase';
      // he faces the player he hunts: his cone toward them now; elsewhere the search he starts if he loses them
      const yaw = Math.atan2(-(s.player.x - s.pose.x), -(s.player.z - s.pose.z));
      const pos = { x: s.pose.x, z: s.pose.z, yaw, sweep: 0, fog: m.geo.inFog(s.pose.x, s.pose.z) };
      if (this.focusKeyFor(this.lastSeenPlayer ?? s.player) !== this.focusKey) this.setFocus(this.lastSeenPlayer ?? s.player);
      for (let c = 0; c < C; c++) {
        const cell = m.cells[c];
        const t: RiskTarget = { x: cell.px, z: cell.pz, crouched: false, hidden: false, fog: cell.fog, revealM: null };
        cells[c] = m.seesFrom(pos, t) ? 1 : this.searchP(c, qScan);
      }
      here = 1;
    } else if ((s.mode === 'SEARCH' || s.mode === 'INVESTIGATE') && (this.focus || this.lastSeenPlayer)) {
      basis = 'search';
      if (!this.focus) this.setFocus(this.lastSeenPlayer!);
      for (let c = 0; c < C; c++) cells[c] = this.searchP(c, qScan);
      // the player's own spot: all-around looks from the search spots with the player's stance
      let v = 0;
      let sc = 0;
      for (const sp of this.spots) {
        if (m.sees360(sp, target)) v++;
        if (m.scanCovers(sp, target)) sc++;
      }
      const f = (CRACK_BELIEF.lookCover * v) / this.spots.length;
      const g = sc / this.spots.length;
      here = 1 - (1 - f) ** CRACK_BELIEF.searchLooks * (1 - qScan * g);
    } else {
      basis = 'patrol';
      const pi = this.pi;
      // many pulse offsets (a jittered schedule): one uniform weight over their contiguous range, summed in O(1)
      let kMin = Infinity;
      let kMax = -Infinity;
      for (const o of scans) {
        kMin = Math.min(kMin, o.k);
        kMax = Math.max(kMax, o.k);
      }
      const ranged = scans.length > 4;
      const span = ranged ? kMax - kMin + 1 : 0;
      const wEach = ranged ? qScan / span : 0;
      for (let k = 0; k < K; k++) {
        const pk = pi[k];
        if (pk < 1e-6) continue;
        const row = k * C;
        for (let c = 0; c < C; c++) {
          if (m.win[row + c]) {
            cells[c] += pk;
            continue;
          }
          if (scans.length === 0) continue;
          let q = 0;
          if (ranged) q = wEach * m.scanCount(c, k + kMin, span);
          else for (const o of scans) q += o.w * m.scan[wrapIndex(k + o.k, K) * C + c];
          cells[c] += pk * q;
        }
      }
      // here: the player's exact spot and stance against every phase
      const visH = new Uint8Array(K);
      const scanH = new Uint8Array(K);
      for (let k = 0; k < K; k++) {
        const st = m.states[k];
        if (Math.hypot(st.x - target.x, st.z - target.z) > Math.max(m.cfg.sight.rangeM, m.cfg.scanRadiusM, m.cfg.proximityM) + 0.5) continue;
        if (m.seesFrom(st, target)) visH[k] = 1;
        if (m.scanCovers(st, target)) scanH[k] = 1;
      }
      const next = nextTrue(K, (k) => visH[k] === 1);
      for (let k = 0; k < K; k++) {
        const pk = pi[k];
        if (pk < 1e-6) continue;
        if (next[k] <= m.N) {
          here += pk;
          continue;
        }
        let q = 0;
        for (const o of scans) q += o.w * scanH[wrapIndex(k + o.k, K)];
        here += pk * q;
      }
    }
    for (let c = 0; c < C; c++) cells[c] = Math.min(1, Math.max(0, cells[c] * (basis === 'chase' && cells[c] >= 1 ? 1 : offFactor)));
    if (basis !== 'chase') here *= offFactor;
    if (s.canSeePlayer) here = 1;
    return { cells, here: Math.min(1, Math.max(0, here)), basis };
  }

  private focusKeyFor(p: Vec2): string {
    const f = clampToDisc(p, this.model.centroid, this.model.def.leashM);
    return `${f.x.toFixed(1)},${f.z.toFixed(1)}`;
  }

  private searchP(c: number, qScan: number): number {
    const f = this.spotVis?.[c] ?? 0;
    const g = this.spotScan?.[c] ?? 0;
    return 1 - (1 - f) ** CRACK_BELIEF.searchLooks * (1 - qScan * g);
  }
}

// ----------------------------------------------------------------------------------------------------- cache

const CACHE = new Map<string, CrackstoneRiskModel>();

/** The (lazily built, cached) tables of one case map; `key` must change when walls open (world.openKey()). */
export function crackstoneRiskModel(key: string, build: () => CrackstoneRiskModel): CrackstoneRiskModel {
  const hit = CACHE.get(key);
  if (hit) return hit;
  const m = build();
  if (CACHE.size > 24) CACHE.clear();
  // cache a DETACHED copy: the builder's geometry closes over one MysteryRun, which must not outlive its session
  CACHE.set(key, m.bind(DETACHED_GEO));
  return m;
}

/** Placeholder geometry of cached tables; every caller binds its own run's geometry before use. */
const DETACHED_GEO = new Proxy({}, {
  get() {
    throw new Error('CrackstoneRiskModel: call bind(geo) with the geometry of the current run before use');
  },
}) as RiskGeometry;
