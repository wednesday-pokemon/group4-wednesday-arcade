// A small 40 × 40 m map WITH a CaseWorldDef, for the overhaul mechanics (session layout, site checks, traces, examines,
// lever passage, hazards, Hyde emergence) independent of the designer's case data.
//
//   z = +17 player start (0, 17)                    hiding spot (−15, 15)
//   z = +10 sites: s_ft_a (−15, 10) · s_ft_b (15, 10)          glass floor x −6..6, z 4..10
//   z =   0 divider: w_left (x −20..−2) · door (−2..2) · w_right (2..14) · passage wall (14..20, opened by the lever at (17, 3))
//   z = −10 sites: s_al_a (−15, −10) · s_al_b (−5, −10) · s_br (15, −10)       searchlight at (0, −8)
//   z = −15 egg sites: e_a (10, −15) · e_b (−10, −15) · e_c (−16, −3)          tower (0, −17)
import { withTuning } from '../../../src/mystery/config.ts';
import { MysteryRun, type MysteryRunOptions } from '../../../src/mystery/run.ts';
import { POISONED_ARCHIVE } from '../../../src/mystery/data/cases.ts';
import type { CaseWorldDef, HazardDef, MapDef, SessionLayout, Vec2 } from '../../../src/mystery/types.ts';
import { neutralRegistries } from './helpers.ts';

const rect = (minX: number, minZ: number, maxX: number, maxZ: number): Vec2[] => [
  { x: minX, z: minZ }, { x: minX, z: maxZ }, { x: maxX, z: maxZ }, { x: maxX, z: minZ },
];

export const GLASS: HazardDef = { kind: 'noisy_floor', id: 'hz_glass', name: 'Broken glass', polygon: rect(-6, 4, 6, 10), loudnessAdd: 0.3, look: 'glass' };
export const LIGHT: HazardDef = {
  kind: 'searchlight', id: 'hz_light', name: 'Yard light', x: 0, z: -8, rangeM: 8, coneDeg: 40, periodS: 8, phase: 0, loudness: 0.6, cooldownS: 3,
};

export function fixtureWorld(o: { hazards?: HazardDef[] } = {}): CaseWorldDef {
  return {
    caseId: 'poisoned_archive',
    theme: 'archive',
    areas: [
      { id: 'a_south', name: 'South Lawn', x: 0, z: 10, radiusM: 12 },
      { id: 'a_north', name: 'North Yard', x: 0, z: -10, radiusM: 12 },
    ],
    clueSites: [
      {
        clueId: 'falsified_transfer', searchS: 2, sites: [
          { id: 's_ft_a', areaId: 'a_south', roomId: 'path', x: -15, z: 10, prior: 0.6, label: 'West desk', prop: 'desk' },
          { id: 's_ft_b', areaId: 'a_south', roomId: 'path', x: 15, z: 10, prior: 0.4, label: 'East desk', prop: 'desk' },
        ],
      },
      {
        clueId: 'access_ledger', searchS: 2, sites: [
          { id: 's_al_a', areaId: 'a_north', roomId: 'path', x: -15, z: -10, prior: 0.7, label: 'Ledger shelf', prop: 'shelf' },
          { id: 's_al_b', areaId: 'a_north', roomId: 'path', x: -5, z: -10, prior: 0.3, label: 'Ledger crate', prop: 'crate' },
        ],
      },
      {
        clueId: 'botanical_residue', searchS: 2, sites: [
          { id: 's_br', areaId: 'a_north', roomId: 'path', x: 15, z: -10, prior: 1, label: 'Planter', prop: 'planter' },
        ],
      },
    ],
    eggSites: [
      { id: 'e_a', areaId: 'a_north', roomId: 'path', x: 10, z: -15, prior: 0.5, label: 'East nest', prop: 'nest', traceText: 'Straw leads east.' },
      { id: 'e_b', areaId: 'a_north', roomId: 'path', x: -10, z: -15, prior: 0.3, label: 'West nest', prop: 'nest', traceText: 'Straw leads west.' },
      { id: 'e_c', areaId: 'a_north', roomId: 'path', x: -16, z: -3, prior: 0.2, label: 'Corner nest', prop: 'nest', traceText: 'Straw leads to the corner.' },
    ],
    traceAccuracy: 0.75,
    hydeSpawns: [
      { id: 'sp_n', name: 'North', zoneId: 'z_n', x: 0, z: -12, yaw: Math.PI, weight: 0.5 },
      { id: 'sp_w', name: 'West', zoneId: 'z_n', x: -16, z: -16, yaw: 0, weight: 0.3 },
      { id: 'sp_e', name: 'East', zoneId: 'z_n', x: 16, z: -6, yaw: 0, weight: 0.2 },
    ],
    zones: [
      { id: 'z_s', name: 'South', polygon: rect(-20, 0, 20, 20) },
      { id: 'z_n', name: 'North', polygon: rect(-20, -20, 20, 0) },
    ],
    extraWalls: [{ id: 'w_passage', a: { x: 14, z: 0 }, b: { x: 20, z: 0 }, thickness: 0.5, height: 3, kind: 'ruin' }],
    extraCover: [],
    extraHiding: [],
    passage: { id: 'p_east', leverX: 17, leverZ: 3, label: 'Pull the rusty lever', wallId: 'w_passage', text: 'A wall grinds open.' },
    examines: [
      { id: 'ex_vial', x: -8, z: 14, label: 'Examine the vial', text: 'Residue.', givesTrace: true, prop: 'vial' },
      { id: 'ex_books', x: 8, z: 14, label: 'Examine the books', text: 'Dusty.', givesTrace: false, prop: 'books' },
    ],
    hazards: o.hazards ?? [GLASS, LIGHT],
  };
}

export function fixtureWorldMap(o: { hazards?: HazardDef[]; playerStart?: { x: number; z: number; yaw: number } } = {}): MapDef {
  const world = fixtureWorld(o);
  const s0 = (i: number) => world.clueSites[i].sites[0];
  return {
    id: 'fixture_world',
    name: 'Fixture World',
    bounds: { minX: -20, maxX: 20, minZ: -20, maxZ: 20 },
    playerStart: o.playerStart ?? { x: 0, z: 17, yaw: 0 },
    hydeStart: { x: 0, z: -12, yaw: Math.PI },
    patrol: [{ x: 0, z: -12 }, { x: 12, z: -12 }, { x: 12, z: -5 }, { x: -12, z: -5 }],
    walls: [
      { id: 'w_left', a: { x: -20, z: 0 }, b: { x: -2, z: 0 }, thickness: 0.5, height: 3, kind: 'stone' },
      { id: 'w_right', a: { x: 2, z: 0 }, b: { x: 14, z: 0 }, thickness: 0.5, height: 3, kind: 'stone' },
      ...world.extraWalls,
    ],
    cover: [
      { id: 'pillar', x: -10, z: 8, radius: 1, height: 'high', kind: 'pillar' },
      { id: 'crate', x: 8, z: 8, radius: 0.8, height: 'low', kind: 'crate' },
    ],
    hidingSpots: [{ id: 'hs', x: -15, z: 15, radius: 1.2, revealM: 2, kind: 'alcove' }],
    rooms: [
      { id: 'tower', name: 'Tower', polygon: rect(-3, -20, 3, -14) },
      { id: 'path', name: 'Path', polygon: rect(-20, -20, 20, 20) },
    ],
    clues: world.clueSites.map((g, i) => ({ clueId: g.clueId, roomId: s0(i).roomId, x: s0(i).x, z: s0(i).z, searchS: g.searchS })),
    eggSpawn: { x: world.eggSites[0].x, z: world.eggSites[0].z },
    tower: { x: 0, z: -17, radius: 2.5 },
    safeReleasePoints: [{ x: -15, z: 17 }, { x: 15, z: 17 }],
    landmarks: [],
    world,
  };
}

/** The layout every mechanics test uses unless it says otherwise: first sites of each group, egg at e_a. */
export const FIRST_LAYOUT: SessionLayout = {
  clueSites: { falsified_transfer: 's_ft_a', access_ledger: 's_al_a', botanical_residue: 's_br' },
  eggSiteId: 'e_a',
};

/** Mechanics tests pin the overhaul numbers the designer may still retune (site checks 4 m, emergence at 20 s). */
export const WORLD_TUNING = withTuning({ investigation: { siteCheckM: 4 }, hyde: { emergeAfterS: 20 } });

/** A run on the fixture world. `layout: null` = use the map's own placements (no session layout applied). */
export function worldRun(o: Partial<Omit<MysteryRunOptions, 'layout'>> & { layout?: SessionLayout | null; hazards?: HazardDef[] } = {}): MysteryRun {
  return new MysteryRun({
    duo: o.duo ?? { characterId: 'wednesday', pokemonId: 'aegislash' },
    seed: o.seed ?? 'world-seed',
    map: o.map ?? fixtureWorldMap({ hazards: o.hazards }),
    layout: o.layout === null ? undefined : (o.layout ?? FIRST_LAYOUT),
    caseDef: o.caseDef ?? POISONED_ARCHIVE,
    tutorial: o.tutorial ?? false,
    tuning: o.tuning ?? WORLD_TUNING,
    registries: o.registries ?? neutralRegistries(),
  });
}
