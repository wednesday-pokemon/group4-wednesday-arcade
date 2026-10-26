// Thing: the disembodied hand. One skinned mesh (one draw call), 10 poses shared with the UI spec:
//   'stand' | 'wave' | 'point' | 'shush' | 'count1' | 'count2' | 'count3' | 'thumbsUp' | 'tap' | 'fist'
// Used (a) in the world as the pier guide and the V-hint pointer, and (b) by the app via createThingEmblem / renderThingPng.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { clamp } from '../util.ts';

export type ThingPose = 'stand' | 'wave' | 'point' | 'shush' | 'count1' | 'count2' | 'count3' | 'thumbsUp' | 'tap' | 'fist';
export const THING_POSES: readonly ThingPose[] = ['stand', 'wave', 'point', 'shush', 'count1', 'count2', 'count3', 'thumbsUp', 'tap', 'fist'];

const SKIN = '#e6d3bb';
const SKIN_SHADE = '#cdb89d';
const SLEEVE = '#17171f';
const CUFF = '#f1eee6';

interface PoseDef {
  /** index, middle, ring, pinky: [proximal, middle, distal] curl (negative curls toward the palm) */
  f: [number, number, number][];
  spread: number;
  /** thumb: [abduction offset, proximal curl, distal curl] */
  th: [number, number, number];
  rx: number; rz: number; ry: number; y: number;
}

const EXT: [number, number, number] = [-0.05, -0.04, -0.03];
const CURL: [number, number, number] = [-1.45, -1.65, -1.2];
const GND: [number, number, number] = [-0.95, -0.7, -0.45];
const HALF: [number, number, number] = [-0.7, -0.75, -0.5];

const POSES: Record<ThingPose, PoseDef> = {
  stand: { f: [GND, GND, GND, GND], spread: 0.16, th: [0.2, -0.7, -0.4], rx: 0, rz: 0, ry: 0, y: 0.26 },
  wave: { f: [EXT, EXT, EXT, EXT], spread: 0.34, th: [0.5, -0.1, -0.05], rx: Math.PI / 2 - 0.1, rz: 0, ry: 0, y: 0.34 },
  point: { f: [EXT, CURL, CURL, CURL], spread: 0.0, th: [0.1, -0.9, -0.6], rx: 0.42, rz: 0, ry: 0, y: 0.34 },
  shush: { f: [[-0.25, -0.1, -0.05], CURL, CURL, CURL], spread: 0.0, th: [0.0, -1.0, -0.7], rx: Math.PI / 2 - 0.25, rz: 0, ry: 0, y: 0.34 },
  count1: { f: [EXT, CURL, CURL, CURL], spread: 0.0, th: [0.0, -1.0, -0.7], rx: Math.PI / 2 - 0.05, rz: 0, ry: 0, y: 0.34 },
  count2: { f: [EXT, EXT, CURL, CURL], spread: 0.46, th: [0.0, -1.0, -0.7], rx: Math.PI / 2 - 0.05, rz: 0, ry: 0, y: 0.34 },
  count3: { f: [EXT, EXT, EXT, CURL], spread: 0.32, th: [0.0, -1.0, -0.7], rx: Math.PI / 2 - 0.05, rz: 0, ry: 0, y: 0.34 },
  thumbsUp: { f: [CURL, CURL, CURL, CURL], spread: 0.0, th: [0.9, -0.05, -0.03], rx: 0.15, rz: -Math.PI / 2, ry: 0, y: 0.3 },
  tap: { f: [HALF, GND, GND, GND], spread: 0.12, th: [0.2, -0.7, -0.4], rx: 0, rz: 0, ry: 0, y: 0.26 },
  fist: { f: [CURL, CURL, CURL, CURL], spread: 0.0, th: [0.0, -1.1, -0.8], rx: Math.PI / 2 - 0.1, rz: 0, ry: 0, y: 0.34 },
};

const FINGER_X = [-0.087, -0.029, 0.029, 0.087];
const FINGER_LEN: [number, number, number][] = [[0.11, 0.08, 0.065], [0.12, 0.09, 0.07], [0.11, 0.08, 0.065], [0.09, 0.065, 0.055]];
const PALM_L = 0.25;
const THUMB_YAW = 0.75;

function segGeo(from: THREE.Vector3, to: THREE.Vector3, r0: number, r1: number, color: string, bone: number): THREE.BufferGeometry {
  const dir = new THREE.Vector3().subVectors(to, from);
  const len = dir.length();
  const g = new THREE.CylinderGeometry(r1, r0, len, 6, 1);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize()));
  const mid = new THREE.Vector3().addVectors(from, to).multiplyScalar(0.5);
  g.translate(mid.x, mid.y, mid.z);
  return finishGeo(g, color, bone);
}

function finishGeo(src: THREE.BufferGeometry, color: string, bone: number): THREE.BufferGeometry {
  const g = src.index ? src.toNonIndexed() : src;
  g.deleteAttribute('uv');
  const n = g.getAttribute('position').count;
  const c = new THREE.Color(color);
  const col = new Float32Array(n * 3);
  for (let i = 0; i < n; i += 3) {
    const j = 0.94 + ((i * 7919) % 100) / 1000;
    for (let k = 0; k < 3; k++) { col[(i + k) * 3] = c.r * j; col[(i + k) * 3 + 1] = c.g * j; col[(i + k) * 3 + 2] = c.b * j; }
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.deleteAttribute('normal');
  g.computeVertexNormals();
  const si = new Uint16Array(n * 4);
  const sw = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) { si[i * 4] = bone; sw[i * 4] = 1; }
  g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
  g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));
  return g;
}

function ball(x: number, y: number, z: number, r: number, color: string, bone: number, sy = 1): THREE.BufferGeometry {
  const g = new THREE.IcosahedronGeometry(r, 0);
  g.scale(1, sy, 1);
  g.translate(x, y, z);
  return finishGeo(g, color, bone);
}

function boxGeo(x: number, y: number, z: number, w: number, h: number, d: number, color: string, bone: number): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(w, h, d);
  g.translate(x, y, z);
  return finishGeo(g, color, bone);
}

export class ThingRig {
  readonly root = new THREE.Group();
  private readonly pivot = new THREE.Group();
  private readonly mesh: THREE.SkinnedMesh;
  private readonly bones: THREE.Bone[] = [];
  private readonly fingers: THREE.Bone[][] = [];
  private readonly thumb: THREE.Bone[] = [];
  private readonly cur = { f: [[0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0]] as number[][], spread: 0.1, th: [0, 0, 0], rx: 0, rz: 0, ry: 0, y: 0.26 };
  private pose: ThingPose = 'stand';
  private readonly geo: THREE.BufferGeometry;
  private readonly mat: THREE.MeshLambertMaterial;
  private t = 0;
  private scuttle = 0;
  private reduced = false;

  constructor(opts: { reducedMotion?: boolean; glow?: number } = {}) {
    this.reduced = !!opts.reducedMotion;
    this.root.add(this.pivot);
    const palm = new THREE.Bone();
    this.bones.push(palm);
    this.pivot.add(palm);
    const parts: THREE.BufferGeometry[] = [];
    const V = (x: number, y: number, z: number): THREE.Vector3 => new THREE.Vector3(x, y, z);
    // palm, knuckle ridge, wrist, sleeve and cuff all ride the palm bone (index 0)
    parts.push(boxGeo(0, 0, -PALM_L / 2, 0.23, 0.08, PALM_L, SKIN, 0));
    parts.push(boxGeo(0, -0.045, -PALM_L / 2 + 0.01, 0.2, 0.03, PALM_L - 0.06, SKIN_SHADE, 0));
    parts.push(boxGeo(0, 0.035, -PALM_L + 0.025, 0.23, 0.035, 0.05, SKIN, 0));
    parts.push(segGeo(V(0, 0, 0.0), V(0, 0, 0.14), 0.07, 0.062, SKIN_SHADE, 0));
    parts.push(segGeo(V(0, 0, 0.12), V(0, 0, 0.34), 0.1, 0.11, SLEEVE, 0));
    parts.push(segGeo(V(0, 0, 0.11), V(0, 0, 0.17), 0.105, 0.105, CUFF, 0));
    // fingers
    for (let i = 0; i < 4; i++) {
      const [l1, l2, l3] = FINGER_LEN[i];
      const x = FINGER_X[i];
      const b1 = new THREE.Bone(), b2 = new THREE.Bone(), b3 = new THREE.Bone();
      b1.position.set(x, 0, -PALM_L);
      b2.position.set(0, 0, -l1);
      b3.position.set(0, 0, -l2);
      palm.add(b1); b1.add(b2); b2.add(b3);
      const idx = this.bones.length;
      this.bones.push(b1, b2, b3);
      this.fingers.push([b1, b2, b3]);
      const z0 = -PALM_L;
      parts.push(segGeo(V(x, 0, z0 + 0.01), V(x, 0, z0 - l1), 0.03, 0.027, SKIN, idx));
      parts.push(ball(x, 0, z0 - l1, 0.028, SKIN, idx + 1));
      parts.push(segGeo(V(x, 0, z0 - l1), V(x, 0, z0 - l1 - l2), 0.027, 0.024, SKIN, idx + 1));
      parts.push(ball(x, 0, z0 - l1 - l2, 0.025, SKIN, idx + 2));
      parts.push(segGeo(V(x, 0, z0 - l1 - l2), V(x, 0, z0 - l1 - l2 - l3), 0.024, 0.02, SKIN, idx + 2));
      parts.push(ball(x, 0, z0 - l1 - l2 - l3, 0.022, '#d9c2a6', idx + 2));
    }
    // thumb: three bones, rest-yawed outward
    {
      const t0 = new THREE.Bone(), t1 = new THREE.Bone(), t2 = new THREE.Bone();
      t0.position.set(-0.115, 0, -0.045);
      t0.rotation.y = THUMB_YAW;
      t1.position.set(0, 0, -0.09);
      t2.position.set(0, 0, -0.07);
      palm.add(t0); t0.add(t1); t1.add(t2);
      const idx = this.bones.length;
      this.bones.push(t0, t1, t2);
      this.thumb.push(t0, t1, t2);
      const d = V(-Math.sin(THUMB_YAW), 0, -Math.cos(THUMB_YAW));
      const p0 = V(-0.115, 0, -0.045);
      const p1 = p0.clone().addScaledVector(d, 0.09);
      const p2 = p1.clone().addScaledVector(d, 0.07);
      const p3 = p2.clone().addScaledVector(d, 0.06);
      parts.push(segGeo(p0, p1, 0.04, 0.034, SKIN, idx));
      parts.push(ball(p1.x, p1.y, p1.z, 0.034, SKIN, idx + 1));
      parts.push(segGeo(p1, p2, 0.034, 0.03, SKIN, idx + 1));
      parts.push(ball(p2.x, p2.y, p2.z, 0.031, SKIN, idx + 2));
      parts.push(segGeo(p2, p3, 0.03, 0.025, SKIN, idx + 2));
      parts.push(ball(p3.x, p3.y, p3.z, 0.026, '#d9c2a6', idx + 2));
    }
    const merged = mergeGeometries(parts, false);
    for (const p of parts) p.dispose();
    this.geo = merged ?? new THREE.BufferGeometry();
    this.mat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, emissive: new THREE.Color('#6a5a7a').multiplyScalar(opts.glow ?? 0.22) });
    this.mesh = new THREE.SkinnedMesh(this.geo, this.mat);
    this.mesh.frustumCulled = false;
    this.pivot.updateMatrixWorld(true);
    this.pivot.add(this.mesh);
    this.pivot.updateMatrixWorld(true);
    this.mesh.bind(new THREE.Skeleton(this.bones));
    this.applyPose(1, 0);
  }

  setPose(p: ThingPose): void { this.pose = p; }
  getPose(): ThingPose { return this.pose; }
  /** 0..1: move on fingertips (the in-world Thing scuttling to the player) */
  setScuttle(v: number): void { this.scuttle = v; }
  get material(): THREE.MeshLambertMaterial { return this.mat; }

  private applyPose(k: number, clock: number): void {
    const P = POSES[this.pose];
    const c = this.cur;
    const calm = this.reduced ? 0 : 1;
    // procedural flourishes per pose
    let wave = 0, wag = 0, tapI = 0, bob = 0, pulse = 0;
    switch (this.pose) {
      case 'wave': wave = Math.sin(clock * 6.5) * 0.45 * calm; break;
      case 'shush': wag = Math.sin(clock * 5) * 0.22 * calm; break;
      case 'tap': tapI = (Math.max(0, Math.sin(clock * 9)) * 0.75) * calm; break;
      case 'thumbsUp': bob = Math.max(0, Math.sin(clock * 3.2)) * 0.05 * calm; break;
      case 'fist': wag = Math.sin(clock * 26) * 0.03 * calm; break;
      case 'count1': case 'count2': case 'count3': pulse = Math.sin(clock * 2.4) * 0.06 * calm; break;
      case 'point': bob = Math.sin(clock * 3.0) * 0.04 * calm; break;
      case 'stand': bob = Math.sin(clock * 1.6) * 0.012 * calm; break;
    }
    c.rx += (P.rx + bob - c.rx) * k;
    c.rz += (P.rz - c.rz) * k;
    c.ry += (P.ry - c.ry) * k;
    c.y += (P.y - c.y) * k;
    c.spread += (P.spread - c.spread) * k;
    for (let i = 0; i < 4; i++) for (let j = 0; j < 3; j++) c.f[i][j] += (P.f[i][j] - c.f[i][j]) * k;
    for (let j = 0; j < 3; j++) c.th[j] += (P.th[j] - c.th[j]) * k;
    this.pivot.position.y = c.y + (this.scuttle > 0.1 ? Math.abs(Math.sin(clock * 14)) * 0.03 * this.scuttle : 0);
    this.pivot.rotation.set(c.rx, c.ry + wave + wag, c.rz);
    for (let i = 0; i < 4; i++) {
      const b = this.fingers[i];
      const sp = -(i - 1.5) * c.spread;
      let extra = 0;
      if (this.pose === 'tap' && i === 0) extra = tapI;
      if (this.scuttle > 0.1) extra = Math.sin(clock * 14 + i * 1.7) * 0.5 * this.scuttle;
      b[0].rotation.set(c.f[i][0] + extra + (i < 3 && (this.pose.startsWith('count')) ? pulse : 0), sp, 0);
      b[1].rotation.x = c.f[i][1] + extra * 0.4;
      b[2].rotation.x = c.f[i][2] + extra * 0.2;
    }
    this.thumb[0].rotation.set(c.th[1] * 0.35, THUMB_YAW + c.th[0] * 0.8, 0);
    this.thumb[1].rotation.x = c.th[1] * 0.65;
    this.thumb[2].rotation.x = c.th[2];
  }

  update(dt: number, clock: number): void {
    this.t = clock;
    const k = 1 - Math.exp(-14 * clamp(dt, 0, 0.1));
    this.applyPose(k, this.t);
  }

  dispose(): void {
    this.geo.dispose();
    this.mat.dispose();
    this.mesh.skeleton.dispose();
  }
}

// ------------------------------------------------------------------------------------------------------ UI helpers
function lightRig(scene: THREE.Scene): void {
  scene.add(new THREE.HemisphereLight(0xcdd6ff, 0x3a3560, 2.6));
  const d = new THREE.DirectionalLight(0xfff0dc, 3.2);
  d.position.set(-1.2, 2.2, -2.6);
  scene.add(d);
}

export interface ThingEmblemOptions {
  pose?: ThingPose;
  reducedMotion?: boolean;
  /** CSS size is taken from the canvas; this caps the device pixel ratio (default 2) */
  maxPixelRatio?: number;
}

export interface ThingEmblem {
  setPose(p: ThingPose): void;
  /** draw one frame now (used when animation is paused / reduced motion) */
  renderOnce(): void;
  start(): void;
  stop(): void;
  dispose(): void;
}

function frame(camera: THREE.PerspectiveCamera, pose: ThingPose, aspect: number): void {
  const upright = POSES[pose].rx > 0.9 || pose === 'thumbsUp';
  camera.aspect = aspect;
  camera.fov = 34;
  if (upright) {
    camera.position.set(0.0, 0.4, -1.45);
    camera.lookAt(0, 0.42, 0);
  } else {
    camera.position.set(0.0, 0.55, -1.4);
    camera.lookAt(0, 0.2, -0.1);
  }
  camera.updateProjectionMatrix();
}

/** Live Thing in its own small WebGL canvas (transparent background). Dispose it when the panel unmounts. */
export function createThingEmblem(canvas: HTMLCanvasElement, opts: ThingEmblemOptions = {}): ThingEmblem {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: false });
  renderer.setClearColor(0x000000, 0);
  const scene = new THREE.Scene();
  lightRig(scene);
  const camera = new THREE.PerspectiveCamera(34, 1, 0.05, 20);
  const rig = new ThingRig({ reducedMotion: opts.reducedMotion, glow: 0.3 });
  rig.root.rotation.y = 0.3;
  rig.setPose(opts.pose ?? 'stand');
  scene.add(rig.root);
  let raf = 0;
  let last = 0;
  let clock = 0;
  const size = (): void => {
    const w = Math.max(1, canvas.clientWidth || canvas.width), h = Math.max(1, canvas.clientHeight || canvas.height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, opts.maxPixelRatio ?? 2));
    renderer.setSize(w, h, false);
    frame(camera, rig.getPose(), w / h);
  };
  size();
  const draw = (dt: number): void => {
    clock += dt;
    rig.update(dt, clock);
    frame(camera, rig.getPose(), camera.aspect);
    renderer.render(scene, camera);
  };
  const loop = (now: number): void => {
    raf = requestAnimationFrame(loop);
    const dt = last ? Math.min(0.1, (now - last) / 1000) : 0.016;
    last = now;
    draw(dt);
  };
  return {
    setPose(p) { rig.setPose(p); if (opts.reducedMotion) { for (let i = 0; i < 30; i++) draw(1 / 30); } },
    renderOnce() { size(); draw(1 / 30); },
    start() { if (!raf && !opts.reducedMotion) { last = 0; raf = requestAnimationFrame(loop); } else if (opts.reducedMotion) { for (let i = 0; i < 30; i++) draw(1 / 30); } },
    stop() { if (raf) cancelAnimationFrame(raf); raf = 0; },
    dispose() {
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      rig.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
    },
  };
}

/** Render a still of Thing in `pose` and return it as a PNG data URL (transparent background). Creates and frees its own context. */
export function renderThingPng(pose: ThingPose, size = 256): string {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1);
  renderer.setSize(size, size, false);
  renderer.setClearColor(0x000000, 0);
  const scene = new THREE.Scene();
  lightRig(scene);
  const camera = new THREE.PerspectiveCamera(34, 1, 0.05, 20);
  const rig = new ThingRig({ reducedMotion: true, glow: 0.3 });
  rig.root.rotation.y = 0.3;
  rig.setPose(pose);
  scene.add(rig.root);
  for (let i = 0; i < 40; i++) rig.update(1 / 30, i / 30);
  frame(camera, pose, 1);
  renderer.render(scene, camera);
  const url = canvas.toDataURL('image/png');
  rig.dispose();
  renderer.dispose();
  renderer.forceContextLoss();
  return url;
}
