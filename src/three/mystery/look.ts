// Per-case visual identity. One CaseLook per CaseTheme drives the fog / sky / light colours, the weather, the lantern and how the
// shared island's vertex colours are graded (so the same meshes read as an archive, a crypt or a storm-lashed security station).
// Everything here is plain data + one colour-grading helper; nothing allocates per frame.
import * as THREE from 'three';
import type { CaseTheme, ClueId, MapDef } from '../../mystery/types.ts';

export type Theme = CaseTheme;

/** Colour grade applied to vertex colours at build time: out = mix(c, luminance(c) * tint * gain, amount). */
export interface Grade { tint: [number, number, number]; amount: number; gain: number }

export interface CaseLook {
  theme: Theme;
  fogColor: number;
  fogDensity: number;
  /** extra-thick fog inside rooms flagged `fog` (the crypt) */
  roomFogDensity: number;
  hemiSky: number;
  hemiGround: number;
  hemiIntensity: number;
  moonColor: number;
  moonIntensity: number;
  skyZenith: string;
  skyHorizon: string;
  moonVis: number;
  stars: number;
  /** 0..1 heavy cloud cover (the sky shader patch); only the storm sets it high */
  storm: number;
  waterDeep: string;
  waterShallow: string;
  waterBasic: number;
  /** the lantern the player carries: colour, intensity, reach and flicker depth (0 steady .. 1 candle) */
  lantern: { color: number; intensity: number; distance: number; flicker: number };
  /** multiplier on the per-glow flicker of the static lamps */
  glowFlicker: number;
  grade: { ground: Grade; walls: Grade; dress: Grade; glow: Grade };
  rain: boolean;
  lightning: boolean;
  /** ambient floating particles near the player */
  motes: { color: string; rate: number; rise: number } | null;
}

const norm = (t: [number, number, number]): [number, number, number] => {
  const l = 0.2126 * t[0] + 0.7152 * t[1] + 0.0722 * t[2];
  return [t[0] / l, t[1] / l, t[2] / l];
};

export const LOOKS: Record<Theme, CaseLook> = {
  // 01 The Poisoned Archive: damp old library + abandoned greenhouse. Dim sickly green, soft and still.
  archive: {
    theme: 'archive',
    fogColor: 0x0a1c1a, fogDensity: 0.0185, roomFogDensity: 0.029,
    hemiSky: 0x86d8b4, hemiGround: 0x1f4a3a, hemiIntensity: 1.7,
    moonColor: 0x9fe0c0, moonIntensity: 2.15,
    skyZenith: '#051a15', skyHorizon: '#174536', moonVis: 0.5, stars: 0.55, storm: 0.25,
    waterDeep: '#05211a', waterShallow: '#17503f', waterBasic: 0x07241c,
    lantern: { color: 0xd8ffb8, intensity: 8.5, distance: 14, flicker: 0.1 },
    glowFlicker: 0.55,
    grade: {
      ground: { tint: norm([0.6, 1.25, 0.85]), amount: 0.62, gain: 1.0 },
      walls: { tint: norm([0.85, 1.1, 0.8]), amount: 0.42, gain: 1.0 },
      dress: { tint: norm([0.8, 1.15, 0.85]), amount: 0.3, gain: 1.0 },
      glow: { tint: norm([0.8, 1.25, 0.8]), amount: 0.5, gain: 1.0 },
    },
    rain: false, lightning: false,
    motes: { color: '#b8ffd0', rate: 3, rise: 0.25 },
  },
  // 02 The Crypt's Last Witness: ancient stone, warm low lantern light, dust. The darkest of the three but still readable.
  crypt: {
    theme: 'crypt',
    fogColor: 0x1a1220, fogDensity: 0.02, roomFogDensity: 0.04,
    hemiSky: 0xa892c4, hemiGround: 0x4e3640, hemiIntensity: 2.15,
    moonColor: 0xb4a0dc, moonIntensity: 2.5,
    skyZenith: '#050310', skyHorizon: '#2c1a30', moonVis: 0.6, stars: 0.7, storm: 0.0,
    waterDeep: '#0a0810', waterShallow: '#2a1c34', waterBasic: 0x0c0a14,
    lantern: { color: 0xffa04a, intensity: 16, distance: 16, flicker: 0.45 },
    glowFlicker: 1.35,
    grade: {
      ground: { tint: norm([1.3, 1.0, 0.78]), amount: 0.7, gain: 1.2 },
      walls: { tint: norm([1.28, 1.02, 0.8]), amount: 0.66, gain: 1.3 },
      dress: { tint: norm([1.2, 1.0, 0.85]), amount: 0.5, gain: 1.0 },
      glow: { tint: norm([1.35, 1.0, 0.7]), amount: 0.6, gain: 1.0 },
    },
    rain: false, lightning: false,
    motes: { color: '#ffd9a0', rate: 5, rise: 0.12 },
  },
  // 03 The Midnight Signal: watchtower + security station under a storm. Cold light, rain, lightning, buzzing flicker.
  signal: {
    theme: 'signal',
    fogColor: 0x0b1420, fogDensity: 0.0205, roomFogDensity: 0.036,
    hemiSky: 0x7ea4dc, hemiGround: 0x1a2a46, hemiIntensity: 1.7,
    moonColor: 0x86a8e6, moonIntensity: 1.55,
    skyZenith: '#04070e', skyHorizon: '#1f2d42', moonVis: 0.18, stars: 0.12, storm: 1.0,
    waterDeep: '#060b16', waterShallow: '#15243e', waterBasic: 0x070d18,
    lantern: { color: 0xc4e0ff, intensity: 8, distance: 14, flicker: 0.3 },
    glowFlicker: 1.7,
    grade: {
      ground: { tint: norm([0.82, 1.0, 1.22]), amount: 0.42, gain: 0.96 },
      walls: { tint: norm([0.85, 1.0, 1.15]), amount: 0.4, gain: 0.98 },
      dress: { tint: norm([0.9, 1.0, 1.12]), amount: 0.25, gain: 1.0 },
      glow: { tint: norm([0.85, 1.05, 1.25]), amount: 0.3, gain: 1.0 },
    },
    rain: true, lightning: true,
    motes: null,
  },
};

const NO_GRADE: Grade = { tint: [1, 1, 1], amount: 0, gain: 1 };

/** The original single blue night: used by the home-screen showcase so the landing page looks exactly as before. */
export const BASE_LOOK: CaseLook = {
  theme: 'archive',
  fogColor: 0x10152e, fogDensity: 0.0165, roomFogDensity: 0.036,
  hemiSky: 0x8e9cf0, hemiGround: 0x2a3070, hemiIntensity: 2.1,
  moonColor: 0xb8c4ff, moonIntensity: 2.9,
  skyZenith: '#0a1030', skyHorizon: '#2d3a7a', moonVis: 1, stars: 1, storm: 0,
  waterDeep: '#070c28', waterShallow: '#1b2a66', waterBasic: 0x0b1235,
  lantern: { color: 0xffc880, intensity: 8, distance: 14, flicker: 0 },
  glowFlicker: 1,
  grade: { ground: NO_GRADE, walls: NO_GRADE, dress: NO_GRADE, glow: NO_GRADE },
  rain: false, lightning: false, motes: null,
};

/** The case's theme: the world's own `theme`, else guessed from the clue ids the map carries, else the archive look. */
export function themeOf(map: MapDef): Theme {
  if (map.world?.theme) return map.world.theme;
  const has = (id: ClueId): boolean => map.clues.some((c) => c.clueId === id);
  if (has('sabotaged_gate') || has('tunnel_access_record') || has('equipment_match')) return 'crypt';
  if (has('falsified_patrol_log') || has('alarm_override') || has('watchtower_signal')) return 'signal';
  return 'archive';
}

export function lookOf(map: MapDef): CaseLook { return LOOKS[themeOf(map)]; }

// ---------------------------------------------------------------------------------------------------- grading
const _c = new THREE.Color();

/** Grades one colour (linear working space, as stored in vertex colours). */
export function gradeRGB(r: number, g: number, b: number, k: Grade, out: [number, number, number]): [number, number, number] {
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const a = k.amount;
  out[0] = (r + (lum * k.tint[0] * k.gain - r) * a);
  out[1] = (g + (lum * k.tint[1] * k.gain - g) * a);
  out[2] = (b + (lum * k.tint[2] * k.gain - b) * a);
  return out;
}

/** In-place vertex-colour grade of a (non-shared) geometry. */
export function gradeGeometry<T extends THREE.BufferGeometry | null>(geo: T, k: Grade): T {
  if (!geo) return geo;
  const col = geo.getAttribute('color');
  if (!col || col.itemSize < 3) return geo;
  const out: [number, number, number] = [0, 0, 0];
  for (let i = 0; i < col.count; i++) {
    gradeRGB(col.getX(i), col.getY(i), col.getZ(i), k, out);
    col.setXYZ(i, out[0], out[1], out[2]);
  }
  col.needsUpdate = true;
  return geo;
}

/** Grades a hex colour string (sRGB in, sRGB out) — for glow billboards and particle colours. */
export function gradeHex(hex: THREE.ColorRepresentation, k: Grade): string {
  _c.set(hex);
  const o: [number, number, number] = [0, 0, 0];
  gradeRGB(_c.r, _c.g, _c.b, k, o);
  _c.setRGB(Math.max(0, o[0]), Math.max(0, o[1]), Math.max(0, o[2]));
  return '#' + _c.getHexString();
}
