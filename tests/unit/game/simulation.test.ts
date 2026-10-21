import { describe, expect, it } from 'vitest';
import {
  buildSessionView, createInitialState, createStream, deriveLegContext, getPushOptions, prepareLeg, prepareWithSeed, randomLegalPolicy,
  resolveWithSeed, SAFE_POLICY, sampleLegDraws, SHORTCUT_POLICY, simulateFromState, simulateRace,
} from '../../../src/game/index.ts';
import type { GameState, RacePolicy } from '../../../src/game/index.ts';
import { ctx, deepFreeze, makeState, safe } from './helpers.ts';

describe('A10 reproducibility', () => {
  it('same seed + decisions -> identical resolutions and score', () => {
    for (let i = 0; i < 50; i++) {
      const seed = `a10-${i}`;
      const a = simulateRace({ seed, characterId: 'gomez', pokemonId: 'froslass', policy: randomLegalPolicy(createStream(`p-${i}`)) });
      const b = simulateRace({ seed, characterId: 'gomez', pokemonId: 'froslass', policy: randomLegalPolicy(createStream(`p-${i}`)) });
      expect(b).toEqual(a);
    }
  });

  it('simulateRace reproduces a session driven through the seed wrappers', () => {
    for (let i = 0; i < 30; i++) {
      const seed = `wrap-${i}`;
      const sim = simulateRace({ seed, characterId: 'eugene', pokemonId: 'sableye', policy: SHORTCUT_POLICY, sessionId: 'sess' });
      let s: GameState = createInitialState({ sessionId: 'sess', nickname: 'Simulator', characterId: 'eugene', pokemonId: 'sableye' });
      while (s.status === 'in_progress') {
        const view = buildSessionView(s, seed, false, null).leg!;
        const choice = SHORTCUT_POLICY.chooseLeg(s, view, getPushOptions(s));
        const p = prepareWithSeed(s, seed, choice, s.revision);
        if (!p.ok) throw new Error(p.error.message);
        const offer = p.state.prepared!.selectedOffer;
        const r = resolveWithSeed(p.state, seed, offer === 'none' ? 'skip' : 'collect', p.state.revision);
        if (!r.ok) throw new Error(r.error.message);
        s = r.state;
      }
      expect(s).toEqual(sim.state);
      expect(sim.contexts).toEqual(sim.state.legResults.map((r) => deriveLegContext(seed, r.legIndex)));
    }
  });

  it('different seeds generally differ', () => {
    const scores = new Set<number | null>();
    for (let i = 0; i < 20; i++) scores.add(simulateRace({ seed: `d-${i}`, characterId: 'ajax', pokemonId: 'gengar', policy: SHORTCUT_POLICY }).state.finalScore);
    expect(scores.size).toBeGreaterThan(1);
  });
});

describe('session view', () => {
  it('reveals the seed only after the session ends', () => {
    const seed = 'view-seed';
    const s0 = makeState('eugene', 'gengar');
    const v0 = buildSessionView(s0, seed, true, 'commit');
    expect(v0.revealedSeed).toBeNull();
    expect(v0.leg).not.toBeNull();
    expect(v0.leg!.visibleOffers).toEqual(deriveLegContext(seed, 1).offers);
    expect(v0).toMatchObject({ verified: true, seedCommitment: 'commit' });
    const done = simulateRace({ seed, characterId: 'eugene', pokemonId: 'gengar', policy: SAFE_POLICY }).state;
    const v1 = buildSessionView(done, seed, true, 'commit');
    expect(v1.revealedSeed).toBe(seed);
    expect(v1.leg).toBeNull();
  });
  it('non-Eugene view hides offers until prepare', () => {
    const seed = 'view-2';
    const s0 = makeState('wednesday', 'gengar');
    expect(buildSessionView(s0, seed, false, null).leg!.visibleOffers).toEqual({});
    const p = prepareWithSeed(s0, seed, safe(1), 0);
    if (!p.ok) throw new Error('prepare failed');
    expect(buildSessionView(p.state, seed, false, null).leg!.visibleOffers).toEqual({ safe: deriveLegContext(seed, 1).offers.safe });
  });
});

describe('simulateFromState (Monte Carlo primitive)', () => {
  it('continues an in-progress state to completion deterministically and without mutation', () => {
    const start = simulateRace({ seed: 'mid', characterId: 'kent', pokemonId: 'misdreavus', policy: SAFE_POLICY });
    expect(start.state.status).toBe('completed');
    let mid = makeState('kent', 'misdreavus');
    mid = deepFreeze(mid);
    const a = simulateFromState(mid, createStream('r1'), SHORTCUT_POLICY);
    const b = simulateFromState(mid, createStream('r1'), SHORTCUT_POLICY);
    expect(a).toEqual(b);
    expect(['completed', 'dnf']).toContain(a.status);
    expect(mid.status).toBe('in_progress');
  });

  it('works from awaiting_egg and keeps the prepared offer/weather', () => {
    const c = ctx(1, 'heavy_fog', { safe: 'common', shortcut: 'rare' });
    const p = prepareLeg(makeState('wednesday', 'gengar'), c, { route: 'shortcut', pushLevel: 1 }, 0);
    if (!p.ok) throw new Error('prepare failed');
    const end = simulateFromState(deepFreeze(p.state), createStream('egg'), SAFE_POLICY);
    expect(end.legResults[0]).toMatchObject({ weather: 'heavy_fog', eggOffer: 'rare', route: 'shortcut', eggDecision: 'collect' });
    expect(end.legResults.slice(1).every((r) => r.route === 'safe')).toBe(true);
  });

  it('returns terminal states unchanged', () => {
    const done = simulateRace({ seed: 't', characterId: 'kent', pokemonId: 'gengar', policy: SAFE_POLICY }).state;
    expect(simulateFromState(done, createStream('x'), SAFE_POLICY)).toBe(done);
  });

  it('empirical shortcut DNF rate matches rule probabilities in a simple case', () => {
    // Leg 3, one catch already, gap 30, shortcut: crash (p .4) -> 30-15-25 <= 0 -> proximity catch -> DNF.
    // No crash: clear/currents gap 15 -> p = .35 + .15 = .5; fog gap 5 -> p = .35 + .15 + .15 = .65.
    const s = makeState('enid', 'gengar', { legIndex: 3, stamina: 1, hydeCatchCount: 1, pursuitGapM: 30, hp: 65 });
    const rng = createStream('mc');
    let dnf = 0;
    const n = 20000;
    const clearOnly: RacePolicy = { chooseLeg: () => ({ route: 'shortcut', pushLevel: 1 }), chooseEgg: () => 'skip' };
    for (let i = 0; i < n; i++) {
      const end = simulateFromState(s, rng, clearOnly);
      if (end.status === 'dnf') dnf++;
    }
    // P(DNF) = .4 + .6 * (.75 * .5 + .25 * .65) = .7225
    expect(Math.abs(dnf / n - 0.7225)).toBeLessThan(0.015);
  });

  it('is fast enough for the advisor (512 rollouts x 6 candidates)', () => {
    const s = makeState('gomez', 'dragapult');
    const rng = createStream('perf');
    const t0 = performance.now();
    for (let i = 0; i < 512 * 6; i++) simulateFromState(s, rng, randomLegalPolicy(rng));
    const ms = performance.now() - t0;
    expect(ms).toBeLessThan(3000);
  });

  it('sampleLegDraws consumes exactly 3 uniforms', () => {
    const a = createStream('k');
    const b = createStream('k');
    sampleLegDraws(a);
    b(); b(); b();
    expect(a()).toBe(b());
  });

  it('policies only choose legal options', () => {
    for (let i = 0; i < 200; i++) {
      for (const policy of [SAFE_POLICY, SHORTCUT_POLICY, randomLegalPolicy(createStream(`pol-${i}`))]) {
        const r = simulateRace({ seed: `pol-${i}`, characterId: 'enid', pokemonId: 'dragapult', policy });
        for (const res of r.state.legResults) expect(res.staminaEnd).toBeGreaterThanOrEqual(res.outcome === 'dnf' ? 0 : 3 - res.legIndex);
      }
    }
  });
});
