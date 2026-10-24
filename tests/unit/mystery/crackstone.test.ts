// Joseph Crackstone (docs/overhaul/ENEMY_CONTRACT.md R1–R9, sim rules 1–12): routes, perception, scan, curse, leash,
// R6, movement invariants, determinism, byte-identical logs without him, abilities on him, run API, source scan.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { Bot } from '../../../src/mystery/bot.ts';
import { withTuning, type SimTuning } from '../../../src/mystery/config.ts';
import { CASES } from '../../../src/mystery/data/cases.ts';
import { caseMap, defaultTuning } from '../../../src/mystery/defaults.ts';
import { allPairs, POKEMON_IDS, REGISTRIES } from '../../../src/mystery/draft.ts';
import { playEpisode } from '../../../src/mystery/episode.ts';
import { World, yawTo } from '../../../src/mystery/geometry.ts';
import { navGridFor } from '../../../src/mystery/nav.ts';
import { MysteryRun } from '../../../src/mystery/run.ts';
import { combineMods } from '../../../src/mystery/stats.ts';
import {
  CASE_IDS, NIGHTSHADE_IDS, type CaseId, type CrackstoneDef, type Duo, type MapDef, type StampedEvent, type Vec2,
} from '../../../src/mystery/types.ts';
import { hold, input, neutralRegistries, place, placeHyde } from './helpers.ts';
import { preFinalView, regressionHashes } from './regressionEpisodes.ts';
import { encounterSpawnsFor } from '../../../src/mystery/director.ts';
import { fixtureWorldMap, worldRun, WORLD_TUNING } from './worldFixture.ts';

// ------------------------------------------------------------------------------------------------- fixture

const rect = (minX: number, minZ: number, maxX: number, maxZ: number): Vec2[] => [
  { x: minX, z: minZ }, { x: minX, z: maxZ }, { x: maxX, z: maxZ }, { x: maxX, z: minZ },
];

/** South half of the 40 m fixture world (centroid (0, 10.75)), loop around the open lawn. */
const DEF: CrackstoneDef = {
  areaName: 'Test Yard',
  polygon: rect(-18, 2, 18, 19.5),
  patrol: [{ x: -10, z: 12 }, { x: 10, z: 12 }, { x: 10, z: 5 }, { x: -10, z: 5 }],
  start: { x: -10, z: 12, yaw: -Math.PI / 2 },
  leashM: 12,
};

function crackMap(def: CrackstoneDef = DEF): MapDef {
  const m = fixtureWorldMap({ hazards: [] });
  return { ...m, world: { ...m.world!, crackstone: def } };
}

/** Hyde absent (emerges at 999 s), scans only when a test forces them. `still` = he does not walk his loop. */
function tuningFor(o: { still?: boolean; over?: Parameters<typeof withTuning>[0] } = {}): SimTuning {
  const base = withTuning({ hyde: { emergeAfterS: 999 }, crackstone: { scanEveryS: 9999, scanJitterS: 0 } }, WORLD_TUNING);
  const still = o.still ? withTuning({ crackstone: { speed: { PATROL: 0 } } }, base) : base;
  return o.over ? withTuning(o.over, still) : still;
}

function crackRun(o: { duo?: Duo; tuning?: SimTuning; def?: CrackstoneDef; tutorial?: boolean; registries?: typeof REGISTRIES } = {}): MysteryRun {
  return worldRun({ map: crackMap(o.def), tuning: o.tuning ?? tuningFor({ still: true }), duo: o.duo, tutorial: o.tutorial, registries: o.registries });
}

function placeC(run: MysteryRun, x: number, z: number, faceX: number, faceZ: number): void {
  const c = run.crackstone!;
  c.x = x;
  c.z = z;
  c.yaw = yawTo(x, z, faceX, faceZ);
  run.crackstoneBrain!.invalidatePath();
}

const ofType = <T extends StampedEvent['type']>(ev: StampedEvent[], type: T) => ev.filter((e): e is Extract<StampedEvent, { type: T }> => e.type === type);

/** Steps until `pred` holds (or `maxS`); returns the log slice. */
function until(run: MysteryRun, maxS: number, pred: () => boolean, p: Parameters<typeof input>[0] = {}): StampedEvent[] {
  const before = run.log.length;
  run.setInput(input(p));
  for (let i = 0; i < Math.round(maxS / run.tuning.fixedStepS) && run.status === 'playing' && !pred(); i++) run.step();
  return run.log.slice(before);
}

/** Forces a scan warning now (he must be in PATROL / SEARCH). */
function forceScan(run: MysteryRun): void {
  run.crackstoneBrain!.nextScanAt = run.t;
}

// ------------------------------------------------------------------------------------------------- data

describe('Crackstone haunts (case data)', () => {
  it.each(CASE_IDS)('%s: start + every waypoint walkable for his radius, every loop segment walkable, ≥ director.minSpawnM from the start', (id) => {
    const map = caseMap(id);
    const def = map.world!.crackstone!;
    expect(def).toBeTruthy();
    const T = defaultTuning();
    const world = new World(map, T.nav.lowCoverBlocksMovement);
    const nav = navGridFor(map, world, T.crackstone.radius, T.nav.cellM, T.nav.lowCoverBlocksMovement);
    expect(nav.walkable(def.start.x, def.start.z), 'start').toBe(true);
    expect(def.patrol.length).toBeGreaterThanOrEqual(3);
    def.patrol.forEach((p, i) => {
      const q = def.patrol[(i + 1) % def.patrol.length];
      expect(nav.walkable(p.x, p.z), `wp${i}`).toBe(true);
      expect(nav.lineWalkable(p, q), `segment ${i}→${(i + 1) % def.patrol.length}`).toBe(true);
    });
    const pier = map.playerStart;
    // compact maps (final): he appears only at director spawns, each ≥ minSpawnM from the start (and out of view at
    // spawn time — director.test.ts); his loop may pass closer later, like the Hyde's
    for (const p of encounterSpawnsFor(map.world!, 'crackstone')) expect(Math.hypot(p.x - pier.x, p.z - pier.z), p.id).toBeGreaterThanOrEqual(T.director.minSpawnM);
  });

  it('per-case overrides are applied at run construction (sight × sightRangeMult, scanEveryS)', () => {
    const T = defaultTuning();
    const crypt = new MysteryRun({ duo: { characterId: 'enid', pokemonId: 'gengar' }, seed: 's', caseDef: CASES.crypt_last_witness });
    const def = crypt.crackstoneDef!;
    expect(crypt.crackstoneBrain!.cfg.sight.rangeM).toBeCloseTo(T.crackstone.sight.rangeM * (def.sightRangeMult ?? 1), 6);
    expect(crypt.crackstoneBrain!.cfg.scanEveryS).toBe(def.scanEveryS ?? T.crackstone.scanEveryS);
    // the sight shape is SimTuning['sight'] (canSee reused): same keys as the Hyde's
    expect(Object.keys(T.crackstone.sight).sort()).toEqual(Object.keys(T.sight).sort());
    expect(T.crackstone.speed.CHASE).toBeGreaterThan(T.player.walkSpeed);
  });
});

// ------------------------------------------------------------------------------------------------- perception

describe('Crackstone perception (sight / proximity; deaf)', () => {
  it('sees a standing player in the open → crackstone_sighted {sight} → CHASE (saw_player)', () => {
    const run = crackRun();
    placeC(run, -10, 12, 0, 12);
    place(run, -2, 12);
    const ev = hold(run, 1.5);
    expect(ofType(ev, 'crackstone_sighted')[0]).toMatchObject({ via: 'sight' });
    expect(ofType(ev, 'crackstone_mode').find((e) => e.to === 'CHASE')).toMatchObject({ from: 'PATROL', reason: 'saw_player' });
  });

  it('walls block sight and proximity', () => {
    const run = crackRun();
    placeC(run, 6, 1.0, 6, -6); // facing north at the wall
    place(run, 6, -6);
    expect(ofType(hold(run, 2), 'crackstone_sighted')).toHaveLength(0);
    placeC(run, 6, 0.9, 6, 10); // facing away, the player right behind the wall (1.8 m)
    place(run, 6, -0.9);
    const ev = hold(run, 1.5);
    expect(ofType(ev, 'crackstone_sighted')).toHaveLength(0);
    expect(run.crackstone!.mode).toBe('PATROL');
  });

  it('proximity: a non-hidden player right behind him is sensed (sensed_player), crouching does not help', () => {
    const run = crackRun();
    placeC(run, -6, 12, 6, 12);
    place(run, -8, 12);
    const ev = hold(run, 0.2, { crouch: true });
    expect(ofType(ev, 'crackstone_sighted')[0]).toMatchObject({ via: 'proximity' });
    expect(ofType(ev, 'crackstone_mode')[0]).toMatchObject({ to: 'CHASE', reason: 'sensed_player' });
  });

  it('he is deaf: sprinting footsteps behind him (out of his cone, beyond proximity) never alert him', () => {
    const run = crackRun();
    placeC(run, 0, 12, 10, 12); // facing east
    place(run, -6, 15, Math.PI / 2);
    const ev = hold(run, 1.5, { moveX: 0, moveZ: 0.6, sprint: true });
    expect(ev.some((e) => e.type === 'noise' && e.source === 'footstep')).toBe(true);
    expect(ofType(ev, 'crackstone_sighted')).toHaveLength(0);
    expect(run.crackstone!.suspicion).toBe(0);
  });

  it('a hidden player is not detected by sight, proximity or the scan', () => {
    const run = crackRun();
    place(run, -15, 15);
    hold(run, 0.1, { crouch: true });
    expect(run.player.hidden).toBe(true);
    placeC(run, -15, 12.6, -15, 15); // 2.4 m: within proximityM, beyond the spot's revealM 2, staring at it
    const ev = hold(run, 2, { crouch: true });
    expect(ofType(ev, 'crackstone_sighted')).toHaveLength(0);
    forceScan(run);
    hold(run, 0.05, { crouch: true });
    expect(run.scanExposure()).toBe('covered');
    const scan = until(run, 3, () => run.crackstone!.scan?.phase === 'pulse', { crouch: true });
    expect(ofType(scan, 'crackstone_scan').find((e) => e.phase === 'pulse')).toMatchObject({ hit: false });
    expect(run.crackstone!.mode).not.toBe('CHASE');
  });

  it('crouching shortens his sight (range × crouchRangeMult) but not the scan', () => {
    const run = crackRun();
    placeC(run, -10, 12, 0, 12);
    place(run, 0, 12); // 10 m: > 14 × 0.6 = 8.4 crouched, < 14 standing
    expect(ofType(hold(run, 2, { crouch: true }), 'crackstone_sighted')).toHaveLength(0);
    const r2 = crackRun();
    placeC(r2, -10, 12, 0, 12);
    place(r2, 0, 12);
    expect(ofType(hold(r2, 1.5), 'crackstone_sighted').length).toBeGreaterThan(0);
    // the scan: crouched 6 m BEHIND him (out of his cone) is still hit
    const r3 = crackRun();
    placeC(r3, -4, 12, 10, 12);
    place(r3, -10, 12);
    hold(r3, 0.1, { crouch: true });
    forceScan(r3);
    hold(r3, 0.05, { crouch: true });
    expect(r3.scanExposure()).toBe('exposed');
    const ev = until(r3, 3, () => r3.crackstone!.scan?.phase === 'pulse', { crouch: true });
    expect(ofType(ev, 'crackstone_scan').find((e) => e.phase === 'pulse')).toMatchObject({ hit: true });
    expect(ofType(ev, 'crackstone_sighted').find((e) => e.via === 'scan')).toBeTruthy();
    expect(ofType(ev, 'crackstone_mode').find((e) => e.to === 'CHASE')).toMatchObject({ reason: 'scan_hit' });
  });
});

// ------------------------------------------------------------------------------------------------- scan

describe('Crackstone scan', () => {
  const cases: { name: string; crack: [number, number, number, number]; player: [number, number]; crouch?: boolean; want: 'exposed' | 'covered' | 'out' }[] = [
    { name: 'open, behind him', crack: [-4, 12, 10, 12], player: [-10, 12], want: 'exposed' },
    { name: 'behind the divider wall', crack: [6, 2, 6, 10], player: [6, -4], want: 'covered' },
    { name: 'behind the high pillar', crack: [-10, 4.5, -10, 0.5], player: [-10, 11], want: 'covered' },
    { name: 'outside the ring', crack: [-10, 12, -10, 2], player: [3, 12], want: 'out' },
  ];
  it.each(cases)('warning ≥ 1.8 s before the pulse; scanExposure agrees with the pulse ($name)', (k) => {
    const run = crackRun();
    placeC(run, ...k.crack);
    place(run, ...k.player);
    hold(run, 0.05, { crouch: k.crouch });
    if (run.crackstone!.mode !== 'PATROL') return expect.fail(`detected before the scan: ${run.crackstone!.mode}`);
    forceScan(run);
    let last: string | null = null;
    const ev: StampedEvent[] = [];
    run.setInput(input({ crouch: k.crouch }));
    for (let i = 0; i < 4 * 60 && !ev.some((e) => e.type === 'crackstone_scan' && e.phase === 'pulse'); i++) {
      const exp = run.scanExposure();
      const n = run.log.length;
      run.step();
      ev.push(...run.log.slice(n));
      if (!ev.some((e) => e.type === 'crackstone_scan' && e.phase === 'pulse')) last = exp;
      else if (last === null) last = exp;
    }
    const scans = ofType(ev, 'crackstone_scan');
    const warn = scans.find((e) => e.phase === 'warning')!;
    const pulse = scans.find((e) => e.phase === 'pulse')!;
    expect(warn).toBeTruthy();
    expect(pulse).toBeTruthy();
    expect(pulse.t - warn.t).toBeGreaterThanOrEqual(1.8);
    expect(warn.radiusM).toBe(run.crackstoneBrain!.cfg.scanRadiusM);
    expect(last).toBe(k.want);
    expect(pulse.hit).toBe(last === 'exposed');
  });

  it('scans come on their own every scanEveryS ± jitter while patrolling; he stands still during the warning', () => {
    const run = crackRun({ tuning: tuningFor({ over: { crackstone: { scanEveryS: 6, scanJitterS: 1 } } }) });
    place(run, 15, -15); // far away, north of the wall
    const ev = hold(run, 30);
    const warns = ofType(ev, 'crackstone_scan').filter((e) => e.phase === 'warning');
    expect(warns.length).toBeGreaterThanOrEqual(3);
    for (let i = 1; i < warns.length; i++) expect(warns[i].t - warns[i - 1].t).toBeGreaterThanOrEqual(6 - 1 + 2.2 - 0.05);
    forceScan(run);
    hold(run, 0.1);
    const at = { x: run.crackstone!.x, z: run.crackstone!.z };
    hold(run, 1.5);
    expect(run.crackstone!.scan?.phase).toBe('warning');
    expect(Math.hypot(run.crackstone!.x - at.x, run.crackstone!.z - at.z)).toBeLessThan(1e-9);
    expect(run.boardAllowed()).toBe(false);
  });
});

// ------------------------------------------------------------------------------------------------- curse

/** Puts him 5 m from a standing player in the open; steps until the curse is cast. */
function toCurse(run: MysteryRun): StampedEvent[] {
  placeC(run, -10, 12, 0, 12);
  place(run, -5, 12, -Math.PI / 2); // facing +x (away from him)
  return until(run, 3, () => run.crackstone!.curse !== null);
}

describe('Crackstone curse (ATTACK)', () => {
  it('telegraphed ≥ 1.2 s; standing in it costs curseHp, slows, grants invulnerability — never a catch, never the egg', () => {
    const run = crackRun();
    const pre = toCurse(run);
    const cu = run.crackstone!.curse!;
    expect(cu).toBeTruthy();
    expect(ofType(pre, 'curse')[0]).toMatchObject({ phase: 'cast', hpLost: 0, blocked: false });
    expect(run.crackstone!.mode).toBe('ATTACK');
    expect(cu.landsAt - cu.startedAt).toBeGreaterThanOrEqual(1.2);
    expect(run.curseExposure()).toBe('exposed');
    expect(run.boardAllowed()).toBe(false);
    const egg = { ...run.egg };
    const ev = until(run, 3, () => run.crackstone!.curse === null);
    const hit = ofType(ev, 'curse').find((e) => e.phase === 'hit')!;
    const cfg = run.crackstoneBrain!.cfg;
    expect(hit).toMatchObject({ hpLost: Math.round(cfg.curseHp * run.mods.catchDamageMult), blocked: false });
    expect(Object.keys(hit).sort()).toEqual(['blocked', 'hpLost', 'phase', 'seq', 't', 'type']);
    expect(run.player.hp).toBe(run.player.maxHp - hit.hpLost);
    expect(run.player.catches).toBe(0);
    expect(ev.some((e) => e.type === 'catch')).toBe(false);
    expect(run.egg).toEqual(egg);
    expect(run.effects().cursed).toBe(true);
    expect(run.player.invulnerableUntil).toBeGreaterThanOrEqual(run.t + cfg.curseInvulnerableS - 0.1);
    expect(ofType(ev, 'crackstone_mode').at(-1)).toMatchObject({ from: 'ATTACK', to: 'RETURN', reason: 'curse_done' });
    // slowed: a walk reaches walkSpeed × curseSlowMult
    hold(run, 0.6, { moveZ: 1 });
    expect(run.player.speed).toBeCloseTo(run.tuning.player.walkSpeed * cfg.curseSlowMult, 1);
  });

  it('dodgeable by walking out at the slowest legal walk speed (carrying the egg) after a 0.3 s reaction', () => {
    const T = defaultTuning();
    const slowest = Math.min(...allPairs().map((d) => combineMods(REGISTRIES.nightshades[d.characterId], REGISTRIES.partners[d.pokemonId]).walkSpeedMult));
    const reg = neutralRegistries();
    reg.nightshades.wednesday.mods = { ...reg.nightshades.wednesday.mods, walkSpeedMult: slowest * T.carry.speedMult };
    const run = crackRun({ registries: reg });
    toCurse(run);
    expect(run.crackstone!.curse).not.toBeNull();
    expect(run.tuning.player.walkSpeed * slowest * T.carry.speedMult).toBeGreaterThan(2);
    const ev = [...hold(run, 0.3), ...until(run, 2, () => run.crackstone!.curse === null, { moveZ: 1 })];
    expect(ofType(ev, 'curse').find((e) => e.phase !== 'cast')).toMatchObject({ phase: 'miss', hpLost: 0, blocked: false });
    expect(run.player.hp).toBe(run.player.maxHp);
  });

  it('block_grab (King\'s Shield) blocks the curse: hpLost 0, consumed, no slow', () => {
    const run = crackRun({ duo: { characterId: 'wednesday', pokemonId: 'aegislash' } });
    toCurse(run);
    hold(run, run.tuning.fixedStepS, { move: true });
    expect(run.effects().blockGrab).toBe(true);
    const ev = until(run, 3, () => run.crackstone!.curse === null);
    expect(ofType(ev, 'curse').find((e) => e.phase === 'hit')).toMatchObject({ hpLost: 0, blocked: true });
    expect(run.player.hp).toBe(run.player.maxHp);
    expect(run.effects().blockGrab).toBe(false);
    expect(run.effects().cursed).toBe(false);
  });

  it('a curse at low HP is a DNF (hp_depleted): curse {hit, hpLost = HP actually lost} BEFORE dnf', () => {
    const run = crackRun();
    toCurse(run);
    run.player.hp = 10;
    const ev = until(run, 3, () => run.status !== 'playing');
    expect(run.status).toBe('dnf');
    expect(run.dnfReason).toBe('hp_depleted');
    const hit = ofType(ev, 'curse').find((e) => e.phase === 'hit')!;
    const dnf = ofType(ev, 'dnf')[0];
    expect(hit.hpLost).toBe(10);
    expect(hit.seq).toBeLessThan(dnf.seq);
    expect(run.player.catches).toBe(0);
    expect(ev.at(-1)).toMatchObject({ type: 'dnf', reason: 'hp_depleted', by: 'crackstone' });
    // final: the curse hit is a rule event; the death names him
    expect(ofType(ev, 'enemy_hit')).toEqual([expect.objectContaining({ enemy: 'crackstone', hpLost: 10, blocked: false })]);
    expect(run.result()).toMatchObject({ defeatedBy: 'crackstone', hits: 1, score: null });
    expect(run.death()).toMatchObject({ enemy: 'crackstone', durationS: 4 });
  });

  it('never lands after the deposit (no Crackstone step outside "playing")', () => {
    const run = crackRun();
    toCurse(run);
    run.status = 'accusing';
    const n = run.log.length;
    for (let i = 0; i < 120; i++) run.step();
    expect(run.log.length).toBe(n);
  });
});

// ------------------------------------------------------------------------------------------------- leash / return / R6

describe('Crackstone leash, RETURN, R6', () => {
  it('never chases beyond leashM (SEARCH leash), then SEARCH → RETURN → PATROL once the player is gone', () => {
    const run = crackRun({ tuning: tuningFor({ over: { crackstone: { curseRangeM: 0 } } }) });
    const brain = run.crackstoneBrain!;
    placeC(run, -6, 12, 0, 12);
    place(run, -1, 12, -Math.PI / 2);
    let maxFrom = 0;
    const ev: StampedEvent[] = [];
    run.setInput(input({ moveZ: 1, sprint: true }));
    for (let i = 0; i < 8 * 60; i++) {
      const n = run.log.length;
      run.step();
      ev.push(...run.log.slice(n));
      maxFrom = Math.max(maxFrom, brain.fromCentroid(run.crackstone!));
    }
    expect(ofType(ev, 'crackstone_mode').some((e) => e.to === 'CHASE')).toBe(true);
    expect(ofType(ev, 'crackstone_mode').some((e) => e.from === 'CHASE' && e.to === 'SEARCH' && e.reason === 'leash')).toBe(true);
    expect(maxFrom).toBeLessThanOrEqual(DEF.leashM + 1.5);
    place(run, 15, -15); // gone: north of the wall
    const back = until(run, 40, () => run.crackstone!.mode === 'PATROL');
    const modes = ofType(back, 'crackstone_mode');
    expect(modes.find((e) => e.to === 'RETURN')).toMatchObject({ reason: 'search_timeout' });
    expect(modes.at(-1)).toMatchObject({ from: 'RETURN', to: 'PATROL', reason: 'returned' });
  });

  it('R6: when the Hyde starts a chase he cancels his chase / curse and SEARCHes (deferred); no scan starts', () => {
    const run = crackRun();
    toCurse(run);
    run.hydeBrain.active = true; // an absent Hyde cannot chase; park it far away, frozen
    run.hyde.x = -18;
    run.hyde.z = -18;
    run.hyde.stunnedUntil = 1e9;
    run.hyde.mode = 'CHASE';
    const ev = hold(run, 0.05);
    expect(ofType(ev, 'curse')[0]).toMatchObject({ phase: 'miss' });
    expect(ofType(ev, 'crackstone_mode')[0]).toMatchObject({ from: 'ATTACK', to: 'SEARCH', reason: 'deferred' });
    forceScan(run);
    const more = hold(run, 3);
    expect(ofType(more, 'crackstone_scan')).toHaveLength(0);
    expect(ofType(more, 'crackstone_mode').some((e) => e.to === 'CHASE' || e.to === 'ATTACK')).toBe(false);
  });
});

// ------------------------------------------------------------------------------------------------- long seeded runs

interface Checked { overlaps: number; maxExcessM: number; inWall: number; crackChases: number; deferrals: number; steps: number }

/** playEpisode's loop with per-step invariant checks (bots play from public information). */
function playChecked(duo: Duo, seed: string, caseId: CaseId, profile: 'stealthy' | 'careless', acc: Checked): void {
  const run = new MysteryRun({ duo, seed, caseDef: CASES[caseId], tutorial: false });
  const bot = new Bot(run, { profile, useAbilities: true, startDelayMaxS: 0, maxTimeS: 400 }, seed);
  const dt = run.tuning.fixedStepS;
  const c = run.crackstone!;
  const r = run.crackstoneBrain!.cfg.radius;
  const maxSpeed = Math.max(...Object.values(run.crackstoneBrain!.cfg.speed));
  let px = c.x;
  let pz = c.z;
  let step = 0;
  let inp = bot.decide();
  while (run.status === 'playing' && run.t < bot.o.maxTimeS) {
    if (step % 6 === 0) {
      inp = bot.decide();
      run.applyLook(inp);
      run.setInput(inp);
    }
    const before = run.log.length;
    run.step(dt);
    inp = { ...inp, interact: false, power: false, move: false, hint: false };
    run.setInput(inp);
    step++;
    acc.steps++;
    // final: ≤ 1 engaged hunter among all three (generalised R6)
    const engaged = [run.hydeBrain.engaged(), run.crackstoneBrain!.engaged(), run.slurpBrain?.engaged() ?? false].filter(Boolean).length;
    if (engaged > 1) acc.overlaps++;
    // a director (re)spawn places him; everything else is walking
    const spawned = run.log.slice(before).some((e) => e.type === 'enemy_spawned' && e.enemy === 'crackstone');
    if (!spawned) acc.maxExcessM = Math.max(acc.maxExcessM, Math.hypot(c.x - px, c.z - pz) - maxSpeed * dt);
    if (run.crackstoneBrain!.active && !run.world.isFree(c.x, c.z, r * 0.9)) acc.inWall++;
    px = c.x;
    pz = c.z;
  }
  acc.crackChases += run.log.filter((e) => e.type === 'crackstone_mode' && e.to === 'CHASE').length;
  acc.deferrals += run.log.filter((e) => e.type === 'crackstone_mode' && e.reason === 'deferred').length;
}

describe('Crackstone over long seeded runs (bots, all three cases)', () => {
  it('≤ 1 engaged hunter (R6 generalised); never inside a wall; per-step displacement ≤ CHASE speed × dt except director spawns', () => {
    const acc: Checked = { overlaps: 0, maxExcessM: 0, inWall: 0, crackChases: 0, deferrals: 0, steps: 0 };
    const pairs = allPairs();
    for (const caseId of CASE_IDS) {
      for (let i = 0; i < 8; i++) {
        playChecked(pairs[(i * 17) % pairs.length], `r6-${caseId}-${i}`, caseId, i % 2 ? 'careless' : 'stealthy', acc);
      }
    }
    expect(acc.steps).toBeGreaterThan(100_000);
    expect(acc.crackChases).toBeGreaterThan(5);
    expect(acc.overlaps).toBe(0);
    expect(acc.inWall).toBe(0);
    expect(acc.maxExcessM).toBeLessThanOrEqual(1e-3); // ε: collision slide / depenetration rounding
  }, 120_000);

  it('deterministic: same duo + seed → identical log with Crackstone events', () => {
    const a = playEpisode({ characterId: 'enid', pokemonId: 'gengar' }, 'crack-det', { profile: 'careless' }, { caseDef: CASES.poisoned_archive });
    const b = playEpisode({ characterId: 'enid', pokemonId: 'gengar' }, 'crack-det', { profile: 'careless' }, { caseDef: CASES.poisoned_archive });
    expect(JSON.stringify(a.events)).toBe(JSON.stringify(b.events));
    expect(a.snapshots).toEqual(b.snapshots);
    expect(a.events.some((e) => e.type === 'crackstone_mode' || e.type === 'crackstone_scan')).toBe(true);
  });

  it('maps WITHOUT Crackstone produce byte-identical logs to before he existed (hashes captured pre-change; final-only events stripped)', () => {
    // Fixture maps have no encounterSpawns / Slurp / cabinets: the final wave may only ADD rule events there.
    // (The case maps changed with the compact play areas, Slurp and the director: their pins live in finalRegression.test.ts.)
    const pinned: Record<string, string> = {
      'fixture:wednesday+gengar:stealthy': '380cc01f69e24dc7',
      'world:wednesday+gengar:stealthy': '44f8b1da9cba8032',
      'fixture:wednesday+gengar:careless': 'aced2ae111fab853',
      'world:wednesday+gengar:careless': 'db0b4975102316de',
      'fixture:gomez+dusknoir:stealthy': '5b679a394cd28fea',
      'world:gomez+dusknoir:stealthy': '8a354b4459ab879e',
      'fixture:gomez+dusknoir:careless': '4c2956a5ec3ad4b7',
      'world:gomez+dusknoir:careless': '926d4353680b848d',
      'fixture:bianca+froslass:stealthy': '59a1b9f7969e86a6',
      'world:bianca+froslass:stealthy': 'f791c795213153e5',
      'fixture:bianca+froslass:careless': '788df1d0267c9580',
      'world:bianca+froslass:careless': '72570867c13bdcbf',
      'fixture:ajax+aegislash:stealthy': '41d222bcdcdc5ad7',
      'world:ajax+aegislash:stealthy': '5a0414b354ff8b85',
      'fixture:ajax+aegislash:careless': 'dbba539578bdecfe',
      'world:ajax+aegislash:careless': '64bec136c6b47523',
      'case:poisoned_archive:wednesday+gengar': '07001ee86897cf01',
      'case:poisoned_archive:gomez+dusknoir': '3e2e980e3ddd6119',
      'case:crypt_last_witness:wednesday+gengar': '87d89d3332641b38',
      'case:crypt_last_witness:gomez+dusknoir': '893c1a1fcc00bab4',
      'case:midnight_signal:wednesday+gengar': 'c0073d5d3879acc6',
      'case:midnight_signal:gomez+dusknoir': 'd68a36e7c13339ba',
    };
    const fixtures = Object.fromEntries(Object.entries(pinned).filter(([k]) => !k.startsWith('case:')));
    expect(regressionHashes(preFinalView, false)).toEqual(fixtures);
  }, 60_000);
});

// ------------------------------------------------------------------------------------------------- abilities

function press(run: MysteryRun, key: 'F' | 'Q'): StampedEvent[] {
  return hold(run, run.tuning.fixedStepS, key === 'F' ? { power: true } : { move: true });
}

/** Player at (0, 12) facing east; Crackstone `d` m ahead, facing the player. */
function facing(duo: Duo, d = 6): MysteryRun {
  const run = crackRun({ duo, registries: neutralRegistries() });
  place(run, 0, 12, -Math.PI / 2);
  placeC(run, d, 12, 0, 12);
  run.crackstoneBrain!.c.suspicion = 0;
  return run;
}

describe('abilities on Crackstone (R8)', () => {
  it('Gorgon Gaze petrifies him ("Crackstone petrified 2.5 s")', () => {
    const run = facing({ characterId: 'ajax', pokemonId: 'aegislash' });
    const used = ofType(press(run, 'F'), 'ability_used')[0];
    expect(used).toMatchObject({ abilityId: REGISTRIES.nightshades.ajax.power.id, success: true, detail: 'Crackstone petrified 2.5 s' });
    expect(run.effects()).toMatchObject({ crackstoneStunned: true, crackstonePetrified: true, hydePetrified: false, hydeStunned: false });
    expect(run.crackstoneVisual()).toBe('petrify');
    expect(run.hydeVisual()).toBeNull();
  });

  it('a stun hits every enemy passing targeting: "Hyde and Crackstone petrified 2.5 s"; diminishing per enemy', () => {
    const run = facing({ characterId: 'ajax', pokemonId: 'aegislash' }, 6);
    run.emergeHyde();
    placeHyde(run, 5, 13, Math.PI / 2);
    expect(ofType(press(run, 'F'), 'ability_used')[0].detail).toBe('Hyde and Crackstone petrified 2.5 s');
    expect(run.effects()).toMatchObject({ hydePetrified: true, crackstonePetrified: true });
    // the Hyde was stunned before, Crackstone not: only the Hyde's second stun is diminished
    const r2 = facing({ characterId: 'ajax', pokemonId: 'aegislash' }, 6);
    r2.emergeHyde();
    placeHyde(r2, 5, 13, Math.PI / 2);
    r2.hydeBrain.lastStunEnd = r2.t - 1;
    expect(ofType(press(r2, 'F'), 'ability_used')[0].detail).toBe('Hyde petrified 1.3 s (diminished), Crackstone petrified 2.5 s');
  });

  it('Electric Spark without a switch in reach falls back to a stun on him', () => {
    const run = facing({ characterId: 'gomez', pokemonId: 'aegislash' }, 5);
    const used = ofType(press(run, 'F'), 'ability_used')[0];
    expect(used.detail).toBe('Crackstone stunned 2.0 s'); // the switch is out of reach: the fallback stun applies
    expect(run.effects().crackstoneStunned).toBe(true);
  });

  it('a stun during the curse wind-up cancels it (curse {miss}) and he SEARCHes (stunned)', () => {
    const run = crackRun({ duo: { characterId: 'ajax', pokemonId: 'aegislash' }, registries: neutralRegistries() });
    placeC(run, -10, 12, 0, 12);
    place(run, -5, 12, Math.PI / 2); // facing him (west)
    until(run, 3, () => run.crackstone!.curse !== null);
    const ev = press(run, 'F');
    expect(ofType(ev, 'curse')[0]).toMatchObject({ phase: 'miss', hpLost: 0 });
    expect(ofType(ev, 'crackstone_mode')[0]).toMatchObject({ from: 'ATTACK', to: 'SEARCH', reason: 'stunned' });
    expect(run.crackstone!.curse).toBeNull();
  });

  it('Bee Swarm distracts him and reveals enemies within its range', () => {
    const run = facing({ characterId: 'eugene', pokemonId: 'aegislash' }, 6);
    const used = ofType(press(run, 'F'), 'ability_used')[0];
    expect(used.detail).toContain('Crackstone distracted 5.0 s');
    expect(run.effects()).toMatchObject({ crackstoneDistracted: true, enemiesRevealed: true, enemyRevealRangeM: 15 });
  });

  it('Psychic Vision reveals enemies (scouting) for its duration', () => {
    const run = facing({ characterId: 'wednesday', pokemonId: 'aegislash' }, 6);
    press(run, 'F');
    expect(run.effects()).toMatchObject({ enemiesRevealed: true, enemyRevealRangeM: 35 });
    hold(run, 6.2);
    expect(run.effects()).toMatchObject({ enemiesRevealed: false, enemyRevealRangeM: 0 });
  });

  it('Siren Call lures him when the decoy is within lureRangeM; out of range (and no Hyde) → no_target', () => {
    const run = facing({ characterId: 'bianca', pokemonId: 'aegislash' }, 6);
    const ev = press(run, 'F');
    expect(ofType(ev, 'ability_used')[0].detail).toMatch(/^Crackstone lured /);
    expect(ofType(ev, 'crackstone_mode')[0]).toMatchObject({ to: 'INVESTIGATE', reason: 'lured' });
    expect(run.effects().lurePoint).not.toBeNull();
    const far = crackRun({ duo: { characterId: 'bianca', pokemonId: 'aegislash' }, registries: neutralRegistries() });
    place(far, 15, 3, -Math.PI / 2);
    placeC(far, -17, 18, -17, 10);
    const ev2 = press(far, 'F');
    expect(ofType(ev2, 'ability_denied')[0]).toMatchObject({ reason: 'no_target' });
    expect(far.powerStatus().ready).toBe(true);
  });

  it('Premonition shows his predicted path', () => {
    const run = facing({ characterId: 'morticia', pokemonId: 'aegislash' }, 10);
    run.crackstoneBrain!.c.mode = 'PATROL';
    const used = ofType(press(run, 'F'), 'ability_used')[0];
    expect(used.detail).toBe('Crackstone path foreseen 6 s ahead');
    expect(run.effects().crackstonePremonitionPath?.length ?? 0).toBeGreaterThanOrEqual(1);
    expect(run.effects().premonitionPath).toBeNull();
  });

  it('no_target only when no enemy qualifies (him behind the player, the Hyde not hunting)', () => {
    const run = crackRun({ duo: { characterId: 'ajax', pokemonId: 'aegislash' }, registries: neutralRegistries() });
    place(run, 0, 12, -Math.PI / 2); // facing east
    placeC(run, -8, 12, -12, 12); // west, behind the player, facing away
    const ev = press(run, 'F');
    expect(ofType(ev, 'ability_denied')[0]).toMatchObject({ reason: 'no_target' });
    expect(ofType(ev, 'ability_used')).toHaveLength(0);
    expect(run.powerStatus().ready).toBe(true);
  });

  it('source scan: abilities.ts and crackstone.ts never branch on character / Pokémon ids', () => {
    const ids = [...NIGHTSHADE_IDS, ...POKEMON_IDS, ...POKEMON_IDS.map((p) => p.replace(/_/g, ' '))];
    const re = new RegExp(`\\b(${ids.join('|')})\\b`, 'i');
    for (const f of ['abilities.ts', 'crackstone.ts', 'enemyNav.ts']) {
      const text = readFileSync(join(__dirname, '../../../src/mystery', f), 'utf8');
      const m = re.exec(text);
      expect(m, `${f} mentions "${m?.[0]}"`).toBeNull();
      expect(/\b(characterId|pokemonId)\s*===/.test(text), `${f} compares a duo id`).toBe(false);
    }
  });
});

// ------------------------------------------------------------------------------------------------- run API

describe('MysteryRun Crackstone API', () => {
  it('fixtures without him: null runtime, absent snapshot / effects / bearing, helpers null', () => {
    const run = worldRun();
    expect(run.crackstone).toBeNull();
    expect(run.crackstoneBrain).toBeNull();
    expect(run.crackstoneDef).toBeNull();
    expect(run.crackstonePresent).toBe(false);
    expect(run.crackstoneVisible()).toBe(false);
    expect(run.crackstoneBearing()).toEqual({ angle: 0, distanceM: 999 });
    expect(run.scanExposure()).toBeNull();
    expect(run.curseExposure()).toBeNull();
    expect(run.crackstoneVisual()).toBeNull();
    expect(run.snapshot()).toMatchObject({ crackstonePresent: false, crackstoneMode: 'PATROL', crackstoneDistanceM: 999, crackstoneOccluded: true, crackstoneVisible: false, crackstoneSuspicion: 0 });
    expect(run.effects()).toMatchObject({ crackstoneStunned: false, crackstonePremonitionPath: null, enemiesRevealed: false, cursed: false });
    expect(run.investigation().lastCrackstoneSighting).toBeNull();
  });

  it('case maps (director): absent until his first spawn; then visible / sighting / bearing / snapshot', () => {
    const run = new MysteryRun({ duo: { characterId: 'enid', pokemonId: 'gengar' }, seed: 's1', caseDef: CASES.poisoned_archive });
    expect(run.crackstonePresent).toBe(true);
    expect(run.crackstoneBrain!.active).toBe(false);
    expect(run.enemyStatus().crackstone).toMatchObject({ present: true, active: false, phase: 'inactive', arrivesInS: run.tuning.director.firstSpawnS.crackstone });
    expect(run.snapshot()).toMatchObject({ crackstonePresent: true, crackstoneActive: false, crackstoneDistanceM: 999 });
    const sp = encounterSpawnsFor(run.map.world!, 'crackstone')[0];
    run.director.spawnAt(run, 'crackstone', sp);
    expect(run.crackstoneBrain!.active).toBe(true);
    expect(Math.hypot(run.crackstone!.x - sp.x, run.crackstone!.z - sp.z)).toBeLessThan(0.75);
    expect(run.snapshot()).toMatchObject({ crackstonePresent: true, crackstoneActive: true });
    // stand 8 m from him with a clear line → visible, sighting recorded
    const c = run.crackstone!;
    place(run, c.x + 8, c.z);
    if (!run.world.lineOfSight(run.player.x, run.player.z, c.x, c.z)) place(run, c.x - 8, c.z);
    if (!run.world.lineOfSight(run.player.x, run.player.z, c.x, c.z)) place(run, c.x, c.z + 8);
    if (!run.world.lineOfSight(run.player.x, run.player.z, c.x, c.z)) place(run, c.x, c.z - 8);
    hold(run, run.tuning.fixedStepS);
    expect(run.crackstoneVisible()).toBe(true);
    expect(run.snapshot().crackstoneVisible).toBe(true);
    expect(run.investigation().lastCrackstoneSighting).toMatchObject({ x: expect.any(Number), z: expect.any(Number) });
  });

  it('tutorial: he is inactive (no events, no movement); after endTutorial the director brings him at firstSpawnS', () => {
    const run = new MysteryRun({ duo: { characterId: 'enid', pokemonId: 'gengar' }, seed: 's1', caseDef: CASES.crypt_last_witness, tutorial: true });
    for (let i = 0; i < 120; i++) run.update(1 / 30, input({ moveZ: 1 }));
    expect(run.crackstoneBrain!.active).toBe(false);
    expect(run.crackstoneVisible()).toBe(false);
    run.endTutorial();
    expect(run.crackstoneBrain!.active).toBe(false);
    const ev: StampedEvent[] = [];
    for (let i = 0; i < 600 && !run.crackstoneBrain!.active; i++) ev.push(...run.update(0.1, input()));
    const spawned = ev.find((e) => e.type === 'enemy_spawned' && e.enemy === 'crackstone');
    expect(spawned).toBeTruthy();
    expect(spawned!.t).toBeGreaterThanOrEqual(run.tuning.director.firstSpawnS.crackstone - 1e-6);
  });

  it('Hyde-grab release prefers safe points away from him (≥ releaseMinDistM) when one exists', () => {
    const run = new MysteryRun({ duo: { characterId: 'enid', pokemonId: 'gengar' }, seed: 's1', caseDef: CASES.midnight_signal });
    run.director.spawnAt(run, 'crackstone', encounterSpawnsFor(run.map.world!, 'crackstone')[0]);
    run.emergeHyde();
    const pts = run.map.safeReleasePoints;
    const near = pts[0];
    place(run, near.x, near.z + 1); // grabbed right next to a release point
    placeHyde(run, near.x + 25, near.z + 25, 0);
    run.hyde.x = run.map.tower.x;
    run.hyde.z = run.map.tower.z;
    run.crackstone!.x = near.x - 2;
    run.crackstone!.z = near.z;
    (run as unknown as { onCatch(): void }).onCatch();
    expect(run.player.catches).toBe(1);
    const far = pts.filter((q) => Math.hypot(q.x - run.crackstone!.x, q.z - run.crackstone!.z) >= run.crackstoneBrain!.cfg.releaseMinDistM);
    if (far.length > 0) expect(Math.hypot(run.player.x - run.crackstone!.x, run.player.z - run.crackstone!.z)).toBeGreaterThanOrEqual(run.crackstoneBrain!.cfg.releaseMinDistM - 1);
  });

  it('boardAllowed is false while he chases', () => {
    const run = crackRun();
    expect(run.boardAllowed()).toBe(true);
    placeC(run, -10, 12, 0, 12);
    place(run, -2, 12);
    until(run, 2, () => run.crackstone!.mode === 'CHASE');
    expect(run.crackstone!.mode).toBe('CHASE');
    expect(run.boardAllowed()).toBe(false);
  });
});
