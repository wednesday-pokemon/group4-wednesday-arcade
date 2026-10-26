// Final-wave fixture (docs/final/FINAL_CONTRACT.md §4–§6): the 40 × 40 m fixture world (worldFixture.ts) plus
// encounter-director spawns (Hyde + Slurp), Slurp's haunt and one hiding cabinet — independent of the designer's data.
//
//   cabinet 'cab' at (−17, 5), door facing +X (doorYaw −π/2) → exit point ≈ (−15.8, 5)
//   Hyde spawns: h_n (0, −12) · h_w (−16, −16) · h_e (16, −6)        Slurp spawns: s_w (−15, −15) · s_e (15, −15)
//   Slurp wander loop: (−12, −12) (12, −12) (12, −5) (−12, −5)
import { withTuning, type SimTuning } from '../../../src/mystery/config.ts';
import { MysteryRun, type MysteryRunOptions } from '../../../src/mystery/run.ts';
import { POISONED_ARCHIVE } from '../../../src/mystery/data/cases.ts';
import type { EncounterSpawnDef, HidingSpotDef, MapDef } from '../../../src/mystery/types.ts';
import { neutralRegistries } from './helpers.ts';
import { FIRST_LAYOUT, fixtureWorldMap, WORLD_TUNING } from './worldFixture.ts';

export const CABINET: HidingSpotDef = { id: 'cab', x: -17, z: 5, radius: 0.8, revealM: 1.5, kind: 'cabinet', doorYaw: -Math.PI / 2 };

export const FINAL_SPAWNS: EncounterSpawnDef[] = [
  { id: 'h_n', enemy: 'hyde', name: 'North yard', zoneId: 'z_n', x: 0, z: -12, yaw: Math.PI, weight: 2 },
  { id: 'h_w', enemy: 'hyde', name: 'West corner', zoneId: 'z_n', x: -16, z: -16, yaw: 0, weight: 1 },
  { id: 'h_e', enemy: 'hyde', name: 'East corner', zoneId: 'z_n', x: 16, z: -6, yaw: 0, weight: 1 },
  { id: 's_w', enemy: 'slurp', name: 'West crypt', zoneId: 'z_n', x: -15, z: -15, yaw: 0, weight: 1 },
  { id: 's_e', enemy: 'slurp', name: 'East crypt', zoneId: 'z_n', x: 15, z: -15, yaw: 0, weight: 1 },
];

export function finalMap(o: { slurp?: boolean; spawns?: EncounterSpawnDef[]; cabinet?: boolean } = {}): MapDef {
  const base = fixtureWorldMap({ hazards: [] });
  const world = {
    ...base.world!,
    encounterSpawns: o.spawns ?? FINAL_SPAWNS,
    slurp: o.slurp === false ? null : { areaName: 'North Yard', wander: [{ x: -12, z: -12 }, { x: 12, z: -12 }, { x: 12, z: -5 }, { x: -12, z: -5 }], leashM: 30 },
  };
  return { ...base, id: 'fixture_final', hidingSpots: o.cabinet === false ? base.hidingSpots : [...base.hidingSpots, CABINET], world };
}

/** Pinned numbers for the final mechanics (the designer may retune the real ones). */
export const FINAL_TUNING: SimTuning = withTuning({
  director: {
    minSpawnM: 15, despawnM: 15, minActiveS: 30, recentSpawnS: 60, recentMult: 0.3, objectiveMult: 1.5, maxActive: 2,
    firstSpawnS: { hyde: 20, crackstone: 35, slurp: 25 }, respawnCooldownS: { hyde: 20, crackstone: 25, slurp: 25 },
  },
  cabinet: { creakAfterS: 20, creakEveryS: 4 },
}, WORLD_TUNING);

export function finalRun(o: Partial<MysteryRunOptions> & { slurp?: boolean; cabinet?: boolean } = {}): MysteryRun {
  return new MysteryRun({
    duo: o.duo ?? { characterId: 'wednesday', pokemonId: 'aegislash' },
    seed: o.seed ?? 'final-seed',
    map: o.map ?? finalMap({ slurp: o.slurp, cabinet: o.cabinet }),
    layout: o.layout ?? FIRST_LAYOUT,
    caseDef: o.caseDef ?? POISONED_ARCHIVE,
    tutorial: o.tutorial ?? false,
    tuning: o.tuning ?? FINAL_TUNING,
    registries: o.registries ?? neutralRegistries(),
  });
}
