// Shared helpers for action tests: inputs, small inline courses, run drivers, and a grid-planning autopilot that
// rows a fixed cadence and steers (pure pursuit) along an A* path through a route's waypoints around land and
// obstacles.
import { findContacts, obstaclePosition } from '../../../src/action/collision.ts';
import { circleHitsLand } from '../../../src/action/land.ts';
import { createBoatState } from '../../../src/action/rowing.ts';
import { StageOneRun } from '../../../src/action/run.ts';
import type { CharacterId, PokemonId } from '../../../src/game/types.ts';
import type { ActionEvent, CourseDef, EncounterTrigger, InputSnapshot, Obstacle, Vec2 } from '../../../src/action/types.ts';

export const FPS = 60;
export const DT = 1 / FPS;
export const NO_KEYS = { forward: false, left: false, right: false, brake: false };
export const idle = (over: Partial<InputSnapshot> = {}): InputSnapshot => ({ ...NO_KEYS, interact: false, ability: false, strokes: 0, holdRow: false, ...over });

/** Straight open water heading −Z from (0, 0) with the dock far away; no obstacles, currents, fog or triggers. */
export function openCourse(over: Partial<CourseDef> = {}): CourseDef {
  return {
    id: 'open', name: 'Open water',
    start: { x: 0, z: 0, heading: 0 },
    finish: { x: 0, z: -5000, radius: 6 },
    bounds: { minX: -2000, maxX: 2000, minZ: -6000, maxZ: 400 },
    obstacles: [], currents: [], fog: [],
    ...over,
  };
}

/** Open water whose encounter triggers wake + reveal the Hyde at the start (he is chasing ~1.5 s in). */
export function chaseCourse(over: Partial<CourseDef> = {}): CourseDef {
  const encounters: EncounterTrigger[] = [
    { id: 'calm', kind: 'calm', x: 0, z: 0, radius: 3 },
    { id: 'dist', kind: 'disturbance', x: 0, z: -1, radius: 4 },
    { id: 'emerge', kind: 'hyde_emerge', x: 0, z: -2, radius: 5 },
  ];
  return openCourse({ id: 'chase', encounters, ...over });
}

export function newRun(characterId: CharacterId, pokemonId: PokemonId, course?: CourseDef): StageOneRun {
  return new StageOneRun({ characterId, pokemonId, course });
}

/** Taps at `rate` per second: returns the number of strokes to send for a frame ending at time `t`. */
export class Metronome {
  private next = 0;
  constructor(public rate: number) {}
  strokes(t: number): number {
    let n = 0;
    while (this.rate > 0 && this.next <= t) {
      n++;
      this.next += 1 / this.rate;
    }
    return n;
  }
}

/** Runs `seconds` of frames with a per-frame input function; collects events. */
export function drive(run: StageOneRun, seconds: number, inputAt: (frameIndex: number, realT: number) => InputSnapshot = () => idle(), fps = FPS): ActionEvent[] {
  const out: ActionEvent[] = [];
  const dt = 1 / fps;
  const frames = Math.round(seconds * fps);
  for (let i = 0; i < frames; i++) out.push(...run.update(dt, inputAt(i, (i + 1) * dt)));
  return out;
}

/** A rowing input source at a fixed cadence (real time) with optional held keys. */
export function rower(rate: number, keys: Partial<InputSnapshot> = {}): () => InputSnapshot {
  const m = new Metronome(rate);
  let real = 0;
  return () => {
    real += DT;
    return idle({ ...keys, strokes: m.strokes(real) });
  };
}

/** Drives frames until `pred` holds (checked after each frame) or `maxS` real seconds pass. */
export function driveUntil(run: StageOneRun, pred: (ev: ActionEvent[]) => boolean, maxS: number, input: () => InputSnapshot = () => idle()): ActionEvent[] {
  const out: ActionEvent[] = [];
  for (let i = 0; i < maxS * FPS; i++) {
    const ev = run.update(DT, input());
    out.push(...ev);
    if (pred(ev)) break;
  }
  return out;
}

/** On a chaseCourse(): drives (rowing at `rate`) until the Hyde is chasing. */
export function startChase(run: StageOneRun, rate = 0): ActionEvent[] {
  const ev = driveUntil(run, () => run.hyde.phase === 'chasing', 10, rower(rate));
  if (run.hyde.phase !== 'chasing') throw new Error(`hyde did not start chasing (${run.hyde.phase})`);
  return ev;
}

/** Idles until the Hyde catches (status 'rescue'). */
export function idleUntilCatch(run: StageOneRun, maxS = 180): ActionEvent[] {
  const ev = driveUntil(run, () => run.status === 'rescue', maxS);
  if (run.status !== 'rescue') throw new Error(`no catch within ${maxS} s (status ${run.status}, hyde ${run.hyde.phase})`);
  return ev;
}

export const ofType = <T extends ActionEvent['type']>(ev: ActionEvent[], type: T) => ev.filter((e): e is Extract<ActionEvent, { type: T }> => e.type === type);

// ------------------------------------------------------------------------------------------------ planner

function wrap(a: number): number {
  return Math.atan2(Math.sin(a), Math.cos(a));
}

function blockedBy(o: Obstacle, x: number, z: number, clearance: number): boolean {
  // sample the drift range so moving obstacles are avoided at any phase
  const samples = o.drift ? 9 : 1;
  for (let i = 0; i < samples; i++) {
    const t = o.drift ? (o.drift.periodS * i) / samples : 0;
    const p = obstaclePosition(o, t);
    const probe = { ...o, x: p.x, z: p.z, drift: undefined, radius: o.radius + clearance };
    const boat = createBoatState(x, z, 0, 100, 100);
    if (findContacts(boat, [probe], 0).length) return true;
  }
  return false;
}

/** Binary min-heap of grid indices keyed by f. */
class Heap {
  private items: number[] = [];
  constructor(private readonly key: Float64Array) {}
  get size(): number {
    return this.items.length;
  }
  push(i: number): void {
    const a = this.items;
    a.push(i);
    let c = a.length - 1;
    while (c > 0) {
      const p = (c - 1) >> 1;
      if (this.key[a[p]] <= this.key[a[c]]) break;
      [a[p], a[c]] = [a[c], a[p]];
      c = p;
    }
  }
  pop(): number {
    const a = this.items;
    const top = a[0];
    const last = a.pop()!;
    if (a.length) {
      a[0] = last;
      let p = 0;
      for (;;) {
        const l = 2 * p + 1;
        const r = l + 1;
        let m = p;
        if (l < a.length && this.key[a[l]] < this.key[a[m]]) m = l;
        if (r < a.length && this.key[a[r]] < this.key[a[m]]) m = r;
        if (m === p) break;
        [a[p], a[m]] = [a[m], a[p]];
        p = m;
      }
    }
    return top;
  }
}

/** Occupancy grid of a course (land + obstacles inflated by the hull clearance), with A*. */
export class NavGrid {
  readonly cols: number;
  readonly rows: number;
  readonly blocked: Uint8Array;
  private readonly minX: number;
  private readonly minZ: number;

  constructor(readonly course: CourseDef, readonly cell = 2, clearance = 1.6) {
    const { minX, maxX, minZ, maxZ } = course.bounds;
    this.minX = minX;
    this.minZ = minZ;
    this.cols = Math.ceil((maxX - minX) / cell) + 1;
    this.rows = Math.ceil((maxZ - minZ) / cell) + 1;
    const lands = course.land ?? [];
    this.blocked = new Uint8Array(this.cols * this.rows);
    const near = (o: Obstacle) => o.radius + o.halfLength + (o.drift?.amplitude ?? 0) + clearance + 3;
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        const x = minX + c * cell;
        const z = minZ + r * cell;
        let b = circleHitsLand(x, z, clearance + 0.9, lands);
        if (!b) {
          for (const o of course.obstacles) {
            if (Math.abs(o.x - x) > near(o) || Math.abs(o.z - z) > near(o)) continue;
            if (blockedBy(o, x, z, clearance - 0.75)) { b = true; break; }
          }
        }
        this.blocked[r * this.cols + c] = b ? 1 : 0;
      }
    }
  }

  idx(p: Vec2): number {
    const c = Math.max(0, Math.min(this.cols - 1, Math.round((p.x - this.minX) / this.cell)));
    const r = Math.max(0, Math.min(this.rows - 1, Math.round((p.z - this.minZ) / this.cell)));
    return r * this.cols + c;
  }

  point(i: number): Vec2 {
    return { x: this.minX + (i % this.cols) * this.cell, z: this.minZ + Math.floor(i / this.cols) * this.cell };
  }

  /** Nearest free cell to p (spiral search), so a waypoint drawn close to a shore still works. */
  free(p: Vec2): number {
    const i0 = this.idx(p);
    if (!this.blocked[i0]) return i0;
    const c0 = i0 % this.cols;
    const r0 = Math.floor(i0 / this.cols);
    for (let rad = 1; rad < 40; rad++) {
      let best = -1;
      let bestD = Infinity;
      for (let dr = -rad; dr <= rad; dr++) {
        for (let dc = -rad; dc <= rad; dc++) {
          if (Math.max(Math.abs(dr), Math.abs(dc)) !== rad) continue;
          const r = r0 + dr;
          const c = c0 + dc;
          if (r < 0 || c < 0 || r >= this.rows || c >= this.cols) continue;
          const i = r * this.cols + c;
          const d = dr * dr + dc * dc;
          if (!this.blocked[i] && d < bestD) { best = i; bestD = d; }
        }
      }
      if (best >= 0) return best;
    }
    throw new Error(`no free cell near (${p.x}, ${p.z})`);
  }

  /** 8-neighbour A* (no corner cutting) between two world points; returns world waypoints. */
  astar(from: Vec2, to: Vec2): Vec2[] {
    const n = this.cols * this.rows;
    const start = this.free(from);
    const goal = this.free(to);
    const g = new Float64Array(n).fill(Infinity);
    const f = new Float64Array(n).fill(Infinity);
    const prev = new Int32Array(n).fill(-1);
    const closed = new Uint8Array(n);
    const gx = goal % this.cols;
    const gz = Math.floor(goal / this.cols);
    const h = (i: number) => Math.hypot((i % this.cols) - gx, Math.floor(i / this.cols) - gz);
    const open = new Heap(f);
    g[start] = 0;
    f[start] = h(start);
    open.push(start);
    while (open.size) {
      const cur = open.pop();
      if (cur === goal) break;
      if (closed[cur]) continue;
      closed[cur] = 1;
      const cx = cur % this.cols;
      const cz = Math.floor(cur / this.cols);
      for (let dz = -1; dz <= 1; dz++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dz) continue;
          const nx = cx + dx;
          const nz = cz + dz;
          if (nx < 0 || nz < 0 || nx >= this.cols || nz >= this.rows) continue;
          const nb = nz * this.cols + nx;
          if (this.blocked[nb] || closed[nb]) continue;
          if (dx && dz && (this.blocked[cz * this.cols + nx] || this.blocked[nz * this.cols + cx])) continue;
          const ng = g[cur] + (dx && dz ? Math.SQRT2 : 1);
          if (ng < g[nb]) {
            g[nb] = ng;
            prev[nb] = cur;
            f[nb] = ng + h(nb);
            open.push(nb);
          }
        }
      }
    }
    if (goal !== start && prev[goal] < 0) throw new Error(`autopilot: no path from (${from.x}, ${from.z}) to (${to.x}, ${to.z})`);
    const path: Vec2[] = [];
    for (let i = goal; i >= 0; i = prev[i]) path.push(this.point(i));
    return path.reverse();
  }

  /** A* through every waypoint in order, start → waypoints → dock. */
  route(waypoints: Vec2[]): Vec2[] {
    const stops = [{ x: this.course.start.x, z: this.course.start.z }, ...waypoints, { x: this.course.finish.x, z: this.course.finish.z }];
    const out: Vec2[] = [];
    for (let i = 0; i + 1 < stops.length; i++) {
      const leg = this.astar(stops[i], stops[i + 1]);
      out.push(...(out.length ? leg.slice(1) : leg));
    }
    return out;
  }
}

const gridCache = new WeakMap<CourseDef, NavGrid>();
export function navGrid(course: CourseDef): NavGrid {
  let g = gridCache.get(course);
  if (!g) gridCache.set(course, (g = new NavGrid(course)));
  return g;
}

/** A* path start → dock (no waypoints). */
export function planPath(course: CourseDef): Vec2[] {
  return navGrid(course).route([]);
}

/** Named autopilot routes for a course: its lantern routes when present, else the direct line to the dock. */
export function coursePaths(course: CourseDef): { id: string; risk: 'safe' | 'risky' | 'direct'; path: Vec2[] }[] {
  const grid = navGrid(course);
  if (course.routes?.length) return course.routes.map((r) => ({ id: r.id, risk: r.risk, path: grid.route(r.points) }));
  return [{ id: 'direct', risk: 'direct', path: grid.route([]) }];
}

export interface AutopilotOptions {
  tapsPerS: number;
  useQInRescue?: boolean;
  lookaheadU?: number;
  path?: Vec2[];
  /** Return false to stop rowing (and steering) at this run time — e.g. a player who gives up mid-course. */
  rowingAt?: (runT: number, run: StageOneRun) => boolean;
}

/** Rows at a fixed cadence and steers along a planned path. */
export class Autopilot {
  readonly path: Vec2[];
  private readonly metro: Metronome;
  private cursor = 0;
  private realT = 0;

  constructor(private readonly run: StageOneRun, private readonly o: AutopilotOptions) {
    this.path = o.path ?? planPath(run.course);
    this.metro = new Metronome(o.tapsPerS);
  }

  input(dt: number): InputSnapshot {
    this.realT += dt;
    const b = this.run.boat;
    const strokes = this.metro.strokes(this.realT);
    if (this.run.status === 'rescue') return idle({ ability: !!this.o.useQInRescue, strokes });
    if (this.o.rowingAt && !this.o.rowingAt(this.run.t, this.run)) return idle();
    // advance the cursor to the closest point ahead, then aim `lookahead` further along the path
    let best = this.cursor;
    let bestD = Infinity;
    for (let i = this.cursor; i < Math.min(this.path.length, this.cursor + 40); i++) {
      const d = Math.hypot(this.path[i].x - b.x, this.path[i].z - b.z);
      if (d < bestD) { bestD = d; best = i; }
    }
    this.cursor = best;
    const look = this.o.lookaheadU ?? 7;
    let target = this.path[this.path.length - 1];
    for (let i = this.cursor; i < this.path.length; i++) {
      if (Math.hypot(this.path[i].x - b.x, this.path[i].z - b.z) >= look) { target = this.path[i]; break; }
    }
    const desired = Math.atan2(-(target.x - b.x), -(target.z - b.z));
    const diff = wrap(desired - b.heading);
    const steer = Math.abs(diff) > 0.04 ? (diff > 0 ? 'left' : 'right') : null;
    return idle({ left: steer === 'left', right: steer === 'right', brake: Math.abs(diff) > 1.2 && b.speed > 5, strokes });
  }

  /** Drives until the run ends or `maxS` of real time passes. */
  drive(maxS: number, fps = FPS): ActionEvent[] {
    const out: ActionEvent[] = [];
    const dt = 1 / fps;
    for (let i = 0; i < maxS * fps; i++) {
      if (this.run.status === 'finished' || this.run.status === 'dnf') break;
      out.push(...this.run.update(dt, this.input(dt)));
    }
    return out;
  }
}

// ------------------------------------------------------------------------------------------------ crash rigs

export function rock(id: string, x: number, z: number, radius = 2, damage = 14): Obstacle {
  return { id, kind: 'rock', x, z, radius, halfLength: 0, angle: 0, damage };
}

/**
 * Places the boat 6 u in front of the obstacle at (x, z) heading straight into it (−Z) at `speed`, then coasts
 * `seconds`. Returns the events plus the speed right after the first collision frame and the impact speed.
 */
export function ram(run: StageOneRun, x: number, z = -20, speed = 9, seconds = 1): { events: ActionEvent[]; speedAfterImpact: number; impactSpeed: number; damage: number } {
  run.boat.x = x;
  run.boat.z = z + 6;
  run.boat.heading = 0;
  run.boat.speed = speed;
  run.boat.turnRate = 0;
  const events: ActionEvent[] = [];
  let speedAfterImpact = NaN;
  let impactSpeed = NaN;
  let damage = NaN;
  for (let i = 0; i < seconds * FPS; i++) {
    const ev = run.update(DT, idle());
    events.push(...ev);
    const hit = ev.find((e): e is Extract<ActionEvent, { type: 'collision' }> => e.type === 'collision');
    if (hit && Number.isNaN(speedAfterImpact)) {
      speedAfterImpact = run.boat.speed;
      impactSpeed = hit.impactSpeed;
      damage = hit.damage;
    }
  }
  return { events, speedAfterImpact, impactSpeed, damage };
}
