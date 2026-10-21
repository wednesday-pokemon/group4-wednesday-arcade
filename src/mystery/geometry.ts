// XZ-plane geometry: walls are capsules (thick segments), cover is circles. Circle–capsule push-out for movement with
// sliding, swept (sub-stepped) motion so nothing tunnels, and segment queries for line of sight / sound occlusion.
import type { CoverDef, MapDef, Vec2, WallDef } from './types.ts';

export interface Collider {
  id: string;
  kind: 'wall' | 'cover';
  ax: number; az: number; bx: number; bz: number; // core segment (a point for cover)
  r: number; // capsule radius (half thickness) or cover radius
  low: boolean; // low cover: blocks sight only for a crouching target, movement only if configured
  minX: number; maxX: number; minZ: number; maxZ: number; // AABB of the swept shape
}

export function closestOnSegment(px: number, pz: number, ax: number, az: number, bx: number, bz: number): { x: number; z: number; t: number } {
  const dx = bx - ax;
  const dz = bz - az;
  const len2 = dx * dx + dz * dz;
  let t = len2 > 1e-12 ? ((px - ax) * dx + (pz - az) * dz) / len2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return { x: ax + dx * t, z: az + dz * t, t };
}

export function distPointSegment(px: number, pz: number, ax: number, az: number, bx: number, bz: number): number {
  const c = closestOnSegment(px, pz, ax, az, bx, bz);
  return Math.hypot(px - c.x, pz - c.z);
}

/** Squared distance between segments p1–q1 and p2–q2 (Ericson, Real-Time Collision Detection §5.1.9). */
export function segSegDist2(
  p1x: number, p1z: number, q1x: number, q1z: number, p2x: number, p2z: number, q2x: number, q2z: number,
): number {
  const d1x = q1x - p1x, d1z = q1z - p1z;
  const d2x = q2x - p2x, d2z = q2z - p2z;
  const rx = p1x - p2x, rz = p1z - p2z;
  const a = d1x * d1x + d1z * d1z;
  const e = d2x * d2x + d2z * d2z;
  const f = d2x * rx + d2z * rz;
  let s: number;
  let t: number;
  const EPS = 1e-12;
  if (a <= EPS && e <= EPS) return rx * rx + rz * rz;
  if (a <= EPS) {
    s = 0;
    t = Math.min(1, Math.max(0, f / e));
  } else {
    const c = d1x * rx + d1z * rz;
    if (e <= EPS) {
      t = 0;
      s = Math.min(1, Math.max(0, -c / a));
    } else {
      const b = d1x * d2x + d1z * d2z;
      const denom = a * e - b * b;
      s = denom > EPS ? Math.min(1, Math.max(0, (b * f - c * e) / denom)) : 0;
      t = (b * s + f) / e;
      if (t < 0) {
        t = 0;
        s = Math.min(1, Math.max(0, -c / a));
      } else if (t > 1) {
        t = 1;
        s = Math.min(1, Math.max(0, (b - c) / a));
      }
    }
  }
  const cx = p1x + d1x * s - (p2x + d2x * t);
  const cz = p1z + d1z * s - (p2z + d2z * t);
  return cx * cx + cz * cz;
}

/** True if the segment p→q passes within `r` of the collider's core (i.e. intersects the capsule / circle). */
export function segmentHitsCollider(px: number, pz: number, qx: number, qz: number, c: Collider, pad = 0): boolean {
  const r = c.r + pad;
  if (Math.max(px, qx) < c.minX - pad || Math.min(px, qx) > c.maxX + pad) return false;
  if (Math.max(pz, qz) < c.minZ - pad || Math.min(pz, qz) > c.maxZ + pad) return false;
  return segSegDist2(px, pz, qx, qz, c.ax, c.az, c.bx, c.bz) < r * r;
}

export function pointInPolygon(x: number, z: number, poly: readonly Vec2[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if ((a.z > z) !== (b.z > z) && x < ((b.x - a.x) * (z - a.z)) / (b.z - a.z) + a.x) inside = !inside;
  }
  return inside;
}

function wallCollider(w: WallDef): Collider {
  const r = w.thickness / 2;
  return {
    id: w.id, kind: 'wall', ax: w.a.x, az: w.a.z, bx: w.b.x, bz: w.b.z, r, low: false,
    minX: Math.min(w.a.x, w.b.x) - r, maxX: Math.max(w.a.x, w.b.x) + r,
    minZ: Math.min(w.a.z, w.b.z) - r, maxZ: Math.max(w.a.z, w.b.z) + r,
  };
}

function coverCollider(c: CoverDef): Collider {
  return {
    id: c.id, kind: 'cover', ax: c.x, az: c.z, bx: c.x, bz: c.z, r: c.radius, low: c.height === 'low',
    minX: c.x - c.radius, maxX: c.x + c.radius, minZ: c.z - c.radius, maxZ: c.z + c.radius,
  };
}

export interface Contact { id: string; nx: number; nz: number; depth: number }

/**
 * The static world for one run: walls + cover, with a set of currently open (removed) gate walls.
 * Movement solids = walls + high cover (+ low cover if `lowCoverBlocksMovement`). Sight blockers = walls + high cover;
 * low cover additionally blocks sight to a crouching target.
 */
export class World {
  readonly walls: Collider[];
  readonly cover: Collider[];
  readonly bounds: MapDef['bounds'];
  private readonly open = new Set<string>();
  private readonly lowBlocks: boolean;
  /** Bumped whenever a gate opens/closes (nav caches key on it). */
  revision = 0;

  constructor(map: MapDef, lowCoverBlocksMovement = false) {
    this.walls = map.walls.map(wallCollider);
    this.cover = map.cover.map(coverCollider);
    this.bounds = map.bounds;
    this.lowBlocks = lowCoverBlocksMovement;
  }

  setWallOpen(id: string, open: boolean): void {
    const had = this.open.has(id);
    if (open && !had) this.open.add(id);
    else if (!open && had) this.open.delete(id);
    else return;
    this.revision++;
  }

  isWallOpen(id: string): boolean {
    return this.open.has(id);
  }

  openKey(): string {
    return [...this.open].sort().join(',');
  }

  /** Colliders that block movement right now. */
  solids(): Collider[] {
    const out: Collider[] = [];
    for (const w of this.walls) if (!this.open.has(w.id)) out.push(w);
    for (const c of this.cover) if (!c.low || this.lowBlocks) out.push(c);
    return out;
  }

  /** Penetration contacts of a circle against the solids. */
  contacts(x: number, z: number, r: number, solids = this.solids()): Contact[] {
    const out: Contact[] = [];
    for (const c of solids) {
      if (x + r < c.minX || x - r > c.maxX || z + r < c.minZ || z - r > c.maxZ) continue;
      const p = closestOnSegment(x, z, c.ax, c.az, c.bx, c.bz);
      const dx = x - p.x;
      const dz = z - p.z;
      const d = Math.hypot(dx, dz);
      const depth = c.r + r - d;
      if (depth > 1e-9) {
        // Degenerate (centre exactly on the core): push perpendicular to the wall, or +X for a circle.
        let nx = 1;
        let nz = 0;
        if (d > 1e-9) {
          nx = dx / d;
          nz = dz / d;
        } else if (c.kind === 'wall') {
          const lx = c.bx - c.ax;
          const lz = c.bz - c.az;
          const l = Math.hypot(lx, lz) || 1;
          nx = -lz / l;
          nz = lx / l;
        }
        out.push({ id: c.id, nx, nz, depth });
      }
    }
    return out;
  }

  /** True if a circle at (x, z) overlaps no solid and is inside the bounds. */
  isFree(x: number, z: number, r: number, solids = this.solids()): boolean {
    const b = this.bounds;
    if (x - r < b.minX || x + r > b.maxX || z - r < b.minZ || z + r > b.maxZ) return false;
    return this.contacts(x, z, r, solids).length === 0;
  }

  /**
   * Moves a circle by (dx, dz) in sub-steps no longer than r/2, pushing out of solids after each sub-step (so motion
   * along a wall slides and nothing tunnels). If a sub-step cannot be resolved it is discarded, so the circle never
   * ends inside a wall. Returns the final position and every contact normal touched.
   */
  move(x: number, z: number, dx: number, dz: number, r: number): { x: number; z: number; contacts: Contact[] } {
    const solids = this.solids();
    const dist = Math.hypot(dx, dz);
    const steps = Math.max(1, Math.ceil(dist / Math.max(0.05, r * 0.5)));
    const sx = dx / steps;
    const sz = dz / steps;
    const touched: Contact[] = [];
    let cx = x;
    let cz = z;
    const b = this.bounds;
    for (let s = 0; s < steps; s++) {
      let nx = cx + sx;
      let nz = cz + sz;
      for (let iter = 0; iter < 6; iter++) {
        const cs = this.contacts(nx, nz, r, solids);
        if (cs.length === 0) break;
        // resolve the deepest first; iterate for corners
        let deepest = cs[0];
        for (const c of cs) if (c.depth > deepest.depth) deepest = c;
        nx += deepest.nx * (deepest.depth + 1e-6);
        nz += deepest.nz * (deepest.depth + 1e-6);
        touched.push(deepest);
      }
      nx = Math.min(b.maxX - r, Math.max(b.minX + r, nx));
      nz = Math.min(b.maxZ - r, Math.max(b.minZ + r, nz));
      if (this.contacts(nx, nz, r, solids).length > 0) {
        // Unresolvable corner: try the two axis-aligned slides, else stay.
        const ax = Math.min(b.maxX - r, Math.max(b.minX + r, cx + sx));
        const az = Math.min(b.maxZ - r, Math.max(b.minZ + r, cz + sz));
        if (this.contacts(ax, cz, r, solids).length === 0) { nx = ax; nz = cz; }
        else if (this.contacts(cx, az, r, solids).length === 0) { nx = cx; nz = az; }
        else { nx = cx; nz = cz; }
      }
      cx = nx;
      cz = nz;
    }
    return { x: cx, z: cz, contacts: touched };
  }

  /** Walls + high cover crossing the segment (sight / sound blockers). `crouchTarget` adds low cover. */
  blockersOn(px: number, pz: number, qx: number, qz: number, crouchTarget = false): { walls: number; cover: number; low: number } {
    let walls = 0;
    let cover = 0;
    let low = 0;
    for (const w of this.walls) {
      if (this.open.has(w.id)) continue;
      if (segmentHitsCollider(px, pz, qx, qz, w)) walls++;
    }
    for (const c of this.cover) {
      if (c.low) {
        if (crouchTarget && segmentHitsCollider(px, pz, qx, qz, c)) low++;
      } else if (segmentHitsCollider(px, pz, qx, qz, c)) cover++;
    }
    return { walls, cover, low };
  }

  /** Straight-line sight between two points (walls + high cover; low cover too when the target crouches). */
  lineOfSight(px: number, pz: number, qx: number, qz: number, crouchTarget = false): boolean {
    for (const w of this.walls) {
      if (this.open.has(w.id)) continue;
      if (segmentHitsCollider(px, pz, qx, qz, w)) return false;
    }
    for (const c of this.cover) {
      if (c.low && !crouchTarget) continue;
      if (segmentHitsCollider(px, pz, qx, qz, c)) return false;
    }
    return true;
  }

  /** True if a circle of radius r can travel straight from p to q without touching a solid. */
  sweepClear(px: number, pz: number, qx: number, qz: number, r: number, solids = this.solids()): boolean {
    for (const c of solids) if (segmentHitsCollider(px, pz, qx, qz, c, r)) return false;
    return true;
  }

  /** How far (≤ maxDist) along the ray from p the point stays `margin` clear of sight blockers. */
  rayFree(px: number, pz: number, dirX: number, dirZ: number, maxDist: number, margin: number): number {
    const step = 0.25;
    let last = 0;
    const solids = this.solids();
    for (let d = step; d <= maxDist + 1e-9; d += step) {
      const x = px + dirX * d;
      const z = pz + dirZ * d;
      if (!this.isFree(x, z, margin, solids) || !this.lineOfSight(px, pz, x, z)) break;
      last = d;
    }
    return last;
  }
}

export function dist(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

/** Forward unit vector for a yaw (repo convention: yaw 0 faces −Z, positive yaw turns left). */
export function forward(yaw: number): Vec2 {
  return { x: -Math.sin(yaw), z: -Math.cos(yaw) };
}

/** Yaw that faces from `a` toward `b`. */
export function yawTo(ax: number, az: number, bx: number, bz: number): number {
  return Math.atan2(-(bx - ax), -(bz - az));
}

export function wrapAngle(a: number): number {
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a < -Math.PI) a += 2 * Math.PI;
  return a;
}

/** Turns `from` toward `to` by at most `maxStep` radians. */
export function turnToward(from: number, to: number, maxStep: number): number {
  const d = wrapAngle(to - from);
  if (Math.abs(d) <= maxStep) return wrapAngle(to);
  return wrapAngle(from + Math.sign(d) * maxStep);
}
