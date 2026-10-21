// Instanced shoreline props: twisted dead trees and reed clumps (one draw call each).
import * as THREE from 'three';
import { MeshBuilder, mulberry32 } from '../util.ts';
import { lambertVC } from '../actors.ts';
import type { Spot } from './landBuilder.ts';

const TRUNK = ['#12152e', '#161a36', '#0f1228'];

function seg(b: MeshBuilder, a: THREE.Vector3, c: THREE.Vector3, r0: number, r1: number, color: string, sides: number): void {
  const dir = new THREE.Vector3().subVectors(c, a);
  const len = dir.length();
  const g = new THREE.CylinderGeometry(r1, r0, len, sides, 1, true);
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
  g.applyQuaternion(q);
  const mid = new THREE.Vector3().addVectors(a, c).multiplyScalar(0.5);
  b.add(g, color, [mid.x, mid.y, mid.z], [0, 0, 0], 1, { jitter: 0.1, gradient: 0.15 });
  g.dispose();
}

/** A gnarled dead tree about 6 u tall at scale 1: leaning twisted trunk, grasping branches, no leaves. */
export function createTreeGeometry(lite: boolean): THREE.BufferGeometry {
  const rand = mulberry32(lite ? 91 : 77);
  const b = new MeshBuilder(rand);
  const sides = lite ? 4 : 5;
  const col = () => TRUNK[Math.floor(rand() * TRUNK.length)];
  const pts: THREE.Vector3[] = [new THREE.Vector3(0, -0.3, 0)];
  const segs = lite ? 3 : 4;
  let lean = rand() * 6.28;
  for (let i = 1; i <= segs; i++) {
    const p = pts[i - 1];
    lean += 0.9 + rand() * 0.6;
    pts.push(new THREE.Vector3(p.x + Math.cos(lean) * 0.45, p.y + 1.5, p.z + Math.sin(lean) * 0.45));
  }
  for (let i = 0; i < segs; i++) {
    const t0 = 1 - i / segs, t1 = 1 - (i + 1) / segs;
    seg(b, pts[i], pts[i + 1], 0.12 + t0 * 0.3, 0.12 + t1 * 0.3, col(), sides);
  }
  const branches = lite ? 4 : 7;
  for (let k = 0; k < branches; k++) {
    const at = 1 + Math.floor(rand() * segs);
    const base = pts[Math.min(at, segs)].clone();
    const a = rand() * 6.28;
    const dir = new THREE.Vector3(Math.cos(a), 0.55 + rand() * 0.7, Math.sin(a)).normalize();
    const l1 = 1.0 + rand() * 1.1;
    const mid = base.clone().addScaledVector(dir, l1);
    seg(b, base, mid, 0.1, 0.06, col(), sides);
    const dir2 = dir.clone().add(new THREE.Vector3((rand() - 0.5) * 1.2, 0.4 + rand() * 0.5, (rand() - 0.5) * 1.2)).normalize();
    const tip = mid.clone().addScaledVector(dir2, 0.8 + rand() * 0.9);
    seg(b, mid, tip, 0.06, 0.02, col(), sides);
    if (!lite && rand() < 0.6) {
      const tip2 = mid.clone().addScaledVector(new THREE.Vector3(-dir2.z, dir2.y * 0.7, dir2.x).normalize(), 0.7);
      seg(b, mid, tip2, 0.045, 0.015, col(), sides);
    }
  }
  return b.build();
}

export function createReedGeometry(): THREE.BufferGeometry {
  const rand = mulberry32(31);
  const b = new MeshBuilder(rand);
  const blade = new THREE.ConeGeometry(0.07, 1, 3, 1);
  for (let i = 0; i < 6; i++) {
    const a = rand() * 6.28;
    const r = rand() * 0.45;
    const h = 1.5 + rand() * 1.4;
    b.add(blade, i % 2 ? '#2a3d40' : '#22343a', [Math.cos(a) * r, h / 2 - 0.1, Math.sin(a) * r], [(rand() - 0.5) * 0.4, rand() * 6, (rand() - 0.5) * 0.4], [1, h, 1], { jitter: 0.1, gradient: 0.3 });
  }
  b.add(new THREE.ConeGeometry(0.1, 0.5, 4, 1), '#4a3a2a', [0.1, 2.1, 0], [0, 0, 0.1], 1, { gradient: 0 }); // one cattail head
  return b.build();
}

export function instancedFromSpots(geo: THREE.BufferGeometry, spots: Spot[], tilt = 0.12): THREE.InstancedMesh | null {
  if (spots.length === 0) return null;
  const mesh = new THREE.InstancedMesh(geo, lambertVC(), spots.length);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const rand = mulberry32(spots.length * 7 + 3);
  spots.forEach((s, i) => {
    e.set((rand() - 0.5) * tilt, s.rot, (rand() - 0.5) * tilt);
    q.setFromEuler(e);
    m.compose(new THREE.Vector3(s.x, s.y, s.z), q, new THREE.Vector3(s.s, s.s * (0.9 + rand() * 0.25), s.s));
    mesh.setMatrixAt(i, m);
  });
  mesh.instanceMatrix.needsUpdate = true;
  mesh.frustumCulled = false;
  return mesh;
}
