// TelemetryCollector + MysteryAnalytics driven like the app (run.update per frame): immutable log, thinned uploads that
// keep every rule event, payloads accepted by the real Edge Function parsers, V hints → advice records, results panels.
import { describe, expect, it } from 'vitest';
import { parseMysteryAppend } from '../../../supabase/functions/_shared/mystery-validation.ts';
import { createMysteryAnalytics } from '../../../src/mystery/analytics/index.ts';
import { MysteryAnalytics } from '../../../src/mystery/analytics/session.ts';
import { duoFactorsFromRun } from '../../../src/mystery/analytics/state.ts';
import { eventFromRow, TelemetryCollector, thinForUpload } from '../../../src/mystery/analytics/telemetry.ts';
import { dashboard } from '../../../src/mystery/analytics/index.ts';
import { Bot } from '../../../src/mystery/bot.ts';
import { CASES } from '../../../src/mystery/data/cases.ts';
import { CASE_SOLUTIONS } from '../../../src/mystery/data/solutions.ts';
import { MysteryRun } from '../../../src/mystery/run.ts';
import { CASE_IDS, type CaseId, type Duo, type StampedEvent } from '../../../src/mystery/types.ts';
import { NAMED_DUOS, episode, stamp } from './helpers.ts';

const SID = '6f1d2c3b-4a59-4e6f-8a7b-9c0d1e2f3a4b';
const RULE_TYPES = new Set(['clue_found', 'egg_pickup', 'egg_drop', 'egg_damage', 'egg_delivered', 'catch', 'accusation', 'finish', 'dnf', 'hyde_sighted', 'hint_requested', 'hyde_mode', 'hyde_heard', 'stance', 'ability_used']);

/** Plays a run through run.update like the app does, pressing V every `hintEveryS` seconds. */
function playLikeApp(duo: Duo, seed: string, hintEveryS = 12, model?: unknown, caseId?: CaseId) {
  const run = new MysteryRun({ duo, seed, tutorial: true, ...(caseId ? { caseDef: CASES[caseId] } : {}) });
  const analytics = model === undefined ? createMysteryAnalytics(run, { sessionId: SID, stationId: 'station_a' }) : new MysteryAnalytics(run, { sessionId: SID, model });
  const bot = new Bot(run, { profile: 'careless', sprintProb: 0.5, useAbilities: true, startDelayMaxS: 0 }, seed);
  // a little tutorial input (seq 0 events must be ignored)
  for (let i = 0; i < 30; i++) analytics.frame(run, run.update(1 / 60, { ...bot.decide(), hint: false }));
  run.endTutorial();
  const outputs: ReturnType<MysteryAnalytics['frame']>[] = [];
  let nextHint = hintEveryS;
  while (run.status === 'playing' && run.t < 400) {
    const input = bot.decide();
    const hint = run.t >= nextHint;
    if (hint) nextHint += hintEveryS;
    outputs.push(analytics.frame(run, run.update(1 / 60, { ...input, hint })));
  }
  if (run.status === 'accusing') outputs.push(analytics.frame(run, run.accuse(bot.accusation(), CASE_SOLUTIONS[run.caseDef.id])));
  return { run, analytics, outputs };
}

describe('TelemetryCollector', () => {
  it('keeps an immutable, strictly ordered log and ignores tutorial / duplicate events', () => {
    const run = new MysteryRun({ duo: { characterId: 'gomez', pokemonId: 'gengar' }, seed: 't-1', tutorial: false });
    const c = new TelemetryCollector({ sessionId: null, stationId: null, duo: run.duo, factors: duoFactorsFromRun(run) });
    const ev = stamp([[1, { type: 'hint_requested' }], [2, { type: 'egg_pickup' }]]);
    expect(c.ingest([{ ...ev[0], seq: 0 } as StampedEvent])).toBe(0);
    expect(c.ingest(ev)).toBe(2);
    expect(c.ingest(ev)).toBe(0);
    expect(Object.isFrozen(c.events[0])).toBe(true);
    expect(() => {
      (c.events[0] as { t: number }).t = 99;
    }).toThrow();
    ev[0].t = 50; // mutating the caller's object never changes the log
    expect(c.events[0].t).toBe(1);
  });

  it('thinning drops only unheard footsteps', () => {
    const ev = stamp([
      [1, { type: 'noise', source: 'footstep', x: 0, z: 0, loudness: 0.35, radiusM: 7 }],
      [2, { type: 'noise', source: 'footstep', x: 0, z: 0, loudness: 0.95, radiusM: 13 }],
      [2, { type: 'hyde_heard', source: 'footstep', loudness: 0.95, distanceM: 8, occluded: false }],
      [3, { type: 'noise', source: 'egg_drop', x: 0, z: 0, loudness: 1, radiusM: 17 }],
    ]);
    expect(thinForUpload(ev).map((e) => e.seq)).toEqual([2, 3, 4]);
  });

  it('bot episode: uploads keep every rule event, pass the Edge Function parser and resume after ack', () => {
    const ep = episode({ characterId: 'ajax', pokemonId: 'gholdengo' }, 'tele-1', { profile: 'careless', sprintProb: 0.6 });
    const c = ep.collector;
    const sent: StampedEvent[] = [];
    let batches = 0;
    // batch size relative to this episode's upload so it always needs several batches (episode length is seed-dependent)
    const size = Math.max(10, Math.ceil(thinForUpload(c.events).length / 4));
    for (let b = c.pendingBatch(size); b; b = c.pendingBatch(size)) {
      batches++;
      expect(b.events.length).toBeLessThanOrEqual(size);
      const body = parseMysteryAppend({ sessionId: SID, events: b.events, forecasts: b.forecasts, recommendations: b.recommendations });
      expect(body.events.length).toBe(b.events.length);
      // retry before ack returns the same batch
      expect(c.pendingBatch(size)?.events.map((e) => e.seq)).toEqual(b.events.map((e) => e.seq));
      sent.push(...b.events);
      c.ackBatch(b);
    }
    expect(batches).toBeGreaterThan(1);
    const rule = c.events.filter((e) => RULE_TYPES.has(e.type));
    expect(sent.filter((e) => RULE_TYPES.has(e.type))).toEqual(rule);
    expect(sent.length).toBeLessThan(c.events.length); // footsteps thinned
    for (let i = 1; i < sent.length; i++) expect(sent[i].seq).toBeGreaterThan(sent[i - 1].seq);
    // rows round-trip
    const { type, t, seq, ...payload } = sent[0];
    expect(eventFromRow({ seq, t, type, payload })).toEqual(sent[0]);
  }, 60_000);
});

describe('MysteryAnalytics (app wiring)', () => {
  it('drives all four layers through run.update frames for the named duos', () => {
    for (const [i, duo] of NAMED_DUOS.entries()) {
      const { run, analytics, outputs } = playLikeApp(duo, `app-${i}`);
      const hints = run.log.filter((e) => e.type === 'hint_requested').length;
      expect(hints).toBeGreaterThan(0);
      const hintAdvice = analytics.adviceRecords.filter((r) => r.trigger === 'hint');
      expect(hintAdvice.length).toBe(hints);
      expect(outputs.some((o) => o.risk && o.risk.source === 'ml')).toBe(true);
      // risk updates at ≤ 1 Hz
      const sampledTimes = analytics.riskSeries.map((p) => p.t);
      for (let k = 1; k < sampledTimes.length; k++) expect(sampledTimes[k] - sampledTimes[k - 1]).toBeGreaterThanOrEqual(0.98);
      expect(analytics.collector.events).toEqual(run.log);
      const rep = analytics.report();
      expect(rep.descriptive.activeTimeS).toBe(run.result()?.activeTimeS);
      expect(rep.predictive.label).toMatch(/^ML estimate · trained on simulated episodes · held-out Brier \d\.\d{3} \(baseline \d\.\d{3}\)$/);
      expect(rep.prescriptive.engine).toBe('rule-based decision engine');
      expect(rep.prescriptive.rows.length).toBe(analytics.adviceRecords.length);
      expect(rep.prescriptive.rows.every((r) => r.status !== 'Pending')).toBe(true);
      expect(rep.prescriptive.summary.text).toMatch(/^You followed \d+ of \d+ tips?\./);
      expect(rep.diagnostic.top.length).toBeLessThanOrEqual(3);
      // Supabase: everything uploads through the real parser (forecasts + recommendation upserts included)
      let forecasts = 0;
      let recs = 0;
      for (let b = analytics.pendingBatch(); b; b = analytics.pendingBatch()) {
        const body = parseMysteryAppend({ sessionId: SID, events: b.events, forecasts: b.forecasts, recommendations: b.recommendations });
        forecasts += body.forecasts.length;
        recs += body.recommendations.length;
        analytics.ackBatch(b);
      }
      expect(forecasts).toBe(analytics.collector.forecasts.length);
      expect(recs).toBeGreaterThanOrEqual(analytics.adviceRecords.length);
      // dashboard over this session
      const d = dashboard([analytics.sessionRecord()]);
      expect(d.descriptive.runs).toBe(1);
      expect(d.prescriptive.given).toBe(analytics.adviceRecords.length);
      expect(d.predictive.card.source).toBe('ml');
      expect(d.predictive.live.n).toBeGreaterThan(0);
    }
  }, 120_000);

  it('is case-aware end to end: meta, report, session record, forecasts and the per-case dashboard', () => {
    const records = [];
    for (const [i, caseId] of CASE_IDS.entries()) {
      const { run, analytics } = playLikeApp(NAMED_DUOS[i], `app-case-${i}`, 15, undefined, caseId);
      expect(analytics.caseId).toBe(caseId);
      expect(analytics.caseVersion).toBe(CASES[caseId].version);
      expect(analytics.collector.meta).toMatchObject({ caseId, caseVersion: CASES[caseId].version });
      const rep = analytics.report();
      expect(rep.descriptive.caseId).toBe(caseId);
      expect(rep.descriptive.clues.total).toBe(CASES[caseId].clues.length);
      const res = run.result()!;
      expect(rep.descriptive.accusation.kind).toBe(
        res.outcome === 'dnf' ? 'dnf' : res.verdict === 'case_solved' ? 'solved' : res.verdict === 'not_accused' ? 'not_accused' : res.correct ? 'right_suspect_wrong_evidence' : 'wrong_suspect',
      );
      if (res.verdict !== 'case_solved') expect(rep.diagnostic.reasons.length).toBeGreaterThan(0);
      else expect(rep.diagnostic.caseReasons).toEqual([]);
      const rec = analytics.sessionRecord();
      expect(rec).toMatchObject({ caseId, caseVersion: CASES[caseId].version });
      expect(rec.result).toMatchObject({ caseId, correct: res.correct, deductionCorrect: res.deductionCorrect });
      expect(JSON.stringify(rec.result)).not.toContain('accused');
      records.push(rec);
    }
    const d = dashboard(records);
    expect(d.scope).toBe('all');
    expect(d.descriptive.cases.map((c) => [c.caseId, c.runs])).toEqual(CASE_IDS.map((id) => [id, 1]));
    expect(dashboard(records, { caseId: 'crypt_last_witness' }).descriptive.runs).toBe(1);
    // a legacy (case-less) record is excluded from every case view, and counted as such
    const legacy = { ...records[0], sessionId: 'old', caseId: undefined, result: { ...records[0].result!, caseId: undefined } };
    const withLegacy = dashboard([...records, legacy]);
    expect(withLegacy.descriptive.runs).toBe(3);
    expect(withLegacy.descriptive.legacyExcluded).toBe(1);
  }, 180_000);

  it('without a model every surface says "Rule-based risk estimate"', () => {
    const { analytics } = playLikeApp({ characterId: 'wednesday', pokemonId: 'gengar' }, 'app-rule', 20, null);
    const rep = analytics.report();
    expect(rep.predictive.source).toBe('rule');
    expect(rep.predictive.label).toBe('Rule-based risk estimate · no trained model loaded');
    expect(analytics.currentRisk()?.label ?? 'Rule-based risk estimate').toBe('Rule-based risk estimate');
    // the trained-model targets fall back to rule-based (no model version); the Bayesian / spawn-rule / zone-filter
    // estimates are never ML either (their modelVersion names the method)
    const model = analytics.collector.forecasts.filter((f) => f.target === 'detection_15s' || f.target === 'extraction');
    expect(model.length).toBeGreaterThan(0);
    expect(model.every((f) => f.modelLabel === 'rule_based' && f.modelVersion === null)).toBe(true);
    expect(analytics.collector.forecasts.every((f) => f.modelLabel === 'rule_based')).toBe(true);
  }, 60_000);
});
