// Internal shared state for one run, passed to the player / Hyde / egg / ability / interaction modules. Not part of the
// public contract (run.ts exposes the public surface); kept as an interface so modules can be unit-tested in isolation.
import type { SimTuning } from './config.ts';
import type { World } from './geometry.ts';
import type { NavGrid } from './nav.ts';
import type { Rng } from './rng.ts';
import type {
  AbilityEffectKind, ClueId, EggRuntime, GameEvent, HydeRuntime, MapDef, NoiseSource, PlayMods, PlayerState, RoomDef, Vec2,
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
  last: { key: 'F' | 'Q'; abilityId: string; kinds: AbilityEffectKind[]; t: number } | null;
}

export function createEffectState(): EffectState {
  return {
    speedBoostUntil: -Infinity, speedBoostMult: 1, speedBoostNoiseMult: 1, scentUntil: -Infinity, scentClues: [],
    blockGrabUntil: -Infinity, eggShieldUntil: -Infinity, eggShieldMag: 0,
    revealCluesUntil: -Infinity, revealCluesRangeM: 0, revealedClues: [], revealHazardsUntil: -Infinity, revealHazardsRangeM: 0,
    premonitionUntil: -Infinity, premonitionAheadS: 0, lurePoint: null, lureUntil: -Infinity,
    hydeVisualUntil: -Infinity, hydeVisual: null, switchPoweredUntil: -Infinity, last: null,
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
  emit(e: GameEvent): void;
  /** Emits a `noise` event and lets the Hyde try to hear it. Returns the hearing radius. */
  noise(source: NoiseSource, x: number, z: number, loudness: number): number;
  /** Player-radius grid for the current gate state (or with every gate closed when `gatesClosed`). */
  playerNav(gatesClosed?: boolean): NavGrid;
  hydeNav(): NavGrid;
  roomAt(x: number, z: number): RoomDef | null;
  inFog(x: number, z: number): boolean;
}
