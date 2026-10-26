// "How it happened" cutscene (plays once after the case-file reveal, before Thing's prologue). ~13 s, four shots per case.
// Its own renderer + canvas; never touches MysteryScene. Time is wall-clock driven (rAF + a setTimeout/interval fallback), so it
// still finishes when requestAnimationFrame stalls (headless / throttled tabs).
//
// HARD RULES (story): the murderer is random per session, so the killer is ONE identical hooded, cloaked, faceless silhouette in every
// case (mid height, no hair, no props that hint at a job). No blood: every death cuts to black. Red is not used.
import * as THREE from 'three';

export type MurderCaseScene = 'archive' | 'crypt' | 'signal'; // = CaseDef.prologue.scene
export interface MurderCutsceneOptions { reducedMotion: boolean; lowGraphics: boolean; onCaption?: (index: number) => void; onDone?: () => void }
export const MURDER_CUTSCENE_S = 13;
/** Shot / caption start times (s). */
export const MURDER_SHOT_STARTS = [0, 3.3, 6.6, 9.8] as const;
/** The single frame shown for reduced motion (s). */
const STILL_T: Record<MurderCaseScene, number> = { archive: 4.9, crypt: 5.4, signal: 8.0 };

type V3 = [number, number, number];
const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);
const ss = (x: number): number => { const t = clamp01(x); return t * t * (3 - 2 * t); };
const L = (a: number, b: number, u: number): number => a + (b - a) * u;
/** 0..1 progress of t across [a, b]. */
const seg = (t: number, a: number, b: number): number => clamp01((t - a) / (b - a));

// ---------------------------------------------------------------------------------------------------------------- kit
interface MatOpts { emissive?: string; ei?: number; basic?: boolean; opacity?: number; fogOff?: boolean; noShadow?: boolean }

class Kit {
  readonly geos: THREE.BufferGeometry[] = [];
  readonly mats = new Map<string, THREE.Material>();
  readonly texs: THREE.Texture[] = [];
  shadows = false;
  private glowTex: THREE.Texture | null = null;

  mat(color: string, o: MatOpts = {}): THREE.Material {
    const key = `${color}|${o.emissive ?? ''}|${o.ei ?? 0}|${o.basic ? 1 : 0}|${o.opacity ?? 1}|${o.fogOff ? 1 : 0}`;
    let m = this.mats.get(key);
    if (!m) {
      const common = { color, fog: !o.fogOff, transparent: o.opacity !== undefined, opacity: o.opacity ?? 1, depthWrite: o.opacity === undefined };
      m = o.basic
        ? new THREE.MeshBasicMaterial(common)
        : new THREE.MeshLambertMaterial({ ...common, emissive: o.emissive ?? '#000000', emissiveIntensity: o.ei ?? 1 });
      this.mats.set(key, m);
    }
    return m;
  }
  private put(parent: THREE.Object3D, geo: THREE.BufferGeometry, color: string, pos: V3, o: MatOpts): THREE.Mesh {
    this.geos.push(geo);
    const m = new THREE.Mesh(geo, this.mat(color, o));
    m.position.set(pos[0], pos[1], pos[2]);
    if (this.shadows && !o.noShadow && o.opacity === undefined && !o.basic) { m.castShadow = true; m.receiveShadow = true; }
    parent.add(m);
    return m;
  }
  box(p: THREE.Object3D, size: V3, color: string, pos: V3, o: MatOpts = {}): THREE.Mesh { return this.put(p, new THREE.BoxGeometry(size[0], size[1], size[2]), color, pos, o); }
  cyl(p: THREE.Object3D, rt: number, rb: number, h: number, color: string, pos: V3, o: MatOpts = {}, seg2 = 10): THREE.Mesh {
    return this.put(p, new THREE.CylinderGeometry(rt, rb, h, seg2, 1), color, pos, o);
  }
  sph(p: THREE.Object3D, r: V3, color: string, pos: V3, o: MatOpts = {}, seg2 = 10): THREE.Mesh {
    const m = this.put(p, new THREE.SphereGeometry(1, seg2, Math.max(5, Math.round(seg2 * 0.7))), color, pos, o);
    m.scale.set(r[0], r[1], r[2]);
    return m;
  }
  tor(p: THREE.Object3D, r: number, tube: number, color: string, pos: V3, o: MatOpts = {}, seg2 = 12): THREE.Mesh {
    return this.put(p, new THREE.TorusGeometry(r, tube, 5, seg2), color, pos, o);
  }
  cone(p: THREE.Object3D, r: number, h: number, color: string, pos: V3, o: MatOpts = {}, seg2 = 8): THREE.Mesh {
    return this.put(p, new THREE.ConeGeometry(r, h, seg2, 1), color, pos, o);
  }
  glow(p: THREE.Object3D, color: string, size: number, pos: V3, opacity = 1): THREE.Sprite {
    if (!this.glowTex) {
      const c = document.createElement('canvas');
      c.width = c.height = 64;
      const g = c.getContext('2d');
      if (g) {
        const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
        gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.25, 'rgba(255,255,255,0.5)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
        g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
      }
      this.glowTex = new THREE.CanvasTexture(c);
      this.texs.push(this.glowTex);
    }
    const mat = new THREE.SpriteMaterial({ map: this.glowTex, color, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: false, opacity });
    this.mats.set(`glow${this.mats.size}`, mat);
    const s = new THREE.Sprite(mat);
    s.scale.set(size, size, 1);
    s.position.set(pos[0], pos[1], pos[2]);
    p.add(s);
    return s;
  }
  dispose(): void {
    for (const g of this.geos) g.dispose();
    for (const m of this.mats.values()) m.dispose();
    for (const t of this.texs) t.dispose();
    this.geos.length = 0; this.mats.clear(); this.texs.length = 0;
  }
}

// ------------------------------------------------------------------------------------------------------------ characters
/** Both characters face +z in local space. Side A = local +x, side B = local -x. Shoulder/elbow rotation.x < 0 swings an arm forward. */
interface Rig {
  root: THREE.Group; upper: THREE.Group; head: THREE.Group; legA: THREE.Group; legB: THREE.Group;
  shA: THREE.Group; elA: THREE.Group; shB: THREE.Group; elB: THREE.Group; handA: THREE.Group; handB: THREE.Group;
}
const poseArms = (r: Rig, a1: number, b1: number, a2: number, b2: number): void => {
  r.shA.rotation.x = a1; r.elA.rotation.x = b1; r.shB.rotation.x = a2; r.elB.rotation.x = b2;
};

function makeOrloff(k: Kit, parent: THREE.Object3D): Rig {
  const root = new THREE.Group();
  parent.add(root);
  const coat = '#1d1830', trou = '#15121f', skin = '#e0b79f', grey = '#e6e6f2';
  const SK = { emissive: '#e0b79f', ei: 0.32 }, GR = { emissive: '#d8d8ea', ei: 0.4 };
  const leg = (sx: number): THREE.Group => {
    const g = new THREE.Group();
    g.position.set(sx, 0.62, 0);
    k.cyl(g, 0.075, 0.065, 0.58, trou, [0, -0.31, 0], {}, 6);
    k.box(g, [0.11, 0.07, 0.2], '#0e0c14', [0, -0.6, 0.05]);
    root.add(g);
    return g;
  };
  const legA = leg(0.09), legB = leg(-0.09);
  k.cyl(root, 0.19, 0.3, 0.72, coat, [0, 0.62, 0], {}, 10); // long professor coat skirt
  const upper = new THREE.Group();
  upper.position.set(0, 0.93, 0);
  root.add(upper);
  k.cyl(upper, 0.17, 0.21, 0.42, coat, [0, 0.21, 0], {}, 10);
  k.sph(upper, [0.235, 0.1, 0.15], coat, [0, 0.4, 0]);
  k.box(upper, [0.09, 0.3, 0.03], '#e8e2d4', [0, 0.23, 0.185]); // shirt front
  k.cyl(upper, 0.05, 0.05, 0.08, skin, [0, 0.47, 0], SK, 6);
  const head = new THREE.Group();
  head.position.set(0, 0.62, 0.02);
  upper.add(head);
  k.sph(head, [0.125, 0.145, 0.13], skin, [0, 0, 0], SK, 12);
  k.sph(head, [0.14, 0.12, 0.14], grey, [0, 0.07, -0.035], GR, 10); // grey hair, swept back
  k.sph(head, [0.04, 0.07, 0.06], grey, [0.125, -0.0, -0.02], GR, 6);
  k.sph(head, [0.04, 0.07, 0.06], grey, [-0.125, -0.0, -0.02], GR, 6);
  k.sph(head, [0.105, 0.14, 0.085], grey, [0, -0.1, 0.08], GR, 10); // beard
  k.box(head, [0.1, 0.022, 0.03], grey, [0, -0.04, 0.135], GR); // moustache
  k.sph(head, [0.02, 0.026, 0.026], '#cf9c86', [0, -0.01, 0.138], SK, 6);
  k.box(head, [0.055, 0.016, 0.02], grey, [0.055, 0.075, 0.12], GR); // bushy brows
  k.box(head, [0.055, 0.016, 0.02], grey, [-0.055, 0.075, 0.12], GR);
  for (const sx of [1, -1]) {
    k.tor(head, 0.042, 0.009, '#e0b95c', [sx * 0.056, 0.03, 0.125], { basic: true }, 10); // round glasses
    k.sph(head, [0.012, 0.012, 0.01], '#1a1420', [sx * 0.056, 0.03, 0.118], { basic: true }, 5);
  }
  k.box(head, [0.03, 0.008, 0.008], '#e0b95c', [0, 0.04, 0.128], { basic: true });
  const arm = (sx: number): { sh: THREE.Group; el: THREE.Group; hand: THREE.Group } => {
    const sh = new THREE.Group();
    sh.position.set(sx * 0.23, 0.4, 0);
    upper.add(sh);
    k.cyl(sh, 0.052, 0.046, 0.3, coat, [0, -0.15, 0], {}, 7);
    const el = new THREE.Group();
    el.position.set(0, -0.3, 0);
    sh.add(el);
    k.cyl(el, 0.046, 0.04, 0.28, coat, [0, -0.14, 0], {}, 7);
    const hand = new THREE.Group();
    hand.position.set(0, -0.3, 0);
    el.add(hand);
    k.sph(hand, [0.05, 0.05, 0.05], skin, [0, 0, 0], SK, 7);
    return { sh, el, hand };
  };
  const a = arm(1), b = arm(-1);
  upper.rotation.x = 0.1;
  head.rotation.x = 0.06;
  return { root, upper, head, legA, legB, shA: a.sh, elA: a.el, shB: b.sh, elB: b.el, handA: a.hand, handB: b.hand };
}

/** THE killer: one identical hooded, cloaked, faceless silhouette (~1.75 m) whoever the culprit is. No props, no hair, no face. */
function makeHooded(k: Kit, parent: THREE.Object3D): Rig {
  const root = new THREE.Group();
  parent.add(root);
  const cloak = '#2d2748', cloak2 = '#38305a', glove = '#3a3340';
  const legA = new THREE.Group(), legB = new THREE.Group(); // hidden under the cloak; kept so both rigs share a shape
  root.add(legA, legB);
  k.cyl(root, 0.17, 0.44, 1.36, cloak, [0, 0.68, 0], {}, 10);
  const upper = new THREE.Group();
  upper.position.set(0, 0.9, 0);
  root.add(upper);
  k.sph(upper, [0.27, 0.14, 0.2], cloak, [0, 0.47, 0], {}, 10); // shoulders
  const head = new THREE.Group();
  head.position.set(0, 0.68, 0);
  upper.add(head);
  k.sph(head, [0.2, 0.22, 0.22], cloak2, [0, 0, -0.01], {}, 12); // hood
  k.cone(head, 0.1, 0.15, cloak2, [0, 0.19, -0.1], {}, 7).rotation.x = -0.8; // hood peak
  k.sph(head, [0.12, 0.15, 0.09], '#04030a', [0, -0.01, 0.135], { basic: true }, 10); // empty dark opening: no face at all
  k.tor(head, 0.125, 0.034, cloak2, [0, -0.01, 0.16], {}, 12); // hood rim
  const arm = (sx: number): { sh: THREE.Group; el: THREE.Group; hand: THREE.Group } => {
    const sh = new THREE.Group();
    sh.position.set(sx * 0.27, 0.43, 0);
    upper.add(sh);
    k.cyl(sh, 0.065, 0.08, 0.32, cloak, [0, -0.16, 0], {}, 7);
    const el = new THREE.Group();
    el.position.set(0, -0.31, 0);
    sh.add(el);
    k.cyl(el, 0.075, 0.085, 0.28, cloak, [0, -0.14, 0], {}, 7);
    const hand = new THREE.Group();
    hand.position.set(0, -0.3, 0);
    el.add(hand);
    k.sph(hand, [0.052, 0.058, 0.052], glove, [0, 0, 0], {}, 7);
    return { sh, el, hand };
  };
  const a = arm(1), b = arm(-1);
  return { root, upper, head, legA, legB, shA: a.sh, elA: a.el, shB: b.sh, elB: b.el, handA: a.hand, handB: b.hand };
}

/** Walk cycle on either rig (legs swing; the hooded one just bobs and sways). */
function walk(r: Rig, t: number, speed: number, baseY: number): void {
  const ph = t * speed;
  r.legA.rotation.x = Math.sin(ph) * 0.5;
  r.legB.rotation.x = -Math.sin(ph) * 0.5;
  r.root.position.y = baseY + Math.abs(Math.sin(ph)) * 0.025;
  r.root.rotation.z = Math.sin(ph) * 0.025;
}
const still = (r: Rig): void => { r.legA.rotation.x = 0; r.legB.rotation.x = 0; r.root.rotation.z = 0; };
/** Place a rig: x, z, yaw (0 faces +z, PI faces -z, PI/2 faces +x). */
const put = (r: Rig, x: number, y: number, z: number, yaw: number): void => { r.root.position.set(x, y, z); r.root.rotation.y = yaw; };

interface EggParts { group: THREE.Group; light: THREE.PointLight; halo: THREE.Sprite }
function makeEgg(k: Kit, parent: THREE.Object3D, intensity = 1.6): EggParts {
  const group = new THREE.Group();
  parent.add(group);
  k.sph(group, [0.1, 0.135, 0.1], '#dff9ff', [0, 0, 0], { basic: true, fogOff: true }, 12);
  k.sph(group, [0.102, 0.04, 0.102], '#7fe6f6', [0, 0.02, 0], { basic: true, fogOff: true }, 10); // glowing band
  k.sph(group, [0.025, 0.03, 0.02], '#4fd8e8', [0.05, -0.04, 0.085], { basic: true, fogOff: true }, 5);
  k.sph(group, [0.025, 0.03, 0.02], '#4fd8e8', [-0.06, 0.07, 0.075], { basic: true, fogOff: true }, 5);
  const halo = k.glow(group, '#6fe6ff', 1.1, [0, 0, 0.02]);
  const light = new THREE.PointLight('#7feaff', intensity, 7, 1.6);
  group.add(light);
  return { group, light, halo };
}

interface LanternParts { group: THREE.Group; light: THREE.PointLight; glass: THREE.Mesh; halo: THREE.Sprite }
function makeLantern(k: Kit, parent: THREE.Object3D): LanternParts {
  const group = new THREE.Group();
  parent.add(group);
  k.tor(group, 0.05, 0.006, '#3a3342', [0, 0.17, 0], {}, 8);
  k.cyl(group, 0.04, 0.06, 0.04, '#2a2430', [0, 0.1, 0], { noShadow: true }, 6);
  const glass = k.cyl(group, 0.055, 0.055, 0.12, '#ffd27a', [0, 0.02, 0], { basic: true, fogOff: true }, 8);
  k.cyl(group, 0.06, 0.06, 0.03, '#2a2430', [0, -0.06, 0], { noShadow: true }, 6);
  const light = new THREE.PointLight('#ffb255', 2.2, 7.5, 1.4);
  light.position.set(0, 0.03, 0);
  group.add(light);
  const halo = k.glow(group, '#ffb860', 0.7, [0, 0.03, 0]);
  return { group, light, glass, halo };
}

// ---------------------------------------------------------------------------------------------------------------- stage
interface Shot { a: number; b: number; p0: V3; p1: V3; l0: V3; l1: V3; fov: number }
interface Dir {
  fog: [string, number];
  shots: Shot[];
  update(t: number): void;
  /** 0..1 black overlay (cuts to black on the moment of death, never a death frame). */
  black(t: number): number;
}
interface Ctx { k: Kit; root: THREE.Group; scene: THREE.Scene; moon: THREE.DirectionalLight; shadows: boolean; lowGraphics: boolean }

function moonSetup(c: Ctx, pos: V3, target: V3, extent: number, intensity = 1.05): void {
  c.moon.color.set('#8d9cff');
  c.moon.intensity = intensity;
  c.moon.position.set(...pos);
  c.moon.target.position.set(...target);
  c.root.add(c.moon.target);
  if (c.shadows) {
    c.moon.castShadow = true;
    c.moon.shadow.mapSize.set(1024, 1024);
    const cam = c.moon.shadow.camera;
    cam.left = -extent; cam.right = extent; cam.top = extent; cam.bottom = -extent; cam.near = 1; cam.far = 40;
    c.moon.shadow.bias = -0.0008;
  }
}

function sky(c: Ctx, color: string, moonAt: V3): void {
  const n = c.lowGraphics ? 60 : 140;
  const pos = new Float32Array(n * 3);
  let s = 12345;
  const rnd = (): number => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  for (let i = 0; i < n; i++) {
    const th = rnd() * Math.PI * 2, ph = 0.15 + rnd() * 1.1;
    pos[i * 3] = Math.cos(th) * Math.sin(ph) * 60; pos[i * 3 + 1] = Math.cos(ph) * 60 + 5; pos[i * 3 + 2] = Math.sin(th) * Math.sin(ph) * 60 - 20;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  c.k.geos.push(g);
  const m = new THREE.PointsMaterial({ color, size: 2, sizeAttenuation: false, fog: false, transparent: true, opacity: 0.8 });
  c.k.mats.set('stars', m);
  c.root.add(new THREE.Points(g, m));
  c.k.sph(c.root, [2.4, 2.4, 2.4], '#e8ecff', moonAt, { basic: true, fogOff: true }, 14);
  c.k.glow(c.root, '#8f9cff', 14, moonAt, 0.55);
}

const camAt = (shots: Shot[], t: number, cam: THREE.PerspectiveCamera, look: THREE.Vector3): void => {
  let s = shots[shots.length - 1];
  for (const sh of shots) if (t < sh.b) { s = sh; break; }
  const u = clamp01((t - s.a) / (s.b - s.a));
  const e = u * 0.7 + ss(u) * 0.3;
  cam.position.set(L(s.p0[0], s.p1[0], e), L(s.p0[1], s.p1[1], e), L(s.p0[2], s.p1[2], e));
  look.set(L(s.l0[0], s.l1[0], e), L(s.l0[1], s.l1[1], e), L(s.l0[2], s.l1[2], e));
  if (cam.fov !== s.fov) { cam.fov = s.fov; cam.updateProjectionMatrix(); }
  cam.lookAt(look);
};

// ---------------------------------------------------------------------------------------------------- Case 01: archive
function buildArchive(c: Ctx): Dir {
  const { k, root, scene } = c;
  scene.add(new THREE.HemisphereLight('#7a74c8', '#1a1426', 1.0));
  moonSetup(c, [3, 6, -7], [0, 0, -1], 6);
  const wall = '#3a3566';
  k.box(root, [10, 0.2, 9], '#33263a', [0, -0.1, 0]);
  k.box(root, [3.4, 0.02, 2.6], '#503058', [0.2, 0.01, -0.9], { noShadow: true });
  k.box(root, [10, 4.2, 0.3], wall, [0, 2.1, -3.2]);
  k.box(root, [0.3, 4.2, 9], wall, [-4.6, 2.1, 0]);
  k.box(root, [0.3, 4.2, 9], wall, [4.6, 2.1, 0]);
  k.box(root, [10, 0.12, 0.2], '#26223e', [0, 0.06, -3.02], { noShadow: true });
  // moonlit window on the back wall
  k.box(root, [1.5, 2.1, 0.06], '#7a90ff', [2.5, 2.2, -3.03], { basic: true, fogOff: true });
  k.box(root, [0.06, 2.1, 0.08], '#20203c', [2.5, 2.2, -3.0]);
  k.box(root, [1.5, 0.06, 0.08], '#20203c', [2.5, 2.2, -3.0]);
  k.box(root, [1.66, 0.08, 0.14], '#20203c', [2.5, 1.14, -3.0]);
  // bookcase (books are one instanced mesh)
  const bx = -2.0, bz = -2.95;
  k.box(root, [3.4, 3.1, 0.1], '#2c1f26', [bx, 1.55, bz - 0.12]);
  k.box(root, [0.08, 3.1, 0.42], '#4a3128', [bx - 1.7, 1.55, bz + 0.04]);
  k.box(root, [0.08, 3.1, 0.42], '#4a3128', [bx + 1.7, 1.55, bz + 0.04]);
  const rows = [0.1, 0.72, 1.34, 1.96, 2.58];
  const bookGeo = new THREE.BoxGeometry(1, 1, 1);
  k.geos.push(bookGeo);
  const books = new THREE.InstancedMesh(bookGeo, k.mat('#ffffff'), 120);
  const cols = ['#5a2f4e', '#2f4a6a', '#6a5a2a', '#3a5a4a', '#4a3a6a', '#6a3a2a', '#2a3a5a'];
  let n = 0, seed = 7;
  const rnd = (): number => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), ps = new THREE.Vector3(), col = new THREE.Color();
  for (const ry of rows) {
    k.box(root, [3.4, 0.05, 0.4], '#4a3128', [bx, ry, bz + 0.04]);
    let x = bx - 1.62;
    while (x < bx + 1.58 && n < 120) {
      const w = 0.05 + rnd() * 0.05, h = 0.34 + rnd() * 0.18;
      ps.set(x + w / 2, ry + 0.025 + h / 2, bz + 0.0);
      sc.set(w, h, 0.26);
      m4.compose(ps, q, sc);
      books.setMatrixAt(n, m4);
      books.setColorAt(n, col.set(cols[Math.floor(rnd() * cols.length)]));
      n++; x += w + 0.004;
    }
  }
  books.count = n;
  if (c.shadows) books.castShadow = books.receiveShadow = true;
  root.add(books);
  // desk, chair, lamp, paper, cup
  k.box(root, [1.8, 0.08, 0.86], '#4a2f22', [0.3, 0.78, -0.7]);
  k.box(root, [0.07, 0.74, 0.8], '#3a241b', [-0.55, 0.37, -0.7]);
  k.box(root, [0.07, 0.74, 0.8], '#3a241b', [1.15, 0.37, -0.7]);
  k.box(root, [1.7, 0.7, 0.04], '#3a241b', [0.3, 0.37, -0.3]);
  k.box(root, [0.5, 0.06, 0.5], '#35201a', [0.3, 0.46, -1.2]);
  k.box(root, [0.5, 0.72, 0.05], '#35201a', [0.3, 0.84, -1.47]);
  k.cyl(root, 0.1, 0.11, 0.03, '#2a2430', [-0.4, 0.835, -0.9], {}, 8);
  k.cyl(root, 0.012, 0.012, 0.36, '#2a2430', [-0.4, 1.0, -0.9], {}, 5);
  const shade = k.cyl(root, 0.06, 0.17, 0.2, '#ffcf7a', [-0.4, 1.2, -0.9], { emissive: '#ffb050', ei: 1.0 }, 10);
  shade.castShadow = false;
  k.glow(root, '#ffb860', 1.5, [-0.4, 1.12, -0.9], 0.8);
  const lamp = new THREE.PointLight('#ffb35e', 2.6, 6.5, 1.5);
  lamp.position.set(-0.4, 1.1, -0.85);
  root.add(lamp);
  k.box(root, [0.44, 0.012, 0.3], '#e9e2cc', [0.18, 0.826, -0.92], { noShadow: true });
  k.cyl(root, 0.025, 0.025, 0.06, '#1a1620', [-0.1, 0.86, -0.6], {}, 6);
  const cup = new THREE.Group();
  cup.position.set(0.62, 0.82, -0.45);
  root.add(cup);
  k.cyl(cup, 0.1, 0.1, 0.012, '#e8e2f0', [0, 0, 0], {}, 12);
  k.cyl(cup, 0.062, 0.042, 0.075, '#f0ecf8', [0, 0.044, 0], {}, 12);
  k.cyl(cup, 0.056, 0.056, 0.004, '#7a4a2a', [0, 0.078, 0], { basic: true }, 12);
  k.tor(cup, 0.025, 0.007, '#f0ecf8', [0.07, 0.045, 0], {}, 8);
  const drop = k.sph(root, [0.012, 0.016, 0.012], '#a8f0c8', [0.62, 2, -0.45], { basic: true }, 5);
  // glass egg case on a pedestal + the door the thief leaves by
  const px = 2.5, pz = -2.0;
  k.cyl(root, 0.3, 0.34, 0.85, '#463a5a', [px, 0.425, pz], {}, 10);
  k.cyl(root, 0.36, 0.36, 0.05, '#5a4a70', [px, 0.875, pz], {}, 10);
  k.cyl(root, 0.15, 0.17, 0.03, '#4a2a60', [px, 0.915, pz], {}, 10);
  for (const [dx, dz, w, d] of [[0, 0.21, 0.42, 0.012], [0, -0.21, 0.42, 0.012], [0.21, 0, 0.012, 0.42], [-0.21, 0, 0.012, 0.42]] as [number, number, number, number][]) {
    k.box(root, [w, 0.34, d], '#9fd8e8', [px + dx, 1.08, pz + dz], { opacity: 0.22 });
  }
  const lidPivot = new THREE.Group();
  lidPivot.position.set(px, 1.25, pz - 0.21);
  root.add(lidPivot);
  k.box(lidPivot, [0.44, 0.02, 0.44], '#9fd8e8', [0, 0, 0.21], { opacity: 0.35 });
  const egg = makeEgg(k, root);
  egg.group.position.set(px, 1.07, pz);
  k.box(root, [1.1, 2.5, 0.2], '#20203c', [4.46, 1.25, -1.35]); // door frame
  k.box(root, [0.1, 2.3, 0.9], '#04040c', [4.5, 1.15, -1.35], { basic: true });
  // people
  const orloff = makeOrloff(k, root);
  const killer = makeHooded(k, root);
  const vial = new THREE.Group();
  killer.handB.add(vial);
  k.cyl(vial, 0.02, 0.02, 0.1, '#a8f0d0', [0, -0.04, 0], { basic: true }, 6);
  k.cyl(vial, 0.008, 0.008, 0.02, '#4a3a2a', [0, 0.015, 0], {}, 5);
  vial.rotation.x = 0;
  const quill = new THREE.Group();
  orloff.handB.add(quill);
  k.cyl(quill, 0.004, 0.004, 0.16, '#e8e0c8', [0, 0.02, 0.05], {}, 4).rotation.x = 1.0;

  const chair = { x: 0.3, z: -1.2 }, shelf = { x: -1.55, z: -2.35 };
  const ORLOFF_SEAT_Y = -0.1;
  const seat = (): void => { // seated at the desk
    put(orloff, chair.x, ORLOFF_SEAT_Y, chair.z, 0);
    orloff.legA.rotation.x = orloff.legB.rotation.x = -1.45;
    orloff.root.rotation.z = 0;
  };
  const wpos = new THREE.Vector3();

  const update = (t: number): void => {
    lamp.intensity = 2.6 + Math.sin(t * 9) * 0.07 + Math.sin(t * 23) * 0.04;
    killer.root.visible = false; orloff.root.visible = true; vial.visible = true; drop.position.y = 3;
    cup.position.set(0.62, 0.82, -0.45); cup.rotation.set(0, 0, 0);
    egg.group.position.set(px, 1.07, pz); egg.light.intensity = 1.5 + Math.sin(t * 3) * 0.2;
    lidPivot.rotation.x = 0;
    if (t < 3.3) { // 1: Orloff writes, rises and goes to a shelf
      const rise = ss(seg(t, 2.1, 2.6)), go = ss(seg(t, 2.5, 3.3));
      const sx = L(chair.x, shelf.x, go), sz = L(chair.z, shelf.z, go);
      put(orloff, sx, L(ORLOFF_SEAT_Y, 0, rise), sz, L(0, Math.PI, ss(seg(t, 2.6, 3.1))));
      orloff.legA.rotation.x = orloff.legB.rotation.x = L(-1.45, 0, rise);
      if (go > 0 && go < 1) walk(orloff, t, 9, 0);
      orloff.upper.rotation.x = L(0.5, 0.1, rise);
      poseArms(orloff, -0.7 + Math.sin(t * 7) * 0.05, -0.9, -0.95, -0.7 + Math.sin(t * 9) * 0.12);
      orloff.head.rotation.x = 0.22;
      if (rise > 0.5) poseArms(orloff, -0.1, -0.3, -0.15, -0.3);
      quill.visible = t < 2.2;
    } else if (t < 6.6) { // 2: back turned at the shelf, a gloved hand tips a vial into the cup
      put(orloff, shelf.x, 0, shelf.z, Math.PI); still(orloff);
      orloff.upper.rotation.x = 0.05; orloff.head.rotation.x = -0.1;
      poseArms(orloff, -2.0 + Math.sin(t * 2) * 0.03, -0.2, -0.2, -0.1);
      quill.visible = false;
      killer.root.visible = true;
      const kx = L(2.2, 0.36, ss(seg(t, 3.3, 4.2)));
      put(killer, kx, 0, 0.14, Math.PI);
      if (kx > 0.37) walk(killer, t, 6, 0); else still(killer);
      const reach = ss(seg(t, 3.9, 4.5));
      poseArms(killer, -0.2, -0.2, L(-0.1, -0.85, reach), L(-0.1, -0.45, reach));
      killer.upper.rotation.x = 0.1 * reach;
      vial.rotation.x = 0; vial.rotation.z = -1.7 * ss(seg(t, 4.5, 4.9)) * (1 - ss(seg(t, 5.6, 6.0)));
      const dp = seg(t, 4.9, 5.3);
      drop.position.set(0.62, L(1.0, 0.88, dp * dp), -0.45);
      if (dp <= 0 || dp >= 1) drop.position.y = 3;
      // she steps back and out of view at the end of the shot
      const out = ss(seg(t, 5.9, 6.5));
      if (out > 0) { put(killer, L(0.36, 1.8, out), 0, L(0.14, 0.9, out), Math.PI); walk(killer, t, 6, 0); poseArms(killer, -0.2, -0.2, -0.1, -0.1); }
    } else if (t < 9.8) { // 3: he drinks, falters, slumps
      seat();
      orloff.legA.rotation.x = orloff.legB.rotation.x = -1.45;
      const lift = ss(seg(t, 6.9, 7.7)), sip = seg(t, 7.7, 8.1), fall = ss(seg(t, 8.15, 8.9));
      orloff.upper.rotation.x = L(0.35, 0.18, lift) * (1 - fall) + 1.25 * fall + Math.sin(sip * Math.PI * 3) * 0.04;
      poseArms(orloff, L(-0.7, -1.9, lift) * (1 - fall) + -0.5 * fall, L(-0.5, -1.9, lift) * (1 - fall) - 0.1 * fall, L(-0.6, -0.7, lift), -0.5);
      orloff.head.rotation.x = 0.1 + 0.2 * sip - 0.3 * fall;
      orloff.head.rotation.z = 0.25 * fall * Math.sin(1);
      if (fall < 0.02) {
        orloff.handA.getWorldPosition(wpos);
        root.updateMatrixWorld(true);
        orloff.handA.getWorldPosition(wpos);
        cup.position.copy(wpos); cup.position.y -= 0.03; cup.rotation.z = -0.25 * lift;
      } else {
        cup.position.set(0.62 + 0.08 * fall, 0.82, -0.45); cup.rotation.z = -1.2 * fall;
      }
      if (lift > 0 && lift < 1 && fall <= 0.02) { orloff.handA.getWorldPosition(wpos); cup.position.copy(wpos); cup.position.y -= 0.03; }
    } else { // 4: the egg is lifted from its case; the figure leaves
      orloff.root.visible = false;
      killer.root.visible = true;
      const open = ss(seg(t, 10.3, 10.9)), lift = ss(seg(t, 10.9, 11.6)), turn = ss(seg(t, 11.5, 12.0)), go = seg(t, 11.9, 13);
      lidPivot.rotation.x = -1.7 * open;
      const fx = L(2.5, 4.45, go * go), fz = -1.55;
      put(killer, fx, 0, fz, L(Math.PI, Math.PI / 2, turn));
      if (go > 0) walk(killer, t, 6, 0); else still(killer);
      const reachA = L(-1.0, -1.15, lift);
      poseArms(killer, L(-0.1, reachA, ss(seg(t, 10.7, 11.0))), L(-0.1, -0.5, ss(seg(t, 10.7, 11.0))), L(-0.1, reachA, ss(seg(t, 10.7, 11.0))), L(-0.1, -0.5, ss(seg(t, 10.7, 11.0))));
      const yaw = killer.root.rotation.y;
      const ey = L(1.07, 1.12, lift), carry = ss(seg(t, 10.9, 11.2));
      const cx = fx + 0.42 * Math.sin(yaw), cz = fz + 0.42 * Math.cos(yaw);
      egg.group.position.set(L(px, cx, carry), L(1.07, ey, lift) , L(pz, cz, carry));
      egg.light.intensity = 1.8;
    }
  };
  const black = (t: number): number => {
    if (t >= 8.95 && t < 9.75) return 1;
    if (t >= 9.75 && t < 10.15) return 1 - seg(t, 9.75, 10.15);
    return 0;
  };
  const shots: Shot[] = [
    { a: 0, b: 3.3, p0: [2.9, 1.75, 2.9], p1: [2.1, 1.6, 2.4], l0: [0.1, 1.05, -1.2], l1: [-0.2, 1.05, -1.3], fov: 46 },
    { a: 3.3, b: 6.6, p0: [2.7, 1.5, 1.7], p1: [2.3, 1.42, 1.35], l0: [0.1, 1.0, -0.95], l1: [0.0, 1.0, -1.0], fov: 50 },
    { a: 6.6, b: 9.8, p0: [1.5, 1.55, 1.9], p1: [1.2, 1.4, 1.5], l0: [0.3, 1.1, -1.2], l1: [0.3, 1.0, -1.2], fov: 42 },
    { a: 9.8, b: 13, p0: [0.1, 1.5, -2.3], p1: [0.7, 1.5, -2.3], l0: [2.5, 1.1, -1.8], l1: [3.0, 1.1, -1.7], fov: 56 },
  ];
  return { fog: ['#14122c', 0.045], shots, update, black };
}

// ------------------------------------------------------------------------------------------------------ Case 02: crypt
function buildCrypt(c: Ctx): Dir {
  const { k, root, scene } = c;
  scene.add(new THREE.HemisphereLight('#6a64b8', '#16121f', 0.8));
  moonSetup(c, [5, 9, 6], [0, 1, 0], 9, 1.15);
  const stone = '#3a3f6a', stoneD = '#2a2e52';
  // ground, facade with the gate opening, ledge, stairs down to the glow
  k.box(root, [30, 0.4, 14], '#26304a', [0, -0.2, 8.0]);
  k.box(root, [4.0, 4.4, 1.0], stone, [-3.0, 2.2, 0]);
  k.box(root, [4.0, 4.4, 1.0], stone, [3.0, 2.2, 0]);
  k.box(root, [2.2, 1.0, 1.0], stone, [0, 3.9, 0]);
  k.box(root, [10, 0.3, 2.0], stoneD, [0, 4.55, 0.35]);
  k.box(root, [1.0, 0.5, 1.2], stoneD, [-4.4, 4.95, 0]);
  k.box(root, [1.0, 0.5, 1.2], stoneD, [4.4, 4.95, 0]);
  k.box(root, [1.3, 3.6, 0.4], stoneD, [-1.3, 1.8, 0.6]);
  k.box(root, [1.3, 3.6, 0.4], stoneD, [1.3, 1.8, 0.6]);
  k.box(root, [3.4, 0.3, 0.5], stoneD, [0, 3.65, 0.6]);
  k.box(root, [2.2, 3, 1.0], '#14172c', [0, -1.5, 0]); // landing under the arch
  k.box(root, [2.2, 0.2, 1.0], stoneD, [0, -0.1, 0]);
  for (const sx of [-1, 1]) k.box(root, [10, 4.2, 10.5], '#1b1e3a', [sx * 6.1, -2.1, -4.75]);
  for (let i = 0; i < 8; i++) {
    const top = -0.3 * (i + 1);
    k.box(root, [2.2, 3.3 + top, 0.5], i % 2 ? '#2c3158' : '#343a66', [0, top - (3.3 + top) / 2, -0.75 - 0.5 * i]);
  }
  k.box(root, [2.2, 1, 5.4], '#232748', [0, -2.9, -7.2]);
  k.box(root, [2.2, 4, 0.5], '#161a30', [0, -1.5, -10.0]);
  k.box(root, [0.4, 0.55, 0.4], '#2f3560', [0, -2.2, -7.9]); // plinth under the glow
  // yard dressing: headstones + dead trees
  const hs = [[-4, 3], [-2.8, 5.4], [3.6, 4.4], [5, 2.6], [-6, 6], [2.4, 7], [6.5, 6.2]];
  for (const [x, z] of hs) { k.box(root, [0.5, 0.8, 0.14], '#4a5084', [x, 0.4, z]); k.cone(root, 0.3, 0.2, '#4a5084', [x, 0.88, z], {}, 4); }
  for (const [x, z, h] of [[-7.5, 2, 3.5], [8, 3, 3], [-9, 7, 4]] as V3[]) { k.cyl(root, 0.1, 0.22, h, '#241c2c', [x, h / 2, z], {}, 5); k.cone(root, 0.9, 1.8, '#1c2a30', [x, h + 0.6, z], {}, 6); }
  // portcullis: heavy iron grill raised in the opening; it falls when the pin is pulled
  const gate = new THREE.Group();
  root.add(gate);
  const iron = '#3d4258';
  for (let i = 0; i < 7; i++) k.box(gate, [0.07, 3.3, 0.1], iron, [-0.9 + i * 0.3, 1.65, 0]);
  for (const y of [0.25, 1.1, 1.95, 2.8, 3.3]) k.box(gate, [2.1, 0.12, 0.14], '#2c3044', [0, y, 0]);
  for (let i = 0; i < 7; i++) k.cone(gate, 0.05, 0.28, iron, [-0.9 + i * 0.3, -0.12, 0], {}, 4).rotation.x = Math.PI;
  const lift = new THREE.Group(); // lifting bar + chain ride down with the gate
  gate.add(lift);
  k.box(lift, [0.26, 0.14, 0.14], '#2c3044', [-0.6, 1.72, 0.95]);
  for (let i = 0; i < 8; i++) {
    const l = k.tor(lift, 0.045, 0.012, '#9a9fb8', [-0.6, 1.9 + i * 0.2, 0.95], {}, 6);
    if (i % 2) l.rotation.y = Math.PI / 2;
  }
  k.box(root, [0.12, 0.9, 0.12], '#2c3044', [-0.6, 5.0, 1.0]); // post the chain is pinned to
  const pin = k.cyl(root, 0.014, 0.014, 0.22, '#f0e8c8', [-0.6, 5.4, 1.0], { basic: true }, 5);
  pin.rotation.z = Math.PI / 2;
  // egg glow far below
  const egg = makeEgg(k, root, 2.4);
  egg.group.position.set(0, -2.0, -7.9);
  egg.halo.scale.set(2.2, 2.2, 1);
  egg.light.distance = 12;
  // people
  const orloff = makeOrloff(k, root);
  const killer = makeHooded(k, root);
  const lan = makeLantern(k, root);
  const fill = new THREE.PointLight('#6fdcff', 1.3, 7, 1.5); // faint glow climbing the steps from the egg
  fill.position.set(0, -0.9, -2.0);
  root.add(fill);
  const v = new THREE.Vector3();
  const stairY = (z: number): number => (z > -0.5 ? 0 : z < -4.5 ? -2.4 : -0.3 * (Math.floor((-z - 0.5) / 0.5) + 1));

  const update = (t: number): void => {
    egg.light.intensity = 2.4 + Math.sin(t * 3) * 0.3; egg.halo.material.opacity = 0.85 + Math.sin(t * 3) * 0.15;
    const fall = t > 8.2 ? Math.min(1, (t - 8.2) / 0.3) ** 2 : 0;
    gate.position.y = 2.2 - 2.2 * fall;
    lan.group.visible = true;
    orloff.root.visible = t < 9.8; killer.root.visible = true;
    // Orloff stands in the gateway holding up his lantern and peering down into the dark
    put(orloff, 0, 0, 0.0, Math.PI);
    still(orloff);
    const peer = Math.sin(t * 1.3) * 0.02;
    orloff.upper.rotation.x = 0.28 + peer;
    orloff.head.rotation.x = 0.28 + peer;
    const upLook = ss(seg(t, 7.0, 7.5));
    orloff.head.rotation.x -= 0.4 * upLook;
    poseArms(orloff, -0.35, -0.25, L(-1.0, -0.6, upLook), L(-0.65, -0.4, upLook));
    root.updateMatrixWorld(true);
    orloff.handB.getWorldPosition(v);
    lan.group.position.set(v.x, v.y - 0.12, v.z);
    lan.light.intensity = (t > 6.6 ? 0.75 : 1.3) + Math.sin(t * 11) * 0.08;
    // the hooded figure waits on the ledge above the gate and pulls the pin from the chain
    const arrive = ss(seg(t, 3.3, 4.0));
    put(killer, -0.6, 4.7, L(-0.5, 0.55, arrive), 0);
    still(killer);
    const pull = ss(seg(t, 5.3, 5.9)), away = ss(seg(t, 5.9, 6.5));
    poseArms(killer, -0.2, -0.2, L(-0.2, -1.0, pull) + 0.7 * away, L(-0.2, -0.7, pull) + 0.5 * away);
    killer.upper.rotation.x = 0.15 * pull;
    if (t >= 5.9) { root.updateMatrixWorld(true); killer.handB.getWorldPosition(v); pin.position.copy(v); } else pin.position.set(-0.6, 5.4, 1.0);
    // the lantern drops with the impact; the fallen lantern is left glowing faintly
    if (t >= 9.8) {
      orloff.root.visible = false;
      lan.group.position.set(0.5, 0.06, 0.5); lan.group.rotation.z = Math.PI / 2; lan.light.intensity = 0.7;
      const d = seg(t, 9.8, 13);
      const z = L(-1.9, -7.2, d);
      put(killer, 0, stairY(z), z, Math.PI);
      walk(killer, t, 5.5, stairY(z));
      killer.root.position.y = stairY(z) + Math.abs(Math.sin(t * 5.5)) * 0.02;
      poseArms(killer, -0.1, -0.1, -0.1, -0.1);
      egg.group.position.y = -2.0;
    } else { lan.group.rotation.z = 0; }
  };
  const black = (t: number): number => {
    if (t >= 8.5 && t < 9.75) return 1;
    if (t >= 9.75 && t < 10.15) return 1 - seg(t, 9.75, 10.15);
    return 0;
  };
  const shots: Shot[] = [
    { a: 0, b: 3.3, p0: [0.9, -0.75, -2.7], p1: [0.5, -0.45, -2.0], l0: [0, 0.95, 0.0], l1: [0, 1.0, 0.0], fov: 50 },
    { a: 3.3, b: 6.6, p0: [1.8, 1.9, 10.0], p1: [1.4, 2.3, 9.2], l0: [-0.3, 3.2, 0.2], l1: [-0.5, 3.6, 0.2], fov: 56 },
    { a: 6.6, b: 9.8, p0: [0.7, -0.55, -2.3], p1: [0.5, -0.4, -2.0], l0: [0, 1.5, 0.0], l1: [0, 1.4, 0.0], fov: 52 },
    { a: 9.8, b: 13, p0: [0.35, 0.55, -0.9], p1: [0.2, 0.3, -1.4], l0: [0, -1.0, -5], l1: [0, -1.6, -6.5], fov: 55 },
  ];
  return { fog: ['#12122a', 0.045], shots, update, black };
}

// ---------------------------------------------------------------------------------------------------- Case 03: signal
function buildSignal(c: Ctx): Dir {
  const { k, root, scene } = c;
  scene.add(new THREE.HemisphereLight('#6a64b8', '#141a24', 0.8));
  moonSetup(c, [-5, 9, 8], [0, 0, -1], 11, 1.1);
  k.box(root, [40, 0.4, 36], '#1f3040', [0, -0.2, -4]);
  k.box(root, [1.6, 0.05, 30], '#4a4566', [0, 0.01, -2], { noShadow: true }); // path
  // watchtower, dark
  const tx = -2.4, tz = -5.5;
  k.cyl(root, 1.15, 1.45, 5.2, '#343a6c', [tx, 2.6, tz], {}, 10);
  k.cyl(root, 1.7, 1.55, 0.3, '#2a2e56', [tx, 5.35, tz], {}, 10);
  const room = k.cyl(root, 1.5, 1.5, 1.3, '#30365f', [tx, 6.1, tz], {}, 10);
  room.castShadow = c.shadows;
  const winMats: THREE.Mesh[] = [];
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + 0.4;
    const w = k.box(root, [0.5, 0.55, 0.06], '#ffd27a', [tx + Math.sin(a) * 1.5, 6.1, tz + Math.cos(a) * 1.5], { basic: true });
    w.rotation.y = a; winMats.push(w);
  }
  k.cone(root, 1.95, 1.5, '#1e2040', [tx, 7.55, tz], {}, 10);
  k.cyl(root, 0.06, 0.06, 0.9, '#1e2040', [tx, 8.6, tz], {}, 5);
  k.box(root, [0.5, 1.0, 0.1], '#14172c', [tx + 0.3, 0.5, tz + 1.42]); // door
  // alarm posts along the yard fence
  const posts: { lamp: THREE.Mesh; halo: THREE.Sprite }[] = [];
  const px = [-6.2, -4.2, -2.0, 0.0, 2.2, 4.4];
  for (const x of px) {
    k.cyl(root, 0.05, 0.07, 1.7, '#2a2c4a', [x, 0.85, -2.6], {}, 5);
    const lamp = k.sph(root, [0.14, 0.16, 0.14], '#ffb347', [x, 1.8, -2.6], { basic: true, fogOff: true }, 8);
    const halo = k.glow(root, '#ffb347', 1.2, [x, 1.8, -2.6], 0.9);
    posts.push({ lamp, halo });
    k.box(root, [1.8, 0.05, 0.05], '#2a2c4a', [x + 1.1, 1.2, -2.6], { noShadow: true });
  }
  // signal lamp beside the path
  const sx = 1.7, sz = 0.6;
  k.cyl(root, 0.05, 0.07, 1.1, '#2a2c4a', [sx, 0.55, sz], {}, 5);
  k.box(root, [0.3, 0.26, 0.24], '#2c2f52', [sx, 1.2, sz]);
  const lens = k.cyl(root, 0.1, 0.1, 0.06, '#bfefff', [sx - 0.0, 1.2, sz + 0.14], { basic: true, fogOff: true }, 10);
  lens.rotation.x = Math.PI / 2;
  const sigHalo = k.glow(root, '#9fe8ff', 1.8, [sx, 1.2, sz + 0.2], 1);
  const sigLight = new THREE.PointLight('#9fe8ff', 2.0, 6, 1.6);
  sigLight.position.set(sx, 1.25, sz + 0.4);
  root.add(sigLight);
  // dark shapes: pines + hedge the figure steps out of
  for (const [x, z, h] of [[4.6, -0.6, 3.2], [5.6, -1.8, 3.8], [3.9, -2.9, 2.8], [-6.5, -0.5, 3.4], [-7.6, -3, 3.8], [7.4, -3.5, 3.4], [-4.5, -8.5, 4]] as V3[]) {
    k.cyl(root, 0.08, 0.14, 0.7, '#1c1520', [x, 0.35, z], {}, 5);
    k.cone(root, 0.9, h, '#17262c', [x, h / 2 + 0.5, z], {}, 6);
  }
  k.box(root, [2.0, 1.1, 0.8], '#16242a', [4.2, 0.55, -0.35], { noShadow: true });
  // fence rails behind the posts for context
  k.box(root, [16, 0.06, 0.06], '#2a2c4a', [-1, 0.5, -2.6], { noShadow: true });
  // people
  const orloff = makeOrloff(k, root);
  const killer = makeHooded(k, root);
  const lan = makeLantern(k, root);
  const egg = makeEgg(k, root, 1.8);
  const v = new THREE.Vector3();
  const off = [0.5, 0.95, 1.4, 1.85, 2.3, 2.75];

  const update = (t: number): void => {
    for (let i = 0; i < posts.length; i++) {
      const on = t < off[i] || (t > off[i] + 0.06 && t < off[i] + 0.12) ? 1 : 0; // one last flicker, then dark
      const lit = t < off[i] ? 1 : on;
      posts[i].lamp.material = k.mat(lit ? '#ffb347' : '#1c1a2c', { basic: true, fogOff: true });
      posts[i].halo.visible = lit > 0;
    }
    for (const w of winMats) w.material = k.mat(t < 3.0 ? '#ffd27a' : '#0c0d1c', { basic: true });
    // signal lamp: starts blinking once the alarms are out
    const blinkOn = t > 2.6 && t < 9.2 && ((t - 2.6) % 0.75) < 0.42;
    sigLight.intensity = blinkOn ? 2.2 : 0; sigHalo.visible = blinkOn;
    lens.material = k.mat(blinkOn ? '#d8f8ff' : '#2a3a44', { basic: true, fogOff: true });
    orloff.root.visible = true; killer.root.visible = false; egg.group.visible = false; lan.group.visible = true; lan.halo.visible = true;
    lan.group.rotation.set(0, 0, 0);
    if (t < 3.3) { // 1: wide, Orloff walks the path, alarms go dark
      const z = L(3.2, 1.6, t / 3.3);
      put(orloff, 0.1, 0, z, Math.PI); walk(orloff, t, 6, 0);
      poseArms(orloff, 0.3 * Math.sin(t * 6), -0.1, -1.0, -0.65);
    } else if (t < 6.6) { // 2: signal lamp, Orloff stops and turns his head
      const w = seg(t, 3.3, 5.0);
      put(orloff, 0.0, 0, L(0.4, -0.8, w), Math.PI + 0.0);
      if (w < 1) walk(orloff, t, 6, 0); else still(orloff);
      const turn = ss(seg(t, 5.6, 6.6));
      orloff.root.rotation.y = Math.PI - turn * 0.6;
      poseArms(orloff, 0.1, -0.1, -1.0, -0.65);
    } else if (t < 9.8) { // 3: he turns, a hooded silhouette steps out of the dark, the lantern falls
      still(orloff);
      put(orloff, 0.0, 0, -0.8, L(Math.PI - 0.6, Math.PI / 2, ss(seg(t, 6.6, 7.4))));
      killer.root.visible = true;
      const step = ss(seg(t, 7.0, 8.6));
      put(killer, L(4.6, 1.35, step), 0, L(-0.7, -0.8, step), -Math.PI / 2);
      if (step > 0 && step < 1) walk(killer, t, 5, 0); else still(killer);
      poseArms(killer, -0.1, -0.1, -0.1, -0.1);
      const open = ss(seg(t, 8.5, 8.8));
      poseArms(orloff, 0.1, -0.1, L(-1.0, -0.2, open), L(-0.65, -0.1, open));
    } else { // 4: the egg is carried past the dark tower
      orloff.root.visible = false; lan.group.visible = false; lan.halo.visible = false;
      killer.root.visible = true; egg.group.visible = true;
      const d = seg(t, 9.9, 13);
      put(killer, L(3.6, -5.4, d), 0, L(-1.4, -1.6, d), -Math.PI / 2);
      walk(killer, t, 5.5, 0);
      poseArms(killer, -1.15, -0.5, -1.15, -0.5);
      const yaw = killer.root.rotation.y;
      egg.group.position.set(killer.root.position.x + 0.42 * Math.sin(yaw), 1.1 + Math.abs(Math.sin(t * 5.5)) * 0.025, killer.root.position.z + 0.42 * Math.cos(yaw));
    }
    if (t < 9.8) {
      root.updateMatrixWorld(true);
      if (t >= 8.5) { // the lantern drops, bounces, goes out
        const f = t - 8.5;
        orloff.handB.getWorldPosition(v);
        if (f < 0.01) lan.group.position.set(v.x, v.y - 0.12, v.z);
        const y = Math.max(0.1, (v.y - 0.12) - 4.9 * f * f);
        lan.group.position.set(v.x + f * 0.2, y, v.z + f * 0.1);
        lan.group.rotation.z = Math.min(1.5, f * 4);
        const out = 1 - ss(seg(t, 8.9, 9.25));
        lan.light.intensity = 2.2 * out; lan.glass.material = k.mat(out > 0.3 ? '#ffd27a' : '#2a2430', { basic: true, fogOff: true });
        lan.halo.visible = out > 0.3;
      } else {
        orloff.handB.getWorldPosition(v);
        lan.group.position.set(v.x, v.y - 0.12, v.z);
        lan.light.intensity = 2.2 + Math.sin(t * 11) * 0.15;
        lan.glass.material = k.mat('#ffd27a', { basic: true, fogOff: true });
      }
    }
    egg.light.intensity = 1.8;
  };
  const black = (t: number): number => {
    if (t >= 9.25 && t < 9.75) return 1;
    if (t >= 9.75 && t < 10.15) return 1 - seg(t, 9.75, 10.15);
    return 0;
  };
  const shots: Shot[] = [
    { a: 0, b: 3.3, p0: [1.4, 1.7, 6.8], p1: [0.8, 1.7, 5.5], l0: [-1.0, 2.4, -3.0], l1: [-1.0, 2.2, -3.0], fov: 50 },
    { a: 3.3, b: 6.6, p0: [-0.3, 1.25, 4.2], p1: [0.2, 1.25, 3.6], l0: [1.3, 1.15, 0.2], l1: [1.3, 1.15, 0.0], fov: 46 },
    { a: 6.6, b: 9.8, p0: [-0.9, 1.5, 2.5], p1: [-0.5, 1.4, 2.2], l0: [1.4, 1.1, -0.8], l1: [1.2, 1.0, -0.8], fov: 44 },
    { a: 9.8, b: 13, p0: [1.4, 1.4, 4.8], p1: [0.2, 1.5, 4.4], l0: [-1.2, 2.5, -4.5], l1: [-2.6, 2.4, -4.5], fov: 50 },
  ];
  return { fog: ['#14122c', 0.04], shots, update, black };
}

// ---------------------------------------------------------------------------------------------------------- the class
export class MurderCutscene {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(48, 16 / 9, 0.1, 120);
  private readonly look = new THREE.Vector3();
  private readonly kit = new Kit();
  private readonly dir: Dir;
  private readonly veil: HTMLDivElement;
  private readonly ro: ResizeObserver | null;
  private readonly onResize = (): void => this.resize();
  private startWall = 0;
  private lastRender = -1e9;
  private playing = false;
  private finished = false;
  private disposed = false;
  private raf = 0;
  private timer = 0;
  private lastCaption = -1;

  constructor(private readonly container: HTMLElement, sceneId: MurderCaseScene, private readonly opts: MurderCutsceneOptions) {
    const low = opts.lowGraphics;
    this.renderer = new THREE.WebGLRenderer({ antialias: !low, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, low ? 1 : 1.5));
    this.kit.shadows = !low;
    this.renderer.shadowMap.enabled = !low;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    const cv = this.renderer.domElement;
    cv.setAttribute('aria-hidden', 'true');
    cv.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block';
    if (getComputedStyle(container).position === 'static') container.style.position = 'relative';
    container.appendChild(cv);
    this.veil = document.createElement('div');
    this.veil.style.cssText = 'position:absolute;inset:0;background:#000;pointer-events:none;opacity:1';
    container.appendChild(this.veil);

    const root = new THREE.Group();
    this.scene.add(root);
    const moon = new THREE.DirectionalLight('#8d9cff', 1);
    root.add(moon);
    const ctx: Ctx = { k: this.kit, root, scene: this.scene, moon, shadows: !low, lowGraphics: low };
    this.dir = sceneId === 'crypt' ? buildCrypt(ctx) : sceneId === 'signal' ? buildSignal(ctx) : buildArchive(ctx);
    sky(ctx, '#cfd6ff', sceneId === 'archive' ? [-18, 26, -40] : [-22, 30, -45]);
    const fogCol = new THREE.Color(this.dir.fog[0]);
    this.scene.background = fogCol;
    this.scene.fog = new THREE.FogExp2(fogCol, this.dir.fog[1]);

    this.ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(this.onResize) : null;
    this.ro?.observe(container);
    window.addEventListener('resize', this.onResize);
    this.resize();
    // reduced motion: render one still frame now; play() never animates
    this.renderAt(opts.reducedMotion ? STILL_T[sceneId] : 0, true);
  }

  private resize(): void {
    if (this.disposed) return;
    const w = Math.max(2, this.container.clientWidth), h = Math.max(2, this.container.clientHeight);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    if (!this.playing) this.renderer.render(this.scene, this.camera);
  }

  private renderAt(t: number, silent = false): void {
    if (this.disposed) return;
    const tt = Math.min(MURDER_CUTSCENE_S, Math.max(0, t));
    this.dir.update(tt);
    camAt(this.dir.shots, tt, this.camera, this.look);
    let black = this.dir.black(tt);
    if (!this.opts.reducedMotion) black = Math.max(black, 1 - seg(tt, 0, 0.5), seg(tt, MURDER_CUTSCENE_S - 0.5, MURDER_CUTSCENE_S));
    this.veil.style.opacity = String(black);
    let ci = 0;
    for (let i = 0; i < MURDER_SHOT_STARTS.length; i++) if (tt >= MURDER_SHOT_STARTS[i]) ci = i;
    if (ci !== this.lastCaption) { this.lastCaption = ci; if (!silent && !this.opts.reducedMotion) this.opts.onCaption?.(ci); } // reduced motion: the screen steps the captions itself
    this.renderer.render(this.scene, this.camera);
  }

  /** Freeze on a moment (preview / screenshots). Stops playback. */
  seek(t: number): void {
    this.stopClock();
    this.renderAt(t);
  }

  /** Renderer stats for the preview page. */
  stats(): { triangles: number; calls: number; shadowLights: number } {
    return { triangles: this.renderer.info.render.triangles, calls: this.renderer.info.render.calls, shadowLights: this.renderer.shadowMap.enabled ? 1 : 0 };
  }

  play(): void {
    if (this.disposed || this.playing || this.finished || this.opts.reducedMotion) return;
    this.playing = true;
    this.startWall = performance.now();
    this.lastCaption = -1;
    const frame = (): void => {
      if (!this.playing) return;
      this.tick();
      if (this.playing) this.raf = requestAnimationFrame(frame);
    };
    this.raf = requestAnimationFrame(frame);
    // wall-clock fallback: keeps time moving (and the cutscene finishing) if rAF stalls
    this.timer = window.setInterval(() => this.tick(), 50);
    this.tick();
  }

  private tick(): void {
    if (!this.playing || this.disposed) return;
    const now = performance.now();
    const t = (now - this.startWall) / 1000;
    if (t < MURDER_CUTSCENE_S && now - this.lastRender < 14) return;
    this.lastRender = now;
    this.renderAt(t);
    if (t >= MURDER_CUTSCENE_S) this.finish();
  }

  private stopClock(): void {
    this.playing = false;
    if (this.raf) cancelAnimationFrame(this.raf);
    if (this.timer) window.clearInterval(this.timer);
    this.raf = 0; this.timer = 0;
  }

  private finish(): void {
    this.stopClock();
    if (this.finished) return;
    this.finished = true;
    this.opts.onDone?.();
  }

  /** Jump to the end and call onDone once. */
  skip(): void {
    if (this.disposed || this.finished) return;
    this.stopClock();
    this.finished = true;
    this.opts.onDone?.();
  }

  dispose(): void {
    if (this.disposed) return;
    this.stopClock();
    this.disposed = true;
    this.ro?.disconnect();
    window.removeEventListener('resize', this.onResize);
    this.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
      if ((o as THREE.InstancedMesh).isInstancedMesh) (o as THREE.InstancedMesh).dispose();
    });
    this.kit.dispose();
    this.scene.clear();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.renderer.domElement.remove();
    this.veil.remove();
  }
}
