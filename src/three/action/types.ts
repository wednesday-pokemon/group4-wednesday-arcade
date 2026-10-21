// Minimal structural view of the run the renderer reads. `StageOneRun` (src/action/run.ts) satisfies it, and so does the
// Phase 1 `RowingSession` (everything except boat/t/fogAt is optional so the scene degrades gracefully).
import type { AbilitySpecialty, BoatState, CourseDef, HydeState, RescueState, RunStatus, Vec2 } from '../../action/types.ts';

export interface RenderEffects {
  shield: boolean;
  speedBoost: boolean;
  hydeSlowed: boolean;
  hydeDistracted: boolean;
  decoy: Vec2 | null;
  fogCleared: boolean;
  obstaclesRevealed: boolean;
  currentShield: boolean;
  anchored: boolean;
  staminaSurge: boolean;
}

export interface RenderAbilityStatus {
  ready: boolean;
  cooldownLeftS: number;
  chargesLeft: number | null;
  activeLeftS: number;
}

export interface RenderableRun {
  readonly boat: BoatState;
  readonly t: number;
  readonly status?: RunStatus;
  readonly catches?: number;
  readonly hyde?: HydeState;
  readonly rescue?: RescueState;
  readonly progress?: number;
  readonly abilityDef?: { specialty: AbilitySpecialty; magnitude: number; durationS: number };
  /** The live course (obstacles may have been displaced in place by a trait). Falls back to the course given to the scene. */
  readonly course?: CourseDef;
  /** Obstacles cut by an ability (hide them) / shoved by a trait (positions changed in `course.obstacles`). */
  readonly removedObstacles?: ReadonlySet<string>;
  readonly displacedObstacles?: ReadonlySet<string>;
  /** Bumps whenever an obstacle is removed or displaced: the scene rebuilds its static obstacle meshes. */
  readonly obstacleRevision?: number;
  readonly safeHarbour?: boolean;
  readonly lastChance?: boolean;
  fogAt(): number;
  /** Seconds left of a telegraphed Hyde surge (0 = none). */
  surgeTelegraphLeftS?(): number;
  /** Real seconds left in the rescue window. */
  rescueLeftS?(): number;
  /** Seconds the swamped hull is stalled (HP 0). */
  swampedLeftS?(): number;
  /** Radius around the boat in which hazards are outlined right now (0 = none). */
  revealRadius?(): number;
  effects?(): RenderEffects;
  cinematic?(): { kind: 'hyde_reveal'; remainingS: number } | null;
  abilityStatus?(): RenderAbilityStatus;
}

export interface ActionSceneOptions {
  reducedMotion: boolean;
  lowGraphics: boolean;
}

export const NO_EFFECTS: RenderEffects = {
  shield: false, speedBoost: false, hydeSlowed: false, hydeDistracted: false, decoy: null, fogCleared: false,
  obstaclesRevealed: false, currentShield: false, anchored: false, staminaSurge: false,
};
