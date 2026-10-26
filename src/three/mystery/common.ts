// Shared primitives, palette and 2D helpers for the Mystery renderer (metres, XZ ground plane, +Y up, yaw 0 faces -Z).
import * as THREE from 'three';
import type { MapDef, Vec2, WallDef } from '../../mystery/types.ts';
import { clamp, hashString, mulberry32 } from '../util.ts';

export const BOX = new THREE.BoxGeometry(1, 1, 1);
export const CYL5 = new THREE.CylinderGeometry(1, 1, 1, 5, 1);
export const CYL6 = new THREE.CylinderGeometry(1, 1, 1, 6, 1);
export const CYL8 = new THREE.CylinderGeometry(1, 1, 1, 8, 1);
export const CYL12 = new THREE.CylinderGeometry(1, 1, 1, 12, 1);
export const CONE4 = new THREE.ConeGeometry(1, 1, 4, 1);
export const CONE5 = new THREE.ConeGeometry(1, 1, 5, 1);
export const CONE6 = new THREE.ConeGeometry(1, 1, 6, 1);
export const CONE8 = new THREE.ConeGeometry(1, 1, 8, 1);
export const ICO0 = new THREE.IcosahedronGeometry(1, 0);
export const ICO1 = new THREE.IcosahedronGeometry(1, 1);
export const TORUS = new THREE.TorusGeometry(1, 0.22, 5, 10);
/** Triangular prism, ridge along X, base at y = 0, apex at y = 1, unit width/depth. */
export const PRISM = (() => {
  const s = new THREE.Shape();
  s.moveTo(-0.5, 0); s.lineTo(0.5, 0); s.lineTo(0, 1); s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: 1, bevelEnabled: false });
  g.translate(0, 0, -0.5);
  g.rotateY(Math.PI / 2);
  return g;
})();

export const PAL = {
  fog: '#10152e',
  fogDark: '#080a1a',
  stone: ['#2c3260', '#333a6c', '#272c58'],
  stoneDark: '#1a1e40',
  stoneLight: '#4a5088',
  moss: '#2a4a3c',
  ground: '#1f3040',
  groundLight: '#2a3f50',
  dirt: '#4a4566',
  dirtLight: '#5a5578',
  wood: '#5a3d2a',
  woodDark: '#33221a',
  woodLight: '#7a5233',
  roof: '#1a1f42',
  iron: '#1b1d2c',
  lantern: '#f5b04c',
  violet: '#8b7cf6',
  cyan: '#4fe6f2',
  hedge: ['#1f3d30', '#26503a', '#1b3529'],
  skin: '#ecd8c4',
  skinPale: '#ece3d6',
  eggCommon: '#f3ead2',
  eggRare: '#3fe3f2',
  eggLegendary: '#ffc83a',
} as const;

export function eggHex(tier: string): string {
  return tier === 'legendary' ? PAL.eggLegendary : tier === 'rare' ? PAL.eggRare : PAL.eggCommon;
}

export const seeded = (s: string): (() => number) => mulberry32(hashString(s));

export function wrapAngle(a: number): number {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}
export const angleLerp = (from: number, to: number, t: number): number => from + wrapAngle(to - from) * t;

/** yaw (0 faces -Z, positive turns left) from a direction in the XZ plane */
export const yawOf = (dx: number, dz: number): number => Math.atan2(-dx, -dz);
export const fwdOf = (yaw: number): Vec2 => ({ x: -Math.sin(yaw), z: -Math.cos(yaw) });

export function distPointSeg(px: number, pz: number, ax: number, az: number, bx: number, bz: number): number {
  const dx = bx - ax, dz = bz - az;
  const l2 = dx * dx + dz * dz || 1e-9;
  const t = clamp(((px - ax) * dx + (pz - az) * dz) / l2, 0, 1);
  return Math.hypot(px - (ax + dx * t), pz - (az + dz * t));
}

export function nearestWall(map: MapDef, x: number, z: number, skip?: ReadonlySet<string>): { wall: WallDef; d: number } | null {
  let best: { wall: WallDef; d: number } | null = null;
  for (const w of map.walls) {
    if (skip?.has(w.id)) continue;
    const d = distPointSeg(x, z, w.a.x, w.a.z, w.b.x, w.b.z) - w.thickness / 2;
    if (!best || d < best.d) best = { wall: w, d };
  }
  return best;
}

export function segHitsWall(map: MapDef, ax: number, az: number, bx: number, bz: number, skip?: ReadonlySet<string>): boolean {
  const len = Math.hypot(bx - ax, bz - az);
  const n = Math.max(2, Math.ceil(len / 0.6));
  for (let i = 1; i < n; i++) {
    const t = i / n;
    const x = ax + (bx - ax) * t, z = az + (bz - az) * t;
    for (const w of map.walls) {
      if (skip?.has(w.id)) continue;
      if (distPointSeg(x, z, w.a.x, w.a.z, w.b.x, w.b.z) < w.thickness / 2) return true;
    }
  }
  return false;
}

export function mapCentre(map: MapDef): Vec2 {
  const b = map.bounds;
  return { x: (b.minX + b.maxX) / 2, z: (b.minZ + b.maxZ) / 2 };
}

export function lerpColor(a: THREE.Color, b: THREE.Color, t: number, out: THREE.Color): THREE.Color {
  return out.copy(a).lerp(b, t);
}

/** Soft vignette-less shadow blob texture (black radial falloff) */
export function makeBlobTexture(size = 64): THREE.Texture | null {
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  if (!ctx) return null;
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(0,0,0,0.85)');
  g.addColorStop(0.55, 'rgba(0,0,0,0.5)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Small canvas glyph texture ("!" / "?") used for the Hyde alert marker. */
export function makeGlyphTexture(glyph: string, color: string): THREE.Texture | null {
  if (typeof document === 'undefined') return null;
  const size = 128;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  if (!ctx) return null;
  ctx.clearRect(0, 0, size, size);
  ctx.font = 'bold 104px Georgia, "Times New Roman", serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = 12;
  ctx.strokeStyle = 'rgba(8,6,20,0.95)';
  ctx.strokeText(glyph, size / 2, size / 2 + 6);
  ctx.fillStyle = color;
  ctx.fillText(glyph, size / 2, size / 2 + 6);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
