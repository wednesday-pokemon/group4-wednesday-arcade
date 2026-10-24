// Internal shared state for one run, passed to the player / Hyde / egg / ability / interaction modules. Not part of the
// public contract (run.ts exposes the public surface); kept as an interface so modules can be unit-tested in isolation.
import type { SimTuning } from './config.ts';
import type { World } from './geometry.ts';
import type { InvestigationTracker } from './investigation.ts';
import type { NavGrid } from './nav.ts';
import type { Rng } from './rng.ts';
import type {
  AbilityEffectKind, ClueId, EggRuntime, EnemyId, GameEvent, HydeRuntime, MapDef, NoiseSource, PlayMods, PlayerState, RoomDef, Vec2,
} from './types.ts';

/** Timed ability effects currently applied (times are run seconds `t`). */
export interface EffectState {
  speedBoostUntil: number;
  speedBoostMult: number; // movement × this while active
  speedBoostNoiseMult: number; // footsteps × this while active
  scentUntil: number; // scent trail (reveal_clues with visual 'scent_trail')
  scentClues: ClueId[];
  blockGrabUntil: number; // next grab before this deals no HP/egg damage (consumed by the grab)
  eggShieldUntil: number;
  eggShieldMag: number; // loss × (1 − mag)
  revealCluesUntil: number;
  revealCluesRangeM: number; // 0 = unlimited (egg reveal range)
  revealedClues: ClueId[]; // picked at activation (nearest `magnitude`)
  revealHazardsUntil: number;
  revealHazardsRangeM: number;
  premonitionUntil: number;
  premonitionAheadS: number;
  lurePoint: Vec2 | null;
  lureUntil: number;
  hydeVisualUntil: number; // a stun/slow with visual 'petrify' | 'pin' is showing
  hydeVisual: 'petrify' | 'pin' | null;
  switchPoweredUntil: number; // Infinity = permanent
  // ---- Joseph Crackstone (ENEMY_CONTRACT R7 / R8)
  crackstoneVisualUntil: number; // a stun/slow with visual 'petrify' | 'pin' is showing on Crackstone
  crackstoneVisual: 'petrify' | 'pin' | null;
  crackstonePremonitionUntil: number; // premonition shows Crackstone's path (he was in range at activation)
  enemyRevealUntil: number; // a non-scent reveal_clues also reveals enemies within enemyRevealRangeM (0 = anywhere)
  enemyRevealRangeM: number;
  cursedUntil: number; // a landed curse slows the player (movement × curseSlowMult) until then
  curseSlowMult: number;
  // ---- Slurp (FINAL_CONTRACT §5)
  slurpVisualUntil: number; // a stun/slow with visual 'petrify' | 'pin' is showing on Slurp
  slurpVisual: 'petrify' | 'pin' | null;
  slurpPremonitionUntil: number; // premonition shows Slurp's path (he was in range at activation)
  last: { key: 'F' | 'Q'; abilityId: string; kinds: AbilityEffectKind[]; t: number } | null;
}

export function createEffectState(): EffectState {
  return {
    speedBoostUntil: -Infinity, speedBoostMult: 1, speedBoostNoiseMult: 1, scentUntil: -Infinity, scentClues: [],
    blockGrabUntil: -Infinity, eggShieldUntil: -Infinity, eggShieldMag: 0,
    revealCluesUntil: -Infinity, revealCluesRangeM: 0, revealedClues: [], revealHazardsUntil: -Infinity, revealHazardsRangeM: 0,
    premonitionUntil: -Infinity, premonitionAheadS: 0, lurePoint: null, lureUntil: -Infinity,
    hydeVisualUntil: -Infinity, hydeVisual: null, switchPoweredUntil: -Infinity,
    crackstoneVisualUntil: -Infinity, crackstoneVisual: null, crackstonePremonitionUntil: -Infinity,
    enemyRevealUntil: -Infinity, enemyRevealRangeM: 0, cursedUntil: -Infinity, curseSlowMult: 1,
    slurpVisualUntil: -Infinity, slurpVisual: null, slurpPremonitionUntil: -Infinity, last: null,
  };
}

export interface SimContext {
  readonly map: MapDef;
  readonly world: World;
  readonly tuning: SimTuning;
  readonly mods: PlayMods;
  readonly t: number;
  readonly player: PlayerState;
  readonly hyde: HydeRuntime;
  readonly egg: EggRuntime;
  readonly cluesFound: ClueId[];
  readonly fx: EffectState;
  readonly rng: Rng;
  /** Public investigation state (site checks, traces, examines, passage). */
  readonly inv: InvestigationTracker;
  emit(e: GameEvent): void;
  /** Emits a `noise` event and lets the Hyde try to hear it. Returns the hearing radius. */
  noise(source: NoiseSource, x: number, z: number, loudness: number): number;
  /** Player-radius grid for the current gate state (or with every gate closed when `gatesClosed`). */
  playerNav(gatesClosed?: boolean): NavGrid;
  hydeNav(): NavGrid;
  /** Permanently removes a wall from collision, line of sight and nav (gate-closed grid too): the lever passage. */
  openWallPermanently(id: string): void;
  roomAt(x: number, z: number): RoomDef | null;
  inFog(x: number, z: number): boolean;
  /**
   * Final (FINAL_CONTRACT §4): is an enemy OTHER than `self` engaged (CHASE / ATTACK) right now? Crackstone and Slurp
   * defer to it (≤ 1 engaged hunter at a time; the Hyde has priority). Optional so module tests can omit it (= false).
   */
  enemyEngaged?(self: EnemyId): boolean;
  /**
   * Final (FINAL_CONTRACT §6): an enemy that remembered the player's cabinet reached it — pull the player out (a hit by
   * `by`). Returns false when the run ended (DNF). Optional for module tests.
   */
  pullOut?(by: EnemyId, spotId: string): boolean;
  /** Final: the exit point of the cabinet the player is in (where enemies stand to pull them out), else null. */
  cabinetExit?(): Vec2 | null;
}
