// Hiding cabinets on the HUD (docs/final/UX_FINAL.md §2): status chip (360×28, y496), prompt row (≤ 480×44, y532),
// the hiding-view overlay (.mhud-cabinet[data-door]) and the Vitals "IN CABINET" row. Pure view-model; the sim surface
// is feature-detected (run.cabinetStatus() when the game-developer ships it, else PlayerState.cabinet + the
// interactable + the loop's own event trackers).
import type { EnemyId, StampedEvent } from '../../../mystery/types.ts';
import { ENEMY_SHORT } from './enemies.ts';

export type CabinetPhase = 'entering' | 'open' | 'closing' | 'closed' | 'exiting';

export interface CabinetIn {
  /** null = not inside a cabinet. */
  phase: CabinetPhase | null;
  /** A cabinet is in E range (the sim's interactable says "Hide"). */
  inRange: boolean;
  /** An enemy can see the player right now (outside): "It can see you. It will check this cabinet." */
  watchedBy: EnemyId | null;
  /** An enemy saw the player enter / close the door (it will come and pull them out). */
  witnessedBy: EnemyId | null;
  /** Seconds until the door creaks (null = unknown / not counting). */
  creakInS: number | null;
  /** The door creaked within the last 300 ms (chip flash). */
  creaking: boolean;
  /** An enemy is visible within 4 m of the door. */
  outside: EnemyId | null;
  /** An enemy is visible or heard within 8 m (overlay tint). */
  near: EnemyId | null;
}

export const CABINET_NONE: CabinetIn = { phase: null, inRange: false, watchedBy: null, witnessedBy: null, creakInS: null, creaking: false, outside: null, near: null };

export interface CabinetChipView {
  text: string;
  door: 'open' | 'closed' | 'closing';
  /** Second line (witnessed / right outside / creak soon), null when none. */
  line2: string | null;
  line2Tone: 'lantern' | 'danger' | 'muted' | null;
  /** Witnessed: border in that enemy's colour. */
  witnessedBy: EnemyId | null;
  flash: boolean;
}

export interface CabinetPromptView {
  kind: 'hide' | 'close' | 'exit';
  /** Amber warning under "[E] Hide" while watched. */
  warn: string | null;
  /** fs-xs muted aside ("Move to step out"). */
  aside: string | null;
  /** "Stay quiet" before the divider (door closed). */
  quiet: boolean;
  /** [E] Exit in lantern (witnessed). */
  urgent: boolean;
}

export interface CabinetView {
  /** Hiding-view overlay (null when outside / entering / exiting). */
  door: 'open' | 'closed' | null;
  chip: CabinetChipView | null;
  prompt: CabinetPromptView | null;
  /** Vitals hidden-row text. */
  vitals: string | null;
  /** Overlay tint enemy (visible / heard within 8 m). */
  near: EnemyId | null;
  /** Inside (any phase): reticle and lock hint hidden. */
  inside: boolean;
}

export const CABINET_COPY = {
  hide: 'Hide',
  watched: 'It can see you. It will check this cabinet.',
  open: 'DOOR OPEN · you can be spotted',
  close: 'Close Door',
  stepOut: 'Move to step out',
  closed: 'DOOR CLOSED · hidden from sight',
  quiet: 'Stay quiet',
  exit: 'Exit',
  creakSoon: 'The door will creak soon.',
  creakCaption: '[Cabinet door creaks]',
  closing: 'Closing…',
  vitalsOpen: 'IN CABINET · door open',
  vitalsClosed: 'IN CABINET · door closed',
} as const;

export const witnessedText = (e: EnemyId) => `${ENEMY_SHORT[e]} saw you hide! Get out now.`;
export const outsideText = (e: EnemyId) => `${ENEMY_SHORT[e]} is right outside. Wait.`;

export const CREAK_WARN_S = 5;

export function cabinetView(i: CabinetIn): CabinetView {
  const ph = i.phase;
  if (ph === null) {
    return {
      door: null, chip: null, near: null, inside: false, vitals: null,
      prompt: i.inRange ? { kind: 'hide', warn: i.watchedBy ? CABINET_COPY.watched : null, aside: null, quiet: false, urgent: false } : null,
    };
  }
  if (ph === 'entering' || ph === 'exiting') {
    return { door: ph === 'entering' ? 'open' : null, chip: null, prompt: null, vitals: CABINET_COPY.vitalsOpen, near: i.near, inside: true };
  }
  // line 2: witnessed > right outside > creak soon
  let line2: string | null = null;
  let line2Tone: CabinetChipView['line2Tone'] = null;
  if (i.witnessedBy) {
    line2 = witnessedText(i.witnessedBy);
    line2Tone = 'danger';
  } else if (i.outside) {
    line2 = outsideText(i.outside);
    line2Tone = 'muted';
  } else if ((ph === 'closed' || ph === 'open') && i.creakInS !== null && i.creakInS <= CREAK_WARN_S) {
    line2 = CABINET_COPY.creakSoon;
    line2Tone = 'lantern';
  }
  if (ph === 'closing') {
    return {
      door: 'open', near: i.near, inside: true, vitals: CABINET_COPY.vitalsOpen, prompt: null,
      chip: { text: CABINET_COPY.closing, door: 'closing', line2, line2Tone, witnessedBy: i.witnessedBy, flash: false },
    };
  }
  const open = ph === 'open';
  return {
    door: open ? 'open' : 'closed',
    near: i.near,
    inside: true,
    vitals: open ? CABINET_COPY.vitalsOpen : CABINET_COPY.vitalsClosed,
    chip: { text: open ? CABINET_COPY.open : CABINET_COPY.closed, door: open ? 'open' : 'closed', line2, line2Tone, witnessedBy: i.witnessedBy, flash: i.creaking },
    prompt: open
      ? { kind: 'close', warn: null, aside: CABINET_COPY.stepOut, quiet: false, urgent: !!i.witnessedBy }
      : { kind: 'exit', warn: null, aside: null, quiet: true, urgent: !!i.witnessedBy },
  };
}

// ------------------------------------------------------------------------------------------------- sim adapter

type Loose = Record<string, unknown>;
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const enemyOf = (v: unknown): EnemyId | null => (v === 'hyde' || v === 'crackstone' || v === 'slurp' ? v : null);

/** The sim has run.cabinetStatus() (final sim): its null means "not inside". */
export function hasCabinetStatus(run: object): boolean {
  return typeof (run as { cabinetStatus?: unknown }).cabinetStatus === 'function';
}

/**
 * The sim's own cabinet status (game-developer view-model; null while outside or when the sim predates it). The final
 * sim returns { spotId, phase, phaseT, door, closing, witnessedBy, creakInS, lastCreakAt, exit, enemyOutside }.
 */
export function cabinetStatusOf(run: object): Partial<CabinetIn> & { spotId?: string | null; lastCreakAt?: number | null } | null {
  const fn = (run as { cabinetStatus?: () => unknown }).cabinetStatus;
  if (typeof fn !== 'function') return null;
  let s: unknown;
  try {
    s = fn.call(run);
  } catch {
    return null;
  }
  if (!s || typeof s !== 'object') return null;
  const o = s as Loose;
  const out: Partial<CabinetIn> & { spotId?: string | null; lastCreakAt?: number | null } = {};
  const ph = o.phase;
  if (ph === null || ph === 'none' || ph === undefined) out.phase = null;
  else if (ph === 'entering' || ph === 'open' || ph === 'closing' || ph === 'closed' || ph === 'exiting') out.phase = ph;
  if (o.closing === true && out.phase === 'open') out.phase = 'closing';
  if (typeof o.inRange === 'boolean') out.inRange = o.inRange;
  else if (typeof o.nearSpotId === 'string' || o.nearSpotId === null) out.inRange = !!o.nearSpotId;
  const w = enemyOf(o.witnessedBy);
  if (w || o.witnessedBy === null) out.witnessedBy = w;
  const watched = enemyOf(o.watchedBy) ?? enemyOf(o.seenBy);
  if (watched || o.watchedBy === null || o.seenBy === null) out.watchedBy = watched;
  const c = num(o.creakInS);
  if (c !== null || o.creakInS === null) out.creakInS = c;
  const eo = o.enemyOutside;
  if (eo && typeof eo === 'object') {
    const e = enemyOf((eo as Loose).enemy);
    out.outside = e && (eo as Loose).visible !== false ? e : null;
  } else if (eo === null) out.outside = null;
  if (typeof o.spotId === 'string' || o.spotId === null) out.spotId = o.spotId as string | null;
  const lc = num(o.lastCreakAt);
  if (lc !== null || o.lastCreakAt === null) out.lastCreakAt = lc;
  return out;
}

/** PlayerState.cabinet phase (null outside). */
export function playerCabinetPhase(c: { phase: string } | null | undefined): CabinetPhase | null {
  if (!c) return null;
  const p = c.phase;
  return p === 'entering' || p === 'open' || p === 'closing' || p === 'closed' || p === 'exiting' ? p : null;
}

/**
 * Event-side cabinet tracking for sims without cabinetStatus(): who witnessed the hide (enemy_detected via
 * 'witnessed_hide'), creaks (a `cabinet` creak action, or the player's own noise while the door is closed and no door
 * action happened in the same batch), the door-closed time (creak countdown) and pull-outs.
 */
export class CabinetTracker {
  witnessedBy: EnemyId | null = null;
  closedSinceT: number | null = null;
  lastCreakAt = -Infinity;
  creaks = 0;
  pulledOutBy: EnemyId | null = null;
  pulledOutAt = -Infinity;
  private lastSimCreak: number | null = null;

  /**
   * Call once per frame with the frame's events, the current phase and sim / real time. `simCreakAt` = the sim's
   * cabinetStatus().lastCreakAt (undefined = the sim has no status: creaks are inferred from events). Returns the creak.
   */
  update(events: readonly StampedEvent[], phase: CabinetPhase | null, t: number, now: number, simCreakAt?: number | null): { creak: boolean; pulledOut: EnemyId | null } {
    let creak = false;
    const inferCreaks = simCreakAt === undefined;
    if (!inferCreaks && simCreakAt !== null && simCreakAt !== this.lastSimCreak) {
      this.lastSimCreak = simCreakAt;
      creak = true;
    }
    let pulled: EnemyId | null = null;
    const doorAction = events.some((e) => e.type === 'cabinet' && e.action !== ('creak' as never));
    for (const e of events) {
      if (e.type === 'enemy_detected' && e.via === 'witnessed_hide') this.witnessedBy = e.enemy;
      if (e.type === 'cabinet') {
        const action = e.action as string;
        if (action === 'creak') creak = true;
        if (action === 'pulled_out') {
          pulled = this.witnessedBy ?? lastHitter(events);
          this.pulledOutBy = pulled;
          this.pulledOutAt = now;
        }
        if (action === 'exit' || action === 'pulled_out') this.witnessedBy = null;
        if (action === 'close') this.closedSinceT = t;
        if (action === 'open') this.closedSinceT = null;
      }
      if (inferCreaks && !doorAction && phase === 'closed' && e.type === 'noise' && (e.source === 'interact' || e.source === 'impact' || e.source === 'hazard')) creak = true;
    }
    if (phase !== 'closed') this.closedSinceT = phase === null ? null : this.closedSinceT;
    else if (this.closedSinceT === null) this.closedSinceT = t;
    if (phase === null && !pulled) this.witnessedBy = null;
    if (creak) {
      this.lastCreakAt = now;
      this.creaks++;
    }
    return { creak, pulledOut: pulled };
  }

  /** Fallback creak countdown: creakAfterS after the door closed (then every creakEveryS). */
  creakInS(t: number, creakAfterS: number | null, creakEveryS: number | null): number | null {
    if (this.closedSinceT === null || creakAfterS === null) return null;
    const inside = t - this.closedSinceT;
    if (inside < creakAfterS) return creakAfterS - inside;
    if (!creakEveryS || creakEveryS <= 0) return 0;
    const since = (inside - creakAfterS) % creakEveryS;
    return creakEveryS - since;
  }

  creaking(now: number): boolean {
    return now - this.lastCreakAt < 0.3;
  }
}

function lastHitter(events: readonly StampedEvent[]): EnemyId | null {
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i]!;
    if (e.type === 'enemy_hit') return e.enemy;
  }
  return null;
}
