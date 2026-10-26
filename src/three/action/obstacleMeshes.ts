// Low-poly geometry for course obstacles. Static pieces are merged into the world mesh; drifting obstacles get their
// own small meshes so they can move. Hazards read as dark silhouettes ringed by foam / ripples against the lit water.
import * as THREE from 'three';
import { MeshBuilder, mulberry32, hashString } from '../util.ts';
import type { Obstacle } from '../../action/types.ts';
import { TriBuilder, type V3 } from './geom.ts';

const ROCK = new THREE.IcosahedronGeometry(1, 0);
const CYL = new THREE.CylinderGeometry(1, 1, 1, 7).applyMatrix4(new THREE.Matrix4().makeRotationX(Math.PI / 2)); // along Z
const BOX = new THREE.BoxGeometry(1, 1, 1);
const CONE = new THREE.ConeGeometry(1, 1, 5);

const COLORS = {
  rock: ['#262c58', '#2b3162', '#20254d'],
  wood: '#4a3020',
  woodDark: '#33201a',
  plank: '#5d3f2a',
  branch: '#2a2420',
  buoyRed: '#a8323a',
  buoyCream: '#e8dcc0',
  lantern: '#f5b04c',
} as const;

/** Position of an obstacle at sim time t (drift along `axisAngle`, default sideways along X). */
export function obstacleWorldPos(o: Obstacle, t: number): { x: number; z: number } {
  if (!o.drift) return { x: o.x, z: o.z };
  const s = o.drift.amplitude * Math.sin((t / o.drift.periodS) * Math.PI * 2 + o.drift.phase);
  if (o.drift.axisAngle === undefined) return { x: o.x + s, z: o.z };
  return { x: o.x - Math.sin(o.drift.axisAngle) * s, z: o.z - Math.cos(o.drift.axisAngle) * s };
}

/** Adds one obstacle to `lit` (and lanterns to `emissive`); obstacle-local space when `local` is true. */
export function addObstacle(lit: MeshBuilder, emissive: MeshBuilder, o: Obstacle, local = false): void {
  const rand = mulberry32(hashString(o.id));
  const ox = local ? 0 : o.x;
  const oz = local ? 0 : o.z;
  const yaw = o.angle;
  switch (o.kind) {
    case 'rock': {
      const r = o.radius;
      lit.add(ROCK, COLORS.rock[Math.floor(rand() * 3)], [ox, r * 0.2, oz], [rand(), rand() * 6, rand()], [r * 1.05, r * 0.95, r * 1.05], { jitter: 0.14, gradient: 0.55 });
      lit.add(ROCK, COLORS.rock[Math.floor(rand() * 3)], [ox + (rand() - 0.5) * r, r * 0.5, oz + (rand() - 0.5) * r], [rand(), rand() * 6, 0], r * 0.55, { jitter: 0.12 });
      lit.add(ROCK, COLORS.rock[Math.floor(rand() * 3)], [ox + (rand() - 0.5) * r * 1.5, r * 0.1, oz + (rand() - 0.5) * r * 1.5], [rand(), rand() * 6, 0], r * 0.4, { jitter: 0.12 });
      break;
    }
    case 'log': {
      const len = o.halfLength * 2 + o.radius * 2;
      lit.add(CYL, COLORS.wood, [ox, 0.12, oz], [0, yaw, 0], [o.radius, o.radius, len], { jitter: 0.12, gradient: 0.4 });
      lit.add(CYL, COLORS.woodDark, [ox, 0.42, oz], [0.4, yaw + 0.9, 0], [0.1, 0.1, 1.3]);
      lit.add(CONE, COLORS.woodDark, [ox - Math.sin(yaw) * o.halfLength * 0.4, 0.5, oz - Math.cos(yaw) * o.halfLength * 0.4], [0.3, rand() * 6, 0.2], [0.14, 1.1, 0.14]);
      break;
    }
    case 'dock': {
      const len = o.halfLength * 2;
      lit.add(BOX, COLORS.plank, [ox, 0.32, oz], [0, yaw, 0.08], [1.5, 0.16, len], { jitter: 0.15, gradient: 0.2 });
      const ax = -Math.sin(yaw);
      const az = -Math.cos(yaw);
      for (const s of [-1, 1]) {
        lit.add(BOX, COLORS.woodDark, [ox + ax * s * o.halfLength, 0.6, oz + az * s * o.halfLength], [0.1, 0, 0.12 * s], [0.28, 1.6, 0.28]);
      }
      break;
    }
    case 'branch': {
      const len = o.halfLength * 2;
      lit.add(CYL, COLORS.branch, [ox, 0.08, oz], [0, yaw, 0], [o.radius, o.radius, len], { jitter: 0.1 });
      for (let i = 0; i < 4; i++) {
        const t = (rand() - 0.5) * len * 0.8;
        lit.add(CONE, COLORS.branch, [ox - Math.sin(yaw) * t, 0.7, oz - Math.cos(yaw) * t], [rand() * 0.8 - 0.4, rand() * 6, rand() * 0.8 - 0.4], [0.12, 1.7, 0.12]);
      }
      break;
    }
    case 'buoy': {
      lit.add(CYL, COLORS.buoyRed, [ox, 0.25, oz], [Math.PI / 2, 0, 0], [0.55, 0.55, 0.7]);
      lit.add(CYL, COLORS.buoyCream, [ox, 0.62, oz], [Math.PI / 2, 0, 0], [0.4, 0.4, 0.15], { gradient: 0 });
      lit.add(CYL, COLORS.woodDark, [ox, 1.2, oz], [Math.PI / 2, 0, 0], [0.05, 0.05, 1.1]);
      emissive.add(BOX, COLORS.lantern, [ox, 1.85, oz], [0, 0, 0], [0.24, 0.3, 0.24], { jitter: 0, gradient: 0 });
      break;
    }
    case 'debris': {
      const n = 4 + Math.floor(o.radius * 2);
      for (let i = 0; i < n; i++) {
        const a = rand() * Math.PI * 2;
        const d = rand() * o.radius * 0.9;
        const kind = rand();
        const px = ox + Math.cos(a) * d;
        const pz = oz + Math.sin(a) * d;
        if (kind < 0.55) lit.add(BOX, rand() < 0.5 ? COLORS.plank : COLORS.woodDark, [px, 0.08 + rand() * 0.1, pz], [rand() * 0.2, rand() * 6, rand() * 0.2], [0.35 + rand() * 0.4, 0.12, 1.4 + rand() * 1.6], { jitter: 0.15 });
        else if (kind < 0.8) lit.add(BOX, COLORS.wood, [px, 0.25, pz], [rand(), rand() * 6, rand()], 0.5 + rand() * 0.4, { jitter: 0.12 });
        else lit.add(CYL, COLORS.woodDark, [px, 0.1, pz], [0, rand() * 6, 0], [0.3, 0.3, 1.2 + rand()], { jitter: 0.1 });
      }
      break;
    }
  }
}

/** Foam / ripple strips around an obstacle (local when `local`), appended to a TriBuilder used with the foam material. */
export function addObstacleFoam(tb: TriBuilder, o: Obstacle, local = false): void {
  const cx = local ? 0 : o.x;
  const cz = local ? 0 : o.z;
  const isRock = o.kind === 'rock';
  const isBuoy = o.kind === 'buoy';
  const r0 = o.radius * (isRock ? 0.85 : 1.0);
  const r1 = o.radius + (isRock ? Math.max(1.6, o.radius * 0.85) : isBuoy ? 0.9 : 1.3);
  const hl = o.halfLength;
  const a: [number, number] = [-Math.sin(o.angle), -Math.cos(o.angle)];
  const u: [number, number] = [-a[1], a[0]];
  const N = hl > 0 ? 28 : 18;
  const up: V3 = [0, 1, 0];
  const strong: V3 = isRock ? [0.5, 0.58, 0.85] : [0.28, 0.36, 0.62];
  const pt = (theta: number, r: number): V3 => {
    const cs = Math.cos(theta), sn = Math.sin(theta);
    const lx = r * cs + (hl > 0 ? Math.sign(cs || 1) * hl : 0);
    const lw = r * sn;
    return [cx + a[0] * lx + u[0] * lw, 0.07, cz + a[1] * lx + u[1] * lw];
  };
  for (let i = 0; i < N; i++) {
    const t0 = (i / N) * Math.PI * 2, t1 = ((i + 1) / N) * Math.PI * 2;
    const p00 = pt(t0, r0), p01 = pt(t1, r0), p10 = pt(t0, r1), p11 = pt(t1, r1);
    tb.triC(p00, p01, p11, strong, strong, [0, 0, 0], up);
    tb.triC(p00, p11, p10, strong, [0, 0, 0], [0, 0, 0], up);
  }
}
