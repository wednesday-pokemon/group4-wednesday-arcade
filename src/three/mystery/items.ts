// Small world objects: the clue props (see clueModels.ts) and the Pokemon egg with tier styling.
import * as THREE from 'three';
import type { ClueId } from '../../mystery/types.ts';
import { basicVC, lambertVC } from '../actors.ts';
import { MeshBuilder, mulberry32 } from '../util.ts';
import { BOX, CONE4, CYL8, ICO0, ICO1, eggHex } from './common.ts';
import { buildClueModel } from './clueModels.ts';

const MARKER_GEO = new THREE.OctahedronGeometry(0.07, 0);
const MARKER_MAT = new THREE.MeshBasicMaterial({ color: '#ffe08a' });

export class ClueProp {
  readonly root = new THREE.Group();
  readonly inner = new THREE.Group();
  /** small gold diamond that hovers above the item (shared geometry / material, never disposed per prop) */
  readonly marker: THREE.Mesh;
  private readonly geos: THREE.BufferGeometry[] = [];
  private readonly mats: THREE.Material[] = [];

  constructor(readonly clueId: ClueId) {
    const rand = mulberry32(clueId.length * 977 + 5);
    const lit = new MeshBuilder(rand);
    const em = new MeshBuilder(rand);
    buildClueModel(clueId, lit, em);
    const lg = lit.build();
    const eg = em.build();
    this.geos.push(lg, eg);
    const lm = lambertVC({ emissive: new THREE.Color('#3c3560'), emissiveIntensity: 0.9 });
    const em2 = basicVC();
    this.mats.push(lm, em2);
    this.inner.add(new THREE.Mesh(lg, lm), new THREE.Mesh(eg, em2));
    this.inner.scale.setScalar(1.3);
    this.marker = new THREE.Mesh(MARKER_GEO, MARKER_MAT);
    this.marker.position.y = 0.55;
    this.root.add(this.inner, this.marker);
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
