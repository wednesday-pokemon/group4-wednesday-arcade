// A04: egg tables / weather sum to 1; empirical frequencies (fixed seeds, n >= 20k) within ±1.5 pp.
import { describe, expect, it } from 'vitest';
import {
  createStream, deriveLegContext, deriveLegDraws, EGG_TABLE, EGG_TIER_ORDER, keyedUniform, sampleLegContext, WEATHER,
  WEATHER_ORDER,
} from '../../../src/game/index.ts';
import type { EggTier, LegContext, LegIndex, RouteId, WeatherId } from '../../../src/game/index.ts';

const N = 20000;
const TOL = 0.015;
const LEGS_: LegIndex[] = [1, 2, 3];
const ROUTES: RouteId[] = ['safe', 'shortcut'];

function checkFrequencies(contexts: LegContext[], leg: LegIndex): void {
  const weather: Record<WeatherId, number> = { clear: 0, strong_currents: 0, heavy_fog: 0 };
  const eggs: Record<RouteId, Record<EggTier, number>> = {
    safe: { none: 0, common: 0, rare: 0, legendary: 0 },
    shortcut: { none: 0, common: 0, rare: 0, legendary: 0 },
  };
  for (const c of contexts) {
    weather[c.weather]++;
    for (const r of ROUTES) eggs[r][c.offers[r]]++;
  }
  for (const w of WEATHER_ORDER) expect(Math.abs(weather[w] / contexts.length - WEATHER[w].probability)).toBeLessThan(TOL);
  for (const r of ROUTES) {
    for (const t of EGG_TIER_ORDER) {
      const target = EGG_TABLE[r][leg][t];
      const freq = eggs[r][t] / contexts.length;
      expect(Math.abs(freq - target)).toBeLessThan(TOL);
      if (target === 0) expect(eggs[r][t]).toBe(0);
    }
  }
}

describe('probability tables', () => {
  it('egg rows and weather sum to 1', () => {
    for (const r of ROUTES) for (const l of LEGS_) {
      expect(EGG_TIER_ORDER.reduce((s, t) => s + EGG_TABLE[r][l][t], 0)).toBeCloseTo(1, 12);
    }
    expect(WEATHER_ORDER.reduce((s, w) => s + WEATHER[w].probability, 0)).toBeCloseTo(1, 12);
  });

  it.each(LEGS_)('seed-derived contexts match tables on leg %i (n=20000)', (leg) => {
    const contexts = Array.from({ length: N }, (_, i) => deriveLegContext(`dist-seed-${i}`, leg));
    checkFrequencies(contexts, leg);
  });

  it.each(LEGS_)('sampled contexts match tables on leg %i (n=20000)', (leg) => {
    const rng = createStream(`dist-stream-${leg}`);
    const contexts = Array.from({ length: N }, () => sampleLegContext(rng, leg));
    checkFrequencies(contexts, leg);
  });

  it('keyed draws are uniform-ish, in [0,1), stable and key-independent', () => {
    let sum = 0;
    let below = 0;
    let min = 1;
    let max = 0;
    for (let i = 0; i < N; i++) {
      const d = deriveLegDraws(`u-${i}`, 2);
      for (const v of [d.crash, d.eggFailure, d.hyde]) {
        min = Math.min(min, v);
        max = Math.max(max, v);
        sum += v;
        if (v < 0.3) below++;
      }
    }
    expect(min).toBeGreaterThanOrEqual(0);
    expect(max).toBeLessThan(1);
    expect(Math.abs(sum / (3 * N) - 0.5)).toBeLessThan(TOL);
    expect(Math.abs(below / (3 * N) - 0.3)).toBeLessThan(TOL);
    expect(keyedUniform('abc', 'L1:crash')).toBe(keyedUniform('abc', 'L1:crash'));
    expect(deriveLegContext('abc', 3)).toEqual(deriveLegContext('abc', 3));
  });
});
