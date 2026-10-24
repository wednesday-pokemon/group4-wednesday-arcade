import { describe, expect, it } from 'vitest';
import { DEFAULT_TUNING } from '../../../src/mystery/config.ts';
import { defaultMap } from '../../../src/mystery/defaults.ts';
import { encounterSpawnsFor } from '../../../src/mystery/director.ts';
import { World } from '../../../src/mystery/geometry.ts';
import { NavGrid, pathLength } from '../../../src/mystery/nav.ts';
import { fixtureMap } from './helpers.ts';

const T = DEFAULT_TUNING;

function grids(map = defaultMap(), open: string[] = []) {
  const w = new World(map, T.nav.lowCoverBlocksMovement);
  for (const id of open) w.setWallOpen(id, true);
  return { w, player: new NavGrid(w, T.player.radius, T.nav.cellM), hyde: new NavGrid(w, T.hyde.radius, T.nav.cellM) };
}

describe('nav grid on the fixture', () => {
  const { w, player } = grids(fixtureMap());

  it('paths go through the door, never through walls, and are smoothed', () => {
    const path = player.findPath({ x: -10, z: 10 }, { x: -10, z: -10 })!;
    expect(path.length).toBeGreaterThan(1);
    expect(path.length).toBeLessThan(8);
    let prev = { x: -10, z: 10 };
    for (const p of path) {
      expect(w.sweepClear(prev.x, prev.z, p.x, p.z, T.player.radius - 0.05)).toBe(true);
      prev = p;
    }
    expect(path[path.length - 1]).toEqual({ x: -10, z: -10 });
  });

  it('unreachable goals end at the nearest reachable cell', () => {
    const p = player.findPath({ x: -10, z: 10 }, { x: -10, z: 8 })!; // inside the pillar
    const end = p[p.length - 1];
    expect(Math.hypot(end.x + 10, end.z - 8)).toBeLessThan(2);
  });
});

describe('nav reachability on the default case map (compact play area)', () => {
  const map = defaultMap();
  const closed = grids(map);
  const open = grids(map, [map.powerSwitch!.gateWallId]);
  const start = map.playerStart;
  const targets: [string, { x: number; z: number }][] = [
    ...map.clues.map((c) => [`clue ${c.clueId}`, c] as [string, { x: number; z: number }]),
    ['egg', map.eggSpawn],
    ['tower', map.tower],
    ['switch', map.powerSwitch!],
    ...map.safeReleasePoints.map((p, i) => [`safe ${i}`, p] as [string, { x: number; z: number }]),
  ];

  for (const [name, at] of targets) {
    it(`${name} is reachable from the start for the player radius (gate closed)`, () => {
      expect(closed.player.reachable(start, at, T.player.interactRangeM)).toBe(true);
    });
  }

  it('every clue, the egg and the tower are reachable for the Hyde radius too', () => {
    for (const [name, at] of targets) {
      if (name === 'switch' || name.startsWith('safe')) continue;
      expect(closed.hyde.reachable(map.hydeStart, at, T.player.interactRangeM + 1), name).toBe(true);
    }
  });

  it('every patrol waypoint is on the Hyde grid and the loop is connected', () => {
    for (const p of map.patrol) expect(closed.hyde.reachable(map.hydeStart, p, 1)).toBe(true);
  });

  it('the long way to the tower exists without the shortcut, and the shortcut is actually shorter', () => {
    const from = map.powerSwitch!;
    const longWay = closed.player.findPath(from, map.tower)!;
    const shortWay = open.player.findPath(from, map.tower)!;
    expect(longWay.length).toBeGreaterThan(0);
    const l = pathLength(from, longWay);
    const s = pathLength(from, shortWay);
    expect(s).toBeLessThan(l - 10);
    const end = longWay[longWay.length - 1];
    expect(Math.hypot(end.x - map.tower.x, end.z - map.tower.z)).toBeLessThan(map.tower.radius);
  });

  it('no director spawn (any enemy) lies within director.minSpawnM of the player start', () => {
    for (const e of ['hyde', 'crackstone', 'slurp'] as const) {
      for (const s of encounterSpawnsFor(map.world!, e)) expect(Math.hypot(s.x - start.x, s.z - start.z), s.id).toBeGreaterThanOrEqual(T.director.minSpawnM);
    }
  });

  it('builds the island grid quickly (cached per map in the sim)', () => {
    const t0 = performance.now();
    grids(map);
    expect(performance.now() - t0).toBeLessThan(1500);
  });
});
