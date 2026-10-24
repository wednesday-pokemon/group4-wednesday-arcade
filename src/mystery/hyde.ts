// The Hyde: a visible pursuer on the nav grid. Modes PATROL → INVESTIGATE_SOUND → SEARCH → CHASE → COOLDOWN.
// Mode changes happen ONLY through perception (hearing: distance + loudness + wall occlusion → suspicion; sight: cone +
// range + walls + fog + crouch + hiding → suspicion ramp), timers (chase loss, investigate give-up, search, cooldown) or
// player effects (stun, lure) and grabs — every change emits a `hyde_mode` event with its reason. No hidden catch rolls:
// a catch needs physical reach plus a short grab windup (the Hyde lunges at windupSpeedMult × chase speed) that a stun
// interrupts and a sprint can outrun (walking cannot).
//
// Flow (MYSTERY_TUNING): heard noise adds heardGainPerLoudness × loudness to suspicion; once suspicion ≥ investigateAt
// (or a noise ≥ investigateLoudnessAlways) it investigates the noise. Seen: suspicion += sightGainPerS × (2 − d/range)
// per second; ≥ chaseAt (or within instantM) → CHASE. Lost sight for chaseLossS → SEARCH (searchS around the last known
// point) → COOLDOWN (cooldownS, reduced hearing, walks back to its loop) → PATROL. A landed grab → COOLDOWN
// (cooldownAfterGrabS). Unreachable investigations give up after investigateMaxS (→ SEARCH, reason gave_up).
//
// Overhaul (docs/overhaul/OVERHAUL_CONTRACT.md "Sim rules" 6–7):
// - Emergence: on case maps the Hyde is ABSENT (`active` false: no sight, no hearing, no movement) until the run calls
//   `emerge()` at a drawn spawn (layout.ts drawHydeSpawn); maps without spawns keep the legacy `start()` at t = 0.
// - SEARCH sweeps plausible spots around the search centre (≤ searchWanderRadiusM): it plans up to searchSpotsMax spots —
//   each hiding spot (it stands on the near side at hidingSafeM = revealM + radius + SEARCH_ARRIVE_M + 0.4 m from the
//   spot's centre and stares at it: even stopping SEARCH_ARRIVE_M short, with the player anywhere inside the spot, it
//   stays beyond revealM, so a properly hidden player is NOT dragged out by the sweep itself) and the hiding place behind
//   each cover piece (seen from the centre), which it checks from the SIDE (a flank point 2.5 m off, with a clear
//   crouch-height line to it — a crouching, not hidden, player there is found) — visits them nearest-first, pausing and
//   looking at each, then wanders randomly near the centre (never within hidingSafeM of a hiding spot) until searchS
//   runs out. Stand points closer than hidingSafeM to any hiding spot are dropped.
// - Calm window (contract rule 7 "after a chase ends"): whenever the Hyde leaves CHASE (lost sight → SEARCH, stun, lure,
//   grab → COOLDOWN) it hears worse (× calmHearingMult) for calmAfterChaseS, so a player who just escaped is not
//   re-acquired by the next footstep and encounters are not back-to-back. COOLDOWN's own reduced hearing still applies
//   (the stronger reduction wins). Sight is unchanged. After COOLDOWN it walks back to the nearest patrol waypoint.
//
// Movement (nav travel + stuck guard) and the SEARCH spot planning live in enemyNav.ts, shared with Joseph Crackstone.
//
// Final (docs/final/FINAL_CONTRACT.md §4, §6):
// - Director lifecycle: spawn() (= emerge with every per-encounter timer reset) / despawn() (inactive, its stun / slow /
//   distract timers dropped; nothing on the player changes). Directed-enemy queries engaged / calm / cycleDone /
//   encounterResolved feed the director's despawn rule. The Hyde keeps priority over the other hunters (it never defers).
// - `enemy_detected {hyde}` whenever it starts a CHASE (via 'sight', or 'proximity' when the player bumped into it).
// - Cabinets: a player inside a CLOSED cabinet is invisible to it (enemyNav playerRevealAt), an OPEN one hides like a crouch
//   spot; a grab never lands on a player inside (open / closed). witnesses() = it could see the player right now (used
//   when they enter / close a cabinet); goToCabinet() makes it walk (INVESTIGATE_SOUND) to that cabinet's door and pull
//   the player out on arrival (ctx.pullOut, a catch). A stun / lure / distract makes it forget the cabinet.
import type { SimContext } from './context.ts';
import {
  cabinetFound, inCabinetNow, NavTraveller, pickSearchPoint, planSearchSpots, playerRevealAt, SEARCH_ARRIVE_M, type SearchSpot,
} from './enemyNav.ts';
import { dist, turnToward, wrapAngle, yawTo } from './geometry.ts';
import { hear } from './noise.ts';
import { canSee } from './sight.ts';
import type { GameEvent, HydeMode, HydeRuntime, MapDef, NoiseSource, Vec2 } from './types.ts';

/** A remembered cabinet (witnessed entry / heard creak): walk to its door, pull the player out if still inside. */
export interface CabinetMemory { spotId: string; door: Vec2 }

export { hidingRevealAt, hidingSafeM } from './enemyNav.ts';

export type ModeReason = Extract<GameEvent, { type: 'hyde_mode' }>['reason'];

export function createHydeRuntime(map: MapDef): HydeRuntime {
  return {
    mode: 'PATROL', modeT: 0, x: map.hydeStart.x, z: map.hydeStart.z, yaw: map.hydeStart.yaw, speed: 0,
    suspicion: 0, canSeePlayer: false, lastKnown: null, target: null, path: [],
    stunnedUntil: -Infinity, slowedUntil: -Infinity, slowMult: 1, distractedUntil: -Infinity, grabbing: false,
  };
}

/** Spawn point: hydeStart unless it is within minSpawnM of the player, else the first patrol waypoint far enough. */
export function chooseSpawn(map: MapDef, player: Vec2, minSpawnM: number): { x: number; z: number; yaw: number } {
  if (dist(map.hydeStart, player) >= minSpawnM) return { ...map.hydeStart };
  for (const p of map.patrol) if (dist(p, player) >= minSpawnM) return { x: p.x, z: p.z, yaw: map.hydeStart.yaw };
  const far = map.patrol.reduce((a, b) => (dist(b, player) > dist(a, player) ? b : a), map.patrol[0] ?? map.hydeStart);
  return { x: far.x, z: far.z, yaw: map.hydeStart.yaw };
}

export class HydeBrain {
  readonly h: HydeRuntime;
  patrolIndex = 0;
  active = false;
  lastSeenT = -Infinity;
  windupUntil = -Infinity;
  grabHoldUntil = -Infinity;
  cooldownUntil = -Infinity;
  lureUntil = -Infinity;
  lastStunEnd = -Infinity;
  searchCenter: Vec2 | null = null;
  searchUntil = -Infinity;
  investigateSince = 0;
  /** Counters for analytics / tests. */
  readonly stats = { heard: 0, sightings: 0, chases: 0, grabs: 0 };
  private preLureKnown: Vec2 | null = null;
  private searchPauseUntil = -Infinity;
  private readonly mover = new NavTraveller();
  private glimpsed = false;
  private sweepDir = 1;
  /** Planned SEARCH spots (nearest-first) and the one being looked at. */
  private searchSpots: SearchSpot[] = [];
  private searchLook: Vec2 | null = null;
  /** Reduced hearing until this time (calm window after a chase). */
  calmUntil = -Infinity;
  /** Final: no chase may start before this (after a chase hit maxChaseS). */
  private noChaseUntil = -Infinity;
  /** Final: the cabinet it is walking to (null = none). */
  cabinetGoal: CabinetMemory | null = null;
  /** Patrol waypoints reached since the last spawn (cycle done = a full loop). */
  private loopSteps = 0;
  /** It hunted the player (chase or grab) since the last spawn. */
  private hunted = false;
  /** How the current chase started (enemy_detected via). */
  private seenVia: 'sight' | 'proximity' = 'sight';

  constructor(h: HydeRuntime) {
    this.h = h;
  }

  /** Legacy start (maps without hydeSpawns): place the Hyde ≥ minSpawnM from the player and start patrolling. */
  start(ctx: SimContext): void {
    this.emerge(ctx, chooseSpawn(ctx.map, ctx.player, ctx.tuning.hyde.minSpawnM));
  }

  /** Puts the Hyde at `s` (snapped to its nav grid) and starts patrolling from the nearest waypoint. Returns the spot. */
  emerge(ctx: SimContext, s: { x: number; z: number; yaw: number }): Vec2 {
    const snapped = ctx.hydeNav().nearestWalkable(s, 6) ?? { x: s.x, z: s.z };
    Object.assign(this.h, {
      x: snapped.x, z: snapped.z, yaw: s.yaw, mode: 'PATROL' as HydeMode, modeT: 0, path: [], target: null, speed: 0,
    });
    this.patrolMap = ctx.map;
    this.patrolIndex = this.nearestPatrolIndex();
    const pts = ctx.map.patrol;
    if (pts.length > 1 && dist(pts[this.patrolIndex], this.h) < 1) this.patrolIndex = (this.patrolIndex + 1) % pts.length;
    this.mover.planGoal = null;
    this.active = true;
    return { x: snapped.x, z: snapped.z };
  }

  /**
   * Director spawn: a fresh encounter at `s` (mode PATROL, suspicion 0, no memory, no pending grab / lure / search, its
   * own effect timers cleared), then emerge (snap + patrol from the nearest waypoint).
   */
  spawn(ctx: SimContext, s: { x: number; z: number; yaw: number }): Vec2 {
    this.resetEncounter();
    return this.emerge(ctx, s);
  }

  /** Director despawn: inactive (no sight, hearing or movement); its stun / slow / distract timers are dropped. */
  despawn(_ctx: SimContext): void {
    this.resetEncounter();
    this.active = false;
  }

  private resetEncounter(): void {
    const h = this.h;
    Object.assign(h, {
      mode: 'PATROL' as HydeMode, modeT: 0, speed: 0, suspicion: 0, canSeePlayer: false, lastKnown: null, target: null, path: [],
      stunnedUntil: -Infinity, slowedUntil: -Infinity, slowMult: 1, distractedUntil: -Infinity, grabbing: false,
    });
    this.lastSeenT = -Infinity;
    this.windupUntil = -Infinity;
    this.grabHoldUntil = -Infinity;
    this.cooldownUntil = -Infinity;
    this.lureUntil = -Infinity;
    this.searchCenter = null;
    this.searchUntil = -Infinity;
    this.searchPauseUntil = -Infinity;
    this.searchSpots = [];
    this.searchLook = null;
    this.preLureKnown = null;
    this.glimpsed = false;
    this.calmUntil = -Infinity;
    this.noChaseUntil = -Infinity;
    this.cabinetGoal = null;
    this.loopSteps = 0;
    this.hunted = false;
    this.mover.planGoal = null;
  }

  // ------------------------------------------------------------------------------------------------- director queries

  /** CHASE (incl. the grab wind-up). */
  engaged(): boolean {
    return this.active && this.h.mode === 'CHASE';
  }

  /** Patrolling or cooling down (not hunting / investigating the player), no grab being held. */
  calm(t: number): boolean {
    return this.active && (this.h.mode === 'PATROL' || this.h.mode === 'COOLDOWN') && t >= this.grabHoldUntil && !this.cabinetGoal;
  }

  /** One full patrol loop since the spawn. */
  cycleDone(ctx: SimContext): boolean {
    return this.loopSteps >= Math.max(1, ctx.map.patrol.length);
  }

  /** It hunted the player since the spawn and has calmed down again. */
  encounterResolved(t: number): boolean {
    return this.hunted && this.calm(t);
  }

  /**
   * Could it see the player right now? Used when the player enters (revealM null: they are still outside) or closes a
   * cabinet (revealM = the cabinet's: they sit behind an open door).
   */
  witnesses(ctx: SimContext, revealM: number | null = null): boolean {
    if (!this.perceives(ctx) || this.isDistracted(ctx.t)) return false;
    const p = ctx.player;
    const h = this.h;
    if (revealM === null && h.mode === 'CHASE' && h.canSeePlayer) return true;
    const res = canSee(ctx.world, ctx.tuning.sight, h, { x: p.x, z: p.z, crouched: false, hiddenRevealM: revealM }, {
      fog: ctx.inFog(h.x, h.z) || ctx.inFog(p.x, p.z), distracted: false,
    });
    return res.seen;
  }

  /** Walk to a remembered cabinet's door (INVESTIGATE_SOUND); pull the player out on arrival if still inside. */
  goToCabinet(ctx: SimContext, mem: CabinetMemory): void {
    if (!this.active) return;
    const h = this.h;
    this.windupUntil = -Infinity;
    h.grabbing = false;
    h.lastKnown = { ...mem.door };
    if (h.mode === 'INVESTIGATE_SOUND') {
      h.path = [];
      this.mover.planGoal = null;
      this.investigateSince = ctx.t;
    } else this.setMode(ctx, 'INVESTIGATE_SOUND', h.canSeePlayer ? 'saw_player' : 'heard_noise');
    this.cabinetGoal = { spotId: mem.spotId, door: { ...mem.door } };
    h.target = { ...mem.door };
  }

  /**
   * Drops the current nav plan so the next travel() replans from scratch (call whenever walls open or close: the old
   * "empty path + same goal + planned < 0.5 s ago" shortcut would otherwise read as "arrived").
   */
  invalidatePath(): void {
    this.mover.invalidate(this.h);
  }

  /** In the calm window after a chase (reduced hearing)? */
  isCalm(t: number): boolean {
    return t < this.calmUntil;
  }

  /** Hearing multiplier right now: COOLDOWN and the calm window both hear worse (the stronger reduction applies). */
  hearingMult(ctx: SimContext): number {
    let m = 1;
    if (this.h.mode === 'COOLDOWN') m = Math.min(m, ctx.tuning.noise.cooldownHearingMult);
    if (this.isCalm(ctx.t)) m = Math.min(m, ctx.tuning.hyde.calmHearingMult);
    return m;
  }

  private patrolMap: MapDef | null = null;

  private nearestPatrolIndex(): number {
    const pts = this.patrolMap?.patrol ?? [];
    let best = 0;
    let bestD = Infinity;
    for (let i = 0; i < pts.length; i++) {
      const d = dist(pts[i], this.h);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    return best;
  }

  isStunned(t: number): boolean {
    return t < this.h.stunnedUntil;
  }

  isLured(t: number): boolean {
    return t < this.lureUntil;
  }

  isDistracted(t: number): boolean {
    return t < this.h.distractedUntil;
  }

  isWindingUp(): boolean {
    return this.windupUntil > -Infinity;
  }

  /** Perception of the player is off while stunned, lured, holding a grab, or while the player is invulnerable. */
  perceives(ctx: SimContext): boolean {
    const t = ctx.t;
    return this.active && !this.isStunned(t) && !this.isLured(t) && t >= this.grabHoldUntil && t >= ctx.player.invulnerableUntil;
  }

  setMode(ctx: SimContext, to: HydeMode, reason: ModeReason): void {
    const from = this.h.mode;
    if (from === to) return;
    this.h.mode = to;
    this.h.modeT = 0;
    this.h.path = [];
    this.mover.planGoal = null;
    this.glimpsed = false;
    if (to === 'CHASE') {
      this.stats.chases++;
      this.calmUntil = -Infinity;
      this.hunted = true;
    } else if (from === 'CHASE') this.calmUntil = ctx.t + ctx.tuning.hyde.calmAfterChaseS;
    if (to === 'INVESTIGATE_SOUND') this.investigateSince = ctx.t;
    this.cabinetGoal = null;
    ctx.emit({ type: 'hyde_mode', from, to, reason });
    if (to === 'CHASE') ctx.emit({ type: 'enemy_detected', enemy: 'hyde', via: this.seenVia });
  }

  private startSearch(ctx: SimContext, center: Vec2, reason: ModeReason, startAt = ctx.t): void {
    this.searchCenter = { x: center.x, z: center.z };
    this.searchUntil = startAt + ctx.tuning.hyde.searchS;
    this.searchPauseUntil = startAt + 0.6;
    this.h.target = null;
    this.h.path = [];
    this.mover.planGoal = null;
    this.setMode(ctx, 'SEARCH', reason);
    this.searchSpots = this.planSearchSpots(ctx, this.searchCenter);
    this.searchLook = null;
  }

  private startCooldown(ctx: SimContext, seconds: number, reason: ModeReason): void {
    this.cooldownUntil = ctx.t + seconds;
    this.patrolIndex = this.nearestPatrolIndex();
    this.setMode(ctx, 'COOLDOWN', reason);
  }

  // ------------------------------------------------------------------------------------------------- effects

  /** Freeze for `durationS` (already scaled / capped / diminished by the caller); interrupts a grab windup. */
  stun(ctx: SimContext, durationS: number): void {
    const h = this.h;
    h.stunnedUntil = Math.max(h.stunnedUntil, ctx.t + durationS);
    this.lastStunEnd = h.stunnedUntil;
    h.grabbing = false;
    this.windupUntil = -Infinity;
    h.speed = 0;
    this.cabinetGoal = null;
    if (h.canSeePlayer) ctx.emit({ type: 'hyde_lost' });
    h.canSeePlayer = false;
    if (this.isLured(ctx.t)) return; // a decoy is pending (e.g. Shadow Ball = lure + stun): freeze, then go to it
    h.lastKnown = { x: ctx.player.x, z: ctx.player.z };
    // afterwards it searches where the hit came from
    this.startSearch(ctx, h.lastKnown, 'stunned', h.stunnedUntil);
    this.searchCenter = { ...h.lastKnown };
    this.searchUntil = h.stunnedUntil + ctx.tuning.hyde.searchS;
    this.searchPauseUntil = h.stunnedUntil + 0.6;
  }

  slow(ctx: SimContext, durationS: number, mult: number): void {
    this.h.slowedUntil = Math.max(this.h.slowedUntil, ctx.t + durationS);
    this.h.slowMult = Math.max(ctx.tuning.abilities.minHydeSpeedMult, Math.min(1, mult));
  }

  distract(ctx: SimContext, durationS: number): void {
    this.h.distractedUntil = Math.max(this.h.distractedUntil, ctx.t + durationS);
    this.h.grabbing = false;
    this.windupUntil = -Infinity;
    this.cabinetGoal = null;
  }

  /** Pull the Hyde to a decoy for `durationS`; it ignores the player meanwhile. Returns false if it refuses. */
  lure(ctx: SimContext, point: Vec2, durationS: number): boolean {
    const h = this.h;
    if (h.mode === 'CHASE' && !ctx.tuning.abilities.lureBreaksChase) return false;
    this.preLureKnown = h.mode === 'CHASE' || h.mode === 'INVESTIGATE_SOUND' || h.mode === 'SEARCH' ? (h.lastKnown ? { ...h.lastKnown } : null) : null;
    this.lureUntil = ctx.t + durationS;
    h.grabbing = false;
    this.windupUntil = -Infinity;
    this.cabinetGoal = null;
    if (h.canSeePlayer) ctx.emit({ type: 'hyde_lost' });
    h.canSeePlayer = false;
    if (h.mode === 'INVESTIGATE_SOUND') {
      h.path = [];
      this.mover.planGoal = null;
      this.investigateSince = ctx.t;
    } else this.setMode(ctx, 'INVESTIGATE_SOUND', 'lured');
    h.target = { x: point.x, z: point.z };
    return true;
  }

  // ------------------------------------------------------------------------------------------------- hearing

  /** Returns whether it heard the noise. */
  hearNoise(ctx: SimContext, source: NoiseSource, x: number, z: number, loudness: number): boolean {
    if (!this.perceives(ctx) || this.isDistracted(ctx.t)) return false;
    const h = this.h;
    const T = ctx.tuning;
    const res = hear(ctx.world, T.noise, loudness, x, z, h.x, h.z, this.hearingMult(ctx));
    if (!res.heard) return false;
    this.stats.heard++;
    ctx.emit({ type: 'hyde_heard', source, loudness: round3(loudness), distanceM: round2(res.distanceM), occluded: res.occluded });
    h.suspicion = Math.min(1, h.suspicion + T.suspicion.heardGainPerLoudness * loudness);
    if (this.cabinetGoal) return true; // already walking to the player's cabinet
    h.lastKnown = { x, z };
    if (h.mode === 'CHASE') return true; // the chase keeps going; the noise refreshes the last known point
    if (h.mode === 'INVESTIGATE_SOUND') {
      h.target = { x, z };
      this.investigateSince = ctx.t;
      return true;
    }
    if (h.suspicion >= T.suspicion.investigateAt || loudness >= T.suspicion.investigateLoudnessAlways) {
      this.setMode(ctx, 'INVESTIGATE_SOUND', 'heard_noise');
      h.target = { x, z };
    }
    return true;
  }

  // ------------------------------------------------------------------------------------------------- step

  /** One fixed step. `onCatch` is called when a grab lands (the run applies HP / egg / release / DNF). */
  step(ctx: SimContext, dt: number, onCatch: () => void): void {
    const h = this.h;
    const t = ctx.t;
    const T = ctx.tuning;
    h.modeT += dt;
    if (!this.active) {
      h.speed = 0;
      return;
    }
    if (this.grabHoldUntil > -Infinity && t >= this.grabHoldUntil) {
      this.grabHoldUntil = -Infinity;
      h.grabbing = false;
    }
    if (this.isStunned(t)) {
      h.speed = 0;
      return;
    }
    // lure expiry: back to where the player was last known (if it knew)
    if (this.lureUntil > -Infinity && t >= this.lureUntil) {
      this.lureUntil = -Infinity;
      if (this.preLureKnown) this.startSearch(ctx, this.preLureKnown, 'lost_sight');
      this.preLureKnown = null;
    }
    const p = ctx.player;
    const dPlayer = Math.hypot(p.x - h.x, p.z - h.z);

    // ---- sight
    let seen = false;
    if (this.perceives(ctx)) {
      const spot = playerRevealAt(ctx);
      const res = canSee(ctx.world, T.sight, h, { x: p.x, z: p.z, crouched: p.crouched, hiddenRevealM: spot }, {
        fog: ctx.inFog(h.x, h.z) || ctx.inFog(p.x, p.z), distracted: this.isDistracted(t),
      });
      seen = res.seen;
      this.seenVia = 'sight';
      // bumping into the Hyde gives the player away (unless hidden in a spot or the Hyde is distracted)
      if (!seen && !p.hidden && !this.isDistracted(t) && dPlayer <= T.hyde.radius + T.player.radius + 0.15) {
        seen = true;
        this.seenVia = 'proximity';
      }
      if (seen) {
        if (!h.canSeePlayer) {
          this.stats.sightings++;
          ctx.emit({ type: 'hyde_sighted', distanceM: round2(dPlayer) });
        }
        const closeness = 1 + Math.max(0, 1 - res.distanceM / Math.max(1e-6, res.rangeM));
        h.suspicion = Math.min(1, h.suspicion + T.suspicion.sightGainPerS * closeness * dt);
        h.lastKnown = { x: p.x, z: p.z };
        this.lastSeenT = t;
        if (h.mode !== 'CHASE' && t >= this.noChaseUntil && (h.suspicion >= T.suspicion.chaseAt || dPlayer <= T.sight.instantM)) {
          h.suspicion = 1;
          this.setMode(ctx, 'CHASE', 'saw_player');
        } else if (h.mode !== 'CHASE') this.glimpsed = true;
      }
    }
    if (h.canSeePlayer && !seen) ctx.emit({ type: 'hyde_lost' });
    h.canSeePlayer = seen;
    if (h.mode === 'CHASE') h.suspicion = 1;
    else if (!seen) h.suspicion = Math.max(0, h.suspicion - T.suspicion.decayPerS * dt);

    // a glimpse that ended before the chase threshold: go and look where the player was
    if (!seen && this.glimpsed && h.mode !== 'CHASE' && h.lastKnown && this.perceives(ctx)) {
      this.glimpsed = false;
      if (h.mode === 'INVESTIGATE_SOUND') {
        h.target = { ...h.lastKnown };
        this.investigateSince = t;
      } else {
        this.setMode(ctx, 'INVESTIGATE_SOUND', 'saw_player');
        h.target = { ...h.lastKnown };
      }
    }

    // ---- a player found in a cabinet (seen through the open door, or the cabinet it remembers): yanked out = a grab
    const found = this.perceives(ctx) ? cabinetFound(ctx, h, this.cabinetGoal, seen) : null;
    if (found) {
      this.cabinetGoal = null;
      this.windupUntil = -Infinity;
      this.stats.grabs++;
      h.grabbing = true;
      h.speed = 0;
      this.grabHoldUntil = t + T.hyde.grabHoldS;
      h.lastKnown = null;
      this.hunted = true;
      this.startCooldown(ctx, T.hyde.cooldownAfterGrabS, 'grabbed');
      ctx.pullOut?.('hyde', found);
      return;
    }

    // ---- grab windup (the Hyde keeps lunging after the player while winding up)
    const invulnerable = t < p.invulnerableUntil;
    if (this.windupUntil > -Infinity) {
      if (t >= this.windupUntil) {
        this.windupUntil = -Infinity;
        h.grabbing = false;
        const d = Math.hypot(p.x - h.x, p.z - h.z);
        if (d <= T.grab.connectRangeM && !invulnerable && !this.isDistracted(t) && !this.isLured(t) && !inCabinetNow(p)) {
          this.stats.grabs++;
          h.grabbing = true;
          h.speed = 0;
          this.grabHoldUntil = t + T.hyde.grabHoldS;
          h.lastKnown = null;
          this.hunted = true;
          this.startCooldown(ctx, T.hyde.cooldownAfterGrabS, 'grabbed');
          onCatch();
          return;
        }
      }
    } else if (h.mode === 'CHASE' && dPlayer <= T.grab.rangeM && !invulnerable && !this.isDistracted(t) && !this.isLured(t)) {
      this.windupUntil = t + T.grab.windupS;
      h.grabbing = true;
    }

    // ---- mode logic + movement
    const slow = t < h.slowedUntil ? h.slowMult : 1;
    const lunge = this.windupUntil > -Infinity ? T.hyde.windupSpeedMult : 1;
    const speed = T.hyde.speed[h.mode] * slow * lunge;
    switch (h.mode) {
      case 'PATROL': {
        if (this.glimpsed && seen) return this.faceAndHold(ctx, p, dt);
        this.followLoop(ctx, speed, dt);
        return;
      }
      case 'INVESTIGATE_SOUND': {
        if (this.glimpsed && seen) return this.faceAndHold(ctx, p, dt);
        const goal = h.target ?? h.lastKnown;
        if (!goal) {
          this.startSearch(ctx, h, 'reached_target');
          return;
        }
        if (t - this.investigateSince >= T.hyde.investigateMaxS && !this.isLured(t)) {
          this.startSearch(ctx, goal, 'gave_up'); // could not get there in time (unreachable / blocked)
          return;
        }
        const cab = this.cabinetGoal;
        if (cab && Math.hypot(cab.door.x - h.x, cab.door.z - h.z) <= ctx.tuning.cabinet.pullOutM) {
          // at the remembered cabinet, but the player is no longer inside: look around here
          this.cabinetGoal = null;
          this.startSearch(ctx, goal, 'reached_target');
          return;
        }
        if (this.travel(ctx, goal, speed, dt, 1.0)) {
          if (this.isLured(t)) {
            // waits at the decoy, looking around
            h.speed = 0;
            h.yaw = wrapAngle(h.yaw + this.sweepDir * 1.6 * dt);
          } else this.startSearch(ctx, goal, 'reached_target');
        }
        return;
      }
      case 'SEARCH': {
        if (this.glimpsed && seen) return this.faceAndHold(ctx, p, dt);
        if (t >= this.searchUntil) {
          this.startCooldown(ctx, T.hyde.cooldownS, 'search_timeout');
          return;
        }
        if (t < this.searchPauseUntil) {
          h.speed = 0;
          const look = this.searchLook;
          if (look && Math.abs(wrapAngle(yawTo(h.x, h.z, look.x, look.z) - h.yaw)) > 0.05) {
            h.yaw = turnToward(h.yaw, yawTo(h.x, h.z, look.x, look.z), T.hyde.turnRatePerS * dt); // stare at the spot
          } else {
            this.searchLook = null;
            h.yaw = wrapAngle(h.yaw + this.sweepDir * 1.6 * dt);
          }
          return;
        }
        if (!h.target) {
          const next = this.searchSpots.shift();
          h.target = next ? next.at : this.pickSearchPoint(ctx);
          this.searchLook = next ? next.look : null;
        }
        if (this.travel(ctx, h.target, speed, dt, SEARCH_ARRIVE_M)) {
          h.target = null;
          this.sweepDir = ctx.rng.chance(0.5) ? 1 : -1;
          this.searchPauseUntil = t + ctx.rng.range(0.8, 1.6);
        }
        return;
      }
      case 'CHASE': {
        if (h.modeT >= T.hyde.maxChaseS && this.windupUntil === -Infinity) {
          // fairness: an endless chase ends — it searches where it last saw the player, and cannot restart a chase for a
          // few seconds (sightings meanwhile are glimpses)
          this.startSearch(ctx, h.lastKnown ?? { x: h.x, z: h.z }, 'gave_up');
          h.suspicion = 0;
          this.noChaseUntil = t + 5;
          return;
        }
        const lostFor = t - this.lastSeenT;
        if (!seen && this.windupUntil === -Infinity && (lostFor >= T.hyde.chaseLossS || this.isDistracted(t) || invulnerable)) {
          this.startSearch(ctx, h.lastKnown ?? { x: h.x, z: h.z }, 'lost_sight');
          return;
        }
        const goal = seen || this.windupUntil > -Infinity ? { x: p.x, z: p.z } : (h.lastKnown ?? { x: p.x, z: p.z });
        h.target = goal;
        if (this.travel(ctx, goal, speed, dt, seen ? 0.3 : 0.8, seen)) h.speed = 0;
        return;
      }
      case 'COOLDOWN': {
        if (t >= this.cooldownUntil) {
          this.patrolIndex = this.nearestPatrolIndex();
          this.setMode(ctx, 'PATROL', 'cooldown_done');
          return;
        }
        if (t < this.grabHoldUntil) {
          h.speed = 0;
          return;
        }
        this.followLoop(ctx, speed, dt);
        return;
      }
    }
  }

  private followLoop(ctx: SimContext, speed: number, dt: number): void {
    const pts = ctx.map.patrol;
    if (pts.length === 0) {
      this.h.speed = 0;
      return;
    }
    const wp = pts[this.patrolIndex % pts.length];
    this.h.target = { x: wp.x, z: wp.z };
    if (this.travel(ctx, wp, speed, dt, ctx.tuning.hyde.waypointReachedM)) {
      this.patrolIndex = (this.patrolIndex + 1) % pts.length;
      this.mover.planGoal = null;
      this.loopSteps++;
    }
  }

  private faceAndHold(ctx: SimContext, p: Vec2, dt: number): void {
    this.h.speed = 0;
    this.h.yaw = turnToward(this.h.yaw, yawTo(this.h.x, this.h.z, p.x, p.z), ctx.tuning.hyde.turnRatePerS * dt);
  }

  /**
   * Plausible spots around `center` a hiding player would use: near-side stand points of hiding spots (hidingSafeM out,
   * so the sweep itself never reveals a properly hidden player) and flank points looking at the hiding place behind each
   * cover piece (as seen from the centre). Snapped to the Hyde's component, never within hidingSafeM of any hiding spot,
   * deduplicated (2 m), nearest-first greedy order, at most searchSpotsMax.
   */
  planSearchSpots(ctx: SimContext, center: Vec2): SearchSpot[] {
    return planSearchSpots(ctx, ctx.hydeNav(), this.h, center, ctx.tuning.hyde.searchRadiusM, ctx.tuning.hyde.searchSpotsMax);
  }

  /** Remaining planned SEARCH spots (tests / debug). */
  plannedSearchSpots(): Vec2[] {
    return this.searchSpots.map((s) => ({ ...s.at }));
  }

  private pickSearchPoint(ctx: SimContext): Vec2 {
    const c = this.searchCenter ?? { x: this.h.x, z: this.h.z };
    return pickSearchPoint(ctx, ctx.hydeNav(), ctx.rng, this.h, c, ctx.tuning.hyde.searchRadiusM);
  }

  /**
   * Walk toward `goal` along the nav grid at `speed`. Returns true once within `arrive` metres of the goal, or when the
   * goal cannot be got closer to (unreachable / stuck).
   */
  private travel(ctx: SimContext, goal: Vec2, speed: number, dt: number, arrive: number, direct = false): boolean {
    const T = ctx.tuning.hyde;
    return this.mover.travel(ctx, ctx.hydeNav(), this.h, { radius: T.radius, turnRatePerS: T.turnRatePerS, replanS: T.replanS }, goal, speed, dt, arrive, direct, this.h.mode === 'CHASE');
  }

  /**
   * The Hyde's predicted path for the next `seconds`, from its CURRENT plan only (no future perception): it follows
   * the current nav path / target, then (in PATROL / COOLDOWN) the patrol loop. Used by the premonition effect.
   */
  predict(ctx: SimContext, seconds: number): Vec2[] {
    const h = this.h;
    const out: Vec2[] = [{ x: h.x, z: h.z }];
    if (!this.active) return out;
    let t = Math.max(0, h.stunnedUntil - ctx.t);
    if (t >= seconds) return out;
    const speed = Math.max(0.1, ctx.tuning.hyde.speed[h.mode] * (ctx.t < h.slowedUntil ? h.slowMult : 1));
    const nav = ctx.hydeNav();
    const legs: Vec2[] = [...h.path];
    if (legs.length === 0 && h.target) legs.push(...(nav.findPath(h, h.target) ?? []));
    let idx = this.patrolIndex;
    let pos: Vec2 = { x: h.x, z: h.z };
    let guard = 0;
    while (t < seconds && guard++ < 64) {
      if (legs.length === 0) {
        if ((h.mode === 'PATROL' || h.mode === 'COOLDOWN') && ctx.map.patrol.length > 0) {
          const wp = ctx.map.patrol[idx % ctx.map.patrol.length];
          idx++;
          legs.push(...(nav.findPath(pos, wp) ?? [wp]));
          if (legs.length === 0) legs.push(wp);
        } else break;
      }
      const next = legs.shift()!;
      const d = Math.hypot(next.x - pos.x, next.z - pos.z);
      const dtLeg = d / speed;
      if (t + dtLeg > seconds) {
        const f = (seconds - t) / dtLeg;
        pos = { x: pos.x + (next.x - pos.x) * f, z: pos.z + (next.z - pos.z) * f };
        out.push(pos);
        break;
      }
      t += dtLeg;
      pos = { x: next.x, z: next.z };
      out.push(pos);
    }
    return out;
  }
}

function round2(x: number): number {
  return Math.round(x * 100) / 100;
}

function round3(x: number): number {
  return Math.round(x * 1000) / 1000;
}
