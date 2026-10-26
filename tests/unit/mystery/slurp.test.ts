// Slurp (FINAL_CONTRACT §5) through MysteryRun: wander, sight / proximity → CHASE (enemy_detected), loud-only hearing,
// the telegraphed lunge → enemy_hit + knock-back + LEAVE, abilities by effect kind, dnf {by:'slurp'}.
import { describe, expect, it } from 'vitest';
import { withTuning } from '../../../src/mystery/config.ts';
import type { MysteryRun } from '../../../src/mystery/run.ts';
import type { StampedEvent } from '../../../src/mystery/types.ts';
import { hold, place } from './helpers.ts';
import { FINAL_TUNING, finalRun } from './finalFixture.ts';

const ofType = <T extends StampedEvent['type']>(ev: StampedEvent[], type: T) => ev.filter((e): e is Extract<StampedEvent, { type: T }> => e.type === type);

/** Slurp spawned at once (no Hyde), the player far away facing south. */
function slurpRun(duo?: MysteryRun['duo']): MysteryRun {
  const tuning = withTuning({ hyde: { emergeAfterS: 1e6 }, director: { firstSpawnS: { hyde: 1e6, slurp: 0 } } }, FINAL_TUNING);
  const run = finalRun({ tuning, duo });
  place(run, 0, 17, Math.PI);
  hold(run, 0.05);
  expect(run.slurp!.active).toBe(true);
  return run;
}

function putSlurp(run: MysteryRun, x: number, z: number, faceX: number, faceZ: number): void {
  const s = run.slurp!;
  s.x = x;
  s.z = z;
  s.yaw = Math.atan2(-(faceX - x), -(faceZ - z));
  s.path = [];
}

describe('Slurp FSM', () => {
  it('spawns WANDERing and moves between his wander points (lurching, pausing)', () => {
    const run = slurpRun();
    expect(run.slurp!.mode).toBe('WANDER');
    const x0 = run.slurp!.x;
    const z0 = run.slurp!.z;
    hold(run, 8);
    expect(Math.hypot(run.slurp!.x - x0, run.slurp!.z - z0)).toBeGreaterThan(2);
    expect(run.slurp!.mode).toBe('WANDER');
  });

  it('sees the player → CHASE (slurp_mode saw_player + enemy_detected {slurp, sight}); proximity works all around', () => {
    const run = slurpRun();
    place(run, 0, 10, 0);
    putSlurp(run, 0, 4, 0, 10); // 6 m, facing the player (door gap at x −2..2 is behind him)
    const ev = hold(run, 1.5);
    expect(ofType(ev, 'slurp_mode')[0]).toMatchObject({ from: 'WANDER', to: 'CHASE' });
    expect(ofType(ev, 'enemy_detected')[0]).toMatchObject({ enemy: 'slurp' });
    const run2 = slurpRun();
    place(run2, 8, 10, 0);
    putSlurp(run2, 8, 7.6, 8, 0); // 2.4 m away, back turned
    const ev2 = hold(run2, 0.1);
    expect(ofType(ev2, 'slurp_mode')[0]).toMatchObject({ to: 'CHASE', reason: 'sensed_player' });
    expect(ofType(ev2, 'enemy_detected')[0]).toMatchObject({ enemy: 'slurp', via: 'proximity' });
  });

  it('hears only loud noises: a walk is ignored, a sprint (≥ 0.8) sends him to INVESTIGATE', () => {
    const run = slurpRun();
    putSlurp(run, 0, 13, 0, 0); // facing away (−Z), player 4 m behind him at (0, 17)
    run.slurp!.stunnedUntil = -Infinity;
    const walk = hold(run, 0.6, { moveX: 0.01, moveZ: 0 });
    expect(ofType(walk, 'slurp_mode')).toHaveLength(0);
    run.noise('footstep', 0, 17, 0.5);
    expect(run.slurp!.mode).toBe('WANDER');
    run.noise('footstep', 0, 17, 0.95);
    expect(run.slurp!.mode).toBe('INVESTIGATE');
    expect(run.log.filter((e) => e.type === 'slurp_mode').pop()).toMatchObject({ reason: 'heard_noise' });
  });

  it('the lunge lands on a standing player: enemy_hit {slurp}, HP − 30, knock-back to a walkable cell, invulnerable, then LEAVE', () => {
    const run = slurpRun();
    place(run, 0, 10, 0);
    putSlurp(run, 0, 8.8, 0, 10);
    const ev = hold(run, 1.5);
    const hit = ofType(ev, 'enemy_hit')[0];
    expect(hit).toMatchObject({ enemy: 'slurp', hpLost: 30, blocked: false });
    expect(run.player.hp).toBe(70);
    expect(run.player.invulnerableUntil).toBeGreaterThan(run.t);
    expect(run.playerNav().walkable(run.player.x, run.player.z)).toBe(true);
    expect(Math.hypot(run.player.x - run.slurp!.x, run.player.z - run.slurp!.z)).toBeGreaterThan(1.5);
    expect(ofType(ev, 'slurp_mode').map((e) => e.to)).toEqual(expect.arrayContaining(['CHASE', 'ATTACK', 'LEAVE']));
    expect(run.player.catches).toBe(0); // never a catch
  });

  it('a sprint gets away from the lunge (telegraphed wind-up)', () => {
    const run = slurpRun();
    place(run, 0, 10, Math.PI); // facing away from him (+Z)
    putSlurp(run, 0, 8.6, 0, 10);
    const ev = hold(run, 2, { moveZ: 1, sprint: true });
    expect(ofType(ev, 'slurp_mode').some((e) => e.to === 'ATTACK')).toBe(true);
    expect(ofType(ev, 'enemy_hit')).toHaveLength(0);
  });

  it('abilities by effect kind: a stun lands on Slurp (detail names him) and cancels the lunge', () => {
    const run = slurpRun({ characterId: 'gomez', pokemonId: 'aegislash' });
    place(run, 0, 10, Math.PI);
    putSlurp(run, 0, 13, 0, 10); // 3 m in front of the player
    run.player.yaw = 0 + Math.PI; // face +Z toward him
    const ev = hold(run, 0.05, { power: true });
    const used = ofType(ev, 'ability_used')[0];
    expect(used?.detail ?? '').toMatch(/Slurp/);
    expect(run.slurp!.stunnedUntil).toBeGreaterThan(run.t);
    expect(run.slurpEffects().stunned).toBe(true);
  });

  it('premonition shows his path (slurpEffects().premonitionPath); a lure within lureRangeM pulls him (INVESTIGATE, lured)', () => {
    const run = slurpRun({ characterId: 'morticia', pokemonId: 'aegislash' });
    hold(run, 0.05, { power: true });
    const fx = run.slurpEffects();
    expect(fx.premonitionPath?.length ?? 0).toBeGreaterThanOrEqual(1);
    const run2 = slurpRun({ characterId: 'bianca', pokemonId: 'aegislash' });
    putSlurp(run2, 0, 10, 0, 0);
    place(run2, 0, 17, 0); // facing north: the decoy lands toward him
    const ev = hold(run2, 0.05, { power: true });
    expect(ofType(ev, 'ability_used')[0]?.detail ?? '').toMatch(/Slurp/);
    expect(ofType(ev, 'slurp_mode')[0]).toMatchObject({ to: 'INVESTIGATE', reason: 'lured' });
  });

  it('HP 0 after a Slurp hit → dnf {hp_depleted, by: slurp}; result().defeatedBy; death() for the cutscene', () => {
    const run = slurpRun();
    run.player.hp = 20;
    place(run, 0, 10, 0);
    putSlurp(run, 0, 8.8, 0, 10);
    hold(run, 1.5);
    expect(run.status).toBe('dnf');
    expect(run.log.at(-1)).toMatchObject({ type: 'dnf', reason: 'hp_depleted', by: 'slurp' });
    expect(run.result()).toMatchObject({ outcome: 'dnf', score: null, defeatedBy: 'slurp', hits: 1, scoreBreakdown: null });
    expect(run.death()).toMatchObject({ enemy: 'slurp', durationS: 3.6 });
    expect(run.update(1, { ...run['input'] })).toEqual([]); // no further steps after the DNF
  });
});
