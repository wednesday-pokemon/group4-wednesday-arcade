// Principal Weems = the OPTIONAL paid hint guide (docs/final/UX_FINAL.md §4; FINAL_CONTRACT §8). Thing's advice stays
// free and never comes through here. Each accepted press becomes ONE `hint_requested {level}` in the sim (−50); every
// refusal (tutorial, first-use note, cooldown, hunted, no more hints) is a no-op WITHOUT a charge: the loop only lets
// `hint: true` reach run.update() when press() returns 'hint'. The idle ladder never calls press().
//   Ready      "Ask Weems" · "−50 · used {n}" · V        first press of the run → the note card (6 s), afterwards a hint
//   Cooldown   ring on the V cap + "Ready in {n} s", portrait greyscale                        no-op
//   Hunted     "Not while hunted" (any monster CHASE / ATTACK)                                  no-op
//   Exhausted  "No more hints here" (L3 used for the current objective step; disabled)          no-op
// The level ladder (L1 area → L2 location / evidence link → L3 deduction) resets on objective progress. The sim's
// weemsStatus() wins when it exists (cooldown, used, available, reason, next level).
import type { StampedEvent } from '../../../mystery/types.ts';

export type WeemsState = 'hidden' | 'ready' | 'cooldown' | 'hunted' | 'exhausted';
export type WeemsLevel = 1 | 2 | 3;

export const WEEMS_NOTE_S = 6;
export const WEEMS_CARD_S = 10;
export const WEEMS_WAIT_MAX_S = 4;
export const WEEMS_MARK_S = 16;
export const WEEMS_PENALTY = 50;

export const WEEMS_COPY = {
  button: 'Ask Weems',
  note: ['My hints cost 50 points each.', 'Press V again to ask.', 'Thing’s tips stay free.'] as const,
  hunted: 'Not while hunted',
  exhausted: 'No more hints here',
  marked: 'Marked on your map.',
  kicker: 'PRINCIPAL WEEMS',
} as const;

export const weemsUsedText = (n: number) => `−50 · used ${n}`;
export const weemsReadyIn = (s: number) => `Ready in ${Math.max(1, Math.ceil(s))} s`;
export const weemsKicker = (level: WeemsLevel) => `PRINCIPAL WEEMS · HINT ${level} OF 3`;
export const weemsFooter = (n: number) => `−50 points · ${n} hint${n === 1 ? '' : 's'} used`;

/** The sim's Weems view-model (game-developer ask), loosely parsed. */
export interface WeemsSim {
  cooldownLeftS: number | null;
  used: number | null;
  available: boolean | null;
  reason: string | null;
  level: WeemsLevel | null;
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const lvl = (v: unknown): WeemsLevel | null => (v === 1 || v === 2 || v === 3 ? v : null);

export function weemsSimOf(run: object): WeemsSim | null {
  const r = run as { weemsStatus?: () => unknown; hintReadyAt?: unknown; t?: unknown };
  if (typeof r.weemsStatus === 'function') {
    let s: unknown;
    try {
      s = r.weemsStatus();
    } catch {
      s = null;
    }
    if (s && typeof s === 'object') {
      const o = s as Record<string, unknown>;
      return {
        cooldownLeftS: num(o.cooldownLeftS), used: num(o.used) ?? num(o.hintsUsed), available: typeof o.available === 'boolean' ? o.available : null,
        reason: typeof o.reason === 'string' ? o.reason : null, level: lvl(o.level) ?? lvl(o.nextLevel),
      };
    }
  }
  // overhaul sim: the V cooldown is the run's own hintReadyAt (sim time)
  const readyAt = num(r.hintReadyAt);
  const t = num(r.t);
  if (readyAt !== null && t !== null) return { cooldownLeftS: Math.max(0, readyAt - t), used: null, available: null, reason: null, level: null };
  return null;
}

export interface WeemsContext {
  tutorial: boolean;
  playing: boolean;
  hunted: boolean;
  sim: WeemsSim | null;
}

export interface WeemsButtonView {
  state: WeemsState;
  used: number;
  /** "−50 · used {n}" · "Ready in {n} s" · "Not while hunted" · "No more hints here". */
  sub: string;
  cooldownS: number | null;
  /** 0..1 of the cooldown elapsed (V cap ring). */
  ring: number | null;
  disabled: boolean;
}

export interface WeemsCardView {
  id: number;
  kind: 'note' | 'hint';
  kicker: string;
  lines: string[];
  footer: string | null;
  marked: boolean;
  level: WeemsLevel | null;
}

export interface WeemsHintRecord { level: WeemsLevel; text: string; t: number }

export class WeemsController {
  /** realT of the first-use note (once per run). */
  noteAt: number | null = null;
  used = 0;
  /** Hints taken in the current objective step (local ladder). */
  stepLevel = 0;
  readonly hints: WeemsHintRecord[] = [];
  private cooldownTotal = 0;

  state(c: WeemsContext): WeemsState {
    if (c.tutorial || !c.playing) return 'hidden';
    if (c.hunted || c.sim?.reason === 'hunted' || c.sim?.reason === 'chase') return 'hunted';
    if (this.exhausted(c)) return 'exhausted';
    if ((c.sim?.cooldownLeftS ?? 0) > 0.05) return 'cooldown';
    return 'ready';
  }

  exhausted(c: WeemsContext): boolean {
    if (c.sim?.available === false && (c.sim.reason === 'exhausted' || c.sim.reason === 'none_left' || c.sim.reason === 'max_level')) return true;
    if (c.sim?.level !== null && c.sim?.level !== undefined) return false;
    return this.stepLevel >= 3;
  }

  /** V / click. 'note' = show the first-use note (no charge); 'hint' = let hint: true reach the sim; null = no-op. */
  press(now: number, c: WeemsContext): 'note' | 'hint' | null {
    const st = this.state(c);
    if (st !== 'ready') return null;
    if (this.noteAt === null) {
      this.noteAt = now;
      return 'note';
    }
    return 'hint';
  }

  /** The note card is still up (≤ 6 s). */
  noteShowing(now: number): boolean {
    return this.noteAt !== null && now - this.noteAt < WEEMS_NOTE_S;
  }

  /** The level of the next hint (sim value first, else the local per-step ladder). */
  nextLevel(sim: WeemsSim | null): WeemsLevel {
    return sim?.level ?? (Math.min(3, this.stepLevel + 1) as WeemsLevel);
  }

  /** A `hint_requested` happened: returns its level (event level → sim level → local ladder). */
  onHintEvent(e: Extract<StampedEvent, { type: 'hint_requested' }>, sim: WeemsSim | null): WeemsLevel {
    const level = lvl(e.level) ?? this.nextLevel(sim);
    this.used++;
    this.stepLevel = Math.max(this.stepLevel, level);
    return level;
  }

  /** Objective progress (clue found, egg found / picked up, objective changed): L1 again. */
  progress(): void {
    this.stepLevel = 0;
  }

  record(level: WeemsLevel, text: string, t: number): void {
    this.hints.push({ level, text, t });
  }

  button(c: WeemsContext, simUsed: number | null): WeemsButtonView {
    const st = this.state(c);
    const used = simUsed ?? this.used;
    const cd = c.sim?.cooldownLeftS ?? null;
    if (st === 'cooldown' && cd !== null) this.cooldownTotal = Math.max(this.cooldownTotal, cd);
    if (st !== 'cooldown') this.cooldownTotal = 0;
    const sub = st === 'cooldown' && cd !== null ? weemsReadyIn(cd) : st === 'hunted' ? WEEMS_COPY.hunted : st === 'exhausted' ? WEEMS_COPY.exhausted : weemsUsedText(used);
    return {
      state: st, used, sub,
      cooldownS: st === 'cooldown' ? cd : null,
      ring: st === 'cooldown' && cd !== null && this.cooldownTotal > 0 ? Math.max(0, Math.min(1, 1 - cd / this.cooldownTotal)) : null,
      disabled: st === 'exhausted' || st === 'hidden',
    };
  }
}

export function noteCard(id: number): WeemsCardView {
  return { id, kind: 'note', kicker: WEEMS_COPY.kicker, lines: [...WEEMS_COPY.note], footer: null, marked: false, level: null };
}

export function hintCard(id: number, level: WeemsLevel, text: string, used: number, marked: boolean): WeemsCardView {
  return { id, kind: 'hint', kicker: weemsKicker(level), lines: [clip(text, 90)], footer: weemsFooter(used), marked, level };
}

function clip(s: string, n: number): string {
  return s.length <= n ? s : `${s.slice(0, n - 1).trimEnd()}…`;
}

/** Weems' L3 fallback when the analytics has no line: deduction guidance that never names anyone. */
export const WEEMS_FALLBACK_L3 = 'Ask who could reach every place your clues were found.';
