// Everything the player can investigate, drawn without giving the answer away:
//  - the furniture at every candidate site is static (caseDressing.ts); THIS class decides what is shown ON it: the clue item only once the
//    site is known (run.investigation().knownClueSites), an ability reveals it, or the player is within ~6 m (the sim marks a site known
//    when it checks it); the egg likewise (eggSeenAt / revealEgg / near);
//  - a lantern-coloured inverted-hull outline on whatever can be interacted with (alpha .35 within 6 m with line of sight, 1 in reach),
//    off for sites already checked;
//  - "searched" cues (drawer pulled out, papers on the floor) on checked sites, and soft glints within ~8 m on known sites, unexamined
//    examine objects, the lever.
// It reads the hidden truth (MapDef.clues / egg position) ONLY for the near-range / ability / known cases above.
import * as THREE from 'three';
import type { ActiveEffects, ClueId, InvestigationState, MapDef } from '../../mystery/types.ts';
import { lambertVC } from '../actors.ts';
import { mergeAll } from '../action/geom.ts';
import { damp, smoothstep } from '../util.ts';
import { Bld } from './builders.ts';
import { BOX, CYL6, ICO0, ICO1, PAL, distPointSeg, seeded } from './common.ts';
import type { DressingBuild } from './dressing.ts';
import { EXAMINE_PROPS, buildExamineHullGeometry, buildLeverHullGeometry } from './interactables.ts';
import { ClueProp } from './items.ts';
import { SITE_PROPS, buildPropHullGeometry, type SitePropKind } from './siteProps.ts';
import type { RenderableMysteryRun } from './types.ts';
import type { BeamField, GlowSet } from './vfx.ts';

const NG = { gradient: 0, jitter: 0 } as const;
/** within this distance (m) of the true site the clue item / egg appears (the sim's site check radius is read when exposed) */
const REVEAL_M = 6;
const OUTLINE_M = 6;
const GLINT_M = 8;

export interface ViewCtx {
  dt: number;
  T: number;
  calm: boolean;
  low: boolean;
  glows: GlowSet;
  beams: BeamField;
  gc: THREE.Color;
  /** the interactable the sim reports this frame */
  it: ReturnType<RenderableMysteryRun['interactable']>;
}

export interface ViewStats { siteProps: number; examines: number; checked: number; evidenceVisible: ClueId[]; eggVisible: boolean; outlines: number }

class HullPool {
  readonly group = new THREE.Group();
  private readonly meshes: THREE.Mesh[] = [];
  private n = 0;
  constructor(cap: number, private readonly dim: THREE.Material, private readonly bright: THREE.Material) {
    for (let i = 0; i < cap; i++) {
      const m = new THREE.Mesh(new THREE.BufferGeometry(), dim);
      m.visible = false;
      m.frustumCulled = false;
      m.renderOrder = 4;
      this.meshes.push(m);
      this.group.add(m);
    }
  }
  begin(): void { this.n = 0; }
  add(geo: THREE.BufferGeometry, x: number, y: number, z: number, yaw: number, bright: boolean, sxz = 1.06, sy = 1.035): void {
    if (this.n >= this.meshes.length) return;
    const m = this.meshes[this.n++];
    m.geometry = geo;
    m.material = bright ? this.bright : this.dim;
    m.position.set(x, y, z);
    m.rotation.y = yaw;
    m.scale.set(sxz, sy, sxz);
    m.visible = true;
  }
  end(): void { for (let i = this.n; i < this.meshes.length; i++) this.meshes[i].visible = false; }
  get count(): number { return this.n; }
}

export class InvestigationView {
  readonly root = new THREE.Group();
  private readonly clueProps = new Map<ClueId, ClueProp>();
  private readonly hulls: HullPool;
  private readonly hullDim: THREE.MeshBasicMaterial;
  private readonly hullBright: THREE.MeshBasicMaterial;
  private readonly hullGeos = new Map<string, THREE.BufferGeometry>();
  private readonly searchedMat = lambertVC();
  private searchedMesh: THREE.Mesh | null = null;
  private searchedKey = '';
  private readonly sitePos = new Map<string, { x: number; z: number; yaw: number; prop: SitePropKind }>();
  private inv: InvestigationState | null = null;
  private invAt = -9;
  private revealM = REVEAL_M;
  private pulse = 0;
  stats: ViewStats = { siteProps: 0, examines: 0, checked: 0, evidenceVisible: [], eggVisible: true, outlines: 0 };
  /** outline fade for the in-reach target (smooths the alpha-1 switch) */
  private reachK = 0;
  /** where the in-reach target stands (for the search sparkle), or null */
  reachPos: { x: number; y: number; z: number } | null = null;

  constructor(private readonly map: MapDef, private readonly dress: DressingBuild, switchHull: THREE.BufferGeometry | null) {
    this.hullDim = new THREE.MeshBasicMaterial({ color: 0xffc880, side: THREE.BackSide, transparent: true, opacity: 0.35, depthWrite: false, fog: false });
    this.hullBright = new THREE.MeshBasicMaterial({ color: 0xffe0a0, side: THREE.BackSide, transparent: true, opacity: 1, depthWrite: false, fog: false });
    this.hulls = new HullPool(8, this.hullDim, this.hullBright);
    this.root.add(this.hulls.group);
    for (const s of dress.extras.sites) this.sitePos.set(s.site.id, { x: s.x, z: s.z, yaw: s.yaw, prop: s.site.prop });
    if (switchHull) this.hullGeos.set('switch', switchHull);
    this.stats.siteProps = dress.extras.sites.length;
    this.stats.examines = dress.extras.examines.length;
  }

  // ---------------------------------------------------------------------------------------- helpers
  private hull(key: string): THREE.BufferGeometry | null {
    let g = this.hullGeos.get(key) ?? null;
    if (g) return g;
    const [kind, name] = key.split(':');
    if (kind === 'site') g = buildPropHullGeometry(name as SitePropKind);
    else if (kind === 'examine') g = buildExamineHullGeometry(name as keyof typeof EXAMINE_PROPS);
    else if (kind === 'lever') g = buildLeverHullGeometry();
    else if (kind === 'box') {
      // a plain crate-sized box (the tutorial practice crate)
      const w = Number(name);
      g = new THREE.BoxGeometry(w, 1.05, w);
      g.translate(0, 0.52, 0);
    }
    else if (kind === 'egg') {
      const b = new Bld(seeded('egg-hull'));
      b.lit.add(ICO1, '#fff', [0, 0.27, 0], [0, 0, 0], [0.21, 0.28, 0.21], NG);
      g = mergeAll([b.lit.build()]);
      g?.deleteAttribute('color');
    }
    if (g) this.hullGeos.set(key, g);
    return g;
  }

  private siteAt(x: number, z: number): { id: string; x: number; z: number; yaw: number; prop: SitePropKind } | null {
    let best: { id: string; x: number; z: number; yaw: number; prop: SitePropKind } | null = null, bd = 0.9;
    for (const [id, s] of this.sitePos) {
      const d = Math.hypot(s.x - x, s.z - z);
      if (d < bd) { bd = d; best = { id, ...s }; }
    }
    return best;
  }

  /** straight-line sight in the XZ plane against closed walls and high cover (what the sim's checks use) */
  private clear(run: RenderableMysteryRun, x0: number, z0: number, x1: number, z1: number): boolean {
    const len = Math.hypot(x1 - x0, z1 - z0);
    const n = Math.max(2, Math.ceil(len / 0.5));
    for (let i = 1; i < n; i++) {
      const t = i / n;
      const x = x0 + (x1 - x0) * t, z = z0 + (z1 - z0) * t;
      for (const w of this.map.walls) {
        if (distPointSeg(x, z, w.a.x, w.a.z, w.b.x, w.b.z) < w.thickness / 2 && !run.isWallOpen(w.id)) return false;
      }
      for (const c of this.map.cover) if (c.height === 'high' && Math.hypot(x - c.x, z - c.z) < c.radius) return false;
    }
    return true;
  }

  private refresh(run: RenderableMysteryRun, T: number, force: boolean): InvestigationState | null {
    if (typeof run.investigation !== 'function') { this.inv = null; return null; }
    if (force || T - this.invAt > 0.2 || T < this.invAt) { this.inv = run.investigation(); this.invAt = T; }
    return this.inv;
  }

  /** the sim may expose siteCheckM; never draw an item later than the sim would mark it known */
  setRevealRange(m: number | undefined): void { if (m && Number.isFinite(m)) this.revealM = Math.max(REVEAL_M, m); }

  /** Is the egg shown? (resting eggs only once seen / revealed / near; carried, dropped and delivered eggs always) */
  eggVisible(run: RenderableMysteryRun, eff: ActiveEffects): boolean {
    const e = run.egg;
    if (e.state !== 'resting') return true;
    if (eff.revealEgg) return true;
    if (this.inv?.eggSeenAt) return true;
    return Math.hypot(e.x - run.player.x, e.z - run.player.z) < this.revealM;
  }

  /** The prop standing at (x, z), if any: where an item rests. */
  sitePose(x: number, z: number): { itemY: number } | null {
    const s = this.siteAt(x, z);
    return s ? { itemY: SITE_PROPS[s.prop].itemY } : null;
  }

  /** Height (m) at which a resting egg floats above `x, z` (the prop of the site it rests on). */
  restHeight(x: number, z: number): number {
    const s = this.siteAt(x, z);
    return s ? SITE_PROPS[s.prop].eggY : 0.34;
  }

  /** Is this truth clue currently visible (known site / ability / near)? */
  clueVisible(run: RenderableMysteryRun, eff: ActiveEffects, clueId: ClueId, x: number, z: number): boolean {
    if (run.cluesFound.includes(clueId)) return false;
    if (this.inv?.knownClueSites?.[clueId] !== undefined) return true;
    if (eff.revealedClues.includes(clueId)) return true;
    return Math.hypot(x - run.player.x, z - run.player.z) < this.revealM;
  }

  // ---------------------------------------------------------------------------------------- searched cues
  private rebuildSearched(ids: string[]): void {
    const key = ids.slice().sort().join(',');
    if (key === this.searchedKey) return;
    this.searchedKey = key;
    if (this.searchedMesh) { this.root.remove(this.searchedMesh); this.searchedMesh.geometry.dispose(); this.searchedMesh = null; }
    if (!ids.length) return;
    const col = new Set<THREE.BufferGeometry | null>();
    for (const id of ids) {
      const s = this.sitePos.get(id);
      if (!s) continue;
      const b = new Bld(seeded('searched:' + id));
      const spec = SITE_PROPS[s.prop];
      const f = -(spec.front);
      if (s.prop === 'nest' || s.prop === 'sarcophagus' || s.prop === 'planter') {
        // disturbed ground: scattered straw / soil / pebbles around the prop
        for (let i = 0; i < 7; i++) {
          const a = i * 2.4, r = spec.r * (0.9 + (i % 3) * 0.18);
          b.lit.add(ICO0, i % 2 ? '#8a7a4a' : '#3a2e22', [Math.cos(a) * r, 0.03, Math.sin(a) * r], [a, a * 2, 0], [0.14, 0.04, 0.1], NG);
        }
      } else {
        // a drawer / tray pulled out and loose papers on the floor in front
        b.lit.add(BOX, '#3a2517', [0.0, 0.62, f * 0.5 - 0.2], [0, 0, 0], [0.5, 0.12, 0.45], { gradient: 0.1 });
        b.lit.add(BOX, '#241610', [0.0, 0.69, f * 0.5 - 0.2], [0, 0, 0], [0.44, 0.02, 0.39], NG);
        b.lit.add(BOX, '#efe5c8', [0.0, 0.7, f * 0.5 - 0.2], [0, 0.4, 0.15], [0.26, 0.012, 0.18], NG);
        for (let i = 0; i < 4; i++) b.lit.add(BOX, i % 2 ? '#efe5c8' : '#e0d4b0', [-0.35 + i * 0.28, 0.025, f - 0.1 - (i % 2) * 0.25], [0, i * 1.3, 0], [0.26, 0.01, 0.19], NG);
        b.lit.add(CYL6, PAL.woodDark, [0.4, 0.03, f - 0.3], [0, 0, 1.45], [0.02, 0.2, 0.02], NG);
      }
      const p = b.finish(s.x, s.z, s.yaw, 1);
      col.add(p.lit);
    }
    const g = mergeAll([...col]);
    if (g) {
      this.searchedMesh = new THREE.Mesh(g, this.searchedMat);
      this.root.add(this.searchedMesh);
    }
  }

  // ---------------------------------------------------------------------------------------- frame
  /** Call once per frame. `forceInv` re-reads the sim's investigation state (after an investigation event). */
  update(run: RenderableMysteryRun, eff: ActiveEffects, c: ViewCtx, forceInv: boolean): void {
    const inv = this.refresh(run, c.T, forceInv);
    const p = run.player;
    const { glows, beams, gc, calm } = c;
    this.pulse = calm ? 0.8 : 0.7 + 0.3 * Math.sin(c.T * 3.2);
    const tw = this.pulse;

    // ---- checked sites
    const searched: string[] = [];
    if (inv) {
      searched.push(...inv.checkedClueSites, ...inv.checkedEggSites);
      for (const sid of Object.values(inv.knownClueSites)) if (sid && run.cluesFound.length) searched.push(sid);
      if (inv.eggSeenAt && run.egg.state !== 'resting') searched.push(inv.eggSeenAt);
    }
    this.rebuildSearched(searched);
    const checked = new Set(searched);
    this.stats.checked = checked.size;

    // ---- clue items (truth position is used only for known / revealed / near)
    const vis: ClueId[] = [];
    for (const cl of run.map.clues) {
      let prop = this.clueProps.get(cl.clueId);
      const show = this.clueVisible(run, eff, cl.clueId, cl.x, cl.z);
      if (!show) { if (prop) prop.root.visible = false; continue; }
      if (!prop) { prop = new ClueProp(cl.clueId); this.root.add(prop.root); this.clueProps.set(cl.clueId, prop); }
      const site = this.siteAt(cl.x, cl.z);
      const spec = site ? SITE_PROPS[site.prop] : SITE_PROPS.desk;
      const yaw = site?.yaw ?? 0;
      const s = Math.sin(yaw), co = Math.cos(yaw);
      const lz = spec.itemZ;
      prop.root.visible = true;
      prop.root.position.set(cl.x + lz * s, spec.itemY, cl.z + lz * co);
      prop.root.rotation.y = yaw;
      prop.marker.position.y = 0.55 + (calm ? 0 : Math.sin(c.T * 1.8 + cl.x) * 0.04);
      prop.marker.rotation.y = calm ? 0.5 : c.T * 1.6;
      vis.push(cl.clueId);
      const known = inv?.knownClueSites?.[cl.clueId] !== undefined;
      const rev = eff.revealedClues.includes(cl.clueId);
      // glint: the single visual tell of a visible item (a soft glow; reveals get a bigger halo in the scene)
      if (!rev) glows.add(cl.x + lz * s, spec.itemY + 0.12, cl.z + lz * co, 1.0, gc.set('#ffe9a0'), 0.5 * tw);
      if (known && !rev) beams.push(cl.x, cl.z, 0.16, 5, '#ffe9a0', 0.1 * tw, spec.itemY);
    }
    for (const [id, pr] of this.clueProps) if (!vis.includes(id)) pr.root.visible = false;
    this.stats.evidenceVisible = vis;

    // ---- outlines: candidate sites, unexamined objects, the lever, the visible egg; bright for the one in reach
    const hulls = this.hulls;
    hulls.begin();
    this.reachPos = null;
    const it = c.it;
    const reachSite = it && (it.kind === 'clue' || it.kind === 'examine' || it.kind === 'lever' || it.kind === 'egg' || it.kind === 'switch' || it.kind === 'practice') ? it : null;
    let reachDone = false;
    const reach = (key: string | null, x: number, y: number, z: number, yaw: number): void => {
      if (!key) return;
      const g = this.hull(key);
      if (g) { hulls.add(g, x, y, z, yaw, true); reachDone = true; this.reachPos = { x, y, z }; }
    };
    // resolve the in-reach target first
    if (reachSite) {
      switch (reachSite.kind) {
        case 'clue': {
          const cl = run.map.clues.find((q) => q.clueId === reachSite.id);
          const site = this.sitePos.get(reachSite.id) ?? (cl ? this.siteAt(cl.x, cl.z) : null);
          const at = site ?? (cl ? { x: cl.x, z: cl.z, yaw: 0, prop: 'desk' as SitePropKind } : null);
          if (at) reach(`site:${at.prop}`, at.x, 0, at.z, at.yaw);
          break;
        }
        case 'examine': {
          const e = this.dress.extras.examines.find((q) => q.id === reachSite.id) ?? this.dress.extras.examines.reduce<(typeof this.dress.extras.examines)[number] | null>((best, q) => {
            const d = Math.hypot(q.x - p.x, q.z - p.z);
            return !best || d < Math.hypot(best.x - p.x, best.z - p.z) ? q : best;
          }, null);
          if (e) reach(`examine:${e.prop}`, e.x, 0, e.z, e.yaw);
          break;
        }
        case 'lever': { const lv = this.dress.extras.lever; if (lv) reach('lever', lv.x, 0, lv.z, lv.yaw); break; }
        case 'egg': if (run.egg.state !== 'carried') reach('egg', run.egg.x, run.egg.state === 'resting' ? this.restHeight(run.egg.x, run.egg.z) - 0.27 : 0.05, run.egg.z, 0); break;
        case 'practice': {
          // the tutorial crate on the pier: the crate cover nearest the player
          let best: { x: number; z: number; radius: number } | null = null, bd = 4;
          for (const cv of this.map.cover) {
            if (cv.kind !== 'crate') continue;
            const d = Math.hypot(cv.x - p.x, cv.z - p.z);
            if (d < bd) { bd = d; best = cv; }
          }
          if (best) reach(`box:${(best.radius * 1.55).toFixed(2)}`, best.x, 0, best.z, 0);
          break;
        }
        case 'switch': if (this.hullGeos.has('switch') && this.map.powerSwitch) { const sw = this.dress.swtch; reach('switch', this.map.powerSwitch.x, 0, this.map.powerSwitch.z, sw?.yaw ?? 0); } break;
        default: break;
      }
    }
    this.reachK = damp(this.reachK, reachDone ? 1 : 0, 14, c.dt);
    // dim outlines within OUTLINE_M and line of sight (every candidate alike: no tell about which one is real)
    const near = (x: number, z: number, r: number): boolean => Math.abs(x - p.x) < r && Math.abs(z - p.z) < r && Math.hypot(x - p.x, z - p.z) < r && this.clear(run, p.x, p.z, x, z);
    for (const s of this.dress.extras.sites) {
      if (checked.has(s.site.id)) continue;
      if (hulls.count >= 7) break;
      if (reachDone && Math.hypot(s.x - p.x, s.z - p.z) < 2.2 && reachSite?.kind === 'clue') continue; // the bright one covers it
      if (near(s.x, s.z, OUTLINE_M)) { const g = this.hull(`site:${s.site.prop}`); if (g) hulls.add(g, s.x, 0, s.z, s.yaw, false); }
    }
    const examined = new Set(inv?.examined ?? []);
    for (const e of this.dress.extras.examines) {
      if (examined.has(e.id) || hulls.count >= 7) continue;
      if (reachDone && reachSite?.kind === 'examine' && Math.hypot(e.x - p.x, e.z - p.z) < 2.2) continue;
      if (near(e.x, e.z, OUTLINE_M)) { const g = this.hull(`examine:${e.prop}`); if (g) hulls.add(g, e.x, 0, e.z, e.yaw, false); }
    }
    const lv = this.dress.extras.lever;
    if (lv && !inv?.passageOpen && !(reachDone && reachSite?.kind === 'lever') && hulls.count < 8 && near(lv.x, lv.z, OUTLINE_M)) { const g = this.hull('lever'); if (g) hulls.add(g, lv.x, 0, lv.z, lv.yaw, false); }
    hulls.end();
    this.stats.outlines = hulls.count;
    this.hullBright.opacity = calm ? 0.95 : 0.8 + 0.2 * Math.sin(c.T * 5);

    // ---- soft glints within ~8 m: known sites (item still there), unexamined examines, the lever
    const glint = (x: number, y: number, z: number, size: number, col: string, a: number): void => {
      const d = Math.hypot(x - p.x, z - p.z);
      if (d > GLINT_M) return;
      glows.add(x, y, z, size, gc.set(col), a * (1 - smoothstep(GLINT_M - 2, GLINT_M, d)) * tw);
    };
    for (const e of this.dress.extras.examines) if (!examined.has(e.id)) glint(e.x, 0.9, e.z, 1.1, '#bfe8ff', 0.4);
    if (lv && !inv?.passageOpen) glint(lv.x, 1.0, lv.z, 1.1, '#ffe0a0', 0.4);
    if (inv) {
      for (const [cid, sid] of Object.entries(inv.knownClueSites)) {
        if (!sid || run.cluesFound.includes(cid as ClueId)) continue;
        const s = this.sitePos.get(sid);
        if (s) glint(s.x, 1.0, s.z, 1.3, '#ffe9a0', 0.45);
      }
    }
    this.stats.eggVisible = this.eggVisible(run, eff);
  }

  dispose(): void {
    for (const p of this.clueProps.values()) p.dispose();
    for (const g of this.hullGeos.values()) g.dispose();
    this.hullDim.dispose();
    this.hullBright.dispose();
    this.searchedMat.dispose();
    if (this.searchedMesh) this.searchedMesh.geometry.dispose();
  }
}
