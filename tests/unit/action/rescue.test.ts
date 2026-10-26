// The rescue window ("THE HYDE HAS CAUGHT YOU! PRESS Q"): slowed sim, no pausing, Q applies the Pokémon's rescue
// data, clean-escape rule, counted catches, DNF on the second counted catch, and HP never ending the run.
import { describe, expect, it } from 'vitest';
import { POKEMON_ABILITY_DEFS } from '../../../src/action/data/pokemon.ts';
import { STAGE_TUNING } from '../../../src/action/data/stages.ts';
import { resolveRescue } from '../../../src/action/rescue.ts';
import type { StageOneRun } from '../../../src/action/run.ts';
import type { PokemonId } from '../../../src/game/types.ts';
import { chaseCourse, drive, DT, FPS, idle, idleUntilCatch, newRun, ofType, openCourse, ram, rock, rower, startChase } from './helpers.ts';

const K = STAGE_TUNING.hyde.stage1;
const R = STAGE_TUNING.rescue;
const CHAR = 'wednesday' as const; // no rescue-related trait

function caught(pokemonId: PokemonId = 'alolan_marowak', course = chaseCourse()): StageOneRun {
  const run = newRun(CHAR, pokemonId, course);
  startChase(run);
  idleUntilCatch(run);
  return run;
}

/** Real seconds of idle frames inside the window, then one frame with Q. */
function qAfter(run: StageOneRun, realS: number) {
  const ev = drive(run, realS);
  ev.push(...run.update(DT, idle({ ability: true })));
  return ev;
}

describe('the catch opens the rescue window', () => {
  it('status rescue, hyde_catch + rescue_start events, no pausing, sim slowed to timeScale', () => {
    const run = newRun(CHAR, 'alolan_marowak', chaseCourse());
    startChase(run);
    expect(run.canPause()).toBe(true);
    const ev = idleUntilCatch(run);
    const grab = ofType(ev, 'hyde_catch');
    expect(grab).toEqual([{ type: 'hyde_catch', catchNumber: 1, t: expect.any(Number) }]);
    expect(run.t - grab[0].t).toBeLessThanOrEqual(1 / 120 + 1e-9); // stamped at the start of the catching step
    expect(ofType(ev, 'rescue_start')[0].abilityAvailable).toBe(true);
    expect(run.status).toBe('rescue');
    expect(run.canPause()).toBe(false);
    expect(run.rescue).toMatchObject({ active: true, windowS: R.windowS, abilityAvailable: true, outcome: 'pending' });
    const t0 = run.t;
    drive(run, 1);
    expect(run.status).toBe('rescue');
    expect(run.t - t0).toBeCloseTo(1 * R.timeScale, 1);
    expect(run.rescueLeftS()).toBeCloseTo(R.windowS - 1, 1);
    expect(run.hydeAI.gap).toBeLessThanOrEqual(K.catchRadiusU); // he holds the stern
  });

  it('no Q: a full, counted catch (25 hull) after the window; the Hyde is knocked back and stunned', () => {
    const run = caught();
    const ev = drive(run, R.windowS + 0.1);
    expect(ofType(ev, 'rescue_end')).toEqual([{ type: 'rescue_end', outcome: 'caught', damage: K.catchHullDamage, t: expect.any(Number) }]);
    expect(run.status).toBe('playing');
    expect(run.catches).toBe(1);
    expect(run.boat.hp).toBe(100 - K.catchHullDamage);
    expect(run.hyde.phase).toBe('stunned');
    expect(run.hydeAI.gap).toBeGreaterThan(K.postCatchGapU - 1);
    expect(run.canPause()).toBe(true);
  });

  it('SPACE mashing in the window cuts the catch damage (−6 % per press, max −48 %)', () => {
    const run = caught();
    let presses = 0;
    drive(run, R.windowS + 0.1, (i) => {
      const s = i % 6 === 0 && presses < 4 ? 1 : 0;
      presses += s;
      return idle({ strokes: s });
    });
    expect(run.lastRescue!.damage).toBe(Math.round(K.catchHullDamage * (1 - 4 * R.struggleReductionPerPress)));
    const mash = caught();
    drive(mash, R.windowS + 0.1, () => idle({ strokes: 2 }));
    expect(mash.lastRescue!.damage).toBe(Math.round(K.catchHullDamage * (1 - R.struggleMaxReduction)));
  });

  it('Q with the ability not rescue-ready is denied (cooldown) and the catch counts in full', () => {
    const run = newRun(CHAR, 'alolan_marowak', chaseCourse());
    startChase(run);
    for (let i = 0; i < 60 * FPS && run.hydeAI.gap > 8; i++) run.update(DT, idle());
    run.update(0, idle({ ability: true })); // spent just before the grab
    idleUntilCatch(run);
    expect(run.rescue.abilityAvailable).toBe(false);
    const ev = qAfter(run, 0.1);
    expect(ofType(ev, 'ability_denied')[0]?.reason).toBe('cooldown');
    drive(run, R.windowS);
    expect(run.lastRescue).toMatchObject({ outcome: 'caught', counted: true, damage: K.catchHullDamage });
    expect(run.catches).toBe(1);
  });

  it('the ability counts as rescue-ready once 75 % of its cooldown has elapsed', () => {
    const def = POKEMON_ABILITY_DEFS.find((d) => d.id === 'alolan_marowak')!;
    const run = newRun(CHAR, 'alolan_marowak', openCourse());
    run.update(0, idle({ ability: true }));
    drive(run, def.cooldownS * R.readyAtCooldownFraction - 0.1);
    expect(run.abilities.rescueReady(run.t)).toBe(false);
    drive(run, 0.2);
    expect(run.abilities.rescueReady(run.t)).toBe(true);
    expect(run.abilityStatus().ready).toBe(false); // but not ready for a normal Q yet
  });
});

describe.each(POKEMON_ABILITY_DEFS.map((d) => [d.id, d] as const))('rescue with %s', (id, def) => {
  it(`late Q (rescued, counted) applies its rescue data: negateDamage=${def.rescue.negateDamage}, protectEgg=${def.rescue.protectEgg}, push ${def.rescue.pushHydeBackM} u`, () => {
    const run = caught(id);
    const ev = qAfter(run, R.cleanEscapeWindowS + 0.3);
    const end = ofType(ev, 'rescue_end');
    expect(end).toHaveLength(1);
    expect(end[0].outcome).toBe('rescued');
    expect(end[0].damage).toBe(def.rescue.negateDamage ? 0 : K.catchHullDamage);
    expect(run.catches).toBe(1);
    expect(run.status).toBe('playing');
    expect(run.boat.hp).toBe(100 - end[0].damage);
    expect(run.lastRescue).toMatchObject({
      outcome: 'rescued', counted: true, negateDamage: def.rescue.negateDamage, protectEgg: def.rescue.protectEgg,
      text: def.rescue.text, knockbackU: K.postCatchGapU + def.rescue.pushHydeBackM,
    });
    expect(run.hydeAI.gap).toBeCloseTo(K.postCatchGapU + def.rescue.pushHydeBackM, 0);
    // the rescue consumed a use like a Q press
    expect(run.abilityStatus().cooldownLeftS).toBeCloseTo(def.cooldownS, 6);
    expect(run.abilityStatus().chargesLeft).toBe(def.charges === null ? null : def.charges - 1);
    expect(run.stats).toMatchObject({ rescues: 1, abilitiesUsed: 1, cleanEscapes: 0 });
  });
});

describe('clean escape', () => {
  it('Q within the clean-escape window: the catch is NOT counted; the rescue effect still applies', () => {
    const def = POKEMON_ABILITY_DEFS.find((d) => d.id === 'dragapult')!;
    const run = caught('dragapult');
    const ev = qAfter(run, 0.2);
    expect(ofType(ev, 'rescue_end')[0].outcome).toBe('clean_escape');
    expect(run.catches).toBe(0);
    expect(run.stats.cleanEscapes).toBe(1);
    expect(run.lastRescue!.knockbackU).toBe(K.postCatchGapU + def.rescue.pushHydeBackM);
    expect(run.lastChance).toBe(false);
  });

  it('only one clean escape per run: the next early Q is a counted rescue', () => {
    const run = caught('dragapult'); // 8 s cooldown, so it is rescue-ready again by the next catch
    qAfter(run, 0.1);
    expect(run.catches).toBe(0);
    idleUntilCatch(run);
    expect(run.rescue.abilityAvailable).toBe(true);
    const ev = qAfter(run, 0.1);
    expect(ofType(ev, 'rescue_end')[0].outcome).toBe('rescued');
    expect(run.catches).toBe(1);
  });

  it('a pressed-too-late Q (after the clean window) is a counted rescue', () => {
    const run = caught('dragapult');
    qAfter(run, R.cleanEscapeWindowS + 0.1);
    expect(run.lastRescue!.outcome).toBe('rescued');
    expect(run.catches).toBe(1);
  });
});

describe('second counted catch', () => {
  it('ends the run as DNF (dnf event, no extra damage), and the run then freezes', () => {
    const run = caught();
    drive(run, R.windowS + 0.1);
    expect(run.catches).toBe(1);
    expect(run.lastChance).toBe(true);
    const hp = run.boat.hp;
    idleUntilCatch(run);
    expect(run.rescue.windowS).toBeCloseTo(R.windowS + STAGE_TUNING.mercy.rescueWindowBonusS, 9); // last-chance mercy
    const ev = drive(run, R.windowS + STAGE_TUNING.mercy.rescueWindowBonusS + 0.1);
    expect(ofType(ev, 'hyde_catch')).toHaveLength(0);
    expect(ofType(ev, 'rescue_end')[0]).toMatchObject({ outcome: 'caught', damage: 0 });
    expect(ofType(ev, 'dnf')).toEqual([{ type: 'dnf', reason: 'second_catch', t: run.t }]);
    expect(run.status).toBe('dnf');
    expect(run.catches).toBe(2);
    expect(run.boat.hp).toBe(hp);
    const t = run.t;
    expect(run.update(DT, idle({ strokes: 1, ability: true }))).toEqual([]);
    expect(run.t).toBe(t);
  });

  it('a counted rescue as the second catch is also a DNF (defensive negation still counts)', () => {
    const run = caught('dragapult');
    drive(run, R.windowS + 0.1); // first: no Q
    idleUntilCatch(run);
    expect(run.rescue.abilityAvailable).toBe(true);
    const ev = qAfter(run, R.cleanEscapeWindowS + 0.2); // late Q
    expect(ofType(ev, 'rescue_end')[0].outcome).toBe('rescued');
    expect(run.status).toBe('dnf');
  });

  it('a clean escape as the second grab is not counted: the run continues', () => {
    const run = caught('dragapult');
    drive(run, R.windowS + 0.1);
    idleUntilCatch(run);
    qAfter(run, 0.1);
    expect(run.status).toBe('playing');
    expect(run.catches).toBe(1);
  });

  it('last-chance mercy: after the first counted catch his closing speed is capped lower', () => {
    const run = caught();
    drive(run, R.windowS + 0.1);
    for (let i = 0; i < 40 * FPS && run.status === 'playing'; i++) {
      run.update(DT, idle());
      if (!run.hydeAI.surgeBursting) expect(run.hyde.speed - run.boat.speed).toBeLessThanOrEqual(STAGE_TUNING.mercy.maxClosingRel + 1e-9);
    }
  });

  it('no second grab within postCatchInvulnS after a catch, even standing still', () => {
    const run = caught();
    drive(run, R.windowS + 0.1);
    const t0 = run.t;
    const ev = drive(run, K.postCatchInvulnS);
    expect(run.t - t0).toBeGreaterThan(K.postCatchInvulnS - 0.1);
    expect(ofType(ev, 'hyde_catch')).toHaveLength(0);
  });
});

describe('HP never ends the run (swamped rule)', () => {
  it('a catch that takes HP to 0 swamps the boat: stalled 2.5 s (oars down), then back at 35 HP', () => {
    const run = newRun(CHAR, 'alolan_marowak', chaseCourse());
    startChase(run);
    run.boat.hp = 10;
    idleUntilCatch(run);
    drive(run, R.windowS + 0.1);
    expect(run.boat.hp).toBe(0);
    expect(run.status).toBe('playing');
    expect(run.swampedLeftS()).toBeGreaterThan(STAGE_TUNING.hull.swampedStallS - 0.2);
    const ev = drive(run, 1, rower(4));
    expect(ofType(ev, 'stroke')).toHaveLength(0); // bailing water
    drive(run, STAGE_TUNING.hull.swampedStallS);
    expect(run.swampedLeftS()).toBe(0);
    expect(run.boat.hp).toBe(STAGE_TUNING.hull.swampedRestoreHp);
    expect(ofType(drive(run, 1, rower(3)), 'stroke').length).toBeGreaterThan(0);
    expect(run.status).toBe('playing');
  });

  it('crashing to 0 HP is never a DNF either', () => {
    const run = newRun(CHAR, 'alolan_marowak', openCourse({ obstacles: [rock('r1', 0, -20, 2, 40)] }));
    run.boat.hp = 5;
    ram(run, 0);
    expect(run.boat.hp).toBe(0);
    expect(run.status).toBe('playing');
    expect(run.swampedLeftS()).toBeGreaterThan(0);
    drive(run, STAGE_TUNING.hull.swampedStallS + 0.1);
    expect(run.boat.hp).toBe(STAGE_TUNING.hull.swampedRestoreHp);
    expect(run.status).toBe('playing');
  });
});

describe('resolveRescue (outcome table)', () => {
  const base = { qAtRealS: 0, cleanEscapeWindowS: 0.5, cleanEscapesLeft: 1, strugglePresses: 0, baseDamage: 25, hullMult: 1, baseKnockbackU: 32 };
  const data = { negateDamage: true, protectEgg: true, pushHydeBackM: 10, text: '' };
  it('clean escape / rescued / caught', () => {
    expect(resolveRescue({ ...base, qUsed: true, rescue: data })).toEqual({ outcome: 'clean_escape', counted: false, damage: 0, knockbackU: 42 });
    expect(resolveRescue({ ...base, qUsed: true, qAtRealS: 0.6, rescue: data })).toEqual({ outcome: 'rescued', counted: true, damage: 0, knockbackU: 42 });
    expect(resolveRescue({ ...base, qUsed: true, cleanEscapesLeft: 0, rescue: data })).toMatchObject({ outcome: 'rescued', counted: true });
    expect(resolveRescue({ ...base, qUsed: false, rescue: data })).toEqual({ outcome: 'caught', counted: true, damage: 25, knockbackU: 32 });
    expect(resolveRescue({ ...base, qUsed: true, qAtRealS: 1, rescue: { ...data, negateDamage: false }, strugglePresses: 20 })).toEqual({
      outcome: 'rescued', counted: true, damage: Math.round(25 * 0.52), knockbackU: 32 + 10 + 4,
    });
  });
});
