// Structural views of the sim (src/mystery/run.ts, game-developer) and renderer (src/three/mystery/MysteryScene.ts,
// 3d-artist) exactly as docs/MYSTERY_CONTRACT.md specifies them. The app only talks to these shapes, so the HUD, board
// and results compile and test without the concrete classes; integration.ts loads the real ones.
import type {
  Accusation, AbilityStatus, ActiveEffects, CaseDef, CaseSolution, ClueId, Duo, DuoCard, EggRuntime, HydeRuntime, MapDef, MysteryInput, Objective,
  PlayerState, RunResult, RunStatus, StampedEvent, StateSnapshot,
} from '../../mystery/types.ts';

/** 'practice' = the tutorial crate at the pier; 'examine' / 'lever' = overhaul interactables (ExamineDef / PassageDef). */
export interface Interactable { kind: 'clue' | 'egg' | 'tower' | 'switch' | 'practice' | 'examine' | 'lever'; id: string; label: string; progress: number }

export interface MysteryRunLike {
  readonly map: MapDef;
  readonly caseDef: CaseDef;
  readonly duo: Duo;
  readonly card: DuoCard;
  readonly seed: string;
  status: RunStatus;
  t: number;
  readonly player: PlayerState;
  readonly hyde: HydeRuntime;
  readonly egg: EggRuntime;
  readonly cluesFound: readonly ClueId[];
  readonly log: readonly StampedEvent[];
  update(frameDt: number, input: MysteryInput & { interactHeld?: boolean }): StampedEvent[];
  endTutorial(): void;
  powerStatus(): AbilityStatus;
  moveStatus(): AbilityStatus;
  effects(): ActiveEffects;
  interactable(): Interactable | null;
  objective(): Objective;
  isWallOpen(id: string): boolean;
  snapshot(): StateSnapshot;
  /** suspectId null = "Leave the case unsolved" (verdict not_accused). `solution` is loaded only after the commit. */
  accuse(accusation: Accusation, solution: CaseSolution): StampedEvent[];
  result(): RunResult | null;
  // Sim extensions (UX_MYSTERY data asks); optional so the app degrades if one is missing.
  boardAllowed?(): boolean;
  hydeBearing?(): { angle: number; distanceM: number };
  /** How the Hyde is held by an effect: stone ('petrify') vs spectral shackle ('pin'); null = not held. */
  hydeVisual?(): 'petrify' | 'pin' | null;
  noiseRadiusM?(): number;
  // Overhaul (feature-detected in src/app/mystery/hud/publicRun.ts): investigation(), hydeEmerged, hydeVisible(),
  // playerNav(), world.lineOfSight — PUBLIC state only; `layout` is hidden truth and never read by the app.
}

export type MysteryRunCtor = new (o: { duo: Duo; seed: string; map?: MapDef; caseDef?: CaseDef; tutorial?: boolean }) => MysteryRunLike;

export interface SceneOptions { reducedMotion: boolean; lowGraphics: boolean }

export interface MysterySceneLike {
  render(run: MysteryRunLike, events: readonly StampedEvent[], dt: number): void;
  setOptions?(o: Partial<SceneOptions>): void;
  getDebugState?(run: MysteryRunLike): unknown;
  dispose(): void;
  /** Home hero view: slow orbit over the pier, Thing waving, tower behind. */
  setShowcase?(on: boolean): void;
  /** Drive the in-world Thing from the caption pose (null = its own idle). */
  setThingPose?(pose: 'stand' | 'wave' | 'point' | 'shush' | 'count1' | 'count2' | 'count3' | 'thumbsUp' | 'tap' | 'fist' | null): void;
  /** Hint level 3: the 3D Thing scuttles ~4 m toward the target and points for 5.5 s (null dismisses). */
  pointThing?(target: { x: number; z: number } | null): void;
  /** Where the Hyde is on screen (ThreatEdge chevron). */
  getHydeScreen?(): { onScreen: boolean; ndcX: number; ndcY: number; behind: boolean; distance: number };
}

export type MysterySceneCtor = new (container: HTMLElement, map: MapDef, duo: Duo, options: SceneOptions) => MysterySceneLike;
