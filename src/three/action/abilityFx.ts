// Companion reactions + per-specialty ability VFX: shield bubble, speed trail, decoy illusion, freezing mist on the
// Hyde, fog-clearing light, revealed obstacles, current shield, anchor chain, stamina sparkles, activation flourish.
import * as THREE from 'three';
import type { AbilitySpecialty, CourseDef, HydeState, Vec2 } from '../../action/types.ts';
import type { BoatRig } from '../actors.ts';
import type { ParticlePool } from '../particles.ts';
import { clamp, damp, lerp } from '../util.ts';
import { createFresnelMaterial, type FxUniforms } from './fx.ts';
import { bearing, wrapAngle } from './geom.ts';
import { obstacleWorldPos } from './obstacleMeshes.ts';
import type { RenderEffects, RenderAbilityStatus } from './types.ts';

export const SPECIALTY_COLOR: Record<AbilitySpecialty, string> = {
  speed_boost: '#ffd27a', shield: '#6fe8ff', hyde_distraction: '#b48cff', obstacle_detection: '#7be8ff', egg_protection: '#ffd0a0',
  stamina_restore: '#8affb0', fog_clear: '#ffe9b0', pursuit_slow: '#9fe3ff', egg_sense: '#ffe27a', current_ride: '#5ac8f0',
};

export interface AbilityFrame {
  dt: number;
  clock: number;
  t: number;
  boat: { x: number; z: number; heading: number; speed: number };
  hyde: HydeState | undefined;
  hydeScale: number;
  effects: RenderEffects;
  specialty: AbilitySpecialty;
  magnitude: number;
  status: RenderAbilityStatus | null;
  rescue: boolean;
  /** obstacles cut by an ability */
  removed?: ReadonlySet<string>;
  /** radius in which hazards are outlined (0/undefined = default) */
  revealRadius?: number;
  reduced: boolean;
  low: boolean;
}

function easeOut(t: number): number {
  return 1 - Math.pow(1 - clamp(t, 0, 1), 3);
}

export class AbilityFx {
  /** Smoothed 0..1 values the camera reads. */
  speedBlend = 0;
  private readonly group = new THREE.Group();
  private readonly mats: THREE.Material[] = [];
  private readonly geos: THREE.BufferGeometry[] = [];
  private readonly shield: THREE.Mesh;
  private readonly shieldMat: THREE.ShaderMaterial;
  private readonly curRing: THREE.Mesh[] = [];
  private readonly ghost = new THREE.Group();
  private readonly ghostMat: THREE.ShaderMaterial;
  private readonly iceShell: THREE.Mesh;
  private readonly iceMat: THREE.ShaderMaterial;
  private readonly iceRing: THREE.Mesh;
  private readonly clearRing: THREE.Mesh;
  private readonly clearDisc: THREE.Mesh;
  private readonly revealRings: THREE.InstancedMesh;
  private readonly revealGems: THREE.InstancedMesh;
  private readonly chain: THREE.InstancedMesh;
  private readonly anchor: THREE.Mesh;
  private readonly staminaRing: THREE.Mesh;
  private readonly obstacles: CourseDef['obstacles'];
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly v = new THREE.Vector3();
  private readonly v2 = new THREE.Vector3();
  private readonly col = new THREE.Color();
  private blend = { shield: 0, ghost: 0, ice: 0, clear: 0, reveal: 0, cur: 0, anchor: 0, stamina: 0 };
  private flourish = 2;
  private flourishCol = new THREE.Color('#ffffff');
  private spawnAcc = 0;
  private prevShield = false;
  private chainCount = 40;
  private lastDecoy: Vec2 | null = null;
  private companionPhase = 0;

  constructor(private readonly parent: THREE.Object3D, private readonly boat: BoatRig, private readonly particles: ParticlePool, private readonly u: FxUniforms, course: CourseDef) {
    this.obstacles = course.obstacles;
    parent.add(this.group);

    // shield bubble (follows boat)
    this.shieldMat = createFresnelMaterial('#6fe8ff', u);
    this.mats.push(this.shieldMat);
    const sg = new THREE.IcosahedronGeometry(2.2, 2);
    this.geos.push(sg);
    this.shield = new THREE.Mesh(sg, this.shieldMat);
    this.shield.scale.set(1, 0.85, 1.75);
    this.shield.position.y = 0.55;
    this.shield.visible = false;
    boat.root.add(this.shield);

    // current shield: two tilted rotating rings around the boat
    const rg = new THREE.TorusGeometry(2.6, 0.07, 6, 40);
    this.geos.push(rg);
    for (let i = 0; i < 2; i++) {
      const m = new THREE.MeshBasicMaterial({ color: new THREE.Color(i ? '#8ae8ff' : '#4fc7f2'), transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, fog: false });
      this.mats.push(m);
      const ring = new THREE.Mesh(rg, m);
      ring.scale.set(1, 1.5, 1);
      ring.visible = false;
      boat.root.add(ring);
      this.curRing.push(ring);
    }

    // decoy ghost: a dim phantom boat + companion at the decoy position
    this.ghostMat = createFresnelMaterial('#a67bff', u);
    this.mats.push(this.ghostMat);
    const hull = new THREE.IcosahedronGeometry(1, 1);
    const orb = new THREE.IcosahedronGeometry(0.45, 1);
    this.geos.push(hull, orb);
    const gh = new THREE.Mesh(hull, this.ghostMat);
    gh.scale.set(0.95, 0.5, 2.1);
    gh.position.y = 0.35;
    const go = new THREE.Mesh(orb, this.ghostMat);
    go.position.set(-0.4, 1.5, -0.4);
    const gp = new THREE.Mesh(orb, this.ghostMat);
    gp.scale.set(0.7, 1.3, 0.7);
    gp.position.set(0.1, 1.1, 0.5);
    this.ghost.add(gh, go, gp);
    this.ghost.visible = false;
    this.group.add(this.ghost);

    // ice shell + ring around the Hyde when slowed
    this.iceMat = createFresnelMaterial('#8fe3ff', u);
    this.mats.push(this.iceMat);
    const ig = new THREE.IcosahedronGeometry(1, 1);
    this.geos.push(ig);
    this.iceShell = new THREE.Mesh(ig, this.iceMat);
    this.iceShell.visible = false;
    this.group.add(this.iceShell);
    const irg = new THREE.RingGeometry(0.7, 1, 36, 1).rotateX(-Math.PI / 2);
    this.geos.push(irg);
    const irm = new THREE.MeshBasicMaterial({ color: new THREE.Color('#9fe8ff'), transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false });
    this.mats.push(irm);
    this.iceRing = new THREE.Mesh(irg, irm);
    this.iceRing.position.y = 0.12;
    this.iceRing.visible = false;
    this.group.add(this.iceRing);

    // fog-clear ring + soft disc
    const crg = new THREE.RingGeometry(0.93, 1, 72, 1).rotateX(-Math.PI / 2);
    const cdg = new THREE.CircleGeometry(1, 48).rotateX(-Math.PI / 2);
    this.geos.push(crg, cdg);
    const crm = new THREE.MeshBasicMaterial({ color: new THREE.Color('#fff0c0'), transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false });
    const cdm = new THREE.MeshBasicMaterial({ color: new THREE.Color('#ffe9b0'), transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false });
    this.mats.push(crm, cdm);
    this.clearRing = new THREE.Mesh(crg, crm);
    this.clearDisc = new THREE.Mesh(cdg, cdm);
    this.clearRing.position.y = this.clearDisc.position.y = 0.16;
    this.clearRing.visible = this.clearDisc.visible = false;
    this.group.add(this.clearRing, this.clearDisc);

    // revealed obstacles: pulsing cyan rings + floating gems
    const n = Math.max(1, this.obstacles.length);
    const rrg = new THREE.RingGeometry(0.88, 1, 28, 1).rotateX(-Math.PI / 2);
    const gem = new THREE.OctahedronGeometry(0.4, 0);
    this.geos.push(rrg, gem);
    const rrm = new THREE.MeshBasicMaterial({ color: new THREE.Color('#7be8ff'), transparent: true, opacity: 0.85, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false });
    const gm = new THREE.MeshBasicMaterial({ color: new THREE.Color('#bff4ff'), transparent: true, opacity: 0.9, depthWrite: false, blending: THREE.AdditiveBlending, fog: false });
    this.mats.push(rrm, gm);
    this.revealRings = new THREE.InstancedMesh(rrg, rrm, n);
    this.revealGems = new THREE.InstancedMesh(gem, gm, n);
    for (const im of [this.revealRings, this.revealGems]) {
      im.frustumCulled = false;
      im.count = 0;
      im.renderOrder = 9;
      this.group.add(im);
    }

    // anchor chain: instanced links from the stern to the Hyde (or into the water) + an anchor
    const linkGeo = new THREE.TorusGeometry(0.28, 0.07, 4, 8);
    this.geos.push(linkGeo);
    const linkMat = new THREE.MeshBasicMaterial({ color: new THREE.Color('#a8f0c0'), fog: false });
    this.mats.push(linkMat);
    this.chain = new THREE.InstancedMesh(linkGeo, linkMat, this.chainCount);
    this.chain.frustumCulled = false;
    this.chain.visible = false;
    this.group.add(this.chain);
    const anchorGeo = buildAnchor();
    this.geos.push(anchorGeo);
    const anchorMat = new THREE.MeshBasicMaterial({ color: new THREE.Color('#b8f4cc'), fog: false });
    this.mats.push(anchorMat);
    this.anchor = new THREE.Mesh(anchorGeo, anchorMat);
    this.anchor.visible = false;
    this.group.add(this.anchor);

    // stamina: green halo ring on the boat
    const sgeo = new THREE.TorusGeometry(1.8, 0.05, 5, 36).rotateX(Math.PI / 2);
    this.geos.push(sgeo);
    const smat = new THREE.MeshBasicMaterial({ color: new THREE.Color('#8affb0'), transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, fog: false });
    this.mats.push(smat);
    this.staminaRing = new THREE.Mesh(sgeo, smat);
    this.staminaRing.visible = false;
    boat.root.add(this.staminaRing);
  }

  /** ability_used event: companion flourish + radial burst in the specialty colour. */
  onAbilityUsed(specialty: AbilitySpecialty, boat: { x: number; z: number }, low: boolean): void {
    this.flourish = 0;
    this.flourishCol.set(SPECIALTY_COLOR[specialty]);
    const n = low ? 14 : 34;
    const hex = SPECIALTY_COLOR[specialty];
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const s = 4 + Math.random() * 3;
      this.particles.emit({ x: boat.x, y: 1.6, z: boat.z, vx: Math.cos(a) * s, vy: 1 + Math.random() * 2.5, vz: Math.sin(a) * s, life: 0.9, size: 0.5, grow: 1.5, color: hex, alpha: 0.95, drag: 1.8 });
    }
  }

  update(f: AbilityFrame): void {
    const { dt, clock, boat, effects: e } = f;
    const spec = f.specialty;
    const hex = SPECIALTY_COLOR[spec];
    this.flourish += dt;
    const fl = clamp(this.flourish / 1.1, 0, 1);
    this.updateCompanion(f, fl, hex);

    // --- shield bubble
    this.blend.shield = damp(this.blend.shield, e.shield ? 1 : 0, 9, dt);
    this.shield.visible = this.blend.shield > 0.02;
    this.shieldMat.uniforms.uAlpha.value = this.blend.shield * (0.85 + 0.15 * Math.sin(clock * 6)) * (e.shield ? 1 : 0.8);
    this.shield.scale.set(1 + 0.03 * Math.sin(clock * 4), 0.85, 1.75);
    if (this.prevShield && !e.shield) {
      for (let i = 0; i < 18; i++) {
        const a = Math.random() * Math.PI * 2;
        this.particles.emit({ x: boat.x + Math.cos(a) * 2, y: 0.8, z: boat.z + Math.sin(a) * 3, vx: Math.cos(a) * 3, vy: 1 + Math.random() * 2, vz: Math.sin(a) * 3, life: 0.6, size: 0.4, grow: 1.4, color: '#9ff0ff', alpha: 0.9 });
      }
    }
    this.prevShield = e.shield;

    // --- current shield rings
    this.blend.cur = damp(this.blend.cur, e.currentShield ? 1 : 0, 6, dt);
    this.curRing.forEach((r, i) => {
      r.visible = this.blend.cur > 0.02;
      r.rotation.set(Math.PI / 2 + Math.sin(clock * 0.9 + i) * 0.25, clock * (i ? -2.4 : 2.0), Math.cos(clock * 1.1 + i * 2) * 0.25);
      r.position.y = 0.5 + i * 0.25;
      (r.material as THREE.MeshBasicMaterial).opacity = this.blend.cur * (0.55 + 0.2 * Math.sin(clock * 7 + i));
    });
    if (e.currentShield && Math.random() < 0.7) {
      const a = clock * 4 + Math.random() * 6.28;
      this.particles.emit({ x: boat.x + Math.cos(a) * 2.8, y: 0.15, z: boat.z + Math.sin(a) * 2.8, vx: -Math.sin(a) * 3.2, vz: Math.cos(a) * 3.2, life: 0.6, size: 0.3, grow: 1.5, color: '#7ce6ff', alpha: 0.8 });
    }

    // --- speed trail + speed lines
    this.speedBlend = damp(this.speedBlend, e.speedBoost ? 1 : 0, 4, dt);
    if (e.speedBoost) {
      this.spawnAcc += dt * (f.low ? 26 : 60);
      const fx = -Math.sin(boat.heading), fz = -Math.cos(boat.heading);
      while (this.spawnAcc > 1) {
        this.spawnAcc -= 1;
        const side = (Math.random() - 0.5) * 2.4;
        const bx = boat.x - fx * (1.6 + Math.random() * 0.6) - fz * side, bz = boat.z - fz * (1.6 + Math.random() * 0.6) + fx * side;
        this.particles.emit({ x: bx, y: 0.3 + Math.random() * 0.6, z: bz, vx: -fx * 6, vz: -fz * 6, life: 0.55, size: 0.5, grow: 2.2, color: Math.random() < 0.6 ? '#ffd27a' : '#ffffff', alpha: 0.8 });
        // thin speed lines whipping past the camera side of the boat
        const sx = boat.x + fx * (Math.random() * 10 - 2) - fz * (Math.random() < 0.5 ? -1 : 1) * (2.5 + Math.random() * 3);
        const sz = boat.z + fz * (Math.random() * 10 - 2) + fx * (Math.random() < 0.5 ? -1 : 1) * (2.5 + Math.random() * 3);
        this.particles.emit({ x: sx, y: 0.6 + Math.random() * 1.8, z: sz, vx: -fx * 22, vz: -fz * 22, life: 0.35, size: 0.18, grow: 1, color: '#fff2c8', alpha: 0.55 });
      }
    }

    // --- decoy illusion
    const decoy = e.decoy ?? (f.hyde?.decoy ?? null);
    if (decoy) this.lastDecoy = decoy;
    this.blend.ghost = damp(this.blend.ghost, decoy ? 1 : 0, 6, dt);
    this.ghost.visible = this.blend.ghost > 0.03 && !!this.lastDecoy;
    if (this.ghost.visible && this.lastDecoy) {
      const flick = 0.75 + 0.25 * Math.sin(clock * 9) * Math.sin(clock * 3.1);
      this.ghostMat.uniforms.uAlpha.value = this.blend.ghost * flick * 0.9;
      this.ghost.position.set(this.lastDecoy.x, Math.sin(clock * 1.7) * 0.12, this.lastDecoy.z);
      this.ghost.rotation.y = boat.heading + Math.sin(clock * 0.8) * 0.1;
      if (decoy && Math.random() < 0.5) {
        this.particles.emit({ x: this.lastDecoy.x + (Math.random() - 0.5) * 3, y: 0.4, z: this.lastDecoy.z + (Math.random() - 0.5) * 3, vy: 1.6, life: 1.0, size: 0.45, grow: 1.4, color: '#b48cff', alpha: 0.7 });
      }
    }

    // --- freezing mist around the Hyde when he is slowed
    const h = f.hyde;
    const hydeUp = !!h && h.phase !== 'dormant';
    this.blend.ice = damp(this.blend.ice, e.hydeSlowed && hydeUp ? 1 : 0, 5, dt);
    const iceOn = this.blend.ice > 0.02 && hydeUp;
    this.iceShell.visible = this.iceRing.visible = iceOn;
    if (iceOn && h) {
      const s = f.hydeScale;
      this.iceShell.position.set(h.x, 2.6 * s, h.z);
      this.iceShell.scale.set(2.6 * s, 3.2 * s, 2.6 * s);
      this.iceMat.uniforms.uAlpha.value = this.blend.ice * (0.55 + 0.2 * Math.sin(clock * 5));
      this.iceRing.position.set(h.x, 0.12, h.z);
      this.iceRing.scale.setScalar(4.2 * s + Math.sin(clock * 3) * 0.2);
      this.iceRing.rotation.y = clock * 0.6;
      (this.iceRing.material as THREE.MeshBasicMaterial).opacity = this.blend.ice * 0.55;
      if (Math.random() < 0.9) {
        const a = Math.random() * 6.28, r = Math.random() * 3.2 * s;
        this.particles.emit({ x: h.x + Math.cos(a) * r, y: 0.3 + Math.random() * 3 * s, z: h.z + Math.sin(a) * r, vx: Math.cos(a) * 0.8, vy: 0.5 + Math.random(), vz: Math.sin(a) * 0.8, life: 1.3, size: 1.4, grow: 2.2, color: '#c8f0ff', alpha: 0.22 });
        this.particles.emit({ x: h.x + Math.cos(a) * r, y: 1 + Math.random() * 3 * s, z: h.z + Math.sin(a) * r, vy: -0.4, life: 0.9, size: 0.25, grow: 0.6, color: '#ffffff', alpha: 0.9 });
      }
    }

    // --- fog-clearing light
    this.blend.clear = damp(this.blend.clear, e.fogCleared ? 1 : 0, 4, dt);
    const radius = f.specialty === 'fog_clear' ? clamp(f.magnitude, 12, 46) : 24;
    this.clearRing.visible = this.clearDisc.visible = this.blend.clear > 0.02;
    const R = radius * easeOut(this.blend.clear);
    const pulse = 1 + Math.sin(clock * 2.4) * 0.025;
    this.clearRing.position.set(boat.x, 0.16, boat.z);
    this.clearDisc.position.set(boat.x, 0.15, boat.z);
    this.clearRing.scale.setScalar(Math.max(0.01, R * pulse));
    this.clearDisc.scale.setScalar(Math.max(0.01, R));
    (this.clearRing.material as THREE.MeshBasicMaterial).opacity = this.blend.clear * 0.5;
    (this.clearDisc.material as THREE.MeshBasicMaterial).opacity = this.blend.clear * 0.07;
    this.u.uClear.value.set(boat.x, boat.z, radius, this.blend.clear);

    // --- revealed obstacles
    this.blend.reveal = damp(this.blend.reveal, e.obstaclesRevealed ? 1 : 0, 5, dt);
    this.updateReveal(f);

    // --- anchor chain
    this.blend.anchor = damp(this.blend.anchor, e.anchored ? 1 : 0, 5, dt);
    this.updateAnchor(f);

    // --- stamina sparkles
    this.blend.stamina = damp(this.blend.stamina, e.staminaSurge ? 1 : 0, 6, dt);
    this.staminaRing.visible = this.blend.stamina > 0.02;
    this.staminaRing.position.y = 0.2 + ((clock * 0.8) % 1) * 2.2;
    this.staminaRing.scale.setScalar(1 - ((clock * 0.8) % 1) * 0.35);
    (this.staminaRing.material as THREE.MeshBasicMaterial).opacity = this.blend.stamina * (1 - ((clock * 0.8) % 1)) * 0.8;
    if (e.staminaSurge && Math.random() < (f.low ? 0.5 : 0.95)) {
      const a = Math.random() * 6.28, r = 0.6 + Math.random() * 1.4;
      this.particles.emit({ x: boat.x + Math.cos(a) * r, y: 0.4, z: boat.z + Math.sin(a) * r, vy: 2 + Math.random() * 2.2, life: 0.9, size: 0.3, grow: 0.7, color: Math.random() < 0.5 ? '#8affb0' : '#e9ffd0', alpha: 0.95 });
    }
  }

  private updateReveal(f: AbilityFrame): void {
    const on = this.blend.reveal > 0.02;
    this.revealRings.visible = this.revealGems.visible = on;
    if (!on) return;
    let k = 0;
    const t = f.clock;
    for (let i = 0; i < this.obstacles.length; i++) {
      const o = this.obstacles[i];
      if (f.removed?.has(o.id)) continue;
      const p = obstacleWorldPos(o, f.t);
      const d = Math.hypot(p.x - f.boat.x, p.z - f.boat.z);
      if (d > (f.revealRadius && f.revealRadius > 0 ? f.revealRadius + 8 : 95)) continue;
      const rr = Math.max(o.radius, o.halfLength * 0.9) + 1.2 + Math.sin(t * 4 + i) * 0.12;
      const sc = rr * this.blend.reveal;
      this.m.makeScale(sc, 1, sc).setPosition(p.x, 0.2, p.z);
      this.revealRings.setMatrixAt(k, this.m);
      this.q.identity();
      this.m.compose(this.v.set(p.x, 2.6 + Math.sin(t * 3 + i) * 0.25, p.z), this.q.setFromAxisAngle(this.v2.set(0, 1, 0), t * 2 + i), this.v2.set(1, 1.5, 1).multiplyScalar(this.blend.reveal * (1 + o.radius * 0.1)));
      this.revealGems.setMatrixAt(k, this.m);
      k++;
    }
    this.revealRings.count = this.revealGems.count = k;
    this.revealRings.instanceMatrix.needsUpdate = true;
    this.revealGems.instanceMatrix.needsUpdate = true;
  }

  private updateAnchor(f: AbilityFrame): void {
    const on = this.blend.anchor > 0.02;
    this.chain.visible = this.anchor.visible = on;
    if (!on) return;
    const b = f.boat;
    const fx = -Math.sin(b.heading), fz = -Math.cos(b.heading);
    const sx = b.x - fx * 2.0, sz = b.z - fz * 2.0;
    const h = f.hyde;
    const hydeOk = !!h && h.phase !== 'dormant' && h.phase !== 'retreating';
    const tx = hydeOk ? h!.x : sx - fx * 2.5;
    const tz = hydeOk ? h!.z : sz - fz * 2.5;
    const drop = (1 - easeOut(this.blend.anchor)) * 7;
    const ty = hydeOk ? 0.35 + drop : -0.4 + drop;
    const n = this.chainCount;
    const dist = Math.hypot(tx - sx, tz - sz);
    const linkScale = clamp(0.8 + dist * 0.012, 0.8, 1.6);
    const sag = Math.min(2.2, 0.5 + dist * 0.05);
    const prev = this.v.set(sx, 0.9, sz);
    for (let i = 0; i < n; i++) {
      const s = (i + 0.5) / n;
      const px = lerp(sx, tx, s), pz = lerp(sz, tz, s);
      const py = lerp(0.9, ty, s) - Math.sin(s * Math.PI) * sag * 0.6 + 0.2;
      const nx = lerp(sx, tx, s + 0.02), nz = lerp(sz, tz, s + 0.02);
      const ny = lerp(0.9, ty, s + 0.02) - Math.sin(Math.min(1, s + 0.02) * Math.PI) * sag * 0.6 + 0.2;
      this.v2.set(nx - px, ny - py, nz - pz).normalize();
      this.q.setFromUnitVectors(this.col.set(0, 0, 0) && this.v.set(1, 0, 0), this.v2);
      this.v.set(px, py, pz);
      this.m.compose(this.v, this.q, this.col.set(1, 1, 1) && this.v2.set(linkScale, linkScale * (i % 2 ? 1 : 0.6), linkScale));
      this.chain.setMatrixAt(i, this.m);
    }
    void prev;
    this.chain.instanceMatrix.needsUpdate = true;
    this.anchor.position.set(tx, ty + 0.2, tz);
    this.anchor.rotation.y = f.clock * 0.5;
    this.anchor.scale.setScalar(1.2 + (hydeOk ? f.hydeScale * 0.8 : 0));
    if (Math.random() < 0.5) {
      this.particles.emit({ x: tx + (Math.random() - 0.5) * 2, y: 0.2, z: tz + (Math.random() - 0.5) * 2, vy: 1.4, life: 0.8, size: 0.35, grow: 1.3, color: '#a8f0c0', alpha: 0.7 });
    }
  }

  private updateCompanion(f: AbilityFrame, fl: number, hex: string): void {
    const rig = this.boat;
    const h = f.hyde;
    const hydeUp = !!h && h.phase !== 'dormant';
    const threat = hydeUp ? clamp(h!.threat, 0, 1) : 0;
    const near = hydeUp ? clamp(1 - h!.distance / 60, 0, 1) : 0;
    const alarm = Math.max(threat, near * 0.6);
    this.companionPhase += f.dt * (1 + alarm * 5);
    const c = rig.companion;
    // look back at the Hyde (companion model faces -Z; group is inside the boat frame)
    let yaw = Math.sin(f.clock * 0.5) * 0.4;
    if (hydeUp && alarm > 0.12) {
      const rel = wrapAngle(bearing(f.boat.x, f.boat.z, h!.x, h!.z) - f.boat.heading);
      yaw = lerp(yaw, rel, clamp(alarm * 1.8, 0, 1));
    }
    const spin = easeOut(fl) * Math.PI * 4 * (fl < 1 ? 1 : 0);
    c.rotation.y = lerp(c.rotation.y, yaw, 1 - Math.exp(-7 * f.dt)) + (fl < 1 ? spin - ((fl - f.dt / 1.1 > 0 ? easeOut(fl - f.dt / 1.1) : 0) * Math.PI * 4) : 0);
    // tremble when the Hyde is close
    const trem = alarm * alarm * (f.reduced ? 0.4 : 1);
    c.position.x += Math.sin(this.companionPhase * 9) * 0.03 * trem;
    c.position.y += Math.sin(this.companionPhase * 11 + 1.3) * 0.03 * trem + Math.sin(fl * Math.PI) * 0.7;
    c.position.z += Math.cos(this.companionPhase * 10) * 0.03 * trem;
    const pop = 1 + Math.sin(fl * Math.PI) * 0.55 + alarm * 0.1 * Math.sin(this.companionPhase * 6);
    c.scale.setScalar(pop);
    // glow: ready pulse / cooldown dim / alarm tint / flourish flash
    const glow = rig.companionGlow.material as THREE.SpriteMaterial;
    const ready = f.status ? f.status.ready : true;
    const base = ready ? 0.62 + 0.18 * Math.sin(f.clock * 3) : 0.3;
    glow.opacity = clamp(base + alarm * 0.35 + (1 - fl) * (fl < 1 ? 0.6 : 0), 0, 1);
    const size = 1.9 + alarm * 1.2 + Math.sin(fl * Math.PI) * 3.2 + (f.rescue ? 0.8 + 0.6 * Math.sin(f.clock * 14) : 0);
    rig.companionGlow.scale.setScalar(size);
    if (fl < 1) glow.color.lerp(this.flourishCol, 0.5);
    else if (alarm > 0.35) glow.color.lerp(this.col.set('#ff8a8a'), 0.06);
    else glow.color.lerp(this.col.set(hex), 0.04);
  }

  dispose(): void {
    this.parent.remove(this.group);
    this.boat.root.remove(this.shield, this.staminaRing, ...this.curRing);
    for (const g of this.geos) g.dispose();
    for (const m of this.mats) m.dispose();
    this.revealRings.dispose();
    this.revealGems.dispose();
    this.chain.dispose();
  }
}

function buildAnchor(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const add = (g: THREE.BufferGeometry, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0) => {
    g.rotateX(rx); g.rotateY(ry); g.rotateZ(rz); g.translate(x, y, z);
    parts.push(g.toNonIndexed());
  };
  add(new THREE.CylinderGeometry(0.09, 0.09, 1.6, 5), 0, 0.8, 0);
  add(new THREE.BoxGeometry(1.0, 0.1, 0.1), 0, 1.35, 0);
  add(new THREE.TorusGeometry(0.2, 0.05, 4, 8), 0, 1.75, 0);
  add(new THREE.ConeGeometry(0.17, 0.6, 4), -0.5, 0.2, 0, 0, 0, 0.9);
  add(new THREE.ConeGeometry(0.17, 0.6, 4), 0.5, 0.2, 0, 0, 0, -0.9);
  const pos: number[] = [];
  for (const p of parts) pos.push(...Array.from(p.getAttribute('position').array));
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  for (const p of parts) p.dispose();
  return g;
}
