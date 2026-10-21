// Static island: builds every merged mesh from the MapDef and owns the few dynamic world elements (roof fades, the Shortcut gate
// portcullis, Gomez's switch, deposit-circle runes, fog puffs). The scene calls `update` once per frame.
import * as THREE from 'three';
import type { MapDef, RoomId } from '../../mystery/types.ts';
import { lambertVC, basicVC } from '../actors.ts';
import { damp, mulberry32 } from '../util.ts';
import { BillboardField, createGlowFieldMaterial, createPuffFieldMaterial, type FxUniforms } from '../action/fx.ts';
import { pointInPoly } from '../action/geom.ts';
import { buildDressing, type DressingBuild } from './dressing.ts';
import { buildTerrain } from './terrain.ts';
import { buildWallsAndCover } from './walls.ts';
import { BOX, CYL6, CYL8, ICO0, PAL, seeded } from './common.ts';
import { MeshBuilder } from '../util.ts';
import { TriGrid } from './occlusion.ts';

export interface WorldFrame {
  dt: number;
  clock: number;
  /** 0..1: the player is hidden inside a hiding spot (its model fades so the player stays visible) */
  hiddenK?: number;
  playerRoom: RoomId | null;
  playerX: number;
  playerZ: number;
  gateOpen: boolean;
  switchPowered: boolean;
  /** 0..1 brightness of the deposit runes (carrying the egg / standing in the circle) */
  depositGlow: number;
  reduced: boolean;
}

export class MysteryWorld {
  readonly root = new THREE.Group();
  readonly dress: DressingBuild;
  /** camera occlusion structures: solid world geometry, and the hiding-spot models (ignored while the player is hidden) */
  readonly occSolid: TriGrid;
  readonly occHide: TriGrid;
  /** meshes that are solid for the camera (tooling raycasts them to verify the player is never hidden) */
  readonly solidMeshes: THREE.Mesh[] = [];
  hideMesh: THREE.Mesh | null = null;
  private hideMat: THREE.MeshLambertMaterial | null = null;
  private hideFade = 0;
  readonly glowStatic: BillboardField | null = null;
  private readonly geos: THREE.BufferGeometry[] = [];
  private readonly mats: THREE.Material[] = [];
  private readonly roofs: { roomId: string; mesh: THREE.Mesh; mat: THREE.MeshLambertMaterial; o: number }[] = [];
  private gateBars: THREE.Mesh | null = null;
  private gateOpen = 0;
  private gateH = 3;
  private lever: THREE.Group | null = null;
  private bulbMat: THREE.MeshBasicMaterial | null = null;
  private leverK = 0;
  private runeMat: THREE.MeshBasicMaterial | null = null;
  private shrineMat: THREE.MeshBasicMaterial | null = null;
  private poolMat: THREE.MeshBasicMaterial | null = null;
  private puffs: BillboardField | null = null;
  private puffMat: THREE.ShaderMaterial | null = null;
  private readonly wetMats: THREE.MeshBasicMaterial[] = [];
  readonly switchPos: { x: number; y: number; z: number } | null;

  constructor(readonly map: MapDef, fx: FxUniforms, readonly low: boolean) {
    this.dress = buildDressing(map, low);
    const dress = this.dress;
    const skip = new Set<string>(map.powerSwitch ? [map.powerSwitch.gateWallId] : []);
    const lit = lambertVC();
    const em = basicVC();
    const decalMat = lambertVC({ polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    const glassMat = new THREE.MeshLambertMaterial({ vertexColors: true, transparent: true, opacity: 0.2, depthWrite: false, flatShading: true, emissive: new THREE.Color('#1a3a30'), side: THREE.DoubleSide });
    this.mats.push(lit, em, decalMat, glassMat);

    const addMesh = (g: THREE.BufferGeometry | null, m: THREE.Material, order = 0): THREE.Mesh | null => {
      if (!g) return null;
      this.geos.push(g);
      const mesh = new THREE.Mesh(g, m);
      mesh.renderOrder = order;
      this.root.add(mesh);
      return mesh;
    };

    // ---- terrain + decals + scatter
    const terrain = buildTerrain(map, dress.piers, low);
    addMesh(terrain.ground, lit);
    addMesh(terrain.decals, decalMat, 1);
    addMesh(terrain.scatter, lit);

    // ---- walls + cover (gate wall excluded: drawn as a dynamic portcullis)
    const wallsGeo = buildWallsAndCover(map, low, skip);
    const wallsMesh = addMesh(wallsGeo, lit);
    if (wallsMesh) this.solidMeshes.push(wallsMesh);

    // ---- dressing: landmarks, hiding spots, rooms, props
    const dressLit = dress.col.mergedLit();
    const dressMesh = addMesh(dressLit, lit);
    if (dressMesh) this.solidMeshes.push(dressMesh);
    addMesh(dress.col.mergedEm(), em);
    const hideLit = dress.hide.mergedLit();
    this.hideMat = lambertVC({ transparent: false });
    this.mats.push(this.hideMat);
    this.hideMesh = addMesh(hideLit, this.hideMat, 1);
    addMesh(dress.hide.mergedEm(), em);
    for (const gl of dress.hide.glows) dress.col.glows.push(gl);
    const glass = dress.col.mergedGlass();
    if (glass) addMesh(glass, glassMat, 2);

    // ---- glow pools / runes
    this.poolMat = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });
    this.runeMat = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false, opacity: 0.6, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });
    this.shrineMat = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false, opacity: 0.7, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });
    this.mats.push(this.poolMat, this.runeMat, this.shrineMat);
    addMesh(dress.pools, this.poolMat, 2);
    addMesh(dress.runes, this.runeMat, 2);
    addMesh(dress.shrineRunes, this.shrineMat, 2);

    // ---- roofs (fade out when the player is inside)
    for (const r of dress.roofs) {
      const mat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, side: THREE.DoubleSide, transparent: true, opacity: 1 });
      this.mats.push(mat);
      this.geos.push(r.geo);
      const mesh = new THREE.Mesh(r.geo, mat);
      this.root.add(mesh);
      this.roofs.push({ roomId: r.roomId, mesh, mat, o: 1 });
    }

    // ---- gate
    let gatePosts: THREE.BufferGeometry | null = null;
    if (dress.gate) {
      const g = dress.gate;
      gatePosts = g.posts;
      const gp = addMesh(g.posts, lit);
      if (gp) this.solidMeshes.push(gp);
      if (g.bars) {
        this.geos.push(g.bars);
        this.gateBars = new THREE.Mesh(g.bars, lit);
        this.gateH = g.wall.height + 0.4;
        this.root.add(this.gateBars);
      }
    }

    this.occSolid = new TriGrid([wallsGeo, dressLit, gatePosts]);
    this.occHide = new TriGrid([hideLit]);

    // ---- power switch
    this.switchPos = null;
    if (map.powerSwitch && dress.swtch) {
      const s = dress.swtch;
      const rand = seeded('switch');
      const body = new MeshBuilder(rand);
      body.add(BOX, PAL.stoneDark, [0, 0.55, 0], [0, 0, 0], [0.7, 1.1, 0.4], { gradient: 0.3 });
      body.add(BOX, '#2c3250', [0, 1.14, 0], [0, 0, 0], [0.8, 0.1, 0.5], { gradient: 0 });
      body.add(BOX, '#3a3f5c', [0, 0.7, -0.21], [0, 0, 0], [0.5, 0.5, 0.04], { gradient: 0.1 });
      for (let i = 0; i < 5; i++) body.add(CYL8, '#b87333', [0, 1.24 + i * 0.07, 0], [0, 0, 0], [0.16 - i * 0.012, 0.05, 0.16 - i * 0.012], { gradient: 0, jitter: 0.05 });
      body.add(CYL6, PAL.iron, [0.24, 1.0, -0.12], [0, 0, 0], [0.025, 0.3, 0.025], { gradient: 0 });
      body.add(CYL6, PAL.iron, [-0.24, 1.0, -0.12], [0, 0, 0], [0.025, 0.3, 0.025], { gradient: 0 });
      const bg = body.build();
      this.geos.push(bg);
      const grp = new THREE.Group();
      grp.position.set(s.x, 0, s.z);
      grp.rotation.y = s.yaw;
      grp.add(new THREE.Mesh(bg, lit));
      // lever + bulb (dynamic)
      const lever = new THREE.Group();
      lever.position.set(0, 0.7, -0.24);
      const lb = new MeshBuilder(rand);
      lb.add(CYL6, '#9aa0b8', [0, 0.17, 0], [0, 0, 0], [0.02, 0.34, 0.02], { gradient: 0 });
      lb.add(ICO0, '#e8c050', [0, 0.36, 0], [0, 0, 0], 0.045, { gradient: 0, jitter: 0 });
      const lg = lb.build();
      this.geos.push(lg);
      lever.add(new THREE.Mesh(lg, lit));
      grp.add(lever);
      this.lever = lever;
      this.bulbMat = new THREE.MeshBasicMaterial({ color: new THREE.Color('#3a3040') });
      this.mats.push(this.bulbMat);
      const bulbGeo = new THREE.IcosahedronGeometry(0.1, 1);
      this.geos.push(bulbGeo);
      const bulb = new THREE.Mesh(bulbGeo, this.bulbMat);
      bulb.position.set(0, 1.68, 0);
      grp.add(bulb);
      this.root.add(grp);
      this.switchPos = { x: s.x, y: 1.68, z: s.z };
    }

    // ---- shallow water sheets over flooded rooms (egg chamber)
    for (const room of map.rooms) {
      if (!room.wet || room.id === 'pier') continue;
      const contour = room.polygon.map((q) => new THREE.Vector2(q.x, q.z));
      const tris = THREE.ShapeUtils.triangulateShape(contour, []);
      const pos: number[] = [];
      for (const [i, j, k] of tris) {
        for (const q of [contour[i], contour[j], contour[k]]) pos.push(q.x, 0.075, q.y);
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.computeVertexNormals();
      const wm = new THREE.MeshBasicMaterial({ color: new THREE.Color('#2c5aa8'), transparent: true, opacity: 0.26, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3, side: THREE.DoubleSide });
      this.mats.push(wm);
      this.wetMats.push(wm);
      addMesh(g, wm, 2);
    }

    // ---- static glows (lamps, windows, braziers, mushrooms)
    const glows = [...dress.col.glows, ...terrain.scatterGlows];
    if (glows.length) {
      const mat = createGlowFieldMaterial(fx, false);
      this.mats.push(mat);
      const field = new BillboardField(glows.length, mat, null, 3);
      glows.forEach((g) => field.add(g));
      field.flush();
      this.glowStatic = field;
      this.root.add(field.mesh);
    }

    // ---- fog puffs in fog rooms (and a thin mist along the path in normal graphics)
    if (!low) {
      const rand = mulberry32(4242);
      const pm = createPuffFieldMaterial(fx);
      this.puffMat = pm;
      const entries: { x: number; y: number; z: number; size: number; color: string; alpha: number; phase: number }[] = [];
      for (const room of map.rooms) {
        if (!room.fog) continue;
        const xs = room.polygon.map((p) => p.x), zs = room.polygon.map((p) => p.z);
        const x0 = Math.min(...xs), x1 = Math.max(...xs), z0 = Math.min(...zs), z1 = Math.max(...zs);
        for (let x = x0; x <= x1; x += 4.8) {
          for (let z = z0; z <= z1; z += 4.8) {
            const px = x + (rand() - 0.5) * 2.4, pz = z + (rand() - 0.5) * 2.4;
            if (!pointInPoly(room.polygon, px, pz)) continue;
            entries.push({ x: px, y: 0.4 + rand() * 1.1, z: pz, size: 4.5 + rand() * 3, color: '#6f93a8', alpha: 0.3, phase: rand() });
          }
        }
      }
      for (let i = 0; i < 14; i++) {
        const b = map.bounds;
        entries.push({ x: b.minX + rand() * (b.maxX - b.minX), y: 0.3 + rand() * 0.6, z: b.minZ + rand() * (b.maxZ - b.minZ), size: 7 + rand() * 5, color: '#5d7490', alpha: 0.12, phase: rand() });
      }
      if (entries.length) {
        const f = new BillboardField(entries.length, pm, null, 2);
        for (const e of entries) f.add({ x: e.x, y: e.y, z: e.z, size: e.size, sy: e.size * 0.6, color: e.color, alpha: e.alpha, phase: e.phase });
        f.flush();
        this.puffs = f;
        this.root.add(f.mesh);
      }
    }
  }

  update(f: WorldFrame): void {
    const { dt } = f;
    for (const r of this.roofs) {
      const inside = f.playerRoom === r.roomId;
      r.o = damp(r.o, inside ? 0 : 1, 6, dt);
      r.mat.opacity = r.o;
      r.mat.transparent = r.o < 0.985; // opaque while closed: no transparent-pass overdraw
      r.mesh.visible = r.o > 0.02;
    }
    if (this.gateBars) {
      this.gateOpen = damp(this.gateOpen, f.gateOpen ? 1 : 0, 2.5, dt);
      this.gateBars.position.y = this.gateOpen * this.gateH * 0.96;
      this.gateBars.visible = this.gateOpen < 0.99;
    }
    if (this.lever && this.bulbMat) {
      this.leverK = damp(this.leverK, f.switchPowered ? 1 : 0, 8, dt);
      this.lever.rotation.x = 0.9 - this.leverK * 1.8;
      const flick = f.switchPowered ? 0.75 + 0.25 * Math.sin(f.clock * 22) : 0;
      this.bulbMat.color.setRGB(0.2 + 0.8 * flick, 0.17 + 0.75 * flick, 0.22 + 0.2 * flick);
    }
    const pulse = f.reduced ? 0.8 : 0.78 + 0.22 * Math.sin(f.clock * 2.2);
    if (this.runeMat) this.runeMat.opacity = (0.45 + 0.9 * f.depositGlow) * pulse;
    if (this.shrineMat) this.shrineMat.opacity = (0.55 * pulse + 0.1) * (f.reduced ? 1 : 0.9 + 0.1 * Math.sin(f.clock * 1.1));
    if (this.poolMat) this.poolMat.opacity = 0.9;
    if (this.hideMat) {
      this.hideFade = damp(this.hideFade, f.hiddenK ?? 0, 8, dt);
      this.hideMat.opacity = 1 - 0.8 * this.hideFade;
      this.hideMat.transparent = this.hideFade > 0.02;
      this.hideMat.depthWrite = this.hideFade < 0.5;
    }
    for (const m of this.wetMats) m.opacity = f.reduced ? 0.26 : 0.24 + Math.sin(f.clock * 1.3) * 0.04;
  }

  gateProgress(): number { return this.gateOpen; }

  dispose(): void {
    for (const g of this.geos) g.dispose();
    for (const m of this.mats) m.dispose();
    this.glowStatic?.dispose();
    this.puffs?.dispose();
    this.puffMat?.dispose();
  }
}
