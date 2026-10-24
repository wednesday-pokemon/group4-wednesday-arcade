// The compass + minimap feed (UX_OVERHAUL §2/§3): the PublicMapState (also handed to the Tab map) and the compass
// markers, from public sources only. Built on demand by the canvases (≤ 30 Hz, outside React render).
import type { LiveForecasts } from '../../../mystery/analytics/types.ts';
import type { CaseTheme, MapDef, Vec2 } from '../../../mystery/types.ts';
import { buildMapLayers, centroid, CRACK_LABEL_PROMOTE_S, distToPolygon, type MapLayers, type PublicMapState } from '../../../ui/mystery/map/mapData.ts';
import { headingDeg } from '../../../ui/mystery/map/mapRender.ts';
import { markerAt, type CompassMarkerIn } from './compass.ts';

export interface NavFeed {
  map: PublicMapState;
  /** Minimap layers (mode 'mini'), built once per feed. */
  layers: MapLayers;
  heading: number;
  markers: CompassMarkerIn[];
  areaName: string | null;
  showPredictions: boolean;
  highContrast: boolean;
  reducedMotion: boolean;
  /** Low graphics: the canvases draw at 15 Hz instead of 30 (CPU). */
  lowGraphics: boolean;
  /** Content key (mapFeedKey): equal keys draw identical minimap + compass images, so the canvases skip the redraw. */
  key: string;
}

export interface FeedKeyOptions {
  heardHydeBearing: number | null;
  heardCrackBearing?: number | null;
  showPredictions: boolean;
  highContrast: boolean;
  reducedMotion: boolean;
}

const FORECAST_SIG = new WeakMap<object, string>();
const INV_SIG = new WeakMap<object, string>();
/** Odds rounded to whole percent (what the map can show), memoised per forecasts object (≈ 3 new objects / s). */
function forecastSig(f: LiveForecasts | null): string {
  if (!f) return '-';
  let s = FORECAST_SIG.get(f);
  if (s === undefined) {
    s = JSON.stringify(f, (k, v) => (k === 'polygon' || k === 'topFactors' || k === 'lastChange' ? undefined : typeof v === 'number' ? Math.round(v * 100) : v));
    FORECAST_SIG.set(f, s);
  }
  return s;
}
function invSig(inv: PublicMapState['investigation']): string {
  let s = INV_SIG.get(inv);
  if (s === undefined) {
    s = JSON.stringify(inv, (k, v) => (k === 't' || k === 'hydeEmergesInS' || k === 'hydeEmergedAt' ? undefined : typeof v === 'number' ? Math.round(v * 10) : v));
    INV_SIG.set(inv, s);
  }
  return s;
}

/** While any of these runs, the key carries a 30 Hz time bucket (the drawing changes every frame). */
function animating(s: PublicMapState): boolean {
  const t = s.t;
  for (const f of s.flashes) if (t - f.t0 >= 0 && t - f.t0 < 1.3) return true;
  for (const id in s.areaDoneAt) {
    const d = t - s.areaDoneAt[id]!;
    if (d >= 0 && d < 1.6) return true;
  }
  const ls = s.investigation.lastHydeSighting;
  if (ls && t - ls.t < 8.2) return true; // fading claw outline
  const lc = s.investigation.lastCrackstoneSighting;
  if (s.crack && lc && t - lc.t < 8.2) return true; // fading hat outline
  if (s.crack && (s.crack.curse || s.crack.scan)) return true; // wind-up / scan progress rings
  if (s.world && s.seenHazards.length) {
    for (const h of s.world.hazards) if (h.kind === 'searchlight' && s.seenHazards.includes(h.id)) return true; // rotating beam
  }
  return false;
}

const r1 = (v: number) => Math.round(v * 10);

/**
 * Everything the minimap + compass draw, quantised to what is visible: position 0.1 m, heading 0.5°, odds 1 %, plus a
 * time bucket while something animates and once per second as a safety net. Pure (unit-tested).
 */
export function mapFeedKey(s: PublicMapState, o: FeedKeyOptions): string {
  const p = s.player;
  const c = s.crack;
  const promoted = c && c.announcedAt !== null && s.t - c.announcedAt >= 0 && s.t - c.announcedAt < CRACK_LABEL_PROMOTE_S;
  const tgt = s.target;
  const rt = s.route;
  const end = rt && rt.length ? rt[rt.length - 1]! : null;
  return [
    r1(p.x), r1(p.z), Math.round(headingDeg(p.yaw) * 2), p.stance, p.crouched ? 1 : 0, Math.round(p.noiseRadiusM * 2), p.noiseBand,
    s.objective, s.cluesFound.length, s.eggState, s.eggMarker ? `${r1(s.eggMarker.x)},${r1(s.eggMarker.z)},${s.eggMarker.kind}` : '-',
    s.hyde ? `${r1(s.hyde.x)},${r1(s.hyde.z)},${s.hyde.mode}` : '-',
    c ? `${c.marker ? `${r1(c.marker.x)},${r1(c.marker.z)},${Math.round(c.marker.yaw * 20)},${c.marker.kind}` : '-'},${c.chase ? 1 : 0},${promoted ? 1 : 0}` : '-',
    s.openWalls.length, s.seenHazards.length, s.leverSeen ? 1 : 0, s.showSwitch ? 1 : 0, s.visitedAreas.length,
    s.hint.level, s.hint.areaId ?? '', tgt ? `${r1(tgt.x)},${r1(tgt.z)},${tgt.label}` : '-',
    rt ? `${rt.length},${end ? `${r1(end.x)},${r1(end.z)}` : ''}` : '-',
    forecastSig(s.forecasts), invSig(s.investigation),
    o.heardHydeBearing ?? '-', o.heardCrackBearing ?? '-', o.showPredictions ? 1 : 0, o.highContrast ? 1 : 0, o.reducedMotion ? 1 : 0,
    animating(s) ? Math.floor(s.t * 30) : 0, Math.floor(s.t),
  ].join('|');
}

const LANDMARK_NEAR_M = 45;
/** "CURSED" toward Crackstone's area while its centroid is this close and the player is outside it. */
export const CURSED_MARKER_M = 60;

export function landmarkText(kind: MapDef['landmarks'][number]['kind'], theme: CaseTheme | null): string | null {
  switch (kind) {
    case 'pier': return 'PIER';
    case 'crypt': return 'CRYPT';
    case 'research_hall': return theme === 'signal' ? 'CONTROL' : theme === 'crypt' ? 'HALL' : 'ARCHIVE';
    case 'greenhouse': return 'GREENHOUSE';
    case 'egg_shrine': return 'SHRINE';
    case 'gate': return 'GATE';
    default: return null; // lamps; the tower has its own marker
  }
}

/** Area (case world) or room the player stands in — the minimap chip. */
export function areaNameAt(s: PublicMapState): string | null {
  const p = s.player;
  const area = s.world?.areas.find((a) => Math.hypot(a.x - p.x, a.z - p.z) <= a.radiusM);
  if (area) return area.name;
  for (const r of s.geometry.rooms) {
    if (r.id === 'path') continue;
    const xs = r.polygon.map((v) => v.x);
    const zs = r.polygon.map((v) => v.z);
    if (p.x >= Math.min(...xs) && p.x <= Math.max(...xs) && p.z >= Math.min(...zs) && p.z <= Math.max(...zs)) return r.name;
  }
  return null;
}

/**
 * Compass markers from the public map state (+ the heard-Hyde / heard-Crackstone bearings, which a directional caption
 * already gave away). Crackstone's hat only per R4 (s.crack.marker), never truth-based.
 */
export function compassMarkers(
  s: PublicMapState, L: MapLayers,
  o: { heardHydeBearing: number | null; heardCrackBearing?: number | null; showPredictions: boolean; forecasts: LiveForecasts | null },
): CompassMarkerIn[] {
  const me: Vec2 = { x: s.player.x, z: s.player.z };
  const out: CompassMarkerIn[] = [];
  const towerIsObjective = s.objective === 'deliver_egg' || s.objective === 'accuse';
  const t = markerAt(me, L.tower);
  out.push({ id: 'tower', kind: 'tower', ...t, name: 'Iago Tower', lantern: towerIsObjective });
  if (s.target && s.target.kind !== 'tower') out.push({ id: 'objective', kind: 'objective', ...markerAt(me, s.target), name: s.target.label, lantern: true });
  if (s.objective === 'find_clues') {
    for (const a of L.areas) {
      if (a.state === 'done') continue;
      if (s.target && s.target.kind === 'area' && Math.hypot(s.target.x - a.x, s.target.z - a.z) < 1) continue;
      out.push({ id: `area:${a.id}`, kind: 'area', ...markerAt(me, a), name: a.name, lantern: a.state === 'focus' });
    }
  }
  const eggOdds = s.objective === 'find_egg' || !!o.forecasts?.egg?.lastChange;
  if (eggOdds) {
    for (const e of L.eggSites) {
      if (e.state === 'checked') continue;
      out.push({ id: `egg:${e.id}`, kind: 'egg', ...markerAt(me, e), lantern: false, filled: e.state === 'seen', pct: e.cell && (o.showPredictions || e.cell.fact) ? e.cell.text : null });
    }
  }
  const theme = s.world?.theme ?? null;
  const near = s.geometry.landmarks
    .map((lm) => ({ lm, text: landmarkText(lm.kind, theme), d: Math.hypot(lm.x - me.x, lm.z - me.z) }))
    .filter((x) => x.text && x.d <= LANDMARK_NEAR_M)
    .sort((a, b) => a.d - b.d)
    .slice(0, 2);
  for (const n of near) out.push({ id: `lm:${n.lm.id}`, kind: 'landmark', ...markerAt(me, n.lm), name: n.text, lantern: false });
  if (s.hyde) out.push({ id: 'hyde', kind: 'hyde_seen', ...markerAt(me, s.hyde), lantern: false, chasing: s.hyde.mode === 'chase' });
  else if (o.heardHydeBearing !== null) out.push({ id: 'hyde_heard', kind: 'hyde_heard', bearing: o.heardHydeBearing, distanceM: null, lantern: false });
  const c = s.crack;
  if (c) {
    if (c.marker) out.push({ id: 'crack', kind: 'crack_seen', ...markerAt(me, c.marker), lantern: false, chasing: c.marker.kind === 'chase' || c.marker.kind === 'attack' });
    else if (o.heardCrackBearing !== null && o.heardCrackBearing !== undefined) out.push({ id: 'crack_heard', kind: 'crack_heard', bearing: o.heardCrackBearing, distanceM: null, lantern: false });
    if (c.area.polygon.length >= 3 && distToPolygon(c.area.polygon, me.x, me.z) > 0) {
      const ce = centroid(c.area.polygon);
      const at = markerAt(me, ce);
      if (at.distanceM <= CURSED_MARKER_M) out.push({ id: 'cursed_area', kind: 'cursed_area', ...at, name: 'CURSED', lantern: false });
    }
  }
  return out;
}

export function buildNavFeed(
  s: PublicMapState,
  o: { heardHydeBearing: number | null; heardCrackBearing?: number | null; showPredictions: boolean; highContrast: boolean; reducedMotion: boolean; lowGraphics?: boolean },
  key: string = mapFeedKey(s, o),
): NavFeed {
  const layers = buildMapLayers(s, 'mini');
  return {
    map: s,
    layers,
    heading: headingDeg(s.player.yaw),
    markers: compassMarkers(s, layers, { heardHydeBearing: o.heardHydeBearing, heardCrackBearing: o.heardCrackBearing ?? null, showPredictions: o.showPredictions, forecasts: s.forecasts }),
    areaName: areaNameAt(s),
    showPredictions: o.showPredictions,
    highContrast: o.highContrast,
    reducedMotion: o.reducedMotion,
    lowGraphics: !!o.lowGraphics,
    key,
  };
}
