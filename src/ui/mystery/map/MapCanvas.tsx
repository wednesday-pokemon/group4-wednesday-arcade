// React wrapper for drawMap (./mapRender.ts): sizes the backing store to CSS px × devicePixelRatio, redraws on resize,
// and pulls a frame at ≤ `fps` from `frame()` in its own requestAnimationFrame loop — outside React render, so the
// minimap tracks the camera without re-rendering the HUD tree. Decorative for assistive tech (aria-hidden): the text
// equivalents are the ObjectivePanel, the Odds panel and the Tab lists.
import { useEffect, useRef } from 'react';
import { drawMap, fitView, type DrawOptions, type MapView } from './mapRender.ts';
import type { MapGeometry, MapLayers } from './mapData.ts';

export interface MapFrame {
  /** View without size: MapCanvas fills in the element's CSS size. */
  view: Omit<MapView, 'size'>;
  layers: MapLayers;
  opts: Omit<DrawOptions, 'dpr' | 'remPx'>;
  /**
   * Scale to the element: `{ radiusM }` keeps that many metres on the radius (minimap: 28 m at any size);
   * `{ bounds, padPx? }` fits the whole island north-up (Tab map). Without it, `view.pxPerM` is used as given.
   */
  fit?: { radiusM: number } | { bounds: MapGeometry['bounds']; padPx?: number };
  /**
   * Content key: when it equals the last drawn key (and the canvas size did not change) the redraw is skipped — the
   * canvas keeps its image. Producers include a time bucket while anything animates.
   */
  key?: string;
  /** Lower the draw rate for the next frames (low graphics: 15 Hz); never above the component's `fps`. */
  fps?: number;
}

export interface MapCanvasProps {
  /** Called at ≤ fps; return null to keep the last image. */
  frame: () => MapFrame | null;
  fps?: number;
  className?: string;
  /** Extra draw after the map (screen space, CSS px) — e.g. the minimap's N notch. */
  overlay?: (ctx: CanvasRenderingContext2D, view: MapView, dpr: number) => void;
  'data-testid'?: string;
}

export function MapCanvas({ frame, fps = 30, className, overlay, ...rest }: MapCanvasProps) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  const frameRef = useRef(frame);
  frameRef.current = frame;
  const overlayRef = useRef(overlay);
  overlayRef.current = overlay;

  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    const ctx = cv.getContext('2d');
    if (!ctx) return;
    let size = { w: 0, h: 0 };
    let dpr = 1;
    let remPx = 16;
    let lastKey: string | null = null;
    const resize = () => {
      lastKey = null; // resizing clears the backing store: always redraw
      const r = cv.getBoundingClientRect();
      dpr = Math.min(3, window.devicePixelRatio || 1);
      size = { w: Math.max(1, r.width), h: Math.max(1, r.height) };
      cv.width = Math.round(size.w * dpr);
      cv.height = Math.round(size.h * dpr);
      remPx = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
      draw();
    };
    let cap = fps;
    const draw = () => {
      const f = frameRef.current();
      if (!f || size.w <= 1) return;
      cap = f.fps !== undefined ? Math.min(fps, Math.max(1, f.fps)) : fps;
      if (f.key !== undefined && f.key === lastKey) return; // nothing visible changed
      lastKey = f.key ?? null;
      let view: MapView = { ...f.view, size };
      if (f.fit && 'radiusM' in f.fit) view = { ...view, pxPerM: Math.min(size.w, size.h) / 2 / f.fit.radiusM };
      else if (f.fit && 'bounds' in f.fit) view = { ...fitView(f.fit.bounds, size, f.fit.padPx ?? 0), shape: f.view.shape };
      drawMap(ctx, view, f.layers, { ...f.opts, dpr, remPx });
      overlayRef.current?.(ctx, view, dpr);
    };
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(resize) : null;
    ro?.observe(cv);
    resize();
    let last = 0;
    let raf = 0;
    const tick = (now: number) => {
      if (now - last >= 1000 / Math.max(1, cap) - 2) {
        last = now;
        try {
          draw();
        } catch (err) {
          console.warn('[map] draw failed', err);
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

  return <canvas ref={ref} className={className} aria-hidden="true" data-testid={rest['data-testid']} />;
}
