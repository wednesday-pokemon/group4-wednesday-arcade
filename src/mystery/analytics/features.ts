// Feature extraction for the predictive models. ONE definition shared by data generation, training, evaluation and the
// live service, so train/serve skew is impossible. Inputs are only what is known at time t: the StateSnapshot, the
// previous snapshot (1 s earlier), the perceivable LiveContext and the duo's NUMBERS (PlayMods, derived card stats and
// which effect kinds its own F / Q carry). No character or Pokémon ids are features. Case awareness: the clue count is
// normalised by the run's OWN case clue count, and `case_<id>` indicators (appended dynamically, like `room_<id>`) let
// the model learn the per-case layout (where the clues and the egg lie); no feature reads the answer key.
import { DEFAULT_TUNING } from '../config.ts';
import { hearingRadius } from '../noise.ts';
import type { CaseId, StateSnapshot } from '../types.ts';
import { caseLabel, LEGACY_CLUE_COUNT } from './caseInfo.ts';
import { CONTROL_KINDS, ESCAPE_KINDS, clamp, hasKind } from './state.ts';
import type { DuoFactors, LiveContext } from './types.ts';

/** The duo as a flat list of numbers (what the models may know about the selected bundle). */
export interface DuoNumbers {
  footstepNoiseMult: number;
  walkSpeedMult: number;
  sprintSpeedMult: number;
  interactTimeMult: number;
  catchDamageMult: number;
  eggSecurityLossMult: number;
  hydeEffectDurationMult: number;
  stealth: number;
  mobility: number;
  defense: number;
  hydeControl: number;
  eggProtection: number;
  investigation: number;
  powerControl: number; // 1 if the duo's F carries stun / slow / distract / lure
  moveControl: number;
  powerEscape: number; // 1 if the duo's F carries speed_boost / dash / block_grab / egg_shield
  moveEscape: number;
}

export const DUO_NUMBER_KEYS: readonly (keyof DuoNumbers)[] = [
  'footstepNoiseMult', 'walkSpeedMult', 'sprintSpeedMult', 'interactTimeMult', 'catchDamageMult', 'eggSecurityLossMult',
  'hydeEffectDurationMult', 'stealth', 'mobility', 'defense', 'hydeControl', 'eggProtection', 'investigation',
  'powerControl', 'moveControl', 'powerEscape', 'moveEscape',
];

export function duoNumbers(f: DuoFactors): DuoNumbers {
  return {
    ...f.mods,
    stealth: f.stats.stealth,
    mobility: f.stats.mobility,
    defense: f.stats.defense,
    hydeControl: f.stats.hydeControl,
    eggProtection: f.stats.eggProtection,
    investigation: f.stats.investigation,
    powerControl: hasKind(f.power, CONTROL_KINDS) ? 1 : 0,
    moveControl: hasKind(f.move, CONTROL_KINDS) ? 1 : 0,
    powerEscape: hasKind(f.power, ESCAPE_KINDS) ? 1 : 0,
    moveEscape: hasKind(f.move, ESCAPE_KINDS) ? 1 : 0,
  };
}

export interface FeatureInput {
  snapshot: StateSnapshot;
  prev: StateSnapshot | null;
  context: LiveContext | null;
  duo: DuoNumbers;
  /** The case being played (null / absent = unknown → no case indicator is on). */
  caseId?: CaseId | null;
  /** The case's clue count (default 3 = every case and the legacy case). */
  clueTotal?: number;
}

/** Clue count used to normalise the `clues` feature. */
export function clueTotalOf(x: FeatureInput): number {
  return x.clueTotal && x.clueTotal > 0 ? x.clueTotal : LEGACY_CLUE_COUNT;
}

const MAX_HP = DEFAULT_TUNING.player.maxHp;
const KNOTS = DEFAULT_TUNING.noise.knots;

type FeatureFn = (x: FeatureInput) => number;
const b = (v: boolean) => (v ? 1 : 0);
const dist = (x: FeatureInput) => clamp(x.snapshot.hydeDistanceM, 0, 60);
const near10 = (x: FeatureInput) => Math.exp(-dist(x) / 10);
const near4 = (x: FeatureInput) => Math.exp(-dist(x) / 4);
const noiseReach = (x: FeatureInput) => Math.min(2, hearingRadius(x.snapshot.recentNoise, KNOTS) / Math.max(1, dist(x)));

/** Base feature definitions (rooms are appended dynamically as `room_<id>`). Order is irrelevant: models store names. */
export const FEATURES: Record<string, FeatureFn> = {
  near10,
  near4,
  occluded: (x) => b(x.snapshot.hydeOccluded),
  hydeVisible: (x) => b(x.snapshot.hydeVisible === true), // overhaul: the player can see the Hyde (public)
  visibleNear: (x) => near10(x) * (1 - b(x.snapshot.hydeOccluded)),
  suspicion: (x) => x.snapshot.hydeSuspicion,
  mode_investigate: (x) => b(x.snapshot.hydeMode === 'INVESTIGATE_SOUND'),
  mode_search: (x) => b(x.snapshot.hydeMode === 'SEARCH'),
  mode_cooldown: (x) => b(x.snapshot.hydeMode === 'COOLDOWN'),
  stance_walk: (x) => b(x.snapshot.stance === 'walk'),
  stance_crouch: (x) => b(x.snapshot.stance === 'crouch'),
  stance_sprint: (x) => b(x.snapshot.stance === 'sprint'),
  speed: (x) => x.snapshot.speed / 6,
  hidden: (x) => b(x.snapshot.hidden),
  recentNoise: (x) => x.snapshot.recentNoise,
  noiseReach,
  noiseReachOccluded: (x) => noiseReach(x) * b(x.snapshot.hydeOccluded),
  approach: (x) => (x.prev ? clamp(x.prev.hydeDistanceM - x.snapshot.hydeDistanceM, -6, 6) / 6 : 0),
  facingNear: (x) => (x.context ? Math.max(0, x.context.hydeFacingCos) * near10(x) * (1 - b(x.snapshot.hydeOccluded)) : 0),
  inFog: (x) => b(x.context?.inFog === true),
  hideSpotFar: (x) => (x.context ? Math.min(30, x.context.hidingSpotDistM) / 30 : 0.5),
  hydeNeutralized: (x) => b(x.context?.hydeNeutralized === true),
  hpFrac: (x) => x.snapshot.hp / MAX_HP,
  catches: (x) => x.snapshot.catches,
  egg_carried: (x) => b(x.snapshot.eggState === 'carried'),
  egg_dropped: (x) => b(x.snapshot.eggState === 'dropped'),
  eggSecurity: (x) => x.snapshot.eggSecurity / 100,
  clues: (x) => Math.min(1, x.snapshot.cluesFound / clueTotalOf(x)),
  obj_find_egg: (x) => b(x.snapshot.objective === 'find_egg'),
  obj_retrieve_egg: (x) => b(x.snapshot.objective === 'retrieve_egg'),
  obj_deliver_egg: (x) => b(x.snapshot.objective === 'deliver_egg'),
  powerReady: (x) => b(x.snapshot.powerReady),
  moveReady: (x) => b(x.snapshot.moveReady),
  controlReady: (x) => b((x.snapshot.powerReady && x.duo.powerControl > 0) || (x.snapshot.moveReady && x.duo.moveControl > 0)),
  escapeReady: (x) => b((x.snapshot.powerReady && x.duo.powerEscape > 0) || (x.snapshot.moveReady && x.duo.moveEscape > 0)),
  duo_footstepNoise: (x) => x.duo.footstepNoiseMult,
  duo_walkSpeed: (x) => x.duo.walkSpeedMult,
  duo_sprintSpeed: (x) => x.duo.walkSpeedMult * x.duo.sprintSpeedMult,
  duo_effectDuration: (x) => x.duo.hydeEffectDurationMult,
  duo_catchDamage: (x) => x.duo.catchDamageMult,
  stat_stealth: (x) => x.duo.stealth / 5,
  stat_mobility: (x) => x.duo.mobility / 5,
  stat_hydeControl: (x) => x.duo.hydeControl / 5,
};

/** Extra features for the ETA regression (objective distance from the nav graph). */
export const ETA_EXTRA: Record<string, FeatureFn> = {
  objectiveDist: (x) => (x.context?.objectiveDistM ?? 30) / 30,
  objectiveDistCarry: (x) => ((x.context?.objectiveDistM ?? 30) / 30) * b(x.snapshot.eggState === 'carried'),
  objectiveDistSlow: (x) => ((x.context?.objectiveDistM ?? 30) / 30) / Math.max(0.5, x.duo.walkSpeedMult),
};

export const BASE_FEATURE_NAMES: readonly string[] = Object.keys(FEATURES);

export function isKnownFeature(name: string): boolean {
  return name in FEATURES || name in ETA_EXTRA || /^(room|case)_[a-z0-9_]{1,40}$/.test(name);
}

export function featureValue(name: string, x: FeatureInput): number {
  const f = FEATURES[name] ?? ETA_EXTRA[name];
  if (f) return f(x);
  if (name.startsWith('room_')) return b(x.snapshot.roomId === name.slice(5));
  if (name.startsWith('case_')) return b(x.caseId === name.slice(5));
  return 0;
}

export function featureVector(names: readonly string[], x: FeatureInput): number[] {
  return names.map((n) => {
    const v = featureValue(n, x);
    return Number.isFinite(v) ? v : 0;
  });
}

/** Human-readable label of a feature at its current value (for "top factors"). */
export function featureLabel(name: string, x: FeatureInput, raises: boolean): string {
  const s = x.snapshot;
  const d = Math.round(s.hydeDistanceM);
  switch (name) {
    case 'near10': case 'near4': return raises ? `Hyde ${d} m away` : `Hyde far away (${d} m)`;
    case 'occluded': return s.hydeOccluded ? 'A wall is between you' : 'Nothing blocks its view';
    case 'hydeVisible': return s.hydeVisible ? 'You can see the Hyde' : 'The Hyde is out of sight';
    case 'visibleNear': case 'facingNear': return raises ? `Hyde ${d} m away with a clear view` : 'Out of its sight line';
    case 'suspicion': return `Hyde suspicion ${Math.round(s.hydeSuspicion * 100)}%`;
    case 'mode_investigate': return s.hydeMode === 'INVESTIGATE_SOUND' ? 'Hyde is investigating a noise' : 'Hyde is not investigating';
    case 'mode_search': return s.hydeMode === 'SEARCH' ? 'Hyde is searching' : 'Hyde is not searching';
    case 'mode_cooldown': return s.hydeMode === 'COOLDOWN' ? 'Hyde is losing interest' : 'Hyde is not cooling down';
    case 'stance_walk': case 'stance_crouch': case 'stance_sprint': case 'speed':
      return s.stance === 'sprint' ? 'You are sprinting' : s.stance === 'crouch' ? 'You are crouched' : s.stance === 'walk' ? 'You are walking' : 'You are standing still';
    case 'hidden': return s.hidden ? 'You are hidden' : 'You are not hidden';
    case 'recentNoise': case 'noiseReach': case 'noiseReachOccluded':
      return s.recentNoise > 0.5 ? 'You were loud recently' : s.recentNoise > 0.15 ? 'You made some noise recently' : 'You have been quiet';
    case 'approach': return raises ? 'Hyde is getting closer' : 'Hyde is moving away';
    case 'inFog': return 'Fog limits its sight';
    case 'hideSpotFar': return raises ? 'No hiding spot close by' : 'A hiding spot is close';
    case 'hydeNeutralized': return 'The Hyde is stunned, lured or distracted';
    case 'hpFrac': return `HP ${s.hp}`;
    case 'catches': return `Caught ${s.catches} of 2`;
    case 'egg_carried': return s.eggState === 'carried' ? 'Carrying the egg' : 'Not carrying the egg';
    case 'egg_dropped': return 'The egg is on the ground';
    case 'eggSecurity': return `Egg security ${Math.round(s.eggSecurity)}`;
    case 'clues': return `${s.cluesFound} of ${clueTotalOf(x)} clues found`;
    case 'obj_find_egg': return 'Heading for the egg';
    case 'obj_retrieve_egg': return 'Going back for the dropped egg';
    case 'obj_deliver_egg': return 'Carrying the egg to the tower';
    case 'powerReady': case 'moveReady': case 'controlReady': case 'escapeReady':
      return raises ? 'Abilities are cooling down' : 'An ability is ready';
    default:
      if (name.startsWith('duo_') || name.startsWith('stat_')) return 'Your duo’s traits';
      if (name.startsWith('case_')) return `The layout of ${caseLabel(x.caseId)}`;
      if (name.startsWith('room_')) return `You are in the ${name.slice(5).split('_').map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w)).join(' ')}`;
      return name;
  }
}
