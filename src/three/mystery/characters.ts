// Third-person player avatars (one per Nightshade) with a procedural two-bone rig, plus the floating Pokemon companion.
// Silhouettes are intentionally different: braids + A-line dress, long gown + hair curtain, rainbow mane, uniform blazer
// + pleats, bee hat, pinstripe suit + moustache, tall beanie jacket. Models face -Z; feet at y = 0.
import * as THREE from 'three';
import type { NightshadeId, PokemonId } from '../../mystery/types.ts';
import { POKEMON } from '../../game/constants.ts';
import { lambertVC } from '../actors.ts';
import { ModelUnavailableError, loadPokemonModel, type PokemonModelInstance } from '../pokemonModels/loader.ts';
import { POKEMON_MODEL_REFS } from '../pokemonModels/refs.ts';
import { MeshBuilder, clamp, damp, hashString, lerp, mulberry32 } from '../util.ts';
import { BOX, CONE4, CONE5, CONE6, CONE8, CYL6, CYL8, ICO0, ICO1, PAL, TORUS } from './common.ts';

const THIGH = 0.42;
const SHIN = 0.42;
const UPPER = 0.28;
const FORE = 0.27;

type Hair = 'braids' | 'curtain' | 'mane' | 'wavy' | 'mop' | 'slick' | 'short';
type Skirt = 'none' | 'a_line' | 'gown' | 'pleats' | 'tiers';

interface Style {
  scale: number;
  skin: string;
  top: string; trim: string; sleeve: string;
  leg: string; shoe: string;
  hair: string; hairTip?: string; hairStyle: Hair;
  skirt: Skirt; skirtColor: string; skirtTrim: string;
  chunk: number; // torso width multiplier
}

const STYLES: Record<NightshadeId, Style> = {
  wednesday: { scale: 1, skin: '#eee5d8', top: '#15151d', trim: '#eae6da', sleeve: '#15151d', leg: '#1a1a22', shoe: '#0c0c10', hair: '#0e0e13', hairStyle: 'braids', skirt: 'a_line', skirtColor: '#17171f', skirtTrim: '#2a2a36', chunk: 0.92 },
  morticia: { scale: 1.04, skin: '#eee5d8', top: '#12121a', trim: '#4a1942', sleeve: '#12121a', leg: '#12121a', shoe: '#0c0c10', hair: '#0a0a10', hairStyle: 'curtain', skirt: 'gown', skirtColor: '#13131c', skirtTrim: '#4a1942', chunk: 0.88 },
  enid: { scale: 0.98, skin: '#f0d6c0', top: '#f4a7c8', trim: '#f7e27a', sleeve: '#8fd3f4', leg: '#f7e27a', shoe: '#b06ae0', hair: '#f7e27a', hairTip: '#f06ab4', hairStyle: 'mane', skirt: 'tiers', skirtColor: '#8fd3f4', skirtTrim: '#f4a7c8', chunk: 0.98 },
  bianca: { scale: 1.0, skin: '#e8c9a8', top: '#25306a', trim: '#d4af3f', sleeve: '#25306a', leg: '#e9e6f0', shoe: '#1a1a26', hair: '#4a2e24', hairStyle: 'wavy', skirt: 'pleats', skirtColor: '#6b2f95', skirtTrim: '#25306a', chunk: 0.95 },
  eugene: { scale: 0.9, skin: '#f0d3b6', top: '#e0a526', trim: '#6b4423', sleeve: '#e0a526', leg: '#4a3a2a', shoe: '#3a2a1a', hair: '#6b4a2a', hairStyle: 'mop', skirt: 'none', skirtColor: '#4a3a2a', skirtTrim: '#4a3a2a', chunk: 1.12 },
  gomez: { scale: 1.06, skin: '#e2c2a2', top: '#14141c', trim: '#c01c2e', sleeve: '#14141c', leg: '#14141c', shoe: '#0a0a0e', hair: '#0b0b10', hairStyle: 'slick', skirt: 'none', skirtColor: '#14141c', skirtTrim: '#14141c', chunk: 1.08 },
  ajax: { scale: 1.12, skin: '#d9b896', top: '#3b3f8f', trim: '#e8e8f0', sleeve: '#8a90a6', leg: '#23283a', shoe: '#e8e8f0', hair: '#1b1b20', hairStyle: 'short', skirt: 'none', skirtColor: '#23283a', skirtTrim: '#23283a', chunk: 1.2 },
};

export type Stance = 'idle' | 'walk' | 'crouch' | 'sprint';

export interface AvatarFrame {
  dt: number;
  clock: number;
  speed: number;
  stance: Stance;
  carrying: boolean;
  boost: boolean;
  /** -1 moving backwards relative to the facing, +1 forwards */
  dir: number;
  hidden: boolean;
  /** local-space yaw offset of the head toward something interesting (rad) */
  lookYaw?: number;
}

export class Avatar {
  readonly root = new THREE.Group();
  readonly eggSlot = new THREE.Object3D();
  readonly headTop = new THREE.Object3D();
  private readonly body = new THREE.Group();
  private readonly chest = new THREE.Group();
  private readonly head = new THREE.Group();
  private readonly skirt = new THREE.Group();
  private readonly hairBack = new THREE.Group();
  private readonly arm: { sh: THREE.Group; el: THREE.Group }[] = [];
  private readonly leg: { hip: THREE.Group; knee: THREE.Group }[] = [];
  private readonly geos: THREE.BufferGeometry[] = [];
  private phase = 0;
  private crouchK = 0;
  private carryK = 0;
  private sprintK = 0;
  private walkK = 0;
  private lookYaw = 0;
  private swayX = 0;

  constructor(readonly id: NightshadeId, mat: THREE.Material) {
    const st = STYLES[id];
    const rand = mulberry32(hashString('avatar:' + id));
    this.root.add(this.body);
    this.root.scale.setScalar(st.scale);
    const mesh = (geo: THREE.BufferGeometry, parent: THREE.Object3D): THREE.Mesh => {
      this.geos.push(geo);
      const m = new THREE.Mesh(geo, mat);
      parent.add(m);
      return m;
    };
    const tone = (hex: string, k: number): string => '#' + new THREE.Color(hex).multiplyScalar(k).getHexString();

    // ---- legs (hip -> thigh, knee -> shin + foot)
    for (const s of [-1, 1]) {
      const hip = new THREE.Group();
      hip.position.set(s * 0.095 * st.chunk, 0, 0);
      this.body.add(hip);
      const thigh = new MeshBuilder(rand);
      thigh.add(CYL6, st.leg, [0, -THIGH / 2, 0], [0, 0, 0], [0.07, THIGH, 0.07], { gradient: 0.1, jitter: 0.04 });
      if (id === 'enid') for (let k = 0; k < 3; k++) thigh.add(CYL6, k % 2 ? '#f06ab4' : '#8fd3f4', [0, -0.08 - k * 0.12, 0], [0, 0, 0], [0.074, 0.05, 0.074], { gradient: 0, jitter: 0 });
      mesh(thigh.build(), hip);
      const knee = new THREE.Group();
      knee.position.set(0, -THIGH, 0);
      hip.add(knee);
      const shin = new MeshBuilder(rand);
      shin.add(CYL6, st.leg, [0, -SHIN / 2, 0], [0, 0, 0], [0.062, SHIN, 0.062], { gradient: 0.1, jitter: 0.04 });
      if (id === 'enid') for (let k = 0; k < 3; k++) shin.add(CYL6, k % 2 ? '#f06ab4' : '#8fd3f4', [0, -0.08 - k * 0.12, 0], [0, 0, 0], [0.066, 0.05, 0.066], { gradient: 0, jitter: 0 });
      shin.add(BOX, st.shoe, [0, -SHIN + 0.02, -0.05], [0, 0, 0], [0.11, 0.09, 0.26], { gradient: 0.1 });
      if (id === 'ajax') shin.add(BOX, '#b8bccc', [0, -SHIN + 0.0, -0.05], [0, 0, 0], [0.115, 0.03, 0.265], { gradient: 0 });
      mesh(shin.build(), knee);
      this.leg.push({ hip, knee });
    }

    // ---- chest
    this.chest.position.set(0, 0.04, 0);
    this.body.add(this.chest);
    const torso = new MeshBuilder(rand);
    const w = 0.34 * st.chunk;
    torso.add(CYL8, st.top, [0, 0.25, 0], [0, 0, 0], [w * 0.5, 0.52, w * 0.38], { gradient: 0.25, jitter: 0.05 });
    torso.add(ICO0, st.top, [0, 0.5, 0], [0, 0, 0], [w * 0.62, 0.1, w * 0.42], { gradient: 0.1 });
    this.decorateTorso(torso, id, st, w, tone);
    mesh(torso.build(), this.chest);

    // ---- head
    this.head.position.set(0, 0.6, 0);
    this.chest.add(this.head);
    const hb = new MeshBuilder(rand);
    const hr = id === 'eugene' ? 0.185 : 0.16;
    hb.add(ICO1, st.skin, [0, hr, 0], [0, 0, 0], [hr, hr * 1.05, hr * 0.97], { gradient: 0.1, jitter: 0.03 });
    for (const s of [-1, 1]) hb.add(ICO0, '#14141c', [s * hr * 0.4, hr * 1.05, -hr * 0.9], [0, 0, 0], [0.022, 0.03, 0.015], { jitter: 0, gradient: 0 });
    hb.add(BOX, id === 'morticia' ? '#8a1830' : '#8a6a60', [0, hr * 0.62, -hr * 0.95], [0, 0, 0], [0.05, 0.012, 0.01], { jitter: 0, gradient: 0 });
    this.decorateHead(hb, id, st, hr, rand);
    mesh(hb.build(), this.head);
    this.headTop.position.set(0, hr * 2.4, 0);
    this.head.add(this.headTop);

    // ---- hair that swings (braids / curtain / mane / wavy)
    this.hairBack.position.set(0, 0.6 + hr * 1.55, hr * 0.35);
    this.chest.add(this.hairBack);
    const hairB = new MeshBuilder(rand);
    this.hairSwing(hairB, st, hr);
    const hg = hairB.build();
    if (hg.getAttribute('position')) mesh(hg, this.hairBack);

    // ---- skirt / gown
    this.skirt.position.set(0, 0.05, 0);
    this.body.add(this.skirt);
    const sg = this.buildSkirt(st, rand);
    if (sg) mesh(sg, this.skirt);

    // ---- arms
    for (const s of [-1, 1]) {
      const sh = new THREE.Group();
      sh.position.set(s * (w * 0.5 + 0.045), 0.47, 0);
      this.chest.add(sh);
      const up = new MeshBuilder(rand);
      const sleeveCol = id === 'enid' ? (s < 0 ? '#8fd3f4' : '#f7e27a') : st.sleeve;
      up.add(CYL6, sleeveCol, [0, -UPPER / 2, 0], [0, 0, 0], [0.055, UPPER, 0.055], { gradient: 0.1, jitter: 0.04 });
      up.add(ICO0, st.top, [0, 0, 0], [0, 0, 0], 0.07, { gradient: 0, jitter: 0.03 });
      mesh(up.build(), sh);
      const el = new THREE.Group();
      el.position.set(0, -UPPER, 0);
      sh.add(el);
      const fo = new MeshBuilder(rand);
      fo.add(CYL6, sleeveCol, [0, -FORE * 0.4, 0], [0, 0, 0], [0.05, FORE * 0.8, 0.05], { gradient: 0.1, jitter: 0.04 });
      if (id === 'wednesday' || id === 'gomez') fo.add(CYL6, '#f4f1e8', [0, -FORE * 0.78, 0], [0, 0, 0], [0.056, 0.035, 0.056], { gradient: 0, jitter: 0 });
      fo.add(ICO0, st.skin, [0, -FORE - 0.0, 0], [0, 0, 0], [0.05, 0.06, 0.05], { gradient: 0, jitter: 0.02 });
      mesh(fo.build(), el);
      this.arm.push({ sh, el });
    }

    this.eggSlot.position.set(0, 0.34, -0.42);
    this.chest.add(this.eggSlot);
  }

  private decorateTorso(tb: MeshBuilder, id: NightshadeId, st: Style, w: number, tone: (h: string, k: number) => string): void {
    switch (id) {
      case 'wednesday':
        tb.add(BOX, st.trim, [-0.07, 0.5, -0.065], [0.25, 0, 0.7], [0.1, 0.02, 0.1], { gradient: 0, jitter: 0 });
        tb.add(BOX, st.trim, [0.07, 0.5, -0.065], [0.25, 0, -0.7], [0.1, 0.02, 0.1], { gradient: 0, jitter: 0 });
        tb.add(BOX, '#0a0a10', [0, 0.45, -0.075], [0, 0, 0], [0.08, 0.04, 0.02], { gradient: 0, jitter: 0 });
        break;
      case 'morticia':
        tb.add(BOX, st.trim, [0, 0.36, -0.085], [0, 0, 0], [0.1, 0.32, 0.01], { gradient: 0, jitter: 0 });
        tb.add(ICO0, '#9a1830', [0, 0.5, -0.1], [0, 0, 0], 0.025, { gradient: 0, jitter: 0 });
        break;
      case 'enid':
        for (let k = 0; k < 4; k++) tb.add(CYL8, k % 2 ? '#f7e27a' : '#f4a7c8', [0, 0.1 + k * 0.12, 0], [0, 0, 0], [w * 0.51, 0.06, w * 0.39], { gradient: 0, jitter: 0.03 });
        tb.add(ICO0, '#8fd3f4', [0, 0.52, -0.09], [0, 0, 0], 0.035, { gradient: 0, jitter: 0 });
        break;
      case 'bianca':
        tb.add(BOX, '#d4af3f', [0, 0.34, w * 0.38 + 0.008], [0, 0, 0], [0.11, 0.13, 0.012], { gradient: 0, jitter: 0 });
        tb.add(BOX, '#6b2f95', [0, 0.34, w * 0.38 + 0.016], [0, 0, 0], [0.07, 0.09, 0.012], { gradient: 0, jitter: 0 });
        tb.add(BOX, '#f2f2f6', [0, 0.52, w * 0.36], [0, 0, 0], [0.16, 0.03, 0.02], { gradient: 0, jitter: 0 });
        tb.add(BOX, '#f2f2f6', [0, 0.46, -0.075], [0.1, 0, 0], [0.1, 0.16, 0.02], { gradient: 0, jitter: 0 });
        for (const s of [-1, 1]) {
          tb.add(BOX, st.trim, [s * 0.04, 0.3, -w * 0.38 - 0.005], [0, 0, 0], [0.018, 0.018, 0.012], { gradient: 0, jitter: 0 });
          tb.add(BOX, '#6b2f95', [s * 0.065, 0.38, -w * 0.38 - 0.005], [0, 0, s * 0.3], [0.04, 0.2, 0.012], { gradient: 0, jitter: 0 });
        }
        break;
      case 'eugene':
        tb.add(BOX, '#2a2a32', [0, 0.28, w * 0.38 + 0.09], [0, 0, 0], [0.3, 0.34, 0.16], { gradient: 0.1, jitter: 0.04 });
        for (let k = 0; k < 4; k++) tb.add(BOX, k % 2 ? '#1c1c22' : '#f2c230', [0, 0.16 + k * 0.085, w * 0.38 + 0.172], [0, 0, 0], [0.3, 0.075, 0.012], { gradient: 0, jitter: 0 });
        for (const sx of [-1, 1]) {
          tb.add(BOX, '#6b4423', [sx * 0.09, 0.36, -w * 0.3], [0.05, 0, 0], [0.04, 0.34, 0.012], { gradient: 0, jitter: 0 });
          tb.add(ICO0, '#dff6ff', [sx * 0.2, 0.46, w * 0.38 + 0.2], [0.2, 0, sx * 0.5], [0.12, 0.012, 0.07], { gradient: 0, jitter: 0 });
        }
        tb.add(CYL8, '#6b4423', [0, 0.27, 0], [0, 0, 0], [w * 0.52, 0.34, w * 0.4], { gradient: 0.15 });
        tb.add(ICO1, '#c98f1c', [0, 0.52, 0.09], [0, 0, 0], [0.1, 0.07, 0.07], { gradient: 0.1 }); // hood
        break;
      case 'gomez':
        tb.add(BOX, '#f2eee4', [0, 0.38, -w * 0.38], [0, 0, 0], [0.09, 0.3, 0.012], { gradient: 0, jitter: 0 });
        tb.add(BOX, st.trim, [0, 0.36, -w * 0.38 - 0.008], [0, 0, 0], [0.035, 0.26, 0.012], { gradient: 0, jitter: 0 });
        tb.add(BOX, '#c01c2e', [-w * 0.34, 0.42, -w * 0.38], [0, 0, 0], [0.05, 0.035, 0.012], { gradient: 0, jitter: 0 });
        for (let k = -2; k <= 2; k++) tb.add(BOX, tone(st.top, 2.2), [k * 0.05, 0.22, -w * 0.385], [0, 0, 0], [0.006, 0.4, 0.004], { gradient: 0, jitter: 0 });
        for (let k = -3; k <= 3; k++) tb.add(BOX, '#8a8aa8', [k * 0.045, 0.24, w * 0.385], [0, 0, 0], [0.007, 0.44, 0.004], { gradient: 0, jitter: 0 });
        for (const sx of [-1, 1]) {
          tb.add(CONE4, st.top, [sx * 0.07, -0.08, 0.1], [Math.PI, Math.PI / 4, 0], [0.12, 0.3, 0.08], { gradient: 0.2 });
          tb.add(BOX, '#c01c2e', [sx * 0.07, -0.19, 0.115], [0.1, 0, 0], [0.05, 0.1, 0.012], { gradient: 0, jitter: 0 });
        }
        tb.add(BOX, '#c01c2e', [0, 0.52, w * 0.3], [0, 0, 0], [0.2, 0.025, 0.04], { gradient: 0, jitter: 0 }); // red collar lining
        break;
      case 'ajax':
        tb.add(BOX, '#e8e8f0', [0, 0.28, -w * 0.38], [0, 0, 0], [0.02, 0.4, 0.012], { gradient: 0, jitter: 0 });
        tb.add(BOX, st.trim, [-w * 0.3, 0.38, -w * 0.38 - 0.004], [0, 0, 0], [0.07, 0.07, 0.012], { gradient: 0, jitter: 0 });
        tb.add(CYL8, '#8a90a6', [0, 0.04, 0], [0, 0, 0], [w * 0.52, 0.07, w * 0.4], { gradient: 0 });
        tb.add(CYL8, '#e8e8f0', [0, 0.1, 0], [0, 0, 0], [w * 0.52, 0.018, w * 0.4], { gradient: 0 });
        tb.add(BOX, '#d4af3f', [0, 0.34, w * 0.38 + 0.004], [0, 0, 0], [0.19, 0.25, 0.01], { gradient: 0, jitter: 0 });
        for (const sx of [-1, 1]) tb.add(BOX, '#f2f2fa', [sx * 0.045, 0.34, w * 0.38 + 0.01], [0, 0, sx * -0.28], [0.03, 0.2, 0.014], { gradient: 0, jitter: 0 });
        tb.add(BOX, '#f2f2fa', [0, 0.31, w * 0.38 + 0.01], [0, 0, 0], [0.08, 0.025, 0.014], { gradient: 0, jitter: 0 });
        break;
    }
  }

  private decorateHead(hb: MeshBuilder, id: NightshadeId, st: Style, hr: number, rand: () => number): void {
    const top = hr * 1.95;
    switch (id) {
      case 'wednesday':
        hb.add(ICO1, st.hair, [0, hr * 1.28, hr * 0.12], [0, 0, 0], [hr * 1.06, hr * 0.95, hr * 1.02], { gradient: 0.1, jitter: 0.04 });
        hb.add(BOX, st.hair, [0, hr * 1.7, -hr * 0.72], [0.35, 0, 0], [hr * 1.4, hr * 0.3, hr * 0.3], { gradient: 0, jitter: 0.03 }); // fringe
        break;
      case 'morticia':
        hb.add(ICO1, st.hair, [0, hr * 1.25, hr * 0.15], [0, 0, 0], [hr * 1.1, hr * 1.0, hr * 1.06], { gradient: 0.1, jitter: 0.04 });
        hb.add(BOX, st.hair, [-hr * 0.35, hr * 1.55, -hr * 0.8], [0.2, 0, 0.5], [hr * 0.9, hr * 0.25, hr * 0.2], { gradient: 0, jitter: 0.03 });
        break;
      case 'enid':
        hb.add(ICO1, st.hair, [0, hr * 1.3, hr * 0.1], [0, 0, 0], [hr * 1.2, hr * 1.0, hr * 1.14], { gradient: 0.1, jitter: 0.05 });
        for (const s of [-1, 1]) hb.add(CONE5, '#f4a7c8', [s * hr * 0.75, top + 0.02, 0], [0, 0, -s * 0.2], [0.07, 0.17, 0.05], { gradient: 0, jitter: 0.03 }); // wolf-ear tufts
        for (let k = 0; k < 6; k++) {
          const a = (k / 6) * Math.PI * 2;
          hb.add(CONE4, k % 2 ? '#f06ab4' : '#8fd3f4', [Math.cos(a) * hr * 1.0, hr * 1.5, Math.sin(a) * hr * 1.0], [Math.sin(a) * 0.9, 0, -Math.cos(a) * 0.9], [0.05, 0.16, 0.05], { gradient: 0, jitter: 0.05 });
        }
        break;
      case 'bianca':
        hb.add(ICO1, st.hair, [0, hr * 1.28, hr * 0.12], [0, 0, 0], [hr * 1.1, hr * 1.0, hr * 1.06], { gradient: 0.1, jitter: 0.05 });
        hb.add(ICO0, st.hair, [-hr * 0.7, hr * 1.55, -hr * 0.55], [0, 0, 0], [hr * 0.4, hr * 0.3, hr * 0.3], { gradient: 0 });
        break;
      case 'eugene': {
        // bee hat: striped dome, two antennae with bobbles, little wings
        hb.add(ICO1, '#6b4a2a', [0, hr * 1.2, hr * 0.1], [0, 0, 0], [hr * 1.06, hr * 0.7, hr * 1.04], { gradient: 0.1 });
        for (let k = 0; k < 5; k++) {
          const y = hr * (1.55 + k * 0.17);
          const rr = hr * (1.08 - k * 0.2);
          hb.add(CYL8, k % 2 ? '#1b1b22' : '#f2c230', [0, y, 0], [0, 0, 0], [rr, hr * 0.17, rr], { gradient: 0, jitter: 0.02 });
        }
        for (const s of [-1, 1]) {
          hb.add(CYL5_ANT, '#1b1b22', [s * hr * 0.35, top + hr * 0.9, -hr * 0.05], [0, 0, -s * 0.35], [0.012, hr * 1.1, 0.012], { gradient: 0 });
          hb.add(ICO0, '#f2c230', [s * hr * 0.6, top + hr * 1.45, -hr * 0.05], [0, 0, 0], 0.04, { gradient: 0, jitter: 0 });
          hb.add(ICO0, '#dff6ff', [s * hr * 0.9, hr * 1.9, hr * 0.7], [0.2, 0, s * 0.6], [0.14, 0.015, 0.07], { gradient: 0, jitter: 0 }); // wings
        }
        // round glasses
        for (const s of [-1, 1]) hb.add(TORUS, '#2a2220', [s * hr * 0.42, hr * 1.05, -hr * 0.92], [0, 0, 0], [0.055, 0.055, 0.2], { gradient: 0, jitter: 0 });
        break;
      }
      case 'gomez':
        hb.add(ICO1, st.hair, [0, hr * 1.35, -hr * 0.02], [0, 0, 0], [hr * 1.02, hr * 0.7, hr * 1.04], { gradient: 0.1, jitter: 0.03 });
        hb.add(BOX, '#0b0b10', [-hr * 0.2, hr * 0.66, -hr * 0.98], [0, 0, -0.18], [hr * 0.5, hr * 0.07, hr * 0.06], { gradient: 0, jitter: 0 }); // moustache
        hb.add(BOX, '#0b0b10', [hr * 0.2, hr * 0.66, -hr * 0.98], [0, 0, 0.18], [hr * 0.5, hr * 0.07, hr * 0.06], { gradient: 0, jitter: 0 });
        break;
      case 'ajax':
        hb.add(ICO1, st.hair, [0, hr * 1.2, hr * 0.1], [0, 0, 0], [hr * 1.02, hr * 0.9, hr * 1.0], { gradient: 0.1 });
        // beanie with folded cuff and pom
        hb.add(ICO1, '#8a90a6', [0, hr * 1.55, hr * 0.02], [0, 0, 0], [hr * 1.08, hr * 0.62, hr * 1.06], { gradient: 0.1, jitter: 0.04 });
        hb.add(CYL8, '#d9dbe6', [0, hr * 1.38, 0], [0, 0, 0], [hr * 1.1, hr * 0.2, hr * 1.08], { gradient: 0, jitter: 0.03 });
        hb.add(ICO0, '#d9dbe6', [0, top + hr * 0.22, 0], [0, 0, 0], hr * 0.2, { gradient: 0, jitter: 0.03 });
        break;
    }
    void rand;
  }

  private hairSwing(hb: MeshBuilder, st: Style, hr: number): void {
    const hairTip = st.hairTip ?? st.hair;
    switch (st.hairStyle) {
      case 'braids':
        for (const s of [-1, 1]) {
          for (let k = 0; k < 6; k++) hb.add(ICO0, st.hair, [s * (0.12 + Math.sin(k * 1.4) * 0.012), -0.1 - k * 0.1, 0.1], [0, 0, 0], [0.058, 0.08, 0.055], { gradient: 0, jitter: 0.05 });
          hb.add(BOX, '#e9e4d6', [s * 0.12, -0.72, 0.1], [0, 0, 0], [0.07, 0.035, 0.07], { gradient: 0, jitter: 0 });
          hb.add(BOX, '#0a0a10', [s * 0.12, -0.78, 0.1], [0, 0, 0], [0.04, 0.06, 0.04], { gradient: 0, jitter: 0 });
        }
        break;
      case 'curtain':
        hb.add(BOX, st.hair, [0, -0.34, 0.06], [0.04, 0, 0], [hr * 2.0, 0.8, 0.07], { gradient: 0.3, jitter: 0.03 });
        for (const s of [-1, 1]) hb.add(BOX, st.hair, [s * hr * 0.95, -0.2, -0.08], [0, 0, 0], [0.05, 0.5, 0.12], { gradient: 0.3, jitter: 0.03 });
        break;
      case 'mane':
        for (let k = 0; k < 9; k++) {
          const a = ((k - 4) / 4) * 0.9;
          const len = 0.42 + (k % 3) * 0.08;
          hb.add(CONE5, k % 3 === 0 ? '#f06ab4' : k % 3 === 1 ? hairTip : '#8fd3f4', [Math.sin(a) * hr * 1.1, -len / 2 + 0.03, 0.03 + Math.cos(a) * 0.04], [0.05, 0, Math.PI + a * 0.4], [0.075, len, 0.07], { gradient: 0, jitter: 0.05 });
        }
        break;
      case 'wavy':
        for (let k = 0; k < 5; k++) hb.add(ICO0, st.hair, [Math.sin(k * 1.6) * 0.05, -0.1 - k * 0.1, 0.05], [0, 0, 0], [hr * 1.15 - k * 0.012, 0.075, 0.075], { gradient: 0.05, jitter: 0.05 });
        for (const s of [-1, 1]) for (let k = 0; k < 3; k++) hb.add(ICO0, st.hair, [s * (hr * 0.95 + Math.sin(k * 1.5) * 0.02), -0.05 - k * 0.1, -0.06], [0, 0, 0], [0.045, 0.075, 0.06], { gradient: 0.05, jitter: 0.05 });
        break;
      default:
        break;
    }
  }

  private buildSkirt(st: Style, rand: () => number): THREE.BufferGeometry | null {
    const b = new MeshBuilder(rand);
    switch (st.skirt) {
      case 'a_line':
        b.add(new THREE.CylinderGeometry(0.17, 0.33, 0.56, 9, 1, true), st.skirtColor, [0, -0.2, 0], [0, 0, 0], 1, { gradient: 0.3, jitter: 0.05 });
        b.add(new THREE.CylinderGeometry(0.335, 0.335, 0.03, 9), st.skirtTrim, [0, -0.47, 0], [0, 0, 0], 1, { gradient: 0, jitter: 0 });
        break;
      case 'gown':
        b.add(new THREE.CylinderGeometry(0.16, 0.36, 0.86, 10, 1, true), st.skirtColor, [0, -0.38, 0], [0, 0, 0], 1, { gradient: 0.35, jitter: 0.05 });
        b.add(CONE5, st.skirtColor, [0, -0.66, 0.34], [Math.PI / 2 - 0.2, 0, 0], [0.3, 0.7, 0.12], { gradient: 0.2, jitter: 0.04 }); // trailing hem
        b.add(new THREE.CylinderGeometry(0.365, 0.365, 0.04, 10), st.skirtTrim, [0, -0.8, 0], [0, 0, 0], 1, { gradient: 0, jitter: 0 });
        break;
      case 'pleats':
        b.add(new THREE.CylinderGeometry(0.16, 0.25, 0.28, 12, 1, true), st.skirtColor, [0, -0.07, 0], [0, 0, 0], 1, { gradient: 0.2, jitter: 0.08 });
        b.add(new THREE.CylinderGeometry(0.252, 0.252, 0.025, 12), st.skirtTrim, [0, -0.2, 0], [0, 0, 0], 1, { gradient: 0, jitter: 0 });
        break;
      case 'tiers':
        for (let k = 0; k < 3; k++) {
          b.add(new THREE.CylinderGeometry(0.17 + k * 0.03, 0.24 + k * 0.045, 0.13, 9, 1, true), ['#f4a7c8', '#f7e27a', '#8fd3f4'][k], [0, -0.03 - k * 0.1, 0], [0, 0, 0], 1, { gradient: 0.1, jitter: 0.04 });
        }
        break;
      case 'none':
        return null;
    }
    const g = b.build();
    return g.getAttribute('position') ? g : null;
  }

  private legAngles(p: number, walkAmp: number, kneeAmp: number, out: [number, number]): void {
    out[0] = Math.sin(p) * walkAmp;
    out[1] = Math.max(0, Math.cos(p)) * kneeAmp + 0.05;
  }

  private readonly tmpL: [number, number] = [0, 0];
  private readonly tmpR: [number, number] = [0, 0];

  update(f: AvatarFrame): void {
    const dt = f.dt;
    const moving = f.speed > 0.15;
    const crouchT = f.stance === 'crouch' ? 1 : 0;
    this.crouchK = damp(this.crouchK, crouchT, 12, dt);
    this.carryK = damp(this.carryK, f.carrying ? 1 : 0, 9, dt);
    this.sprintK = damp(this.sprintK, f.stance === 'sprint' ? 1 : 0, 8, dt);
    this.walkK = damp(this.walkK, moving ? 1 : 0, 10, dt);
    const stride = lerp(1.5, 1.9, this.sprintK);
    this.phase += dt * f.speed * f.dir * (Math.PI * 2) / stride * (this.crouchK > 0.5 ? 1.25 : 1);
    const c = this.crouchK, wk = this.walkK, sp = this.sprintK;
    const amp = lerp(0.45, 0.95, sp) * wk;
    const kneeAmp = lerp(0.8, 1.5, sp) * wk;
    this.legAngles(this.phase, amp, kneeAmp, this.tmpL);
    this.legAngles(this.phase + Math.PI, amp, kneeAmp, this.tmpR);
    const legs = [this.tmpL, this.tmpR];
    // crouch: thighs forward, knees folded; the stride amplitude shrinks
    const cb = 0.95 * c, ck = 1.6 * c;
    let hipY = 0;
    for (let i = 0; i < 2; i++) {
      const a = legs[i][0] * (1 - c * 0.55) + cb;
      const b = Math.min(2.0, legs[i][1] * (1 - c * 0.4) + ck);
      this.leg[i].hip.rotation.x = a;
      this.leg[i].knee.rotation.x = -b;
      hipY = Math.max(hipY, THIGH * Math.cos(a) + SHIN * Math.cos(a - b));
    }
    this.body.position.y = hipY + (f.hidden ? -0.03 : 0);
    const bob = Math.sin(this.phase * 2) * 0.012 * wk;
    this.body.position.y += bob;

    // torso: lean into sprint/crouch, breathe when idle
    const breathe = Math.sin(f.clock * 1.9) * 0.012 * (1 - wk);
    const lean = 0.05 * wk + 0.28 * sp + 0.38 * c + 0.05 * this.carryK;
    this.chest.rotation.set(-lean + breathe, Math.sin(this.phase) * 0.12 * wk, Math.sin(this.phase) * 0.03 * wk);
    this.chest.position.y = 0.04 + breathe * 0.5;
    this.lookYaw = damp(this.lookYaw, f.lookYaw ?? Math.sin(f.clock * 0.35) * 0.25 * (1 - wk), 5, dt);
    this.head.rotation.set(lean * 0.8 + Math.sin(f.clock * 0.7) * 0.03, this.lookYaw, 0);

    // arms: counter-swing; carrying holds the egg at chest height in both hands
    for (let i = 0; i < 2; i++) {
      const s = i === 0 ? -1 : 1;
      const swing = Math.sin(this.phase + (i === 0 ? Math.PI : 0)) * lerp(0.5, 1.1, sp) * wk;
      const sh = this.arm[i].sh, el = this.arm[i].el;
      const idleSway = Math.sin(f.clock * 1.3 + i) * 0.03;
      const carry = this.carryK;
      sh.rotation.x = lerp(swing + idleSway, 0.75, carry);
      sh.rotation.z = lerp(s * (0.07 + 0.03 * wk), -s * 0.32, carry);
      el.rotation.x = lerp(0.25 + sp * 0.9 + Math.max(0, swing) * 0.5, 1.25, carry) + c * 0.25 * (1 - carry);
    }
    // skirt and swinging hair react to speed
    this.swayX = damp(this.swayX, f.speed * 0.06 + sp * 0.12, 6, dt);
    this.skirt.rotation.x = -this.swayX * 0.8 + Math.sin(this.phase * 2) * 0.03 * wk;
    this.skirt.scale.set(1 + c * 0.0, 1 - c * 0.28, 1 + c * 0.1);
    this.skirt.position.y = 0.05 - c * 0.0;
    this.hairBack.rotation.set(-this.swayX * 0.9 + Math.sin(f.clock * 2.1) * 0.02, Math.sin(this.phase) * 0.06 * wk, Math.sin(f.clock * 1.4) * 0.03);
    if (f.boost) this.root.rotation.z = 0;
  }

  dispose(): void {
    for (const g of this.geos) g.dispose();
  }
}

const CYL5_ANT = new THREE.CylinderGeometry(1, 1, 1, 5, 1);

// ----------------------------------------------------------------------------------------------------- companion
type CompanionKind = 'wisp' | 'spiked' | 'halo' | 'twin' | 'flame' | 'jelly';
const KINDS: CompanionKind[] = ['wisp', 'spiked', 'halo', 'twin', 'flame', 'jelly'];

function liftColor(hex: string, minL: number): THREE.Color {
  const c = new THREE.Color(hex);
  const hsl = { h: 0, s: 0, l: 0 };
  c.getHSL(hsl);
  return c.setHSL(hsl.h, hsl.s, Math.max(hsl.l, minL));
}

export class Companion {
  readonly root = new THREE.Group();
  readonly glowColor: string;
  private readonly geos: THREE.BufferGeometry[] = [];
  private readonly main: THREE.Mesh;
  private readonly second: THREE.Mesh | null = null;
  private readonly x = new THREE.Vector3();
  private seeded = false;
  readonly mat: THREE.MeshLambertMaterial;
  /** PokeAPI official artwork as a camera-facing alpha-tested sprite; the procedural model above is the fallback until it loads */
  private art: THREE.Sprite | null = null;
  private artTex: THREE.Texture | null = null;
  private artMat: THREE.SpriteMaterial | null = null;
  /** Real 3D model (local cache or community API); shown over the artwork once it loads, artwork stays the fallback */
  private model: PokemonModelInstance | null = null;
  private modelTurn = 0;
  private flashT = 0;
  private fade = 0;
  private faded = false;
  private disposedFlag = false;
  artLoaded = false;
  /** What is on screen: 3D model, else PokéAPI artwork, else the procedural stand-in. */
  visual: 'model' | 'art' | 'procedural' = 'procedural';
  modelSource: string | null = null;
  modelError: string | null = null;
  /** world height of the artwork billboard (m) before the per-partner factor: the visible creature is ~0.6 x the player's height */
  static readonly ART_HEIGHT = 1.1;
  static readonly MODEL_HEIGHT = 0.88;
  static readonly MODEL_SELF_LIT = 0.35;
  /** the companion never floats closer than this to the camera lens (m) */
  static readonly MIN_LENS_M = 2.8;
  /** per-partner size factor (the player is ~1.7 m): big ghosts a little taller, small ones a little shorter */
  static readonly SIZE_K: Partial<Record<PokemonId, number>> = {
    gengar: 0.95, alolan_marowak: 0.85, misdreavus: 0.85, galarian_corsola: 0.85, sableye: 0.85, dusknoir: 1.15, drifblim: 1.0, froslass: 1.0,
    jellicent: 1.05, chandelure: 0.9, aegislash: 0.95, trevenant: 1.1, dhelmise: 1.0, decidueye: 1.0, dragapult: 1.1, basculegion: 1.1, ceruledge: 1.0, gholdengo: 1.05,
  };
  /** size factor applied to the artwork / 3D model of this partner */
  readonly sizeK: number;
  /** how far behind the player (in the placement frame) the companion floats; eased so it moves ahead when the lens is close */
  private backNow = -0.35;

  constructor(readonly pokemonId: PokemonId) {
    this.sizeK = Companion.SIZE_K[pokemonId] ?? 1;
    const idx = Math.max(0, POKEMON.findIndex((p) => p.id === pokemonId));
    const def = POKEMON[idx] ?? POKEMON[0];
    const kind = KINDS[idx % KINDS.length];
    const bc = liftColor(def.palette[0], 0.32);
    const ac = liftColor(def.palette[1], 0.5);
    this.glowColor = '#' + ac.getHexString();
    this.mat = lambertVC({ emissive: new THREE.Color(this.glowColor).multiplyScalar(0.22), emissiveIntensity: 1 });
    const rand = mulberry32(idx + 3);
    const m = new MeshBuilder(rand);
    const u = 0.34; // overall size
    m.add(ICO1, bc, [0, 0, 0], [0, 0, 0], kind === 'twin' ? 0.26 * u * 2 : 0.32 * u * 2, { gradient: 0.15, jitter: 0.04 });
    m.add(ICO0, '#f6f2ff', [-0.12 * u * 2, 0.05 * u * 2, -0.27 * u * 2], [0, 0, 0], 0.06 * u * 2, { gradient: 0, jitter: 0 });
    m.add(ICO0, '#f6f2ff', [0.12 * u * 2, 0.05 * u * 2, -0.27 * u * 2], [0, 0, 0], 0.06 * u * 2, { gradient: 0, jitter: 0 });
    const k = u * 2;
    let second: MeshBuilder | null = null;
    switch (kind) {
      case 'wisp':
        for (let i = 0; i < 3; i++) m.add(CONE5, i === 1 ? ac : bc, [(i - 1) * 0.16 * k, -0.05 * k, 0.38 * k], [Math.PI / 2 + 0.2, 0, (i - 1) * 0.25], [0.1 * k, 0.55 * k, 0.1 * k], { gradient: 0 });
        break;
      case 'spiked':
        for (let i = 0; i < 7; i++) {
          const a = (i / 7) * Math.PI * 2;
          m.add(CONE4, ac, [Math.cos(a) * 0.3 * k, 0.28 * k, Math.sin(a) * 0.3 * k + 0.1 * k], [Math.sin(a) * 0.9, 0, -Math.cos(a) * 0.9], [0.06 * k, 0.28 * k, 0.06 * k], { gradient: 0 });
        }
        break;
      case 'halo':
        m.add(TORUS, ac, [0, 0.45 * k, 0.05 * k], [Math.PI / 2.4, 0, 0], 0.4 * k, { gradient: 0 });
        break;
      case 'twin':
        second = new MeshBuilder(mulberry32(idx + 9));
        second.add(ICO1, ac, [0, 0, 0], [0, 0, 0], 0.2 * k, { gradient: 0.1 });
        second.add(ICO0, '#f6f2ff', [-0.07 * k, 0.03 * k, -0.17 * k], [0, 0, 0], 0.04 * k, { gradient: 0, jitter: 0 });
        second.add(ICO0, '#f6f2ff', [0.07 * k, 0.03 * k, -0.17 * k], [0, 0, 0], 0.04 * k, { gradient: 0, jitter: 0 });
        break;
      case 'flame':
        m.add(CONE5, ac, [0, 0.52 * k, 0.02 * k], [0, 0, 0], [0.22 * k, 0.6 * k, 0.22 * k], { gradient: 0 });
        m.add(CONE5, bc, [0.14 * k, 0.4 * k, 0.04 * k], [0, 0, -0.5], [0.12 * k, 0.38 * k, 0.12 * k], { gradient: 0 });
        break;
      case 'jelly':
        for (let i = 0; i < 5; i++) {
          const a = (i / 5) * Math.PI * 2;
          m.add(CONE4, ac, [Math.cos(a) * 0.2 * k, -0.45 * k, Math.sin(a) * 0.2 * k], [Math.PI, 0, 0], [0.05 * k, 0.5 * k, 0.05 * k], { gradient: 0 });
        }
        break;
    }
    const g = m.build();
    this.geos.push(g);
    this.main = new THREE.Mesh(g, this.mat);
    this.root.add(this.main);
    if (second) {
      const sg = second.build();
      this.geos.push(sg);
      const sm = new THREE.Mesh(sg, this.mat);
      sm.position.set(0.28 * k, 0.12 * k, 0.08 * k);
      this.root.add(sm);
      this.second = sm;
    }
    void CONE6; void CONE8; void PAL;
    this.loadArt();
    this.loadModel();
  }

  private loadModel(): void {
    if (typeof document === 'undefined') return;
    const ref = POKEMON_MODEL_REFS[this.pokemonId];
    if (!ref) return;
    loadPokemonModel(ref, { height: Companion.MODEL_HEIGHT * this.sizeK, maxWidth: 1.1 * this.sizeK, anchor: 'center', faceNegZ: true, selfLit: Companion.MODEL_SELF_LIT }).then(
      (m) => {
        if (this.disposedFlag) { m.dispose(); return; }
        this.model = m;
        this.modelSource = m.source.provider;
        this.root.add(m.root);
        this.main.visible = false;
        if (this.second) this.second.visible = false;
        if (this.art) this.art.visible = false;
        this.visual = 'model';
      },
      (e: unknown) => {
        this.modelError = e instanceof Error ? e.message : String(e);
        const disabled = e instanceof ModelUnavailableError && e.attempts.length === 0; // ?pokemon3d=off
        if (!this.disposedFlag && !disabled) console.warn(`[pokemon3d] ${this.pokemonId}: using artwork — ${this.modelError}`);
      },
    );
  }

  private loadArt(): void {
    if (typeof document === 'undefined') return;
    const base = (import.meta as unknown as { env?: { BASE_URL?: string } }).env?.BASE_URL ?? '/';
    new THREE.TextureLoader().load(
      `${base}art/pokemon/${this.pokemonId}.webp`,
      (tex) => {
        if (this.disposedFlag) { tex.dispose(); return; }
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.anisotropy = 2;
        this.artTex = tex;
        // alphaTest instead of blending: no sorting, no transparent-pass overdraw
        this.artMat = new THREE.SpriteMaterial({ map: tex, alphaTest: 0.5, transparent: false, depthWrite: true, color: 0xe4e8ff, fog: true });
        const sp = new THREE.Sprite(this.artMat);
        sp.scale.set(Companion.ART_HEIGHT * this.sizeK, Companion.ART_HEIGHT * this.sizeK, 1);
        sp.renderOrder = 6;
        sp.visible = !this.model;
        this.art = sp;
        this.root.add(sp);
        this.main.visible = false;
        if (this.second) this.second.visible = false;
        this.artLoaded = true;
        if (!this.model) this.visual = 'art';
      },
      undefined,
      () => { /* keep the procedural companion */ },
    );
  }

  /** Brief brightening / pop (catch, chase start). */
  flash(strength = 1): void { this.flashT = Math.max(this.flashT, strength); }

  /** 0..1: how see-through the artwork should be (it sits between the lens and the player). */
  setFade(f: number): void { this.fade = f; }

  /**
   * Floats to the player's LEFT and a little behind, eased; `speed` makes it tilt into the move. `placeYaw` is the CAMERA's yaw (the
   * companion keeps its place on screen however the body turns); `yaw` orients the creature. `lens` is the camera position: the
   * companion is never allowed within MIN_LENS_M of it — with the lens close behind the player (walls at his back) it slides ahead
   * of the player along the view direction instead of toward the lens.
   */
  update(dt: number, clock: number, px: number, pz: number, yaw: number, speed: number, alertness: number, reduced: boolean, placeYaw: number = yaw, lens: { x: number; z: number } | null = null): void {
    const s = Math.sin(placeYaw), c = Math.cos(placeYaw);
    const side = -1.3 - 0.1 * this.sizeK;
    let wantBack = -0.35;
    if (lens) {
      // push forward (along the view direction) until the lens is at least MIN_LENS_M away
      for (let k = 0; k < 24; k++) {
        const bx = px + (side * c + wantBack * s), bz = pz + (-side * s + wantBack * c);
        if (Math.hypot(bx - lens.x, bz - lens.z) >= Companion.MIN_LENS_M) break;
        wantBack += 0.25;
      }
    }
    this.backNow += (wantBack - this.backNow) * (1 - Math.exp(-(wantBack > this.backNow ? 6 : 3) * dt));
    const back = this.backNow;
    // yaw-local (right, back) -> world
    const tx = px + (side * c + back * s);
    const tz = pz + (-side * s + back * c);
    const fast = 1 + alertness * 1.6;
    const bob = reduced ? 0 : Math.sin(clock * 2.3 * fast) * (0.12 + 0.05 * alertness);
    const ty = 1.3 + bob * 0.8 + Math.sin(clock * 0.9) * 0.05 * (reduced ? 0 : 1);
    if (!this.seeded) { this.x.set(tx, ty, tz); this.seeded = true; }
    const k = 1 - Math.exp(-5 * dt);
    this.x.x += (tx - this.x.x) * k;
    this.x.y += (ty - this.x.y) * Math.min(1, k * 1.5);
    this.x.z += (tz - this.x.z) * k;
    this.root.position.copy(this.x);
    this.root.rotation.y = yaw + Math.sin(clock * 0.5) * 0.4 + alertness * 0.4;
    this.root.rotation.x = clamp(speed * 0.04, 0, 0.2);
    if (this.second) this.second.position.y = 0.05 + Math.sin(clock * 3.1) * 0.05;
    this.flashT = Math.max(0, this.flashT - dt * 2.2);
    if (this.art && this.artMat) {
      const base = Companion.ART_HEIGHT * this.sizeK;
      const pop = reduced ? 1 : 1 + this.flashT * 0.12;
      this.art.scale.set(base * pop, base * pop, 1);
      this.art.position.y = 0.0;
      const f = this.flashT;
      this.artMat.color.setRGB(0.89 + f * 0.11, 0.91 + f * 0.09, 1.0);
      const want = this.fade > 0.02;
      if (this.artMat.transparent !== want) { this.artMat.transparent = want; this.artMat.depthWrite = !want; this.artMat.needsUpdate = true; }
      this.artMat.opacity = 1 - 0.78 * this.fade;
    }
    if (this.model) this.updateModel(dt, speed, reduced);
  }

  private updateModel(dt: number, speed: number, reduced: boolean): void {
    const m = this.model!;
    m.update(reduced ? dt * 0.5 : dt);
    const pop = reduced ? 1 : 1 + this.flashT * 0.12;
    m.root.scale.setScalar(pop);
    // three-quarter view: turned toward the trailing camera when idle, mostly along the walk when moving
    this.modelTurn = damp(this.modelTurn, speed > 0.6 ? 0.55 : 2.2, 3, dt);
    m.root.rotation.y = this.modelTurn;
    const want = this.fade > 0.02;
    for (const mat of m.materials) {
      if (want !== this.faded) { mat.transparent = want; mat.depthWrite = !want; mat.needsUpdate = true; }
      mat.opacity = 1 - 0.78 * this.fade;
      const std = mat as THREE.MeshStandardMaterial;
      if (std.isMeshStandardMaterial) std.emissiveIntensity = Companion.MODEL_SELF_LIT + this.flashT * 0.5;
    }
    this.faded = want;
  }

  /** Raw world position (for the glow ring and the fade test). */
  get position(): THREE.Vector3 { return this.root.position; }

  dispose(): void {
    this.disposedFlag = true;
    for (const g of this.geos) g.dispose();
    this.mat.dispose();
    this.artTex?.dispose();
    this.artMat?.dispose();
    this.model?.dispose();
    this.model = null;
  }
}
