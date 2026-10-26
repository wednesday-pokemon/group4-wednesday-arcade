// Analytics v2 (layer links): advice source tags, "Also considered" alternatives, prediction check-backs, the advice
// scorecard and "Why you lost points" — pure functions, plus their wiring through live() / report() on a bot episode.
import { describe, expect, it } from 'vitest';
import { createMysteryAnalytics } from '../../../src/mystery/analytics/index.ts';
import {
  ALT_LABEL, adviceScorecard, alternativesLine, alternativesOf, checkBackLine, lostPts, pointsLostItems, pointsLostLines, predictionRight,
  predictionSummary, sourceTag,
} from '../../../src/mystery/analytics/insights.ts';
import { oddsSource, summariseAdvice } from '../../../src/mystery/analytics/prescriptive.ts';
import type { AdviceOption, LiveMessage } from '../../../src/mystery/analytics/types.ts';
import { Bot } from '../../../src/mystery/bot.ts';
import { CASES } from '../../../src/mystery/data/cases.ts';
import { MysteryRun } from '../../../src/mystery/run.ts';
import { scoreV4 } from '../../../src/mystery/scoring.ts';
import { CASE_IDS, type ScoreBreakdown } from '../../../src/mystery/types.ts';
import { diagnosticDropRanks } from '../../../src/ui/mystery/LayerPanels.tsx';
import { stamp } from './helpers.ts';

const option = (action: AdviceOption['action'], score: number, extra: Partial<AdviceOption> = {}): AdviceOption => ({
  action, text: 't', reason: 'r', feasible: true, score, target: { x: 1, z: 2 }, ability: null, clueId: null, ...extra,
});
const breakdown = (o: Partial<ScoreBreakdown>): ScoreBreakdown => ({
  delivery: 1000, accusation: 300, clues: 300, noDetection: 150, noHints: 150, timeBonus: 100, hintPenalty: 0, hitPenalty: 0, total: 0, ...o,
});

describe('advice source tag', () => {
  it('shows the forecast / diagnostic layer, nothing for descriptive or unknown', () => {
    expect(sourceTag('predictive')).toBe('Predictive');
    expect(sourceTag('diagnostic', 'saw you hide')).toBe('Diagnostic: saw you hide');
    expect(sourceTag('diagnostic')).toBe('Diagnostic');
    expect(sourceTag('descriptive')).toBeNull();
    expect(sourceTag(undefined)).toBeNull();
  });
  it('an odds reason is predictive while uncertain and an observed fact once certain (same threshold as the copy)', () => {
    expect(oddsSource(0.6)).toBe('predictive');
    expect(oddsSource(0.994)).toBe('predictive');
    expect(oddsSource(0.995)).toBe('descriptive');
    expect(oddsSource(1)).toBe('descriptive');
  });
});

describe('"Also considered" alternatives', () => {
  it('top 2 feasible other actions, best first, rounded scores, generic labels (no targets)', () => {
    const alts = alternativesOf(option('crouch', 80), [option('search_room', 35.4), option('crouch', 70), option('hide', 50.6), option('stay_quiet', 20)]);
    expect(alts).toEqual([{ action: 'hide', label: 'Hide', score: 51 }, { action: 'search_room', label: 'Keep searching', score: 35 }]);
    expect(alternativesLine(alts)).toBe('Also considered: Hide 51 · Keep searching 35');
    expect(JSON.stringify(alts)).not.toMatch(/"x"|"z"|target/);
  });
  it('none → no line; duplicates and infeasible options are skipped', () => {
    expect(alternativesLine([])).toBeNull();
    expect(alternativesLine(undefined)).toBeNull();
    expect(alternativesOf(option('hide', 90), [option('hide', 80), { ...option('crouch', 70), feasible: false as unknown as true }])).toEqual([]);
  });
  it('every action has a short public label (never a place name)', () => {
    for (const [action, label] of Object.entries(ALT_LABEL)) {
      expect(label.length, action).toBeLessThanOrEqual(16);
      expect(label).not.toMatch(/Archive|Greenhouse|Tower Yard|Crypt|Garden|Iago/);
    }
  });
});

describe('prediction check-backs', () => {
  it('right = shown ≥ 50 % and found, or < 50 % and empty', () => {
    expect(predictionRight(60, true)).toBe(true);
    expect(predictionRight(50, false)).toBe(false);
    expect(predictionRight(45, false)).toBe(true);
    expect(predictionRight(40, true)).toBe(false);
  });
  it("Thing's LOG line uses the displayed text; ✓ / ✗ = the prediction was right / wrong", () => {
    expect(checkBackLine({ pct: 60, text: '60%', found: true })).toBe('Predicted 60% here: found it ✓');
    expect(checkBackLine({ pct: 40, text: '40%', found: false })).toBe('Predicted 40% here: empty ✓');
    expect(checkBackLine({ pct: 70, text: '70%', found: false })).toBe('Predicted 70% here: empty ✗');
    expect(checkBackLine({ pct: 0, text: '<5%', found: true })).toBe('Predicted <5% here: found it ✗');
    expect(checkBackLine({ pct: 95, text: '>95%', found: true }).length).toBeLessThanOrEqual(34); // LOG_MAX
  });
  it('counts N of M right with a trivial calibration note (≥ 2 checks)', () => {
    expect(predictionSummary([])).toBeNull();
    expect(predictionSummary(null)).toBeNull();
    const one = predictionSummary([{ pct: 60, found: true }])!;
    expect(one.text).toBe('Thing’s predictions: 1 of 1 right');
    expect(one.calibration).toBeNull();
    const s = predictionSummary([{ pct: 60, found: true }, { pct: 40, found: false }, { pct: 70, found: false }, { pct: 10, found: false }])!;
    expect(s).toMatchObject({ total: 4, right: 3, found: 1, meanPct: 45 });
    expect(s.text).toBe('Thing’s predictions: 3 of 4 right');
    expect(s.calibration).toBe('avg 45% · found 25%');
  });
});

describe('advice scorecard', () => {
  it('derived from the follow-up records; hidden without advice; "after", never "because"', () => {
    expect(adviceScorecard(summariseAdvice([]))).toBeNull();
    expect(adviceScorecard(null)).toBeNull();
    const recs = [
      { followed: true, outcome: 'undetected_15s' as const }, { followed: true, outcome: 'undetected_15s' as const }, { followed: true, outcome: 'detected_15s' as const },
      { followed: false, outcome: 'undetected_15s' as const }, { followed: null, outcome: null },
    ];
    const line = adviceScorecard(summariseAdvice(recs))!;
    expect(line).toBe('Followed 3 of 5 tips · unseen 15 s after 2 of them');
    expect(line).not.toMatch(/because|kept you/i);
    expect(adviceScorecard(summariseAdvice([{ followed: true, outcome: 'undetected_15s' }, { followed: true, outcome: null }]))).toBe('Followed 2 of 2 tips · unseen 15 s after 1 of 1');
    expect(adviceScorecard(summariseAdvice([{ followed: false, outcome: null }]))).toBe('Followed 0 of 1 tip');
  });
});

describe('why you lost points', () => {
  const log = stamp([
    [5, { type: 'stance', stance: 'sprint' }],
    [20, { type: 'enemy_detected', enemy: 'hyde', via: 'sight' }],
    [30, { type: 'enemy_hit', enemy: 'slurp', hpLost: 20, blocked: false }],
    [40, { type: 'stance', stance: 'walk' }],
    [62, { type: 'hint_requested', level: 1 }],
    [130, { type: 'enemy_hit', enemy: 'crackstone', hpLost: 0, blocked: true }],
    [150, { type: 'enemy_hit', enemy: 'hyde', hpLost: 30, blocked: false }],
  ]);
  it('bonuses lost with the event that cost them, hits with the stance cause, hints, missing clues — biggest first, ≤ 5', () => {
    const b = scoreV4({ delivered: true, correct: true, cluesFound: 2, detections: 1, hintsUsed: 1, hits: 3, activeTimeS: 200 });
    const lines = pointsLostLines(log, b);
    expect(lines).toEqual([
      '−150 Never detected: Hyde spotted you at 0:20',
      '−150 No hints: Weems hint at 1:02',
      '−100 Clues: 2 of 3 found',
      '−75 Slurp hit at 0:30 (you were sprinting)',
      '−75 Crackstone hit at 2:10 (blocked)',
    ]);
    expect(pointsLostItems(log, b, { max: 10 })).toHaveLength(7); // + the Hyde hit (walking: no cause) and the −50 hint
    expect(pointsLostItems(log, b, { max: 10 }).map((x) => x.text)).toContain('Hyde hit at 2:30');
    expect(lostPts(75)).toBe('−75');
  });
  it('a clean run, no breakdown, or tutorial events → nothing invented', () => {
    expect(pointsLostLines(log, breakdown({}))).toEqual([]);
    expect(pointsLostLines(log, null)).toEqual([]);
    const tut = [{ type: 'enemy_hit', enemy: 'hyde', hpLost: 10, blocked: false, t: 1, seq: 0 }] as never;
    expect(pointsLostLines(tut, breakdown({ hitPenalty: -75 }))).toEqual(['−75 Hits']);
  });
  it('the Diagnostic panel drops pattern, then causes, then the smallest points-lost rows, cases last', () => {
    const r = diagnosticDropRanks(2, 3, 2, true);
    const order = [
      ...r.cases.map((x, i) => [x, `case${i}`] as const), ...r.lost.map((x, i) => [x, `lost${i}`] as const),
      ...r.causes.map((x, i) => [x, `cause${i}`] as const), [r.pattern!, 'pattern'] as const,
    ].sort((a, b) => a[0] - b[0]).map((x) => x[1]);
    expect(order).toEqual(['pattern', 'cause1', 'cause0', 'lost2', 'lost1', 'lost0', 'case1', 'case0']);
  });
});

describe('wiring on real bot episodes', () => {
  it('live advice carries ≤ 2 public alternatives and an honest source; report() carries checks + points lost', () => {
    let withAlt = 0;
    let withSource = 0;
    for (const [i, caseId] of CASE_IDS.entries()) {
      const run = new MysteryRun({ duo: { characterId: 'enid', pokemonId: 'gengar' }, seed: `insights-${i}`, tutorial: false, caseDef: CASES[caseId] });
      const a = createMysteryAnalytics(run);
      const bot = new Bot(run, { profile: 'careless', sprintProb: 0.4, useAbilities: true, startDelayMaxS: 0 }, `insights-${i}`);
      let k = 0;
      while (run.status === 'playing' && run.t < 240) {
        a.frame(run, run.update(1 / 30, bot.decide()));
        if (k++ % 8 !== 0) continue;
        const L = a.live();
        const msgs: LiveMessage[] = [...L.messages.filter((m) => m.kind === 'advice'), ...(L.advice ? [L.advice] : [])];
        for (const m of msgs) {
          if (m.alternatives) {
            withAlt++;
            expect(m.alternatives.length).toBeGreaterThan(0);
            expect(m.alternatives.length).toBeLessThanOrEqual(2);
            for (const alt of m.alternatives) {
              expect(alt.label).toBe(ALT_LABEL[alt.action]);
              expect(Number.isInteger(alt.score)).toBe(true);
            }
          }
          if (m.source === 'predictive') {
            withSource++;
            expect(m.why ?? '').toMatch(/\d+%|<5%|>95%/); // a forecast reason always shows the displayed number
          }
          if (m.source === 'diagnostic') expect(m.sourceNote).toBeTruthy();
        }
      }
      // the HUD reports a check; the report carries it (and finished runs get their points-lost items)
      a.notePredictionCheck({ t: run.t, site: 'egg', siteId: 'x', pct: 40, text: '40%', found: false });
      a.notePredictionCheck({ t: run.t, site: 'egg', siteId: 'x', pct: 40, text: '40%', found: false }); // same event twice → once
      const rep = a.report();
      expect(rep.predictive.checks).toEqual([{ t: run.t, site: 'egg', siteId: 'x', pct: 40, text: '40%', found: false }]);
      expect(Array.isArray(rep.diagnostic.pointsLost)).toBe(true);
      if (run.status !== 'finished') expect(rep.diagnostic.pointsLost).toEqual([]);
    }
    expect(withAlt).toBeGreaterThan(0);
    expect(withSource).toBeGreaterThan(0);
  }, 90_000);
});
