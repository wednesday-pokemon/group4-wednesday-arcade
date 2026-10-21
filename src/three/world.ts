// Static environment: merged low-poly geometry per leg + one shared glow-emitter set.
// Everything here is built once; leg changes only toggle group visibility / uniforms.
import * as THREE from 'three';
import type { LegIndex } from './types.ts';
import { COL } from './palette.ts';
import { CORRIDOR_END, CORRIDOR_START, SAFE_HALF_WIDTH, SHORTCUT_X, TRACK_LEN } from './layout.ts';
import { MeshBuilder, mulberry32 } from './util.ts';

/** Bit mask helpers for glow emitters: which legs they are visible in. */
export const LEG_BIT: Record<LegIndex, number> = { 1: 1, 2: 2, 3: 4 };
export const ALL_LEGS = 7;
/** Glow groups: 0 general, 1 safe channel markers, 2 shortcut corridor markers. */
export const GROUP_SAFE = 1;
export const GROUP_SHORT = 2;

class GlowSet {
  pos: number[] = [];
  color: number[] = [];
  size: number[] = [];
  phase: number[] = [];
  mask: number[] = [];
  group: number[] = [];
  constructor(private readonly rand: () => number) {}
  add(x: number, y: number, z: number, hex: string, size: number, mask = ALL_LEGS, group = 0): void {
    // store sRGB-ish values (the glow shader outputs directly without colour management)
    const n = parseInt(hex.replace('#', ''), 16);
    this.pos.push(x, y, z);
    this.color.push(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
    this.size.push(size);
    this.phase.push(this.rand());
    this.mask.push(mask);
    this.group.push(group);
  }
  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('aColor', new THREE.Float32BufferAttribute(this.color, 3));
    g.setAttribute('aSize', new THREE.Float32BufferAttribute(this.size, 1));
    g.setAttribute('aPhase', new THREE.Float32BufferAttribute(this.phase, 1));
    g.setAttribute('aMask', new THREE.Float32BufferAttribute(this.mask, 1));
    g.setAttribute('aGroup', new THREE.Float32BufferAttribute(this.group, 1));
    g.computeBoundingSphere();
    if (g.boundingSphere) g.boundingSphere.radius = 1e5; // never frustum-cull (shader moves nothing but sizes vary)
    return g;
  }
}

export interface LegScenery {
  lit: THREE.BufferGeometry;
  emissive: THREE.BufferGeometry;
}

export interface WorldGeometry {
  shared: LegScenery;
  legs: Record<LegIndex, LegScenery>;
  glows: THREE.BufferGeometry;
  bannerPos: THREE.Vector3;
  finishGlowPos: THREE.Vector3;
  /** per-leg end point (where sparkles / gate are) */
  gateZ: number;
}

// shared unit primitives (cloned by MeshBuilder; never rendered themselves)
const BOX = new THREE.BoxGeometry(1, 1, 1);
const CYL8 = new THREE.CylinderGeometry(1, 1, 1, 8, 1);
const CYL6 = new THREE.CylinderGeometry(1, 1, 1, 6, 1);
const CONE4 = new THREE.ConeGeometry(1, 1, 4, 1);
const CONE6 = new THREE.ConeGeometry(1, 1, 6, 1);
const CONE8 = new THREE.ConeGeometry(1, 1, 8, 1);
const ICO0 = new THREE.IcosahedronGeometry(1, 0);
const ICO1 = new THREE.IcosahedronGeometry(1, 1);

const STONES = ['#343a72', '#3d4482', '#2e3468', '#454d8c'];
const ISLAND = ['#1d2148', '#262b58', '#191c3d'];

function pick<T>(rand: () => number, arr: readonly T[]): T {
  return arr[Math.floor(rand() * arr.length) % arr.length];
}

function rock(b: MeshBuilder, rand: () => number, x: number, z: number, size: number, tall = 1, colors: readonly string[] = STONES): void {
  b.add(
    ICO0,
    pick(rand, colors),
    [x, size * tall * 0.35 - 0.2, z],
    [rand() * 3, rand() * 6, rand() * 3],
    [size * (0.9 + rand() * 0.5), size * tall, size * (0.9 + rand() * 0.5)],
    { jitter: 0.14, gradient: 0.45 },
  );
}

function arch(
  b: MeshBuilder,
  cx: number,
  cz: number,
  halfSpan: number,
  height: number,
  axis: 'x' | 'z',
  opts: { color?: string; brokenSide?: -1 | 1 | 0; thickness?: number; depth?: number } = {},
): void {
  const col = opts.color ?? '#3b4175';
  const th = opts.thickness ?? 1.0;
  const depth = opts.depth ?? 1.3;
  const broken = opts.brokenSide ?? 0;
  const pillarH = height * 0.62;
  const R = halfSpan;
  const place = (u: number, y: number): [number, number, number] => (axis === 'x' ? [cx + u, y, cz] : [cx, y, cz + u]);
  for (const side of [-1, 1] as const) {
    const h = broken === side ? pillarH * 0.4 : pillarH;
    const pos = place(side * R, h / 2);
    b.add(BOX, col, pos, [0, 0, 0], axis === 'x' ? [th, h, depth] : [depth, h, th], { jitter: 0.1 });
    // plinth
    b.add(BOX, '#2a2e58', place(side * R, 0.25), [0, 0, 0], axis === 'x' ? [th * 1.4, 0.5, depth * 1.2] : [depth * 1.2, 0.5, th * 1.4]);
  }
  const segs = 9;
  for (let i = 0; i < segs; i++) {
    const a0 = Math.PI - (i / segs) * Math.PI;
    const a1 = Math.PI - ((i + 1) / segs) * Math.PI;
    const am = (a0 + a1) / 2;
    const u = Math.cos(am) * R;
    const y = pillarH + Math.sin(am) * (height - pillarH);
    // broken side: keep a contiguous run of stones springing from the intact pillar (no floating blocks)
    if (broken === 1 && i > 5) continue;
    if (broken === -1 && i < 3) continue;
    const len = (Math.PI / segs) * R * 1.15 + 0.2;
    const rotZ = am - Math.PI / 2;
    const rot: [number, number, number] = axis === 'x' ? [0, 0, rotZ] : [rotZ, Math.PI / 2, 0];
    b.add(BOX, col, place(u, y), rot, axis === 'x' ? [len, th, depth] : [depth, th, len], { jitter: 0.12 });
  }
}

function lanternPost(
  lit: MeshBuilder,
  emi: MeshBuilder,
  glows: GlowSet,
  x: number,
  z: number,
  h: number,
  hex: string,
  mask: number,
  group: number,
  glowSize = 3.2,
): void {
  lit.add(CYL6, COL.woodDark, [x, h / 2, z], [0, 0, 0], [0.07, h, 0.07]);
  lit.add(CONE4, '#1d1a30', [x, h + 0.55, z], [0, Math.PI / 4, 0], [0.34, 0.3, 0.34]);
  emi.add(BOX, hex, [x, h + 0.2, z], [0, 0, 0], [0.3, 0.38, 0.3], { jitter: 0, gradient: 0 });
  glows.add(x, h + 0.2, z, hex, glowSize, mask, group);
}

function buoy(lit: MeshBuilder, emi: MeshBuilder, glows: GlowSet, x: number, z: number, rand: () => number): void {
  lit.add(CYL8, '#7a2c3e', [x, 0.05, z], [0, 0, 0], [0.5, 0.55, 0.5]);
  lit.add(CYL8, '#e6dcc4', [x, 0.28, z], [0, 0, 0], [0.52, 0.12, 0.52], { gradient: 0 });
  lit.add(CYL6, COL.woodDark, [x, 0.95, z], [0, 0, 0], [0.05, 1.5, 0.05]);
  lit.add(CONE4, '#1d1a30', [x, 2.0, z], [0, Math.PI / 4, 0], [0.32, 0.28, 0.32]);
  emi.add(BOX, COL.lantern, [x, 1.65, z], [0, 0, 0], [0.3, 0.36, 0.3], { jitter: 0, gradient: 0 });
  glows.add(x, 1.65, z, COL.lantern, 3.6 + rand() * 0.6, ALL_LEGS, GROUP_SAFE);
}

function mausoleum(b: MeshBuilder, emi: MeshBuilder, glows: GlowSet, x: number, z: number, s: number, rand: () => number, mask: number): void {
  const w = 5 * s;
  const h = 4.2 * s;
  b.add(BOX, pick(rand, ISLAND), [x, h / 2, z], [0, 0, 0], [w, h, w * 0.9], { jitter: 0.06 });
  b.add(CONE4, '#14173a', [x, h + 1.4 * s, z], [0, Math.PI / 4, 0], [w * 0.78, 2.8 * s, w * 0.68]);
  b.add(BOX, '#262b58', [x, 0.3, z], [0, 0, 0], [w * 1.2, 0.6, w * 1.1]);
  // pillars flanking the door
  b.add(CYL6, '#3b4175', [x - w * 0.32, h * 0.5, z + w * 0.46], [0, 0, 0], [0.28 * s, h, 0.28 * s]);
  b.add(CYL6, '#3b4175', [x + w * 0.32, h * 0.5, z + w * 0.46], [0, 0, 0], [0.28 * s, h, 0.28 * s]);
  emi.add(BOX, COL.lantern, [x, h * 0.36, z + w * 0.46], [0, 0, 0], [0.9 * s, 1.6 * s, 0.1], { jitter: 0, gradient: 0 });
  glows.add(x, h * 0.4, z + w * 0.5, COL.lantern, 4.5 * s, mask, 0);
  // cross on top
  b.add(BOX, '#3b4175', [x, h + 3.3 * s, z], [0, 0, 0], [0.18 * s, 1.2 * s, 0.18 * s]);
  b.add(BOX, '#3b4175', [x, h + 3.5 * s, z], [0, 0, 0], [0.7 * s, 0.16 * s, 0.16 * s]);
}

function gravestone(b: MeshBuilder, rand: () => number, x: number, z: number, s = 1): void {
  const h = (0.9 + rand() * 0.8) * s;
  b.add(BOX, '#4a5088', [x, h / 2, z], [0, rand() * 0.6 - 0.3, (rand() - 0.5) * 0.25], [0.7 * s, h, 0.22 * s], { jitter: 0.1 });
  b.add(CYL8, '#4a5088', [x, h, z], [Math.PI / 2, rand() * 0.6 - 0.3, 0], [0.35 * s, 0.22 * s, 0.35 * s]);
}

function tower(
  b: MeshBuilder,
  emi: MeshBuilder,
  glows: GlowSet,
  rand: () => number,
  x: number,
  baseY: number,
  z: number,
  r: number,
  h: number,
  facing: number,
): void {
  const stone = pick(rand, ['#2a2f62', '#323872', '#262a55']);
  b.add(CYL8, stone, [x, baseY + h / 2, z], [0, rand() * 3, 0], [r, h, r]);
  // battlement ring
  b.add(CYL8, '#1e2250', [x, baseY + h + 0.4, z], [0, 0, 0], [r * 1.18, 0.9, r * 1.18]);
  // spire
  b.add(CONE8, rand() > 0.5 ? '#15183c' : '#2c2466', [x, baseY + h + 0.9 + r * 1.5, z], [0, 0, 0], [r * 1.05, r * 3.0, r * 1.05], { gradient: 0.2 });
  // windows (pointed arch look: tall thin box) facing the track (+x) for readable lit windows
  const nWin = 2 + Math.floor(rand() * 3);
  for (let i = 0; i < nWin; i++) {
    const y = baseY + h * (0.35 + 0.6 * (i / nWin));
    const wx = x + Math.cos(facing) * r * 1.0 + (rand() - 0.5) * 0.4;
    const wz = z + Math.sin(facing) * r * 1.0 + (rand() - 0.5) * r * 0.8;
    emi.add(BOX, rand() > 0.3 ? COL.lantern : '#ffd89a', [wx, y, wz], [0, 0, 0], [0.5, 1.1, 0.5], { jitter: 0, gradient: 0 });
    glows.add(wx + 0.5, y, wz, COL.lantern, 3.0 + rand() * 1.5, ALL_LEGS, 0);
  }
}

function buildIsland(lit: MeshBuilder, emi: MeshBuilder, glows: GlowSet, rand: () => number): void {
  // Ridge of low hills along the far (-x) side of the course
  for (let z = -10; z > -TRACK_LEN - 40; z -= 34) {
    const h = 9 + rand() * 9;
    const r = 26 + rand() * 14;
    lit.add(ICO1, pick(rand, ISLAND), [-118 + rand() * 12, h * 0.15 - 2, z + rand() * 10], [0, rand() * 6, 0], [r, h, r * 0.9], { jitter: 0.1, gradient: 0.55 });
  }
  // Land at the end of the course (backdrop for the dock)
  for (let x = -90; x <= 90; x += 36) {
    const h = 12 + rand() * 12;
    lit.add(ICO1, pick(rand, ISLAND), [x + rand() * 12, h * 0.15 - 2, -TRACK_LEN - 100 - rand() * 16], [0, rand() * 6, 0], [34 + rand() * 12, h, 30], { jitter: 0.1, gradient: 0.55 });
  }
  // Castle on the ridge: keep + towers + curtain walls
  const kx = -104;
  const kz = -150;
  const ky = 6;
  lit.add(BOX, '#2a2f62', [kx, ky + 9, kz], [0, 0.3, 0], [14, 18, 12], { jitter: 0.06 });
  lit.add(BOX, '#232750', [kx, ky + 19.2, kz], [0, 0.3, 0], [15.4, 1.6, 13.4]);
  lit.add(CONE4, '#15183c', [kx, ky + 26, kz], [0, 0.3 + Math.PI / 4, 0], [10.5, 12, 9], { gradient: 0.2 });
  tower(lit, emi, glows, rand, kx + 11, ky, kz - 5, 3.2, 24, 0);
  tower(lit, emi, glows, rand, kx + 12, ky, kz + 8, 2.6, 18, 0);
  tower(lit, emi, glows, rand, kx - 10, ky, kz - 7, 3, 21, 0);
  tower(lit, emi, glows, rand, kx - 9, ky, kz + 9, 2.4, 15, 0);
  for (let i = 0; i < 5; i++) {
    const wy = ky + 4 + i * 3.2;
    emi.add(BOX, COL.lantern, [kx + 7.1, wy, kz - 4 + (i % 3) * 3.5], [0, 0, 0], [0.4, 1.3, 0.8], { jitter: 0, gradient: 0 });
    glows.add(kx + 7.6, wy, kz - 4 + (i % 3) * 3.5, COL.lantern, 3.6, ALL_LEGS, 0);
  }
  // second smaller manor/chapel further down the ridge
  const cx = -112;
  const cz = -228;
  lit.add(BOX, '#2a2f62', [cx, 8, cz], [0, 0, 0], [10, 10, 16]);
  lit.add(CONE4, '#15183c', [cx, 15.5, cz], [0, Math.PI / 4, 0], [9, 7, 12.6]);
  tower(lit, emi, glows, rand, cx + 6, 3, cz - 6, 2.4, 19, 0);
  tower(lit, emi, glows, rand, cx + 6, 3, cz + 7, 1.9, 13, 0);
  // backdrop towers behind the dock
  tower(lit, emi, glows, rand, -30, 3, -TRACK_LEN - 98, 3.6, 24, Math.PI / 2);
  tower(lit, emi, glows, rand, 6, 3, -TRACK_LEN - 108, 4.4, 30, Math.PI / 2);
  tower(lit, emi, glows, rand, 44, 3, -TRACK_LEN - 96, 3.2, 20, Math.PI / 2);
  lit.add(BOX, '#2a2f62', [0, 10, -TRACK_LEN - 112], [0, 0, 0], [60, 14, 12]);
  // dead trees on the ridge
  for (let i = 0; i < 16; i++) {
    const tx = -90 - rand() * 28;
    const tz = -20 - rand() * (TRACK_LEN - 20);
    const th = 4 + rand() * 4;
    lit.add(CYL6, '#12142f', [tx, th / 2 + 4, tz], [0, 0, (rand() - 0.5) * 0.3], [0.18, th, 0.18]);
    lit.add(CONE6, '#12142f', [tx + 0.6, th + 5.5, tz], [0, 0, -0.6], [0.14, 2.2, 0.14]);
    lit.add(CONE6, '#12142f', [tx - 0.6, th + 4.8, tz], [0, 0, 0.6], [0.14, 1.9, 0.14]);
  }
}

function buildShared(lit: MeshBuilder, emi: MeshBuilder, glows: GlowSet, rand: () => number): void {
  // Safe channel lantern buoys
  for (let z = -4; z > -TRACK_LEN - 6; z -= 10) {
    buoy(lit, emi, glows, -SAFE_HALF_WIDTH + (rand() - 0.5) * 0.8, z, rand);
    buoy(lit, emi, glows, SAFE_HALF_WIDTH + (rand() - 0.5) * 0.8, z - 5, rand);
  }
  // Shortcut corridor: tall rock walls, lower on the near (+x, camera) side so the boat stays visible
  const z0 = -TRACK_LEN * CORRIDOR_START;
  const z1 = -TRACK_LEN * CORRIDOR_END;
  for (let z = z0 + 2; z > z1 - 4; z -= 3.6 + rand() * 1.4) {
    rock(lit, rand, SHORTCUT_X - 5.0 - rand() * 0.8, z, 1.8 + rand() * 1.2, 1.0 + rand() * 0.6);
    if (rand() > 0.3) rock(lit, rand, SHORTCUT_X + 4.2 + rand() * 0.8, z - 1.5, 0.8 + rand() * 0.5, 0.5 + rand() * 0.3);
  }
  // second row behind the far wall + entrance / exit markers
  for (let z = z0; z > z1; z -= 9) {
    rock(lit, rand, SHORTCUT_X - 9 - rand() * 3, z, 3 + rand() * 2.5, 1.4 + rand());
  }
  for (let z = z0 + 6; z > z1 - 6; z -= 12) {
    lanternPost(lit, emi, glows, SHORTCUT_X - 3.6, z, 3.3 + rand() * 1.2, '#b79cff', ALL_LEGS, GROUP_SHORT, 3.4);
    lanternPost(lit, emi, glows, SHORTCUT_X + 3.5, z - 5, 1.9, '#9ef1ff', ALL_LEGS, GROUP_SHORT, 2.6);
  }
  // entrance lanterns
  lanternPost(lit, emi, glows, SHORTCUT_X - 3, z0 + 12, 2.6, '#b79cff', ALL_LEGS, GROUP_SHORT, 4);
  lanternPost(lit, emi, glows, SHORTCUT_X + 3, z0 + 12, 1.8, '#b79cff', ALL_LEGS, GROUP_SHORT, 4);
  // scattered sea stacks away from the camera sweep zones
  for (let i = 0; i < 26; i++) {
    const left = rand() > 0.35;
    const x = left ? -(34 + rand() * 40) : 38 + rand() * 40;
    rock(lit, rand, x, 10 - rand() * (TRACK_LEN + 30), 2 + rand() * 4, 0.8 + rand() * 1.6);
  }
  buildIsland(lit, emi, glows, rand);
}

function buildLeg1(lit: MeshBuilder, emi: MeshBuilder, glows: GlowSet, rand: () => number): void {
  const m = LEG_BIT[1];
  // reed bundles along the channel margins
  for (let z = 6; z > -TRACK_LEN - 20; z -= 6 + rand() * 6) {
    for (const side of [-1, 1]) {
      const x = side * (13 + rand() * 12);
      for (let k = 0; k < 4; k++) {
        const h = 1.6 + rand() * 1.4;
        lit.add(CONE4, '#25385a', [x + (rand() - 0.5) * 1.4, h / 2 - 0.1, z + (rand() - 0.5) * 1.4], [(rand() - 0.5) * 0.3, 0, (rand() - 0.5) * 0.3], [0.1, h, 0.1], { gradient: 0.2 });
      }
    }
  }
  // stakes with swamp-lanterns
  for (let z = -22; z > -TRACK_LEN; z -= 34) {
    lanternPost(lit, emi, glows, -13 - rand() * 4, z + 8, 2.4, '#c8ffd9', m, 0, 3.4);
    lanternPost(lit, emi, glows, -16 - rand() * 4, z - 12, 2.8, '#c8ffd9', m, 0, 3.4);
  }
  // half-sunk wreck silhouette
  lit.add(BOX, COL.woodDark, [-22, 0.1, -80], [0.1, 0.4, 0.5], [1.8, 1.0, 5]);
  lit.add(CYL6, COL.woodDark, [-22.5, 2.2, -78], [0, 0, 0.12], [0.08, 4.4, 0.08]);
  // end gate: two tall lantern posts + rope
  const gz = -TRACK_LEN - 3;
  for (const s of [-1, 1]) {
    lit.add(CYL6, COL.wood, [s * 8.5, 3.2, gz], [0, 0, 0], [0.22, 6.4, 0.22]);
    lit.add(CONE4, '#1d1a30', [s * 8.5, 6.9, gz], [0, Math.PI / 4, 0], [0.7, 0.7, 0.7]);
    emi.add(BOX, COL.lantern, [s * 8.5, 6.2, gz], [0, 0, 0], [0.7, 0.9, 0.7], { jitter: 0, gradient: 0 });
    glows.add(s * 8.5, 6.2, gz, COL.lantern, 6, m, 0);
  }
  lit.add(BOX, '#6b4a30', [0, 5.4, gz], [0, 0, 0], [17, 0.1, 0.1]);
}

function buildLeg2(lit: MeshBuilder, emi: MeshBuilder, glows: GlowSet, rand: () => number): void {
  const m = LEG_BIT[2];
  const z0 = -TRACK_LEN * CORRIDOR_START;
  const z1 = -TRACK_LEN * CORRIDOR_END;
  // arches over the shortcut corridor (the near pillar is often ruined so the camera keeps a view)
  for (let z = z0 - 4; z > z1 + 4; z -= 17) {
    arch(lit, SHORTCUT_X, z, 3.9, 9.4, 'x', { brokenSide: 1, color: '#444b8a' });
    // hanging lantern under each arch
    lit.add(CYL6, COL.woodDark, [SHORTCUT_X, 8.3, z], [0, 0, 0], [0.025, 1.2, 0.025]);
    emi.add(BOX, COL.lantern, [SHORTCUT_X, 7.2, z], [0, 0, 0], [0.34, 0.44, 0.34], { jitter: 0, gradient: 0 });
    glows.add(SHORTCUT_X, 7.2, z, COL.lantern, 4.8, m, GROUP_SHORT);
  }
  // freestanding ruined arches beside the safe channel (far side only)
  for (const z of [-22, -218]) {
    arch(lit, -14, z, 3.4, 8.2, 'z', { brokenSide: z > -100 ? 1 : -1, color: '#444b8a' });
    emi.add(BOX, COL.lantern, [-14, 4.2, z], [0, 0, 0], [0.3, 0.4, 0.3], { jitter: 0, gradient: 0 });
    glows.add(-14, 4.2, z, COL.lantern, 3.6, m, 0);
  }
  // crypt row on the island shore + gravestone islets
  for (let i = 0; i < 7; i++) {
    const z = -20 - i * 34 - rand() * 10;
    mausoleum(lit, emi, glows, -78 - rand() * 12, z, 1.1 + rand() * 0.7, rand, m);
  }
  for (let i = 0; i < 6; i++) {
    const x = i % 2 === 0 ? -34 - rand() * 12 : 36 + rand() * 10;
    const z = -30 - i * 34 - rand() * 10;
    lit.add(ICO0, '#1d2148', [x, 0, z], [0, rand() * 3, 0], [4.5, 1.6, 4], { gradient: 0.5 });
    for (let k = 0; k < 4; k++) gravestone(lit, rand, x + (rand() - 0.5) * 4, z + (rand() - 0.5) * 3);
  }
  // end gate: big stone arch across the safe channel's end
  const gz = -TRACK_LEN - 3;
  arch(lit, 0, gz, 11, 15, 'x', { color: '#3f4579', thickness: 1.5, depth: 1.8 });
  emi.add(BOX, COL.lantern, [0, 10.4, gz + 0.2], [0, 0, 0], [0.5, 0.7, 0.5], { jitter: 0, gradient: 0 });
  glows.add(0, 10.4, gz + 0.2, COL.lantern, 6, m, 0);
  for (const s of [-1, 1]) glows.add(s * 11, 6.0, gz + 1, COL.lantern, 5, m, 0);
}

function buildLeg3(lit: MeshBuilder, emi: MeshBuilder, glows: GlowSet): { bannerPos: THREE.Vector3 } {
  const m = LEG_BIT[3];
  const gz = -TRACK_LEN - 6;
  // wooden dock: deck, planks, posts, lanterns
  lit.add(BOX, '#4a3326', [0, 0.55, gz - 14], [0, 0, 0], [40, 0.35, 28], { jitter: 0.04, gradient: 0.1 });
  for (let i = 0; i < 14; i++) {
    lit.add(BOX, i % 2 ? '#5a3d2c' : '#6a4630', [0, 0.75, gz - 1 - i * 2], [0, 0, 0], [39.5, 0.06, 1.85], { jitter: 0.06, gradient: 0 });
  }
  for (let x = -19; x <= 19; x += 4.75) {
    lit.add(CYL6, COL.woodDark, [x, -0.2, gz + 0.2], [0, 0, 0], [0.28, 2.0, 0.28]);
    if (Math.abs(x) > 3) lanternPost(lit, emi, glows, x, gz - 0.4, 2.6, COL.lantern, m, 0, 4.4);
  }
  // pier-side stairs towards where the boat docks + mooring rope bollards
  lit.add(BOX, '#3a271c', [0, 0.55, gz + 1.5], [0, 0, 0], [8, 0.3, 2.4]);
  // boathouse silhouette
  lit.add(BOX, '#1b1e47', [-12, 4.2, gz - 24], [0, 0, 0], [12, 7, 8]);
  lit.add(CONE4, '#12143a', [-12, 9.8, gz - 24], [0, Math.PI / 4, 0], [9.8, 4.4, 7]);
  emi.add(BOX, COL.lantern, [-12, 3.4, gz - 19.9], [0, 0, 0], [1.4, 2.2, 0.1], { jitter: 0, gradient: 0 });
  glows.add(-12, 3.4, gz - 19.6, COL.lantern, 5, m, 0);
  lit.add(BOX, '#1b1e47', [14, 3.4, gz - 22], [0, 0, 0], [8, 5.4, 7]);
  lit.add(CONE4, '#12143a', [14, 8, gz - 22], [0, Math.PI / 4, 0], [6.6, 3.8, 5.6]);
  emi.add(BOX, COL.lantern, [14, 3.0, gz - 18.4], [0, 0, 0], [1.0, 1.6, 0.1], { jitter: 0, gradient: 0 });
  glows.add(14, 3.0, gz - 18.2, COL.lantern, 4, m, 0);
  // finish gate: two tall banner posts with lantern tops
  for (const s of [-1, 1]) {
    lit.add(CYL6, COL.wood, [s * 8.2, 4.8, gz - 4], [0, 0, 0], [0.3, 9.6, 0.3]);
    lit.add(CYL8, '#262a55', [s * 8.2, 0.9, gz - 4], [0, 0, 0], [0.6, 0.5, 0.6]);
    lit.add(CONE4, '#1d1a30', [s * 8.2, 10.4, gz - 4], [0, Math.PI / 4, 0], [0.9, 0.9, 0.9]);
    emi.add(BOX, COL.lantern, [s * 8.2, 9.6, gz - 4], [0, 0, 0], [0.9, 1.2, 0.9], { jitter: 0, gradient: 0 });
    glows.add(s * 8.2, 9.6, gz - 4, COL.lantern, 8, m, 0);
  }
  lit.add(BOX, COL.woodDark, [0, 9.7, gz - 4], [0, 0, 0], [16.6, 0.3, 0.3]);
  // lantern bunting
  for (let i = -7; i <= 7; i++) {
    const x = i * 1.1;
    const sag = 1.6 - Math.abs(i / 7) * 1.6 + 0.0;
    emi.add(BOX, i % 2 ? '#ffd27a' : COL.violet, [x, 10.4 - sag * 0.6 - 0.2, gz - 4], [0, 0, 0], [0.26, 0.3, 0.26], { jitter: 0, gradient: 0 });
    glows.add(x, 10.2 - sag * 0.6, gz - 4, i % 2 ? '#ffd27a' : COL.violet, 2.2, m, 0);
  }
  // end-of-dock spot lights glow
  glows.add(0, 3, gz - 2, '#ffd9a0', 9, m, 0);
  return { bannerPos: new THREE.Vector3(0, 7.7, gz - 3.8) };
}

export function buildWorldGeometry(): WorldGeometry {
  const rand = mulberry32(20261027);
  const glows = new GlowSet(rand);

  const sLit = new MeshBuilder(rand);
  const sEmi = new MeshBuilder(rand);
  buildShared(sLit, sEmi, glows, rand);

  const l1Lit = new MeshBuilder(rand);
  const l1Emi = new MeshBuilder(rand);
  buildLeg1(l1Lit, l1Emi, glows, rand);

  const l2Lit = new MeshBuilder(rand);
  const l2Emi = new MeshBuilder(rand);
  buildLeg2(l2Lit, l2Emi, glows, rand);

  const l3Lit = new MeshBuilder(rand);
  const l3Emi = new MeshBuilder(rand);
  const { bannerPos } = buildLeg3(l3Lit, l3Emi, glows);

  return {
    shared: { lit: sLit.build(), emissive: sEmi.build() },
    legs: {
      1: { lit: l1Lit.build(), emissive: l1Emi.build() },
      2: { lit: l2Lit.build(), emissive: l2Emi.build() },
      3: { lit: l3Lit.build(), emissive: l3Emi.build() },
    },
    glows: glows.build(),
    bannerPos,
    finishGlowPos: new THREE.Vector3(0, 2, -TRACK_LEN - 8),
    gateZ: -TRACK_LEN - 3,
  };
}
