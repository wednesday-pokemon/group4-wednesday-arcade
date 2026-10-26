// The Hyde, rebuilt from the owner's statue photos: a silver-grey crouching creature, hunched far over its heavy shoulder girdle, lean
// ribbed torso, long thin arms ending in OVERSIZED clawed hands that plant on the ground, bent hind legs with clawed feet, a distorted head
// with bulging round eyes, a screaming toothy mouth and wild spiky hair. One skinned mesh (a single draw call) + one eye mesh.
// Locomotion is procedural: two-bone IK plants the hands and feet on the ground (knuckle-walk crawl; faster bounding gallop in CHASE; a lunge
// with the arms thrown forward during the grab wind-up). Models face -Z; ~3.7 m long, hump ~2.1 m high; root at ground level, body centred.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { HydeMode } from '../../mystery/types.ts';
import { clamp, damp, lerp, mulberry32 } from '../util.ts';
import { Rig, SkinBuilder, limbTube, makeLimb, orientEnd, solveLimb, limbRoot, w1, wMix, type BoneDef, type IkLimb, type V3, type Weights } from './rigKit.ts';

export interface HydeFrame {
  dt: number;
  clock: number;
  mode: HydeMode;
  speed: number;
  grabbing: boolean;
  stunned: boolean;
  petrified: boolean;
  /** held by a spectral pin / shackle: frozen like stone but keeps its colour, with a teal glow */
  pinned?: boolean;
  slowed: boolean;
  distracted: boolean;
  suspicion: number;
  /** direction (yaw, relative to the body) toward a point of interest for the head (lure / last known) */
  lookYaw: number | null;
  bodyYaw: number;
  fade: number;
  reduced: boolean;
}

export interface HydeLook {
  eyeColor: THREE.Color;
  eyeScale: number;
  lightIntensity: number;
}

const ZOFF = 0.3; // centres the body on the root
const SILVER = '#9a968f', SILVER_HI = '#bdb8ae', SILVER_LO = '#6c6965', CREV = '#2f2e33', CLAW = '#cfccc4', TOOTH = '#e6e2d4', MOUTH = '#1c1418', HAIR = '#5f5e61';

const BONES: BoneDef[] = [
  { name: 'pelvis', parent: null, at: [0, 2.15, 0.95] },
  { name: 'spine', parent: 'pelvis', at: [0, 2.15, 0.33] },
  { name: 'chest', parent: 'spine', at: [0, 2.1, -0.3] },
  { name: 'neck', parent: 'chest', at: [0, 2.12, -0.78] },
  { name: 'head', parent: 'neck', at: [0, 1.7, -1.32] },
  { name: 'jaw', parent: 'head', at: [0, 1.5, -1.52] },
  { name: 'hair', parent: 'head', at: [0, 1.86, -1.4] },
];
for (const [n, s] of [['L', -1], ['R', 1]] as const) {
  BONES.push(
    { name: 'sh' + n, parent: 'chest', at: [s * 0.7, 1.92, -0.55] },
    { name: 'el' + n, parent: 'sh' + n, at: [s * 0.95, 0.95, -0.75] },
    { name: 'hand' + n, parent: 'el' + n, at: [s * 0.78, 0.13, -1.5] },
    { name: 'fing' + n, parent: 'hand' + n, at: [s * 0.78, 0.12, -1.85] },
    { name: 'hip' + n, parent: 'pelvis', at: [s * 0.42, 2.1, 0.95] },
    { name: 'knee' + n, parent: 'hip' + n, at: [s * 0.62, 1.2, 0.42] },
    { name: 'foot' + n, parent: 'knee' + n, at: [s * 0.55, 0.3, 1.05] },
    { name: 'toe' + n, parent: 'foot' + n, at: [s * 0.55, 0.13, 0.55] },
  );
}

const sh = (p: V3): V3 => [p[0], p[1], p[2]];
const WHITE = new THREE.Color(1, 1, 1);
const HEAD_K = 1.3;
const HEAD_C: V3 = [0, 1.8, -1.58];
/** the head / jaw / hair are modelled around the old head position, then moved down and forward: a LOW head thrust out between the shoulders */
const HEAD_SHIFT: V3 = [0, -0.22, -0.1];
const ZT = 0.55; // z of the toe pivot (ball of the foot)
const DZH = -0.25; // hands are modelled relative to the wrist at z = -1.5 (was -1.25)

function buildBody(): THREE.BufferGeometry {
  const sb = new SkinBuilder(BONES.map((b) => b.name));
  const rand = mulberry32(1313);
  const jitter = (c: string, a = 0.05): THREE.Color => new THREE.Color(c).multiplyScalar(1 + (rand() - 0.5) * 2 * a);

  // ---- torso: pelvis high, ribcage hanging below a muscular hump; lean waist, ridged ribs
  {
    const joints: V3[] = [[0, 2.15, 0.98], [0, 2.15, 0.33], [0, 2.1, -0.3], [0, 2.0, -0.85]];
    const keys: { s: number; rx: number; ry?: number; c?: string; dark?: number }[] = [
      { s: 0, rx: 0.3, ry: 0.28, c: SILVER_LO }, { s: 0.3, rx: 0.25, ry: 0.23, c: SILVER }, { s: 0.55, rx: 0.18, ry: 0.2, c: SILVER_LO, dark: 0.8 },
    ];
    for (let i = 0; i <= 14; i++) {
      const s = 0.68 + i * 0.058;
      const f = i / 14;
      const base = lerp(0.2, 0.42, Math.pow(f, 0.85));
      const ridge = i % 2 === 0;
      keys.push({ s, rx: base * (ridge ? 1.12 : 0.82), ry: base * (ridge ? 1.02 : 0.8) * (1 + f * 0.12), c: ridge ? SILVER : SILVER_LO, dark: ridge ? 1 : 0.5 });
    }
    keys.push({ s: 1.62, rx: 0.4, ry: 0.4, c: SILVER_HI }, { s: 1.78, rx: 0.3, ry: 0.28, c: SILVER });
    limbTube(sb, joints, ['pelvis', 'spine', 'chest'], keys, { bl: 0.2, seg: 10, side0: [1, 0, 0], capStart: true, bottomDark: 0.45 });
  }
  // ---- heavy muscular hump: trapezius, scapulae, deltoids; hips carried high with big glutes
  sb.blob([0, 2.42, -0.4], [0.6, 0.36, 0.72], w1('chest'), jitter(SILVER), { rot: [-0.25, 0, 0], nu: 12, nv: 8, bottomDark: 0.4 });
  for (const s of [-1, 1]) {
    sb.blob([s * 0.2, 2.68, -0.38], [0.17, 0.12, 0.56], w1('chest'), jitter(SILVER_HI), { rot: [-0.25, 0, s * 0.12], nu: 9, nv: 6, bottomDark: 0.3 });
    sb.blob([s * 0.44, 2.56, -0.32], [0.2, 0.14, 0.48], w1('chest'), jitter(SILVER), { rot: [-0.25, 0, s * 0.45], nu: 9, nv: 6, bottomDark: 0.35 });
  }
  sb.blob([0, 2.7, -0.38], [0.05, 0.05, 0.58], w1('chest'), new THREE.Color(CREV), { rot: [-0.25, 0, 0], nu: 6, nv: 4, bottomDark: 0 });
  for (const s of [-1, 1]) {
    const n = s < 0 ? 'L' : 'R';
    sb.blob([s * 0.52, 2.3, -0.2], [0.22, 0.24, 0.42], w1('chest'), jitter(SILVER_HI), { rot: [-0.2, s * 0.3, s * 0.3], nu: 10, nv: 7, bottomDark: 0.4 });
    sb.blob([s * 0.76, 1.95, -0.58], [0.2, 0.23, 0.24], wMix('chest', 'sh' + n, 0.5), jitter(SILVER_HI), { nu: 10, nv: 7 });
    sb.blob([s * 0.46, 1.86, -0.02], [0.14, 0.26, 0.46], w1('chest'), jitter(SILVER_LO), { rot: [0.5, 0, s * 0.15], bottomDark: 0.5 });
    sb.blob([s * 0.32, 2.25, 1.12], [0.3, 0.34, 0.36], w1('pelvis'), jitter(SILVER), { bottomDark: 0.45 });
    sb.blob([s * 0.2, 2.05, 0.62], [0.13, 0.15, 0.26], wMix('pelvis', 'spine', 0.5), jitter(SILVER_LO), { rot: [0.3, 0, 0], bottomDark: 0.5 });
  }
  // spine knobs along the bony back: a tall arch from the high rump over the hump
  for (let i = 0; i < 9; i++) {
    const f = i / 8;
    const z = lerp(0.98, -0.1, f), y = lerp(2.46, 2.66, f) - 0.14 * Math.sin(f * Math.PI);
    sb.cone([0, y - 0.04, z], [0, y + 0.1, z + 0.03], 0.07, w1(f < 0.35 ? 'pelvis' : f < 0.65 ? 'spine' : 'chest'), jitter(SILVER_HI, 0.04), { seg: 4 });
  }

  // ---- neck (sinewy) sloping down into the low head
  limbTube(sb, [[0, 2.2, -0.75], [0, 2.0, -1.08], [0, 1.78, -1.4]], ['neck', 'head'], [{ s: 0, rx: 0.3, ry: 0.28, c: SILVER }, { s: 0.3, rx: 0.17, ry: 0.19, c: SILVER_LO }, { s: 0.7, rx: 0.17, ry: 0.19, c: SILVER }], { bl: 0.12, seg: 8, side0: [1, 0, 0] });
  // ---- head (modelled around the old head position, shifted afterwards): gaunt HUMAN zombie face
  const H = w1('head');
  sb.blob([0, 1.84, -1.52], [0.31, 0.34, 0.4], H, jitter(SILVER), { rot: [0.2, 0, 0], nu: 12, nv: 8, bottomDark: 0.2 }); // skull
  sb.blob([0, 1.68, -1.72], [0.21, 0.2, 0.25], H, jitter(SILVER_LO), { nu: 10, nv: 6 }); // gaunt face
  sb.blob([0, 1.945, -1.84], [0.34, 0.07, 0.13], H, jitter(SILVER_LO, 0.04), { rot: [0.1, 0, 0] }); // heavy brow ridge
  for (const s of [-1, 1]) {
    sb.blob([s * 0.17, 1.84, -1.8], [0.17, 0.17, 0.14], H, new THREE.Color(CREV), { nu: 9, nv: 7, bottomDark: 0 }); // deep dark eye sockets
    sb.blob([s * 0.27, 1.71, -1.78], [0.09, 0.07, 0.15], H, jitter(SILVER_HI), { rot: [0, s * 0.35, 0], nu: 8, nv: 5 }); // prominent cheekbone
    sb.blob([s * 0.17, 1.58, -1.82], [0.045, 0.08, 0.07], H, new THREE.Color(SILVER_LO).multiplyScalar(0.55), { nu: 6, nv: 5, bottomDark: 0 }); // hollow cheek
    sb.blob([s * 0.31, 1.78, -1.4], [0.035, 0.1, 0.08], H, jitter(SILVER_LO), { nu: 6, nv: 5 }); // small human ear
  }
  sb.blob([0, 1.76, -1.97], [0.04, 0.07, 0.05], H, jitter(SILVER_HI), { rot: [0.4, 0, 0], nu: 6, nv: 5 }); // short nose bridge
  sb.blob([0, 1.69, -2.03], [0.06, 0.035, 0.04], H, jitter(SILVER), { nu: 6, nv: 4 }); // nose tip
  for (const s of [-1, 1]) sb.blob([s * 0.03, 1.675, -2.06], [0.017, 0.02, 0.02], H, new THREE.Color(MOUTH), { nu: 5, nv: 3, bottomDark: 0 }); // nostrils
  // screaming "O": taller than wide, dark interior, thin lip rim, teeth only along the top and bottom rims
  sb.blob([0, 1.5, -1.9], [0.1, 0.19, 0.12], H, new THREE.Color(MOUTH), { nu: 10, nv: 6, bottomDark: 0 });
  sb.blob([0, 1.665, -1.95], [0.125, 0.026, 0.05], H, jitter(SILVER_LO, 0.04), { nu: 8, nv: 4 }); // top lip
  for (let i = 0; i < 7; i++) {
    const a = (i / 6 - 0.5) * 2.0;
    const x = Math.sin(a) * 0.095, z = -1.95 + (1 - Math.cos(a)) * 0.07;
    sb.cone([x, 1.655, z], [x * 0.95, 1.655 - (i % 2 ? 0.07 : 0.11), z - 0.012], 0.02, H, TOOTH, { seg: 3 });
  }
  // lower jaw: a long pointed chin swinging open on the 'jaw' bone, thin lip rim and lower teeth
  limbTube(sb, [[0, 1.6, -1.5], [0, 1.44, -1.8], [0, 1.32, -1.98]], ['jaw'], [{ s: 0, rx: 0.19, ry: 0.08, c: SILVER_LO }, { s: 0.35, rx: 0.15, ry: 0.07, c: SILVER_LO }, { s: 0.65, rx: 0.1, ry: 0.06, c: SILVER }], { bl: 0.01, seg: 7, side0: [1, 0, 0], capEnd: true });
  for (let i = 0; i < 7; i++) {
    const a = (i / 6 - 0.5) * 1.9;
    const x = Math.sin(a) * 0.1, z = -1.87 + (1 - Math.cos(a)) * 0.1;
    sb.cone([x, 1.4, z], [x, 1.4 + (i % 2 ? 0.06 : 0.1), z - 0.01], 0.02, w1('jaw'), TOOTH, { seg: 3 });
  }
  // a few messy spiky tufts on the scalp only
  const HW: Weights = w1('hair');
  for (let i = 0; i < 12; i++) {
    const a = rand() * Math.PI * 2, rr = Math.sqrt(rand()) * 0.2;
    const bx = Math.cos(a) * rr, bz = -1.45 + Math.sin(a) * rr * 1.3;
    const by = 2.05 - rr * 0.4;
    const len = 0.2 + rand() * 0.24;
    const dirx = bx * 1.6 + (rand() - 0.5) * 0.5, diry = 0.9 + rand() * 0.4, dirz = 0.35 + (bz + 1.4) * 0.6 + rand() * 0.4;
    const dl = Math.hypot(dirx, diry, dirz);
    sb.cone([bx, by, bz], [bx + (dirx / dl) * len, by + (diry / dl) * len, bz + (dirz / dl) * len], 0.04 + rand() * 0.02, HW, jitter(HAIR, 0.1), { seg: 3 });
  }

  // ---- arms: long, sinewy: thick near the elbow, thin at the wrist, OVERSIZED clawed hands planted ahead
  for (const [n, s] of [['L', -1], ['R', 1]] as const) {
    const S: V3 = [s * 0.7, 1.92, -0.55], E: V3 = [s * 0.95, 0.95, -0.75], W: V3 = [s * 0.78, 0.13, -1.5], P: V3 = [s * 0.78, 0.12, -1.67];
    limbTube(sb, [S, E, W, P], ['sh' + n, 'el' + n, 'hand' + n], [
      { s: 0, rx: 0.19, c: SILVER_HI }, { s: 0.35, rx: 0.135, ry: 0.145, c: SILVER }, { s: 0.75, rx: 0.095, c: SILVER_LO, dark: 0.85 },
      { s: 1.02, rx: 0.088, c: SILVER_LO, dark: 0.8 }, { s: 1.22, rx: 0.13, ry: 0.115, c: SILVER }, { s: 1.6, rx: 0.1, c: SILVER_LO }, { s: 2.0, rx: 0.062, ry: 0.055, c: SILVER_LO }, { s: 2.2, rx: 0.058, ry: 0.05, c: SILVER_LO }, { s: 2.37, rx: 0.075, ry: 0.055, c: SILVER },
    ], { bl: 0.12, seg: 7, color: SILVER });
    sb.cone([s * 1.0, 1.0, -0.58], [s * 1.06, 1.06, -0.36], 0.065, w1('el' + n), SILVER_HI, { seg: 4 }); // bony elbow point (out and back)
    sb.blob([s * 0.78, 0.115, -1.5 + DZH], [0.25, 0.055, 0.2], wMix('hand' + n, 'fing' + n, 0.35), jitter(SILVER), { nu: 10, nv: 5, bottomDark: 0.2 });
    for (let i = 0; i < 4; i++) {
      const f = i / 3 - 0.5;
      const bx = s * 0.78 + f * 0.36, ang = f * 0.9;
      const dx = Math.sin(ang), dz = -Math.cos(ang);
      const l1 = 0.3 + (i === 1 || i === 2 ? 0.07 : 0), l2 = 0.3 + (i === 1 || i === 2 ? 0.06 : 0), l3 = 0.24;
      const p0: V3 = [bx, 0.125, -1.62 + DZH];
      const p1: V3 = [bx + dx * l1, 0.14, p0[2] + dz * l1];
      const p2: V3 = [p1[0] + dx * l2, 0.115, p1[2] + dz * l2];
      const p3: V3 = [p2[0] + dx * l3, 0.035, p2[2] + dz * l3 * 0.9];
      limbTube(sb, [p0, p1, p2, p3], ['fing' + n, 'fing' + n, 'fing' + n], [
        { s: 0, rx: 0.056, ry: 0.05, c: SILVER }, { s: 0.3, rx: 0.045, c: SILVER_LO }, { s: 0.62, rx: 0.036, c: SILVER_LO }, { s: 0.95, rx: 0.032, c: SILVER },
      ], { bl: 0.02, seg: 5, color: SILVER });
      sb.cone(p3, [p3[0] + dx * 0.13, 0.006, p3[2] + dz * 0.13], 0.032, w1('fing' + n), CLAW, { seg: 4 });
    }
    {
      const bx = s * 0.78 + s * 0.22, ang = s * 1.15;
      const dx = Math.sin(ang), dz = -Math.cos(ang);
      const zb = -1.42 + DZH;
      const p0: V3 = [bx - s * 0.04, 0.12, zb], p1: V3 = [bx + dx * 0.2, 0.12, zb + dz * 0.2], p2: V3 = [bx + dx * 0.4, 0.07, zb + dz * 0.4];
      limbTube(sb, [p0, p1, p2], ['hand' + n, 'fing' + n], [{ s: 0, rx: 0.06, c: SILVER }, { s: 0.2, rx: 0.045, c: SILVER_LO }, { s: 0.4, rx: 0.034, c: SILVER }], { bl: 0.05, seg: 5, color: SILVER });
      sb.cone(p2, [p2[0] + dx * 0.1, 0.01, p2[2] + dz * 0.1], 0.03, w1('fing' + n), CLAW, { seg: 4 });
    }
  }

  // ---- hind legs: hips HIGH, big thigh angled down-forward, bony knee, defined calf, thin ankle, heel lifted, long clawed foot on the toes
  for (const [n, s] of [['L', -1], ['R', 1]] as const) {
    const Hh: V3 = [s * 0.42, 2.1, 0.95], K: V3 = [s * 0.62, 1.2, 0.42], A: V3 = [s * 0.55, 0.3, 1.05];
    limbTube(sb, [Hh, K, A], ['hip' + n, 'knee' + n], [
      { s: 0, rx: 0.29, ry: 0.32, c: SILVER }, { s: 0.3, rx: 0.3, ry: 0.34, c: SILVER_HI }, { s: 0.7, rx: 0.2, ry: 0.22, c: SILVER_LO }, { s: 0.98, rx: 0.12, ry: 0.13, c: SILVER_LO, dark: 0.8 },
      { s: 1.18, rx: 0.12, ry: 0.13, c: SILVER }, { s: 1.38, rx: 0.165, ry: 0.19, c: SILVER_HI }, { s: 1.7, rx: 0.1, ry: 0.11, c: SILVER_LO }, { s: 2.0, rx: 0.052, ry: 0.058, c: SILVER_LO }, { s: 2.18, rx: 0.06, ry: 0.065, c: SILVER },
    ], { bl: 0.15, seg: 8, color: SILVER });
    sb.cone([s * 0.68, 1.24, 0.3], [s * 0.7, 1.26, 0.06], 0.08, w1('knee' + n), SILVER_HI, { seg: 4 }); // bony knee
    limbTube(sb, [A, [s * 0.55, 0.2, 0.82], [s * 0.55, 0.11, ZT + 0.03]], ['foot' + n, 'toe' + n], [{ s: 0, rx: 0.06, c: SILVER_LO }, { s: 0.3, rx: 0.08, ry: 0.055, c: SILVER }, { s: 0.55, rx: 0.12, ry: 0.05, c: SILVER_LO }], { bl: 0.06, seg: 6, side0: [1, 0, 0] });
    sb.blob([s * 0.55, 0.27, 1.17], [0.075, 0.1, 0.1], w1('foot' + n), jitter(SILVER), { nu: 6, nv: 4 }); // lifted heel
    for (let i = 0; i < 4; i++) {
      const f = i / 3 - 0.5;
      const bx = s * 0.55 + f * 0.26, ang = f * 0.7;
      const dx = Math.sin(ang), dz = -Math.cos(ang);
      const p0: V3 = [bx, 0.105, ZT], p1: V3 = [bx + dx * 0.22, 0.08, ZT + dz * 0.22], p2: V3 = [bx + dx * 0.44, 0.03, ZT + dz * 0.44];
      limbTube(sb, [p0, p1, p2], ['toe' + n, 'toe' + n], [{ s: 0, rx: 0.048, ry: 0.04, c: SILVER }, { s: 0.22, rx: 0.036, c: SILVER_LO }, { s: 0.44, rx: 0.03, c: SILVER }], { bl: 0.02, seg: 5, color: SILVER });
      sb.cone(p2, [p2[0] + dx * 0.11, 0.005, p2[2] + dz * 0.11], 0.03, w1('toe' + n), CLAW, { seg: 4 });
    }
  }
  const g = sb.build();
  // head: scale about the skull, then move down / forward (low head thrust between the shoulders)
  {
    const pos = g.getAttribute('position') as THREE.BufferAttribute;
    const si = g.getAttribute('skinIndex') as THREE.BufferAttribute, sw = g.getAttribute('skinWeight') as THREE.BufferAttribute;
    const names = BONES.map((b) => b.name);
    const hi = new Set([names.indexOf('head'), names.indexOf('jaw'), names.indexOf('hair')]);
    for (let i = 0; i < pos.count; i++) {
      if (!hi.has(si.getX(i)) || sw.getX(i) < 0.9) continue;
      pos.setXYZ(i, pos.getX(i) * HEAD_K + HEAD_SHIFT[0], HEAD_C[1] + (pos.getY(i) - HEAD_C[1]) * HEAD_K + HEAD_SHIFT[1], HEAD_C[2] + (pos.getZ(i) - HEAD_C[2]) * HEAD_K + HEAD_SHIFT[2]);
    }
    pos.needsUpdate = true;
    g.computeVertexNormals();
  }
  g.translate(0, 0, ZOFF);
  return g;
}

function eyeGeometry(): THREE.BufferGeometry {
  const g = new THREE.SphereGeometry(0.15, 12, 9);
  const n = g.getAttribute('normal'), p = g.getAttribute('position');
  const col = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    const front = -n.getZ(i); // facing -Z
    const dx = n.getX(i), dy = n.getY(i);
    const ang = Math.acos(clamp(front, -1, 1));
    void dx; void dy;
    // pupil (dark) at the very front, sclera elsewhere, a thin bloodshot rim
    const v = ang < 0.26 ? 0.02 : ang < 0.62 ? 0.22 : 1;
    col[i * 3] = v; col[i * 3 + 1] = v; col[i * 3 + 2] = v;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}

interface LimbRt {
  ik: IkLimb; arm: boolean; s: number; off: number; end: THREE.Bone; tip: THREE.Bone; base: THREE.Vector3;
  pos: THREE.Vector3; pole: THREE.Vector3; qf: THREE.Quaternion; qd: THREE.Quaternion; pitch: number; curl: number;
}

const _v = new THREE.Vector3(), _e = new THREE.Euler(), _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion();
const ez = (a: number, b: number, c: number, o: THREE.Euler['order'] = 'XYZ'): THREE.Euler => _e.set(a, b, c, o);

export class HydeBiped {
  readonly root = new THREE.Group();
  readonly look: HydeLook = { eyeColor: new THREE.Color('#ffb04a'), eyeScale: 1, lightIntensity: 0 };
  readonly headWorld = new THREE.Vector3();
  readonly chestWorld = new THREE.Vector3();
  readonly eyeL = new THREE.Vector3();
  readonly eyeR = new THREE.Vector3();
  readonly light: THREE.PointLight;
  /** current approximate triangle count of the body (tooling) */
  readonly triangles: number;
  private readonly rig: Rig;
  private readonly mesh: THREE.SkinnedMesh;
  private readonly geo: THREE.BufferGeometry;
  private readonly eyes: THREE.Group;
  private eyeGeo: THREE.BufferGeometry;
  private readonly mat: THREE.MeshLambertMaterial;
  private readonly eyeMat: THREE.MeshBasicMaterial;
  private readonly limbs: LimbRt[] = [];
  private readonly neckLocal = new THREE.Vector3();
  private phase = 0;
  private stone = 0;
  private frost = 0;
  private shock = 0;
  private pin = 0;
  private lunge = 0;
  private gal = 0;
  private yawSm = 0;
  private yawInit = false;
  private posed = false;
  // smoothed pose parameters
  private readonly P = { chestPitch: 0, pelvisDy: 0, headYaw: 0, headPitch: 0, headRoll: 0, jaw: 0.2, wide: 1, scale: 1, move: 0, hairTrail: 0 };

  constructor() {
    const defs = BONES.map((b) => ({ ...b, at: sh([b.at[0], b.at[1], b.at[2] + ZOFF]) }));
    this.rig = new Rig(defs);
    this.geo = buildBody();
    this.triangles = (this.geo.index?.count ?? 0) / 3;
    this.mat = new THREE.MeshLambertMaterial({ vertexColors: true, emissive: new THREE.Color(0.02, 0.02, 0.022), emissiveIntensity: 1 });
    // cheap shader term: a fresnel sheen so the silver body catches the moonlight at its silhouette (the printed-metal look)
    // (a constant in the shader: custom uniforms on a stock material were not re-uploaded; dynamic tints go through `emissive`)
    this.mat.onBeforeCompile = (sh2) => {
      sh2.fragmentShader = sh2.fragmentShader.replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n\tfloat rimF = pow(1.0 - saturate(dot(normalize(normal), normalize(vViewPosition))), 3.0);\n\ttotalEmissiveRadiance += vec3(0.24, 0.23, 0.22) * rimF;');
    };
    this.mesh = new THREE.SkinnedMesh(this.geo, this.mat);
    this.root.add(this.mesh);
    this.rig.bind(this.mesh);
    this.neckLocal.copy(this.rig.b('neck').position);
    // eyes: bulging spheres on the head bone (colour = mode); pupils stay dark through vertex colours
    this.eyeGeo = eyeGeometry();
    this.eyeMat = new THREE.MeshBasicMaterial({ vertexColors: true, color: new THREE.Color('#ffb04a'), fog: false });
    const eyes = new THREE.Group();
    {
      // both eyeballs in ONE geometry / draw call
      const parts: THREE.BufferGeometry[] = [];
      for (const s of [-1, 1]) {
        const g = this.eyeGeo.clone();
        g.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(s * 0.21, -0.071, -0.8), new THREE.Quaternion(), new THREE.Vector3(HEAD_K * 0.62, HEAD_K * 0.64, HEAD_K * 0.62)));
        parts.push(g);
      }
      const merged = mergeGeometries(parts, false);
      for (const g of parts) g.dispose();
      this.eyeGeo.dispose();
      this.eyeGeo = merged;
      eyes.add(new THREE.Mesh(merged, this.eyeMat));
    }
    this.eyes = eyes;
    this.rig.b('head').add(eyes);
    this.light = new THREE.PointLight(new THREE.Color('#ff8a40'), 0, 20, 1.7);
    this.light.position.set(0, -0.1, -0.8);
    this.rig.b('head').add(this.light);

    // limbs
    const mk = (up: string, lo: string, end: string, tip: string, arm: boolean, s: number, off: number): void => {
      const ik = makeLimb(this.rig, up, lo, end);
      const base = this.rig.r(end).clone();
      this.limbs.push({ ik, arm, s, off, end: this.rig.b(end), tip: this.rig.b(tip), base, pos: base.clone(), pole: new THREE.Vector3(), qf: new THREE.Quaternion(), qd: new THREE.Quaternion(), pitch: 0, curl: 0 });
    };
    mk('shL', 'elL', 'handL', 'fingL', true, -1, 0.25);
    mk('shR', 'elR', 'handR', 'fingR', true, 1, 0.75);
    mk('hipL', 'kneeL', 'footL', 'toeL', false, -1, 0.0);
    mk('hipR', 'kneeR', 'footR', 'toeR', false, 1, 0.5);
  }

  private modeTargets(f: HydeFrame, t: { chestPitch: number; pelvisDy: number; headYaw: number; headPitch: number; headRoll: number; jaw: number; wide: number; scale: number; hairTrail: number }): void {
    const w = Math.sin(f.clock * 0.6);
    t.chestPitch = -0.04; t.pelvisDy = 0; t.headYaw = 0; t.headPitch = 0.1; t.headRoll = 0; t.jaw = 0.5; t.wide = 1; t.scale = 1; t.hairTrail = 0.05;
    switch (f.mode) {
      case 'PATROL':
        t.headYaw = w * 0.55; t.headPitch = 0.12; t.jaw = 0.5 + 0.06 * Math.sin(f.clock * 1.3);
        break;
      case 'INVESTIGATE_SOUND':
        t.chestPitch = 0.14; t.pelvisDy = 0.04; t.headRoll = 0.5; t.headPitch = 0.22 + Math.sin(f.clock * 7) * 0.05; t.headYaw = 0.28 + Math.sin(f.clock * 3.1) * 0.1;
        t.jaw = 0.5 + Math.max(0, Math.sin(f.clock * 7)) * 0.1; t.wide = 1.12;
        break;
      case 'SEARCH':
        t.chestPitch = -0.14; t.pelvisDy = -0.12; t.headPitch = -0.12; t.headYaw = Math.sin(f.clock * 1.5) * 0.95; t.jaw = 0.55; t.wide = 1.08;
        break;
      case 'CHASE':
        t.chestPitch = 0.0; t.pelvisDy = 0.02; t.headPitch = 0.38; t.headYaw = 0; t.jaw = 0.95 + Math.sin(f.clock * 9) * 0.08; t.scale = 1.04; t.hairTrail = 0.5;
        break;
      case 'COOLDOWN':
        t.chestPitch = -0.2; t.pelvisDy = -0.14; t.headPitch = -0.28; t.headYaw = Math.sin(f.clock * 0.9) * 0.3; t.jaw = 0.6 + Math.sin(f.clock * 5) * 0.1;
        break;
    }
    if (f.grabbing) { t.chestPitch = 0.34; t.pelvisDy = 0.12; t.headPitch = 0.4; t.jaw = 1.1; t.headYaw = 0; t.headRoll = 0; t.hairTrail = 0.7; }
    if (f.distracted && !f.grabbing) {
      t.headYaw = f.lookYaw !== null ? clamp(f.lookYaw, -1.2, 1.2) : Math.sin(f.clock * 1.4) * 0.8;
      t.headRoll = 0.3 * Math.sin(f.clock * 2.2); t.chestPitch = Math.min(t.chestPitch, 0.0);
    } else if (f.lookYaw !== null && f.mode !== 'CHASE' && !f.grabbing && f.mode !== 'PATROL') {
      t.headYaw = clamp(f.lookYaw, -1.0, 1.0) * 0.8 + t.headYaw * 0.3;
    }
    if (f.stunned) { t.chestPitch = -0.42; t.pelvisDy = -0.34; t.headPitch = -0.5; t.jaw = 0.45; t.headRoll = 0.3; t.wide = 1.25; }
  }

  update(f: HydeFrame): void {
    const dt = f.dt;
    if (!this.yawInit) { this.yawSm = f.bodyYaw; this.yawInit = true; }
    // tint: stone / frost / shock / pin
    this.stone = damp(this.stone, f.petrified ? 1 : 0, 9, dt);
    this.frost = damp(this.frost, f.slowed ? 1 : 0, 4, dt);
    this.shock = damp(this.shock, f.stunned && !f.petrified && !f.pinned ? 1 : 0, 10, dt);
    this.pin = damp(this.pin, f.pinned ? 1 : 0, 8, dt);
    const useStone = this.stone > 0.5;
    this.eyes.visible = !useStone;
    const fl = this.shock * (0.5 + 0.5 * Math.sin(f.clock * 38)) * 0.28;
    // stone: matte warm grey, no sheen; frost: cold blue; pin: teal glow
    const st = this.stone;
    this.mat.color.setRGB(lerp(lerp(1.0, 0.75, this.frost), 1.05, st), lerp(lerp(0.9, 0.82, this.frost), 1.0, st), lerp(lerp(0.74, 0.95, this.frost), 0.88, st));
    this.mat.emissive.setRGB(0.02 + fl * 0.5 + st * 0.05, 0.02 + this.frost * 0.12 + fl * 0.5 + this.pin * 0.18 + st * 0.05, 0.022 + this.frost * 0.2 + fl * 0.6 + this.pin * 0.12 + st * 0.04);
    const fade = clamp(f.fade, 0, 1);
    const wantT = fade > 0.03;
    if (this.mat.transparent !== wantT) { this.mat.transparent = wantT; this.mat.needsUpdate = true; }
    this.mat.opacity = 1 - 0.7 * fade;
    this.mat.depthWrite = fade < 0.4;

    const frozen = f.petrified || !!f.pinned;
    const P = this.P;
    if (!frozen) {
      const t = { chestPitch: 0, pelvisDy: 0, headYaw: 0, headPitch: 0, headRoll: 0, jaw: 0, wide: 1, scale: 1, hairTrail: 0 };
      this.modeTargets(f, t);
      const k = 1 - Math.exp(-(f.grabbing ? 18 : 7) * dt);
      P.chestPitch = lerp(P.chestPitch, t.chestPitch, k); P.pelvisDy = lerp(P.pelvisDy, t.pelvisDy, k);
      P.headYaw = lerp(P.headYaw, t.headYaw, k); P.headPitch = lerp(P.headPitch, t.headPitch, k); P.headRoll = lerp(P.headRoll, t.headRoll, k);
      P.jaw = lerp(P.jaw, t.jaw, k); P.wide = lerp(P.wide, t.wide, k); P.scale = lerp(P.scale, t.scale, k); P.hairTrail = lerp(P.hairTrail, t.hairTrail, k);
      this.gal = damp(this.gal, f.mode === 'CHASE' && f.speed > 2.5 && !f.stunned ? 1 : 0, 5, dt);
      this.lunge = damp(this.lunge, f.grabbing ? 1 : 0, 16, dt);
      const sp = f.stunned ? 0 : f.speed;
      P.move = damp(P.move, clamp(sp / 0.7, 0, 1), 8, dt);
      const slowK = f.slowed ? 0.85 : 1;
      const rate = lerp(0.5 + sp * 0.22, 0.95 + sp * 0.13, this.gal);
      this.phase = (this.phase + dt * rate * slowK * (sp > 0.05 ? 1 : 0)) % 1;
    }
    // body yaw easing (visual only)
    if (!frozen) {
      let d = f.bodyYaw - this.yawSm;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      this.yawSm += d * (1 - Math.exp(-14 * dt));
    }
    this.root.rotation.y = this.yawSm;
    this.root.scale.setScalar(P.scale);

    if (!frozen || !this.posed) { this.pose(f); this.posed = true; }

    // eye look: colour by mode / state (drives the glow billboards too)
    const L = this.look;
    let col = '#ffb04a';
    let es = 1;
    let li = 3;
    switch (f.mode) {
      case 'PATROL': col = '#ffc060'; es = 0.9; li = 3; break;
      case 'INVESTIGATE_SOUND': col = '#ffd24a'; es = 1.1; li = 6; break;
      case 'SEARCH': col = '#ffa030'; es = 1.15; li = 8; break;
      case 'CHASE': col = '#ff3a2a'; es = 1.6; li = 26; break;
      case 'COOLDOWN': col = '#d89040'; es = 0.8; li = 3; break;
    }
    if (f.distracted) { col = '#c9a2ff'; li = 6; }
    if (f.stunned) { col = Math.sin(f.clock * 30) > 0 ? '#aee8ff' : '#ffffff'; li = 8; es = 1.2; }
    if (f.pinned) { col = '#8affc8'; li = 6; es = 1.0; }
    if (f.slowed) col = '#8fd8ff';
    L.eyeColor.set(col);
    L.eyeScale = es;
    this.eyeMat.color.set(col).lerp(WHITE, 0.3).multiplyScalar(0.85); // pale eyeballs, dark pupils; the saturated mode colour is the glow billboard
    L.lightIntensity = (useStone ? 0 : li) * (1 - fade);
    this.light.color.copy(L.eyeColor);
    this.light.intensity = L.lightIntensity;

    // world positions for the scene's glow billboards
    this.root.updateMatrixWorld(true);
    this.rig.b('head').getWorldPosition(this.headWorld);
    this.rig.b('chest').getWorldPosition(this.chestWorld);
    for (const s of [-1, 1]) {
      _v.set(s * 0.22, -0.071, -0.82);
      this.rig.b('head').localToWorld(_v);
      (s < 0 ? this.eyeL : this.eyeR).copy(_v);
    }
  }

  /** Procedural pose: spine, head and the four IK-planted limbs. */
  private pose(f: HydeFrame): void {
    const R = this.rig, P = this.P, T = f.clock;
    const mv = P.move, gal = this.gal, lunge = this.lunge;
    const ph = this.phase * Math.PI * 2;
    const shock = this.shock;
    const tr = shock * Math.sin(T * 55) * 0.03;
    const breath = Math.sin(T * (f.mode === 'COOLDOWN' ? 5 : 1.7)) * (f.mode === 'COOLDOWN' ? 0.04 : 0.015);
    const bound = gal * mv;
    // ---- spine
    const pel = R.b('pelvis'), spi = R.b('spine'), che = R.b('chest'), nec = R.b('neck'), hed = R.b('head'), jaw = R.b('jaw'), hair = R.b('hair');
    const walkRoll = Math.sin(ph) * (1 - gal);
    pel.position.set(tr, R.r('pelvis').y + P.pelvisDy + Math.sin(ph * 2 + 1) * 0.04 * mv * (1 - gal) + Math.sin(ph + Math.PI) * 0.14 * bound, R.r('pelvis').z - lunge * 0.55);
    pel.quaternion.setFromEuler(ez(-0.08 * bound * Math.sin(ph) - P.chestPitch * 0.25 - lunge * 0.2, -Math.sin(ph) * 0.07 * mv * (1 - gal), -walkRoll * 0.04 * mv));
    spi.quaternion.setFromEuler(ez(P.chestPitch * 0.4 + breath + Math.sin(ph) * 0.07 * bound, Math.sin(ph) * 0.1 * mv * (1 - gal), walkRoll * 0.05 * mv));
    che.quaternion.setFromEuler(ez(P.chestPitch * 0.6 + breath * 0.5 + Math.sin(ph + 0.5) * 0.12 * bound + lunge * 0.1, Math.sin(ph) * 0.13 * mv * (1 - gal) + tr * 4, -walkRoll * 0.1 * mv + tr));
    const hy = P.headYaw;
    // head slung low and thrust forward on the neck (the statue's head hangs below the hump)
    nec.position.copy(this.neckLocal);
    nec.quaternion.setFromEuler(ez(P.headPitch * 0.4 - P.chestPitch * 0.6, hy * 0.4, P.headRoll * 0.4, 'YXZ'));
    hed.quaternion.setFromEuler(ez(P.headPitch * 0.6 - P.chestPitch * 0.3, hy * 0.6, P.headRoll * 0.6, 'YXZ'));
    jaw.quaternion.setFromEuler(ez(-P.jaw, 0, 0));
    hair.quaternion.setFromEuler(ez(P.hairTrail + Math.sin(T * 2.3) * (f.reduced ? 0.01 : 0.06), 0, Math.sin(T * 1.1) * (f.reduced ? 0.01 : 0.07)));
    for (const b of [pel, spi, che, nec, hed, jaw, hair]) b.updateMatrix();

    // ---- limbs
    const duty = lerp(0.62, 0.4, gal);
    const moving = mv;
    for (let i = 0; i < 4; i++) {
      const L = this.limbs[i];
      // gallop offsets: arms land together, then legs
      const off = lerp(L.off, L.arm ? (L.s < 0 ? 0 : 0.07) : (L.s < 0 ? 0.52 : 0.57), gal);
      const u = (this.phase + off) % 1;
      const stride = Math.min(L.arm ? lerp(0.6, 0.95, gal) : lerp(0.75, 1.2, gal), f.speed * duty / Math.max(0.2, lerp(0.5 + f.speed * 0.22, 0.95 + f.speed * 0.13, gal))) * moving;
      const lift = (L.arm ? lerp(0.4, 0.3, gal) : lerp(0.3, 0.36, gal)) * (0.4 + 0.6 * moving);
      let z: number, y: number, pitch = 0, curl = -0.12;
      if (u < duty) {
        const a = u / duty;
        z = -stride / 2 + stride * a; y = 0;
        pitch = 0; curl = -0.14 - 0.1 * Math.sin(a * Math.PI);
      } else {
        const v = (u - duty) / (1 - duty);
        const e = v * v * (3 - 2 * v);
        z = stride / 2 - stride * e;
        const bump = Math.sin(v * Math.PI);
        y = lift * Math.pow(bump, 0.75) * moving;
        pitch = (L.arm ? 0.55 : 0.35) * bump * moving; curl = (0.35 * bump - 0.1 * (1 - bump)) * moving - 0.14 * (1 - moving);
      }
      const rest = L.base;
      // hands reach a little farther forward in the gallop, and wider when listening / searching / stunned
      const reachZ = L.arm ? -0.05 - gal * 0.2 : -gal * 0.12;
      const wide = L.arm ? P.wide : 1 + (P.wide - 1) * 0.4;
      const tx = rest.x * wide;
      const gy = L.arm ? 0.13 : 0.3;
      L.pos.set(tx, gy + y, rest.z + z + reachZ - (L.arm ? 0.0 : 0));
      // lunge: arms thrown forward and up, claws open
      if (L.arm) {
        const lx = L.s * 0.6, ly = 2.0, lz = -2.35 + ZOFF;
        L.pos.x = lerp(L.pos.x, lx, lunge); L.pos.y = lerp(L.pos.y, ly, lunge); L.pos.z = lerp(L.pos.z, lz, lunge);
        pitch = lerp(pitch, -0.55, lunge); curl = lerp(curl, -0.5, lunge);
      }
      // the stunned creature sprawls: hands splay out in front, legs fold out
      if (f.stunned) { L.pos.y = gy; }
      // pole: elbows up/back/out, knees forward/out
      if (L.arm) L.pole.set(L.s * 0.9, 0.3, 0.8);
      else L.pole.set(L.s * 0.4, 0.1, -1);
      limbRoot(R, L.ik, _v);
      solveLimb(R, L.ik, L.pos, L.pole, L.qf);
      // hand / foot orientation: flat on the ground (yaw 0) with the swing / lunge pitch
      L.qd.setFromEuler(ez(pitch, 0, 0));
      // keep the foot pointing roughly along the body axis
      orientEnd(L.end, L.qf, L.qd);
      L.tip.quaternion.setFromEuler(ez(curl, 0, 0));
      L.tip.updateMatrix();
      // the wrist/ankle bone sits at the end of the IK chain; keep its rotation relative to the lower segment
      void _q; void _q2;
    }
  }

  get stoneAmount(): number { return this.stone; }
  get frostAmount(): number { return this.frost; }

  dispose(): void {
    this.geo.dispose(); this.eyeGeo.dispose();
    this.mat.dispose(); this.eyeMat.dispose();
    this.light.dispose();
    this.rig.skeleton.dispose();
  }
}
