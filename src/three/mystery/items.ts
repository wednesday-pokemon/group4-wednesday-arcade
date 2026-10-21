// Small world objects: the three clue props (transfer note, key pouch, latch + residue) and the Pokemon egg with tier styling.
import * as THREE from 'three';
import type { ClueId } from '../../mystery/types.ts';
import { basicVC, lambertVC } from '../actors.ts';
import { MeshBuilder, mulberry32 } from '../util.ts';
import { BOX, CONE4, CYL6, CYL8, ICO0, ICO1, TORUS, eggHex } from './common.ts';

export class ClueProp {
  readonly root = new THREE.Group();
  readonly inner = new THREE.Group();
  private readonly geos: THREE.BufferGeometry[] = [];
  private readonly mats: THREE.Material[] = [];

  constructor(readonly clueId: ClueId) {
    const rand = mulberry32(clueId.length * 977 + 5);
    const lit = new MeshBuilder(rand);
    const em = new MeshBuilder(rand);
    switch (clueId) {
      case 'transfer_note':
        lit.add(BOX, '#e9dfc4', [0, 0.02, 0], [0, 0.35, 0], [0.34, 0.025, 0.24], { gradient: 0.1, jitter: 0.04 });
        lit.add(BOX, '#d8cba8', [0.03, 0.04, 0.01], [0, 0.2, 0], [0.3, 0.02, 0.2], { gradient: 0.1, jitter: 0.04 });
        lit.add(BOX, '#2a2630', [0.0, 0.056, 0.0], [0, 0.35, 0], [0.22, 0.004, 0.02], { gradient: 0, jitter: 0 });
        lit.add(BOX, '#2a2630', [0.0, 0.056, 0.05], [0, 0.35, 0], [0.18, 0.004, 0.015], { gradient: 0, jitter: 0 });
        lit.add(BOX, '#6a4a9a', [-0.04, 0.062, -0.07], [0, 0.35, 0], [0.04, 0.008, 0.04], { gradient: 0, jitter: 0 });
        em.add(ICO0, '#ffd86a', [0.05, 0.075, -0.02], [0, 0, 0], 0.012, { jitter: 0, gradient: 0 });
        break;
      case 'master_key':
        lit.add(ICO1, '#5a3a24', [0, 0.1, 0], [0, 0, 0], [0.13, 0.12, 0.11], { gradient: 0.3, jitter: 0.06 });
        lit.add(CONE4, '#3a2416', [0, 0.23, 0], [0, 0.8, 0], [0.07, 0.1, 0.07], { gradient: 0 });
        lit.add(TORUS, '#3a2416', [0, 0.2, 0], [Math.PI / 2, 0, 0], [0.07, 0.07, 0.07], { gradient: 0, jitter: 0 });
        em.add(CYL6, '#ffd24a', [0.1, 0.19, 0.0], [0, 0, 1.15], [0.012, 0.22, 0.012], { jitter: 0, gradient: 0 });
        em.add(TORUS, '#ffd24a', [0.19, 0.27, 0.0], [0, 0, 0], [0.04, 0.04, 0.1], { jitter: 0, gradient: 0 });
        em.add(BOX, '#ffd24a', [0.03, 0.11, 0.0], [0, 0, 0.5], [0.03, 0.04, 0.012], { jitter: 0, gradient: 0 });
        break;
      case 'greenhouse_trace':
        lit.add(BOX, '#2a2d44', [0, 0.04, 0], [0, 0.4, 0], [0.34, 0.06, 0.07], { gradient: 0.1 });
        lit.add(BOX, '#2a2d44', [0.14, 0.1, 0], [0, 0.4, 0.6], [0.14, 0.05, 0.05], { gradient: 0 });
        lit.add(ICO0, '#1a1c2e', [-0.1, 0.06, 0], [0, 0, 0], [0.04, 0.04, 0.04], { gradient: 0 });
        lit.add(BOX, '#d8d0b0', [-0.08, 0.02, 0.12], [0, 0.9, 0], [0.12, 0.012, 0.09], { gradient: 0, jitter: 0.06 });
        em.add(ICO1, '#7bffb0', [0.0, 0.015, -0.1], [0, 0.3, 0], [0.12, 0.012, 0.09], { jitter: 0, gradient: 0 });
        em.add(ICO0, '#9affd0', [0.09, 0.02, -0.14], [0, 0.3, 0], [0.04, 0.012, 0.03], { jitter: 0, gradient: 0 });
        em.add(CONE4, '#7bffb0', [-0.07, 0.07, -0.08], [0, 0, 0], [0.025, 0.1, 0.025], { jitter: 0, gradient: 0 });
        break;
    }
    const lg = lit.build();
    const eg = em.build();
    this.geos.push(lg, eg);
    const lm = lambertVC({ emissive: new THREE.Color('#2a2440'), emissiveIntensity: 0.8 });
    const em2 = basicVC();
    this.mats.push(lm, em2);
    this.inner.add(new THREE.Mesh(lg, lm), new THREE.Mesh(eg, em2));
    this.root.add(this.inner);
  }

  dispose(): void {
    for (const g of this.geos) g.dispose();
    for (const m of this.mats) m.dispose();
  }
}

export type EggTierName = 'common' | 'rare' | 'legendary';

export class EggRig {
  readonly root = new THREE.Group();
  readonly body: THREE.Mesh;
  readonly cracks: THREE.Mesh;
  readonly light: THREE.PointLight;
  readonly mat: THREE.MeshLambertMaterial;
  private readonly geos: Record<EggTierName, THREE.BufferGeometry>;
  private tier: EggTierName = 'common';
  private crackGeo: THREE.BufferGeometry;
  private crackMat: THREE.MeshBasicMaterial;

  constructor() {
    const mk = (tier: EggTierName): THREE.BufferGeometry => {
      const rand = mulberry32(tier.length * 31 + 7);
      const b = new MeshBuilder(rand);
      const base = tier === 'legendary' ? '#f6d46a' : tier === 'rare' ? '#7ee6f2' : '#f3ead2';
      const spot = tier === 'legendary' ? '#8a5ad8' : tier === 'rare' ? '#f2fbff' : '#a5c0d8';
      b.add(ICO1, base, [0, 0, 0], [0, 0, 0], [0.19, 0.26, 0.19], { gradient: 0.2, jitter: 0.04 });
      const n = tier === 'common' ? 7 : tier === 'rare' ? 9 : 10;
      for (let i = 0; i < n; i++) {
        const a = rand() * Math.PI * 2;
        const h = (rand() - 0.5) * 1.6;
        const r = Math.sqrt(Math.max(0, 1 - h * h * 0.4));
        b.add(ICO0, spot, [Math.cos(a) * 0.185 * r, h * 0.21, Math.sin(a) * 0.185 * r], [rand(), rand(), rand()], [0.045, 0.04, 0.04], { gradient: 0, jitter: 0.05 });
      }
      if (tier === 'legendary') b.add(CYL8, '#8a5ad8', [0, 0.0, 0], [0, 0, 0], [0.198, 0.02, 0.198], { gradient: 0, jitter: 0 });
      return b.build();
    };
    this.geos = { common: mk('common'), rare: mk('rare'), legendary: mk('legendary') };
    this.mat = lambertVC({ emissive: new THREE.Color(eggHex('common')).multiplyScalar(0.35), emissiveIntensity: 1 });
    this.body = new THREE.Mesh(this.geos.common, this.mat);
    this.body.position.y = 0.27;
    this.root.add(this.body);
    // crack lines: thin dark zig-zags on the surface, shown when security is low
    const cb = new MeshBuilder(mulberry32(9));
    for (let i = 0; i < 5; i++) {
      const y = 0.06 + i * 0.07;
      cb.add(BOX, '#1a1424', [0.08 + (i % 2) * 0.03, 0.03 + i * 0.07, -0.16 + i * 0.006], [0, 0.4, (i % 2 ? 0.7 : -0.7)], [0.075, 0.012, 0.012], { gradient: 0, jitter: 0 });
      void y;
    }
    this.crackGeo = cb.build();
    this.crackMat = basicVC();
    this.cracks = new THREE.Mesh(this.crackGeo, this.crackMat);
    this.cracks.visible = false;
    this.body.add(this.cracks);
    this.cracks.position.set(0, -0.2, 0);
    this.light = new THREE.PointLight(new THREE.Color(eggHex('common')), 0, 9, 1.8);
    this.light.position.set(0, 0.6, 0);
    this.root.add(this.light);
  }

  setTier(t: EggTierName): void {
    if (t === this.tier) return;
    this.tier = t;
    this.body.geometry = this.geos[t];
    this.mat.emissive.set(eggHex(t)).multiplyScalar(t === 'legendary' ? 0.5 : 0.38);
    this.light.color.set(eggHex(t));
  }
  get currentTier(): EggTierName { return this.tier; }

  dispose(): void {
    for (const g of Object.values(this.geos)) g.dispose();
    this.crackGeo.dispose();
    this.crackMat.dispose();
    this.mat.dispose();
    this.light.dispose();
  }
}

void CONE4;
