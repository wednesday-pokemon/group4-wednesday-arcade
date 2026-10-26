// Default content for a run: the designer's island (dressed for a case), the case, registries and tuning.
//
// Compact maps (docs/final/FINAL_CONTRACT.md §3): when the case world has a `playArea`, caseMap() fences the island in to
// it AFTER buildIsland (data/island.ts stays the designer's): bounds, player start, Hyde patrol (= playArea.hydePatrol),
// Hyde start (first patrol waypoint), safe release points and the tutorial practice point come from the play area; walls /
// cover / hiding spots / landmarks wholly outside the bounds (+ PLAY_AREA_MARGIN_M) are dropped, and Gomez's power switch
// is dropped when it (or its gate) lies outside, or when it cannot be walked to from the start (dropUnreachableSwitch). Nav grids, the minimap and the renderer follow `map.bounds`.
import { DEFAULT_TUNING, type SimTuning } from './config.ts';
import { caseById, POISONED_ARCHIVE } from './data/cases.ts';
import { buildIsland, ISLAND_BASE_ID, PRACTICE_CRATE } from './data/island.ts';
import { REGISTRIES, type Registries } from './draft.ts';
import { segSegDist2, World } from './geometry.ts';
import { navGridFor } from './nav.ts';
import type { CaseDef, CaseId, MapDef, PlayAreaDef, Vec2, WallDef } from './types.ts';

const islands = new Map<CaseId, MapDef>();

/** Geometry this close outside the play-area bounds is kept (boundary walls straddle the edge). */
export const PLAY_AREA_MARGIN_M = 1.5;

/** The shared, read-only map for a case (one instance per case so nav grids are cached once per process). */
export function caseMap(caseId: CaseId): MapDef {
  let m = islands.get(caseId);
  if (!m) {
    m = dropUnreachableSwitch(applyPlayArea(buildIsland(caseById(caseId))));
    islands.set(caseId, m);
  }
  return m;
}

type Bounds = MapDef['bounds'];

function inBounds(b: Bounds, x: number, z: number, margin: number): boolean {
  return x >= b.minX - margin && x <= b.maxX + margin && z >= b.minZ - margin && z <= b.maxZ + margin;
}

/** Does a wall capsule touch the (margin-expanded) bounds rectangle? */
function wallTouches(b: Bounds, w: WallDef, margin: number): boolean {
  const r = w.thickness / 2 + margin;
  if (inBounds(b, w.a.x, w.a.z, r) || inBounds(b, w.b.x, w.b.z, r)) return true;
  const edges: [number, number, number, number][] = [
    [b.minX, b.minZ, b.maxX, b.minZ], [b.maxX, b.minZ, b.maxX, b.maxZ], [b.maxX, b.maxZ, b.minX, b.maxZ], [b.minX, b.maxZ, b.minX, b.minZ],
  ];
  return edges.some(([ax, az, bx, bz]) => segSegDist2(w.a.x, w.a.z, w.b.x, w.b.z, ax, az, bx, bz) <= r * r);
}

/**
 * The case map fenced in to `map.world.playArea` (unchanged when there is none). Pure: a new MapDef, the input untouched.
 */
export function applyPlayArea(map: MapDef, area: PlayAreaDef | undefined = map.world?.playArea): MapDef {
  if (!area) return map;
  const b = { ...area.bounds };
  const M = PLAY_AREA_MARGIN_M;
  const patrol = area.hydePatrol.length > 0 ? area.hydePatrol.map((p) => ({ ...p })) : map.patrol.filter((p) => inBounds(b, p.x, p.z, 0));
  const first = patrol[0] ?? { x: (b.minX + b.maxX) / 2, z: (b.minZ + b.maxZ) / 2 };
  const second = patrol[1] ?? first;
  const walls = map.walls.filter((w) => wallTouches(b, w, M));
  const sw = map.powerSwitch;
  const keepSwitch = sw && inBounds(b, sw.x, sw.z, 0) && walls.some((w) => w.id === sw.gateWallId);
  const out: MapDef = {
    ...map,
    bounds: b,
    playerStart: { ...area.playerStart },
    hydeStart: { x: first.x, z: first.z, yaw: Math.atan2(-(second.x - first.x), -(second.z - first.z)) || 0 },
    patrol,
    walls,
    cover: map.cover.filter((c) => inBounds(b, c.x, c.z, c.radius + M)),
    hidingSpots: map.hidingSpots.filter((h) => inBounds(b, h.x, h.z, 0)),
    safeReleasePoints: area.safeReleasePoints.length > 0 ? area.safeReleasePoints.map((p) => ({ ...p })) : map.safeReleasePoints.filter((p) => inBounds(b, p.x, p.z, 0)),
    landmarks: map.landmarks.filter((l) => inBounds(b, l.x, l.z, M)),
  };
  if (!keepSwitch) delete out.powerSwitch;
  return out;
}

/**
 * Gomez's power switch is useless (and its prompt misleading) when the player cannot walk to it from the start with every
 * gate closed (compact areas can cut off the alley's other entrance): it is dropped then.
 */
export function dropUnreachableSwitch(map: MapDef): MapDef {
  const sw = map.powerSwitch;
  if (!sw || !map.world?.playArea) return map;
  const T = DEFAULT_TUNING;
  const nav = navGridFor(map, new World(map, T.nav.lowCoverBlocksMovement), T.player.radius, T.nav.cellM, T.nav.lowCoverBlocksMovement);
  if (nav.reachable(map.playerStart, sw, T.player.interactRangeM)) return map;
  const out = { ...map };
  delete out.powerSwitch;
  return out;
}

/** The default island (Case 01 placements). */
export function defaultMap(): MapDef {
  return caseMap(POISONED_ARCHIVE.id);
}

export function defaultCase(): CaseDef {
  return POISONED_ARCHIVE;
}

export function defaultRegistries(): Registries {
  return REGISTRIES;
}

export function defaultTuning(): SimTuning {
  return DEFAULT_TUNING;
}

/**
 * The tutorial practice crate: the case's playArea.practicePoint when the map has one, the pier crate on the designer's
 * island (any case) otherwise, else null.
 */
export function practiceCrateFor(map: MapDef): Vec2 | null {
  const pp = map.world?.playArea?.practicePoint;
  if (pp) return { x: pp.x, z: pp.z };
  return map.id === ISLAND_BASE_ID || map.id.startsWith(`${ISLAND_BASE_ID}:`) ? { x: PRACTICE_CRATE.x, z: PRACTICE_CRATE.z } : null;
}
