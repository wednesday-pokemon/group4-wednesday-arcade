import { describe, expect, it } from 'vitest';
import { chooseSpawn } from '../../../src/mystery/hyde.ts';
import { fixtureMap, hold, makeRun, modeEvents, place, placeHyde } from './helpers.ts';

/** Hyde parked at (x, z) (single-point patrol) facing `yaw`. */
function parked(x: number, z: number, yaw: number) {
  const run = makeRun({ fixture: { hydeStart: { x, z, yaw }, patrol: [{ x, z }] } });
  placeHyde(run, x, z, yaw);
  return run;
}

const EAST = -Math.PI / 2; // forward (+1, 0)
const SOUTH_FACING = Math.PI; // forward (0, +1): faces +Z
const NORTH_FACING = 0; // forward (0, −1): faces −Z

describe('Hyde FSM — hearing', () => {
  it('walking near (behind it) → hyde_heard then INVESTIGATE_SOUND with reason heard_noise', () => {
    const run = parked(0, -12, NORTH_FACING); // faces away from the player
    place(run, -2, -7, EAST);
    const ev = hold(run, 1.5, { moveZ: 1 });
    expect(ev.some((e) => e.type === 'hyde_heard' && e.source === 'footstep')).toBe(true);
    const m = modeEvents(ev);
    expect(m[0]).toMatchObject({ from: 'PATROL', to: 'INVESTIGATE_SOUND', reason: 'heard_noise' });
    expect(run.hyde.target).not.toBeNull();
  });

  it('a single walking step is not enough (suspicion ramp: investigateAt 0.3)', () => {
    const run = parked(0, -12, NORTH_FACING);
    place(run, -2, -7, EAST);
    const ev = hold(run, 0.3, { moveZ: 1 }); // first footstep lands at ~0.25 s
    expect(ev.filter((e) => e.type === 'hyde_heard').length).toBe(1);
    expect(modeEvents(ev)).toHaveLength(0);
    expect(run.hyde.suspicion).toBeGreaterThan(0.15);
  });

  it('sprinting is heard further than walking', () => {
    const walk = parked(10, -18, NORTH_FACING);
    place(walk, 6, -8, EAST);
    const evWalk = hold(walk, 1.5, { moveZ: 1 });
    expect(evWalk.some((e) => e.type === 'hyde_heard')).toBe(false);
    const sprint = parked(10, -18, NORTH_FACING);
    place(sprint, 6, -8, EAST);
    const evSprint = hold(sprint, 1.0, { moveZ: 1, sprint: true });
    expect(evSprint.some((e) => e.type === 'hyde_heard')).toBe(true);
    expect(modeEvents(evSprint)[0]).toMatchObject({ to: 'INVESTIGATE_SOUND', reason: 'heard_noise' });
  });

  it('crouching right behind it is nearly silent: heard faintly but never investigated', () => {
    const run = parked(0, -12, NORTH_FACING);
    place(run, -1.6, -10.4, EAST);
    const ev = hold(run, 2, { moveZ: 1, crouch: true });
    expect(modeEvents(ev)).toHaveLength(0);
    expect(run.hyde.mode).toBe('PATROL');
    expect(run.hyde.suspicion).toBeLessThan(0.3);
  });

  it('walls muffle: a sprint through the dividing wall at 9 m is not heard', () => {
    const run = parked(-10, -5, NORTH_FACING);
    place(run, -12, 4, EAST);
    const ev = hold(run, 1.0, { moveZ: 1, sprint: true });
    expect(ev.some((e) => e.type === 'hyde_heard')).toBe(false);
  });
});

describe('Hyde FSM — sight, loss, search, cooldown', () => {
  it('sight → CHASE after a visible suspicion ramp (not instant at 7 m)', () => {
    const run = parked(0, -12, SOUTH_FACING);
    place(run, 0, -5, Math.PI);
    hold(run, 0.3);
    expect(run.hyde.mode).toBe('PATROL');
    expect(run.hyde.suspicion).toBeGreaterThan(0.2);
    expect(run.hyde.canSeePlayer).toBe(true);
    const ev = hold(run, 0.8);
    expect(modeEvents(ev)[0]).toMatchObject({ from: 'PATROL', to: 'CHASE', reason: 'saw_player' });
    expect(run.log.some((e) => e.type === 'hyde_sighted')).toBe(true);
  });

  it('within 3 m the chase starts immediately', () => {
    const run = parked(0, -12, SOUTH_FACING);
    place(run, 0, -9.5, Math.PI);
    const ev = hold(run, 0.05);
    expect(modeEvents(ev)[0]).toMatchObject({ to: 'CHASE', reason: 'saw_player' });
  });

  it('a hidden, crouching player is not seen from outside revealM', () => {
    const run = makeRun({ fixture: { hydeStart: { x: -15, z: 10, yaw: SOUTH_FACING }, patrol: [{ x: -15, z: 10 }] } });
    placeHyde(run, -15, 10, SOUTH_FACING);
    place(run, -15, 15);
    hold(run, 3, { crouch: true });
    expect(run.player.hidden).toBe(true);
    expect(run.hyde.mode).toBe('PATROL');
    expect(run.hyde.suspicion).toBe(0);
  });

  it('lost sight → SEARCH (lost_sight) after ~4 s → COOLDOWN (search_timeout) after 8 s → PATROL (cooldown_done)', () => {
    const run = parked(0, -12, SOUTH_FACING);
    place(run, 0, -5, Math.PI);
    hold(run, 1.2);
    expect(run.hyde.mode).toBe('CHASE');
    place(run, -15, 17); // vanish behind the wall, silent
    const ev = hold(run, 20);
    const m = modeEvents(ev).map((e) => `${e.to}:${e.reason}`);
    expect(m.slice(0, 3)).toEqual(['SEARCH:lost_sight', 'COOLDOWN:search_timeout', 'PATROL:cooldown_done']);
    const lost = modeEvents(ev)[0];
    const searchEnd = modeEvents(ev)[1];
    expect(lost.t - 1.2).toBeGreaterThanOrEqual(3.9);
    expect(searchEnd.t - lost.t).toBeCloseTo(8, 0);
    expect(ev.some((e) => e.type === 'hyde_lost')).toBe(true);
  });

  it('distraction ends a chase without sight (no hearing, sight × 0.3)', () => {
    const run = parked(0, -12, SOUTH_FACING);
    place(run, 0, -5, Math.PI);
    hold(run, 1.2);
    expect(run.hyde.mode).toBe('CHASE');
    place(run, 6, -3); // still in the cone but > 0.3 × 13 m away
    run.hydeBrain.distract(run, 5);
    const ev = hold(run, 0.2);
    expect(modeEvents(ev)[0]).toMatchObject({ from: 'CHASE', to: 'SEARCH', reason: 'lost_sight' });
    const ev2 = hold(run, 2, { moveZ: 1, sprint: true });
    expect(ev2.some((e) => e.type === 'hyde_heard')).toBe(false);
  });

  it('lure: INVESTIGATE_SOUND (lured) to the decoy, ignoring a visible player', () => {
    const run = parked(0, -12, SOUTH_FACING);
    place(run, 0, -5, Math.PI);
    run.hydeBrain.lure(run, { x: 12, z: -15 }, 4);
    expect(run.hyde.mode).toBe('INVESTIGATE_SOUND');
    expect(run.log.at(-1)).toMatchObject({ type: 'hyde_mode', reason: 'lured' });
    hold(run, 3);
    expect(run.hyde.mode).not.toBe('CHASE');
    expect(Math.hypot(run.hyde.x - 12, run.hyde.z + 15)).toBeLessThan(Math.hypot(0 - 12, -12 + 15));
  });

  it('an investigation it cannot complete is abandoned after investigateMaxS (gave_up)', () => {
    const run = parked(0, -12, NORTH_FACING);
    run.hydeBrain.setMode(run, 'INVESTIGATE_SOUND', 'heard_noise');
    run.hyde.target = { x: -10, z: 8 }; // inside the pillar, north of the wall: never "reached"
    run.hyde.slowMult = 0.05;
    run.hyde.slowedUntil = 1e9; // crawl so it cannot get there in time
    const ev = hold(run, run.tuning.hyde.investigateMaxS + 0.5);
    expect(modeEvents(ev)[0]).toMatchObject({ from: 'INVESTIGATE_SOUND', to: 'SEARCH', reason: 'gave_up' });
  });

  it('stun freezes it and switches to SEARCH (stunned) once', () => {
    const run = parked(0, -12, SOUTH_FACING);
    place(run, 0, -5, Math.PI);
    hold(run, 1.2);
    run.hydeBrain.stun(run, 2);
    expect(run.log.at(-1)).toMatchObject({ type: 'hyde_mode', from: 'CHASE', to: 'SEARCH', reason: 'stunned' });
    const x = run.hyde.x;
    const z = run.hyde.z;
    hold(run, 1.9);
    expect(run.hyde.x).toBe(x);
    expect(run.hyde.z).toBe(z);
  });

  it('every mode change is logged with a reason, and modes only change through these events', () => {
    const run = parked(0, -12, SOUTH_FACING);
    place(run, 0, -5, Math.PI);
    let mode = run.hyde.mode;
    for (let i = 0; i < 60 * 25; i++) {
      const before = run.log.length;
      run.step();
      for (const e of run.log.slice(before)) if (e.type === 'hyde_mode') {
        expect(e.from).toBe(mode);
        mode = e.to;
      }
      expect(run.hyde.mode).toBe(mode);
      if (run.status !== 'playing') break;
    }
  });
});

describe('spawn', () => {
  it('never spawns within minSpawnM of the player', () => {
    const map = fixtureMap({ hydeStart: { x: 0, z: 10, yaw: 0 }, patrol: [{ x: 0, z: 12 }, { x: 0, z: -15 }] });
    const s = chooseSpawn(map, { x: 0, z: 17 }, 25);
    expect(Math.hypot(s.x, s.z - 17)).toBeGreaterThanOrEqual(25);
    const run = makeRun({ map, tutorial: true });
    run.player.z = 15;
    run.endTutorial();
    expect(Math.hypot(run.hyde.x - run.player.x, run.hyde.z - run.player.z)).toBeGreaterThanOrEqual(25);
  });
});
