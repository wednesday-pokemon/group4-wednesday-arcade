// Furniture that stands at EVERY candidate site (SiteDef.prop), whether or not the clue / egg is really there, so a prop never gives
// the answer away. Models are authored in a local frame (origin = footprint centre on the ground, front = -Z) and placed with Bld.finish.
// Each spec also says where a clue item / the egg rests on it (`itemY` / `itemZ` / `eggY`) and a footprint radius for the outline hull.
import * as THREE from 'three';
import type { MapDef, SiteDef, Vec2 } from '../../mystery/types.ts';
import { Bld } from './builders.ts';
import { BOX, CONE4, CONE6, CYL6, CYL8, CYL12, ICO0, PAL, distPointSeg } from './common.ts';
import { mergeAll } from '../action/geom.ts';

export type SitePropKind = SiteDef['prop'];

export interface SitePropSpec {
  build(b: Bld, accent: string): void;
  /** height at which a clue item sits, and how far toward the front (-Z) of the prop */
  itemY: number;
  itemZ: number;
  /** height the resting egg floats at */
  eggY: number;
  /** footprint radius (outline hull, searched cue placement) */
  r: number;
  /** extent along local Z used to put the "searched" cue in front */
  front: number;
}

const NG = { gradient: 0, jitter: 0 } as const;
const BRASS = '#c8a24a';

function drawerFront(b: Bld, x: number, y: number, z: number, w: number, h: number, col: string): void {
  b.lit.add(BOX, col, [x, y, z], [0, 0, 0], [w, h, 0.03], { gradient: 0.1, jitter: 0.05 });
  b.lit.add(BOX, BRASS, [x, y, z - 0.025], [0, 0, 0], [w * 0.28, 0.025, 0.02], NG);
}

const desk: SitePropSpec = {
  itemY: 0.84, itemZ: -0.02, eggY: 0.84, r: 0.95, front: 0.9,
  build(b, accent) {
    b.lit.add(BOX, '#4a3020', [0, 0.78, 0], [0, 0, 0], [1.4, 0.07, 0.7], { gradient: 0.2, jitter: 0.06 });
    b.lit.add(BOX, '#2e1c12', [-0.62, 0.37, 0], [0, 0, 0], [0.08, 0.74, 0.62], { gradient: 0.1 });
    b.lit.add(BOX, '#3a2517', [0.4, 0.37, 0], [0, 0, 0], [0.55, 0.74, 0.62], { gradient: 0.15 });
    drawerFront(b, 0.4, 0.62, -0.32, 0.46, 0.2, '#5a3a24');
    drawerFront(b, 0.4, 0.38, -0.32, 0.46, 0.2, '#5a3a24');
    drawerFront(b, 0.4, 0.15, -0.32, 0.46, 0.2, '#5a3a24');
    b.lit.add(BOX, '#241610', [-0.15, 0.4, 0.29], [0, 0, 0], [0.7, 0.7, 0.04], { gradient: 0.1 });
    b.lit.add(BOX, '#27402f', [0, 0.82, 0.02], [0, 0.05, 0], [0.62, 0.012, 0.4], NG);
    b.lit.add(BOX, '#efe5c8', [-0.38, 0.83, -0.08], [0, 0.3, 0], [0.26, 0.012, 0.19], { gradient: 0.05, jitter: 0.02 });
    b.lit.add(BOX, '#e8dcc0', [-0.33, 0.845, -0.05], [0, -0.2, 0], [0.24, 0.012, 0.18], { gradient: 0.05, jitter: 0.02 });
    b.lit.add(CYL6, '#1a1a28', [0.5, 0.86, 0.15], [0, 0, 0], [0.04, 0.08, 0.04], NG);
    // banker's lamp
    b.lit.add(CYL8, '#1b1d2c', [-0.55, 0.84, 0.18], [0, 0, 0], [0.09, 0.03, 0.09], NG);
    b.lit.add(CYL6, '#1b1d2c', [-0.55, 1.0, 0.18], [0, 0, 0], [0.018, 0.3, 0.018], NG);
    b.em.add(CYL8, accent, [-0.55, 1.16, 0.18], [0, 0, 0], [0.13, 0.08, 0.13], NG);
    b.glows.push({ x: -0.55, y: 1.18, z: 0.18, size: 1.5, color: accent, alpha: 0.45, flicker: 0.12, fogFloor: 0.1 });
    // chair
    b.lit.add(BOX, '#3a2517', [0.05, 0.46, 0.95], [0, 0.1, 0], [0.5, 0.06, 0.5], { gradient: 0.1 });
    b.lit.add(BOX, '#3a2517', [0.05, 0.84, 1.18], [0, 0.1, 0], [0.5, 0.7, 0.05], { gradient: 0.1 });
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.lit.add(BOX, '#241610', [0.05 + sx * 0.2, 0.22, 0.95 + sz * 0.2], [0, 0.1, 0], [0.05, 0.44, 0.05], NG);
  },
};

const cabinet: SitePropSpec = {
  itemY: 1.12, itemZ: -0.3, eggY: 1.52, r: 0.75, front: 0.5,
  build(b, accent) {
    b.lit.add(BOX, '#2f3347', [0, 0.78, 0], [0, 0, 0], [1.0, 1.56, 0.52], { gradient: 0.3, jitter: 0.05 });
    b.lit.add(BOX, '#232638', [0, 1.6, 0], [0, 0, 0], [1.1, 0.08, 0.6], { gradient: 0 });
    b.lit.add(BOX, '#1b1d2c', [0, 0.04, 0], [0, 0, 0], [1.04, 0.08, 0.56], { gradient: 0 });
    for (let i = 0; i < 4; i++) {
      drawerFront(b, 0, 0.3 + i * 0.35, -0.265, 0.9, 0.3, i % 2 ? '#454b68' : '#3d4260');
      b.lit.add(BOX, '#efe5c8', [0, 0.38 + i * 0.35, -0.29], [0, 0, 0], [0.2, 0.06, 0.01], NG);
    }
    // research cabinet: hasp + padlock across the top drawer
    b.lit.add(BOX, '#1b1d2c', [0, 1.55 - 0.1, -0.29], [0, 0, 0], [0.9, 0.04, 0.02], NG);
    b.em.add(ICO0, BRASS, [0, 1.4, -0.31], [0, 0, 0], [0.06, 0.08, 0.04], NG);
    b.lit.add(BOX, '#efe5c8', [0.24, 1.66, 0.05], [0, 0.4, 0], [0.34, 0.03, 0.26], { gradient: 0.05, jitter: 0.02 });
    b.glows.push({ x: 0, y: 1.4, z: -0.4, size: 0.9, color: accent, alpha: 0.25, flicker: 0.1, fogFloor: 0.05 });
  },
};

const shelf: SitePropSpec = {
  itemY: 1.02, itemZ: -0.1, eggY: 1.02, r: 0.9, front: 0.5,
  build(b, accent) {
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.lit.add(BOX, '#2e1c12', [sx * 0.66, 0.97, sz * 0.18], [0, 0, 0], [0.07, 1.94, 0.07], { gradient: 0.15 });
    for (let i = 0; i < 5; i++) b.lit.add(BOX, '#4a3020', [0, 0.1 + i * 0.46, 0], [0, 0, 0], [1.4, 0.05, 0.42], { gradient: 0.1, jitter: 0.05 });
    b.lit.add(BOX, '#241610', [0, 0.97, 0.2], [0, 0, 0], [1.34, 1.9, 0.03], { gradient: 0.1 });
    const cols = ['#cfe0e8', '#8a4a2a', '#6b2a3a', '#2e4a6b'];
    for (let i = 0; i < 4; i++) {
      const y = 0.13 + i * 0.46;
      for (let k = 0; k < 4; k++) {
        const x = -0.5 + k * 0.33 + (b.rand() - 0.5) * 0.08;
        if (i === 2) { // jars with glowing contents
          b.lit.add(CYL6, cols[0], [x, y + 0.12, 0], [0, 0, 0], [0.07, 0.24, 0.07], NG);
          b.em.add(CYL6, k % 2 ? '#c08bff' : accent, [x, y + 0.1, 0], [0, 0, 0], [0.055, 0.16, 0.055], NG);
        } else {
          const h = 0.2 + b.rand() * 0.12;
          b.lit.add(BOX, cols[1 + ((i + k) % 3)], [x, y + h / 2, 0], [0, (b.rand() - 0.5) * 0.4, 0], [0.12 + b.rand() * 0.08, h, 0.18], { gradient: 0.1, jitter: 0.1 });
        }
      }
    }
  },
};

const crate: SitePropSpec = {
  itemY: 0.86, itemZ: 0, eggY: 0.84, r: 0.85, front: 0.7,
  build(b) {
    b.lit.add(BOX, PAL.wood, [0, 0.36, 0], [0, 0.1, 0], [0.95, 0.72, 0.75], { gradient: 0.3, jitter: 0.1 });
    for (const y of [0.08, 0.64]) b.lit.add(BOX, PAL.woodDark, [0, y, 0], [0, 0.1, 0], [0.99, 0.1, 0.79], { gradient: 0 });
    for (const sx of [-1, 1]) b.lit.add(BOX, PAL.woodDark, [sx * 0.42, 0.36, 0], [0, 0.1, 0], [0.09, 0.72, 0.79], { gradient: 0 });
    b.lit.add(BOX, PAL.woodLight, [0.28, 0.9, 0.05], [0, 0.4, 0.04], [0.55, 0.05, 0.4], { gradient: 0.1 }); // lid half slid off
    b.lit.add(BOX, PAL.wood, [-0.55, 0.28, -0.7], [0, -0.3, 0], [0.7, 0.56, 0.6], { gradient: 0.3, jitter: 0.1 });
    b.lit.add(BOX, PAL.woodDark, [-0.55, 0.28, -0.7], [0, -0.3, 0], [0.74, 0.08, 0.64], { gradient: 0 });
    b.lit.add(ICO0, '#8a7a4a', [-0.1, 0.78, 0], [0.2, 0.5, 0], [0.4, 0.14, 0.3], { gradient: 0.1 }); // straw
    b.lit.add(TORUS_LITE, '#6a5a3a', [0.44, 0.45, -0.4], [0.2, 0.4, 0], [0.14, 0.14, 0.14], NG);
  },
};

const altar: SitePropSpec = {
  itemY: 1.06, itemZ: -0.05, eggY: 1.08, r: 0.95, front: 0.8,
  build(b) {
    b.lit.add(BOX, PAL.stoneDark, [0, 0.14, 0], [0, 0, 0], [1.5, 0.28, 0.95], { gradient: 0.3 });
    b.lit.add(BOX, b.stone(), [0, 0.62, 0], [0, 0, 0], [1.15, 0.68, 0.7], { gradient: 0.4 });
    b.lit.add(BOX, PAL.stoneLight, [0, 1.0, 0], [0, 0, 0], [1.35, 0.1, 0.85], { gradient: 0 });
    for (const sx of [-1, 1]) {
      b.lit.add(CYL6, '#e8dcc0', [sx * 0.52, 1.14, 0.18], [0, 0, 0], [0.045, 0.2, 0.045], NG);
      b.em.add(CONE4, '#ffcf70', [sx * 0.52, 1.28, 0.18], [0, Math.PI / 4, 0], [0.04, 0.1, 0.04], NG);
      b.glows.push({ x: sx * 0.52, y: 1.3, z: 0.18, size: 1.2, color: '#ffcf70', alpha: 0.4, flicker: 0.8, fogFloor: 0.05 });
    }
    b.lit.add(ICO0, '#e8e0d0', [-0.2, 1.1, 0.22], [0, 0.4, 0], [0.09, 0.08, 0.1], NG); // skull
    b.lit.add(CYL8, '#4a4a60', [0.25, 1.07, 0.15], [0, 0, 0], [0.12, 0.05, 0.12], NG);
    for (let i = 0; i < 3; i++) b.em.add(BOX, '#8affc8', [-0.3 + i * 0.3, 0.6, -0.355], [0, 0, 0], [0.12, 0.04, 0.01], NG); // carved runes
  },
};

const console_: SitePropSpec = {
  itemY: 1.0, itemZ: -0.2, eggY: 1.0, r: 0.9, front: 0.7,
  build(b, accent) {
    b.lit.add(BOX, '#232842', [0, 0.45, 0], [0, 0, 0], [1.3, 0.9, 0.62], { gradient: 0.25 });
    b.lit.add(BOX, '#2e3556', [0, 0.97, -0.08], [-0.45, 0, 0], [1.3, 0.1, 0.52], { gradient: 0.15 });
    for (let i = 0; i < 8; i++) {
      const x = -0.5 + (i % 4) * 0.33, rz = i < 4 ? -0.02 : -0.18;
      b.lit.add(BOX, '#10152e', [x, 1.03, rz], [-0.45, 0, 0], [0.12, 0.03, 0.12], NG);
      b.em.add(BOX, i === 3 ? '#ff4a4a' : i % 3 === 0 ? '#ffd24a' : accent, [x, 1.05, rz - 0.01], [-0.45, 0, 0], [0.08, 0.03, 0.07], NG);
    }
    b.lit.add(BOX, '#10152e', [0, 1.42, 0.18], [-0.1, 0, 0], [0.95, 0.52, 0.07], NG);
    b.em.add(BOX, accent, [0, 1.42, 0.14], [-0.1, 0, 0], [0.84, 0.42, 0.01], NG);
    for (let i = 0; i < 4; i++) b.lit.add(BOX, '#10152e', [-0.3 + i * 0.2, 1.4, 0.135], [-0.1, 0, 0], [0.05, 0.1 + (i % 3) * 0.08, 0.005], NG);
    b.lit.add(BOX, '#1b1d2c', [0, 1.12, 0.2], [0, 0, 0], [0.12, 0.28, 0.1], NG);
    b.glows.push({ x: 0, y: 1.4, z: -0.1, size: 2.2, color: accent, alpha: 0.4, flicker: 0.35, fogFloor: 0.08 });
  },
};

const locker: SitePropSpec = {
  itemY: 1.0, itemZ: -0.35, eggY: 1.0, r: 0.8, front: 0.6,
  build(b) {
    b.lit.add(BOX, '#38405a', [0, 0.97, 0.02], [0, 0, 0], [1.1, 1.94, 0.5], { gradient: 0.3, jitter: 0.04 });
    b.lit.add(BOX, '#2a3048', [0, 1.97, 0.02], [0, 0, 0], [1.14, 0.06, 0.54], { gradient: 0 });
    b.lit.add(BOX, '#1b1d2c', [0, 0.03, 0.02], [0, 0, 0], [1.12, 0.06, 0.52], { gradient: 0 });
    b.lit.add(BOX, '#10152e', [0, 0.97, -0.235], [0, 0, 0], [0.02, 1.85, 0.02], NG);
    for (const sx of [-1, 1]) {
      for (let i = 0; i < 3; i++) b.lit.add(BOX, '#10152e', [sx * 0.27, 1.55 + i * 0.07, -0.245], [0, 0, 0], [0.34, 0.025, 0.01], NG);
      b.lit.add(BOX, '#aab0c8', [sx * 0.1, 0.95, -0.255], [0, 0, 0], [0.04, 0.16, 0.03], NG);
    }
    // left door ajar: dark interior + hinged door
    b.lit.add(BOX, '#05060f', [-0.27, 0.95, -0.236], [0, 0, 0], [0.46, 1.78, 0.02], NG);
    b.lit.add(BOX, '#454e6c', [-0.62, 0.95, -0.34], [0, 0.95, 0], [0.5, 1.8, 0.04], { gradient: 0.2 });
  },
};

const workbench: SitePropSpec = {
  itemY: 0.98, itemZ: -0.05, eggY: 0.98, r: 1.0, front: 0.8,
  build(b, accent) {
    b.lit.add(BOX, '#5a3d2a', [0, 0.9, 0], [0, 0, 0], [1.6, 0.1, 0.75], { gradient: 0.2, jitter: 0.06 });
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.lit.add(BOX, '#2e1c12', [sx * 0.72, 0.43, sz * 0.3], [0, 0, 0], [0.1, 0.86, 0.1], { gradient: 0.1 });
    b.lit.add(BOX, '#3a2517', [0, 0.3, 0], [0, 0, 0], [1.5, 0.05, 0.65], { gradient: 0 });
    b.lit.add(BOX, '#1b1d2c', [0.62, 1.0, -0.2], [0, 0, 0], [0.16, 0.12, 0.2], { gradient: 0.1 }); // vise
    b.lit.add(BOX, '#aab0c8', [0.62, 1.07, -0.34], [0, 0, 0], [0.12, 0.06, 0.07], NG);
    b.lit.add(CYL8, '#6a6f8a', [-0.5, 0.97, -0.1], [0, 0, 0], [0.14, 0.04, 0.14], { gradient: 0.1 }); // gear
    b.lit.add(CYL8, '#4a4f6a', [-0.28, 0.96, 0.1], [0, 0, 0], [0.1, 0.03, 0.1], { gradient: 0.1 });
    b.lit.add(BOX, '#7a5233', [-0.05, 0.98, 0.18], [0, 0.5, 0], [0.34, 0.03, 0.04], NG); // hammer
    b.lit.add(BOX, '#aab0c8', [0.1, 0.99, 0.12], [0, 0.5, 0], [0.1, 0.07, 0.06], NG);
    b.lit.add(CYL6, '#8a6a3a', [0.05, 0.96, -0.2], [0, 0, Math.PI / 2], [0.04, 0.4, 0.04], NG); // pipe
    b.em.add(CYL6, accent, [-0.62, 0.99, 0.12], [0, 0, 0], [0.025, 0.08, 0.025], NG);
    b.lit.add(BOX, '#3a2517', [0, 1.35, 0.34], [0, 0, 0], [1.4, 0.8, 0.04], { gradient: 0.1 }); // pegboard
    for (let i = 0; i < 5; i++) b.lit.add(BOX, i % 2 ? '#aab0c8' : '#7a5233', [-0.5 + i * 0.25, 1.35, 0.31], [0, 0, 0.1 * i - 0.2], [0.04, 0.4 + (i % 3) * 0.1, 0.02], NG);
  },
};

const nest: SitePropSpec = {
  itemY: 0.4, itemZ: 0, eggY: 0.34, r: 1.0, front: 0.95,
  build(b) {
    b.lit.add(CYL12, PAL.stoneDark, [0, 0.12, 0], [0, 0, 0], [0.95, 0.24, 0.95], { gradient: 0.1 });
    b.lit.add(CYL12, '#2c3260', [0, 0.27, 0], [0, 0, 0], [0.78, 0.1, 0.78], { gradient: 0 });
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2;
      b.lit.add(CONE4, '#3a2a20', [Math.cos(a) * 0.62, 0.45, Math.sin(a) * 0.62], [Math.sin(a) * 0.7, 0, -Math.cos(a) * 0.7], [0.05, 0.55, 0.05], NG);
    }
    for (let i = 0; i < 5; i++) b.lit.add(ICO0, '#8a7a4a', [Math.cos(i * 1.3) * 0.3, 0.34, Math.sin(i * 1.3) * 0.3], [i, i * 2, 0], [0.18, 0.05, 0.12], NG);
  },
};

const sarcophagus: SitePropSpec = {
  itemY: 1.06, itemZ: -0.1, eggY: 0.98, r: 1.3, front: 1.3,
  build(b) {
    const L = 2.0, W = 0.95, H = 0.85;
    b.lit.add(BOX, PAL.stoneDark, [0, 0.12, 0], [0, 0, 0], [W + 0.3, 0.24, L + 0.3], { gradient: 0.2 });
    b.lit.add(BOX, PAL.stone[1], [0, H / 2 + 0.1, 0], [0, 0, 0], [W, H, L], { gradient: 0.4 });
    b.lit.add(BOX, '#05060f', [0, H + 0.14, -L * 0.18], [0, 0, 0], [W * 0.82, 0.05, L * 0.5], { gradient: 0, jitter: 0 });
    b.lit.add(BOX, PAL.stoneLight, [0.14, H + 0.32, L * 0.22], [0, -0.28, 0], [W * 0.98, 0.2, L * 0.55], { gradient: 0 });
    b.lit.add(BOX, PAL.stoneDark, [0.14, H + 0.45, L * 0.22], [0, -0.28, 0], [0.1, 0.06, L * 0.4], { gradient: 0 });
    b.lit.add(BOX, PAL.stoneDark, [0.14, H + 0.45, L * 0.1], [0, -0.28, 0], [W * 0.5, 0.06, 0.1], { gradient: 0 });
    b.em.add(ICO0, '#8affc8', [0, H + 0.2, -L * 0.2], [0, 0, 0], 0.05, NG);
  },
};

const planter: SitePropSpec = {
  itemY: 0.74, itemZ: -0.05, eggY: 0.72, r: 0.9, front: 0.6,
  build(b, accent) {
    b.lit.add(BOX, PAL.woodDark, [0, 0.3, 0], [0, 0, 0], [1.3, 0.6, 0.62], { gradient: 0.3 });
    b.lit.add(BOX, '#1d2a22', [0, 0.61, 0], [0, 0, 0], [1.2, 0.05, 0.52], { gradient: 0 });
    for (let i = 0; i < 4; i++) {
      const x = -0.45 + i * 0.3, h = 0.4 + ((i * 37) % 5) * 0.08;
      b.lit.add(CONE6, ['#2f6b4a', '#3b7a52', '#25563f', '#3b7a52'][i], [x, 0.62 + h / 2, (i % 2 ? 0.08 : -0.06)], [0, i, 0.06 * (i - 1.5)], [0.2, h, 0.2], NG);
      b.em.add(ICO0, i % 2 ? '#c8a2ff' : accent, [x, 0.62 + h, (i % 2 ? 0.08 : -0.06)], [0, 0, 0], 0.06, NG);
    }
    for (const sx of [-1, 1]) b.lit.add(CYL6, '#8a4a2a', [sx * 0.72, 0.12, -0.46], [0, 0, 0], [0.13, 0.24, 0.13], NG);
    b.glows.push({ x: 0, y: 0.95, z: 0, size: 1.4, color: accent, alpha: 0.3, flicker: 0.4, fogFloor: 0.05 });
  },
};

const TORUS_LITE = new THREE.TorusGeometry(1, 0.22, 4, 8);

export const SITE_PROPS: Record<SitePropKind, SitePropSpec> = {
  desk, cabinet, shelf, crate, altar, console: console_, locker, workbench, nest, sarcophagus, planter,
};

/** Accent (emissive) colour of the props per theme — the only theme-dependent detail of the furniture. */
export const ACCENT: Record<'archive' | 'crypt' | 'signal', string> = { archive: '#7bffb0', crypt: '#ffb04a', signal: '#4fe6f2' };

/** Local-space geometry of a prop (lit + emissive merged) for the outline hull and the interactable highlight. */
export function buildPropHullGeometry(kind: SitePropKind): THREE.BufferGeometry {
  const rand = (() => { let s = 12345; return () => { s = (s * 16807) % 2147483647; return s / 2147483647; }; })();
  const b = new Bld(rand);
  SITE_PROPS[kind].build(b, '#ffffff');
  const parts = [b.lit.build(), b.em.build()].filter((g) => g.getAttribute('position'));
  const merged = mergeAll(parts) ?? new THREE.BufferGeometry();
  merged.deleteAttribute('color');
  return merged;
}

/** Yaw (world, 0 faces -Z) a prop at `site` should face: away from a nearby wall, else toward the closest patrol point (open ground). */
export function siteYaw(map: MapDef, x: number, z: number): number {
  let best: { d: number; nx: number; nz: number } | null = null;
  for (const w of map.walls) {
    const dx = w.b.x - w.a.x, dz = w.b.z - w.a.z;
    const l2 = dx * dx + dz * dz || 1e-9;
    const t = Math.max(0, Math.min(1, ((x - w.a.x) * dx + (z - w.a.z) * dz) / l2));
    const px = w.a.x + dx * t, pz = w.a.z + dz * t;
    const d = distPointSeg(x, z, w.a.x, w.a.z, w.b.x, w.b.z) - w.thickness / 2;
    if (d < 2.4 && (!best || d < best.d)) best = { d, nx: x - px, nz: z - pz };
  }
  if (best && Math.hypot(best.nx, best.nz) > 0.05) return Math.atan2(-best.nx, -best.nz);
  let bd = Infinity;
  let tx = x, tz = z - 1;
  for (const p of map.patrol) {
    const d = Math.hypot(p.x - x, p.z - z);
    if (d < bd) { bd = d; tx = p.x; tz = p.z; }
  }
  return Math.atan2(-(tx - x), -(tz - z));
}

/** All candidate sites of the map's world, or synthetic ones (desk / nest) from the session clues for a map without a world. */
export function sitesOf(map: MapDef): { clue: { clueId: string; site: SiteDef }[]; egg: SiteDef[]; all: SiteDef[] } {
  const w = map.world;
  if (w) {
    const clue = w.clueSites.flatMap((g) => g.sites.map((site) => ({ clueId: g.clueId as string, site })));
    const egg: SiteDef[] = w.eggSites;
    return { clue, egg, all: [...clue.map((c) => c.site), ...egg] };
  }
  const clue = map.clues.map((c) => ({ clueId: c.clueId as string, site: { id: `s_${c.clueId}`, areaId: '', roomId: c.roomId, x: c.x, z: c.z, prior: 1, label: '', prop: 'desk' as const } }));
  const egg: SiteDef[] = [{ id: 's_egg', areaId: '', roomId: 'path', x: map.eggSpawn.x, z: map.eggSpawn.z, prior: 1, label: '', prop: 'nest' }];
  return { clue, egg, all: [...clue.map((c) => c.site), ...egg] };
}

export function pointsOfSites(map: MapDef): Vec2[] { return sitesOf(map).all.map((s) => ({ x: s.x, z: s.z })); }
