import { describe, expect, it } from 'vitest';
import { REGISTRIES } from '../../../src/mystery/draft.ts';
import type { MysteryRun } from '../../../src/mystery/run.ts';
import { hold, makeRun, modeEvents, place, placeHyde } from './helpers.ts';

const SOUTH_FACING = Math.PI;

/** Hyde chasing a standing player 1 m in front of it. */
function chasing(opts: Parameters<typeof makeRun>[0] = {}): MysteryRun {
  const run = makeRun({ ...opts, fixture: { hydeStart: { x: 0, z: -12, yaw: SOUTH_FACING }, patrol: [{ x: 0, z: -12 }] } });
  placeHyde(run, 0, -12, SOUTH_FACING);
  place(run, 0, -10.8, Math.PI);
  return run;
}

function carryEgg(run: MysteryRun): void {
  run.egg.state = 'carried';
  run.egg.x = run.player.x;
  run.egg.z = run.player.z;
}

describe('grab / catch', () => {
  it('a grab needs a windup; then −35 HP, catch 1, release at a safe point ≥ 18 m from the Hyde, invulnerable, Hyde COOLDOWN', () => {
    const run = chasing();
    const early = hold(run, 0.5);
    expect(early.some((e) => e.type === 'catch')).toBe(false);
    expect(run.hyde.grabbing).toBe(true);
    const ev = hold(run, 0.4);
    const c = ev.find((e) => e.type === 'catch');
    expect(c).toMatchObject({ catchNumber: 1, hpLost: 35, eggSecurityLost: 0, blocked: false });
    expect(run.player.hp).toBe(65);
    expect(run.player.catches).toBe(1);
    expect(run.status).toBe('playing');
    expect(Math.hypot(run.player.x - run.hyde.x, run.player.z - run.hyde.z)).toBeGreaterThanOrEqual(18);
    expect(run.player.invulnerableUntil).toBeCloseTo(c!.t + 3, 1);
    expect(modeEvents(ev).at(-1)).toMatchObject({ to: 'COOLDOWN', reason: 'grabbed' });
  });

  it('release point = among safe points ≥ 18 m from the Hyde, the one nearest the grab', () => {
    const run = chasing();
    hold(run, 1);
    // grab at (0, −10.8): candidates ≥ 18 m from the Hyde (≈ (0, −12)) are (±15, 17); (0, −5) is too close
    expect(Math.abs(run.player.x)).toBeCloseTo(15, 0);
    expect(run.player.z).toBeCloseTo(17, 0);
  });

  it('catchDamageMult scales the HP loss (Bianca: 42 HP)', () => {
    const run = chasing({ duo: { characterId: 'bianca', pokemonId: 'drifblim' }, registries: REGISTRIES });
    const ev = hold(run, 1);
    expect(ev.find((e) => e.type === 'catch')).toMatchObject({ hpLost: 42 });
  });

  it('carrying: egg security −40 × mods and the egg drops at the grab spot (retrievable)', () => {
    const run = chasing();
    carryEgg(run);
    const ev = hold(run, 1);
    expect(ev.find((e) => e.type === 'catch')).toMatchObject({ eggSecurityLost: 40 });
    expect(ev.find((e) => e.type === 'egg_damage')).toMatchObject({ amount: 40, cause: 'grab', security: 60 });
    expect(ev.find((e) => e.type === 'egg_drop')).toMatchObject({ reason: 'grab' });
    expect(run.egg.state).toBe('dropped');
    expect(Math.hypot(run.egg.x - 0, run.egg.z + 10.8)).toBeLessThan(1.5);
    expect(run.playerNav(true).reachable(run.egg, run.map.tower, 3)).toBe(true);
    expect(run.objective()).toBe('retrieve_egg');
  });

  it('invulnerability: no second grab during the safe window', () => {
    const run = chasing();
    hold(run, 1);
    placeHyde(run, run.player.x, run.player.z - 1, SOUTH_FACING);
    const ev = hold(run, 2.5);
    expect(ev.some((e) => e.type === 'catch')).toBe(false);
  });

  it('second catch → DNF (second_catch), score null, ranked as DNF', () => {
    const run = chasing();
    hold(run, 1);
    run.hydeBrain.cooldownUntil = run.t;
    run.player.invulnerableUntil = run.t;
    placeHyde(run, run.player.x, run.player.z - 1.2, SOUTH_FACING);
    run.hyde.mode = 'CHASE';
    const ev = hold(run, 1.5);
    expect(ev.find((e) => e.type === 'dnf')).toMatchObject({ reason: 'second_catch' });
    expect(run.status).toBe('dnf');
    expect(run.result()).toMatchObject({ outcome: 'dnf', dnfReason: 'second_catch', score: null, verdict: 'not_accused' });
  });

  it('HP 0 → DNF (hp_depleted) even on the first catch', () => {
    const run = chasing();
    run.player.hp = 30;
    const ev = hold(run, 1);
    expect(ev.find((e) => e.type === 'dnf')).toMatchObject({ reason: 'hp_depleted' });
    expect(run.result()?.dnfReason).toBe('hp_depleted');
  });

  it("block_grab (King's Shield): no HP / egg loss, egg kept, but the catch still counts", () => {
    const run = chasing({ duo: { characterId: 'wednesday', pokemonId: 'aegislash' }, registries: REGISTRIES });
    carryEgg(run);
    const ev = hold(run, 1, { move: true });
    expect(ev.find((e) => e.type === 'ability_used')).toMatchObject({ abilityId: REGISTRIES.partners.aegislash.move.id, kinds: ['block_grab'] });
    expect(ev.find((e) => e.type === 'catch')).toMatchObject({ catchNumber: 1, hpLost: 0, eggSecurityLost: 0, blocked: true });
    expect(run.player.hp).toBe(100);
    expect(run.player.catches).toBe(1);
    expect(run.egg.state).toBe('carried');
    expect(run.egg.security).toBe(100);
  });

  it('a stun during the windup interrupts the grab', () => {
    const run = chasing();
    hold(run, 0.3);
    expect(run.hyde.grabbing).toBe(true);
    run.hydeBrain.stun(run, 2);
    const ev = hold(run, 1.5);
    expect(ev.some((e) => e.type === 'catch')).toBe(false);
    expect(run.hyde.grabbing).toBe(false);
  });

  it('sprinting away from a standstill outruns the windup; walking away does not', () => {
    const run = chasing();
    run.player.yaw = Math.PI; // facing +Z, away from the Hyde
    const ev = hold(run, 1.0, { moveZ: 1, sprint: true });
    expect(ev.some((e) => e.type === 'catch')).toBe(false);
    const walker = chasing();
    walker.player.yaw = Math.PI;
    const ev2 = hold(walker, 1.0, { moveZ: 1 });
    expect(ev2.some((e) => e.type === 'catch')).toBe(true);
  });
});
