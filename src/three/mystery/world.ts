// Static island: builds every merged mesh from the MapDef and owns the few dynamic world elements (roof fades, the Shortcut gate
// portcullis, Gomez's switch, deposit-circle runes, fog puffs). The scene calls `update` once per frame.
import * as THREE from 'three';
import type { MapDef, RoomId } from '../../mystery/types.ts';
import { lambertVC, basicVC } from '../actors.ts';
import { damp, mulberry32 } from '../util.ts';
import { BillboardField, createGlowFieldMaterial, createPuffFieldMaterial, type FxUniforms } from '../action/fx.ts';
import { mergeAll, pointInPoly } from '../action/geom.ts';
import { buildDressing, type DressingBuild } from './dressing.ts';
import { buildTerrain } from './terrain.ts';
import { buildWallParts, buildWallsAndCover } from './walls.ts';
import { BOX, CYL6, CYL8, ICO0, PAL, distPointSeg, seeded } from './common.ts';
import { MeshBuilder } from '../util.ts';
import { TriGrid } from './occlusion.ts';
import { gradeGeometry, gradeHex, themeOf, type CaseLook } from './look.ts';
import { makeBookTexture } from './wallStyles.ts';
import { EXAMINE_PROPS, buildHazardDecals, leverArmGeometry } from './interactables.ts';
import { SITE_PROPS } from './siteProps.ts';
import type { GlowEntry } from '../action/fx.ts';

export interface WorldFrame {
  dt: number;
  clock: number;
  /** 0..1: the player is hidden inside a hiding spot (its model fades so the player stays visible) */
  hiddenK?: number;
  playerRoom: RoomId | null;
  playerX: number;
  playerZ: number;
  gateOpen: boolean;
  /** the hidden passage's wall has been opened (lever pulled) */
  passageOpen: boolean;
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
  /** the hidden passage: its wall (slides into the ground when opened) and the pull lever's arm */
  private passage: THREE.Group | null = null;
  private passageH = 3;
  private passageK = 0;
  private passageArm: THREE.Group | null = null;
  private armK = 0;
  /** inverted-hull outline geometry of the power switch (the scene highlights it when it is the interactable) */
  switchHull: THREE.BufferGeometry | null = null;
  private bookTex: THREE.Texture | null = null;
  private hazardPuddle: THREE.MeshBasicMaterial | null = null;
  /** true while the passage wall is still (partly) standing: the camera must not pass through it */
  readonly occPassage: TriGrid | null;
  private runeMat: THREE.MeshBasicMaterial | null = null;
  private shrineMat: THREE.MeshBasicMaterial | null = null;
  private poolMat: THREE.MeshBasicMaterial | null = null;
  private puffs: BillboardField | null = null;
  private puffMat: THREE.ShaderMaterial | null = null;
  private readonly wetMats: THREE.MeshBasicMaterial[] = [];
  readonly switchPos: { x: number; y: number; z: number } | null;

  constructor(readonly map: MapDef, fx: FxUniforms, readonly low: boolean, readonly look: CaseLook) {
    this.dress = buildDressing(map, low);
    const dress = this.dress;
    const theme = themeOf(map);
    const passageWall = map.world?.passage ? map.walls.find((w) => w.id === map.world?.passage?.wallId) ?? null : null;
    const skip = new Set<string>([...(map.powerSwitch ? [map.powerSwitch.gateWallId] : []), ...(passageWall ? [passageWall.id] : [])]);
    const lit = lambertVC();
    const em = basicVC();
    const decalMat = lambertVC({ polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    const glassMat = new THREE.MeshLambertMaterial({ vertexColors: true, transparent: true, opacity: 0.2, depthWrite: false, flatShading: true, emissive: new THREE.Color('#1a3a30'), side: THREE.DoubleSide, forceSinglePass: true });
    this.mats.push(lit, em, decalMat, glassMat);

    const addMesh = (g: THREE.BufferGeometry | null, m: THREE.Material, order = 0): THREE.Mesh | null => {
      if (!g) return null;
      this.geos.push(g);
      const mesh = new THREE.Mesh(g, m);
      mesh.renderOrder = order;
      this.root.add(mesh);
      return mesh;
    };

    // Static lit / emissive geometry that shares a material is collected here and drawn as ONE mesh each (fewer draw calls and state changes).
    const litParts: (THREE.BufferGeometry | null)[] = [];
    const emParts: (THREE.BufferGeometry | null)[] = [];
    const keep = (g: THREE.BufferGeometry | null, into: (THREE.BufferGeometry | null)[]): THREE.BufferGeometry | null => { if (g) { this.geos.push(g); into.push(g); } return g; };

    // ---- terrain + decals + scatter
    const terrain = buildTerrain(map, dress.piers, low);
    const G = look.grade;
    keep(gradeGeometry(terrain.ground, G.ground), litParts);
    addMesh(gradeGeometry(terrain.decals, G.ground), decalMat, 1);
    keep(gradeGeometry(terrain.scatter, G.ground), litParts);

    // ---- walls + cover (gate wall excluded: drawn as a dynamic portcullis)
    const wb = buildWallsAndCover(map, low, skip, theme);
    const wallsGeo = gradeGeometry(wb.lit, G.walls);
    keep(wallsGeo, litParts);
    keep(gradeGeometry(wb.em, G.glow), emParts);
    addMesh(wb.glass, glassMat, 2);
    if (wb.shelf) {
      this.bookTex = makeBookTexture();
      const shelfMat = new THREE.MeshLambertMaterial({ map: this.bookTex ?? undefined, vertexColors: true, color: 0xffffff, emissive: new THREE.Color('#201810'), emissiveIntensity: 0.5 });
      this.mats.push(shelfMat);
      addMesh(wb.shelf, shelfMat);
    }
    dress.col.glows.push(...wb.glows);

    // ---- dressing: landmarks, hiding spots, rooms, props
    const dressLit = gradeGeometry(dress.col.mergedLit(), G.dress);
    keep(dressLit, litParts);
    keep(gradeGeometry(dress.col.mergedEm(), G.glow), emParts);
    const dressShelf = dress.shelf.build();
    if (dressShelf) {
      if (!this.bookTex) this.bookTex = makeBookTexture();
      const shelfMat = new THREE.MeshLambertMaterial({ map: this.bookTex ?? undefined, vertexColors: true, color: 0xffffff, emissive: new THREE.Color('#201810'), emissiveIntensity: 0.5 });
      this.mats.push(shelfMat);
      addMesh(dressShelf, shelfMat);
    }
    const hideLit = gradeGeometry(dress.hide.mergedLit(), G.dress);
    this.hideMat = lambertVC({ transparent: false });
    this.mats.push(this.hideMat);
    this.hideMesh = addMesh(hideLit, this.hideMat, 1);
    keep(gradeGeometry(dress.hide.mergedEm(), G.glow), emParts);
    for (const gl of dress.hide.glows) dress.col.glows.push(gl);
    const glass = dress.col.mergedGlass();
    if (glass) addMesh(glass, glassMat, 2);

    // ---- hazard floor decals (noisy floors: glass / boards / rubble / puddles), never part of the camera occluders
    const hz = buildHazardDecals(map.world?.hazards ?? [], low);
    keep(hz.lit, litParts);
    keep(hz.em, emParts);
    if (hz.puddle) {
      this.hazardPuddle = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.55, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3, side: THREE.DoubleSide, forceSinglePass: true });
      this.mats.push(this.hazardPuddle);
      addMesh(hz.puddle, this.hazardPuddle, 1);
    }
    for (const g of hz.glows) dress.col.glows.push({ ...g, fogFloor: 0.05 });

    // ---- soft contact shadows: dark gradient along wall bases and under props (one transparent mesh, vertex alpha)
    const ao = buildContactShadows(map, dress, low);
    if (ao) {
      const aoMat = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
      this.mats.push(aoMat);
      addMesh(ao, aoMat, 1);
    }

    // ---- hidden passage: the wall (dynamic, slides into the ground) and the lever arm
    this.occPassage = null;
    if (passageWall) {
      const pb = buildWallParts(map, passageWall, theme);
      this.passage = new THREE.Group();
      this.passageH = passageWall.height + 0.5;
      const pl = gradeGeometry(pb.lit, G.walls);
      for (const [g, m] of [[pl, lit], [gradeGeometry(pb.em, G.glow), em], [pb.glass, glassMat]] as const) {
        if (!g) continue;
        this.geos.push(g);
        this.passage.add(new THREE.Mesh(g, m));
      }
      if (pb.shelf) {
        if (!this.bookTex) this.bookTex = makeBookTexture();
        const shelfMat = new THREE.MeshLambertMaterial({ map: this.bookTex ?? undefined, vertexColors: true, color: 0xffffff, emissive: new THREE.Color('#201810'), emissiveIntensity: 0.5 });
        this.mats.push(shelfMat);
        this.geos.push(pb.shelf);
        this.passage.add(new THREE.Mesh(pb.shelf, shelfMat));
      }
      this.root.add(this.passage);
      this.occPassage = new TriGrid([pl]);
    }
    if (dress.extras.lever) {
      const lv = dress.extras.lever;
      const arm = leverArmGeometry();
      this.geos.push(arm);
      this.passageArm = new THREE.Group();
      this.passageArm.position.set(lv.x, 0.8, lv.z);
      this.passageArm.rotation.y = lv.yaw;
      const pivot = new THREE.Group();
      pivot.position.set(0, 0, -0.18);
      pivot.add(new THREE.Mesh(arm, lit));
      this.passageArm.add(pivot);
      this.root.add(this.passageArm);
    }

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
      const mat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, side: THREE.DoubleSide, forceSinglePass: true, transparent: true, opacity: 1 });
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
      keep(g.posts, litParts);
      if (g.bars) {
        this.geos.push(g.bars);
        this.gateBars = new THREE.Mesh(g.bars, lit);
        this.gateH = g.wall.height + 0.4;
        this.root.add(this.gateBars);
      }
    }

    {
      const ml = mergeAll(litParts), me = mergeAll(emParts);
      const lm = addMesh(ml, lit);
      if (lm) this.solidMeshes.push(lm);
      addMesh(me, em);
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
      const hullG = bg.clone();
      hullG.deleteAttribute('color');
      this.switchHull = hullG;
      this.geos.push(hullG);
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
      const wm = new THREE.MeshBasicMaterial({ color: new THREE.Color('#2c5aa8'), transparent: true, opacity: 0.26, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3, side: THREE.DoubleSide, forceSinglePass: true });
      this.mats.push(wm);
      this.wetMats.push(wm);
      addMesh(g, wm, 2);
    }

    // ---- static glows (lamps, windows, braziers, mushrooms)
    const glows: GlowEntry[] = [...dress.col.glows, ...terrain.scatterGlows].map((g) => ({
      ...g, color: gradeHex(g.color, G.glow), flicker: Math.min(1, (g.flicker ?? 0) * look.glowFlicker),
    }));
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
      const G = look.grade;
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
            entries.push({ x: px, y: 0.4 + rand() * 1.1, z: pz, size: 4.5 + rand() * 3, color: gradeHex('#6f93a8', G.glow), alpha: 0.3, phase: rand() });
          }
        }
      }
      for (let i = 0; i < 14; i++) {
        const b = map.bounds;
        entries.push({ x: b.minX + rand() * (b.maxX - b.minX), y: 0.3 + rand() * 0.6, z: b.minZ + rand() * (b.maxZ - b.minZ), size: 7 + rand() * 5, color: gradeHex('#5d7490', G.glow), alpha: 0.12, phase: rand() });
      }
      if (entries.length) {
        const f = new BillboardField(entries.length, pm, null, 2);
        for (const e of entries) f.add({ x: e.x, y: e.y, z: e.z, size: e.size, sy: e.size * 0.6, color: e.color, alpha: e.alpha, phase: e.phase });
        f.flush();
        this.puffs = f;
        this.root.add(f.mesh);
      }
    }

    // static world: freeze the local matrices (only the passage wall, the portcullis and the lever arm ever move)
    const dynamic = new Set<THREE.Object3D>();
    for (const x of [this.passage, this.gateBars, this.passageArm]) if (x) dynamic.add(x);
    for (const c of this.root.children) {
      if (dynamic.has(c)) continue;
      c.updateMatrix();
      c.matrixAutoUpdate = false;
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
    if (this.passage) {
      this.passageK = damp(this.passageK, f.passageOpen ? 1 : 0, 1.7, dt);
      this.passage.position.y = -this.passageK * this.passageH;
      this.passage.visible = this.passageK < 0.985;
    }
    if (this.passageArm) {
      this.armK = damp(this.armK, f.passageOpen ? 1 : 0, 6, dt);
      this.passageArm.children[0].rotation.x = 0.7 - 1.4 * this.armK;
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

  /** distance to the first solid triangle along a ray (static world + the passage wall while it still stands) */
  solidHit(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, maxT: number, minT = 0): number {
    let t = this.occSolid.firstHit(ox, oy, oz, dx, dy, dz, maxT, minT);
    if (this.occPassage && this.passageK < 0.6) t = Math.min(t, this.occPassage.firstHit(ox, oy, oz, dx, dy, dz, maxT, minT));
    return t;
  }

  /** 0..1 how far the passage wall has sunk (0 = standing) */
  passageProgress(): number { return this.passageK; }

  dispose(): void {
    for (const g of this.geos) g.dispose();
    for (const m of this.mats) m.dispose();
    this.bookTex?.dispose();
    this.glowStatic?.dispose();
    this.puffs?.dispose();
    this.puffMat?.dispose();
  }
}

/** Soft dark gradients along wall bases and under props / cover: a cheap ambient-occlusion fake (one mesh, vertex alpha). */
function buildContactShadows(map: MapDef, dress: DressingBuild, low: boolean): THREE.BufferGeometry | null {
  const pos: number[] = [];
  const col: number[] = [];
  const Y = 0.075;
  const vert = (x: number, z: number, a: number): void => { pos.push(x, Y, z); col.push(0, 0, 0, a); };
  const tri = (ax: number, az: number, aa: number, bx: number, bz: number, ba: number, cx: number, cz: number, ca: number): void => {
    // wind so the face looks up (+Y)
    const ny = (bz - az) * (cx - ax) - (bx - ax) * (cz - az);
    if (ny >= 0) { vert(ax, az, aa); vert(bx, bz, ba); vert(cx, cz, ca); } else { vert(ax, az, aa); vert(cx, cz, ca); vert(bx, bz, ba); }
  };
  const skip = new Set<string>([map.powerSwitch?.gateWallId ?? '', map.world?.passage?.wallId ?? '']);
  const reach = low ? 0.8 : 1.1;
  for (const w of map.walls) {
    if (skip.has(w.id) || w.kind === 'cliff' || w.height < 1.0) continue;
    const dx = w.b.x - w.a.x, dz = w.b.z - w.a.z, l = Math.hypot(dx, dz) || 1;
    const ux = dx / l, uz = dz / l, nx = -uz, nz = ux;
    const e = w.thickness / 2;
    for (const sd of [1, -1]) {
      const a0x = w.a.x - ux * e + nx * sd * (e - 0.02), a0z = w.a.z - uz * e + nz * sd * (e - 0.02);
      const b0x = w.b.x + ux * e + nx * sd * (e - 0.02), b0z = w.b.z + uz * e + nz * sd * (e - 0.02);
      const a1x = a0x + nx * sd * reach, a1z = a0z + nz * sd * reach, b1x = b0x + nx * sd * reach, b1z = b0z + nz * sd * reach;
      tri(a0x, a0z, 0.5, a1x, a1z, 0, b1x, b1z, 0);
      tri(a0x, a0z, 0.5, b1x, b1z, 0, b0x, b0z, 0.5);
    }
  }
  const blob = (x: number, z: number, r0: number, r1: number, a: number): void => {
    const N = 10;
    for (let i = 0; i < N; i++) {
      const t0 = (i / N) * Math.PI * 2, t1 = ((i + 1) / N) * Math.PI * 2;
      const c0 = Math.cos(t0), s0 = Math.sin(t0), c1 = Math.cos(t1), s1 = Math.sin(t1);
      tri(x + c0 * r0, z + s0 * r0, a, x + c0 * r1, z + s0 * r1, 0, x + c1 * r1, z + s1 * r1, 0);
      tri(x + c0 * r0, z + s0 * r0, a, x + c1 * r1, z + s1 * r1, 0, x + c1 * r0, z + s1 * r0, a);
      tri(x, z, a, x + c0 * r0, z + s0 * r0, a, x + c1 * r0, z + s1 * r0, a);
    }
  };
  for (const c of map.cover) if (c.kind !== 'tree') blob(c.x, c.z, c.radius * 0.9, c.radius + 0.7, 0.45);
  for (const st of dress.extras.sites) { const r = SITE_PROPS[st.site.prop].r; blob(st.x, st.z, r * 0.85, r + 0.55, 0.4); }
  for (const ex of dress.extras.examines) { const r = EXAMINE_PROPS[ex.prop].r; blob(ex.x, ex.z, r * 0.7, r + 0.4, 0.35); }
  if (!pos.length) return null;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 4));
  void distPointSeg;
  return g;
}
