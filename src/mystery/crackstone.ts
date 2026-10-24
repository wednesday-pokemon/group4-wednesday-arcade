// Joseph Crackstone — the second enemy (docs/overhaul/ENEMY_CONTRACT.md R1–R9, sim rules 1–12). A deaf, sight-based
// guardian of one public cursed area per case (CaseWorldDef.crackstone). Modes PATROL → INVESTIGATE → CHASE → ATTACK →
// SEARCH → RETURN → PATROL; every change emits `crackstone_mode` with its reason.
//
//   PATROL      walks the closed `def.patrol` loop at speed.PATROL; at every waypoint pauses patrolPauseS while slowly
//               turning (look-around). Scans every scanEveryS ± scanJitterS (own seeded stream) in PATROL / SEARCH.
//   perception  (active, not stunned / lured, player not invulnerable) sight = sight.ts canSee() with his own cone /
//               range (× per-case sightRangeMult, × returnSightMult while RETURNing, × distractedRangeMult while
//               distracted; fog shortens, crouch × crouchRangeMult, low cover hides a crouching player, walls / high
//               cover / hiding spots hide). Proximity: a non-hidden player ≤ proximityM all around with LOS (crouching
//               does not help; not while distracted). Seen → suspicion += sightGainPerS × (1 + (1 − d/range)) × dt;
//               ≥ chaseAt, d ≤ instantM or proximity → CHASE (saw_player / sensed_player), else a glimpse: he stops and
//               stares, then INVESTIGATEs the last seen point once sight breaks. He never starts a chase on a player
//               beyond leashM from his area's centroid (that sighting is a glimpse: he investigates up to the border).
//   scan        `crackstone_scan {warning}` (he stands still) → scanWarnS later `{pulse, hit}`: hit = player within
//               scanRadiusM, line of sight (walls + high cover; low cover does NOT block, crouching does not help), not
//               hidden, not invulnerable. Hit → `crackstone_sighted {scan}` + CHASE (scan_hit). A warning is cancelled
//               WITHOUT a pulse when he is stunned / lured / distracted, starts a chase by sight, or the Hyde starts a
//               chase (R6). No scan starts within scanGraceAfterChaseS after a chase / curse ends.
//   INVESTIGATE walks to the target (last seen point / decoy) at speed.INVESTIGATE; arrive or investigateMaxS → SEARCH;
//               crossing leashM → SEARCH (leash).
//   CHASE       follows the player on his nav grid (replans like the Hyde) at speed.CHASE; lost sight chaseLossS →
//               SEARCH (lost_sight); beyond leashM from the centroid → SEARCH (leash). Within curseRangeM with LOS and the
//               curse ready (curseCooldownS since the last cast) → ATTACK.
//   ATTACK      stands still facing the player; `runtime.curse` centred on the player's spot at cast time,
//               `curse {cast}`; at landsAt (+curseWindupS): player inside the circle, LOS from him, not invulnerable,
//               not hidden → the run applies the hit (R7: HP, block_grab, slow, invulnerability, hp_depleted DNF; the
//               run emits `curse {hit}`) → RETURN (curse_done); else `curse {miss}` → CHASE if he still sees the
//               player, else SEARCH (curse_missed). A stun / lure / distract / R6 deferral during the wind-up cancels it
//               (`curse {miss}`).
//   SEARCH      searchS around the last known point (clamped into the leash disc): the Hyde's spot sweep and safe
//               wander (enemyNav.ts — never within hidingSafeM of a hiding spot), then RETURN (search_timeout).
//   RETURN      walks to the nearest patrol waypoint at speed.RETURN with sight × returnSightMult → PATROL (returned).
//   R6          while the Hyde is in CHASE he never starts CHASE / ATTACK / scans; if chasing / attacking he cancels
//               (curse fizzles) and SEARCHes (deferred).
// Movement = enemyNav.ts NavTraveller on his own nav grid (radius cfg.radius): world.move collision, turn rate, stuck
// guard — never through walls, never teleports. Deterministic: his only random draws come from his OWN Rng (the run
// passes `new Rng(seed, 'crackstone')`), so maps without him keep the sim stream (and logs) byte-identical.
import { crackstoneTuningFor, type CrackstoneTuning, type SimTuning } from './config.ts';
import type { SimContext } from './context.ts';
import { hidingRevealAt, NavTraveller, pickSearchPoint, planSearchSpots, SEARCH_ARRIVE_M, type SearchSpot } from './enemyNav.ts';
import { dist, pointInPolygon, turnToward, wrapAngle, yawTo } from './geometry.ts';
import { navGridFor, type NavGrid } from './nav.ts';
import type { Rng } from './rng.ts';
import { canSee } from './sight.ts';
import type {
  CrackstoneDef, CrackstoneDetectVia, CrackstoneMode, CrackstoneModeReason, CrackstoneRuntime, Vec2,
} from './types.ts';

/** Telegraph hit test result (UX_ENEMIES §2): inside and hittable / inside but protected / outside. */
export type EnemyExposure = 'exposed' | 'covered' | 'out';

export function createCrackstoneRuntime(def: CrackstoneDef): CrackstoneRuntime {
  return {
    mode: 'PATROL', modeT: 0, x: def.start.x, z: def.start.z, yaw: def.start.yaw, speed: 0,
    suspicion: 0, canSeePlayer: false, lastKnown: null, target: null, path: [],
    stunnedUntil: -Infinity, slowedUntil: -Infinity, slowMult: 1, distractedUntil: -Infinity, scan: null, curse: null,
  };
}

/** Area centroid (vertex mean — the cursed areas are rectangles / convex polygons). */
export function polygonCentroid(poly: readonly Vec2[]): Vec2 {
  if (poly.length === 0) return { x: 0, z: 0 };
  let x = 0;
  let z = 0;
  for (const p of poly) {
    x += p.x;
    z += p.z;
  }
  return { x: x / poly.length, z: z / poly.length };
}

export class CrackstoneBrain {
  readonly c: CrackstoneRuntime;
  readonly def: CrackstoneDef;
  /** Resolved tuning for this map (per-case sight range / scan interval applied). */
  readonly cfg: CrackstoneTuning;
  readonly centroid: Vec2;
  active = false;
  patrolIndex = 0;
  lastSeenT = -Infinity;
  lastStunEnd = -Infinity;
  lureUntil = -Infinity;
  lurePoint: Vec2 | null = null;
  lastCurseAt = -Infinity;
  nextScanAt = Infinity;
  /** Counters for analytics / tests / bot reports. */
  readonly stats = { sightings: 0, chases: 0, scans: 0, scanHits: 0, curses: 0, curseHits: 0, deferrals: 0 };
  private readonly rng: Rng;
  private readonly returnSight: SimTuning['sight'];
  private readonly mover = new NavTraveller();
  private scanGraceUntil = -Infinity;
  private pauseUntil = -Infinity;
  private searchCenter: Vec2 | null = null;
  private searchUntil = -Infinity;
  private searchPauseUntil = -Infinity;
  private searchSpots: SearchSpot[] = [];
  private searchLook: Vec2 | null = null;
  private investigateSince = 0;
  private returnIndex = 0;
  private glimpsed = false;
  /** After a leash give-up he does not restart a chase by sight for a moment (no border thrashing). */
  private noChaseUntil = -Infinity;
  private sweepDir = 1;

  constructor(def: CrackstoneDef, tuning: SimTuning, rng: Rng) {
    this.def = def;
    this.cfg = crackstoneTuningFor(tuning, def);
    this.rng = rng;
    this.c = createCrackstoneRuntime(def);
    this.centroid = polygonCentroid(def.polygon);
    const m = this.cfg.returnSightMult;
    this.returnSight = { ...this.cfg.sight, rangeM: this.cfg.sight.rangeM * m, fogRangeM: this.cfg.sight.fogRangeM * m };
  }

  /** His nav grid (own radius; cached per map geometry + open gates). */
  nav(ctx: SimContext): NavGrid {
    return navGridFor(ctx.map, ctx.world, this.cfg.radius, ctx.tuning.nav.cellM, ctx.tuning.nav.lowCoverBlocksMovement);
  }

  /** Start of play (t = 0 of 'playing'): at def.start (snapped to his grid), patrolling, first scan scheduled. */
  start(ctx: SimContext): void {
    const s = this.def.start;
    const snapped = this.nav(ctx).nearestWalkable(s, 6) ?? { x: s.x, z: s.z };
    Object.assign(this.c, createCrackstoneRuntime(this.def), { x: snapped.x, z: snapped.z });
    this.mover.invalidate(this.c);
    this.patrolIndex = this.nearestPatrolIndex();
    const pts = this.def.patrol;
    if (pts.length > 1 && dist(pts[this.patrolIndex], this.c) < 1) this.patrolIndex = (this.patrolIndex + 1) % pts.length;
    this.lastSeenT = -Infinity;
    this.lastStunEnd = -Infinity;
    this.lureUntil = -Infinity;
    this.lurePoint = null;
    this.lastCurseAt = -Infinity;
    this.scanGraceUntil = -Infinity;
    this.pauseUntil = -Infinity;
    this.glimpsed = false;
    this.scheduleScan(ctx.t);
    this.active = true;
  }

  // ------------------------------------------------------------------------------------------------- queries

  isStunned(t: number): boolean {
    return t < this.c.stunnedUntil;
  }

  isLured(t: number): boolean {
    return t < this.lureUntil;
  }

  isDistracted(t: number): boolean {
    return t < this.c.distractedUntil;
  }

  /** The cursed area outline contains (x, z). */
  inArea(x: number, z: number): boolean {
    return pointInPolygon(x, z, this.def.polygon);
  }

  /** Distance (m) of a point from his area's centroid (the leash is measured from here). */
  fromCentroid(p: Vec2): number {
    return Math.hypot(p.x - this.centroid.x, p.z - this.centroid.z);
  }

  /** Perception of the player is off while inactive, stunned, lured, or while the player is invulnerable. */
  perceives(ctx: SimContext): boolean {
    const t = ctx.t;
    return this.active && !this.isStunned(t) && !this.isLured(t) && t >= ctx.player.invulnerableUntil;
  }

  /** R6: the Hyde is chasing, so he may not start CHASE / ATTACK / scans. */
  deferred(ctx: SimContext): boolean {
    return ctx.hyde.mode === 'CHASE';
  }

  /** Threatening right now (blocks the evidence board): chasing, cursing, or a scan warning pending. */
  threatening(): boolean {
    const c = this.c;
    return this.active && (c.mode === 'CHASE' || c.mode === 'ATTACK' || c.curse !== null || c.scan?.phase === 'warning');
  }

  /** The scan hit test the pulse uses, evaluated now (independent of whether a scan is pending). */
  scanTest(ctx: SimContext): EnemyExposure {
    const p = ctx.player;
    const c = this.c;
    const r = c.scan?.radiusM ?? this.cfg.scanRadiusM;
    if (Math.hypot(p.x - c.x, p.z - c.z) > r) return 'out';
    if (p.hidden || ctx.t < p.invulnerableUntil || !ctx.world.lineOfSight(c.x, c.z, p.x, p.z, false)) return 'covered';
    return 'exposed';
  }

  /** UX helper: the pending scan warning's exposure ('exposed' = the pulse would hit now); null without a warning. */
  scanExposure(ctx: SimContext): EnemyExposure | null {
    return this.active && this.c.scan?.phase === 'warning' ? this.scanTest(ctx) : null;
  }

  /** The curse hit test used when it lands, evaluated now; null without a pending curse. */
  curseExposure(ctx: SimContext): EnemyExposure | null {
    const cu = this.c.curse;
    if (!this.active || !cu) return null;
    const p = ctx.player;
    const c = this.c;
    if (Math.hypot(p.x - cu.x, p.z - cu.z) > cu.radiusM) return 'out';
    if (p.hidden || ctx.t < p.invulnerableUntil || !ctx.world.lineOfSight(c.x, c.z, p.x, p.z, false)) return 'covered';
    return 'exposed';
  }

  // ------------------------------------------------------------------------------------------------- modes

  setMode(ctx: SimContext, to: CrackstoneMode, reason: CrackstoneModeReason): void {
    const c = this.c;
    const from = c.mode;
    if (from === to) return;
    c.mode = to;
    c.modeT = 0;
    c.path = [];
    this.mover.planGoal = null;
    this.glimpsed = false;
    if (to === 'CHASE' && from !== 'ATTACK') this.stats.chases++;
    const engaged = (m: CrackstoneMode) => m === 'CHASE' || m === 'ATTACK';
    if (engaged(from) && !engaged(to)) this.scanGraceUntil = ctx.t + this.cfg.scanGraceAfterChaseS;
    if (to === 'INVESTIGATE') this.investigateSince = ctx.t;
    if (reason === 'deferred') this.stats.deferrals++;
    ctx.emit({ type: 'crackstone_mode', from, to, reason });
  }

  private clampToLeash(p: Vec2): Vec2 {
    const d = this.fromCentroid(p);
    const L = this.def.leashM;
    if (d <= L || d < 1e-6) return { x: p.x, z: p.z };
    const k = L / d;
    return { x: this.centroid.x + (p.x - this.centroid.x) * k, z: this.centroid.z + (p.z - this.centroid.z) * k };
  }

  private startSearch(ctx: SimContext, center: Vec2, reason: CrackstoneModeReason, startAt = ctx.t): void {
    const c = this.c;
    const nav = this.nav(ctx);
    const clamped = this.clampToLeash(center);
    this.searchCenter = nav.nearestWalkable(clamped, 4, nav.componentAt(c, 2)) ?? clamped;
    this.searchUntil = startAt + this.cfg.searchS;
    this.searchPauseUntil = startAt + 0.6;
    c.target = null;
    c.path = [];
    this.mover.planGoal = null;
    this.setMode(ctx, 'SEARCH', reason);
    const L = this.def.leashM + 1;
    this.searchSpots = planSearchSpots(ctx, nav, c, this.searchCenter, this.cfg.searchRadiusM, this.cfg.searchSpotsMax, (p) => this.fromCentroid(p) <= L);
    this.searchLook = null;
  }

  private giveUpAtLeash(ctx: SimContext): void {
    this.noChaseUntil = ctx.t + 2;
    this.startSearch(ctx, this.c.lastKnown ?? this.c, 'leash');
  }

  private startReturn(ctx: SimContext, reason: CrackstoneModeReason): void {
    this.returnIndex = this.nearestPatrolIndex();
    this.c.target = null;
    this.setMode(ctx, 'RETURN', reason);
  }

  private nearestPatrolIndex(): number {
    const pts = this.def.patrol;
    let best = 0;
    let bestD = Infinity;
    for (let i = 0; i < pts.length; i++) {
      const d = dist(pts[i], this.c);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    return best;
  }

  private scheduleScan(t: number): void {
    const j = this.cfg.scanJitterS;
    this.nextScanAt = t + Math.max(this.cfg.scanWarnS + 1, this.cfg.scanEveryS + (j > 0 ? this.rng.range(-j, j) : 0));
  }

  /** Drops a pending scan WARNING without a pulse (stun / lure / distract / chase start / R6) and reschedules. */
  private cancelScan(ctx: SimContext): void {
    if (this.c.scan?.phase !== 'warning') return;
    this.c.scan = null;
    this.scheduleScan(ctx.t);
  }

  /** A pending curse fizzles (`curse {miss}`). */
  private cancelCurse(ctx: SimContext): void {
    if (!this.c.curse) return;
    this.c.curse = null;
    ctx.emit({ type: 'curse', phase: 'miss', hpLost: 0, blocked: false });
  }

  /** Drops the current nav plan (walls opened / closed). */
  invalidatePath(): void {
    this.mover.invalidate(this.c);
  }

  // ------------------------------------------------------------------------------------------------- effects

  /** Freeze for `durationS` (already scaled / capped / diminished by the caller); cancels a curse / scan warning. */
  stun(ctx: SimContext, durationS: number): void {
    const c = this.c;
    c.stunnedUntil = Math.max(c.stunnedUntil, ctx.t + durationS);
    this.lastStunEnd = c.stunnedUntil;
    c.speed = 0;
    this.cancelCurse(ctx);
    this.cancelScan(ctx);
    if (c.canSeePlayer) ctx.emit({ type: 'crackstone_lost' });
    c.canSeePlayer = false;
    if (this.isLured(ctx.t)) return; // a decoy is pending: freeze, then go to it
    c.lastKnown = { x: ctx.player.x, z: ctx.player.z };
    this.startSearch(ctx, c.lastKnown, 'stunned', c.stunnedUntil);
  }

  slow(ctx: SimContext, durationS: number, mult: number): void {
    this.c.slowedUntil = Math.max(this.c.slowedUntil, ctx.t + durationS);
    this.c.slowMult = Math.max(ctx.tuning.abilities.minHydeSpeedMult, Math.min(1, mult));
  }

  distract(ctx: SimContext, durationS: number): void {
    this.c.distractedUntil = Math.max(this.c.distractedUntil, ctx.t + durationS);
    this.cancelCurse(ctx);
    this.cancelScan(ctx);
  }

  /** Pull him to a visible decoy within lureRangeM for `durationS` (ignores the player meanwhile). False if too far. */
  lure(ctx: SimContext, point: Vec2, durationS: number): boolean {
    const c = this.c;
    if (!this.active || Math.hypot(point.x - c.x, point.z - c.z) > this.cfg.lureRangeM) return false;
    // same counter rule as the Hyde (R8): a decoy only breaks a chase / curse when the tuning says lures do
    if ((c.mode === 'CHASE' || c.mode === 'ATTACK') && !ctx.tuning.abilities.lureBreaksChase) return false;
    this.lureUntil = ctx.t + durationS;
    this.lurePoint = { x: point.x, z: point.z };
    this.cancelCurse(ctx);
    this.cancelScan(ctx);
    if (c.canSeePlayer) ctx.emit({ type: 'crackstone_lost' });
    c.canSeePlayer = false;
    if (c.mode === 'INVESTIGATE') {
      c.path = [];
      this.mover.planGoal = null;
      this.investigateSince = ctx.t;
    } else this.setMode(ctx, 'INVESTIGATE', 'lured');
    c.target = { x: point.x, z: point.z };
    return true;
  }

  // ------------------------------------------------------------------------------------------------- step

  /**
   * One fixed step, after the Hyde's (so R6 sees its current mode). `onCurseHit` applies a landed curse (the run emits
   * `curse {hit}` and maybe `dnf`); it returns false when the run ended (DNF).
   */
  step(ctx: SimContext, dt: number, onCurseHit: () => boolean): void {
    const c = this.c;
    const t = ctx.t;
    const cfg = this.cfg;
    c.modeT += dt;
    if (!this.active) {
      c.speed = 0;
      return;
    }
    if (c.scan?.phase === 'pulse' && t >= c.scan.pulseAt + cfg.scanPulseShowS) c.scan = null;
    if (this.isStunned(t)) {
      c.speed = 0;
      return;
    }
    if (this.lureUntil > -Infinity && t >= this.lureUntil) {
      this.lureUntil = -Infinity;
      const at = this.lurePoint ?? { x: c.x, z: c.z };
      this.lurePoint = null;
      this.startSearch(ctx, at, 'reached_target');
    }
    // R6: the Hyde's chase has priority
    const deferred = this.deferred(ctx);
    if (deferred) {
      this.cancelScan(ctx);
      if (c.mode === 'CHASE' || c.mode === 'ATTACK') {
        this.cancelCurse(ctx);
        this.startSearch(ctx, c.lastKnown ?? { x: c.x, z: c.z }, 'deferred');
      }
    }
    const p = ctx.player;
    const dPlayer = Math.hypot(p.x - c.x, p.z - c.z);
    const distracted = this.isDistracted(t);

    // ---- perception: sight + proximity
    let seen = false;
    if (this.perceives(ctx)) {
      const spot = p.hidden ? hidingRevealAt(ctx, p.x, p.z) : null;
      const sight = c.mode === 'RETURN' ? this.returnSight : cfg.sight;
      const res = canSee(ctx.world, sight, c, { x: p.x, z: p.z, crouched: p.crouched, hiddenRevealM: spot }, {
        fog: ctx.inFog(c.x, c.z) || ctx.inFog(p.x, p.z), distracted,
      });
      seen = res.seen;
      let via: CrackstoneDetectVia = 'sight';
      if (!seen && !p.hidden && !distracted && dPlayer <= cfg.proximityM && ctx.world.lineOfSight(c.x, c.z, p.x, p.z, false)) {
        seen = true;
        via = 'proximity';
      }
      if (seen) {
        if (!c.canSeePlayer) {
          this.stats.sightings++;
          ctx.emit({ type: 'crackstone_sighted', via, distanceM: round2(Math.min(1000, dPlayer)) });
        }
        const closeness = 1 + Math.max(0, 1 - res.distanceM / Math.max(1e-6, res.rangeM));
        c.suspicion = Math.min(1, c.suspicion + cfg.suspicion.sightGainPerS * closeness * dt);
        c.lastKnown = { x: p.x, z: p.z };
        this.lastSeenT = t;
        if (c.mode !== 'CHASE' && c.mode !== 'ATTACK') {
          const instant = via === 'proximity' || dPlayer <= sight.instantM;
          const mayChase = !deferred && t >= this.noChaseUntil && this.fromCentroid(p) <= this.def.leashM;
          if (mayChase && (c.suspicion >= cfg.suspicion.chaseAt || instant)) {
            c.suspicion = 1;
            this.cancelScan(ctx);
            this.setMode(ctx, 'CHASE', via === 'proximity' ? 'sensed_player' : 'saw_player');
          } else this.glimpsed = true;
        }
      }
    }
    if (c.canSeePlayer && !seen) ctx.emit({ type: 'crackstone_lost' });
    c.canSeePlayer = seen;
    if (c.mode === 'CHASE' || c.mode === 'ATTACK') c.suspicion = 1;
    else if (!seen) c.suspicion = Math.max(0, c.suspicion - cfg.suspicion.decayPerS * dt);

    // a glimpse that ended before the chase threshold: go and look where the player was (up to his border)
    if (!seen && this.glimpsed && c.mode !== 'CHASE' && c.mode !== 'ATTACK' && c.lastKnown && this.perceives(ctx)) {
      this.glimpsed = false;
      const goal = this.clampToLeash(c.lastKnown);
      if (c.mode === 'INVESTIGATE') this.investigateSince = t;
      else this.setMode(ctx, 'INVESTIGATE', 'saw_player');
      c.target = goal;
    }

    // ---- scan
    if (c.scan?.phase === 'warning') {
      if (t >= c.scan.pulseAt - 1e-9) {
        const hit = this.scanTest(ctx) === 'exposed';
        this.stats.scans++;
        c.scan = { ...c.scan, phase: 'pulse' };
        ctx.emit({ type: 'crackstone_scan', phase: 'pulse', radiusM: c.scan.radiusM, hit });
        this.scheduleScan(t);
        if (hit) {
          this.stats.scanHits++;
          c.lastKnown = { x: p.x, z: p.z };
          this.lastSeenT = t;
          ctx.emit({ type: 'crackstone_sighted', via: 'scan', distanceM: round2(Math.min(1000, dPlayer)) });
          if (this.fromCentroid(p) <= this.def.leashM) {
            c.suspicion = 1;
            this.setMode(ctx, 'CHASE', 'scan_hit');
          } else {
            if (c.mode !== 'INVESTIGATE') this.setMode(ctx, 'INVESTIGATE', 'scan_hit');
            this.investigateSince = t;
            c.target = this.clampToLeash(c.lastKnown);
          }
        }
      } else {
        c.speed = 0; // he stands still while chanting
        return;
      }
    } else if (
      !c.scan && (c.mode === 'PATROL' || c.mode === 'SEARCH') && !deferred && !distracted && !this.isLured(t) && !this.glimpsed
      && t >= this.nextScanAt && t >= this.scanGraceUntil
    ) {
      c.scan = { phase: 'warning', startedAt: t, pulseAt: t + cfg.scanWarnS, radiusM: cfg.scanRadiusM };
      ctx.emit({ type: 'crackstone_scan', phase: 'warning', radiusM: cfg.scanRadiusM, hit: false });
      c.speed = 0;
      return;
    }

    // ---- mode logic + movement
    const slow = t < c.slowedUntil ? c.slowMult : 1;
    const speed = cfg.speed[c.mode] * slow;
    switch (c.mode) {
      case 'PATROL': {
        if (this.glimpsed && seen) return this.faceAndHold(p, dt);
        this.followLoop(ctx, speed, dt);
        return;
      }
      case 'INVESTIGATE': {
        if (this.glimpsed && seen) return this.faceAndHold(p, dt);
        const goal = c.target ?? c.lastKnown;
        if (!goal) {
          this.startSearch(ctx, c, 'reached_target');
          return;
        }
        const lured = this.isLured(t);
        if (this.fromCentroid(c) > this.def.leashM + 1) {
          if (lured) return this.lookAround(dt); // waits at his border until the decoy fades
          this.startSearch(ctx, c, 'leash');
          return;
        }
        if (t - this.investigateSince >= cfg.investigateMaxS && !lured) {
          this.startSearch(ctx, goal, 'gave_up');
          return;
        }
        if (this.travel(ctx, goal, speed, dt, 1.0)) {
          if (lured) this.lookAround(dt);
          else this.startSearch(ctx, goal, 'reached_target');
        }
        return;
      }
      case 'SEARCH': {
        if (this.glimpsed && seen) return this.faceAndHold(p, dt);
        if (t >= this.searchUntil) {
          this.startReturn(ctx, 'search_timeout');
          return;
        }
        if (t < this.searchPauseUntil) {
          c.speed = 0;
          const look = this.searchLook;
          if (look && Math.abs(wrapAngle(yawTo(c.x, c.z, look.x, look.z) - c.yaw)) > 0.05) {
            c.yaw = turnToward(c.yaw, yawTo(c.x, c.z, look.x, look.z), cfg.turnRatePerS * dt);
          } else {
            this.searchLook = null;
            c.yaw = wrapAngle(c.yaw + this.sweepDir * cfg.lookAroundRadPerS * dt);
          }
          return;
        }
        if (!c.target) {
          const next = this.searchSpots.shift();
          const center = this.searchCenter ?? { x: c.x, z: c.z };
          const L = this.def.leashM + 1;
          c.target = next ? next.at : pickSearchPoint(ctx, this.nav(ctx), this.rng, c, center, cfg.searchRadiusM, (q) => this.fromCentroid(q) <= L);
          this.searchLook = next ? next.look : null;
        }
        if (this.travel(ctx, c.target, speed, dt, SEARCH_ARRIVE_M)) {
          c.target = null;
          this.sweepDir = -this.sweepDir;
          this.searchPauseUntil = t + this.rng.range(0.8, 1.6);
        }
        return;
      }
      case 'CHASE': {
        const L = this.def.leashM;
        const want = seen ? { x: p.x, z: p.z } : (c.lastKnown ?? { x: p.x, z: p.z });
        const wantOutside = this.fromCentroid(want) > L;
        if ((wantOutside && this.fromCentroid(c) >= L - 1) || this.fromCentroid(c) > L + 1.5) {
          this.giveUpAtLeash(ctx);
          return;
        }
        const lostFor = t - this.lastSeenT;
        const invulnerable = t < p.invulnerableUntil;
        if (!seen && (lostFor >= cfg.chaseLossS || distracted || invulnerable)) {
          this.startSearch(ctx, c.lastKnown ?? { x: c.x, z: c.z }, 'lost_sight');
          return;
        }
        if (seen && !deferred && !distracted && !invulnerable && dPlayer <= cfg.curseRangeM && t >= this.lastCurseAt + cfg.curseCooldownS
          && ctx.world.lineOfSight(c.x, c.z, p.x, p.z, false)) {
          this.lastCurseAt = t;
          this.stats.curses++;
          c.speed = 0;
          c.path = [];
          this.setMode(ctx, 'ATTACK', 'curse_cast');
          c.curse = { x: round2(p.x), z: round2(p.z), radiusM: cfg.curseRadiusM, startedAt: t, landsAt: t + cfg.curseWindupS };
          ctx.emit({ type: 'curse', phase: 'cast', hpLost: 0, blocked: false });
          return;
        }
        // he never follows past his leash: the goal is clamped into the leash disc
        const goal = wantOutside ? this.clampToLeash(want) : want;
        c.target = goal;
        if (this.travel(ctx, goal, speed, dt, seen ? 0.6 : 0.8, seen)) {
          c.speed = 0;
          if (wantOutside) this.giveUpAtLeash(ctx); // reached the border (or cannot get closer)
        }
        return;
      }
      case 'ATTACK': {
        c.speed = 0;
        c.yaw = turnToward(c.yaw, yawTo(c.x, c.z, p.x, p.z), cfg.turnRatePerS * dt);
        const cu = c.curse;
        if (!cu) {
          // cancelled elsewhere: resume
          if (seen) this.setMode(ctx, 'CHASE', 'curse_missed');
          else this.startSearch(ctx, c.lastKnown ?? c, 'curse_missed');
          return;
        }
        if (t < cu.landsAt - 1e-9) return;
        const landed = this.curseExposure(ctx) === 'exposed';
        c.curse = null;
        if (landed) {
          this.stats.curseHits++;
          if (!onCurseHit()) return; // DNF: the run is over
          c.lastKnown = null;
          this.startReturn(ctx, 'curse_done');
          return;
        }
        ctx.emit({ type: 'curse', phase: 'miss', hpLost: 0, blocked: false });
        if (seen) this.setMode(ctx, 'CHASE', 'curse_missed');
        else this.startSearch(ctx, c.lastKnown ?? c, 'curse_missed');
        return;
      }
      case 'RETURN': {
        const pts = this.def.patrol;
        const wp = pts[this.returnIndex % Math.max(1, pts.length)];
        if (!wp) {
          this.setMode(ctx, 'PATROL', 'returned');
          return;
        }
        c.target = { x: wp.x, z: wp.z };
        if (this.travel(ctx, wp, speed, dt, cfg.waypointReachedM)) {
          this.patrolIndex = this.returnIndex;
          this.setMode(ctx, 'PATROL', 'returned');
        }
        return;
      }
    }
  }

  private followLoop(ctx: SimContext, speed: number, dt: number): void {
    const c = this.c;
    const pts = this.def.patrol;
    if (pts.length === 0) {
      c.speed = 0;
      return;
    }
    if (ctx.t < this.pauseUntil) return this.lookAround(dt);
    const wp = pts[this.patrolIndex % pts.length];
    c.target = { x: wp.x, z: wp.z };
    if (this.travel(ctx, wp, speed, dt, this.cfg.waypointReachedM)) {
      this.patrolIndex = (this.patrolIndex + 1) % pts.length;
      this.mover.planGoal = null;
      this.pauseUntil = ctx.t + this.cfg.patrolPauseS;
      this.sweepDir = -this.sweepDir;
    }
  }

  private lookAround(dt: number): void {
    this.c.speed = 0;
    this.c.yaw = wrapAngle(this.c.yaw + this.sweepDir * this.cfg.lookAroundRadPerS * dt);
  }

  private faceAndHold(p: Vec2, dt: number): void {
    this.c.speed = 0;
    this.c.yaw = turnToward(this.c.yaw, yawTo(this.c.x, this.c.z, p.x, p.z), this.cfg.turnRatePerS * dt);
  }

  private travel(ctx: SimContext, goal: Vec2, speed: number, dt: number, arrive: number, direct = false): boolean {
    const cfg = this.cfg;
    return this.mover.travel(ctx, this.nav(ctx), this.c, { radius: cfg.radius, turnRatePerS: cfg.turnRatePerS, replanS: cfg.replanS }, goal, speed, dt, arrive, direct, this.c.mode === 'CHASE');
  }

  /**
   * His predicted path for the next `seconds` from his CURRENT plan only (premonition): the current nav path / target,
   * then (PATROL / RETURN) the patrol loop. Waypoint pauses are not modelled.
   */
  predict(ctx: SimContext, seconds: number): Vec2[] {
    const c = this.c;
    const out: Vec2[] = [{ x: c.x, z: c.z }];
    if (!this.active) return out;
    let t = Math.max(0, c.stunnedUntil - ctx.t);
    if (t >= seconds) return out;
    const speed = Math.max(0.1, this.cfg.speed[c.mode] * (ctx.t < c.slowedUntil ? c.slowMult : 1));
    const nav = this.nav(ctx);
    const legs: Vec2[] = [...c.path];
    if (legs.length === 0 && c.target) legs.push(...(nav.findPath(c, c.target) ?? []));
    const pts = this.def.patrol;
    let idx = c.mode === 'RETURN' ? this.returnIndex : this.patrolIndex;
    let pos: Vec2 = { x: c.x, z: c.z };
    let guard = 0;
    while (t < seconds && guard++ < 64) {
      if (legs.length === 0) {
        if ((c.mode === 'PATROL' || c.mode === 'RETURN') && pts.length > 0) {
          const wp = pts[idx % pts.length];
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
