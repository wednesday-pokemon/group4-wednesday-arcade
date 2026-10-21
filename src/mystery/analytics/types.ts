// Shared shapes of the game-wide analytics layer (Phase 4). The four services are SYSTEM services: they read the run's
// standard state, events and 1 Hz snapshots for whatever duo is playing. Nothing in this folder branches on a character
// or Pokémon id — duo differences enter only through the numbers in PlayMods / DuoStats / AbilityDef.effects.
import type {
  AbilityDef, AbilityEffectKind, Duo, DuoStats, HydeMode, NoiseSource, Objective, PlayMods, RunResult, Stance,
  StampedEvent, StateSnapshot, Verdict,
} from '../types.ts';

// ----------------------------------------------------------------------------------------------------- inputs

/** Numeric description of the selected duo (registries' numbers, never ids). */
export interface DuoFactors {
  mods: PlayMods;
  stats: DuoStats;
  power: AbilityDef; // the CURRENT duo's F
  move: AbilityDef; // the CURRENT duo's Q
}

/**
 * Extra perceivable state at a snapshot (what the player can see on screen / HUD), computed from the live run by
 * `liveContext()`. Never contains future information.
 */
export interface LiveContext {
  x: number;
  z: number;
  hydeX: number;
  hydeZ: number;
  /** cos of the angle between the Hyde's facing and the direction Hyde → player (1 = it looks straight at you). */
  hydeFacingCos: number;
  inFog: boolean;
  /** Straight-line distance to the nearest hiding spot (m). */
  hidingSpotDistM: number;
  /** Nav-path length to the current objective target (m), null when unknown / not applicable. */
  objectiveDistM: number | null;
  /** Hearing radius of the player's footsteps in the current stance (m, un-occluded). */
  noiseRadiusM: number;
  /** The Hyde is stunned, lured or distracted right now (it cannot detect the player). */
  hydeNeutralized: boolean;
}

/** One 1 Hz telemetry sample. */
export interface TelemetrySample {
  snapshot: StateSnapshot;
  context: LiveContext | null;
}

// ----------------------------------------------------------------------------------------------------- Supabase

/** Row shape for `mystery_forecasts` (docs/SUPABASE_SETUP.md §12.3 `forecasts[i]`). */
export interface ForecastRecord {
  forecastNo: number;
  t: number;
  target: 'detection_15s' | 'extraction' | 'eta_s';
  value: number;
  modelLabel: 'ml' | 'rule_based';
  modelVersion: string | null;
  features: Record<string, number | boolean | string | null>;
}

/** Row shape for `mystery_recommendations` (§12.3 `recommendations[i]`). */
export interface RecommendationRecord {
  recNo: number;
  t: number;
  action: string;
  advice: string;
  trigger: 'hint' | 'context';
  accepted: boolean | null;
  outcome: string | null;
}

/** Body fragment for `mystery-append-events` ({ sessionId, ...batch }). */
export interface SupabaseBatch {
  events: StampedEvent[];
  forecasts: ForecastRecord[];
  recommendations: RecommendationRecord[];
  /** Opaque cursor for `ackBatch()` once the server accepted it. */
  cursor: { lastSeq: number; forecastNos: number[]; recNos: number[]; recVersions: number[] };
}

// ----------------------------------------------------------------------------------------------------- descriptive

export interface StanceTimes { idle: number; walk: number; crouch: number; sprint: number }

export interface SessionReport {
  duo: Duo;
  status: 'finished' | 'dnf' | 'in_progress';
  activeTimeS: number;
  /** Metres walked (null when positions were not tracked, e.g. a report rebuilt from Supabase rows). */
  distanceM: number | null;
  stanceSeconds: StanceTimes;
  stanceShare: StanceTimes; // 0..1, sums to 1 when activeTimeS > 0
  noise: { total: number; bySource: Record<NoiseSource, number>; maxLoudness: number; heardBySource: Record<NoiseSource, number> };
  hyde: {
    alertsByMode: Record<HydeMode, number>; // transitions INTO each mode
    heard: number;
    sightings: number;
    chases: number;
    catches: number;
    blockedCatches: number;
    hpLost: number;
    firstAlertT: number | null; // first transition into INVESTIGATE_SOUND / SEARCH / CHASE
  };
  clues: { found: { clueId: string; t: number }[]; count: number; total: number };
  egg: {
    pickupT: number | null; // time to egg
    drops: { t: number; reason: 'manual' | 'impact' | 'grab' }[];
    securityLost: number;
    security: number | null; // last known security
    delivered: boolean;
    deliveredT: number | null;
    points: number;
  };
  abilities: { F: AbilityUse; Q: AbilityUse };
  hints: number;
  verdict: Verdict | null;
  extraction: boolean;
  score: number | null;
  hp: number | null;
  catches: number;
}

export interface AbilityUse { uses: number; successes: number; denied: number; name: string | null }

// ----------------------------------------------------------------------------------------------------- diagnostic

export interface DiagnosticItem {
  t: number;
  kind: 'cause' | 'pattern';
  /** Machine-readable category (dashboard aggregation key). */
  code: string;
  text: string;
  evidenceSeq: number[];
}

export interface TimelineMark {
  t: number;
  kind: 'heard' | 'investigate' | 'search' | 'chase' | 'catch' | 'clue' | 'egg_pickup' | 'egg_drop' | 'deposit' | 'ability' | 'hint' | 'end';
  seq: number;
}

export interface DiagnosticReport {
  timeline: TimelineMark[];
  causes: DiagnosticItem[];
  patterns: DiagnosticItem[];
}

// ----------------------------------------------------------------------------------------------------- predictive

export type RiskBand = 'low' | 'medium' | 'high';

export interface RiskFactor {
  feature: string;
  label: string; // human-readable ("Hyde 6 m away")
  direction: 'raises' | 'lowers';
  weight: number; // contribution on the log-odds scale (ml) or probability points (rule)
}

export interface RiskEstimate {
  t: number;
  p: number;
  band: RiskBand;
  source: 'ml' | 'rule';
  label: 'ML estimate' | 'Rule-based risk estimate';
  /** The Hyde is already chasing: detection is happening now (p = 1), not a forecast. */
  detectedNow: boolean;
  topFactors: RiskFactor[];
  modelVersion: string | null;
}

export interface ProbabilityEstimate {
  p: number;
  source: 'ml' | 'rule';
  modelVersion: string | null;
}

// ----------------------------------------------------------------------------------------------------- prescriptive

export type AdviceAction =
  | 'evade'
  | 'hide'
  | 'crouch'
  | 'stop_sprinting'
  | 'alt_route'
  | 'use_power'
  | 'use_move'
  | 'inspect_clue'
  | 'search_room'
  | 'get_egg'
  | 'retrieve_egg'
  | 'go_to_tower'
  | 'deposit'
  | 'stay_quiet'
  | 'review_evidence';

export interface AdviceOption {
  action: AdviceAction;
  text: string; // ≤ 60 chars
  reason: string; // ≤ 55 chars (shown as "Why: …" ≤ 60)
  feasible: true;
  score: number;
  /** Where the advice points (hiding spot, clue, egg, tower, route via point) — for follow-up tracking. */
  target: { x: number; z: number } | null;
  /** For use_power / use_move: the CURRENT duo's ability that is ready and relevant. */
  ability: { key: 'F' | 'Q'; id: string; name: string; kinds: AbilityEffectKind[] } | null;
  /** For inspect_clue / search_room: which uncollected clue. */
  clueId: string | null;
}

export interface Advice extends AdviceOption {
  t: number;
  alternatives: AdviceOption[];
  engine: 'rule-based decision engine';
}

export interface AdviceRecord {
  recNo: number;
  t: number;
  trigger: 'hint' | 'context';
  advice: Advice;
  followed: boolean | null; // null = not decided yet / no chance to
  outcome: 'undetected_15s' | 'detected_15s' | null;
  /** Context for the "after, not because" summary. */
  startPos: { x: number; z: number } | null;
  startHydeDistM: number | null;
}

// ----------------------------------------------------------------------------------------------------- dashboard

/** One session as the dashboard sees it (rebuilt from Supabase rows or from a local collector). */
export interface SessionRecord {
  sessionId: string;
  duo: Duo | null;
  offered?: Duo[];
  events: readonly StampedEvent[];
  result?: Pick<RunResult, 'outcome' | 'verdict' | 'activeTimeS' | 'score' | 'cluesFound' | 'catches'> | null;
  recommendations?: Pick<RecommendationRecord, 'action' | 'accepted' | 'outcome'>[];
  forecasts?: Pick<ForecastRecord, 't' | 'target' | 'value' | 'modelLabel'>[];
}

export type { Objective, Stance };
