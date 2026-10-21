// The Hyde on land: the lake Hyde's look (hunched indigo monster, horns, pale claws, tattered cloak, glowing eyes) rebuilt as a
// walking biped with mode-driven body language. Models face -Z; ~3.3 m tall; root at ground level.
import * as THREE from 'three';
import type { HydeMode } from '../../mystery/types.ts';
import { basicVC, lambertVC } from '../actors.ts';
import { MeshBuilder, clamp, damp, lerp, mulberry32, smoothstep } from '../util.ts';
import { BOX, CONE4, CONE5, CYL6, ICO0, ICO1 } from './common.ts';

const SKIN = ['#161946', '#1b1f50', '#13163d'];
const BONE = '#d8d2f0';
const SPINE = '#4a3fa0';
const THIGH = 0.82;
const SHIN = 0.8;
const UPPER = 1.0;
const FORE = 1.1;

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
  /** direction (yaw, world) toward a point of interest for the head (lure / last known) */
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

interface Pose { lean: number; crouch: number; headYaw: number; headPitch: number; headRoll: number; armFwd: number; armSwing: number; elbow: number; spread: number; jaw: number; legAmp: number; scale: number }

function pose(): Pose {
  return { lean: 0.2, crouch: 0, headYaw: 0, headPitch: 0, headRoll: 0, armFwd: 0.05, armSwing: 0.3, elbow: 0.2, spread: 0.1, jaw: 0, legAmp: 0.5, scale: 1 };
}

export class HydeBiped {
  readonly root = new THREE.Group();
  readonly look: HydeLook = { eyeColor: new THREE.Color('#ffb04a'), eyeScale: 1, lightIntensity: 0 };
  readonly headWorld = new THREE.Vector3();
  readonly chestWorld = new THREE.Vector3();
  readonly eyeL = new THREE.Vector3();
  readonly eyeR = new THREE.Vector3();
  readonly light: THREE.PointLight;
  private readonly body = new THREE.Group();
  private readonly chest = new THREE.Group();
  private readonly head = new THREE.Group();
  private readonly jaw = new THREE.Group();
  private readonly cloak = new THREE.Group();
  private readonly hair = new THREE.Group();
  private readonly arms: { sh: THREE.Group; el: THREE.Group }[] = [];
  private readonly legs: { hip: THREE.Group; knee: THREE.Group }[] = [];
  private readonly skinMat: THREE.MeshLambertMaterial;
  private readonly stoneMat: THREE.MeshLambertMaterial;
  private readonly eyeMat: THREE.MeshBasicMaterial;
  private readonly skinMeshes: THREE.Mesh[] = [];
  private readonly eyes: THREE.Mesh;
  private readonly geos: THREE.BufferGeometry[] = [];
  private readonly p = pose();
  private phase = 0;
  private stone = 0;
  private frost = 0;
  private shock = 0;
  private pin = 0;
  private lunge = 0;
  private yawSm = 0;
  private yawInit = false;
  private tmpQ = new THREE.Quaternion();
  private tmpV = new THREE.Vector3();
  private readonly legTmp: [number, number][] = [[0, 0], [0, 0]];

  constructor() {
    const rand = mulberry32(666);
    const pk = (): string => SKIN[Math.floor(rand() * SKIN.length)];
    this.skinMat = lambertVC({ emissive: new THREE.Color(0.02, 0.02, 0.08), emissiveIntensity: 1 });
    this.stoneMat = new THREE.MeshLambertMaterial({ color: new THREE.Color('#8e93ab'), flatShading: true, emissive: new THREE.Color('#1c1f2c') });
    this.eyeMat = basicVC({ fog: false });
    const mesh = (geo: THREE.BufferGeometry, parent: THREE.Object3D): THREE.Mesh => {
      this.geos.push(geo);
      const m = new THREE.Mesh(geo, this.skinMat);
      parent.add(m);
      this.skinMeshes.push(m);
      return m;
    };
    this.root.add(this.body);

    // ---- legs
    for (const s of [-1, 1]) {
      const hip = new THREE.Group();
      hip.position.set(s * 0.42, 0, 0);
      this.body.add(hip);
      const th = new MeshBuilder(rand);
      th.add(CYL6, pk(), [0, -THIGH / 2, 0], [0, 0, 0], [0.26, THIGH, 0.26], { gradient: 0.1 });
      th.add(ICO0, '#1f2354', [0, 0.02, 0], [0, 0, 0], [0.36, 0.3, 0.36], { gradient: 0.1 });
      mesh(th.build(), hip);
      const knee = new THREE.Group();
      knee.position.set(0, -THIGH, 0);
      hip.add(knee);
      const sh = new MeshBuilder(rand);
      sh.add(ICO0, '#1f2354', [0, 0, -0.04], [0, 0, 0], 0.26, { gradient: 0.1 });
      sh.add(CYL6, pk(), [0, -SHIN / 2, 0], [0, 0, 0], [0.2, SHIN, 0.2], { gradient: 0.1 });
      sh.add(BOX, '#1d2050', [0, -SHIN + 0.06, -0.16], [0, 0, 0], [0.4, 0.16, 0.6], { gradient: 0.1 });
      for (let i = -1; i <= 1; i++) sh.add(CONE4, BONE, [i * 0.12, -SHIN + 0.08, -0.52], [-Math.PI / 2 - 0.15, 0, 0], [0.06, 0.28, 0.06], { gradient: 0, jitter: 0.03 });
      mesh(sh.build(), knee);
      this.legs.push({ hip, knee });
    }

    // ---- torso (pivot at the waist)
    this.chest.position.set(0, 0.1, 0);
    this.body.add(this.chest);
    const torso = new MeshBuilder(rand);
    torso.add(ICO0, pk(), [0, 0.3, 0], [0, 0, 0], [0.62, 0.55, 0.5], { gradient: 0.1 }); // belly
    torso.add(ICO1, pk(), [0, 1.05, -0.05], [0.2, 0, 0], [0.95, 0.85, 0.7], { gradient: 0.15 }); // chest
    torso.add(ICO1, '#1a1e52', [0, 1.55, 0.3], [0.2, 0, 0], [0.8, 0.6, 0.65], { gradient: 0.1 }); // hunched back
    torso.add(ICO0, pk(), [-0.98, 1.55, -0.1], [0, 0, 0], [0.5, 0.42, 0.5]);
    torso.add(ICO0, pk(), [0.98, 1.55, -0.1], [0, 0, 0], [0.5, 0.42, 0.5]);
    torso.add(CYL6, pk(), [0, 1.85, -0.38], [0.6, 0, 0], [0.24, 0.55, 0.24]); // neck
    for (let i = 0; i < 7; i++) {
      const f = i / 6;
      torso.add(CONE4, SPINE, [0, 1.95 - f * 1.35, 0.5 + f * 0.1], [0.9 + f * 0.2, 0, 0], [0.14, 0.6 - f * 0.18, 0.14], { gradient: 0, jitter: 0.05 });
    }
    mesh(torso.build(), this.chest);

    // ---- cloak tatters
    this.cloak.position.set(0, 1.7, 0.2);
    this.chest.add(this.cloak);
    const cl = new MeshBuilder(rand);
    for (let i = 0; i < 11; i++) {
      const x = (i / 10 - 0.5) * 1.8;
      const len = 1.2 + rand() * 1.1;
      cl.add(CONE4, i % 2 ? '#15183f' : '#1a1e4c', [x, -len * 0.5, 0.3 + rand() * 0.2], [0.1 + rand() * 0.15, 0, Math.PI + (rand() - 0.5) * 0.3], [0.32, len, 0.08], { gradient: 0, jitter: 0.12 });
    }
    mesh(cl.build(), this.cloak);

    // ---- head
    this.head.position.set(0, 2.0, -0.62);
    this.chest.add(this.head);
    const hb = new MeshBuilder(rand);
    hb.add(ICO1, '#232865', [0, 0, 0], [0, 0, 0], [0.4, 0.36, 0.5], { gradient: 0.1 });
    hb.add(BOX, '#0b0d2a', [0, 0.1, -0.4], [0.1, 0, 0], [0.56, 0.1, 0.25], { gradient: 0, jitter: 0.05 }); // brow shadow
    hb.add(CONE5, BONE, [-0.3, 0.34, 0.12], [-0.8, 0, 0.55], [0.1, 0.75, 0.1], { gradient: 0, jitter: 0.05 }); // horns
    hb.add(CONE5, BONE, [0.3, 0.34, 0.12], [-0.8, 0, -0.55], [0.1, 0.75, 0.1], { gradient: 0, jitter: 0.05 });
    hb.add(CONE4, '#2a2f78', [-0.4, 0.04, 0.15], [0, 0, 1.25], [0.08, 0.36, 0.08], { gradient: 0 }); // ears
    hb.add(CONE4, '#2a2f78', [0.4, 0.04, 0.15], [0, 0, -1.25], [0.08, 0.36, 0.08], { gradient: 0 });
    mesh(hb.build(), this.head);
    this.jaw.position.set(0, -0.22, -0.2);
    this.head.add(this.jaw);
    const jb = new MeshBuilder(rand);
    jb.add(BOX, '#0d1030', [0, -0.04, -0.2], [0.05, 0, 0], [0.32, 0.12, 0.48], { gradient: 0, jitter: 0.04 });
    for (let i = -2; i <= 2; i++) jb.add(CONE4, BONE, [i * 0.065, 0.06, -0.4], [0, 0, 0], [0.03, 0.12, 0.03], { gradient: 0, jitter: 0 });
    mesh(jb.build(), this.jaw);
    const eyes = new MeshBuilder(rand);
    for (const s of [-1, 1]) {
      eyes.add(BOX, '#ffd86a', [s * 0.19, 0.06, -0.47], [0, 0, -s * 0.38], [0.17, 0.05, 0.05], { jitter: 0, gradient: 0 });
      eyes.add(BOX, '#fff6c8', [s * 0.19, 0.06, -0.5], [0, 0, -s * 0.38], [0.09, 0.025, 0.03], { jitter: 0, gradient: 0 });
    }
    const eg = eyes.build();
    this.geos.push(eg);
    this.eyes = new THREE.Mesh(eg, this.eyeMat);
    this.head.add(this.eyes);
    this.light = new THREE.PointLight(new THREE.Color('#ff8a40'), 0, 20, 1.7);
    this.light.position.set(0, 0.1, -0.7);
    this.head.add(this.light);

    // ---- hair
    this.hair.position.set(0, 0.2, 0.3);
    this.head.add(this.hair);
    const hr = new MeshBuilder(rand);
    for (let i = 0; i < 8; i++) {
      const len = 0.9 + rand() * 0.8;
      hr.add(CONE4, '#0c0f2c', [(rand() - 0.5) * 0.5, (rand() - 0.5) * 0.15, 0.1 + len * 0.4], [Math.PI / 2 + 0.55 + rand() * 0.3, 0, (rand() - 0.5) * 0.6], [0.08, len, 0.05], { gradient: 0, jitter: 0.1 });
    }
    mesh(hr.build(), this.hair);

    // ---- arms (shoulder -> upper, elbow -> forearm + hand with claws)
    for (const s of [-1, 1]) {
      const sh = new THREE.Group();
      sh.position.set(s * 1.0, 1.55, -0.1);
      this.chest.add(sh);
      const up = new MeshBuilder(rand);
      up.add(CYL6, pk(), [0, -UPPER / 2, 0], [0, 0, 0], [0.24, UPPER, 0.24], { gradient: 0.1 });
      up.add(ICO0, '#1b1f4f', [0, 0, 0], [0, 0, 0], 0.34, { gradient: 0.1 });
      up.add(CONE4, SPINE, [s * 0.22, -0.1, 0.02], [0, 0, s * -1.3], [0.08, 0.34, 0.08], { gradient: 0 });
      mesh(up.build(), sh);
      const el = new THREE.Group();
      el.position.set(0, -UPPER, 0);
      sh.add(el);
      const fo = new MeshBuilder(rand);
      fo.add(ICO0, '#1b1f4f', [0, 0, 0], [0, 0, 0], 0.26, { gradient: 0.1 });
      fo.add(CYL6, pk(), [0, -FORE / 2, 0], [0, 0, 0], [0.2, FORE, 0.2], { gradient: 0.1 });
      fo.add(CONE4, SPINE, [0, -0.1, 0.22], [-1.1, 0, 0], [0.08, 0.36, 0.08], { gradient: 0 });
      fo.add(ICO1, '#1f2358', [0, -FORE - 0.08, 0], [0, 0, 0], [0.3, 0.22, 0.32], { gradient: 0.1 });
      for (let i = 0; i < 4; i++) {
        const x = (i - 1.5) * 0.14;
        const spr = (i - 1.5) * 0.13;
        fo.add(CONE4, BONE, [x + spr * 0.7, -FORE - 0.5, -0.1], [-0.3, 0, spr], [0.06, 0.7, 0.06], { gradient: 0, jitter: 0.04 });
      }
      fo.add(CONE4, BONE, [s * 0.3, -FORE - 0.3, -0.1], [-0.3, 0, s * 0.95], [0.06, 0.5, 0.06], { gradient: 0, jitter: 0.04 });
      mesh(fo.build(), el);
      this.arms.push({ sh, el });
    }
  }

  private legAng(p: number, amp: number, knee: number, out: [number, number]): void {
    out[0] = Math.sin(p) * amp;
    out[1] = Math.max(0, Math.cos(p)) * knee + 0.08;
  }

  private targetPose(f: HydeFrame, t: Pose): void {
    const w = Math.sin(f.clock * 0.6);
    t.lean = 0.2; t.crouch = 0; t.headYaw = 0; t.headPitch = 0; t.headRoll = 0;
    t.armFwd = 0.05; t.armSwing = 0.35; t.elbow = 0.25; t.spread = 0.1; t.jaw = 0; t.legAmp = 0.5; t.scale = 1;
    switch (f.mode) {
      case 'PATROL':
        t.lean = 0.2; t.headYaw = w * 0.55; t.headPitch = 0.05; t.armSwing = 0.35; t.legAmp = 0.5;
        break;
      case 'INVESTIGATE_SOUND':
        t.lean = 0.34; t.crouch = 0.1; t.headRoll = 0.42; t.headPitch = -0.05 + Math.sin(f.clock * 7) * 0.09; t.headYaw = 0.25;
        t.armFwd = 0.3; t.elbow = 0.7; t.spread = 0.28; t.armSwing = 0.28; t.legAmp = 0.55; t.jaw = 0.12 + Math.max(0, Math.sin(f.clock * 7)) * 0.1;
        break;
      case 'SEARCH':
        t.lean = 0.42; t.crouch = 0.18; t.headYaw = Math.sin(f.clock * 1.5) * 0.95; t.headPitch = 0.12;
        t.armFwd = 0.55; t.elbow = 0.8; t.spread = 0.5 + Math.sin(f.clock * 1.5) * 0.15; t.armSwing = 0.25; t.legAmp = 0.45;
        break;
      case 'CHASE':
        t.lean = 0.72; t.crouch = 0.2; t.headPitch = -0.15; t.headYaw = 0; t.armFwd = 0.45; t.armSwing = 0.95; t.elbow = 0.9;
        t.spread = 0.2; t.legAmp = 0.95; t.jaw = 0.5 + Math.sin(f.clock * 9) * 0.1; t.scale = 1.06;
        break;
      case 'COOLDOWN':
        t.lean = 0.38; t.crouch = 0.08; t.headPitch = 0.3; t.headYaw = Math.sin(f.clock * 0.9) * 0.3; t.armSwing = 0.2; t.armFwd = 0.0; t.jaw = 0.18 + Math.sin(f.clock * 5) * 0.08; t.legAmp = 0.4;
        break;
    }
    if (f.grabbing) { t.armFwd = 1.55; t.elbow = 0.25; t.spread = 0.18; t.lean = 0.95; t.armSwing = 0.1; t.jaw = 0.75; t.headPitch = -0.2; }
    if (f.distracted && !f.grabbing) {
      t.headYaw = f.lookYaw !== null ? clamp(f.lookYaw, -1.2, 1.2) : Math.sin(f.clock * 1.4) * 0.8;
      t.headRoll = 0.25 * Math.sin(f.clock * 2.2); t.lean = Math.min(t.lean, 0.2); t.armSwing *= 0.5;
    } else if (f.lookYaw !== null && f.mode !== 'CHASE' && !f.grabbing && f.mode !== 'PATROL') {
      t.headYaw = clamp(f.lookYaw, -1.0, 1.0) * 0.8 + t.headYaw * 0.3;
    }
    if (f.stunned) { t.lean = 0.55; t.headPitch = -0.45; t.armFwd = 0.1; t.elbow = 1.2; t.jaw = 0.4; t.armSwing = 0; t.legAmp = 0.1; }
  }

  update(f: HydeFrame): void {
    const dt = f.dt;
    if (!this.yawInit) { this.yawSm = f.bodyYaw; this.yawInit = true; }
    // tint: stone / frost / shock
    this.stone = damp(this.stone, f.petrified ? 1 : 0, 9, dt);
    this.frost = damp(this.frost, f.slowed ? 1 : 0, 4, dt);
    this.shock = damp(this.shock, f.stunned && !f.petrified && !f.pinned ? 1 : 0, 10, dt);
    this.pin = damp(this.pin, f.pinned ? 1 : 0, 8, dt);
    const useStone = this.stone > 0.5;
    for (const m of this.skinMeshes) m.material = useStone ? this.stoneMat : this.skinMat;
    this.eyes.visible = !useStone;
    const fl = this.shock * (0.5 + 0.5 * Math.sin(f.clock * 38)) * 0.28;
    this.skinMat.emissive.setRGB(0.02 + this.frost * 0.05 + fl * 0.5, 0.02 + this.frost * 0.2 + fl * 0.5 + this.pin * 0.16, 0.08 + this.frost * 0.3 + fl * 0.6 + this.pin * 0.1);
    const fade = clamp(f.fade, 0, 1);
    const wantT = fade > 0.03;
    for (const m of [this.skinMat, this.stoneMat]) {
      if (m.transparent !== wantT) { m.transparent = wantT; m.needsUpdate = true; }
      m.opacity = 1 - 0.7 * fade;
      m.depthWrite = fade < 0.4;
    }
    this.stoneMat.color.setRGB(lerp(0.55, 0.62, this.frost), lerp(0.56, 0.68, this.frost), lerp(0.66, 0.78, this.frost));

    const frozen = f.petrified || !!f.pinned;
    if (!frozen) {
      const t = pose();
      this.targetPose(f, t);
      const P = this.p;
      const k = 1 - Math.exp(-(f.grabbing ? 18 : 7) * dt);
      for (const key of Object.keys(P) as (keyof Pose)[]) P[key] = lerp(P[key], t[key], k);
      const slowK = f.slowed ? 0.85 : 1;
      this.phase += dt * f.speed * slowK * (Math.PI * 2) / 2.7;
      this.lunge = damp(this.lunge, f.grabbing ? 1 : 0, 16, dt);
    }
    // body yaw easing (visual only)
    if (!frozen) {
      let d = f.bodyYaw - this.yawSm;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      this.yawSm += d * (1 - Math.exp(-14 * dt));
    }
    this.root.rotation.y = this.yawSm;
    const P = this.p;
    this.root.scale.setScalar(P.scale * 1.2);

    // legs
    const moving = clamp(f.speed / 1.2, 0, 1);
    const amp = P.legAmp * moving, kneeAmp = (0.7 + P.legAmp * 0.8) * moving;
    this.legAng(this.phase, amp, kneeAmp, this.legTmp[0]);
    this.legAng(this.phase + Math.PI, amp, kneeAmp, this.legTmp[1]);
    let hipY = 0;
    const cb = 0.7 * P.crouch * 1.4, ck = 1.2 * P.crouch * 1.4;
    for (let i = 0; i < 2; i++) {
      const a = this.legTmp[i][0] + cb;
      const b = Math.min(2.1, this.legTmp[i][1] + ck);
      this.legs[i].hip.rotation.x = a;
      this.legs[i].knee.rotation.x = -b;
      hipY = Math.max(hipY, THIGH * Math.cos(a) + SHIN * Math.cos(a - b));
    }
    const breath = Math.sin(f.clock * (f.mode === 'COOLDOWN' ? 5 : 1.7)) * (f.mode === 'COOLDOWN' ? 0.04 : 0.015);
    const trem = this.shock * Math.sin(f.clock * 55) * 0.04;
    this.body.position.set(trem, hipY + Math.sin(this.phase * 2) * 0.05 * moving, -this.lunge * 0.5);
    this.chest.rotation.set(-P.lean + breath, Math.sin(this.phase) * 0.14 * moving, Math.sin(this.phase) * 0.04 * moving + trem);
    this.head.rotation.set(P.lean * 0.7 - P.headPitch, P.headYaw, P.headRoll);
    this.jaw.rotation.x = P.jaw;
    // arms
    for (let i = 0; i < 2; i++) {
      const s = i === 0 ? -1 : 1;
      const sw = Math.sin(this.phase + (i === 0 ? Math.PI : 0)) * P.armSwing * moving;
      const idle = Math.sin(f.clock * 1.3 + i) * 0.04;
      this.arms[i].sh.rotation.set(P.armFwd + sw + idle + (P.lean * 0.0), 0, s * P.spread);
      this.arms[i].el.rotation.x = P.elbow + Math.max(0, sw) * 0.5;
    }
    // cloak / hair trail behind (negative x = backwards for hanging parts)
    const trail = clamp(f.speed / 5, 0, 1);
    this.cloak.rotation.set(-0.08 - trail * 0.65 + Math.sin(f.clock * 1.7) * 0.05, 0, Math.sin(f.clock * 1.3) * 0.05);
    this.hair.rotation.set(-trail * 0.5 + Math.sin(f.clock * 2.3) * 0.06, 0, Math.sin(f.clock * 1.1) * 0.06);

    // eye look: colour by mode / state
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
    this.eyeMat.color.set(col);
    L.lightIntensity = (useStone ? 0 : li) * (1 - fade);
    this.light.color.copy(L.eyeColor);
    this.light.intensity = L.lightIntensity;

    // world positions for the scene's glow billboards
    this.root.updateWorldMatrix(true, true);
    this.head.getWorldPosition(this.headWorld);
    this.chest.localToWorld(this.chestWorld.set(0, 1.1, 0));
    this.head.getWorldQuaternion(this.tmpQ);
    for (const s of [-1, 1]) {
      this.tmpV.set(s * 0.19, 0.06, -0.55);
      this.head.localToWorld(this.tmpV);
      (s < 0 ? this.eyeL : this.eyeR).copy(this.tmpV);
    }
    void smoothstep;
  }

  get stoneAmount(): number { return this.stone; }
  get frostAmount(): number { return this.frost; }

  dispose(): void {
    for (const g of this.geos) g.dispose();
    this.skinMat.dispose(); this.stoneMat.dispose(); this.eyeMat.dispose();
    this.light.dispose();
  }
}
