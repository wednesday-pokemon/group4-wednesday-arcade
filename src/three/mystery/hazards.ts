// Searchlights: a mast with a rotating lamp head and a visible beam (a cone from the lamp down to a ground sector). The beam turns with
// EXACTLY the sim's `searchlightYaw(h, t)` (src/mystery/hazards.ts): yaw(t) = phase + 2*PI*t / periodS (yaw 0 faces -Z, forward =
// (-sin yaw, -cos yaw)), t = the run's sim time. Its reach is clipped by walls and high cover each frame, the way the sim's line of
// sight is, so what you see lit is what can raise the alarm. Cheap: one transparent mesh (84 vertices) + one small lit head per light.
import * as THREE from 'three';
import type { HazardDef, MapDef } from '../../mystery/types.ts';
import { Bld } from './builders.ts';
import { searchlightYaw } from '../../mystery/hazards.ts';
import { BOX, CONE4, CYL6, CYL8, PAL, distPointSeg, seeded } from './common.ts';

export type SearchlightDef = Extract<HazardDef, { kind: 'searchlight' }>;


const SEGS = 14;
const LAMP_H = 4.5;
const NG = { gradient: 0, jitter: 0 } as const;

/** Static lattice mast + platform for a searchlight (merged into the dressing). */
export function searchlightMast(b: Bld): void {
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    b.lit.add(CYL6, PAL.iron, [sx * 0.28, LAMP_H / 2 - 0.2, sz * 0.28], [sz * 0.03, 0, -sx * 0.03], [0.045, LAMP_H - 0.4, 0.045], NG);
  }
  for (let i = 0; i < 4; i++) {
    const y = 0.7 + i * 1.0;
    b.lit.add(BOX, PAL.iron, [0, y, 0.28], [0, 0, 0.5], [0.8, 0.035, 0.035], NG);
    b.lit.add(BOX, PAL.iron, [0, y, -0.28], [0, 0, -0.5], [0.8, 0.035, 0.035], NG);
  }
  b.lit.add(BOX, '#2a2d44', [0, LAMP_H - 0.3, 0], [0, 0, 0], [0.9, 0.1, 0.9], { gradient: 0.1 });
  b.lit.add(CYL8, '#2a2d44', [0, LAMP_H - 0.18, 0], [0, 0, 0], [0.16, 0.16, 0.16], NG);
  b.lit.add(BOX, PAL.stoneDark, [0, 0.12, 0], [0, 0, 0], [1.2, 0.24, 1.2], { gradient: 0.2 });
}

function headGeometry(): THREE.BufferGeometry {
  const b = new Bld(seeded('searchlight-head'));
  b.lit.add(BOX, '#3a4058', [0, 0, -0.12], [0, 0, 0], [0.5, 0.42, 0.7], { gradient: 0.2 });
  b.lit.add(CONE4, '#2a2d44', [0, 0, -0.52], [-Math.PI / 2, Math.PI / 4, 0], [0.34, 0.3, 0.34], NG);
  b.em.add(BOX, '#e8f4ff', [0, 0, -0.62], [0, 0, 0], [0.34, 0.3, 0.03], NG);
  const l = b.lit.build(), e = b.em.build();
  const parts = [l, e];
  const pos: number[] = [], col: number[] = [], nor: number[] = [];
  for (const g of parts) {
    const p = g.getAttribute('position'), c = g.getAttribute('color'), n = g.getAttribute('normal');
    for (let i = 0; i < p.count; i++) { pos.push(p.getX(i), p.getY(i), p.getZ(i)); col.push(c.getX(i), c.getY(i), c.getZ(i)); nor.push(n.getX(i), n.getY(i), n.getZ(i)); }
    g.dispose();
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  return g;
}

interface Seg { ax: number; az: number; bx: number; bz: number; r: number; id: string }
interface Disc { x: number; z: number; r: number }

class Searchlight {
  readonly group = new THREE.Group();
  readonly beam: THREE.Mesh;
  readonly head: THREE.Mesh;
  private readonly pos: Float32Array;
  private readonly colAttr: THREE.BufferAttribute;
  private readonly geo = new THREE.BufferGeometry();
  private readonly baseCol: Float32Array;
  private readonly segs: Seg[] = [];
  private readonly discs: Disc[] = [];
  private flash = 0;
  /** world position of the lamp (for the glow billboard) */
  readonly lamp = new THREE.Vector3();
  yaw = 0;

  constructor(readonly def: SearchlightDef, map: MapDef, headGeo: THREE.BufferGeometry, headMat: THREE.Material, beamMat: THREE.Material) {
    const n = SEGS;
    this.pos = new Float32Array(n * 6 * 3);
    this.baseCol = new Float32Array(n * 6 * 3);
    // vertex colours: apex bright, arc dim, soft toward the sector's side edges
    const e = (i: number): number => 1 - Math.pow(Math.abs((2 * i) / n - 1), 2);
    const set = (v: number, k: number): void => { this.baseCol[v * 3] = k; this.baseCol[v * 3 + 1] = k; this.baseCol[v * 3 + 2] = k; };
    for (let i = 0; i < n; i++) {
      const ea = e(i), eb = e(i + 1);
      // cone triangle (apex, p_i, p_i+1)
      set(i * 6 + 0, 0.26);
      set(i * 6 + 1, 0.0 + 0.07 * ea);
      set(i * 6 + 2, 0.0 + 0.07 * eb);
      // ground triangle (centre, p_i, p_i+1)
      set(i * 6 + 3, 0.16);
      set(i * 6 + 4, 0.02 + 0.13 * ea);
      set(i * 6 + 5, 0.02 + 0.13 * eb);
    }
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.colAttr = new THREE.BufferAttribute(new Float32Array(this.baseCol), 3).setUsage(THREE.DynamicDrawUsage);
    this.geo.setAttribute('color', this.colAttr);
    this.geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(def.x, 0, def.z), def.rangeM + 8);
    this.beam = new THREE.Mesh(this.geo, beamMat);
    this.beam.frustumCulled = false;
    this.beam.renderOrder = 3;
    this.head = new THREE.Mesh(headGeo, headMat);
    this.group.position.set(def.x, LAMP_H, def.z);
    this.group.add(this.head);
    this.lamp.set(def.x, LAMP_H, def.z);
    // walls / high cover that can reach the beam (prefiltered once; open state is checked per frame)
    for (const w of map.walls) {
      if (distPointSeg(def.x, def.z, w.a.x, w.a.z, w.b.x, w.b.z) < def.rangeM + w.thickness) this.segs.push({ ax: w.a.x, az: w.a.z, bx: w.b.x, bz: w.b.z, r: w.thickness / 2, id: w.id });
    }
    for (const c of map.cover) if (c.height === 'high' && Math.hypot(c.x - def.x, c.z - def.z) < def.rangeM + c.radius) this.discs.push({ x: c.x, z: c.z, r: c.radius });
  }

  trigger(): void { this.flash = 1; }

  /** Static clip table: how far the beam reaches in each of NA directions (walls / high cover, with closed walls only). Rebuilt when a wall opens. */
  private clip: Float32Array | null = null;
  private clipSig = '';
  private readonly arcX = new Float32Array(SEGS + 1);
  private readonly arcZ = new Float32Array(SEGS + 1);

  private buildClip(isOpen: (id: string) => boolean): void {
    const d = this.def;
    const NA = 144;
    const t = this.clip ?? (this.clip = new Float32Array(NA));
    for (let k = 0; k < NA; k++) {
      const a = (k / NA) * Math.PI * 2;
      const fx = -Math.sin(a), fz = -Math.cos(a);
      let r = d.rangeM;
      for (let s = 0.7; s <= d.rangeM; s += 0.7) {
        const px = d.x + fx * s, pz = d.z + fz * s;
        let hit = false;
        for (const w of this.segs) if (!isOpen(w.id) && distPointSeg(px, pz, w.ax, w.az, w.bx, w.bz) < w.r) { hit = true; break; }
        if (!hit) for (const c of this.discs) if (Math.hypot(px - c.x, pz - c.z) < c.r) { hit = true; break; }
        if (hit) { r = Math.max(0.5, s - 0.5); break; }
      }
      t[k] = r;
    }
  }

  update(yaw: number, dt: number, isOpen: (id: string) => boolean, tint: THREE.Color, calm: boolean): void {
    const d = this.def;
    this.yaw = yaw;
    this.group.rotation.y = yaw;
    let sig = '';
    for (const w of this.segs) sig += isOpen(w.id) ? '1' : '0';
    if (!this.clip || sig !== this.clipSig) { this.clipSig = sig; this.buildClip(isOpen); }
    const tab = this.clip!, NA = tab.length;
    const half = (d.coneDeg * Math.PI) / 360;
    const arcX = this.arcX, arcZ = this.arcZ;
    for (let i = 0; i <= SEGS; i++) {
      const a = yaw - half + (i / SEGS) * 2 * half;
      const fx = -Math.sin(a), fz = -Math.cos(a);
      let u = ((a / (Math.PI * 2)) % 1 + 1) % 1 * NA;
      const k0 = Math.floor(u) % NA, k1 = (k0 + 1) % NA;
      u -= Math.floor(u);
      // linear blend of the two table entries, never beyond the nearer blocker
      const rr = Math.min(tab[k0] + (tab[k1] - tab[k0]) * u, Math.max(tab[k0], tab[k1]));
      arcX[i] = d.x + fx * rr;
      arcZ[i] = d.z + fz * rr;
    }
    const P = this.pos;
    let o = 0;
    const put = (x: number, y: number, z: number): void => { P[o++] = x; P[o++] = y; P[o++] = z; };
    for (let i = 0; i < SEGS; i++) {
      put(d.x, LAMP_H - 0.1, d.z); put(arcX[i], 0.12, arcZ[i]); put(arcX[i + 1], 0.12, arcZ[i + 1]);
      put(d.x, 0.11, d.z); put(arcX[i], 0.11, arcZ[i]); put(arcX[i + 1], 0.11, arcZ[i + 1]);
    }
    (this.geo.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    this.flash = Math.max(0, this.flash - dt * 2.2);
    const k = (1 + (calm ? 0.6 : 2.2) * this.flash);
    const C = this.colAttr.array as Float32Array;
    for (let i = 0; i < C.length; i += 3) {
      C[i] = this.baseCol[i] * k * tint.r;
      C[i + 1] = this.baseCol[i + 1] * k * tint.g;
      C[i + 2] = this.baseCol[i + 2] * k * tint.b;
    }
    this.colAttr.needsUpdate = true;
  }

  dispose(): void { this.geo.dispose(); }
}

export class SearchlightSet {
  readonly root = new THREE.Group();
  readonly lights: Searchlight[] = [];
  private readonly headGeo: THREE.BufferGeometry;
  private readonly headMat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
  private readonly beamMat = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, forceSinglePass: true, fog: false });
  private readonly tint = new THREE.Color('#cfe6ff');

  constructor(map: MapDef, defs: SearchlightDef[]) {
    this.headGeo = headGeometry();
    for (const d of defs) {
      const l = new Searchlight(d, map, this.headGeo, this.headMat, this.beamMat);
      this.lights.push(l);
      this.root.add(l.group, l.beam);
    }
    this.root.visible = defs.length > 0;
  }

  has(id: string): boolean { return this.lights.some((l) => l.def.id === id); }
  trigger(id: string): void { for (const l of this.lights) if (l.def.id === id) l.trigger(); }

  update(t: number, dt: number, isOpen: (id: string) => boolean, calm: boolean, cam?: { x: number; z: number }): void {
    for (const l of this.lights) {
      // far from the camera the beam is lost in the fog: skip its geometry (the sim's yaw is still pure maths of t)
      const far = cam ? Math.hypot(l.def.x - cam.x, l.def.z - cam.z) > l.def.rangeM + 70 : false;
      l.beam.visible = !far;
      l.group.visible = !far;
      if (far) { l.yaw = searchlightYaw(l.def, t); continue; }
      l.update(searchlightYaw(l.def, t), dt, isOpen, this.tint, calm);
    }
  }

  dispose(): void { for (const l of this.lights) l.dispose(); this.headGeo.dispose(); this.headMat.dispose(); this.beamMat.dispose(); }
}
