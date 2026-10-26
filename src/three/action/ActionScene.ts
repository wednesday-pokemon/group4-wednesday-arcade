// Real-time Stage 1 renderer: the open haunted lake with land, landmarks, route lanterns, hazards, fog, currents, the Hyde,
// the Pokemon companion + ability VFX and a threat-aware chase camera (plus the Hyde-reveal glance and the rescue framing).
// Purely visual: it reads the public state of a RenderableRun (StageOneRun satisfies it) and never changes gameplay.
import * as THREE from 'three';
import type { CharacterId, PokemonId } from '../../game/types.ts';
import type { ActionEvent, CourseDef, HydeState, Vec2 } from '../../action/types.ts';
import { createBoat, type BoatRig } from '../actors.ts';
import { ParticlePool } from '../particles.ts';
import { clamp, damp, disposeObject, lerp, makeGlowTexture, smoothstep } from '../util.ts';
import { AbilityFx } from './abilityFx.ts';
import { ActionWorld, fogToSceneDensity } from './actionWorld.ts';
import { createFxUniforms, createOverlayMaterial, createOverlayMesh, type FxUniforms, type OverlayUniforms } from './fx.ts';
import { distToEdges, pointInPoly, wrapAngle } from './geom.ts';
import { HydeActor, type HydeFrameInfo } from './hydeRig.ts';
import { NO_EFFECTS, type ActionSceneOptions, type RenderableRun } from './types.ts';

export type { ActionSceneOptions } from './types.ts';

const BASE_FOG = 0.0046;
const FOG_COLOR = 0x1a2150;
const BASE_FOV = 58;
const CALM_YB = -0.36; // NDC height of the boat in the calm chase shot
const MOOD_CALM_H: [number, number, number] = [0.176, 0.227, 0.478];
const MOOD_CALM_Z: [number, number, number] = [0.039, 0.063, 0.188];
const MOOD_DREAD_H: [number, number, number] = [0.33, 0.13, 0.3];
const MOOD_DREAD_Z: [number, number, number] = [0.1, 0.03, 0.13];

function angleLerp(from: number, to: number, t: number): number {
  return from + wrapAngle(to - from) * t;
}

export class ActionScene {
  readonly canvas: HTMLCanvasElement;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(BASE_FOV, 16 / 9, 0.1, 1800);
  private readonly fog = new THREE.FogExp2(FOG_COLOR, BASE_FOG);
  private readonly fx: FxUniforms = createFxUniforms();
  private readonly glowTex: THREE.Texture | null;
  private world: ActionWorld;
  private readonly boat: BoatRig;
  private readonly particles: ParticlePool;
  private readonly hyde: HydeActor;
  private readonly abilityFx: AbilityFx;
  private readonly overlayMat = createOverlayMaterial();
  private readonly overlay: THREE.Mesh;
  private readonly resizeObserver: ResizeObserver;
  private readonly moonLight: THREE.DirectionalLight;
  // ---- camera state
  private camYaw = 0;
  private camBack = 9;
  private need = 0;
  private swingSign = 1;
  private cinBlend = 0;
  private cinSide = 1;
  private cinTotal = 0;
  private rescueBlend = 0;
  private fovNow = BASE_FOV;
  private camMode: 'chase' | 'rescue' | 'cinematic' = 'chase';
  private readonly tmpA = new THREE.Vector3();
  private readonly tmpB = new THREE.Vector3();
  private readonly tmpC = new THREE.Vector3();
  private readonly tmpD = new THREE.Vector3();
  private readonly hydeNdc = new THREE.Vector3();
  private hydeOnScreen = false;
  private baseVFov = BASE_FOV;
  // ---- effects state
  private shake = 0;
  private hitJolt = 0;
  private oarTimer = 1;
  private clock = 0;
  private flash = 0;
  private flashRGB: [number, number, number] = [1, 1, 1];
  private threatSm = 0;
  private tgMax = 1;
  private swampBlend = 0;
  private harbourBlend = 0;
  private revision = -1;
  private width = 1;
  private height = 1;
  private disposed = false;
  private lastInfo: HydeFrameInfo;

  constructor(
    private readonly container: HTMLElement,
    private course: CourseDef,
    crew: { characterId: CharacterId; pokemonId: PokemonId },
    private options: ActionSceneOptions,
  ) {
    this.canvas = document.createElement('canvas');
    this.canvas.style.cssText = 'display:block;width:100%;height:100%';
    this.canvas.setAttribute('aria-label', 'Rowing across the haunted lake toward Raven Island');
    container.appendChild(this.canvas);
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: !options.lowGraphics, powerPreference: 'high-performance' });
    this.renderer.localClippingEnabled = true; // the Hyde is cut at the water plane
    this.renderer.setClearColor(FOG_COLOR, 1);
    this.glowTex = makeGlowTexture(64);
    this.scene.fog = this.fog;
    this.scene.background = new THREE.Color(FOG_COLOR);

    this.moonLight = new THREE.DirectionalLight(0xb8c4ff, 3);
    this.moonLight.position.set(-62, 47, -45);
    this.scene.add(new THREE.HemisphereLight(0x8e9cf0, 0x2a3070, 2.3), this.moonLight);

    this.world = new ActionWorld(course, this.fx, { lowGraphics: options.lowGraphics });
    this.scene.add(this.world.root);

    this.boat = createBoat(this.glowTex);
    this.boat.setCrew(crew.characterId, crew.pokemonId);
    this.scene.add(this.boat.root);

    this.particles = new ParticlePool(options.lowGraphics ? 320 : 900);
    this.particles.setActiveLimit(options.lowGraphics ? 320 : 900);
    this.hyde = new HydeActor(this.fx, this.particles);
    this.hyde.setWaterLevel(0);
    this.lastInfo = this.hyde.info;
    this.scene.add(this.hyde.root, this.hyde.field.mesh, this.particles.points);
    this.abilityFx = new AbilityFx(this.scene, this.boat, this.particles, this.fx, course);

    this.overlay = createOverlayMesh(this.overlayMat);
    this.scene.add(this.overlay);

    this.landPolys = (course.land ?? []).map((l) => {
      const xs = l.points.map((p) => p.x), zs = l.points.map((p) => p.z);
      return { pts: l.points, h: l.height, minX: Math.min(...xs) - 8, maxX: Math.max(...xs) + 8, minZ: Math.min(...zs) - 8, maxZ: Math.max(...zs) + 8 };
    });
    this.camYaw = course.start.heading;
    if (typeof window !== 'undefined' && /[?&]scenedebug/.test(window.location.search)) (window as unknown as { __actionScene?: ActionScene }).__actionScene = this;
    this.camBack = 9;
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();
  }

  setOptions(options: Partial<ActionSceneOptions>): void {
    const lowChanged = options.lowGraphics !== undefined && options.lowGraphics !== this.options.lowGraphics;
    this.options = { ...this.options, ...options };
    if (lowChanged) this.rebuildWorld();
    this.particles.setActiveLimit(this.options.lowGraphics ? 320 : 900);
    this.resize();
  }

  /** Graphics tier changed at runtime: rebuild the static world with the matching detail level. */
  private rebuildWorld(): void {
    this.scene.remove(this.world.root);
    this.world.dispose();
    this.world = new ActionWorld(this.course, this.fx, { lowGraphics: this.options.lowGraphics });
    this.scene.add(this.world.root);
    this.revision = -1;
  }

  private resize(): void {
    const w = Math.max(1, this.container.clientWidth);
    const h = Math.max(1, this.container.clientHeight);
    this.width = w;
    this.height = h;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, this.options.lowGraphics ? 1 : 1.5));
    this.renderer.setSize(w, h, false);
    const aspect = w / h;
    this.camera.aspect = aspect;
    // narrow / portrait containers: widen the vertical FOV so the boat and the water ahead stay framed
    this.baseVFov = aspect >= 1.4 ? BASE_FOV : Math.min(86, (2 * Math.atan(Math.tan((BASE_FOV * Math.PI) / 360) * (1.4 / aspect)) * 180) / Math.PI);
    this.camera.fov = this.fovNow = this.baseVFov;
    this.camera.updateProjectionMatrix();
  }

  /** Draw one frame for the given run state; `events` are this frame's gameplay events. */
  private lastRun: RenderableRun | null = null;

  /** Tooling only: advance the camera / Hyde pose dampers by `seconds` of scene time without simulating or drawing (software-rendered test runs step the sim in coarse chunks). */
  settleDebug(seconds: number): void {
    const run = this.lastRun;
    if (!run || this.disposed) return;
    const n = Math.max(1, Math.round(seconds * 30));
    for (let i = 0; i < n; i++) {
      this.clock += 1 / 30;
      const info = this.updateHyde(run, 1 / 30);
      this.updateBoat(run, 1 / 30);
      this.updateCamera(run, 1 / 30, info);
    }
    this.renderer.render(this.scene, this.camera);
  }

  render(run: RenderableRun, events: ActionEvent[], dt: number): void {
    if (this.disposed) return;
    this.lastRun = run;
    dt = clamp(dt, 0, 0.1);
    this.clock += dt;
    if (run.course) this.course = run.course;
    for (const e of events) this.onEvent(e, run);
    this.updateWorld(run, dt);
    const info = this.updateHyde(run, dt);
    this.updateBoat(run, dt);
    this.updateAbilities(run, dt, info);
    this.updateCamera(run, dt, info);
    if (this.debugCam) {
      this.fog.density = 0.00004;
      this.fx.uFogDensity.value = 0.00004;
      this.camera.position.copy(this.debugCam.pos);
      this.camera.fov = this.debugCam.fov;
      this.camera.lookAt(this.debugCam.look);
      this.camera.updateProjectionMatrix();
      this.camera.updateMatrixWorld(true);
    }
    this.updateOverlay(run, dt);
    this.particles.setPixelScale(this.canvas.height / (2 * Math.tan((this.camera.fov * Math.PI) / 360)));
    this.particles.update(dt);
    this.renderer.render(this.scene, this.camera);
  }

  // ------------------------------------------------------------------------------------------------------ events
  private onEvent(e: ActionEvent, run: RenderableRun): void {
    const b = run.boat;
    const low = this.options.lowGraphics;
    const calm = this.options.reducedMotion;
    switch (e.type) {
      case 'stroke': {
        this.oarTimer = 0;
        const fx = -Math.sin(b.heading);
        const fz = -Math.cos(b.heading);
        for (const side of [-1, 1]) {
          const x = b.x - fz * side * 1.9 - fx * 0.6;
          const z = b.z + fx * side * 1.9 - fz * 0.6;
          for (let i = 0; i < (low ? 3 : 7); i++) {
            this.particles.emit({ x, y: 0.2, z, vx: (Math.random() - 0.5) * 2 - fx * 1.5, vy: 2 + Math.random() * 2, vz: (Math.random() - 0.5) * 2 - fz * 1.5, life: 0.6, size: 0.35, grow: 1.6, color: '#cfe3ff', alpha: 0.85, gravity: -9 });
          }
        }
        break;
      }
      case 'collision': {
        const land = e.kind === 'land';
        const power = clamp(e.damage / 25 + e.impactSpeed / 24, land ? 0.1 : 0.3, 1);
        if (!calm) this.shake = Math.max(this.shake, power);
        this.hitJolt = Math.max(this.hitJolt, power > 0.25 ? 1 : 0.4);
        const n = Math.round((low ? 8 : 24) * (land ? 0.6 : 1));
        for (let i = 0; i < n; i++) {
          const a = Math.random() * Math.PI * 2;
          const s = 2 + Math.random() * 4;
          this.particles.emit({ x: e.x, y: 0.6, z: e.z, vx: Math.cos(a) * s, vy: 2 + Math.random() * 4, vz: Math.sin(a) * s, life: 0.8, size: 0.45, grow: 1.4, color: i % 3 ? '#dfe9ff' : land ? '#9fb6ff' : '#f5b04c', alpha: 0.9, gravity: -9 });
        }
        break;
      }
      case 'ability_used':
        this.abilityFx.onAbilityUsed(e.specialty, b, low);
        this.setFlash(0.55, 0.9, 1, 0.14);
        break;
      case 'hyde_catch':
        this.setFlash(1, 0.9, 0.9, 0.55);
        if (!calm) this.shake = 1;
        this.burst(b.x, b.z, low ? 16 : 40, '#dfe9ff');
        break;
      case 'rescue_end':
        if (e.outcome === 'caught') this.setFlash(0.9, 0.05, 0.1, 0.4);
        else this.setFlash(0.7, 1, 0.95, 0.5);
        this.burst(b.x, b.z, low ? 12 : 30, e.outcome === 'caught' ? '#ff6a7a' : '#aaf6ff');
        break;
      case 'hyde_phase':
        // first sight of him: a short look back at the shadow in the water before the emerge cinematic
        if (e.phase === 'stalking' && !calm) {
          this.peekLeft = this.peekTotal = 1.9;
        } else if (e.phase === 'stalking') {
          this.peekLeft = this.peekTotal = 1.4;
        }
        break;
      case 'hyde_warning':
        this.setFlash(0.7, 0.05, 0.1, e.level === 2 ? 0.2 : 0.1);
        break;
      case 'finish':
        this.setFlash(1, 0.8, 0.45, 0.35);
        this.burst(b.x, b.z, low ? 14 : 40, '#ffd27a');
        break;
      default:
        break;
    }
  }

  private setFlash(r: number, g: number, b: number, a: number): void {
    this.flashRGB = [r, g, b];
    this.flash = this.options.reducedMotion ? Math.min(a, 0.12) : a;
  }

  private burst(x: number, z: number, n: number, color: string): void {
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const s = 3 + Math.random() * 5;
      this.particles.emit({ x, y: 1, z, vx: Math.cos(a) * s, vy: 1 + Math.random() * 3, vz: Math.sin(a) * s, life: 0.9, size: 0.5, grow: 1.5, color, alpha: 0.95, drag: 1.4 });
    }
  }

  // ------------------------------------------------------------------------------------------------------ world
  private updateWorld(run: RenderableRun, dt: number): void {
    const b = run.boat;
    this.world.update(b.x, b.z, run.t, this.clock, this.options.reducedMotion);
    const rev = run.obstacleRevision ?? 0;
    if (rev !== this.revision) {
      this.revision = rev;
      this.world.refreshObstacles(this.course.obstacles, run.removedObstacles ?? new Set());
    }
    const target = BASE_FOG + fogToSceneDensity(run.fogAt());
    this.fog.density = damp(this.fog.density, target, 2, dt);
    this.fx.uFogDensity.value = this.fog.density;
    this.fx.uTime.value = this.clock;
    this.fx.uBoat.value.set(b.x, b.z);
    this.emitWake(run);
  }

  private emitWake(run: RenderableRun): void {
    const b = run.boat;
    if (b.speed < 1.2 || (this.options.lowGraphics && Math.random() < 0.5)) return;
    const fx = -Math.sin(b.heading);
    const fz = -Math.cos(b.heading);
    for (const side of [-1, 1]) {
      this.particles.emit({ x: b.x - fx * 1.8 - fz * side * 0.7, y: 0.08, z: b.z - fz * 1.8 + fx * side * 0.7, vx: -fz * side * 0.8, vz: fx * side * 0.8, life: 1.4, size: 0.3, grow: 3, color: '#b9cdf7', alpha: Math.min(0.6, b.speed / 14) });
    }
  }

  // ------------------------------------------------------------------------------------------------------ Hyde
  private updateHyde(run: RenderableRun, dt: number): HydeFrameInfo {
    const eff = run.effects ? run.effects() : NO_EFFECTS;
    const tl = run.surgeTelegraphLeftS ? run.surgeTelegraphLeftS() : 0;
    if (tl > this.tgMax || tl <= 0) this.tgMax = Math.max(tl, 0.5);
    const info = this.hyde.update(run.hyde, {
      dt, clock: this.clock, boat: run.boat, reduced: this.options.reducedMotion, low: this.options.lowGraphics,
      slowed: eff.hydeSlowed, distracted: eff.hydeDistracted, decoy: eff.decoy, rescueActive: run.status === 'rescue',
      telegraph: tl > 0 ? clamp(1 - tl / this.tgMax, 0.05, 1) : 0,
      cam: this.camera.position,
      fade: this.occFade,
    });
    if (info.strikeNow && !this.options.reducedMotion) this.shake = Math.max(this.shake, 0.8);
    if (info.emergeStarted && !this.options.reducedMotion) this.shake = Math.max(this.shake, 0.45);
    this.lastInfo = info;
    return info;
  }

  private updateAbilities(run: RenderableRun, dt: number, info: HydeFrameInfo): void {
    const b = run.boat;
    const spec = run.abilityDef?.specialty ?? 'shield';
    this.abilityFx.update({
      dt, clock: this.clock, t: run.t, boat: b, hyde: run.hyde, hydeScale: info.scale,
      effects: run.effects ? run.effects() : NO_EFFECTS, specialty: spec, magnitude: run.abilityDef?.magnitude ?? 20,
      status: run.abilityStatus ? run.abilityStatus() : null, rescue: run.status === 'rescue',
      removed: run.removedObstacles, revealRadius: run.revealRadius ? run.revealRadius() : 0,
      reduced: this.options.reducedMotion, low: this.options.lowGraphics,
    });
  }

  // ------------------------------------------------------------------------------------------------------ boat
  private updateBoat(run: RenderableRun, dt: number): void {
    const b = run.boat;
    const rig = this.boat;
    const T = this.clock;
    this.hitJolt = damp(this.hitJolt, 0, 5, dt);
    this.oarTimer += dt;
    const calm = this.options.reducedMotion ? 0.4 : 1;
    const swamped = run.swampedLeftS ? run.swampedLeftS() > 0 : false;
    this.swampBlend = damp(this.swampBlend, swamped ? 1 : 0, 4, dt);
    rig.root.position.set(b.x, 0, b.z);
    rig.root.rotation.y = b.heading;
    rig.tilt.position.y = 0.06 + (Math.sin(T * 1.9) * 0.05 + Math.sin(T * 3.1) * 0.025) * calm + this.hitJolt * 0.15 - this.swampBlend * 0.3;
    rig.tilt.rotation.z = clamp(b.turnRate * 0.16, -0.25, 0.25) + Math.sin(T * 1.4) * 0.03 * calm + this.hitJolt * 0.2 * Math.sin(T * 18) + this.swampBlend * 0.1 * Math.sin(T * 2.2);
    rig.tilt.rotation.x = Math.sin(T * 1.1) * 0.02 * calm - this.hitJolt * 0.15 + Math.max(0, 0.35 - this.oarTimer) * 0.12 + this.swampBlend * 0.08;
    // one oar stroke lasts 0.42 s: catch -> drive -> recovery; otherwise the oars rest feathered
    const p = Math.min(1, this.oarTimer / 0.42);
    const drive = p < 1 ? Math.sin(p * Math.PI) : 0;
    const sweep = p < 1 ? Math.cos(p * Math.PI) * 0.55 : 0.1;
    rig.oarL.rotation.set(0, sweep, -0.05 - (1 - drive) * 0.25);
    rig.oarR.rotation.set(0, -sweep, 0.05 + (1 - drive) * 0.25);
    rig.crewPivot.rotation.x = -drive * 0.22;
    rig.companion.position.set(-0.6 + Math.sin(T * 0.9) * 0.12, 1.3 + Math.sin(T * 2.3) * 0.13 + this.hitJolt * 0.3, -0.85 + Math.cos(T * 0.7) * 0.1);
    rig.companion.rotation.y = Math.sin(T * 0.5) * 0.4;
    rig.lanternLight.intensity = this.options.lowGraphics ? 0 : 40;
    if (swamped && Math.random() < 0.5) {
      this.particles.emit({ x: b.x + (Math.random() - 0.5) * 1.2, y: 0.5, z: b.z + (Math.random() - 0.5) * 2, vy: 2.2, life: 0.7, size: 0.35, grow: 1.4, color: '#cfe3ff', alpha: 0.8, gravity: -8 });
    }
  }

  // ------------------------------------------------------------------------------------------------------ camera
  private readonly fwd = { x: 0, z: -1 };
  private readonly camPos = new THREE.Vector3();
  private readonly camLook = new THREE.Vector3();
  private camYawV = 0;
  private camPitchV = 0.5;
  private cameraReady = false;
  private peekLeft = 0;
  private peekTotal = 1;
  private gapSm = 30;
  private occFade = 0;
  private removed: ReadonlySet<string> | undefined;
  private rigTry: [number, number] | null = null;
  private debugCam: { pos: THREE.Vector3; look: THREE.Vector3; fov: number } | null = null;

  /** Tooling only: pin the camera (aerial inspection shots). Pass null to resume the chase camera. */
  setDebugCamera(c: { pos: [number, number, number]; look: [number, number, number]; fov?: number } | null): void {
    this.debugCam = c && { pos: new THREE.Vector3(...c.pos), look: new THREE.Vector3(...c.look), fov: c.fov ?? 60 };
  }


  /** Minimum camera height over land (shore trees reach ~11 u): 0 over open water. */
  private groundClear(x: number, z: number): number {
    let need = 0;
    for (const l of this.landPolys) {
      if (x < l.minX || x > l.maxX || z < l.minZ || z > l.maxZ) continue;
      if (pointInPoly(l.pts, x, z)) need = Math.max(need, l.h + 10);
      else if (distToEdges(l.pts, x, z) < 3) need = Math.max(need, l.h * 0.5 + 3);
    }
    return need;
  }

  private landPolys: { pts: Vec2[]; h: number; minX: number; maxX: number; minZ: number; maxZ: number }[] = [];

  /**
   * Chase rig. Calm: behind and above the boat, looking ahead. As the Hyde closes (`need` 0..1) the camera slides to the
   * boat's side of the pair (never behind the Hyde, never inside him): a rear-lateral perch ~16-24 u from the boat, higher
   * with distance, looking at a point on the boat-Hyde line so the boat stays the subject (about 1/8 of the screen height,
   * lower-middle third) with the Hyde looming in the rear quarter of the frame and the course ahead running off to the right/left.
   * `rescue` (0..1) pulls it a little closer and lower for the grip.
   */
  private chaseRig(run: RenderableRun, h: HydeState | undefined, need: number, fov: number, orbit: number, rescue: number, outPos: THREE.Vector3, outLook: THREE.Vector3): void {
    const b = run.boat;
    const f = this.fwd;
    const speed = b.speed;
    const calmBack = 8.5 + speed * 0.2;
    const calmH = 3.6 + speed * 0.07;
    const ahead = 11;
    let ux = -f.x, uz = -f.z; // unit vector from the boat toward the Hyde (straight behind when there is none)
    let g = 26;
    if (h && need > 0.001) {
      const dx = h.x - b.x, dz = h.z - b.z;
      g = clamp(this.gapSm, 3, 60);
      const l = Math.hypot(dx, dz) || 1;
      ux = lerp(-f.x, dx / l, need);
      uz = lerp(-f.z, dz / l, need);
      const ul = Math.hypot(ux, uz) || 1;
      ux /= ul;
      uz /= ul;
    }
    // polar form around the boat: distance D and angle from the boat->Hyde axis. At the usual gaps the perch is near-broadside
    // (~80 deg); at very close gaps (lunge / grip) it swings round to the far side of the boat (~137 deg) so the boat is always
    // in front of the Hyde's bulk, never behind his arms or inside him
    const backB = lerp(calmBack, Math.min(0.3 * g + 2, 0.55 * g + 1), need);
    const sideFull = Math.min(13 + 0.12 * g + 0.3 * Math.max(0, g - 16), 22);
    const sideB = lerp(0, sideFull + 2 * rescue, need);
    const closeK = need * (1 - smoothstep(3, 10, g));
    const D = Math.hypot(backB, sideB);
    const thetaB = Math.atan2(sideB, backB);
    const theta = lerp(thetaB, 2.4, closeK);
    const rx = uz, rz = -ux; // perpendicular to u: +side puts the camera on the boat's right when u points behind it
    const offAt = (sgn: number): [number, number] => [D * (Math.cos(theta) * ux + Math.sin(theta) * sgn * rx), D * (Math.cos(theta) * uz + Math.sin(theta) * sgn * rz)];
    // pick the first perch that is over water and has a clear line to the boat (no rock between the lens and the boat);
    // the previous choice is tried first so the camera does not flip-flop
    let ox = 0, oz = 0;
    if (need > 0.4) {
      const sw = this.swingSign;
      const tries: [number, number][] = [[sw, 0], [-sw, 0], [sw, -0.55], [-sw, -0.55], [sw, 0.5], [-sw, 0.5], [sw, -1.1], [-sw, -1.1], [sw, -1.6], [-sw, -1.6]];
      if (this.rigTry) tries.unshift(this.rigTry);
      let best = 99;
      for (const [sg, dth] of tries) {
        const th = theta + dth * closeK;
        const cx = D * (Math.cos(th) * ux + Math.sin(th) * sg * rx), cz = D * (Math.cos(th) * uz + Math.sin(th) * sg * rz);
        const cost = (this.groundClear(b.x + cx, b.z + cz) > 0 ? 3 : 0) + (this.viewBlocked(b.x + cx, b.z + cz, b.x, b.z) ? 2 : 0) + (sg === sw ? 0 : 0.2) + Math.abs(dth) * 0.1;
        if (cost < best - 1e-6) { best = cost; ox = cx; oz = cz; this.rigTry = [sg, dth]; }
        if (best < 0.01) break;
      }
    } else {
      [ox, oz] = offAt(this.swingSign);
      this.rigTry = null;
    }
    const H = Math.max(lerp(calmH, 8 + 0.12 * g + Math.min(1.5, Math.max(0, sideFull - 18)) + 1.5 * rescue, need), this.groundClear(b.x + ox, b.z + oz));
    if (orbit !== 0) {
      // opening shot: swing around the boat so the camera starts ahead of the bow, looking back at the academy
      const c = Math.cos(orbit), s = Math.sin(orbit);
      [ox, oz] = [ox * c - oz * s, ox * s + oz * c];
    }
    const px = b.x + ox, pz = b.z + oz;
    // aim point: ahead of the bow when calm, on the boat-Hyde line (a bit past the boat) when the Hyde matters
    const k = Math.min(1, Math.abs(orbit) / 2.2);
    const aimU = Math.min(0.45 * g, 22);
    const aimX = lerp(b.x + f.x * ahead * (1 - k), b.x + ux * aimU, need);
    const aimZ = lerp(b.z + f.z * ahead * (1 - k), b.z + uz * aimU, need);
    // pitch: keep the boat low in the frame (NDC CALM_YB); the Hyde rises behind it
    const tanH = Math.tan((fov * Math.PI) / 360);
    const dBoat = Math.atan2(H - 0.6, Math.hypot(b.x - px, b.z - pz));
    const pitch = dBoat + Math.atan(CALM_YB * tanH);
    const dx = aimX - px, dz = aimZ - pz;
    const hd = Math.hypot(dx, dz) || 1;
    outPos.set(px, H, pz);
    outLook.set(px + (dx / hd) * Math.cos(pitch) * 60, H - Math.sin(pitch) * 60, pz + (dz / hd) * Math.cos(pitch) * 60);
    this.camBack = Math.hypot(ox, oz);
  }

  /** True when land or a rock stands between a camera spot and the boat (2D segment test against the shore polygons and solid obstacles). */
  private viewBlocked(px: number, pz: number, bx: number, bz: number): boolean {
    const sx = bx - px, sz = bz - pz;
    const sl2 = sx * sx + sz * sz || 1;
    // reefs / islets / shore boulders along the line of sight
    for (const w of [0.12, 0.28, 0.44, 0.6, 0.76, 0.9]) if (this.groundClear(px + sx * w, pz + sz * w) > 0) return true;
    for (const o of this.course.obstacles) {
      if (o.kind !== 'rock' && o.radius < 1.5) continue;
      if (this.removed?.has(o.id)) continue;
      const tt = ((o.x - px) * sx + (o.z - pz) * sz) / sl2;
      if (tt < 0 || tt > 0.97) continue;
      if (Math.hypot(px + sx * tt - o.x, pz + sz * tt - o.z) < o.radius * 1.6 + 1.2) return true;
    }
    return false;
  }

  /** Pushes the camera out of the Hyde's body volume (xz cylinder around his centre, tall enough that going over the top is not an option). */
  private clearOfHyde(pos: THREE.Vector3, h: HydeState, b: { x: number; z: number }, scale: number): void {
    const R = clamp(4.3 * scale + 3, 6, 14);
    let dx = pos.x - h.x, dz = pos.z - h.z;
    const d = Math.hypot(dx, dz);
    if (d >= R) return;
    if (d < 0.01) { dx = h.z - b.z; dz = b.x - h.x; } // directly on him: step out sideways of the boat-Hyde axis
    const l = Math.hypot(dx, dz) || 1;
    pos.x = h.x + (dx / l) * R;
    pos.z = h.z + (dz / l) * R;
    pos.y = Math.max(pos.y, 4 + scale * 1.2);
  }

  private updateCamera(run: RenderableRun, dt: number, info: HydeFrameInfo): void {
    this.removed = run.removedObstacles;
    const b = run.boat;
    const reduced = this.options.reducedMotion;
    const h = run.hyde;
    const speed = b.speed;
    const rescue = run.status === 'rescue';
    const hydeUp = !!h && h.phase !== 'dormant' && h.phase !== 'retreating' && info.visible;
    const hdist = h ? Math.hypot(h.x - b.x, h.z - b.z) : 999;

    // heading follow
    this.camYaw = angleLerp(this.camYaw, b.heading, 1 - Math.exp(-(reduced ? 2.6 : 4.2) * dt));
    this.fwd.x = -Math.sin(this.camYaw);
    this.fwd.z = -Math.cos(this.camYaw);
    const rightX = -this.fwd.z, rightZ = this.fwd.x; // right of the heading

    // how much the Hyde matters to the shot: grows as he nears and as he rises out of the water
    const needRaw = hydeUp && h ? smoothstep(72, 44, hdist) * (0.3 + 0.7 * smoothstep(0.12, 0.65, info.vis)) : 0;
    this.need = damp(this.need, needRaw, needRaw > this.need ? 3 : 1.0, dt);
    const gapNow = clamp(hdist, 3, 60);
    this.gapSm = damp(this.gapSm, gapNow, gapNow < this.gapSm ? 9 : 2.5, dt); // follows a closing Hyde fast (lunge), recedes slowly
    const need = this.need;

    // which side the camera swings to (flips only when the Hyde is clearly on the camera's side)
    if (h && hydeUp) {
      const lat = (h.x - b.x) * rightX + (h.z - b.z) * rightZ; // + = Hyde on the boat's right
      if (Math.abs(lat) > 6 && Math.sign(lat) === this.swingSign) this.swingSign = -this.swingSign;
    }

    // flip the swing side when that side is over land and the other is open water
    if (need > 0.25) {
      const sd = Math.min(13 + 0.12 * this.gapSm + 0.3 * Math.max(0, this.gapSm - 16), 22) * 1.1;
      const bk = 0.3 * this.gapSm + 2;
      const cx = b.x - this.fwd.x * bk, cz = b.z - this.fwd.z * bk;
      const mine = this.groundClear(cx + rightX * sd * this.swingSign, cz + rightZ * sd * this.swingSign);
      const other = this.groundClear(cx - rightX * sd * this.swingSign, cz - rightZ * sd * this.swingSign);
      if (mine > 0 && other < mine * 0.5) this.swingSign = -this.swingSign;
    }

    // field of view
    const kick = reduced ? 0 : Math.min(9, speed * 0.75) + this.abilityFx.speedBlend * 5;
    const fovTarget = this.baseVFov + kick * (1 - 0.6 * need) + need * (reduced ? 2 : 4);
    this.fovNow = damp(this.fovNow, fovTarget, 3, dt);
    let fov = this.fovNow;

    // opening shot: the first seconds sweep from ahead of the bow (academy behind the boat) round to the chase position
    const intro = reduced || rescue ? 0 : (1 - smoothstep(0.8, 4.4, run.t)) * 2.9;
    const pos = this.tmpC;
    const look = this.tmpA;
    this.rescueBlend = damp(this.rescueBlend, rescue ? 1 : 0, reduced ? 3 : 4.5, dt);
    this.chaseRig(run, h, need, fov, intro * -this.swingSign, this.rescueBlend, pos, look);
    this.camMode = 'chase';

    // glances: the Hyde-reveal cinematic (run.cinematic) and a short peek when he first starts stalking
    const cin = run.cinematic ? run.cinematic() : null;
    let glanceW = 0;
    let glanceY = 3.2;
    let glanceMix = 0.4;
    let glanceFov = 72;
    if (cin) {
      this.cinTotal = Math.max(this.cinTotal, cin.remainingS);
      const el = this.cinTotal - cin.remainingS;
      glanceW = Math.min(smoothstep(0, reduced ? 0.7 : 0.45, el), smoothstep(0, reduced ? 0.8 : 0.55, cin.remainingS));
      glanceY = 3.2 + info.scale * 0.8;
      this.peekLeft = 0;
    } else {
      this.cinTotal = 0;
      if (this.peekLeft > 0 && !rescue && h && h.phase !== 'dormant') {
        this.peekLeft = Math.max(0, this.peekLeft - dt);
        const el = this.peekTotal - this.peekLeft;
        glanceW = Math.min(smoothstep(0, 0.4, el), smoothstep(0, 0.5, this.peekLeft));
        glanceY = 0.9;
        glanceMix = 0.62;
        glanceFov = 64;
      } else this.peekLeft = 0;
    }
    this.cinBlend = glanceW;
    const alt = this.tmpB;
    if (glanceW > 0.001 && h) {
      const mx = (b.x + h.x) / 2, mz = (b.z + h.z) / 2;
      const sep = Math.max(14, hdist);
      const dist = clamp(sep * 0.5, 13, 30);
      if (glanceW < 0.05) {
        const lat = (h.x - b.x) * rightX + (h.z - b.z) * rightZ;
        this.cinSide = Math.abs(lat) > 4 ? -Math.sign(lat) : 1;
        const cA = this.groundClear(mx + rightX * dist, mz + rightZ * dist);
        const cB = this.groundClear(mx - rightX * dist, mz - rightZ * dist);
        if ((this.cinSide > 0 ? cA : cB) > 0 && (this.cinSide > 0 ? cB : cA) < (this.cinSide > 0 ? cA : cB)) this.cinSide = -this.cinSide;
      }
      alt.set(mx + rightX * this.cinSide * dist, Math.max(5 + sep * 0.07, this.groundClear(mx + rightX * this.cinSide * dist, mz + rightZ * this.cinSide * dist)), mz + rightZ * this.cinSide * dist);
      pos.lerp(alt, glanceW);
      look.lerp(this.tmpD.set(lerp(b.x, h.x, glanceMix), glanceY, lerp(b.z, h.z, glanceMix)), glanceW);
      fov = lerp(fov, glanceFov, glanceW);
      this.camMode = 'cinematic';
    }

    if (this.rescueBlend > 0.001 && h) {
      fov = lerp(fov, 62, this.rescueBlend);
      if (this.rescueBlend > 0.5) this.camMode = 'rescue';
    }

    // never let the camera sit inside the Hyde's body (lunge, surge hold, rescue, and the blends between rigs)
    if (h && info.visible) this.clearOfHyde(pos, h, b, info.scale);

    // shake: collisions + a faint tremor as the Hyde looms (none with reduced motion)
    this.shake = damp(this.shake, 0, 7, dt);
    if (!reduced) {
      const tremor = hydeUp ? Math.pow(clamp(info.threat, 0, 1), 3) * 0.1 : 0;
      const amp = this.shake * 0.5 + tremor;
      if (amp > 0.004) {
        pos.x += (Math.random() - 0.5) * amp;
        pos.y += (Math.random() - 0.5) * amp * 0.7;
        pos.z += (Math.random() - 0.5) * amp;
      }
    }
    if (!this.cameraReady) {
      this.cameraReady = true;
      this.camPos.copy(pos);
      this.camLook.copy(look);
      this.camYawV = Math.atan2(look.x - pos.x, look.z - pos.z);
      this.camPitchV = Math.atan2(pos.y - look.y, Math.hypot(look.x - pos.x, look.z - pos.z));
    }
    // smoothing of the final pose, done relative to the boat (angle / radius / height around it) so a swing between perches orbits the
    // boat instead of flying through the scene, and the boat never leaves the frame while the rigs blend
    const kPos = 1 - Math.exp(-(reduced ? 6 : 12) * dt);
    const a0 = Math.atan2(this.camPos.x - b.x, this.camPos.z - b.z), a1 = Math.atan2(pos.x - b.x, pos.z - b.z);
    const r0 = Math.hypot(this.camPos.x - b.x, this.camPos.z - b.z), r1 = Math.hypot(pos.x - b.x, pos.z - b.z);
    const aa = a0 + wrapAngle(a1 - a0) * kPos, rr = lerp(r0, r1, kPos);
    this.camPos.set(b.x + Math.sin(aa) * rr, lerp(this.camPos.y, pos.y, kPos), b.z + Math.cos(aa) * rr);
    // the view direction (yaw / pitch) is smoothed with the same rate, so an orbit of the perch turns the camera with it
    const yawT = Math.atan2(look.x - pos.x, look.z - pos.z);
    const pitchT = Math.atan2(pos.y - look.y, Math.hypot(look.x - pos.x, look.z - pos.z));
    this.camYawV += wrapAngle(yawT - this.camYawV) * kPos;
    this.camPitchV = lerp(this.camPitchV, pitchT, kPos);
    this.camLook.set(this.camPos.x + Math.sin(this.camYawV) * Math.cos(this.camPitchV) * 60, this.camPos.y - Math.sin(this.camPitchV) * 60, this.camPos.z + Math.cos(this.camYawV) * Math.cos(this.camPitchV) * 60);
    if (h && info.visible) this.clearOfHyde(this.camPos, h, b, info.scale);
    // see-through Hyde whenever his body sits between the lens and the boat (and for the rescue grip), so the boat is never lost
    let occ = 0;
    if (h && info.visible) {
      const sx = b.x - this.camPos.x, sz = b.z - this.camPos.z;
      const sl2 = sx * sx + sz * sz || 1;
      const tt = clamp(((h.x - this.camPos.x) * sx + (h.z - this.camPos.z) * sz) / sl2, 0, 1);
      const dHy = Math.hypot(this.camPos.x + sx * tt - h.x, this.camPos.z + sz * tt - h.z);
      const rb = 3.4 * info.scale + 1.5;
      if (tt < 0.98) occ = 1 - smoothstep(rb * 0.6, rb * 1.3, dHy);
      if (rescue) occ = Math.max(occ, 0.2);
    }
    this.occFade = damp(this.occFade, occ, 8, dt);
    this.camera.position.copy(this.camPos);
    this.camera.lookAt(this.camLook);
    if (!reduced) this.camera.rotateZ(clamp(-b.turnRate * 0.03, -0.05, 0.05) * (1 - this.cinBlend));
    this.camera.fov = fov;
    this.camera.updateProjectionMatrix();
    this.camera.updateMatrixWorld(true);

    // where is the Hyde on screen right now (debug + tests)
    this.hydeOnScreen = false;
    if (h && info.visible && info.vis > 0.3) {
      this.hydeNdc.copy(info.head).project(this.camera);
      this.hydeOnScreen = this.hydeNdc.z < 1 && Math.abs(this.hydeNdc.x) <= 1 && Math.abs(this.hydeNdc.y) <= 1;
    }
  }

  // ------------------------------------------------------------------------------------------------------ overlay / mood
  private updateOverlay(run: RenderableRun, dt: number): void {
    const u = this.overlayMat.uniforms as unknown as OverlayUniforms;
    const h = run.hyde;
    const hydeThreat = h && h.phase !== 'dormant' && h.phase !== 'retreating' ? clamp(h.threat, 0, 1) : 0;
    const tl = run.surgeTelegraphLeftS ? run.surgeTelegraphLeftS() : 0;
    const telePulse = tl > 0 ? 0.55 + 0.25 * Math.sin(this.clock * 14) : 0;
    this.threatSm = damp(this.threatSm, Math.max(hydeThreat * 0.85, telePulse), 4, dt);
    const reduced = this.options.reducedMotion;
    u.uThreat.value = this.threatSm * (reduced ? 0.6 : 1);
    u.uRescue.value = this.rescueBlend * (reduced ? 0.6 : 1);
    u.uTime.value = this.clock;
    this.flash = damp(this.flash, 0, 5, dt);
    u.uFlash.value.set(this.flashRGB[0], this.flashRGB[1], this.flashRGB[2], this.flash);

    // mood: the sky/water horizon sours toward violet-red as the Hyde closes in, warms near the safe harbour
    this.harbourBlend = damp(this.harbourBlend, run.safeHarbour ? 1 : 0, 0.8, dt);
    const m = clamp(this.threatSm * 0.7, 0, 0.6);
    const hz = MOOD_CALM_H.map((c, i) => lerp(c, MOOD_DREAD_H[i], m)) as [number, number, number];
    const zn = MOOD_CALM_Z.map((c, i) => lerp(c, MOOD_DREAD_Z[i], m)) as [number, number, number];
    hz[0] += 0.06 * this.harbourBlend; hz[1] += 0.03 * this.harbourBlend;
    this.world.setMoodRGB(hz, zn);
  }

  // ------------------------------------------------------------------------------------------------------ debug
  /** Debug: where the boat is in the frame (NDC) and how tall a 3 u object at the boat is, as a fraction of the screen height. */
  private boatScreen(b: { x: number; z: number }): { ndcX: number; ndcY: number; heightFrac: number } {
    const v = new THREE.Vector3(b.x, 0.9, b.z).project(this.camera);
    const d = this.camera.position.distanceTo(new THREE.Vector3(b.x, 0.9, b.z));
    const frac = 3 / (2 * Math.tan((this.camera.fov * Math.PI) / 360) * d);
    return { ndcX: Math.round(v.x * 100) / 100, ndcY: Math.round(v.y * 100) / 100, heightFrac: Math.round(frac * 1000) / 1000 };
  }

  /** Debug: is the Hyde's torso (centre of mass) inside the frame. */
  private hydeBodyOnScreen(h: HydeState): boolean {
    if (!this.lastInfo.visible) return false;
    const v = new THREE.Vector3(h.x, 3.2 * this.lastInfo.scale, h.z).project(this.camera);
    return v.z < 1 && Math.abs(v.x) < 1 && Math.abs(v.y) < 1;
  }

  getDebugState(run: RenderableRun): object {
    const r = (v: number) => Math.round(v * 100) / 100;
    const h = run.hyde;
    const info = this.renderer.info;
    return {
      camera: {
        x: r(this.camera.position.x), y: r(this.camera.position.y), z: r(this.camera.position.z), fov: r(this.camera.fov),
        back: r(this.camBack), need: r(this.need), mode: this.camMode,
      },
      boat: { x: r(run.boat.x), z: r(run.boat.z), heading: r(run.boat.heading), speed: r(run.boat.speed), ...this.boatScreen(run.boat) },
      hyde: h && {
        phase: h.phase, visibility: r(h.visibility), threat: r(h.threat), distance: r(h.distance), rendered: this.lastInfo.visible,
        scale: r(this.lastInfo.scale), onScreen: this.hydeOnScreen, ndc: { x: r(this.hydeNdc.x), y: r(this.hydeNdc.y) },
        bodyOnScreen: this.hydeBodyOnScreen(h),
      },
      drawCalls: info.render.calls,
      triangles: info.render.triangles,
      geometries: info.memory.geometries,
      textures: info.memory.textures,
      world: { ...this.world.stats },
      lowGraphics: this.options.lowGraphics,
      reducedMotion: this.options.reducedMotion,
      size: { w: this.width, h: this.height },
    };
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.resizeObserver.disconnect();
    this.abilityFx.dispose();
    this.hyde.dispose();
    this.world.dispose();
    this.boat.dispose();
    this.particles.dispose();
    this.overlayMat.dispose();
    disposeObject(this.scene);
    this.glowTex?.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.canvas.remove();
  }
}
