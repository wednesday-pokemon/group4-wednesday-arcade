// Stage, Hyde AI, egg, rescue and rowing tuning (rules v3.0-realtime). Pure data: no logic, type-only imports.
// Every number is a TUNING DEFAULT unless marked [LOCKED] (client-specified). Formulas: docs/GDD_V3_REALTIME.md.
// Egg tier POINTS are not duplicated here: they stay in EGG_POINTS (src/game/constants.ts).
import type { EggTier } from '../../game/types.ts';
import type { ObstacleKind, RowingConfig } from '../types.ts';

/** Tiers that can actually be carried (no 'none'). */
export type CarriedEggTier = Exclude<EggTier, 'none'>;

// ---------------------------------------------------------------------------------------------------------------
// Rowing (GDD §2)
// ---------------------------------------------------------------------------------------------------------------

export const ROWING_DEFAULTS: RowingConfig = {
  baseImpulse: 1.2, // [LOCKED] u/s per accepted stroke at rowingPower 5
  maxSpeed: 12, // [LOCKED] u/s at topSpeed 5
  minStrokeIntervalS: 0.15, // ~6.7 Hz hard cap; useful cadence 2–6 Hz [LOCKED range]
  drag: 0.36, // exponential, per second (time constant ~2.8 s)
  linearDrag: 0.4, // u/s²
  brakeDrag: 1.8, // extra exponential drag while S held (8 -> ~1 u/s in ~1 s)
  cruiseSpeed: 4.5, // W glide target: slower than the Hyde floor, so W-only gets caught eventually
  cruiseAccel: 1.6,
  steerRate: 2.4, // [LOCKED] rad/s at handling 5
  steerMinAuthority: 0.35, // fraction of steering at 0 u/s; full authority at ROWING_EXTRAS.steerFullAuthoritySpeed
  holdCadenceHz: 2.5, // accessibility hold-to-row: ~7.1 u/s, near stamina-neutral
  strokeStaminaCost: 1.6,
  cruiseStaminaPerS: 1.0, // regen still runs while gliding (net ~ +13/s)
  staminaRegenPerS: 14,
  regenDelayS: 0.3, // so 2 Hz is sustainable and >= 3 Hz drains
  lowStaminaThreshold: 0.25,
  lowStaminaFloor: 0.45,
};

export interface RowingExtras {
  maxStamina: number; // at stamina rating 5
  impulseFalloffExponent: number; // Δv x (1 - (v / Vmax)^n): diminishing returns near max speed
  overCapDecayPerS: number; // boost leftovers above Vmax bleed off at this rate
  steerFullAuthoritySpeed: number; // u/s at which steering reaches full authority
  missedStrokeStaminaCost: number; // presses faster than the cadence cap
  usefulCadenceMinHz: number;
  usefulCadenceMaxHz: number;
}

export const ROWING_EXTRAS: RowingExtras = {
  maxStamina: 100,
  impulseFalloffExponent: 8,
  overCapDecayPerS: 3,
  steerFullAuthoritySpeed: 4,
  missedStrokeStaminaCost: 0.5,
  usefulCadenceMinHz: 2,
  usefulCadenceMaxHz: 6,
};

// ---------------------------------------------------------------------------------------------------------------
// Stage tuning types
// ---------------------------------------------------------------------------------------------------------------

/** Hyde AI per boat stage (GDD §5). Speeds in u/s, distances in u along the player's wake. */
export interface HydeStageTuning {
  lurkS: number;
  startGapU: number; // Stage 3: maximum; actual start gap is reduced by hunt time (Stage3Tuning)
  floorSpeed: number;
  paceFactor: number; // x player's moving-average speed
  paceAvgTauS: number;
  rubberK: number; // u/s of Hyde speed per u of (gap - targetGap)
  targetGapU: number;
  leashGapU: number;
  leashRelSpeed: number;
  minSpeed: number;
  maxSpeed: number;
  maxClosingRel: number; // cap on (v_hyde - v_player) outside surges
  surgeAtProgress: readonly number[]; // course progress fractions 0–1
  surgeBoost: number; // surge speed = player avg speed + surgeBoost
  surgeDurationS: number;
  surgeTelegraphS: number;
  surgeMinStartGapU: number; // fairness: never start a surge closer than this
  surgeDeferMaxS: number; // deferred surge is skipped after this long
  catchRadiusU: number;
  catchHullDamage: number;
  catchEggSecurityLoss: number;
  postCatchGapU: number;
  recoverStunS: number;
  postCatchInvulnS: number;
  finalChaseAtProgress: number; // 0 = no final chase
  finalChaseFloorBonus: number;
  finalChasePaceFactor: number;
  finalChaseTargetGapU: number;
  floorBonusByCarriedTier: Record<CarriedEggTier, number>; // rarer egg aboard = more aggressive Hyde
}

export interface BoatStageTuning {
  courseLengthU: number;
  courseWidthU: number;
  segmentEndU: readonly number[]; // cumulative distance from start where each segment ends
  densityPer100U: readonly number[]; // obstacles per 100 u, one entry per segment
  obstacleCountTarget: number;
  driftingLogShare: number; // fraction of logs with drift
  driftAmplitudeU: number;
  driftPeriodS: number;
  narrowPassageWidthsU: readonly number[];
  currentPushUps: readonly number[]; // strength of each current zone (u/s)
  fogDensity: number; // 0–1
  dockRadiusU: number;
  dockMaxSpeed: number;
  assistAfterS: number; // lake-spirit guiding current kicks in after this many stage seconds
  assistCurrentUps: number;
}

export interface Stage3Tuning extends BoatStageTuning {
  startGapMaxU: number;
  startGapMinU: number;
  huntGraceS: number; // Stage 2 seconds before the head start begins to shrink
  startGapLossPerHuntS: number; // u of head start lost per Stage 2 second beyond the grace
  deliverS: number;
}

/** One candidate egg spot on the island (island frame: dock at 0,0; inland = -Z). */
export interface EggSpotTuning {
  x: number;
  z: number;
  reachClass: number; // 0 common, 1 rare, 2 legendary (matches the tier rolled)
  pathU: number; // walking path length from the dock
}

export interface Stage2Tuning {
  walkSpeed: number;
  walkAccel: number;
  interactRadiusU: number;
  collectS: number;
  cryptLidHoldS: number; // legendary spots only
  boardRadiusU: number;
  eggGlowRadiusU: number;
  eggColumnRadiusU: number; // within this, a light column shows through walls
  wispFadeRadiusU: number;
  activeSpotsMin: number;
  activeSpotsMax: number;
  extraActiveSpotChance: number;
  spots: readonly EggSpotTuning[];
  hubX: number;
  hubZ: number;
  bogSpeedMult: number;
  forestRootSpeedMult: number;
  crumbleDelayS: number;
  fallResetS: number;
  cryptLanternRadiusU: number;
  shadeCount: number;
  shadePatrolSpeed: number;
  shadeChaseSpeed: number;
  shadeSightU: number;
  shadeLoseU: number;
  shadeLoseS: number;
  shadeStaggerS: number;
  shadeKnockbackU: number;
  eggDropDistanceU: number;
  eggRepickS: number;
  seekCooldownS: number;
  seekArrowS: number;
  seekTrailS: number;
  seekRevealS: number;
  seekRepelRadiusU: number;
  seekRepelStunS: number;
  seekWalkBoostMult: number;
  seekWalkBoostS: number;
  pokemonExcitedRadiusU: number;
  beaconAfterS: number;
  guideAfterS: number;
}

export interface EggTuning {
  tierDistribution: Record<CarriedEggTier, number>; // must sum to 1 (exact binary fractions)
  startSecurity: number;
  collisionBaseLoss: number; // + collisionImpactLoss x f, f = (min(v, refSpeed) / refSpeed)^impactExponent
  collisionImpactLoss: number;
  tierLossMult: Record<CarriedEggTier, number>;
  settleDelayS: number;
  settleRegenPerS: number;
  settleCap: number;
  hardHitSpeed: number;
  hardHitFallBelowSecurity: number;
  overboardDriftUps: number;
  overboardSinkS: number;
  sinkWarningS: number;
  recoverRadiusU: number;
  recoverMaxSpeed: number;
  recoverScoopS: number;
  recoverScoopSpeedMult: number;
  recoverHydeClosingCap: number;
  recoverSecurity: number;
  pristineThreshold: number;
}

export interface StageTuning {
  scoring: { scorePerEggPoint: number; scorePerSecond: number; rescueClockScale: number };
  catches: { catchLimit: number }; // the catchLimit-th counted catch = DNF [LOCKED: 2]
  rescue: {
    windowS: number;
    timeScale: number;
    cleanEscapeWindowS: number;
    maxCleanEscapesPerRun: number;
    readyAtCooldownFraction: number;
    struggleReductionPerPress: number;
    struggleMaxReduction: number;
    struggleKnockbackPerPressU: number;
    struggleMaxKnockbackU: number;
  };
  mercy: {
    floorPenalty: number;
    surgeBoostMult: number;
    maxClosingRel: number;
    finalChaseFloorBonusMult: number;
    rescueWindowBonusS: number;
  };
  hull: { maxHp: number; restoreBeforeStage3Hp: number; swampedStallS: number; swampedRestoreHp: number };
  collision: {
    refSpeed: number;
    minDamageSpeed: number;
    impactExponent: number;
    damageByKind: Record<ObstacleKind, number>;
    speedRetainByKind: Record<ObstacleKind, number>;
    bounceU: number;
    invulnS: number;
    glancingAngleDeg: number;
    glancingDamageMult: number;
    glancingSpeedRetain: number;
    sunkenBranchVisibleU: number;
  };
  fog: { clearVisibilityU: number; fullDensityVisibilityU: number };
  hyde: { stage1: HydeStageTuning; stage3: HydeStageTuning };
  stage1: BoatStageTuning;
  stage2: Stage2Tuning;
  stage3: Stage3Tuning;
  egg: EggTuning;
  abilities: {
    shieldSpeedRetain: number;
    eggProtectHullFactor: number; // hull x (1 - magnitude x factor)
    eggSenseWaterRadiusMult: number;
    aegisShieldBlockKnockbackU: number;
  };
  statScaling: {
    neutralRating: number;
    statBudget: number;
    statMin: number;
    statMax: number;
    rowingPowerPerPoint: number;
    topSpeedPerPoint: number;
    staminaMaxPerPoint: number;
    staminaRegenPerPoint: number;
    handlingSteerPerPoint: number;
    handlingGlancingDegPerPoint: number;
    defenseReductionPerPoint: number;
  };
  advisor: { minGapBetweenLinesS: number; maxRepeatsPerLine: number; lineDisplayS: number; maxWords: number };
  idle: { promptAfterS: number; overlayAfterS: number; abandonAfterOverlayS: number };
  pacing: {
    sessionTargetS: number;
    welcomeS: number;
    selectionS: number;
    resultsS: number;
    /** Gameplay seconds per stage [Stage 1, Stage 2, Stage 3] by player profile. */
    strongS: readonly number[];
    typicalS: readonly number[];
    strugglingS: readonly number[];
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Values
// ---------------------------------------------------------------------------------------------------------------

export const STAGE_TUNING: StageTuning = {
  scoring: { scorePerEggPoint: 100, scorePerSecond: 1, rescueClockScale: 0.25 }, // [LOCKED] x100 and -1/s

  catches: { catchLimit: 2 },

  rescue: {
    windowS: 2.0, // real seconds
    timeScale: 0.25,
    cleanEscapeWindowS: 0.5, // Q this early = catch not counted
    maxCleanEscapesPerRun: 1,
    readyAtCooldownFraction: 0.75, // ability counts as ready for a rescue at 75% cooldown
    struggleReductionPerPress: 0.06,
    struggleMaxReduction: 0.48,
    struggleKnockbackPerPressU: 0.5,
    struggleMaxKnockbackU: 4,
  },

  mercy: {
    // "Last-chance mode" after the first counted catch, for the rest of the run.
    floorPenalty: 1.0,
    surgeBoostMult: 0.5,
    maxClosingRel: 3.0,
    finalChaseFloorBonusMult: 0,
    rescueWindowBonusS: 0.5,
  },

  hull: { maxHp: 100, restoreBeforeStage3Hp: 100, swampedStallS: 2.5, swampedRestoreHp: 35 },

  collision: {
    refSpeed: 12,
    minDamageSpeed: 2,
    impactExponent: 1.5,
    damageByKind: { rock: 24, dock: 26, log: 18, branch: 10, buoy: 6, debris: 8 },
    speedRetainByKind: { rock: 0.3, dock: 0.25, log: 0.4, branch: 0.6, buoy: 0.7, debris: 0.55 },
    bounceU: 1.5,
    invulnS: 0.6,
    glancingAngleDeg: 20,
    glancingDamageMult: 0.35,
    glancingSpeedRetain: 0.8,
    sunkenBranchVisibleU: 8,
  },

  fog: { clearVisibilityU: 60, fullDensityVisibilityU: 8 }, // visibility = lerp(clear, full, density)

  hyde: {
    // D-32 retune (was: startGapU 45, floorSpeed 5.2, paceFactor 0.85, paceAvgTauS 6, rubberK 0.07, targetGapU 28,
    // maxSpeed 11.5, surgeMinStartGapU 18). He now sits ~18–22 u behind a 3 taps/s rower (on screen), every surge
    // brings him to the stern (~10 u, HYDE.surgeHoldGapU), and the floor catches a 1.5 taps/s rower. Measured on the
    // lake with the test autopilot: tests/unit/action/hyde.test.ts + endToEnd.test.ts lock these targets in.
    stage1: {
      lurkS: 6,
      startGapU: 26,
      floorSpeed: 7.45, // ≈ a 2 taps/s rower's speed: below it you lose ground
      paceFactor: 0.95,
      paceAvgTauS: 4,
      rubberK: 0.1,
      targetGapU: 16.5,
      leashGapU: 70,
      leashRelSpeed: 2.0,
      minSpeed: 3.5,
      maxSpeed: 13, // never binds a surge burst, even in a following current
      maxClosingRel: 4.5,
      surgeAtProgress: [0.33, 0.82],
      surgeBoost: 3.0,
      surgeDurationS: 4.0,
      surgeTelegraphS: 1.5,
      surgeMinStartGapU: 17,
      surgeDeferMaxS: 10,
      catchRadiusU: 3.0,
      catchHullDamage: 25,
      catchEggSecurityLoss: 0,
      postCatchGapU: 32,
      recoverStunS: 3.0,
      postCatchInvulnS: 5,
      finalChaseAtProgress: 0,
      finalChaseFloorBonus: 0,
      finalChasePaceFactor: 0.85,
      finalChaseTargetGapU: 28,
      floorBonusByCarriedTier: { common: 0, rare: 0, legendary: 0 },
    },
    stage3: {
      lurkS: 3,
      startGapU: 50,
      floorSpeed: 5.0,
      paceFactor: 0.9,
      paceAvgTauS: 6,
      rubberK: 0.075,
      targetGapU: 22,
      leashGapU: 60,
      leashRelSpeed: 2.0,
      minSpeed: 4.0,
      maxSpeed: 12.5,
      maxClosingRel: 5.0,
      surgeAtProgress: [0.3, 0.66],
      surgeBoost: 3.5,
      surgeDurationS: 4.0,
      surgeTelegraphS: 1.5,
      surgeMinStartGapU: 18,
      surgeDeferMaxS: 10,
      catchRadiusU: 3.0,
      catchHullDamage: 30,
      catchEggSecurityLoss: 40,
      postCatchGapU: 28,
      recoverStunS: 2.5,
      postCatchInvulnS: 5,
      finalChaseAtProgress: 0.8,
      finalChaseFloorBonus: 0.4,
      finalChasePaceFactor: 0.95,
      finalChaseTargetGapU: 16,
      floorBonusByCarriedTier: { common: 0, rare: 0.2, legendary: 0.4 },
    },
  },

  stage1: {
    courseLengthU: 460,
    courseWidthU: 120,
    segmentEndU: [80, 170, 270, 360, 460], // warm-up, open water, fog bank, narrow passage, dock approach
    densityPer100U: [2.5, 6.5, 8, 5, 6],
    obstacleCountTarget: 26,
    driftingLogShare: 0.25,
    driftAmplitudeU: 4,
    driftPeriodS: 6,
    narrowPassageWidthsU: [14],
    currentPushUps: [1.8, 2.0],
    fogDensity: 0.7,
    dockRadiusU: 6,
    dockMaxSpeed: 4,
    assistAfterS: 75,
    assistCurrentUps: 1.2,
  },

  stage2: {
    walkSpeed: 4.5,
    walkAccel: 18,
    interactRadiusU: 2,
    collectS: 0.6,
    cryptLidHoldS: 1.5,
    boardRadiusU: 3,
    eggGlowRadiusU: 18,
    eggColumnRadiusU: 10,
    wispFadeRadiusU: 6,
    activeSpotsMin: 3,
    activeSpotsMax: 4,
    extraActiveSpotChance: 0.5,
    spots: [
      { x: -18, z: -14, reachClass: 0, pathU: 24 }, // C1 Lantern Shrine
      { x: 20, z: -10, reachClass: 0, pathU: 24 }, // C2 Old Boathouse
      { x: -34, z: -38, reachClass: 1, pathU: 50 }, // R1 Bell Ruin (crumbling stone path)
      { x: 30, z: -42, reachClass: 1, pathU: 52 }, // R2 Hollow Oak (fog forest)
      { x: -22, z: -68, reachClass: 2, pathU: 76 }, // L1 Crypt Vault (dark crypt, Shade B)
      { x: 18, z: -72, reachClass: 2, pathU: 78 }, // L2 Raven Ossuary (crumbling bridge + crypt)
    ],
    hubX: 0,
    hubZ: -34,
    bogSpeedMult: 0.55,
    forestRootSpeedMult: 0.7,
    crumbleDelayS: 0.8,
    fallResetS: 2.0,
    cryptLanternRadiusU: 6,
    shadeCount: 2,
    shadePatrolSpeed: 3.0,
    shadeChaseSpeed: 4.0,
    shadeSightU: 9,
    shadeLoseU: 14,
    shadeLoseS: 4,
    shadeStaggerS: 1.2,
    shadeKnockbackU: 3,
    eggDropDistanceU: 1.5,
    eggRepickS: 0.5,
    seekCooldownS: 12,
    seekArrowS: 2.5,
    seekTrailS: 4,
    seekRevealS: 6,
    seekRepelRadiusU: 8,
    seekRepelStunS: 3,
    seekWalkBoostMult: 1.3,
    seekWalkBoostS: 3,
    pokemonExcitedRadiusU: 25,
    beaconAfterS: 60,
    guideAfterS: 100,
  },

  stage3: {
    courseLengthU: 520,
    courseWidthU: 140,
    segmentEndU: [60, 180, 260, 340, 420, 520], // push-off, graveyard, rapids, twin narrows, deep fog, final chase
    densityPer100U: [4, 9, 10, 8, 10, 7],
    obstacleCountTarget: 43,
    driftingLogShare: 0.35,
    driftAmplitudeU: 5,
    driftPeriodS: 5,
    narrowPassageWidthsU: [12, 10],
    currentPushUps: [2.6, 3.0, 3.2],
    fogDensity: 0.85,
    dockRadiusU: 6,
    dockMaxSpeed: 4,
    assistAfterS: 95,
    assistCurrentUps: 1.2,
    startGapMaxU: 50,
    startGapMinU: 28,
    huntGraceS: 40,
    startGapLossPerHuntS: 0.15,
    deliverS: 1.0,
  },

  egg: {
    tierDistribution: { common: 0.5, rare: 0.375, legendary: 0.125 }, // sums to exactly 1; E[points] = 2.375
    startSecurity: 100,
    collisionBaseLoss: 5,
    collisionImpactLoss: 25,
    tierLossMult: { common: 0.8, rare: 1.0, legendary: 1.25 },
    settleDelayS: 5,
    settleRegenPerS: 1,
    settleCap: 70,
    hardHitSpeed: 9,
    hardHitFallBelowSecurity: 35,
    overboardDriftUps: 1.2,
    overboardSinkS: 15,
    sinkWarningS: 5,
    recoverRadiusU: 4,
    recoverMaxSpeed: 5,
    recoverScoopS: 0.8,
    recoverScoopSpeedMult: 0.5,
    recoverHydeClosingCap: 2,
    recoverSecurity: 40,
    pristineThreshold: 90,
  },

  abilities: {
    shieldSpeedRetain: 0.85,
    eggProtectHullFactor: 0.5,
    eggSenseWaterRadiusMult: 0.5,
    aegisShieldBlockKnockbackU: 10,
  },

  statScaling: {
    neutralRating: 5,
    statBudget: 30,
    statMin: 3,
    statMax: 9,
    rowingPowerPerPoint: 0.04, // impulse x (1 + 0.04 (r - 5))
    topSpeedPerPoint: 0.04, // Vmax x (1 + 0.04 (r - 5))
    staminaMaxPerPoint: 0.08,
    staminaRegenPerPoint: 0.05,
    handlingSteerPerPoint: 0.06,
    handlingGlancingDegPerPoint: 2,
    defenseReductionPerPoint: 0.06, // hull and egg loss x (1 - 0.06 (r - 5))
  },

  advisor: { minGapBetweenLinesS: 6, maxRepeatsPerLine: 2, lineDisplayS: 2.5, maxWords: 8 },

  idle: { promptAfterS: 20, overlayAfterS: 40, abandonAfterOverlayS: 15 },

  pacing: {
    sessionTargetS: 360,
    welcomeS: 30,
    selectionS: 45,
    resultsS: 40,
    strongS: [50, 40, 60],
    typicalS: [68, 65, 82],
    strugglingS: [90, 90, 100],
  },
};
