// The Hyde is a real pursuer: he follows the boat's wake (never ahead, never cutting corners), sits on screen behind a
// clean rower (D-32: 15–22 u), closes when the player idles, crashes or rows weakly, telegraphs surges that bring him
// to the stern (surge hold), lunges in a short snap that a boat holding its pace survives, raises threat as the gap
// shrinks, and can and will catch an idle or 1.5 taps/s player.
import { describe, expect, it } from 'vitest';
import { HYDE } from '../../../src/action/config.ts';
import { STAGE_TUNING } from '../../../src/action/data/stages.ts';
import type { StageOneRun } from '../../../src/action/run.ts';
import { HydeAI, NEUTRAL_HYDE_MODS, WakeTrail } from '../../../src/action/hyde.ts';
import type { ActionEvent, HydePhase, Vec2 } from '../../../src/action/types.ts';
import { chaseCourse, drive, DT, FPS, idle, newRun, ofType, openCourse, rower, startChase } from './helpers.ts';
import { dropRockAhead, removeRock } from './scenarios.ts';

const K = STAGE_TUNING.hyde.stage1;

function chaseRun(rate = 3, extraS = 0, course = chaseCourse()): StageOneRun {
  const run = newRun('wednesday', 'alolan_marowak', course);
  startChase(run, rate);
  if (extraS > 0) drive(run, extraS, rower(rate));
  return run;
}

/** Distance from p to the polyline through pts. */
function distToPath(p: Vec2, pts: Vec2[]): number {
  let best = Infinity;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    const ex = b.x - a.x;
    const ez = b.z - a.z;
    const l2 = ex * ex + ez * ez;
    const u = l2 > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * ex + (p.z - a.z) * ez) / l2)) : 0;
    best = Math.min(best, Math.hypot(p.x - (a.x + ex * u), p.z - (a.z + ez * u)));
  }
  return best;
}

describe('Hyde wake following', () => {
  it('goes dormant → stalking (shadow) → emerging → chasing, with visibility rising to 1', () => {
    const course = chaseCourse();
    course.encounters = course.encounters!.map((e) => (e.kind === 'hyde_emerge' ? { ...e, z: -20, radius: 3 } : e));
    const run = newRun('wednesday', 'alolan_marowak', course);
    expect(run.hyde).toMatchObject({ phase: 'dormant', visibility: 0, threat: 0 });
    const phases: HydePhase[] = [];
    const vis: Partial<Record<HydePhase, number>> = {};
    let gapAtChase = NaN;
    const input = rower(3);
    for (let i = 0; i < 8 * FPS; i++) {
      for (const e of ofType(run.update(DT, input()), 'hyde_phase')) {
        phases.push(e.phase);
        if (e.phase === 'chasing') gapAtChase = run.hyde.distance;
      }
      vis[run.hyde.phase] = run.hyde.visibility;
    }
    expect(phases.slice(0, 3)).toEqual(['stalking', 'emerging', 'chasing']);
    expect(vis.stalking).toBe(HYDE.stalkVisibility); // an underwater shadow
    expect(vis.chasing).toBe(1);
    expect(gapAtChase).toBeCloseTo(K.startGapU, 0); // stalking/emerging hold the start gap
  });

  it('never appears ahead of the boat, even if the course spawn point is ahead of it', () => {
    const run = newRun('wednesday', 'alolan_marowak', chaseCourse({ hydeSpawn: { x: 0, z: -120, heading: 0 } }));
    const input = rower(3);
    for (let i = 0; i < 40 * FPS; i++) {
      run.update(DT, input());
      if (run.hyde.phase === 'dormant') continue;
      expect(run.hyde.distance).toBeGreaterThanOrEqual(0);
      expect(run.hyde.z).toBeGreaterThan(run.boat.z); // straight course heading −Z: behind = larger z
    }
  });

  it('follows the exact path the boat took (slalom): never cuts a corner', () => {
    const run = newRun('wednesday', 'alolan_marowak', chaseCourse());
    const path: Vec2[] = [{ x: 0, z: 0 }];
    const input = rower(3);
    let worst = 0;
    for (let i = 0; i < 45 * FPS; i++) {
      const steer = Math.floor(i / (2.5 * FPS)) % 2 === 0;
      run.update(DT, { ...input(), left: steer, right: !steer });
      path.push({ x: run.boat.x, z: run.boat.z });
      if (run.hyde.phase === 'dormant' || run.status !== 'playing') continue;
      // the seeded wake straight back from the start counts as path too
      const d = Math.min(distToPath(run.hyde, path), run.hyde.z >= 0 ? Math.abs(run.hyde.x) : Infinity);
      worst = Math.max(worst, d);
    }
    expect(Math.abs(run.boat.x)).toBeGreaterThan(5); // it really was a slalom
    expect(worst).toBeLessThan(0.15); // only the chord-vs-arc error between 0.75 u breadcrumbs
  });
});

describe('Hyde pursuit (D-32: a felt threat, a clean rower stays safe)', () => {
  it('a clean 3 taps/s rower holds him at an on-screen 15–22 u for a minute: never caught, never in lunge range', () => {
    const run = chaseRun(3);
    let minGap = Infinity;
    const steady: number[] = [];
    const input = rower(3);
    for (let i = 0; i < 60 * FPS; i++) {
      run.update(DT, input());
      minGap = Math.min(minGap, run.hydeAI.gap);
      if (i >= 30 * FPS) steady.push(run.hydeAI.gap);
    }
    const mean = steady.reduce((a, b) => a + b, 0) / steady.length;
    expect(run.catches).toBe(0);
    expect(run.status).toBe('playing');
    expect(mean).toBeGreaterThan(15);
    expect(mean).toBeLessThan(22);
    expect(minGap).toBeGreaterThan(HYDE.lungeRangeU);
  });

  it('loses ground when the player rows well: from 9 u behind he falls back past 15 u', () => {
    const run = chaseRun(3, 20);
    run.hydeAI.knockBack(9, 0, run.t, []);
    const ev = drive(run, 12, rower(3));
    expect(ofType(ev, 'hyde_catch')).toHaveLength(0);
    expect(run.hydeAI.gap).toBeGreaterThan(15);
  });

  it('better rowing earns a bigger gap than weak rowing', () => {
    const strong = chaseRun(3, 40);
    const weak = chaseRun(1.75, 40);
    expect(strong.status).toBe('playing');
    expect(weak.status).toBe('playing');
    expect(strong.hydeAI.gap).toBeGreaterThan(weak.hydeAI.gap + 6);
  });

  it('closes in when the player stops rowing', () => {
    const run = chaseRun(3, 15);
    const before = run.hydeAI.gap;
    drive(run, 5);
    expect(run.hydeAI.gap).toBeLessThan(before - 10);
  });

  it('a crash costs gap (vs an identical run that did not crash), but a single crash at a healthy gap is no catch', () => {
    const a = chaseRun(3, 20);
    const b = chaseRun(3, 20);
    const rig = dropRockAhead(b, 0);
    const ia = rower(3);
    const ib = rower(3);
    const ev: ActionEvent[] = [];
    for (let i = 0; i < 4 * FPS; i++) {
      a.update(DT, ia());
      const e = b.update(DT, ib());
      ev.push(...e);
      if (e.some((x) => x.type === 'collision' && x.obstacleId === rig)) removeRock(b, rig);
    }
    expect(ofType(ev, 'collision').filter((c) => c.obstacleId === rig)).toHaveLength(1);
    expect(b.hydeAI.gap).toBeLessThan(a.hydeAI.gap - 3);
    expect(ofType(ev, 'hyde_catch')).toHaveLength(0);
  });

  it('the floor speed catches a 1.5 taps/s rower (no help from surges or crashes)', () => {
    const run = chaseRun(1.5);
    const ev = drive(run, 60, rower(1.5));
    expect(ofType(ev, 'hyde_catch').length).toBeGreaterThanOrEqual(1);
  });

  it('outside surges his closing speed is capped (maxClosingRel)', () => {
    const run = chaseRun(0);
    for (let i = 0; i < 60 * FPS && run.status === 'playing'; i++) {
      run.update(DT, idle());
      if (!run.hydeAI.surgeBursting) expect(run.hyde.speed - run.boat.speed).toBeLessThanOrEqual(K.maxClosingRel + 1e-9);
    }
  });

  it('an idle player is caught (hyde_catch), on a course with no help from triggers (time fallbacks)', () => {
    const run = newRun('wednesday', 'alolan_marowak', openCourse());
    const ev = drive(run, 120);
    const kinds = ofType(ev, 'encounter').map((e) => e.kind);
    expect(kinds).toEqual(['calm', 'disturbance', 'hyde_emerge']);
    const catches = ofType(ev, 'hyde_catch');
    expect(catches.length).toBeGreaterThanOrEqual(1);
    expect(catches[0].catchNumber).toBe(1);
    expect(catches[0].t).toBeGreaterThan(HYDE.dormantMaxS);
    expect(catches[0].t).toBeLessThan(HYDE.dormantMaxS + HYDE.stalkMaxS + 20);
  });
});

describe('surges', () => {
  it('are telegraphed (≥ surgeTelegraphS warning) before the burst', () => {
    const run = chaseRun(3, 25);
    run.hydeAI.requestSurge(run.t);
    let phaseAt = NaN;
    let burstAt = NaN;
    let speedBefore = NaN;
    const input = rower(3);
    for (let i = 0; i < 6 * FPS && Number.isNaN(burstAt); i++) {
      const ev = run.update(DT, input());
      if (ofType(ev, 'hyde_phase').some((e) => e.phase === 'surging')) phaseAt = run.t;
      if (!Number.isNaN(phaseAt) && run.hydeAI.telegraphing) {
        expect(run.surgeTelegraphLeftS()).toBeGreaterThan(0);
        speedBefore = run.hyde.speed;
      }
      if (run.hydeAI.surgeBursting) burstAt = run.t;
    }
    expect(burstAt - phaseAt).toBeGreaterThanOrEqual(K.surgeTelegraphS - 0.02);
    drive(run, 0.5, rower(3));
    expect(run.hyde.speed).toBeGreaterThan(speedBefore + 1.5); // the burst itself
    expect(run.hyde.speed).toBeGreaterThan(run.boat.speed);
  });

  it('never start inside surgeMinStartGapU (deferred), and are skipped after surgeDeferMaxS', () => {
    // unit level: a stationary boat and a Hyde that may not grab, so he hovers just behind for the whole window
    const trail = new WakeTrail(0, 0, 0);
    const ai = new HydeAI(trail, { tuning: K });
    const ev: ActionEvent[] = [];
    ai.emerge(10, 0, ev);
    const mods = { ...NEUTRAL_HYDE_MODS, canCatch: false };
    let t = 0;
    const step = () => {
      trail.record(0, 0);
      ai.update(1 / 120, t, 0, mods, ev);
      t += 1 / 120;
    };
    while (ai.state.phase !== 'chasing') step();
    ai.requestSurge(t);
    let maxGap = 0;
    for (let i = 0; i < (K.surgeDeferMaxS + 1) * 120; i++) {
      step();
      maxGap = Math.max(maxGap, ai.gap);
    }
    expect(maxGap).toBeLessThan(K.surgeMinStartGapU);
    expect(ai.surgesStarted).toBe(0);
    expect(ai.surgesSkipped).toBe(1);
    expect(ev.some((e) => e.type === 'hyde_phase' && e.phase === 'surging')).toBe(false);
  });

  it('a deferred surge starts once the gap is fair again', () => {
    const run = chaseRun(3, 25);
    run.hydeAI.knockBack(12, 0, run.t, []);
    run.update(DT, idle());
    run.hydeAI.requestSurge(run.t);
    expect(run.hydeAI.surgesStarted).toBe(0);
    let startedGap = NaN;
    const input = rower(3);
    for (let i = 0; i < 20 * FPS && Number.isNaN(startedGap); i++) {
      run.update(DT, input());
      if (run.hydeAI.surgesStarted) startedGap = run.hydeAI.gap;
    }
    expect(startedGap).toBeGreaterThanOrEqual(K.surgeMinStartGapU - 0.1); // read one step after the check
  });
});

describe('lunge (a snap at the stern that can miss)', () => {
  it('a boat holding its pace survives a lunge from lunge range: it misses, and he drops back', () => {
    const run = chaseRun(3, 25);
    run.hydeAI.knockBack(HYDE.lungeRangeU - 0.2, 0, run.t, []);
    const phases: HydePhase[] = [];
    let minGap = Infinity;
    const input = rower(3);
    for (let i = 0; i < 6 * FPS; i++) {
      for (const e of ofType(run.update(DT, input()), 'hyde_phase')) phases.push(e.phase);
      minGap = Math.min(minGap, run.hydeAI.gap);
    }
    expect(phases).toContain('lunging');
    expect(run.hydeAI.lungesMissed).toBe(1);
    expect(run.catches).toBe(0);
    expect(run.status).toBe('playing');
    expect(minGap).toBeGreaterThan(K.catchRadiusU);
    expect(run.hydeAI.gap).toBeGreaterThan(HYDE.lungeRangeU);
  });

  it('a boat that stops rowing during the lunge is caught', () => {
    const run = chaseRun(3, 25);
    run.hydeAI.knockBack(HYDE.lungeRangeU - 0.2, 0, run.t, []);
    const ev = drive(run, 3);
    expect(ofType(ev, 'hyde_catch')).toHaveLength(1);
    expect(run.status).toBe('rescue');
  });
});

describe('surge hold', () => {
  it('a burst brings him to surgeHoldGapU and he holds there while the player keeps pace: no lunge, no catch', () => {
    const run = chaseRun(3, 30);
    run.hydeAI.requestSurge(run.t, K.surgeBoost, 8);
    const phases: HydePhase[] = [];
    let minGap = Infinity;
    let held = 0;
    const input = rower(3);
    for (let i = 0; i < 12 * FPS; i++) {
      for (const e of ofType(run.update(DT, input()), 'hyde_phase')) phases.push(e.phase);
      if (run.hydeAI.surgeBursting) {
        minGap = Math.min(minGap, run.hydeAI.gap);
        if (run.hydeAI.gap < HYDE.surgeHoldGapU + 0.5) held += DT;
      }
    }
    expect(held).toBeGreaterThan(1);
    expect(minGap).toBeGreaterThan(HYDE.surgeHoldGapU - 1);
    expect(minGap).toBeLessThan(HYDE.surgeHoldGapU + 0.5);
    expect(phases).not.toContain('lunging');
    expect(run.catches).toBe(0);
  });

  it('stopping while he holds on the stern gets you caught', () => {
    const run = chaseRun(3, 30);
    run.hydeAI.requestSurge(run.t, K.surgeBoost, 8);
    const input = rower(3);
    for (let i = 0; i < 12 * FPS && !(run.hydeAI.surgeBursting && run.hydeAI.gap < HYDE.surgeHoldGapU + 0.5); i++) run.update(DT, input());
    expect(run.hydeAI.surgeBursting).toBe(true);
    const ev = drive(run, 5);
    expect(ofType(ev, 'hyde_catch')).toHaveLength(1);
  });
});

describe('threat', () => {
  it('rises as the gap shrinks (low at the steady gap, near 1 at the catch) with two warnings', () => {
    const run = chaseRun(3, 15);
    expect(run.hyde.threat).toBeLessThan(0.45); // he is on screen at his steady gap: a presence, not an alarm
    const samples: { gap: number; threat: number }[] = [];
    const ev = driveUntilCatchSampling(run, samples);
    const at = (lo: number, hi: number) => samples.filter((s) => s.gap >= lo && s.gap < hi).map((s) => s.threat);
    const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    const far = mean(at(18, 24));
    const mid = mean(at(9, 14));
    const near = mean(at(3, 7));
    expect(mid).toBeGreaterThan(far + 0.15);
    expect(near).toBeGreaterThan(mid + 0.1);
    expect(near).toBeGreaterThan(0.8);
    for (const s of samples) {
      expect(s.threat).toBeGreaterThanOrEqual(0);
      expect(s.threat).toBeLessThanOrEqual(1);
    }
    expect(ofType(ev, 'hyde_warning').map((e) => e.level)).toEqual([1, 2]);
  });
});

function driveUntilCatchSampling(run: StageOneRun, samples: { gap: number; threat: number }[]) {
  const out = [];
  for (let i = 0; i < 60 * FPS && run.status === 'playing'; i++) {
    out.push(...run.update(DT, idle()));
    if (run.status === 'playing') samples.push({ gap: run.hydeAI.gap, threat: run.hyde.threat });
  }
  expect(run.status).toBe('rescue');
  return out;
}
