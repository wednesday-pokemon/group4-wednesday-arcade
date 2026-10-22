// Shared fixtures for the mystery sim tests: a small 40 × 40 m map with a dividing wall (open door at x 0, power gate
// at x 12), fog in the north-west quadrant, a high pillar, a low crate, a hiding spot, and neutral-mod registries.
import { MysteryRun, IDLE_INPUT, type MysteryRunOptions } from '../../../src/mystery/run.ts';
import { REGISTRIES, type Registries } from '../../../src/mystery/draft.ts';
import { NEUTRAL_MODS } from '../../../src/mystery/stats.ts';
import type { CaseDef, MapDef, MysteryInput, StampedEvent, Vec2 } from '../../../src/mystery/types.ts';
import { POISONED_ARCHIVE } from '../../../src/mystery/data/cases.ts';

const rect = (minX: number, minZ: number, maxX: number, maxZ: number): Vec2[] => [
  { x: minX, z: minZ }, { x: minX, z: maxZ }, { x: maxX, z: maxZ }, { x: maxX, z: minZ },
];

export interface FixtureOptions {
  patrol?: Vec2[];
  hydeStart?: { x: number; z: number; yaw: number };
  playerStart?: { x: number; z: number; yaw: number };
  noDivider?: boolean;
}

export function fixtureMap(o: FixtureOptions = {}): MapDef {
  const hydeStart = o.hydeStart ?? { x: 0, z: -12, yaw: Math.PI };
  return {
    id: 'fixture',
    name: 'Fixture',
    bounds: { minX: -20, maxX: 20, minZ: -20, maxZ: 20 },
    playerStart: o.playerStart ?? { x: 0, z: 17, yaw: 0 },
    hydeStart,
    patrol: o.patrol ?? [{ x: hydeStart.x, z: hydeStart.z }],
    walls: o.noDivider ? [] : [
      { id: 'w_left', a: { x: -20, z: 0 }, b: { x: -2, z: 0 }, thickness: 0.5, height: 3, kind: 'stone' },
      { id: 'w_mid', a: { x: 2, z: 0 }, b: { x: 10, z: 0 }, thickness: 0.5, height: 3, kind: 'stone' },
      { id: 'gate', a: { x: 10, z: 0 }, b: { x: 14, z: 0 }, thickness: 0.5, height: 3, kind: 'fence' },
      { id: 'w_right', a: { x: 14, z: 0 }, b: { x: 20, z: 0 }, thickness: 0.5, height: 3, kind: 'stone' },
    ],
    cover: [
      { id: 'pillar', x: -10, z: 8, radius: 1, height: 'high', kind: 'pillar' },
      { id: 'crate', x: 8, z: 8, radius: 0.8, height: 'low', kind: 'crate' },
    ],
    hidingSpots: [{ id: 'hs', x: -15, z: 15, radius: 1.2, revealM: 2, kind: 'alcove' }],
    rooms: [
      { id: 'tower', name: 'Tower', polygon: rect(-3, -20, 3, -14) },
      { id: 'crypt', name: 'Crypt', polygon: rect(-20, -20, 0, 0), fog: true },
      { id: 'egg_chamber', name: 'Egg', polygon: rect(0, -20, 20, 0) },
      { id: 'path', name: 'Path', polygon: rect(-20, -20, 20, 20) },
    ],
    clues: [
      { clueId: 'falsified_transfer', roomId: 'path', x: -15, z: 10, searchS: 2.5 },
      { clueId: 'access_ledger', roomId: 'crypt', x: -15, z: -10, searchS: 2.5 },
      { clueId: 'botanical_residue', roomId: 'egg_chamber', x: 15, z: -10, searchS: 3 },
    ],
    eggSpawn: { x: 10, z: -15 },
    tower: { x: 0, z: -17, radius: 2.5 },
    safeReleasePoints: [{ x: -15, z: 17 }, { x: 15, z: 17 }, { x: 0, z: -5 }],
    powerSwitch: { id: 'sw', x: 12, z: 3, gateWallId: 'gate', openS: 10 },
    landmarks: [],
  };
}

/** Registries with every passive mod neutral (abilities unchanged) — for physics / perception tests. */
export function neutralRegistries(): Registries {
  const nightshades = structuredClone(REGISTRIES.nightshades);
  const partners = structuredClone(REGISTRIES.partners);
  for (const n of Object.values(nightshades)) n.mods = { ...NEUTRAL_MODS };
  for (const p of Object.values(partners)) p.mods = {};
  return { nightshades, partners };
}

/** The fixture map carries Case 01's three clue ids (falsified_transfer / access_ledger / botanical_residue). */
export const CASE: CaseDef = POISONED_ARCHIVE;

export function makeRun(o: Partial<MysteryRunOptions> & { fixture?: FixtureOptions } = {}): MysteryRun {
  return new MysteryRun({
    duo: o.duo ?? { characterId: 'wednesday', pokemonId: 'aegislash' },
    seed: o.seed ?? 'test-seed',
    map: o.map ?? fixtureMap(o.fixture),
    caseDef: o.caseDef ?? CASE,
    tutorial: o.tutorial ?? false,
    tuning: o.tuning,
    registries: o.registries ?? neutralRegistries(),
  });
}

export function input(p: Partial<MysteryInput> = {}): MysteryInput {
  return { ...IDLE_INPUT, ...p };
}

/** Steps the run `seconds` with the same held input (edges only on the first step). Returns the emitted log slice. */
export function hold(run: MysteryRun, seconds: number, p: Partial<MysteryInput> = {}): StampedEvent[] {
  const before = run.log.length;
  const n = Math.round(seconds / run.tuning.fixedStepS);
  run.setInput(input(p));
  for (let i = 0; i < n && (run.status === 'playing' || run.status === 'tutorial'); i++) {
    run.step();
    if (i === 0) run.setInput(input({ ...p, interact: false, power: false, move: false, hint: false }));
  }
  return run.log.slice(before);
}

export function place(run: MysteryRun, x: number, z: number, yaw = run.player.yaw): void {
  run.player.x = x;
  run.player.z = z;
  run.player.yaw = yaw;
}

export function placeHyde(run: MysteryRun, x: number, z: number, yaw: number): void {
  run.hyde.x = x;
  run.hyde.z = z;
  run.hyde.yaw = yaw;
  run.hyde.path = [];
}

export function modeEvents(events: StampedEvent[]) {
  return events.filter((e): e is Extract<StampedEvent, { type: 'hyde_mode' }> => e.type === 'hyde_mode');
}
