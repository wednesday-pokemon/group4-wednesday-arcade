// Scoring + egg tier draw for mystery-v3.1 (pure; shared with Deno so the server can recompute both).
// Score = round1(points × 100 − activeTimeS); DNF → null. Finishers (score desc, then time asc) rank above all DNFs.
import type { EggTier } from '../game/types.ts';
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
