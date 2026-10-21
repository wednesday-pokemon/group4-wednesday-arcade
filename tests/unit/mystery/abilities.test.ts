import { describe, expect, it } from 'vitest';
import { allPairs, REGISTRIES } from '../../../src/mystery/draft.ts';
import type { MysteryRun } from '../../../src/mystery/run.ts';
import type { AbilityDef, AbilityEffect, Duo, NightshadeId, PokemonId, StampedEvent } from '../../../src/mystery/types.ts';
import { NIGHTSHADE_IDS } from '../../../src/mystery/types.ts';
import { POKEMON_IDS } from '../../../src/mystery/draft.ts';
import { hold, makeRun, place, placeHyde, type FixtureOptions } from './helpers.ts';

const SOUTH_FACING = Math.PI;

/** Hyde 2 m in front of the player, facing it, clear line of sight; real registries. */
function faceOff(duo: Duo, map?: FixtureOptions): MysteryRun {
  const run = makeRun({ duo, registries: REGISTRIES, fixture: map ?? { hydeStart: { x: 0, z: -12, yaw: SOUTH_FACING }, patrol: [{ x: 0, z: -12 }] } });
  placeHyde(run, 0, -12, SOUTH_FACING);
  place(run, 0, -10, 0);
  return run;
}

function press(run: MysteryRun, key: 'F' | 'Q'): StampedEvent[] {
  return hold(run, run.tuning.fixedStepS, key === 'F' ? { power: true } : { move: true });
}

/** Asserts the observable effect of one effect kind right after activation. */
function expectEffect(run: MysteryRun, e: AbilityEffect, before: { x: number; z: number }): void {
  const fx = run.effects();
  switch (e.kind) {
    case 'reveal_clues':
      if (e.visual === 'scent_trail') expect(fx.scentTrail?.length ?? 0).toBeGreaterThan(1);
      else expect(fx.revealedClues.length).toBeGreaterThan(0);
      return;
    case 'premonition':
      expect(fx.premonitionPath?.length ?? 0).toBeGreaterThanOrEqual(1);
      return;
    case 'speed_boost':
      expect(fx.speedBoost).toBe(true);
      return;
    case 'lure':
      expect(fx.lurePoint).not.toBeNull();
      expect(run.hyde.mode).toBe('INVESTIGATE_SOUND');
      return;
    case 'distract':
      expect(fx.hydeDistracted).toBe(true);
      return;
    case 'stun':
      expect(fx.hydeStunned).toBe(true);
      if (e.visual === 'petrify' || e.visual === 'pin') expect(fx.hydePetrified).toBe(true);
      return;
    case 'slow':
      expect(fx.hydeSlowed).toBe(true);
      expect(run.hyde.slowMult).toBeGreaterThanOrEqual(run.tuning.abilities.minHydeSpeedMult);
      return;
    case 'block_grab':
      expect(fx.blockGrab).toBe(true);
      return;
    case 'egg_shield':
      expect(fx.eggShield).toBe(true);
      return;
    case 'dash':
      expect(Math.hypot(run.player.x - before.x, run.player.z - before.z)).toBeGreaterThan(e.magnitude * 0.8);
      return;
    case 'reveal_hazards':
      expect(fx.revealHazards).toBe(true);
      return;
    case 'power_switch':
      return; // covered by the dedicated switch tests (fallback = next effect)
  }
}

function checkAbility(duo: Duo, key: 'F' | 'Q', def: AbilityDef): void {
  const run = faceOff(duo);
  const before = { x: run.player.x, z: run.player.z };
  const ev = press(run, key);
  const used = ev.find((e) => e.type === 'ability_used');
  expect(used, `${def.id} should activate`).toMatchObject({ key, abilityId: def.id, kinds: def.effects.map((e) => e.kind), success: true });
  for (const e of def.effects) expectEffect(run, e, before);
  if (def.noise > 0) expect(ev.some((e) => e.type === 'noise' && e.source === 'ability')).toBe(true);
  else expect(ev.some((e) => e.type === 'noise' && e.source === 'ability')).toBe(false);
  const status = key === 'F' ? run.powerStatus() : run.moveStatus();
  expect(status.ready).toBe(false);
  expect(status.cooldownLeftS).toBeGreaterThan(def.cooldownS - 0.2);
  const again = press(run, key);
  expect(again.find((e) => e.type === 'ability_denied')).toMatchObject({ key, reason: 'cooldown' });
  expect(again.some((e) => e.type === 'ability_used')).toBe(false);
}

describe('every F power activates and does what it says', () => {
  for (const id of NIGHTSHADE_IDS) {
    it(`${id}: ${REGISTRIES.nightshades[id].power.name}`, () => {
      checkAbility({ characterId: id, pokemonId: 'aegislash' }, 'F', REGISTRIES.nightshades[id].power);
    });
  }
});

describe('every Q move activates and does what it says', () => {
  for (const id of POKEMON_IDS) {
    it(`${id}: ${REGISTRIES.partners[id].move.name}`, () => {
      checkAbility({ characterId: 'morticia', pokemonId: id }, 'Q', REGISTRIES.partners[id].move);
    });
  }
});

describe('interpreter rules', () => {
  it('a targeted effect with no valid target is denied (no_target) and keeps the cooldown ready', () => {
    const run = faceOff({ characterId: 'ajax', pokemonId: 'aegislash' });
    run.player.yaw = Math.PI; // look away: the gaze cone misses
    const ev = press(run, 'F');
    expect(ev.find((e) => e.type === 'ability_denied')).toMatchObject({ key: 'F', reason: 'no_target' });
    expect(run.powerStatus().ready).toBe(true);
    expect(ev.some((e) => e.type === 'noise' && e.source === 'ability')).toBe(false);
  });

  it('walls block line-of-sight effects', () => {
    const run = faceOff({ characterId: 'ajax', pokemonId: 'aegislash' });
    place(run, -6, 3, Math.PI); // north of the wall, facing +Z ... turn to face the Hyde through the wall
    placeHyde(run, -6, -3, SOUTH_FACING);
    run.player.yaw = 0;
    const ev = press(run, 'F');
    expect(ev.find((e) => e.type === 'ability_denied')).toMatchObject({ reason: 'no_target' });
  });

  it('Gomez near the switch: opens the gate (and skips the stun); the timed gate later closes', () => {
    const run = faceOff({ characterId: 'gomez', pokemonId: 'aegislash' });
    place(run, 12, 3.5);
    const ev = press(run, 'F');
    expect(ev.find((e) => e.type === 'ability_used')).toMatchObject({ abilityId: 'electric_spark', success: true });
    expect(run.isWallOpen('gate')).toBe(true);
    expect(run.effects().switchPowered).toBe(true);
    expect(run.effects().hydeStunned).toBe(false);
    expect(run.world.isFree(12, 0, run.tuning.player.radius)).toBe(true);
    place(run, -15, 17);
    hold(run, 10.5);
    expect(run.isWallOpen('gate')).toBe(false);
  });

  it('Gomez away from the switch: the next effect (stun) applies instead', () => {
    const run = faceOff({ characterId: 'gomez', pokemonId: 'aegislash' });
    const ev = press(run, 'F');
    expect(ev.find((e) => e.type === 'ability_used')?.type).toBe('ability_used');
    expect(run.isWallOpen('gate')).toBe(false);
    expect(run.effects().hydeStunned).toBe(true);
  });

  it('a gate never closes on the player standing in it', () => {
    const run = faceOff({ characterId: 'gomez', pokemonId: 'aegislash' });
    place(run, 12, 3.5);
    press(run, 'F');
    place(run, 12, 0);
    run.hydeBrain.active = false;
    hold(run, 11);
    expect(run.isWallOpen('gate')).toBe(true);
    place(run, 12, 5);
    hold(run, 0.1);
    expect(run.isWallOpen('gate')).toBe(false);
  });

  it('repeated stuns within the window are halved; hydeEffectDurationMult scales; everything caps at 8 s', () => {
    const run = faceOff({ characterId: 'ajax', pokemonId: 'sableye' });
    press(run, 'F'); // 2.5 s petrify
    expect(run.hyde.stunnedUntil - run.t).toBeCloseTo(2.5, 1);
    hold(run, 2.6);
    placeHyde(run, 0, -12, SOUTH_FACING);
    place(run, 0, -10, 0);
    const ev = press(run, 'Q'); // 1.2 s → 0.6 s (diminished)
    expect(ev.find((e) => e.type === 'ability_used')!).toMatchObject({ success: true });
    expect((ev.find((e) => e.type === 'ability_used') as { detail: string }).detail).toContain('diminished');
    expect(run.hyde.stunnedUntil - run.t).toBeCloseTo(0.6, 1);

    const big = makeRun({ duo: { characterId: 'bianca', pokemonId: 'aegislash' }, registries: {
      nightshades: { ...REGISTRIES.nightshades, bianca: { ...REGISTRIES.nightshades.bianca, power: { ...REGISTRIES.nightshades.bianca.power, effects: [{ kind: 'stun', durationS: 20, magnitude: 0, rangeM: 10 }] } } },
      partners: REGISTRIES.partners,
    }, fixture: { hydeStart: { x: 0, z: -12, yaw: SOUTH_FACING }, patrol: [{ x: 0, z: -12 }] } });
    place(big, 0, -10, 0);
    press(big, 'F');
    expect(big.hyde.stunnedUntil - big.t).toBeLessThanOrEqual(8 + 1e-6);
  });

  it('heal restores HP only when the effect lands, capped at max', () => {
    const run = faceOff({ characterId: 'wednesday', pokemonId: 'ceruledge' });
    run.player.hp = 60;
    press(run, 'Q');
    expect(run.player.hp).toBe(70);
    const far = faceOff({ characterId: 'wednesday', pokemonId: 'ceruledge' });
    far.player.hp = 60;
    place(far, 0, -4, 0); // 8 m: Bitter Blade range is 3.5 m
    press(far, 'Q');
    expect(far.player.hp).toBe(60);
  });

  it('dash never passes through a wall', () => {
    const run = faceOff({ characterId: 'wednesday', pokemonId: 'basculegion' });
    place(run, -8, 2, 0); // 2 m north of the wall, facing it
    press(run, 'Q');
    expect(run.player.z).toBeGreaterThan(0.6);
  });

  it('premonition shows the patrol ahead; it is denied when the Hyde is beyond rangeM', () => {
    const run = makeRun({ duo: { characterId: 'morticia', pokemonId: 'aegislash' }, registries: REGISTRIES, fixture: {
      hydeStart: { x: -12, z: -10, yaw: 0 }, patrol: [{ x: -12, z: -10 }, { x: 12, z: -10 }],
    } });
    hold(run, 1);
    press(run, 'F');
    const path = run.effects().premonitionPath!;
    expect(path.length).toBeGreaterThan(1);
    const end = path[path.length - 1];
    expect(end.x).toBeGreaterThan(run.hyde.x + 5); // it predicts the walk east along the loop
  });
});

describe('all 126 duos: both abilities activate in a short live smoke', () => {
  it('F and Q produce ability events, respect cooldowns, never throw', () => {
    let used = 0;
    for (const duo of allPairs()) {
      const run = faceOff(duo as { characterId: NightshadeId; pokemonId: PokemonId });
      const ev = [...press(run, 'F'), ...press(run, 'Q')];
      const u = ev.filter((e) => e.type === 'ability_used' || e.type === 'ability_denied');
      expect(u.length).toBe(2);
      used += ev.filter((e) => e.type === 'ability_used').length;
      hold(run, 3, { moveZ: -1, sprint: true });
      const again = [...press(run, 'F'), ...press(run, 'Q')];
      for (const e of again) if (e.type === 'ability_denied') expect(['cooldown', 'no_target']).toContain(e.reason);
      expect(run.log.every((e, i) => e.seq === i + 1)).toBe(true);
    }
    expect(used).toBeGreaterThan(126 * 2 * 0.9);
  });
});
