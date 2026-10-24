// Hyde spawn odds + zone filter (src/mystery/analytics/hydeZones.ts): the spawn rule equals the sim's
// (layout.ts spawnDistribution) everywhere, the patrol chain's stationary distribution is the patrol occupancy, prediction
// keeps a probability vector, observations update by Bayes (collapse on sight, β in the player's zone), and the
// tracker starts from the spawn odds at emergence.
import { describe, expect, it } from 'vitest';
import {
  buildZoneModel, observationLikelihood, observeZones, patrolZoneRuns, predictZones, spawnProbabilities, spawnZoneDistribution,
  zoneAdjacency, zoneIndexAt, zoneScores, ZONE_FILTER_DEFAULTS, ZoneTracker,
} from '../../../src/mystery/analytics/hydeZones.ts';
import { zoneParamsFrom } from '../../../src/mystery/analytics/live.ts';
import { caseMap } from '../../../src/mystery/defaults.ts';
import { spawnDistribution } from '../../../src/mystery/layout.ts';
import { DEFAULT_TUNING } from '../../../src/mystery/config.ts';
import { CASE_IDS, type CaseWorldDef, type HydeSpawnDef, type Vec2, type ZoneDef } from '../../../src/mystery/types.ts';

const rect = (minX: number, minZ: number, maxX: number, maxZ: number): Vec2[] => [
  { x: minX, z: minZ }, { x: minX, z: maxZ }, { x: maxX, z: maxZ }, { x: maxX, z: minZ },
];
const ZONES: ZoneDef[] = [
  { id: 'w', name: 'West', polygon: rect(-30, -10, -10, 10) },
  { id: 'm', name: 'Middle', polygon: rect(-10, -10, 10, 10) },
  { id: 'e', name: 'East', polygon: rect(10, -10, 30, 10) },
  { id: 'n', name: 'North', polygon: rect(-30, 10, 30, 30) }, // the loop never enters it
];
const LOOP: Vec2[] = [{ x: -20, z: 0 }, { x: 20, z: 0 }]; // out and back: W → M → E → M → W
const SPAWNS: HydeSpawnDef[] = [
  { id: 's1', name: 'One', zoneId: 'w', x: -20, z: 0, yaw: 0, weight: 0.5 },
  { id: 's2', name: 'Two', zoneId: 'e', x: 20, z: 0, yaw: 0, weight: 0.3 },
  { id: 's3', name: 'Three', zoneId: 'n', x: 0, z: 20, yaw: 0, weight: 0.2 },
];
const WORLD = { hydeSpawns: SPAWNS, zones: ZONES } as Pick<CaseWorldDef, 'hydeSpawns' | 'zones'>;

describe('spawn odds before emergence (exact rule)', () => {
  it('renormalises the weights of spawns ≥ minSpawnM away; none valid → the farthest gets 1', () => {
    const far = spawnProbabilities(WORLD, { x: 0, z: -200 }, 25);
    expect(far.map((s) => s.p)).toEqual([0.5, 0.3, 0.2].map((x) => expect.closeTo(x, 12)));
    const nearWest = spawnProbabilities(WORLD, { x: -20, z: 0 }, 25); // s1 is 0 m away, s3 is 28 m, s2 40 m
    expect(nearWest.map((s) => s.p)).toEqual([0, 0.6, 0.4].map((x) => expect.closeTo(x, 12)));
    const none = spawnProbabilities(WORLD, { x: 5, z: 0 }, 100); // s1 25 m, s2 15 m, s3 20.6 m → s1 is the farthest
    expect(none.map((s) => s.p)).toEqual([1, 0, 0]);
  });

  it('equals the sim helper (layout.ts spawnDistribution) for every case world and many positions', () => {
    for (const id of CASE_IDS) {
      const world = caseMap(id).world!;
      for (let x = -45; x <= 45; x += 9) {
        for (let z = -60; z <= 60; z += 12) {
          const mine = spawnProbabilities(world, { x, z }, DEFAULT_TUNING.hyde.minSpawnM);
          const sim = spawnDistribution(world, { x, z }, DEFAULT_TUNING.hyde.minSpawnM);
          expect(mine.map((s) => s.spawnId)).toEqual(sim.map((s) => s.spawnId));
          mine.forEach((s, i) => expect(s.p).toBeCloseTo(sim[i].p, 12));
        }
      }
    }
  });
});

describe('zone model', () => {
  it('geometry: zone lookup, adjacency and the loop as zone runs', () => {
    expect(zoneIndexAt(ZONES, 0, 0)).toBe(1);
    expect(zoneIndexAt(ZONES, 100, 0)).toBe(2); // outside → nearest
    const adj = zoneAdjacency(ZONES);
    expect(adj[0][1] && adj[1][2] && adj[0][3] && adj[1][3]).toBe(true);
    expect(adj[0][2]).toBe(false);
    const runs = patrolZoneRuns(ZONES, LOOP);
    expect(runs.map((r) => ZONES[r.zone].id)).toEqual(['w', 'm', 'e', 'm']); // cyclic: the closing W run merged
    expect(runs.reduce((a, r) => a + r.lengthM, 0)).toBeCloseTo(80, 6);
  });

  it('the patrol chain is stationary at the patrol occupancy (no diffusion)', () => {
    const model = buildZoneModel(ZONES, LOOP, 2, { ...ZONE_FILTER_DEFAULTS, diffusionPerS: 0, offPatrolReturnPerS: 0 });
    expect(model.occupancy.map((x) => Math.round(x * 1000) / 1000)).toEqual([0.25, 0.5, 0.25, 0]);
    const after = predictZones(model, model.occupancy, 37);
    after.forEach((p, i) => expect(p).toBeCloseTo(model.occupancy[i], 6));
    for (const id of CASE_IDS) {
      const m = caseMap(id);
      const real = buildZoneModel(m.world!.zones, m.patrol, DEFAULT_TUNING.hyde.speed.PATROL, { ...ZONE_FILTER_DEFAULTS, diffusionPerS: 0, offPatrolReturnPerS: 0 });
      expect(real.occupancy.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 9);
      predictZones(real, real.occupancy, 60).forEach((p, i) => expect(p).toBeCloseTo(real.occupancy[i], 5));
    }
  });

  it('prediction keeps a probability vector and spreads mass along the loop', () => {
    const model = buildZoneModel(ZONES, LOOP, 2);
    const p = predictZones(model, [1, 0, 0, 0], 5);
    expect(p.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 12);
    expect(p.every((x) => x >= 0)).toBe(true);
    expect(p[1]).toBeGreaterThan(0.1); // left the west zone towards the middle
  });

  it('observations: a sighting collapses, β down-weights the player zone, CHASE favours zones near the player', () => {
    const model = buildZoneModel(ZONES, LOOP, 2, { ...ZONE_FILTER_DEFAULTS, beta: 0.4 });
    const prior = [0.25, 0.25, 0.25, 0.25];
    const seen = observeZones(prior, observationLikelihood(model, { player: { x: 0, z: 0 }, mode: 'PATROL', visible: true, hydePos: { x: 20, z: 0 } }));
    expect(seen[2]).toBeGreaterThan(0.999);
    const unseen = observeZones(prior, observationLikelihood(model, { player: { x: 0, z: 0 }, mode: 'PATROL', visible: false, hydePos: null }));
    expect(unseen[1]).toBeCloseTo(0.1 / 0.85, 3); // 0.25·0.4 / (0.75 + 0.1)
    const chase = observeZones(prior, observationLikelihood(model, { player: { x: -25, z: -5 }, mode: 'CHASE', visible: false, hydePos: null }));
    expect(chase[0] + chase[3]).toBeGreaterThan(0.95); // west + north are within 12 m of the player
    // a hidden Hyde position is never used: the likelihood ignores hydePos unless visible
    const l1 = observationLikelihood(model, { player: { x: 0, z: 0 }, mode: 'PATROL', visible: false, hydePos: { x: 20, z: 0 } });
    const l2 = observationLikelihood(model, { player: { x: 0, z: 0 }, mode: 'PATROL', visible: false, hydePos: null });
    expect(l1).toEqual(l2);
  });

  it('the tracker starts from the spawn odds of the last pre-emergence sample, then filters', () => {
    const model = buildZoneModel(ZONES, LOOP, 2);
    const tr = new ZoneTracker(model, WORLD, 25);
    expect(tr.sample({ t: 19, emerged: false, emergedAt: null, player: { x: -20, z: 0 }, mode: 'PATROL', visible: false, hydePos: null })).toBeNull();
    expect(tr.spawns()!.map((s) => s.p)).toEqual([0, 0.6, 0.4].map((x) => expect.closeTo(x, 12)));
    const start = spawnZoneDistribution(ZONES, tr.spawns()!);
    expect(start[2]).toBeCloseTo(0.6, 3);
    const p = tr.sample({ t: 20, emerged: true, emergedAt: 20, player: { x: -20, z: 0 }, mode: 'PATROL', visible: false, hydePos: null })!;
    expect(p.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 12);
    expect(p[2]).toBeGreaterThan(0.5);
    const s = zoneScores(p, 2);
    expect(s.brier).toBeGreaterThanOrEqual(0);
    expect(s.logLoss).toBeCloseTo(-Math.log(p[2]), 12);
  });

  it('artifact parameters are validated (anything out of range falls back to the defaults)', () => {
    expect(zoneParamsFrom(null)).toEqual(ZONE_FILTER_DEFAULTS);
    expect(zoneParamsFrom({ zoneFilter: { params: { beta: 0.62, diffusionPerS: 0.01 } } }).beta).toBe(0.62);
    expect(zoneParamsFrom({ zoneFilter: { params: { beta: 7, diffusionPerS: -1 } } })).toEqual(ZONE_FILTER_DEFAULTS);
  });
});
