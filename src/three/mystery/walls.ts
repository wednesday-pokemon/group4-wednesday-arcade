// Walls (stone / ruin / hedge / fence / rock / cliff) and cover props (crate, tomb, statue, tree, barrel, pillar, bush),
// merged into a single lit geometry. All sizes derive from the WallDef / CoverDef numbers so what you see is what blocks.
import * as THREE from 'three';
import type { CoverDef, MapDef, WallDef } from '../../mystery/types.ts';
import { MeshBuilder } from '../util.ts';
import { mergeAll } from '../action/geom.ts';
import type { GlowEntry } from '../action/fx.ts';
import type { Theme } from './look.ts';
import { QuadSet, addCoverAccent, addCoverStyled, addStyledWall, type StyledOut } from './wallStyles.ts';
import { BOX, CONE4, CONE5, CONE6, CYL5, CYL6, CYL8, ICO0, ICO1, PAL, PRISM, seeded } from './common.ts';

const STONE_TOP = '#3b4180';

export function wallBasis(w: WallDef): { len: number; mx: number; mz: number; rotY: number; dx: number; dz: number } {
  const dx = w.b.x - w.a.x, dz = w.b.z - w.a.z;
  const len = Math.hypot(dx, dz);
  return { len, mx: (w.a.x + w.b.x) / 2, mz: (w.a.z + w.b.z) / 2, rotY: Math.atan2(-dz, dx), dx: dx / (len || 1), dz: dz / (len || 1) };
}

/** Adds one wall to `mb`. `rand` drives deterministic variation. */
export function addWall(mb: MeshBuilder, w: WallDef, rand: () => number, low: boolean, forGate = false): void {
  const { len, rotY, dx, dz } = wallBasis(w);
  const t = w.thickness, h = w.height;
  const at = (s: number): [number, number] => [w.a.x + dx * s, w.a.z + dz * s];
  const stone = (): string => PAL.stone[Math.floor(rand() * PAL.stone.length)];
  switch (w.kind) {
    case 'stone': {
      const n = Math.max(1, Math.round(len / 2.6));
      for (let i = 0; i < n; i++) {
        const s0 = (i / n) * len, s1 = ((i + 1) / n) * len;
        const [cx, cz] = at((s0 + s1) / 2);
        const L = s1 - s0 + (i === 0 || i === n - 1 ? t * 0.5 : 0.04);
        const ex = i === 0 ? -t * 0.25 : i === n - 1 ? t * 0.25 : 0;
        const ox = dx * ex, oz = dz * ex;
        mb.add(BOX, stone(), [cx + ox, h / 2, cz + oz], [0, rotY, 0], [L, h, t], { gradient: 0.4, jitter: 0.1 });
      }
      const [mx, mz] = at(len / 2);
      mb.add(BOX, STONE_TOP, [mx, h + 0.1, mz], [0, rotY, 0], [len + t * 0.6, 0.2, t + 0.22], { gradient: 0, jitter: 0.06 });
      mb.add(BOX, PAL.stoneDark, [mx, 0.25, mz], [0, rotY, 0], [len + t * 0.5, 0.5, t + 0.18], { gradient: 0.2, jitter: 0.05 });
      // buttresses every ~5 m on both faces
      const nb = low ? 0 : Math.floor(len / 5);
      for (let i = 0; i < nb; i++) {
        const [bx, bz] = at(((i + 0.5) / nb) * len);
        const sd = i % 2 === 0 ? 1 : -1;
        mb.add(BOX, PAL.stoneDark, [bx - dz * sd * (t / 2 + 0.2), h * 0.45, bz + dx * sd * (t / 2 + 0.2)], [0, rotY, 0], [0.55, h * 0.9, 0.5], { gradient: 0.3 });
        mb.add(CONE4, PAL.stoneDark, [bx - dz * sd * (t / 2 + 0.2), h * 0.9 + 0.35, bz + dx * sd * (t / 2 + 0.2)], [0, rotY + Math.PI / 4, 0], [0.4, 0.7, 0.4], { gradient: 0 });
      }
      break;
    }
    case 'ruin': {
      const n = Math.max(1, Math.round(len / 1.3));
      for (let i = 0; i < n; i++) {
        const [cx, cz] = at(((i + 0.5) / n) * len);
        const hh = h * (0.4 + rand() * 0.6);
        mb.add(BOX, stone(), [cx, hh / 2, cz], [0, rotY + (rand() - 0.5) * 0.06, 0], [len / n + 0.06, hh, t * (0.85 + rand() * 0.25)], { gradient: 0.45, jitter: 0.14 });
        if (rand() < 0.45) mb.add(ICO0, PAL.stoneDark, [cx + (rand() - 0.5) * 0.4, hh + 0.05, cz + (rand() - 0.5) * 0.4], [rand(), rand() * 6, rand()], [0.35, 0.22, 0.3], { gradient: 0.2 });
        if (rand() < 0.3) mb.add(ICO0, PAL.moss, [cx, hh * 0.9, cz], [rand(), rand() * 6, rand()], [t * 0.5, 0.18, t * 0.45], { gradient: 0.1 });
      }
      for (let i = 0; i < Math.max(2, Math.floor(len / 2.2)); i++) {
        const s = rand() * len;
        const [rx, rz] = at(s);
        const side = rand() < 0.5 ? 1 : -1;
        mb.add(ICO0, stone(), [rx - dz * side * (t / 2 + 0.3), 0.15, rz + dx * side * (t / 2 + 0.3)], [rand(), rand() * 6, rand()], [0.3 + rand() * 0.3, 0.2, 0.3], { gradient: 0.4 });
      }
      break;
    }
    case 'hedge': {
      const n = Math.max(1, Math.round(len / (t * 0.9)));
      const base = PAL.hedge;
      const [mx, mz] = at(len / 2);
      mb.add(BOX, '#17301f', [mx, h * 0.38, mz], [0, rotY, 0], [len + t * 0.4, h * 0.76, t * 0.72], { gradient: 0.5, jitter: 0.06 });
      for (let i = 0; i <= n; i++) {
        const s = (i / n) * len;
        const [cx, cz] = at(s);
        for (let row = 0; row < 2; row++) {
          const j = (rand() - 0.5) * 0.25;
          const y = h * (row === 0 ? 0.32 : 0.66) + (rand() - 0.5) * 0.12;
          mb.add(ICO0, base[Math.floor(rand() * base.length)], [cx - dz * j, y, cz + dx * j], [rand(), rand() * 6, rand()], [t * 0.62, h * (row === 0 ? 0.36 : 0.3), t * 0.62], { gradient: 0.3, jitter: 0.14 });
        }
      }
      break;
    }
    case 'fence': {
      const [mx, mz] = at(len / 2);
      mb.add(BOX, PAL.stoneDark, [mx, 0.18, mz], [0, rotY, 0], [len + 0.2, 0.36, Math.max(t, 0.35)], { gradient: 0.2 });
      const posts = Math.max(2, Math.round(len / 1.8) + 1);
      for (let i = 0; i < posts; i++) {
        const [px, pz] = at((i / (posts - 1)) * len);
        mb.add(BOX, PAL.iron, [px, h / 2, pz], [0, rotY, 0], [0.14, h, 0.14], { gradient: 0.2, jitter: 0.04 });
        mb.add(CONE4, '#4a5088', [px, h + 0.18, pz], [0, rotY + Math.PI / 4, 0], [0.16, 0.38, 0.16], { gradient: 0 });
      }
      mb.add(BOX, PAL.iron, [mx, h * 0.88, mz], [0, rotY, 0], [len, 0.07, 0.07], { gradient: 0 });
      mb.add(BOX, PAL.iron, [mx, h * 0.28, mz], [0, rotY, 0], [len, 0.07, 0.07], { gradient: 0 });
      const bars = Math.max(2, Math.round(len / (low ? 0.6 : 0.34)));
      for (let i = 0; i <= bars; i++) {
        const [px, pz] = at((i / bars) * len);
        mb.add(BOX, '#232638', [px, h * 0.55, pz], [0, rotY, 0], [0.04, h * 0.9, 0.04], { gradient: 0 });
      }
      break;
    }
    case 'rock': {
      const n = Math.max(2, Math.round(len / (t * 0.9)));
      for (let i = 0; i <= n; i++) {
        const [cx, cz] = at((i / n) * len);
        const s = h * (0.55 + rand() * 0.5);
        mb.add(ICO0, ['#2c3158', '#363b68', '#262a4e'][Math.floor(rand() * 3)], [cx, s * 0.45, cz], [rand(), rand() * 6, rand()], [t * (0.55 + rand() * 0.3), s * 0.58, t * (0.55 + rand() * 0.3)], { gradient: 0.5, jitter: 0.14 });
      }
      break;
    }
    case 'cliff': {
      const n = Math.max(2, Math.round(len / (t * 0.8)));
      const [mx, mz] = at(len / 2);
      mb.add(BOX, '#1f2347', [mx, h * 0.4, mz], [0, rotY, 0], [len, h * 0.8, t * 0.7], { gradient: 0.5, jitter: 0.08 });
      for (let i = 0; i <= n; i++) {
        const [cx, cz] = at((i / n) * len);
        const s = h * (0.7 + rand() * 0.45);
        mb.add(ICO0, ['#272c55', '#2f3562', '#222750'][Math.floor(rand() * 3)], [cx, s * 0.42, cz], [rand() * 0.4, rand() * 6, rand() * 0.4], [t * 0.62, s * 0.62, t * 0.62], { gradient: 0.6, jitter: 0.14 });
        if (rand() < 0.35) mb.add(CONE6, '#363b68', [cx, s * 0.95, cz], [0, rand() * 6, 0], [t * 0.3, s * 0.5, t * 0.3], { gradient: 0.4 });
      }
      break;
    }
  }
  void forGate;
}

/** Portcullis for a gate wall (vertical iron bars + frame). Origin at the wall midpoint, ground y = 0, bars run along local X. */
export function buildGateGeometry(w: WallDef, low: boolean): { posts: THREE.BufferGeometry; bars: THREE.BufferGeometry } {
  const rand = seeded('gate:' + w.id);
  const { len, mx, mz, rotY, dx, dz } = wallBasis(w);
  const t = w.thickness, h = w.height;
  const post = new MeshBuilder(rand);
  for (const s of [-1, 1]) {
    const px = mx + dx * s * (len / 2), pz = mz + dz * s * (len / 2);
    post.add(BOX, PAL.stone[0], [px, h * 0.5 + 0.2, pz], [0, rotY, 0], [0.8, h + 0.4, Math.max(t, 0.9)], { gradient: 0.4 });
    post.add(BOX, STONE_TOP, [px, h + 0.5, pz], [0, rotY, 0], [1.0, 0.25, Math.max(t, 0.9) + 0.2], { gradient: 0 });
    post.add(CONE4, PAL.stoneDark, [px, h + 1.15, pz], [0, rotY + Math.PI / 4, 0], [0.55, 1.0, 0.55], { gradient: 0 });
  }
  post.add(BOX, PAL.stoneDark, [mx, h + 0.15, mz], [0, rotY, 0], [len, 0.34, Math.max(t, 0.5)], { gradient: 0.2 });
  const bars = new MeshBuilder(rand);
  const n = Math.max(3, Math.round(len / (low ? 0.5 : 0.3)));
  for (let i = 0; i <= n; i++) {
    const s = (i / n - 0.5) * (len - 0.2);
    bars.add(BOX, '#2a2d44', [mx + dx * s, h * 0.5, mz + dz * s], [0, rotY, 0], [0.06, h, 0.06], { gradient: 0.1 });
    bars.add(CONE4, '#5a6098', [mx + dx * s, h + 0.08, mz + dz * s], [0, rotY + Math.PI / 4, 0], [0.09, 0.22, 0.09], { gradient: 0 });
  }
  for (const yy of [0.25, h * 0.5, h * 0.9]) bars.add(BOX, '#232638', [mx, yy, mz], [0, rotY, 0], [len, 0.08, 0.1], { gradient: 0 });
  return { posts: post.build(), bars: bars.build() };
}

// ------------------------------------------------------------------------------------------------------------ cover
const LOW_H = 1.0;
const HIGH_H = 2.5;

function tree(mb: MeshBuilder, rand: () => number, x: number, z: number, r: number, hgt: number, lite: boolean): void {
  const th = hgt;
  mb.add(CYL6, '#2a2038', [x, th * 0.3, z], [0.04, rand() * 6, 0.05], [r * 0.7, th * 0.62, r * 0.7], { gradient: 0.5, jitter: 0.1 });
  mb.add(CYL6, '#241a30', [x, 0.2, z], [0, 0, 0], [r * 1.0, 0.5, r * 1.0], { gradient: 0.3 });
  const lumps = lite ? 3 : 6;
  for (let i = 0; i < lumps; i++) {
    const a = (i / lumps) * Math.PI * 2 + rand();
    const rr = (0.4 + rand() * 0.8) * (1.2 + r);
    const y = th * (0.62 + rand() * 0.38);
    mb.add(ICO1, ['#1c3730', '#233f35', '#18302a', '#2a3f4a'][Math.floor(rand() * 4)], [x + Math.cos(a) * rr, y, z + Math.sin(a) * rr], [rand(), rand() * 6, rand()], [0.9 + r * 0.9, 0.6 + r * 0.5, 0.9 + r * 0.9], { gradient: 0.35, jitter: 0.14 });
    if (!lite && i % 2 === 0) mb.add(CONE5, '#2a2038', [x + Math.cos(a) * rr * 0.5, y - 0.6, z + Math.sin(a) * rr * 0.5], [0.8 * Math.cos(a), 0, 0.8 * Math.sin(a)], [0.1, 1.5, 0.1], { gradient: 0 });
  }
  mb.add(ICO1, '#1c3730', [x, th * 0.92, z], [0, rand() * 6, 0], [1.2 + r, 0.9 + r * 0.4, 1.2 + r], { gradient: 0.3, jitter: 0.14 });
}

function addCover(mb: MeshBuilder, c: CoverDef, rand: () => number, low: boolean): void {
  const r = c.radius;
  const isHigh = c.height === 'high';
  const H = isHigh ? HIGH_H : LOW_H;
  const rot = rand() * 6.28;
  switch (c.kind) {
    case 'crate': {
      const s = r * 1.55;
      const levels = isHigh ? 2 : 1;
      for (let l = 0; l < levels; l++) {
        const hh = H / levels;
        const off = l === 0 ? 0 : (rand() - 0.5) * 0.12;
        mb.add(BOX, PAL.wood, [c.x + off, hh * l + hh / 2, c.z + off], [0, rot + l * 0.3, 0], [s * (1 - l * 0.12), hh, s * (1 - l * 0.12)], { gradient: 0.3, jitter: 0.1 });
        mb.add(BOX, PAL.woodDark, [c.x + off, hh * l + hh / 2, c.z + off], [0, rot + l * 0.3, 0], [s * (1 - l * 0.12) + 0.04, hh * 0.14, s * (1 - l * 0.12) + 0.04], { gradient: 0 });
        mb.add(BOX, PAL.woodDark, [c.x + off, hh * l + hh * 0.2, c.z + off], [0, rot + l * 0.3, 0], [s * (1 - l * 0.12) + 0.04, hh * 0.1, s * (1 - l * 0.12) + 0.04], { gradient: 0 });
      }
      if (!isHigh) mb.add(BOX, PAL.woodLight, [c.x + r * 0.2, H + 0.06, c.z], [0, rot, 0], [s * 0.5, 0.12, s * 0.35], { gradient: 0 });
      break;
    }
    case 'barrel': {
      const levels = isHigh ? 2 : 1;
      for (let l = 0; l < levels; l++) {
        const hh = H / levels;
        const rr = r * 0.95;
        mb.add(CYL8, PAL.woodLight, [c.x, hh * l + hh / 2, c.z], [0, rot, 0], [rr, hh, rr], { gradient: 0.3, jitter: 0.1 });
        mb.add(CYL8, PAL.iron, [c.x, hh * l + hh * 0.22, c.z], [0, 0, 0], [rr * 1.04, 0.06, rr * 1.04], { gradient: 0 });
        mb.add(CYL8, PAL.iron, [c.x, hh * l + hh * 0.78, c.z], [0, 0, 0], [rr * 1.04, 0.06, rr * 1.04], { gradient: 0 });
      }
      break;
    }
    case 'tomb': {
      if (isHigh) {
        mb.add(BOX, PAL.stone[0], [c.x, 0.9, c.z], [0, rot, 0], [r * 1.8, 1.8, r * 1.3], { gradient: 0.4 });
        mb.add(PRISM, PAL.stoneDark, [c.x, 1.8, c.z], [0, rot, 0], [r * 2.0, 0.8, r * 1.5], { gradient: 0.2 });
        mb.add(BOX, '#10132a', [c.x - Math.sin(rot) * r * 0.66, 0.7, c.z - Math.cos(rot) * r * 0.66], [0, rot, 0], [r * 0.7, 1.3, 0.1], { gradient: 0 });
        mb.add(BOX, PAL.stoneLight, [c.x, 2.8, c.z], [0, rot, 0], [0.1, 0.5, 0.1], { gradient: 0 });
        mb.add(BOX, PAL.stoneLight, [c.x, 2.9, c.z], [0, rot, 0], [0.34, 0.1, 0.1], { gradient: 0 });
      } else {
        mb.add(BOX, PAL.stone[1], [c.x, 0.35, c.z], [0, rot, 0], [r * 1.9, 0.7, r * 1.15], { gradient: 0.4 });
        mb.add(BOX, PAL.stoneDark, [c.x, 0.78, c.z], [0, rot, 0], [r * 2.05, 0.18, r * 1.3], { gradient: 0 });
        mb.add(BOX, PAL.stoneLight, [c.x, 0.95, c.z], [0, rot, 0], [r * 1.2, 0.1, 0.12], { gradient: 0 });
        mb.add(BOX, PAL.stoneLight, [c.x, 0.95, c.z], [0, rot, 0], [0.12, 0.1, r * 0.6], { gradient: 0 });
      }
      break;
    }
    case 'statue': {
      const ph = isHigh ? 0.9 : 0.55;
      mb.add(BOX, PAL.stoneDark, [c.x, ph / 2, c.z], [0, rot, 0], [r * 1.5, ph, r * 1.5], { gradient: 0.3 });
      mb.add(BOX, PAL.stone[1], [c.x, ph + 0.08, c.z], [0, rot, 0], [r * 1.7, 0.16, r * 1.7], { gradient: 0 });
      const fh = (isHigh ? 2.6 : 1.1) - ph;
      mb.add(CONE8_STATUE, PAL.stoneLight, [c.x, ph + 0.16 + fh * 0.4, c.z], [0, rot, 0], [r * 0.75, fh * 0.8, r * 0.75], { gradient: 0.3, jitter: 0.08 });
      if (isHigh) {
        mb.add(ICO1, PAL.stoneLight, [c.x, ph + 0.16 + fh * 0.88, c.z], [0, rot, 0], [r * 0.3, r * 0.33, r * 0.3], { gradient: 0.1 });
        for (const s of [-1, 1]) {
          mb.add(BOX, '#555c9a', [c.x + Math.cos(rot) * s * r * 0.8, ph + 0.16 + fh * 0.6, c.z - Math.sin(rot) * s * r * 0.8], [0.2, rot, s * 0.5], [0.08, fh * 0.55, r * 0.5], { gradient: 0.1 });
        }
      } else {
        mb.add(ICO0, PAL.stoneLight, [c.x + r * 0.3, 0.2, c.z + r * 0.6], [0.3, 0.4, 0.2], [0.2, 0.15, 0.25], { gradient: 0.3 }); // fallen head fragment
      }
      break;
    }
    case 'pillar': {
      const ph = isHigh ? 3.4 : 1.1;
      mb.add(CYL8, PAL.stone[0], [c.x, ph / 2, c.z], [0, rot, 0], [r * 0.82, ph, r * 0.82], { gradient: 0.4, jitter: 0.1 });
      mb.add(CYL8, PAL.stoneDark, [c.x, 0.18, c.z], [0, 0, 0], [r * 1.05, 0.36, r * 1.05], { gradient: 0 });
      if (isHigh) {
        mb.add(CYL8, PAL.stoneDark, [c.x, ph + 0.12, c.z], [0, 0, 0], [r * 1.05, 0.28, r * 1.05], { gradient: 0 });
        mb.add(CONE8, PAL.stoneDark, [c.x, ph + 0.26 + 0.2, c.z], [0, 0, 0], [r * 0.9, 0.4, r * 0.9], { gradient: 0 });
      } else {
        mb.add(ICO0, PAL.stoneDark, [c.x + r * 0.5, 0.15, c.z + r * 0.3], [rand(), rand() * 6, rand()], [0.3, 0.2, 0.3], { gradient: 0.3 });
        mb.add(BOX, PAL.stone[2], [c.x, ph + 0.02, c.z], [0.12, rot, 0.1], [r * 1.4, 0.18, r * 1.4], { gradient: 0 });
      }
      break;
    }
    case 'bush': {
      const n = isHigh ? 4 : 3;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 + rot;
        const rr = r * 0.45;
        mb.add(ICO1, PAL.hedge[i % 3], [c.x + Math.cos(a) * rr, H * (0.35 + 0.12 * (i % 2)), c.z + Math.sin(a) * rr], [rand(), rand() * 6, rand()], [r * 0.68, H * (isHigh ? 0.36 : 0.34), r * 0.68], { gradient: 0.35, jitter: 0.14 });
      }
      mb.add(ICO1, PAL.hedge[1], [c.x, H * 0.55, c.z], [0, rot, 0], [r * 0.7, H * 0.4, r * 0.7], { gradient: 0.3, jitter: 0.14 });
      break;
    }
    case 'tree':
      tree(mb, rand, c.x, c.z, Math.max(0.35, r * 0.7), isHigh ? 5.4 : 3.2, low);
      break;
  }
}

const CONE8_STATUE = new THREE.CylinderGeometry(0.55, 1.0, 1, 7, 1);
const CONE8 = new THREE.ConeGeometry(1, 1, 8, 1);

export interface WallBuild {
  lit: THREE.BufferGeometry | null;
  em: THREE.BufferGeometry | null;
  glass: THREE.BufferGeometry | null;
  /** textured bookshelf faces */
  shelf: THREE.BufferGeometry | null;
  glows: GlowEntry[];
}

function finishOut(o: StyledOut): WallBuild {
  return { lit: mergeAll([o.lit.build()]), em: mergeAll([o.em.build()]), glass: mergeAll([o.glass.build()]), shelf: o.shelf.build(), glows: o.glows };
}

function newOut(rand: () => number): StyledOut {
  return { lit: new MeshBuilder(rand), em: new MeshBuilder(rand), glass: new MeshBuilder(rand), shelf: new QuadSet(), glows: [] };
}

/**
 * All static walls + cover as merged geometry. The case's own extra walls / cover (CaseWorldDef) get the theme's skin
 * (bookshelf rows, rubble, patrol fences ...); `skipWalls` (the shortcut gate, the passage wall) are drawn dynamically elsewhere.
 */
export function buildWallsAndCover(map: MapDef, low: boolean, skipWalls: ReadonlySet<string>, theme: Theme): WallBuild {
  const rand = seeded('walls:' + map.id);
  const o = newOut(rand);
  const extraW = new Set((map.world?.extraWalls ?? []).map((w) => w.id));
  const extraC = new Set((map.world?.extraCover ?? []).map((c) => c.id));
  // compact maps: whatever the old island left standing beyond the play area (both ends of a wall outside it) is not drawn (no ghost halls behind the fence)
  const bb = map.bounds, far = (x: number, z: number): boolean => !!map.world?.playArea && (x < bb.minX - 1.5 || x > bb.maxX + 1.5 || z < bb.minZ - 1.5 || z > bb.maxZ + 1.5);
  for (const w of map.walls) {
    if (skipWalls.has(w.id)) continue;
    if (far(w.a.x, w.a.z) && far(w.b.x, w.b.z)) continue;
    if (extraW.has(w.id) && addStyledWall(o, w, theme, rand)) continue;
    addWall(o.lit, w, rand, low);
  }
  for (const c of map.cover) {
    if (far(c.x, c.z)) continue;
    if (extraC.has(c.id) && addCoverStyled(o, c, theme, rand)) continue;
    addCover(o.lit, c, rand, low);
    if (extraC.has(c.id)) addCoverAccent(o, c, theme, rand);
  }
  void CYL5; void ICO0;
  return finishOut(o);
}

/** The geometry of one (extra) wall in the case's style: the passage wall, which slides away when the lever is pulled. */
export function buildWallParts(map: MapDef, w: WallDef, theme: Theme): WallBuild {
  const rand = seeded('wall:' + w.id);
  const o = newOut(rand);
  if (!addStyledWall(o, w, theme, rand)) addWall(o.lit, w, rand, false);
  void map;
  return finishOut(o);
}
