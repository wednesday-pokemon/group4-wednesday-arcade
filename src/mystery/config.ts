// The sim's resolved tuning (internal shape), derived from the designer's MYSTERY_TUNING (src/mystery/data/tuning.ts)
// plus a few sim-only numbers (marked "sim"). Everything the sim reads lives here — no magic numbers in the modules.
// Tests may pass a modified copy (`withTuning`).
import { MYSTERY_TUNING } from './data/tuning.ts';

export interface SimTuning {
  fixedStepS: number;
  maxFrameS: number; // sim: a long frame (tab switch) is clamped to this before stepping
  player: {
    radius: number;
    walkSpeed: number;
    crouchSpeed: number;
    sprintSpeed: number;
    accelMps2: number;
    maxHp: number;
    interactRangeM: number;
    interactBreakM: number; // sim: a search / pickup / deposit pauses once the player is farther than this
    hintCooldownS: number;
    eggDropHoldS: number; // hold E this long to set the carried egg down
    practiceSearchS: number; // tutorial practice crate
    pitchLimit: number; // sim
    wetNoiseMult: number; // sim: footsteps in rooms flagged wet (1 = neutral; not in MYSTERY_TUNING)
    examineS: number; // E on an ExamineDef: seconds × interactTimeMult
    leverS: number; // E on a passage lever: seconds (not scaled)
  };
  carry: { speedMult: number; footstepLoudnessAdd: number };
  noise: {
    crouch: number; walk: number; sprint: number;
    eggDrop: number; eggSetDown: number; eggPickup: number; impact: number;
    clueSearch: number; searchNoiseIntervalS: number; deposit: number;
    lever: number; // a passage lever clanking open ('interact' source, at the lever)
    footstepIntervalS: { crouch: number; walk: number; sprint: number };
    knots: [number, number][];
    wallOcclusionMult: number;
    maxOccludingWalls: number;
    coverOcclusionMult: number; // sim: high cover on the line (1 = sound passes; designer counts walls only)
    cooldownHearingMult: number;
    recentWindowS: number; // sim: snapshot.recentNoise window (contract: 3 s)
  };
  sight: {
    coneDeg: number; rangeM: number; fogRangeM: number; crouchRangeMult: number; distractedRangeMult: number; instantM: number;
    playerSeesHydeM: number; // the PLAYER sees the Hyde (LOS, walls + high cover) within this distance → snapshot.hydeVisible
  };
  suspicion: { sightGainPerS: number; heardGainPerLoudness: number; investigateAt: number; investigateLoudnessAlways: number; chaseAt: number; decayPerS: number };
  hyde: {
    radius: number;
    minSpawnM: number;
    turnRatePerS: number;
    speed: { PATROL: number; INVESTIGATE_SOUND: number; SEARCH: number; CHASE: number; COOLDOWN: number };
    chaseLossS: number;
    searchS: number;
    searchRadiusM: number;
    investigateMaxS: number;
    cooldownS: number;
    cooldownAfterGrabS: number;
    waypointReachedM: number;
    replanS: number; // sim: CHASE path refresh
    grabHoldS: number; // sim: grab animation window after a catch lands
    windupSpeedMult: number; // sim: the Hyde lunges at chase speed × this during the grab windup
    emergeAfterS: number; // case maps: the Hyde is absent for this many active seconds, then emerges at a drawn spawn
    calmAfterChaseS: number; // when a chase ends (any exit from CHASE): this long with reduced hearing (calmHearingMult)
    calmHearingMult: number; // hearing × this during the calm window (fallback: hearing.cooldownHearingMult)
    searchSpotsMax: number; // sim: SEARCH visits at most this many planned spots (hiding spots / behind cover) per search
  };
  /** Bayesian site checks (docs/overhaul/OVERHAUL_CONTRACT.md "Sim rules" 2). */
  investigation: { siteCheckM: number };
  grab: {
    rangeM: number; windupS: number; connectRangeM: number; hpLoss: number; eggSecurityLoss: number;
    invulnerableS: number; safeReleaseMinHydeDistM: number; maxCatches: number;
  };
  egg: {
    tierWeights: { common: number; rare: number; legendary: number };
    points: { common: number; rare: number; legendary: number };
    impactLoss: number; impactSpeed: number; impactCooldownS: number; dropThreshold: number;
    pickupS: number; depositS: number;
  };
  clues: { searchS: number; keepProgressOnCancel: boolean };
  abilities: {
    maxEffectDurationS: number; stunDiminishWindowS: number; stunDiminishMult: number; minHydeSpeedMult: number;
    lureBreaksChase: boolean; defaultLureLoudness: number;
  };
  nav: { cellM: number; lowCoverBlocksMovement: boolean }; // sim
  /**
   * Joseph Crackstone (docs/overhaul/ENEMY_CONTRACT.md), from MYSTERY_TUNING.crackstone. `sight` has the exact
   * SimTuning['sight'] shape so sight.ts canSee() is reused unchanged (playerSeesHydeM = playerSeesCrackstoneM). Per-case
   * CrackstoneDef.sightRangeMult / scanEveryS are applied by crackstoneTuningFor() when a run is constructed.
   */
  crackstone: CrackstoneTuning;
}

export interface CrackstoneTuning {
  radius: number;
  turnRatePerS: number;
  speed: { PATROL: number; INVESTIGATE: number; CHASE: number; ATTACK: number; SEARCH: number; RETURN: number };
  patrolPauseS: number;
  sight: SimTuning['sight'];
  proximityM: number;
  suspicion: { sightGainPerS: number; chaseAt: number; decayPerS: number };
  chaseLossS: number;
  searchS: number;
  searchRadiusM: number;
  investigateMaxS: number;
  waypointReachedM: number;
  returnSightMult: number;
  scanEveryS: number;
  scanJitterS: number;
  scanWarnS: number;
  scanRadiusM: number;
  scanPulseShowS: number;
  curseRangeM: number;
  curseRadiusM: number;
  curseWindupS: number;
  curseCooldownS: number;
  curseHp: number;
  curseSlowMult: number;
  curseSlowS: number;
  curseInvulnerableS: number;
  lureRangeM: number;
  playerSeesCrackstoneM: number;
  releaseMinDistM: number;
  replanS: number; // sim: CHASE path refresh (same as the Hyde's)
  searchSpotsMax: number; // sim: SEARCH visits at most this many planned spots
  scanGraceAfterChaseS: number; // sim: no scan starts within this many seconds after a chase / curse ends (fairness)
  lookAroundRadPerS: number; // sim: turn rate of the look-around at patrol waypoints / while searching
}

/** The map's Crackstone tuning: per-case sight range × sightRangeMult (clear + fog) and scanEveryS override. */
export function crackstoneTuningFor(t: SimTuning, def: { sightRangeMult?: number; scanEveryS?: number } | null | undefined): CrackstoneTuning {
  const c = t.crackstone;
  const mult = def?.sightRangeMult !== undefined && Number.isFinite(def.sightRangeMult) && def.sightRangeMult > 0 ? def.sightRangeMult : 1;
  const every = def?.scanEveryS !== undefined && Number.isFinite(def.scanEveryS) && def.scanEveryS > 0 ? def.scanEveryS : c.scanEveryS;
  return {
    ...c,
    speed: { ...c.speed },
    suspicion: { ...c.suspicion },
    sight: { ...c.sight, rangeM: c.sight.rangeM * mult, fogRangeM: c.sight.fogRangeM * mult },
    scanEveryS: every,
  };
}

/**
 * A number from the designer's tuning that may not exist yet (the overhaul keys land in parallel): `group[key]` when it
 * is a finite number, else `fallback`.
 */
function opt(group: unknown, key: string, fallback: number): number {
  const v = group !== null && typeof group === 'object' ? (group as Record<string, unknown>)[key] : undefined;
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

/** Overhaul fallbacks used only while a key is missing from MYSTERY_TUNING (documented defaults, not balance claims). */
export const OVERHAUL_TUNING_FALLBACKS = {
  emergeAfterS: 20,
  calmAfterChaseS: 12,
  playerSeesHydeM: 16,
  siteCheckM: 4.5,
  examineS: 1.5,
  leverS: 1.5,
  lever: 0.45,
} as const;

export function tuningFromDesign(m = MYSTERY_TUNING): SimTuning {
  const F = OVERHAUL_TUNING_FALLBACKS;
  const any = m as unknown as Record<string, unknown>;
  return {
    fixedStepS: m.sim.fixedStepS,
    maxFrameS: 0.25,
    player: {
      radius: m.player.radiusM,
      walkSpeed: m.player.walkSpeedMps,
      crouchSpeed: m.player.crouchSpeedMps,
      sprintSpeed: m.player.sprintSpeedMps,
      accelMps2: m.player.accelMps2,
      maxHp: m.player.maxHp,
      interactRangeM: m.player.interactRangeM,
      interactBreakM: m.player.interactRangeM + 0.6,
      hintCooldownS: m.player.hintCooldownS,
      eggDropHoldS: m.player.eggDropHoldS,
      practiceSearchS: m.player.practiceSearchS,
      pitchLimit: 1.2,
      wetNoiseMult: 1,
      examineS: opt(m.player, 'examineS', F.examineS),
      leverS: opt(m.player, 'leverS', F.leverS),
    },
    carry: { speedMult: m.carry.speedMult, footstepLoudnessAdd: m.carry.footstepLoudnessAdd },
    noise: {
      crouch: m.noise.crouch, walk: m.noise.walk, sprint: m.noise.sprint,
      eggDrop: m.noise.eggDrop, eggSetDown: m.noise.eggSetDown, eggPickup: m.noise.eggPickup, impact: m.noise.impact,
      clueSearch: m.noise.clueSearch, searchNoiseIntervalS: m.noise.searchNoiseIntervalS, deposit: m.noise.deposit,
      lever: opt(m.noise, 'lever', F.lever),
      footstepIntervalS: { ...m.noise.footstepIntervalS },
      knots: m.hearing.loudnessRadiusKnots.map((k) => [k[0], k[1]] as [number, number]),
      wallOcclusionMult: m.hearing.wallOcclusionMult,
      maxOccludingWalls: m.hearing.maxOccludingWallsCounted,
      coverOcclusionMult: 1,
      cooldownHearingMult: m.hearing.cooldownHearingMult,
      recentWindowS: 3,
    },
    sight: {
      coneDeg: m.sight.coneDeg, rangeM: m.sight.rangeClearM, fogRangeM: m.sight.rangeFogM,
      crouchRangeMult: m.sight.crouchRangeMult, distractedRangeMult: m.abilities.distractSightMult, instantM: m.sight.instantChaseM,
      playerSeesHydeM: opt(m.sight, 'playerSeesHydeM', F.playerSeesHydeM),
    },
    suspicion: { ...m.suspicion },
    hyde: {
      radius: m.hyde.radiusM,
      minSpawnM: m.hyde.minSpawnDistanceM,
      turnRatePerS: m.hyde.turnRateRadPerS,
      speed: { ...m.hyde.speedMps },
      chaseLossS: m.hyde.chaseLossS,
      searchS: m.hyde.searchS,
      searchRadiusM: m.hyde.searchWanderRadiusM,
      investigateMaxS: m.hyde.investigateMaxS,
      cooldownS: m.hyde.cooldownS,
      cooldownAfterGrabS: m.hyde.cooldownAfterGrabS,
      waypointReachedM: m.hyde.waypointReachedM,
      replanS: 0.4,
      grabHoldS: 0.8,
      windupSpeedMult: 0.75,
      emergeAfterS: opt(m.hyde, 'emergeAfterS', F.emergeAfterS),
      calmAfterChaseS: opt(m.hyde, 'calmAfterChaseS', F.calmAfterChaseS),
      calmHearingMult: opt(m.hyde, 'calmHearingMult', m.hearing.cooldownHearingMult),
      searchSpotsMax: 4,
    },
    investigation: { siteCheckM: opt(any.investigation, 'siteCheckM', F.siteCheckM) },
    grab: {
      rangeM: m.grab.rangeM, windupS: m.grab.windupS, connectRangeM: m.grab.connectRangeM, hpLoss: m.grab.hpLoss,
      eggSecurityLoss: m.grab.eggSecurityLoss, invulnerableS: m.grab.releaseInvulnerableS,
      safeReleaseMinHydeDistM: m.grab.safeReleaseMinHydeDistM, maxCatches: m.grab.maxCatches,
    },
    egg: {
      tierWeights: { ...m.egg.tierWeights }, points: { ...m.egg.points },
      impactLoss: m.egg.lossImpact, impactSpeed: m.egg.impactSpeedMps, impactCooldownS: m.egg.impactCooldownS,
      dropThreshold: m.egg.dropThreshold, pickupS: m.egg.pickupS, depositS: m.egg.depositS,
    },
    clues: { searchS: m.clues.searchS, keepProgressOnCancel: m.clues.keepProgressOnCancel },
    abilities: {
      maxEffectDurationS: m.abilities.maxEffectDurationS, stunDiminishWindowS: m.abilities.stunDiminishWindowS,
      stunDiminishMult: m.abilities.stunDiminishMult, minHydeSpeedMult: m.abilities.minHydeSpeedMult,
      lureBreaksChase: m.abilities.lureBreaksChase, defaultLureLoudness: m.abilities.defaultLureLoudness,
    },
    nav: { cellM: 0.5, lowCoverBlocksMovement: true },
    crackstone: crackstoneFromDesign(m),
  };
}

function crackstoneFromDesign(m: typeof MYSTERY_TUNING): CrackstoneTuning {
  const c = m.crackstone;
  return {
    radius: c.radiusM,
    turnRatePerS: c.turnRateRadPerS,
    speed: { ...c.speedMps },
    patrolPauseS: c.patrolPauseS,
    sight: {
      coneDeg: c.sight.coneDeg, rangeM: c.sight.rangeClearM, fogRangeM: c.sight.rangeFogM, crouchRangeMult: c.sight.crouchRangeMult,
      distractedRangeMult: m.abilities.distractSightMult, instantM: c.sight.instantChaseM, playerSeesHydeM: c.playerSeesCrackstoneM,
    },
    proximityM: c.proximityM,
    suspicion: { ...c.suspicion },
    chaseLossS: c.chaseLossS,
    searchS: c.searchS,
    searchRadiusM: c.searchRadiusM,
    investigateMaxS: c.investigateMaxS,
    waypointReachedM: c.waypointReachedM,
    returnSightMult: c.returnSightMult,
    scanEveryS: c.scanEveryS,
    scanJitterS: c.scanJitterS,
    scanWarnS: c.scanWarnS,
    scanRadiusM: c.scanRadiusM,
    scanPulseShowS: c.scanPulseShowS,
    curseRangeM: c.curseRangeM,
    curseRadiusM: c.curseRadiusM,
    curseWindupS: c.curseWindupS,
    curseCooldownS: c.curseCooldownS,
    curseHp: c.curseHp,
    curseSlowMult: c.curseSlowMult,
    curseSlowS: c.curseSlowS,
    curseInvulnerableS: c.curseInvulnerableS,
    lureRangeM: c.lureRangeM,
    playerSeesCrackstoneM: c.playerSeesCrackstoneM,
    releaseMinDistM: c.releaseMinDistM,
    replanS: 0.4,
    searchSpotsMax: 3,
    scanGraceAfterChaseS: 6,
    lookAroundRadPerS: 1.2,
  };
}

export const DEFAULT_TUNING: SimTuning = tuningFromDesign();

type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] };

/** A copy of the default tuning with overrides (tests). */
export function withTuning(over: DeepPartial<SimTuning>, base: SimTuning = DEFAULT_TUNING): SimTuning {
  const out = structuredClone(base) as unknown as Record<string, unknown>;
  const merge = (dst: Record<string, unknown>, src: Record<string, unknown>) => {
    for (const [k, v] of Object.entries(src)) {
      if (v && typeof v === 'object' && !Array.isArray(v)) merge(dst[k] as Record<string, unknown>, v as Record<string, unknown>);
      else dst[k] = v;
    }
  };
  merge(out, over as Record<string, unknown>);
  return out as unknown as SimTuning;
}
