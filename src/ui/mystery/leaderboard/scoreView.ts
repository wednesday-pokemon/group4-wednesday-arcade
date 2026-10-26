// Results score box view-models (docs/final/UX_FINAL.md §6, FINAL_CONTRACT §1). Pure; unit-tested.
//  * scoreBoxView: the v4 2×4 breakdown (Egg delivered · Right culprit · Clues n/3 · Time bonus (m:ss) | Never detected ·
//    No hints · Hints ×n · Hits ×n) + total. Gains in text colour, penalties in danger, missed / zero parts muted with the
//    reason in brackets ("+0 (seen 2×)"). Source: RunResult.scoreBreakdown, else the shared scoreV4 from the run's own
//    counts — never invented: without the counts there is no breakdown (total only).
//  * rankChipView: LIVE "#3 tonight" / LOCAL "#2 on this laptop" / "Verifying…" / "Not ranked".
//  * dnfBoxView: the DEFEAT LOG variant (Lasted · Clues · Egg · Seen/Hits/Hints, WHY line, defeated by).
import type { ResultsAnalytics } from '../../../mystery/analytics/index.ts';
import { SCORE_V4, scoreV4 } from '../../../mystery/scoring.ts';
import type { EnemyId, RunResult, ScoreBreakdown } from '../../../mystery/types.ts';
import { fmtClock, fmtPoints } from './model.ts';

export type ScoreTone = 'gain' | 'penalty' | 'muted';
export interface ScoreRowView { key: keyof Omit<ScoreBreakdown, 'total'>; label: string; value: string; tone: ScoreTone; reason: string | null }
export interface ScoreBoxView {
  total: number;
  totalText: string;
  /** null = this run carries no breakdown (legacy / counts missing): show the total only. */
  rows: { left: ScoreRowView[]; right: ScoreRowView[] } | null;
  /** The signed parts summed below 0 and the total was clamped to 0. */
  clamped: boolean;
}

const MINUS = '−';
const plus = (v: number) => (v > 0 ? `+${v}` : v < 0 ? `${MINUS}${Math.abs(v)}` : '0');

/** The breakdown of a finished run: the sim's / server's own, else scoreV4 from the run's counts; null if unknowable. */
export function breakdownOf(r: RunResult): ScoreBreakdown | null {
  if (r.outcome !== 'finished') return null;
  if (r.scoreBreakdown) return r.scoreBreakdown;
  if (typeof r.detections !== 'number' || typeof r.hits !== 'number' || typeof r.hintsUsed !== 'number') return null;
  return scoreV4({
    delivered: true, correct: r.correct, cluesFound: r.cluesFound.length, detections: r.detections, hintsUsed: r.hintsUsed, hits: r.hits,
    activeTimeS: r.activeTimeS,
  });
}

export function scoreBoxView(r: RunResult): ScoreBoxView | null {
  if (r.outcome !== 'finished') return null;
  const b = breakdownOf(r);
  if (!b) {
    const total = r.score ?? 0;
    return { total, totalText: fmtPoints(total), rows: null, clamped: false };
  }
  const hints = typeof r.hintsUsed === 'number' ? r.hintsUsed : Math.round(-b.hintPenalty / SCORE_V4.perHint);
  const hits = typeof r.hits === 'number' ? r.hits : Math.round(-b.hitPenalty / SCORE_V4.perHit);
  const seen = typeof r.detections === 'number' ? r.detections : null;
  const clues = Math.min(SCORE_V4.maxClues, Math.round(b.clues / SCORE_V4.perClue));
  const gain = (key: ScoreRowView['key'], label: string, v: number, missed: string | null): ScoreRowView =>
    v > 0 ? { key, label, value: plus(v), tone: 'gain', reason: null } : { key, label, value: '+0', tone: 'muted', reason: missed };
  const penalty = (key: ScoreRowView['key'], label: string, v: number): ScoreRowView =>
    v < 0 ? { key, label, value: plus(v), tone: 'penalty', reason: null } : { key, label, value: '0', tone: 'muted', reason: null };
  const sum = b.delivery + b.accusation + b.clues + b.noDetection + b.noHints + b.timeBonus + b.hintPenalty + b.hitPenalty;
  return {
    total: b.total,
    totalText: fmtPoints(b.total),
    clamped: sum < 0 && b.total === 0,
    rows: {
      left: [
        gain('delivery', 'Egg delivered', b.delivery, 'not delivered'),
        gain('accusation', 'Right culprit', b.accusation, r.accused === null ? 'no accusation' : 'wrong suspect'),
        gain('clues', `Clues ${clues}/${SCORE_V4.maxClues}`, b.clues, 'none found'),
        gain('timeBonus', `Time bonus (${fmtClock(r.activeTimeS)})`, b.timeBonus, `over ${fmtClock(SCORE_V4.timeBonusS)}`),
      ],
      right: [
        gain('noDetection', 'Never detected', b.noDetection, seen === null ? 'seen' : `seen ${seen}×`),
        gain('noHints', 'No hints', b.noHints, `used ${hints}×`),
        penalty('hintPenalty', `Hints ×${hints}`, b.hintPenalty),
        penalty('hitPenalty', `Hits ×${hits}`, b.hitPenalty),
      ],
    },
  };
}

// ------------------------------------------------------------------------------------------------------- rank chip

export type RankChipKind = 'live' | 'local' | 'pending' | 'none';
export interface RankChipView { kind: RankChipKind; text: string }

/** What the results' rank chip says (finishers; a DNF always reads "No score · not ranked" elsewhere). */
export function rankChipView(input:
  | { mode: 'live'; final: 'verifying' | 'verified' | 'unverified' | 'none'; rank: number | null }
  | { mode: 'local'; rank: number | null }): RankChipView {
  if (input.mode === 'local') return input.rank !== null ? { kind: 'local', text: `#${input.rank} on this laptop` } : { kind: 'none', text: 'Not ranked' };
  if (input.final === 'verified') return input.rank !== null ? { kind: 'live', text: `#${input.rank} tonight` } : { kind: 'none', text: 'Not ranked' };
  if (input.final === 'verifying' || input.final === 'none') return { kind: 'pending', text: 'Verifying…' };
  return { kind: 'none', text: 'Not ranked' };
}

// ------------------------------------------------------------------------------------------------------- DNF

export interface DnfBoxView {
  enemy: EnemyId | null;
  lasted: string;
  clues: string;
  egg: string | null;
  tally: string;
  why: string | null;
}

/** "m:ss · " prefix of the diagnostic service's texts. */
const TIME_PREFIX = /^\s*\d+:\d{2}\s*[·•-]\s*/;

/** The newest rule-verified cause of the run (≤ 90 chars), else the case reason for the DNF; null without analytics. */
export function whyLine(a: ResultsAnalytics | null): string | null {
  if (!a) return null;
  const causes = [...(a.diagnostic.causes ?? [])].filter((c) => c.kind === 'cause').sort((x, y) => y.t - x.t);
  const pick = causes[0] ?? (a.diagnostic.caseReasons ?? []).find((c) => c.code.includes('dnf')) ?? a.diagnostic.top?.[0] ?? null;
  if (!pick) return null;
  const text = pick.text.replace(TIME_PREFIX, '').trim();
  return text.length > 90 ? `${text.slice(0, 89).trimEnd()}…` : text;
}

function eggWord(a: ResultsAnalytics | null): string | null {
  if (!a) return null;
  const e = a.descriptive.egg;
  if (e.delivered) return 'delivered';
  if (e.pickupT === null) return 'not found';
  const lastDrop = e.drops.length ? e.drops[e.drops.length - 1]!.t : -1;
  return lastDrop >= e.pickupT ? 'dropped' : 'carried';
}

export function dnfBoxView(r: RunResult, a: ResultsAnalytics | null, cluesTotal = 3): DnfBoxView {
  const n = (v: number | undefined) => (typeof v === 'number' ? String(v) : '—');
  const hints = typeof r.hintsUsed === 'number' ? r.hintsUsed : a ? a.descriptive.hints : undefined;
  const egg = eggWord(a);
  return {
    enemy: r.defeatedBy ?? null,
    lasted: `Lasted ${fmtClock(r.activeTimeS)}`,
    clues: `Clues ${Math.min(cluesTotal, r.cluesFound.length)}/${cluesTotal}`,
    egg: egg ? `Egg: ${egg}` : null,
    tally: `Seen ${n(r.detections)} · Hits ${n(r.hits)} · Hints ${n(hints)}`,
    why: whyLine(a),
  };
}
