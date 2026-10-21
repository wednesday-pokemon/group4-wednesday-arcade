// Central tuning for "The Silent Evidence" (rules mystery-v3.1). Game-designer owned.
//
// Every number is a PROPOSED DEFAULT for playtesting, not a validated balance claim (plan §7: "All configurable,
// playtest rather than claim final"). Units are in the key names or the trailing comment:
//   M = metres, S = seconds, Mps = metres/second, PerS = units per second, Mult = multiplier (1 = neutral),
//   loudness = 0..1 noise emission, security = 0..100 egg condition, hp = hit points.
// Pure data (shared with Deno Edge Functions): no Math.random, no Date, no DOM.
import { EGG_POINTS } from '../../game/constants.ts';

export const MYSTERY_TUNING = {
  /** Fixed simulation step used by MysteryRun.update (60 Hz). */
  sim: { fixedStepS: 1 / 60 },

  player: {
    radiusM: 0.4,
    maxHp: 100,
    /** Base speeds before PlayMods (walkSpeedMult applies to all three; sprintSpeedMult only to sprint). */
    walkSpeedMps: 3.2,
    crouchSpeedMps: 1.6,
    sprintSpeedMps: 5.5,
    accelMps2: 20, // how fast speed reaches the target (snappy but not instant)
    interactRangeM: 1.8, // E reaches a clue / egg / switch within this distance of the player centre
    hintCooldownS: 10, // V (Thing hint) cooldown (UX spec §4)
    eggDropHoldS: 0.8, // hold E this long to set the carried egg down; a tap never drops it (UX ruling 4)
    practiceSearchS: 1.0, // tutorial practice crate at the pier (island.ts PRACTICE_CRATE)
  },

  /** Carrying the egg: slower and a little louder. Sprint stays allowed (fair escape). */
  carry: {
    speedMult: 0.85, // all stances × 0.85 while carried
    footstepLoudnessAdd: 0.1, // added to every footstep loudness while carried (walk 0.35 → 0.45)
  },

  /** Loudness 0..1 of each emission, BEFORE footstepNoiseMult (footsteps only) and clamped to 0..1 after. */
  noise: {
    crouch: 0.1,
    walk: 0.35,
    sprint: 0.95,
    eggDrop: 1.0, // forced drop (impact / grab / security ran out)
    eggSetDown: 0.25, // manual E drop: the player sets the egg down, no security loss
    eggPickup: 0.15,
    impact: 0.6, // sprinting into a wall/cover while carrying the egg
    clueSearch: 0.15, // emitted when a search starts and every searchNoiseIntervalS while searching
    searchNoiseIntervalS: 1.0,
    deposit: 0.2, // egg placed in Iago Tower
    /** Footstep cadence: one footstep noise event per interval while moving in that stance. */
    footstepIntervalS: { crouch: 0.7, walk: 0.5, sprint: 0.32 },
  },

  hearing: {
    /**
     * Loudness → hearing radius (metres), piecewise-linear between knots [loudness, radiusM].
     * Matches the plan: crouch 0.10 → 2 m, walk 0.35 → 7 m, sprint 0.95 → 13 m, egg drop 1.00 → 17 m.
     * Use `hearingRadiusM()` below.
     */
    loudnessRadiusKnots: [
      [0, 0],
      [0.1, 2],
      [0.35, 7],
      [0.95, 13],
      [1.0, 17],
    ],
    /** Each wall crossing the straight line source→Hyde multiplies the effective radius by this. */
    wallOcclusionMult: 0.5,
    maxOccludingWallsCounted: 2, // so the floor is radius × 0.25
    /** In COOLDOWN the Hyde hears worse (it is returning to its route). */
    cooldownHearingMult: 0.6,
  },

  sight: {
    coneDeg: 100, // full cone angle centred on the Hyde's yaw
    rangeClearM: 13,
    rangeFogM: 8, // when the Hyde OR the player is inside a room with fog: true
    crouchRangeMult: 0.7, // a crouching player in the open is seen at range × 0.7
    /** Low cover blocks sight to a CROUCHING player only; high cover and walls block sight always. */
    lowCoverBlocksCrouchedOnly: true,
    /** Default reveal distance for hiding spots (each HidingSpotDef carries its own revealM). */
    hidingRevealDefaultM: 2,
    instantChaseM: 3, // a visible player this close triggers CHASE immediately (no ramp)
    eyeHeightM: 2.1, // for renderer / debug only; LOS is 2D against walls & high cover
  },

  /**
   * Suspicion 0..1 drives the HUD meter and the fair ramp before a chase.
   * Seen: + sightGainPerS × (1 + (1 − d / range)) per second  → ~1.1 s at max range, ~0.55 s point-blank.
   * Heard: + heardGainPerLoudness × loudness per heard event  → walk step 0.21, sprint step 0.57.
   */
  suspicion: {
    sightGainPerS: 0.9,
    heardGainPerLoudness: 0.6,
    investigateAt: 0.3, // heard noise pushing suspicion ≥ this → INVESTIGATE_SOUND at the noise position
    investigateLoudnessAlways: 0.9, // any heard noise this loud investigates immediately
    chaseAt: 1.0, // seen + suspicion ≥ 1 → CHASE
    decayPerS: 0.15, // when nothing is heard or seen (not while chasing)
  },

  hyde: {
    radiusM: 0.6,
    minSpawnDistanceM: 25, // never spawn / respawn within this distance of the player
    turnRateRadPerS: 4.0,
    /** Mode speeds (m/s): patrol < walk 3.2 < chase < sprint 5.5. Slowest legal duo sprints ≥ 4.22 m/s carrying. */
    speedMps: { PATROL: 2.4, INVESTIGATE_SOUND: 3.0, SEARCH: 2.2, CHASE: 4.0, COOLDOWN: 2.0 },
    /** Mode timers (s). */
    chaseLossS: 4, // CHASE → SEARCH after this long without sight
    searchS: 8, // SEARCH duration around lastKnown before COOLDOWN
    searchWanderRadiusM: 6,
    investigateMaxS: 12, // give up an unreachable investigation → SEARCH
    cooldownS: 5, // COOLDOWN (walk back to the patrol loop, reduced hearing) → PATROL
    cooldownAfterGrabS: 6,
    waypointReachedM: 1.0,
  },

  grab: {
    rangeM: 1.2, // CHASE within this distance starts the grab wind-up
    windupS: 0.7, // reaction window: a stun/pin effect (F or Q) during the wind-up cancels the grab
    connectRangeM: 1.8, // the grab lands if the player is still within this distance when the wind-up ends
    hpLoss: 35, // × catchDamageMult, rounded to an integer
    eggSecurityLoss: 40, // × eggSecurityLossMult, only while carrying
    releaseInvulnerableS: 3, // after release at a safe point: cannot be grabbed, Hyde ignores the player
    safeReleaseMinHydeDistM: 18, // choose a safeReleasePoint ≥ this far from the Hyde, nearest to the grab spot
    maxCatches: 2, // the second catch is a DNF (even if King's Shield blocked its damage)
  },

  egg: {
    /** Seeded tier draw. Weights sum to 1. Points are whole numbers (no fractional points from any effect). */
    tierWeights: { common: 0.5, rare: 0.35, legendary: 0.15 },
    points: { common: EGG_POINTS.common, rare: EGG_POINTS.rare, legendary: EGG_POINTS.legendary },
    securityMax: 100,
    securityFloor: 0, // the egg never breaks: delivery is always possible (no softlock)
    lossImpact: 8, // per impact (sprint ≥ impactSpeedMps into a wall/cover while carrying)
    lossGrab: 40, // = grab.eggSecurityLoss
    lossManualDrop: 0,
    impactSpeedMps: 4.5,
    impactCooldownS: 0.6, // at most one impact per 0.6 s (scraping along a wall is not a machine gun)
    /** After any loss, if security ≤ this the egg falls (egg_drop, loudness noise.eggDrop) and must be picked up again. */
    dropThreshold: 30,
    pickupS: 1.2, // × interactTimeMult
    depositS: 1.0, // E hold at the tower (not scaled)
  },

  clues: {
    /** Default search time; each CluePlacement.searchS overrides it. Both × interactTimeMult. */
    searchS: 2.5,
    keepProgressOnCancel: true, // walking away pauses a search instead of resetting it
  },

  abilities: {
    maxEffectDurationS: 8, // hard cap after all multipliers (no infinite stun / shield)
    /** Diminishing returns: a stun starting within this window after the previous stun ended lasts × mult. */
    stunDiminishWindowS: 10,
    stunDiminishMult: 0.5,
    minHydeSpeedMult: 0.4, // slows never push the Hyde below 40 % speed
    lureBreaksChase: true, // a lure pulls a chasing Hyde to the decoy; afterwards it SEARCHes the player's last known spot
    distractSightMult: 0.3, // documented in the contract; repeated here for one source of numbers
    defaultLureLoudness: 0.8, // when a lure effect's magnitude is 0
    healCapToMaxHp: true,
  },

  /** Clamp range for the COMBINED (Nightshade × Pokémon) PlayMods, applied in combineMods(). */
  modsClamp: { min: 0.6, max: 1.4 },
} as const;

export type MysteryTuning = typeof MYSTERY_TUNING;

/** Piecewise-linear loudness (0..1) → hearing radius in metres, using MYSTERY_TUNING.hearing.loudnessRadiusKnots. */
export function hearingRadiusM(loudness: number): number {
  const knots = MYSTERY_TUNING.hearing.loudnessRadiusKnots;
  const l = Math.min(1, Math.max(0, loudness));
  for (let i = 1; i < knots.length; i++) {
    const lo = knots[i - 1];
    const hi = knots[i];
    if (lo === undefined || hi === undefined) break;
    if (l <= hi[0]) {
      const span = hi[0] - lo[0];
      return span <= 0 ? hi[1] : lo[1] + ((hi[1] - lo[1]) * (l - lo[0])) / span;
    }
  }
  const last = knots[knots.length - 1];
  return last === undefined ? 0 : last[1];
}
