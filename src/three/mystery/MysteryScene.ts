// "The Silent Evidence" renderer: a night-time gothic island walked in third person. Reads only the public state of a
// RenderableMysteryRun (MysteryRun satisfies it) and never changes gameplay. Everything is drawn from the MapDef.
import * as THREE from 'three';
import type { ClueId, CrackstoneMode, Duo, HydeMode, MapDef, StampedEvent, Vec2 } from '../../mystery/types.ts';
import { ParticlePool } from '../particles.ts';
import { createSkyMaterial, createWaterMaterial, srgbVec } from '../shaders.ts';
import { clamp, damp, lerp, makeGlowTexture, mulberry32, smoothstep } from '../util.ts';
import { createFxUniforms, createFresnelMaterial, type FxUniforms } from '../action/fx.ts';
import { lambertVC } from '../actors.ts';
import { Avatar, Companion, type Stance } from './characters.ts';
import { PAL, angleLerp, distPointSeg, eggHex, fwdOf, makeBlobTexture, makeGlyphTexture, wrapAngle, yawOf } from './common.ts';
import { HydeBiped } from './hydeBeast.ts';
import { CRACK_GREEN, CRACK_GREEN_HI, CrackstoneRig } from './crackstone.ts';
import { Telegraph } from './telegraph.ts';
import { EggRig } from './items.ts';
import { createOverlay } from './overlay.ts';
import { ThingRig, type ThingPose } from './thing.ts';
import { NO_EFFECTS, type MysterySceneOptions, type RenderableMysteryRun } from './types.ts';
import { BeaconField, BeamField, BoltField, GlowSet, HazardOutline, RingField, ShapeField, coinGeo, ghostGeo, streakGeo } from './vfx.ts';
import { MysteryWorld } from './world.ts';
import { BASE_LOOK, lookOf, type CaseLook } from './look.ts';
import { InvestigationView } from './investigationView.ts';
import { SearchlightSet, type SearchlightDef } from './hazards.ts';
import { Lightning, RainField, patchSkyShader } from './weather.ts';

export type { MysterySceneOptions } from './types.ts';

const FOG_COLOR = 0x10152e;
const BASE_FOV = 62;
const HYDE_CHEST_Y = 1.7;

interface NoiseRing { x: number; z: number; r: number; loud: number; age: number; life: number; color: THREE.Color }
interface Timed { t: number; life: number }
interface BoltFx extends Timed { from: 'player' | 'switch'; to: 'hyde' | 'gate' | 'crack'; color: THREE.Color }
/** Crackstone's two telegraphs, tracked locally so the burst / fade can outlive the sim's runtime fields. */
interface ScanFx { phase: 'off' | 'warning' | 'pulse' | 'fade'; x: number; z: number; r: number; prog: number; t: number }
interface CurseFx { on: boolean; x: number; z: number; r: number; prog: number; mode: 0 | 1 | 2; t: number; landsAt: number; resolvedAt: number }
interface Pulse extends Timed { x: number; z: number; r: number; color: THREE.Color }

/** Noise sources that draw ONE modest ring (never footsteps or searching): colour and the cap on the drawn radius (m). */
const NOISE_RING: Record<string, { color: string; cap: number }> = {
  egg_drop: { color: '#ffd24a', cap: 4.2 }, impact: { color: '#ffb04a', cap: 3.4 }, decoy: { color: '#6fe0ff', cap: 3.6 }, hazard: { color: '#ff6a5a', cap: 3.8 },
};

const C = (hex: string): THREE.Color => new THREE.Color(hex);
interface WallLite { ax: number; az: number; bx: number; bz: number; r: number; h: number }
interface CoverLite { x: number; z: number; r: number; top: number }

export class MysteryScene {
  readonly canvas: HTMLCanvasElement;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(BASE_FOV, 16 / 9, 0.3, 700);
  private readonly fog = new THREE.FogExp2(FOG_COLOR, 0.0165);
  private readonly fx: FxUniforms = createFxUniforms();
  private readonly glowTex: THREE.Texture | null;
  private world!: MysteryWorld;
  private avatar!: Avatar;
  private companion!: Companion;
  private readonly hyde: HydeBiped;
  private readonly egg: EggRig;
  private look: CaseLook;
  private view!: InvestigationView;
  private searchlights: SearchlightSet | null = null;
  private rainField: RainField | null = null;
  private readonly lightning = new Lightning(7, false);
  private readonly beacons: BeaconField;
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
  /** 0 = the threat tint is the Hyde's (red), 1 = Crackstone's (witch-light green); red stays reserved for the Hyde. */
  private crackMix = 0;
  private hideK = 0;
  private dimK = 0;
  private fogNow = 0.0165;
  private depositGlow = 0;
  // camera
  private camYaw = 0;
  private camPitch = 0.12;
  private camDist = 3.7;
  private pivotY = 1.5;
  private fovNow = BASE_FOV;
  private baseVFov = BASE_FOV;
  private cameraReady = false;
  private get camReady(): boolean { return this.cameraReady; }
  private hydeFade = 0;
  private assistK = 0;
  private assistSide = 1;
  private camBob = 0;
  private readonly camPos = new THREE.Vector3();
  private readonly tmp = new THREE.Vector3();
  private readonly tmp2 = new THREE.Vector3();
  private readonly tmpCol = new THREE.Color();
  private readonly gcTmp = new THREE.Color();
  private readonly blobM = new THREE.Matrix4();
  private readonly frustum = new THREE.Frustum();
  private readonly frustumM = new THREE.Matrix4();
  private readonly sph = new THREE.Sphere();
  private frameNo = 0;
  private hydeAcc = 0;
  private crackAcc = 0;
  private thingAcc = 0;
  private nearWalls: WallLite[] = [];
  private nearCover: CoverLite[] = [];
  private readonly ndc = new THREE.Vector3();
  private hydeOnScreen = false;
  private hydeEdge = { x: 0, y: 0, s: 0 };
  // ---- Joseph Crackstone (enemy overhaul): lazily built when the run has one
  private crack: CrackstoneRig | null = null;
  private crackShown = false;
  private crackFade = 0;
  private crackOnScreen = false;
  private crackEdge = { x: 0, y: 0 };
  private crackSpeedSm = 0;
  private crackModePrev: CrackstoneMode = 'PATROL';
  private crackAlertT = 0;
  private crackEmber = 0;
  private crackVis: 'petrify' | 'pin' | null = null;
  private readonly crackNdc = new THREE.Vector3();
  private readonly scanTg: Telegraph;
  private readonly curseTg: Telegraph;
  private scanFx: ScanFx = { phase: 'off', x: 0, z: 0, r: 8, prog: 0, t: 0 };
  private curseFx: CurseFx = { on: false, x: 0, z: 0, r: 3, prog: 0, mode: 0, t: 0, landsAt: 0, resolvedAt: -1 };
  private scanStamp = -99;
  private readonly alertQc: THREE.Sprite;
  private readonly alertXc: THREE.Sprite;
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
  // overhaul state
  private emerge: { t: number; x: number; z: number } | null = null;
  private hydeWasEmerged: boolean | null = null;
  private hydeShown = true;
  private riseK = 1;
  private hydeSpeedSm = 0;
  private built = false;
  private invDirty = true;
  private eggShown = true;
  private lightLevel = 0;
  private motesT = 0;
  private hintTravel = 0;
  private passageWasOpen = false;
  // adaptive resolution: drops the render scale when frames run slow (fill-rate bound laptops), recovers when there is headroom
  private adaptive = true;
  private renderScale = 1;
  private scaleProbe = 0;
  private scaleFutile = false;
  private sizeW = 0;
  private sizeH = 0;
  private sizePR = 0;
  /** JS time per frame (update + draw submit), EMA ms: tells a CPU-bound laptop (resolution does not help) from a fill-rate-bound one */
  private cpuEma = 4;
  private perfEma = 16.7;
  private perfClock = 0;
  private perfLastChange = 0;
  private perfUpWait = 6;
  private perfLastUp = -99;
  private debugCam: { pos: THREE.Vector3; look: THREE.Vector3; fov: number; fog?: number } | null = null;
  private showcase = false;

  constructor(private readonly container: HTMLElement, private map: MapDef, private duo: Duo, private options: MysterySceneOptions) {
    this.look = lookOf(map);
    this.canvas = document.createElement('canvas');
    this.canvas.style.cssText = 'display:block;width:100%;height:100%';
    this.canvas.setAttribute('aria-label', 'Third-person view of Raven Island at night');
    container.appendChild(this.canvas);
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: !options.lowGraphics, powerPreference: 'high-performance' });
    // getProgramInfoLog / getShaderInfoLog after every link is a synchronous GPU round-trip: only worth it in development
    this.renderer.debug.checkShaderErrors = !(import.meta as unknown as { env?: { PROD?: boolean } }).env?.PROD;
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
    patchSkyShader(skyMat);
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
    this.beacons = new BeaconField(24);
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
    this.scene.add(this.rings.mesh, this.glows.field.mesh, this.bolts.mesh, this.beams.mesh, this.beacons.mesh, this.streaks.mesh, this.ghosts.mesh, this.coins.mesh, this.particles.points);

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

    {
      const qc = makeGlyphTexture('?', CRACK_GREEN), xc = makeGlyphTexture('!', CRACK_GREEN_HI);
      this.alertQc = new THREE.Sprite(new THREE.SpriteMaterial({ map: qc ?? undefined, transparent: true, depthWrite: false, depthTest: false, fog: false }));
      this.alertXc = new THREE.Sprite(new THREE.SpriteMaterial({ map: xc ?? undefined, transparent: true, depthWrite: false, depthTest: false, fog: false }));
      for (const sp of [this.alertQc, this.alertXc]) { sp.visible = false; sp.renderOrder = 20; sp.scale.setScalar(0.9); this.scene.add(sp); }
      this.scanTg = new Telegraph('scan', CRACK_GREEN, CRACK_GREEN_HI);
      this.curseTg = new Telegraph('curse', CRACK_GREEN, CRACK_GREEN_HI);
      this.scene.add(this.scanTg.ground, this.scanTg.wall, this.curseTg.ground, this.curseTg.wall);
    }
    this.scene.add(this.overlay.mesh);

    if (typeof window !== 'undefined' && /[?&]scenedebug/.test(window.location.search)) (window as unknown as { __mysteryScene?: MysteryScene }).__mysteryScene = this;
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();
  }

  /** The static world is built on the first frame (after the app has chosen showcase / options), so it is built exactly once. */
  private ensureBuilt(): void {
    if (this.built) return;
    this.built = true;
    this.buildMapObjects();
  }

  // ------------------------------------------------------------------------------------------------------ build
  /** Applies the case's visual identity: fog / sky / light colours, water, rain, lightning. */
  private applyLook(): void {
    const L = this.look = this.showcase ? BASE_LOOK : lookOf(this.map);
    this.fog.color.setHex(L.fogColor);
    this.fogNow = L.fogDensity;
    this.renderer.setClearColor(L.fogColor, 1);
    (this.scene.background as THREE.Color).setHex(L.fogColor);
    this.hemi.color.setHex(L.hemiSky);
    this.hemi.groundColor.setHex(L.hemiGround);
    this.hemi.intensity = L.hemiIntensity;
    this.moon.color.setHex(L.moonColor);
    this.moon.intensity = L.moonIntensity;
    const su = (this.sky.material as THREE.ShaderMaterial).uniforms;
    srgbVec(L.skyZenith, su.uZenith.value as THREE.Vector3);
    srgbVec(L.skyHorizon, su.uHorizon.value as THREE.Vector3);
    su.uMoonVis.value = L.moonVis;
    su.uStars.value = L.stars;
    su.uStorm.value = L.storm;
    su.uFlashS.value = 0;
    this.applyWater();
    this.lightning.setEnabled(L.lightning && !this.options.reducedMotion);
    if (this.rainField) { this.scene.remove(this.rainField.mesh); this.rainField.dispose(); this.rainField = null; }
    if (L.rain) {
      this.rainField = new RainField(this.options.lowGraphics ? 150 : 380);
      this.scene.add(this.rainField.mesh);
    }
  }

  private applyWater(): void {
    const L = this.look;
    const wm = this.water.material as THREE.ShaderMaterial;
    if (wm.uniforms?.uDeep) {
      srgbVec(L.waterDeep, wm.uniforms.uDeep.value as THREE.Vector3);
      srgbVec(L.waterShallow, wm.uniforms.uShallow.value as THREE.Vector3);
      srgbVec(L.skyHorizon, wm.uniforms.uHorizon.value as THREE.Vector3);
      srgbVec(L.skyZenith, wm.uniforms.uZenith.value as THREE.Vector3);
      wm.uniforms.uMoonVis.value = L.moonVis;
    } else (this.water.material as THREE.MeshBasicMaterial).color?.setHex(L.waterBasic);
  }

  private buildMapObjects(): void {
    this.applyLook();
    this.world = new MysteryWorld(this.map, this.fx, this.options.lowGraphics, this.look);
    this.scene.add(this.world.root);
    this.avatar = new Avatar(this.duo.characterId, lambertVC({ emissive: new THREE.Color('#241d34'), emissiveIntensity: 1 }));
    this.scene.add(this.avatar.root);
    this.companion = new Companion(this.duo.pokemonId);
    this.scene.add(this.companion.root);
    this.view = new InvestigationView(this.map, this.world.dress, this.world.switchHull);
    this.scene.add(this.view.root);
    const lights = (this.map.world?.hazards ?? []).filter((h): h is SearchlightDef => h.kind === 'searchlight');
    this.searchlights = lights.length ? new SearchlightSet(this.map, lights) : null;
    if (this.searchlights) this.scene.add(this.searchlights.root);
    this.hazard = new HazardOutline(this.map, this.map.powerSwitch?.gateWallId);
    this.scene.add(this.hazard.mesh);
    const th = this.world.dress.thing;
    this.thing.root.position.set(th.x, th.y, th.z);
    this.thing.root.rotation.y = th.yaw;
    if (this.world.glowStatic) this.world.glowStatic.mesh.visible = true;
    this.prevInit = false;
    this.cameraReady = false;
    this.emerge = null;
    this.hydeWasEmerged = null;
    this.invDirty = true;
    this.warmUp();
  }

  private destroyMapObjects(): void {
    this.scene.remove(this.world.root, this.avatar.root, this.companion.root, this.hazard.mesh, this.view.root);
    if (this.searchlights) { this.scene.remove(this.searchlights.root); this.searchlights.dispose(); this.searchlights = null; }
    this.view.dispose();
    this.world.dispose();
    this.avatar.dispose();
    this.companion.dispose();
    this.hazard.dispose();
  }

  setOptions(options: Partial<MysterySceneOptions>): void {
    const lowChanged = options.lowGraphics !== undefined && options.lowGraphics !== this.options.lowGraphics;
    this.options = { ...this.options, ...options };
    if (lowChanged && this.built) {
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
      this.applyWater();
    }
    this.lantern.visible = !this.options.lowGraphics;
    this.lightning.setEnabled(this.look.lightning && !this.options.reducedMotion);
    this.resize();
  }

  private resize(): void {
    const w = Math.max(1, this.container.clientWidth);
    const h = Math.max(1, this.container.clientHeight);
    this.width = w;
    this.height = h;
    const pr = Math.min(window.devicePixelRatio || 1, this.options.lowGraphics ? 1 : 1.5) * this.renderScale;
    // only touch the drawing buffer when the size / ratio really changed (setSize reallocates the swap-chain buffers)
    if (w !== this.sizeW || h !== this.sizeH || Math.abs(pr - this.sizePR) > 1e-4) {
      this.sizeW = w; this.sizeH = h; this.sizePR = pr;
      this.renderer.setPixelRatio(pr);
      this.renderer.setSize(w, h, false);
    }
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
    // CPU-bound (most of the frame is our own JS): a lower resolution cannot help, so never drop it and win back what was lost
    const cpuBound = this.scaleFutile || this.cpuEma > this.perfEma * 0.28;
    if (cpuBound) {
      if (this.renderScale < 1 && since > 3) { this.renderScale = Math.min(1, this.renderScale + 0.15); this.perfLastChange = this.perfClock; this.resize(); }
      return;
    }
    if (this.perfEma > 23 && this.renderScale > 0.55) {
      // an up-probe that fails soon after succeeding doubles the wait before the next probe
      if (this.perfClock - this.perfLastUp < 8) this.perfUpWait = Math.min(60, this.perfUpWait * 2);
      // a drop that does not buy at least 10 % of the frame time proves the frame is CPU-bound: undo it and stop trying
      if (this.scaleProbe > 0 && this.perfEma > this.scaleProbe * 0.9) { this.scaleFutile = true; this.renderScale = 1; this.perfLastChange = this.perfClock; this.resize(); return; }
      this.scaleProbe = this.perfEma;
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
  setShowcase(on: boolean): void {
    if (on === this.showcase) return;
    this.showcase = on;
    this.cameraReady = false;
    if (this.built) { this.destroyMapObjects(); this.buildMapObjects(); } // the showcase keeps the original blue-night look
  }

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
    const t0 = performance.now();
    this.update(run, events, clamp(dt, 0, 0.1));
    this.draw(run);
    if (dt > 0) this.cpuEma += (performance.now() - t0 - this.cpuEma) * 0.05;
  }

  /** Screen position of the Hyde: `onScreen`, NDC and distance (for HUD warnings). */
  getHydeScreen(): { onScreen: boolean; ndcX: number; ndcY: number; behind: boolean; distance: number } {
    const run = this.lastRun;
    const d = run && this.hydeShown ? Math.hypot(run.hyde.x - run.player.x, run.hyde.z - run.player.z) : 999;
    return { onScreen: this.hydeShown && this.hydeOnScreen, ndcX: this.ndc.x, ndcY: this.ndc.y, behind: this.ndc.z > 1, distance: d };
  }

  /** Screen position of Joseph Crackstone (same shape as getHydeScreen); distance 999 / offscreen when there is none. */
  getCrackstoneScreen(): { onScreen: boolean; ndcX: number; ndcY: number; behind: boolean; distance: number } {
    const run = this.lastRun;
    const c = run?.crackstone;
    const d = run && c && this.crackShown ? Math.hypot(c.x - run.player.x, c.z - run.player.z) : 999;
    return { onScreen: !!c && this.crackShown && this.crackOnScreen, ndcX: this.crackNdc.x, ndcY: this.crackNdc.y, behind: this.crackNdc.z > 1, distance: d };
  }

  getDebugState(run: RenderableMysteryRun): Record<string, unknown> {
    this.ensureBuilt();
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
      crackstone: run.crackstone ? {
        mode: run.crackstone.mode, x: +run.crackstone.x.toFixed(2), z: +run.crackstone.z.toFixed(2), speed: +run.crackstone.speed.toFixed(2), shown: this.crackShown, onScreen: this.crackOnScreen,
        distance: +Math.hypot(run.crackstone.x - run.player.x, run.crackstone.z - run.player.z).toFixed(2), fade: +this.crackFade.toFixed(2),
        scan: this.scanFx.phase, scanProg: +this.scanFx.prog.toFixed(2), curse: this.curseFx.on ? this.curseFx.mode : -1, curseProg: +this.curseFx.prog.toFixed(2),
        stone: +(this.crack?.stoneAmount ?? 0).toFixed(2), flare: +(this.crack?.flare ?? 0).toFixed(2),
      } : null,
      egg: { state: run.egg.state, tier: run.egg.tier },
      companion: { pokemon: this.companion.pokemonId, visual: this.companion.visual, modelSource: this.companion.modelSource, modelError: this.companion.modelError },
      drawCalls: info.render.calls,
      triangles: info.render.triangles,
      geometries: info.memory.geometries,
      textures: info.memory.textures,
      programs: info.programs?.length ?? 0,
      programsAfterWarmUp: this.programsAfterWarm,
      cpuMs: +this.cpuEma.toFixed(2),
      noiseRings: this.noise.length,
      theme: this.look.theme,
      world: {
        siteProps: this.view?.stats.siteProps ?? 0,
        clueSites: this.map.world?.clueSites.reduce((n, g) => n + g.sites.length, 0) ?? 0,
        eggSites: this.map.world?.eggSites.length ?? 0,
        examines: this.map.world?.examines.length ?? 0,
        hazards: { noisyFloors: (this.map.world?.hazards ?? []).filter((h) => h.kind === 'noisy_floor').length, searchlights: this.searchlights?.lights.map((l) => ({ id: l.def.id, yaw: +l.yaw.toFixed(3) })) ?? [] },
        passage: !!this.map.world?.passage,
        checkedSites: this.view?.stats.checked ?? 0,
        evidenceVisible: this.view?.stats.evidenceVisible ?? [],
        eggVisible: this.eggShown,
        outlines: this.view?.stats.outlines ?? 0,
        beacons: this.world?.dress.extras.beacons.length ?? 0,
      },
      weather: { rain: !!this.rainField, lightning: +this.lightLevel.toFixed(2) },
      hydeEmerged: this.hydeShown,
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
    if (this.built) this.destroyMapObjects();
    if (this.rainField) { this.scene.remove(this.rainField.mesh); this.rainField.dispose(); }
    this.beacons.dispose();
    this.removeCrackstone(); this.scanTg.dispose(); this.curseTg.dispose();
    for (const sp of [this.alertQc, this.alertXc]) { sp.material.map?.dispose(); sp.material.dispose(); }
    this.hyde.dispose(); this.egg.dispose(); this.thing.dispose(); this.thingHint.dispose();
    this.particles.dispose(); this.rings.dispose(); this.glows.dispose(); this.bolts.dispose(); this.beams.dispose();
    this.streaks.dispose(); this.ghosts.dispose(); this.coins.dispose(); this.overlay.dispose();
    this.sky.geometry.dispose(); (this.sky.material as THREE.Material).dispose();
    this.water.geometry.dispose(); this.waterMat.dispose(); (this.water.material as THREE.Material).dispose();
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
    this.frameNo++;
    if (this.built && run.map !== this.map && run.map.id !== this.map.id) {
      this.map = run.map;
      this.destroyMapObjects();
      this.buildMapObjects();
    } else if (!this.built && run.map.id !== this.map.id) this.map = run.map;
    this.ensureBuilt();
    const eff = run.effects ? run.effects() : NO_EFFECTS;
    this.hydeVis = run.hydeVisual ? run.hydeVisual() : eff.hydePetrified ? 'petrify' : null;
    this.crackVis = run.crackstoneVisual ? run.crackstoneVisual() : eff.crackstonePetrified ? 'petrify' : null;
    for (const e of events) this.onEvent(e, run);
    this.updatePlayer(run, dt);
    this.updateWorld(run, eff, dt);
    this.updateHyde(run, eff, dt);
    this.updateCrackstone(run, eff, dt);
    this.updateThing(run, dt);
    this.updateItems(run, eff, dt);
    if (this.companion.visual !== this.warmCompanionVisual) this.warmUp(); // the artwork / 3D model arrived: compile its program variants now
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
        // Walking (every stance) and searching draw NOTHING: the noise meter + minimap carry that. Only loud one-off events get one
        // modest, short ring (the ability's own pulse is its ring).
        const ring = NOISE_RING[e.source];
        if (e.source === 'egg_drop') this.burst(e.x, 0.3, e.z, low ? 6 : 14, '#ffe9a0', 2.0, 0.8);
        if (!ring || e.loudness < 0.1) break;
        this.noise.push({ x: e.x, z: e.z, r: Math.min(ring.cap, Math.max(1.2, e.radiusM * 0.3)), loud: e.loudness, age: 0, life: 0.7 + 0.35 * e.loudness, color: C(ring.color) });
        if (this.noise.length > 8) this.noise.shift();
        break;
      }
      case 'hyde_emerged':
        this.emerge = { t: 0, x: e.x, z: e.z };
        this.onEmerge(e.x, e.z, run);
        break;
      case 'hazard_triggered': {
        if (this.searchlights?.has(e.hazardId)) {
          this.searchlights.trigger(e.hazardId); // the beam flares and the screen blinks cold
          this.setFlash(0.8, 0.9, 1, 0.08);
          break;
        }
        // a noisy floor: a small puff of what is underfoot (glass glints, board dust, rubble grit, a splash) so players learn to crouch there
        const hz = this.map.world?.hazards.find((q) => q.id === e.hazardId);
        if (hz && hz.kind === 'noisy_floor') {
          const col = hz.look === 'glass' ? '#cfeaf2' : hz.look === 'puddle' ? '#8fc8ff' : hz.look === 'boards' ? '#c8a878' : '#a89888';
          const n = low ? 4 : 10;
          for (let i = 0; i < n; i++) {
            const a = Math.random() * Math.PI * 2;
            this.particles.emit({ x: p.x + Math.cos(a) * 0.3, y: 0.08, z: p.z + Math.sin(a) * 0.3, vx: Math.cos(a) * 0.9, vy: 0.8 + Math.random() * 1.0, vz: Math.sin(a) * 0.9, life: 0.55, size: hz.look === 'glass' ? 0.12 : 0.2, grow: 1.4, color: col, alpha: 0.8, gravity: -3 });
          }
        }
        break;
      }
      case 'passage_opened':
        this.onPassageOpened(run);
        break;
      case 'site_checked':
      case 'trace_found':
        this.invDirty = true;
        break;
      case 'examined': {
        this.invDirty = true;
        const ex = this.world.dress.extras.examines.find((q) => q.id === e.examineId);
        if (ex) this.burst(ex.x, 0.8, ex.z, low ? 6 : 14, '#bfe8ff', 2.0, 0.9);
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
      case 'crackstone_mode':
        if (e.to === 'CHASE' && !calm) this.shake = Math.max(this.shake, 0.3);
        if (e.to === 'CHASE') { this.companion.flash(0.6); this.setFlash(0.7, 1, 0.5, 0.1); }
        this.crackAlertT = 1.4;
        break;
      case 'crackstone_sighted':
        this.setFlash(0.7, 1, 0.5, 0.08);
        this.crackAlertT = 1.6;
        break;
      case 'crackstone_scan':
        if (e.phase === 'pulse') {
          const c = run.crackstone;
          if (c && run.t - this.scanStamp > 0.5) this.startScanPulse(c.x, c.z, e.radiusM);
          if (e.hit && !calm) { this.setFlash(0.7, 1, 0.5, 0.2); this.shake = Math.max(this.shake, 0.35); }
        }
        break;
      case 'curse': {
        const cf = this.curseFx;
        if (e.phase === 'hit' || e.phase === 'miss') {
          if (!cf.on) { const c = run.crackstone; cf.x = c?.curse?.x ?? p.x; cf.z = c?.curse?.z ?? p.z; cf.r = c?.curse?.radiusM ?? 3; }
          cf.on = true; cf.mode = e.phase === 'hit' ? 1 : 2; cf.t = 0; cf.resolvedAt = cf.landsAt; cf.prog = 1;
          if (e.phase === 'hit') {
            this.burst(cf.x, 0.6, cf.z, low ? 16 : 40, CRACK_GREEN, 4.2, 1.0);
            this.burst(cf.x, 0.3, cf.z, low ? 6 : 16, CRACK_GREEN_HI, 2.4, 0.8);
            if (!calm) { this.shake = Math.max(this.shake, e.blocked ? 0.3 : 0.7); this.setFlash(0.55, 0.9, 0.35, e.blocked ? 0.15 : 0.3); }
          }
        }
        break;
      }
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
          this.pulses.push({ t: 0, life: 0.9, x: c.x, z: c.z, r: 2.6, color: C('#ffe9a0') });
        }
        this.invDirty = true;
        this.setFlash(1, 0.9, 0.6, 0.14);
        break;
      }
      case 'egg_pickup':
        this.burst(run.egg.x, 0.7, run.egg.z, low ? 10 : 26, eggHex(run.egg.tier), 2.8, 1.0);
        this.pulses.push({ t: 0, life: 0.8, x: run.egg.x, z: run.egg.z, r: 2.2, color: C(eggHex(run.egg.tier)) });
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
      case 'hint_requested': {
        // the app sends the hint target through pointThing(); with the carry / deposit goals (public) we point at the tower ourselves
        const obj = run.objective ? run.objective() : undefined;
        if (obj === 'deliver_egg' || obj === 'accuse') this.pointThing({ x: this.map.tower.x, z: this.map.tower.z });
        else this.burst(p.x, 1.2, p.z, low ? 4 : 10, '#e6d9ff', 1.6, 0.7);
        break;
      }
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
    this.pulses.push({ t: 0, life: 0.7, x: p.x, z: p.z, r: 2.4, color: C('#b79cff') });
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
          if (eff.hydeStunned || eff.hydePetrified || !run.crackstone) this.boltFx.push({ t: 0, life: 0.45, from: 'player', to: 'hyde', color: eff.hydePetrified ? C('#bfffd0') : C('#c8e8ff') });
          if (run.crackstone && (eff.crackstoneStunned || eff.crackstonePetrified)) this.boltFx.push({ t: 0, life: 0.45, from: 'player', to: 'crack', color: eff.crackstonePetrified ? C('#bfffd0') : C('#c8e8ff') });
          if (eff.hydePetrified) this.gazeT = 0.9;
          const sOnly = !!run.crackstone && (eff.crackstoneStunned || eff.crackstonePetrified) && !(eff.hydeStunned || eff.hydePetrified);
          const sh = sOnly && run.crackstone ? run.crackstone : h;
          for (let i = 0; i < (low ? 12 : 30); i++) {
            this.particles.emit({ x: sh.x + (Math.random() - 0.5) * 1.4, y: 0.5 + Math.random() * 2.4, z: sh.z + (Math.random() - 0.5) * 1.4, vx: (Math.random() - 0.5) * 3, vy: Math.random() * 3, vz: (Math.random() - 0.5) * 3, life: 0.7, size: 0.3, grow: 0.8, color: eff.hydePetrified ? '#c8d4c0' : '#bfe8ff', alpha: 0.9, gravity: eff.hydePetrified ? -4 : 0 });
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
          if (this.eggShown) this.burst(run.egg.x, 1.0, run.egg.z, low ? 8 : 24, '#ffd24a', 2.4, 1.0);
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

  /** The Hyde rises from mist at his spawn (his model is drawn nowhere before this). */
  private onEmerge(x: number, z: number, run: RenderableMysteryRun): void {
    const low = this.options.lowGraphics;
    const calm = this.options.reducedMotion;
    this.riseK = 0;
    const n = low ? 14 : 36;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, d = Math.random() * 1.6;
      this.particles.emit({ x: x + Math.cos(a) * d, y: 0.15 + Math.random() * 0.3, z: z + Math.sin(a) * d, vx: Math.cos(a) * 0.6, vy: 0.5 + Math.random() * 0.9, vz: Math.sin(a) * 0.6, life: 2.1, size: 1.8, grow: 2.8, color: Math.random() < 0.6 ? '#8a7ab8' : '#5a4f9a', alpha: 0.6, drag: 0.6 });
    }
    this.pulses.push({ t: 0, life: 1.1, x, z, r: 3.4, color: C('#7a5ac8') });
    const dist = Math.hypot(x - run.player.x, z - run.player.z);
    if (dist < 45) {
      this.setFlash(0.5, 0.1, 0.3, 0.12 * (1 - dist / 90)); // low roar flash
      if (!calm) this.shake = Math.max(this.shake, 0.12 + 0.25 * (1 - dist / 45));
    }
  }

  /** Lever pulled: dust along the opened wall and a short camera nudge (none with reduced motion). */
  private onPassageOpened(run: RenderableMysteryRun): void {
    const low = this.options.lowGraphics;
    this.invDirty = true;
    const pw = run.map.world?.passage;
    const w = pw ? run.map.walls.find((q) => q.id === pw.wallId) : undefined;
    if (!w) return;
    const n = low ? 10 : 26;
    const col = this.look.theme === 'archive' ? '#8a9a7a' : this.look.theme === 'crypt' ? '#a8987f' : '#8a96a8';
    for (let i = 0; i < n; i++) {
      const t = Math.random();
      this.particles.emit({ x: w.a.x + (w.b.x - w.a.x) * t, y: 0.1 + Math.random() * w.height * 0.5, z: w.a.z + (w.b.z - w.a.z) * t, vx: (Math.random() - 0.5) * 0.9, vy: 0.4 + Math.random() * 1.2, vz: (Math.random() - 0.5) * 0.9, life: 1.5, size: 0.55, grow: 2.4, color: col, alpha: 0.45, drag: 0.8 });
    }
    if (!this.options.reducedMotion) this.shake = Math.max(this.shake, 0.4);
  }

  /**
   * Hint level 3: the in-world hint Thing scuttles ~4 m from the player toward `target` and points at it for a few seconds.
   * Pass null to dismiss. The target is whatever the app's hint ladder computed (never read from the hidden layout here).
   */
  pointThing(target: Vec2 | null): void {
    if (!target) { this.hintT = Math.min(this.hintT, 0.45); return; }
    this.hintT = 5.5;
    this.hintTarget = { x: target.x, z: target.z };
    this.hintScale = 0;
    this.hintTravel = 0;
    const p = this.lastRun?.player;
    if (p) this.burst(p.x, 1.2, p.z, this.options.lowGraphics ? 5 : 12, '#e6d9ff', 1.8, 0.8);
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
    this.companion.update(dt, this.clock, p.x, p.z, this.bodyYaw, p.speed, (this.hydeShown && run.hyde.mode === 'CHASE') || this.crackChasing(run) ? 1 : 0, this.options.reducedMotion, this.camReady ? this.camYaw : this.bodyYaw, this.camReady ? this.camPos : null);
    // lantern follows the player
    this.lantern.position.set(p.x, 2.2, p.z);
    const rh = eff.revealHazards;
    const ln = this.look.lantern;
    // the flicker is the case's own: a calm archive lamp, a guttering crypt candle, a buzzing storm lantern (none under reduced motion)
    const fl = this.options.reducedMotion ? 1 : 1 - ln.flicker * 0.3 * (0.5 + 0.5 * Math.sin(this.clock * 13 + Math.sin(this.clock * 4.7) * 2.4)) * (0.6 + 0.4 * Math.sin(this.clock * 31));
    this.lantern.intensity = this.options.lowGraphics ? 0 : (rh ? 28 : ln.intensity) * fl * (p.hidden ? 0.55 : 1);
    this.lantern.color.set(rh ? 0x9ab8ff : ln.color);
    this.lantern.distance = rh ? 20 : ln.distance;
  }

  // ------------------------------------------------------------------------------------------------------ world
  private updateWorld(run: RenderableMysteryRun, eff: ReturnType<RenderableMysteryRun['effects']>, dt: number): void {
    const p = run.player;
    const L = this.look;
    const gateId = this.map.powerSwitch?.gateWallId;
    const gateOpen = gateId ? run.isWallOpen(gateId) : false;
    const pwId = this.map.world?.passage?.wallId;
    const passageOpen = pwId ? run.isWallOpen(pwId) : false;
    if (passageOpen !== this.passageWasOpen) { this.passageWasOpen = passageOpen; this.invDirty = true; }
    const carrying = run.egg.state === 'carried';
    const dToTower = Math.hypot(p.x - this.map.tower.x, p.z - this.map.tower.z);
    const near = dToTower < this.map.tower.radius + 3 ? 1 : 0;
    this.depositGlow = damp(this.depositGlow, (carrying ? 0.7 : 0.15) + near * 0.3 + (run.egg.state === 'delivered' ? 0.5 : 0), 4, dt);
    this.world.update({ dt, clock: this.clock, hiddenK: this.hideK, playerRoom: p.roomId, playerX: p.x, playerZ: p.z, gateOpen, passageOpen, switchPowered: eff.switchPowered, depositGlow: clamp(this.depositGlow, 0, 1.2), reduced: this.options.reducedMotion });
    // fog thickens inside fog rooms
    let target = L.fogDensity;
    const room = this.map.rooms.find((r) => r.id === p.roomId);
    if (room?.fog) target = L.roomFogDensity;
    this.fogNow = damp(this.fogNow, target, 1.6, dt);
    this.fog.density = this.fogNow;
    this.fx.uFogDensity.value = this.fogNow;
    this.fx.uTime.value = this.clock;
    this.fx.uClear.value.set(p.x, p.z, 4, 0);
    const wm = this.water.material as THREE.ShaderMaterial;
    if (wm.uniforms?.uTime) { wm.uniforms.uTime.value = this.clock; wm.uniforms.uAmp.value = L.theme === 'signal' ? 0.22 : 0.12; wm.uniforms.uAnimate.value = this.options.reducedMotion ? 0 : 1; }
    // lightning (storm case; never with reduced motion): brightens lights, fog and the cloud deck for a moment
    const lv = this.lightning.level(this.clock);
    this.lightLevel = lv;
    this.hemi.intensity = L.hemiIntensity * (1 + 1.0 * lv);
    this.moon.intensity = L.moonIntensity * (1 + 0.8 * lv);
    (this.sky.material as THREE.ShaderMaterial).uniforms.uFlashS.value = lv * 0.8;
    if (L.lightning) {
      this.fog.color.setHex(L.fogColor).lerp(this.tmpCol.setHex(0x8aa4d0), lv * 0.3);
      (this.scene.background as THREE.Color).copy(this.fog.color);
    }
    if (this.rainField) this.rainField.update(this.clock, this.camera.position, 0.55 + 0.25 * lv);
    // ambient motes (crypt dust, archive spores): a few slow particles around the player
    const m = L.motes;
    if (m && !this.showcase) {
      this.motesT += dt * m.rate * (this.options.lowGraphics ? 0.3 : this.options.reducedMotion ? 0.5 : 1);
      while (this.motesT >= 1) {
        this.motesT -= 1;
        const a = Math.random() * Math.PI * 2, d = 2 + Math.random() * 9;
        this.particles.emit({ x: p.x + Math.cos(a) * d, y: 0.3 + Math.random() * 2.4, z: p.z + Math.sin(a) * d, vx: (Math.random() - 0.5) * 0.15, vy: m.rise * (0.4 + Math.random()), vz: (Math.random() - 0.5) * 0.15, life: 4.5, size: 0.11, grow: 1, color: m.color, alpha: 0.4 });
      }
    }
    // searchlights follow the sim clock exactly
    if (this.searchlights) this.searchlights.update(run.t, dt, (id) => run.isWallOpen(id), this.options.reducedMotion, this.camera.position);
  }

  // ------------------------------------------------------------------------------------------------------ Hyde
  /** The Hyde is absent until the sim says he has emerged (feature-detected: older sims always show him). */
  private isEmerged(run: RenderableMysteryRun): boolean {
    if (typeof run.hydeEmerged === 'boolean') return run.hydeEmerged;
    if (typeof run.investigation === 'function') return run.investigation().hydeEmerged;
    return true;
  }

  private updateHyde(run: RenderableMysteryRun, eff: ReturnType<RenderableMysteryRun['effects']>, dt: number): void {
    const h = run.hyde;
    const calm = this.options.reducedMotion;
    const emerged = this.isEmerged(run);
    if (this.hydeWasEmerged === null) { this.hydeWasEmerged = emerged; this.riseK = emerged ? 1 : 0; }
    else if (emerged && !this.hydeWasEmerged) { if (!this.emerge) this.onEmerge(h.x, h.z, run); this.hydeWasEmerged = true; }
    else if (!emerged && this.hydeWasEmerged) { this.hydeWasEmerged = false; this.riseK = 0; }
    this.hydeShown = emerged && !this.showcase;
    if (emerged) {
      if (this.emerge) this.emerge.t += dt;
      this.riseK = Math.min(1, this.riseK + dt / 1.7);
      if (this.riseK < 1) {
        // mist keeps boiling around the spot while he climbs out
        const ex = this.emerge ?? { x: h.x, z: h.z };
        if (!this.options.lowGraphics || Math.floor(this.clock * 30) % 2 === 0) {
          const a = Math.random() * Math.PI * 2, d = Math.random() * 1.4;
          this.particles.emit({ x: ex.x + Math.cos(a) * d, y: 0.1, z: ex.z + Math.sin(a) * d, vx: Math.cos(a) * 0.4, vy: 0.6 + Math.random() * 0.7, vz: Math.sin(a) * 0.4, life: 1.5, size: 0.9, grow: 2.4, color: '#6a5a9a', alpha: 0.4, drag: 0.7 });
        }
      } else this.emerge = null;
    }
    const k = this.riseK;
    const ease = 1 - Math.pow(1 - k, 3);
    this.hyde.root.position.set(h.x, -(1 - ease) * 3.6, h.z);
    // outside the view frustum (and far from the lens) the creature is neither posed nor drawn; low graphics poses at half rate
    const hydeSeen = this.hydeShown && k > 0.02 && this.inView(h.x, 1.6, h.z, 4.6);
    this.hyde.root.visible = hydeSeen;
    this.hydeSpeedSm = damp(this.hydeSpeedSm, h.speed, 8, dt);
    this.hydeAcc += dt;
    const hydePose = hydeSeen && !(this.options.lowGraphics && (this.frameNo & 1));
    let lookYaw: number | null = null;
    const target = eff.lurePoint ?? h.lastKnown ?? h.target;
    if (target) lookYaw = wrapAngle(yawOf(target.x - h.x, target.z - h.z) - h.yaw);
    if (hydePose) this.hyde.update({
      dt: this.hydeAcc, clock: this.clock, mode: h.mode, speed: this.hydeSpeedSm, grabbing: h.grabbing, stunned: eff.hydeStunned, petrified: eff.hydePetrified && this.hydeVis !== 'pin',
      pinned: this.hydeVis === 'pin', slowed: eff.hydeSlowed, distracted: eff.hydeDistracted, suspicion: h.suspicion, lookYaw, bodyYaw: h.yaw, fade: this.hydeFade, reduced: calm,
    });
    if (hydePose) this.hydeAcc = 0; else if (!hydeSeen) this.hydeAcc = 0;
    // mode change bookkeeping (alert marker)
    if (h.mode !== this.hydeModePrev) { this.alertT = 1.6; this.hydeModePrev = h.mode; }
    this.alertT = Math.max(0, this.alertT - dt);
    const hw = this.hyde.headWorld;
    const live = this.hydeShown && k >= 1;
    const showX = live && (h.mode === 'CHASE' || h.grabbing);
    const showQ = live && !showX && (h.mode === 'INVESTIGATE_SOUND' || h.mode === 'SEARCH' || (h.mode === 'PATROL' && h.suspicion > 0.4));
    const bob = calm ? 0 : Math.sin(this.clock * 6) * 0.06;
    const pulse = 0.85 + 0.15 * Math.sin(this.clock * 8);
    this.alertX.visible = showX;
    this.alertQ.visible = showQ;
    if (showX) { this.alertX.position.set(hw.x, hw.y + 1.35 + bob, hw.z); this.alertX.scale.setScalar(1.15 * pulse); (this.alertX.material as THREE.SpriteMaterial).opacity = 1; }
    if (showQ) { this.alertQ.position.set(hw.x, hw.y + 1.35 + bob, hw.z); this.alertQ.scale.setScalar(0.95); (this.alertQ.material as THREE.SpriteMaterial).opacity = clamp(0.55 + h.suspicion * 0.6, 0, 1); }
  }

  // ------------------------------------------------------------------------------------------------------ Crackstone
  private crackChasing(run: RenderableMysteryRun): boolean {
    const c = run.crackstone;
    return !!c && this.crackShown && (c.mode === 'CHASE' || c.mode === 'ATTACK');
  }

  private ensureCrackstone(run: RenderableMysteryRun): void {
    if (run.crackstone && !this.crack) {
      this.crack = new CrackstoneRig();
      this.scene.add(this.crack.root);
      this.warmUp(); // his shaders + the telegraphs are compiled now (while the world is loading), not at the first scan / curse
    } else if (!run.crackstone && this.crack) this.removeCrackstone();
  }

  /**
   * Compiles every shader program the scene can need BEFORE play: renderer.compile walks all materials (visible or not), and each
   * lit material is compiled in both its opaque and its transparent form (fading characters / companion toggle `transparent`, which is
   * part of the program key). Without this the first fade of the companion, Hyde or Crackstone compiled a program mid-game (a 100-200 ms hitch).
   */
  private warmUp(): void {
    if (this.disposed) return;
    const mats = new Set<THREE.Material>();
    this.scene.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
      if (!m) return;
      for (const x of Array.isArray(m) ? m : [m]) if (!(x as THREE.ShaderMaterial).isShaderMaterial && !x.transparent) mats.add(x);
    });
    try {
      this.renderer.compile(this.scene, this.camera);
      for (const m of mats) { m.transparent = true; m.needsUpdate = true; }
      this.renderer.compile(this.scene, this.camera);
      for (const m of mats) { m.transparent = false; m.needsUpdate = true; }
      this.renderer.compile(this.scene, this.camera);
    } catch { /* compile is best-effort */ }
    this.warmCompanionVisual = this.companion?.visual ?? '';
    this.programsAfterWarm = this.renderer.info.programs?.length ?? 0;
  }

  private warmCompanionVisual = '';
  private programsAfterWarm = 0;

  private removeCrackstone(): void {
    if (!this.crack) return;
    this.scene.remove(this.crack.root);
    this.crack.dispose();
    this.crack = null;
    this.crackShown = false;
    this.crackOnScreen = false;
    this.scanFx.phase = 'off';
    this.curseFx.on = false;
    this.scanTg.hide(); this.curseTg.hide();
    this.alertQc.visible = this.alertXc.visible = false;
  }

  /** The scan pulse: a flash of the ring plus a ring of embers (no white flash with reduced motion). */
  private startScanPulse(x: number, z: number, r: number): void {
    const fx = this.scanFx;
    fx.phase = 'pulse'; fx.t = 0; fx.prog = 1; fx.x = x; fx.z = z; fx.r = r;
    this.scanStamp = this.lastRun?.t ?? 0;
    const low = this.options.lowGraphics, calm = this.options.reducedMotion;
    const n = low ? 10 : 26;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      this.particles.emit({ x: x + Math.cos(a) * r, y: 0.15, z: z + Math.sin(a) * r, vx: Math.cos(a) * 1.2, vy: 1.2 + Math.random(), vz: Math.sin(a) * 1.2, life: 0.9, size: 0.3, grow: 1.2, color: i % 3 ? CRACK_GREEN : CRACK_GREEN_HI, alpha: 0.9, drag: 1.2 });
    }
    if (!calm) this.setFlash(0.6, 1, 0.4, 0.06);
  }

  private updateCrackstone(run: RenderableMysteryRun, eff: ReturnType<RenderableMysteryRun['effects']>, dt: number): void {
    this.ensureCrackstone(run);
    const c = run.crackstone;
    const rig = this.crack;
    if (!c || !rig) { this.crackShown = false; this.alertQc.visible = this.alertXc.visible = false; return; }
    const calm = this.options.reducedMotion;
    this.crackShown = run.status !== 'tutorial' && !this.showcase;
    this.crackSpeedSm = damp(this.crackSpeedSm, c.speed, 8, dt);
    rig.root.position.set(c.x, 0, c.z);
    const crackSeen = this.crackShown && this.inView(c.x, 1.3, c.z, 3.4);
    rig.root.visible = crackSeen;
    this.crackAcc += dt;
    const crackPose = crackSeen && !(this.options.lowGraphics && (this.frameNo & 1));
    // ---- telegraph state, from the PUBLIC runtime (sim time run.t) with local timers for the pulse / burst / fade
    const fx = this.scanFx, sc = c.scan;
    if (sc) {
      fx.x = c.x; fx.z = c.z; fx.r = sc.radiusM;
      if (sc.phase === 'warning') { fx.phase = 'warning'; fx.prog = clamp((run.t - sc.startedAt) / Math.max(0.05, sc.pulseAt - sc.startedAt), 0, 1); fx.t = 0; }
      else if (run.t - this.scanStamp > 0.5 && fx.phase !== 'pulse') this.startScanPulse(c.x, c.z, sc.radiusM);
      else fx.t += dt;
    } else if (fx.phase === 'warning') { fx.phase = 'fade'; fx.t = 0; }
    else if (fx.phase !== 'off') fx.t += dt;
    if ((fx.phase === 'pulse' && fx.t > 0.5) || (fx.phase === 'fade' && fx.t > 0.4)) fx.phase = 'off';
    const cf = this.curseFx, cu = c.curse;
    if (cu && cu.landsAt !== cf.resolvedAt) {
      cf.on = true; cf.x = cu.x; cf.z = cu.z; cf.r = cu.radiusM; cf.landsAt = cu.landsAt; cf.mode = 0; cf.t = 0;
      cf.prog = clamp((run.t - cu.startedAt) / Math.max(0.05, cu.landsAt - cu.startedAt), 0, 1);
    } else if (cf.on && cf.mode === 0) { cf.mode = 2; cf.t = 0; cf.resolvedAt = cf.landsAt; } // cancelled (stun / lure / deferral): fade
    else if (cf.on) { cf.t += dt; if (cf.t > (cf.mode === 1 ? 0.7 : 0.6)) cf.on = false; }
    // ---- body
    let lookYaw: number | null = null;
    const target = eff.lurePoint && eff.crackstoneDistracted ? eff.lurePoint : c.lastKnown ?? c.target;
    if (target) lookYaw = wrapAngle(yawOf(target.x - c.x, target.z - c.z) - c.yaw);
    if (crackPose) rig.update({
      dt: this.crackAcc, clock: this.clock, mode: c.mode, speed: this.crackSpeedSm, stunned: eff.crackstoneStunned, petrified: eff.crackstonePetrified && this.crackVis !== 'pin',
      pinned: this.crackVis === 'pin', slowed: eff.crackstoneSlowed, distracted: eff.crackstoneDistracted, suspicion: c.suspicion, lookYaw, bodyYaw: c.yaw, fade: this.crackFade,
      reduced: calm, scan: sc ? sc.phase : null, scanK: fx.prog, curseK: cf.on && cf.mode === 0 ? cf.prog : -1,
    });
    if (crackPose || !crackSeen) this.crackAcc = 0;
    if (c.mode !== this.crackModePrev) { this.crackAlertT = 1.6; this.crackModePrev = c.mode; }
    this.crackAlertT = Math.max(0, this.crackAlertT - dt);
    const hw = rig.headWorld;
    const showX = this.crackShown && (c.mode === 'CHASE' || c.mode === 'ATTACK');
    const showQ = this.crackShown && !showX && (c.mode === 'INVESTIGATE' || c.mode === 'SEARCH' || (c.mode === 'PATROL' && c.suspicion > 0.4));
    const bob = calm ? 0 : Math.sin(this.clock * 6) * 0.06;
    this.alertXc.visible = showX;
    this.alertQc.visible = showQ;
    if (showX) { this.alertXc.position.set(hw.x, hw.y + 0.85 + bob, hw.z); this.alertXc.scale.setScalar(1.1 * (0.85 + 0.15 * Math.sin(this.clock * 8))); (this.alertXc.material as THREE.SpriteMaterial).opacity = 1; }
    if (showQ) { this.alertQc.position.set(hw.x, hw.y + 0.85 + bob, hw.z); this.alertQc.scale.setScalar(0.95); (this.alertQc.material as THREE.SpriteMaterial).opacity = clamp(0.55 + c.suspicion * 0.6, 0, 1); }
  }

  /** Crackstone's glows, aura embers, status effects and the two telegraphs (scan ring, curse circle). */
  private crackVfx(run: RenderableMysteryRun, eff: ReturnType<RenderableMysteryRun['effects']>, dt: number, glows: GlowSet, rings: RingField, gc: THREE.Color): void {
    const c = run.crackstone, rig = this.crack;
    if (!c || !rig) { this.scanTg.hide(); this.curseTg.hide(); return; }
    const T = this.clock, calm = this.options.reducedMotion, low = this.options.lowGraphics;
    // ---- telegraphs
    const fx = this.scanFx;
    if (fx.phase === 'off') this.scanTg.hide();
    else {
      const base = { x: fx.x, z: fx.z, r: fx.r, prog: fx.prog, out: 0, mode: 0, time: T, reduced: calm, alpha: 1 };
      if (fx.phase === 'warning') this.scanTg.set(base, calm ? fx.r : fx.r * fx.prog);
      else if (fx.phase === 'pulse') this.scanTg.set({ ...base, prog: 1, out: clamp(1 - fx.t / 0.5, 0, 1) }, fx.r);
      else this.scanTg.set({ ...base, alpha: clamp(1 - fx.t / 0.4, 0, 1) }, fx.r * fx.prog);
    }
    const cf = this.curseFx;
    if (!cf.on) this.curseTg.hide();
    else this.curseTg.set({ x: cf.x, z: cf.z, r: cf.r, prog: cf.prog, out: cf.mode === 0 ? 0 : clamp(1 - cf.t / (cf.mode === 1 ? 0.7 : 0.6), 0, 1), mode: cf.mode, time: T, reduced: calm, alpha: 1 }, cf.r);
    if (!this.crackShown) return;
    // ---- aura: a dim witch-green glow behind him (so the dark coat reads against the night), his eyes, a faint sigil underfoot, a few embers
    const fl = rig.flare;
    const stone = rig.stoneAmount > 0.5;
    const a = (1 - this.crackFade) * (stone ? 0.35 : 1);
    const awayX = c.x - this.camera.position.x, awayZ = c.z - this.camera.position.z;
    const al = Math.hypot(awayX, awayZ) || 1;
    glows.add(c.x + (awayX / al) * 1.6, 1.35, c.z + (awayZ / al) * 1.6, 5.0 + fl * 3.2, gc.set(eff.crackstoneSlowed ? '#6ac8f0' : CRACK_GREEN), (0.17 + 0.3 * fl) * a);
    if (!stone) {
      const esz = 0.32 * rig.look.eyeScale * clamp(this.camera.position.distanceTo(rig.headWorld) / 8, 0.4, 1.3);
      if (rig.root.visible) {
        glows.add(rig.eyeL.x, rig.eyeL.y, rig.eyeL.z, esz, rig.look.eyeColor, 0.9 * a);
        glows.add(rig.eyeR.x, rig.eyeR.y, rig.eyeR.z, esz, rig.look.eyeColor, 0.9 * a);
      }
      rings.push(c.x, 0.1, c.z, 0.95 + (calm ? 0 : 0.06 * Math.sin(T * 2.1)), CRACK_GREEN, 0.12 + 0.3 * fl);
      this.crackEmber += dt * (low ? 1.2 : calm ? 1.8 : 3.2) * (1 + fl * 2.5);
      while (this.crackEmber >= 1) {
        this.crackEmber -= 1;
        const an = Math.random() * Math.PI * 2, rr = 0.25 + Math.random() * 0.5;
        this.particles.emit({ x: c.x + Math.cos(an) * rr, y: 0.4 + Math.random() * 1.6, z: c.z + Math.sin(an) * rr, vx: (Math.random() - 0.5) * 0.25, vy: 0.45 + Math.random() * 0.5, vz: (Math.random() - 0.5) * 0.25, life: 1.9, size: 0.085, grow: 0.7, color: Math.random() < 0.6 ? CRACK_GREEN : CRACK_GREEN_HI, alpha: 0.85 });
      }
    }
    // ---- status effects (the Hyde's looks)
    const hw = rig.headWorld;
    if (eff.crackstoneDistracted && !eff.crackstonePetrified) {
      for (let i = 0; i < 4; i++) {
        const an = T * 3 + (i / 4) * Math.PI * 2;
        glows.add(hw.x + Math.cos(an) * 0.5, hw.y + 0.55 + Math.sin(an * 2) * 0.1, hw.z + Math.sin(an) * 0.5, 0.4, gc.set(i % 2 ? '#ffe08a' : '#c9a2ff'), 0.9);
      }
    }
    if (this.crackVis === 'pin' && eff.crackstoneStunned) {
      for (let i = 0; i < 12; i++) {
        const an = T * 0.8 + (i / 12) * Math.PI * 2;
        const lvl = i % 3;
        glows.add(c.x + Math.cos(an) * (0.55 + lvl * 0.1), 0.4 + lvl * 0.7, c.z + Math.sin(an) * (0.55 + lvl * 0.1), 0.42, gc.set('#8affc8'), 0.85);
      }
      rings.push(c.x, 0.12, c.z, 1.3, '#8affc8', 0.7);
      rings.push(c.x, 0.12, c.z, 0.85, '#c8fff0', 0.5);
    }
    if (eff.crackstoneStunned && !eff.crackstonePetrified && this.crackVis !== 'pin') {
      const rnd = this.rnd, body = rig.chestWorld;
      for (let i = 0; i < 3; i++) {
        const an = rnd() * Math.PI * 2;
        this.tmp.set(body.x + Math.cos(an) * 0.3, body.y + 1.2 + rnd() * 0.5, body.z + Math.sin(an) * 0.3);
        this.tmp2.set(c.x + Math.cos(an + 0.8) * (0.7 + rnd() * 0.6), 0.05, c.z + Math.sin(an + 0.8) * (0.7 + rnd() * 0.6));
        this.bolts.bolt(this.tmp, this.tmp2, 5, 0.4, 0.05, gc.set('#bfe8ff'), this.camera.position, rnd);
      }
      glows.add(body.x, body.y + 0.3, body.z, 2.6, gc.set('#bfe8ff'), 0.35 + 0.3 * Math.sin(T * 40));
    }
    if (eff.crackstoneSlowed) {
      rings.push(c.x, 0.1, c.z, 1.2, '#cfeaff', 0.6);
      rings.push(c.x, 0.1, c.z, 0.8, '#8fd8ff', 0.5);
      if (!low && Math.random() < 0.5) this.particles.emit({ x: c.x + (Math.random() - 0.5) * 1.2, y: 2.2 + Math.random() * 0.6, z: c.z + (Math.random() - 0.5) * 1.2, vy: -1.2, life: 1.1, size: 0.2, grow: 0.7, color: '#dff4ff', alpha: 0.9 });
    }
    if (eff.crackstonePetrified && !low && Math.random() < 0.4) {
      this.particles.emit({ x: c.x + (Math.random() - 0.5) * 1.0, y: 0.4 + Math.random() * 2.0, z: c.z + (Math.random() - 0.5) * 1.0, vy: -0.4, life: 1.0, size: 0.14, grow: 0.5, color: '#b8bcc8', alpha: 0.7 });
    }
  }

  // ------------------------------------------------------------------------------------------------------ Thing
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
        else { pose = 'point'; face = this.map.playerStart.yaw; } // into the island: a direction, never a clue
      }
    } else if (d < 4.5) pose = 'thumbsUp';
    else if (d > 12) pose = 'tap';
    this.thing.setPose(pose);
    this.thing.root.rotation.y = angleLerp(this.thing.root.rotation.y, face, 1 - Math.exp(-6 * dt));
    this.thingAcc += dt;
    const thingSeen = this.inView(th.x, th.y + 1.2, th.z, 3);
    this.thing.root.visible = thingSeen;
    if (thingSeen && !(this.options.lowGraphics && (this.frameNo & 1))) { this.thing.update(this.thingAcc, this.clock); this.thingAcc = 0; } else if (!thingSeen) this.thingAcc = 0;
    // hint Thing: appears beside the player, scuttles toward the hint target and points
    if (this.hintT > 0) {
      this.hintT -= dt;
      this.hintScale = damp(this.hintScale, this.hintT > 0.5 ? 1.9 : 0, 7, dt);
      this.hintTravel = damp(this.hintTravel, this.hintT > 0.5 ? 1 : 0, 2.0, dt);
      const f = fwdOf(p.yaw);
      const r = { x: -f.z, z: f.x };
      const sx = p.x + f.x * 1.3 - r.x * 1.1, sz = p.z + f.z * 1.3 - r.z * 1.1;
      const tg = this.hintTarget;
      let hx = sx, hz = sz, face = p.yaw;
      let moving = false;
      if (tg) {
        const d = Math.hypot(tg.x - p.x, tg.z - p.z) || 1;
        const run4 = Math.min(4, Math.max(0, d - 1.5));
        const k = 1 - Math.pow(1 - clamp(this.hintTravel, 0, 1), 2);
        hx = sx + ((tg.x - p.x) / d) * run4 * k;
        hz = sz + ((tg.z - p.z) / d) * run4 * k;
        face = yawOf(tg.x - hx, tg.z - hz);
        moving = this.hintTravel < 0.93 && this.hintT > 0.5;
      }
      this.thingHint.root.position.set(hx, moving && !this.options.reducedMotion ? Math.abs(Math.sin(this.clock * 16)) * 0.08 : 0, hz);
      this.thingHint.root.rotation.y = angleLerp(this.thingHint.root.rotation.y, face, 1 - Math.exp(-10 * dt));
      this.thingHint.setPose(moving ? 'tap' : 'point');
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
    // the egg is drawn only once the player may know where it is (seen / revealed / near); carried and dropped eggs always
    this.eggShown = this.view.eggVisible(run, eff);
    egg.root.visible = this.eggShown;
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
      // a resting egg sits on the prop of the site it was placed at (nest / altar / planter ...)
      const base = e.state === 'resting' ? this.view.restHeight(e.x, e.z) - 0.27 : 0.05;
      egg.root.position.set(e.x, base + bounce + (e.state === 'resting' && !calm ? Math.sin(this.clock * 1.4) * 0.03 : 0), e.z);
      egg.root.rotation.set(0, calm ? 0 : this.clock * 0.4, e.state === 'dropped' ? 0.32 : 0);
    }
    egg.cracks.visible = e.security < 70;
    const secDim = clamp(e.security / 100, 0.35, 1);
    egg.mat.emissiveIntensity = 0.6 + 0.6 * secDim * (eff.revealEgg ? 1.6 : 1);
  }

  // ------------------------------------------------------------------------------------------------------ camera
  /** Sphere (centre x, y, z, radius) against last frame's view frustum: an object outside it is neither posed nor drawn. */
  private inView(x: number, y: number, z: number, r: number): boolean {
    return this.frustum.intersectsSphere(this.sph.set(this.tmp2.set(x, y, z), r));
  }

  private blockedAt(x: number, y: number, z: number, run: RenderableMysteryRun): boolean {
    void run;
    if (y < 0.35) return true;
    for (const w of this.nearWalls) {
      if (y < w.h + 0.1 && distPointSeg(x, z, w.ax, w.az, w.bx, w.bz) < w.r + 0.28) return true;
    }
    for (const c of this.nearCover) {
      if (c.top <= 1.05 && y > 1.2) continue;
      if (y < c.top && Math.hypot(x - c.x, z - c.z) < c.r + 0.28) return true;
    }
    return false;
  }

  /** Walls / cover within reach of the camera rig this frame (closed walls only): the per-step collision test scans these, not the island. */
  private refreshNearGeometry(run: RenderableMysteryRun): void {
    const p = run.player;
    const R = 11;
    this.nearWalls.length = 0;
    for (const w of this.map.walls) {
      if (distPointSeg(p.x, p.z, w.a.x, w.a.z, w.b.x, w.b.z) > R + w.thickness / 2) continue;
      if (run.isWallOpen(w.id)) continue;
      this.nearWalls.push({ ax: w.a.x, az: w.a.z, bx: w.b.x, bz: w.b.z, r: w.thickness / 2, h: w.height });
    }
    this.nearCover.length = 0;
    for (const c of this.map.cover) {
      if (Math.hypot(c.x - p.x, c.z - p.z) > R + c.radius) continue;
      this.nearCover.push({ x: c.x, z: c.z, r: c.radius, top: c.height === 'high' ? (c.kind === 'tree' ? 5.4 : 2.5) : 1.05 });
    }
  }

  private updateCamera(run: RenderableMysteryRun, dt: number): void {
    const p = run.player;
    const h = run.hyde;
    const calm = this.options.reducedMotion;
    this.refreshNearGeometry(run);
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
      const hit = this.world.solidHit(p.x, this.pivotY, p.z, cosY, 0, -sinY, shoulder + 0.3);
      if (hit < shoulder + 0.3) shoulder = Math.max(0, hit - 0.3);
    }
    const walking = p.speed > 0.4 && !calm;
    this.camBob = walking ? this.camBob + dt * (p.stance === 'sprint' ? 11 : 7.5) : this.camBob;
    const bobY = walking ? Math.sin(this.camBob) * 0.014 : 0;
    const pivotX = p.x + cosY * shoulder, pivotZ = p.z - sinY * shoulder, pivotY = this.pivotY + bobY;
    // desired distance (wider when sprinting or chased), shortened by the nearest obstruction
    const hs = this.hydeShown;
    const cr = this.crackShown ? run.crackstone ?? null : null;
    const crChase = !!cr && (cr.mode === 'CHASE' || cr.mode === 'ATTACK') && Math.hypot(cr.x - p.x, cr.z - p.z) < 14;
    const chased = (hs && h.mode === 'CHASE' && Math.hypot(h.x - p.x, h.z - p.z) < 14) || crChase;
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
        let t = this.world.solidHit(pivotX + ox, pivotY + oy, pivotZ + oz, bx, by, bz, want + 0.4, 0.02);
        if (!p.hidden) t = Math.min(t, this.world.occHide.firstHit(pivotX + ox, pivotY + oy, pivotZ + oz, bx, by, bz, want + 0.4, 0.02));
        if (t < free + 0.3) free = Math.min(free, Math.max(0.9, t - 0.3));
      }
    }
    // never put the lens inside the Hyde: slide toward the player until clear
    let dist = Math.min(want, free);
    this.hydeFade = 0;
    const hy = HYDE_CHEST_Y;
    for (let it = 0; it < 6 && hs; it++) {
      const cx = pivotX + bx * dist, cy = pivotY + by * dist, cz = pivotZ + bz * dist;
      const dh = Math.hypot(cx - h.x, cy - hy, cz - h.z);
      if (dh >= 2.7 || dist <= 1.9) break; // the crouching Hyde is ~3.7 m long
      dist = Math.max(1.9, dist - (2.7 - dh) * 0.9);
    }
    if (hs) {
      const cx = pivotX + bx * dist, cy = pivotY + by * dist, cz = pivotZ + bz * dist;
      const dh = Math.hypot(cx - h.x, cy - hy, cz - h.z);
      this.hydeFade = smoothstep(3.8, 2.3, dh) * 0.75;
    }
    // never put the lens inside Crackstone's cloak either (he is ~2.4 m tall and wide): same slide-and-fade rule
    this.crackFade = 0;
    if (cr) {
      for (let it = 0; it < 6; it++) {
        const cx = pivotX + bx * dist, cy = pivotY + by * dist, cz = pivotZ + bz * dist;
        const dc = Math.hypot(cx - cr.x, cz - cr.z);
        if (dc >= 1.5 || dist <= 1.9 || cy > 2.8) break;
        dist = Math.max(1.9, dist - (1.5 - dc) * 0.9);
      }
      const cx = pivotX + bx * dist, cy = pivotY + by * dist, cz = pivotZ + bz * dist;
      if (cy < 2.8) this.crackFade = smoothstep(2.7, 1.4, Math.hypot(cx - cr.x, cz - cr.z)) * 0.75;
    }
    // last line of defence: the straight line from the final lens position to the player's head must be clear of solid geometry
    for (let it = 0; it < 4; it++) {
      const cx = pivotX + bx * dist, cy = Math.max(0.45, pivotY + by * dist), cz = pivotZ + bz * dist;
      const hx = p.x - cx, hy = pivotY - 0.1 - cy, hz = p.z - cz;
      const hl = Math.hypot(hx, hy, hz) || 1;
      let t = this.world.solidHit(cx, cy, cz, hx / hl, hy / hl, hz / hl, hl - 0.25, 0.0);
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
    const hChase = hs && (h.mode === 'CHASE' || h.grabbing);
    const eT = !hChase && crChase && cr ? cr : h; // whichever enemy is chasing
    const hdx = eT.x - pivotX, hdz = eT.z - pivotZ;
    const along = hdx * sinY + hdz * cosY;
    const lat = hdx * cosY - hdz * sinY;
    const near = (hChase || crChase) && along > -1.5 && along < this.camDist + 3.5 && Math.abs(lat) < 3.4 && Math.hypot(hdx, hdz) < 16;
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
    this.frustum.setFromProjectionMatrix(this.frustumM.multiplyMatrices(this.camera.projectionMatrix, this.camera.matrixWorldInverse));
    this.lastDebugCam = { yaw: this.camYaw, pitch: this.camPitch, dist: this.camDist };
    // the companion fades when it would sit between the lens and the player, covers the crosshair / screen centre, or is near the lens
    {
      const c = this.companion.position;
      const cx = this.camPos.x, cy = this.camPos.y, cz = this.camPos.z;
      const tx = p.x - cx, ty = pivotY - 0.2 - cy, tz = p.z - cz;
      const tl2 = tx * tx + ty * ty + tz * tz || 1;
      const u = clamp(((c.x - cx) * tx + (c.y - cy) * ty + (c.z - cz) * tz) / tl2, 0, 1);
      const lx = cx + tx * u - c.x, ly = cy + ty * u - c.y, lz = cz + tz * u - c.z;
      const off = Math.hypot(lx, ly, lz);
      const lens = Math.hypot(c.x - cx, c.y - cy, c.z - cz);
      const blocking = (1 - smoothstep(0.55 + 0.25 * this.companion.sizeK, 1.35 + 0.25 * this.companion.sizeK, off)) * (u < 0.98 ? 1 : 0);
      // angle between the view axis and the direction to the companion: inside ~11 deg it covers the screen centre
      const dx = c.x - cx, dy = c.y - cy, dz = c.z - cz;
      const fl = Math.hypot(look.x, look.y, look.z) || 1;
      const cosA = (dx * look.x + dy * look.y + dz * look.z) / ((lens || 1) * fl);
      const ang = Math.acos(clamp(cosA, -1, 1));
      const centre = (1 - smoothstep(0.1, 0.26, ang)) * (lens < tl2 ** 0.5 + 1.2 ? 1 : 0.4);
      this.companion.setFade(Math.max(blocking, 1 - smoothstep(1.9, 3.1, lens), centre * 0.85));
    }
    // Hyde projection (for the debug state, the off-screen warning glow and HUD)
    this.ndc.set(h.x, hy, h.z).project(this.camera);
    this.hydeOnScreen = hs && this.ndc.z < 1 && this.ndc.z > -1 && Math.abs(this.ndc.x) < 0.98 && Math.abs(this.ndc.y) < 0.98;
    const rel = this.tmp2.set(h.x, hy, h.z).applyMatrix4(this.camera.matrixWorldInverse);
    const l = Math.hypot(rel.x, rel.y) || 1;
    this.hydeEdge = { x: rel.x / l, y: rel.y / l, s: 0 };
    if (cr) {
      this.crackNdc.set(cr.x, 1.4, cr.z).project(this.camera);
      this.crackOnScreen = this.crackNdc.z < 1 && this.crackNdc.z > -1 && Math.abs(this.crackNdc.x) < 0.98 && Math.abs(this.crackNdc.y) < 0.98;
      const rc = this.tmp2.set(cr.x, 1.4, cr.z).applyMatrix4(this.camera.matrixWorldInverse);
      const lc = Math.hypot(rc.x, rc.y) || 1;
      this.crackEdge = { x: rc.x / lc, y: rc.y / lc };
    } else this.crackOnScreen = false;
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
    let tgt = this.hydeShown ? base[h.mode] * (0.45 + 0.55 * prox) + h.suspicion * 0.22 * prox : 0;
    if (eff.hydeStunned || eff.hydePetrified) tgt *= 0.3;
    const hydeTgt = tgt;
    const cr = this.crackShown ? run.crackstone ?? null : null;
    let crEdge = 0;
    if (cr) {
      const cdist = Math.hypot(cr.x - p.x, cr.z - p.z);
      const cprox = clamp(1 - cdist / 26, 0, 1);
      const cbase: Record<CrackstoneMode, number> = { PATROL: 0, INVESTIGATE: 0.2, SEARCH: 0.26, CHASE: 0.75, ATTACK: 0.85, RETURN: 0.1 };
      let ct = cbase[cr.mode] * (0.45 + 0.55 * cprox) + cr.suspicion * 0.2 * cprox;
      if (eff.crackstoneStunned || eff.crackstonePetrified) ct *= 0.3;
      tgt = Math.max(tgt, ct);
      if (!this.crackOnScreen && (cr.mode === 'CHASE' || cr.mode === 'ATTACK')) crEdge = clamp(1.1 - cdist / 24, 0.25, 1);
    }
    this.threat = damp(this.threat, clamp(tgt, 0, 1), 4, dt);
    this.crackMix = damp(this.crackMix, tgt > hydeTgt + 1e-4 ? 1 : 0, 4, dt);
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
    const matters = this.hydeShown && h.mode === 'CHASE' || ((h.mode === 'SEARCH' || h.mode === 'INVESTIGATE_SOUND') && dist < 14) || h.grabbing;
    const edge = !this.hydeOnScreen && matters ? clamp(1.1 - dist / 24, 0.25, 1) : 0;
    u.uCrack.value = this.crackMix;
    if (crEdge > edge) {
      u.uEdge.value.set(this.crackEdge.x, this.crackEdge.y, crEdge);
      u.uEdgeCrack.value = 1;
    } else {
      u.uEdge.value.set(this.hydeEdge.x, this.hydeEdge.y, edge);
      u.uEdgeCrack.value = 0;
    }
    this.overlay.mesh.visible = this.threat > 0.004 || this.hideK > 0.004 || this.flash > 0.004 || this.dimK > 0.004 || edge > 0.004 || crEdge > 0.004;
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
    const gc = this.gcTmp;

    // ---- noise rings: only egg drops, impacts, decoys and hazard alarms, one modest ring each (never footsteps / searching)
    for (const n of this.noise) n.age += dt;
    this.noise = this.noise.filter((n) => n.age < n.life);
    for (const n of this.noise) {
      const t = n.age / n.life;
      const grow = 1 - Math.pow(1 - t, 2.2);
      rings.push(n.x, 0.1, n.z, n.r * grow, n.color, Math.pow(1 - t, 1.3) * (0.25 + 0.55 * n.loud));
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
      if (d > 8) continue; // nothing is drawn for far-away hiding spots
      const near = 1 - smoothstep(2.5, 8, d);
      const inside = p.hidden && d < hs.radius + 0.6;
      const pulse = calm ? 1 : 0.8 + 0.2 * Math.sin(T * 2.4 + hs.x);
      rings.push(hs.x, 0.1, hs.z, hs.radius * 1.15, inside ? '#8affc8' : '#b79cff', (inside ? 0.9 : 0.12 + near * 0.55) * pulse);
      if (near > 0.2 && !inside) rings.push(hs.x, 0.1, hs.z, hs.radius * 0.7, '#b79cff', near * 0.35 * pulse);
      if (near > 0.15) glows.add(hs.x, 0.9, hs.z, 1.8 + near * 0.8, gc.set('#b79cff'), near * 0.35 * pulse);
    }

    // ---- investigation: site props' clue items / outlines / searched cues / glints (investigationView.ts). The hidden truth is only
    //      read there for known / revealed / near-range clues, so nothing visible tells which candidate site is real.
    const it = run.interactable();
    {
      const fi = this.invDirty;
      this.invDirty = false;
      const sc = run.tuning as { investigation?: { siteCheckM?: number } } | undefined;
      this.view.setRevealRange(sc?.investigation?.siteCheckM);
      this.view.update(run, eff, { dt, T, calm, low, glows, beams, gc, it }, fi);
    }
    // search progress: a gathering sparkle at the thing being searched (clue site / examine / lever / egg)
    if (it && it.progress > 0.02 && this.view.reachPos && !calm) {
      const pr = clamp(it.progress, 0, 1), rp = this.view.reachPos;
      const a = T * 8;
      this.particles.emit({ x: rp.x + Math.cos(a) * 0.7 * (1 - pr), y: rp.y + 0.2 + pr * 0.8, z: rp.z + Math.sin(a) * 0.7 * (1 - pr), vy: 0.8, life: 0.5, size: 0.22, grow: 0.8, color: '#ffe9a0', alpha: 0.9 });
    }
    if (it && it.progress > 0.02 && this.view.reachPos) glows.add(this.view.reachPos.x, this.view.reachPos.y + 0.6, this.view.reachPos.z, 2.0 + clamp(it.progress, 0, 1) * 1.6, gc.set('#ffe9a0'), 0.35 + 0.4 * clamp(it.progress, 0, 1));

    // ---- clues revealed by an ability: halo, beam, ring and a sparkle trail from the player (the one place the truth is shown on purpose)
    const revealed = new Set<ClueId>(eff.revealedClues);
    let clueIdx = 0;
    for (const c of run.map.clues) {
      if (run.cluesFound.includes(c.clueId) || !revealed.has(c.clueId)) continue;
      const site = this.view.sitePose(c.x, c.z);
      const y = site ? site.itemY : 0.55;
      glows.add(c.x, y + 0.05, c.z, 2.6, gc.set('#bfe8ff'), 0.9);
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
      clueIdx++;
    }

    // ---- egg: glow by tier, beam when revealed or lying dropped, delivery flourish
    const eggPos = this.egg.root.position;
    const tierCol = eggHex(e.tier);
    const tierSize = e.tier === 'legendary' ? 2.3 : e.tier === 'rare' ? 1.8 : 1.4;
    if (e.state === 'carried') {
      // the egg is held in front of the body, hidden from a behind-the-shoulder lens: halo the carrier in the tier colour (no ground ring)
      const hp = 0.8 + (calm ? 0 : Math.sin(T * 3.1) * 0.1);
      glows.add(p.x, p.crouched ? 0.8 : 1.15, p.z, 2.6 * hp, gc.set(tierCol), 0.32);
    }
    if (!this.eggShown) {
      // unknown egg: no glow, no beam
    } else if (e.state !== 'delivered' || this.eggDeliverT < 0) {
      const pulse = calm ? 1 : 0.85 + 0.15 * Math.sin(T * 3.1);
      glows.add(eggPos.x, eggPos.y + 0.3, eggPos.z, tierSize * pulse * (eff.revealEgg ? 1.8 : 1), gc.set(tierCol), (e.state === 'carried' ? 0.55 : 0.8) * clamp(e.security / 100, 0.4, 1));
    } else {
      glows.add(eggPos.x, eggPos.y + 0.3, eggPos.z, tierSize * 2.2, gc.set(tierCol), 0.9);
    }
    if (this.eggShown && (e.state === 'resting' || e.state === 'dropped')) {
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
    this.eggShield.visible = eff.eggShield && e.state !== 'delivered' && this.eggShown;
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
      if (b.from === 'player' && (b.to === 'hyde' || b.to === 'crack')) {
        const tgt = b.to === 'crack' && run.crackstone ? run.crackstone : h;
        this.tmp.set(p.x, 1.35, p.z);
        this.tmp2.set(tgt.x, b.to === 'crack' ? 1.6 : HYDE_CHEST_Y, tgt.z);
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
      const a = this.hyde.stoneAmount > 0.5 || !this.hydeShown || !this.hyde.root.visible ? 0 : smoothstep(0.5, 1, this.riseK);
      const esz = 0.2 * this.hyde.look.eyeScale * clamp(this.camera.position.distanceTo(this.hyde.headWorld) / 8, 0.4, 1.3);
      glows.add(this.hyde.eyeL.x, this.hyde.eyeL.y, this.hyde.eyeL.z, esz, this.hyde.look.eyeColor, 0.7 * a * (1 - this.hydeFade));
      glows.add(this.hyde.eyeR.x, this.hyde.eyeR.y, this.hyde.eyeR.z, esz, this.hyde.look.eyeColor, 0.7 * a * (1 - this.hydeFade));
      const awayX = h.x - this.camera.position.x, awayZ = h.z - this.camera.position.z;
      const al = Math.hypot(awayX, awayZ) || 1;
      const chase = h.mode === 'CHASE' ? 1 : 0;
      glows.add(h.x + (awayX / al) * 1.6, !this.hydeShown ? -50 : 1.9, h.z + (awayZ / al) * 1.6, 7 + chase * 2.5, gc.set(this.hyde.frostAmount > 0.5 ? '#6ac8f0' : chase ? '#7a4ac8' : '#5a46c0'), (0.17 + 0.15 * chase) * (1 - this.hydeFade) * smoothstep(0.3, 1, this.riseK));
    }
    // the Hyde climbing out of the ground: a pool of violet mist hugging the spot
    if (this.hydeShown && this.riseK < 1) {
      const ex = this.emerge ?? h;
      glows.add(ex.x, 0.6, ex.z, 5.5 * (1 - 0.4 * this.riseK), gc.set('#6a58c8'), 0.32 * (1 - this.riseK));
    }
    this.crackVfx(run, eff, dt, glows, rings, gc);
    // companion + egg-carrier warmth
    if (!this.showcase) glows.add(this.companion.root.position.x, this.companion.root.position.y, this.companion.root.position.z, 1.5, gc.set(this.companion.glowColor), 0.55);

    // ---- blob shadows
    {
      const set = (i: number, x: number, z: number, s: number, y = 0.06): void => {
        this.tmp.set(x, y, z);
        const m = this.blobM.makeScale(s, 1, s).setPosition(this.tmp);
        this.blobs.setMatrixAt(i, m);
      };
      set(0, p.x, p.z, 1.0);
      set(1, h.x, h.z, this.hydeShown ? 2.9 * this.riseK : 0.001);
      set(2, this.companion.root.position.x, this.companion.root.position.z, 0.5 + (this.companion.root.position.y - 1.4) * -0.1);
      set(3, eggPos.x, eggPos.z, e.state === 'carried' || e.state === 'delivered' || !this.eggShown ? 0.01 : 0.55);
      set(4, run.crackstone?.x ?? 0, run.crackstone?.z ?? 0, this.crackShown ? 1.5 : 0.001);
      this.blobs.count = 5;
      this.blobs.instanceMatrix.needsUpdate = true;
    }

    // ---- alarm beacons: red blades turning around each beacon (a steady glow, no sweep, with reduced motion)
    {
      const bc = this.beacons;
      bc.begin();
      for (const b of this.world.dress.extras.beacons) {
        if (Math.hypot(b.x - p.x, b.z - p.z) > 70) continue;
        const dc = Math.hypot(b.x - this.camera.position.x, b.z - this.camera.position.z);
        const near = smoothstep(2.0, 6.5, dc); // a blade swinging past the lens fades out
        const a = calm ? 0.7 : T * 2.6;
        bc.push(b.x, b.y, b.z, a, 5.5, 0.6, '#ff3a2a', (calm ? 0.2 : 0.42) * near);
        bc.push(b.x, b.y, b.z, a + Math.PI, 5.5, 0.6, '#ff3a2a', (calm ? 0.2 : 0.42) * near);
      }
      bc.end();
    }

    rings.end(); glows.end(); beams.end(); this.streaks.end(); this.ghosts.end(); this.coins.end(); this.bolts.end();
    void PAL;
  }

  private hazardK = 0;
  private hydeVis: 'petrify' | 'pin' | null = null;
}
