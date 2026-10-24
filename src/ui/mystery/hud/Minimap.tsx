// Heading-up minimap (UX_OVERHAUL §3): ⌀224 at 1366 (rem-scaled), fixed 28 m radius (4 px/m), player arrow fixed at
// the centre pointing up, the N notch riding the rim, a current-area chip over the bottom rim. Drawn by MapCanvas in
// its own rAF at ≤ 30 Hz (15 Hz in low graphics; outside React render) from the public nav feed.
import { useRef } from 'react';
import type { NavFeed } from '../../../app/mystery/hud/navFeed.ts';
import { MapCanvas, type MapFrame } from '../map/MapCanvas.tsx';
import { LOW_GRAPHICS_FPS } from './Compass.tsx';
import { drawSprite, MAP_PALETTE, MAP_PALETTE_HC, MINIMAP_PX_PER_M, MINIMAP_RADIUS_M, northScreenAngle, textSprite, type MapView } from '../map/mapRender.ts';

const SPEC_DIAMETER = 224;

export function Minimap({ feed }: { feed: () => NavFeed | null }) {
  const chip = useRef<HTMLSpanElement | null>(null);
  const last = useRef<{ f: NavFeed | null }>({ f: null });

  const frame = (): MapFrame | null => {
    const f = feed();
    last.current.f = f;
    if (!f) return null;
    const p = f.map.player;
    const el = chip.current;
    if (el) {
      const text = f.areaName ?? '';
      if (el.textContent !== text) el.textContent = text;
      el.hidden = !text;
    }
    return {
      // 28 m on the radius at any size: ⌀224 → 4 px/m (spec), ⌀315 at 1920×1080 → 5.6 px/m
      view: { center: { x: p.x, z: p.z }, rotation: p.yaw, pxPerM: MINIMAP_PX_PER_M, shape: 'circle' },
      fit: { radiusM: MINIMAP_RADIUS_M },
      layers: f.layers,
      key: f.key,
      ...(f.lowGraphics ? { fps: LOW_GRAPHICS_FPS } : {}),
      opts: {
        layers: { zones: true, egg: true, clues: true, crack: true }, showPredictions: f.showPredictions, labelBudget: 4,
        highContrast: f.highContrast, reducedMotion: f.reducedMotion, frame: 'minimap',
      },
    };
  };

  return (
    <div className="mhud-minimap" data-testid="hud-minimap" aria-hidden="true">
      <MapCanvas frame={frame} overlay={(ctx, view, dpr) => drawNotch(ctx, view, dpr, last.current.f?.highContrast ?? false)} className="mhud-minimap__canvas" />
      <span ref={chip} className="mhud-minimap__chip" hidden />
    </div>
  );
}

function drawNotch(ctx: CanvasRenderingContext2D, view: MapView, dpr: number, hc: boolean): void {
  const pal = hc ? MAP_PALETTE_HC : MAP_PALETTE;
  const W = view.size.w;
  const H = view.size.h;
  const r = Math.min(W, H) / 2;
  const a = northScreenAngle(view);
  const k = (2 * r) / SPEC_DIAMETER;
  const x = W / 2 + Math.cos(a) * (r - 9 * k);
  const y = H / 2 + Math.sin(a) * (r - 9 * k);
  ctx.save();
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = pal.lantern;
  ctx.beginPath();
  ctx.arc(x, y, 9 * k, 0, Math.PI * 2);
  ctx.fill();
  const px = Math.max(12, 14 * k);
  const sp = textSprite(`700 ${px}px Cinzel, Georgia, serif`, px, 'N', pal.bg, null, dpr);
  if (sp) drawSprite(ctx, sp, x, y + 1, 'center');
  ctx.restore();
}
