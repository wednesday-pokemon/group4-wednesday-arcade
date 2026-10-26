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
  ActiveEffects, CaseWorldDef, ClueId, CrackstoneDef, CrackstoneMode, CrackstoneRuntime, HidingSpotDef, InvestigationState, SlurpDef,
  SlurpMode, SlurpRuntime, StateSnapshot, Vec2,
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

// ----------------------------------------------------------------------------------------------------- final (director)
// FINAL_CONTRACT §4–§6: the encounter director, Slurp and hiding cabinets. Every sim surface is FEATURE-DETECTED (the
// final sim lands in parallel): a run without them reports "absent" / the legacy behaviour. Slurp's position follows the
// same rule as Crackstone's (R4): only while the player sees him, he chases / attacks, or a reveal effect shows enemies.
// This is the ONLY place in src/mystery/analytics that reads his runtime (leakage.test.ts scans for other reads).

interface FinalRun {
  slurp?: SlurpRuntime | null;
  slurpVisible?: () => boolean;
  hydeBrain?: { active?: boolean };
  crackstoneBrain?: { active?: boolean } | null;
  snapshot?: () => Partial<StateSnapshot>;
}

/**
 * Is the Hyde in play right now? Final sims: a `hydeActive` getter (director) when the run has one, else the brain's
 * `active` flag (the director parks a despawned Hyde as inactive); before emergence always false.
 */
export function hydeActiveOf(run: object): boolean {
  const r = run as FinalRun & { hydeActive?: boolean };
  if (!hydeEmergedOf(run)) return false;
  if (typeof r.hydeActive === 'boolean') return r.hydeActive;
  return r.hydeBrain?.active !== false;
}

/** Is Joseph Crackstone in play right now (present AND not despawned by the director)? */
export function crackstoneActiveOf(run: object): boolean {
  const r = run as FinalRun;
  if (!r.crackstoneBrain) return false;
  return r.crackstoneBrain.active === true;
}

/** Slurp is part of this case (his haunt exists). */
export function slurpPresentOf(run: Pick<MysteryRun, 'map' | 'caseDef'> & object): boolean {
  const r = run as FinalRun;
  if (r.slurp !== undefined && r.slurp !== null) return true;
  const w = worldOf(run);
  return !!w?.slurp;
}

/** Why the player may know Slurp's position right now (same rule as Crackstone R4), or null. */
export type SlurpPoseKind = 'visible' | 'chase' | 'attack' | 'revealed';

/** Slurp as the analytics layer may see him: mode / active / "sees you" are public (HUD); position only per R4. */
export interface SlurpPublic {
  def: SlurpDef | null;
  active: boolean;
  mode: SlurpMode;
  pose: { x: number; z: number; yaw: number } | null;
  poseKind: SlurpPoseKind | null;
  canSeePlayer: boolean;
  /** He is lunging (telegraphed windup / attack window: public animation). */
  attacking: boolean;
  stunned: boolean;
  slowed: boolean;
  distracted: boolean;
}

/** Slurp's public state, or null when the case / sim has no Slurp. */
export function slurpOf(run: Pick<MysteryRun, 'map' | 'caseDef' | 't' | 'player'> & object, withReveal = true): SlurpPublic | null {
  const r = run as FinalRun & { effects?: () => ActiveEffects };
  const s = r.slurp;
  if (!s) return null;
  const def = worldOf(run)?.slurp ?? null;
  const t = run.t;
  let kind: SlurpPoseKind | null = null;
  if (s.active) {
    if (s.mode === 'CHASE') kind = 'chase';
    else if (s.mode === 'ATTACK') kind = 'attack';
    else if (typeof r.slurpVisible === 'function' && r.slurpVisible()) kind = 'visible';
    else if (withReveal && typeof r.effects === 'function') {
      const fx = r.effects();
      if (fx.enemiesRevealed) {
        const d = Math.hypot(s.x - run.player.x, s.z - run.player.z); // R4: a reveal effect shows enemies within its range
        if (fx.enemyRevealRangeM <= 0 || d <= fx.enemyRevealRangeM) kind = 'revealed';
      }
    }
  }
  return {
    def, active: s.active, mode: s.mode,
    pose: kind ? { x: s.x, z: s.z, yaw: s.yaw } : null, // R4-gated position read
    poseKind: kind, canSeePlayer: s.active && s.canSeePlayer, attacking: s.active && s.attacking,
    stunned: t < s.stunnedUntil, slowed: t < s.slowedUntil, distracted: t < s.distractedUntil,
  };
}

/** The player's cabinet state (null when not inside one / the sim has no cabinets). */
export function cabinetOf(run: Pick<MysteryRun, 'player'>): { spotId: string; phase: 'entering' | 'open' | 'closed' | 'exiting'; t: number } | null {
  const c = run.player.cabinet;
  return c ? { spotId: c.spotId, phase: c.phase, t: c.t } : null;
}

/** Enterable cabinets of the map (HidingSpotDef.kind 'cabinet'). */
export function cabinetsOf(run: Pick<MysteryRun, 'map'>): HidingSpotDef[] {
  return run.map.hidingSpots.filter((h) => h.kind === 'cabinet');
}
