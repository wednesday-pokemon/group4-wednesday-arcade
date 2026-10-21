// Encounter director: calm / disturbance / hyde_emerge / surge / safe_harbour fire once each, in course order, with
// their consequences; missed triggers still fire by progress; time fallbacks wake the Hyde for an idling player; the
// Hyde-reveal cinematic is brief, once, skippable, and never stops gameplay.
import { describe, expect, it } from 'vitest';
import { HYDE, RUN } from '../../../src/action/config.ts';
import { buildCrossingCourse } from '../../../src/action/course.ts';
import { EncounterDirector } from '../../../src/action/encounters.ts';
import type { CourseDef, EncounterKind, EncounterTrigger } from '../../../src/action/types.ts';
import { Autopilot, drive, DT, FPS, newRun, ofType, openCourse, rower } from './helpers.ts';

const ORDER: EncounterKind[] = ['calm', 'disturbance', 'hyde_emerge', 'surge', 'surge', 'safe_harbour'];

/** A straight 450 u course with authored triggers on the line (like a designer's lake, minus the land). */
function scripted(over: Partial<CourseDef> = {}): CourseDef {
  const t = (id: string, kind: EncounterKind, z: number, radius = 8, params?: Record<string, number>): EncounterTrigger => ({ id, kind, x: 0, z, radius, ...(params ? { params } : {}) });
  return openCourse({
    id: 'scripted',
    finish: { x: 0, z: -450, radius: 6 },
    bounds: { minX: -200, maxX: 200, minZ: -500, maxZ: 200 },
    encounters: [
      t('e-calm', 'calm', 0, 5),
      t('e-dist', 'disturbance', -60, 8, { fogDensity: 0.5, durationS: 12 }),
      t('e-emerge', 'hyde_emerge', -90),
      t('e-surge1', 'surge', -180),
      t('e-surge2', 'surge', -300),
      t('e-harbour', 'safe_harbour', -420, 12),
    ],
    ...over,
  });
}

describe('authored triggers', () => {
  it('fire once each, in course order, with their consequences, on the way to the dock', () => {
    const run = newRun('wednesday', 'alolan_marowak', scripted());
    const input = rower(3);
    const ev = [];
    let fogAfterDisturbance = 0;
    for (let i = 0; i < 120 * FPS && run.status !== 'finished'; i++) {
      const e = run.update(DT, input());
      ev.push(...e);
      if (run.director.hasFired('disturbance') && !run.director.hasFired('hyde_emerge')) fogAfterDisturbance = Math.max(fogAfterDisturbance, run.fogAt());
    }
    expect(run.status).toBe('finished');
    const enc = ofType(ev, 'encounter');
    expect(enc.map((e) => e.kind)).toEqual(ORDER);
    expect(new Set(enc.map((e) => e.encounterId)).size).toBe(ORDER.length);
    for (let i = 1; i < enc.length; i++) expect(enc[i].t).toBeGreaterThan(enc[i - 1].t);
    // consequences, in order
    const phases = ofType(ev, 'hyde_phase').map((e) => e.phase);
    expect(phases.slice(0, 3)).toEqual(['stalking', 'emerging', 'chasing']);
    expect(phases).toContain('surging');
    expect(phases[phases.length - 1]).toBe('retreating');
    expect(fogAfterDisturbance).toBeGreaterThan(0.1); // Wednesday sees through some of it (×0.35)
    expect(run.hydeAI.surgesStarted).toBe(2);
    expect(ofType(ev, 'finish')).toHaveLength(1);
  });

  it('the disturbance fog ramps in and fades out after its duration', () => {
    const run = newRun('kent', 'alolan_marowak', scripted());
    const input = rower(3);
    for (let i = 0; i < 30 * FPS && !run.director.hasFired('disturbance'); i++) run.update(DT, input());
    const t0 = run.t;
    expect(run.fogAt()).toBeLessThan(0.05);
    drive(run, 3, input);
    expect(run.fogAt()).toBeCloseTo(0.5, 2);
    drive(run, 12 - (run.t - t0) + 0.1, input);
    expect(run.fogAt()).toBe(0);
  });

  it('a trigger the player steers around still fires once their progress passes it', () => {
    const course = scripted();
    course.encounters = course.encounters!.map((e) => (e.kind === 'disturbance' ? { ...e, x: 80 } : e));
    const run = newRun('wednesday', 'alolan_marowak', course);
    const ev = drive(run, 20, rower(3));
    const dist = ofType(ev, 'encounter').filter((e) => e.kind === 'disturbance');
    expect(dist).toHaveLength(1);
    expect(Math.abs(run.boat.x)).toBeLessThan(1); // it never came near x = 80
  });

  it('safe harbour stops catches: an idling player at the harbour is never grabbed', () => {
    const run = newRun('wednesday', 'alolan_marowak', scripted({ finish: { x: 0, z: -2000, radius: 6 }, bounds: { minX: -200, maxX: 200, minZ: -2100, maxZ: 200 } }));
    const input = rower(3);
    for (let i = 0; i < 90 * FPS && !run.safeHarbour; i++) run.update(DT, input());
    expect(run.safeHarbour).toBe(true);
    const ev = drive(run, 60);
    expect(ofType(ev, 'hyde_catch')).toHaveLength(0);
    expect(run.hyde.phase).toBe('retreating');
    expect(run.catches).toBe(0);
    expect(run.status).toBe('playing');
  });

  it('time fallbacks: an idle player meets the disturbance at dormantMaxS and the Hyde emerges stalkMaxS later', () => {
    const run = newRun('wednesday', 'alolan_marowak', scripted());
    const ev = drive(run, HYDE.dormantMaxS + HYDE.stalkMaxS + 3);
    const enc = ofType(ev, 'encounter');
    expect(enc.map((e) => e.kind)).toEqual(['calm', 'disturbance', 'hyde_emerge']);
    expect(enc[1].t).toBeCloseTo(HYDE.dormantMaxS, 1);
    expect(enc[2].t).toBeCloseTo(HYDE.dormantMaxS + HYDE.stalkMaxS, 1);
    expect(run.hyde.phase).toBe('chasing');
    // each trigger stays fired: rowing through them later does not replay them
    const later = drive(run, 15, rower(3));
    expect(ofType(later, 'encounter').filter((e) => e.kind !== 'surge')).toHaveLength(0);
  });

  it('EncounterDirector.force fires the first unfired trigger of a kind exactly once', () => {
    const d = new EncounterDirector(scripted());
    expect(d.force('surge')?.id).toBe('e-surge1');
    expect(d.force('surge')?.id).toBe('e-surge2');
    expect(d.force('surge')).toBeNull();
    expect(d.update(0, -180, 0).map((e) => e.id)).toEqual(['e-calm']); // surge 1 already used
  });
});

describe('courses without triggers (the Phase 1 crossing) get a synthetic script', () => {
  it('calm → disturbance → emerge → surge × 2 → safe harbour, once each, by progress', () => {
    const run = newRun('wednesday', 'alolan_marowak', buildCrossingCourse());
    expect(run.director.synthetic).toBe(true);
    const ev = new Autopilot(run, { tapsPerS: 3 }).drive(150);
    expect(run.status).toBe('finished');
    expect(ofType(ev, 'encounter').map((e) => e.kind)).toEqual(ORDER);
  });
});

describe('Hyde reveal cinematic', () => {
  it('plays once when he emerges, lasts ≤ 3 s, and gameplay keeps running during it', () => {
    const run = newRun('wednesday', 'alolan_marowak', scripted());
    const input = rower(3);
    expect(run.cinematic()).toBeNull();
    let starts = 0;
    let wasOn = false;
    let longest = 0;
    let movedDuring = 0;
    let tDuring = 0;
    for (let i = 0; i < 70 * FPS && run.status === 'playing'; i++) {
      const z = run.boat.z;
      const t = run.t;
      run.update(DT, input());
      const c = run.cinematic();
      if (c) {
        expect(c.kind).toBe('hyde_reveal');
        longest = Math.max(longest, c.remainingS);
        movedDuring += z - run.boat.z;
        tDuring += run.t - t;
      }
      if (c && !wasOn) starts++;
      wasOn = !!c;
    }
    expect(starts).toBe(1);
    expect(longest).toBeLessThanOrEqual(3);
    expect(longest).toBeGreaterThan(RUN.cinematicS - 0.1);
    expect(tDuring).toBeGreaterThan(RUN.cinematicS - 0.2); // the sim did not stop
    expect(movedDuring).toBeGreaterThan(10); // and the boat kept rowing
  });

  it('can be skipped (SPACE/Enter) immediately', () => {
    const run = newRun('wednesday', 'alolan_marowak', scripted());
    const input = rower(3);
    for (let i = 0; i < 30 * FPS && !run.cinematic(); i++) run.update(DT, input());
    expect(run.cinematic()).not.toBeNull();
    run.skipCinematic();
    expect(run.cinematic()).toBeNull();
    drive(run, 1, input);
    expect(run.cinematic()).toBeNull();
  });

  it('also plays when the Hyde emerges through the time fallback (idle player)', () => {
    const run = newRun('wednesday', 'alolan_marowak', scripted());
    drive(run, HYDE.dormantMaxS + HYDE.stalkMaxS - 0.5);
    expect(run.cinematic()).toBeNull();
    drive(run, 1);
    expect(run.cinematic()?.remainingS).toBeGreaterThan(0);
  });
});
