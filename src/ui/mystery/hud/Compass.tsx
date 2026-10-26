// Compass strip (UX_OVERHAUL §2): 464×36 at 1366 (rem-scaled), 150° arc, heading = the player/camera yaw. Canvas drawn
// in its own rAF at ≤ 30 Hz (15 Hz in low graphics) from `feed()` (outside React render). aria-hidden: the
// ObjectivePanel and Odds carry the same information as text. Text widths come from a cache (mapRender textWidth).
// Joseph Crackstone (UX_ENEMIES §4): filled crack hat per R4, hat outline after a directional caption, "CURSED" text.
import { useEffect, useRef } from 'react';
import { CompassClamp, layoutCompass, type CompassMarker } from '../../../app/mystery/hud/compass.ts';
import type { NavFeed } from '../../../app/mystery/hud/navFeed.ts';
import { MAP_PALETTE, MAP_PALETTE_HC, claw, diamond, drawSprite, eggShape, hat, slurpGlyph, textSprite, textWidthFor, tower } from '../map/mapRender.ts';

/** Low graphics: the strip redraws at this rate (CPU). */
export const LOW_GRAPHICS_FPS = 15;

export function Compass({ feed, fps = 30 }: { feed: () => NavFeed | null; fps?: number }) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  const feedRef = useRef(feed);
  feedRef.current = feed;

  useEffect(() => {
    const cv = ref.current;
    const ctx = cv?.getContext('2d');
    if (!cv || !ctx) return;
    const clamp = new CompassClamp();
    let w = 0;
    let h = 0;
    let dpr = 1;
    let rem = 16;
    let lastKey: string | null = null;
    const resize = () => {
      lastKey = null; // the backing store was cleared: redraw
      const r = cv.getBoundingClientRect();
      dpr = Math.min(3, window.devicePixelRatio || 1);
      w = Math.max(1, r.width);
      h = Math.max(1, r.height);
      cv.width = Math.round(w * dpr);
      cv.height = Math.round(h * dpr);
      rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
    };
    let low = false;
    const draw = () => {
      const f = feedRef.current();
      if (!f || w <= 1) return;
      low = f.lowGraphics;
      if (f.key === lastKey) return; // same heading (±0.5°), position (±0.1 m), markers, odds: keep the image
      lastKey = f.key;
      drawCompass(ctx, f, w, h, dpr, rem, clamp);
    };
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => {
      resize();
      draw();
    }) : null;
    ro?.observe(cv);
    resize();
    let raf = 0;
    let last = 0;
    const tick = (now: number) => {
      const gap = 1000 / (low ? Math.min(fps, LOW_GRAPHICS_FPS) : fps);
      if (now - last >= gap - 2) {
        last = now;
        try {
          draw();
        } catch (err) {
          console.warn('[compass] draw failed', err);
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      ro?.disconnect();
    };
  }, [fps]);

  return (
    <div className="mhud-compass" data-testid="hud-compass" aria-hidden="true">
      <canvas ref={ref} />
    </div>
  );
}

function drawCompass(ctx: CanvasRenderingContext2D, f: NavFeed, w: number, h: number, dpr: number, rem: number, clamp: CompassClamp): void {
  const pal = f.highContrast ? MAP_PALETTE_HC : MAP_PALETTE;
  const k = w / 464; // the spec's px at 1366 → current scale
  const fsSm = Math.max(15, rem * 1.0625);
  const fsXs = Math.max(14, rem * 0.9375);
  const fontXs = `600 ${fsXs}px 'Alegreya Sans', sans-serif`;
  const fontSm = `600 ${fsSm}px Cinzel, Georgia, serif`;
  const L = layoutCompass(f.heading, f.markers, w, clamp, (t) => textWidthFor(ctx, fontXs, t), 14 * k);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  const mid = h * 0.5;

  // ticks on the bottom edge: minor 15° (4 px, 1 px, muted α.6); major 45° (8 px, 1.5 px, text-2)
  for (const t of L.ticks) {
    ctx.strokeStyle = t.major ? pal.text2 : pal.muted;
    ctx.globalAlpha = t.major ? 1 : 0.6;
    ctx.lineWidth = t.major ? 1.5 : 1;
    ctx.beginPath();
    ctx.moveTo(t.x, h);
    ctx.lineTo(t.x, h - (t.major ? 8 : 4) * k);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;

  // letters: N E S W Cinzel 600 fs-sm (N lantern), intercardinals fs-xs muted — cached bitmaps (no per-frame fillText)
  for (const l of L.letters) {
    if (l.hidden) continue;
    const color = l.text === 'N' ? pal.lantern : l.cardinal ? pal.text : pal.muted;
    const sp = textSprite(l.cardinal ? fontSm : fontXs, l.cardinal ? fsSm : fsXs, l.text, color, null, dpr);
    if (sp) drawSprite(ctx, sp, l.x, mid, 'center');
  }

  // markers (12–16 px glyphs on the letter line) — landmarks first so glyphs sit on top
  const sorted = [...L.markers].sort((a, b) => order(a) - order(b));
  for (const m of sorted) drawMarker(ctx, m, mid, k, fsXs, fontXs, pal, dpr);

  // centre index: 1 px text α.5 hairline full height + 8 px lantern caret (y 4–12)
  ctx.strokeStyle = pal.text;
  ctx.globalAlpha = 0.5;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(w / 2, 0);
  ctx.lineTo(w / 2, h);
  ctx.stroke();
  ctx.globalAlpha = 1;
  ctx.fillStyle = pal.lantern;
  ctx.beginPath();
  ctx.moveTo(w / 2 - 5 * k, 4 * k);
  ctx.lineTo(w / 2 + 5 * k, 4 * k);
  ctx.lineTo(w / 2, 12 * k);
  ctx.closePath();
  ctx.fill();
}

const order = (m: CompassMarker) => (m.kind === 'landmark' || m.kind === 'cursed_area' ? 0 : m.kind === 'area' || m.kind === 'egg' ? 1 : m.kind === 'tower' ? 2 : 3);

function drawMarker(ctx: CanvasRenderingContext2D, m: CompassMarker, y: number, k: number, fs: number, font: string, pal: typeof MAP_PALETTE, dpr: number): void {
  ctx.save();
  // haloed label from the sprite cache (same look as strokeText + fillText, drawn as one bitmap)
  const halo = (text: string, x: number, color: string, align: 'left' | 'center' | 'right' = 'left') => {
    const sp = textSprite(font, fs, text, color, pal.bg, dpr);
    if (sp) drawSprite(ctx, sp, x, y, align);
  };
  const s = 14 * k;
  if (m.kind === 'landmark' || m.kind === 'cursed_area') {
    halo(m.label ?? '', m.x, m.kind === 'cursed_area' ? pal.crackText : pal.muted, 'center');
    ctx.restore();
    return;
  }
  if (m.clamped) {
    // half-diamond + chevron + distance at the end the shortest turn points to
    const dir = m.clamped === 'left' ? -1 : 1;
    ctx.fillStyle = pal.lantern;
    ctx.beginPath();
    ctx.moveTo(m.x, y - 7 * k);
    ctx.lineTo(m.x - dir * 7 * k, y);
    ctx.lineTo(m.x, y + 7 * k);
    ctx.closePath();
    ctx.fill();
    halo(m.clamped === 'left' ? '◂' : '▸', m.x + dir * 10 * k, pal.lantern, 'center');
    if (m.label) halo(m.label, m.x + dir * 18 * k, pal.lantern, m.clamped === 'left' ? 'left' : 'right');
    ctx.restore();
    return;
  }
  const color = m.lantern ? pal.lantern : m.kind === 'area' ? pal.violet : m.kind === 'egg' ? pal.ivory : m.kind === 'tower' ? pal.text2
    : m.kind.startsWith('hyde') ? pal.hyde : m.kind.startsWith('crack') ? pal.crack : m.kind.startsWith('slurp') ? pal.slurp : pal.text;
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = 1.5;
  switch (m.kind) {
    case 'objective':
      diamond(ctx, m.x, y, s / 2);
      ctx.fill();
      ctx.strokeStyle = pal.bg;
      ctx.stroke();
      break;
    case 'area':
      ctx.setLineDash(m.lantern ? [] : [2.5, 2]);
      diamond(ctx, m.x, y, (12 * k) / 2);
      ctx.fillStyle = pal.bg;
      ctx.fill();
      ctx.stroke();
      ctx.setLineDash([]);
      break;
    case 'egg':
      eggShape(ctx, m.x, y, 12 * k);
      if (m.filled) ctx.fill();
      else {
        ctx.fillStyle = pal.bg;
        ctx.fill();
        ctx.stroke();
      }
      break;
    case 'tower':
      tower(ctx, m.x, y, s, color);
      break;
    case 'hyde_seen':
      claw(ctx, m.x, y, s, true, pal.hyde);
      break;
    case 'hyde_heard':
      claw(ctx, m.x, y, 12 * k, false, pal.hyde);
      break;
    case 'crack_seen':
      hat(ctx, m.x, y, s * 1.15, true, pal.crack);
      break;
    case 'crack_heard':
      hat(ctx, m.x, y, s * 1.15, false, pal.crack);
      break;
    case 'slurp_seen':
      slurpGlyph(ctx, m.x, y, s * 1.1, true, pal.slurp);
      break;
    case 'slurp_heard':
      slurpGlyph(ctx, m.x, y, s * 1.1, false, pal.slurp);
      break;
    default:
      break;
  }
  if (m.label) {
    const gap = s / 2 + 3;
    halo(m.label, m.labelSide === 'right' ? m.x + gap : m.x - gap, color, m.labelSide === 'right' ? 'left' : 'right');
  }
  ctx.restore();
}
