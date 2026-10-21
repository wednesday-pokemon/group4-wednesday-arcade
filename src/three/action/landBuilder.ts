// Land polygons -> low-poly rocky shores (ring-extruded with noisy heights), mounds, shoreline foam + shallows bands,
// tree/reed placements and a rim of hills around the lake basin. Static: built once per course.
import * as THREE from 'three';
import type { CourseDef, LandMass, Vec2 } from '../../action/types.ts';
import { MeshBuilder, mulberry32 } from '../util.ts';
import {
  TriBuilder, centroid, distToEdges, ensureCCW, mergeAll, outwardNormals, pointInPoly, resample, thicknessAlongInward, type V3,
} from './geom.ts';

export interface Spot { x: number; y: number; z: number; s: number; rot: number }

export interface LandBuild {
  lit: THREE.BufferGeometry | null;
  foam: THREE.BufferGeometry | null;
  trees: Spot[];
  reeds: Spot[];
  wisps: Spot[];
}

const ROCK_HI: V3 = [0.23, 0.26, 0.45];
const ROCK_MID: V3 = [0.17, 0.2, 0.37];
const ROCK_LO: V3 = [0.1, 0.12, 0.25];
const SOIL: V3 = [0.1, 0.14, 0.24];
const SOIL_B: V3 = [0.1, 0.17, 0.2];
const ICO = new THREE.IcosahedronGeometry(1, 0);

const mix3 = (a: number[], b: number[], t: number): V3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const jit = (c: V3, rand: () => number, amt: number): V3 => {
  const j = 1 + (rand() - 0.5) * 2 * amt;
  return [c[0] * j, c[1] * j, c[2] * j];
};

export interface BuildOptions { lowGraphics: boolean; exclusions: { x: number; z: number; r: number }[] }

export function buildLand(course: CourseDef, opts: BuildOptions): LandBuild {
  const rand = mulberry32(1337);
  const lit: (THREE.BufferGeometry | null)[] = [];
  const foam = new TriBuilder();
  const trees: Spot[] = [];
  const reeds: Spot[] = [];
  const wisps: Spot[] = [];
  const low = opts.lowGraphics;
  const step = low ? 5.5 : 3.6;
  const excluded = (x: number, z: number, extra = 0) => opts.exclusions.some((e) => Math.hypot(e.x - x, e.z - z) < e.r + extra);

  for (const land of course.land ?? []) {
    const lm = buildOne(land, rand, step, low, foam, trees, reeds, wisps, excluded);
    lit.push(lm);
  }
  lit.push(buildRim(course, rand, low, trees, excluded, course.land ?? []));
  return { lit: mergeAll(lit), foam: foam.build(false), trees, reeds, wisps };
}

function buildOne(
  land: LandMass, rand: () => number, step: number, low: boolean, foam: TriBuilder, trees: Spot[], reeds: Spot[], wisps: Spot[],
  excluded: (x: number, z: number, extra?: number) => boolean,
): THREE.BufferGeometry | null {
  if (land.points.length < 3) return null;
  const poly = ensureCCW(land.points);
  const pts = resample(poly, step);
  const n = pts.length;
  const normals = outwardNormals(pts);
  const thick = thicknessAlongInward(pts, normals);
  const h = Math.max(0.35, land.height);
  const reef = land.kind === 'reef';
  const tb = new TriBuilder();

  // per-vertex noise (smooth around the loop) so shores are rocky without moving the waterline outward
  const ph1 = rand() * 6.28, ph2 = rand() * 6.28;
  const nz = (i: number, f: number, p: number) => Math.sin((i / n) * Math.PI * 2 * f + p);
  const rough = (i: number) => 0.5 + 0.5 * (0.6 * nz(i, 7, ph1) + 0.4 * nz(i, 19, ph2));

  const insetD = reef ? [0.6, 1.5, 2.6] : [1.3, 3.6, 7.5];
  const fr = [0.14, 0.28, 0.44];
  const ring = (inset: number, k: number, extraInward = 0): Vec2[] =>
    pts.map((p, i) => {
      const d = Math.min(inset, thick[i] * fr[k]) + extraInward * rough(i);
      return { x: p.x - normals[i].x * d, z: p.z - normals[i].z * d };
    });
  const r0: Vec2[] = pts.map((p, i) => ({ x: p.x + normals[i].x * 0.7, z: p.z + normals[i].z * 0.7 }));
  const r1: Vec2[] = pts.map((p, i) => ({ x: p.x - normals[i].x * 0.25 * rough(i), z: p.z - normals[i].z * 0.25 * rough(i) }));
  const r2 = ring(insetD[0], 0, 0.5);
  const r3 = ring(insetD[1], 1, 0.9);
  const r4 = ring(insetD[2], 2, 1.2);
  const ys = [-1.7, 0.03, h * (0.2 + 0.2 * rand()), h * 0.62, h];
  const yAt = (ringIdx: number, i: number): number => {
    if (ringIdx <= 1) return ys[ringIdx] + (ringIdx === 1 ? 0.05 * rough(i) : 0);
    const base = ys[ringIdx];
    return base + (rough(i) - 0.5) * h * (ringIdx === 2 ? 0.45 : 0.3);
  };
  const rings = [r0, r1, r2, r3, r4];
  const hintFor = (i: number): V3 => [normals[i].x * 0.6, 1, normals[i].z * 0.6];

  for (let k = 0; k < 4; k++) {
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const a: V3 = [rings[k][i].x, yAt(k, i), rings[k][i].z];
      const b: V3 = [rings[k][j].x, yAt(k, j), rings[k][j].z];
      const c: V3 = [rings[k + 1][j].x, yAt(k + 1, j), rings[k + 1][j].z];
      const d: V3 = [rings[k + 1][i].x, yAt(k + 1, i), rings[k + 1][i].z];
      const t = k === 0 ? 0 : (k - 1) / 3;
      const base = k === 0 ? ROCK_LO : mix3(ROCK_MID, k === 3 ? SOIL : ROCK_HI, t);
      const hint = hintFor(i);
      tb.tri(a, b, c, jit(base, rand, 0.22), hint);
      tb.tri(a, c, d, jit(base, rand, 0.22), hint);
    }
  }

  // cap: ear-clip the innermost ring; heights get gentle noise
  const contour = r4.map((p) => new THREE.Vector2(p.x, p.z));
  let tris: number[][] = [];
  try {
    tris = THREE.ShapeUtils.triangulateShape(contour, []);
  } catch {
    tris = [];
  }
  for (const t of tris) {
    const vs = t.map((idx): V3 => [r4[idx].x, yAt(4, idx) + (rough(idx) - 0.5) * h * 0.2, r4[idx].z]);
    tb.tri(vs[0], vs[1], vs[2], jit(mix3(SOIL, SOIL_B, rand()), rand, 0.18), [0, 1, 0]);
  }

  const mb = new MeshBuilder(rand);
  // rocky lumps at the waterline + interior mounds
  let perim = 0;
  for (let i = 0; i < n; i++) perim += Math.hypot(pts[(i + 1) % n].x - pts[i].x, pts[(i + 1) % n].z - pts[i].z);
  const lumpCount = Math.round((perim / 100) * (low ? 7 : 14));
  for (let k = 0; k < lumpCount; k++) {
    const i = Math.floor(rand() * n);
    const s = 0.8 + rand() * (reef ? 2.6 : 1.9);
    const off = rand() * 0.8;
    const pc = mix3(ROCK_MID, ROCK_HI, rand());
    mb.add(ICO, `#${toHex(pc)}`, [pts[i].x - normals[i].x * off, s * 0.25, pts[i].z - normals[i].z * off], [rand() * 3, rand() * 6, rand() * 3], [s * 1.2, s * (0.6 + rand() * 0.6), s], { jitter: 0.15, gradient: 0.5 });
  }
  const c0 = centroid(pts);
  const gstep = low ? 16 : 11;
  let mounds = 0;
  const bbMinX = Math.min(...pts.map((p) => p.x)), bbMaxX = Math.max(...pts.map((p) => p.x));
  const bbMinZ = Math.min(...pts.map((p) => p.z)), bbMaxZ = Math.max(...pts.map((p) => p.z));
  if (!reef) {
    for (let gx = bbMinX; gx < bbMaxX && mounds < 70; gx += gstep) {
      for (let gz = bbMinZ; gz < bbMaxZ && mounds < 70; gz += gstep) {
        const x = gx + (rand() - 0.5) * gstep * 0.8, z = gz + (rand() - 0.5) * gstep * 0.8;
        if (!pointInPoly(poly, x, z)) continue;
        const de = distToEdges(poly, x, z);
        if (de < 5) continue;
        const rr = Math.min(de * 0.75, 4 + rand() * 6);
        const top = h * (0.9 + rand() * 0.9);
        const pc = mix3(SOIL, ROCK_MID, rand() * 0.6);
        mb.add(ICO, `#${toHex(pc)}`, [x, h * 0.6, z], [0, rand() * 6, 0], [rr * 1.3, top * 0.55 + 0.1, rr * 1.3], { jitter: 0.12, gradient: 0.55 });
        mounds++;
      }
    }
  }
  void c0;
  const mbGeo = mb.build();

  // shoreline foam + shallows band along the waterline
  const foamY = 0.06;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const strip = (o0: number, o1: number, c0v: V3, c1v: V3, y: number) => {
      const q = (idx: number, o: number): V3 => [pts[idx].x + normals[idx].x * o, y, pts[idx].z + normals[idx].z * o];
      tb2(foam, q(i, o0), q(j, o0), q(j, o1), q(i, o1), c0v, c0v, c1v, c1v);
    };
    strip(-0.5, 0.9, [0.42, 0.5, 0.78], [0.2, 0.28, 0.5], foamY);
    strip(0.9, 2.8, [0.2, 0.28, 0.5], [0, 0, 0], foamY);
    strip(1.5, reef ? 7 : 8, [0.02, 0.12, 0.17], [0, 0, 0], 0.04);
  }

  // trees (twisted, dead) along the shore + sparse inland; reeds at the water line; wisps over the shallows
  const perim100 = perim / 100;
  const density = land.trees ?? (land.kind === 'shore' ? 5 : 3);
  let want = Math.round(perim100 * density);
  if (land.kind === 'shore' && !low) want += Math.round(perim100 * 2);
  want = Math.min(want, low ? 40 : 110);
  for (let k = 0; k < want; k++) {
    const i = Math.floor(rand() * n);
    const inset = 1.4 + rand() * Math.min(7, thick[i] * 0.4);
    const x = pts[i].x - normals[i].x * inset, z = pts[i].z - normals[i].z * inset;
    if (excluded(x, z, 4)) continue;
    const y = (inset < insetD[0] ? ys[2] : inset < insetD[1] ? ys[3] : h) * 0.9 - 0.1;
    trees.push({ x, y: Math.max(0.1, y), z, s: 0.7 + rand() * 1.1 + (reef ? -0.3 : 0), rot: rand() * 6.28 });
  }
  if (!reef && land.kind === 'shore') {
    const inland = Math.min(low ? 10 : 30, Math.round(perim100 * 1.5));
    for (let k = 0; k < inland; k++) {
      const x = bbMinX + rand() * (bbMaxX - bbMinX), z = bbMinZ + rand() * (bbMaxZ - bbMinZ);
      if (!pointInPoly(poly, x, z) || distToEdges(poly, x, z) < 6 || excluded(x, z, 4)) continue;
      trees.push({ x, y: h * 0.85, z, s: 0.9 + rand() * 1.2, rot: rand() * 6.28 });
    }
  }
  const reedN = Math.min(low ? 24 : 70, Math.round(perim100 * 9));
  for (let k = 0; k < reedN && !reef; k++) {
    const i = Math.floor(rand() * n);
    const o = 0.3 + rand() * 1.2;
    if (excluded(pts[i].x, pts[i].z, 6)) continue;
    reeds.push({ x: pts[i].x + normals[i].x * o, y: 0, z: pts[i].z + normals[i].z * o, s: 0.7 + rand() * 0.9, rot: rand() * 6.28 });
  }
  if (!low && land.kind === 'shore' && rand() < 0.7) {
    for (let k = 0; k < 2; k++) {
      const i = Math.floor(rand() * n);
      wisps.push({ x: pts[i].x + normals[i].x * (3 + rand() * 4), y: 1.4 + rand() * 1.2, z: pts[i].z + normals[i].z * (3 + rand() * 4), s: 1, rot: rand() * 6.28 });
    }
  }
  return mergeAll([tb.build(), mbGeo]);
}

function tb2(tb: TriBuilder, a: V3, b: V3, c: V3, d: V3, ca: V3, cb: V3, cc: V3, cd: V3): void {
  const up: V3 = [0, 1, 0];
  tb.triC(a, b, c, ca, cb, cc, up);
  tb.triC(a, c, d, ca, cc, cd, up);
}

function toHex(c: V3): string {
  const f = (v: number) => Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16).padStart(2, '0');
  return f(c[0]) + f(c[1]) + f(c[2]);
}

/** Hills around the lake basin so the horizon is land, not an endless sea. Skips areas near landmarks and real land. */
function buildRim(
  course: CourseDef, rand: () => number, low: boolean, trees: Spot[], excluded: (x: number, z: number, extra?: number) => boolean, land: LandMass[],
): THREE.BufferGeometry | null {
  const b = course.bounds;
  const margin = 38;
  const minX = b.minX - margin, maxX = b.maxX + margin, minZ = b.minZ - margin, maxZ = b.maxZ + margin;
  const mb = new MeshBuilder(rand);
  const lms = course.landmarks ?? [];
  const per = 2 * ((maxX - minX) + (maxZ - minZ));
  const count = Math.round(per / (low ? 34 : 20));
  for (let k = 0; k < count; k++) {
    // walk the rectangle perimeter
    let d = (k / count) * per + (rand() - 0.5) * 12;
    d = ((d % per) + per) % per;
    const w = maxX - minX, hgt = maxZ - minZ;
    let x: number, z: number;
    if (d < w) { x = minX + d; z = minZ; }
    else if (d < w + hgt) { x = maxX; z = minZ + (d - w); }
    else if (d < 2 * w + hgt) { x = maxX - (d - w - hgt); z = maxZ; }
    else { x = minX; z = maxZ - (d - 2 * w - hgt); }
    x += (rand() - 0.5) * 14;
    z += (rand() - 0.5) * 14;
    // keep the outline of the basin round-ish
    if (lms.some((l) => (l.kind === 'nevermore_academy' || l.kind === 'raven_island') && Math.hypot(l.x - x, l.z - z) < 70 * l.scale)) continue;
    if (land.some((l) => pointInPoly(ensureCCW(l.points), x, z))) continue;
    if (excluded(x, z, 0)) continue;
    const r = 10 + rand() * 16;
    const hh = 3 + rand() * 11;
    const pc = mix3(ROCK_LO, SOIL, rand());
    mb.add(ICO, `#${toHex(pc)}`, [x, hh * 0.15, z], [0, rand() * 6, 0], [r * 1.4, hh, r], { jitter: 0.14, gradient: 0.6 });
    if (rand() < 0.7) {
      const tcount = low ? 1 : 2;
      for (let t = 0; t < tcount; t++) trees.push({ x: x + (rand() - 0.5) * r, y: hh * 0.55, z: z + (rand() - 0.5) * r, s: 1.3 + rand() * 1.2, rot: rand() * 6.28 });
    }
  }
  return mb.build();
}

