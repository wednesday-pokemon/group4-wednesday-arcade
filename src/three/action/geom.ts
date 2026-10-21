// Geometry helpers shared by the world builders: raw triangle accumulator (vertex colours, flat normals), polygon maths
// in the XZ plane and a merge helper for the per-landmark MeshBuilder output.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Vec2 } from '../../action/types.ts';

export type V3 = [number, number, number];

export class TriBuilder {
  readonly pos: number[] = [];
  readonly col: number[] = [];
  private readonly c = new THREE.Color();

  /** Adds a triangle; winding is flipped when its geometric normal opposes `hint` (so authors never worry about order). */
  tri(a: V3, b: V3, c: V3, color: THREE.ColorRepresentation | [number, number, number], hint?: V3): void {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    let flip = false;
    if (hint) flip = nx * hint[0] + ny * hint[1] + nz * hint[2] < 0;
    const [p, q, r] = flip ? [a, c, b] : [a, b, c];
    if (Array.isArray(color)) this.c.setRGB(color[0], color[1], color[2]);
    else this.c.set(color);
    for (const v of [p, q, r]) {
      this.pos.push(v[0], v[1], v[2]);
      this.col.push(this.c.r, this.c.g, this.c.b);
    }
  }

  /** Per-vertex colours variant (used for foam gradients). */
  triC(a: V3, b: V3, c: V3, ca: V3, cb: V3, cc: V3, hint: V3): void {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const flip = nx * hint[0] + ny * hint[1] + nz * hint[2] < 0;
    const vs: [V3, V3][] = flip ? [[a, ca], [c, cc], [b, cb]] : [[a, ca], [b, cb], [c, cc]];
    for (const [v, col] of vs) {
      this.pos.push(v[0], v[1], v[2]);
      this.col.push(col[0], col[1], col[2]);
    }
  }

  get triangles(): number {
    return this.pos.length / 9;
  }

  build(flat = true): THREE.BufferGeometry | null {
    if (this.pos.length === 0) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    if (flat) g.computeVertexNormals();
    return g;
  }
}

/** Merge non-indexed geometries that all carry position/normal/color. Nulls are skipped. */
export function mergeAll(parts: (THREE.BufferGeometry | null | undefined)[]): THREE.BufferGeometry | null {
  const ok = parts.filter((p): p is THREE.BufferGeometry => !!p && p.getAttribute('position')?.count > 0);
  if (ok.length === 0) return null;
  const prepared = ok.map((g) => {
    const out = g.index ? g.toNonIndexed() : g;
    if (!out.getAttribute('normal')) out.computeVertexNormals();
    for (const name of Object.keys(out.attributes)) if (name !== 'position' && name !== 'normal' && name !== 'color') out.deleteAttribute(name);
    return out;
  });
  const merged = mergeGeometries(prepared, false);
  for (const p of prepared) p.dispose();
  return merged;
}

/** Applies a placement (position, yaw, uniform scale) to a local-space geometry. */
export function place(g: THREE.BufferGeometry, x: number, y: number, z: number, yaw: number, scale: number): THREE.BufferGeometry {
  const m = new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw), new THREE.Vector3(scale, scale, scale));
  g.applyMatrix4(m);
  return g;
}

// ------------------------------------------------------------------------------------------------- polygon maths
export function signedArea(pts: Vec2[]): number {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i], q = pts[(i + 1) % pts.length];
    a += p.x * q.z - q.x * p.z;
  }
  return a / 2;
}

export function ensureCCW(pts: Vec2[]): Vec2[] {
  return signedArea(pts) < 0 ? [...pts].reverse() : pts;
}

export function pointInPoly(pts: Vec2[], x: number, z: number): boolean {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i], b = pts[j];
    if (a.z > z !== b.z > z && x < ((b.x - a.x) * (z - a.z)) / (b.z - a.z) + a.x) inside = !inside;
  }
  return inside;
}

export function distToEdges(pts: Vec2[], x: number, z: number): number {
  let best = Infinity;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    const dx = b.x - a.x, dz = b.z - a.z;
    const l2 = dx * dx + dz * dz || 1e-9;
    const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / l2));
    best = Math.min(best, Math.hypot(x - (a.x + dx * t), z - (a.z + dz * t)));
  }
  return best;
}

export function resample(pts: Vec2[], step: number): Vec2[] {
  const out: Vec2[] = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    const n = Math.max(1, Math.round(len / step));
    for (let k = 0; k < n; k++) out.push({ x: a.x + ((b.x - a.x) * k) / n, z: a.z + ((b.z - a.z) * k) / n });
  }
  return out;
}

/** Unit outward normals of a CCW (in x,z) closed polyline. */
export function outwardNormals(pts: Vec2[]): Vec2[] {
  return pts.map((_, i) => {
    const p = pts[(i - 1 + pts.length) % pts.length];
    const q = pts[(i + 1) % pts.length];
    const dx = q.x - p.x, dz = q.z - p.z;
    const l = Math.hypot(dx, dz) || 1;
    return { x: dz / l, z: -dx / l };
  });
}

/** Distance from each vertex along its inward normal to the opposite side of the polygon. */
export function thicknessAlongInward(pts: Vec2[], normals: Vec2[]): number[] {
  const out: number[] = [];
  for (let i = 0; i < pts.length; i++) {
    const ox = pts[i].x - normals[i].x * 0.05, oz = pts[i].z - normals[i].z * 0.05;
    const dx = -normals[i].x, dz = -normals[i].z;
    let best = 60;
    for (let k = 0; k < pts.length; k++) {
      if (k === i || (k + 1) % pts.length === i) continue;
      const a = pts[k], b = pts[(k + 1) % pts.length];
      const ex = b.x - a.x, ez = b.z - a.z;
      const den = dx * ez - dz * ex;
      if (Math.abs(den) < 1e-9) continue;
      const t = ((a.x - ox) * ez - (a.z - oz) * ex) / den;
      const s = ((a.x - ox) * dz - (a.z - oz) * dx) / den;
      if (t > 0 && s >= 0 && s <= 1 && t < best) best = t;
    }
    out.push(best);
  }
  // min-filter + blur so inset rings do not kink
  const mf = out.map((_, i) => Math.min(out[(i - 1 + out.length) % out.length], out[i], out[(i + 1) % out.length]));
  return mf.map((_, i) => (mf[(i - 1 + mf.length) % mf.length] + 2 * mf[i] + mf[(i + 1) % mf.length]) / 4);
}

export function centroid(pts: Vec2[]): Vec2 {
  let x = 0, z = 0;
  for (const p of pts) { x += p.x; z += p.z; }
  return { x: x / pts.length, z: z / pts.length };
}

export function wrapAngle(a: number): number {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

/** Heading (boat convention, forward = (-sin h, -cos h)) pointing from (ax, az) toward (bx, bz). */
export function bearing(ax: number, az: number, bx: number, bz: number): number {
  return Math.atan2(-(bx - ax), -(bz - az));
}
