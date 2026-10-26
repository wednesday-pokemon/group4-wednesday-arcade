// Live-state helpers shared by the four services: duo factors (numbers only), perceivable context at a snapshot and
// the current objective target. Everything is read from the public run state; the run is never mutated.
import type { MysteryRun } from '../run.ts';
import { pathLength } from '../nav.ts';
import type { AbilityDef, AbilityEffectKind, ClueId, Vec2 } from '../types.ts';
import { clueSiteProbabilities, eggPosterior } from './bayes.ts';
import { investigationOf, publicEggPosition, worldOf } from './publicState.ts';
import type { DuoFactors, LiveContext } from './types.ts';

/** Effect kinds that act on the Hyde (they can break or prevent a detection). */
export const CONTROL_KINDS: readonly AbilityEffectKind[] = ['stun', 'slow', 'distract', 'lure'];
/** Effect kinds that help the player get away or soften a grab. */
export const ESCAPE_KINDS: readonly AbilityEffectKind[] = ['speed_boost', 'dash', 'block_grab', 'egg_shield'];

export function kindsOf(def: AbilityDef): AbilityEffectKind[] {
  return def.effects.map((e) => e.kind);
}

export function hasKind(def: AbilityDef, kinds: readonly AbilityEffectKind[]): boolean {
  return def.effects.some((e) => kinds.includes(e.kind));
}

/** The selected duo as numbers (mods, derived card stats, its own F and Q definitions). */
export function duoFactorsFromRun(run: Pick<MysteryRun, 'mods' | 'card' | 'power' | 'move'>): DuoFactors {
  return { mods: { ...run.mods }, stats: { ...run.card.stats }, power: run.power.def, move: run.move.def };
}

export interface ObjectiveTarget {
  kind: 'clue' | 'egg' | 'dropped_egg' | 'tower';
  x: number;
  z: number;
  clueId: ClueId | null;
}

/**
 * Where the current objective points, from PUBLIC information only (overhaul): carrying → the tower; dropped → the
 * egg where it fell (the player saw it); missing clues → the NEAREST candidate site that may still hold an uncollected
 * clue (posterior > 0; a known site when the clue was seen); otherwise the egg's seen site, else its most probable
 * candidate site (Bayesian; ties → nearest). Never the session's hidden clue / egg placement.
 */
export function objectiveTarget(run: MysteryRun): ObjectiveTarget | null {
  const egg = run.egg;
  const p = run.player;
  if (run.status !== 'playing') return null;
  if (egg.state === 'carried') return { kind: 'tower', x: run.map.tower.x, z: run.map.tower.z, clueId: null };
  const world = worldOf(run);
  const inv = investigationOf(run);
  if (egg.state === 'dropped') {
    const at = publicEggPosition(run, inv, world);
    return at ? { kind: 'dropped_egg', x: at.x, z: at.z, clueId: null } : null;
  }
  if (!world) return null;
  const d = (q: Vec2) => Math.hypot(q.x - p.x, q.z - p.z);
  if (run.cluesFound.length < run.caseDef.clues.length) {
    const sites = clueSiteProbabilities(world, inv, run.cluesFound).filter((s) => s.p > 1e-9);
    if (sites.length > 0) {
      let best = sites[0];
      for (const s of sites) if (d(s) < d(best)) best = s;
      return { kind: 'clue', x: best.x, z: best.z, clueId: best.clueId };
    }
  }
  if (egg.state === 'resting') {
    const post = eggPosterior(world, inv);
    let best: { x: number; z: number; p: number } | null = null;
    for (const s of post) {
      const def = world.eggSites.find((e) => e.id === s.siteId);
      if (!def) continue;
      if (!best || s.p > best.p + 1e-9 || (Math.abs(s.p - best.p) <= 1e-9 && d(def) < d(best))) best = { x: def.x, z: def.z, p: s.p };
    }
    if (best) return { kind: 'egg', x: best.x, z: best.z, clueId: null };
  }
  return null;
}

/** Nav-path length from the player to `goal` if the goal is reachable (path ends within `tolM` of it), else null. */
export function navDistance(run: MysteryRun, goal: Vec2, tolM = 1.5): number | null {
  const p = run.player;
  const nav = run.playerNav();
  const path = nav.findPath(p, goal);
  if (!path) return null;
  const end = path.length ? path[path.length - 1] : { x: p.x, z: p.z };
  if (Math.hypot(end.x - goal.x, end.z - goal.z) > tolM) return null;
  return pathLength(p, path);
}

export interface LiveContextOptions {
  /** Compute the nav distance to the objective (one A* query). Default true. */
  objectivePath?: boolean;
}

/** Perceivable extras at this instant (positions, Hyde facing, fog, cover, objective distance). */
export function liveContext(run: MysteryRun, o: LiveContextOptions = {}): LiveContext {
  const p = run.player;
  const h = run.hyde;
  const dx = p.x - h.x;
  const dz = p.z - h.z;
  const d = Math.hypot(dx, dz);
  // Hyde forward = (−sin yaw, −cos yaw) (contract convention)
  const fx = -Math.sin(h.yaw);
  const fz = -Math.cos(h.yaw);
  const hydeFacingCos = d > 1e-6 ? (fx * dx + fz * dz) / d : 1;
  let hidingSpotDistM = Infinity;
  for (const s of run.map.hidingSpots) hidingSpotDistM = Math.min(hidingSpotDistM, Math.hypot(s.x - p.x, s.z - p.z));
  let objectiveDistM: number | null = null;
  if (o.objectivePath !== false) {
    const goal = objectiveTarget(run);
    if (goal) objectiveDistM = navDistance(run, goal, 2.5);
  }
  const t = run.t;
  const neutralized = t < h.stunnedUntil || t < h.distractedUntil || t < run.fx.lureUntil;
  return {
    x: r2(p.x), z: r2(p.z), hydeX: r2(h.x), hydeZ: r2(h.z),
    hydeFacingCos: Math.round(hydeFacingCos * 1000) / 1000,
    inFog: run.inFog(p.x, p.z),
    hidingSpotDistM: Number.isFinite(hidingSpotDistM) ? r2(hidingSpotDistM) : 99,
    objectiveDistM: objectiveDistM === null ? null : r2(objectiveDistM),
    noiseRadiusM: run.noiseRadiusM(),
    hydeNeutralized: neutralized,
  };
}

export function r2(x: number): number {
  return Math.round(x * 100) / 100;
}

export function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x;
}
