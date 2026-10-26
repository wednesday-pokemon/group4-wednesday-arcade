import { describe, expect, it } from 'vitest';
import {
  buildLegView, createInitialState, deriveLegContext, getPushOptions, prepareWithSeed, resolveWithSeed, simulateRace,
} from '../../../src/game/index.ts';
import type { GameState, LegView } from '../../../src/game/index.ts';
import { brierScore, calibrationBins, dot, fitLogistic, fitOls, sigmoid } from '../../../src/analytics/regression.ts';
import { buildRaceAutopsy, buildWaterfall, explainLeg } from '../../../src/analytics/diagnostics.ts';
import { buildLegFeatures } from '../../../src/analytics/features.ts';
import { adviseEgg, adviseRoute } from '../../../src/analytics/advisor.ts';
import { FUTURE_POLICIES } from '../../../src/analytics/policies.ts';
import { predictLeg } from '../../../src/analytics/ravenVision.ts';
import { summariseRecords } from '../../../src/analytics/descriptive.ts';

const FULL = { timeBudgetMs: Number.POSITIVE_INFINITY };

function freshState(overrides: Partial<GameState> = {}): GameState {
  return { ...createInitialState({ sessionId: 's-1', nickname: 'Tester', characterId: 'wednesday', pokemonId: 'gengar' }), ...overrides };
}

const view = (state: GameState, weather: LegView['weather'] = 'clear'): LegView =>
  ({ legIndex: state.legIndex, legName: 'test', weather, visibleOffers: {} });

describe('regression', () => {
  it('OLS recovers known linear coefficients', () => {
    const x: number[][] = [];
    const y: number[] = [];
    for (let i = 0; i < 200; i++) {
      const a = (i % 17) / 3;
      const b = (i % 7) - 3;
      x.push([1, a, b]);
      y.push(2 + 3 * a - 0.5 * b);
    }
    const w = fitOls(x, y, 0);
    expect(w[0]).toBeCloseTo(2, 6);
    expect(w[1]).toBeCloseTo(3, 6);
    expect(w[2]).toBeCloseTo(-0.5, 6);
  });

  it('logistic regression approaches the generating probabilities', () => {
    const x: number[][] = [];
    const y: number[] = [];
    for (let i = 0; i < 4000; i++) {
      const v = (i % 40) / 10 - 2;
      const p = sigmoid(0.5 + 1.5 * v);
      x.push([1, v]);
      y.push((i * 0.6180339887) % 1 < p ? 1 : 0);
    }
    const w = fitLogistic(x, y, 0);
    expect(w[0]).toBeCloseTo(0.5, 0);
    expect(w[1]).toBeCloseTo(1.5, 0);
    expect(brierScore(x.map((r) => sigmoid(dot(w, r))), y)).toBeLessThan(0.25);
  });

  it('calibration bins cover every prediction', () => {
    const bins = calibrationBins([0.05, 0.15, 0.95, 1], [0, 0, 1, 1]);
    expect(bins.reduce((s, b) => s + b.count, 0)).toBe(4);
    expect(bins[9].count).toBe(2);
  });
});

describe('diagnostic waterfall', () => {
  it('reconstructs every leg time exactly for many simulated races', () => {
    for (let i = 0; i < 300; i++) {
      const { state } = simulateRace({ seed: `wf-${i}`, characterId: 'ajax', pokemonId: 'alolan_marowak', policy: FUTURE_POLICIES['shortcuts from here'] });
      for (const r of state.legResults) {
        const steps = buildWaterfall(r.time);
        expect(steps[steps.length - 1].runningCs).toBe(r.time.totalCs);
        expect(steps.slice(0, -1).reduce((s, st) => s + st.deltaCs, 0)).toBe(r.time.totalCs);
        expect(explainLeg(r).length).toBeGreaterThan(0);
      }
      const autopsy = buildRaceAutopsy(state.legResults);
      expect(autopsy.totalCs).toBe(state.totalSimulatedTimeCs);
    }
  });

  it('shows an explicit floor adjustment when the 10 s minimum applies', () => {
    const t = { baseCs: 3400, discountPct: 80, speedSavingsCs: 2720, weatherDelayCs: 0, crashDelayCs: 0, eggDelayCs: 0, hydeDelayCs: 0, floorAdjustmentCs: 320, totalCs: 1000, discountSources: [] };
    const steps = buildWaterfall(t);
    expect(steps.map((s) => s.key)).toContain('floor');
    expect(steps[steps.length - 1].runningCs).toBe(1000);
  });
});

describe('Raven Vision features (leakage)', () => {
  it('features depend only on pre-decision information, not on the secret seed', () => {
    const s = freshState();
    const a = buildLegFeatures(s, 'heavy_fog', { route: 'shortcut', pushLevel: 2 }, 0.9);
    const b = buildLegFeatures({ ...s, sessionId: 'other' }, 'heavy_fog', { route: 'shortcut', pushLevel: 2 }, 0.9);
    expect(a.time).toEqual(b.time);
    expect(a.catch).toEqual(b.catch);
  });

  it('rule-based fallback is used when no model is supplied, and is honest about it', () => {
    const p = predictLeg(null, freshState(), 'clear', { route: 'safe', pushLevel: 2 }, 0.7);
    expect(p.source).toBe('rule_based');
    expect(p.catchP).toBe(0);
    expect(p.legTimeS).toBeCloseTo(42.24 + 0.7 * 5, 6);
  });
});

describe("Wednesday's strategic advice", () => {
  it('only evaluates and recommends legal stamina actions (A16)', () => {
    const tight = freshState({ stamina: 3 }); // leg 1 must keep 2 → only push 1 legal
    const legal = getPushOptions(tight).filter((o) => o.isLegal).map((o) => o.pushLevel);
    expect(legal).toEqual([1]);
    const advice = adviseRoute(tight, view(tight), { rollouts: 64, ...FULL });
    expect(advice.recommended?.pushLevel).toBe(1);
    expect(advice.candidates.every((c) => legal.includes(c.pushLevel))).toBe(true);
  });

  it('never offers Dragapult push 3 when the 4-stamina cost breaks the reserve', () => {
    const s = createInitialState({ sessionId: 'd', nickname: 'Drag', characterId: 'gomez', pokemonId: 'dragapult' });
    const tight = { ...s, stamina: 5 }; // 5 - 4 = 1 < 2 reserve on leg 1
    const advice = adviseRoute(tight, view(tight), { rollouts: 32, ...FULL });
    expect(advice.candidates.some((c) => c.pushLevel === 3)).toBe(false);
  });

  it('respects the 25 % DNF cap and falls back to the least risky option with a warning', () => {
    const s = freshState({ hydeCatchCount: 1, pursuitGapM: 30, legIndex: 3, stamina: 3 });
    const capped = adviseRoute(s, view(s, 'heavy_fog'), { rollouts: 128, ...FULL });
    const best = capped.candidates.find((c) => c.route === capped.recommended?.route && c.pushLevel === capped.recommended?.pushLevel)!;
    expect(best.pDnf).toBeLessThanOrEqual(0.25);
    const impossible = adviseRoute(s, view(s, 'heavy_fog'), { rollouts: 128, riskCap: -1, ...FULL });
    expect(impossible.constraintMet).toBe(false);
    expect(impossible.warning).toMatch(/least risky/);
    const minRisk = Math.min(...impossible.candidates.map((c) => c.pDnf));
    const chosen = impossible.candidates.find((c) => c.route === impossible.recommended?.route && c.pushLevel === impossible.recommended?.pushLevel)!;
    expect(chosen.pDnf).toBe(minRisk);
  });

  it('is deterministic for the same state (common random numbers, seed-independent)', () => {
    const s = freshState();
    const a = adviseRoute(s, view(s, 'strong_currents'), { rollouts: 96, ...FULL });
    const b = adviseRoute({ ...s, sessionId: 'different' }, view(s, 'strong_currents'), { rollouts: 96, ...FULL });
    expect(a.candidates.map((c) => [c.expectedScore, c.pDnf])).toEqual(b.candidates.map((c) => [c.expectedScore, c.pDnf]));
    expect(a.recommended).toEqual(b.recommended);
    expect(a.rolloutsPerCandidate).toBe(96);
  });

  it('advises on the revealed egg and disables collect when there is no egg', () => {
    const seed = 'egg-advice';
    let state = freshState({ sessionId: 'egg' });
    for (let attempt = 0; attempt < 50; attempt++) {
      const s = `${seed}-${attempt}`;
      const prepared = prepareWithSeed(state, s, { route: 'safe', pushLevel: 1 }, state.revision);
      if (!prepared.ok) throw new Error(prepared.error.message);
      const ctx = deriveLegContext(s, 1);
      const advice = adviseEgg(prepared.state, buildLegView(prepared.state, ctx), { rollouts: 32, ...FULL });
      if (ctx.offers.safe === 'none') {
        expect(advice.recommended?.eggDecision).toBe('skip');
        expect(advice.candidates).toHaveLength(1);
      } else {
        expect(advice.recommended?.eggDecision).toBe('collect');
      }
      const resolved = resolveWithSeed(prepared.state, s, advice.recommended!.eggDecision!, prepared.state.revision);
      expect(resolved.ok).toBe(true);
      state = freshState({ sessionId: `egg-${attempt}` });
    }
  });

  it('finishes 512 rollouts per candidate within a reasonable time', () => {
    const s = freshState();
    const advice = adviseRoute(s, view(s), FULL);
    expect(advice.rolloutsPerCandidate).toBe(512);
    expect(advice.elapsedMs).toBeLessThan(20000);
  });
});

describe('descriptive summaries', () => {
  it('summarises only real records and handles an empty set honestly', () => {
    expect(summariseRecords([]).averageScore).toBeNull();
  });
});
