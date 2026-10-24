// Compass strip layout (UX_OVERHAUL §2). Pure: heading + markers → x positions in a strip `width` px wide showing a 150°
// arc (±75°). Heading = the camera/player yaw (contract yaw: 0 faces −Z = north, positive turns left), so compass
// heading = −yaw in degrees. Only LANTERN markers (the active objective) clamp to the ends with a ◂/▸ chevron on the side
// of the shortest turn (15° hysteresis near 180°); every other marker simply hides when off the arc.
import { bearingDeg, headingDeg, wrapDeg } from '../../../ui/mystery/map/mapRender.ts';
import type { Vec2 } from '../../../mystery/types.ts';

export const COMPASS_ARC_DEG = 150;
export const COMPASS_HALF_DEG = COMPASS_ARC_DEG / 2;
/** Letters within this many px of a visible marker hide (the marker wins). */
export const LETTER_HIDE_PX = 12;
/** Clamped lantern markers sit this far in from each end. */
export const CLAMP_INSET_PX = 8;
/** Near ±180° the clamp side only flips after the bearing passes 180° by this much. */
export const CLAMP_HYSTERESIS_DEG = 15;
/** Area / tower labels show only within ±10° of the centre index. */
export const FOCUS_LABEL_DEG = 10;

export type CompassMarkerKind = 'objective' | 'area' | 'egg' | 'tower' | 'landmark' | 'hyde_heard' | 'hyde_seen'
  // Joseph Crackstone (UX_ENEMIES §4): filled hat only per R4, hat outline 3 s after a directional caption, the text
  // "CURSED" toward his area's centroid (≤ 60 m, player outside the area)
  | 'crack_seen' | 'crack_heard' | 'cursed_area';

export interface CompassMarkerIn {
  id: string;
  kind: CompassMarkerKind;
  /** Compass bearing (degrees clockwise from north) from the player. */
  bearing: number;
  distanceM: number | null;
  /** Area / landmark name. */
  name?: string | null;
  /** Lantern = the active objective (only these clamp). */
  lantern: boolean;
  /** Egg glyph filled once seen. */
  filled?: boolean;
  /** Egg candidate: rounded odds text ("45%"). */
  pct?: string | null;
  /** Enemy markers: this enemy is chasing / attacking (wins a glyph collision with the other enemy). */
  chasing?: boolean;
}

export interface CompassMarker extends CompassMarkerIn {
  x: number;
  /** Relative bearing: 0 ahead, + right, − left. */
  rel: number;
  clamped: 'left' | 'right' | null;
  /** Text drawn next to the glyph (distance / name · distance / %), or null (also when it would collide). */
  label: string | null;
  labelSide: LabelSide;
}

/** Label anchor: text starts right of the glyph ('left' align) or ends left of it ('right' align). */
export type LabelSide = 'right' | 'left';

export interface CompassLayout {
  heading: number;
  pxPerDeg: number;
  ticks: { x: number; major: boolean }[];
  letters: { x: number; text: string; cardinal: boolean; hidden: boolean }[];
  markers: CompassMarker[];
}

const LETTERS: readonly [number, string][] = [[0, 'N'], [45, 'NE'], [90, 'E'], [135, 'SE'], [180, 'S'], [225, 'SW'], [270, 'W'], [315, 'NW']];

/** Remembers each clamped marker's side so it does not flicker while you face directly away from it. */
export class CompassClamp {
  private side = new Map<string, 'left' | 'right'>();
  sideFor(id: string, rel: number): 'left' | 'right' {
    const shortest: 'left' | 'right' = rel < 0 ? 'left' : 'right';
    const prev = this.side.get(id);
    // Hysteresis: within 15° of directly behind, keep the previous side.
    const side = prev && Math.abs(rel) > 180 - CLAMP_HYSTERESIS_DEG ? prev : shortest;
    this.side.set(id, side);
    return side;
  }
  forget(id: string): void {
    this.side.delete(id);
  }
}

export const fmtM = (m: number) => `${Math.max(0, Math.round(m))} m`;

/** Label priority (lower wins a collision): objective > lantern > tower > Hyde > area > egg > landmark. */
const LABEL_RANK: Record<CompassMarkerKind, number> = {
  objective: 0, tower: 2, hyde_seen: 3, hyde_heard: 3, crack_seen: 3, crack_heard: 3, area: 4, egg: 5, cursed_area: 5.5, landmark: 6,
};
const ENEMY = new Set<CompassMarkerKind>(['hyde_seen', 'hyde_heard', 'crack_seen', 'crack_heard']);
/** Text-only markers (the text IS the marker). */
const TEXT_ONLY = new Set<CompassMarkerKind>(['landmark', 'cursed_area']);

/**
 * Two enemy glyphs on the same spot of the strip: the one chasing / attacking wins, else the nearer one (a heard
 * marker has no distance and loses to a seen one).
 */
export function resolveEnemyCollisions<T extends Pick<CompassMarkerIn, 'kind' | 'chasing' | 'distanceM'> & { x: number }>(list: T[], glyphPx: number): T[] {
  const enemies = list.filter((m) => ENEMY.has(m.kind));
  const lose = new Set<T>();
  for (let i = 0; i < enemies.length; i++) {
    for (let j = i + 1; j < enemies.length; j++) {
      const a = enemies[i]!;
      const b = enemies[j]!;
      const hydeA = a.kind.startsWith('hyde');
      const hydeB = b.kind.startsWith('hyde');
      if (hydeA === hydeB || Math.abs(a.x - b.x) >= glyphPx) continue;
      const score = (m: T) => (m.chasing ? 0 : 1) * 1e6 + (m.distanceM ?? 1e5);
      lose.add(score(a) <= score(b) ? b : a);
    }
  }
  return lose.size ? list.filter((m) => !lose.has(m)) : list;
}
const rankOf = (m: CompassMarkerIn) => (m.lantern ? Math.min(1, LABEL_RANK[m.kind]) : LABEL_RANK[m.kind]);
/** Default text width estimate (fs-xs Alegreya Sans ≈ 7.2 px per character at 1366). */
export const estimateTextPx = (t: string) => t.length * 7.2;

/** Lay out ticks, letters and markers for a strip `width` px wide. Labels never overlap (higher priority wins). */
export function layoutCompass(
  heading: number, markers: readonly CompassMarkerIn[], width: number, clamp: CompassClamp,
  measure: (text: string) => number = estimateTextPx, glyphPx = 14,
): CompassLayout {
  const ppd = width / COMPASS_ARC_DEG;
  const cx = width / 2;
  const xOf = (rel: number) => cx + rel * ppd;
  const ticks: CompassLayout['ticks'] = [];
  const start = Math.ceil((heading - COMPASS_HALF_DEG) / 15) * 15;
  for (let a = start; a <= heading + COMPASS_HALF_DEG + 1e-9; a += 15) {
    const abs = ((a % 360) + 360) % 360;
    ticks.push({ x: xOf(a - heading), major: abs % 45 === 0 });
  }
  const out: CompassMarker[] = [];
  for (const m of markers) {
    const rel = wrapDeg(m.bearing - heading);
    let x: number;
    let clamped: CompassMarker['clamped'] = null;
    if (Math.abs(rel) <= COMPASS_HALF_DEG) {
      x = xOf(rel);
      if (m.lantern) clamp.sideFor(m.id, rel); // keep the side memory warm while visible
    } else if (m.lantern) {
      clamped = clamp.sideFor(m.id, rel);
      x = clamped === 'left' ? CLAMP_INSET_PX : width - CLAMP_INSET_PX;
    } else continue;
    const focus = Math.abs(rel) <= FOCUS_LABEL_DEG;
    let label: string | null = null;
    if (m.kind === 'objective') label = m.distanceM !== null ? fmtM(m.distanceM) : null;
    else if (m.kind === 'egg') label = m.pct ?? null;
    else if (TEXT_ONLY.has(m.kind)) label = m.name ?? null;
    else if ((m.kind === 'area' || m.kind === 'tower') && (focus || (m.lantern && clamped === null)))
      label = [m.name, m.distanceM !== null ? fmtM(m.distanceM) : null].filter(Boolean).join(' · ') || null;
    if (clamped && m.distanceM !== null) label = fmtM(m.distanceM);
    out.push({ ...m, x, rel, clamped, label, labelSide: clamped === 'right' ? 'left' : 'right' });
  }
  // ---- enemy glyph collisions (Hyde vs Crackstone): the chaser wins, else the nearer one
  const kept = resolveEnemyCollisions(out, glyphPx);
  if (kept !== out) {
    out.length = 0;
    out.push(...kept);
  }
  // ---- de-clutter: glyphs first (landmarks / CURSED are text-only markers), then labels by priority
  const taken: [number, number][] = out.filter((m) => !TEXT_ONLY.has(m.kind)).map((m) => [m.x - glyphPx / 2, m.x + glyphPx / 2]);
  const labelSpans: [number, number][] = [];
  /** Overlap with anything placed so far, ignoring the marker's own glyph (`self`). */
  const PAD = 2;
  const hits = (a: number, b: number, self?: [number, number]) => taken.some((t) => t !== self && a < t[1] + PAD && b > t[0] - PAD);
  const glyphOf = new Map(out.filter((m) => !TEXT_ONLY.has(m.kind)).map((m, i) => [m, taken[i]!] as const));
  for (const m of [...out].sort((a, b) => rankOf(a) - rankOf(b) || Math.abs(a.rel) - Math.abs(b.rel))) {
    if (!m.label) continue;
    const w = measure(m.label);
    if (TEXT_ONLY.has(m.kind)) {
      const span: [number, number] = [m.x - w / 2, m.x + w / 2];
      if (hits(span[0], span[1]) || span[0] < 0 || span[1] > width) m.label = null;
      else {
        taken.push(span);
        labelSpans.push(span);
      }
      continue;
    }
    const gap = glyphPx / 2 + 3;
    const right: [number, number] = [m.x + gap, m.x + gap + w];
    const left: [number, number] = [m.x - gap - w, m.x - gap];
    const order: [LabelSide, [number, number]][] = m.labelSide === 'left' ? [['left', left], ['right', right]] : [['right', right], ['left', left]];
    const own = glyphOf.get(m);
    const fit = order.find(([, s]) => s[0] >= 0 && s[1] <= width && !hits(s[0], s[1], own));
    if (!fit) {
      m.label = null;
      continue;
    }
    m.labelSide = fit[0];
    taken.push(fit[1]);
    labelSpans.push(fit[1]);
  }
  // text-only markers without room disappear entirely (the text IS the marker)
  for (let i = out.length - 1; i >= 0; i--) if (TEXT_ONLY.has(out[i]!.kind) && !out[i]!.label) out.splice(i, 1);
  // letters hide under a marker glyph (≤ 12 px from its centre) or under any placed label / landmark text
  const letters = LETTERS.map(([deg, text]) => {
    const rel = wrapDeg(deg - heading);
    return { deg, text, rel };
  })
    .filter((l) => Math.abs(l.rel) <= COMPASS_HALF_DEG)
    .map((l) => {
      const x = xOf(l.rel);
      const half = measure(l.text) / 2;
      const underGlyph = out.some((m) => !TEXT_ONLY.has(m.kind) && Math.abs(m.x - x) < Math.max(LETTER_HIDE_PX, half + glyphPx / 2));
      const underText = labelSpans.some(([a, b]) => x - half < b && x + half > a);
      return { x, text: l.text, cardinal: l.text.length === 1, hidden: underGlyph || underText };
    });
  return { heading, pxPerDeg: ppd, ticks, letters, markers: out };
}

/** Marker bearing + distance from the player. */
export function markerAt(from: Vec2, to: Vec2): { bearing: number; distanceM: number } {
  return { bearing: bearingDeg(from, to), distanceM: Math.hypot(to.x - from.x, to.z - from.z) };
}

/** Compass bearing of a heard Hyde: relative angle (0 ahead, + left, radians) → absolute, rounded to 22.5°. */
export function heardBearing(yaw: number, relAngleRad: number): number {
  const abs = headingDeg(yaw) - (relAngleRad * 180) / Math.PI;
  const r = Math.round(abs / 22.5) * 22.5;
  return ((r % 360) + 360) % 360;
}

export { headingDeg };
