// End-to-end on the default Stage 1 course (the designer's lake when src/action/data/lake.ts exists, otherwise the
// Phase 1 crossing): an autopilot rows at a fixed cadence and steers along each route's lantern line (A* between its
// waypoints around land and obstacles). Every route must reach the dock; a clean 3 taps/s run finishes in a sane
// time; a reasonable player on the safe route is not DNF'd; a player who stops rowing mid-course gets caught.
import { describe, expect, it } from 'vitest';
import { CHARACTER_ACTION_DEFS } from '../../../src/action/data/characters.ts';
import { POKEMON_ABILITY_DEFS } from '../../../src/action/data/pokemon.ts';
import { defaultCourse, hasLakeCourse } from '../../../src/action/courseResolver.ts';
import type { StageOneRun } from '../../../src/action/run.ts';
import type { ActionEvent, CourseDef, Vec2 } from '../../../src/action/types.ts';
import type { CharacterId, PokemonId } from '../../../src/game/types.ts';
import { HYDE } from '../../../src/action/config.ts';
import { Autopilot, coursePaths, idle, newRun, ofType, type AutopilotOptions } from './helpers.ts';
import { describeResult, runScenario, type Archetype } from './scenarios.ts';

const LAKE = hasLakeCourse();
const course: CourseDef = defaultCourse();
const routes = coursePaths(course);
const safe = routes.find((r) => r.risk === 'safe') ?? routes.find((r) => r.risk === 'direct') ?? routes[0];
/** Sane finish window for a clean 3 taps/s run (lake target for a typical player: 70–100 s). */
const SANE: [number, number] = LAKE ? [50, 120] : [35, 80];

function autoRun(path: Vec2[], o: Omit<AutopilotOptions, 'path'>, characterId: CharacterId = 'wednesday', pokemonId: PokemonId = 'alolan_marowak', maxS = 240) {
  const run = newRun(characterId, pokemonId, course);
  const ap = new Autopilot(run, { ...o, path });
  const events = ap.drive(maxS);
  return { run, events };
}

function summary(name: string, run: StageOneRun, events: ActionEvent[]): string {
  return `${name}: ${run.status} t=${run.t.toFixed(1)}s catches=${run.catches} hp=${run.boat.hp} collisions=${run.stats.collisions} ` +
    `inDanger=${run.stats.timeInDangerS.toFixed(1)}s closeCalls=${run.stats.hydeCloseCalls} grabs=${ofType(events, 'hyde_catch').length}`;
}

describe(`end-to-end on ${course.name} (${LAKE ? 'lake.ts' : 'fallback crossing — lake.ts not present'})`, () => {
  it('has at least one route, and the open lake offers at least 3 routes', () => {
    expect(routes.length).toBeGreaterThanOrEqual(1);
    if (LAKE) expect(routes.length).toBeGreaterThanOrEqual(3);
  });

  it.each(routes.map((r) => [r.id, r] as const))('route %s reaches the dock at 3 taps/s in a sane time', (id, r) => {
    const { run, events } = autoRun(r.path, { tapsPerS: 3 });
    console.info(`[e2e] ${summary(`route ${id} (${r.risk}) 3 taps/s`, run, events)}`);
    expect(run.status, summary(id, run, events)).toBe('finished');
    expect(ofType(events, 'finish')).toHaveLength(1);
    expect(run.distanceToDock()).toBe(0);
    expect(run.progress).toBeGreaterThan(0.95);
    expect(run.t).toBeGreaterThan(SANE[0]);
    expect(run.t).toBeLessThan(SANE[1]);
    // the full encounter script played, in order
    const kinds = ofType(events, 'encounter').map((e) => e.kind);
    expect(kinds[0]).toBe('calm');
    expect(kinds.indexOf('disturbance')).toBeLessThan(kinds.indexOf('hyde_emerge'));
    expect(kinds[kinds.length - 1]).toBe('safe_harbour');
    expect(kinds.filter((k) => k === 'surge').length).toBeGreaterThanOrEqual(1);
  });

  it(`a reasonable player (3 taps/s, no abilities) on the safe route "${safe.id}" escapes: finished, no DNF`, () => {
    const { run, events } = autoRun(safe.path, { tapsPerS: 3 });
    expect(run.status, summary(safe.id, run, events)).toBe('finished');
    expect(run.catches).toBe(0);
  });

  it('every character escapes on the safe route at 3 taps/s (selection never makes Stage 1 unwinnable)', () => {
    const lines: string[] = [];
    for (const d of CHARACTER_ACTION_DEFS) {
      const { run, events } = autoRun(safe.path, { tapsPerS: 3 }, d.id);
      lines.push(`${d.id} ${run.t.toFixed(1)}s`);
      expect(run.status, summary(d.id, run, events)).toBe('finished');
      expect(run.catches, d.id).toBe(0);
    }
    console.info(`[e2e] safe route finish times by character: ${lines.join(', ')}`);
  });

  it('every Pokémon escapes on the safe route at 3 taps/s, pressing Q whenever ready', () => {
    for (const p of POKEMON_ABILITY_DEFS) {
      const run = newRun('wednesday', p.id, course);
      const ap = new Autopilot(run, { tapsPerS: 3, path: safe.path, useQInRescue: true });
      for (let i = 0; i < 240 * 60 && run.status !== 'finished' && run.status !== 'dnf'; i++) {
        const input = ap.input(1 / 60);
        if (run.status === 'playing' && run.abilityStatus().ready && run.hydeAI.hunting) input.ability = true;
        run.update(1 / 60, input);
      }
      expect(run.status, p.id).toBe('finished');
      expect(run.catches, p.id).toBe(0);
    }
  });

  it('hold-to-row (accessibility, 3 strokes/s) also escapes on the safe route', () => {
    const run = newRun('wednesday', 'alolan_marowak', course);
    const ap = new Autopilot(run, { tapsPerS: 0, path: safe.path });
    for (let i = 0; i < 240 * 60 && run.status !== 'finished' && run.status !== 'dnf'; i++) run.update(1 / 60, { ...ap.input(1 / 60), holdRow: true });
    expect(run.status).toBe('finished');
    expect(run.catches).toBe(0);
  });

  it('a player who stops rowing for a long stretch mid-course gets caught', () => {
    let stopAt = Infinity;
    const { run, events } = autoRun(safe.path, {
      tapsPerS: 3,
      rowingAt: (t, r) => {
        if (stopAt === Infinity && r.hydeAI.hunting && r.progress > 0.35) stopAt = t;
        return !(t >= stopAt && t < stopAt + 30);
      },
    });
    const grabs = ofType(events, 'hyde_catch');
    console.info(`[e2e] ${summary('stops rowing for 30 s at 35 %', run, events)}; first grab ${grabs[0] ? (grabs[0].t - stopAt).toFixed(1) : '-'} s after stopping`);
    expect(stopAt).toBeLessThan(Infinity);
    expect(grabs.length).toBeGreaterThanOrEqual(1);
    expect(grabs[0].t).toBeGreaterThan(stopAt);
    expect(grabs[0].t - stopAt).toBeLessThan(25);
  });

  it('a player who never rows is caught twice (DNF) — the Hyde really can end the run', () => {
    const run = newRun('wednesday', 'alolan_marowak', course);
    const events: ActionEvent[] = [];
    for (let i = 0; i < 180 * 60 && run.status !== 'dnf'; i++) events.push(...run.update(1 / 60, idle()));
    expect(run.status).toBe('dnf');
    expect(ofType(events, 'dnf')).toHaveLength(1);
    console.info(`[e2e] idle player: first grab at ${ofType(events, 'hyde_catch')[0].t.toFixed(1)} s, DNF at ${run.t.toFixed(1)} s`);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// D-32 Hyde balance on the lake (scripted archetypes, tests/unit/action/scenarios.ts). Only meaningful on lake.ts.
// ---------------------------------------------------------------------------------------------------------------
const B_VARIANTS: Archetype[] = [
  { name: '2.5 taps/s, 2 s stop every 15 s', tapsPerS: 2.5, stops: { everyS: 15, stopS: 2 } },
  { name: '2 taps/s, 2 s stop every 15 s', tapsPerS: 2, stops: { everyS: 15, stopS: 2 } },
  { name: '2.5 taps/s, 3 crashes', tapsPerS: 2.5, crashAtProgress: [0.3, 0.55, 0.8] },
  { name: '2 taps/s, 2 crashes', tapsPerS: 2, crashAtProgress: [0.4, 0.75] },
];

describe.runIf(LAKE)('D-32 Hyde balance on the lake', () => {
  it.each(routes.map((r) => [r.id, r] as const))('clean 3 taps/s on %s: never caught, steady gap ~15–22 u, every surge brings him inside 15 u', (id, r) => {
    const res = runScenario(course, r.path, { name: 'clean', tapsPerS: 3 });
    console.info(`[d32] ${describeResult(`${id} clean 3`, res)}`);
    expect(res.status).toBe('finished');
    expect(res.grabs).toBe(0);
    expect(res.steadyGap).toBeGreaterThan(15);
    expect(res.steadyGap).toBeLessThan(23);
    expect(res.surges.length).toBeGreaterThanOrEqual(2);
    for (const sd of res.surges) expect(sd.minGap, describeResult(id, res)).toBeLessThan(15);
    expect(res.minGap).toBeGreaterThan(HYDE.lungeRangeU); // close, but never in lunge range
  });

  it('2–2.5 taps/s with brief stops or 2–3 crashes: close calls, caught at most 1 run in 4, a rescue Q saves every catch', () => {
    let runs = 0;
    let caught = 0;
    let close = 0;
    for (const r of routes) {
      for (const a of B_VARIANTS) {
        const res = runScenario(course, r.path, a);
        console.info(`[d32] ${describeResult(`${r.id} ${a.name}`, res)}`);
        runs++;
        if (res.minGap < HYDE.surgeHoldGapU) close++;
        expect(res.status).toBe('finished');
        if (res.grabs > 0) {
          caught++;
          const q = runScenario(course, r.path, { ...a, useQInRescue: true });
          expect(q.catches, `${r.id} ${a.name} with Q`).toBe(0);
          expect(q.status).toBe('finished');
        }
      }
    }
    expect(caught).toBeGreaterThanOrEqual(1); // he can really get them
    expect(caught / runs).toBeLessThanOrEqual(0.25);
    expect(close / runs).toBeGreaterThanOrEqual(0.75); // he got right on their stern
  });

  it('1.5 taps/s on the safe route is caught at least once', () => {
    const res = runScenario(course, safe.path, { name: 'weak', tapsPerS: 1.5 });
    console.info(`[d32] ${describeResult('safe 1.5', res)}`);
    expect(res.grabs).toBeGreaterThanOrEqual(1);
  });

  it('crashing repeatedly during a surge gets you caught', () => {
    const res = runScenario(course, safe.path, { name: 'panic', tapsPerS: 3, crashDuringSurgeEveryS: 1.2 });
    console.info(`[d32] ${describeResult('safe surge crashes', res)}`);
    expect(res.grabs).toBeGreaterThanOrEqual(1);
  });

  it('an idle player DNFs well before the dock', () => {
    const res = runScenario(course, safe.path, { name: 'idle', tapsPerS: 0, idle: true });
    expect(res.status).toBe('dnf');
    expect(res.t).toBeLessThan(90);
    expect(res.run.progress).toBeLessThan(0.5);
  });

  it('all 12 characters × 18 Pokémon finish the safe route at 3 taps/s with 0 catches', () => {
    const failures: string[] = [];
    for (const c of CHARACTER_ACTION_DEFS) {
      for (const p of POKEMON_ABILITY_DEFS) {
        const res = runScenario(course, safe.path, { name: 'clean', tapsPerS: 3 }, c.id, p.id);
        if (res.status !== 'finished' || res.catches > 0 || res.grabs > 0) failures.push(describeResult(`${c.id}+${p.id}`, res));
      }
    }
    expect(failures).toEqual([]);
  }, 900000);
});
