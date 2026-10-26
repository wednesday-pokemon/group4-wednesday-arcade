// Evaluation metrics (reusing the repo's generic regression utilities for Brier / calibration / MAE).
import { brierScore, calibrationBins, meanAbsoluteError } from '../../analytics/regression.ts';
import type { ClassifierMetrics } from './model.ts';

export { brierScore, calibrationBins, meanAbsoluteError };

export function logLoss(p: readonly number[], y: readonly number[]): number {
  let s = 0;
  for (let i = 0; i < p.length; i++) {
    const q = Math.min(1 - 1e-12, Math.max(1e-12, p[i]));
    s -= y[i] ? Math.log(q) : Math.log(1 - q);
  }
  return s / Math.max(1, p.length);
}

/** ROC AUC by the rank-sum (Mann–Whitney) statistic with tie correction; null if one class is absent. */
export function auc(p: readonly number[], y: readonly number[]): number | null {
  const idx = p.map((_, i) => i).sort((a, b) => p[a] - p[b]);
  const ranks = new Array<number>(p.length);
  for (let i = 0; i < idx.length; ) {
    let j = i;
    while (j + 1 < idx.length && p[idx[j + 1]] === p[idx[i]]) j++;
    const r = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) ranks[idx[k]] = r;
    i = j + 1;
  }
  let pos = 0;
  let sumPos = 0;
  for (let i = 0; i < y.length; i++) {
    if (y[i]) {
      pos++;
      sumPos += ranks[i];
    }
  }
  const neg = y.length - pos;
  if (pos === 0 || neg === 0) return null;
  return (sumPos - (pos * (pos + 1)) / 2) / (pos * neg);
}

const r4 = (x: number) => Math.round(x * 10000) / 10000;

/** Full classifier report on a held-out set against a constant base-rate baseline (`trainBaseRate`). */
export function classifierMetrics(p: readonly number[], y: readonly number[], sessions: number, trainBaseRate: number): ClassifierMetrics {
  const positives = y.reduce((a, b) => a + b, 0);
  const base = p.map(() => trainBaseRate);
  const brier = brierScore([...p], [...y]);
  const baselineBrier = brierScore(base, [...y]);
  return {
    rows: p.length,
    sessions,
    positives,
    baseRate: r4(positives / Math.max(1, p.length)),
    trainBaseRate: r4(trainBaseRate),
    brier: r4(brier),
    baselineBrier: r4(baselineBrier),
    brierSkill: r4(baselineBrier > 0 ? 1 - brier / baselineBrier : 0),
    logLoss: r4(logLoss(p, y)),
    baselineLogLoss: r4(logLoss(base, y)),
    auc: (() => {
      const a = auc(p, y);
      return a === null ? null : r4(a);
    })(),
    calibration: calibrationBins([...p], [...y], 10).map((c) => ({
      lower: r4(c.lower), upper: r4(c.upper), count: c.count, meanPredicted: r4(c.meanPredicted), observedRate: r4(c.observedRate),
    })),
  };
}
