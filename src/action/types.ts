// Real-time action gameplay contract (rules v3.0-realtime). World units: metres-ish; +X right, +Z toward the
// start (the boat's forward vector at heading 0 is -Z, matching the existing boat model).
import type { CharacterId, EggTier, PokemonId } from '../game/types.ts';

export type ActionRulesVersion = 'v3.0-realtime';

/** 1–10 ratings shown on the character card; converted to physics multipliers by characterStats.ts. */
export interface CharacterStats {
  rowingPower: number; // impulse per stroke
  topSpeed: number; // max boat speed
  stamina: number; // max stamina + recovery
  handling: number; // steering rate + collision avoidance assist
  defense: number; // damage reduction
}

export interface CharacterActionDef {
  id: CharacterId;
  stats: CharacterStats;
  trait: string; // short real-time trait name, e.g. "Night Sprint"
  traitText: string; // <= 70 chars, how the trait plays in real time
}

export type AbilitySpecialty =
  | 'speed_boost' | 'shield' | 'hyde_distraction' | 'obstacle_detection' | 'egg_protection'
  | 'stamina_restore' | 'fog_clear' | 'pursuit_slow' | 'egg_sense' | 'current_ride';

/** Data-driven Pokémon ability; the ability system interprets these fields, never Pokémon ids. */
export interface PokemonAbilityDef {
  id: PokemonId;
  abilityName: string;
  specialty: AbilitySpecialty;
  description: string; // <= 80 chars, shown on selection + HUD
  cooldownS: number;
  charges: number | null; // null = unlimited (cooldown only)
  durationS: number; // 0 = instant
  magnitude: number; // specialty-specific strength (documented in docs/GDD_V3_REALTIME.md)
  /** What a successful Q press does inside the ~2 s Hyde-catch rescue window. */
  rescue: { negateDamage: boolean; protectEgg: boolean; pushHydeBackM: number; text: string };
  passive?: { kind: string; value: number; text: string };
}

export interface RowingConfig {
  baseImpulse: number; // speed units added per stroke at rowingPower 5
  maxSpeed: number; // u/s at topSpeed 5
  minStrokeIntervalS: number; // cadence cap: presses faster than this are ignored ("missed stroke")
  drag: number; // exponential water drag per second
  linearDrag: number; // constant deceleration u/s² while moving
  brakeDrag: number; // extra exponential drag while S held
  cruiseSpeed: number; // W "guide forward" glides toward this speed
  cruiseAccel: number; // u/s² applied by W
  steerRate: number; // rad/s at handling 5 and full steering authority
  steerMinAuthority: number; // fraction of steering available at zero speed
  holdCadenceHz: number; // accessibility hold-to-row cadence
  strokeStaminaCost: number; // stamina per stroke
  cruiseStaminaPerS: number; // stamina per second while W held
  staminaRegenPerS: number; // regen while not rowing
  regenDelayS: number; // regen starts this long after the last stroke
  lowStaminaThreshold: number; // fraction of max below which strokes weaken
  lowStaminaFloor: number; // effectiveness at zero stamina
}

export interface InputSnapshot {
  forward: boolean; // W
  left: boolean; // A
  right: boolean; // D
  brake: boolean; // S
  interact: boolean; // E (edge, true for one frame)
  ability: boolean; // Q (edge)
  strokes: number; // counted SPACE presses since the last frame (key-repeat ignored)
  holdRow: boolean; // accessibility: SPACE held in hold-to-row mode
}

export interface BoatState {
  x: number;
  z: number;
  heading: number; // radians; forward = (-sin h, -cos h)
  speed: number; // forward speed u/s (>= 0)
  turnRate: number; // current yaw rate for banking visuals
  hp: number;
  maxHp: number;
  stamina: number;
  maxStamina: number;
  lastStrokeAt: number; // sim seconds
  strokeCount: number;
  missedStrokes: number;
  invulnerableUntil: number;
}

export type ObstacleKind = 'rock' | 'log' | 'dock' | 'branch' | 'buoy' | 'debris';

/** Collision shape in the XZ plane: circle (rock/buoy) or capsule (log/dock/branch). */
export interface Obstacle {
  id: string;
  kind: ObstacleKind;
  x: number;
  z: number;
  radius: number;
  /** Capsule half-length along its axis (0 for circles) and axis angle (radians, like heading). */
  halfLength: number;
  angle: number;
  damage: number; // base HP damage at full-speed impact
  /** Optional oscillating drift for moving obstacles along `axisAngle` (heading convention; default: sideways along X). */
  drift?: { amplitude: number; periodS: number; phase: number; axisAngle?: number };
}

export interface CurrentZone { x: number; z: number; radius: number; pushX: number; pushZ: number }
export interface FogZone { x: number; z: number; radius: number; density: number }

export interface Vec2 { x: number; z: number }

/** Solid land in the XZ plane (shoreline, islet, reef). Polygon vertices in counter-clockwise order, not closed. */
export interface LandMass {
  id: string;
  kind: 'shore' | 'islet' | 'reef';
  points: Vec2[];
  height: number; // visual height of the land above water
  trees?: number; // visual density hint (twisted trees per 100 m of shoreline)
}

export type LandmarkKind = 'nevermore_academy' | 'start_dock' | 'raven_island' | 'raven_dock' | 'iago_tower' | 'lighthouse' | 'crypt' | 'shrine' | 'wreck' | 'bell_buoy';
export interface Landmark { id: string; kind: LandmarkKind; x: number; z: number; rotation: number; scale: number }

/** A named navigable route (for lantern lines, advice and the minimap). Not a lane: the boat steers freely. */
export interface RouteHint { id: string; name: string; risk: 'safe' | 'risky'; points: Vec2[] }

export type EncounterKind = 'calm' | 'disturbance' | 'hyde_emerge' | 'surge' | 'safe_harbour';
/** Gameplay-driven encounter triggers, fired once when the boat enters `radius` of (x, z). */
export interface EncounterTrigger { id: string; kind: EncounterKind; x: number; z: number; radius: number; params?: Record<string, number> }

export interface CourseDef {
  id: string;
  name: string;
  start: { x: number; z: number; heading: number };
  finish: { x: number; z: number; radius: number }; // docking checkpoint
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
  obstacles: Obstacle[];
  currents: CurrentZone[];
  fog: FogZone[];
  /** v3 open-lake additions (optional so the Phase 1 trial course still type-checks). */
  land?: LandMass[];
  landmarks?: Landmark[];
  routes?: RouteHint[];
  encounters?: EncounterTrigger[];
  hydeSpawn?: { x: number; z: number; heading: number };
}

// ---------------------------------------------------------------------------------------------- Hyde + abilities

export type HydePhase = 'dormant' | 'stalking' | 'emerging' | 'chasing' | 'surging' | 'lunging' | 'stunned' | 'distracted' | 'retreating';

export interface HydeState {
  phase: HydePhase;
  phaseT: number; // seconds in the current phase
  x: number;
  z: number;
  heading: number;
  speed: number;
  distance: number; // to the boat, world units
  visibility: number; // 0 hidden (under water) … 1 fully emerged — renderer + HUD use it
  threat: number; // 0 calm … 1 about to catch — drives music, warnings, camera
  slowedUntil: number;
  distractedUntil: number;
  decoy: Vec2 | null; // where a distraction is luring him
}

export type RescueOutcome = 'pending' | 'clean_escape' | 'rescued' | 'caught';
export interface RescueState {
  active: boolean;
  startedAt: number; // sim seconds (sim runs slowed during the window)
  windowS: number;
  abilityAvailable: boolean;
  outcome: RescueOutcome;
}

export interface AbilityRuntime {
  pokemonId: PokemonId;
  chargesLeft: number | null;
  cooldownUntil: number;
  activeUntil: number;
  lastActivatedAt: number;
}

export type RunStatus = 'intro' | 'playing' | 'rescue' | 'finished' | 'dnf';


export type ActionEvent =
  | { type: 'stroke'; side: 'left' | 'right'; power: number; t: number }
  | { type: 'missed_stroke'; t: number }
  | { type: 'collision'; obstacleId: string; kind: ObstacleKind | 'land'; damage: number; impactSpeed: number; x: number; z: number; t: number }
  | { type: 'low_stamina'; t: number }
  | { type: 'encounter'; encounterId: string; kind: EncounterKind; t: number }
  | { type: 'hyde_phase'; phase: HydePhase; t: number }
  | { type: 'hyde_warning'; level: 1 | 2; t: number }
  | { type: 'hyde_catch'; catchNumber: 1 | 2; t: number }
  | { type: 'rescue_start'; abilityAvailable: boolean; t: number }
  | { type: 'rescue_end'; outcome: RescueOutcome; damage: number; t: number }
  | { type: 'ability_used'; pokemonId: PokemonId; specialty: AbilitySpecialty; t: number }
  | { type: 'ability_denied'; reason: 'cooldown' | 'no_charges' | 'not_applicable'; t: number }
  | { type: 'ability_end'; pokemonId: PokemonId; t: number }
  | { type: 'dnf'; reason: 'second_catch'; t: number }
  | { type: 'finish'; t: number };

export interface EggCarry { tier: EggTier; security: number }
