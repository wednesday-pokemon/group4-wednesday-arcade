// Tunable real-time constants (rules v3.0-realtime). Every gameplay number lives here or in src/action/data/.
import type { RowingConfig } from './types.ts';

export const ACTION_RULES_VERSION = 'v3.0-realtime' as const;

/** Physics runs at a fixed step for frame-rate independence; rendering interpolates nothing (step is tiny). */
export const FIXED_STEP_S = 1 / 120;
export const MAX_FRAME_S = 0.1; // clamp long frames (tab switch) so the boat never teleports

/**
 * Client-suggested starting values: impulse 1.2, max 12 u/s, steer 2.4 rad/s, useful cadence 2–6 taps/s.
 * Steady-state speeds with these numbers: ~7.1 u/s at 2 taps/s, ~8.5 at 3/s, ~10.1 at 6/s; boosts reach 12.
 * Coasting keeps momentum: from 5.4 u/s the boat still glides at ~2.4 u/s after 3 s.
 */
export const ROWING: RowingConfig = {
  baseImpulse: 1.2,
  maxSpeed: 12,
  minStrokeIntervalS: 0.14, // ≈ 7 taps/s cap; faster presses are "missed strokes"
  drag: 0.18,
  linearDrag: 0.25,
  brakeDrag: 1.6,
  cruiseSpeed: 3,
  cruiseAccel: 1.5,
  steerRate: 2.4,
  steerMinAuthority: 0.35,
  holdCadenceHz: 3,
  strokeStaminaCost: 1.6,
  cruiseStaminaPerS: 0.6,
  staminaRegenPerS: 4, // always-on recovery; ~2.5 taps/s is sustainable
  regenDelayS: 0.8, // after this idle time, recovery doubles (coasting bonus)
  lowStaminaThreshold: 0.25,
  lowStaminaFloor: 0.35,
};

export const BOAT = {
  maxHp: 100,
  baseMaxStamina: 100,
  /** Two-circle hull collider along the boat's forward axis (bow +, stern −). */
  hullCircles: [
    { offset: 1.15, radius: 0.75 },
    { offset: -0.95, radius: 0.8 },
  ],
} as const;

export const COLLISION = {
  perObstacleCooldownS: 1.5, // the same obstacle cannot damage again within this window
  invulnerableS: 0.6, // global grace after any hit
  speedLossHeadOn: 0.65, // fraction of speed lost on a head-on hit (scaled by impact angle)
  minImpactFactor: 0.25,
  referenceSpeed: 9, // impact speed giving full listed damage
  minDamageFraction: 0.35,
  contactDragPerS: 3, // sustained contact: per-second drag × how directly the bow pushes into the obstacle
  deflectRad: 0.18, // bow nudged off the obstacle on impact (less for head-on hits)
  wallDragPerS: 2.5, // course boundary scrape: exponential drag × how directly the bow points into the edge
} as const;

/** Land masses (shores, islets, reefs): solid polygons the hull slides along. Shores never damage. */
export const LAND = {
  wallDragPerS: 2.5, // same feel as the course boundary: drag × how directly the bow points into the shore
  reefDamage: 6, // light scrape, only for fast head-on reef hits
  reefMinSpeed: 6, // impact speed (along the normal) below which a reef never hurts
  reefMinHeadOn: 0.6, // cos of the approach angle; below this it is a scrape, never damage
  reefCooldownS: 1.5,
  bumpEventSpeed: 2.5, // shore bumps above this emit a (0-damage) collision event for splashes
  /**
   * While touching land the bow yaws toward the shoreline tangent at this rate × sin(approach angle), so a boat
   * pushed into a shore glides along it instead of grinding (a dead-on hit stays a dead stop). The player's own
   * steering (2.4 rad/s × handling) easily overrides it.
   */
  slideAlignRadPerS: 1.2,
} as const;

/** Hyde AI extras not covered by STAGE_TUNING.hyde.stage1 (src/action/data/stages.ts). All tuning defaults. */
export const HYDE = {
  trailSampleU: 0.75, // breadcrumb spacing along the boat's wake
  trailSeedBehindU: 160, // the wake is seeded straight back from the start so knockbacks always have room
  trailKeepBehindU: 220, // prune breadcrumbs this far behind the Hyde
  emergeS: 1.5,
  stalkVisibility: 0.2,
  stalkMaxS: 10, // fallback: a stalking Hyde emerges after this long even if the trigger was missed
  dormantMaxS: 30, // fallback: the disturbance happens by this time even if the player idles at the start
  lungeRangeU: 7,
  lungeExitU: 12,
  /**
   * While lunging he moves at the player's recent pace (vAvg) + this, never more than maxClosingRel over the boat.
   * A boat holding its pace loses ~lungeMinRel × lungeMaxS = 3 u to the snap and survives it from lungeRangeU; a boat
   * that stops, crashes or brakes during it is caught; rowing harder than your average out-runs it.
   */
  lungeMinRel: 2.5,
  lungeMaxS: 1.2, // a lunge is a snap, not a pursuit: after this long it has missed …
  lungeCooldownS: 3, // … and he cannot lunge again for this long (he still chases / surges meanwhile)
  retreatSpeed: 4, // u/s back along the wake (safe harbour / finished)
  surgeMinSpacingS: 12, // two surge triggers never chain into one long surge
  /**
   * A surge burst brings him to this gap and then he holds there, matching the player's recent pace (vAvg) for the
   * rest of the burst: right on the stern, but only a slowdown, stop or crash lets him into lunge range.
   */
  surgeHoldGapU: 10,
  // warnings (D-32): level 1 when he gets inside the danger band (a clean rower's steady gap is ~18–22 u, so it only
  // fires on a surge or a mistake); level 2 inside the surge hold — only a slip during a surge, a stop or a crash.
  warn1GapU: 15,
  warn1RearmU: 19,
  warn2GapU: 9,
  warn2RearmU: 12,
  threatRangeU: 35, // threat starts rising below this gap
  closeCallU: 8, // gap below this then back above closeCallRecoverU without a catch = a close call
  closeCallRecoverU: 16,
  dangerGapU: 15, // time spent below this gap counts toward timeInDangerS
  distractDecoyU: 14, // decoy is placed this far to the side of the Hyde
  aegisStunS: 1, // brief stagger after an active King's Shield repels a grab
  rescueHoldDragPerS: 4, // the held boat bleeds speed during the slow-motion window
} as const;

/** Run-level presentation and fallback numbers. */
export const RUN = {
  cinematicS: 2.6, // 'hyde_reveal' camera moment (≤ 3 s); gameplay continues
  fallbackDisturbanceProgress: 0.12, // used when a course has no encounter triggers (Phase 1 crossing)
  fallbackEmergeProgress: 0.2,
  fallbackSafeHarbourProgress: 0.96,
  encounterProgressMargin: 0.06, // a missed trigger fires anyway once progress passes it by this much
  disturbanceFogS: 18, // how long the disturbance fog lingers (ramps in 2 s, fades out at the end)
  disturbanceFogRampS: 2,
  corsolaCurseS: 8, // "after any catch, the Hyde moves at 75% for 8 s" (duration from the passive text)
} as const;
