// Grid navigation: a ~0.5 m occupancy grid rasterised from walls + movement-blocking cover, inflated by the agent radius
// (a cell is walkable iff a circle of that radius at the cell centre touches no solid). 8-connected A* without corner
// cutting, octile heuristic, then greedy string-pulling. Grids are cached per (walls + cover arrays, bounds, radius, open
// gates), so session maps sharing a case map's geometry share its grids.
import { World } from './geometry.ts';
import type { MapDef, Vec2 } from './types.ts';

const SQRT2 = Math.SQRT2;
const DX = [1, -1, 0, 0, 1, 1, -1, -1];
const DZ = [0, 0, 1, -1, 1, -1, 1, -1];

export class NavGrid {
  readonly minX: number;
  readonly minZ: number;
  readonly cell: number;
  readonly w: number;
  readonly h: number;
  readonly radius: number;
  readonly blocked: Uint8Array;
  readonly component: Int32Array; // connected-component label per walkable cell (−1 blocked)
  private readonly g: Float64Array;
  private readonly from: Int32Array;
  private readonly stamp: Uint32Array;
  private readonly closed: Uint32Array;
  private searchId = 0;

  constructor(world: World, radius: number, cell: number) {
    const b = world.bounds;
    this.minX = b.minX;
    this.minZ = b.minZ;
    this.cell = cell;
    this.radius = radius;
    this.w = Math.max(1, Math.ceil((b.maxX - b.minX) / cell));
    this.h = Math.max(1, Math.ceil((b.maxZ - b.minZ) / cell));
    const n = this.w * this.h;
    this.blocked = new Uint8Array(n);
    // bounds
    for (let iz = 0; iz < this.h; iz++) {
      for (let ix = 0; ix < this.w; ix++) {
        const x = this.cx(ix);
        const z = this.cz(iz);
        if (x - radius < b.minX || x + radius > b.maxX || z - radius < b.minZ || z + radius > b.maxZ) this.blocked[iz * this.w + ix] = 1;
      }
    }
    // rasterise each solid with the inflated radius (small margin so string-pulled lines keep clear of corners)
    const margin = 0.02;
    for (const c of world.solids()) {
      const rr = c.r + radius + margin;
      const ix0 = Math.max(0, Math.floor((c.minX - radius - margin - this.minX) / cell));
      const ix1 = Math.min(this.w - 1, Math.floor((c.maxX + radius + margin - this.minX) / cell));
      const iz0 = Math.max(0, Math.floor((c.minZ - radius - margin - this.minZ) / cell));
      const iz1 = Math.min(this.h - 1, Math.floor((c.maxZ + radius + margin - this.minZ) / cell));
      const lx = c.bx - c.ax;
      const lz = c.bz - c.az;
      const len2 = lx * lx + lz * lz;
      for (let iz = iz0; iz <= iz1; iz++) {
        const z = this.cz(iz);
        for (let ix = ix0; ix <= ix1; ix++) {
          const idx = iz * this.w + ix;
          if (this.blocked[idx]) continue;
          const x = this.cx(ix);
          let t = len2 > 1e-12 ? ((x - c.ax) * lx + (z - c.az) * lz) / len2 : 0;
          t = t < 0 ? 0 : t > 1 ? 1 : t;
          const px = c.ax + lx * t - x;
          const pz = c.az + lz * t - z;
          if (px * px + pz * pz < rr * rr) this.blocked[idx] = 1;
        }
      }
    }
    this.component = new Int32Array(n).fill(-1);
    this.labelComponents();
    this.g = new Float64Array(n);
    this.from = new Int32Array(n);
    this.stamp = new Uint32Array(n);
    this.closed = new Uint32Array(n);
  }

  cx(ix: number): number {
    return this.minX + (ix + 0.5) * this.cell;
  }

  cz(iz: number): number {
    return this.minZ + (iz + 0.5) * this.cell;
  }

  index(x: number, z: number): number {
    const ix = Math.floor((x - this.minX) / this.cell);
    const iz = Math.floor((z - this.minZ) / this.cell);
    if (ix < 0 || iz < 0 || ix >= this.w || iz >= this.h) return -1;
    return iz * this.w + ix;
  }

  center(idx: number): Vec2 {
    return { x: this.cx(idx % this.w), z: this.cz(Math.floor(idx / this.w)) };
  }

  walkable(x: number, z: number): boolean {
    const i = this.index(x, z);
    return i >= 0 && this.blocked[i] === 0;
  }

  private canStep(ix: number, iz: number, d: number): boolean {
    const nx = ix + DX[d];
    const nz = iz + DZ[d];
    if (nx < 0 || nz < 0 || nx >= this.w || nz >= this.h) return false;
    if (this.blocked[nz * this.w + nx]) return false;
    if (d >= 4) {
      // diagonal: no corner cutting
      if (this.blocked[iz * this.w + nx] || this.blocked[nz * this.w + ix]) return false;
    }
    return true;
  }

  private labelComponents(): void {
    let label = 0;
    const stack: number[] = [];
    for (let i = 0; i < this.blocked.length; i++) {
      if (this.blocked[i] || this.component[i] >= 0) continue;
      this.component[i] = label;
      stack.push(i);
      while (stack.length) {
        const cur = stack.pop()!;
        const ix = cur % this.w;
        const iz = (cur - ix) / this.w;
        for (let d = 0; d < 8; d++) {
          if (!this.canStep(ix, iz, d)) continue;
          const nb = (iz + DZ[d]) * this.w + ix + DX[d];
          if (this.component[nb] < 0) {
            this.component[nb] = label;
            stack.push(nb);
          }
        }
      }
      label++;
    }
  }

  /** Nearest walkable cell (ring search up to maxM), optionally restricted to a component. −1 if none. */
  nearestCell(x: number, z: number, maxM = 12, component = -1): number {
    const ix0 = Math.floor((x - this.minX) / this.cell);
    const iz0 = Math.floor((z - this.minZ) / this.cell);
    const maxRing = Math.ceil(maxM / this.cell);
    let best = -1;
    let bestD = Infinity;
    for (let ring = 0; ring <= maxRing; ring++) {
      for (let iz = iz0 - ring; iz <= iz0 + ring; iz++) {
        for (let ix = ix0 - ring; ix <= ix0 + ring; ix++) {
          if (Math.max(Math.abs(ix - ix0), Math.abs(iz - iz0)) !== ring) continue;
          if (ix < 0 || iz < 0 || ix >= this.w || iz >= this.h) continue;
          const i = iz * this.w + ix;
          if (this.blocked[i]) continue;
          if (component >= 0 && this.component[i] !== component) continue;
          const d = Math.hypot(this.cx(ix) - x, this.cz(iz) - z);
          if (d < bestD) {
            bestD = d;
            best = i;
          }
        }
      }
      // a hit in this ring can still be beaten by the next ring only within √2 × cell; stop one ring later
      if (best >= 0 && ring * this.cell > bestD + this.cell) break;
    }
    return best;
  }

  nearestWalkable(p: Vec2, maxM = 12, component = -1): Vec2 | null {
    if (component < 0 && this.walkable(p.x, p.z)) return { x: p.x, z: p.z };
    if (component >= 0) {
      const i = this.index(p.x, p.z);
      if (i >= 0 && this.component[i] === component) return { x: p.x, z: p.z };
    }
    const c = this.nearestCell(p.x, p.z, maxM, component);
    return c >= 0 ? this.center(c) : null;
  }

  componentAt(p: Vec2, snapM = 1.5): number {
    const i = this.index(p.x, p.z);
    if (i >= 0 && !this.blocked[i]) return this.component[i];
    const c = this.nearestCell(p.x, p.z, snapM);
    return c >= 0 ? this.component[c] : -1;
  }

  /** True if both points (snapped within snapM) are in the same connected component. */
  reachable(a: Vec2, b: Vec2, snapM = 1.5): boolean {
    const ca = this.componentAt(a, snapM);
    return ca >= 0 && ca === this.componentAt(b, snapM);
  }

  /** Grid-walkable straight line (sampled at cell/3). */
  lineWalkable(a: Vec2, b: Vec2): boolean {
    const d = Math.hypot(b.x - a.x, b.z - a.z);
    const n = Math.max(1, Math.ceil(d / (this.cell / 3)));
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      if (!this.walkable(a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t)) return false;
    }
    return true;
  }

  /**
   * Path from `start` to `goal` as world waypoints (excluding the start). If the goal is not walkable / not reachable,
   * the path ends at the reachable cell nearest the goal. Returns null only if the start itself cannot be snapped.
   */
  findPath(start: Vec2, goal: Vec2): Vec2[] | null {
    let s = this.index(start.x, start.z);
    if (s < 0 || this.blocked[s]) s = this.nearestCell(start.x, start.z, 3);
    if (s < 0) return null;
    const comp = this.component[s];
    let goalIdx = this.index(goal.x, goal.z);
    let exactGoal = goalIdx >= 0 && !this.blocked[goalIdx] && this.component[goalIdx] === comp;
    if (!exactGoal) {
      goalIdx = this.nearestCell(goal.x, goal.z, 6, comp);
      if (goalIdx < 0) goalIdx = this.nearestInComponent(goal, comp);
      exactGoal = false;
    }
    if (goalIdx < 0) return [];
    const cells = this.astar(s, goalIdx);
    if (!cells) return [];
    const pts: Vec2[] = cells.map((c) => this.center(c));
    if (exactGoal) pts[pts.length - 1] = { x: goal.x, z: goal.z };
    const startPt = this.walkable(start.x, start.z) ? { x: start.x, z: start.z } : this.center(s);
    return this.smooth(startPt, pts);
  }

  private nearestInComponent(goal: Vec2, comp: number): number {
    let best = -1;
    let bestD = Infinity;
    for (let i = 0; i < this.component.length; i++) {
      if (this.component[i] !== comp) continue;
      const c = this.center(i);
      const d = (c.x - goal.x) ** 2 + (c.z - goal.z) ** 2;
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    return best;
  }

  private astar(s: number, goal: number): number[] | null {
    if (s === goal) return [goal];
    this.searchId = (this.searchId + 1) >>> 0;
    if (this.searchId === 0) {
      this.stamp.fill(0);
      this.closed.fill(0);
      this.searchId = 1;
    }
    const id = this.searchId;
    const gx = goal % this.w;
    const gz = (goal - gx) / this.w;
    const heap = new MinHeap();
    const h = (i: number) => {
      const ix = i % this.w;
      const iz = (i - ix) / this.w;
      const dx = Math.abs(ix - gx);
      const dz = Math.abs(iz - gz);
      return (dx + dz + (SQRT2 - 2) * Math.min(dx, dz)) * 1.0001;
    };
    this.stamp[s] = id;
    this.g[s] = 0;
    this.from[s] = -1;
    heap.push(s, h(s));
    while (heap.size > 0) {
      const cur = heap.pop();
      if (this.closed[cur] === id) continue;
      this.closed[cur] = id;
      if (cur === goal) break;
      const ix = cur % this.w;
      const iz = (cur - ix) / this.w;
      for (let d = 0; d < 8; d++) {
        if (!this.canStep(ix, iz, d)) continue;
        const nb = (iz + DZ[d]) * this.w + ix + DX[d];
        if (this.closed[nb] === id) continue;
        const ng = this.g[cur] + (d >= 4 ? SQRT2 : 1);
        if (this.stamp[nb] !== id || ng < this.g[nb]) {
          this.stamp[nb] = id;
          this.g[nb] = ng;
          this.from[nb] = cur;
          heap.push(nb, ng + h(nb));
        }
      }
    }
    if (this.closed[goal] !== id) return null;
    const out: number[] = [];
    for (let c = goal; c !== -1; c = this.from[c]) out.push(c);
    out.reverse();
    return out.slice(1).length ? out.slice(1) : [goal];
  }

  private smooth(start: Vec2, pts: Vec2[]): Vec2[] {
    if (pts.length <= 1) return pts;
    const out: Vec2[] = [];
    let anchor = start;
    let i = 0;
    while (i < pts.length) {
      let j = i;
      while (j + 1 < pts.length && this.lineWalkable(anchor, pts[j + 1])) j++;
      out.push(pts[j]);
      anchor = pts[j];
      i = j + 1;
    }
    return out;
  }
}

/** Binary min-heap of (item, key) on growable typed arrays (no per-operation allocation). */
class MinHeap {
  private items = new Int32Array(1024);
  private keys = new Float64Array(1024);
  size = 0;

  push(item: number, key: number): void {
    if (this.size === this.items.length) {
      const items = new Int32Array(this.size * 2);
      const keys = new Float64Array(this.size * 2);
      items.set(this.items);
      keys.set(this.keys);
      this.items = items;
      this.keys = keys;
    }
    const a = this.items;
    const k = this.keys;
    let i = this.size++;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (k[p] <= key) break;
      a[i] = a[p];
      k[i] = k[p];
      i = p;
    }
    a[i] = item;
    k[i] = key;
  }

  pop(): number {
    const a = this.items;
    const k = this.keys;
    const top = a[0];
    const n = --this.size;
    if (n > 0) {
      const item = a[n];
      const key = k[n];
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        if (l >= n) break;
        const r = l + 1;
        const m = r < n && k[r] < k[l] ? r : l;
        if (k[m] >= key) break;
        a[i] = a[m];
        k[i] = k[m];
        i = m;
      }
      a[i] = item;
      k[i] = key;
    }
    return top;
  }
}

/** Path length along a polyline starting at `from`. */
export function pathLength(from: Vec2, path: readonly Vec2[]): number {
  let total = 0;
  let prev = from;
  for (const p of path) {
    total += Math.hypot(p.x - prev.x, p.z - prev.z);
    prev = p;
  }
  return total;
}

/**
 * Grid cache keyed on the map's GEOMETRY ARRAYS (walls, then cover) rather than the MapDef object, so per-session maps
 * that share the case map's arrays (layout.ts sessionMap) reuse one set of grids per process. Bounds are part of the key.
 */
const cache = new WeakMap<object, WeakMap<object, Map<string, NavGrid>>>();

let gridsBuilt = 0;

/** Number of grids built by navGridFor so far in this process (tests / perf probes). */
export function navGridsBuilt(): number {
  return gridsBuilt;
}

/**
 * Cached grid for (map geometry, agent radius, open gates, cell size, low-cover rule). The World passed in supplies the
 * current gate state; grids are immutable once built.
 */
export function navGridFor(map: MapDef, world: World, radius: number, cellM: number, lowCoverBlocks = false): NavGrid {
  let byCover = cache.get(map.walls);
  if (!byCover) {
    byCover = new WeakMap();
    cache.set(map.walls, byCover);
  }
  let byKey = byCover.get(map.cover);
  if (!byKey) {
    byKey = new Map();
    byCover.set(map.cover, byKey);
  }
  const b = map.bounds;
  const key = `${b.minX},${b.maxX},${b.minZ},${b.maxZ}|${radius.toFixed(3)}|${cellM}|${lowCoverBlocks ? 1 : 0}|${world.openKey()}`;
  let grid = byKey.get(key);
  if (!grid) {
    grid = new NavGrid(world, radius, cellM);
    gridsBuilt++;
    byKey.set(key, grid);
  }
  return grid;
}
