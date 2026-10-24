// Skinned-character kit shared by the Hyde and Crackstone: a tiny geometry builder that emits ONE indexed, vertex-coloured, skinned
// BufferGeometry (tubes with elliptical rings, ellipsoids, cones), a bone-hierarchy helper (rest pose = identity rotations, so every bone's
// world rest orientation is the rig's) and an allocation-free two-bone IK solver. One draw call per character body.
import * as THREE from 'three';

export type V3 = [number, number, number];
export type Weights = [string, number][];

const _c = new THREE.Color();

export const sm01 = (a: number, b: number, x: number): number => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

/** Weights for a single bone. */
export const w1 = (b: string): Weights => [[b, 1]];
/** t = 0 -> a, t = 1 -> b */
export const wMix = (a: string, b: string, t: number): Weights => (t <= 0.001 ? [[a, 1]] : t >= 0.999 ? [[b, 1]] : [[a, 1 - t], [b, t]]);

export interface RingSpec { p: V3; rx: number; ry: number; w: Weights; c?: THREE.ColorRepresentation; dark?: number }

export class SkinBuilder {
  private pos: number[] = [];
  private col: number[] = [];
  private idx: number[] = [];
  private si: number[] = [];
  private sw: number[] = [];
  private readonly bi = new Map<string, number>();
  constructor(readonly boneNames: string[]) { boneNames.forEach((n, i) => this.bi.set(n, i)); }

  private vert(p: V3, c: THREE.Color, dark: number, w: Weights): number {
    const n = this.pos.length / 3;
    this.pos.push(p[0], p[1], p[2]);
    this.col.push(c.r * dark, c.g * dark, c.b * dark);
    const ws = w.length > 4 ? w.slice().sort((a, b) => b[1] - a[1]).slice(0, 4) : w;
    let sum = 0;
    for (const [, v] of ws) sum += v;
    for (let k = 0; k < 4; k++) {
      const e = ws[k];
      if (e) {
        const b = this.bi.get(e[0]);
        if (b === undefined) throw new Error('unknown bone ' + e[0]);
        this.si.push(b); this.sw.push(e[1] / sum);
      } else { this.si.push(0); this.sw.push(0); }
    }
    return n;
  }

  /**
   * A tube through `rings` (each an ellipse of radii rx along `side`, ry along `up`). Frames are parallel-transported along the path.
   * `side0` fixes the first ring's side axis (default: derived from the first tangent).
   */
  tube(rings: RingSpec[], opts: { seg?: number; capStart?: boolean; capEnd?: boolean; side0?: V3; bottomDark?: number; color?: THREE.ColorRepresentation } = {}): this {
    const seg = opts.seg ?? 8;
    const bd = opts.bottomDark ?? 0.22;
    const n = rings.length;
    if (n < 2) return this;
    const t = new THREE.Vector3(), tp = new THREE.Vector3(), side = new THREE.Vector3(), up = new THREE.Vector3(), ax = new THREE.Vector3();
    const base: number[] = [];
    const tangent = (i: number, out: THREE.Vector3): THREE.Vector3 => {
      const a = rings[Math.max(0, i - 1)].p, b = rings[Math.min(n - 1, i + 1)].p;
      return out.set(b[0] - a[0], b[1] - a[1], b[2] - a[2]).normalize();
    };
    tangent(0, t);
    if (opts.side0) side.set(...opts.side0);
    else { const ref = Math.abs(t.y) > 0.8 ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(0, 1, 0); side.crossVectors(t, ref); }
    side.addScaledVector(t, -side.dot(t)).normalize();
    for (let i = 0; i < n; i++) {
      if (i > 0) {
        tangent(i, t);
        ax.crossVectors(tp, t);
        const s = ax.length();
        if (s > 1e-5) { ax.divideScalar(s); side.applyAxisAngle(ax, Math.asin(Math.min(1, s))); }
        side.addScaledVector(t, -side.dot(t)).normalize();
      }
      tp.copy(t);
      up.crossVectors(side, t).normalize(); // up = side x t  (points "up" for a path running along -Y/-Z with side = +X)
      const r = rings[i];
      _c.set(r.c ?? opts.color ?? '#999999');
      base.push(this.pos.length / 3);
      for (let k = 0; k < seg; k++) {
        const a = (k / seg) * Math.PI * 2;
        const ca = Math.cos(a), sa = Math.sin(a);
        const dy = side.y * ca + up.y * sa;
        const shade = 1 - bd * (1 - (dy * 0.5 + 0.5));
        this.vert([r.p[0] + side.x * ca * r.rx + up.x * sa * r.ry, r.p[1] + side.y * ca * r.rx + up.y * sa * r.ry, r.p[2] + side.z * ca * r.rx + up.z * sa * r.ry], _c, shade * (r.dark ?? 1), r.w);
      }
    }
    for (let i = 0; i < n - 1; i++) {
      for (let k = 0; k < seg; k++) {
        const k2 = (k + 1) % seg;
        const a = base[i] + k, b = base[i] + k2, c = base[i + 1] + k2, d = base[i + 1] + k;
        this.idx.push(a, c, b, a, d, c);
      }
    }
    const cap = (i: number, flip: boolean): void => {
      const r = rings[i];
      _c.set(r.c ?? opts.color ?? '#999999');
      const cv = this.vert(r.p, _c, r.dark ?? 1, r.w);
      for (let k = 0; k < seg; k++) {
        const a = base[i] + k, b = base[i] + (k + 1) % seg;
        if (flip) this.idx.push(cv, a, b); else this.idx.push(cv, b, a);
      }
    };
    if (opts.capStart) cap(0, true);
    if (opts.capEnd) cap(n - 1, false);
    return this;
  }

  /** Smooth ellipsoid (UV sphere) with an optional rotation (Euler XYZ) and per-vertex bottom darkening. */
  blob(c: V3, radii: V3, w: Weights, color: THREE.ColorRepresentation, o: { rot?: V3; nu?: number; nv?: number; bottomDark?: number; dark?: number; topLight?: number } = {}): this {
    const nu = o.nu ?? 9, nv = o.nv ?? 6;
    const bd = o.bottomDark ?? 0.3;
    const tl = o.topLight ?? 0;
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(...(o.rot ?? [0, 0, 0])));
    const v = new THREE.Vector3(), nrm = new THREE.Vector3();
    _c.set(color);
    const first = this.pos.length / 3;
    for (let j = 0; j <= nv; j++) {
      const th = (j / nv) * Math.PI;
      for (let i = 0; i < nu; i++) {
        const ph = (i / nu) * Math.PI * 2;
        const x = Math.sin(th) * Math.cos(ph), y = Math.cos(th), z = Math.sin(th) * Math.sin(ph);
        v.set(x * radii[0], y * radii[1], z * radii[2]).applyQuaternion(q);
        nrm.set(x, y, z).applyQuaternion(q);
        const shade = 1 - bd * (1 - (nrm.y * 0.5 + 0.5)) + tl * Math.max(0, nrm.y);
        this.vert([c[0] + v.x, c[1] + v.y, c[2] + v.z], _c, shade * (o.dark ?? 1), w);
      }
    }
    for (let j = 0; j < nv; j++) {
      for (let i = 0; i < nu; i++) {
        const i2 = (i + 1) % nu;
        const a = first + j * nu + i, b = first + j * nu + i2, c2 = first + (j + 1) * nu + i2, d = first + (j + 1) * nu + i;
        if (j !== 0) this.idx.push(a, b, d);
        if (j !== nv - 1) this.idx.push(b, c2, d);
      }
    }
    return this;
  }

  /** A pointed cone (3-5 sided) from `base` to `tip`. */
  cone(base: V3, tip: V3, r: number, w: Weights, color: THREE.ColorRepresentation, o: { seg?: number; rBase2?: number; dark?: number; tipW?: Weights } = {}): this {
    const tw = o.tipW ?? w;
    return this.tube([{ p: base, rx: r, ry: o.rBase2 ?? r, w, c: color, dark: o.dark }, { p: tip, rx: 0.004, ry: 0.004, w: tw, c: color, dark: o.dark }], { seg: o.seg ?? 4, capStart: true, bottomDark: 0.1 });
  }

  /** A (nu+1) x (nv+1) vertex grid (cloth). `skip` leaves quads out (tatters). Wound for the +normal side; use a DoubleSide material. */
  grid(nu: number, nv: number, at: (i: number, j: number) => { p: V3; w: Weights; c: THREE.ColorRepresentation; dark?: number }, skip?: (i: number, j: number) => boolean): this {
    const first = this.pos.length / 3;
    for (let j = 0; j <= nv; j++) {
      for (let i = 0; i <= nu; i++) {
        const v = at(i, j);
        _c.set(v.c);
        this.vert(v.p, _c, v.dark ?? 1, v.w);
      }
    }
    for (let j = 0; j < nv; j++) {
      for (let i = 0; i < nu; i++) {
        if (skip?.(i, j)) continue;
        const a = first + j * (nu + 1) + i, b = a + 1, c = a + (nu + 1) + 1, d = a + (nu + 1);
        this.idx.push(a, d, b, b, d, c);
      }
    }
    return this;
  }

  build(shift: V3 = [0, 0, 0]): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(this.si, 4));
    g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(this.sw, 4));
    g.setIndex(this.idx);
    if (shift[0] || shift[1] || shift[2]) g.translate(shift[0], shift[1], shift[2]);
    g.computeVertexNormals();
    return g;
  }
  get triangles(): number { return this.idx.length / 3; }
}

/** Weights along a bone chain for a path coordinate `s`: joints at `js` (bone k covers [js[k], js[k+1]]), blended over +-`bl`. */
export function chainWeights(bones: string[], js: number[], s: number, bl: number): Weights {
  const N = bones.length;
  const q: number[] = new Array(N + 1).fill(0);
  q[0] = 1;
  for (let k = 1; k < N; k++) q[k] = sm01(js[k] - bl, js[k] + bl, s);
  q[N] = 0;
  const out: Weights = [];
  for (let k = 0; k < N; k++) {
    const w = q[k] * (1 - q[k + 1]);
    if (w > 0.002) out.push([bones[k], w]);
  }
  return out.length ? out : [[bones[0], 1]];
}

/** Limb-like tube along a polyline of joints with radius keys [s, rx, ry]; weights by chain, optional colour per key. */
export function limbTube(sb: SkinBuilder, joints: V3[], bones: string[], keys: { s: number; rx: number; ry?: number; c?: THREE.ColorRepresentation; dark?: number }[], o: { bl?: number; seg?: number; capStart?: boolean; capEnd?: boolean; side0?: V3; ringsPerKey?: number; color?: THREE.ColorRepresentation; bottomDark?: number; extraS?: number[] } = {}): void {
  const segLen: number[] = [];
  const js: number[] = [0];
  for (let i = 1; i < joints.length; i++) {
    const d = Math.hypot(joints[i][0] - joints[i - 1][0], joints[i][1] - joints[i - 1][1], joints[i][2] - joints[i - 1][2]);
    segLen.push(d); js.push(js[i - 1] + d);
  }
  const total = js[js.length - 1];
  const at = (s: number): V3 => {
    const ss = Math.min(total, Math.max(0, s));
    let i = 0;
    while (i < segLen.length - 1 && ss > js[i + 1]) i++;
    const t = segLen[i] > 0 ? (ss - js[i]) / segLen[i] : 0;
    return [joints[i][0] + (joints[i + 1][0] - joints[i][0]) * t, joints[i][1] + (joints[i + 1][1] - joints[i][1]) * t, joints[i][2] + (joints[i + 1][2] - joints[i][2]) * t];
  };
  const bl = o.bl ?? 0.14;
  const ss: number[] = [];
  for (const k of keys) ss.push(k.s);
  for (const e of o.extraS ?? []) ss.push(e);
  for (let k = 1; k < joints.length - 1; k++) { ss.push(js[k] - bl, js[k] + bl, js[k]); }
  ss.sort((a, b) => a - b);
  const uniq = ss.filter((v, i) => i === 0 || v - ss[i - 1] > 0.004 && v >= 0 && v <= total + 1e-6);
  const rings: RingSpec[] = uniq.map((s) => {
    let k = 0;
    while (k < keys.length - 2 && s > keys[k + 1].s) k++;
    const a = keys[k], b = keys[Math.min(keys.length - 1, k + 1)];
    const t = b.s > a.s ? Math.min(1, Math.max(0, (s - a.s) / (b.s - a.s))) : 0;
    const rx = a.rx + (b.rx - a.rx) * t, ry = (a.ry ?? a.rx) + ((b.ry ?? b.rx) - (a.ry ?? a.rx)) * t;
    const dark = (a.dark ?? 1) + ((b.dark ?? 1) - (a.dark ?? 1)) * t;
    return { p: at(s), rx, ry, w: chainWeights(bones, js, s, bl), c: t < 0.5 ? (a.c ?? o.color) : (b.c ?? o.color), dark };
  });
  sb.tube(rings, { seg: o.seg ?? 8, capStart: o.capStart, capEnd: o.capEnd, side0: o.side0, bottomDark: o.bottomDark, color: o.color });
}

// ---------------------------------------------------------------------------------------------------------------- skeleton
export interface BoneDef { name: string; parent: string | null; at: V3 }

export class Rig {
  readonly bones: THREE.Bone[] = [];
  readonly byName = new Map<string, THREE.Bone>();
  readonly rest = new Map<string, THREE.Vector3>();
  readonly names: string[];
  skeleton!: THREE.Skeleton;
  private readonly chain: THREE.Object3D[] = [];
  private readonly m1 = new THREE.Matrix4();
  constructor(defs: BoneDef[]) {
    this.names = defs.map((d) => d.name);
    for (const d of defs) {
      const b = new THREE.Bone();
      b.name = d.name;
      const rp = new THREE.Vector3(...d.at);
      this.rest.set(d.name, rp);
      const par = d.parent ? this.byName.get(d.parent) : null;
      if (par) { b.position.copy(rp).sub(this.rest.get(d.parent!)!); par.add(b); } else b.position.copy(rp);
      this.byName.set(d.name, b);
      this.bones.push(b);
    }
  }
  b(name: string): THREE.Bone { const x = this.byName.get(name); if (!x) throw new Error('no bone ' + name); return x; }
  r(name: string): THREE.Vector3 { return this.rest.get(name)!; }

  /** Binds `mesh` to this rig (bones are added under the mesh). Call after the mesh is parented so its world matrix is final. */
  bind(mesh: THREE.SkinnedMesh): void {
    for (const b of this.bones) if (!b.parent) mesh.add(b);
    mesh.updateMatrixWorld(true);
    this.skeleton = new THREE.Skeleton(this.bones);
    mesh.bind(this.skeleton, mesh.matrixWorld);
    mesh.frustumCulled = false;
  }

  /** Binds an extra mesh (e.g. a cloth) to the already-built skeleton. */
  bindShared(mesh: THREE.SkinnedMesh): void {
    mesh.updateMatrixWorld(true);
    mesh.bind(this.skeleton, mesh.matrixWorld);
    mesh.frustumCulled = false;
  }

  /** Matrix of `b` relative to the mesh (rig space): product of the local matrices up the chain. Local matrices must be current. */
  rigMatrix(b: THREE.Object3D, out: THREE.Matrix4): THREE.Matrix4 {
    const ch = this.chain;
    ch.length = 0;
    for (let o: THREE.Object3D | null = b; o && (o as THREE.Bone).isBone; o = o.parent) ch.push(o);
    out.identity();
    for (let i = ch.length - 1; i >= 0; i--) out.multiply(ch[i].matrix);
    return out;
  }
  /** Same, but for the PARENT frame of `b` (its translation is the parent joint's position). */
  parentMatrix(b: THREE.Object3D, out: THREE.Matrix4): THREE.Matrix4 {
    if (b.parent && (b.parent as THREE.Bone).isBone) return this.rigMatrix(b.parent, out);
    return out.identity();
  }
  tmp(): THREE.Matrix4 { return this.m1; }
}

// ---------------------------------------------------------------------------------------------------------------- IK
const _S = new THREE.Vector3(), _d = new THREE.Vector3(), _u = new THREE.Vector3(), _n = new THREE.Vector3(), _E = new THREE.Vector3();
const _dA = new THREE.Vector3(), _dB = new THREE.Vector3(), _rest = new THREE.Vector3();
const _Qp = new THREE.Quaternion(), _Qu = new THREE.Quaternion(), _Qf = new THREE.Quaternion(), _tq = new THREE.Quaternion();
const _pm = new THREE.Matrix4();

export interface IkLimb {
  upper: THREE.Bone; lower: THREE.Bone; end: THREE.Bone;
  lenA: number; lenB: number;
  restA: THREE.Vector3; restB: THREE.Vector3; // unit rest directions of the two segments in rig space
}

export function makeLimb(rig: Rig, upper: string, lower: string, end: string): IkLimb {
  const p0 = rig.r(upper), p1 = rig.r(lower), p2 = rig.r(end);
  const restA = p1.clone().sub(p0), restB = p2.clone().sub(p1);
  return { upper: rig.b(upper), lower: rig.b(lower), end: rig.b(end), lenA: restA.length(), lenB: restB.length(), restA: restA.normalize(), restB: restB.normalize() };
}

/** Rig-space position of a limb's root joint (parent matrices must be current). */
export function limbRoot(rig: Rig, l: IkLimb, out: THREE.Vector3): THREE.Vector3 {
  rig.parentMatrix(l.upper, _pm);
  return out.copy(l.upper.position).applyMatrix4(_pm);
}

/**
 * Two-bone IK in rig space: sets `upper` / `lower` local quaternions so the end joint reaches `target` (clamped to the limb's reach)
 * with the knee/elbow pushed toward `pole` (a direction). Returns the rig-space orientation of the lower segment in `outQf`, so the
 * caller can orient the end bone (hand / foot): end.quaternion = inv(outQf) * desiredWorld.
 */
export function solveLimb(rig: Rig, l: IkLimb, target: THREE.Vector3, pole: THREE.Vector3, outQf: THREE.Quaternion): void {
  rig.parentMatrix(l.upper, _pm);
  _S.copy(l.upper.position).applyMatrix4(_pm);
  _Qp.setFromRotationMatrix(_pm);
  _d.copy(target).sub(_S);
  const a = l.lenA, b = l.lenB;
  let L = _d.length();
  const lo = Math.abs(a - b) + 0.03, hi = a + b - 0.004;
  if (L < 1e-5) { _d.set(0, -1, 0); L = lo; }
  else _d.divideScalar(L);
  L = Math.min(hi, Math.max(lo, L));
  _u.copy(_d);
  const cosA = Math.min(1, Math.max(-1, (a * a + L * L - b * b) / (2 * a * L)));
  const alpha = Math.acos(cosA), sinA = Math.sin(alpha);
  _n.copy(pole).addScaledVector(_u, -pole.dot(_u));
  if (_n.lengthSq() < 1e-6) _n.set(0, 1, 0).addScaledVector(_u, -_u.y);
  _n.normalize();
  _E.copy(_S).addScaledVector(_u, a * cosA).addScaledVector(_n, a * sinA);
  _dA.copy(_E).sub(_S).normalize();
  _dB.copy(_S).addScaledVector(_u, L).sub(_E).normalize();
  _rest.copy(l.restA);
  _Qu.setFromUnitVectors(_rest, _dA);
  _tq.copy(_Qp).invert();
  l.upper.quaternion.copy(_tq).multiply(_Qu);
  _rest.copy(l.restB);
  _Qf.setFromUnitVectors(_rest, _dB);
  _tq.copy(_Qu).invert();
  l.lower.quaternion.copy(_tq).multiply(_Qf);
  l.upper.updateMatrix();
  l.lower.updateMatrix();
  outQf.copy(_Qf);
}

/** end.quaternion = inverse(lowerWorld) * desiredWorld */
export function orientEnd(end: THREE.Bone, lowerWorld: THREE.Quaternion, desired: THREE.Quaternion): void {
  _tq.copy(lowerWorld).invert();
  end.quaternion.copy(_tq).multiply(desired);
  end.updateMatrix();
}

export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
