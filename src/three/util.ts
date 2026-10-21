// Small shared helpers for the 3D race scene: deterministic RNG, easing and a vertex-colour geometry merger.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export const clamp = (v: number, a: number, b: number): number => (v < a ? a : v > b ? b : v);
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
export const smoothstep = (a: number, b: number, x: number): number => {
  if (a === b) return x < a ? 0 : 1;
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
/** 0 -> 1 -> 0 pulse: rises over [a,b], holds to c, falls over [c,d]. */
export const pulse = (a: number, b: number, c: number, d: number, x: number): number =>
  smoothstep(a, b, x) * (1 - smoothstep(c, d, x));
export const damp = (current: number, target: number, lambda: number, dt: number): number =>
  lerp(current, target, 1 - Math.exp(-lambda * dt));

const tmpColor = new THREE.Color();

/**
 * Accumulates transformed primitives with per-vertex colours into ONE BufferGeometry (one draw call).
 * Non-indexed output => flat shading looks faceted/low-poly.
 */
export class MeshBuilder {
  private parts: THREE.BufferGeometry[] = [];
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly e = new THREE.Euler();
  constructor(private readonly rand: () => number = mulberry32(7)) {}

  add(
    geo: THREE.BufferGeometry,
    color: THREE.ColorRepresentation,
    pos: [number, number, number] = [0, 0, 0],
    rot: [number, number, number] = [0, 0, 0],
    scale: [number, number, number] | number = 1,
    opts: { jitter?: number; gradient?: number } = {},
  ): this {
    const s = typeof scale === 'number' ? ([scale, scale, scale] as const) : scale;
    this.e.set(rot[0], rot[1], rot[2]);
    this.q.setFromEuler(this.e);
    this.m.compose(new THREE.Vector3(pos[0], pos[1], pos[2]), this.q, new THREE.Vector3(s[0], s[1], s[2]));
    let g = geo.index ? geo.toNonIndexed() : geo.clone();
    g.deleteAttribute('uv');
    g.applyMatrix4(this.m);
    g.computeBoundingBox();
    const bb = g.boundingBox!;
    const p = g.getAttribute('position');
    const col = new Float32Array(p.count * 3);
    tmpColor.set(color);
    const jit = opts.jitter ?? 0.08;
    const grad = opts.gradient ?? 0.35; // darker toward the bottom of the primitive
    const h = Math.max(1e-4, bb.max.y - bb.min.y);
    // one colour jitter per triangle gives a faceted look
    for (let i = 0; i < p.count; i += 3) {
      const j = 1 + (this.rand() - 0.5) * 2 * jit;
      for (let k = 0; k < 3; k++) {
        const y = p.getY(i + k);
        const gy = 1 - grad + grad * ((y - bb.min.y) / h);
        col[(i + k) * 3] = tmpColor.r * j * gy;
        col[(i + k) * 3 + 1] = tmpColor.g * j * gy;
        col[(i + k) * 3 + 2] = tmpColor.b * j * gy;
      }
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.deleteAttribute('normal');
    g.computeVertexNormals();
    this.parts.push(g);
    return this;
  }

  build(): THREE.BufferGeometry {
    if (this.parts.length === 0) return new THREE.BufferGeometry();
    const merged = mergeGeometries(this.parts, false);
    for (const p of this.parts) p.dispose();
    this.parts = [];
    return merged ?? new THREE.BufferGeometry();
  }
}

/** Soft radial sprite used for glows, fog puffs and particles. */
export function makeGlowTexture(size = 64): THREE.Texture | null {
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  if (!ctx) return null;
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.25, 'rgba(255,255,255,0.55)');
  g.addColorStop(0.6, 'rgba(255,255,255,0.12)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function disposeObject(o: THREE.Object3D): void {
  o.traverse((n) => {
    const mesh = n as THREE.Mesh;
    if (mesh.geometry) mesh.geometry.dispose();
    const mat = (mesh as { material?: THREE.Material | THREE.Material[] }).material;
    if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
    else if (mat) mat.dispose();
  });
}
