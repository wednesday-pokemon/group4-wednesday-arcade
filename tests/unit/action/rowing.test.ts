import { describe, expect, it } from 'vitest';
import { InputController, type KeyLike } from '../../../src/action/input.ts';
import { ROWING } from '../../../src/action/config.ts';
import { statMultipliers, NEUTRAL_STATS } from '../../../src/action/characterStats.ts';
import { applyStroke, createBoatState, integrateBoat, type RowingModifiers } from '../../../src/action/rowing.ts';
import { createCollisionMemory, findContacts, resolveCollisions } from '../../../src/action/collision.ts';
import { buildCrossingCourse } from '../../../src/action/course.ts';
import { RowingSession } from '../../../src/action/session.ts';
import type { InputSnapshot, Obstacle } from '../../../src/action/types.ts';

const MODS: RowingModifiers = { ...statMultipliers(NEUTRAL_STATS), speedBoost: 1, staminaCost: 1 };
const NO_KEYS = { forward: false, left: false, right: false, brake: false };
const idle = (over: Partial<InputSnapshot> = {}): InputSnapshot => ({ ...NO_KEYS, interact: false, ability: false, strokes: 0, holdRow: false, ...over });

/** Rows on an open lake at a given tap rate for `seconds`, rendering at `fps`. */
function rowAt(tapsPerSecond: number, seconds: number, fps = 60, opts: { characterId?: 'enid' } = {}): RowingSession {
  const course = { ...buildCrossingCourse(), obstacles: [], currents: [], bounds: { minX: -1e4, maxX: 1e4, minZ: -1e5, maxZ: 1e4 }, finish: { x: 0, z: -1e5, radius: 1 } };
  const s = new RowingSession({ characterId: opts.characterId ?? null, pokemonId: null, course });
  const frame = 1 / fps;
  let nextTap = 0;
  for (let t = 0; t < seconds; t += frame) {
    let strokes = 0;
    while (tapsPerSecond > 0 && nextTap <= t) {
      strokes++;
      nextTap += 1 / tapsPerSecond;
    }
    s.update(frame, idle({ strokes }));
  }
  return s;
}

describe('input controller', () => {
  const key = (code: string, repeat = false): KeyLike => ({ code, repeat });

  it('counts one stroke per genuine SPACE press and ignores browser key-repeat', () => {
    const input = new InputController();
    input.onKeyDown(key('Space'));
    for (let i = 0; i < 20; i++) input.onKeyDown(key('Space', true));
    expect(input.consume().strokes).toBe(1);
    input.onKeyUp(key('Space'));
    input.onKeyDown(key('Space'));
    expect(input.consume().strokes).toBe(1);
    expect(input.consume().strokes).toBe(0);
  });

  it('tracks held WASD keys until keyup, and E/Q as one-frame edges', () => {
    const input = new InputController();
    input.onKeyDown(key('KeyA'));
    input.onKeyDown(key('KeyW'));
    input.onKeyDown(key('KeyQ'));
    let s = input.consume();
    expect([s.left, s.forward, s.ability]).toEqual([true, true, true]);
    s = input.consume();
    expect([s.left, s.ability]).toEqual([true, false]);
    input.onKeyUp(key('KeyA'));
    expect(input.consume().left).toBe(false);
  });

  it('hold-to-row mode turns a held SPACE into a steady cadence instead of strokes', () => {
    const input = new InputController();
    input.holdToRow = true;
    input.onKeyDown(key('Space'));
    const s = input.consume();
    expect(s.strokes).toBe(0);
    expect(s.holdRow).toBe(true);
  });
});

describe('rowing physics', () => {
  it('starts at rest and does not move without input', () => {
    const s = rowAt(0, 5);
    expect(s.boat.speed).toBe(0);
    expect(s.stats.distance).toBe(0);
  });

  it('each SPACE stroke propels the boat forward (−Z)', () => {
    const boat = createBoatState(0, 0, 0, 100, 100);
    const r = applyStroke(boat, MODS, ROWING, 0);
    expect(r.accepted).toBe(true);
    expect(boat.speed).toBeCloseTo(ROWING.baseImpulse, 5);
    integrateBoat(boat, NO_KEYS, MODS, ROWING, 0.1, 0.1);
    expect(boat.z).toBeLessThan(0);
  });

  it('faster tapping gives higher sustained speed, with diminishing returns and a hard cap', () => {
    // 10 s: long enough to approach each cadence's steady speed, short enough that a full-stamina sprint holds.
    const v2 = rowAt(2, 10).stats.maxSpeed;
    const v3 = rowAt(3, 10).stats.maxSpeed;
    const v6 = rowAt(6, 10).stats.maxSpeed;
    const v20 = rowAt(20, 10).stats.maxSpeed;
    expect(v3).toBeGreaterThan(v2 + 0.8);
    expect(v6).toBeGreaterThan(v3 + 0.8);
    expect(v6 - v3).toBeLessThan((v3 - v2) * 3); // diminishing returns per extra tap
    expect(v20).toBeLessThan(v6 + 1.6); // cadence cap: mashing barely helps
    expect(v20).toBeLessThanOrEqual(ROWING.maxSpeed);
    expect(rowAt(20, 5).stats.missedStrokes).toBeGreaterThan(0);
  });

  it('decelerates smoothly when rowing stops, and S brakes harder', () => {
    const coast = createBoatState(0, 0, 0, 100, 100);
    coast.speed = 8;
    const brake = { ...coast };
    for (let i = 0; i < 120; i++) {
      integrateBoat(coast, NO_KEYS, MODS, ROWING, 1 / 120, 10);
      integrateBoat(brake, { ...NO_KEYS, brake: true }, MODS, ROWING, 1 / 120, 10);
    }
    expect(coast.speed).toBeLessThan(8);
    expect(coast.speed).toBeGreaterThan(5);
    expect(brake.speed).toBeLessThan(coast.speed - 1.5);
  });

  it('is frame-rate independent (30 vs 144 fps within 3%)', () => {
    const a = rowAt(3, 15, 30);
    const b = rowAt(3, 15, 144);
    expect(Math.abs(a.boat.z - b.boat.z) / Math.abs(b.boat.z)).toBeLessThan(0.03);
  });

  it('steers left with A and right with D, with reduced authority at rest', () => {
    const fast = createBoatState(0, 0, 0, 100, 100);
    fast.speed = 8;
    const slow = createBoatState(0, 0, 0, 100, 100);
    for (let i = 0; i < 60; i++) {
      integrateBoat(fast, { ...NO_KEYS, left: true }, MODS, ROWING, 1 / 120, 0);
      integrateBoat(slow, { ...NO_KEYS, left: true }, MODS, ROWING, 1 / 120, 0);
    }
    expect(fast.heading).toBeGreaterThan(0);
    expect(slow.heading).toBeGreaterThan(0);
    expect(slow.heading).toBeLessThan(fast.heading);
    const right = createBoatState(0, 0, 0, 100, 100);
    right.speed = 8;
    for (let i = 0; i < 60; i++) integrateBoat(right, { ...NO_KEYS, right: true }, MODS, ROWING, 1 / 120, 0);
    expect(right.heading).toBeLessThan(0);
  });

  it('W alone glides to a modest cruise speed but never to racing speed', () => {
    const boat = createBoatState(0, 0, 0, 100, 100);
    for (let i = 0; i < 1200; i++) integrateBoat(boat, { ...NO_KEYS, forward: true }, MODS, ROWING, 1 / 120, i / 120);
    expect(boat.speed).toBeGreaterThan(1.5);
    expect(boat.speed).toBeLessThanOrEqual(ROWING.cruiseSpeed);
  });
});

describe('stamina', () => {
  it('sprinting drains stamina, moderate rowing is sustainable, and it never goes negative', () => {
    const sprint = rowAt(6, 30);
    const steady = rowAt(2, 30);
    expect(sprint.boat.stamina).toBeLessThan(steady.boat.stamina - 20);
    expect(sprint.boat.stamina).toBeGreaterThanOrEqual(0);
    expect(steady.boat.stamina).toBeGreaterThan(steady.boat.maxStamina * 0.8);
  });

  it('low stamina weakens strokes; coasting recovers it', () => {
    const tired = createBoatState(0, 0, 0, 100, 100);
    tired.stamina = 0;
    const fresh = createBoatState(0, 0, 0, 100, 100);
    expect(applyStroke(tired, MODS, ROWING, 0).power).toBeLessThan(applyStroke(fresh, MODS, ROWING, 0).power * 0.5);
    for (let i = 0; i < 600; i++) integrateBoat(tired, NO_KEYS, MODS, ROWING, 1 / 120, 10 + i / 120);
    expect(tired.stamina).toBeGreaterThan(20);
  });

  it('character stats change rowing performance (Enid-like stamina vs neutral)', () => {
    const high = statMultipliers({ ...NEUTRAL_STATS, stamina: 9, rowingPower: 8 });
    expect(high.maxStamina).toBeGreaterThan(statMultipliers(NEUTRAL_STATS).maxStamina);
    expect(high.power).toBeGreaterThan(1);
  });
});

describe('collisions', () => {
  const rock: Obstacle = { id: 'r1', kind: 'rock', x: 0, z: -5, radius: 2, halfLength: 0, angle: 0, damage: 14 };

  it('a head-on hit damages HP, cuts speed and pushes the boat out', () => {
    const boat = createBoatState(0, -2.2, 0, 100, 100);
    boat.speed = 9;
    const hits = resolveCollisions(boat, findContacts(boat, [rock], 0), createCollisionMemory(), 1, 0, 1 / 120);
    expect(hits).toHaveLength(1);
    expect(boat.hp).toBeLessThan(100);
    expect(boat.speed).toBeLessThan(5);
    expect(findContacts(boat, [rock], 0)).toHaveLength(0);
  });

  it('the same obstacle cannot hurt again during its cooldown (no damage spam)', () => {
    const boat = createBoatState(0, -2.2, 0, 100, 100);
    boat.speed = 9;
    const mem = createCollisionMemory();
    resolveCollisions(boat, findContacts(boat, [rock], 0), mem, 1, 0, 1 / 120);
    const hp = boat.hp;
    for (let t = 0.1; t < 1.4; t += 0.1) {
      boat.z = -2.4;
      boat.heading = 0;
      boat.speed = 9;
      resolveCollisions(boat, findContacts(boat, [rock], t), mem, 1, t, 1 / 120);
    }
    expect(boat.hp).toBe(hp);
  });

  it('a glancing scrape costs less than a head-on crash; defense reduces damage', () => {
    const headOn = createBoatState(0, -2.2, 0, 100, 100);
    headOn.speed = 9;
    const glance = createBoatState(-3.4, -5, 0, 100, 100);
    glance.speed = 9;
    resolveCollisions(headOn, findContacts(headOn, [rock], 0), createCollisionMemory(), 1, 0, 1 / 120);
    resolveCollisions(glance, findContacts(glance, [rock], 0), createCollisionMemory(), 1, 0, 1 / 120);
    expect(100 - glance.hp).toBeLessThan(100 - headOn.hp);
    const tough = createBoatState(0, -2.2, 0, 100, 100);
    tough.speed = 9;
    resolveCollisions(tough, findContacts(tough, [rock], 0), createCollisionMemory(), statMultipliers({ ...NEUTRAL_STATS, defense: 9 }).damageTaken, 0, 1 / 120);
    expect(tough.hp).toBeGreaterThan(headOn.hp);
  });

  it('a session reports collision events when rowing into a rock', () => {
    const course = { ...buildCrossingCourse(), obstacles: [rock], currents: [] };
    const s = new RowingSession({ characterId: null, pokemonId: null, course });
    const seen: string[] = [];
    for (let i = 0; i < 60 * 6; i++) seen.push(...s.update(1 / 60, idle({ strokes: i % 20 === 0 ? 1 : 0 })).map((e) => e.type));
    expect(seen).toContain('stroke');
    expect(seen).toContain('collision');
    expect(s.stats.collisions).toBeGreaterThan(0);
    expect(s.boat.hp).toBeLessThan(100);
  });

  it('a session finishes at the dock and freezes the active timer there', () => {
    const course = { ...buildCrossingCourse(), obstacles: [], currents: [], finish: { x: 0, z: -40, radius: 4 } };
    const s = new RowingSession({ characterId: null, pokemonId: null, course });
    const seen: string[] = [];
    for (let i = 0; i < 60 * 30 && !s.finished; i++) seen.push(...s.update(1 / 60, idle({ strokes: i % 20 === 0 ? 1 : 0 })).map((e) => e.type));
    expect(seen).toContain('finish');
    const t = s.stats.activeTimeS;
    s.update(1, idle({ strokes: 1 }));
    expect(s.stats.activeTimeS).toBe(t);
  });
});

describe('the crossing course', () => {
  it('has a navigable corridor from start to dock for the hull width at all drift phases', () => {
    const course = buildCrossingCourse();
    const cell = 1;
    const clearance = 0.85;
    for (const t of [0, 1.5, 3, 4.5]) {
      const cols = Math.round((course.bounds.maxX - course.bounds.minX) / cell);
      const rows = Math.round((course.bounds.maxZ - course.bounds.minZ) / cell);
      const free = (cx: number, cz: number) => {
        const x = course.bounds.minX + cx * cell;
        const z = course.bounds.minZ + cz * cell;
        const probe = createBoatState(x, z, 0, 100, 100);
        return findContacts(probe, course.obstacles.map((o) => ({ ...o, radius: o.radius + clearance - 0.75 })), t).length === 0;
      };
      const start = [Math.round((course.start.x - course.bounds.minX) / cell), Math.round((course.start.z - course.bounds.minZ) / cell)];
      const goalZ = Math.round((course.finish.z + course.finish.radius - course.bounds.minZ) / cell);
      const seen = new Set<string>([start.join()]);
      const queue = [start];
      let reached = false;
      while (queue.length && !reached) {
        const [cx, cz] = queue.shift()!;
        if (cz <= goalZ) reached = true;
        for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = cx + dx;
          const nz = cz + dz;
          const k = `${nx},${nz}`;
          if (nx < 0 || nz < 0 || nx > cols || nz > rows || seen.has(k) || !free(nx, nz)) continue;
          seen.add(k);
          queue.push([nx, nz]);
        }
      }
      expect(reached, `blocked at drift t=${t}`).toBe(true);
    }
  });
});

describe('course boundary', () => {
  it('slides along the shore instead of stopping dead when rowing at an angle into it', async () => {
    const { clampToBounds } = await import('../../../src/action/collision.ts');
    const boat = createBoatState(-42.5, -50, 0.72, 100, 100);
    boat.speed = 8;
    for (let i = 0; i < 120; i++) {
      integrateBoat(boat, NO_KEYS, MODS, ROWING, 1 / 120, 0);
      clampToBounds(boat, { minX: -42, maxX: 42, minZ: -430, maxZ: 18 }, 1 / 120);
      boat.speed = Math.max(boat.speed, 8 * 0.6);
    }
    expect(boat.x).toBe(-42);
    expect(boat.z).toBeLessThan(-52); // still makes forward progress along the edge
  });
});

describe('recovering from a crash', () => {
  it('after hitting a rock head-on, steering away and rowing frees the boat (never stuck)', () => {
    const rock: Obstacle = { id: 'r9', kind: 'rock', x: 0, z: -20, radius: 2.4, halfLength: 0, angle: 0, damage: 14 };
    const course = { ...buildCrossingCourse(), obstacles: [rock], currents: [] };
    const s = new RowingSession({ characterId: null, pokemonId: null, course });
    let i = 0;
    while (s.stats.collisions === 0 && i++ < 60 * 20) s.update(1 / 60, idle({ strokes: i % 20 === 0 ? 1 : 0 }));
    expect(s.stats.collisions).toBe(1);
    const zAtHit = s.boat.z;
    for (let k = 0; k < 60 * 4; k++) s.update(1 / 60, idle({ right: k < 25, strokes: k % 20 === 0 ? 1 : 0 }));
    expect(s.boat.speed).toBeGreaterThan(2);
    expect(s.boat.z).toBeLessThan(zAtHit - 8); // made it past the rock
  });
});
