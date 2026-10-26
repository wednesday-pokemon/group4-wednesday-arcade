// RaceScene: owns the WebGL renderer + scene graph and animates the (already resolved) leg as a cinematic.
// The scene NEVER decides outcomes; it only visualises the trusted LegResolution handed to playLeg().
import * as THREE from 'three';
import type { CharacterId, LegIndex, LegResolution, PokemonId, RaceBeat, RaceSceneOptions, RouteId, WeatherId } from './types.ts';
import { LEG_PRESETS, MOON_DIR, WEATHER_PRESETS } from './palette.ts';
import { SAFE_HALF_WIDTH, TRACK_LEN, pathX, pathZ, routeCenterline } from './layout.ts';
import { createGlowMaterial, createOverlayMaterial, createSkyMaterial, createWaterMaterial } from './shaders.ts';
import { ParticlePool } from './particles.ts';
import { LEG_BIT, buildWorldGeometry, type WorldGeometry } from './world.ts';
import {
  basicVC, createBoat, createCrashRock, createEgg, createHyde, createShield, lambertVC,
  type BoatRig, type EggRig, type HydeRig,
} from './actors.ts';
import { DURATION_MS, buildTimeline, type Pose, type Timeline } from './timeline.ts';
import { clamp, damp, lerp, makeGlowTexture, mulberry32, smoothstep } from './util.ts';

const deg = (d: number) => (d * Math.PI) / 180;

let webglCache: boolean | null = null;
export function isWebGLAvailable(): boolean {
  if (webglCache !== null) return webglCache;
  try {
    if (typeof document === 'undefined') return (webglCache = false);
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl2') || c.getContext('webgl');
    webglCache = !!gl;
    const lose = (gl as WebGLRenderingContext | null)?.getExtension('WEBGL_lose_context');
    lose?.loseContext();
  } catch {
    webglCache = false;
  }
  return webglCache;
}

interface Env {
  fogColor: THREE.Color;
  zenith: THREE.Color;
  horizon: THREE.Color;
  hemiSky: THREE.Color;
  hemiGround: THREE.Color;
  fogDensity: number;
  hemiIntensity: number;
  moonIntensity: number;
  moonVis: number;
  waterAmp: number;
  currents: number;
  glitter: number;
  groundFog: number;
  stars: number;
  glowScale: number;
}

function makeEnv(weather: WeatherId, leg: LegIndex): Env {
  const w = WEATHER_PRESETS[weather];
  const l = LEG_PRESETS[leg];
  const tint = (hex: string, k = 1): THREE.Color => {
    const c = new THREE.Color(hex);
    c.r = clamp(c.r * (1 + (l.tint[0] - 1) * k), 0, 1);
    c.g = clamp(c.g * (1 + (l.tint[1] - 1) * k), 0, 1);
    c.b = clamp(c.b * (1 + (l.tint[2] - 1) * k), 0, 1);
    return c;
  };
  return {
    fogColor: tint(w.fogColor),
    zenith: tint(w.skyZenith),
    horizon: tint(w.skyHorizon),
    hemiSky: tint(w.hemiSky, 0.5),
    hemiGround: tint(w.hemiGround),
    fogDensity: w.fogDensity,
    hemiIntensity: w.hemiIntensity,
    moonIntensity: w.moonIntensity * l.moonBoost,
    moonVis: w.moonVisibility,
    waterAmp: w.waterAmp,
    currents: w.currents,
    glitter: w.glitter,
    groundFog: w.groundFog * l.groundFogMul,
    stars: w.starAlpha,
    glowScale: w.glowScale,
  };
}

function blendEnv(cur: Env, tgt: Env, k: number): void {
  cur.fogColor.lerp(tgt.fogColor, k);
  cur.zenith.lerp(tgt.zenith, k);
  cur.horizon.lerp(tgt.horizon, k);
  cur.hemiSky.lerp(tgt.hemiSky, k);
  cur.hemiGround.lerp(tgt.hemiGround, k);
  for (const key of ['fogDensity', 'hemiIntensity', 'moonIntensity', 'moonVis', 'waterAmp', 'currents', 'glitter', 'groundFog', 'stars', 'glowScale'] as const) {
    cur[key] = lerp(cur[key], tgt[key], k);
  }
}

function copyEnv(a: Env): Env {
  return { ...a, fogColor: a.fogColor.clone(), zenith: a.zenith.clone(), horizon: a.horizon.clone(), hemiSky: a.hemiSky.clone(), hemiGround: a.hemiGround.clone() };
}

const tmpRGB = { r: 0, g: 0, b: 0 };
function setSrgb(v: THREE.Vector3, c: THREE.Color): void {
  c.getRGB(tmpRGB, THREE.SRGBColorSpace);
  v.set(tmpRGB.r, tmpRGB.g, tmpRGB.b);
}

function emptyPose(): Pose {
  return {
    t: 0, p: 0, boatX: 0, boatZ: 0, heading: 0, speed: 0.12, boost: 0, hydeGap: 100, lunge: 0, shield: 0, crashHit: 0,
    eggCarried: false, eggPickup: 0, eggLost: 0, flash: 0, flashColor: [1, 1, 1], shake: 0, darkness: 0, finishGlow: 0,
    camYaw: deg(100), wreck: 0,
  };
}

function makeBannerTexture(): THREE.Texture | null {
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 128;
  const ctx = c.getContext('2d');
  if (!ctx) return null;
  ctx.fillStyle = '#1e1850';
  ctx.fillRect(0, 0, 512, 128);
  for (let i = 0; i < 32; i++) {
    ctx.fillStyle = i % 2 ? '#f3ead2' : '#0b1020';
    ctx.fillRect(i * 16, 0, 16, 12);
    ctx.fillStyle = i % 2 ? '#0b1020' : '#f3ead2';
    ctx.fillRect(i * 16, 116, 16, 12);
  }
  ctx.fillStyle = '#f5b04c';
  ctx.font = 'bold 72px Georgia, serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('FINISH', 256, 66);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function polarWaterGeometry(): THREE.BufferGeometry {
  const rings = 72;
  const seg = 72;
  const verts: number[] = [];
  const idx: number[] = [];
  for (let i = 0; i <= rings; i++) {
    const r = 2.5 * i + 720 * Math.pow(i / rings, 3) + (i === 0 ? 0 : 0);
    for (let j = 0; j < seg; j++) {
      const a = (j / seg) * Math.PI * 2;
      verts.push(Math.cos(a) * r, 0, Math.sin(a) * r);
    }
  }
  for (let i = 0; i < rings; i++) {
    for (let j = 0; j < seg; j++) {
      const a = i * seg + j;
      const b = i * seg + ((j + 1) % seg);
      const c = (i + 1) * seg + j;
      const d = (i + 1) * seg + ((j + 1) % seg);
      idx.push(a, b, c, b, d, c);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  g.setIndex(idx);
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);
  return g;
}

function ribbonGeometry(route: RouteId, halfWidth: number): THREE.BufferGeometry {
  const pts = routeCenterline(route, 60);
  const pos: number[] = [];
  const col: number[] = [];
  const idx: number[] = [];
  pts.forEach((p, i) => {
    for (const [dx, b] of [[-1, 0], [0, 1], [1, 0]] as const) {
      pos.push(p.x + dx * halfWidth, 0.07, p.z);
      col.push(b, b, b);
    }
    if (i > 0) {
      const a = (i - 1) * 3;
      const c = i * 3;
      idx.push(a, c, a + 1, a + 1, c, c + 1, a + 1, c + 1, a + 2, a + 2, c + 1, c + 2);
    }
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, -TRACK_LEN / 2), TRACK_LEN);
  return g;
}

export class RaceScene {
  private readonly container: HTMLElement;
  private opts: RaceSceneOptions;
  private readonly canvas: HTMLCanvasElement;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(56, 16 / 9, 0.3, 1500);
  private readonly fog = new THREE.FogExp2(0x1a2150, 0.0055);
  private ro: ResizeObserver | null = null;
  private raf = 0;
  private lastNow = 0;
  private disposed = false;
  private contextLost = false;
  private width = 960;
  private height = 540;
  private vFov = 56;

  // content
  private readonly glowTex: THREE.Texture | null;
  private readonly world: WorldGeometry;
  private readonly hemi: THREE.HemisphereLight;
  private readonly moonLight: THREE.DirectionalLight;
  private readonly hydeLight: THREE.PointLight;
  private readonly water: THREE.Mesh;
  private readonly waterMat: THREE.ShaderMaterial;
  private readonly sky: THREE.Mesh;
  private readonly skyMat: THREE.ShaderMaterial;
  private readonly glowMat: THREE.ShaderMaterial;
  private readonly glowMirrorMat: THREE.ShaderMaterial;
  private readonly overlayMat: THREE.ShaderMaterial;
  private readonly legGroups: Record<LegIndex, THREE.Group>;
  private readonly fogDiscs: THREE.InstancedMesh;
  private readonly fogDiscData: { x: number; z: number; s: number; r: number; ph: number; hi: number }[] = [];
  private readonly boat: BoatRig;
  private readonly hyde: HydeRig;
  private readonly egg: EggRig;
  private readonly crashRock: THREE.Mesh;
  private readonly shield: THREE.Mesh;
  private readonly speedLines: THREE.LineSegments;
  private readonly speedLineSeeds: Float32Array;
  private readonly ribbonSafe: THREE.Mesh;
  private readonly ribbonShort: THREE.Mesh;
  private readonly banner: THREE.Mesh;
  private readonly particles: ParticlePool;
  private readonly rng = mulberry32(1337);
  private readonly disposables: { dispose(): void }[] = [];

  // state
  private clockMs = 0;
  private leg: LegIndex = 1;
  private weather: WeatherId = 'clear';
  private gapTarget = 100;
  private gapShown = 100;
  private preview: RouteId | null = null;
  private emphSafe = 1;
  private emphShort = 1;
  private ribbonSafeA = 0;
  private ribbonShortA = 0;
  private envCur: Env;
  private envTgt: Env;
  private mode: 'idle' | 'playing' | 'ended' = 'idle';
  private timeline: Timeline | null = null;
  private playMs = 0;
  private prevT = -1;
  private resolvePlay: (() => void) | null = null;
  private onBeat: ((b: RaceBeat) => void) | undefined;
  private lastBeat: RaceBeat | null = null;
  private pose: Pose = emptyPose();
  private route: RouteId = 'safe';
  private rowPhase = 0;
  private camYaw = deg(100);
  private camPos = new THREE.Vector3(10, 6, 10);
  private camLook = new THREE.Vector3();
  private camSnap = true;
  private accWake = 0;
  private accSpray = 0;
  private accMist = 0;
  private accFleck = 0;
  private accSpark = 0;
  private accEggGlint = 0;
  private lostEggStart = new THREE.Vector3();
  private crew: { c: CharacterId; p: PokemonId } = { c: 'wednesday', p: 'gengar' };
  private eggTier: 'none' | 'common' | 'rare' | 'legendary' = 'common';
  private readonly tmpV = new THREE.Vector3();
  private lastRenderInfo = { calls: 0, triangles: 0 };

  constructor(container: HTMLElement, options: RaceSceneOptions) {
    this.container = container;
    this.opts = { reducedMotion: !!options.reducedMotion, lowGraphics: !!options.lowGraphics };
    this.canvas = document.createElement('canvas');
    this.canvas.style.cssText = 'display:block;width:100%;height:100%;outline:none;';
    this.canvas.setAttribute('role', 'img');
    this.canvas.setAttribute('aria-label', 'Night rowing race on the misty sea around Raven Island');
    container.appendChild(this.canvas);

    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: !this.opts.lowGraphics,
      alpha: false,
      powerPreference: 'high-performance',
    });
    this.renderer.setClearColor(0x0b1020, 1);
    this.renderer.shadowMap.enabled = false;
    this.canvas.addEventListener('webglcontextlost', this.onContextLost, false);
    this.canvas.addEventListener('webglcontextrestored', this.onContextRestored, false);

    this.glowTex = makeGlowTexture(64);
    this.scene.fog = this.fog;
    this.scene.background = new THREE.Color(0x1a2150);

    // ---- lights (no shadow maps)
    this.hemi = new THREE.HemisphereLight(0x8e9cf0, 0x2a3070, 2.3);
    this.moonLight = new THREE.DirectionalLight(0xb8c4ff, 3);
    this.moonLight.position.set(MOON_DIR[0] * 100, MOON_DIR[1] * 100 + 20, MOON_DIR[2] * 100);
    this.hydeLight = new THREE.PointLight(0x7a5cff, 0, 40, 1.6);
    this.scene.add(this.hemi, this.moonLight, this.moonLight.target, this.hydeLight);

    // ---- sky + water
    this.skyMat = createSkyMaterial();
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(900, 24, 12), this.skyMat);
    this.sky.renderOrder = -20;
    this.sky.frustumCulled = false;
    this.scene.add(this.sky);

    this.waterMat = createWaterMaterial();
    this.water = new THREE.Mesh(polarWaterGeometry(), this.waterMat);
    this.water.renderOrder = -10;
    this.water.frustumCulled = false;
    this.scene.add(this.water);

    // ---- static world
    this.world = buildWorldGeometry();
    const litMat = lambertVC();
    const emiMat = basicVC({ fog: true });
    const mk = (s: { lit: THREE.BufferGeometry; emissive: THREE.BufferGeometry }, parent: THREE.Object3D) => {
      parent.add(new THREE.Mesh(s.lit, litMat), new THREE.Mesh(s.emissive, emiMat));
    };
    mk(this.world.shared, this.scene);
    this.legGroups = { 1: new THREE.Group(), 2: new THREE.Group(), 3: new THREE.Group() };
    for (const i of [1, 2, 3] as const) {
      mk(this.world.legs[i], this.legGroups[i]);
      this.scene.add(this.legGroups[i]);
    }
    this.disposables.push(litMat, emiMat);

    this.banner = new THREE.Mesh(
      new THREE.PlaneGeometry(15.4, 3.2),
      new THREE.MeshBasicMaterial({ map: makeBannerTexture() ?? undefined, color: 0xffffff, side: THREE.DoubleSide }),
    );
    this.banner.position.copy(this.world.bannerPos);
    this.legGroups[3].add(this.banner);

    // glow emitters + water reflections
    this.glowMat = createGlowMaterial(false);
    this.glowMirrorMat = createGlowMaterial(true);
    const glowPts = new THREE.Points(this.world.glows, this.glowMat);
    const mirrorPts = new THREE.Points(this.world.glows, this.glowMirrorMat);
    glowPts.frustumCulled = false;
    mirrorPts.frustumCulled = false;
    glowPts.renderOrder = 4;
    mirrorPts.renderOrder = 3;
    this.scene.add(glowPts, mirrorPts);

    // ground fog discs (one instanced draw call)
    const discGeo = new THREE.PlaneGeometry(1, 1);
    discGeo.rotateX(-Math.PI / 2);
    const discMat = new THREE.MeshBasicMaterial({
      map: this.glowTex ?? undefined, color: new THREE.Color('#8c93d8'), transparent: true, opacity: 0.3, depthWrite: false, fog: false,
    });
    const DISC_COUNT = 64;
    this.fogDiscs = new THREE.InstancedMesh(discGeo, discMat, DISC_COUNT);
    this.fogDiscs.frustumCulled = false;
    this.fogDiscs.renderOrder = 1;
    const r = mulberry32(99);
    for (let i = 0; i < DISC_COUNT; i++) {
      const hi = i % 5 === 0 ? 1 : 0;
      this.fogDiscData.push({
        x: -60 + r() * 110, z: 30 - r() * (TRACK_LEN + 80), s: 12 + r() * 18, r: r() * 6, ph: r() * 6.28, hi,
      });
    }
    this.scene.add(this.fogDiscs);
    this.disposables.push(discGeo, discMat);

    // ---- actors
    this.boat = createBoat(this.glowTex);
    this.scene.add(this.boat.root);
    this.hyde = createHyde(this.glowTex);
    this.scene.add(this.hyde.root);
    this.egg = createEgg(this.glowTex);
    this.egg.root.visible = false;
    this.scene.add(this.egg.root);
    this.crashRock = createCrashRock();
    this.crashRock.visible = false;
    this.scene.add(this.crashRock);
    this.shield = createShield();
    this.boat.tilt.add(this.shield);

    // speed lines (boost)
    const NL = 30;
    this.speedLineSeeds = new Float32Array(NL * 4);
    const lr = mulberry32(5);
    for (let i = 0; i < NL; i++) {
      let x = (lr() - 0.5) * 14;
      if (Math.abs(x) < 1.6) x += Math.sign(x || 1) * 1.8;
      this.speedLineSeeds.set([x, 0.3 + lr() * 3.2, lr() * 22 - 14, 1.5 + lr() * 2.5], i * 4);
    }
    const lg = new THREE.BufferGeometry();
    lg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(NL * 6), 3));
    lg.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e4);
    this.speedLines = new THREE.LineSegments(
      lg,
      new THREE.LineBasicMaterial({ color: 0xcfd8ff, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }),
    );
    this.speedLines.frustumCulled = false;
    this.speedLines.visible = false;
    this.boat.root.add(this.speedLines);

    // route preview ribbons
    const ribMat = (hex: string) =>
      new THREE.MeshBasicMaterial({ vertexColors: true, color: new THREE.Color(hex), transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, fog: false, side: THREE.DoubleSide });
    this.ribbonSafe = new THREE.Mesh(ribbonGeometry('safe', SAFE_HALF_WIDTH - 1.5), ribMat('#f5b04c'));
    this.ribbonShort = new THREE.Mesh(ribbonGeometry('shortcut', 2.6), ribMat('#a58bff'));
    this.ribbonSafe.frustumCulled = false;
    this.ribbonShort.frustumCulled = false;
    this.ribbonSafe.renderOrder = 2;
    this.ribbonShort.renderOrder = 2;
    this.scene.add(this.ribbonSafe, this.ribbonShort);

    // particles
    this.particles = new ParticlePool(520);
    this.scene.add(this.particles.points);

    // overlay (flash / vignette / darkness)
    this.overlayMat = createOverlayMaterial();
    const overlay = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.overlayMat);
    overlay.frustumCulled = false;
    overlay.renderOrder = 1000;
    this.scene.add(overlay);

    this.envTgt = makeEnv(this.weather, this.leg);
    this.envCur = copyEnv(this.envTgt);
    this.boat.setCrew(this.crew.c, this.crew.p);
    this.applyOptions();
    this.applyLegVisibility();
    this.measure(true);
    this.pose = this.idlePose();
    this.syncVisuals(0);
    this.camSnap = true;
    this.updateCamera(0);

    if (typeof ResizeObserver !== 'undefined') {
      this.ro = new ResizeObserver(() => this.measure(false));
      this.ro.observe(container);
    }
    this.lastNow = performance.now();
    this.raf = requestAnimationFrame(this.frame);
    this.render();
  }

  // ------------------------------------------------------------------ public API
  setCrew(characterId: CharacterId, pokemonId: PokemonId): void {
    this.crew = { c: characterId, p: pokemonId };
    this.boat.setCrew(characterId, pokemonId);
  }

  setLeg(legIndex: LegIndex, weather: WeatherId, gapM: number): void {
    if (this.mode === 'playing') this.skip();
    this.leg = legIndex;
    this.weather = weather;
    this.gapTarget = Number.isFinite(gapM) ? Math.max(0, gapM) : 100;
    this.mode = 'idle';
    this.timeline = null;
    this.route = 'safe';
    this.lastBeat = null;
    this.envTgt = makeEnv(weather, legIndex);
    this.envCur = copyEnv(this.envTgt);
    this.applyLegVisibility();
    this.egg.root.visible = false;
    this.crashRock.visible = false;
    this.particles.clear();
    this.camSnap = true;
    this.pose = this.idlePose();
    this.gapShown = this.gapTarget;
    this.syncVisuals(0);
    this.updateCamera(0);
    this.render();
  }

  setRoutePreview(route: RouteId | null): void {
    this.preview = route;
  }

  playLeg(resolution: LegResolution, onBeat?: (beat: RaceBeat) => void): Promise<void> {
    if (this.mode === 'playing') this.skip();
    return new Promise<void>((resolve) => {
      let tl: Timeline;
      try {
        tl = buildTimeline(resolution, this.opts.reducedMotion);
      } catch (e) {
        console.warn('[RaceScene] invalid LegResolution, skipping cinematic', e);
        resolve();
        return;
      }
      this.leg = resolution.legIndex;
      this.weather = resolution.weather;
      this.envTgt = makeEnv(this.weather, this.leg);
      this.applyLegVisibility();
      this.timeline = tl;
      this.route = resolution.route;
      this.mode = 'playing';
      this.playMs = 0;
      this.prevT = -1;
      this.onBeat = onBeat;
      this.resolvePlay = resolve;
      this.lastBeat = null;
      this.preview = null;
      this.gapTarget = Math.max(0, resolution.gapStartM);
      this.gapShown = this.gapTarget;
      this.particles.clear();
      // props for this resolution
      const tier = resolution.eggOffer === 'none' ? 'common' : resolution.eggOffer;
      this.eggTier = tier;
      this.egg.setTier(tier);
      this.egg.root.visible = resolution.eggAttempted;
      if (tl.crashAt) this.crashRock.position.set(tl.crashAt.x, 0, tl.crashAt.z);
      this.crashRock.rotation.y = ((resolution.draws?.crash ?? resolution.legIndex / 3) * 6.28) % 6.28;
      this.crashRock.visible = resolution.crashOccurred;
      if (tl.tEggLost >= 0) {
        const lp = tl.poseAt(tl.tEggLost);
        this.lostEggStart.set(lp.boatX, 0.9, lp.boatZ + 0.6);
      }
      this.camSnap = true;
      this.pose = tl.poseAt(0);
      this.stepPlayback(0);
      this.syncVisuals(0);
      this.updateCamera(0);
      this.render();
    });
  }

  skip(): void {
    if (this.mode !== 'playing' || !this.timeline) return;
    const tl = this.timeline;
    // fire any beats not yet delivered so the UI state machine stays consistent; no particle bursts
    for (const b of tl.beats) {
      if (b.t > this.prevT + 1e-9) this.fireBeat(b.beat, false);
    }
    this.playMs = tl.durationMs;
    this.prevT = 1;
    this.pose = tl.endPose();
    this.finishPlayback();
    this.particles.clear();
    this.camSnap = true;
    this.syncVisuals(0);
    this.updateCamera(0);
    this.render();
  }

  setOptions(options: Partial<RaceSceneOptions>): void {
    if (options.reducedMotion !== undefined) this.opts.reducedMotion = !!options.reducedMotion;
    if (options.lowGraphics !== undefined) this.opts.lowGraphics = !!options.lowGraphics;
    this.applyOptions();
    this.measure(true);
  }

  advanceTime(ms: number): void {
    if (this.disposed || !(ms > 0)) return;
    let remaining = ms;
    while (remaining > 0) {
      const s = Math.min(1000 / 30, remaining);
      this.step(s);
      remaining -= s;
    }
    this.render();
  }

  getDebugState(): object {
    const hp = this.hyde.root.position;
    return {
      leg: this.leg,
      weather: this.weather,
      route: this.route,
      playing: this.mode === 'playing',
      mode: this.mode,
      beat: this.lastBeat,
      t: this.timeline ? Number(this.pose.t.toFixed(3)) : null,
      boat: { x: Number(this.boat.root.position.x.toFixed(2)), z: Number(this.boat.root.position.z.toFixed(2)) },
      hyde: { x: Number(hp.x.toFixed(2)), z: Number(hp.z.toFixed(2)), gapM: Number(this.pose.hydeGap.toFixed(1)), lunge: Number(this.pose.lunge.toFixed(2)) },
      eggCarried: this.pose.eggCarried,
      shield: Number(this.pose.shield.toFixed(2)),
      reducedMotion: this.opts.reducedMotion,
      lowGraphics: this.opts.lowGraphics,
      drawCalls: this.lastRenderInfo.calls,
      triangles: this.lastRenderInfo.triangles,
      durationMs: this.timeline ? this.timeline.durationMs : this.opts.reducedMotion ? DURATION_MS.reduced : DURATION_MS.normal,
      clockMs: Math.round(this.clockMs),
    };
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.ro?.disconnect();
    this.canvas.removeEventListener('webglcontextlost', this.onContextLost);
    this.canvas.removeEventListener('webglcontextrestored', this.onContextRestored);
    if (this.resolvePlay) {
      const r = this.resolvePlay;
      this.resolvePlay = null;
      r();
    }
    this.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
      const mat = (m as { material?: THREE.Material | THREE.Material[] }).material;
      const mats = Array.isArray(mat) ? mat : mat ? [mat] : [];
      for (const mm of mats) {
        const withMap = mm as THREE.Material & { map?: THREE.Texture | null };
        if (withMap.map) withMap.map.dispose();
        mm.dispose();
      }
    });
    this.boat.dispose();
    this.hyde.dispose();
    this.egg.dispose();
    this.particles.dispose();
    this.glowTex?.dispose();
    for (const d of this.disposables) d.dispose();
    this.hemi.dispose();
    this.moonLight.dispose();
    this.hydeLight.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.canvas.remove();
  }

  // ------------------------------------------------------------------ loop
  private onContextLost = (e: Event): void => {
    e.preventDefault();
    this.contextLost = true;
  };
  private onContextRestored = (): void => {
    this.contextLost = false;
    this.render();
  };

  private frame = (now: number): void => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.frame);
    const dt = clamp(now - this.lastNow, 0, 100);
    this.lastNow = now;
    if (dt <= 0) return;
    this.step(dt);
    this.render();
  };

  private render(): void {
    if (this.disposed || this.contextLost) return;
    this.renderer.render(this.scene, this.camera);
    const info = this.renderer.info.render;
    this.lastRenderInfo = { calls: info.calls, triangles: info.triangles };
  }

  private measure(force: boolean): void {
    const w = this.container.clientWidth || 960;
    const h = this.container.clientHeight || 540;
    const dprCap = this.opts.lowGraphics ? 1 : 1.5;
    const dpr = Math.min(typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1, dprCap);
    if (!force && w === this.width && h === this.height && dpr === this.renderer.getPixelRatio()) return;
    this.width = w;
    this.height = h;
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(w, h, false);
    const aspect = w / h;
    this.camera.aspect = aspect;
    // keep the action framed on portrait / narrow containers by widening the vertical FOV
    this.vFov = aspect >= 1.4 ? 56 : Math.min(88, (2 * Math.atan(Math.tan(deg(56) / 2) * (1.4 / aspect)) * 180) / Math.PI);
    this.camera.fov = this.vFov;
    this.camera.updateProjectionMatrix();
    const pixelScale = this.renderer.domElement.height / (2 * Math.tan(deg(this.vFov) / 2));
    this.glowMat.uniforms.uPixelScale.value = pixelScale;
    this.glowMirrorMat.uniforms.uPixelScale.value = pixelScale;
    this.particles.setPixelScale(pixelScale);
    this.render();
  }

  private applyOptions(): void {
    const low = this.opts.lowGraphics;
    this.waterMat.uniforms.uAnimate.value = low ? 0 : 1;
    this.fogDiscs.count = low ? 36 : this.fogDiscData.length;
    this.particles.setActiveLimit(low ? 140 : 520);
    this.glowMirrorMat.visible = true;
    this.boat.lanternLight.visible = true;
  }

  private applyLegVisibility(): void {
    for (const i of [1, 2, 3] as const) this.legGroups[i].visible = i === this.leg;
    this.glowMat.uniforms.uLegBit.value = LEG_BIT[this.leg];
    this.glowMirrorMat.uniforms.uLegBit.value = LEG_BIT[this.leg];
  }

  private idlePose(): Pose {
    const p = emptyPose();
    const prog = this.leg === 3 ? 0.945 : 0.13; // leg 3 waits near the dock so the finish banner is in frame
    p.p = prog;
    p.boatX = pathX('safe', prog);
    p.boatZ = pathZ(prog);
    p.heading = 0;
    p.hydeGap = this.gapShown;
    p.speed = 0.1;
    p.camYaw = this.opts.reducedMotion ? deg(100) : deg(92);
    return p;
  }

  // ------------------------------------------------------------------ simulation
  private step(dtMs: number): void {
    const dt = dtMs / 1000;
    this.clockMs += dtMs;
    if (this.mode === 'playing') this.stepPlayback(dtMs);
    else if (this.mode === 'idle') {
      this.gapShown = damp(this.gapShown, this.gapTarget, 3, dt);
      this.pose = this.idlePose();
    }
    this.syncVisuals(dt);
    this.updateCamera(dt);
  }

  private stepPlayback(dtMs: number): void {
    const tl = this.timeline;
    if (!tl) return;
    this.playMs += dtMs;
    const t = clamp(this.playMs / tl.durationMs, 0, 1);
    const prev = this.prevT;
    for (const b of tl.beats) {
      if (b.t > prev + 1e-9 && b.t <= t + 1e-9) this.fireBeat(b.beat, true);
    }
    this.prevT = t;
    this.pose = tl.poseAt(t);
    this.gapShown = this.pose.hydeGap;
    if (t >= 1 && this.mode === 'playing') this.finishPlayback();
  }

  private fireBeat(beat: RaceBeat, bursts: boolean): void {
    this.lastBeat = beat;
    if (bursts) this.beatBurst(beat);
    try {
      this.onBeat?.(beat);
    } catch (e) {
      console.warn('[RaceScene] onBeat handler threw', e);
    }
  }

  private finishPlayback(): void {
    this.mode = 'ended';
    const r = this.resolvePlay;
    this.resolvePlay = null;
    if (this.timeline) this.pose = this.timeline.endPose();
    if (r) r();
  }

  private beatBurst(beat: RaceBeat): void {
    const tl = this.timeline;
    if (!tl) return;
    const lowK = this.opts.lowGraphics ? 0.4 : 1;
    const P = this.particles;
    const bx = this.boat.root.position.x;
    const bz = this.boat.root.position.z;
    const rnd = this.rng;
    switch (beat) {
      case 'start':
        for (let i = 0; i < 24 * lowK; i++) {
          const a = rnd() * 6.28;
          P.emit({ x: bx + Math.cos(a) * 1.2, y: 0.1, z: bz + Math.sin(a) * 1.8, vx: Math.cos(a) * 2, vy: 0.5, vz: Math.sin(a) * 2, life: 1.2, size: 0.5, grow: 2.2, color: '#b8c8ff', alpha: 0.5, drag: 1.4 });
        }
        break;
      case 'egg': {
        const hex = this.eggTier === 'legendary' ? '#ffc83a' : this.eggTier === 'rare' ? '#3fe3f2' : '#f3ead2';
        const e = tl.eggAt;
        const ex = e ? e.x : bx;
        const ez = e ? e.z : bz;
        const n = Math.round((this.eggTier === 'legendary' ? 70 : 46) * lowK);
        for (let i = 0; i < n; i++) {
          const a = (i / n) * Math.PI * 2;
          const sp = 2 + rnd() * 2.2;
          P.emit({ x: ex, y: 0.7, z: ez, vx: Math.cos(a) * sp, vy: 2 + rnd() * 3, vz: Math.sin(a) * sp, life: 1.1 + rnd() * 0.5, size: 0.3 + rnd() * 0.2, grow: 0.6, color: hex, alpha: 1, gravity: -3, drag: 0.8 });
        }
        break;
      }
      case 'crash': {
        const c = tl.crashAt;
        const cx = c ? c.x : bx;
        const cz = c ? c.z : bz;
        const hard = tl.res.crashNegatedBy === null;
        const n = Math.round((hard ? 90 : 36) * lowK);
        for (let i = 0; i < n; i++) {
          const a = rnd() * 6.28;
          const sp = 1.5 + rnd() * 4;
          P.emit({ x: cx, y: 0.4, z: cz, vx: Math.cos(a) * sp, vy: 4 + rnd() * 6, vz: Math.sin(a) * sp, life: 0.9 + rnd() * 0.5, size: 0.28 + rnd() * 0.2, grow: 0.8, color: '#dbe6ff', alpha: 0.9, gravity: -11, drag: 0.2 });
        }
        if (!hard) {
          for (let i = 0; i < 40 * lowK; i++) {
            const a = (i / 40) * Math.PI * 2;
            P.emit({ x: bx, y: 0.8, z: bz, vx: Math.cos(a) * 5, vy: 0.3, vz: Math.sin(a) * 5, life: 0.7, size: 0.35, grow: 1.4, color: '#6fe8ff', alpha: 1, drag: 2.2 });
          }
        }
        break;
      }
      case 'catch':
        for (let i = 0; i < 70 * lowK; i++) {
          const a = rnd() * 6.28;
          const sp = 3 + rnd() * 7;
          P.emit({ x: bx, y: 1 + rnd() * 2, z: bz, vx: Math.cos(a) * sp, vy: rnd() * 4, vz: Math.sin(a) * sp, life: 0.7 + rnd() * 0.5, size: 0.5 + rnd() * 0.5, grow: 1.5, color: rnd() > 0.5 ? '#c9b8ff' : '#ff9ad2', alpha: 0.9, drag: 2 });
        }
        break;
      case 'finish':
        for (let i = 0; i < 130 * lowK; i++) {
          const x = bx + (rnd() - 0.5) * 16;
          P.emit({ x, y: 1 + rnd() * 2, z: bz - 2 - rnd() * 8, vx: (rnd() - 0.5) * 3, vy: 6 + rnd() * 9, vz: (rnd() - 0.5) * 2, life: 1.6 + rnd() * 1.2, size: 0.3 + rnd() * 0.3, grow: 0.5, color: rnd() > 0.5 ? '#ffd27a' : rnd() > 0.5 ? '#c9b8ff' : '#fff2cf', alpha: 1, gravity: -6, drag: 0.3 });
        }
        break;
      default:
        break;
    }
  }

  // ------------------------------------------------------------------ visual sync
  private hydeDistance(gap: number, lunge: number): number {
    const dv = 6.5 + Math.min(Math.max(gap, 0), 150) * 0.12;
    return lerp(dv, 3.4, lunge);
  }

  private emitRate(accKey: 'accWake' | 'accSpray' | 'accMist' | 'accFleck' | 'accSpark' | 'accEggGlint', rate: number, dt: number, fn: () => void): void {
    this[accKey] += rate * dt;
    let guard = 0;
    while (this[accKey] >= 1 && guard++ < 40) {
      this[accKey] -= 1;
      fn();
    }
    if (this[accKey] > 4) this[accKey] = 0;
  }

  private syncVisuals(dt: number): void {
    const pose = this.pose;
    const T = this.clockMs / 1000;
    const reduced = this.opts.reducedMotion;
    const low = this.opts.lowGraphics;
    const lowK = low ? 0.35 : 1;
    const playing = this.mode === 'playing';
    const P = this.particles;

    // ---- environment blend
    if (dt > 0) blendEnv(this.envCur, this.envTgt, 1 - Math.exp(-2.5 * dt));
    const env = this.envCur;
    const dark = pose.darkness;
    this.fog.color.copy(env.fogColor);
    this.fog.density = env.fogDensity * (1 + dark * 0.5);
    (this.scene.background as THREE.Color).copy(env.fogColor);
    this.hemi.color.copy(env.hemiSky);
    this.hemi.groundColor.copy(env.hemiGround);
    this.hemi.intensity = env.hemiIntensity * (1 - 0.5 * dark);
    this.moonLight.intensity = env.moonIntensity * (1 - 0.55 * dark);

    const wu = this.waterMat.uniforms;
    wu.uTime.value = T;
    wu.uAmp.value = env.waterAmp;
    wu.uCurrent.value = env.currents;
    wu.uGlitter.value = env.glitter;
    wu.uMoonVis.value = env.moonVis;
    setSrgb(wu.uHorizon.value as THREE.Vector3, env.horizon);
    setSrgb(wu.uZenith.value as THREE.Vector3, env.zenith);
    const deep = this.cDeep.set('#0b1236').lerp(env.fogColor, 0.3);
    const shallow = this.cShallow.set('#1d2c6c').lerp(env.fogColor, 0.45);
    setSrgb(wu.uDeep.value as THREE.Vector3, deep);
    setSrgb(wu.uShallow.value as THREE.Vector3, shallow);
    const su = this.skyMat.uniforms;
    su.uTime.value = T;
    setSrgb(su.uHorizon.value as THREE.Vector3, env.horizon);
    setSrgb(su.uZenith.value as THREE.Vector3, env.zenith);
    su.uMoonVis.value = env.moonVis;
    su.uStars.value = env.stars;
    su.uDark.value = dark;
    for (const m of [this.glowMat, this.glowMirrorMat]) {
      m.uniforms.uTime.value = T;
      m.uniforms.uGlowScale.value = env.glowScale;
      m.uniforms.uFogDensity.value = this.fog.density;
      m.uniforms.uFlicker.value = reduced ? 0.35 : 1;
      m.uniforms.uDim.value = dark * 0.7;
    }
    // route preview emphasis
    const tgtSafe = this.preview === 'safe' ? 1.7 : this.preview === 'shortcut' ? 0.55 : 1;
    const tgtShort = this.preview === 'shortcut' ? 1.8 : this.preview === 'safe' ? 0.55 : 1;
    const k = dt > 0 ? 1 - Math.exp(-6 * dt) : 1;
    this.emphSafe = lerp(this.emphSafe, tgtSafe, k);
    this.emphShort = lerp(this.emphShort, tgtShort, k);
    this.glowMat.uniforms.uEmphSafe.value = this.emphSafe;
    this.glowMat.uniforms.uEmphShort.value = this.emphShort;
    this.glowMirrorMat.uniforms.uEmphSafe.value = this.emphSafe;
    this.glowMirrorMat.uniforms.uEmphShort.value = this.emphShort;
    this.ribbonSafeA = lerp(this.ribbonSafeA, this.preview === 'safe' ? 1 : 0, k);
    this.ribbonShortA = lerp(this.ribbonShortA, this.preview === 'shortcut' ? 1 : 0, k);
    const pulseA = reduced ? 0.8 : 0.75 + 0.25 * Math.sin(T * 3.2);
    (this.ribbonSafe.material as THREE.MeshBasicMaterial).opacity = this.ribbonSafeA * 0.36 * pulseA;
    (this.ribbonShort.material as THREE.MeshBasicMaterial).opacity = this.ribbonShortA * 0.8 * pulseA;
    this.ribbonSafe.visible = this.ribbonSafeA > 0.01;
    this.ribbonShort.visible = this.ribbonShortA > 0.01;

    // ground fog discs
    (this.fogDiscs.material as THREE.MeshBasicMaterial).opacity = clamp(0.04 + env.groundFog * 0.09, 0, 0.4);
    (this.fogDiscs.material as THREE.MeshBasicMaterial).color.copy(env.fogColor).lerp(this.cMist.set('#a0a8e8'), 0.35);
    const dummy = this.tmpObj;
    const n = this.fogDiscs.count;
    for (let i = 0; i < n; i++) {
      const d = this.fogDiscData[i];
      const drift = reduced ? 0 : T * 0.35;
      const xx = ((((d.x + drift + 60) % 110) + 110) % 110) - 60;
      dummy.position.set(xx + Math.sin(T * 0.07 + d.ph) * 5, d.hi ? 2.1 : 0.55 + (i % 3) * 0.15, d.z);
      dummy.rotation.set(0, d.r + (reduced ? 0 : T * 0.02), 0);
      const sc = d.s * (d.hi ? (0.6 + env.groundFog * 0.5) : 1) * (0.5 + 0.5 * Math.min(1, env.groundFog + 0.4));
      dummy.scale.set(sc, 1, sc);
      dummy.updateMatrix();
      this.fogDiscs.setMatrixAt(i, dummy.matrix);
    }
    this.fogDiscs.instanceMatrix.needsUpdate = true;

    // ---- boat
    const rig = this.boat;
    const calm = 0.6 + env.waterAmp * 3 + env.currents * 0.4;
    const bob = (Math.sin(T * 1.9) * 0.05 + Math.sin(T * 3.1 + 1) * 0.025) * calm;
    const roll = Math.sin(T * 1.4) * 0.035 * calm + Math.sin(T * 3.7) * 0.015 * env.currents;
    const pitch = Math.sin(T * 1.1 + 0.6) * 0.025 * calm;
    rig.root.position.set(pose.boatX, 0, pose.boatZ);
    rig.root.rotation.y = pose.heading + Math.sin(T * 0.6) * 0.02;
    const hit = pose.crashHit;
    rig.tilt.position.y = 0.06 + bob + hit * 0.18 - pose.wreck * 0.55;
    rig.tilt.rotation.z = roll + hit * 0.34 * Math.sin(T * 14) * 0.6 + hit * 0.18 + pose.wreck * 0.35;
    rig.tilt.rotation.x = pitch - hit * 0.2 + pose.wreck * 0.12;
    // rowing
    const speedF = playing || this.mode === 'ended' ? pose.speed : 0.1;
    this.rowPhase += dt * (1.6 + speedF * 4.6);
    const sw = Math.sin(this.rowPhase);
    const lift = Math.max(0, Math.cos(this.rowPhase)) * 0.35;
    const amp = 0.18 + Math.min(1, speedF) * 0.34;
    rig.oarL.rotation.set(0, sw * amp, -lift - 0.05);
    rig.oarR.rotation.set(0, -sw * amp, lift + 0.05);
    rig.crewPivot.rotation.x = -sw * 0.14 * (0.4 + Math.min(1, speedF)) - pose.wreck * 0.5;
    // companion
    const comp = rig.companion;
    comp.position.set(-0.6 + Math.sin(T * 0.9) * 0.12, 1.3 + Math.sin(T * 2.3) * 0.13 + hit * 0.3, -0.85 + Math.cos(T * 0.7) * 0.1);
    comp.rotation.y = Math.sin(T * 0.8) * 0.5;
    comp.rotation.z = Math.sin(T * 1.7) * 0.12;
    if (rig.companionSecond) {
      rig.companionSecond.position.set(Math.cos(T * 2.1) * 0.55, Math.sin(T * 1.6) * 0.12, Math.sin(T * 2.1) * 0.55);
    }
    (rig.companionGlow.material as THREE.SpriteMaterial).opacity = (0.45 + 0.15 * Math.sin(T * 3)) * (1 - 0.7 * dark);
    // lantern flicker
    const flick = 1 + (reduced ? 0.04 : 0.14) * Math.sin(T * 9.1) * Math.sin(T * 4.3) + 0.04 * Math.sin(T * 23);
    rig.lanternLight.intensity = 38 * flick * (1 - 0.8 * dark) * (1 + 0.4 * pose.finishGlow);
    (rig.lanternGlow.material as THREE.SpriteMaterial).opacity = 0.85 * flick * (1 - 0.6 * dark);
    rig.lanternGlow.scale.setScalar(2.6 * flick * env.glowScale ** 0.5);
    // shield
    this.shield.visible = pose.shield > 0.01;
    (this.shield.material as THREE.MeshBasicMaterial).opacity = pose.shield * 0.28;
    this.shield.scale.set(0.9 + pose.shield * 0.15, 0.7 + pose.shield * 0.1, 1.4 + pose.shield * 0.2);
    rig.root.updateMatrixWorld(true);

    // ---- Hyde
    const hy = this.hyde;
    const dv = this.hydeDistance(pose.hydeGap, pose.lunge);
    const ph = pose.p - dv / TRACK_LEN;
    const hx = pathX(this.route, ph);
    const hz = pathZ(ph);
    const hBob = Math.sin(T * 1.2) * 0.12;
    hy.root.position.set(hx, -0.35 + hBob - pose.lunge * 0.1, hz);
    const toBoatYaw = Math.atan2(-(pose.boatX - hx), -(pose.boatZ - hz));
    hy.root.rotation.y = toBoatYaw - 0.55 * (1 - pose.lunge * 0.7);
    const sc = 1 + pose.lunge * 0.22;
    hy.root.scale.setScalar(sc * 0.82);
    hy.upper.rotation.x = -0.16 - pose.lunge * 0.5 + Math.sin(T * 0.9) * 0.03;
    hy.head.rotation.x = 0.1 + pose.lunge * 0.25;
    const swing = Math.sin(T * 1.5) * 0.22 * (1 - pose.lunge);
    hy.armL.rotation.x = 0.28 + swing + pose.lunge * 1.2;
    hy.armR.rotation.x = 0.28 - swing + pose.lunge * 1.25;
    hy.armL.rotation.z = -0.1 - pose.lunge * 0.15;
    hy.armR.rotation.z = 0.1 + pose.lunge * 0.15;
    const eyePulse = 0.85 + 0.15 * Math.sin(T * 5) + pose.lunge * 0.5;
    for (const s of [hy.eyeGlowL, hy.eyeGlowR]) {
      (s.material as THREE.SpriteMaterial).opacity = Math.min(1, eyePulse) * (0.75 + 0.25 * env.glowScale / 1.45);
      s.scale.setScalar((2.0 + pose.lunge * 1.4) * (0.85 + 0.15 * env.glowScale));
    }
    (hy.aura.material as THREE.SpriteMaterial).opacity = (0.4 + 0.12 * Math.sin(T * 1.7) + pose.lunge * 0.3) * (this.leg === 3 ? 1.3 : 1);
    (hy.foam.material as THREE.MeshBasicMaterial).opacity = 0.2 + 0.1 * Math.sin(T * 2);
    this.hydeLight.position.set(hx + 1.5, 7.5, hz + 5);
    this.hydeLight.intensity = (16 + 60 * pose.lunge) * (this.leg === 3 ? 1.6 : 1) * (1 - 0.6 * dark);

    // ---- egg
    this.syncEgg(pose, T);

    // ---- crash rock visibility is persistent after being placed; hide until the boat is near so it isn't spoiled
    if (this.timeline && this.timeline.res.crashOccurred && this.timeline.crashAt) {
      this.crashRock.visible = true;
    }

    // ---- banner
    if (this.leg === 3) {
      this.banner.rotation.x = Math.sin(T * 1.3) * 0.03 + 0.05;
      this.banner.position.y = this.world.bannerPos.y + Math.sin(T * 1.7) * 0.05;
    }

    // ---- speed lines
    const boostK = reduced ? 0 : pose.boost;
    this.speedLines.visible = boostK > 0.02;
    if (this.speedLines.visible) {
      (this.speedLines.material as THREE.LineBasicMaterial).opacity = boostK * 0.4;
      const arr = this.speedLines.geometry.attributes.position.array as Float32Array;
      const sd = this.speedLineSeeds;
      for (let i = 0; i < sd.length / 4; i++) {
        let z = sd[i * 4 + 2] + dt * (34 + boostK * 40);
        if (z > 8) z -= 22;
        sd[i * 4 + 2] = z;
        arr[i * 6] = sd[i * 4];
        arr[i * 6 + 1] = sd[i * 4 + 1];
        arr[i * 6 + 2] = z;
        arr[i * 6 + 3] = sd[i * 4];
        arr[i * 6 + 4] = sd[i * 4 + 1];
        arr[i * 6 + 5] = z - sd[i * 4 + 3] * (1 + boostK);
      }
      this.speedLines.geometry.attributes.position.needsUpdate = true;
    }

    // ---- overlay
    const ou = this.overlayMat.uniforms;
    const flashK = reduced ? Math.min(pose.flash, 0.3) : pose.flash;
    (ou.uFlash.value as THREE.Vector4).set(pose.flashColor[0], pose.flashColor[1], pose.flashColor[2], flashK);
    ou.uDark.value = dark;
    ou.uVig.value = 0.5;

    // ---- continuous particle emitters
    if (dt > 0) {
      const heading = rig.root.rotation.y;
      const sinH = Math.sin(heading);
      const cosH = Math.cos(heading);
      const sternX = pose.boatX + sinH * 1.9;
      const sternZ = pose.boatZ + cosH * 1.9;
      const bowX = pose.boatX - sinH * 1.8;
      const bowZ = pose.boatZ - cosH * 1.8;
      const rnd = this.rng;
      const sp = Math.min(1.4, playing || this.mode === 'ended' ? pose.speed : 0.12);
      const lat = (v: number) => ({ x: cosH * v, z: -sinH * v });
      this.emitRate('accWake', (4 + sp * 38) * lowK, dt, () => {
        const side = rnd() > 0.5 ? 1 : -1;
        const l = lat(side * (0.4 + rnd() * 0.3));
        const lv = lat(side * (0.5 + rnd() * 1.2));
        P.emit({ x: sternX + l.x, y: 0.1, z: sternZ + l.z, vx: lv.x, vy: 0.05, vz: lv.z, life: 1.3 + rnd() * 0.6, size: 0.55 + rnd() * 0.35, grow: 2.2, color: '#b9c8ff', alpha: 0.3 + sp * 0.18, drag: 0.7 });
      });
      const sprayRate = (this.leg === 3 ? 1.6 : 1) * Math.max(0, sp - 0.25) * 34 * lowK;
      this.emitRate('accSpray', sprayRate, dt, () => {
        const side = rnd() > 0.5 ? 1 : -1;
        const l = lat(side * (0.2 + rnd() * 0.5));
        P.emit({ x: bowX + l.x, y: 0.25, z: bowZ + l.z, vx: l.x * 4 + (rnd() - 0.5) * 1.2, vy: 1.8 + rnd() * 2.4, vz: l.z * 4 + (rnd() - 0.5), life: 0.55 + rnd() * 0.3, size: 0.16 + rnd() * 0.12, grow: 0.7, color: '#e6eeff', alpha: 0.9, gravity: -9, drag: 0.3 });
      });
      if (env.currents > 0.3) {
        this.emitRate('accFleck', 16 * lowK, dt, () => {
          P.emit({ x: pose.boatX + (rnd() - 0.5) * 30, y: 0.09, z: pose.boatZ + (rnd() - 0.5) * 28, vx: 0, vy: 0, vz: 8 + rnd() * 3, life: 1.8, size: 0.5 + rnd() * 0.5, grow: 1.4, color: '#dbe6ff', alpha: 0.35 });
        });
      }
      this.emitRate('accMist', 5 * lowK, dt, () => {
        P.emit({ x: hx + (rnd() - 0.5) * 4, y: 0.3, z: hz + (rnd() - 0.5) * 4, vx: (rnd() - 0.5) * 0.4, vy: 0.5, vz: -0.2, life: 2.6, size: 3.2 + rnd() * 1.5, grow: 1.7, color: '#6a62c4', alpha: 0.22 });
      });
      // egg glints around the egg (world or aboard)
      if (this.egg.root.visible && !(this.pose.eggLost >= 1)) {
        const hex = this.eggTier === 'legendary' ? '#ffc83a' : this.eggTier === 'rare' ? '#3fe3f2' : '#f3ead2';
        this.emitRate('accEggGlint', 5 * lowK, dt, () => {
          const e = this.egg.root.position;
          P.emit({ x: e.x + (rnd() - 0.5) * 0.7, y: e.y + 0.4 + rnd() * 0.5, z: e.z + (rnd() - 0.5) * 0.7, vx: 0, vy: 0.5, vz: 0, life: 1.0, size: 0.18, grow: 0.3, color: hex, alpha: 0.9 });
        });
      }
      // finish fountain sparkle (persists at the finished pose)
      if (pose.finishGlow > 0.6) {
        this.emitRate('accSpark', 16 * lowK, dt, () => {
          P.emit({ x: pose.boatX + (rnd() - 0.5) * 14, y: 1 + rnd() * 2, z: pose.boatZ - 4 - rnd() * 5, vx: (rnd() - 0.5), vy: 3 + rnd() * 4, vz: 0, life: 1.6, size: 0.24, grow: 0.5, color: rnd() > 0.5 ? '#ffd27a' : '#c9b8ff', alpha: 0.9, gravity: -3 });
        });
      }
      P.update(dt);
    }
  }

  private readonly tmpObj = new THREE.Object3D();
  private readonly cDeep = new THREE.Color();
  private readonly cShallow = new THREE.Color();
  private readonly cMist = new THREE.Color();
  private readonly moonDir = new THREE.Vector3(-0.6, 0.25, -0.5).normalize();

  private syncEgg(pose: Pose, T: number): void {
    const tl = this.timeline;
    const egg = this.egg;
    if (!tl || !tl.res.eggAttempted) {
      egg.root.visible = false;
      return;
    }
    egg.root.visible = true;
    const glow = egg.glow.material as THREE.SpriteMaterial;
    const bob = Math.sin(T * 2.4) * 0.08;
    if (pose.eggLost > 0 || (tl.tEggLost >= 0 && pose.t >= tl.tEggLost)) {
      const u = pose.eggLost;
      const s = this.lostEggStart;
      egg.root.position.set(s.x + 3.2 * u, Math.max(-0.1, s.y - 0.5 + 2.4 * Math.sin(Math.PI * Math.min(1, u)) - 0.3 * u) + bob * u, s.z + 4 * u);
      egg.root.rotation.z = u * 2.2;
      glow.opacity = 0.9 - 0.55 * u;
      egg.root.scale.setScalar(1 - 0.2 * u);
    } else if (pose.eggCarried) {
      this.boat.eggSlot.getWorldPosition(this.tmpV);
      egg.root.position.copy(this.tmpV);
      egg.root.position.y += bob * 0.5;
      egg.root.rotation.z = 0;
      egg.root.scale.setScalar(0.7 + pose.eggPickup * 0.2);
      glow.opacity = 0.5 + pose.eggPickup * 0.4;
    } else {
      const a = tl.eggAt;
      if (a) egg.root.position.set(a.x, bob, a.z);
      egg.root.rotation.z = 0;
      egg.root.scale.setScalar(1);
      glow.opacity = 0.9;
    }
    const carried = pose.eggCarried && !(pose.eggLost > 0) ? 0.6 : 1;
    egg.glow.scale.setScalar((this.eggTier === 'legendary' ? 3.4 : this.eggTier === 'rare' ? 2.9 : 2.3) * carried * (1 + pose.eggPickup * 1.2 + 0.08 * Math.sin(T * 4)));
    egg.body.rotation.y = T * 1.4;
  }

  // ------------------------------------------------------------------ camera
  private updateCamera(dt: number): void {
    const pose = this.pose;
    const reduced = this.opts.reducedMotion;
    const dv = this.hydeDistance(pose.hydeGap, pose.lunge);
    const yawT = reduced ? deg(100) : pose.camYaw;
    this.camYaw = this.camSnap ? yawT : damp(this.camYaw, yawT, reduced ? 5 : 3.2, dt);
    const w = smoothstep(deg(55), deg(115), this.camYaw);
    const R = lerp(11.5, 17 + dv * 0.45, w);
    const H = lerp(this.route === 'shortcut' && this.mode !== 'idle' ? 6.2 : 5.0, 6.6 + dv * 0.06, w);
    const bx = this.boat.root.position.x;
    const bz = this.boat.root.position.z;
    const px = bx + Math.sin(this.camYaw) * R;
    const pz = bz + Math.cos(this.camYaw) * R;
    const lx = bx;
    const ly = lerp(1.2, 3.6, w);
    const sideLook = this.mode === 'idle' && this.leg === 3 ? 2 : dv * 0.3;
    const lz = bz + lerp(-8, sideLook, w);
    if (this.camSnap || dt === 0) {
      this.camPos.set(px, H, pz);
      this.camLook.set(lx, ly, lz);
      this.camSnap = false;
    } else {
      const lam = reduced ? 10 : 6.5;
      this.camPos.set(damp(this.camPos.x, px, lam, dt), damp(this.camPos.y, H, lam, dt), damp(this.camPos.z, pz, lam, dt));
      this.camLook.set(damp(this.camLook.x, lx, lam, dt), damp(this.camLook.y, ly, lam, dt), damp(this.camLook.z, lz, lam, dt));
      this.camSnap = false;
    }
    const T = this.clockMs / 1000;
    const sh = reduced ? 0 : pose.shake;
    const sway = reduced ? 0 : 1;
    this.camera.position.set(
      this.camPos.x + (Math.sin(T * 61) * Math.sin(T * 17) * sh * 0.5) + Math.sin(T * 0.45) * 0.12 * sway,
      this.camPos.y + (Math.sin(T * 47 + 1) * sh * 0.4) + Math.sin(T * 0.6) * 0.1 * sway,
      this.camPos.z + (Math.sin(T * 53 + 2) * sh * 0.5),
    );
    this.camera.lookAt(this.camLook);
    const fov = this.vFov + w * 4 + (this.mode === 'idle' && this.leg === 3 ? 7 * w : 0) + (reduced ? 0 : pose.boost * 5 + pose.lunge * 4);
    if (Math.abs(fov - this.camera.fov) > 0.01) {
      this.camera.fov = fov;
      this.camera.updateProjectionMatrix();
    }
    // sky + water follow the camera so they never end
    this.sky.position.copy(this.camera.position);
    this.water.position.set(this.camera.position.x, 0, this.camera.position.z);
    // the moon sits ahead of the camera view (slightly to the right) so it, its glitter path and the key light stay in frame
    let vx = this.camLook.x - this.camPos.x;
    let vz = this.camLook.z - this.camPos.z;
    const vl = Math.hypot(vx, vz) || 1;
    vx /= vl;
    vz /= vl;
    const ang = 0.32;
    const mx = vx * Math.cos(ang) - vz * Math.sin(ang);
    const mz = vx * Math.sin(ang) + vz * Math.cos(ang);
    this.moonDir.set(mx * 0.96, MOON_DIR[1] * 0.95, mz * 0.96).normalize();
    (this.waterMat.uniforms.uMoonDir.value as THREE.Vector3).copy(this.moonDir);
    (this.skyMat.uniforms.uMoonDir.value as THREE.Vector3).copy(this.moonDir);
    this.moonLight.position.copy(this.camera.position).addScaledVector(this.moonDir, 100);
    this.moonLight.target.position.copy(this.camera.position);
  }
}
