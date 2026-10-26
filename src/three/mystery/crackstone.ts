// Joseph Crackstone: a tall, gaunt colonial pilgrim (wide-brimmed tall-crowned hat with a buckle, dark coat, breeches, buckled boots, a staff),
// a long tattered cloak that streams behind him, a pale cursed face with faintly glowing witch-green eyes. One skinned body mesh + one
// skinned cloak mesh (two draw calls) + a tiny eye mesh. Procedural animation from his AI mode: slow upright deliberate stride (pauses and
// looks around when he stops), forward-leaning aggressive stride in CHASE, staff raised / thrust toward the curse circle in ATTACK, arms spread
// with the aura flaring during the scan warning. Models face -Z; ~2.4 m with the hat; root at ground level.
import * as THREE from 'three';
import type { CrackstoneMode } from '../../mystery/types.ts';
import { clamp, damp, lerp, mulberry32 } from '../util.ts';
import { Rig, SkinBuilder, chainWeights, limbRoot, limbTube, makeLimb, orientEnd, solveLimb, w1, wMix, type BoneDef, type IkLimb, type V3, type Weights } from './rigKit.ts';

export const CRACK_GREEN = '#a8e063';
export const CRACK_GREEN_HI = '#c4ef8a';

export interface CrackstoneFrame {
  dt: number;
  clock: number;
  mode: CrackstoneMode;
  speed: number;
  stunned: boolean;
  petrified: boolean;
  pinned?: boolean;
  slowed: boolean;
  distracted: boolean;
  suspicion: number;
  /** yaw of a point of interest relative to the body (lure / last known); null = none */
  lookYaw: number | null;
  bodyYaw: number;
  fade: number;
  reduced: boolean;
  /** supernatural scan telegraph: 'warning' (arms spread) / 'pulse' (just fired); scanK = warning progress 0..1 */
  scan: 'warning' | 'pulse' | null;
  scanK: number;
  /** curse wind-up progress 0..1 while a curse circle is on the ground; -1 = none */
  curseK: number;
}

export interface CrackstoneLook { eyeColor: THREE.Color; eyeScale: number }

const BONES: BoneDef[] = [
  { name: 'pelvis', parent: null, at: [0, 1.0, 0] },
  { name: 'spine', parent: 'pelvis', at: [0, 1.25, 0] },
  { name: 'chest', parent: 'spine', at: [0, 1.5, 0] },
  { name: 'neck', parent: 'chest', at: [0, 1.76, 0.02] },
  { name: 'head', parent: 'neck', at: [0, 1.86, 0.02] },
];
for (const [n, s] of [['L', -1], ['R', 1]] as const) {
  BONES.push(
    { name: 'sh' + n, parent: 'chest', at: [s * 0.25, 1.68, 0] },
    { name: 'el' + n, parent: 'sh' + n, at: [s * 0.27, 1.34, 0.02] },
    { name: 'hand' + n, parent: 'el' + n, at: [s * 0.27, 1.04, 0.0] },
    { name: 'hip' + n, parent: 'pelvis', at: [s * 0.12, 0.98, 0] },
    { name: 'knee' + n, parent: 'hip' + n, at: [s * 0.12, 0.54, -0.03] },
    { name: 'foot' + n, parent: 'knee' + n, at: [s * 0.12, 0.1, 0] },
  );
}
BONES.push({ name: 'staff', parent: 'handR', at: [0.27, 1.04, -0.03] });
for (const [n, x] of [['L', -1], ['C', 0], ['R', 1]] as const) {
  BONES.push(
    { name: 'cl' + n + '1', parent: 'chest', at: [x * 0.3, 1.62, 0.14] },
    { name: 'cl' + n + '2', parent: 'cl' + n + '1', at: [x * 0.38, 1.1, 0.26] },
    { name: 'cl' + n + '3', parent: 'cl' + n + '2', at: [x * 0.5, 0.55, 0.38] },
  );
}

const COAT = '#3a302b', COAT_HI = '#4a3e37', CLOAK = '#4a392e', CLOAK_LO = '#271f1b', CLOAK_TAT = '#3d2d23', BREECH = '#362c25', STOCK = '#2e2c2a', BOOT = '#2e2217', BRASS = '#c9a54a', HAT = '#242124', BAND = '#0c0b0c';
const SKIN = '#8f968a', SKIN_LO = '#6a7266', SOCKET = '#3a4333', HAIR = '#34323a', COLLAR = '#d4cdb6', WOOD = '#4d3a24';

function buildBody(): THREE.BufferGeometry {
  const sb = new SkinBuilder(BONES.map((b) => b.name));
  const rand = mulberry32(2718);
  const jit = (c: string, a = 0.06): THREE.Color => new THREE.Color(c).multiplyScalar(1 + (rand() - 0.5) * 2 * a);

  // ---- coat: gaunt torso with square shoulders, narrow waist, a skirt to mid-thigh
  limbTube(sb, [[0, 0.98, 0], [0, 1.25, 0], [0, 1.5, 0], [0, 1.76, 0.02]], ['pelvis', 'spine', 'chest'], [
    { s: 0, rx: 0.17, ry: 0.12, c: COAT }, { s: 0.27, rx: 0.15, ry: 0.105, c: COAT }, { s: 0.55, rx: 0.19, ry: 0.125, c: COAT_HI }, { s: 0.72, rx: 0.255, ry: 0.13, c: COAT_HI }, { s: 0.78, rx: 0.2, ry: 0.11, c: COAT }, { s: 0.8, rx: 0.1, ry: 0.09, c: COAT },
  ], { bl: 0.1, seg: 9, side0: [1, 0, 0], bottomDark: 0.2 });
  limbTube(sb, [[0, 1.0, 0], [0, 0.62, 0]], ['pelvis'], [{ s: 0, rx: 0.17, ry: 0.125, c: COAT }, { s: 0.2, rx: 0.22, ry: 0.15, c: COAT }, { s: 0.38, rx: 0.27, ry: 0.17, c: CLOAK_LO, dark: 0.9 }], { seg: 10, side0: [1, 0, 0], bottomDark: 0.3 });
  // belt + buckle, a row of coat buttons
  limbTube(sb, [[0, 1.17, 0], [0, 1.24, 0]], ['spine'], [{ s: 0, rx: 0.158, ry: 0.115, c: BAND }, { s: 0.07, rx: 0.158, ry: 0.115, c: BAND }], { seg: 9, side0: [1, 0, 0], bottomDark: 0 });
  sb.blob([0, 1.205, -0.118], [0.04, 0.034, 0.012], w1('spine'), new THREE.Color(BRASS), { nu: 6, nv: 4, bottomDark: 0 });
  for (let i = 0; i < 5; i++) sb.blob([0, 1.3 + i * 0.08, -0.123 + (i > 2 ? 0.002 : 0)], [0.012, 0.012, 0.01], w1(i < 2 ? 'spine' : 'chest'), new THREE.Color(BRASS), { nu: 4, nv: 3, bottomDark: 0 });
  // wide white pilgrim collar
  limbTube(sb, [[0, 1.72, 0.0], [0, 1.8, 0.0]], ['chest'], [{ s: 0, rx: 0.16, ry: 0.12, c: COLLAR }, { s: 0.04, rx: 0.15, ry: 0.115, c: COLLAR }, { s: 0.08, rx: 0.095, ry: 0.085, c: COLLAR }], { seg: 9, side0: [1, 0, 0], bottomDark: 0.1 });

  // ---- neck, head: pale, gaunt, long
  limbTube(sb, [[0, 1.76, 0.02], [0, 1.9, 0.02]], ['neck', 'head'], [{ s: 0, rx: 0.052, c: SKIN_LO }, { s: 0.14, rx: 0.05, c: SKIN_LO }], { seg: 6, bl: 0.04 });
  const H = w1('head');
  sb.blob([0, 1.99, 0.01], [0.098, 0.135, 0.112], H, jit(SKIN), { nu: 10, nv: 7, bottomDark: 0.2 }); // skull
  sb.blob([0, 1.9, -0.045], [0.07, 0.085, 0.085], H, jit(SKIN_LO, 0.04), { nu: 8, nv: 5 }); // long jaw / chin
  sb.blob([0, 1.99, -0.075], [0.085, 0.022, 0.04], H, new THREE.Color(SKIN_LO), { nu: 8, nv: 4 }); // brow
  for (const s of [-1, 1]) {
    sb.blob([s * 0.042, 1.985, -0.092], [0.032, 0.026, 0.024], H, new THREE.Color(SOCKET), { nu: 7, nv: 5, bottomDark: 0 }); // sunken eye sockets
    sb.blob([s * 0.07, 1.92, -0.07], [0.028, 0.05, 0.03], H, new THREE.Color(SKIN_LO), { nu: 6, nv: 4, bottomDark: 0.1 }); // hollow cheeks
    sb.blob([s * 0.098, 1.96, 0.0], [0.014, 0.034, 0.02], H, jit(SKIN), { nu: 5, nv: 4 }); // ears
    sb.blob([s * 0.105, 1.9, 0.03], [0.026, 0.1, 0.03], H, new THREE.Color(HAIR), { nu: 6, nv: 5 }); // lank side locks
  }
  sb.cone([0, 1.965, -0.1], [0, 1.915, -0.168], 0.022, H, SKIN, { seg: 4, rBase2: 0.018 }); // long nose
  sb.blob([0, 1.885, -0.107], [0.026, 0.005, 0.012], H, new THREE.Color('#2b1f22'), { nu: 6, nv: 3, bottomDark: 0 }); // thin mouth
  sb.blob([0, 1.86, -0.07], [0.012, 0.035, 0.016], H, new THREE.Color(HAIR), { nu: 5, nv: 4 }); // thin goatee
  sb.blob([0, 1.95, 0.07], [0.105, 0.15, 0.07], H, new THREE.Color(HAIR), { nu: 8, nv: 6 }); // hair behind
  // hat: a lathe (profile of [y, radius]) - brim, tall crown that widens to the top, band, brass buckle
  {
    // a capotain: crown ~0.28 m, slightly tapered; brim ~0.55 m across; dark felt, dark band, small brass buckle
    const prof: [number, number, string, number][] = [
      [2.048, 0.145, HAT, 0.6], [2.052, 0.275, HAT, 0.55], [2.07, 0.28, HAT, 1], [2.082, 0.175, HAT, 1], [2.09, 0.152, HAT, 1],
      [2.2, 0.146, HAT, 1], [2.33, 0.132, HAT, 1], [2.364, 0.124, HAT, 1], [2.37, 0.07, HAT, 1],
    ];
    sb.tube(prof.map(([y, r, c, d]) => ({ p: [0, y, 0.0] as V3, rx: r, ry: r * 1.1, w: H, c, dark: d })), { seg: 14, side0: [1, 0, 0], capStart: true, capEnd: true, bottomDark: 0.15 });
    sb.tube([[2.094, 0.156], [2.15, 0.152]].map(([y, r]) => ({ p: [0, y, 0.0] as V3, rx: r, ry: r * 1.1, w: H, c: BAND })), { seg: 14, side0: [1, 0, 0], bottomDark: 0 });
    sb.blob([0, 2.122, -0.172], [0.03, 0.034, 0.008], H, new THREE.Color(BRASS), { nu: 6, nv: 4, bottomDark: 0 });
    sb.blob([0, 2.122, -0.178], [0.018, 0.022, 0.005], H, new THREE.Color('#1e1a0c'), { nu: 6, nv: 4, bottomDark: 0 });
  }

  // ---- arms: thin sleeves, white cuffs, bony pale hands
  for (const [n, s] of [['L', -1], ['R', 1]] as const) {
    const S: V3 = [s * 0.25, 1.68, 0], E: V3 = [s * 0.27, 1.34, 0.02], W: V3 = [s * 0.27, 1.04, 0.0];
    limbTube(sb, [S, E, W], ['sh' + n, 'el' + n], [
      { s: 0, rx: 0.07, c: COAT_HI }, { s: 0.34, rx: 0.058, c: COAT }, { s: 0.4, rx: 0.056, c: COAT }, { s: 0.62, rx: 0.052, c: COAT }, { s: 0.64, rx: 0.062, c: COLLAR }, { s: 0.69, rx: 0.06, c: COLLAR }, { s: 0.7, rx: 0.036, c: SKIN_LO },
    ], { bl: 0.08, seg: 7, capStart: true });
    const HD = w1('hand' + n);
    sb.blob([s * 0.27, 0.985, -0.005], [0.04, 0.062, 0.022], HD, jit(SKIN), { nu: 7, nv: 5 });
    for (let i = 0; i < 4; i++) {
      const x = s * 0.27 + (i - 1.5) * 0.019;
      sb.cone([x, 0.945, -0.005], [x + (i - 1.5) * 0.003, 0.84 - (i === 1 || i === 2 ? 0.02 : 0), -0.02], 0.011, HD, SKIN_LO, { seg: 4 });
    }
    sb.cone([s * 0.235, 0.975, -0.02], [s * 0.225, 0.9, -0.05], 0.011, HD, SKIN_LO, { seg: 4 });
  }
  // ---- legs: breeches, stockings, tall weathered boots with brass buckles
  for (const [n, s] of [['L', -1], ['R', 1]] as const) {
    const Hh: V3 = [s * 0.12, 0.98, 0], K: V3 = [s * 0.12, 0.54, -0.03], A: V3 = [s * 0.12, 0.1, 0];
    limbTube(sb, [Hh, K, A], ['hip' + n, 'knee' + n], [
      { s: 0, rx: 0.1, c: BREECH }, { s: 0.22, rx: 0.105, c: BREECH }, { s: 0.42, rx: 0.075, c: BREECH }, { s: 0.45, rx: 0.08, c: BRASS }, { s: 0.47, rx: 0.07, c: STOCK },
      { s: 0.62, rx: 0.064, ry: 0.06, c: STOCK }, { s: 0.7, rx: 0.088, ry: 0.088, c: BOOT }, { s: 0.74, rx: 0.095, ry: 0.095, c: BOOT, dark: 0.85 }, { s: 0.82, rx: 0.07, c: BOOT }, { s: 0.88, rx: 0.062, c: BOOT, dark: 0.8 },
    ], { bl: 0.09, seg: 8, capStart: true });
    const FF = w1('foot' + n);
    limbTube(sb, [[s * 0.12, 0.085, 0.045], [s * 0.12, 0.06, -0.1], [s * 0.12, 0.05, -0.2]], ['foot' + n], [{ s: 0, rx: 0.068, ry: 0.07, c: BOOT }, { s: 0.15, rx: 0.07, ry: 0.058, c: BOOT }, { s: 0.25, rx: 0.062, ry: 0.044, c: BOOT, dark: 0.9 }], { seg: 7, side0: [1, 0, 0], capEnd: true, bl: 0.01 });
    sb.blob([s * 0.12, 0.012, -0.07], [0.07, 0.014, 0.16], FF, new THREE.Color(BAND), { nu: 7, nv: 4, bottomDark: 0 }); // sole
    sb.blob([s * 0.12, 0.115, -0.1], [0.04, 0.022, 0.034], FF, new THREE.Color(BRASS), { nu: 6, nv: 4, bottomDark: 0 }); // buckle
  }
  // ---- staff: gnarled wood with a knob, held by the right hand
  limbTube(sb, [[0.27, 0.0, -0.03], [0.27, 2.12, -0.03]], ['staff'], [{ s: 0, rx: 0.014, c: WOOD }, { s: 1.0, rx: 0.02, c: WOOD }, { s: 2.0, rx: 0.019, c: WOOD }, { s: 2.12, rx: 0.03, c: WOOD }], { seg: 5, side0: [1, 0, 0], bl: 0.001, capStart: true, capEnd: true, bottomDark: 0 });
  sb.blob([0.27, 2.17, -0.03], [0.04, 0.05, 0.04], w1('staff'), jit(WOOD), { nu: 6, nv: 5 });
  sb.cone([0.27, 2.19, -0.03], [0.27, 2.32, -0.03], 0.018, w1('staff'), WOOD, { seg: 4 });
  return sb.build();
}

function buildCloak(): THREE.BufferGeometry {
  const sb = new SkinBuilder(BONES.map((b) => b.name));
  const nu = 14, nv = 10;
  const lenK = [1, 0.82, 0.95, 0.78, 0.9, 0.84, 1, 0.8, 0.93, 0.77, 0.96, 0.83, 0.92, 0.8, 1];
  const rand = mulberry32(99);
  const holes = new Set<number>();
  for (let j = 6; j < nv; j++) for (let i = 0; i < nu; i++) if (rand() < 0.05 + (j - 6) * 0.05) holes.add(j * nu + i);
  const rows = ['1', '2', '3'];
  const js = [0, 0.52, 1.07];
  // a heavy cloak wrapping around the body: a half-cylinder from shoulder to hem, wider than the shoulders, hem near the boots
  sb.grid(nu, nv, (i, j) => {
    const u = (i / nu) * 2 - 1;
    const v = j / nv;
    const th = u * 1.95;
    const len = v > 0.7 ? lerp(1, lenK[i], (v - 0.7) / 0.3) : 1;
    const y = 1.74 - v * 1.62 * len;
    const rx = 0.27 + 0.56 * v, rz = 0.17 + 0.34 * v;
    const fold = Math.sin(i * 1.9 + v * 4.0) * 0.03 * v;
    const x = Math.sin(th) * (rx + fold);
    const z = Math.cos(th) * (rz + fold) + 0.03 * v;
    const wc: [string, number][] = [];
    if (u < 0) { wc.push(['L', -u]); wc.push(['C', 1 + u]); } else { wc.push(['R', u]); wc.push(['C', 1 - u]); }
    const wr = chainWeights(rows, js, v * 1.55, 0.15);
    const w: Weights = [];
    for (const [c, a] of wc) for (const [r, b] of wr) if (a * b > 0.01) w.push(['cl' + c + r, a * b]);
    const col = v > 0.72 ? CLOAK_TAT : v > 0.3 ? CLOAK : CLOAK_LO;
    return { p: [x, y, z], w, c: col, dark: 0.8 + 0.3 * Math.abs(Math.sin(i * 1.7 + v * 2)) };
  }, (i, j) => holes.has(j * nu + i));
  return sb.build();
}

interface LegRt { ik: IkLimb; s: number; off: number; pos: THREE.Vector3; pole: THREE.Vector3; qf: THREE.Quaternion; qd: THREE.Quaternion; base: THREE.Vector3 }

const _v = new THREE.Vector3(), _e = new THREE.Euler();
const ez = (a: number, b: number, c: number, o: THREE.Euler['order'] = 'XYZ'): THREE.Euler => _e.set(a, b, c, o);

export class CrackstoneRig {
  readonly root = new THREE.Group();
  readonly look: CrackstoneLook = { eyeColor: new THREE.Color(CRACK_GREEN), eyeScale: 1 };
  readonly headWorld = new THREE.Vector3();
  readonly chestWorld = new THREE.Vector3();
  readonly eyeL = new THREE.Vector3();
  readonly eyeR = new THREE.Vector3();
  readonly handWorld = new THREE.Vector3();
  readonly staffTip = new THREE.Vector3();
  /** 0..1 visual flare of the aura (scan warning / curse wind-up) */
  flare = 0;
  readonly triangles: number;
  private readonly rig: Rig;
  private readonly body: THREE.SkinnedMesh;
  private readonly cloak: THREE.SkinnedMesh;
  private readonly geo: THREE.BufferGeometry;
  private readonly cloakGeo: THREE.BufferGeometry;
  private readonly eyeGeo = new THREE.SphereGeometry(0.02, 6, 5);
  private readonly mat: THREE.MeshLambertMaterial;
  private readonly cloakMat: THREE.MeshLambertMaterial;
  private readonly eyeMat: THREE.MeshBasicMaterial;
  private readonly eyes = new THREE.Group();
  private readonly legs: LegRt[] = [];
  private phase = 0;
  private stone = 0;
  private frost = 0;
  private shock = 0;
  private pin = 0;
  private yawSm = 0;
  private yawInit = false;
  private posed = false;
  private readonly P = { lean: 0, headYaw: 0, headPitch: 0, headRoll: 0, spread: 0, raise: 0, thrust: 0, crouch: 0, move: 0, scale: 1, cloakFlare: 0.1, armSwing: 0.3, bodyTwist: 0, sad: 0, armF: 0.7 };
  private chaseK = 0;

  constructor() {
    this.rig = new Rig(BONES);
    this.geo = buildBody();
    this.cloakGeo = buildCloak();
    this.triangles = (this.geo.index?.count ?? 0) / 3 + (this.cloakGeo.index?.count ?? 0) / 3;
    const rimHook = (m: THREE.MeshLambertMaterial): void => {
      m.onBeforeCompile = (sh) => {
        sh.fragmentShader = sh.fragmentShader.replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n\tfloat rimF = pow(1.0 - saturate(dot(normalize(normal), normalize(vViewPosition))), 2.6);\n\ttotalEmissiveRadiance += vec3(0.035, 0.035, 0.04) * rimF;');
      };
    };
    this.mat = new THREE.MeshLambertMaterial({ vertexColors: true, emissive: new THREE.Color(0.004, 0.004, 0.005) });
    this.cloakMat = new THREE.MeshLambertMaterial({ vertexColors: true, emissive: new THREE.Color(0.004, 0.004, 0.005), side: THREE.DoubleSide });
    rimHook(this.mat); rimHook(this.cloakMat);
    this.body = new THREE.SkinnedMesh(this.geo, this.mat);
    this.root.add(this.body);
    this.rig.bind(this.body);
    this.cloak = new THREE.SkinnedMesh(this.cloakGeo, this.cloakMat);
    this.root.add(this.cloak);
    this.rig.bindShared(this.cloak);
    this.eyeMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(CRACK_GREEN), fog: false });
    for (const s of [-1, 1]) {
      const m = new THREE.Mesh(this.eyeGeo, this.eyeMat);
      m.position.set(s * 0.042, 1.985 - 1.86, -0.106 - 0.02);
      m.scale.set(1, 0.7, 0.8);
      this.eyes.add(m);
    }
    this.rig.b('head').add(this.eyes);
    for (const [n, s, off] of [['L', -1, 0], ['R', 1, 0.5]] as const) {
      const ik = makeLimb(this.rig, 'hip' + n, 'knee' + n, 'foot' + n);
      const base = this.rig.r('foot' + n).clone();
      this.legs.push({ ik, s, off, base, pos: base.clone(), pole: new THREE.Vector3(0, 0, -1), qf: new THREE.Quaternion(), qd: new THREE.Quaternion() });
    }
  }

  private targets(f: CrackstoneFrame, t: { lean: number; headYaw: number; headPitch: number; headRoll: number; spread: number; raise: number; thrust: number; crouch: number; armSwing: number; cloakFlare: number; bodyTwist: number; sad: number; armF: number }): void {
    const T = f.clock;
    t.lean = -0.2; t.headYaw = 0; t.headPitch = -0.2; t.headRoll = 0; t.spread = 0; t.raise = 0; t.thrust = 0; t.crouch = 0.6; t.armSwing = 0.3; t.cloakFlare = 0.2; t.bodyTwist = 0; t.sad = 0; t.armF = 0.75;
    const still = f.speed < 0.15;
    switch (f.mode) {
      case 'PATROL':
      case 'RETURN':
        t.lean = -0.22; t.headYaw = Math.sin(T * (still ? 0.7 : 0.45)) * (still ? 1.05 : 0.4); t.headPitch = -0.2; t.bodyTwist = still ? Math.sin(T * 0.7) * 0.18 : 0; t.armSwing = 0.24; t.crouch = 0.65; t.armF = 1.1;
        break;
      case 'SEARCH':
        t.lean = -0.28; t.headYaw = Math.sin(T * 1.1) * 0.95; t.headPitch = -0.15; t.bodyTwist = Math.sin(T * 1.1) * 0.15; t.armSwing = 0.2; t.crouch = 0.8; t.armF = 0.5;
        break;
      case 'INVESTIGATE':
        t.lean = -0.3; t.headPitch = -0.12; t.armSwing = 0.3; t.cloakFlare = 0.3; t.crouch = 0.8; t.armF = 0.85;
        break;
      case 'CHASE':
        t.lean = -0.5; t.headPitch = -0.05; t.armSwing = 0.6; t.cloakFlare = 0.95; t.crouch = 1.0; t.armF = 1.5;
        break;
      case 'ATTACK':
        t.lean = -0.18; t.headPitch = 0.0; t.armSwing = 0; t.raise = 1; t.cloakFlare = 0.4; t.crouch = 0.8;
        break;
    }
    if (f.mode === 'ATTACK') {
      const k = f.curseK;
      // wind-up: the staff rises over the whole circle fill, then thrusts toward the circle in the last moments
      t.raise = k < 0 ? 0.6 : clamp(k / 0.7, 0, 1);
      t.thrust = k < 0 ? 0 : clamp((k - 0.82) / 0.18, 0, 1);
      t.lean = -0.18 - t.thrust * 0.22;
    }
    if (f.scan === 'warning') { t.spread = 1; t.headPitch = 0.3; t.lean = 0.05; t.armSwing = 0; t.cloakFlare = 0.6; t.raise = 0; t.crouch = 0.2; }
    else if (f.scan === 'pulse') { t.spread = 0.8; t.headPitch = 0.15; t.lean = 0.0; t.cloakFlare = 0.7; t.crouch = 0.3; }
    if (f.distracted && f.mode !== 'ATTACK') {
      t.headYaw = f.lookYaw !== null ? clamp(f.lookYaw, -1.2, 1.2) : Math.sin(T * 1.4) * 0.8; t.headRoll = 0.2 * Math.sin(T * 2.2);
    } else if (f.lookYaw !== null && f.mode !== 'CHASE' && f.mode !== 'ATTACK' && f.mode !== 'PATROL' && f.mode !== 'RETURN') {
      t.headYaw = clamp(f.lookYaw, -1.0, 1.0) * 0.8 + t.headYaw * 0.3;
    }
    if (f.stunned) { t.lean = -0.22; t.headPitch = -0.5; t.headRoll = 0.25; t.spread = 0; t.raise = 0; t.thrust = 0; t.crouch = 0.4; t.sad = 1; t.cloakFlare = 0.05; t.armF = 0.1; }
  }

  update(f: CrackstoneFrame): void {
    const dt = f.dt;
    if (!this.yawInit) { this.yawSm = f.bodyYaw; this.yawInit = true; }
    this.stone = damp(this.stone, f.petrified ? 1 : 0, 9, dt);
    this.frost = damp(this.frost, f.slowed ? 1 : 0, 4, dt);
    this.shock = damp(this.shock, f.stunned && !f.petrified && !f.pinned ? 1 : 0, 10, dt);
    this.pin = damp(this.pin, f.pinned ? 1 : 0, 8, dt);
    const useStone = this.stone > 0.5;
    this.eyes.visible = !useStone;
    const st = this.stone;
    const fl = this.shock * (0.5 + 0.5 * Math.sin(f.clock * 38)) * 0.28;
    for (const m of [this.mat, this.cloakMat]) {
      m.color.setRGB(lerp(lerp(1, 0.85, this.frost), 1.9, st), lerp(lerp(1, 1.0, this.frost), 1.85, st), lerp(lerp(1, 1.2, this.frost), 1.75, st));
      m.emissive.setRGB(0.004 + this.frost * 0.03 + fl * 0.5 + st * 0.12 + this.flare * 0.008, 0.004 + this.frost * 0.14 + fl * 0.5 + this.pin * 0.18 + st * 0.12 + this.flare * 0.028, 0.005 + this.frost * 0.24 + fl * 0.6 + this.pin * 0.12 + st * 0.1 + this.flare * 0.01);
      const fade = clamp(f.fade, 0, 1);
      const wantT = fade > 0.03;
      if (m.transparent !== wantT) { m.transparent = wantT; m.needsUpdate = true; }
      m.opacity = 1 - 0.7 * fade;
      m.depthWrite = fade < 0.4;
    }
    // witch-light rim: the cursed glow on his edges (flares with the scan / curse)
    const flareT = f.scan === 'warning' ? 0.6 + 0.4 * f.scanK : f.scan === 'pulse' ? 1 : f.mode === 'ATTACK' ? 0.7 : 0;
    this.flare = damp(this.flare, f.reduced ? Math.min(flareT, 0.8) : flareT, 8, dt);

    const frozen = f.petrified || !!f.pinned;
    const P = this.P;
    if (!frozen) {
      const t = { lean: 0, headYaw: 0, headPitch: 0, headRoll: 0, spread: 0, raise: 0, thrust: 0, crouch: 0, armSwing: 0, cloakFlare: 0, bodyTwist: 0, sad: 0, armF: 0 };
      this.targets(f, t);
      const k = 1 - Math.exp(-(f.mode === 'ATTACK' ? 12 : 6) * dt);
      P.lean = lerp(P.lean, t.lean, k); P.headYaw = lerp(P.headYaw, t.headYaw, k); P.headPitch = lerp(P.headPitch, t.headPitch, k); P.headRoll = lerp(P.headRoll, t.headRoll, k);
      P.spread = lerp(P.spread, t.spread, 1 - Math.exp(-(t.spread > P.spread ? 9 : 5) * dt)); P.raise = lerp(P.raise, t.raise, k);
      P.thrust = lerp(P.thrust, t.thrust, 1 - Math.exp(-20 * dt)); P.crouch = lerp(P.crouch, t.crouch, k);
      P.armSwing = lerp(P.armSwing, t.armSwing, k); P.cloakFlare = lerp(P.cloakFlare, t.cloakFlare, 1 - Math.exp(-4 * dt)); P.bodyTwist = lerp(P.bodyTwist, t.bodyTwist, k); P.sad = lerp(P.sad, t.sad, k); P.armF = lerp(P.armF, t.armF, k);
      this.chaseK = damp(this.chaseK, f.mode === 'CHASE' ? 1 : 0, 5, dt);
      const sp = f.stunned || f.scan === 'warning' || f.mode === 'ATTACK' ? 0 : f.speed;
      P.move = damp(P.move, clamp(sp / 0.6, 0, 1), 8, dt);
      const slowK = f.slowed ? 0.85 : 1;
      const rate = (0.35 + sp * 0.34) * lerp(1, 1.1, this.chaseK);
      this.phase = (this.phase + dt * rate * slowK * (sp > 0.05 ? 1 : 0)) % 1;
      let d = f.bodyYaw - this.yawSm;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      this.yawSm += d * (1 - Math.exp(-12 * dt));
    }
    this.root.rotation.y = this.yawSm;
    this.root.scale.setScalar(1);
    if (!frozen || !this.posed) { this.pose(f); this.posed = true; }

    const L = this.look;
    let col = CRACK_GREEN, es = 1;
    if (f.mode === 'CHASE' || f.mode === 'ATTACK') { col = CRACK_GREEN_HI; es = 1.5; }
    else if (f.mode === 'SEARCH' || f.mode === 'INVESTIGATE') { col = '#b6e87a'; es = 1.15; }
    if (f.scan) { col = CRACK_GREEN_HI; es = 1.8; }
    if (f.distracted) col = '#c9a2ff';
    if (f.stunned) col = Math.sin(f.clock * 30) > 0 ? '#aee8ff' : '#ffffff';
    if (f.pinned) col = '#8affc8';
    if (f.slowed) col = '#8fd8ff';
    L.eyeColor.set(col); L.eyeScale = es;
    this.eyeMat.color.set(col);

    this.root.updateMatrixWorld(true);
    this.rig.b('head').getWorldPosition(this.headWorld);
    this.rig.b('chest').getWorldPosition(this.chestWorld);
    this.rig.b('handR').getWorldPosition(this.handWorld);
    for (const s of [-1, 1]) {
      _v.set(s * 0.042, 1.985 - 1.86, -0.112);
      this.rig.b('head').localToWorld(_v);
      (s < 0 ? this.eyeL : this.eyeR).copy(_v);
    }
    this.rig.b('staff').localToWorld(_v.set(0, 2.3 - 1.04, 0));
    this.staffTip.copy(_v);
  }

  private pose(f: CrackstoneFrame): void {
    const R = this.rig, P = this.P, T = f.clock;
    const mv = P.move;
    const ph = this.phase * Math.PI * 2;
    const tr = this.shock * Math.sin(T * 55) * 0.012;
    const breath = Math.sin(T * 1.4) * 0.012;
    const pel = R.b('pelvis'), spi = R.b('spine'), che = R.b('chest'), nec = R.b('neck'), hed = R.b('head');
    const bobY = Math.abs(Math.sin(ph)) * 0.035 * mv * (1 + this.chaseK) - P.crouch * 0.2 - P.sad * 0.04;
    pel.position.set(tr + Math.sin(ph) * 0.012 * mv, R.r('pelvis').y + bobY, 0);
    pel.quaternion.setFromEuler(ez(P.lean * 0.3, -Math.sin(ph) * 0.1 * mv - P.bodyTwist * 0.4, Math.sin(ph) * 0.03 * mv));
    spi.quaternion.setFromEuler(ez(P.lean * 0.35 + breath, Math.sin(ph) * 0.08 * mv + P.bodyTwist * 0.3, 0));
    che.quaternion.setFromEuler(ez(P.lean * 0.35 + breath * 0.6 - P.spread * 0.06, Math.sin(ph) * 0.07 * mv + P.bodyTwist * 0.3 + tr * 4, 0));
    nec.quaternion.setFromEuler(ez(P.headPitch * 0.4 - P.lean * 0.3, P.headYaw * 0.4, P.headRoll * 0.4, 'YXZ'));
    hed.quaternion.setFromEuler(ez(P.headPitch * 0.6 - P.lean * 0.3, P.headYaw * 0.6, P.headRoll * 0.6, 'YXZ'));
    for (const b of [pel, spi, che, nec, hed]) b.updateMatrix();

    // ---- arms (FK): swing opposite the legs; the right hand keeps hold of the staff
    const swingL = Math.sin(ph) * P.armSwing * mv, swingR = -Math.sin(ph) * P.armSwing * 0.35 * mv;
    const idle = Math.sin(T * 1.2) * 0.02;
    // left arm
    {
      const sp = P.spread;
      R.b('shL').quaternion.setFromEuler(ez(swingL * 1.0 - 0.05 + idle, 0, -(0.06 + sp * 1.4), 'ZXY'));
      R.b('elL').quaternion.setFromEuler(ez(0.55 + Math.max(0, swingL) * 0.9 + sp * 0.15 + P.sad * 0.1, 0, 0));
      R.b('handL').quaternion.setFromEuler(ez(0.1 + sp * 0.2, 0, 0));
    }
    // right arm + staff: raise = staff up/forward overhead, thrust = arm and staff driven toward the curse circle
    {
      const sp = P.spread, rs = P.raise, th = P.thrust;
      // explicit: positive rotation.x swings the hand toward -Z (forward); raise gives +1.9 rad (arm overhead), thrust pulls it back down/forward
      const armX = swingR + 0.12 + P.armF * 0.9 * (1 - rs) + rs * 2.0 - th * 1.0;
      R.b('shR').quaternion.setFromEuler(ez(armX + idle, 0, 0.06 + sp * 1.4 + rs * 0.12, 'ZXY'));
      const elbX = 0.25 + rs * 0.1 - th * 0.3 + sp * 0.1;
      R.b('elR').quaternion.setFromEuler(ez(elbX, 0, 0));
      R.b('handR').quaternion.setFromEuler(ez(0.0, 0, 0));
      // the staff stays upright in the world while walking (a cane, tip near the ground), tips forward when raised, points down-forward in the thrust
      const net = (0.2 + P.armF * 0.1) * (1 - rs) - rs * 0.35 - th * 1.9; // walking: tip planted ahead, top leaning back
      R.b('staff').quaternion.setFromEuler(ez(net - (armX + elbX), 0, -(0.06 + sp * 1.4 + rs * 0.12) + sp * 0.4));
    }
    for (const n of ['shL', 'elL', 'handL', 'shR', 'elR', 'handR', 'staff']) R.b(n).updateMatrix();

    // ---- legs (IK): upright deliberate stride; longer and faster in CHASE
    const chase = this.chaseK;
    const duty = 0.58;
    const rate = (0.35 + f.speed * 0.34) * lerp(1, 1.1, chase);
    for (const L of this.legs) {
      const u = (this.phase + L.off) % 1;
      const stride = Math.min(lerp(1.0, 1.7, chase), f.speed * duty / Math.max(0.2, rate)) * mv;
      let z: number, y = 0, pitch = 0;
      if (u < duty) { z = -stride / 2 + stride * (u / duty); }
      else {
        const v = (u - duty) / (1 - duty);
        const e = v * v * (3 - 2 * v);
        z = stride / 2 - stride * e;
        y = (0.12 + 0.05 * chase) * Math.sin(v * Math.PI) * mv;
        pitch = 0.3 * Math.sin(v * Math.PI) * mv;
      }
      L.pos.set(L.base.x * (1.9 + (f.stunned ? 0.5 : 0)), L.base.y + y - 0.0, L.base.z + z);
      limbRoot(R, L.ik, _v);
      // keep the hip-to-foot distance reachable when the pelvis bobs/crouches
      solveLimb(R, L.ik, L.pos, L.pole, L.qf);
      L.qd.setFromEuler(ez(pitch, 0, 0));
      orientEnd(L.ik.end, L.qf, L.qd);
    }
    // ---- cloak: three chains stream behind, lagging down the length; they spread with the arms and flare when he is chased / scanning
    const flare = P.cloakFlare + Math.min(0.3, f.speed * 0.07) * (1 - P.sad);
    const wob = f.reduced ? 0.4 : 1;
    for (const [n, side] of [['L', -1], ['C', 0], ['R', 1]] as const) {
      for (let k = 1; k <= 3; k++) {
        const b = R.b('cl' + n + k);
        const lag = Math.sin(T * 1.9 - k * 0.9 + side * 0.8 + ph * 0.5 * mv) * 0.06 * wob * (0.5 + k * 0.4);
        const fx = -(flare * 0.4) + lag * (0.8 + mv) - Math.sin(ph) * 0.03 * mv;
        const rz = side * (0.04 + P.spread * (k === 1 ? 0.7 : 0.3) + flare * 0.12 * k) + Math.sin(T * 1.3 + k + side) * 0.03 * wob;
        b.quaternion.setFromEuler(ez(fx, 0, rz, 'ZXY'));
        b.updateMatrix();
      }
    }
  }

  get stoneAmount(): number { return this.stone; }
  get frostAmount(): number { return this.frost; }

  dispose(): void {
    this.geo.dispose(); this.cloakGeo.dispose(); this.eyeGeo.dispose();
    this.mat.dispose(); this.cloakMat.dispose(); this.eyeMat.dispose();
    this.rig.skeleton.dispose();
  }
}

export { wMix };
