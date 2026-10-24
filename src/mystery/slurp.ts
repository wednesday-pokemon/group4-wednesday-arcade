// Slurp — Isaac Night's zombie form, the third enemy (docs/final/FINAL_CONTRACT.md §5). An unpredictable stalker of one
// haunt per case (CaseWorldDef.slurp): sight + proximity, hears only LOUD noises. Spawned / despawned by the encounter
// director (director.ts). Modes WANDER → INVESTIGATE → SEARCH → LEAVE, CHASE → ATTACK → LEAVE; every change emits
// `slurp_mode {from, to, reason}`.
//
//   WANDER      walks to a seeded-random waypoint of def.wander (never the same one twice in a row) with a lurching gait
//               (speed pulses 55–100 %), then pauses pauseMinS..pauseMaxS while swaying — the director may despawn him
//               once cycleWaypoints waypoints are done ('cycle_done').
//   perception  (active, not stunned / lured, player not invulnerable) sight = sight.ts canSee with his own cone / range
//               (fog shortens, crouching × crouchRangeMult, low cover hides a crouching player, walls / high cover /
//               hiding spots / cabinets hide — enemyNav playerRevealAt); proximity: a non-hidden player ≤ proximityM all
//               around with LOS (not while distracted). Seen → suspicion += sightGainPerS × (1 + (1 − d / range)) × dt;
//               ≥ chaseAt, d ≤ instantM or proximity → CHASE ('saw_player' / 'sensed_player'; `enemy_detected {slurp}`),
//               else a glimpse → INVESTIGATE the last seen point. Never starts a chase beyond leashM from the centroid of
//               his wander points, nor while another enemy is engaged (ctx.enemyEngaged — he defers).
//   hearing     only noises with loudness ≥ hearMinLoudness (sprint, egg drop, cabinet slam, loud decoys) inside the
//               usual occluded hearing radius → INVESTIGATE ('heard_noise'); in CHASE they refresh the last known point.
//   INVESTIGATE walks there (speed.INVESTIGATE); arrive / investigateMaxS / leash → SEARCH.
//   SEARCH      searchS around the point with the shared spot sweep + safe wander (enemyNav) → LEAVE ('search_timeout').
//               An alert (INVESTIGATE / SEARCH, re-triggered by new noises) lasts at most alertMaxS → LEAVE ('gave_up').
//   CHASE       slower than a sprint, faster than a walk; lost sight chaseLossS → SEARCH ('lost_sight'); beyond the
//               leash → SEARCH ('leash'); another enemy engaged → SEARCH ('deferred'); within attackRangeM with the
//               attack ready → ATTACK.
//   ATTACK      a telegraphed lunge: attackWindupS (runtime.attacking = true) moving at CHASE × attackLungeMult toward the
//               player; then, if the player is within attackConnectM, not invulnerable, not distracted / lured / stunned
//               and not inside a cabinet → the run applies the hit (enemy_hit, HP − round(attackHp × catchDamageMult)
//               unless block_grab, knock-back, invulnerability, `dnf {by:'slurp'}` at 0 HP) → LEAVE ('attack_done');
//               a miss → CHASE if he still sees the player, else SEARCH.
//   LEAVE       shambles off toward the wander point farthest from the player, ignoring the player; the director despawns
//               him once out of sight and far ('encounter_resolved'); after leaveS without a despawn → WANDER ('gave_up').
// Effects (through the AbilityInterpreter's EnemyHandle list, by effect kind): stun freezes (cancels the lunge) then
// SEARCH; slow; distract (sight × distractedRangeMult, no proximity, no hearing, no attack); lure (decoy within
// lureRangeM) → INVESTIGATE it ignoring the player, then SEARCH. Cabinets: witnesses() / goToCabinet() → pull-out = a hit.
// Deterministic: random draws only from his own Rng (the run passes `new Rng(seed, 'slurp')`).
import type { SlurpTuning, SimTuning } from './config.ts';
import type { SimContext } from './context.ts';
import { cabinetFound, NavTraveller, pickSearchPoint, planSearchSpots, playerRevealAt, SEARCH_ARRIVE_M, inCabinetNow, type SearchSpot } from './enemyNav.ts';
import { polygonCentroid } from './crackstone.ts';
import { turnToward, wrapAngle, yawTo } from './geometry.ts';
import type { CabinetMemory } from './hyde.ts';
import { navGridFor, type NavGrid } from './nav.ts';
import { hear } from './noise.ts';
import type { Rng } from './rng.ts';
import { canSee } from './sight.ts';
import type { GameEvent, NoiseSource, SlurpDef, SlurpMode, SlurpRuntime, Vec2 } from './types.ts';

export type SlurpModeReason = Extract<GameEvent, { type: 'slurp_mode' }>['reason'];

export function createSlurpRuntime(def: SlurpDef): SlurpRuntime {
  const s = def.wander[0] ?? { x: 0, z: 0 };
  return {
    active: false, mode: 'WANDER', modeT: 0, x: s.x, z: s.z, yaw: 0, speed: 0, suspicion: 0, canSeePlayer: false, lastKnown: null,
    target: null, path: [], stunnedUntil: -Infinity, slowedUntil: -Infinity, slowMult: 1, distractedUntil: -Infinity, attacking: false,
  };
}

export class SlurpBrain {
  readonly s: SlurpRuntime;
  readonly def: SlurpDef;
  readonly cfg: SlurpTuning;
  readonly centroid: Vec2;
  lastStunEnd = -Infinity;
  lureUntil = -Infinity;
  lurePoint: Vec2 | null = null;
  lastSeenT = -Infinity;
  windupUntil = -Infinity;
  lastAttackAt = -Infinity;
  cabinetGoal: CabinetMemory | null = null;
  readonly stats = { sightings: 0, chases: 0, attacks: 0, hits: 0, heard: 0, deferrals: 0 };
  private readonly rng: Rng;
  private readonly mover = new NavTraveller();
  private wanderIndex = -1;
  private wanderDone = 0;
  private pauseUntil = -Infinity;
  private searchCenter: Vec2 | null = null;
  private searchUntil = -Infinity;
  private searchPauseUntil = -Infinity;
  private searchSpots: SearchSpot[] = [];
  private searchLook: Vec2 | null = null;
  private investigateSince = 0;
  private glimpsed = false;
  private hunted = false;
  private sweepDir = 1;
  private seenVia: 'sight' | 'proximity' = 'sight';
  /** Start of the current alert (INVESTIGATE / SEARCH without a chase); he gives up after alertMaxS → LEAVE. */
  private alertSince: number | null = null;

  constructor(def: SlurpDef, tuning: SimTuning, rng: Rng) {
    this.def = def;
    this.cfg = tuning.slurp;
    this.rng = rng;
    this.s = createSlurpRuntime(def);
    this.centroid = polygonCentroid(def.wander);
  }

  get active(): boolean {
    return this.s.active;
  }

  nav(ctx: SimContext): NavGrid {
    return navGridFor(ctx.map, ctx.world, this.cfg.radius, ctx.tuning.nav.cellM, ctx.tuning.nav.lowCoverBlocksMovement);
  }

  fromCentroid(p: Vec2): number {
    return Math.hypot(p.x - this.centroid.x, p.z - this.centroid.z);
  }

  isStunned(t: number): boolean {
    return t < this.s.stunnedUntil;
  }

  isLured(t: number): boolean {
    return t < this.lureUntil;
  }

  isDistracted(t: number): boolean {
    return t < this.s.distractedUntil;
  }

  perceives(ctx: SimContext): boolean {
    const t = ctx.t;
    return this.s.active && !this.isStunned(t) && !this.isLured(t) && t >= ctx.player.invulnerableUntil && this.s.mode !== 'LEAVE';
  }

  deferred(ctx: SimContext): boolean {
    return ctx.enemyEngaged ? ctx.enemyEngaged('slurp') : false;
  }

  /** Chasing or lunging (blocks the evidence board). */
  threatening(): boolean {
    return this.s.active && (this.s.mode === 'CHASE' || this.s.mode === 'ATTACK');
  }

  // ------------------------------------------------------------------------------------------------- lifecycle

  /** Director spawn at `at` (snapped to his grid): WANDER from a fresh state. */
  spawn(ctx: SimContext, at: { x: number; z: number; yaw: number }): Vec2 {
    const snapped = this.nav(ctx).nearestWalkable(at, 6) ?? { x: at.x, z: at.z };
    Object.assign(this.s, createSlurpRuntime(this.def), { active: true, x: snapped.x, z: snapped.z, yaw: at.yaw });
    this.mover.invalidate(this.s);
    this.lureUntil = -Infinity;
    this.lurePoint = null;
    this.lastSeenT = -Infinity;
    this.windupUntil = -Infinity;
    this.cabinetGoal = null;
    this.wanderIndex = -1;
    this.wanderDone = 0;
    this.pauseUntil = ctx.t + 0.8; // a beat to "rise" before he moves (the renderer plays the emergence)
    this.searchSpots = [];
    this.searchLook = null;
    this.glimpsed = false;
    this.hunted = false;
    this.alertSince = null;
    return snapped;
  }

  despawn(_ctx: SimContext): void {
    Object.assign(this.s, createSlurpRuntime(this.def), { x: this.s.x, z: this.s.z, yaw: this.s.yaw, active: false });
    this.lureUntil = -Infinity;
    this.windupUntil = -Infinity;
    this.cabinetGoal = null;
  }

  engaged(): boolean {
    return this.threatening();
  }

  calm(): boolean {
    return this.s.active && (this.s.mode === 'WANDER' || this.s.mode === 'LEAVE') && !this.cabinetGoal;
  }

  cycleDone(): boolean {
    return this.wanderDone >= this.cfg.cycleWaypoints;
  }

  encounterResolved(): boolean {
    return (this.s.active && this.s.mode === 'LEAVE') || (this.hunted && this.calm());
  }

  invalidatePath(): void {
    this.mover.invalidate(this.s);
  }

  setMode(ctx: SimContext, to: SlurpMode, reason: SlurpModeReason): void {
    const s = this.s;
    const from = s.mode;
    if (from === to) return;
    s.mode = to;
    s.modeT = 0;
    s.path = [];
    s.target = null;
    this.mover.planGoal = null;
    this.glimpsed = false;
    this.cabinetGoal = null;
    if (to !== 'ATTACK') {
      this.windupUntil = -Infinity;
      s.attacking = false;
    }
    if (to === 'INVESTIGATE') this.investigateSince = ctx.t;
    if (to === 'INVESTIGATE' || to === 'SEARCH') this.alertSince ??= ctx.t;
    else this.alertSince = null;
    if (reason === 'deferred') this.stats.deferrals++;
    ctx.emit({ type: 'slurp_mode', from, to, reason });
    if (to === 'CHASE' && from !== 'ATTACK') {
      this.stats.chases++;
      this.hunted = true;
      ctx.emit({ type: 'enemy_detected', enemy: 'slurp', via: this.seenVia });
    }
  }

  private clampToLeash(p: Vec2): Vec2 {
    const d = this.fromCentroid(p);
    const L = this.def.leashM;
    if (d <= L || d < 1e-6) return { x: p.x, z: p.z };
    const k = L / d;
    return { x: this.centroid.x + (p.x - this.centroid.x) * k, z: this.centroid.z + (p.z - this.centroid.z) * k };
  }

  private startSearch(ctx: SimContext, center: Vec2, reason: SlurpModeReason, startAt = ctx.t): void {
    const s = this.s;
    const nav = this.nav(ctx);
    const clamped = this.clampToLeash(center);
    this.setMode(ctx, 'SEARCH', reason);
    this.searchCenter = nav.nearestWalkable(clamped, 4, nav.componentAt(s, 2)) ?? clamped;
    this.searchUntil = startAt + this.cfg.searchS;
    this.searchPauseUntil = startAt + 0.6;
    const L = this.def.leashM + 1;
    this.searchSpots = planSearchSpots(ctx, nav, s, this.searchCenter, this.cfg.searchRadiusM, this.cfg.searchSpotsMax, (q) => this.fromCentroid(q) <= L);
    this.searchLook = null;
  }

  private startLeave(ctx: SimContext, reason: SlurpModeReason): void {
    this.setMode(ctx, 'LEAVE', reason);
    const p = ctx.player;
    let best: Vec2 | null = null;
    let bestD = -1;
    for (const w of this.def.wander) {
      const d = Math.hypot(w.x - p.x, w.z - p.z);
      if (d > bestD) {
        bestD = d;
        best = w;
      }
    }
    this.s.target = best ? { x: best.x, z: best.z } : null;
    this.s.suspicion = 0;
    this.s.lastKnown = null;
  }

  // ------------------------------------------------------------------------------------------------- effects

  stun(ctx: SimContext, durationS: number): void {
    const s = this.s;
    s.stunnedUntil = Math.max(s.stunnedUntil, ctx.t + durationS);
    this.lastStunEnd = s.stunnedUntil;
    s.speed = 0;
    this.windupUntil = -Infinity;
    s.attacking = false;
    this.cabinetGoal = null;
    s.canSeePlayer = false;
    if (this.isLured(ctx.t)) return;
    s.lastKnown = { x: ctx.player.x, z: ctx.player.z };
    this.startSearch(ctx, s.lastKnown, 'stunned', s.stunnedUntil);
  }

  slow(ctx: SimContext, durationS: number, mult: number): void {
    this.s.slowedUntil = Math.max(this.s.slowedUntil, ctx.t + durationS);
    this.s.slowMult = Math.max(ctx.tuning.abilities.minHydeSpeedMult, Math.min(1, mult));
  }

  distract(ctx: SimContext, durationS: number): void {
    this.s.distractedUntil = Math.max(this.s.distractedUntil, ctx.t + durationS);
    this.windupUntil = -Infinity;
    this.s.attacking = false;
    this.cabinetGoal = null;
  }

  /** Pull him to a decoy within lureRangeM for `durationS` (ignores the player meanwhile). False if he does not go. */
  lure(ctx: SimContext, point: Vec2, durationS: number): boolean {
    const s = this.s;
    if (!s.active || Math.hypot(point.x - s.x, point.z - s.z) > this.cfg.lureRangeM) return false;
    if ((s.mode === 'CHASE' || s.mode === 'ATTACK') && !ctx.tuning.abilities.lureBreaksChase) return false;
    this.lureUntil = ctx.t + durationS;
    this.lurePoint = { x: point.x, z: point.z };
    s.canSeePlayer = false;
    if (s.mode === 'INVESTIGATE') {
      s.path = [];
      this.mover.planGoal = null;
      this.investigateSince = ctx.t;
      this.cabinetGoal = null;
    } else this.setMode(ctx, 'INVESTIGATE', 'lured');
    s.target = { x: point.x, z: point.z };
    return true;
  }

  /** Could he see the player right now (sight, or proximity while not yet hidden)? revealM as HydeBrain.witnesses. */
  witnesses(ctx: SimContext, revealM: number | null = null): boolean {
    if (!this.perceives(ctx) || this.isDistracted(ctx.t)) return false;
    const s = this.s;
    const p = ctx.player;
    if (revealM === null && this.threatening() && s.canSeePlayer) return true;
    const res = canSee(ctx.world, this.cfg.sight, s, { x: p.x, z: p.z, crouched: false, hiddenRevealM: revealM }, {
      fog: ctx.inFog(s.x, s.z) || ctx.inFog(p.x, p.z), distracted: false,
    });
    if (res.seen) return true;
    return revealM === null && Math.hypot(p.x - s.x, p.z - s.z) <= this.cfg.proximityM && ctx.world.lineOfSight(s.x, s.z, p.x, p.z, false);
  }

  goToCabinet(ctx: SimContext, mem: CabinetMemory): boolean {
    if (!this.s.active || this.s.mode === 'LEAVE' || this.fromCentroid(mem.door) > this.def.leashM + 2) return false;
    const s = this.s;
    if (s.mode === 'INVESTIGATE') {
      s.path = [];
      this.mover.planGoal = null;
      this.investigateSince = ctx.t;
    } else this.setMode(ctx, 'INVESTIGATE', 'saw_player');
    this.cabinetGoal = { spotId: mem.spotId, door: { ...mem.door } };
    s.target = { ...mem.door };
    s.lastKnown = { ...mem.door };
    return true;
  }

  /** Only LOUD noises reach him. Returns whether he heard it. */
  hearNoise(ctx: SimContext, _source: NoiseSource, x: number, z: number, loudness: number): boolean {
    if (!this.perceives(ctx) || this.isDistracted(ctx.t) || loudness < this.cfg.hearMinLoudness - 1e-9) return false;
    const s = this.s;
    const res = hear(ctx.world, ctx.tuning.noise, loudness, x, z, s.x, s.z, 1);
    if (!res.heard) return false;
    this.stats.heard++;
    if (this.cabinetGoal) return true;
    s.lastKnown = { x, z };
    if (s.mode === 'CHASE' || s.mode === 'ATTACK') return true;
    const goal = this.clampToLeash({ x, z });
    if (s.mode === 'INVESTIGATE') {
      s.target = goal;
      this.investigateSince = ctx.t;
      return true;
    }
    this.setMode(ctx, 'INVESTIGATE', 'heard_noise');
    s.target = goal;
    return true;
  }

  // ------------------------------------------------------------------------------------------------- step

  /** One fixed step (after Crackstone). `onHit` applies a landed attack; it returns false when the run ended (DNF). */
  step(ctx: SimContext, dt: number, onHit: () => boolean): void {
    const s = this.s;
    const t = ctx.t;
    const cfg = this.cfg;
    s.modeT += dt;
    if (!s.active) {
      s.speed = 0;
      return;
    }
    if (this.isStunned(t)) {
      s.speed = 0;
      return;
    }
    if (this.lureUntil > -Infinity && t >= this.lureUntil) {
      this.lureUntil = -Infinity;
      const at = this.lurePoint ?? { x: s.x, z: s.z };
      this.lurePoint = null;
      this.startSearch(ctx, at, 'reached_target');
    }
    const deferred = this.deferred(ctx);
    if (deferred && (s.mode === 'CHASE' || s.mode === 'ATTACK')) this.startSearch(ctx, s.lastKnown ?? { x: s.x, z: s.z }, 'deferred');
    const p = ctx.player;
    const dPlayer = Math.hypot(p.x - s.x, p.z - s.z);
    const distracted = this.isDistracted(t);

    // ---- perception
    let seen = false;
    if (this.perceives(ctx)) {
      const res = canSee(ctx.world, cfg.sight, s, { x: p.x, z: p.z, crouched: p.crouched, hiddenRevealM: playerRevealAt(ctx) }, {
        fog: ctx.inFog(s.x, s.z) || ctx.inFog(p.x, p.z), distracted,
      });
      seen = res.seen;
      this.seenVia = 'sight';
      if (!seen && !p.hidden && !distracted && dPlayer <= cfg.proximityM && ctx.world.lineOfSight(s.x, s.z, p.x, p.z, false)) {
        seen = true;
        this.seenVia = 'proximity';
      }
      if (seen) {
        if (!s.canSeePlayer) this.stats.sightings++;
        const closeness = 1 + Math.max(0, 1 - res.distanceM / Math.max(1e-6, res.rangeM));
        s.suspicion = Math.min(1, s.suspicion + cfg.suspicion.sightGainPerS * closeness * dt);
        s.lastKnown = { x: p.x, z: p.z };
        this.lastSeenT = t;
        if (s.mode !== 'CHASE' && s.mode !== 'ATTACK') {
          const instant = this.seenVia === 'proximity' || dPlayer <= cfg.sight.instantM;
          const mayChase = !deferred && this.fromCentroid(p) <= this.def.leashM;
          if (mayChase && (s.suspicion >= cfg.suspicion.chaseAt || instant)) {
            s.suspicion = 1;
            this.setMode(ctx, 'CHASE', this.seenVia === 'proximity' ? 'sensed_player' : 'saw_player');
          } else this.glimpsed = true;
        }
      }
    }
    s.canSeePlayer = seen;
    if (s.mode === 'CHASE' || s.mode === 'ATTACK') s.suspicion = 1;
    else if (!seen) s.suspicion = Math.max(0, s.suspicion - cfg.suspicion.decayPerS * dt);

    if (!seen && this.glimpsed && s.mode !== 'CHASE' && s.mode !== 'ATTACK' && s.lastKnown && this.perceives(ctx)) {
      this.glimpsed = false;
      const goal = this.clampToLeash(s.lastKnown);
      if (s.mode === 'INVESTIGATE') this.investigateSince = t;
      else this.setMode(ctx, 'INVESTIGATE', 'saw_player');
      s.target = goal;
    }

    // a player found in a cabinet (seen through the open door, or the one he remembers): dragged out = a hit
    const found = this.perceives(ctx) ? cabinetFound(ctx, s, this.cabinetGoal, seen) : null;
    if (found) {
      this.cabinetGoal = null;
      this.stats.hits++;
      this.lastAttackAt = t;
      if (!ctx.pullOut?.('slurp', found)) return;
      this.startLeave(ctx, 'attack_done');
      return;
    }

    // an alert that never finds anyone (noises keep him busy) ends: he shambles off
    if (this.alertSince !== null && t - this.alertSince >= cfg.alertMaxS && !this.isLured(t) && !this.cabinetGoal && (s.mode === 'INVESTIGATE' || s.mode === 'SEARCH')) {
      return this.startLeave(ctx, 'gave_up');
    }

    const slow = t < s.slowedUntil ? s.slowMult : 1;
    const speed = cfg.speed[s.mode] * slow;
    switch (s.mode) {
      case 'WANDER': {
        if (this.glimpsed && seen) return this.faceAndHold(p, dt);
        if (t < this.pauseUntil) return this.sway(dt);
        if (!s.target) s.target = this.nextWander();
        if (!s.target) return this.sway(dt);
        const lurch = 0.55 + 0.45 * Math.abs(Math.sin(s.modeT * 2.3));
        if (this.travel(ctx, s.target, speed * lurch, dt, cfg.waypointReachedM)) {
          s.target = null;
          this.wanderDone++;
          this.pauseUntil = t + this.rng.range(cfg.pauseMinS, Math.max(cfg.pauseMinS, cfg.pauseMaxS));
          this.sweepDir = this.rng.chance(0.5) ? 1 : -1;
        }
        return;
      }
      case 'INVESTIGATE': {
        if (this.glimpsed && seen) return this.faceAndHold(p, dt);
        const goal = s.target ?? s.lastKnown;
        if (!goal) return this.startSearch(ctx, s, 'reached_target');
        const lured = this.isLured(t);
        if (this.fromCentroid(s) > this.def.leashM + 1.5 && !this.cabinetGoal) {
          if (lured) return this.sway(dt);
          return this.startSearch(ctx, s, 'leash');
        }
        if (t - this.investigateSince >= cfg.investigateMaxS && !lured) return this.startSearch(ctx, goal, 'gave_up');
        const cab = this.cabinetGoal;
        if (cab && Math.hypot(cab.door.x - s.x, cab.door.z - s.z) <= ctx.tuning.cabinet.pullOutM) {
          this.cabinetGoal = null; // the player is no longer inside: search here
          return this.startSearch(ctx, goal, 'reached_target');
        }
        if (this.travel(ctx, goal, speed, dt, 1.0)) {
          if (lured) this.sway(dt);
          else this.startSearch(ctx, goal, 'reached_target');
        }
        return;
      }
      case 'SEARCH': {
        if (this.glimpsed && seen) return this.faceAndHold(p, dt);
        if (t >= this.searchUntil) return this.startLeave(ctx, 'search_timeout');
        if (t < this.searchPauseUntil) {
          s.speed = 0;
          const look = this.searchLook;
          if (look && Math.abs(wrapAngle(yawTo(s.x, s.z, look.x, look.z) - s.yaw)) > 0.05) {
            s.yaw = turnToward(s.yaw, yawTo(s.x, s.z, look.x, look.z), cfg.turnRatePerS * dt);
          } else {
            this.searchLook = null;
            s.yaw = wrapAngle(s.yaw + this.sweepDir * 1.1 * dt);
          }
          return;
        }
        if (!s.target) {
          const next = this.searchSpots.shift();
          const center = this.searchCenter ?? { x: s.x, z: s.z };
          const L = this.def.leashM + 1;
          s.target = next ? next.at : pickSearchPoint(ctx, this.nav(ctx), this.rng, s, center, cfg.searchRadiusM, (q) => this.fromCentroid(q) <= L);
          this.searchLook = next ? next.look : null;
        }
        if (this.travel(ctx, s.target, speed, dt, SEARCH_ARRIVE_M)) {
          s.target = null;
          this.sweepDir = -this.sweepDir;
          this.searchPauseUntil = t + this.rng.range(0.8, 1.6);
        }
        return;
      }
      case 'CHASE': {
        const want = seen ? { x: p.x, z: p.z } : (s.lastKnown ?? { x: p.x, z: p.z });
        if (this.fromCentroid(s) > this.def.leashM + 1.5 || (this.fromCentroid(want) > this.def.leashM && this.fromCentroid(s) >= this.def.leashM - 1)) {
          return this.startSearch(ctx, s.lastKnown ?? s, 'leash');
        }
        const invulnerable = t < p.invulnerableUntil;
        if (!seen && (t - this.lastSeenT >= cfg.chaseLossS || distracted || invulnerable)) {
          return this.startSearch(ctx, s.lastKnown ?? { x: s.x, z: s.z }, 'lost_sight');
        }
        if (seen && !deferred && !distracted && !invulnerable && dPlayer <= cfg.attackRangeM && t >= this.lastAttackAt + cfg.attackCooldownS) {
          this.lastAttackAt = t;
          this.stats.attacks++;
          this.setMode(ctx, 'ATTACK', 'saw_player');
          this.windupUntil = t + cfg.attackWindupS;
          s.attacking = true;
          return;
        }
        const goal = this.clampToLeash(want);
        s.target = goal;
        if (this.travel(ctx, goal, speed, dt, seen ? 0.5 : 0.8, seen)) s.speed = 0;
        return;
      }
      case 'ATTACK': {
        // the lunge: keeps closing in while winding up (a sprint gets away)
        const lunge = cfg.speed.CHASE * cfg.attackLungeMult * slow;
        this.travel(ctx, { x: p.x, z: p.z }, lunge, dt, 0.4, true);
        s.yaw = turnToward(s.yaw, yawTo(s.x, s.z, p.x, p.z), cfg.turnRatePerS * 2 * dt);
        if (t < this.windupUntil - 1e-9) return;
        this.windupUntil = -Infinity;
        s.attacking = false;
        const d = Math.hypot(p.x - s.x, p.z - s.z);
        const lands = d <= cfg.attackConnectM && t >= p.invulnerableUntil && !distracted && !this.isLured(t) && !inCabinetNow(p);
        if (lands) {
          this.stats.hits++;
          if (!onHit()) return;
          this.startLeave(ctx, 'attack_done');
          return;
        }
        if (seen) this.setMode(ctx, 'CHASE', 'attack_done');
        else this.startSearch(ctx, s.lastKnown ?? s, 'attack_done');
        return;
      }
      case 'LEAVE': {
        if (s.modeT >= cfg.leaveS) {
          this.setMode(ctx, 'WANDER', 'gave_up');
          return;
        }
        if (!s.target) return this.sway(dt);
        if (this.travel(ctx, s.target, speed, dt, cfg.waypointReachedM)) {
          // arrived but still not despawned (the player can see this spot): wander off again
          s.target = this.nextWander();
        }
        return;
      }
    }
  }

  /** Seeded next wander waypoint (never the current one), inside his leash. */
  private nextWander(): Vec2 | null {
    const w = this.def.wander;
    if (w.length === 0) return null;
    if (w.length === 1) return { ...w[0] };
    let i = this.rng.int(w.length - 1);
    if (i >= this.wanderIndex && this.wanderIndex >= 0) i++;
    this.wanderIndex = Math.min(w.length - 1, i);
    return { x: w[this.wanderIndex].x, z: w[this.wanderIndex].z };
  }

  private sway(dt: number): void {
    this.s.speed = 0;
    this.s.yaw = wrapAngle(this.s.yaw + this.sweepDir * 0.9 * dt);
  }

  private faceAndHold(p: Vec2, dt: number): void {
    this.s.speed = 0;
    this.s.yaw = turnToward(this.s.yaw, yawTo(this.s.x, this.s.z, p.x, p.z), this.cfg.turnRatePerS * dt);
  }

  private travel(ctx: SimContext, goal: Vec2, speed: number, dt: number, arrive: number, direct = false): boolean {
    const cfg = this.cfg;
    return this.mover.travel(ctx, this.nav(ctx), this.s, { radius: cfg.radius, turnRatePerS: cfg.turnRatePerS, replanS: cfg.replanS }, goal, speed, dt, arrive, direct, this.s.mode === 'CHASE');
  }

  /** Predicted path for the next `seconds` from his current plan (premonition). */
  predict(ctx: SimContext, seconds: number): Vec2[] {
    const s = this.s;
    const out: Vec2[] = [{ x: s.x, z: s.z }];
    if (!s.active) return out;
    let t = Math.max(0, s.stunnedUntil - ctx.t);
    if (t >= seconds) return out;
    const speed = Math.max(0.1, this.cfg.speed[s.mode] * (ctx.t < s.slowedUntil ? s.slowMult : 1));
    const legs: Vec2[] = [...s.path];
    if (legs.length === 0 && s.target) legs.push(...(this.nav(ctx).findPath(s, s.target) ?? []));
    let pos: Vec2 = { x: s.x, z: s.z };
    for (const next of legs) {
      const d = Math.hypot(next.x - pos.x, next.z - pos.z);
      const dtLeg = d / speed;
      if (t + dtLeg > seconds) {
        const f = (seconds - t) / Math.max(1e-6, dtLeg);
        out.push({ x: pos.x + (next.x - pos.x) * f, z: pos.z + (next.z - pos.z) * f });
        break;
      }
      t += dtLeg;
      pos = { x: next.x, z: next.z };
      out.push(pos);
    }
    return out;
  }
}
