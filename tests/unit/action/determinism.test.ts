// Determinism and pause: identical input scripts give identical runs; time only advances through update().
import { describe, expect, it } from 'vitest';
import { MAX_FRAME_S } from '../../../src/action/config.ts';
import { defaultCourse } from '../../../src/action/courseResolver.ts';
import type { StageOneRun } from '../../../src/action/run.ts';
import type { ActionEvent } from '../../../src/action/types.ts';
import { Autopilot, chaseCourse, coursePaths, drive, idle, idleUntilCatch, newRun, openCourse, rower, startChase } from './helpers.ts';

function snapshot(run: StageOneRun, events: ActionEvent[]) {
  return JSON.stringify({
    t: run.t, status: run.status, catches: run.catches, boat: run.boat, hyde: run.hyde, rescue: run.rescue,
    ability: run.ability, stats: run.stats, last: run.lastRescue, removed: [...run.removedObstacles], events,
  });
}

/** Autopilot along the course's first route, pressing Q every 9 s and in rescues; mixed frame lengths. */
function scripted(seedPokemon: 'dragapult' | 'gengar') {
  const course = defaultCourse();
  const run = newRun('gomez', seedPokemon, course);
  const ap = new Autopilot(run, { tapsPerS: 2.6, useQInRescue: true, path: coursePaths(course)[0].path });
  const events: ActionEvent[] = [];
  const frames = [1 / 60, 1 / 30, 1 / 144, 0.05];
  for (let i = 0; i < 5000 && run.status !== 'finished' && run.status !== 'dnf'; i++) {
    const dt = frames[i % frames.length];
    const input = ap.input(dt);
    if (i % 400 === 399) input.ability = true;
    events.push(...run.update(dt, input));
  }
  return snapshot(run, events);
}

describe('determinism', () => {
  it('two runs with identical input scripts end in identical state (boat, Hyde, stats, events)', () => {
    for (const p of ['dragapult', 'gengar'] as const) {
      const a = scripted(p);
      const b = scripted(p);
      expect(a.length).toBeGreaterThan(1000);
      expect(a).toBe(b);
    }
  });

  it('the run does not mutate the CourseDef it was given (each run clones it)', () => {
    const course = chaseCourse({ obstacles: [{ id: 'l', kind: 'log', x: 0, z: -15, radius: 0.6, halfLength: 2, angle: Math.PI / 2, damage: 8 }] });
    const before = JSON.stringify(course);
    const run = newRun('rowan', 'sableye', course); // Rowan shoves obstacles (mutates its own copy)
    drive(run, 10, rower(3));
    expect(run.displacedObstacles.size).toBe(1);
    expect(JSON.stringify(course)).toBe(before);
  });

  it('is close to frame-rate independent (30 / 60 / 144 fps rowing: same distance within 2 %)', () => {
    const dist = (fps: number) => {
      const run = newRun('wednesday', 'sableye', openCourse());
      let real = 0;
      let next = 0;
      for (let i = 0; i < 20 * fps; i++) {
        real += 1 / fps;
        let strokes = 0;
        while (next <= real) {
          strokes++;
          next += 1 / 3;
        }
        run.update(1 / fps, idle({ strokes }));
      }
      return -run.boat.z;
    };
    const ref = dist(60);
    expect(Math.abs(dist(30) - ref) / ref).toBeLessThan(0.02);
    expect(Math.abs(dist(144) - ref) / ref).toBeLessThan(0.02);
  });
});

describe('pause', () => {
  it('not calling update() (paused) never advances time, the boat or the Hyde', () => {
    const run = newRun('wednesday', 'alolan_marowak', chaseCourse());
    startChase(run, 3);
    drive(run, 3, rower(3));
    const before = snapshot(run, []);
    // … the game is paused for a while: no update calls at all …
    expect(snapshot(run, [])).toBe(before);
    // a zero-length frame (pause overlay still up) does nothing either
    run.update(0, idle());
    expect(run.t).toBe(JSON.parse(before).t);
  });

  it('a huge frame after a tab switch is clamped (MAX_FRAME_S), so the boat never teleports', () => {
    const run = newRun('wednesday', 'alolan_marowak', openCourse());
    drive(run, 3, rower(3));
    const t0 = run.t;
    const z0 = run.boat.z;
    run.update(30, idle());
    expect(run.t - t0).toBeLessThanOrEqual(MAX_FRAME_S + 1e-9);
    expect(Math.abs(run.boat.z - z0)).toBeLessThan(2);
  });

  it('pause is refused during the rescue window and allowed again after it', () => {
    const run = newRun('wednesday', 'alolan_marowak', chaseCourse());
    startChase(run);
    idleUntilCatch(run);
    expect(run.canPause()).toBe(false);
    drive(run, 2.2);
    expect(run.status).toBe('playing');
    expect(run.canPause()).toBe(true);
  });
});
