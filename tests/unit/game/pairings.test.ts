// A01: all 12 x 18 = 216 roster pairings resolve full-finish and DNF paths without exceptions.
import { describe, expect, it } from 'vitest';
import {
  CHARACTERS, computeFinalEggPoints, computeFinalScore, createStream, getPushOptions, POKEMON, randomLegalPolicy,
  SAFE_POLICY, SHORTCUT_POLICY, simulateRace,
} from '../../../src/game/index.ts';
import type { GameState, LegResolution } from '../../../src/game/index.ts';
import { ALWAYS, ctx, draws, makeState, NEVER, play, safe, shortcut } from './helpers.ts';

const PAIRS = CHARACTERS.flatMap((c) => POKEMON.map((p) => [c.id, p.id] as const));

function checkInvariants(state: GameState): void {
  let total = 0;
  for (const r of state.legResults) {
    const t = r.time;
    expect(t.baseCs - t.speedSavingsCs + t.weatherDelayCs + t.crashDelayCs + t.eggDelayCs + t.hydeDelayCs + t.floorAdjustmentCs).toBe(t.totalCs);
    expect(t.floorAdjustmentCs).toBeGreaterThanOrEqual(0);
    expect(t.totalCs).toBeGreaterThanOrEqual(1000);
    expect(Number.isInteger(t.totalCs)).toBe(true);
    expect(t.discountPct).toBeLessThanOrEqual(50);
    expect(r.staminaEnd).toBeGreaterThanOrEqual(0);
    if (r.outcome !== 'dnf') expect(r.staminaEnd).toBeGreaterThanOrEqual(3 - r.legIndex);
    if (r.route === 'safe') expect(r.hydeProbability).toBeNull();
    if (r.hydeProbability !== null) {
      expect(r.hydeProbability).toBeGreaterThanOrEqual(0);
      expect(r.hydeProbability).toBeLessThanOrEqual(0.95);
    }
    expect(r.gapBeforeCatchM).toBe(r.gapStartM + r.gapDeltas.reduce((s, d) => s + (d.negatedBy ? 0 : d.meters), 0));
    total += t.totalCs;
  }
  expect(state.totalSimulatedTimeCs).toBe(total);
  if (state.status === 'completed') {
    expect(state.legResults).toHaveLength(3);
    expect(state.finalEggPoints).toBe(computeFinalEggPoints(state.bankedEggPoints, state.pokemonId));
    expect(state.finalScore).toBe(computeFinalScore(state.finalEggPoints!, state.totalSimulatedTimeCs));
  } else if (state.status === 'dnf') {
    expect(state.finalScore).toBe(0);
    expect(state.finalEggPoints).toBe(0);
    expect(state.dnfReason).not.toBeNull();
  }
}

describe('216 pairings', () => {
  it('has 216 pairings', () => {
    expect(PAIRS).toHaveLength(216);
  });

  it.each(PAIRS)('%s + %s: full finish (safe policy, shortcut no-incident, seeded policies)', (c, p) => {
    const a = simulateRace({ seed: `pair-${c}-${p}`, characterId: c, pokemonId: p, policy: SAFE_POLICY });
    expect(a.state.status).toBe('completed');
    checkInvariants(a.state);

    let s = makeState(c, p);
    const offers = { safe: 'common', shortcut: 'legendary' } as const;
    const weathers = ['strong_currents', 'heavy_fog', 'clear'] as const;
    for (const leg of [1, 2, 3] as const) {
      const lvl = Math.max(...getPushOptions(s).filter((o) => o.isLegal).map((o) => o.pushLevel)) as 1 | 2 | 3;
      s = play(s, ctx(leg, weathers[leg - 1], offers), shortcut(lvl), 'collect', draws(NEVER, NEVER, NEVER)).state;
    }
    expect(s.status).toBe('completed');
    expect(s.bankedEggPoints).toBe(p === 'sableye' ? 21 : 18);
    checkInvariants(s);

    for (const seed of ['x1', 'x2', 'x3']) {
      const r = simulateRace({ seed: `${seed}-${c}-${p}`, characterId: c, pokemonId: p, policy: randomLegalPolicy(createStream(seed)) });
      expect(['completed', 'dnf']).toContain(r.state.status);
      checkInvariants(r.state);
      const sc = simulateRace({ seed: `${seed}-${c}-${p}`, characterId: c, pokemonId: p, policy: SHORTCUT_POLICY });
      checkInvariants(sc.state);
    }
  });

  it.each(PAIRS)('%s + %s: DNF via second catch and via HP depletion', (c, p) => {
    // Second catch: every draw forces crash + catch on two shortcut legs.
    let s = makeState(c, p);
    const first = play(s, ctx(1), shortcut(1), 'skip', draws(ALWAYS, ALWAYS, ALWAYS));
    expect(first.resolution.hydeCatch).toBe(true);
    expect(first.state.status).toBe('in_progress');
    const second = play(first.state, ctx(2), shortcut(1), 'skip', draws(ALWAYS, ALWAYS, ALWAYS));
    const r2: LegResolution = second.resolution;
    expect(r2.catchNumber).toBe(2);
    expect(second.state.status).toBe('dnf');
    expect(second.state.dnfReason).toBe('second_catch');
    checkInvariants(second.state);

    // HP depletion: constructed low HP with one-use crash defences already consumed.
    s = makeState(c, p, { hp: 10, flags: { gengarWeatherUsed: true, xavierCrashUsed: true, rowanCrashUsed: true, firstCatchResolved: false } });
    const hp = play(s, ctx(1), shortcut(1), 'skip', draws(ALWAYS, ALWAYS, NEVER));
    expect(hp.state.status).toBe('dnf');
    expect(hp.state.dnfReason).toBe('hp_depleted');
    checkInvariants(hp.state);

    // Safe-route-only DNF is impossible from the start; a safe leg never changes catch count.
    const safeLeg = play(makeState(c, p), ctx(1), safe(1), 'skip', draws(ALWAYS, ALWAYS, ALWAYS));
    expect(safeLeg.state.hydeCatchCount).toBe(0);
  });
});
