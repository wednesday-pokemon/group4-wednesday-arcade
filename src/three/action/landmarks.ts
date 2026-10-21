// Landmark models (all original gothic/ruin silhouettes): Nevermore-inspired academy, start dock, Raven Island + dock,
// lighthouse, wreck, bell buoy, crypt, shrine, Iago tower. Each is authored in local space (front = -Z) and merged.
import * as THREE from 'three';
import type { CourseDef, Landmark } from '../../action/types.ts';
import { MeshBuilder, hashString, mulberry32 } from '../util.ts';
import type { GlowEntry } from './fx.ts';
import { bearing, mergeAll, place, pointInPoly } from './geom.ts';
import type { Spot } from './landBuilder.ts';

const BOX = new THREE.BoxGeometry(1, 1, 1);
const CYL8 = new THREE.CylinderGeometry(1, 1, 1, 8, 1);
const CYL6 = new THREE.CylinderGeometry(1, 1, 1, 6, 1);
const CONE4 = new THREE.ConeGeometry(1, 1, 4, 1);
const CONE6 = new THREE.ConeGeometry(1, 1, 6, 1);
const CONE8 = new THREE.ConeGeometry(1, 1, 8, 1);
const ICO = new THREE.IcosahedronGeometry(1, 0);
/** Triangular prism, ridge along X, base at y = 0, apex at y = 1, unit width/depth. */
const PRISM = (() => {
  const s = new THREE.Shape();
  s.moveTo(-0.5, 0); s.lineTo(0.5, 0); s.lineTo(0, 1); s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: 1, bevelEnabled: false });
  g.translate(0, 0, -0.5);
  g.rotateY(Math.PI / 2);
  return g;
})();

const STONE = ['#272c55', '#2d3262', '#222750'];
const STONE_DARK = '#171b3a';
const ROOF = '#141833';
const WOOD = '#4a3224';
const WOOD_DARK = '#33221a';
const WIN = ['#f5b04c', '#f5b04c', '#ffd68a', '#f5b04c', '#b79cff'];

export interface LandmarkBuild {
  lit: THREE.BufferGeometry | null;
  emissive: THREE.BufferGeometry | null;
  lights: GlowEntry[];
  beams: { x: number; y: number; z: number; len: number; width: number; speed: number; phase: number; color: string }[];
  foamRings: { x: number; z: number; r: number }[];
  trees: Spot[];
  /** World-space spots where the boat is meant to dock / start (for debugging). */
  points: Record<string, { x: number; z: number }>;
}

class Ctx {
  readonly lit: MeshBuilder;
  readonly em: MeshBuilder;
  readonly lights: GlowEntry[] = [];
  readonly beams: LandmarkBuild['beams'] = [];
  readonly foamRings: { x: number; z: number; r: number }[] = [];
  readonly trees: Spot[] = [];
  constructor(readonly rand: () => number) {
    this.lit = new MeshBuilder(rand);
    this.em = new MeshBuilder(rand);
  }
  stone(): string {
    return STONE[Math.floor(this.rand() * STONE.length)];
  }
  box(x: number, y: number, z: number, w: number, h: number, d: number, color: string, rot: [number, number, number] = [0, 0, 0], g = 0.3): void {
    this.lit.add(BOX, color, [x, y, z], rot, [w, h, d], { gradient: g });
  }
  /** pointed-arch window (emissive) facing -Z at local position; yaw rotates it around the building. */
  win(x: number, y: number, z: number, w: number, h: number, yaw = 0, glow = 0.35): void {
    const col = WIN[Math.floor(this.rand() * WIN.length)];
    const s = Math.sin(yaw), c = Math.cos(yaw);
    const px = (lx: number, lz: number) => x + lx * c + lz * s;
    const pz = (lx: number, lz: number) => z - lx * s + lz * c;
    this.em.add(BOX, col, [px(0, 0), y, pz(0, 0)], [0, yaw, 0], [w, h, 0.25], { jitter: 0, gradient: 0 });
    this.em.add(CONE4, col, [px(0, 0), y + h / 2 + w * 0.42, pz(0, 0)], [0, yaw + Math.PI / 4, 0], [w * 0.72, w * 0.85, w * 0.72], { jitter: 0, gradient: 0 });
    if (this.rand() < glow) this.lights.push({ x, y, z, size: Math.max(2.2, h * 2.4), color: col, alpha: 0.55, flicker: 0.35, fogFloor: 0.25 });
  }
  lantern(x: number, y: number, z: number, size = 3, color = '#f5b04c', alpha = 0.95): void {
    this.em.add(BOX, color, [x, y, z], [0, 0, 0], [0.34, 0.44, 0.34], { jitter: 0, gradient: 0 });
    this.lights.push({ x, y, z, size, color, alpha, flicker: 0.6, fogFloor: 0.12 });
  }
  roof(x: number, y: number, z: number, w: number, h: number, d: number, yaw = 0): void {
    this.lit.add(PRISM, ROOF, [x, y, z], [0, yaw, 0], [w, h, d], { gradient: 0.25 });
  }
  /** Round tower with cone roof and N rows of windows around it. */
  tower(x: number, z: number, r: number, h: number, y0 = 0, rows = 3, windowsPerRow = 3, roofMul = 2.2, wallYaw = 0): void {
    this.lit.add(CYL8, this.stone(), [x, y0 + h / 2, z], [0, 0.4, 0], [r, h, r], { gradient: 0.45, jitter: 0.12 });
    this.lit.add(CYL8, STONE_DARK, [x, y0 + h + 0.35, z], [0, 0.4, 0], [r * 1.18, 0.7, r * 1.18], { gradient: 0 });
    this.lit.add(CONE8, ROOF, [x, y0 + h + r * roofMul * 0.5 + 0.6, z], [0, 0.4, 0], [r * 1.25, r * roofMul, r * 1.25], { gradient: 0.15 });
    this.lit.add(CYL6, STONE_DARK, [x, y0 + h + r * roofMul + 1.6, z], [0, 0, 0], [0.12, 2.4, 0.12], { gradient: 0 });
    for (let k = 0; k < rows; k++) {
      const yy = y0 + h * (0.35 + (0.5 * k) / Math.max(1, rows - 1 || 1));
      for (let j = 0; j < windowsPerRow; j++) {
        const a = wallYaw + ((j + 0.5) / windowsPerRow - 0.5) * 2.4 + (k % 2) * 0.35 - Math.PI * 0 ;
        // windows sit on the -Z hemisphere of the tower
        const ang = Math.PI + a;
        if (this.rand() < 0.22) continue;
        this.win(x + Math.sin(ang) * (r + 0.05), yy, z + Math.cos(ang) * (r + 0.05), 0.9, 2.0, ang + Math.PI, 0.25);
      }
    }
  }
}

function finish(ctx: Ctx, x: number, z: number, yaw: number, scale: number, y = 0): LandmarkBuild {
  const tf = (lx: number, ly: number, lz: number): [number, number, number] => {
    const s = Math.sin(yaw), c = Math.cos(yaw);
    return [x + (lx * c + lz * s) * scale, y + ly * scale, z + (-lx * s + lz * c) * scale];
  };
  const lit = ctx.lit.build();
  const em = ctx.em.build();
  if (lit.getAttribute('position')) place(lit, x, y, z, yaw, scale);
  if (em.getAttribute('position')) place(em, x, y, z, yaw, scale);
  const lights = ctx.lights.map((l) => {
    const [wx, wy, wz] = tf(l.x, l.y, l.z);
    return { ...l, x: wx, y: wy, z: wz, size: l.size * scale, sy: l.sy ? l.sy * scale : undefined };
  });
  const beams = ctx.beams.map((b) => {
    const [wx, wy, wz] = tf(b.x, b.y, b.z);
    return { ...b, x: wx, y: wy, z: wz, len: b.len * scale, width: b.width * scale };
  });
  const foamRings = ctx.foamRings.map((f) => {
    const [wx, , wz] = tf(f.x, 0, f.z);
    return { x: wx, z: wz, r: f.r * scale };
  });
  const trees = ctx.trees.map((t) => {
    const [wx, wy, wz] = tf(t.x, t.y, t.z);
    return { ...t, x: wx, y: wy, z: wz, s: t.s * scale * 0.8 };
  });
  return { lit: lit.getAttribute('position') ? lit : null, emissive: em.getAttribute('position') ? em : null, lights, beams, foamRings, trees, points: {} };
}

// ------------------------------------------------------------------------------------------------- academy
function academy(ctx: Ctx): void {
  const { rand } = ctx;
  // rocky plinth the school stands on
  ctx.lit.add(ICO, '#1a1f40', [0, 2, 8], [0, 0.3, 0], [70, 12, 34], { gradient: 0.6, jitter: 0.14 });
  for (let i = 0; i < 9; i++) {
    const x = -58 + i * 14.5 + (rand() - 0.5) * 6;
    ctx.lit.add(ICO, ctx.stone(), [x, 1.5, -18 - rand() * 6], [rand(), rand() * 6, rand()], [9 + rand() * 6, 5 + rand() * 5, 6 + rand() * 4], { gradient: 0.55, jitter: 0.14 });
  }
  const gy = 9; // ground level of the building
  // central great hall
  ctx.box(0, gy + 9, 0, 34, 18, 20, ctx.stone());
  ctx.roof(0, gy + 18, 0, 36, 13, 22);
  ctx.box(0, gy + 6, -10.4, 5, 12, 1.5, STONE_DARK); // porch block
  for (let i = -3; i <= 3; i++) ctx.box(i * 5.2, gy + 9, -10.6, 1.2, 18, 1.3, '#1d2147'); // buttress ribs
  // great pointed window + rose
  ctx.em.add(BOX, '#ffcf80', [0, gy + 11, -10.95], [0, 0, 0], [3.4, 8.5, 0.3], { jitter: 0, gradient: 0 });
  ctx.em.add(CONE4, '#ffcf80', [0, gy + 17.6, -10.95], [0, Math.PI / 4, 0], [2.6, 5.5, 0.4], { jitter: 0, gradient: 0 });
  ctx.em.add(CYL8, '#f5b04c', [0, gy + 20.5, -10.95], [Math.PI / 2, 0, 0], [1.9, 0.3, 1.9], { jitter: 0, gradient: 0 });
  ctx.lights.push({ x: 0, y: gy + 12, z: -11.5, size: 22, color: '#ffbf66', alpha: 0.5, flicker: 0.15, fogFloor: 0.5 });
  ctx.lights.push({ x: 0, y: gy + 20.5, z: -11.5, size: 9, color: '#ffbf66', alpha: 0.6, flicker: 0.2, fogFloor: 0.5 });
  for (const sx of [-1, 1]) for (let k = 0; k < 2; k++) {
    for (let j = 0; j < 3; j++) ctx.win(sx * (9 + j * 3.6), gy + 5 + k * 6.5, -10.5, 1.2, 3.0, 0, 0.3);
  }
  // wings
  for (const sx of [-1, 1]) {
    const wx = sx * 30;
    ctx.box(wx, gy + 7, 3, 26, 14, 16, ctx.stone());
    ctx.roof(wx, gy + 14, 3, 28, 9, 17);
    for (let r = 0; r < 2; r++) for (let c = 0; c < 6; c++) ctx.win(wx - 10 + c * 4, gy + 4.5 + r * 5.2, -5.2, 1.0, 2.6, 0, 0.18);
    ctx.box(wx + sx * 6, gy + 15 + 4, 8, 2.4, 6, 2.4, STONE_DARK); // chimney
  }
  // towers (round, varied heights) + one tall bell/clock tower at the back
  ctx.tower(-18, -9, 4.2, 30, gy, 3, 3, 2.6);
  ctx.tower(18, -9, 4.2, 36, gy, 4, 3, 2.6);
  ctx.tower(-47, -2, 4.6, 24, gy, 3, 3, 2.4);
  ctx.tower(49, -2, 4.4, 28, gy, 3, 3, 2.4);
  ctx.tower(-38, 14, 3.4, 40, gy, 3, 2, 3.0);
  ctx.tower(40, 15, 3.8, 34, gy, 3, 2, 2.8);
  // bell / clock tower
  ctx.box(0, gy + 28, 6, 8, 38, 8, ctx.stone(), [0, 0, 0], 0.5);
  ctx.lit.add(CONE4, ROOF, [0, gy + 47 + 7, 6], [0, Math.PI / 4, 0], [6.4, 18, 6.4], { gradient: 0.2 });
  ctx.lit.add(CYL6, STONE_DARK, [0, gy + 47 + 17, 6], [0, 0, 0], [0.18, 6, 0.18], { gradient: 0 });
  ctx.em.add(CYL8, '#ffe0a0', [0, gy + 38, 1.8], [Math.PI / 2, 0, 0], [2.6, 0.3, 2.6], { jitter: 0, gradient: 0 }); // clock face
  ctx.lights.push({ x: 0, y: gy + 38, z: 1.2, size: 11, color: '#ffd890', alpha: 0.7, flicker: 0.1, fogFloor: 0.5 });
  ctx.win(0, gy + 30, 1.9, 1.2, 3.2, Math.PI, 0.9);
  // gatehouse + pier arch
  ctx.box(0, gy + 3.5, -17, 10, 7, 5, STONE_DARK);
  ctx.em.add(BOX, '#f5b04c', [0, gy + 2.6, -19.6], [0, 0, 0], [3, 4.4, 0.25], { jitter: 0, gradient: 0 });
  ctx.lights.push({ x: 0, y: gy + 3, z: -20.5, size: 9, color: '#f5b04c', alpha: 0.7, flicker: 0.4, fogFloor: 0.4 });
  // crenellated curtain wall linking towers
  ctx.box(0, gy + 3, -24, 100, 6, 2, STONE_DARK, [0, 0, 0], 0.2);
  for (let i = -24; i <= 24; i++) ctx.box(i * 2, gy + 6.9, -24, 1, 1.4, 2, STONE_DARK, [0, 0, 0], 0);
  for (let i = -3; i <= 3; i++) ctx.lantern(i * 14, gy + 7.6, -25.2, 2.4, '#f5b04c', 0.7);
  // a few flying crows' perches: spiky finials
  for (let i = 0; i < 10; i++) {
    const x = -50 + i * 11;
    ctx.lit.add(CONE4, ROOF, [x, gy + 15.5 + (i % 3) * 2, -14], [0, 0, 0], [0.5, 3.5, 0.5], { gradient: 0 });
  }
  for (let i = 0; i < 5; i++) {
    const x = -44 + rand() * 88;
    ctx.trees.push({ x, y: 4, z: -26 - rand() * 8, s: 1.1 + rand() * 0.8, rot: rand() * 6 });
  }
}

// ------------------------------------------------------------------------------------------------- docks
function pier(ctx: Ctx, len: number, wid: number, lanternEvery: number, big: boolean, zc = 0): void {
  const half = len / 2;
  const n = Math.round(len / 1.6);
  for (let i = 0; i < n; i++) {
    const z = -half + (i + 0.5) * (len / n);
    ctx.lit.add(BOX, i % 2 ? '#5a3d2a' : '#664630', [0, 0.55, z + zc], [0, 0, (ctx.rand() - 0.5) * 0.01], [wid, 0.18, len / n - 0.08], { gradient: 0.1, jitter: 0.14 });
  }
  for (const s of [-1, 1]) ctx.box(s * (wid / 2 - 0.1), 0.2, zc, 0.35, 0.5, len, WOOD_DARK);
  for (let i = 0; i <= Math.round(len / 3.5); i++) {
    const z = -half + (i / Math.round(len / 3.5)) * len;
    for (const s of [-1, 1]) ctx.lit.add(CYL6, WOOD_DARK, [s * (wid / 2 + 0.1), -0.5, z + zc], [0, 0, 0], [0.22, 3.0, 0.22], { gradient: 0.2 });
  }
  // lantern posts
  const count = Math.max(2, Math.round(len / lanternEvery));
  for (let i = 0; i <= count; i++) {
    const z = -half + 0.6 + (i / count) * (len - 1.2);
    for (const s of [-1, 1]) {
      ctx.box(s * (wid / 2 - 0.05), 1.9, z + zc, 0.22, 2.7, 0.22, WOOD_DARK);
      ctx.lantern(s * (wid / 2 - 0.05), 3.4, z + zc, big ? 4.0 : 3.2);
    }
  }
}

function startDock(ctx: Ctx, causeway = 0): void {
  // local: tip at z = -9, shore end at z = +9 (+ `causeway` of jetty out to a distant shore, with the boathouse at its landward end)
  pier(ctx, 18, 3.8, 6, false);
  ctx.foamRings.push({ x: 0, z: -4, r: 0 });
  const zo = causeway;
  if (causeway > 2) pier(ctx, causeway, 3.0, 11, false, 9 + causeway / 2);
  // boathouse at the shore end
  ctx.box(0, 2.6, 13 + zo, 9, 5.2, 8, WOOD, [0, 0, 0], 0.4);
  ctx.roof(0, 5.2, 13 + zo, 10.4, 3.6, 9);
  ctx.win(-2.3, 3.0, 8.9 + zo, 0.9, 1.6, 0, 0.9);
  ctx.win(2.3, 3.0, 8.9 + zo, 0.9, 1.6, 0, 0.9);
  ctx.em.add(BOX, '#f5b04c', [0, 2.0, 8.95 + zo], [0, 0, 0], [1.6, 3.0, 0.2], { jitter: 0, gradient: 0 });
  // tip: two tall banner poles with pennants + the big hanging lantern (recognisable silhouette)
  for (const s of [-1, 1]) {
    ctx.box(s * 1.6, 3.8, -8.7, 0.18, 6.4, 0.18, WOOD_DARK);
    ctx.lit.add(PRISM, s < 0 ? '#5b3aa0' : '#3b2a70', [s * 1.6 + s * 0.9, 6.0, -8.7], [0, 0, Math.PI / 2], [1.5, 1.8, 0.05], { gradient: 0 });
  }
  ctx.box(0, 5.8, -8.9, 3.2, 0.18, 0.18, WOOD_DARK);
  ctx.lantern(0, 5.2, -8.9, 6.2, '#ffb347', 1.0);
  // tied rowboat, crates and barrels
  ctx.lit.add(PRISM, '#4d3425', [3.6, 0.15, -2], [Math.PI, 0, 0], [1.5, 0.9, 3.6], { gradient: 0.1 });
  ctx.box(-1.2, 1.0, 5, 1, 1, 1, '#5e4230');
  ctx.box(-1.3, 2.0, 5, 0.9, 0.9, 0.9, '#6a4a35');
  ctx.lit.add(CYL8, '#3a2a1f', [1.2, 1.1, 6], [0, 0, 0], [0.6, 1.1, 0.6], { gradient: 0.2 });
}

function ravenDock(ctx: Ctx): void {
  pier(ctx, 26, 5, 5.5, true);
  // gate arch at the shore end
  for (const s of [-1, 1]) {
    ctx.box(s * 3.3, 4.6, 12, 1.6, 8, 1.6, ctx.stone());
    ctx.lit.add(CONE4, ROOF, [s * 3.3, 9.9, 12], [0, Math.PI / 4, 0], [1.4, 3, 1.4], { gradient: 0 });
    ctx.lantern(s * 3.3, 8.2, 11.0, 5, '#b79cff', 0.9);
  }
  ctx.box(0, 8.5, 12, 8.4, 1.6, 1.6, STONE_DARK);
  ctx.lit.add(PRISM, ROOF, [0, 9.3, 12], [0, 0, 0], [8.6, 3.2, 1.8], { gradient: 0 });
  // braziers at the tip
  for (const s of [-1, 1]) {
    ctx.lit.add(CYL6, STONE_DARK, [s * 2.9, 1.5, -12.4], [0, 0, 0], [0.5, 2.2, 0.5], { gradient: 0.2 });
    ctx.lit.add(CYL8, STONE_DARK, [s * 2.9, 2.8, -12.4], [0, 0, 0], [0.9, 0.5, 0.9], { gradient: 0 });
    ctx.em.add(CONE6, '#ff9a3a', [s * 2.9, 3.6, -12.4], [0, 0, 0], [0.6, 1.4, 0.6], { jitter: 0, gradient: 0 });
    ctx.lights.push({ x: s * 2.9, y: 3.8, z: -12.4, size: 7, color: '#ff9a3a', alpha: 0.85, flicker: 0.9, fogFloor: 0.25 });
  }
  // mooring bollards
  for (let i = 0; i < 4; i++) for (const s of [-1, 1]) ctx.lit.add(CYL6, STONE_DARK, [s * 2.7, 1.0, -8 + i * 5], [0, 0, 0], [0.25, 0.9, 0.25], { gradient: 0 });
}

// ------------------------------------------------------------------------------------------------- Raven Island
function ravenIsland(ctx: Ctx): void {
  const { rand } = ctx;
  const rock = ['#1b2046', '#222855', '#171b3d'];
  // jagged rock mass
  ctx.lit.add(ICO, rock[0], [0, 4, 0], [0, 0.4, 0], [66, 14, 44], { gradient: 0.6, jitter: 0.12 });
  ctx.lit.add(ICO, rock[1], [-6, 18, 4], [0.1, 0.9, 0], [44, 20, 32], { gradient: 0.6, jitter: 0.14 });
  ctx.lit.add(ICO, rock[2], [4, 36, 4], [0, 0.2, 0.1], [24, 22, 20], { gradient: 0.6, jitter: 0.14 });
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * Math.PI * 2;
    const r = 30 + rand() * 16;
    ctx.lit.add(ICO, rock[i % 3], [Math.cos(a) * r, 2 + rand() * 5, Math.sin(a) * r * 0.7], [rand(), rand() * 6, rand()], [7 + rand() * 8, 4 + rand() * 8, 6 + rand() * 7], { gradient: 0.55, jitter: 0.14 });
  }
  // spires of rock
  for (const [x, z, h] of [[-26, 6, 28], [30, 8, 24], [18, -10, 34]] as const) ctx.lit.add(CONE6, rock[1], [x, h / 2, z], [0, rand() * 6, 0], [7, h, 7], { gradient: 0.6, jitter: 0.12 });
  // ruined keep on top: broken towers, a gate and a lit crypt door facing the water
  const top = 52;
  ctx.box(0, top + 7, 0, 18, 14, 12, ctx.stone());
  ctx.roof(0, top + 14, 0, 20, 7, 13);
  ctx.tower(-12, -2, 3.6, 22, top - 4, 3, 3, 2.4);
  ctx.tower(13, 1, 3.2, 28, top - 4, 3, 3, 2.6);
  ctx.lit.add(CYL8, ctx.stone(), [4, top + 8, -7], [0, 0, 0], [2.8, 16, 2.8], { gradient: 0.4 }); // broken stump (no roof)
  ctx.lit.add(CONE4, STONE_DARK, [3.6, top + 17.8, -7], [0.15, 0.4, 0.2], [1.5, 3, 1.5], { gradient: 0 });
  for (let r = 0; r < 3; r++) for (let c = 0; c < 4; c++) if (rand() < 0.8) ctx.win(-6 + c * 4, top + 4 + r * 3.6, -6.2, 1.0, 2.4, 0, 0.4);
  // crypt door
  ctx.box(0, 4.5, -29, 9, 9, 3, STONE_DARK);
  ctx.em.add(BOX, '#7be8ff', [0, 3.8, -30.6], [0, 0, 0], [3.2, 5.8, 0.3], { jitter: 0, gradient: 0 });
  ctx.em.add(CONE4, '#7be8ff', [0, 7.5, -30.6], [0, Math.PI / 4, 0], [2.4, 3, 0.4], { jitter: 0, gradient: 0 });
  ctx.lights.push({ x: 0, y: 4.6, z: -31.5, size: 15, color: '#6fe0ff', alpha: 0.55, flicker: 0.5, fogFloor: 0.35 });
  // beacon on the highest spire
  ctx.lit.add(CYL6, STONE_DARK, [4, top + 32, 4], [0, 0, 0], [0.3, 12, 0.3], { gradient: 0 });
  ctx.em.add(ICO, '#ff5a3a', [4, top + 38.6, 4], [0, 0, 0], 0.9, { jitter: 0, gradient: 0 });
  ctx.lights.push({ x: 4, y: top + 38.6, z: 4, size: 26, color: '#ff6a40', alpha: 0.9, flicker: 0.5, fogFloor: 0.9 });
  ctx.beams.push({ x: 4, y: top + 38.6, z: 4, len: 90, width: 9, speed: 0.35, phase: 1.1, color: '#ff7a50' });
  // lights along the cliffs
  for (let i = 0; i < 9; i++) {
    const a = Math.PI + (rand() - 0.5) * 2.2;
    const r = 26 + rand() * 12;
    ctx.lantern(Math.cos(a) * r * 0.8, 3 + rand() * 12, Math.sin(a) * r * 0.55 - 8, 4 + rand() * 2, i % 3 === 0 ? '#b79cff' : '#f5b04c', 0.7);
  }
  // dead trees on the slopes
  for (let i = 0; i < 12; i++) {
    const a = rand() * Math.PI * 2;
    const r = 8 + rand() * 20;
    ctx.trees.push({ x: Math.cos(a) * r, y: 14 + rand() * 12, z: Math.sin(a) * r * 0.7 - 4, s: 1.8 + rand() * 1.2, rot: rand() * 6.28 });
  }
}

// ------------------------------------------------------------------------------------------------- small landmarks
function lighthouse(ctx: Ctx): void {
  ctx.lit.add(ICO, '#1c2146', [0, 0.5, 0], [0, 0.4, 0], [10, 4.5, 10], { gradient: 0.5, jitter: 0.14 });
  ctx.foamRings.push({ x: 0, z: 0, r: 8.5 });
  for (let i = 0; i < 6; i++) {
    const y0 = 3 + i * 4.2;
    const r0 = 3.4 - i * 0.2;
    ctx.lit.add(CYL8, i % 2 ? '#6d2b4a' : '#b8bce0', [0, y0 + 2.1, 0], [0, 0, 0], [r0, 4.3, r0], { gradient: 0.35 });
  }
  ctx.lit.add(CYL8, STONE_DARK, [0, 28.6, 0], [0, 0, 0], [3.4, 0.7, 3.4], { gradient: 0 });
  ctx.em.add(CYL8, '#ffe9b0', [0, 30.3, 0], [0, 0, 0], [1.9, 2.6, 1.9], { jitter: 0, gradient: 0 });
  ctx.lit.add(CONE8, ROOF, [0, 33.8, 0], [0, 0, 0], [2.7, 4.2, 2.7], { gradient: 0 });
  ctx.lights.push({ x: 0, y: 30.3, z: 0, size: 18, color: '#ffe9b0', alpha: 0.9, flicker: 0.1, fogFloor: 0.8 });
  ctx.beams.push({ x: 0, y: 30.3, z: 0, len: 150, width: 16, speed: 0.55, phase: 0, color: '#ffe3a0' });
  ctx.beams.push({ x: 0, y: 30.3, z: 0, len: 150, width: 16, speed: 0.55, phase: Math.PI, color: '#ffe3a0' });
}

function wreck(ctx: Ctx): void {
  const { rand } = ctx;
  ctx.lit.add(ICO, '#1a1f40', [0, -0.2, 0], [0, 0.2, 0], [9, 1.6, 6], { gradient: 0.5, jitter: 0.14 });
  ctx.foamRings.push({ x: 0, z: 0, r: 9 });
  // hull ribs and planking of a sunken schooner, listing to one side
  for (let i = 0; i < 7; i++) {
    const z = -5 + i * 1.7;
    const w = 2.6 - Math.abs(i - 3) * 0.28;
    for (const s of [-1, 1]) ctx.lit.add(BOX, WOOD_DARK, [s * w * 0.9, 1.3, z], [0, 0, s * 0.45], [0.16, 3.2, 0.2], { gradient: 0.2 });
  }
  ctx.lit.add(BOX, WOOD, [-1.9, 0.9, 0], [0, 0, 0.5], [0.2, 2.2, 11], { gradient: 0.2 });
  ctx.lit.add(BOX, WOOD, [1.9, 0.5, 0.5], [0, 0, -0.5], [0.2, 1.4, 9], { gradient: 0.2 });
  ctx.lit.add(BOX, '#3d291d', [0, 0.1, 0], [0, 0, 0], [3.6, 0.2, 10], { gradient: 0 });
  // broken mast + torn sail
  ctx.lit.add(CYL6, WOOD_DARK, [0.3, 5, 0.5], [0.12, 0, 0.18], [0.22, 10, 0.22], { gradient: 0.2 });
  ctx.lit.add(BOX, WOOD_DARK, [1.4, 7.5, 0.6], [0, 0, 0.1], [4.6, 0.14, 0.14], { gradient: 0 });
  ctx.lit.add(PRISM, '#1d2040', [1.0, 6.6, 0.6], [Math.PI, 0, 0.12], [3.2, 3.2, 0.05], { gradient: 0 });
  ctx.em.add(BOX, '#7be8d0', [-1.7, 3.3, -3], [0, 0, 0], [0.3, 0.4, 0.3], { jitter: 0, gradient: 0 });
  ctx.lights.push({ x: -1.7, y: 3.3, z: -3, size: 6, color: '#6fe8d0', alpha: 0.7, flicker: 0.8, fogFloor: 0.2 });
  void rand;
}

function bellBuoy(ctx: Ctx): void {
  ctx.lit.add(CYL8, '#8c2c36', [0, 0.55, 0], [0, 0, 0], [0.9, 1.1, 0.9], { gradient: 0.3 });
  ctx.lit.add(CYL8, '#e8dcc0', [0, 1.05, 0], [0, 0, 0], [0.92, 0.2, 0.92], { gradient: 0 });
  for (const [x, z] of [[-0.6, -0.6], [0.6, -0.6], [-0.6, 0.6], [0.6, 0.6]] as const) ctx.box(x, 2.1, z, 0.1, 2.0, 0.1, WOOD_DARK);
  ctx.lit.add(CONE8, '#9a7d3a', [0, 2.3, 0], [Math.PI, 0, 0], [0.45, 0.8, 0.45], { gradient: 0 });
  ctx.lit.add(CONE4, ROOF, [0, 3.5, 0], [0, 0.8, 0], [1.0, 0.8, 1.0], { gradient: 0 });
  ctx.em.add(BOX, '#ff6a50', [0, 3.2, 0], [0, 0, 0], [0.3, 0.3, 0.3], { jitter: 0, gradient: 0 });
  ctx.lights.push({ x: 0, y: 3.2, z: 0, size: 6.5, color: '#ff6a50', alpha: 0.95, flicker: 1.0, fogFloor: 0.5 });
  ctx.foamRings.push({ x: 0, z: 0, r: 2.4 });
}

function crypt(ctx: Ctx): void {
  ctx.lit.add(ICO, '#1a1f40', [0, 1, 0], [0, 0.4, 0], [14, 4, 12], { gradient: 0.5, jitter: 0.14 });
  ctx.box(0, 5, 0, 8, 6, 7, ctx.stone());
  ctx.roof(0, 8, 0, 9, 3.6, 8);
  ctx.em.add(BOX, '#7be8ff', [0, 3.6, -3.7], [0, 0, 0], [2.2, 3.6, 0.25], { jitter: 0, gradient: 0 });
  ctx.lights.push({ x: 0, y: 3.8, z: -4.4, size: 9, color: '#6fe0ff', alpha: 0.6, flicker: 0.6, fogFloor: 0.3 });
  for (const s of [-1, 1]) ctx.lit.add(CYL6, STONE_DARK, [s * 3.8, 3.5, -3.8], [0, 0, 0], [0.45, 5, 0.45], { gradient: 0.2 });
  ctx.foamRings.push({ x: 0, z: 0, r: 9 });
}

function shrine(ctx: Ctx): void {
  ctx.lit.add(ICO, '#1a1f40', [0, 0.4, 0], [0, 0.2, 0], [5, 1.6, 5], { gradient: 0.5 });
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    ctx.lit.add(BOX, ctx.stone(), [Math.cos(a) * 3.2, 2, Math.sin(a) * 3.2], [0, a, 0], [0.7, 4 - (i % 2), 0.7], { gradient: 0.3 });
  }
  ctx.lantern(0, 2.6, 0, 7, '#8ae6ff', 0.95);
  ctx.foamRings.push({ x: 0, z: 0, r: 5.5 });
}

function iagoTower(ctx: Ctx): void {
  ctx.lit.add(ICO, '#1a1f40', [0, 3, 0], [0, 0.2, 0], [16, 8, 14], { gradient: 0.55, jitter: 0.14 });
  ctx.lit.add(CYL8, ctx.stone(), [0, 36, 0], [0, 0, 0], [5.4, 68, 5.4], { gradient: 0.5 });
  ctx.lit.add(CYL8, STONE_DARK, [0, 71, 0], [0, 0, 0], [7, 4, 7], { gradient: 0 });
  ctx.lit.add(CONE8, ROOF, [0, 81, 0], [0, 0, 0], [6, 16, 6], { gradient: 0.1 });
  ctx.em.add(BOX, '#ff9a3a', [0, 66, -5.6], [0, 0, 0], [3, 4, 0.3], { jitter: 0, gradient: 0 });
  ctx.lights.push({ x: 0, y: 66, z: -6.5, size: 22, color: '#ff8a3a', alpha: 0.85, flicker: 0.4, fogFloor: 0.8 });
  for (let k = 0; k < 6; k++) ctx.win(0, 14 + k * 8, -5.5, 0.9, 2.4, Math.PI * 0, 0.4);
  ctx.foamRings.push({ x: 0, z: 0, r: 15 });
}

/** Distance from the dock's landward end to the nearest land behind it (0 when the dock already touches the shore). */
function jettyLength(course: CourseDef, lm: Landmark, yaw: number): number {
  const sc = lm.scale > 0 ? lm.scale : 1;
  const bx = Math.sin(yaw), bz = Math.cos(yaw); // local +Z in world space
  for (let d = 10; d < 140; d += 1) {
    const x = lm.x + bx * d * sc, z = lm.z + bz * d * sc;
    if ((course.land ?? []).some((l) => pointInPoly(l.points, x, z))) return d > 14 ? Math.max(0, d - 10) : 0;
  }
  return 0;
}

// ------------------------------------------------------------------------------------------------- dispatcher
export function buildLandmarks(course: CourseDef, lowGraphics: boolean): LandmarkBuild {
  const lits: (THREE.BufferGeometry | null)[] = [];
  const ems: (THREE.BufferGeometry | null)[] = [];
  const out: LandmarkBuild = { lit: null, emissive: null, lights: [], beams: [], foamRings: [], trees: [], points: {} };
  const centre = { x: (course.start.x + course.finish.x) / 2, z: (course.start.z + course.finish.z) / 2 };
  const fwd = { x: -Math.sin(course.start.heading), z: -Math.cos(course.start.heading) };
  for (const lm of course.landmarks ?? []) {
    const ctx = new Ctx(mulberry32(hashString(lm.id) ^ 0x51ed));
    let yaw = lm.rotation;
    let yOffset = 0;
    switch (lm.kind) {
      case 'nevermore_academy': academy(ctx); yaw = bearing(lm.x, lm.z, course.start.x + fwd.x * 40, course.start.z + fwd.z * 40); break;
      case 'start_dock': {
        yaw = bearing(lm.x, lm.z, course.start.x + fwd.x * 40, course.start.z + fwd.z * 40);
        startDock(ctx, jettyLength(course, lm, yaw));
        break;
      }
      case 'raven_dock': ravenDock(ctx); yaw = bearing(lm.x, lm.z, course.start.x, course.start.z); break;
      case 'raven_island': ravenIsland(ctx); yaw = bearing(lm.x, lm.z, centre.x, centre.z + 60); break;
      case 'lighthouse': lighthouse(ctx); break;
      case 'wreck': wreck(ctx); break;
      case 'bell_buoy': bellBuoy(ctx); break;
      case 'crypt': crypt(ctx); break;
      case 'shrine': shrine(ctx); break;
      case 'iago_tower': iagoTower(ctx); break;
    }
    const b = finish(ctx, lm.x, lm.z, yaw, lm.scale > 0 ? lm.scale : 1, yOffset);
    lits.push(b.lit);
    ems.push(b.emissive);
    out.lights.push(...b.lights);
    out.beams.push(...b.beams);
    out.foamRings.push(...b.foamRings);
    out.trees.push(...(lowGraphics ? b.trees.slice(0, 4) : b.trees));
    out.points[lm.id] = { x: lm.x, z: lm.z };
    yOffset = 0;
  }
  out.lit = mergeAll(lits);
  out.emissive = mergeAll(ems);
  return out;
}

export type { Landmark };
