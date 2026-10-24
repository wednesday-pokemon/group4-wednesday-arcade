// Case-specific skins for the walls and cover a case ADDS to the shared island (CaseWorldDef.extraWalls / extraCover):
//   archive -> freestanding bookshelf rows (textured spines) and lab benches
//   crypt   -> collapsed-corridor rubble heaps and timber-braced tunnel walls
//   signal  -> chain-link patrol fences, striped concrete barriers, guard-hut walls
// Collision is unchanged (the sim uses the WallDef capsule); these only change what is drawn, sized from the WallDef numbers.
import * as THREE from 'three';
import type { CoverDef, WallDef } from '../../mystery/types.ts';
import type { GlowEntry } from '../action/fx.ts';
import { MeshBuilder } from '../util.ts';
import { BOX, CONE4, CYL6, CYL8, CYL12, ICO0, ICO1, PAL } from './common.ts';
import type { Theme } from './look.ts';

const NG = { gradient: 0, jitter: 0 } as const;
const TORUS_LITE = new THREE.TorusGeometry(1, 0.1, 4, 10);

/** Accumulator for textured quads (the bookshelf spines). */
export class QuadSet {
  private readonly pos: number[] = [];
  private readonly nor: number[] = [];
  private readonly uv: number[] = [];
  private readonly col: number[] = [];
  get count(): number { return this.pos.length / 12; }
  /** a quad p0..p3 (counter-clockwise seen from the side the normal points to), u over `ur`, v over `vr` with a u offset */
  add(p0: number[], p1: number[], p2: number[], p3: number[], n: number[], ur: number, vr: number, u0: number, shade = 1): void {
    this.pos.push(...p0, ...p1, ...p2, ...p3);
    for (let i = 0; i < 4; i++) { this.nor.push(...n); this.col.push(shade, shade, shade); }
    this.uv.push(u0, 0, u0 + ur, 0, u0 + ur, vr, u0, vr);
  }
  build(): THREE.BufferGeometry | null {
    if (!this.pos.length) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    const idx: number[] = [];
    for (let i = 0; i < this.pos.length / 12; i++) idx.push(i * 4, i * 4 + 1, i * 4 + 2, i * 4, i * 4 + 2, i * 4 + 3);
    g.setIndex(idx);
    return g;
  }
}

export interface StyledOut { lit: MeshBuilder; em: MeshBuilder; glass: MeshBuilder; shelf: QuadSet; glows: GlowEntry[] }

/** Canvas texture of book spines on four shelves (tiles horizontally). */
export function makeBookTexture(): THREE.Texture | null {
  if (typeof document === 'undefined') return null;
  const W = 256, H = 256;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const ctx = c.getContext('2d');
  if (!ctx) return null;
  let s = 91;
  const rnd = (): number => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  ctx.fillStyle = '#1c130e';
  ctx.fillRect(0, 0, W, H);
  const palette = ['#7a2e3e', '#2f5a8a', '#4f7a3f', '#8a6a2e', '#5a3a86', '#2e6a6a', '#8a4a2a', '#a8a090', '#3a3f58', '#6a2a2a'];
  const rows = 4, rh = H / rows;
  for (let r = 0; r < rows; r++) {
    const y1 = (r + 1) * rh - 7; // shelf board top
    let x = 2;
    while (x < W - 3) {
      const bw = 5 + rnd() * 9, bh = rh * (0.55 + rnd() * 0.33);
      const col = palette[Math.floor(rnd() * palette.length)];
      ctx.fillStyle = col;
      ctx.fillRect(x, y1 - bh, bw, bh);
      ctx.fillStyle = 'rgba(255,255,255,0.14)'; // spine highlight
      ctx.fillRect(x, y1 - bh, 1.5, bh);
      ctx.fillStyle = 'rgba(0,0,0,0.28)';
      ctx.fillRect(x + bw - 1.5, y1 - bh, 1.5, bh);
      if (rnd() < 0.55) { ctx.fillStyle = rnd() < 0.5 ? '#c8a24a' : '#d8cfa8'; ctx.fillRect(x + 1, y1 - bh * (0.55 + rnd() * 0.3), bw - 2, 2); }
      x += bw + (rnd() < 0.12 ? 3 + rnd() * 6 : 0.5);
    }
    ctx.fillStyle = '#4a3322'; // shelf board
    ctx.fillRect(0, y1, W, 7);
    ctx.fillStyle = '#6a4a30';
    ctx.fillRect(0, y1, W, 1.5);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
}

function basis(w: WallDef): { len: number; rotY: number; dx: number; dz: number; npx: number; npz: number } {
  const dx = w.b.x - w.a.x, dz = w.b.z - w.a.z;
  const len = Math.hypot(dx, dz) || 1e-6;
  return { len, rotY: Math.atan2(-dz, dx), dx: dx / len, dz: dz / len, npx: -dz / len, npz: dx / len };
}

// ------------------------------------------------------------------------------------------------ archive
function bookshelfRow(o: StyledOut, w: WallDef, rand: () => number): void {
  const { len, rotY, dx, dz, npx, npz } = basis(w);
  const t = Math.max(0.5, w.thickness), h = w.height;
  const at = (s: number): [number, number] => [w.a.x + dx * s, w.a.z + dz * s];
  const [mx, mz] = at(len / 2);
  // carcass: dark wood body, plinth and cornice
  o.lit.add(BOX, '#2a1a10', [mx, h / 2, mz], [0, rotY, 0], [len, h, t * 0.86], { gradient: 0.3, jitter: 0.05 });
  o.lit.add(BOX, '#1c120a', [mx, 0.1, mz], [0, rotY, 0], [len + 0.06, 0.2, t + 0.06], NG);
  o.lit.add(BOX, '#3a2517', [mx, h + 0.06, mz], [0, rotY, 0], [len + 0.14, 0.12, t + 0.14], { gradient: 0.1 });
  const bays = Math.max(1, Math.round(len / 1.9));
  for (let i = 0; i <= bays; i++) {
    const [px, pz] = at((i / bays) * len);
    o.lit.add(BOX, '#3a2517', [px, h / 2, pz], [0, rotY, 0], [0.1, h, t + 0.05], { gradient: 0.1 });
  }
  const y0 = 0.24, y1 = h * 0.95;
  const off = t * 0.43 + 0.012;
  for (let i = 0; i < bays; i++) {
    const s0 = (i / bays) * len + 0.05, s1 = ((i + 1) / bays) * len - 0.05;
    const [ax, az] = at(s0), [bx, bz] = at(s1);
    const u0 = rand();
    for (const side of [1, -1] as const) {
      const ox = npx * off * side, oz = npz * off * side;
      // counter-clockwise seen from the side the normal points to
      const A = [ax + ox, y0, az + oz], B = [bx + ox, y0, bz + oz], C = [bx + ox, y1, bz + oz], D = [ax + ox, y1, az + oz];
      const ur = (s1 - s0) / 1.9, vr = (y1 - y0) / 2.2, shade = 0.9 + rand() * 0.15;
      if (side === 1) o.shelf.add(A, B, C, D, [npx, 0, npz], ur, vr, u0, shade);
      else o.shelf.add(B, A, D, C, [-npx, 0, -npz], ur, vr, u0, shade);
    }
  }
  // a reading lamp on top of every other row of bays (dim, steady)
  if (len > 3) {
    const [lx, lz] = at(len * 0.5);
    o.lit.add(CYL6, '#1b1d2c', [lx, h + 0.3, lz], [0, 0, 0], [0.02, 0.3, 0.02], NG);
    o.em.add(CYL8, '#9affc0', [lx, h + 0.5, lz], [0, 0, 0], [0.1, 0.07, 0.1], NG);
    o.glows.push({ x: lx, y: h + 0.5, z: lz, size: 1.8, color: '#9affc0', alpha: 0.5, flicker: 0.2, fogFloor: 0.15 });
  }
}

function labBench(o: StyledOut, w: WallDef, rand: () => number): void {
  const { len, rotY, dx, dz, npx, npz } = basis(w);
  const t = Math.max(0.5, w.thickness), h = Math.max(0.8, w.height);
  const at = (s: number): [number, number] => [w.a.x + dx * s, w.a.z + dz * s];
  const [mx, mz] = at(len / 2);
  o.lit.add(BOX, '#2c3a3a', [mx, h * 0.46, mz], [0, rotY, 0], [len - 0.1, h * 0.92, t * 0.86], { gradient: 0.3, jitter: 0.05 }); // cabinet body
  o.lit.add(BOX, '#d8dcd8', [mx, h + 0.03, mz], [0, rotY, 0], [len + 0.1, 0.07, t + 0.12], { gradient: 0 }); // stone top
  const doors = Math.max(1, Math.round(len / 0.9));
  for (let i = 0; i < doors; i++) {
    const [px, pz] = at(((i + 0.5) / doors) * len);
    for (const side of [1, -1]) o.lit.add(BOX, '#24302f', [px + npx * (t * 0.44) * side, h * 0.42, pz + npz * (t * 0.44) * side], [0, rotY, 0], [len / doors - 0.08, h * 0.78, 0.03], { gradient: 0.1 });
  }
  // glassware on top: flasks with glowing contents, a burner, a rack
  const n = Math.max(2, Math.floor(len / 0.8));
  for (let i = 0; i < n; i++) {
    const [px, pz] = at(((i + 0.5) / n) * len);
    const side = rand() < 0.5 ? 1 : -1;
    const bx = px + npx * side * t * 0.15, bz = pz + npz * side * t * 0.15;
    const k = i % 3;
    if (k === 0) {
      o.lit.add(CYL8, '#cfe0e8', [bx, h + 0.2, bz], [0, 0, 0], [0.09, 0.26, 0.09], NG);
      o.em.add(CYL8, i % 2 ? '#8bffb0' : '#c08bff', [bx, h + 0.15, bz], [0, 0, 0], [0.07, 0.15, 0.07], NG);
    } else if (k === 1) {
      o.lit.add(ICO1, '#cfe0e8', [bx, h + 0.15, bz], [0, 0, 0], [0.12, 0.14, 0.12], NG);
      o.em.add(ICO0, '#7bffd0', [bx, h + 0.11, bz], [0, 0, 0], 0.07, NG);
    } else {
      o.lit.add(BOX, '#8a6a3a', [bx, h + 0.14, bz], [0, rotY, 0], [0.4, 0.04, 0.06], NG);
      o.lit.add(CYL6, '#aab0c8', [bx - dx * 0.15, h + 0.07, bz - dz * 0.15], [0, 0, 0], [0.02, 0.14, 0.02], NG);
      o.lit.add(CYL6, '#aab0c8', [bx + dx * 0.15, h + 0.07, bz + dz * 0.15], [0, 0, 0], [0.02, 0.14, 0.02], NG);
    }
  }
  o.glows.push({ x: mx, y: h + 0.3, z: mz, size: Math.min(3, len * 0.8), color: '#7bffb0', alpha: 0.28, flicker: 0.35, fogFloor: 0.05 });
}

// ------------------------------------------------------------------------------------------------ crypt
function rubbleHeap(o: StyledOut, w: WallDef, rand: () => number): void {
  const { len, rotY, dx, dz, npx, npz } = basis(w);
  const t = Math.max(0.8, w.thickness), h = w.height;
  const at = (s: number): [number, number] => [w.a.x + dx * s, w.a.z + dz * s];
  const n = Math.max(3, Math.round(len / 0.9));
  const stones = ['#4a4552', '#58525e', '#3a3642', '#4e4a3a'];
  for (let i = 0; i <= n; i++) {
    const [cx, cz] = at((i / n) * len);
    const peak = h * (0.55 + rand() * 0.45) * (0.7 + 0.3 * Math.sin((i / n) * Math.PI));
    for (let k = 0; k < 2; k++) {
      const side = (rand() - 0.5) * t * 0.55;
      const s = (0.5 + rand() * 0.35) * t;
      const y = peak * (k === 0 ? 0.42 : 0.74);
      o.lit.add(ICO0, stones[Math.floor(rand() * stones.length)], [cx + npx * side, y, cz + npz * side], [rand(), rand() * 6, rand()], [s, peak * (k === 0 ? 0.62 : 0.4), s * 0.9], { gradient: 0.4, jitter: 0.14 });
    }
    if (rand() < 0.35) o.lit.add(BOX, PAL.woodDark, [cx + npx * (rand() - 0.5) * t * 0.4, peak * 0.9, cz + npz * (rand() - 0.5) * t * 0.4], [0.3 + rand() * 0.5, rotY + (rand() - 0.5) * 1.2, 0.4 + rand() * 0.6], [0.09, 1.1, 0.09], NG); // broken beam
    if (rand() < 0.25) o.lit.add(ICO0, '#2c2830', [cx + npx * (t * 0.6 + rand() * 0.3), 0.14, cz + npz * (t * 0.6 + rand() * 0.3)], [rand(), rand() * 6, rand()], [0.3, 0.2, 0.26], { gradient: 0.3 });
  }
  // fine dust pile along the foot
  const [mx, mz] = at(len / 2);
  o.lit.add(ICO1, '#6a5e52', [mx, 0.08, mz], [0, rotY, 0], [len * 0.52, 0.16, t * 0.8], { gradient: 0.2, jitter: 0.05 });
}

function tunnelWall(o: StyledOut, w: WallDef, rand: () => number): void {
  const { len, rotY, dx, dz, npx, npz } = basis(w);
  const t = w.thickness, h = w.height;
  const at = (s: number): [number, number] => [w.a.x + dx * s, w.a.z + dz * s];
  const n = Math.max(1, Math.round(len / 2.4));
  const stone = (): string => PAL.stone[Math.floor(rand() * PAL.stone.length)];
  for (let i = 0; i < n; i++) {
    const s0 = (i / n) * len, s1 = ((i + 1) / n) * len;
    const [cx, cz] = at((s0 + s1) / 2);
    o.lit.add(BOX, stone(), [cx, h / 2, cz], [0, rotY, 0], [s1 - s0 + 0.04, h, t], { gradient: 0.45, jitter: 0.12 });
    // brick courses
    for (let c = 1; c < 4; c++) o.lit.add(BOX, PAL.stoneDark, [cx, (h * c) / 4, cz], [0, rotY, 0], [s1 - s0 + 0.08, 0.05, t + 0.03], NG);
  }
  const [mx, mz] = at(len / 2);
  o.lit.add(BOX, PAL.stoneDark, [mx, 0.25, mz], [0, rotY, 0], [len + t * 0.5, 0.5, t + 0.18], { gradient: 0.2 });
  // timber braces every ~3.5 m: posts on both faces + a cross beam on top
  const nb = Math.max(1, Math.floor(len / 3.5));
  for (let i = 0; i < nb; i++) {
    const [px, pz] = at(((i + 0.5) / nb) * len);
    for (const side of [1, -1]) o.lit.add(BOX, PAL.woodDark, [px + npx * (t / 2 + 0.08) * side, h * 0.5, pz + npz * (t / 2 + 0.08) * side], [0, rotY, 0], [0.22, h, 0.16], { gradient: 0.2, jitter: 0.06 });
    o.lit.add(BOX, PAL.woodDark, [px, h + 0.12, pz], [0, rotY + Math.PI / 2, 0], [t + 0.7, 0.2, 0.22], { gradient: 0.1 });
    if (i % 2 === 0) {
      o.lit.add(BOX, PAL.iron, [px + npx * (t / 2 + 0.2), h * 0.78, pz + npz * (t / 2 + 0.2)], [0, rotY, 0], [0.04, 0.2, 0.04], NG);
      o.em.add(BOX, '#ffb04a', [px + npx * (t / 2 + 0.2), h * 0.66, pz + npz * (t / 2 + 0.2)], [0, rotY, 0], [0.14, 0.2, 0.14], NG);
      o.glows.push({ x: px + npx * (t / 2 + 0.2), y: h * 0.66, z: pz + npz * (t / 2 + 0.2), size: 2.6, color: '#ffb04a', alpha: 0.85, flicker: 0.9, fogFloor: 0.3 });
    }
  }
}

// ------------------------------------------------------------------------------------------------ signal
function patrolFence(o: StyledOut, w: WallDef, rand: () => number): void {
  const { len, rotY, dx, dz, npx, npz } = basis(w);
  const h = Math.max(1.6, w.height);
  const at = (s: number): [number, number] => [w.a.x + dx * s, w.a.z + dz * s];
  const [mx, mz] = at(len / 2);
  const posts = Math.max(2, Math.round(len / 2.2) + 1);
  for (let i = 0; i < posts; i++) {
    const [px, pz] = at((i / (posts - 1)) * len);
    o.lit.add(BOX, '#2c3140', [px, h / 2, pz], [0, rotY, 0], [0.12, h, 0.12], { gradient: 0.2 });
    o.lit.add(BOX, '#2c3140', [px + npx * 0.2, h + 0.05, pz + npz * 0.2], [0.8, rotY, 0], [0.06, 0.5, 0.06], NG); // angled outrigger
  }
  o.lit.add(BOX, '#2c3140', [mx, h, mz], [0, rotY, 0], [len, 0.07, 0.07], NG);
  o.lit.add(BOX, '#2c3140', [mx, h * 0.5, mz], [0, rotY, 0], [len, 0.05, 0.05], NG);
  o.lit.add(BOX, '#2c3140', [mx, 0.08, mz], [0, rotY, 0], [len, 0.14, 0.12], NG);
  // chain-link: a translucent panel (cheap) + diagonal barbed wire along the top
  o.glass.add(BOX, '#aab8c8', [mx, h * 0.52, mz], [0, rotY, 0], [len, h * 0.88, 0.02], NG);
  for (let i = 0; i < posts - 1; i++) {
    const [px, pz] = at(((i + 0.5) / (posts - 1)) * len);
    o.lit.add(BOX, '#6a6f84', [px + npx * 0.2, h + 0.3, pz + npz * 0.2], [0, rotY, 0.4 * (i % 2 ? 1 : -1)], [len / (posts - 1) * 0.95, 0.025, 0.025], NG);
  }
  // red/white warning plate every ~7 m, with a small red lamp that flickers
  const ns = Math.max(1, Math.floor(len / 7));
  for (let i = 0; i < ns; i++) {
    const [px, pz] = at(((i + 0.5) / ns) * len);
    o.lit.add(BOX, '#e8e8f0', [px + npx * 0.09, h * 0.62, pz + npz * 0.09], [0, rotY, 0], [0.6, 0.4, 0.02], NG);
    o.em.add(BOX, '#e04a3a', [px + npx * 0.1, h * 0.62, pz + npz * 0.1], [0, rotY, 0], [0.5, 0.1, 0.012], NG);
    o.em.add(BOX, '#ff3a2a', [px, h + 0.48, pz], [0, rotY, 0], [0.1, 0.1, 0.1], NG);
    o.glows.push({ x: px, y: h + 0.5, z: pz, size: 1.5, color: '#ff4a3a', alpha: 0.6, flicker: 1.0, fogFloor: 0.2 });
  }
  void rand;
}

function concreteBarrier(o: StyledOut, w: WallDef, tall: boolean): void {
  const { len, rotY, dx, dz } = basis(w);
  const t = Math.max(0.5, w.thickness), h = w.height;
  const at = (s: number): [number, number] => [w.a.x + dx * s, w.a.z + dz * s];
  const n = Math.max(1, Math.round(len / 1.4));
  for (let i = 0; i < n; i++) {
    const s0 = (i / n) * len, s1 = ((i + 1) / n) * len;
    const [cx, cz] = at((s0 + s1) / 2);
    const L = s1 - s0 - 0.04;
    o.lit.add(BOX, '#4b5264', [cx, h * 0.3, cz], [0, rotY, 0], [L, h * 0.6, t], { gradient: 0.35, jitter: 0.06 });
    o.lit.add(BOX, '#555d70', [cx, h * 0.75, cz], [0, rotY, 0], [L, h * 0.5, t * 0.62], { gradient: 0.2, jitter: 0.05 });
    // diagonal hazard band: alternating red / white blocks
    o.em.add(BOX, i % 2 ? '#c8c8d0' : '#d8483a', [cx, h * (tall ? 0.78 : 0.52), cz], [0, rotY, 0], [L * 0.92, h * 0.12, t * 0.66], NG);
  }
  if (tall) {
    // guard-hut slit windows glowing cold
    const ns = Math.max(1, Math.floor(len / 3));
    for (let i = 0; i < ns; i++) {
      const [px, pz] = at(((i + 0.5) / ns) * len);
      o.em.add(BOX, '#bfe0ff', [px, h * 0.5, pz], [0, rotY, 0], [0.8, 0.14, t + 0.04], NG);
      o.glows.push({ x: px, y: h * 0.5, z: pz, size: 2.2, color: '#bfe0ff', alpha: 0.35, flicker: 0.9, fogFloor: 0.1 });
    }
  }
}

function vineHedge(o: StyledOut, w: WallDef, rand: () => number): void {
  // a thick hedge wall thick with creeping vines: leaf lumps, dangling tendrils and a few glowing purple buds
  const { len, rotY, dx, dz, npx, npz } = basis(w);
  const t = Math.max(0.8, w.thickness), h = w.height;
  const at = (s: number): [number, number] => [w.a.x + dx * s, w.a.z + dz * s];
  const [mx, mz] = at(len / 2);
  o.lit.add(BOX, '#10281a', [mx, h * 0.4, mz], [0, rotY, 0], [len + t * 0.3, h * 0.8, t * 0.7], { gradient: 0.5, jitter: 0.06 });
  const n = Math.max(2, Math.round(len / (t * 0.8)));
  const cols = ['#1f4a30', '#2a5a3a', '#173a26', '#2f6a42'];
  for (let i = 0; i <= n; i++) {
    const [cx, cz] = at((i / n) * len);
    for (let row = 0; row < 3; row++) {
      const j = (rand() - 0.5) * 0.4;
      const y = h * (0.22 + row * 0.3) + (rand() - 0.5) * 0.15;
      o.lit.add(ICO0, cols[Math.floor(rand() * cols.length)], [cx + npx * j, y, cz + npz * j], [rand(), rand() * 6, rand()], [t * 0.62, h * 0.24, t * 0.62], { gradient: 0.3, jitter: 0.14 });
    }
    if (rand() < 0.5) {
      const side = rand() < 0.5 ? 1 : -1;
      o.lit.add(CYL6, '#1c3a26', [cx + npx * side * (t * 0.45), h * 0.45, cz + npz * side * (t * 0.45)], [0, 0, 0], [0.025, h * 0.8, 0.025], NG);
    }
    if (rand() < 0.28) {
      const side = rand() < 0.5 ? 1 : -1;
      const bx = cx + npx * side * (t * 0.5), bz = cz + npz * side * (t * 0.5), by = h * (0.3 + rand() * 0.5);
      o.em.add(ICO0, rand() < 0.5 ? '#c8a2ff' : '#8bffb0', [bx, by, bz], [0, 0, 0], 0.07, NG);
      if (rand() < 0.4) o.glows.push({ x: bx, y: by, z: bz, size: 1.2, color: '#b8ffc8', alpha: 0.4, flicker: 0.5, fogFloor: 0.05 });
    }
  }
}

// ------------------------------------------------------------------------------------------------ boundary walls (compact maps)
/** The playArea's boundary walls are named like `pa_bound_n` / `cr_border_west` / `ms_perimeter_fence_2`. */
export function isBoundaryId(id: string): boolean { return /bound|bnd|border|perim|edge|limit|outer|enclos/.test(id); }

function ironFence(o: StyledOut, w: WallDef): void {
  const { len, rotY, dx, dz } = basis(w);
  const h = Math.max(1.8, w.height);
  const at = (s: number): [number, number] => [w.a.x + dx * s, w.a.z + dz * s];
  const [mx, mz] = at(len / 2);
  o.lit.add(BOX, PAL.stoneDark, [mx, 0.22, mz], [0, rotY, 0], [len + 0.2, 0.44, Math.max(w.thickness, 0.4)], { gradient: 0.2 });
  const posts = Math.max(2, Math.round(len / 2.2) + 1);
  for (let i = 0; i < posts; i++) {
    const [px, pz] = at((i / (posts - 1)) * len);
    o.lit.add(BOX, PAL.iron, [px, h / 2, pz], [0, rotY, 0], [0.16, h, 0.16], { gradient: 0.2 });
    o.lit.add(CONE4, '#4a5088', [px, h + 0.22, pz], [0, rotY + Math.PI / 4, 0], [0.2, 0.44, 0.2], NG);
  }
  for (const yy of [h * 0.9, h * 0.25]) o.lit.add(BOX, PAL.iron, [mx, yy, mz], [0, rotY, 0], [len, 0.08, 0.08], NG);
  const bars = Math.max(3, Math.round(len / 0.3));
  for (let i = 0; i <= bars; i++) {
    const [px, pz] = at((i / bars) * len);
    o.lit.add(BOX, '#232638', [px, h * 0.55, pz], [0, rotY, 0], [0.035, h * 0.9, 0.035], NG);
    if (i % 2 === 0) o.lit.add(CONE4, '#3a3f5c', [px, h * 1.02, pz], [0, rotY + Math.PI / 4, 0], [0.05, 0.16, 0.05], NG);
  }
}

function gardenWall(o: StyledOut, w: WallDef, rand: () => number): void {
  const { len, rotY, dx, dz, npx, npz } = basis(w);
  const t = Math.max(0.5, w.thickness), h = w.height;
  const at = (s: number): [number, number] => [w.a.x + dx * s, w.a.z + dz * s];
  const n = Math.max(1, Math.round(len / 2.4));
  for (let i = 0; i < n; i++) {
    const s0 = (i / n) * len, s1 = ((i + 1) / n) * len;
    const [cx, cz] = at((s0 + s1) / 2);
    o.lit.add(BOX, PAL.stone[Math.floor(rand() * 3)], [cx, h / 2, cz], [0, rotY, 0], [s1 - s0 + 0.04, h, t], { gradient: 0.45, jitter: 0.12 });
    for (let c = 1; c < 4; c++) o.lit.add(BOX, PAL.stoneDark, [cx, (h * c) / 4, cz], [0, rotY, 0], [s1 - s0 + 0.08, 0.05, t + 0.03], NG);
    if (rand() < 0.5) o.lit.add(ICO0, PAL.moss, [cx + npx * t * 0.45, h * (0.3 + rand() * 0.5), cz + npz * t * 0.45], [rand(), rand() * 6, rand()], [0.4, 0.3, 0.1], { gradient: 0.1 });
  }
  const [mx, mz] = at(len / 2);
  o.lit.add(BOX, '#3b4180', [mx, h + 0.1, mz], [0, rotY, 0], [len + t * 0.6, 0.2, t + 0.22], { gradient: 0 });
}

function rockRow(o: StyledOut, w: WallDef, rand: () => number): void {
  const { len, dx, dz, npx, npz } = basis(w);
  const t = Math.max(1, w.thickness), h = w.height;
  const at = (s: number): [number, number] => [w.a.x + dx * s, w.a.z + dz * s];
  const n = Math.max(3, Math.round(len / (t * 0.7)));
  for (let i = 0; i <= n; i++) {
    const [cx, cz] = at((i / n) * len);
    const s = h * (0.6 + rand() * 0.55);
    const j = (rand() - 0.5) * t * 0.4;
    o.lit.add(ICO0, ['#2c3158', '#363b68', '#262a4e'][Math.floor(rand() * 3)], [cx + npx * j, s * 0.45, cz + npz * j], [rand(), rand() * 6, rand()], [t * (0.55 + rand() * 0.3), s * 0.6, t * (0.55 + rand() * 0.3)], { gradient: 0.5, jitter: 0.14 });
    if (rand() < 0.4) o.lit.add(CONE4, '#363b68', [cx + npx * j, s * 0.95, cz + npz * j], [0, rand() * 6, 0], [t * 0.28, s * 0.55, t * 0.28], { gradient: 0.4 });
  }
}

/** A boundary wall in the case's skin: hedge / rubble / rock / fence / stone by the designer's id words, else by kind. */
function boundaryWall(o: StyledOut, w: WallDef, theme: Theme, rand: () => number): boolean {
  const id = w.id;
  let style: 'hedge' | 'rubble' | 'rock' | 'fence' | 'stone';
  if (/hedge|vine|bush|thicket|bramble/.test(id)) style = 'hedge';
  else if (/rubble|ruin|collapse|debris/.test(id)) style = 'rubble';
  else if (/rock|boulder|cliff|crag/.test(id)) style = 'rock';
  else if (/fence|rail|wire|gate/.test(id)) style = 'fence';
  else style = w.kind === 'hedge' ? 'hedge' : w.kind === 'ruin' ? 'rubble' : w.kind === 'rock' || w.kind === 'cliff' ? 'rock' : w.kind === 'fence' ? 'fence' : 'stone';
  switch (style) {
    case 'hedge': vineHedge(o, w, rand); break;
    case 'rubble': rubbleHeap(o, w, rand); break;
    case 'rock': rockRow(o, w, rand); break;
    case 'fence': if (theme === 'signal') patrolFence(o, w, rand); else ironFence(o, w); break;
    case 'stone': if (theme === 'signal') concreteBarrier(o, w, w.height > 1.5); else gardenWall(o, w, rand); break;
  }
  return true;
}

/** Draws one extra wall in the case's style: first by the designer's id words (shelf / vine / rubble / fence / hut ...), then by kind. */
export function addStyledWall(o: StyledOut, w: WallDef, theme: Theme, rand: () => number): boolean {
  const id = w.id;
  if (isBoundaryId(id) && !/shelf|stack|bookcase/.test(id)) return boundaryWall(o, w, theme, rand);
  if (/shelf|stack|(^|_)rec(_|$)|bookcase/.test(id)) { bookshelfRow(o, w, rand); return true; }
  if (/vine/.test(id)) { vineHedge(o, w, rand); return true; }
  if (/rubble|tunnel/.test(id)) { rubbleHeap(o, w, rand); return true; }
  if (/fence|gate/.test(id)) { patrolFence(o, w, rand); return true; }
  if (/hut/.test(id)) { concreteBarrier(o, w, true); return true; }
  switch (theme) {
    case 'archive':
      if (w.kind === 'hedge' || w.kind === 'cliff' || w.kind === 'rock') return false;
      if (w.height >= 1.6) bookshelfRow(o, w, rand); else labBench(o, w, rand);
      return true;
    case 'crypt':
      if (w.kind === 'ruin' || w.kind === 'rock') rubbleHeap(o, w, rand);
      else if (w.kind === 'stone') tunnelWall(o, w, rand);
      else return false;
      return true;
    case 'signal':
      if (w.kind === 'fence') patrolFence(o, w, rand);
      else if (w.kind === 'stone' || w.kind === 'ruin') concreteBarrier(o, w, w.height > 1.5);
      else return false;
      return true;
  }
}

// ------------------------------------------------------------------------------------------------ styled cover (replaces the shared model)
function serverRackCover(o: StyledOut, c: CoverDef): void {
  const rot = (c.x * 7.1 + c.z * 3.3) % 0.6 - 0.3;
  const s = Math.sin(rot), co = Math.cos(rot);
  const L = (lx: number, lz: number): [number, number] => [c.x + lx * co + lz * s, c.z - lx * s + lz * co];
  const [bx, bz] = L(0, 0);
  o.lit.add(BOX, '#1b1f30', [bx, 1.1, bz], [0, rot, 0], [1.0, 2.2, 0.8], { gradient: 0.25 });
  o.lit.add(BOX, '#2a2d44', [bx, 2.24, bz], [0, rot, 0], [1.06, 0.08, 0.86], NG);
  for (let i = 0; i < 8; i++) {
    const y = 0.25 + i * 0.25;
    const [fx, fz] = L(0, -0.41);
    o.lit.add(BOX, '#10152e', [fx, y, fz], [0, rot, 0], [0.88, 0.19, 0.02], NG);
    for (let k = 0; k < 5; k++) {
      const [lx, lz] = L(-0.34 + k * 0.1, -0.425);
      o.em.add(BOX, (i + k) % 5 === 0 ? '#ff5a4a' : (i * 3 + k) % 3 === 0 ? '#ffd24a' : '#4fe6f2', [lx, y, lz], [0, rot, 0], [0.045, 0.045, 0.01], NG);
    }
  }
  const [gx, gz] = L(0, -0.5);
  o.glows.push({ x: gx, y: 1.3, z: gz, size: 3, color: '#4fe6f2', alpha: 0.32, flicker: 0.6, fogFloor: 0.05 });
}

function boilerCover(o: StyledOut, c: CoverDef): void {
  const r = c.radius * 0.95;
  o.lit.add(CYL8, '#4a3a34', [c.x, 1.0, c.z], [0, 0, 0], [r, 2.0, r], { gradient: 0.35, jitter: 0.05 });
  for (const y of [0.35, 1.0, 1.65]) o.lit.add(CYL8, PAL.iron, [c.x, y, c.z], [0, 0, 0], [r * 1.05, 0.08, r * 1.05], NG);
  o.lit.add(CYL8, '#3a2e2a', [c.x, 2.12, c.z], [0, 0, 0], [r * 0.7, 0.25, r * 0.7], NG);
  o.lit.add(CYL6, '#8a6a3a', [c.x + r * 0.7, 2.2, c.z], [0, 0, 0], [0.07, 0.8, 0.07], NG);
  o.lit.add(CYL6, '#8a6a3a', [c.x + r * 0.7 + 0.25, 2.55, c.z], [0, 0, 1.2], [0.07, 0.6, 0.07], NG);
  o.lit.add(BOX, '#05060f', [c.x, 0.3, c.z - r * 0.97], [0, 0, 0], [0.45, 0.4, 0.04], NG);
  o.em.add(ICO0, '#ffb04a', [c.x, 0.3, c.z - r * 1.0], [0, 0, 0], [0.1, 0.08, 0.03], NG);
  o.em.add(CYL8, '#ffb04a', [c.x - r * 0.4, 1.3, c.z - r * 0.9], [Math.PI / 2, 0, 0], [0.08, 0.03, 0.08], NG);
  o.glows.push({ x: c.x, y: 0.4, z: c.z - r * 1.1, size: 2.2, color: '#ff8a3a', alpha: 0.6, flicker: 0.9, fogFloor: 0.1 });
}

function stillCover(o: StyledOut, c: CoverDef, rand: () => number): void {
  // smashed distillation column: copper coil, cracked glass tube, leaking glow
  o.lit.add(CYL8, '#3a3d52', [c.x, 0.15, c.z], [0, 0, 0], [0.55, 0.3, 0.55], NG);
  o.lit.add(CYL8, '#cfe0e8', [c.x, 1.2, c.z], [0, 0, 0.08], [0.2, 2.2, 0.2], NG);
  o.em.add(CYL8, '#7bffb0', [c.x, 0.7, c.z], [0, 0, 0.08], [0.15, 1.1, 0.15], NG);
  for (let i = 0; i < 5; i++) o.lit.add(TORUS_LITE, '#b87333', [c.x, 0.5 + i * 0.32, c.z], [Math.PI / 2, 0, 0], [0.32, 0.32, 0.32], NG);
  for (let i = 0; i < 5; i++) o.em.add(ICO0, '#bfe8f2', [c.x + 0.4 + rand() * 0.5, 0.03, c.z + (rand() - 0.5) * 0.8], [rand(), rand() * 6, rand()], [0.07, 0.015, 0.05], NG);
  o.glows.push({ x: c.x, y: 1.0, z: c.z, size: 2.4, color: '#7bffb0', alpha: 0.45, flicker: 0.5, fogFloor: 0.05 });
}

function benchCover(o: StyledOut, c: CoverDef, rand: () => number): void {
  const rot = (c.x * 5.3 + c.z * 1.7) % 0.8 - 0.4;
  o.lit.add(BOX, '#2c3a3a', [c.x, 0.42, c.z], [0, rot, 0], [1.5, 0.84, 0.7], { gradient: 0.3 });
  o.lit.add(BOX, '#d8dcd8', [c.x, 0.88, c.z], [0, rot, 0], [1.6, 0.06, 0.8], NG);
  for (let i = 0; i < 4; i++) {
    const lx = (i - 1.5) * 0.36, s = Math.sin(rot), co = Math.cos(rot);
    const x = c.x + lx * co, z = c.z - lx * s;
    if (i % 2 === 0) { o.lit.add(CYL8, '#cfe0e8', [x, 1.05, z], [0, 0, 0], [0.09, 0.26, 0.09], NG); o.em.add(CYL8, i === 0 ? '#c08bff' : '#7bffb0', [x, 1.0, z], [0, 0, 0], [0.07, 0.15, 0.07], NG); }
    else o.lit.add(ICO1, '#cfe0e8', [x, 1.02, z], [0, 0, 0], [0.12, 0.13, 0.12], NG);
  }
  o.em.add(ICO0, '#bfe8f2', [c.x + 0.9, 0.03, c.z - 0.2], [0, 0, 0], [0.09, 0.015, 0.06], NG);
  void rand;
}

function centrifugeCover(o: StyledOut, c: CoverDef): void {
  const r = c.radius * 0.9;
  o.lit.add(CYL12, '#3a3f58', [c.x, 0.45, c.z], [0, 0, 0], [r, 0.9, r], { gradient: 0.3 });
  o.lit.add(CYL12, '#232638', [c.x, 0.95, c.z], [0, 0, 0], [r * 1.05, 0.1, r * 1.05], NG);
  o.lit.add(CYL12, '#8a8f9c', [c.x, 1.12, c.z], [0, 0, 0.12], [r * 0.8, 0.14, r * 0.8], NG); // lid hanging off
  o.em.add(ICO0, '#ff4a4a', [c.x + r * 0.6, 0.7, c.z - r * 0.7], [0, 0, 0], 0.045, NG);
  o.em.add(CYL12, '#7bffb0', [c.x, 0.96, c.z], [0, 0, 0], [r * 0.6, 0.02, r * 0.6], NG);
  o.glows.push({ x: c.x, y: 1.1, z: c.z, size: 1.8, color: '#7bffb0', alpha: 0.4, flicker: 0.6, fogFloor: 0.05 });
}

function coffinCover(o: StyledOut, c: CoverDef, rand: () => number): void {
  const rot = (c.x * 3.7 + c.z * 2.1) % 3.14;
  const L = c.radius * 1.9, W = c.radius * 0.95;
  o.lit.add(BOX, '#3a2a22', [c.x, 0.3, c.z], [0, rot, 0], [W, 0.55, L], { gradient: 0.35, jitter: 0.06 });
  o.lit.add(BOX, '#4a3428', [c.x + 0.1, 0.62, c.z], [0, rot + 0.12, 0.05], [W * 1.05, 0.12, L * 0.62], { gradient: 0 });
  o.lit.add(BOX, '#05060f', [c.x - 0.05, 0.585, c.z], [0, rot, 0], [W * 0.7, 0.02, L * 0.9], NG);
  o.lit.add(BOX, '#6a5a3a', [c.x + 0.1, 0.7, c.z], [0, rot + 0.12, 0], [0.06, 0.02, L * 0.32], NG);
  o.lit.add(BOX, '#6a5a3a', [c.x + 0.1, 0.7, c.z - L * 0.1], [0, rot + 0.12, 0], [W * 0.5, 0.02, 0.06], NG);
  void rand;
}

/** Replaces the shared cover model for the case's special pieces (server racks, boilers, lab gear, coffins). Returns true when drawn. */
export function addCoverStyled(o: StyledOut, c: CoverDef, theme: Theme, rand: () => number): boolean {
  void theme;
  if (/rack/.test(c.id)) { serverRackCover(o, c); return true; }
  if (/boiler/.test(c.id)) { boilerCover(o, c); return true; }
  if (/still/.test(c.id)) { stillCover(o, c, rand); return true; }
  if (/bench/.test(c.id)) { benchCover(o, c, rand); return true; }
  if (/centrifuge/.test(c.id)) { centrifugeCover(o, c); return true; }
  if (/coffin/.test(c.id)) { coffinCover(o, c, rand); return true; }
  return false;
}

/** Accent pieces on top of the shared cover model for the case's own extra cover. */
export function addCoverAccent(o: StyledOut, c: CoverDef, theme: Theme, rand: () => number): void {
  const r = c.radius;
  const H = c.height === 'high' ? 2.5 : 1.0;
  if (c.kind === 'crate') {
    const s = r * 1.55;
    if (theme === 'signal') {
      o.lit.add(BOX, '#3c4a3a', [c.x, H / 2, c.z], [0, 0.25, 0], [s * 1.02, H * 0.98, s * 1.02], { gradient: 0.3 });
      o.em.add(BOX, '#e8c84a', [c.x, H * 0.55, c.z], [0, 0.25, 0], [s * 1.06, 0.07, s * 1.06], NG);
      o.em.add(BOX, '#7bffb0', [c.x + Math.sin(0.25) * s * 0.52, H * 0.85, c.z + Math.cos(0.25) * s * 0.52], [0, 0.25, 0], [0.12, 0.06, 0.03], NG);
    } else if (theme === 'archive') {
      for (let i = 0; i < 5; i++) o.lit.add(BOX, ['#6b2a3a', '#2e4a6b', '#4a6b3a', '#6b5a2a', '#4a2f6b'][i], [c.x + (rand() - 0.5) * s * 0.5, H + 0.07 + (i % 2) * 0.12, c.z + (rand() - 0.5) * s * 0.5], [0, rand() * 3, 0], [0.34, 0.1, 0.24], { gradient: 0.1 });
    } else {
      o.lit.add(ICO0, '#8a7a4a', [c.x, H + 0.04, c.z], [0, rand() * 3, 0], [s * 0.4, 0.1, s * 0.35], { gradient: 0.1 });
    }
  } else if (c.kind === 'barrel') {
    const rr = r * 0.95;
    if (theme === 'signal') o.em.add(CYL8, '#d8483a', [c.x, H * 0.5, c.z], [0, 0, 0], [rr * 1.02, 0.1, rr * 1.02], NG);
    else if (theme === 'archive') {
      o.em.add(CYL8, '#7bffb0', [c.x, H * 0.5, c.z], [0, 0, 0], [rr * 1.02, 0.12, rr * 1.02], NG);
      o.glows.push({ x: c.x, y: H * 0.55, z: c.z, size: 1.5, color: '#7bffb0', alpha: 0.35, flicker: 0.5, fogFloor: 0.05 });
    } else o.lit.add(CYL8, '#1b1620', [c.x, H + 0.01, c.z], [0, 0, 0], [rr * 0.9, 0.03, rr * 0.9], NG);
  } else if (c.kind === 'pillar' && theme === 'crypt') {
    o.lit.add(BOX, PAL.woodDark, [c.x, H * 0.8, c.z], [0, rand() * 3, 0], [r * 2.4, 0.18, 0.2], NG);
  }
  void CONE4;
}
