import { describe, expect, it } from 'vitest';
import { segSegDist2, World, forward, yawTo, pointInPolygon } from '../../../src/mystery/geometry.ts';
import { fixtureMap, hold, input, makeRun, place } from './helpers.ts';

describe('geometry primitives', () => {
  it('segment–segment distance', () => {
    expect(segSegDist2(0, 0, 10, 0, 5, -1, 5, 1)).toBeCloseTo(0); // crossing
    expect(Math.sqrt(segSegDist2(0, 0, 10, 0, 0, 2, 10, 2))).toBeCloseTo(2); // parallel
    expect(Math.sqrt(segSegDist2(0, 0, 1, 0, 4, 4, 4, 4))).toBeCloseTo(5); // point vs segment end
  });

  it('yaw convention: yaw 0 faces −Z, positive yaw turns left (towards −X)', () => {
    expect(forward(0).z).toBeCloseTo(-1);
    expect(forward(Math.PI / 2).x).toBeCloseTo(-1);
    expect(yawTo(0, 0, -1, 0)).toBeCloseTo(Math.PI / 2);
    expect(yawTo(0, 0, 0, -5)).toBeCloseTo(0);
  });

  it('point in polygon', () => {
    const sq = [{ x: 0, z: 0 }, { x: 0, z: 2 }, { x: 2, z: 2 }, { x: 2, z: 0 }];
    expect(pointInPolygon(1, 1, sq)).toBe(true);
    expect(pointInPolygon(3, 1, sq)).toBe(false);
  });
});

describe('collision', () => {
  const world = new World(fixtureMap(), true);

  it('never tunnels through a thin wall, even with a huge single move', () => {
    for (const dz of [-0.3, -2, -10, -40]) {
      const r = world.move(-10, 1, 0, dz, 0.4);
      expect(r.z).toBeGreaterThan(0.25 + 0.4 - 1e-6); // stays north of the wall at z 0 (half thickness 0.25)
    }
  });

  it('slides along a wall instead of stopping (diagonal push keeps the tangential motion)', () => {
    const r = world.move(-10, 0.66, 3, -3, 0.4);
    expect(r.x).toBeGreaterThan(-7.2); // moved ~3 m along the wall
    expect(r.z).toBeGreaterThan(0.64);
    expect(world.isFree(r.x, r.z, 0.4)).toBe(true);
  });

  it('never ends inside a solid and is never stuck in a corner', () => {
    // walk into the corner made by the dividing wall and the west boundary, then walk out
    let x = -18;
    let z = 3;
    for (let i = 0; i < 120; i++) {
      const r = world.move(x, z, -0.1, -0.1, 0.4);
      x = r.x;
      z = r.z;
      expect(world.isFree(x, z, 0.4)).toBe(true);
    }
    const out = world.move(x, z, 2, 2, 0.4);
    expect(Math.hypot(out.x - x, out.z - z)).toBeGreaterThan(2.5);
  });

  it('player input against a wall slides and does not get stuck (sim level)', () => {
    const run = makeRun();
    place(run, -10, 1.2, Math.PI / 4); // facing north-west-ish... forward = (−sin, −cos)
    run.player.yaw = -Math.PI / 4; // forward = (0.707, −0.707): diagonally into the wall, to the east
    const x0 = run.player.x;
    hold(run, 2, { moveZ: 1 });
    expect(run.player.z).toBeGreaterThan(0.6);
    expect(run.player.x - x0).toBeGreaterThan(2);
  });

  it('cover: high cover and (by default) low cover block movement; open gate removes a wall', () => {
    expect(world.isFree(-10, 8, 0.4)).toBe(false);
    expect(world.isFree(8, 8, 0.4)).toBe(false);
    const w2 = new World(fixtureMap(), false);
    expect(w2.isFree(8, 8, 0.4)).toBe(true);
    expect(w2.isFree(12, 0, 0.4)).toBe(false);
    w2.setWallOpen('gate', true);
    expect(w2.isFree(12, 0, 0.4)).toBe(true);
  });

  it('line of sight: walls and high cover block; low cover only for a crouching target', () => {
    expect(world.lineOfSight(-5, 5, -5, -5)).toBe(false); // wall
    expect(world.lineOfSight(0, 5, 0, -5)).toBe(true); // through the door
    expect(world.lineOfSight(-10, 12, -10, 4)).toBe(false); // pillar
    expect(world.lineOfSight(8, 12, 8, 4, false)).toBe(true); // crate, standing target
    expect(world.lineOfSight(8, 12, 8, 4, true)).toBe(false); // crate, crouching target
  });

  it('sprinting at full speed for many steps never crosses the wall', () => {
    const run = makeRun();
    place(run, -8, 6, 0); // facing −Z towards the wall
    hold(run, 4, { moveZ: 1, sprint: true });
    expect(run.player.z).toBeGreaterThan(0.6);
    void input;
  });
});
