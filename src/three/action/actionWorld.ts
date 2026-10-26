// Static + slowly animated world of the haunted lake: sky, water, shores, landmarks, hazards, route lanterns,
// fog banks, current streaks, lighthouse beams. Everything is merged/instanced; the whole world is ~15 draw calls.
import * as THREE from 'three';
import type { CourseDef, Obstacle } from '../../action/types.ts';
import { basicVC, lambertVC } from '../actors.ts';
import { createSkyMaterial, createWaterMaterial } from '../shaders.ts';
import { MeshBuilder, disposeObject, mulberry32 } from '../util.ts';
import {
  BillboardField, createBeamMaterial, createFoamMaterial, createGlowFieldMaterial, createMirrorMaterial, createPuffFieldMaterial,
  createRibbonMaterial, createStreakGeometry, createStreakMaterial, type FxUniforms, type GlowEntry,
} from './fx.ts';
import { TriBuilder, mergeAll, type V3 } from './geom.ts';
import { buildLand } from './landBuilder.ts';
import { buildLandmarks } from './landmarks.ts';
import { addObstacle, addObstacleFoam, obstacleWorldPos } from './obstacleMeshes.ts';
import { createReedGeometry, createTreeGeometry, instancedFromSpots } from './props.ts';

const BOX = new THREE.BoxGeometry(1, 1, 1);
const CYL6 = new THREE.CylinderGeometry(1, 1, 1, 6, 1);

export interface WorldOptions { lowGraphics: boolean }

const ROUTE_SAFE = '#ffb347';
const ROUTE_RISK_A = '#9a7bff';
const ROUTE_RISK_B = '#4fe6f2';

function createPolarWater(segments: number): THREE.BufferGeometry {
  const radii: number[] = [];
  for (let r = 5; r < 1500; r *= 1.09) radii.push(r);
  const pos: number[] = [0, 0, 0];
  for (const r of radii) for (let s = 0; s < segments; s++) {
    const a = (s / segments) * Math.PI * 2;
    pos.push(Math.cos(a) * r, 0, Math.sin(a) * r);
  }
  const idx: number[] = [];
  for (let s = 0; s < segments; s++) idx.push(0, 1 + ((s + 1) % segments), 1 + s);
  for (let k = 0; k < radii.length - 1; k++) {
    const a0 = 1 + k * segments, a1 = 1 + (k + 1) * segments;
    for (let s = 0; s < segments; s++) {
      const s1 = (s + 1) % segments;
      idx.push(a0 + s, a0 + s1, a1 + s, a0 + s1, a1 + s1, a1 + s);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  return g;
}

interface Beam { pivot: THREE.Group; speed: number; phase: number }
interface Drifter { o: Obstacle; group: THREE.Group; phase: number }

export class ActionWorld {
  readonly root = new THREE.Group();
  readonly puffs: BillboardField | null;
  readonly lights: BillboardField;
  /** Spots / counts for diagnostics. */
  readonly stats = { trees: 0, reeds: 0, lights: 0, puffs: 0, lanterns: 0, landTris: 0 };
  private readonly water: THREE.Mesh;
  private readonly waterMat = createWaterMaterial();
  private readonly skyMat = createSkyMaterial();
  private readonly sky: THREE.Mesh;
  private readonly beams: Beam[] = [];
  private readonly drifters: Drifter[] = [];
  private readonly streaks: THREE.Mesh | null;
  private readonly ringA: THREE.Mesh;
  private readonly ringB: THREE.Mesh;
  private readonly column: THREE.Mesh;
  private readonly wispIdx: { i: number; x: number; y: number; z: number; ph: number }[] = [];
  private readonly mats: THREE.Material[] = [];
  private readonly litMat: THREE.MeshLambertMaterial;
  private readonly emMat: THREE.MeshBasicMaterial;
  private readonly foamMat: THREE.ShaderMaterial;
  private readonly mirLitMat: THREE.ShaderMaterial | null;
  private readonly mirEmMat: THREE.ShaderMaterial | null;
  private readonly obstacleGroup = new THREE.Group();
  private readonly buoyIdx = new Map<string, number>();
  private obstacleGeos: THREE.BufferGeometry[] = [];

  constructor(readonly course: CourseDef, u: FxUniforms, private readonly opts: WorldOptions) {
    const low = opts.lowGraphics;
    const lms = course.landmarks ?? [];
    const exclusions = lms.filter((l) => l.kind === 'start_dock' || l.kind === 'raven_dock').map((l) => ({ x: l.x, z: l.z, r: 15 * Math.max(1, l.scale) }));

    this.sky = new THREE.Mesh(new THREE.SphereGeometry(900, 24, 12), this.skyMat);
    this.sky.renderOrder = -20;
    this.sky.frustumCulled = false;
    this.root.add(this.sky);

    this.water = new THREE.Mesh(createPolarWater(low ? 56 : 96), this.waterMat);
    this.water.renderOrder = -10;
    this.water.frustumCulled = false;
    this.root.add(this.water);

    const land = buildLand(course, { lowGraphics: low, exclusions });
    const marks = buildLandmarks(course, low);

    // ---- shared materials (land/landmarks/route + rebuildable static obstacles use the same ones)
    this.litMat = this.track(lambertVC());
    this.emMat = this.track(basicVC({ fog: true }));
    this.foamMat = this.track(createFoamMaterial(u));
    this.mirLitMat = low ? null : this.track(createMirrorMaterial(u, false));
    this.mirEmMat = low ? null : this.track(createMirrorMaterial(u, true));
    this.root.add(this.obstacleGroup);

    // ---- obstacles: drifting ones get their own small meshes; static ones are merged by refreshObstacles()
    const foam = new TriBuilder();
    const entries: GlowEntry[] = [...marks.lights];
    course.obstacles.forEach((o, index) => {
      if (o.drift) {
        const l = new MeshBuilder(mulberry32(index + 11));
        const e = new MeshBuilder(mulberry32(index + 12));
        addObstacle(l, e, o, true);
        const group = new THREE.Group();
        const lit = new THREE.Mesh(l.build(), this.litMat);
        const f = new TriBuilder();
        addObstacleFoam(f, o, true);
        const fg = f.build(false);
        group.add(lit);
        if (fg) group.add(new THREE.Mesh(fg, this.foamMat));
        this.root.add(group);
        this.drifters.push({ o, group, phase: index * 1.7 });
        return;
      }
      if (o.kind === 'buoy') {
        this.buoyIdx.set(o.id, entries.length);
        entries.push({ x: o.x, y: 1.85, z: o.z, size: 2.6, color: '#f5b04c', alpha: 0.8, flicker: 0.5, fogFloor: 0.1 });
      }
    });
    for (const l of marks.foamRings) if (l.r > 0) ringStrip(foam, l.x, l.z, l.r * 0.8, l.r * 1.7, [0.45, 0.52, 0.78]);
    const finishRingR = course.finish.radius;

    // ---- route lanterns + ribbons
    const routeLit = new MeshBuilder(mulberry32(8));
    const routeEm = new MeshBuilder(mulberry32(9));
    const ribbonGeos: THREE.BufferGeometry[] = [];
    (course.routes ?? []).forEach((r, ri) => {
      if (r.points.length < 2) return;
      const curve = new THREE.CatmullRomCurve3(r.points.map((p) => new THREE.Vector3(p.x, 0, p.z)), false, 'centripetal');
      const length = curve.getLength();
      const risky = r.risk === 'risky';
      const spacing = risky ? 15 : 13;
      const count = Math.max(2, Math.floor(length / spacing));
      for (let k = 0; k <= count; k++) {
        const p = curve.getPointAt(k / count);
        const col = !risky ? ROUTE_SAFE : k % 2 ? ROUTE_RISK_A : ROUTE_RISK_B;
        // offset every other lantern a little to either side so the line reads as markers, not a lane of buoys
        const tan = curve.getTangentAt(k / count);
        const side = (k % 2 ? 1 : -1) * 2.2;
        const x = p.x - tan.z * side, z = p.z + tan.x * side;
        routeLit.add(CYL6, '#2b2335', [x, 0.5, z], [0, 0, 0], [0.09, 1.0, 0.09], { gradient: 0.1 });
        routeLit.add(CYL6, '#2b2335', [x, 0.08, z], [0, 0, 0], [0.38, 0.22, 0.38], { gradient: 0 });
        routeEm.add(BOX, col, [x, 1.15, z], [0, 0, 0], [0.26, 0.34, 0.26], { jitter: 0, gradient: 0 });
        entries.push({ x, y: 1.15, z, size: 2.9, color: col, alpha: 0.85, flicker: 0.55, phase: (ri * 7 + k) * 0.137, fogFloor: 0.05 });
        this.stats.lanterns++;
      }
      ribbonGeos.push(ribbon(curve, length, risky ? ROUTE_RISK_A : ROUTE_SAFE, risky ? 0.9 : 1));
    });

    // ---- merged static meshes
    const litGeo = mergeAll([land.lit, marks.lit, routeLit.build()]);
    const emGeo = mergeAll([marks.emissive, routeEm.build()]);
    if (litGeo) {
      this.stats.landTris = litGeo.getAttribute('position').count / 3;
      this.root.add(this.staticMesh(litGeo, this.litMat, 0), ...(this.mirLitMat ? [this.staticMesh(litGeo, this.mirLitMat, -9)] : []));
    }
    if (emGeo) this.root.add(this.staticMesh(emGeo, this.emMat, 0), ...(this.mirEmMat ? [this.staticMesh(emGeo, this.mirEmMat, -9)] : []));
    const foamGeo = mergeAll([land.foam, foam.build(false)]);
    if (foamGeo) this.root.add(this.staticMesh(foamGeo, this.foamMat, -8));
    for (const g of ribbonGeos) {
      const m = new THREE.Mesh(g, this.track(createRibbonMaterial(u)));
      m.renderOrder = -7;
      m.frustumCulled = false;
      this.root.add(m);
    }

    // ---- trees + reeds
    const treeSpots = [...land.trees, ...marks.trees];
    const cap = low ? 150 : 420;
    const trimmed = treeSpots.length > cap ? shuffleTake(treeSpots, cap) : treeSpots;
    const treeMesh = instancedFromSpots(createTreeGeometry(low), trimmed);
    if (treeMesh) { this.root.add(treeMesh); this.stats.trees = trimmed.length; }
    const reedMesh = instancedFromSpots(createReedGeometry(), land.reeds, 0.2);
    if (reedMesh) { this.root.add(reedMesh); this.stats.reeds = land.reeds.length; }

    // ---- will-o-wisps drifting over the shallows (cheap atmosphere)
    for (const w of land.wisps) entries.push({ x: w.x, y: w.y, z: w.z, size: 2.2, color: '#79f0e6', alpha: 0.55, flicker: 0.9, fogFloor: 0.05 });

    // ---- finish beacon
    const f = course.finish;
    entries.push({ x: f.x, y: 4, z: f.z, size: 14, color: '#ffb347', alpha: 0.45, flicker: 0.2, fogFloor: 0.8 });
    this.ringA = ringMesh(f.x, f.z, finishRingR * 0.9, finishRingR, [1, 0.68, 0.28]);
    this.ringB = ringMesh(f.x, f.z, finishRingR * 0.5, finishRingR * 0.58, [1, 0.68, 0.28]);
    this.column = beamColumn(f.x, f.z, 70, 1.2, '#ffb347');
    this.root.add(this.ringA, this.ringB, this.column);

    // ---- light field (+ mirrored streaks on the water)
    const glowMat = createGlowFieldMaterial(u, false);
    const mirMat = low ? null : createGlowFieldMaterial(u, true);
    this.mats.push(glowMat);
    if (mirMat) this.mats.push(mirMat);
    this.lights = new BillboardField(Math.max(8, entries.length), glowMat, mirMat, 4);
    entries.forEach((e, i) => {
      const idx = this.lights.add(e);
      if (e.color === '#79f0e6' && idx >= 0) this.wispIdx.push({ i: idx, x: e.x, y: e.y, z: e.z, ph: i * 0.7 });
    });
    this.lights.flush();
    this.stats.lights = this.lights.count;
    this.root.add(this.lights.mesh);
    if (this.lights.mirror) this.root.add(this.lights.mirror);

    // ---- fog banks + low mist as soft billboard puffs
    const puffEntries: GlowEntry[] = [];
    const prand = mulberry32(99);
    for (const zone of course.fog) {
      const n = Math.min(low ? 7 : 20, Math.max(6, Math.round(zone.radius / 2.4)));
      const dens = zoneStrength(zone.density);
      for (let i = 0; i < n; i++) {
        const a = prand() * Math.PI * 2;
        const r = Math.sqrt(prand()) * zone.radius * 0.9;
        const w = 24 + prand() * 24;
        puffEntries.push({
          x: zone.x + Math.cos(a) * r, y: 1.6 + prand() * 2.8, z: zone.z + Math.sin(a) * r, size: w, sy: w * (0.3 + prand() * 0.18),
          color: prand() < 0.5 ? '#8790c8' : '#a4abd8', alpha: 0.2 + 0.22 * dens, phase: prand(),
        });
      }
    }
    const b = course.bounds;
    const mistN = low ? 6 : 22;
    for (let i = 0; i < mistN; i++) {
      puffEntries.push({
        x: b.minX + prand() * (b.maxX - b.minX), y: 0.9 + prand() * 1.2, z: b.minZ + prand() * (b.maxZ - b.minZ), size: 46 + prand() * 40, sy: 6 + prand() * 4,
        color: '#7580bd', alpha: 0.1 + prand() * 0.06, phase: prand(),
      });
    }
    if (puffEntries.length > 0) {
      const pm = createPuffFieldMaterial(u);
      this.mats.push(pm);
      this.puffs = new BillboardField(puffEntries.length, pm, null, 6);
      for (const e of puffEntries) this.puffs.add(e);
      this.puffs.flush();
      this.stats.puffs = puffEntries.length;
      this.root.add(this.puffs.mesh);
    } else this.puffs = null;

    // ---- current streaks
    const sg = createStreakGeometry(course.currents, low ? 14 : 30);
    if (sg) {
      this.streaks = new THREE.Mesh(sg, this.track(createStreakMaterial(u)));
      this.streaks.frustumCulled = false;
      this.streaks.renderOrder = -6;
      this.root.add(this.streaks);
    } else this.streaks = null;

    // ---- rotating beams (lighthouse, island beacon)
    for (const bm of marks.beams) {
      const pivot = new THREE.Group();
      pivot.position.set(bm.x, bm.y, bm.z);
      pivot.add(new THREE.Mesh(beamGeometry(bm.len, bm.width, bm.color), this.track(createBeamMaterial())));
      pivot.children[0].frustumCulled = false;
      this.root.add(pivot);
      this.beams.push({ pivot, speed: bm.speed, phase: bm.phase });
    }

    this.refreshObstacles(course.obstacles, new Set());
  }

  private track<T extends THREE.Material>(m: T): T {
    this.mats.push(m);
    return m;
  }

  private staticMesh(geo: THREE.BufferGeometry, mat: THREE.Material, order: number): THREE.Mesh {
    const m = new THREE.Mesh(geo, mat);
    m.renderOrder = order;
    m.frustumCulled = false;
    return m;
  }

  /**
   * (Re)builds the static (non-drifting) obstacle meshes from the run's current obstacle list: removed obstacles vanish,
   * displaced ones are drawn where they now are. Cheap (a few hundred primitives) and only called when the run reports a change.
   */
  refreshObstacles(obstacles: Obstacle[], removed: ReadonlySet<string>): void {
    for (const c of [...this.obstacleGroup.children]) this.obstacleGroup.remove(c);
    for (const g of this.obstacleGeos) g.dispose();
    this.obstacleGeos = [];
    const lit = new MeshBuilder(mulberry32(5));
    const em = new MeshBuilder(mulberry32(6));
    const foam = new TriBuilder();
    for (const o of obstacles) {
      if (o.drift || removed.has(o.id)) continue;
      addObstacle(lit, em, o);
      addObstacleFoam(foam, o);
    }
    const litGeo = lit.build();
    const emGeo = em.build();
    const foamGeo = foam.build(false);
    const add = (geo: THREE.BufferGeometry | null, mat: THREE.Material | null, order: number) => {
      if (!geo || !mat || geo.getAttribute('position')?.count === 0) { geo?.dispose(); return; }
      this.obstacleGeos.push(geo);
      this.obstacleGroup.add(this.staticMesh(geo, mat, order));
    };
    add(litGeo, this.litMat, 0);
    add(emGeo, this.emMat, 0);
    add(foamGeo, this.foamMat, -8);
    // mirrors share the geometry (not added to obstacleGeos twice)
    const mirror = (geo: THREE.BufferGeometry | null, mat: THREE.Material | null) => {
      if (geo && mat && geo.getAttribute('position')?.count > 0) this.obstacleGroup.add(this.staticMesh(geo, mat, -9));
    };
    mirror(litGeo, this.mirLitMat);
    mirror(emGeo, this.mirEmMat);
    // buoy lantern glows
    let dirty = false;
    for (const o of obstacles) {
      const i = this.buoyIdx.get(o.id);
      if (i === undefined) continue;
      this.lights.set(i, { x: o.x, y: 1.85, z: o.z, size: 2.6, color: '#f5b04c', alpha: removed.has(o.id) ? 0 : 0.8, flicker: 0.5, fogFloor: 0.1 });
      dirty = true;
    }
    if (dirty) this.lights.flush();
    for (const d of this.drifters) d.group.visible = !removed.has(d.o.id);
  }

  /** Per-frame: follows the boat, animates beams / drifting obstacles / rings. */
  update(boatX: number, boatZ: number, t: number, clock: number, lowMotion: boolean): void {
    this.water.position.set(boatX, 0, boatZ);
    this.sky.position.set(boatX, 0, boatZ);
    this.waterMat.uniforms.uTime.value = clock;
    this.waterMat.uniforms.uAnimate.value = this.opts.lowGraphics ? 0 : 1;
    this.skyMat.uniforms.uTime.value = clock;
    for (const d of this.drifters) {
      const p = obstacleWorldPos(d.o, t);
      d.group.position.set(p.x, Math.sin(clock * 1.3 + d.phase) * 0.05, p.z);
    }
    for (const b of this.beams) b.pivot.rotation.y = lowMotion ? b.phase : b.phase + clock * b.speed;
    const pulse = (clock * 0.9) % 1;
    const sA = 1 + pulse * 0.25;
    this.ringA.scale.setScalar(sA);
    (this.ringA.material as THREE.MeshBasicMaterial).opacity = (1 - pulse) * 0.55;
    const p2 = (clock * 0.9 + 0.5) % 1;
    this.ringB.scale.setScalar(1 + p2 * 0.9);
    (this.ringB.material as THREE.MeshBasicMaterial).opacity = (1 - p2) * 0.4;
    if (this.wispIdx.length) {
      for (const w of this.wispIdx) this.lights.update(w.i, w.x + Math.sin(clock * 0.4 + w.ph) * 1.2, w.y + Math.sin(clock * 0.9 + w.ph) * 0.35, w.z + Math.cos(clock * 0.33 + w.ph) * 1.2, 2.2, 0.5 + 0.2 * Math.sin(clock * 3 + w.ph));
      this.lights.flush();
    }
  }

  get moonDir(): THREE.Vector3 {
    return this.waterMat.uniforms.uMoonDir.value as THREE.Vector3;
  }

  /** Allocation-free mood update from plain sRGB triples (sky + water reflection horizon/zenith). */
  setMoodRGB(h: readonly [number, number, number], z: readonly [number, number, number]): void {
    (this.waterMat.uniforms.uHorizon.value as THREE.Vector3).set(h[0], h[1], h[2]);
    (this.waterMat.uniforms.uZenith.value as THREE.Vector3).set(z[0], z[1], z[2]);
    (this.skyMat.uniforms.uHorizon.value as THREE.Vector3).set(h[0], h[1], h[2]);
    (this.skyMat.uniforms.uZenith.value as THREE.Vector3).set(z[0], z[1], z[2]);
  }

  setMood(horizon: string, zenith: string): void {
    const c = new THREE.Color(horizon);
    const z = new THREE.Color(zenith);
    // shaders take plain sRGB values
    const toV = (col: THREE.Color) => new THREE.Vector3(Math.pow(col.r, 1 / 2.2), Math.pow(col.g, 1 / 2.2), Math.pow(col.b, 1 / 2.2));
    this.waterMat.uniforms.uHorizon.value = toV(c);
    this.waterMat.uniforms.uZenith.value = toV(z);
    this.skyMat.uniforms.uHorizon.value = toV(c);
    this.skyMat.uniforms.uZenith.value = toV(z);
  }

  dispose(): void {
    this.lights.dispose();
    this.puffs?.dispose();
    disposeObject(this.root);
    for (const m of this.mats) m.dispose();
    this.waterMat.dispose();
    this.skyMat.dispose();
  }
}

/** Fog zone density units differ between the Phase 1 course (0.03) and the lake design (0..1); normalise to 0..1. */
export function zoneStrength(density: number): number {
  return density > 0.2 ? Math.min(1, density) : Math.min(1, density / 0.04);
}

/** Scene-fog density added for a run-reported fog level. */
export function fogToSceneDensity(level: number): number {
  return level > 0.2 ? Math.min(1, level) * 0.05 : level * 1.3;
}

function shuffleTake<T>(arr: T[], n: number): T[] {
  const rand = mulberry32(arr.length + 5);
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy.slice(0, n);
}

function ringStrip(tb: TriBuilder, cx: number, cz: number, r0: number, r1: number, strong: V3): void {
  const N = 28;
  const up: V3 = [0, 1, 0];
  for (let i = 0; i < N; i++) {
    const a0 = (i / N) * Math.PI * 2, a1 = ((i + 1) / N) * Math.PI * 2;
    const p = (a: number, r: number): V3 => [cx + Math.cos(a) * r, 0.07, cz + Math.sin(a) * r];
    tb.triC(p(a0, r0), p(a1, r0), p(a1, r1), strong, strong, [0, 0, 0], up);
    tb.triC(p(a0, r0), p(a1, r1), p(a0, r1), strong, [0, 0, 0], [0, 0, 0], up);
  }
}

function ringMesh(x: number, z: number, r0: number, r1: number, rgb: V3): THREE.Mesh {
  const g = new THREE.RingGeometry(r0, r1, 48, 1).rotateX(-Math.PI / 2);
  const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: new THREE.Color(rgb[0], rgb[1], rgb[2]), transparent: true, opacity: 0.5, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false }));
  m.position.set(x, 0.14, z);
  m.frustumCulled = false;
  return m;
}

function beamColumn(x: number, z: number, h: number, r: number, hex: string): THREE.Mesh {
  const g = new THREE.CylinderGeometry(r * 0.5, r, h, 10, 1, true);
  const pos = g.getAttribute('position');
  const col = new Float32Array(pos.count * 3);
  const c = new THREE.Color(hex);
  for (let i = 0; i < pos.count; i++) {
    const t = (pos.getY(i) + h / 2) / h;
    const k = Math.pow(1 - t, 1.5) * 0.5;
    col[i * 3] = c.r * k; col[i * 3 + 1] = c.g * k; col[i * 3 + 2] = c.b * k;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const m = new THREE.Mesh(g, createBeamMaterial());
  m.position.set(x, h / 2, z);
  m.frustumCulled = false;
  return m;
}

function beamGeometry(len: number, width: number, hex: string): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(width, 0.25, len, 8, 1, true);
  g.rotateZ(-Math.PI / 2);
  g.translate(len / 2, 0, 0);
  const pos = g.getAttribute('position');
  const col = new Float32Array(pos.count * 3);
  const c = new THREE.Color(hex);
  for (let i = 0; i < pos.count; i++) {
    const t = pos.getX(i) / len;
    const k = Math.pow(1 - t, 1.6) * 0.42 * (t < 0.04 ? t / 0.04 : 1);
    col[i * 3] = c.r * k; col[i * 3 + 1] = c.g * k; col[i * 3 + 2] = c.b * k;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}

function ribbon(curve: THREE.CatmullRomCurve3, length: number, hex: string, strength: number): THREE.BufferGeometry {
  const n = Math.max(4, Math.round(length / 2.5));
  const pos: number[] = [], col: number[] = [], uv: number[] = [], idx: number[] = [];
  const c = new THREE.Color(hex);
  const w = 1.7;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const p = curve.getPointAt(t);
    const tan = curve.getTangentAt(t);
    const nx = -tan.z, nz = tan.x;
    pos.push(p.x + nx * w, 0.09, p.z + nz * w, p.x - nx * w, 0.09, p.z - nz * w);
    col.push(c.r * strength, c.g * strength, c.b * strength, c.r * strength, c.g * strength, c.b * strength);
    uv.push(t * length, 0, t * length, 1);
    if (i < n) {
      const a = i * 2;
      idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

