// PredictiveService: the bundled artifact loads as an ML model with recorded held-out metrics; outputs are
// probabilities; anything missing / invalid falls back to the labelled rule-based estimate.
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { duoNumbers, featureVector, FEATURES } from '../../../src/mystery/analytics/features.ts';
import { anyWithin, detectionTimes } from '../../../src/mystery/analytics/labels.ts';
import { validateArtifact } from '../../../src/mystery/analytics/model.ts';
import { BUNDLED_MODEL } from '../../../src/mystery/analytics/model/index.ts';
import { bandFor, ML_LABEL, PredictiveService, RULE_LABEL } from '../../../src/mystery/analytics/predictive.ts';
import { featureInputFromRow, parseCsv } from '../../../src/mystery/analytics/dataset.ts';
import { auc, classifierMetrics, logLoss } from '../../../src/mystery/analytics/metrics.ts';
import { episode } from './helpers.ts';

const svc = new PredictiveService(BUNDLED_MODEL);

describe('PredictiveService', () => {
  it('loads the committed artifact as a trained ML model (trained on simulated episodes)', () => {
    expect(svc.invalidReason).toBeNull();
    expect(svc.source).toBe('ml');
    expect(svc.label).toBe(ML_LABEL);
    const m = svc.model!;
    expect(m.trainedOn).toMatch(/simulated/);
    expect(m.trainedOn).toMatch(/not real players/);
    expect(m.training.duos).toBe(126);
    expect(m.training.split).toMatch(/session-grouped/);
    expect(m.detection.features.every((f) => f in FEATURES || f.startsWith('room_'))).toBe(true);
    // features never encode an id
    expect(m.detection.features.some((f) => /character|pokemon/i.test(f))).toBe(false);
  });

  it('records held-out metrics produced by the evaluation run (not hand-typed)', () => {
    const det = svc.model!.metrics!.detection;
    expect(det.rows).toBeGreaterThan(1000);
    expect(det.sessions).toBe(svc.model!.training.sessionsTest);
    expect(det.calibration).toHaveLength(10);
    expect(det.calibration.reduce((s, c) => s + c.count, 0)).toBe(det.rows);
    expect(det.baseRate).toBeCloseTo(det.positives / det.rows, 3);
    // the report quotes exactly these numbers
    const report = readFileSync('docs/MYSTERY_MODEL_REPORT.md', 'utf8');
    expect(report).toContain(`| Brier score (lower is better) | ${det.brier.toFixed(4)} | ${det.baselineBrier.toFixed(4)} |`);
    expect(report).toContain(svc.model!.modelVersion);
    expect(report).toMatch(/Simulated bots ≠ people/);
    const card = svc.modelCard();
    expect(card.resultsLabel).toBe(`ML estimate · trained on simulated episodes · held-out Brier ${det.brier.toFixed(3)} (baseline ${det.baselineBrier.toFixed(3)})`);
    // when the generated data are present, re-scoring the holdout reproduces the stored Brier
    if (existsSync('data/mystery/rows.csv') && existsSync('data/mystery/split.json')) {
      const split = JSON.parse(readFileSync('data/mystery/split.json', 'utf8')) as { testSessions: string[] };
      const test = new Set(split.testSessions);
      const rows = parseCsv(readFileSync('data/mystery/rows.csv', 'utf8')).filter((r) => test.has(r.session) && r.det15 !== '');
      const p = rows.map((r) => svc.detection(featureInputFromRow(r)).p);
      const y = rows.map((r) => Number(r.det15));
      const again = classifierMetrics(p, y, test.size, det.trainBaseRate);
      expect(again.rows).toBe(det.rows);
      expect(again.brier).toBeCloseTo(det.brier, 4);
    }
  }, 60_000);

  it('outputs probabilities in [0, 1] with a band and top factors over many live snapshots', () => {
    const ep = episode({ characterId: 'morticia', pokemonId: 'trevenant' }, 'pred-1', { profile: 'careless', sprintProb: 0.6 });
    const duo = duoNumbers(ep.collector.meta.factors);
    const samples = ep.collector.samples;
    let chased = 0;
    for (let i = 0; i < samples.length; i++) {
      const x = { snapshot: samples[i].snapshot, prev: samples[i - 1]?.snapshot ?? null, context: samples[i].context, duo };
      const r = svc.detection(x);
      expect(r.p).toBeGreaterThanOrEqual(0);
      expect(r.p).toBeLessThanOrEqual(1);
      expect(r.band).toBe(bandFor(r.p));
      expect(r.source).toBe('ml');
      expect(r.label).toBe('ML estimate');
      if (x.snapshot.hydeMode === 'CHASE') {
        chased++;
        expect(r.detectedNow).toBe(true);
        expect(r.p).toBe(1);
      } else {
        expect(r.topFactors.length).toBeGreaterThan(0);
        expect(r.topFactors.length).toBeLessThanOrEqual(3);
      }
      const ex = svc.extraction(x);
      expect(ex.p).toBeGreaterThanOrEqual(0);
      expect(ex.p).toBeLessThanOrEqual(1);
    }
    expect(chased).toBeGreaterThan(0);
  }, 60_000);

  it('falls back to the labelled rule-based estimate when the artifact is missing or invalid', () => {
    const ep = episode({ characterId: 'morticia', pokemonId: 'trevenant' }, 'pred-1', { profile: 'careless', sprintProb: 0.6 });
    const duo = duoNumbers(ep.collector.meta.factors);
    const bad: unknown[] = [
      null,
      { schema: 'untrained' },
      { ...(BUNDLED_MODEL as object), rulesVersion: 'mystery-v3.0' },
      { ...(BUNDLED_MODEL as object), detection: { ...(BUNDLED_MODEL as { detection: object }).detection, features: ['no_such_feature'] } },
      { ...(BUNDLED_MODEL as object), detection: { ...(BUNDLED_MODEL as { detection: object }).detection, coef: [1, 2] } },
      { ...(BUNDLED_MODEL as object), trainedOn: 'real players' },
    ];
    for (const a of bad) {
      const s = new PredictiveService(a);
      expect(s.source).toBe('rule');
      expect(s.label).toBe(RULE_LABEL);
      expect(s.invalidReason).not.toBeNull();
      expect(s.modelCard().resultsLabel).toBe('Rule-based risk estimate · no trained model loaded');
      for (const smp of ep.collector.samples.slice(0, 60)) {
        const r = s.detection({ snapshot: smp.snapshot, prev: null, context: smp.context, duo });
        expect(r.source).toBe('rule');
        expect(r.label).toBe('Rule-based risk estimate');
        expect(r.modelVersion).toBeNull();
        expect(r.p).toBeGreaterThanOrEqual(0);
        expect(r.p).toBeLessThanOrEqual(1);
      }
    }
    expect(validateArtifact(BUNDLED_MODEL).ok).toBe(true);
  }, 60_000);

  it('features are computable for every snapshot and the label matches its definition', () => {
    const ep = episode({ characterId: 'ajax', pokemonId: 'basculegion' }, 'pred-2', { profile: 'careless', sprintProb: 0.5 });
    const names = svc.model!.detection.features;
    const det = detectionTimes(ep.collector.events);
    for (const s of ep.collector.samples) {
      const v = featureVector(names, { snapshot: s.snapshot, prev: null, context: s.context, duo: duoNumbers(ep.collector.meta.factors) });
      expect(v.every(Number.isFinite)).toBe(true);
      const y = anyWithin(det, s.snapshot.t);
      expect(y).toBe(det.some((x) => x > s.snapshot.t && x <= s.snapshot.t + 15));
    }
  });

  it('metric helpers behave', () => {
    expect(auc([0.1, 0.2, 0.8, 0.9], [0, 0, 1, 1])).toBe(1);
    expect(auc([0.5, 0.5], [0, 1])).toBe(0.5);
    expect(auc([0.3], [1])).toBeNull();
    expect(logLoss([0.5, 0.5], [0, 1])).toBeCloseTo(Math.log(2), 10);
  });
});
