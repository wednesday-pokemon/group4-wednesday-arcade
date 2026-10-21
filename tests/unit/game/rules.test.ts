import { describe, expect, it } from 'vitest';
import {
  abandonSession, buildLegView, buildTimeBreakdown, createInitialState, getPushOptions, LEGS, prepareLeg,
  resolvePreparedLeg, RULE_CONFIG,
} from '../../../src/game/index.ts';
import type { GameState } from '../../../src/game/index.ts';
import { ALWAYS, ctx, deepFreeze, draws, makeState, NEVER, play, safe, shortcut } from './helpers.ts';

describe('initial state', () => {
  it('starts with GDD defaults', () => {
    const s = createInitialState({ sessionId: 'a', nickname: 'Nick', characterId: 'wednesday', pokemonId: 'gengar' });
    expect(s).toMatchObject({
      rulesVersion: 'v2.5', status: 'in_progress', phase: 'awaiting_route', legIndex: 1, revision: 0, hp: 100,
      stamina: 6, pursuitGapM: 100, hydeCatchCount: 0, bankedEggPoints: 0, unbankedEggPoints: 0,
      totalSimulatedTimeCs: 0, prepared: null, legResults: [], finalEggPoints: null, finalScore: null, dnfReason: null,
    });
    expect(s.flags).toEqual({ gengarWeatherUsed: false, xavierCrashUsed: false, rowanCrashUsed: false, firstCatchResolved: false });
  });
  it('Enid starts with 7 stamina', () => {
    expect(makeState('enid', 'gengar').stamina).toBe(7);
  });
});

describe('stamina legality', () => {
  it('always returns 3 options with standard costs and discounts', () => {
    const opts = getPushOptions(makeState('wednesday', 'gengar'));
    expect(opts.map((o) => [o.pushLevel, o.staminaCost, o.pushDiscountPct, o.isLegal])).toEqual([
      [1, 1, 5, true], [2, 2, 12, true], [3, 3, 20, true],
    ]);
  });
  it('must keep 1 stamina per remaining leg', () => {
    const opts = getPushOptions(makeState('wednesday', 'gengar', { stamina: 4 }));
    expect(opts[2].isLegal).toBe(false);
    expect(opts[2].disabledReason).toBe('Needs 3 stamina — you must keep 2 for the last two legs');
    expect(opts[1].isLegal).toBe(true);
  });
  it('leg 2 / leg 3 reasons', () => {
    const l2 = getPushOptions(makeState('wednesday', 'gengar', { legIndex: 2, stamina: 2 }));
    expect(l2.map((o) => o.isLegal)).toEqual([true, false, false]);
    expect(l2[1].disabledReason).toBe('Needs 2 stamina — you must keep 1 for the final leg');
    const l3 = getPushOptions(makeState('wednesday', 'gengar', { legIndex: 3, stamina: 1 }));
    expect(l3.map((o) => o.isLegal)).toEqual([true, false, false]);
    expect(l3[1].disabledReason).toBe('Needs 2 stamina but you only have 1');
  });
  it('Dragapult level 3 costs 4 stamina and gives 30%', () => {
    const ok = getPushOptions(makeState('wednesday', 'dragapult'));
    expect(ok[2]).toMatchObject({ staminaCost: 4, pushDiscountPct: 30, isLegal: true });
    const bad = getPushOptions(makeState('wednesday', 'dragapult', { stamina: 5 }));
    expect(bad[2]).toMatchObject({ staminaCost: 4, isLegal: false });
    expect(bad[2].disabledReason).toBe('Needs 4 stamina — you must keep 2 for the last two legs');
    const leg2 = getPushOptions(makeState('wednesday', 'dragapult', { legIndex: 2, stamina: 4 }));
    expect(leg2[2].isLegal).toBe(false);
    expect(leg2[2].disabledReason).toBe('Needs 4 stamina — you must keep 1 for the final leg');
    const leg2low = getPushOptions(makeState('wednesday', 'dragapult', { legIndex: 2, stamina: 2 }));
    expect(leg2low[2].disabledReason).toBe('Needs 4 stamina but you only have 2');
    const leg3 = getPushOptions(makeState('wednesday', 'dragapult', { legIndex: 3, stamina: 4 }));
    expect(leg3[2].isLegal).toBe(true);
  });
  it('Enid can push 3 on leg 1 and still afford 2+2 later (7 = 3+2+2)', () => {
    let s = makeState('enid', 'gengar');
    s = play(s, ctx(1), safe(3)).state;
    expect(s.stamina).toBe(4);
    expect(getPushOptions(s).map((o) => o.isLegal)).toEqual([true, true, true]);
    s = play(s, ctx(2), safe(2)).state;
    expect(getPushOptions(s).map((o) => o.isLegal)).toEqual([true, true, false]);
    s = play(s, ctx(3), safe(2)).state;
    expect(s.status).toBe('completed');
    expect(s.stamina).toBe(0);
  });
  it('prepare rejects an illegal push without mutating state', () => {
    const s = deepFreeze(makeState('wednesday', 'dragapult', { stamina: 5 }));
    const r = prepareLeg(s, ctx(1), shortcut(3), 0);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('ILLEGAL_STAMINA');
  });
  it('Yoko level 3 = 24%, Corsola leg 2 level 1 = 12%, Yoko+Dragapult level 3 = 30% (D-04)', () => {
    expect(getPushOptions(makeState('yoko', 'gengar'))[2].pushDiscountPct).toBe(24);
    expect(getPushOptions(makeState('yoko', 'dragapult'))[2].pushDiscountPct).toBe(30);
    expect(getPushOptions(makeState('wednesday', 'galarian_corsola'))[0].pushDiscountPct).toBe(5);
    const l2 = getPushOptions(makeState('wednesday', 'galarian_corsola', { legIndex: 2, stamina: 4 }));
    expect(l2.map((o) => o.pushDiscountPct)).toEqual([12, 12, 20]);
    expect(l2[0].staminaCost).toBe(1);
  });
});

describe('state machine and rejections', () => {
  it('prepare -> awaiting_egg with selected offer, no rolls or stamina change', () => {
    const s0 = makeState('wednesday', 'gengar');
    const r = prepareLeg(s0, ctx(1, 'heavy_fog', { safe: 'common', shortcut: 'rare' }), shortcut(2), 0);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state.phase).toBe('awaiting_egg');
    expect(r.state.revision).toBe(1);
    expect(r.state.stamina).toBe(6);
    expect(r.state.prepared).toEqual({
      route: 'shortcut', pushLevel: 2, legIndex: 1, staminaCost: 2, weather: 'heavy_fog', selectedOffer: 'rare', preparedRevision: 1,
    });
    expect(r.state.legResults).toHaveLength(0);
  });
  it('stale revision rejected (incl. repeated prepare)', () => {
    const s0 = makeState('wednesday', 'gengar');
    const p = prepareLeg(s0, ctx(1), safe(1), 0);
    if (!p.ok) throw new Error('prepare failed');
    const again = prepareLeg(p.state, ctx(1), safe(1), 0);
    expect(!again.ok && again.error.code).toBe('STALE_REVISION');
    const staleResolve = resolvePreparedLeg(p.state, ctx(1), draws(), 'skip', 0);
    expect(!staleResolve.ok && staleResolve.error.code).toBe('STALE_REVISION');
    const stalePrepare = prepareLeg(s0, ctx(1), safe(1), 5);
    expect(!stalePrepare.ok && stalePrepare.error.code).toBe('STALE_REVISION');
  });
  it('wrong phase rejected', () => {
    const s0 = makeState('wednesday', 'gengar');
    const r = resolvePreparedLeg(s0, ctx(1), draws(), 'skip', 0);
    expect(!r.ok && r.error.code).toBe('WRONG_PHASE');
    const p = prepareLeg(s0, ctx(1), safe(1), 0);
    if (!p.ok) throw new Error('prepare failed');
    const p2 = prepareLeg(p.state, ctx(1), safe(1), p.state.revision);
    expect(!p2.ok && p2.error.code).toBe('WRONG_PHASE');
  });
  it('closed sessions rejected', () => {
    let s = makeState('wednesday', 'gengar');
    for (const leg of [1, 2, 3] as const) s = play(s, ctx(leg), safe(2)).state;
    expect(s.status).toBe('completed');
    const r = prepareLeg(s, ctx(3), safe(1), s.revision);
    expect(!r.ok && r.error.code).toBe('SESSION_CLOSED');
    const a = abandonSession(makeState('wednesday', 'gengar'));
    const r2 = prepareLeg(a, ctx(1), safe(1), a.revision);
    expect(!r2.ok && r2.error.code).toBe('SESSION_CLOSED');
  });
  it('invalid inputs rejected', () => {
    const s0 = makeState('wednesday', 'gengar');
    const bad1 = prepareLeg(s0, ctx(1), { route: 'river' as never, pushLevel: 1 }, 0);
    expect(!bad1.ok && bad1.error.code).toBe('INVALID_INPUT');
    const bad2 = prepareLeg(s0, ctx(1), { route: 'safe', pushLevel: 4 as never }, 0);
    expect(!bad2.ok && bad2.error.code).toBe('INVALID_INPUT');
    const bad3 = prepareLeg(s0, ctx(2), safe(1), 0);
    expect(!bad3.ok && bad3.error.code).toBe('INVALID_INPUT');
    const p = prepareLeg(s0, ctx(1), safe(1), 0);
    if (!p.ok) throw new Error('prepare failed');
    const bad4 = resolvePreparedLeg(p.state, ctx(1), { crash: 1, eggFailure: 0, hyde: 0 }, 'skip', 1);
    expect(!bad4.ok && bad4.error.code).toBe('INVALID_INPUT');
    const bad5 = resolvePreparedLeg(p.state, ctx(1), draws(), 'maybe' as never, 1);
    expect(!bad5.ok && bad5.error.code).toBe('INVALID_INPUT');
  });
  it('collect with no egg rejected', () => {
    const s0 = makeState('wednesday', 'gengar');
    const p = prepareLeg(s0, ctx(1, 'clear', { safe: 'none', shortcut: 'rare' }), safe(1), 0);
    if (!p.ok) throw new Error('prepare failed');
    const r = resolvePreparedLeg(p.state, ctx(1), draws(), 'collect', 1);
    expect(!r.ok && r.error.code).toBe('NO_EGG_TO_COLLECT');
    const ok = resolvePreparedLeg(p.state, ctx(1), draws(), 'skip', 1);
    expect(ok.ok).toBe(true);
  });
  it('resolve produces exactly one resolution and advances', () => {
    const { state, resolution } = play(makeState('wednesday', 'gengar'), ctx(1), safe(1));
    expect(state.legResults).toEqual([resolution]);
    expect(state).toMatchObject({ legIndex: 2, phase: 'awaiting_route', revision: 2, prepared: null, stamina: 5 });
    expect(resolution.outcome).toBe('survived');
  });
  it('abandon marks session abandoned/unranked; terminal sessions unchanged', () => {
    const s0 = makeState('wednesday', 'gengar');
    const a = abandonSession(s0);
    expect(a).toMatchObject({ status: 'abandoned', phase: 'complete', finalScore: null, prepared: null });
    expect(s0.status).toBe('in_progress');
    let done = s0;
    for (const leg of [1, 2, 3] as const) done = play(done, ctx(leg), safe(2)).state;
    expect(abandonSession(done)).toBe(done);
  });
});

describe('visibility', () => {
  const c = ctx(1, 'strong_currents', { safe: 'common', shortcut: 'rare' });
  it('Eugene sees both offers before and after prepare; offers stable', () => {
    const s0 = makeState('eugene', 'gengar');
    const before = buildLegView(s0, c);
    expect(before).toEqual({ legIndex: 1, legName: 'Misty Shallows', weather: 'strong_currents', visibleOffers: { safe: 'common', shortcut: 'rare' } });
    const p = prepareLeg(s0, c, shortcut(1), 0);
    if (!p.ok) throw new Error('prepare failed');
    expect(buildLegView(p.state, c).visibleOffers).toEqual(before.visibleOffers);
    expect(p.state.prepared!.selectedOffer).toBe('rare');
    const { resolution } = play(s0, c, shortcut(1), 'collect');
    expect(resolution.eggOffer).toBe('rare');
  });
  it('others see nothing before prepare and only the selected route after', () => {
    const s0 = makeState('wednesday', 'gengar');
    expect(buildLegView(s0, c).visibleOffers).toEqual({});
    const p = prepareLeg(s0, c, safe(1), 0);
    if (!p.ok) throw new Error('prepare failed');
    expect(buildLegView(p.state, c).visibleOffers).toEqual({ safe: 'common' });
    expect(buildLegView(p.state, c).weather).toBe('strong_currents');
  });
});

describe('hand-computed time scenarios', () => {
  it('Leg 1 safe push 2 clear, Enid + Gengar: 48 s - 12% = 42.24 s', () => {
    const { state, resolution: r } = play(makeState('enid', 'gengar'), ctx(1), safe(2));
    expect(r.time).toMatchObject({
      baseCs: 4800, discountPct: 12, speedSavingsCs: 576, weatherDelayCs: 0, crashDelayCs: 0, eggDelayCs: 0,
      hydeDelayCs: 0, floorAdjustmentCs: 0, totalCs: 4224,
    });
    expect(r.time.discountSources).toEqual([{ source: 'push', pct: 12 }]);
    expect(r.gapBeforeCatchM).toBe(110);
    expect(r.hydeProbability).toBeNull();
    expect(state.stamina).toBe(5);
    expect(state.flags.gengarWeatherUsed).toBe(false);
    expect(state.totalSimulatedTimeCs).toBe(4224);
  });
  it('Leg 2 shortcut push 1 fog, Ajax + Corsola, rare collected, crash survives egg roll, no catch: 50.44 s', () => {
    const s = makeState('ajax', 'galarian_corsola', { legIndex: 2, stamina: 5 });
    const { state, resolution: r } = play(s, ctx(2, 'heavy_fog', { shortcut: 'rare' }), shortcut(1), 'collect', draws(ALWAYS, 0.9, 0.46));
    expect(r.time).toMatchObject({ baseCs: 3800, discountPct: 12, speedSavingsCs: 456, weatherDelayCs: 700, crashDelayCs: 500, eggDelayCs: 500, hydeDelayCs: 0, totalCs: 5044 });
    expect(r.crashOccurred).toBe(true);
    expect(r.crashHpLoss).toBe(10);
    expect(r.gapDeltas).toEqual([
      { source: 'route', meters: -15 }, { source: 'crash', meters: -25 }, { source: 'fog', meters: -10 },
    ]);
    expect(r.gapBeforeCatchM).toBe(50);
    expect(r.hydeProbability).toBeCloseTo(0.45, 12);
    expect(r.hydeCatch).toBe(false);
    expect(state).toMatchObject({ hp: 90, bankedEggPoints: 3, stamina: 4, legIndex: 3, pursuitGapM: 50 });
  });
  it('same leg with Hyde roll 0.44 catches: +10 s, -35 HP, rare loses 1, gap reset 30 m', () => {
    const s = makeState('ajax', 'galarian_corsola', { legIndex: 2, stamina: 5 });
    const { state, resolution: r } = play(s, ctx(2, 'heavy_fog', { shortcut: 'rare' }), shortcut(1), 'collect', draws(ALWAYS, 0.9, 0.44));
    expect(r).toMatchObject({ hydeCatch: true, catchType: 'roll', catchNumber: 1, catchHpLoss: 35, eggPointsLostToCatch: 1, eggPointsBanked: 2, gapEndM: 30 });
    expect(r.time.hydeDelayCs).toBe(1000);
    expect(r.time.totalCs).toBe(6044);
    expect(state).toMatchObject({ hp: 55, hydeCatchCount: 1, pursuitGapM: 30, bankedEggPoints: 2 });
    expect(state.flags.firstCatchResolved).toBe(true);
  });
  it('Leg 3 shortcut push 3, Yoko + Ceruledge: 24 + 15 = 39% of 34 s', () => {
    const s = makeState('yoko', 'ceruledge', { legIndex: 3, stamina: 3 });
    const { state, resolution: r } = play(s, ctx(3), shortcut(3));
    expect(r.time.discountPct).toBe(39);
    expect(r.time.speedSavingsCs).toBe(1326);
    expect(r.time.totalCs).toBe(2074);
    expect(r.gapDeltas).toEqual([{ source: 'route', meters: -15 }, { source: 'push3', meters: 10 }]);
    expect(state.status).toBe('completed');
    expect(r.outcome).toBe('finished');
  });
  it('discount cap 50: Bianca + Dragapult push 3 in currents = 30+15+10 = 55 -> 50', () => {
    const s = makeState('bianca', 'dragapult');
    const { state, resolution: r } = play(s, ctx(1, 'strong_currents'), shortcut(3));
    expect(r.time.discountSources).toEqual([
      { source: 'push', pct: 30 }, { source: 'bianca', pct: 15 }, { source: 'dragapult', pct: 10 },
    ]);
    expect(r.time.discountPct).toBe(50);
    expect(r.time.speedSavingsCs).toBe(1750);
    expect(r.time.weatherDelayCs).toBe(600);
    expect(r.time.totalCs).toBe(2350);
    expect(r.staminaCost).toBe(4);
    expect(state.stamina).toBe(2);
  });
  it('floor adjustment reconstruction (10 s minimum)', () => {
    const t = buildTimeBreakdown({ baseCs: 1200, discountPct: 50, speedSavingsCs: 600, weatherDelayCs: 150, crashDelayCs: 0, eggDelayCs: 0, hydeDelayCs: 0, discountSources: [] });
    expect(t.floorAdjustmentCs).toBe(250);
    expect(t.totalCs).toBe(1000);
    expect(t.baseCs - t.speedSavingsCs + t.weatherDelayCs + t.crashDelayCs + t.eggDelayCs + t.hydeDelayCs + t.floorAdjustmentCs).toBe(t.totalCs);
    const t2 = buildTimeBreakdown({ baseCs: 3400, discountPct: 50, speedSavingsCs: 1700, weatherDelayCs: 0, crashDelayCs: 0, eggDelayCs: 0, hydeDelayCs: 0, discountSources: [] });
    expect(t2.floorAdjustmentCs).toBe(0);
    expect(t2.totalCs).toBe(1700);
    expect(RULE_CONFIG.minLegTimeS).toBe(10);
  });
});

describe('gap, Hyde and catches', () => {
  it('safe route never rolls, even with hyde draw 0 and a small gap', () => {
    const { resolution: r } = play(makeState('wednesday', 'gengar', { pursuitGapM: 5 }), ctx(1, 'heavy_fog'), safe(1), 'skip', draws(ALWAYS, ALWAYS, ALWAYS));
    expect(r).toMatchObject({ crashOccurred: false, crashProbability: 0, hydeProbability: null, hydeCatch: false, gapBeforeCatchM: 15 });
  });
  it('safe route proximity catch still works', () => {
    const { state, resolution: r } = play(makeState('wednesday', 'gengar', { pursuitGapM: -20 }), ctx(1), safe(1));
    expect(r).toMatchObject({ gapBeforeCatchM: -10, hydeCatch: true, catchType: 'proximity', hydeProbability: null, catchNumber: 1, gapEndM: 30 });
    expect(state.hydeCatchCount).toBe(1);
  });
  it('proximity catch on shortcut uses no roll and catches at most once per leg', () => {
    const s = makeState('wednesday', 'gengar', { pursuitGapM: 10 });
    const { state, resolution: r } = play(s, ctx(1), shortcut(1), 'skip', draws(NEVER, NEVER, ALWAYS));
    expect(r.gapBeforeCatchM).toBe(-5);
    expect(r.catchType).toBe('proximity');
    expect(r.hydeProbability).toBeNull();
    expect(state.hydeCatchCount).toBe(1);
    expect(state.pursuitGapM).toBe(30);
  });
  it('gap risk bands on the updated gap: <40 +15, <70 +5', () => {
    const at = (gap: number) => play(makeState('wednesday', 'gengar', { pursuitGapM: gap }), ctx(1), shortcut(1)).resolution.hydeProbability;
    expect(at(100)).toBeCloseTo(0.15, 12); // 85 m
    expect(at(85)).toBeCloseTo(0.15, 12); // 70 m -> +0
    expect(at(84)).toBeCloseTo(0.2, 12); // 69 m -> +5
    expect(at(55)).toBeCloseTo(0.2, 12); // 40 m -> +5
    expect(at(54)).toBeCloseTo(0.3, 12); // 39 m -> +15
  });
  it('catch iff draw < p', () => {
    const s = makeState('wednesday', 'gengar');
    expect(play(s, ctx(1), shortcut(1), 'skip', draws(NEVER, NEVER, 0.1499)).resolution.hydeCatch).toBe(true);
    expect(play(s, ctx(1), shortcut(1), 'skip', draws(NEVER, NEVER, 0.15)).resolution.hydeCatch).toBe(false);
  });
  it('fog on shortcut: +15 pts risk and -10 m', () => {
    const { resolution: r } = play(makeState('enid', 'gengar'), ctx(1, 'heavy_fog'), shortcut(1));
    expect(r.gapBeforeCatchM).toBe(75);
    expect(r.hydeProbability).toBeCloseTo(0.3, 12);
  });
  it('second catch is DNF (score 0, stamina still deducted, time still added)', () => {
    const s = makeState('wednesday', 'gengar', { legIndex: 2, stamina: 4, hydeCatchCount: 1, pursuitGapM: 30, bankedEggPoints: 3, hp: 65, totalSimulatedTimeCs: 5000 });
    const { state, resolution: r } = play(s, ctx(2, 'clear', { shortcut: 'legendary' }), shortcut(2), 'collect', draws(ALWAYS, NEVER, NEVER));
    expect(r.gapBeforeCatchM).toBe(-10);
    expect(r).toMatchObject({ hydeCatch: true, catchNumber: 2, outcome: 'dnf', dnfReason: 'second_catch', catchHpLoss: 0, eggPointsBanked: 0 });
    expect(r.time.hydeDelayCs).toBe(0);
    expect(state).toMatchObject({ status: 'dnf', phase: 'complete', finalScore: 0, finalEggPoints: 0, dnfReason: 'second_catch', stamina: 2, hydeCatchCount: 2, hp: 55, legIndex: 2 });
    expect(state.totalSimulatedTimeCs).toBe(5000 + r.time.totalCs);
    expect(state.unbankedEggPoints).toBe(6);
    expect(state.bankedEggPoints).toBe(3);
  });
  it('HP <= 0 is DNF (hp_depleted)', () => {
    const s = makeState('wednesday', 'gengar', { hp: 10 });
    const { state, resolution: r } = play(s, ctx(1), shortcut(1), 'skip', draws(ALWAYS, NEVER, NEVER));
    expect(r).toMatchObject({ hpEnd: 0, outcome: 'dnf', dnfReason: 'hp_depleted' });
    expect(state).toMatchObject({ status: 'dnf', finalScore: 0, hp: 0 });
    const s2 = makeState('wednesday', 'gengar', { hp: 40 });
    const ok = play(s2, ctx(1), shortcut(1), 'skip', draws(NEVER, NEVER, ALWAYS));
    expect(ok.state.hp).toBe(5);
    expect(ok.state.status).toBe('in_progress');
    const s3 = makeState('wednesday', 'gengar', { hp: 35 });
    expect(play(s3, ctx(1), shortcut(1), 'skip', draws(NEVER, NEVER, ALWAYS)).state.dnfReason).toBe('hp_depleted');
  });
});

describe('eggs', () => {
  const caught = (pokemon: 'gengar' | 'sableye', offer: 'common' | 'rare') =>
    play(makeState('wednesday', pokemon), ctx(1, 'clear', { shortcut: offer }), shortcut(1), 'collect', draws(NEVER, NEVER, ALWAYS));
  it('1-point egg loses 0 on first catch', () => {
    const { state, resolution: r } = caught('gengar', 'common');
    expect(r).toMatchObject({ eggPointsProvisional: 1, eggPointsLostToCatch: 0, eggPointsBanked: 1 });
    expect(state.bankedEggPoints).toBe(1);
  });
  it('rare (3) loses 1', () => {
    const { resolution: r } = caught('gengar', 'rare');
    expect(r).toMatchObject({ eggPointsProvisional: 3, eggPointsLostToCatch: 1, eggPointsBanked: 2 });
  });
  it('Sableye rare (4) loses 2', () => {
    const { resolution: r } = caught('sableye', 'rare');
    expect(r).toMatchObject({ eggPointsProvisional: 4, eggPointsLostToCatch: 2, eggPointsBanked: 2 });
  });
  it('Sableye adds nothing to a common egg', () => {
    const { resolution: r } = play(makeState('wednesday', 'sableye'), ctx(1, 'clear', { safe: 'common' }), safe(1), 'collect');
    expect(r.eggPointsBanked).toBe(1);
    expect(r.abilityEvents).toHaveLength(0);
  });
  it('collect costs +5 s; crash egg failure loses the egg but keeps +5 s', () => {
    const s = makeState('wednesday', 'gengar');
    const c = ctx(1, 'clear', { shortcut: 'rare' });
    const failed = play(s, c, shortcut(1), 'collect', draws(ALWAYS, 0.2499, NEVER)).resolution;
    expect(failed).toMatchObject({ eggAttempted: true, eggFailed: true, eggPointsBanked: 0 });
    expect(failed.time.eggDelayCs).toBe(500);
    const kept = play(s, c, shortcut(1), 'collect', draws(ALWAYS, 0.25, NEVER)).resolution;
    expect(kept).toMatchObject({ eggFailed: false, eggPointsBanked: 3 });
    const noCrash = play(s, c, shortcut(1), 'collect', draws(NEVER, ALWAYS, NEVER)).resolution;
    expect(noCrash).toMatchObject({ crashOccurred: false, eggFailed: false, eggPointsBanked: 3 });
    const skipped = play(s, c, shortcut(1), 'skip', draws(ALWAYS, ALWAYS, NEVER)).resolution;
    expect(skipped).toMatchObject({ eggAttempted: false, eggFailed: false, eggPointsBanked: 0 });
    expect(skipped.time.eggDelayCs).toBe(0);
  });
  it('banking moves unbanked to banked at the dock', () => {
    const { state } = play(makeState('wednesday', 'gengar'), ctx(1, 'clear', { safe: 'common' }), safe(1), 'collect');
    expect(state.bankedEggPoints).toBe(1);
    expect(state.unbankedEggPoints).toBe(0);
  });
});

describe('purity', () => {
  it('inputs are never mutated (deep-frozen inputs through a whole race)', () => {
    let s: GameState = deepFreeze(makeState('xavier', 'decidueye'));
    const snapshot = JSON.stringify(s);
    const contexts = [ctx(1, 'heavy_fog', { shortcut: 'rare' }), ctx(2, 'strong_currents', { shortcut: 'legendary' }), ctx(3, 'heavy_fog', { shortcut: 'common' })];
    for (const c of contexts) {
      deepFreeze(c);
      const choice = deepFreeze(shortcut(1));
      const d = deepFreeze(draws(ALWAYS, 0.5, 0.99));
      const before = JSON.stringify(s);
      const p = prepareLeg(s, c, choice, s.revision);
      if (!p.ok) throw new Error(p.error.message);
      deepFreeze(p.state);
      const r = resolvePreparedLeg(p.state, c, d, 'collect', p.state.revision);
      if (!r.ok) throw new Error(r.error.message);
      expect(JSON.stringify(s)).toBe(before);
      getPushOptions(r.state);
      s = deepFreeze(r.state);
    }
    expect(s.status).toBe('completed');
    expect(snapshot).not.toBe(JSON.stringify(s));
    expect(LEGS[1].safeBaseS).toBe(48);
  });
  it('rejections return errors and leave state untouched', () => {
    const s = deepFreeze(makeState('wednesday', 'gengar'));
    const before = JSON.stringify(s);
    resolvePreparedLeg(s, ctx(1), draws(), 'skip', 0);
    prepareLeg(s, ctx(1), safe(1), 99);
    expect(JSON.stringify(s)).toBe(before);
  });
});
