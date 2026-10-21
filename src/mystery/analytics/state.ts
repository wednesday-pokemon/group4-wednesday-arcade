// Live-state helpers shared by the four services: duo factors (numbers only), perceivable context at a snapshot and
// the current objective target. Everything is read from the public run state; the run is never mutated.
import type { MysteryRun } from '../run.ts';
import { pathLength } from '../nav.ts';
import type { AbilityDef, AbilityEffectKind, ClueId, Vec2 } from '../types.ts';
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

/** Where the current objective points: nearest missing clue, the egg (resting / dropped) or the tower. */
export function objectiveTarget(run: MysteryRun): ObjectiveTarget | null {
  const egg = run.egg;
  const p = run.player;
  if (run.status !== 'playing') return null;
  if (egg.state === 'carried') return { kind: 'tower', x: run.map.tower.x, z: run.map.tower.z, clueId: null };
  if (egg.state === 'dropped') return { kind: 'dropped_egg', x: egg.x, z: egg.z, clueId: null };
  const missing = run.map.clues.filter((c) => !run.cluesFound.includes(c.clueId));
  if (missing.length > 0) {
    let best = missing[0];
    for (const c of missing) if (Math.hypot(c.x - p.x, c.z - p.z) < Math.hypot(best.x - p.x, best.z - p.z)) best = c;
    return { kind: 'clue', x: best.x, z: best.z, clueId: best.clueId };
  }
  if (egg.state === 'resting') return { kind: 'egg', x: egg.x, z: egg.z, clueId: null };
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
