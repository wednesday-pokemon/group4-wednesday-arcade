// Character real-time traits, interpreted generically from CHARACTER_TRAIT_TUNING keys (never from character ids):
// whichever character carries a key gets that effect. Unknown or Stage-2-only keys are listed in `inactiveKeys`.
import type { CharacterId } from '../game/types.ts';
import { CHARACTER_TRAIT_TUNING } from './data/characters.ts';

export interface TraitEffects {
  fogMult: number; // × fog density at the boat (visibility)
  surgeTelegraphBonusS: number; // extra surge warning time
  lowSpeedThreshold: number; // strokes below this speed …
  lowSpeedImpulseMult: number; // … hit this much harder
  regenDelayS: number | null; // override of the stamina regen delay
  currentPushMult: number; // × current push on the boat
  withCurrentImpulseMult: number; // stroke × this when heading within …
  withCurrentMaxAngleRad: number; // … this angle of the local current
  negatedCollisions: number; // first N damaging collisions per boat stage: no damage, no speed loss
  collisionMinRetain: number; // collisions keep at least this fraction of speed
  fastStrokeVmaxFraction: number; // strokes above this fraction of Vmax …
  fastStrokeCostMult: number; // … cost this much stamina
  hydeStartGapBonusU: number; // the Hyde starts this much farther back
  catchKnockbackBonusU: number; // and is knocked back this much further after a catch
  coastDragMult: number; // drag × this while coasting …
  coastAfterS: number; // … this long after the last stroke
  pushRadiusU: number; // auto-shove light debris within this distance ahead …
  pushCooldownS: number; // … every this many seconds (0 = none)
  rescueWindowBonusS: number;
  cleanEscapeBonusS: number;
  nearHydeRangeU: number; // with the Hyde within this gap …
  nearHydeImpulseMult: number; // … strokes hit this much harder
  /** Tuning keys that have no Stage 1 effect (Stage 2 walking / Seek, etc.). */
  inactiveKeys: string[];
}

export const NEUTRAL_TRAITS: TraitEffects = {
  fogMult: 1, surgeTelegraphBonusS: 0, lowSpeedThreshold: 0, lowSpeedImpulseMult: 1, regenDelayS: null,
  currentPushMult: 1, withCurrentImpulseMult: 1, withCurrentMaxAngleRad: 0, negatedCollisions: 0, collisionMinRetain: 0,
  fastStrokeVmaxFraction: Infinity, fastStrokeCostMult: 1, hydeStartGapBonusU: 0, catchKnockbackBonusU: 0,
  coastDragMult: 1, coastAfterS: Infinity, pushRadiusU: 0, pushCooldownS: 0, rescueWindowBonusS: 0,
  cleanEscapeBonusS: 0, nearHydeRangeU: 0, nearHydeImpulseMult: 1, inactiveKeys: [],
};

type Setter = (e: TraitEffects, v: number) => void;

/** Tuning key → effect. Adding a key here makes it work for any character that lists it. */
const KEY_EFFECTS: Record<string, Setter> = {
  fogDensityMult: (e, v) => (e.fogMult = v),
  surgeWarnExtraS: (e, v) => (e.surgeTelegraphBonusS = v),
  lowSpeedThreshold: (e, v) => (e.lowSpeedThreshold = v),
  lowSpeedImpulseMult: (e, v) => (e.lowSpeedImpulseMult = v),
  regenDelayS: (e, v) => (e.regenDelayS = v),
  currentPushMult: (e, v) => (e.currentPushMult = v),
  withCurrentImpulseMult: (e, v) => (e.withCurrentImpulseMult = v),
  withCurrentMaxAngleDeg: (e, v) => (e.withCurrentMaxAngleRad = (v * Math.PI) / 180),
  negatedCollisionsPerStage: (e, v) => (e.negatedCollisions = v),
  collisionSpeedRetain: (e, v) => (e.collisionMinRetain = v),
  fastStrokeVmaxFraction: (e, v) => (e.fastStrokeVmaxFraction = v),
  fastStrokeCostMult: (e, v) => (e.fastStrokeCostMult = v),
  hydeStartGapBonusU: (e, v) => (e.hydeStartGapBonusU = v),
  catchKnockbackBonusU: (e, v) => (e.catchKnockbackBonusU = v),
  coastDragMult: (e, v) => (e.coastDragMult = v),
  coastAfterS: (e, v) => (e.coastAfterS = v),
  pushRadiusU: (e, v) => (e.pushRadiusU = v),
  pushCooldownS: (e, v) => (e.pushCooldownS = v),
  rescueWindowBonusS: (e, v) => (e.rescueWindowBonusS = v),
  cleanEscapeBonusS: (e, v) => (e.cleanEscapeBonusS = v),
  hydeRangeU: (e, v) => (e.nearHydeRangeU = v),
  impulseMult: (e, v) => (e.nearHydeImpulseMult = v),
};

export function traitEffects(id: CharacterId | null | undefined): TraitEffects {
  const e: TraitEffects = { ...NEUTRAL_TRAITS, inactiveKeys: [] };
  const tuning = id ? CHARACTER_TRAIT_TUNING[id] : undefined;
  if (!tuning) return e;
  for (const [key, value] of Object.entries(tuning)) {
    const set = KEY_EFFECTS[key];
    if (set) set(e, value);
    else e.inactiveKeys.push(key);
  }
  // sensible defaults when a table lists an effect without its timing key
  if (e.coastDragMult !== 1 && !Number.isFinite(e.coastAfterS)) e.coastAfterS = 0.5;
  if (e.pushRadiusU > 0 && e.pushCooldownS <= 0) e.pushCooldownS = 6;
  return e;
}

/** Kinds of obstacle a telekinetic shove can move (rocks and docks are too heavy). */
export const SHOVABLE_KINDS = new Set(['log', 'branch', 'buoy', 'debris']);
