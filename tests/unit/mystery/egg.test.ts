import { describe, expect, it } from 'vitest';
import { DEFAULT_TUNING } from '../../../src/mystery/config.ts';
import { eggTierForSeed, EGG_TIERS } from '../../../src/mystery/scoring.ts';
import type { MysteryRun } from '../../../src/mystery/run.ts';
import { CASE_SOLUTIONS } from '../../../src/mystery/data/solutions.ts';
import { CASE, hold, makeRun, place } from './helpers.ts';

function carrying(): MysteryRun {
  const run = makeRun({ fixture: { hydeStart: { x: 15, z: 15, yaw: 0 }, patrol: [{ x: 15, z: 15 }] } });
  run.hydeBrain.active = false; // keep the Hyde out of these tests
  run.egg.state = 'carried';
  return run;
}

describe('egg tier', () => {
  it('is a pure function of the seed with ≈ 50 / 35 / 15 weights', () => {
    const counts = { common: 0, rare: 0, legendary: 0 };
    const N = 6000;
    for (let i = 0; i < N; i++) counts[eggTierForSeed(`seed-${i}`, DEFAULT_TUNING.egg.tierWeights)]++;
    expect(counts.common / N).toBeGreaterThan(0.47);
    expect(counts.common / N).toBeLessThan(0.53);
    expect(counts.rare / N).toBeGreaterThan(0.32);
    expect(counts.rare / N).toBeLessThan(0.38);
    expect(counts.legendary / N).toBeGreaterThan(0.13);
    expect(counts.legendary / N).toBeLessThan(0.17);
    expect(eggTierForSeed('x', DEFAULT_TUNING.egg.tierWeights)).toBe(eggTierForSeed('x', DEFAULT_TUNING.egg.tierWeights));
    expect(EGG_TIERS).toHaveLength(3);
  });

  it('the run egg has the seed tier and whole points (1 / 3 / 6)', () => {
    const run = makeRun({ seed: 'abc' });
    expect(run.egg.tier).toBe(eggTierForSeed('abc', DEFAULT_TUNING.egg.tierWeights));
    expect(run.egg.points).toBe({ common: 1, rare: 3, legendary: 6 }[run.egg.tier]);
  });
});

describe('egg carry / drop / deposit', () => {
  it('pickup takes pickupS × interactTimeMult and makes a small noise', () => {
    const run = makeRun();
    run.hydeBrain.active = false;
    place(run, 10, -13.5);
    hold(run, 0.05, { interact: true });
    expect(run.player.interacting?.target).toBe('egg');
    expect(run.interactable()).toMatchObject({ kind: 'egg' });
    hold(run, 1.25);
    expect(run.egg.state).toBe('carried');
    expect(run.log.some((e) => e.type === 'egg_pickup')).toBe(true);
    expect(run.objective()).toBe('deliver_egg');
  });

  it('a tap of E never drops the egg; holding E for 0.8 s sets it down quietly', () => {
    const run = carrying();
    place(run, -10, 15);
    expect(run.interactable()).toMatchObject({ kind: 'egg', label: 'Hold E to set the egg down', progress: 0 });
    hold(run, 0.1, { interact: true });
    hold(run, 1);
    expect(run.egg.state).toBe('carried');
    hold(run, 0.5, { interact: true, interactHeld: true });
    expect(run.egg.state).toBe('carried');
    expect(run.interactable()!.progress).toBeGreaterThan(0.5);
    const ev = hold(run, 0.4, { interactHeld: true });
    expect(ev.find((e) => e.type === 'egg_drop')).toMatchObject({ reason: 'manual', security: 100 });
    expect(ev.find((e) => e.type === 'noise' && e.source === 'egg_drop')).toMatchObject({ loudness: DEFAULT_TUNING.noise.eggSetDown });
    expect(run.egg.state).toBe('dropped');
  });

  it('impacts while sprinting into a wall cost security; at ≤ 30 the egg falls (loud)', () => {
    const run = carrying();
    run.egg.security = 35;
    place(run, -10, 6, 0);
    const ev = hold(run, 3, { moveZ: 1, sprint: true });
    const dmg = ev.filter((e) => e.type === 'egg_damage');
    expect(dmg.length).toBeGreaterThanOrEqual(1);
    expect(dmg[0]).toMatchObject({ cause: 'impact', amount: 8 });
    expect(ev.find((e) => e.type === 'egg_drop')).toMatchObject({ reason: 'impact' });
    expect(ev.find((e) => e.type === 'noise' && e.source === 'egg_drop')).toMatchObject({ loudness: 1 });
  });

  it('a dropped egg is always clamped to a reachable cell (no softlock), even against a wall', () => {
    const run = carrying();
    place(run, 5, 0.66);
    hold(run, 0.9, { interactHeld: true });
    expect(run.egg.state).toBe('dropped');
    expect(run.playerNav(true).walkable(run.egg.x, run.egg.z)).toBe(true);
    expect(run.playerNav(true).reachable(run.egg, run.map.tower, 3)).toBe(true);
  });

  it('deposit: E inside the tower (1 s), clock stops, idempotent, one accusation', () => {
    const run = carrying();
    run.t = 100;
    place(run, 0, -17);
    expect(run.interactable()).toMatchObject({ kind: 'tower' });
    const ev = hold(run, 1.2, { interact: true });
    expect(ev.filter((e) => e.type === 'egg_delivered')).toHaveLength(1);
    expect(run.status).toBe('accusing');
    expect(run.deliveredAt).toBeCloseTo(101, 0);
    const tAt = run.t;
    expect(run.update(1, run_input({ moveZ: 1, interact: true }))).toEqual([]);
    expect(run.t).toBe(tAt);
    expect(run.log.filter((e) => e.type === 'egg_delivered')).toHaveLength(1);
    const sol = CASE_SOLUTIONS[CASE.id];
    const acc = run.accuse({ suspectId: sol.culprit, evidence: [...sol.supportingEvidence] }, sol);
    expect(acc.map((e) => e.type)).toEqual(['accusation', 'finish']);
    // no clue was found: the uncitable clue ids are dropped from the recorded evidence
    expect(acc[0]).toMatchObject({ type: 'accusation', suspectId: sol.culprit, correct: true, cluesFound: 0, evidence: [], deductionCorrect: false });
    expect(run.accuse({ suspectId: 'galpin', evidence: [] }, sol)).toEqual([]);
    expect(run.status).toBe('finished');
    const r = run.result()!;
    expect(r.activeTimeS).toBeCloseTo(101, 0);
    expect(r.eggPoints).toBe(run.egg.points);
    // mystery-v4: delivery 1000 + correct culprit 300 + no clues + no detections 150 + no hints 150 + time bonus
    expect(r.scoreBreakdown).toMatchObject({ delivery: 1000, accusation: 300, clues: 0, noHints: 150, hintPenalty: 0 });
    expect(r.score).toBe(r.scoreBreakdown!.total);
    expect(r.verdict).toBe('egg_secured_mystery_unsolved'); // no clues found
    expect(r).toMatchObject({ caseId: CASE.id, caseVersion: CASE.version, accused: sol.culprit, correct: true, deductionCorrect: false, evidence: [] });
  });

  it('walking out of the tower cancels the deposit', () => {
    const run = carrying();
    place(run, 0, -16, Math.PI);
    hold(run, 0.05, { interact: true });
    hold(run, 1.2, { moveZ: 1, sprint: true });
    expect(run.status).toBe('playing');
    expect(run.egg.state).toBe('carried');
  });
});

describe('clue search', () => {
  it('search takes searchS × interactTimeMult, keeps progress when you walk away, then counts', () => {
    const run = makeRun();
    run.hydeBrain.active = false;
    place(run, -15, 11.2, 0);
    const ev = hold(run, 0.05, { interact: true });
    expect(ev.find((e) => e.type === 'clue_search_start')).toMatchObject({ clueId: 'falsified_transfer' });
    hold(run, 1);
    expect(run.player.interacting!.progress).toBeGreaterThan(0.35);
    run.player.yaw = Math.PI; // walk away (+Z)
    hold(run, 1.5, { moveZ: 1 });
    expect(run.player.interacting).toBeNull();
    const prog = run.interaction.clueProgress.get('falsified_transfer')!;
    expect(prog).toBeGreaterThan(0.35);
    expect(prog).toBeLessThan(1);
    expect(run.cluesFound).toHaveLength(0);
    place(run, -15, 11.2, 0);
    hold(run, 0.05, { interact: true });
    expect(run.player.interacting!.progress).toBeCloseTo(prog, 1);
    const done = hold(run, 2.5 * (1 - prog) + 0.1);
    expect(done.find((e) => e.type === 'clue_found')).toMatchObject({ clueId: 'falsified_transfer', cluesFound: 1 });
    expect(run.interactable()).toBeNull();
  });

  it('searching makes a small periodic noise ring', () => {
    const run = makeRun();
    run.hydeBrain.active = false;
    place(run, -15, 11.2, 0);
    const ev = hold(run, 2.4, { interact: true });
    expect(ev.filter((e) => e.type === 'noise' && e.source === 'interact').length).toBeGreaterThanOrEqual(3);
  });

  it('tutorial: the practice crate gives a 1 s search and no evidence; nothing is logged', () => {
    const run = makeRun({ tutorial: true });
    const crate = run.practicePoint;
    place(run, crate.x, crate.z + 1.2);
    expect(run.interactable()).toMatchObject({ kind: 'practice' });
    const out = run.update(0.2, run_input({ interact: true }));
    expect(out.some((e) => e.type === 'noise' && e.seq === 0)).toBe(true);
    for (let i = 0; i < 5; i++) run.update(0.2, run_input());
    expect(run.interaction.practiceDone).toBe(true);
    expect(run.cluesFound).toHaveLength(0);
    expect(run.log).toHaveLength(0);
    run.endTutorial();
    expect(run.t).toBe(0);
    expect(run.status).toBe('playing');
  });
});

function run_input(p: Partial<import('../../../src/mystery/types.ts').MysteryInput> = {}) {
  return { moveX: 0, moveZ: 0, lookYawDelta: 0, lookPitchDelta: 0, sprint: false, crouch: false, interact: false, power: false, move: false, hint: false, ...p };
}
