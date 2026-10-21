// Island dressing derived from the MapDef: hiding spots, landmark models (pier, research hall, crypt, egg shrine, Iago Tower,
// greenhouse, lamps, gate), room interiors and roofs, Gomez's power switch and the tower's deposit circle.
// Landmarks are authored defensively: they never assume a layout, only the placements and room polygons they are given.
import * as THREE from 'three';
import type { HidingSpotDef, MapDef, RoomDef, Vec2, WallDef } from '../../mystery/types.ts';
import { TriBuilder, centroid, distToEdges, pointInPoly } from '../action/geom.ts';
import { Bld, Collector } from './builders.ts';
import {
  BOX, CONE4, CONE6, CONE8, CYL6, CYL8, CYL12, ICO0, ICO1, PAL, PRISM, TORUS, distPointSeg, nearestWall, seeded, yawOf,
} from './common.ts';
import type { PierRect } from './terrain.ts';
import { buildGateGeometry } from './walls.ts';

// ------------------------------------------------------------------------------------------------ small model helpers
function lampPost(b: Bld, x: number, z: number, h = 3.3, color: string = PAL.lantern): void {
  b.lit.add(CYL8, PAL.iron, [x, 0.15, z], [0, 0, 0], [0.26, 0.3, 0.26], { gradient: 0 });
  b.lit.add(CYL6, PAL.iron, [x, h / 2, z], [0, 0, 0], [0.07, h, 0.07], { gradient: 0.1 });
  b.lit.add(BOX, PAL.iron, [x, h + 0.04, z], [0, 0, 0], [0.42, 0.06, 0.42], { gradient: 0 });
  b.lit.add(CONE4, PAL.iron, [x, h + 0.42, z], [0, Math.PI / 4, 0], [0.34, 0.4, 0.34], { gradient: 0 });
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.lit.add(BOX, PAL.iron, [x + sx * 0.17, h + 0.5 - 0.3, z + sz * 0.17], [0, 0, 0], [0.03, 0.46, 0.03], { gradient: 0 });
  b.em.add(BOX, color, [x, h + 0.2, z], [0, 0, 0], [0.26, 0.34, 0.26], { jitter: 0, gradient: 0 });
  b.glows.push({ x, y: h + 0.2, z, size: 3.4, color, alpha: 0.85, flicker: 0.55, fogFloor: 0.2 });
}

function brazier(b: Bld, x: number, z: number, color = '#6fe8ff', h = 1.0): void {
  b.lit.add(CYL6, PAL.iron, [x, h / 2, z], [0, 0, 0], [0.09, h, 0.09], { gradient: 0.1 });
  b.lit.add(CYL8, PAL.stoneDark, [x, h + 0.08, z], [0, 0, 0], [0.34, 0.16, 0.34], { gradient: 0 });
  b.em.add(CONE6, color, [x, h + 0.42, z], [0, 0, 0], [0.22, 0.55, 0.22], { jitter: 0, gradient: 0 });
  b.glows.push({ x, y: h + 0.5, z, size: 2.6, color, alpha: 0.8, flicker: 0.9, fogFloor: 0.2 });
}

function pointedArch(b: Bld, x: number, z: number, w: number, h: number, thick: number, yaw: number, color: string): void {
  // two jambs + two angled lancet beams, in the local XY plane rotated by yaw about the arch centre
  const s = Math.sin(yaw), c = Math.cos(yaw);
  const P = (lx: number): [number, number] => [x + lx * c, z - lx * s];
  for (const sx of [-1, 1]) {
    const [px, pz] = P(sx * w / 2);
    b.lit.add(BOX, color, [px, h / 2, pz], [0, yaw, 0], [thick, h, thick], { gradient: 0.4 });
  }
  const rise = w * 0.62;
  const L = Math.hypot(w / 2, rise);
  const ang = Math.atan2(rise, w / 2);
  for (const sx of [-1, 1]) {
    const [px, pz] = P(sx * w / 4);
    b.lit.add(BOX, color, [px, h + rise / 2, pz], [0, yaw, sx * -ang], [L, thick * 0.9, thick], { gradient: 0.2 });
  }
  const [ax, az] = P(0);
  b.lit.add(CONE4, PAL.stoneDark, [ax, h + rise + 0.35, az], [0, yaw + Math.PI / 4, 0], [thick * 0.8, 0.7, thick * 0.8], { gradient: 0 });
}

// ------------------------------------------------------------------------------------------------------ hiding spots
export function buildHidingSpots(map: MapDef, col: Collector, skipWalls: ReadonlySet<string>): void {
  for (const h of map.hidingSpots) {
    const rand = seeded('hide:' + h.id);
    const b = new Bld(rand);
    const nw = nearestWall(map, h.x, h.z, skipWalls);
    let yaw = rand() * Math.PI * 2;
    let wallClose = false;
    if (nw && nw.d < 2.5) {
      const w = nw.wall;
      const dx = w.b.x - w.a.x, dz = w.b.z - w.a.z;
      const l2 = dx * dx + dz * dz || 1;
      const t = Math.max(0, Math.min(1, ((h.x - w.a.x) * dx + (h.z - w.a.z) * dz) / l2));
      const px = w.a.x + dx * t, pz = w.a.z + dz * t;
      const fx = h.x - px, fz = h.z - pz;
      if (Math.hypot(fx, fz) > 0.05) { yaw = yawOf(fx, fz); wallClose = true; }
    }
    buildHidingModel(b, h, wallClose);
    col.add(b.finish(h.x, h.z, yaw, 1));
  }
}

function buildHidingModel(b: Bld, h: HidingSpotDef, wallClose: boolean): void {
  const r = Math.max(0.6, h.radius);
  switch (h.kind) {
    case 'alcove': {
      // gothic niche: jambs, lancet head, dark recess and a small wall torch (front = -Z, back wall at +Z)
      const depth = r * 0.95;
      const w = r * 1.9;
      pointedArch(b, 0, -depth * 0.1, w, 2.0, 0.34, 0, PAL.stoneLight);
      b.lit.add(BOX, '#05060f', [0, 1.5, depth * 0.55], [0, 0, 0], [w, 3.0, 0.2], { gradient: 0, jitter: 0 });
      for (const sx of [-1, 1]) b.lit.add(BOX, PAL.stoneDark, [sx * (w / 2 + 0.2), 1.25, depth * 0.3], [0, 0, 0], [0.42, 2.5, depth * 1.3], { gradient: 0.3 });
      b.lit.add(BOX, PAL.stoneDark, [0, 0.08, 0], [0, 0, 0], [w + 0.4, 0.16, depth * 1.2], { gradient: 0 });
      b.lantern(w / 2 + 0.5, 1.9, -depth * 0.25, 2.4, '#b79cff', 0.8);
      void wallClose;
      break;
    }
    case 'wardrobe': {
      const w = r * 1.75, d = r * 1.1, hh = 2.15;
      b.lit.add(BOX, PAL.woodDark, [0, hh / 2, d * 0.45], [0, 0, 0], [w, hh, 0.08], { gradient: 0.3 }); // back
      for (const sx of [-1, 1]) b.lit.add(BOX, PAL.wood, [sx * (w / 2), hh / 2, 0], [0, 0, 0], [0.1, hh, d], { gradient: 0.3 });
      b.lit.add(BOX, PAL.woodLight, [0, hh + 0.07, 0], [0, 0, 0], [w + 0.22, 0.16, d + 0.18], { gradient: 0 });
      b.lit.add(BOX, PAL.woodDark, [0, 0.06, 0], [0, 0, 0], [w, 0.12, d], { gradient: 0 });
      b.lit.add(BOX, '#0a0b1a', [0, hh / 2, d * 0.2], [0, 0, 0], [w - 0.1, hh - 0.2, 0.06], { gradient: 0, jitter: 0 }); // shadow interior
      // two doors swung open (hinged at the side walls)
      for (const sx of [-1, 1]) {
        const hingeX = sx * (w / 2 + 0.02);
        b.lit.add(BOX, PAL.wood, [hingeX + sx * (w / 4) * 0.35, hh / 2, -d / 2 - w * 0.22], [0, sx * 0.9, 0], [w / 2 - 0.05, hh - 0.1, 0.07], { gradient: 0.3, jitter: 0.1 });
        b.lit.add(ICO0, '#caa24a', [hingeX + sx * (w / 4) * 0.35 - sx * 0.12, hh * 0.5, -d / 2 - w * 0.22 - 0.05], [0, 0, 0], 0.045, { gradient: 0, jitter: 0 });
      }
      break;
    }
    case 'hedge': {
      const n = 7;
      for (let i = 0; i < n; i++) {
        const a = Math.PI * (0.15 + 0.7 * (i / (n - 1))) + Math.PI * 0.5; // horseshoe open to -Z (front)
        const rr = r * 0.95;
        const y = 0.6 + (i % 2) * 0.16;
        b.lit.add(ICO1, PAL.hedge[i % 3], [Math.cos(a) * rr, y, Math.sin(a) * rr], [b.rand(), b.rand() * 6, b.rand()], [r * 0.6, 0.72, r * 0.6], { gradient: 0.3, jitter: 0.14 });
      }
      b.lit.add(ICO1, PAL.hedge[1], [0, 1.1, r * 0.55], [0, 0, 0], [r * 0.95, 0.5, r * 0.8], { gradient: 0.3, jitter: 0.14 });
      b.lit.add(BOX, '#07100c', [0, 0.04, 0], [0, 0, 0], [r * 1.3, 0.04, r * 1.3], { gradient: 0 });
      b.em.add(ICO0, '#b79cff', [-r * 0.5, 0.7, -r * 0.2], [0, 0, 0], 0.05, { jitter: 0, gradient: 0 });
      b.em.add(ICO0, '#6fe0ff', [r * 0.45, 1.1, r * 0.1], [0, 0, 0], 0.05, { jitter: 0, gradient: 0 });
      break;
    }
    case 'sarcophagus': {
      const L = r * 2.4, W = r * 1.15, H = 0.85;
      b.lit.add(BOX, PAL.stoneDark, [0, 0.12, 0], [0, 0, 0], [W + 0.3, 0.24, L + 0.3], { gradient: 0.2 });
      b.lit.add(BOX, PAL.stone[1], [0, H / 2 + 0.1, 0], [0, 0, 0], [W, H, L], { gradient: 0.4 });
      b.lit.add(BOX, '#05060f', [0, H + 0.14, -L * 0.18], [0, 0, 0], [W * 0.82, 0.05, L * 0.5], { gradient: 0, jitter: 0 }); // open gap
      b.lit.add(BOX, PAL.stoneLight, [0.14, H + 0.32, L * 0.22], [0, -0.28, 0], [W * 0.98, 0.2, L * 0.55], { gradient: 0 }); // lid slid aside
      b.lit.add(BOX, PAL.stoneDark, [0.14, H + 0.45, L * 0.22], [0, -0.28, 0], [0.1, 0.06, L * 0.4], { gradient: 0 });
      b.lit.add(BOX, PAL.stoneDark, [0.14, H + 0.45, L * 0.1], [0, -0.28, 0], [W * 0.5, 0.06, 0.1], { gradient: 0 });
      b.em.add(ICO0, '#8affc8', [0, H + 0.2, -L * 0.2], [0, 0, 0], 0.06, { jitter: 0, gradient: 0 });
      break;
    }
  }
}

// ---------------------------------------------------------------------------------------------- room wall sampling
interface WallSample { x: number; z: number; nx: number; nz: number; tx: number; tz: number; thick: number; h: number }

function roomWallSamples(map: MapDef, room: RoomDef, step: number, skip: ReadonlySet<string>): WallSample[] {
  const out: WallSample[] = [];
  const poly = room.polygon;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], c = poly[(i + 1) % poly.length];
    const len = Math.hypot(c.x - a.x, c.z - a.z);
    const n = Math.max(1, Math.ceil(len / step));
    for (let k = 0; k <= n; k++) {
      const px = a.x + ((c.x - a.x) * k) / n, pz = a.z + ((c.z - a.z) * k) / n;
      let best: WallDef | null = null, bd = 0.45;
      for (const w of map.walls) {
        if (skip.has(w.id)) continue;
        const d = distPointSeg(px, pz, w.a.x, w.a.z, w.b.x, w.b.z) - w.thickness / 2;
        if (d < bd) { bd = d; best = w; }
      }
      if (!best) continue;
      const dx = best.b.x - best.a.x, dz = best.b.z - best.a.z;
      const l = Math.hypot(dx, dz) || 1;
      const l2 = l * l;
      const t = Math.max(0, Math.min(1, ((px - best.a.x) * dx + (pz - best.a.z) * dz) / l2));
      // keep clear of wall ends (doorways) by one prop half-width
      if (t * l < 0.7 || (1 - t) * l < 0.7) continue;
      const cx = best.a.x + dx * t, cz = best.a.z + dz * t;
      let nx = -dz / l, nz = dx / l;
      if (!pointInPoly(poly, cx + nx * (best.thickness / 2 + 0.8), cz + nz * (best.thickness / 2 + 0.8))) { nx = -nx; nz = -nz; }
      out.push({ x: cx + nx * (best.thickness / 2), z: cz + nz * (best.thickness / 2), nx, nz, tx: dx / l, tz: dz / l, thick: best.thickness, h: best.height });
    }
  }
  return out;
}

function spaced(samples: WallSample[], spacing: number, avoid: Vec2[], avoidR: number, max = 99): WallSample[] {
  const out: WallSample[] = [];
  for (const s of samples) {
    if (out.length >= max) break;
    if (avoid.some((p) => Math.hypot(p.x - s.x, p.z - s.z) < avoidR)) continue;
    if (out.some((o) => Math.hypot(o.x - s.x, o.z - s.z) < spacing)) continue;
    out.push(s);
  }
  return out;
}

const BOOKS = ['#6b2a3a', '#2e4a6b', '#4a6b3a', '#6b5a2a', '#4a2f6b', '#2a5a5a', '#7a4a2a'];

function bookshelf(b: Bld, s: WallSample): void {
  const rot = Math.atan2(-s.tz, s.tx);
  const dep = 0.5, w = 1.9, hh = 2.5;
  const cx = s.x + s.nx * (dep / 2 + 0.02), cz = s.z + s.nz * (dep / 2 + 0.02);
  b.lit.add(BOX, PAL.woodDark, [cx, hh / 2, cz], [0, rot, 0], [w, hh, dep], { gradient: 0.3, jitter: 0.08 });
  const rows = 4;
  for (let r = 0; r < rows; r++) {
    const y = 0.45 + r * 0.55;
    let off = -w / 2 + 0.12;
    while (off < w / 2 - 0.2) {
      const bw = 0.07 + b.rand() * 0.09;
      const bh = 0.28 + b.rand() * 0.18;
      const bx = cx + s.tx * (off + bw / 2) + s.nx * (dep / 2 - 0.02);
      const bz = cz + s.tz * (off + bw / 2) + s.nz * (dep / 2 - 0.02);
      b.lit.add(BOX, BOOKS[Math.floor(b.rand() * BOOKS.length)], [bx, y + bh / 2, bz], [0, rot, 0], [bw, bh, 0.28], { gradient: 0.1, jitter: 0.1 });
      off += bw + 0.01;
    }
    b.lit.add(BOX, PAL.wood, [cx, y - 0.04, cz], [0, rot, 0], [w - 0.06, 0.06, dep - 0.04], { gradient: 0 });
  }
}

// -------------------------------------------------------------------------------------------------- roofs
export interface RoofBuild { roomId: string; geo: THREE.BufferGeometry; centre: Vec2 }

export function buildRoofs(map: MapDef, ids: string[], skip: ReadonlySet<string>): RoofBuild[] {
  const out: RoofBuild[] = [];
  for (const room of map.rooms) {
    if (!ids.includes(room.id) || room.polygon.length < 3) continue;
    const rand = seeded('roof:' + room.id);
    const c = centroid(room.polygon);
    let h0 = 3.4;
    for (const w of map.walls) {
      if (skip.has(w.id)) continue;
      const near = distToEdges(room.polygon, w.a.x, w.a.z) < 1 && distToEdges(room.polygon, w.b.x, w.b.z) < 1;
      if (near) h0 = Math.max(h0, w.height);
    }
    const apex = h0 + 1.7;
    const tb = new TriBuilder();
    const pts = room.polygon.map((p) => {
      const dx = p.x - c.x, dz = p.z - c.z;
      const l = Math.hypot(dx, dz) || 1;
      return { x: p.x + (dx / l) * 0.55, z: p.z + (dz / l) * 0.55 };
    });
    const cols = ['#1d2250', '#232a5c', '#181d46', '#262d62'].map((h) => new THREE.Color(h));
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], d = pts[(i + 1) % pts.length];
      const k = cols[Math.floor(rand() * cols.length)];
      tb.tri([a.x, h0, a.z], [d.x, h0, d.z], [c.x, apex, c.z], [k.r, k.g, k.b], [(a.x + d.x) / 2 - c.x, 0.4, (a.z + d.z) / 2 - c.z]);
      // eave fascia
      tb.tri([a.x, h0, a.z], [d.x, h0, d.z], [d.x, h0 - 0.28, d.z], [0.04, 0.05, 0.12], [(a.x + d.x) / 2 - c.x, 0, (a.z + d.z) / 2 - c.z]);
      tb.tri([a.x, h0, a.z], [d.x, h0 - 0.28, d.z], [a.x, h0 - 0.28, a.z], [0.04, 0.05, 0.12], [(a.x + d.x) / 2 - c.x, 0, (a.z + d.z) / 2 - c.z]);
    }
    const g = tb.build();
    if (g) out.push({ roomId: room.id, geo: g, centre: c });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------- landmarks
function pierModel(b: Bld): void {
  // The pier room is a walled dock pocket whose whole floor is planking (terrain.ts). This dresses it: mooring posts and rope
  // along the harbour wall, lamp posts, a big stern lantern, a moored rowboat and Thing's plinth. Local frame: origin = landmark, front = -Z.
  for (let i = -2; i <= 2; i++) {
    const x = i * 3.4;
    b.lit.add(CYL6, PAL.woodDark, [x, 0.3, 3.4], [0, 0, 0], [0.17, 0.6, 0.17], { gradient: 0.2 });
    b.lit.add(ICO0, '#2a1c14', [x, 0.62, 3.4], [0, 0, 0], 0.2, { gradient: 0.1 });
    if (i < 2) b.lit.add(BOX, '#3a2a20', [x + 1.7, 0.4 - Math.abs(Math.sin(i * 2)) * 0.08, 3.4], [0, 0, 0], [3.2, 0.05, 0.05], { gradient: 0 });
  }
  for (const s of [-1, 1]) {
    lampPost(b, s * 6.6, -3.2, 3.0);
    lampPost(b, s * 6.6, 2.4, 3.0);
  }
  b.lit.add(CYL6, PAL.woodDark, [0, 2.2, 3.8], [0, 0, 0], [0.12, 4.4, 0.12], { gradient: 0.2 });
  b.lit.add(BOX, PAL.woodDark, [0.7, 4.2, 3.8], [0, 0, 0], [1.4, 0.1, 0.1], { gradient: 0 });
  b.lantern(1.3, 3.85, 3.8, 5.0, '#ffb347', 1.0);
  b.lit.add(PRISM, '#5b3aa0', [-0.7, 3.9, 3.8], [0, 0, Math.PI / 2], [1.3, 1.4, 0.05], { gradient: 0 });
  b.lit.add(PRISM, '#4d3425', [-4.2, 0.5, 5.4], [Math.PI, 0.2, 0], [1.7, 1.1, 4.0], { gradient: 0.1 });
  b.lit.add(CYL6, PAL.woodDark, [-4.0, 2.2, 5.3], [0.05, 0, 0.04], [0.06, 3.4, 0.06], { gradient: 0 });
  b.lit.add(ICO0, '#4a4034', [7.2, 0.25, 1.4], [0, 0.5, 0], [0.7, 0.35, 0.6], { gradient: 0.3 });
  b.lit.add(ICO0, '#5a4a3a', [6.6, 0.2, 0.7], [0, 1.2, 0], [0.5, 0.3, 0.5], { gradient: 0.3 });
  thingPlinth(b, -2.3, -4.4);
}

function thingPlinth(b: Bld, x: number, z: number): void {
  b.lit.add(BOX, PAL.stone[1], [x, 0.38, z], [0, 0.2, 0], [0.9, 0.76, 0.9], { gradient: 0.35 });
  b.lit.add(BOX, PAL.stoneLight, [x, 0.8, z], [0, 0.2, 0], [1.05, 0.1, 1.05], { gradient: 0 });
}

function greenhouse(b: Bld): void {
  const L = 9, W = 5.2;
  const ribs = 7;
  for (let i = 0; i < ribs; i++) {
    const z = -L / 2 + (i / (ribs - 1)) * L;
    for (const s of [-1, 1]) {
      b.lit.add(BOX, '#2c3150', [s * W / 2, 1.1, z], [0, 0, 0], [0.09, 2.2, 0.09], { gradient: 0.2 });
      b.lit.add(BOX, '#2c3150', [s * W / 4, 2.65, z], [0, 0, s * -0.62], [W * 0.5, 0.08, 0.09], { gradient: 0.1 });
    }
    b.lit.add(ICO0, '#2c3150', [0, 3.2, z], [0, 0, 0], 0.11, { gradient: 0 });
  }
  b.lit.add(BOX, '#2c3150', [0, 3.2, 0], [0, 0, 0], [0.08, 0.08, L], { gradient: 0 });
  for (const s of [-1, 1]) b.lit.add(BOX, '#2c3150', [s * W / 2, 0.9, 0], [0, 0, 0], [0.08, 0.08, L], { gradient: 0 });
  // glass: back wall + sparse roof panes (front stays open so it reads as a ruined, walkable conservatory)
  b.glass.add(BOX, '#7ad8c0', [0, 1.5, L / 2 - 0.02], [0, 0, 0], [W, 2.8, 0.03], { gradient: 0, jitter: 0.04 });
  for (let i = 0; i < ribs - 1; i++) {
    if (b.rand() < 0.4) continue;
    const z = -L / 2 + ((i + 0.5) / (ribs - 1)) * L;
    for (const s of [-1, 1]) if (b.rand() < 0.75) b.glass.add(BOX, '#7ad8c0', [s * W / 4, 2.65, z], [0, 0, s * -0.62], [W * 0.46, 0.03, L / (ribs - 1) - 0.12], { gradient: 0, jitter: 0.05 });
  }
  // planters with glowing plants
  for (const s of [-1, 1]) {
    b.lit.add(BOX, PAL.woodDark, [s * 1.7, 0.3, 0], [0, 0, 0], [0.9, 0.6, L - 1.2], { gradient: 0.3 });
    b.lit.add(BOX, '#1d2a22', [s * 1.7, 0.62, 0], [0, 0, 0], [0.8, 0.06, L - 1.3], { gradient: 0 });
    for (let i = 0; i < 6; i++) {
      const z = -L / 2 + 1.2 + i * 1.35;
      const hh = 0.7 + b.rand() * 0.9;
      b.lit.add(CONE6, ['#2f6b4a', '#3b7a52', '#25563f'][i % 3], [s * 1.7, 0.6 + hh / 2, z], [0, b.rand() * 6, 0], [0.32, hh, 0.32], { gradient: 0.2 });
      b.em.add(ICO0, i % 2 ? '#c8a2ff' : '#7bffd0', [s * 1.7, 0.6 + hh, z], [0, 0, 0], 0.09, { jitter: 0, gradient: 0 });
      if (i % 2 === 0) b.glows.push({ x: s * 1.7, y: 0.6 + hh, z, size: 1.1, color: i % 4 === 0 ? '#c8a2ff' : '#7bffd0', alpha: 0.6, flicker: 0.4, fogFloor: 0.1 });
    }
  }
  b.lantern(0, 2.7, 0, 3.2, '#9affc8', 0.7);
}

function iagoTowerModel(b: Bld, cx: number, cz: number, rect: { minX: number; maxX: number; minZ: number; maxZ: number }, wallTop: number): void {
  // The tower room is a walled keep (wallTop m high). Its ceiling is a stone slab with a round well above the deposit circle;
  // the gothic tower rises from the keep, with a glowing rune ceiling at the top of the well.
  const hole = 3.3;
  const cvr = (x0: number, x1: number, z0: number, z1: number): void => {
    if (x1 - x0 < 0.05 || z1 - z0 < 0.05) return;
    b.lit.add(BOX, PAL.stoneDark, [(x0 + x1) / 2, wallTop - 0.2, (z0 + z1) / 2], [0, 0, 0], [x1 - x0, 0.4, z1 - z0], { gradient: 0.1 });
    b.lit.add(BOX, '#252a56', [(x0 + x1) / 2, wallTop - 0.55, (z0 + z1) / 2], [0, 0, 0], [x1 - x0 - 0.2, 0.3, z1 - z0 - 0.2], { gradient: 0.1 });
  };
  cvr(rect.minX, cx - hole, rect.minZ, rect.maxZ);
  cvr(cx + hole, rect.maxX, rect.minZ, rect.maxZ);
  cvr(cx - hole, cx + hole, rect.minZ, cz - hole);
  cvr(cx - hole, cx + hole, cz + hole, rect.maxZ);
  const shaftR = Math.min(4.3, (rect.maxX - rect.minX) / 2 - 0.5);
  const shaftH = 24;
  const y0 = wallTop;
  b.lit.add(CYL8, b.stone(), [cx, y0 + shaftH / 2, cz], [0, 0.4, 0], [shaftR, shaftH, shaftR], { gradient: 0.5 });
  b.lit.add(CYL8, '#1c2050', [cx, y0 + 7, cz], [0, 0.4, 0], [-(hole + 0.15), 14, hole + 0.15], { gradient: 0.2 });
  b.em.add(CYL8, '#caa4ff', [cx, y0 + 14.1, cz], [0, 0, 0], [hole + 0.1, 0.1, hole + 0.1], { jitter: 0, gradient: 0 });
  b.glows.push({ x: cx, y: y0 + 13, z: cz, size: 9, color: '#b79cff', alpha: 0.55, flicker: 0.3, fogFloor: 0.2 });
  for (let k = 0; k < 7; k++) {
    const y = y0 + 2.6 + k * 3.2;
    b.lit.add(CYL8, PAL.stoneDark, [cx, y, cz], [0, 0.4, 0], [shaftR * 1.07, 0.35, shaftR * 1.07], { gradient: 0 });
    for (let j = 0; j < 5; j++) {
      if ((j + k) % 3 === 0) continue;
      const a = (j / 5) * Math.PI * 2 + k * 0.7;
      const wx = cx + Math.cos(a) * (shaftR + 0.04), wz = cz + Math.sin(a) * (shaftR + 0.04);
      b.win(wx, y + 1.3, wz, 0.7, 1.7, -a + Math.PI / 2, k % 2 ? '#ffb85a' : '#b79cff', 0.5);
    }
  }
  const topY = y0 + shaftH;
  b.lit.add(CYL8, PAL.stoneDark, [cx, topY + 0.3, cz], [0, 0.4, 0], [shaftR * 1.3, 0.6, shaftR * 1.3], { gradient: 0.1 });
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    b.lit.add(BOX, b.stone(), [cx + Math.cos(a) * shaftR * 0.95, topY + 2.3, cz + Math.sin(a) * shaftR * 0.95], [0, -a, 0], [0.5, 3.4, 0.5], { gradient: 0.3 });
    b.em.add(BOX, '#ffcf80', [cx + Math.cos(a + 0.78) * shaftR * 0.92, topY + 2.3, cz + Math.sin(a + 0.78) * shaftR * 0.92], [0, -a - 0.78, 0], [1.0, 2.2, 0.08], { jitter: 0, gradient: 0 });
  }
  b.lit.add(CYL8, PAL.stoneDark, [cx, topY + 4.3, cz], [0, 0, 0], [shaftR * 1.2, 0.5, shaftR * 1.2], { gradient: 0 });
  b.lit.add(CONE8, PAL.roof, [cx, topY + 4.55 + 6.5, cz], [0, 0.4, 0], [shaftR * 1.25, 13, shaftR * 1.25], { gradient: 0.2 });
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2;
    b.lit.add(CONE4, PAL.roof, [cx + Math.cos(a) * shaftR * 1.0, topY + 5.8, cz + Math.sin(a) * shaftR * 1.0], [0, -a + Math.PI / 4, 0], [0.5, 2.4, 0.5], { gradient: 0 });
  }
  b.lit.add(CYL6, PAL.iron, [cx, topY + 4.55 + 14.2, cz], [0, 0, 0], [0.06, 3, 0.06], { gradient: 0 });
  b.em.add(ICO0, '#c8a2ff', [cx, topY + 4.55 + 15.8, cz], [0, 0, 0], 0.35, { jitter: 0, gradient: 0 });
  b.glows.push({ x: cx, y: topY + 4.55 + 15.8, z: cz, size: 12, color: '#c8a2ff', alpha: 0.95, flicker: 0.5, fogFloor: 0.9 });
  b.glows.push({ x: cx, y: topY + 2.3, z: cz, size: 15, color: '#ffcf80', alpha: 0.55, flicker: 0.2, fogFloor: 0.6 });
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const x = (sx < 0 ? rect.minX : rect.maxX) - sx * 0.1, z = (sz < 0 ? rect.minZ : rect.maxZ) - sz * 0.1;
    b.lit.add(CYL8, b.stone(), [x, wallTop + 1.2, z], [0, 0.4, 0], [0.8, 2.4, 0.8], { gradient: 0.3 });
    b.lit.add(CONE8, PAL.roof, [x, wallTop + 3.4, z], [0, 0.4, 0], [1.05, 2.4, 1.05], { gradient: 0.1 });
  }
  pointedArch(b, cx, rect.maxZ, 3.4, 3.4, 0.5, 0, PAL.stoneLight);
  for (const s of [-1, 1]) b.lit.add(BOX, s < 0 ? '#5b3aa0' : '#7a2a50', [cx + s * 3.0, wallTop - 3.4, rect.maxZ + 0.35], [0, 0, 0], [0.7, 3.0, 0.08], { gradient: 0 });
}

function researchCentre(b: Bld): void {
  // rug + hanging chandelier (nothing the player would read as an obstacle)
  b.lit.add(BOX, '#2e1218', [0, 0.065, 0], [0, 0, 0], [5.6, 0.025, 3.7], { gradient: 0 });
  b.lit.add(BOX, '#5a1f2a', [0, 0.08, 0], [0, 0, 0], [5.2, 0.025, 3.3], { gradient: 0 });
  b.lit.add(BOX, '#b8903f', [0, 0.095, 0], [0, 0, 0], [4.3, 0.02, 2.4], { gradient: 0, jitter: 0.02 });
  b.lit.add(BOX, '#4a1822', [0, 0.11, 0], [0, 0, 0], [4.1, 0.02, 2.2], { gradient: 0 });
  b.lit.add(TORUS, '#6a5a2a', [0, 2.9, 0], [Math.PI / 2, 0, 0], [0.7, 0.7, 0.7], { gradient: 0 });
  b.lit.add(CYL6, PAL.iron, [0, 3.25, 0], [0, 0, 0], [0.02, 0.7, 0.02], { gradient: 0 });
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    b.em.add(CONE4, '#ffd68a', [Math.cos(a) * 0.7, 3.0, Math.sin(a) * 0.7], [0, 0, 0], [0.05, 0.2, 0.05], { jitter: 0, gradient: 0 });
  }
  b.glows.push({ x: 0, y: 3.05, z: 0, size: 4.2, color: '#ffc880', alpha: 0.65, flicker: 0.35, fogFloor: 0.15 });
}

function shrineModel(b: Bld): void {
  // two carved standing stones with cyan runes flanking the way in
  for (const s of [-1, 1]) {
    b.lit.add(BOX, PAL.stoneDark, [s * 3.2, 0.2, 0], [0, 0, 0], [1.0, 0.4, 1.0], { gradient: 0.2 });
    b.lit.add(BOX, b.stone(), [s * 3.2, 1.6, 0], [0, s * 0.1, 0], [0.62, 2.8, 0.62], { gradient: 0.4 });
    b.lit.add(CONE4, PAL.stoneDark, [s * 3.2, 3.4, 0], [0, 0.8, 0], [0.5, 0.9, 0.5], { gradient: 0 });
    for (let k = 0; k < 4; k++) b.em.add(BOX, '#6fe8ff', [s * 3.2, 0.8 + k * 0.6, -0.32], [0, 0, 0], [0.26, 0.05, 0.05], { jitter: 0, gradient: 0 });
    b.glows.push({ x: s * 3.2, y: 1.8, z: -0.4, size: 2.6, color: '#6fe8ff', alpha: 0.5, flicker: 0.4, fogFloor: 0.1 });
  }
}

function cryptModel(b: Bld): void {
  // a faint sigil in the floor; gravestones and flame braziers come from the room dressing so nothing sits in the walkways
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    b.em.add(BOX, '#7bffb0', [Math.cos(a) * 2.0, 0.075, Math.sin(a) * 2.0], [0, -a, 0], [0.5, 0.02, 0.1], { jitter: 0, gradient: 0 });
  }
}

function gateModel(b: Bld): void {
  for (const s of [-1, 1]) {
    b.lit.add(BOX, b.stone(), [s * 2.2, 1.9, 0], [0, 0, 0], [0.9, 3.8, 0.9], { gradient: 0.4 });
    b.lit.add(CONE4, PAL.stoneDark, [s * 2.2, 4.3, 0], [0, Math.PI / 4, 0], [0.8, 1.2, 0.8], { gradient: 0 });
    b.lantern(s * 2.2, 3.4, -0.55, 3.0, '#b79cff', 0.8);
  }
  b.lit.add(BOX, PAL.stoneDark, [0, 3.9, 0], [0, 0, 0], [5.1, 0.5, 0.8], { gradient: 0.2 });
}

// ---------------------------------------------------------------------------------------------------- the whole lot
export interface DressingBuild {
  col: Collector;
  /** hiding-spot models, kept apart so they can fade while the player is hidden inside one */
  hide: Collector;
  roofs: RoofBuild[];
  pools: THREE.BufferGeometry | null;
  runes: THREE.BufferGeometry | null; // deposit circle
  shrineRunes: THREE.BufferGeometry | null;
  piers: PierRect[];
  thing: { x: number; y: number; z: number; yaw: number };
  tower: { x: number; z: number; r: number };
  gate: { wall: WallDef; posts: THREE.BufferGeometry | null; bars: THREE.BufferGeometry | null } | null;
  swtch: { x: number; z: number; yaw: number } | null;
}

/** The dock pocket is planked in terrain.ts, so no ground is carved away any more. */
export function pierRects(_map: MapDef): PierRect[] {
  return [];
}

function disc(tb: TriBuilder, x: number, z: number, r: number, y: number, c: [number, number, number], segs = 16): void {
  for (let i = 0; i < segs; i++) {
    const a0 = (i / segs) * Math.PI * 2, a1 = ((i + 1) / segs) * Math.PI * 2;
    tb.triC([x, y, z], [x + Math.cos(a0) * r, y, z + Math.sin(a0) * r], [x + Math.cos(a1) * r, y, z + Math.sin(a1) * r], c, [0, 0, 0], [0, 0, 0], [0, 1, 0]);
  }
}
function ringStrip(tb: TriBuilder, x: number, z: number, r0: number, r1: number, y: number, c: [number, number, number], segs = 48): void {
  for (let i = 0; i < segs; i++) {
    const a0 = (i / segs) * Math.PI * 2, a1 = ((i + 1) / segs) * Math.PI * 2;
    const p = (r: number, a: number): [number, number, number] => [x + Math.cos(a) * r, y, z + Math.sin(a) * r];
    tb.tri(p(r0, a0), p(r1, a0), p(r1, a1), c, [0, 1, 0]);
    tb.tri(p(r0, a0), p(r1, a1), p(r0, a1), c, [0, 1, 0]);
  }
}

export function buildDressing(map: MapDef, low: boolean): DressingBuild {
  const col = new Collector();
  const gateId = map.powerSwitch?.gateWallId;
  const skip = new Set<string>(gateId ? [gateId] : []);
  const piers = pierRects(map);
  const poolTb = new TriBuilder();
  const warm: [number, number, number] = [0.13, 0.08, 0.03];

  const hideCol = new Collector();
  buildHidingSpots(map, hideCol, skip);

  // ---- landmarks
  let thing = { x: map.playerStart.x + 1.4, y: 0.0, z: map.playerStart.z - 1.6, yaw: map.playerStart.yaw };
  let thingSet = false;
  const gateWall = gateId ? map.walls.find((w) => w.id === gateId) ?? null : null;
  const gateMid = gateWall ? { x: (gateWall.a.x + gateWall.b.x) / 2, z: (gateWall.a.z + gateWall.b.z) / 2 } : null;
  for (const lm of map.landmarks) {
    const sc = lm.scale > 0 ? lm.scale : 1;
    const b = new Bld(seeded('lm:' + lm.id));
    switch (lm.kind) {
      case 'pier': {
        pierModel(b);
        const s = Math.sin(lm.yaw), c = Math.cos(lm.yaw);
        const lx = -2.3 * sc, lz = -4.4 * sc;
        thing = { x: lm.x + lx * c + lz * s, y: 0.86 * sc, z: lm.z - lx * s + lz * c, yaw: lm.yaw + 0.5 };
        thingSet = true;
        break;
      }
      case 'greenhouse': greenhouse(b); break;
      case 'lamp':
        lampPost(b, 0, 0, 3.4);
        disc(poolTb, lm.x, lm.z, 3.6 * sc, 0.1, warm, 14);
        break;
      case 'gate':
        if (gateMid && Math.hypot(gateMid.x - lm.x, gateMid.z - lm.z) < 3.5) continue; // the gate wall itself is dressed below
        gateModel(b);
        break;
      case 'crypt': cryptModel(b); break;
      case 'research_hall': researchCentre(b); break;
      case 'egg_shrine': shrineModel(b); break;
      case 'iago_tower': continue; // built at map.tower below so the deposit circle sits inside the arcade
    }
    col.add(b.finish(lm.x, lm.z, lm.yaw, sc));
  }
  if (!thingSet) thing.y = 0;

  // ---- tower (always centred on the deposit zone; extents from the tower room and its walls)
  {
    const b = new Bld(seeded('tower'));
    const tr = map.rooms.find((r) => r.id === 'tower');
    const xs = tr ? tr.polygon.map((p) => p.x) : [map.tower.x - 5, map.tower.x + 5];
    const zs = tr ? tr.polygon.map((p) => p.z) : [map.tower.z - 5, map.tower.z + 5];
    const rect = { minX: Math.min(...xs), maxX: Math.max(...xs), minZ: Math.min(...zs), maxZ: Math.max(...zs) };
    let wallTop = 0;
    for (const w of map.walls) {
      const mx = (w.a.x + w.b.x) / 2, mz = (w.a.z + w.b.z) / 2;
      if (mx >= rect.minX - 0.6 && mx <= rect.maxX + 0.6 && mz >= rect.minZ - 0.6 && mz <= rect.maxZ + 0.6) wallTop = Math.max(wallTop, w.height);
    }
    if (wallTop < 3) wallTop = 9;
    iagoTowerModel(b, map.tower.x, map.tower.z, rect, wallTop);
    col.add(b.finish(0, 0, 0, 1));
  }

  // ---- room interiors
  const avoid: Vec2[] = [...map.clues.map((c) => ({ x: c.x, z: c.z })), map.eggSpawn, ...map.hidingSpots.map((h) => ({ x: h.x, z: h.z }))];
  for (const room of map.rooms) {
    const b = new Bld(seeded('room:' + room.id));
    const samples = roomWallSamples(map, room, 0.5, skip);
    if (room.id === 'research_room') {
      for (const s of spaced(samples, 2.5, avoid, 2.0, low ? 4 : 9)) bookshelf(b, s);
      for (const s of spaced(samples.filter((q) => q.h >= 3), 4.2, [], 0, 6)) {
        // windows on the outside faces: glowing lancets
        const wx = s.x - s.nx * (s.thick + 0.03), wz = s.z - s.nz * (s.thick + 0.03);
        b.win(wx, 1.9, wz, 0.9, 1.6, Math.atan2(-s.nx * -1, -s.nz * -1) + Math.PI, '#ffcf80', 0.8);
      }
    } else if (room.id === 'egg_chamber') {
      for (const s of spaced(samples, 3.6, avoid, 2.2, 6)) brazier(b, s.x + s.nx * 0.45, s.z + s.nz * 0.45, '#6fe8ff', 1.2);
    } else if (room.id === 'crypt') {
      for (const s of spaced(samples, 3.1, avoid, 2.0, low ? 3 : 8)) {
        const rot = Math.atan2(-s.tz, s.tx);
        const x = s.x + s.nx * 0.4, z = s.z + s.nz * 0.4;
        b.lit.add(BOX, b.stone(), [x, 0.55, z], [0.06, rot, 0.05], [0.7, 1.1, 0.18], { gradient: 0.4 });
        b.lit.add(BOX, PAL.woodDark, [x + s.nx * 0.5, 0.35, z + s.nz * 0.5], [0, rot, 0], [0.6, 0.3, 0.4], { gradient: 0.3 });
        b.em.add(CONE6, '#8affc8', [x + s.nx * 0.5, 0.62, z + s.nz * 0.5], [0, 0, 0], [0.04, 0.16, 0.04], { jitter: 0, gradient: 0 });
        b.glows.push({ x: x + s.nx * 0.5, y: 0.66, z: z + s.nz * 0.5, size: 1.5, color: '#8affc8', alpha: 0.55, flicker: 0.8, fogFloor: 0.1 });
      }
    } else if (room.id === 'courtyard' || room.id === 'tower') {
      for (const s of spaced(samples, 6.5, [], 0, 5)) {
        lampPost(b, s.x + s.nx * 0.5, s.z + s.nz * 0.5, 3.0, '#ffc060');
        disc(poolTb, s.x + s.nx * 0.5, s.z + s.nz * 0.5, 3.2, 0.1, warm, 12);
      }
    }
    col.add(b.finish(0, 0, 0, 1));
  }

  // ---- start lamps: two lamp posts framing the player start so the first view is lit and readable
  {
    const b = new Bld(seeded('startlamps'));
    const ps = map.playerStart;
    const f = { x: -Math.sin(ps.yaw), z: -Math.cos(ps.yaw) };
    const rgt = { x: -f.z, z: f.x };
    for (const s of [-1, 1]) {
      const x = ps.x + f.x * 1.6 + rgt.x * s * 3.8, z = ps.z + f.z * 1.6 + rgt.z * s * 3.8;
      lampPost(b, x, z, 3.1);
      disc(poolTb, x, z, 3.6, 0.1, warm, 12);
    }
    col.add(b.finish(0, 0, 0, 1));
  }

  // ---- egg nest + rune circle at the spawn
  const shrineTb = new TriBuilder();
  {
    const b = new Bld(seeded('nest'));
    const e = map.eggSpawn;
    b.lit.add(CYL12, PAL.stoneDark, [e.x, 0.12, e.z], [0, 0, 0], [0.95, 0.24, 0.95], { gradient: 0.1 });
    b.lit.add(CYL12, '#2c3260', [e.x, 0.27, e.z], [0, 0, 0], [0.78, 0.1, 0.78], { gradient: 0 });
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2;
      b.lit.add(CONE4, '#3a2a20', [e.x + Math.cos(a) * 0.62, 0.45, e.z + Math.sin(a) * 0.62], [Math.sin(a) * 0.7, 0, -Math.cos(a) * 0.7], [0.05, 0.55, 0.05], { gradient: 0 });
    }
    col.add(b.finish(0, 0, 0, 1));
    ringStrip(shrineTb, e.x, e.z, 2.35, 2.5, 0.075, [0.12, 0.36, 0.42]);
    ringStrip(shrineTb, e.x, e.z, 1.35, 1.42, 0.075, [0.1, 0.28, 0.34]);
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      ringStrip(shrineTb, e.x + Math.cos(a) * 1.9, e.z + Math.sin(a) * 1.9, 0.0, 0.16, 0.075, [0.14, 0.4, 0.48], 5);
    }
  }

  // ---- deposit circle runes
  const rt = new TriBuilder();
  {
    const t = map.tower;
    const R = Math.max(1.4, t.radius);
    const c1: [number, number, number] = [0.55, 0.38, 0.12];
    const c2: [number, number, number] = [0.42, 0.22, 0.6];
    ringStrip(rt, t.x, t.z, R * 0.97, R, 0.09, c1);
    ringStrip(rt, t.x, t.z, R * 0.83, R * 0.85, 0.09, c2);
    ringStrip(rt, t.x, t.z, R * 0.5, R * 0.53, 0.09, c1);
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      // radial ticks and diamond glyphs between the rings
      const ca = Math.cos(a), sa = Math.sin(a);
      rt.tri([t.x + ca * R * 0.53, 0.09, t.z + sa * R * 0.53], [t.x + ca * R * 0.83 - sa * 0.07, 0.09, t.z + sa * R * 0.83 + ca * 0.07], [t.x + ca * R * 0.83 + sa * 0.07, 0.09, t.z + sa * R * 0.83 - ca * 0.07], c2, [0, 1, 0]);
      const gx = t.x + ca * R * 0.91, gz = t.z + sa * R * 0.91;
      rt.tri([gx + ca * 0.18, 0.09, gz + sa * 0.18], [gx - sa * 0.1, 0.09, gz + ca * 0.1], [gx - ca * 0.18, 0.09, gz - sa * 0.18], c1, [0, 1, 0]);
      rt.tri([gx + ca * 0.18, 0.09, gz + sa * 0.18], [gx - ca * 0.18, 0.09, gz - sa * 0.18], [gx + sa * 0.1, 0.09, gz - ca * 0.1], c1, [0, 1, 0]);
    }
    // 8-point star
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2, a2 = ((i + 3) / 8) * Math.PI * 2;
      const r = R * 0.5;
      const p0 = [t.x + Math.cos(a) * r, t.z + Math.sin(a) * r], p1 = [t.x + Math.cos(a2) * r, t.z + Math.sin(a2) * r];
      const dx = p1[0] - p0[0], dz = p1[1] - p0[1], l = Math.hypot(dx, dz) || 1;
      const nx = -dz / l * 0.03, nz = dx / l * 0.03;
      rt.tri([p0[0] - nx, 0.09, p0[1] - nz], [p0[0] + nx, 0.09, p0[1] + nz], [p1[0] + nx, 0.09, p1[1] + nz], c2, [0, 1, 0]);
      rt.tri([p0[0] - nx, 0.09, p0[1] - nz], [p1[0] + nx, 0.09, p1[1] + nz], [p1[0] - nx, 0.09, p1[1] - nz], c2, [0, 1, 0]);
    }
  }

  // ---- gate (portcullis dynamic; posts static)
  let gate: DressingBuild['gate'] = null;
  if (gateWall) {
    const g = buildGateGeometry(gateWall, low);
    gate = { wall: gateWall, posts: g.posts, bars: g.bars };
  }
  const swtch = map.powerSwitch ? { x: map.powerSwitch.x, z: map.powerSwitch.z, yaw: switchYaw(map) } : null;

  const roofs = buildRoofs(map, ['research_room', 'egg_chamber'], skip);
  return { col, hide: hideCol, roofs, pools: poolTb.build(false), runes: rt.build(false), shrineRunes: shrineTb.build(false), piers, thing, tower: { x: map.tower.x, z: map.tower.z, r: map.tower.radius }, gate, swtch };
}

function switchYaw(map: MapDef): number {
  const s = map.powerSwitch;
  if (!s) return 0;
  const nw = nearestWall(map, s.x, s.z);
  if (!nw) return 0;
  const w = nw.wall;
  const dx = w.b.x - w.a.x, dz = w.b.z - w.a.z;
  const l2 = dx * dx + dz * dz || 1;
  const t = Math.max(0, Math.min(1, ((s.x - w.a.x) * dx + (s.z - w.a.z) * dz) / l2));
  return yawOf(s.x - (w.a.x + dx * t), s.z - (w.a.z + dz * t));
}
