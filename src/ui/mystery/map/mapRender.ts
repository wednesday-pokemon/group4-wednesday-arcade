// Canvas-2D map renderer shared by the HUD minimap and the Tab investigation map (UX_OVERHAUL §3 / §4).
//
// ============================================================================================================ API
// Coordinates: world metres on the XZ plane, −Z = north. Contract yaw: yaw 0 faces −Z (north), forward =
// (−sin yaw, −cos yaw), positive yaw turns LEFT (counter-clockwise seen from above). Compass heading (clockwise from
// north, degrees) = −yaw.
//
//   interface MapView { center: Vec2; rotation: number; pxPerM: number; size: { w, h }; shape: 'circle' | 'rect' }
//     rotation = player yaw  → heading-up (forward points up the screen; the HUD minimap: 28 m radius, 4 px/m)
//     rotation = 0           → north-up (the Tab map: whole island, 456×608 CSS px ≈ 5.07 px/m)
//   worldToScreen(view, p) / screenToWorld(view, s)      CSS-pixel transforms (pure; unit-tested)
//   fitView(bounds, size, pad?)                          north-up view that fits the island bounds into `size`
//   headingDeg(yaw) / bearingDeg(from, to) / relBearingDeg(yaw, from, to)
//
//   drawMap(ctx, view, layers, opts)
//     ctx    a 2D context whose backing store is CSS px × opts.dpr (MapCanvas handles DPR + resize)
//     layers MapLayers from buildMapLayers(state: PublicMapState, mode) in ./mapData.ts — PUBLIC data only
//     opts   { layers: { zones, egg, clues }    // Tab layer toggles (all on by default; minimap: all on)
//              showPredictions                   // settings "Show predictions" (off: no zone tints / % on the map)
//              labelBudget                       // minimap 4 · Tab ~40 (priority objective > egg > area > zone > room)
//              highContrast, reducedMotion, dpr, remPx (labels ≥ 14 px: fs-xs = 0.9375 rem)
//              frame?: 'minimap'                 // draws the round frame, N notch and CHASE rim (Hyde red / Crackstone
//                                                // double green — never both, R6)
//              highlight?: string | null }       // 'zone:<id>' | 'area:<id>' | 'egg:<id>' | 'clue:<clueId>' → lantern ring
//   The static layers (ground, rooms, walls, high cover) are pre-rendered ONCE per map geometry at 8 px/m and drawn
//   rotated; dynamic layers are drawn every call (the HUD calls it ≤ 30 Hz outside React render; 15 Hz in low
//   graphics). Label widths are measured once per (font, text) — measureText was the top JS self-time per frame.
//
//   <MapCanvas frame={() => ({ view, layers, opts }) } fps={30} />   (./MapCanvas.tsx) — React wrapper.
// ===============================================================================================================
import type { Vec2 } from '../../../mystery/types.ts';
import type { MapGeometry, MapLabel, MapLayers } from './mapData.ts';

export interface MapView {
  center: Vec2;
  rotation: number;
  pxPerM: number;
  size: { w: number; h: number };
  shape: 'circle' | 'rect';
}

export interface DrawOptions {
  /** `crack` (Tab toggle 4: Crackstone stipple + cursed area) defaults to on. */
  layers: { zones: boolean; egg: boolean; clues: boolean; crack?: boolean };
  showPredictions: boolean;
  labelBudget: number;
  highContrast: boolean;
  reducedMotion: boolean;
  dpr: number;
  /** Root font size in CSS px (labels use fs-xs = 0.9375 rem, never below 14 px). */
  remPx: number;
  frame?: 'minimap';
  highlight?: string | null;
}

export const MINIMAP_RADIUS_M = 28;
export const MINIMAP_PX_PER_M = 4;
const STATIC_PX_PER_M = 8;

// ------------------------------------------------------------------------------------------------- transforms

export function worldToScreen(v: Pick<MapView, 'center' | 'rotation' | 'pxPerM' | 'size'>, p: Vec2): { x: number; y: number } {
  const dx = p.x - v.center.x;
  const dz = p.z - v.center.z;
  const c = Math.cos(v.rotation);
  const s = Math.sin(v.rotation);
  // Canvas rotate(rotation): (dx, dz) → (dx·c − dz·s, dx·s + dz·c); +z (south) is screen-down when rotation = 0.
  return { x: v.size.w / 2 + (dx * c - dz * s) * v.pxPerM, y: v.size.h / 2 + (dx * s + dz * c) * v.pxPerM };
}

export function screenToWorld(v: Pick<MapView, 'center' | 'rotation' | 'pxPerM' | 'size'>, q: { x: number; y: number }): Vec2 {
  const sx = (q.x - v.size.w / 2) / v.pxPerM;
  const sy = (q.y - v.size.h / 2) / v.pxPerM;
  const c = Math.cos(v.rotation);
  const s = Math.sin(v.rotation);
  return { x: v.center.x + sx * c + sy * s, z: v.center.z - sx * s + sy * c };
}

/** North-up view fitting the bounds into `size` (Tab map). */
export function fitView(b: MapGeometry['bounds'], size: { w: number; h: number }, padPx = 0): MapView {
  const pxPerM = Math.min((size.w - padPx * 2) / (b.maxX - b.minX), (size.h - padPx * 2) / (b.maxZ - b.minZ));
  return { center: { x: (b.minX + b.maxX) / 2, z: (b.minZ + b.maxZ) / 2 }, rotation: 0, pxPerM, size, shape: 'rect' };
}

const DEG = 180 / Math.PI;
const norm360 = (d: number) => ((d % 360) + 360) % 360;
/** −180 … 180. */
export const wrapDeg = (d: number) => {
  const x = norm360(d);
  return x > 180 ? x - 360 : x;
};

/** Compass heading of a contract yaw: degrees clockwise from north (0 N, 90 E, 180 S, 270 W). */
export function headingDeg(yaw: number): number {
  return norm360(-yaw * DEG);
}

/** Compass bearing from → to (degrees clockwise from north; north = −Z). */
export function bearingDeg(from: Vec2, to: Vec2): number {
  return norm360(Math.atan2(to.x - from.x, -(to.z - from.z)) * DEG);
}

/** Bearing relative to the facing: 0 ahead, + right, − left (−180 … 180). */
export function relBearingDeg(yaw: number, from: Vec2, to: Vec2): number {
  return wrapDeg(bearingDeg(from, to) - headingDeg(yaw));
}

// ------------------------------------------------------------------------------------------------- colours

export interface MapPalette {
  void: string; ground: string; room: string; roomEdge: string; wall: string; cliff: string; hedge: string;
  hyde: string; hydeText: string; lantern: string; violet: string; ivory: string; text: string; text2: string; muted: string;
  predict: string; stealth: string; bg: string; frame: string;
  /** Joseph Crackstone (UX_ENEMIES §0): witch-light green. */
  crack: string; crackText: string;
  fills: boolean;
}

export const MAP_PALETTE: MapPalette = {
  void: '#070a14', ground: '#121733', room: '#1b2046', roomEdge: '#2e3366', wall: '#6b6aa8', cliff: '#2e3366', hedge: '#4d6a73',
  hyde: '#e5484d', hydeText: '#ff8a8a', lantern: '#f5b04c', violet: '#b3a8ff', ivory: '#efe6cc', text: '#f3ecdc', text2: '#d4cbb5',
  muted: '#a49fbf', predict: '#5cc0e6', stealth: '#9cc3d0', bg: '#0b1020', frame: '#6b6aa8', crack: '#a8e063', crackText: '#c4ef8a', fills: true,
};

/** High contrast (§11): fills off, walls 2 px white, zones hatch-only + white edges, cyan → #8fe3ff. */
export const MAP_PALETTE_HC: MapPalette = {
  ...MAP_PALETTE, void: '#000', ground: '#000', room: '#000', roomEdge: '#fff', wall: '#fff', cliff: '#fff', hedge: '#fff',
  violet: '#d9d2ff', lantern: '#ffc766', predict: '#8fe3ff', muted: '#e6e6e6', text: '#fff', text2: '#fff', frame: '#fff', crack: '#c8ff80', crackText: '#e0ffb8', fills: false,
};

const LABEL_COLOR = (pal: MapPalette): Record<MapLabel['color'], string> => ({
  lantern: pal.lantern, violet: pal.violet, ivory: pal.ivory, hyde: pal.hydeText, muted: pal.muted, text: pal.text, crack: pal.crackText,
});

// ------------------------------------------------------------------------------------------------- text widths

/** font → text → width (CSS px). Nested so a hit costs two Map lookups and no string building. */
const WIDTHS = new Map<string, Map<string, number>>();
let widthCount = 0;
const WIDTHS_MAX = 600;

/**
 * Cached `measureText(text).width` for `font` (the caller passes the font string it uses, so the hot path never reads
 * the `ctx.font` getter). Fixed labels (letters, landmarks, area names, "45%") repeat every frame.
 */
export function textWidthFor(ctx: Pick<CanvasRenderingContext2D, 'font' | 'measureText'>, font: string, text: string): number {
  let byText = WIDTHS.get(font);
  if (!byText) {
    byText = new Map();
    WIDTHS.set(font, byText);
  }
  let w = byText.get(text);
  if (w === undefined) {
    if (widthCount >= WIDTHS_MAX) {
      WIDTHS.clear();
      widthCount = 0;
      byText = new Map();
      WIDTHS.set(font, byText);
    }
    const prev = ctx.font;
    if (prev !== font) ctx.font = font;
    w = ctx.measureText(text).width;
    if (prev !== font) ctx.font = prev;
    byText.set(text, w);
    widthCount++;
  }
  return w;
}

/** Cached width for the context's CURRENT font (callers set ctx.font first). */
export function textWidth(ctx: Pick<CanvasRenderingContext2D, 'font' | 'measureText'>, text: string): number {
  return textWidthFor(ctx, ctx.font, text);
}

/** Test hook: how many widths are cached. */
export function textWidthCacheSize(): number {
  return widthCount;
}

/**
 * A pre-rendered label (halo stroke + fill, or fill only) at device resolution. drawImage of a cached bitmap replaces
 * the per-frame strokeText + fillText of every minimap / compass label (the top native canvas cost in the profile).
 */
export interface TextSprite { c: CanvasImageSource; w: number; h: number; tw: number; pad: number }
const SPRITES = new Map<string, Map<string, TextSprite | null>>();
let spriteCount = 0;
const SPRITES_MAX = 400;

export function textSprite(font: string, px: number, text: string, color: string, halo: string | null, dpr: number): TextSprite | null {
  const style = `${font}|${color}|${halo ?? ''}|${dpr}`;
  let byText = SPRITES.get(style);
  if (!byText) {
    byText = new Map();
    SPRITES.set(style, byText);
  }
  const hit = byText.get(text);
  if (hit !== undefined) return hit;
  if (spriteCount >= SPRITES_MAX) {
    SPRITES.clear();
    spriteCount = 0;
    byText = new Map();
    SPRITES.set(style, byText);
  }
  const pad = halo ? 3 : 1;
  const probe = makeCanvas(1, 1);
  const pc = probe?.getContext('2d') as Ctx2D | null | undefined;
  let sprite: TextSprite | null = null;
  if (pc) {
    pc.font = font;
    const tw = pc.measureText(text).width;
    const w = Math.ceil(tw + pad * 2);
    const h = Math.ceil(px * 1.35 + pad * 2);
    const cv = makeCanvas(Math.max(1, Math.ceil(w * dpr)), Math.max(1, Math.ceil(h * dpr)));
    const c2 = cv?.getContext('2d') as Ctx2D | null | undefined;
    if (cv && c2) {
      c2.setTransform(dpr, 0, 0, dpr, 0, 0);
      c2.font = font;
      c2.textAlign = 'left';
      c2.textBaseline = 'middle';
      if (halo) {
        c2.lineJoin = 'round';
        c2.lineWidth = 3;
        c2.strokeStyle = halo;
        c2.strokeText(text, pad, h / 2);
      }
      c2.fillStyle = color;
      c2.fillText(text, pad, h / 2);
      sprite = { c: cv as CanvasImageSource, w, h, tw, pad };
    }
  }
  byText.set(text, sprite);
  spriteCount++;
  return sprite;
}

/** Draw a sprite with its text anchored like fillText (align left / center / right; y = the text's middle). */
export function drawSprite(ctx: CanvasRenderingContext2D, s: TextSprite, x: number, y: number, align: 'left' | 'center' | 'right'): void {
  const x0 = align === 'center' ? x - s.tw / 2 - s.pad : align === 'left' ? x - s.pad : x - s.tw - s.pad;
  ctx.drawImage(s.c, x0, y - s.h / 2, s.w, s.h);
}

// Web fonts may finish loading after the first frames: drop bitmaps / widths measured with the fallback font.
if (typeof document !== 'undefined' && document.fonts && typeof document.fonts.addEventListener === 'function') {
  document.fonts.addEventListener('loadingdone', () => {
    SPRITES.clear();
    spriteCount = 0;
    WIDTHS.clear();
    widthCount = 0;
  });
}

/** 45° hatch (top-left → bottom-right), screen-aligned, spacing in CSS px, tile at device resolution. Cached per ctx. */
const HATCH = new WeakMap<object, Map<string, CanvasPattern | null>>();
export function hatchPattern(ctx: CanvasRenderingContext2D, spacing: number, color: string, dpr: number): CanvasPattern | null {
  let m = HATCH.get(ctx);
  if (!m) {
    m = new Map();
    HATCH.set(ctx, m);
  }
  const key = `${spacing}|${color}|${dpr}`;
  if (m.has(key)) return m.get(key)!;
  const s = Math.max(2, Math.round(spacing * dpr));
  const cv = makeCanvas(s, s);
  const c2 = cv?.getContext('2d') as Ctx2D | null | undefined;
  let pat: CanvasPattern | null = null;
  if (cv && c2) {
    c2.strokeStyle = color;
    c2.lineWidth = dpr;
    c2.beginPath();
    c2.moveTo(-1, -1);
    c2.lineTo(s + 1, s + 1);
    c2.moveTo(-1, s - 1);
    c2.lineTo(1, s + 1);
    c2.moveTo(s - 1, -1);
    c2.lineTo(s + 1, 1);
    c2.stroke();
    pat = ctx.createPattern(cv as CanvasImageSource, 'repeat');
    // the tile is in device px: undo the dpr scale of the screen-space transform it is filled under
    if (pat && dpr !== 1 && typeof DOMMatrix !== 'undefined') pat.setTransform(new DOMMatrix([1 / dpr, 0, 0, 1 / dpr, 0, 0]));
  }
  m.set(key, pat);
  return pat;
}

// ------------------------------------------------------------------------------------------------- static layer

type AnyCanvas = HTMLCanvasElement | OffscreenCanvas;
type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
const staticCache = new WeakMap<object, Map<string, AnyCanvas>>();

function makeCanvas(w: number, h: number): AnyCanvas | null {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  if (typeof document !== 'undefined') {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    return c;
  }
  return null;
}

/** Ground, rooms, walls (except the ones that can open) and high cover at 8 px/m. Cached per geometry + palette. */
export function staticLayer(g: MapGeometry, dynamicWallIds: ReadonlySet<string>, pal: MapPalette): AnyCanvas | null {
  const key = `${pal.fills ? 'n' : 'hc'}|${[...dynamicWallIds].sort().join(',')}`;
  let byKey = staticCache.get(g.walls);
  const hit = byKey?.get(key);
  if (hit) return hit;
  const b = g.bounds;
  const w = Math.ceil((b.maxX - b.minX) * STATIC_PX_PER_M);
  const h = Math.ceil((b.maxZ - b.minZ) * STATIC_PX_PER_M);
  const cv = makeCanvas(w, h);
  const ctx = cv?.getContext('2d') as Ctx2D | null | undefined;
  if (!cv || !ctx) return null;
  const k = STATIC_PX_PER_M;
  ctx.setTransform(k, 0, 0, k, -b.minX * k, -b.minZ * k);
  ctx.fillStyle = pal.ground;
  ctx.fillRect(b.minX, b.minZ, b.maxX - b.minX, b.maxZ - b.minZ);
  // rooms (the whole-island 'path' fallback is the ground itself)
  for (const r of g.rooms) {
    if (r.id === 'path' || r.polygon.length < 3) continue;
    ctx.beginPath();
    r.polygon.forEach((p, i) => (i ? ctx.lineTo(p.x, p.z) : ctx.moveTo(p.x, p.z)));
    ctx.closePath();
    if (pal.fills) {
      ctx.fillStyle = pal.room;
      ctx.fill();
    }
    ctx.strokeStyle = pal.roomEdge;
    ctx.lineWidth = 2 / k; // 1 px at 4 px/m after the ×0.5 downscale ≈ the spec's 1 px edge
    ctx.stroke();
  }
  // walls (static): 2.5 px stone/ruin/fence, cliffs + rocks 3 px, hedges 2 px (at the minimap's 4 px/m)
  ctx.lineCap = 'round';
  for (const wl of g.walls) {
    if (dynamicWallIds.has(wl.id)) continue;
    const isCliff = wl.kind === 'cliff' || wl.kind === 'rock';
    ctx.strokeStyle = wl.kind === 'hedge' ? pal.hedge : isCliff ? pal.cliff : pal.wall;
    const px = !pal.fills ? 2 : wl.kind === 'hedge' ? 2 : isCliff ? 3 : 2.5;
    ctx.lineWidth = px / 4; // metres → exactly the spec's px at the minimap's 4 px/m (Tab map scales with it)
    ctx.beginPath();
    ctx.moveTo(wl.a.x, wl.a.z);
    ctx.lineTo(wl.b.x, wl.b.z);
    ctx.stroke();
  }
  // high cover = 2 px-radius dots (low cover omitted)
  ctx.fillStyle = pal.wall;
  for (const c of g.cover) {
    if (c.height !== 'high') continue;
    ctx.beginPath();
    ctx.arc(c.x, c.z, 0.5, 0, Math.PI * 2);
    ctx.fill();
  }
  if (!byKey) {
    byKey = new Map();
    staticCache.set(g.walls, byKey);
  }
  byKey.set(key, cv);
  return cv;
}

// ------------------------------------------------------------------------------------------------- drawing

function applyWorld(ctx: CanvasRenderingContext2D, v: MapView, dpr: number): void {
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.translate(v.size.w / 2, v.size.h / 2);
  ctx.rotate(v.rotation);
  ctx.scale(v.pxPerM, v.pxPerM);
  ctx.translate(-v.center.x, -v.center.z);
}

function screenSpace(ctx: CanvasRenderingContext2D, dpr: number): void {
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function polyPath(ctx: CanvasRenderingContext2D, poly: readonly Vec2[]): void {
  ctx.beginPath();
  poly.forEach((p, i) => (i ? ctx.lineTo(p.x, p.z) : ctx.moveTo(p.x, p.z)));
  ctx.closePath();
}


function inView(v: MapView, q: { x: number; y: number }, margin = 0): boolean {
  if (v.shape === 'circle') {
    const r = Math.min(v.size.w, v.size.h) / 2 - margin;
    return Math.hypot(q.x - v.size.w / 2, q.y - v.size.h / 2) <= r;
  }
  return q.x >= margin && q.y >= margin && q.x <= v.size.w - margin && q.y <= v.size.h - margin;
}

/** Clamp a screen point to the view's rim (circle) or edge (rect); returns the clamped point + direction. */
export function clampToRim(v: Pick<MapView, 'size' | 'shape'>, q: { x: number; y: number }, inset: number): { x: number; y: number; angle: number } {
  const cx = v.size.w / 2;
  const cy = v.size.h / 2;
  const angle = Math.atan2(q.y - cy, q.x - cx);
  if (v.shape === 'circle') {
    const r = Math.min(v.size.w, v.size.h) / 2 - inset;
    return { x: cx + Math.cos(angle) * r, y: cy + Math.sin(angle) * r, angle };
  }
  const hx = v.size.w / 2 - inset;
  const hy = v.size.h / 2 - inset;
  const dx = q.x - cx;
  const dy = q.y - cy;
  const k = Math.min(hx / Math.max(1e-6, Math.abs(dx)), hy / Math.max(1e-6, Math.abs(dy)));
  return { x: cx + dx * k, y: cy + dy * k, angle };
}

// ---- glyphs (screen space, upright; exported for the compass)

export function diamond(ctx: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x, y - r);
  ctx.lineTo(x + r, y);
  ctx.lineTo(x, y + r);
  ctx.lineTo(x - r, y);
  ctx.closePath();
}

export function star(ctx: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const rr = i % 2 ? r * 0.45 : r;
    ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
  }
  ctx.closePath();
}

export function eggShape(ctx: CanvasRenderingContext2D, x: number, y: number, h: number): void {
  const w = h * 0.78;
  const top = y - h / 2;
  const bot = y + h / 2;
  ctx.beginPath();
  ctx.moveTo(x, top);
  ctx.bezierCurveTo(x + w * 0.42, top, x + w / 2, y + h * 0.1, x + w / 2, y + h * 0.16);
  ctx.bezierCurveTo(x + w / 2, bot - h * 0.06, x + w * 0.28, bot, x, bot);
  ctx.bezierCurveTo(x - w * 0.28, bot, x - w / 2, bot - h * 0.06, x - w / 2, y + h * 0.16);
  ctx.bezierCurveTo(x - w / 2, y + h * 0.1, x - w * 0.42, top, x, top);
  ctx.closePath();
}

export function cross(ctx: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x - r, y - r);
  ctx.lineTo(x + r, y + r);
  ctx.moveTo(x + r, y - r);
  ctx.lineTo(x - r, y + r);
}

export function claw(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, filled: boolean, color: string): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  if (filled) {
    ctx.beginPath();
    ctx.arc(0, 0, s * 0.62, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#0b1020';
  } else {
    ctx.beginPath();
    ctx.arc(0, 0, s * 0.62, 0, Math.PI * 2);
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }
  ctx.lineWidth = 1.6;
  ctx.lineCap = 'round';
  ctx.beginPath();
  for (const dx of [-0.25, 0, 0.25]) {
    ctx.moveTo(dx * s, -s * 0.32);
    ctx.lineTo(dx * s - s * 0.12, s * 0.32);
  }
  ctx.strokeStyle = filled ? '#0b1020' : color;
  ctx.stroke();
  ctx.restore();
}

export function tower(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, color: string): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.fillStyle = color;
  ctx.strokeStyle = '#0b1020';
  ctx.lineWidth = 1;
  const w = s * 0.5;
  ctx.beginPath();
  ctx.moveTo(-w / 2, s / 2);
  ctx.lineTo(-w / 2, -s * 0.15);
  ctx.lineTo(-w * 0.7, -s * 0.15);
  ctx.lineTo(-w * 0.7, -s * 0.3);
  ctx.lineTo(0, -s / 2);
  ctx.lineTo(w * 0.7, -s * 0.3);
  ctx.lineTo(w * 0.7, -s * 0.15);
  ctx.lineTo(w / 2, -s * 0.15);
  ctx.lineTo(w / 2, s / 2);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

export function eyeClosed(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, color: string): void {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.4;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(x - s / 2, y - s * 0.08);
  ctx.quadraticCurveTo(x, y + s * 0.38, x + s / 2, y - s * 0.08);
  for (const dx of [-0.3, 0, 0.3]) {
    ctx.moveTo(x + dx * s, y + s * 0.16);
    ctx.lineTo(x + dx * s * 1.25, y + s * 0.36);
  }
  ctx.stroke();
  ctx.restore();
}

export function lever(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, color: string): void {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = 2;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(x - s * 0.4, y + s * 0.35);
  ctx.lineTo(x + s * 0.4, y + s * 0.35);
  ctx.moveTo(x, y + s * 0.35);
  ctx.lineTo(x + s * 0.28, y - s * 0.3);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(x + s * 0.3, y - s * 0.34, s * 0.14, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

export function bolt(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, color: string): void {
  ctx.save();
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(x + s * 0.1, y - s / 2);
  ctx.lineTo(x - s * 0.3, y + s * 0.08);
  ctx.lineTo(x, y + s * 0.08);
  ctx.lineTo(x - s * 0.1, y + s / 2);
  ctx.lineTo(x + s * 0.3, y - s * 0.08);
  ctx.lineTo(x, y - s * 0.08);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

/** Joseph Crackstone's pilgrim hat (UX_ENEMIES §1 icon): brim + tapered crown + buckle; filled or outline. */
export function hat(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, filled: boolean, color: string): void {
  ctx.save();
  ctx.translate(x, y);
  const u = s / 24; // the 24-unit icon grid
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  // dark halo first: the hat must read on his own green stipple / cursed-area fill
  ctx.strokeStyle = '#0b1020';
  ctx.lineWidth = 3.5;
  ctx.beginPath();
  ctx.moveTo(-9 * u, 6 * u);
  ctx.lineTo(9 * u, 6 * u);
  ctx.moveTo(-5 * u, 6 * u);
  ctx.lineTo(-3.5 * u, -7 * u);
  ctx.lineTo(3.5 * u, -7 * u);
  ctx.lineTo(5 * u, 6 * u);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(-5 * u, 6 * u);
  ctx.lineTo(-3.5 * u, -7 * u);
  ctx.lineTo(3.5 * u, -7 * u);
  ctx.lineTo(5 * u, 6 * u);
  ctx.closePath();
  if (filled) {
    ctx.fillStyle = color;
    ctx.fill();
    ctx.strokeStyle = '#0b1020';
    ctx.lineWidth = 1;
    ctx.stroke();
  } else {
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.moveTo(-9 * u, 6 * u);
  ctx.lineTo(9 * u, 6 * u);
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(1.5, 2 * u);
  ctx.stroke();
  ctx.strokeStyle = filled ? '#0b1020' : color;
  ctx.lineWidth = 1;
  ctx.strokeRect(-2 * u, 0, 4 * u, 3 * u);
  ctx.restore();
}

/** Inset a convex polygon by `d` (same units), keeping its orientation; falls back to the input when degenerate. */
export function insetPolygon(poly: readonly Vec2[], d: number): Vec2[] {
  const n = poly.length;
  if (n < 3) return [...poly];
  let area = 0;
  for (let i = 0; i < n; i++) {
    const a = poly[i]!;
    const b = poly[(i + 1) % n]!;
    area += a.x * b.z - b.x * a.z;
  }
  const sgn = area >= 0 ? 1 : -1;
  // offset lines: each edge moved inward along its normal
  const lines = poly.map((a, i) => {
    const b = poly[(i + 1) % n]!;
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const L = Math.hypot(dx, dz) || 1;
    const nx = (-dz / L) * sgn;
    const nz = (dx / L) * sgn;
    return { x: a.x + nx * d, z: a.z + nz * d, dx, dz };
  });
  const out: Vec2[] = [];
  for (let i = 0; i < n; i++) {
    const p = lines[(i + n - 1) % n]!;
    const q = lines[i]!;
    const den = p.dx * q.dz - p.dz * q.dx;
    if (Math.abs(den) < 1e-9) return [...poly];
    const t = ((q.x - p.x) * q.dz - (q.z - p.z) * q.dx) / den;
    out.push({ x: p.x + p.dx * t, z: p.z + p.dz * t });
  }
  return out;
}

/** Stipple patterns (dots r 1.5 px at 8 / 5 / 3 px spacing) per context + colour, built once. */
const STIPPLE = new WeakMap<object, Map<string, CanvasPattern | null>>();
function stipple(ctx: CanvasRenderingContext2D, spacing: number, color: string): CanvasPattern | null {
  let m = STIPPLE.get(ctx);
  if (!m) {
    m = new Map();
    STIPPLE.set(ctx, m);
  }
  const key = `${spacing}|${color}`;
  if (m.has(key)) return m.get(key)!;
  const cv = makeCanvas(spacing * 2, spacing * 2);
  const c2 = cv?.getContext('2d') as Ctx2D | null | undefined;
  let pat: CanvasPattern | null = null;
  if (cv && c2) {
    c2.fillStyle = color;
    for (const [x, y] of [[spacing / 2, spacing / 2], [spacing * 1.5, spacing * 1.5]] as const) {
      c2.beginPath();
      c2.arc(x, y, 1.5, 0, Math.PI * 2);
      c2.fill();
    }
    pat = ctx.createPattern(cv as CanvasImageSource, 'repeat');
  }
  m.set(key, pat);
  return pat;
}

export const labelFont = (px: number) => `600 ${px}px 'Alegreya Sans', 'Segoe UI', sans-serif`;

function label(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, color: string, px: number, pal: MapPalette, dpr: number): void {
  const s = textSprite(labelFont(px), px, text, color, pal.bg, dpr);
  if (s) {
    drawSprite(ctx, s, x, y, 'center');
    return;
  }
  ctx.font = labelFont(px);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  ctx.lineWidth = 3;
  ctx.strokeStyle = pal.bg;
  ctx.strokeText(text, x, y);
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
}

/**
 * Draw one frame. Static layers come from the cached 8 px/m image; everything else is drawn here. The caller owns the
 * canvas size (backing store = CSS px × dpr).
 */
export function drawMap(ctx: CanvasRenderingContext2D, v: MapView, L: MapLayers, o: DrawOptions): void {
  const pal = o.highContrast ? MAP_PALETTE_HC : MAP_PALETTE;
  const dpr = o.dpr;
  const W = v.size.w;
  const H = v.size.h;
  const px = (n: number) => n / v.pxPerM; // CSS px → metres (inside the world transform)
  const fontPx = Math.max(14, o.remPx * 0.9375);
  /** Glyph scale: the spec's px are at 1366 (1rem = 16 px); glyphs grow with the fluid root (×1.4 at 1920). */
  const G = Math.max(1, o.remPx / 16);
  const now = L.t;
  const sp = (p: Vec2) => worldToScreen(v, p);
  const isHi = (id: string) => !!o.highlight && o.highlight === id;

  ctx.save();
  screenSpace(ctx, dpr);
  ctx.clearRect(0, 0, W, H);
  if (v.shape === 'circle') {
    ctx.beginPath();
    ctx.arc(W / 2, H / 2, Math.min(W, H) / 2, 0, Math.PI * 2);
    ctx.clip();
  }
  ctx.fillStyle = pal.void;
  ctx.fillRect(0, 0, W, H);

  // 1–2, 4: static (ground, rooms, walls, high cover)
  const dynIds = new Set(L.dynamicWalls.map((d) => d.id));
  const st = staticLayer(L.geometry, dynIds, pal);
  applyWorld(ctx, v, dpr);
  const b = L.geometry.bounds;
  if (st) {
    ctx.imageSmoothingEnabled = true;
    // blit only the part of the 8 px/m image the view can show (the minimap sees ~80 m of a 90×120 m island)
    const reach = Math.hypot(W, H) / 2 / v.pxPerM + 1;
    const x0 = Math.max(b.minX, v.center.x - reach);
    const z0 = Math.max(b.minZ, v.center.z - reach);
    const x1 = Math.min(b.maxX, v.center.x + reach);
    const z1 = Math.min(b.maxZ, v.center.z + reach);
    if (x1 > x0 && z1 > z0) {
      const k8 = STATIC_PX_PER_M;
      const sx = Math.floor((x0 - b.minX) * k8);
      const sy = Math.floor((z0 - b.minZ) * k8);
      const sw = Math.min(Math.ceil((x1 - b.minX) * k8), (st as { width: number }).width) - sx;
      const sh = Math.min(Math.ceil((z1 - b.minZ) * k8), (st as { height: number }).height) - sy;
      if (sw > 0 && sh > 0) ctx.drawImage(st as CanvasImageSource, sx, sy, sw, sh, b.minX + sx / k8, b.minZ + sy / k8, sw / k8, sh / k8);
    }
  }

  // 3: Hyde zones (risk): fill α = .08 + .32p, 45° hatch 10 / 6 / 3 px, 1 px edge α.6 — tints only with predictions on
  if (o.showPredictions && o.layers.zones) {
    for (const z of L.zones) {
      ctx.save();
      screenSpace(ctx, dpr);
      ctx.beginPath();
      for (let i = 0; i < z.polygon.length; i++) {
        const q = sp(z.polygon[i]!);
        if (i) ctx.lineTo(q.x, q.y);
        else ctx.moveTo(q.x, q.y);
      }
      ctx.closePath();
      if (pal.fills) {
        ctx.globalAlpha = 0.08 + 0.32 * z.p;
        ctx.fillStyle = pal.hyde;
        ctx.fill();
      }
      const pat = hatchPattern(ctx, z.p < 0.3 ? 10 : z.p < 0.6 ? 6 : 3, o.highContrast ? '#fff' : pal.hyde, dpr);
      if (pat) {
        ctx.globalAlpha = o.highContrast ? 0.5 : 0.18 + 0.2 * z.p;
        ctx.fillStyle = pat;
        ctx.fill();
      }
      const hi = isHi(`zone:${z.id}`);
      ctx.globalAlpha = hi ? 1 : 0.6;
      ctx.strokeStyle = hi ? pal.lantern : o.highContrast ? '#fff' : pal.hyde;
      ctx.lineWidth = hi ? 2.5 : 1;
      ctx.stroke();
      ctx.restore();
    }
    // before emergence: possible spawn points (dashed red ring)
    for (const s of L.spawns) {
      const q = sp(s);
      ctx.save();
      screenSpace(ctx, dpr);
      ctx.strokeStyle = isHi(`spawn:${s.id}`) ? pal.lantern : pal.hyde;
      ctx.globalAlpha = 0.5 + 0.5 * s.p;
      ctx.setLineDash([3, 3]);
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(q.x, q.y, Math.max(6, 4 * v.pxPerM), 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
  }

  // 3b: Crackstone risk (rule-based) — dot stipple in crack green, r 1.5 px, spacing 8 / 5 / 3 px by p band, dot α
  //     .5 + .4p, tint α ≤ .10; dots over the Hyde's hatch read as "both" in greyscale. One path + fill per band.
  const crackOn = o.layers.crack !== false;
  if (L.crack && o.showPredictions && crackOn && L.crack.risk.length) {
    const rad = Math.min(W, H) / 2;
    for (const band of [0, 1, 2] as const) {
      const cells = L.crack.risk.filter((c) => c.band === band);
      if (!cells.length) continue;
      ctx.save();
      screenSpace(ctx, dpr);
      ctx.beginPath();
      let pSum = 0;
      let drawn = 0;
      for (const c of cells) {
        const mid = sp(c);
        const reach = c.sizeM * v.pxPerM;
        if (v.shape === 'circle' ? Math.hypot(mid.x - W / 2, mid.y - H / 2) > rad + reach : !inView(v, mid, -reach)) continue;
        const h = c.sizeM / 2;
        const corners = [sp({ x: c.x - h, z: c.z - h }), sp({ x: c.x + h, z: c.z - h }), sp({ x: c.x + h, z: c.z + h }), sp({ x: c.x - h, z: c.z + h })];
        corners.forEach((q, i) => (i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y)));
        ctx.closePath();
        pSum += c.p;
        drawn++;
      }
      if (drawn) {
        const pm = pSum / drawn;
        if (pal.fills) {
          ctx.globalAlpha = Math.min(0.1, 0.04 + 0.08 * pm);
          ctx.fillStyle = pal.crack;
          ctx.fill();
        }
        const pat = stipple(ctx, band === 0 ? 8 : band === 1 ? 5 : 3, pal.crack);
        if (pat) {
          ctx.globalAlpha = 0.5 + 0.4 * pm;
          ctx.fillStyle = pat;
          ctx.fill();
        }
      }
      ctx.restore();
    }
  }

  // 4b: dynamic walls (gate dashed, passage = a normal wall until it opens), passage gap flash after opening
  applyWorld(ctx, v, dpr);
  for (const d of L.dynamicWalls) {
    if (d.open) continue;
    ctx.save();
    ctx.strokeStyle = pal.wall;
    ctx.lineWidth = px(2.5);
    ctx.lineCap = 'round';
    if (d.style === 'gate') ctx.setLineDash([px(4), px(3)]);
    ctx.beginPath();
    ctx.moveTo(d.a.x, d.a.z);
    ctx.lineTo(d.b.x, d.b.z);
    ctx.stroke();
    ctx.restore();
  }
  for (const fl of L.flashes) {
    if (fl.kind !== 'passage' || !fl.wallId) continue;
    const age = now - fl.t0;
    if (age < 0 || age > 1.2) continue;
    const on = o.reducedMotion ? age < 1.2 : Math.floor(age / 0.3) % 2 === 0; // two flashes over 1.2 s
    const wl = L.dynamicWalls.find((d) => d.id === fl.wallId);
    if (!on || !wl) continue;
    ctx.save();
    ctx.strokeStyle = pal.lantern;
    ctx.lineWidth = px(2.5);
    ctx.setLineDash([px(4), px(3)]);
    ctx.beginPath();
    ctx.moveTo(wl.a.x, wl.a.z);
    ctx.lineTo(wl.b.x, wl.b.z);
    ctx.stroke();
    ctx.restore();
  }

  // 5: known hazards — noisy floors amber hatch patch; searchlights amber wedge α.25 rotating with the real beam
  for (const h of L.hazards) {
    ctx.save();
    applyWorld(ctx, v, dpr);
    if (h.kind === 'floor') {
      polyPath(ctx, h.polygon);
      ctx.globalAlpha = 0.85;
      ctx.strokeStyle = pal.lantern;
      ctx.lineWidth = px(1);
      ctx.stroke();
      ctx.save();
      screenSpace(ctx, dpr);
      ctx.beginPath();
      for (let i = 0; i < h.polygon.length; i++) {
        const q = sp(h.polygon[i]!);
        if (i) ctx.lineTo(q.x, q.y);
        else ctx.moveTo(q.x, q.y);
      }
      ctx.closePath();
      const pat = hatchPattern(ctx, 4, pal.lantern, dpr);
      if (pat) {
        ctx.globalAlpha = 0.55;
        ctx.fillStyle = pat;
        ctx.fill();
      }
      ctx.restore();
    } else {
      // forward = (−sin yaw, −cos yaw) → canvas angle of the beam direction in world space
      const dirAng = Math.atan2(-Math.cos(h.yaw), -Math.sin(h.yaw));
      const half = ((h.coneDeg / 2) * Math.PI) / 180;
      ctx.beginPath();
      ctx.moveTo(h.x, h.z);
      ctx.arc(h.x, h.z, h.rangeM, dirAng - half, dirAng + half);
      ctx.closePath();
      ctx.globalAlpha = 0.25;
      ctx.fillStyle = pal.lantern;
      ctx.fill();
      ctx.globalAlpha = 0.7;
      ctx.strokeStyle = pal.lantern;
      ctx.lineWidth = px(1);
      ctx.stroke();
    }
    ctx.restore();
  }

  // 5b: Crackstone's cursed area — 2 px solid crack outer + 1 px dashed inner inset 3 px (public: Thing announces it)
  if (L.crack && crackOn && L.crack.area.polygon.length >= 3) {
    ctx.save();
    applyWorld(ctx, v, dpr);
    polyPath(ctx, L.crack.area.polygon);
    ctx.strokeStyle = pal.crack;
    ctx.lineWidth = px(2);
    ctx.lineJoin = 'round';
    ctx.stroke();
    polyPath(ctx, insetPolygon(L.crack.area.polygon, px(3)));
    ctx.lineWidth = px(1);
    ctx.setLineDash([px(4), px(3)]);
    ctx.globalAlpha = 0.85;
    ctx.stroke();
    ctx.restore();
  }

  // 6: clue areas — dashed 1.5 px violet circle at the area radius, fill α.08; done → faint α.25; focus → lantern
  if (o.layers.clues) {
    for (const a of L.areas) {
      ctx.save();
      applyWorld(ctx, v, dpr);
      ctx.beginPath();
      ctx.arc(a.x, a.z, a.radiusM, 0, Math.PI * 2);
      const color = a.state === 'focus' || isHi(`area:${a.id}`) ? pal.lantern : pal.violet;
      if (a.state !== 'done' && pal.fills) {
        ctx.globalAlpha = 0.08;
        ctx.fillStyle = color;
        ctx.fill();
      }
      ctx.globalAlpha = a.state === 'done' ? 0.25 : 1;
      ctx.strokeStyle = color;
      ctx.lineWidth = px(a.state === 'focus' ? 2 : 1.5);
      ctx.setLineDash([px(5), px(4)]);
      ctx.stroke();
      ctx.restore();
      if (a.badge) {
        const q = sp(a);
        ctx.save();
        screenSpace(ctx, dpr);
        ctx.fillStyle = pal.bg;
        ctx.strokeStyle = pal.violet;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(q.x, q.y, 9 * G, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(q.x - 4, q.y);
        ctx.lineTo(q.x - 1, q.y + 3.5);
        ctx.lineTo(q.x + 4.5, q.y - 3.5);
        ctx.stroke();
        ctx.restore();
      }
    }
    // 7: candidate clue sites — 8 px hollow violet diamond; checked → ✕ muted
    screenSpace(ctx, dpr);
    for (const c of L.clueSites) {
      const q = sp(c);
      if (!inView(v, q)) continue;
      ctx.save();
      ctx.lineWidth = 1.5;
      if (c.state === 'checked') {
        ctx.strokeStyle = pal.muted;
        cross(ctx, q.x, q.y, 3.5 * G);
        ctx.stroke();
      } else {
        ctx.strokeStyle = isHi(`clue:${c.clueId}`) ? pal.lantern : pal.violet;
        diamond(ctx, q.x, q.y, 4.5 * G);
        ctx.fillStyle = pal.bg;
        ctx.fill();
        ctx.stroke();
      }
      ctx.restore();
    }
  }

  // 8: egg sites — 14 px ivory egg glyph; 5 m dashed ring α .35 + .65p; top site solid 2 px; checked ✕; seen filled
  if (o.layers.egg) {
    for (const e of L.eggSites) {
      const q = sp(e);
      ctx.save();
      screenSpace(ctx, dpr);
      const r = 5 * v.pxPerM;
      if (e.state === 'candidate') {
        ctx.strokeStyle = isHi(`egg:${e.id}`) ? pal.lantern : pal.ivory;
        ctx.globalAlpha = o.showPredictions && e.p !== null ? 0.35 + 0.65 * e.p : 0.6;
        ctx.lineWidth = e.top && o.showPredictions ? 2 : 1.2;
        if (!(e.top && o.showPredictions)) ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.arc(q.x, q.y, r, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.globalAlpha = 1;
        eggShape(ctx, q.x, q.y, 14 * G);
        ctx.fillStyle = pal.bg;
        ctx.fill();
        ctx.lineWidth = 1.5;
        ctx.stroke();
      } else if (e.state === 'checked') {
        ctx.strokeStyle = pal.muted;
        ctx.lineWidth = 1.5;
        eggShape(ctx, q.x, q.y, 12 * G);
        ctx.globalAlpha = 0.6;
        ctx.stroke();
        ctx.globalAlpha = 1;
        cross(ctx, q.x, q.y, 4 * G);
        ctx.stroke();
      } else {
        eggShape(ctx, q.x, q.y, 14 * G);
        ctx.fillStyle = pal.ivory;
        ctx.fill();
      }
      ctx.restore();
    }
  }

  // 9: Iago Tower + 3 m deposit circle
  {
    const q = sp(L.tower);
    ctx.save();
    applyWorld(ctx, v, dpr);
    ctx.beginPath();
    ctx.arc(L.tower.x, L.tower.z, L.tower.radius, 0, Math.PI * 2);
    ctx.strokeStyle = L.tower.objective ? pal.lantern : pal.text2;
    ctx.globalAlpha = 0.7;
    ctx.lineWidth = px(1.2);
    ctx.stroke();
    ctx.restore();
    ctx.save();
    screenSpace(ctx, dpr);
    tower(ctx, q.x, q.y, 18 * G, L.tower.objective ? pal.lantern : pal.text2);
    ctx.restore();
  }

  // 10: hiding spots — 12 px eye-closed glyph, stealth blue α.8
  screenSpace(ctx, dpr);
  ctx.save();
  ctx.globalAlpha = 0.8;
  for (const h of L.hiding) {
    const q = sp(h);
    if (inView(v, q, -12)) eyeClosed(ctx, q.x, q.y, 12 * G, pal.stealth);
  }
  ctx.restore();
  if (L.lever) {
    const q = sp(L.lever);
    lever(ctx, q.x, q.y, 13 * G, pal.lantern);
  }
  if (L.powerSwitch) {
    const q = sp(L.powerSwitch);
    bolt(ctx, q.x, q.y, 13 * G, pal.lantern);
  }

  // 11: route — dotted lantern 2 px
  if (L.route && L.route.length > 1) {
    ctx.save();
    screenSpace(ctx, dpr);
    ctx.strokeStyle = pal.lantern;
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.setLineDash([0.1, 6]);
    ctx.beginPath();
    L.route.forEach((p, i) => {
      const q = sp(p);
      if (i) ctx.lineTo(q.x, q.y);
      else ctx.moveTo(q.x, q.y);
    });
    ctx.stroke();
    ctx.restore();
  }

  // 12: revealed pins — clue lantern star + glow; egg filled lantern egg
  screenSpace(ctx, dpr);
  if (o.layers.clues) {
    for (const c of L.cluePins) {
      const q = sp(c);
      ctx.save();
      ctx.shadowColor = pal.lantern;
      ctx.shadowBlur = 8;
      ctx.fillStyle = pal.lantern;
      star(ctx, q.x, q.y, 6 * G);
      ctx.fill();
      ctx.restore();
    }
  }
  if (L.eggPin) {
    const q = sp(L.eggPin);
    ctx.save();
    ctx.shadowColor = pal.lantern;
    ctx.shadowBlur = 8;
    eggShape(ctx, q.x, q.y, 15 * G);
    ctx.fillStyle = pal.lantern;
    ctx.fill();
    ctx.restore();
  }
  // reveal pulse ring (600 ms)
  for (const fl of L.flashes) {
    if (fl.kind !== 'reveal' || o.reducedMotion) continue;
    const age = now - fl.t0;
    if (age < 0 || age > 0.6) continue;
    const q = sp(fl);
    ctx.save();
    ctx.strokeStyle = pal.lantern;
    ctx.globalAlpha = 1 - age / 0.6;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(q.x, q.y, (6 + 22 * (age / 0.6)) * G, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  // 12b: curse circle (public telegraph) — radius × px/m, 2 px stroke, pie fill of the wind-up (kept in reduced motion)
  if (L.crack?.curse) {
    const cu = L.crack.curse;
    const q = sp(cu);
    const rr = cu.radiusM * v.pxPerM;
    if (inView(v, q, -rr)) {
      ctx.save();
      screenSpace(ctx, dpr);
      ctx.globalAlpha = 0.35;
      ctx.fillStyle = pal.crack;
      ctx.beginPath();
      ctx.moveTo(q.x, q.y);
      ctx.arc(q.x, q.y, rr, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * cu.progress);
      ctx.closePath();
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.strokeStyle = pal.crack;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(q.x, q.y, rr, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
  }

  // 13: Hyde — red claw only while visible / chasing; fading outline at the last sighting
  if (L.hyde) {
    const q = sp(L.hyde);
    ctx.save();
    ctx.globalAlpha = L.hyde.alpha;
    claw(ctx, q.x, q.y, 14 * G, L.hyde.kind !== 'last', pal.hyde);
    ctx.restore();
  }

  // 13b: Crackstone — filled hat + view cone (coneDeg, 40 px, α .18) ONLY per R4 (+ the scan ring with it); otherwise a
  //      hat outline fading over 8 s at the last sighting
  if (L.crack?.marker) {
    const m = L.crack.marker;
    const q = sp(m);
    ctx.save();
    screenSpace(ctx, dpr);
    if (m.kind !== 'last') {
      const sc = L.crack.scan;
      if (sc) {
        const rr = sc.radiusM * v.pxPerM * (o.reducedMotion || sc.pulse ? 1 : Math.max(0.05, sc.progress));
        ctx.strokeStyle = pal.crack;
        ctx.lineWidth = sc.pulse ? 3 : 2;
        ctx.globalAlpha = sc.pulse ? 0.9 : 0.75;
        if (!sc.pulse) ctx.setLineDash([5, 4]);
        ctx.beginPath();
        ctx.arc(q.x, q.y, rr, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
      }
      const fwd = sp({ x: m.x - Math.sin(m.yaw), z: m.z - Math.cos(m.yaw) });
      const ang = Math.atan2(fwd.y - q.y, fwd.x - q.x);
      const half = ((m.coneDeg / 2) * Math.PI) / 180;
      ctx.globalAlpha = 0.18;
      ctx.fillStyle = pal.crack;
      ctx.beginPath();
      ctx.moveTo(q.x, q.y);
      ctx.arc(q.x, q.y, 40 * G, ang - half, ang + half);
      ctx.closePath();
      ctx.fill();
      ctx.globalAlpha = 1;
      hat(ctx, q.x, q.y, 14 * G, true, pal.crack);
    } else {
      ctx.globalAlpha = m.alpha;
      hat(ctx, q.x, q.y, 14 * G, false, pal.crack);
    }
    ctx.restore();
  }

  // 14: player — ivory arrow + 60° view cone (α.12, 40 px) + noise ring (hearing radius × px/m)
  {
    const pl = L.player;
    const q = sp(pl);
    const fwd = sp({ x: pl.x - Math.sin(pl.yaw), z: pl.z - Math.cos(pl.yaw) });
    const ang = Math.atan2(fwd.y - q.y, fwd.x - q.x);
    ctx.save();
    if (pl.noiseRadiusM > 0 && pl.stance !== 'idle' && pl.noiseBand !== 'silent') {
      ctx.strokeStyle = pl.noiseBand === 'loud' ? pal.lantern : pl.noiseBand === 'audible' ? pal.text2 : pal.muted;
      ctx.lineWidth = 1.5;
      ctx.globalAlpha = 0.85;
      if (pl.crouched) ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.arc(q.x, q.y, pl.noiseRadiusM * v.pxPerM, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    ctx.globalAlpha = 0.12;
    ctx.fillStyle = pal.ivory;
    ctx.beginPath();
    ctx.moveTo(q.x, q.y);
    ctx.arc(q.x, q.y, 40 * G, ang - Math.PI / 6, ang + Math.PI / 6);
    ctx.closePath();
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.translate(q.x, q.y);
    ctx.rotate(ang + Math.PI / 2);
    ctx.beginPath();
    ctx.moveTo(0, -8 * G);
    ctx.lineTo(6 * G, 6 * G);
    ctx.lineTo(0, 3 * G);
    ctx.lineTo(-6 * G, 6 * G);
    ctx.closePath();
    ctx.fillStyle = pal.ivory;
    ctx.strokeStyle = pal.bg;
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.fill();
    ctx.restore();
  }

  // 12b (stroke on top): a 1.8 m curse circle is ~7 px in radius at 4 px/m — re-stroke it over the player arrow
  if (L.crack?.curse) {
    const cu = L.crack.curse;
    const q = sp(cu);
    ctx.save();
    screenSpace(ctx, dpr);
    ctx.strokeStyle = pal.crack;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(q.x, q.y, cu.radiusM * v.pxPerM, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  // objective marker: lantern diamond; off-view → clamped pip on the rim with a direction tick
  if (L.objective) {
    const q = sp(L.objective);
    ctx.save();
    ctx.fillStyle = pal.lantern;
    ctx.strokeStyle = pal.bg;
    ctx.lineWidth = 1.5;
    if (inView(v, q, 8)) {
      diamond(ctx, q.x, q.y, 7 * G);
      ctx.fill();
      ctx.stroke();
    } else {
      const c = clampToRim(v, q, 9);
      diamond(ctx, c.x, c.y, 6 * G);
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(c.x + Math.cos(c.angle) * 8, c.y + Math.sin(c.angle) * 8);
      ctx.lineTo(c.x + Math.cos(c.angle + 0.5) * 3, c.y + Math.sin(c.angle + 0.5) * 3);
      ctx.lineTo(c.x + Math.cos(c.angle - 0.5) * 3, c.y + Math.sin(c.angle - 0.5) * 3);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  }
  // the top egg site clamps to the rim too (minimap)
  if (o.frame === 'minimap' && o.layers.egg) {
    const top = L.eggSites.find((e) => e.top);
    if (top) {
      const q = sp(top);
      if (!inView(v, q, 6)) {
        const c = clampToRim(v, q, 8);
        ctx.save();
        ctx.strokeStyle = pal.ivory;
        ctx.fillStyle = pal.bg;
        ctx.lineWidth = 1.5;
        eggShape(ctx, c.x, c.y, 10 * G);
        ctx.fill();
        ctx.stroke();
        ctx.restore();
      }
    }
  }

  // labels — upright, ≤ budget in view, priority objective > egg > area > zone > room
  {
    const colors = LABEL_COLOR(pal);
    const placed: { x: number; y: number; w: number; h: number }[] = [];
    // labels never cover the live enemy markers or the player arrow (the "CURSED · area" label sits on his centroid)
    const keepFree = (p: Vec2 | null | undefined, r: number) => {
      if (!p) return;
      const q = sp(p);
      placed.push({ x: q.x - r, y: q.y - r, w: 2 * r, h: 2 * r });
    };
    keepFree(L.player, 9 * G);
    if (L.hyde && L.hyde.kind !== 'last') keepFree(L.hyde, 9 * G);
    if (L.crack?.marker && L.crack.marker.kind !== 'last') keepFree(L.crack.marker, 9 * G);
    const font = labelFont(fontPx);
    const sorted = [...L.labels]
      .filter((lb) => (lb.id?.startsWith('crack:') ? crackOn && (lb.id !== 'crack:here' || o.showPredictions) : lb.priority !== 3 || (o.showPredictions && o.layers.zones))
        && (!lb.id?.startsWith('egg:') || o.layers.egg) && (!lb.id?.startsWith('area:') || o.layers.clues))
      .sort((a, b) => a.priority - b.priority);
    let used = 0;
    for (const lb of sorted) {
      if (used >= o.labelBudget) break;
      let text = lb.text;
      if (!o.showPredictions && /%/.test(text) && !lb.id?.startsWith('room:')) {
        // predictions off: keep names, drop numbers
        text = text.replace(/\s*(<|>)?\d+%$/, '').trim();
        if (!text) continue;
      }
      const q = sp(lb);
      const y0 = lb.insideTopR ? q.y - lb.insideTopR * v.pxPerM + fontPx * 0.8 : q.y + (lb.dy ?? 0);
      const glyphW = lb.glyph ? fontPx * 0.95 : 0;
      const w = textWidthFor(ctx, font, text) + glyphW;
      // the anchor first; a centroid label (no dy) may step one line up / down to clear a marker
      const tries = lb.dy === undefined && !lb.insideTopR ? [0, -fontPx * 1.1, fontPx * 1.1] : [0];
      let y = y0;
      let box: { x: number; y: number; w: number; h: number } | null = null;
      for (const off of tries) {
        const yy = y0 + off;
        if (!inView(v, { x: q.x, y: yy }, 6)) continue;
        const b = { x: q.x - w / 2 - 2, y: yy - fontPx / 2, w: w + 4, h: fontPx };
        // the whole label must sit inside the view (circle: all four corners inside the rim)
        const corners = [[b.x, b.y], [b.x + b.w, b.y], [b.x, b.y + b.h], [b.x + b.w, b.y + b.h]] as const;
        if (!corners.every(([cx, cy]) => inView(v, { x: cx, y: cy }, 2))) continue;
        if (placed.some((p) => b.x < p.x + p.w && b.x + b.w > p.x && b.y < p.y + p.h && b.y + b.h > p.y)) continue;
        // keep inside a rect view
        if (v.shape === 'rect' && (b.x < 0 || b.x + b.w > W)) continue;
        box = b;
        y = yy;
        break;
      }
      if (!box) continue;
      const color = isHi(lb.id ?? '') ? pal.lantern : colors[lb.color];
      if (lb.glyph === 'hat') hat(ctx, q.x - w / 2 + glyphW / 2, y, fontPx * 0.9, true, pal.crack);
      label(ctx, text, q.x + glyphW / 2, y, color, fontPx, pal, dpr);
      placed.push(box);
      used++;
    }
  }

  ctx.restore();

  // frame: 2 px border-strong + inner 1 px lantern α.4; N notch riding the rim; CHASE → 2 px Hyde rim
  if (o.frame === 'minimap') {
    ctx.save();
    screenSpace(ctx, dpr);
    const r = Math.min(W, H) / 2;
    ctx.lineWidth = 2;
    const crackChase = !L.chase && !!L.crack?.chase;
    ctx.strokeStyle = L.chase ? pal.hyde : crackChase ? pal.crack : pal.frame;
    ctx.beginPath();
    ctx.arc(W / 2, H / 2, r - 1, 0, Math.PI * 2);
    ctx.stroke();
    if (crackChase) {
      // 15: Crackstone CHASE / ATTACK → a 2 px DOUBLE crack ring (shape differs from the Hyde's single red rim)
      ctx.beginPath();
      ctx.arc(W / 2, H / 2, r - 5, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.lineWidth = 1;
    ctx.globalAlpha = 0.4;
    ctx.strokeStyle = pal.lantern;
    ctx.beginPath();
    ctx.arc(W / 2, H / 2, r - 2.5, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }
}

/** Screen angle (radians, canvas convention: 0 = +x, π/2 = down) of north on a view — for the N notch. */
export function northScreenAngle(v: Pick<MapView, 'rotation'>): number {
  // north = world (0, −1); rotate by `rotation`: (sin r, −cos r)
  return Math.atan2(-Math.cos(v.rotation), Math.sin(v.rotation));
}
