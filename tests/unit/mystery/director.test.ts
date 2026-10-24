// Encounter director (FINAL_CONTRACT §4): the pure spawn distribution, and the lifecycle through MysteryRun —
// schedule, caps, ≤ 1 engaged hunter, despawn rules + hysteresis, respawn cooldown, nothing on the player reset.
import { describe, expect, it } from 'vitest';
import { encounterSpawnDistribution, encounterSpawnsFor, spawnRulesFrom, type DirectorState } from '../../../src/mystery/director.ts';
import { withTuning } from '../../../src/mystery/config.ts';
import { Bot } from '../../../src/mystery/bot.ts';
import { CASES } from '../../../src/mystery/data/cases.ts';
import { allPairs } from '../../../src/mystery/draft.ts';
import { MysteryRun } from '../../../src/mystery/run.ts';
import { CASE_IDS } from '../../../src/mystery/types.ts';
import type { StampedEvent } from '../../../src/mystery/types.ts';
import { hold, place } from './helpers.ts';
import { FINAL_TUNING, finalMap, finalRun } from './finalFixture.ts';

const world = finalMap().world!;
const rules = spawnRulesFrom(FINAL_TUNING.director, FINAL_TUNING.sight.playerSeesHydeM);
const noWalls = () => true;
const walls = () => false;

function state(o: Partial<DirectorState> = {}): DirectorState {
  return { player: { x: 0, z: 17, yaw: 0 }, t: 100, objective: null, recent: [], lineOfSight: walls, rules, ...o };
}

const ofType = <T extends StampedEvent['type']>(ev: StampedEvent[], type: T) => ev.filter((e): e is Extract<StampedEvent, { type: T }> => e.type === type);

describe('encounterSpawnDistribution (pure, exact)', () => {
  it('eligible spawns share w / Σw; probabilities sum to 1', () => {
    // player at (0, 17) facing south (+Z, yaw π): every Hyde spawn is ≥ 15 m away, behind the player, no LOS
    const d = encounterSpawnDistribution(world, 'hyde', state({ player: { x: 0, z: 17, yaw: Math.PI } }));
    expect(d.map((r) => r.spawnId)).toEqual(['h_n', 'h_w', 'h_e']);
    expect(d.map((r) => r.p)).toEqual([0.5, 0.25, 0.25]);
    expect(d.every((r) => r.eligible && r.blocked === null)).toBe(true);
  });

  it('too close (< minSpawnM), inside the forward ±60° cone within 35 m, or visible (LOS ≤ playerSeesHydeM) → 0', () => {
    const near = encounterSpawnDistribution(world, 'hyde', state({ player: { x: 0, z: -5, yaw: Math.PI } }));
    expect(near.find((r) => r.spawnId === 'h_n')).toMatchObject({ p: 0, blocked: 'too_close', eligible: false });
    // facing north (yaw 0 → −Z): h_n straight ahead 29 m away → in view even behind walls
    const ahead = encounterSpawnDistribution(world, 'hyde', state({ player: { x: 0, z: 17, yaw: 0 } }));
    expect(ahead.find((r) => r.spawnId === 'h_n')).toMatchObject({ p: 0, blocked: 'in_view' });
    // facing away but with a clear line ≤ 18 m: visible
    const seen = encounterSpawnDistribution(world, 'hyde', state({ player: { x: 16, z: 10, yaw: 0 + Math.PI }, lineOfSight: noWalls }));
    expect(seen.find((r) => r.spawnId === 'h_e')).toMatchObject({ p: 0, blocked: 'visible' });
    expect(seen.reduce((a, r) => a + r.p, 0)).toBeCloseTo(1, 12);
  });

  it('objective zone × objectiveMult, recently used × recentMult; nothing eligible → every p is 0', () => {
    const sNear = { x: 0, z: 17, yaw: Math.PI };
    const zN = world.zones.find((z) => z.id === 'z_n')!;
    expect(zN).toBeDefined();
    const obj = encounterSpawnDistribution(world, 'hyde', state({ player: sNear, objective: { x: 0, z: -17 } }));
    expect(obj.map((r) => r.weight)).toEqual([3, 1.5, 1.5]); // all three spawns sit in z_n
    const rec = encounterSpawnDistribution(world, 'hyde', state({ player: sNear, recent: [{ spawnId: 'h_n', t: 70 }] }));
    expect(rec.map((r) => Math.round(r.weight * 1000) / 1000)).toEqual([0.6, 1, 1]);
    expect(rec[0].p).toBeCloseTo(0.6 / 2.6, 12);
    const old = encounterSpawnDistribution(world, 'hyde', state({ player: sNear, recent: [{ spawnId: 'h_n', t: 30 }] }));
    expect(old[0].weight).toBe(2); // older than recentSpawnS
    const none = encounterSpawnDistribution(world, 'hyde', state({ player: sNear, rules: { ...rules, minSpawnM: 500 } }));
    expect(none.every((r) => r.p === 0 && !r.eligible)).toBe(true);
  });

  it('fallback spawns: the Hyde → hydeSpawns, Slurp → his wander points', () => {
    const bare = { ...world, encounterSpawns: [] };
    expect(encounterSpawnsFor(bare, 'hyde').map((s) => s.id)).toEqual(world.hydeSpawns.map((s) => s.id));
    expect(encounterSpawnsFor(bare, 'slurp')).toHaveLength(4);
    expect(encounterSpawnsFor(bare, 'crackstone')).toEqual([]);
  });

  it('run.encounterDistribution matches the pure function on run.directorState()', () => {
    const run = finalRun();
    expect(run.encounterDistribution('slurp')).toEqual(encounterSpawnDistribution(run.map.world!, 'slurp', run.directorState()));
    expect(run.encounterDistribution('crackstone')).toEqual([]);
  });
});

describe('director lifecycle through MysteryRun', () => {
  it('first appearances on schedule: Hyde at emergeAfterS (hyde_emerged + enemy_spawned), Slurp at firstSpawnS', () => {
    const run = finalRun();
    place(run, 0, 17, Math.PI); // face south: the north spawns stay out of view
    expect(run.enemyStatus().hyde).toMatchObject({ present: true, active: false, phase: 'inactive', arrivesInS: 20 });
    expect(run.enemyStatus().crackstone).toMatchObject({ present: false });
    const ev = hold(run, 26, { lookYawDelta: 0 });
    const spawned = ofType(ev, 'enemy_spawned');
    expect(spawned.map((e) => e.enemy)).toEqual(['hyde', 'slurp']);
    expect(spawned[0].t).toBeCloseTo(20, 1);
    expect(spawned[1].t).toBeCloseTo(25, 1);
    expect(ofType(ev, 'hyde_emerged')).toHaveLength(1);
    expect(run.hydeEmerged).toBe(true);
    expect(run.hydeActive).toBe(true);
    expect(run.slurp!.active).toBe(true);
    expect(run.snapshot()).toMatchObject({ hydeActive: true, slurpPresent: true, slurpActive: true });
  });

  it('no eligible spawn → waits (retry), never forced', () => {
    const tuning = withTuning({ director: { minSpawnM: 500 } }, FINAL_TUNING);
    const run = finalRun({ tuning });
    const ev = hold(run, 40);
    expect(ofType(ev, 'enemy_spawned')).toHaveLength(0);
    expect(run.enemyStatus().hyde.arrivesInS).toBeLessThanOrEqual(2);
  });

  it('caps: never more than maxActive hostiles', () => {
    const tuning = withTuning({ director: { maxActive: 1 } }, FINAL_TUNING);
    const run = finalRun({ tuning });
    place(run, 0, 17, Math.PI);
    hold(run, 30);
    expect([run.hydeActive, run.slurp!.active].filter(Boolean)).toHaveLength(1);
  });

  it('despawn: calm, far, out of sight ≥ 4 s, alive ≥ minActiveS → enemy_despawned {far}; respawn only after the cooldown; HP / catches / cooldowns untouched', () => {
    const tuning = withTuning({ director: { firstSpawnS: { hyde: 1, slurp: 9999 }, minActiveS: 12, respawnCooldownS: { hyde: 15 } } }, FINAL_TUNING);
    const run = finalRun({ tuning, slurp: false });
    place(run, 0, 17, Math.PI);
    run.player.hp = 77;
    run.power.readyAt = 500;
    const ev = hold(run, 40, { crouch: true }); // crouched, behind the divider wall: never seen
    const desp = ofType(ev, 'enemy_despawned');
    expect(desp.length).toBeGreaterThanOrEqual(1);
    const spawnT = ofType(ev, 'enemy_spawned')[0].t;
    expect(desp[0].t - spawnT).toBeGreaterThanOrEqual(10); // hysteresis
    expect(['far', 'cycle_done']).toContain(desp[0].reason);
    expect(run.player.hp).toBe(77);
    expect(run.player.catches).toBe(0);
    expect(run.power.readyAt).toBe(500);
    const respawn = ofType(ev, 'enemy_spawned').filter((e) => e.t > desp[0].t);
    for (const r of respawn) expect(r.t - desp[0].t).toBeGreaterThanOrEqual(15 - 1e-6);
    // the Hyde's later spawns are plain enemy_spawned (one hyde_emerged per run)
    expect(ofType(run.log, 'hyde_emerged')).toHaveLength(1);
  });

  it('a chasing enemy is never despawned; ≤ 1 engaged: Slurp defers while the Hyde chases', () => {
    const run = finalRun();
    place(run, 0, 17, Math.PI);
    hold(run, 26);
    // force a Hyde chase and put Slurp right next to the player, looking at them
    run.hyde.mode = 'CHASE';
    run.hyde.x = -10;
    run.hyde.z = 15;
    run.hyde.stunnedUntil = 1e9; // frozen in CHASE
    run.slurp!.x = 0;
    run.slurp!.z = 14;
    run.slurp!.yaw = Math.PI; // faces +Z (the player)
    const ev = hold(run, 2);
    expect(ofType(ev, 'slurp_mode').some((e) => e.to === 'CHASE')).toBe(false);
    expect(ofType(ev, 'enemy_despawned').filter((e) => e.enemy === 'hyde')).toHaveLength(0);
  });

  it('enemyStatus / weemsStatus / tutorial', () => {
    const run = finalRun({ tutorial: true });
    expect(run.enemyStatus().slurp).toMatchObject({ present: true, active: false, arrivesInS: 25 });
    expect(run.weemsStatus()).toMatchObject({ reason: 'tutorial', available: false });
    hold(run, 30);
    expect(ofType(run.log, 'enemy_spawned')).toHaveLength(0); // nothing spawns in the tutorial
    run.endTutorial();
    expect(run.weemsStatus()).toMatchObject({ reason: 'ready', available: true, used: 0, nextLevel: 1 });
  });
});

describe('fairness: no unavoidable encounters (seeded sweep)', () => {
  it('across seeds: every spawn ≥ minSpawnM from the player and out of view; never two engaged hunters', () => {
    const tuning = withTuning({ director: { minActiveS: 15, respawnCooldownS: { hyde: 8, slurp: 8 } } }, FINAL_TUNING);
    let spawns = 0;
    let engagedSteps = 0;
    for (let i = 0; i < 12; i++) {
      const run = finalRun({ tuning, seed: `fair-${i}` });
      const dt = run.tuning.fixedStepS;
      let k = 0;
      while (run.status === 'playing' && run.t < 120) {
        // wander: turn slowly, walk forward in bursts
        run.setInput({ moveX: 0, moveZ: (k % 600) < 300 ? 1 : 0, lookYawDelta: 0.01, lookPitchDelta: 0, sprint: (k % 900) < 120, crouch: false, interact: false, power: false, move: false, hint: false });
        run.applyLook({ lookYawDelta: 0.01, lookPitchDelta: 0 });
        const before = run.log.length;
        const state = run.directorState();
        run.step(dt);
        for (const e of run.log.slice(before)) {
          if (e.type !== 'enemy_spawned') continue;
          spawns++;
          const sp = encounterSpawnsFor(run.map.world!, e.enemy).find((s) => s.id === e.spawnId)!;
          const p = state.player;
          const d = Math.hypot(sp.x - p.x, sp.z - p.z);
          expect(d, `${run.seed} ${e.spawnId}`).toBeGreaterThanOrEqual(run.tuning.director.minSpawnM);
          expect(encounterSpawnDistribution(run.map.world!, e.enemy, state).find((r) => r.spawnId === e.spawnId)!.eligible).toBe(true);
        }
        const engaged = [run.hydeBrain.engaged(), run.slurpBrain!.engaged()].filter(Boolean).length;
        expect(engaged, `${run.seed} t=${run.t}`).toBeLessThanOrEqual(1);
        if (engaged) engagedSteps++;
        k++;
      }
    }
    console.log(`fairness sweep: ${spawns} spawns, ${engagedSteps} engaged steps`);
    expect(spawns).toBeGreaterThanOrEqual(24);
    expect(engagedSteps).toBeGreaterThan(0);
  }, 120_000);
});

describe('fairness on the real compact case maps (bot-driven)', () => {
  it('3 cases × 8 duos: every spawn eligible (≥ minSpawnM, out of view) at its step; ≤ 1 engaged hunter at every step', () => {
    let spawns = 0;
    for (const caseId of CASE_IDS) {
      const pairs = allPairs().filter((_, i) => i % 16 === 0);
      for (const [i, duo] of pairs.entries()) {
        const seed = `fair-${caseId}-${i}`;
        const run = new MysteryRun({ duo, seed, caseDef: CASES[caseId], tutorial: false });
        const bot = new Bot(run, { profile: i % 2 ? 'careless' : 'stealthy', useAbilities: true, startDelayMaxS: 0, maxTimeS: 400 }, seed);
        const dt = run.tuning.fixedStepS;
        let step = 0;
        let inp = bot.decide();
        while (run.status === 'playing' && run.t < 400) {
          if (step % 6 === 0) {
            inp = bot.decide();
            run.applyLook(inp);
            run.setInput(inp);
          }
          const before = run.log.length;
          const state = run.directorState();
          run.step(dt);
          inp = { ...inp, interact: false, power: false, move: false, hint: false };
          run.setInput(inp);
          step++;
          for (const e of run.log.slice(before)) {
            if (e.type !== 'enemy_spawned') continue;
            spawns++;
            const row = encounterSpawnDistribution(run.map.world!, e.enemy, state).find((r) => r.spawnId === e.spawnId)!;
            expect(row.eligible, `${seed} ${e.spawnId} ${row.blocked}`).toBe(true);
          }
          const engaged = [run.hydeBrain.engaged(), run.crackstoneBrain?.engaged() ?? false, run.slurpBrain?.engaged() ?? false].filter(Boolean).length;
          expect(engaged, `${seed} t=${run.t.toFixed(1)}`).toBeLessThanOrEqual(1);
        }
      }
    }
    expect(spawns).toBeGreaterThan(24);
  }, 240_000);
});

