// Art-direction constants and per-weather / per-leg environment presets.
import type { LegIndex, WeatherId } from './types.ts';

export const COL = {
  night: '#0b1020',
  indigo: '#161a3a',
  violet: '#8b7cf6',
  moon: '#cfd8ff',
  lantern: '#f5b04c',
  cyan: '#4fe6f2',
  eggCommon: '#f3ead2',
  eggRare: '#3fe3f2',
  eggLegendary: '#ffc83a',
  hydeEye: '#ffe27a',
  hydeEyeHalo: '#ff7a3a',
  wood: '#6a4630',
  woodDark: '#43291d',
  stone: '#3a3f66',
  stoneDark: '#262a4a',
  stoneLight: '#565c8c',
  skin: '#e9d3bd',
} as const;

export interface WeatherPreset {
  fogColor: string;
  fogDensity: number;
  skyZenith: string;
  skyHorizon: string;
  hemiSky: string;
  hemiGround: string;
  hemiIntensity: number;
  moonIntensity: number;
  moonVisibility: number;
  waterAmp: number;
  currents: number;
  glitter: number;
  groundFog: number;
  starAlpha: number;
  glowScale: number;
}

export const WEATHER_PRESETS: Record<WeatherId, WeatherPreset> = {
  clear: {
    fogColor: '#1a2258',
    fogDensity: 0.0055,
    skyZenith: '#070b24',
    skyHorizon: '#2c3a84',
    hemiSky: '#8e9cf0',
    hemiGround: '#2a3070',
    hemiIntensity: 1.9,
    moonIntensity: 3.0,
    moonVisibility: 1,
    waterAmp: 0.16,
    currents: 0,
    glitter: 1,
    groundFog: 0.45,
    starAlpha: 1,
    glowScale: 1,
  },
  strong_currents: {
    fogColor: '#1b2358',
    fogDensity: 0.0075,
    skyZenith: '#0b1236',
    skyHorizon: '#33427f',
    hemiSky: '#8795e6',
    hemiGround: '#262d68',
    hemiIntensity: 2.2,
    moonIntensity: 2.6,
    moonVisibility: 0.75,
    waterAmp: 0.4,
    currents: 1,
    glitter: 0.6,
    groundFog: 0.5,
    starAlpha: 0.65,
    glowScale: 1,
  },
  heavy_fog: {
    fogColor: '#3a3d72',
    fogDensity: 0.0165,
    skyZenith: '#1a1f4a',
    skyHorizon: '#4a4d86',
    hemiSky: '#9aa0e0',
    hemiGround: '#34397a',
    hemiIntensity: 2.6,
    moonIntensity: 1.8,
    moonVisibility: 0.35,
    waterAmp: 0.12,
    currents: 0,
    glitter: 0.25,
    groundFog: 1,
    starAlpha: 0.15,
    glowScale: 1.45,
  },
};

export interface LegPreset {
  name: string;
  /** colour multiplier on the fog/sky for a subtle per-leg mood */
  tint: [number, number, number];
  moonBoost: number;
  groundFogMul: number;
}

export const LEG_PRESETS: Record<LegIndex, LegPreset> = {
  1: { name: 'Misty Shallows', tint: [0.95, 1.02, 1.05], moonBoost: 1, groundFogMul: 1.5 },
  2: { name: 'Raven Island Crypts', tint: [1.04, 0.95, 1.08], moonBoost: 0.95, groundFogMul: 0.9 },
  3: { name: 'Final Sprint Dock', tint: [1.08, 1.0, 1.0], moonBoost: 1.25, groundFogMul: 0.6 },
};

export const MOON_DIR: [number, number, number] = [-0.62, 0.2, -0.45];
