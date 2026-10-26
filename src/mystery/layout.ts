// Session layout (docs/overhaul/OVERHAUL_CONTRACT.md "Sim rules" 1, 3, 6). PURE: imports only types + the keyed PRF, so
// analytics, tests (and, if ever needed, the Edge Functions) can reproduce every draw exactly.
//
// Draw rules (all keyed on the session seed, independent of each other):
//   clue site   prfUniform(seed, 'site:<clueId>') against the cumulative priors of that clue's sites (group order)
//   egg site    prfUniform(seed, 'site:egg') against the cumulative egg-site priors (never 'egg:tier')
//   trace       u = prfUniform(seed, 'trace:<sourceId>'); u < a (world.traceAccuracy) → the true egg site; else the other
//               sites in eggSites order, index floor((u − a) / (1 − a) × (n − 1))
//   Hyde spawn  prfUniform(seed, 'hyde:spawn') over the weights of the spawns ≥ minSpawnM (straight line) from the player,
//               renormalised (spawn order); none valid (or zero total weight) → the farthest spawn
// "Cumulative against priors": pick the first item whose running sum exceeds u × total (total = Σ priors, 1 in valid data).
//
// The session map shares every geometry array (walls, cover, hiding spots, rooms, patrol …) with the case map, so nav
// grids (cached per walls/cover arrays, see nav.ts) are built once per process, not once per run.
import { prfUniform } from './prf.ts';
import type {
  CaseWorldDef, ClueId, CluePlacement, EggSiteDef, EggTrace, HydeSpawnDef, InvestigationState, MapDef, SessionLayout, SiteDef, Vec2,
} from './types.ts';

/** Index of the item drawn by `u` ∈ [0, 1) against the cumulative weights (first whose running sum exceeds u × total). */
export function pickCumulative<T>(items: readonly T[], weight: (item: T) => number, u: number): number {
  if (items.length === 0) return -1;
  let total = 0;
  for (const it of items) total += Math.max(0, weight(it));
  if (!(total > 0)) return 0;
  const target = u * total;
  let acc = 0;
  for (let i = 0; i < items.length; i++) {
    acc += Math.max(0, weight(items[i]));
    if (target < acc) return i;
  }
  return items.length - 1; // u × total rounding at the very top
}

/** The hidden per-session draw of one clue site per clue group and one egg site. */
export function drawLayout(world: CaseWorldDef, seed: string): SessionLayout {
  const clueSites: Partial<Record<ClueId, string>> = {};
  for (const g of world.clueSites) {
    const i = pickCumulative(g.sites, (s) => s.prior, prfUniform(seed, `site:${g.clueId}`));
    if (i >= 0) clueSites[g.clueId] = g.sites[i].id;
  }
  const e = pickCumulative(world.eggSites, (s) => s.prior, prfUniform(seed, 'site:egg'));
  return { clueSites, eggSiteId: e >= 0 ? world.eggSites[e].id : '' };
}

export function clueSiteById(world: CaseWorldDef, clueId: ClueId, siteId: string | undefined): SiteDef | null {
  const g = world.clueSites.find((x) => x.clueId === clueId);
  return g?.sites.find((s) => s.id === siteId) ?? null;
}

export function eggSiteById(world: CaseWorldDef, siteId: string | null | undefined): EggSiteDef | null {
  return world.eggSites.find((s) => s.id === siteId) ?? null;
}

/**
 * The session map: `base` (a case map with `world`) with `clues` / `eggSpawn` moved to the drawn sites. Every other field
 * (walls, cover, rooms, patrol, world …) is the SAME object as in `base`.
 */
export function sessionMap(base: MapDef, layout: SessionLayout): MapDef {
  const world = base.world;
  if (!world) return base;
  const clues: CluePlacement[] = world.clueSites.map((g) => {
    const s = clueSiteById(world, g.clueId, layout.clueSites[g.clueId]) ?? g.sites[0];
    return { clueId: g.clueId, roomId: s.roomId, x: s.x, z: s.z, searchS: g.searchS };
  });
  const egg = eggSiteById(world, layout.eggSiteId) ?? world.eggSites[0];
  return { ...base, clues, eggSpawn: egg ? { x: egg.x, z: egg.z } : { ...base.eggSpawn } };
}

/**
 * The layout an explicit map already encodes (tests / fixtures pass `map`): each placement matched to the site of its
 * group within 0.75 m, the egg likewise. Unmatched entries are left out ('' for the egg).
 */
export function layoutFromMap(map: MapDef): SessionLayout {
  const world = map.world;
  const clueSites: Partial<Record<ClueId, string>> = {};
  if (!world) return { clueSites, eggSiteId: '' };
  const near = <S extends Vec2>(sites: readonly S[], p: Vec2): S | null => {
    let best: S | null = null;
    let bestD = 0.75;
    for (const s of sites) {
      const d = Math.hypot(s.x - p.x, s.z - p.z);
      if (d <= bestD) {
        bestD = d;
        best = s;
      }
    }
    return best;
  };
  for (const c of map.clues) {
    const g = world.clueSites.find((x) => x.clueId === c.clueId);
    const s = g ? near(g.sites, c) : null;
    if (s) clueSites[c.clueId] = (s as SiteDef).id;
  }
  const e = near(world.eggSites, map.eggSpawn);
  return { clueSites, eggSiteId: e ? e.id : '' };
}

/** Index into `others` (the n − 1 non-true sites in eggSites order) for a wrong trace, or −1 for the true site. */
export function traceOffset(u: number, accuracy: number, n: number): number {
  const a = Math.max(0, Math.min(1, accuracy));
  if (n <= 1 || u < a || a >= 1) return -1;
  return Math.min(n - 2, Math.max(0, Math.floor(((u - a) / (1 - a)) * (n - 1))));
}

/** The egg site a trace from `sourceId` points at, for a session whose true egg site is `trueSiteId`. */
export function traceSiteFor(world: CaseWorldDef, trueSiteId: string, seed: string, sourceId: string): string {
  const sites = world.eggSites;
  const k = traceOffset(prfUniform(seed, `trace:${sourceId}`), world.traceAccuracy, sites.length);
  if (k < 0) return trueSiteId;
  const others = sites.filter((s) => s.id !== trueSiteId);
  return others[k]?.id ?? trueSiteId;
}

/** One spawn's probability for the player's current position (structurally = analytics SpawnProb). */
export interface SpawnChance { spawnId: string; name: string; zoneId: string; x: number; z: number; p: number }

function validSpawns(world: CaseWorldDef, player: Vec2, minSpawnM: number): { valid: HydeSpawnDef[]; total: number } {
  const valid = world.hydeSpawns.filter((s) => Math.hypot(s.x - player.x, s.z - player.z) >= minSpawnM);
  let total = 0;
  for (const s of valid) total += Math.max(0, s.weight);
  return { valid, total };
}

function farthestSpawn(world: CaseWorldDef, player: Vec2): HydeSpawnDef | null {
  let best: HydeSpawnDef | null = null;
  let bestD = -1;
  for (const s of world.hydeSpawns) {
    const d = Math.hypot(s.x - player.x, s.z - player.z);
    if (d > bestD) {
      bestD = d;
      best = s;
    }
  }
  return best;
}

/**
 * EXACT emergence distribution for a player standing at `player` right now (all spawns, world order): the valid spawns'
 * weights renormalised, 0 for spawns closer than `minSpawnM`; if none is valid (or the valid weights sum to 0) the
 * farthest spawn gets p = 1. This is what the sim draws from at emergence.
 */
export function spawnDistribution(world: CaseWorldDef, player: Vec2, minSpawnM: number): SpawnChance[] {
  const { valid, total } = validSpawns(world, player, minSpawnM);
  const far = total > 0 ? null : farthestSpawn(world, player);
  return world.hydeSpawns.map((s) => ({
    spawnId: s.id, name: s.name, zoneId: s.zoneId, x: s.x, z: s.z,
    p: far ? (s === far ? 1 : 0) : valid.includes(s) ? Math.max(0, s.weight) / total : 0,
  }));
}

/** The spawn the sim emerges at (PRF 'hyde:spawn' against `spawnDistribution`). Null only for a world without spawns. */
export function drawHydeSpawn(world: CaseWorldDef, seed: string, player: Vec2, minSpawnM: number): HydeSpawnDef | null {
  const { valid, total } = validSpawns(world, player, minSpawnM);
  if (!(total > 0)) return farthestSpawn(world, player);
  const i = pickCumulative(valid, (s) => s.weight, prfUniform(seed, 'hyde:spawn'));
  return valid[i] ?? farthestSpawn(world, player);
}

// ------------------------------------------------------------------------------------------- public-knowledge posteriors
// The contract's Bayesian model (OVERHAUL_CONTRACT "Analytics"), from PUBLIC data only (world priors + InvestigationState).
// The bot plans with these; analytics owns its own implementation and must agree with them.

type PublicInvestigation = Pick<InvestigationState, 'checkedEggSites' | 'eggSeenAt' | 'traces' | 'checkedClueSites' | 'knownClueSites'>;

/** P(egg at site i | observations), eggSites order: prior × Π trace likelihoods, checked-empty → 0, seen → 1. */
export function eggSitePosterior(world: CaseWorldDef, inv: Pick<PublicInvestigation, 'checkedEggSites' | 'eggSeenAt' | 'traces'>): number[] {
  const sites = world.eggSites;
  const n = sites.length;
  if (inv.eggSeenAt) return sites.map((s) => (s.id === inv.eggSeenAt ? 1 : 0));
  const a = world.traceAccuracy;
  const w = sites.map((s) => {
    if (inv.checkedEggSites.includes(s.id)) return 0;
    let l = Math.max(0, s.prior);
    for (const tr of inv.traces as readonly EggTrace[]) l *= tr.siteId === s.id ? a : n > 1 ? (1 - a) / (n - 1) : 1;
    return l;
  });
  const total = w.reduce((x, y) => x + y, 0);
  return total > 0 ? w.map((x) => x / total) : sites.map(() => 1 / Math.max(1, n));
}

/** P(clue at site | observations) for one clue group (group order): known → 1, checked-empty → 0, else prior renormalised. */
export function clueSitePosterior(world: CaseWorldDef, clueId: ClueId, inv: Pick<PublicInvestigation, 'checkedClueSites' | 'knownClueSites'>): number[] {
  const g = world.clueSites.find((x) => x.clueId === clueId);
  if (!g) return [];
  const known = inv.knownClueSites[clueId];
  if (known) return g.sites.map((s) => (s.id === known ? 1 : 0));
  const w = g.sites.map((s) => (inv.checkedClueSites.includes(s.id) ? 0 : Math.max(0, s.prior)));
  const total = w.reduce((x, y) => x + y, 0);
  return total > 0 ? w.map((x) => x / total) : g.sites.map(() => 1 / Math.max(1, g.sites.length));
}
