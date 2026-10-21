import { describe, expect, it } from 'vitest';
import { DEFAULT_TUNING } from '../../../src/mystery/config.ts';
import { hearingRadiusM } from '../../../src/mystery/data/tuning.ts';
import { World } from '../../../src/mystery/geometry.ts';
import { hear, hearingRadius } from '../../../src/mystery/noise.ts';
import { canSee } from '../../../src/mystery/sight.ts';
import { fixtureMap } from './helpers.ts';

const T = DEFAULT_TUNING;
const world = new World(fixtureMap(), true);

describe('noise', () => {
  it('loudness → radius follows the tuning knots (crouch 2, walk 7, sprint 13, egg drop 17) and matches tuning.ts', () => {
    expect(hearingRadius(T.noise.crouch, T.noise.knots)).toBeCloseTo(2);
    expect(hearingRadius(T.noise.walk, T.noise.knots)).toBeCloseTo(7);
    expect(hearingRadius(T.noise.sprint, T.noise.knots)).toBeCloseTo(13);
    expect(hearingRadius(T.noise.eggDrop, T.noise.knots)).toBeCloseTo(17);
    for (let l = 0; l <= 1.0001; l += 0.05) expect(hearingRadius(l, T.noise.knots)).toBeCloseTo(hearingRadiusM(l));
    expect(hearingRadius(0, T.noise.knots)).toBe(0);
  });

  it('attenuates with distance', () => {
    expect(hear(world, T.noise, T.noise.walk, 0, 10, 0, 16).heard).toBe(true); // 6 m, open
    expect(hear(world, T.noise, T.noise.walk, 0, 10, 0, 18).heard).toBe(false); // 8 m
    expect(hear(world, T.noise, T.noise.sprint, 0, 10, 0, 22).heard).toBe(true); // 12 m
  });

  it('a wall halves the radius (max 2 walls counted) and reports occlusion', () => {
    const open = hear(world, T.noise, T.noise.sprint, -10, 4, -10, 14); // 10 m, no wall
    const walled = hear(world, T.noise, T.noise.sprint, -10, 4, -10, -6); // 10 m through the dividing wall
    expect(open.heard).toBe(true);
    expect(walled.heard).toBe(false);
    expect(walled.occluded).toBe(true);
    expect(walled.effectiveRadiusM).toBeCloseTo(13 * 0.5);
    expect(hear(world, T.noise, T.noise.eggDrop, -10, 4, -10, -2).heard).toBe(true); // 6 m < 8.5 m through the wall
  });

  it('listener multiplier (COOLDOWN hearing) shrinks the radius', () => {
    expect(hear(world, T.noise, T.noise.walk, 0, 10, 0, 15, 1).heard).toBe(true);
    expect(hear(world, T.noise, T.noise.walk, 0, 10, 0, 15, T.noise.cooldownHearingMult).heard).toBe(false);
  });
});

describe('sight', () => {
  const viewer = { x: 0, z: 10, yaw: 0 }; // facing −Z
  const opts = { fog: false, distracted: false };
  const target = (x: number, z: number, crouched = false, hiddenRevealM: number | null = null) => ({ x, z, crouched, hiddenRevealM });

  it('cone: 100° total', () => {
    expect(canSee(world, T.sight, viewer, target(0, 5), opts).seen).toBe(true);
    expect(canSee(world, T.sight, viewer, target(3, 6), opts).seen).toBe(true); // ~37° off axis
    expect(canSee(world, T.sight, viewer, target(5, 9), opts).blockedBy).toBe('cone'); // ~79°
    expect(canSee(world, T.sight, viewer, target(0, 14), opts).blockedBy).toBe('cone'); // behind
  });

  it('range 13 m clear, 8 m in fog; crouching shortens it (× 0.7); distraction × 0.3', () => {
    const v = { x: 0, z: 19, yaw: 0 };
    expect(canSee(world, T.sight, v, target(0, 7), opts).seen).toBe(true); // 12 m
    expect(canSee(world, T.sight, v, target(0, 5), opts).blockedBy).toBe('range'); // 14 m
    expect(canSee(world, T.sight, v, target(0, 9), { fog: true, distracted: false }).blockedBy).toBe('range'); // 10 m > 8
    expect(canSee(world, T.sight, v, target(0, 8, true), opts).blockedBy).toBe('range'); // 11 m > 9.1 crouched
    expect(canSee(world, T.sight, v, target(0, 10.5, true), opts).seen).toBe(true); // 8.5 m < 9.1
    expect(canSee(world, T.sight, v, target(0, 14), { fog: false, distracted: true }).blockedBy).toBe('range'); // 5 m > 3.9
  });

  it('walls and high cover block; low cover blocks only a crouching player', () => {
    expect(canSee(world, T.sight, { x: -5, z: 5, yaw: 0 }, target(-5, -3), opts).blockedBy).toBe('wall');
    expect(canSee(world, T.sight, { x: -10, z: 12, yaw: 0 }, target(-10, 4), opts).blockedBy).toBe('wall'); // pillar
    expect(canSee(world, T.sight, { x: 8, z: 12, yaw: 0 }, target(8, 5), opts).seen).toBe(true);
    expect(canSee(world, T.sight, { x: 8, z: 12, yaw: 0 }, target(8, 5, true), opts).blockedBy).toBe('low_cover');
  });

  it('hiding spot: unseen unless the Hyde is within revealM', () => {
    expect(canSee(world, T.sight, { x: -15, z: 10, yaw: Math.PI }, target(-15, 15, true, 2), opts).blockedBy).toBe('hidden');
    expect(canSee(world, T.sight, { x: -15, z: 13.5, yaw: Math.PI }, target(-15, 15, true, 2), opts).seen).toBe(true);
  });
});
