// Character selection matters: all 12 CHARACTER_ACTION_DEFS are registered, their 1–10 ratings change the boat's
// physics measurably, and every Stage 1 trait in CHARACTER_TRAIT_TUNING has its documented effect.
import { describe, expect, it } from 'vitest';
import { characterDefFor, NEUTRAL_STATS, statMultipliers, statsFor } from '../../../src/action/characterStats.ts';
import { ROWING } from '../../../src/action/config.ts';
import { CHARACTER_ACTION_DEFS, CHARACTER_TRAIT_TUNING } from '../../../src/action/data/characters.ts';
import { STAGE_TUNING } from '../../../src/action/data/stages.ts';
import { traitEffects, NEUTRAL_TRAITS } from '../../../src/action/traits.ts';
import type { StageOneRun } from '../../../src/action/run.ts';
import type { CourseDef, Obstacle } from '../../../src/action/types.ts';
import { CHARACTERS } from '../../../src/game/constants.ts';
import type { CharacterId } from '../../../src/game/types.ts';
import { chaseCourse, drive, idle, idleUntilCatch, newRun, ofType, openCourse, ram, rock, rower, startChase } from './helpers.ts';

const ALL_IDS = CHARACTER_ACTION_DEFS.map((d) => d.id);

/** Average speed over 22–27 s of rowing at `rate` taps/s on open water. */
function steadySpeed(id: CharacterId, rate = 3): number {
  const run = newRun(id, 'sableye', openCourse());
  const input = rower(rate);
  drive(run, 22, input);
  let sum = 0;
  let n = 0;
  drive(run, 5, () => {
    sum += run.boat.speed;
    n++;
    return input();
  });
  return sum / n;
}

/** Three rocks far apart so each impact is a fresh, damage-eligible hit. */
const ROCK_COURSE = (): CourseDef => openCourse({ obstacles: [rock('r1', 0, -20), rock('r2', 200, -20), rock('r3', 400, -20)] });

describe('character registration', () => {
  it('registers all 12 characters from CHARACTER_ACTION_DEFS (the full roster, nothing neutral-by-accident)', () => {
    expect(ALL_IDS).toHaveLength(12);
    expect(new Set(ALL_IDS)).toEqual(new Set(CHARACTERS.map((c) => c.id)));
    for (const def of CHARACTER_ACTION_DEFS) {
      expect(statsFor(def.id)).toEqual(def.stats);
      expect(characterDefFor(def.id)).toBe(def);
      expect(def.stats).not.toEqual(NEUTRAL_STATS);
      const sum = Object.values(def.stats).reduce((a, b) => a + b, 0);
      expect(sum).toBe(30);
    }
  });

  it('a run uses the selected character: its multipliers, max stamina and trait table', () => {
    for (const def of CHARACTER_ACTION_DEFS) {
      const run = newRun(def.id, 'sableye', openCourse());
      const m = statMultipliers(def.stats);
      expect(run.characterDef).toBe(def);
      expect(run.mods.power).toBeCloseTo(m.power, 9);
      expect(run.mods.topSpeed).toBeCloseTo(m.topSpeed, 9);
      expect(run.boat.maxStamina).toBeCloseTo(m.maxStamina, 9);
      expect(run.traits).toEqual(traitEffects(def.id));
    }
  });
});

describe('stats change how the boat plays', () => {
  it('at the same 3 taps/s, a fast character holds a clearly higher steady speed (spread ≥ 1 u/s)', () => {
    const speeds = Object.fromEntries(ALL_IDS.map((id) => [id, steadySpeed(id)])) as Record<CharacterId, number>;
    // Yoko (pow 7 / top 9) > Wednesday (5 / 5) > Xavier (4 / 5)
    expect(speeds.yoko).toBeGreaterThan(speeds.wednesday + 0.8);
    expect(speeds.wednesday).toBeGreaterThan(speeds.xavier);
    const values = Object.values(speeds);
    expect(Math.max(...values) - Math.min(...values)).toBeGreaterThanOrEqual(1);
    for (const v of values) expect(v).toBeGreaterThan(8); // everyone can row a fair pace at 3 taps/s
  });

  it('top speed matters when sprinting: at 6 taps/s high topSpeed beats equal power with lower topSpeed', () => {
    // Gomez (pow 8 / top 8) vs Enid (pow 8 / top 5): same stroke power, different speed cap. Peak over the first
    // 12 s (before Gomez's smaller stamina pool runs dry; Enid's big pool is her own edge on long sprints).
    const peak = (id: CharacterId) => {
      const run = newRun(id, 'sableye', openCourse());
      drive(run, 12, rower(6));
      return run.stats.maxSpeed;
    };
    expect(peak('gomez')).toBeGreaterThan(peak('enid') + 0.6);
  });

  it('high defense takes less collision damage from the same head-on rock', () => {
    const tough = newRun('ajax', 'sableye', ROCK_COURSE()); // defense 8
    const fragile = newRun('enid', 'sableye', ROCK_COURSE()); // defense 4
    const a = ofType(ram(tough, 0).events, 'collision')[0];
    const b = ofType(ram(fragile, 0).events, 'collision')[0];
    expect(a.damage).toBeGreaterThan(0);
    expect(a.damage).toBeLessThan(b.damage);
    expect(tough.boat.hp).toBeGreaterThan(fragile.boat.hp);
  });

  it('high handling turns faster at the same speed', () => {
    const turn = (id: CharacterId) => {
      const run = newRun(id, 'sableye', openCourse());
      run.boat.speed = 6;
      drive(run, 0.5, () => idle({ left: true }));
      return run.boat.heading;
    };
    const quick = turn('wednesday'); // handling 9
    const clumsy = turn('enid'); // handling 4
    expect(quick).toBeGreaterThan(0);
    expect(quick / clumsy).toBeGreaterThan(1.2);
  });

  it('stamina rating sets the stamina pool', () => {
    expect(newRun('enid', 'sableye', openCourse()).boat.maxStamina).toBeGreaterThan(newRun('yoko', 'sableye', openCourse()).boat.maxStamina + 30);
  });
});

describe('real-time traits (CHARACTER_TRAIT_TUNING)', () => {
  it('every Stage 1 tuning key maps to an effect; only on-foot keys are inactive', () => {
    for (const id of ALL_IDS) {
      const e = traitEffects(id);
      const keys = Object.keys(CHARACTER_TRAIT_TUNING[id]);
      expect(keys.length).toBeGreaterThan(0);
      for (const k of e.inactiveKeys) expect(['walkSpeedMult', 'landingPointerS', 'seekCooldownMult']).toContain(k);
    }
    // Eugene's Hive Swarm is entirely an island (Stage 2) trait
    const eugene = traitEffects('eugene');
    expect(eugene.inactiveKeys.sort()).toEqual(['landingPointerS', 'seekCooldownMult']);
    expect({ ...eugene, inactiveKeys: [] }).toEqual(NEUTRAL_TRAITS);
  });

  it('Wednesday — Dark Vision: fog ×0.35 at the boat and surges telegraphed 1 s earlier', () => {
    const fog = () => openCourse({ fog: [{ x: 0, z: 0, radius: 50, density: 0.8 }] });
    const wed = newRun('wednesday', 'sableye', fog());
    const other = newRun('kent', 'sableye', fog());
    expect(other.fogAt()).toBeCloseTo(0.8, 6);
    expect(wed.fogAt()).toBeCloseTo(0.8 * 0.35, 6);
    expect(wed.hydeAI.telegraphS).toBeCloseTo(STAGE_TUNING.hyde.stage1.surgeTelegraphS + 1, 9);
    expect(other.hydeAI.telegraphS).toBeCloseTo(STAGE_TUNING.hyde.stage1.surgeTelegraphS, 9);
  });

  it('Enid — High Energy: strokes below 3 u/s hit 60 % harder; regen delay 0.15 s', () => {
    const run = newRun('enid', 'sableye', openCourse());
    const m = statMultipliers(statsFor('enid'));
    const slow = ofType(run.update(0, idle({ strokes: 1 })), 'stroke')[0];
    expect(slow.power).toBeCloseTo(ROWING.baseImpulse * m.power * 1.6, 6);
    const fast = newRun('enid', 'sableye', openCourse());
    fast.boat.speed = 5;
    const vmax = ROWING.maxSpeed * m.topSpeed;
    const p = ofType(fast.update(0, idle({ strokes: 1 })), 'stroke')[0];
    expect(p.power).toBeCloseTo(ROWING.baseImpulse * m.power * (1 - (5 / vmax) ** 2), 6);
    expect(run.cfg.regenDelayS).toBe(0.15);
    expect(newRun('kent', 'sableye', openCourse()).cfg.regenDelayS).toBe(ROWING.regenDelayS);
  });

  it('Bianca — Siren Navigation: currents push 60 % less; rowing with a current (≤ 45°) +15 %', () => {
    const current = (heading = 0) => openCourse({ start: { x: 0, z: 0, heading }, currents: [{ x: 0, z: 0, radius: 200, pushX: 2, pushZ: 0 }] });
    const bianca = newRun('bianca', 'sableye', current());
    const other = newRun('wednesday', 'sableye', current());
    drive(bianca, 2);
    drive(other, 2);
    expect(other.boat.x).toBeGreaterThan(3);
    expect(bianca.boat.x / other.boat.x).toBeGreaterThan(0.35);
    expect(bianca.boat.x / other.boat.x).toBeLessThan(0.45);
    // with the current (heading −π/2 faces +X, the push direction) vs across it (heading 0); both pow 5, at rest
    const withB = ofType(newRun('bianca', 'sableye', current(-Math.PI / 2)).update(0, idle({ strokes: 1 })), 'stroke')[0].power;
    const withW = ofType(newRun('wednesday', 'sableye', current(-Math.PI / 2)).update(0, idle({ strokes: 1 })), 'stroke')[0].power;
    const acrossB = ofType(newRun('bianca', 'sableye', current(0)).update(0, idle({ strokes: 1 })), 'stroke')[0].power;
    expect(withB / withW).toBeCloseTo(1.15, 6);
    expect(acrossB / withW).toBeCloseTo(1, 6);
  });

  it('Xavier — Painted Decoy: the first 2 damaging collisions cost no HP and no speed; the 3rd does', () => {
    const run = newRun('xavier', 'sableye', ROCK_COURSE());
    const hits = [0, 200, 400].map((x) => ram(run, x));
    for (const h of hits.slice(0, 2)) {
      const c = ofType(h.events, 'collision');
      expect(c.length).toBeGreaterThan(0);
      expect(c[0].damage).toBe(0);
      expect(h.speedAfterImpact / h.impactSpeed).toBeGreaterThan(0.97);
    }
    expect(ofType(hits[2].events, 'collision')[0].damage).toBeGreaterThan(0);
    expect(hits[2].speedAfterImpact / hits[2].impactSpeed).toBeLessThan(0.5);
    expect(run.boat.hp).toBeLessThan(100);
    expect(run.boat.hp).toBeGreaterThan(85);
  });

  it('Ajax — Stone Shield: a head-on crash keeps ≥ 60 % of speed (others keep ~35 %)', () => {
    const ajax = ram(newRun('ajax', 'sableye', ROCK_COURSE()), 0);
    const other = ram(newRun('kent', 'sableye', ROCK_COURSE()), 0);
    // 0.6 floor, then one sustained-contact drag step within the same frame
    expect(ajax.speedAfterImpact / ajax.impactSpeed).toBeGreaterThanOrEqual(0.57);
    expect(other.speedAfterImpact / other.impactSpeed).toBeLessThan(0.4);
  });

  it('Yoko — Night Sprint: strokes above 75 % of top speed cost 25 % less stamina', () => {
    const cost = (speed: number) => {
      const run = newRun('yoko', 'sableye', openCourse());
      run.boat.speed = speed;
      const before = run.boat.stamina;
      run.update(0, idle({ strokes: 1 }));
      return before - run.boat.stamina;
    };
    const vmax = ROWING.maxSpeed * statMultipliers(statsFor('yoko')).topSpeed;
    expect(cost(0)).toBeCloseTo(ROWING.strokeStaminaCost, 6);
    expect(cost(0.8 * vmax)).toBeCloseTo(ROWING.strokeStaminaCost * 0.75, 6);
  });

  it('Kent — Hydro Wave: the Hyde starts 12 u farther back and is knocked 10 u further after a catch', () => {
    const kent = newRun('kent', 'sableye', chaseCourse());
    const other = newRun('wednesday', 'sableye', chaseCourse());
    startChase(kent);
    startChase(other);
    const start = STAGE_TUNING.hyde.stage1.startGapU;
    expect(other.hyde.distance).toBeCloseTo(start, 0);
    expect(kent.hyde.distance).toBeCloseTo(start + 12, 0);
    const knock = (run: StageOneRun) => {
      idleUntilCatch(run);
      drive(run, 3); // no Q, no struggle: full catch
      return run.lastRescue!.knockbackU;
    };
    const base = STAGE_TUNING.hyde.stage1.postCatchGapU;
    expect(knock(other)).toBeCloseTo(base, 6);
    expect(knock(kent)).toBeCloseTo(base + 10, 6);
  });

  it('Divina — Siren Drift: coasting loses 40 % less speed', () => {
    const coast = (id: CharacterId) => {
      const run = newRun(id, 'sableye', openCourse());
      run.boat.speed = 8;
      drive(run, 3);
      return run.boat.speed;
    };
    const divina = coast('divina');
    const other = coast('wednesday');
    expect(divina).toBeGreaterThan(other + 1);
    expect(8 - divina).toBeLessThan((8 - other) * 0.7);
  });

  it('Rowan — Telekinetic Push: a log ahead is shoved aside (no collision); a rock is not', () => {
    const log: Obstacle = { id: 'log1', kind: 'log', x: 0, z: -15, radius: 0.6, halfLength: 2, angle: Math.PI / 2, damage: 10 };
    const course = () => openCourse({ obstacles: [structuredClone(log)] });
    const rowan = newRun('rowan', 'sableye', course());
    const other = newRun('wednesday', 'sableye', course());
    const evR = drive(rowan, 5, rower(3));
    const evO = drive(other, 5, rower(3));
    expect(rowan.displacedObstacles.has('log1')).toBe(true);
    expect(ofType(evR, 'collision').filter((c) => c.obstacleId === 'log1')).toHaveLength(0);
    expect(ofType(evO, 'collision').filter((c) => c.obstacleId === 'log1').length).toBeGreaterThan(0);
    const rocky = newRun('rowan', 'sableye', openCourse({ obstacles: [rock('rk', 0, -15)] }));
    const evK = drive(rocky, 5, rower(3));
    expect(rocky.displacedObstacles.size).toBe(0);
    expect(ofType(evK, 'collision').length).toBeGreaterThan(0);
  });

  it('Morticia — Graceful Escape: rescue window +0.8 s, clean-escape window +0.3 s', () => {
    const r = STAGE_TUNING.rescue;
    const mort = newRun('morticia', 'sableye', chaseCourse());
    expect(mort.cleanEscapeWindowS).toBeCloseTo(r.cleanEscapeWindowS + 0.3, 9);
    startChase(mort);
    idleUntilCatch(mort);
    expect(mort.rescue.windowS).toBeCloseTo(r.windowS + 0.8, 9);
    const other = newRun('kent', 'sableye', chaseCourse());
    startChase(other);
    idleUntilCatch(other);
    expect(other.rescue.windowS).toBeCloseTo(r.windowS, 9);
  });

  it('Gomez — Fearless Dash: with the hunting Hyde within 18 u, strokes hit 25 % harder', () => {
    const stroke = (closeHyde: boolean) => {
      const run = newRun('gomez', 'sableye', chaseCourse());
      startChase(run);
      run.boat.speed = 0;
      if (closeHyde) run.hydeAI.knockBack(12, 0, run.t, []);
      return ofType(run.update(0, idle({ strokes: 1 })), 'stroke')[0].power;
    };
    expect(stroke(true) / stroke(false)).toBeCloseTo(1.25, 6);
  });
});
