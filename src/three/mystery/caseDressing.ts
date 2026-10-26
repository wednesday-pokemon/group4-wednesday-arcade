// Per-case set dressing. Everything here is decoration (no collision change) and is derived from the case's WORLD (areas, candidate
// sites, examines, lever, extra walls), never from the session's hidden layout — the same dressing appears whichever site really holds
// the clue or the egg. Pieces are placed by a free-spot search that keeps clear of walls, cover, hiding spots, the patrol loop, every
// candidate site and the interactables, so nothing blocks a path or hides a prop.
import type { MapDef, SiteDef, Vec2, WallDef } from '../../mystery/types.ts';
import { pointInPoly } from '../action/geom.ts';
import { Bld, Collector } from './builders.ts';
import { BOX, CONE4, CONE6, CYL6, CYL8, CYL12, ICO0, ICO1, PAL, distPointSeg, seeded } from './common.ts';
import { EXAMINE_PROPS, leverBase } from './interactables.ts';
import type { Theme } from './look.ts';
import { searchlightMast } from './hazards.ts';
import { ACCENT, SITE_PROPS, siteYaw, sitesOf } from './siteProps.ts';

const NG = { gradient: 0, jitter: 0 } as const;

export type CaseTheme = Theme | null;

/** Where each static piece the runtime needs to find again ended up. */
export interface DressingExtras {
  sites: { site: SiteDef; x: number; z: number; yaw: number }[];
  examines: { id: string; prop: keyof typeof EXAMINE_PROPS; x: number; z: number; yaw: number }[];
  lever: { x: number; z: number; yaw: number } | null;
  /** alarm beacons: the renderer spins a red beam at each */
  beacons: { x: number; y: number; z: number }[];
}

class Placer {
  private readonly placed: Vec2[] = [];
  private readonly keep: { x: number; z: number; r: number }[] = [];
  constructor(private readonly map: MapDef) {
    for (const s of sitesOf(map).all) this.keep.push({ x: s.x, z: s.z, r: 2.3 });
    for (const e of map.world?.examines ?? []) this.keep.push({ x: e.x, z: e.z, r: 1.7 });
    const p = map.world?.passage;
    if (p) this.keep.push({ x: p.leverX, z: p.leverZ, r: 1.7 });
    for (const h of map.world?.hazards ?? []) if (h.kind === 'searchlight') this.keep.push({ x: h.x, z: h.z, r: 1.6 });
    if (map.powerSwitch) this.keep.push({ x: map.powerSwitch.x, z: map.powerSwitch.z, r: 2.2 });
    for (const q of map.safeReleasePoints) this.keep.push({ x: q.x, z: q.z, r: 1.4 });
    for (const sp of map.world?.hydeSpawns ?? []) this.keep.push({ x: sp.x, z: sp.z, r: 1.6 });
    this.keep.push({ x: map.playerStart.x, z: map.playerStart.z, r: 3.2 }, { x: map.tower.x, z: map.tower.z, r: map.tower.radius + 2.2 });
  }

  ok(x: number, z: number, r: number): boolean {
    const m = this.map;
    if (x < m.bounds.minX + 1.2 || x > m.bounds.maxX - 1.2 || z < m.bounds.minZ + 1.2 || z > m.bounds.maxZ - 1.2) return false;
    for (const k of this.keep) if (Math.hypot(k.x - x, k.z - z) < k.r + r) return false;
    for (const h of m.hidingSpots) if (Math.hypot(h.x - x, h.z - z) < h.radius + 1.0 + r) return false;
    for (const cv of m.cover) if (Math.hypot(cv.x - x, cv.z - z) < cv.radius + 0.35 + r) return false;
    for (const w of m.walls) if (distPointSeg(x, z, w.a.x, w.a.z, w.b.x, w.b.z) < w.thickness / 2 + 0.3 + r) return false;
    for (const hz of m.world?.hazards ?? []) if (hz.kind === 'noisy_floor' && pointInPoly(hz.polygon, x, z)) return false;
    const p = m.patrol;
    for (let i = 0; i < p.length; i++) {
      const a = p[i], b = p[(i + 1) % p.length];
      if (distPointSeg(x, z, a.x, a.z, b.x, b.z) < 1.4 + r) return false;
    }
    for (const q of this.placed) if (Math.hypot(q.x - x, q.z - z) < 0.7 + r) return false;
    return true;
  }

  find(x: number, z: number, r: number, reach = 3.5): Vec2 | null {
    for (let d = 0; d <= reach; d += 0.5) {
      const n = d === 0 ? 1 : Math.ceil(d * 5);
      for (let k = 0; k < n; k++) {
        const a = (k / n) * Math.PI * 2;
        const px = x + Math.cos(a) * d, pz = z + Math.sin(a) * d;
        if (this.ok(px, pz, r)) { this.placed.push({ x: px, z: pz }); return { x: px, z: pz }; }
      }
    }
    return null;
  }
}

// ------------------------------------------------------------------------------------------------ small props (world coords)
function paperScatter(b: Bld, x: number, z: number, _yaw: number): void {
  for (let i = 0; i < 6; i++) {
    const a = i * 1.7, r = 0.1 + (i % 3) * 0.2;
    b.lit.add(BOX, i % 2 ? '#efe5c8' : '#e0d4b0', [x + Math.cos(a) * r, 0.03 + i * 0.004, z + Math.sin(a) * r], [0, i * 1.1, (i % 3) * 0.04], [0.28, 0.008, 0.2], { gradient: 0.05, jitter: 0.03 });
  }
}

function poisonPlant(b: Bld, x: number, z: number): void {
  b.lit.add(CYL6, '#2a1c14', [x, 0.12, z], [0, 0, 0], [0.26, 0.24, 0.26], NG); // pot
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2, tilt = 0.5 + (i % 3) * 0.12;
    b.lit.add(CONE6, ['#2f8a52', '#3a9a5a', '#26703f'][i % 3], [x + Math.cos(a) * 0.13, 0.46, z + Math.sin(a) * 0.13], [Math.sin(a) * tilt, 0, -Math.cos(a) * tilt], [0.07, 0.62, 0.05], NG);
  }
  for (let i = 0; i < 3; i++) b.em.add(ICO0, i === 1 ? '#c8a2ff' : '#8bffa8', [x + Math.cos(i * 2.2) * 0.25, 0.62 + i * 0.1, z + Math.sin(i * 2.2) * 0.25], [0, 0, 0], 0.055, NG);
  b.glows.push({ x, y: 0.75, z, size: 1.5, color: '#8bffa8', alpha: 0.38, flicker: 0.45, fogFloor: 0.05 });
}

function brokenGlass(b: Bld, x: number, z: number): void {
  b.lit.add(CYL8, '#cfe0e8', [x, 0.06, z], [0.9, 0.4, 0.3], [0.1, 0.26, 0.1], NG); // flask on its side
  for (let i = 0; i < 8; i++) {
    const a = i * 0.8;
    b.em.add(ICO0, '#bfe8f2', [x + Math.cos(a) * (0.12 + (i % 3) * 0.1), 0.02, z + Math.sin(a) * (0.12 + (i % 3) * 0.1)], [a, a * 2, 0], [0.06, 0.012, 0.045], NG);
  }
  b.em.add(ICO1, '#7bffd0', [x + 0.2, 0.01, z - 0.1], [0, 0, 0], [0.2, 0.008, 0.14], NG);
}

function toppledShelf(b: Bld, x: number, z: number, yaw: number): void {
  const s = Math.sin(yaw), c = Math.cos(yaw);
  const L = (lx: number, lz: number): [number, number] => [x + lx * c + lz * s, z - lx * s + lz * c];
  const [bx, bz] = L(0, 0);
  b.lit.add(BOX, '#3a2517', [bx, 0.3, bz], [0, yaw, 0.12], [1.5, 0.55, 0.4], { gradient: 0.3, jitter: 0.06 });
  b.lit.add(BOX, '#241610', [bx, 0.58, bz], [0, yaw, 0.12], [1.5, 0.04, 0.42], NG);
  const cols = ['#7a2e3e', '#2f5a8a', '#4f7a3f', '#8a6a2e', '#5a3a86'];
  for (let i = 0; i < 7; i++) {
    const [px, pz] = L(-0.7 + i * 0.22, 0.45 + (i % 2) * 0.18);
    b.lit.add(BOX, cols[i % 5], [px, 0.05, pz], [0, yaw + i * 0.8, (i % 3) * 0.1], [0.2, 0.06, 0.28], { gradient: 0.1, jitter: 0.08 });
  }
}

function standLantern(b: Bld, x: number, z: number, h: number, color: string = PAL.lantern, size = 2.6): void {
  b.lit.add(CYL6, PAL.iron, [x, h / 2, z], [0, 0, 0], [0.05, h, 0.05], NG);
  b.lit.add(CYL8, PAL.iron, [x, 0.04, z], [0, 0, 0], [0.18, 0.08, 0.18], NG);
  b.lit.add(CONE4, PAL.iron, [x, h + 0.26, z], [0, Math.PI / 4, 0], [0.24, 0.14, 0.24], NG);
  b.em.add(BOX, color, [x, h + 0.1, z], [0, 0, 0], [0.16, 0.22, 0.16], NG);
  b.glows.push({ x, y: h + 0.1, z, size, color, alpha: 0.9, flicker: 0.6, fogFloor: 0.3 });
}

function candles(b: Bld, x: number, z: number): void {
  b.lit.add(CYL8, '#2a2630', [x, 0.015, z], [0, 0, 0], [0.34, 0.03, 0.34], NG);
  for (let i = 0; i < 5; i++) {
    const a = i * 1.3, r = 0.06 + (i % 2) * 0.1, h = 0.1 + (i % 3) * 0.05;
    b.lit.add(CYL6, '#e8dcc0', [x + Math.cos(a) * r, 0.03 + h / 2, z + Math.sin(a) * r], [0, 0, 0], [0.022, h, 0.022], NG);
    b.em.add(CONE4, '#ffcf70', [x + Math.cos(a) * r, 0.03 + h + 0.03, z + Math.sin(a) * r], [0, Math.PI / 4, 0], [0.018, 0.05, 0.018], NG);
  }
  b.glows.push({ x, y: 0.28, z, size: 2.0, color: '#ffb04a', alpha: 0.65, flicker: 1.0, fogFloor: 0.1 });
}

function bonesAndUrns(b: Bld, x: number, z: number): void {
  b.lit.add(CYL8, '#6a5a4a', [x, 0.2, z], [0, 0, 0], [0.18, 0.4, 0.18], { gradient: 0.3 });
  b.lit.add(CYL8, '#5a4a3a', [x, 0.42, z], [0, 0, 0], [0.1, 0.06, 0.1], NG);
  b.lit.add(CYL6, '#5a4a3a', [x + 0.5, 0.14, z + 0.2], [0, 0, 0.3], [0.13, 0.3, 0.13], { gradient: 0.3 });
  for (let i = 0; i < 5; i++) b.lit.add(CYL6, '#d8d0b8', [x - 0.3 + (i % 3) * 0.14, 0.04, z + 0.4 + (i % 2) * 0.12], [0, i * 0.9, Math.PI / 2], [0.018, 0.26, 0.018], NG);
  b.lit.add(ICO0, '#d8d0b8', [x - 0.15, 0.08, z + 0.5], [0, 0.4, 0], [0.1, 0.09, 0.11], NG);
}

function rubblePile(b: Bld, x: number, z: number, yaw: number): void {
  b.lit.add(ICO1, '#4a4552', [x, 0.2, z], [0, yaw, 0], [0.8, 0.35, 0.6], { gradient: 0.3, jitter: 0.08 });
  b.lit.add(ICO0, '#58525e', [x + 0.5, 0.15, z + 0.2], [0.4, yaw, 0], [0.35, 0.25, 0.3], { gradient: 0.3, jitter: 0.06 });
  b.lit.add(ICO0, '#3a3642', [x - 0.5, 0.12, z - 0.25], [0, yaw + 1, 0.3], [0.3, 0.22, 0.28], { gradient: 0.3, jitter: 0.06 });
  b.lit.add(BOX, '#3a3f58', [x + 0.1, 0.5, z - 0.15], [0.5, yaw, 0.7], [0.07, 0.9, 0.07], NG);
}

function equipmentCrates(b: Bld, x: number, z: number, yaw: number): void {
  const mk = (cx: number, cy: number, cz: number, w: number, h: number, d: number, ry: number): void => {
    b.lit.add(BOX, '#3c4a3a', [cx, cy, cz], [0, ry, 0], [w, h, d], { gradient: 0.3, jitter: 0.06 });
    b.lit.add(BOX, '#2a3328', [cx, cy, cz], [0, ry, 0], [w + 0.03, 0.06, d + 0.03], NG);
    b.em.add(BOX, '#e8c84a', [cx + Math.sin(ry) * d * 0.5, cy + h * 0.25, cz + Math.cos(ry) * d * 0.5], [0, ry, 0], [w * 0.5, 0.05, 0.012], NG);
  };
  mk(x, 0.3, z, 0.9, 0.6, 0.7, yaw);
  mk(x + 0.85, 0.25, z + 0.1, 0.7, 0.5, 0.6, yaw + 0.2);
  mk(x + 0.2, 0.85, z - 0.05, 0.6, 0.5, 0.5, yaw - 0.15);
}

function floodLamp(b: Bld, x: number, z: number): void {
  b.lit.add(CYL8, PAL.iron, [x, 0.15, z], [0, 0, 0], [0.28, 0.3, 0.28], NG);
  b.lit.add(CYL6, PAL.iron, [x, 1.7, z], [0, 0, 0], [0.07, 3.4, 0.07], { gradient: 0.1 });
  b.lit.add(BOX, '#2a2d44', [x, 3.5, z], [0, 0.6, 0], [0.6, 0.3, 0.3], { gradient: 0.1 });
  b.em.add(BOX, '#d8ecff', [x + Math.sin(0.6) * 0.16, 3.5, z + Math.cos(0.6) * 0.16], [0, 0.6, 0], [0.5, 0.2, 0.02], NG);
  b.glows.push({ x, y: 3.5, z, size: 4.2, color: '#cfe6ff', alpha: 0.85, flicker: 0.85, fogFloor: 0.4 });
}

function cableSpool(b: Bld, x: number, z: number): void {
  b.lit.add(CYL12, PAL.wood, [x, 0.3, z], [Math.PI / 2, 0.4, 0], [0.5, 0.2, 0.5], { gradient: 0.3 });
  b.lit.add(CYL12, '#1b1d2c', [x, 0.3, z], [Math.PI / 2, 0.4, 0], [0.34, 0.26, 0.34], NG);
  for (const s of [-1, 1]) b.lit.add(CYL12, PAL.woodDark, [x + Math.sin(0.4) * s * 0.12, 0.3, z + Math.cos(0.4) * s * 0.12], [Math.PI / 2, 0.4, 0], [0.5, 0.03, 0.5], NG);
  b.lit.add(CYL6, '#1b1d2c', [x + 0.5, 0.03, z + 0.4], [0, 0.6, Math.PI / 2], [0.025, 0.9, 0.025], NG);
}

function stripedBarrier(b: Bld, x: number, z: number, yaw: number): void {
  const s = Math.sin(yaw), c = Math.cos(yaw);
  for (const sx of [-1, 1]) b.lit.add(BOX, PAL.iron, [x + sx * 0.5 * c, 0.4, z - sx * 0.5 * s], [0, yaw, 0.15 * sx], [0.05, 0.8, 0.05], NG);
  for (let i = 0; i < 4; i++) b.em.add(BOX, i % 2 ? '#d8d8e0' : '#d8483a', [x + (i - 1.5) * 0.26 * c, 0.72, z - (i - 1.5) * 0.26 * s], [0, yaw, 0], [0.25, 0.16, 0.03], NG);
}

function monitorDesk(b: Bld, x: number, z: number, yaw: number): void {
  const c = Math.cos(yaw), s = Math.sin(yaw);
  const L = (lx: number, lz: number): [number, number] => [x + lx * c + lz * s, z - lx * s + lz * c];
  const [bx, bz] = L(0, 0);
  b.lit.add(BOX, '#232842', [bx, 0.4, bz], [0, yaw, 0], [1.5, 0.8, 0.7], { gradient: 0.25 });
  for (let i = 0; i < 3; i++) {
    const [mx, mz] = L(-0.5 + i * 0.5, -0.1);
    b.lit.add(BOX, '#10152e', [mx, 1.05, mz], [0, yaw, 0], [0.42, 0.3, 0.05], NG);
    const [ex, ez] = L(-0.5 + i * 0.5, -0.13);
    b.em.add(BOX, i === 1 ? '#ff6a4a' : '#4fe6f2', [ex, 1.05, ez], [0, yaw, 0], [0.36, 0.24, 0.01], NG);
  }
  b.lit.add(BOX, '#10152e', [bx, 0.84, bz], [0, yaw, 0], [1.3, 0.04, 0.5], NG);
  b.glows.push({ x: bx, y: 1.1, z: bz, size: 3.0, color: '#4fe6f2', alpha: 0.6, flicker: 0.4, fogFloor: 0.15 });
}

// ------------------------------------------------------------------------------------------------ area scatter
type PropFn = (col: Collector, ex: DressingExtras, x: number, z: number, yaw: number, rand: () => number) => void;
interface PropDef { w: number; r: number; fn: PropFn }

const one = (fn: (b: Bld, x: number, z: number, yaw: number) => void): PropFn => (col, _ex, x, z, yaw, rand) => {
  const b = new Bld(rand);
  fn(b, x, z, yaw);
  col.add(b.finish(0, 0, 0, 1));
};
/** a model authored in the local frame (e.g. an examine builder) placed at x, z */
const local = (build: (b: Bld, accent: string) => void, accent: string): PropFn => (col, _ex, x, z, yaw, rand) => {
  const b = new Bld(rand);
  build(b, accent);
  col.add(b.finish(x, z, yaw, 1));
};

function themeProps(theme: Theme): PropDef[] {
  const acc = ACCENT[theme];
  switch (theme) {
    case 'archive': return [
      { w: 3, r: 0.6, fn: one(paperScatter) },
      { w: 3, r: 0.4, fn: one((b, x, z) => poisonPlant(b, x, z)) },
      { w: 2, r: 0.5, fn: one((b, x, z) => brokenGlass(b, x, z)) },
      { w: 2, r: 0.8, fn: one(toppledShelf) },
      { w: 2, r: 0.8, fn: local(SITE_PROPS.cabinet.build, acc) },
      { w: 1, r: 0.6, fn: local(EXAMINE_PROPS.lab.build, acc) },
    ];
    case 'crypt': return [
      { w: 3, r: 0.5, fn: one((b, x, z) => candles(b, x, z)) },
      { w: 3, r: 0.8, fn: one(rubblePile) },
      { w: 2, r: 0.7, fn: one((b, x, z) => bonesAndUrns(b, x, z)) },
      { w: 2, r: 0.9, fn: local(EXAMINE_PROPS.machine.build, acc) },
      { w: 2, r: 0.8, fn: local(EXAMINE_PROPS.cobweb.build, acc) },
      { w: 2, r: 0.4, fn: one((b, x, z) => standLantern(b, x, z, 1.4, '#ffb04a', 3.0)) },
    ];
    case 'signal': return [
      { w: 3, r: 1.0, fn: one(equipmentCrates) },
      { w: 3, r: 0.8, fn: one(monitorDesk) },
      { w: 2, r: 0.4, fn: (col, ex, x, z, _yaw, rand) => { const b = new Bld(rand); alarmBeaconPole(b, x, z); col.add(b.finish(0, 0, 0, 1)); ex.beacons.push({ x, y: 2.15, z }); } },
      { w: 2, r: 0.4, fn: one((b, x, z) => floodLamp(b, x, z)) },
      { w: 1, r: 0.6, fn: one((b, x, z) => cableSpool(b, x, z)) },
      { w: 2, r: 0.7, fn: one(stripedBarrier) },
    ];
  }
}

function alarmBeaconPole(b: Bld, x: number, z: number): void {
  b.lit.add(CYL8, PAL.iron, [x, 0.12, z], [0, 0, 0], [0.26, 0.24, 0.26], NG);
  b.lit.add(CYL6, PAL.iron, [x, 1.1, z], [0, 0, 0], [0.06, 2.0, 0.06], NG);
  b.lit.add(CYL8, '#2a2d44', [x, 2.1, z], [0, 0, 0], [0.18, 0.12, 0.18], NG);
  b.em.add(ICO1, '#ff4a4a', [x, 2.25, z], [0, 0, 0], [0.13, 0.17, 0.13], NG);
  b.glows.push({ x, y: 2.25, z, size: 3.0, color: '#ff4a4a', alpha: 0.7, flicker: 0.6, fogFloor: 0.25 });
}

function pick<T extends { w: number }>(list: T[], rand: () => number): T {
  const tot = list.reduce((s, p) => s + p.w, 0);
  let t = rand() * tot;
  for (const p of list) { t -= p.w; if (t <= 0) return p; }
  return list[list.length - 1];
}

// ------------------------------------------------------------------------------------------------ wall accents
function vineStrip(b: Bld, x: number, z: number, nx: number, nz: number, h: number, rand: () => number): void {
  // a vine climbing a wall face (n = outward normal of the face)
  const tx = -nz, tz = nx;
  b.lit.add(CYL6, '#1c3a26', [x + nx * 0.06, h * 0.4, z + nz * 0.06], [0, 0, 0], [0.03, h * 0.8, 0.03], NG);
  const n = 7;
  for (let i = 0; i < n; i++) {
    const y = 0.25 + (i / (n - 1)) * h * 0.72;
    const side = (i % 2 ? 1 : -1) * (0.1 + rand() * 0.18);
    b.lit.add(ICO0, ['#2a6a3a', '#357a45', '#1f5a30'][i % 3], [x + nx * 0.1 + tx * side, y, z + nz * 0.1 + tz * side], [rand(), rand() * 6, rand()], [0.17, 0.05, 0.12], { gradient: 0.1, jitter: 0.1 });
  }
  b.em.add(ICO0, '#c8a2ff', [x + nx * 0.12 + tx * 0.1, h * 0.5, z + nz * 0.12 + tz * 0.1], [0, 0, 0], 0.04, NG);
}

function cobwebCorner(b: Bld, x: number, z: number, nx: number, nz: number, h: number): void {
  const tx = -nz, tz = nx;
  const y = Math.min(h - 0.25, 2.2);
  // two translucent triangles hanging from the corner + a single strand
  b.glass.add(BOX, '#e8e8f0', [x + nx * 0.08 + tx * 0.3, y - 0.2, z + nz * 0.08 + tz * 0.3], [0.3, Math.atan2(nx, nz), 0.5], [0.7, 0.01, 0.5], NG);
  b.lit.add(CYL6, '#cfcfd8', [x + nx * 0.08, y - 0.4, z + nz * 0.08], [0, 0, 0], [0.006, 0.8, 0.006], NG);
}

function extraWallAccents(theme: Theme, w: WallDef, col: Collector, rand: () => number): void {
  const dx = w.b.x - w.a.x, dz = w.b.z - w.a.z;
  const len = Math.hypot(dx, dz) || 1;
  const ux = dx / len, uz = dz / len, nx = -uz, nz = ux;
  const b = new Bld(rand);
  const n = Math.max(1, Math.floor(len / 4));
  for (let i = 0; i < n; i++) {
    const s = ((i + 0.5) / n) * len;
    const px = w.a.x + ux * s, pz = w.a.z + uz * s;
    const side = i % 2 ? 1 : -1;
    const fx = px + nx * side * (w.thickness / 2 + 0.02), fz = pz + nz * side * (w.thickness / 2 + 0.02);
    if (w.kind === 'hedge' || /vine/.test(w.id)) continue;
    if (theme === 'archive' && w.height >= 1.6) vineStrip(b, fx, fz, nx * side, nz * side, w.height, rand);
    else if (theme === 'archive') paperScatter(b, px + nx * side * (w.thickness / 2 + 0.6), pz + nz * side * (w.thickness / 2 + 0.6), 0);
    else if (theme === 'crypt') { if (i === 0 || rand() < 0.5) cobwebCorner(b, w.a.x + ux * 0.1 + nx * side * 0.1, w.a.z + uz * 0.1 + nz * side * 0.1, nx * side, nz * side, Math.max(w.height, 2.4)); }
  }
  col.add(b.finish(0, 0, 0, 1));
}

// ------------------------------------------------------------------------------------------------ entry
/** Builds all case-specific static dressing into `col` (lit / emissive / glass geometry + glow billboards) and reports where things went. */
export function buildCaseDressing(map: MapDef, col: Collector, low: boolean, theme: Theme): DressingExtras {
  const ex: DressingExtras = { sites: [], examines: [], lever: null, beacons: [] };
  const rand = seeded('case:' + map.id);
  const accent = ACCENT[theme];

  // ---- furniture at EVERY candidate site (identical whether or not the item is there)
  for (const site of sitesOf(map).all) {
    const yaw = siteYaw(map, site.x, site.z);
    const b = new Bld(seeded('site:' + site.id));
    SITE_PROPS[site.prop].build(b, accent);
    col.add(b.finish(site.x, site.z, yaw, 1));
    ex.sites.push({ site, x: site.x, z: site.z, yaw });
  }
  // ---- examine objects + the lever
  for (const e of map.world?.examines ?? []) {
    const yaw = siteYaw(map, e.x, e.z);
    const b = new Bld(seeded('examine:' + e.id));
    EXAMINE_PROPS[e.prop].build(b, accent);
    col.add(b.finish(e.x, e.z, yaw, 1));
    ex.examines.push({ id: e.id, prop: e.prop, x: e.x, z: e.z, yaw });
  }
  const pass = map.world?.passage;
  if (pass) {
    const yaw = siteYaw(map, pass.leverX, pass.leverZ);
    const b = new Bld(seeded('lever'));
    leverBase(b, accent);
    col.add(b.finish(pass.leverX, pass.leverZ, yaw, 1));
    ex.lever = { x: pass.leverX, z: pass.leverZ, yaw };
  }

  // ---- searchlight masts (the rotating lamp head + beam are dynamic: hazards.ts)
  for (const h of map.world?.hazards ?? []) {
    if (h.kind !== 'searchlight') continue;
    const b = new Bld(seeded('mast:' + h.id));
    searchlightMast(b);
    col.add(b.finish(h.x, h.z, 0, 1));
  }

  // ---- themed props scattered through the case's areas
  const pl = new Placer(map);
  const defs = themeProps(theme);
  for (const area of map.world?.areas ?? []) {
    const n = Math.max(3, Math.min(low ? 4 : 8, Math.round(area.radiusM * 0.7)));
    for (let i = 0; i < n; i++) {
      const def = pick(defs, rand);
      const a = rand() * Math.PI * 2, d = Math.sqrt(rand()) * area.radiusM;
      const p = pl.find(area.x + Math.cos(a) * d, area.z + Math.sin(a) * d, def.r, 2.5);
      if (!p) continue;
      def.fn(col, ex, p.x, p.z, rand() * Math.PI * 2, rand);
    }
  }
  // ---- accents along the case's own extra walls (vines, spilled papers, cobwebs)
  if (!low) for (const w of map.world?.extraWalls ?? []) if (w.id !== pass?.wallId) extraWallAccents(theme, w, col, rand);

  // a little extra light at the egg's candidate sites that sit in a foggy room, so a nest reads without giving the answer away
  void CONE6; void ICO1;
  return ex;
}
