// Compact maps (FINAL_CONTRACT §3): applyPlayArea / caseMap fence a case map in to its playArea — bounds, start, Hyde
// patrol, release points, practice point; geometry outside dropped; the switch dropped when outside. Plus, for every
// case whose data has a playArea, the per-playArea invariants (everything the run needs lies inside and is reachable).
import { describe, expect, it } from 'vitest';
import { CASES } from '../../../src/mystery/data/cases.ts';
import { buildIsland } from '../../../src/mystery/data/island.ts';
import { applyPlayArea, caseMap, practiceCrateFor } from '../../../src/mystery/defaults.ts';
import { encounterSpawnsFor } from '../../../src/mystery/director.ts';
import { MysteryRun } from '../../../src/mystery/run.ts';
import { CASE_IDS, type MapDef, type PlayAreaDef, type Vec2 } from '../../../src/mystery/types.ts';

const AREA: PlayAreaDef = {
  bounds: { minX: -22, maxX: 40, minZ: -60, maxZ: -2 },
  playerStart: { x: 30, z: -6, yaw: Math.PI / 2 },
  hydePatrol: [{ x: -10, z: -38 }, { x: 12, z: -40 }, { x: 12, z: -28 }, { x: -12, z: -24 }],
  safeReleasePoints: [{ x: 20, z: -20 }, { x: -12, z: -50 }],
  practicePoint: { x: 28, z: -8 },
};

const inside = (m: MapDef, p: Vec2, margin = 0) =>
  p.x >= m.bounds.minX - margin && p.x <= m.bounds.maxX + margin && p.z >= m.bounds.minZ - margin && p.z <= m.bounds.maxZ + margin;

describe('applyPlayArea (synthetic area on the Case 01 island)', () => {
  const island = buildIsland(CASES.poisoned_archive);
  const m = applyPlayArea(island, AREA);

  it('takes bounds / start / patrol / release points from the area; Hyde starts on the patrol; input untouched', () => {
    expect(m.bounds).toEqual(AREA.bounds);
    expect(m.playerStart).toEqual(AREA.playerStart);
    expect(m.patrol).toEqual(AREA.hydePatrol);
    expect(m.safeReleasePoints).toEqual(AREA.safeReleasePoints);
    expect({ x: m.hydeStart.x, z: m.hydeStart.z }).toEqual(AREA.hydePatrol[0]);
    expect(island.bounds).toEqual({ minX: -45, maxX: 45, minZ: -60, maxZ: 60 });
  });

  it('drops geometry wholly outside; keeps what touches the area; tower inside', () => {
    expect(m.walls.length).toBeLessThan(island.walls.length);
    expect(m.walls.some((w) => w.id === 'tower_s_w')).toBe(true);
    expect(m.walls.some((w) => w.id === 'pier_s')).toBe(false);
    for (const c of m.cover) expect(inside(m, c, c.radius + 1.5), c.id).toBe(true);
    for (const h of m.hidingSpots) expect(inside(m, h), h.id).toBe(true);
    expect(inside(m, m.tower)).toBe(true);
  });

  it('the power switch is kept only when it and its gate are inside', () => {
    expect(m.powerSwitch?.id).toBe('shortcut_switch'); // (33, −13) and the gate at z −34 are inside
    const small = applyPlayArea(island, { ...AREA, bounds: { minX: -22, maxX: 25, minZ: -60, maxZ: -2 } });
    expect(small.powerSwitch).toBeUndefined();
  });

  it('a run on it starts at the area start, tutorial crate at practicePoint, nav bounded by the area', () => {
    const map = { ...m, world: { ...m.world!, playArea: AREA } };
    expect(practiceCrateFor(map)).toEqual(AREA.practicePoint);
    const run = new MysteryRun({ duo: { characterId: 'wednesday', pokemonId: 'gengar' }, seed: 'pa', map, caseDef: CASES.poisoned_archive, tutorial: true });
    expect(run.practicePoint).toEqual(AREA.practicePoint);
    expect({ x: run.player.x, z: run.player.z }).toEqual({ x: 30, z: -6 });
    const nav = run.playerNav();
    expect(nav.minX).toBe(AREA.bounds.minX);
    expect(nav.walkable(0, 30)).toBe(false); // the old south lawn is outside
  });
});

describe('per-case playArea invariants (cases whose data has one)', () => {
  for (const id of CASE_IDS) {
    const m = caseMap(id);
    const area = m.world?.playArea;
    it.skipIf(!area)(`${id}: everything the run needs lies inside the play area and is reachable from the start`, () => {
      const w = m.world!;
      const run = new MysteryRun({ duo: { characterId: 'wednesday', pokemonId: 'gengar' }, seed: `pa-${id}`, caseDef: CASES[id], tutorial: false });
      const nav = run.playerNav(true);
      const start = { x: m.playerStart.x, z: m.playerStart.z };
      const reach = (p: Vec2, tag: string, r = 2) => {
        expect(inside(m, p), `${tag} inside`).toBe(true);
        expect(nav.reachable(start, p, r), `${tag} reachable`).toBe(true);
      };
      reach(m.tower, 'tower', m.tower.radius);
      for (const g of w.clueSites) for (const s of g.sites) reach(s, `clue ${s.id}`);
      for (const s of w.eggSites) reach(s, `egg ${s.id}`);
      for (const p of m.patrol) reach(p, 'patrol');
      for (const p of m.safeReleasePoints) reach(p, 'release', 4);
      for (const e of w.examines) reach(e, `examine ${e.id}`);
      if (w.passage) reach({ x: w.passage.leverX, z: w.passage.leverZ }, 'lever');
      for (const enemy of ['hyde', 'crackstone', 'slurp'] as const) for (const s of encounterSpawnsFor(w, enemy)) reach(s, `spawn ${s.id}`, 3);
      for (const p of w.slurp?.wander ?? []) reach(p, 'slurp wander', 3);
      const cabinets = m.hidingSpots.filter((h) => h.kind === 'cabinet');
      expect(cabinets.length, 'cabinets ≥ 4').toBeGreaterThanOrEqual(4);
      for (const c of cabinets) {
        expect(c.doorYaw, `${c.id} doorYaw`).toBeTypeOf('number');
        reach(c, `cabinet ${c.id}`, 2.5);
      }
      const side = (b: MapDef['bounds']) => [b.maxX - b.minX, b.maxZ - b.minZ];
      for (const s of side(m.bounds)) expect(s).toBeLessThanOrEqual(80);
    });
  }
});
