// Tab overlay column 2: the NORTH-UP investigation map (UX_OVERHAUL §4). A thin adapter over frontend A's shared map
// renderer (map/mapData.ts → buildMapLayers(state, 'full'); map/MapCanvas.tsx → drawMap): same encodings as the
// minimap plus every room / zone / area name and %. Layer toggles 1/2/3 come from the overlay; an odds row hover /
// a focused locked slot arrives as `highlight` (drawn as a lantern ring), and hovering the map reports the item under
// the pointer back (`onHover`) so the matching odds row lights up. PUBLIC data only (PublicMapState has no hidden
// truth). The canvas is aria-hidden: the evidence slots and THE ODDS lists are the text equivalent.
import { useCallback, useRef } from 'react';
import type { MapRef } from './investigationView.ts';
import { MapCanvas, type MapFrame } from './map/MapCanvas.tsx';
import { buildMapLayers, type MapLayers as DrawLayers, type PublicMapState } from './map/mapData.ts';
import { fitView, screenToWorld, worldToScreen, type MapView } from './map/mapRender.ts';

/** `crack` = toggle 4 (Crackstone stipple + cursed area), only offered in cases with him. */
export interface MapLayers { zones: boolean; egg: boolean; clues: boolean; crack?: boolean; slurp?: boolean }

export interface InvestigationMapProps {
  state: PublicMapState | null;
  layers: MapLayers;
  /** Map items to ring in lantern (odds-row hover, locked-slot focus); the first one is drawn. */
  highlight: readonly MapRef[];
  onHover: (ref: MapRef | null) => void;
  /** Settings → "Predictions": off hides zone tints and % labels. */
  showPredictions: boolean;
}

const PAD_PX = 8;
const HIT_PX = 14;

/** 'egg:<id>' etc. — the renderer's highlight id for a MapRef (the tower has no ring). */
export function highlightId(ref: MapRef | undefined): string | null {
  if (!ref || ref.kind === 'tower') return null;
  return `${ref.kind}:${ref.id}`;
}

function inPoly(poly: readonly { x: number; z: number }[], x: number, z: number): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]!;
    const b = poly[j]!;
    if (a.z > z !== b.z > z && x < ((b.x - a.x) * (z - a.z)) / (b.z - a.z) + a.x) inside = !inside;
  }
  return inside;
}

/** The map item under a screen point (CSS px): egg site › spawn › clue area › Hyde zone (pure; layer-aware). */
export function hitTest(L: DrawLayers, view: MapView, q: { x: number; y: number }, layers: MapLayers): MapRef | null {
  const near = (p: { x: number; z: number }, r = HIT_PX) => {
    const s = worldToScreen(view, p);
    return Math.hypot(s.x - q.x, s.y - q.y) <= r;
  };
  if (layers.egg) for (const e of L.eggSites) if (near(e)) return { kind: 'egg', id: e.id };
  if (layers.zones) for (const s of L.spawns) if (near(s, Math.max(HIT_PX, 4 * view.pxPerM))) return { kind: 'spawn', id: s.id };
  const w = screenToWorld(view, q);
  if (layers.clues) {
    for (const a of L.areas) {
      if (a.state === 'done') continue;
      if (Math.hypot(w.x - a.x, w.z - a.z) <= a.radiusM) return { kind: 'area', id: a.id };
    }
  }
  if (layers.zones) for (const z of L.zones) if (inPoly(z.polygon, w.x, w.z)) return { kind: 'zone', id: z.id };
  return null;
}

/** High contrast / reduced motion are mirrored as classes on <html> by app/settings.ts (read at draw time). */
function rootFlag(cls: string): boolean {
  return typeof document !== 'undefined' && document.documentElement.classList.contains(cls);
}

export function InvestigationMap({ state, layers, highlight, onHover, showPredictions }: InvestigationMapProps) {
  const box = useRef<HTMLDivElement | null>(null);
  const cache = useRef<{ state: PublicMapState; layers: DrawLayers } | null>(null);
  const lastView = useRef<MapView | null>(null);
  const lastHover = useRef<string | null>(null);
  const live = useRef({ state, layers, highlight, showPredictions });
  live.current = { state, layers, highlight, showPredictions };

  const layersFor = (s: PublicMapState): DrawLayers => {
    if (cache.current?.state !== s) cache.current = { state: s, layers: buildMapLayers(s, 'full') };
    return cache.current.layers;
  };

  const frame = useCallback((): MapFrame | null => {
    const { state: s, layers: on, highlight: hi, showPredictions: preds } = live.current;
    const el = box.current;
    if (!s || !el) return null;
    const size = { w: el.clientWidth, h: el.clientHeight };
    if (size.w < 2 || size.h < 2) return null;
    const full = fitView(s.geometry.bounds, size, PAD_PX);
    lastView.current = full;
    const { size: _omit, ...view } = full;
    void _omit;
    // A locked slot asks for its clue's candidate sites; fall back to its first area when no site pip is drawn.
    const want = hi[0];
    let id = highlightId(want);
    const L = layersFor(s);
    if (want?.kind === 'area' && hi.length > 1) id = highlightId(hi.find((r) => L.areas.some((a) => a.id === r.id && a.state !== 'done')) ?? want);
    return {
      view,
      layers: L,
      opts: {
        layers: on,
        showPredictions: preds,
        labelBudget: 40,
        highContrast: rootFlag('high-contrast'),
        reducedMotion: rootFlag('reduced-motion'),
        highlight: id,
      },
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const report = (ref: MapRef | null) => {
    const key = ref ? `${ref.kind}:${ref.id}` : null;
    if (key === lastHover.current) return;
    lastHover.current = key;
    onHover(ref);
  };

  return (
    <div
      ref={box}
      className="inv-map"
      data-testid="inv-map"
      data-ready={state ? 'true' : 'false'}
      onMouseMove={(e) => {
        const s = live.current.state;
        const v = lastView.current;
        if (!s || !v || !box.current) return;
        const r = box.current.getBoundingClientRect();
        report(hitTest(layersFor(s), v, { x: e.clientX - r.left, y: e.clientY - r.top }, live.current.layers));
      }}
      onMouseLeave={() => report(null)}
    >
      {state ? (
        <MapCanvas frame={frame} fps={15} className="inv-map__canvas" data-testid="inv-map-canvas" />
      ) : (
        <p className="inv-map__empty">Map appears once the island is loaded.</p>
      )}
    </div>
  );
}
