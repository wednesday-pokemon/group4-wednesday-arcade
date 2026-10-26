// Minimal, dependency-free regression used by the offline trainer and the kiosk runtime.

/** Solves A x = b with partial-pivot Gaussian elimination (A is small and square). */
function solveLinear(a: number[][], b: number[]): number[] {
  const n = b.length;
  const m = a.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(m[r][col]) > Math.abs(m[pivot][col])) pivot = r;
    [m[col], m[pivot]] = [m[pivot], m[col]];
    const p = m[col][col];
    if (Math.abs(p) < 1e-12) throw new Error('Singular system: add regularisation or drop collinear features');
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = m[r][col] / p;
      for (let c = col; c <= n; c++) m[r][c] -= f * m[col][c];
    }
  }
  return m.map((row, i) => row[n] / row[i]);
}

/** Ordinary least squares via normal equations with a tiny ridge term (intercept unpenalised). */
export function fitOls(x: number[][], y: number[], ridge = 1e-6): number[] {
  const k = x[0].length;
  const xtx = Array.from({ length: k }, () => new Array<number>(k).fill(0));
  const xty = new Array<number>(k).fill(0);
  for (let i = 0; i < x.length; i++) {
    const row = x[i];
    for (let a = 0; a < k; a++) {
      xty[a] += row[a] * y[i];
      for (let b = a; b < k; b++) xtx[a][b] += row[a] * row[b];
    }
  }
  for (let a = 0; a < k; a++) {
    for (let b = 0; b < a; b++) xtx[a][b] = xtx[b][a];
    if (a > 0) xtx[a][a] += ridge * x.length;
  }
  return solveLinear(xtx, xty);
}

export function dot(w: number[], x: number[]): number {
  let s = 0;
  for (let i = 0; i < w.length; i++) s += w[i] * x[i];
  return s;
}

export const sigmoid = (z: number): number => 1 / (1 + Math.exp(-z));

/** Logistic regression by Newton–Raphson (IRLS) with L2 regularisation. */
export function fitLogistic(x: number[][], y: number[], l2 = 1e-3, iterations = 25): number[] {
  const k = x[0].length;
  let w = new Array<number>(k).fill(0);
  for (let it = 0; it < iterations; it++) {
    const grad = new Array<number>(k).fill(0);
    const hess = Array.from({ length: k }, () => new Array<number>(k).fill(0));
    for (let i = 0; i < x.length; i++) {
      const row = x[i];
      const p = sigmoid(dot(w, row));
      const s = Math.max(p * (1 - p), 1e-9);
      for (let a = 0; a < k; a++) {
        grad[a] += (p - y[i]) * row[a];
        for (let b = a; b < k; b++) hess[a][b] += s * row[a] * row[b];
      }
    }
    for (let a = 0; a < k; a++) {
      for (let b = 0; b < a; b++) hess[a][b] = hess[b][a];
      if (a > 0) {
        grad[a] += l2 * x.length * w[a];
        hess[a][a] += l2 * x.length;
      }
    }
    const step = solveLinear(hess, grad);
    w = w.map((v, i) => v - step[i]);
    if (Math.max(...step.map(Math.abs)) < 1e-8) break;
  }
  return w;
}

export function meanAbsoluteError(pred: number[], actual: number[]): number {
  return pred.reduce((s, p, i) => s + Math.abs(p - actual[i]), 0) / pred.length;
}

export function brierScore(prob: number[], outcome: number[]): number {
  return prob.reduce((s, p, i) => s + (p - outcome[i]) ** 2, 0) / prob.length;
}

export interface CalibrationBin { lower: number; upper: number; count: number; meanPredicted: number; observedRate: number }

export function calibrationBins(prob: number[], outcome: number[], binCount = 10): CalibrationBin[] {
  const bins = Array.from({ length: binCount }, (_, i) => ({ lower: i / binCount, upper: (i + 1) / binCount, count: 0, sumP: 0, sumY: 0 }));
  prob.forEach((p, i) => {
    const bin = bins[Math.min(binCount - 1, Math.floor(p * binCount))];
    bin.count++;
    bin.sumP += p;
    bin.sumY += outcome[i];
  });
  return bins.map((b) => ({
    lower: b.lower, upper: b.upper, count: b.count,
    meanPredicted: b.count ? b.sumP / b.count : 0,
    observedRate: b.count ? b.sumY / b.count : 0,
  }));
}
