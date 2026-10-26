// Offline evaluation of the RULE-BASED Joseph Crackstone risk (src/mystery/analytics/crackstoneRisk.ts) on SIMULATED
// episodes. Used by scripts/mystery-generate.ts (records per episode, data/mystery/crackstone.jsonl) and
// scripts/mystery-evaluate.ts (scores the held-out sessions, report §7). This module reads Crackstone's TRUE position,
// facing, mode and scan pulses from the live run — that is the point of an evaluation; the live game never sees them.
//
//   forecast  the live glue (CrackstoneLive — the exact live code, fed per sim step with the run's events and its public
//             state) at every 1 Hz sample: p for every 4 m cell of his leash disc (the HUD tint);
//   truth     per cell: 1 iff, at some instant of (t, t + 10 s], his ACTUAL perception would see a standing, not hidden
//             player at the cell (sight.ts canSee with his own sight — × returnSightMult while RETURNing, distracted
//             range — or proximity, only while he perceives: active, not stunned, not lured), or one of his scan pulses
//             covers it (radius + line of sight). Sampled every 0.25 s + at every pulse. Samples whose window runs past
//             the end of the episode are dropped (right-censored).
//   baselines (a) static patrol route: uniform loop phase, no observations (CrackstoneRiskModel.staticP);
//             (b) constant: the pooled base rate of the TRAINING sessions; (c) area occupancy: one rate inside his
//             cursed area, one outside (training sessions). Scored on the held-out sessions.
import { canSee } from '../src/mystery/sight.ts';
import { CrackstoneLive, crackstoneRiskFor } from '../src/mystery/analytics/crackstoneLive.ts';
import type { MysteryRun } from '../src/mystery/run.ts';
import type { StampedEvent } from '../src/mystery/types.ts';

export const CRACK_EVAL_VERSION = 'crack-eval-1';
export const TRUTH_EVERY_STEPS = 15; // 0.25 s at 60 Hz
const BINS = 10;

export interface Acc { n: number; brier: number; logLoss: number; sumP: number; sumY: number; bins: { n: number; sp: number; sy: number }[] }
export interface Count { n: number; y: number }

export function emptyAcc(): Acc {
  return { n: 0, brier: 0, logLoss: 0, sumP: 0, sumY: 0, bins: Array.from({ length: BINS }, () => ({ n: 0, sp: 0, sy: 0 })) };
}

export function addTo(a: Acc, p: number, y: number): void {
  const q = Math.min(1, Math.max(0, p));
  a.n++;
  a.brier += (q - y) ** 2;
  const c = Math.min(1 - 1e-4, Math.max(1e-4, q));
  a.logLoss += -(y ? Math.log(c) : Math.log(1 - c));
  a.sumP += q;
  a.sumY += y;
  const b = Math.min(BINS - 1, Math.floor(q * BINS));
  a.bins[b].n++;
  a.bins[b].sp += q;
  a.bins[b].sy += y;
}

export function mergeAcc(into: Acc, a: Acc): void {
  into.n += a.n;
  into.brier += a.brier;
  into.logLoss += a.logLoss;
  into.sumP += a.sumP;
  into.sumY += a.sumY;
  for (let i = 0; i < BINS; i++) {
    into.bins[i].n += a.bins[i].n;
    into.bins[i].sp += a.bins[i].sp;
    into.bins[i].sy += a.bins[i].sy;
  }
}

export interface CrackEpisodeEval {
  v: typeof CRACK_EVAL_VERSION;
  session: string;
  caseId: string;
  samples: number;
  cells: number;
  model: Acc;
  static: Acc;
  inArea: Count;
  outArea: Count;
  byBasis: Record<string, Acc>;
  /** Model accuracy on cells inside / outside his cursed area. */
  modelInArea: Acc;
  modelOutArea: Acc;
}

/** Records forecasts + truth of one episode (attach to simulateEpisode's onSample / onStep hooks). */
export class CrackEvalRecorder {
  private live: CrackstoneLive | null = null;
  private logIndex = 0;
  private steps = 0;
  private readonly truth: { t: number; bits: Uint8Array }[] = [];
  private readonly forecasts: { t: number; p: Float64Array; staticP: Float64Array; basis: string }[] = [];
  private inArea: Uint8Array | null = null;
  private failed = false;

  /** The live glue (built at the first sample, exactly like the live engine). */
  private glue(run: MysteryRun): CrackstoneLive | null {
    if (this.failed) return null;
    if (!this.live) {
      const m = run.crackstoneBrain ? crackstoneRiskFor(run) : null;
      if (!m) {
        this.failed = true;
        return null;
      }
      this.live = new CrackstoneLive(run, m);
      this.inArea = Uint8Array.from(m.cells.map((c) => (c.inArea ? 1 : 0)));
    }
    return this.live;
  }

  /** 1 Hz sample (before the step): the live forecast. Returns here.p / fact for the evaluation-only row columns. */
  onSample(run: MysteryRun): { here: number; fact: string } | null {
    const g = this.glue(run);
    if (!g || run.status !== 'playing') return null;
    const f = g.sample(run);
    if (!f) return null;
    const m = g.riskModel;
    this.forecasts.push({ t: run.t, p: Float64Array.from(f.cells.map((c) => c.p)), staticP: m.staticP, basis: f.basis ?? 'patrol' });
    return { here: f.here.p, fact: f.here.fact ?? '' };
  }

  /** After every sim step: feed the frame's events + public state to the glue; record the truth every 0.25 s / pulse. */
  onStep(run: MysteryRun): void {
    const g = this.glue(run);
    if (!g) return;
    const log = run.log as readonly StampedEvent[];
    let pulse = false;
    for (; this.logIndex < log.length; this.logIndex++) {
      const e = log[this.logIndex];
      if (e.type === 'crackstone_mode' || e.type === 'crackstone_scan' || e.type === 'curse') g.onEvent(run, e);
      if (e.type === 'crackstone_scan' && e.phase === 'pulse') pulse = true;
    }
    g.noteFrame(run);
    this.steps++;
    if (pulse) this.truth.push({ t: run.t, bits: this.pulseBits(run, g) });
    if (this.steps % TRUTH_EVERY_STEPS === 0) this.truth.push({ t: run.t, bits: this.sightBits(run, g) });
  }

  private sightBits(run: MysteryRun, g: CrackstoneLive): Uint8Array {
    const m = g.riskModel;
    const bits = new Uint8Array(m.C);
    const brain = run.crackstoneBrain!;
    const c = brain.c;
    const t = run.t;
    if (!brain.active || t < c.stunnedUntil || brain.isLured(t) || run.status !== 'playing') return bits;
    const cfg = brain.cfg;
    const distracted = t < c.distractedUntil;
    const k = cfg.returnSightMult;
    const sight = c.mode === 'RETURN' ? { ...cfg.sight, rangeM: cfg.sight.rangeM * k, fogRangeM: cfg.sight.fogRangeM * k } : cfg.sight;
    const fogC = run.inFog(c.x, c.z);
    const reach = Math.max(sight.rangeM, sight.fogRangeM, cfg.proximityM) + 0.5;
    for (let i = 0; i < m.C; i++) {
      const cell = m.cells[i];
      const d = Math.hypot(cell.px - c.x, cell.pz - c.z);
      if (d > reach) continue;
      if (!distracted && d <= cfg.proximityM && run.world.lineOfSight(c.x, c.z, cell.px, cell.pz, false)) {
        bits[i] = 1;
        continue;
      }
      if (canSee(run.world, sight, c, { x: cell.px, z: cell.pz, crouched: false, hiddenRevealM: null }, { fog: fogC || cell.fog, distracted }).seen) bits[i] = 1;
    }
    return bits;
  }

  private pulseBits(run: MysteryRun, g: CrackstoneLive): Uint8Array {
    const m = g.riskModel;
    const bits = new Uint8Array(m.C);
    const c = run.crackstoneBrain!.c;
    const r = c.scan?.radiusM ?? run.crackstoneBrain!.cfg.scanRadiusM;
    for (let i = 0; i < m.C; i++) {
      const cell = m.cells[i];
      if (Math.hypot(cell.px - c.x, cell.pz - c.z) <= r && run.world.lineOfSight(c.x, c.z, cell.px, cell.pz, false)) bits[i] = 1;
    }
    return bits;
  }

  /** Labels + accumulators of the episode (null without a Crackstone). */
  finish(session: string, caseId: string, horizonS = 10): CrackEpisodeEval | null {
    if (!this.live || !this.inArea) return null;
    const C = this.inArea.length;
    const endT = this.truth.length ? this.truth[this.truth.length - 1].t : 0;
    const out: CrackEpisodeEval = {
      v: CRACK_EVAL_VERSION, session, caseId, samples: 0, cells: C, model: emptyAcc(), static: emptyAcc(), inArea: { n: 0, y: 0 }, outArea: { n: 0, y: 0 },
      byBasis: {}, modelInArea: emptyAcc(), modelOutArea: emptyAcc(),
    };
    let j0 = 0;
    const y = new Uint8Array(C);
    for (const f of this.forecasts) {
      if (f.t + horizonS > endT) break;
      y.fill(0);
      while (j0 < this.truth.length && this.truth[j0].t <= f.t + 1e-9) j0++;
      for (let j = j0; j < this.truth.length && this.truth[j].t <= f.t + horizonS + 1e-9; j++) {
        const b = this.truth[j].bits;
        for (let i = 0; i < C; i++) if (b[i]) y[i] = 1;
      }
      out.samples++;
      const basis = (out.byBasis[f.basis] ??= emptyAcc());
      for (let i = 0; i < C; i++) {
        addTo(out.model, f.p[i], y[i]);
        addTo(out.static, f.staticP[i], y[i]);
        addTo(basis, f.p[i], y[i]);
        const g = this.inArea[i] ? out.inArea : out.outArea;
        g.n++;
        g.y += y[i];
        addTo(this.inArea[i] ? out.modelInArea : out.modelOutArea, f.p[i], y[i]);
      }
    }
    return out;
  }
}

// ----------------------------------------------------------------------------------------------------- summary

export interface Bin { lower: number; upper: number; count: number; meanPredicted: number; observedRate: number }
export interface Score { n: number; brier: number; logLoss: number; meanP: number; baseRate: number; calibration: Bin[] }

export function scoreOf(a: Acc): Score {
  return {
    n: a.n, brier: r4(a.n ? a.brier / a.n : 0), logLoss: r4(a.n ? a.logLoss / a.n : 0), meanP: r4(a.n ? a.sumP / a.n : 0), baseRate: r4(a.n ? a.sumY / a.n : 0),
    calibration: a.bins.map((b, i) => ({ lower: i / BINS, upper: (i + 1) / BINS, count: b.n, meanPredicted: r4(b.n ? b.sp / b.n : 0), observedRate: r4(b.n ? b.sy / b.n : 0) })),
  };
}

const r4 = (x: number) => Math.round(x * 10000) / 10000;

/** Brier of a constant prediction b on a {n, y} count. */
export function constBrier(c: Count, b: number): number {
  return c.n ? (c.y * (1 - b) ** 2 + (c.n - c.y) * b ** 2) / c.n : 0;
}

export interface CrackSummary {
  sessions: number;
  samples: number;
  cellForecasts: number;
  model: Score;
  staticRoute: Score;
  constant: { rate: number; brier: number };
  area: { inRate: number; outRate: number; brier: number };
  byCase: Record<string, { sessions: number; model: Score; staticRoute: Score; constantBrier: number; areaBrier: number }>;
  byBasis: Record<string, Score>;
  inArea: { model: Score; areaRateBrier: number };
  outArea: { model: Score; areaRateBrier: number };
}

function groupScore(evals: CrackEpisodeEval[]): { model: Acc; stat: Acc; inA: Count; outA: Count; samples: number } {
  const model = emptyAcc();
  const stat = emptyAcc();
  const inA = { n: 0, y: 0 };
  const outA = { n: 0, y: 0 };
  let samples = 0;
  for (const e of evals) {
    mergeAcc(model, e.model);
    mergeAcc(stat, e.static);
    inA.n += e.inArea.n;
    inA.y += e.inArea.y;
    outA.n += e.outArea.n;
    outA.y += e.outArea.y;
    samples += e.samples;
  }
  return { model, stat, inA, outA, samples };
}

/** Pooled held-out summary of per-episode records; baseline rates from `train` (default: the evaluated records). */
export function summariseCrack(evals: CrackEpisodeEval[], train: CrackEpisodeEval[] = evals): CrackSummary {
  const g = groupScore(evals);
  const tr = groupScore(train);
  const all = { n: g.inA.n + g.outA.n, y: g.inA.y + g.outA.y };
  const trAll = { n: tr.inA.n + tr.outA.n, y: tr.inA.y + tr.outA.y };
  const rate = trAll.n ? trAll.y / trAll.n : 0;
  const inRate = tr.inA.n ? tr.inA.y / tr.inA.n : 0;
  const outRate = tr.outA.n ? tr.outA.y / tr.outA.n : 0;
  const areaBrier = all.n ? (constBrier(g.inA, inRate) * g.inA.n + constBrier(g.outA, outRate) * g.outA.n) / all.n : 0;
  const byCase: CrackSummary['byCase'] = {};
  for (const id of [...new Set(evals.map((e) => e.caseId))].sort()) {
    const mine = evals.filter((e) => e.caseId === id);
    const c = groupScore(mine);
    const ct = groupScore(train.filter((e) => e.caseId === id));
    const n = c.inA.n + c.outA.n;
    const cAll = { n, y: c.inA.y + c.outA.y };
    const tn = ct.inA.n + ct.outA.n;
    const cIn = ct.inA.n ? ct.inA.y / ct.inA.n : 0;
    const cOut = ct.outA.n ? ct.outA.y / ct.outA.n : 0;
    byCase[id] = {
      sessions: mine.length, model: scoreOf(c.model), staticRoute: scoreOf(c.stat), constantBrier: r4(constBrier(cAll, tn ? (ct.inA.y + ct.outA.y) / tn : 0)),
      areaBrier: r4(n ? (constBrier(c.inA, cIn) * c.inA.n + constBrier(c.outA, cOut) * c.outA.n) / n : 0),
    };
  }
  const byBasis: Record<string, Score> = {};
  const basisAcc: Record<string, Acc> = {};
  for (const e of evals) for (const [k, a] of Object.entries(e.byBasis)) mergeAcc((basisAcc[k] ??= emptyAcc()), a);
  for (const [k, a] of Object.entries(basisAcc)) byBasis[k] = scoreOf(a);
  const mi = emptyAcc();
  const mo = emptyAcc();
  for (const e of evals) {
    mergeAcc(mi, e.modelInArea);
    mergeAcc(mo, e.modelOutArea);
  }
  return {
    sessions: evals.length, samples: g.samples, cellForecasts: g.model.n, model: scoreOf(g.model), staticRoute: scoreOf(g.stat),
    constant: { rate: r4(rate), brier: r4(constBrier(all, rate)) }, area: { inRate: r4(inRate), outRate: r4(outRate), brier: r4(areaBrier) },
    byCase, byBasis,
    inArea: { model: scoreOf(mi), areaRateBrier: r4(constBrier(g.inA, inRate)) },
    outArea: { model: scoreOf(mo), areaRateBrier: r4(constBrier(g.outA, outRate)) },
  };
}
