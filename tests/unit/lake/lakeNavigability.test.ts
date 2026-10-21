// Stage 1 open-lake layout checks (orchestrator-owned): the designer's buildLakeCourse() must be a valid, open,
// multi-route lake that a hull can actually cross. Grid BFS on 1-unit cells: a cell is free when a circle of the
// hull's half-width plus margin clears land, bounds and every obstacle at that drift time. Checked overall and
// inside a band around each route's lantern line, at several drift phases.
import { describe, expect, it } from 'vitest';
import { obstaclePosition } from '../../../src/action/collision.ts';
import { BOAT } from '../../../src/action/config.ts';
import { buildLakeCourse } from '../../../src/action/data/lake.ts';
import { circleHitsLand, closestOnOutline, pointInPolygon } from '../../../src/action/land.ts';
import type { CourseDef, Obstacle, Vec2 } from '../../../src/action/types.ts';

const course = buildLakeCourse();
const land = course.land ?? [];
const HULL_R = Math.max(...BOAT.hullCircles.map((c) => c.radius));
const CELL = 1;
const ROUTE_BAND_U = 22;

function obstacleGap(o: Obstacle, x: number, z: number, t: number): number {
  const c = obstaclePosition(o, t);
  if (o.halfLength <= 0) return Math.hypot(x - c.x, z - c.z) - o.radius;
  const ax = -Math.sin(o.angle);
  const az = -Math.cos(o.angle);
  const along = Math.max(-o.halfLength, Math.min(o.halfLength, (x - c.x) * ax + (z - c.z) * az));
  return Math.hypot(x - (c.x + ax * along), z - (c.z + az * along)) - o.radius;
}

function landGap(x: number, z: number): number {
  let best = Infinity;
  for (const l of land) {
    const d = closestOnOutline(x, z, l.points).d;
    best = Math.min(best, pointInPolygon(x, z, l.points) ? -d : d);
  }
  return best;
}

function segDist(p: Vec2, a: Vec2, b: Vec2): number {
  const ex = b.x - a.x;
  const ez = b.z - a.z;
  const len2 = ex * ex + ez * ez;
  const u = len2 > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * ex + (p.z - a.z) * ez) / len2)) : 0;
  return Math.hypot(p.x - a.x - ex * u, p.z - a.z - ez * u);
}

function polylineDist(p: Vec2, pts: Vec2[]): number {
  let d = Infinity;
  for (let i = 1; i < pts.length; i++) d = Math.min(d, segDist(p, pts[i - 1], pts[i]));
  return d;
}

function polylineLength(pts: Vec2[]): number {
  let s = 0;
  for (let i = 1; i < pts.length; i++) s += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z);
  return s;
}

function segmentsCross(a: Vec2, b: Vec2, c: Vec2, d: Vec2): boolean {
  const o = (p: Vec2, q: Vec2, r: Vec2) => Math.sign((q.x - p.x) * (r.z - p.z) - (q.z - p.z) * (r.x - p.x));
  return o(a, b, c) * o(a, b, d) < 0 && o(c, d, a) * o(c, d, b) < 0;
}

function driftTimes(c: CourseDef): number[] {
  const period = Math.max(1, ...c.obstacles.map((o) => o.drift?.periodS ?? 0));
  return Array.from({ length: 8 }, (_, i) => (period * i) / 8);
}

/** BFS from start to the dock circle; `allowed` optionally restricts the search area (route band). */
function reachable(c: CourseDef, t: number, clearance: number, allowed?: (x: number, z: number) => boolean): boolean {
  const { minX, maxX, minZ, maxZ } = c.bounds;
  const cols = Math.floor((maxX - minX) / CELL);
  const rows = Math.floor((maxZ - minZ) / CELL);
  const r = HULL_R + clearance;
  const nearby = c.obstacles; // small enough (≤ ~120) to scan per cell
  const free = (cx: number, cz: number): boolean => {
    const x = minX + cx * CELL;
    const z = minZ + cz * CELL;
    if (x - r < minX || x + r > maxX || z - r < minZ || z + r > maxZ) return false;
    if (allowed && !allowed(x, z)) return false;
    if (circleHitsLand(x, z, r, land)) return false;
    return nearby.every((o) => obstacleGap(o, x, z, t) > r);
  };
  const idx = (cx: number, cz: number) => cz * (cols + 1) + cx;
  const seen = new Uint8Array((cols + 1) * (rows + 1));
  const sx = Math.round((c.start.x - minX) / CELL);
  const sz = Math.round((c.start.z - minZ) / CELL);
  const queue: number[] = [sx, sz];
  seen[idx(sx, sz)] = 1;
  for (let head = 0; head < queue.length; head += 2) {
    const cx = queue[head];
    const cz = queue[head + 1];
    if (Math.hypot(minX + cx * CELL - c.finish.x, minZ + cz * CELL - c.finish.z) <= c.finish.radius) return true;
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = cx + dx;
      const nz = cz + dz;
      if (nx < 0 || nz < 0 || nx > cols || nz > rows || seen[idx(nx, nz)]) continue;
      seen[idx(nx, nz)] = 1;
      if (free(nx, nz)) queue.push(nx, nz);
    }
  }
  return false;
}

describe('Stage 1 open lake: layout', () => {
  it('has unique ids, sane geometry and a 450–550 u crossing', () => {
    const ids = [...course.obstacles.map((o) => o.id), ...land.map((l) => l.id)];
    expect(new Set(ids).size).toBe(ids.length);
    const straight = Math.hypot(course.start.x - course.finish.x, course.start.z - course.finish.z);
    expect(straight).toBeGreaterThanOrEqual(450);
    expect(straight).toBeLessThanOrEqual(550);
    expect(course.obstacles.length).toBeLessThanOrEqual(150);
    expect(course.obstacles.filter((o) => o.kind === 'buoy').length, 'no lane-buoy corridors').toBeLessThanOrEqual(6);
  });

  it('land polygons are simple, open (not closed) and at least triangles', () => {
    expect(land.length).toBeGreaterThanOrEqual(4);
    for (const l of land) {
      const p = l.points;
      expect(p.length, l.id).toBeGreaterThanOrEqual(3);
      expect(p[0].x === p[p.length - 1].x && p[0].z === p[p.length - 1].z, `${l.id} repeats its first point`).toBe(false);
      for (let i = 0; i < p.length; i++) {
        for (let j = i + 2; j < p.length; j++) {
          if (i === 0 && j === p.length - 1) continue; // adjacent through the closing edge
          expect(segmentsCross(p[i], p[(i + 1) % p.length], p[j], p[(j + 1) % p.length]), `${l.id} self-intersects at edges ${i}/${j}`).toBe(false);
        }
      }
    }
  });

  it('start, dock and Hyde spawn sit in open water', () => {
    expect(landGap(course.start.x, course.start.z)).toBeGreaterThanOrEqual(10);
    expect(landGap(course.finish.x, course.finish.z)).toBeGreaterThanOrEqual(course.finish.radius);
    expect(course.hydeSpawn).toBeDefined();
    const h = course.hydeSpawn!;
    expect(landGap(h.x, h.z)).toBeGreaterThan(3);
    const toFinish = (x: number, z: number) => Math.hypot(x - course.finish.x, z - course.finish.z);
    expect(toFinish(h.x, h.z), 'Hyde must not spawn closer to the dock than the start').toBeGreaterThan(toFinish(course.start.x, course.start.z) * 0.5);
  });

  it('has the required landmarks, encounters and ≥ 3 distinct routes', () => {
    const kinds = new Set((course.landmarks ?? []).map((l) => l.kind));
    for (const k of ['nevermore_academy', 'start_dock', 'raven_island', 'raven_dock'] as const) expect(kinds.has(k), k).toBe(true);
    expect(kinds.has('lighthouse') || kinds.has('wreck') || kinds.has('bell_buoy')).toBe(true);
    const enc = new Set((course.encounters ?? []).map((e) => e.kind));
    for (const k of ['calm', 'disturbance', 'hyde_emerge', 'surge', 'safe_harbour'] as const) expect(enc.has(k), k).toBe(true);

    const routes = course.routes ?? [];
    expect(routes.length).toBeGreaterThanOrEqual(3);
    // distinct: each pair is ≥ 25 u apart somewhere in the middle third of the crossing
    for (let i = 0; i < routes.length; i++) {
      for (let j = i + 1; j < routes.length; j++) {
        const a = routes[i].points;
        const sep = Math.max(...a.slice(Math.floor(a.length / 3), Math.ceil((2 * a.length) / 3) + 1).map((p) => polylineDist(p, routes[j].points)));
        expect(sep, `${routes[i].id} vs ${routes[j].id}`).toBeGreaterThanOrEqual(25);
      }
    }
  });

  it('every lantern line stays in water, clear of land and static obstacles', () => {
    for (const r of course.routes ?? []) {
      for (let i = 1; i < r.points.length; i++) {
        const a = r.points[i - 1];
        const b = r.points[i];
        const n = Math.ceil(Math.hypot(b.x - a.x, b.z - a.z));
        for (let k = 0; k <= n; k++) {
          const x = a.x + ((b.x - a.x) * k) / n;
          const z = a.z + ((b.z - a.z) * k) / n;
          expect(landGap(x, z), `${r.id} touches land near (${x.toFixed(0)}, ${z.toFixed(0)})`).toBeGreaterThanOrEqual(2);
          for (const o of course.obstacles) {
            if (o.drift) continue;
            expect(obstacleGap(o, x, z, 0), `${r.id} runs through ${o.id}`).toBeGreaterThanOrEqual(1);
          }
        }
      }
      expect(polylineLength(r.points)).toBeLessThanOrEqual(900);
    }
  });
});

describe('Stage 1 open lake: navigability (grid BFS, hull clearance, drift phases)', () => {
  it.each(driftTimes(course).map((t) => [t]))('start → dock is reachable at drift t=%s', (t) => {
    expect(reachable(course, t, 0.25)).toBe(true);
  });

  for (const r of course.routes ?? []) {
    it(`route "${r.name}" is navigable inside its ${ROUTE_BAND_U} u band at every drift phase`, () => {
      const inBand = (x: number, z: number) =>
        polylineDist({ x, z }, r.points) <= ROUTE_BAND_U || Math.hypot(x - course.start.x, z - course.start.z) < 20;
      for (const t of driftTimes(course)) expect(reachable(course, t, 1, inBand), `blocked at drift t=${t}`).toBe(true);
    });
  }
});
