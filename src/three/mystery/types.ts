// Structural, read-only view of the run that the Mystery renderer needs. `MysteryRun` (src/mystery/run.ts) satisfies it;
// the preview harness uses a scripted fake that implements the same shape. The renderer never mutates any of it.
import type {
  ActiveEffects, ClueId, CaseDef, EggRuntime, HydeRuntime, MapDef, Objective, PlayerState, RunStatus,
} from '../../mystery/types.ts';

export interface RenderableMysteryRun {
  readonly map: MapDef;
  readonly player: PlayerState;
  readonly hyde: HydeRuntime;
  readonly egg: EggRuntime;
  readonly cluesFound: readonly ClueId[];
  readonly status: RunStatus;
  /** active simulated seconds (pauses with the sim) */
  readonly t: number;
  readonly caseDef?: CaseDef;
  effects(): ActiveEffects;
  interactable(): { kind: 'clue' | 'egg' | 'tower' | 'switch' | 'practice'; id: string; label: string; progress: number } | null;
  isWallOpen(id: string): boolean;
  /** optional: lets Thing's in-world hint point at the current goal */
  objective?(): Objective;
  /** optional: how the Hyde is being held (stone look vs spectral pin); null = not held */
  hydeVisual?(): 'petrify' | 'pin' | null;
}

export interface MysterySceneOptions {
  reducedMotion: boolean;
  lowGraphics: boolean;
}

export const NO_EFFECTS: ActiveEffects = {
  revealedClues: [],
  revealEgg: false,
  revealHazards: false,
  premonitionPath: null,
  scentTrail: null,
  speedBoost: false,
  lurePoint: null,
  hydeDistracted: false,
  hydeStunned: false,
  hydePetrified: false,
  hydeSlowed: false,
  blockGrab: false,
  eggShield: false,
  switchPowered: false,
  last: null,
};
