// Structural view of the Stage 1 run that the UI reads (docs/V3_STAGE1_CONTRACT.md "Run API").
// `StageOneRun` (src/action/run.ts, game-developer) satisfies it; the HUD/loop only depend on this shape.
import type {
  AbilityRuntime, ActionEvent, BoatState, CharacterActionDef, CourseDef, HydeState, InputSnapshot, PokemonAbilityDef,
  RescueState, RunStatus, Vec2,
} from '../../action/types.ts';

export interface RunStatsLike {
  activeTimeS: number;
  distance: number;
  maxSpeed: number;
  strokes: number;
  missedStrokes: number;
  collisions: number;
  hpLost: number;
  staminaUsed: number;
  hydeCloseCalls: number;
  abilitiesUsed: number;
  rescues: number;
  cleanEscapes: number;
  timeInDangerS: number;
}

export interface AbilityStatusLike { ready: boolean; cooldownLeftS: number; chargesLeft: number | null; activeLeftS: number }

export interface EffectsLike {
  shield: boolean; speedBoost: boolean; hydeSlowed: boolean; hydeDistracted: boolean; decoy: Vec2 | null;
  fogCleared: boolean; obstaclesRevealed: boolean; currentShield: boolean; anchored: boolean; staminaSurge: boolean;
}

export interface LastRescueLike {
  outcome: 'clean_escape' | 'rescued' | 'caught';
  counted: boolean;
  damage: number;
  knockbackU: number;
  negateDamage: boolean;
  protectEgg: boolean;
  text: string;
  t: number;
}

export interface StageRunLike {
  readonly course: CourseDef;
  readonly boat: BoatState;
  readonly hyde: HydeState;
  readonly rescue: RescueState;
  readonly ability: AbilityRuntime;
  readonly abilityDef: PokemonAbilityDef;
  readonly characterDef: CharacterActionDef;
  readonly status: RunStatus;
  readonly catches: number;
  readonly t: number;
  readonly stats: RunStatsLike;
  readonly progress: number;
  /** What the last rescue window did (`text` = the Pokémon's rescue line, '' when Q was not used). */
  readonly lastRescue: LastRescueLike | null;
  update(frameDt: number, input: InputSnapshot): ActionEvent[];
  canPause(): boolean;
  cinematic(): { kind: 'hyde_reveal'; remainingS: number } | null;
  skipCinematic(): void;
  abilityStatus(): AbilityStatusLike;
  effects(): EffectsLike;
  fogAt(): number;
  distanceToDock(): number;
}
