// Pokémon abilities are data-driven: for every one of the 18 POKEMON_ABILITY_DEFS, Q activates when ready, produces
// the effect its `specialty` implies (scaled by its own magnitude / duration), respects cooldownS and charges, and
// denies with the right reason. Passives with a Stage 1 meaning are checked too. A source scan proves there are no
// Pokémon-id branches in the action code.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ROWING } from '../../../src/action/config.ts';
import { CHARACTER_ACTION_DEFS } from '../../../src/action/data/characters.ts';
import { POKEMON_ABILITY_DEFS } from '../../../src/action/data/pokemon.ts';
import { STAGE_TUNING } from '../../../src/action/data/stages.ts';
import type { StageOneRun } from '../../../src/action/run.ts';
import type { AbilitySpecialty, ActionEvent, CourseDef, Obstacle, PokemonAbilityDef } from '../../../src/action/types.ts';
import { POKEMON } from '../../../src/game/constants.ts';
import type { PokemonId } from '../../../src/game/types.ts';
import { chaseCourse, drive, DT, FPS, idle, idleUntilCatch, newRun, ofType, openCourse, ram, rock, rower, startChase } from './helpers.ts';

const CHAR = 'kent' as const; // trait only moves the Hyde's start gap; neutral for everything checked here
const Q = idle({ ability: true });
const HYDE_TARGETING: AbilitySpecialty[] = ['hyde_distraction', 'pursuit_slow'];

/** Presses Q in a zero-length frame (no sim time passes) and returns its events. */
const pressQ = (run: StageOneRun): ActionEvent[] => run.update(0, Q);

/** Two runs with identical inputs; `b` differs only by the Pokémon (or the Q press the test makes on it). */
function twins(a: PokemonId, b: PokemonId, course: () => CourseDef) {
  return [newRun(CHAR, a, course()), newRun(CHAR, b, course())] as const;
}

/** Steps both runs one frame with the same input. */
function stepBoth(runs: readonly StageOneRun[], input = idle()): void {
  for (const r of runs) r.update(DT, input);
}

/** Chase on open water: rowing at `rate` until the Hyde is chasing, then a further `extraS`. */
function chasing(id: PokemonId, rate = 3, extraS = 3, course = chaseCourse()): StageOneRun {
  const run = newRun(CHAR, id, course);
  startChase(run, rate);
  drive(run, extraS, rower(rate));
  return run;
}

const defsWith = (s: AbilitySpecialty) => POKEMON_ABILITY_DEFS.filter((d) => d.specialty === s);

// ---------------------------------------------------------------------------------------------------- roster

describe('ability roster', () => {
  it('has one def for each of the 18 Pokémon', () => {
    expect(POKEMON_ABILITY_DEFS).toHaveLength(18);
    expect(new Set(POKEMON_ABILITY_DEFS.map((d) => d.id))).toEqual(new Set(POKEMON.map((p) => p.id)));
  });

  it('every passive kind has a Stage 1 interpreter, or is documented as an island/Stage 3 passive', () => {
    const src = readFileSync(join(process.cwd(), 'src/action/abilities.ts'), 'utf8');
    const laterStages = new Set(['egg_glow_radius_mult', 'egg_tether_scoop_radius_mult', 'egg_security_floor']);
    for (const d of POKEMON_ABILITY_DEFS) {
      if (!d.passive) continue;
      if (laterStages.has(d.passive.kind)) continue;
      expect(src, `${d.id} passive ${d.passive.kind}`).toContain(`'${d.passive.kind}'`);
    }
  });
});

describe('no Pokémon-id branches in the action code', () => {
  function sources(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) return name === 'data' ? [] : sources(p);
      return p.endsWith('.ts') ? [p] : [];
    });
  }

  it('src/action (outside data/) never names a Pokémon or character id in a string literal', () => {
    const files = sources(join(process.cwd(), 'src/action'));
    expect(files.length).toBeGreaterThan(10);
    const ids = [...POKEMON_ABILITY_DEFS.map((d) => d.id), ...CHARACTER_ACTION_DEFS.map((d) => d.id)];
    const literal = new RegExp(`['"\`](${ids.join('|')})['"\`]`);
    const offenders: string[] = [];
    for (const f of files) {
      readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
        if (literal.test(line)) offenders.push(`${f}:${i + 1}: ${line.trim()}`);
      });
    }
    expect(offenders).toEqual([]);
  });

  it('abilities.ts (the one interpreter) dispatches on specialty / passive kind, never on def.id', () => {
    const src = readFileSync(join(process.cwd(), 'src/action/abilities.ts'), 'utf8');
    expect(src).not.toMatch(/(def\.id|pokemonId)\s*[!=]==/);
    expect(src).toMatch(/switch \(this\.specialty\)/);
  });
});

// ---------------------------------------------------------------------------------------------------- Q, cooldown, charges

describe.each(POKEMON_ABILITY_DEFS.map((d) => [d.id, d] as const))('%s: Q, cooldown and charges', (id, def: PokemonAbilityDef) => {
  it('activates when ready, reports status, then denies with "cooldown" until cooldownS has passed', () => {
    const run = chasing(id);
    expect(run.abilityStatus().ready).toBe(true);
    const ev = pressQ(run);
    expect(ofType(ev, 'ability_used')).toEqual([{ type: 'ability_used', pokemonId: id, specialty: def.specialty, t: run.t }]);
    const st = run.abilityStatus();
    expect(st.ready).toBe(false);
    expect(st.cooldownLeftS).toBeCloseTo(def.cooldownS, 6);
    expect(st.chargesLeft).toBe(def.charges === null ? null : def.charges - 1);
    expect(st.activeLeftS).toBeCloseTo(def.durationS, 6);
    expect(run.stats.abilitiesUsed).toBe(1);

    expect(ofType(pressQ(run), 'ability_denied')).toEqual([{ type: 'ability_denied', reason: 'cooldown', t: run.t }]);
    const ends = ofType(drive(run, def.cooldownS - 0.3, rower(3)), 'ability_end');
    expect(ends).toHaveLength(1); // the effect ended exactly once, before the cooldown did
    expect(ofType(pressQ(run), 'ability_denied')[0]?.reason).toBe('cooldown');
    drive(run, 0.4, rower(3));
    expect(run.status).toBe('playing');
    expect(ofType(pressQ(run), 'ability_used')).toHaveLength(1);
  });

  it(def.charges === null ? 'has unlimited charges (cooldown only)' : `runs out after ${def.charges} charges ("no_charges")`, () => {
    const run = chasing(id);
    const uses = def.charges ?? 3;
    for (let i = 0; i < uses; i++) {
      expect(ofType(pressQ(run), 'ability_used'), `use ${i + 1}`).toHaveLength(1);
      drive(run, def.cooldownS + 0.05, rower(3));
      expect(run.status).toBe('playing');
    }
    const ev = pressQ(run);
    if (def.charges === null) expect(ofType(ev, 'ability_used')).toHaveLength(1);
    else {
      expect(ofType(ev, 'ability_denied')).toEqual([{ type: 'ability_denied', reason: 'no_charges', t: run.t }]);
      expect(run.abilityStatus()).toMatchObject({ ready: false, chargesLeft: 0 });
    }
  });

  if (HYDE_TARGETING.includes(def.specialty)) {
    it('is denied as "not_applicable" (and not spent) while the Hyde is not hunting', () => {
      const run = newRun(CHAR, id, openCourse());
      expect(run.hyde.phase).toBe('dormant');
      expect(ofType(pressQ(run), 'ability_denied')).toEqual([{ type: 'ability_denied', reason: 'not_applicable', t: 0 }]);
      expect(run.abilityStatus()).toMatchObject({ ready: true, cooldownLeftS: 0 });
    });
  }
});

// ---------------------------------------------------------------------------------------------------- effects by specialty

describe.each(defsWith('speed_boost').map((d) => [d.id, d] as const))('speed_boost — %s', (id, def) => {
  it('+magnitude u/s instantly, speed cap +magnitude for durationS, then ends', () => {
    const [plain, boosted] = twins(id, id, openCourse);
    const input = rower(3);
    for (let i = 0; i < 8 * FPS; i++) {
      const inp = input();
      plain.update(DT, inp);
      boosted.update(DT, inp);
    }
    const v0 = boosted.boat.speed;
    pressQ(boosted);
    expect(boosted.boat.speed).toBeCloseTo(v0 + def.magnitude, 9);
    expect(boosted.effects().speedBoost).toBe(true);
    stepBoth([plain, boosted]);
    expect(boosted.mods.topSpeedBonus).toBeCloseTo(def.magnitude, 9);
    const z0 = [plain.boat.z, boosted.boat.z];
    drive(plain, def.durationS, rower(3));
    const ev = drive(boosted, def.durationS, rower(3));
    expect(z0[1] - boosted.boat.z).toBeGreaterThan(z0[0] - plain.boat.z + def.magnitude * def.durationS * 0.4);
    expect(ofType(ev, 'ability_end')).toHaveLength(1);
    expect(boosted.effects().speedBoost).toBe(false);
    expect(boosted.mods.topSpeedBonus).toBe(0);
  });
});

describe.each(defsWith('shield').map((d) => [d.id, d] as const))('shield — %s', (id, def) => {
  const rocks = () => openCourse({ obstacles: [rock('r1', 0, -20)] });

  it('an active shield absorbs a head-on rock: 0 damage and 85 % speed kept (unshielded twin is hurt)', () => {
    const [plain, shielded] = twins(id, id, rocks);
    pressQ(shielded);
    expect(shielded.effects().shield).toBe(true);
    const a = ram(plain, 0, -20, 9, Math.min(1, def.durationS * 0.8));
    const b = ram(shielded, 0, -20, 9, Math.min(1, def.durationS * 0.8));
    expect(a.damage).toBeGreaterThan(0);
    expect(b.damage).toBe(0);
    expect(shielded.boat.hp).toBe(100);
    expect(b.speedAfterImpact / b.impactSpeed).toBeGreaterThan(STAGE_TUNING.abilities.shieldSpeedRetain - 0.03);
  });

  it(`absorbs exactly ${def.magnitude} damaging hits, then drops (ability_end)`, () => {
    const run = newRun(CHAR, id, openCourse());
    pressQ(run);
    for (let i = 0; i < def.magnitude; i++) expect(run.abilities.impact(run.t, 'rock', true, run.hydeAI).absorbed, `hit ${i + 1}`).toBe(true);
    expect(run.effects().shield).toBe(false);
    expect(run.abilities.impact(run.t, 'rock', true, run.hydeAI).absorbed).toBe(false);
    expect(ofType(run.update(DT, idle()), 'ability_end')).toHaveLength(1);
  });
});

describe.each(defsWith('hyde_distraction').map((d) => [d.id, d] as const))('hyde_distraction — %s', (id, def) => {
  it('the Hyde chases a decoy at v × magnitude for durationS, then resumes the chase', () => {
    const a = chasing(id);
    const b = chasing(id);
    const ev = pressQ(b);
    expect(b.hyde.phase).toBe('distracted');
    expect(ofType(ev, 'hyde_phase').map((e) => e.phase)).toEqual(['distracted']);
    expect(b.effects().hydeDistracted).toBe(true);
    expect(b.effects().decoy).not.toBeNull();
    expect(b.hyde.decoy).toEqual(b.effects().decoy);
    stepBoth([a, b], idle({ strokes: 0 }));
    expect(b.hyde.speed / a.hyde.speed).toBeCloseTo(def.magnitude, 2);
    expect(b.hydeAI.gap).toBeGreaterThan(a.hydeAI.gap);
    drive(b, def.durationS, rower(3));
    expect(b.hyde.phase).toBe('chasing');
    expect(b.effects().hydeDistracted).toBe(false);
    expect(b.hyde.decoy).toBeNull();
  });

  it('cancels an active surge (telegraph included)', () => {
    const run = chasing(id);
    run.hydeAI.requestSurge(run.t);
    drive(run, 0.2, rower(3));
    expect(run.hyde.phase).toBe('surging');
    expect(run.surgeTelegraphLeftS()).toBeGreaterThan(0);
    pressQ(run);
    expect(run.surgeTelegraphLeftS()).toBe(0);
    expect(run.hydeAI.surgeBursting).toBe(false);
    drive(run, def.durationS + 0.2, rower(3));
    expect(run.hyde.phase).toBe('chasing');
    expect(run.hydeAI.surgeBursting).toBe(false);
  });
});

describe.each(defsWith('pursuit_slow').map((d) => [d.id, d] as const))('pursuit_slow — %s', (id, def) => {
  it('the Hyde moves at v × magnitude for durationS', () => {
    const a = chasing(id);
    const b = chasing(id);
    pressQ(b);
    expect(b.effects().hydeSlowed).toBe(true);
    stepBoth([a, b]);
    expect(b.hyde.speed / a.hyde.speed).toBeCloseTo(def.magnitude, 2);
    drive(b, def.durationS + 0.05, rower(3));
    expect(b.effects().hydeSlowed).toBe(false);
  });

  it('also slows a surge burst (the surge timer keeps running)', () => {
    const a = chasing(id, 2.5, 25);
    const b = chasing(id, 2.5, 25);
    for (const r of [a, b]) r.hydeAI.requestSurge(r.t);
    drive(a, 0.1 + a.hydeAI.telegraphS + 0.2, rower(2.5));
    drive(b, 0.1 + b.hydeAI.telegraphS + 0.2, rower(2.5));
    expect(b.hydeAI.surgeBursting).toBe(true);
    pressQ(b);
    stepBoth([a, b]);
    expect(b.hyde.speed / a.hyde.speed).toBeCloseTo(def.magnitude, 2);
    expect(b.hydeAI.surgeBursting).toBe(true);
  });
});

describe.each([...defsWith('obstacle_detection'), ...defsWith('egg_sense')].map((d) => [d.id, d] as const))('%s — hazard reveal', (id, def) => {
  const rocks = () => openCourse({ obstacles: [rock('r1', 0, -20)] });
  it('reveals hazards (radius from magnitude) and a revealed hit is braced: less damage, more speed kept', () => {
    const [plain, seer] = twins(id, id, rocks);
    pressQ(seer);
    expect(seer.effects().obstaclesRevealed).toBe(true);
    const radius = def.specialty === 'egg_sense' ? def.magnitude * STAGE_TUNING.abilities.eggSenseWaterRadiusMult : def.magnitude;
    expect(seer.revealRadius()).toBeCloseTo(radius, 9);
    const a = ram(plain, 0);
    const b = ram(seer, 0);
    expect(b.damage).toBeLessThan(a.damage);
    expect(b.damage / a.damage).toBeGreaterThan(STAGE_TUNING.collision.glancingDamageMult - 0.1);
    expect(b.damage / a.damage).toBeLessThan(STAGE_TUNING.collision.glancingDamageMult + 0.1);
    expect(b.speedAfterImpact / b.impactSpeed).toBeGreaterThan(a.speedAfterImpact / a.impactSpeed + 0.3);
    drive(seer, def.durationS);
    expect(seer.effects().obstaclesRevealed).toBe(false);
  });
});

describe.each(defsWith('egg_protection').map((d) => [d.id, d] as const))('egg_protection — %s', (id, def) => {
  const hull = 1 - def.magnitude * STAGE_TUNING.abilities.eggProtectHullFactor;

  it('anchors the boat: collision hull damage × (1 − magnitude / 2)', () => {
    const big = () => openCourse({ obstacles: [rock('r1', 0, -20, 2, 40)] });
    const [plain, anchored] = twins(id, id, big);
    pressQ(anchored);
    expect(anchored.effects().anchored).toBe(true);
    const a = ram(plain, 0);
    const b = ram(anchored, 0);
    expect(b.damage).toBeLessThan(a.damage);
    expect(b.damage / a.damage).toBeCloseTo(hull, 1);
  });

  it('also reduces the Hyde catch damage while active', () => {
    const run = newRun(CHAR, id, chaseCourse());
    startChase(run);
    // let him close in, then anchor just before the grab (the ability is then on cooldown: no rescue)
    const until = (pred: () => boolean) => {
      for (let i = 0; i < 60 * FPS && !pred(); i++) run.update(DT, idle());
    };
    until(() => run.hydeAI.gap < 10);
    pressQ(run);
    idleUntilCatch(run);
    expect(run.rescue.abilityAvailable).toBe(false);
    drive(run, 3);
    expect(run.lastRescue?.outcome).toBe('caught');
    expect(run.lastRescue?.damage).toBe(Math.round(STAGE_TUNING.hyde.stage1.catchHullDamage * hull));
  });
});

describe.each(defsWith('stamina_restore').map((d) => [d.id, d] as const))('stamina_restore — %s', (id, def) => {
  it('+magnitude stamina instantly and free strokes for durationS', () => {
    const run = newRun(CHAR, id, openCourse());
    run.boat.stamina = 10;
    pressQ(run);
    expect(run.boat.stamina).toBeCloseTo(10 + def.magnitude, 9);
    expect(run.effects().staminaSurge).toBe(true);
    const before = run.boat.stamina;
    run.update(0, idle({ strokes: 1 }));
    expect(run.boat.strokeCount).toBe(1);
    expect(run.boat.stamina).toBe(before);
    drive(run, def.durationS + 0.05);
    expect(run.effects().staminaSurge).toBe(false);
    const s = run.boat.stamina;
    run.update(0, idle({ strokes: 1 }));
    expect(s - run.boat.stamina).toBeCloseTo(ROWING.strokeStaminaCost, 6);
  });
});

describe.each(defsWith('fog_clear').map((d) => [d.id, d] as const))('fog_clear — %s', (id, def) => {
  it('fog is 0 within magnitude u of the flare for durationS; outside the radius fog remains', () => {
    const run = newRun(CHAR, id, openCourse({ fog: [{ x: 0, z: 0, radius: 400, density: 0.8 }] }));
    expect(run.fogAt()).toBeGreaterThan(0.7);
    pressQ(run);
    expect(run.fogAt()).toBe(0);
    expect(run.effects()).toMatchObject({ fogCleared: true, obstaclesRevealed: true });
    run.boat.z = -(def.magnitude + 5); // beyond the flare radius
    expect(run.fogAt()).toBeGreaterThan(0.5);
    expect(run.effects().fogCleared).toBe(false);
    run.boat.z = -def.magnitude / 2;
    expect(run.fogAt()).toBe(0);
    drive(run, def.durationS + 0.05);
    run.boat.z = 0;
    expect(run.fogAt()).toBeGreaterThan(0.7);
  });
});

describe.each(defsWith('current_ride').map((d) => [d.id, d] as const))('current_ride — %s', (id, def) => {
  it('re-aims a cross current along the heading × magnitude', () => {
    const cross = () => openCourse({ currents: [{ x: 0, z: 0, radius: 300, pushX: 2, pushZ: 0 }] });
    const [plain, rider] = twins(id, id, cross);
    pressQ(rider);
    expect(rider.effects().speedBoost).toBe(true);
    drive(plain, 2);
    drive(rider, 2);
    expect(plain.boat.x).toBeGreaterThan(3); // swept sideways
    expect(Math.abs(rider.boat.x)).toBeLessThan(0.01); // not swept at all …
    expect(-rider.boat.z).toBeGreaterThan(2 * 2 * def.magnitude * 0.9); // … carried forward instead
  });

  it('outside currents adds a +magnitude u/s forward push', () => {
    const [plain, rider] = twins(id, id, openCourse);
    pressQ(rider);
    drive(plain, 2);
    drive(rider, 2);
    expect(plain.boat.z).toBe(0);
    expect(-rider.boat.z).toBeCloseTo(2 * def.magnitude, 1);
  });
});

// ---------------------------------------------------------------------------------------------------- passives (Stage 1)

describe('passives with a Stage 1 effect', () => {
  const passive = (kind: string) => POKEMON_ABILITY_DEFS.filter((d) => d.passive?.kind === kind);
  const plainId: PokemonId = 'alolan_marowak'; // no passive

  it('phase_sunken_branches: the hull slips through sunken branches', () => {
    for (const d of passive('phase_sunken_branches')) {
      const branch: Obstacle = { id: 'b1', kind: 'branch', x: 0, z: -20, radius: 0.45, halfLength: 3, angle: Math.PI / 2, damage: 8 };
      const course = () => openCourse({ obstacles: [structuredClone(branch)] });
      expect(ofType(ram(newRun(CHAR, d.id, course()), 0).events, 'collision')).toHaveLength(0);
      expect(ofType(ram(newRun(CHAR, plainId, course()), 0).events, 'collision').length).toBeGreaterThan(0);
    }
  });

  it('surge_closing_mult: surges close less (burst speed lower by boost × (1 − value))', () => {
    for (const d of passive('surge_closing_mult')) {
      // 25 s of rowing first so the Hyde's pace average (τ 6 s) has converged; otherwise the burst is moot
      const a = chasing(plainId, 2.5, 25);
      const b = chasing(d.id, 2.5, 25);
      for (const r of [a, b]) r.hydeAI.requestSurge(r.t);
      drive(a, 0.1 + a.hydeAI.telegraphS + 0.3, rower(2.5));
      drive(b, 0.1 + b.hydeAI.telegraphS + 0.3, rower(2.5));
      expect(a.hydeAI.surgeBursting && b.hydeAI.surgeBursting).toBe(true);
      expect(a.hyde.speed).toBeGreaterThan(a.boat.speed); // the burst really closes
      expect(a.hyde.speed - b.hyde.speed).toBeCloseTo(STAGE_TUNING.hyde.stage1.surgeBoost * (1 - d.passive!.value), 1);
    }
  });

  it('curse_on_catch_hyde_speed_mult: after any catch the Hyde moves × value for 8 s', () => {
    for (const d of passive('curse_on_catch_hyde_speed_mult')) {
      const [a, b] = [newRun(CHAR, plainId, chaseCourse()), newRun(CHAR, d.id, chaseCourse())];
      for (const r of [a, b]) {
        startChase(r);
        idleUntilCatch(r);
        drive(r, 2.2); // no Q: full catch, then 3 s stun
        drive(r, STAGE_TUNING.hyde.stage1.recoverStunS + 0.05);
        expect(r.hyde.phase).toBe('chasing');
      }
      expect(b.abilities.curseActive(b.t)).toBe(true);
      expect(b.hyde.speed / a.hyde.speed).toBeCloseTo(d.passive!.value, 2);
    }
  });

  it('hyde_catch_radius_mult: the Hyde must get closer to grab', () => {
    for (const d of passive('hyde_catch_radius_mult')) {
      const closest = (pid: PokemonId) => {
        const run = newRun(CHAR, pid, chaseCourse());
        startChase(run);
        let last = Infinity;
        for (let i = 0; i < 120 * FPS && run.status === 'playing'; i++) {
          last = run.hyde.distance;
          run.update(DT, idle());
        }
        return last;
      };
      const r = STAGE_TUNING.hyde.stage1.catchRadiusU;
      expect(closest(plainId)).toBeGreaterThan(r);
      expect(closest(d.id)).toBeLessThan(r); // he was inside the normal radius without a catch
      expect(closest(d.id)).toBeGreaterThan(r * d.passive!.value);
    }
  });

  it('boost_stroke_cost_mult: strokes cost × value while the boost blows', () => {
    for (const d of passive('boost_stroke_cost_mult')) {
      const run = newRun(CHAR, d.id, openCourse());
      pressQ(run);
      const s = run.boat.stamina;
      run.update(0, idle({ strokes: 1 }));
      expect(s - run.boat.stamina).toBeCloseTo(ROWING.strokeStaminaCost * d.passive!.value, 6);
    }
  });

  it('fog_hyde_speed_mult: in fog the Hyde moves × value', () => {
    for (const d of passive('fog_hyde_speed_mult')) {
      // a fog bank ahead: both runs are identical until the boat enters it, then only his speed differs
      // (the disturbance's own fog is switched off so the passive is idle until the bank)
      const fog = () => {
        const c = chaseCourse({ fog: [{ x: 0, z: -150, radius: 40, density: 0.6 }] });
        c.encounters = c.encounters!.map((e) => (e.kind === 'disturbance' ? { ...e, params: { fogDensity: 0 } } : e));
        return c;
      };
      const a = chasing(plainId, 3, 3, fog());
      const b = chasing(d.id, 3, 3, fog());
      const ia = rower(3);
      const ib = rower(3);
      for (let i = 0; i < 30 * FPS && a.hyde.speed === b.hyde.speed; i++) {
        a.update(DT, ia());
        b.update(DT, ib());
      }
      expect(b.fogAt()).toBeGreaterThan(0);
      expect(b.t).toBeGreaterThan(8);
      expect(b.hyde.speed / a.hyde.speed).toBeCloseTo(d.passive!.value, 2);
    }
  });

  it('current_push_mult: currents push the boat × value (currentShield effect while in one)', () => {
    for (const d of passive('current_push_mult')) {
      const cur = () => openCourse({ currents: [{ x: 0, z: 0, radius: 300, pushX: 2, pushZ: 0 }] });
      const a = newRun(CHAR, plainId, cur());
      const b = newRun(CHAR, d.id, cur());
      drive(a, 2);
      drive(b, 2);
      expect(b.boat.x / a.boat.x).toBeCloseTo(d.passive!.value, 1);
      expect(b.effects().currentShield).toBe(true);
      expect(a.effects().currentShield).toBe(false);
    }
  });

  it('flare_stuns_hyde_s: the flare stuns a hunting Hyde within magnitude / 2, not one farther away', () => {
    for (const d of passive('flare_stuns_hyde_s')) {
      const near = chasing(d.id);
      near.hydeAI.knockBack(d.magnitude / 2 - 5, 0, near.t, []);
      near.update(DT, idle());
      pressQ(near);
      expect(near.hyde.phase).toBe('stunned');
      const far = chasing(d.id);
      expect(far.hydeAI.gap).toBeGreaterThan(d.magnitude / 2);
      pressQ(far);
      expect(far.hyde.phase).toBe('chasing');
    }
  });

  it('shield_blocks_hyde_knockback_u: an active shield repels the grab — no catch at all', () => {
    for (const d of passive('shield_blocks_hyde_knockback_u')) {
      const run = newRun(CHAR, d.id, chaseCourse());
      startChase(run);
      for (let i = 0; i < 60 * FPS && run.hydeAI.gap > 5; i++) run.update(DT, idle());
      pressQ(run);
      const ev = drive(run, d.durationS - 0.1);
      expect(ofType(ev, 'hyde_catch')).toHaveLength(0);
      expect(ofType(ev, 'hyde_phase').map((e) => e.phase)).toContain('stunned');
      expect(run.catches).toBe(0);
      expect(run.status).toBe('playing');
    }
  });

  it('collision_roots_hyde_s: each damaging collision roots a hunting Hyde (slowed)', () => {
    for (const d of passive('collision_roots_hyde_s')) {
      const run = chasing(d.id, 3, 3, chaseCourse({ obstacles: [rock('r1', 0, -400)] }));
      expect(run.effects().hydeSlowed).toBe(false);
      const { damage } = ram(run, 0, -400, 9, 0.5);
      expect(damage).toBeGreaterThan(0);
      expect(run.effects().hydeSlowed).toBe(true);
    }
  });

  it('hazard_outline_range_u: sunken branches are always outlined (braced hits) and outlined within value u', () => {
    for (const d of passive('hazard_outline_range_u')) {
      const branch: Obstacle = { id: 'b1', kind: 'branch', x: 0, z: -20, radius: 0.45, halfLength: 3, angle: Math.PI / 2, damage: 20 };
      const course = () => openCourse({ obstacles: [structuredClone(branch)] });
      const seer = newRun(CHAR, d.id, course());
      expect(seer.revealRadius()).toBe(d.passive!.value);
      const a = ram(newRun(CHAR, plainId, course()), 0);
      const b = ram(seer, 0);
      expect(b.damage).toBeLessThan(a.damage);
    }
  });

  it('lead_top_speed_bonus: with the hunting Hyde 25 u+ behind, top speed + value', () => {
    for (const d of passive('lead_top_speed_bonus')) {
      const run = chasing(d.id);
      run.hydeAI.knockBack(55, 0, run.t, []);
      run.update(DT, idle());
      expect(run.hydeAI.gap).toBeGreaterThan(25);
      expect(run.mods.topSpeedBonus).toBeCloseTo(d.passive!.value, 9);
      run.hydeAI.knockBack(18, 0, run.t, []);
      run.update(DT, idle());
      expect(run.mods.topSpeedBonus).toBe(0);
    }
  });

  it('boost_cuts_debris: while boosting, logs are cut (removed) with no collision or speed loss', () => {
    for (const d of passive('boost_cuts_debris')) {
      const log: Obstacle = { id: 'log1', kind: 'log', x: 0, z: -20, radius: 0.6, halfLength: 3, angle: Math.PI / 2, damage: 10 };
      const course = () => openCourse({ obstacles: [structuredClone(log)] });
      const run = newRun(CHAR, d.id, course());
      run.boat.z = -14;
      pressQ(run);
      const ev = drive(run, 2, rower(3));
      expect(run.removedObstacles.has('log1')).toBe(true);
      expect(ofType(ev, 'collision')).toHaveLength(0);
      expect(run.boat.hp).toBe(100);
      const plain = ram(newRun(CHAR, plainId, course()), 0);
      expect(plain.damage).toBeGreaterThan(0);
    }
  });
});
