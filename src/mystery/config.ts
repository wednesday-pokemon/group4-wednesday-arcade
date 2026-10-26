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
    maxChaseS: number; // final (fairness): a chase that has not landed a grab after this long gives up → SEARCH ('gave_up')
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
  /** Final (docs/final/FINAL_CONTRACT.md §4–§6): encounter director, Slurp, hiding cabinets (designer keys + fallbacks). */
  director: DirectorTuning;
  slurp: SlurpTuning;
  cabinet: CabinetTuning;
}

export type EnemyKey = 'hyde' | 'crackstone' | 'slurp';

/** Encounter director (FINAL_CONTRACT §4). */
export interface DirectorTuning {
  /** A spawn is eligible only this far (m, straight line) from the player. */
  minSpawnM: number;
  /** Despawn only this far (m) from the player. */
  despawnM: number;
  /** Despawn only after this many active seconds (unless its cycle is done / its encounter resolved). */
  minActiveS: number;
  /** A spawn used within this many seconds weighs × recentMult. */
  recentSpawnS: number;
  recentMult: number;
  /** Spawn zone contains the active objective's point → weight × objectiveMult. */
  objectiveMult: number;
  /** At most this many hostiles active at once. */
  maxActive: number;
  /** First appearance per enemy (active seconds of play). */
  firstSpawnS: Record<EnemyKey, number>;
  /** After a despawn, at least this long before the same enemy respawns. */
  respawnCooldownS: Record<EnemyKey, number>;
  /** sim: no line of sight to the player for this long before a despawn (contract: 4 s). */
  noLosBeforeDespawnS: number;
  /** sim: never despawn within this long of spawning (contract hysteresis: 10 s). */
  minLifeS: number;
  /** sim: no eligible spawn → retry after this long (contract: 2 s). */
  retryS: number;
  /** sim: the player's forward view cone (half-angle, deg) and its range (m) — no spawn inside it (contract ±60°, 35 m). */
  viewHalfDeg: number;
  viewRangeM: number;
}

/** Slurp — Isaac Night's zombie form (FINAL_CONTRACT §5). `sight` has the SimTuning['sight'] shape (canSee reuse). */
export interface SlurpTuning {
  radius: number;
  turnRatePerS: number;
  speed: { WANDER: number; INVESTIGATE: number; CHASE: number; ATTACK: number; SEARCH: number; LEAVE: number };
  sight: SimTuning['sight'];
  proximityM: number;
  /** He hears only noises at least this loud (sprint, egg drop, cabinet slam). */
  hearMinLoudness: number;
  suspicion: { sightGainPerS: number; chaseAt: number; decayPerS: number };
  chaseLossS: number;
  searchS: number;
  searchRadiusM: number;
  investigateMaxS: number;
  waypointReachedM: number;
  /** Lurching pause at each wander waypoint, seconds [min, max] (seeded). */
  pauseMinS: number;
  pauseMaxS: number;
  /** Wander waypoints visited before his patrol cycle counts as done (the director may then despawn him). */
  cycleWaypoints: number;
  attackRangeM: number;
  attackWindupS: number;
  attackConnectM: number;
  attackLungeMult: number; // sim: lunge speed = CHASE speed × this during the wind-up
  attackHp: number;
  knockbackM: number;
  attackInvulnerableS: number;
  attackCooldownS: number;
  lureRangeM: number;
  playerSeesSlurpM: number;
  leaveS: number; // sim: LEAVE gives up (back to WANDER) after this long without being despawned
  alertMaxS: number; // sim: one alert (INVESTIGATE / SEARCH re-triggered by noises, no chase) lasts at most this long → LEAVE
  replanS: number;
  searchSpotsMax: number;
}

/** Hiding cabinets (FINAL_CONTRACT §6). */
export interface CabinetTuning {
  useM: number;
  enterS: number;
  closeS: number;
  exitS: number;
  exitM: number;
  enterNoise: number;
  /** Entering at a run (sprint) slams the door: this loudness instead of enterNoise. */
  slamNoise: number;
  closeNoise: number;
  openNoise: number;
  creakAfterS: number;
  creakEveryS: number;
  creakNoise: number;
  /** An enemy walking to a remembered cabinet pulls the player out within this distance of the door. */
  pullOutM: number;
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

/** A sub-object of the designer's tuning that may not exist yet. */
function grp(group: unknown, key: string): Record<string, unknown> | undefined {
  const v = group !== null && typeof group === 'object' ? (group as Record<string, unknown>)[key] : undefined;
  return v !== null && typeof v === 'object' ? (v as Record<string, unknown>) : undefined;
}

/** First finite number among candidate key names (the designer's naming may differ), else `fallback`. */
function optAny(group: unknown, keys: readonly string[], fallback: number): number {
  for (const k of keys) {
    const v = opt(group, k, Number.NaN);
    if (Number.isFinite(v)) return v;
  }
  return fallback;
}

function perEnemy(group: unknown, keys: readonly string[], fallback: Record<EnemyKey, number>): Record<EnemyKey, number> {
  let g: Record<string, unknown> | undefined;
  for (const k of keys) g ??= grp(group, k);
  return { hyde: opt(g, 'hyde', fallback.hyde), crackstone: opt(g, 'crackstone', fallback.crackstone), slurp: opt(g, 'slurp', fallback.slurp) };
}

/** Final fallbacks used only while a key is missing from MYSTERY_TUNING (documented defaults, not balance claims). */
export const FINAL_TUNING_FALLBACKS = {
  director: {
    minSpawnM: 20, despawnM: 20, minActiveS: 45, recentSpawnS: 60, recentMult: 0.3, objectiveMult: 1.5, maxActive: 2,
    firstSpawnS: { hyde: 20, crackstone: 35, slurp: 50 }, respawnCooldownS: { hyde: 20, crackstone: 25, slurp: 25 },
  },
  slurp: {
    radiusM: 0.5, turnRateRadPerS: 2.6,
    speedMps: { WANDER: 1.3, INVESTIGATE: 2.4, CHASE: 3.8, ATTACK: 0, SEARCH: 1.8, LEAVE: 2.2 },
    coneDeg: 90, rangeClearM: 10, rangeFogM: 7, crouchRangeMult: 0.7, instantChaseM: 2.5, proximityM: 3, hearMinLoudness: 0.8,
    sightGainPerS: 0.9, chaseAt: 1, decayPerS: 0.2, chaseLossS: 3.5, searchS: 7, searchRadiusM: 6, investigateMaxS: 10,
    waypointReachedM: 1.0, pauseMinS: 0.8, pauseMaxS: 2.2, cycleWaypoints: 4,
    attackRangeM: 1.6, attackWindupS: 0.6, attackConnectM: 2.0, attackHp: 30, knockbackM: 3, attackInvulnerableS: 3,
    attackCooldownS: 6, lureRangeM: 20, playerSeesSlurpM: 18,
  },
  cabinet: {
    useM: 1.6, enterS: 0.5, closeS: 0.4, exitS: 0.6, exitM: 1.2, enterNoise: 0.3, slamNoise: 0.85, closeNoise: 0.2,
    openNoise: 0.25, creakAfterS: 20, creakEveryS: 4, creakNoise: 0.35, pullOutM: 1.6,
  },
} as const;

function directorFromDesign(m: unknown, hydeEmergeAfterS: number): DirectorTuning {
  const F = FINAL_TUNING_FALLBACKS.director;
  const d = grp(m, 'director');
  return {
    minSpawnM: optAny(d, ['minSpawnM', 'minSpawnDistanceM'], F.minSpawnM),
    despawnM: optAny(d, ['despawnM', 'despawnDistanceM'], F.despawnM),
    minActiveS: optAny(d, ['minActiveS'], F.minActiveS),
    recentSpawnS: optAny(d, ['recentSpawnS'], F.recentSpawnS),
    recentMult: optAny(d, ['recentMult', 'recentSpawnMult'], F.recentMult),
    objectiveMult: optAny(d, ['objectiveMult', 'objectiveBoost'], F.objectiveMult),
    maxActive: Math.max(1, Math.floor(optAny(d, ['maxActive', 'maxActiveHostiles'], F.maxActive))),
    firstSpawnS: perEnemy(d, ['firstSpawnS', 'firstAppearS', 'firstSpawnAtS'], { ...F.firstSpawnS, hyde: hydeEmergeAfterS }),
    respawnCooldownS: perEnemy(d, ['respawnCooldownS', 'cooldownS'], F.respawnCooldownS),
    noLosBeforeDespawnS: 4,
    minLifeS: 10,
    retryS: 2,
    viewHalfDeg: 60,
    viewRangeM: 35,
  };
}

function slurpFromDesign(m: unknown, distractSightMult: number): SlurpTuning {
  const F = FINAL_TUNING_FALLBACKS.slurp;
  const s = grp(m, 'slurp');
  const sp = grp(s, 'speedMps') ?? grp(s, 'speed');
  const si = grp(s, 'sight');
  const su = grp(s, 'suspicion');
  const n = (keys: string[], fb: number) => optAny(s, keys, fb);
  return {
    radius: n(['radiusM', 'radius'], F.radiusM),
    turnRatePerS: n(['turnRateRadPerS', 'turnRatePerS'], F.turnRateRadPerS),
    speed: {
      WANDER: opt(sp, 'WANDER', F.speedMps.WANDER), INVESTIGATE: opt(sp, 'INVESTIGATE', F.speedMps.INVESTIGATE),
      CHASE: opt(sp, 'CHASE', F.speedMps.CHASE), ATTACK: opt(sp, 'ATTACK', F.speedMps.ATTACK),
      SEARCH: opt(sp, 'SEARCH', F.speedMps.SEARCH), LEAVE: opt(sp, 'LEAVE', F.speedMps.LEAVE),
    },
    sight: {
      coneDeg: opt(si, 'coneDeg', F.coneDeg), rangeM: optAny(si, ['rangeClearM', 'rangeM'], F.rangeClearM),
      fogRangeM: optAny(si, ['rangeFogM', 'fogRangeM'], F.rangeFogM), crouchRangeMult: opt(si, 'crouchRangeMult', F.crouchRangeMult),
      distractedRangeMult: distractSightMult, instantM: optAny(si, ['instantChaseM', 'instantM'], F.instantChaseM),
      playerSeesHydeM: n(['playerSeesSlurpM'], F.playerSeesSlurpM),
    },
    proximityM: n(['proximityM'], F.proximityM),
    hearMinLoudness: n(['hearMinLoudness', 'hearsLoudnessAtLeast', 'loudNoiseMin'], F.hearMinLoudness),
    suspicion: {
      sightGainPerS: opt(su, 'sightGainPerS', F.sightGainPerS), chaseAt: opt(su, 'chaseAt', F.chaseAt), decayPerS: opt(su, 'decayPerS', F.decayPerS),
    },
    chaseLossS: n(['chaseLossS'], F.chaseLossS),
    searchS: n(['searchS'], F.searchS),
    searchRadiusM: n(['searchRadiusM'], F.searchRadiusM),
    investigateMaxS: n(['investigateMaxS'], F.investigateMaxS),
    waypointReachedM: n(['waypointReachedM'], F.waypointReachedM),
    pauseMinS: n(['pauseMinS', 'lurchPauseMinS'], F.pauseMinS),
    pauseMaxS: n(['pauseMaxS', 'lurchPauseMaxS'], F.pauseMaxS),
    cycleWaypoints: Math.max(1, Math.floor(n(['cycleWaypoints', 'wanderCycle'], F.cycleWaypoints))),
    attackRangeM: n(['attackRangeM'], F.attackRangeM),
    attackWindupS: n(['attackWindupS'], F.attackWindupS),
    attackConnectM: n(['attackConnectM', 'attackConnectRangeM'], F.attackConnectM),
    attackLungeMult: 0.8,
    attackHp: n(['attackHp', 'hitHp'], F.attackHp),
    knockbackM: n(['knockbackM'], F.knockbackM),
    attackInvulnerableS: n(['attackInvulnerableS', 'invulnerableS'], F.attackInvulnerableS),
    attackCooldownS: n(['attackCooldownS'], F.attackCooldownS),
    lureRangeM: n(['lureRangeM'], F.lureRangeM),
    playerSeesSlurpM: n(['playerSeesSlurpM'], F.playerSeesSlurpM),
    leaveS: 20,
    alertMaxS: n(['alertMaxS'], 25),
    replanS: 0.4,
    searchSpotsMax: 3,
  };
}

function cabinetFromDesign(m: unknown): CabinetTuning {
  const F = FINAL_TUNING_FALLBACKS.cabinet;
  const c = grp(m, 'cabinet');
  const n = (keys: string[], fb: number) => optAny(c, keys, fb);
  return {
    useM: n(['useM', 'useRangeM'], F.useM),
    enterS: n(['enterS'], F.enterS),
    closeS: n(['closeS'], F.closeS),
    exitS: n(['exitS'], F.exitS),
    exitM: n(['exitM'], F.exitM),
    enterNoise: n(['enterNoise'], F.enterNoise),
    slamNoise: n(['slamNoise', 'loudEnterNoise'], F.slamNoise),
    closeNoise: n(['closeNoise'], F.closeNoise),
    openNoise: n(['openNoise', 'exitNoise'], F.openNoise),
    creakAfterS: n(['creakAfterS'], F.creakAfterS),
    creakEveryS: n(['creakEveryS', 'creakIntervalS'], F.creakEveryS),
    creakNoise: n(['creakNoise'], F.creakNoise),
    pullOutM: n(['pullOutM'], F.pullOutM),
  };
}

export function tuningFromDesign(m = MYSTERY_TUNING): SimTuning {
  const F = OVERHAUL_TUNING_FALLBACKS;
  const any = m as unknown as Record<string, unknown>;
  // the Hyde's first appearance: director.firstSpawnS.hyde when the designer sets it, else hyde.emergeAfterS (one value:
  // the sim reads tuning.hyde.emergeAfterS, the director's firstSpawnS.hyde mirrors it)
  const firstHyde = perEnemy(grp(any, 'director'), ['firstSpawnS', 'firstAppearS', 'firstSpawnAtS'], { hyde: Number.NaN, crackstone: 0, slurp: 0 }).hyde;
  const emergeAfterS = Number.isFinite(firstHyde) ? firstHyde : opt(m.hyde, 'emergeAfterS', F.emergeAfterS);
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
      emergeAfterS,
      calmAfterChaseS: opt(m.hyde, 'calmAfterChaseS', F.calmAfterChaseS),
      calmHearingMult: opt(m.hyde, 'calmHearingMult', m.hearing.cooldownHearingMult),
      searchSpotsMax: 4,
      maxChaseS: optAny(m.hyde, ['maxChaseS'], 30),
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
    director: directorFromDesign(any, emergeAfterS),
    slurp: slurpFromDesign(any, m.abilities.distractSightMult),
    cabinet: cabinetFromDesign(any),
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
