// Animated actors: rowing boat, crew avatar, original companion proxy, the Hyde, egg, crash rock, shield.
// All procedural low-poly geometry with vertex colours; static pieces are merged per actor.
import * as THREE from 'three';
import type { CharacterId, PokemonId } from './types.ts';
import { CHARACTERS, POKEMON } from '../game/constants.ts';
import { COL } from './palette.ts';
import { MeshBuilder, clamp, hashString, mulberry32 } from './util.ts';

const BOX = new THREE.BoxGeometry(1, 1, 1);
const CYL6 = new THREE.CylinderGeometry(1, 1, 1, 6, 1);
const CYL7 = new THREE.CylinderGeometry(1, 1, 1, 7, 1);
const CONE4 = new THREE.ConeGeometry(1, 1, 4, 1);
const CONE5 = new THREE.ConeGeometry(1, 1, 5, 1);
const CONE8 = new THREE.ConeGeometry(1, 1, 8, 1);
const ICO0 = new THREE.IcosahedronGeometry(1, 0);
const ICO1 = new THREE.IcosahedronGeometry(1, 1);
const TORUS = new THREE.TorusGeometry(1, 0.22, 5, 10);

export function lambertVC(opts: THREE.MeshLambertMaterialParameters = {}): THREE.MeshLambertMaterial {
  return new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, ...opts });
}
export function basicVC(opts: THREE.MeshBasicMaterialParameters = {}): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({ vertexColors: true, ...opts });
}

export function makeGlowSprite(tex: THREE.Texture | null, hex: string, size: number, opacity = 1): THREE.Sprite {
  const mat = new THREE.SpriteMaterial({
    map: tex ?? undefined,
    color: new THREE.Color(hex),
    transparent: true,
    opacity,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    fog: false,
  });
  const s = new THREE.Sprite(mat);
  s.scale.setScalar(size);
  return s;
}

// ---------------------------------------------------------------- boat
function hullGeometry(): THREE.BufferGeometry {
  const zs = [-1.95, -1.3, -0.5, 0.4, 1.25, 1.85];
  const hw = [0.03, 0.52, 0.75, 0.76, 0.64, 0.42];
  const gy = [0.72, 0.5, 0.4, 0.38, 0.4, 0.48];
  const ky = [0.1, -0.2, -0.3, -0.3, -0.24, -0.1];
  const top = new THREE.Color('#9a6a44');
  const mid = new THREE.Color('#60402c');
  const keel = new THREE.Color('#33200f');
  const rows: THREE.Vector3[][] = [];
  const cols: THREE.Color[][] = [];
  for (let i = 0; i < zs.length; i++) {
    rows.push([
      new THREE.Vector3(-hw[i], gy[i], zs[i]),
      new THREE.Vector3(-hw[i] * 0.82, (gy[i] + ky[i]) * 0.4, zs[i]),
      new THREE.Vector3(0, ky[i], zs[i]),
      new THREE.Vector3(hw[i] * 0.82, (gy[i] + ky[i]) * 0.4, zs[i]),
      new THREE.Vector3(hw[i], gy[i], zs[i]),
    ]);
    cols.push([top, mid, keel, mid, top]);
  }
  const pos: number[] = [];
  const col: number[] = [];
  const push = (v: THREE.Vector3, c: THREE.Color) => {
    pos.push(v.x, v.y, v.z);
    col.push(c.r, c.g, c.b);
  };
  for (let i = 0; i < zs.length - 1; i++) {
    for (let j = 0; j < 4; j++) {
      const a = rows[i][j], b = rows[i][j + 1], c = rows[i + 1][j + 1], d = rows[i + 1][j];
      const ca = cols[i][j], cb = cols[i][j + 1], cc = cols[i + 1][j + 1], cd = cols[i + 1][j];
      push(a, ca); push(b, cb); push(c, cc);
      push(a, ca); push(c, cc); push(d, cd);
    }
  }
  // stern transom
  const last = rows[rows.length - 1];
  for (let j = 1; j < 4; j++) {
    push(last[0], top); push(last[j], mid); push(last[j + 1], j + 1 === 4 ? top : mid);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.computeVertexNormals();
  return g;
}

export interface BoatRig {
  root: THREE.Group; // world position / heading
  tilt: THREE.Group; // bob/roll/pitch
  oarL: THREE.Group;
  oarR: THREE.Group;
  crewPivot: THREE.Group;
  crewMesh: THREE.Mesh;
  companion: THREE.Group;
  companionMain: THREE.Mesh;
  companionSecond: THREE.Mesh | null;
  companionGlow: THREE.Sprite;
  lanternGlow: THREE.Sprite;
  lanternLight: THREE.PointLight;
  eggSlot: THREE.Object3D;
  setCrew(characterId: CharacterId, pokemonId: PokemonId): void;
  dispose(): void;
}

const HAIR: Record<CharacterId, 'short' | 'long' | 'braids' | 'spiky' | 'slick'> = {
  wednesday: 'braids', enid: 'spiky', bianca: 'long', xavier: 'short', ajax: 'short', yoko: 'long',
  kent: 'spiky', divina: 'long', rowan: 'short', eugene: 'spiky', morticia: 'long', gomez: 'slick',
};

function buildAvatar(characterId: CharacterId): THREE.BufferGeometry {
  const def = CHARACTERS.find((c) => c.id === characterId) ?? CHARACTERS[0];
  const [p0, p1, p2] = def.palette;
  // palettes can be near-black; lift very dark body colours slightly so the silhouette reads on a dark sea
  const lift = (hex: string, min: number): THREE.Color => {
    const c = new THREE.Color(hex);
    const hsl = { h: 0, s: 0, l: 0 };
    c.getHSL(hsl);
    c.setHSL(hsl.h, hsl.s, Math.max(hsl.l, min));
    return c;
  };
  const body = lift(p0, 0.2);
  const hair = lift(p1, 0.22);
  const trim = lift(p2, 0.35);
  const b = new MeshBuilder(mulberry32(hashString(characterId)));
  const style = HAIR[characterId];
  // torso, belt, collar
  b.add(new THREE.CylinderGeometry(0.27, 0.34, 0.66, 7), body, [0, 0.38, 0], [0, 0, 0], 1, { jitter: 0.05, gradient: 0.2 });
  b.add(CYL7, trim, [0, 0.12, 0], [0, 0, 0], [0.35, 0.09, 0.35], { gradient: 0 });
  b.add(TORUS, trim, [0, 0.72, 0], [Math.PI / 2, 0, 0], [0.24, 0.24, 0.5], { gradient: 0 });
  // head + face
  b.add(ICO1, COL.skin, [0, 0.98, 0], [0, 0, 0], [0.22, 0.24, 0.22], { gradient: 0.1 });
  b.add(BOX, '#161a3a', [-0.08, 1.0, -0.2], [0, 0, 0], [0.05, 0.06, 0.03], { jitter: 0, gradient: 0 });
  b.add(BOX, '#161a3a', [0.08, 1.0, -0.2], [0, 0, 0], [0.05, 0.06, 0.03], { jitter: 0, gradient: 0 });
  // hair
  b.add(ICO1, hair, [0, 1.07, 0.03], [0, 0, 0], [0.25, 0.19, 0.26], { gradient: 0.1 });
  if (style === 'long') b.add(BOX, hair, [0, 0.82, 0.17], [0.1, 0, 0], [0.42, 0.62, 0.12]);
  if (style === 'braids') {
    for (const s of [-1, 1]) {
      b.add(CYL6, hair, [s * 0.2, 0.66, -0.12], [0.1, 0, s * 0.1], [0.045, 0.62, 0.045]);
      b.add(CONE4, trim, [s * 0.21, 0.32, -0.12], [Math.PI, 0, 0], [0.07, 0.1, 0.07]);
    }
  }
  if (style === 'spiky') {
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      b.add(CONE4, hair, [Math.cos(a) * 0.14, 1.27, Math.sin(a) * 0.14], [Math.sin(a) * 0.5, 0, -Math.cos(a) * 0.5], [0.07, 0.2, 0.07], { gradient: 0 });
    }
  }
  if (style === 'slick') b.add(BOX, hair, [0, 0.99, 0.05], [0, 0, 0], [0.3, 0.07, 0.34]);
  // arms (reaching forward to the oars) + hands
  for (const s of [-1, 1]) {
    b.add(BOX, body, [s * 0.36, 0.45, -0.22], [-0.5, s * 0.15, 0], [0.13, 0.13, 0.55], { gradient: 0.1 });
    b.add(ICO0, COL.skin, [s * 0.4, 0.3, -0.5], [0, 0, 0], 0.08, { gradient: 0 });
  }
  return b.build();
}

type CompanionKind = 'wisp' | 'spiked' | 'halo' | 'twin' | 'flame' | 'jelly';
const KINDS: CompanionKind[] = ['wisp', 'spiked', 'halo', 'twin', 'flame', 'jelly'];

function buildCompanion(pokemonId: PokemonId): { main: THREE.BufferGeometry; second: THREE.BufferGeometry | null; glow: string } {
  const idx = Math.max(0, POKEMON.findIndex((p) => p.id === pokemonId));
  const def = POKEMON[idx] ?? POKEMON[0];
  const kind = KINDS[idx % KINDS.length];
  // keep tints readable on a dark sea (palettes include near-black colours)
  const body = new THREE.Color(def.palette[0]);
  const accent = new THREE.Color(def.palette[1]);
  const lift = (c: THREE.Color, min: number): THREE.Color => {
    const o = c.clone();
    const hsl = { h: 0, s: 0, l: 0 };
    o.getHSL(hsl);
    return o.setHSL(hsl.h, hsl.s, Math.max(hsl.l, min));
  };
  const bc = lift(body, 0.3);
  const ac = lift(accent, 0.5);
  const main = new MeshBuilder(mulberry32(idx + 3));
  let second: MeshBuilder | null = null;
  main.add(ICO1, bc, [0, 0, 0], [0, 0, 0], kind === 'twin' ? 0.26 : 0.32, { gradient: 0.15, jitter: 0.04 });
  // original "eyes"
  main.add(ICO0, '#f6f2ff', [-0.12, 0.05, -0.27], [0, 0, 0], 0.06, { gradient: 0, jitter: 0 });
  main.add(ICO0, '#f6f2ff', [0.12, 0.05, -0.27], [0, 0, 0], 0.06, { gradient: 0, jitter: 0 });
  if (kind === 'wisp') {
    for (let i = 0; i < 3; i++) main.add(CONE5, i === 1 ? ac : bc, [(i - 1) * 0.16, -0.05 - i * 0.02, 0.38], [Math.PI / 2 + 0.2, 0, (i - 1) * 0.25], [0.1, 0.55, 0.1], { gradient: 0 });
  } else if (kind === 'spiked') {
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2;
      main.add(CONE4, ac, [Math.cos(a) * 0.3, 0.28, Math.sin(a) * 0.3 + 0.1], [Math.sin(a) * 0.9, 0, -Math.cos(a) * 0.9], [0.06, 0.28, 0.06], { gradient: 0 });
    }
  } else if (kind === 'halo') {
    main.add(TORUS, ac, [0, 0.45, 0.05], [Math.PI / 2.4, 0, 0], 0.4, { gradient: 0 });
  } else if (kind === 'twin') {
    second = new MeshBuilder(mulberry32(idx + 9));
    second.add(ICO1, ac, [0, 0, 0], [0, 0, 0], 0.2, { gradient: 0.1 });
    second.add(ICO0, '#f6f2ff', [-0.07, 0.03, -0.17], [0, 0, 0], 0.04, { gradient: 0, jitter: 0 });
    second.add(ICO0, '#f6f2ff', [0.07, 0.03, -0.17], [0, 0, 0], 0.04, { gradient: 0, jitter: 0 });
  } else if (kind === 'flame') {
    main.add(CONE5, ac, [0, 0.52, 0.02], [0, 0, 0], [0.22, 0.6, 0.22], { gradient: 0 });
    main.add(CONE5, bc, [0.14, 0.4, 0.04], [0, 0, -0.5], [0.12, 0.38, 0.12], { gradient: 0 });
  } else {
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      main.add(CONE4, ac, [Math.cos(a) * 0.2, -0.45, Math.sin(a) * 0.2], [Math.PI, 0, 0], [0.05, 0.5, 0.05], { gradient: 0 });
    }
  }
  return { main: main.build(), second: second ? second.build() : null, glow: '#' + accent.getHexString() };
}

export function createBoat(glowTex: THREE.Texture | null): BoatRig {
  const root = new THREE.Group();
  const tilt = new THREE.Group();
  root.add(tilt);

  const lit = lambertVC();
  const lit2 = lambertVC({ side: THREE.DoubleSide });
  const emi = basicVC();
  const hullMesh = new THREE.Mesh(hullGeometry(), lit2);
  tilt.add(hullMesh);

  const rand = mulberry32(5);
  const details = new MeshBuilder(rand);
  details.add(BOX, '#7a5233', [0, 0.28, 0.35], [0, 0, 0], [1.3, 0.07, 0.34], { gradient: 0 }); // seat
  details.add(BOX, '#4a2f1e', [0, -0.12, 0], [0, 0, 0], [1.1, 0.05, 3.0], { gradient: 0 }); // floor
  details.add(CYL6, '#43291d', [0, 0.9, -1.55], [0, 0, 0], [0.04, 1.1, 0.04]); // lantern pole
  details.add(BOX, '#43291d', [0, 1.4, -1.35], [0, 0, 0.0], [0.04, 0.04, 0.5]); // hook arm
  details.add(CONE4, '#1d1a30', [0, 1.75, -1.15], [0, Math.PI / 4, 0], [0.26, 0.2, 0.26]);
  details.add(CYL6, '#43291d', [0, 0.45, 1.85], [0, 0, 0], [0.05, 0.7, 0.05]); // stern post
  for (const s of [-1, 1]) details.add(BOX, '#2b1a10', [s * 0.8, 0.46, 0.1], [0, 0, 0], [0.1, 0.12, 0.2], { gradient: 0 }); // oarlocks
  tilt.add(new THREE.Mesh(details.build(), lit));
  const lantEmi = new MeshBuilder(rand);
  lantEmi.add(BOX, COL.lantern, [0, 1.5, -1.15], [0, 0, 0], [0.22, 0.28, 0.22], { jitter: 0, gradient: 0 });
  tilt.add(new THREE.Mesh(lantEmi.build(), emi));
  const lanternGlow = makeGlowSprite(glowTex, COL.lantern, 2.6, 0.9);
  lanternGlow.position.set(0, 1.5, -1.15);
  tilt.add(lanternGlow);
  const lanternLight = new THREE.PointLight(new THREE.Color(COL.lantern), 40, 16, 1.8);
  lanternLight.position.set(0, 1.9, -0.9);
  tilt.add(lanternLight);

  // oars
  const oarGeo = (s: number) => {
    const b = new MeshBuilder(mulberry32(11));
    b.add(BOX, '#b08a5a', [s * 0.95, 0, 0], [0, 0, 0], [1.9, 0.05, 0.05], { gradient: 0 });
    b.add(BOX, '#7a5233', [s * 1.95, -0.01, 0], [0, 0, 0], [0.5, 0.04, 0.2], { gradient: 0 });
    return b.build();
  };
  const oarMat = lambertVC();
  const oarL = new THREE.Group();
  oarL.position.set(-0.8, 0.5, 0.1);
  oarL.add(new THREE.Mesh(oarGeo(-1), oarMat));
  const oarR = new THREE.Group();
  oarR.position.set(0.8, 0.5, 0.1);
  oarR.add(new THREE.Mesh(oarGeo(1), oarMat));
  tilt.add(oarL, oarR);

  // crew avatar
  const crewPivot = new THREE.Group();
  crewPivot.position.set(0, 0.3, 0.35);
  const crewMat = lambertVC();
  const crewMesh = new THREE.Mesh(new THREE.BufferGeometry(), crewMat);
  crewPivot.add(crewMesh);
  tilt.add(crewPivot);

  // companion proxy (floats above the bow, bobbing)
  const companion = new THREE.Group();
  companion.position.set(-0.55, 1.25, -0.9);
  const compMat = lambertVC({ emissive: new THREE.Color('#2a2450'), emissiveIntensity: 0.8 });
  const companionMain = new THREE.Mesh(new THREE.BufferGeometry(), compMat);
  companion.add(companionMain);
  const companionGlow = makeGlowSprite(glowTex, '#b79cff', 1.9, 0.55);
  companion.add(companionGlow);
  tilt.add(companion);

  const eggSlot = new THREE.Object3D();
  eggSlot.position.set(0.5, 0.42, 0.55);
  tilt.add(eggSlot);

  const rig: BoatRig = {
    root,
    tilt,
    oarL,
    oarR,
    crewPivot,
    crewMesh,
    companion,
    companionMain,
    companionSecond: null,
    companionGlow,
    lanternGlow,
    lanternLight,
    eggSlot,
    setCrew(characterId, pokemonId) {
      crewMesh.geometry.dispose();
      crewMesh.geometry = buildAvatar(characterId);
      companionMain.geometry.dispose();
      const comp = buildCompanion(pokemonId);
      companionMain.geometry = comp.main;
      (companionGlow.material as THREE.SpriteMaterial).color.set(comp.glow);
      compMat.emissive.set(comp.glow).multiplyScalar(0.35);
      if (rig.companionSecond) {
        companion.remove(rig.companionSecond);
        rig.companionSecond.geometry.dispose();
        rig.companionSecond = null;
      }
      if (comp.second) {
        const m = new THREE.Mesh(comp.second, compMat);
        companion.add(m);
        rig.companionSecond = m;
      }
    },
    dispose() {
      root.traverse((n) => {
        const mesh = n as THREE.Mesh;
        if (mesh.geometry) mesh.geometry.dispose();
        const mat = (mesh as { material?: THREE.Material }).material;
        if (mat && !Array.isArray(mat)) mat.dispose();
      });
      lanternLight.dispose();
    },
  };
  rig.setCrew('wednesday', 'gengar');
  return rig;
}

// ---------------------------------------------------------------- the Hyde
export interface HydeRig {
  root: THREE.Group;
  upper: THREE.Group;
  armL: THREE.Group;
  armR: THREE.Group;
  head: THREE.Group;
  eyeGlowL: THREE.Sprite;
  eyeGlowR: THREE.Sprite;
  aura: THREE.Sprite;
  foam: THREE.Mesh;
  dispose(): void;
}

export function createHyde(glowTex: THREE.Texture | null): HydeRig {
  const rand = mulberry32(666);
  const skin = ['#0a0c26', '#0e1030', '#080a20'];
  const pk = () => skin[Math.floor(rand() * skin.length)];
  const root = new THREE.Group();
  const lowerB = new MeshBuilder(rand);
  // submerged tattered cloak
  lowerB.add(CONE8, '#070920', [0, 1.6, 0.2], [0, 0, 0], [2.5, 4.0, 2.2], { gradient: 0.1, jitter: 0.05 });
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2;
    lowerB.add(CONE4, '#0c0e28', [Math.cos(a) * 2.2, 0.9, Math.sin(a) * 1.9 + 0.2], [0, a, Math.PI], [0.5, 2.2 + rand() * 1.2, 0.3], { gradient: 0 });
  }
  const lowerMat = lambertVC({ emissive: new THREE.Color('#241a5c'), emissiveIntensity: 0.9 });
  root.add(new THREE.Mesh(lowerB.build(), lowerMat));

  const upper = new THREE.Group();
  upper.position.set(0, 2.4, 0);
  root.add(upper);
  const torsoB = new MeshBuilder(rand);
  torsoB.add(ICO1, pk(), [0, 1.3, 0.1], [0.3, 0, 0], [1.95, 2.3, 1.65], { gradient: 0.15 }); // torso
  torsoB.add(ICO1, '#171a40', [0, 2.2, 0.85], [0.2, 0, 0], [1.5, 1.35, 1.35], { gradient: 0.1 }); // hunched back
  torsoB.add(ICO0, pk(), [-1.65, 2.2, -0.2], [0, 0, 0], [0.95, 0.8, 0.95]); // shoulders
  torsoB.add(ICO0, pk(), [1.65, 2.2, -0.2], [0, 0, 0], [0.95, 0.8, 0.95]);
  for (let i = 0; i < 6; i++) {
    // spine ridge
    torsoB.add(CONE4, '#2a2468', [0, 3.1 - i * 0.28, 1.0 + i * 0.28], [0.9 + i * 0.12, 0, 0], [0.3, 1.0 - i * 0.08, 0.3], { gradient: 0 });
  }
  for (let i = 0; i < 5; i++) {
    // tatters hanging from the shoulders
    const s = i % 2 ? 1 : -1;
    torsoB.add(CONE4, '#0f1130', [s * (0.6 + i * 0.35), 0.3, -0.9 + i * 0.1], [0, 0, Math.PI + s * 0.1], [0.4, 2.2, 0.25], { gradient: 0 });
  }
  upper.add(new THREE.Mesh(torsoB.build(), lowerMat));

  const head = new THREE.Group();
  head.position.set(0, 2.55, -1.15);
  upper.add(head);
  const headB = new MeshBuilder(rand);
  headB.add(ICO1, '#181b46', [0, 0, 0], [0, 0, 0], [0.85, 0.85, 0.95], { gradient: 0.1 });
  headB.add(CONE5, '#2a2468', [-0.55, 0.65, 0.25], [-0.6, 0, 0.5], [0.2, 1.0, 0.2], { gradient: 0 }); // horns
  headB.add(CONE5, '#2a2468', [0.55, 0.65, 0.25], [-0.6, 0, -0.5], [0.2, 1.0, 0.2], { gradient: 0 });
  headB.add(BOX, '#07081a', [0, -0.32, -0.7], [0, 0, 0], [0.9, 0.12, 0.3], { gradient: 0, jitter: 0 }); // brow shadow / jaw line (no mouth detail)
  head.add(new THREE.Mesh(headB.build(), lowerMat));
  const eyeB = new MeshBuilder(rand);
  eyeB.add(ICO0, COL.hydeEye, [-0.33, 0.12, -0.82], [0, 0, 0], [0.2, 0.12, 0.1], { jitter: 0, gradient: 0 });
  eyeB.add(ICO0, COL.hydeEye, [0.33, 0.12, -0.82], [0, 0, 0], [0.2, 0.12, 0.1], { jitter: 0, gradient: 0 });
  head.add(new THREE.Mesh(eyeB.build(), basicVC()));
  const eyeGlowL = makeGlowSprite(glowTex, COL.hydeEyeHalo, 2.0, 0.95);
  const eyeGlowR = makeGlowSprite(glowTex, COL.hydeEyeHalo, 2.0, 0.95);
  eyeGlowL.position.set(-0.33, 0.12, -0.9);
  eyeGlowR.position.set(0.33, 0.12, -0.9);
  head.add(eyeGlowL, eyeGlowR);

  const makeArm = (s: number): THREE.Group => {
    const g = new THREE.Group();
    g.position.set(s * 1.9, 2.1, -0.2);
    const ab = new MeshBuilder(rand);
    ab.add(CYL6, '#151842', [0, -1.2, -0.3], [0.25, 0, 0], [0.5, 2.6, 0.5], { gradient: 0.1 });
    ab.add(ICO0, '#181b46', [0, -2.5, -0.55], [0, 0, 0], [0.62, 0.62, 0.62]);
    ab.add(CYL6, '#151842', [s * 0.1, -3.7, -0.65], [0.1, 0, 0], [0.38, 2.3, 0.38], { gradient: 0.1 });
    ab.add(ICO1, '#1d2050', [s * 0.1, -5.0, -0.7], [0, 0, 0], [0.72, 0.62, 0.8]); // big hand
    for (let i = -1; i <= 1; i++) {
      // pale claws (no gore)
      ab.add(CONE4, '#9a94b8', [s * 0.1 + i * 0.3, -5.6, -0.8 - Math.abs(i) * 0.05], [0, 0, Math.PI + i * 0.2], [0.11, 0.7, 0.11], { gradient: 0, jitter: 0 });
    }
    g.add(new THREE.Mesh(ab.build(), lowerMat));
    return g;
  };
  const armL = makeArm(-1);
  const armR = makeArm(1);
  upper.add(armL, armR);

  const aura = makeGlowSprite(glowTex, '#7a5cf0', 20, 0.6);
  aura.position.set(0, 3.6, 1.6);
  root.add(aura);

  const foam = new THREE.Mesh(
    new THREE.RingGeometry(1.6, 3.4, 18, 1),
    new THREE.MeshBasicMaterial({ color: new THREE.Color('#8fa0ff'), transparent: true, opacity: 0.28, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }),
  );
  foam.rotation.x = -Math.PI / 2;
  foam.position.y = 0.06;
  root.add(foam);

  return {
    root,
    upper,
    armL,
    armR,
    head,
    eyeGlowL,
    eyeGlowR,
    aura,
    foam,
    dispose() {
      root.traverse((n) => {
        const mesh = n as THREE.Mesh;
        if (mesh.geometry) mesh.geometry.dispose();
        const mat = (mesh as { material?: THREE.Material }).material;
        if (mat && !Array.isArray(mat)) mat.dispose();
      });
    },
  };
}

// ---------------------------------------------------------------- egg, crash rock, shield
export interface EggRig {
  root: THREE.Group;
  glow: THREE.Sprite;
  body: THREE.Mesh;
  setTier(tier: 'none' | 'common' | 'rare' | 'legendary'): void;
  dispose(): void;
}

export function eggColor(tier: string): string {
  return tier === 'legendary' ? COL.eggLegendary : tier === 'rare' ? COL.eggRare : COL.eggCommon;
}

export function createEgg(glowTex: THREE.Texture | null): EggRig {
  const root = new THREE.Group();
  const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(COL.eggCommon) });
  const body = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 1), mat);
  body.scale.set(0.3, 0.42, 0.3);
  body.position.y = 0.45;
  root.add(body);
  const speck = new THREE.Mesh(
    new THREE.TorusGeometry(0.31, 0.03, 4, 10),
    new THREE.MeshBasicMaterial({ color: new THREE.Color('#ffffff'), transparent: true, opacity: 0.6 }),
  );
  speck.position.y = 0.45;
  speck.rotation.x = Math.PI / 2;
  root.add(speck);
  const glow = makeGlowSprite(glowTex, COL.eggCommon, 2.4, 0.9);
  glow.position.y = 0.5;
  root.add(glow);
  return {
    root,
    glow,
    body,
    setTier(tier) {
      const hex = eggColor(tier);
      mat.color.set(hex);
      (glow.material as THREE.SpriteMaterial).color.set(hex);
      const sz = tier === 'legendary' ? 3.4 : tier === 'rare' ? 2.9 : 2.3;
      glow.scale.setScalar(sz);
    },
    dispose() {
      body.geometry.dispose();
      mat.dispose();
      speck.geometry.dispose();
      (speck.material as THREE.Material).dispose();
      (glow.material as THREE.Material).dispose();
    },
  };
}

export function createCrashRock(): THREE.Mesh {
  const b = new MeshBuilder(mulberry32(404));
  b.add(ICO0, '#2d3260', [0, 0.8, 0], [0.3, 0.4, 0.2], [1.5, 1.6, 1.4], { gradient: 0.45, jitter: 0.14 });
  b.add(ICO0, '#363c70', [1.3, 0.35, 0.4], [0.2, 0.9, 0.1], [0.8, 0.7, 0.8], { gradient: 0.45, jitter: 0.14 });
  b.add(ICO0, '#262b55', [-1.2, 0.4, -0.3], [0.5, 0.2, 0.1], [0.9, 0.8, 0.9], { gradient: 0.45, jitter: 0.14 });
  b.add(CYL6, COL.woodDark, [0.4, 1.1, 1.1], [0.1, 0, 0.35], [0.1, 2.3, 0.1]); // snag
  return new THREE.Mesh(b.build(), lambertVC());
}

export function createShield(): THREE.Mesh {
  const m = new THREE.Mesh(
    new THREE.IcosahedronGeometry(2.0, 1),
    new THREE.MeshBasicMaterial({
      color: new THREE.Color('#6fe8ff'),
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      wireframe: false,
      side: THREE.DoubleSide,
    }),
  );
  m.scale.set(0.9, 0.7, 1.4);
  m.position.y = 0.5;
  m.visible = false;
  return m;
}

export function clamp01(v: number): number {
  return clamp(v, 0, 1);
}
