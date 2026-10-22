// Every case's island: the shared geometry is untouched, and each case's three clue spots, its egg and the tower are
// reachable (player with the shortcut gate CLOSED, and the Hyde), not inside walls / cover, not interactable through a
// wall, and the egg is not on top of a clue.
import { describe, expect, it } from 'vitest';
import { DEFAULT_TUNING } from '../../../src/mystery/config.ts';
import { CASES, POISONED_ARCHIVE } from '../../../src/mystery/data/cases.ts';
import { buildIsland, ISLAND_BASE_ID } from '../../../src/mystery/data/island.ts';
import { caseMap, defaultMap } from '../../../src/mystery/defaults.ts';
import { closestOnSegment, pointInPolygon, World } from '../../../src/mystery/geometry.ts';
import { NavGrid } from '../../../src/mystery/nav.ts';
import { MysteryRun } from '../../../src/mystery/run.ts';
import { CASE_IDS, type MapDef, type Vec2 } from '../../../src/mystery/types.ts';

const T = DEFAULT_TUNING;
const R = T.player.interactRangeM;
/** The bot (and a hurried player) stops this far inside the interact range. */
const APPROACH = R - 0.4;

function roomAt(map: MapDef, p: Vec2) {
  return map.rooms.find((r) => pointInPolygon(p.x, p.z, r.polygon))?.id ?? null;
}

/** Smallest distance from p to the SURFACE of any wall / cover piece (negative = inside). */
function clearance(world: World, p: Vec2): { d: number; id: string } {
  let best = { d: Infinity, id: '' };
  for (const c of [...world.walls, ...world.cover]) {
    const q = closestOnSegment(p.x, p.z, c.ax, c.az, c.bx, c.bz);
    const d = Math.hypot(p.x - q.x, p.z - q.z) - c.r;
    if (d < best.d) best = { d, id: c.id };
  }
  return best;
}

/** Walkable cells of `comp` within `maxD` of p with no wall between the cell and p, nearest first. */
function approachCells(grid: NavGrid, world: World, comp: number, p: Vec2, maxD: number): { at: Vec2; d: number }[] {
  const out: { at: Vec2; d: number }[] = [];
  const x0 = Math.max(0, Math.floor((p.x - maxD - grid.minX) / grid.cell));
  const x1 = Math.min(grid.w - 1, Math.ceil((p.x + maxD - grid.minX) / grid.cell));
  const z0 = Math.max(0, Math.floor((p.z - maxD - grid.minZ) / grid.cell));
  const z1 = Math.min(grid.h - 1, Math.ceil((p.z + maxD - grid.minZ) / grid.cell));
  for (let iz = z0; iz <= z1; iz++) {
    for (let ix = x0; ix <= x1; ix++) {
      const i = iz * grid.w + ix;
      if (grid.component[i] !== comp) continue;
      const at = grid.center(i);
      const d = Math.hypot(at.x - p.x, at.z - p.z);
      if (d <= maxD && world.blockersOn(at.x, at.z, p.x, p.z).walls === 0) out.push({ at, d });
    }
  }
  return out.sort((a, b) => a.d - b.d);
}

/** Every walkable cell (any component) within the interact range of p, with the walls-blocked ones flagged. */
function throughWallCells(grid: NavGrid, world: World, p: Vec2): Vec2[] {
  const out: Vec2[] = [];
  for (let i = 0; i < grid.blocked.length; i++) {
    if (grid.blocked[i]) continue;
    const at = grid.center(i);
    if (Math.abs(at.x - p.x) > R || Math.abs(at.z - p.z) > R) continue;
    if (Math.hypot(at.x - p.x, at.z - p.z) <= R && world.blockersOn(at.x, at.z, p.x, p.z).walls > 0) out.push(at);
  }
  return out;
}

describe('one shared island, dressed per case', () => {
  const base = caseMap(POISONED_ARCHIVE.id);

  it('map ids are per case; defaultMap() is Case 01; caseMap is cached and equals buildIsland(case)', () => {
    expect(defaultMap()).toBe(base);
    for (const id of CASE_IDS) {
      const m = caseMap(id);
      expect(m.id).toBe(`${ISLAND_BASE_ID}:${id}`);
      expect(caseMap(id)).toBe(m);
      expect(buildIsland(CASES[id])).toEqual(m);
    }
    expect(buildIsland()).toEqual(base);
  });

  it('walls, cover, hiding spots, patrol, starts, tower and release points never change between cases', () => {
    for (const id of CASE_IDS) {
      const m = caseMap(id);
      for (const k of ['walls', 'cover', 'hidingSpots', 'patrol', 'playerStart', 'hydeStart', 'tower', 'safeReleasePoints', 'powerSwitch', 'bounds'] as const) {
        expect(m[k], `${id}.${k}`).toEqual(base[k]);
      }
      expect(m.rooms.map((r) => [r.id, r.polygon])).toEqual(base.rooms.map((r) => [r.id, r.polygon]));
    }
  });

  it('a case moves only its clues + egg and renames its rooms', () => {
    for (const id of CASE_IDS) {
      const def = CASES[id];
      const m = caseMap(id);
      expect(m.clues).toEqual(def.placements);
      expect(m.eggSpawn).toEqual({ x: def.egg.x, z: def.egg.z });
      for (const [room, name] of Object.entries(def.roomNames)) expect(m.rooms.find((r) => r.id === room)!.name).toBe(name);
    }
  });

  it('different cases put their clues in different places (no two cases share all spots)', () => {
    const key = (id: (typeof CASE_IDS)[number]) => caseMap(id).clues.map((c) => `${c.x},${c.z}`).sort().join('|');
    expect(new Set(CASE_IDS.map(key)).size).toBe(3);
  });
});

for (const id of CASE_IDS) {
  const def = CASES[id];
  const map = caseMap(id);
  const world = new World(map, T.nav.lowCoverBlocksMovement); // gate closed
  const player = new NavGrid(world, T.player.radius, T.nav.cellM);
  const hyde = new NavGrid(world, T.hyde.radius, T.nav.cellM);
  const startComp = player.componentAt(map.playerStart);
  const hydeComp = hyde.componentAt(map.hydeStart);
  const targets: [string, Vec2, number][] = [
    ...map.clues.map((c) => [`clue ${c.clueId}`, { x: c.x, z: c.z }, APPROACH] as [string, Vec2, number]),
    ['egg', map.eggSpawn, APPROACH],
    ['tower', { x: map.tower.x, z: map.tower.z }, map.tower.radius - 0.8],
  ];

  describe(`${def.number} ${def.title}: reachability on ${map.id}`, () => {
    it('placements and the egg lie in their declared rooms (first-match room order)', () => {
      for (const c of map.clues) expect(roomAt(map, c), c.clueId).toBe(c.roomId);
      expect(roomAt(map, map.eggSpawn)).toBe(def.egg.roomId);
    });

    it('clue spots and the egg are inside the bounds and not inside any wall or cover (≥ 0.3 m clear)', () => {
      for (const [name, p] of targets.slice(0, 4)) {
        const c = clearance(world, p);
        expect(c.d, `${name} vs ${c.id}`).toBeGreaterThanOrEqual(0.3);
        expect(p.x > map.bounds.minX + 1 && p.x < map.bounds.maxX - 1 && p.z > map.bounds.minZ + 1 && p.z < map.bounds.maxZ - 1, name).toBe(true);
      }
    });

    for (const [name, p, reach] of targets) {
      it(`${name}: the player (gate closed) can walk within ${reach.toFixed(1)} m with no wall in between`, () => {
        expect(startComp).toBeGreaterThanOrEqual(0);
        expect(approachCells(player, world, startComp, p, reach).length, name).toBeGreaterThan(0);
      });
    }

    it('the Hyde can reach every clue spot, the egg and the tower (≤ interact range + 1 m)', () => {
      for (const [name, p] of targets) {
        expect(approachCells(hyde, world, hydeComp, p, R + 1).length, name).toBeGreaterThan(0);
      }
    });

    it('no clue / egg can be interacted with through a wall', () => {
      for (const [name, p] of targets.slice(0, 4)) expect(throughWallCells(player, world, p), name).toEqual([]);
    });

    it('the egg is ≥ 3 m from every clue and the clues are ≥ 3 m apart', () => {
      for (const c of map.clues) expect(Math.hypot(c.x - map.eggSpawn.x, c.z - map.eggSpawn.z), c.clueId).toBeGreaterThanOrEqual(3);
      for (const a of map.clues) for (const b of map.clues) if (a !== b) expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeGreaterThanOrEqual(3);
    });

    it('in the sim, standing at the nearest approach cell offers exactly that clue / the egg on E', () => {
      const run = new MysteryRun({ duo: { characterId: 'wednesday', pokemonId: 'gengar' }, seed: `reach-${id}`, caseDef: def });
      run.hydeBrain.active = false;
      for (const c of map.clues) {
        const at = approachCells(player, world, startComp, c, APPROACH)[0].at;
        run.player.x = at.x;
        run.player.z = at.z;
        expect(run.interactable(), c.clueId).toMatchObject({ kind: 'clue', id: c.clueId, label: def.clues.find((x) => x.id === c.clueId)!.interactLabel });
      }
      run.cluesFound.push(...def.clues.map((c) => c.id));
      const at = approachCells(player, world, startComp, map.eggSpawn, APPROACH)[0].at;
      run.player.x = at.x;
      run.player.z = at.z;
      expect(run.interactable()).toMatchObject({ kind: 'egg' });
      expect(run.egg).toMatchObject({ state: 'resting', x: def.egg.x, z: def.egg.z });
    });
  });
}
