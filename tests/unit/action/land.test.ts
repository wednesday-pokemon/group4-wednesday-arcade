// Land (shores, islets, reefs): the boat cannot tunnel through land even at boosted top speed, slides along shores
// without damage, keeps moving when pushing into land at an angle, and reefs only scrape on fast head-on hits.
import { describe, expect, it } from 'vitest';
import { hullCircles } from '../../../src/action/collision.ts';
import { LAND } from '../../../src/action/config.ts';
import { circleHitsLand, circleVsPolygon, pointInPolygon } from '../../../src/action/land.ts';
import type { StageOneRun } from '../../../src/action/run.ts';
import type { CourseDef, LandMass } from '../../../src/action/types.ts';
import { chaseCourse, drive, DT, FPS, idle, newRun, ofType, openCourse, rower, startChase } from './helpers.ts';

/** A straight band of land across the course between z = zNear and z = zNear − thickness. */
function band(kind: LandMass['kind'], zNear: number, thickness: number, id = 'band'): LandMass {
  const zf = zNear - thickness;
  return { id, kind, height: 2, points: [{ x: -300, z: zNear }, { x: -300, z: zf }, { x: 300, z: zf }, { x: 300, z: zNear }] };
}

const withLand = (land: LandMass[], over: Partial<CourseDef> = {}) => openCourse({ land, ...over });

function maxPenetration(run: StageOneRun): number {
  let worst = 0;
  for (const h of hullCircles(run.boat)) for (const l of run.course.land ?? []) worst = Math.max(worst, circleVsPolygon(h.x, h.z, h.r, l)?.depth ?? 0);
  return worst;
}

describe('no tunnelling', () => {
  for (const thickness of [0.2, 1, 20]) {
    it(`a ${thickness} u thick shore stops the boat at boosted max speed, head-on and at an angle, at any frame rate`, () => {
      for (const [heading, fps] of [[0, 60], [-0.3, 30], [0.2, 144], [0, 10]] as const) {
        const run = newRun('yoko', 'dragapult', withLand([band('shore', -30, thickness)], { start: { x: 0, z: 0, heading } }));
        run.update(0, idle({ ability: true })); // +5 u/s dart
        run.boat.speed = 18;
        const input = rower(6);
        let worst = 0;
        for (let i = 0; i < 6 * fps; i++) {
          run.update(1 / fps, input());
          worst = Math.max(worst, maxPenetration(run));
          expect(pointInPolygon(run.boat.x, run.boat.z, run.course.land![0].points)).toBe(false);
          expect(run.boat.z).toBeGreaterThan(-30);
        }
        expect(worst).toBeLessThan(0.25); // at most one step of overlap before the push-out
      }
    });
  }
});

describe('shores', () => {
  it('rowing at 45° into a shore slides along it: no damage, still moving, never inside', () => {
    const run = newRun('wednesday', 'alolan_marowak', withLand([band('shore', -30, 40)], { start: { x: 0, z: 0, heading: -Math.PI / 4 } }));
    const input = rower(3);
    let contactX = NaN;
    const ev = [];
    for (let i = 0; i < 15 * FPS; i++) {
      ev.push(...run.update(DT, input()));
      if (Number.isNaN(contactX) && run.boat.z < -27.5) contactX = run.boat.x;
    }
    expect(Number.isNaN(contactX)).toBe(false);
    expect(run.boat.hp).toBe(100);
    expect(ofType(ev, 'collision').every((c) => c.damage === 0)).toBe(true);
    expect(run.boat.x - contactX).toBeGreaterThan(50); // glided along the shore (slide assist), not ground to a crawl
    expect(run.boat.speed).toBeGreaterThan(7);
    expect(run.boat.z).toBeGreaterThan(-30);
  });

  it('a head-on shore hit at speed bumps (0-damage event, speed cut) but never damages', () => {
    const run = newRun('enid', 'alolan_marowak', withLand([band('shore', -10, 40)]));
    run.boat.speed = 12;
    const ev = drive(run, 1);
    const bumps = ofType(ev, 'collision');
    expect(bumps.length).toBeGreaterThan(0);
    expect(bumps.every((b) => b.kind === 'land' && b.damage === 0)).toBe(true);
    expect(run.boat.hp).toBe(100);
    expect(run.boat.speed).toBeLessThan(6);
  });

  it('pushing nearly straight into land (20°) while rowing turns the bow along it and keeps real speed', () => {
    const run = newRun('wednesday', 'alolan_marowak', withLand([band('shore', -15, 40)], { start: { x: 0, z: 0, heading: -0.35 } }));
    const input = rower(3);
    drive(run, 4, input);
    const x0 = run.boat.x;
    drive(run, 6, input);
    expect(run.boat.x - x0).toBeGreaterThan(25); // was ≈ 2.8 u (stuck-feeling) before the slide assist
    expect(run.boat.speed).toBeGreaterThan(7);
    expect(run.boat.hp).toBe(100);
  });

  it('a boat pinned against the shore can turn away and leave at speed', () => {
    const run = newRun('wednesday', 'alolan_marowak', withLand([band('shore', -15, 40)]));
    drive(run, 6, rower(3));
    expect(run.boat.z).toBeGreaterThan(-15);
    drive(run, 2, () => idle({ left: true, strokes: 0 }));
    drive(run, 4, rower(3));
    expect(run.boat.speed).toBeGreaterThan(5);
    expect(maxPenetration(run)).toBe(0);
  });
});

describe('reefs', () => {
  const reefRun = (speed: number, heading = 0, id: 'wednesday' | 'kent' = 'wednesday') => {
    const run = newRun(id, 'alolan_marowak', withLand([band('reef', -10, 6, 'reef1')], { start: { x: 0, z: 0, heading } }));
    run.boat.speed = speed;
    return { run, ev: drive(run, 1.5) };
  };

  it('a fast head-on reef hit scrapes the hull lightly', () => {
    const { run, ev } = reefRun(10);
    const hits = ofType(ev, 'collision').filter((c) => c.damage > 0);
    expect(hits).toHaveLength(1);
    expect(hits[0].damage).toBeLessThanOrEqual(Math.ceil(LAND.reefDamage * 1.2));
    expect(run.boat.hp).toBe(100 - hits[0].damage);
  });

  it('a slow head-on reef bump is harmless', () => {
    const { run } = reefRun(LAND.reefMinSpeed - 1.5);
    expect(run.boat.hp).toBe(100);
  });

  it('a fast glancing reef hit is only a scrape (no damage)', () => {
    const { run } = reefRun(14, -Math.PI / 3); // 60° off the normal: head-on factor 0.5 < reefMinHeadOn
    expect(run.boat.hp).toBe(100);
  });

  it('staying in contact with a reef never repeats the damage', () => {
    const run = newRun('wednesday', 'alolan_marowak', withLand([band('reef', -10, 6, 'reef1')]));
    run.boat.speed = 10;
    const ev = drive(run, 6, rower(4));
    expect(ofType(ev, 'collision').filter((c) => c.damage > 0)).toHaveLength(1);
  });
});

describe('the Hyde and land', () => {
  it('following the wake around an islet, the Hyde never stands on land', () => {
    const islet: LandMass = { id: 'islet', kind: 'islet', height: 3, points: [{ x: -6, z: -40 }, { x: -6, z: -60 }, { x: 6, z: -60 }, { x: 6, z: -40 }] };
    const course = chaseCourse({ land: [islet] });
    const run = newRun('wednesday', 'alolan_marowak', course);
    startChase(run, 3);
    const input = rower(3);
    for (let i = 0; i < 40 * FPS; i++) {
      const b = run.boat;
      // steer around the islet's east side, then back to x = 0
      const targetX = b.z < -25 && b.z > -75 ? 14 : 0;
      const desired = Math.atan2(-(targetX - b.x), 12);
      const diff = desired - b.heading;
      run.update(DT, { ...input(), left: diff > 0.05, right: diff < -0.05 });
      expect(circleHitsLand(run.hyde.x, run.hyde.z, 0.5, course.land!)).toBe(false);
      expect(maxPenetration(run)).toBeLessThan(0.25);
    }
    expect(run.boat.z).toBeLessThan(-100);
    expect(run.hyde.z).toBeLessThan(-60); // he followed around it
  });
});
