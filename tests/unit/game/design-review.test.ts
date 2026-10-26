// Regression oracle: docs/DESIGN_REVIEW.md edge cases EC-01..EC-30 (reading A for second catches = D-13,
// Morticia 5 s total = D-14). Numbers are the reviewer's hand-computed values.
import { describe, expect, it } from 'vitest';
import {
  buildLegView, computeFinalEggPoints, getPushOptions, prepareLeg, resolvePreparedLeg,
} from '../../../src/game/index.ts';
import type { CharacterId, GameState, PokemonId } from '../../../src/game/index.ts';
import { ctx, draws, makeState, play, safe, shortcut } from './helpers.ts';

const cs = (seconds: number) => Math.round(seconds * 100);

describe('EC-01..03 Xavier + Trevenant full race', () => {
  it('matches every leg and the final score 451.90', () => {
    const l1 = play(makeState('xavier', 'trevenant'), ctx(1, 'clear', { shortcut: 'rare' }), shortcut(2), 'collect', draws(0.05, 0.1, 0.99));
    expect(l1.resolution).toMatchObject({ crashNegatedBy: 'xavier', crashHpLoss: 0, eggFailed: true, gapBeforeCatchM: 85, hydeProbability: 0.15, hydeCatch: false });
    expect(l1.resolution.time.crashDelayCs).toBe(0);
    expect(l1.resolution.time.totalCs).toBe(cs(35.8));
    expect(l1.resolution.gapDeltas).toContainEqual({ source: 'crash', meters: -25, negatedBy: 'trevenant' });
    expect(l1.state).toMatchObject({ hp: 100, stamina: 4, bankedEggPoints: 0, pursuitGapM: 85 });
    expect(l1.state.flags.xavierCrashUsed).toBe(true);

    const l2 = play(l1.state, ctx(2, 'strong_currents', { shortcut: 'legendary' }), shortcut(1), 'collect', draws(0.1, 0.5, 0.3));
    expect(l2.resolution).toMatchObject({ crashNegatedBy: null, crashHpLoss: 10, eggFailed: false, gapBeforeCatchM: 70, hydeProbability: 0.25, hydeCatch: false });
    expect(l2.resolution.time.totalCs).toBe(cs(55.1));
    expect(l2.state).toMatchObject({ hp: 90, stamina: 3, bankedEggPoints: 6, pursuitGapM: 70, totalSimulatedTimeCs: cs(90.9) });

    expect(getPushOptions(l2.state)[2].isLegal).toBe(true);
    const l3 = play(l2.state, ctx(3, 'heavy_fog', { shortcut: 'rare' }), shortcut(3), 'collect', draws(0.3, 0.1, 0.5));
    expect(l3.resolution).toMatchObject({ eggFailed: true, gapBeforeCatchM: 55, hydeProbability: 0.55, hydeCatch: true, catchType: 'roll', catchNumber: 1, eggPointsLostToCatch: 0, gapEndM: 30 });
    expect(l3.resolution.time.totalCs).toBe(cs(57.2));
    expect(l3.state).toMatchObject({ status: 'completed', hp: 45, bankedEggPoints: 6, finalEggPoints: 6, totalSimulatedTimeCs: cs(148.1), finalScore: 451.9 });
  });
});

describe('EC-04 Ajax + Alolan Marowak', () => {
  it('crash costs 1 s, no egg-failure roll without an egg', () => {
    const r = play(makeState('ajax', 'alolan_marowak'), ctx(1), shortcut(1), 'skip', draws(0, 0, 0.9));
    expect(r.resolution).toMatchObject({ crashHpLoss: 10, eggAttempted: false, eggFailed: false, gapBeforeCatchM: 60, hydeProbability: 0.2, hydeCatch: false });
    expect(r.resolution.time.crashDelayCs).toBe(100);
    expect(r.resolution.time.totalCs).toBe(cs(34.25));
    expect(r.state.stamina).toBe(5);
  });
  it('related: Xavier + Marowak first crash 0 s, second 4 s', () => {
    const a = play(makeState('xavier', 'alolan_marowak'), ctx(1), shortcut(1), 'skip', draws(0, 0.9, 0.9));
    expect(a.resolution.time.crashDelayCs).toBe(0);
    const b = play(a.state, ctx(2), shortcut(1), 'skip', draws(0, 0.9, 0.9));
    expect(b.resolution.time.crashDelayCs).toBe(400);
  });
});

describe('EC-05..06 Rowan + Gholdengo', () => {
  it('Rowan negation then caught; then post-reset crash proximity DNF (reading A)', () => {
    const l1 = play(makeState('rowan', 'gholdengo'), ctx(1, 'heavy_fog', { shortcut: 'rare' }), shortcut(2), 'collect', draws(0.01, 0, 0.2));
    expect(l1.resolution).toMatchObject({ crashOccurred: true, crashNegatedBy: 'rowan', eggFailed: false, gapBeforeCatchM: 75, hydeProbability: 0.3, hydeCatch: true, catchNumber: 1, eggPointsLostToCatch: 1 });
    expect(l1.resolution.gapDeltas).toContainEqual({ source: 'crash', meters: -25, negatedBy: 'rowan' });
    expect(l1.resolution.time.totalCs).toBe(cs(52.8));
    expect(l1.state).toMatchObject({ stamina: 4, bankedEggPoints: 2, hydeCatchCount: 1, hp: 65, pursuitGapM: 30 });
    expect(l1.state.flags.rowanCrashUsed).toBe(true);

    const l2 = play(l1.state, ctx(2, 'clear', { shortcut: 'rare' }), shortcut(1), 'collect', draws(0.05, 0.9, 0.99));
    expect(l2.resolution).toMatchObject({ crashNegatedBy: null, gapBeforeCatchM: -10, catchType: 'proximity', hydeProbability: null, catchNumber: 2, catchHpLoss: 0, dnfReason: 'second_catch', gapEndM: -10 });
    expect(l2.resolution.time.totalCs).toBe(cs(49.1));
    expect(l2.resolution.time.hydeDelayCs).toBe(0);
    expect(l2.state).toMatchObject({ status: 'dnf', hp: 55, totalSimulatedTimeCs: cs(101.9), finalScore: 0, finalEggPoints: 0, stamina: 3, unbankedEggPoints: 3, bankedEggPoints: 2 });
  });
});

describe('EC-07 Yoko + Dragapult', () => {
  it('40% for 4 stamina, then only push 1 legal on leg 2', () => {
    const r = play(makeState('yoko', 'dragapult'), ctx(1, 'clear', { shortcut: 'common' }), shortcut(3), 'collect', draws(0.5, 0.5, 0.9));
    expect(r.resolution.time).toMatchObject({ discountPct: 40, speedSavingsCs: 1400, totalCs: cs(26) });
    expect(r.resolution.time.discountSources).toEqual([{ source: 'push', pct: 30 }, { source: 'dragapult', pct: 10 }]);
    expect(r.resolution.gapBeforeCatchM).toBe(95);
    expect(r.state).toMatchObject({ stamina: 2, bankedEggPoints: 1 });
    expect(getPushOptions(r.state).map((o) => o.isLegal)).toEqual([true, false, false]);
  });
});

describe('EC-08 Bianca + Dragapult discount cap', () => {
  it('55 -> 50%, 28.50 s', () => {
    const r = play(makeState('bianca', 'dragapult'), ctx(1, 'strong_currents', { shortcut: 'rare' }), shortcut(3), 'collect', draws(0.9, 0.9, 0.9));
    expect(r.resolution.time).toMatchObject({ discountPct: 50, speedSavingsCs: 1750, weatherDelayCs: 600, totalCs: cs(28.5) });
    expect(r.resolution.gapBeforeCatchM).toBe(95);
    expect(r.state.stamina).toBe(2);
  });
  it('Gomez + Dragapult shortcut push 3 and Bianca + Ceruledge L3 currents push 3 hit exactly 50', () => {
    expect(play(makeState('gomez', 'dragapult'), ctx(1), shortcut(3)).resolution.time.discountPct).toBe(50);
    const s = makeState('bianca', 'ceruledge', { legIndex: 3, stamina: 3 });
    const r = play(s, ctx(3, 'strong_currents'), shortcut(3)).resolution.time;
    expect(r.discountPct).toBe(50);
    expect(r.discountSources.reduce((a, d) => a + d.pct, 0)).toBe(50);
  });
});

describe('EC-09 Divina + Gengar', () => {
  it('Gengar consumes the first currents, Divina halves the next', () => {
    const l1 = play(makeState('divina', 'gengar'), ctx(1, 'strong_currents', { shortcut: 'rare' }), shortcut(1), 'skip', draws(0.9, 0.9, 0.9));
    expect(l1.resolution.time).toMatchObject({ weatherDelayCs: 0, totalCs: cs(33.25) });
    expect(l1.state).toMatchObject({ stamina: 5, pursuitGapM: 85 });
    expect(l1.state.flags.gengarWeatherUsed).toBe(true);
    const l2 = play(l1.state, ctx(2, 'strong_currents', { safe: 'common' }), safe(2), 'collect');
    expect(l2.resolution.time).toMatchObject({ speedSavingsCs: 660, weatherDelayCs: 150, totalCs: cs(54.9) });
    expect(l2.resolution.hydeProbability).toBeNull();
    expect(l2.state).toMatchObject({ totalSimulatedTimeCs: cs(88.15), stamina: 3, bankedEggPoints: 1, pursuitGapM: 95 });
  });
});

describe('EC-10 Eugene + Gengar', () => {
  it('a: clear weather does not consume Gengar', () => {
    expect(play(makeState('eugene', 'gengar'), ctx(1), shortcut(1)).state.flags.gengarWeatherUsed).toBe(false);
    expect(play(makeState('eugene', 'gengar'), ctx(1), safe(1)).state.flags.gengarWeatherUsed).toBe(false);
  });
  it('b: Gengar burns on a 3 s safe currents delay; fog later is paid', () => {
    const l1 = play(makeState('eugene', 'gengar'), ctx(1, 'strong_currents', { safe: 'common' }), safe(1), 'collect');
    expect(l1.resolution.time.totalCs).toBe(cs(50.6));
    expect(l1.state.pursuitGapM).toBe(110);
    expect(l1.state.flags.gengarWeatherUsed).toBe(true);
    const l2 = play(l1.state, ctx(2, 'heavy_fog', { shortcut: 'rare' }), shortcut(2), 'collect', draws(0.9, 0.9, 0.9));
    expect(l2.resolution).toMatchObject({ gapBeforeCatchM: 85, hydeProbability: 0.4, hydeCatch: false });
    expect(l2.resolution.time).toMatchObject({ weatherDelayCs: 700, totalCs: cs(45.44) });
    expect(l2.state).toMatchObject({ totalSimulatedTimeCs: cs(96.04), bankedEggPoints: 4 });
  });
});

describe('EC-11 Jellicent in currents, gap exactly 70', () => {
  const at = (c: CharacterId) =>
    play(makeState(c, 'jellicent', { legIndex: 2, stamina: 4, pursuitGapM: 85 }), ctx(2, 'strong_currents', { shortcut: 'legendary' }), shortcut(2), 'collect', draws(0.9, 0.9, 0.26));
  it('Eugene + Jellicent: 38.44 s, p 0.25 at gap 70', () => {
    const r = at('eugene');
    expect(r.resolution).toMatchObject({ gapBeforeCatchM: 70, hydeProbability: 0.25, hydeCatch: false });
    expect(r.resolution.time).toMatchObject({ weatherDelayCs: 0, totalCs: cs(38.44) });
    expect(r.state).toMatchObject({ bankedEggPoints: 6, pursuitGapM: 70 });
  });
  it('Bianca + Jellicent: 27% -> 32.74 s; Divina + Jellicent: 38.44 s', () => {
    expect(at('bianca').resolution.time).toMatchObject({ discountPct: 27, speedSavingsCs: 1026, totalCs: cs(32.74) });
    expect(at('divina').resolution.time.totalCs).toBe(cs(38.44));
  });
  it('Basculegion qualifies at a leg-start gap of exactly 70', () => {
    const r = play(makeState('eugene', 'basculegion', { legIndex: 3, stamina: 3, pursuitGapM: 70 }), ctx(3), safe(1));
    expect(r.resolution.time.discountSources).toContainEqual({ source: 'basculegion', pct: 10 });
  });
});

describe('EC-12 Chandelure in fog', () => {
  it('fog delay 0 but -10 m and +0.15 risk still apply', () => {
    const r = play(makeState('eugene', 'chandelure'), ctx(1, 'heavy_fog', { shortcut: 'common' }), shortcut(2), 'collect', draws(0.9, 0.9, 0.31));
    expect(r.resolution).toMatchObject({ gapBeforeCatchM: 75, hydeProbability: 0.3, hydeCatch: false });
    expect(r.resolution.time).toMatchObject({ weatherDelayCs: 0, totalCs: cs(35.8) });
  });
});

describe('EC-13..14 Decidueye on leg 3', () => {
  const l3 = () => makeState('eugene', 'decidueye', { legIndex: 3, stamina: 2, pursuitGapM: 60, bankedEggPoints: 4, totalSimulatedTimeCs: 10000 });
  it('EC-13 negates every negative delta, still caught at p 0.55 -> 540.08', () => {
    const r = play(l3(), ctx(3, 'heavy_fog', { shortcut: 'legendary' }), shortcut(2), 'collect', draws(0.1, 0.3, 0.4));
    expect(r.resolution.gapDeltas).toEqual([
      { source: 'route', meters: -15, negatedBy: 'decidueye' },
      { source: 'crash', meters: -25, negatedBy: 'decidueye' },
      { source: 'fog', meters: -10, negatedBy: 'decidueye' },
    ]);
    expect(r.resolution).toMatchObject({ gapBeforeCatchM: 60, hydeProbability: 0.55, hydeCatch: true, eggPointsLostToCatch: 3, crashHpLoss: 10, catchHpLoss: 35 });
    expect(r.resolution.time.totalCs).toBe(cs(59.92));
    expect(r.state).toMatchObject({ status: 'completed', hp: 55, totalSimulatedTimeCs: cs(159.92), bankedEggPoints: 7, finalScore: 540.08 });
  });
  it('EC-13 variant: hyde 0.60 -> 49.92 s, banked 10, 850.08', () => {
    const r = play(l3(), ctx(3, 'heavy_fog', { shortcut: 'legendary' }), shortcut(2), 'collect', draws(0.1, 0.3, 0.6));
    expect(r.resolution.time.totalCs).toBe(cs(49.92));
    expect(r.state).toMatchObject({ bankedEggPoints: 10, finalScore: 850.08 });
  });
  it('EC-14 already caught once: coin flip instead of certain DNF', () => {
    const s = makeState('eugene', 'decidueye', { legIndex: 3, stamina: 3, pursuitGapM: 30, hydeCatchCount: 1, hp: 65, bankedEggPoints: 3 });
    const c = ctx(3, 'clear', { shortcut: 'rare' });
    const ok = play(s, c, shortcut(1), 'collect', draws(0.1, 0.9, 0.6));
    expect(ok.resolution).toMatchObject({ gapBeforeCatchM: 30, hydeProbability: 0.5, hydeCatch: false });
    expect(ok.resolution.time.totalCs).toBe(cs(45.3));
    expect(ok.state).toMatchObject({ status: 'completed', hp: 55, bankedEggPoints: 6, pursuitGapM: 30 });
    const dnf = play(s, c, shortcut(1), 'collect', draws(0.1, 0.9, 0.4));
    expect(dnf.state).toMatchObject({ status: 'dnf', dnfReason: 'second_catch' });
    expect(dnf.resolution.time.totalCs).toBe(cs(45.3));
    const noDec = play({ ...s, pokemonId: 'gholdengo' }, c, shortcut(1), 'collect', draws(0.1, 0.9, 0.99));
    expect(noDec.resolution).toMatchObject({ gapBeforeCatchM: -10, catchType: 'proximity' });
    expect(noDec.state.status).toBe('dnf');
  });
});

describe('EC-15 Aegislash', () => {
  it('first catch free but counted; second catch DNF at 76.90 s total', () => {
    const l1 = play(makeState('eugene', 'aegislash'), ctx(1, 'clear', { shortcut: 'rare' }), shortcut(2), 'collect', draws(0.9, 0.9, 0.1));
    expect(l1.resolution).toMatchObject({ hydeCatch: true, catchNumber: 1, catchHpLoss: 0, eggPointsLostToCatch: 0, gapEndM: 30 });
    expect(l1.resolution.time.totalCs).toBe(cs(35.8));
    expect(l1.state).toMatchObject({ hp: 100, bankedEggPoints: 3, stamina: 4, hydeCatchCount: 1 });
    expect(l1.state.flags.firstCatchResolved).toBe(true);
    const l2 = play(l1.state, ctx(2, 'clear', { shortcut: 'rare' }), shortcut(1), 'collect', draws(0.9, 0.9, 0.3));
    expect(l2.resolution).toMatchObject({ gapBeforeCatchM: 15, hydeProbability: 0.4, catchNumber: 2, dnfReason: 'second_catch' });
    expect(l2.resolution.time.totalCs).toBe(cs(41.1));
    expect(l2.state).toMatchObject({ status: 'dnf', totalSimulatedTimeCs: cs(76.9), finalScore: 0, stamina: 3 });
  });
});

describe('EC-16 Morticia + Aegislash vs Morticia + Gholdengo', () => {
  const run = (p: PokemonId) =>
    play(makeState('morticia', p, { legIndex: 2, stamina: 4, pursuitGapM: 85, bankedEggPoints: 1 }), ctx(2, 'heavy_fog', { shortcut: 'legendary' }), shortcut(2), 'collect', draws(0.9, 0.9, 0.3));
  it('Aegislash takes priority', () => {
    const r = run('aegislash');
    expect(r.resolution).toMatchObject({ gapBeforeCatchM: 60, hydeProbability: 0.45, hydeCatch: true });
    expect(r.resolution.time).toMatchObject({ hydeDelayCs: 0, totalCs: cs(45.44) });
    expect(r.state).toMatchObject({ hp: 100, bankedEggPoints: 7, pursuitGapM: 30 });
  });
  it('Morticia alone: 5 s total (D-14)', () => {
    const r = run('gholdengo');
    expect(r.resolution.time).toMatchObject({ hydeDelayCs: 500, totalCs: cs(50.44) });
    expect(r.state).toMatchObject({ hp: 65, bankedEggPoints: 4, pursuitGapM: 30 });
  });
});

describe('EC-17 Dhelmise', () => {
  it('egg protected from Hyde; HP/time still apply', () => {
    const r = play(makeState('eugene', 'dhelmise'), ctx(1, 'heavy_fog', { shortcut: 'rare' }), shortcut(2), 'collect', draws(0.9, 0.9, 0.25));
    expect(r.resolution).toMatchObject({ gapBeforeCatchM: 75, hydeProbability: 0.3, hydeCatch: true, eggPointsLostToCatch: 0 });
    expect(r.resolution.time.totalCs).toBe(cs(52.8));
    expect(r.state).toMatchObject({ hp: 65, bankedEggPoints: 3, pursuitGapM: 30 });
  });
  it('variant: crash egg failure is not protected', () => {
    const r = play(makeState('eugene', 'dhelmise'), ctx(1, 'heavy_fog', { shortcut: 'rare' }), shortcut(2), 'collect', draws(0.1, 0.1, 0.25));
    expect(r.resolution).toMatchObject({ eggFailed: true, gapBeforeCatchM: 50, hydeProbability: 0.35, hydeCatch: true, eggPointsBanked: 0 });
    expect(r.resolution.time.totalCs).toBe(cs(60.8));
    expect(r.state.hp).toBe(55);
  });
});

describe('EC-18 Basculegion full race', () => {
  it('bonus only while the leg-start gap is >= 70; final score 163.82', () => {
    const l1 = play(makeState('eugene', 'basculegion'), ctx(1, 'clear', { shortcut: 'rare' }), shortcut(2), 'collect', draws(0.9, 0.9, 0.05));
    expect(l1.resolution.time).toMatchObject({ discountPct: 22, speedSavingsCs: 770, totalCs: cs(42.3) });
    expect(l1.resolution.eggPointsLostToCatch).toBe(1);
    expect(l1.state).toMatchObject({ stamina: 4, bankedEggPoints: 2, pursuitGapM: 30, hp: 65 });
    const l2 = play(l1.state, ctx(2, 'clear', { safe: 'common' }), safe(2), 'collect');
    expect(l2.resolution.time).toMatchObject({ discountPct: 12, speedSavingsCs: 660, totalCs: cs(53.4) });
    expect(l2.state).toMatchObject({ pursuitGapM: 40, bankedEggPoints: 3, stamina: 2 });
    const l3 = play(l2.state, ctx(3, 'clear', { safe: 'none' }), safe(2), 'skip');
    expect(l3.resolution.time).toMatchObject({ discountPct: 12, speedSavingsCs: 552, totalCs: cs(40.48) });
    expect(l3.state).toMatchObject({ status: 'completed', pursuitGapM: 50, totalSimulatedTimeCs: cs(136.18), bankedEggPoints: 3, finalScore: 163.82, hp: 65 });
  });
});

describe('EC-19 Kent leg-2 lead', () => {
  it('+15 m before catch evaluation', () => {
    const r = play(makeState('kent', 'gholdengo', { legIndex: 2, stamina: 4, pursuitGapM: 85 }), ctx(2, 'heavy_fog', { shortcut: 'rare' }), shortcut(3), 'collect', draws(0.2, 0.9, 0.5));
    expect(r.resolution).toMatchObject({ gapBeforeCatchM: 60, hydeProbability: 0.45, hydeCatch: false, crashHpLoss: 10 });
    expect(r.resolution.time).toMatchObject({ speedSavingsCs: 760, totalCs: cs(50.4) });
    expect(r.state).toMatchObject({ stamina: 1, pursuitGapM: 60, bankedEggPoints: 3, hp: 90 });
  });
});

describe('EC-20 Galarian Corsola', () => {
  it('leg 2 push 1 = 12% for 1 stamina, no push3 gap', () => {
    const s = makeState('eugene', 'galarian_corsola', { legIndex: 2, stamina: 5 });
    expect(getPushOptions(s)[0]).toMatchObject({ pushDiscountPct: 12, staminaCost: 1 });
    const r = play(s, ctx(2, 'clear', { safe: 'common' }), safe(1), 'collect');
    expect(r.resolution.time).toMatchObject({ speedSavingsCs: 660, totalCs: cs(53.4) });
    expect(r.resolution.gapBeforeCatchM).toBe(110);
    expect(getPushOptions(makeState('eugene', 'galarian_corsola'))[0].pushDiscountPct).toBe(5);
    expect(getPushOptions(makeState('eugene', 'galarian_corsola', { legIndex: 3, stamina: 3 }))[0].pushDiscountPct).toBe(5);
    expect(getPushOptions(s)[1].pushDiscountPct).toBe(12);
  });
});

describe('EC-21 Sableye', () => {
  it('legendary 7 provisional lost to crash egg failure', () => {
    const r = play(makeState('eugene', 'sableye', { legIndex: 2, stamina: 5, pursuitGapM: 85 }), ctx(2, 'clear', { shortcut: 'legendary' }), shortcut(2), 'collect', draws(0.1, 0.2, 0.9));
    expect(r.resolution).toMatchObject({ eggPointsProvisional: 7, eggFailed: true, eggPointsBanked: 0, gapBeforeCatchM: 45, hydeProbability: 0.3, hydeCatch: false });
    expect(r.resolution.time.totalCs).toBe(cs(46.44));
    expect(r.state).toMatchObject({ hp: 90, pursuitGapM: 45, bankedEggPoints: 0 });
  });
  it('variant: rare (4) caught loses 2', () => {
    const r = play(makeState('eugene', 'sableye'), ctx(1, 'clear', { shortcut: 'rare' }), shortcut(2), 'collect', draws(0.9, 0.9, 0.05));
    expect(r.resolution).toMatchObject({ eggPointsProvisional: 4, eggPointsLostToCatch: 2, eggPointsBanked: 2 });
    expect(r.resolution.time.totalCs).toBe(cs(45.8));
    expect(r.state.hp).toBe(65);
  });
});

describe('EC-22 Gholdengo floor table', () => {
  it.each([[0, 0], [1, 1], [2, 2], [3, 3], [4, 5], [5, 6], [6, 7], [7, 8], [9, 11], [15, 18]])('banked %i -> %i', (b, f) => {
    expect(computeFinalEggPoints(b, 'gholdengo')).toBe(f);
  });
  it('banked 7 at 120.00 s -> 680.00; DNF -> 0 eggs', () => {
    let s = makeState('eugene', 'gholdengo', { legIndex: 3, stamina: 3, bankedEggPoints: 6, totalSimulatedTimeCs: 12000 - 4048 - 500 });
    const r = play(s, ctx(3, 'clear', { safe: 'common' }), safe(2), 'collect');
    expect(r.state).toMatchObject({ bankedEggPoints: 7, finalEggPoints: 8, totalSimulatedTimeCs: 12000, finalScore: 680 });
    s = makeState('eugene', 'gholdengo', { legIndex: 3, stamina: 3, bankedEggPoints: 7, hydeCatchCount: 1, pursuitGapM: -50 });
    expect(play(s, ctx(3), safe(1)).state).toMatchObject({ status: 'dnf', finalEggPoints: 0, finalScore: 0 });
  });
});

/** Count legal (L1, L2, L3) push sequences by walking getPushOptions. */
function legalSequences(c: CharacterId, p: PokemonId): string[] {
  const out: string[] = [];
  const walk = (s: GameState, prefix: string) => {
    for (const o of getPushOptions(s)) {
      if (!o.isLegal) continue;
      if (s.legIndex === 3) out.push(prefix + o.pushLevel);
      else walk({ ...s, legIndex: (s.legIndex + 1) as 2 | 3, stamina: s.stamina - o.staminaCost }, prefix + o.pushLevel);
    }
  };
  walk(makeState(c, p), '');
  return out.sort();
}

describe('EC-23 legal push sequences', () => {
  it('Enid 23, standard 17, Enid + Dragapult 17, Dragapult 11', () => {
    const enid = legalSequences('enid', 'gholdengo');
    expect(enid).toHaveLength(23);
    expect(enid).toEqual(expect.arrayContaining(['133', '313', '331', '322']));
    for (const bad of ['233', '323', '332', '333']) expect(enid).not.toContain(bad);
    expect(legalSequences('eugene', 'gholdengo')).toHaveLength(17);
    expect(legalSequences('enid', 'dragapult')).toEqual(['111', '112', '121', '122', '211', '212', '221', '222', '113', '131', '311', '123', '132', '213', '231', '312', '321'].sort());
    expect(legalSequences('eugene', 'dragapult')).toEqual(['111', '112', '121', '122', '211', '212', '221', '222', '113', '131', '311'].sort());
  });
  it('Enid + Gholdengo double push 3: gap 100 -> 95 -> 90, stamina 7 -> 4 -> 1', () => {
    const l1 = play(makeState('enid', 'gholdengo'), ctx(1), shortcut(3));
    expect(l1.state).toMatchObject({ pursuitGapM: 95, stamina: 4 });
    const l2 = play(l1.state, ctx(2), shortcut(3));
    expect(l2.state).toMatchObject({ pursuitGapM: 90, stamina: 1 });
    expect(getPushOptions(l2.state).map((o) => o.isLegal)).toEqual([true, false, false]);
  });
});

describe('EC-24 Dragapult push-3 legality matrix', () => {
  const legal3 = (c: CharacterId, leg: 1 | 2 | 3, stamina: number) =>
    getPushOptions(makeState(c, 'dragapult', { legIndex: leg, stamina }))[2].isLegal;
  it('standard and Enid', () => {
    expect(legal3('eugene', 1, 6)).toBe(true);
    expect([legal3('eugene', 2, 5), legal3('eugene', 2, 4), legal3('eugene', 2, 2)]).toEqual([true, false, false]);
    expect([legal3('eugene', 3, 4), legal3('eugene', 3, 3), legal3('eugene', 3, 2)]).toEqual([true, false, false]);
    expect(legal3('enid', 1, 7)).toBe(true);
    expect([legal3('enid', 2, 6), legal3('enid', 2, 5), legal3('enid', 2, 3)]).toEqual([true, true, false]);
    expect([legal3('enid', 3, 5), legal3('enid', 3, 4), legal3('enid', 3, 3)]).toEqual([true, true, false]);
  });
});

describe('EC-25 Wednesday + Froslass in fog', () => {
  it('Froslass after flat: p 0.425, draw 0.41 catches', () => {
    const s = makeState('wednesday', 'froslass', { legIndex: 3, stamina: 2, pursuitGapM: 35, hp: 90 });
    const r = play(s, ctx(3, 'heavy_fog', { shortcut: 'common' }), shortcut(1), 'collect', draws(0.9, 0.9, 0.41));
    expect(r.resolution).toMatchObject({ gapBeforeCatchM: 10, hydeProbability: 0.425, hydeCatch: true, eggPointsLostToCatch: 0 });
    expect(r.resolution.time.totalCs).toBe(cs(54.3));
    expect(r.state).toMatchObject({ status: 'completed', hp: 55, bankedEggPoints: 1, pursuitGapM: 30 });
  });
});

describe('EC-26 Wednesday + Dusknoir in fog', () => {
  const run = (hyde: number, weather: 'heavy_fog' | 'clear' = 'heavy_fog') =>
    play(makeState('wednesday', 'dusknoir'), ctx(1, weather, { shortcut: 'rare' }), shortcut(2), 'collect', draws(0.9, 0.9, hyde));
  it('p 0.05 in fog; 0.15 otherwise', () => {
    const miss = run(0.06);
    expect(miss.resolution).toMatchObject({ gapBeforeCatchM: 75, hydeProbability: 0.05, hydeCatch: false });
    expect(miss.resolution.time.totalCs).toBe(cs(42.8));
    const hit = run(0.04);
    expect(hit.resolution.time.totalCs).toBe(cs(52.8));
    expect(hit.state).toMatchObject({ hp: 65, bankedEggPoints: 2, pursuitGapM: 30 });
    expect(run(0.9, 'clear').resolution.hydeProbability).toBe(0.15);
  });
});

describe('EC-27 proximity catch with no draw', () => {
  it('gap 0 -> proximity, 66.10 s', () => {
    const s = makeState('eugene', 'gholdengo', { legIndex: 2, stamina: 4, pursuitGapM: 50, hp: 90 });
    const r = play(s, ctx(2, 'heavy_fog', { shortcut: 'common' }), shortcut(1), 'collect', draws(0.1, 0.9, 0));
    expect(r.resolution).toMatchObject({ gapBeforeCatchM: 0, catchType: 'proximity', hydeProbability: null, catchNumber: 1, eggPointsLostToCatch: 0, gapEndM: 30 });
    expect(r.resolution.time.totalCs).toBe(cs(66.1));
    expect(r.state).toMatchObject({ hp: 45, bankedEggPoints: 1, pursuitGapM: 30 });
  });
});

describe('EC-28 post-reset push 3 crash', () => {
  const run = (p: PokemonId) =>
    play(makeState('eugene', p, { legIndex: 2, stamina: 4, pursuitGapM: 30, hydeCatchCount: 1, hp: 65 }), ctx(2, 'clear', { shortcut: 'rare' }), shortcut(3), 'collect', draws(0.1, 0.9, 0.99));
  it('proximity DNF at 43.40 s; Misdreavus / Trevenant -> roll at p 0.40', () => {
    const r = run('gholdengo');
    expect(r.resolution).toMatchObject({ gapBeforeCatchM: 0, catchType: 'proximity', dnfReason: 'second_catch' });
    expect(r.resolution.time.totalCs).toBe(cs(43.4));
    expect(run('misdreavus').resolution).toMatchObject({ gapBeforeCatchM: 10, hydeProbability: 0.4, hydeCatch: false });
    expect(run('trevenant').resolution).toMatchObject({ gapBeforeCatchM: 25, hydeProbability: 0.4, hydeCatch: false });
  });
});

describe('EC-29 Gomez + Ceruledge', () => {
  it('45% on leg 3 push 3 -> 23.70 s', () => {
    const r = play(makeState('gomez', 'ceruledge', { legIndex: 3, stamina: 3, pursuitGapM: 70 }), ctx(3, 'clear', { shortcut: 'legendary' }), shortcut(3), 'collect', draws(0.9, 0.9, 0.5));
    expect(r.resolution).toMatchObject({ gapBeforeCatchM: 65, hydeProbability: 0.4, hydeCatch: false });
    expect(r.resolution.time).toMatchObject({ discountPct: 45, speedSavingsCs: 1530, totalCs: cs(23.7) });
    expect(r.state).toMatchObject({ stamina: 0, bankedEggPoints: 6 });
    const p2 = play(makeState('gomez', 'ceruledge', { legIndex: 3, stamina: 3 }), ctx(3), safe(2)).resolution.time;
    expect(p2.discountPct).toBe(12);
    expect(play(makeState('eugene', 'ceruledge'), ctx(1), safe(3)).resolution.time.discountPct).toBe(20);
  });
});

describe('EC-30 rejections and visibility', () => {
  it('no-egg collect rejected, state and revision unchanged', () => {
    const p = prepareLeg(makeState('eugene', 'gholdengo'), ctx(1, 'clear', { safe: 'none', shortcut: 'rare' }), safe(1), 0);
    if (!p.ok) throw new Error('prepare failed');
    const before = JSON.stringify(p.state);
    const r = resolvePreparedLeg(p.state, ctx(1), draws(), 'collect', p.state.revision);
    expect(!r.ok && r.error.code).toBe('NO_EGG_TO_COLLECT');
    expect(JSON.stringify(p.state)).toBe(before);
    expect(p.state.revision).toBe(1);
  });
  it('Eugene sees both routes in both phases; others only after prepare', () => {
    const c = ctx(1, 'clear', { safe: 'common', shortcut: 'rare' });
    const e = makeState('eugene', 'gholdengo');
    const ep = prepareLeg(e, c, safe(1), 0);
    if (!ep.ok) throw new Error('prepare failed');
    expect(buildLegView(e, c).visibleOffers).toEqual({ safe: 'common', shortcut: 'rare' });
    expect(buildLegView(ep.state, c).visibleOffers).toEqual({ safe: 'common', shortcut: 'rare' });
    const w = makeState('wednesday', 'gholdengo');
    const wp = prepareLeg(w, c, shortcut(1), 0);
    if (!wp.ok) throw new Error('prepare failed');
    expect(buildLegView(w, c).visibleOffers).toEqual({});
    expect(buildLegView(wp.state, c).visibleOffers).toEqual({ shortcut: 'rare' });
  });
  it('safe route: no crash, crashProbability 0, hydeProbability null, no fog gap loss', () => {
    const r = play(makeState('eugene', 'gholdengo'), ctx(1, 'heavy_fog'), safe(1), 'skip', draws(0, 0, 0)).resolution;
    expect(r).toMatchObject({ crashProbability: 0, crashOccurred: false, hydeProbability: null, gapBeforeCatchM: 110 });
    expect(r.gapDeltas).toEqual([{ source: 'route', meters: 10 }]);
  });
});

describe('D-15 no gap ceiling', () => {
  it('safe-heavy run reaches 130 m', () => {
    let s = makeState('eugene', 'gholdengo');
    for (const leg of [1, 2, 3] as const) s = play(s, ctx(leg), safe(1)).state;
    expect(s.pursuitGapM).toBe(130);
  });
});

