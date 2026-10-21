// Static ground: terrain grid with a ragged shoreline, dirt paths (from path/shortcut rooms and the patrol loop), room floors
// (planks, flagstones, cobbles), a rim of shoreline rocks and scattered grass/rocks. Everything is derived from the MapDef.
import * as THREE from 'three';
import type { MapDef, RoomDef, Vec2 } from '../../mystery/types.ts';
import { MeshBuilder, clamp, smoothstep } from '../util.ts';
import { TriBuilder, distToEdges, mergeAll, pointInPoly } from '../action/geom.ts';
import type { GlowEntry } from '../action/fx.ts';
import { CONE4, ICO0, PAL, distPointSeg, seeded, segHitsWall } from './common.ts';

type V3 = [number, number, number];

function hash2(x: number, z: number, s = 0): number {
  const n = Math.sin(x * 127.1 + z * 311.7 + s * 74.7) * 43758.5453;
  return n - Math.floor(n);
}
export function vnoise(x: number, z: number, s = 0): number {
  const ix = Math.floor(x), iz = Math.floor(z);
  const fx = x - ix, fz = z - iz;
  const ux = fx * fx * (3 - 2 * fx), uz = fz * fz * (3 - 2 * fz);
  const a = hash2(ix, iz, s), b = hash2(ix + 1, iz, s), c = hash2(ix, iz + 1, s), d = hash2(ix + 1, iz + 1, s);
  return a + (b - a) * ux + (c - a) * uz + (a - b - c + d) * ux * uz;
}

export interface PierRect { x: number; z: number; yaw: number; scale: number; length: number; width: number }

export function toLocal(r: { x: number; z: number; yaw: number; scale: number }, x: number, z: number): [number, number] {
  const s = Math.sin(r.yaw), c = Math.cos(r.yaw);
  const dx = (x - r.x) / r.scale, dz = (z - r.z) / r.scale;
  return [dx * c - dz * s, dx * s + dz * c];
}
export function insidePier(r: PierRect, x: number, z: number, pad: number): boolean {
  const [lx, lz] = toLocal(r, x, z);
  return lz > -0.4 - pad && lz < r.length + pad + 2 && Math.abs(lx) < r.width / 2 + pad;
}

export interface TerrainBuild {
  ground: THREE.BufferGeometry | null;
  decals: THREE.BufferGeometry | null;
  scatter: THREE.BufferGeometry | null;
  scatterGlows: GlowEntry[];
  /** world → floor tile patterns for rooms (so props know where indoor floor is) */
  indoor: RoomDef[];
}

const INDOOR = new Set(['research_room', 'crypt', 'egg_chamber']);

function rgb(hex: string): V3 {
  const c = new THREE.Color(hex);
  return [c.r, c.g, c.b];
}
function mix3(a: V3, b: V3, t: number): V3 {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}
function mul3(a: V3, k: number): V3 {
  return [a[0] * k, a[1] * k, a[2] * k];
}

export function buildTerrain(map: MapDef, piers: PierRect[], low: boolean): TerrainBuild {
  const rand = seeded('terrain:' + map.id);
  const b = map.bounds;
  const margin = low ? 12 : 18;
  const minX = Math.floor(b.minX - margin), maxX = Math.ceil(b.maxX + margin);
  const minZ = Math.floor(b.minZ - margin), maxZ = Math.ceil(b.maxZ + margin);
  const cell = low ? 3 : 2;
  const gt = new TriBuilder();
  const gA = rgb(PAL.ground), gB = rgb(PAL.groundLight), rock = rgb('#24284a'), mossC = rgb(PAL.moss);

  const outsideDist = (x: number, z: number): number => {
    const dx = Math.max(b.minX - x, 0, x - b.maxX);
    const dz = Math.max(b.minZ - z, 0, z - b.maxZ);
    return Math.hypot(dx, dz);
  };
  const height = (x: number, z: number): number => {
    const o = outsideDist(x, z);
    if (o <= 0) return 0;
    return -(smoothstep(0, 7, o) * 3.4 + (o > 0 ? 0.2 : 0)) + (vnoise(x * 0.4, z * 0.4) - 0.5) * 0.6 * smoothstep(0, 4, o);
  };
  const colAt = (x: number, z: number, y: number): V3 => {
    const n = vnoise(x * 0.085, z * 0.085) * 0.65 + vnoise(x * 0.32, z * 0.32, 4) * 0.35;
    let c = mix3(gA, gB, clamp(n * 1.25 - 0.15, 0, 1));
    const m = vnoise(x * 0.06 + 40, z * 0.06 - 12, 9);
    if (m > 0.62) c = mix3(c, mossC, clamp((m - 0.62) * 4, 0, 0.6));
    if (y < -0.15) c = mix3(c, rock, clamp(-y / 1.2, 0, 1));
    return mul3(c, 0.93 + hash2(x, z, 3) * 0.14);
  };
  const emitCell = (x0: number, z0: number, s: number, depth: number): void => {
    // pier hole: skip cells inside a pier footprint, recurse on cells straddling its edge
    let any = false, all = true;
    const xs = [x0, x0 + s], zs = [z0, z0 + s];
    for (const px of xs) for (const pz of zs) {
      const ins = piers.some((p) => insidePier(p, px, pz, 0.25));
      any = any || ins;
      all = all && ins;
    }
    if (piers.length && (any || piers.some((p) => insidePier(p, x0 + s / 2, z0 + s / 2, 0.25)))) {
      if (all) return;
      if (depth < 2 && s > 0.6) {
        const h = s / 2;
        emitCell(x0, z0, h, depth + 1); emitCell(x0 + h, z0, h, depth + 1);
        emitCell(x0, z0 + h, h, depth + 1); emitCell(x0 + h, z0 + h, h, depth + 1);
        return;
      }
      if (piers.some((p) => insidePier(p, x0 + s / 2, z0 + s / 2, 0.25))) return;
    }
    const p00: V3 = [x0, height(x0, z0), z0], p10: V3 = [x0 + s, height(x0 + s, z0), z0];
    const p01: V3 = [x0, height(x0, z0 + s), z0 + s], p11: V3 = [x0 + s, height(x0 + s, z0 + s), z0 + s];
    const c00 = colAt(p00[0], p00[2], p00[1]), c10 = colAt(p10[0], p10[2], p10[1]);
    const c01 = colAt(p01[0], p01[2], p01[1]), c11 = colAt(p11[0], p11[2], p11[1]);
    gt.triC(p00, p01, p11, c00, c01, c11, [0, 1, 0]);
    gt.triC(p00, p11, p10, c00, c11, c10, [0, 1, 0]);
  };
  for (let x = minX; x < maxX; x += cell) for (let z = minZ; z < maxZ; z += cell) emitCell(x, z, cell, 0);

  // ---- decals: paths, floors
  const dt = new TriBuilder();
  const tile = (x: number, z: number, s: number, y: number, c: V3): void => {
    const h = s / 2;
    dt.tri([x - h, y, z - h], [x - h, y, z + h], [x + h, y, z + h], c, [0, 1, 0]);
    dt.tri([x - h, y, z - h], [x + h, y, z + h], [x + h, y, z - h], c, [0, 1, 0]);
  };
  // 'path' is the whole-island lookup fallback, not a floor: it never counts as a room here
  const inAnyRoom = (x: number, z: number, ids?: Set<string>): boolean => map.rooms.some((r) => r.id !== 'path' && (!ids || ids.has(r.id)) && pointInPoly(r.polygon, x, z));

  const dirt = rgb(PAL.dirt), dirtL = rgb(PAL.dirtLight);
  const fillRoom = (room: RoomDef, y: number, colour: (x: number, z: number, i: number, j: number) => V3, step = 1): void => {
    const xs = room.polygon.map((p) => p.x), zs = room.polygon.map((p) => p.z);
    const x0 = Math.floor(Math.min(...xs)), x1 = Math.ceil(Math.max(...xs));
    const z0 = Math.floor(Math.min(...zs)), z1 = Math.ceil(Math.max(...zs));
    for (let i = 0; i * step + x0 < x1; i++) {
      for (let j = 0; j * step + z0 < z1; j++) {
        const cx = x0 + i * step + step / 2, cz = z0 + j * step + step / 2;
        const inside = pointInPoly(room.polygon, cx, cz) || distToEdges(room.polygon, cx, cz) < 0.55;
        if (!inside) continue;
        if (piers.some((p) => insidePier(p, cx, cz, 0))) continue;
        tile(cx, cz, step * 1.02, y, colour(cx, cz, i, j));
      }
    }
  };

  // dirt path ribbons along the patrol loop and spurs to objectives (only the parts outside rooms)
  const spurs: [Vec2, Vec2][] = [];
  const nearestPatrol = (p: Vec2): Vec2 => {
    let best = map.patrol[0], bd = Infinity;
    for (const q of map.patrol) {
      const d = Math.hypot(q.x - p.x, q.z - p.z);
      if (d < bd) { bd = d; best = q; }
    }
    return best;
  };
  if (map.patrol.length > 1) {
    const targets: Vec2[] = [map.playerStart, map.eggSpawn, map.tower, ...map.clues.map((c) => ({ x: c.x, z: c.z }))];
    if (map.powerSwitch) targets.push({ x: map.powerSwitch.x, z: map.powerSwitch.z });
    for (const t of targets) {
      const q = nearestPatrol(t);
      if (Math.hypot(q.x - t.x, q.z - t.z) > 1.5 && !segHitsWall(map, t.x, t.z, q.x, q.z)) spurs.push([t, q]);
    }
    const loop = map.patrol.map((p, i) => [p, map.patrol[(i + 1) % map.patrol.length]] as [Vec2, Vec2]);
    const segs = [...loop, ...spurs];
    for (const [a, c] of segs) {
      const len = Math.hypot(c.x - a.x, c.z - a.z);
      const n = Math.max(1, Math.ceil(len / 1.0));
      const nx = -(c.z - a.z) / (len || 1), nz = (c.x - a.x) / (len || 1);
      for (let k = 0; k < n; k++) {
        const t = (k + 0.5) / n;
        const px = a.x + (c.x - a.x) * t, pz = a.z + (c.z - a.z) * t;
        if (inAnyRoom(px, pz) || piers.some((p) => insidePier(p, px, pz, 0.5))) continue;
        const w = 1.35 + hash2(px, pz, 8) * 0.35;
        const j = (hash2(px, pz, 5) - 0.5) * 0.3;
        const col = mix3(dirt, dirtL, hash2(px, pz, 11) * 0.7);
        const cx = px + nx * j, cz = pz + nz * j;
        // a short strip along the segment direction, rotated with the path
        const dx = (c.x - a.x) / (len || 1), dz = (c.z - a.z) / (len || 1);
        const L = (len / n) * 0.58 + 0.12;
        dt.tri([cx - dx * L - nx * w, 0.025, cz - dz * L - nz * w], [cx - dx * L + nx * w, 0.025, cz - dz * L + nz * w], [cx + dx * L + nx * w, 0.025, cz + dz * L + nz * w], col, [0, 1, 0]);
        dt.tri([cx - dx * L - nx * w, 0.025, cz - dz * L - nz * w], [cx + dx * L + nx * w, 0.025, cz + dz * L + nz * w], [cx + dx * L - nx * w, 0.025, cz + dz * L - nz * w], col, [0, 1, 0]);
      }
    }
  }

  for (const room of map.rooms) {
    const id = room.id;
    if (id === 'path') {
      continue;
    } else if (id === 'shortcut') {
      fillRoom(room, 0.03, (x, z) => mix3(dirt, dirtL, hash2(x, z, 2) * 0.75));
    } else if (id === 'pier') {
      const plank = [rgb('#30282a'), rgb('#382e2e'), rgb('#2a2326')];
      fillRoom(room, 0.045, (_x, _z, i, j) => mul3(plank[(j * 2 + (hash2(i, 3, 5) > 0.82 ? 1 : 0)) % 3], 0.88 + hash2(i, j, 16) * 0.2 - (i % 7 === 0 ? 0.12 : 0)), 0.5);
    } else if (id === 'research_room') {
      const plank = [rgb('#4b3427'), rgb('#56392a'), rgb('#432e22')];
      fillRoom(room, 0.045, (_x, _z, i, j) => mul3(plank[(j + (hash2(i, 9, 2) > 0.85 ? 1 : 0)) % 3], 0.9 + hash2(i, j, 6) * 0.18 - (i % 5 === 0 ? 0.1 : 0)), 0.5);
    } else if (id === 'crypt') {
      const slab = [rgb('#2a2f58'), rgb('#323868')];
      fillRoom(room, 0.045, (x, z, i, j) => {
        let c = mul3(slab[(i + j) % 2], 0.85 + hash2(i, j, 1) * 0.3);
        if (vnoise(x * 0.4, z * 0.4, 20) > 0.66) c = mix3(c, rgb('#27443a'), 0.6);
        return c;
      });
    } else if (id === 'egg_chamber') {
      const slab = [rgb('#1f2348'), rgb('#262b56')];
      fillRoom(room, 0.045, (_x, _z, i, j) => mul3(slab[(i + j) % 2], 0.85 + hash2(i, j, 7) * 0.3));
    } else if (id === 'courtyard') {
      fillRoom(room, 0.04, (_x, _z, i, j) => mul3(rgb(((i * 5 + j * 3) % 4) === 0 ? '#383d68' : '#2d3260'), 0.84 + hash2(i, j, 4) * 0.32));
    } else if (id === 'tower') {
      fillRoom(room, 0.05, (x, z, i, j) => {
        const a = Math.atan2(z - map.tower.z, x - map.tower.x);
        return mul3(rgb(Math.floor((a + Math.PI) / (Math.PI / 4)) % 2 === 0 ? '#444a80' : '#373c6c'), 0.9 + hash2(i, j, 14) * 0.2);
      });
    }
  }

  // ---- scatter: grass tufts, rocks, bones-ish twigs, a few glowing mushrooms (skipped inside rooms/walls/cover)
  const sb = new MeshBuilder(rand);
  const glows: GlowEntry[] = [];
  const nTuft = low ? 0 : 340;
  const nRock = low ? 40 : 110;
  const blocked = (x: number, z: number): boolean => {
    if (x < b.minX + 0.5 || x > b.maxX - 0.5 || z < b.minZ + 0.5 || z > b.maxZ - 0.5) return true;
    if (inAnyRoom(x, z, new Set(['research_room', 'crypt', 'egg_chamber', 'courtyard', 'tower', 'pier', 'shortcut']))) return true;
    for (const w of map.walls) if (distPointSeg(x, z, w.a.x, w.a.z, w.b.x, w.b.z) < w.thickness / 2 + 0.7) return true;
    for (const c of map.cover) if (Math.hypot(x - c.x, z - c.z) < c.radius + 0.5) return true;
    for (const h of map.hidingSpots) if (Math.hypot(x - h.x, z - h.z) < h.radius + 0.8) return true;
    if (piers.some((p) => insidePier(p, x, z, 1.5))) return true;
    for (const s of spurs) if (distPointSeg(x, z, s[0].x, s[0].z, s[1].x, s[1].z) < 1.2) return true;
    for (let i = 0; i < map.patrol.length; i++) {
      const p = map.patrol[i], q = map.patrol[(i + 1) % map.patrol.length];
      if (distPointSeg(x, z, p.x, p.z, q.x, q.z) < 1.2) return true;
    }
    return false;
  };
  const tuftCols = ['#2c4a3d', '#355a48', '#26402f', '#3d5a40'];
  const rockCols = ['#2c3158', '#363b68', '#262a4e'];
  let placed = 0, tries = 0;
  while (placed < nTuft && tries < nTuft * 6) {
    tries++;
    const x = b.minX + rand() * (b.maxX - b.minX), z = b.minZ + rand() * (b.maxZ - b.minZ);
    if (blocked(x, z)) continue;
    placed++;
    const blades = 3 + Math.floor(rand() * 3);
    for (let k = 0; k < blades; k++) {
      const a = rand() * 6.28, r = rand() * 0.14, h = 0.28 + rand() * 0.3;
      sb.add(CONE4, tuftCols[Math.floor(rand() * tuftCols.length)], [x + Math.cos(a) * r, h / 2, z + Math.sin(a) * r], [(rand() - 0.5) * 0.5, rand() * 6, (rand() - 0.5) * 0.5], [0.05, h, 0.05], { gradient: 0.2, jitter: 0.1 });
    }
  }
  placed = 0; tries = 0;
  while (placed < nRock && tries < nRock * 8) {
    tries++;
    const x = b.minX + rand() * (b.maxX - b.minX), z = b.minZ + rand() * (b.maxZ - b.minZ);
    if (blocked(x, z)) continue;
    placed++;
    const s = 0.14 + rand() * 0.34;
    sb.add(ICO0, rockCols[Math.floor(rand() * rockCols.length)], [x, s * 0.35, z], [rand(), rand() * 6, rand()], [s * 1.2, s * 0.7, s], { gradient: 0.4, jitter: 0.12 });
    if (!low && rand() < 0.06 && glows.length < 10) glows.push({ x, y: s + 0.2, z, size: 0.9, color: rand() < 0.5 ? '#6fe0ff' : '#b79cff', alpha: 0.5, flicker: 0.5, fogFloor: 0.1 });
  }
  // shoreline rim rocks just outside the playable bounds (breaks the straight edge against the water)
  const rim = new MeshBuilder(rand);
  const ring = (low ? 9 : 5.5);
  const perim: Vec2[] = [];
  for (let x = b.minX - 3; x <= b.maxX + 3; x += ring) { perim.push({ x, z: b.minZ - 3 }, { x, z: b.maxZ + 3 }); }
  for (let z = b.minZ - 3; z <= b.maxZ + 3; z += ring) { perim.push({ x: b.minX - 3, z }, { x: b.maxX + 3, z }); }
  for (const p of perim) {
    if (piers.some((pr) => insidePier(pr, p.x, p.z, 4))) continue;
    const s = 1.2 + rand() * 2.2;
    rim.add(ICO0, rockCols[Math.floor(rand() * 3)], [p.x + (rand() - 0.5) * 3, -0.2 + s * 0.15, p.z + (rand() - 0.5) * 3], [rand(), rand() * 6, rand()], [s * 1.3, s * 0.85, s * 1.1], { gradient: 0.55, jitter: 0.14 });
  }
  const scatterGeo = mergeAll([sb.build(), rim.build()]);
  return { ground: gt.build(), decals: dt.build(), scatter: scatterGeo, scatterGlows: glows, indoor: map.rooms.filter((r) => INDOOR.has(r.id)) };
}
