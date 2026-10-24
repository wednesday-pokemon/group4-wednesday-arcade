// The PUBLIC view of a live run for the analytics layer (overhaul). Every player-facing estimate (egg / clue posteriors,
// Hyde zones, advice targets, objective distances) is computed from what this module returns: the case world (priors,
// sites, zones — public design data) + `run.investigation()` (what the player has observed) + the player's own state.
// It never reads the session's hidden truth (`run.layout`, `map.clues`, `map.eggSpawn`, a resting egg's position);
// tests/unit/mystery-analytics/leakage.test.ts scans the analytics sources for those reads.
//
// Feature detection: the overhauled sim adds `run.investigation()`, `run.hydeEmerged` and real `hydeVisible` snapshots.
// Until a run object has them (older sims, test doubles), the adapters fall back to a neutral state: nothing observed,
// the Hyde present from t = 0, and visibility computed with the contract rule (LOS within playerSeesHydeM).
import { caseWorld } from '../data/caseWorlds.ts';
import type { MysteryRun } from '../run.ts';
import { polygonCentroid, type CrackstoneBrain } from '../crackstone.ts';
import type { CrackstoneTuning } from '../config.ts';
import type {
  ActiveEffects, CaseWorldDef, ClueId, CrackstoneDef, CrackstoneMode, CrackstoneRuntime, InvestigationState, Vec2,
} from '../types.ts';

/** Default `sight.playerSeesHydeM` when the tuning does not define it yet (contract §8). */
export const DEFAULT_PLAYER_SEES_HYDE_M = 30;
/** Default `hyde.minSpawnDistanceM` (the designer's tuning value). */
export const DEFAULT_MIN_SPAWN_M = 25;

type RunView = Pick<MysteryRun, 'map' | 'caseDef' | 'player' | 'hyde' | 'egg' | 'cluesFound' | 't' | 'tuning' | 'world' | 'status'>;

interface OverhaulRun {
  investigation?: () => InvestigationState;
  hydeEmerged?: boolean;
}

/** The case world of the run: `map.world` (overhaul maps carry it) or the case's data. */
export function worldOf(run: Pick<MysteryRun, 'map' | 'caseDef'>): CaseWorldDef | null {
  if (run.map.world) return run.map.world;
  try {
    return caseWorld(run.caseDef.id) ?? null;
  } catch {
    return null;
  }
}

/** True when the run object exposes the overhaul investigation API. */
export function hasInvestigationApi(run: object): boolean {
  return typeof (run as OverhaulRun).investigation === 'function';
}

export function emptyInvestigation(): InvestigationState {
  return {
    checkedClueSites: [], knownClueSites: {}, checkedEggSites: [], eggSeenAt: null, traces: [], examined: [], passageOpen: false,
    hydeEmerged: true, hydeEmergedAt: 0, hydeEmergesInS: null, lastHydeSighting: null,
  };
}

/** What the player has observed (a public copy from the sim), or the neutral fallback for pre-overhaul runs. */
export function investigationOf(run: object): InvestigationState {
  const r = run as OverhaulRun;
  if (typeof r.investigation === 'function') return r.investigation();
  return emptyInvestigation();
}

/** The Hyde is present (pre-overhaul sims: always). */
export function hydeEmergedOf(run: object, inv?: InvestigationState): boolean {
  const r = run as OverhaulRun;
  if (typeof r.hydeEmerged === 'boolean') return r.hydeEmerged;
  return (inv ?? investigationOf(run)).hydeEmerged;
}

function tuningNumber(run: Pick<MysteryRun, 'tuning'>, group: string, key: string): number | null {
  const g = (run.tuning as unknown as Record<string, Record<string, unknown> | undefined>)[group];
  const v = g?.[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

export function playerSeesHydeM(run: Pick<MysteryRun, 'tuning'>): number {
  return tuningNumber(run, 'sight', 'playerSeesHydeM') ?? DEFAULT_PLAYER_SEES_HYDE_M;
}

export function minSpawnM(run: Pick<MysteryRun, 'tuning'>): number {
  return tuningNumber(run, 'hyde', 'minSpawnM') ?? tuningNumber(run, 'hyde', 'minSpawnDistanceM') ?? DEFAULT_MIN_SPAWN_M;
}

/**
 * The player can see the Hyde right now (contract §8: emerged ∧ LOS through walls + high cover ∧ distance ≤
 * playerSeesHydeM). Overhaul sims report it in the snapshot; for older run objects it is computed with the same rule.
 */
export function hydeVisibleOf(run: RunView & Pick<MysteryRun, 'snapshot'> & object, snapshotVisible?: boolean): boolean {
  if (!hydeEmergedOf(run)) return false;
  if (hasInvestigationApi(run)) return typeof snapshotVisible === 'boolean' ? snapshotVisible : run.snapshot().hydeVisible === true;
  const p = run.player;
  const h = run.hyde;
  if (Math.hypot(h.x - p.x, h.z - p.z) > playerSeesHydeM(run)) return false;
  return run.world.lineOfSight(p.x, p.z, h.x, h.z);
}

/**
 * Where the player may legitimately know the Hyde is: its position while visible, else null. (A chase is public on the
 * HUD but its position is not; the zone filter treats CHASE as "near the player".)
 */
export function visibleHydePosition(run: RunView & object, visible: boolean): Vec2 | null {
  return visible ? { x: run.hyde.x, z: run.hyde.z } : null;
}

/**
 * The egg's position when the player knows it: carried (with the player), dropped (they saw it fall) or delivered;
 * a RESTING egg only once its site was seen (`eggSeenAt`), at that site's coordinates. Otherwise null — a resting egg's
 * position is the session's hidden truth.
 */
export function publicEggPosition(run: RunView & object, inv: InvestigationState, world: CaseWorldDef | null): Vec2 | null {
  const egg = run.egg;
  if (egg.state === 'carried' || egg.state === 'dropped' || egg.state === 'delivered') return { x: egg.x, z: egg.z }; // public egg position (not resting)
  if (inv.eggSeenAt && world) {
    const s = world.eggSites.find((e) => e.id === inv.eggSeenAt);
    if (s) return { x: s.x, z: s.z };
  }
  return null;
}

/** Clue ids of the case not collected yet. */
export function uncollectedClues(run: Pick<MysteryRun, 'caseDef' | 'cluesFound'>): ClueId[] {
  return run.caseDef.clues.map((c) => c.id).filter((id) => !run.cluesFound.includes(id));
}

// ----------------------------------------------------------------------------------------------------- Crackstone (R4)

/** Why the player may know Crackstone's position right now (ENEMY_CONTRACT R4), or null when they may not. */
export type CrackstonePoseKind = 'visible' | 'chase' | 'attack' | 'revealed';

/**
 * Joseph Crackstone as the analytics layer may see him. His MODE, whether he sees the player (HUD "SEES YOU"), his
 * telegraphs (scan warning / curse circle, R9) and the remaining time of the player's own effects on him are public;
 * his POSITION (`pose`) only while R4 allows it: the player sees him, he is chasing / attacking, or a reveal effect
 * shows enemies within its range. This is the ONLY place in src/mystery/analytics that reads his position
 * (tests/unit/mystery-analytics/leakage.test.ts scans for other reads and checks the behaviour).
 */
export interface CrackstonePublic {
  def: CrackstoneDef;
  cfg: CrackstoneTuning;
  active: boolean;
  mode: CrackstoneMode;
  pose: { x: number; z: number; yaw: number } | null;
  poseKind: CrackstonePoseKind | null;
  canSeePlayer: boolean;
  suspicion: number;
  scan: CrackstoneRuntime['scan'];
  curse: CrackstoneRuntime['curse'];
  /** Seconds his perception stays off because of the player's own stun / lure (public effect durations). */
  perceptionOffS: number;
  stunned: boolean;
  lured: boolean;
  distracted: boolean;
}

type CrackRun = Pick<MysteryRun, 't'> & {
  crackstone?: CrackstoneRuntime | null;
  crackstoneBrain?: CrackstoneBrain | null;
  crackstoneVisible?: () => boolean;
  effects?: () => ActiveEffects;
  player: { x: number; z: number };
};

/**
 * The R4 pose rule alone. `withReveal` = also honour a reveal effect (calls run.effects(); the per-frame path skips it
 * and only uses visibility / chase / attack).
 */
export function crackstonePose(run: CrackRun, withReveal = true): { pose: CrackstonePublic['pose']; kind: CrackstonePoseKind | null } {
  const brain = run.crackstoneBrain;
  const c = run.crackstone;
  if (!brain || !c || !brain.active) return { pose: null, kind: null };
  let kind: CrackstonePoseKind | null = null;
  if (c.mode === 'CHASE') kind = 'chase';
  else if (c.mode === 'ATTACK') kind = 'attack';
  else if (typeof run.crackstoneVisible === 'function' && run.crackstoneVisible()) kind = 'visible';
  else if (withReveal && typeof run.effects === 'function') {
    const fx = run.effects();
    if (fx.enemiesRevealed) {
      const pos = { x: c.x, z: c.z }; // R4: a reveal effect shows enemies within its range
      const d = Math.hypot(pos.x - run.player.x, pos.z - run.player.z);
      if (fx.enemyRevealRangeM <= 0 || d <= fx.enemyRevealRangeM) kind = 'revealed';
    }
  }
  return kind ? { pose: { x: c.x, z: c.z, yaw: c.yaw }, kind } : { pose: null, kind: null }; // R4-gated position read
}

/** His public mode (HUD pill) while he is active, else null (no Crackstone / before play). */
export function crackstoneModeOf(run: CrackRun): CrackstoneMode | null {
  const brain = run.crackstoneBrain;
  const c = run.crackstone;
  return brain && c && brain.active ? c.mode : null;
}

/** Crackstone's public state, or null when the case has none (rule R2). */
export function crackstoneOf(run: CrackRun, withReveal = true): CrackstonePublic | null {
  const brain = run.crackstoneBrain;
  const c = run.crackstone;
  if (!brain || !c) return null;
  const t = run.t;
  const stunned = t < c.stunnedUntil;
  const lured = brain.isLured(t);
  const { pose, kind } = crackstonePose(run, withReveal);
  return {
    def: brain.def, cfg: brain.cfg, active: brain.active, mode: c.mode, pose, poseKind: kind, canSeePlayer: brain.active && c.canSeePlayer,
    suspicion: c.suspicion, scan: c.scan ? { ...c.scan } : null, curse: c.curse ? { ...c.curse } : null,
    perceptionOffS: Math.max(0, stunned ? c.stunnedUntil - t : 0, lured ? brain.lureUntil - t : 0),
    stunned, lured, distracted: t < c.distractedUntil,
  };
}

/** The leash disc / area centroid of a Crackstone def (vertex mean, as the sim measures his leash). */
export function crackstoneCentroid(def: CrackstoneDef): Vec2 {
  return polygonCentroid(def.polygon); // the sim's leash centre (src/mystery/crackstone.ts)
}
