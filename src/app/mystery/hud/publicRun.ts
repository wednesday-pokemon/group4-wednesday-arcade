// Feature-detecting adapters over the sim's PUBLIC overhaul API (game-developer: run.investigation(), run.hydeEmerged,
// run.hydeVisible(), run.playerNav()) so the HUD keeps working against older run objects / test doubles. Nothing here
// reads the session's hidden truth (run.layout, map.clues, map.eggSpawn).
import type { CaseWorldDef, InvestigationState, MapDef, Vec2 } from '../../../mystery/types.ts';

interface OverhaulRunApi {
  investigation?: () => InvestigationState;
  hydeEmerged?: boolean;
  hydeVisible?: (() => boolean) | boolean;
  playerNav?: () => { findPath(a: Vec2, b: Vec2): Vec2[] | null };
  world?: { lineOfSight?: (px: number, pz: number, qx: number, qz: number) => boolean };
  snapshot?: () => { hydeVisible?: boolean; hydeEmerged?: boolean };
}

export function emptyInvestigation(): InvestigationState {
  return {
    checkedClueSites: [], knownClueSites: {}, checkedEggSites: [], eggSeenAt: null, traces: [], examined: [], passageOpen: false,
    hydeEmerged: true, hydeEmergedAt: 0, hydeEmergesInS: null, lastHydeSighting: null,
  };
}

/** What the player has observed (public copy), or a neutral state for runs without the overhaul API. */
export function investigationOf(run: object): InvestigationState {
  const r = run as OverhaulRunApi;
  if (typeof r.investigation === 'function') {
    try {
      return r.investigation();
    } catch {
      return emptyInvestigation();
    }
  }
  return emptyInvestigation();
}

export function hasInvestigation(run: object): boolean {
  return typeof (run as OverhaulRunApi).investigation === 'function';
}

/** The Hyde is in play (older sims: always, once playing). */
export function hydeEmergedOf(run: object, inv?: InvestigationState): boolean {
  const r = run as OverhaulRunApi;
  if (typeof r.hydeEmerged === 'boolean') return r.hydeEmerged;
  return (inv ?? investigationOf(run)).hydeEmerged;
}

/** The player can see the Hyde right now (sim rule: emerged ∧ LOS ∧ ≤ playerSeesHydeM). */
export function hydeVisibleOf(run: object): boolean {
  const r = run as OverhaulRunApi;
  if (typeof r.hydeVisible === 'function') return r.hydeVisible();
  if (typeof r.hydeVisible === 'boolean') return r.hydeVisible;
  try {
    return !!r.snapshot?.().hydeVisible;
  } catch {
    return false;
  }
}

/** The case world of the run (MapDef.world, design data). */
export function worldOf(map: Pick<MapDef, 'world'>): CaseWorldDef | null {
  return map.world ?? null;
}

/** Line of sight through walls + high cover (the sim's World), or true when the run does not expose it. */
export function lineOfSightOf(run: object): (a: Vec2, b: Vec2) => boolean {
  const w = (run as OverhaulRunApi).world;
  if (w && typeof w.lineOfSight === 'function') return (a, b) => w.lineOfSight!(a.x, a.z, b.x, b.z);
  return () => true;
}

/** A walking route (player nav grid) or null when unavailable. */
export function routeOf(run: object, from: Vec2, to: Vec2): Vec2[] | null {
  const r = run as OverhaulRunApi;
  if (typeof r.playerNav !== 'function') return null;
  try {
    const path = r.playerNav().findPath(from, to);
    return path ? [{ x: from.x, z: from.z }, ...path] : null;
  } catch {
    return null;
  }
}
