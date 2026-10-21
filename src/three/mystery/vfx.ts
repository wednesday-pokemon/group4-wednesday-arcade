// Reusable batched effect primitives (each is a single draw call): expanding ground rings, dynamic glow billboards, camera-facing
// lightning ribbons, vertical light beams, speed streaks, premonition ghosts, orbiting coins, and the hazard-outline overlay.
import * as THREE from 'three';
import type { MapDef } from '../../mystery/types.ts';
import { BillboardField, createGlowFieldMaterial, type FxUniforms } from '../action/fx.ts';
import { TriBuilder } from '../action/geom.ts';
import { clamp } from '../util.ts';
import { BOX, CONE5, CYL12, ICO0, ICO1 } from './common.ts';

const _c = new THREE.Color();
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _v = new THREE.Vector3();
const _s = new THREE.Vector3();
const _e = new THREE.Euler();

// ------------------------------------------------------------------------------------------------------ ring field
export class RingField {
  readonly mesh: THREE.InstancedMesh;
  private n = 0;
  private readonly geo = new THREE.RingGeometry(0.93, 1, 56, 1).rotateX(-Math.PI / 2);
  private readonly mat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false });

  constructor(readonly capacity: number) {
    this.mesh = new THREE.InstancedMesh(this.geo, this.mat, capacity);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 4;
    this.mesh.count = 0;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.setColorAt(0, _c.set(0, 0, 0));
    this.mesh.instanceColor!.setUsage(THREE.DynamicDrawUsage);
  }
  begin(): void { this.n = 0; }
  /** `intensity` scales the colour (additive blend = brightness) */
  push(x: number, y: number, z: number, r: number, color: THREE.ColorRepresentation, intensity: number, squash = 1): void {
    if (this.n >= this.capacity || intensity <= 0.003 || r <= 0.01) return;
    _m.makeScale(r, 1, r * squash).setPosition(x, y, z);
    this.mesh.setMatrixAt(this.n, _m);
    _c.set(color).multiplyScalar(intensity);
    this.mesh.setColorAt(this.n, _c);
    this.n++;
  }
  end(): void {
    this.mesh.count = this.n;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    this.mesh.visible = this.n > 0;
  }
  dispose(): void { this.geo.dispose(); this.mat.dispose(); this.mesh.dispose(); }
}

// ------------------------------------------------------------------------------------------------------ glow billboards
export class GlowSet {
  readonly field: BillboardField;
  private n = 0;
  private readonly mat: THREE.ShaderMaterial;
  constructor(u: FxUniforms, readonly capacity: number) {
    this.mat = createGlowFieldMaterial(u, false);
    this.field = new BillboardField(capacity, this.mat, null, 6);
    for (let i = 0; i < capacity; i++) this.field.add({ x: 0, y: -50, z: 0, size: 1, color: '#ffffff', alpha: 0 });
    this.field.mesh.count = 0;
    this.field.flush();
  }
  begin(): void { this.n = 0; }
  add(x: number, y: number, z: number, size: number, color: THREE.Color, alpha: number): void {
    if (this.n >= this.capacity || alpha <= 0.004) return;
    this.field.update(this.n++, x, y, z, size, alpha, color);
  }
  end(): void {
    this.field.mesh.count = this.n;
    this.field.flush();
    this.field.mesh.visible = this.n > 0;
  }
  dispose(): void { this.field.dispose(); this.mat.dispose(); }
}

// ------------------------------------------------------------------------------------------------------ lightning
export class BoltField {
  readonly mesh: THREE.Mesh;
  private readonly geo = new THREE.BufferGeometry();
  private readonly pos: Float32Array;
  private readonly col: Float32Array;
  private v = 0;
  private readonly mat = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false });
  constructor(readonly maxQuads = 220) {
    this.pos = new Float32Array(maxQuads * 4 * 3);
    this.col = new Float32Array(maxQuads * 4 * 3);
    const idx: number[] = [];
    for (let i = 0; i < maxQuads; i++) idx.push(i * 4, i * 4 + 1, i * 4 + 2, i * 4, i * 4 + 2, i * 4 + 3);
    this.geo.setIndex(idx);
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('color', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);
    this.mesh = new THREE.Mesh(this.geo, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 5;
    this.mesh.visible = false;
  }
  begin(): void { this.v = 0; }
  /** zig-zag bolt from a to b; `cam` is the camera position (for ribbon facing) */
  bolt(a: THREE.Vector3, b: THREE.Vector3, segs: number, jitter: number, width: number, color: THREE.Color, cam: THREE.Vector3, rnd: () => number): void {
    const dir = _v.subVectors(b, a);
    const len = dir.length() || 1;
    dir.divideScalar(len);
    const view = new THREE.Vector3().subVectors(cam, a).normalize();
    const side = new THREE.Vector3().crossVectors(dir, view).normalize();
    const up2 = new THREE.Vector3().crossVectors(dir, side).normalize();
    let prev = a.clone();
    let prevW = 0;
    for (let i = 1; i <= segs; i++) {
      if (this.v + 4 > this.maxQuads * 4) return;
      const t = i / segs;
      const p = new THREE.Vector3().lerpVectors(a, b, t);
      if (i < segs) p.addScaledVector(side, (rnd() - 0.5) * jitter).addScaledVector(up2, (rnd() - 0.5) * jitter);
      const w = width * (1 - Math.abs(t - 0.5) * 0.6);
      this.quad(prev, p, side, prevW || w * 0.4, w, color);
      prev = p;
      prevW = w;
    }
  }
  private quad(a: THREE.Vector3, b: THREE.Vector3, side: THREE.Vector3, wa: number, wb: number, c: THREE.Color): void {
    const o = this.v * 3;
    const P = this.pos, C = this.col;
    const pts: [number, number, number][] = [
      [a.x - side.x * wa, a.y - side.y * wa, a.z - side.z * wa],
      [a.x + side.x * wa, a.y + side.y * wa, a.z + side.z * wa],
      [b.x + side.x * wb, b.y + side.y * wb, b.z + side.z * wb],
      [b.x - side.x * wb, b.y - side.y * wb, b.z - side.z * wb],
    ];
    for (let k = 0; k < 4; k++) {
      P[o + k * 3] = pts[k][0]; P[o + k * 3 + 1] = pts[k][1]; P[o + k * 3 + 2] = pts[k][2];
      C[o + k * 3] = c.r; C[o + k * 3 + 1] = c.g; C[o + k * 3 + 2] = c.b;
    }
    this.v += 4;
  }
  end(): void {
    // zero the unused tail so stale quads vanish
    const used = this.v * 3;
    this.pos.fill(0, used);
    this.col.fill(0, used);
    this.geo.getAttribute('position').needsUpdate = true;
    this.geo.getAttribute('color').needsUpdate = true;
    this.mesh.visible = this.v > 0;
  }
  dispose(): void { this.geo.dispose(); this.mat.dispose(); }
}

// ------------------------------------------------------------------------------------------------------ light beams
export class BeamField {
  readonly mesh: THREE.InstancedMesh;
  private n = 0;
  private readonly geo: THREE.BufferGeometry;
  private readonly mat = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false });
  constructor(readonly capacity: number) {
    // open cylinder, y 0..1; vertex colour 1 at the base fading to 0 at the top
    const g = new THREE.CylinderGeometry(1, 1, 1, 10, 1, true).toNonIndexed();
    g.translate(0, 0.5, 0);
    const p = g.getAttribute('position');
    const cols = new Float32Array(p.count * 3);
    for (let i = 0; i < p.count; i++) {
      const k = Math.pow(1 - p.getY(i), 1.4);
      cols[i * 3] = cols[i * 3 + 1] = cols[i * 3 + 2] = k;
    }
    g.setAttribute('color', new THREE.BufferAttribute(cols, 3));
    this.geo = g;
    this.mesh = new THREE.InstancedMesh(g, this.mat, capacity);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 3;
    this.mesh.count = 0;
    this.mesh.setColorAt(0, _c.set(0, 0, 0));
    this.mesh.instanceColor!.setUsage(THREE.DynamicDrawUsage);
  }
  begin(): void { this.n = 0; }
  push(x: number, z: number, radius: number, height: number, color: THREE.ColorRepresentation, intensity: number, y = 0): void {
    if (this.n >= this.capacity || intensity <= 0.004) return;
    _m.makeScale(radius, height, radius).setPosition(x, y, z);
    this.mesh.setMatrixAt(this.n, _m);
    _c.set(color).multiplyScalar(intensity);
    this.mesh.setColorAt(this.n, _c);
    this.n++;
  }
  end(): void {
    this.mesh.count = this.n;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    this.mesh.visible = this.n > 0;
  }
  dispose(): void { this.geo.dispose(); this.mat.dispose(); this.mesh.dispose(); }
}

// ------------------------------------------------------------------------------------------------------ instanced shapes
/** Generic additive instanced shape with per-instance transform + colour (speed streaks, ghosts, coins). */
export class ShapeField {
  readonly mesh: THREE.InstancedMesh;
  private n = 0;
  private readonly mat: THREE.MeshBasicMaterial;
  constructor(private readonly geo: THREE.BufferGeometry, readonly capacity: number, additive = true, order = 4) {
    this.mat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending, side: THREE.DoubleSide, fog: false });
    this.mesh = new THREE.InstancedMesh(geo, this.mat, capacity);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = order;
    this.mesh.count = 0;
    this.mesh.setColorAt(0, _c.set(0, 0, 0));
    this.mesh.instanceColor!.setUsage(THREE.DynamicDrawUsage);
  }
  begin(): void { this.n = 0; }
  push(x: number, y: number, z: number, rx: number, ry: number, rz: number, sx: number, sy: number, sz: number, color: THREE.ColorRepresentation, intensity: number): void {
    if (this.n >= this.capacity || intensity <= 0.004) return;
    _e.set(rx, ry, rz);
    _q.setFromEuler(_e);
    _m.compose(_v.set(x, y, z), _q, _s.set(sx, sy, sz));
    this.mesh.setMatrixAt(this.n, _m);
    _c.set(color).multiplyScalar(intensity);
    this.mesh.setColorAt(this.n, _c);
    this.n++;
  }
  end(): void {
    this.mesh.count = this.n;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    this.mesh.visible = this.n > 0;
  }
  dispose(): void { this.geo.dispose(); this.mat.dispose(); this.mesh.dispose(); }
}

export const streakGeo = (): THREE.BufferGeometry => {
  const g = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2); // flat, long axis along Z after scale
  return g;
};

export const coinGeo = (): THREE.BufferGeometry => CYL12.clone().scale(0.11, 0.02, 0.11);

/** a stylised ghost of the Hyde (hunched torso, horned head, long arms) used for premonition trails */
export function ghostGeo(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const add = (g: THREE.BufferGeometry, x: number, y: number, z: number, rx = 0, rz = 0): void => {
    const gg = g.index ? g.toNonIndexed() : g;
    gg.deleteAttribute('uv');
    gg.rotateX(rx); gg.rotateZ(rz); gg.translate(x, y, z);
    parts.push(gg);
  };
  add(ICO1.clone().scale(0.7, 0.9, 0.6), 0, 1.6, 0.1, 0.4);
  add(ICO0.clone().scale(0.35, 0.3, 0.4), 0, 2.45, -0.45);
  add(CONE5.clone().scale(0.09, 0.7, 0.09), -0.28, 2.85, -0.25, -0.7, 0.5);
  add(CONE5.clone().scale(0.09, 0.7, 0.09), 0.28, 2.85, -0.25, -0.7, -0.5);
  add(BOX.clone().scale(0.2, 1.6, 0.2), -0.95, 1.2, -0.2);
  add(BOX.clone().scale(0.2, 1.6, 0.2), 0.95, 1.2, -0.2);
  add(CONE5.clone().scale(0.8, 1.7, 0.7), 0, 0.85, 0.1, Math.PI);
  for (const p of parts) if (!p.getAttribute('normal')) p.computeVertexNormals();
  const norm = parts.map((p) => { for (const n of Object.keys(p.attributes)) if (n !== 'position') p.deleteAttribute(n); return p; });
  const merged = mergeGeometriesLite(norm);
  return merged;
}

function mergeGeometriesLite(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  let total = 0;
  for (const p of parts) total += p.getAttribute('position').count;
  const pos = new Float32Array(total * 3);
  let o = 0;
  for (const p of parts) {
    const a = p.getAttribute('position');
    for (let i = 0; i < a.count; i++) { pos[o++] = a.getX(i); pos[o++] = a.getY(i); pos[o++] = a.getZ(i); }
    p.dispose();
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  return g;
}

// ------------------------------------------------------------------------------------------------------ hazard outlines
export class HazardOutline {
  readonly mesh: THREE.Mesh;
  private readonly geo: THREE.BufferGeometry | null;
  private readonly mat: THREE.ShaderMaterial;
  constructor(map: MapDef, skipWallId: string | undefined) {
    const tb = new TriBuilder();
    const wallC: [number, number, number] = [0.25, 0.55, 1.0];
    const coverC: [number, number, number] = [0.7, 0.55, 1.0];
    const hideC: [number, number, number] = [0.35, 1.0, 0.7];
    const y = 0.14;
    for (const w of map.walls) {
      if (w.id === skipWallId) continue;
      const dx = w.b.x - w.a.x, dz = w.b.z - w.a.z;
      const l = Math.hypot(dx, dz) || 1;
      const nx = -dz / l, nz = dx / l;
      const ux = dx / l, uz = dz / l;
      for (const s of [-1, 1]) {
        const o0 = w.thickness / 2 + 0.05, o1 = o0 + 0.45;
        const ax = w.a.x - ux * 0.2, az = w.a.z - uz * 0.2, bx = w.b.x + ux * 0.2, bz = w.b.z + uz * 0.2;
        tb.tri([ax + nx * s * o0, y, az + nz * s * o0], [ax + nx * s * o1, y, az + nz * s * o1], [bx + nx * s * o1, y, bz + nz * s * o1], wallC, [0, 1, 0]);
        tb.tri([ax + nx * s * o0, y, az + nz * s * o0], [bx + nx * s * o1, y, bz + nz * s * o1], [bx + nx * s * o0, y, bz + nz * s * o0], wallC, [0, 1, 0]);
      }
    }
    const ring = (x: number, z: number, r0: number, r1: number, c: [number, number, number]): void => {
      const N = 22;
      for (let i = 0; i < N; i++) {
        const a0 = (i / N) * Math.PI * 2, a1 = ((i + 1) / N) * Math.PI * 2;
        const p = (r: number, a: number): [number, number, number] => [x + Math.cos(a) * r, y, z + Math.sin(a) * r];
        tb.tri(p(r0, a0), p(r1, a0), p(r1, a1), c, [0, 1, 0]);
        tb.tri(p(r0, a0), p(r1, a1), p(r0, a1), c, [0, 1, 0]);
      }
    };
    for (const c of map.cover) ring(c.x, c.z, c.radius + 0.12, c.radius + 0.5, coverC);
    for (const h of map.hidingSpots) ring(h.x, h.z, h.radius + 0.1, h.radius + 0.55, hideC);
    this.geo = tb.build(false);
    this.mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, vertexColors: true, side: THREE.DoubleSide,
      uniforms: { uCenter: { value: new THREE.Vector2() }, uRadius: { value: 16 }, uOn: { value: 0 }, uTime: { value: 0 } },
      vertexShader: /* glsl */ `varying vec3 vCol; varying vec3 vW; void main(){ vCol = color; vec4 w = modelMatrix * vec4(position,1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
      fragmentShader: /* glsl */ `uniform vec2 uCenter; uniform float uRadius; uniform float uOn; uniform float uTime; varying vec3 vCol; varying vec3 vW;
        void main(){ float d = distance(vW.xz, uCenter); float a = (1.0 - smoothstep(uRadius * 0.55, uRadius, d)) * uOn;
          float flick = 0.75 + 0.25 * sin(uTime * 5.0 + vW.x * 0.9 + vW.z * 0.7); gl_FragColor = vec4(vCol * a * flick * 0.9, 1.0); }`,
    });
    this.mesh = new THREE.Mesh(this.geo ?? new THREE.BufferGeometry(), this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 3;
    this.mesh.visible = false;
  }
  set(on: number, x: number, z: number, radius: number, time: number): void {
    this.mat.uniforms.uOn.value = on;
    this.mat.uniforms.uCenter.value.set(x, z);
    this.mat.uniforms.uRadius.value = radius;
    this.mat.uniforms.uTime.value = time;
    this.mesh.visible = on > 0.01;
  }
  dispose(): void { this.geo?.dispose(); this.mat.dispose(); }
}

export function ease(t: number): number { return 1 - Math.pow(1 - clamp(t, 0, 1), 3); }
