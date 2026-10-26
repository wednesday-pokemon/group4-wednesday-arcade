// Analytics v2 — pure helpers that make the four layers and their links VISIBLE (HUD + results). No run access, no
// hidden truth: everything here formats what the analytics already computed from public state / the rule events.
//   • sourceTag:          the layer an advice reason came from → "(Predictive)" / "(Diagnostic: saw you hide)".
//   • alternativesLine:   "Also considered: Hide 82 · Crouch 72" — generic action labels + the engine's scores only
//                         (never a target, site or position; the options themselves were built from public state).
//   • check-backs:        "Predicted 60% here: found it ✓" + "Thing's predictions: 3 of 4 right" (results).
//   • adviceScorecard:    "Followed 3 of 5 tips · unseen 15 s after 2 of them" (after, never "because").
//   • pointsLostLines:    "−75 Slurp hit at 2:10 (you were sprinting)" from the v4 breakdown + the rule events.
// Imported by the results screen: type-only imports + the score constants, nothing heavy.
import type { EnemyId, ScoreBreakdown, Stance, StampedEvent } from '../types.ts';
import type { AdviceAction, AdviceAlternative, AdviceOption, AdviceSource, PredictionCheck } from './types.ts';

// ----------------------------------------------------------------------------------------------------- advice source

/** The short source label for a Why line, or null when the layer is unknown / descriptive (no suffix shown). */
export function sourceTag(source: AdviceSource | undefined, note?: string | null): string | null {
  if (source === 'predictive') return 'Predictive';
  if (source === 'diagnostic') return note ? `Diagnostic: ${note}` : 'Diagnostic';
  return null;
}

// ----------------------------------------------------------------------------------------------------- also considered

/** Generic, public labels per action (never a place: the line must not add anything the odds do not show). */
export const ALT_LABEL: Record<AdviceAction, string> = {
  evade: 'Run', hide: 'Hide', crouch: 'Crouch', stop_sprinting: 'Stop sprinting', alt_route: 'Safer route', use_power: 'Your power',
  use_move: 'Your move', inspect_clue: 'Check a spot', search_room: 'Keep searching', get_egg: 'Find the egg', retrieve_egg: 'Pick up egg',
  go_to_tower: 'Go to tower', deposit: 'Deposit egg', stay_quiet: 'Stay quiet', review_evidence: 'Review evidence', take_cover: 'Take cover',
  leave_curse: 'Leave the ring', break_sight: 'Break sight', avoid_area: 'Leave his area', hide_cabinet: 'Hide in cabinet',
  close_cabinet: 'Close the door', exit_cabinet: 'Step out',
};

/** The top ≤ 2 feasible runner-ups as public alternatives (other actions than the advice's own, best first). */
export function alternativesOf(best: Pick<AdviceOption, 'action'>, alts: readonly Pick<AdviceOption, 'action' | 'score' | 'feasible'>[], max = 2): AdviceAlternative[] {
  const out: AdviceAlternative[] = [];
  for (const a of [...alts].sort((x, y) => y.score - x.score)) {
    if (a.feasible !== true || a.action === best.action || out.some((o) => o.action === a.action)) continue;
    if (!Number.isFinite(a.score)) continue;
    out.push({ action: a.action, label: ALT_LABEL[a.action] ?? a.action, score: Math.round(a.score) });
    if (out.length >= max) break;
  }
  return out;
}

/** "Also considered: Hide 50 · Keep searching 35", or null when there are none. */
export function alternativesLine(alts: readonly AdviceAlternative[] | null | undefined): string | null {
  if (!alts || alts.length === 0) return null;
  return `Also considered: ${alts.slice(0, 2).map((a) => `${a.label} ${a.score}`).join(' · ')}`;
}

// ----------------------------------------------------------------------------------------------------- check-backs

/** "Right" = displayed ≥ 50 % and found, or < 50 % and empty. */
export function predictionRight(pct: number, found: boolean): boolean {
  return pct >= 50 ? found : !found;
}

/** Thing's LOG line for one check-back: "Predicted 60% here: found it ✓" (✓ / ✗ = the prediction was right / wrong). */
export function checkBackLine(c: Pick<PredictionCheck, 'pct' | 'text' | 'found'>): string {
  return `Predicted ${c.text} here: ${c.found ? 'found it' : 'empty'} ${predictionRight(c.pct, c.found) ? '✓' : '✗'}`;
}

export interface PredictionSummary { total: number; right: number; found: number; meanPct: number; text: string; calibration: string | null }

/**
 * "Thing's predictions: 3 of 4 right" + (≥ 2 checks) the trivial calibration note "avg 45% · found 25%" (mean displayed
 * percent vs the share of searched sites that held it). Null without checks.
 */
export function predictionSummary(checks: readonly Pick<PredictionCheck, 'pct' | 'found'>[] | null | undefined): PredictionSummary | null {
  if (!checks || checks.length === 0) return null;
  const total = checks.length;
  const right = checks.filter((c) => predictionRight(c.pct, c.found)).length;
  const found = checks.filter((c) => c.found).length;
  const meanPct = Math.round(checks.reduce((s, c) => s + c.pct, 0) / total);
  return {
    total, right, found, meanPct,
    text: `Thing’s predictions: ${right} of ${total} right`,
    calibration: total >= 2 ? `avg ${meanPct}% · found ${Math.round((found / total) * 100)}%` : null,
  };
}

// ----------------------------------------------------------------------------------------------------- advice scorecard

export interface AdviceScoreInput { given: number; followed: number; followedObserved: number; undetectedAfterFollowed: number }

/** "Followed 3 of 5 tips · unseen 15 s after 2 of them" (null when Thing gave no advice). Reported as AFTER, not because. */
export function adviceScorecard(s: AdviceScoreInput | null | undefined): string | null {
  if (!s || s.given <= 0) return null;
  let text = `Followed ${s.followed} of ${s.given} tip${s.given === 1 ? '' : 's'}`;
  if (s.followedObserved > 0) {
    // "of them" when every followed tip has a known 15 s outcome, else the number that has one
    const of = s.followedObserved === s.followed ? 'them' : String(s.followedObserved);
    text += ` · unseen 15 s after ${s.undetectedAfterFollowed} of ${of}`;
  }
  return text;
}

// ----------------------------------------------------------------------------------------------------- points lost

const MINUS = '−';
const WHO: Record<EnemyId, string> = { hyde: 'Hyde', crackstone: 'Crackstone', slurp: 'Slurp' };
const VIA: Record<string, string> = { sight: 'spotted you', sound: 'heard you', proximity: 'sensed you', scan: 'scanned you', witnessed_hide: 'saw you hide' };
const PER_HIT = 75;
const PER_HINT = 50;
const PER_CLUE = 100;
const MAX_CLUES = 3;

function clock(t: number): string {
  const s = Math.max(0, Math.floor(t));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** The player's stance at time t from the stance events (initial stance before the first one). */
function stanceAt(events: readonly StampedEvent[], t: number, initial: Stance): Stance {
  let st = initial;
  for (const e of events) {
    if (e.t > t) break;
    if (e.type === 'stance') st = e.stance;
  }
  return st;
}

/** One "Why you lost points" item: the points lost and the reason (no sign; the UI shows "−75"). */
export interface PointsLostItem { pts: number; text: string }

/**
 * "Why you lost points" (≤ `max` items, biggest first): the lost Never-detected / No-hints bonuses (with the first
 * detection / hint that cost them), each hit (75; "(you were sprinting)" when the stance events say so, "(blocked)" for a
 * blocked hit — it still counts) and hint (50), and missing clue points. Only from the v4 breakdown + the run's rule
 * events (tutorial seq 0 ignored); [] without a breakdown. Never mentions a suspect.
 */
export function pointsLostItems(events: readonly StampedEvent[], b: ScoreBreakdown | null | undefined, o: { initialStance?: Stance; max?: number } = {}): PointsLostItem[] {
  if (!b) return [];
  const ev = events.filter((e) => e.seq !== 0);
  const init = o.initialStance ?? 'idle';
  const items: (PointsLostItem & { t: number })[] = [];
  if (b.noDetection === 0) {
    const d = ev.find((e) => e.type === 'enemy_detected');
    const why = d && d.type === 'enemy_detected' ? `: ${WHO[d.enemy]} ${VIA[d.via] ?? 'found you'} at ${clock(d.t)}` : '';
    items.push({ pts: 150, t: d?.t ?? 0, text: `Never detected${why}` });
  }
  if (b.noHints === 0) {
    const h = ev.find((e) => e.type === 'hint_requested');
    items.push({ pts: 150, t: h?.t ?? 0, text: `No hints${h ? `: Weems hint at ${clock(h.t)}` : ''}` });
  }
  if (b.hitPenalty < 0) {
    const hits = ev.filter((e) => e.type === 'enemy_hit');
    for (const e of hits) {
      if (e.type !== 'enemy_hit') continue;
      const note = e.blocked ? ' (blocked)' : stanceAt(ev, e.t, init) === 'sprint' ? ' (you were sprinting)' : '';
      items.push({ pts: PER_HIT, t: e.t, text: `${WHO[e.enemy]} hit at ${clock(e.t)}${note}` });
    }
    if (hits.length === 0) items.push({ pts: -b.hitPenalty, t: 0, text: 'Hits' });
  }
  if (b.hintPenalty < 0) {
    const hints = ev.filter((e) => e.type === 'hint_requested');
    for (const e of hints) items.push({ pts: PER_HINT, t: e.t, text: `Weems hint at ${clock(e.t)}` });
    if (hints.length === 0) items.push({ pts: -b.hintPenalty, t: 0, text: 'Hints' });
  }
  const clues = Math.round(b.clues / PER_CLUE);
  if (clues < MAX_CLUES) items.push({ pts: (MAX_CLUES - clues) * PER_CLUE, t: Infinity, text: `Clues: ${clues} of ${MAX_CLUES} found` });
  return items.sort((a, c) => c.pts - a.pts || a.t - c.t).slice(0, o.max ?? 5).map(({ pts, text }) => ({ pts, text }));
}

/** The items as one-line strings: "−75 Slurp hit at 2:10 (you were sprinting)". */
export function pointsLostLines(events: readonly StampedEvent[], b: ScoreBreakdown | null | undefined, o: { initialStance?: Stance; max?: number } = {}): string[] {
  return pointsLostItems(events, b, o).map((x) => `${MINUS}${x.pts} ${x.text}`);
}

/** "−75" for an item's badge. */
export function lostPts(pts: number): string {
  return `${MINUS}${pts}`;
}
