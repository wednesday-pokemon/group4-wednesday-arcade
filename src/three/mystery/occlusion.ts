// Camera occlusion against the REAL rendered static geometry: a uniform XZ grid of triangles with a double-sided ray test.
// The follow camera casts a few rays from the player's pivot toward its desired position and stops short of the first hit, so
// nothing the scene draws (walls, buttresses, cover, shrine stones, hiding-spot models, planters ...) can sit between lens and player.
import type * as THREE from 'three';

const CELL = 3;

export class TriGrid {
  private readonly pos: Float32Array[] = [];
  private readonly cells = new Map<number, Uint32Array>();
  private readonly tmp: Map<number, number[]> = new Map();
  private stamp = 0;
  private seen: Uint32Array = new Uint32Array(0);
  private ids: { g: number; t: number }[] = [];

  /** Geometries must be non-indexed and already in world space. */
  constructor(geos: (THREE.BufferGeometry | null | undefined)[], opts: { minY?: number } = {}) {
    const minY = opts.minY ?? -1e9;
    for (const g of geos) {
      if (!g) continue;
      const a = g.getAttribute('position');
      if (!a || g.index) continue;
      const arr = a.array as Float32Array;
      const gi = this.pos.push(arr) - 1;
      const n = Math.floor(arr.length / 9);
      for (let t = 0; t < n; t++) {
        const o = t * 9;
        const y0 = arr[o + 1], y1 = arr[o + 4], y2 = arr[o + 7];
        if (Math.max(y0, y1, y2) < minY) continue; // flat ground-level decals never block the lens
        const x0 = Math.min(arr[o], arr[o + 3], arr[o + 6]), x1 = Math.max(arr[o], arr[o + 3], arr[o + 6]);
        const z0 = Math.min(arr[o + 2], arr[o + 5], arr[o + 8]), z1 = Math.max(arr[o + 2], arr[o + 5], arr[o + 8]);
        const id = this.ids.push({ g: gi, t }) - 1;
        for (let cx = Math.floor(x0 / CELL); cx <= Math.floor(x1 / CELL); cx++) {
          for (let cz = Math.floor(z0 / CELL); cz <= Math.floor(z1 / CELL); cz++) {
            const k = cx * 100003 + cz;
            let l = this.tmp.get(k);
            if (!l) { l = []; this.tmp.set(k, l); }
            l.push(id);
          }
        }
      }
    }
    for (const [k, l] of this.tmp) this.cells.set(k, Uint32Array.from(l));
    this.tmp.clear();
    this.seen = new Uint32Array(this.ids.length);
  }

  get triangleCount(): number { return this.ids.length; }

  /** Distance along the (unit) direction to the first triangle hit within maxT, or Infinity. */
  firstHit(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, maxT: number, minT = 0): number {
    this.stamp++;
    const ex = ox + dx * maxT, ez = oz + dz * maxT;
    const cx0 = Math.floor(Math.min(ox, ex) / CELL), cx1 = Math.floor(Math.max(ox, ex) / CELL);
    const cz0 = Math.floor(Math.min(oz, ez) / CELL), cz1 = Math.floor(Math.max(oz, ez) / CELL);
    let best = Infinity;
    for (let cx = cx0; cx <= cx1; cx++) {
      for (let cz = cz0; cz <= cz1; cz++) {
        const l = this.cells.get(cx * 100003 + cz);
        if (!l) continue;
        for (let i = 0; i < l.length; i++) {
          const id = l[i];
          if (this.seen[id] === this.stamp) continue;
          this.seen[id] = this.stamp;
          const { g, t } = this.ids[id];
          const a = this.pos[g];
          const o = t * 9;
          // Moller-Trumbore, double sided
          const e1x = a[o + 3] - a[o], e1y = a[o + 4] - a[o + 1], e1z = a[o + 5] - a[o + 2];
          const e2x = a[o + 6] - a[o], e2y = a[o + 7] - a[o + 1], e2z = a[o + 8] - a[o + 2];
          const px = dy * e2z - dz * e2y, py = dz * e2x - dx * e2z, pz = dx * e2y - dy * e2x;
          const det = e1x * px + e1y * py + e1z * pz;
          if (det > -1e-9 && det < 1e-9) continue;
          const inv = 1 / det;
          const tx = ox - a[o], ty = oy - a[o + 1], tz = oz - a[o + 2];
          const u = (tx * px + ty * py + tz * pz) * inv;
          if (u < 0 || u > 1) continue;
          const qx = ty * e1z - tz * e1y, qy = tz * e1x - tx * e1z, qz = tx * e1y - ty * e1x;
          const v = (dx * qx + dy * qy + dz * qz) * inv;
          if (v < 0 || u + v > 1) continue;
          const tt = (e2x * qx + e2y * qy + e2z * qz) * inv;
          if (tt > minT && tt < best && tt <= maxT) best = tt;
        }
      }
    }
    return best;
  }
}
