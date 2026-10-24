// Map view-model shared by the HUD minimap (heading-up) and the Tab investigation map (north-up) — UX_OVERHAUL §3/§4.
//
// HIDDEN-UNTIL-JUSTIFIED: everything here is built from PUBLIC inputs only — the map geometry WITHOUT the session's
// hidden truth (`MapGeometry` has no `clues` / `eggSpawn`), the case world (design data: areas, candidate sites, zones),
// `run.investigation()` (what the player observed), the analytics `LiveForecasts`, and positions the rules make public
// (a visible / chasing Hyde, a carried / dropped / power-revealed egg, hint targets). It must never read MapDef.clues,
// MapDef.eggSpawn or the SessionLayout (tests/unit/mystery-app/mapHud.test.ts scans this folder for those reads).
// Joseph Crackstone (UX_ENEMIES §3): his cursed AREA is public; his position arrives in `crack.marker` only per R4
// (src/app/mystery/hud/crackstone.ts crackMapState), and the scan ring only together with that marker.
import type { LiveForecasts } from '../../../mystery/analytics/types.ts';
import type {
  CaseWorldDef, ClueId, EggState, HazardDef, InvestigationState, MapDef, Objective, Stance, Vec2,
} from '../../../mystery/types.ts';
import { searchlightYaw } from '../../../mystery/hazards.ts';
import type { CrackMapState, CrackMarkerKind } from '../../../app/mystery/hud/crackstone.ts';
import { oddsCells, pctText, roundPct, type OddsCell } from '../odds.ts';

/** run.map minus the session's hidden truth: the type has no `clues` / `eggSpawn`, so map code cannot read them. */
export type MapGeometry = Pick<MapDef, 'id' | 'bounds' | 'walls' | 'cover' | 'hidingSpots' | 'rooms' | 'tower' | 'landmarks' | 'powerSwitch'>;

/** Copy only the public geometry fields of a map (call once per run; the arrays are shared, not cloned). */
export function mapGeometry(map: MapGeometry): MapGeometry {
  return {
    id: map.id, bounds: map.bounds, walls: map.walls, cover: map.cover, hidingSpots: map.hidingSpots, rooms: map.rooms,
    tower: map.tower, landmarks: map.landmarks, ...(map.powerSwitch ? { powerSwitch: map.powerSwitch } : {}),
  };
}

export type NoiseBandName = 'silent' | 'quiet' | 'audible' | 'loud';

/** Lantern objective marker (tower while carrying, dropped egg, advice / hint target). */
export interface MapTarget { x: number; z: number; label: string; kind?: 'tower' | 'egg' | 'area' | 'site' | 'advice' }

/**
 * Everything a map may show, already filtered by the rules. PlayView builds it at ≤ 30 Hz for the minimap and passes
 * the same shape to the Tab overlay (frontend B) as `mapState`.
 */
export interface PublicMapState {
  /** Sim seconds (searchlight beam angle, fades, flashes). */
  t: number;
  geometry: MapGeometry;
  world: CaseWorldDef | null;
  investigation: InvestigationState;
  forecasts: LiveForecasts | null;
  cluesFound: readonly ClueId[];
  objective: Objective;
  player: { x: number; z: number; yaw: number; stance: Stance; crouched: boolean; noiseRadiusM: number; noiseBand: NoiseBandName };
  eggState: EggState;
  /** Public egg position: dropped (the player saw it fall) or shown by a reveal power. Never a hidden resting egg. */
  eggMarker: { x: number; z: number; kind: 'dropped' | 'revealed' } | null;
  /** The Hyde's position ONLY while the player can see it or it is chasing; null otherwise. */
  hyde: { x: number; z: number; mode: 'visible' | 'chase' } | null;
  /** Gate / passage walls currently open. */
  openWalls: readonly string[];
  /** Hazards the player has seen (≤ 12 m with line of sight) or that a reveal power outlined. */
  seenHazards: readonly string[];
  /** The passage lever was seen (≤ 12 m, LOS). */
  leverSeen: boolean;
  /** Gomez's switch: only for duos whose abilities include `power_switch`. */
  showSwitch: boolean;
  /** Progressive hint ladder (R7): L2 highlights an area (16 s), L3 a likely site + route (10 s). */
  hint: { level: 0 | 1 | 2 | 3; areaId: string | null; target: MapTarget | null };
  /** Current lantern objective marker, null in find_clues (areas only — no autopilot). */
  target: MapTarget | null;
  /** Dotted lantern route (deliver_egg / retrieve_egg / hint L3 only). */
  route: Vec2[] | null;
  /** Areas the player has been inside (Tab map shows their candidate pips). */
  visitedAreas: readonly string[];
  /** Sim time an area became "nothing left" (check badge 1.5 s, then a faint outline). */
  areaDoneAt: Readonly<Record<string, number>>;
  /** One-shot effects: passage gap flash (1.2 s), reveal pulse ring (600 ms). */
  flashes: readonly { kind: 'passage' | 'reveal'; x: number; z: number; t0: number; wallId?: string }[];
  /** Joseph Crackstone (absent / null = no Crackstone in this case: nothing of him is drawn). */
  crack?: CrackMapState | null;
}

export type MapMode = 'mini' | 'full';

export interface MapLabel {
  x: number;
  z: number;
  text: string;
  /** Lower = more important (objective 0 · egg % 1 · area % 2 · zone % 3 · rooms 4). */
  priority: number;
  color: 'lantern' | 'violet' | 'ivory' | 'hyde' | 'muted' | 'text' | 'crack';
  /** Small glyph drawn left of the text (Crackstone's own-cell % label). */
  glyph?: 'hat';
  /** Pixel offset (screen space, after projection) — e.g. "inside the top edge" of an area circle. */
  dy?: number;
  /** Area radius in metres: the label sits inside its top edge. */
  insideTopR?: number;
  id?: string;
}

export interface MapLayers {
  geometry: MapGeometry;
  /** Walls that can open (passage, powered gate) — drawn dynamically, not pre-rendered. */
  dynamicWalls: { id: string; a: Vec2; b: Vec2; style: 'wall' | 'gate'; open: boolean }[];
  zones: { id: string; name: string; polygon: Vec2[]; p: number; cell: OddsCell; own: boolean }[];
  spawns: { id: string; name: string; x: number; z: number; p: number; cell: OddsCell }[];
  hazards: ({ kind: 'floor'; id: string; polygon: Vec2[] } | { kind: 'beam'; id: string; x: number; z: number; rangeM: number; coneDeg: number; yaw: number })[];
  areas: { id: string; name: string; x: number; z: number; radiusM: number; p: number | null; cell: OddsCell | null; state: 'open' | 'done' | 'focus'; badge: boolean }[];
  clueSites: { id: string; clueId: ClueId; areaId: string; x: number; z: number; state: 'candidate' | 'checked' }[];
  cluePins: { x: number; z: number; id: string }[];
  eggSites: { id: string; label: string; x: number; z: number; p: number | null; cell: OddsCell | null; state: 'candidate' | 'checked' | 'seen'; top: boolean }[];
  eggPin: { x: number; z: number; kind: 'seen' | 'dropped' | 'revealed' } | null;
  tower: { x: number; z: number; radius: number; objective: boolean };
  hiding: Vec2[];
  lever: Vec2 | null;
  powerSwitch: Vec2 | null;
  route: Vec2[] | null;
  objective: MapTarget | null;
  hyde: { x: number; z: number; kind: 'visible' | 'chase' | 'last'; alpha: number } | null;
  /** Joseph Crackstone's layers (null without him). */
  crack: CrackLayers | null;
  player: PublicMapState['player'];
  chase: boolean;
  flashes: PublicMapState['flashes'];
  labels: MapLabel[];
  t: number;
}

/** Crackstone layers (UX_ENEMIES §3): 3b risk stipple, 5b cursed area, 12b curse circle, 13b marker / fading hat, 15 frame. */
export interface CrackLayers {
  area: { name: string; polygon: Vec2[] };
  /** Risk cells (analytics, rule-based) with p ≥ .10, by stipple band (spacing 8 / 5 / 3 px). */
  risk: { band: 0 | 1 | 2; x: number; z: number; sizeM: number; p: number }[];
  /** Wind-up progress 0..1 (pie fill). */
  curse: { x: number; z: number; radiusM: number; progress: number } | null;
  /** Live marker per R4 (alpha 1), or the hat outline fading over 8 s at the last sighting. */
  marker: { x: number; z: number; yaw: number; coneDeg: number; kind: CrackMarkerKind | 'last'; alpha: number } | null;
  /** Scan ring (only with a live marker): progress 0..1 of the warning, `pulse` after it fired. */
  scan: { x: number; z: number; radiusM: number; progress: number; pulse: boolean } | null;
  chase: boolean;
}

/** Stipple band of a Crackstone risk p (p < .10 is not drawn). */
export function crackBand(p: number): 0 | 1 | 2 | null {
  if (!(p >= 0.1)) return null;
  return p < 0.3 ? 0 : p < 0.6 ? 1 : 2;
}

/** Distance (m) from a point to a polygon (0 inside). */
export function distToPolygon(poly: readonly Vec2[], x: number, z: number): number {
  if (poly.length >= 3 && inPoly(poly, x, z)) return 0;
  let best = Infinity;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[j]!;
    const b = poly[i]!;
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const L = dx * dx + dz * dz;
    const k = L > 0 ? Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / L)) : 0;
    best = Math.min(best, Math.hypot(a.x + k * dx - x, a.z + k * dz - z));
  }
  return best;
}

export const CRACK_LABEL_PROMOTE_S = 30;
export const CRACK_LABEL_NEAR_M = 10;

const SITE_NEAR_AREA_M = 12;
const LAST_SIGHTING_FADE_S = 8;
const AREA_BADGE_S = 1.5;

const inPoly = (poly: readonly Vec2[], x: number, z: number): boolean => {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]!;
    const b = poly[j]!;
    if (a.z > z !== b.z > z && x < ((b.x - a.x) * (z - a.z)) / (b.z - a.z) + a.x) inside = !inside;
  }
  return inside;
};

/** Searchlight beam yaw at sim time t — the sim's own formula (src/mystery/hazards.ts), so the wedge matches the real beam. */
export function beamYaw(h: Extract<HazardDef, { kind: 'searchlight' }>, t: number): number {
  return searchlightYaw(h, t);
}

/** Zone the point lies in (first match), or null. */
export function zoneAt<T extends { polygon: readonly Vec2[] }>(zones: readonly T[], x: number, z: number): T | null {
  for (const zn of zones) if (inPoly(zn.polygon, x, z)) return zn;
  return null;
}

/** Build the drawable layers from public state. Pure. */
export function buildMapLayers(s: PublicMapState, mode: MapMode = 'mini'): MapLayers {
  const g = s.geometry;
  const w = s.world;
  const inv = s.investigation;
  const labels: MapLabel[] = [];
  const f = s.forecasts;

  // ---- dynamic walls: the passage (looks like any wall until it opens — never reveals the secret) and the powered gate
  const dynIds = new Set<string>();
  if (w?.passage) dynIds.add(w.passage.wallId);
  if (g.powerSwitch) dynIds.add(g.powerSwitch.gateWallId);
  const dynamicWalls = g.walls
    .filter((wl) => dynIds.has(wl.id))
    .map((wl) => ({ id: wl.id, a: wl.a, b: wl.b, style: (g.powerSwitch?.gateWallId === wl.id ? 'gate' : 'wall') as 'gate' | 'wall', open: s.openWalls.includes(wl.id) || (w?.passage?.wallId === wl.id && inv.passageOpen) }));

  // ---- Hyde zones (after emergence) / spawns (before)
  let zones: MapLayers['zones'] = [];
  let spawns: MapLayers['spawns'] = [];
  if (f?.hyde.phase === 'active') {
    const cells = oddsCells(f.hyde.zones.map((z) => ({ p: z.p })), { distribution: true });
    const own = zoneAt(f.hyde.zones, s.player.x, s.player.z)?.zoneId ?? null;
    zones = f.hyde.zones.map((z, i) => ({ id: z.zoneId, name: z.name, polygon: z.polygon, p: z.p, cell: cells[i]!, own: z.zoneId === own }));
    // % label for ≤ 2 zones on the minimap: yours + the highest other one; the Tab map labels every zone.
    const ranked = zones.filter((z) => !z.own).sort((a, b) => b.p - a.p);
    const labelled = mode === 'full' ? zones : [...zones.filter((z) => z.own), ...ranked.slice(0, 1)];
    for (const z of labelled) {
      const c = centroid(z.polygon);
      labels.push({ x: c.x, z: c.z, text: mode === 'full' ? `${z.name} ${z.cell.text}` : z.cell.text, priority: 3, color: 'hyde', id: `zone:${z.id}` });
    }
  } else if (f?.hyde.phase === 'before_emergence') {
    const cells = oddsCells(f.hyde.spawns.map((sp) => ({ p: sp.p })), { distribution: true });
    spawns = f.hyde.spawns.map((sp, i) => ({ id: sp.spawnId, name: sp.name, x: sp.x, z: sp.z, p: sp.p, cell: cells[i]! }));
    for (const sp of spawns) labels.push({ x: sp.x, z: sp.z, text: mode === 'full' ? `${sp.name} ${sp.cell.text}` : sp.cell.text, priority: 3, color: 'hyde', dy: -14, id: `spawn:${sp.id}` });
  }

  // ---- hazards (seen or revealed only)
  const hazards: MapLayers['hazards'] = [];
  for (const h of w?.hazards ?? []) {
    if (!s.seenHazards.includes(h.id)) continue;
    if (h.kind === 'noisy_floor') hazards.push({ kind: 'floor', id: h.id, polygon: h.polygon });
    else hazards.push({ kind: 'beam', id: h.id, x: h.x, z: h.z, rangeM: h.rangeM, coneDeg: h.coneDeg, yaw: beamYaw(h, s.t) });
  }

  // ---- clue areas + candidate sites (case world priors + observations; no truth)
  const found = new Set<string>(s.cluesFound);
  const areaP = new Map<string, number>();
  for (const a of f?.clueAreas?.areas ?? []) areaP.set(a.areaId, a.p);
  const areaCells = new Map<string, OddsCell>();
  if (f?.clueAreas) {
    const list = f.clueAreas.areas;
    const cells = oddsCells(list.map((a) => ({ p: a.p })), { distribution: false });
    list.forEach((a, i) => areaCells.set(a.areaId, cells[i]!));
  }
  const openGroups = (w?.clueSites ?? []).filter((gr) => !found.has(gr.clueId));
  const allFound = !!w && openGroups.length === 0;
  const areaHasOpenSite = (areaId: string) =>
    openGroups.some((gr) => gr.sites.some((st) => st.areaId === areaId && !inv.checkedClueSites.includes(st.id)));
  const areas: MapLayers['areas'] = (w?.areas ?? []).map((a) => {
    const p = areaP.get(a.id) ?? null;
    const done = allFound || (f?.clueAreas ? !areaP.has(a.id) || (p ?? 0) <= 0 : !areaHasOpenSite(a.id));
    const focus = !done && s.hint.level >= 2 && s.hint.areaId === a.id;
    const doneAt = s.areaDoneAt[a.id];
    return {
      id: a.id, name: a.name, x: a.x, z: a.z, radiusM: a.radiusM, p, cell: done ? null : areaCells.get(a.id) ?? null,
      state: focus ? 'focus' : done ? 'done' : 'open',
      badge: done && doneAt !== undefined && s.t - doneAt >= 0 && s.t - doneAt < AREA_BADGE_S,
    };
  });
  for (const a of areas) {
    if (a.state === 'done') continue;
    const near = Math.hypot(s.player.x - a.x, s.player.z - a.z) <= a.radiusM + SITE_NEAR_AREA_M;
    const text = a.cell ? `${a.name} ${a.cell.text}` : a.name;
    // Minimap: name + % inside the top edge (only areas you are near, or the one Thing pointed at); Tab: every area.
    if (mode === 'full' || near || a.state === 'focus') labels.push({ x: a.x, z: a.z, text, priority: a.state === 'focus' ? 0 : 2, color: a.state === 'focus' ? 'lantern' : 'violet', insideTopR: a.radiusM, id: `area:${a.id}` });
    else if (a.cell) labels.push({ x: a.x, z: a.z, text: a.cell.text, priority: 2, color: 'violet', id: `area:${a.id}` });
  }

  const clueSites: MapLayers['clueSites'] = [];
  const cluePins: MapLayers['cluePins'] = [];
  for (const gr of openGroups) {
    const known = inv.knownClueSites[gr.clueId];
    for (const st of gr.sites) {
      if (known === st.id) {
        cluePins.push({ x: st.x, z: st.z, id: st.id });
        continue;
      }
      if (known) continue; // the clue was seen elsewhere: this candidate is moot
      const area = w!.areas.find((a) => a.id === st.areaId);
      const nearArea = area ? Math.hypot(s.player.x - area.x, s.player.z - area.z) <= area.radiusM + SITE_NEAR_AREA_M : false;
      const show = nearArea || (s.hint.level >= 2 && s.hint.areaId === st.areaId) || (mode === 'full' && s.visitedAreas.includes(st.areaId));
      if (!show) continue;
      clueSites.push({ id: st.id, clueId: gr.clueId, areaId: st.areaId, x: st.x, z: st.z, state: inv.checkedClueSites.includes(st.id) ? 'checked' : 'candidate' });
    }
  }
  if (s.hint.level >= 3 && s.hint.target) cluePins.push({ x: s.hint.target.x, z: s.hint.target.z, id: 'hint' });

  // ---- egg sites (public candidates, always with odds) — gone once the egg is carried / delivered
  let eggSites: MapLayers['eggSites'] = [];
  const eggOpen = s.eggState === 'resting';
  if (w && eggOpen) {
    const probs = f?.egg?.sites ?? null;
    const cells = probs
      ? oddsCells(w.eggSites.map((e) => {
        const sp = probs.find((x) => x.siteId === e.id);
        const seen = inv.eggSeenAt === e.id;
        const out = !seen && (sp?.ruledOut || inv.checkedEggSites.includes(e.id) || (inv.eggSeenAt !== null && !seen));
        return { p: sp?.p ?? 0, fact: seen ? 'Seen' as const : out ? 'Not here' as const : null };
      }), { distribution: true })
      : null;
    let topP = -1;
    let topId: string | null = null;
    eggSites = w.eggSites.map((e, i) => {
      const cell = cells?.[i] ?? null;
      const state: 'candidate' | 'checked' | 'seen' = inv.eggSeenAt === e.id ? 'seen'
        : inv.checkedEggSites.includes(e.id) || cell?.fact === 'Not here' ? 'checked' : 'candidate';
      const p = probs?.find((x) => x.siteId === e.id)?.p ?? null;
      if (state === 'candidate' && p !== null && p > topP) {
        topP = p;
        topId = e.id;
      }
      return { id: e.id, label: e.label, x: e.x, z: e.z, p, cell, state, top: false };
    });
    for (const e of eggSites) {
      e.top = e.id === topId;
      const txt = e.cell ? (mode === 'full' ? `${e.label} ${e.cell.text}` : e.cell.text) : mode === 'full' ? e.label : null;
      if (txt) labels.push({ x: e.x, z: e.z, text: txt, priority: 1, color: e.state === 'checked' ? 'muted' : 'ivory', dy: -16, id: `egg:${e.id}` });
    }
  }
  let eggPin: MapLayers['eggPin'] = null;
  if (s.eggMarker) eggPin = { x: s.eggMarker.x, z: s.eggMarker.z, kind: s.eggMarker.kind };
  else if (eggOpen && inv.eggSeenAt && w) {
    const site = w.eggSites.find((e) => e.id === inv.eggSeenAt);
    if (site) eggPin = { x: site.x, z: site.z, kind: 'seen' };
  }

  // ---- Hyde: visible / chasing → exact point; otherwise a fading outline at the last sighting (never truth-based)
  let hyde: MapLayers['hyde'] = null;
  if (s.hyde) hyde = { x: s.hyde.x, z: s.hyde.z, kind: s.hyde.mode, alpha: 1 };
  else if (inv.lastHydeSighting) {
    const age = s.t - inv.lastHydeSighting.t;
    if (age >= 0 && age < LAST_SIGHTING_FADE_S) hyde = { x: inv.lastHydeSighting.x, z: inv.lastHydeSighting.z, kind: 'last', alpha: 1 - age / LAST_SIGHTING_FADE_S };
  }

  // ---- Joseph Crackstone: area (public) · risk stipple (analytics) · curse circle (public telegraph) · marker per R4
  let crack: CrackLayers | null = null;
  if (s.crack) {
    const c = s.crack;
    const risk: CrackLayers['risk'] = [];
    const fc = f?.crackstone ?? null;
    for (const cell of fc?.cells ?? []) {
      const band = crackBand(cell.p);
      if (band !== null) risk.push({ band, x: cell.x, z: cell.z, sizeM: cell.sizeM, p: cell.p });
    }
    let marker: CrackLayers['marker'] = null;
    if (c.marker) marker = { ...c.marker, alpha: 1 };
    else {
      const last = inv.lastCrackstoneSighting ?? null;
      const age = last ? s.t - last.t : -1;
      if (last && age >= 0 && age < LAST_SIGHTING_FADE_S) marker = { x: last.x, z: last.z, yaw: 0, coneDeg: 0, kind: 'last', alpha: 1 - age / LAST_SIGHTING_FADE_S };
    }
    const scan = c.marker && c.scan
      ? { x: c.scan.x, z: c.scan.z, radiusM: c.scan.radiusM, pulse: c.scan.phase === 'pulse', progress: c.scan.phase === 'pulse' ? 1 : Math.max(0, Math.min(1, (s.t - c.scan.startedAt) / Math.max(1e-6, c.scan.pulseAt - c.scan.startedAt))) }
      : null;
    const curse = c.curse
      ? { x: c.curse.x, z: c.curse.z, radiusM: c.curse.radiusM, progress: Math.max(0, Math.min(1, (s.t - c.curse.startedAt) / Math.max(1e-6, c.curse.landsAt - c.curse.startedAt))) }
      : null;
    crack = { area: c.area, risk, curse, marker, scan, chase: c.chase };
    // "CURSED · {area}" between area % and zone %; egg-level for 30 s after the announcement or within 10 m
    const promoted = (c.announcedAt !== null && s.t - c.announcedAt >= 0 && s.t - c.announcedAt < CRACK_LABEL_PROMOTE_S)
      || distToPolygon(c.area.polygon, s.player.x, s.player.z) <= CRACK_LABEL_NEAR_M;
    const ac = centroid(c.area.polygon);
    labels.push({ x: ac.x, z: ac.z, text: `CURSED · ${c.area.name}`, priority: promoted ? 1 : 2.5, color: 'crack', id: 'crack:area' });
    // the player's own cell: hat + "22%" (estimates only; facts are words in the Odds panel)
    if (fc && !fc.here.fact && fc.here.p >= 0.1) {
      labels.push({ x: s.player.x, z: s.player.z, text: pctText(roundPct(fc.here.p)), priority: 3, color: 'crack', glyph: 'hat', dy: 26, id: 'crack:here' });
    }
  }

  // ---- objective marker + rooms (Tab)
  if (s.target) labels.push({ x: s.target.x, z: s.target.z, text: s.target.label, priority: 0, color: 'lantern', dy: -18, id: 'objective' });
  if (mode === 'full') {
    for (const r of g.rooms) {
      if (r.id === 'path') continue;
      const c = centroid(r.polygon);
      labels.push({ x: c.x, z: c.z, text: r.name, priority: 4, color: 'muted', id: `room:${r.id}` });
    }
  }

  const towerObjective = s.objective === 'deliver_egg' || s.objective === 'accuse';
  return {
    geometry: g,
    dynamicWalls,
    zones,
    spawns,
    hazards,
    areas,
    clueSites,
    cluePins,
    eggSites,
    eggPin,
    tower: { x: g.tower.x, z: g.tower.z, radius: g.tower.radius, objective: towerObjective },
    hiding: g.hidingSpots.map((h) => ({ x: h.x, z: h.z })),
    lever: w?.passage && (s.leverSeen || inv.passageOpen) ? { x: w.passage.leverX, z: w.passage.leverZ } : null,
    powerSwitch: s.showSwitch && g.powerSwitch ? { x: g.powerSwitch.x, z: g.powerSwitch.z } : null,
    route: s.route,
    objective: s.target,
    hyde,
    crack,
    player: s.player,
    chase: s.hyde?.mode === 'chase',
    flashes: s.flashes,
    labels,
    t: s.t,
  };
}

export function centroid(poly: readonly Vec2[]): Vec2 {
  let x = 0;
  let z = 0;
  for (const p of poly) {
    x += p.x;
    z += p.z;
  }
  const n = Math.max(1, poly.length);
  return { x: x / n, z: z / n };
}
