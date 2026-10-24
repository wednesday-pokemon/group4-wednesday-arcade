// Slurp: Isaac Night's zombie form (Wednesday, season 2). A gaunt, grey-green, hunched stalker in tattered dark clothes: sunken glowing pale
// eyes, a wide hungry mouth with a hinged jaw (rows of small teeth), lank hair, arms hanging past the knees with long bony fingers, a torn
// jacket whose rag strips swing, bare dragging feet. NOT gory. One skinned body mesh + one skinned rag mesh (two draw calls) + two tiny eyes.
// Distinct from the Hyde (four-limbed silver beast) and Crackstone (tall cloaked pilgrim with a hat and staff): this one is a lanky
// BIPED that never stands straight. Locomotion is wrong on purpose: an uneven lurching cadence (the step surges and stalls), one dragging
// foot, random twitches (head snaps, shoulder jerks, finger curls), head tilts and pauses. Models face -Z; ~1.85 m upright; root at ground.
import * as THREE from 'three';
import type { SlurpMode } from '../../mystery/types.ts';
import { clamp, damp, lerp, mulberry32, smoothstep } from '../util.ts';
import { Rig, SkinBuilder, chainWeights, limbRoot, limbTube, makeLimb, orientEnd, solveLimb, w1, wMix, type BoneDef, type IkLimb, type V3, type Weights } from './rigKit.ts';

export const SLURP_EYE = '#ecd3f2';
export const SLURP_EYE_HI = '#ffffff';
/** Slurp's glow (eyes, drips) is the HUD's Slurp orchid (UX_FINAL --c-slurp #d77be0); his mist is a greyed orchid. Red stays the Hyde's, witch-green Crackstone's. */
export const SLURP_GLOW = '#d77be0';
export const SLURP_MIST = '#a98ab4';

export interface SlurpFrame {
  dt: number;
  clock: number;
  mode: SlurpMode;
  speed: number;
  /** the lunge / grab window (SlurpRuntime.attacking) */
  attacking: boolean;
  /** ATTACK wind-up progress 0..1 (the telegraph before the lunge); 0 outside ATTACK */
  windup: number;
  stunned: boolean;
  slowed: boolean;
  distracted: boolean;
  suspicion: number;
  /** yaw of a point of interest relative to the body (lure / last known); null = none */
  lookYaw: number | null;
  bodyYaw: number;
  fade: number;
  reduced: boolean;
  /** 0 = just clawing out of the ground (crawling pose) .. 1 = standing (spawn effect) */
  emerge: number;
  /** 0..1 slumping back into the fog (despawn effect) */
  sink: number;
  /** cutscene override: arms thrown toward the camera (0..1) */
  reach?: number;
  /** cutscene override: jaw opening 0..1.2 (null / undefined = from the mode) */
  jaw?: number | null;
}

export interface SlurpLook { eyeColor: THREE.Color; eyeScale: number }

const BONES: BoneDef[] = [
  { name: 'pelvis', parent: null, at: [0, 0.98, 0] },
  { name: 'spine', parent: 'pelvis', at: [0, 1.2, 0] },
  { name: 'chest', parent: 'spine', at: [0, 1.42, 0] },
  { name: 'neck', parent: 'chest', at: [0, 1.6, 0.01] },
  { name: 'head', parent: 'neck', at: [0, 1.7, 0.02] },
  { name: 'jaw', parent: 'head', at: [0, 1.66, -0.03] },
];
for (const [n, s] of [['L', -1], ['R', 1]] as const) {
  BONES.push(
    { name: 'sh' + n, parent: 'chest', at: [s * 0.2, 1.54, 0] },
    { name: 'el' + n, parent: 'sh' + n, at: [s * 0.245, 1.18, 0.02] },
    { name: 'hand' + n, parent: 'el' + n, at: [s * 0.265, 0.82, 0.0] },
    { name: 'fing' + n, parent: 'hand' + n, at: [s * 0.265, 0.74, -0.01] },
    { name: 'hip' + n, parent: 'pelvis', at: [s * 0.11, 0.96, 0] },
    { name: 'knee' + n, parent: 'hip' + n, at: [s * 0.11, 0.53, -0.02] },
    { name: 'foot' + n, parent: 'knee' + n, at: [s * 0.11, 0.08, 0] },
  );
}
for (const [n, x] of [['L', -1], ['C', 0], ['R', 1]] as const) {
  BONES.push(
    { name: 'rg' + n + '1', parent: 'pelvis', at: [x * 0.15, 0.96, 0.02] },
    { name: 'rg' + n + '2', parent: 'rg' + n + '1', at: [x * 0.19, 0.64, 0.03] },
  );
}

const JACKET = '#1c2022', JACKET_HI = '#2a3033', JACKET_LO = '#111416', SHIRT = '#555349', TROUSER = '#171a1e', TROUSER_HI = '#21262b', RAG = '#202528', RAG_LO = '#14171a';
const SKIN = '#96ab98', SKIN_HI = '#adc2ad', SKIN_LO = '#6d8274', SOCKET = '#16201c', GUM = '#2a1519', TOOTH = '#cdd0b4', TONGUE = '#3d2125', HAIR = '#1d201e', NAIL = '#3e4a40';

function buildBody(): THREE.BufferGeometry {
  const sb = new SkinBuilder(BONES.map((b) => b.name));
  const rand = mulberry32(5150);
  const jit = (c: string, a = 0.05): THREE.Color => new THREE.Color(c).multiplyScalar(1 + (rand() - 0.5) * 2 * a);

  // ---- torso: narrow, gaunt, a torn dark jacket over a grey shirt; shoulder blades and a hump under the jacket
  limbTube(sb, [[0, 0.98, 0], [0, 1.2, 0], [0, 1.42, 0], [0, 1.6, 0.01]], ['pelvis', 'spine', 'chest'], [
    { s: 0, rx: 0.145, ry: 0.095, c: JACKET_LO }, { s: 0.22, rx: 0.125, ry: 0.088, c: JACKET }, { s: 0.38, rx: 0.15, ry: 0.1, c: JACKET },
    { s: 0.5, rx: 0.19, ry: 0.11, c: JACKET_HI }, { s: 0.58, rx: 0.2, ry: 0.105, c: JACKET_HI }, { s: 0.62, rx: 0.075, ry: 0.07, c: SHIRT },
  ], { bl: 0.1, seg: 9, side0: [1, 0, 0], bottomDark: 0.25 });
  // hip skirt of the jacket (the rag mesh hangs below it)
  limbTube(sb, [[0, 1.0, 0], [0, 0.7, 0]], ['pelvis'], [{ s: 0, rx: 0.15, ry: 0.1, c: JACKET }, { s: 0.15, rx: 0.19, ry: 0.125, c: JACKET_LO }, { s: 0.3, rx: 0.2, ry: 0.13, c: RAG_LO }], { seg: 9, side0: [1, 0, 0], bottomDark: 0.35 });
  sb.blob([0, 1.5, 0.095], [0.13, 0.15, 0.085], w1('chest'), jit(JACKET_HI), { rot: [0.25, 0, 0], nu: 8, nv: 6, bottomDark: 0.3 }); // hunch hump
  for (const s of [-1, 1]) sb.blob([s * 0.1, 1.46, 0.08], [0.07, 0.11, 0.05], w1('chest'), jit(JACKET), { rot: [0.2, 0, s * 0.2], nu: 6, nv: 5 }); // shoulder blades
  // open collar: a strip of grey shirt and the grey-green chest between the torn lapels
  sb.blob([0, 1.45, -0.095], [0.05, 0.14, 0.02], w1('chest'), jit(SHIRT, 0.04), { nu: 5, nv: 5, bottomDark: 0.1 });
  sb.blob([0, 1.56, -0.085], [0.07, 0.05, 0.03], w1('chest'), jit(SKIN_LO), { nu: 6, nv: 4 });
  // belt rag
  limbTube(sb, [[0, 1.02, 0], [0, 1.08, 0]], ['pelvis'], [{ s: 0, rx: 0.15, ry: 0.1, c: JACKET_LO }, { s: 0.06, rx: 0.15, ry: 0.1, c: JACKET_LO }], { seg: 9, side0: [1, 0, 0], bottomDark: 0 });

  // ---- neck: long, cord-thin
  limbTube(sb, [[0, 1.6, 0.01], [0, 1.7, 0.02]], ['neck', 'head'], [{ s: 0, rx: 0.052, c: SKIN_LO }, { s: 0.1, rx: 0.046, c: SKIN_LO }], { seg: 6, bl: 0.03 });
  for (const s of [-1, 1]) sb.blob([s * 0.025, 1.64, -0.025], [0.008, 0.045, 0.008], w1('neck'), jit(SKIN_HI, 0.03), { nu: 4, nv: 4 }); // tendons

  // ---- head: long skull, hollow cheeks, deep sockets, flat nose, an enormous mouth
  const H = w1('head');
  sb.blob([0, 1.75, 0.015], [0.088, 0.122, 0.1], H, jit(SKIN), { nu: 10, nv: 7, bottomDark: 0.18 }); // skull
  sb.blob([0, 1.8, -0.018], [0.07, 0.04, 0.07], H, jit(SKIN_HI, 0.03), { nu: 8, nv: 4, bottomDark: 0 }); // forehead ridge
  sb.blob([0, 1.76, -0.073], [0.082, 0.02, 0.03], H, jit(SKIN_LO), { nu: 8, nv: 4 }); // heavy brow
  sb.blob([0, 1.665, -0.055], [0.06, 0.036, 0.05], H, jit(SKIN), { nu: 8, nv: 5 }); // upper jaw
  for (const s of [-1, 1]) {
    sb.blob([s * 0.04, 1.745, -0.078], [0.03, 0.028, 0.024], H, new THREE.Color(SOCKET), { nu: 7, nv: 5, bottomDark: 0 }); // sunken sockets
    sb.blob([s * 0.062, 1.693, -0.06], [0.024, 0.05, 0.03], H, jit(SKIN_LO), { nu: 6, nv: 4, bottomDark: 0.1 }); // hollow cheeks
    sb.blob([s * 0.093, 1.725, 0.015], [0.012, 0.034, 0.022], H, jit(SKIN), { nu: 5, nv: 4 }); // ears
    sb.cone([s * 0.1, 1.745, 0.01], [s * 0.112, 1.8, 0.0], 0.016, H, SKIN_LO, { seg: 4, rBase2: 0.01 }); // pointed ear tips
  }
  sb.cone([0, 1.72, -0.098], [0, 1.69, -0.128], 0.018, H, SKIN_LO, { seg: 4, rBase2: 0.012 }); // flattened nose
  // mouth: a dark cavity (shared by head + jaw), upper and lower tooth rows, a tongue
  const MJ = wMix('head', 'jaw', 0.5);
  sb.blob([0, 1.652, -0.052], [0.056, 0.024, 0.04], MJ, new THREE.Color(GUM), { nu: 8, nv: 5, bottomDark: 0 });
  for (let i = 0; i < 9; i++) {
    const u = (i - 4) / 4;
    const x = u * 0.052, z = -0.086 + Math.abs(u) * 0.032;
    sb.cone([x, 1.655, z], [x * 1.02, 1.623 - (i % 2) * 0.006, z - 0.004], 0.0058, H, TOOTH, { seg: 3, dark: 0.95 });
  }
  sb.blob([0, 1.618, -0.035], [0.056, 0.045, 0.034], H, new THREE.Color(GUM), { nu: 8, nv: 5, bottomDark: 0 }); // the dark throat behind the teeth (seen when the jaw drops)
  const J = w1('jaw');
  sb.blob([0, 1.628, -0.05], [0.05, 0.022, 0.055], J, jit(SKIN), { nu: 8, nv: 5 }); // lower jaw
  sb.blob([0, 1.6, -0.075], [0.026, 0.026, 0.026], J, jit(SKIN_LO), { nu: 6, nv: 4 }); // chin
  sb.blob([0, 1.644, -0.05], [0.04, 0.012, 0.042], J, new THREE.Color(TONGUE), { nu: 6, nv: 4, bottomDark: 0 }); // tongue / floor of the mouth
  for (let i = 0; i < 8; i++) {
    const u = (i - 3.5) / 3.5;
    const x = u * 0.044, z = -0.083 + Math.abs(u) * 0.034;
    sb.cone([x, 1.636, z], [x, 1.664 + (i % 2) * 0.004, z - 0.002], 0.0052, J, TOOTH, { seg: 3, dark: 0.9 });
  }
  // lank, greasy hair: a few strands over the skull and hanging at the back
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + 0.3;
    const rx = Math.cos(a) * 0.07, rz = Math.sin(a) * 0.075 + 0.03;
    if (rz < 0.0) continue;
    sb.cone([rx, 1.79 - Math.abs(Math.sin(a)) * 0.02, rz], [rx * 1.1, 1.79 - 0.1 - (i % 3) * 0.03, rz + 0.05], 0.009, H, HAIR, { seg: 3, dark: 0.9 + (i % 2) * 0.12 });
  }
  sb.blob([0, 1.8, 0.04], [0.085, 0.06, 0.085], H, new THREE.Color(HAIR), { nu: 8, nv: 5, bottomDark: 0.1 });

  // ---- arms: ragged sleeves to the elbow, bare grey-green forearms, long bony hands
  for (const [n, s] of [['L', -1], ['R', 1]] as const) {
    const S: V3 = [s * 0.2, 1.54, 0], E: V3 = [s * 0.245, 1.18, 0.02], W: V3 = [s * 0.265, 0.82, 0.0];
    limbTube(sb, [S, E, W], ['sh' + n, 'el' + n], [
      { s: 0, rx: 0.062, c: JACKET_HI }, { s: 0.18, rx: 0.054, c: JACKET }, { s: 0.34, rx: 0.046, c: JACKET }, { s: 0.4, rx: 0.052, c: RAG_LO }, { s: 0.43, rx: 0.036, c: SKIN_LO },
      { s: 0.55, rx: 0.034, c: SKIN }, { s: 0.7, rx: 0.03, c: SKIN }, { s: 0.74, rx: 0.026, c: SKIN_LO },
    ], { bl: 0.07, seg: 7, capStart: true });
    for (let i = 0; i < 3; i++) { // ragged sleeve ends
      const a = (i / 3) * Math.PI * 2 + (s > 0 ? 0.4 : 1.1);
      sb.cone([s * 0.245 + Math.cos(a) * 0.04, 1.2, 0.02 + Math.sin(a) * 0.04], [s * 0.245 + Math.cos(a) * 0.05, 1.1 - i * 0.02, 0.02 + Math.sin(a) * 0.05], 0.02, w1('el' + n), RAG, { seg: 3 });
    }
    sb.blob([s * 0.245, 1.185, -0.02], [0.034, 0.036, 0.032], w1('el' + n), jit(SKIN_HI, 0.03), { nu: 6, nv: 4 }); // bony elbow
    const HD = w1('hand' + n);
    sb.blob([s * 0.265, 0.79, 0.0], [0.034, 0.055, 0.018], HD, jit(SKIN), { nu: 6, nv: 5 }); // palm
    for (let i = 0; i < 4; i++) {
      const x = s * 0.265 + (i - 1.5) * 0.017;
      const len = 0.15 - Math.abs(i - 1.5) * 0.02;
      sb.cone([x, 0.745, 0.0], [x + (i - 1.5) * 0.004, 0.745 - len, -0.012], 0.0085, HD, i % 2 ? SKIN_LO : SKIN, { seg: 4, tipW: w1('fing' + n) });
      sb.cone([x + (i - 1.5) * 0.004, 0.745 - len, -0.012], [x + (i - 1.5) * 0.005, 0.745 - len - 0.03, -0.022], 0.0055, w1('fing' + n), NAIL, { seg: 3 });
    }
    sb.cone([s * 0.235, 0.78, -0.012], [s * 0.226, 0.69, -0.04], 0.01, HD, SKIN_LO, { seg: 4 }); // thumb
  }
  // ---- legs: torn trousers to mid-calf, bare grey-green shins, bare feet with long toes
  for (const [n, s] of [['L', -1], ['R', 1]] as const) {
    const Hh: V3 = [s * 0.11, 0.96, 0], K: V3 = [s * 0.11, 0.53, -0.02], A: V3 = [s * 0.11, 0.08, 0];
    limbTube(sb, [Hh, K, A], ['hip' + n, 'knee' + n], [
      { s: 0, rx: 0.088, c: TROUSER_HI }, { s: 0.2, rx: 0.082, c: TROUSER }, { s: 0.4, rx: 0.058, c: TROUSER }, { s: 0.5, rx: 0.052, c: TROUSER }, { s: 0.58, rx: 0.056, c: RAG_LO },
      { s: 0.63, rx: 0.04, c: SKIN_LO }, { s: 0.75, rx: 0.036, c: SKIN }, { s: 0.88, rx: 0.03, c: SKIN_LO }, { s: 0.9, rx: 0.036, c: SKIN_LO },
    ], { bl: 0.08, seg: 7, capStart: true });
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2 + n.length + (s > 0 ? 0.7 : 0);
      sb.cone([s * 0.11 + Math.cos(a) * 0.056, 0.5, -0.02 + Math.sin(a) * 0.056], [s * 0.11 + Math.cos(a) * 0.07, 0.4 - i * 0.03, -0.02 + Math.sin(a) * 0.07], 0.022, w1('knee' + n), RAG, { seg: 3 });
    }
    sb.blob([s * 0.11, 0.53, -0.062], [0.04, 0.04, 0.03], w1('knee' + n), jit(SKIN_HI, 0.03), { nu: 6, nv: 4 }); // knobbly knee through the tear
    const FF = w1('foot' + n);
    limbTube(sb, [[s * 0.11, 0.075, 0.05], [s * 0.11, 0.045, -0.1], [s * 0.11, 0.032, -0.18]], ['foot' + n], [{ s: 0, rx: 0.036, ry: 0.04, c: SKIN_LO }, { s: 0.15, rx: 0.044, ry: 0.036, c: SKIN }, { s: 0.25, rx: 0.04, ry: 0.026, c: SKIN }], { seg: 6, side0: [1, 0, 0], capEnd: true, bl: 0.01 });
    for (let i = 0; i < 4; i++) sb.cone([s * 0.11 + (i - 1.5) * 0.02, 0.034, -0.17], [s * 0.11 + (i - 1.5) * 0.024, 0.02, -0.235], 0.0085, FF, SKIN_LO, { seg: 3 });
  }
  return sb.build();
}

/** Tatters: a ragged skirt of jacket strips hanging from the waist, swinging on three two-bone chains. */
function buildRags(): THREE.BufferGeometry {
  const sb = new SkinBuilder(BONES.map((b) => b.name));
  const nu = 14, nv = 5;
  const rand = mulberry32(777);
  const holes = new Set<number>();
  for (let j = 2; j < nv; j++) for (let i = 0; i < nu; i++) if (rand() < 0.12 + (j - 2) * 0.16) holes.add(j * nu + i);
  const lenK = [1, 0.7, 0.95, 0.6, 0.85, 0.75, 1, 0.65, 0.9, 0.6, 0.95, 0.7, 0.85, 0.62, 1];
  const js = [0, 0.34];
  sb.grid(nu, nv, (i, j) => {
    const a = (i / nu) * Math.PI * 2;
    const v = j / nv;
    const len = v > 0.55 ? lerp(1, lenK[i], (v - 0.55) / 0.45) : 1;
    const y = 1.0 - v * 0.46 * len;
    const rr = 0.165 + 0.08 * v;
    const x = Math.sin(a) * rr * 1.05, z = Math.cos(a) * rr * 0.78;
    const side = x < -0.05 ? 'L' : x > 0.05 ? 'R' : 'C';
    const wc: [string, number][] = side === 'L' ? [['L', 1]] : side === 'R' ? [['R', 1]] : [['C', 1]];
    const wr = chainWeights(['1', '2'], js, v * 0.46, 0.08);
    const w: Weights = [];
    for (const [c, k] of wc) for (const [r, b] of wr) if (k * b > 0.01) w.push(['rg' + c + r, k * b]);
    const col = v > 0.5 ? RAG_LO : v > 0.2 ? RAG : JACKET_LO;
    return { p: [x, y, z], w, c: col, dark: 0.85 + 0.3 * Math.abs(Math.sin(i * 1.9 + v * 2)) };
  }, (i, j) => holes.has(j * nu + i));
  return sb.build();
}

interface PoseP { lean: number; headYaw: number; headPitch: number; headRoll: number; jaw: number; crouch: number; armL: number; armR: number; elbow: number; curl: number; spread: number; raise: number; move: number; shake: number }

interface LegRt { ik: IkLimb; s: number; off: number; pos: THREE.Vector3; pole: THREE.Vector3; qf: THREE.Quaternion; qd: THREE.Quaternion; base: THREE.Vector3 }

const _v = new THREE.Vector3(), _e = new THREE.Euler();
const ez = (a: number, b: number, c: number, o: THREE.Euler['order'] = 'XYZ'): THREE.Euler => _e.set(a, b, c, o);

export class SlurpRig {
  readonly root = new THREE.Group();
  readonly look: SlurpLook = { eyeColor: new THREE.Color(SLURP_EYE), eyeScale: 1 };
  readonly headWorld = new THREE.Vector3();
  readonly chestWorld = new THREE.Vector3();
  readonly eyeL = new THREE.Vector3();
  readonly eyeR = new THREE.Vector3();
  readonly handL = new THREE.Vector3();
  readonly handR = new THREE.Vector3();
  readonly mouthWorld = new THREE.Vector3();
  readonly triangles: number;
  private readonly rig: Rig;
  private readonly body: THREE.SkinnedMesh;
  private readonly rags: THREE.SkinnedMesh;
  private readonly geo: THREE.BufferGeometry;
  private readonly ragGeo: THREE.BufferGeometry;
  private readonly eyeGeo = new THREE.SphereGeometry(0.021, 7, 5);
  private readonly mat: THREE.MeshLambertMaterial;
  private readonly ragMat: THREE.MeshLambertMaterial;
  private readonly eyeMat: THREE.MeshBasicMaterial;
  private readonly eyes = new THREE.Group();
  private readonly legs: LegRt[] = [];
  private readonly rnd = mulberry32(90210);
  private phase = 0;
  private frost = 0;
  private shock = 0;
  private yawSm = 0;
  private yawInit = false;
  private chaseK = 0;
  private twT = 1.2;
  private twK = 0;
  private twDir = 1;
  private twKind = 0;
  private lurch = 0;
  private readonly P: PoseP = { lean: 0.4, headYaw: 0, headPitch: 0, headRoll: 0, jaw: 0.3, crouch: 0, armL: 0.3, armR: 0.3, elbow: 0.4, curl: 0.3, spread: 0.1, raise: 0, move: 0, shake: 0 };

  constructor() {
    this.rig = new Rig(BONES);
    this.geo = buildBody();
    this.ragGeo = buildRags();
    this.triangles = (this.geo.index?.count ?? 0) / 3 + (this.ragGeo.index?.count ?? 0) / 3;
    const rimHook = (m: THREE.MeshLambertMaterial): void => {
      m.onBeforeCompile = (sh) => {
        sh.fragmentShader = sh.fragmentShader.replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n\tfloat rimS = pow(1.0 - saturate(dot(normalize(normal), normalize(vViewPosition))), 2.4);\n\ttotalEmissiveRadiance += vec3(0.028, 0.05, 0.04) * rimS;');
      };
    };
    this.mat = new THREE.MeshLambertMaterial({ vertexColors: true, emissive: new THREE.Color(0.006, 0.01, 0.008) });
    this.ragMat = new THREE.MeshLambertMaterial({ vertexColors: true, emissive: new THREE.Color(0.004, 0.006, 0.005), side: THREE.DoubleSide });
    rimHook(this.mat); rimHook(this.ragMat);
    this.body = new THREE.SkinnedMesh(this.geo, this.mat);
    this.root.add(this.body);
    this.rig.bind(this.body);
    this.rags = new THREE.SkinnedMesh(this.ragGeo, this.ragMat);
    this.root.add(this.rags);
    this.rig.bindShared(this.rags);
    this.eyeMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(SLURP_EYE), fog: false });
    for (const s of [-1, 1]) {
      const m = new THREE.Mesh(this.eyeGeo, this.eyeMat);
      m.position.set(s * 0.04, 1.745 - 1.7, -0.118);
      m.scale.set(1.2, 0.95, 0.8);
      this.eyes.add(m);
    }
    this.rig.b('head').add(this.eyes);
    for (const [n, s, off] of [['L', -1, 0], ['R', 1, 0.5]] as const) {
      const ik = makeLimb(this.rig, 'hip' + n, 'knee' + n, 'foot' + n);
      const base = this.rig.r('foot' + n).clone();
      this.legs.push({ ik, s, off, base, pos: base.clone(), pole: new THREE.Vector3(0, 0, -1), qf: new THREE.Quaternion(), qd: new THREE.Quaternion() });
    }
  }

  /** Mode body language -> target pose parameters. */
  private targets(f: SlurpFrame, t: PoseP): void {
    const T = f.clock;
    t.lean = 0.4; t.headYaw = 0; t.headPitch = -0.1; t.headRoll = 0.2; t.jaw = 0.32; t.crouch = 0.03; t.armL = 0.32; t.armR = 0.26; t.elbow = 0.45; t.curl = 0.35; t.spread = 0.12; t.raise = 0; t.shake = 0;
    const still = f.speed < 0.15;
    switch (f.mode) {
      case 'WANDER':
        // slack, aimless: head lolls to one side and slowly swings, mouth hanging open, arms trailing forward
        t.lean = 0.38; t.headRoll = 0.3 + Math.sin(T * 0.5) * 0.12; t.headYaw = Math.sin(T * (still ? 0.55 : 0.33)) * (still ? 0.9 : 0.4); t.headPitch = -0.16; t.jaw = 0.34 + Math.sin(T * 1.1) * 0.06;
        break;
      case 'INVESTIGATE':
        // heard something: head cocked, nostrils working, one hand lifted
        t.lean = 0.3; t.headRoll = 0.5 + Math.sin(T * 2.1) * 0.06; t.headPitch = 0.1 + Math.sin(T * 5.5) * 0.07; t.jaw = 0.55 + Math.max(0, Math.sin(T * 5.5)) * 0.15; t.armR = 0.9; t.elbow = 1.0; t.curl = 0.8; t.crouch = 0.05;
        break;
      case 'SEARCH':
        // bent double, sweeping the dark: slow head scan, arms dragging low
        t.lean = 0.62; t.headYaw = Math.sin(T * 1.05) * 1.15; t.headPitch = -0.05; t.headRoll = 0.25; t.jaw = 0.46; t.armL = 0.18; t.armR = 0.18; t.elbow = 0.3; t.crouch = 0.1;
        break;
      case 'CHASE':
        // a hunched, lurching charge: head thrown forward, jaw wide, arms flung out ahead
        t.lean = 0.78; t.headPitch = 0.6; t.headRoll = Math.sin(T * 6) * 0.1; t.jaw = 0.95 + Math.sin(T * 8) * 0.08; t.armL = 1.1; t.armR = 1.05; t.elbow = 0.55; t.curl = 0.95; t.crouch = 0.1; t.spread = 0.2;
        break;
      case 'ATTACK':
        if (f.attacking) {
          t.lean = 1.0; t.headPitch = 0.45; t.jaw = 1.15; t.armL = 1.75; t.armR = 1.7; t.elbow = 0.1; t.curl = 1.0; t.crouch = 0.05; t.spread = 0.18; t.headRoll = 0;
        } else {
          // telegraph: rears up, head back, mouth gaping, arms hooked wide; trembles harder as the lunge nears
          const w = clamp(f.windup, 0, 1);
          t.lean = lerp(0.3, -0.18, w); t.headPitch = lerp(0.1, 0.65, w); t.jaw = lerp(0.6, 1.2, w); t.armL = lerp(0.5, 1.05, w); t.armR = lerp(0.5, 1.0, w); t.elbow = lerp(0.6, 1.25, w); t.curl = 1.0; t.spread = lerp(0.2, 0.7, w); t.crouch = lerp(0, 0.22, w); t.shake = 0.3 + w * 0.7; t.headRoll = 0;
        }
        break;
      case 'LEAVE':
        // turns away, shoulders slumped, head low
        t.lean = 0.5; t.headPitch = -0.38; t.headRoll = 0.15; t.jaw = 0.22; t.armL = 0.2; t.armR = 0.15; t.elbow = 0.25; t.curl = 0.2; t.crouch = 0.05;
        break;
    }
    if (f.distracted && f.mode !== 'ATTACK') { t.headYaw = f.lookYaw !== null ? clamp(f.lookYaw, -1.2, 1.2) : Math.sin(T * 1.4) * 0.8; t.headRoll = 0.4 * Math.sin(T * 2.2); }
    else if (f.lookYaw !== null && f.mode !== 'CHASE' && f.mode !== 'ATTACK' && f.mode !== 'WANDER') t.headYaw = clamp(f.lookYaw, -1.0, 1.0) * 0.85 + t.headYaw * 0.2;
    if (f.stunned) { t.lean = 0.55; t.headPitch = -0.5; t.headRoll = 0.45; t.jaw = 0.5; t.armL = 0.1; t.armR = 0.1; t.elbow = 0.2; t.curl = 0.1; t.shake = 0.5; t.crouch = 0.08; }
    // spawn: clawing up out of the ground; despawn: slumping back down
    const crawl = 1 - smoothstep(0.28, 0.95, f.emerge);
    if (crawl > 0.001) {
      t.lean = lerp(t.lean, 1.25, crawl); t.crouch = lerp(t.crouch, 0.5, crawl); t.armL = lerp(t.armL, 2.3, crawl); t.armR = lerp(t.armR, 2.1, crawl); t.elbow = lerp(t.elbow, 0.2, crawl);
      t.headPitch = lerp(t.headPitch, 0.75, crawl); t.jaw = lerp(t.jaw, 0.7, crawl); t.curl = lerp(t.curl, 1, crawl); t.spread = lerp(t.spread, 0.35, crawl);
    }
    if (f.sink > 0.001) {
      t.lean = lerp(t.lean, 0.95, f.sink); t.headPitch = lerp(t.headPitch, -0.7, f.sink); t.armL = lerp(t.armL, 0.1, f.sink); t.armR = lerp(t.armR, 0.1, f.sink); t.elbow = lerp(t.elbow, 0.15, f.sink); t.crouch = lerp(t.crouch, 0.25, f.sink); t.jaw = lerp(t.jaw, 0.15, f.sink);
    }
    if (f.reach !== undefined && f.reach > 0) {
      const r = f.reach;
      t.armL = lerp(t.armL, 1.7, r); t.armR = lerp(t.armR, 1.65, r); t.elbow = lerp(t.elbow, 0.08, r); t.curl = lerp(t.curl, 1, r); t.spread = lerp(t.spread, 0.1, r);
    }
    if (f.jaw !== undefined && f.jaw !== null) t.jaw = f.jaw;
  }

  update(f: SlurpFrame): void {
    const dt = f.dt;
    if (!this.yawInit) { this.yawSm = f.bodyYaw; this.yawInit = true; }
    this.frost = damp(this.frost, f.slowed ? 1 : 0, 4, dt);
    this.shock = damp(this.shock, f.stunned ? 1 : 0, 10, dt);
    const fl = this.shock * (0.5 + 0.5 * Math.sin(f.clock * 38)) * 0.28;
    for (const m of [this.mat, this.ragMat]) {
      m.color.setRGB(lerp(1, 0.85, this.frost), 1, lerp(1, 1.2, this.frost));
      m.emissive.setRGB(0.006 + this.frost * 0.03 + fl * 0.5, 0.01 + this.frost * 0.14 + fl * 0.5, 0.008 + this.frost * 0.24 + fl * 0.6);
      const fade = clamp(f.fade, 0, 1);
      const wantT = fade > 0.03;
      if (m.transparent !== wantT) { m.transparent = wantT; m.needsUpdate = true; }
      m.opacity = 1 - 0.7 * fade;
      m.depthWrite = fade < 0.4;
    }

    const P = this.P;
    const t = { lean: 0, headYaw: 0, headPitch: 0, headRoll: 0, jaw: 0, crouch: 0, armL: 0, armR: 0, elbow: 0, curl: 0, spread: 0, raise: 0, move: 0, shake: 0 };
    this.targets(f, t);
    const attackNow = f.mode === 'ATTACK';
    const k = 1 - Math.exp(-(attackNow ? 14 : 6) * dt);
    P.lean = lerp(P.lean, t.lean, k); P.headYaw = lerp(P.headYaw, t.headYaw, 1 - Math.exp(-(attackNow ? 14 : 5) * dt)); P.headPitch = lerp(P.headPitch, t.headPitch, k); P.headRoll = lerp(P.headRoll, t.headRoll, k);
    P.jaw = lerp(P.jaw, t.jaw, 1 - Math.exp(-(attackNow ? 16 : 7) * dt)); P.crouch = lerp(P.crouch, t.crouch, k);
    P.armL = lerp(P.armL, t.armL, k); P.armR = lerp(P.armR, t.armR, k); P.elbow = lerp(P.elbow, t.elbow, k); P.curl = lerp(P.curl, t.curl, k); P.spread = lerp(P.spread, t.spread, k);
    P.shake = lerp(P.shake, t.shake, k);
    this.chaseK = damp(this.chaseK, f.mode === 'CHASE' || (attackNow && f.attacking) ? 1 : 0, 5, dt);

    // twitches: random short jerks (head snap, shoulder shrug, finger curl) - none under reduced motion except a mild head tilt
    this.twT -= dt;
    if (this.twT <= 0) {
      this.twT = (f.mode === 'CHASE' ? 0.5 : 0.7) + this.rnd() * 2.4;
      this.twK = 1; this.twDir = this.rnd() < 0.5 ? -1 : 1; this.twKind = Math.floor(this.rnd() * 3);
    }
    this.twK = damp(this.twK, 0, 9, dt);

    const sp = f.stunned ? 0 : f.speed;
    P.move = damp(P.move, clamp(sp / 0.7, 0, 1), 8, dt);
    // lurching cadence: the stride surges, then stalls (the phase rate swings between ~0.15x and ~1.9x)
    const slowK = f.slowed ? 0.85 : 1;
    const baseRate = (0.32 + sp * 0.3) * lerp(1, 1.25, this.chaseK);
    this.lurch += dt * (f.mode === 'CHASE' ? 3.4 : 2.2);
    const surge = 1 + 0.85 * Math.sin(this.lurch * Math.PI * 2 * 0.5 + Math.sin(this.lurch * 0.7));
    this.phase = (this.phase + dt * baseRate * Math.max(0.12, surge) * slowK * (sp > 0.05 ? 1 : 0)) % 1;

    let d = f.bodyYaw - this.yawSm;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    this.yawSm += d * (1 - Math.exp(-(f.mode === 'CHASE' ? 10 : 6) * dt));
    this.root.rotation.y = this.yawSm;
    this.root.scale.setScalar(1);
    this.pose(f);

    const L = this.look;
    let col = SLURP_EYE, es = 1;
    if (f.mode === 'CHASE' || f.mode === 'ATTACK') { col = SLURP_EYE_HI; es = 1.55; }
    else if (f.mode === 'INVESTIGATE' || f.mode === 'SEARCH') { col = '#f3dcf7'; es = 1.15; }
    else if (f.mode === 'LEAVE') { col = '#c9a6d2'; es = 0.8; }
    if (f.distracted) col = '#c9a2ff';
    if (f.stunned) col = Math.sin(f.clock * 30) > 0 ? '#aee8ff' : '#ffffff';
    if (f.slowed) col = '#8fd8ff';
    L.eyeColor.set(col); L.eyeScale = es;
    this.eyeMat.color.set(col);

    this.root.updateMatrixWorld(true);
    this.rig.b('head').getWorldPosition(this.headWorld);
    this.rig.b('chest').getWorldPosition(this.chestWorld);
    this.rig.b('handL').getWorldPosition(this.handL);
    this.rig.b('handR').getWorldPosition(this.handR);
    for (const s of [-1, 1]) {
      _v.set(s * 0.04, 1.745 - 1.7, -0.13);
      this.rig.b('head').localToWorld(_v);
      (s < 0 ? this.eyeL : this.eyeR).copy(_v);
    }
    _v.set(0, 1.652 - 1.7, -0.08);
    this.rig.b('head').localToWorld(_v);
    this.mouthWorld.copy(_v);
  }

  private pose(f: SlurpFrame): void {
    const R = this.rig, P = this.P, T = f.clock;
    const mv = P.move;
    const ph = this.phase * Math.PI * 2;
    const calm = f.reduced;
    const tw = calm ? 0 : this.twK;
    const tr = (this.shock * Math.sin(T * 55) * 0.012) + P.shake * (calm ? 0.3 : 1) * Math.sin(T * 47) * 0.006;
    const breath = Math.sin(T * 1.6) * 0.014;
    const pel = R.b('pelvis'), spi = R.b('spine'), che = R.b('chest'), nec = R.b('neck'), hed = R.b('head'), jaw = R.b('jaw');
    const bobY = Math.abs(Math.sin(ph)) * 0.05 * mv * (1 + this.chaseK) - P.crouch * 0.55;
    const L = P.lean;
    // a dipping, uneven gait: the pelvis sinks on the dragging (left) side
    pel.position.set(tr + Math.sin(ph) * 0.02 * mv, R.r('pelvis').y + bobY, 0);
    pel.quaternion.setFromEuler(ez(-L * 0.22, -Math.sin(ph) * 0.14 * mv, Math.sin(ph) * 0.07 * mv + (tw && this.twKind === 1 ? this.twDir * 0.06 * tw : 0)));
    spi.quaternion.setFromEuler(ez(-L * 0.3 + breath, Math.sin(ph) * 0.12 * mv + (this.twKind === 1 ? this.twDir * 0.1 * tw : 0), -Math.sin(ph) * 0.05 * mv));
    che.quaternion.setFromEuler(ez(-L * 0.3 + breath * 0.6, Math.sin(ph) * 0.1 * mv, (this.twKind === 1 ? this.twDir * 0.12 * tw : 0)));
    nec.quaternion.setFromEuler(ez(-L * 0.2 + P.headPitch * 0.35 + (this.twKind === 0 ? -0.12 * tw : 0), P.headYaw * 0.45 + (this.twKind === 0 ? this.twDir * 0.35 * tw : 0), P.headRoll * 0.45, 'YXZ'));
    hed.quaternion.setFromEuler(ez(L * 0.3 + P.headPitch * 0.65 + (this.twKind === 0 ? 0.1 * tw : 0), P.headYaw * 0.55 + (this.twKind === 0 ? this.twDir * 0.4 * tw : 0), P.headRoll * 0.55 + (this.twKind === 0 ? this.twDir * 0.22 * tw : 0), 'YXZ'));
    jaw.quaternion.setFromEuler(ez(-P.jaw - (this.twKind === 2 ? 0.2 * tw : 0), 0, 0));
    for (const b of [pel, spi, che, nec, hed, jaw]) b.updateMatrix();

    // ---- arms (FK): dangling forward with a heavy sway; the swing opposes the legs; spread = out to the sides
    const swingA = Math.sin(ph) * 0.22 * mv * (1 + this.chaseK * 1.4);
    const idle = Math.sin(T * 1.1) * 0.05 + Math.sin(T * 0.43) * 0.04;
    for (const [n, s] of [['L', -1], ['R', 1]] as const) {
      const base = n === 'L' ? P.armL : P.armR;
      const sw = (n === 'L' ? swingA : -swingA);
      const shrug = this.twKind === 1 ? this.twDir * 0.25 * tw : 0;
      R.b('sh' + n).quaternion.setFromEuler(ez(base + sw + idle * (n === 'L' ? 1 : -1) + (this.twKind === 1 ? 0.12 * tw : 0), 0, s * (0.08 + P.spread * 0.9) + shrug * 0.1, 'ZXY'));
      R.b('el' + n).quaternion.setFromEuler(ez(P.elbow + Math.max(0, n === 'L' ? swingA : -swingA) * 0.7 + (n === 'R' ? Math.sin(T * 1.7) * 0.05 : 0), 0, 0));
      R.b('hand' + n).quaternion.setFromEuler(ez(0.12 + (this.twKind === 2 ? 0.3 * tw : 0), 0, 0));
      R.b('fing' + n).quaternion.setFromEuler(ez(P.curl * 0.9 + (this.twKind === 2 ? 0.5 * tw : 0) + Math.sin(T * 3 + s) * 0.08, 0, 0));
    }
    for (const n of ['shL', 'elL', 'handL', 'fingL', 'shR', 'elR', 'handR', 'fingR']) R.b(n).updateMatrix();

    // ---- legs (IK): short irregular steps; the left foot drags; no lift under the dragging foot
    const chase = this.chaseK;
    const duty = 0.62;
    const rate = (0.32 + f.speed * 0.3) * lerp(1, 1.25, chase);
    for (const Lg of this.legs) {
      const drag = Lg.s < 0 ? 1 : 0;
      const u = (this.phase + Lg.off) % 1;
      const stride = Math.min(lerp(0.55, 1.15, chase), f.speed * duty / Math.max(0.2, rate)) * mv * (drag ? 0.75 : 1);
      let z: number, y = 0, pitch = 0;
      if (u < duty) { z = -stride / 2 + stride * (u / duty); }
      else {
        const v = (u - duty) / (1 - duty);
        const e = v * v * (3 - 2 * v);
        z = stride / 2 - stride * e;
        y = (drag ? 0.04 : 0.1 + 0.05 * chase) * Math.sin(v * Math.PI) * mv;
        pitch = (drag ? 0.5 : 0.25) * Math.sin(v * Math.PI) * mv;
      }
      Lg.pos.set(Lg.base.x * (drag ? 0.9 : 1.2), Lg.base.y + y, Lg.base.z + z);
      limbRoot(R, Lg.ik, _v);
      solveLimb(R, Lg.ik, Lg.pos, Lg.pole, Lg.qf);
      Lg.qd.setFromEuler(ez(pitch + (drag ? 0.12 : 0), drag ? 0.18 : -0.08, 0));
      orientEnd(Lg.ik.end, Lg.qf, Lg.qd);
    }
    // ---- rags: swing with the stride and lag behind
    const wob = calm ? 0.4 : 1;
    for (const [n, side] of [['L', -1], ['C', 0], ['R', 1]] as const) {
      for (let k = 1; k <= 2; k++) {
        const b = R.b('rg' + n + k);
        const lag = Math.sin(T * 2.3 - k * 1.0 + side * 0.9 + ph * 0.6 * mv) * 0.09 * wob * (0.6 + k * 0.5);
        b.quaternion.setFromEuler(ez(-0.05 * L + lag * (0.8 + mv) - Math.sin(ph) * 0.05 * mv, 0, side * (0.05 + 0.06 * k) + Math.sin(T * 1.4 + k + side) * 0.03 * wob, 'ZXY'));
        b.updateMatrix();
      }
    }
  }

  dispose(): void {
    this.geo.dispose(); this.ragGeo.dispose(); this.eyeGeo.dispose();
    this.mat.dispose(); this.ragMat.dispose(); this.eyeMat.dispose();
    this.rig.skeleton.dispose();
  }
}
