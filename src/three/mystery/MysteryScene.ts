// "The Silent Evidence" renderer: a night-time gothic island walked in third person. Reads only the public state of a
// RenderableMysteryRun (MysteryRun satisfies it) and never changes gameplay. Everything is drawn from the MapDef.
import * as THREE from 'three';
import type { ClueId, Duo, HydeMode, MapDef, StampedEvent, Vec2 } from '../../mystery/types.ts';
import { ParticlePool } from '../particles.ts';
import { createSkyMaterial, createWaterMaterial } from '../shaders.ts';
import { clamp, damp, lerp, makeGlowTexture, mulberry32, smoothstep } from '../util.ts';
import { createFxUniforms, createFresnelMaterial, type FxUniforms } from '../action/fx.ts';
import { lambertVC } from '../actors.ts';
import { Avatar, Companion, type Stance } from './characters.ts';
import { PAL, angleLerp, distPointSeg, eggHex, fwdOf, makeBlobTexture, makeGlyphTexture, wrapAngle, yawOf } from './common.ts';
import { HydeBiped } from './hydeBiped.ts';
import { ClueProp, EggRig } from './items.ts';
import { createOverlay } from './overlay.ts';
import { ThingRig, type ThingPose } from './thing.ts';
import { NO_EFFECTS, type MysterySceneOptions, type RenderableMysteryRun } from './types.ts';
import { BeamField, BoltField, GlowSet, HazardOutline, RingField, ShapeField, coinGeo, ghostGeo, streakGeo } from './vfx.ts';
import { MysteryWorld } from './world.ts';

export type { MysterySceneOptions } from './types.ts';

const FOG_COLOR = 0x10152e;
const BASE_FOG = 0.0165;
const CRYPT_FOG = 0.036;
const BASE_FOV = 62;
const HYDE_CHEST_Y = 1.7;

interface NoiseRing { x: number; z: number; r: number; loud: number; age: number; life: number; color: THREE.Color; footstep: boolean }
interface Timed { t: number; life: number }
interface BoltFx extends Timed { from: 'player' | 'switch'; to: 'hyde' | 'gate'; color: THREE.Color }
interface Pulse extends Timed { x: number; z: number; r: number; color: THREE.Color }

const NOISE_COLOR: Record<string, string> = {
  footstep: '#cdd8ff', egg_drop: '#ffd24a', ability: '#b79cff', interact: '#9fe8c8', impact: '#ffb04a', decoy: '#6fe0ff',
};

const C = (hex: string): THREE.Color => new THREE.Color(hex);

export class MysteryScene {
  readonly canvas: HTMLCanvasElement;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(BASE_FOV, 16 / 9, 0.3, 700);
  private readonly fog = new THREE.FogExp2(FOG_COLOR, BASE_FOG);
  private readonly fx: FxUniforms = createFxUniforms();
  private readonly glowTex: THREE.Texture | null;
  private world!: MysteryWorld;
  private avatar!: Avatar;
  private companion!: Companion;
  private readonly hyde: HydeBiped;
  private readonly egg: EggRig;
  private clues = new Map<ClueId, ClueProp>();
  private readonly thing: ThingRig;
  private readonly thingHint: ThingRig;
  private readonly particles: ParticlePool;
  private readonly rings: RingField;
  private readonly glows: GlowSet;
  private readonly bolts: BoltField;
  private readonly beams: BeamField;
  private readonly streaks: ShapeField;
  private readonly ghosts: ShapeField;
  private readonly coins: ShapeField;
  private hazard!: HazardOutline;
  private readonly overlay = createOverlay();
  private readonly sky: THREE.Mesh;
  private water: THREE.Mesh;
  private readonly waterMat: THREE.Material;
  private readonly hemi = new THREE.HemisphereLight(0x8e9cf0, 0x2a3070, 2.1);
  private readonly moon = new THREE.DirectionalLight(0xb8c4ff, 2.9);
  private readonly lantern = new THREE.PointLight(0xffc880, 0, 15, 1.6);
  private readonly shield: THREE.Mesh;
  private readonly eggShield: THREE.Mesh;
  private readonly blobs: THREE.InstancedMesh;
  private readonly blobTex: THREE.Texture | null;
  private readonly alertQ: THREE.Sprite;
  private readonly alertX: THREE.Sprite;
  private readonly resizeObserver: ResizeObserver;
  private readonly rnd = mulberry32(1337);

  // ---- state
  private clock = 0;
  private width = 1;
  private height = 1;
  private disposed = false;
  private lastRun: RenderableMysteryRun | null = null;
  private noise: NoiseRing[] = [];
  private pulses: Pulse[] = [];
  private boltFx: BoltFx[] = [];
  private gazeT = 0;
  private flash = 0;
  private flashRGB: [number, number, number] = [1, 1, 1];
  private shake = 0;
  private threat = 0;
  private hideK = 0;
  private dimK = 0;
  private fogNow = BASE_FOG;
  private depositGlow = 0;
  // camera
  private camYaw = 0;
  private camPitch = 0.12;
  private camDist = 3.7;
  private pivotY = 1.5;
  private fovNow = BASE_FOV;
  private baseVFov = BASE_FOV;
  private cameraReady = false;
  private hydeFade = 0;
  private assistK = 0;
  private assistSide = 1;
  private camBob = 0;
  private readonly camPos = new THREE.Vector3();
  private readonly tmp = new THREE.Vector3();
  private readonly tmp2 = new THREE.Vector3();
  private readonly ndc = new THREE.Vector3();
  private hydeOnScreen = false;
  private hydeEdge = { x: 0, y: 0, s: 0 };
  // player visuals
  private prevX = 0;
  private prevZ = 0;
  private prevInit = false;
  private bodyYaw = 0;
  private velX = 0;
  private velZ = 0;
  private idleT = 0;
  private lastStance: Stance = 'idle';
  // egg
  private eggBounce = 0;
  private eggPrevState = '';
  private eggDeliverT = -1;
  // thing
  private thingOverride: ThingPose | null = null;
  private thingWave = 0;
  private hintT = 0;
  private hintTarget: Vec2 | null = null;
  private hintScale = 0;
  private hydeModePrev: HydeMode = 'PATROL';
  private alertT = 0;
  private lastDebugCam = { yaw: 0, pitch: 0, dist: 0 };
  private fluff = 0;
  // adaptive resolution: drops the render scale when frames run slow (fill-rate bound laptops), recovers when there is headroom
  private adaptive = true;
  private renderScale = 1;
  private perfEma = 16.7;
  private perfClock = 0;
  private perfLastChange = 0;
  private perfUpWait = 6;
  private perfLastUp = -99;
  private debugCam: { pos: THREE.Vector3; look: THREE.Vector3; fov: number; fog?: number } | null = null;
  private showcase = false;

  constructor(private readonly container: HTMLElement, private map: MapDef, private duo: Duo, private options: MysterySceneOptions) {
    this.canvas = document.createElement('canvas');
    this.canvas.style.cssText = 'display:block;width:100%;height:100%';
    this.canvas.setAttribute('aria-label', 'Third-person view of Raven Island at night');
    container.appendChild(this.canvas);
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: !options.lowGraphics, powerPreference: 'high-performance' });
    this.renderer.setClearColor(FOG_COLOR, 1);
    this.glowTex = makeGlowTexture(64);
    this.scene.fog = this.fog;
    this.scene.background = new THREE.Color(FOG_COLOR);

    this.moon.position.set(-62, 47, -45);
    this.lantern.visible = !options.lowGraphics;
    this.scene.add(this.hemi, this.moon, this.lantern);

    // sky dome follows the camera
    const skyMat = createSkyMaterial();
    skyMat.uniforms.uStars.value = 1;
    // fill-rate: draw the sky AFTER the opaque pass at the far plane with depth testing, so the noisy sky shader only runs on
    // pixels that nothing else covers (the original draws first, fullscreen, and gets overdrawn by terrain and walls)
    skyMat.depthTest = true;
    skyMat.vertexShader = skyMat.vertexShader.replace('gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);', 'gl_Position = (projectionMatrix * modelViewMatrix * vec4(position, 1.0)).xyww;');
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(500, 24, 12), skyMat);
    this.sky.renderOrder = 900;
    this.sky.frustumCulled = false;
    this.scene.add(this.sky);

    // water
    this.waterMat = options.lowGraphics ? new THREE.MeshBasicMaterial({ color: 0x0b1235 }) : createWaterMaterial();
    this.water = new THREE.Mesh(new THREE.PlaneGeometry(1400, 1400, options.lowGraphics ? 1 : 24, options.lowGraphics ? 1 : 24).rotateX(-Math.PI / 2), this.waterMat);
    this.water.position.y = -1.25;
    this.water.renderOrder = 800;
    this.scene.add(this.water);

    this.particles = new ParticlePool(options.lowGraphics ? 320 : 900);
    this.particles.setActiveLimit(options.lowGraphics ? 320 : 900);
    this.rings = new RingField(72);
    this.glows = new GlowSet(this.fx, 420);
    this.bolts = new BoltField(200);
    this.beams = new BeamField(14);
    this.streaks = new ShapeField(streakGeo(), 14);
    this.ghosts = new ShapeField(ghostGeo(), 4);
    this.coins = new ShapeField(coinGeo(), 8, false, 4);
    this.hyde = new HydeBiped();
    this.egg = new EggRig();
    // every extra point light is paid per lit pixel: the Hyde's eye light and the egg light are replaced by glow billboards
    this.hyde.light.visible = false;
    this.egg.light.visible = false;
    this.thing = new ThingRig({ reducedMotion: options.reducedMotion });
    this.thingHint = new ThingRig({ reducedMotion: options.reducedMotion, glow: 0.5 });
    this.thing.root.scale.setScalar(1.55);
    this.thingHint.root.scale.setScalar(0);
    this.scene.add(this.thing.root, this.thingHint.root, this.hyde.root, this.egg.root);
    this.scene.add(this.rings.mesh, this.glows.field.mesh, this.bolts.mesh, this.beams.mesh, this.streaks.mesh, this.ghosts.mesh, this.coins.mesh, this.particles.points);

    // bubbles: Aegislash shield (player) and egg shield
    this.shield = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 2), createFresnelMaterial('#8fc8ff', this.fx));
    this.shield.visible = false;
    this.eggShield = new THREE.Mesh(new THREE.IcosahedronGeometry(0.5, 1), createFresnelMaterial('#ffcf4a', this.fx));
    this.eggShield.visible = false;
    this.scene.add(this.shield, this.eggShield);

    // blob shadows (player, companion, Hyde, egg)
    this.blobTex = makeBlobTexture(64);
    const blobGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    this.blobs = new THREE.InstancedMesh(blobGeo, new THREE.MeshBasicMaterial({ map: this.blobTex ?? undefined, color: 0x000000, transparent: true, opacity: 0.8, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4, fog: false }), 6);
    this.blobs.frustumCulled = false;
    this.blobs.renderOrder = 2;
    this.scene.add(this.blobs);

    // alert markers above the Hyde
    const qTex = makeGlyphTexture('?', '#ffd86a'), xTex = makeGlyphTexture('!', '#ff5a4a');
    this.alertQ = new THREE.Sprite(new THREE.SpriteMaterial({ map: qTex ?? undefined, transparent: true, depthWrite: false, depthTest: false, fog: false }));
    this.alertX = new THREE.Sprite(new THREE.SpriteMaterial({ map: xTex ?? undefined, transparent: true, depthWrite: false, depthTest: false, fog: false }));
    for (const s of [this.alertQ, this.alertX]) { s.visible = false; s.renderOrder = 20; s.scale.setScalar(0.9); this.scene.add(s); }

    this.scene.add(this.overlay.mesh);
    this.buildMapObjects();

    if (typeof window !== 'undefined' && /[?&]scenedebug/.test(window.location.search)) (window as unknown as { __mysteryScene?: MysteryScene }).__mysteryScene = this;
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();
  }

  // ------------------------------------------------------------------------------------------------------ build
  private buildMapObjects(): void {
    this.world = new MysteryWorld(this.map, this.fx, this.options.lowGraphics);
    this.scene.add(this.world.root);
    this.avatar = new Avatar(this.duo.characterId, lambertVC({ emissive: new THREE.Color('#241d34'), emissiveIntensity: 1 }));
    this.scene.add(this.avatar.root);
    this.companion = new Companion(this.duo.pokemonId);
    this.scene.add(this.companion.root);
    this.clues.clear();
    for (const c of this.map.clues) {
      const p = new ClueProp(c.clueId);
      p.root.position.set(c.x, 0, c.z);
      this.scene.add(p.root);
      this.clues.set(c.clueId, p);
    }
    this.hazard = new HazardOutline(this.map, this.map.powerSwitch?.gateWallId);
    this.scene.add(this.hazard.mesh);
    const th = this.world.dress.thing;
    this.thing.root.position.set(th.x, th.y, th.z);
    this.thing.root.rotation.y = th.yaw;
    if (this.world.glowStatic) this.world.glowStatic.mesh.visible = true;
    this.prevInit = false;
    this.cameraReady = false;
  }

  private destroyMapObjects(): void {
    this.scene.remove(this.world.root, this.avatar.root, this.companion.root, this.hazard.mesh);
    for (const p of this.clues.values()) { this.scene.remove(p.root); p.dispose(); }
    this.world.dispose();
    this.avatar.dispose();
    this.companion.dispose();
    this.hazard.dispose();
  }

  setOptions(options: Partial<MysterySceneOptions>): void {
    const lowChanged = options.lowGraphics !== undefined && options.lowGraphics !== this.options.lowGraphics;
    this.options = { ...this.options, ...options };
    if (lowChanged) {
      // the water material and antialiasing are chosen at creation; rebuild the static world with the matching detail
      this.destroyMapObjects();
      this.buildMapObjects();
      this.particles.setActiveLimit(this.options.lowGraphics ? 320 : 900);
      this.scene.remove(this.water);
      this.water.geometry.dispose();
      this.water.material = this.options.lowGraphics ? new THREE.MeshBasicMaterial({ color: 0x0b1235 }) : createWaterMaterial();
      this.water = new THREE.Mesh(new THREE.PlaneGeometry(1400, 1400, this.options.lowGraphics ? 1 : 24, this.options.lowGraphics ? 1 : 24).rotateX(-Math.PI / 2), this.water.material);
      this.water.position.y = -1.25;
      this.water.renderOrder = 800;
      this.scene.add(this.water);
    }
    this.lantern.visible = !this.options.lowGraphics;
    this.resize();
  }

  private resize(): void {
    const w = Math.max(1, this.container.clientWidth);
    const h = Math.max(1, this.container.clientHeight);
    this.width = w;
    this.height = h;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, this.options.lowGraphics ? 1 : 1.5) * this.renderScale);
    this.renderer.setSize(w, h, false);
    const aspect = w / h;
    this.camera.aspect = aspect;
    this.baseVFov = aspect >= 1.5 ? BASE_FOV : Math.min(90, (2 * Math.atan(Math.tan((BASE_FOV * Math.PI) / 360) * (1.5 / aspect)) * 180) / Math.PI);
    this.camera.fov = this.fovNow = this.baseVFov;
    this.camera.updateProjectionMatrix();
  }

  // ------------------------------------------------------------------------------------------------------ public API
  /** Pose of the in-world Thing at the pier (the UI can set it to match captions); null returns to automatic behaviour. */
  setThingPose(p: ThingPose | null): void { this.thingOverride = p; }

  /** Tooling: pin the camera (aerial / inspection shots). Pass null to resume the follow camera. `fog` overrides the fog density. */
  setDebugCamera(c: { pos: [number, number, number]; look: [number, number, number]; fov?: number; fog?: number } | null): void {
    this.debugCam = c && { pos: new THREE.Vector3(...c.pos), look: new THREE.Vector3(...c.look), fov: c.fov ?? 60, fog: c.fog };
  }

  /** Turn the automatic resolution scaling on or off (the preview harness turns it off for scripted, non-real-time frames). */
  setAdaptiveResolution(on: boolean): void {
    this.adaptive = on;
    if (!on && this.renderScale !== 1) { this.renderScale = 1; this.resize(); }
  }

  private trackPerf(rawDt: number): void {
    if (!this.adaptive || rawDt <= 0 || rawDt > 0.25) return;
    this.perfEma += (rawDt * 1000 - this.perfEma) * 0.05;
    this.perfClock += rawDt;
    const since = this.perfClock - this.perfLastChange;
    if (since < 1.6) return;
    if (this.perfEma > 23 && this.renderScale > 0.55) {
      // an up-probe that fails soon after succeeding doubles the wait before the next probe
      if (this.perfClock - this.perfLastUp < 8) this.perfUpWait = Math.min(60, this.perfUpWait * 2);
      this.renderScale = Math.max(0.55, this.renderScale - (this.perfEma > 40 ? 0.2 : 0.1));
      this.perfLastChange = this.perfClock;
      this.perfEma = 16.7;
      this.resize();
    } else if (this.perfEma < 18.2 && this.renderScale < 1 && since > this.perfUpWait) {
      this.renderScale = Math.min(1, this.renderScale + 0.1);
      this.perfLastChange = this.perfClock;
      this.perfLastUp = this.perfClock;
      this.resize();
    }
  }

  /** Home-screen hero view: a slow orbit around the pier and Thing with the island and Iago Tower behind (thinner fog). */
  setShowcase(on: boolean): void { this.showcase = on; this.cameraReady = false; }

  /** Tooling: advance smoothing/animation by `seconds` of scene time without drawing, then draw once. */
  settleDebug(seconds: number): void {
    const run = this.lastRun;
    if (!run || this.disposed) return;
    const n = Math.max(1, Math.round(seconds * 30));
    for (let i = 0; i < n; i++) this.update(run, [], 1 / 30);
    this.draw(run);
  }

  render(run: RenderableMysteryRun, events: StampedEvent[], dt: number): void {
    if (this.disposed) return;
    this.trackPerf(dt);
    this.update(run, events, clamp(dt, 0, 0.1));
    this.draw(run);
  }

  /** Screen position of the Hyde: `onScreen`, NDC and distance (for HUD warnings). */
  getHydeScreen(): { onScreen: boolean; ndcX: number; ndcY: number; behind: boolean; distance: number } {
    const run = this.lastRun;
    const d = run ? Math.hypot(run.hyde.x - run.player.x, run.hyde.z - run.player.z) : 0;
    return { onScreen: this.hydeOnScreen, ndcX: this.ndc.x, ndcY: this.ndc.y, behind: this.ndc.z > 1, distance: d };
  }

  getDebugState(run: RenderableMysteryRun): Record<string, unknown> {
    const info = this.renderer.info;
    const h = run.hyde;
    return {
      camera: {
        x: +this.camera.position.x.toFixed(2), y: +this.camera.position.y.toFixed(2), z: +this.camera.position.z.toFixed(2),
        yaw: +this.camYaw.toFixed(3), pitch: +this.camPitch.toFixed(3), dist: +this.camDist.toFixed(2), fov: +this.camera.fov.toFixed(1),
      },
      player: { x: +run.player.x.toFixed(2), z: +run.player.z.toFixed(2), yaw: +run.player.yaw.toFixed(3), stance: run.player.stance, crouched: run.player.crouched, hidden: run.player.hidden, bodyYaw: +this.bodyYaw.toFixed(3) },
      hyde: {
        mode: h.mode, x: +h.x.toFixed(2), z: +h.z.toFixed(2), speed: +h.speed.toFixed(2), onScreen: this.hydeOnScreen,
        ndc: { x: +this.ndc.x.toFixed(3), y: +this.ndc.y.toFixed(3) }, distance: +Math.hypot(h.x - run.player.x, h.z - run.player.z).toFixed(2),
        fade: +this.hydeFade.toFixed(2), stone: +this.hyde.stoneAmount.toFixed(2), frost: +this.hyde.frostAmount.toFixed(2),
      },
      egg: { state: run.egg.state, tier: run.egg.tier },
      companion: { pokemon: this.companion.pokemonId, visual: this.companion.visual, modelSource: this.companion.modelSource, modelError: this.companion.modelError },
      drawCalls: info.render.calls,
      triangles: info.render.triangles,
      geometries: info.memory.geometries,
      textures: info.memory.textures,
      programs: info.programs?.length ?? 0,
      noiseRings: this.noise.length,
      viewport: { w: this.width, h: this.height },
      stance: this.lastStance,
      options: { ...this.options },
      fog: +this.fog.density.toFixed(4),
      renderScale: +this.renderScale.toFixed(2),
      frameMsEma: +this.perfEma.toFixed(1),
    };
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.resizeObserver.disconnect();
    this.destroyMapObjects();
    this.hyde.dispose(); this.egg.dispose(); this.thing.dispose(); this.thingHint.dispose();
    this.particles.dispose(); this.rings.dispose(); this.glows.dispose(); this.bolts.dispose(); this.beams.dispose();
    this.streaks.dispose(); this.ghosts.dispose(); this.coins.dispose(); this.overlay.dispose();
    this.sky.geometry.dispose(); (this.sky.material as THREE.Material).dispose();
    this.water.geometry.dispose(); this.waterMat.dispose();
    this.shield.geometry.dispose(); (this.shield.material as THREE.Material).dispose();
    this.eggShield.geometry.dispose(); (this.eggShield.material as THREE.Material).dispose();
    this.blobs.geometry.dispose(); (this.blobs.material as THREE.Material).dispose(); this.blobTex?.dispose();
    for (const s of [this.alertQ, this.alertX]) { s.material.map?.dispose(); s.material.dispose(); }
    this.glowTex?.dispose();
    this.lantern.dispose();
    this.renderer.dispose();
    this.canvas.remove();
  }

  // ------------------------------------------------------------------------------------------------------ frame
  private update(run: RenderableMysteryRun, events: StampedEvent[], dt: number): void {
    this.lastRun = run;
    this.clock += dt;
    if (run.map !== this.map && run.map.id !== this.map.id) {
      this.map = run.map;
      this.destroyMapObjects();
      this.buildMapObjects();
    }
    const eff = run.effects ? run.effects() : NO_EFFECTS;
    this.hydeVis = run.hydeVisual ? run.hydeVisual() : eff.hydePetrified ? 'petrify' : null;
    for (const e of events) this.onEvent(e, run);
    this.updatePlayer(run, dt);
    this.updateWorld(run, eff, dt);
    this.updateHyde(run, eff, dt);
    this.updateThing(run, dt);
    this.updateItems(run, eff, dt);
    this.updateCamera(run, dt);
    this.updateVfx(run, eff, dt);
    this.updateOverlay(run, eff, dt);
    this.particles.setPixelScale(this.canvas.height / (2 * Math.tan((this.camera.fov * Math.PI) / 360)));
    this.particles.update(dt);
  }

  private draw(run: RenderableMysteryRun): void {
    void run;
    this.sky.position.copy(this.camera.position);
    this.water.position.x = this.camera.position.x;
    this.water.position.z = this.camera.position.z;
    this.renderer.render(this.scene, this.camera);
  }

  // ------------------------------------------------------------------------------------------------------ events
  private onEvent(e: StampedEvent, run: RenderableMysteryRun): void {
    const low = this.options.lowGraphics;
    const calm = this.options.reducedMotion;
    const p = run.player;
    switch (e.type) {
      case 'noise': {
        if (e.loudness < 0.04) break;
        const col = C(NOISE_COLOR[e.source] ?? '#cdd8ff');
        this.noise.push({ x: e.x, z: e.z, r: Math.max(0.8, e.radiusM), loud: e.loudness, age: 0, life: 0.85 + 0.6 * e.loudness, color: col, footstep: e.source === 'footstep' });
        if (this.noise.length > 26) this.noise.shift();
        if (e.source === 'egg_drop') this.burst(e.x, 0.3, e.z, low ? 8 : 18, '#ffe9a0', 2.2, 0.8);
        break;
      }
      case 'hyde_mode':
        if (e.to === 'CHASE' && !calm) this.shake = Math.max(this.shake, 0.35);
        if (e.to === 'CHASE') this.companion.flash(0.6);
        if (e.to === 'CHASE') this.setFlash(0.95, 0.9, 1, 0.12);
        this.alertT = 1.4;
        break;
      case 'hyde_sighted':
        this.setFlash(0.9, 0.85, 1, 0.1);
        this.alertT = 1.6;
        break;
      case 'catch':
        this.companion.flash(1);
        this.setFlash(0.92, 0.9, 1, e.blocked ? 0.35 : 0.5);
        if (!calm) this.shake = Math.max(this.shake, e.blocked ? 0.35 : 0.9);
        this.burst(p.x, 1.0, p.z, low ? 14 : 36, e.blocked ? '#9fc8ff' : '#e8e0ff', 4, 1.0);
        if (e.blocked) this.pulses.push({ t: 0, life: 0.7, x: p.x, z: p.z, r: 3.2, color: C('#9fc8ff') });
        break;
      case 'clue_search_start':
        break;
      case 'clue_found': {
        const c = run.map.clues.find((q) => q.clueId === e.clueId);
        if (c) {
          this.burst(c.x, 0.7, c.z, low ? 16 : 40, '#ffe9a0', 3.5, 1.1);
          this.pulses.push({ t: 0, life: 1.0, x: c.x, z: c.z, r: 3.2, color: C('#ffe9a0') });
        }
        this.setFlash(1, 0.9, 0.6, 0.14);
        break;
      }
      case 'egg_pickup':
        this.burst(run.egg.x, 0.7, run.egg.z, low ? 10 : 26, eggHex(run.egg.tier), 2.8, 1.0);
        this.pulses.push({ t: 0, life: 0.9, x: run.egg.x, z: run.egg.z, r: 2.6, color: C(eggHex(run.egg.tier)) });
        break;
      case 'egg_drop':
        this.eggBounce = 1;
        break;
      case 'egg_damage':
        this.burst(run.egg.x, 0.6, run.egg.z, low ? 6 : 14, '#d8d0ff', 2.4, 0.7);
        break;
      case 'egg_delivered':
        this.eggDeliverT = 0;
        this.setFlash(...(new THREE.Color(eggHex(e.tier)).toArray() as [number, number, number]), 0.38);
        break;
      case 'ability_used':
        if (e.success) this.onAbility(e.kinds, run);
        break;
      case 'hint_requested':
        this.startHint(run);
        break;
      case 'finish':
        this.setFlash(1, 0.9, 0.6, 0.25);
        break;
      default:
        break;
    }
  }

  private onAbility(kinds: string[], run: RenderableMysteryRun): void {
    const low = this.options.lowGraphics;
    const p = run.player;
    const h = run.hyde;
    const eff = run.effects();
    this.setFlash(0.8, 0.85, 1, 0.1);
    this.pulses.push({ t: 0, life: 0.8, x: p.x, z: p.z, r: 3.0, color: C('#b79cff') });
    const f = fwdOf(p.yaw);
    for (const k of kinds) {
      switch (k) {
        case 'dash': {
          for (let i = 0; i < (low ? 14 : 38); i++) {
            const t = Math.random() * 5;
            this.particles.emit({ x: p.x - f.x * t + (Math.random() - 0.5) * 0.8, y: 0.15, z: p.z - f.z * t + (Math.random() - 0.5) * 0.8, vx: -f.x * 2 + (Math.random() - 0.5) * 2, vy: 2.5 + Math.random() * 3.5, vz: -f.z * 2 + (Math.random() - 0.5) * 2, life: 0.8, size: 0.4, grow: 1.6, color: Math.random() < 0.7 ? '#bfe3ff' : '#6fb8ff', alpha: 0.9, gravity: -9 });
          }
          this.pulses.push({ t: 0, life: 0.6, x: p.x, z: p.z, r: 4, color: C('#7fc8ff') });
          break;
        }
        case 'slow': {
          const toH = Math.hypot(h.x - p.x, h.z - p.z) < 16 ? yawOf(h.x - p.x, h.z - p.z) : p.yaw;
          const d = fwdOf(toH);
          for (let i = 0; i < (low ? 24 : 70); i++) {
            const spread = (Math.random() - 0.5) * 0.9;
            const a = toH + spread;
            const dd = fwdOf(a);
            const sp = 5 + Math.random() * 7;
            this.particles.emit({ x: p.x + d.x * 0.6, y: 1.0 + (Math.random() - 0.5) * 0.7, z: p.z + d.z * 0.6, vx: dd.x * sp, vy: (Math.random() - 0.5) * 1.2, vz: dd.z * sp, life: 0.9, size: 0.34, grow: 1.5, color: Math.random() < 0.6 ? '#dff4ff' : '#8fd8ff', alpha: 0.85, drag: 1.1 });
          }
          break;
        }
        case 'stun': {
          this.boltFx.push({ t: 0, life: 0.45, from: 'player', to: 'hyde', color: eff.hydePetrified ? C('#bfffd0') : C('#c8e8ff') });
          if (eff.hydePetrified) this.gazeT = 0.9;
          for (let i = 0; i < (low ? 12 : 30); i++) {
            this.particles.emit({ x: h.x + (Math.random() - 0.5) * 1.4, y: 0.5 + Math.random() * 2.4, z: h.z + (Math.random() - 0.5) * 1.4, vx: (Math.random() - 0.5) * 3, vy: Math.random() * 3, vz: (Math.random() - 0.5) * 3, life: 0.7, size: 0.3, grow: 0.8, color: eff.hydePetrified ? '#c8d4c0' : '#bfe8ff', alpha: 0.9, gravity: eff.hydePetrified ? -4 : 0 });
          }
          break;
        }
        case 'lure': {
          const lp = eff.lurePoint ?? { x: p.x + f.x * 6, z: p.z + f.z * 6 };
          this.pulses.push({ t: 0, life: 1.2, x: lp.x, z: lp.z, r: 5, color: C('#6fe0ff') });
          this.burst(lp.x, 0.8, lp.z, low ? 8 : 22, '#ffe08a', 3, 1.0);
          break;
        }
        case 'power_switch': {
          const s = this.map.powerSwitch;
          if (s) {
            this.boltFx.push({ t: 0, life: 0.6, from: 'switch', to: 'gate', color: C('#fff2a0') });
            this.burst(s.x, 1.6, s.z, low ? 10 : 30, '#fff2a0', 4, 0.9);
          }
          break;
        }
        case 'egg_shield':
          this.burst(run.egg.x, 1.0, run.egg.z, low ? 8 : 24, '#ffd24a', 2.4, 1.0);
          break;
        case 'reveal_clues':
        case 'reveal_hazards':
        case 'premonition':
        case 'speed_boost':
        case 'distract':
        case 'block_grab':
        default:
          break;
      }
    }
  }

  private setFlash(r: number, g: number, b: number, a: number): void {
    this.flashRGB = [r, g, b];
    this.flash = Math.max(this.flash, this.options.reducedMotion ? Math.min(a, 0.1) : a);
  }

  private burst(x: number, y: number, z: number, n: number, color: string, speed: number, life: number): void {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = speed * (0.4 + Math.random() * 0.8);
      this.particles.emit({ x, y, z, vx: Math.cos(a) * s, vy: 0.8 + Math.random() * speed * 0.7, vz: Math.sin(a) * s, life, size: 0.34, grow: 1.4, color, alpha: 0.95, drag: 1.4, gravity: -2 });
    }
  }

  // ------------------------------------------------------------------------------------------------------ player
  private updatePlayer(run: RenderableMysteryRun, dt: number): void {
    const p = run.player;
    if (!this.prevInit) { this.prevX = p.x; this.prevZ = p.z; this.bodyYaw = p.yaw; this.prevInit = true; this.velX = 0; this.velZ = 0; }
    const jump = Math.hypot(p.x - this.prevX, p.z - this.prevZ);
    if (jump > 4) { // safe-release teleport: snap everything
      this.prevX = p.x; this.prevZ = p.z; this.cameraReady = false;
    }
    if (dt > 1e-4) {
      const vx = (p.x - this.prevX) / dt, vz = (p.z - this.prevZ) / dt;
      this.velX = damp(this.velX, vx, 18, dt);
      this.velZ = damp(this.velZ, vz, 18, dt);
    }
    this.prevX = p.x; this.prevZ = p.z;
    const vs = Math.hypot(this.velX, this.velZ);
    if (vs > 0.35 && !p.hidden) {
      this.bodyYaw = angleLerp(this.bodyYaw, yawOf(this.velX, this.velZ), 1 - Math.exp(-13 * dt));
      this.idleT = 0;
    } else {
      this.idleT += dt;
      this.bodyYaw = angleLerp(this.bodyYaw, p.yaw, 1 - Math.exp(-(this.idleT > 0.4 || p.hidden ? 5 : 1.2) * dt));
    }
    const stance: Stance = p.crouched ? 'crouch' : p.stance === 'sprint' ? 'sprint' : p.stance === 'idle' ? 'idle' : 'walk';
    this.lastStance = stance;
    const eff = run.effects();
    this.avatar.root.position.set(p.x, 0, p.z);
    this.avatar.root.rotation.y = this.bodyYaw;
    this.avatar.update({
      dt, clock: this.clock, speed: Math.max(p.speed, vs * 0.6), stance, carrying: run.egg.state === 'carried',
      boost: eff.speedBoost, dir: 1, hidden: p.hidden,
      lookYaw: clamp(wrapAngle(p.yaw - this.bodyYaw), -0.9, 0.9),
    });
    // invulnerability blink (reduced motion: steady tint instead of flashing)
    const inv = run.t < p.invulnerableUntil;
    this.avatar.root.visible = !this.showcase && !(inv && !this.options.reducedMotion && Math.floor(this.clock * 10) % 2 === 0);
    this.companion.root.visible = !this.showcase;
    // companion
    this.companion.update(dt, this.clock, p.x, p.z, this.bodyYaw, p.speed, run.hyde.mode === 'CHASE' ? 1 : 0, this.options.reducedMotion);
    // lantern follows the player
    this.lantern.position.set(p.x, 2.2, p.z);
    const rh = eff.revealHazards;
    this.lantern.intensity = this.options.lowGraphics ? 0 : (rh ? 28 : 8) * (p.hidden ? 0.55 : 1);
    this.lantern.color.set(rh ? 0x9ab8ff : 0xffc880);
    this.lantern.distance = rh ? 20 : 14;
  }

  // ------------------------------------------------------------------------------------------------------ world
  private updateWorld(run: RenderableMysteryRun, eff: ReturnType<RenderableMysteryRun['effects']>, dt: number): void {
    const p = run.player;
    const gateId = this.map.powerSwitch?.gateWallId;
    const gateOpen = gateId ? run.isWallOpen(gateId) : false;
    const carrying = run.egg.state === 'carried';
    const dToTower = Math.hypot(p.x - this.map.tower.x, p.z - this.map.tower.z);
    const near = dToTower < this.map.tower.radius + 3 ? 1 : 0;
    this.depositGlow = damp(this.depositGlow, (carrying ? 0.7 : 0.15) + near * 0.3 + (run.egg.state === 'delivered' ? 0.5 : 0), 4, dt);
    this.world.update({ dt, clock: this.clock, hiddenK: this.hideK, playerRoom: p.roomId, playerX: p.x, playerZ: p.z, gateOpen, switchPowered: eff.switchPowered, depositGlow: clamp(this.depositGlow, 0, 1.2), reduced: this.options.reducedMotion });
    // fog thickens inside fog rooms
    let target = BASE_FOG;
    const room = this.map.rooms.find((r) => r.id === p.roomId);
    if (room?.fog) target = CRYPT_FOG;
    this.fogNow = damp(this.fogNow, target, 1.6, dt);
    this.fog.density = this.fogNow;
    this.fx.uFogDensity.value = this.fogNow;
    this.fx.uTime.value = this.clock;
    this.fx.uClear.value.set(p.x, p.z, 4, 0);
    const wm = this.waterMat as THREE.ShaderMaterial;
    if (wm.uniforms?.uTime) { wm.uniforms.uTime.value = this.clock; wm.uniforms.uAmp.value = 0.12; wm.uniforms.uAnimate.value = this.options.reducedMotion ? 0 : 1; }
  }

  // ------------------------------------------------------------------------------------------------------ Hyde
  private updateHyde(run: RenderableMysteryRun, eff: ReturnType<RenderableMysteryRun['effects']>, dt: number): void {
    const h = run.hyde;
    this.hyde.root.position.set(h.x, 0, h.z);
    this.hyde.root.visible = !this.showcase;
    let lookYaw: number | null = null;
    const target = eff.lurePoint ?? h.lastKnown ?? h.target;
    if (target) lookYaw = wrapAngle(yawOf(target.x - h.x, target.z - h.z) - h.yaw);
    this.hyde.update({
      dt, clock: this.clock, mode: h.mode, speed: h.speed, grabbing: h.grabbing, stunned: eff.hydeStunned, petrified: eff.hydePetrified && this.hydeVis !== 'pin',
      pinned: this.hydeVis === 'pin', slowed: eff.hydeSlowed, distracted: eff.hydeDistracted, suspicion: h.suspicion, lookYaw, bodyYaw: h.yaw, fade: this.hydeFade, reduced: this.options.reducedMotion,
    });
    // mode change bookkeeping (alert marker)
    if (h.mode !== this.hydeModePrev) { this.alertT = 1.6; this.hydeModePrev = h.mode; }
    this.alertT = Math.max(0, this.alertT - dt);
    const hw = this.hyde.headWorld;
    const showX = h.mode === 'CHASE' || h.grabbing;
    const showQ = !showX && (h.mode === 'INVESTIGATE_SOUND' || h.mode === 'SEARCH' || (h.mode === 'PATROL' && h.suspicion > 0.4));
    const bob = this.options.reducedMotion ? 0 : Math.sin(this.clock * 6) * 0.06;
    const pulse = 0.85 + 0.15 * Math.sin(this.clock * 8);
    this.alertX.visible = showX;
    this.alertQ.visible = showQ;
    if (showX) { this.alertX.position.set(hw.x, hw.y + 1.35 + bob, hw.z); this.alertX.scale.setScalar(1.15 * pulse); (this.alertX.material as THREE.SpriteMaterial).opacity = 1; }
    if (showQ) { this.alertQ.position.set(hw.x, hw.y + 1.35 + bob, hw.z); this.alertQ.scale.setScalar(0.95); (this.alertQ.material as THREE.SpriteMaterial).opacity = clamp(0.55 + h.suspicion * 0.6, 0, 1); }
  }

  // ------------------------------------------------------------------------------------------------------ Thing
  private objectiveTarget(run: RenderableMysteryRun, from: Vec2): Vec2 {
    const obj = run.objective ? run.objective() : undefined;
    if (obj === 'find_egg' || obj === 'retrieve_egg') return { x: run.egg.x, z: run.egg.z };
    if (obj === 'deliver_egg' || obj === 'accuse') return { x: this.map.tower.x, z: this.map.tower.z };
    let best: Vec2 | null = null, bd = Infinity;
    for (const c of this.map.clues) {
      if (run.cluesFound.includes(c.clueId)) continue;
      const d = Math.hypot(c.x - from.x, c.z - from.z);
      if (d < bd) { bd = d; best = { x: c.x, z: c.z }; }
    }
    return best ?? { x: this.map.tower.x, z: this.map.tower.z };
  }

  private startHint(run: RenderableMysteryRun): void {
    this.hintT = 4.8;
    this.hintTarget = this.objectiveTarget(run, run.player);
    this.hintScale = 0;
    this.burst(run.player.x, 1.2, run.player.z, this.options.lowGraphics ? 6 : 16, '#e6d9ff', 2, 0.8);
  }

  private updateThing(run: RenderableMysteryRun, dt: number): void {
    const th = this.world.dress.thing;
    const p = run.player;
    const d = Math.hypot(p.x - th.x, p.z - th.z);
    this.thing.root.position.set(th.x, th.y, th.z);
    // pier Thing: wave when the visitor arrives, point toward the first goal while the tutorial runs, otherwise stand
    this.thingWave = d < 8 ? this.thingWave + dt : 0;
    let pose: ThingPose = 'stand';
    let face = yawOf(p.x - th.x, p.z - th.z);
    if (this.thingOverride) pose = this.thingOverride;
    else if (run.status === 'tutorial' || (run.t < 25 && d < 10)) {
      if (d < 9) {
        if (this.thingWave < 3.2) pose = 'wave';
        else { pose = 'point'; const t = this.objectiveTarget(run, th); face = yawOf(t.x - th.x, t.z - th.z); }
      }
    } else if (d < 4.5) pose = 'thumbsUp';
    else if (d > 12) pose = 'tap';
    this.thing.setPose(pose);
    this.thing.root.rotation.y = angleLerp(this.thing.root.rotation.y, face, 1 - Math.exp(-6 * dt));
    this.thing.update(dt, this.clock);
    // hint Thing next to the player
    if (this.hintT > 0) {
      this.hintT -= dt;
      this.hintScale = damp(this.hintScale, this.hintT > 0.5 ? 1.9 : 0, 7, dt);
      const f = fwdOf(p.yaw);
      const r = { x: -f.z, z: f.x };
      const hx = p.x + f.x * 1.3 - r.x * 1.1, hz = p.z + f.z * 1.3 - r.z * 1.1;
      this.thingHint.root.position.set(hx, 0, hz);
      const t = this.hintTarget ?? this.objectiveTarget(run, p);
      this.thingHint.root.rotation.y = angleLerp(this.thingHint.root.rotation.y, yawOf(t.x - hx, t.z - hz), 1 - Math.exp(-10 * dt));
      this.thingHint.setPose('point');
      this.thingHint.root.scale.setScalar(Math.max(0.001, this.hintScale));
      this.thingHint.update(dt, this.clock);
      this.thingHint.root.visible = true;
    } else {
      this.hintScale = 0;
      this.thingHint.root.visible = false;
    }
  }

  // ------------------------------------------------------------------------------------------------------ items
  private updateItems(run: RenderableMysteryRun, eff: ReturnType<RenderableMysteryRun['effects']>, dt: number): void {
    const calm = this.options.reducedMotion;
    for (const c of this.map.clues) {
      const prop = this.clues.get(c.clueId);
      if (!prop) continue;
      const got = run.cluesFound.includes(c.clueId);
      prop.root.visible = !got;
      if (got) continue;
      const bob = calm ? 0 : Math.sin(this.clock * 1.8 + c.x) * 0.05;
      prop.root.position.set(c.x, 0.42 + bob, c.z);
      prop.inner.rotation.y = calm ? 0.5 : this.clock * 0.7 + c.z;
    }
    // egg
    const e = run.egg;
    this.egg.setTier(e.tier);
    if (e.state !== this.eggPrevState) {
      if (e.state === 'dropped') this.eggBounce = 1;
      this.eggPrevState = e.state;
    }
    this.eggBounce = Math.max(0, this.eggBounce - dt * 1.4);
    if (this.eggDeliverT >= 0) this.eggDeliverT += dt;
    const egg = this.egg;
    const carried = e.state === 'carried';
    if (carried) {
      this.avatar.eggSlot.getWorldPosition(this.tmp);
      egg.root.position.set(this.tmp.x, this.tmp.y - 0.27, this.tmp.z);
      egg.root.rotation.set(0, this.bodyYaw, Math.sin(this.clock * 2.4) * 0.05 * (calm ? 0 : 1));
    } else if (e.state === 'delivered') {
      const rise = 1.5 + (calm ? 0 : Math.sin(this.clock * 1.5) * 0.12);
      egg.root.position.set(this.map.tower.x, rise, this.map.tower.z);
      egg.root.rotation.set(0, calm ? 0 : this.clock * 0.9, 0);
    } else {
      const bounce = Math.abs(Math.sin(this.eggBounce * 9)) * this.eggBounce * 0.45;
      egg.root.position.set(e.x, 0.05 + bounce + (e.state === 'resting' && !calm ? Math.sin(this.clock * 1.4) * 0.03 : 0), e.z);
      egg.root.rotation.set(0, calm ? 0 : this.clock * 0.4, e.state === 'dropped' ? 0.32 : 0);
    }
    egg.cracks.visible = e.security < 70;
    const secDim = clamp(e.security / 100, 0.35, 1);
    egg.mat.emissiveIntensity = 0.6 + 0.6 * secDim * (eff.revealEgg ? 1.6 : 1);
  }

  // ------------------------------------------------------------------------------------------------------ camera
  private blockedAt(x: number, y: number, z: number, run: RenderableMysteryRun): boolean {
    if (y < 0.35) return true;
    for (const w of this.map.walls) {
      if (run.isWallOpen(w.id)) continue;
      if (y < w.height + 0.1 && distPointSeg(x, z, w.a.x, w.a.z, w.b.x, w.b.z) < w.thickness / 2 + 0.28) return true;
    }
    for (const c of this.map.cover) {
      if (c.height !== 'high' && y > 1.2) continue;
      const top = c.height === 'high' ? (c.kind === 'tree' ? 5.4 : 2.5) : 1.05;
      if (y < top && Math.hypot(x - c.x, z - c.z) < c.radius + 0.28) return true;
    }
    return false;
  }

  private updateCamera(run: RenderableMysteryRun, dt: number): void {
    const p = run.player;
    const h = run.hyde;
    const calm = this.options.reducedMotion;
    if (!this.cameraReady) { this.camYaw = p.yaw; this.camPitch = p.pitch; this.pivotY = p.crouched ? 1.1 : 1.68; this.cameraReady = true; this.camDist = 3.5; }
    this.camYaw = angleLerp(this.camYaw, p.yaw, 1 - Math.exp(-32 * dt));
    this.camPitch = damp(this.camPitch, clamp(p.pitch, -0.6, 0.95), 28, dt);
    this.pivotY = damp(this.pivotY, p.crouched ? 1.1 : 1.68, 9, dt);
    const sinY = Math.sin(this.camYaw), cosY = Math.cos(this.camYaw);
    const cp = Math.cos(this.camPitch), sp = Math.sin(this.camPitch);
    const look = this.tmp.set(-sinY * cp, sp, -cosY * cp);
    let shoulder = p.crouched ? 0.45 : 0.6;
    {
      // never put the shoulder pivot inside a wall / prop: shorten the offset if solid geometry is within reach
      const hit = this.world.occSolid.firstHit(p.x, this.pivotY, p.z, cosY, 0, -sinY, shoulder + 0.3);
      if (hit < shoulder + 0.3) shoulder = Math.max(0, hit - 0.3);
    }
    const walking = p.speed > 0.4 && !calm;
    this.camBob = walking ? this.camBob + dt * (p.stance === 'sprint' ? 11 : 7.5) : this.camBob;
    const bobY = walking ? Math.sin(this.camBob) * 0.014 : 0;
    const pivotX = p.x + cosY * shoulder, pivotZ = p.z - sinY * shoulder, pivotY = this.pivotY + bobY;
    // desired distance (wider when sprinting or chased), shortened by the nearest obstruction
    const chased = h.mode === 'CHASE' && Math.hypot(h.x - p.x, h.z - p.z) < 14;
    let want = (p.crouched ? 3.0 : 3.7) + (p.stance === 'sprint' && !calm ? 0.45 : 0) + (chased ? 0.5 : 0);
    let free = want;
    const bx = -look.x, by = -look.y, bz = -look.z;
    for (let s = 0.4; s <= want + 0.001; s += 0.2) {
      if (this.blockedAt(pivotX + bx * s, pivotY + by * s, pivotZ + bz * s, run)) { free = Math.max(0.9, s - 0.45); break; }
    }
    // real-geometry occlusion: five rays (centre + lens-sized offsets) through everything the scene draws as solid
    {
      const rx = cosY, rz = -sinY;
      const offs: [number, number, number][] = [[0, 0, 0], [rx * 0.26, 0, rz * 0.26], [-rx * 0.26, 0, -rz * 0.26], [0, 0.22, 0], [0, -0.22, 0]];
      for (const [ox, oy, oz] of offs) {
        let t = this.world.occSolid.firstHit(pivotX + ox, pivotY + oy, pivotZ + oz, bx, by, bz, want + 0.4, 0.02);
        if (!p.hidden) t = Math.min(t, this.world.occHide.firstHit(pivotX + ox, pivotY + oy, pivotZ + oz, bx, by, bz, want + 0.4, 0.02));
        if (t < free + 0.3) free = Math.min(free, Math.max(0.9, t - 0.3));
      }
    }
    // never put the lens inside the Hyde: slide toward the player until clear
    let dist = Math.min(want, free);
    this.hydeFade = 0;
    const hy = HYDE_CHEST_Y;
    for (let it = 0; it < 6; it++) {
      const cx = pivotX + bx * dist, cy = pivotY + by * dist, cz = pivotZ + bz * dist;
      const dh = Math.hypot(cx - h.x, cy - hy, cz - h.z);
      if (dh >= 2.3 || dist <= 1.9) break;
      dist = Math.max(1.9, dist - (2.3 - dh) * 0.9);
    }
    {
      const cx = pivotX + bx * dist, cy = pivotY + by * dist, cz = pivotZ + bz * dist;
      const dh = Math.hypot(cx - h.x, cy - hy, cz - h.z);
      this.hydeFade = smoothstep(3.4, 2.0, dh) * 0.75;
    }
    // last line of defence: the straight line from the final lens position to the player's head must be clear of solid geometry
    for (let it = 0; it < 4; it++) {
      const cx = pivotX + bx * dist, cy = Math.max(0.45, pivotY + by * dist), cz = pivotZ + bz * dist;
      const hx = p.x - cx, hy = pivotY - 0.1 - cy, hz = p.z - cz;
      const hl = Math.hypot(hx, hy, hz) || 1;
      let t = this.world.occSolid.firstHit(cx, cy, cz, hx / hl, hy / hl, hz / hl, hl - 0.25, 0.0);
      if (!p.hidden) t = Math.min(t, this.world.occHide.firstHit(cx, cy, cz, hx / hl, hy / hl, hz / hl, hl - 0.25, 0.0));
      if (t >= hl - 0.25 || dist <= 0.9) break;
      dist = Math.max(0.9, dist * 0.78);
    }
    want = dist;
    this.camDist = want < this.camDist ? damp(this.camDist, want, 26, dt) : damp(this.camDist, want, 3.2, dt);
    this.camPos.set(pivotX + bx * this.camDist, Math.max(0.45, pivotY + by * this.camDist), pivotZ + bz * this.camDist);
    // shake (catch / chase start). Reduced motion: none at all.
    this.shake = Math.max(0, this.shake - dt * 1.8);
    if (!calm && this.shake > 0.001) {
      const s = this.shake * this.shake * 0.22;
      this.camPos.x += (Math.random() - 0.5) * s; this.camPos.y += (Math.random() - 0.5) * s; this.camPos.z += (Math.random() - 0.5) * s;
    }
    // chase assist: when the Hyde is right behind the player (between lens and runner) lift and slide the lens to the clear side and
    // aim ahead of the player, so he is seen over the runner's shoulder instead of the lens sitting at his back
    const hdx = h.x - pivotX, hdz = h.z - pivotZ;
    const along = hdx * sinY + hdz * cosY;
    const lat = hdx * cosY - hdz * sinY;
    const near = (h.mode === 'CHASE' || h.grabbing) && along > -1.5 && along < this.camDist + 3.5 && Math.abs(lat) < 3.4 && Math.hypot(hdx, hdz) < 16;
    this.assistK = damp(this.assistK, near ? 1 : 0, near ? 6 : 3, dt);
    if (Math.abs(lat) > 0.35) this.assistSide = lat > 0 ? -1 : 1;
    const ak = this.assistK;
    if (ak > 0.01) {
      let side = this.assistSide;
      const shift = (): void => {
        this.camPos.set(pivotX + bx * this.camDist + cosY * side * 1.6 * ak, Math.max(0.45, pivotY + by * this.camDist) + 1.4 * ak, pivotZ + bz * this.camDist - sinY * side * 1.6 * ak);
      };
      shift();
      if (this.blockedAt(this.camPos.x, this.camPos.y, this.camPos.z, run)) { side = -side; shift(); if (this.blockedAt(this.camPos.x, this.camPos.y, this.camPos.z, run)) { side = 0; shift(); } }
    }
    // hidden inside foliage / a wardrobe: lift the lens over the cover and look down at the player
    const hk = this.hideK;
    if (hk > 0.01) this.camPos.y += 1.6 * hk;
    const aim = Math.max(ak, hk);
    this.camera.position.copy(this.camPos);
    this.camera.lookAt(
      lerp(this.camPos.x + look.x, pivotX + look.x * 4.5, aim),
      lerp(this.camPos.y + look.y, pivotY - 0.5 - 0.5 * hk + look.y * 4.5, aim),
      lerp(this.camPos.z + look.z, pivotZ + look.z * 4.5, aim),
    );
    // FOV: sprint / chase kick (not in reduced motion)
    const fovT = this.baseVFov + (calm ? 0 : (p.stance === 'sprint' ? 3 : 0) + (chased ? 4 : 0));
    this.fovNow = damp(this.fovNow, fovT, 4, dt);
    if (Math.abs(this.camera.fov - this.fovNow) > 0.01) { this.camera.fov = this.fovNow; this.camera.updateProjectionMatrix(); }
    if (this.showcase) this.showcaseCamera(dt);
    if (this.debugCam) {
      this.camera.position.copy(this.debugCam.pos);
      this.camera.fov = this.debugCam.fov;
      this.camera.lookAt(this.debugCam.look);
      this.camera.updateProjectionMatrix();
      if (this.debugCam.fog !== undefined) { this.fog.density = this.debugCam.fog; this.fx.uFogDensity.value = this.debugCam.fog; }
    }
    this.camera.updateMatrixWorld(true);
    this.lastDebugCam = { yaw: this.camYaw, pitch: this.camPitch, dist: this.camDist };
    // the companion artwork fades when it would sit between the lens and the player (or very close to the lens)
    {
      const c = this.companion.position;
      const cx = this.camPos.x, cy = this.camPos.y, cz = this.camPos.z;
      const tx = p.x - cx, ty = pivotY - 0.2 - cy, tz = p.z - cz;
      const tl2 = tx * tx + ty * ty + tz * tz || 1;
      const u = clamp(((c.x - cx) * tx + (c.y - cy) * ty + (c.z - cz) * tz) / tl2, 0, 1);
      const lx = cx + tx * u - c.x, ly = cy + ty * u - c.y, lz = cz + tz * u - c.z;
      const off = Math.hypot(lx, ly, lz);
      const lens = Math.hypot(c.x - cx, c.y - cy, c.z - cz);
      const blocking = (1 - smoothstep(0.55, 1.15, off)) * (u < 0.98 ? 1 : 0);
      this.companion.setFade(Math.max(blocking, 1 - smoothstep(1.0, 2.2, lens)));
    }
    // Hyde projection (for the debug state, the off-screen warning glow and HUD)
    this.ndc.set(h.x, hy, h.z).project(this.camera);
    this.hydeOnScreen = this.ndc.z < 1 && this.ndc.z > -1 && Math.abs(this.ndc.x) < 0.98 && Math.abs(this.ndc.y) < 0.98;
    const rel = this.tmp2.set(h.x, hy, h.z).applyMatrix4(this.camera.matrixWorldInverse);
    const l = Math.hypot(rel.x, rel.y) || 1;
    this.hydeEdge = { x: rel.x / l, y: rel.y / l, s: 0 };
    void this.lastDebugCam;
  }

  private showcaseCamera(dt: number): void {
    const th = this.world.dress.thing;
    const a = this.options.reducedMotion ? 0.12 : Math.sin(this.clock * 0.12) * 0.32 + 0.1;
    // from the dock looking north: Thing on its plinth in front, the island and tower dim behind it
    const c = this.map.playerStart;
    const f = fwdOf(c.yaw);
    const r = { x: -f.z, z: f.x };
    const back = 7.2, side = Math.sin(a) * 4.0;
    this.camera.position.set(th.x - f.x * back + r.x * side + r.x * 0.8, th.y + 0.6, th.z - f.z * back + r.z * side + r.z * 0.8);
    this.camera.lookAt(th.x + f.x * 24 + r.x * 3, th.y + 7.5, th.z + f.z * 24 + r.z * 3);
    this.camera.fov = damp(this.camera.fov, 56, 4, dt);
    this.camera.updateProjectionMatrix();
    this.fogNow = damp(this.fogNow, 0.0072, 1.5, dt);
    this.fog.density = this.fogNow;
    this.fx.uFogDensity.value = this.fogNow;
  }

  // ------------------------------------------------------------------------------------------------------ overlay
  private updateOverlay(run: RenderableMysteryRun, eff: ReturnType<RenderableMysteryRun['effects']>, dt: number): void {
    const h = run.hyde;
    const p = run.player;
    const dist = Math.hypot(h.x - p.x, h.z - p.z);
    const prox = clamp(1 - dist / 30, 0, 1);
    const base: Record<HydeMode, number> = { PATROL: 0, INVESTIGATE_SOUND: 0.22, SEARCH: 0.32, CHASE: 0.85, COOLDOWN: 0.18 };
    let tgt = base[h.mode] * (0.45 + 0.55 * prox) + h.suspicion * 0.22 * prox;
    if (eff.hydeStunned || eff.hydePetrified) tgt *= 0.3;
    this.threat = damp(this.threat, clamp(tgt, 0, 1), 4, dt);
    this.hideK = damp(this.hideK, p.hidden ? 1 : 0, 5, dt);
    this.dimK = damp(this.dimK, run.status === 'dnf' ? 0.55 : 0, 2, dt);
    this.flash = Math.max(0, this.flash - dt * 2.2);
    const u = this.overlay.u;
    u.uThreat.value = this.threat;
    u.uHide.value = this.hideK;
    u.uTime.value = this.clock;
    u.uDim.value = this.dimK;
    u.uReduced.value = this.options.reducedMotion ? 1 : 0;
    u.uFlash.value.set(this.flashRGB[0], this.flashRGB[1], this.flashRGB[2], this.flash);
    // directional glow toward an off-screen Hyde when he matters
    const matters = h.mode === 'CHASE' || ((h.mode === 'SEARCH' || h.mode === 'INVESTIGATE_SOUND') && dist < 14) || h.grabbing;
    const edge = !this.hydeOnScreen && matters ? clamp(1.1 - dist / 24, 0.25, 1) : 0;
    u.uEdge.value.set(this.hydeEdge.x, this.hydeEdge.y, edge);
    this.overlay.mesh.visible = this.threat > 0.004 || this.hideK > 0.004 || this.flash > 0.004 || this.dimK > 0.004 || edge > 0.004;
  }

  // ------------------------------------------------------------------------------------------------------ VFX
  private updateVfx(run: RenderableMysteryRun, eff: ReturnType<RenderableMysteryRun['effects']>, dt: number): void {
    const p = run.player;
    const h = run.hyde;
    const e = run.egg;
    const low = this.options.lowGraphics;
    const calm = this.options.reducedMotion;
    const T = this.clock;
    const rings = this.rings, glows = this.glows, beams = this.beams;
    rings.begin(); glows.begin(); beams.begin(); this.streaks.begin(); this.ghosts.begin(); this.coins.begin(); this.bolts.begin();
    const gc = new THREE.Color();

    // ---- noise rings (size = hearing radius, brightness = loudness). Quiet sources stay small and faint.
    for (const n of this.noise) n.age += dt;
    this.noise = this.noise.filter((n) => n.age < n.life);
    for (const n of this.noise) {
      const t = n.age / n.life;
      const grow = 1 - Math.pow(1 - t, 2.2);
      const inten = Math.pow(1 - t, 1.3) * (0.2 + 0.8 * n.loud) * (n.footstep ? 0.42 : 0.8);
      rings.push(n.x, 0.1, n.z, n.r * grow, n.color, inten);
      if (n.loud > 0.6) rings.push(n.x, 0.1, n.z, n.r * grow * 0.82, n.color, inten * 0.6);
    }
    // ---- generic pulses
    for (const q of this.pulses) q.t += dt;
    this.pulses = this.pulses.filter((q) => q.t < q.life);
    for (const q of this.pulses) {
      const t = q.t / q.life;
      rings.push(q.x, 0.12, q.z, q.r * (1 - Math.pow(1 - t, 2)), q.color, (1 - t) * 0.9);
    }

    // ---- hiding spots: faint sigils, brighter as you approach, green while hidden inside
    for (const hs of this.map.hidingSpots) {
      const d = Math.hypot(p.x - hs.x, p.z - hs.z);
      const near = 1 - smoothstep(2.5, 8, d);
      const inside = p.hidden && d < hs.radius + 0.6;
      const pulse = calm ? 1 : 0.8 + 0.2 * Math.sin(T * 2.4 + hs.x);
      rings.push(hs.x, 0.1, hs.z, hs.radius * 1.15, inside ? '#8affc8' : '#b79cff', (inside ? 0.9 : 0.12 + near * 0.55) * pulse);
      if (near > 0.2 && !inside) rings.push(hs.x, 0.1, hs.z, hs.radius * 0.7, '#b79cff', near * 0.35 * pulse);
      if (near > 0.15) glows.add(hs.x, 0.9, hs.z, 1.8 + near * 0.8, gc.set('#b79cff'), near * 0.35 * pulse);
    }

    // ---- interactable highlight (clue / egg / tower / switch)
    const it = run.interactable();
    if (it) {
      let tx = p.x, tz = p.z, ok = true;
      if (it.kind === 'clue' || it.kind === 'practice') {
        // a clue placement, or the tutorial practice crate (a cover piece)
        const c = this.map.clues.find((q) => q.clueId === it.id) ?? this.map.cover.find((q) => q.id === it.id) ?? (it.kind === 'practice' ? this.map.cover.find((q) => q.kind === 'crate' && Math.hypot(q.x - p.x, q.z - p.z) < 4) : undefined);
        if (c) { tx = c.x; tz = c.z; } else ok = false;
      }
      else if (it.kind === 'egg') { tx = e.x; tz = e.z; }
      else if (it.kind === 'tower') { tx = this.map.tower.x; tz = this.map.tower.z; }
      else if (it.kind === 'switch' && this.map.powerSwitch) { tx = this.map.powerSwitch.x; tz = this.map.powerSwitch.z; }
      if (ok) {
        const pr = clamp(it.progress, 0, 1);
        const rr = it.kind === 'tower' ? Math.max(1.2, this.map.tower.radius * 0.45) : 0.9;
        rings.push(tx, 0.14, tz, rr * (1.0 - 0.35 * pr) * (calm ? 1 : 1 + Math.sin(T * 5) * 0.06), '#ffffff', 0.55 + 0.4 * pr);
        if (pr > 0 && !calm && it.kind !== 'tower') {
          const a = T * 8;
          this.particles.emit({ x: tx + Math.cos(a) * 0.7 * (1 - pr), y: 0.4 + pr * 0.8, z: tz + Math.sin(a) * 0.7 * (1 - pr), vy: 0.8, life: 0.5, size: 0.22, grow: 0.8, color: '#ffe9a0', alpha: 0.9 });
        }
      }
    }
    const inter = p.interacting;
    if (inter && inter.target === 'clue') {
      const c = this.map.clues.find((q) => q.clueId === inter.id);
      if (c) glows.add(c.x, 0.7, c.z, 2.4 + inter.progress * 2, gc.set('#ffe9a0'), 0.5 + 0.4 * inter.progress);
    }

    // ---- clues: always a small glint; revealed ones get a halo, beam, ring and a sparkle trail from the player
    const revealed = new Set<ClueId>(eff.revealedClues);
    let clueIdx = 0;
    for (const c of this.map.clues) {
      if (run.cluesFound.includes(c.clueId)) continue;
      const tw = calm ? 0.8 : 0.55 + 0.45 * Math.sin(T * 3.2 + c.x * 1.7);
      const isRev = revealed.has(c.clueId);
      glows.add(c.x, 0.55, c.z, isRev ? 2.6 : 0.9, gc.set(isRev ? '#bfe8ff' : '#ffe9a0'), isRev ? 0.9 : 0.5 * tw);
      rings.push(c.x, 0.1, c.z, 0.45, '#ffe9a0', 0.25 * tw);
      if (isRev) {
        beams.push(c.x, c.z, 0.35, 9, '#9fd8ff', 0.8 + 0.2 * Math.sin(T * 3), 0);
        rings.push(c.x, 0.12, c.z, 1.1 + 0.25 * Math.sin(T * 4), '#9fd8ff', 0.8);
        const dx = c.x - p.x, dz = c.z - p.z;
        const L = Math.hypot(dx, dz);
        const nDots = Math.min(22, Math.max(6, Math.round(L / 1.2)));
        for (let i = 0; i < nDots; i++) {
          const t = (i / nDots + T * 0.35 + clueIdx * 0.13) % 1;
          const wob = Math.sin(T * 3 + i) * 0.25;
          glows.add(p.x + dx * t - dz / (L || 1) * wob, 1.05 + Math.sin(t * Math.PI) * 0.4, p.z + dz * t + dx / (L || 1) * wob, 0.5, gc.set(i % 3 === 0 ? '#ffffff' : '#9fd8ff'), 0.75 * Math.sin(t * Math.PI));
        }
      }
      clueIdx++;
    }

    // ---- egg: glow by tier, beam when revealed or lying dropped, delivery flourish
    const eggPos = this.egg.root.position;
    const tierCol = eggHex(e.tier);
    const tierSize = e.tier === 'legendary' ? 2.3 : e.tier === 'rare' ? 1.8 : 1.4;
    if (e.state === 'carried') {
      // the egg is held in front of the body, hidden from a behind-the-shoulder lens: halo the carrier in the tier colour
      const hp = 0.8 + (calm ? 0 : Math.sin(T * 3.1) * 0.1);
      glows.add(p.x, p.crouched ? 0.8 : 1.15, p.z, 2.6 * hp, gc.set(tierCol), 0.32);
      rings.push(p.x, 0.12, p.z, 0.9, tierCol, 0.35 * hp);
    }
    if (e.state !== 'delivered' || this.eggDeliverT < 0) {
      const pulse = calm ? 1 : 0.85 + 0.15 * Math.sin(T * 3.1);
      glows.add(eggPos.x, eggPos.y + 0.3, eggPos.z, tierSize * pulse * (eff.revealEgg ? 1.8 : 1), gc.set(tierCol), (e.state === 'carried' ? 0.55 : 0.8) * clamp(e.security / 100, 0.4, 1));
    } else {
      glows.add(eggPos.x, eggPos.y + 0.3, eggPos.z, tierSize * 2.2, gc.set(tierCol), 0.9);
    }
    if (e.state === 'resting' || e.state === 'dropped') {
      beams.push(eggPos.x, eggPos.z, 0.2, e.state === 'dropped' ? 12 : 8, tierCol, eff.revealEgg ? 0.6 : e.state === 'dropped' ? 0.3 : 0.04);
      if (eff.revealEgg) rings.push(eggPos.x, 0.12, eggPos.z, 1.3 + 0.2 * Math.sin(T * 4), tierCol, 0.8);
    }
    if (e.state === 'delivered') {
      const t = this.eggDeliverT;
      beams.push(this.map.tower.x, this.map.tower.z, 0.6, 26, tierCol, 0.1 + 0.28 * Math.max(0, 1 - Math.max(0, t) / 3.2) + 0.03 * Math.sin(T * 2));
      if (t >= 0 && t < 2.6) {
        const a = t / 2.6;
        rings.push(this.map.tower.x, 0.14, this.map.tower.z, 1 + a * 9, tierCol, (1 - a) * 0.95);
        rings.push(this.map.tower.x, 0.14, this.map.tower.z, 1 + Math.max(0, a - 0.2) * 7, '#ffffff', Math.max(0, 0.7 - a));
        if (!calm && Math.random() < 0.7) {
          const an = Math.random() * Math.PI * 2, rr = Math.random() * this.map.tower.radius;
          this.particles.emit({ x: this.map.tower.x + Math.cos(an) * rr, y: 0.2, z: this.map.tower.z + Math.sin(an) * rr, vy: 3 + Math.random() * 4, life: 1.4, size: 0.34, grow: 0.8, color: tierCol, alpha: 0.95 });
        }
      }
    }
    // deposit circle: faint light column so the tower reads as the goal
    {
      const carrying = e.state === 'carried';
      beams.push(this.map.tower.x, this.map.tower.z, 0.9, 14, carrying ? '#ffcf80' : '#8f78e8', carrying ? 0.22 : 0.1);
      rings.push(this.map.tower.x, 0.12, this.map.tower.z, this.map.tower.radius, carrying ? '#ffcf80' : '#8f78e8', 0.18 + 0.4 * clamp(this.depositGlow, 0, 1));
    }
    // egg shield: gold bubble + orbiting coins
    this.eggShield.visible = eff.eggShield && e.state !== 'delivered';
    if (this.eggShield.visible) {
      this.eggShield.position.set(eggPos.x, eggPos.y + 0.28, eggPos.z);
      this.eggShield.scale.setScalar(1.0 + (calm ? 0 : Math.sin(T * 4) * 0.05));
      for (let i = 0; i < 6; i++) {
        const a = T * 2.4 + (i / 6) * Math.PI * 2;
        this.coins.push(eggPos.x + Math.cos(a) * 0.6, eggPos.y + 0.3 + Math.sin(a * 2 + i) * 0.12, eggPos.z + Math.sin(a) * 0.6, Math.PI / 2 - 0.5, a, 0, 1, 1, 1, '#ffd24a', 1);
      }
    }

    // ---- block_grab shield
    this.shield.visible = eff.blockGrab;
    if (eff.blockGrab) {
      this.shield.position.set(p.x, p.crouched ? 0.7 : 0.95, p.z);
      this.shield.scale.set(0.95, p.crouched ? 0.95 : 1.3, 0.95);
      const m = this.shield.material as THREE.ShaderMaterial;
      m.uniforms.uAlpha.value = 0.75 + (calm ? 0 : Math.sin(T * 5) * 0.15);
    }

    // ---- speed boost streaks + dust
    if (eff.speedBoost) {
      const dirYaw = Math.hypot(this.velX, this.velZ) > 0.5 ? yawOf(this.velX, this.velZ) : this.bodyYaw;
      const f = fwdOf(dirYaw);
      const r = { x: -f.z, z: f.x };
      for (let i = 0; i < 10; i++) {
        const ph = (T * 2.2 + i * 0.37) % 1;
        const side = ((i * 0.618) % 1 - 0.5) * 1.8;
        const back = 0.8 + ph * 3.2;
        const y = 0.35 + ((i * 0.31) % 1) * 1.3;
        this.streaks.push(p.x - f.x * back + r.x * side, y, p.z - f.z * back + r.z * side, 0, dirYaw, 0, 0.05, 1, 1.6 + 1.2 * (1 - ph), i % 3 === 0 ? '#e8d8ff' : '#cfe0ff', (1 - ph) * 0.8);
      }
      if (!calm && Math.random() < 0.7 && !low) this.particles.emit({ x: p.x - f.x * 0.4, y: 0.1, z: p.z - f.z * 0.4, vx: -f.x * 1.5 + (Math.random() - 0.5), vy: 0.7, vz: -f.z * 1.5 + (Math.random() - 0.5), life: 0.6, size: 0.4, grow: 2, color: '#9aa8c8', alpha: 0.4 });
    }

    // ---- premonition ghost path (violet) and scent trail (green-gold)
    const trail = (path: Vec2[] | null, color: string, dotSize: number, ghost: boolean): void => {
      if (!path || path.length < 2) return;
      const pts: Vec2[] = [{ x: h.x, z: h.z }, ...path];
      let total = 0;
      const segLen: number[] = [];
      for (let i = 1; i < pts.length; i++) { const d = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z); segLen.push(d); total += d; }
      if (total < 0.5) return;
      const at = (s: number): { x: number; z: number; ang: number } => {
        let acc = 0;
        for (let i = 0; i < segLen.length; i++) {
          if (s <= acc + segLen[i] || i === segLen.length - 1) {
            const t = clamp((s - acc) / (segLen[i] || 1), 0, 1);
            return { x: lerp(pts[i].x, pts[i + 1].x, t), z: lerp(pts[i].z, pts[i + 1].z, t), ang: yawOf(pts[i + 1].x - pts[i].x, pts[i + 1].z - pts[i].z) };
          }
          acc += segLen[i];
        }
        return { x: pts[pts.length - 1].x, z: pts[pts.length - 1].z, ang: 0 };
      };
      const n = Math.min(40, Math.max(6, Math.round(total / 1.0)));
      for (let i = 0; i < n; i++) {
        const s = (((i / n) + T * 0.18) % 1) * total;
        const q = at(s);
        glows.add(q.x, ghost ? 0.35 : 0.14, q.z, dotSize, gc.set(color), 0.7 * (1 - s / total * 0.6));
      }
      if (ghost) {
        for (let k = 0; k < 3; k++) {
          const s = total * (0.2 + k * 0.32);
          const q = at(s);
          this.ghosts.push(q.x, 0, q.z, 0, q.ang, 0, 1.2, 1.2, 1.2, '#9a7cff', (0.26 - k * 0.06) * (calm ? 1 : 0.85 + 0.15 * Math.sin(T * 3 + k)));
        }
      }
    };
    trail(eff.premonitionPath, '#b79cff', 0.55, true);
    if (eff.scentTrail && eff.scentTrail.length > 1) {
      const pts = [{ x: p.x, z: p.z }, ...eff.scentTrail];
      trail(pts.slice(1), '#c8ff9a', 0.42, false);
    }

    // ---- lure decoy: concentric ripples + luminous siren orb + drifting notes
    if (eff.lurePoint) {
      const lp = eff.lurePoint;
      for (let k = 0; k < 3; k++) {
        const t = (T * 0.8 + k / 3) % 1;
        rings.push(lp.x, 0.12, lp.z, 0.5 + t * 4.5, '#6fe0ff', (1 - t) * 0.85);
      }
      glows.add(lp.x, 1.1 + (calm ? 0 : Math.sin(T * 2.6) * 0.15), lp.z, 2.4, gc.set('#8ae8ff'), 0.85);
      glows.add(lp.x, 1.1 + (calm ? 0 : Math.sin(T * 2.6) * 0.15), lp.z, 0.8, gc.set('#ffffff'), 0.9);
      if (!calm && Math.random() < 0.25) this.particles.emit({ x: lp.x + (Math.random() - 0.5) * 0.8, y: 1.0, z: lp.z + (Math.random() - 0.5) * 0.8, vy: 0.9, vx: (Math.random() - 0.5) * 0.6, life: 1.3, size: 0.28, grow: 1.0, color: '#c8f4ff', alpha: 0.85 });
    }

    // ---- Hyde-side effects
    const hw = this.hyde.headWorld;
    if (eff.hydeDistracted && !eff.hydePetrified) {
      for (let i = 0; i < 4; i++) {
        const a = T * 3 + (i / 4) * Math.PI * 2;
        glows.add(hw.x + Math.cos(a) * 0.8, hw.y + 0.75 + Math.sin(a * 2) * 0.1, hw.z + Math.sin(a) * 0.8, 0.5, gc.set(i % 2 ? '#ffe08a' : '#c9a2ff'), 0.9);
      }
    }
    if (this.hydeVis === 'pin' && eff.hydeStunned) {
      // spectral shackles: rings of teal beads around the legs, chest and arms, anchored by a ground sigil
      for (let i = 0; i < 14; i++) {
        const a = T * 0.8 + (i / 14) * Math.PI * 2;
        const lvl = i % 3;
        const r = 0.8 + lvl * 0.15;
        const y = 0.5 + lvl * 0.95;
        glows.add(h.x + Math.cos(a) * r, y, h.z + Math.sin(a) * r, 0.5, gc.set('#8affc8'), 0.85);
      }
      rings.push(h.x, 0.12, h.z, 1.7, '#8affc8', 0.7);
      rings.push(h.x, 0.12, h.z, 1.1, '#c8fff0', 0.5);
    }
    if (eff.hydeStunned && !eff.hydePetrified && this.hydeVis !== 'pin') {
      const rnd = this.rnd;
      if (Math.floor(T * 22) !== this.fluff) {
        this.fluff = Math.floor(T * 22);
      }
      const body = this.hyde.chestWorld;
      for (let i = 0; i < 3; i++) {
        const a = rnd() * Math.PI * 2;
        this.tmp.set(body.x + Math.cos(a) * 0.4, body.y + 1.4 + rnd() * 0.6, body.z + Math.sin(a) * 0.4);
        this.tmp2.set(h.x + Math.cos(a + 0.8) * (0.9 + rnd() * 0.8), 0.05, h.z + Math.sin(a + 0.8) * (0.9 + rnd() * 0.8));
        this.bolts.bolt(this.tmp, this.tmp2, 5, 0.45, 0.06, gc.set('#bfe8ff'), this.camera.position, rnd);
      }
      glows.add(body.x, body.y + 0.5, body.z, 3.2, gc.set('#bfe8ff'), 0.4 + 0.3 * Math.sin(T * 40));
    }
    if (eff.hydeSlowed) {
      rings.push(h.x, 0.1, h.z, 1.5, '#cfeaff', 0.6);
      rings.push(h.x, 0.1, h.z, 1.0, '#8fd8ff', 0.5);
      if (!low && Math.random() < 0.5) this.particles.emit({ x: h.x + (Math.random() - 0.5) * 1.6, y: 2.4 + Math.random() * 0.8, z: h.z + (Math.random() - 0.5) * 1.6, vy: -1.2, life: 1.1, size: 0.2, grow: 0.7, color: '#dff4ff', alpha: 0.9 });
    }
    if (eff.hydePetrified && !low && Math.random() < 0.4) {
      this.particles.emit({ x: h.x + (Math.random() - 0.5) * 1.4, y: 0.4 + Math.random() * 2.4, z: h.z + (Math.random() - 0.5) * 1.4, vy: -0.4, life: 1.0, size: 0.16, grow: 0.5, color: '#b8bcc8', alpha: 0.7 });
    }
    // active one-shot bolts (ability use): player→Hyde (stun / gaze), switch→gate (power_switch)
    for (const b of this.boltFx) b.t += dt;
    this.boltFx = this.boltFx.filter((b) => b.t < b.life);
    for (const b of this.boltFx) {
      const a = 1 - b.t / b.life;
      if (b.from === 'player' && b.to === 'hyde') {
        this.tmp.set(p.x, 1.35, p.z);
        this.tmp2.set(h.x, HYDE_CHEST_Y, h.z);
        const col = gc.copy(b.color).multiplyScalar(a);
        this.bolts.bolt(this.tmp, this.tmp2, 9, b.color.g > 0.95 && b.color.r < 0.8 ? 0.0 : 0.7, 0.07 + 0.05 * a, col, this.camera.position, this.rnd);
      } else if (b.from === 'switch' && this.world.switchPos && this.map.powerSwitch) {
        const gw = this.map.walls.find((w) => w.id === this.map.powerSwitch?.gateWallId);
        if (gw) {
          this.tmp.set(this.world.switchPos.x, this.world.switchPos.y, this.world.switchPos.z);
          this.tmp2.set((gw.a.x + gw.b.x) / 2, gw.height * 0.6, (gw.a.z + gw.b.z) / 2);
          this.bolts.bolt(this.tmp, this.tmp2, 14, 1.1, 0.06, gc.copy(b.color).multiplyScalar(a), this.camera.position, this.rnd);
        }
      }
    }
    this.gazeT = Math.max(0, this.gazeT - dt);
    if (this.gazeT > 0 && eff.hydePetrified) {
      // two pale-green eye beams from the avatar's head to the Hyde
      for (const s of [-1, 1]) {
        const f = fwdOf(this.bodyYaw);
        this.tmp.set(p.x - f.z * s * 0.07 + f.x * 0.12, 1.62, p.z + f.x * s * 0.07 + f.z * 0.12);
        this.tmp2.set(h.x, HYDE_CHEST_Y + 0.2, h.z);
        this.bolts.bolt(this.tmp, this.tmp2, 2, 0, 0.035, gc.set('#a8ffc8').multiplyScalar(this.gazeT), this.camera.position, this.rnd);
      }
      glows.add(p.x, 1.6, p.z, 1.2, gc.set('#a8ffc8'), this.gazeT);
    }

    // ---- reveal_hazards: outlines + will-o-wisps
    this.hazard.set(damp(this.hazardK, eff.revealHazards ? 1 : 0, 6, dt), p.x, p.z, 17, T);
    this.hazardK = damp(this.hazardK, eff.revealHazards ? 1 : 0, 6, dt);
    if (eff.revealHazards) {
      for (let i = 0; i < 5; i++) {
        const a = T * 1.6 + (i / 5) * Math.PI * 2;
        glows.add(p.x + Math.cos(a) * 1.5, 1.0 + Math.sin(a * 2 + i) * 0.3, p.z + Math.sin(a) * 1.5, 0.9, gc.set(i % 2 ? '#8ab8ff' : '#c8a2ff'), 0.9);
      }
    }

    // ---- power switch: sparks while powered
    if (eff.switchPowered && this.world.switchPos) {
      const sp = this.world.switchPos;
      glows.add(sp.x, sp.y, sp.z, 1.8 + (calm ? 0 : Math.sin(T * 30) * 0.5), gc.set('#fff2a0'), 0.9);
      if (!low && Math.random() < 0.5) this.particles.emit({ x: sp.x, y: sp.y, z: sp.z, vx: (Math.random() - 0.5) * 3, vy: 1 + Math.random() * 2, vz: (Math.random() - 0.5) * 3, life: 0.4, size: 0.14, grow: 0.5, color: '#fff2a0', alpha: 1, gravity: -6 });
    }

    // ---- Hyde eyes + violet back-halo so the dark body silhouettes against the night
    {
      const a = this.hyde.stoneAmount > 0.5 || this.showcase ? 0 : 1;
      const esz = 0.75 * this.hyde.look.eyeScale;
      glows.add(this.hyde.eyeL.x, this.hyde.eyeL.y, this.hyde.eyeL.z, esz, this.hyde.look.eyeColor, 0.95 * a * (1 - this.hydeFade));
      glows.add(this.hyde.eyeR.x, this.hyde.eyeR.y, this.hyde.eyeR.z, esz, this.hyde.look.eyeColor, 0.95 * a * (1 - this.hydeFade));
      const awayX = h.x - this.camera.position.x, awayZ = h.z - this.camera.position.z;
      const al = Math.hypot(awayX, awayZ) || 1;
      const chase = h.mode === 'CHASE' ? 1 : 0;
      glows.add(h.x + (awayX / al) * 1.6, this.showcase ? -50 : 1.9, h.z + (awayZ / al) * 1.6, 9 + chase * 2.5, gc.set(this.hyde.frostAmount > 0.5 ? '#6ac8f0' : chase ? '#7a4ac8' : '#5a46c0'), (0.3 + 0.16 * chase) * (1 - this.hydeFade));
    }
    // companion + egg-carrier warmth
    if (!this.showcase) rings.push(this.companion.root.position.x, 0.1, this.companion.root.position.z, 0.62, this.companion.glowColor, 0.4 * (1 - this.companion.root.position.y * 0.0));
    if (!this.showcase) glows.add(this.companion.root.position.x, this.companion.root.position.y, this.companion.root.position.z, 1.5, gc.set(this.companion.glowColor), 0.55);

    // ---- blob shadows
    {
      const set = (i: number, x: number, z: number, s: number, y = 0.06): void => {
        this.tmp.set(x, y, z);
        const m = new THREE.Matrix4().makeScale(s, 1, s).setPosition(this.tmp);
        this.blobs.setMatrixAt(i, m);
      };
      set(0, p.x, p.z, 1.0);
      set(1, h.x, h.z, 2.9);
      set(2, this.companion.root.position.x, this.companion.root.position.z, 0.5 + (this.companion.root.position.y - 1.4) * -0.1);
      set(3, eggPos.x, eggPos.z, e.state === 'carried' || e.state === 'delivered' ? 0.01 : 0.55);
      this.blobs.count = 4;
      this.blobs.instanceMatrix.needsUpdate = true;
    }

    rings.end(); glows.end(); beams.end(); this.streaks.end(); this.ghosts.end(); this.coins.end(); this.bolts.end();
    void PAL;
  }

  private hazardK = 0;
  private hydeVis: 'petrify' | 'pin' | null = null;
}
