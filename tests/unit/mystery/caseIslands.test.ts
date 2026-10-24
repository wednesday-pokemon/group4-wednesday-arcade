// Every case's island (overhaul data model, docs/overhaul/OVERHAUL_CONTRACT.md "Data"): the shared base geometry plus the
// case's own structures, and EVERY candidate site (clue + egg) of every case reachable from the pier with the gate and
// the passage closed, interactable without passing through a wall, inside its declared room, clear of solids and ≥ 3 m
// from every other site; spawns navigable and ≥ minSpawnDistanceM from the start; zones tiling the walkable island;
// priors / weights summing to 1; extra walls keeping gaps ≥ 3 m and the patrol clear; the passage lever reachable and the
// passage a real shortcut that is never required.
import { describe, expect, it } from 'vitest';
import { DEFAULT_TUNING } from '../../../src/mystery/config.ts';
import { CASES, POISONED_ARCHIVE } from '../../../src/mystery/data/cases.ts';
import { buildIsland, ISLAND_BASE_ID } from '../../../src/mystery/data/island.ts';
import { applyPlayArea, caseMap, defaultMap, dropUnreachableSwitch } from '../../../src/mystery/defaults.ts';
import { closestOnSegment, pointInPolygon, segSegDist2, World, type Collider } from '../../../src/mystery/geometry.ts';
import { NavGrid, pathLength } from '../../../src/mystery/nav.ts';
import { MysteryRun } from '../../../src/mystery/run.ts';
import { CASE_IDS, type CaseId, type MapDef, type SessionLayout, type SiteDef, type Vec2 } from '../../../src/mystery/types.ts';

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

/** Walkable cells (any component) within the interact range of p but with a wall between them and p. */
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

function sum(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0);
}

/** |Σ − 1| ≤ 1e-9 (priors / weights). */
function expectSumsToOne(xs: number[], tag: string): void {
  expect(Math.abs(sum(xs) - 1), `${tag}: Σ = ${sum(xs)}`).toBeLessThanOrEqual(1e-9);
}

/** Clear gap between two wall capsules and whether they run side by side (near-parallel, ≥ 1 m of shared length). */
function wallGap(a: Collider, b: Collider): { gap: number; corridor: boolean } {
  const gap = Math.sqrt(segSegDist2(a.ax, a.az, a.bx, a.bz, b.ax, b.az, b.bx, b.bz)) - a.r - b.r;
  const ax = a.bx - a.ax;
  const az = a.bz - a.az;
  const bx = b.bx - b.ax;
  const bz = b.bz - b.az;
  const la = Math.hypot(ax, az) || 1;
  const lb = Math.hypot(bx, bz) || 1;
  const parallel = Math.abs(ax * bz - az * bx) / (la * lb) < Math.sin((15 * Math.PI) / 180);
  const ux = ax / la;
  const uz = az / la;
  const pb = [(b.ax - a.ax) * ux + (b.az - a.az) * uz, (b.bx - a.ax) * ux + (b.bz - a.az) * uz];
  const overlap = Math.min(la, Math.max(...pb)) - Math.max(0, Math.min(...pb));
  return { gap, corridor: parallel && overlap >= 1 };
}

/**
 * Reported to the designer (final data, 2026-10-24): gaps under the contract width that are still passable for both the
 * player (0.8 m) and the Hyde (1.2 m). Remove an entry once the data is fixed.
 */
const KNOWN_NARROW = new Set(['ms_fence_ravine|crypt_e_n']);

/** Player radius × 2: anything narrower is closed (nobody fits through). */
const CLOSED_GAP_M = 0.8;
/** Doorways (wall end ↔ wall) must be ≥ 3 m clear (contract); corridors between side-by-side walls ≥ 2.5 m (Hyde + player pass). */
const DOORWAY_M = 3;
const CORRIDOR_M = 2.5;

/** Every candidate site of a case (clue groups then egg sites) with a readable tag. */
function sitesOf(map: MapDef): { tag: string; site: SiteDef; kind: 'clue' | 'egg' }[] {
  const w = map.world!;
  return [
    ...w.clueSites.flatMap((g) => g.sites.map((site) => ({ tag: `${g.clueId}/${site.id}`, site, kind: 'clue' as const }))),
    ...w.eggSites.map((site) => ({ tag: `egg/${site.id}`, site, kind: 'egg' as const })),
  ];
}

function layoutWith(map: MapDef, kind: 'clue' | 'egg', siteId: string): SessionLayout {
  const w = map.world!;
  const clueSites: SessionLayout['clueSites'] = {};
  for (const g of w.clueSites) clueSites[g.clueId] = (g.sites.find((s) => s.id === siteId) ?? g.sites[0]).id;
  return { clueSites, eggSiteId: kind === 'egg' ? siteId : w.eggSites[0].id };
}

const extraIds = (id: CaseId) => new Set(caseMap(id).world!.extraWalls.map((w) => w.id));

describe('one shared island, dressed per case', () => {
  const base = caseMap(POISONED_ARCHIVE.id);

  it('map ids are per case; defaultMap() is Case 01; caseMap is cached and = buildIsland(case) fenced in to its playArea; world attached', () => {
    expect(defaultMap()).toBe(base);
    for (const id of CASE_IDS) {
      const m = caseMap(id);
      expect(m.id).toBe(`${ISLAND_BASE_ID}:${id}`);
      expect(caseMap(id)).toBe(m);
      expect(dropUnreachableSwitch(applyPlayArea(buildIsland(CASES[id])))).toEqual(m);
      expect(m.world?.caseId).toBe(id);
    }
  });

  it('compact maps (FINAL_CONTRACT §3): bounds / start / patrol / release points come from the playArea; every geometry piece is island or case extra; the tower and its door are inside', () => {
    for (const id of CASE_IDS) {
      const m = caseMap(id);
      const w = m.world!;
      const island = buildIsland(CASES[id]);
      const area = w.playArea!;
      expect(area, `${id}.playArea`).toBeDefined();
      expect(m.bounds).toEqual(area.bounds);
      expect(m.playerStart).toEqual(area.playerStart);
      expect(m.patrol).toEqual(area.hydePatrol);
      expect(m.safeReleasePoints).toEqual(area.safeReleasePoints);
      const side = [area.bounds.maxX - area.bounds.minX, area.bounds.maxZ - area.bounds.minZ];
      for (const sd of side) expect(sd, `${id} side`).toBeGreaterThanOrEqual(50);
      for (const sd of side) expect(sd, `${id} side`).toBeLessThanOrEqual(75);
      for (const x of m.walls) expect(island.walls.some((y) => y.id === x.id), x.id).toBe(true);
      for (const x of w.extraWalls) {
        const inB = [x.a, x.b].some((p) => p.x >= area.bounds.minX - 1 && p.x <= area.bounds.maxX + 1 && p.z >= area.bounds.minZ - 1 && p.z <= area.bounds.maxZ + 1);
        if (inB) expect(m.walls.some((y) => y.id === x.id), x.id).toBe(true);
      }
      for (const x of w.extraHiding) expect(m.hidingSpots.some((y) => y.id === x.id), `${id} ${x.id}`).toBe(true);
      expect(pointInPolygon(m.tower.x, m.tower.z, [
        { x: area.bounds.minX, z: area.bounds.minZ }, { x: area.bounds.minX, z: area.bounds.maxZ },
        { x: area.bounds.maxX, z: area.bounds.maxZ }, { x: area.bounds.maxX, z: area.bounds.minZ },
      ])).toBe(true);
      expect(m.rooms.map((r) => [r.id, r.polygon])).toEqual(island.rooms.map((r) => [r.id, r.polygon]));
      for (const [room, name] of Object.entries(CASES[id].roomNames)) expect(m.rooms.find((r) => r.id === room)!.name).toBe(name);
    }
  });

  it('solid ids are unique per case map', () => {
    for (const id of CASE_IDS) {
      const m = caseMap(id);
      const ids = [...m.walls.map((w) => w.id), ...m.cover.map((c) => c.id), ...m.hidingSpots.map((h) => h.id)];
      expect(new Set(ids).size, id).toBe(ids.length);
    }
  });

  it('different cases use different candidate sites (no two cases share the same site set)', () => {
    const key = (id: CaseId) => sitesOf(caseMap(id)).map((s) => `${s.site.x},${s.site.z}`).sort().join('|');
    expect(new Set(CASE_IDS.map(key)).size).toBe(3);
  });
});

for (const id of CASE_IDS) {
  const def = CASES[id];
  const map = caseMap(id);
  const w = map.world!;
  const world = new World(map, T.nav.lowCoverBlocksMovement); // gate + passage closed
  const player = new NavGrid(world, T.player.radius, T.nav.cellM);
  const hyde = new NavGrid(world, T.hyde.radius, T.nav.cellM);
  const startComp = player.componentAt(map.playerStart);
  const hydeComp = hyde.componentAt(map.hydeStart);
  const sites = sitesOf(map);

  describe(`${def.number} ${def.title}: priors, spawns, zones on ${map.id}`, () => {
    it('clue groups are exactly the case clues; priors sum to 1 per group and over the egg sites; spawn weights sum to 1 (±1e-9)', () => {
      expect(w.clueSites.map((g) => g.clueId).sort()).toEqual(def.clues.map((c) => c.id).sort());
      for (const g of w.clueSites) {
        expect(g.sites.length, g.clueId).toBeGreaterThanOrEqual(1);
        expectSumsToOne(g.sites.map((s) => s.prior), g.clueId);
        for (const s of g.sites) expect(s.prior, s.id).toBeGreaterThan(0);
        expect(g.searchS).toBeGreaterThanOrEqual(1.5);
        expect(g.searchS).toBeLessThanOrEqual(4);
      }
      expectSumsToOne(w.eggSites.map((s) => s.prior), 'egg sites');
      for (const s of w.eggSites) expect(s.prior, s.id).toBeGreaterThan(0);
      expectSumsToOne(w.hydeSpawns.map((s) => s.weight), 'spawn weights');
      expect(w.traceAccuracy).toBeGreaterThan(0.5);
      expect(w.traceAccuracy).toBeLessThan(1);
      const ids = sites.map((s) => s.site.id);
      expect(new Set(ids).size).toBe(ids.length);
      for (const s of sites) expect(w.areas.map((a) => a.id), s.tag).toContain(s.site.areaId);
    });

    it(`every Hyde spawn is ≥ ${T.hyde.minSpawnM} m from the start, in its zone, on the Hyde's grid (patrol component)`, () => {
      for (const s of w.hydeSpawns) {
        expect(Math.hypot(s.x - map.playerStart.x, s.z - map.playerStart.z), s.id).toBeGreaterThanOrEqual(T.hyde.minSpawnM);
        const z = w.zones.find((zz) => zz.id === s.zoneId);
        expect(z, `${s.id} zone ${s.zoneId}`).toBeTruthy();
        expect(pointInPolygon(s.x, s.z, z!.polygon), `${s.id} inside ${s.zoneId}`).toBe(true);
        const snapped = hyde.nearestWalkable(s, 1.0, hydeComp);
        expect(snapped, `${s.id} navigable for the Hyde`).not.toBeNull();
      }
    });

    it('zones tile the walkable island: every walkable cell (gate + passage open) lies in exactly one zone', () => {
      const open = new World(map, T.nav.lowCoverBlocksMovement);
      if (map.powerSwitch) open.setWallOpen(map.powerSwitch.gateWallId, true);
      if (w.passage) open.setWallOpen(w.passage.wallId, true);
      const grid = new NavGrid(open, T.player.radius, T.nav.cellM);
      const bad: string[] = [];
      for (let i = 0; i < grid.blocked.length; i++) {
        if (grid.blocked[i]) continue;
        const c = grid.center(i);
        const n = w.zones.filter((z) => pointInPolygon(c.x, c.z, z.polygon)).length;
        if (n !== 1 && bad.length < 5) bad.push(`(${c.x}, ${c.z}) in ${n} zones`);
      }
      expect(bad).toEqual([]);
    });
  });

  describe(`${def.number} ${def.title}: every candidate site`, () => {
    it('lies in its declared room (first-match room order), inside the bounds, ≥ 0.3 m clear of every wall / cover', () => {
      for (const { tag, site } of sites) {
        expect(roomAt(map, site), tag).toBe(site.roomId);
        const c = clearance(world, site);
        expect(c.d, `${tag} vs ${c.id}`).toBeGreaterThanOrEqual(0.3);
        expect(site.x > map.bounds.minX + 1 && site.x < map.bounds.maxX - 1 && site.z > map.bounds.minZ + 1 && site.z < map.bounds.maxZ - 1, tag).toBe(true);
      }
    });

    it('is ≥ 3 m from every other candidate site (clue or egg)', () => {
      for (const a of sites) for (const b of sites) {
        if (a === b) continue;
        expect(Math.hypot(a.site.x - b.site.x, a.site.z - b.site.z), `${a.tag} ↔ ${b.tag}`).toBeGreaterThanOrEqual(3);
      }
    });

    it(`is reachable from the pier with the gate AND the passage closed (within ${APPROACH.toFixed(1)} m, no wall between)`, () => {
      expect(startComp).toBeGreaterThanOrEqual(0);
      for (const { tag, site } of sites) expect(approachCells(player, world, startComp, site, APPROACH).length, tag).toBeGreaterThan(0);
      const tower = { x: map.tower.x, z: map.tower.z };
      expect(approachCells(player, world, startComp, tower, map.tower.radius - 0.8).length, 'tower').toBeGreaterThan(0);
    });

    it('the Hyde can reach every site and the tower (≤ interact range + 1 m)', () => {
      for (const { tag, site } of sites) expect(approachCells(hyde, world, hydeComp, site, R + 1).length, tag).toBeGreaterThan(0);
      expect(approachCells(hyde, world, hydeComp, map.tower, R + 1).length, 'tower').toBeGreaterThan(0);
    });

    it('can never be interacted with through a wall', () => {
      for (const { tag, site } of sites) expect(throughWallCells(player, world, site), tag).toEqual([]);
    });

    it('in the sim: with the item drawn there, standing at the nearest approach cell offers exactly it on E', () => {
      for (const { tag, site, kind } of sites) {
        const run = new MysteryRun({ duo: { characterId: 'wednesday', pokemonId: 'gengar' }, seed: `reach-${id}`, caseDef: def, layout: layoutWith(map, kind, site.id) });
        const at = approachCells(player, world, startComp, site, APPROACH)[0]?.at;
        expect(at, tag).toBeTruthy();
        run.player.x = at!.x;
        run.player.z = at!.z;
        if (kind === 'clue') {
          const g = w.clueSites.find((x) => x.sites.includes(site))!;
          expect(run.interactable(), tag).toMatchObject({ kind: 'clue', id: g.clueId, label: def.clues.find((c) => c.id === g.clueId)!.interactLabel });
        } else {
          run.cluesFound.push(...def.clues.map((c) => c.id));
          expect(run.interactable(), tag).toMatchObject({ kind: 'egg' });
          expect(run.egg, tag).toMatchObject({ state: 'resting', x: site.x, z: site.z });
        }
      }
    });
  });

  describe(`${def.number} ${def.title}: case structures`, () => {
    it(`extra walls keep every doorway ≥ ${DOORWAY_M} m and every corridor ≥ ${CORRIDOR_M} m clear (gaps < ${CLOSED_GAP_M} m are closed joins)`, () => {
      const extras = world.walls.filter((c) => extraIds(id).has(c.id));
      const bad: string[] = [];
      for (const e of extras) {
        for (const o of world.walls) {
          if (o.id === e.id) continue;
          const { gap, corridor } = wallGap(e, o);
          if (gap < CLOSED_GAP_M) continue;
          if (KNOWN_NARROW.has(`${e.id}|${o.id}`)) continue;
          if (gap < (corridor ? CORRIDOR_M : DOORWAY_M)) bad.push(`${e.id} ↔ ${o.id}: ${gap.toFixed(2)} m ${corridor ? 'corridor' : 'doorway'}`);
        }
      }
      expect(bad).toEqual([]);
    });

    it('extra walls / cover never block a patrol segment (≥ 0.6 m + radius from every leg, incl. last → first)', () => {
      const pts = map.patrol;
      const extraWalls = w.extraWalls.map((x) => ({ id: x.id, ax: x.a.x, az: x.a.z, bx: x.b.x, bz: x.b.z, r: x.thickness / 2 }));
      const extraCover = w.extraCover.map((c) => ({ id: c.id, ax: c.x, az: c.z, bx: c.x, bz: c.z, r: c.radius }));
      const bad: string[] = [];
      for (let i = 0; i < pts.length; i++) {
        const a = pts[i];
        const b = pts[(i + 1) % pts.length];
        for (const s of [...extraWalls, ...extraCover]) {
          const d = Math.sqrt(segSegDist2(a.x, a.z, b.x, b.z, s.ax, s.az, s.bx, s.bz)) - s.r;
          if (d < 0.6) bad.push(`P${i}→P${(i + 1) % pts.length} vs ${s.id}: ${d.toFixed(2)} m`);
        }
      }
      expect(bad).toEqual([]);
      for (const p of pts) expect(hyde.reachable(map.hydeStart, p, 1), `waypoint ${p.x},${p.z}`).toBe(true);
    });

    it('examines and the passage lever can be reached and used (no wall between)', () => {
      for (const ex of w.examines) expect(approachCells(player, world, startComp, ex, APPROACH).length, ex.id).toBeGreaterThan(0);
      if (w.passage) {
        const lever = { x: w.passage.leverX, z: w.passage.leverZ };
        expect(approachCells(player, world, startComp, lever, APPROACH).length, 'lever').toBeGreaterThan(0);
      }
    });

    it('the passage opens one of the case walls and is a real shortcut (≥ 10 m) — never required (sites reachable closed)', () => {
      const pass = w.passage;
      if (!pass) return;
      expect(w.extraWalls.map((x) => x.id)).toContain(pass.wallId);
      const wall = map.walls.find((x) => x.id === pass.wallId)!;
      const mid = { x: (wall.a.x + wall.b.x) / 2, z: (wall.a.z + wall.b.z) / 2 };
      const len = Math.hypot(wall.b.x - wall.a.x, wall.b.z - wall.a.z) || 1;
      const nx = -(wall.b.z - wall.a.z) / len;
      const nz = (wall.b.x - wall.a.x) / len;
      const off = wall.thickness / 2 + 1.5;
      const sideA = player.nearestWalkable({ x: mid.x + nx * off, z: mid.z + nz * off }, 2)!;
      const sideB = player.nearestWalkable({ x: mid.x - nx * off, z: mid.z - nz * off }, 2)!;
      expect(sideA && sideB, 'both sides of the passage wall are walkable').toBeTruthy();
      expect(player.reachable(sideA, map.playerStart), 'side A reachable with the passage closed').toBe(true);
      expect(player.reachable(sideB, map.playerStart), 'side B reachable with the passage closed').toBe(true);
      const open = new World(map, T.nav.lowCoverBlocksMovement);
      open.setWallOpen(pass.wallId, true);
      const openGrid = new NavGrid(open, T.player.radius, T.nav.cellM);
      const closedLen = pathLength(sideA, player.findPath(sideA, sideB)!);
      const openLen = pathLength(sideA, openGrid.findPath(sideA, sideB)!);
      expect(closedLen - openLen, `closed ${closedLen.toFixed(1)} m vs open ${openLen.toFixed(1)} m`).toBeGreaterThanOrEqual(10);
    });

    it('hazards lie inside the bounds', () => {
      const b = map.bounds;
      for (const h of w.hazards) {
        const pts = h.kind === 'noisy_floor' ? h.polygon : [{ x: h.x, z: h.z }];
        for (const p of pts) expect(p.x >= b.minX && p.x <= b.maxX && p.z >= b.minZ && p.z <= b.maxZ, h.id).toBe(true);
      }
    });
  });
}

/**
 * Tight spots the designer flagged (docs/MYSTERY_DESIGN.md §10.6): both the player and the Hyde get through them on the
 * gate- and passage-closed grids, along a sane path, and the measured clear width matches the design (≥ 3 m).
 */
describe('tight spots: player and Hyde both get through', () => {
  function grids(id: CaseId) {
    const map = caseMap(id);
    const world = new World(map, T.nav.lowCoverBlocksMovement);
    return { map, world, player: new NavGrid(world, T.player.radius, T.nav.cellM), hyde: new NavGrid(world, T.hyde.radius, T.nav.cellM) };
  }
  function clearWidth(world: World, a: string, b: string): number {
    const ca = [...world.walls, ...world.cover].find((c) => c.id === a)!;
    const cb = [...world.walls, ...world.cover].find((c) => c.id === b)!;
    return Math.sqrt(segSegDist2(ca.ax, ca.az, ca.bx, ca.bz, cb.ax, cb.az, cb.bx, cb.bz)) - ca.r - cb.r;
  }
  function through(id: CaseId, from: Vec2, to: Vec2, via: (p: Vec2) => boolean, maxDetour: number) {
    const { map, player, hyde } = grids(id);
    for (const [who, g, start] of [['player', player, map.playerStart], ['hyde', hyde, map.hydeStart]] as const) {
      expect(g.reachable(start, from, 1), `${who}: ${from.x},${from.z} reachable`).toBe(true);
      expect(g.reachable(from, to, 1), `${who}: ${to.x},${to.z} reachable`).toBe(true);
      const path = g.findPath(from, to)!;
      const end = path[path.length - 1];
      expect(Math.hypot(end.x - to.x, end.z - to.z), `${who} path ends at the goal`).toBeLessThan(0.75);
      expect(pathLength(from, path), `${who} path length`).toBeLessThan(Math.hypot(to.x - from.x, to.z - from.z) * maxDetour);
      // the path really goes through the spot: some point of the polyline (sampled) satisfies `via`
      let prev = from;
      let hit = false;
      for (const q of path) {
        for (let k = 0; k <= 10 && !hit; k++) hit = via({ x: prev.x + ((q.x - prev.x) * k) / 10, z: prev.z + ((q.z - prev.z) * k) / 10 });
        prev = q;
      }
      expect(hit, `${who} passes the tight spot`).toBe(true);
    }
  }

  // (final: the Case 02 tunnel squeeze and the Case 01 burial-vault serpentine are outside the compact play areas)

  it('Case 03: the 3.35 m corridor behind the tower (tower_e ↔ ms_fence) is the gate-free way into the restricted yard', () => {
    const { world } = grids('midnight_signal');
    expect(clearWidth(world, 'tower_e', 'ms_fence_2')).toBeGreaterThanOrEqual(3);
    through('midnight_signal', { x: 12, z: -42 }, { x: 25, z: -51 }, (p) => p.x > 13.5 && p.x < 16.9 && p.z < -50, 3);
  });
});

/** The designer's data contract (OVERHAUL_CONTRACT "Data"): shape and counts per case. */
describe('case world data contract', () => {
  for (const id of CASE_IDS) {
    const w = caseMap(id).world!;
    it(`${id}: theme, 4–6 areas, ≥ 2 sites for ≥ 2 clues, 3 egg sites in 3 areas, 3 spawns, 5–8 zones, passage, 3 examines (≥ 2 traces), hazards`, () => {
      expect(w.theme).toBe(CASES[id].prologue.scene);
      expect(w.areas.length).toBeGreaterThanOrEqual(4);
      expect(w.areas.length).toBeLessThanOrEqual(6);
      expect(w.clueSites.filter((g) => g.sites.length >= 2).length).toBeGreaterThanOrEqual(2);
      for (const g of w.clueSites) expect(g.sites.length).toBeLessThanOrEqual(3);
      expect(w.eggSites).toHaveLength(3);
      expect(new Set(w.eggSites.map((s) => s.areaId)).size).toBe(3);
      for (const s of w.eggSites) expect(s.traceText.length, s.id).toBeGreaterThan(5);
      expect(w.hydeSpawns).toHaveLength(3);
      expect(w.zones.length).toBeGreaterThanOrEqual(5);
      expect(w.zones.length).toBeLessThanOrEqual(8);
      expect(w.passage).not.toBeNull();
      expect(w.examines).toHaveLength(3);
      expect(w.examines.filter((e) => e.givesTrace).length).toBeGreaterThanOrEqual(2);
      const floors = w.hazards.filter((h) => h.kind === 'noisy_floor').length;
      const lights = w.hazards.filter((h) => h.kind === 'searchlight').length;
      if (id === 'midnight_signal') {
        expect(lights).toBeGreaterThanOrEqual(1);
        expect(lights).toBeLessThanOrEqual(2);
      } else expect(floors).toBeGreaterThanOrEqual(1);
    });
  }
});
