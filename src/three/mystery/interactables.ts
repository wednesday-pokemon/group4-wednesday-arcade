// Examine props (ExamineDef.prop), the passage lever and the hazard floor decals. Models are local-space (origin = ground centre,
// front = -Z) so they can be merged into the static dressing; `EXAMINE_R` is the footprint used for the outline hull and placement.
import * as THREE from 'three';
import type { ExamineDef, HazardDef, Vec2 } from '../../mystery/types.ts';
import { TriBuilder, pointInPoly } from '../action/geom.ts';
import { mergeAll } from '../action/geom.ts';
import { Bld } from './builders.ts';
import { BOX, CONE4, CONE6, CYL6, CYL8, ICO0, ICO1, PAL, TORUS } from './common.ts';
import { seeded } from './common.ts';

const NG = { gradient: 0, jitter: 0 } as const;

/** a flat triangle hanging from its top edge (the cobweb's cloth): apex at -Y */
const WEB_TRI = (() => {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, 0, 0, 0.5, 0, 0, 0, -1, 0], 3));
  return g;
})();

export type ExamineKind = ExamineDef['prop'];

type Builder = (b: Bld, accent: string) => void;

const vial: Builder = (b, accent) => {
  b.lit.add(BOX, PAL.stoneDark, [0, 0.35, 0], [0, 0, 0], [0.5, 0.7, 0.5], { gradient: 0.3 });
  b.lit.add(BOX, PAL.stoneLight, [0, 0.72, 0], [0, 0, 0], [0.6, 0.06, 0.6], { gradient: 0 });
  b.lit.add(CYL6, '#cfe0e8', [0, 0.86, 0], [0.2, 0, 0.35], [0.06, 0.26, 0.06], NG); // cracked vial lying on its side
  b.em.add(CYL6, accent, [0, 0.855, 0], [0.2, 0, 0.35], [0.045, 0.2, 0.045], NG);
  b.em.add(ICO1, accent, [0.1, 0.755, -0.05], [0, 0, 0], [0.16, 0.012, 0.1], NG); // spill
  b.em.add(ICO0, accent, [0.2, 0.0, -0.1], [0, 0, 0], [0.12, 0.012, 0.09], NG); // drips on the floor
  b.lit.add(BOX, '#1b1d2c', [0.0, 0.88, -0.03], [0, 0.6, 0.4], [0.12, 0.004, 0.012], NG); // crack
  b.glows.push({ x: 0.05, y: 0.85, z: 0, size: 1.1, color: accent, alpha: 0.45, flicker: 0.5, fogFloor: 0.05 });
};

const books: Builder = (b) => {
  b.lit.add(BOX, PAL.woodDark, [0, 0.22, 0], [0, 0, 0], [0.5, 0.44, 0.4], { gradient: 0.3 });
  const cols = ['#6b2a3a', '#2e4a6b', '#4a6b3a', '#6b5a2a', '#4a2f6b'];
  for (let i = 0; i < 6; i++) b.lit.add(BOX, cols[i % 5], [(b.rand() - 0.5) * 0.12, 0.46 + i * 0.07, (b.rand() - 0.5) * 0.08], [0, (b.rand() - 0.5) * 0.9, 0], [0.34 - (i % 3) * 0.04, 0.065, 0.24], { gradient: 0.1, jitter: 0.1 });
  b.lit.add(BOX, '#efe5c8', [0.38, 0.02, -0.2], [0, 0.4, 0], [0.22, 0.012, 0.16], NG); // spilled pages
  b.lit.add(BOX, '#e8dcc0', [-0.34, 0.02, -0.3], [0, -0.5, 0], [0.2, 0.012, 0.15], NG);
  b.em.add(BOX, '#e0b040', [0.0, 0.9, -0.1], [0, 0.2, 0], [0.025, 0.008, 0.2], NG);
};

const lab: Builder = (b, accent) => {
  b.lit.add(BOX, '#3a3d52', [0, 0.45, 0], [0, 0, 0], [1.0, 0.9, 0.5], { gradient: 0.3 });
  b.lit.add(BOX, '#232638', [0, 0.92, 0], [0, 0, 0], [1.1, 0.06, 0.6], NG);
  b.lit.add(CYL8, '#cfe0e8', [-0.3, 1.08, 0], [0, 0, 0], [0.12, 0.28, 0.12], NG);
  b.em.add(CYL8, accent, [-0.3, 1.02, 0], [0, 0, 0], [0.095, 0.14, 0.095], NG);
  b.lit.add(CYL6, '#cfe0e8', [0.1, 1.06, 0.1], [0, 0, 0.5], [0.04, 0.4, 0.04], NG); // tube
  b.lit.add(CYL8, '#8a8f9c', [0.35, 0.98, -0.1], [0, 0, 0], [0.1, 0.1, 0.1], NG); // burner
  b.em.add(CONE4, '#ff9a4a', [0.35, 1.07, -0.1], [0, Math.PI / 4, 0], [0.03, 0.08, 0.03], NG);
  for (let i = 0; i < 7; i++) { // shattered flask on the floor
    const a = i * 0.9;
    b.em.add(ICO0, '#bfe8f2', [0.45 + Math.cos(a) * 0.3, 0.02, -0.5 + Math.sin(a) * 0.2], [a, a * 2, 0], [0.07, 0.012, 0.05], NG);
  }
  b.glows.push({ x: -0.3, y: 1.1, z: 0, size: 1.3, color: accent, alpha: 0.4, flicker: 0.4, fogFloor: 0.05 });
};

const vines: Builder = (b, accent) => {
  b.lit.add(CYL6, PAL.woodDark, [0, 0.8, 0], [0, 0, 0], [0.08, 1.6, 0.08], { gradient: 0.1 }); // stake the vines have taken over
  for (let i = 0; i < 9; i++) {
    const a = i * 2.1, h = 0.2 + i * 0.16;
    b.lit.add(ICO1, ['#1f4a30', '#2a5a3a', '#173a26'][i % 3], [Math.cos(a) * 0.25, h, Math.sin(a) * 0.25], [a, a, 0], [0.22, 0.12, 0.2], { gradient: 0.2, jitter: 0.1 });
  }
  for (let i = 0; i < 3; i++) b.lit.add(CYL6, '#1f4a30', [Math.cos(i * 2.1) * 0.4, 0.04, Math.sin(i * 2.1) * 0.4], [0, 0, Math.PI / 2], [0.025, 0.7, 0.025], NG); // creeping tendrils
  for (let i = 0; i < 3; i++) b.em.add(ICO0, i === 1 ? '#c8a2ff' : accent, [Math.cos(i * 2.1 + 0.5) * 0.3, 0.5 + i * 0.4, Math.sin(i * 2.1 + 0.5) * 0.3], [0, 0, 0], 0.07, NG);
  b.glows.push({ x: 0, y: 0.9, z: 0, size: 1.5, color: accent, alpha: 0.35, flicker: 0.5, fogFloor: 0.05 });
};

const lantern: Builder = (b) => {
  b.lit.add(CYL8, PAL.iron, [0, 0.12, 0], [0, 0, Math.PI / 2], [0.12, 0.28, 0.12], NG); // lantern lying knocked over
  b.lit.add(BOX, PAL.iron, [-0.15, 0.12, 0], [0, 0, 0], [0.02, 0.26, 0.26], NG);
  b.em.add(CYL8, '#ffb04a', [0.02, 0.12, 0], [0, 0, Math.PI / 2], [0.08, 0.2, 0.08], NG);
  b.lit.add(TORUS, PAL.iron, [0.15, 0.2, 0], [0, Math.PI / 2, 0], [0.1, 0.1, 0.1], NG);
  b.em.add(ICO1, '#6a4a22', [0.3, 0.008, 0.05], [0, 0, 0], [0.34, 0.008, 0.24], NG); // spilled oil
  b.glows.push({ x: 0.0, y: 0.2, z: 0, size: 2.0, color: '#ffb04a', alpha: 0.55, flicker: 0.9, fogFloor: 0.1 });
};

const machine: Builder = (b, accent) => {
  b.lit.add(BOX, '#3a3f58', [0, 0.5, 0], [0, 0, 0], [1.2, 1.0, 0.8], { gradient: 0.3 });
  b.lit.add(BOX, '#2a2f48', [0, 1.05, 0], [0, 0, 0], [1.3, 0.1, 0.9], NG);
  b.lit.add(CYL8, '#6a6f8a', [-0.25, 0.6, -0.42], [Math.PI / 2, 0, 0], [0.34, 0.1, 0.34], { gradient: 0.1 }); // big gear
  b.lit.add(CYL8, '#8a6a3a', [0.28, 0.45, -0.42], [Math.PI / 2, 0.2, 0], [0.2, 0.08, 0.2], { gradient: 0.1 });
  for (let i = 0; i < 8; i++) b.lit.add(BOX, '#6a6f8a', [-0.25 + Math.cos(i * 0.785) * 0.36, 0.6 + Math.sin(i * 0.785) * 0.36, -0.42], [0, 0, i * 0.785], [0.1, 0.08, 0.1], NG);
  b.lit.add(CYL6, '#8a6a3a', [0.5, 1.35, 0.2], [0, 0, 0], [0.07, 0.5, 0.07], NG); // pipe + broken elbow
  b.lit.add(CYL6, '#8a6a3a', [0.62, 1.58, 0.2], [0, 0, 1.2], [0.07, 0.3, 0.07], NG);
  b.em.add(CYL8, accent, [0.3, 0.85, -0.41], [Math.PI / 2, 0, 0], [0.07, 0.02, 0.07], NG);
  b.em.add(ICO0, '#ff4a4a', [-0.5, 0.88, -0.41], [0, 0, 0], 0.04, NG);
  b.lit.add(BOX, '#05060f', [0.0, 0.18, -0.405], [0, 0, 0], [0.7, 0.28, 0.02], NG);
  b.glows.push({ x: 0.3, y: 0.85, z: -0.5, size: 1.2, color: accent, alpha: 0.3, flicker: 0.6, fogFloor: 0.05 });
};

const cobweb: Builder = (b) => {
  // two broken posts with a crossbeam; a sagging triangular web hangs from it, with a few spokes and strands
  for (const s of [-1, 1]) b.lit.add(CYL6, '#2a2018', [s * 0.75, 0.95, 0], [0, 0, s * 0.06], [0.05, 1.9, 0.05], { gradient: 0.1 });
  b.lit.add(BOX, '#2a2018', [0, 1.85, 0], [0, 0, 0.04], [1.62, 0.06, 0.06], NG);
  b.glass.add(WEB_TRI, '#f0f0f8', [0, 1.84, 0.02], [0, 0, 0], [1.5, 1.3, 1], NG);
  b.glass.add(WEB_TRI, '#f0f0f8', [0.55, 1.84, 0.1], [0, 0.5, 0], [0.7, 0.8, 1], NG);
  for (let i = 0; i < 5; i++) b.lit.add(BOX, '#d8d8e4', [(i - 2) * 0.17, 1.3, 0.03], [0, 0, (i - 2) * 0.13], [0.012, 1.0, 0.012], NG);
  for (let k = 0; k < 3; k++) b.lit.add(BOX, '#d8d8e4', [0, 1.55 - k * 0.28, 0.03], [0, 0, 0], [1.1 - k * 0.32, 0.01, 0.01], NG);
  b.lit.add(ICO0, '#1a1a22', [0.12, 1.12, 0.05], [0, 0, 0], [0.05, 0.04, 0.05], NG); // spider
  b.lit.add(BOX, '#e8e8f0', [-0.4, 0.04, 0.3], [0, 0.4, 0], [0.3, 0.01, 0.12], NG); // tatters on the floor
};

const radio: Builder = (b) => {
  b.lit.add(BOX, PAL.wood, [0, 0.3, 0], [0, 0, 0], [0.7, 0.6, 0.55], { gradient: 0.3 });
  b.lit.add(BOX, '#3a2a20', [0, 0.78, 0], [0, 0, 0], [0.5, 0.34, 0.26], { gradient: 0.2 });
  b.lit.add(CYL8, '#2a2d44', [-0.12, 0.78, -0.14], [Math.PI / 2, 0, 0], [0.1, 0.02, 0.1], NG);
  b.em.add(BOX, '#ffcf70', [0.12, 0.86, -0.14], [0, 0, 0], [0.16, 0.05, 0.01], NG); // dial
  b.em.add(ICO0, '#7bffb0', [0.2, 0.74, -0.14], [0, 0, 0], 0.02, NG);
  b.lit.add(CYL6, '#aab0c8', [0.18, 1.15, 0.05], [0, 0, 0.2], [0.012, 0.6, 0.012], NG); // antenna
  b.lit.add(BOX, '#e8dcc0', [0.45, 0.02, -0.3], [0, 0.6, 0], [0.22, 0.01, 0.16], NG);
  b.glows.push({ x: 0.12, y: 0.86, z: -0.15, size: 1.0, color: '#ffcf70', alpha: 0.4, flicker: 0.5, fogFloor: 0.05 });
};

const alarm: Builder = (b) => {
  b.lit.add(CYL6, PAL.iron, [0, 0.8, 0], [0, 0, 0], [0.06, 1.6, 0.06], NG);
  b.lit.add(BOX, '#3a2a2a', [0, 1.2, -0.08], [0, 0, 0], [0.4, 0.5, 0.14], { gradient: 0.2 }); // alarm box
  b.lit.add(CYL8, '#c8a24a', [0, 1.55, -0.08], [0, 0, 0], [0.12, 0.1, 0.12], NG); // bell
  b.em.add(ICO1, '#ff4a4a', [0, 1.78, 0], [0, 0, 0], [0.12, 0.15, 0.12], NG);
  b.em.add(BOX, '#ff4a4a', [0, 1.2, -0.16], [0, 0, 0], [0.18, 0.18, 0.01], NG);
  b.lit.add(BOX, '#232638', [0, 0.06, 0], [0, 0, 0], [0.4, 0.12, 0.4], NG);
  b.glows.push({ x: 0, y: 1.78, z: 0, size: 1.9, color: '#ff4a4a', alpha: 0.6, flicker: 0.8, fogFloor: 0.1 });
};

const map: Builder = (b) => {
  for (const s of [-1, 1]) b.lit.add(CYL6, PAL.woodDark, [s * 0.4, 0.7, 0.15], [0.12, 0, s * -0.1], [0.04, 1.45, 0.04], NG);
  b.lit.add(BOX, '#5a3d2a', [0, 1.05, -0.02], [-0.12, 0, 0], [1.0, 0.7, 0.05], { gradient: 0.2 });
  b.lit.add(BOX, '#e8dcc0', [0, 1.05, -0.06], [-0.12, 0, 0], [0.88, 0.58, 0.01], { gradient: 0.05, jitter: 0.03 });
  for (let i = 0; i < 4; i++) b.lit.add(BOX, '#6a5a3a', [-0.25 + i * 0.17, 1.05 + ((i * 7) % 3) * 0.1 - 0.08, -0.07], [-0.12, 0, i], [0.2, 0.012, 0.012], NG);
  b.em.add(ICO0, '#ff4a4a', [0.18, 1.1, -0.075], [0, 0, 0], 0.03, NG);
  b.em.add(ICO0, '#ff4a4a', [-0.2, 0.95, -0.075], [0, 0, 0], 0.03, NG);
  b.em.add(BOX, '#ff6a5a', [0.0, 1.03, -0.075], [-0.12, 0, 0.5], [0.4, 0.006, 0.012], NG);
  b.lit.add(BOX, '#e8dcc0', [0.3, 0.02, -0.4], [0, 0.4, 0], [0.18, 0.01, 0.12], NG);
};

const footprints: Builder = (b, accent) => {
  for (let i = 0; i < 8; i++) {
    const side = i % 2 ? 1 : -1;
    const x = side * 0.16, z = 0.8 - i * 0.4;
    b.lit.add(ICO0, '#1a1f2e', [x, 0.015, z], [0, 0.15 * side, 0], [0.09, 0.012, 0.18], NG);
    b.em.add(ICO0, accent, [x, 0.018, z], [0, 0.15 * side, 0], [0.06, 0.006, 0.13], { gradient: 0, jitter: 0 });
  }
  b.glows.push({ x: 0, y: 0.15, z: 0, size: 1.6, color: accent, alpha: 0.28, flicker: 0.3, fogFloor: 0.05 });
};

export const EXAMINE_PROPS: Record<ExamineKind, { build: Builder; r: number }> = {
  vial: { build: vial, r: 0.6 }, books: { build: books, r: 0.6 }, lab: { build: lab, r: 0.8 }, vines: { build: vines, r: 0.6 },
  lantern: { build: lantern, r: 0.5 }, machine: { build: machine, r: 0.9 }, cobweb: { build: cobweb, r: 0.8 }, radio: { build: radio, r: 0.6 },
  alarm: { build: alarm, r: 0.5 }, map: { build: map, r: 0.7 }, footprints: { build: footprints, r: 0.9 },
};

export function buildExamineHullGeometry(kind: ExamineKind): THREE.BufferGeometry {
  const b = new Bld(seeded('examine-hull:' + kind));
  EXAMINE_PROPS[kind].build(b, '#ffffff');
  const g = mergeAll([b.lit.build(), b.em.build()].filter((x) => x.getAttribute('position'))) ?? new THREE.BufferGeometry();
  g.deleteAttribute('color');
  return g;
}

// ------------------------------------------------------------------------------------------------ passage lever
/** Static base of the lever (stone pedestal with a slot). The arm is dynamic: see `leverArmGeometry`. Front = -Z. */
export function leverBase(b: Bld, accent: string): void {
  b.lit.add(BOX, PAL.stoneDark, [0, 0.12, 0], [0, 0, 0], [0.7, 0.24, 0.5], { gradient: 0.3 });
  b.lit.add(BOX, PAL.stone[1], [0, 0.55, 0], [0, 0, 0], [0.5, 0.7, 0.34], { gradient: 0.4 });
  b.lit.add(BOX, '#05060f', [0, 0.62, -0.175], [0, 0, 0], [0.12, 0.42, 0.02], NG); // slot
  b.lit.add(BOX, PAL.stoneLight, [0, 0.93, 0], [0, 0, 0], [0.6, 0.08, 0.44], NG);
  b.em.add(BOX, accent, [0, 0.42, -0.176], [0, 0, 0], [0.34, 0.025, 0.01], NG);
  for (const s of [-1, 1]) b.em.add(BOX, accent, [s * 0.18, 0.78, -0.176], [0, 0, 0], [0.04, 0.12, 0.01], NG);
}

export function leverArmGeometry(): THREE.BufferGeometry {
  const b = new Bld(seeded('lever-arm'));
  b.lit.add(CYL6, '#9aa0b8', [0, 0.28, 0], [0, 0, 0], [0.028, 0.56, 0.028], NG);
  b.lit.add(ICO0, '#c8a24a', [0, 0.58, 0], [0, 0, 0], 0.07, NG);
  b.em.add(ICO0, '#ffe08a', [0, 0.58, 0], [0, 0, 0], 0.035, NG);
  const g = mergeAll([b.lit.build(), b.em.build()]) ?? new THREE.BufferGeometry();
  return g;
}

export function buildLeverHullGeometry(): THREE.BufferGeometry {
  const b = new Bld(seeded('lever-hull'));
  leverBase(b, '#ffffff');
  const g = mergeAll([b.lit.build(), b.em.build()].filter((x) => x.getAttribute('position'))) ?? new THREE.BufferGeometry();
  g.deleteAttribute('color');
  return g;
}

// ------------------------------------------------------------------------------------------------ hazard decals
export interface HazardDecals { lit: THREE.BufferGeometry | null; em: THREE.BufferGeometry | null; puddle: THREE.BufferGeometry | null; glows: { x: number; y: number; z: number; size: number; color: string; alpha: number; flicker: number }[] }

function polyBounds(poly: Vec2[]): { x0: number; x1: number; z0: number; z1: number } {
  const xs = poly.map((p) => p.x), zs = poly.map((p) => p.z);
  return { x0: Math.min(...xs), x1: Math.max(...xs), z0: Math.min(...zs), z1: Math.max(...zs) };
}

/** Floor decals for every noisy_floor hazard: glass shards, loose boards, rubble, puddles. Legible from a distance (bright accents on a dark patch). */
export function buildHazardDecals(hazards: HazardDef[], low: boolean): HazardDecals {
  const lit = new TriBuilder();
  const em = new TriBuilder();
  const pd = new TriBuilder();
  const glows: HazardDecals['glows'] = [];
  const up: [number, number, number] = [0, 1, 0];
  for (const h of hazards) {
    if (h.kind !== 'noisy_floor') continue;
    const rand = seeded('hazard:' + h.id);
    const bb = polyBounds(h.polygon);
    const area = (bb.x1 - bb.x0) * (bb.z1 - bb.z0);
    const inside = (x: number, z: number): boolean => pointInPoly(h.polygon, x, z);
    const scatter = (n: number, fn: (x: number, z: number) => void): void => {
      let made = 0, tries = 0;
      while (made < n && tries < n * 8) {
        tries++;
        const x = bb.x0 + rand() * (bb.x1 - bb.x0), z = bb.z0 + rand() * (bb.z1 - bb.z0);
        if (!inside(x, z)) continue;
        made++;
        fn(x, z);
      }
    };
    const patch = (c: [number, number, number], y: number): void => {
      // dark base patch following the polygon's bounding rect (clipped by cell centres)
      const step = 1;
      for (let x = Math.floor(bb.x0); x < bb.x1; x += step) {
        for (let z = Math.floor(bb.z0); z < bb.z1; z += step) {
          if (!inside(x + step / 2, z + step / 2)) continue;
          lit.tri([x, y, z], [x, y, z + step], [x + step, y, z + step], c, up);
          lit.tri([x, y, z], [x + step, y, z + step], [x + step, y, z], c, up);
        }
      }
    };
    const nScale = low ? 0.6 : 1;
    // worn edge dashes around the polygon (a floor marking that says "this surface is different")
    const dashColor: [number, number, number] = h.look === 'glass' ? [0.7, 0.9, 1] : h.look === 'boards' ? [0.9, 0.62, 0.3] : h.look === 'rubble' ? [0.85, 0.75, 0.6] : [0.45, 0.8, 1];
    for (let k = 0; k < h.polygon.length; k++) {
      const a = h.polygon[k], b = h.polygon[(k + 1) % h.polygon.length];
      const len = Math.hypot(b.x - a.x, b.z - a.z);
      if (len < 0.5) continue;
      const ux = (b.x - a.x) / len, uz = (b.z - a.z) / len, nx = -uz, nz = ux;
      for (let d = 0.3; d < len - 0.2; d += 0.85) {
        const x = a.x + ux * d, z = a.z + uz * d, L = 0.32, W = 0.05;
        em.tri([x - ux * L - nx * W, 0.075, z - uz * L - nz * W], [x - ux * L + nx * W, 0.075, z - uz * L + nz * W], [x + ux * L + nx * W, 0.075, z + uz * L + nz * W], dashColor, up);
        em.tri([x - ux * L - nx * W, 0.075, z - uz * L - nz * W], [x + ux * L + nx * W, 0.075, z + uz * L + nz * W], [x + ux * L - nx * W, 0.075, z + uz * L - nz * W], dashColor, up);
      }
    }
    switch (h.look) {
      case 'glass': {
        patch([0.07, 0.1, 0.13], 0.052);
        scatter(Math.round(area * 3.4 * nScale), (x, z) => {
          const s = 0.16 + rand() * 0.34, a = rand() * 6.28, y = 0.07 + rand() * 0.04;
          const c: [number, number, number] = [0.65 + rand() * 0.3, 0.85 + rand() * 0.15, 0.95 + rand() * 0.05];
          em.tri([x, y, z], [x + Math.cos(a) * s, y + rand() * 0.05, z + Math.sin(a) * s], [x + Math.cos(a + 1.9) * s * 0.7, y, z + Math.sin(a + 1.9) * s * 0.7], c, up);
        });
        scatter(Math.max(3, Math.round(area / 1.6)), (x, z) => glows.push({ x, y: 0.22, z, size: 0.75, color: '#d8f4ff', alpha: 0.6, flicker: 1 }));
        break;
      }
      case 'boards': {
        patch([0.03, 0.022, 0.016], 0.05);
        // loose floorboards: lying planks, a few lifted at one end
        const cols: [number, number, number][] = [[0.42, 0.29, 0.18], [0.5, 0.35, 0.21], [0.36, 0.25, 0.16]];
        scatter(Math.round(area * 1.5 * nScale), (x, z) => {
          const a = rand() * 3.14, L = 0.5 + rand() * 0.6, w = 0.11;
          const dx = Math.cos(a) * L / 2, dz = Math.sin(a) * L / 2, nx = -Math.sin(a) * w, nz = Math.cos(a) * w;
          const lift = rand() < 0.45 ? 0.14 + rand() * 0.2 : 0;
          const c = cols[Math.floor(rand() * 3)];
          const y0 = 0.07, y1 = 0.07 + lift;
          lit.tri([x - dx - nx, y0, z - dz - nz], [x - dx + nx, y0, z - dz + nz], [x + dx + nx, y1, z + dz + nz], c, up);
          lit.tri([x - dx - nx, y0, z - dz - nz], [x + dx + nx, y1, z + dz + nz], [x + dx - nx, y1, z + dz - nz], c, up);
          if (lift > 0) em.tri([x + dx - nx, y1 + 0.005, z + dz - nz], [x + dx + nx, y1 + 0.005, z + dz + nz], [x + dx, y1 + 0.03, z + dz], [0.8, 0.62, 0.4], up); // pale cut end
        });
        scatter(Math.max(3, Math.round(area / 2.2)), (x, z) => glows.push({ x, y: 0.18, z, size: 0.8, color: '#ffcf8a', alpha: 0.32, flicker: 0.4 }));
        break;
      }
      case 'rubble': {
        patch([0.08, 0.07, 0.08], 0.05);
        const sb = new Bld(rand);
        scatter(Math.round(area * 1.4 * nScale), (x, z) => {
          const s = 0.12 + rand() * 0.3;
          sb.lit.add(ICO0, ['#6a6470', '#7a7480', '#58525e'][Math.floor(rand() * 3)], [x, s * 0.4, z], [rand(), rand() * 6, rand()], [s * 1.3, s * 0.8, s], { gradient: 0.3, jitter: 0.12 });
        });
        const g = sb.lit.build();
        const p = g.getAttribute('position'), cc = g.getAttribute('color');
        for (let i = 0; i < p.count; i += 3) lit.tri([p.getX(i), p.getY(i), p.getZ(i)], [p.getX(i + 1), p.getY(i + 1), p.getZ(i + 1)], [p.getX(i + 2), p.getY(i + 2), p.getZ(i + 2)], [cc.getX(i), cc.getY(i), cc.getZ(i)]);
        g.dispose();
        scatter(Math.max(3, Math.round(area / 2.2)), (x, z) => glows.push({ x, y: 0.3, z, size: 1.0, color: '#ffd9a0', alpha: 0.26, flicker: 0.5 }));
        break;
      }
      case 'puddle': {
        // irregular shallow puddles: a translucent sheet over the polygon, bright rim rings
        const col: [number, number, number] = [0.2, 0.46, 0.72];
        for (let x = Math.floor(bb.x0); x < bb.x1; x += 1) {
          for (let z = Math.floor(bb.z0); z < bb.z1; z += 1) {
            if (!inside(x + 0.5, z + 0.5)) continue;
            const y = 0.062;
            pd.tri([x, y, z], [x, y, z + 1], [x + 1, y, z + 1], col, up);
            pd.tri([x, y, z], [x + 1, y, z + 1], [x + 1, y, z], col, up);
          }
        }
        scatter(Math.max(3, Math.round(area * 0.45)), (x, z) => {
          const r0 = 0.25 + rand() * 0.3, N = 12;
          for (let i = 0; i < N; i++) {
            const a0 = (i / N) * 6.283, a1 = ((i + 1) / N) * 6.283;
            em.tri([x + Math.cos(a0) * r0, 0.07, z + Math.sin(a0) * r0], [x + Math.cos(a0) * (r0 + 0.06), 0.07, z + Math.sin(a0) * (r0 + 0.06)], [x + Math.cos(a1) * (r0 + 0.06), 0.07, z + Math.sin(a1) * (r0 + 0.06)], [0.5, 0.8, 1], up);
            em.tri([x + Math.cos(a0) * r0, 0.07, z + Math.sin(a0) * r0], [x + Math.cos(a1) * (r0 + 0.06), 0.07, z + Math.sin(a1) * (r0 + 0.06)], [x + Math.cos(a1) * r0, 0.07, z + Math.sin(a1) * r0], [0.5, 0.8, 1], up);
          }
        });
        scatter(Math.max(3, Math.round(area / 2)), (x, z) => glows.push({ x, y: 0.2, z, size: 0.9, color: '#8fc8ff', alpha: 0.35, flicker: 0.6 }));
        break;
      }
    }
  }
  return { lit: lit.build(true), em: em.build(false), puddle: pd.build(false), glows };
}

void CONE6; void CYL8;
