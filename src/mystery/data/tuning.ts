// Central tuning for "The Silent Evidence" (rules mystery-v3.1). Game-designer owned.
//
// Every number is a PROPOSED DEFAULT for playtesting, not a validated balance claim (plan §7: "All configurable,
// playtest rather than claim final"). Units are in the key names or the trailing comment:
//   M = metres, S = seconds, Mps = metres/second, PerS = units per second, Mult = multiplier (1 = neutral),
//   loudness = 0..1 noise emission, security = 0..100 egg condition, hp = hit points.
// Pure data (shared with Deno Edge Functions): no Math.random, no Date, no DOM.
//
// Overhaul re-tune (2026-10-23, target: a first-timer's visit of 5–7 min incl. ~90–120 s of menus, i.e. ~200–300 s of
// active play; "suspense but fair"). Rationale and pacing math: docs/MYSTERY_DESIGN.md §10.7–§10.8.
//   NEW  hyde.emergeAfterS 20, hyde.calmAfterChaseS 10, hyde.calmHearingMult 0.5, sight.playerSeesHydeM 18,
//        investigation.siteCheckM 5, player.examineS 1.0, player.leverS 1.5, noise.lever 0.5.
//   CHANGED player.hintCooldownS 10 → 8 (three progressive hint levels reach the exact spot in 16 s, not 20 s).
//   CHANGED (caseWorlds.ts) every clue group searchS = 2.5 (the three 3.0 s clues lose 0.5 s; one number to learn).
//   UNCHANGED on purpose: all movement / Hyde speeds, hearing radii, sight, suspicion and grab numbers — the
//        walk < chase < sprint ordering is the core fairness promise and the bot sweep validated it; the new
//        emergence delay + calm window already lower encounter pressure, so slowing the Hyde too would kill suspense.
//
// Enemy contract (2026-10-24, docs/overhaul/ENEMY_CONTRACT.md): NEW section `crackstone` — Joseph Crackstone, the deaf,
// sight-based guardian of one area per case (haunts in caseWorlds.ts). Rationale and escape math: docs/MYSTERY_DESIGN.md
// §11. Changed vs the orchestrator's proposal: scanEveryS 26 → 25, scanJitterS 6 → 4 (interval 21–29 s), scanWarnS
// 2.0 → 2.2, scanRadiusM 11 → 10, curseWindupS 1.3 → 1.4, curseSlowS 3 → 2.5. No existing number changed.
//
// Final (2026-10-24, docs/final/FINAL_CONTRACT.md §1 + §4–§6; rationale docs/MYSTERY_DESIGN.md §12): NEW sections
// `director` (encounter director), `slurp` (Isaac Night's zombie form), `cabinet` (hiding cabinets) and `scoring`
// (mystery-v4 constants mirrored for the game-developer's scoreV4). Key names match src/mystery/config.ts readers.
// No existing number changed: the compact maps shorten every route (~180–230 m instead of 275–389 m), so speeds,
// hearing, sight and the Hyde's 20 s first appearance (= director.firstSpawnS.hyde) stay as validated.
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
    interactRangeM: 1.8, // E reaches a clue / egg / switch / examine / lever within this distance of the player centre
    hintCooldownS: 8, // V (Thing hint) cooldown; overhaul 10 → 8 so hint levels 1→2→3 take 16 s
    eggDropHoldS: 0.8, // hold E this long to set the carried egg down; a tap never drops it (UX ruling 4)
    practiceSearchS: 1.0, // tutorial practice crate at the pier (island.ts PRACTICE_CRATE)
    /** Overhaul: hold E on a suspicious object (× interactTimeMult); short so examining never feels like a chore. */
    examineS: 1.0,
    /** Overhaul: hold E on a passage lever (not scaled by interactTimeMult — a lever is the same for everyone). */
    leverS: 1.5,
  },

  /** Overhaul: candidate-site checks (Bayesian evidence for the egg / clue-area posteriors). */
  investigation: {
    /**
     * A candidate site within this distance of the player with line of sight (walls + high cover) counts as checked.
     * 5 m ≈ a room corner seen from the aisle; detection inside it is certain, so "checked empty" has likelihood 0.
     */
    siteCheckM: 5,
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
    /** Overhaul: a passage lever grinding open ('interact' source) → heard within ~8.5 m (≈ 4 m through one wall). */
    lever: 0.5,
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
    /**
     * Overhaul: the PLAYER sees the Hyde (hydeVisible, lastHydeSighting) with LOS within this range. 18 m > the Hyde's
     * own 13 m, so a watchful player always spots it ~5 m (≈ 2 s of patrol) before it can spot them in the open.
     */
    playerSeesHydeM: 18,
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
    /**
     * Overhaul: the Hyde is absent for this many seconds of active play, then emerges at a seeded spawn
     * (CaseWorldDef.hydeSpawns, renormalised over spawns ≥ minSpawnDistanceM from the player). 20 s ≈ 60 m of walking:
     * enough to read the objective and reach the first building, short enough that the threat arrives early.
     */
    emergeAfterS: 20,
    /**
     * Overhaul fairness window: after a CHASE ends (lost sight → SEARCH, or a grab), hearing × calmHearingMult for this
     * long, so a player who just escaped is not instantly re-acquired by the next footstep (≈ one search + cooldown).
     */
    calmAfterChaseS: 10,
    calmHearingMult: 0.5, // walk heard at 3.5 m instead of 7 m during the calm window
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

  /**
   * Enemy contract (2026-10-24): Joseph Crackstone. DEAF on purpose (no hearing keys — noise is the Hyde's job); he
   * detects by sight, proximity and a telegraphed scan, and is leashed to his case's haunt (CaseWorldDef.crackstone:
   * per-case scanEveryS / sightRangeMult overrides and leashM). Mapped to SimTuning.crackstone in src/mystery/config.ts.
   * Design + escape math: docs/MYSTERY_DESIGN.md §11.
   */
  crackstone: {
    /** Body + turning: a tall, slow walker. Turns slower than the Hyde (4.0) so slipping behind him is a real skill. */
    radiusM: 0.5,
    turnRateRadPerS: 3.0,
    /**
     * Mode speeds (m/s). PATROL 1.5 is deliberate (a 40–90 s lap is easy to read); walk 3.2 < CHASE 3.5 < slowest
     * legal sprint 4.22 (carrying) — the same fairness promise as the Hyde, with a 0.7 m/s escape margin (Hyde 0.22).
     * ATTACK 0: he stands still while the curse winds up.
     */
    speedMps: { PATROL: 1.5, INVESTIGATE: 2.2, CHASE: 3.5, ATTACK: 0, SEARCH: 1.8, RETURN: 1.8 },
    patrolPauseS: 1.2, // look-around pause at every waypoint (he slowly turns: the player's window to cross his path)
    /**
     * His own cone: narrower than the Hyde's (90° vs 100°) but longer (14 m vs 13 m) — he is the "eyes" enemy.
     * Crouching in the open: seen at 14 × 0.6 = 8.4 m (fog 5.4 m). Player sees him at playerSeesCrackstoneM 20 m,
     * so even Case 02's × 1.15 (16.1 m) leaves the first look to a watchful player.
     */
    sight: { coneDeg: 90, rangeClearM: 14, rangeFogM: 9, crouchRangeMult: 0.6, instantChaseM: 2.5 },
    proximityM: 2.5, // senses a non-hidden player this close all around (LOS; crouching does not help) — don't tail him
    /** Seen: + sightGainPerS × (1 + (1 − d / range)) per second → 1.0 s ramp at max range, ~0.5 s point-blank. */
    suspicion: { sightGainPerS: 1.0, chaseAt: 1, decayPerS: 0.2 },
    /** Timers (s) / distances (m): shorter than the Hyde's (4 / 8 / 12) — breaking his sight is rewarded quickly. */
    chaseLossS: 3.5,
    searchS: 7,
    searchRadiusM: 6,
    investigateMaxS: 10,
    waypointReachedM: 1.0,
    returnSightMult: 0.6, // RETURNing: 14 → 8.4 m, so a player who just escaped is not re-acquired at once
    /**
     * Supernatural scan (in PATROL / SEARCH): every 25 ± 4 s (21–29 s; per-case override), a 2.2 s warning (ring +
     * banner + chime; contract minimum 1.8 s), then a pulse that hits a non-hidden player within 10 m WITH LOS
     * (crouching does not help, walls / high cover / hiding do). 2.2 s = ~0.6 s first-timer reaction + 1.6 s of
     * walking (5.1 m): from anywhere in the outer half of the ring a walker gets out; closer in, a wall or hiding spot
     * (rarely > 4 m away in his haunts) is the answer.
     */
    scanEveryS: 25,
    scanJitterS: 4,
    scanWarnS: 2.2,
    scanRadiusM: 10,
    scanPulseShowS: 0.6, // flash duration (render / HUD only)
    /**
     * Curse (ATTACK): cast in CHASE within 7 m with LOS; a 1.8 m circle on the player's spot lands after 1.4 s.
     * Leaving it from the centre: walk 3.2 → 0.56 s, slowest carrying walk 2.45 → 0.73 s (+0.6 s reaction = 1.33 s
     * < 1.4 s); a moving player is out before it lands — it punishes standing still under his gaze. One curse per
     * encounter in practice (cooldown 10 s > chaseLossS + reaction). 15 HP = 3/7 of a Hyde grab; never a catch,
     * never egg damage (rule R7). The 2.5 s slow (× 0.75) is fully covered by curseInvulnerableS 2.5, so no enemy can
     * exploit it (keeps "sprint beats every chase").
     */
    curseRangeM: 7,
    curseRadiusM: 1.8,
    curseWindupS: 1.4,
    curseCooldownS: 10,
    curseHp: 15,
    curseSlowMult: 0.75,
    curseSlowS: 2.5,
    curseInvulnerableS: 2.5,
    lureRangeM: 20, // a decoy this close pulls him too (rule R8); 20 m ≈ the Hyde lure ranges (10–22 m)
    playerSeesCrackstoneM: 20, // HUD / minimap / lastCrackstoneSighting; > his best sight 16.1 m (Case 02)
    releaseMinDistM: 12, // Hyde-grab release prefers safe points ≥ this from him (> his 10 m scan, ≈ his 14 m sight)
  },

  /**
   * Final: the encounter director (FINAL_CONTRACT §4). Eligible spawn = ≥ minSpawnM from the player and not visible
   * to them; weight × objectiveMult when its zone holds the active objective, × recentMult if used in the last
   * recentSpawnS. Staggered first appearances (Hyde 20 s → Crackstone 35 s → Slurp 50 s) introduce one threat at a
   * time in the first minute; maxActive 2 + "one engaged at a time" (sim) keeps escapes predictable.
   * minSpawnM 18 = the player's own sight of the Hyde (sight.playerSeesHydeM): a spawn can never pop in where the
   * player could already see it, and on the 55–70 m maps there is always an eligible point. despawnM 24 > minSpawnM
   * (hysteresis: an enemy that despawns cannot be the one that respawns next to you). minActiveS 35 ≈ one Hyde lap
   * (48 s / 59 s / 39 s per case) minus the walk-in, so every appearance has time to be read and avoided.
   */
  director: {
    minSpawnM: 18,
    despawnM: 24,
    minActiveS: 35,
    recentSpawnS: 60,
    recentMult: 0.3,
    objectiveMult: 1.5,
    maxActive: 2,
    firstSpawnS: { hyde: 20, crackstone: 35, slurp: 50 },
    respawnCooldownS: { hyde: 25, crackstone: 30, slurp: 30 },
  },

  /**
   * Final: Slurp — Isaac Night's zombie form (FINAL_CONTRACT §5). An unpredictable stalker: slow lurching wander with
   * random pauses, short sight (cone 90°, 10 m clear / 7 m fog — shorter than the Hyde's 13 m and Crackstone's 14 m),
   * a 3 m "smell" all round, and ears only for LOUD noises (≥ 0.8: sprint 0.95, egg drop 1.0, cabinet slam 0.85).
   * CHASE 3.8: walk 3.2 < 3.8 < slowest legal sprint while carrying 4.22 — the same fairness promise as the Hyde
   * (4.0) and Crackstone (3.5). The lunge is telegraphed (0.6 s wind-up, connects within 2.0 m): a sprinting player
   * leaves 1.6 m in 0.6 s × 4.22 = 2.5 m of headroom; a stun / lure during the wind-up cancels it.
   * Hit 30 HP (× catchDamageMult; between the curse 15 and the grab 35), knock-back 3 m to a free cell, 3 s safety,
   * then he LEAVEs (walks off, the director despawns him) — a hit is never a death spiral.
   */
  slurp: {
    radiusM: 0.5,
    turnRateRadPerS: 2.6, // slower turning than Crackstone (3.0) and the Hyde (4.0): circling behind him works
    speedMps: { WANDER: 1.4, INVESTIGATE: 2.4, CHASE: 3.8, ATTACK: 0, SEARCH: 1.8, LEAVE: 2.2 },
    sight: { coneDeg: 90, rangeClearM: 10, rangeFogM: 7, crouchRangeMult: 0.7, instantChaseM: 2.5 },
    playerSeesSlurpM: 18, // > his 10 m sight: a watchful player always sees him first
    proximityM: 3, // senses a non-hidden player this close all round (LOS; not through walls, not in a hiding spot)
    hearMinLoudness: 0.8, // only loud noises draw him (INVESTIGATE): sprinting, a dropped egg, a slammed cabinet
    suspicion: { sightGainPerS: 0.9, chaseAt: 1, decayPerS: 0.2 }, // 0.55–1.1 s visible ramp, like the Hyde
    chaseLossS: 3.5,
    searchS: 7,
    searchRadiusM: 6,
    investigateMaxS: 10,
    waypointReachedM: 1.0,
    pauseMinS: 0.8, // lurching pause at each wander waypoint, seeded in [pauseMinS, pauseMaxS] ("wanderPauseS")
    pauseMaxS: 2.4,
    cycleWaypoints: 4, // after 4 wander waypoints his cycle is done → the director may despawn him (≈ 60–80 s)
    attackRangeM: 1.6,
    attackWindupS: 0.6,
    attackConnectM: 2.0,
    attackHp: 30, // "hitHp"
    knockbackM: 3,
    attackInvulnerableS: 3, // "invulnerableS"
    attackCooldownS: 6,
    lureRangeM: 20, // a visible / audible decoy this close pulls him, like Crackstone (R8)
  },

  /**
   * Final: hiding cabinets (FINAL_CONTRACT §6; 4–8 per case in caseWorlds.ts, radius 0.6, revealM 1.2).
   * Noise → hearing radius (hearingRadiusM): enter 0.3 → 6 m, close 0.2 → 4 m, open 0.25 → 5 m, creak 0.4 → 7.5 m,
   * slam 0.85 → 12 m. A calm entry is heard only by a Hyde already within ~6 m; running in (slam) is heard across a
   * room and by Slurp (≥ 0.8). After 20 s inside the door creaks every 5 s (0.4) — no permanent invulnerability, but
   * long enough to wait out one Hyde search (8 s) + cooldown (5 s) or a Crackstone search (7 s).
   */
  cabinet: {
    useM: 1.6,
    enterS: 0.5,
    closeS: 0.4,
    exitS: 0.6,
    exitM: 1.2,
    enterNoise: 0.3,
    slamNoise: 0.85, // entering at a sprint
    closeNoise: 0.2,
    openNoise: 0.25,
    creakAfterS: 20,
    creakEveryS: 5,
    creakNoise: 0.4,
    pullOutM: 1.6, // an enemy that witnessed the entry pulls the player out from this close to the door
  },

  /**
   * Final scoring constants (mystery-v4, FINAL_CONTRACT §1) — mirrored here for one source of numbers; the shared
   * `scoreV4()` (game-developer) is the authority. total = max(0, delivery + accusation (correct) + perClue × min(clues,
   * maxClues) + noDetection (0 detections) + noHints (0 hints) + max(0, timeBonusMax − floor(activeTimeS))
   * − hintPenalty × hints − hitPenalty × hits). Best case 2200; a typical clean 150 s run ≈ 2050.
   */
  scoring: {
    delivery: 1000,
    accusation: 300,
    perClue: 100,
    maxClues: 3,
    noDetection: 150,
    noHints: 150,
    timeBonusMax: 300,
    hintPenalty: 50,
    hitPenalty: 75,
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
