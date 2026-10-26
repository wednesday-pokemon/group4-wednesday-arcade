// Scoring + egg tier draw (pure; shared with Deno so the server can recompute both — no DOM, no Math.random, no Date).
// mystery-v4 (docs/final/FINAL_CONTRACT.md §1, current): scoreV4(parts) → ScoreBreakdown, total clamped ≥ 0, finishers
// only (DNF → null). mystery-v3.1 (legacy rows): scoreFor = round1(points × 100 − activeTimeS).
// Finishers (score desc, then time asc) rank above all DNFs in both versions.
import type { EggTier } from '../game/types.ts';
import type { ScoreBreakdown } from './types.ts';
import { prfUniform } from './prf.ts';

export type LiveEggTier = Exclude<EggTier, 'none'>;
export const EGG_TIERS: readonly LiveEggTier[] = ['common', 'rare', 'legendary'];

/** Round half away from zero to one decimal, robust to binary float error (e.g. 0.05 → 0.1, −2.25 → −2.3). */
export function round1(x: number): number {
  const s = Math.sign(x);
  return (s * Math.round(Math.abs(x) * 10 + 1e-9)) / 10 || 0;
}

export function scoreFor(points: number, activeTimeS: number): number {
  return round1(points * 100 - round1(activeTimeS));
}

/** mystery-v4 score constants (FINAL_CONTRACT §1). */
export const SCORE_V4 = {
  delivery: 1000,
  accusation: 300,
  perClue: 100,
  maxClues: 3,
  noDetection: 150,
  noHints: 150,
  timeBonusS: 300,
  perHint: 50,
  perHit: 75,
} as const;

/** What scoreV4 needs — all counted from validated RULE events (the server recomputes each one). */
export interface ScoreV4Parts {
  /** Egg delivered at Iago Tower. */
  delivered: boolean;
  /** The accused suspect is the case's culprit. */
  correct: boolean;
  /** Required clues found (capped at 3). */
  cluesFound: number;
  /** `enemy_detected` events. */
  detections: number;
  /** `hint_requested` events (explicit Ask-Weems presses only). */
  hintsUsed: number;
  /** `enemy_hit` events (blocked hits count). */
  hits: number;
  /** Active gameplay seconds (pauses / loading / prologue / tutorial excluded). */
  activeTimeS: number;
}

/** A count from untrusted input: finite, ≥ 0, whole. */
function count(x: number): number {
  return Number.isFinite(x) && x > 0 ? Math.floor(x) : 0;
}

/**
 * mystery-v4 score: delivery 1000 + accusation 300 (correct culprit) + 100 × min(clues, 3) + 150 (no detections) + 150 (no
 * hints) + max(0, 300 − floor(activeTimeS)) − 50 × hints − 75 × hits; total = max(0, sum). Every part is an integer.
 * Non-finite / negative counts count as 0; a non-finite time earns no time bonus.
 */
export function scoreV4(parts: ScoreV4Parts): ScoreBreakdown {
  const S = SCORE_V4;
  const hints = count(parts.hintsUsed);
  const hits = count(parts.hits);
  const detections = count(parts.detections);
  const t = parts.activeTimeS;
  const timeBonus = Number.isFinite(t) && t >= 0 ? Math.max(0, S.timeBonusS - Math.floor(t + 1e-9)) : 0;
  const b = {
    delivery: parts.delivered ? S.delivery : 0,
    accusation: parts.correct ? S.accusation : 0,
    clues: S.perClue * Math.min(S.maxClues, count(parts.cluesFound)),
    noDetection: detections === 0 ? S.noDetection : 0,
    noHints: hints === 0 ? S.noHints : 0,
    timeBonus,
    hintPenalty: hints > 0 ? -S.perHint * hints : 0,
    hitPenalty: hits > 0 ? -S.perHit * hits : 0,
  };
  const sum = b.delivery + b.accusation + b.clues + b.noDetection + b.noHints + b.timeBonus + b.hintPenalty + b.hitPenalty;
  return { ...b, total: Math.max(0, sum) };
}

export interface RankEntry { outcome: 'finished' | 'dnf'; score: number | null; activeTimeS: number }

/** Sort comparator: finishers first (score desc, then active time asc), then DNFs (time desc = survived longer). */
export function compareResults(a: RankEntry, b: RankEntry): number {
  const af = a.outcome === 'finished' && a.score !== null;
  const bf = b.outcome === 'finished' && b.score !== null;
  if (af !== bf) return af ? -1 : 1;
  if (af && bf) {
    if (a.score !== b.score) return (b.score as number) - (a.score as number);
    return a.activeTimeS - b.activeTimeS;
  }
  return b.activeTimeS - a.activeTimeS;
}

export const EGG_TIER_DRAW_KEY = 'egg:tier';

export function eggTierFromUniform(u: number, weights: Record<LiveEggTier, number>): LiveEggTier {
  const total = EGG_TIERS.reduce((s, t) => s + Math.max(0, weights[t]), 0);
  let acc = 0;
  for (const t of EGG_TIERS) {
    acc += Math.max(0, weights[t]) / (total || 1);
    if (u < acc) return t;
  }
  for (let i = EGG_TIERS.length - 1; i >= 0; i--) if (weights[EGG_TIERS[i]] > 0) return EGG_TIERS[i];
  return 'common';
}

/** The run's egg tier: a pure function of the session seed (server-recomputable). */
export function eggTierForSeed(seed: string, weights: Record<LiveEggTier, number>): LiveEggTier {
  return eggTierFromUniform(prfUniform(seed, EGG_TIER_DRAW_KEY), weights);
}
