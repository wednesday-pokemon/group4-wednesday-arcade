// Structural, read-only view of the run that the Mystery renderer needs. `MysteryRun` (src/mystery/run.ts) satisfies it;
// the preview harness uses a scripted fake that implements the same shape. The renderer never mutates any of it.
import {
  CRACKSTONE_NO_EFFECTS,
  type ActiveEffects, type ClueId, type CrackstoneRuntime, type CaseDef, type EggRuntime, type HydeRuntime, type InvestigationState, type MapDef, type Objective,
  type PlayerState, type RunStatus,
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
  interactable(): { kind: 'clue' | 'egg' | 'tower' | 'switch' | 'practice' | 'examine' | 'lever'; id: string; label: string; progress: number } | null;
  isWallOpen(id: string): boolean;
  /** overhaul: the player's public investigation state (known / checked sites, traces, examined, passage, Hyde emergence). Optional: feature-detected. */
  investigation?(): InvestigationState;
  /** overhaul: the Hyde has emerged (before that he is absent and drawn nowhere). Optional: absent = always present. */
  readonly hydeEmerged?: boolean;
  /** the sim's tuning (the renderer only peeks at `investigation.siteCheckM`) */
  readonly tuning?: unknown;
  /** optional: lets Thing's in-world hint point at the current goal */
  objective?(): Objective;
  /** optional: how the Hyde is being held (stone look vs spectral pin); null = not held */
  hydeVisual?(): 'petrify' | 'pin' | null;
  /** enemy overhaul: Joseph Crackstone's public runtime (null / absent = no Crackstone in this case: nothing is drawn). */
  readonly crackstone?: CrackstoneRuntime | null;
  /** how Crackstone is being held (stone look vs spectral pin); null = not held */
  crackstoneVisual?(): 'petrify' | 'pin' | null;
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
  ...CRACKSTONE_NO_EFFECTS,
};
