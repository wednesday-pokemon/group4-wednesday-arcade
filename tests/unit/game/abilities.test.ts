import { describe, expect, it } from 'vitest';
import type { CharacterId, PokemonId } from '../../../src/game/index.ts';
import { ALWAYS, ctx, draws, makeState, NEVER, play, safe, shortcut } from './helpers.ts';

const crashLeg = (c: CharacterId, p: PokemonId, extra: Parameters<typeof makeState>[2] = {}) =>
  play(makeState(c, p, extra), ctx(1, 'clear', { shortcut: 'rare' }), shortcut(1), 'collect', draws(ALWAYS, 0.1, NEVER));

describe('crash defences: Xavier vs Rowan precedence and stacking', () => {
  it('Rowan: first crash fully negated (no HP, time, gap, egg-failure roll); flag consumed', () => {
    const { state, resolution: r } = crashLeg('rowan', 'gengar');
    expect(r).toMatchObject({ crashOccurred: true, crashNegatedBy: 'rowan', crashHpLoss: 0, eggFailed: false, eggPointsBanked: 3 });
    expect(r.time.crashDelayCs).toBe(0);
    expect(r.gapDeltas).toContainEqual({ source: 'crash', meters: -25, negatedBy: 'rowan' });
    expect(r.gapBeforeCatchM).toBe(85);
    expect(state.flags.rowanCrashUsed).toBe(true);
    expect(r.abilityEvents.map((e) => e.message)).toContain(
      "Rowan's Telekinetic Push negated the crash entirely (no HP, time, lead or egg loss)",
    );
    expect(r.abilityEvents[0].message.startsWith("Rowan's Telekinetic Push negated the crash entirely")).toBe(true);
    // second crash: normal penalties
    const second = play(state, ctx(2), shortcut(1), 'skip', draws(ALWAYS, NEVER, NEVER)).resolution;
    expect(second).toMatchObject({ crashNegatedBy: null, crashHpLoss: 10 });
    expect(second.time.crashDelayCs).toBe(800);
  });
  it('Xavier: first crash no HP/time, gap -25 still applies, egg failure still rolls', () => {
    const { state, resolution: r } = crashLeg('xavier', 'gengar');
    expect(r).toMatchObject({ crashNegatedBy: 'xavier', crashHpLoss: 0, eggFailed: true, eggPointsBanked: 0 });
    expect(r.time.crashDelayCs).toBe(0);
    expect(r.gapDeltas).toContainEqual({ source: 'crash', meters: -25 });
    expect(r.gapBeforeCatchM).toBe(60);
    expect(state.hp).toBe(100);
    expect(state.flags.xavierCrashUsed).toBe(true);
    const second = play(state, ctx(2), shortcut(1), 'skip', draws(ALWAYS, NEVER, NEVER)).resolution;
    expect(second).toMatchObject({ crashNegatedBy: null, crashHpLoss: 10 });
  });
  it('Xavier + Trevenant: no gap loss either', () => {
    const { resolution: r } = crashLeg('xavier', 'trevenant');
    expect(r.gapDeltas).toContainEqual({ source: 'crash', meters: -25, negatedBy: 'trevenant' });
    expect(r.gapBeforeCatchM).toBe(85);
    expect(r.crashHpLoss).toBe(0);
  });
  it('Trevenant alone: HP/time apply, gap loss negated', () => {
    const { resolution: r } = crashLeg('wednesday', 'trevenant');
    expect(r.crashHpLoss).toBe(10);
    expect(r.time.crashDelayCs).toBe(800);
    expect(r.gapBeforeCatchM).toBe(85);
  });
  it('Rowan + Trevenant: Rowan takes precedence on the first crash; Trevenant on the second', () => {
    const first = crashLeg('rowan', 'trevenant');
    expect(first.resolution.gapDeltas).toContainEqual({ source: 'crash', meters: -25, negatedBy: 'rowan' });
    const second = play(first.state, ctx(2), shortcut(1), 'skip', draws(ALWAYS, NEVER, NEVER)).resolution;
    expect(second.gapDeltas).toContainEqual({ source: 'crash', meters: -25, negatedBy: 'trevenant' });
    expect(second.crashHpLoss).toBe(10);
  });
  it('Xavier + Marowak: first crash 0 s, later crash 8-4 = 4 s', () => {
    const first = crashLeg('xavier', 'alolan_marowak');
    expect(first.resolution.time.crashDelayCs).toBe(0);
    const second = play(first.state, ctx(2), shortcut(1), 'skip', draws(ALWAYS, NEVER, NEVER)).resolution;
    expect(second.time.crashDelayCs).toBe(400);
  });
  it('Rowan + Marowak: first crash nothing, later crash 4 s', () => {
    const first = crashLeg('rowan', 'alolan_marowak');
    expect(first.resolution.time.crashDelayCs).toBe(0);
    const second = play(first.state, ctx(2), shortcut(1), 'skip', draws(ALWAYS, NEVER, NEVER)).resolution;
    expect(second.time.crashDelayCs).toBe(400);
  });
  it('Ajax 8-3 = 5 s; Ajax + Marowak 8-3-4 = 1 s (stack, clamp >= 0)', () => {
    expect(crashLeg('ajax', 'gengar').resolution.time.crashDelayCs).toBe(500);
    const both = crashLeg('ajax', 'alolan_marowak').resolution;
    expect(both.time.crashDelayCs).toBe(100);
    expect(both.abilityEvents.map((e) => e.abilityId)).toEqual(expect.arrayContaining(['ajax', 'alolan_marowak']));
  });
  it('flags only cover the first crash of the race (D-05), even on later legs', () => {
    const s = makeState('xavier', 'gengar', { legIndex: 2, stamina: 5, flags: { gengarWeatherUsed: false, xavierCrashUsed: true, rowanCrashUsed: false, firstCatchResolved: false } });
    const r = play(s, ctx(2), shortcut(1), 'skip', draws(ALWAYS, NEVER, NEVER)).resolution;
    expect(r.crashNegatedBy).toBeNull();
    expect(r.crashHpLoss).toBe(10);
  });
});

describe('weather abilities', () => {
  it('Gengar: one use, not consumed by zero delay, consumed by first nonzero delay', () => {
    let s = makeState('wednesday', 'gengar');
    const l1 = play(s, ctx(1, 'clear'), shortcut(1));
    expect(l1.state.flags.gengarWeatherUsed).toBe(false);
    const l2 = play(l1.state, ctx(2, 'strong_currents'), safe(1));
    expect(l2.resolution.time.weatherDelayCs).toBe(0);
    expect(l2.state.flags.gengarWeatherUsed).toBe(true);
    expect(l2.resolution.abilityEvents[0]).toMatchObject({ owner: 'pokemon', abilityId: 'gengar' });
    const l3 = play(l2.state, ctx(3, 'heavy_fog'), safe(1));
    expect(l3.resolution.time.weatherDelayCs).toBe(400);
    s = l3.state;
    expect(s.status).toBe('completed');
  });
  it('Jellicent cancels currents; Chandelure cancels fog delay but fog risk and gap loss still apply', () => {
    expect(play(makeState('wednesday', 'jellicent'), ctx(1, 'strong_currents'), shortcut(1)).resolution.time.weatherDelayCs).toBe(0);
    expect(play(makeState('wednesday', 'jellicent'), ctx(1, 'heavy_fog'), shortcut(1)).resolution.time.weatherDelayCs).toBe(700);
    const ch = play(makeState('enid', 'chandelure'), ctx(1, 'heavy_fog'), shortcut(1)).resolution;
    expect(ch.time.weatherDelayCs).toBe(0);
    expect(ch.gapBeforeCatchM).toBe(75);
    expect(ch.hydeProbability).toBeCloseTo(0.3, 12);
    expect(play(makeState('wednesday', 'chandelure'), ctx(1, 'strong_currents'), safe(1)).resolution.time.weatherDelayCs).toBe(300);
  });
  it('Divina halves currents only (6 s -> 3 s, 3 s -> 1.5 s)', () => {
    expect(play(makeState('divina', 'sableye'), ctx(1, 'strong_currents'), shortcut(1)).resolution.time.weatherDelayCs).toBe(300);
    expect(play(makeState('divina', 'sableye'), ctx(1, 'strong_currents'), safe(1)).resolution.time.weatherDelayCs).toBe(150);
    expect(play(makeState('divina', 'sableye'), ctx(1, 'heavy_fog'), safe(1)).resolution.time.weatherDelayCs).toBe(400);
  });
  it('Divina + Gengar: Gengar (full ignore) used first, Divina halves later currents', () => {
    const l1 = play(makeState('divina', 'gengar'), ctx(1, 'strong_currents'), shortcut(1));
    expect(l1.resolution.time.weatherDelayCs).toBe(0);
    expect(l1.resolution.abilityEvents.map((e) => e.abilityId)).toEqual(['gengar']);
    const l2 = play(l1.state, ctx(2, 'strong_currents'), shortcut(1));
    expect(l2.resolution.time.weatherDelayCs).toBe(300);
  });
  it('Divina + Jellicent: cancellation wins, no Divina event', () => {
    const r = play(makeState('divina', 'jellicent'), ctx(1, 'strong_currents'), shortcut(1)).resolution;
    expect(r.time.weatherDelayCs).toBe(0);
    expect(r.abilityEvents.map((e) => e.abilityId)).toEqual(['jellicent']);
  });
  it('Gengar flag untouched on a clear safe leg (zero delay)', () => {
    const r = play(makeState('bianca', 'gengar'), ctx(1, 'clear'), safe(1));
    expect(r.state.flags.gengarWeatherUsed).toBe(false);
  });
});

describe('Hyde risk abilities', () => {
  it('Froslass multiplies after flat reductions (Wednesday fog, leg 3): (0.35+0.15-0.15) x 0.85 = 0.2975', () => {
    const s = makeState('wednesday', 'froslass', { legIndex: 3, stamina: 3 });
    const r = play(s, ctx(3, 'heavy_fog'), shortcut(1)).resolution;
    expect(r.gapBeforeCatchM).toBe(75);
    expect(r.hydeProbability).toBe(0.2975);
  });
  it('Froslass alone in clear: 0.15 x 0.85', () => {
    expect(play(makeState('enid', 'froslass'), ctx(1), shortcut(1)).resolution.hydeProbability).toBe(0.1275);
  });
  it('Wednesday and Dusknoir only reduce in fog', () => {
    const s = makeState('wednesday', 'gengar', { legIndex: 2, stamina: 5 });
    expect(play(s, ctx(2, 'clear'), shortcut(1)).resolution.hydeProbability).toBe(0.25);
    expect(play(s, ctx(2, 'strong_currents'), shortcut(1)).resolution.hydeProbability).toBe(0.25);
    expect(play(s, ctx(2, 'heavy_fog'), shortcut(1)).resolution.hydeProbability).toBe(0.25); // .25 + .15 - .15
    const d = makeState('enid', 'dusknoir', { legIndex: 2, stamina: 5 });
    expect(play(d, ctx(2, 'clear'), shortcut(1)).resolution.hydeProbability).toBe(0.25);
    const fog = play(d, ctx(2, 'heavy_fog'), shortcut(1)).resolution;
    expect(fog.hydeProbability).toBe(0.3); // .25 + .15 - .10
    expect(fog.abilityEvents.map((e) => e.abilityId)).toEqual(['dusknoir']);
    const both = play(makeState('wednesday', 'dusknoir'), ctx(1, 'heavy_fog'), shortcut(1)).resolution;
    expect(both.hydeProbability).toBe(0.05); // .15 + .15 - .15 - .10
  });
});

describe('gap abilities', () => {
  it('Kent +15 m on leg 2 only', () => {
    const s = makeState('kent', 'gengar', { legIndex: 2, stamina: 5 });
    const r = play(s, ctx(2), shortcut(1)).resolution;
    expect(r.gapDeltas).toEqual([{ source: 'route', meters: -15 }, { source: 'kent', meters: 15 }]);
    expect(r.gapBeforeCatchM).toBe(100);
    expect(play(makeState('kent', 'gengar'), ctx(1), shortcut(1)).resolution.gapBeforeCatchM).toBe(85);
  });
  it('Misdreavus +10 m on shortcut only', () => {
    expect(play(makeState('enid', 'misdreavus'), ctx(1), shortcut(1)).resolution.gapBeforeCatchM).toBe(95);
    expect(play(makeState('enid', 'misdreavus'), ctx(1), safe(1)).resolution.gapBeforeCatchM).toBe(110);
  });
  it('push 3 +10 m (incl. Dragapult level 3)', () => {
    expect(play(makeState('enid', 'dragapult'), ctx(1), safe(3)).resolution.gapBeforeCatchM).toBe(120);
  });
  it('Decidueye leg 3: every negative delta recorded and negated', () => {
    const s = makeState('enid', 'decidueye', { legIndex: 3, stamina: 3 });
    const r = play(s, ctx(3, 'heavy_fog'), shortcut(3), 'skip', draws(ALWAYS, NEVER, NEVER)).resolution;
    expect(r.gapDeltas).toEqual([
      { source: 'route', meters: -15, negatedBy: 'decidueye' },
      { source: 'push3', meters: 10 },
      { source: 'crash', meters: -25, negatedBy: 'decidueye' },
      { source: 'fog', meters: -10, negatedBy: 'decidueye' },
    ]);
    expect(r.gapBeforeCatchM).toBe(110);
    expect(r.crashHpLoss).toBe(10);
    const leg2 = play(makeState('enid', 'decidueye', { legIndex: 2, stamina: 5 }), ctx(2), shortcut(1)).resolution;
    expect(leg2.gapBeforeCatchM).toBe(85);
  });
  it('Decidueye: pre-existing <= 0 gap still catches', () => {
    const s = makeState('enid', 'decidueye', { legIndex: 3, stamina: 3, pursuitGapM: 0 });
    const r = play(s, ctx(3), shortcut(1), 'skip', draws(NEVER, NEVER, NEVER)).resolution;
    expect(r.gapBeforeCatchM).toBe(0);
    expect(r.catchType).toBe('proximity');
    const s2 = makeState('enid', 'decidueye', { legIndex: 3, stamina: 3, pursuitGapM: -20 });
    expect(play(s2, ctx(3), shortcut(1)).resolution.catchType).toBe('proximity');
  });
});

describe('catch abilities', () => {
  const catchLeg = (c: CharacterId, p: PokemonId) =>
    play(makeState(c, p), ctx(1, 'clear', { shortcut: 'rare' }), shortcut(1), 'collect', draws(NEVER, NEVER, ALWAYS));
  it('Aegislash: no HP/time/egg loss, but the catch counts and a second catch is DNF', () => {
    const { state, resolution: r } = catchLeg('wednesday', 'aegislash');
    expect(r).toMatchObject({ hydeCatch: true, catchNumber: 1, catchHpLoss: 0, eggPointsLostToCatch: 0, eggPointsBanked: 3, gapEndM: 30 });
    expect(r.time.hydeDelayCs).toBe(0);
    expect(state.hydeCatchCount).toBe(1);
    const second = play(state, ctx(2), shortcut(1), 'skip', draws(NEVER, NEVER, ALWAYS));
    expect(second.state.status).toBe('dnf');
    expect(second.state.dnfReason).toBe('second_catch');
  });
  it('Morticia: first catch +5 s instead of +10 s; other penalties apply', () => {
    const r = catchLeg('morticia', 'gengar').resolution;
    expect(r.time.hydeDelayCs).toBe(500);
    expect(r.catchHpLoss).toBe(35);
    expect(r.eggPointsLostToCatch).toBe(1);
  });
  it('Morticia + Aegislash: Aegislash negates the delay entirely', () => {
    const r = catchLeg('morticia', 'aegislash').resolution;
    expect(r.time.hydeDelayCs).toBe(0);
    expect(r.abilityEvents.map((e) => e.abilityId)).toEqual(['aegislash']);
  });
  it('Dhelmise: unbanked eggs protected, HP and time still apply', () => {
    const r = catchLeg('wednesday', 'dhelmise').resolution;
    expect(r).toMatchObject({ catchHpLoss: 35, eggPointsLostToCatch: 0, eggPointsBanked: 3 });
    expect(r.time.hydeDelayCs).toBe(1000);
    expect(r.abilityEvents[0].message).toContain('protected 1 unbanked egg point');
  });
});

describe('speed abilities', () => {
  const pct = (c: CharacterId, p: PokemonId, leg: 1 | 2 | 3, route: 'safe' | 'shortcut', level: 1 | 2 | 3, weather: 'clear' | 'strong_currents' | 'heavy_fog' = 'clear', gap = 100) =>
    play(makeState(c, p, { legIndex: leg, stamina: 6, pursuitGapM: gap }), ctx(leg, weather), { route, pushLevel: level }).resolution.time;
  it('Bianca +15 only in strong currents', () => {
    expect(pct('bianca', 'gengar', 1, 'safe', 1, 'strong_currents').discountPct).toBe(20);
    expect(pct('bianca', 'gengar', 1, 'safe', 1, 'heavy_fog').discountPct).toBe(5);
  });
  it('Gomez +10 on shortcut only', () => {
    expect(pct('gomez', 'gengar', 1, 'shortcut', 1).discountPct).toBe(15);
    expect(pct('gomez', 'gengar', 1, 'safe', 1).discountPct).toBe(5);
  });
  it('Dragapult +10 all routes; level 3 = 30 (total 40)', () => {
    expect(pct('enid', 'dragapult', 1, 'safe', 1).discountPct).toBe(15);
    expect(pct('enid', 'dragapult', 1, 'safe', 3).discountPct).toBe(40);
    expect(pct('yoko', 'dragapult', 1, 'safe', 3).discountPct).toBe(40);
  });
  it('Drifblim +10 at push 2 or 3', () => {
    expect(pct('enid', 'drifblim', 1, 'safe', 1).discountPct).toBe(5);
    expect(pct('enid', 'drifblim', 1, 'safe', 2).discountPct).toBe(22);
    expect(pct('enid', 'drifblim', 1, 'safe', 3).discountPct).toBe(30);
  });
  it('Basculegion +10 when leg-start gap >= 70', () => {
    expect(pct('enid', 'basculegion', 1, 'safe', 1, 'clear', 70).discountPct).toBe(15);
    expect(pct('enid', 'basculegion', 1, 'safe', 1, 'clear', 69).discountPct).toBe(5);
  });
  it('Ceruledge +15 only on leg 3 push 3', () => {
    expect(pct('enid', 'ceruledge', 3, 'safe', 3).discountPct).toBe(35);
    expect(pct('enid', 'ceruledge', 3, 'safe', 2).discountPct).toBe(12);
    expect(pct('enid', 'ceruledge', 2, 'safe', 3).discountPct).toBe(20);
  });
  it('Corsola leg 2 push 1 = 12%', () => {
    expect(pct('enid', 'galarian_corsola', 2, 'safe', 1).discountPct).toBe(12);
    expect(pct('enid', 'galarian_corsola', 2, 'safe', 1).speedSavingsCs).toBe(660);
  });
  it('Yoko level 3 = 24%', () => {
    const t = pct('yoko', 'gengar', 1, 'safe', 3);
    expect(t.discountPct).toBe(24);
    expect(t.speedSavingsCs).toBe(48 * 24);
  });
});

describe('final scoring through the engine', () => {
  it('Gholdengo floor(banked x 1.25) and score = eggs x 100 - seconds', () => {
    let s = makeState('wednesday', 'gholdengo');
    const offers = { safe: 'common' as const, shortcut: 'rare' as const };
    s = play(s, ctx(1, 'clear', offers), shortcut(2), 'collect').state; // 3
    s = play(s, ctx(2, 'clear', offers), shortcut(2), 'collect').state; // 6
    const last = play(s, ctx(3, 'clear', offers), safe(2), 'collect'); // 7
    expect(last.state.bankedEggPoints).toBe(7);
    expect(last.state.finalEggPoints).toBe(8);
    expect(last.state.finalScore).toBe((8 * 10000 - last.state.totalSimulatedTimeCs) / 100);
    expect(last.resolution.abilityEvents.map((e) => e.abilityId)).toContain('gholdengo');
  });
  it('negative scores are allowed', () => {
    let s = makeState('wednesday', 'gengar');
    for (const leg of [1, 2, 3] as const) s = play(s, ctx(leg), safe(2)).state;
    expect(s.status).toBe('completed');
    expect(s.finalEggPoints).toBe(0);
    expect(s.finalScore).toBeLessThan(0);
    expect(s.finalScore).toBe(-s.totalSimulatedTimeCs / 100);
  });
});
