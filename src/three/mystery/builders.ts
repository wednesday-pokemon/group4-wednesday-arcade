// Local-space model builder: authors a model in its own frame (front = -Z, ground y = 0), then places it in the world.
import * as THREE from 'three';
import { MeshBuilder } from '../util.ts';
import type { GlowEntry } from '../action/fx.ts';
import { mergeAll, place } from '../action/geom.ts';
import { BOX, CONE4, PAL, PRISM } from './common.ts';

export interface PlacedModel {
  lit: THREE.BufferGeometry | null;
  em: THREE.BufferGeometry | null;
  glass: THREE.BufferGeometry | null;
  glows: GlowEntry[];
}

const WIN = ['#f5b04c', '#f5b04c', '#ffd68a', '#f5b04c', '#b79cff'];

export class Bld {
  readonly lit: MeshBuilder;
  readonly em: MeshBuilder;
  readonly glass: MeshBuilder;
  readonly glows: GlowEntry[] = [];
  constructor(readonly rand: () => number) {
    this.lit = new MeshBuilder(rand);
    this.em = new MeshBuilder(rand);
    this.glass = new MeshBuilder(rand);
  }

  stone(): string {
    return PAL.stone[Math.floor(this.rand() * PAL.stone.length)];
  }

  box(x: number, y: number, z: number, w: number, h: number, d: number, color: string, rot: [number, number, number] = [0, 0, 0], g = 0.3): void {
    this.lit.add(BOX, color, [x, y, z], rot, [w, h, d], { gradient: g });
  }

  roofPrism(x: number, y: number, z: number, w: number, h: number, d: number, yaw = 0, color: string = PAL.roof): void {
    this.lit.add(PRISM, color, [x, y, z], [0, yaw, 0], [w, h, d], { gradient: 0.25 });
  }

  /** emissive lantern box + glow billboard */
  lantern(x: number, y: number, z: number, size = 2.2, color: string = PAL.lantern, alpha = 0.9): void {
    this.em.add(BOX, color, [x, y, z], [0, 0, 0], [0.22, 0.3, 0.22], { jitter: 0, gradient: 0 });
    this.glows.push({ x, y, z, size, color, alpha, flicker: 0.6, fogFloor: 0.12 });
  }

  /** pointed-arch window facing -Z in local space, rotated by yaw around its own position */
  win(x: number, y: number, z: number, w: number, h: number, yaw = 0, color?: string, glow = 0.0): void {
    const col = color ?? WIN[Math.floor(this.rand() * WIN.length)];
    this.em.add(BOX, col, [x, y, z], [0, yaw, 0], [w, h, 0.12], { jitter: 0, gradient: 0 });
    this.em.add(CONE4, col, [x, y + h / 2 + w * 0.36, z], [0, yaw + Math.PI / 4, 0], [w * 0.72, w * 0.75, w * 0.72], { jitter: 0, gradient: 0 });
    if (glow > 0 && this.rand() < glow) this.glows.push({ x, y, z, size: Math.max(1.6, h * 1.8), color: col, alpha: 0.4, flicker: 0.3, fogFloor: 0.2 });
  }

  finish(x: number, z: number, yaw: number, scale: number, y = 0): PlacedModel {
    const tf = (lx: number, ly: number, lz: number): [number, number, number] => {
      const s = Math.sin(yaw), c = Math.cos(yaw);
      return [x + (lx * c + lz * s) * scale, y + ly * scale, z + (-lx * s + lz * c) * scale];
    };
    const build = (b: MeshBuilder): THREE.BufferGeometry | null => {
      const g = b.build();
      if (!g.getAttribute('position')) return null;
      place(g, x, y, z, yaw, scale);
      return g;
    };
    const glows = this.glows.map((l) => {
      const [wx, wy, wz] = tf(l.x, l.y, l.z);
      return { ...l, x: wx, y: wy, z: wz, size: l.size * scale, sy: l.sy ? l.sy * scale : undefined };
    });
    return { lit: build(this.lit), em: build(this.em), glass: build(this.glass), glows };
  }
}

/** Collects placed models into merged geometry lists. */
export class Collector {
  readonly lits: (THREE.BufferGeometry | null)[] = [];
  readonly ems: (THREE.BufferGeometry | null)[] = [];
  readonly glasses: (THREE.BufferGeometry | null)[] = [];
  readonly glows: GlowEntry[] = [];
  add(m: PlacedModel): void {
    this.lits.push(m.lit);
    this.ems.push(m.em);
    this.glasses.push(m.glass);
    this.glows.push(...m.glows);
  }
  addGeo(kind: 'lit' | 'em' | 'glass', g: THREE.BufferGeometry | null): void {
    (kind === 'lit' ? this.lits : kind === 'em' ? this.ems : this.glasses).push(g);
  }
  mergedLit(): THREE.BufferGeometry | null { return mergeAll(this.lits); }
  mergedEm(): THREE.BufferGeometry | null { return mergeAll(this.ems); }
  mergedGlass(): THREE.BufferGeometry | null { return mergeAll(this.glasses); }
}
