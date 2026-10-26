// Real-time character tuning (rules v3.0-realtime). Pure data: no logic, type-only imports.
// Every number is a TUNING DEFAULT. Design rationale: docs/GDD_V3_REALTIME.md §10.
// Stats are 1–10 ratings; each character sums to CHARACTER_STAT_BUDGET (30), range 3–9.
// Conversion to physics multipliers: STAGE_TUNING.statScaling in ./stages.ts.
import type { CharacterActionDef } from '../types.ts';

export const CHARACTER_STAT_BUDGET = 30;

export const CHARACTER_ACTION_DEFS: CharacterActionDef[] = [
  {
    id: 'wednesday',
    stats: { rowingPower: 5, topSpeed: 5, stamina: 5, handling: 9, defense: 6 },
    trait: 'Dark Vision',
    traitText: 'Sees through fog; Hyde surges are warned 1 s earlier.',
  },
  {
    id: 'enid',
    stats: { rowingPower: 8, topSpeed: 5, stamina: 9, handling: 4, defense: 4 },
    trait: 'High Energy',
    traitText: 'Strokes below 3 u/s hit 60% harder; stamina regen starts sooner.',
  },
  {
    id: 'bianca',
    stats: { rowingPower: 5, topSpeed: 7, stamina: 6, handling: 7, defense: 5 },
    trait: 'Siren Navigation',
    traitText: 'Currents push you 60% less; rowing with a current adds 15%.',
  },
  {
    id: 'xavier',
    stats: { rowingPower: 4, topSpeed: 5, stamina: 6, handling: 6, defense: 9 },
    trait: 'Painted Decoy',
    traitText: 'First 2 collisions each boat stage: no damage, egg loss or slowdown.',
  },
  {
    id: 'ajax',
    stats: { rowingPower: 7, topSpeed: 4, stamina: 7, handling: 4, defense: 8 },
    trait: 'Stone Shield',
    traitText: 'Collisions keep 60% of your speed instead of stopping you.',
  },
  {
    id: 'yoko',
    stats: { rowingPower: 7, topSpeed: 9, stamina: 4, handling: 6, defense: 4 },
    trait: 'Night Sprint',
    traitText: 'Walks 20% faster on land; strokes near top speed cost 25% less.',
  },
  {
    id: 'kent',
    stats: { rowingPower: 6, topSpeed: 6, stamina: 6, handling: 5, defense: 7 },
    trait: 'Hydro Wave',
    traitText: 'Hyde starts 12 u farther back; each catch knocks him 10 u further.',
  },
  {
    id: 'divina',
    stats: { rowingPower: 4, topSpeed: 7, stamina: 8, handling: 6, defense: 5 },
    trait: 'Siren Drift',
    traitText: 'Coasting between strokes loses 40% less speed.',
  },
  {
    id: 'rowan',
    stats: { rowingPower: 5, topSpeed: 6, stamina: 5, handling: 8, defense: 6 },
    trait: 'Telekinetic Push',
    traitText: 'Every 6 s, shoves a log, branch or buoy out of your path.',
  },
  {
    id: 'eugene',
    stats: { rowingPower: 4, topSpeed: 5, stamina: 7, handling: 7, defense: 7 },
    trait: 'Hive Swarm',
    traitText: 'Bees point to the egg on landing; Seek recharges twice as fast.',
  },
  {
    id: 'morticia',
    stats: { rowingPower: 5, topSpeed: 6, stamina: 6, handling: 7, defense: 6 },
    trait: 'Graceful Escape',
    traitText: 'Rescue window +0.8 s; Clean Escape timing window +0.3 s.',
  },
  {
    id: 'gomez',
    stats: { rowingPower: 8, topSpeed: 8, stamina: 5, handling: 4, defense: 5 },
    trait: 'Fearless Dash',
    traitText: 'With the Hyde within 18 u, your strokes hit 25% harder.',
  },
];

/**
 * Numeric parameters for each real-time trait, read by the trait system (keys documented in GDD §10.2).
 * Multipliers apply to the base values in ./stages.ts; "PerStage" counters reset at each boat stage.
 */
export const CHARACTER_TRAIT_TUNING: Record<CharacterActionDef['id'], Readonly<Record<string, number>>> = {
  wednesday: { fogDensityMult: 0.35, surgeWarnExtraS: 1.0 },
  enid: { lowSpeedThreshold: 3, lowSpeedImpulseMult: 1.6, regenDelayS: 0.15 },
  bianca: { currentPushMult: 0.4, withCurrentImpulseMult: 1.15, withCurrentMaxAngleDeg: 45 },
  xavier: { negatedCollisionsPerStage: 2 },
  ajax: { collisionSpeedRetain: 0.6 },
  yoko: { walkSpeedMult: 1.2, fastStrokeVmaxFraction: 0.75, fastStrokeCostMult: 0.75 },
  kent: { hydeStartGapBonusU: 12, catchKnockbackBonusU: 10 },
  divina: { coastDragMult: 0.6, coastAfterS: 0.5 },
  rowan: { pushRadiusU: 4, pushCooldownS: 6 },
  eugene: { landingPointerS: 5, seekCooldownMult: 0.5 },
  morticia: { rescueWindowBonusS: 0.8, cleanEscapeBonusS: 0.3 },
  gomez: { hydeRangeU: 18, impulseMult: 1.25 },
};
