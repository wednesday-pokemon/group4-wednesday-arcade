// The Hyde: a hunched, monstrous wader with very long arms and large pale claws, glowing eyes and tattered cloak/hair.
// Driven entirely by HydeState (phase / visibility / threat / speed / heading / decoy). Never gory: silhouette, glow,
// water and spray carry the menace. Lower body is clipped at the water plane so he rises out of the lake.
import * as THREE from 'three';
import type { HydeState, Vec2 } from '../../action/types.ts';
import { lambertVC, basicVC } from '../actors.ts';
import type { ParticlePool } from '../particles.ts';
import { MeshBuilder, clamp, damp, lerp, mulberry32, smoothstep } from '../util.ts';
import { BillboardField, createGlowFieldMaterial, type FxUniforms } from './fx.ts';
import { TriBuilder, bearing, wrapAngle } from './geom.ts';

const ICO0 = new THREE.IcosahedronGeometry(1, 0);
const ICO1 = new THREE.IcosahedronGeometry(1, 1);
const CYL6 = new THREE.CylinderGeometry(1, 1, 1, 6, 1);
const CONE4 = new THREE.ConeGeometry(1, 1, 4, 1);
const CONE5 = new THREE.ConeGeometry(1, 1, 5, 1);
const CONE8 = new THREE.ConeGeometry(1, 1, 8, 1);
const BOX = new THREE.BoxGeometry(1, 1, 1);

const SKIN = ['#262a63', '#2a2f6c', '#222659'];
const BONE = '#cfc9ea';
/** global size multiplier: he must read as a looming giant from a chase camera 20-40 u away */
const SIZE = 1.5;
const SPINE = '#3a3380';

export interface HydeFrameInput {
  dt: number;
  clock: number;
  boat: { x: number; z: number };
  reduced: boolean;
  low: boolean;
  slowed: boolean;
  distracted: boolean;
  decoy: Vec2 | null;
  rescueActive: boolean;
  /** 0..1: how far into a surge telegraph (rears up, eyes flare, water churns) */
  telegraph?: number;
  /** camera position: the back-light halo is pushed away from it so the dark body silhouettes against the glow */
  cam?: { x: number; y: number; z: number };
  /** 0..1: how see-through the body should be (the camera's view of the boat is blocked by him) */
  fade?: number;
}

export interface HydeFrameInfo {
  visible: boolean;
  scale: number;
  emergeStarted: boolean;
  strikeNow: boolean;
  /** world position of the head (for camera framing) */
  head: THREE.Vector3;
  vis: number;
  threat: number;
}

function ease(t: number): number {
  return 1 - Math.pow(1 - clamp(t, 0, 1), 3);
}

export class HydeActor {
  readonly root = new THREE.Group();
  readonly field: BillboardField;
  readonly light: THREE.PointLight;
  readonly info: HydeFrameInfo = { visible: false, scale: 1, emergeStarted: false, strikeNow: false, head: new THREE.Vector3(), vis: 0, threat: 0 };
  private readonly body = new THREE.Group(); // rises/sinks
  private readonly chest = new THREE.Group();
  private readonly head = new THREE.Group();
  private readonly hair = new THREE.Group();
  private readonly cloak = new THREE.Group();
  private readonly arms: { shoulder: THREE.Group; elbow: THREE.Group; hand: THREE.Group }[] = [];
  private readonly shadow: THREE.Mesh;
  private readonly rings: THREE.Mesh[] = [];
  private readonly bodyMat: THREE.MeshLambertMaterial;
  private readonly clip = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0.02);
  private readonly mats: THREE.Material[] = [];
  private readonly geos: THREE.BufferGeometry[] = [];
  private readonly tmp = new THREE.Vector3();
  private readonly tmp2 = new THREE.Vector3();
  private readonly quat = new THREE.Quaternion();
  private readonly eyeCol = new THREE.Color('#ff8a3a');
  private readonly auraCol = new THREE.Color('#7a5cf0');
  private readonly underCol = new THREE.Color('#6fd8e8');
  private vis = 0;
  private threat = 0;
  private cycle = 0;
  private prevPhase = '';
  private bubbleAcc = 0;
  private sprayAcc = 0;
  private splashT = 2;
  private lean = 0;
  private lungeShift = 0;
  private strikeFired = false;
  private telePulse = 0;
  private ringClock = 0;
  private frost = 0;
  private headYaw = 0;
  private armPose = [{ s: 0, e: 0, z: 0 }, { s: 0, e: 0, z: 0 }];

  constructor(u: FxUniforms, private readonly particles: ParticlePool) {
    const rand = mulberry32(666);
    const pk = () => SKIN[Math.floor(rand() * SKIN.length)];
    this.bodyMat = lambertVC({ emissive: new THREE.Color(0.035, 0.03, 0.1), emissiveIntensity: 1 });
    this.bodyMat.clippingPlanes = [this.clip];
    this.mats.push(this.bodyMat);
    this.root.add(this.body);

    // ---- submerged tattered cloak / floating skirt (waist at y = 0.9)
    const lower = new MeshBuilder(rand);
    lower.add(CONE8, '#070920', [0, 0.1, 0.1], [0, 0, 0], [2.2, 2.4, 2.0], { gradient: 0.1, jitter: 0.06 });
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      const r = 1.9 + rand() * 1.1;
      lower.add(CONE4, '#0c0e28', [Math.cos(a) * r, 0.1, Math.sin(a) * r * 0.9], [Math.PI / 2 + 0.2, 0, -a + Math.PI / 2], [0.5, 1.6 + rand() * 1.2, 0.18], { gradient: 0, jitter: 0.1 });
    }
    this.addMesh(this.body, lower.build());

    // ---- chest (pivot at the waist)
    this.chest.position.set(0, 0.9, 0);
    this.body.add(this.chest);
    const torso = new MeshBuilder(rand);
    torso.add(ICO0, pk(), [0, 0.35, 0.05], [0.3, 0, 0], [1.15, 1.0, 0.95], { gradient: 0.1 }); // belly
    torso.add(ICO1, pk(), [0, 1.35, 0], [0.35, 0, 0], [1.5, 1.55, 1.2], { gradient: 0.15 }); // chest
    torso.add(ICO1, '#14173d', [0, 2.15, 0.7], [0.2, 0, 0], [1.2, 1.0, 1.05], { gradient: 0.1 }); // hunched back
    torso.add(ICO0, pk(), [-1.5, 2.15, -0.2], [0, 0, 0], [0.95, 0.75, 0.95]); // shoulders
    torso.add(ICO0, pk(), [1.5, 2.15, -0.2], [0, 0, 0], [0.95, 0.75, 0.95]);
    torso.add(CYL6, pk(), [0, 2.5, -0.75], [0.7, 0, 0], [0.42, 0.95, 0.42]); // neck
    for (let i = 0; i < 7; i++) {
      const f = i / 6;
      torso.add(CONE4, SPINE, [0, 3.05 - f * 1.9, 0.95 + f * 0.35], [0.9 + f * 0.15, 0, 0], [0.24, 1.05 - f * 0.4, 0.24], { gradient: 0, jitter: 0.05 });
    }
    this.addMesh(this.chest, torso.build());

    // ---- cloak tatters hanging from the shoulders (swayed in update)
    this.cloak.position.set(0, 2.3, 0.4);
    this.chest.add(this.cloak);
    const cloak = new MeshBuilder(rand);
    for (let i = 0; i < 11; i++) {
      const x = (i / 10 - 0.5) * 2.8;
      const len = 2.2 + rand() * 1.8;
      cloak.add(CONE4, i % 2 ? '#0b0d26' : '#10122f', [x, -len * 0.5, 0.35 + rand() * 0.3], [0.12 + rand() * 0.15, 0, Math.PI + (rand() - 0.5) * 0.3], [0.5, len, 0.12], { gradient: 0, jitter: 0.12 });
    }
    this.addMesh(this.cloak, cloak.build());

    // ---- head
    this.head.position.set(0, 3.0, -1.45);
    this.chest.add(this.head);
    const headB = new MeshBuilder(rand);
    headB.add(ICO1, '#161a44', [0, 0, 0], [0, 0, 0], [0.62, 0.56, 0.8], { gradient: 0.1 });
    headB.add(BOX, '#0b0d27', [0, -0.36, -0.55], [0.1, 0, 0], [0.5, 0.2, 0.75], { gradient: 0, jitter: 0.05 }); // jaw
    for (let i = -2; i <= 2; i++) headB.add(CONE4, BONE, [i * 0.1, -0.2, -0.88], [Math.PI, 0, 0], [0.04, 0.17, 0.04], { gradient: 0, jitter: 0 }); // small fangs, no blood
    headB.add(BOX, '#07081a', [0, 0.2, -0.68], [0.1, 0, 0], [0.86, 0.14, 0.4], { gradient: 0, jitter: 0 }); // heavy brow shadow
    headB.add(CONE5, BONE, [-0.46, 0.55, 0.2], [-0.8, 0, 0.55], [0.15, 1.15, 0.15], { gradient: 0, jitter: 0.05 }); // horns
    headB.add(CONE5, BONE, [0.46, 0.55, 0.2], [-0.8, 0, -0.55], [0.15, 1.15, 0.15], { gradient: 0, jitter: 0.05 });
    headB.add(CONE4, '#1b1e4c', [-0.62, 0.05, 0.25], [0, 0, 1.25], [0.12, 0.55, 0.12], { gradient: 0 });
    headB.add(CONE4, '#1b1e4c', [0.62, 0.05, 0.25], [0, 0, -1.25], [0.12, 0.55, 0.12], { gradient: 0 });
    this.addMesh(this.head, headB.build());
    const eyes = new MeshBuilder(rand);
    for (const s of [-1, 1]) {
      eyes.add(BOX, '#ffd86a', [s * 0.3, 0.09, -0.74], [0, 0, -s * 0.38], [0.26, 0.075, 0.08], { jitter: 0, gradient: 0 });
      eyes.add(BOX, '#fff6c8', [s * 0.3, 0.09, -0.79], [0, 0, -s * 0.38], [0.14, 0.04, 0.05], { jitter: 0, gradient: 0 });
    }
    const eyeMat = basicVC({ fog: false });
    this.mats.push(eyeMat);
    const eyeGeo = eyes.build();
    this.geos.push(eyeGeo);
    this.head.add(new THREE.Mesh(eyeGeo, eyeMat));
    this.light = new THREE.PointLight(new THREE.Color('#ff8a40'), 0, 26, 1.6);
    this.light.position.set(0, 0.15, -1.1);
    this.head.add(this.light);

    // ---- hair tatters trailing behind the head
    this.hair.position.set(0, 0.25, 0.4);
    this.head.add(this.hair);
    const hairB = new MeshBuilder(rand);
    for (let i = 0; i < 9; i++) {
      const len = 1.5 + rand() * 1.3;
      hairB.add(CONE4, '#080a20', [(rand() - 0.5) * 0.7, (rand() - 0.5) * 0.2, 0.2 + len * 0.45], [Math.PI / 2 + 0.55 + rand() * 0.3, 0, (rand() - 0.5) * 0.6], [0.12, len, 0.08], { gradient: 0, jitter: 0.1 });
    }
    this.addMesh(this.hair, hairB.build());

    // ---- arms: shoulder -> upper arm; elbow -> forearm; hand -> palm + big claws
    for (const s of [-1, 1]) {
      const shoulder = new THREE.Group();
      shoulder.position.set(s * 1.55, 2.2, -0.2);
      this.chest.add(shoulder);
      const up = new MeshBuilder(rand);
      up.add(CYL6, pk(), [0, -0.85, 0], [0, 0, 0], [0.36, 1.7, 0.36], { gradient: 0.1 });
      up.add(ICO0, '#181b46', [0, 0, 0], [0, 0, 0], 0.55);
      up.add(CONE4, SPINE, [s * 0.32, -0.2, 0.05], [0, 0, s * -1.3], [0.12, 0.5, 0.12], { gradient: 0 });
      this.addMesh(shoulder, up.build());
      const elbow = new THREE.Group();
      elbow.position.set(0, -1.7, 0);
      shoulder.add(elbow);
      const fore = new MeshBuilder(rand);
      fore.add(ICO0, '#181b46', [0, 0, 0], [0, 0, 0], 0.4);
      fore.add(CYL6, pk(), [0, -0.9, 0], [0, 0, 0], [0.31, 1.8, 0.31], { gradient: 0.1 });
      fore.add(CONE4, SPINE, [0, -0.1, 0.34], [-1.1, 0, 0], [0.12, 0.55, 0.12], { gradient: 0 });
      this.addMesh(elbow, fore.build());
      const hand = new THREE.Group();
      hand.position.set(0, -1.8, 0);
      elbow.add(hand);
      const claws = new MeshBuilder(rand);
      claws.add(ICO1, '#1d2050', [0, -0.12, 0], [0, 0, 0], [0.5, 0.36, 0.52], { gradient: 0.1 });
      for (let i = 0; i < 4; i++) {
        const x = (i - 1.5) * 0.24;
        const spread = (i - 1.5) * 0.17;
        claws.add(CYL6, '#1d2050', [x, -0.4, -0.05], [-0.15, 0, spread], [0.09, 0.45, 0.09], { gradient: 0 });
        claws.add(CONE4, BONE, [x + spread * 0.9, -0.92, -0.2], [-0.35, 0, spread * 1.1], [0.1, 1.25, 0.1], { gradient: 0, jitter: 0.04 });
      }
      claws.add(CONE4, BONE, [s * 0.52, -0.5, -0.18], [-0.3, 0, s * 0.95], [0.09, 0.85, 0.09], { gradient: 0, jitter: 0.04 });
      this.addMesh(hand, claws.build());
      this.arms.push({ shoulder, elbow, hand });
    }

    // ---- underwater shadow: body blob + arms + trailing wisps (dark, translucent)
    const sh = new TriBuilder();
    const dark: [number, number, number] = [1, 1, 1];
    const N = 18;
    for (let i = 0; i < N; i++) {
      const a0 = (i / N) * Math.PI * 2, a1 = ((i + 1) / N) * Math.PI * 2;
      sh.tri([0, 0, 0.3], [Math.cos(a0) * 1.9, 0, 0.3 + Math.sin(a0) * 2.4], [Math.cos(a1) * 1.9, 0, 0.3 + Math.sin(a1) * 2.4], dark, [0, 1, 0]);
    }
    for (const s of [-1, 1]) {
      sh.tri([s * 1.3, 0, -1.2], [s * 2.9, 0, -3.2], [s * 1.9, 0, -3.5], dark, [0, 1, 0]);
      sh.tri([s * 1.3, 0, -1.2], [s * 1.9, 0, -3.5], [s * 0.7, 0, -1.9], dark, [0, 1, 0]);
    }
    for (let i = 0; i < 5; i++) sh.tri([(i - 2) * 0.55, 0, 2.2], [(i - 2) * 0.95 - 0.2, 0, 5.2 + (i % 2) * 1.3], [(i - 2) * 0.95 + 0.2, 0, 2.6], dark, [0, 1, 0]);
    const shGeo = sh.build(false) as THREE.BufferGeometry;
    this.geos.push(shGeo);
    const shMat = new THREE.MeshBasicMaterial({ color: new THREE.Color('#010208'), transparent: true, opacity: 0, depthWrite: false, fog: true });
    this.mats.push(shMat);
    this.shadow = new THREE.Mesh(shGeo, shMat);
    this.shadow.position.y = -0.15;
    this.shadow.renderOrder = -5;
    this.root.add(this.shadow);

    // ---- surface rings: two slow ripples (stalking) + one splash ring (emerging / strikes)
    for (let i = 0; i < 3; i++) {
      const g = new THREE.RingGeometry(0.86, 1, 40, 1).rotateX(-Math.PI / 2);
      const m = new THREE.MeshBasicMaterial({ color: new THREE.Color(i === 2 ? '#dfe9ff' : '#8fa0ff'), transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false });
      const mesh = new THREE.Mesh(g, m);
      mesh.position.y = 0.08;
      mesh.renderOrder = -4;
      this.geos.push(g);
      this.mats.push(m);
      this.rings.push(mesh);
      this.root.add(mesh);
    }

    // ---- eye / aura glows as instanced billboards (world space; positioned each frame)
    const mat = createGlowFieldMaterial(u, false);
    this.mats.push(mat);
    this.field = new BillboardField(4, mat, null, 7);
    for (let i = 0; i < 4; i++) this.field.add({ x: 0, y: -50, z: 0, size: 1, color: '#ffffff', alpha: 0 });
    this.field.flush();

    this.root.visible = false;
    this.field.mesh.visible = false;
  }

  /** Registers the plane that cuts the body at the water surface (renderer must have localClippingEnabled). */
  setWaterLevel(y: number): void {
    this.clip.constant = -y;
  }

  private addMesh(parent: THREE.Object3D, geo: THREE.BufferGeometry): THREE.Mesh {
    this.geos.push(geo);
    const m = new THREE.Mesh(geo, this.bodyMat);
    parent.add(m);
    return m;
  }

  update(h: HydeState | undefined, inp: HydeFrameInput): HydeFrameInfo {
    const info = this.info;
    info.emergeStarted = false;
    info.strikeNow = false;
    if (!h || h.phase === 'dormant') {
      this.vis = damp(this.vis, 0, 6, inp.dt);
      if (this.vis < 0.01) {
        this.root.visible = false;
        this.field.mesh.visible = false;
        this.light.intensity = 0;
        info.visible = false;
        info.vis = 0;
        info.threat = 0;
        this.prevPhase = h ? h.phase : '';
        return info;
      }
    }
    const dt = inp.dt;
    const phase = h?.phase ?? 'dormant';
    const targetVis = h ? clamp(phase === 'dormant' ? 0 : h.visibility, 0, 1) : 0;
    this.vis = damp(this.vis, targetVis, targetVis > this.vis ? 3.2 : 5, dt);
    this.threat = damp(this.threat, h ? clamp(h.threat, 0, 1) : 0, 4, dt);
    const vis = this.vis;
    const threat = this.threat;
    if (phase !== this.prevPhase) {
      if (phase === 'emerging') {
        this.splashT = 0;
        info.emergeStarted = true;
        this.burstSplash(h!, inp, 46, 7);
      }
      if (phase === 'lunging') this.strikeFired = false;
      this.prevPhase = phase;
    }
    const hx = h?.x ?? 0, hz = h?.z ?? 0;
    const heading = h?.heading ?? 0;
    this.root.visible = true;
    this.root.position.set(hx, 0, hz);
    this.root.rotation.y = heading;
    const pt = h?.phaseT ?? 0;

    // ---- visibility mapping: shadow below, body rises with an eased curve
    const emerge = smoothstep(0.12, 0.95, vis);
    const tg = clamp(inp.telegraph ?? 0, 0, 1);
    const surging = phase === 'surging' && tg <= 0; // 'surging' with a telegraph still running = rearing up, not yet bursting
    const scale = SIZE * (0.78 + 0.5 * threat) * (surging ? 1.08 : 1) * (1 + 0.1 * tg);
    this.body.scale.setScalar(scale);
    const rise = -(1 - emerge) * 5.6 * scale;
    this.body.position.y = rise;
    this.body.visible = emerge > 0.015;
    this.cycle += dt * (surging ? 6.2 : phase === 'chasing' ? 2.4 + clamp((h?.speed ?? 0) / 12, 0, 1.2) * 2.2 : phase === 'distracted' ? 1.4 : 1.1);
    const sp = clamp((h?.speed ?? 0) / 12, 0, 1.3);

    // ---- pose targets per phase
    let leanT = 0.15, spread = 0.2;
    const poseS = [0.5, 0.5], poseE = [0.55, 0.55];
    const swing = Math.sin(this.cycle);
    const swingB = Math.sin(this.cycle + Math.PI);
    let headYawT = 0;
    let lungeBlend = 0;
    let shift = 0;
    const toBoat = bearing(hx, hz, inp.boat.x, inp.boat.z);
    const relBoat = clamp(wrapAngle(toBoat - heading), -0.9, 0.9);
    switch (phase) {
      case 'stalking':
        leanT = 0.25; poseS[0] = poseS[1] = 0.9; poseE[0] = poseE[1] = 0.4;
        headYawT = relBoat;
        break;
      case 'emerging': {
        // rear up and spread the arms in a roar, then settle forward
        const p = clamp(pt / 1.7, 0, 1);
        const rear = Math.sin(p * Math.PI);
        leanT = lerp(-0.45, 0.2, ease(p));
        poseS[0] = poseS[1] = lerp(-1.1, 0.7, ease(p * p));
        poseE[0] = poseE[1] = lerp(0.3, 0.7, p);
        spread = 0.2 + rear * 1.0;
        headYawT = relBoat * 0.6;
        break;
      }
      case 'chasing':
        leanT = 0.18 + 0.28 * sp;
        poseS[0] = 0.7 + swing * 0.75;
        poseS[1] = 0.7 + swingB * 0.75;
        poseE[0] = 0.5 + Math.max(0, -swing) * 0.7;
        poseE[1] = 0.5 + Math.max(0, -swingB) * 0.7;
        headYawT = relBoat;
        break;
      case 'surging':
        leanT = 0.62;
        poseS[0] = 0.55 + swing * 1.05;
        poseS[1] = 0.55 + swingB * 1.05;
        poseE[0] = 0.35 + Math.max(0, -swing) * 0.9;
        poseE[1] = 0.35 + Math.max(0, -swingB) * 0.9;
        headYawT = relBoat * 0.7;
        break;
      case 'lunging': {
        const windup = smoothstep(0, 0.32, pt);
        const strike = ease((pt - 0.32) / 0.26);
        const recover = smoothstep(0.6, 1.5, pt);
        lungeBlend = windup;
        leanT = lerp(-0.3, 0.75, strike) * (1 - recover * 0.5);
        const rs = lerp(lerp(0.5, -1.35, windup), 1.85, strike);
        const ls = lerp(lerp(0.5, -0.9, windup), 1.6, ease((pt - 0.4) / 0.26));
        poseS[1] = lerp(rs, 0.9, recover); // right arm (index 1) strikes first
        poseS[0] = lerp(ls, 0.9, recover);
        poseE[1] = lerp(lerp(0.9, 0.1, strike), 0.5, recover);
        poseE[0] = lerp(lerp(0.9, 0.15, strike), 0.5, recover);
        spread = 0.25 + (1 - strike) * 0.5;
        shift = strike * 1.9 * (1 - recover);
        headYawT = relBoat;
        if (pt >= 0.34 && !this.strikeFired) {
          this.strikeFired = true;
          info.strikeNow = true;
          this.burstSplash(h!, inp, 28, 9);
          this.splashT = 0;
        }
        break;
      }
      case 'stunned': {
        const k = smoothstep(0, 0.3, pt);
        leanT = lerp(0.15, -0.5, k) + Math.sin(inp.clock * 40) * 0.03 * (1 - k * 0.5);
        poseS[0] = poseS[1] = lerp(0.5, -0.5, k);
        poseE[0] = poseE[1] = lerp(0.5, 2.1, k);
        spread = 0.5;
        headYawT = Math.sin(inp.clock * 9) * 0.25;
        break;
      }
      case 'distracted': {
        leanT = 0.1;
        poseS[0] = 0.4 + swing * 0.25;
        poseS[1] = 0.4 + swingB * 0.25;
        poseE[0] = poseE[1] = 0.35;
        if (inp.decoy) headYawT = clamp(wrapAngle(bearing(hx, hz, inp.decoy.x, inp.decoy.z) - heading), -1.3, 1.3);
        break;
      }
      case 'retreating':
        leanT = 0.0; poseS[0] = poseS[1] = 0.2; poseE[0] = poseE[1] = 0.3;
        headYawT = clamp(wrapAngle(toBoat - heading), -1, 1) * 0.5;
        break;
      default:
        break;
    }
    if (tg > 0 && (phase === 'chasing' || phase === 'surging')) {
      // surge telegraph: he rears back, arms flung wide, before the burst
      const k2 = smoothstep(0, 0.35, tg);
      leanT = lerp(leanT, -0.42, k2);
      poseS[0] = lerp(poseS[0], -0.9, k2); poseS[1] = lerp(poseS[1], -0.9, k2);
      poseE[0] = lerp(poseE[0], 0.8, k2); poseE[1] = lerp(poseE[1], 0.8, k2);
      spread = lerp(spread, 1.15, k2);
      this.telePulse += dt;
      if (this.telePulse > 0.42) {
        this.telePulse = 0;
        this.splashT = 0;
        this.burstSplash(h!, inp, 12, 5);
      }
    } else this.telePulse = 0.3;
    const k = 1 - Math.exp(-(phase === 'lunging' ? 18 : 8) * dt);
    this.lean = lerp(this.lean, leanT, k);
    this.lungeShift = lerp(this.lungeShift, shift, 1 - Math.exp(-14 * dt));
    this.headYaw = lerp(this.headYaw, headYawT, 1 - Math.exp(-5 * dt));
    this.chest.rotation.set(this.lean, phase === 'lunging' ? relBoat * 0.6 * lungeBlend : relBoat * 0.12, 0);
    this.chest.position.set(0, 0.9 + Math.sin(this.cycle * 2) * 0.1 * (phase === 'chasing' || phase === 'surging' ? 1 : 0.3), -this.lungeShift);
    this.head.rotation.set(-this.lean * 0.65 + (phase === 'stunned' ? 0.3 : 0), this.headYaw, Math.sin(this.cycle) * 0.05);
    const sway = Math.sin(inp.clock * 1.7) * 0.06;
    this.cloak.rotation.set(0.08 + sp * 0.5 + sway, 0, Math.sin(inp.clock * 1.3) * 0.05);
    this.hair.rotation.set(sp * 0.45 + sway * 0.8 + Math.sin(inp.clock * 2.3) * 0.05, 0, Math.sin(inp.clock * 1.1) * 0.06);
    for (let a = 0; a < 2; a++) {
      const side = a === 0 ? -1 : 1;
      const ap = this.armPose[a];
      const ka = 1 - Math.exp(-(phase === 'lunging' ? 22 : 9) * dt);
      ap.s = lerp(ap.s, poseS[a], ka);
      ap.e = lerp(ap.e, poseE[a], ka);
      ap.z = lerp(ap.z, spread, 1 - Math.exp(-6 * dt));
      const arm = this.arms[a];
      arm.shoulder.rotation.set(ap.s, 0, side * ap.z);
      arm.elbow.rotation.set(ap.e, 0, 0);
      arm.hand.rotation.set(0.25 + Math.sin(inp.clock * 3 + a) * 0.05, 0, 0);
    }

    // ---- frost tint when slowed
    this.frost = damp(this.frost, inp.slowed ? 1 : 0, 4, dt);
    const fade = clamp(inp.fade ?? 0, 0, 1);
    const wantT = fade > 0.02;
    if (this.bodyMat.transparent !== wantT) { this.bodyMat.transparent = wantT; this.bodyMat.needsUpdate = true; }
    this.bodyMat.opacity = 1 - 0.5 * fade;
    this.bodyMat.depthWrite = fade < 0.5;
    this.bodyMat.emissive.setRGB(lerp(0.035, 0.04, this.frost), lerp(0.03, 0.18, this.frost), lerp(0.1, 0.28, this.frost));

    // ---- underwater shadow (fades out as the body rises, lingers faintly as the wader's reflection)
    const shadowOp = ((0.32 + 0.42 * threat) * (1 - emerge) + 0.16 * emerge) * smoothstep(0, 0.12, Math.max(vis, h ? 0.12 : 0) * 1.0 + (phase === 'stalking' ? 0.2 : 0));
    (this.shadow.material as THREE.MeshBasicMaterial).opacity = clamp(shadowOp, 0, 0.75);
    this.shadow.scale.setScalar(scale * (0.85 + 0.25 * (1 - emerge)));
    this.shadow.position.set(0, -0.15, 0);
    this.shadow.visible = (h?.phase ?? 'dormant') !== 'dormant';

    // ---- rings
    this.ringClock += dt;
    this.splashT += dt;
    const stalk = phase === 'stalking' || (phase === 'emerging' && pt < 0.5);
    for (let i = 0; i < 2; i++) {
      const ph = ((this.ringClock * 0.55 + i * 0.5) % 1);
      const r = (1.8 + ph * 5.5) * scale;
      const m = this.rings[i];
      m.scale.set(r, 1, r);
      (m.material as THREE.MeshBasicMaterial).opacity = (stalk ? (0.12 + 0.3 * threat) * (1 - ph) * (1 - ph) : emerge > 0.3 ? 0.1 * (1 - ph) * sp : 0);
    }
    const sp3 = this.rings[2];
    const st = clamp(this.splashT / 0.9, 0, 1);
    const sr = (1.5 + ease(st) * 8) * scale;
    sp3.scale.set(sr, 1, sr);
    (sp3.material as THREE.MeshBasicMaterial).opacity = (1 - st) * (1 - st) * 0.34;

    // ---- particles
    if (!inp.low || Math.random() < 0.5) this.emitParticles(h, inp, scale, emerge, threat, sp);

    // ---- eyes + aura + light (world space)
    this.head.updateWorldMatrix(true, false);
    const headPos = this.head.getWorldPosition(this.info.head);
    const eyeAlphaBase = (0.55 + 0.45 * threat) * (phase === 'stunned' ? 0.35 + 0.3 * Math.max(0, Math.sin(inp.clock * 25)) : 1);
    const eyeSize = (1.5 + 1.7 * threat) * scale * (surging ? 1.35 : 1) * (1 + 0.45 * tg);
    const above = smoothstep(0.1, 0.55, emerge);
    const hq = this.head.getWorldQuaternion(this.quat);
    this.tmp2.set(0, 0, -1).applyQuaternion(hq).multiplyScalar(0.8 * scale);
    this.eyeCol.set(phase === 'distracted' ? '#c9a2ff' : surging || tg > 0.2 ? '#ff4a2a' : '#ff8a3a');
    this.field.mesh.visible = true;
    for (const s of [-1, 1]) {
      this.tmp.set(s * 0.3 * scale, 0.1 * scale, 0).applyQuaternion(hq);
      this.field.update(s < 0 ? 0 : 1, headPos.x + this.tmp.x + this.tmp2.x, headPos.y + this.tmp.y + this.tmp2.y, headPos.z + this.tmp.z + this.tmp2.z, eyeSize, eyeAlphaBase * above, this.eyeCol);
    }
    // aura silhouette-lift behind the monster
    this.auraCol.set(this.frost > 0.5 ? '#5ac8f0' : '#7a5cf0');
    // halo sits BEHIND the body as seen from the camera (depth-tested, so the dark body silhouettes against it instead of being washed out)
    let awayX = Math.sin(heading), awayZ = Math.cos(heading);
    if (inp.cam) {
      const ax = hx - inp.cam.x, az = hz - inp.cam.z;
      const al = Math.hypot(ax, az) || 1;
      awayX = ax / al; awayZ = az / al;
    }
    this.field.update(2, hx + awayX * 4.2 * scale, rise + 3.4 * scale, hz + awayZ * 4.2 * scale, 17 * scale, (0.3 + 0.4 * threat) * above, this.auraCol);
    // faint eyes glowing under the surface while stalking
    const under = phase === 'stalking' || phase === 'emerging' ? (1 - above) * (0.1 + 0.8 * threat) * (0.7 + 0.3 * Math.sin(inp.clock * 5)) : 0;
    this.field.update(3, hx - Math.sin(heading) * 1.4, -0.5, hz - Math.cos(heading) * 1.4, 2.8 * scale, under, this.underCol);
    this.field.flush();
    this.light.intensity = above * (4 + 90 * threat * threat + 60 * tg) * (phase === 'stunned' ? 0.4 : 1) * (inp.low ? 0 : 1);

    info.visible = true;
    info.scale = scale;
    info.vis = vis;
    info.threat = threat;
    return info;
  }

  private burstSplash(h: HydeState, inp: HydeFrameInput, n: number, speed: number): void {
    const count = inp.low ? Math.round(n / 2) : n;
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = speed * (0.4 + Math.random() * 0.7);
      this.particles.emit({ x: h.x + Math.cos(a) * 1.4, y: 0.2, z: h.z + Math.sin(a) * 1.4, vx: Math.cos(a) * s * 0.55, vy: 4 + Math.random() * 6, vz: Math.sin(a) * s * 0.55, life: 1.1, size: 0.55, grow: 1.8, color: Math.random() < 0.7 ? '#dfe9ff' : '#8fa0ff', alpha: 0.9, gravity: -14 });
    }
  }

  private emitParticles(h: HydeState | undefined, inp: HydeFrameInput, scale: number, emerge: number, threat: number, sp: number): void {
    if (!h) return;
    const dt = inp.dt;
    const phase = h.phase;
    const surging = phase === 'surging' && !(inp.telegraph && inp.telegraph > 0);
    const fx = -Math.sin(h.heading), fz = -Math.cos(h.heading);
    // bubbles while he is under water
    if ((phase === 'stalking' || phase === 'emerging') && emerge < 0.6) {
      this.bubbleAcc += dt * (5 + 14 * threat);
      while (this.bubbleAcc > 1) {
        this.bubbleAcc -= 1;
        const a = Math.random() * Math.PI * 2;
        const r = Math.random() * 2.2 * scale;
        this.particles.emit({ x: h.x + Math.cos(a) * r, y: -0.35, z: h.z + Math.sin(a) * r, vy: 0.9 + Math.random() * 0.8, life: 1.1, size: 0.2 + Math.random() * 0.18, grow: 1.4, color: '#bfe6ff', alpha: 0.55 });
      }
    }
    if (emerge < 0.3) return;
    // wading spray from the claws + bow wave
    const rate = surging ? 46 : phase === 'chasing' ? 12 + sp * 14 : phase === 'lunging' ? 26 : phase === 'distracted' ? 4 : 2;
    this.sprayAcc += dt * rate;
    while (this.sprayAcc > 1) {
      this.sprayAcc -= 1;
      const arm = this.arms[Math.random() < 0.5 ? 0 : 1];
      arm.hand.getWorldPosition(this.tmp);
      const y = this.tmp.y;
      const px = y < 1.0 ? this.tmp.x : h.x + fx * 1.8 * scale + (Math.random() - 0.5) * 2.2 * scale;
      const pz = y < 1.0 ? this.tmp.z : h.z + fz * 1.8 * scale + (Math.random() - 0.5) * 2.2 * scale;
      this.particles.emit({ x: px, y: 0.15, z: pz, vx: (Math.random() - 0.5) * 3 - fx * (surging ? 3 : 1), vy: 2.5 + Math.random() * 3.5, vz: (Math.random() - 0.5) * 3 - fz * (surging ? 3 : 1), life: 0.7, size: 0.4 + threat * 0.25, grow: 1.7, color: '#cfe3ff', alpha: 0.8, gravity: -9 });
    }
    // wake behind
    if (sp > 0.3 && Math.random() < 0.8) {
      this.particles.emit({ x: h.x - fx * 1.8 * scale + (Math.random() - 0.5) * 2, y: 0.1, z: h.z - fz * 1.8 * scale + (Math.random() - 0.5) * 2, vx: -fx * 1.2, vz: -fz * 1.2, life: 1.5, size: 0.9 * scale, grow: 3, color: '#a9bff0', alpha: 0.35 });
    }
    if (phase === 'stunned' && Math.random() < 0.5) {
      this.particles.emit({ x: this.info.head.x + (Math.random() - 0.5) * 2, y: this.info.head.y + Math.random(), z: this.info.head.z + (Math.random() - 0.5) * 2, vy: 1.5, life: 0.8, size: 0.35, grow: 0.5, color: '#9fe8ff', alpha: 0.9 });
    }
  }

  dispose(): void {
    this.field.dispose();
    for (const g of this.geos) g.dispose();
    for (const m of this.mats) m.dispose();
    this.light.dispose();
  }
}
